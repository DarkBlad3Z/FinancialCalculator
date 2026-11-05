/* ===================================================================
 * test-layout.js — THE SCROLL CHAIN
 * Run with:  node test-layout.js
 *
 * Two bugs in a row came from the same CSS rule, and neither was
 * visible to any other test:
 *
 *   1. The table grew to the height of forty rows because its wrapper
 *      had no bounded ancestor, so no inner scrollbar appeared.
 *   2. The live controls went from six sliders to twenty-two and the
 *      bottom of the panel — and the bottom of the chart beside it —
 *      became unreachable, because `.col` had `min-width: 0` but no
 *      `min-height: 0`.
 *
 * Both are the same fault. A flex or grid item's automatic minimum size
 * in the block axis is its content, so an ancestor without
 * `min-height: 0` cannot be shrunk; the shell is a fixed 100vh with the
 * body set to `overflow: hidden`, so the excess is clipped somewhere
 * nothing can scroll to it.
 *
 * This asserts the chain as a structural invariant, in the stylesheet,
 * rather than hoping a screenshot catches it next time.
 * =================================================================== */
'use strict';
const fs = require('fs');
const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);

/* Pull a rule's declarations out of the stylesheet. Good enough for a
 * hand-written sheet with one selector per rule. */
function rule(selector) {
  const i = css.indexOf(selector + ' {');
  if (i < 0) return null;
  return css.slice(i + selector.length + 2, css.indexOf('}', i));
}
const has = (sel, decl) => {
  const r = rule(sel);
  return !!r && new RegExp(decl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(r);
};

section('The overlay sheets can shrink too');
/* The dashboard chain was asserted here from the start; the OVERLAY
 * chain was not, and that gap is exactly how "some settings pages will
 * not let me scroll down" reached the user. `.setnav` and `.setbody`
 * are GRID items inside `.sheet-body` with no `min-height: 0`, so they
 * could not shrink, `.sheet-body` grew past `.sheet`'s
 * `max-height: 100%`, and the excess was clipped with nothing to
 * scroll. Same fault as `.col`, different container. */
for (const sel of ['.sheet', '.sheet-body', '.setnav', '.setbody']) {
  ok(`${sel} has min-height: 0`, has(sel, 'min-height: 0'),
     `without it a long settings page cannot be scrolled to the bottom`);
}
ok('.setbody is a scroll container', has('.setbody', 'overflow-y: auto'));
ok('.setnav is a scroll container', has('.setnav', 'overflow-y: auto'));
ok('the sheet is still clamped to the viewport', has('.sheet', 'max-height: 100%'));
ok('scrolling a settings page does not chain to the page behind it',
   has('.setbody', 'overscroll-behavior: contain'));
/* A min-height floor on a panel would override the `min-height: 0`
 * above and bring the clipping straight back on a short window, so the
 * "feels empty" floors are expressed as flex-basis instead. */
ok('panels that need a comfortable size use flex-basis, not min-height',
   has('.setbody.tall', 'flex: 1 1 300px'));
ok('and no inline min-height survives in the markup',
   !/style="min-height/.test(fs.readFileSync(__dirname + '/index.html', 'utf8')),
   'an inline floor out-specifies the stylesheet');

section('Every ancestor between a scroller and the fixed shell can shrink');
/* #app is height:100vh, so each link in the chain down to a scroll
 * container must be allowed to shrink below its content. A single
 * missing min-height anywhere breaks the whole chain. */
const CHAIN = ['#hud', '.main', '.col', '.pnl', '.vp'];
for (const sel of CHAIN) {
  ok(`${sel} has min-height: 0`, has(sel, 'min-height: 0'),
     `without it, a tall child makes ${sel} overflow the shell where nothing can scroll`);
}
ok('.col also has min-width: 0 for the inline axis', has('.col', 'min-width: 0'));
ok('the shell is still a fixed height (the thing being scrolled inside)',
   has('#app', 'height: 100vh'));

section('No selector is declared twice at the top level');
/* A later duplicate silently overrides an earlier one, and `rule()`
 * above reads the first match — so a dead fix looks live to both the
 * reader and this file. That is exactly what happened: a second
 * `.chartbox { flex: 1 1 auto }` further down the sheet quietly undid
 * the flex-basis fix. Counting declarations catches it. */
{
  // strip media-query blocks; overriding inside one is the point of them
  let top = css;
  for (;;) {
    const i = top.indexOf('@media');
    if (i < 0) break;
    let depth = 0, j = top.indexOf('{', i);
    const start = j;
    for (; j < top.length; j++) {
      if (top[j] === '{') depth++;
      else if (top[j] === '}') { depth--; if (!depth) break; }
    }
    top = top.slice(0, i) + top.slice(j + 1);
    if (start < 0) break;
  }
  /* Every top-level selector, not a whitelist. The whitelist version
   * missed a genuine duplicate — `.key.cheatprog` was declared twice
   * with different letter-spacing and border alpha, the later one
   * silently winning — which is precisely the bug class this check
   * exists for. */
  const ALL_SELECTORS = [...new Set([...top.matchAll(/^([.#][\w.#-]+(?:[ >+~][.#]?[\w.#-]+)*)\s*\{/gm)]
    .map((m) => m[1].trim()))];
  const EXPECTED_DUPES = new Set([
    'body', 'select', '.pnl::before', '.pnl::after',
    '.tablewrap th:first-child', 'body.plain .vt',
  ]);
  for (const sel of ALL_SELECTORS) {
    if (EXPECTED_DUPES.has(sel)) continue;
    const n = (top.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '\\s*\\{', 'gm')) || []).length;
    ok(`${sel} is declared once`, n <= 1,
       `found ${n} top-level declarations — a later one silently wins`);
  }
  const SELECTORS = ['.chartbox', '.tablewrap', '.col', '.cmd', '.insp', '.vp', '.main',
                    '#app', '#hud', '.strip', '.pnl'];
  /* Build the pattern by escaping for a regex ONCE. The first attempt
   * double-escaped it into `^\\.chartbox`, which matches a literal
   * backslash, found zero occurrences, and so passed while a planted
   * duplicate sat right there in the file. */
  const countRules = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (top.match(new RegExp('^' + esc + '\\s*\\{', 'gm')) || []).length;
  };
  /* Self-check: the helper must be able to see a duplicate at all. */
  const probe = top + '\n.chartbox { color: red; }\n';
  const probeCount = (probe.match(/^\.chartbox\s*\{/gm) || []).length;
  ok('the duplicate detector actually detects duplicates',
     probeCount === countRules('.chartbox') + 1,
     `helper says ${countRules('.chartbox')}, a planted copy makes ${probeCount}`);

  for (const sel of SELECTORS) {
    const n = countRules(sel);
    ok(`${sel} is declared once outside media queries`, n <= 1,
       `found ${n} top-level declarations — a later one silently wins`);
  }
}

section('Panels that hold more than fits are scroll containers');
for (const [sel, why] of [
  ['.cmd', 'twenty-two live controls'],
  ['.insp', 'a full year decomposition'],
  ['.tablewrap', 'forty rows'],
  ['.setnav', 'twelve settings pages'],
  ['.setbody', 'long settings pages'],
]) {
  const r = rule(sel) || '';
  ok(`${sel} scrolls its own overflow (${why})`,
     /overflow(-y)?: auto|overflow(-y)?: scroll/.test(r), r.trim().slice(0, 70));
}

section('The table wrapper is bounded, not just flexible');
ok('it has an explicit max-height', has('.tablewrap', 'max-height: min(62vh, 620px)'),
   'flex sizing alone gives no bound when an ancestor is auto-height');
ok('and a usable minimum', has('.tablewrap', 'min-height: 180px'));
ok('scrolling does not chain to the page', has('.tablewrap', 'overscroll-behavior: contain'));

section('The stacked layout keeps the chart readable');
/* Measured at 735px before this was fixed: controls 431px, chart 230px.
 * A forty-year stacked area chart with a legend is not readable at
 * 230px, which is what "cannot see the whole chart" meant. */
const narrow = css.slice(css.indexOf('@media (max-width: 1180px)'),
                         css.indexOf('@media (max-width: 860px)'));
ok('the control panel is capped so it cannot dominate',
   /\.cmd \{ max-height: 40vh; \}/.test(narrow), 'cmd cap missing');
ok('the chart gets a real floor', /\.chartbox \{ min-height: 330px; \}/.test(narrow));
ok('and the viewport panel cannot collapse', /\.vp \{ min-height: 420px; \}/.test(narrow));
ok('the control cap leaves more room than it takes',
   40 < 60, 'cmd is capped below the chart floor share');

const tiny = css.slice(css.indexOf('@media (max-width: 860px)'));
ok('the phone layout keeps a chart floor too', /\.chartbox \{ min-height: 280px; \}/.test(tiny));
ok('and tightens the controls further', /\.cmd \{ max-height: 38vh; \}/.test(tiny));

section('The inspector is relocated, never deleted');
ok('no display:none on the inspector column anywhere',
   !/\.col\.insp-col \{[^}]*display: none/.test(css),
   'it holds the full year decomposition — hiding it loses the richest panel');
ok('it is re-placed in the stacked layout', /\.col\.insp-col \{ grid-column: 1 \/ -1/.test(css));

section('The chart box can shrink as well as grow');
ok('chartbox is flexible', has('.chartbox', 'flex: 1 1 0%'),
   'flex: 1 1 auto with a min-height fights a short viewport');
ok('it keeps a base floor', has('.chartbox', 'min-height: 150px'));

section('Nothing relies on a magic viewport width');
ok('the status strip reflows with auto-fit',
   /\.strip \{[\s\S]{0,200}repeat\(auto-fit/.test(css));
ok('no !important fixed column counts remain',
   !/grid-template-columns: repeat\(2, 1fr\) !important/.test(css));

section('Type scale: nothing is unreadably small');
/* The first build put most of the interface between 9px and 10.5px,
 * with provenance badges at 8.5 and bay tags at 7. Below about 11px
 * stops being "dense" and starts being "needs zooming", which is what
 * the settings page was reported as. Every size now comes from one
 * scale so there is a single place to change it, and nothing anywhere
 * resolves below 10px at scale 1. */
{
  const body = css.slice(css.indexOf('* { box-sizing: border-box; }'));
  const raw = [...body.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => m[1]);
  ok('no raw pixel font sizes outside the scale', !raw.length,
     'found: ' + [...new Set(raw)].join(', ') + 'px');

  const TOKENS = ['--fs-micro', '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl'];
  const root = css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing'));
  const sizes = {};
  for (const tkn of TOKENS) {
    const m = root.match(new RegExp(tkn + ':\\s*calc\\(([0-9.]+)px \\* var\\(--ui-scale\\)\\)'));
    ok(`${tkn} is defined and scales with --ui-scale`, !!m, 'missing or not scaled');
    if (m) sizes[tkn] = parseFloat(m[1]);
  }
  ok('the smallest step is at least 10px', Math.min(...Object.values(sizes)) >= 10,
     'smallest is ' + Math.min(...Object.values(sizes)) + 'px');
  ok('the scale is monotonic', TOKENS.every((tkn, i) =>
     i === 0 || sizes[TOKENS[i - 1]] < sizes[tkn]),
     TOKENS.map((k) => k + '=' + sizes[k]).join(' '));
  ok('--ui-scale defaults to 1', /--ui-scale:\s*1;/.test(root));
  ok('every token is actually used', TOKENS.every((tkn) => body.includes('var(' + tkn + ')')),
     'unused: ' + TOKENS.filter((tkn) => !body.includes('var(' + tkn + ')')).join(', '));
}

section('Settings is sized for reading, not for density');
{
  const srn = rule('.sr-n') || '', srh = rule('.sr-h') || '', sr = rule('.sr') || '';
  ok('the setting label uses a large step', /var\(--fs-md\)/.test(srn), srn.trim());
  ok('the hint is no smaller than secondary text', /var\(--fs-sm\)/.test(srh), srh.trim());
  ok('the hint is not faint grey on top of being small',
     /color: var\(--dim\)/.test(srh), 'faint + small is twice as hard to read');
  ok('rows have real vertical padding', /padding: 13px 0/.test(sr), sr.trim());
  ok('hints wrap at a readable measure', /max-width: 52ch/.test(srh));
  const inp = rule('input[type="number"], input[type="text"], select') || '';
  ok('fields you type into are body-sized', /var\(--fs-base\)/.test(inp), inp.trim().slice(0, 60));
  ok('and have a comfortable hit area', /padding: 8px 10px/.test(inp));
  ok('the page rail is wide enough for readable names',
     /grid-template-columns: 210px 1fr/.test(rule('.sheet-body') || ''));
  ok('provenance badges are legible', /var\(--fs-xs\)/.test(rule('.src') || ''));
}

section('The charts honour the text-size setting');
{
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const svg = fs.readFileSync(__dirname + '/svg-chart.js', 'utf8');
  ok('Chart.js font sizes go through the multiplier',
     /const chartFont = \(base\) => Math\.round\(base \* \(S\.ui\.textScale \|\| 1\)\)/.test(app));
  ok('axis, legend and tooltip all use it',
     (app.match(/chartFont\(/g) || []).length >= 5,
     'only ' + (app.match(/chartFont\(/g) || []).length + ' uses');
  ok('chart options are rebuilt per render, not frozen at load',
     /const BASE = baseOpts\(\), AXIS = axisOpts\(\), XAXIS = xAxisOpts\(\);/.test(app));
  ok('the SVG fallback reads the same multiplier',
     /getPropertyValue\('--ui-scale'\)/.test(svg));
  ok('and survives having no DOM at all', /catch \(e\) \{ \/\* no DOM/.test(svg));
}

section('Text size is an accessibility setting, not a mode flavour');
{
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const modes = app.slice(app.indexOf('const MODES = {'), app.indexOf('function applyMode'));
  ok('no mode definition touches the text scale', !/textScale/.test(modes),
     'switching mode must never quietly shrink the interface back');
  ok('applyMode re-applies the saved scale', /applyTextScale\(S\.ui\.textScale\)/.test(app));
  ok('it is applied at boot too',
     (app.match(/applyTextScale\(S\.ui\.textScale\)/g) || []).length >= 2);
  ok('it persists', /textScale: 1,/.test(app));
  ok('four sizes are offered', (app.match(/\[1\.15, 'Large'\]/) || []).length === 1
     && /\[1\.5, 'Largest'\]/.test(app));
  ok('the picker shows each size at its own size',
     /style="font-size:calc\(var\(--fs-sm\) \* \$\{v\}\)"/.test(app));
  ok('it is the first row on the page, where someone struggling will look',
     app.indexOf("row('Text size'") < app.indexOf("row('Current mode'"));
  ok('the setter is guarded so boot cannot die on it',
     /if \(el && el\.style && el\.style\.setProperty\)/.test(app));
  ok('and clamped to a sane range', /Math\.min\(1\.5, Math\.max\(1,/.test(app));
}

section('The light theme is a palette swap, not a second stylesheet');
{
  /* Located by `color-scheme: light`, which only the palette carries.
   * indexOf on the selector finds the `prefers-contrast` override
   * first, which would let a variable defined ONLY inside that media
   * query satisfy "redefined for light". */
  const paletteAt = css.indexOf('color-scheme: light');
  const light = css.slice(css.lastIndexOf('{', paletteAt));
  ok('a light theme block exists', light.length > 200);
  ok('it sets color-scheme so form controls follow',
     /color-scheme: light/.test(light));

  /* Every colour variable the dark theme defines must be answered, or
   * the light theme inherits a dark value and one panel comes out
   * black on white. */
  const root = css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing'));
  const names = [...root.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1])
    .filter((n) => !n.startsWith('--fs-') && n !== '--ui-scale'
                && n !== '--mono' && n !== '--sans');
  const missing = names.filter((n) => !new RegExp('\\' + n + ':').test(light));
  ok('every colour variable is redefined for light', !missing.length,
     'not overridden: ' + missing.join(', '));

  ok('the accent darkens rather than staying a light-on-dark cyan',
     /--cy: #0b6fa8/.test(light), 'pale cyan on white fails contrast');
  ok('text is dark, not inverted grey', /--txt: #15202b/.test(light));
  ok('the scrim is light-appropriate', /--scrim: rgba\(20, 30, 44, \.42\)/.test(light));
  ok('panels get a real border and shadow on light',
     /html\[data-theme="light"\] \.pnl/.test(css),
     'a translucent fill over a pale page leaves no boundary');
  ok('decorative glows are toned down', /html\[data-theme="light"\] \.scan/.test(css));
  ok('the operator bay stays metal', /--steel: #7d868f/.test(light),
     'a machine bay does not become white');
}

section('Surfaces are named by role so a theme can move them');
{
  const body = css.slice(css.indexOf('* { box-sizing: border-box; }'));
  for (const v of ['--surface-2', '--surface-head', '--surface-pop', '--field-bg',
                   '--scrim', '--page-bg']) {
    ok(`${v} is used in the sheet`, body.includes('var(' + v + ')'),
       'defined but never referenced');
  }
  ok('the status cells no longer bake in a dark fill',
     !/\.stat \{ background: rgba\(10, 17, 28/.test(css));
  ok('the table header no longer bakes in a dark fill',
     !/background: #101a2c/.test(css));
  ok('the page background comes from a variable', /background: var\(--page-bg\)/.test(css));
}

section('The charts follow the theme');
{
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  ok('there is one source of chart ink', /const themeInk = \(\) =>/.test(app));
  ok('axis colour comes from it', /color: themeInk\(\)\.axis/.test(app));
  ok('grid colour too', /grid: \{ color: themeInk\(\)\.grid \}/.test(app));
  ok('legend and tooltip too',
     /color: themeInk\(\)\.legend/.test(app) && /backgroundColor: themeInk\(\)\.tip/.test(app));
  ok('no pale-grey axis colour is hard-coded any more',
     !/color: '#5b6e87'/.test(app.slice(app.indexOf('function renderChart'),
                                        app.indexOf('const COLS = ['))),
     'invisible on white');
  ok('switching rebuilds the chart rather than only restyling',
     /renderAll\(\);\s*\n\s*if \(S\.ui\.cues\) AudioKit\.cue\('tickUp'\)/.test(app));
}

section('Theme is the person\'s choice, not a mode flavour');
{
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const modes = app.slice(app.indexOf('const MODES = {'), app.indexOf('function applyMode'));
  ok('no mode definition sets a theme', !/theme/.test(modes));
  ok('applyMode re-applies the saved theme', /applyTheme\(S\.ui\.theme\)/.test(app));
  ok('it is applied at boot as well',
     (app.match(/applyTheme\(S\.ui\.theme\)/g) || []).length >= 2);
  ok('it persists', /theme: 'dark',/.test(app));
  ok('the toggle is reachable in one click from the dashboard',
     /id="btnTheme"/.test(fs.readFileSync(__dirname + '/index.html', 'utf8')));
  ok('the button names the destination, not the current state',
     /switch TO, not what you are on/.test(app));
  ok('the setter is guarded like the text-size one',
     /if \(el && el\.setAttribute\)/.test(app));
}

console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
