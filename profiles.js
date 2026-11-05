/* ===================================================================
 * profiles.js — named profiles, and comparing them
 *
 * Scenario comparison was priority 7 in the original brief and it
 * worked; it was then dropped during the HUD redesign and nobody
 * noticed for several rounds of changes. This restores it properly.
 *
 * A profile is a complete, self-contained snapshot: the inputs, the
 * target age, and the character if one was built. Nothing is shared by
 * reference with live state — switching profiles must not be able to
 * mutate the one you came from, which is the obvious way to lose
 * somebody's data.
 *
 * Deliberately NOT stored in the main state blob. Profiles are the
 * thing a person would be upset to lose, so they live under their own
 * key: a corrupt or cleared UI state cannot take them with it.
 * ================================================================= */
'use strict';

const PROFILES_KEY = 'pf-forecaster-profiles-v1';
const MAX_COMPARE = 4;          // the brief said 2-4; more is unreadable
const MAX_PROFILES = 24;

/* Colours used to tell profiles apart on a shared chart. Chosen to stay
 * distinguishable for the common forms of colour blindness: they differ
 * in lightness as well as hue, so they are not only "red vs green". */
const PROFILE_COLOURS = [
  '#5ec8ff', '#ffa62b', '#4ade80', '#c084fc',
  '#fb7185', '#22d3ee', '#a3e635', '#f472b6',
];

/* The same eight hues darkened for a white background. A 2px line in
 * '#4ade80' or '#a3e635' is barely visible on white, and these colours
 * are also used for the chip text, which has to be readable. Same
 * length and same order, so a profile's identity does not change with
 * the theme — only its rendered value. */
const PROFILE_COLOURS_LIGHT = [
  '#0b6fa8', '#9a5b00', '#1a7f3c', '#7c3aed',
  '#c0304a', '#0e7490', '#4d7c0f', '#be185d',
];

/* Which palette a profile's stored colour maps to. Stored colours are
 * always the dark values; the light ones are derived by position. */
function profileColour(colour, theme) {
  if (theme !== 'light') return colour;
  const i = PROFILE_COLOURS.indexOf(colour);
  return i >= 0 ? PROFILE_COLOURS_LIGHT[i] : '#0b6fa8';
}

const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* Deep clone without structuredClone, which is absent in older Safari
 * and in the test shims. Inputs are plain JSON by construction. */
const clone = (o) => JSON.parse(JSON.stringify(o));

function makeProfile(name, inputs, targetAge, character, colourIndex) {
  return {
    id: newId(),
    name: String(name || 'Untitled').slice(0, 48),
    created: new Date().toISOString(),
    colour: PROFILE_COLOURS[(colourIndex ?? 0) % PROFILE_COLOURS.length],
    inputs: clone(inputs),
    targetAge,
    character: character ? clone(character) : null,
  };
}

function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return { list: [], activeId: null, compareIds: [], detached: false };
    const d = JSON.parse(raw);
    const list = Array.isArray(d.list) ? d.list.filter(isProfile) : [];
    const ids = new Set(list.map((p) => p.id));
    return {
      list,
      detached: !!d.detached,
      /* `detached` means the user deleted the profile they were in, so
       * the live plan belongs to nobody. Falling back to list[0] there
       * marked an unrelated profile as open while the live inputs held
       * the deleted one's figures — and the next write destroyed it. */
      activeId: ids.has(d.activeId) ? d.activeId
        : (d.detached ? null : (list[0] ? list[0].id : null)),
      /* Drop ids that no longer exist — a deleted profile left in the
       * compare set would otherwise render as a blank series. */
      compareIds: (Array.isArray(d.compareIds) ? d.compareIds : [])
        .filter((id) => ids.has(id)).slice(0, MAX_COMPARE),
    };
  } catch { return { list: [], activeId: null, compareIds: [], detached: false }; }
}

function isProfile(p) {
  return !!p && typeof p.id === 'string' && typeof p.name === 'string'
    && p.inputs && typeof p.inputs === 'object'
    && typeof p.inputs.currentAge === 'number';
}

function saveProfiles(state) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify({
      list: state.list.slice(0, MAX_PROFILES),
      activeId: state.activeId,
      detached: !!state.detached,
      compareIds: state.compareIds.slice(0, MAX_COMPARE),
    }));
    return true;
  } catch { return false; }
}

/* A name that is unique within the list, so two profiles can never be
 * told apart only by position. */
function uniqueName(list, wanted) {
  const base = String(wanted || 'Untitled').trim().slice(0, 48) || 'Untitled';
  const taken = new Set(list.map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base + ' ' + newId();
}

/* -------------------------------------------------------------------
 * Comparison. Runs each profile through the engine and reduces it to
 * the handful of figures worth putting side by side.
 * ----------------------------------------------------------------- */
function summarise(profile, simulateFn) {
  const run = simulateFn(profile.inputs);
  const rows = run.rows;
  /* Read the engine's own summary rather than re-deriving these. A
   * second implementation of "lifetime tax" is a second thing that can
   * disagree with the status strip, and the comparison table is exactly
   * where a disagreement would be noticed and believed. */
  const sum = run.summary;
  /* The engine's own helper, the same one the status strip uses, so the
   * headline figure and this table cannot answer "net worth at age N"
   * differently. */
  const target = (typeof rowAtAge === 'function')
    ? rowAtAge(rows, profile.targetAge)
    : rows.find((r) => r.age >= profile.targetAge) || rows[rows.length - 1];
  const dry = rows.find((r) => r.depleted);
  return {
    id: profile.id,
    name: profile.name,
    colour: profile.colour,
    rows,
    netWorthAtTarget: target ? target.netWorth : 0,
    targetAge: profile.targetAge,
    retirementAge: profile.inputs.retirementAge,
    endNetWorth: sum.endingNetWorth,
    lifetimeTax: sum.totalTaxPaid,
    depleted: !!sum.depleted,
    depletedAge: dry ? dry.age : null,
    peakNetWorth: sum.peakNetWorth,
    warnings: run.warnings.length,
  };
}

/* The figures a comparison table shows, and which direction is better.
 * `better: 0` means neither direction is good or bad on its own. */
const COMPARE_ROWS = [
  { key: 'netWorthAtTarget', label: 'Net worth at target age', kind: 'money', better: 1 },
  { key: 'endNetWorth', label: 'Net worth at the end', kind: 'money', better: 1 },
  { key: 'peakNetWorth', label: 'Peak net worth', kind: 'money', better: 1 },
  { key: 'lifetimeTax', label: 'Lifetime tax', kind: 'money', better: -1 },
  { key: 'retirementAge', label: 'Retires at', kind: 'age', better: 0 },
  { key: 'depletedAge', label: 'Money runs out at', kind: 'age', better: 0 },
];

/* Which cell in a row is the best one. Returns null when the figures
 * tie, or when the row has no good direction — highlighting an
 * arbitrary winner would be worse than highlighting none. */
function bestOf(summaries, rowDef) {
  if (!rowDef.better) return null;
  const vals = summaries.map((s) => s[rowDef.key]).filter((v) => typeof v === 'number');
  if (vals.length < 2) return null;
  const want = rowDef.better > 0 ? Math.max(...vals) : Math.min(...vals);
  if (vals.every((v) => v === want)) return null;
  const hit = summaries.find((s) => s[rowDef.key] === want);
  return hit ? hit.id : null;
}

const _profileExports = {
  PROFILES_KEY, MAX_COMPARE, MAX_PROFILES, PROFILE_COLOURS, PROFILE_COLOURS_LIGHT,
  profileColour, COMPARE_ROWS,
  makeProfile, loadProfiles, saveProfiles, uniqueName, summarise, bestOf,
  isProfile, cloneProfileData: clone,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _profileExports;
else if (typeof self !== 'undefined') Object.assign(self, _profileExports);
