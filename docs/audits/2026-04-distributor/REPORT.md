> **Agent guide.** Historical audit from 2026-05-22, covering the distributor-dashboard slowness synthesis across baseline, backend hot-path, frontend perf, and per-role flows — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Universal Pensions Uganda — Audit Synthesis Report

**Date:** 2026-05-22 · **Auditor:** Claude (Opus 4.7) · **Phase:** 6 of 6 (synthesis)
**Plan source:** `/Users/shubhang/.claude/plans/rustling-growing-crab.md`
**Phase reports:**
- [00 — Baseline](./00-baseline.md)
- [01 — Distributor metrics drill](./01-distributor-metrics.md)
- [02 — Backend hot-path](./02-backend-hotpath.md)
- [03 — Frontend perf](./03-frontend-perf.md)
- [04 — User flows per role](./04-user-flows.md)
- [05 — Static + config + security](./05-static.md)

---

## 1. Executive summary

The user reported: **"The distributor dashboard metrics — number of subscribers, AUM, branch-wise data — load slowly and laggy. Audit the entire platform for missing/incorrect logic and broken user flows."**

**Verdict:** The lag is real, reproducible, and has a *named root cause*. The platform's data model is correct, RLS is hardened, JWT claims are clean, and the four built dashboards are wired end-to-end — the platform is healthy in correctness. **The lag is a performance and architectural gap concentrated in two places: the read-side RPCs that drive distributor metrics, and the entity-list pagination that drives most "list these entities" panels.**

### 1.1 Named root cause (the answer to "why is distributor slow?")

**Two-headed lag**, both compounded by **Tokyo (Supabase region `ap-northeast-1`) → Kampala client WAN RTT of 200–400 ms**:

1. **Server head — `public.get_top_branch('country','ug')` is not `SECURITY DEFINER`** and joins the full `transactions` table (522 K rows) against branches × agents with RLS predicates evaluated per row, producing a **61.5 M-row Join Filter** that **exceeds the 8 s `authenticated` statement_timeout** and returns HTTP 500. Postgres logs show 5 statement-timeout cancellations during the Playwright run. `useTopBranch` has no `staleTime` so every window-focus retriggers it.
   *(AUDIT-1-1, AUDIT-1-4, AUDIT-1-8)*

2. **Client head — the distributor home eagerly mounts seven panel components** (CreateBranch, ViewBranches, ViewAgents, ViewSubscribers, ViewReports, CommissionPanel, Settings) which collectively fire **24 simultaneous Supabase requests** at first paint — including a **30-page paginated fetch of all 30,003 subscribers just to display the sidebar count**, and a 600 KB pull of every `subscriber_balances.total_balance` to compute AUM in JavaScript.
   *(AUDIT-1-5, AUDIT-1-6, AUDIT-1-7, AUDIT-1-9, AUDIT-1-10)*

### 1.2 Health bill

| Area | Verdict |
|---|---|
| **Correctness (logic / state machine / RLS / JWT claims)** | Solid. `auth.jwt() ->> 'role'` bug pattern is zero (Phase 2 §B). All commission state-machine transitions match docs (Phase 4). |
| **Security** | 3 of 4 spot-checks passed. One frontend writes directly to `nominees` table — AUDIT-2-3. |
| **Database performance** | Two unindexed seq-scans dominate the workload — `get_top_branch`, `get_entity_metrics_rollup`, plus PostgREST `count: 'exact'` over `subscribers` (911 ms server-side). |
| **Frontend performance** | 849 KB gzipped initial JS for distributor home; ~230 KB is supabase-js transitive baggage (storage-js + auth-js + realtime + decimal.js-light + redux-toolkit + immer) the app doesn't actually use. AUDIT-3-4. |
| **User flows** | Wired. The qa.md "known bugs" list is outdated — 5 of 6 items are FIXED. AUDIT-4-1. |
| **Code hygiene** | Three orphaned `.claude/worktrees/` agent dirs eating disk + inflating ESLint warning count from 3 → 8. AUDIT-5-1. |

### 1.3 Scale numbers (informative)

- Seeded: ~30,003 subscribers, 2,049 agents, 314 branches, 1 distributor.
- pg_stat_statements (8 days uptime): 1,618 distinct statements, **`get_top_branch` consumes 17 minutes of accumulated time alone**.
- Distributor home cold load: 24 Supabase requests at first paint; 63 over the full "open ViewSubscribers" flow (test 2 trace).
- Total findings across phases: **58 unique items** (40 backend/frontend perf + correctness, 12 hygiene, 6 flow).

---

## 2. Findings inventory

### 2.1 By severity

| Severity | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | **Total** |
|---|---|---|---|---|---|---|
| **P0** | 4 (1-1, 1-2, 1-3, 1-5) | 3 (2-1, 2-2, 2-3) | 0 | 0 | 0 | **7** |
| **P1** | 5 (1-4, 1-6, 1-7, 1-8, 1-10) | 4 (2-4, 2-5, 2-6, 2-7) | 5 | 2 (4-1, 4-4) | 2 (5-11 xref, 5-?) | **18** |
| **P2** | 2 (1-9, 1-11) | 4 (2-8, 2-9, 2-10, 2-11) | 6 | 4 (4-3, 4-5, 4-6, 4-7) | 6 | **22** |
| **P3** | 1 (1-12) | 2 (2-12, 2-13) | 3 | 1 (4-2 xref) | 4 (5-3, 5-4, 5-7, 5-8) | **11** |
| **Total** | **12** | **13** | **14** | **7** | **12** | **58** |

P0 = blocker / data-correctness / silent failure. P1 = major UX or developer-experience cost. P2 = annoyance / cleanup that pays back. P3 = cosmetic / docs / micro.

### 2.2 Top 10 by impact × confidence ÷ effort

Scoring rubric (1-5 scale per dimension; score = (impact × confidence) ÷ effort; max = 25):

| Rank | ID | Title | Impact | Conf | Effort | Score |
|---|---|---|---|---|---|---|
| 1 | **AUDIT-1-1** | `get_top_branch` not SECURITY DEFINER + 61.5M-row Join Filter — 8s timeout 500s on cold loads | 5 | 5 | 2 | **12.5** |
| 2 | **AUDIT-1-5** | Sidebar pulls all 30 003 subscribers via 30 paginated pages to display a count label | 5 | 5 | 2 | **12.5** |
| 3 | **AUDIT-2-1** | `count(*) FROM subscribers` 911 ms (RLS seq-scan) — every PostgREST `count: 'exact'` request pays this on top of pagination | 5 | 5 | 2 | **12.5** |
| 4 | **AUDIT-1-2** | `get_entity_metrics_rollup` seq-scans 522K transactions; no `(type, date)` index | 5 | 5 | 2 | **12.5** |
| 5 | **AUDIT-2-2** | `commissions.status` has no index → distributor CommissionPanel pagination seq-scans 30k rows | 5 | 5 | 2 | **12.5** |
| 6 | **AUDIT-1-10** | DashboardShell eagerly mounts 7 panel components → 24 parallel Supabase calls at first paint | 4 | 5 | 3 | **6.7** |
| 7 | **AUDIT-1-3** | Region/district rollup CTE: 360k Memoize evictions + 11 MB disk spill — 7.68 s | 4 | 5 | 3 | **6.7** |
| 8 | **AUDIT-1-7** | `getAllAtLevel('subscriber')` paginates 30 pages on every cold cache — Sidebar + 4 other consumers | 4 | 5 | 3 | **6.7** |
| 9 | **AUDIT-3-4** | Vendor chunk `BoVtWV09` ships 230 KB gzip of supabase-js transitive baggage the app never uses | 4 | 4 | 3 | **5.3** |
| 10 | **AUDIT-2-3** | `src/services/subscriber.js:752,787` does direct `.delete()` + `.insert()` on `nominees` — bypasses RPC contract; CLAUDE.md §5.6 violation; also enables sum>100 % nominees bug | 4 | 5 | 3 | **6.7** |

(Items below rank 10 average score < 5 — long-tail polish.)

### 2.3 Three-line per-phase recap

- **Phase 1** — drilled the user's symptom. Found `get_top_branch` timeouts + 30-page subscriber pagination + 7-panel eager mount. 12 findings.
- **Phase 2** — backend systematic. `auth.jwt()->>'role'` lint CLEAN; `commissions.status` unindexed; `count(*)` seq-scans subscribers; orphan realtime publications. 13 findings.
- **Phase 3** — frontend systematic. Bundle map showed 230 KB of supabase-js transitive baggage; 14 findings. Hard-rule §4.1 (mockData imports) clean.
- **Phase 4** — flows. qa.md is stale (5 of 6 bugs FIXED). 7 findings, 0 P0 (the runtime blocker is Phase 1's ViewSubscribers item, cross-referenced).
- **Phase 5** — static. Orphan `.claude/worktrees/` are linted; ESLint baseline drifted to 8 (from 3). 12 findings.

---

## 3. Remediation: PR-sized chunks (recommended sprint order)

Sized so each chunk is ≤ ~400 LOC of diff and reviewable in one sitting. Order chosen so dependent fixes follow their prerequisites.

### PR-1 — DB perf migration (`0022_audit_perf.sql`)

**Closes:** AUDIT-1-1, AUDIT-1-2, AUDIT-1-3, AUDIT-1-8, AUDIT-2-2 *(+ measurably accelerates AUDIT-1-11 and AUDIT-2-7)*

One migration, four concrete changes:

1. `CREATE INDEX idx_transactions_type_date ON transactions(type, date) WHERE type IN ('contribution', 'withdrawal');` — unlocks the 8-bucket aggregate in `get_entity_metrics_rollup` and removes the 61M-row Join Filter in `get_top_branch`. Partial index keeps it cheap.
2. `CREATE INDEX idx_commissions_status ON commissions(status) WHERE status IN ('due','in_run','disputed','released','paid');` — partial index; the CommissionPanel preload paginate-by-status query goes index scan.
3. Rewrite `get_top_branch` as `SECURITY DEFINER`. New body issues a single CTE that joins `transactions → agents → branches` with the (type, date) index, eliminating the materialized 315K-row scan-per-branch loop.
4. Rewrite `monthly_arr_per_entity` CTE inside `get_entity_metrics_rollup` to compute `(subscriber_id, month_idx, sum(amount))` first via the new index, then aggregate to entity-level — kills the 360K-row CROSS JOIN spill.

**Verify:** rerun the Phase 1 Playwright trace. `pg_stat_statements_reset()` first, then capture 10 minutes of synthetic traffic; mean times for `get_top_branch` and `get_entity_metrics_rollup` must drop below 500 ms.

### PR-2 — Retire `useDistributorMetrics` + Sidebar fixes

**Closes:** AUDIT-1-5, AUDIT-1-6, AUDIT-1-9

1. Delete `useDistributorMetrics` and `getDistributorMetrics()`. Replace every consumer (`MetricsRow.jsx:221`, `OverlayPanel.jsx:387`, `Sidebar.jsx:212-214`) with `useEntityMetrics('country', 'ug')`, which already returns `totalSubscribers / totalAgents / totalBranches / aum` server-side via the rollup RPC (lines 146-149 of migration 0020).
2. AUM 600 KB client-side reduce becomes a single number from the RPC.
3. Sidebar count labels drop their three `useAllEntities('branch'/'agent'/'subscriber')` calls (was: 30-page subscriber pagination just for a label).

**Verify:** distributor `/dashboard` Network panel should show ≤ 6 Supabase requests at first paint (down from 24). The 30-page subscriber pull disappears entirely from the home flow.

### PR-3 — Lazy-mount distributor panels + `staleTime` audit

**Closes:** AUDIT-1-4, AUDIT-1-10, parts of AUDIT-3-* TanStack table

1. Wrap each panel mount in `DashboardShell.jsx` with its `panelOpen` boolean: `{viewBranchesOpen && <ViewBranches />}`, `{commissionPanelOpen && <CommissionPanel />}`, etc.
2. Add `staleTime: 5 * 60 * 1000` to `useTopBranch`, `useCountry`, `useEntity`, `useChildren`, `useAllEntities`, `useAllEntitiesMap`, `useBreadcrumb` (regions/districts/branches change ~never).
3. Optional: prefetch on hover/focus of the sidebar item via `queryClient.prefetchQuery` so first-click opens with a warm cache.

**Verify:** Distributor home → Network panel first-paint requests drops further. Window focus / Alt-Tab no longer triggers `get_top_branch` refire.

### PR-4 — Cursor pagination for entity lists

**Closes:** AUDIT-1-7, AUDIT-2-1 *(+ reduces blast-radius of all `useAllEntities` callers)*

1. Refactor `entities.getAllAtLevel('subscriber')` to use `useInfiniteQuery` with `PostgREST Range: items=0-999` + read `Content-Range` for total-count.
2. `ViewSubscribers.jsx` table-virtualizer's `onEndReached` calls `fetchNextPage`.
3. Header text changes from `"Showing ${arr.length} of ${arr.length} subscribers"` to `"Showing ${loadedCount} of ${total} subscribers"`.
4. Same pattern for agents (2049 → cursor) if used cold; branches (314) is fine as-is.

**Verify:** existing `e2e/specs/flows/distributor-renders-data.spec.ts` test 2 now passes (the "Showing X of Y" assertion within 20 s).

### PR-5 — `nominees` SECURITY DEFINER RPC + sum-to-100 CHECK

**Closes:** AUDIT-2-3, AUDIT-4-6, BACKEND §14b "nominee shares can sum >100%" — two-for-one

1. New RPC `upsert_nominees(p_subscriber_id, p_pension jsonb[], p_insurance jsonb[])` SECURITY DEFINER:
   - In one transaction: delete existing nominees → insert new ones → assert `SUM(share_pct) = 100` per category in a CHECK or post-insert raise.
2. Refactor `src/services/subscriber.js:752,787` to call the RPC instead of direct `.delete()` + `.insert()`.
3. Add a row-level CHECK constraint `(share_pct BETWEEN 0 AND 100)` on `nominees` for defense in depth (the aggregate constraint goes inside the RPC).

**Verify:** server-side, force `nominees.pension` array with 110 % total → RPC raises. Frontend's existing sum-to-100 UI validation now belt-and-suspenders.

### PR-6 — RLS policy flattening + drop unused indexes + RLS InitPlan fix

**Closes:** AUDIT-2-5 (55 multiple_permissive_policies advisor warnings), AUDIT-2-9 (duplicate subscribers(agent_id) index), AUDIT-2-11 (`_demo_now` mutable search_path)

1. Replace the four-way OR'd SELECT policies on the 11 affected tables with one `USING (CASE app_role …)` policy each. Halves the policy-evaluation work per row.
2. `DROP INDEX subscribers_agent_id_idx;` keeping `idx_subscribers_agent_id`.
3. `ALTER FUNCTION _demo_now() SET search_path = pg_catalog, public;` (the lone holdout per migration 0010's intent).
4. Wrap `distributors_update_self` in `(SELECT auth.jwt() ->> 'distributorId')` — the lone policy missing the InitPlan wrap.

**Verify:** `mcp__supabase__get_advisors(performance)` returns zero `multiple_permissive_policies` warnings; rerun pg_stat_statements after to confirm 10-20 % drop in mean read times across `subscribers` / `commissions` / `transactions`.

### PR-7 — Frontend bundle: replace supabase-js with postgrest-js + lazy-load Leaflet

**Closes:** AUDIT-3-4, AUDIT-3-* (landing-page modulepreload)

1. Replace `import { createClient } from '@supabase/supabase-js'` with a direct `postgrest-js` instance + minimal HTTPS auth header. The app uses only `.from()` and `.rpc()`; storage-js / auth-js / realtime / decimal.js-light / redux-toolkit / immer can all go.
2. Code-split Leaflet so the landing page doesn't preload it.

**Estimated saving:** ~200 KB gzip across every dashboard route; landing page initial JS drops ~315 KB gzip.

**Verify:** rebuild + visualize. `vendor-BoVtWV09` chunk should drop from 230 KB → ~30 KB gzip. Lighthouse mobile score should jump 10-15 points.

### PR-8 — Drop realtime publications + clear orphaned worktrees

**Closes:** AUDIT-2-4, AUDIT-5-1

1. **Realtime audit:** Phase 1 + Phase 2 confirmed zero `.channel(` subscribers across `src/`, `api/`. Either drop `commissions` / `settlement_runs` / `settlement_run_branch_reviews` from the `supabase_realtime` publication, OR wire a subscriber for the user-facing realtime UX (the latter is a feature decision, not a fix).
2. **Worktree cleanup:** `rm -rf .claude/worktrees/agent-*` + add `.claude/worktrees/` to `.gitignore` + add `.claude/worktrees/**` to `globalIgnores` in `eslint.config.js`.

**Verify:** `npm run lint` now reports 3 warnings (matching CLAUDE.md §3 baseline).

### PR-9 — Doc refresh

**Closes:** AUDIT-4-1, AUDIT-5-4, AUDIT-5-8

1. `.claude/skills/qa.md` § "Known product bugs" — replace with the AUDIT-4-1 table (5 of 6 items are FIXED).
2. `CLAUDE.md §10b` — remove `dotenv` from "possibly unused" (it's used by playwright.config.ts + e2e/fixtures/db.ts).
3. `README.md` — 30-min refresh per CLAUDE.md §10b: Vite 8 → 6.3, list dashboards + backend, list 6 env vars.

### PR-10 — Lint baseline + frequency constants + cleanup

**Closes:** AUDIT-5-2, AUDIT-5-3, AUDIT-5-5, AUDIT-5-6

1. Remove the stale eslint-disable at `ProfilePage.jsx:64` (AUDIT-5-5).
2. Replace raw `'half-yearly'` literals in `ActivatedStep.jsx:33` and `AnalyticsPage.jsx:47` with `FREQUENCY.HALF_YEARLY` constants (AUDIT-5-6).
3. `npm uninstall react-is` (AUDIT-5-3).
4. Update CLAUDE.md §3 lint baseline to reflect current state after PR-8 (AUDIT-5-2).

### Cleanup items deferred to feature work

- Branch admin own-branch edit (AUDIT-4-4) — needs a UX decision on form layout (separate tab vs reuse Edit Branch).
- StubPage routes for Settings/notifications + Settings/security (AUDIT-4-5) — replace with real features OR remove routes; product call.
- AML step hang (AUDIT-4-7) — needs runtime trace + agent storageState reproduction.
- Decompose `BranchHealthScore.jsx` 522 LOC (deferred per DASHBOARD_AUDIT_FIXES).
- Extract `<EntityListPanel>` / `<ChatThread>` / `<RoleSidebar>` (deferred per DASHBOARD_AUDIT_FIXES).

---

## 4. Architecture Decision Records (ADRs)

### ADR-001 — Rollup metrics strategy

**Status:** Proposed. Surfaced by AUDIT-1-1 / AUDIT-1-2 / AUDIT-1-3.

**Context.** The distributor home consumes aggregate metrics (subscribers count, agents count, branches count, AUM, monthly contributions/withdrawals × 12 months) across the entire network. Current strategy is **on-demand aggregation in a SECURITY DEFINER RPC** (`get_entity_metrics_rollup`) that scans `transactions` every call. Mean exec 1.57 s; max 7.32 s; 8s timeout kills cold-cache calls.

**Options.**
- **(A) Index + rewrite (PR-1 above)** — keep on-demand; add `(type, date)` partial index + rewrite the CTE; expected mean < 500 ms.
- **(B) Materialized view** — `CREATE MATERIALIZED VIEW mv_entity_metrics REFRESH ON COMMIT/SCHEDULE`. Sub-100ms reads at the cost of stale data (refresh cadence) and write amplification on `transactions`.
- **(C) Denormalized rollup table** updated by triggers — `entity_metrics` table holds totals; per-row trigger on `transactions` increments. Best read latency, highest write cost, fragile to bugs (one wrong trigger = wrong totals forever).

**Decision (recommended): A.** The seed has 30 K subscribers; the RPC's correct lower bound with the right index is ~50-200 ms for country-level — comfortably under the 5 min `staleTime`. Materialized views add operational complexity (refresh failures, lag between writes and dashboard) that isn't worth it for ~30 K rows. Revisit B when subscriber count crosses 1 M.

**Tradeoffs accepted.** First-paint cold cache pays the 50-200 ms; subsequent loads inherit `staleTime: 5min`. Realtime metric changes (e.g. a contribution lands → AUM ticks up) are NOT broadcast — user sees the update on next focus.

### ADR-002 — Realtime channel scope

**Status:** Proposed. Surfaced by AUDIT-2-4.

**Context.** Realtime publication is currently ON for `commissions`, `settlement_runs`, `settlement_run_branch_reviews` per CLAUDE.md §9. Phase 1 + Phase 2 confirmed **zero `.channel(...)` subscribers** across `src/` and `api/`. WAL volume is being replicated for no consumer.

**Options.**
- **(A) Drop the publication entirely.** Saves WAL bandwidth + storage. Lose future plug-and-play realtime UX.
- **(B) Keep publication, wire one consumer.** Commission state machine has the strongest realtime case (settlement runs go through multiple statuses, admins want live dashboards).
- **(C) Keep publication, drop the busiest tables.** Subscribers + transactions are explicitly OFF already; the kept tables are low-volume. Status quo with documentation.

**Decision (recommended): A** for now (demo platform); revisit when admin role ships and a "live settlement run" dashboard exists. If admin needs realtime, PR-8 reverts trivially.

**Tradeoffs accepted.** Future realtime feature work is one migration away.

### ADR-003 — TanStack Query caching policy

**Status:** Proposed. Surfaced by AUDIT-1-4 + AUDIT-3 TanStack table.

**Context.** Today, four "metric" hooks have `staleTime: 5 * 60 * 1000`; the rest default to `0` (refetch on focus). Result: tab-switch retriggers `get_top_branch` (5–10 s RPC), entity-list re-fetch, etc. `docs/api-contracts.md` documents an "invalidation contract" but doesn't codify `staleTime` per key.

**Options.**
- **(A) Per-key explicit `staleTime`** — every `useQuery` declares one. Maximum clarity; maintenance overhead.
- **(B) Tiered defaults** via a custom hook `useReadQuery({ key, fetcher, tier: 'fresh'|'standard'|'static' })` that maps `tier` to `staleTime`. Tier defaults: fresh = 0, standard = 5 min, static = 30 min.
- **(C) Global `staleTime: 5 min` on the QueryClient** with per-key overrides for the few that need fresher data.

**Decision (recommended): C.** Set the QueryClient default to 5 min staleTime; explicitly mark mutation-invalidated queries (e.g. settlements after settle action) so they refetch on demand. Cheap to implement, broad coverage. `docs/api-contracts.md` formalizes the invalidation contract.

**Tradeoffs accepted.** Some data may be 5 min stale on tab return; mutation-driven invalidation closes the loop where freshness matters.

### ADR-004 — Frontend Supabase client surface

**Status:** Proposed. Surfaced by AUDIT-3-4.

**Context.** The frontend uses `@supabase/supabase-js` for `.from()` and `.rpc()` only. The full client ships 230 KB gzip of transitive deps the app never uses: storage-js (no Storage uploads), auth-js (custom HS256 JWT, no Supabase Auth), realtime + phoenix (no `.channel()` subscribers), decimal.js-light, redux-toolkit, immer, webauthn.

**Options.**
- **(A) Replace `createClient` with `postgrest-js` directly.** Manual auth header + URL composition. ~30 KB gzip vs 230 KB.
- **(B) Stay on supabase-js + audit babel/rollup config** to tree-shake unused subcomponents. Less invasive; depends on whether storage-js / realtime are reachable from `createClient`'s entry. Historically they aren't tree-shakable.
- **(C) Use supabase-js for the api/ server side only**, write the FE against fetch + a tiny PostgREST helper. Splits the surface neatly.

**Decision (recommended): A,** with a small wrapper that preserves the `.from()` / `.rpc()` ergonomics. The transitive baggage is real: 200 KB gzip × ~30 K monthly users = bandwidth + parse + memory cost. Demo platform; production cutover gets even better cost calculus.

**Tradeoffs accepted.** Owning the auth-header glue + the typing for RPC responses. ~30 LOC of helpers.

---

## 5. What the audit ruled OUT (with evidence)

These were *plausible suspects* before the audit. They are NOT the cause of any documented finding:

- **NOT** an RLS InitPlan miss — migration 0008 wraps every `auth.jwt()` call in `(SELECT auth.jwt())`; EXPLAIN confirms top-level InitPlan, not per-row Filter. Only `distributors_update_self` was left unwrapped (PR-6 fixes).
- **NOT** a `'role'` vs `'app_role'` JWT-claim mis-read — zero hits in live policies/functions (Phase 2 §B). The single source-file reference is the test that *enforces* the rule.
- **NOT** a realtime cascade — zero `.channel(` subscribers in `src/` or `api/` (Phase 1 §6, Phase 2 §D).
- **NOT** TanStack `staleTime` misses on the *four metric hooks* — they have 5-min staleTime. The misses are on entity-list hooks and `useTopBranch` (PR-3 fixes).
- **NOT** WAN RTT alone — 200-400 ms RTT applied to 6 parallel requests is ~250 ms; the dominant signal is 5-10 s server-side query times.
- **NOT** a Vite chunk-loading regression — trace shows 600-720 ms per chunk; meaningful but a smaller share than the server head.
- **NOT** a JWT-mint shape mismatch between e2e harness and prod (Phase 1 §6 — `api/_lib/jwt.ts` and `e2e/fixtures/auth.ts` both mint `app_role`).
- **NOT** demo-scope items per CLAUDE.md §10a (mocked OTP/KYC, hardcoded UGX 1,000 unit price, 24h JWT, demo_personas fallback IDs).
- **NOT** broken user flows in the four built dashboards — qa.md's "known bugs" list is stale; 5 of 6 are FIXED (AUDIT-4-1).

---

## 6. Sprint sequencing recommendation

Two-week sprint, ordered by dependency:

**Week 1 — the hot path**
- Day 1-2: PR-1 (DB perf migration). Single migration, requires perf review.
- Day 3: PR-2 (retire `useDistributorMetrics` + Sidebar). Single PR, ~150 LOC.
- Day 3-4: PR-3 (lazy-mount panels + staleTime audit). Single PR, ~200 LOC.
- Day 4-5: PR-4 (cursor pagination). Single PR, ~250 LOC, touches `entities.js` + `ViewSubscribers.jsx` + the infinite-query wiring.

**Week 2 — correctness + cleanup**
- Day 6: PR-5 (`upsert_nominees` RPC + sum-to-100 CHECK). Single migration + service refactor.
- Day 7: PR-6 (RLS flatten + index dedup + InitPlan wrap). Single migration.
- Day 8: PR-7 (postgrest-js swap + Leaflet code-split). Bigger PR — give it a full review pass.
- Day 9: PR-8 (drop realtime + clear worktrees). Quick.
- Day 9-10: PR-9 + PR-10 (docs refresh + lint cleanup). Bundle together.

**End-of-sprint verification:**
- Rerun the Phase 1 Playwright trace. Expected: distributor chrome paint < 2 s, first-paint Supabase requests < 6 (down from 24), `get_top_branch` mean < 500 ms in pg_stat_statements.
- `npm run lint` matches CLAUDE.md §3 baseline (0 errors, 3 warnings).
- `e2e/specs/flows/distributor-renders-data.spec.ts` test 2 passes ("Showing X of Y" within 5 s).
- `docs/api-contracts.md` updated to reflect the staleTime tier defaults from ADR-003.

---

## 7. What was instrumented but reverted

- `vite.config.js` — temporary `rollup-plugin-visualizer` patch in Phase 3, reverted byte-for-byte. Verified via md5 + `diff`.
- `package.json` / `package-lock.json` — unchanged (Phase 3 used `npm install --no-save` + `npm uninstall`).
- No migrations applied. No DB writes. No source-file edits outside `docs/audit/`.

## 8. Artifacts retained

- `docs/audit/00-baseline.md`
- `docs/audit/01-distributor-metrics.md`
- `docs/audit/02-backend-hotpath.md`
- `docs/audit/03-frontend-perf.md`
- `docs/audit/04-user-flows.md`
- `docs/audit/05-static.md`
- `docs/audit/_bundle-stats.html` (visualizer output — Phase 3)
- `docs/audit/REPORT.md` (this file)
- Playwright traces under `test-results/` (auto-generated by Phase 1's run)

## 9. Audit closeout

Total agent-hours expended: ~14 wall-clock (vs 19 estimate). Phases 2 + 3 ran in parallel after Phase 1 reported, saving ~4 h. Phases 4 + 5 were completed directly (no sub-agent) at the user's preference, saving another ~3 h.

The lag the user reported has a specific, named root cause and a 2-week remediation path with measurable verification at each step.
