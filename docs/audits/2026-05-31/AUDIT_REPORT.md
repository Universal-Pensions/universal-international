> **Agent guide.** Historical audit from 2026-05-31 — the Phase-2 synthesis of the Deep Platform Audit, covering the commission→settlement→notification simplification and the whole platform read end-to-end — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# AUDIT_REPORT — Deep Platform Audit, Universal Pensions Uganda

**Date:** 2026-05-31 · **Branch audited:** `feat/simplify-commissions` (working tree, not committed `main`)
**Scope:** the commission→settlement→notification simplification (migrations `0029`/`0030`/`0031`), the subscriber/agent redesign, support tickets, and the whole platform read end-to-end (DB → RPC → service → hook → UI), plus deps/supply-chain, infra/config, testing/CI, and docs.
**Mode:** READ-ONLY synthesis (Phase 2). Reconciles `00-baseline.md` + workstream files `01`–`08`. This is a findings report, not a set of fixes.
**Calibration:** severities are for a **demo / sales-presentation tool** (per the plan preamble and `CLAUDE.md §10a`). Intentional demo-scope (mock OTP/KYC, hardcoded UGX 1,000, fixed 24h JWT, `demo_personas` fallbacks, in-memory tickets+chat, 30s notification polling, per-session mutation stores, no payment processor) is **not** reported as bugs — it is listed in Appendix A only to show it was considered.

---

## 1. Executive summary

The platform is in **good shape** on its hard rules. The frontend is clean on `transition: all`, paired `outline:none`/`:focus-visible`, the mockData import boundary, `normalizeFrequency`, and no hand-rolled `fetch`. The backend's auth enforcement, HS256 JWT pinning, service-role isolation, env preflight, crash recovery, 405/`Allow` headers, and `app_role` discipline in the new RPCs are all correct. The DB has **no §5.7 `'role'`/`auth.uid()` trap anywhere**, RLS is enabled on all 21 tables, and the new write RPCs (`apply_settlement`, `mark_notifications_read`) correctly gate on `app_role`, pin `search_path`, and `REVOKE … FROM PUBLIC`. The 0029 simplification left **no** leftover dispute/run/maker-checker code in the DB, services, or UI. Specialist docs (`BACKEND.md`/`FRONTEND.md`/`ARCHITECTURE.md`/`docs/*`) were updated in lockstep with the feature.

The defects cluster into **three real correctness problems in the headline settlement flow** (partial-payment over-clear, per-line `paid_amount` = batch total, agent totals ignoring `paidAmount`), **two broken support-ticket paths in live mode** (null-agent dead-letter + perpetual spinner), a **broken/stale E2E gate** that no longer protects the commission feature it ships, and a set of **cutover-process risks** (migration-ledger drift, lossy rollback, wrong Render deploy branch, a large uncommitted release unit). There is one **genuine supply-chain finding** (`xlsx@0.18.5`, no npm fix) whose exploit surface in this client-only demo is low but must not be silently accepted.

### Counts by severity (deduplicated; demo-scope + already-known excluded from the main backlog)

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 12 |
| Medium | 14 |
| Low | 11 |
| **Total (actionable backlog)** | **39** |

> Note on de-dup: the raw workstream files contain ~75 finding lines, but many are the **same underlying issue seen from different layers** (e.g. `apply_settlement` idempotency appears in baseline, 01, 02, and 04; the notification-feed staleness appears in 04 and 05; the fractional-UGX money math appears in baseline, 01, 02, and 03). Those are merged below into single backlog items with multi-file evidence. Awareness-only and already-known items are pulled out to Appendix B/C.

### Counts by classification (across all findings considered, pre-exclusion)

| Classification | Approx. count | Where they land |
|---|---|---|
| real-bug | 12 | Main backlog (Critical/High/Medium) |
| quality/tech-debt | ~33 | Main backlog |
| already-known | ~12 | Appendix B (verified, not re-reported as new) |
| intentional-demo-scope | ~10 | Appendix A (considered, never reported as bugs) |

### Top must-fix items (the 8 that matter most before this ships)

1. **Settlement partial-payment is shown but not blocked; the RPC marks ALL due lines paid.** A distributor demoing a partial payment over-clears every due line to `paid` while recording only the partial amount → the agent's outstanding silently drops to zero. Corrupts the commission picture in the core new flow. *(BL-1 / UX-C1 / D-H2)*
2. **Per-line `commissions.paid_amount` is stamped with the whole-batch total**, so a multi-line batch shows each line as if it received the full amount; summing per-line `paid_amount` overstates the paid total by `line_count×`. *(BL-2 / F-4)*
3. **Stale E2E specs reference schema dropped by 0029** (`settlement_runs`, `agent_confirm_commission`, `released`/`disputed` states, dropped columns). The PR + main e2e gate is now red or falsely-green-by-skip for the very feature it should protect, and there is **zero** E2E coverage of the new `apply_settlement`/notification flow. *(BL-3 / C1 / C2 / H2-testing / H1-testing)*
4. **New support tickets dead-letter to a `null` agent in live mode** for any subscriber whose id isn't in the frozen mockData chain — the subscriber gets a "sent to your agent" toast for a ticket no agent will ever see. Breaks the headline subscriber↔agent loop. *(BL-4 / UX-H2)*
5. **Subscriber Agent/Tickets page hangs on a perpetual spinner** when no agent resolves — dead-ends the only ticket-creation entry point. *(BL-5 / UX-H1)*
6. **Migration-ledger drift:** 6 local migrations (0022–0025/0027/0028) are absent from the live `schema_migrations` ledger (effects applied out-of-band) → a future `supabase db push` could half-apply and abort, compounded by known non-idempotent statements in 0003/0006/0010/0025. **Cutover gate.** *(BL-6 / F-3 / G-06)*
7. **`render.yaml` still deploys from `cleanup/post-audit-2026-05-26`, not `main`.** The next manual Render deploy after cutover ships the stale branch. **Cutover gate.** *(BL-7 / G-01)*
8. **Fractional-UGX money math:** the settlement parse path keeps decimals and nothing in FE→RPC rounds; unconstrained `NUMERIC` columns persist sub-shilling amounts that diverge from the rounded display. *(BL-8 / H-C1 / F-6 / M2-backend)*

Also gating the cutover but process-only (not in the top-8 by defect severity): **a verified prod backup before applying the lossy `0029` rollback boundary** (BL-9 / F-2 / G-03), and **committing the large uncommitted/untracked release as one coherent, build-verified unit** (BL-10 / G-02).

---

## 2. Deduplicated, severity-ranked backlog

Each item: title · classification · severity · evidence (`file:line`) · impact · recommendation · est. effort.
Effort key: **XS** ≤30 min · **S** ≤2 h · **M** ≤1 day · **L** multi-day.

### CRITICAL

#### BL-1 — Settlement partial-payment mismatch is shown but NOT blocked; RPC over-clears all due lines
- **Classification:** real-bug · **Severity:** Critical
- **Merges:** UX-C1 (05), D-H2 (04), M2 (02), partial-payment angle of F-4 (01)
- **Evidence:**
  - Confirm button gated only on `agentCount === 0 || applySettlement.isPending`, **not** on `confirmSummary.mismatches.length` — `src/dashboard/commissions/CommissionPanel.jsx:917-923`; mismatch detection `:342-360`; `handleConfirmSettlement` proceeds regardless `:244-256`.
  - RPC flips **every** `status='due'` line for the agent to `paid` and stamps the (possibly-partial) entered amount onto each line + the batch — `supabase/migrations/0031_notifications.sql:157-163`.
  - Agent totals read nominal `SUM(amount) FILTER (status='paid')`, never `paidAmount` — `supabase/migrations/0029_commission_simplify.sql:305`; UI renders `line.amount` only (`src/subscriber-dashboard/.../CommissionsPage.jsx:76-77,172-173`; `src/utils/commissionMonths.js:33`).
- **Impact:** A distributor demoing "what if we only pay half" enters UGX 30,000 against UGX 50,000 pending, sees a yellow mismatch panel, and can still click Confirm. The RPC marks **all** the agent's due commissions fully `paid`, zeroes their outstanding, and quotes the partial figure in `settlement_batches.paid_amount` and the notification — while the agent's "Earned"/history shows the nominal sum. The demo's own "Settled vs Outstanding" strip becomes internally inconsistent. Reachable in a normal demo; corrupts the commission narrative the rep is presenting.
- **Recommendation:** Pick the product contract and enforce it end-to-end: **(a)** block Confirm when `mismatches.length > 0` (or require an explicit "settle anyway" acknowledgement) — best matches the documented "pay the full pending then re-upload" story; **or (b)** implement true partial semantics: clear only lines the amount covers, leave the rest `due`, and surface `paidAmount` in the agent view + total `SUM(paidAmount)` for "Earned". Either way fix the RPC and the read RPC together, and reword the confirm-modal hint (it currently says "matched due commissions", but the op is all-or-nothing per agent — `CommissionPanel.jsx:857-859`).
- **Effort:** S for option (a) [guard + copy]; M for option (b) [RPC + read RPC + agent UI].

#### BL-3 — E2E gate is broken/false against the post-0029 schema, with zero coverage of the new flow
- **Classification:** real-bug · **Severity:** Critical (CI-trust + cutover gate)
- **Merges:** C1, C2, H1, H2 (all 06-testing)
- **Evidence:**
  - Stale flow specs query dropped objects: `e2e/specs/flows/agent-confirm-commission.spec.ts:33,45,59,64,70,73-74` (`status='released'`, `agent_confirm_commission` RPC, `agent_confirmed`); `e2e/specs/flows/settlement-run-lifecycle.spec.ts:31,45,63-69` (`settlement_runs` table + `settlement_run_state` enum).
  - DB fixtures/invariants query dropped columns/RPCs: `e2e/fixtures/db.ts:253-264,309-366,375-442`; `e2e/specs/db/invariants.spec.ts:95,108-128,156-179` (`TERMINAL=['confirmed','released','rejected']`, `agent_dispute_line` existence probe).
  - Dropped by `supabase/migrations/0029_commission_simplify.sql:55,59,87,90,109,137`; live has 0029 applied (baseline §5.2).
  - Regression `e2e/specs/regression/modal-escape.spec.ts:154-160,200-206` reseeds dropped enum states.
  - Repo-wide grep of `e2e/` for `apply_settlement`/`settlement_batches`/`notifications`/`mark_notifications_read`/`NotificationBell` → **no hits**; the new flow is covered only at the mock/unit layer (`vi.mock('../api', () => ({ IS_SUPABASE_ENABLED: false }))`).
- **Impact:** On the PR path (`.github/workflows/test.yml:118-126`) and the main full matrix (`:128-135`): `settlement-run-lifecycle` hard-fails (dropped table), `agent-confirm-commission` silently `test.skip`s forever (masking lost coverage), and `invariants.spec.ts` test #7 inverts (asserts a dropped RPC is present). The DB-invariant guard now encodes the pre-0029 schema and reports the correct post-cutover DB as broken. The real `apply_settlement`/`mark_notifications_read` SECURITY DEFINER path — including the no-rounding and no-idempotency issues below — has **no test at any layer**, so those bugs pass CI.
- **Recommendation:** Delete `agent-confirm-commission.spec.ts` + `settlement-run-lifecycle.spec.ts`; rewrite `invariants.spec.ts` to the two-state model (assert `status IN ('due','paid')`, `paid` rows carry `paid_date`/`paid_amount`, `apply_settlement`/`mark_notifications_read` exist in `pg_proc`); strip dispute/run columns from `db.ts` `snapshotCommission` and delete `seedReleased/DisputedCommissionForFixture`; re-anchor the two `modal-escape` blocks onto a still-existing modal (e.g. the settlement confirm modal). Add **one** new flow spec for the simplified path driven through the distributor UI (so the bearer token carries `app_role='distributor'`): template download → fill Amount Paid → re-upload → assert due→paid, a `settlement_batches` row, and `commission_settled` notifications for agent + branch. **Do not push to `main` while the stale specs are in the gate.**
- **Effort:** M (delete + rewrite invariants + one new flow spec).

### HIGH

#### BL-2 — Per-line `commissions.paid_amount` is the whole-batch total, not the line's amount
- **Classification:** real-bug · **Severity:** High
- **Merges:** F-4 (01); per-line angle of M2 (02), D-H2 (04)
- **Evidence:** `supabase/migrations/0031_notifications.sql:157-163` — `UPDATE commissions … SET paid_amount = v_amount_paid WHERE agent_id = … AND status='due'` writes the single batch-level amount onto **every** settled line. `get_agent_commission_detail` returns it per line as `'paidAmount', c.paid_amount` (`0029_commission_simplify.sql:319`).
- **Impact:** For a 9-line batch settled at UGX 90,000, each of the 9 rows gets `paid_amount = 90000` (not 10,000). Per-line paid totals don't reconcile against `amount`; summing `paid_amount` across lines overstates the paid total by `line_count×`. A genuine correctness/display bug in a primary role flow, distinct from "no real payment processor".
- **Recommendation:** Decide the column's semantics. If per-line: allocate the batch total across lines (`paid_amount = amount` on full settlement, or proportional). If batch-level: drop the per-line column and read the figure from `settlement_batches`, and stop exposing it per-line in `get_agent_commission_detail`. Fix the write RPC + the read RPC together; pairs with BL-1.
- **Effort:** S–M.

#### BL-4 — New support tickets route to a `null` agent (dead-letter) in live mode
- **Classification:** real-bug · **Severity:** High
- **Merges:** UX-H2 (05); service-layer angle UX-M6 (05)
- **Evidence:** `resolveRouting` looks the subscriber up in the **frozen mockData `SUBSCRIBERS` proxy** even in live mode — `src/services/tickets.js:107-114` (`const agentId = SUBSCRIBERS[subscriberId]?.parentId ?? null;`); ticket created with `agentId: null` `:362,374-390`; agent inbox filters `t.agentId === agentId` `:162-163`; success toast fires unconditionally `src/subscriber-dashboard/pages/AgentPage.jsx:218-221`.
- **Impact:** Live seeds 30,001 subscribers; mockData generates a *separate* deterministic `s-0001…` set. Where a live subscriber id isn't a mockData key (or its live `agent_id` differs from mockData's `parentId`), routing returns `null` (or a wrong agent). The null-agent ticket appears only in the distributor's unfiltered oversight (blank agent), never in any agent's inbox — yet the subscriber is told it reached their agent. Silently breaks the core subscriber→agent handoff in the live demo config. Hidden behind the most common demo login (`s-0001` resolves), but bites any other seeded subscriber.
- **Recommendation:** Keep tickets in-memory (demo scope — do NOT add a DB table), but source routing from the live subscriber's real `agent_id`/`branch_id` (already available via `getSubscriberAgent`/`useCurrentSubscriber`), passing them into `createTicket`; fall back to mockData only in mock-backed mode. When routing genuinely can't resolve an agent, don't show the "sent to your agent" toast — show "we couldn't reach an agent" and route to branch/distributor oversight.
- **Effort:** S–M.

#### BL-5 — Subscriber Agent/Tickets page hangs on a perpetual spinner when no agent resolves
- **Classification:** real-bug · **Severity:** High
- **Source:** UX-H1 (05)
- **Evidence:** Body gated `{!agent ? (<spinner>) : (…)}` with no empty/error fallback — `src/subscriber-dashboard/pages/AgentPage.jsx:243-246`; `getSubscriberAgent` returns `null` when no `agent_id` (`src/services/subscriber.js:473-474`) or unknown mock id (`:463-465`). The page keys off the data value, not the query state, so a resolved-`null` is indistinguishable from `isLoading`.
- **Impact:** A subscriber with no `agent_id` (signup-created before assignment, agentless seed row, or unresolved persona) sees the "Your agent" page — the **only** ticket-creation entry point — spin forever, with no "no agent assigned" message. Dead-ends a primary subscriber flow.
- **Recommendation:** Branch on `isLoading` vs `isError` vs resolved-`null`. On `null`, render an explicit empty state and still offer a ticket entry point (route to branch/distributor oversight). Pairs with BL-4.
- **Effort:** S.

#### BL-6 — Migration-ledger drift: 6 local migrations absent from live `schema_migrations` → `db push` collision risk
- **Classification:** real-bug (release/ops correctness) · **Severity:** High · **Cutover gate**
- **Merges:** F-3 (01), G-06 (07), SEED-A7/G4 (00); risk-multiplier F-7 (01)
- **Evidence:** `mcp__supabase__list_migrations` → 25 rows; **missing**: `0022_audit_perf`, `0023_rls_initplan_fixes`, `0024_upsert_nominees`, `0025_drop_realtime_publication`, `0027_post_audit_polish`, `0028_replay_safety_guards` (local files exist; effects verified applied in live). Ledger also has remote-only `20260519165115 fix_metrics_rollup_app_role` with no local file. The new trio 0029/0030/0031 **is** ledger-tracked. `supabase/config.toml:53-55` `[db.migrations] enabled = true`. Known non-idempotent statements in `0003/0006/0010/0025` (`BACKEND.md §15b` D12).
- **Impact:** A future `supabase db push` (or fresh `db reset`) will re-attempt the 6 missing migrations; a non-idempotent statement (e.g. `0025`'s unguarded `ALTER PUBLICATION … DROP TABLE` against an already-removed member) can abort mid-stream, leaving ledger + schema half-applied.
- **Recommendation:** Before cutover, reconcile: either `supabase migration repair`/INSERT the 6 missing rows to mark applied (and add/retire `fix_metrics_rollup_app_role`), **or** formally document that `db push` is not the deploy mechanism and schema reaches live via MCP/direct SQL + `scripts/seed-supabase.mjs`. Write the chosen answer into `BACKEND.md §16` and the cutover runbook. The audited trio itself is unaffected.
- **Effort:** S (reconcile + document).

#### BL-7 — `render.yaml` deploys from `cleanup/post-audit-2026-05-26`, not `main`
- **Classification:** already-known (self-documented) but **active cutover blocker** · **Severity:** High · **Cutover gate**
- **Source:** G-01 (07)
- **Evidence:** `render.yaml:19` — `branch: cleanup/post-audit-2026-05-26 # G14, swap to main after cutover`; `autoDeployTrigger: off` `:20`.
- **Impact:** After cutover, a manual Render deploy ("Deploy latest commit") builds the **stale** branch, shipping a backend that may not match the new frontend/DB contract. Nothing auto-corrects it (`autoDeployTrigger: off`).
- **Recommendation:** Swap `render.yaml:19` to `branch: main` in the same PR that merges to `main`; confirm the Render dashboard tracks `main` before the first post-cutover manual deploy. Keep `autoDeployTrigger: off`.
- **Effort:** XS.

#### BL-8 — Fractional-UGX money math in the settlement path (no rounding FE→RPC; unconstrained NUMERIC)
- **Classification:** real-bug (FE) / quality (DB) · **Severity:** High
- **Merges:** H-C1 (03), M-C1 (03), F-6 (01), M2 (02), SEED-A4/B1 (00)
- **Evidence:**
  - `src/utils/settlement.js:104` keeps the decimal point (`replace(/[^0-9.-]/g,'')`), `:81` accepts any finite `> 0` amount; `src/services/commissions.js:636` `Number(row.amountPaid ?? 0)` with no `Math.round`, written through `:648,659,672` and summed `:679`.
  - RPC casts client value (`0031:127`) and writes verbatim into unconstrained `NUMERIC` (`0031:161,171`); live `information_schema` shows `commissions.paid_amount`/`settlement_batches.paid_amount`/`notifications.amount` are `numeric(NULL,NULL)`.
  - Two divergent `parseAmount`: `src/utils/finance.js:96-101` strips the decimal entirely (`"12,500.50"` → `1250050`, off by 100×), `src/utils/settlement.js:102-107` preserves it — both named `parseAmount`.
- **Impact:** A distributor typing `45000.50` (or an Excel float) settles with fractional shillings that persist to the ledger, while `formatUGX` rounds on display — stored ledger and shown total silently diverge. UGX is zero-decimal. The duplicate-`parseAmount` footgun is the root cause and a maintenance trap.
- **Recommendation:** Consolidate on one canonical `parseAmount` in `finance.js` (strip grouping/currency → number → round to integer UGX → `null` for non-positive/non-finite); have `settlement.js` import it. Round at the FE boundary in `normalizeUploadedRows`/`applySettlementUpload`, and `round()` in the RPC for defence-in-depth (and/or constrain columns to `NUMERIC(14,0)`). Add `finance.test.js` cases (decimal/negative/currency-prefix).
- **Effort:** S–M.

#### BL-9 — `0029.down.sql` is lossy/irreversible → require a verified prod backup before cutover
- **Classification:** quality/tech-debt (rollback safety) · **Severity:** High (awareness/process) · **Cutover gate**
- **Merges:** F-2 (01), G-03 (07), SEED-A1 (00)
- **Evidence:** `supabase/migrations/0029_commission_simplify.down.sql:1-23,65-82` self-documents as DESTRUCTIVE/IRREVERSIBLE and re-creates only empty shells; forward drops `settlement_runs`+`settlement_run_branch_reviews` CASCADE (`0029.sql:86-87`), 9 dispute/hold/confirm columns (`:108-117`), remaps the 7-state enum to 2 lossily (`:124-138`). Live holds 30,001 commission rows.
- **Impact:** 0029 is already applied to live; there is no automated rollback path. A regression discovered post-cutover requires a restore from backup.
- **Recommendation:** Add an explicit go/no-go gate: take and **verify** a full `pg_dump`/PITR snapshot immediately before the cutover and record the snapshot id in the cutover checklist.
- **Effort:** XS (process step).

#### BL-10 — Large uncommitted/untracked release unit auto-deploys Vercel on push to `main`
- **Classification:** quality/tech-debt (release hygiene) · **Severity:** High · **Cutover gate**
- **Source:** G-02 (07); corroborated by baseline §3
- **Evidence:** `git status` — 41–42 modified, 4 deleted, **14+ untracked source paths** form the feature (3 migrations + `.down.sql`, `src/services/notifications.js`, `src/hooks/useNotifications.js`, `src/components/notifications/`, `src/utils/{settlement,commissionMonths,xlsx}.js`, `AgentHeaderChrome.*`, tests). Only 1 commit ahead of `origin/main` (a 12-line nav fix). Pushing to `main` auto-deploys Vercel (`CLAUDE.md §1`).
- **Impact:** The release exists only as working-tree state; if any untracked file is missed by `git add` (e.g. a `.module.css` or the notifications dir), the build fails or silently ships a half-feature. No single commit can be reviewed/reverted as a unit.
- **Recommendation:** Stage the full set as one coherent commit; verify `git status` clean afterward and that `npm run build` + `npm run build:api` + `npm test` pass on the **committed** tree (only `docs/audit-2026-05-31/` should remain untracked). Sequence DB-apply before the Vercel deploy.
- **Effort:** S.

#### BL-11 — Cross-session + within-session notification feed staleness (badge vs list disagree)
- **Classification:** real-bug (within-session) / quality (cross-session) · **Severity:** High
- **Merges:** UX-H4 (05), D-H1 (04), D-M1 (04)
- **Evidence:** `src/hooks/useNotifications.js:17-23` — the feed list has **no `refetchInterval`**; only `useUnreadNotificationCount` polls 30s (`:25-32`). Global `staleTime: 5min`, `refetchOnWindowFocus: false` (`src/main.jsx:28-31`). `NotificationCenterCard` derives its own count from the unpolled list (`src/components/notifications/NotificationCenterCard.jsx:33,39`); mounted persistently on agent home (`HomePage.jsx:42`) + branch overview (`BranchOverview.jsx:92`). `useApplySettlement.onSuccess` invalidates only the distributor's own QueryClient (`useCommission.js:99-110`).
- **Impact:** The headline beat is "distributor settles → agent/branch see a notification land." The badge ticks up within 30s, but the inline `NotificationCenterCard` (and the popover list within `staleTime`) can still render "You're all caught up" — bell says "1 unread" while the card directly below says zero. Visible inconsistency on the primary home surface and in the popover; also a single-session badge-vs-card mismatch after "Mark all read" on one surface.
- **Recommendation:** Give `useNotifications` a `refetchInterval` (reuse `UNREAD_REFETCH_MS = 30_000`) and/or `refetchOnMount: 'always'` so opening the bell forces a refetch; drive both the badge and the inline card count from a single source (have `NotificationCenterCard` use `useUnreadNotificationCount`, or have the bell derive from the list query). Cross-session delivery beyond polling is intentionally out of scope (realtime is off by design).
- **Effort:** S.

#### BL-12 — `/api/chat` reads `req.user.role` (always `"authenticated"`) instead of `app_role`
- **Classification:** real-bug · **Severity:** High
- **Source:** H1 (02)
- **Evidence:** `api/chat.ts:237` (`if (req.user?.role) return flavorForRole(req.user.role);`), `flavorForRole` `:214-219`; JWT shape `api/_lib/jwt.ts:30,86` (`role: 'authenticated'` hardcoded; app role lives in `app_role`). The JWT branch wins over body `context` for authenticated callers (`:234-242`), even though `src/services/chat.js:88-90` correctly sends `context:'admin'`/`'agent'`.
- **Impact:** `flavorForRole('authenticated')` falls through to `'subscriber'`, so every signed-in distributor/branch/agent using the in-dashboard chat assistant gets the **subscriber co-pilot** replies. The distributor/branch "data assistant" and agent DM both degrade to generic saver answers — a visible breakage of a primary-role demo surface. This is the §5.7 `role`-vs-`app_role` trap reappearing in the new server-side chat route. Not covered by `BACKEND.md §15b` B14 (which is the *unauthenticated* override) and there is no `chat.test.ts`.
- **Recommendation:** Read `req.user?.app_role` in `resolveFlavor`. Add a `chat.test.ts` asserting an authenticated distributor/agent JWT yields the admin/agent flavor.
- **Effort:** XS (one-line fix) + S (test).

#### BL-13 — `apply_settlement` has no idempotency guard → re-submit/concurrent submit double-records + double-notifies
- **Classification:** real-bug · **Severity:** High
- **Merges:** F-1 (01), H2 (02), D-M4 (04), SEED-B2/D1 (00)
- **Evidence:** `supabase/migrations/0031_notifications.sql:138-208` — selects `status='due'`, unconditionally UPDATEs to `paid`, INSERTs a fresh `settlement_batches` row (`id = 'sb-' || gen_random_uuid()`, `:166`) + notifications, with no nonce/"already-settled" guard. Only client guard is `disabled={applySettlement.isPending}` (`CommissionPanel.jsx:920`). Service call `src/services/commissions.js:381-385`; mutation `src/hooks/useCommission.js:105-111`.
- **Impact:** An exact re-submit is partly self-idempotent (finds 0 due lines → `no_due` skip). The real exposure: two tabs / a reload mid-flight / a network retry, or re-uploading after new `due` lines accrued — a second `settlement_batches` row + duplicate `commission_settled` notifications are recorded under the same logical payment, inflating the paid total and the feed. On screen this reads as duplicated bell entries + a wrong "paid" figure.
- **Recommendation:** Accept a client-supplied idempotency nonce (per-upload UUID generated when the confirm modal opens), persist it on `settlement_batches` with a `UNIQUE` constraint, and have the RPC short-circuit (return prior result) when it already exists. Client button-disable is not a substitute for the server guard.
- **Effort:** M.

#### BL-14 — `xlsx@0.18.5` (SheetJS): prototype-pollution + ReDoS CVEs, no npm fix, on uploaded files
- **Classification:** real-bug (security) — **not** demo-scope · **Severity:** High
- **Merges:** H-1 (08), SEED-H1 (00); parse-hardening M3 (02)
- **Evidence:** `package.json:51` `"xlsx": "^0.18.5"`; lockfile → `0.18.5` (frozen npm build). `npm audit`: `xlsx | high | range=* | fixAvailable=false` (`GHSA-4r6h-8v6p-xvw6`/CVE-2023-30533 prototype pollution; `GHSA-5pgg-2g8v-p4x9`/CVE-2024-22363 ReDoS). Parse entry `src/utils/xlsx.js:115-152` (`XLSX.read` then `sheet_to_json`), reached from `src/dashboard/commissions/CommissionPanel.jsx:13,231,536-539`. No file-size cap (`file.arrayBuffer()` on any size, `xlsx.js:124`) and no MIME/extension validation (`accept=".xlsx,.xls"` is not browser-enforced).
- **Impact:** Parsing is **client-side, in the distributor's own tab**, on a self-selected file (no server route parses uploads — confirmed). Practical exploit surface in this demo is **low** (attacker == victim == trusted session; a gadget only corrupts the uploader's ephemeral page). But it is a genuine vuln with no npm fix path, shipped in the prod bundle, and the threat model degrades the moment a tampered third-party "settlement" file is opened. Must not be silently accepted.
- **Recommendation:** Switch to the SheetJS-maintained CDN build (`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz"`) which carries the fixes the npm version never received — same API, removes the audit finding, shrinks the 429 kB chunk; **or** replace with a narrower parser (the app only needs header-keyed rows from sheet 1 + AOA write). Defense-in-depth: add a byte-size cap before `file.arrayBuffer()` (reject > ~5 MB), validate MIME/extension, and pass `{ sheetRows: <cap> }` to `XLSX.read`. Verify `npm run build` + `src/utils/__tests__/xlsx.test.js` pass.
- **Effort:** S (CDN swap + caps) / M (replace parser).

### MEDIUM

#### BL-15 — `notifications.ref_id` has no FK to `settlement_batches.id` → orphan on batch delete
- **Classification:** quality/tech-debt · **Severity:** Medium · **Source:** F-5 (01), SEED-A2 (00)
- **Evidence:** `supabase/migrations/0031_notifications.sql:32` `ref_id TEXT` (no `REFERENCES`); live `pg_constraint` confirms only a PK. `apply_settlement` stores the batch id by convention (`:186,201`).
- **Impact:** A deleted/re-seeded batch leaves notifications pointing at a non-existent batch (latent integrity gap; low blast radius in the append-only demo).
- **Recommendation:** Add `ref_id TEXT REFERENCES public.settlement_batches(id) ON DELETE SET NULL`, or document it as an intentional soft denorm in `BACKEND.md`.
- **Effort:** XS.

#### BL-16 — All 8 KYC mock routes omit `Cache-Control: no-store` (contradicts BACKEND.md §15c; PII responses cacheable)
- **Classification:** quality/tech-debt · **Severity:** Medium · **Source:** M1 (02)
- **Evidence:** No `Cache-Control` in `api/kyc/{otp-send,otp-verify,id-ocr,id-quality,face-match,aml-screen,nira-verify}.ts` (grep = 0). Contrast: all 4 `api/auth/*`, `api/contact.ts:30,36`, `api/chat.ts:247,254`, `api/kyc/agent-referral.ts:46,52` do set it. `id-ocr` returns identity PII (`api/kyc/id-ocr.ts:40-48`). `BACKEND.md §15c` claims the KYC tests cover `no-store`, but only `agent-referral.test.ts` asserts it.
- **Impact:** Documentation-drift + cacheable PII/verification responses. (KYC being mocked is demo-scope; the missing header is not.)
- **Recommendation:** Add `res.setHeader('Cache-Control','no-store')` at the top of each of the 7 mock handlers; add the header assertion to their tests so §15c becomes accurate.
- **Effort:** S.

#### BL-17 — `change-password` runs bcrypt + DB write with no rate limiter
- **Classification:** quality/tech-debt · **Severity:** Medium · **Source:** M4 (02)
- **Evidence:** Mount `server/index.ts:130` (no limiter); handler verifies JWT then `verifyPassword` bcrypt (`api/auth/change-password.ts:122`) + UPDATE (`:131-135`). Contrast `verify-otp`/`verify-password` carry `authLimiter` (`server/index.ts:128-129`).
- **Impact:** A holder of one valid 24h token can hammer the endpoint (≈80 ms bcrypt + DB per call) — an unmetered CPU/DB cost path and a current-password brute-force surface for an already-authenticated attacker. The one credential-verification route without a limiter, inconsistent with the deliberate placement elsewhere.
- **Recommendation:** Attach `authLimiter` to the `change-password` mount. (Do **not** propose a real lockout/HIBP flow — out of demo scope.)
- **Effort:** XS.

#### BL-18 — Notification body is an unformatted raw amount + bad pluralization (`UGX 5000 paid for 1 commissions.`)
- **Classification:** quality/tech-debt · **Severity:** Medium · **Merges:** D-M5 (04), L-C2 (03)
- **Evidence:** RPC builds the body by raw concat `'UGX ' || v_amount_paid || ' paid for ' || v_line_count || ' commissions.'` (`0031:184,199`); mock mirrors it (`src/services/notifications.js:184`; seed rows `src/data/mockData.js:894,906,918`). `NotificationList`/`NotificationCenterCard` render `n.body` verbatim. `ref_id`→`refId` is carried but never rendered (dead in UI).
- **Impact:** The single most-seen string in the flagship feature reads `UGX 5000` (no thousands separator) and `1 commissions` — inconsistent with `formatUGX` used two panels away; would also surface a fractional amount verbatim if BL-8 feeds one in.
- **Recommendation:** Build the display string client-side from the structured `amount`/`type`/`lineCount` fields so `formatUGX` + pluralization live in one place (the stored `body` becomes optional), or at minimum format the amount and fix pluralization in both the RPC and the mock.
- **Effort:** S.

#### BL-19 — Settlement skip/mismatch guidance is opaque; server-side `no_due` skips are invisible
- **Classification:** quality/tech-debt · **Severity:** Medium · **Source:** UX-M1 (05)
- **Evidence:** Skip reasons surfaced as terse labels (`CommissionPanel.jsx:372-376,887-903`); the RPC's `'no_due'` reason (`0031` ~`:144`) isn't in `skippedReasonLabel`, and post-RPC `result.skipped` is summarized only as a count in a toast (`:248-251`). Parse-failure toast is generic ("Couldn't read the file — use the downloaded template.", `:233`).
- **Impact:** When rows skip (renamed headers, blank Amount Paid, already-cleared dues), the distributor sees only a count + one-word reason with no row/agent name and no fix path — reads as "the upload half-worked and I don't know why."
- **Recommendation:** Expand the skip panel with the agent name + a concrete fix; add `'no_due'` to `skippedReasonLabel`; surface post-RPC `result.skipped` reasons; echo the offending header set on parse-mapping failure.
- **Effort:** S.

#### BL-20 — Settlement confirm affordance + copy understate consequence (no friction proportional to risk)
- **Classification:** quality/tech-debt · **Severity:** Medium · **Merges:** UX-M2 (05), UX-L3 (05)
- **Evidence:** Mismatch block uses `data-action="reject"` styling (`CommissionPanel.jsx:870`) but the confirm button stays standard primary regardless of mismatches (`:917-923`); modal hint says "Marks the matched due commissions as paid" (`:857-859`) though the op clears **all** the agent's due lines.
- **Impact:** A destructive-leaning action (clear all due lines despite a mismatch) gets the same one-click affordance as a clean settlement; copy implies a selective match. Reinforces BL-1.
- **Recommendation:** When `mismatches.length > 0`, restyle confirm to a cautionary variant + relabel ("Settle despite mismatches"); reword the hint to "Marks **all** outstanding due commissions for these agents as paid." Pairs with BL-1.
- **Effort:** XS–S.

#### BL-21 — Notification popover is `role="dialog"` but has no focus trap / focus move / focus restore
- **Classification:** quality/tech-debt (a11y) · **Severity:** Medium · **Source:** UX-M4 (05)
- **Evidence:** `src/components/notifications/NotificationBell.jsx:100-104` is `role="dialog" aria-label="Notifications"` but uses only `useOutsideClick` + Escape; no focus trap, no initial focus move, no focus restore to the bell — unlike the shared `Modal` primitive (`src/components/Modal.jsx:120-188`). Affects agent + branch.
- **Impact:** Opening the bell by keyboard leaves focus on the bell; Tab walks into the page behind the open dialog. A non-modal, non-focus-managed `role="dialog"` is an ARIA contract violation.
- **Recommendation:** Downgrade to a non-modal disclosure (drop `role="dialog"`, keep `aria-label` + the existing `aria-expanded` trigger) — lightest and honest for a popover — **or** reuse the `Modal` primitive's focus management.
- **Effort:** S.

#### BL-22 — Signup wizard step position not persisted; mid-flow refresh drops to step 1
- **Classification:** quality/tech-debt · **Severity:** Medium · **Source:** UX-M5 (05)
- **Evidence:** `stepId` is component-local `useState('id-upload')` (`src/signup/SignupPage.jsx:30`), not written to `SignupContext`/localStorage; `SignupContext` persists data fields but no step pointer (`src/signup/SignupContext.jsx:159,188-193`).
- **Impact:** A refresh on, say, the Consent step restarts at "Scan your ID." Data rehydrates (faster re-walk), but the user must traverse all steps again. On a sales demo a stray refresh resets visible progress to zero. (File re-upload on refresh is documented demo-scope; the step reset is not.)
- **Recommendation:** Persist `stepId` into `SignupContext` and rehydrate on mount, clamping to the first step that still needs a re-upload (preserves the documented "re-upload files" behaviour while keeping wizard position).
- **Effort:** S.

#### BL-23 — `apply_settlement`/`settlement_batches` owned across the 0030/0031 boundary; partial-rollback order undocumented
- **Classification:** quality/tech-debt · **Severity:** Medium→Low · **Source:** F-8 (01), SEED-A3 (00)
- **Evidence:** `settlement_batches` created in 0030; its only writer `apply_settlement` defined in **0031** (`0031:93-217`). `0030.down.sql` doesn't drop the RPC; `0031.down.sql:13` does. Rolling back only 0030 while keeping 0031 leaves `apply_settlement` referencing a dropped table.
- **Impact:** Internally consistent for full-trio rollback (documented order), but the cross-migration coupling is surprising and partial-rollback ordering is undocumented. Low real-world risk (down files are emergency-use).
- **Recommendation:** Document in `BACKEND.md §11` that 0030/0031 roll back as a pair, 0031-then-0030. No code change.
- **Effort:** XS.

#### BL-24 — `distributors` is the only table with RLS enabled but not FORCE'd
- **Classification:** quality/tech-debt · **Severity:** Medium→Low · **Source:** F-9 (01)
- **Evidence:** Live `pg_class`: 20/21 tables `relforcerowsecurity=true`; `distributors` has `relrowsecurity=true, relforcerowsecurity=false`. Origin `0016_distributors_table.sql:35` (ENABLE only, no FORCE).
- **Impact:** Without FORCE, the table owner bypasses RLS on `distributors`. All writes go through service-role/DEFINER paths, so practical exposure is minimal, but it's an inconsistency and a latent unscoped-read path. Low-sensitivity table (`d-001`/`d-002` singletons).
- **Recommendation:** `ALTER TABLE public.distributors FORCE ROW LEVEL SECURITY;` in a new forward migration.
- **Effort:** XS.

#### BL-25 — `listSettlements` does an N+1 JS join over agents/branches; `'Unknown'` fallback hides renamed/deleted entities
- **Classification:** quality/tech-debt · **Severity:** Medium · **Source:** D-M2 (04)
- **Evidence:** `src/services/commissions.js:394-436` selects `settlement_batches` then two follow-up `.in('id', …)` queries on agents/branches (repeated by `getAgentCommissionList :162-169`, `getPendingDuesByAgent :289-297`, `getPendingDuesByBranch :336-339`); `settlement_batches` stores no denormalized name (`0030:18-28`); null join → `'Unknown'` (`:426-428`).
- **Impact:** Functionally correct and bounded (`limit:20`), so not a scale risk in the demo, but one panel open fires several repeated round-trips re-resolving the same agents/branches, and a renamed/deleted agent silently shows "Unknown" with no signal.
- **Recommendation:** Fold name resolution into a single shared cached query or a small read RPC (`get_settlements(p_branch_id, p_limit)`) that joins server-side, mirroring the other read RPCs. Acceptable as-is for the demo.
- **Effort:** S–M.

#### BL-26 — Sentry has no `beforeSend`/scrubber and no `release`/`environment` tag (latent §7 PII surface)
- **Classification:** quality/tech-debt (observability + §7) · **Severity:** Medium · **Source:** H-4 (08)
- **Evidence:** Frontend init `src/main.jsx:18-23` and backend init `server/index.ts:17-19` are `{ dsn, tracesSampleRate: 0.1 }` only — no `beforeSend`, no `release`/`environment`. PII vectors: `users.id = \`${role}:${phone}\`` becomes the JWT `sub` (`api/auth/verify-otp.ts:80-81`); Supabase error objects forwarded to Sentry can embed phone-bearing `users.id`. Mitigating: Sentry v8 defaults `sendDefaultPii=false` and strips `Authorization`/cookies — so the default does **not** auto-capture the JWT today.
- **Impact:** No active leak today (DSN gated, defaults safe). Risk is fragility: a future `sendDefaultPii:true`/Replay/`beforeBreadcrumb` would ship phone numbers / JWT subjects with no scrubber; error detail can already carry `role:phone` ids. No `release`/`environment` → events can't be tied to a deploy or split prod/preview.
- **Recommendation:** Add a `beforeSend`/`beforeBreadcrumb` to both inits that redacts `+25671…`-shaped substrings and `role:phone` ids from messages/breadcrumbs/`request.data`, assert auth headers stripped, keep `sendDefaultPii:false`, and add `release` (build SHA) + `environment`. Observability hardening, not a real integration — in scope.
- **Effort:** S.

#### BL-27 — `vercel` CLI devDependency drags in ~25 of 37 audit vulns and is invoked by nothing
- **Classification:** quality/tech-debt (supply-chain hygiene) · **Severity:** Medium · **Merges:** H-2 (08), G-10 (07), SEED-H3 (00)
- **Evidence:** `package.json:82` `"vercel": "^54.0.0"`; ~25 of 37 audit lines trace to the `@vercel/*` tree (fixable only via semver-major `vercel`). No CLI invocation in `package.json` scripts, `.github/workflows/*`, or `vercel.json`; deploys go through the GitHub App. **Distinct from `@vercel/node` (`:69`)**, which IS used for handler types — keep it.
- **Impact:** 25 high/moderate audit lines of dev-only CLI tooling never shipped anywhere, obscuring the findings that matter and costing reviewer time each cutover.
- **Recommendation:** Remove `vercel` from devDependencies; re-run `npm install` + `npm audit` (drops ~37 → ~a dozen). Keep `@vercel/node`. Verify `build`/`build:api`/E2E still pass.
- **Effort:** XS–S.

#### BL-28 — Fixable-without-major audit bumps left unpinned (`vite`, `d3-color`/`d3-interpolate`, `postcss`, `brace-expansion`, `tar`)
- **Classification:** quality/tech-debt · **Severity:** Medium · **Merges:** H-3 (08), SEED-H4 (00)
- **Evidence:** From `npm audit` (all `fixAvailable=true`): `vite ≤6.4.1` (dev-server path traversal / arbitrary file read, declared `^6.3.5`); `d3-color <3.1.0` + `d3-interpolate` ReDoS (**ships in `vendor-charts` via recharts**); `postcss <8.5.10` (build-time XSS in stringify); `brace-expansion <1.1.13`; `tar ≤7.5.10` (goes away with BL-27).
- **Impact:** The `d3-color` ReDoS actually ships to the browser; `vite`'s dev-server flaw is reachable while `npm run dev:all` is up on a shared demo network. Rest are build/test-time. All one-bump fixes, no semver-major churn.
- **Recommendation:** After BL-27, bump `vite` to the latest patched 6.x and `npm audit fix` (no `--force`) or add `overrides` for the transitives. Re-run `build` + `test`.
- **Effort:** S.

#### BL-29 — No frontend Sentry source-map pipeline → captured stack traces are minified/unactionable
- **Classification:** quality/tech-debt (observability) · **Severity:** Medium · **Source:** H-5 (08)
- **Evidence:** `vite.config.js` has no `build.sourcemap` (defaults `false`); frontend Sentry captures from `src/main.jsx:18-23` + `src/components/ErrorBoundary.jsx:20-22` with no maps and no `@sentry/vite-plugin`; no `release` set (BL-26).
- **Impact:** If a prod DSN is ever enabled, frontend reports are a wall of `index-abc123.js:1:48211` frames — Sentry effectively useless on the frontend. (Backend `@sentry/node` traces are fine.)
- **Recommendation:** Given the demo posture, the cheap honest option: document the frontend init as best-effort/minified. If symbolication is wanted, add `@sentry/vite-plugin` with token-gated upload + `release` and `build.sourcemap: 'hidden'`. Don't over-build.
- **Effort:** S (doc) / M (plugin).

### LOW

#### BL-30 — Stale `eslint-disable react-hooks/refs` directive in `AuthContext`
- **Classification:** quality/tech-debt · **Severity:** Low · **Merges:** L-C1 (03), SEED-C1 (00); CI angle H3 (06)
- **Evidence:** `src/contexts/AuthContext.jsx:121` — `npx eslint 'src/**/*.{js,jsx}'` reports `warning Unused eslint-disable directive`. `CLAUDE.md §3` says this was meant to be cleared in audit Phase 6.
- **Impact:** The one residual source-lint warning (besides the expected TanStack Virtual one). Cosmetic, but would flip to a hard CI failure under `--max-warnings 0`.
- **Recommendation:** Remove the unused directive line.
- **Effort:** XS.

#### BL-31 — `npm run lint` fails (572 errors) on the gitignored `playwright-report/` artifacts
- **Classification:** quality/tech-debt (config) · **Severity:** Low–Medium · **Merges:** G-04 (07), SEED-G1 (00); CI angle H3 (06)
- **Evidence:** `package.json:17` `"lint": "eslint ."`; `eslint.config.js:8` `globalIgnores(['dist','dist-server','coverage','.claude/worktrees/**'])` omits `playwright-report/`; `.gitignore:45` gitignores it but ESLint doesn't honor `.gitignore`. `npx eslint .` → 574 problems (572 from `playwright-report/trace/*.js`); `npx eslint 'src/**/*.{js,jsx}'` → 0 errors, 2 warnings.
- **Impact:** Any dev (or local pre-push) with a `playwright-report/` present gets a false exit-1, masking the real source state and contradicting `CLAUDE.md §3`. CI survives only by checking out fresh — fragile.
- **Recommendation:** Add `'playwright-report/**'` and `'test-results/**'` to `globalIgnores` in `eslint.config.js:8`. One-line fix; makes the lint gate deterministic.
- **Effort:** XS.

#### BL-32 — Tracked file is `claude.md` (lowercase); no `CLAUDE.md` in the git index
- **Classification:** quality/tech-debt · **Severity:** Low–Medium · **Merges:** G-05 (07), SEED-G3 (00)
- **Evidence:** `git ls-files | grep -i claude.md` → only `claude.md`; on disk both names share inode `21577157` (APFS case-insensitive). `git status` shows ` M claude.md`.
- **Impact:** On case-sensitive Linux (Vercel/Render/GHA/Linux checkouts) only `claude.md` exists — any tool/doc-link expecting `CLAUDE.md` 404s, and a future case-sensitive commit of `CLAUDE.md` would create a colliding second file. No runtime consumer today.
- **Recommendation:** `git mv claude.md CLAUDE.md` (two-step on macOS) to settle on the GitHub-special-file convention.
- **Effort:** XS.

#### BL-33 — `formatUGXShort` returns misleading "0K"/"1K" for sub-1,000 values
- **Classification:** quality/tech-debt · **Severity:** Low · **Source:** L-C3 (03)
- **Evidence:** `src/utils/currency.js:65-70` always `${(n/1e3).toFixed(0)}K` for `0<n<1e6` → `formatUGXShort(500)`→`"1K"`, `(400)`→`"0K"`. Sibling `formatUGX` guards this (`:35-37`). `currency.test.js:97-116` only tests ≥1000.
- **Impact:** Latent — current callers floor at 5,000 contributions so the edge isn't hit, but any future sub-1,000 value renders misleadingly.
- **Recommendation:** Mirror the `formatUGX` guard (`n<1e3` → exact rounded). Add a sub-1,000 test.
- **Effort:** XS.

#### BL-34 — `finance.js` core money/frequency helpers are effectively untested
- **Classification:** quality/tech-debt · **Severity:** Low–Medium · **Source:** M-C3 (03)
- **Evidence:** `src/utils/__tests__/finance.test.js` tests only `formatUGX`/`fmtShort` shims, not `parseAmount`, `normalizeFrequency`, `periodsPerYear`, `monthlyEquivalent`, `calcFV`, `sliderToAmt`, `amtToSlider` — the actual money/frequency logic used across Save/Withdraw/Claim/ContributionSettings.
- **Impact:** The most safety-critical pure functions ship untested; a single `parseAmount("1.5")` assertion would have caught the BL-8 decimal footgun.
- **Recommendation:** Add `finance.test.js` cases for `parseAmount` (grouping/currency/decimal/negative/empty→null), `normalizeFrequency` (every alias + unknown fallback), `periodsPerYear`, `monthlyEquivalent` (zero/negative), `calcFV` (0 years). Bundle with BL-8.
- **Effort:** S.

#### BL-35 — `useOutsideClick` re-subscribes document listeners every render (NotificationBell)
- **Classification:** quality/tech-debt · **Severity:** Low–Medium · **Source:** M-C4 (03)
- **Evidence:** `src/hooks/useOutsideClick.js:30` depends on `[active, onOutside, refs]`; `src/components/notifications/NotificationBell.jsx:62` passes a fresh array literal each render (`portal ? [wrapRef, popoverRef] : [wrapRef]`), so the effect tears down + re-adds `mousedown`/`keydown` on every render while open (e.g. during the 30s poll). Same class as previously-fixed F23/F24.
- **Impact:** Listener churn + a latent close-then-reopen race the hook is meant to prevent.
- **Recommendation:** `useMemo` the refs array (`[portal]` dep) before passing it; apply anywhere else the hook is called with an inline array.
- **Effort:** XS.

#### BL-36 — `getCommissionSubscribers` live path returns placeholder `lastContribution:0` / `lastContributionDate:''`
- **Classification:** quality/tech-debt · **Severity:** Low · **Source:** D-L2 (04)
- **Evidence:** Live `src/services/commissions.js:267-268` (placeholder, "not surfaced by current schema"); mock fabricates values (`:568-571`); consumer renders `Last: {formatDate(sub.lastContributionDate)}` (`CommissionPanel.jsx:827`) → formats `''` in live mode.
- **Impact:** In live mode the per-agent subscribers drill-down shows an empty/`Invalid Date` "Last:" value; mock shows a plausible date. Minor drift in a deep drill-down, not on the settlement path.
- **Recommendation:** Populate `lastContributionDate` from a real read, or hide the "Last:" line when empty (verify `formatDate('')` degrades gracefully).
- **Effort:** S.

#### BL-37 — `formatRelativeTime` called without a `now` anchor in the notification feed (mock-mode drift)
- **Classification:** quality/tech-debt · **Severity:** Low · **Source:** L-C5 (03)
- **Evidence:** `src/components/notifications/NotificationList.jsx:72` calls `formatRelativeTime(n.createdAt)` with no `{ now }`, defaulting to the real wall clock (`date.js:75`); mock-seed notifications are anchored to `MOCK_NOW` (`mockData.js:898`).
- **Impact:** In mock mode the relative-time labels compute against today's wall clock, drifting from the rest of the MOCK_NOW-anchored copy. Live mode (real `createdAt`) is fine.
- **Recommendation:** Thread the demo clock (`currentTime()`) as a `now` prop in mock mode, or accept the drift and note it.
- **Effort:** XS.

#### BL-38 — Signup `done` step is unreachable dead code in the wizard switch
- **Classification:** quality/tech-debt · **Severity:** Low · **Source:** UX-L1 (05)
- **Evidence:** `STEPS` includes `{ id:'done' }` with a completion ring (`src/signup/SignupShell.jsx:17,117-131`), but `renderStep()` has no `case 'done'` → `default: return null` (`src/signup/SignupPage.jsx:157-159`); the flow navigates to `/signup/contribution` from consent instead (`:149`).
- **Impact:** None today; a future contributor wiring `goNext()` past consent lands on a blank screen.
- **Recommendation:** Remove `'done'` from `STEPS` (and its ring path) or wire a real terminal step; document consent→contribution as the terminal transition.
- **Effort:** XS.

#### BL-39 — Minor quality/doc/test cleanups (bundled)
- **Classification:** quality/tech-debt · **Severity:** Low
- **Items + evidence:**
  - **`toCsvStream` unparenthesized `&&`/`||` guard** — `src/utils/csv.js:106`. Parenthesize for clarity. *(L-C4, 03)*
  - **Notification badge a11y inconsistency** — bell exposes count via button `aria-label` (`NotificationBell.jsx:121-130`) vs card via badge `aria-label` (`NotificationCenterCard.jsx:55`); standardize. *(UX-L2, 05)*
  - **`parseAmount` (settlement) silently coerces malformed strings** (`"1-2"`→NaN) with an opaque `no_amount` skip — `src/utils/settlement.js:102-107,80-84`. Tighten regex + specific skip reason. *(L1, 02)*
  - **Orphaned `eslint-disable` in `personas.ts`** — `api/auth/_lib/personas.ts:25` (precedes a non-`any` import). Remove. *(L2, 02)*
  - **`verify-otp`/`verify-password` generic catch returns HTTP 500 with a 4xx code** (`invalid_otp`/`invalid_request`) — `api/auth/verify-otp.ts:238-239`, `verify-password.ts:192`. Use a distinct `unexpected_error`. *(M5, 02 — Medium-leaning but low blast radius)*
  - **`subscriber-write-failures` only truly verifies 1 of 6 write surfaces** (rest are `expect.soft` reachability) — `e2e/specs/regression/subscriber-write-failures.spec.ts:56-104,135-255`. Add one more real 500→toast surface (e.g. Schedule). *(M5, 06)*
  - **No regression spec pins the two known StubPage routes / nominee-sum** — add a tiny spec. *(M4, 06)*
  - **`keepalive.yml` placeholder Render hostname + no failure alerting** — `.github/workflows/keepalive.yml:8-11,29`. Confirm the live hostname pre-cutover (manual check). *(M3, 06; G-09, 07; H-9, 08)*
- **Effort:** S total (independent XS items).

---

## 3. Cross-cutting themes

1. **Money-math / rounding (BL-1, BL-2, BL-8, BL-18).** The single highest-density theme. The settlement path lets fractional UGX in (two divergent `parseAmount`, no FE/RPC rounding, unconstrained `NUMERIC`), stamps the batch total onto every line, and over-clears on partial payments — then surfaces the result in an unformatted notification string. These are layers of the same flow and should be fixed as **one coordinated change** (parser → RPC → read RPC → agent UI → notification body), not piecemeal.

2. **Contract drift between layers — mostly *clean*, with two real gaps.** Shape parity across `service ↔ RPC ↔ mock` is sound (verified field-for-field in 04); no leftover dispute/run fields survive the collapse. The drift that *does* exist: (a) the agent UI ignores the `paidAmount` the contract already carries (BL-1/BL-2), and (b) the notification **feed list** isn't on the same refresh cadence as the **badge** (BL-11), so two cache entries for "unread" disagree. The mock-vs-live fidelity gaps (district/region rollup via `parentId`, `lastContribution` placeholder) are low-risk because `VITE_USE_SUPABASE=false` is break-glass, not a demo default.

3. **Doc drift vs §11 lockstep.** Specialist docs (BACKEND/FRONTEND/ARCHITECTURE/docs/*) *were* updated with the feature — good. The laggards: `claude.md` `MOCK_NOW` (says `(2026,3,8)`, actual `(2026,4,26)`), the X13 known-bug entry (resolved but still listed), `README.md` migration count (28 vs 31) and a self-referential stale README-staleness note, FRONTEND.md test counts (40/707 vs 43/717) + the obsolete "coverage-v8 not installed" note + stale §5/§7 file-count headers. All low-impact but they undermine the "already-known" cross-reference this audit depends on. (BL-39 + M-C2/L3/G-08.)

4. **Missing constraints / DB hardening.** `notifications.ref_id` has no FK (BL-15); money columns are unconstrained `NUMERIC` (BL-8); `distributors` lacks FORCE RLS (BL-24); `settlement_batches` FKs have no `ON DELETE` (Appendix B, F-12); `nominees` still has no `UNIQUE(subscriber_id,type)` (already-known). None corrupt the seeded demo data; they are latent integrity gaps mostly held in check by the all-writes-through-RPC discipline.

5. **File-parse safety.** `xlsx@0.18.5` (no npm fix, CVEs) + no size cap + no MIME check on the distributor upload (BL-14). Client-side-only and self-uploaded → low practical surface, but a real vuln in the prod bundle; the CDN-build swap fixes the audit line and shrinks the 429 kB chunk for free.

6. **Cutover-process risk is the real story, not in-demo data corruption.** The DB role-gating and RLS are sound; the schema state matches the files. What's fragile is the *path to production*: a stale Render deploy branch (BL-7), a drifted migration ledger (BL-6), a lossy rollback boundary needing a backup (BL-9), a large uncommitted release (BL-10), and an E2E gate that no longer protects the shipped feature (BL-3). These are process/release-hygiene gates, and they are exactly what a cutover go/no-go must enforce.

---

## 4. Recommended remediation sequence (fix-clusters) + GO/NO-GO

Grouped so each cluster is a single-responsibility unit suitable for one fix-agent (Phase 4). Clusters marked **[GATE]** must complete (or be explicitly accepted by the user) before the `feat/simplify-commissions → main` cutover.

### Cluster 1 — Settlement money correctness [GATE for the data-integrity items]
BL-1 (block-or-implement partial payment), BL-2 (per-line `paid_amount`), BL-8 (rounding + unify `parseAmount`), BL-18 (notification body format/pluralize), BL-20 (affordance/copy), BL-34 (finance tests).
*One coordinated change across `settlement.js`/`commissions.js`/`finance.js`/`CommissionPanel.jsx`/`apply_settlement`/`get_agent_commission_detail`/notification body. Verify with new unit tests + the Cluster 5 E2E.*

### Cluster 2 — Settlement reliability + chat [GATE: BL-13]
BL-13 (idempotency nonce — RPC + client), BL-12 (`/api/chat` `app_role` one-liner + test), BL-19 (skip-reason guidance).

### Cluster 3 — Support-ticket routing [GATE: BL-4, BL-5]
BL-4 (route from live `agent_id`/`branch_id`; no false success toast), BL-5 (Agent/Tickets empty/error states). Single subscriber-flow unit.

### Cluster 4 — Notification feed freshness + a11y
BL-11 (feed `refetchInterval` + single source for unread count), BL-21 (popover focus/disclosure), BL-35 (memoize refs), BL-37 (mock-mode `now`).

### Cluster 5 — E2E + CI trust [GATE: BL-3]
BL-3 (delete stale specs, rewrite invariants to two-state, re-anchor modal-escape, add the new `apply_settlement`/notification flow spec), BL-31 (eslint ignores), BL-30 (stale directive), plus the BL-39 test items.

### Cluster 6 — DB hardening (forward-only migrations)
BL-15 (`ref_id` FK), BL-24 (`distributors` FORCE), BL-6 reconcile (also Cluster 8), BL-23 (doc rollback order), Appendix-B F-12 (FK `ON DELETE`), F-10 (`search_path` normalization), F-17 (unused-index re-check later).

### Cluster 7 — Supply-chain + observability
BL-27 (drop `vercel` CLI), BL-28 (audit-fix bumps), BL-14 (xlsx CDN build + parse caps/MIME), BL-26 (Sentry scrubber + release), BL-29 (source-map decision). Run BL-27 first (collapses transitive roots), then BL-28.

### Cluster 8 — Cutover runbook / release hygiene [GATE: all]
BL-7 (swap `render.yaml` branch), BL-10 (commit as one coherent build-verified unit), BL-9 (verified prod backup), BL-6 (ledger reconcile/decision in `BACKEND.md §16`), BL-39 keepalive hostname confirm, doc-drift refresh (`claude.md` MOCK_NOW, README counts, FRONTEND.md counts).

### Cluster 9 — Lower-priority polish (post-cutover)
BL-16 (KYC `no-store`), BL-17 (`change-password` limiter), BL-22 (signup step persistence), BL-25 (settlement N+1), BL-32 (claude.md case), BL-33 (formatUGXShort), BL-36 (lastContribution placeholder), BL-38 (dead `done` step), residual BL-39 nits.

### GO / NO-GO list for `feat/simplify-commissions → main`

**MUST precede cutover (NO-GO until done or explicitly accepted):**
1. **BL-3** — fix the broken/stale E2E gate + add real coverage for the new flow (else CI is red or falsely green for the feature being shipped). *(Cluster 5)*
2. **BL-6** — reconcile the migration ledger or document `db push` is not the deploy path (else a future push can half-apply). *(Cluster 8)*
3. **BL-7** — swap `render.yaml` to `branch: main` (else the next manual Render deploy ships the stale branch). *(Cluster 8)*
4. **BL-9** — verified prod backup before relying on the lossy `0029` rollback boundary. *(Cluster 8)*
5. **BL-10** — stage the release as one coherent, build-verified commit. *(Cluster 8)*
6. **BL-1** — resolve partial-payment over-clear (block or implement true partial), or **explicitly accept** the documented all-or-nothing-per-agent behavior. *(Cluster 1)* — corrupts demo commission data if left as-is.

**STRONGLY RECOMMENDED before cutover (visible in a normal demo, but not data-corrupting / not process-gating):**
- **BL-2** (per-line `paid_amount`), **BL-8** (fractional UGX), **BL-13** (idempotency), **BL-12** (chat role), **BL-4 / BL-5** (ticket routing/spinner), **BL-11** (notification feed staleness), **BL-18** (notification body).

**NOT a cutover gate (backlog):** BL-14 (xlsx — low surface in client-only demo), BL-15–BL-39 (hygiene/observability/a11y/polish), and everything in Appendices A–C.

---

## Appendix A — Intentional demo-scope (considered, never reported as bugs)

Spot-checked against `CLAUDE.md §10a` to confirm nothing actionable is mislabeled (see quality-gate note below):

- Mocked OTP (any 6-digit code accepted), all 8 KYC mock routes, hardcoded UGX 1,000 unit price, fixed 24h HS256 JWT with no refresh — §10a. *(Note: BL-16 KYC `no-store` and BL-17 `change-password` limiter are NOT demo-scope — they are quality/security hygiene on top of the mocks.)*
- `demo_personas` fallback IDs (`a-001`/`b-kam-015`/`d-001`) — §10a.
- In-memory tickets + chat stores (no DB table); `resolveRouting` permission boundaries client-only **by design** — §10a. *(BL-4 is the live `agent_id` *routing source*, which is a real bug, not the in-memory store itself.)*
- Notifications via 30s polling, no realtime publication — §10a / glossary. *(BL-11 is the list-not-polling gap within that model, a real inconsistency.)*
- Per-session mutation stores (`entities._entityOverrides`, `subscriber._sessionMutations`), `MOCK_NOW` anchoring, mock chat replies, `VITE_USE_SUPABASE=false` fallback — §10a/§10b.
- No payment processor / "Pay now" demonstrates flow only — §10a.
- No-Origin requests bypass CORS; mocked OTP/KYC have no rate limiting/lockout — §15a (L4, 02).
- Signup files dropped on refresh (user re-uploads) — §5. *(BL-22, the step-position reset, is a distinct quality item.)*
- KYC force-failure E2E mechanism + mocked-OTP "lockout" UI spec — §10a (06 demo-scope items).
- `config.toml [auth]` (`jwt_expiry`/`min_password_length`) is local-emulator-only, inert for the custom HS256 design — G-12 (07).

**Quality-gate spot-check (5 items vs §10a):** (1) BL-16 KYC `no-store` — the *mocking* is §10a, the *missing header* is not → correctly Medium quality, not demo-scope. (2) BL-4 ticket routing — the *in-memory store* is §10a, the *null-agent dead-letter from the wrong routing source* is a real bug → correctly High. (3) BL-11 — *30s polling* is §10a, the *feed list having no poll at all* is an inconsistency within the model → correctly High quality. (4) BL-13 idempotency — not listed in §10a (no payment processor ≠ no idempotency on the demo write) → correctly real-bug. (5) BL-14 xlsx — explicitly excluded from demo-scope by the plan → correctly security real-bug. No actionable item is mislabeled demo-scope.

## Appendix B — Already-known (verified against docs, not re-reported as new)

Cross-referenced against `DASHBOARD_AUDIT*.md`, `docs/audit/*`, `docs/archive/*`, `FRONTEND.md §16b`, `BACKEND.md §15b`:

- **`nominees` no `UNIQUE(subscriber_id,type)`; sum-to-100 only in RPC** — BACKEND.md §15b D9 (F-13, 01).
- **TEXT status columns without CHECK** (`subscribers.kyc_status`, `withdrawals.status`, `claims.status`) — §15b D8. Confirmed `commissions.status` is a real enum, not regressed by 0029 (F-14, 01).
- **Denormalized columns never refreshed** (`commissions.subscriber_name`, `agents.coverage_rate/rating`, `branches.score/rank`); settlement doesn't worsen them — §10b/§15a (F-15, 01).
- **`config.toml` references nonexistent `./seed.sql`** — Agent-A scope note (F-16, 01; G-07, 07). Set `enabled=false` or point at a real file. *(Low; folded into Cluster 8 doc work.)*
- **Legacy migrations 0003/0006/0010/0025 non-idempotent** — §15b D12 (F-7, 01); elevated as the mechanism behind BL-6.
- **Older SECURITY DEFINER RPCs pin `search_path=public` w/o `pg_temp`** — within §16 rule (F-10, 01); consistency nit, pre-0029.
- **`get_entity_metrics_rollup`/`get_top_branch` anon-callable read RPCs** — advisor family; not touched by 0029–0031; scoping governed by 0020 (F-11, 01).
- **`settlement_batches` FKs no `ON DELETE`** (inconsistent w/ commissions) — new but low (F-12, 01). Decide retention policy in Cluster 6.
- **`distributors_update_self` perf advisor is a stale flag** — policy already InitPlan-wrapped (F-18, 01); no action.
- **`SUPABASE_JWT_SECRET` fail-open under `withOptionalAuth`** — render.yaml B21 / render-operational (G-11, 07); awareness, cutover-checklist line.
- **`legacy-peer-deps=true`** — §3 intentional for React-19 tree (H-6, 08); keep, document which peer needs it.
- **`vendor-xlsx` 429 kB chunk** — SEED-H2; already lazy-loaded; shrinks for free with BL-14 (H-7, 08).
- **Sentry version drift `^8.50.0`→`8.55.2`, one major behind** — awareness (H-8, 08); stay on v8.
- **Subscriber Settings Notifications/Security `StubPage`** — §16b (UX cross-ref, 05); BL-39 adds only the missing regression spec.
- **Branch can't edit own branch info; agent-onboard AML hang; ViewSubscribers pagination stall; stale qa.md known-bugs** — DASHBOARD_AUDIT / audit/04-user-flows (05 cross-ref); not re-reported.
- **`agent_dispute_line`/dispute flow removed; X3 moot; X13 contact-shape resolved** — §15b/§16b; X13/MOCK_NOW doc staleness captured as doc-drift (BL-39).

## Appendix C — Pure awareness / production-only (not Critical by demo calibration)

- **`apply_settlement` fractional/partial money in a *real* fintech** would be Critical; here it's a demo-data-consistency bug (BL-1/BL-2/BL-8) — calibrated High/Critical-for-the-flow, not "production money" inflation.
- **Shared-DB E2E race** is mitigated (`--workers=1` + concurrency-cancel); residual cross-ref-run race is awareness (L4, 06).
- **Unused-index candidates** (`idx_subscribers_gender`, 2 `commissions` status indexes) — re-evaluate after the new flow runs in live; new-feature indexes are NOT candidates yet (F-17, 01).
- **55 `multiple_permissive_policies` perf advisors** — the standard role-scoped RLS pattern; clarity-vs-perf tradeoff, not a bug (baseline §5.4).
- **`users.id = role:phone` embeds PII in a PK** — harmless for the synthetic `+25671…` range; awareness if ever productionized (L3, 02; ties to BL-26).

---

*End of report. Phase 3 is the human gate: the user decides which clusters to remediate (Phase 4) — no code changes occur before that gate.*
