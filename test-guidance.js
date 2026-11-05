/* ===================================================================
 * test-guidance.js — "WHAT DO I DO THIS YEAR?"
 * Run with:  node test-guidance.js
 *
 * The year inspector described what happened. This module answers what
 * to do, which means it is making claims a user may act on — so the
 * assertions here are about the claims being TRUE, not merely present:
 * that the moves match what the engine actually did, that bracket
 * headroom lands on a real bracket boundary, and that the 0% capital
 * gains room shrinks as ordinary income fills those bands first.
 * =================================================================== */
'use strict';
for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js']) {
  Object.assign(global, require(m));
}
const { Money } = require('./money.js');
global.Money = Money;
const G = require('./guidance.js');

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);
const D = (c) => Money.fmt(c);
const CFG = getTaxConfig(2026, 0);

function retiree(over = {}) {
  return { ...defaultInputs(), currentAge: 40, retirementAge: 55, horizonYears: 45,
    balances: { ...defaultInputs().balances, trad401k: 60_000_000, brokerage: 40_000_000,
                cash: 5_000_000, rothIra: 10_000_000 }, ...over };
}

section('Bracket headroom lands on a real boundary');
{
  const bands = CFG.ordinaryBrackets.single;
  for (const b of bands) {
    if (b.upTo === null) continue;
    /* One cent below a boundary: the room must be exactly one cent and
     * the rate must be that band's. */
    const h = G.bracketHeadroom(b.upTo - 1, 'single', CFG);
    ok(`just under ${D(b.upTo)}: rate is ${(b.rate * 100)}%`, h.rate === b.rate,
       `got ${h.rate * 100}%`);
    ok(`just under ${D(b.upTo)}: room is 1 cent`, h.room === 1, `got ${h.room}`);
    /* One cent above: it must have moved to the next band. */
    const next = G.bracketHeadroom(b.upTo + 1, 'single', CFG);
    ok(`just over ${D(b.upTo)}: moved to the next band`, next.rate > b.rate,
       `${b.rate * 100}% -> ${next.rate * 100}%`);
    /* The boundary ITSELF, which neither neighbour probes. At taxable
     * income exactly equal to a bracket top, the next dollar is taxed at
     * the NEXT rate — so the comparison must be `<`, not `<=`. A `<=`
     * would report 0 room in the band you have already filled, which
     * reads as "no conversion room" when there is a whole band of it. */
    const at = G.bracketHeadroom(b.upTo, 'single', CFG);
    ok(`exactly at ${D(b.upTo)}: the next dollar is in the higher band`,
       at.rate > b.rate, `reported ${at.rate * 100}% with room ${at.room}`);
  }
  const top = G.bracketHeadroom(100_000_000_00, 'single', CFG);
  ok('the top band reports no room rather than a number', top.room === null);
  ok('and still reports its rate', top.rate === bands[bands.length - 1].rate);
  ok('zero income sits in the lowest band',
     G.bracketHeadroom(0, 'single', CFG).rate === bands[0].rate);
  ok('filing status is honoured',
     G.bracketHeadroom(300_000_0, 'mfj', CFG).room
     !== G.bracketHeadroom(300_000_0, 'single', CFG).room);
  ok('an unknown filing status falls back rather than throwing',
     G.bracketHeadroom(0, 'nonsense', CFG).rate === bands[0].rate);
}

section('0% capital-gains room shrinks as ordinary income fills the band');
{
  const zeroTop = CFG.ltcgBrackets.single.find((b) => b.rate === 0).upTo;
  ok('with no other income, the whole 0% band is available',
     G.zeroRateGainRoom(0, 'single', CFG) === zeroTop, D(G.zeroRateGainRoom(0, 'single', CFG)));
  ok('half-filled leaves half', G.zeroRateGainRoom(zeroTop / 2, 'single', CFG) === zeroTop / 2);
  ok('at the top it leaves nothing', G.zeroRateGainRoom(zeroTop, 'single', CFG) === 0);
  ok('above the top it does not go negative',
     G.zeroRateGainRoom(zeroTop * 3, 'single', CFG) === 0);
  ok('it is monotonic in income', (() => {
    let prev = Infinity;
    for (let i = 0; i <= zeroTop; i += zeroTop / 20) {
      const v = G.zeroRateGainRoom(i, 'single', CFG);
      if (v > prev) return false;
      prev = v;
    }
    return true;
  })(), 'more ordinary income must never increase the tax-free gain room');
}

section('The moves match what the engine actually did');
{
  const I = retiree();
  const run = simulate(I);
  let checked = 0;
  for (const row of run.rows) {
    const g = G.yearGuidance(row, I, getTaxConfig(row.year, 0));
    const summed = g.actions.reduce((n, a) => n + a.amount, 0);
    const engineTotal = row.withdrawals.total || 0;
    if (engineTotal === 0) {
      ok(`${row.year}: no withdrawals means no moves`, g.actions.length === 0,
         g.actions.map((a) => a.label).join(', '));
      continue;
    }
    checked++;
    ok(`${row.year}: the moves add up to what was withdrawn`, summed === engineTotal,
       `${D(summed)} vs ${D(engineTotal)}`);
    ok(`${row.year}: every move names a real account`,
       g.actions.every((a) => G.ACCOUNT_LABELS[a.account]));
    ok(`${row.year}: every move explains its tax cost`,
       g.actions.every((a) => typeof a.cost === 'string' && a.cost.length > 8));
  }
  ok('there were withdrawal years to check', checked > 5, checked + ' years');
}

section('Moves are ordered largest first, so the big decision is on top');
{
  /* A year that spills across accounts needs the first account in the
   * order to be too small to cover the spending on its own — otherwise
   * the engine satisfies everything from one and the ordering claim is
   * never exercised. */
  const I = retiree({
    retirementAge: 50, currentAge: 49, retirementSpending: 18_000_000,
    withdrawalOrder: ['cash', 'brokerage', 'trad401k', 'tradIra',
                      'roth401k', 'rothIra', 'hsa'],
    balances: { ...defaultInputs().balances,
      cash: 1_500_000, brokerage: 6_000_000, trad401k: 90_000_000, rothIra: 10_000_000 },
    sweep: { ...defaultInputs().sweep, enabled: false },
  });
  const run = simulate(I);
  let multi = 0;
  for (const row of run.rows) {
    const a = G.yearGuidance(row, I, getTaxConfig(row.year, 0)).actions;
    if (a.length < 2) continue;
    multi++;
    ok(`${row.year}: descending by amount`,
       a.every((x, i) => i === 0 || a[i - 1].amount >= x.amount),
       a.map((x) => D(x.amount)).join(' > '));
  }
  ok('at least one year drew on more than one account', multi > 0, multi + ' such years');
}

section('Flags fire on the things that actually bite');
{
  /* An early retiree reaching into a 401(k) before 59½ must be warned
   * about the penalty, because that is a decision they can still change. */
  const early = { ...retiree({ retirementAge: 45, currentAge: 44 }),
    withdrawalOrder: ['cash', 'trad401k', 'tradIra', 'brokerage', 'roth401k', 'rothIra', 'hsa'],
    balances: { ...defaultInputs().balances, trad401k: 80_000_000, cash: 2_000_000 } };
  const run = simulate(early);
  const penaltyYear = run.rows.find((r) => (r.withdrawals.penaltyBase || 0) > 0);
  ok('a pre-59½ withdrawal happens in this scenario', !!penaltyYear,
     'scenario did not produce one, so the flag is untested');
  if (penaltyYear) {
    const f = G.yearGuidance(penaltyYear, early, getTaxConfig(penaltyYear.year, 0)).flags;
    const pen = f.find((x) => /before 59/.test(x.text));
    ok('the penalty is flagged', !!pen,
       'flags present: ' + (f.map((x) => x.text.slice(0, 30)).join(' | ') || 'none'));
    /* Guarded. `f.find(...).kind` throws when the flag is missing, which
     * aborts the whole file instead of reporting a failure — the suite
     * then looks like it crashed rather than caught something. */
    ok('and flagged as bad, not informational', !!pen && pen.kind === 'bad',
       pen ? pen.kind : 'no flag to classify');
    ok('it names a way out', f.some((x) => /conversion ladder/.test(x.text)));
  }

  /* An RMD is not optional, so it must appear whenever one is due. */
  const late = retiree({ horizonYears: 55 });
  const lateRun = simulate(late);
  const rmdYear = lateRun.rows.find((r) => (r.withdrawals.rmdRequired || 0) > 0);
  ok('the scenario reaches RMD age', !!rmdYear);
  if (rmdYear) {
    const f = G.yearGuidance(rmdYear, late, getTaxConfig(rmdYear.year, 0)).flags;
    ok('the RMD is flagged', f.some((x) => /required minimum distribution/i.test(x.text)));
  }

  /* No flags should appear in a quiet year — a panel that always warns
   * about something teaches people to ignore it. */
  const quiet = lateRun.rows.find((r) => !r.retired && !r.rothConversion
    && !(r.withdrawals.penaltyBase || 0) && !(r.withdrawals.rmdRequired || 0)
    && !(r.withdrawals.shortTermGain || 0));
  ok('a quiet working year raises no flags at all',
     quiet && G.yearGuidance(quiet, late, getTaxConfig(quiet.year, 0)).flags.length === 0,
     quiet ? JSON.stringify(G.yearGuidance(quiet, late, getTaxConfig(quiet.year, 0))
       .flags.map((f) => f.kind)) : 'no quiet year found');
}

section('The headroom band agrees with the engine\'s marginal rate');
/* These sit two lines apart in the panel. The first version measured
 * headroom against TOTAL taxable income while the engine measures the
 * marginal rate against ORDINARY taxable income, so the panel could
 * say "next dollar taxed at 10%" directly above "$44,784 more would
 * still be taxed at 12%". Two numbers disagreeing on one screen is
 * worse than either being absent. */
{
  for (const indexed of [true, false]) {
    const I = retiree({ indexBracketsToInflation: indexed });
    const run = simulate(I);
    const idx = indexed ? I.inflation : 0;
    let mismatch = 0, checked = 0;
    for (const row of run.rows) {
      const g = G.yearGuidance(row, I, getTaxConfig(row.year, idx));
      checked++;
      if (Math.abs(g.bracket.rate - row.marginalRate) > 1e-9) mismatch++;
    }
    ok(`bracket indexing ${indexed}: every year agrees`, mismatch === 0,
       `${mismatch} of ${checked} years disagree with row.marginalRate`);
    ok(`bracket indexing ${indexed}: there were years to check`, checked > 20);
  }

  /* And it must be measured on the ordinary base, not the total. */
  const I = retiree();
  const run = simulate(I);
  const withGains = run.rows.find((r) => (r.taxablePreferential || 0) > 0
    && (r.taxableOrdinary || 0) > 0);
  ok('a year exists with both ordinary and preferential income', !!withGains);
  if (withGains) {
    const g = G.yearGuidance(withGains, I, getTaxConfig(withGains.year, I.inflation));
    ok('guidance reports the ordinary base it used',
       g.taxableOrdinary === withGains.taxableOrdinary,
       `${g.taxableOrdinary} vs ${withGains.taxableOrdinary}`);
    ok('which is lower than the combined figure',
       withGains.taxableOrdinary < withGains.taxableIncome,
       'the two bases are identical here, so this year cannot distinguish them');
  }
  ok('the engine exposes the ordinary base on every row',
     run.rows.every((r) => typeof r.taxableOrdinary === 'number'));
  ok('and the preferential base too',
     run.rows.every((r) => typeof r.taxablePreferential === 'number'));
}

section('Rates are passed through, not recomputed');
{
  const I = retiree();
  const run = simulate(I);
  const r = run.rows[20];
  const g = G.yearGuidance(r, I, getTaxConfig(r.year, 0));
  ok('effective rate is the engine\'s', g.effectiveRate === r.effectiveTaxRate);
  ok('marginal rate is the engine\'s', g.marginalRate === r.marginalRate);
  ok('the year and age come straight from the row',
     g.year === r.year && g.age === r.age);
}

section('Degenerate rows do not throw');
for (const [name, row] of Object.entries({
  'no withdrawals object': { year: 2030, age: 44, taxableIncome: 0, effectiveTaxRate: 0, marginalRate: 0.1 },
  'empty withdrawals': { year: 2030, age: 44, taxableIncome: 0, withdrawals: {}, effectiveTaxRate: 0, marginalRate: 0.1 },
  'negative taxable income': { year: 2030, age: 44, taxableIncome: -500000, withdrawals: { total: 0 }, effectiveTaxRate: 0, marginalRate: 0.1 },
})) {
  let out = null, err = null;
  try { out = G.yearGuidance(row, defaultInputs(), CFG); } catch (e) { err = e; }
  ok(`${name}: returns rather than throwing`, !err, err ? err.message : '');
  if (out) {
    ok(`${name}: actions is an array`, Array.isArray(out.actions));
    ok(`${name}: headroom is finite or explicitly null`,
       out.bracket.room === null || Number.isFinite(out.bracket.room));
    ok(`${name}: gain room is never negative`, out.zeroRateGainRoom >= 0);
  }
}

section('The app renders it, and frames it as description');
{
  const src = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok('the inspector calls it', /\$\{renderPlaybook\(r\)\}/.test(src));
  ok('it sits above the money in/out breakdown',
     src.indexOf('${renderPlaybook(r)}') < src.indexOf("<div class=\"grp\">Money in</div>"));
  ok('headroom is only shown when it is actionable',
     /g\.bracket\.room > 100000/.test(src) && /g\.zeroRateGainRoom > 100000/.test(src),
     'a line reading "0 left" is noise');
  ok('it uses the year\'s own tax config, not 2026 forever',
     /getTaxConfig\(r\.year,/.test(src));
  ok('it honours the bracket-indexing setting',
     /S\.inputs\.indexBracketsToInflation \? S\.inputs\.inflation : 0/.test(src));
  const mod = require('fs').readFileSync(__dirname + '/guidance.js', 'utf8');
  ok('the module says plainly that it is not advice',
     /not\s*\n?\s*\* advice/.test(mod) || /this is\s*\n?\s*\* arithmetic/.test(mod)
     || /arithmetic on the user's own assumptions, not/.test(mod));
  ok('and says what it cannot know',
     /cannot know about a pension/.test(mod.replace(/\s+/g, ' ')));
}

console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
