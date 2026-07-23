> **Agent guide.** Historical playbook from 2026-05-22, covering how to rehearse migrations on a Supabase preview branch before they touch production — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Supabase branch rehearsal protocol

> ⚠️ **HISTORICAL — the production `project_id` in this procedure is dead.** The `zengmiugieqjqzaccbqe` project referenced below (lines ~29 / ~79) was the **old Tokyo** (`ap-northeast-1`) project, **retired 2026-06-05**. The live project is now **`ilkhfnoyxlxwqadebnkp`** (Singapore, `ap-southeast-1`). The "same region as production (Tokyo)" note (~line 105) is likewise historical — production is Singapore. The **branch-rehearsal mechanics below are still valid**; before re-using this procedure, substitute the live Singapore `project_id` for every `zengmiugieqjqzaccbqe`. See `CLAUDE.md §1` for the current project.

**Date:** 2026-05-22 · **Phase:** Phase 0 (A0.5)
**Purpose:** Document how to rehearse Phase 1 / Phase 4 / Phase 6 migrations on a Supabase **branch** (preview environment) before they touch production.

## Capability confirmed

- **Branch cost:** **$0.01344 / hour ≈ $9.68 / month** per branch on the Universal Pensions org (`ugoaezmojpyvcbeeqfbz`). Plan: Pro (billing-enabled).
- **Current branches:** 0 (none in flight).
- **MCP tools available:** `mcp__supabase__create_branch`, `merge_branch`, `delete_branch`, `reset_branch`, `rebase_branch`, `apply_migration`, `list_branches`.

Branching is the cheapest, safest way to validate destructive migrations on a near-prod copy.

## When to branch

Apply this protocol for **any migration that modifies indexes / RLS / functions on tables > 10 K rows**. In this sprint:

- **PR-1** (`0022_audit_perf.sql`) — touches `transactions` (522 K rows), `commissions` (30 K rows), `get_top_branch`, `get_entity_metrics_rollup`. **MUST** rehearse.
- **PR-5** (`0024_upsert_nominees.sql`) — adds CHECK + RPC on `nominees` (145 K rows). **MUST** rehearse.
- **PR-6** (`0023_rls_flatten.sql`) — RLS rewrites on 11 tables. **MUST** rehearse.
- **PR-8** (`0025_drop_realtime_publication.sql`) — publication change, not data. **Optional**.

## Protocol

### Step 1 — Create branch

```
mcp__supabase__confirm_cost  # confirm $0.01344/hour
mcp__supabase__create_branch project_id=zengmiugieqjqzaccbqe \
  name="audit-perf-pr1"  # one branch per PR
```

Branch creation takes ~60-120 s. Branch gets its own `project_id` and `database` host. **Schema and seed data are cloned from main.** Track the new project_id for subsequent calls.

### Step 2 — Apply migration to branch

```
mcp__supabase__apply_migration project_id=<branch_project_id> \
  name="0022_audit_perf" \
  query="<contents of supabase/migrations/0022_audit_perf.sql>"
```

If migration uses `CREATE INDEX CONCURRENTLY` (it does for PR-1), it cannot run inside a transaction. Split the migration into atomic + non-atomic pieces, or use `apply_migration` with sequential calls.

### Step 3 — Validate on branch

Run the validation queries from `docs/audit/PR-N-validation.md` (authored per phase):

```sql
-- Set role + claims to match a distributor call
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"app_role":"distributor","sub":"d-001","distributorId":"d-001"}';

-- Capture mean time
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT public.get_top_branch('country', 'ug');
```

Acceptance: mean < 500 ms for `get_top_branch` (down from 5252 ms). If not hit, iterate the migration body before merging.

### Step 4 — Rollback rehearsal (also on branch)

Apply the DOWN migration:

```
mcp__supabase__apply_migration project_id=<branch_project_id> \
  name="0022_audit_perf_down" \
  query="<contents of supabase/migrations/0022_audit_perf.down.sql>"
```

Verify DOWN restores the pre-migration state (re-run the EXPLAIN; mean should regress to ~5000 ms). This proves the rollback recipe in `rollback-playbook.md` works.

### Step 5 — Merge or discard

- **If validation passed**, do NOT use `mcp__supabase__merge_branch` to apply to production. Branching's "merge" applies schema changes from branch → prod, but for this sprint we want **human approval per PR** before main-branch deploy. So:
  - Author the production-bound migration file in `supabase/migrations/`
  - Open a code PR
  - User reviews + approves
  - `mcp__supabase__apply_migration project_id=zengmiugieqjqzaccbqe` against PRODUCTION (only with user sign-off)
- **If validation failed**, iterate the migration; reset branch with `mcp__supabase__reset_branch` to start from a clean slate.

### Step 6 — Delete branch

After PR merge to main + 24h stable, delete the branch:

```
mcp__supabase__delete_branch branch_id=<branch_id>
```

Saves $0.32/day per branch.

## Branch lifecycle for each rehearsed PR

| PR | Branch name | Estimated lifetime | Cost |
|---|---|---|---|
| PR-1 | `audit-perf-pr1` | 2 days (rehearse + main merge + 24h stable) | ~$0.64 |
| PR-5 | `nominees-rpc-pr5` | 1 day | ~$0.32 |
| PR-6 | `rls-flatten-pr6` | 2 days | ~$0.64 |
| **Total** | | | **~$1.60 across sprint** |

Cheap — production safety net for $1.60.

## What branching does NOT cover

- **WAN latency.** Branch DB lives in same region as production (Tokyo). Browser-side Lighthouse from Kampala still reflects WAN; branch only catches *server-side* regressions.
- **Realtime publication state.** Branches do NOT clone realtime publication membership. PR-8's publication drop applies only to production; do not rehearse on branch.
- **Concurrent load.** Branches see no real traffic. PR-1's index build runs in isolation, no contention. Production may take slightly longer under load.

## Fallback if branching unavailable

If branching becomes unavailable (org plan downgrade, billing issue):

1. Snapshot current state via `pg_dump --schema-only` (via psql with `SUPABASE_DB_URL`).
2. Apply migration directly to production during low-traffic window.
3. Be ready to invoke DOWN migration immediately if metrics regress.
4. Document the missed rehearsal in the PR description.

Higher risk; not recommended for PR-1 / PR-6.

## Acceptance — Phase 0 A0.5 exit

- [x] Branching capability confirmed ($0.01344/hour)
- [x] Per-PR branch protocol documented above
- [x] Step-by-step MCP commands provided
- [x] Cost budget calculated (~$1.60 across sprint)
- [x] Fallback procedure documented
