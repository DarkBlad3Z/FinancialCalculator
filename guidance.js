/* ===================================================================
 * guidance.js — "what do I actually do this year?"
 *
 * The year inspector listed money in and money out, which answers
 * "what happened" and not "what should I do". Everything needed for the
 * second question was already in the simulated row — per-account
 * withdrawals, the long/short-term gain split, the penalty base, the
 * RMD — it was simply never surfaced.
 *
 * This turns one row into:
 *   - a concrete list of moves, in the order the engine used
 *   - the headroom left in the current bracket and at the 0% capital
 *     gains rate, which is where the actual decisions live
 *   - flags for the things that bite (RMDs, the 10% penalty)
 *
 * IMPORTANT: this is arithmetic on the user's own assumptions, not
 * advice. Every number here is "given what you typed, here is what the
 * model did and what room is left" — it cannot know about a pension
 * nobody entered, a state move, a health event, or next year's law. The
 * wording is chosen to describe rather than instruct for that reason.
 * ================================================================= */
'use strict';

const ACCOUNT_LABELS = {
  cash: 'cash savings',
  brokerage: 'taxable brokerage',
  trad401k: 'traditional 401(k)',
  tradIra: 'traditional IRA',
  roth401k: 'Roth 401(k)',
  rothIra: 'Roth IRA',
  hsa: 'HSA',
};

/* Why pulling from each account costs what it costs. */
const ACCOUNT_COST = {
  cash: 'no tax — it has already been taxed',
  brokerage: 'tax on the gain only, at capital-gains rates',
  trad401k: 'taxed as ordinary income, every dollar',
  tradIra: 'taxed as ordinary income, every dollar',
  roth401k: 'tax-free',
  rothIra: 'tax-free',
  hsa: 'tax-free for medical costs',
};

/* How much more ordinary income fits before the next bracket starts.
 * This is the number that decides whether a Roth conversion is cheap
 * this year, and it is not derivable from anything the inspector showed. */
function bracketHeadroom(taxableIncome, filingStatus, cfg) {
  const bands = cfg.ordinaryBrackets[filingStatus] || cfg.ordinaryBrackets.single;
  for (const b of bands) {
    const top = b.upTo === null ? Infinity : b.upTo;
    /* `<`, matching tax-engine.js's marginalRate(). Both measure "where
     * does the next dollar land", so a full band must hand over to the
     * one above. */
    if (taxableIncome < top) {
      return {
        rate: b.rate,
        top: top === Infinity ? null : top,
        room: top === Infinity ? null : Math.max(0, top - taxableIncome),
      };
    }
  }
  return { rate: bands[bands.length - 1].rate, top: null, room: null };
}

/* How much long-term gain still fits in the 0% capital-gains band.
 * Ordinary income fills the preferential brackets first, which is why
 * this shrinks as other income rises — a point almost nobody expects. */
function zeroRateGainRoom(taxableIncome, filingStatus, cfg) {
  const bands = cfg.ltcgBrackets[filingStatus] || cfg.ltcgBrackets.single;
  const zero = bands.find((b) => b.rate === 0);
  if (!zero || zero.upTo === null) return 0;
  return Math.max(0, zero.upTo - Math.max(0, taxableIncome));
}

/* The moves for one year, largest first. */
function actions(row) {
  const w = row.withdrawals || {};
  const out = [];
  for (const key of ['cash', 'brokerage', 'trad401k', 'tradIra', 'roth401k', 'rothIra', 'hsa']) {
    const amount = w[key] || 0;
    if (amount <= 0) continue;
    const act = {
      account: key,
      label: ACCOUNT_LABELS[key],
      amount,
      cost: ACCOUNT_COST[key],
      note: null,
    };
    if (key === 'brokerage') {
      const lt = w.longTermGain || 0;
      const st = w.shortTermGain || 0;
      const gain = lt + st;
      act.note = gain > 0
        ? `realises ${st > 0 ? 'gain, ' + Math.round(100 * st / gain) + '% of it short-term'
            : 'long-term gain only'}`
        : 'no taxable gain — the sale is at or below cost';
      act.gain = gain;
      act.shortTermGain = st;
    }
    if ((key === 'trad401k' || key === 'tradIra') && (w.penaltyBase || 0) > 0) {
      act.note = 'some of this is before 59½ — see the penalty note below';
    }
    out.push(act);
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/* Things that change what you should do, rather than merely describing
 * what happened. */
function flags(row, cfg) {
  const w = row.withdrawals || {};
  const list = [];
  if ((w.rmdRequired || 0) > 0) {
    const short = (w.rmdRequired || 0) - (w.rmdSatisfied || 0);
    list.push({
      kind: short > 0 ? 'bad' : 'info',
      text: short > 0
        ? `A required minimum distribution of ${w.rmdRequired} is due and the plan is short.`
        : 'A required minimum distribution is due this year and the plan covers it.',
      raw: { required: w.rmdRequired, satisfied: w.rmdSatisfied },
    });
  }
  if ((w.penaltyBase || 0) > 0) {
    list.push({
      kind: 'bad',
      penaltyBase: w.penaltyBase,
      rate: cfg.earlyWithdrawal ? cfg.earlyWithdrawal.penaltyRate : 0.1,
      text: 'Part of this withdrawal is before 59½, so a penalty applies on top of the '
          + 'income tax. A Roth conversion ladder or taxable savings usually avoids it.',
    });
  }
  if ((row.rothConversion || 0) > 0) {
    list.push({
      kind: 'info',
      text: 'A Roth conversion runs this year. It is voluntary income — it raises this '
          + "year's tax to lower later years'.",
    });
  }
  if ((w.shortTermGain || 0) > 0) {
    list.push({
      kind: 'warn',
      text: 'Some gain is short-term, taxed as ordinary income rather than at '
          + 'capital-gains rates. Holding lots past a year avoids it.',
    });
  }
  return list;
}

/* The whole picture for one year. `cfg` is the tax config for that
 * year, so projections use the year's own brackets. */
function yearGuidance(row, inputs, cfg) {
  const filing = inputs.filingStatus || 'single';
  /* Ordinary taxable income, NOT the total. Both of these questions are
   * about the ordinary base:
   *   - more ordinary income is taxed in the ordinary brackets, which
   *     start from taxableOrdinary;
   *   - long-term gain stacks ON TOP of ordinary income in the
   *     preferential brackets, so the 0% room is measured from the
   *     ordinary base too.
   * Feeding either of them the combined figure put the headroom in a
   * different bracket from the engine's own marginal rate, displayed
   * two lines apart. Falls back for rows from before the engine
   * exposed it. */
  const ordinary = typeof row.taxableOrdinary === 'number'
    ? row.taxableOrdinary : row.taxableIncome;
  const head = bracketHeadroom(ordinary, filing, cfg);
  const gainRoom = zeroRateGainRoom(ordinary, filing, cfg);
  return {
    year: row.year,
    age: row.age,
    retired: row.retired,
    actions: actions(row),
    totalWithdrawn: (row.withdrawals && row.withdrawals.total) || 0,
    effectiveRate: row.effectiveTaxRate,
    marginalRate: row.marginalRate,
    bracket: head,
    zeroRateGainRoom: gainRoom,
    taxableOrdinary: ordinary,
    flags: flags(row, cfg),
  };
}

const _guidanceExports = {
  yearGuidance, bracketHeadroom, zeroRateGainRoom, actions, flags,
  ACCOUNT_LABELS, ACCOUNT_COST,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _guidanceExports;
else if (typeof self !== 'undefined') Object.assign(self, _guidanceExports);
