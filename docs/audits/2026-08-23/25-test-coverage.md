# A25 · Test & QA Coverage

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | vitest config (1) + 140 unit files + 38 e2e specs + 4 pw projects + 9 contract/invariant tests + eslint/tsc/CI config |
| Artifacts examined | all of the above |
| Coverage | 100% |
| Checks defined | 16 |
| Checks executed | 16 |
| Checks passed / failed / blocked | 6 / 10 / 0 |
| Findings C / H / M / L / I | 0 / 2 / 8 / 2 / 1 |
| Evidence commands run | ~34 (across prior-run artifacts under `a25/` + this assembly session) |
| Excluded as demo-scope | 4 (absence of i18n = Info-only per spec; OTP/SMS/email/payment mocks; in-memory ticket store — no vanishing-ticket demo break found in QA scope; `MOCK_NOW` frozen clock existing at all) |
| Blocked, with reason | none |

### Domain-specific metrics
| Coverage (deterministic — byte-identical across two `test:coverage` runs) | Value |
|---|---|
| Statements | **32.94%** (7005/21262) |
| Branches | 28.95% (6300/21758) |
| Functions | 27.49% (1661/6042) |
| Lines | 34.26% (6234/18196) |
| Configured threshold | **statements 23 only** — branch/function/line: none |

| E2E route coverage % (desktop / mobile-real-device) | Desktop | Mobile |
|---|---|---|
| Public (13) | 46.2% | 30.8% |
| Subscriber (19) | 94.7% | 73.7% |
| Agent (17) | 58.8% | 52.9% |
| Branch admin (10 desk / 12 mob) | 70.0% | **8.3%** (0% on real mobile projects) |
| Employer (12) | 66.7% | 8.3% |
| Distributor (9 panels / 14 mob routes) | 88.9% | 7.1% |
| Admin (15 panels / 22 mob routes) | 53.3% | **0.0%** |

| Unlinted `.ts`/`.tsx` files by directory | Count |
|---|---|
| `api/` | 48 |
| `e2e/` | 46 |
| `server/` | 5 |
| `playwright.config.ts` | 1 |
| **Total not linted** | **100** |
| Never type-checked (`--listFiles`) | 68 of 100 |

- **Untested modules ranked by risk (money/service paths):** `src/services/entities.js` 28.5%s (321 uncovered) · `src/services/nav.js` 7.4%s · `src/services/accessRequests.js`, `nomineeClaim.js`, `nomineeClaims.js`, `requestAccess.js`, `hooks/useAdminAttention.js` **0%** · `src/services/adminAttention.js` 5.5%s · `src/services/subscriber.js` 54.9%s (213 uncovered) · `src/services/commissions.js` 69.5%s · `src/hooks/useEntity.js` 57.8%s. Largest 0%-statement UI modules: `dashboard/map/UgandaMap.jsx` (264), `dashboard/commissions/CommissionPanel.jsx` (237), `dashboard/branch/ViewBranches.jsx` (246).
- **Genuinely flaky specs named:** `e2e/specs/regression/modal-escape.spec.ts:224` (chromium + webkit) — the *only* true flake in the whole suite.
- **Contract tests that prove TEXT not deployed behaviour:** `jwt-claim-contract`, `employer-split-contract`, `login-identity-contract`, `nav-pricing-contract` (4 files, 25 assertions).

---

## Assembly note (methodology + honesty)

This report assembles a prior-run investigation whose raw artifacts live under
`docs/audits/2026-08-23/a25/`. Per instruction I did **not** re-run the full ~24-minute Playwright
suite again this session (it would collide with any other running agent); the flake diff was already
complete from two full runs plus a targeted isolated rerun. I re-verified the load-bearing facts
live this session: coverage is byte-identical across both runs; the mobile projects run exactly 7 of
38 specs (`playwright.config.ts:123-134`); the §15-M1 CI guard exists and is push-main-gated; and the
current live state of test-authored rows.

**Fixture cleanup disclosure (G7 / cleanup rule).** My prior-run Playwright reruns *did* create
fixture rows in the live demo DB (e.g. branch `b-new-1787560217927` / "E2E Branch 1787560214725"
during the 2026-08-24 isolated rerun). Those have since been removed — their teardowns succeeded
when run without concurrent-agent collision, and none remain. I queried the live DB this session and
the only test-authored rows still present are **five subscribers and three branches dated 2026-08-02
and 2026-08-03** — all *predating* this 2026-08-23 audit. Those are the evidence for finding
**A25-004**, they are not mine, and I deliberately left them in place.

---

## Check 1 — Coverage (actual numbers, threshold adequacy)

`npm run test:coverage` was run twice; the two runs are **byte-identical**
(`grep "All files" coverage-raw.txt coverage-run2.txt` → same `32.94 | 28.95 | 27.49 | 34.26`), so
coverage measurement is deterministic. Overall **32.94% statements / 28.95% branches / 27.49%
functions / 34.26% lines** over 21,262 statements.

The gate is defined in `vite.config.js`'s `test.coverage.thresholds` block and is **statements: 23,
and nothing else**. There is no `vitest.config.*`. Two problems fall out:

1. The floor (23) sits **9.94 points below** the measured statement coverage. A PR can *delete*
   tests until statement coverage drops to 23% and the gate still passes — the gate ratchets nothing.
2. Branches, functions and lines have **no threshold at all**. Branch coverage is already the
   weakest metric (28.95%) and is completely ungated. → **Finding A25-012.**

Per-directory the six role dashboards are the coverage floor: `src/dashboard` 10.0%s (3,193
uncovered), `src/agent-dashboard` 9.0%s, `src/branch-dashboard` 10.7%s, `src/employer-dashboard`
17.5%s. The **money/service layer** is the risk concentration: `services/entities.js` 28.5%s (321
uncovered statements — the single largest untested service), `services/nav.js` 7.4%s (the NAV
pricing client), and six service/hook modules at literal **0%**
(`accessRequests.js`, `nomineeClaim.js`, `nomineeClaims.js`, `requestAccess.js`, `adminAttention.js`
5.5%, `hooks/useAdminAttention.js`).

---

## Check 2 — E2E route coverage matrix (the deliverable)

Full per-route table in `a25/route-matrix.md`. Headline gaps, expressed as % of each role's routes
that have **at least one** covering spec at that viewport:

- **Admin mobile: 0/22 = 0%.** The entire `AdminMobileShell` route tree — including
  `nav` (NAV publishing), `nominee-claims`, `access-requests` — has zero E2E coverage on any mobile
  project. The **NAV publishing panel has zero E2E coverage at any viewport**: the only guard on the
  surface that sets every subscriber's unit price is a migration-*text* contract test (see Check 5).
- **Branch admin mobile: effectively 0/12.** The route-matrix's single "hit" is a
  `test.use({viewport})` override *inside the chromium project*; on the two real mobile device
  projects branch admin is 0%.
- **Distributor mobile 1/14 = 7.1%; employer mobile 1/12 = 8.3%.**
- **Agent:** the five home-tile KPI drill-downs a rep clicks first
  (`onboarded-this-month`, `yet-to-contribute`, `insured`, `uninsured`, `contributions`) are
  **uncovered at every viewport**.
- **Subscriber `policies` route: zero coverage at any viewport.**

The desktop side is far healthier (subscriber 94.7%, distributor panels 88.9%). The blind spot is
almost entirely **mobile**. → contributes to **Finding A25-002**.

---

## Check 3 — Lint & type gaps (four separate findings)

Detail in `a25/lint-type-gaps.md`.

- **A25-006 — `api/`/`server/`/`e2e/` TypeScript is not linted at all.** `eslint.config.js`'s two
  rule blocks glob `src/**/*.jsx` and `**/*.{js,jsx}`; no block matches `.ts`/`.tsx`. Measured:
  `npx eslint .` lints 684 files, **0** of them `.ts`. 100 TypeScript files (48 api + 46 e2e + 5
  server + `playwright.config.ts`) get no `no-unused-vars`, `no-console`, or `react-hooks` linting.
- **A25-007 — no `typecheck` script; `tsc` covers 32 of 100 `.ts`.** The only `tsc` is inside
  `build:api` (`tsc -p server/tsconfig.json`), which *excludes* `*.test.ts`. `--listFiles` walks 32
  files (27 api + 5 server); 68 are never type-checked (21 `api/*.test.ts` + 46 `e2e/**` +
  `playwright.config.ts`). There is no root `tsconfig.json`, so `src/` is never checked even with
  `checkJs`.
- **A25-008 — no stylelint, no import-boundary rule, no pre-commit hooks.** 229 `.module.css`
  files ship with no linter and no design-token contract; nothing prevents cross-role imports among
  the six per-role trees; `.git/hooks/` holds only samples.
- **A25-009 — every `jsx-a11y` rule is forced to `warn`, and `lint` has no `--max-warnings`.** The
  config builds `jsxA11yWarnRules` by mapping all 34 recommended rules to `'warn'`; `"lint":
  "eslint ."` has no ceiling. 311 of 323 warnings are a11y and `npm run lint` still exits 0 — the
  backlog is unbounded, a PR can add 50 more a11y warnings and stay green.

---

## Check 4 — Flake / determinism (MOST IMPORTANT: CONFIRMED deterministic)

Full diff in `a25/flake-diff.txt`; baseline in `baseline/playwright-full.txt`
(326 passed / 30 failed / 14 skipped, exit 1).

**The baseline's 30 failures are a DETERMINISTIC defect cluster, not flake.** Two full runs plus a
targeted isolated rerun establish it:

- **28 of 30 reproduced identically** across both full runs → real defects. Breakdown:
  `smoke/subscriber-dashboard.spec.ts` 12 (both mobile engines), `smoke/landing.spec.ts` 6 (both
  mobile engines), `flows/distributor-exports-csv.spec.ts` 4 (both mobile engines),
  `flows/agent-onboard-subscriber.spec.ts:109` 2 (chromium + webkit), `regression/map-drill.spec.ts:250`
  2 (webkit), plus webkit-only `subscriber-signin-with-password:78` and
  `subscriber-signup-to-contribute:116`.
- **The "prime flake candidates" hypothesis is REFUTED.** The spec named the 4 webkit-only failures
  (`subscriber-signin:78`, `subscriber-signup:116`, `map-drill:250` ×2) as the likely flakes. All 4
  **reproduced** on re-run → they are **real WebKit-specific defects**, not flake. Hand to A16/A18.
- **Only 2 cases are genuinely flaky:** `regression/modal-escape.spec.ts:224` (chromium + webkit) —
  failed in baseline, passed on re-run. This is the sole true flake in the suite; name it.
- **The 19 "rerun-only" failures are NOT flake — they are collision artifacts.** They appeared only
  in the second full run because A22/A24 were driving the same dev server concurrently
  (`subscriber-write-failures.spec.ts` is A22's *own* fault-injection spec). A targeted **isolated**
  rerun (`a25/pw-rerun3-targeted.txt`, chromium, single worker, no concurrent agent) shows **all of
  them pass** — every db spec, `agent-dashboard-drill`, `branch-dashboard-drill`,
  `distributor-apply-settlement`, `distributor-create-branch`, `distributor-renders-data` green. The
  second full run was not a clean isolation and its extra failures must be discounted.

**Routing:** the 28 reproduced failures are a real product-defect cluster on mobile viewports and
WebKit → route to **A10 / A16 / A18 / A19** for root-cause. As a QA finding (**A25-001**) the point
is that the committed baseline **ships red** (exit 1) with 30 deterministic failures.

---

## Check 5 — Contract-test false confidence

Detail in `a25/contract-tests.md`. Four "contract" tests (`jwt-claim`, `employer-split`,
`login-identity`, `nav-pricing`) **grep migration file TEXT and never open a DB connection** — the
only occurrence of `supabase` in all four is a filesystem path (`MIGRATIONS_DIR`). They pass with the
database paused, restored to a different snapshot, or pointed at another project. Every one of their
25 assertions "would still pass if the database were wrong," because the database is not an input.

Proof B (`a25/proof-text-vs-live.mjs`): their own `latestDefinitionOf()` resolver, fed the 19
function names A00 proved exist in migration text but have **zero OIDs live**, "resolves" a full
newest-definition for **19/19 phantom functions**. Had `0029` dropped
`submit_employer_contribution_run` instead of the `0021` family, the employer-split contract test
would still be green — asserting the rules of a function nobody can call. The same script re-ran all
25 assertions against live `pg_get_functiondef()` bodies: **25/25 agree today** — so the guards are
not lying *now*, but they have no mechanism to notice if they started to, which is exactly the
`0095`-silently-un-ships-`0090` failure mode their own headers describe. → **Finding A25-003.**
Remedy: a ~40-line behavioural twin under `e2e/specs/db/` that runs the identical regex battery
against `pg_get_functiondef` and asserts `count(oid)=1` per name; it inherits the §15-M1 guard.

Minor: `jwt-claim-contract.test.js:45` filters `.sql` (includes `.down.sql`) while its three
siblings filter `!f.endsWith('.down.sql')` — the "sibling" tests do not share a corpus.

---

## Check 6 — Missing money-engine invariant tests (proposals only)

Detail in `a25/money-invariants.md`. The entire money-invariant surface is **10 assertions**
(`invariants.spec.ts` 8 — only 2 about money; `money-idempotency.spec.ts` 2) over a 29,027-row
ledger, 5,060 balance rows, 1,246 NAV snapshots. I probed nine candidate invariants live; **two are
violated right now and nothing in the repo would notice either:**

- **M1 — 4 subscribers have no balance row** (`subscribers` 5064 vs `subscriber_balances` 5060). NB:
  this is *not* an orphan invariant leak — Check 7 proves it is the E2E suite's own leaked fixtures.
- **M2 — `s-0005` bucket units reconcile off by 6.36 units** (`units` 203.99 vs
  `retirement_units + emergency_units` 210.35), ≈10,000 UGX of disagreement between two numbers on
  the same subscriber screen. `_resync_bucket_units()` exists to keep them in step; nothing asserts
  the outcome.

Proposed tests M1–M12 (ownership of the *data* defects is A04/A06; the A25 finding is the
**unguarded class**). M1, M2, M8 (`apply_settlement` idempotency — the only asymmetry in idempotency
coverage), and M12 (function-deployment contract, the behavioural twin from Check 5) are the four
worth writing first. → **Finding A25-005.**

---

## Check 7 — Mobile projects run 7 of 38 specs

Confirmed live from `playwright.config.ts:123-134` / `:142-154`: `mobile-chromium` and
`mobile-webkit` each set `testMatch` to exactly **7** specs (`smoke/landing`,
`smoke/subscriber-dashboard`, `smoke/agent-dashboard`, `smoke/_health`, `flows/distributor-exports-csv`,
`regression/subscriber-payment-methods`, `regression/employer-kyc-nudge`) out of 38.
`find e2e/specs -name '*.spec.ts' | wc -l` → 38.

**The irony:** the two mobile projects run the **fewest** specs (7/38) yet produced **22 of the 30**
baseline failures. Mobile is simultaneously the least-tested surface *and* the most-broken one. →
**Finding A25-002.**

---

## Check 8 — CI §15-M1 guard (works, but withheld from PRs)

Detail in `a25/ci-guard.md`. The guard (`.github/workflows/test.yml:148-173`) re-runs `e2e/specs/db`
with `--reporter=json` and fails on `stats.expected < 1`. All four db specs gate on a describe-level
`test.skip(!hasEnv,…)`, which Playwright reports as `skipped`, never `expected` — so a wholly-skipped
db suite trips `expected===0` and exits 1. The guard's core logic is **correct** — it does catch
all-skipped db specs. **PASS** on the literal check.

But the guard runs `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` — **only on
push to main**, while the PR job *deliberately includes* `e2e/specs/db` to catch regressions before
merge (§15-H1). A fork PR, or one run while a secret is rotating/unset, silently loses every
cross-tenant RLS and money-idempotency guard and still shows a green check. → **Finding A25-011**
(remedy: `if: always()`, and tighten `expected < 1` to `expected < 13` so a *partially* skipped
suite is caught too).

---

## Findings

### A25-001 · HIGH · confirmed — Baseline Playwright suite ships RED with 30 deterministic failures
The committed baseline exits 1 with 30 failures; 28 reproduce identically across two full runs → a
real defect cluster, not flake. Concentrated on mobile viewports (subscriber-dashboard 12, landing 6,
distributor-CSV 4 — all on *both* mobile engines) and WebKit (agent-onboard, map-drill, signin,
signup). A rep demoing the subscriber dashboard or landing on a phone hits these exact routes.
Root-cause ownership: A10/A16/A18/A19.
- **Evidence:** `a25/flake-diff.txt` ("REPRODUCED in both runs → deterministic defect (28)");
  `baseline/playwright-full.txt` (326 passed / 30 failed / 14 skipped, exit 1);
  `a25/baseline-failures.txt` (verbatim failure list).
- **Fix:** treat as product defects (hand to A10/A16/A18/A19); do not quarantine as flaky. The suite
  should be green before it is a merge gate.

### A25-002 · MEDIUM · confirmed — Mobile E2E coverage is 0–8% for 4 of 6 roles, where the product actually breaks
Mobile projects execute 7/38 specs. Real-device mobile route coverage: admin 0/22, branch 0/12,
distributor 1/14, employer 1/12. Yet mobile produced 22 of 30 baseline failures. The least-tested
surface is the most-broken one.
- **Evidence:** `playwright.config.ts:123-134,:142-154` (7-spec testMatch); `a25/route-matrix.md`
  (per-role %); `a25/flake-diff.txt` per-spec rollup (22 mobile failures).
- **Fix:** add the six role dashboards' primary routes to the mobile `testMatch`; at minimum cover
  admin NAV-publish, subscriber dashboard sub-routes, and each role's home landing on one mobile
  engine.

### A25-003 · MEDIUM · confirmed — Four "contract" tests prove migration TEXT, not deployed behaviour
`jwt-claim`, `employer-split`, `login-identity`, `nav-pricing` grep `supabase/migrations/*.sql` and
never connect to the DB; all 25 assertions pass with the database wrong/paused/swapped. Their own
resolver "resolves" 19 functions that have zero OIDs live. They cannot catch the exact regression
class (`0095` un-ships `0090` via un-applied `CREATE OR REPLACE`) their headers cite.
- **Evidence:** `a25/contract-tests.md`; `grep -n "supabase\|createClient\|psql\|fetch(" src/test/*contract*.test.js`
  → only `MIGRATIONS_DIR` paths; `node a25/proof-text-vs-live.mjs` → 19/19 phantom functions resolve.
- **Fix:** add one behavioural twin spec under `e2e/specs/db/` running the same regex battery against
  `pg_get_functiondef` + asserting `count(oid)=1`; keep the text greps as a pre-merge lint.

### A25-004 · HIGH · confirmed — E2E teardown leaks fixture rows into the LIVE demo DB (incl. "E2E Branch" under d-001)
19 fire-and-forget teardown deletes across 8 spec files; none checks the returned `error`. Result in
the live demo DB: 5 leaked `subscribers`, 3 leaked `branches` — two named `E2E Branch 1785700415857`
/ `E2E Branch 1785753020590` attached to **d-001**, the primary demo distributor a rep signs in as.
This is also the source of the 4-row `subscribers`-vs-`subscriber_balances` gap (M1). A rep browsing
d-001's branches sees fabricated "E2E Branch" rows during a live demo.
- **Evidence:** `a25/fixture-leak.md`; live this session —
  `SELECT id,name,distributor_id,created_at FROM branches WHERE id LIKE 'b-new-%' OR name ~* '^(E2E|TST)'`
  → `b-new-1785700420016|E2E Branch 1785700415857|d-001|2026-08-02`, `b-new-1785753024670|…|d-001|2026-08-03`,
  `tst-branch-msc7w8vm|TST throwaway branch`; `SELECT … FROM subscribers WHERE id ~* '^(tst-|s-e2e…)'` → 5 rows
  (all dated 2026-08-02/03, predating this audit).
- **Fix:** (1) `expect(error).toBeNull()` on every teardown delete; (2) a `globalTeardown` sweep of
  `id LIKE 'tst-%' OR name ~* '^(TST|E2E)'` that *fails* the run if it deleted anything;
  (3) a returns-to-baseline `count(*)` assertion in `globalSetup`/`globalTeardown`. Separately, the 8
  existing leaked rows should be manually purged from the demo DB (they are the finding evidence; I
  left them in place per report-only scope).

### A25-005 · MEDIUM · confirmed — The money engine's live invariants are essentially unguarded (2 violated now)
10 total money-adjacent E2E assertions over a 29k-row ledger. Two invariants are violated live and no
test would notice: M1 (4 subscribers with no balance row) and M2 (`s-0005` bucket units 6.36 short of
the sum of its buckets, ≈10,000 UGX). Data ownership is A04/A06; the QA finding is the unguarded
class. Proposed M1–M12; write M1/M2/M8/M12 first.
- **Evidence:** `a25/money-invariants.md`; live `psql` UNION probe → `units_total_mismatch|1`,
  `subscribers_without_balance|4`; drill → `s-0005 … delta -6.3637520682194222 … nav 2026-08-24`.
- **Fix:** add the M1/M2/M8/M12 behavioural specs under `e2e/specs/db/` (they inherit the §15-M1
  guard).

### A25-006 · MEDIUM · confirmed — api/, server/, e2e/ TypeScript (100 files) is not linted at all
`eslint.config.js` globs only `src/**/*.jsx` and `**/*.{js,jsx}`; ESLint 9 flat config lints 0 `.ts`.
`no-unused-vars`, `no-console`, `react-hooks/*` never run over the backend or the test harness.
- **Evidence:** `a25/lint-type-gaps.md`; `npx eslint . --format json | …` → `by ext:{cjs:3,mjs:68,js:180,jsx:433}` (zero ts); unlinted table 48 api + 46 e2e + 5 server + 1 config = 100.
- **Fix:** add a flat-config block for `api/**/*.ts`, `server/**/*.ts`, `e2e/**/*.ts`, `*.config.ts`
  using `tseslint.parser` + `tseslint.configs.recommended`, `no-console: 'off'` for server.

### A25-007 · MEDIUM · confirmed — No typecheck script; tsc checks 32 of 100 .ts, skips all tests + e2e
The only `tsc` is inside `build:api`, which excludes `*.test.ts`; `--listFiles` walks 32 files. 68
never type-checked (21 api tests + 46 e2e + `playwright.config.ts`). No root `tsconfig.json`, so
`src/` is never checked.
- **Evidence:** `a25/lint-type-gaps.md`; `server/tsconfig.json` exclude block; `ls tsconfig*` → none.
- **Fix:** add `e2e/tsconfig.json`, a `"typecheck"` script (`tsc -p server … --noEmit && tsc -p e2e … --noEmit`),
  drop the `*.test.ts` excludes under `--noEmit`, run it in the `lint-and-unit` CI job.

### A25-008 · LOW · confirmed — No stylelint, no import-boundary rule, no pre-commit hooks
229 `.module.css` ship unlinted (no `var(--…)` token contract); nothing blocks cross-role imports
among the six per-role trees; `.git/hooks/` holds only samples.
- **Evidence:** `a25/lint-type-gaps.md`; `ls -a | grep -iE "stylelint|prettier|husky|lint-staged"` → nothing; `ls .git/hooks | grep -v sample` → nothing.
- **Fix:** stylelint + `declaration-property-value-allowed-list` for color/background → `var(--…)`;
  `import/no-restricted-paths` zones forbidding cross-role imports; husky + lint-staged, shipped as
  `--max-warnings` ratchets (backlog must burn down before they can block).

### A25-009 · MEDIUM · confirmed — All jsx-a11y rules forced to 'warn'; lint has no --max-warnings ceiling
`jsxA11yWarnRules` maps all 34 recommended rules to `'warn'`; `"lint": "eslint ."` has no ceiling. 311
of 323 warnings are a11y and the build stays green; the backlog is unbounded — a PR can add more a11y
regressions and CI passes.
- **Evidence:** `a25/lint-type-gaps.md`; `eslint.config.js` `Object.fromEntries(...map(rule => [rule,'warn']))`; A00 histogram 323 warnings / 311 jsx-a11y.
- **Fix:** `"lint": "eslint . --max-warnings=323"` (ratchet), then promote the 25 recommended a11y
  rules with zero current violations to `'error'`, leaving only the 9 with hits at `'warn'`.

### A25-010 · LOW · confirmed — ESLint lints 66 untracked/.gitignored files; no-unused-vars is 'error'
Flat config does not read `.gitignore`; `globalIgnores` omits `docs/**` and `.understand-anything/**`
(the latter literally on `.gitignore:74`). `eslint .` lints 63 `docs/**` + 3 `.understand-anything/**`
files that are not part of the project; with `no-unused-vars: 'error'`, a stray scratch `.mjs` with an
unused var fails `npm run lint` — the gate's result depends on non-project files.
- **Evidence:** `a25/lint-type-gaps.md`; `by top dir:{docs:63,.understand-anything:3,…}`.
- **Fix:** `globalIgnores(['docs/**','.understand-anything/**'])` or
  `includeIgnoreFile('.gitignore')` from `@eslint/compat`.

### A25-011 · MEDIUM · confirmed — §15-M1 executed-not-skipped guard runs only on push-to-main, not on PRs
The PR job deliberately includes `e2e/specs/db` (to catch RLS/money regressions before merge, §15-H1)
but the guard that proves those specs actually *ran* is gated to `push` on `main`. A fork PR or a
rotating secret silently skips every cross-tenant + idempotency guard and still shows green.
- **Evidence:** `a25/ci-guard.md`; `.github/workflows/test.yml:148` guard condition
  `github.event_name == 'push' && github.ref == 'refs/heads/main'` vs the PR step that includes `e2e/specs/db`.
- **Fix:** change the guard to `if: always()`; tighten `expected < 1` to `expected < 13` so a
  partially-skipped suite is also caught.

### A25-012 · MEDIUM · confirmed — Coverage gate is statements-only at 23%, 10 points below actual, branch/fn/line ungated
`vite.config.js` sets `thresholds: { statements: 23 }` and nothing else. Measured 32.94%s, so tests
can be deleted down to 23% and still pass; branch (28.95%), function (27.49%) and line coverage have
no floor at all.
- **Evidence:** `a25/coverage-agg.txt` "threshold check" (configured statements 23; headroom 9.94;
  branches/functions/lines: NO THRESHOLD); byte-identical across `coverage-raw.txt` / `coverage-run2.txt`.
- **Fix:** raise statements to the current floor (e.g. 32) and add branch/function/line thresholds at
  measured − 1, so all four metrics ratchet.

### A25-013 · INFO · confirmed — Exactly one genuinely flaky spec in the suite
`regression/modal-escape.spec.ts:224` (chromium + webkit) failed in baseline and passed on re-run —
the only true non-determinism. Naming it prevents it being lumped with the 28 real defects. The
webkit-only "prime flake candidates" the plan predicted (`subscriber-signin:78`, `signup:116`,
`map-drill:250` ×2) all reproduced and are real defects, not flake.
- **Evidence:** `a25/flake-diff.txt` "BASELINE ONLY (passed on re-run) → flaky (2)".

---

## Traceability
| Check | Description | Disposition |
|---|---|---|
| 1 | `test:coverage` actual % overall + per dir; rank untested modules; judge the 23%-statements-only threshold | FINDING A25-012 (coverage measured 32.94/28.95/27.49/34.26; threshold theater) |
| 2 | E2E route coverage matrix per role × viewport; % per role; zero-coverage routes | FINDING A25-002 (deliverable `a25/route-matrix.md`; admin mobile 0%, NAV panel 0%, subscriber `policies` 0%) |
| 3a | api/server/e2e `.ts` not linted | FINDING A25-006 |
| 3b | no typecheck script; tsc excludes `*.test.ts` | FINDING A25-007 |
| 3c | no stylelint / import-boundary / pre-commit | FINDING A25-008 |
| 3d | jsx-a11y forced to warn; no `--max-warnings` | FINDING A25-009 (+ A25-010 eslint scope leak) |
| 4 | Flake/determinism: reproduce vs baseline, classify real vs flaky | FINDING A25-001 (28/30 reproduced = deterministic) + A25-013 (1 true flake named) |
| 5 | Contract tests: which prove text not behaviour | FINDING A25-003 (4 tests, 25 assertions grep text) |
| 6 | Propose missing money invariant tests | FINDING A25-005 (M1–M12; M1/M2 violated live) |
| 7 | Mobile projects run only 7/38; note the 22/30 irony | FINDING A25-002 (confirmed `playwright.config.ts`) |
| 8 | CI §15-M1 guard catches all-skipped db specs | PASS (guard logic correct) + FINDING A25-011 (withheld from PRs) |
| Extra | Live fixture-leak discovered while probing M1 (not in spec checklist) | FINDING A25-004 |

**Checks passed (6):** measurement/deliverable checks that executed cleanly — coverage measurement
(1), untested-module ranking (part of 1), route-matrix deliverable (2), flake classification
executed & confirmed (4), money-invariant proposals produced (6), CI guard core-logic verified
correct (8). **Checks failed (10):** every check that surfaced a defect finding
(threshold, mobile coverage, 4 lint/type gaps, the red baseline, contract false-confidence, the
7/38 mobile gap, the PR guard gap). **Blocked: 0.**
