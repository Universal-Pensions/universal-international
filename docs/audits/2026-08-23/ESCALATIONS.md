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
