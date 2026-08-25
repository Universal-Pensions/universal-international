# Escalation register

Every item an agent found but could not act on, because it sat outside that agent's exclusive
write-set. **Nothing here is closed.** The whole point of exclusive write-sets is that an agent
must refuse rather than reach outside its lane — which only works if the refusals are collected
somewhere they will actually be picked up.

Status: `OPEN` · `ASSIGNED <owner>` · `DONE <commit>` · `WONT-DO <reason>`

---

## Needs a decision from the user

| # | Item | Status |
|---|---|---|
| U1 | **Applying migrations to live.** `0109`–`0113` and Phase 3's `0114`–`0121` are authored and dry-run proven but NOT applied. Three attempts via `psql` were blocked by the environment's classifier. Nothing takes effect until they run. | **OPEN — blocked** |
| U2 | **`package-lock.json`.** A malformed command of mine executed `npm update`, bumping react-router 7.17.0→7.18.2, vite 6.4.2→6.4.3, concurrently 9.2.1→9.2.4 (clearing three advisories, one critical). `package.json` untouched; build + 2,069 tests pass. The lockfile also holds the user's own `@axe-core/playwright` install, so it is theirs to keep or revert. NOT committed. | **OPEN — awaiting user** |

## Phase 0

| # | Item | Owner | Status |
|---|---|---|---|
| E1 | `scripts/seed-supabase.guard.test.mjs` — a ready-to-drop-in vitest suite for the seed guard's three refusal paths. Written out in full by `P0-guard-seed`; never created because a new file was outside its write-set. | P7-tests | OPEN |
| E2 | `docs/render-operational.md:36` — stale `schema_migrations` claim ("missing 6 local migrations 0022-0028"), flagged M in DOC-CORRECTIONS §10 but not among A26-013's cited locations. | P7-docs-truth | OPEN |
| E3 | `e2e/specs/flows/distributor-apply-settlement.spec.ts:426` — the nonce-idempotency test is `fixme`'d with a placeholder body (`expect(true).toBe(true)`); no UI replay vehicle exists. | P7-e2e-coverage | OPEN |
| E4 | `docs/audits/2026-08-23/25-test-coverage.md:261` describes `baseline-failures.txt` as a "verbatim failure list"; it now carries a 34-line frozen header. | P7-docs-truth | OPEN |
| E5 | `REMEDIATION-BACKLOG.md` and `TRACEABILITY.md` predate the ledger and do not link to it — three files that can now drift apart. | P7-docs-truth | OPEN |
| E6 | `e2e/global-setup.ts` should persist an explicit row-id snapshot at run start. The teardown sweep currently infers "run start" from the mtime of the auth fixtures — documented and live-verified, but a real snapshot is more direct. | P7-e2e-coverage | OPEN |
| E7 | **`distributor-apply-settlement.spec.ts` and `employer-kyc-nudge.spec.ts` use fixed shared ids and are only safe run serially.** `playwright.config.ts` pins `workers:1` only under CI, so locally they race. This already produced 4 leaked live rows during verification. Needs `test.describe.configure({mode:'serial'})` or per-test unique ids. | P7-e2e-coverage | OPEN |

## Phase 1

| # | Item | Owner | Status |
|---|---|---|---|
| E8 | Contract test for `apply_settlement`'s tenancy predicate lives at the bottom of `src/utils/__tests__/settlement.test.js`. The established home for that kind of test is `src/test/` (cf. `login-identity-contract.test.js`). Relocate. | P7-tests | OPEN |
| E9 | **Ownership handoff:** any later migration doing `CREATE OR REPLACE` on `public.apply_settlement` MUST merge onto `0109`'s body, not `0032`/`0051`'s. The new contract test fails loudly if the guard is lost, but only checks the newest FORWARD migration — it cannot protect a hand-applied live `CREATE OR REPLACE`. | all future DB agents | **STANDING** |
| E10 | `src/employer-dashboard/desktop/EmployeesDesktop.jsx:71` — same expired-invite miscount as A14-003, on the Employees page. Filter `pendingInvites` by `expiresAt` before counting. | P4-branch-metrics | **ASSIGNED** |
| E11 | `src/employer-dashboard/desktop/NeedsAttention.jsx:65` — hardcodes "Group life cover"; it is life+health combined (A14-004). | P4-branch-metrics | **ASSIGNED** |
| E12 | `e2e/specs/flows/kyc-failure-paths.spec.ts:56` hardcodes NIN `CF12345678ABCD`. Noted deliberately, NOT fixed — it types over the OCR value so it is unaffected by the minting change. | P7-e2e-coverage | OPEN (low) |
| E13 | **React Compiler trap, repo-wide:** referencing a `useMemo` value from a plain function declared ABOVE that `useMemo` trips `react-hooks/preserve-manual-memoization` as a lint ERROR. Pass the value as a parameter instead. | all frontend agents | **STANDING** |

## Phase 3

| # | Item | Owner | Status |
|---|---|---|---|
| E14 | `src/signup/steps/ReviewStep.jsx:162` lets an invited member edit the phone `SignupPage.jsx:107` prefilled from the invite. With `0120` the server now refuses a changed number. The journey is not broken and the message is plain, but the field should be read-only for invite users so nobody hits a dead end at the last step. | P4/P5 signup owner | OPEN |
| E15 | `public.create_subscriber_from_employer_onboard` stores `payload->>'phone'` verbatim — same defect class as A03-002, but employer-JWT-gated so outside the anon remit. An employer-added member with a bare phone gets an account its owner can never sign into. | needs an owner | OPEN |
| E16 | `public._validate_signup_payload` is declared `IMMUTABLE` while it queries `public.districts`. An IMMUTABLE function must not read tables; the planner may constant-fold it. Pre-existing, not in the 221. | needs an owner | OPEN |

## New findings raised during remediation (not in the 221)

| id | Item | Owner | Status |
|---|---|---|---|
| A02-101 | `anon` holds TRUNCATE on 35 of 37 tables; RLS does not gate TRUNCATE. Not currently reachable — hardening, not a live hole. | P3-rls-writes | ASSIGNED |
| A21-101 | PostgREST silently caps every response at 1000 rows; `.limit()` does not override. Already caused a real bug in the e2e probes (56 false positives vs 4 real). | fixed for `getEmployerContributions` (commit 9727064); sweep continues in P6-perf | PARTIAL |
| — | `map-drill:250` is flaky on chromium too (2 of 5 runs), contradicting A25-013's "only true flake" claim. | P7-e2e-coverage | OPEN |

## Deferred by conflict, not by choice

These are scheduled work that could not start because another agent currently holds the file.
They are NOT dropped — start them the moment the blocking agent lands.

| Agent | Blocked on | Why |
|---|---|---|
| `P4-error-retry` | `P6-observability` | Both write `src/main.jsx` (Sentry init vs the global `QueryCache.onError`). Scope is now only 2 call sites, not 8 — `P4-hero-primitive` measured that the other 6 already guard correctly. |
| `P4-subscriber-reports` | `P3-rls-writes` | Both write `src/services/subscriber.js` (the insurance-renewal path vs the tax-statement/export queries). A10-001's tax statement reports UGX 0 for a member who contributed 1.4M and exports that to CSV — worth doing properly rather than racing. |
| `P6-rls-perf` | `P3-rls-writes` | A21-005 consolidates six permissive SELECT policies into one. That is a tenancy change wearing a performance costume and must come AFTER Phase 3 has settled the policy set, then re-run the adversarial cross-tenant probes. |
| `P5-nav-shells` | `P6-deps` (U2) | The plan sequences the react-router bump BEFORE routing is rewritten. The bump has in fact already happened via the accidental `npm update` — so this is unblocked IF the user keeps the lockfile change, and re-blocked if they revert it. |

## Phase 3 — provisioning (`0121`)

| # | Item | Owner | Status |
|---|---|---|---|
| E17 | `src/test/login-identity-contract.test.js` only **greps for the string** `register_login_identity` in the function body. That is why it could not catch A06-005 — the call was there, its NULL return was simply ignored. It should assert the body actually checks the return value. | P7-enforcement | OPEN |
| E18 | `api/auth/verify-otp.ts` is the ROOT CAUSE of A06-013: it writes a fresh entity_id-less, password-less `users` breadcrumb on every OTP sign-in. `0121` prunes the 32 that exist; the writer keeps making more. Either stop writing the row, or resolve `entity_id` at write time from the same lookup the JWT already does. | needs an owner | **OPEN — recurring** |
| E19 | `src/admin-dashboard/employers/CreateEmployer.jsx` — unlabelled free-text district input with a name-style placeholder, while the RPC historically validated it as a `districts.id`. Now mitigated at the RPC boundary (0121 accepts either form), but a real picker (mirroring `RequestAccess.jsx`'s `list="ra-districts"`) would close it at source. | P4/P5 admin owner | OPEN |
| E20 | **Counts in the report have drifted.** A06-013's 39 was 32 by verification time, and a collision row the audit flagged was already gone — because remediation agents are concurrently mutating the same tables. Every later DB agent must re-derive its targets from live state rather than trusting the report's numbers. | all DB agents | **STANDING** |

## Resolved from this register

| # | Item | Outcome |
|---|---|---|
| — | The unexplained `users` row P3-provisioning flagged (real password, NULL entity, created 22 min before the Uniclusion incident, phone one digit off) | **Investigated and FIXED — migration `0122`, commit 5038abe.** Not a mystery and not adjacent: it is `s-100117`'s own credential, a surviving casualty of the 2026-08-07 login-identity regression that `0101`'s backfill missed. That member could authenticate and then resolve to nothing. Measured scope: exactly one row. |

## Phase 4 — clock unification (`0126`)

| # | Item | Owner | Status |
|---|---|---|---|
| E21 | `src/utils/periodSettlement.test.js:11` and `src/utils/policies.test.js:14` each hardcode their own `2026-05-26` injected-NOW literal. Both still pass (57/57), but they no longer exercise the anchor the demo actually runs on — a test pinned to a value nothing else uses cannot catch drift. | P7-tests | OPEN |
| E22 | Comment-only stale clock mentions with no runtime effect: `adminAttentionDerive.js:11-16`, `employerSeed.js:14`, `adminAttention.js:19`. | P7-docs-truth | OPEN |
| E23 | **A06-003's data half.** Live `contribution_schedules` / `subscriber_insurance_products` still carry over-shifted dates (weekly savers due up to 57 days out) until the next `npm run seed`. That reseed is deliberately NOT recommended yet: it must wait for A04-003 (NAV pricing, `P3-nav-integrity`) or seeded units revert to the dead 1,000 UGX price. **Ordering dependency, not an oversight.** | after A04-003 applies | **BLOCKED** |
| E24 | A26-003's doc half — `CLAUDE.md:201`, `docs/BACKEND.md:880`, `docs/FRONTEND.md:301`, `docs/FRONTEND.md:1412` all still print the stale `2026-05-26`. | P7-docs-truth | OPEN (by design) |

Handed directly to `P4-branch-metrics` (it owns the files, and was still running):
**A12-001** — branch charts label their x-axis from `new Date()`
(`OverviewDesktop.jsx:64-72`, `deriveBranchAnalytics.js:47`).
**A11-007** — agent home shows June on one tile and August on another
(`agentHomeSummary.js`).

## Phase 4 — policy status

| # | Item | Owner | Status |
|---|---|---|---|
| E25 | `src/services/employer.js:694` — `insuredCount = members.filter(m => m.insuranceStatus === 'active')` trusts the same raw stored flag A06-004 was about, on the employer dashboard's insured headcount. Verified live: 0 employer-roster members currently have a self-funded lapsed policy, so it is not visibly wrong **today** — but it is the identical unguarded pattern and will drift the same way on the first lapse. Reuse the now-exported `deriveCoverStatus`. | needs an owner | OPEN (latent) |
| E26 | `PolicyChips.jsx`'s doc comment claims "the service already filters subscriber.policies to active products". The agent-facing list can now include expired entries, so the component's own Active/Expired ternary genuinely renders. Component logic was always right; only the comment drifted. | P7-docs-truth | OPEN (comment only) |

## Phase 6 — observability / CSP

| # | Item | Owner | Status |
|---|---|---|---|
| E27 | **`VITE_SENTRY_DSN` must be set in Vercel's BUILD environment.** Proven root cause of A09-005/A24-009: Vite statically folds `if (import.meta.env.VITE_SENTRY_DSN)` to `if (undefined)` and Rollup deletes Sentry *including the import*. **No source edit can fix this** — and a runtime-only value is too late. Steps in `a07/observability-notes.md`. | **user / deploy owner** | **OPEN — blocks A09-005** |
| E28 | `@sentry/react` is a **devDependency** (A09-012/A24-005). Builds today because Vercel installs devDeps, but a build with `NODE_ENV=production` or `--omit=dev` fails to resolve the import **only at deploy time**. `package.json` holds the user's WIP. | P6-deps | OPEN |
| E29 | **CSP is still `Report-Only` by design.** Fonts are self-hosted and the sink now exists, but enforcing needs a six-role walk on a preview deploy showing zero violations, which cannot be run from here. Flipping the header without that evidence is the demo-visible risk the plan warns about. | needs a preview deploy | **OPEN — deliberate** |

## Phase 6 — remainder (2026-08-25)

### Closed by decision, with the measurement

| # | Item | Disposition |
|---|---|---|
| **A21-003** | `employerSeed.js` ships on the live-backed path because `IS_SUPABASE_ENABLED` is `String(import.meta.env.VITE_USE_SUPABASE ?? 'true').toLowerCase() !== 'false'` — a RUNTIME expression, so Rollup cannot constant-fold the mock branch away (unlike the Sentry gate, which folds because it is a bare truthiness check). | **DEFER, measured.** The cost is **7.3 KB gzipped**. The fix is 18 synchronous call sites made async — 14 of them in `src/services/employer.js`, the employer money path repaired earlier today for A14-001 and now covered by the largest test cluster in the suite. 7.3 KB does not justify an async refactor of a money service that was just rebuilt. Revisit if `VITE_USE_SUPABASE` is ever removed, which makes the branch statically dead and the fix free. |
| **A21-004** (index drop) | The audit called `idx_subscribers_agent_id` redundant against the `(agent_id, id)` composite. | **REFUSED.** 54,840 scans in 46 h — MORE than the composite's 42,625 — because it is half the size (312 kB vs 632 kB) and the planner prefers it. A prefix is not a duplicate. Dropping it pushes 54,840 lookups onto a twice-as-wide index, silently. |
| **A21-005** (RLS consolidation) | **EXCLUDE upheld.** Proven safe (13/13 identities row-set-identical by md5 fingerprint, including 3 negative cases) and 31% faster — and still not worth it: 6-11 ms behind a ~93 ms Singapore round trip, against a cross-tenant PII disclosure if one `CASE` branch is subtly wrong. The finding's central claim is also false on live: it says the policies read `auth.jwt()` per row; `EXPLAIN` shows every one already InitPlan-hoisted by 0008/0023, and its cited ~297 ms was a COLD run. `0130` is authored and reversible so this can be revisited with evidence. |

### Still needs the user

| # | Item | Why |
|---|---|---|
| U3 | **`SUPABASE_URL` is missing from `.env.local`** (A09-014). Add:<br>`SUPABASE_URL=https://ilkhfnoyxlxwqadebnkp.supabase.co`<br>The template at `.env.local.example:41` already carries it. Until then local `npm run dev:api` boots only via a fallback that `server/env.ts:14-16` says is scheduled for removal. | `.env.local` is the user's file and is never edited by this programme. |
| U4 | **An unidentified third-party monitor polls `/api/health`, which does not exist**, and has been recording its 404 as "up". It is NOT the GitHub keepalive (`/readyz`) nor the cron-job.org / UptimeRobot backups (`/healthz`). Now that morgan wraps the health routes (A09-010), its next poll appears in the Render log stream with a timestamp and user-agent — the cheapest way to identify and repoint it. | Needs uptime-monitor dashboard access. |

---

## Process incidents — 2026-08-25 (integrator record)

### PI-1 · A bare `git commit` ignores your careful `git add`

**Hit two independent agents and the integrator, within an hour.**

The programme guardrail reads *"Never `git add -A`. Commit by explicit path."*
Every agent obeyed the letter of it — and it was not enough:

```sh
git add path/a path/b        # scoped, correct
git commit -m "..."          # NOT scoped — commits the ENTIRE INDEX
```

On a checkout where a dozen agents work in parallel, another agent may have
staged its own file seconds earlier. That file rides along in your commit.

Observed:
- `83886df` (`P5-design-tokens`) swept in `src/branch-dashboard/mobile/AgentDetailMobile.test.jsx`, owned by `P5-branch-mobile`.
- `cdc66b7` (integrator) swept in the same file again.
- `P5-branch-mobile` then committed it properly itself in `5130f86`.

**No data was lost** — the file was verified coherent (4 tests passing) and
unmodified after. The real risk is worse than misattribution: a bare commit can
capture a file **mid-write** from an agent still editing it, producing a commit
that never existed as a working state.

**The fix, now in force:**

```sh
git commit -o path/a path/b -m "..."    # --only: the pathspec is on the COMMIT
git add -N path/new                     # a NEW file must be known to git first
```

Neither agent rewrote history to scrub it, and that was the right call: other
agents' commits were already stacked on top of a live shared branch, so a rebase
would have been a far larger risk than the cosmetic blemish it fixed.

### PI-2 · Never capture "before" output by reverting the shared working tree

`P6-supply-chain` ran `git checkout` over its own files to measure a clean
"before", intending to restore its patch afterwards. A watchdog interrupt landed
in between and **the patch was lost** — `server/env.ts`, `.env.local.example` and
`docs/render-operational.md` all reverted, work gone.

Capture "before" without touching the tree: `git show HEAD:<path>`, or copy to a
scratch file. On a shared checkout a revert is also visible to every other agent
for as long as it lasts.

### PI-3 · A harness watchdog killed 8 of 11 agents mid-flight

Not an agent fault and not a code fault: `no progress for 600s (stream watchdog
did not recover)`. Several were mid-verification. All were resumed from their own
transcripts with `SendMessage`, after the integrator inventoried what had
survived on disk and told each agent specifically what to re-check rather than
letting it redo work blindly.

Three stale `* 2.*` duplicate files (macOS-style copies, byte-identical to
`HEAD`, no unique content) were moved to the session scratchpad rather than
deleted, since this is the user's live checkout.
