> **Agent guide.** Historical playbook from 2026-05-22, covering per-PR rollback and recovery procedures for the audit-remediation sprint — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Rollback playbook — sprint per-PR recovery procedures

**Date:** 2026-05-22 · **Phase:** Phase 0 (A0.3)
**Purpose:** If any sprint PR causes a production regression, this doc tells you exactly how to roll back, how long it takes, and how to verify recovery.

## Auto-deploy reminder

Per `CLAUDE.md §1`: pushes to `main` auto-deploy to `uganda-dashboard.vercel.app`. **Every PR requires explicit human approval before merge.** Vercel keeps a deployment history — instant-revert is via `vercel rollback <previous-deployment>` from the dashboard or CLI.

## Production state snapshot (informs rollback estimates)

From `pg_class` (captured 2026-05-22):

| Table | Rows | Total size | Table size | Largest index |
|---|---|---|---|---|
| `transactions` | **522,133** | **176 MB** | 69 MB | `transactions_pkey` 49 MB + `transactions_subscriber_id_date_idx` 46 MB |
| `nominees` | 145,177 | 32 MB | 17 MB | `nominees_pkey` 13 MB |
| `subscribers` | 30,003 | 18 MB | 12 MB | `subscribers_phone_unique_non_demo_idx` 2.4 MB |
| `commissions` | 30,003 | 8.9 MB | 4.5 MB | `commissions_pkey` 1.3 MB |
| `withdrawals` | 29,783 | 6.8 MB | 3.4 MB | |
| `contribution_schedules` | 30,000 | 4.6 MB | 2.5 MB | |
| `subscriber_balances` | 30,000 | 4.4 MB | 2.2 MB | |
| `agents` | 2,049 | 1.4 MB | 1.0 MB | |
| `branches` | 316 | 168 KB | 56 KB | |

## Duplicate index already confirmed (PR-6)

| Table | Index | Size | Status |
|---|---|---|---|
| `subscribers` | `idx_subscribers_agent_id` | 264 KB | Keep |
| `subscribers` | `subscribers_agent_id_idx` | 728 KB | **Drop in PR-6** |

---

## PR-1 — DB perf migration (`0022_audit_perf.sql`)

**Risk:** HIGH. Adds 2 indexes + rewrites 2 RPCs.

### What can go wrong
- Index build (CONCURRENTLY) fails mid-creation → index marked INVALID; query planner ignores it (no harm) but disk space is consumed.
- `get_top_branch` SECURITY DEFINER rewrite returns wrong shape → frontend `useTopBranch` consumers crash.
- RLS predicates evaluated differently inside SECURITY DEFINER → distributor sees data they shouldn't (security regression).
- `(type, date)` partial index doesn't accelerate as expected → mean times don't drop → user-visible lag persists.

### Pre-rollback checks
1. Confirm regression via `mcp__supabase__get_logs(service='postgres')` — look for new error patterns post-deploy.
2. Confirm regression via `pg_stat_statements` mean times — are they WORSE than baseline (`docs/audit/before-snapshot.md`)?
3. Confirm RLS regression via `e2e/specs/db/invariants.spec.ts` (existing) + manual `SET LOCAL "request.jwt.claims"` test.

### Rollback steps

**Option A — Apply DOWN migration (preferred):**
```bash
# 1. Apply the down migration
# Via Supabase MCP:
#   mcp__supabase__apply_migration with `supabase/migrations/0022_audit_perf.down.sql`
# OR via psql:
psql "$SUPABASE_DB_URL" -f supabase/migrations/0022_audit_perf.down.sql

# 2. Verify rollback
psql "$SUPABASE_DB_URL" -c "SELECT prosecdef FROM pg_proc WHERE proname='get_top_branch';"
# Expect: 'f' (back to non-SECURITY-DEFINER)

# 3. Verify indexes dropped
psql "$SUPABASE_DB_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='transactions' AND indexname='idx_transactions_type_date';"
# Expect: 0 rows
```

**Option B — Manual SQL rollback (if migration framework can't replay):**
```sql
-- Drop the two new indexes (safe — CONCURRENTLY, no lock)
DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_type_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_commissions_status;

-- Restore get_top_branch to pre-migration definition
-- (Get from `supabase/migrations/0018_entity_metrics_rollup.sql` body — it's the definitive pre-PR-1 version)
-- CREATE OR REPLACE FUNCTION get_top_branch(...) ... ;  -- paste body here

-- Restore monthly_arr_per_entity CTE inside get_entity_metrics_rollup
-- Same approach — paste body from migration 0020_entity_metrics_rollup_v3.sql
```

**Option C — Vercel-side mitigation (frontend hot-fix):**
If only `useTopBranch` consumers break (HTTP 500s reach UI), temporarily disable the hook:
```js
// src/hooks/useEntity.js — useTopBranch:
return useQuery({ ..., enabled: false });  // <-- temporary
```
Then `git push` to main; Vercel redeploys in ~60s. Restores graceful degradation while DB rollback proceeds.

### Expected recovery time
- **Option A:** 2-5 min (DROP INDEX CONCURRENTLY is fast on 522K-row table).
- **Option B:** Same as A.
- **Option C:** ~60 s (Vercel redeploy).

### Lock duration concerns
- `CREATE INDEX CONCURRENTLY idx_transactions_type_date` on 522K rows: estimated **20-60 s** of background work but **no exclusive lock** — reads + writes proceed unblocked.
- `DROP INDEX CONCURRENTLY`: similar — no lock.
- `CREATE OR REPLACE FUNCTION`: brief schema-level lock (< 1 s).

**Therefore PR-1 should NOT trigger production downtime** even at peak traffic. Verify by deploying during low-traffic window anyway.

### Verification queries
```sql
-- After rollback, mean times should match before-snapshot.md baseline
SELECT mean_exec_time, max_exec_time FROM extensions.pg_stat_statements
WHERE query LIKE '%get_top_branch%';

-- No new error logs after the rollback timestamp
-- Use mcp__supabase__get_logs(service='postgres')
```

---

## PR-4 — Cursor pagination (`useInfiniteEntityList`)

**Risk:** LOW. Frontend-only; back-compat for non-subscriber lists.

### What can go wrong
- ViewSubscribers' search/filter break because they operated on the full in-memory list.
- Virtualizer's `onEndReached` doesn't fire (TanStack Virtual API mismatch).
- Empty list edge case: `total === 0` UI didn't update.

### Rollback steps
1. `git revert <PR-4-merge-sha>` on `main`.
2. `git push origin main` — Vercel auto-deploys previous bundle.

### Expected recovery time
~60 s (single Vercel deploy).

### Verification
- ViewSubscribers panel re-renders the 30-page paginated fetch (back to slow but functional).
- `e2e/specs/flows/distributor-renders-data.spec.ts` returns to FAILING state (the symptom).

---

## PR-5 — `upsert_nominees` RPC (`0024_upsert_nominees.sql`)

**Risk:** LOW-MEDIUM. New RPC + CHECK constraint on `nominees`.

### What can go wrong
- CHECK constraint on `share_pct BETWEEN 0 AND 100` rejects existing data (if any current row has share_pct outside that range — let's verify pre-migration with a SELECT count check).
- RPC denies legitimate update due to `SUM = 100` rounding (e.g., 99.99) — see remediation plan risk register.
- Direct mutation removal in `subscriber.js:752,787` breaks if RPC call signature is wrong.

### Pre-deploy check
```sql
-- Confirm no current rows would violate the new CHECK
SELECT count(*) FROM nominees WHERE share_pct NOT BETWEEN 0 AND 100;
-- Expect: 0
```

If non-zero, **STOP** — fix data before applying migration.

### Rollback steps
**Option A — Apply DOWN:**
```bash
mcp__supabase__apply_migration  # with 0024_upsert_nominees.down.sql
```
Drops the RPC + the CHECK constraint. Frontend service-layer code must be reverted simultaneously (PR-5's service refactor commit).

**Option B — Vercel revert + DB DOWN:**
1. `git revert <PR-5-merge-sha>` → push → Vercel deploys old service code.
2. Apply DOWN migration to drop RPC + CHECK.

### Expected recovery time
~3-5 min total.

---

## PR-6 — RLS flatten + duplicate index drop (`0023_rls_flatten.sql`)

**Risk:** MEDIUM. Touches 11 SELECT policies.

### What can go wrong
- Flattened CASE-based policy has different semantics → role sees rows it shouldn't (security regression) or rows it should but doesn't (UX regression).
- `DROP INDEX subscribers_agent_id_idx` chooses the wrong one → query planner falls back to slower index.
- `distributors_update_self` InitPlan wrap silently denies updates.

### Pre-rollback validation
Run the SELECT-by-role test from A1.4 deliverable — compare row counts before and after for each (role, table) pair.

### Rollback steps
```bash
mcp__supabase__apply_migration  # with 0023_rls_flatten.down.sql
```
Restores the 4-way OR'd policies + recreates `subscribers_agent_id_idx` (CONCURRENTLY).

### Lock duration
- `DROP POLICY` / `CREATE POLICY`: brief schema lock.
- `CREATE INDEX CONCURRENTLY subscribers_agent_id_idx`: < 30 s on 30K rows.

### Expected recovery time
< 2 min.

---

## PR-2 + PR-3 — Frontend metric layer

**Risk:** MEDIUM. `useDistributorMetrics` deletion + lazy-mount.

### What can go wrong
- A consumer of `useDistributorMetrics` was missed in the grep → undefined-is-not-a-function error.
- Lazy-mount breaks a panel that depended on always-mounted state preservation.
- Global `staleTime` causes a mutation-invalidated query to feel stale.

### Rollback steps
1. `git revert <PR-2-merge-sha>` OR `git revert <PR-3-merge-sha>` (separately — they're separate PRs).
2. `git push origin main` — Vercel auto-deploys.

### Expected recovery time
~60 s per PR.

---

## PR-7 — `postgrest-js` swap

**Risk:** HIGH. Touches every service file + the QueryClient setup.

### What can go wrong
- Response shape differs from supabase-js → callers destructure wrong.
- Auth header injection differs → 401 storm.
- `.rpc()` error shape differs → existing error handlers don't catch.

### Pre-deploy check
Phase 5 (A5.1) scope-check must return SAFE before merging. If not, halt PR-7.

### Rollback steps
1. `git revert <PR-7-merge-sha>` → push.
2. If supabase-js was uninstalled, `npm install @supabase/supabase-js`; commit; push.

### Expected recovery time
~3 min (Vercel deploy + npm install if needed).

---

## PR-8 — Drop realtime publication + worktree cleanup (`0025_drop_realtime_publication.sql`)

**Risk:** LOW.

### Rollback steps
```bash
mcp__supabase__apply_migration  # with 0025_drop_realtime_publication.down.sql
```

Restores publication for commissions / settlement_runs / settlement_run_branch_reviews.

### Expected recovery time
< 1 min.

---

## PR-9 + PR-10 — Doc refresh + lint cleanup

**Risk:** TRIVIAL. Docs + lint config.

### Rollback steps
`git revert <sha>` per PR.

### Expected recovery time
~60 s.

---

## Disaster recovery — multiple PRs need rollback

If multiple sprint PRs need rollback simultaneously, sequence:

1. **Frontend first** (PR-2, PR-3, PR-4, PR-7) — Vercel-deploy-revertable in seconds.
2. **DB migrations second** — sequence in REVERSE of merge order: PR-8 → PR-6 → PR-5 → PR-1.
3. **Service-role-key bypass:** if RLS regression locks legitimate users out, `SUPABASE_SERVICE_ROLE_KEY` is available in `api/_lib/supabase-admin.ts`; admin can manually fix data while rollback completes.

## Manual snapshot before each big migration

Before PR-1, PR-5, PR-6:

```sql
-- Snapshot current pg_stat_statements counts (so post-rollback verify is meaningful)
CREATE TABLE IF NOT EXISTS audit_pg_stat_snapshot (
  snapshot_at timestamptz default now(),
  query text,
  calls bigint, mean_exec_time double precision, max_exec_time double precision, total_exec_time double precision
);
INSERT INTO audit_pg_stat_snapshot (query, calls, mean_exec_time, max_exec_time, total_exec_time)
SELECT left(query, 200), calls, mean_exec_time, max_exec_time, total_exec_time
FROM extensions.pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 50;
```

Drop after sprint closeout.

---

## Acceptance — Phase 0 A0.3 exit

- [x] Per-PR rollback recipe documented above
- [x] Table sizes from `pg_class` captured (informs lock-duration estimates)
- [x] Duplicate index pair identified for PR-6
- [x] Pre-deploy CHECK for PR-5 nominee data documented
- [x] Disaster recovery sequence documented
