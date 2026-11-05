/* ===================================================================
 * test-sequence.js — RUNNING ORDER
 * Run with:  node test-sequence.js
 *
 * The order is UNLOCK -> CREATE -> DASHBOARD. Two bugs broke it once:
 * creation opened on DOMContentLoaded and so rendered *behind* the lock
 * overlay, and a storage key polluted by instrumented test builds made
 * a first-time visitor look like a returning one, skipping creation
 * altogether. Both are regression-guarded here.
 *
 * The order is now UNLOCK -> CREATE -> SETTINGS(page 1) -> DASHBOARD,
 * and the optimiser is a hidden cheat rather than an offered button,
 * so both of those are covered too.
 * =================================================================== */
'use strict';

/* ---- a DOM shim generous enough to boot app.js ---- */
const store = {};
let locked = false;
const made = new Map();

function mkEl(id) {
  const e = {
    id, _l: {}, className: '', _html: '', textContent: '', value: '0',
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
    /* Writing innerHTML destroys that element's own children in a real
     * DOM, so the stubs derived from THIS element must go too — but
     * only this element's. Two earlier versions of this were wrong in
     * opposite directions: caching stubs forever accumulated one
     * handler per render (a click then toggled the same profile several
     * times and cancelled itself out), and clearing every stub on any
     * write meant rendering one panel destroyed another panel's
     * handlers. Scoped to the host, it matches the real DOM. */
    get innerHTML() { return e._html; },
    set innerHTML(v) {
      e._html = v;
      const prefix = 'stub:' + id + ':';
      for (const k of [...made.keys()]) if (k.startsWith(prefix)) made.delete(k);
    },
    removeEventListener() {},
    fire(k, ev) { (e._l[k] || []).forEach((f) => f(ev || { preventDefault() {}, target: e })); },
    appendChild(c) { e.children.push(c); return c; },
    setAttribute(k, v) { e['_' + k] = v; }, getAttribute(k) { return e['_' + k]; },
    removeAttribute(k) { delete e['_' + k]; }, hasAttribute(k) { return e['_' + k] !== undefined; },
    focus() {}, blur() {}, select() {}, remove() {},
    closest() { return null; }, setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; },
    getContext() { const n = () => {}; return new Proxy({}, { get: () => n, set: () => true }); },
    querySelector: (s) => get(s),
    /* Returns live stubs for [data-mode] so the mode picker's own
     * wiring runs and a choice can genuinely be clicked, rather than
     * the test asserting against markup nobody bound. */
    querySelectorAll(sel) {
      if (sel === '[data-mode]') {
        if (!e._modeBtns) {
          e._modeBtns = ['pro', 'arcade'].map((m) => {
            const b = mkEl('modebtn-' + m);
            b.dataset = { mode: m };
            return b;
          });
        }
        return e._modeBtns;
      }
      return [];
    },
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
const bodyClasses = new Set();
const docAttrs = {};
/* Every element the shim has ever created, so a test can find the ones
 * the app built dynamically. */
const shimEls = () => [...made.values()].concat(createdEls);
const createdEls = [];
global.document = {
  documentElement: {
    /* Real elements have a style object; the shim needs one too, or a
     * CSS custom property write looks like a crash. */
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; },
             getPropertyValue(k) { return this._p[k] || ''; }, removeProperty(k) { delete this._p[k]; } },
    setAttribute(k, v) { if (k === 'data-locked') locked = true; docAttrs[k] = v; },
    removeAttribute(k) { if (k === 'data-locked') locked = false; delete docAttrs[k]; },
    hasAttribute(k) { return k === 'data-locked' && locked; },
    innerHTML: '',
  },
  readyState: 'complete',
  addEventListener(k, f) { if (k === 'keydown') docKeyHandlers.push(f); },
  getElementById: (id) => get('#' + id),
  querySelector: get,
  /* The app builds most of its controls with innerHTML, so they are not
   * shim elements and `querySelectorAll` would return nothing — the
   * app's own wiring would then bind to nothing and a test could not
   * click anything it rendered. This materialises a stable stub per
   * `data-x="value"` found in any innerHTML the shim has seen, so the
   * real handlers attach to the same object a test can fire. */
  querySelectorAll(sel) {
    const m = String(sel).match(/\[data-([a-z-]+)\]/);
    if (!m) return [];
    const attr = m[1];
    const camel = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const out = [];
    const seen = new Set();
    for (const host of shimEls()) {
      const html = host.innerHTML || '';
      for (const x of html.matchAll(new RegExp('data-' + attr + '="([^"]*)"', 'g'))) {
        const v = x[1];
        if (seen.has(v)) continue;
        seen.add(v);
        const key = 'stub:' + host.id + ':' + attr + ':' + v;
        if (!made.has(key)) {
          const n = mkEl(key);
          n.dataset = { [camel]: v };
          made.set(key, n);
        }
        out.push(made.get(key));
      }
    }
    return out;
  },
  createElement: (t) => { const n = mkEl(t); createdEls.push(n); return n; },
  body: {
    appendChild() {},
    classList: {
      toggle: (c, on) => { on ? bodyClasses.add(c) : bodyClasses.delete(c); },
      add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c),
      contains: (c) => bodyClasses.has(c),
    },
  },
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
/* Records every config the app hands to Chart.js. Compare mode can then
 * be asserted on what is actually drawn — dataset count, series labels,
 * the shared x axis — rather than on the source text that builds it. */
const charts = [];
global.Chart = class {
  constructor(ctx, cfg) { charts.push(cfg); }
  destroy() {} resize() {}
};
const lastChart = () => charts[charts.length - 1];

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

require('./money.js'); require('./tax-config.js'); require('./tax-engine.js');
require('./engine.js'); require('./characters.js'); require('./controls.js');
require('./profiles.js'); require('./guidance.js'); require('./svg-chart.js');
require('./avatar.js');
require('./audio.js'); require('./optimizer.js');
// Bring browser-style globals into scope for auth.js / app.js.
for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js',
                 './characters.js', './controls.js', './profiles.js', './guidance.js', './avatar.js',
                 './svg-chart.js', './audio.js',
                 './optimizer.js']) {
  Object.assign(global, require(m));
}
global.Money = require('./money.js').Money;
global.AudioKit = require('./audio.js').AudioKit;
global.self = global;

/* Mirror the real markup: the three overlays ship with class="overlay
 * hidden". Without seeding that, the shim would start them visible and
 * the "not open behind the lock" assertion would test nothing. */
for (const id of ['creation', 'settings', 'optimise', 'cheatBanner', 'help', 'modePick',
                  'cheatProg', 'cheatMark', 'btnOptimise', 'bayBark', 'tips', 'profiles', 'pbar', 'cmpMatrix', 'applied', 'btnTheme', 'profClose2']) {
  get('#' + id).classList.add('hidden');
}

require('./auth.js');
require('./app.js');

(async () => {
  section('The page starts locked, with creation NOT open');
  await wait(60);
  ok('auth.js locked the document', locked);
  ok('creation was not opened behind the lock',
     get('#creation').classList.contains('hidden'),
     'creation classes: [' + [...get('#creation')._classes].join(',') + ']');
  ok('nor were settings or the optimiser',
     get('#settings').classList.contains('hidden') && get('#optimise').classList.contains('hidden'));

  section('Unlocking asks which front door first');
  /* The running order is UNLOCK -> CHOOSE A MODE -> (Arcade only)
   * CREATE -> SETTINGS -> dashboard. The mode answer decides whether
   * music starts and whether character creation happens at all, so it
   * cannot be asked later. */
  window.dispatchEvent(new Event('pf-unlocked'));
  await wait(120);
  ok('the mode picker opens after the unlock event',
     !get('#modePick').classList.contains('hidden'),
     'classes: ' + [...get('#modePick')._classes].join(','));
  ok('creation waits for that answer',
     get('#creation').classList.contains('hidden'));
  const pickHtml = get('.sheet').innerHTML || '';
  ok('both modes are offered',
     /data-mode="pro"/.test(pickHtml) && /data-mode="arcade"/.test(pickHtml),
     pickHtml.slice(0, 140));
  ok('it says the choice does not change the numbers',
     /Same engine either way/.test(pickHtml));
  ok('and that it can be changed later', /switch whenever you like/.test(pickHtml));

  section('Choosing Planner goes straight to the dashboard');
  {
    const btns = get('#modePick').querySelectorAll('[data-mode]');
    const pro = btns.find((b) => b.dataset.mode === 'pro');
    ok('the Planner button got wired', !!(pro && pro._l.click), 'no click handler');
    pro.fire('click');
    await wait(120);
  }
  ok('the picker closed', get('#modePick').classList.contains('hidden'));
  ok('character creation is NOT forced on a planner',
     get('#creation').classList.contains('hidden'),
     'creation classes: ' + [...get('#creation')._classes].join(','));
  ok('audio is off', AudioKit.state.enabledMusic === false
     && AudioKit.state.enabledCues === false);
  ok('the operator bay is off', get('#bay').classList.contains('hidden'));
  ok('Auto-optimise is on the toolbar, not hidden',
     !get('#btnOptimise').classList.contains('hidden'),
     'btnOptimise: [' + [...get('#btnOptimise')._classes].join(',') + ']');
  ok('plain wording is applied', bodyClasses.has('plain'));
  ok('orientation tips are offered instead of a forced tour',
     !get('#tips').classList.contains('hidden'));
  ok('the mode persisted',
     JSON.parse(store['pf-forecaster-state-v3']).ui.mode === 'pro');

  section('A mode changes presentation only, never the forecast');
  /* This is the property that makes switching safe at any time, so it
   * is asserted on the definitions rather than trusted to review. */
  {
    const src2 = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
    const block = src2.slice(src2.indexOf('const MODES = {'), src2.indexOf('function applyMode'));
    const INPUT_KEYS = Object.keys(defaultInputs());
    const leaked = INPUT_KEYS.filter((k) => new RegExp('\\b' + k + '\\s*:').test(block));
    ok('no mode definition mentions an input key', !leaked.length, 'leaked: ' + leaked.join(', '));
    ok('applyMode only ever writes S.ui',
       !/applyMode[\s\S]{0,600}?S\.inputs/.test(src2));
    ok('the mode page toggles go through UI_TOGGLES, not setPath',
       /if \(UI_TOGGLES\[key\]\) UI_TOGGLES\[key\]\(next\);/.test(src2));
    ok('Arcade keeps the order the user asked for (create, then settings)',
       /name === 'arcade'\) openCreation\(false\)/.test(src2));
    ok('Planner records the skip rather than pretending creation happened',
       /S\.ui\.skippedCreation = true; save\(\); showFirstRunTips\(\)/.test(src2));
  }

  section('Switching to Arcade restores the full HUD experience');
  /* The cheat code, the soundtrack and the operator belong to Arcade.
   * Testing them while in Planner would assert the wrong thing, so the
   * suite switches front doors here and continues in Arcade. */
  {
    get('#helpMode').fire('click');
    await wait(60);
    ok('the picker can be reopened from help',
       !get('#modePick').classList.contains('hidden'));
    const btns = get('#modePick').querySelectorAll('[data-mode]');
    const arc = btns.find((b) => b.dataset.mode === 'arcade');
    arc.fire('click');
    await wait(140);
  }
  ok('Arcade turns the soundtrack on', AudioKit.state.enabledMusic === true);
  ok('and the interface sounds', AudioKit.state.enabledCues === true);
  ok('the operator bay comes back', !get('#bay').classList.contains('hidden'));
  ok('plain wording is dropped', !bodyClasses.has('plain'));
  /* Arcade deliberately does NOT re-lock a cheat code that has already
   * been earned. The previous expectation here was that it did, which
   * meant switching modes took something away from the user. */
  ok('an already-earned cheat code is NOT taken away by switching mode',
     !get('#btnOptimise').classList.contains('hidden'),
     'btnOptimise: [' + [...get('#btnOptimise')._classes].join(',') + ']');
  {
    const appSrc = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
    /* Planner granting it is intended — the optimiser is on its
     * toolbar. Only Arcade must not take it back. */
    const arcade = appSrc.slice(appSrc.indexOf('  arcade: {'),
                                appSrc.indexOf('function applyMode'));
    ok('the Arcade definition does not revoke it', !/cheatUnlocked/.test(
       arcade.replace(/\/\*[\s\S]*?\*\//g, '')));
    ok('while Planner still grants it, which is the point of that mode',
       /pro: \{[\s\S]*?cheatUnlocked: true/.test(appSrc));
  }
  ok('and Arcade runs character creation',
     !get('#creation').classList.contains('hidden'));
  // close creation so the rest of the suite sees the dashboard
  get('#creationSkip').fire('click');
  await wait(80);

  section('The storage key was bumped past the polluted one');
  const src = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok('app.js uses the v3 key', /pf-forecaster-state-v3/.test(src));
  ok('and no longer reads v2', !/pf-forecaster-state-v2/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));

  section('Creation is gated on a CHARACTER, not a flag');
  ok('load() keys on d.character', /return !!d\.character \|\| d\.ui\?\.skippedCreation/.test(src));
  ok('the old created flag is gone', !/S\.ui\.created\s*=\s*true/.test(src));
  ok('declining is recorded distinctly', /skippedCreation = true/.test(src));

  section('auth.js announces the unlock rather than app.js guessing');
  const asrc = require('fs').readFileSync(__dirname + '/auth.js', 'utf8');
  ok('reveal() dispatches pf-unlocked', /dispatchEvent\(new Event\('pf-unlocked'\)\)/.test(asrc));
  ok('and sets a flag for an already-unlocked load', /__pfUnlocked = true/.test(asrc));
  ok('app.js waits for it', /addEventListener\('pf-unlocked'/.test(src));
  ok('and handles the already-unlocked case', /window\.__pfUnlocked/.test(src));

  section('Creation hands off to Settings, first page');
  ok('finishCreation opens settings',
     /function finishCreation\(\)[\s\S]*?openSettings\(\)/.test(src));
  ok('and pins it to page 1 (profile) first',
     /finishCreation\(\)[\s\S]*?settingsPage = 'profile';[\s\S]*?openSettings\(\)/.test(src));
  ok('the review step points at that confirmation step',
     /confirm these in Settings/.test(src));

  section('The optimiser is hidden — it is a cheat code');
  const html = require('fs').readFileSync(__dirname + '/index.html', 'utf8');
  ok('the button ships hidden',
     /id="btnOptimise"/.test(html)
     && /class="[^"]*hidden[^"]*"[^>]*id="btnOptimise"/.test(html));
  ok('the O hotkey is gated on the unlock',
     /k === 'o' && !anyOpen\(\) && S\.ui\.cheatUnlocked/.test(src));
  ok('the key hint is hidden too', /id="cheatMark"/.test(html)
     && /class="key hidden" id="cheatMark"/.test(html));
  ok('the nudge that advertised it is gone',
     !/id="nudge"/.test(html) && !/nudgeDismissed/.test(src));
  ok('nothing calls optimise() during boot',
     !/function boot\(\)[\s\S]*?[^n]optimise\(/.test(src.split('function selfCheck')[0]));
  ok('apply is a separate explicit action', /optApply.*addEventListener/.test(src));
  ok('the unlock persists', /cheatUnlocked = true;[\s\S]{0,80}save\(\)/.test(src));

  section('The cheat combination');
  /* Test fixture, not a product path: the suite reached here with the
   * cheat already unlocked (Planner grants it), and switching to Arcade
   * no longer revokes it. Re-locking through the test hook lets the
   * combination itself still be exercised from a cold start. */
  window.__pfTest.state().ui.cheatUnlocked = false;
  get('#btnOptimise').classList.add('hidden');
  get('#cheatBanner').classList.add('hidden');
  await wait(20);
  /* Real order: window capture handlers, then the document handler —
   * and a swallowed key (stopPropagation) never reaches the document. */
  const keydown = (key, tagName = 'BODY') => {
    let stopped = false;
    const ev = { key, target: { tagName }, preventDefault() {},
                 stopPropagation() { stopped = true; } };
    (window._cap.keydown || []).forEach((f) => f(ev));
    if (!stopped) (docKeyHandlers || []).forEach((f) => f(ev));
    ev._stopped = stopped;
    return ev;
  };
  ok('the combination is not the Konami code',
     !/ArrowUp',\s*'ArrowUp'/.test(src), 'a borrowed sequence would be a let-down');
  ok('it is 11 moves long', (src.match(/const CHEAT = \[([\s\S]*?)\];/) || [])[1]
     .split(',').length === 11);

  // Wrong sequence: nothing happens.
  ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowUp'].forEach(keydown);
  ok('a wrong key does not unlock', get('#btnOptimise').classList.contains('hidden'));

  /* The real sequence — entered as if focus were in a number field,
   * which is the case that was broken. wireKeys returns early on input
   * focus, and after creation the app lands in Settings, wall-to-wall
   * number inputs: one click in a field and every key was swallowed
   * before the detector saw it. Testing only the easy case (focus on
   * the body) would have passed while the feature was unusable, so the
   * hard case is the one asserted. */
  const COMBO = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft',
                 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'm', 'a', 'x'];
  let swallowed = 0;
  for (const k of COMBO) if (keydown(k, 'INPUT')._stopped) swallowed++;
  await wait(30);
  ok('the combination unlocks WITH FOCUS IN A NUMBER FIELD',
     !get('#btnOptimise').classList.contains('hidden'),
     'btnOptimise classes: [' + [...get('#btnOptimise')._classes].join(',') + ']');
  ok('most of the sequence is swallowed rather than editing the field',
     swallowed >= 9, swallowed + ' of 11 swallowed');
  ok('the key hint appears', !get('#cheatMark').classList.contains('hidden'));
  ok('a banner confirms it', !get('#cheatBanner').classList.contains('hidden'));
  ok('and it survives a reload',
     JSON.parse(store['pf-forecaster-state-v3']).ui.cheatUnlocked === true);

  section('The combination works with focus in a form field');
  /* This was the bug. wireKeys returns early whenever focus is in an
   * input, and after creation the app lands in Settings — wall-to-wall
   * number fields. One click in a field and every key was swallowed
   * before the detector saw it: the code silently did not work. */
  ok('the detector registers on the capture phase',
     (window._cap.keydown || []).length > 0,
     'capture handlers: ' + (window._cap.keydown || []).length);
  ok('and it is not the same handler as the document one',
     (window._cap.keydown || [])[0] !== docKeyHandlers[0]);
  ok('app.js explains why the phase matters', /CAPTURE phase, deliberately/.test(src));
  ok('wireKeys still returns early on input focus (unchanged)',
     /if \(\/input\|select\|textarea\/i\.test\(e\.target\.tagName\)\)/.test(src));
  ok('the detector no longer sits after that guard',
     !/Escape'\) \{ closeAll\(\); return; \}\s*\n\s*\n?\s*\/\* The cheat detector/.test(src));

  section('Feedback starts at the first move, not the fifth');
  ok('progress renders from one move in', /'\\u25c6'\.repeat\(cheatPos\)/.test(src));
  ok('the old "only past move four" behaviour is gone',
     !/cheatPos > 4/.test(src));
  ok('a stalled attempt resets', /cheatPos = 0; renderCheatProgress\(\); \}, 3500\)/.test(src));
  ok('focus is pulled out of a field once the code is clearly deliberate',
     /cheatPos === 2 && document\.activeElement/.test(src));

  section('Clicking the operator is a second way in');
  ok('a click count unlocks it too', /bayClicks >= CHEAT_CLICKS\) unlockCheat\('clicks'\)/.test(src));
  ok('seven clicks, not an accidental number', /CHEAT_CLICKS = 7/.test(src));
  ok('the click reaction lasts long enough to reach seven',
     /bayClicks = 0; renderBay\(\); \}, 6000\)/.test(src));
  ok('unlocking twice is a no-op', /if \(S\.ui\.cheatUnlocked\) return;/.test(src));
  ok('the banner says which route was used', /how === 'clicks'/.test(src));

  section('The owner can find their own cheat code');
  ok('Diagnostics reports whether it is locked', /row\('Auto-optimise'/.test(src));
  ok('and offers the hint on request', /id="btnCheatHint"/.test(src));
  ok('the hint names both routes',
     /Press it anywhere in the app/.test(src) && /click the\n\s*operator/.test(src));
  ok('it is not printed in the main UI',
     !/CHEAT_HINT/.test(html), 'index.html must not carry the hint');

  section('Profiles: the bar, not a buried overlay');
  {
    const Pr = require('./profiles.js');
    const a = Pr.makeProfile('Retire at 65', defaultInputs(), 65, null, 0);
    const b = Pr.makeProfile('Retire at 55',
      { ...defaultInputs(), retirementAge: 55 }, 65, null, 1);
    Pr.saveProfiles({ list: [a, b], activeId: a.id, compareIds: [] });

    /* Opening the manage overlay re-reads storage, which is also how the
     * bar picks up the seeded profiles. */
    get('#btnProfiles').fire('click');
    await wait(60);
    get('#profClose').fire('click');
    await wait(40);

    const bar = get('#pbar').innerHTML || '';
    ok('the bar renders chips for both profiles',
       bar.includes('Retire at 65') && bar.includes('Retire at 55'), bar.slice(0, 140));
    ok('each chip has a pin dot and a name button',
       /data-pin=/.test(bar) && /data-open=/.test(bar));
    ok('the active chip is marked', /class="pchip on/.test(bar));
    ok('save and manage live in the bar',
       /id="pbSave"/.test(bar) && /id="pbManage"/.test(bar));
    /* Layout: profiles + Save/Manage on the left, the four nav buttons on
     * the right, all one row. The nav is static markup OUTSIDE #pbar,
     * because renderProfBar rewrites #pbar and would kill the listeners. */
    const row = html.match(/<div class="pbrow">([\s\S]*?)<div class="col">/);
    ok('there is one row holding both groups', !!row);
    const rowHtml = row ? row[1] : '';
    const iBar = rowHtml.indexOf('id="pbar"'), iNav = rowHtml.indexOf('id="pbNav"');
    ok('profiles come first (left), nav second (right)', iBar >= 0 && iNav > iBar);
    const navHtml = rowHtml.slice(iNav);
    for (const id of ['btnOptimise', 'btnSettings', 'btnProfiles', 'btnCharacter']) {
      ok(`${id} is in the right-hand nav`, navHtml.includes(`id="${id}"`));
    }
    ok('the nav is not inside the re-rendered profile bar',
       !rowHtml.slice(iBar, iNav).includes('id="btnSettings"'));
    ok('the command card no longer carries the buttons (each exists exactly once)',
       ['btnOptimise', 'btnSettings', 'btnProfiles', 'btnCharacter']
         .every((id) => html.split(`id="${id}"`).length === 2)
       && html.indexOf('id="btnSettings"') < html.indexOf('id="cmd"'));
    const wired = ['#btnOptimise', '#btnSettings', '#btnProfiles', '#btnCharacter']
      .map((s) => (get(s)._l.click || []).length);
    ok('every nav button has a click handler', wired.every((n) => n === 1), wired.join(','));
    window.__pfTest.renderAll();
    await wait(40);
    ok('and they survive a re-render of the bar',
       ['#btnOptimise', '#btnSettings', '#btnProfiles', '#btnCharacter']
         .every((s) => (get(s)._l.click || []).length === 1));
    ok('Save and Manage sit inside the left group, after the chips',
       bar.indexOf('pb-strip') >= 0 && bar.indexOf('id="pbSave"') > bar.indexOf('pb-strip')
       && bar.indexOf('id="pbManage"') > bar.indexOf('id="pbSave"'));
    ok('the bar is always present, never conditional on having profiles',
       /function renderProfBar/.test(src) && /const none = !P\.list\.length/.test(src));
  }

  section('Pinning two profiles IS compare mode');
  {
    /* The shim's querySelectorAll returns [] for arbitrary selectors, so
     * the app's own wiring cannot be reached that way. The pin buttons
     * are created by renderProfBar via `el()`, which the shim records —
     * so drive them through the elements the shim handed out. */
    const pins = document.querySelectorAll('[data-pin]');
    ok('pin buttons were wired', pins.length >= 2, pins.length + ' found');
    pins[0].fire('click');
    await wait(40);
    ok('one pin is not yet comparing',
       !get('#pbar').classList.contains('comparing'),
       'classes: [' + [...get('#pbar')._classes].join(',') + ']');
    pins[1].fire('click');
    await wait(60);
    ok('two pins turns the bar into compare mode',
       get('#pbar').classList.contains('comparing'));
    ok('a clear pill appears', /id="pbClear"/.test(get('#pbar').innerHTML || ''));
    ok('the view note switches to the comparing wording',
       /Comparing:/.test(get('#vpNote').textContent || ''),
       get('#vpNote').textContent);
    ok('the status strip names the open profile, so four lines cannot be misread',
       /Retire at \d+ \u2014 net worth at/.test(get('#s0label').textContent || ''),
       get('#s0label').textContent);
    ok('there is no separate Compare button to find',
       !/id="profCompare"/.test(html), 'the compare set is the mode');
  }

  section('Compare overlays the main charts, per view');
  {
    /* Behavioural, not source-text: the previous version of this section
     * was twelve regexes, and the QA pass found that two of them could
     * not fail and one asserted a rationale that was no longer true. */
    const before = charts.length;
    window.__pfTest.setView('networth');
    await wait(60);
    const cfg = lastChart();
    ok('a chart was built', !!cfg && charts.length > before);
    const labels = (cfg.data.datasets || []).map((d) => d.label);
    ok('both pinned profiles appear as their own series',
       labels.includes('Retire at 65') && labels.includes('Retire at 55'),
       'series: ' + labels.join(' | '));
    ok('the open profile is still drawn underneath',
       labels.includes('Net worth'), labels.join(' | '));
    ok('the ghost and liquid-only lines are dropped as noise',
       !labels.includes('before change') && !labels.includes('Liquid only'),
       labels.join(' | '));

    const own = cfg.data.datasets.find((d) => d.label === 'Net worth');
    const pin = cfg.data.datasets.find((d) => d.label === 'Retire at 55');
    ok('the open profile is faded, not hidden',
       /rgba\(/.test(String(own.borderColor)) || own.borderWidth <= 1,
       `borderColor=${own.borderColor} width=${own.borderWidth}`);
    ok('the comparison line is drawn at full strength',
       pin.borderWidth >= 2 && !/rgba\([^)]*0?\.\d+\)$/.test(String(pin.borderColor)),
       `borderColor=${pin.borderColor} width=${pin.borderWidth}`);
    ok('every series sits on one shared x axis',
       cfg.data.datasets.every((d) => d.data.length === cfg.data.labels.length),
       cfg.data.datasets.map((d) => d.label + ':' + d.data.length).join(' '));
  }

  section('A longer pinned profile extends the axis instead of being cropped');
  {
    const Pr = require('./profiles.js');
    const st = Pr.loadProfiles();
    const longer = Pr.makeProfile('Long horizon',
      { ...defaultInputs(), horizonYears: 55 }, 65, null, 2);
    Pr.saveProfiles({ list: [...st.list, longer], activeId: st.activeId,
                      compareIds: st.compareIds });
    /* Pinned through the UI, not seeded: openProfiles deliberately keeps
     * the in-memory selection over the stored one, so a seeded
     * compareIds would be ignored — which is correct, and is why this
     * has to go through the dot. */
    get('#btnProfiles').fire('click');
    await wait(60);
    get('#profClose').fire('click');
    await wait(60);
    const dot = document.querySelectorAll('[data-pin]')
      .find((b) => b.dataset.pin === longer.id);
    ok('the new profile appears in the bar', !!dot,
       'pins: ' + document.querySelectorAll('[data-pin]').length);
    if (dot) dot.fire('click');
    await wait(80);
    window.__pfTest.setView('networth');
    await wait(60);
    const cfg = lastChart();
    ok('the axis covers the longest pinned horizon',
       cfg.data.labels.length >= 55,
       cfg.data.labels.length + ' years on the axis');
    const ser = cfg.data.datasets.find((d) => d.label === 'Long horizon');
    ok('the longer profile is present', !!ser);
    const shortOne = cfg.data.datasets.find((d) => d.label === 'Retire at 55');
    ok('a shorter series stops with gaps rather than being padded with zeroes',
       shortOne && shortOne.data.slice(-3).every((v) => v === null),
       shortOne ? 'tail: ' + JSON.stringify(shortOne.data.slice(-3)) : 'missing');
    ok('and the open profile was re-keyed onto the same axis',
       cfg.data.datasets.every((d) => d.data.length === cfg.data.labels.length));
  }

  section('Bands without a Monte Carlo run still compares');
  {
    window.__pfTest.setView('bands');
    await wait(80);
    const cfg = lastChart();
    ok('a chart is drawn rather than an empty state',
       !!cfg && (get('#chartbox').innerHTML || '').indexOf('Run 500 trials') < 0,
       (get('#chartbox').innerHTML || '').slice(0, 70));
    ok('and it carries the comparison lines',
       cfg.data.datasets.some((d) => d.label === 'Retire at 55'),
       cfg.data.datasets.map((d) => d.label).join(' | '));
    ok('the note no longer promises a range it has not computed',
       /Run Monte Carlo for a range/.test(get('#vpNote').textContent || ''),
       get('#vpNote').textContent);
  }

  section('The summary matrix lives in the Table view, and only there');
  {
    window.__pfTest.setView('table');
    await wait(80);
    const mx = get('#cmpMatrix').innerHTML || '';
    ok('the matrix renders on the Table view', /<table class="cmptable">/.test(mx),
       mx.slice(0, 80));
    ok('every compare row appears',
       require('./profiles.js').COMPARE_ROWS.every((r) => mx.includes(r.label)),
       'missing: ' + require('./profiles.js').COMPARE_ROWS
         .filter((r) => !mx.includes(r.label)).map((r) => r.label).join(', '));
    ok('the better figure is marked', /class="bestcell"/.test(mx));
    ok('plan status is shown', /Plan status/.test(mx));
    ok('nothing leaked a token', !/undefined|NaN|\[object/.test(mx),
       (mx.match(/.{0,30}(undefined|NaN).{0,30}/) || [])[0] || '');

    /* B4: it was left rendered on every other view, wedging a table
     * under the chart and squeezing it to its minimum height. */
    window.__pfTest.setView('balances');
    await wait(60);
    ok('and is cleared when you leave the Table view',
       !(get('#cmpMatrix').innerHTML || '').trim(),
       'still ' + (get('#cmpMatrix').innerHTML || '').length + ' chars');
  }

  section('The old overlay compare screen is gone');
  ok('no renderCompare', !/function renderCompare/.test(src));
  ok('no drawCompareChart', !/function drawCompareChart/.test(src));
  ok('and no Compare button to hunt for', !/id="profCompare"/.test(html));

  section('Profile colours are readable on both themes');
  {
    const Pr = require('./profiles.js');
    ok('a light palette exists', Array.isArray(Pr.PROFILE_COLOURS_LIGHT));
    ok('same length and order as the dark one',
       Pr.PROFILE_COLOURS_LIGHT.length === Pr.PROFILE_COLOURS.length);
    ok('mapping is by position, so identity survives a theme switch',
       Pr.profileColour(Pr.PROFILE_COLOURS[2], 'light') === Pr.PROFILE_COLOURS_LIGHT[2]);
    ok('dark theme returns the stored colour unchanged',
       Pr.profileColour(Pr.PROFILE_COLOURS[2], 'dark') === Pr.PROFILE_COLOURS[2]);
    ok('an unknown colour falls back rather than returning undefined',
       /^#[0-9a-f]{6}$/i.test(Pr.profileColour('#123456', 'light')));
    ok('the app maps through it', /const colourOf = \(p\) => profileColour\(p\.colour, S\.ui\.theme\)/.test(src));
  }

  section('Applying the optimiser is never invisible');
  /* Reported as "sometimes it doesn't update the live controls". It
   * always did — but four of the ten levers (backdoor Roth, the
   * conversion ladder, lot selection, withdrawal order) have no slider
   * at all, and the live ones sit across three collapsible groups, so a
   * change inside a collapsed group was correct behaviour that looked
   * like a failure. */
  {
    const { LIVE_GROUPS } = require('./controls.js');
    const S2 = window.__pfTest.state();
    Object.assign(S2.inputs, { currentAge: 40, retirementAge: 60, horizonYears: 50,
      stateCode: 'WA', salary: 20000000, annualExpenses: 7000000,
      retirementSpending: 8000000 });
    Object.assign(S2.inputs.balances, { cash: 3000000, trad401k: 20000000,
      roth401k: 7100000, rothIra: 1000000, hsa: 450000, brokerage: 13000000,
      brokerageBasis: 9000000 });
    S2.ui.openGroups = {};
    for (const g of LIVE_GROUPS) S2.ui.openGroups[g.id] = false;
    window.__pfTest.renderAll();
    await wait(60);

    get('#btnOptimise').fire('click');
    await wait(900);
    ok('the optimiser produced moves', !get('#optApply').disabled,
       'nothing to apply, so the rest of this section proves nothing');
    ok('and the button explains itself either way',
       typeof get('#optApply').title === 'string' && get('#optApply').title.length > 10,
       get('#optApply').title);

    get('#optApply').fire('click');
    await wait(300);

    const opened = Object.entries(S2.ui.openGroups).filter(([, v]) => v).map(([k]) => k);
    ok('groups holding a changed slider were opened', opened.length > 0,
       'all still collapsed: ' + JSON.stringify(S2.ui.openGroups));
    ok('groups with nothing changed stayed collapsed',
       opened.length < LIVE_GROUPS.length,
       'everything was opened, which defeats the point of grouping');

    const ap = get('#applied');
    ok('a summary is shown', !ap.classList.contains('hidden'));
    /* Whitespace-normalised: the template literal wraps mid-phrase, so
     * "live" and "controls" are separated by a newline in the markup and
     * a naive /live control/ cannot match. */
    const txt = (ap.innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    ok('it counts the sliders that moved', /live control/.test(txt), txt.slice(0, 120));
    ok('it names them', /After-tax 401\(k\)|Equity weight/.test(txt), txt.slice(0, 160));
    ok('and points at the settings page for levers with no slider',
       /Settings \u203a/.test(txt), txt.slice(0, 200));
    ok('it can be dismissed', /id="apDismiss"/.test(ap.innerHTML || ''));

    ok('the lever-to-page map covers every sliderless lever',
       ['backdoorRoth', 'rothConversionMode', 'lotSelectionMethod', 'withdrawalOrder']
         .every((k) => new RegExp(k + ':').test(src)),
       'a lever missing from LEVER_HOME changes silently');
  }

  section('Retirement age and the reported age are distinct, and say so');
  /* Reported as a sync bug: the live controls showed retirement age 49
   * while Settings showed 45 and the headline read 45. Both were
   * correct — they are different settings — but "Target age" was easily
   * read as "retirement age", and nothing on screen distinguished them.
   * Two fixes: the reported age now TRACKS retirement until pinned, and
   * every label says which is which. */
  {
    const T = window.__pfTest, St = T.state();
    St.targetFollowsRetirement = true;
    T.setControl('retirementAge', 49);
    await wait(400);
    ok('moving the retirement slider carries the reported age with it',
       St.targetAge === 49 && St.inputs.retirementAge === 49,
       `retire ${St.inputs.retirementAge}, target ${St.targetAge}`);
    /* Case-insensitive, and allowing the compare-mode prefix: while
     * profiles are pinned the label reads "<name> — net worth at age N". */
    ok('and the headline says which age it is',
       /net worth at age 49/i.test(get('#s0label').textContent || ''),
       get('#s0label').textContent);

    get('#btnSettings').fire('click');
    await wait(150);
    const f = document.querySelectorAll('[data-set]').find((n) => n.dataset.set === '__target');
    ok('the field exists on the Profile page', !!f);
    f.value = '45';
    f.fire('change');
    await wait(400);
    ok('typing a value pins it', St.targetFollowsRetirement === false);
    ok('and it takes effect', St.targetAge === 45, String(St.targetAge));

    T.setControl('retirementAge', 55);
    await wait(400);
    ok('once pinned, the retirement slider no longer moves it',
       St.targetAge === 45 && St.inputs.retirementAge === 55,
       `retire ${St.inputs.retirementAge}, target ${St.targetAge}`);
    ok('and Settings says plainly that the two differ',
       /Right now they differ/.test(get('#setBody').innerHTML || ''));
    ok('the field is no longer called "Target age"',
       /Report net worth at age/.test(src) && !/row\('Target age'/.test(src));
    ok('its hint states it is not the retirement age',
       /<b>This is not your retirement age<\/b>/.test(src));
    ok('and names the current retirement age',
       /currently <b>' \+ S\.inputs\.retirementAge \+ '<\/b>/.test(src));
    ok('the retirement slider hint points the other way too',
       /Separate from the age the headline figure reports/.test(
         require('fs').readFileSync(__dirname + '/controls.js', 'utf8')));

    /* The tracking flag must survive a reload, and an older save with
     * the two already diverged must not start moving the age. */
    ok('the flag is persisted', /targetFollowsRetirement: S\.targetFollowsRetirement/.test(src));
    ok('and inferred for saves made before it existed',
       /S\.targetFollowsRetirement = d\.targetAge === \(d\.inputs && d\.inputs\.retirementAge\)/
         .test(src),
       'otherwise a deliberately pinned age starts moving on upgrade');
    ok('one function owns the tracking', /function syncTargetAge\(changedKey\)/.test(src));
    ok('called from both the control path and the settings path',
       (src.match(/syncTargetAge\(/g) || []).length >= 3);
    get('#setClose').fire('click');
    await wait(60);
  }

  section('Theme toggles in one click and persists');
  {
    const before = JSON.parse(store['pf-forecaster-state-v3']).ui.theme;
    get('#btnTheme').fire('click');
    await wait(60);
    const after = JSON.parse(store['pf-forecaster-state-v3']).ui.theme;
    ok('the theme changed', before !== after, `${before} -> ${after}`);
    ok('and it was written to storage', ['dark', 'light'].includes(after));
    ok('the html attribute follows',
       (after === 'light') === (docAttrs['data-theme'] === 'light'),
       'data-theme=' + docAttrs['data-theme'] + ' for theme ' + after);
    get('#btnTheme').fire('click');
    await wait(60);
    ok('toggling back restores the original',
       JSON.parse(store['pf-forecaster-state-v3']).ui.theme === before);
  }

  section('Clicking the character reacts');
  ok('the stage is wired', /stage\.addEventListener\('click', pokeBay\)/.test(src));
  ok('pokeBay changes the pose', /pose: bayClicks \? avatarPose\(bayClicks - 1\)/.test(src));
  ok('and says something', /avatarLine\(c \? c\.attire : 'shirt', bayClicks - 1\)/.test(src));
  ok('the reaction decays back to idle', /bayClicks = 0; renderBay\(\)/.test(src));

  section('Audio is on by default and starts at the unlock');
  ok('cues default on', AudioKit.state.enabledCues === true);
  ok('music defaults on', AudioKit.state.enabledMusic === true);
  ok('the unlock is where audio is enabled',
     /AudioKit\.unlock\(\);[\s\S]{0,120}setMusic\(true\)/.test(src));

  console.log('\n' + '='.repeat(56));
  if (failed) console.log(fails.join('\n') + '\n');
  console.log(`${passed} passed, ${failed} failed`);
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
})();
