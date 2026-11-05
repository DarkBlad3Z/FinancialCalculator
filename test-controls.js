/* ===================================================================
 * test-controls.js — EVERY LEVER MUST MOVE SOMETHING
 * Run with:  node test-controls.js
 *
 * The point of adding controls is that pulling them changes the
 * forecast. A slider wired to a key the engine ignores, or clamped to a
 * range where nothing happens, is worse than no slider: it looks like
 * it works. So each control is read out of app.js, applied to a real
 * input set at both ends of its range, and the resulting net worth
 * compared.
 *
 * It also checks the things that break quietly: dotted paths that do
 * not resolve, ranges that exclude the default value, and steps that
 * cannot reach the maximum.
 * =================================================================== */
'use strict';
const fs = require('fs');
for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js']) {
  Object.assign(global, require(m));
}
const { Money } = require('./money.js');
global.Money = Money;

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);

/* The table is imported, not scraped. An earlier version of this file
 * parsed definitions out of app.js with regular expressions, which
 * would have read a `max` expressed as a function as NaN and quietly
 * tested nothing. */
const { LIVE_GROUPS, LIVE, controlMax } = require('./controls.js');
const GROUPS = LIVE_GROUPS;
const ALL = LIVE;
const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
const CFG = getTaxConfig(2026, 0);
const topOf = (c, I) => controlMax(c, I, CFG);

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); const last = ks.pop();
  ks.reduce((x, k) => (x[k] = x[k] ?? {}), o)[last] = v;
}
const readEquity = (I) => I.allocations?.brokerage?.stocks ?? 85;
function writeEquity(I, v) {
  for (const k of Object.keys(I.allocations)) {
    I.allocations[k] = { stocks: v, bonds: 100 - v };
  }
}
const nw = (I) => simulate(I).rows[I.horizonYears - 1].netWorth;

section('The control table parsed');
ok('four groups found', GROUPS.length === 4, GROUPS.map((g) => g.id).join(', '));
ok('22 controls found', ALL.length === 22, 'got ' + ALL.length);
ok('the flat list matches the groups',
   ALL.length === GROUPS.reduce((n, g) => n + g.controls.length, 0));
ok('every control has a label', ALL.every((c) => c.label && c.label.length > 2));
ok('no duplicate keys', new Set(ALL.map((c) => c.key)).size === ALL.length,
   'dupes: ' + ALL.map((c) => c.key).filter((k, i, a) => a.indexOf(k) !== i).join(', '));

section('Every key resolves against a real input set');
{
  const d = defaultInputs();
  const bad = ALL.filter((c) => c.kind !== 'equity' && getPath(d, c.key) === undefined);
  ok('no control points at a key the engine does not have', !bad.length,
     'unresolved: ' + bad.map((c) => c.key).join(', '));
  const nested = ALL.filter((c) => c.key.includes('.'));
  ok('dotted paths are actually used', nested.length >= 3,
     'nested: ' + nested.map((c) => c.key).join(', '));
  ok('and every one of them resolves',
     nested.every((c) => getPath(d, c.key) !== undefined));
}

section('Ranges contain the default and are reachable by step');
for (const c of ALL) {
  const d = defaultInputs();
  const cur = c.kind === 'equity' ? readEquity(d) : getPath(d, c.key);
  const top = topOf(c, d);
  ok(`${c.label}: default ${cur} is inside [${c.min}, ${top}]`,
     cur >= c.min && cur <= top, `default ${cur}, top ${top}`);
  ok(`${c.label}: at least 4 stops`, (top - c.min) / c.step >= 4,
     `${((top - c.min) / c.step).toFixed(1)} stops`);
}

section('EVERY lever changes the forecast');
/* A base with enough going on that retirement-side levers bite: it
 * retires early, so conversions and Social Security timing matter. */
function base() {
  const I = defaultInputs();
  I.retirementAge = 55;
  I.horizonYears = 45;
  I.balances.trad401k = 60_000_000;
  I.balances.brokerage = 40_000_000;
  I.balances.cash = 5_000_000;
  return I;
}
const baseline = nw(base());
for (const c of ALL) {
  const lo = base(), hi = base();
  const top = topOf(c, hi);
  if (c.kind === 'equity') { writeEquity(lo, c.min); writeEquity(hi, top); }
  else {
    setPath(lo, c.key, c.min);
    setPath(hi, c.key, top);
    // mirror the control's `pre` side effects
    if (c.key === 'contrib401kDollar') { lo.contrib401kMode = 'dollar'; hi.contrib401kMode = 'dollar'; }
    if (c.key === 'afterTax401kAmount') { lo.afterTax401kEnabled = false; hi.afterTax401kEnabled = true; }
    if (c.key === 'rothConversionAmount') { hi.rothConversionMode = 'fixed'; }
  }
  let a, b;
  try { a = nw(lo); b = nw(hi); } catch (e) { ok(`${c.label} runs`, false, e.message); continue; }
  ok(`${c.label}: moves net worth between its extremes`, a !== b,
     `min -> ${Money.fmt(a)}, max -> ${Money.fmt(b)} (identical)`);
  ok(`${c.label}: both ends produce a usable result`,
     Number.isInteger(a) && Number.isInteger(b) && isFinite(a) && isFinite(b),
     `${a} / ${b}`);
}

section('A single step is noticeable, not lost in rounding');
/* A slider whose smallest move changes nothing feels broken. */
for (const c of ALL) {
  const I = base();
  const cur = c.kind === 'equity' ? readEquity(I) : getPath(I, c.key);
  const target = Math.min(topOf(c, I), cur + c.step);
  if (target === cur) { passed++; continue; }     // already at the top
  const J = base();
  if (c.kind === 'equity') writeEquity(J, target); else setPath(J, c.key, target);
  if (c.key === 'rothConversionAmount') J.rothConversionMode = 'fixed';
  if (c.key === 'afterTax401kAmount') J.afterTax401kEnabled = target > 0;
  ok(`${c.label}: one step changes the result`, nw(J) !== baseline,
     'one step of ' + c.step + ' produced no change at all');
}

section('No slider has a dead zone at the top');
/* A contribution slider whose maximum exceeds the statutory cap looks
 * live for its whole length and does nothing above the cap. That was
 * true of the 401(k) deferral, Roth IRA and HSA sliders. */
for (const c of ALL) {
  if (c.kind !== 'money') { passed++; continue; }
  const I = base();
  const top = topOf(c, I);
  const nearTop = Math.max(c.min, top - c.step);
  if (nearTop === top) { passed++; continue; }
  const A = base(), B = base();
  setPath(A, c.key, nearTop);
  setPath(B, c.key, top);
  for (const X of [A, B]) {
    if (c.key === 'contrib401kDollar') X.contrib401kMode = 'dollar';
    if (c.key === 'afterTax401kAmount') X.afterTax401kEnabled = getPath(X, c.key) > 0;
    if (c.key === 'rothConversionAmount') X.rothConversionMode = 'fixed';
  }
  /* Identical answers are only a dead slider if the plan is still
   * alive. Once spending has bankrupted it, net worth is zero at every
   * higher value — that is the model being right, not the control being
   * broken, so the plans are checked for depletion before blaming the
   * slider. */
  const ra = simulate(A), rb = simulate(B);
  const bothDead = ra.summary.depleted && rb.summary.depleted;
  ok(`${c.label}: the last step of the track still does something`,
     ra.rows[A.horizonYears - 1].netWorth !== rb.rows[B.horizonYears - 1].netWorth || bothDead,
     `${Money.fmt(nearTop)} and ${Money.fmt(top)} give the same answer, `
     + 'and the plan is not depleted — the top of this slider is dead');
}

section('Caps follow the statute, not a hard-coded number');
{
  const young = defaultInputs(); young.currentAge = 40;
  const older = defaultInputs(); older.currentAge = 55;
  const def = ALL.find((c) => c.key === 'contrib401kDollar');
  ok('the 401(k) slider stops at the deferral cap',
     topOf(def, young) === max401kDeferral(40, CFG),
     `${topOf(def, young)} vs ${max401kDeferral(40, CFG)}`);
  ok('and the cap rises with catch-up age',
     topOf(def, older) > topOf(def, young),
     `${topOf(def, older)} at 55 vs ${topOf(def, young)} at 40`);
  const hsa = ALL.find((c) => c.key === 'contribHsa');
  const fam = defaultInputs(); fam.hsaCoverage = 'family';
  ok('the HSA slider follows the coverage type',
     topOf(hsa, fam) > topOf(hsa, young),
     `family ${topOf(hsa, fam)} vs self ${topOf(hsa, young)}`);
  ok('a function max that returns nonsense still yields a usable range',
     controlMax({ min: 0, step: 5, max: () => NaN }, young, CFG) === 5);
}

section('Extremes cannot break the engine');
{
  const I = base();
  for (const c of ALL) {
    if (c.kind === 'equity') writeEquity(I, topOf(c, I));
    else setPath(I, c.key, topOf(c, I));
  }
  I.rothConversionMode = 'fixed';
  I.afterTax401kEnabled = true;
  let out = null, err = null;
  try { out = simulate(I); } catch (e) { err = e; }
  ok('all sliders at max still runs', !err, err ? err.message : '');
  if (out) {
    ok('every row is cent-integral', out.rows.every((r) => Number.isInteger(r.netWorth)));
    ok('no NaN leaked in', out.rows.every((r) => isFinite(r.netWorth)));
  }
  const Z = base();
  for (const c of ALL) {
    if (c.kind === 'equity') writeEquity(Z, c.min);
    else setPath(Z, c.key, c.min);
  }
  let outZ = null, errZ = null;
  try { outZ = simulate(Z); } catch (e) { errZ = e; }
  ok('all sliders at min still runs', !errZ, errZ ? errZ.message : '');
  if (outZ) {
    ok('still cent-integral', outZ.rows.every((r) => Number.isInteger(r.netWorth)));
  }
}

section('Keyboard reach');
ok('digits cover the first nine only', /e\.key >= '1' && e\.key <= '9'/.test(src));
ok('[ and ] walk the full list', /e\.key === '\]'/.test(src) && /e\.key === '\['/.test(src));
ok('focusing inside a collapsed group opens it', /function revealGroupFor/.test(src));
ok('nudge clamps to the resolved range',
   /Math\.min\(cmax, Math\.max\(c\.min,/.test(src));
ok('the range is refreshed, not only set at build time',
   /input\.max = controlMax\(/.test(src));
ok('the flat list is derived from the groups, not hand-maintained',
   /const LIVE = LIVE_GROUPS\.flatMap/.test(
     fs.readFileSync(__dirname + '/controls.js', 'utf8')));
ok('and app.js no longer defines the table itself',
   !/const LIVE_GROUPS = \[/.test(src));
ok('open groups persist', /openGroups/.test(src));

console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
