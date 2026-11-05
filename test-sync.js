/* ===================================================================
 * test-sync.js — ONE SOURCE OF TRUTH
 * Run with:  node test-sync.js
 *
 * Nineteen values appear in BOTH the live controls and the Settings
 * panel. They have always read the same `S.inputs` — there is only ever
 * one copy of a number — but the rendering was one-directional:
 * changing a Settings field refreshed the sliders, while dragging a
 * slider left an open Settings panel showing the old value. The same
 * number, visible twice, disagreeing.
 *
 * This enumerates the overlap from the two definitions rather than a
 * hand-written list, so a field added to either surface is covered
 * automatically, and asserts:
 *   - every shared key resolves on a real input set
 *   - both surfaces read through the same accessor
 *   - neither surface keeps its own copy of a value
 * =================================================================== */
'use strict';
const fs = require('fs');
for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js']) {
  Object.assign(global, require(m));
}
const { Money } = require('./money.js');
global.Money = Money;
const { LIVE } = require('./controls.js');
const { rowAtAge, simulate: sim } = require('./engine.js');

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);

const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

/* Every key the Settings panel binds, scraped from its own markup
 * helpers rather than listed by hand. */
const settingsKeys = new Set(
  [...app.matchAll(/(?:numF|rateF|togF|selF)\('([^']+)'/g)].map((m) => m[1])
    .concat([...app.matchAll(/data-set="([^"$]+)"/g)].map((m) => m[1]))
    .filter((k) => !k.startsWith('__')),
);
const liveKeys = LIVE.filter((c) => c.kind !== 'equity').map((c) => c.key);
const shared = liveKeys.filter((k) => settingsKeys.has(k));

section('The overlap is real and worth guarding');
ok('the live controls bind keys', liveKeys.length >= 20, liveKeys.length + ' keys');
ok('the settings panel binds keys', settingsKeys.size >= 30, settingsKeys.size + ' keys');
ok('a substantial set appears in both', shared.length >= 8,
   shared.length + ' shared: ' + shared.join(', '));

section('Every shared key resolves to one place in the inputs');
{
  const d = defaultInputs();
  for (const k of shared) {
    ok(`${k} resolves`, getPath(d, k) !== undefined, 'undefined on defaultInputs()');
  }
  /* Nothing may be stored twice. If a key appeared both at the top
   * level and nested, the two surfaces could bind different copies. */
  const dupes = shared.filter((k) => k.includes('.')
    && Object.prototype.hasOwnProperty.call(d, k.split('.').pop()));
  ok('no shared key exists as both a nested and a top-level field', !dupes.length,
     dupes.join(', '));
}

section('Both surfaces go through the same accessors');
ok('live controls read with ctlGet, which uses getPath',
   /const ctlGet = \(c\) => \(c\.kind === 'equity' \? readEquity\(S\.inputs\) : getPath\(S\.inputs, c\.key\)\)/.test(app));
ok('live controls write with ctlSet, which uses setPath',
   /function ctlSet\(c, v\)[\s\S]{0,260}setPath\(S\.inputs, c\.key, v\)/.test(app));
ok('settings write with the same setPath', /setPath\(S\.inputs, key, v\);/.test(app));
ok('settings read straight off S.inputs',
   /function settingsPage\(id\) \{\s*\n\s*const I = S\.inputs;/.test(app));
ok('neither surface caches a value of its own',
   !/let\s+(cachedInputs|settingsCopy|controlValues)\b/.test(app));

section('Rendering is two-directional');
ok('the settings panel is refreshed by the render pipeline',
   /\['settings panel', \(\) => refreshSettingsPanel\(\)\]/.test(app),
   'without this, dragging a slider leaves an open Settings panel stale');
ok('it only acts when the panel is open',
   /if \(!panel \|\| panel\.classList\.contains\('hidden'\)\) return;/.test(app));
ok('and never rewrites a field being typed into',
   /body\.contains\(ae\)\) return;/.test(app),
   'renderSettings replaces #setBody, destroying the caret');
ok('the live controls are refreshed by the same pipeline',
   /\['controls', \(\) => refreshControls\(\)\]/.test(app));

section('Settings fields respond while typing, like the sliders do');
ok('both input and change are bound',
   /n\.addEventListener\('input'/.test(app) && /n\.addEventListener\('change'/.test(app));
ok('typing is debounced rather than applied per keystroke',
   /typing = setTimeout\(\(\) => applySetting\(n, \{ rerender: false \}\), 400\)/.test(app),
   'applying every keystroke sends the chart through 2, 20, 200...');
ok('a half-typed value is ignored instead of clamped to a default',
   /if \(n\.tagName !== 'SELECT' && !Number\.isFinite\(v\)\) return;/.test(app));
ok('typing does not re-render the panel', /applySetting\(n, \{ rerender: false \}\)/.test(app));
ok('blur or Enter does', /applySetting\(n, \{ rerender: true \}\)/.test(app));
ok('one function serves both paths, so they cannot diverge',
   (app.match(/const applySetting = \(n, \{ rerender \}\) =>/g) || []).length === 1);

section('The equity control is a known proxy, and says so');
{
  /* readEquity reads ONE account's stock weight while writeEquity sets
   * them all. That is a deliberate simplification, not a sync bug, but
   * it is the one place the two surfaces could legitimately diverge. */
  ok('reading is from brokerage', /const readEquity = \(I\) => I\.allocations\?\.brokerage\?\.stocks/.test(app));
  ok('writing goes through one explicit account list',
     /const EQUITY_ACCOUNTS = \['trad401k', 'roth401k', 'tradIra', 'rothIra', 'hsa', 'brokerage'\]/
       .test(app),
     'derived from Object.keys would silently opt in new accounts');
  const d = defaultInputs();
  const m = app.match(/const EQUITY_ACCOUNTS = \[([^\]]+)\]/);
  const list = m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')) : [];
  ok('every account it writes has a stocks/bonds shape',
     list.every((k) => d.allocations[k] && typeof d.allocations[k].stocks === 'number'),
     list.filter((k) => !(d.allocations[k] || {}).stocks).join(', '));
  ok('single-asset buckets are left out',
     ['cash', 'commodities', 'crypto'].every((k) => !list.includes(k)));
  ok('the 529 is left out on purpose and the code says why',
     !list.includes('c529') && /funds an education on its own/.test(app));
  /* The labels must not promise more than the code does. */
  ok('the settings label no longer claims every investment account',
     !/Applied to every investment account/.test(app));
  ok('both labels name the same set',
     /401\(k\)s, IRAs, HSA and brokerage/.test(app)
     && /401\(k\)s, IRAs, HSA and brokerage/.test(
       fs.readFileSync(__dirname + '/controls.js', 'utf8')),
     'the slider hint and the settings hint describe different scopes');
  const uniform = new Set(Object.values(d.allocations)
    .filter((a) => typeof a.stocks === 'number').map((a) => a.stocks));
  ok('the defaults are NOT uniform, so reading one account is a real proxy',
     uniform.size > 1, 'weights: ' + [...uniform].join(', '));
}

section('"Net worth at age N" has exactly one implementation');
{
  const prof = fs.readFileSync(__dirname + '/profiles.js', 'utf8');
  const eng = fs.readFileSync(__dirname + '/engine.js', 'utf8');
  ok('the engine owns the rule', /function rowAtAge\(rows, age\)/.test(eng));
  ok('and exports it', /rowAtAge,/.test(eng));
  ok('the status strip calls it', /return run \? rowAtAge\(run\.rows, S\.targetAge\) : null;/.test(app));
  ok('the profile comparison calls it', /rowAtAge\(rows, profile\.targetAge\)/.test(prof));
  /* Nobody may re-implement the search. */
  const reimpl = [app, prof].filter((src) => /rows\.find\(\(r\) => r\.age >= [A-Za-z.]+\) \?\? /.test(src));
  ok('no file re-implements the search with ??', !reimpl.length);
  ok('the only fallback copy is profiles.js guarding a missing global',
     (prof.match(/r\.age >= profile\.targetAge/g) || []).length <= 1);

  /* Behaviour, not just wiring. */
  const rows = simulate(defaultInputs()).rows;
  ok('a target inside the horizon returns that year',
     rowAtAge(rows, 65).age === 65);
  ok('a target below the first row returns the FIRST row, not the last',
     rowAtAge(rows, 1).age === rows[0].age,
     'returned age ' + rowAtAge(rows, 1).age);
  ok('a target past the horizon returns the last row',
     rowAtAge(rows, 999).age === rows[rows.length - 1].age);
  ok('no rows returns null rather than throwing', rowAtAge([], 65) === null);
  ok('undefined rows returns null', rowAtAge(undefined, 65) === null);
}

section('Headline figures respond to a single slider step');
{
  /* The reported bug: the top-left figure never seemed to move. It was
   * formatted to one decimal, so net worth had to change by ~$100,000
   * before $6.6M became $6.7M — a slider notch moves far less. */
  ok('headline figures use two compact decimals',
     /M\.fmt\(c, \{ compact: true, compactDigits: 2 \}\)/.test(app),
     'one decimal cannot show a single step');
  ok('money.js accepts the digit count', /compactDigits = 1/.test(
     fs.readFileSync(__dirname + '/money.js', 'utf8')));
  const a = Money.fmt(656885237, { compact: true, compactDigits: 2 });
  const b = Money.fmt(657885237, { compact: true, compactDigits: 2 });
  ok('a $10,000 change is visible', a !== b, `${a} vs ${b}`);
  const c1 = Money.fmt(656885237, { compact: true });
  const c2 = Money.fmt(657885237, { compact: true });
  ok('and was NOT visible at one decimal, which is why this exists',
     c1 === c2, `${c1} vs ${c2}`);
  ok('axis labels keep the shorter form',
     /M\.fmt\(v \* 100, \{ compact: true \}\)/.test(app),
     'chart ticks should stay terse');
}

console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
