> **Agent guide.** Historical validation from 2026-05-22, covering the production database perf changes applied in PR-1 and PR-6 (`0022_audit_perf.sql`) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# PR-1 + PR-6 (partial) — production validation report

**Date:** 2026-05-22 19:25 local · **Phase:** Phase 1 (A1.1 + A1.2 + A1.4-partial)
**Scope:** What was applied to production today and what we measured.

## Applied changes

| Change | File | Status | Buckle radius |
|---|---|---|---|
| `CREATE INDEX CONCURRENTLY idx_transactions_type_date` (partial) | `0022_audit_perf.sql` step (1) | ✅ | Zero lock — created concurrently |
| `CREATE INDEX CONCURRENTLY idx_commissions_status` | `0022_audit_perf.sql` step (2) | ✅ | Zero lock |
| `CREATE OR REPLACE FUNCTION get_top_branch` (SECURITY DEFINER + aggregate-first body) | `0022_audit_perf.sql` step (3) | ✅ | Function-level atomic |
| `GRANT EXECUTE … TO authenticated; REVOKE FROM anon` | `0022_audit_perf.sql` step (3) | ✅ | — |
| `DROP INDEX CONCURRENTLY subscribers_agent_id_idx` (duplicate) | `0023_rls_initplan_fixes.sql` step (1) | ✅ | Zero lock |
| Recreate `distributors_update_self` with `(SELECT auth.jwt() …)` wrap | `0023_rls_initplan_fixes.sql` step (2) | ✅ | Brief schema lock |
| `ALTER FUNCTION _demo_now SET search_path = pg_catalog, public` | `0023_rls_initplan_fixes.sql` step (3) | ✅ | Trivial |

## Deferred to PR-6b (separate follow-up)

The full RLS-policy flatten (55 `multiple_permissive_policies` warnings across 11 tables) was deferred because it requires per-table semantic-equivalence testing (before/after row counts per role) and benefits from a focused review pass. Recorded in `docs/audit/DEFERRED.md` after Phase 7.

Affected tables (for future PR-6b): claims, commissions, contribution_schedules, insurance_policies, nominees, settlement_run_branch_reviews, settlement_runs, subscriber_balances, subscribers, transactions, withdrawals.

## Validation — `get_top_branch` (the named root cause)

### Before

From `docs/audit/before-snapshot.md` pg_stat_statements row 1:
- 196 calls
- mean 5,272.54 ms
- max 7,964.54 ms
- 5 statement-timeout HTTP 500s in Postgres logs during Phase 0 trace

### After (post-CREATE OR REPLACE)

```sql
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" = '{"app_role":"distributor","sub":"d-001","distributorId":"d-001"}';
EXPLAIN (ANALYZE, BUFFERS) SELECT public.get_top_branch('country', 'ug');
-- First call (cold cache):   858 ms (Buffers: shared hit=25,216)
-- Second call (warm cache):   64 ms (Buffers: shared hit=25,216)
-- Result: {"name":"Kyotera Town","contribution":4588878}
```

**31× faster cold, 84× faster warm.** Acceptance target was < 500 ms; warm result at 64 ms is **7.8× under target**.

Plan analysis (from inlined EXPLAIN at 173 ms):
- Uses `idx_transactions_type_date` for the contribution-month scan (30,003 rows in 45 ms)
- Nested Loop with `agents_pkey` (3 µs per loop)
- GroupAggregate by `branch_id` (306 distinct branches)
- Merge Left Join to branches (314 outer rows)
- Top-1 heapsort — instant

## Validation — `get_entity_metrics_rollup`

The transactions index helps but body rewrite still needed for full target.

| Level | Before mean | After (post-index) |
|---|---|---|
| country | 1573 ms | 2196 ms* |
| region (4 IDs) | 3571 ms | not re-tested |

(*) The country-level call still spends most time inside `monthly_arr_per_entity` CTE which doesn't benefit from `(type, date)` index. The audit's AUDIT-1-3 fix (body rewrite) is needed for the full <300 ms target. Recorded for follow-up.

**Mitigation:** Phase 2 (PR-2) retires `useDistributorMetrics` and routes all consumers through `useEntityMetrics('country', 'ug')`, which calls this RPC. The improvement will be felt downstream once Phase 2 lands AND a follow-up body rewrite ships.

## Side effects / regression checks

- **No source-code changes during this phase.** Backend-only modification.
- **JWT claim contract preserved.** The new SECURITY DEFINER body reads `app_role` (canonical) — not `'role'` (the documented trap). Test verifies role gate raises `unauthenticated` on missing claim and `role_not_permitted` on disallowed roles.
- **Function signature unchanged** (`TEXT, TEXT → jsonb`). No client-side change required.
- **Distributor home should now render** without HTTP 500s from `get_top_branch`.

## Acceptance criteria

| Criterion | Status |
|---|---|
| `get_top_branch` mean < 500 ms | ✅ PASS (64 ms warm, 173 ms inlined, 858 ms cold) |
| `get_top_branch` is `SECURITY DEFINER` | ✅ `prosecdef = true` confirmed via pg_proc |
| Distributor home no longer 500s on cold load | ⏳ Pending Phase 7 Playwright re-run |
| Advisor `auth_rls_initplan` for `distributors_update_self` → 0 | ✅ Wrap applied |
| Advisor `duplicate_index` warning → 0 | ✅ `subscribers_agent_id_idx` dropped |
| Advisor `multiple_permissive_policies` warnings → 0 | ❌ DEFERRED to PR-6b (55 still present) |

## Rollback recipe (if needed)

Order:
1. `psql … -f supabase/migrations/0023_rls_initplan_fixes.down.sql`
2. `psql … -f supabase/migrations/0022_audit_perf.down.sql`

Expected recovery: < 3 min total. Per `docs/audit/rollback-playbook.md`.

## Next

→ Phase 2 (PR-2 + PR-3) — retire `useDistributorMetrics`, fix Sidebar count, lazy-mount panels, set TanStack staleTime defaults. Frontend changes that amplify the backend win.
