/* ===================================================================
 * app.js — HUD CONTROLLER
 * -------------------------------------------------------------------
 * Wires the simulation to the interface. Holds no financial logic of
 * its own: every number comes from engine.js, every preset from
 * characters.js, every recommendation from optimizer.js. That
 * separation is why the 528 engine, optimiser and preset assertions still
 * hold across this rewrite.
 *
 * Structure
 *   1. helpers and state
 *   2. recompute + delta badges  (the "change here, see it there" loop)
 *   3. charts (with ghost traces) and the table
 *   4. command card, inspector, character bay
 *   5. settings (multi-page)
 *   6. character creation (four steps)
 *   7. auto-optimise
 *   8. keyboard, audio, boot
 * =================================================================== */

'use strict';

(function () {

/* ============ 1. helpers and state ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const M = Money;
const fmt = (c) => M.fmt(c);
/* Headline figures: two decimals, so a slider step produces a visible
 * change. Axis labels keep the one-decimal form via M.fmt directly. */
const fmtK = (c) => M.fmt(c, { compact: true, compactDigits: 2 });
const pct = (r, d = 1) => `${(r * 100).toFixed(d)}%`;
const D = (c) => M.toDollars(c);
const clone = (o) => JSON.parse(JSON.stringify(o));
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/* v3: the v2 key was polluted by instrumented test builds that wrote
 * `created: true`, which made a first-time visitor look like a
 * returning one and skipped creation entirely. Bumping the key
 * discards that. */
const LS = 'pf-forecaster-state-v3';

const S = {
  inputs: defaultInputs(),
  prev: null,            // previous run, for ghost traces and deltas
  run: null,
  mc: null,
  character: null,
  view: 'balances',
  cursor: 0,             // scrubber position
  targetAge: 65,
  /* While true, the reported age tracks the retirement age. Most people
   * want "what will I have when I stop working", and when the two
   * default to the same number the divergence later is a genuine
   * surprise — one that reads as a sync bug rather than two settings.
   * Any deliberate edit to the field pins it. */
  targetFollowsRetirement: true,
  focus: 0,              // which live control has keyboard focus
  settingsPage: 'profile',
  helpPage: 'start',
  creationStep: 0,
  creationChoice: { occupation: 'softwareEngineer', state: 'WA', stage: 'mid',
                    saver: 'p75', presentation: 'unspecified', skinTone: 2,
                    hairColour: 0, build: 'average' },
  ui: { bay: true, bayFx: true, idle: 'subtle',
        /* Audio ships ON. It still cannot sound before a gesture, and
         * solving the entry lock is that gesture. */
        music: true, cues: true,
        musicVol: 0.30, cueVol: 0.40, cueSet: 'industrial',
        /* Which control groups are expanded. Absent = expanded. */
        openGroups: {},
        /* Multiplies the whole type scale. 1 is already larger than the
         * first build; this goes further for anyone who wants it. */
        textScale: 1,
        /* 'dark' | 'light'. Dark is the default because the HUD was
         * designed for it, but a dark interface is a real barrier for
         * some people and a plain preference for others. */
        theme: 'dark',
        /* 'arcade' is the full game-styled experience: music, the
         * character bay, the hidden cheat code. 'pro' is the same
         * engine with the theatre switched off — no audio, no bay, the
         * optimiser on the toolbar, plain labels. Neither is a reduced
         * version of the other; they are two front doors, because a
         * planner opening this at work and someone who wants a HUD are
         * not the same visitor. null = not chosen yet. */
        mode: null,
        skippedCreation: false,
        /* Declared here rather than materialising on first use. */
        plainLabels: false,
        tipsDone: false,
        /* The optimiser is a CHEAT CODE — hidden until unlocked with a
         * controller-style combination. See CHEAT below. */
        cheatUnlocked: false },
  lastOpt: null,
  /* Which profile the LIVE inputs were loaded from, or null for an
   * unsaved plan. Without this, syncActiveProfile() happily wrote
   * whatever was in S.inputs into whichever profile was marked active —
   * so merely opening the Manage panel could overwrite a saved plan
   * with an unrelated one, silently and with no undo. */
  inputsFromProfile: null,
};

function save() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      inputs: S.inputs, character: S.character, ui: S.ui, targetAge: S.targetAge,
      targetFollowsRetirement: S.targetFollowsRetirement,
    }));
  } catch { /* private mode, fine */ }
}
function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.inputs) S.inputs = { ...defaultInputs(), ...d.inputs };
    if (d.character) S.character = d.character;
    if (d.ui) S.ui = { ...S.ui, ...d.ui };
    if (d.targetAge) S.targetAge = d.targetAge;
    if (typeof d.targetFollowsRetirement === 'boolean') {
      S.targetFollowsRetirement = d.targetFollowsRetirement;
    } else if (d.targetAge) {
      /* Saved before this flag existed: if the two already differ, the
       * person clearly set the age on purpose, so do not start moving
       * it under them. */
      S.targetFollowsRetirement = d.targetAge === (d.inputs && d.inputs.retirementAge);
    }
    /* Whether to show creation is decided by whether a CHARACTER
     * exists, not by a flag — a character is the thing creation
     * produces, so its absence is the honest signal. `skipped` covers
     * someone who deliberately declined. */
    return !!d.character || d.ui?.skippedCreation === true;
  } catch { return false; }
}

/* ============ 2. recompute + delta badges ============ */
let rafPending = false;

/* Coalesced through requestAnimationFrame so dragging a slider does not
 * run the engine once per pixel.
 *
 * But rAF does not fire at all in a background tab or a hidden iframe,
 * and when that happened the whole app came up as an empty shell: no
 * simulation, no chart, no figures, and nothing on screen explaining
 * why. Two guards:
 *
 *   - `sync` computes immediately, used for the first run at boot so
 *     the page is never blank waiting for a frame that may not come.
 *   - a setTimeout fallback behind the same latch, so a starved rAF
 *     only delays the work rather than losing it.
 */
function recompute(opts = {}) {
  if (opts.sync) { runCompute(opts); return; }
  if (rafPending) return;
  rafPending = true;
  let done = false;
  const once = () => { if (done) return; done = true; rafPending = false; runCompute(opts); };
  requestAnimationFrame(once);
  setTimeout(once, 250);
}

function runCompute(opts) {
  if (S.run && !opts.noGhost) S.prev = S.run;
  try { S.run = simulate(S.inputs); }
  catch (e) {
    console.error('simulate failed', e);
    /* Say so on screen. A silent failure here used to leave every panel
     * showing stale or empty content with no explanation. */
    const box = $('#chartbox');
    if (box) {
      box.innerHTML = '<div class="empty">The forecast could not be calculated from these '
        + 'inputs. <b>Settings \u203a Reset everything</b> will clear them. '
        + `<br><br><span class="note">${String(e && e.message).slice(0, 160)}</span></div>`;
    }
    return;
  }
  // Monte Carlo is too slow to run on every slider tick, so it is
  // explicitly stale-marked rather than silently wrong.
  if (S.mc) S.mc.stale = true;
  renderAll();
  save();
}

/** Net worth at the target age, or the last year if the horizon is short. */
/* Both this and the profile comparison now call the engine's rowAtAge,
 * so there is exactly one implementation of "net worth at age N". */
function atTarget(run) {
  return run ? rowAtAge(run.rows, S.targetAge) : null;
}

function setDelta(node, now, before, { invert = false, fmtFn = fmt } = {}) {
  if (before === null || before === undefined || now === before) {
    node.textContent = '— unchanged';
    node.className = 'd flat';
    return;
  }
  const diff = now - before;
  const better = invert ? diff < 0 : diff > 0;
  node.textContent = `${diff > 0 ? '▲ +' : '▼ '}${fmtFn(Math.abs(diff))}`;
  node.className = `d ${better ? 'up' : 'dn'} fresh`;
  // Restart the animation.
  void node.offsetWidth;
  node.classList.add('fresh');
  if (S.ui.cues) AudioKit.cue(better ? 'tickUp' : 'tickDown');
}

function renderStrip() {
  const run = S.run, prev = S.prev;
  if (!run) return;
  const now = atTarget(run), was = prev ? atTarget(prev) : null;
  /* While comparing, the strip still describes the OPEN profile only.
   * Four lines on the chart and an unqualified headline figure is a
   * misreading waiting to happen, so the label carries the name. */
  const act = activeProfile();
  /* "Net worth at 45" was read as "net worth at retirement", because 45
   * is also the shape of a retirement age. Saying "age 45" and naming
   * the retirement age in the tooltip removes the ambiguity. */
  $('#s0label').textContent = (comparing() && act)
    ? `${act.name} \u2014 net worth at age ${S.targetAge}`
    : `Net worth at age ${S.targetAge}`;
  const s0 = $('#s0label').closest ? $('#s0label').closest('.stat') : null;
  if (s0 && s0.setAttribute) {
    s0.setAttribute('title', S.targetAge === S.inputs.retirementAge
      ? `Your balance at age ${S.targetAge}, which is also when you stop working.`
      : `Your balance at age ${S.targetAge}. You stop working at `
        + `${S.inputs.retirementAge} — set this in Settings › Profile.`);
  }
  $('#s0v').textContent = now ? fmtK(now.netWorth) : '—';
  setDelta($('#s0d'), now ? now.netWorth : 0, was ? was.netWorth : null, { fmtFn: fmt });

  $('#s1v').textContent = fmtK(run.summary.totalTaxPaid);
  setDelta($('#s1d'), run.summary.totalTaxPaid,
    prev ? prev.summary.totalTaxPaid : null, { invert: true });

  const mcEl = $('#s2v'), mcD = $('#s2d');
  if (S.mc) {
    mcEl.textContent = pct(S.mc.successRate, 1);
    mcEl.style.color = S.mc.successRate >= 0.85 ? 'var(--good)'
      : S.mc.successRate >= 0.7 ? 'var(--amb)' : 'var(--bad)';
    mcD.textContent = S.mc.stale ? 'stale — rerun' : `${S.mc.trials} trials`;
    mcD.className = S.mc.stale ? 'd flat' : 'd up';
  } else {
    mcEl.textContent = '—'; mcEl.style.color = '';
    // The cell IS the button now, so it says so rather than naming a
    // tab the reader then has to go and find.
    mcD.textContent = 'click to run 500 trials';
  }

  const dep = run.summary.depleted;
  const v3 = $('#s3v'), d3 = $('#s3d');
  if (dep) {
    const age = run.rows.find((r) => r.depleted).age;
    v3.textContent = 'DEPLETED'; v3.style.color = 'var(--bad)';
    d3.textContent = `runs dry at ${age}`; d3.className = 'd dn';
  } else if (S.mc && S.mc.successRate < 0.85) {
    v3.textContent = 'AT RISK'; v3.style.color = 'var(--amb)';
    d3.textContent = `${pct(1 - S.mc.successRate, 0)} of trials fail`; d3.className = 'd flat';
  } else {
    v3.textContent = 'FUNDED'; v3.style.color = 'var(--good)';
    d3.textContent = 'survives the horizon'; d3.className = 'd up';
  }

  // Audio intensity tracks plan health, so the bed is a second signal.
  const health = dep ? 1 : (S.mc ? 1 - S.mc.successRate : 0.25);
  AudioKit.setIntensity(health);

  const un = TAX_CONFIG[2026]._meta.unverified.length;
  $('#assumeFlag').innerHTML = un
    ? `<b>${un} tax figures unverified</b> — see Settings › Tax data.` : '';
}

/* ============ 3. charts and table ============ */
let chart = null;
const SERIES = [
  ['cash', 'Cash', '#64748b'],
  ['brokerage', 'Taxable', '#2563eb'],
  ['trad401k', 'Trad 401(k)', '#0891b2'],
  ['tradIra', 'Trad IRA', '#0e7490'],
  ['roth401k', 'Roth 401(k)', '#15803d'],
  ['rothIra', 'Roth IRA', '#4d7c0f'],
  ['hsa', 'HSA', '#a16207'],
  ['realEstateEquity', 'Real estate', '#c2410c'],
];

/* Rebuilt per render so the text-size setting reaches the chart. */
const axisOpts = () => ({
  ticks: { callback: (v) => M.fmt(v * 100, { compact: true }),
           font: { size: chartFont(11) }, color: themeInk().axis },
  grid: { color: themeInk().grid },
});
const xAxisOpts = () => ({
  grid: { display: false },
  ticks: { font: { size: chartFont(11) }, color: themeInk().axis, maxTicksLimit: 12 },
});
const baseOpts = () => ({
  responsive: true, maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  animation: { duration: 180 },
  plugins: {
    legend: { position: 'bottom',
      labels: { boxWidth: 11, boxHeight: 11, font: { size: chartFont(12) },
                color: themeInk().legend, padding: 9 } },
    tooltip: {
      backgroundColor: themeInk().tip, borderColor: 'rgba(86,175,255,.4)', borderWidth: 1,
      titleColor: themeInk().tipTitle, bodyColor: themeInk().tipText, padding: 10,
      titleFont: { size: chartFont(12.5) }, bodyFont: { size: chartFont(12.5) },
      callbacks: { label: (c) => `${c.dataset.label}: ${M.fmt(c.parsed.y * 100)}` },
    },
  },
});

function destroyChart() { if (chart) { chart.destroy(); chart = null; } }

/* Builds the dashed "before your last change" dataset. Lived in
 * svg-chart.js for a while, which was wrong — it is a Chart.js dataset,
 * not a renderer concern, and being there meant its colour was outside
 * the theme plumbing. */
function ghostLine(rows, pick) {
  return {
    label: 'before change', data: rows.map(pick), borderColor: themeInk().muted,
    borderWidth: 1.1, borderDash: [3, 3], pointRadius: 0, fill: false, tension: .25, order: 0,
  };
}

function renderChart() {
  const run = S.run;
  if (!run) return;          // a failed simulate leaves a message in the box
  const wantTable = S.view === 'table';
  $('#tablewrap').classList.toggle('hidden', !wantTable);
  $('#chartbox').classList.toggle('hidden', wantTable);
  /* The comparison matrix belongs to the Table view only. renderTable
   * was its sole writer and nothing cleared it, so switching away left
   * a ~200px table wedged under the chart, squeezing it to its floor. */
  if (!wantTable) { const mx = $('#cmpMatrix'); if (mx) mx.innerHTML = ''; }
  if (wantTable) { destroyChart(); renderTable(); return; }

  destroyChart();
  /* Bound per render, not module-wide constants: the text-size setting
   * can change between renders and the chart has to pick it up. Every
   * call site below still spreads `BASE`, `AXIS` and `XAXIS`. */
  const BASE = baseOpts(), AXIS = axisOpts(), XAXIS = xAxisOpts();
  const labels = run.rows.map((r) => r.year);
  /* The canvas is replaced by innerHTML in several places (the Monte
   * Carlo empty state, the fallback renderer). Put it back rather than
   * handing Chart.js a null. */
  if (!$('#chart')) $('#chartbox').innerHTML = '<canvas id="chart"></canvas>';
  const ctx = $('#chart');
  const retYear = S.inputs.startYear + (S.inputs.retirementAge - S.inputs.currentAge);
  let cfg;

  if (S.view === 'balances') {
    const used = SERIES.filter(([k]) => run.rows.some((r) => r[k] > 0));
    cfg = { type: 'line', data: { labels, datasets: used.map(([k, label, color]) => ({
        label, data: run.rows.map((r) => D(r[k])),
        backgroundColor: color + 'cc', borderColor: color, borderWidth: 0,
        fill: true, pointRadius: 0, tension: .25, order: 2,
      })) },
      options: { ...BASE, scales: { x: { ...XAXIS, stacked: true }, y: { ...AXIS, stacked: true } } } };

  } else if (S.view === 'networth') {
    const ds = [{ label: 'Net worth', data: run.rows.map((r) => D(r.netWorth)),
        borderColor: themeInk().net, backgroundColor: themeInk().area, borderWidth: 2,
        fill: true, pointRadius: 0, tension: .25, order: 2 },
      { label: 'Liquid only', data: run.rows.map((r) => D(r.netWorth - r.realEstateEquity)),
        borderColor: themeInk().muted, borderWidth: 1.2, borderDash: [5, 3], fill: false,
        pointRadius: 0, tension: .25, order: 2 }];
    if (S.prev) ds.push(ghostLine(S.prev.rows, (r) => D(r.netWorth)));
    cfg = { type: 'line', data: { labels, datasets: ds },
      options: { ...BASE, scales: { x: XAXIS, y: AXIS } } };

  } else if (S.view === 'tax') {
    const cats = [['taxFederal', 'Federal', '#2563eb'], ['taxCapitalGains', 'Cap gains', '#0891b2'],
      ['taxFica', 'FICA', '#65a30d'], ['taxState', 'State', '#c2410c'],
      ['taxNiit', 'NIIT', '#a16207'], ['taxPenalty', 'Penalty', '#b91c1c']]
      .filter(([k]) => run.rows.some((r) => r[k] > 0));
    cfg = { type: 'bar', data: { labels, datasets: [
        ...cats.map(([k, label, color]) => ({ label, data: run.rows.map((r) => D(r[k])),
          backgroundColor: color, stack: 'tax', order: 2 })),
        { label: 'Effective rate', type: 'line', yAxisID: 'y1', order: 1,
          data: run.rows.map((r) => r.effectiveTaxRate * 100),
          borderColor: themeInk().retire, borderWidth: 1.4, pointRadius: 0,
          tension: .25, fill: false }] },
      options: { ...BASE,
        plugins: { ...BASE.plugins, tooltip: { ...BASE.plugins.tooltip, callbacks: {
          label: (c) => c.dataset.yAxisID === 'y1'
            ? `Effective rate: ${c.parsed.y.toFixed(1)}%` : `${c.dataset.label}: ${M.fmt(c.parsed.y * 100)}` } } },
        scales: { x: { ...XAXIS, stacked: true }, y: { ...AXIS, stacked: true },
          y1: { position: 'right', grid: { display: false }, min: 0,
            ticks: { callback: (v) => v + '%', font: { size: chartFont(11) },
                     color: themeInk().axis } } } } };

  } else if (S.view === 'flow') {
    const IN = [['wages', 'Wages', '#1d4ed8'], ['pension', 'Pension', '#0369a1'],
      ['socialSecurity', 'Soc. Sec.', '#0891b2'], ['other', 'Other', '#0e7490'],
      ['dividends', 'Dividends', '#15803d'], ['interest', 'Interest', '#65a30d'],
      ['rent', 'Rent', '#ca8a04'], ['propertySale', 'Property sale', '#a16207'],
      ['withdrawals', 'Withdrawals', '#7c3aed']].filter(([k]) => run.rows.some((r) => r.inflow[k] > 0));
    const OUT = [['living', 'Living', '#c2410c'], ['realEstate', 'Real estate', '#9a3412'],
      ['contributions', 'Contributions', '#78716c'], ['tax', 'Tax', '#b91c1c']]
      .filter(([k]) => run.rows.some((r) => r.outflow[k] > 0));
    cfg = { type: 'bar', data: { labels, datasets: [
        ...IN.map(([k, label, color]) => ({ label, data: run.rows.map((r) => D(r.inflow[k])),
          backgroundColor: color, stack: 'f', order: 2 })),
        ...OUT.map(([k, label, color]) => ({ label, data: run.rows.map((r) => -D(r.outflow[k])),
          backgroundColor: color, stack: 'f', order: 2 })),
        { label: 'Net', type: 'line', data: run.rows.map((r) => D(r.netCashFlow)),
          borderColor: themeInk().net, borderWidth: 1.3, pointRadius: 0, tension: .2,
          fill: false, order: 1 }] },
      options: { ...BASE,
        plugins: { ...BASE.plugins, tooltip: { ...BASE.plugins.tooltip, callbacks: {
          label: (c) => `${c.dataset.label}: ${M.fmt(Math.abs(c.parsed.y) * 100)}` } } },
        scales: { x: { ...XAXIS, stacked: true }, y: { ...AXIS, stacked: true } } } };

  } else if (S.view === 'bands') {
    if (!S.mc || S.mc.stale) {
      /* No bands yet. While comparing, fall through to a line-only
       * chart instead of an empty state — Monte Carlo is stale-marked on
       * every slider tick, so this is the COMMON state, and the compare
       * note was promising lines that were never drawn. */
      if (comparing()) {
        cfg = { type: 'line', data: { labels, datasets: [
          { label: 'Net worth', data: run.rows.map((r) => D(r.netWorth)),
            borderColor: themeInk().net, borderWidth: 2, fill: false,
            pointRadius: 0, tension: .25 }] },
          options: { ...BASE, scales: { x: XAXIS, y: AXIS } } };
      } else {
        $('#chartbox').innerHTML =
          '<div class="empty">Monte Carlo has not been run for these inputs.'
          + '<br><br><button class="btn p" id="runMc">Run 500 trials</button></div>';
        $('#runMc').addEventListener('click', runMonteCarlo);
        return;
      }
    } else {
    const b = S.mc.bands;
    cfg = { type: 'line', data: { labels: b.map((x) => x.year), datasets: [
        { label: '90th', data: b.map((x) => D(x.p90)), borderColor: 'transparent',
          backgroundColor: themeInk().bandOuter, fill: '+1', pointRadius: 0, tension: .25 },
        { label: '75th', data: b.map((x) => D(x.p75)), borderColor: 'transparent',
          backgroundColor: themeInk().bandInner, fill: '+1', pointRadius: 0, tension: .25 },
        { label: 'Median', data: b.map((x) => D(x.p50)), borderColor: themeInk().net,
          borderWidth: 2, fill: false, pointRadius: 0, tension: .25 },
        { label: '25th', data: b.map((x) => D(x.p25)), borderColor: 'transparent',
          backgroundColor: themeInk().bandInner, fill: '+1', pointRadius: 0, tension: .25 },
        { label: '10th', data: b.map((x) => D(x.p10)), borderColor: 'transparent',
          backgroundColor: 'transparent', pointRadius: 0, tension: .25 }] },
      options: { ...BASE,
        plugins: { ...BASE.plugins, legend: { ...BASE.plugins.legend,
          labels: { ...BASE.plugins.legend.labels,
            filter: (i) => ['Median', '90th', '10th'].includes(i.text) } } },
        scales: { x: XAXIS, y: AXIS } } };
    }
  }

  /* Retirement and depletion are marked on every time-series view.
   * These are plain data now, not a Chart.js plugin, so the SVG
   * fallback draws exactly the same marks. */
  const marks = [{ year: retYear, colour: themeInk().retire,
                   text: 'RETIRE ' + S.inputs.retirementAge }];
  const dry = run.rows.find((r) => r.depleted);
  if (dry) marks.push({ year: dry.year, colour: themeInk().dry, text: 'DRY ' + dry.age });
  const cur = run.rows[S.cursor];
  if (cur) marks.push({ year: cur.year, colour: themeInk().cursor, text: '' });

  /* Compare mode: dim the open profile's detail and lay one line per
   * pinned profile over it. Table handles itself in renderTable. */
  if (cfg && comparing() && S.view !== 'table') {
    /* Re-key the open profile's own series onto the shared axis, or it
     * would be drawn against the wrong years whenever a pinned profile
     * extends the range. */
    const axis = compareYears();
    const own = new Map(labels.map((y, i) => [y, i]));
    cfg.data.datasets = dimForCompare(cfg.data.datasets.map((d) => ({
      ...d,
      data: axis.map((y) => (own.has(y) ? d.data[own.get(y)] : null)),
    }))).concat(compareSeries(S.view));
    cfg.data.labels = axis;
    /* With four lines on top, the dashed liquid-only line and the ghost
     * trace are noise; drop them. */
    cfg.data.datasets = cfg.data.datasets.filter((d) =>
      d.label !== 'Liquid only' && d.label !== 'before change');
  }

  if (!cfg) return;

  if (chartLibReady()) {
    const plugin = {
      id: 'markers',
      afterDatasetsDraw(c) {
        const xs = c.scales.x, ys = c.scales.y, g = c.ctx;
        for (const m of marks) {
          const i = c.data.labels.indexOf(m.year);
          if (i < 0) continue;
          const x = xs.getPixelForValue(i);
          g.save(); g.strokeStyle = m.colour; g.lineWidth = 1; g.setLineDash([2, 4]);
          g.beginPath(); g.moveTo(x, ys.top); g.lineTo(x, ys.bottom); g.stroke();
          g.setLineDash([]); g.fillStyle = m.colour;
          g.font = '600 8.5px ui-monospace, monospace';
          g.fillText(m.text, x + 4, ys.top + 10);
          g.restore();
        }
      },
    };
    cfg.plugins = [plugin];
    chart = new Chart(ctx, cfg);
    return;
  }

  /* No Chart.js. Draw it ourselves rather than leaving a blank panel —
   * and say why, once, so the blankness is never a mystery. */
  const box = $('#chartbox');
  if (typeof svgChart !== 'function') {
    /* Belt and braces: if svg-chart.js is missing too, say so in words
     * rather than throwing. A chart panel should never be silently
     * blank — that is the bug this whole path exists to prevent. */
    box.innerHTML = '<div class="empty">Charts are unavailable — neither Chart.js nor the '
      + 'built-in renderer loaded. Every number in the table and the inspector is still '
      + 'computed locally and correct. Switch to the <b>Table</b> view to read the forecast.</div>';
    return;
  }
  box.innerHTML = svgChart(cfg, box, marks)
    + `<div class="chartfallback">Simple chart mode — the Chart.js library did not load.
        <a href="#" id="chartWhy">why?</a></div>`;
  const why = $('#chartWhy');
  if (why) {
    why.addEventListener('click', (e) => {
      e.preventDefault();
      box.querySelector('.chartfallback').innerHTML =
        `Charts normally use Chart.js, fetched from <code>cdn.jsdelivr.net</code>. This page
         could not reach it — usually no internet, or a network that blocks the CDN. Everything
         else, including every number, is computed locally and is unaffected. To get the richer
         charts offline, save <code>chart.umd.js</code> next to the source as
         <code>vendor/chart.umd.js</code> and re-run <code>node build.js</code>.`;
    });
  }
}

/* One place decides whether the charting library is usable, so the
 * check cannot drift between callers. */
function chartLibReady() {
  return typeof Chart !== 'undefined' && typeof Chart === 'function';
}

const COLS = [
  ['Year', (r) => r.year], ['Age', (r) => r.age],
  ['Earned', (r) => fmt(r.earnedIncome)], ['Pension+SS', (r) => fmt(r.otherIncomeTotal)],
  ['Investment', (r) => fmt(r.investmentIncome)],
  ['401(k)', (r) => fmt(r.trad401k)], ['Roth', (r) => fmt(r.rothTotal)],
  ['Brokerage', (r) => fmt(r.brokerage)], ['RE equity', (r) => fmt(r.realEstateEquity)],
  ['Cash', (r) => fmt(r.cash)], ['Net worth', (r) => fmt(r.netWorth)],
  ['Tax', (r) => fmt(r.tax)], ['Eff.', (r) => pct(r.effectiveTaxRate)],
  ['Conversion', (r) => fmt(r.rothConversion)],
  ['Withdrawn', (r) => fmt(r.withdrawals.total)],
];

/* The side-by-side figures, shown above the per-year table while
 * comparing. This is where the old separate comparison screen lands:
 * the Table view is already the "every number" view, so a matrix of
 * headline figures belongs here rather than in an overlay nobody
 * returns to. */
function compareMatrix() {
  const picks = pinnedProfiles();
  if (picks.length < 2) return '';
  /* summarise() always calls back with profile.inputs, so routing it
   * through profileRun keeps the open profile live here too. */
  const sums = picks.map((p) => summarise(p, () => profileRun(p)));
  const cell = (sm, r) => {
    const v = sm[r.key];
    const txt = v == null ? '\u2014' : r.kind === 'money' ? fmt(v) : String(v);
    return `<td class="${bestOf(sums, r) === sm.id ? 'bestcell' : ''}">${txt}</td>`;
  };
  return `<div class="cmpwrap"><table class="cmptable">
    <thead><tr><th>Figure</th>${sums.map((sm) =>
      `<th><span class="pdot" style="background:${profileColour(sm.colour, S.ui.theme)}"></span>
        ${esc(sm.name)}</th>`).join('')}</tr></thead>
    <tbody>
      ${COMPARE_ROWS.map((r) => `<tr><td class="cmplabel">${r.label}</td>
        ${sums.map((sm) => cell(sm, r)).join('')}</tr>`).join('')}
      <tr><td class="cmplabel">Plan status</td>${sums.map((sm) =>
        `<td class="${sm.depleted ? 'dn' : 'up'}">${sm.depleted ? 'runs dry' : 'funded'}</td>`
      ).join('')}</tr>
    </tbody></table>
    <div class="note" style="margin-top:8px">A tick marks the better figure where better is
      unambiguous. Retirement age and the year the money runs out are left unmarked, because
      neither direction is good or bad on its own.</div>
  </div>`;
}

function renderTable() {
  const retYear = S.inputs.startYear + (S.inputs.retirementAge - S.inputs.currentAge);
  const head = `<thead><tr>${COLS.map(([h]) => `<th>${h}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${S.run.rows.map((r, i) => {
    const cls = [r.year === retYear ? 'retired-start' : '', r.depleted ? 'depleted' : '',
      i === S.cursor ? 'cursor' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}">${COLS.map(([, fn]) => {
      const v = fn(r);
      return `<td class="${v === '$0' ? 'dimcell' : ''}">${v === '$0' ? '—' : v}</td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody>`;
  $('#table').innerHTML = head + body;
  const mx = $('#cmpMatrix');
  if (mx) mx.innerHTML = comparing() ? compareMatrix() : '';
}

/* ============ 4. command card, inspector, bay ============ */
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const readEquity = (I) => I.allocations?.brokerage?.stocks ?? 85;
/* The six retirement and investment accounts. Deliberately NOT every
 * key in `allocations`:
 *   - cash, commodities and crypto are single-asset buckets, so a
 *     stocks/bonds split is meaningless for them;
 *   - c529 is excluded on purpose. It funds an education on its own
 *     horizon, which is usually far shorter than retirement, so it
 *     should not inherit a retirement equity weight.
 * Listed explicitly rather than derived, so adding an account cannot
 * silently opt it in. */
const EQUITY_ACCOUNTS = ['trad401k', 'roth401k', 'tradIra', 'rothIra', 'hsa', 'brokerage'];
const writeEquity = (I, v) => {
  const a = { stocks: v, bonds: 100 - v };
  for (const k of EQUITY_ACCOUNTS) I.allocations[k] = { ...a };
};
const showVal = (c, v) => c.kind === 'money' ? fmt(v)
  : c.kind === 'rate' ? pct(v, 1)
  : c.kind === 'equity' ? v + '%'
  : c.kind === 'years' ? v + ' ' + (c.unit || 'yr')
  : String(v);

/* One reader and one writer for every control, so a dotted path and a
 * plain key behave identically everywhere. */
const ctlGet = (c) => (c.kind === 'equity' ? readEquity(S.inputs) : getPath(S.inputs, c.key));
function ctlSet(c, v) {
  if (c.kind === 'equity') { writeEquity(S.inputs, v); return; }
  if (c.pre) c.pre(S.inputs, v);
  setPath(S.inputs, c.key, v);
  syncTargetAge(c.key);
}

/* Keeps the reported age on the retirement age until the person pins it
 * by editing the field themselves. One place, called from both the
 * slider and the settings field, so the two cannot disagree. */
function syncTargetAge(changedKey) {
  if (changedKey !== 'retirementAge') return;
  if (!S.targetFollowsRetirement) return;
  S.targetAge = S.inputs.retirementAge;
}

function buildControls() {
  const host = $('#ctlHost');
  host.innerHTML = '';
  let idx = 0;
  LIVE_GROUPS.forEach((g) => {
    const open = S.ui.openGroups ? S.ui.openGroups[g.id] !== false : true;
    const sec = el('div', 'ctlgrp' + (open ? '' : ' collapsed'));
    sec.dataset.grp = g.id;

    const head = el('button', 'ctlgrp-h');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.innerHTML = `<span class="cg-tw">\u25B8</span><span class="cg-t">${g.label}</span>
      <span class="cg-n">${g.controls.length}</span>`;
    head.addEventListener('click', () => {
      S.ui.openGroups = S.ui.openGroups || {};
      S.ui.openGroups[g.id] = !(S.ui.openGroups[g.id] !== false);
      save();
      buildControls();
      if (S.ui.cues) AudioKit.cue('tickDown');
    });
    sec.appendChild(head);

    const body = el('div', 'ctlgrp-b');
    g.controls.forEach((c) => {
      const i = idx++;
      const v = ctlGet(c);
      const cmax = controlMax(c, S.inputs, getTaxConfig(S.inputs.startYear, 0));
      const wrap = el('div', 'ctl');
      wrap.dataset.idx = i;
      wrap.innerHTML = `<div class="ctl-head">
          <span class="ctl-nm" title="${c.hint ? c.hint.replace(/"/g, '&quot;') : c.label}">
            ${i < 9 ? `<span class="ctl-k">${i + 1}</span>` : ''}${c.label}</span>
          <span class="ctl-vl" data-out="${i}">${showVal(c, v)}</span></div>
        <input type="range" min="${c.min}" max="${cmax}" step="${c.step}" value="${v}"
               aria-label="${c.label}">
        ${c.hint ? `<div class="ctl-h">${c.hint}</div>` : ''}`;
      const input = wrap.querySelector('input');
      input.addEventListener('input', () => {
        const nv = parseFloat(input.value);
        ctlSet(c, nv);
        wrap.querySelector('[data-out]').textContent = showVal(c, nv);
        recompute();
      });
      input.addEventListener('focus', () => setFocus(i));
      body.appendChild(wrap);
    });
    sec.appendChild(body);
    host.appendChild(sec);
  });
  setFocus(S.focus);
}

function refreshControls() {
  LIVE.forEach((c, i) => {
    const wrap = $(`.ctl[data-idx="${i}"]`);
    if (!wrap) return;              // its group is collapsed
    const v = ctlGet(c);
    const input = wrap.querySelector('input');
    /* The cap can move — a birthday opens catch-up room — so the range
     * is refreshed alongside the value, not only at build time. */
    input.max = controlMax(c, S.inputs, getTaxConfig(S.inputs.startYear, 0));
    if (document.activeElement !== input) input.value = v;
    wrap.querySelector('[data-out]').textContent = showVal(c, v);
  });
}

/* Focusing a control inside a collapsed group opens it first —
 * otherwise pressing a number key appears to do nothing. */
function revealGroupFor(i) {
  const c = LIVE[i];
  if (!c) return false;
  if (S.ui.openGroups && S.ui.openGroups[c.group] === false) {
    S.ui.openGroups[c.group] = true;
    save();
    buildControls();
    return true;
  }
  return false;
}

function setFocus(i) {
  S.focus = (i + LIVE.length) % LIVE.length;
  $$('.ctl').forEach((n) => n.classList.toggle('focused', +n.dataset.idx === S.focus));
}

function focusControl(i) {
  const n = (i + LIVE.length) % LIVE.length;
  revealGroupFor(n);
  setFocus(n);
  const wrap = $(`.ctl[data-idx="${n}"]`);
  if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ block: 'nearest' });
}

function nudgeFocused(dir) {
  const c = LIVE[S.focus];
  if (!c) return;
  if (revealGroupFor(S.focus)) setFocus(S.focus);
  const wrap = $(`.ctl[data-idx="${S.focus}"]`);
  if (!wrap) return;
  const input = wrap.querySelector('input');
  /* Clamp here rather than letting the range element silently do it, so
   * the displayed value and S.inputs cannot drift apart at the ends. */
  const cmax = controlMax(c, S.inputs, getTaxConfig(S.inputs.startYear, 0));
  const next = Math.min(cmax, Math.max(c.min, parseFloat(input.value) + dir * c.step));
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/* "What do I actually do this year?" — the question the inspector did
 * not answer. It listed money in and money out, which is what happened,
 * not what to do. The engine already recorded which accounts were drawn
 * and in what amounts; this shows those as moves, and adds the two
 * numbers where the real decisions live: how much more ordinary income
 * fits in this bracket, and how much long-term gain still fits at 0%.
 *
 * Framed as description, not instruction. It is arithmetic on the
 * user's own assumptions and cannot know about anything they did not
 * type in. */
function renderPlaybook(r) {
  const cfg = getTaxConfig(r.year, S.inputs.indexBracketsToInflation ? S.inputs.inflation : 0);
  const g = yearGuidance(r, S.inputs, cfg);

  const moves = g.actions.length
    ? g.actions.map((a) => `<div class="pb-move">
        <div class="pb-amt">${fmt(a.amount)}</div>
        <div class="pb-from">from your <b>${a.label}</b>
          <div class="pb-why">${a.cost}${a.note ? ' \u00b7 ' + a.note : ''}</div></div>
      </div>`).join('')
    : `<div class="note">Nothing is drawn from savings this year \u2014
        ${r.retired ? 'income covers the spending' : 'you are still earning'}.</div>`;

  /* Headroom is only worth showing when there is something to do with
   * it. A line saying "0 left" is noise. */
  const room = [];
  if (g.bracket.room !== null && g.bracket.room > 100000) {
    room.push(`<div class="pb-room"><b>${fmt(g.bracket.room)}</b> more ordinary income would
      still be taxed at ${pct(g.bracket.rate, 0)} \u2014 the next band starts above that.
      <span class="pb-why">This is the room a Roth conversion would use.</span></div>`);
  }
  if (g.zeroRateGainRoom > 100000) {
    room.push(`<div class="pb-room"><b>${fmt(g.zeroRateGainRoom)}</b> of long-term gain could be
      realised at <b>0%</b> this year.
      <span class="pb-why">Ordinary income fills these bands first, so this shrinks as other
      income rises.</span></div>`);
  }

  const flagHtml = g.flags.map((f) => `<div class="pb-flag ${f.kind}">${f.text
    .replace(String(f.raw && f.raw.required), fmt((f.raw && f.raw.required) || 0))}</div>`).join('');

  return `<div class="grp">This year</div>
    <div class="playbook">
      ${moves}
      <div class="pb-rate">Effective rate <b>${pct(g.effectiveRate)}</b>
        \u00b7 next dollar taxed at <b>${pct(g.marginalRate, 0)}</b></div>
      ${room.join('')}
      ${flagHtml}
    </div>`;
}

function renderInspector() {
  const r = S.run.rows[S.cursor];
  if (!r) return;
  const rows = (pairs) => pairs.filter(([, v]) => v !== 0)
    .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span>${fmt(v)}</span></div>`).join('');
  $('#insp').innerHTML = `
    <div class="lbl">Year inspector</div>
    <div class="insp-yr">${r.year} · age ${r.age}</div>
    <div class="insp-sub">${r.retired ? 'retired' : 'working'}${r.depleted ? ' · DEPLETED' : ''}</div>
    ${renderPlaybook(r)}
    <div class="grp">Money in</div>
    ${rows([['Wages', r.inflow.wages], ['Pension', r.inflow.pension],
      ['Social Security', r.inflow.socialSecurity], ['Dividends', r.inflow.dividends],
      ['Interest', r.inflow.interest], ['Rent', r.inflow.rent],
      ['Property sale', r.inflow.propertySale], ['Withdrawals', r.inflow.withdrawals]]) || '<div class="note">nothing</div>'}
    <div class="grp">Money out</div>
    ${rows([['Living', r.outflow.living], ['Real estate', r.outflow.realEstate],
      ['Contributions', r.outflow.contributions], ['Tax', r.outflow.tax]])}
    <div class="row"><span class="k">Net</span><span class="${r.netCashFlow < 0 ? 'dn' : 'up'}">${M.fmt(r.netCashFlow, { sign: true })}</span></div>
    <div class="grp">Tax</div>
    <div class="row"><span class="k">Effective</span><span>${pct(r.effectiveTaxRate)}</span></div>
    <div class="row"><span class="k">Marginal</span><span>${pct(r.marginalRate, 0)}</span></div>
    ${r.rothConversion ? `<div class="row"><span class="k">Conversion</span><span style="color:var(--amb)">${fmt(r.rothConversion)}</span></div>` : ''}
    ${r.withdrawals.rmdRequired ? `<div class="row"><span class="k">RMD</span><span>${fmt(r.withdrawals.rmdRequired)}</span></div>` : ''}
    ${r.withdrawals.penaltyBase ? `<div class="row"><span class="k">Penalty base</span><span class="dn">${fmt(r.withdrawals.penaltyBase)}</span></div>` : ''}
    ${renderWarnings(r.year)}`;
}

function renderWarnings(year) {
  const w = S.run.warnings.filter((x) => x.year === year);
  if (!w.length) return '';
  return '<div class="grp">Notes</div>' + w.map((x) =>
    `<div class="warn-item">${x.message}</div>`).join('');
}

/* Click count drives the pose and the bark. It decays, so the figure
 * goes back to standing at ease rather than staying annoyed forever. */
let bayClicks = 0;
let bayDecay = null;
let barkTimer = null;

function pokeBay() {
  bayClicks++;
  clearTimeout(bayDecay);
  // Long enough that a run of clicks can actually reach CHEAT_CLICKS.
  bayDecay = setTimeout(() => { bayClicks = 0; renderBay(); }, 6000);

  renderBay();
  AudioKit.cue(bayClicks >= 5 ? 'warn' : 'commit');
  if (!S.ui.cheatUnlocked && bayClicks >= CHEAT_CLICKS) unlockCheat('clicks');

  const c = S.character;
  const bark = $('#bayBark');
  bark.textContent = avatarLine(c ? c.attire : 'shirt', bayClicks - 1);
  bark.classList.remove('hidden');
  clearTimeout(barkTimer);
  barkTimer = setTimeout(() => bark.classList.add('hidden'), 2600);
}

function renderBay() {
  const bay = $('#bay');
  bay.classList.toggle('hidden', !S.ui.bay);
  document.body.classList.toggle('no-fx', !S.ui.bayFx);
  document.body.classList.toggle('idle-off', S.ui.idle === 'off');
  /* A class, not an inline grid template: the inline style fought the
   * responsive rules and won at widths where it should not have. */
  $('#strip').classList.toggle('has-bay', !!S.ui.bay);
  if (!S.ui.bay) return;
  const c = S.character;
  /* With no character the bay used to render a default figure so dark
   * and small it read as an empty box — a panel showing nothing, which
   * is worse than no panel. It now says what it is and how to fill it. */
  $('#bay').classList.toggle('empty-bay', !c);
  $('#bayTag').textContent = c ? (c.occupationLabel || '').slice(0, 9).toUpperCase() : 'NO CREW';
  $('#bayStat').textContent = c
    ? (S.run && S.run.summary.depleted ? 'ALERT' : 'READY')
    : 'C TO ADD';
  $('#bayFig').innerHTML = buildAvatar({
    attire: c ? c.attire : 'shirt', skinTone: c ? c.skinTone : 2,
    hairColour: c ? c.hairColour : 0, build: c ? c.build : 'average',
    size: 68, rimLight: true, animated: S.ui.idle !== 'off',
    pose: bayClicks ? avatarPose(bayClicks - 1) : 'idle',
  });
}

function renderTicks() {
  const rows = S.run.rows;
  const sc = $('#scrubber');
  sc.max = rows.length - 1;
  if (S.cursor > rows.length - 1) S.cursor = rows.length - 1;
  sc.value = S.cursor;
  const n = Math.min(7, rows.length);
  const step = Math.max(1, Math.floor((rows.length - 1) / (n - 1)));
  const out = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i].year);
  if (out[out.length - 1] !== rows[rows.length - 1].year) out.push(rows[rows.length - 1].year);
  $('#ticks').innerHTML = out.map((y) => `<span>${y}</span>`).join('');
}

/* Each step is isolated. A thrown error used to cascade: `new Chart`
 * raising a ReferenceError when the CDN was blocked took out the live
 * controls, the year ticks, the inspector and the character bay along
 * with the chart, because they all ran after it in one statement.
 * Failures are now reported once and the rest still render. */
const renderFailed = new Set();
/* Module scope so Diagnostics can report the real count. It said "all 7
 * healthy" for a while after two steps were added — a diagnostics page
 * exists so a bug report carries facts, and that one carried a wrong
 * one. */
const RENDER_STEPS = [
  ['status strip', () => renderStrip()], ['view note', () => renderViewNote()],
  ['chart', () => renderChart()], ['year ticks', () => renderTicks()],
  ['inspector', () => renderInspector()], ['character bay', () => renderBay()],
  ['controls', () => refreshControls()], ['profile bar', () => renderProfBar()],
  ['settings panel', () => refreshSettingsPanel()],
  ['cheat state', () => renderCheatState()],
];

/* The live controls and the Settings fields read the SAME `S.inputs` —
 * there is only ever one source of truth for a value. What was missing
 * was the reverse render: changing a slider refreshed the sliders but
 * not an open Settings panel, so the same number could be shown twice
 * with two different values. Nineteen fields appear in both surfaces,
 * so this was visible wherever they overlap.
 *
 * Guarded against rewriting the panel while someone is typing in it:
 * renderSettings() replaces #setBody's innerHTML, which would destroy
 * the field under the caret. */
function refreshSettingsPanel() {
  const panel = $('#settings');
  if (!panel || panel.classList.contains('hidden')) return;
  const body = $('#setBody');
  const ae = document.activeElement;
  if (ae && body && typeof body.contains === 'function' && body.contains(ae)) return;
  renderSettings();
}
function renderAll() {
  for (const [name, fn] of RENDER_STEPS) {
    try { fn(); } catch (e) {
      if (!renderFailed.has(name)) {
        renderFailed.add(name);
        console.error(`render step "${name}" failed: ${e && e.message}`, e);
      }
    }
  }
}

/* ============ 5. settings ============ */
const PAGES = [
  ['mode', 'Mode'], ['profile', 'Profile'], ['income', 'Income & spending'], ['contrib', 'Contributions'],
  ['accounts', 'Accounts'], ['markets', 'Markets & returns'], ['sweep', 'Cash sweep'],
  ['withdraw', 'Withdrawal strategy'], ['character', 'Character & audio'],
  ['taxdata', 'Tax data'], ['display', 'Display'], ['diag', 'Diagnostics'],
];

const STATE_KEYS = () => Object.keys(STATE_TAX).filter((k) => !k.startsWith('_'));

function row(name, hint, control) {
  return `<div class="sr"><div><div class="sr-n">${name}</div>
    ${hint ? `<div class="sr-h">${hint}</div>` : ''}</div><div class="sw">${control}</div></div>`;
}
const numF = (key, val, dollars) =>
  `<input type="number" data-set="${key}" data-dollars="${dollars ? 1 : 0}" value="${dollars ? Math.round(D(val)) : val}">`;
const rateF = (key, val) => `<input type="number" step="0.005" data-set="${key}" data-rate="1" value="${val}">`;
const togF = (key, on) => `<button class="tog" role="switch" aria-checked="${!!on}" data-tog="${key}"></button>`;
const selF = (key, val, opts) => `<select data-set="${key}">${opts.map(([v, l]) =>
  `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

function settingsPage(id) {
  const I = S.inputs;
  switch (id) {
    case 'mode': return [
      `<div class="helplead">A mode only changes presentation — audio, the avatar, the
        wording, and whether Auto-optimise is on the toolbar. It never touches a number in
        your forecast, so switching is always safe.</div>`,
      row('Theme', 'Also available from the button beside the chart tabs.',
        `<div style="display:flex;gap:6px;justify-content:flex-end">
          ${Object.entries(THEMES).map(([k, label]) =>
            `<button class="btn ${S.ui.theme === k ? 'p' : 'g'}" data-theme-set="${k}">${label}</button>`
          ).join('')}</div>`),
      row('Text size', 'Scales everything, including the charts.',
        `<div class="sizepick">${TEXT_SCALES.map(([v, label]) =>
          `<button class="btn ${Math.abs((S.ui.textScale || 1) - v) < 0.01 ? 'p' : 'g'}"
                   data-scale="${v}" style="font-size:calc(var(--fs-sm) * ${v})"
                   title="${label}">A</button>`).join('')}</div>`),
      row('Current mode', 'Switch any time.',
        `<div style="display:flex;gap:6px;justify-content:flex-end">
          ${Object.entries(MODES).map(([k, m]) =>
            `<button class="btn ${S.ui.mode === k ? 'p' : 'g'}" data-mode-set="${k}">${m.label}</button>`
          ).join('')}</div>`),
      row('Soundtrack', 'Needs a click somewhere first — browsers require it.',
        togF('__music', S.ui.music)),
      row('Interface sounds', '', togF('__cues', S.ui.cues)),
      row('Show your operator', 'The animated figure in the top-right corner.',
        togF('__bay', S.ui.bay)),
      row('Screen effects', 'Scanlines, sweep and glow on the operator bay.',
        togF('__bayFx', S.ui.bayFx)),
      row('Plain wording', 'Drops the uppercase HUD styling for ordinary sentence case.',
        togF('__plain', S.ui.plainLabels)),
      row('Auto-optimise', S.ui.cheatUnlocked
        ? 'Available — press O or use the amber button.'
        : 'Hidden. It hands you the answer, so it is something to find.',
        S.ui.cheatUnlocked ? '<span class="src measured">on the toolbar</span>'
          : `<button class="btn g" id="btnCheatHint2">Show me how</button>`),
      row('Replay the orientation', '', `<button class="btn g" id="btnTipsAgain">Show tips</button>`),
      row('Help', '', `<button class="btn g" id="btnHelpFromSet">Open help</button>`),
    ].join('');
    case 'profile': return [
      row('Current age', '', numF('currentAge', I.currentAge)),
      row('Report net worth at age',
        'Only decides which year the headline figure and the optimiser aim at. '
        + '<b>This is not your retirement age</b> \u2014 that lives in Retirement &amp; '
        + 'withdrawals, and is currently <b>' + S.inputs.retirementAge + '</b>.'
        + (S.targetAge !== S.inputs.retirementAge
            ? ` Right now they differ, so the headline reads age ${S.targetAge} while you
                stop working at ${S.inputs.retirementAge}.`
            : ''),
        `<input type="number" data-set="__target" value="${S.targetAge}">`),
      row('Horizon (years)', '', numF('horizonYears', I.horizonYears)),
      row('Filing status', '', selF('filingStatus', I.filingStatus,
        [['single', 'Single'], ['mfj', 'Married filing jointly'], ['hoh', 'Head of household']])),
      row('Spouse age', 'Used for the age-65 deduction under MFJ.', numF('spouseAge', I.spouseAge)),
      row('State', STATE_TAX[I.stateCode]?.note || '', selF('stateCode', I.stateCode,
        STATE_KEYS().map((k) => [k, STATE_TAX[k].name]))),
      row('Custom state rate', 'Only used when State is "Custom rate".', rateF('customStateRate', I.customStateRate)),
    ].join('');

    case 'income': return [
      row('Gross salary', '', numF('salary', I.salary, 1)),
      row('Annual raise', '', rateF('salaryGrowth', I.salaryGrowth)),
      row('Bonus', '', numF('bonus', I.bonus, 1)),
      row('Other income', '', numF('otherIncome', I.otherIncome, 1)),
      row('Spending while working, after tax',
        'What you consume. Do <b>not</b> include income tax — that is calculated separately. Property costs are separate too.',
        numF('annualExpenses', I.annualExpenses, 1)),
      row('Retirement spending, after tax',
        'In today’s dollars, inflated each year. Withdrawals are grossed up to cover the tax they trigger.',
        numF('retirementSpending', I.retirementSpending, 1)),
      row('Inflation', '', rateF('inflation', I.inflation)),
      row('Social Security start age', '', numF('socialSecurityStartAge', I.socialSecurityStartAge)),
      row('Social Security per year', 'Today’s dollars.', numF('socialSecurityAnnual', I.socialSecurityAnnual, 1)),
      row('Pension per year', 'Today’s dollars.', numF('pensionAnnual', I.pensionAnnual, 1)),
    ].join('');

    case 'contrib': {
      const cfg = getTaxConfig(I.startYear, 0);
      const cap = max401kDeferral(I.currentAge, cfg);
      return [
        `<div class="note" style="margin-bottom:8px">2026 limits: deferral ${fmt(cfg.limits.elective401k)},
         §415(c) all-sources ${fmt(cfg.limits.definedContribution415c)}, IRA ${fmt(cfg.limits.ira)},
         HSA ${fmt(cfg.limits.hsaSelfOnly)} self-only. Your deferral cap at ${I.currentAge} is ${fmt(cap)}.</div>`,
        row('401(k) deferral', `Capped at ${fmt(cap)}.`, numF('contrib401kDollar', I.contrib401kDollar, 1)),
        row('Share to Roth', '0 = all traditional.', rateF('roth401kSplit', I.roth401kSplit)),
        row('Employer match rate', '', rateF('employerMatchRate', I.employerMatchRate)),
        row('Match up to % of pay', '', rateF('employerMatchCapPct', I.employerMatchCapPct)),
        row('Match dollar cap', '0 for none. Bites harder each year as pay rises.', numF('employerMatchDollarCap', I.employerMatchDollarCap, 1)),
        row('Roth IRA', '', numF('contribRothIra', I.contribRothIra, 1)),
        row('Traditional IRA', '', numF('contribTradIra', I.contribTradIra, 1)),
        row('Backdoor Roth IRA', 'Bypasses the income phase-out. Watch the pro-rata rule if you hold a pre-tax IRA.', togF('backdoorRoth', I.backdoorRoth)),
        row('HSA', '', numF('contribHsa', I.contribHsa, 1)),
        row('HSA coverage', '', selF('hsaCoverage', I.hsaCoverage, [['selfOnly', 'Self only'], ['family', 'Family']])),
        row('Mega backdoor (after-tax 401k)', 'Needs a plan allowing after-tax <i>and</i> in-plan conversion.', togF('afterTax401kEnabled', I.afterTax401kEnabled)),
        row('After-tax amount', '0 with it enabled fills all headroom.', numF('afterTax401kAmount', I.afterTax401kAmount, 1)),
        row('Plan annual-additions cap', 'If your plan caps below the statutory figure.', numF('plan415cLimit', I.plan415cLimit, 1)),
        row('Direct brokerage', '', numF('contribBrokerage', I.contribBrokerage, 1)),
        row('Covered by an employer plan', 'Affects traditional-IRA deductibility.', togF('coveredByEmployerPlan', I.coveredByEmployerPlan)),
      ].join('');
    }

    case 'accounts': return [
      `<div class="note" style="margin-bottom:10px">Today's balances. Every account is taxed
        differently on the way out, which is the whole reason they are listed separately:
        <b>traditional</b> is ordinary income, <b>Roth</b> is tax-free, <b>taxable brokerage</b>
        is tax on the gain only.</div>`,
      row('Cash', '', numF('balances.cash', I.balances.cash, 1)),
      row('Traditional 401(k)', 'Pre-tax. Also the right home for the <b>earnings</b> on any '
        + 'un-converted after-tax money — those are taxable on withdrawal.',
        numF('balances.trad401k', I.balances.trad401k, 1)),
      row('Roth 401(k)',
        'Include after-tax (mega backdoor) money you have <b>already converted in-plan</b>, '
        + 'and the <b>contributions</b> part of any you have not — that basis comes out '
        + 'tax-free either way.',
        numF('balances.roth401k', I.balances.roth401k, 1)),
      row('Traditional IRA', 'A pre-tax balance here makes a backdoor Roth partly taxable.', numF('balances.tradIra', I.balances.tradIra, 1)),
      row('Roth IRA', '', numF('balances.rothIra', I.balances.rothIra, 1)),
      row('HSA', '', numF('balances.hsa', I.balances.hsa, 1)),
      row('Taxable brokerage', '', numF('balances.brokerage', I.balances.brokerage, 1)),
      row('… its cost basis',
        'What you paid. Setting it equal to the balance means no unrealised gain, so selling '
        + 'costs nothing in tax \u2014 usually optimistic if you have held it a while. '
        + 'Clamped to the market value.',
        numF('balances.brokerageBasis', I.balances.brokerageBasis, 1)),
      row('Gold / commodities', '', numF('balances.commodities', I.balances.commodities, 1)),
      row('Crypto', '', numF('balances.crypto', I.balances.crypto, 1)),
      row('529', '', numF('balances.c529', I.balances.c529, 1)),
    ].join('');

    case 'markets': return Object.entries(ASSET_CLASSES).map(([k, m]) =>
      row(m.label, `Volatility ${pct(I.volatility[k])} — used only in Monte Carlo.`,
        `<div style="display:flex;gap:5px"><input type="number" step="0.0025" data-set="returns.${k}" data-rate="1" value="${I.returns[k]}">
         <input type="number" step="0.005" data-set="volatility.${k}" data-rate="1" value="${I.volatility[k]}"></div>`)).join('')
      + row('Equity weight',
          'Applied to your 401(k)s, IRAs, HSA and brokerage. A 529 keeps its own mix \u2014 '
          + 'it funds an education on a shorter horizon.', `<input type="number" data-set="__equity" value="${readEquity(I)}">`)
      + row('Dividend yield', 'Paid out as cash and subtracted from the brokerage price return, so it is not double-counted.', rateF('dividendYield', I.dividendYield))
      + row('Cash interest', '', rateF('cashInterestRate', I.cashInterestRate))
      + row('Contribution timing', 'Growth credited to new money.', selF('contributionTiming', I.contributionTiming,
          [['mid', 'Mid-year (half)'], ['start', 'Start (full)'], ['end', 'End (none)']]))
      + row('Glide path', 'Shift toward bonds near retirement.', togF('glidePath.enabled', I.glidePath.enabled));

    case 'sweep': return [
      row('Sweep excess cash', '', togF('sweep.enabled', I.sweep.enabled)),
      row('Buffer mode', '', selF('sweep.bufferMode', I.sweep.bufferMode, [['months', 'Months of expenses'], ['dollar', 'Fixed dollars']])),
      row('Buffer months', '', numF('sweep.bufferMonths', I.sweep.bufferMonths)),
      row('Buffer dollars', '', numF('sweep.bufferDollar', I.sweep.bufferDollar, 1)),
      row('Frequency', 'Sets how many tax lots a year of sweeping creates, which drives short vs long-term treatment later.',
        selF('sweep.frequency', I.sweep.frequency, [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['annual', 'Annual']])),
      row('Destination', '', selF('sweep.destination', I.sweep.destination,
        [['brokerage', 'Taxable brokerage'], ['commodities', 'Gold'], ['crypto', 'Crypto']])),
    ].join('');

    case 'withdraw': return [
      row('Withdrawal order', 'Drag-free: pick a named strategy.', selF('__order', orderName(I.withdrawalOrder),
        Object.keys(ORDERS).map((k) => [k, k]))),
      row('Tax lot selection', '', selF('lotSelectionMethod', I.lotSelectionMethod,
        [['ltFirst', 'Long-term first'], ['hifo', 'Highest cost first'], ['fifo', 'First in, first out']])),
      row('Roth conversion ladder', 'Often the biggest lever for an early retiree.', selF('rothConversionMode', I.rothConversionMode,
        [['none', 'None'], ['fillBracket', 'Fill to a bracket'], ['fixed', 'Fixed amount']])),
      row('Fill to the top of', '', selF('rothConversionFillToRate', I.rothConversionFillToRate,
        [[0.10, '10%'], [0.12, '12%'], [0.22, '22%'], [0.24, '24%']])),
      row('Fixed conversion amount', '', numF('rothConversionAmount', I.rothConversionAmount, 1)),
      row('Conversion start age', '0 = as soon as retired.', numF('rothConversionStartAge', I.rothConversionStartAge)),
      row('Conversion end age', '', numF('rothConversionEndAge', I.rothConversionEndAge)),
      row('Penalty exception applies', 'Suppresses the 10% penalty, not the income tax.', togF('penaltyExceptionApplies', I.penaltyExceptionApplies)),
      row('Cover shortfalls by withdrawing', '', togF('coverShortfallsByWithdrawing', I.coverShortfallsByWithdrawing)),
    ].join('');

    case 'character': {
      const c = S.character;
      return [
        `<div class="note" style="margin-bottom:9px">${c
          ? `<b>${c.occupationLabel}</b> · ${c.state} · ${c.stageLabel} · ${c.saverLabel}`
          : 'No character built yet.'}</div>`,
        row('Show character bay', 'Purely cosmetic. Nothing is lost by hiding it.', togF('__bay', S.ui.bay)),
        row('Bay effects', 'Radar sweep, scanlines, travelling highlight — the costly ones to redraw.', togF('__bayFx', S.ui.bayFx)),
        row('Idle animation', 'Honours <code>prefers-reduced-motion</code> regardless.', selF('__idle', S.ui.idle, [['subtle', 'Subtle'], ['off', 'Off']])),
        row('Rebuild character', 'Re-opens creation. Your current numbers are kept unless you re-apply presets.', `<button class="btn" id="setRebuild">Open</button>`),
        `<div class="lbl" style="margin:14px 0 8px">Audio — synthesised, no files</div>`,
        row('Music bed', 'Filtered saw bass, detuned stabs, sweeping pad. Generated live.', togF('__music', S.ui.music)),
        row('Music volume', 'Ducks while a cue plays.', `<input type="number" step="0.02" min="0" max="1" data-set="__musicVol" value="${S.ui.musicVol}">`),
        row('Interface sound', 'Squelch on open, clunk on commit, horn on a warning. Event cues only.', togF('__cues', S.ui.cues)),
        row('Sound volume', '', `<input type="number" step="0.02" min="0" max="1" data-set="__cueVol" value="${S.ui.cueVol}">`),
        row('Cue set', 'Filter and envelope changes on one synth graph.', selF('__cueSet', S.ui.cueSet,
          [['industrial', 'Industrial'], ['clinical', 'Clinical'], ['muted', 'Muted']])),
        `<div class="note">Audio stays off until you switch it on — browsers block autoplay, and
          unexpected music on a finance tool is a bad introduction. <b>M</b> mutes from anywhere.</div>`,
      ].join('');
    }

    case 'taxdata': {
      const c = TAX_CONFIG[2026];
      const rows = [
        ['Standard deduction — single', fmt(c.standardDeduction.single)],
        ['Standard deduction — MFJ', fmt(c.standardDeduction.mfj)],
        ['401(k) deferral', fmt(c.limits.elective401k)],
        ['Catch-up 50+ / 60–63', `${fmt(c.limits.catchUp50)} / ${fmt(c.limits.catchUpSuper60to63)}`],
        ['§415(c) annual additions', fmt(c.limits.definedContribution415c)],
        ['IRA / catch-up', `${fmt(c.limits.ira)} / ${fmt(c.limits.iraCatchUp50)}`],
        ['HSA self-only / family', `${fmt(c.limits.hsaSelfOnly)} / ${fmt(c.limits.hsaFamily)}`],
        ['Social Security wage base', fmt(c.fica.socialSecurityWageBase)],
        ['Roth IRA phase-out (single)', `${fmt(c.rothIraPhaseOut.single.start)} – ${fmt(c.rothIraPhaseOut.single.end)}`],
        ['NIIT threshold (not indexed)', fmt(c.niit.threshold.single)],
        ['§121 home exclusion (not indexed)', `${fmt(c.homeSaleExclusion.single)} / ${fmt(c.homeSaleExclusion.mfj)}`],
        ['Depreciation recapture', pct(c.depreciationRecaptureRate, 0)],
        ['§469 special allowance', `${fmt(c.passiveActivityLoss.specialAllowance)}, phased out by ${fmt(c.passiveActivityLoss.phaseOutEnd)}`],
      ];
      return `<div class="note" style="margin-bottom:9px"><b>Source:</b> ${c._meta.source}<br>
        <b>Verified:</b> ${c._meta.verifiedOn}</div>`
        + rows.map(([k, v]) => `<div class="fr"><span>${k}</span><span class="v">${v}</span><span class="src statute">statute</span></div>`).join('')
        + `<div class="lbl" style="margin:14px 0 6px">Unverified in this config</div>`
        + c._meta.unverified.map((u) => `<div class="warn-item">${u}</div>`).join('')
        + `<div class="lbl" style="margin:14px 0 6px">Preset data</div>`
        + `<div class="note">${CHARACTER_DATA_META.caution}</div>`
        + CHARACTER_DATA_META.unverified.map((u) => `<div class="warn-item">${u}</div>`).join('');
    }

    case 'display': return [
      row('Show real (today’s) dollars', '', togF('displayRealDollars', I.displayRealDollars)),
      row('Index tax brackets to inflation', 'Turning this off models bracket creep.', togF('indexBracketsToInflation', I.indexBracketsToInflation)),
      row('Export', '', `<button class="btn" id="btnCsv">CSV</button>`),
      row('Export scenario', '', `<button class="btn" id="btnJson">JSON</button>`),
    ].join('');

    /* Diagnostics. Added because "the chart is not showing up" could
     * have meant half a dozen things and none of them were visible from
     * inside the app. Now a bug report can carry facts. */
    case 'diag': return diagPage();

    default: return '';
  }
}

/* ---------- diagnostics ---------- */
function diagPage() {
  const good = (t) => `<span class="src measured">${t}</span>`;
  const bad = (t) => `<span class="src bad">${t}</span>`;
  const meh = (t) => `<span class="src derived">${t}</span>`;

  const libOk = chartLibReady();
  const cdnFailed = !!window.__chartCdnFailed;
  const inlined = !cdnFailed && libOk && !document.querySelector('script[src*="chart.umd.js"]');

  const cv = $('#chart');
  let canvasInfo = 'no canvas — the SVG fallback is drawing';
  let painted = '—';
  if (cv && cv.getBoundingClientRect) {
    const r = cv.getBoundingClientRect();
    canvasInfo = `${Math.round(r.width)} x ${Math.round(r.height)} css, `
      + `${cv.width} x ${cv.height} backing`;
    try {
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, Math.min(cv.width, 400), Math.min(cv.height, 400)).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      painted = n ? `${(100 * n / (d.length / 4)).toFixed(1)}% of sampled area` : 'NOTHING PAINTED';
    } catch (e) { painted = 'could not sample (' + e.message + ')'; }
  }
  const boxR = $('#chartbox').getBoundingClientRect
    ? $('#chartbox').getBoundingClientRect() : { width: 0, height: 0 };

  const svgFallback = /<svg/.test($('#chartbox').innerHTML || '');

  return [
    row('Chart library', 'Charts use Chart.js. Everything else is computed locally.',
      libOk ? good(inlined ? 'inlined, offline-safe' : 'loaded from CDN')
            : bad(cdnFailed ? 'CDN blocked' : 'not loaded')),
    row('Chart.js version', '', typeof Chart !== 'undefined' && Chart.version
      ? Chart.version : meh('n/a')),
    row('Drawing mode', 'The built-in renderer is plainer but needs nothing from the network.',
      libOk && !svgFallback ? 'Chart.js canvas' : meh('built-in SVG fallback')),
    row('Chart area', 'A zero height here means a layout problem, not a data problem.',
      `${Math.round(boxR.width)} x ${Math.round(boxR.height)} px`
      + (boxR.height < 20 ? ' ' + bad('too short') : '')),
    row('Canvas', '', canvasInfo),
    row('Pixels painted', 'Blank with a healthy canvas means the chart drew nothing.',
      painted === 'NOTHING PAINTED' ? bad(painted) : painted),
    row('Render steps', 'Each panel renders independently; a failure here is isolated.',
      renderFailed.size ? bad([...renderFailed].join(', ') + ' failed')
                        : good('all ' + RENDER_STEPS.length + ' healthy')),
    row('Simulation', '', S.run
      ? `${S.run.rows.length} years, ${S.run.warnings.length} notes`
      : bad('no result')),
    row('Net worth at ' + S.targetAge, '',
      (S.run && atTarget(S.run)) ? fmt(atTarget(S.run).netWorth) : '\u2014'),
    row('Audio', '', AudioKit.available()
      ? `${S.ui.music ? 'music on' : 'music off'}, ${S.ui.cues ? 'cues on' : 'cues off'}`
        + (AudioKit.isMusicOn() ? ' ' + good('playing') : ' ' + meh('idle — needs a click'))
      : meh('no Web Audio in this browser')),
    row('Auto-optimise', 'Hidden by default — it hands you the answer.',
      S.ui.cheatUnlocked ? good('unlocked')
        : `${meh('locked')} <button class="btn g" id="btnCheatHint">Show me how</button>`),
    row('Saved state', '', `<code>${LS}</code>`),
    row('Copy a report', 'Paste this into a bug report.',
      `<button class="btn" id="btnDiagCopy">Copy diagnostics</button>`),
  ].join('');
}

function diagText() {
  const lines = [
    'Personal Finance Forecaster — diagnostics',
    'when          : ' + new Date().toISOString(),
    'user agent    : ' + (navigator.userAgent || '?'),
    'url protocol  : ' + location.protocol,
    'chart library : ' + (chartLibReady() ? 'loaded' : 'NOT LOADED')
      + (window.__chartCdnFailed ? ' (CDN reported an error)' : ''),
    'chart version : ' + (typeof Chart !== 'undefined' && Chart.version ? Chart.version : 'n/a'),
    'drawing mode  : ' + (/<svg/.test($('#chartbox').innerHTML || '') ? 'SVG fallback' : 'canvas'),
    'render fails  : ' + (renderFailed.size ? [...renderFailed].join(', ') : 'none'),
    'view          : ' + S.view,
    'rows          : ' + (S.run ? S.run.rows.length : 'none'),
    'character     : ' + (S.character ? S.character.occupation : 'none'),
    'cheat         : ' + (S.ui.cheatUnlocked ? 'unlocked' : 'locked'),
  ];
  const box = $('#chartbox').getBoundingClientRect
    ? $('#chartbox').getBoundingClientRect() : null;
  if (box) lines.push('chart area    : ' + Math.round(box.width) + ' x ' + Math.round(box.height));
  return lines.join('\n');
}

const ORDERS = {
  'Taxable first': ['cash', 'brokerage', 'trad401k', 'tradIra', 'roth401k', 'rothIra', 'hsa'],
  'Pre-tax first': ['cash', 'trad401k', 'tradIra', 'brokerage', 'roth401k', 'rothIra', 'hsa'],
  'Roth last, pre-tax mid': ['cash', 'brokerage', 'tradIra', 'trad401k', 'rothIra', 'roth401k', 'hsa'],
};
const orderName = (o) => Object.keys(ORDERS).find((k) => ORDERS[k].join() === (o || []).join()) ?? 'Taxable first';

/* The Mode page writes ui flags, not inputs, so it is handled apart
 * from the generic data-set plumbing. Keeping them distinct is what
 * guarantees a mode can never alter the forecast. */
const UI_TOGGLES = {
  __music: (v) => { S.ui.music = v; AudioKit.unlock(); AudioKit.setMusic(v); },
  __cues: (v) => { S.ui.cues = v; AudioKit.setCues(v); },
  __bay: (v) => { S.ui.bay = v; },
  __bayFx: (v) => { S.ui.bayFx = v; },
  __plain: (v) => { S.ui.plainLabels = v; document.body.classList.toggle('plain', v); },
};

/* Which inputs each settings page owns. Used by both the "changed" dot
 * and Reset page, so the button cannot reset something the dot does not
 * account for. */
const PAGE_KEYS = {
    profile: ['currentAge', 'horizonYears', 'filingStatus', 'stateCode', 'spouseAge'],
    income: ['salary', 'salaryGrowth', 'bonus', 'otherIncome', 'annualExpenses', 'retirementSpending', 'inflation'],
    contrib: ['contrib401kDollar', 'roth401kSplit', 'contribRothIra', 'contribHsa', 'backdoorRoth', 'afterTax401kEnabled'],
    accounts: [], markets: ['dividendYield', 'cashInterestRate'],
    sweep: [], withdraw: ['lotSelectionMethod', 'rothConversionMode'], display: ['displayRealDollars'],
};

function pageIsDefault(id) {
  const d = defaultInputs();
  const keysFor = PAGE_KEYS[id];
  if (!keysFor) return true;
  if (id === 'accounts') return JSON.stringify(S.inputs.balances) === JSON.stringify(d.balances);
  return keysFor.every((k) => JSON.stringify(S.inputs[k]) === JSON.stringify(d[k]));
}

function renderSettings() {
  $('#setNav').innerHTML = PAGES.map(([id, label]) =>
    `<button class="ni ${id === S.settingsPage ? 'on' : ''}" data-page="${id}">${label}${
      pageIsDefault(id) ? '' : '<span class="b"></span>'}</button>`).join('');
  $('#setBody').innerHTML = settingsPage(S.settingsPage);
  wireSettingInputs();
}

function setPath(obj, path, v) {
  const ks = path.split('.'); const last = ks.pop();
  ks.reduce((o, k) => (o[k] = o[k] ?? {}), obj)[last] = v;
}

function wireSettingInputs() {
  /* Settings fields apply on BOTH `input` and `change`.
   *
   * `change` alone fires only on blur or Enter, so typing a new target
   * age and looking straight at the figures showed nothing moving —
   * while the sliders two panels over update on every pixel. The
   * inconsistency reads as the setting being broken.
   *
   * The two paths differ in one important way: `input` must NOT call
   * renderSettings(), because that rewrites #setBody's innerHTML and so
   * destroys the very field being typed into, taking the caret with it.
   * Typing therefore updates the forecast live; the panel itself is
   * re-rendered once on blur. */
  const applySetting = (n, { rerender }) => {
    const key = n.dataset.set;
    let v = n.tagName === 'SELECT' ? n.value : parseFloat(n.value);
    if (n.tagName === 'SELECT' && /^-?[\d.]+$/.test(n.value)) v = parseFloat(n.value);
    if (n.dataset.dollars === '1') v = M.fromDollars(parseFloat(n.value) || 0);
    /* A half-typed number is NaN ("", "-", "1e"). Applying it would
     * clamp to a default and fight the person still typing. */
    if (n.tagName !== 'SELECT' && !Number.isFinite(v)) return;

    if (key === '__target') {
      S.targetAge = Math.round(v);
      /* Typed deliberately, so stop tracking the retirement age. */
      S.targetFollowsRetirement = false;
    }
    else if (key === '__equity') { writeEquity(S.inputs, v); }
    else if (key === '__order') { S.inputs.withdrawalOrder = [...ORDERS[n.value]]; }
    else if (key === '__musicVol') { S.ui.musicVol = v; AudioKit.setMusicVolume(v); }
    else if (key === '__cueVol') { S.ui.cueVol = v; AudioKit.setCueVolume(v); }
    else if (key === '__cueSet') { S.ui.cueSet = n.value; AudioKit.setCueSet(n.value); }
    else if (key === '__idle') { S.ui.idle = n.value; }
    else { setPath(S.inputs, key, v); syncTargetAge(key); }

    recompute();
    if (rerender) renderSettings();
  };

  $$('#setBody [data-set]').forEach((n) => {
    let typing = null;
    n.addEventListener('input', () => {
      /* Debounced so a value is only applied once the person pauses —
       * otherwise typing "200000" applies 2, then 20, then 200 and the
       * chart thrashes through nonsense on the way. */
      clearTimeout(typing);
      typing = setTimeout(() => applySetting(n, { rerender: false }), 400);
    });
    n.addEventListener('change', () => {
      clearTimeout(typing);
      applySetting(n, { rerender: true });
      if (S.ui.cues) AudioKit.cue('commit');
    });
  });

  $$('#setBody [data-tog]').forEach((n) => {
    n.addEventListener('click', () => {
      const key = n.dataset.tog;
      const next = n.getAttribute('aria-checked') !== 'true';
      n.setAttribute('aria-checked', String(next));
      /* Presentation flags live in UI_TOGGLES; anything else is an
       * input and goes into the forecast. One lookup, so a new ui
       * toggle cannot accidentally be written into S.inputs. */
      if (UI_TOGGLES[key]) UI_TOGGLES[key](next);
      else setPath(S.inputs, key, next);
      if (S.ui.cues) AudioKit.cue('commit');
      recompute(); renderSettings();
    });
  });
  const reb = $('#setRebuild');
  if (reb) reb.addEventListener('click', () => { closeAll(); openCreation(true); });
  const csv = $('#btnCsv'); if (csv) csv.addEventListener('click', downloadCsv);
  const js = $('#btnJson'); if (js) js.addEventListener('click', exportJson);
  $$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeSet); save(); renderSettings(); renderAll();
    if (S.ui.cues) AudioKit.cue('confirm');
  }));
  $$('[data-scale]').forEach((b) => b.addEventListener('click', () => {
    applyTextScale(parseFloat(b.dataset.scale));
    save();
    renderSettings();
    /* The chart takes its font sizes in JS, so it must be redrawn. */
    renderAll();
    if (S.ui.cues) AudioKit.cue('confirm');
  }));
  $$('[data-mode-set]').forEach((b) => b.addEventListener('click', () => {
    applyMode(b.dataset.modeSet);
    renderSettings(); renderAll();
    if (S.ui.cues) AudioKit.cue('confirm');
  }));
  const hint2 = $('#btnCheatHint2');
  if (hint2) hint2.addEventListener('click', () => {
    hint2.outerHTML = `<div style="text-align:right">
      <div style="font:12px var(--mono);color:var(--amb);letter-spacing:.08em">${CHEAT_HINT}</div>
      <div class="sr-h" style="margin-top:3px">Press it anywhere. Or click your operator
        ${CHEAT_CLICKS} times.</div></div>`;
  });
  const ta = $('#btnTipsAgain');
  if (ta) ta.addEventListener('click', () => {
    S.ui.tipsDone = false; save(); closeAll(); showFirstRunTips();
  });
  const hfs = $('#btnHelpFromSet');
  if (hfs) hfs.addEventListener('click', () => { closeAll(); openHelp('start'); });

  const ch = $('#btnCheatHint');
  if (ch) ch.addEventListener('click', () => {
    /* The owner of the repo should be able to find their own cheat
     * code. A hidden feature that the person who asked for it cannot
     * reach is just a missing feature. This is two clicks into a page a
     * casual visitor has no reason to open, which is hidden enough. */
    ch.outerHTML = `<div style="text-align:right">
      <div style="font:12px ui-monospace,monospace;color:var(--amb);letter-spacing:.08em">
        ${CHEAT_HINT}</div>
      <div class="sr-h" style="margin-top:3px">Press it anywhere in the app. Or click the
        operator in the top-right corner ${CHEAT_CLICKS} times.</div></div>`;
  });

  const dc = $('#btnDiagCopy');
  if (dc) dc.addEventListener('click', async () => {
    const text = diagText();
    try {
      await navigator.clipboard.writeText(text);
      dc.textContent = 'Copied';
    } catch (e) {
      /* Clipboard access is refused on file:// in some browsers, which
       * is exactly where this tool tends to run. Fall back to showing
       * the text so it can still be selected by hand. */
      dc.outerHTML = `<textarea readonly rows="9"
        style="width:100%;font:var(--fs-xs)/1.5 var(--mono);background:var(--field-bg);
               color:var(--txt);border:1px solid var(--edge);border-radius:2px;
               padding:5px">${text.replace(/</g, '&lt;')}</textarea>`;
    }
    setTimeout(() => { const b = $('#btnDiagCopy'); if (b) b.textContent = 'Copy diagnostics'; }, 1800);
  });
}

/* ============ 6. character creation ============ */
const STEPS = ['Role', 'Life', 'Look', 'Review'];

function openCreation(keepNumbers) {
  S.creationKeep = !!keepNumbers;
  S.creationStep = 0;
  $('#creation').classList.remove('hidden');
  if (S.ui.cues) AudioKit.cue('open');
  renderCreation();
}

function renderCreation() {
  $('#rail').innerHTML = STEPS.map((t, i) => {
    const cls = i < S.creationStep ? 'done' : i === S.creationStep ? 'on' : '';
    return `<div class="step ${cls}"><span class="num">${i < S.creationStep ? '✓' : i + 1}</span>
      <span class="t">${t}</span></div>${i < STEPS.length - 1
        ? `<div class="railbar ${i < S.creationStep ? 'done' : ''}"></div>` : ''}`;
  }).join('');

  const C = S.creationChoice;
  const body = $('#creationBody');
  const hint = $('#creationHint');
  $('#cBack').disabled = S.creationStep === 0;
  $('#cNext').textContent = S.creationStep === STEPS.length - 1 ? 'Begin' : 'Next';
  $('#cRandom').classList.toggle('hidden', S.creationStep === 3);

  if (S.creationStep === 0) {
    hint.textContent = 'Each role exercises a different corner of the model.';
    body.innerHTML = `<div class="roster">${roster().map((r) => `
      <button class="rcard ${r.key === C.occupation ? 'on' : ''}" data-occ="${r.key}">
        ${buildAvatar({ attire: r.attire, size: 84, skinTone: C.skinTone, hairColour: C.hairColour, animated: false })}
        <div class="role">${r.label}</div>
        <div class="pay">${r.medianWage ? fmt(r.medianWage) : '—'}</div>
        <div class="sub">${r.exercises}</div>
      </button>`).join('')}</div>`;
    $$('[data-occ]').forEach((n) => n.addEventListener('click', () => {
      C.occupation = n.dataset.occ; if (S.ui.cues) AudioKit.cue('confirm'); renderCreation();
    }));

  } else if (S.creationStep === 1) {
    hint.textContent = 'Saver percentile is deliberately explicit — median balances mostly do not fund an early exit.';
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) =>
      `<button class="sg ${C[key] === v ? 'on' : ''}" data-ch="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    body.innerHTML = `
      <div class="sr"><div><div class="sr-n">Where you live</div>
        <div class="sr-h">Sets state tax and re-prices the salary.</div></div>
        <div class="sw"><select data-ch="state">${STATE_KEYS().map((k) =>
          `<option value="${k}"${k === C.state ? ' selected' : ''}>${STATE_TAX[k].name}</option>`).join('')}</select></div></div>
      <div style="margin:12px 0 4px" class="sr-n">Career stage</div>
      ${seg('stage', [['early', 'Early'], ['mid', 'Mid'], ['senior', 'Senior'], ['late', 'Late']])}
      <div style="margin:14px 0 4px" class="sr-n">Saver profile</div>
      ${seg('saver', [['p50', 'Median'], ['p75', 'Diligent'], ['p90', 'Strong']])}
      <div class="note" style="margin-top:9px">${SAVER_BEHAVIOUR[C.saver].note}</div>`;
    wireChoice();

  } else if (S.creationStep === 2) {
    hint.textContent = 'Cosmetic only. Presentation picks an SSA longevity table and nothing else.';
    body.innerHTML = `<div class="look">
      <div class="stagebox">${buildAvatar({ attire: OCCUPATIONS[C.occupation].attire,
        skinTone: C.skinTone, hairColour: C.hairColour, build: C.build, size: 210 })}</div>
      <div>
        <div class="orow"><span class="orow-n">Presentation</span>
          <select data-ch="presentation">${[['unspecified', 'Unspecified'], ['masculine', 'Masculine'], ['feminine', 'Feminine']]
            .map(([v, l]) => `<option value="${v}"${C.presentation === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="orow"><span class="orow-n">Skin</span><div class="chips">${AVATAR_SKIN.map((c, i) =>
          `<button class="chip ${C.skinTone === i ? 'on' : ''}" style="background:${c}" data-ch="skinTone" data-v="${i}"></button>`).join('')}</div></div>
        <div class="orow"><span class="orow-n">Hair</span><div class="chips">${AVATAR_HAIR.map((c, i) =>
          `<button class="chip ${C.hairColour === i ? 'on' : ''}" style="background:${c}" data-ch="hairColour" data-v="${i}"></button>`).join('')}</div></div>
        <div class="orow"><span class="orow-n">Build</span>
          <select data-ch="build">${['slim', 'average', 'broad'].map((b) =>
            `<option value="${b}"${C.build === b ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="note" style="margin-top:10px">Attire follows the role — ${OCCUPATIONS[C.occupation].attire}.</div>
      </div></div>`;
    wireChoice();

  } else {
    const built = buildCharacter(C);
    S.pendingCharacter = built;
    hint.innerHTML = '<span style="color:var(--good)">Green</span> measured · '
      + '<span style="color:var(--amb)">Amber</span> derived · badges never fade.';
    body.innerHTML = `<div class="look">
      <div class="stagebox">${buildAvatar({ attire: built.character.attire, skinTone: C.skinTone,
        hairColour: C.hairColour, build: C.build, size: 180, rimLight: true })}</div>
      <div><div class="note" style="margin-bottom:8px">These become your settings. Every one
        stays editable, and the provenance badge never disappears.</div>
        ${built.fields.map((f) => `<div class="fr">
        <span>${f.label}</span>
        <span class="v">${typeof f.value === 'number' && f.value > 1000 ? fmt(f.value)
          : typeof f.value === 'number' && f.value < 1 && f.value > 0 ? pct(f.value)
          : typeof f.value === 'object' ? `${pct(f.value.rate, 0)} to ${pct(f.value.capPct, 0)}`
          : f.value}</span>
        <span class="src ${f.src}">${f.src}</span></div>`).join('')}
        <div class="note" style="margin-top:9px">${built.character.exercises}</div>
      </div></div>
      <div class="note" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--edge)">
        Next you will confirm these in Settings. Nothing is locked in — every value stays
        editable, and the provenance badge stays with it.
      </div>`;
  }
}

function wireChoice() {
  $$('[data-ch]').forEach((n) => {
    const ev = n.tagName === 'SELECT' ? 'change' : 'click';
    n.addEventListener(ev, () => {
      const k = n.dataset.ch;
      S.creationChoice[k] = n.tagName === 'SELECT' ? n.value
        : (/^\d+$/.test(n.dataset.v) ? parseInt(n.dataset.v, 10) : n.dataset.v);
      if (S.ui.cues) AudioKit.cue('confirm');
      renderCreation();
    });
  });
}

function finishCreation() {
  const built = S.pendingCharacter ?? buildCharacter(S.creationChoice);
  S.character = built.character;
  if (!S.creationKeep) {
    S.inputs = { ...defaultInputs(), ...built.inputs };
    S.targetAge = Math.min(built.inputs.currentAge + built.inputs.horizonYears - 1,
      Math.max(65, built.inputs.retirementAge));
  }
  S.prev = null;
  $('#creation').classList.add('hidden');
  if (S.ui.cues) AudioKit.cue('confirm');
  buildControls(); recompute({ noGhost: true });

  /* Hand straight off to Settings, first page, so the numbers the
   * preset just filled in get confirmed by a human rather than
   * silently assumed. */
  S.settingsPage = 'profile';
  openSettings();
}

/* ============ 7. auto-optimise ============ */
function openOptimise() {
  $('#optimise').classList.remove('hidden');
  if (S.ui.cues) AudioKit.cue('open');
  $('#optBody').innerHTML = '<div class="empty">Searching…</div>';
  $('#optNote').textContent = '';
  setTimeout(runOptimise, 40);
}

function runOptimise() {
  let res;
  try {
    res = optimise(S.inputs, {
      targetAge: S.targetAge, mcTrials: 300,
      allowMegaBackdoor: true, allowBackdoorRoth: true,
    });
  } catch (e) {
    $('#optBody').innerHTML = `<div class="empty">Optimiser failed: ${e.message}</div>`;
    return;
  }
  S.lastOpt = res;
  const body = $('#optBody');

  if (!res.moves.length) {
    body.innerHTML = `<div class="empty">Nothing to change — this is already the best
      arrangement the optimiser can find for age ${res.targetAge}.</div>`;
  } else {
    body.innerHTML = `
      <div class="fr" style="border:0"><span><b>Net worth at ${res.targetAge}</b></span>
        <span class="v">${fmt(res.baselineNetWorth)} → ${fmt(res.netWorthAtTarget)}</span>
        <span class="src ${res.gain > 0 ? 'measured' : 'none'}">${res.gain > 0 ? '+' + fmtK(res.gain) : 'no gain'}</span></div>
      ${res.successRate !== null ? `<div class="note" style="margin:2px 0 10px">
        Monte Carlo success ${pct(res.successRate, 1)} — the winner must clear
        ${pct(res.meta.minSuccessRate, 0)} or the risk lever is walked back.
        ${res.meta.riskWalkbacks ? `Walked back ${res.meta.riskWalkbacks}×.` : ''}</div>` : ''}
      ${res.depletedAge ? `<div class="warn-item">Still runs dry at ${res.depletedAge}${
        res.baselineDepletedAge ? ` (was ${res.baselineDepletedAge})` : ''}. No arrangement of
        these levers fixes it — the gap is in income, spending or time.</div>` : ''}
      <div class="lbl" style="margin:12px 0 6px">What it changed, most valuable first</div>
      <div class="note" style="margin-bottom:7px">Nothing is applied until you press Apply,
        and you can take the ideas without taking the button.</div>
      <div class="moves">${res.moves.map((m) => `<div class="move">
        <div><div class="move-l">${m.label}${m.risky ? '<span class="tag amb">risk-bounded</span>' : ''}${
          m.floored ? '<span class="tag">floored</span>' : ''}</div>
          <div class="move-c">${m.from} → ${m.to}</div></div>
        <div class="move-w ${m.neutral ? 'zero' : ''}">${m.neutral ? 'neutral' : '+' + fmt(m.worth)}</div>
        <div class="move-why">${m.why}${m.floored ? ' ' + m.floored : ''}</div>
      </div>`).join('')}</div>
      <div class="note" style="margin-top:10px">
        <b>Spending was not touched</b>, and neither were your salary, age, state or balances.
        Those are facts, not choices — and left free, "maximise net worth" just answers
        "spend nothing".</div>`;
  }
  $('#optNote').textContent =
    `${res.meta.evaluations} simulations · ${res.meta.passes} passes · ${res.meta.ms}ms`
    + (res.violations.length ? ` · VIOLATIONS: ${res.violations.join(', ')}` : '');
  const nothingToDo = !res.moves.length || res.gain <= 0;
  $('#optApply').disabled = nothingToDo;
  /* A greyed button with no explanation reads as a broken button. */
  $('#optApply').title = nothingToDo
    ? 'Nothing to apply — the search found no change worth making'
    : 'Apply every move listed above';
}

/* Which settings page a lever lives on when it is NOT a live control.
 * Four of the optimiser's ten levers are like this — backdoor Roth, the
 * conversion ladder, lot selection and withdrawal order — so applying
 * them changes nothing visible in the control panel, which reads as the
 * optimiser having silently failed. */
const LEVER_HOME = {
  backdoorRoth: 'Contributions',
  afterTax401kEnabled: 'Contributions',
  rothConversionMode: 'Withdrawal strategy',
  rothConversionFillToRate: 'Withdrawal strategy',
  rothConversionStartAge: 'Withdrawal strategy',
  rothConversionEndAge: 'Withdrawal strategy',
  lotSelectionMethod: 'Withdrawal strategy',
  withdrawalOrder: 'Withdrawal strategy',
};

function applyOptimise() {
  if (!S.lastOpt) return;
  const before = clone(S.inputs);
  S.inputs = clone(S.lastOpt.inputs);
  S.prev = S.run;

  /* Open any collapsed group holding a control the optimiser moved. A
   * slider that changed inside a collapsed group is invisible, and the
   * user has no way to know which group to open. */
  const changedLive = LIVE.filter((c) => {
    const a = c.kind === 'equity' ? readEquity(before) : getPath(before, c.key);
    const b = c.kind === 'equity' ? readEquity(S.inputs) : getPath(S.inputs, c.key);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  S.ui.openGroups = S.ui.openGroups || {};
  for (const c of changedLive) S.ui.openGroups[c.group] = true;

  /* And note the ones that have no slider at all, so the panel can say
   * where they went instead of leaving the user hunting. */
  const elsewhere = Object.keys(LEVER_HOME).filter((k) =>
    JSON.stringify(before[k]) !== JSON.stringify(S.inputs[k]));

  $('#optimise').classList.add('hidden');
  if (S.ui.cues) AudioKit.cue('confirm');
  buildControls();
  recompute({ sync: true });

  /* Flash the sliders that moved. Without this, applying three changes
   * across three collapsed groups looks identical to applying nothing. */
  for (const c of changedLive) {
    const i = LIVE.indexOf(c);
    const wrap = $(`.ctl[data-idx="${i}"]`);
    if (!wrap) continue;
    wrap.classList.add('justchanged');
    setTimeout(() => wrap.classList.remove('justchanged'), 2200);
  }
  announceApplied(changedLive, elsewhere);
  save();
}

/* A short, dismissible summary of what moved and where. */
function announceApplied(changedLive, elsewhere) {
  const host = $('#applied');
  if (!host) return;
  const homes = [...new Set(elsewhere.map((k) => LEVER_HOME[k]))];
  if (!changedLive.length && !homes.length) {
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');
  host.innerHTML = `<div class="ap-card">
    <div class="ap-h">Applied</div>
    ${changedLive.length ? `<div class="ap-r"><b>${changedLive.length}</b> live
      control${changedLive.length === 1 ? '' : 's'} updated:
      ${changedLive.map((c) => esc(c.label)).join(', ')}.</div>` : ''}
    ${homes.length ? `<div class="ap-r">Also changed in
      <b>Settings \u203a ${homes.map(esc).join('</b> and <b>')}</b> \u2014
      ${elsewhere.length} setting${elsewhere.length === 1 ? ' with no slider of its own'
        : 's with no sliders of their own'}.</div>` : ''}
    <button class="btn g" id="apDismiss">Got it</button>
  </div>`;
  $('#apDismiss').addEventListener('click', () => host.classList.add('hidden'));
  clearTimeout(announceApplied._t);
  announceApplied._t = setTimeout(() => host.classList.add('hidden'), 9000);
}

/* ============ Monte Carlo ============ */
function runMonteCarlo() {
  const box = $('#chartbox');
  box.innerHTML = '<div class="empty">Running 500 trials…</div>';
  setTimeout(() => {
    S.mc = monteCarlo(S.inputs, { trials: 500, seed: 2026 });
    S.mc.stale = false;
    box.innerHTML = '<canvas id="chart"></canvas>';
    renderAll();
  }, 30);
}

/* ============ export ============ */
function downloadCsv() {
  const cols = [['Year', (r) => r.year], ['Age', (r) => r.age],
    ['Gross income', (r) => D(r.grossIncome)], ['Net worth', (r) => D(r.netWorth)],
    ['Tax', (r) => D(r.tax)], ['Effective rate %', (r) => (r.effectiveTaxRate * 100).toFixed(2)],
    ['Withdrawals', (r) => D(r.withdrawals.total)], ['Roth conversion', (r) => D(r.rothConversion)],
    ['Trad 401k', (r) => D(r.trad401k)], ['Roth total', (r) => D(r.rothTotal)],
    ['Brokerage', (r) => D(r.brokerage)], ['Cash', (r) => D(r.cash)]];
  const csv = [cols.map(([h]) => `"${h}"`).join(',')]
    .concat(S.run.rows.map((r) => cols.map(([, f]) => f(r)).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'forecast.csv'; a.click(); URL.revokeObjectURL(a.href);
}
function exportJson() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(
    [JSON.stringify({ inputs: S.inputs, character: S.character }, null, 2)],
    { type: 'application/json' }));
  a.download = 'forecast-scenario.json'; a.click(); URL.revokeObjectURL(a.href);
}


/* ============ 7c. help, view blurbs, first-run tips ============
 * Six tabs named "Balances / Net worth / Tax / Flow / Bands / Table"
 * tell you nothing about what they contain, and the keyboard map was
 * five cryptic chips. Both audiences were expected to guess. This is
 * the fix: a line of plain English under the active view, a help
 * overlay on `?`, and three dismissible pointers on first run.
 * ============================================================ */

/* What each view actually shows, in words. Shown under the tabs. */
const VIEW_INFO = {
  balances: {
    title: 'Balances',
    note: 'Where your money sits, stacked by account type.',
    help: `Every account you hold, stacked. The height of the stack is everything you own;
      the bands show how it is split between taxable, pre-tax and Roth. Watch the pre-tax
      band — that is the part you still owe tax on.`,
  },
  networth: {
    title: 'Net worth',
    note: 'One line: everything you own, less what you owe.',
    help: `The headline number over time. The dashed line is the same figure excluding
      property, so the gap between them is your home equity. Useful because equity you
      cannot spend without moving is not the same as money in a brokerage account.`,
  },
  tax: {
    title: 'Tax',
    note: 'What you pay each year, split by kind of tax.',
    help: `Federal, capital gains, FICA, state, NIIT and early-withdrawal penalties, stacked
      per year, with your effective rate as a line. The spikes are usually Roth conversions
      or a property sale. This is the view that shows whether a plan is tax-efficient or
      merely large.`,
  },
  flow: {
    title: 'Cash flow',
    note: 'Money in above the line, money out below it.',
    help: `Income and withdrawals sit above zero, spending and tax below. If the bars below
      are taller than the bars above, you are drawing down. The pale line is the net — where
      it dips under zero, the shortfall is coming out of savings.`,
  },
  bands: {
    title: 'Bands',
    note: 'The same plan under 500 random market histories.',
    help: `Everything else on this page assumes one fixed average return every year, which
      never happens. This runs the plan 500 times with randomised returns and shades the
      range of outcomes. The middle line is the median; the shaded edges are the best and
      worst tenth. A plan that only works in the middle of this band is a plan that depends
      on luck.`,
  },
  table: {
    title: 'Table',
    note: 'Every year, every number. Exportable to CSV.',
    help: `The whole forecast as rows, one per year. If you want to check the arithmetic,
      hand it to an accountant, or pull it into a spreadsheet, start here — Settings ›
      Display has the CSV export.`,
  },
};

/* One way to change view, used by the tabs, the status strip and the
 * help overlay — so the tab highlight, the canvas reset and the
 * description line can never disagree about which view is showing. */
function setView(v) {
  if (!VIEW_INFO[v]) return;
  S.view = v;
  $$('#vtabs .vt').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
  if (v !== 'bands') $('#chartbox').innerHTML = '<canvas id="chart"></canvas>';
  renderViewNote();
  renderChart();
  if (S.ui.cues) AudioKit.cue('tickUp');
}

/* What each view honestly shows while comparing. The Bands entry is the
 * important one: Monte Carlo is computed for the live inputs only, and
 * 500 trials times four profiles would freeze the page, so the fan stays
 * the active profile's and the comparators contribute deterministic
 * lines across it. Saying so is better than implying four fans. */
const COMPARE_NOTE = {
  balances: 'Comparing: the open profile is faded, each pinned profile shows as total assets.',
  networth: 'Comparing: one net-worth line per pinned profile.',
  tax: 'Comparing: the open profile is faded, each pinned profile shows as annual total tax.',
  flow: 'Comparing: the open profile is faded, each pinned profile shows as net cash flow.',
  bands: 'Comparing: one net-worth line per pinned profile. Run Monte Carlo for a '
       + 'range, which is only ever computed for the open profile.',
  table: 'Comparing: the figures below are side by side.',
};

/* One line per pinned profile, in the profile's colour, on the view's
 * own y axis. Deliberately the same mechanism for five of the six
 * views: it changes no chart type, needs no second renderer, and is
 * already proven — the Flow view has always drawn a non-stacked Net line
 * over stacked bars. */
/* The x axis while comparing is the UNION of every pinned profile's
 * years plus the open one's. Building it from S.run.rows alone silently
 * cropped any profile with a longer horizon, so "retire at 55 over 20
 * years" against "retire at 65 over 40" showed whichever happened to be
 * open and dropped the rest without a word. */
function compareYears() {
  const years = new Set(S.run ? S.run.rows.map((r) => r.year) : []);
  for (const p of pinnedProfiles()) for (const r of profileRun(p).rows) years.add(r.year);
  return [...years].sort((a, b) => a - b);
}

function compareSeries(view) {
  const picks = {
    balances: (r) => D(r.trad401k + r.roth401k + r.tradIra + r.rothIra
      + r.hsa + r.brokerage + r.cash + r.commodities + r.crypto + r.c529),
    networth: (r) => D(r.netWorth),
    tax: (r) => D(r.tax),
    flow: (r) => D(r.netCashFlow),
    bands: (r) => D(r.netWorth),
  };
  const pick = picks[view];
  if (!pick) return [];
  const axis = compareYears();
  return pinnedProfiles().map((p) => {
    const rows = profileRun(p).rows;
    /* Keyed by YEAR, not index. Padding a shorter profile with nulls
     * let the SVG renderer coerce them to zero, so its line dived to the
     * baseline at the end — a comparison that invented a bankruptcy. */
    const byYear = new Map(rows.map((r) => [r.year, pick(r)]));
    return {
      label: p.name,
      data: axis.map((y) => (byYear.has(y) ? byYear.get(y) : null)),
      borderColor: colourOf(p),
      borderWidth: 2.2, pointRadius: 0, fill: false, tension: .2,
      spanGaps: false, order: 0,
      type: 'line', yAxisID: undefined,
    };
  });
}

/* Fade the active profile's own detail so the comparison lines read on
 * top of it, rather than hiding it — the stack is still the only thing
 * that answers "where does the money sit". */
/* Fade a colour by rewriting its alpha, whatever notation it is in.
 * The first version only matched an '#rrggbbcc' suffix, which only the
 * Balances series produces — so four of the five views were not dimmed
 * at all while two of the on-screen notes claimed they were. */
function fade(colour, alpha) {
  if (typeof colour !== 'string') return colour;
  const c = colour.trim();
  if (c === 'transparent' || c === 'none') return c;
  let m = c.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = [...m[1]].map((h) => parseInt(h + h, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    const a = p.length > 3 ? p[3] : 1;
    return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${(a * alpha).toFixed(3)})`;
  }
  return c;
}

/* Fade the open profile's own detail so the comparison lines read on
 * top of it, rather than hiding it — the stack is still the only thing
 * that answers "where does the money sit". */
function dimForCompare(datasets) {
  return datasets.map((d) => ({
    ...d,
    backgroundColor: fade(d.backgroundColor, 0.28),
    borderColor: fade(d.borderColor, 0.35),
    borderWidth: d.borderWidth ? Math.min(d.borderWidth, 1) : d.borderWidth,
  }));
}

function renderViewNote() {
  const v = VIEW_INFO[S.view];
  const n = $('#vpNote');
  if (!n || !v) return;
  if (comparing()) {
    n.textContent = COMPARE_NOTE[S.view] || v.note;
    n.classList.add('cmp');
    return;
  }
  n.classList.remove('cmp');
  const extra = S.view === 'bands' ? ''
    : (S.prev ? ' Ghost line = before your last change.' : '');
  n.textContent = v.note + extra;
}

const HELP_PAGES = [
  ['start', 'Getting started'], ['views', 'The six views'], ['profiles', 'Profiles'],
  ['keys', 'Keyboard'], ['terms', 'Plain English'], ['trust', 'What to trust'],
];

function helpPage(id) {
  const kb = (k, what) => `<div class="sr"><div><div class="sr-n"><kbd>${k}</kbd></div></div>
    <div class="sw" style="text-align:left;color:var(--dim)">${what}</div></div>`;
  const term = (t, d) => `<div class="sr"><div><div class="sr-n">${t}</div>
    <div class="sr-h">${d}</div></div><div class="sw"></div></div>`;

  switch (id) {
    case 'start': return `
      <div class="helplead">You are looking at a forecast of your own finances, year by year,
        to age ${S.inputs.currentAge + S.inputs.horizonYears - 1}. Everything runs in this
        browser; nothing is uploaded anywhere.</div>
      <div class="grp">Three things, in order</div>
      ${[`<b>Tell it about you.</b> <b>Settings</b> (or the <kbd>S</kbd> key) holds your age, `
        + `income, balances and state. ${PAGES.length} pages, and an amber dot marks any page `
        + `you have changed from the default.`,
        `<b>Pull the sliders.</b> The panel on the left holds ${LIVE.length} live controls in `
        + `${LIVE_GROUPS.length} groups — the choices that matter most. Every chart and figure `
        + `updates as you drag, and a ghost line shows where you were before the change.`,
        '<b>Read the verdict.</b> The top strip is the summary: net worth at your target age, '
        + 'lifetime tax, and whether the plan survives the horizon. If it says <b>DRY</b>, the '
        + 'money runs out before the end — the <b>Table</b> view shows which year.']
        .map((t, i) => `<div class="helpstep"><span class="hs-n">${i + 1}</span><div>${t}</div></div>`).join('')}
      <div class="grp">If you would rather not start from scratch</div>
      <div class="note"><b>Character</b> (the <kbd>C</kbd> key) fills every setting from published
        medians for a job, a state and a saving habit — a reasonable starting point you then
        edit. It is a shortcut, not a recommendation.</div>`;

    case 'views': return `
      <div class="helplead">The tabs above the chart. Each answers a different question. With two
      or more profiles pinned in the bar, every one of them also overlays your pinned
      profiles for comparison.</div>
      ${Object.entries(VIEW_INFO).map(([k, v]) => `
        <div class="sr"><div style="max-width:none">
          <div class="sr-n">${v.title}${k === S.view ? ' <span class="src measured">showing</span>' : ''}</div>
          <div class="sr-h" style="line-height:1.5">${v.help}</div>
        </div></div>`).join('')}
      <div class="grp">The scrubber</div>
      <div class="note">The slider under the chart picks a single year. The right-hand column
        then decomposes that one year completely: every source of money in, every destination
        out, the tax breakdown, any conversions, RMDs or penalties, and any warnings.
        On a narrow window that column moves below the chart.</div>`;

    case 'profiles': return `
      <div class="helplead">A profile is a complete saved plan — every setting, the target age,
        and the character if you built one. The bar above the chart holds them.</div>
      <div class="grp">The bar</div>
      <div class="note"><b>Click a name</b> to open that profile; its settings become the live
        ones. <b>Click the coloured dot</b> to pin it onto the charts. Pin two or more and you
        are comparing — there is no separate button, because the pinned set <i>is</i> the
        mode.</div>
      <div class="grp">What comparing shows</div>
      <div class="note">Your open profile fades and each pinned profile draws as one line, in
        its own colour, on whichever view you are on: total assets on Balances, net worth on
        Net worth, annual tax on Tax, net cash flow on Flow. The <b>Table</b> view adds a
        side-by-side summary. A tick marks the better figure only where better is unambiguous
        — retirement age and the year the money runs out are left unmarked, because neither
        direction is good or bad on its own.</div>
      <div class="grp">Worth knowing</div>
      <div class="note">Up to ${MAX_COMPARE} at once. Profiles with different horizons share one
        axis and the shorter line simply stops. The shaded range on <b>Bands</b> is only ever
        your open profile — Monte Carlo is far too slow to run for four. Rename, duplicate and
        delete live under <b>Manage…</b>, and deleting needs two clicks.</div>`;

    case 'keys': return `
      <div class="helplead">Nothing here is only reachable by keyboard — every key has a button
        somewhere. These are just faster.</div>
      <div class="grp">Always</div>
      ${kb('?', 'This help')}
      ${kb('S', 'Settings')}
      ${kb('C', 'Character — fill the settings from a preset')}
      ${kb('P', 'Profiles — switch, compare, manage')}
      ${kb('Esc', 'Close whatever is open')}
      <div class="grp">On the dashboard</div>
      ${kb('1 \u2013 9', `Focus one of the first nine of ${LIVE.length} live controls`)}
      ${kb('[  ]', 'Step through all of them')}
      ${kb('\u2191 \u2193', 'Adjust the focused control')}
      ${kb('\u2190 \u2192', 'Move the year scrubber')}
      ${kb('M', 'Mute everything')}
      ${S.ui.cheatUnlocked ? `<div class="grp">Unlocked</div>${kb('O', 'Auto-optimise')}` : ''}`;

    case 'terms': return `
      <div class="helplead">The words this tool uses, without the jargon.</div>
      ${term('Pre-tax (traditional)', 'Money you have not paid income tax on yet — a normal '
        + '401(k) or IRA. You pay tax when you take it out, at whatever your rate is then.')}
      ${term('Roth', 'Money you already paid tax on. It grows and comes out tax-free. Worth more '
        + 'per dollar than pre-tax, which is why the balances chart separates them.')}
      ${term('Taxable / brokerage', 'An ordinary investment account. You owe tax on dividends '
        + 'each year, and on gains when you sell.')}
      ${term('Capital gains', 'Profit on something you sold. Held over a year, it is taxed at '
        + 'lower rates than wages — sometimes at 0%.')}
      ${term('Effective tax rate', 'Total tax divided by total income. Lower than your bracket, '
        + 'because only the top slice of your income is taxed at the top rate.')}
      ${term('Mega backdoor', 'Extra after-tax money into a 401(k) above the normal limit, then '
        + 'converted to Roth. Only possible if your employer plan allows it.')}
      ${term('RMD', 'Required minimum distribution. From your mid-seventies the law makes you '
        + 'withdraw a slice of pre-tax accounts each year whether you want it or not.')}
      ${term('Sequence risk', 'Bad returns early in retirement hurt far more than the same bad '
        + 'returns later, because you are selling while prices are down. This is what the '
        + 'Bands view is really showing you.')}
      ${term('Safe withdrawal rate', 'The share of your savings you can spend each year with a '
        + 'reasonable chance of not running out. Rules of thumb hover near 4%, and the Bands '
        + 'view is a better answer than any rule of thumb.')}`;

    case 'trust': return `
      <div class="helplead">This is a planning estimate, not tax or investment advice, and the
        honest answer about accuracy is mixed. Here is where the line falls.</div>
      <div class="grp">Reliable</div>
      <div class="note">The arithmetic. Every amount is held as whole cents, so nothing drifts.
        Federal brackets, the standard deduction, FICA, contribution and 415(c) limits, capital
        gains brackets and the RMD ages are the published 2026 figures, in one file you can
        read. Withdrawals solve the circular problem properly: taking money out creates taxable
        income, which raises the tax, which raises what you must take out.</div>
      <div class="grp">Simplified</div>
      <div class="note">State tax is a flat rate per state, not real brackets. No AMT, no
        itemised deductions, no credits, no QBI, no local tax. Health insurance before Medicare
        is not modelled and is a genuinely large number if you retire early.</div>
      <div class="grp">Guesswork</div>
      <div class="note">Every return and inflation figure is an assumption you typed. The
        forecast is arithmetic performed on guesses — precise, which is not the same as
        accurate. Change them and watch how much the answer moves; that spread is the real
        result. Before acting on any of it, put it in front of a CPA.</div>`;

    default: return '';
  }
}

function openHelp(page) {
  S.helpPage = page || S.helpPage || 'start';
  $('#help').classList.remove('hidden');
  if (S.ui.cues) AudioKit.cue('open');
  renderHelp();
}

function renderHelp() {
  $('#helpNav').innerHTML = HELP_PAGES.map(([id, label]) =>
    `<button class="ni ${id === S.helpPage ? 'on' : ''}" data-hpage="${id}">${label}</button>`).join('');
  $('#helpBody').innerHTML = helpPage(S.helpPage);
}

/* Three pointers on first run, dismissed for good once read. Shown
 * instead of a tour: a tour you cannot skip is worse than no tour. */
/* A static card, not anchored pointers — `sel` was dead data the
 * renderer never read, and the comment claiming otherwise was the only
 * reason `#cmd` existed as an id. */
const TIPS = [
  'Drag the sliders on the left. Everything updates as you go.',
  'Six ways to read the same forecast. Press <b>?</b> if a name means nothing.',
  'Your age, income and balances live in <b>Settings</b>.',
  'Save a plan as a <b>profile</b>, then pin two to compare them on the charts.',
];

function showFirstRunTips() {
  if (S.ui.tipsDone) return;
  const host = $('#tips');
  if (!host) return;
  host.classList.remove('hidden');
  host.innerHTML = `<div class="tipcard">
      <div class="tip-h">A quick orientation</div>
      ${TIPS.map((t) => `<div class="tip-r"><span class="tip-d"></span><div>${t}</div></div>`).join('')}
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="btn p" id="tipsGo" style="flex:1">Got it</button>
        <button class="btn g" id="tipsHelp">Full help</button>
      </div>
    </div>`;
  const done = () => { S.ui.tipsDone = true; save(); host.classList.add('hidden'); };
  $('#tipsGo').addEventListener('click', done);
  $('#tipsHelp').addEventListener('click', () => { done(); openHelp('start'); });
}

/* ============ 7a2. text size ============
 * One multiplier on the CSS type scale, so every size in the interface
 * moves together — and the chart fonts with it, since a chart whose
 * axis labels stay at 11px while everything else grows just looks
 * broken.
 * ============================================================ */
const TEXT_SCALES = [
  [1, 'Normal'], [1.15, 'Large'], [1.3, 'Larger'], [1.5, 'Largest'],
];

function applyTextScale(v) {
  const n = Math.min(1.5, Math.max(1, Number(v) || 1));
  S.ui.textScale = n;
  /* Guarded. This runs during boot, and boot dying because one styling
   * call failed is precisely the cascade pattern already fixed twice in
   * this file — an accessibility setting must never be able to take the
   * whole app down with it. */
  const el = document.documentElement;
  if (el && el.style && el.style.setProperty) el.style.setProperty('--ui-scale', String(n));
}

/* Chart.js is given pixel sizes in JS, not CSS, so it has to be told
 * separately or the chart ignores the setting entirely. */
const chartFont = (base) => Math.round(base * (S.ui.textScale || 1));


/* ============ 7a2b. theme ============
 * One attribute on <html>; every colour in the sheet reads from custom
 * properties, so a theme is a palette swap rather than a second
 * stylesheet. The charts take their colours in JavaScript, so they are
 * told separately — otherwise the axis text stays pale grey and
 * vanishes against white.
 * ============================================================ */
const THEMES = { dark: 'Dark', light: 'Light' };

function applyTheme(name) {
  const t = THEMES[name] ? name : 'dark';
  S.ui.theme = t;
  const el = document.documentElement;
  if (el && el.setAttribute) {
    if (t === 'light') el.setAttribute('data-theme', 'light');
    else el.removeAttribute('data-theme');
  }
  const btn = $('#btnTheme');
  if (btn) {
    /* The button shows what you would switch TO, not what you are on —
     * a toggle labelled with its current state is read as a status. */
    btn.textContent = t === 'light' ? '\u25D1 Dark' : '\u25D0 Light';
    btn.title = t === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme';
  }
}

function toggleTheme() {
  applyTheme(S.ui.theme === 'light' ? 'dark' : 'light');
  save();
  /* Chart.js bakes colours into its config at construction, so the
   * chart has to be rebuilt rather than merely restyled. */
  renderAll();
  if (S.ui.cues) AudioKit.cue('tickUp');
}

/* Chart colours that must differ per theme. Pale grey axis text is
 * invisible on white; a near-black grid is invisible on the dark one. */
/* Every colour the charts draw with lives here, both themes side by
 * side. Anything hard-coded in a chart config is a colour that will be
 * wrong on one of the two themes — an audit found ten of them, including
 * the Flow view's headline net line (dark-theme white, invisible on
 * light) and the scrubber cursor mark (invisible on light on every
 * view). `markers` and `net` double as TEXT fills, so they must clear a
 * reading contrast, not merely a graphic one. */
const INK = {
  light: {
    axis: '#44586c', grid: 'rgba(23,62,102,.14)', zero: 'rgba(23,62,102,.38)',
    tip: '#ffffff', tipText: '#15202b', tipTitle: '#0b6fa8',
    legend: '#44586c', net: '#0b6fa8', muted: '#44586c',
    retire: '#9a5b00', dry: '#c0304a', cursor: 'rgba(21,32,43,.45)',
    area: 'rgba(11,111,168,.14)', bandInner: 'rgba(11,111,168,.26)',
    bandOuter: 'rgba(11,111,168,.14)', fallback: '#0b6fa8',
  },
  dark: {
    axis: '#5b6e87', grid: 'rgba(86,175,255,.08)', zero: 'rgba(134,153,175,.45)',
    tip: '#0d1524', tipText: '#d9e6f5', tipTitle: '#5ec8ff',
    legend: '#8699af', net: '#5ec8ff', muted: '#8699af',
    retire: '#ffa62b', dry: '#fb7185', cursor: 'rgba(217,230,245,.5)',
    area: 'rgba(94,200,255,.12)', bandInner: 'rgba(94,200,255,.22)',
    bandOuter: 'rgba(94,200,255,.13)', fallback: '#5ec8ff',
  },
};
const themeInk = () => INK[S.ui.theme === 'light' ? 'light' : 'dark'];

/* ============ 7a3. profiles ============
 * Named snapshots you can switch between and compare. Restored after
 * being dropped in the HUD redesign.
 *
 * The live inputs are never the same object as a stored profile's: the
 * profile is cloned on save and on load. Sharing the reference would
 * mean dragging a slider silently rewrote the profile you were
 * comparing against.
 * ============================================================ */
let P = { list: [], activeId: null, compareIds: [] };

/* Profile names are user text rendered into HTML. Escaped on the way
 * out — the names live in this browser only, but a name containing
 * markup would still break the page for the person who typed it. */
const esc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function profilesInit() {
  P = loadProfiles();
  renderProfBar();
}

const activeProfile = () => P.list.find((p) => p.id === P.activeId) || null;

function persistProfiles() { saveProfiles(P); }

/* Only a write to a profile's INPUTS can stale the cache. Clearing it
 * from persistProfiles meant every pin, unpin, rename and clear threw
 * away four forty-year simulations and recomputed them synchronously
 * before the next redraw. */
function invalidateRun(id) {
  if (id) runCache.delete(id); else runCache = new Map();
}

/* Write the live state into the active profile. Called before
 * switching away, so edits are not silently discarded. */
function syncActiveProfile() {
  const p = activeProfile();
  if (!p) return;
  /* Only write back when the live inputs demonstrably came from this
   * profile. A second tab, or a reload where the state blob and the
   * active profile have diverged, otherwise destroys the saved plan. */
  if (S.inputsFromProfile !== p.id) return;
  p.inputs = cloneProfileData(S.inputs);
  p.targetAge = S.targetAge;
  p.character = S.character ? cloneProfileData(S.character) : null;
  invalidateRun(p.id);
  persistProfiles();
}

function profileSaveAs(name) {
  const nm = uniqueName(P.list, name);
  if (P.list.length >= MAX_PROFILES) {
    return { ok: false, why: `That is the ${MAX_PROFILES}-profile limit. Delete one first.` };
  }
  const p = makeProfile(nm, S.inputs, S.targetAge, S.character, P.list.length);
  P.list.push(p);
  P.activeId = p.id;
  S.inputsFromProfile = p.id;      // these inputs now belong to it
  persistProfiles();
  renderProfBar();
  return { ok: true, profile: p };
}

function profileSwitch(id) {
  const p = P.list.find((x) => x.id === id);
  if (!p) return false;
  syncActiveProfile();                 // keep edits to the one we are leaving
  P.activeId = id;
  S.inputsFromProfile = id;
  S.inputs = { ...defaultInputs(), ...cloneProfileData(p.inputs) };
  S.targetAge = p.targetAge ?? S.targetAge;
  S.character = p.character ? cloneProfileData(p.character) : null;
  S.prev = null;                       // a ghost from another profile is a lie
  S.mc = null;
  persistProfiles();
  save();
  buildControls();
  /* recompute -> renderAll already rebuilds the bar; calling it here as
   * well built it twice on every switch. */
  recompute({ noGhost: true, sync: true });
  return true;
}

function profileDelete(id) {
  const i = P.list.findIndex((x) => x.id === id);
  if (i < 0) return;
  P.list.splice(i, 1);
  P.compareIds = P.compareIds.filter((x) => x !== id);
  if (P.activeId === id) {
    /* Deleting the active profile leaves the live inputs alone — they
     * are still a perfectly good unsaved plan — and detaches. `detached`
     * is persisted because otherwise loadProfiles' "fall back to the
     * first profile" rule would mark an unrelated profile as open while
     * the live inputs still held the deleted one's plan, and the next
     * sync would overwrite it. */
    P.activeId = null;
    P.detached = true;
    S.inputsFromProfile = null;
  }
  persistProfiles();
  renderProfBar();
}

function profileRename(id, name) {
  const p = P.list.find((x) => x.id === id);
  if (!p) return;
  p.name = uniqueName(P.list.filter((x) => x.id !== id), name);
  persistProfiles();
  renderProfBar();
}

function profileDuplicate(id) {
  const p = P.list.find((x) => x.id === id);
  if (!p || P.list.length >= MAX_PROFILES) return;
  const copy = makeProfile(uniqueName(P.list, p.name + ' copy'),
    p.inputs, p.targetAge, p.character, P.list.length);
  P.list.push(copy);
  persistProfiles();
}

function toggleCompare(id) {
  const i = P.compareIds.indexOf(id);
  if (i >= 0) P.compareIds.splice(i, 1);
  else if (P.compareIds.length < MAX_COMPARE) P.compareIds.push(id);
  persistProfiles();
}

/* The compare set IS the mode: two or more pinned profiles means
 * compare mode. No separate button to get into a state you can already
 * see. */
const comparing = () => P.compareIds.length >= 2;

const pinnedProfiles = () => P.compareIds
  .map((id) => P.list.find((p) => p.id === id)).filter(Boolean);

/* A profile's colour as it should render in the current theme. */
const colourOf = (p) => profileColour(p.colour, S.ui.theme);

/* Comparator runs are expensive and the inputs are frozen snapshots, so
 * they are cached by profile id. Invalidated wholesale whenever
 * profiles are written, which is the only way their inputs change. */
let runCache = new Map();
function profileRun(p) {
  /* The profile you are editing compares as what is on screen, not as
   * the snapshot it was saved from. A stored profile's inputs are only
   * refreshed on switch, so pinning the open profile used to draw it
   * twice — once dimmed and live, once solid and stale — and the status
   * strip and the matrix then showed two different figures under one
   * name. */
  if (p.id === P.activeId && S.run) return S.run;
  if (!runCache.has(p.id)) runCache.set(p.id, simulate(p.inputs));
  return runCache.get(p.id);
}

/* Everything a change to the profile set has to refresh. Extracted
 * because the bar and the Manage overlay each used to refresh a
 * different subset: ticking a compare box in the overlay updated the
 * bar but not the chart, the note or the strip, so the screen said
 * "comparing" and "not comparing" in four places at once.
 *
 * Routed through renderAll rather than calling the renderers directly,
 * so a null S.run cannot throw out of a click handler — the per-step
 * isolation in renderAll exists for exactly that. */
function refreshComparisonViews() {
  renderAll();
  if (S.view === 'table') renderTable();
}

function renderProfBar() {
  const bar = $('#pbar');
  if (!bar) return;
  bar.classList.toggle('comparing', comparing());

  /* Order is derived: active first, then pinned in pin order, then the
   * rest by name. Stable, and the chip you are working in is always
   * reachable without scrolling. */
  const rank = (p) => (p.id === P.activeId ? 0
    : P.compareIds.includes(p.id) ? 1 + P.compareIds.indexOf(p.id) : 99);
  const ordered = P.list.slice().sort((a, b) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name));

  const chips = ordered.map((p) => {
    const pinned = P.compareIds.includes(p.id);
    const active = p.id === P.activeId;
    const col = colourOf(p);
    const full = !pinned && P.compareIds.length >= MAX_COMPARE;
    const alone = P.list.length < 2;
    return `<span class="pchip ${active ? 'on' : ''} ${pinned ? 'pinned' : ''}"
                  style="--pc:${col}">
      <button class="pc-dot" data-pin="${p.id}" aria-pressed="${pinned}"
              ${full || alone ? 'disabled' : ''}
              title="${alone ? 'Needs a second profile to compare'
                     : full ? `That is ${MAX_COMPARE} already`
                     : pinned ? 'Remove from the chart' : 'Show on the chart'}">
        <span class="pc-d"></span></button>
      <button class="pc-nm" data-open="${p.id}" ${active ? 'aria-current="true"' : ''}
              title="${active ? 'Open' : 'Switch to this profile'}">${esc(p.name)}</button>
    </span>`;
  }).join('');

  /* The bar always renders, even with nothing saved — it is now the
   * only discovery surface for the feature, and a bar that appears
   * later is a bar nobody finds. */
  const none = !P.list.length;
  const unsaved = !activeProfile();
  bar.innerHTML = `
    <div class="pb-strip" id="pbStrip">
      ${none ? '<span class="pchip ghost"><span class="pc-nm">Live plan \u2014 unsaved</span></span>' : chips}
      ${!none && unsaved ? '<span class="pchip ghost"><span class="pc-nm">Live plan \u2014 unsaved</span></span>' : ''}
    </div>
    <div class="pb-acts">
      ${comparing() ? `<button class="btn amb pb-pill" id="pbClear"
          title="Stop comparing">Comparing \u00d7${P.compareIds.length} \u2715</button>` : ''}
      <button class="btn g" id="pbSave">${none ? 'Save as profile\u2026' : 'Save as new\u2026'}</button>
      <button class="btn g" id="pbManage" title="Rename, duplicate, delete">Manage\u2026</button>
    </div>`;

  $$('[data-open]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.open === P.activeId) return;
    profileSwitch(b.dataset.open);
    if (S.ui.cues) AudioKit.cue('commit');
  }));
  $$('[data-pin]').forEach((b) => b.addEventListener('click', () => {
    toggleCompare(b.dataset.pin);
    refreshComparisonViews();
    if (S.ui.cues) AudioKit.cue(comparing() ? 'tickUp' : 'tickDown');
  }));
  const clear = $('#pbClear');
  if (clear) clear.addEventListener('click', () => {
    P.compareIds = [];
    persistProfiles();
    refreshComparisonViews();
  });
  $('#pbSave').addEventListener('click', promptSaveProfile);
  $('#pbManage').addEventListener('click', openProfiles);
}

function promptSaveProfile() {
  const suggested = S.character ? S.character.occupationLabel : 'My plan';
  const name = window.prompt('Name this profile', uniqueName(P.list, suggested));
  if (name === null) return;
  const r = profileSaveAs(name);
  if (!r.ok) { window.alert(r.why); return; }
  renderProfBar();
  if (S.ui.cues) AudioKit.cue('confirm');
}

/* ---------- the overlay ---------- */
function openProfiles() {
  /* Re-read storage on open. Profiles are loaded once at boot, so a
   * second tab that saved a profile would otherwise be invisible here
   * until a reload — and the panel claiming a profile does not exist
   * is worse than a moment's staleness. The in-memory selection wins
   * where it still resolves, so opening the panel never moves which
   * profile you are working in. */
  const disk = loadProfiles();
  const ids = new Set(disk.list.map((p) => p.id));
  P = {
    list: disk.list,
    activeId: ids.has(P.activeId) ? P.activeId : disk.activeId,
    compareIds: (P.compareIds.length ? P.compareIds : disk.compareIds)
      .filter((id) => ids.has(id)).slice(0, MAX_COMPARE),
  };
  syncActiveProfile();
  $('#profiles').classList.remove('hidden');
  if (S.ui.cues) AudioKit.cue('open');
  renderProfiles();
}

function renderProfiles() {
  /* The bar is the primary surface now, so every change made in this
   * overlay has to reach it. Without this, renaming or deleting here
   * left the chips showing the old names until something else happened
   * to re-render — and opening the overlay re-reads storage, so even
   * just opening and closing it could leave the bar stale. */
  renderProfBar();
  const host = $('#profBody');
  const act = P.activeId;
  const rows = P.list.map((p) => {
    const on = P.compareIds.includes(p.id);
    return `<div class="prow ${p.id === act ? 'active' : ''}">
      <label class="pcheck">
        <input type="checkbox" data-cmp="${p.id}" ${on ? 'checked' : ''}
               ${!on && P.compareIds.length >= MAX_COMPARE ? 'disabled' : ''}>
        <span class="pdot" style="background:${colourOf(p)}"></span>
      </label>
      <div class="pmain">
        <input class="pname" data-rename="${p.id}" value="${esc(p.name)}" aria-label="Profile name">
        <div class="sr-h">retires ${p.inputs.retirementAge} ·
          ${esc(STATE_TAX[p.inputs.stateCode] ? STATE_TAX[p.inputs.stateCode].name : p.inputs.stateCode)} ·
          ${fmt(p.inputs.salary)} salary${p.character ? ' · ' + esc(p.character.occupationLabel || '') : ''}</div>
      </div>
      <div class="pacts">
        ${p.id === act ? '<span class="src measured">open</span>'
          : `<button class="btn g" data-load="${p.id}">Open</button>`}
        <button class="btn g" data-dup="${p.id}" title="Duplicate">Copy</button>
        <button class="btn g pdel" data-del="${p.id}" title="Delete">Delete</button>
      </div>
    </div>`;
  }).join('');

  host.innerHTML = `
    <div class="helplead">A profile is a complete saved plan — every setting, the target age,
      and the character if you built one. Switch between your own variants, or keep a few
      side by side. Nothing leaves this browser.</div>
    ${P.list.length ? `<div class="plist">${rows}</div>`
      : `<div class="empty" style="padding:30px 10px">No profiles saved yet.<br><br>
          <b>Save current as new…</b> at the bottom stores what you have now, and you can
          then change the settings and save a second one to compare against.</div>`}
    ${activeProfile() ? '' : `<div class="note" style="margin-top:12px">
      Your current plan is <b>not</b> saved to a profile. Changes to it will not be kept
      under any name until you save it.</div>`}
    <div class="note" style="margin-top:12px">
      ${P.compareIds.length} of ${MAX_COMPARE} shown on the chart.
      Use the coloured dots in the bar above the chart to add or remove them.
    </div>`;

  $('#profNote').textContent = `${P.list.length} profile${P.list.length === 1 ? '' : 's'}`;

  $$('[data-load]').forEach((b) => b.addEventListener('click', () => {
    profileSwitch(b.dataset.load);
    renderProfiles();
    if (S.ui.cues) AudioKit.cue('commit');
  }));
  $$('[data-dup]').forEach((b) => b.addEventListener('click', () => {
    profileDuplicate(b.dataset.dup); renderProfiles(); refreshComparisonViews();
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
    /* Two-step, because a profile is somebody's work and a stray click
     * on a delete button should not be able to end it. */
    if (b.dataset.armed === '1') {
      profileDelete(b.dataset.del); renderProfiles(); refreshComparisonViews(); return;
    }
    b.dataset.armed = '1';
    b.textContent = 'Sure?';
    b.classList.add('amb');
    setTimeout(() => {
      if (!b.isConnected) return;
      b.dataset.armed = ''; b.textContent = 'Delete'; b.classList.remove('amb');
    }, 3000);
  }));
  $$('[data-cmp]').forEach((c) => c.addEventListener('change', () => {
    toggleCompare(c.dataset.cmp); renderProfiles(); refreshComparisonViews();
  }));
  $$('[data-rename]').forEach((n) => n.addEventListener('change', () => {
    profileRename(n.dataset.rename, n.value); renderProfiles(); refreshComparisonViews();
  }));
}

/* ============ 7b. modes ============
 * Applying a mode writes the handful of ui flags it implies. It never
 * touches S.inputs — a mode changes presentation, never a number in
 * the forecast. That boundary is what makes it safe to switch at any
 * time, and there is a test asserting it.
 * ============================================================ */
const MODES = {
  pro: {
    label: 'Planner',
    blurb: 'Straight to the numbers. No audio, no avatar, every tool on the toolbar.',
    ui: { music: false, cues: false, bay: false, bayFx: false, idle: 'off',
          cheatUnlocked: true, plainLabels: true },
  },
  arcade: {
    label: 'Arcade',
    blurb: 'The full HUD: hype soundtrack, your operator in the corner, and a cheat code to find.',
    /* cheatUnlocked is deliberately absent. Listing it as `false` meant
     * switching Planner -> Arcade RE-LOCKED a cheat code the person had
     * already earned, which is just taking something away. */
    ui: { music: true, cues: true, bay: true, bayFx: true, idle: 'subtle',
          plainLabels: false },
  },
};

function applyMode(name, opts = {}) {
  const m = MODES[name];
  if (!m) return;
  S.ui.mode = name;
  /* Switching INTO a mode applies its defaults. Switching away leaves
   * the user's later tweaks alone unless they ask for a reset — so
   * someone who turned music back on in Planner mode keeps it. */
  if (!opts.keepTweaks) Object.assign(S.ui, m.ui);
  document.body.classList.toggle('plain', !!S.ui.plainLabels);
  /* Text size is an accessibility choice, not a mode flavour — a mode
   * switch must never quietly shrink the interface back. */
  applyTextScale(S.ui.textScale);
  /* Theme, like text size, is the person's choice and not a mode
   * flavour — switching mode must not repaint the interface. */
  applyTheme(S.ui.theme);
  AudioKit.setCueVolume(S.ui.cueVol);
  AudioKit.setMusicVolume(S.ui.musicVol);

  /* The audio engine has to be told, not just the ui flag set. The
   * first cut only wrote S.ui.cues, so Planner mode still clicked and
   * beeped — the flag said quiet and the engine disagreed. */
  AudioKit.setCues(S.ui.cues);

  /* And whether music is ENABLED is independent of whether it can
   * start right now. Gating the state on __pfUnlocked meant Arcade
   * silently came up mute whenever the mode was applied before the
   * gate had announced itself; boot's unlock handler starts playback. */
  if (S.ui.music) { AudioKit.unlock(); AudioKit.setMusic(true); }
  else AudioKit.setMusic(false);
  save();
}

/* The first-run fork. Deliberately two big buttons and nothing else:
 * a wall of options is exactly what a first-time visitor cannot
 * navigate, which is the problem this screen exists to solve. */
function openModePicker() {
  const host = $('#modePick');
  host.querySelector('.sheet').innerHTML = `
    <div class="sheet-head"><span class="sheet-title">How do you want to use this?</span></div>
    <div class="modebody">
      <div class="note" style="margin-bottom:14px">
        Same engine either way — the same tax rules, the same arithmetic, the same forecast.
        This only decides how much theatre comes with it. You can switch whenever you like,
        in Settings.
      </div>
      <div class="modegrid">
        ${Object.entries(MODES).map(([k, m]) => `
          <button class="modecard" data-mode="${k}">
            <span class="mc-ico">${k === 'pro' ? '\u25A4' : '\u25C6'}</span>
            <span class="mc-t">${m.label}</span>
            <span class="mc-b">${m.blurb}</span>
            <span class="mc-l">${k === 'pro'
              ? 'Quiet \u00b7 Auto-optimise ready \u00b7 Plain wording'
              : 'Music \u00b7 Operator \u00b7 Hidden cheat code'}</span>
          </button>`).join('')}
      </div>
    </div>`;
  host.classList.remove('hidden');
  host.querySelectorAll('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      const name = b.dataset.mode;
      applyMode(name);
      host.classList.add('hidden');
      AudioKit.unlock();
      if (S.ui.cues) AudioKit.cue('confirm');
      renderAll();
      /* Arcade keeps the running order the user asked for: build a
       * character, then confirm it in Settings. Planner skips straight
       * to the dashboard with a preset offer in the corner, because
       * someone here for the numbers should not have to pick an avatar
       * first. */
      if (name === 'arcade') openCreation(false);
      else { S.ui.skippedCreation = true; save(); showFirstRunTips(); }
    });
  });
}

/* ============ 8. the cheat code ============
 * Auto-optimise is deliberately hidden: it hands you the answer, and
 * the point of the tool is turning the dials yourself. So it is
 * unlocked with a controller-style combination.
 *
 *   UP  RIGHT  DOWN  LEFT   x2      then   M  A  X
 *
 * Two full clockwise sweeps of a D-pad — echoing the ring lock on the
 * way in — and then asking for the maximum. Original sequence rather
 * than a borrowed one, and thematic: you spin the dial, then ask for
 * max. Progress is shown so a half-entered code is discoverable rather
 * than silent.
 * ============================================================ */
const CHEAT = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft',
               'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft',
               'm', 'a', 'x'];
const CHEAT_HINT = '\u2191 \u2192 \u2193 \u2190  \u00d7 2   then   M A X';
/* Clicking the operator this many times also unlocks it. The keys are
 * the intended route, but a combination nobody can find is a feature
 * nobody has — and poking the character until it reacts is how people
 * actually explore this kind of UI. */
const CHEAT_CLICKS = 7;
let cheatPos = 0;
let cheatTimer = null;

function cheatKey(raw) {
  if (S.ui.cheatUnlocked) return false;
  const k = raw && raw.length === 1 ? raw.toLowerCase() : raw;
  if (k !== CHEAT[cheatPos]) {
    // A wrong key restarts, but still counts if it is the opening move.
    const was = cheatPos;
    cheatPos = (k === CHEAT[0]) ? 1 : 0;
    if (was !== cheatPos) renderCheatProgress();
    return false;
  }

  cheatPos++;
  clearTimeout(cheatTimer);
  // A stalled attempt resets, so a stray arrow key does not leave the
  // sequence half-armed forever.
  cheatTimer = setTimeout(() => { cheatPos = 0; renderCheatProgress(); }, 3500);

  /* Two moves in, the sequence is clearly deliberate: take focus out of
   * whatever field the user was in, so the remaining arrows do not also
   * increment a number, and swallow the rest of the code. */
  if (cheatPos === 2 && document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  if (cheatPos >= CHEAT.length) { unlockCheat('combination'); return true; }
  renderCheatProgress();
  if (S.ui.cues && cheatPos >= 2) AudioKit.cue('tickUp');
  return cheatPos >= 2;
}

function renderCheatProgress() {
  const n = $('#cheatProg');
  if (!n) return;
  if (S.ui.cheatUnlocked || cheatPos === 0) { n.classList.add('hidden'); return; }
  n.classList.remove('hidden');
  // Feedback from the very first move — waiting until move five meant a
  // half-entered code looked like nothing was happening at all.
  n.textContent = '\u25c6'.repeat(cheatPos) + '\u25c7'.repeat(CHEAT.length - cheatPos);
  n.title = 'Something is being entered\u2026';
}

function unlockCheat(how) {
  if (S.ui.cheatUnlocked) return;
  S.ui.cheatUnlocked = true;
  cheatPos = 0;
  clearTimeout(cheatTimer);
  save();
  renderCheatState();
  AudioKit.cue('alert');
  const banner = $('#cheatBanner');
  banner.classList.remove('hidden');
  const via = $('#cheatVia');
  if (via) via.textContent = how === 'clicks'
    ? 'You poked the operator until it gave in.' : CHEAT_HINT;
  clearTimeout(unlockCheat._t);
  unlockCheat._t = setTimeout(() => banner.classList.add('hidden'), 6000);
}

function renderCheatState() {
  const on = S.ui.cheatUnlocked;
  $('#btnOptimise').classList.toggle('hidden', !on);
  $('#cheatMark').classList.toggle('hidden', !on);
  renderCheatProgress();
}

/* ============ 9. keyboard, boot ============ */
function closeAll() {
  ['#settings', '#optimise', '#creation', '#help', '#modePick', '#profiles']
    .forEach((s) => $(s).classList.add('hidden'));
}
const anyOpen = () => ['#settings', '#optimise', '#creation', '#help', '#modePick', '#profiles']
  .some((s) => !$(s).classList.contains('hidden'));

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (/input|select|textarea/i.test(e.target.tagName)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') { closeAll(); return; }

    /* 1-9 reach the first nine directly; [ and ] walk the whole list,
     * because there are more controls than digits now. */
    if (e.key >= '1' && e.key <= '9' && +e.key <= LIVE.length) {
      focusControl(+e.key - 1); return;
    }
    if (e.key === ']') { focusControl(S.focus + 1); e.preventDefault(); return; }
    if (e.key === '[') { focusControl(S.focus - 1); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { nudgeFocused(1); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { nudgeFocused(-1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { $('#scrubber').value = ++S.cursor; renderAll(); return; }
    if (e.key === 'ArrowLeft') { $('#scrubber').value = Math.max(0, --S.cursor); renderAll(); return; }
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) { openHelp(); e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if (k === 'h' && !anyOpen()) { openHelp(); return; }
    if (k === 'p' && !anyOpen()) { openProfiles(); return; }
    if (k === 's' && !anyOpen()) { openSettings(); }
    else if (k === 'c' && !anyOpen()) { openCreation(true); }
    else if (k === 'o' && !anyOpen() && S.ui.cheatUnlocked) { openOptimise(); }
    else if (k === 'm') {
      const on = S.ui.music || S.ui.cues;
      if (on) { AudioKit.muteAll(); S.ui.music = false; S.ui.cues = false; }
      else { AudioKit.unmuteAll(); }
      save();
    }
  });
}

function openSettings() {
  $('#settings').classList.remove('hidden');
  if (S.ui.cues) AudioKit.cue('open');
  renderSettings();
}

function boot() {
  const hadState = load();

  $('#btnSettings').addEventListener('click', openSettings);
  $('#setClose').addEventListener('click', closeAll);
  $('#btnCharacter').addEventListener('click', () => openCreation(true));
  $('#btnOptimise').addEventListener('click', openOptimise);

  $('#optClose').addEventListener('click', closeAll);
  $('#optRun').addEventListener('click', () => { $('#optBody').innerHTML = '<div class="empty">Searching…</div>'; setTimeout(runOptimise, 30); });
  $('#optApply').addEventListener('click', applyOptimise);
  $('#creationSkip').addEventListener('click', () => {
    S.ui.skippedCreation = true;
    $('#creation').classList.add('hidden');
    save();
  });
  $('#cBack').addEventListener('click', () => { S.creationStep = Math.max(0, S.creationStep - 1); renderCreation(); });
  $('#cNext').addEventListener('click', () => {
    if (S.creationStep === STEPS.length - 1) finishCreation();
    else { S.creationStep++; renderCreation(); }
  });
  $('#cRandom').addEventListener('click', () => {
    const rs = roster().filter((r) => r.key !== 'custom');
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    Object.assign(S.creationChoice, {
      occupation: pick(rs).key, state: pick(STATE_KEYS()),
      stage: pick(['early', 'mid', 'senior', 'late']), saver: pick(['p50', 'p75', 'p90']),
      skinTone: Math.floor(Math.random() * 7), hairColour: Math.floor(Math.random() * 7),
      build: pick(['slim', 'average', 'broad']),
    });
    renderCreation();
  });
  $('#setResetPage').addEventListener('click', () => {
    /* Was `S.inputs = { ...S.inputs, ...defaultInputs() }` dressed up in
     * an Object.fromEntries(Object.keys(d).map(...)) that is just `d` —
     * so the page-scoped button silently did what Reset everything does.
     * It now resets exactly the keys that page owns, which is the same
     * map the amber "changed" dot already uses. */
    const d = defaultInputs();
    const keys = PAGE_KEYS[S.settingsPage];
    if (S.settingsPage === 'accounts') S.inputs.balances = clone(d.balances);
    else if (keys) for (const k of keys) setPath(S.inputs, k, clone(getPath(d, k)));
    buildControls(); recompute({ noGhost: true }); renderSettings();
  });
  $('#setResetAll').addEventListener('click', () => {
    S.inputs = defaultInputs(); S.character = null; S.mc = null; S.prev = null;
    S.inputsFromProfile = null;
    buildControls(); recompute({ noGhost: true }); renderSettings();
  });
  $$('#vtabs .vt').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#scrubber').addEventListener('input', (e) => {
    S.cursor = parseInt(e.target.value, 10);
    renderInspector(); renderChart(); if (S.view === 'table') renderTable();
  });
  /* The Monte Carlo cell sat permanently at "—" with the words "open
   * Bands to run" and no way to act on it. It is now the button. */
  const mcCell = $('#s2v') && $('#s2v').closest ? $('#s2v').closest('.stat') : null;
  if (mcCell) {
    mcCell.classList.add('actionable');
    mcCell.setAttribute('role', 'button');
    mcCell.setAttribute('tabindex', '0');
    mcCell.setAttribute('title', 'Run 500 randomised market histories');
    const go = () => {
      if (S.mc && !S.mc.stale) { setView('bands'); return; }
      setView('bands');
      runMonteCarlo();
    };
    mcCell.addEventListener('click', go);
    mcCell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  }

  $('#btnTheme').addEventListener('click', toggleTheme);
  $('#btnProfiles').addEventListener('click', openProfiles);
  $('#profClose').addEventListener('click', closeAll);
  $('#profClose2').addEventListener('click', closeAll);
  $('#profSaveAs').addEventListener('click', () => {
    promptSaveProfile();
    renderProfiles();
  });

  $('#helpNav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hpage]');
    if (b) { S.helpPage = b.dataset.hpage; renderHelp(); }
  });
  $('#helpClose').addEventListener('click', closeAll);
  $('#btnHelp').addEventListener('click', () => openHelp());
  $('#helpMode').addEventListener('click', () => { closeAll(); openModePicker(); });

  $('#setNav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) { S.settingsPage = b.dataset.page; renderSettings(); }
  });

  const stage = $('#bayStage');
  stage.addEventListener('click', pokeBay);
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pokeBay(); }
  });

  /* The cheat detector listens on the CAPTURE phase, deliberately
   * ahead of wireKeys. wireKeys returns early whenever focus is in an
   * input, select or textarea — and after character creation the app
   * lands in Settings, which is wall-to-wall number fields. One click
   * in a field and every key was swallowed before the detector saw it,
   * so the combination simply did not work and gave no hint why. */
  window.addEventListener('keydown', (e) => {
    if (cheatKey(e.key)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  wireKeys();
  AudioKit.setCueVolume(S.ui.cueVol);
  AudioKit.setMusicVolume(S.ui.musicVol);
  AudioKit.setCueSet(S.ui.cueSet);

  document.body.classList.toggle('plain', !!S.ui.plainLabels);
  applyTextScale(S.ui.textScale);
  applyTheme(S.ui.theme);
  profilesInit();
  buildControls();
  /* Synchronous: the first paint must not depend on a frame callback. */
  recompute({ noGhost: true, sync: true });

  /* The running order is UNLOCK, then CREATE, then the dashboard.
   * Creation has to wait for the gate: opened earlier it renders
   * beneath the lock overlay and is never seen. */
  const needsCreation = !hadState;
  const onUnlock = () => {
    /* Solving the lock is a real user gesture, which is the only thing
     * that lets a browser start audio. */
    AudioKit.unlock();
    if (!S.ui.mode) {
      /* Nobody has chosen a front door yet. Ask before anything else —
       * the answer decides whether music starts and whether character
       * creation happens at all, so it cannot come later. */
      openModePicker();
      return;
    }
    if (S.ui.music) AudioKit.setMusic(true);
    if (needsCreation) openCreation(false);
  };
  if (window.__pfUnlocked) onUnlock();
  else window.addEventListener('pf-unlocked', onUnlock, { once: true });

  /* Orientation tips belong to "first time you see the dashboard",
   * not "first time you pick a mode" — a returning visitor who chose a
   * mode before the tips existed would otherwise never see them. */
  if (S.ui.mode && !S.ui.tipsDone) setTimeout(showFirstRunTips, 700);

  setTimeout(selfCheck, 500);
}

/* Reports to the console rather than failing silently. */
function selfCheck() {
  const p = [];
  if (!S.run) p.push('no simulation result');
  else {
    if (S.run.rows.length !== S.inputs.horizonYears) p.push('wrong row count');
    if (!S.run.rows.every((r) => Number.isInteger(r.netWorth))) p.push('net worth not cent-integral');
  }
  if (typeof Chart === 'undefined') p.push('Chart.js did not load');
  else if (!chart && S.view !== 'table' && S.view !== 'bands') p.push('chart not created');
  if (!$('.ctl')) p.push('live controls did not render');
  if ($('#s0v').textContent === '—') p.push('status strip did not update');
  if (S.ui.bay && !$('#bayFig svg')) p.push('character bay did not render');
  if (p.length) console.error('SELF-CHECK FAILED: ' + p.join(' | '));
  else console.log(`SELF-CHECK OK — ${S.run.rows.length} years, net worth `
    + `${fmt(atTarget(S.run).netWorth)} at ${S.targetAge}, view "${S.view}", `
    + `${S.run.warnings.length} notes, character ${S.character ? S.character.occupation : 'none'}.`);
}

/* A deliberate, minimal test surface, mirroring auth.js's
 * `window.__authInternals`. The QA pass found a dozen assertions that
 * matched source text instead of exercising behaviour, largely because
 * the view switcher and the profile state were unreachable from
 * outside. Exposing them lets the suite assert on what is drawn.
 * Read-mostly: no setters, and nothing here is used by the app. */
window.__pfTest = {
  setView: (v) => setView(v),
  renderAll: () => renderAll(),
  recompute: (o) => recompute(o),
  nudge: (dir) => nudgeFocused(dir),
  /* Writes through the SAME path a slider uses — ctlSet then recompute
   * — so a test exercises the real code rather than poking S.inputs. */
  setControl: (key, value) => {
    const c = LIVE.find((x) => x.key === key || (key === 'equity' && x.kind === 'equity'));
    if (!c) return false;
    ctlSet(c, value);
    recompute();
    return true;
  },
  state: () => S,
  profiles: () => P,
  comparing: () => comparing(),
  compareYears: () => compareYears(),
  renderSteps: () => RENDER_STEPS.map(([n]) => n),
  fade: (c, a) => fade(c, a),
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
