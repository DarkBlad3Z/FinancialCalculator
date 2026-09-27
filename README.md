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
npm test                 # 336 engine assertions + 3 gate suites
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
node test-engine.js        # 133 assertions
```

---

## Files

| File | What it is |
|---|---|
| `tax-config.js` | **All tax data.** Brackets, deductions, contribution limits, phase-outs, RMD tables, state rates. The only file to edit for a new tax year. |
| `money.js` | Decimal-safe arithmetic. Every monetary value is an integer number of cents. |
| `tax-engine.js` | Pure tax functions: brackets, LTCG stacking, FICA, NIIT, Social Security taxability, phase-outs. |
| `engine.js` | The simulation. Year loop, cash sweep, tax lots, withdrawals, RMDs, real estate, Monte Carlo. |
| `app.js` | UI controller: bindings, charts, tables. |
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

Five concentric rings, each cut with one slot. Twelve numbered red markers on
the outer bezel. **Every ring has to point at one specific marker, and the
pairing is not shown** — you need the combination.

Ring numbers ride inside each slot; marker numbers sit on the bezel. A ring
turns blue once it is seated on *any* marker, and the hub counts how many are
seated. It deliberately does **not** tell you whether a ring is on the *right*
marker — that would leak the answer one ring at a time. Seat all five and it
either opens or says "that is not the combination."

**Click straight onto a ring, at the marker you want.** It snaps there. Five
clicks and you are in. Dragging fine-tunes; arrow keys work too (up/down picks
a ring, left/right turns it).

### Setting the combination

```
node set-combo.js              # random, prints it once
node set-combo.js 3 2 9 12 12  # one you choose
node set-combo.js --print      # show without writing
node build.js                  # refresh forecaster.html
```

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
| **12** | **5** | **248,832** | **~1.7 hours** |
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
