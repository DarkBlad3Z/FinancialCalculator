/* ===================================================================
 * test-render.js — THE CHART MUST NOT TAKE THE HUD WITH IT
 * Run with:  node test-render.js
 *
 * Chart.js is fetched from a CDN. When that script did not load,
 * `new Chart` threw a ReferenceError from inside renderAll(), and
 * because every renderer ran in one statement the throw took out the
 * chart, the year ticks, the inspector, the character bay and the
 * control values. The visible symptom was "the chart is not showing up
 * at all"; the real fault was a cascade.
 *
 * This suite pins both halves of the fix: render steps are isolated,
 * and a missing library falls back to a built-in SVG renderer that
 * consumes the same config object — so there is no second copy of the
 * per-view logic to drift.
 * =================================================================== */

'use strict';

/* ---- a DOM shim generous enough to boot app.js ---- */
const store = {};
let locked = false;
const made = new Map();

function mkEl(id) {
  const e = {
    id, _l: {}, className: '', innerHTML: '', textContent: '', value: '0',
    disabled: false, style: {}, tabIndex: 0, children: [], dataset: {},
    width: 0, height: 0, max: '0', min: '0',
    _classes: new Set(),
    classList: {
      add: (c) => e._classes.add(c),
      remove: (c) => e._classes.delete(c),
      toggle: (c, on) => { if (on === undefined) e._classes.has(c) ? e._classes.delete(c) : e._classes.add(c); else on ? e._classes.add(c) : e._classes.delete(c); },
      contains: (c) => e._classes.has(c),
    },
    addEventListener(k, f) { (e._l[k] = e._l[k] || []).push(f); },
    removeEventListener() {},
    fire(k, ev) { (e._l[k] || []).forEach((f) => f(ev || { preventDefault() {}, target: e })); },
    appendChild(c) { e.children.push(c); return c; },
    setAttribute(k, v) { e['_' + k] = v; }, getAttribute(k) { return e['_' + k]; },
    removeAttribute(k) { delete e['_' + k]; }, hasAttribute(k) { return e['_' + k] !== undefined; },
    focus() {}, blur() {}, select() {}, remove() {},
    closest() { return null; }, setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; },
    getContext() { const n = () => {}; return new Proxy({}, { get: () => n, set: () => true }); },
    querySelector: (s) => get(s), querySelectorAll: () => [],
    dispatchEvent() { return true; },
  };
  return e;
}
function get(sel) {
  if (typeof sel !== 'string') return mkEl('x');
  const key = sel.replace(/^[#.]/, '').split(/[\s\[>]/)[0];
  if (!made.has(key)) made.set(key, mkEl(key));
  return made.get(key);
}

global.window = {
  _l: {}, _cap: {},
  /* Capture-phase listeners are kept separately. The cheat detector
   * registers on window with capture=true precisely so it runs BEFORE
   * the document handler that returns early on input focus, so a shim
   * that ignored the phase would test the wrong order. */
  addEventListener(k, f, opts) {
    const cap = opts === true || (opts && opts.capture);
    const bag = cap ? this._cap : this._l;
    (bag[k] = bag[k] || []).push(f);
  },
  dispatchEvent(ev) { (this._l[ev.type] || []).slice().forEach((f) => f(ev)); return true; },
  devicePixelRatio: 1,
  requestAnimationFrame: (f) => setTimeout(f, 0),
  AudioContext: undefined,
};
global.requestAnimationFrame = (f) => setTimeout(f, 0);
const docKeyHandlers = [];
global.document = {
  documentElement: {
    /* Real elements have a style object; the shim needs one too, or a
     * CSS custom property write looks like a crash. */
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; },
             getPropertyValue(k) { return this._p[k] || ''; }, removeProperty(k) { delete this._p[k]; } },
    setAttribute(k) { if (k === 'data-locked') locked = true; },
    removeAttribute(k) { if (k === 'data-locked') locked = false; },
    hasAttribute(k) { return k === 'data-locked' && locked; },
    innerHTML: '',
  },
  readyState: 'complete',
  addEventListener(k, f) { if (k === 'keydown') docKeyHandlers.push(f); },
  getElementById: (id) => get('#' + id),
  querySelector: get, querySelectorAll: () => [],
  createElement: (t) => mkEl(t), body: { appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } },
};
Object.defineProperty(global, 'crypto', { value: require('crypto').webcrypto, configurable: true });
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.sessionStorage = global.localStorage;
global.TextEncoder = require('util').TextEncoder;
global.Event = class { constructor(t) { this.type = t; } };



const docKeyHandlers2 = docKeyHandlers;
let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js',
                 './characters.js', './controls.js', './profiles.js', './guidance.js',
                 './avatar.js', './svg-chart.js', './audio.js',
                 './optimizer.js']) {
  Object.assign(global, require(m));
}
global.Money = require('./money.js').Money;
global.AudioKit = require('./audio.js').AudioKit;
global.self = global;
for (const id of ['creation', 'settings', 'optimise', 'cheatBanner', 'cheatProg', 'help',
                  'modePick', 'tips', 'profiles', 'cheatMark', 'btnOptimise', 'bayBark'])
  get('#' + id).classList.add('hidden');

/* Chart.js is deliberately NOT defined: this whole suite runs the
 * blocked-CDN path, which is the one that broke. */
const uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(e.message));

require('./auth.js');
let bootThrew = null;
try { require('./app.js'); } catch (e) { bootThrew = e.message; }

(async () => {
  await wait(60);
  window.dispatchEvent(new Event('pf-unlocked'));
  await wait(220);

  const src = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  const html = require('fs').readFileSync(__dirname + '/index.html', 'utf8');
  const inner = (sel) => get(sel).innerHTML || '';

  section('Boot survives a missing charting library');
  ok('boot did not throw', !bootThrew, bootThrew || '');
  ok('nothing escaped as an uncaught error', !uncaught.length, uncaught.join(' | '));

  section('Every other render step still runs');
  ok('status strip rendered', get('#s0v').textContent !== '—',
     's0v = ' + get('#s0v').textContent);
  ok('year ticks rendered', !!inner('#ticks'));
  ok('inspector rendered', !!inner('#insp'),
     'was `inner("#inspector") || inner("#insp")` — the first id does not exist, '
     + 'and the shim auto-creates whatever you query, so the || always carried it');
  ok('character bay rendered', /<svg/.test(inner('#bayFig')));

  section('The chart falls back rather than going blank');
  const box = inner('#chartbox');
  ok('an SVG chart was drawn', /<svg/.test(box), box.slice(0, 80));
  ok('it has plotted geometry, not just axes', /<path d="M/.test(box));
  ok('axis labels are present', /<text/.test(box));
  ok('the user is told why', /Chart\.js library did not load/.test(box));
  ok('and can ask for the detail', /id="chartWhy"/.test(box));

  section('Render isolation is structural, not incidental');
  ok('renderAll loops over named steps',
     /const RENDER_STEPS = \[\s*\n?\s*\['status strip'/.test(src));
  ok('diagnostics counts the real steps rather than a hard-coded number',
     /RENDER_STEPS\.length \+ ' healthy'/.test(src) && !/' \+ 7 \+ '/.test(src));
  ok('each step is wrapped', /try \{ fn\(\); \} catch/.test(src));
  ok('failures are reported once, not every frame', /renderFailed\.has\(name\)/.test(src));
  ok('the old single-statement renderAll is gone',
     !/renderStrip\(\); renderChart\(\); renderTicks\(\)/.test(src));

  section('One failing step cannot silence the others');
  {
    /* The previous version set `global.__forceRenderFailure`, which is
     * read nowhere in any source file, and then asserted
     * `!!inner('#ticks') || before !== ''` — where `before` was captured
     * before the clear, so the `||` made it pass unconditionally. It
     * forced nothing and proved nothing.
     *
     * This breaks a step for real, by making the element it writes to
     * throw, and then checks the OTHER steps still ran. */
    const victim = get('#insp');
    const realSet = Object.getOwnPropertyDescriptor(victim, 'innerHTML');
    Object.defineProperty(victim, 'innerHTML', {
      configurable: true,
      get() { return ''; },
      set() { throw new Error('forced failure'); },
    });
    get('#ticks').innerHTML = '';
    get('#s0v').textContent = '';
    const err = console.error; const logged = []; console.error = (m) => logged.push(m);
    let threw = false;
    try { window.__pfTest.renderAll(); } catch (e) { threw = true; }
    console.error = err;
    if (realSet) Object.defineProperty(victim, 'innerHTML', realSet);

    ok('a broken step does not throw out of the render', !threw);
    ok('and it is reported once', logged.some((m) => /inspector/.test(String(m))),
       'logged: ' + logged.map(String).join(' | ').slice(0, 120));
    ok('the steps after it still ran', !!get('#ticks').innerHTML,
       'ticks were not re-rendered');
    ok('and the ones before it did too', get('#s0v').textContent !== '');
  }

  section('The library check has a single home');
  ok('chartLibReady() exists', /function chartLibReady\(\)/.test(src));
  ok('renderChart asks it rather than testing Chart inline',
     /if \(chartLibReady\(\)\)/.test(src));
  ok('typeof is used, so an undefined global cannot throw',
     /typeof Chart !== 'undefined'/.test(src));

  section('Markers are shared data, not a Chart.js-only plugin');
  ok('marks are built as plain objects', /const marks = \[\{ year: retYear/.test(src));
  // the renderer moved to its own file; assert there, not in app.js
  ok('the SVG renderer draws them',
     /for \(const m of \(marks \|\| \[\]\)\)/.test(
       require('fs').readFileSync(__dirname + '/svg-chart.js', 'utf8')));
  ok('retirement and depletion are both marked',
     /RETIRE ' \+ S\.inputs\.retirementAge/.test(src) && /'DRY ' \+ dry\.age/.test(src));

  section('The canvas is restored rather than handed over as null');
  ok('renderChart re-creates a missing canvas',
     /if \(!\$\('#chart'\)\) \$\('#chartbox'\)\.innerHTML/.test(src));

  section('The CDN tag reports its own failure');
  ok('onerror sets a detectable flag', /onerror="window\.__chartCdnFailed=true"/.test(html));
  ok('integrity and crossorigin are still pinned',
     /integrity="sha384-/.test(html) && /crossorigin="anonymous"/.test(html));

  section('The fallback is wired in, not just present');
  ok('renderChart hands the config to svgChart',
     /box\.innerHTML = svgChart\(cfg, box, marks\)/.test(src));
  ok('it passes the same cfg Chart.js would get, so logic is not duplicated',
     /cfg\.plugins = \[plugin\];\s*\n\s*chart = new Chart\(ctx, cfg\)/.test(src)
     && /svgChart\(cfg,/.test(src));
  ok('the renderer lives in its own file for direct testing',
     require('fs').existsSync(__dirname + '/svg-chart.js'));
  ok('and is exported', typeof require('./svg-chart.js').svgChart === 'function');
  ok('a missing fallback file degrades to words, not an exception',
     /typeof svgChart !== 'function'/.test(src) && /Charts are unavailable/.test(src));
  ok('the build inlines it', /'svg-chart\.js'/.test(
     require('fs').readFileSync(__dirname + '/build.js', 'utf8')));
  ok('and checks it survived inlining', /function svgChart/.test(
     require('fs').readFileSync(__dirname + '/build.js', 'utf8')));

  section('A starved requestAnimationFrame cannot blank the app');
  /* Observed for real: in a hidden iframe rAF never fired, recompute's
   * callback never ran, and the app came up as an empty shell — no
   * simulation, no chart, no figures, nothing explaining why. The same
   * happens in a background tab. */
  ok('the first compute is synchronous, not frame-dependent',
     /recompute\(\{ noGhost: true, sync: true \}\)/.test(src));
  ok('sync bypasses the frame callback entirely',
     /if \(opts\.sync\) \{ runCompute\(opts\); return; \}/.test(src));
  ok('deferred work has a timeout fallback behind the same latch',
     /requestAnimationFrame\(once\);\s*\n\s*setTimeout\(once, 250\);/.test(src));
  ok('the latch cannot run the work twice',
     /const once = \(\) => \{ if \(done\) return; done = true;/.test(src));
  ok('a failed simulate says so on screen instead of leaving stale panels',
     /The forecast could not be calculated from these/.test(src));

  section('Navigation help is present and view-aware');
  ok('every view has a plain-English note', /const VIEW_INFO = \{/.test(src)
     && ['balances', 'networth', 'tax', 'flow', 'bands', 'table']
       .every((v) => new RegExp('\\b' + v + ': \\{').test(src)));
  ok('each one has both a short note and a longer explanation',
     (src.match(/note: '/g) || []).length >= 6 && (src.match(/help: `/g) || []).length >= 6);
  ok('the note is rendered as a render step',
     /\['view note', \(\) => renderViewNote\(\)\]/.test(src));
  ok('the old static "ghost = before change" label is gone',
     !/textContent = S\.view === 'bands' \? 'shaded/.test(src));
  ok('there is one setView, so tab state cannot disagree',
     /function setView\(v\)/.test(src)
     && /\$\$\('#vtabs \.vt'\)\.forEach\(\(b\) => b\.addEventListener\('click', \(\) => setView/.test(src));

  section('The help overlay covers both audiences');
  ok('? opens it', /e\.key === '\?'/.test(src));
  ok('H does too', /k === 'h' && !anyOpen\(\)/.test(src));
  ok('and a visible button, since not everyone tries keys',
     /id="btnHelp"/.test(html));
  ok('it has a getting-started page', /\['start', 'Getting started'\]/.test(src));
  ok('a page explaining the six views', /\['views', 'The six views'\]/.test(src));
  ok('a keyboard map', /\['keys', 'Keyboard'\]/.test(src));
  ok('a plain-English glossary', /\['terms', 'Plain English'\]/.test(src));
  ok('and an honest page about what to trust', /\['trust', 'What to trust'\]/.test(src));
  ok('the glossary explains sequence risk, not just the easy terms',
     /Sequence risk/.test(src) && /selling while prices are down/.test(src));
  ok('the trust page separates reliable, simplified and guesswork',
     /Reliable<\/div>/.test(src) && /Simplified<\/div>/.test(src) && /Guesswork<\/div>/.test(src));
  ok('help is included in the Escape / anyOpen set',
     /'#help', '#modePick'/.test(src));

  section('The table scrolls itself');
  {
    const css = require('fs').readFileSync(__dirname + '/styles.css', 'utf8');
    const block = css.slice(css.indexOf('.tablewrap {'), css.indexOf('.tablewrap {') + 400);
    ok('the wrapper has a bounded height, not just flex sizing',
       /max-height: min\(62vh, 620px\)/.test(block),
       'without a bound it grows to 40 rows and the page scrolls instead');
    ok('it keeps a usable minimum', /min-height: 180px/.test(block));
    ok('scrolling does not chain to the page at the last row',
       /overscroll-behavior: contain/.test(block));
    ok('the scrollbar does not reflow the columns', /scrollbar-gutter: stable/.test(css));
    ok('the year column stays put when scrolled sideways',
       /\.tablewrap th:first-child, \.tablewrap td:first-child \{[\s\S]{0,120}position: sticky; left: 0/.test(css));
    ok('the header outranks the frozen column at the corner',
       /\.tablewrap th:first-child \{ z-index: 3/.test(css));
    ok('the header is still sticky vertically', /^th \{[\s\S]{0,80}position: sticky; top: 0/m.test(css));
    /* The exact caps live in test-layout.js, which owns the scroll
     * chain. Here we only assert that a cap exists at all, so the two
     * files do not have to be edited in lockstep when a number is
     * tuned. */
    ok('the control panel is bounded too, so it scrolls rather than pushing',
       /\.cmd \{ max-height: \d+vh; \}/.test(css),
       '22 controls in an unbounded column push the chart off the screen');
    ok('and it was already set to scroll its overflow', /\.cmd \{[^}]*overflow-y: auto/.test(css));
  }

  section('The README describes the app that exists');
  /* A QA pass found eight stale claims in it, including a Compare
   * button that no longer exists and two sections contradicting each
   * other about how many live controls there are. Documentation that
   * confidently describes a previous version is worse than none. */
  {
    const md = require('fs').readFileSync(__dirname + '/README.md', 'utf8');
    const controls = require('./controls.js');
    const profiles = require('./profiles.js');
    const app = require('fs').readFileSync(__dirname + '/app.js', 'utf8');

    ok('no "Compare selected" button is promised', !/Compare selected/.test(md));
    ok('no "ten pages" claim', !/ten pages/i.test(md));
    ok('no stale 504-assertion count', !/504 assertions/.test(md));
    ok('no "1–6 to focus"', !/`1`–`6`/.test(md));
    ok('no "Settings → Audio" page that is not called that',
       !/Settings → Audio\b/.test(md));
    ok('the control count matches controls.js',
       md.includes(String(controls.LIVE.length)), controls.LIVE.length + ' controls');
    ok('the compare cap matches profiles.js',
       new RegExp('[Uu]p to ' + ['zero', 'one', 'two', 'three', 'four'][profiles.MAX_COMPARE]
         + '|up to ' + profiles.MAX_COMPARE).test(md),
       'MAX_COMPARE is ' + profiles.MAX_COMPARE);
    ok('every shipped source file is in the Files table',
       ['controls.js', 'profiles.js', 'svg-chart.js', 'pack.js', 'gen-sheet.js']
         .every((f) => md.includes('`' + f + '`')),
       'missing: ' + ['controls.js', 'profiles.js', 'svg-chart.js', 'pack.js', 'gen-sheet.js']
         .filter((f) => !md.includes('`' + f + '`')).join(', '));
    ok('the running order mentions the mode picker',
       /Which front door/.test(md));
    ok('the profiles section describes dots, not a button',
       /Click the coloured dot/.test(md));
    ok('and states both compare limitations',
       /only ever the open profile/.test(md) && /union\*? of every pinned horizon/.test(md));
  }

  section('The Accounts page says where after-tax 401(k) money goes');
  /* There is no separate after-tax bucket: the engine converts
   * after-tax contributions straight into Roth 401(k), assuming the
   * in-plan conversion. Somebody with an existing un-converted balance
   * has no obvious home for it, and asked. The page now answers it. */
  {
    const app = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
    const page = app.slice(app.indexOf("case 'accounts': return ["),
                           app.indexOf("case 'markets':"));
    ok('the Roth 401(k) row mentions already-converted money',
       /already converted in-plan/.test(page));
    ok('and the contributions part of un-converted money',
       /contributions<\/b> part of any you have not/.test(page));
    /* Matched within each string literal: the sentence is split across a
     * JS concatenation, so a regex spanning both halves cannot match the
     * source even though the rendered text is correct. */
    ok('the traditional row claims the earnings side',
       /earnings<\/b> on any/.test(page) && /un-converted after-tax money/.test(page));
    ok('the page explains why accounts are listed separately',
       /taxed\s+differently on the way out/.test(page.replace(/\s+/g, ' ')));
    ok('and the cost-basis field warns about setting it to the balance',
       /no unrealised gain/.test(page));
    ok('the engine really does route after-tax into Roth 401(k)',
       /acct\.roth401k = Money\.add\(acct\.roth401k, roth401kContrib, afterTax401k\)/.test(
         require('fs').readFileSync(__dirname + '/engine.js', 'utf8')),
       'if this changes, the guidance above is wrong');
  }

  section('The year playbook is wired and does not silently vanish');
  /* It renders inside the inspector, which runs inside renderAll's
   * per-step isolation — so a missing guidance.js would show up as an
   * empty inspector and nothing else. That is how it should fail, but
   * it should also be caught here. */
  {
    const insp = inner('#insp');
    ok('the inspector rendered at all', !!insp);
    ok('the playbook heading is present', /This year/.test(insp), insp.slice(0, 90));
    ok('and it sits above the money breakdown',
       insp.indexOf('This year') < insp.indexOf('Money in'));
    ok('the effective and marginal rates are both shown',
       /Effective rate/.test(insp) && /next dollar taxed at/.test(insp));
    ok('guidance.js is a real dependency, not an optional extra',
       typeof yearGuidance === 'function');
  }

  section('The in-app help cannot drift from the app');
  /* It said "Ten pages", "the six sliders" and "1 - 6" long after there
   * were twelve pages, twenty-two controls and 1-9 plus [ ]. A keyboard
   * map that is wrong about its own keyboard is worse than none. */
  {
    const app = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
    const controls = require('./controls.js');
    /* Count the entries, not the separators —  is
     * one too many. */
    const nPages = [...(app.match(/const PAGES = \[([\s\S]*?)\n\];/) || ['', ''])[1]
      .matchAll(/\['[a-z]+',/g)].length;
    ok('no hard-coded page count in the help', !/Ten pages|ten pages/.test(app));
    ok('it interpolates the real page count', /\$\{PAGES\.length\} pages/.test(app));
    ok('no hard-coded slider count', !/the six sliders|six live controls/.test(app));
    ok('it interpolates the real control count',
       /\$\{LIVE\.length\} live controls/.test(app));
    ok('and the real group count', /\$\{LIVE_GROUPS\.length\} groups/.test(app));
    ok('the keyboard map covers 1-9, not 1-6', /1 \\u2013 9/.test(app) && !/'1 – 6'/.test(app));
    ok('and the bracket keys', /kb\('\[  \]'/.test(app));
    ok('and the profiles key', /kb\('P', 'Profiles/.test(app));
    ok('there is a help page for profiles', /\['profiles', 'Profiles'\]/.test(app));
    ok('it explains that pinning IS the mode', /the pinned set <i>is<\/i> the/.test(app));
    ok('and states the Bands limitation', /only ever\s*\n?\s*your open profile/.test(app));
    ok('the compare cap is interpolated, not written out',
       /\$\{MAX_COMPARE\} at once/.test(app));
    ok('the controls module really does hold 22 in 4 groups',
       controls.LIVE.length === 22 && controls.LIVE_GROUPS.length === 4,
       `${controls.LIVE.length} controls, ${controls.LIVE_GROUPS.length} groups`);
    ok('and PAGES really does hold 12', nPages === 12, nPages + ' pages');
  }

  section('The inspector moves instead of disappearing');
  {
    const css = require('fs').readFileSync(__dirname + '/styles.css', 'utf8');
    ok('it is no longer display:none on a narrow window',
       !/\.col\.insp-col \{ display: none; \}/.test(css));
    ok('it is re-placed below the chart', /\.col\.insp-col \{ grid-column: 1 \/ -1/.test(css));
    ok('and the page scrolls once stacked', /#app \{ height: auto; min-height: 100vh; \}/.test(css));
    ok('the help text tells the reader where it went',
       /that column moves below the chart/.test(src));
  }

  section('Dead ends were removed');
  ok('the empty Monte Carlo cell is now the button that fills it',
     /mcCell\.classList\.add\('actionable'\)/.test(src) && /runMonteCarlo\(\);/.test(src));
  ok('it is keyboard reachable', /mcCell\.setAttribute\('tabindex', '0'\)/.test(src));
  ok('an empty operator bay says what it is', /'C TO ADD'/.test(src)
     && /empty-bay/.test(src));
  ok('first-run tips exist and can be dismissed for good',
     /function showFirstRunTips/.test(src) && /S\.ui\.tipsDone = true/.test(src));
  ok('and replayed from Settings', /btnTipsAgain/.test(src));
  ok('tips are keyed to first seeing the dashboard, not to picking a mode',
     /if \(S\.ui\.mode && !S\.ui\.tipsDone\) setTimeout\(showFirstRunTips/.test(src));
  ok('the Monte Carlo cell tells you what clicking does',
     /click to run 500 trials/.test(src) && !/open Bands to run/.test(src));

  section('The status strip reflows instead of assuming a width');
  {
    const css = require('fs').readFileSync(__dirname + '/styles.css', 'utf8');
    ok('the strip uses auto-fit, not a hard column count',
       /\.strip \{[\s\S]*?repeat\(auto-fit, minmax\(160px, 1fr\)\)/.test(css));
    ok('no fixed repeat(4, 1fr) remains', !/grid-template-columns: repeat\(4, 1fr\) 96px/.test(css));
    ok('the bay is a trailing cell, not a flexible track',
       /\.strip\.has-bay \.bay \{ grid-column: -2 \/ -1; \}/.test(css));
    ok('app.js toggles a class rather than writing an inline template',
       /classList\.toggle\('has-bay'/.test(src)
       && !/style\.gridTemplateColumns/.test(src),
       'an inline grid template fights the media queries');
    ok('the narrow rule also reflows rather than forcing two columns',
       !/repeat\(2, 1fr\) !important/.test(css));
  }

  section('Diagnostics exist so the next report carries facts');
  ok('there is a Diagnostics settings page', /\['diag', 'Diagnostics'\]/.test(src));
  ok('it reports the chart library state', /function diagPage/.test(src)
     && /Chart library/.test(src));
  ok('it reports the chart area size', /Chart area/.test(src));
  ok('it samples whether pixels were actually painted', /NOTHING PAINTED/.test(src));
  ok('it lists failed render steps', /renderFailed\.size \? bad/.test(src));
  ok('a copyable report exists', /function diagText/.test(src));
  ok('and it degrades when the clipboard is blocked on file://',
     /<textarea readonly/.test(src));

  console.log('\n' + '='.repeat(56));
  if (failed) console.log(fails.join('\n') + '\n');
  console.log(`${passed} passed, ${failed} failed`);
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
})();
