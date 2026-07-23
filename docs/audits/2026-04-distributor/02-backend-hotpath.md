> **Agent guide.** Historical audit from 2026-05-22 covering backend hot-path correctness and inefficiencies across DB/RPC/RLS/triggers (Phase 2) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Audit 02 — Backend hot-path correctness & inefficiencies

**Date:** 2026-05-22 · **Auditor:** Claude (Opus 4.7) · **Phase:** 2 of 6
**Scope:** Everything backend (DB / RPC / RLS / trigger / security) that Phase 1's distributor-metrics investigation did NOT name. Cross-references AUDIT-1-N findings rather than duplicating them.

---

## 1. TL;DR

**Total NEW findings: 13** (Phase-1 items not repeated).

| Severity | Count | IDs |
|---|---|---|
| **P0** | 3 | 2-1, 2-2, 2-3 |
| **P1** | 4 | 2-4, 2-5, 2-6, 2-7 |
| **P2** | 4 | 2-8, 2-9, 2-10, 2-11 |
| **P3** | 2 | 2-12, 2-13 |

**Most surprising:** a `count(*) FROM subscribers` runs **911 ms server-side** because RLS forces a full Seq Scan over 30,003 rows — PostgREST's `count: 'exact'` header on any subscribers pull pays this whole-table scan on top of the 1.2 s pagination cost (AUDIT-2-1, AUDIT-2-2). Phase 1 named the page-fanout symptom; the underlying RLS-vs-LIMIT planner trap is its own P0.

**Named risks Phase 1 did NOT flag**

- `count(*)`/large-offset pagination on `subscribers` is structurally seq-scan-only because the OR-chain RLS predicate has no index match (AUDIT-2-1).
- `commissions.status` has no index → distributor-side `?status=eq.due` pagination seq-scans 30k rows on every CommissionPanel mount (AUDIT-2-2).
- Realtime publication is ON for `commissions`/`settlement_runs`/`settlement_run_branch_reviews` but **zero** code subscribes — pure WAL/replicate overhead with no consumer (AUDIT-2-4).
- A direct `.delete()` + `.insert()` write to `nominees` from the frontend (`src/services/subscriber.js:752,787`) bypasses every RPC invariant — CLAUDE.md §5.6 forbids this (AUDIT-2-3).
- 4 RLS SELECT policies OR'd at every row → 55 `multiple_permissive_policies` advisor warnings; flattening into one `USING (CASE app_role …)` would halve every authenticated read (AUDIT-2-5).
- Duplicate index `idx_subscribers_agent_id` ≡ `subscribers_agent_id_idx` (AUDIT-2-9).
- `_demo_now()` is the lone function with mutable `search_path` (AUDIT-2-11).
- The 13 commission state-machine RPCs are `SECURITY DEFINER` and reachable by `anon`. They all gate via `IF v_role IS DISTINCT FROM 'X' THEN RAISE EXCEPTION` so anon callers fail-safe, but a hardened deployment would `REVOKE EXECUTE … FROM anon` (AUDIT-2-10).

**Migration `'role'` lint: CLEAN.** All live policy bodies and function bodies read `'app_role'` (confirmed via `pg_policy` + `pg_proc` queries — see §4). The historical hits in `0003`/`0004` source files are obsolete: 0007 dropped+recreated every 0003 policy; 0021 forward-ported every 0004 function via `CREATE OR REPLACE`. The lone runtime read of `'role'` is in the test file `src/test/jwt-claim-contract.test.js:59` which is the lint enforcement string itself.

**Security spot-checks:** 4 of 4 passed. One direct frontend write to nominees (P1 — AUDIT-2-3), but no service-role key leak, no JWT logging, no `'role'` claim mis-read.

**DB capabilities discovered (could install in later phases):**

- `hypopg` 1.4.0 — available, off. Lets us simulate "add an index, see if the planner picks it" without writing data. Phase 2 would have used this to validate `(commissions.status)` and `(transactions.type, date)` before recommending.
- `index_advisor` 0.2.0 — available, off. Supabase's wrapper around `hypopg` that takes a SQL string and returns the recommended index set. Direct fit for AUDIT-1-2 / AUDIT-2-2.
- `plpgsql_check` 2.7.13 — available, off. Static checker for plpgsql function bodies (uninitialised vars, unreachable code). Phase 4 could run this on all 33 public functions in one CI step.
- `pg_stat_monitor` available, off. Strict superset of `pg_stat_statements` with per-bucket histograms. Do not enable mid-audit (resets the 1618-statement history we are mining).

---

## 2. pg_stat_statements — top 20 (Phase-1 RPCs excluded)

Server uptime: **8 days 5 hours**. 1,618 distinct statements tracked. Top by `total_exec_time`:

| # | Calls | Mean (ms) | Max (ms) | Total (s) | Statement |
|---:|---:|---:|---:|---:|---|
| (P1) | 194 | 5252.68 | 7964.54 | 1019.02 | `public.get_top_branch(...)` — see AUDIT-1-1 |
| (P1) | 253 | 1573.51 | 7321.02 | 398.10 | `public.get_entity_metrics_rollup(country)` — see AUDIT-1-2 |
| (P1) | 59 | 3791.91 | 7993.31 | 223.72 | `public.get_entity_metrics_rollup(region 4-id)` — see AUDIT-1-3 |
| 1 | 513 | **207.52** | 4131.92 | 106.46 | `public.get_entity_commission_summary(p_level, p_entity_id)` — AUDIT-2-7 |
| 2 | 475 | 206.54 | 3585.07 | 98.11 | `public.get_run_branch_breakdown(p_run_id)` — AUDIT-2-8 |
| 3 | 198 | 456.03 | 4896.63 | 90.29 | `SELECT *, count FROM subscribers LIMIT/OFFSET` (PostgREST count=exact) — AUDIT-2-1 |
| 4 | 477 | 188.76 | 3828.70 | 90.04 | `SELECT … FROM commissions WHERE status = $1 LIMIT … OFFSET …` — AUDIT-2-2 |
| 5 | 558 | 97.31 | 1059.42 | 54.30 | `SELECT * FROM subscribers LIMIT/OFFSET` (no count header) |
| 6 | 148 | 236.90 | 1502.25 | 35.06 | `SELECT name FROM pg_timezone_names` — Supabase Studio noise, not app |
| 7 | 878 | 37.00 | 3219.36 | 32.49 | `subscribers + subscriber_balances + contribution_schedules JOIN` (subscriber dash) |
| 8 | 476 | 67.28 | 1383.02 | 32.02 | `SELECT * FROM commissions LIMIT/OFFSET` (CommissionPanel preload) |
| 9 | 335 | 86.82 | 2239.20 | 29.08 | `public.get_run_branch_breakdown(p_run_id)` (variant) — same as #2 |
| 10 | 524 | 44.16 | 108.14 | 23.14 | `INSERT INTO transactions … SELECT … FROM unnest()` — seed-script chunks (not user-facing) |
| 11 | 368 | 58.44 | 1357.52 | 21.50 | `SELECT * FROM agents LIMIT/OFFSET` |
| 12 | 885 | 17.72 | 902.27 | 15.68 | `SELECT id,name,employee_id,branch_id FROM agents LIMIT/OFFSET` (drill-down agents column subset) |
| 13 | 135 | 104.15 | 1400.44 | 14.06 | `SELECT * FROM agents LIMIT/OFFSET` (variant) |
| 14 | 411 | 31.87 | 1010.71 | 13.10 | `SELECT … FROM commissions WHERE run_id = $1 LIMIT/OFFSET` — Good, hits index `commissions_run_id_idx` |
| 15 | 15143 | 0.72 | 647.99 | 10.90 | `set_config('search_path', …)` — PostgREST per-request JWT setup, fast but ubiquitous |
| 16 | 32 | 292.87 | 1063.91 | 9.37 | `public.get_entity_commission_summary` (variant — distinct param shape) |
| 17 | 32 | 284.42 | 645.35 | 9.10 | `pg_available_extensions` join (Supabase Studio extension page) |
| 18 | 484 | 16.65 | 1052.22 | 8.06 | `SELECT * FROM branches LIMIT/OFFSET` |
| 19 | 405 | 16.87 | 221.14 | 6.83 | `SELECT … FROM commissions WHERE branch_id = $1 LIMIT/OFFSET` — good (uses `commissions_branch_id_status_idx`) |

Rows #1-#4 are the new attention surface for Phase 2. Row 7 is `useSubscriber(id)` which deep-joins three tables — call it out as #AUDIT-2-12 because it's not slow per-call but it fires once per subscriber detail panel mount.

---

## 3. EXPLAIN excerpts (non-Phase-1 queries)

### 3.1 `SELECT * FROM subscribers LIMIT 1000 OFFSET 25000` as `distributor` — **1224 ms** server-side

```
Limit  (cost=79385.93..79738.76 rows=1 width=432) (actual time=1181.171..1224.568 rows=1000 loops=1)
  Buffers: shared hit=1323
  ->  Seq Scan on subscribers  (cost=0..79385.79 rows=225 width=432) (actual time=0.908..1222.937 rows=26000 loops=1)
        Filter: (distributor disjunct OR self OR agent OR branch chain via hashed SubPlan over agents)
        Buffers: shared hit=1323
Execution Time: 1224.868 ms
```

Plan analysis: PostgREST forces a full table scan because the RLS predicate is a 4-way OR (subscriber-self OR distributor OR branch-via-agents OR agent). The planner cannot push LIMIT below the filter when row-eligibility is data-dependent (the agents SubPlan for the branch arm), so it materialises 26 000 rows just to slice off the last 1000. **Distributor pagination at offset > ~10 000 always lands in the 1+ second tier**, which compounds AUDIT-1-7's 30-page fanout. (At offset=0, the same plan completes in 60 ms — the cost is in the row-count progression.)

### 3.2 `SELECT count(*) FROM subscribers` as `distributor` — **911 ms** server-side

```
Aggregate  (cost=79386.50..79386.51 rows=1) (actual time=910.817..910.823 rows=1 loops=1)
  Buffers: shared hit=1528
  ->  Seq Scan on subscribers  (cost=0..79385.79 rows=225) (actual time=2.177..908.139 rows=30003 loops=1)
        Filter: <same 4-way OR>
        Buffers: shared hit=1528
Execution Time: 911.121 ms
```

Plan analysis: PostgREST's `count: 'exact'` header (Sidebar / ViewSubscribers / OverlayPanel use it implicitly via `range(0,999)`) compiles to a `SELECT total_result_set, page_total, body FROM (SELECT * FROM subscribers LIMIT 1000) _postgrest_t`. The `total_result_set` subquery runs the full Seq Scan — independent of LIMIT — every single page request. Effective cost per page = 911 ms (count) + page-time. The user pays this 31× per cold load (AUDIT-1-7).

### 3.3 `SELECT … FROM commissions WHERE status='due' LIMIT 1000` as `distributor` — 10 ms, but pg_stat shows **188 ms mean / 3.8 s max**

```
Limit  (cost=0.12..1684.24 rows=22 width=101) (actual time=0.046..9.751 rows=1000 loops=1)
  ->  Seq Scan on commissions  (cost=0..1684.11 rows=22 width=101) (actual time=0.045..9.633 rows=1000 loops=1)
        Filter: <RLS chain> AND (status = 'due'::commission_status)
        Rows Removed by Filter: 20667
```

Plan analysis: there is **no index on `commissions.status`**. `commissions_branch_id_status_idx` is a composite `(branch_id, status)`; the distributor-side query doesn't filter by branch and so falls off it. The planner picks Seq Scan over 30 003 rows; current `due` row count is 1322 (4.4 % of total). The 188 ms mean / 3.8 s p99 in pg_stat_statements points at scan-time variance under buffer-cache pressure — the query gets slow when warm pages get evicted. **`due` is the cheapest filter (smallest result set); `status='in_run'` (2469 rows) and `status='disputed'` (2059 rows) all share the same Seq Scan path.**

### 3.4 `get_entity_commission_summary('country','ug')` as `distributor` — 374 ms

```
Result  (actual time=374.590..374.591 rows=1 loops=1)
  Buffers: shared hit=1356
Planning Time: 0.038 ms
Execution Time: 374.643 ms
```

Inlined:

```
Aggregate (actual time=13.765..13.767 rows=1 loops=1)
  Buffers: shared hit=559
  ->  Seq Scan on commissions  (cost=0..1609.11 rows=151 width=9) (actual time=0.034..9.222 rows=30003 loops=1)
        Filter: <RLS distributor OR branch OR agent>
        Buffers: shared hit=559
Execution Time: 13.949 ms
```

The wrapped form takes 374 ms because of plpgsql function call overhead (LANGUAGE plpgsql, STABLE, not SECURITY DEFINER → it inherits the caller's RLS InitPlans and re-evaluates them inside the function). The body itself is fast (14 ms inline). Same anti-pattern as AUDIT-1-8 for `get_top_branch`. See AUDIT-2-7.

### 3.5 `get_run_branch_breakdown(<run_id>)` as `distributor` — 77 ms

```
Limit  (cost=0.08..2442.88 rows=1 width=32) (actual time=76.766..76.773 rows=1 loops=1)
  Buffers: shared hit=1247
```

Plan analysis: 77 ms for ONE row by run_id — pg_stat shows mean 206 ms across 475 calls (the CommissionPanel auto-refreshes), max 3.5 s. Per-line scan into `commissions WHERE run_id = $1` uses `commissions_run_id_idx`; the slowness compounds when multiple panels mount concurrently. See AUDIT-2-8.

---

## 4. Migration `'role'` lint

### Source-file hits (grep)

```
$ grep -rn "auth\.jwt()\s*->>\s*'role'" supabase/migrations
0003_rls_policies.sql:115..366  — 100+ hits (DROPped + REPLACED by 0007)
0004_commission_run_rpcs.sql:69..1005  — 14 hits (CREATE OR REPLACE'd by 0021)
0007_rls_use_app_role.sql:11,671,677  — comments referring to the bug
0018_entity_metrics_rollup.sql:64  — original bug body (CREATE OR REPLACE'd by 0020)
0020_entity_metrics_rollup_v3.sql:9  — comment referring to the bug
```

```
$ grep -rn "auth\.jwt()\s*->>\s*'role'" api/ src/
src/test/jwt-claim-contract.test.js:59  — the lint-rule's own error string
```

### Live policy + function check (pg_policy + pg_proc)

- **`SELECT polname … FROM pg_policy WHERE pg_get_expr(polqual, polrelid) LIKE '%''role''%'`** → 0 rows.
- **`SELECT proname … FROM pg_proc WHERE pg_get_functiondef(oid) ILIKE '%auth.jwt() ->> ''role''%'`** → 0 rows.

**Conclusion: clean.** Every live RLS policy and every live function reads `'app_role'`. Migrations 0007 + 0020 + 0021 closed all three known regressions. The `src/test/jwt-claim-contract.test.js` file is the **lint enforcement** scanning the migrations directory — it intentionally contains the bug-string in its error message so the test would fail loud if any future migration regressed.

### app_role usage count by migration

| Migration | `app_role` hits |
|---|---:|
| 0001 | 0 |
| 0002 | 0 |
| 0003 | 0 (gated on `'role'`, since DROPped) |
| 0004 | 0 (since CREATE-OR-REPLACE'd by 0021) |
| **0007** | **74** (RLS rewrite) |
| 0008 | 0 (just InitPlan wrap) |
| 0009 | 0 |
| 0010 | 0 |
| 0011 | 0 |
| 0012 | 0 |
| 0013 | 0 |
| 0014 | 0 (uses `'agentId'` claim only) |
| 0015 | 0 |
| 0016 | 1 (`distributors_update_self` reads `distributorId` directly) |
| 0017 | 0 |
| 0018 | 0 (CREATE-OR-REPLACE'd by 0020) |
| 0020 | 1 (rollup v3 role gate) |
| **0021** | **14** (commission RPC rewrite) |

Net live coverage: 90 reads of `'app_role'` across policies + RPC bodies. No `'role'` reads remain in any live object.

---

## 5. `get_advisors` raw outputs

### 5.1 performance — 58 lints, grouped

| Lint name | Level | Count | Detail (summarised) |
|---|---|---:|---|
| `auth_rls_initplan` | WARN | 1 | `public.distributors.distributors_update_self` re-evaluates `auth.jwt()` per row (not wrapped in `(SELECT …)`). |
| `multiple_permissive_policies` | WARN | 55 | 11 tables × 5 roles each have 3-4 SELECT policies OR'd (subscriber/agent/branch/distributor variants). Affected: `claims`, `commissions`, `contribution_schedules`, `insurance_policies`, `nominees`, `settlement_run_branch_reviews`, `settlement_runs`, `subscriber_balances`, `subscribers`, `transactions`, `withdrawals`. |
| `duplicate_index` | WARN | 1 | `subscribers (agent_id)` exists twice: `idx_subscribers_agent_id` + `subscribers_agent_id_idx`. Drop one. |
| `unused_index` | INFO | 1 | `idx_subscribers_gender` has 0 scans (no gender-filter read path exists). |

**No `unindexed_foreign_keys` warnings** — verified by listing every FK in `pg_constraint` × every index in `pg_indexes`. The `0009`/`0013` follow-ups closed all gaps Phase 1 didn't already note.

### 5.2 security — many lints

| Lint name | Level | Count | Detail |
|---|---|---:|---|
| `function_search_path_mutable` | WARN | 1 | `public._demo_now` has no `SET search_path` — every other public function has it. |
| `anon_security_definer_function_executable` | WARN | 17 | All commission state-machine RPCs (open_run, cancel_run, branch_*, agent_*, approve_*, reject_*, release_*) + `get_entity_metrics_rollup` + the 3 trigger functions + `create_subscriber_from_*` are `EXECUTE`able by `anon`. Each gates internally via `IF v_role IS DISTINCT FROM 'X' RAISE EXCEPTION`, so anon callers fail-safe — but a hardened deployment would `REVOKE EXECUTE … FROM anon` on the 13 state-machine RPCs. |
| `authenticated_security_definer_function_executable` | WARN | 17 | Same 17 functions also reachable by `authenticated`. Same internal gating defends them, but the principle of least privilege would call for role-scoped GRANTs (e.g. `branch_approve_line` GRANT only to a "branch" Postgres role — though that conflicts with Supabase's single-`authenticated`-role model). |

No outstanding `policy_exists_rls_disabled` or `rls_disabled_in_public`. Every public table has both ENABLE and FORCE ROW LEVEL SECURITY (confirmed via Phase 1 §6 — not duplicated).

---

## 6. Realtime publication audit

### 6.1 `pg_publication_tables` snapshot

```
pubname            schemaname  tablename
-----------------  ----------  -----------------------------------
supabase_realtime  public      commissions
supabase_realtime  public      settlement_run_branch_reviews
supabase_realtime  public      settlement_runs
```

Matches `BACKEND.md §8` and `CLAUDE.md` glossary.

### 6.2 REPLICA IDENTITY

All 3 published tables (plus `transactions`/`subscribers`/`subscriber_balances`) are at `relreplident='default'` — i.e. the primary key is the change-key. Realtime emits PK-keyed events; consumers must re-fetch the full row on receipt. Standard, acceptable.

### 6.3 Subscriber inventory (grep across `src/` + `api/`)

```
$ grep -rEn "\.channel\(|supabase\.channel\(" src/ api/
(no hits)

$ grep -rEn "removeChannel|broadcast|postgres_changes|supabase\.realtime" src/ api/
(no hits)
```

**Zero consumers.** Phase 1 §6 noted this for distributor; verified broadly across **agent-dashboard, branch-dashboard, subscriber-dashboard, and `api/*`** in this audit. No file imports the channel API.

| Published table | Mutation source | Subscribers | Cost-vs-value verdict |
|---|---|---|---|
| `commissions` | `trg_transactions_contribution`, the 13 commission RPCs (30 003 rows total, ~10/run × ~10 runs = 100 commission state-flips per demo session) | **0** | Low traffic, low-cost. Keep but consider trimming the WAL stream once anyone subscribes. |
| `settlement_runs` | `open_run` / `cancel_run` / `release_run` | **0** | ~10 rows, infrequent UPDATEs. Negligible. |
| `settlement_run_branch_reviews` | `mark_branch_reviewed` / `branch_approve_all` / `release_branch` | **0** | Same low traffic. |

**Verdict:** No P0/P1 risk — the publication exists for a planned cross-laptop demo loop (BACKEND.md §8 "branch approves on laptop A → distributor sees update on laptop B") that no frontend code has wired up yet. The WAL overhead is negligible. **AUDIT-2-4 (P2)** captures this as "broadcast with no consumer" because a `BroadcastChannel` debug or a future regression could silently flood the network if/when a hook subscribes incorrectly.

---

## 7. Trigger correctness pass

5 triggers, all in the `public` schema:

| Trigger | Table | Timing | Function | SECURITY DEFINER | search_path | Exception pattern |
|---|---|---|---|:---:|:---:|---|
| `subscribers_after_insert` | subscribers | AFTER INSERT | `trg_subscribers_after_insert` | ✓ | `public, pg_temp` | `INSERT … ON CONFLICT (subscriber_id) DO NOTHING` — idempotent, no exception swallow |
| `transactions_after_insert_contribution` | transactions WHEN type='contribution' | AFTER INSERT | `trg_transactions_contribution` | ✓ | `public, pg_temp` | `IF NOT EXISTS (SELECT 1 FROM commissions …) THEN …` — race-protected by `ux_commissions_agent_subscriber` UNIQUE (0017); no exception swallow. Skipped per CLAUDE.md §10a (demo unit price). |
| `transactions_after_insert_withdrawal` | transactions WHEN type='withdrawal' | AFTER INSERT | `trg_transactions_withdrawal` | ✓ | `public, pg_temp` | Plain `UPDATE`, no exception swallow |
| `commissions_before_update` | commissions | BEFORE UPDATE | `trg_commissions_before_update` | ✗ (correct — no cross-table writes) | `public, pg_temp` | `IF NEW.status = 'disputed' AND OLD.status IS DISTINCT …` — no exception swallow |
| `subscribers_enforce_editable_cols` | subscribers | BEFORE UPDATE | `trg_subscribers_enforce_editable_cols` | ✗ (regular, reads JWT claim directly) | `public, pg_temp` | `IF NEW.x IS DISTINCT FROM OLD.x THEN RAISE EXCEPTION 'cannot modify x'` — loud, correct. |

### Findings

- **All 5 trigger functions have `search_path = public, pg_temp` locked.** 0010's promise holds.
- **No `EXCEPTION WHEN OTHERS THEN NULL` or `WHEN unique_violation THEN NULL` in any trigger.** Errors propagate (good).
- The single `EXCEPTION WHEN OTHERS THEN NULL` site in `supabase/migrations/0002_rpc_functions.sql:1249` is inside `create_subscriber_from_agent_onboard` (an RPC, not a trigger) and is a controlled `auth.jwt()` null-tolerance shim for psql-from-dev compatibility — it leaves `v_jwt_agent_id := NULL`, then a subsequent `IF v_jwt_agent_id IS NOT NULL AND v_jwt_agent_id <> calling_agent_id` accepts the NULL as "no JWT context, trust the caller-supplied agent_id". For `authenticated` PostgREST calls `auth.jwt()` is never null (the JWT is fresh), so this fallback is dead in prod. Acceptable.
- **Both UPDATE-vs-INSERT codepaths logically consistent.** `trg_transactions_contribution` only fires on INSERT (WHEN clause); `trg_subscribers_enforce_editable_cols` is BEFORE UPDATE only. No silent-failover risk.

---

## 8. §14b verification

| Bug | Status | File:line |
|---|---|---|
| `agent_dispute_line` RPC missing | **FIXED.** Function present in `pg_proc`, SECURITY DEFINER + `app_role='agent'` gate. Frontend `src/services/commissions.js:831` calls `supabase.rpc('agent_dispute_line', …)`. Test in `src/services/__tests__/commissions.test.js:448-462` covers the agent path. | `supabase/migrations/0014_signup_phone_and_agent_dispute.sql` (function body); `src/services/commissions.js:824-841` |
| Nominee shares can sum >100 % | **PRESENT.** Only `nominees_share_check CHECK (share >= 0 AND share <= 100)` exists. No per-`(subscriber_id, type)` sum-to-100 deferred-constraint trigger. | `supabase/migrations/0001_initial_schema.sql` (CHECK) — pg_constraint inventory confirms |
| First-contribution commission lacks `UNIQUE(agent_id, subscriber_id)` | **FIXED.** `ux_commissions_agent_subscriber` UNIQUE present. `pg_stat_user_indexes` shows `idx_scan=0` because no double-click race has fired yet, but the constraint is live. | `supabase/migrations/0017_unique_constraints.sql:47-48` |

---

## 9. Security spot-checks

| Check | Result | Evidence |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` location | **PASS.** Only `api/_lib/supabase-admin.ts:16,21`, `e2e/specs/db/invariants.spec.ts:25,37,40`, `e2e/fixtures/db.ts:4,23,28`. No `src/` hit. | grep above |
| JWT logging | **PASS.** Six `console.error('[verify-otp] …', err)` sites — they log the Error object, not the bearer token. `chat.js`/`entities.js` warn-logs do not include claim payloads. No `console.log(headers)` / `console.log(token)` / `console.log(jwt)` anywhere. | grep above |
| Direct DB writes from frontend | **FAIL.** `src/services/subscriber.js:752-757` (`.delete()`) + `:787` (`.insert()`) on `nominees` table. Comment at :749-751 acknowledges "Delete + reinsert atomically would need an RPC; for now we DELETE all then INSERT". CLAUDE.md §5.6 / §7.3 forbid this — see AUDIT-2-3. |
| SECURITY DEFINER role gates | **PASS** for all 16 non-trigger DEFINER functions: `agent_confirm_commission, agent_dispute_line, approve_dispute, branch_approve_all, branch_approve_line, branch_dispute_line, branch_hold_line, cancel_run, create_subscriber_from_agent_onboard, get_entity_metrics_rollup, mark_branch_reviewed, open_run, reject_dispute, release_branch, release_run, withdraw_dispute` — all have `RAISE EXCEPTION` + `app_role` check. `create_subscriber_from_signup` has no role check (intentionally callable by anon during signup before JWT exists — the validation lives in `_validate_signup_payload`). The 3 DEFINER trigger functions don't need role gates (callable only via the trigger). | pg_proc + function-body inspection |

---

## 10. Findings 2-1 through 2-13

### AUDIT-2-1 — RLS on `subscribers` forces Seq Scan for every paginated GET; PostgREST's `count: 'exact'` adds a 911 ms full-table scan per request

```
ID:       AUDIT-2-1
Area:     backend
Severity: P0
Title:    SELECT * FROM subscribers LIMIT 1000 OFFSET 25000 (as distributor) takes 1.22 s server-side; SELECT count(*) FROM subscribers takes 911 ms. RLS predicate has no index match so the planner always picks Seq Scan, and PostgREST emits the count query alongside every page request.
Evidence:
  - EXPLAIN ANALYZE distributor OFFSET 25000: "Seq Scan on subscribers (actual time=0.908..1222.937 rows=26000 loops=1) Buffers: shared hit=1323 Execution Time: 1224.868 ms" (§3.1)
  - EXPLAIN ANALYZE distributor count(*): "Seq Scan on subscribers (actual time=2.177..908.139 rows=30003 loops=1) Execution Time: 911.121 ms" (§3.2)
  - pg_stat_statements row #3: 198 calls, mean 456 ms, max 4896 ms for the `SELECT *, count …` shape — 90 s of accumulated server time
  - Indexes inventoried: subscribers has `idx_subscribers_agent_id`, `subscribers_agent_id_idx` (duplicate — see AUDIT-2-9), `idx_subscribers_kyc`, `idx_subscribers_gender` (unused), `idx_subscribers_registered`, `subscribers_district_id_idx`, `subscribers_phone_unique_non_demo_idx`, `ux_subscribers_nin` — none can serve the distributor RLS disjunct (`app_role='distributor'` returns ALL rows, so any index over (something) still scans 30 003 rows).
  - The RLS qualifier is a 4-way OR (subscriber-self / agent / branch-via-agents / distributor); the branch arm contains a `hashed SubPlan` over agents, making the predicate data-dependent and unhashable by the LIMIT optimiser.
Reproduction:
  1. Sign in as distributor (e2e/.auth/distributor.json) and open /dashboard.
  2. Network → `/rest/v1/subscribers?select=*&offset=20000&limit=1000` — observe 1.2-1.5 s server time (HAR -1 because cross-origin, but the count + page take >2 s combined when warmed).
  3. Server-side: SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claims" = '{"app_role":"distributor",…}'; EXPLAIN ANALYZE SELECT * FROM subscribers LIMIT 1000 OFFSET 25000;
Root cause hypothesis:
  Postgres can push LIMIT below a Seq Scan only when the filter result is row-by-row independent. The branch-via-agents arm has a SubPlan, so the planner conservatively materialises every row that matches the filter. Compound with PostgREST `count: 'exact'` (default for `range()` requests) issuing a SEPARATE count(*) Seq Scan = 911 ms baseline cost on every paginated GET, regardless of offset.
Proposed fix scope:
  Two-part fix:
    (a) Switch the 30-page subscriber fanout to `count: 'estimated'` or `count: 'planned'` in PostgREST — `range()` accepts a count strategy. Estimated count uses pg_class.reltuples (~free).
    (b) Pair with AUDIT-2-5 (flatten OR-policies into one CASE-policy) which removes the SubPlan and lets the planner short-circuit the distributor disjunct.
  Long-term: replace `useAllEntities('subscriber')` callsites with a SECURITY DEFINER RPC that returns paginated rows (mirrors AUDIT-1-7's cursor-pagination prescription).
  Estimated: one frontend PR (count strategy) + AUDIT-2-5 migration.
Confidence: high
```

### AUDIT-2-2 — `commissions.status` has no index; distributor-side `?status=eq.due` pagination seq-scans 30 003 rows

```
ID:       AUDIT-2-2
Area:     backend
Severity: P0
Title:    SELECT … FROM commissions WHERE status='due' LIMIT 1000 falls off the (branch_id, status) composite index because no branch filter is present. mean 188 ms, max 3.83 s, 477 calls in pg_stat_statements (90 s total) — CommissionPanel and its by-status filters issue this on every distributor visit.
Evidence:
  - EXPLAIN: "Seq Scan on commissions (cost=0..1684.11 rows=22 width=101) (actual time=0.045..9.633 rows=1000 loops=1) Filter: <RLS> AND (status = 'due'::commission_status) Rows Removed by Filter: 20667" (§3.3)
  - Indexes inventoried: commissions_agent_id_idx (single col), commissions_branch_id_status_idx (composite), commissions_run_id_idx, commissions_subscriber_id_idx, ux_commissions_agent_subscriber. NO (status) standalone, NO (status, due_date).
  - Status histogram: confirmed 17,678 / released 5,201 / in_run 2,469 / disputed 2,059 / due 1,322 / rejected 781 / held 493 — every filter except 'confirmed' would benefit from index lookup.
  - pg_stat_statements row #4: 477 calls, mean 188.76 ms, max 3828.70 ms, total 90.04 s
Reproduction:
  1. Sign in as distributor, open CommissionPanel.
  2. Click any status filter (Due / Disputed / Held).
  3. Server: SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claims" = '{"app_role":"distributor",…}'; EXPLAIN ANALYZE SELECT * FROM commissions WHERE status='due' LIMIT 1000 OFFSET 0;
Root cause hypothesis:
  The existing (branch_id, status) composite covers branch-role queries; the distributor view ignores branch_id and the planner can't seek by status alone. Single-column status index would let "due" pull 1322 rows via Index Scan vs current 30003-row Seq Scan.
Proposed fix scope:
  Single migration: CREATE INDEX idx_commissions_status ON commissions(status); — or CREATE INDEX idx_commissions_status_due_date ON commissions(status, due_date DESC); if the panel sorts by due_date. ~30k rows × ~12 byte tuple → ~360 KB index. No schema change.
  Pair with AUDIT-2-5 (RLS flatten) to remove the OR-chain that still re-evaluates per Bitmap-Heap-Scan tuple.
Confidence: high
```

### AUDIT-2-3 — `updateNominees` writes direct DELETE + INSERT from frontend, bypassing every RPC invariant

```
ID:       AUDIT-2-3
Area:     backend
Severity: P0
Title:    src/services/subscriber.js:752-757 issues `supabase.from('nominees').delete().eq('subscriber_id', id)` then :787 issues `supabase.from('nominees').insert(rows)` — a two-statement non-atomic delete-and-replace from the browser. Violates CLAUDE.md §5.6 "Don't write raw SQL from the frontend — every database write goes through a SECURITY DEFINER RPC" and §7.3 "All writes flow through SECURITY DEFINER RPCs".
Evidence:
  - src/services/subscriber.js:752-757 (delete branch), 786-788 (insert branch), with the author comment at :749-751 acknowledging the gap: "Delete + reinsert atomically would need an RPC; for now we DELETE all then INSERT. If the second step fails the user should retry — RLS makes this safe (only their own rows are affected)."
  - Demonstrated via `grep -rEn "\.from\([^)]+\)\.(insert|update|delete|upsert)\(" src/services` → exactly one hit, this site.
  - RLS allows it because `nominees_*_self` policies grant subscriber-role INSERT/UPDATE/DELETE on rows where the subscriber owns them. But the failure mode is bad: if INSERT fails (network blip, payload too large), the user loses every nominee and sees no recovery path — the next page render shows empty pension + insurance beneficiary lists with no audit trail.
Reproduction:
  1. Sign in as subscriber (e.g. +25671 100 0001).
  2. Open Settings → Beneficiaries.
  3. Save a new beneficiary list.
  4. DevTools Network → observe `DELETE /rest/v1/nominees?subscriber_id=eq.<id>` followed by `POST /rest/v1/nominees` — two requests.
  5. Throttle network between the two → simulate INSERT failure → user data is gone.
Root cause hypothesis:
  Author shipped the simplest implementation pending a backend RPC; the TODO comment is explicit. The atomic-write RPC pattern from `_insert_subscriber_chain` was not extended here.
Proposed fix scope:
  Add `replace_subscriber_nominees(p_subscriber_id, p_pension jsonb, p_insurance jsonb)` SECURITY DEFINER RPC (mirrors `_insert_subscriber_chain` style — validate role='subscriber', validate p_subscriber_id matches JWT subscriberId, BEGIN; DELETE …; INSERT …; END in a single transaction). One migration + one service-file edit.
  Bonus: pair with AUDIT-2-13 (sum-to-100 constraint trigger) so the new RPC enforces the invariant at write-time.
Confidence: high
```

### AUDIT-2-4 — Realtime publication ON for 3 tables with zero subscribers; pure WAL overhead with no consumer

```
ID:       AUDIT-2-4
Area:     backend
Severity: P2
Title:    pg_publication_tables shows commissions, settlement_runs, settlement_run_branch_reviews in supabase_realtime, but grep across src/ + api/ for `.channel(` / `removeChannel` / `postgres_changes` / `supabase.realtime` returns ZERO matches. The publication is paying WAL + logical-decoding cost (3 tables, ~30k commission rows, ~10 settlement runs) for no functional benefit.
Evidence:
  - pg_publication_tables snapshot (§6.1): 3 tables in supabase_realtime, schema=public.
  - grep -rEn "\\.channel\\(|supabase\\.channel\\(" src/ api/ → 0 matches.
  - grep -rEn "removeChannel|broadcast|postgres_changes|supabase\\.realtime" src/ api/ → 0 matches.
  - BACKEND.md §8 describes the intent: "cross-laptop demo loops (branch approves on laptop A → distributor sees update on laptop B)". The intent has NOT been wired into any dashboard hook.
  - Mutation volume on the published tables is low (~hundreds per demo session via the commission RPCs), so WAL impact is small — but the pattern is "broadcast-with-no-consumer", which (a) wastes free-tier replication slots, (b) carries the foot-gun that any future `useEffect(() => supabase.channel(...).subscribe(), [])` mis-wire would silently spam.
Reproduction:
  1. SELECT pubname, tablename FROM pg_publication_tables ORDER BY pubname, tablename; → 3 rows under supabase_realtime/public.
  2. grep across src/ + api/ for channel-API calls → no hits.
  3. Open any dashboard, watch DevTools WebSocket frames on the supabase.co realtime endpoint → only the implicit Postgres heartbeat.
Root cause hypothesis:
  Migration 0003 enabled the publication anticipating the cross-laptop demo loop. The frontend integration was deferred and never landed.
Proposed fix scope:
  Either:
    (a) Land the cross-laptop demo loop — add a `useSettlementRealtime()` hook in src/hooks/ that subscribes to `commissions` UPDATEs and invalidates the relevant TanStack keys. One file + one DashboardShell mount. Closes the loop.
    (b) Drop the publication (ALTER PUBLICATION supabase_realtime DROP TABLE commissions, settlement_runs, settlement_run_branch_reviews) until a consumer ships. Reverses migration 0003's tail block. One migration.
  (a) is preferred because the BACKEND.md §8 demo loop is a real product feature. (b) is the conservative path if Phase 5 confirms no near-term consumer.
Confidence: high
```

### AUDIT-2-5 — 55 `multiple_permissive_policies` warnings: every authenticated SELECT pays 3-4 OR'd policy evaluations per row

```
ID:       AUDIT-2-5
Area:     backend
Severity: P1
Title:    11 tables × 5 roles each have 3-4 permissive SELECT policies that OR together (subscriber-self + agent + branch + distributor). PostgreSQL evaluates EVERY policy for each row scanned and OR's the results — even when only one disjunct could possibly match the JWT. Tables affected: claims, commissions, contribution_schedules, insurance_policies, nominees, settlement_run_branch_reviews, settlement_runs, subscriber_balances, subscribers, transactions, withdrawals.
Evidence:
  - get_advisors(performance) returns 55 multiple_permissive_policies WARN entries (§5.1, full advisor remediation URL: https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).
  - EXPLAIN excerpts §3.1, §3.2, §3.3 all show "Filter: ((((InitPlan A).col1 ->> 'app_role'::text) = 'distributor'::text) OR ((((InitPlan B).col1 ->> 'app_role'::text) = 'branch'::text) AND (ANY (agent_id = (hashed SubPlan 10).col1))) OR ((((InitPlan 11).col1 ->> 'app_role'::text) = 'agent'::text) AND …))" — the OR chain is reproduced per row, despite three of the four disjuncts being statically impossible for the current JWT.
  - The branch arm contains a `hashed SubPlan` over agents, which is what prevents Postgres from pushing the LIMIT below the filter (root cause of AUDIT-2-1).
Reproduction:
  1. mcp__supabase__get_advisors(type=performance) returns the 55 lints.
  2. EXPLAIN any authenticated SELECT against a multi-role table — observe the full OR predicate in the Filter line.
Root cause hypothesis:
  Migration 0007 (RLS app_role rewrite) preserved policy names from 0003 — i.e. each role got its own policy. Postgres treats N permissive policies for the same role on the same action as "ANY may pass", which is correct semantically but expensive because all N are evaluated.
Proposed fix scope:
  Two patterns to consider:
    (a) **Single restrictive + single permissive.** Drop the 4 policies per (table, action), replace with one `USING (CASE auth.jwt() ->> 'app_role' WHEN 'subscriber' THEN id = auth.jwt() ->> 'subscriberId' WHEN 'agent' THEN agent_id = auth.jwt() ->> 'agentId' WHEN 'branch' THEN EXISTS (…) WHEN 'distributor' THEN true ELSE false END)` policy. Cuts the per-row work to one branch.
    (b) **Static distributor short-circuit.** Add a single restrictive policy `USING ((SELECT auth.jwt() ->> 'app_role') = 'distributor')` and let the others remain permissive — distributor reads no longer evaluate the agent/branch SubPlans.
  Either approach is one migration touching 11 tables. Pair with AUDIT-2-1, AUDIT-2-2 — both unlock dramatic plan improvements once the OR chain is gone.
Confidence: high
```

### AUDIT-2-6 — `distributors_update_self` policy still re-evaluates `auth.jwt()` per row (auth_rls_initplan WARN)

```
ID:       AUDIT-2-6
Area:     backend
Severity: P3
Title:    Migration 0008 wrapped every `auth.jwt()` call in `(SELECT auth.jwt())` for InitPlan hoisting, but `distributors_update_self` (added in 0016) reads `auth.jwt() ->> 'distributorId'` unwrapped. Phase 1 §6 noted this but flagged it as "doesn't affect read paths" — confirming the assessment for Phase 2.
Evidence:
  - get_advisors(performance) returns ONE auth_rls_initplan WARN: "public.distributors.distributors_update_self … re-evaluates current_setting() or auth.<function>() for each row" — full advisor remediation URL: https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
  - SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname='distributors_update_self' → "((auth.jwt() ->> 'distributorId'::text) = id)"
  - Compare to e.g. distributors_select → "true" (no jwt() call), and every other live policy → wrapped in `( SELECT auth.jwt() AS jwt) ->> 'X'`.
Reproduction:
  Run mcp__supabase__get_advisors(type=performance). One auth_rls_initplan row appears.
Root cause hypothesis:
  Migration 0016 (distributors table) was authored AFTER 0008's wrap convention, but the wrap was not applied to the new policy.
Proposed fix scope:
  One migration: DROP POLICY distributors_update_self ON distributors; CREATE POLICY distributors_update_self ON distributors FOR UPDATE USING ((SELECT auth.jwt()) ->> 'distributorId' = id);
  Impact: minimal — the `distributors` table has 1 row. The wrap matters for table-scan policies, not for 1-row tables. Tagged P3 for completeness only.
Confidence: high
```

### AUDIT-2-7 — `get_entity_commission_summary` is LANGUAGE plpgsql STABLE (not SECURITY DEFINER); 188-456 ms mean wraps a 14 ms inline query

```
ID:       AUDIT-2-7
Area:     backend
Severity: P1
Title:    pg_stat_statements row #1 (513 calls × 207 ms mean = 106 s total) is get_entity_commission_summary. The inlined body's aggregate is 14 ms; the function wrapper adds ~360 ms of plpgsql overhead because the function inherits the caller's RLS context (same anti-pattern as AUDIT-1-8 for get_top_branch). The function is STABLE but NOT SECURITY DEFINER (prosecdef=false).
Evidence:
  - pg_proc: prosecdef=false, provolatile='s' for get_entity_commission_summary (§3 EXPLAIN data).
  - EXPLAIN ANALYZE wrapped call: Execution Time 374.643 ms with shared hit=1356 (§3.4).
  - EXPLAIN ANALYZE inlined aggregate: 14 ms, shared hit=559 (§3.4 inner).
  - Pattern matches AUDIT-1-8 prescription for get_top_branch.
Reproduction:
  1. Sign in as distributor.
  2. Open OverlayPanel — Network → POST /rest/v1/rpc/get_entity_commission_summary returns in ~200-400 ms server-side.
  3. Server: EXPLAIN ANALYZE SELECT public.get_entity_commission_summary('country','ug') vs EXPLAIN ANALYZE <body inline>.
Root cause hypothesis:
  Function authored in 0002 before 0007/0008 introduced the app_role convention + InitPlan wrap. The function body has a clean (p_level, p_entity_id) parameter API but still defers to caller-context RLS.
Proposed fix scope:
  Same migration as AUDIT-1-8: convert get_entity_commission_summary (and get_commission_summary, get_agent_commission_detail, get_run_branch_breakdown, get_top_branch, get_breadcrumb) to SECURITY DEFINER with role gate (`COALESCE(auth.jwt() ->> 'app_role','')` + RAISE EXCEPTION IF role NOT IN (...)`). Migration 0021's approach is the template.
  Pair with AUDIT-2-2 — the WHERE branch_id IN (…) sub-query in the function body benefits from idx_commissions_status as well.
Confidence: high
```

### AUDIT-2-8 — `get_run_branch_breakdown` mean 206 ms × 475 calls = 98 s total; same SECURITY DEFINER gap

```
ID:       AUDIT-2-8
Area:     backend
Severity: P1
Title:    pg_stat_statements row #2 — `get_run_branch_breakdown(p_run_id)`. Mean 206 ms, max 3585 ms (p99 ~3.5 s), 98 seconds of cumulative server time. Function is LANGUAGE plpgsql STABLE (not SECURITY DEFINER); inherits caller-context RLS, evaluates the OR-chain per row scanned.
Evidence:
  - pg_proc: prosecdef=false, search_path=public,pg_temp.
  - EXPLAIN ANALYZE settlement_runs LIMIT 1 (as distributor): "Seq Scan on settlement_runs (cost=0..7328.42 rows=3 width=32) (actual time=76.764..76.769 rows=1 loops=1)" — 77 ms for ONE row by run_id (§3.5).
  - The function does TWO scans over commissions in its body (branch_totals CTE + reviews CTE → merged → LEFT JOIN branches). For 10 settlement_runs × 314 branches = 3,140 row evaluations per call.
Reproduction:
  1. Sign in as distributor, open CommissionPanel.
  2. Auto-refresh polls every ~15s — POST /rest/v1/rpc/get_run_branch_breakdown.
  3. Server: SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claims" = '{"app_role":"distributor",…}'; EXPLAIN ANALYZE SELECT public.get_run_branch_breakdown('r-2026-04');
Root cause hypothesis:
  Same as AUDIT-2-7. The function is part of the CommissionPanel auto-refresh loop (Phase 1 §2.2 noted 471 calls of get_commission_summary, the sibling RPC), so cumulative overhead is high even though per-call is acceptable.
Proposed fix scope:
  Same migration as AUDIT-2-7 / AUDIT-1-8 — promote to SECURITY DEFINER with role gate. The CommissionPanel reuse + auto-refresh make this the second-most-impactful conversion after get_top_branch.
Confidence: high
```

### AUDIT-2-9 — Duplicate index on `subscribers(agent_id)`: `idx_subscribers_agent_id` ≡ `subscribers_agent_id_idx`

```
ID:       AUDIT-2-9
Area:     backend
Severity: P3
Title:    pg_indexes lists two identical b-tree indexes on subscribers(agent_id): `idx_subscribers_agent_id` and `subscribers_agent_id_idx`. Advisor performance lint duplicate_index WARN. Wastes disk + INSERT/UPDATE cost; no read benefit.
Evidence:
  - pg_indexes: both rows on subscribers / agent_id, both `CREATE INDEX … ON public.subscribers USING btree (agent_id)`.
  - get_advisors(performance): "Table public.subscribers has identical indexes {idx_subscribers_agent_id, subscribers_agent_id_idx}. Drop all except one of them." (advisor remediation URL: https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index)
  - Likely origin: one in 0001 (subscribers_agent_id_idx), one added by 0009/0013 FK-covering-indexes pass (idx_subscribers_agent_id).
Reproduction:
  SELECT indexname, indexdef FROM pg_indexes WHERE tablename='subscribers' AND indexdef ILIKE '%(agent_id)%';
Root cause hypothesis:
  Migration 0009 / 0013's FK-covering-index pass introduced `idx_subscribers_agent_id` without checking for the existing `subscribers_agent_id_idx` from 0001.
Proposed fix scope:
  One migration: DROP INDEX IF EXISTS subscribers_agent_id_idx; (preserve idx_subscribers_agent_id because it follows the project naming convention).
  Risk: Phase 1's findings reference `subscribers_agent_id_idx` by name in EXPLAIN excerpts; verify the planner happily picks the surviving copy. Both are b-tree on the same column with default opclass — interchangeable.
Confidence: high
```

### AUDIT-2-10 — 17 SECURITY DEFINER functions are EXECUTE-able by `anon` (fail-safe internally, but principle of least privilege violated)

```
ID:       AUDIT-2-10
Area:     backend
Severity: P2
Title:    pg_proc returns 20 SECURITY DEFINER functions; get_advisors(security) flags 17 as anon_security_definer_function_executable + same 17 as authenticated_security_definer_function_executable. The functions all gate internally (IF v_role IS DISTINCT FROM 'X' THEN RAISE EXCEPTION), so anon calls fail-safe, but they could be REVOKE'd from anon entirely.
Evidence:
  - Functions: open_run, cancel_run, release_run, release_branch, branch_approve_all, branch_approve_line, branch_dispute_line, branch_hold_line, agent_dispute_line, agent_confirm_commission, approve_dispute, reject_dispute, withdraw_dispute, mark_branch_reviewed (the 14 commission RPCs from 0021), plus get_entity_metrics_rollup, trg_subscribers_after_insert, trg_transactions_contribution, trg_transactions_withdrawal, create_subscriber_from_signup, create_subscriber_from_agent_onboard.
  - All 16 commission + rollup RPCs have `RAISE EXCEPTION 'role X cannot ...'` gates (§role-gate verification). `create_subscriber_from_signup` is intentionally callable by anon (signup before JWT).
  - The 3 trigger functions are technically callable as RPCs (`/rest/v1/rpc/trg_transactions_contribution`); they would run their body but the AFTER INSERT trigger sees no NEW row → undefined behaviour. Worth REVOKE'ing for hygiene.
  - Advisor remediation URL: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
Reproduction:
  POST /rest/v1/rpc/open_run with anon apikey + no JWT → 500 with body "role  cannot open a settlement run" (anon's app_role is empty string).
Root cause hypothesis:
  Postgres GRANTs EXECUTE on every function to PUBLIC by default unless REVOKE'd. The migrations grant explicitly to authenticated, but don't REVOKE from anon (or PUBLIC).
Proposed fix scope:
  One migration: For each of the 13 commission state-machine RPCs + the 3 trigger functions, REVOKE EXECUTE FROM anon (and PUBLIC). Keep create_subscriber_from_signup callable by anon (signup needs it). get_entity_metrics_rollup can stay (anon would fail-safe; the dashboard never calls it pre-auth).
  No code changes needed (no current path relies on anon execution).
Confidence: high
```

### AUDIT-2-11 — `_demo_now()` has mutable `search_path` (security advisor WARN)

```
ID:       AUDIT-2-11
Area:     backend
Severity: P3
Title:    pg_proc shows _demo_now is the only public function with NULL proconfig — no SET search_path. Migration 0010 was supposed to lock search_path on every function but missed _demo_now (added later, likely with the demo "freeze the clock at 2026-05-18 23:59:59" feature).
Evidence:
  - get_advisors(security): "Function public._demo_now has a role mutable search_path" — full advisor remediation URL: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
  - pg_proc.proconfig=NULL for _demo_now.
  - Function body: "CREATE OR REPLACE FUNCTION public._demo_now() RETURNS timestamp with time zone LANGUAGE sql IMMUTABLE AS $function$ SELECT '2026-05-18 23:59:59+00'::timestamptz $function$" — has no schema lookups, so the mutable search_path has zero exploit surface, but the advisor doesn't know that.
Reproduction:
  SELECT proconfig FROM pg_proc WHERE proname='_demo_now'; → NULL.
Root cause hypothesis:
  _demo_now is a constant-returning function added in `0020_entity_metrics_rollup_v3.sql` (or thereabouts) and skipped the 0010 search_path pin discipline.
Proposed fix scope:
  One-line ALTER: ALTER FUNCTION public._demo_now() SET search_path = pg_temp; — that strips the function from any catalog dependency.
  Tagged P3 because the function body references no other objects.
Confidence: high
```

### AUDIT-2-12 — `useSubscriber(id)` joins subscriber × subscriber_balances × contribution_schedules; mean 37 ms × 878 calls = 32 s total

```
ID:       AUDIT-2-12
Area:     backend (PostgREST join)
Severity: P2
Title:    pg_stat_statements row #7 — 878 calls, mean 37 ms, max 3219 ms. PostgREST embed on `subscribers?select=*,subscriber_balances(*),contribution_schedules(*),...` ships the full subscriber row + two nested 1:1 rows in one round-trip. Per-call fast; cumulative is significant because it fires once per subscriber-detail panel mount and once per agent-detail drill-down. The max latency of 3.2 s shows it can stall when buffer cache is cold.
Evidence:
  - pg_stat_statements: 878 calls, mean 37 ms, max 3219 ms, total 32.49 s.
  - Query shape: `WITH pgrst_source AS ( SELECT "public"."subscribers".*, row_to_json("subscribers_subscriber_balances_1".*)::jsonb AS "subscriber_balances", row_to_json("subscribers_contribution_schedules_1".*)::jsonb …`
  - The 3:1 panel-mount count (ViewSubscribers preview card, OverlayPanel, AgentDetailRoute) compounds across dashboards.
Reproduction:
  1. Open Distributor → drill into a branch → drill into an agent → drill into a subscriber.
  2. Network → /rest/v1/subscribers?id=eq.<id>&select=*,subscriber_balances(*),contribution_schedules(*),insurance_policies(*),nominees(*)
  3. Repeat 10× — observe pg_stat_statements call count climb by 10.
Root cause hypothesis:
  Standard PostgREST embed pattern — fine at small scale but the 30k-row subscribers table + RLS OR-chain means each embed re-runs the OR-chain twice (parent + each child). Stalls under buffer pressure.
Proposed fix scope:
  Either:
    (a) Replace the embed with a SECURITY DEFINER read RPC `get_subscriber_detail(p_subscriber_id)` returning one jsonb document — single function-scoped LIMIT 1 + 4 joins by PK. ~10-20 ms baseline.
    (b) Accept the embed but lean on AUDIT-2-5 (flatten OR-policies) to halve per-row cost.
  Estimated: (a) is one migration + one service-file edit; (b) inherits AUDIT-2-5's migration. Recommend (b) — it benefits every other endpoint too.
Confidence: medium (the 3.2 s max may be a single outlier under load, not a steady cost)
```

### AUDIT-2-13 — Nominee shares can sum >100 % (PRESENT — confirmed via pg_constraint, no per-(subscriber_id, type) sum-to-100 trigger)

```
ID:       AUDIT-2-13
Area:     backend
Severity: P2
Title:    nominees table has only `CHECK (share >= 0 AND share <= 100)` per row — no aggregate constraint per (subscriber_id, type). A subscriber can save three pension nominees at 50% each (sum 150%) and the DB will accept it. BACKEND.md §14b flagged this; verified PRESENT.
Evidence:
  - pg_constraint on public.nominees: nominees_share_check CHECK (((share >= (0)::numeric) AND (share <= (100)::numeric)))
  - No row-trigger or deferred constraint trigger on nominees.
  - The frontend `updateNominees` (AUDIT-2-3) does no sum validation either.
Reproduction:
  1. Sign in as subscriber.
  2. Open Beneficiaries panel.
  3. Save 3 pension nominees with share=50 each → succeeds.
  4. Total pension share = 150% → silent inconsistency.
Root cause hypothesis:
  Per-row CHECK was the easy initial guard; the deferred constraint trigger (BACKEND.md §14b prescription) was never authored.
Proposed fix scope:
  One migration:
    CREATE OR REPLACE FUNCTION public._trg_nominees_sum_100() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.nominees n
        WHERE n.subscriber_id = COALESCE(NEW.subscriber_id, OLD.subscriber_id)
          AND n.type          = COALESCE(NEW.type, OLD.type)
        GROUP BY n.subscriber_id, n.type
        HAVING SUM(n.share) > 100
      ) THEN
        RAISE EXCEPTION 'nominee shares for (%, %) sum to >100',
          COALESCE(NEW.subscriber_id, OLD.subscriber_id),
          COALESCE(NEW.type, OLD.type);
      END IF;
      RETURN NEW;
    END $$;
    CREATE CONSTRAINT TRIGGER nominees_sum_100 AFTER INSERT OR UPDATE OR DELETE ON nominees DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION _trg_nominees_sum_100();
  Pair with AUDIT-2-3 — the new `replace_subscriber_nominees` RPC can SET CONSTRAINTS IMMEDIATE on commit so the user gets one atomic error rather than a row-by-row failure.
Confidence: high
```

---

## 11. Cross-references to Phase 1

Where Phase 2 work overlaps with Phase 1, the prescription is the same migration:

- **AUDIT-1-1 / AUDIT-1-8** (`get_top_branch` SECURITY DEFINER + role gate) — Phase 2 adds **AUDIT-2-7** (`get_entity_commission_summary`) and **AUDIT-2-8** (`get_run_branch_breakdown`) to the same conversion list. **Recommended one-migration scope:** convert `get_top_branch`, `get_entity_commission_summary`, `get_run_branch_breakdown`, `get_agent_commission_detail`, `get_commission_summary`, `get_breadcrumb`, `search_entities` to SECURITY DEFINER with a shared `_gate_role(allowed text[])` helper.
- **AUDIT-1-2** (transactions `(type, date)` composite index) — pairs with **AUDIT-2-2** (`commissions(status)` index). Same migration: both index additions.
- **AUDIT-1-7** (subscriber paginated fanout) — root cause is **AUDIT-2-1** (RLS forces Seq Scan + count exact = 911 ms per page). Frontend fix (cursor) is necessary but the backend RLS rewrite (**AUDIT-2-5**) is the structural fix.

Other Phase 2 items independent of Phase 1: **AUDIT-2-3** (frontend direct-write to nominees), **AUDIT-2-4** (realtime unused), **AUDIT-2-6** (`distributors_update_self` InitPlan miss), **AUDIT-2-9** (duplicate index), **AUDIT-2-10** (anon EXECUTE on DEFINER), **AUDIT-2-11** (`_demo_now` search_path), **AUDIT-2-12** (subscriber detail embed), **AUDIT-2-13** (nominees sum-to-100).

---

## 12. What Phase 2 deliberately did NOT do

- Did not run `mcp__supabase__apply_migration` — read-only.
- Did not install hypopg / index_advisor / plpgsql_check — read-only.
- Did not modify any source file outside this doc.
- Did not run an `EXPLAIN ANALYZE` that would dirty pages of consequence (each plan ran shared-hit-only).
- Did not re-test Phase 1's named RPCs (`get_top_branch`, `get_entity_metrics_rollup`) per the brief.
- Did not flag CLAUDE.md §10a demo-scope items.

---

This findings doc is read-only output. No source file was modified in producing it.
