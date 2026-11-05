/* ===================================================================
 * controls.js — the live control table
 *
 * Its own module so the test suite can import it and exercise every
 * control against the real engine, rather than scraping definitions out
 * of app.js with regular expressions. That mattered: the first version
 * of the test parsed source, and a `max` expressed as a function would
 * have silently parsed as NaN.
 *
 * Grouped, because twenty-two sliders in one undifferentiated column is
 * not "more control", it is a wall. Each group collapses and the open
 * set persists.
 *
 * `key` may be a dotted path (`returns.stocks`, `sweep.bufferMonths`) —
 * several of the most interesting levers live in nested objects, and
 * excluding them because the control only handled top-level keys was an
 * arbitrary limit.
 *
 * `kind` drives formatting only:
 *   money  cents, shown as dollars      rate   fraction, shown as %
 *   plain  a bare number                age    an age
 *   years  a count, with a unit         equity the all-account stock weight
 *
 * `max` may be a function of (inputs, taxConfig). Contribution sliders
 * need it: the 401(k) deferral default already sits at the statutory
 * cap, so a fixed max of $40,000 gave the slider a dead top half that
 * looked live and did nothing. A capped slider's whole track is live,
 * and it moves with age as catch-up contributions open up.
 * =================================================================== */
'use strict';

const LIVE_GROUPS = [
  {
    id: 'spend', label: 'Earning & spending',
    controls: [
      { key: 'salary', label: 'Gross salary', kind: 'money', min: 0, max: 50000000, step: 100000,
        hint: 'Before tax.' },
      { key: 'salaryGrowth', label: 'Annual raise', kind: 'rate', min: 0, max: 0.12, step: 0.005 },
      /* $250k, not $400k. The default is $70k, and a slider that runs
       * to four hundred thousand spends most of its length in territory
       * where the plan is already bankrupt — so the useful part of the
       * track is a thumb's width. Settings takes any number. */
      { key: 'annualExpenses', label: 'Spend while working', kind: 'money',
        min: 0, max: 25000000, step: 50000, hint: 'After tax. Tax is worked out separately.' },
      { key: 'retirementSpending', label: 'Spend in retirement', kind: 'money',
        min: 0, max: 25000000, step: 50000 },
      { key: 'inflation', label: 'Inflation', kind: 'rate', min: 0, max: 0.08, step: 0.0025 },
    ],
  },
  {
    id: 'contrib', label: 'Contributions',
    controls: [
      { key: 'contrib401kDollar', label: '401(k) deferral', kind: 'money',
        min: 0, max: (I, cfg) => max401kDeferral(I.currentAge, cfg), step: 25000,
        pre: (I) => { I.contrib401kMode = 'dollar'; },
        hint: 'Capped at the statutory limit for your age.' },
      { key: 'roth401kSplit', label: 'Roth share of it', kind: 'rate', min: 0, max: 1, step: 0.05 },
      { key: 'afterTax401kAmount', label: 'After-tax 401(k)', kind: 'money',
        min: 0, step: 50000, pre: (I, v) => { I.afterTax401kEnabled = v > 0; },
        /* The track ends where the §415(c) headroom does: the annual
         * additions limit, less a full deferral, less the most the match
         * could add at this salary. A fixed $60,000 had a dead top end
         * once salary (and so the match) rose. Never above what the
         * engine will actually accept at a maximum deferral, so every
         * position on the track does something. */
        max: (I, cfg) => {
          const cap = I.plan415cLimit > 0
            ? Math.min(I.plan415cLimit, cfg.limits.definedContribution415c)
            : cfg.limits.definedContribution415c;
          let match = Math.round(I.salary * I.employerMatchCapPct * I.employerMatchRate);
          if (I.employerMatchDollarCap > 0) match = Math.min(match, I.employerMatchDollarCap);
          const room = Math.max(0, cap - cfg.limits.elective401k - match);
          return Math.floor(room / 50000) * 50000;
        },
        hint: 'The mega backdoor. Needs a plan that allows it. The track ends at your annual-additions headroom.' },
      { key: 'employerMatchCapPct', label: 'Match up to % of pay', kind: 'rate',
        min: 0, max: 0.15, step: 0.005 },
      { key: 'contribRothIra', label: 'Roth IRA', kind: 'money',
        min: 0, max: (I, cfg) => maxIraContribution(I.currentAge, cfg), step: 25000 },
      { key: 'contribHsa', label: 'HSA', kind: 'money', min: 0, step: 10000,
        max: (I, cfg) => maxHsa(I.hsaCoverage, I.currentAge, cfg) },
      { key: 'contribBrokerage', label: 'Direct to brokerage', kind: 'money',
        min: 0, max: 10000000, step: 100000 },
    ],
  },
  {
    id: 'retire', label: 'Retirement & withdrawals',
    controls: [
      { key: 'retirementAge', label: 'Retirement age', kind: 'age', min: 35, max: 80, step: 1,
        hint: 'When earned income stops. Separate from the age the headline figure reports.' },
      { key: 'socialSecurityStartAge', label: 'Social Security at', kind: 'age',
        min: 62, max: 70, step: 1, hint: 'Later means a larger cheque.' },
      { key: 'socialSecurityAnnual', label: 'Social Security a year', kind: 'money',
        min: 0, max: 8000000, step: 100000 },
      { key: 'rothConversionAmount', label: 'Roth conversion a year', kind: 'money',
        min: 0, max: 20000000, step: 250000,
        pre: (I, v) => { if (v > 0) I.rothConversionMode = 'fixed'; },
        hint: 'Often the biggest lever for an early retiree.' },
      { key: 'sweep.bufferMonths', label: 'Cash buffer', kind: 'years', unit: 'mo',
        min: 0, max: 24, step: 1, hint: 'Months of spending held in cash.' },
    ],
  },
  {
    id: 'markets', label: 'Markets',
    controls: [
      { key: 'equity', label: 'Equity weight', kind: 'equity', min: 20, max: 100, step: 5,
        hint: 'Your 401(k)s, IRAs, HSA and brokerage. A 529 keeps its own mix.' },
      { key: 'returns.stocks', label: 'Stock return', kind: 'rate',
        min: 0, max: 0.14, step: 0.0025 },
      { key: 'returns.bonds', label: 'Bond return', kind: 'rate', min: 0, max: 0.09, step: 0.0025 },
      { key: 'dividendYield', label: 'Dividend yield', kind: 'rate',
        min: 0, max: 0.06, step: 0.0025 },
      { key: 'cashInterestRate', label: 'Cash interest', kind: 'rate',
        min: 0, max: 0.08, step: 0.0025 },
    ],
  },
];

/* The flat list keyboard focus walks. Derived, never hand-maintained. */
const LIVE = LIVE_GROUPS.flatMap((g) => g.controls.map((c) => ({ ...c, group: g.id })));


/* Resolve a control's bounds against the current inputs. A numeric max
 * passes straight through; a function gets the inputs and the tax year
 * it should read limits from. */
function controlMax(c, inputs, cfg) {
  const v = typeof c.max === 'function' ? c.max(inputs, cfg) : c.max;
  return Number.isFinite(v) && v > c.min ? v : c.min + c.step;
}

const _controlExports = { LIVE_GROUPS, LIVE, controlMax };
if (typeof module !== 'undefined' && module.exports) module.exports = _controlExports;
else if (typeof self !== 'undefined') Object.assign(self, _controlExports);
