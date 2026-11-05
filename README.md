# Personal Finance & Retirement Forecasting Tool

A client-side, year-by-year personal finance simulator built to the
`Personal_Finance_Forecasting_Tool_Spec.txt` brief. No backend, no build step,
no dependencies except Chart.js from a CDN.

**This is a planning estimate tool, not tax or investment advice.**

---

## Quick start

```
git clone <your-repo-url>
cd personal-finance-forecaster
open index.html          # or just double-click it
npm test                 # 1,433 assertions across thirteen suites
```

No dependencies, no build step, no server. Node is needed only for the
tests and the helper scripts.

### Putting it on GitHub Pages

1. Push this folder to a repository.
2. Settings -> Pages -> Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Your tool appears at `https://<user>.github.io/<repo>/`.

`index.html` is the entry point and loads the source files separately.
`forecaster.html` is the same app bundled into one file, useful for emailing or
running from a USB stick. **Set your own combination before you publish** — the
one shipped here is not private:

```
node set-combo.js        # prints a new combo once, writes only its hash
node build.js            # refresh forecaster.html
```

One caveat on Pages: the lock uses the Web Crypto API, which needs a secure
context. `https://` and `localhost` are fine. If you serve it over plain
`http://` the lock cannot verify and will tell you so.

## Running it

Open `index.html` in a browser. That's it.

`forecaster.html` is the same app bundled into one self-contained file — useful
for emailing, hosting, or opening from a USB stick. Regenerate it after any
source change with:

```
node build.js
```

Run the test suite with:

```
node test-engine.js        # 336 assertions
```

---

## Files

| File | What it is |
|---|---|
| `tax-config.js` | **All tax data.** Brackets, deductions, contribution limits, phase-outs, RMD tables, state rates. The only file to edit for a new tax year. |
| `money.js` | Decimal-safe arithmetic. Every monetary value is an integer number of cents. |
| `tax-engine.js` | Pure tax functions: brackets, LTCG stacking, FICA, NIIT, Social Security taxability, phase-outs. |
| `engine.js` | The simulation. Year loop, cash sweep, tax lots, withdrawals, RMDs, real estate, Monte Carlo. |
| `app.js` | HUD controller: bindings, delta badges, charts, settings, creation, profiles, themes. |
| `controls.js` | The 22 live controls, in four groups, with statute-aware caps. |
| `profiles.js` | Named plans, storage, and the comparison summary. |
| `guidance.js` | Turns one simulated year into moves, headroom and flags. |
| `svg-chart.js` | The no-dependency chart renderer used when Chart.js is blocked. |
| `pack.js` | Builds the release zip, refusing to ship anything personal. |
| `gen-sheet.js` | Dev tool: renders the avatar contact sheet. |
| `optimizer.js` | Auto-optimise. Coordinate ascent with spending held as a constraint. |
| `characters.js` | Occupation presets with provenance tags. The only file with preset data. |
| `avatar.js` | Layered SVG character. No image files. |
| `audio.js` | Synthesised interface audio. No sound files. |
| `index.html` / `styles.css` | Markup and styling. |
| `test-engine.js` | Engine verification suite. |
| `auth.js` | Entry gate — puzzle or password. Read its header before trusting it. |
| `test-auth-dial.js` / `test-auth.js` / `test-auth-flow.js` | Gate verification: ring lock, text generators, wiring. |
| `set-combo.js` | Set the lock's combination. Prints it once; writes only a hash. |
| `set-password.js` | Change the password if using `password` mode. |
| `build.js` | Bundler. |
| `forecaster.html` | Generated single-file build. |

---

## Spec coverage

| § | Requirement | Status |
|---|---|---|
| 2 | Year-by-year engine, global assumptions, per-year overrides, named scenarios | Done |
| 3 | Cash, Trad 401(k), Roth 401(k)/IRA, Trad IRA, brokerage, real estate, bonds bucket, HSA/529/gold/crypto | Done |
| 4 | Cash sweep: buffer, frequency, allocation, per-sweep tax lots, per-scenario toggle | Done |
| 5 | Salary + growth, 401(k) $ or %, match formula, Roth/Trad IRA with phase-outs, direct brokerage, filing status, state | Done |
| 6 | Federal brackets, pre-tax vs Roth, FICA with wage cap, LT/ST gains, ordinary treatment of Trad withdrawals, 10% penalty with exception toggle, state module, §121 exclusion, tax broken out by category | Done |
| 7 | Target spending, configurable withdrawal order, per-account detail, partial withdrawals across accounts, RMDs | Done |
| 8 | Per-asset-class returns, fixed mode, Monte Carlo, inflation, real-vs-nominal toggle | Done |
| 9 | Purchase price/date, amortisation, appreciation, property tax with reassessment cap, insurance, maintenance, sale with exclusion + costs + proceeds routing | Done |
| 10 | Stacked balance chart, net worth line, full table, withdrawal detail table, 2–4 scenario comparison, optimistic/average/pessimistic | Done |
| 11 | Client-side, versioned config, fixed-point money, fixed-return first then Monte Carlo, disclaimers | Done |
| 12 | Plaid, multi-currency, estate tax, self-employment tax | Out of scope, not built |

---

## Three things worth knowing about the implementation

**Money is integer cents, everywhere.** Section 11 asked for fixed-point
arithmetic. Every balance, contribution and tax figure is a whole number of
cents; every multiplication by a rate rounds straight back to a cent. A test
compounds a balance for 40 years and asserts the result is still an integer.
`Money.split()` and `Money.allocate()` distribute remainder pennies so no money
is created or destroyed when a sweep is divided into twelve monthly lots.

**Withdrawals are solved, not estimated.** Drawing from a traditional account
creates taxable income, which raises the tax bill, which raises the amount you
have to draw. The engine resolves that circularity with a fixed-point iteration
that converges to within a dollar — typically in three or four passes. A
single-pass approximation would understate retirement tax noticeably.

**The strongest test is conservation.** In a world with zero returns, zero
inflation and no state tax, ending net worth must equal starting net worth plus
wages minus spending minus tax, exactly, every year. That test catches
double-counted cash flows that directional "did it go up?" tests miss — it is
how the rental-income double-count and the Washington capital-gains bug were
found.

---

## Updating for a new tax year

Open `tax-config.js`, copy the most recent year block, change the key and the
figures, update `_meta.source` and `_meta.verifiedOn`, and list anything you
could not verify in `_meta.unverified` (the Assumptions tab displays that list
to the user). Nothing else needs to change.

Simulated years past the last configured year are projected by indexing the
latest table forward at your inflation assumption. Figures Congress did **not**
index are deliberately held flat — the NIIT threshold, the additional-Medicare
threshold, the Social Security taxability thresholds and the §121 home-sale
exclusion. That is what produces realistic bracket creep over a long forecast.

---

## Known simplifications

These are real and worth reading before trusting a number.

- **State tax is one flat rate per state, not a bracket table.** Graduated
  states (CA, NY, NJ, OR, MN…) are materially wrong at the extremes. Use the
  "Custom rate" option with a figure from your own return.
- **No AMT, itemised deductions, QBI deduction, or credits** (child tax credit,
  saver's credit, ACA premium credits).
- **Roth withdrawals before 59½ are treated as fully penalised.** In reality
  your own contributions come out tax- and penalty-free first. This is
  conservative, not accurate.
- **HSA withdrawals are modelled as non-medical.** Qualified medical
  withdrawals are tax-free at any age.
- **Annual granularity.** A lot bought and sold in the same calendar year is
  short-term; any earlier year is long-term. Real holding periods are daily.
- **Rental income is modelled simply** — no depreciation, no depreciation
  recapture on sale, no passive-activity loss limits.
- **Two figures in the 2026 config were not web-verified**: the §415(c)
  defined-contribution limit and the §401(a)(17) compensation limit. Both are
  flagged in `_meta.unverified` and surfaced in the Assumptions tab. They only
  affect after-tax / mega-backdoor modelling, which this version does not use.

---

## Tax data sources

2026 figures verified 23 September 2026 against:

- IRS Rev. Proc. 2025-32 — inflation adjustments (brackets, standard deduction)
- IRS Notice 2025-67 — retirement plan contribution limits
- SSA — 2026 Social Security wage base

---

## Security, and what the entry gate is really worth

`auth.js` puts a challenge in front of the tool. **Read this before trusting
it.**

### Modes

Set `AUTH_CONFIG.mode` in `auth.js`:

| Mode | What the visitor sees | Notes |
|---|---|---|
| `dial` *(default)* | An interactive combination lock to open | **Answer is an arrangement, not a string** |
| `finance` | A finance question with randomised numbers | Easy for a human — and easy for a language model |
| `arithmetic` | Generated sums | Fastest; best pure bot filter |
| `sequence` | Spot the next number | Generated |
| `riddle` | A fixed question you write | A shared secret — publishing burns it |
| `password` | Password prompt | PBKDF2 verifier, `node set-password.js` |

`AUTH_CONFIG.rounds` sets how many puzzles must be solved in a row for the text
modes (default 2); a wrong answer twice swaps in a different puzzle, so guessing
at one question gets nowhere. `dial` is a single challenge. A solve is
remembered for the browser tab's session.

**Accessibility:** `dial` is visual and pointer-driven, so it is a poor fit for
screen readers. Arrow-key control is wired up, but that does not make it
equivalent. If any of your visitors rely on assistive technology, use `riddle`
or `password` instead.

### The combination lock, and how to solve it

Six concentric rings, each cut with one slot. Twelve numbered red markers on
the outer bezel. **Every ring has to point at one specific marker, and the
pairing is not shown** — you need the combination. The inner five are fixed;
the outermost changes daily (see below).

Ring numbers ride inside each slot; marker numbers sit on the bezel. A ring
turns blue once it is seated on *any* marker, and the hub counts how many are
seated. It deliberately does **not** tell you whether a ring is on the *right*
marker — that would leak the answer one ring at a time. Seat them all and it
either opens or says "that is not the combination."

**Click straight onto a ring, at the marker you want.** It snaps there. Six
clicks and you are in. Dragging fine-tunes; arrow keys work too (up/down picks
a ring, left/right turns it).

### The day ring

The **outermost** ring (tinted pale violet) is not part of the fixed
combination. Its target is the day of the week, in the visitor's own timezone:

| Day | Marker |
|---|---|
| Sunday | 1 |
| Monday | 2 |
| Tuesday | 3 |
| Wednesday | 4 |
| Thursday | 5 |
| Friday | 6 |
| Saturday | 7 |

So if your fixed rings were `4-1-7-10-2`, you would enter `4-1-7-10-2-1` on a
Sunday and `4-1-7-10-2-6` on a Friday. (An illustration — not a live
combination.)

`set-combo.js` stores **seven** PBKDF2 verifiers, one per weekday, each covering
the whole six-ring arrangement. No ring is ever compared in plaintext, and the
day is read at check time rather than page load, so a tab left open across
midnight simply wants the outer ring moved on.

**What this buys, honestly:** nothing against someone reading `auth.js` — the
rule is in the source and the date is public, so the keyspace stays at
`arrows ^ fixed rings`. What it does buy is protection against the *likely*
leak: a combination on a sticky note, in a screenshot, or passed on verbally is
wrong six days out of seven unless the rule travels with it. For a tool shared
with a few people, that is the realistic threat.

Turn it off with `dayRing: false` and re-run `set-combo.js`.

### Setting the combination

```
node set-combo.js              # random, prints it once
node set-combo.js 4 1 7 10 2   # one you choose (fixed rings only)
node set-combo.js --print      # show without writing
node build.js                  # refresh forecaster.html
```

With `dayRing` on you supply one number fewer than `rings` — the day ring is
derived, not chosen.

The combination is **never written to disk.** `set-combo.js` prints it to your
terminal and writes only a PBKDF2-SHA256 verifier into `auth.js`. Generating it
yourself is strictly better than being told it — nobody else, and no chat log,
ever sees it.

### Keyspace — the honest number

The markers are **visible**, so an attacker already knows every valid target
angle. The only secret is which ring pairs with which marker, giving
`arrows ^ rings` combinations:

| Markers | Rings | Combinations | Brute force, 1 core @50ms/guess |
|---|---|---|---|
| 8 | 4 | 4,096 | ~2 min |
| 8 | 5 | 32,768 | ~14 min |
| **12** | **5 fixed + day** | **248,832** | **~1.7 hours** |
| 12 | 6 | 2,985,984 | ~21 hours |
| 16 | 6 | 16,777,216 | ~5 days |

Hashing the combination is what makes those numbers mean anything: reading
`auth.js` gives a verifier, not an answer, so extracting it means writing a
brute-forcer and paying 250,000 iterations per guess. A GPU collapses all of it.
Raise `arrows` and `rings` to buy more time; nothing client-side buys security
outright.

### Why an interactive puzzle beats both a password and a text puzzle

A text question — even a randomised one — is exactly what a language model is
good at. That is why `finance` is no longer the default: it reads the question
and types the answer.

The combination lock has **no answer to type**. The solution is a physical
arrangement of rings, checked against a hash. A text-only model has nothing to
emit, and cannot read the answer out of the source either. Getting in requires
both the combination and a real pointer driven to computed coordinates on
specific rings.

### Why a generated challenge beats a password here

A password's whole value is that the visitor knows a secret. Publish the repo
and the secret is public — the value is gone, and you have burned a password you
might have reused. A **generated** puzzle stores no answer at all: the question
and its solution are computed fresh on each load from random parameters. There
is nothing in the source to look up.

Stated plainly: a puzzle is **weaker** against a determined human, who just
solves it. It is **stronger** against everything else, and it survives being
published. For a public repo that is the better bet, which is why `finance` is
the default.

### What none of it does

Every mode runs in the visitor's browser. Nothing is checked on a server,
because GitHub Pages has no server to check it on. It is a **doormat, not a
lock.**

What it genuinely does:

- stops crawlers, scrapers and bots, which will not solve a puzzle
- stops drive-by visitors who cannot be bothered
- signals the page is not meant to be public

What it does **not** do:

- protect anything committed to the repository
- stand up to anyone who opens devtools

### If you use `password` mode

The password itself is not stored. What is stored is a PBKDF2-SHA256 verifier
over a random salt at 250,000 iterations, so the plaintext isn't sitting in the
repo and offline guessing is slowed. Slowed, not stopped — a short or
predictable password still falls to a wordlist quickly, and **on a public repo
it is public**, so never reuse one that matters.

```
node set-password.js      # prompts, hidden input, rewrites auth.js
node build.js             # refresh forecaster.html
```

### Tests

```
node test-auth-dial.js    # the combination lock. Does NOT know the combo:
                          # it brute-forces a reduced keyspace to prove
                          # exactly one arrangement opens the lock. Also
                          # geometry for 2-8 rings, click-to-snap,
                          # rejection of seated-but-wrong, keyboard route
node test-auth.js         # text puzzle generators: 2,000 draws per mode,
                          # and every finance puzzle solved by independent
                          # re-derivation from its own wording
node test-auth-flow.js    # the gate's wiring, against a DOM shim
```

### If you want actual access control

Host the page behind something that authenticates on a **server**, before the
page is ever sent:

| Option | Notes |
|---|---|
| **Cloudflare Access** | Free for small teams. Real identity checks in front of any origin, including GitHub Pages via a custom domain. The closest thing to "free and actually secure". |
| Netlify / Vercel password protection | Server-side, on paid tiers. One toggle. |
| Any host with HTTP Basic auth | Crude but genuinely server-side. |
| Private repo, no public hosting | Fully secure; clone and open `index.html` locally. |

GitHub Pages has no server-side auth of its own, so a gate served from it is
always client-side.

### Keep your own numbers out of the repository

**This matters more than the gate.** These files contain real salary figures,
account balances and a name, and the password gate does nothing to protect
them — anything in the repo is visible to anyone who can see the repo:

- your own scenario file (anything matching `*-scenario.js`)
- anything generated for an adviser (`cpa-review.*`)

Both are listed in `.gitignore`. Verify before your first push:

```
git status --ignored     # confirm they appear under "Ignored files"
git ls-files             # confirm they do NOT appear here
```

If either has already been committed, removing it in a later commit is not
enough — it stays in the history. Use `git filter-repo` or start the repo
fresh.

The tool itself holds no data. Everything you type stays in memory in your own
browser; nothing is transmitted or persisted server-side. So the calculator is
safe to publish. Your scenario files are not.

---

## The HUD

The interface is a dark instrument panel rather than a form. One rule runs
through it: **cyan carries data, amber carries state.** That keeps a cool glass
readout and a warm industrial character bay on the same screen without them
fighting, and it gives the warmth a job.

- **Status strip** — net worth at your target age, lifetime tax, Monte Carlo
  success, plan status. Every one shows a **delta badge** when you move a
  control, so a change here is visibly a consequence there.
- **Command card** — the live controls, in fixed positions.
  `1`–`9` to focus, `[` and `]` to step through all 22, `↑`/`↓` to adjust.
- **Six views** — Balances, Net worth, Tax, Flow, Bands, Table. The net-worth
  view keeps a **ghost trace** of the previous run so you see before and after
  on the same axes. Retirement and depletion are drawn as markers on every one.
- **Year scrubber and inspector** — drag along the horizon and the right column
  decomposes that single year: every source in, every destination out, the tax
  breakdown, conversions, RMDs, penalties, and any warnings the engine raised.
- **Character bay** — a compact portrait niche inside the strip, holding an
  armoured operator portrait built from your creation choices. Click it and it
  reacts: salute, flex, and eventually visible irritation, with a line of
  role-appropriate chatter. Purely cosmetic, and structurally unable to stretch
  the header.
- **Settings** — twelve pages, live-applying, with an amber dot on any page
  holding a non-default value. **Reset page** resets only that page's keys —
  the same map the amber dot uses.

Keys: `S` settings · `C` character · `M` mute · `Esc` close.

## Running order

1. **Entry lock** — the combination dial (see above), unless `mode: 'off'`.
2. **Which front door** — Planner or Arcade. This is asked first because the
   answer decides whether music starts and whether character creation happens
   at all.
3. **Character creation** — Arcade only, on first visit. Planner goes straight
   to the dashboard with a preset offer and three dismissible pointers.
4. **Settings, page 1** — Arcade hands straight off here, so the numbers a preset
   just derived get confirmed by a human rather than silently assumed. Every
   field keeps its provenance badge: `measured`, `derived` or `statute`.
5. **The HUD.**

Solving the lock is also the browser gesture that lets audio start, which is why
music and cues can ship switched on. Both are togglable in Settings → Character & audio.

## What to do this year

The year inspector listed money in and money out — what happened, not what to do.
Scrub to any year and the right-hand column now opens with **This year**:

- **The moves.** Which accounts were drawn and how much, largest first, each with
  what it costs in tax: *cash — no tax, it has already been taxed*; *taxable
  brokerage — tax on the gain only, at capital-gains rates*; *traditional 401(k)
  — taxed as ordinary income, every dollar*; *Roth — tax-free*.
- **The headroom**, which is where the decisions actually live. How much more
  ordinary income would still be taxed at the current rate — the room a Roth
  conversion would use — and how much long-term gain could be realised at **0%**.
  Shown only when there is enough of either to act on, because a line reading
  "0 left" is noise.
- **The flags.** An RMD due, a withdrawal before 59½ with the penalty it carries
  and the usual way around it, a Roth conversion running this year, short-term
  gain that a year's patience would have avoided. A quiet working year raises
  none — a panel that always warns teaches people to ignore it.

Every figure comes from the row the engine already computed; nothing is
re-derived. It is arithmetic on your own assumptions, not advice: it cannot know
about a pension nobody entered, a state move, a health event, or next year's law.

### A real bug this surfaced

The headroom was first measured against **total** taxable income while the
engine's marginal rate is measured against **ordinary** taxable income, so the
panel could read *"next dollar taxed at 10%"* directly above *"$44,784 more would
still be taxed at 12%"*. Two numbers contradicting each other on one screen is
worse than either being missing.

Fixing it exposed a genuine off-by-one in `tax-engine.js`: `marginalRate` used
`taxable <= top`, which at income exactly equal to a bracket's top reported the
band just filled rather than the one the next dollar falls into. Both now use
`<`, and `test-guidance.js` asserts the playbook's band matches
`row.marginalRate` for **every year of a 45-year run, with bracket indexing both
on and off** — 90 paired comparisons.

## Profiles

A profile is a complete saved plan — every setting, the target age, and the
character if you built one. The **bar above the chart** holds them:

- **Click a name** to open that profile. Its settings become the live ones.
- **Click the coloured dot** to pin it onto the charts.
- **Pin two or more and you are comparing.** There is no Compare button; the
  pinned set *is* the mode, and the bar, the view note and the status-strip label
  all say so.

Rename, duplicate and delete live under **Manage…** (deleting takes two clicks).
Up to four compared at once.

### Comparison is in the charts, not a separate screen

Whichever view you are on, your open profile fades and each pinned profile draws
as one line in its own colour: total assets on **Balances**, net worth on **Net
worth**, annual total tax on **Tax**, net cash flow on **Flow**. The **Table**
view adds the side-by-side summary matrix, with a tick on the better figure only
where better is unambiguous — retirement age and the year the money runs out are
left unmarked, because neither direction is good or bad on its own.

One mechanism for five views, no second renderer, and nothing changes a chart's
type. Two honest limitations, both stated on screen: the shaded range on
**Bands** is only ever the open profile (Monte Carlo is far too slow to run for
four), and profiles with different horizons share one axis — the axis is the
*union* of every pinned horizon, and a shorter line simply stops rather than
being padded to zero.

### Data safety

Profiles are the one thing here somebody would be upset to lose, so
`test-profiles.js` leans on that rather than on cosmetics:

- A stored profile **never shares a reference** with live state, asserted both
  directions.
- The live inputs record **which profile they came from**, and a write-back only
  happens when they match. Without that, merely opening the Manage panel wrote
  whatever was in the live state into whichever profile was marked active —
  destroying a saved plan silently, with no undo.
- Deleting the profile you are in **detaches** rather than adopting another one.
  That flag is persisted, because the "fall back to the first profile" rule would
  otherwise mark an unrelated profile as open while the live inputs still held
  the deleted one's figures, and the next sync would overwrite it.
- The profile you are editing **compares as what is on screen**, not as the
  snapshot it was saved from — otherwise pinning it drew it twice, once live and
  once stale, under one name.
- Names are unique case-insensitively; malformed JSON, entries without inputs and
  ids pointing at deleted profiles all degrade to something usable.

Profiles live under their own storage key, so a cleared UI state cannot take them
with it. Opening the panel re-reads storage, so a second tab's profiles are not
invisible.

## Themes

A button beside the chart tabs switches between **dark** and **light**, and it is
also in Settings › Mode. It persists, and it is treated as the person's choice
rather than a mode flavour — no mode definition touches it, and `applyMode`
re-applies the saved value, so switching between Planner and Arcade cannot
repaint the interface.

Every colour in the stylesheet reads from a custom property, which is what makes
a second theme a palette swap rather than a second stylesheet. A dozen surfaces
that had colours baked into their rules — status cells, table headers, field
backgrounds, the overlay scrim, the page background — were given role-named
variables first (`--surface-head`, `--field-bg`, `--scrim`) so a theme could move
them.

It is not a naive inversion: on a light background the cyan darkens considerably
to hold contrast, the amber darkens to stop it glowing, panel tints become warm
greys rather than translucent blues, decorative glows are toned down because they
read as smudges on white, and the operator bay stays metal — a light theme does
not make a machine bay white. The charts follow too, through a single
`themeInk()` source: pale grey axis labels are invisible on white, and Chart.js
bakes colours in at construction, so switching rebuilds the chart rather than
merely restyling it.

`test-layout.js` asserts that **every** colour variable the dark theme defines is
answered by the light one — an unanswered variable means one panel comes out dark
on white — and that no pale axis colour is hard-coded anywhere.

## Two front doors

The first thing the app asks is how you want to use it. Same engine either way —
same tax rules, same arithmetic, same forecast. The choice only decides how much
theatre comes with it, and it is switchable any time from **Settings › Mode**.

| | **Planner** | **Arcade** |
|---|---|---|
| Soundtrack and sounds | off | on |
| Your operator in the corner | hidden | animated, clickable |
| Wording | ordinary sentence case | uppercase HUD |
| Auto-optimise | on the toolbar | hidden behind a cheat code |
| Character creation | offered, not required | first stop |
| On opening | dashboard, with three pointers | build your operator, then confirm in Settings |

A mode writes nothing but presentation flags. It cannot touch a number in your
forecast — the toggles go through a separate lookup from the ones that feed the
engine, and there is a test asserting no mode definition so much as mentions an
input key. That boundary is what makes switching safe mid-session.

### Why this exists

Everything about the app assumed one kind of visitor. Someone opening it to plan
their own retirement met a combination lock, then compulsory character creation,
then a 128bpm soundtrack, then six tabs named things like "Bands", with the most
useful feature hidden behind a key sequence. Every one of those was a deliberate
choice and all of them were right for the arcade reading. None of them were
right for a planner, and the planner had no door.

## Live controls

Twenty-two of them, grouped into **Earning & spending**, **Contributions**,
**Retirement & withdrawals** and **Markets**. Every one recalculates the whole
forecast as you drag, with a ghost line showing where you were before.

Groups collapse and the open set is remembered. `1`–`9` jump to the first nine,
`[` and `]` walk the whole list, `↑ ↓` adjust the focused one. Focusing a control
inside a collapsed group opens that group first — otherwise pressing a number key
appears to do nothing.

**The contribution sliders stop at the statutory cap**, which moves with your age
as catch-up room opens up, and with your HSA coverage type. Fixed maxima gave the
401(k), Roth IRA and HSA sliders a dead top half: the default already sat at the
cap, so most of the track looked live and did nothing. `max` may be a function of
the inputs and the tax year for exactly this reason.

The table lives in `controls.js` rather than `app.js` so `test-controls.js` can
import it and pull every lever against the real engine — 157 assertions checking
that each key resolves, each range contains its default, a single step changes the
answer, both extremes produce a usable result, no slider has a dead zone, and all
twenty-two at once cannot break the simulation. An earlier version of that test
scraped the definitions out of `app.js` with regular expressions, which would have
read a function `max` as `NaN` and silently tested nothing.

## Text size

The first build set most of the interface between 9px and 10.5px, with
provenance badges at 8.5 and bay tags at 7. That reads as a dense instrument
panel and is simply too small — 9px body text is below what most people can read
comfortably at arm's length, and well below what anyone over about forty wants to
deal with. The settings page was the worst of it: 11px labels over 9.5px hints in
faint grey.

Every size now comes from one scale in `:root`, and **`--ui-scale` multiplies the
lot**. The baseline is already about 20–35% larger; **Settings › Mode › Text
size** goes further, with four steps shown at their own size rather than labelled
with words.

| | Normal | Large | Larger | Largest |
|---|---|---|---|---|
| Setting label | 15px | 17.3 | 19.5 | 22.5 |
| Setting hint | 12px | 13.8 | 15.6 | 18.0 |
| Field you type in | 13.5px | 15.5 | 17.6 | 20.3 |
| Table cell | 12px | 13.8 | 15.6 | 18.0 |
| Smallest chrome | 10px | 11.5 | 13.0 | 15.0 |

Settings rows also got real padding (13px, up from 8), hints are `--dim` rather
than `--faint` because faint *and* small is twice as hard to read, hints wrap at
52 characters, fields have an 8×10px hit area, and the page rail widened to 210px
so twelve page names fit without wrapping.

**The charts scale too.** Chart.js takes pixel sizes in JavaScript, not CSS, so it
has to be told separately or the axis labels stay at 11px while everything around
them grows. Its options are rebuilt per render for that reason, and the SVG
fallback reads the same `--ui-scale` custom property.

Text size is an accessibility setting, not a mode flavour: no mode definition
touches it, and `applyMode` re-applies the saved value, so switching between
Planner and Arcade can never quietly shrink the interface back. `test-layout.js`
asserts the scale is monotonic, that nothing resolves below 10px, that no raw
pixel font-size survives anywhere in the sheet, and that the charts go through
the multiplier.

## Finding your way around

- **Press `?`** (or `H`, or the `?` button beside the chart tabs) for help:
  getting started, what each of the six views actually shows, the keyboard map, a
  plain-English glossary — pre-tax vs Roth, effective rate, RMDs, sequence risk —
  and an honest page separating what the model gets right, what it simplifies and
  what is pure guesswork.
- **A line under the chart tabs** says what the current view is for, instead of
  leaving "Bands" to be guessed at.
- **Three pointers on first run**, dismissed for good once read, replayable from
  Settings › Mode.
- **The Monte Carlo cell** in the top strip used to sit at `—` reading "open Bands
  to run", with no way to act on it. It is now the button that runs it.

### The table scrolls itself

`flex: 1 1 auto; min-height: 0` only produces an inner scrollbar when an ancestor
has a bounded height. Making the page scroll on narrow windows removed that bound,
so the wrapper grew to the full height of forty rows: no inner scrollbar, a very
long page, and — because a sticky header sticks to its own scroll container —
column headings that scrolled away with everything else. It now has an explicit
`max-height`, `overscroll-behavior: contain` so the page does not take over at the
last row, and a frozen year column for scrolling sideways. The control panel got
the same treatment; twenty-two sliders in an unbounded column pushed the chart off
the first screen.

### The scroll chain, and why `min-height: 0` is load-bearing

Three bugs in a row came from one rule. A flex or grid item's automatic
minimum size in the block axis is its content, so an ancestor without
`min-height: 0` **cannot be shrunk**. `#app` is a fixed `100vh` with the body set
to `overflow: hidden`, so anything that overflows is clipped somewhere nothing
can scroll to reach it.

`.col` had `min-width: 0` but no `min-height: 0`. With six sliders nobody
noticed. With twenty-two, the bottom of the control panel *and* the bottom of the
chart beside it became unreachable — not scrolled off, clipped.

The rule is: **every ancestor between a scroll container and the fixed-height
shell needs `min-height: 0`.** `test-layout.js` asserts that chain —
`#hud → .main → .col → .pnl → .vp` — as a structural invariant, along with which
panels are scroll containers, that the table and control panel are bounded, and
that the chart keeps a readable floor in every layout. Removing `min-height` from
`.col` fails it immediately.

It also checks that **no selector is declared twice outside a media query**,
because a later duplicate silently overrides an earlier one. That is not
hypothetical: the first attempt at the chart fix added a second `.chartbox` rule
*above* the existing one, so it never took effect and looked correct in the diff.

Measured in a real browser across all six views, both layouts: no panel clips its
overflow, none collapses to zero height, and the chart gets 280px on a narrow
window and ~700px on a desktop. Before the fix the chart was 230px with the
controls taking 431px beside it.

### A starved requestAnimationFrame cannot blank the app

Recalculation is coalesced through `requestAnimationFrame` so dragging a slider
does not run the engine once per pixel. But rAF does not fire at all in a hidden
iframe or a background tab, and when that happened the app came up as an empty
shell — no simulation, no chart, no figures, nothing explaining why. The first
compute at boot is now synchronous, deferred work has a `setTimeout` fallback
behind the same latch, and a simulation that does throw says so in the chart panel
instead of leaving stale content in place.

### The inspector no longer disappears

The right-hand column decomposes a single year completely — every source of money
in, every destination out, the tax breakdown, conversions, RMDs, penalties and
warnings. It was `display: none` below 1100px, so on any laptop with a narrow
window the richest panel in the app silently vanished. It now moves below the
chart and the page scrolls.

### No gate, if you want

`auth.js` supports `mode: 'off'`, which opens straight to the app. Right for a
private copy on your own machine; wrong for anything published, where it means no
barrier at all. The default stays `'dial'`.

## Charts, and what happens when the library does not load

Charts use **Chart.js**, pinned and fetched from `cdn.jsdelivr.net` with an
integrity hash. Everything else — every number, every tax figure, the whole
simulation — is computed locally and needs no network.

If that one script does not load (offline, a blocked CDN, a corporate proxy, an
SRI mismatch), the app draws the charts itself with a built-in SVG renderer and
says so under the panel. The fallback is plainer — no tooltips, no animation,
and secondary-axis series are omitted rather than drawn against the wrong scale
— but the shape of the forecast, the axes, the legend and the retirement and
depletion markers are all there.

**To make it fully offline**, put the library in `vendor/` and rebuild:

```
curl -O https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js
mv chart.umd.js vendor/
node build.js          # inlines it and drops the CDN tag
```

### Why this exists

`new Chart` threw a `ReferenceError` when the script was missing, and because
every panel was rendered in one statement the throw took out the chart *and
everything after it*: the live controls, the year ticks, the inspector and the
character bay. One blocked script blanked most of the HUD, and the only visible
symptom was "no chart".

Two changes fix it, and both are pinned by tests:

- **Render steps are isolated.** `renderAll()` loops over named steps and wraps
  each one, reporting a failure once instead of every frame. A broken panel
  cannot take its neighbours with it.
- **The config is built once and handed to whichever renderer is available.**
  `svg-chart.js` consumes the *same* Chart.js config object, so there is no
  second copy of the per-view logic to drift out of step. It lives in its own
  file so it can be tested directly against a config from every view.

`test-svg-chart.js` covers stacked bars, stacked areas, dashed ghost lines,
transparent borders, negative values, a secondary axis, seven kinds of
degenerate input, and label escaping. `test-render.js` boots the whole app with
Chart.js deliberately absent and asserts every other panel still renders.

## Diagnostics

Settings → **Diagnostics** reports whether Chart.js loaded and from where, which
renderer is drawing, the chart area's measured size, whether any pixels were
actually painted, which render steps failed, and the state of the simulation and
audio. **Copy diagnostics** puts a plain-text report on the clipboard — or shows
it in a text box when the clipboard is blocked, which browsers do on `file://`.

If something looks wrong, that report is the thing to send.

## Auto-optimise — hidden behind a cheat code

The optimiser hands you the answer, and turning the dials yourself is the point
of the tool. So it is not on the screen. There is no button, no hint, and the
`O` key does nothing until it is unlocked. **Two ways in:**

```
  UP  RIGHT  DOWN  LEFT      (twice)
  M   A   X
```

Two full clockwise sweeps of a D-pad — echoing the ring lock on the way in —
then asking for the maximum. Or **click the operator in the top-right corner
seven times**, which is how people actually explore this kind of UI.

Amber diamonds appear beside the key hints from the first move, so a
half-entered code is visible rather than silent, and a pause of about three and
a half seconds resets it. Once accepted it persists, and `O` and the amber
button appear for good.

Notes on the keys: the first arrow press also nudges whatever control is
focused, which is expected — the detector only starts swallowing keys two moves
in, once the sequence is clearly deliberate. At that point it also takes focus
out of any field you were typing in, so the remaining arrows do not edit a
number on the way past.

**If you forget it:** Settings → Diagnostics → Auto-optimise → *Show me how*.
That is two clicks into a page a casual visitor has no reason to open, which is
hidden enough, and it means the person who owns the repo can always find their
own cheat code.

### Why it is wired to the capture phase

The keyboard handler returns early whenever focus is in an `input`, `select` or
`textarea` — sensible, so typing in a field does not trigger hotkeys. But
character creation now hands off to Settings, which is wall-to-wall number
fields. One click in a field and every keystroke was swallowed before the
detector saw it: the combination silently did not work, and nothing on screen
explained why. The detector now listens on `window` in the **capture phase**,
ahead of that guard. `test-sequence.js` enters the whole sequence with every
keystroke arriving as if from a focused number input, because testing only the
easy case passed while the feature was unusable.

Give it a target age and it searches the settings that are
genuinely your choice, then reports **what it changed and what each change was
individually worth** — measured by reverting that one move and re-running.

What it may **never** change: spending, salary, age, state, filing status, or
your balances. Those are facts, not choices. The constraint matters more than
the search: left free, "maximise net worth" answers *spend nothing and buy only
equities*. There is a test proving the constraint is load-bearing — starving
spending scores higher than the optimised plan, so it would be chosen if it
could be.

Two more guards, both deliberate:

- **Equity weight is bounded** and the winner must clear a Monte Carlo success
  floor. Raising equities lifts the average by fattening the bad tail; the
  search runs on fixed returns, so the winner is re-checked properly and the
  risk lever walked back if it fails.
- **The cash buffer is floored at 3 months.** Left free the optimiser drives it
  to 1, because the model sees the drag of idle cash and never sees a job loss.

A move worth nothing on its own is labelled **neutral** rather than listed as a
win, and on a genuinely unsalvageable plan it reports no gain instead of
manufacturing one.

## Character presets

Three choices — role, place, stage — fill in sixty inputs. Every value is badged
by provenance, and **the badge never fades**:

| Badge | Meaning |
|---|---|
| `measured` | Published for this occupation — BLS OEWS median wage. |
| `derived` | Inferred from age and income band. Nobody publishes balances by occupation. |
| `statute` | Fixed in law — state tax, SSA life tables. |

**The saver percentile is an explicit choice, not a hidden assumption.** Median
401(k) is roughly $40k at 35–44 and $68k at 45–54, and over half of US
households report no retirement savings at all. A genuinely median saver mostly
does not retire early, and the presets say so:

| Role | Median saver | Strong saver |
|---|---|---|
| Surgeon | runs dry at 88 | $53.1M |
| Software engineer | $490,009 | $30.3M |
| Registered nurse | $343,579 | $20.8M |
| Teacher | $2,926,058 | $16.8M |

The teacher beating the software engineer on median is the pension earning its
keep — which is why that preset exists.

**Presentation affects the avatar and one number: life expectancy** (SSA period
tables). It does not touch salary. Using sex-specific wage medians would bake a
population statistic into a personal forecast and hand women a worse default,
which is wrong at the individual level — pay tracks role, market and tenure.
There is a test asserting salary, balances, spending and contributions are
identical across presentations.

## Audio

Synthesised live from oscillators — squelch on open, servo clunk on commit, low
horn on a warning, double beep on confirm, plus an optional music bed whose
intensity follows plan health. Nothing is sampled, because a two-minute loop as
base64 would be several megabytes and this has to stay one file. **Off by
default**; `M` mutes from anywhere.
