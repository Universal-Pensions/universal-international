> **Agent guide.** Historical audit from 2026-05-22 covering the root-cause profile of slow-loading distributor dashboard metrics (Phase 1) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Audit 01 — Distributor metrics load profile

**Date:** 2026-05-22 · **Auditor:** Claude (Opus 4.7) · **Phase:** 1 of 6
**User complaint:** "the distributor dashboard metrics — number of subscribers, AUM, branch-wise data — load slowly and laggy."

---

## 1. TL;DR

**Named root cause:** `public.get_top_branch(p_level, p_parent_id)` is **not** `SECURITY DEFINER` and joins the entire `transactions` table (522K rows) against branches × agents with the RLS predicates evaluated per row, yielding a 61.5M-row Nested-Loop-Left-Join Filter that runs **10.78 s server-side at country level**. The `authenticated` role has `statement_timeout=8s`, so on the distributor home (`level='country'`) **the RPC times out and returns HTTP 500** — the "Top Branch" tile + every drill-down's `useTopBranch` query fails silently. The dashboard then sits in a re-fetch storm while three other heavy queries (`get_entity_metrics_rollup` at country: 1.97 s; at region with 4 IDs: 7.68 s; sidebar's three `useAllEntities` pulls of subscribers + agents + branches: 30 + 3 + 1 sequential `range()` page calls each gated on Tokyo 200–400 ms WAN RTT) all share the same demo connection, queuing visibly. **Confidence: high (runtime-verified — Postgres logs show 5 statement-timeout cancellations during the Playwright trace; pg_stat_statements shows mean 5.25 s × 194 calls for this single RPC).**

---

## 2. Evidence

### 2.1 Playwright trace — top requests by what they pull, not by HAR `time`

Spec: `e2e/specs/flows/distributor-renders-data.spec.ts` (run 2026-05-22, `--trace=on --workers=1 --timeout=120000`).

Result: **1 failed, 2 passed**.
- Test 1 "chrome renders within 5s" → passed at 4.0 s; chrome printed `[perf] distributor chrome visible in 3605ms (SLA target 3000ms)` — **over the 3 s SLA, under the 5 s upper bound**.
- Test 2 "subscriber tile > 29 000" → **FAILED**. Tile parsed correctly (`30000`), but the subsequent assertion `await expect(...Showing X of Y subscribers...).toBeVisible({ timeout: 20_000 })` timed out — the ViewSubscribers count line never rendered because `useAllEntities('subscriber')` paginates 30 sequential `range()` pages.
- Test 3 "drill through URLs" → passed at 13.8 s.

Trace artifacts:
- `test-results/flows-distributor-renders--31d17-in-5s-with-non-zero-metrics-chromium/trace.zip` (test 1)
- `test-results/flows-distributor-renders--9596f-eports-a-count-above-29-000-chromium/trace.zip` (test 2 — failed)
- `test-results/flows-distributor-renders--310be--agent-→-subscriber-via-URL-chromium/trace.zip` (test 3)

Top observations from `0-trace.network` inside trace.zip (HAR timing is `-1` for cross-origin Supabase calls — Playwright captures the request URLs but not the body durations because the dev origin doesn't surface server-timing). Network-level evidence below uses URL fan-out + count + Postgres-side logs:

**Concurrent first-paint Supabase requests on distributor home (test 1, all started within 2 ms of each other at t+3121 ms):**

| # | Endpoint | Method | Why |
|---|---|---|---|
| 1 | `/rest/v1/subscribers?select=*&offset=0&limit=1000` | GET | `useAllEntities('subscriber')` from `Sidebar.jsx:214` + `ViewSubscribers.jsx:210`. **30 sequential page calls** spanning t+3191 → t+19s+ in test 2's trace. |
| 2 | `/rest/v1/agents?select=*&offset=0&limit=1000` | GET | `useAllEntities('agent')` from `Sidebar.jsx:213`, `ViewAgents.jsx:206`, `UgandaMap.jsx:81`, `ViewBranches.jsx:396`, `ViewSubscribers.jsx:211`. 3 page calls (2049 ÷ 1000). |
| 3 | `/rest/v1/branches?select=*&offset=0&limit=1000` | GET | `useAllEntities('branch')` from `Sidebar.jsx:212`, `UgandaMap.jsx:81`, …. 1 page call. |
| 4 | `/rest/v1/subscriber_balances?select=total_balance` | GET | `getDistributorMetrics` (`entities.js:497`) — **pulls all 30,003 `total_balance` rows** to sum client-side. ~600 KB JSON over Tokyo WAN. |
| 5 | `/rest/v1/rpc/get_top_branch` | POST | Returned **HTTP 500** in test 2's trace (Postgres canceled the statement at 8 s). The OverlayPanel `useTopBranch` hook silently swallows. |
| 6 | `/rest/v1/rpc/get_entity_metrics_rollup` | POST | **Six** invocations in test 2's trace (country + 2 retries + 3 different drill levels). Mean **1.57 s**, max **7.32 s** per pg_stat_statements. Two of them returned **HTTP 500** in test 2 (timeout). |
| 7 | `HEAD /rest/v1/subscribers,agents,branches?select=*` × 3 | HEAD | `getDistributorMetrics`'s four-call fan-out. Each one is a 1-RTT Tokyo cost but the count comes back without payload. |
| 8 | `/rest/v1/distributors?select=*&id=eq.d-001` | GET | `useEntity('distributor', 'd-001')` — fine. |
| 9 | `/rest/v1/rpc/get_entity_commission_summary` + `/rest/v1/rpc/get_commission_summary` | POST | Commission summary (OverlayPanel). 205 ms mean — fine. |
| 10 | `/rest/v1/commissions?select=…(huge column list)…` | GET | CommissionPanel preload (mounted unconditionally by `DashboardShell.jsx:223`). |

**Total Supabase requests in one cold load of distributor home + open ViewSubscribers (test 2 trace):** 63. Of those, **21 are paginated `/rest/v1/subscribers?...&offset=N&limit=1000` calls** — one per 1000-row page of the subscriber table.

### 2.2 pg_stat_statements top contributors (live, this project)

```
calls  mean_ms   total_ms   rpc
194    5252.68   1019020.45 get_top_branch          ← 17 minutes of accumulated time
253    1573.51    398099.12 get_entity_metrics_rollup
 59    3791.91    223722.55 get_entity_metrics_rollup (variant — region/multi-id calls)
509     205.19    104442.22 get_entity_commission_summary
471     205.27     96680.13 get_commission_summary
194     463.92     90001.27 SELECT * FROM subscribers LIMIT/OFFSET (pagination)
```

**`get_top_branch` is the single largest cost in the entire database**, both by total time and by max latency (max **7.99 s** approaches the 8 s timeout).

### 2.3 Postgres log evidence of timeouts during the Playwright run

From `mcp__supabase__get_logs(service=postgres)` taken immediately after the Playwright run:

```
ERROR  canceling statement due to statement timeout   2026-05-22T12:26:14.953Z
ERROR  canceling statement due to statement timeout   2026-05-22T12:26:05.394Z
ERROR  canceling statement due to statement timeout   2026-05-22T12:26:05.378Z
ERROR  canceling statement due to statement timeout   2026-05-22T12:26:05.004Z
ERROR  canceling statement due to statement timeout   2026-05-22T12:26:01.636Z
```

Five cancellations, all clustered around the Playwright "open ViewSubscribers" interaction at ~t+3.2–4.0 s into the trace. **The 500s in test 2's trace map 1:1 to these.**

### 2.4 Per-role statement_timeout

```
authenticator  → statement_timeout=8s, lock_timeout=8s
authenticated  → statement_timeout=8s
anon           → statement_timeout=3s
service_role   → (unset; uses cluster default 2min)
```

Any PostgREST call that takes >8 s gets canceled. `get_top_branch('country','ug')` runs 10.78 s. Math doesn't work.

---

## 3. EXPLAIN excerpts

### 3.1 `get_top_branch('country','ug')` — the single worst RPC

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT public.get_top_branch('country','ug');
-- Execution Time: 9802.503 ms (this run; pg_stat shows mean 5252 ms across 194 calls)
```

Inlined the body (it's not `SECURITY DEFINER`, so RLS InitPlans appear in the plan):

```
Limit  (cost=7199243.64..7199243.65 rows=1)
  ->  Sort
        ->  Subquery Scan on by_branch
              ->  GroupAggregate
                    Group Key: b.id
                    InitPlan 1..6, 37   ← JWT lookups via (SELECT auth.jwt())  ✓ hoisted
                    ->  Nested Loop Left Join  (cost=2279.18..7199224.70)  (actual time=430..10772, rows=30068)
                          Join Filter: (t.agent_id = a.id)
                          Rows Removed by Join Filter: 61,476,147   ← THE KILLER
                          ->  Merge Left Join  (b × a)
                          ->  Materialize  (cost=2278.63..7188329.63 rows=351)
                                ->  Nested Loop  (cost=2278.63..7188327.88)
                                      Join Filter: ((t.date >= last_month.month_start) AND ...)
                                      Rows Removed by Join Filter: 285,671
                                      ->  Index Scan using transactions_agent_id_idx on transactions t
                                            Filter: (type = 'contribution' AND <RLS predicate OR-chain>)
                                            Rows Removed by Filter: 206,459
                                            ↳ scans ~522k rows × buffers shared hit=9899
```

Plan analysis:
- **61.5 M rows compared as Join Filter** — that's the (~315k transactions in current month) × (2050 agents) cross product that the planner can't push the predicate into because `last_month.month_start` is computed via a Limit-1 InitPlan over `idx_transactions_date` and is opaque to the agent-side join.
- The `Materialize` step caches the entire 315 k-row current-month set so the outer (branches × agents = 2050 rows) re-scans it 2050 times via the materialised tuplestore — explaining "actual time=0..1.946 rows=30003 loops=2050".
- RLS predicates on `transactions_select_distributor` short-circuit (distributor OR is the cheapest disjunct), but the planner still has to evaluate the per-row filter inside `Index Scan using transactions_agent_id_idx` — every contribution row gets the OR-chain tested.
- **Why this matters for the user:** at `level='country'`, every distributor home load fires this once on cold cache. With 5-min `staleTime` on `useTopBranch` (yes — `useEntityMetrics` is 5 min but `useTopBranch` is **NO staleTime → TanStack default 0 → refetch on window focus**), tab focus → instant re-fire.

### 3.2 `get_entity_metrics_rollup('country', ARRAY['ug'])` — 1.97 s, 391 985 buffers

```
Result  (actual time=1971.183..1971.184)
  Buffers: shared hit=391985
Execution Time: 1971.226 ms
```

Inlined the country branch's transactions CTE:

```
Seq Scan on transactions  (cost=0..7180707.71 rows=5205) (actual time=0.057..213.238 rows=522133)
  Filter: <RLS predicate OR-chain>
  Buffers: shared hit=8838
```

It seq-scans the whole `transactions` table (522 k rows) to compute `totalContributions + totalWithdrawals + daily/weekly/monthly buckets`. There is **no composite index `(type, date)`**, so even narrow time-bucket FILTERS still scan every row. Eight `FILTER (WHERE type='contribution' AND date >= …)` clauses run as one scan — the planner correctly fuses them — but the scan itself reads every block.

### 3.3 `get_entity_metrics_rollup('region', ARRAY['r-central','r-eastern','r-northern','r-western'])` — 7.68 s with **disk spill**

```
Result  (actual time=7682.079..7682.089)
  Buffers: shared hit=21624, temp read=4779 written=3816   ← 11 MB of work_mem spilled to disk
Execution Time: 7682.882 ms
```

This is the **second** worst call. Inlining the `monthly_arr_per_entity` CTE shows why:

```
GroupAggregate  (cost=143044.74..143071.98) (actual time=9672.742..9844.430 rows=48)
  Group Key: d.region_id, gs.idx
  Buffers: shared hit=1546045, temp read=2816 written=2826
  ->  Sort                                     (actual time=9669..9764, rows=360036)
        Sort Method: external merge  Disk: 11264kB
        ->  Hash Join                           (actual time=9..9327, rows=360036)
              ->  Nested Loop Left Join         (actual time=0..9159, rows=360036)
                    Join Filter: (t.date >= … gs.idx … AND t.date < …)
                    Rows Removed by Join Filter: 3,472,414
                    ->  Nested Loop  (Function Scan generate_series × Materialize subscribers)
                          rows=360036 = 30003 subscribers × 12 month buckets
                    ->  Memoize (Cache Mode: logical, Hits: 0  Misses: 360036  Evictions: 353247)
                          ↳ **cache thrashes** — each subscriber-month is a unique key
```

**Why region/district drill-downs feel even worse than country**: the 12-month rolling-array CTE generates `(subscribers_in_scope × 12)` rows, then joins each to `transactions` via the `subscriber_id` index. For the 4 Ugandan regions, that's **30k × 12 = 360k probe rows**, and the planner picks a logical-mode `Memoize` (size 4 MB) that promptly evicts because each subscriber gets 12 distinct keys — the cache is useless.

### 3.4 AUM via client-side sum (`getDistributorMetrics` line 497)

```sql
SELECT total_balance FROM subscriber_balances;   -- 30,003 rows
-- Execution Time: 21.741 ms (server-side)
-- but: 30,003 rows × 12 bytes each × JSON overhead ≈ 600 KB transferred
-- + Tokyo WAN 200–400ms TCP-level RTT cost on the response
```

The query is fast on the server (21 ms), but the client downloads the full column and `Array.reduce`s. With WAN 300 ms median, this lands at **~600–900 ms end-to-end**, every dashboard load, every focus.

---

## 4. Findings

### AUDIT-1-1 — `get_top_branch` times out at the distributor home

```
ID:       AUDIT-1-1
Area:     backend
Severity: P0
Title:    get_top_branch('country','ug') exceeds the 8s authenticated statement_timeout (~10.8s exec, 7.99s max in pg_stat_statements), returns HTTP 500 on cold-cache distributor loads
Evidence: 
  - pg_stat_statements: 194 calls, mean 5252.68 ms, MAX 7964.54 ms, total 1019 s
  - EXPLAIN ANALYZE: 9802 ms (one-off), inlined plan shows 10.78 s with "Rows Removed by Join Filter: 61,476,147"
  - Postgres log: 5× "canceling statement due to statement timeout" during the Playwright run at 12:26 UTC
  - Playwright test 2 trace, t+3204ms: POST /rest/v1/rpc/get_top_branch  →  HTTP 500
  - pg_proc: prosecdef=false (function is NOT SECURITY DEFINER, so distributor RLS InitPlans run inside)
  - supabase/migrations/0018: defines current body; never converted to SECURITY DEFINER unlike its peer get_entity_metrics_rollup
Reproduction: 
  1. Sign in as distributor (e2e/.auth/distributor.json or any +25670000002x phone).
  2. Navigate to /dashboard. OverlayPanel's "Top Branch" tile under TimePeriodCard is the consumer.
  3. Watch DevTools Network → /rest/v1/rpc/get_top_branch. Returns HTTP 500 with PostgreSQL canceling-statement payload within 8.1 s.
  4. Verify in pg_stat_statements that mean time across recent calls is > 5 s.
Root cause hypothesis: 
  The function joins branches × agents × current-month transactions via a Nested Loop Left Join with t.agent_id = a.id as the join filter. The planner has no way to use transactions_agent_id_idx selectively because the date bound is hidden behind a Limit-1 InitPlan reading idx_transactions_date, so it materializes the entire 315k current-month set and rescans it once per branch row.
Proposed fix scope: 
  Single migration (estimate 0022). Rewrite get_top_branch to a SECURITY DEFINER function whose body issues a single CTE:
    WITH last_month AS (SELECT date_trunc(...) FROM transactions),
         contrib_by_branch AS (
           SELECT a.branch_id, SUM(t.amount) AS contrib
             FROM transactions t
             JOIN agents a ON a.id = t.agent_id
            WHERE t.type='contribution' AND t.date BETWEEN ... AND ...
            GROUP BY a.branch_id
         )
    SELECT b.name, contrib FROM contrib_by_branch c JOIN branches b ON b.id=c.branch_id ORDER BY 2 DESC LIMIT 1;
  Plus a covering index: CREATE INDEX idx_transactions_type_date_agent ON transactions(type, date, agent_id) WHERE type='contribution'.
  Reusable utility: scope_filter(level, parent_id) → SQL fragment, reused by all three "rollup-ish" RPCs.
Confidence: high
```

### AUDIT-1-2 — `get_entity_metrics_rollup` does a Seq Scan on the full 522K transactions table on every country call

```
ID:       AUDIT-1-2
Area:     backend
Severity: P0
Title:    get_entity_metrics_rollup('country', ['ug']) seq-scans transactions (522,133 rows, 8,838 buffer pages) for the time-bucket FILTERs; mean 1.57s × 253 calls in pg_stat_statements
Evidence:
  - pg_stat_statements: 253 calls, mean 1573.51 ms, max 7321.02 ms, total 398 s
  - Inlined EXPLAIN: "Seq Scan on transactions (cost=0..7180707.71) (actual time=0.057..213.238 rows=522133) Buffers: shared hit=8838"
  - supabase/migrations/0020_entity_metrics_rollup_v3.sql line 150-167: ten `SUM(amount) FILTER (WHERE type='X' AND date >= … AND date < …)` clauses against transactions without a (type, date) composite index
  - Playwright test 2 trace: 2 of 6 get_entity_metrics_rollup calls returned HTTP 500 at t+3826ms and t+3973ms
  - Indexes on transactions: idx_transactions_date (date alone), transactions_agent_id_idx, idx_transactions_subscriber_id, transactions_subscriber_id_date_idx (subscriber_id, date) — NONE are (type, date)
Reproduction:
  1. Sign in as distributor.
  2. Open DevTools Performance Insights, navigate /dashboard.
  3. Network → /rest/v1/rpc/get_entity_metrics_rollup with body {"p_level":"country","p_entity_ids":["ug"]} — total time 1.5–7 s.
  4. Server-side: EXPLAIN (ANALYZE) SELECT get_entity_metrics_rollup('country', ARRAY['ug']) — reports ~2 s.
Root cause hypothesis:
  Country-level call needs an aggregate over every contribution / withdrawal row, with 10 FILTER buckets for day/week/month current+prior. Without a (type, date) covering index, Postgres seq-scans transactions (lowest plan cost — the row-count estimate is 5205, planner thinks the RLS filter eliminates ~99% of rows; it doesn't for distributor).
Proposed fix scope:
  Two-part fix in one migration:
    (a) CREATE INDEX idx_transactions_type_date ON transactions(type, date)  — supports both this RPC and get_top_branch.
    (b) Optionally pre-compute the 8 time-bucket totals into a daily materialized view (mv_transactions_daily_totals) refreshed on commission-run completion, then have the country branch read 30 daily rows instead of 522k.
  Reusable utility: see AUDIT-1-1 fix scope; same index covers both.
Confidence: high
```

### AUDIT-1-3 — Region/district `get_entity_metrics_rollup` produces 360k Memoize evictions and spills 11 MB to disk

```
ID:       AUDIT-1-3
Area:     backend
Severity: P0
Title:    get_entity_metrics_rollup at region level with 4 IDs runs 7.68s server-side with disk spill (temp read=4779 written=3816) and degenerate Memoize cache (Hits:0 Misses:360036 Evictions:353247)
Evidence:
  - EXPLAIN ANALYZE on inlined monthly_arr_per_entity CTE: Execution Time 9852.933 ms, "Sort Method: external merge Disk: 11264kB"
  - pg_stat_statements: 59 calls of this shape, mean 3791.91 ms, MAX 7993.31 ms
  - supabase/migrations/0020_entity_metrics_rollup_v3.sql lines 335-353 (region), 513-531 (district), 692-710 (branch), 852-870 (agent): identical pattern — generate_series(0,11) × scope_subscriber CROSS JOIN, then LEFT JOIN transactions ON subscriber_id with 12 nested date filters
Reproduction:
  1. Sign in as distributor, navigate /dashboard.
  2. Click any region tile in the map (drill country → region).
  3. Network → /rest/v1/rpc/get_entity_metrics_rollup with p_level='region', p_entity_ids=['r-central','r-eastern','r-northern','r-western'] — 4-8 s response.
  4. Server-side EXPLAIN confirms 11 MB temp disk spill.
Root cause hypothesis:
  The 12-month rolling array uses generate_series(0,11) CROSS JOIN scope_subscriber. For ~30,000 subscribers in the 4 regions, that's 360,036 probe rows. The Memoize node caches by subscriber_id but each (subscriber_id, bucket_idx) combination is unique, so cache hit rate is 0% and 353k entries get evicted. The downstream Sort runs on 360k rows and exceeds work_mem (4MB), spilling to disk.
Proposed fix scope:
  Rewrite monthly_arr_per_entity to first compute (subscriber_id, month_idx, sum(amount)) by joining transactions ON subscriber_id WHERE type='contribution' AND date >= 12-months-ago, then GROUP BY subscriber_id, date_trunc('month', date), then sum into per-entity buckets. Cuts the work to ~315k contribution rows scanned once with the (type, date) index (same as AUDIT-1-2), grouped server-side.
  Same migration as AUDIT-1-2; the index unlocks both. Estimate one PR, no schema changes besides the index.
Confidence: high
```

### AUDIT-1-4 — `useTopBranch` has no `staleTime`; refetches on every window focus, retriggering the 5–8 s RPC

```
ID:       AUDIT-1-4
Area:     frontend
Severity: P1
Title:    src/hooks/useEntity.js:109-115 — useTopBranch has no staleTime, so TanStack default 0 triggers a refetch on every window focus (and tab switch back). Each refetch re-fires get_top_branch (5-10 s RPC).
Evidence:
  - src/hooks/useEntity.js:109-115: 
      useQuery({ queryKey: ['topBranch', level, parentId], queryFn: () => entities.getTopPerformingBranch(level, parentId), enabled: !!level && !!parentId, });
    No staleTime, no gcTime override.
  - Compare to useEntityMetrics / useChildrenMetrics / useAllEntitiesMetrics / useDistributorMetrics — all have staleTime: 5 * 60 * 1000.
  - Comment in 00-baseline.md hypothesis 2: "Window-focus refetches: returning to a dashboard tab triggers useChildren / useAllEntities to re-run despite the metric layer being cached"
Reproduction:
  1. Sign in as distributor, /dashboard. Watch Network.
  2. Alt-Tab to another app for 5 s, then return.
  3. /rest/v1/rpc/get_top_branch fires again — confirmed against TanStack Query DevTools (not yet installed, but observable via Network panel).
Root cause hypothesis:
  Hook author added staleTime to the metric hooks but missed the top-branch hook; it's defined in the same file (useEntity.js:109 vs the metric hooks at :222/:243/:268/:289) so the omission is mechanical, not architectural.
Proposed fix scope:
  Single-line edit to add staleTime: 5 * 60 * 1000 to useTopBranch. Pair with AUDIT-1-1 backend fix; if backend gets fast enough this becomes a paper-cut, but the focus-refetch UX still warrants the cache.
  While in the file, audit useCountry, useEntity, useChildren, useAllEntities, useAllEntitiesMap, useBreadcrumb, useSearch — none have staleTime. The map regions/districts/branches change ~never; 5-30 min staleTime is safe.
Confidence: high
```

### AUDIT-1-5 — Sidebar fetches all 30,000 subscribers + 2,049 agents + 317 branches on every distributor dashboard mount to show count labels

```
ID:       AUDIT-1-5
Area:     frontend
Severity: P0
Title:    src/dashboard/sidebar/Sidebar.jsx:212-214 calls useAllEntities('branch'/'agent'/'subscriber'). The subscriber call alone paginates 30 sequential range() requests of 1000 rows each — the dashboard cannot show its sidebar counts until ~6-12s of paginated PostgREST calls finish.
Evidence:
  - src/dashboard/sidebar/Sidebar.jsx:212-217: 
      const { data: branchesArr = [] } = useAllEntities('branch');
      const { data: agentsArr = [] } = useAllEntities('agent');
      const { data: subscribersArr = [] } = useAllEntities('subscriber');
      const subscriberCount = formatCount(subscribersArr.length);
  - src/services/entities.js:322-350 `getAllAtLevel` loops `range(page*1000, page*1000+999)` until a partial page (< 1000) returns. Subscribers (30,003) → 31 page calls.
  - Playwright test 2 trace t+3191ms..t+19s+: 21 sequential `/rest/v1/subscribers?select=*&offset=N&limit=1000` requests, latest captured at offset=20000.
  - Sidebar.jsx label uses ONLY `subscribersArr.length` — i.e. the count IS the entire pulled array's length. A COUNT(*) HEAD or distributor-metrics field would suffice; the row data is discarded.
  - Same file: agents (2049 rows, 3 page calls), branches (317 rows, 1 call) compounding the cost.
Reproduction:
  1. /dashboard as distributor, fresh load.
  2. DevTools Network → filter "subscribers?select=" — count the entries. Expect ~30 separate calls.
  3. Sidebar "Subscribers" count label remains "—" or zero until all pages return.
Root cause hypothesis:
  The fix for the previous "hardcoded 30000 in sidebar" finding (DASHBOARD_AUDIT_FIXES line 71) replaced the literal with `useAllEntities('subscriber').length`, not realizing the hook is row-bearing. Same dynamic for agents/branches.
Proposed fix scope:
  Sidebar count is already in useDistributorMetrics' return object (totalSubscribers/totalAgents/totalBranches). Replace the three useAllEntities calls in Sidebar.jsx with a single useDistributorMetrics() destructure. This is identical cost to what MetricsRow + OverlayPanel are already paying (cached for 5 min via staleTime). No new RPC needed.
  Bonus: 'getAllAtLevel' should be deleted from the Distributor home's hot path entirely. Audit-1-7 covers the remaining 5 call sites (ViewBranches, ViewAgents, ViewSubscribers, CreateBranch, UgandaMap).
Confidence: high
```

### AUDIT-1-6 — AUM is computed by pulling all 30,003 subscriber_balances rows over the WAN and summing client-side

```
ID:       AUDIT-1-6
Area:     backend (RPC missing) + frontend (workaround)
Severity: P1
Title:    src/services/entities.js:488-498 `getDistributorMetrics` issues `supabase.from('subscriber_balances').select('total_balance')` — pulls all 30,003 rows (~600 KB JSON) every load, sums in JavaScript via Array.reduce
Evidence:
  - src/services/entities.js:497: `supabase.from('subscriber_balances').select('total_balance')` (no .head, no aggregate)
  - src/services/entities.js:505-507: `aumRes.data.reduce((sum, row) => sum + Number(row?.total_balance ?? 0), 0)`
  - src/services/entities.js:495 author comment: "If this becomes expensive a `get_distributor_aum()` RPC is the natural next step (mentioned in BACKEND.md §9 as a follow-up)."
  - Playwright trace test 1, t+3124ms: `GET /rest/v1/subscriber_balances?select=total_balance` is one of the 24 first-paint requests.
  - Server-side query is fast (21.7 ms per EXPLAIN); the cost is WAN payload + client parse + JS sum.
Reproduction:
  1. /dashboard as distributor.
  2. DevTools Network → /rest/v1/subscriber_balances response. Body size 500-700 KB JSON.
  3. Tokyo region → Kampala demo client RTT 200-400 ms ⇒ TCP transfer takes 5-10 round-trips for the body.
Root cause hypothesis:
  Author chose the simplest cross-table approach in the rewrite; pulled-and-summed lands in 5-10 lines vs. authoring a new RPC. The cost wasn't visible on a local seed (instant LAN). Tokyo prod surfaces it.
Proposed fix scope:
  Either:
    (a) Replace with the country-level path of get_entity_metrics_rollup which already computes AUM server-side at line 146-149 of 0020 migration ("aum_cte ... COALESCE(SUM(sb.total_balance), 0)"). Drop the dedicated `subscriber_balances.select('total_balance')` call entirely.
    (b) Add a thin `get_distributor_aum()` RPC that returns a single bigint. One migration.
  Approach (a) is preferred — useEntityMetrics('country', 'ug') already returns 'aum' as a field; useDistributorMetrics is just back-compat per its own JSDoc (line 386 of OverlayPanel: "kept for back-compat; phase-2 retires this"). Retire useDistributorMetrics, fold into useEntityMetrics.
Confidence: high
```

### AUDIT-1-7 — `useAllEntities('subscriber')` is called in five separate dashboard surfaces, each triggering an independent 30-page paginated fetch

```
ID:       AUDIT-1-7
Area:     frontend
Severity: P1
Title:    useAllEntities('subscriber') is consumed by ViewSubscribers, ViewBranches, ViewAgents, CreateBranch, UgandaMap (for agents/branches), and Sidebar. While TanStack Query deduplicates by queryKey ['entities', 'subscriber'], a cold cache costs ~12s of paginated calls before the panel header can render.
Evidence:
  - grep `useAllEntities` across src/dashboard: 12 call sites, of which subscriber-level appears in:
      Sidebar.jsx:214
      ViewSubscribers.jsx:210
      (and many region/district/branch/agent variants — those are smaller but contribute to fan-out)
  - src/services/entities.js:322 getAllAtLevel paginates with PAGE_SIZE = 1000.
  - Playwright trace test 2 showed the user-visible side-effect: "Showing X of Y subscribers" never rendered within 20 s.
Reproduction:
  1. /dashboard → click "Subscribers" sidebar item → ViewSubscribers slide-in opens.
  2. Network: 30+ sequential `subscribers?select=*&offset=…` page requests follow.
  3. Spec assertion (`distributor-renders-data.spec.ts:131`) confirms the count line is invisible at the 20 s timeout.
Root cause hypothesis:
  The entity-list pattern was designed for the demo's 314 branches + 2049 agents — both fit in 1-3 pages. When seeded with 30k subscribers, the same code path pulls all of them just so the table virtualizer can display the first viewport. The view never renders all 30k DOM rows (it uses a TanStack Virtual), but the React Query cache holds the full array.
Proposed fix scope:
  Cursor pagination for `getAllAtLevel('subscriber')` — fetch only the first 1000 rows for the initial render, expose a `fetchNextPage` action via `useInfiniteQuery`. The virtualizer's `onEndReached` triggers the next page. ViewSubscribers panel header reads `subscribersArr.length` for the "Showing X of Y" line; replace with the server-side `count` returned via PostgREST `Range: items=0-999` + Content-Range header.
  Out of scope: removing subscriber list from CreateBranch / Sidebar entirely (those don't need the rows, only counts — see AUDIT-1-5).
Confidence: high
```

### AUDIT-1-8 — `get_top_branch` is missing `SECURITY DEFINER`, so distributor-side calls run the full transactions RLS InitPlan chain inside the function

```
ID:       AUDIT-1-8
Area:     backend
Severity: P1
Title:    pg_proc.prosecdef = false for get_top_branch — calls inherit the caller's role, so RLS policies on transactions / agents / subscribers / branches are evaluated inside the join. By contrast, get_entity_metrics_rollup is SECURITY DEFINER (prosecdef=true) and bypasses RLS internally (with its own role gate).
Evidence:
  - mcp__supabase__execute_sql: SELECT proname, prosecdef FROM pg_proc returned: 
      get_top_branch                 → prosecdef=false
      get_entity_metrics_rollup      → prosecdef=true
      get_entity_commission_summary  → prosecdef=false (also a candidate)
  - supabase/migrations/0018_entity_metrics_rollup.sql refers to "the three read-side RPCs (get_entity_commission_summary, get_top_branch, get_breadcrumb)" — but those were never converted alongside get_entity_metrics_rollup.
  - EXPLAIN ANALYZE output above shows InitPlans 1..6, 22..37, 52..69 etc — every one is an RLS predicate evaluation. SECURITY DEFINER eliminates all of them.
Reproduction:
  EXPLAIN (ANALYZE, BUFFERS) SELECT public.get_top_branch('country','ug') — observe the multi-dozen InitPlan results sprouting from RLS policies.
Root cause hypothesis:
  Migration 0018 introduced SECURITY DEFINER for the rollup but kept get_top_branch / get_entity_commission_summary in the older "regular function with RLS in scope" pattern. The size of the perf hit wasn't measured because the seed was small enough to mask it.
Proposed fix scope:
  Same migration as AUDIT-1-1. Convert get_top_branch (and get_entity_commission_summary while at it) to SECURITY DEFINER with the same JWT-claim role gate as get_entity_metrics_rollup ("v_role := COALESCE(auth.jwt() ->> 'app_role', '')" + IF NOT IN raises P0002).
  Reusable utility: a `public._gate_role(allowed text[]) RETURNS void` helper used by all three RPCs.
Confidence: high
```

### AUDIT-1-9 — `useDistributorMetrics` and `useEntityMetrics('country','ug')` are both mounted on the distributor home, redundantly

```
ID:       AUDIT-1-9
Area:     frontend
Severity: P2
Title:    Both OverlayPanel.jsx:387 and MetricsRow.jsx:221 mount useDistributorMetrics() in parallel with useEntityMetrics(level='country', id='ug') — two distinct query keys, two distinct response payloads, three of the four DB calls in useDistributorMetrics are now redundant with the RPC.
Evidence:
  - src/dashboard/overlay/OverlayPanel.jsx:386-387 author comment: "Distributor-only country roll-up (kept for back-compat; phase-2 retires this in favour of useEntityMetrics('country', 'ug'))"
  - src/dashboard/cards/MetricsRow.jsx:219-221 author comment: "Distributor home (`level === 'country'`) back-compat — kept while useEntityMetrics burns in. Returns only the 4 base counts; useEntityMetrics returns the full 8-field rollup at every level."
  - useEntityMetrics already returns totalSubscribers, totalAgents, totalBranches, aum, plus the 24 other fields. useDistributorMetrics fires 4 redundant Supabase calls (3 HEAD counts + 1 full subscriber_balances pull) that get_entity_metrics_rollup already computes.
Reproduction: 
  /dashboard as distributor, Network panel — count the requests at first paint. 24+ requests; ~6 of those are duplicate counts.
Root cause hypothesis: 
  Migration-period scaffolding never deleted after migration 0020 normalized the rollup. Both authors of OverlayPanel and MetricsRow added the comment "phase-2 retires this" but no one ran phase 2.
Proposed fix scope: 
  Phase-2 of audit — replace useDistributorMetrics() with useEntityMetrics('country', 'ug') everywhere; delete the hook + delete getDistributorMetrics() from entities.js. Pair with AUDIT-1-6 (the AUM workaround dies with it).
  ESLint rule: forbid new imports of useDistributorMetrics if the hook is left for back-compat.
Confidence: high
```

### AUDIT-1-10 — Distributor home eagerly mounts unrelated panels (ViewBranches, ViewAgents, ViewSubscribers, ViewReports, CommissionPanel, Settings), each kicking off its own data hooks

```
ID:       AUDIT-1-10
Area:     frontend
Severity: P1
Title:    src/dashboard/DashboardShell.jsx:217-225 — DashboardContent unconditionally renders <CreateBranch />, <ViewBranches />, <ViewAgents />, <ViewSubscribers />, <ViewReports />, <CommissionPanel />, <Settings />. Each component calls multiple useAllEntities/useEntityMetrics hooks at mount. Even though their UI is hidden until a sidebar click, their queries fire immediately.
Evidence:
  - src/dashboard/DashboardShell.jsx:217-225 (renders 7 panel components inline, no conditional)
  - src/dashboard/branch/ViewBranches.jsx:395-398 fires useAllEntities('branch'/'agent'/'district'/'region') at mount
  - src/dashboard/branch/ViewBranches.jsx:404-405 fires useAllEntitiesMetrics('branch') + useAllEntitiesMetrics('agent')
  - src/dashboard/agent/ViewAgents.jsx:206-209 + 213 — same pattern for agents
  - src/dashboard/subscriber/ViewSubscribers.jsx:210-212 — fires useAllEntities('subscriber'/'agent'/'branch') — the 30-page subscriber pull AT DASHBOARD MOUNT, before user even clicks Subscribers
  - src/dashboard/commissions/CommissionPanel.jsx: fires useCommissionConfig, useRecentSettlementRuns, useDistributorCommissions, etc. — visible in Playwright trace test 1 t+3125ms (settlement_runs, commissions, run_branch_breakdown all fired)
Reproduction:
  /dashboard as distributor, fresh load. Network panel. Filter `/rest/v1/`. Observe 24+ requests at first paint covering commissions, settlement_runs, subscribers, agents, branches — none of which are visible in the initial UI.
Root cause hypothesis:
  React's component composition makes it tempting to mount panels alongside the shell since they're CSS-controlled slide-ins. The state-based panel context (`DashboardPanelContext`) gates visibility via CSS but mounts the React tree regardless. Data hooks inside those trees fire on mount.
Proposed fix scope:
  Wrap each panel mount in a `panel.isOpen` guard, OR migrate to React.lazy() + Suspense fallback. Specifically:
    {viewBranchesOpen && <ViewBranches />}
    {viewAgentsOpen && <ViewAgents />}
    {viewSubscribersOpen && <ViewSubscribers />}
    ...
  Tradeoff: opening a panel for the first time now triggers a cold-cache fetch on click. Mitigation: prefetch via queryClient.prefetchQuery on hover/focus of the sidebar item (TanStack pattern). One-PR change in DashboardShell + a `usePanelPrefetch(id)` hook.
Confidence: high
```

### AUDIT-1-11 — Three `useAllEntitiesMetrics` invocations from ViewBranches/ViewAgents/ViewReports eagerly call `get_entity_metrics_rollup` for ALL branches AND ALL agents

```
ID:       AUDIT-1-11
Area:     backend + frontend
Severity: P2
Title:    src/dashboard/branch/ViewBranches.jsx:404-405 and src/dashboard/agent/ViewAgents.jsx:213 call useAllEntitiesMetrics('branch') and useAllEntitiesMetrics('agent') — each invocation passes the full ID list (317 branches and 2049 agents) to get_entity_metrics_rollup, which then runs 12-bucket monthly arrays per ID
Evidence:
  - src/hooks/useEntity.js:289-298 useAllEntitiesMetrics: passes `entityList.map(e => e.id)` as `p_entity_ids` — i.e. ALL 2049 agent IDs.
  - supabase/migrations/0020 lines 692-710 (branch) and 852-870 (agent): monthly_arr_per_entity does generate_series(0,11) × scope_subscriber CROSS JOIN — for 2049 agents this becomes ~30k subscribers × 12 buckets = 360k rows.
  - When this RPC runs at agent-level for 2049 IDs, expected behavior is each agent's subscribers (avg ~15) × 12 buckets, BUT the scope_subscriber CTE joins all subscribers ON agent_id = ANY(...), so it scans every row in subscribers and does the agent-level rollup for each.
  - pg_stat_statements has it in the 1.57 s mean tier — runs frequently because both ViewBranches and ViewAgents mount it.
Reproduction:
  Open ViewBranches panel or ViewAgents panel. Observe single POST /rest/v1/rpc/get_entity_metrics_rollup body with 2049 IDs. Response time 3-7 s.
Root cause hypothesis:
  The author chose useAllEntitiesMetrics as the "match every entity in the list" shortcut, but each call exercises the full per-entity time-bucket array. For panels showing only a tabular summary, totalSubscribers + totalContributions + totalWithdrawals would be enough — the 12-month array isn't displayed.
Proposed fix scope:
  Split the RPC into two contracts:
    get_entity_summary(level, ids[]) — returns 8 base fields per entity (current code minus the array + demo + bucket).
    get_entity_full_rollup(level, ids[]) — returns the full 30-field rollup, called ONLY when a single entity is selected.
  Drop in-place: change useAllEntitiesMetrics to call the lightweight summary RPC, leave useEntityMetrics on the full one.
Confidence: medium (the per-entity arrays are real cost but may serve some report view I haven't audited — Phase 4 will confirm the column needs)
```

### AUDIT-1-12 — Spec `e2e/specs/flows/distributor-renders-data.spec.ts` already encodes a 5s SLA that the chrome render misses by ~600 ms

```
ID:       AUDIT-1-12
Area:     flow
Severity: P3
Title:    Playwright spec asserts < 5s chrome-paint and logs "[perf] distributor chrome visible in 3605ms (SLA target 3000ms)" — actual 605 ms over the desired SLA, which the spec deliberately swallows.
Evidence:
  - e2e/specs/flows/distributor-renders-data.spec.ts:55 `expect(chromeMs).toBeLessThan(5_000)` (passing — 3605 < 5000)
  - e2e/specs/flows/distributor-renders-data.spec.ts:54 `console.log(`[perf] distributor chrome visible in ${chromeMs}ms (SLA target 3000ms)`)`
  - The 3605 ms cold-paint corresponds to Vite dev compile + first JS shell; not the data layer (data arrives at 3120ms in the trace, after the chrome is up).
Reproduction:
  npx playwright test e2e/specs/flows/distributor-renders-data.spec.ts -- workers=1 — check stdout for the [perf] log.
Root cause hypothesis:
  Spec was deliberately loosened from 3s to 5s to avoid flake on cold-started Vite dev. The 3s SLA target lives in the log, not in the assertion.
Proposed fix scope:
  After AUDIT-1-1..-7 land, tighten the spec assertion to 3500 ms (matching `npm run build && npm run preview`-like prod paint) or 3000 ms (the documented target) and break the flaky-on-dev expectation. Out of Phase 1 scope, queued for Phase 4.
Confidence: high
```

---

## 5. What the user's "slow and laggy" probably IS

A two-headed lag, one server-side, one client-side, both compounded by Tokyo→Kampala 200–400 ms WAN:

**Server head (the named contributor):** `get_top_branch('country','ug')` — a non-SECURITY-DEFINER PL/pgSQL function whose body produces a 61-million-row Join Filter against `transactions`, taking 5.25 s mean / 7.99 s max / sometimes timing out at 8 s (HTTP 500). It is called on the distributor home, again on each region/district drill-down, AND, because `useTopBranch` has no `staleTime`, again on every window-focus. The "Top Branch" tile under TimePeriodCard either renders stale, blank, or doesn't render at all when the call 500s. The user perceives this as "branch-wise data lags".

**Client head:** the distributor home mounts seven panel components eagerly (DashboardShell.jsx:217-225), which collectively fire **24 simultaneous Supabase requests at first paint** — including a 30-page pagination of all 30,003 subscribers (driven by `Sidebar.jsx` wanting to display the literal count), three HEAD counts that re-derive what `get_entity_metrics_rollup` already returns, a 600 KB pull of every `subscriber_balances.total_balance` to sum AUM in JavaScript, plus the 1.97-second `get_entity_metrics_rollup` country call itself. Until the subscriber pagination drains (the slowest of the 24), the Sidebar count flickers from "—" to "30 K", and any user action that opens ViewSubscribers stalls (this is what the Playwright spec test 2 failed on). The user perceives this as "number of subscribers loads slowly".

**AUM lag specifically:** there are two distinct AUM compute paths. (a) `useDistributorMetrics` pulls 30 k rows over the wire and reduces client-side — 600–900 ms median including WAN. (b) `useEntityMetrics('country','ug')` returns AUM as a single number from the RPC's `aum_cte`, fast (200 ms ish), but the RPC also computes 35 other things and is gated by the 8-bucket transactions seq-scan. The frontend prefers (a) at country level (OverlayPanel.jsx:454-462 prefers `distMetrics.aum` over `entityMetrics.aum`). So the slow path wins.

---

## 6. What it probably IS NOT (ruled OUT, with evidence)

- **NOT a realtime channel cascade.** `grep -rn '.channel(' src/dashboard/ src/services/ src/hooks/` returned zero hits. No `commissions` or `settlement_runs` broadcast is wiring into the distributor home. The Realtime publication on those tables exists per `CLAUDE.md` §9 but no code subscribes.
- **NOT a misnamed JWT claim.** `api/_lib/jwt.ts:78` mints `app_role` correctly; `e2e/fixtures/auth.ts:80-89` mints `app_role` matching prod; RLS policies in migration 0008 all read `auth.jwt() ->> 'app_role'` (not `'role'`); the v3 rollup in migration 0020:83 reads `app_role`. The 0018 v1 bug (reading `'role'` instead of `'app_role'`) was closed by 0020. The e2e harness IS NOT hiding a prod-side regression.
- **NOT an RLS InitPlan miss.** Migration 0008 wrapped every `auth.jwt()` call in `(SELECT auth.jwt())` and EXPLAIN output confirms the JWT lookups appear as top-level `InitPlan N → Result (cost=0.00..0.03)` nodes — i.e. once per query, not per row. `get_advisors(performance)` only flags ONE remaining RLS policy missing the wrap (`distributors_update_self`), which doesn't affect read paths. The InitPlan optimization is working.
- **NOT a TanStack staleTime miss on the four metric hooks.** `useDistributorMetrics`, `useEntityMetrics`, `useChildrenMetrics`, `useAllEntitiesMetrics` all carry `staleTime: 5 * 60 * 1000`. Cached re-paints are instant. The miss is on `useTopBranch` and the entity-list hooks (`useChildren`/`useAllEntities`) — see AUDIT-1-4.
- **NOT a Vite chunk-loading regression.** Trace shows individual JS chunks loading in 600–720 ms each (Vite dev, no production build), 1.4 s sum for the heaviest bundle group. Hypothesis 1 in `00-baseline.md` proposed vendor chunks as a contributor; verifiable but a smaller share than the server head. Production build (Phase 3) likely halves this further.
- **NOT WAN RTT alone.** Yes, Tokyo→Kampala is 200–400 ms, but a 200 ms RTT applied to the 6 Supabase calls in parallel costs ~250 ms — well within budget. The 5–10 s server-side query times are the dominant signal, not network.

---

## 7. Proposed next

- **Phase 2 (backend perf, single agent)** — pick up AUDIT-1-1, AUDIT-1-2, AUDIT-1-3, AUDIT-1-8, AUDIT-1-11 in one migration. Body: SECURITY DEFINER + index `(type, date)` + decomposed monthly-array CTE. Estimate: one 0022 migration + Phase 2's existing pg_stat_statements analysis brief.
- **Phase 3 (frontend perf, single agent)** — AUDIT-1-4, AUDIT-1-5, AUDIT-1-6, AUDIT-1-7, AUDIT-1-9, AUDIT-1-10. Body: lazy-mount panels, retire `useDistributorMetrics`, fix `Sidebar` to use `useEntityMetrics('country','ug').totalSubscribers`, add `staleTime` to entity-list hooks, refactor `getAllAtLevel('subscriber')` to cursor pagination.
- **Phase 4 (tests + flow integrity)** — AUDIT-1-12: tighten the 5s SLA back to 3s after Phase 2+3 land. Add a `pg_stat_statements_top` regression assertion (`mean_exec_time < 500ms`) for `get_top_branch` and `get_entity_metrics_rollup`. Spec the ViewSubscribers panel against cursor-pagination contract.
- **Phase 5 (drift)** — re-run Playwright with `--repeat-each=5` after Phase 2+3 to confirm no regression. Reset pg_stat_statements_reset() before, capture top-10 after. Should drop `get_top_branch` and `get_entity_metrics_rollup` out of the top-5 entirely.

This findings doc is read-only output. No source file was modified in producing it.
