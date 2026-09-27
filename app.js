/* ===================================================================
 * app.js — UI CONTROLLER
 * -------------------------------------------------------------------
 * Binds the sidebar controls to the simulation engine and re-renders
 * on every change. Implements spec section 10 (outputs) and the
 * scenario / Monte Carlo / stress views.
 * =================================================================== */

'use strict';

(function () {

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const M = Money;
const fmt  = (c) => M.fmt(c);
const fmtK = (c) => M.fmt(c, { compact: true });
const pct  = (r, d = 1) => `${(r * 100).toFixed(d)}%`;
const D = (c) => M.toDollars(c);

const SCENARIO_COLORS = ['#2563eb', '#c2410c', '#15803d', '#7c3aed'];

/* ---------- Which balances appear in the stacked chart ------------- */
const STACK_SERIES = [
  { key: 'cash',              label: 'Cash',                color: '#94a3b8' },
  { key: 'brokerage',         label: 'Taxable brokerage',   color: '#2563eb' },
  { key: 'trad401k',          label: 'Traditional 401(k)',  color: '#0891b2' },
  { key: 'tradIra',           label: 'Traditional IRA',     color: '#0e7490' },
  { key: 'roth401k',          label: 'Roth 401(k)',         color: '#15803d' },
  { key: 'rothIra',           label: 'Roth IRA',            color: '#4d7c0f' },
  { key: 'hsa',               label: 'HSA',                 color: '#a16207' },
  { key: 'commodities',       label: 'Gold / commodities',  color: '#ca8a04' },
  { key: 'crypto',            label: 'Crypto',              color: '#7c3aed' },
  { key: 'c529',              label: '529',                 color: '#be185d' },
  { key: 'realEstateEquity',  label: 'Real estate equity',  color: '#c2410c' },
];

/* ===================================================================
 * STATE
 * =================================================================== */
const state = {
  scenarios: [{ name: 'Baseline', inputs: defaultInputs() }],
  active: 0,
  results: [],
  mc: null,
  stress: null,
};

const current = () => state.scenarios[state.active];
const charts = {};

/* ===================================================================
 * PATH HELPERS for data-bind="a.b.c"
 * =================================================================== */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] ?? {}), obj);
  target[last] = val;
}

/* ===================================================================
 * BINDING — wire every [data-bind] control to the active scenario
 * =================================================================== */
function readControl(el) {
  const kind = el.dataset.kind;
  if (el.type === 'checkbox') return el.checked;
  if (el.tagName === 'SELECT' && el.dataset.bind === 'rothConversionFillToRate') {
    return parseFloat(el.value);
  }
  if (el.type === 'range' || el.type === 'number') {
    const n = parseFloat(el.value);
    const v = Number.isNaN(n) ? 0 : n;
    if (kind === 'money' ) return Math.round(v);          // slider already in cents
    if (kind === 'money-num') return M.fromDollars(v);    // number field in dollars
    return v;
  }
  return el.value;
}

function writeControl(el, val) {
  const kind = el.dataset.kind;
  if (el.type === 'checkbox') { el.checked = !!val; return; }
  if (kind === 'money') { el.value = val; return; }
  if (kind === 'money-num') { el.value = Math.round(D(val)); return; }
  el.value = val;
}

function bindAll() {
  $$('[data-bind]').forEach((el) => {
    const path = el.dataset.bind;
    const evt = (el.type === 'range' || el.type === 'checkbox' || el.tagName === 'SELECT')
      ? 'input' : 'change';
    el.addEventListener(evt, () => {
      setPath(current().inputs, path, readControl(el));
      if (path === 'scenName') return;
      syncLinkedControls(path);
      recompute();
    });
    // Number fields paired with a slider: also update live as you type.
    if (el.type === 'number') {
      el.addEventListener('input', () => {
        setPath(current().inputs, path, readControl(el));
        syncLinkedControls(path);
        recompute();
      });
    }
  });

  $('#scenName').addEventListener('input', (e) => {
    current().name = e.target.value;
    current().inputs.name = e.target.value;
    renderScenarioChips();
    renderAll();
  });
}

/** Keep a slider and its twin number field showing the same value. */
function syncLinkedControls(path) {
  const val = getPath(current().inputs, path);
  $$(`[data-bind="${path}"]`).forEach((el) => {
    if (document.activeElement !== el) writeControl(el, val);
  });
  const out = $(`[data-out="${path}"]`);
  if (out) out.textContent = formatOut(path, val);
  updateConditionalFields();
}

function formatOut(path, val) {
  const rateFields = ['salaryGrowth', 'inflation', 'contrib401kPercent', 'roth401kSplit',
    'employerMatchRate', 'employerMatchCapPct', 'dividendYield', 'cashInterestRate', 'customStateRate'];
  if (rateFields.includes(path)) return pct(val);
  if (path.startsWith('returns.') || path.startsWith('volatility.')) return pct(val);
  if (path === 'sweep.bufferMonths') return `${val} mo`;
  if (path === 'retirementAge') return `age ${val}`;
  if (typeof val === 'number' && val > 1000) return fmt(val);
  return String(val);
}

function refreshAllControls() {
  const I = current().inputs;
  $$('[data-bind]').forEach((el) => {
    const v = getPath(I, el.dataset.bind);
    if (v !== undefined) writeControl(el, v);
  });
  $$('[data-out]').forEach((el) => {
    el.textContent = formatOut(el.dataset.out, getPath(I, el.dataset.out));
  });
  $('#scenName').value = current().name;
  updateConditionalFields();
}

function updateConditionalFields() {
  const I = current().inputs;
  $('#spouseAgeField').style.display = I.filingStatus === 'mfj' ? '' : 'none';
  $('#customStateField').style.display = I.stateCode === 'CUSTOM' ? '' : 'none';
  $('#f401kPct').style.display = I.contrib401kMode === 'percent' ? '' : 'none';
  $('#f401kDol').style.display = I.contrib401kMode === 'dollar' ? '' : 'none';
  $('#fBufMonths').style.display = I.sweep.bufferMode === 'months' ? '' : 'none';
  $('#fBufDollar').style.display = I.sweep.bufferMode === 'dollar' ? '' : 'none';
  const convOn = I.rothConversionMode !== 'none';
  $('#fConvBracket').style.display = I.rothConversionMode === 'fillBracket' ? '' : 'none';
  $('#fConvFixed').style.display = I.rothConversionMode === 'fixed' ? '' : 'none';
  $('#fConvAges').style.display = convOn ? '' : 'none';

  const st = STATE_TAX[I.stateCode];
  $('#stateNote').textContent = st ? (st.note || (st.approx ? 'Approximate flat rate — graduated brackets simplified.' : '')) : '';

  const cfg = getTaxConfig(I.startYear, 0);
  const cap = max401kDeferral(I.currentAge, cfg);
  const amount = I.contrib401kMode === 'percent' ? M.mul(I.salary, I.contrib401kPercent) : I.contrib401kDollar;
  const h = $('#hint401k');
  if (h) {
    h.textContent = amount > cap
      ? `${fmt(amount)} exceeds the ${fmt(cap)} IRS limit — capped in the simulation.`
      : `${fmt(amount)} of a ${fmt(cap)} limit.`;
    h.style.color = amount > cap ? 'var(--warn)' : '';
  }
}

/* ===================================================================
 * DYNAMIC SIDEBAR SECTIONS
 * =================================================================== */
function renderReturnInputs() {
  const I = current().inputs;
  const box = $('#returnsBody');
  box.innerHTML = Object.entries(ASSET_CLASSES).map(([key, meta]) => `
    <div class="field">
      <div class="field-head">
        <label>${meta.label}</label>
        <span class="field-value" data-out="returns.${key}">${pct(I.returns[key])}</span>
      </div>
      <input type="range" data-bind="returns.${key}" data-kind="rate" min="-0.05" max="0.20" step="0.0025" value="${I.returns[key]}">
      <div class="field-head" style="margin-top:3px">
        <label style="font-size:10.5px;color:var(--text-faint)">volatility (Monte Carlo)</label>
        <span class="field-value" data-out="volatility.${key}" style="font-size:10.5px">${pct(I.volatility[key])}</span>
      </div>
      <input type="range" data-bind="volatility.${key}" data-kind="rate" min="0" max="0.70" step="0.005" value="${I.volatility[key]}">
    </div>`).join('');
  bindSubtree(box);
}

function bindSubtree(root) {
  $$('[data-bind]', root).forEach((el) => {
    const path = el.dataset.bind;
    el.addEventListener('input', () => {
      setPath(current().inputs, path, readControl(el));
      syncLinkedControls(path);
      recompute();
    });
  });
}

/* ---------- Withdrawal order (drag to reorder) --------------------- */
const ACCOUNT_LABELS = {
  cash: 'Cash', brokerage: 'Taxable brokerage', trad401k: 'Traditional 401(k)',
  tradIra: 'Traditional IRA', roth401k: 'Roth 401(k)', rothIra: 'Roth IRA', hsa: 'HSA',
};

function renderWithdrawalOrder() {
  const I = current().inputs;
  const box = $('#withdrawalOrder');
  box.innerHTML = I.withdrawalOrder.map((k, i) => `
    <div draggable="true" data-idx="${i}" style="display:flex;align-items:center;gap:7px;padding:4px 7px;
         border:1px solid var(--border);border-radius:4px;margin-bottom:3px;background:#fff;cursor:grab;font-size:11.5px">
      <span style="color:var(--text-faint);font-size:10px">⠿</span>
      <span style="color:var(--text-faint);width:12px">${i + 1}</span>
      <span>${ACCOUNT_LABELS[k] ?? k}</span>
    </div>`).join('');

  let dragIdx = null;
  $$('[draggable]', box).forEach((el) => {
    el.addEventListener('dragstart', () => { dragIdx = +el.dataset.idx; el.style.opacity = '.4'; });
    el.addEventListener('dragend', () => { el.style.opacity = '1'; });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = +el.dataset.idx;
      if (dragIdx === null || dragIdx === to) return;
      const order = [...I.withdrawalOrder];
      const [moved] = order.splice(dragIdx, 1);
      order.splice(to, 0, moved);
      I.withdrawalOrder = order;
      renderWithdrawalOrder();
      recompute();
    });
  });
}

/* ---------- Real estate -------------------------------------------- */
function renderProperties() {
  const I = current().inputs;
  const box = $('#propList');
  if (!I.properties.length) {
    box.innerHTML = '<div class="note" style="margin-bottom:8px">No properties. Add one to model appreciation, a mortgage, carrying costs and a sale.</div>';
    return;
  }
  box.innerHTML = I.properties.map((p, i) => `
    <div class="prop-card">
      <div class="prop-head">
        <input type="text" value="${p.name}" data-prop="${i}" data-pfield="name" style="width:64%;font-weight:600">
        <button class="sm danger" data-delprop="${i}">Remove</button>
      </div>
      <div class="row2">
        <div class="field"><div class="field-head"><label>Current value</label></div>
          <input type="number" value="${Math.round(D(p.currentValue))}" data-prop="${i}" data-pfield="currentValue" data-pmoney="1"></div>
        <div class="field"><div class="field-head"><label>Cost basis</label></div>
          <input type="number" value="${Math.round(D(p.costBasis))}" data-prop="${i}" data-pfield="costBasis" data-pmoney="1"></div>
      </div>
      <div class="row2">
        <div class="field"><div class="field-head"><label>Mortgage balance</label></div>
          <input type="number" value="${Math.round(D(p.mortgageBalance))}" data-prop="${i}" data-pfield="mortgageBalance" data-pmoney="1"></div>
        <div class="field"><div class="field-head"><label>Rate</label></div>
          <input type="number" step="0.001" value="${p.mortgageRate}" data-prop="${i}" data-pfield="mortgageRate"></div>
      </div>
      <div class="row2">
        <div class="field"><div class="field-head"><label>Term (yrs)</label></div>
          <input type="number" value="${p.mortgageTermYears}" data-prop="${i}" data-pfield="mortgageTermYears"></div>
        <div class="field"><div class="field-head"><label>Purchase year</label></div>
          <input type="number" value="${p.purchaseYear}" data-prop="${i}" data-pfield="purchaseYear"></div>
      </div>
      <div class="row3">
        <div class="field"><div class="field-head"><label>Prop tax %</label></div>
          <input type="number" step="0.001" value="${p.propertyTaxRate}" data-prop="${i}" data-pfield="propertyTaxRate"></div>
        <div class="field"><div class="field-head"><label>Insurance</label></div>
          <input type="number" value="${Math.round(D(p.baseInsurance))}" data-prop="${i}" data-pfield="baseInsurance" data-pmoney="1"></div>
        <div class="field"><div class="field-head"><label>Maint %</label></div>
          <input type="number" step="0.001" value="${p.maintenancePct}" data-prop="${i}" data-pfield="maintenancePct"></div>
      </div>
      <label class="check"><input type="checkbox" ${p.isPrimary ? 'checked' : ''} data-prop="${i}" data-pfield="isPrimary"> Primary residence (§121 exclusion)</label>
      <label class="check"><input type="checkbox" ${p.isRental ? 'checked' : ''} data-prop="${i}" data-pfield="isRental"> Rental property</label>
      ${p.isRental ? `
      <div class="row3">
        <div class="field"><div class="field-head"><label>Annual rent</label></div>
          <input type="number" value="${Math.round(D(p.annualRent))}" data-prop="${i}" data-pfield="annualRent" data-pmoney="1"></div>
        <div class="field"><div class="field-head"><label>Vacancy %</label></div>
          <input type="number" step="0.01" value="${p.vacancyRate}" data-prop="${i}" data-pfield="vacancyRate"></div>
        <div class="field"><div class="field-head"><label>Mgmt %</label></div>
          <input type="number" step="0.01" value="${p.managementPct}" data-prop="${i}" data-pfield="managementPct"></div>
      </div>
      <div class="row2">
        <div class="field"><div class="field-head"><label>Land share (not depreciable)</label></div>
          <input type="number" step="0.05" value="${p.landValuePct}" data-prop="${i}" data-pfield="landValuePct"></div>
        <div class="field"><div class="field-head"><label>Depreciation years</label></div>
          <input type="number" step="0.5" value="${p.depreciationYears}" data-prop="${i}" data-pfield="depreciationYears"></div>
      </div>
      <div class="field-hint">Depreciation shelters rental income and lowers adjusted basis, so it comes back as 25% recapture on sale. Losses above the §469 allowance (fully phased out at $150k MAGI) are suspended until you sell.</div>` : ''}
      <div class="row2">
        <div class="field"><div class="field-head"><label>Sale year (blank = hold)</label></div>
          <input type="number" value="${p.saleYear ?? ''}" data-prop="${i}" data-pfield="saleYear" data-pnull="1"></div>
        <div class="field"><div class="field-head"><label>Selling cost %</label></div>
          <input type="number" step="0.005" value="${p.sellingCostPct}" data-prop="${i}" data-pfield="sellingCostPct"></div>
      </div>
    </div>`).join('');

  $$('[data-prop]', box).forEach((el) => {
    el.addEventListener('input', () => {
      const p = I.properties[+el.dataset.prop];
      const f = el.dataset.pfield;
      if (el.type === 'checkbox') p[f] = el.checked;
      else if (el.dataset.pmoney) p[f] = M.fromDollars(parseFloat(el.value) || 0);
      else if (el.dataset.pnull) p[f] = el.value === '' ? null : parseInt(el.value, 10);
      else if (el.type === 'number') p[f] = parseFloat(el.value) || 0;
      else p[f] = el.value;
      // Re-derive the amortisation payment when loan terms change.
      if (['mortgageBalance', 'mortgageRate', 'mortgageTermYears'].includes(f)) {
        p.originalLoan = p.mortgageBalance;
        delete p._payment;
      }
      if (f === 'isRental') renderProperties();
      recompute();
    });
  });
  $$('[data-delprop]', box).forEach((b) => b.addEventListener('click', () => {
    I.properties.splice(+b.dataset.delprop, 1);
    renderProperties(); recompute();
  }));
}

/* ---------- Per-year overrides -------------------------------------- */
function renderOverrides() {
  const I = current().inputs;
  const box = $('#overrideList');
  const years = Object.keys(I.overrides).map(Number).sort((a, b) => a - b);
  if (!years.length) { box.innerHTML = '<div class="note">No overrides set.</div>'; return; }

  box.innerHTML = `<div class="ov-row" style="font-size:10px;color:var(--text-faint);text-transform:uppercase">
      <span>Year</span><span>Bonus</span><span>One-off cost</span><span>Withdraw</span><span></span></div>` +
    years.map((y) => {
      const o = I.overrides[y];
      return `<div class="ov-row">
        <span class="yr">${y}</span>
        <input type="number" value="${o.bonus != null ? Math.round(D(o.bonus)) : ''}" data-ov="${y}" data-ovf="bonus" placeholder="—">
        <input type="number" value="${o.oneTimeExpense != null ? Math.round(D(o.oneTimeExpense)) : ''}" data-ov="${y}" data-ovf="oneTimeExpense" placeholder="—">
        <input type="number" value="${o.extraWithdrawal != null ? Math.round(D(o.extraWithdrawal)) : ''}" data-ov="${y}" data-ovf="extraWithdrawal" placeholder="—">
        <button class="sm danger" data-delov="${y}">×</button>
      </div>
      <label class="check" style="margin:-2px 0 8px 68px">
        <input type="checkbox" ${o.isRetired ? 'checked' : ''} data-ov="${y}" data-ovf="isRetired"> Retirement starts this year
      </label>`;
    }).join('');

  $$('[data-ov]', box).forEach((el) => {
    el.addEventListener('input', () => {
      const y = el.dataset.ov, f = el.dataset.ovf;
      if (el.type === 'checkbox') {
        if (el.checked) I.overrides[y][f] = true; else delete I.overrides[y][f];
      } else if (el.value === '') delete I.overrides[y][f];
      else I.overrides[y][f] = M.fromDollars(parseFloat(el.value) || 0);
      recompute();
    });
  });
  $$('[data-delov]', box).forEach((b) => b.addEventListener('click', () => {
    delete I.overrides[b.dataset.delov]; renderOverrides(); recompute();
  }));
}

/* ---------- Scenario chips ------------------------------------------ */
function renderScenarioChips() {
  $('#scenarioChips').innerHTML = state.scenarios.map((s, i) => `
    <span class="scenario-chip ${i === state.active ? 'active' : ''}" data-scen="${i}">
      <span class="scenario-dot" style="background:${SCENARIO_COLORS[i]}"></span>${s.name}
    </span>`).join('');
  $$('[data-scen]').forEach((el) => el.addEventListener('click', () => {
    state.active = +el.dataset.scen;
    renderScenarioChips(); refreshAllControls();
    renderReturnInputs(); renderProperties(); renderOverrides(); renderWithdrawalOrder();
    renderAll();
  }));
  $('#btnDelScenario').disabled = state.scenarios.length <= 1;
  $('#btnAddScenario').disabled = state.scenarios.length >= 4;
  $('#btnDupScenario').disabled = state.scenarios.length >= 4;
}

/* ===================================================================
 * COMPUTE + RENDER
 * =================================================================== */
let recomputeTimer = null;
function recompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    state.results = state.scenarios.map((s) => {
      try { return simulate(s.inputs); }
      catch (err) { console.error('Simulation failed:', err); return null; }
    });
    state.stress = null;
    renderAll();
  }, 16);
}

function renderAll() {
  const res = state.results[state.active];
  if (!res) return;
  renderHeader(res);
  renderStats(res);
  renderStackChart(res);
  renderNetWorthChart(res);
  renderTaxChart(res);
  renderCashFlowChart(res);
  renderWarnings(res);
  renderGrossUpHint(res);
  renderTable(res);
  renderWithdrawalTable(res);
  renderWithdrawalChart(res);
  renderScenarioView();
  if ($('#pane-stress').classList.contains('active')) renderStress();
}

function renderHeader(res) {
  const s = res.summary;
  $('#hsNetWorth').textContent = fmtK(s.endingNetWorth);
  $('#hsTax').textContent = fmtK(s.totalTaxPaid);
  const st = $('#hsStatus');
  if (s.depleted) { st.textContent = `Depleted ${s.depletedYear}`; st.className = 'hstat-value bad'; }
  else { st.textContent = 'Funded'; st.className = 'hstat-value good'; }
}

function renderStats(res) {
  const s = res.summary;
  // Read the engine's NORMALISED inputs, not the raw control values: a
  // cleared field leaves a blank in `current().inputs`, and indexing
  // rows by a blank age is what crashed this renderer before.
  const I = res.inputs;
  if (!res.rows.length) { $('#statGrid').innerHTML = ''; return; }
  const retIdx = Math.max(0, Math.min(res.rows.length - 1, I.retirementAge - I.currentAge));
  const atRet = res.rows[retIdx] ?? res.rows[res.rows.length - 1];
  const unit = I.displayRealDollars ? "today's $" : 'nominal $';

  const cards = [
    ['Net worth at retirement', fmt(atRet.netWorth), `age ${atRet.age} · ${unit}`],
    [`Net worth at age ${s.endingAge}`, fmt(s.endingNetWorth), unit],
    ['Peak net worth', fmt(s.peakNetWorth), `in ${s.peakYear}`],
    ['Lifetime tax paid', fmt(s.totalTaxPaid), `avg ${pct(s.avgEffectiveRate)} effective`],
    ['Total contributed', fmt(s.totalContributions), 'incl. employer match & sweeps'],
    ['Total swept to investments', fmt(s.totalSwept), I.sweep.enabled ? 'sweep on' : 'sweep off'],
  ];
  $('#statGrid').innerHTML = cards.map(([l, v, n]) =>
    `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-note">${n}</div></div>`).join('');
}

/**
 * Turn the abstract "withdrawals are grossed up for tax" note into the
 * actual figure for the first full retirement year, so the cost of
 * funding a dollar of spending from this particular mix of accounts is
 * visible while you are still setting the inputs.
 */
function renderGrossUpHint(res) {
  const el = $('#grossUpHint');
  if (!el) return;
  const base = "In today's dollars, inflated each year. This is what lands in your pocket — withdrawals are grossed up to cover the tax they trigger.";
  // First retirement year in which the portfolio actually funds the plan.
  const row = res.rows.find((r) => r.retired && r.withdrawals.total > 0);
  if (!row) { el.innerHTML = base; return; }

  const spend = row.outflow.living;
  const gross = row.inflow.withdrawals;
  if (spend <= 0) { el.innerHTML = base; return; }
  const ratio = gross / spend;

  if (row.outflow.tax === 0) {
    el.innerHTML = `${base}<br><strong>At age ${row.age} this costs no tax at all</strong> — ` +
      `${fmt(gross)} withdrawn to fund ${fmt(spend)} of spending, because it is coming from ` +
      `cost basis and gains inside the 0% bracket.`;
    el.style.color = 'var(--good)';
  } else {
    el.innerHTML = `${base}<br><strong>At age ${row.age}: ${fmt(gross)} withdrawn to fund ` +
      `${fmt(spend)} of spending</strong> — every $1 you spend costs ` +
      `$${ratio.toFixed(2)} of portfolio at that point.`;
    el.style.color = ratio > 1.3 ? 'var(--warn)' : '';
  }
}

/* ---------- Charts --------------------------------------------------- */
function destroy(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }

const AXIS_MONEY = {
  ticks: { callback: (v) => M.fmt(v * 100, { compact: true }), font: { size: 10 } },
  grid: { color: '#eef1f4' },
};
const BASE_OPTS = {
  responsive: true, maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 10.5 }, padding: 9 } },
    tooltip: {
      callbacks: {
        label: (c) => `${c.dataset.label}: ${M.fmt(c.parsed.y * 100)}`,
      },
    },
  },
};

function renderStackChart(res) {
  destroy('stack');
  const labels = res.rows.map((r) => r.year);
  const datasets = STACK_SERIES
    .filter((s) => res.rows.some((r) => r[s.key] > 0))
    .map((s) => ({
      label: s.label,
      data: res.rows.map((r) => D(r[s.key])),
      backgroundColor: s.color + 'dd',
      borderColor: s.color,
      borderWidth: 0, fill: true, pointRadius: 0, tension: 0.2,
    }));
  charts.stack = new Chart($('#chartStack'), {
    type: 'line',
    data: { labels, datasets },
    options: { ...BASE_OPTS,
      scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14 } },
                y: { stacked: true, ...AXIS_MONEY } } },
  });
}

function renderNetWorthChart(res) {
  destroy('nw');
  const I = res.inputs;   // normalised, so a half-typed field cannot break the marker
  const retYear = I.startYear + (I.retirementAge - I.currentAge);
  charts.nw = new Chart($('#chartNetWorth'), {
    type: 'line',
    data: {
      labels: res.rows.map((r) => r.year),
      datasets: [
        { label: 'Total net worth', data: res.rows.map((r) => D(r.netWorth)),
          borderColor: '#2563eb', backgroundColor: '#2563eb18', fill: true, pointRadius: 0, tension: 0.25, borderWidth: 2 },
        { label: 'Liquid (ex. real estate)', data: res.rows.map((r) => D(r.netWorth - r.realEstateEquity)),
          borderColor: '#94a3b8', borderDash: [4, 3], fill: false, pointRadius: 0, tension: 0.25, borderWidth: 1.5 },
      ],
    },
    options: { ...BASE_OPTS,
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14,
          color: (c) => (c.tick && res.rows[c.index]?.year === retYear ? '#2563eb' : '#8b95a3') } },
        y: AXIS_MONEY } },
  });
}

function renderTaxChart(res) {
  destroy('tax');
  const series = [
    ['Federal income', 'taxFederal', '#2563eb'],
    ['Capital gains',  'taxCapitalGains', '#0891b2'],
    ['FICA',           'taxFica', '#65a30d'],
    ['State',          'taxState', '#c2410c'],
    ['NIIT',           'taxNiit', '#a16207'],
    ['Early-withdrawal penalty', 'taxPenalty', '#b91c1c'],
  ].filter(([, k]) => res.rows.some((r) => r[k] > 0));

  charts.tax = new Chart($('#chartTax'), {
    type: 'bar',
    data: {
      labels: res.rows.map((r) => r.year),
      datasets: [
        ...series.map(([label, key, color]) => ({
          label, data: res.rows.map((r) => D(r[key])), backgroundColor: color, stack: 'tax', order: 2,
        })),
        { label: 'Effective rate', type: 'line', yAxisID: 'y1', order: 1,
          data: res.rows.map((r) => r.effectiveTaxRate * 100),
          borderColor: '#16191d', borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: false },
      ],
    },
    options: { ...BASE_OPTS,
      plugins: { ...BASE_OPTS.plugins,
        tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y1'
          ? `Effective rate: ${c.parsed.y.toFixed(1)}%` : `${c.dataset.label}: ${M.fmt(c.parsed.y * 100)}` } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14 } },
        y: { stacked: true, ...AXIS_MONEY },
        y1: { position: 'right', grid: { display: false }, min: 0,
          ticks: { callback: (v) => v + '%', font: { size: 10 } } },
      } },
  });
}

/* Money coming IN, in the order it is stacked upward from zero.
 * Ordered earned -> guaranteed -> portfolio, so the chart reads as a
 * story: wages give way to pension and Social Security, which give way
 * to selling assets. */
const INFLOW_SERIES = [
  ['Wages & bonus',      'wages',           '#1d4ed8'],
  ['Pension',            'pension',         '#0369a1'],
  ['Social Security',    'socialSecurity',  '#0891b2'],
  ['Other income',       'other',           '#0e7490'],
  ['Dividends',          'dividends',       '#15803d'],
  ['Interest on cash',   'interest',        '#65a30d'],
  ['Rental income',      'rent',            '#ca8a04'],
  ['Property sale',      'propertySale',    '#a16207'],
  ['Portfolio withdrawals', 'withdrawals',  '#7c3aed'],
];

/* Money going OUT, stacked downward from zero. */
const OUTFLOW_SERIES = [
  ['Living expenses',    'living',          '#c2410c'],
  ['Real estate costs',  'realEstate',      '#9a3412'],
  ['Contributions',      'contributions',   '#a8a29e'],
  ['Tax',                'tax',             '#b91c1c'],
];

function renderCashFlowChart(res) {
  destroy('cf');
  const rows = res.rows;

  // Hide any source that is zero in every year, so the legend only
  // shows what actually applies to this plan.
  const inflows = INFLOW_SERIES.filter(([, k]) => rows.some((r) => r.inflow[k] > 0));
  const outflows = OUTFLOW_SERIES.filter(([, k]) => rows.some((r) => r.outflow[k] > 0));

  const datasets = [
    ...inflows.map(([label, k, color]) => ({
      label, data: rows.map((r) => D(r.inflow[k])),
      backgroundColor: color, stack: 'flow', order: 2,
    })),
    ...outflows.map(([label, k, color]) => ({
      label, data: rows.map((r) => -D(r.outflow[k])),
      backgroundColor: color, stack: 'flow', order: 2,
    })),
    // Overlay proving the two sides reconcile.
    { label: 'Net cash flow', type: 'line', order: 1,
      data: rows.map((r) => D(r.netCashFlow)),
      borderColor: '#16191d', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: false },
  ];

  charts.cf = new Chart($('#chartCashFlow'), {
    type: 'bar',
    data: { labels: rows.map((r) => r.year), datasets },
    options: { ...BASE_OPTS,
      plugins: { ...BASE_OPTS.plugins,
        tooltip: {
          callbacks: {
            label: (c) => {
              const v = Math.abs(c.parsed.y);
              if (c.dataset.label === 'Net cash flow') {
                return `Net cash flow: ${M.fmt(c.parsed.y * 100, { sign: true })}`;
              }
              const r = rows[c.dataIndex];
              const totalIn = inflows.reduce((s, [, k]) => s + r.inflow[k], 0);
              const share = totalIn > 0 && c.parsed.y > 0 ? ` (${Math.round(v * 100 / (totalIn / 100))}% of income)` : '';
              return `${c.dataset.label}: ${M.fmt(v * 100)}${share}`;
            },
            footer: (items) => {
              const r = rows[items[0].dataIndex];
              const totalIn = inflows.reduce((s, [, k]) => s + r.inflow[k], 0);
              const totalOut = outflows.reduce((s, [, k]) => s + r.outflow[k], 0);
              return `Total in ${M.fmt(totalIn)}  ·  Total out ${M.fmt(totalOut)}`;
            },
          },
        } },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14 } },
                y: { stacked: true, ...AXIS_MONEY } } },
  });
}

function renderWithdrawalChart(res) {
  destroy('wd');
  const rows = res.rows.filter((r) => r.withdrawals.total > 0);
  if (!rows.length) { return; }
  const keys = [
    ['Taxable brokerage', 'brokerage', '#2563eb'],
    ['Traditional 401(k)', 'trad401k', '#0891b2'],
    ['Traditional IRA', 'tradIra', '#0e7490'],
    ['Roth 401(k)', 'roth401k', '#15803d'],
    ['Roth IRA', 'rothIra', '#4d7c0f'],
    ['HSA', 'hsa', '#a16207'],
  ].filter(([, k]) => rows.some((r) => r.withdrawals[k] > 0));

  charts.wd = new Chart($('#chartWd'), {
    type: 'bar',
    data: { labels: rows.map((r) => r.year),
      datasets: keys.map(([label, k, color]) => ({
        label, data: rows.map((r) => D(r.withdrawals[k])), backgroundColor: color, stack: 'w' })) },
    options: { ...BASE_OPTS,
      scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14 } },
                y: { stacked: true, ...AXIS_MONEY } } },
  });
}

/* ---------- Warnings -------------------------------------------------- */
function renderWarnings(res) {
  const card = $('#warnCard');
  // Collapse repeats of the same message to the year range they cover.
  const seen = new Map();
  for (const w of res.warnings) {
    const k = w.message;
    if (!seen.has(k)) seen.set(k, { ...w, years: [w.year] });
    else seen.get(k).years.push(w.year);
  }
  const items = [...seen.values()];
  if (!items.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  $('#warnList').innerHTML = items.map((w) => {
    const ys = w.years.length > 3
      ? `${w.years[0]}–${w.years[w.years.length - 1]} (${w.years.length} yrs)`
      : w.years.join(', ');
    return `<div class="warn-item"><span class="yr">${ys}</span>${w.message}</div>`;
  }).join('');
}

/* ---------- Main table (spec section 10) ------------------------------ */
const FULL_COLS = [
  ['Year', (r) => r.year, 'text'],
  ['Age', (r) => r.age, 'text'],
  ['Earned income', (r) => r.earnedIncome],
  ['Pension + SS', (r) => r.otherIncomeTotal],
  ['Investment income', (r) => r.investmentIncome],
  ['Roth conversion', (r) => r.rothConversion],
  ['Depreciation', (r) => r.rentalDepreciation],
  ['Passive loss suspended', (r) => r.rentalLossSuspended],
  ['After-tax 401(k)', (r) => r.contribAfterTax401k],
  ['Gross income', (r) => r.grossIncome],
  ['401(k)', (r) => r.trad401k],
  ['Roth', (r) => r.rothTotal],
  ['Trad IRA', (r) => r.tradIra],
  ['Brokerage', (r) => r.brokerage],
  ['HSA', (r) => r.hsa],
  ['RE equity', (r) => r.realEstateEquity],
  ['Cash', (r) => r.cash],
  ['Net worth', (r) => r.netWorth, 'strong'],
  ['Tax paid', (r) => r.tax],
  ['Eff. rate', (r) => r.effectiveTaxRate, 'pct'],
  ['Net cash flow', (r) => r.netCashFlow, 'signed'],
];
const COMPACT_COLS = [
  ['Year', (r) => r.year, 'text'],
  ['Age', (r) => r.age, 'text'],
  ['Gross income', (r) => r.grossIncome, null,
    'Wages + pension + Social Security + dividends + cash interest. Investment income continues after you stop working, so this does not fall to zero when salary does. Switch off "Compact columns" to see the split.'],
  ['401(k)', (r) => r.trad401k],
  ['Roth', (r) => r.rothTotal],
  ['Brokerage', (r) => r.brokerage],
  ['RE equity', (r) => r.realEstateEquity],
  ['Cash', (r) => r.cash],
  ['Net worth', (r) => r.netWorth, 'strong'],
  ['Tax paid', (r) => r.tax],
  ['Eff. rate', (r) => r.effectiveTaxRate, 'pct'],
  ['Net cash flow', (r) => r.netCashFlow, 'signed'],
];

function renderTable(res) {
  const compact = $('#tblCompact').checked;
  const cols = compact ? COMPACT_COLS : FULL_COLS;
  const I = res.inputs;   // normalised — see renderStats
  const retYear = I.startYear + (I.retirementAge - I.currentAge);

  const head = `<thead><tr>${cols.map(([h, , , tip]) =>
    `<th${tip ? ` title="${tip.replace(/"/g, '&quot;')}" style="cursor:help;text-decoration:underline dotted"` : ''}>${h}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${res.rows.map((r) => {
    const cls = [r.retired ? 'retired' : '', r.year === retYear ? 'retired-start' : '', r.depleted ? 'depleted' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}">${cols.map(([, fn, kind]) => {
      const v = fn(r);
      if (kind === 'text') return `<td>${v}</td>`;
      if (kind === 'pct') return `<td>${pct(v)}</td>`;
      if (kind === 'signed') return `<td class="${v < 0 ? 'neg' : 'pos'}">${M.fmt(v, { sign: true })}</td>`;
      if (kind === 'strong') return `<td><strong>${fmt(v)}</strong></td>`;
      return `<td class="${v === 0 ? 'dim' : ''}">${v === 0 ? '—' : fmt(v)}</td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody>`;
  $('#mainTable').innerHTML = head + body;
}

/* ---------- Withdrawal detail table ----------------------------------- */
function renderWithdrawalTable(res) {
  const rows = res.rows.filter((r) => r.withdrawals.total > 0 || r.withdrawals.rmdRequired > 0);
  if (!rows.length) {
    $('#wdTable').innerHTML = '<tbody><tr><td class="empty">No withdrawals in this plan. Lower the retirement age, raise spending, or set an override to force one.</td></tr></tbody>';
    return;
  }
  const cols = ['Year', 'Age', 'Total sold', 'Brokerage', 'Trad 401(k)', 'Trad IRA', 'Roth', 'HSA',
    'LT gain', 'ST gain', 'RMD req.', 'Penalty base', 'Tax this yr', 'Eff. rate'];
  $('#wdTable').innerHTML =
    `<thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => {
      const w = r.withdrawals;
      const cell = (v) => `<td class="${v === 0 ? 'dim' : ''}">${v === 0 ? '—' : fmt(v)}</td>`;
      const rmdFlag = w.rmdRequired > 0
        ? `<td>${fmt(w.rmdRequired)} ${w.rmdSatisfied >= w.rmdRequired ? '<span class="badge good">met</span>' : '<span class="badge bad">short</span>'}</td>`
        : '<td class="dim">—</td>';
      return `<tr><td>${r.year}</td><td>${r.age}</td>` +
        `<td><strong>${fmt(w.total)}</strong></td>` +
        cell(w.brokerage) + cell(w.trad401k) + cell(w.tradIra) +
        cell(w.roth401k + w.rothIra) + cell(w.hsa) +
        cell(w.longTermGain) + cell(w.shortTermGain) + rmdFlag +
        `<td class="${w.penaltyBase > 0 ? 'neg' : 'dim'}">${w.penaltyBase > 0 ? fmt(w.penaltyBase) : '—'}</td>` +
        `<td>${fmt(r.tax)}</td><td>${pct(r.effectiveTaxRate)}</td></tr>`;
    }).join('') + '</tbody>';
}

/* ---------- Scenario comparison (spec section 10) ---------------------- */
function renderScenarioView() {
  destroy('scen');
  const valid = state.results.map((r, i) => ({ r, i })).filter((x) => x.r);
  if (!valid.length) return;
  const maxLen = Math.max(...valid.map((x) => x.r.rows.length));
  const labels = Array.from({ length: maxLen }, (_, t) => state.scenarios[0].inputs.startYear + t);

  charts.scen = new Chart($('#chartScen'), {
    type: 'line',
    data: { labels,
      datasets: valid.map(({ r, i }) => ({
        label: state.scenarios[i].name,
        data: r.rows.map((row) => D(row.netWorth)),
        borderColor: SCENARIO_COLORS[i], backgroundColor: SCENARIO_COLORS[i] + '15',
        fill: valid.length === 1, pointRadius: 0, tension: 0.25, borderWidth: 2 })) },
    options: { ...BASE_OPTS,
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14 } }, y: AXIS_MONEY } },
  });

  const metrics = [
    ['Ending net worth', (r) => fmt(r.summary.endingNetWorth)],
    ['Peak net worth', (r) => fmt(r.summary.peakNetWorth)],
    ['Lifetime tax paid', (r) => fmt(r.summary.totalTaxPaid)],
    ['Avg effective rate', (r) => pct(r.summary.avgEffectiveRate)],
    ['Total contributed', (r) => fmt(r.summary.totalContributions)],
    ['Total swept', (r) => fmt(r.summary.totalSwept)],
    ['Runs out of money', (r) => r.summary.depleted ? `<span class="badge bad">yes, ${r.summary.depletedYear}</span>` : '<span class="badge good">no</span>'],
    ['Retirement age', (r) => r.inputs.retirementAge],
    ['401(k) split', (r) => `${pct(1 - r.inputs.roth401kSplit, 0)} trad / ${pct(r.inputs.roth401kSplit, 0)} Roth`],
    ['Cash sweep', (r) => r.inputs.sweep.enabled ? 'on' : 'off'],
    ['State', (r) => STATE_TAX[r.inputs.stateCode]?.name ?? r.inputs.stateCode],
  ];
  $('#scenTable').innerHTML =
    `<thead><tr><th>Metric</th>${valid.map(({ i }) =>
      `<th style="color:${SCENARIO_COLORS[i]}">${state.scenarios[i].name}</th>`).join('')}</tr></thead><tbody>` +
    metrics.map(([label, fn]) =>
      `<tr><td>${label}</td>${valid.map(({ r }) => `<td>${fn(r)}</td>`).join('')}</tr>`).join('') +
    '</tbody>';
}

/* ---------- Monte Carlo ------------------------------------------------ */
function runMonteCarlo() {
  const trials = +$('#mcTrials').value;
  const seed = +$('#mcSeed').value || 12345;
  const btn = $('#btnRunMc');
  btn.disabled = true;
  $('#mcStatus').textContent = 'Running…';
  $('#mcProgress').style.display = '';
  $('#mcProgress').value = 0;

  // Yield to the browser so the progress bar can paint.
  setTimeout(() => {
    const t0 = performance.now();
    const mc = monteCarlo(current().inputs, { trials, seed });
    const ms = Math.round(performance.now() - t0);
    state.mc = mc;
    $('#mcProgress').style.display = 'none';
    $('#mcStatus').textContent = `${trials} trials in ${ms} ms`;
    btn.disabled = false;
    renderMonteCarlo();
  }, 30);
}

function renderMonteCarlo() {
  const mc = state.mc;
  if (!mc) return;
  $('#mcResults').style.display = '';

  const rateClass = mc.successRate >= 0.85 ? 'good' : mc.successRate >= 0.7 ? '' : 'bad';
  $('#mcStats').innerHTML = [
    ['Success rate', `<span class="${rateClass === 'good' ? 'pos' : rateClass === 'bad' ? 'neg' : ''}">${pct(mc.successRate, 0)}</span>`,
      `${Math.round(mc.successRate * mc.trials)} of ${mc.trials} trials never ran dry`],
    ['Median outcome', fmt(mc.ending.p50), '50th percentile ending net worth'],
    ['Pessimistic (10th)', fmt(mc.ending.p10), '1 in 10 trials ended below this'],
    ['Optimistic (90th)', fmt(mc.ending.p90), '1 in 10 trials ended above this'],
    ['Worst trial', fmt(mc.ending.min), ''],
    ['Best trial', fmt(mc.ending.max), ''],
  ].map(([l, v, n]) =>
    `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-note">${n}</div></div>`).join('');

  destroy('mc');
  const labels = mc.bands.map((b) => b.year);
  charts.mc = new Chart($('#chartMc'), {
    type: 'line',
    data: { labels, datasets: [
      { label: '90th percentile', data: mc.bands.map((b) => D(b.p90)),
        borderColor: 'transparent', backgroundColor: '#2563eb14', fill: '+1', pointRadius: 0, tension: 0.25 },
      { label: '75th', data: mc.bands.map((b) => D(b.p75)),
        borderColor: 'transparent', backgroundColor: '#2563eb26', fill: '+1', pointRadius: 0, tension: 0.25 },
      { label: 'Median', data: mc.bands.map((b) => D(b.p50)),
        borderColor: '#2563eb', borderWidth: 2, fill: false, pointRadius: 0, tension: 0.25 },
      { label: '25th', data: mc.bands.map((b) => D(b.p25)),
        borderColor: 'transparent', backgroundColor: '#2563eb26', fill: '+1', pointRadius: 0, tension: 0.25 },
      { label: '10th percentile', data: mc.bands.map((b) => D(b.p10)),
        borderColor: 'transparent', backgroundColor: 'transparent', pointRadius: 0, tension: 0.25 },
    ] },
    options: { ...BASE_OPTS,
      plugins: { ...BASE_OPTS.plugins,
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 10.5 },
          filter: (i) => ['Median', '90th percentile', '10th percentile'].includes(i.text) } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14 } }, y: AXIS_MONEY } },
  });
}

/* ---------- Stress test -------------------------------------------------- */
function renderStress() {
  const I = current().inputs;
  if (!state.stress) {
    state.stress = stressTest(I);
    state.stress.sequence = sequenceRiskTest(I);
  }
  const s = state.stress;
  destroy('stress');
  charts.stress = new Chart($('#chartStress'), {
    type: 'line',
    data: { labels: s.average.rows.map((r) => r.year), datasets: [
      { label: 'Optimistic', data: s.optimistic.rows.map((r) => D(r.netWorth)),
        borderColor: '#15803d', fill: false, pointRadius: 0, tension: 0.25, borderWidth: 2 },
      { label: 'Average', data: s.average.rows.map((r) => D(r.netWorth)),
        borderColor: '#2563eb', fill: false, pointRadius: 0, tension: 0.25, borderWidth: 2 },
      { label: 'Pessimistic', data: s.pessimistic.rows.map((r) => D(r.netWorth)),
        borderColor: '#b91c1c', fill: false, pointRadius: 0, tension: 0.25, borderWidth: 2 },
      { label: 'Crash at retirement', data: s.sequence.rows.map((r) => D(r.netWorth)),
        borderColor: '#c2410c', borderDash: [5, 3], fill: false, pointRadius: 0, tension: 0.25, borderWidth: 1.5 },
    ] },
    options: { ...BASE_OPTS,
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 14 } }, y: AXIS_MONEY } },
  });

  const mk = (label, run, note) => {
    const dep = run.summary.depleted;
    return `<div class="stat"><div class="stat-label">${label}</div>
      <div class="stat-value ${dep ? 'neg' : ''}">${fmt(run.summary.endingNetWorth)}</div>
      <div class="stat-note">${dep ? `runs dry in ${run.summary.depletedYear}` : note}</div></div>`;
  };
  $('#stressStats').innerHTML =
    mk('Optimistic', s.optimistic, 'returns 45% above assumption') +
    mk('Average', s.average, 'your stated assumptions') +
    mk('Pessimistic', s.pessimistic, 'returns 55% below assumption') +
    mk('Crash at retirement', s.sequence, '3 years of −15% equities at retirement');
}

/* ---------- Assumptions tab ---------------------------------------------- */
function renderAbout() {
  const cfg = TAX_CONFIG[2026];
  $('#aboutBody').innerHTML = `
    <p><strong>What it models.</strong> A year-by-year ledger. Each year computes income,
    contributions (capped at IRS limits and reduced by phase-outs), taxes, spending,
    withdrawals and growth; the ending balances become the next year's opening balances.
    Every monetary value is stored as an integer number of cents, so rounding error cannot
    compound across a 40-year horizon.</p>

    <p><strong>The withdrawal solver.</strong> Withdrawing from a traditional account creates
    taxable income, which raises the tax bill, which raises the amount you must withdraw.
    The engine resolves this circularity with a fixed-point iteration that converges to
    within one dollar, rather than approximating it in one pass.</p>

    <p><strong>Tax lots.</strong> Each cash sweep and each direct contribution creates its own
    lot with its own basis and purchase year, so later sales distinguish long-term from
    short-term gains. Sales default to long-term lots first, highest basis first, which is
    the tax-minimising order.</p>

    <p><strong>Known simplifications — these matter:</strong></p>
    <ul style="margin:6px 0 6px 16px;padding:0">
      <li>State tax is a single flat rate per state, not a bracket table. Graduated states
          (CA, NY, NJ, OR&hellip;) will be materially wrong at the extremes. Use "Custom rate"
          for a figure you trust.</li>
      <li>No AMT, itemised deductions, QBI deduction, or tax credits (child tax credit,
          saver's credit, ACA premium credits).</li>
      <li>Roth withdrawals before 59½ are treated as fully penalised. In reality your own
          contributions come out tax- and penalty-free first, so this is conservative.</li>
      <li>HSA withdrawals are modelled as non-medical. Qualified medical withdrawals are
          tax-free at any age.</li>
      <li>Annual granularity: a lot bought and sold in the same calendar year is short-term;
          any earlier year is long-term.</li>
      <li>No self-employment tax, no multi-currency, no estate or inheritance tax
          (explicitly out of scope in the brief).</li>
      <li>Tax years beyond ${Math.max(...Object.keys(TAX_CONFIG).map(Number))} are projected by
          indexing the latest published table forward at your inflation assumption. Figures
          Congress did not index — the NIIT threshold, the additional-Medicare threshold,
          the Social Security taxability thresholds and the §121 home-sale exclusion — are
          deliberately held flat, which is what produces realistic bracket creep.</li>
    </ul>

    <p><strong>Updating for a new tax year.</strong> Everything lives in
    <code>tax-config.js</code>. Copy the most recent year block, change the key and the
    figures, and the engine picks it up automatically. Nothing is hardcoded elsewhere.</p>

    <p style="color:var(--warn)"><strong>Unverified figures in the current config:</strong>
    ${cfg._meta.unverified.map((u) => `<br>&bull; ${u}`).join('')}</p>
    <p><strong>Sources:</strong> ${cfg._meta.source}</p>`;

  const rows = [];
  const add = (k, v, n = '') => rows.push([k, v, n]);
  add('Standard deduction — single', fmt(cfg.standardDeduction.single));
  add('Standard deduction — married filing jointly', fmt(cfg.standardDeduction.mfj));
  cfg.ordinaryBrackets.single.forEach((b, i) => {
    const lo = i === 0 ? 0 : cfg.ordinaryBrackets.single[i - 1].upTo;
    add(`Ordinary bracket ${pct(b.rate, 0)} (single)`, b.upTo === null ? `${fmt(lo)} and above` : `${fmt(lo)} – ${fmt(b.upTo)}`);
  });
  cfg.ltcgBrackets.single.forEach((b, i) => {
    const lo = i === 0 ? 0 : cfg.ltcgBrackets.single[i - 1].upTo;
    add(`Capital gains ${pct(b.rate, 0)} (single)`, b.upTo === null ? `${fmt(lo)} and above` : `${fmt(lo)} – ${fmt(b.upTo)}`);
  });
  add('Social Security wage base', fmt(cfg.fica.socialSecurityWageBase));
  add('Social Security / Medicare rate', `${pct(cfg.fica.socialSecurityRate, 2)} / ${pct(cfg.fica.medicareRate, 2)}`);
  add('401(k) elective deferral', fmt(cfg.limits.elective401k));
  add('401(k) catch-up, age 50+', fmt(cfg.limits.catchUp50));
  add('401(k) catch-up, ages 60–63', fmt(cfg.limits.catchUpSuper60to63));
  add('IRA limit / catch-up', `${fmt(cfg.limits.ira)} / ${fmt(cfg.limits.iraCatchUp50)}`);
  add('HSA self-only / family', `${fmt(cfg.limits.hsaSelfOnly)} / ${fmt(cfg.limits.hsaFamily)}`);
  add('Roth IRA phase-out — single', `${fmt(cfg.rothIraPhaseOut.single.start)} – ${fmt(cfg.rothIraPhaseOut.single.end)}`);
  add('Roth IRA phase-out — MFJ', `${fmt(cfg.rothIraPhaseOut.mfj.start)} – ${fmt(cfg.rothIraPhaseOut.mfj.end)}`);
  add('NIIT', `${pct(cfg.niit.rate, 1)} above ${fmt(cfg.niit.threshold.single)} / ${fmt(cfg.niit.threshold.mfj)}`, 'not indexed');
  add('§121 home sale exclusion', `${fmt(cfg.homeSaleExclusion.single)} / ${fmt(cfg.homeSaleExclusion.mfj)}`, 'not indexed');
  add('Early withdrawal penalty', `${pct(cfg.earlyWithdrawal.penaltyRate, 0)} before age ${cfg.earlyWithdrawal.penaltyFreeAge}`);
  add('RMD start age', 'age 73 (born before 1960) or 75');

  $('#cfgTable').innerHTML =
    '<thead><tr><th>Item</th><th>2026 value</th><th>Note</th></tr></thead><tbody>' +
    rows.map(([k, v, n]) => `<tr><td>${k}</td><td>${v}</td><td class="dim">${n}</td></tr>`).join('') +
    '</tbody>';
}

/* ---------- CSV export ---------------------------------------------------- */
function downloadCsv() {
  const res = state.results[state.active];
  if (!res) return;
  const cols = [
    ['Year', (r) => r.year], ['Age', (r) => r.age], ['Retired', (r) => r.retired ? 'yes' : 'no'],
    ['Gross income', (r) => D(r.grossIncome)], ['Salary', (r) => D(r.salary)],
    ['Social Security', (r) => D(r.socialSecurity)],
    ['Cash', (r) => D(r.cash)], ['Traditional 401k', (r) => D(r.trad401k)],
    ['Roth 401k', (r) => D(r.roth401k)], ['Traditional IRA', (r) => D(r.tradIra)],
    ['Roth IRA', (r) => D(r.rothIra)], ['HSA', (r) => D(r.hsa)],
    ['Brokerage', (r) => D(r.brokerage)], ['Brokerage basis', (r) => D(r.brokerageBasis)],
    ['Real estate equity', (r) => D(r.realEstateEquity)], ['Mortgage balance', (r) => D(r.mortgageBalance)],
    ['Net worth', (r) => D(r.netWorth)],
    ['Contribution 401k', (r) => D(r.contrib401k)], ['Employer match', (r) => D(r.employerMatch)],
    ['Contribution IRA', (r) => D(r.contribIra)], ['Swept to investments', (r) => D(r.swept)],
    ['Spending', (r) => D(r.spending)],
    ['Tax total', (r) => D(r.tax)], ['Tax federal', (r) => D(r.taxFederal)],
    ['Tax capital gains', (r) => D(r.taxCapitalGains)], ['Tax FICA', (r) => D(r.taxFica)],
    ['Tax state', (r) => D(r.taxState)], ['Tax NIIT', (r) => D(r.taxNiit)],
    ['Tax penalty', (r) => D(r.taxPenalty)],
    ['Effective tax rate', (r) => (r.effectiveTaxRate * 100).toFixed(2)],
    ['Net cash flow', (r) => D(r.netCashFlow)],
    ['Withdrawals total', (r) => D(r.withdrawals.total)],
    ['Withdrawal brokerage', (r) => D(r.withdrawals.brokerage)],
    ['Withdrawal trad 401k', (r) => D(r.withdrawals.trad401k)],
    ['Withdrawal Roth', (r) => D(r.withdrawals.roth401k + r.withdrawals.rothIra)],
    ['Long-term gain realised', (r) => D(r.withdrawals.longTermGain)],
    ['RMD required', (r) => D(r.withdrawals.rmdRequired)],
  ];
  const csv = [cols.map(([h]) => `"${h}"`).join(',')]
    .concat(res.rows.map((r) => cols.map(([, fn]) => fn(r)).join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `forecast-${current().name.replace(/\W+/g, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJson() {
  const blob = new Blob([JSON.stringify({ scenarios: state.scenarios }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'forecast-scenarios.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===================================================================
 * WIRE UP
 * =================================================================== */
function init() {
  // State dropdown, ordered with the no-income-tax states first.
  const entries = Object.entries(STATE_TAX).filter(([k]) => !k.startsWith('_'));
  entries.sort((a, b) => (a[1].rate - b[1].rate) || a[1].name.localeCompare(b[1].name));
  $('#stateSelect').innerHTML = entries.map(([code, s]) =>
    `<option value="${code}">${s.name}${s.rate > 0 ? ` — ${pct(s.rate, 2)}` : s.custom ? '' : ' — no income tax'}</option>`).join('');

  bindAll();
  refreshAllControls();
  renderReturnInputs();
  renderProperties();
  renderOverrides();
  renderWithdrawalOrder();
  renderScenarioChips();
  renderAbout();

  // Tabs
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    $$('.tabpane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $(`#pane-${t.dataset.tab}`).classList.add('active');
    // Chart.js needs the canvas visible before it can size itself.
    if (t.dataset.tab === 'stress') renderStress();
    if (t.dataset.tab === 'montecarlo' && state.mc) renderMonteCarlo();
    Object.values(charts).forEach((c) => c.resize());
  }));

  // Scenario buttons
  $('#btnAddScenario').addEventListener('click', () => {
    if (state.scenarios.length >= 4) return;
    const n = state.scenarios.length + 1;
    state.scenarios.push({ name: `Scenario ${n}`, inputs: defaultInputs() });
    state.active = state.scenarios.length - 1;
    renderScenarioChips(); refreshAllControls();
    renderReturnInputs(); renderProperties(); renderOverrides(); renderWithdrawalOrder();
    recompute();
  });
  $('#btnDupScenario').addEventListener('click', () => {
    if (state.scenarios.length >= 4) return;
    const copy = JSON.parse(JSON.stringify(current()));
    copy.name = `${copy.name} (copy)`;
    copy.inputs.name = copy.name;
    state.scenarios.push(copy);
    state.active = state.scenarios.length - 1;
    renderScenarioChips(); refreshAllControls();
    renderReturnInputs(); renderProperties(); renderOverrides(); renderWithdrawalOrder();
    recompute();
  });
  $('#btnDelScenario').addEventListener('click', () => {
    if (state.scenarios.length <= 1) return;
    state.scenarios.splice(state.active, 1);
    state.active = Math.max(0, state.active - 1);
    renderScenarioChips(); refreshAllControls();
    renderReturnInputs(); renderProperties(); renderOverrides(); renderWithdrawalOrder();
    recompute();
  });

  $('#btnAddProp').addEventListener('click', () => {
    current().inputs.properties.push(defaultProperty(current().inputs.startYear));
    renderProperties(); recompute();
  });

  $('#btnAddOverride').addEventListener('click', () => {
    const I = current().inputs;
    const y = parseInt($('#ovYear').value, 10);
    if (!y || y < I.startYear || y >= I.startYear + I.horizonYears) {
      $('#ovYear').style.borderColor = 'var(--bad)';
      setTimeout(() => { $('#ovYear').style.borderColor = ''; }, 1200);
      return;
    }
    I.overrides[y] = I.overrides[y] ?? {};
    $('#ovYear').value = '';
    renderOverrides(); recompute();
  });

  $('#btnReset').addEventListener('click', () => {
    state.scenarios = [{ name: 'Baseline', inputs: defaultInputs() }];
    state.active = 0; state.mc = null; state.stress = null;
    $('#mcResults').style.display = 'none';
    renderScenarioChips(); refreshAllControls();
    renderReturnInputs(); renderProperties(); renderOverrides(); renderWithdrawalOrder();
    recompute();
  });

  $('#btnExport').addEventListener('click', exportJson);
  $('#btnCsv').addEventListener('click', downloadCsv);
  $('#btnCsv2').addEventListener('click', downloadCsv);
  $('#tblCompact').addEventListener('change', () => renderTable(state.results[state.active]));
  $('#btnRunMc').addEventListener('click', runMonteCarlo);

  recompute();
  setTimeout(runSelfCheck, 400);
}

/* -------------------------------------------------------------------
 * Self-check — confirms the page actually rendered, rather than failing
 * silently. Logs one summary line plus any problems it finds.
 * ----------------------------------------------------------------- */
function runSelfCheck() {
  const problems = [];
  const res = state.results[state.active];

  if (!res) problems.push('simulation produced no result');
  else {
    if (res.rows.length !== current().inputs.horizonYears) problems.push('wrong number of simulated years');
    if (!res.rows.every((r) => Number.isInteger(r.netWorth))) problems.push('net worth lost cent-integrality');
    if (res.rows.some((r) => r.netWorth < 0)) problems.push('negative net worth');
  }
  if (typeof Chart === 'undefined') problems.push('Chart.js did not load');
  else {
    for (const k of ['stack', 'nw', 'tax', 'cf', 'scen']) {
      if (!charts[k]) problems.push(`chart "${k}" was not created`);
    }
    // The cash-flow chart must show sources broken out, not one lump.
    if (charts.cf && charts.cf.data.datasets.length < 4) {
      problems.push('income vs spending chart is not broken out by source');
    }
    // And the stacked components must reconcile to the net line.
    if (res && charts.cf) {
      const bad = res.rows.filter((r) => {
        const i = Object.values(r.inflow).reduce((a, b) => a + b, 0);
        const o = Object.values(r.outflow).reduce((a, b) => a + b, 0);
        return i - o !== r.netCashFlow;
      });
      if (bad.length) problems.push(`cash-flow components do not reconcile in ${bad.length} years`);
    }
  }
  if (!$('#mainTable tbody tr')) problems.push('year-by-year table is empty');
  if (!$('#statGrid .stat')) problems.push('summary stats did not render');
  if (!$$('#returnsBody input[type=range]').length) problems.push('return sliders did not render');
  if ($('#hsNetWorth').textContent === '—') problems.push('header did not update');

  if (problems.length) {
    console.error('SELF-CHECK FAILED:', problems.join(' | '));
  } else {
    const s = res.summary;
    console.log(`SELF-CHECK OK — ${res.rows.length} years simulated, ` +
      `ending net worth ${fmt(s.endingNetWorth)}, lifetime tax ${fmt(s.totalTaxPaid)}, ` +
      `${Object.keys(charts).length} charts, ${res.warnings.length} notes.`);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
