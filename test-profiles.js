/* ===================================================================
 * test-profiles.js — NAMED PROFILES AND COMPARISON
 * Run with:  node test-profiles.js
 *
 * Profiles are the one thing in this app a person would be genuinely
 * upset to lose, so the tests lean on data safety rather than cosmetics:
 * that a stored profile never shares a reference with live state, that
 * switching cannot corrupt the profile you came from, that deleting one
 * cannot leave a dangling comparison, and that two profiles can never
 * be distinguishable only by position.
 * =================================================================== */
'use strict';
for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js']) {
  Object.assign(global, require(m));
}
const { Money } = require('./money.js');
global.Money = Money;

/* localStorage shim before requiring profiles.js */
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const Pr = require('./profiles.js');

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);
const D = (c) => Money.fmt(c);

section('A profile is a complete, independent snapshot');
{
  const live = defaultInputs();
  const p = Pr.makeProfile('Base', live, 65, null, 0);
  ok('it carries the inputs', p.inputs.currentAge === live.currentAge);
  ok('it carries the target age', p.targetAge === 65);
  ok('it gets an id', typeof p.id === 'string' && p.id.length > 4);
  ok('it gets a colour', /^#[0-9a-f]{6}$/i.test(p.colour));

  /* The important one: mutating live inputs afterwards must not reach
   * into the stored profile. A shared reference here would mean every
   * slider drag silently rewrote the saved plan. */
  live.salary = 999_999_900;
  live.balances.cash = 1;
  ok('mutating live inputs does not touch the profile',
     p.inputs.salary !== 999_999_900 && p.inputs.balances.cash !== 1,
     'the profile shares a reference with live state');

  p.inputs.salary = 123;
  ok('and mutating the profile does not touch live inputs', live.salary === 999_999_900);
}

section('Names are unique, so two profiles are never told apart by position alone');
{
  const list = [];
  const a = Pr.makeProfile(Pr.uniqueName(list, 'Plan'), defaultInputs(), 65, null, 0); list.push(a);
  const b = Pr.makeProfile(Pr.uniqueName(list, 'Plan'), defaultInputs(), 65, null, 1); list.push(b);
  const c = Pr.makeProfile(Pr.uniqueName(list, 'Plan'), defaultInputs(), 65, null, 2); list.push(c);
  ok('duplicates get numbered', a.name === 'Plan' && b.name === 'Plan 2' && c.name === 'Plan 3',
     [a.name, b.name, c.name].join(' | '));
  ok('matching is case-insensitive', Pr.uniqueName(list, 'PLAN') !== 'PLAN',
     Pr.uniqueName(list, 'PLAN'));
  ok('blank names get a fallback', Pr.uniqueName([], '   ') === 'Untitled');
  ok('names are length-capped',
     Pr.makeProfile('x'.repeat(200), defaultInputs(), 65, null, 0).name.length <= 48);
}

section('Round-trips through storage');
{
  const list = [Pr.makeProfile('A', defaultInputs(), 65, null, 0),
                Pr.makeProfile('B', { ...defaultInputs(), retirementAge: 55 }, 60, null, 1)];
  const st = { list, activeId: list[1].id, compareIds: [list[0].id, list[1].id] };
  ok('saving reports success', Pr.saveProfiles(st) === true);
  const back = Pr.loadProfiles();
  ok('both come back', back.list.length === 2);
  ok('the active one is preserved', back.activeId === list[1].id);
  ok('the comparison set is preserved', back.compareIds.length === 2);
  ok('the inputs survive intact', back.list[1].inputs.retirementAge === 55);
  ok('profiles have their own storage key, not the UI state blob',
     Pr.PROFILES_KEY !== 'pf-forecaster-state-v3' && /profiles/.test(Pr.PROFILES_KEY),
     'losing UI state must not take the saved plans with it');
}

section('Corrupt or stale storage degrades quietly');
{
  store[Pr.PROFILES_KEY] = '{ not json';
  ok('malformed JSON yields an empty set, not a crash',
     Pr.loadProfiles().list.length === 0);

  store[Pr.PROFILES_KEY] = JSON.stringify({ list: [{ id: 'x', name: 'junk' }] });
  ok('entries without inputs are dropped', Pr.loadProfiles().list.length === 0,
     'a profile with no inputs would crash the simulator');

  const good = Pr.makeProfile('Real', defaultInputs(), 65, null, 0);
  store[Pr.PROFILES_KEY] = JSON.stringify({
    list: [good], activeId: 'deleted-id', compareIds: ['deleted-id', good.id],
  });
  const st = Pr.loadProfiles();
  ok('an activeId pointing at nothing falls back to the first profile',
     st.activeId === good.id, 'got ' + st.activeId);
  /* ...unless the user deleted the profile they were in. Then the live
   * plan belongs to nobody, and adopting an unrelated profile means the
   * next write destroys it. */
  store[Pr.PROFILES_KEY] = JSON.stringify({
    list: [good], activeId: null, detached: true, compareIds: [],
  });
  ok('but a deliberate detach is honoured, not overridden',
     Pr.loadProfiles().activeId === null,
     'adopting list[0] here overwrites it on the next sync');
  ok('and detach survives a save/load round trip',
     (Pr.saveProfiles({ list: [good], activeId: null, detached: true, compareIds: [] }),
      Pr.loadProfiles().detached === true));
  ok('comparison ids for deleted profiles are dropped',
     st.compareIds.length === 1 && st.compareIds[0] === good.id,
     'a dangling id renders as a blank series');
}

section('Comparison reads the engine, and the engine only');
{
  const base = Pr.makeProfile('Retire at 65', defaultInputs(), 65, null, 0);
  const early = Pr.makeProfile('Retire at 55',
    { ...defaultInputs(), retirementAge: 55 }, 65, null, 1);
  const a = Pr.summarise(base, simulate);
  const b = Pr.summarise(early, simulate);

  ok('summaries carry rows for charting', a.rows.length === base.inputs.horizonYears);
  ok('figures are cent-integers', Number.isInteger(a.netWorthAtTarget)
     && Number.isInteger(a.lifetimeTax));
  ok('retiring earlier lowers net worth at the same target age',
     b.netWorthAtTarget < a.netWorthAtTarget,
     `${D(b.netWorthAtTarget)} vs ${D(a.netWorthAtTarget)}`);
  ok('and lowers lifetime tax', b.lifetimeTax < a.lifetimeTax);

  /* The figures must agree with the engine's own summary — a second
   * implementation of "lifetime tax" is a second thing that can
   * disagree with the status strip. */
  const run = simulate(base.inputs);
  ok('lifetime tax matches the engine summary exactly',
     a.lifetimeTax === run.summary.totalTaxPaid,
     `${a.lifetimeTax} vs ${run.summary.totalTaxPaid}`);
  ok('ending net worth matches exactly',
     a.endNetWorth === run.summary.endingNetWorth);
  ok('peak net worth matches exactly', a.peakNetWorth === run.summary.peakNetWorth);
  ok('depletion agrees', a.depleted === !!run.summary.depleted);
}

section('"Best" is only claimed where better is unambiguous');
{
  const sums = [
    Pr.summarise(Pr.makeProfile('A', defaultInputs(), 65, null, 0), simulate),
    Pr.summarise(Pr.makeProfile('B', { ...defaultInputs(), retirementAge: 55 }, 65, null, 1), simulate),
  ];
  const byKey = Object.fromEntries(Pr.COMPARE_ROWS.map((r) => [r.key, r]));
  ok('higher net worth wins', Pr.bestOf(sums, byKey.netWorthAtTarget) === sums[0].id);
  ok('lower lifetime tax wins', Pr.bestOf(sums, byKey.lifetimeTax) === sums[1].id);
  ok('retirement age has no winner', Pr.bestOf(sums, byKey.retirementAge) === null,
     'neither direction is good or bad on its own');
  ok('depletion age has no winner', Pr.bestOf(sums, byKey.depletedAge) === null);

  const same = [sums[0], { ...sums[0], id: 'other' }];
  ok('a tie has no winner', Pr.bestOf(same, byKey.netWorthAtTarget) === null,
     'highlighting an arbitrary winner is worse than highlighting none');
  ok('a single profile has no winner',
     Pr.bestOf([sums[0]], byKey.netWorthAtTarget) === null);
}

section('Limits are enforced where they matter');
{
  ok('comparison is capped at 4, as the brief specified', Pr.MAX_COMPARE === 4);
  ok('and the stored count is capped', Pr.MAX_PROFILES >= 8);
  const many = [];
  for (let i = 0; i < Pr.MAX_PROFILES + 6; i++) {
    many.push(Pr.makeProfile('P' + i, defaultInputs(), 65, null, i));
  }
  Pr.saveProfiles({ list: many, activeId: many[0].id, compareIds: [] });
  ok('saving truncates rather than throwing',
     Pr.loadProfiles().list.length === Pr.MAX_PROFILES);
  ok('colours cycle rather than running out',
     many.every((p) => /^#[0-9a-f]{6}$/i.test(p.colour)));
  ok('the first few colours are distinct',
     new Set(Pr.PROFILE_COLOURS.slice(0, 4)).size === 4);
}

section('The app wiring keeps live state and stored profiles apart');
{
  const src = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok('inputs are cloned on save', /p\.inputs = cloneProfileData\(S\.inputs\)/.test(src));
  ok('and cloned on load',
     /S\.inputs = \{ \.\.\.defaultInputs\(\), \.\.\.cloneProfileData\(p\.inputs\) \}/.test(src));
  ok('edits are written back before switching away',
     /syncActiveProfile\(\);\s*\/\/ keep edits/.test(src));
  ok('the ghost trace is cleared on switch, not carried across profiles',
     /S\.prev = null;\s*\/\/ a ghost from another profile is a lie/.test(src));
  /* Scoped to profileSwitch. The bare /S\.mc = null;/ also matched the
   * Reset-everything handler, so deleting it from the switch path left
   * this green. */
  ok('Monte Carlo results are cleared too',
     /function profileSwitch[\s\S]{0,900}?S\.mc = null;/.test(src));
  ok('deleting the active profile keeps the live plan',
     /P\.activeId = null;/.test(src));
  ok('delete needs two clicks', /dataset\.armed === '1'/.test(src));
  ok('profile names are escaped on the way into HTML',
     /const esc = \(t\) =>/.test(src) && /esc\(p\.name\)/.test(src));
  ok('the overlay is in the Escape set', /'#modePick', '#profiles'/.test(src));
  ok('P opens it', /k === 'p' && !anyOpen\(\)/.test(src));
}

console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
