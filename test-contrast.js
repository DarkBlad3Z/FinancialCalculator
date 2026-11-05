/* ===================================================================
 * test-contrast.js — READABILITY, BOTH THEMES
 * Run with:  node test-contrast.js
 *
 * A user reported that the Gross salary figure was invisible in light
 * mode. The cause was `.ctl.focused { color: #fff }` — pure white on a
 * white panel, 1.00:1 — and because keyboard focus starts on control 0,
 * which is Gross salary, it happened on *every* light-mode load.
 *
 * An audit then found nine more of the same shape: the compliance text
 * in the disclaimer, character barks, the cheat-unlock explanation, the
 * message shown when the chart library fails, the sticky year column on
 * the retirement and depletion rows, the entry-gate input, the profile
 * name while renaming it, the Flow view's headline net line, and the
 * scrubber cursor on every chart.
 *
 * Every one of those would have been caught by arithmetic. So the
 * arithmetic is now a test: resolve each text colour against the
 * surface it actually sits on, in BOTH palettes, and apply WCAG 2.1
 * contrast minima — 4.5:1 for body text, 3:1 for large text.
 *
 * This cannot catch everything (it does not know every nesting), but it
 * catches the whole class that was reported.
 * =================================================================== */
'use strict';
const fs = require('fs');
const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);

/* ---------- colour maths (WCAG 2.1) ---------- */
function parse(c) {
  c = String(c).trim();
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)).concat(1);
  m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return null;
}
/* Composite a translucent colour over an opaque one. */
function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}
const lum = (rgb) => {
  const [r, g, b] = rgb.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function ratio(fgRaw, bgRaw) {
  const bg = parse(bgRaw);
  let fg = parse(fgRaw);
  if (!fg || !bg) return null;
  if (fg[3] < 1) fg = over(fg, bg);
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* self-check: the maths must agree with known values */
section('The contrast maths itself');
ok('black on white is 21:1', Math.abs(ratio('#000000', '#ffffff') - 21) < 0.01);
ok('white on white is 1:1', Math.abs(ratio('#ffffff', '#ffffff') - 1) < 0.001);
ok('#767676 on white is the canonical 4.54:1',
   Math.abs(ratio('#767676', '#ffffff') - 4.54) < 0.02,
   String(ratio('#767676', '#ffffff')));
ok('alpha is composited, not ignored',
   Math.abs(ratio('rgba(0,0,0,.5)', '#ffffff') - ratio('#808080', '#ffffff')) < 0.1);

/* ---------- read both palettes out of the stylesheet ---------- */
function vars(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
/* Locate the light palette by the declaration only it carries. There
 * are two `html[data-theme="light"] {` blocks — the palette, and a
 * smaller override inside `@media (prefers-contrast: more)` — and
 * indexOf found the wrong one, so the first run of this file tested the
 * high-contrast overrides against dark surfaces and reported twenty
 * failures that were not real. */
function blockContaining(marker) {
  const i = css.indexOf(marker);
  if (i < 0) return '';
  const open = css.lastIndexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', i));
}
const DARK = vars(css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing')));
const LIGHT = { ...DARK, ...vars(blockContaining('color-scheme: light')) };

const resolve = (pal, v) => {
  let s = String(v).trim();
  for (let i = 0; i < 5 && s.startsWith('var('); i++) {
    const name = s.slice(4, s.indexOf(')')).trim();
    s = String(pal[name] || '').replace(/\s*\/\*[\s\S]*?\*\//g, '').trim();
  }
  return s.replace(/\s*\/\*[\s\S]*?\*\//g, '').trim();
};

section('Both palettes parse');
ok('dark palette found', Object.keys(DARK).length > 12, Object.keys(DARK).length + ' vars');
ok('light palette found', Object.keys(LIGHT).length > 12);
ok('they differ', DARK['--txt'] !== LIGHT['--txt']);

/* ---------- the pairs that must be readable ----------
 * Text role -> the surface it sits on. Body unless marked large.
 */
const PAIRS = [
  ['--txt', '--panel', 'body text on a panel'],
  ['--txt', '--panel-solid', 'body text on a solid panel'],
  ['--txt', '--bg', 'body text on the page'],
  ['--txt', '--surface-2', 'body text on a status cell'],
  ['--txt', '--surface-pop', 'body text in a popover'],
  ['--txt', '--field-bg', 'what you type into a field'],
  ['--txt', '--row-retired', 'the year on the retirement row'],
  ['--txt', '--row-dry', 'the year on the depletion row'],
  ['--dim', '--panel', 'secondary text'],
  ['--dim', '--panel-solid', 'secondary text, solid panel'],
  ['--faint', '--panel-solid', 'the most-used label colour'],
  ['--faint', '--surface-head', 'table headers'],
  ['--cy', '--panel', 'the accent as text'],
  ['--cy', '--panel-solid', 'the accent on a solid panel'],
  ['--cy-dim', '--panel-solid', 'group headings'],
  ['--amb', '--panel-solid', 'state text'],
  ['--good', '--panel-solid', 'a funded verdict'],
  ['--bad', '--panel-solid', 'a failure verdict'],
  ['--bay-ink', '--plate', 'the operator bay status line'],
];

for (const [themeName, pal] of [['dark', DARK], ['light', LIGHT]]) {
  section(`Readable in ${themeName} mode`);
  for (const [fgv, bgv, what] of PAIRS) {
    const fg = resolve(pal, pal[fgv]);
    const bg = resolve(pal, pal[bgv]);
    const r = ratio(fg, bg);
    if (r === null) { ok(`${what} (${fgv} on ${bgv}) resolves`, false, `${fg} / ${bg}`); continue; }
    ok(`${what}: ${fgv} on ${bgv} ≥ 4.5:1`, r >= 4.5,
       `${r.toFixed(2)}:1  (${fg} on ${bg})`);
  }
}

/* ---------- no literal can hide in a rule ---------- */
section('No text colour is hard-coded outside the palettes');
{
  /* Comments are stripped first. The first run of this check flagged a
   * `#fff` that existed only inside a comment explaining the bug this
   * file was written for — a test reporting on its own documentation. */
  /* The light palette is located by the declaration only it carries,
   * not by indexOf on the selector — the first match of
   * `html[data-theme="light"] {` is the small override inside
   * `@media (prefers-contrast: more)`, so this scan used to stop at
   * line 563 of 1049 and never saw the profile bar or compare matrix
   * CSS at all. */
  const paletteAt = css.indexOf('color-scheme: light');
  const body = css.slice(css.indexOf('* { box-sizing: border-box; }'),
                         css.lastIndexOf('{', paletteAt))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const m of body.matchAll(/(^|[^-])color:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))/g)) {
    const val = m[2];
    /* Pure-white-at-low-opacity highlights inside the bay artwork are
     * genuinely theme-independent; a solid literal is not. */
    const p = parse(val);
    if (p && p[3] < 0.3) continue;
    bad.push(val);
  }
  ok('every `color:` reads from a variable', !bad.length,
     'literals: ' + [...new Set(bad)].join(', '));
}

section('Chart ink covers both themes with the same keys');
{
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const block = app.slice(app.indexOf('const INK = {'), app.indexOf('const themeInk ='));
  const keysOf = (name) => {
    const seg = block.slice(block.indexOf(name + ': {'));
    return [...seg.slice(0, seg.indexOf('},')).matchAll(/(\w+):\s*'/g)].map((m) => m[1]);
  };
  const l = keysOf('light'), d = keysOf('dark');
  ok('both themes are defined', l.length > 8 && d.length > 8, `${l.length} / ${d.length}`);
  ok('they define exactly the same keys', l.join() === d.join(),
     'light only: ' + l.filter((k) => !d.includes(k)).join(', ')
     + ' | dark only: ' + d.filter((k) => !l.includes(k)).join(', '));

  /* The marks are drawn as TEXT as well as lines, so they need reading
   * contrast, not the 3:1 a pure graphic would need. */
  const lightInk = Object.fromEntries([...block.slice(block.indexOf('light: {'))
    .slice(0, block.slice(block.indexOf('light: {')).indexOf('},'))
    .matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  for (const k of ['axis', 'legend', 'net', 'muted', 'retire', 'dry']) {
    const r = ratio(lightInk[k], '#ffffff');
    ok(`chart ${k} is readable on a white chart`, r !== null && r >= 4.5,
       `${k}=${lightInk[k]} -> ${r ? r.toFixed(2) : '?'}:1`);
  }

  /* Narrowly scoped on purpose, and named for what it actually checks.
   * The per-series palettes (SERIES, the tax categories, the flow
   * categories) are deliberately hard-coded mid-tones that read on both
   * themes; it is the THEME-DEPENDENT roles — axis, legend, grid,
   * markers, the net line — that must come from INK. The old assertion
   * was called "no chart colour is hard-coded outside INK", which
   * overclaimed by about twenty-five colours. */
  const chrome = app.slice(app.indexOf('function renderChart'),
                           app.indexOf('const COLS = ['));
  for (const role of [/borderColor: '#d9e6f5'/, /color: '#5b6e87'/,
                      /colour: '#ffa62b'/, /colour: '#fb7185'/,
                      /colour: 'rgba\(217,230,245/]) {
    ok(`no theme-dependent chart colour matching ${role.source}`,
       !role.test(chrome), (chrome.match(role) || [''])[0]);
  }
  ok('the per-series palettes are still literal, by design',
     /\['cash', 'Cash', '#/.test(app),
     'if this ever changes, the assertion above needs revisiting');
  ok('the SVG fallback takes its ink from the same place',
     /const ink = \(typeof themeInk === 'function'\)/.test(
       fs.readFileSync(__dirname + '/svg-chart.js', 'utf8')));
}

section('The reported bug, specifically');
{
  const r = rule('.ctl.focused .ctl-nm, .ctl.focused .ctl-vl');
  ok('the focused control no longer paints itself white', !/#fff/.test(r || ''), r);
  for (const [name, pal] of [['dark', DARK], ['light', LIGHT]]) {
    const m = (r || '').match(/color:\s*var\((--[a-z-]+)\)/);
    const v = m ? resolve(pal, pal[m[1]]) : null;
    const against = resolve(pal, pal['--panel-solid']);
    const x = v ? ratio(v, against) : null;
    ok(`the focused Gross salary figure is readable in ${name} mode`,
       x !== null && x >= 4.5, `${v} on ${against} -> ${x ? x.toFixed(2) : '?'}:1`);
  }
}
function rule(sel) {
  const i = css.indexOf(sel + ' {');
  return i < 0 ? null : css.slice(i + sel.length + 2, css.indexOf('}', i));
}

console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
