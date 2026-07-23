> **Agent guide.** Historical audit from 2026-05-31, covering testing, QA and CI coverage (vitest, Playwright E2E, GitHub workflows) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 06 — Testing, QA & CI Coverage (Agent F, Phase 1)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (working tree)
**Agent:** Agent F — Testing, QA & CI Coverage. READ-ONLY. No source edits, no commits, no migrations, no DB writes.
**Scope:** `e2e/` (Playwright specs, fixtures, helpers, config, global-setup), all `*.test.{js,ts}` (vitest across `api/`, `src/hooks/`, `src/services/`, `src/utils/`), `.github/workflows/test.yml`, `.github/workflows/keepalive.yml`.

> E2E was **not executed** (it mutates the shared live DB). Findings rely on the Phase 0 baseline (`00-baseline.md`: unit PASS 717/717, build PASS) + static spec reading + schema cross-reference against migration `0029_commission_simplify.sql`.

---

## Executive summary

- **Unit/mock-layer coverage of the NEW code is genuinely strong.** `settlement.js`, `xlsx.js`, the `commissions` service (`applySettlementUpload` / `listSettlements`), `notifications` service, and the `useCommission` / `useNotifications` hooks all have dedicated, thorough vitest specs that assert the new `due→paid` shape, the settlement-batch record, the notification fan-out, and the React-Query invalidation blast. This is why Phase 0 shows `npm test` green at 717/717.
- **The E2E suite was NOT carried through the 0029–0031 simplification and is now broken against the live schema.** Multiple Playwright specs + the shared `e2e/fixtures/db.ts` helper still query tables, columns, enum values, and RPCs that migration `0029` **dropped** (`settlement_runs`, `agent_confirm_commission`, `agent_dispute_line`, `released`/`confirmed`/`held`/`disputed` statuses, `disputed_at`/`previous_status`/`agent_confirmed` columns). These will error or hard-skip when run against the live `zengmiugieqjqzaccbqe` project, which already has 0029 applied (baseline §5.2).
- **There is ZERO end-to-end coverage of the entire new flagship flow** (`settlement_batches` + `apply_settlement` RPC + `notifications` + `mark_notifications_read` + `NotificationBell`). The only commission/settlement E2E specs that exist describe the *removed* model. The new flow is covered only at the mock/unit layer, never against the real RPC.
- **CI gating is structurally sound** (lint→unit→e2e, PR vs main matrix, secrets declared, `--workers=1` for the shared-DB race) but the e2e leg will surface as red/flaky once the stale specs hit the simplified schema — and the `keepalive.yml` hostname is an admitted placeholder.

This is the central cutover risk for Agent F's workstream: **the E2E gate is no longer a trustworthy signal for the commission feature it is supposed to protect.**

---

## Critical

### C1 — Stale E2E specs reference schema dropped by 0029 → broken E2E gate against the live DB
**Classification:** real-bug · **Severity:** Critical

**Evidence:**
- `e2e/specs/flows/agent-confirm-commission.spec.ts:33,45,59,64,70,73-74` — queries `commissions.status='released'`, updates `status:'released', agent_confirmed:false`, waits on `/rest/v1/rpc/agent_confirm_commission`, asserts `status==='confirmed'` and `agent_confirmed===true`.
- `e2e/specs/flows/settlement-run-lifecycle.spec.ts:31,45,63-69` — reads/updates the `settlement_runs` table and its `settlement_run_state` enum (`draft`/`branch_review`/`released`).
- All of these are **dropped** by `supabase/migrations/0029_commission_simplify.sql`: `DROP FUNCTION ... agent_confirm_commission` (`0029:59`), `DROP TABLE ... settlement_runs CASCADE` (`0029:87`), `DROP TYPE ... settlement_run_state` (`0029:90`), `DROP COLUMN ... agent_confirmed` (`0029:109`); the `commission_status` enum is collapsed 7→2 to `due`/`paid` (`0029:137`, baseline §4.1).
- Baseline §5.2 confirms 0029/0030/0031 are **applied and ledger-tracked in the live DB** — so these specs run against a schema where their target objects no longer exist.

**Impact:** On the **CI PR path** the e2e job runs `npx playwright test e2e/specs/smoke e2e/specs/flows` (`.github/workflows/test.yml:124`), which includes both stale flow specs. On the **main post-merge full matrix** (`test.yml:135`) they run too. Against the live DB:
- `agent-confirm-commission` — the `beforeEach` SELECT `eq('status','released')` returns no rows (no such enum value), so it `test.skip(...)` (`agent-confirm-commission.spec.ts:37`) — i.e. it **silently never tests anything**, masking total loss of coverage rather than failing loudly.
- `settlement-run-lifecycle` — `supabaseAdmin.from('settlement_runs')` against a dropped table returns a PostgREST error; the `beforeEach` `expect(row).not.toBeNull()` (`settlement-run-lifecycle.spec.ts:37`) **hard-fails** the spec.

Either way the e2e gate is no longer green-for-the-right-reason: it is red (run-lifecycle) or falsely-green-by-skip (confirm-commission) for the very feature the simplification shipped.

**Recommendation:** Delete `agent-confirm-commission.spec.ts` and `settlement-run-lifecycle.spec.ts` (the flows they cover no longer exist) and replace them with one new flow spec for the simplified path: distributor downloads the settlement template → fills Amount Paid → re-uploads → asserts `apply_settlement` RPC fires, the agent's `due` lines flip to `paid`, a `settlement_batches` row is recorded, and a `commission_settled` notification appears for the agent + branch (the agent/branch `NotificationBell`). This is a cutover blocker: do not push to `main` while these specs are in the e2e gate.

---

### C2 — `e2e/fixtures/db.ts` + `invariants.spec.ts` query dropped columns/RPCs → DB-invariant gate fails on main
**Classification:** real-bug · **Severity:** Critical

**Evidence:**
- `e2e/fixtures/db.ts:253-264` `snapshotCommission()` SELECTs `previous_status, disputed_at, disputed_by, dispute_reason, resolved_at, resolved_by, outcome_reason` — **all dropped** by `0029:109-117`.
- `e2e/fixtures/db.ts:309-366` `seedReleasedCommissionForFixture()` and `:375-442` `seedDisputedCommissionForFixture()` flip rows to `status:'released'` / `status:'disputed'` — **no longer valid enum values** (`0029` collapse to `due`/`paid`).
- `e2e/specs/db/invariants.spec.ts:95` `TERMINAL = ['confirmed','released','rejected']` and `:90-106` assert against those statuses (none exist post-0029); `:108-128` query `status in ('held','disputed')` + `disputed_at`/`disputed_by` columns (dropped); `:156-179` invoke the `agent_dispute_line` RPC and assert it exists in `pg_proc` — `agent_dispute_line` is **dropped** by `0029:55`.

**Impact:** The DB-invariants spec runs in the **main post-merge full matrix** (`test.yml:128-135`) against the live project, which baseline §5.3 confirms has the simplified schema. Test #3 (`paid_date` + terminal status) now has a meaningless `TERMINAL` set; test #4 errors on missing columns; test #7 (`agent_dispute_line exists`) **inverts** — it asserts the RPC is *present* and will now fail because 0029 removed it. The DB-invariant guard — explicitly there to "guarantee the schema state is intact after each merge to main" (`test.yml:131-133`) — is itself encoding the pre-0029 schema and will report the post-cutover DB as broken.

**Recommendation:** Rewrite `invariants.spec.ts` to the two-state model: assert `commissions.status IN ('due','paid')` only, that `paid` rows carry `paid_date`/`paid_amount`, and that `apply_settlement` / `mark_notifications_read` exist in `pg_proc` (replacing the `agent_dispute_line` probe). Strip the dispute/run columns from `db.ts` `snapshotCommission`, delete `seedReleasedCommissionForFixture`/`seedDisputedCommissionForFixture` (their consumers in C3 are also removed). Cutover blocker alongside C1.

---

## High

### H1 — Zero E2E coverage of the new commission→settlement→notification flow
**Classification:** quality/tech-debt · **Severity:** High

**Evidence:**
- A repo-wide grep of `e2e/` for `settlement_batches`, `apply_settlement`, `notifications`, `mark_notifications_read`, `NotificationBell`, `commissionMonths`, `paid_amount` returns **no hits**. The only commission/settlement specs in `e2e/` (`agent-confirm-commission`, `settlement-run-lifecycle`, the `modal-escape` dispute blocks, `invariants.spec.ts`) describe the *removed* model (see C1/C2/C3).
- The new flow is the headline of the change set (migrations 0030/0031, `src/services/{commissions,notifications}.js`, `src/components/notifications/`, `NotificationBell`, the distributor `CommissionPanel` upload→apply UI per CLAUDE.md §9 glossary).
- It IS well-covered at the **mock/unit layer**: `src/services/__tests__/commissions.test.js:170-219` (settlement upload flips due→paid + records batch + idempotent), `src/services/__tests__/notifications.test.js` (full feed/unread/mark-read/fan-out), `src/hooks/__tests__/useCommission.test.js:165-205` (apply-settlement invalidation blast incl. notification keys), `src/hooks/__tests__/useNotifications.test.js`. But every one of these forces `vi.mock('../api', () => ({ IS_SUPABASE_ENABLED: false }))` — they exercise the **mock branch only**, never the real `supabase.rpc('apply_settlement', ...)` / `mark_notifications_read` path.

**Impact:** The actual live RPC path — the SECURITY DEFINER `apply_settlement` (role gate, batch insert, notification insert, `due→paid` UPDATE) and `mark_notifications_read` — has **no automated test at any layer**. Bugs in the real RPC (e.g. the no-rounding `paid_amount` write at `0031:161` and the no-idempotency-nonce double-pay risk at `0031:93-217`, flagged as SEED-A4/B1 and SEED-B2/D1 for Agents A/B) would pass CI because the only tests touch the JS mock that doesn't share that code. The mock-branch passing creates false confidence.

**Recommendation:** Add the new flow spec described in C1 as the primary E2E. Because the `apply_settlement` SECURITY-DEFINER body gates on `app_role='distributor'` and the service-role client has a NULL jwt (the same limitation `settlement-run-lifecycle.spec.ts:60` documented for the old RPC), drive it through the UI with the distributor storage-state so the real bearer token carries the claim — do not bypass via `supabaseAdmin`. Assert the DB side (batch row, due→paid, notification rows) via the existing `supabaseAdmin` read helpers.

### H2 — Three `modal-escape` regression assertions depend on dropped commission states
**Classification:** real-bug · **Severity:** High

**Evidence:**
- `e2e/specs/regression/modal-escape.spec.ts:154-160` (agent block) calls `seedReleasedCommissionForFixture(...)` and `:200-206` (distributor block) calls `seedDisputedCommissionForFixture(...)` — both flip rows to dropped enum values (see C2).
- `:166-190` navigates to `/dashboard/commissions/earned` and clicks a `Dispute` CTA; `:212-237` opens the distributor "Commission resolution modal" via an `Approve`/`Reject` button. The dispute / approve / reject CTAs were removed wholesale in 0029 (BACKEND.md §15b: "Commission dispute flow removed … there is no longer a dispute path on either side"; FRONTEND.md §16b X3 "now moot").
- `:168` comment still states `/dashboard/commissions/earned lists 'released' + 'confirmed' lines`.

**Impact:** Two of the three modal-escape regression cases run in the main full matrix and will fail at `seedReleased/DisputedCommissionForFixture` (invalid enum UPDATE) or at the `Dispute`/`Approve` button lookup (CTA no longer rendered). The genuinely-valuable contract these specs protect — `Modal.jsx`'s Escape `stopImmediatePropagation` so Escape closes only the modal, not the parent slide-in panel — gets thrown away with the dead dispute scaffolding. The first case (ViewBranches confirm-status modal, `:34-143`) does NOT depend on commission state and remains valid.

**Recommendation:** Re-anchor the two broken blocks onto a modal that still exists in the simplified app (e.g. the distributor settlement confirm/apply modal in `CommissionPanel`, or any agent/branch modal) so the Modal-Escape primitive stays covered. Keep the ViewBranches block as-is.

### H3 — CI lint step will hard-fail on a stale `eslint-disable` directive / artifact lint (gate brittleness)
**Classification:** quality/tech-debt · **Severity:** High (already-known component cross-referenced)

**Evidence:**
- `.github/workflows/test.yml:61-62` runs `npm run lint` = bare `eslint .` and the whole CI pipeline is gated on it (`e2e` `needs: lint-and-unit`, `test.yml:70`).
- Baseline §1.1 (SEED-G1): `eslint.config.js:8` does not ignore `playwright-report/`, so a local report makes `eslint .` emit 572 errors. CI is insulated only because it has no report artifact at lint time — but baseline also found (SEED-C1) a **stale `eslint-disable react-hooks/refs` at `src/contexts/AuthContext.jsx:121`** that produces a `warning Unused eslint-disable directive`. ESLint flat config does not fail on warnings by default, so this is a warning, not an error — but it is the kind of latent lint state that flips to a hard CI failure the moment `--max-warnings 0` or a rule upgrade lands.

**Impact:** The lint gate is the first thing every PR and every push-to-main must clear. Its pass/fail currently depends on local filesystem state (presence of `playwright-report/`), which is fragile and was already flagged Medium for Agent G. From the Agent F (CI-correctness) angle: the gate is environment-dependent rather than deterministic, and a stale directive sits in the tree against CLAUDE.md §3's "0 errors / drops to 1 warning" expectation.

**Recommendation:** This is owned primarily by Agent G (eslint `globalIgnores`) and Agent C (the `AuthContext.jsx:121` directive). For CI robustness, add `playwright-report/`, `test-results/`, `dist-server/` to `eslint.config.js` ignores so `npm run lint` is deterministic regardless of local artifacts. Not re-classifying as new — cross-referenced to SEED-G1/SEED-C1.

---

## Medium

### M1 — E2E `flows` directory mixes valid + dead specs; the PR path runs the dead ones
**Classification:** quality/tech-debt · **Severity:** Medium

**Evidence:** `test.yml:118-126` PR path: `npx playwright test e2e/specs/smoke e2e/specs/flows --project=chromium --project=mobile-chromium --workers=1`. The `flows` glob currently contains 17 specs (the plan's "9 flows" count is stale), two of which are dead (C1) and one regression spec (H2) is dead in the main matrix. There is no spec-level allowlist or tagging — the run is directory-glob-based, so a dead spec cannot be excluded without deleting it.

**Impact:** Every PR burns browser time on, and gets noise from, specs that can never pass-for-the-right-reason. The "fast PR feedback" intent (`test.yml:121-122`, "stay under the 5-min-per-combo SLA") is undermined by skips/failures that carry no signal.

**Recommendation:** After fixing C1/C2/H2, consider Playwright tag-based selection (`@commission`, `@smoke`) or a `grep`/`grepInvert` so the suite composition is explicit rather than implicit in the directory layout. Lower priority than fixing the stale specs themselves.

### M2 — `agent-confirm-commission` masks lost coverage with `test.skip` instead of failing
**Classification:** quality/tech-debt · **Severity:** Medium

**Evidence:** `e2e/specs/flows/agent-confirm-commission.spec.ts:37` — `if (!row) test.skip(true, 'no released commissions for ${AGENT_ID} — re-run npm run seed')`. The skip was designed for *seed drift* (transient empty window), but post-0029 the condition is **permanently true** (no `released` enum value exists), so the test skips forever and reports green.

**Impact:** A permanent silent skip is worse than a deletion — it looks like coverage exists. This pattern (seed-window `test.skip`) is reasonable for genuinely transient data, but here it disguises a structural loss.

**Recommendation:** Subsumed by C1 (delete the spec). General hardening: prefer `expect(rows.length).toBeGreaterThan(0)` with a deterministic fixture over an open-ended `test.skip(!data)` for invariant data, so loss of the data surfaces as a failure.

### M3 — `keepalive.yml` pings a placeholder hostname; no failure alerting wired
**Classification:** quality/tech-debt · **Severity:** Medium

**Evidence:** `.github/workflows/keepalive.yml:8-11` self-documents the URL as a placeholder: "the hostname below is a placeholder derived from `name:` in render.yaml … Update this URL in a follow-up commit once the actual service hostname is confirmed." It curls `https://uganda-dashboard-api.onrender.com/healthz` every 14 min (`:17`) and `exit 1`s on non-200 (`:30-32`). The header comment also says cron-job.org/UptimeRobot "should be set to email the team on failure (audit G59)" — i.e. the alerting is assumed-external, not in this workflow.

**Impact:** If the real Render hostname differs (Render appends a hash suffix when the name is taken, per the comment), the keepalive silently pings a 404/wrong host: either it 404s and the workflow goes red with no one watching, or it hits the wrong service and never wakes the actual backend — defeating the free-tier wake purpose and letting the demo backend cold-sleep mid-presentation. A failing scheduled workflow has no notification path inside GHA by default.

**Recommendation:** Confirm the live Render hostname and pin it (Agent G owns the `render.yaml` branch/hostname reconciliation). For Agent F's CI concern: the keepalive's correctness can't be verified from the repo alone — flag it as a manual pre-cutover check. Consider failing closed only after N consecutive misses to avoid alert noise on single-ping jitter.

### M4 — No regression spec for the two known subscriber StubPage dead-ends
**Classification:** quality/tech-debt · **Severity:** Medium (already-known dead-ends; the test-gap is the new finding)

**Evidence:** FRONTEND.md §16b documents `/dashboard/settings/notifications` and `/dashboard/settings/security` as `StubPage` placeholders. The plan's Agent-F check explicitly asks "whether regression specs cover the known stub pages / nominee-sum / write-failure paths." Searching `e2e/` for these routes / `StubPage` returns nothing; `subscriber-write-failures.spec.ts` covers Profile/Withdraw/Claim/Insurance/Schedule/Nominees toast wiring (well — see below) but not the stub routes, and the **nominee sum-to-100 invariant** is not asserted anywhere in E2E (it's only in the `upsert_nominees` RPC per BACKEND.md §15b).

**Impact:** No automated guard prevents a future change from wiring a half-built page behind those stub routes (or regressing the toast wiring). Low demo impact (Settings dead-ends are already cataloged), but the asserted coverage the plan expects is absent.

**Recommendation:** Add a tiny regression spec asserting the two StubPage routes render the known placeholder (so the dead-end is at least pinned, not silently changed) and — if/when a nominee write spec is added — assert the sum-to-100 rejection path. Don't treat the StubPages themselves as a new bug (they're §16b already-known).

### M5 — `subscriber-write-failures` only truly verifies one of six write surfaces
**Classification:** quality/tech-debt · **Severity:** Medium

**Evidence:** `e2e/specs/regression/subscriber-write-failures.spec.ts` is described as proving the error-toast wiring on six surfaces (Profile, Withdraw, Claim, Insurance, Schedule, Nominees). Only **Profile Save** (`:56-104`) drives a real 500 and asserts the toast. The other five were converted to `expect.soft(... isVisible).toBe(true)` "the CTA is reachable" smoke-checks (`:135-144` Withdraw, `:161-168` Claim, `:191-198` Insurance, `:226-232` Schedule, `:249-255` Nominees), each annotated "out of scope … toast wiring covered by Profile Save."

**Impact:** Five of the six surfaces no longer verify that a 500 produces an error toast (the original audit defect this spec was created for). They verify only that the page mounts. A regression that swallows the error on, say, the Nominees or Schedule write would not be caught. The `expect.soft` makes this non-blocking even when it does run. This is a deliberate scope-narrowing documented in-spec, but it leaves the named guard weaker than its filename and header imply.

**Recommendation:** For at least one more write surface that does not require file uploads or multi-step sheets (e.g. Schedule via `ContributionSettingsForm`), drive the form to a dirty+valid state and assert the real 500→toast, so the toast pipeline is proven on more than the single Profile path. Acceptable to leave file-upload-gated surfaces (Claim) as reachability checks.

---

## Low

### L1 — Two KYC failure-path E2E cases permanently deferred via `test.skip` ("Phase 9")
**Classification:** quality/tech-debt · **Severity:** Low

**Evidence:** `e2e/specs/flows/kyc-failure-paths.spec.ts:71-79` — `test.skip('aml-screen flagged …')` and `test.skip('face-match liveness-fail …')`, both with `TODO(Phase 9)` noting `e2e/helpers/signup.ts` is "DO-NOT-MODIFY per the 3F brief" and a force-aware fork is the right vehicle. The two implemented cases (id-quality blur, nira partial) do run.

**Impact:** Two of the four KYC failure surfaces have no E2E. KYC is intentional-demo-scope (mocked, §10a), so the *feature* gap is by design; the *test* gap is minor tech-debt. The "phases 4–5 deferred" the plan asks about resolves here and in the MEMORY note (QA harness "phases 4-5 deferred") — these are pre-existing, not introduced by the simplification.

**Recommendation:** Track as backlog. Build the force-aware signup helper fork to reach AmlStep/LivenessStep. Not a cutover concern.

### L2 — `destructive` empty-states arm is skip-gated and effectively never run in CI
**Classification:** quality/tech-debt · **Severity:** Low

**Evidence:** `e2e/specs/regression/empty-states.spec.ts:58-66` — the zero-rows arm deletes every branch and is gated behind `ALLOW_DESTRUCTIVE_E2E=true`, which CI never sets (`test.yml` has no such env). The filter-mismatch arm (`:36-56`) runs and is valid.

**Impact:** The "no branches yet" empty-state path is never exercised in CI. This is a sensible safety gate (deleting all branches would race every other spec on the shared DB), so it's by-design tech-debt rather than a defect. The branch-delete + restore is correctly wrapped in try/finally (`:83-102`).

**Recommendation:** Leave as-is; optionally run the destructive arm in a dedicated isolated job/branch DB if zero-rows coverage is ever deemed important. Acceptable for a demo.

### L3 — FRONTEND.md §17 testing-layout doc is stale vs the working tree
**Classification:** quality/tech-debt · **Severity:** Low (doc drift; Agent G owns §11 doc discipline)

**Evidence:** FRONTEND.md §17:
- `:1224` "40 test files, 707 passing tests at last sync" — working tree is **43 vitest files / 717 passing** (baseline §1; verified). New files `settlement.test.js`, `xlsx.test.js`, `notifications.test.js`, `useNotifications.test.js` were added without updating the count.
- `:1226` "`@vitest/coverage-v8` is currently NOT installed" — `package.json` now declares `@vitest/coverage-v8: ^4.1.7` and it **is installed** in `node_modules` (verified). The doc warning is obsolete.
- `:1214` correctly notes `settlementCycle.test.js` was deleted with `settlementCycle.js` (good — that one is current).

**Impact:** Misleading onboarding info; the "coverage not installed" note would send a developer to needlessly `npm i` a present dep, and the file/test counts undercount the new-feature specs. Pure doc drift, no runtime effect. Cross-references Agent G's doc-lockstep (§11) finding.

**Recommendation:** Refresh §17 counts to 43/717, drop the obsolete coverage-v8 "not installed" note, and add the four new-feature test files to the inventory table. Bundle with Agent G's doc-drift remediation.

### L4 — Shared-DB E2E race is mitigated, not eliminated (awareness)
**Classification:** quality/tech-debt · **Severity:** Low (awareness)

**Evidence:** `test.yml:20-24` + `playwright.config.ts:38` run e2e with `--workers=1`, and the workflow-level `concurrency` block (`test.yml:34-36`, `cancel-in-progress: true`) pre-empts overlapping runs on the same ref. Flow specs write to the shared live `zengmiugieqjqzaccbqe` project and clean up in `afterEach`/try-finally (`empty-states.spec.ts:91-102`, `db.ts` cleanup helpers). `playwright.config.ts:37` sets `retries: 1` in CI.

**Impact:** The single-worker + concurrency-cancel design correctly serializes writes within a run and prevents two CI runs from racing the same rows. The residual risk: two runs on **different refs** (e.g. a PR job and a push-to-main job) are not in the same concurrency group and could both mutate the shared DB simultaneously, and a hard-crashed spec that skips its `afterEach` can leak rows (the `assertNoSubscriberOrphans` probe in `db.ts:142` exists to catch this but is not invoked by any spec in the current tree — grep shows no caller). Acceptable for a demo with low CI concurrency.

**Recommendation:** Optionally widen the `concurrency.group` to be workflow-wide (drop `github.ref`) so PR and main e2e jobs can't overlap on the shared DB, and wire `assertNoSubscriberOrphans()` into a final teardown/`afterAll` so leaked rows surface. Awareness-level; not a cutover gate.

---

## Items considered and NOT reported (demo-scope / already-known)

- **Mocked OTP "lockout" spec** (`auth-otp-retry-lockout.spec.ts`) asserts only the **front-end** `MAX_ATTEMPTS=5` feedback loop via the dev-only `upensions_otp_force` override, and its own header (`:6-8`) states "No real backend lockout exists." This correctly tests UI behaviour over intentional-demo-scope OTP — **not a bug**.
- **KYC force-failure mechanism** (`x-qa-force` / `localStorage upensions_<stage>_force`) is the documented demo-scope failure-injection path (CLAUDE.md §10a) — correctly used by tests, not reported.
- **Unit tests forcing `IS_SUPABASE_ENABLED:false`** is the standard mock-branch testing convention (FRONTEND.md §17) — the resulting *live-RPC* gap is reported as H1, but the mock-branch tests themselves are correct and valuable.
- **Subscriber StubPages** themselves (FRONTEND.md §16b) — already-known dead-ends; only the *missing test* is reported (M4).
- **`settlementCycle.test.js` deletion** — correct and intentional (deleted with `settlementCycle.js` in 0029; FRONTEND.md §17:1214). No dangling import (only a stale doc-comment in `mockData.js:33`, owned by Agent C).
- **`vitest` config excludes `e2e/**`** (`vite.config.js:35`) — correct; this is why the stale E2E specs do not break `npm test` and Phase 0 unit run is green.

---

## Cutover go/no-go (Agent F scope)

**Blocks `feat/simplify-commissions` → `main`:**
1. **C1** — stale flow specs (`agent-confirm-commission`, `settlement-run-lifecycle`) reference dropped schema; the e2e gate is no longer trustworthy for the commission feature.
2. **C2** — `db.ts` fixtures + `invariants.spec.ts` query dropped columns/RPCs; the DB-invariant guard fails or inverts on the post-0029 live DB.
3. **H1 (paired with C1)** — there must be at least one real E2E for the new `apply_settlement`/notification flow before it auto-deploys behind a green CI badge.

**Strongly recommended before cutover (not hard blockers):** H2 (modal-escape dispute blocks), H3 (deterministic lint ignores).

**Pre-cutover manual check:** M3 — confirm the live Render `keepalive` hostname (cannot be verified from the repo).
