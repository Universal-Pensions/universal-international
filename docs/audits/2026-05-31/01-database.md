> **Agent guide.** Historical audit from 2026-05-31, covering the database schema, RLS policies and migrations (`0001`–`0031`) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 01 — Database, Schema, RLS & Migrations (Phase 1, Agent A)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (working tree)
**Agent:** Agent A — Database, Schema, RLS & Migrations. **READ-ONLY.** No source edits, no commits, no migrations, no DB writes.
**Live DB:** Supabase project ref `zengmiugieqjqzaccbqe` (read-only MCP: `list_tables`, `list_migrations`, `get_advisors`, SELECT-only `execute_sql`).

**Scope covered:** `supabase/migrations/0001`–`0031` (+ `.down.sql`), `supabase/config.toml`, `scripts/*.sql`, `scripts/seed-supabase.mjs`; full SECURITY DEFINER RPC inventory; live-DB ↔ migration-file drift reconciliation; new-feature DB risks for 0029/0030/0031 (commission collapse, settlement_batches, notifications, `apply_settlement`).

**Severity calibration (demo tool).** Critical = breaks/corrupts a core demo flow or a reachable security hole; High = visible breakage or genuine correctness/security weakness; Medium = degraded UX / tech-debt / a §4–5 hard-rule violation; Low = cosmetic. Pure production-only concerns (real scale/PII/money) are awareness items, not Critical.

---

## Positive verifications (no finding — recorded so synthesis doesn't re-open them)

- **No §5.7 claim trap anywhere.** A live scan of all policies for `'role'`/`auth.uid()` returned **0 rows**. Every RLS policy across all 21 tables reads `auth.jwt() ->> 'app_role'`/`'branchId'`/`'agentId'`/`'subscriberId'`/`'distributorId'`. The new `settlement_batches` (0030:44-62) and `notifications` (0031:48-68) SELECT policies all read `app_role` correctly. (Confirms baseline SEED-A5.)
- **RLS enabled on all 21 base tables.** All but one are also FORCE'd (the exception is `distributors` — see F-9). New tables `settlement_batches`/`notifications` are both `ENABLE + FORCE` (0030:37-38, 0031:42-43).
- **New write RPCs are correctly hardened.** `apply_settlement` (0031:115) gates `app_role='distributor'`; `mark_notifications_read` (0031:246-271) re-checks owner scope inside the SECURITY DEFINER body; both pin `search_path=public, pg_temp` and `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated` (0031:219-220, 275-276). Live `pg_proc` confirms `prosecdef=true`, `search_path=public, pg_temp` for both.
- **Trigger functions are RPC-fail-safe (resolves baseline SEED-B3 nuance #1).** `trg_transactions_contribution`, `trg_transactions_withdrawal`, `trg_subscribers_after_insert` are SECURITY DEFINER and listed by the advisor as anon/authenticated-executable, but each body references `NEW` (the trigger pseudo-record). Invoked directly via `/rest/v1/rpc/` they raise `record "new" is not assigned yet` / missing-NEW errors before any write — they cannot be abused to insert/update data outside a trigger. By-design call-path; not a finding.
- **0029 enum collapse is replay-safe.** Step (4) uses `DROP COLUMN IF EXISTS` + `ALTER COLUMN … TYPE text USING CASE(… ELSE status::text)` so a replay on an already-collapsed DB maps `'due'/'paid'` to themselves, then `DROP TYPE`/`CREATE TYPE`/swap-back succeed. The read-RPC re-emits use `CREATE OR REPLACE` with unchanged return types. (The destructive concern is rollback, not forward-replay — see F-2.)

---

## CRITICAL

_None._ No DB-layer defect corrupts the live demo dataset or opens a reachable security hole in the demo. The settlement/notification flow's role-gating and RLS are sound. The highest-impact items are the lossy-rollback gate and the migration-ledger drift, both of which are **cutover-process** risks (High) rather than in-demo data corruption.

---

## HIGH

### F-1 — `apply_settlement` has no idempotency guard → double-submit double-pays & double-notifies
- **Classification:** real-bug
- **Severity:** High
- **Evidence:** `supabase/migrations/0031_notifications.sql:138-208`. The RPC selects `status='due'` lines (`:139-143`), unconditionally `UPDATE … SET status='paid'` (`:157-163`), inserts a `settlement_batches` row (`:167-173`), and emits notifications (`:176-203`). There is no nonce/idempotency key, no "already settled this batch" guard, and `settlement_batches.id` is a fresh `gen_random_uuid()` each call (`:166`).
- **Impact:** The first call flips all due lines to paid; an accidental second submit of the *same* uploaded file finds **0 due lines** for that agent and returns `skipped:[{reason:'no_due'}]` — so a true exact re-submit is actually benign. The real exposure is **concurrent/overlapping submits or a partial second payment**: if the distributor uploads a second file with a *different* `amountPaid` while new `due` lines exist (or two tabs submit near-simultaneously between the SELECT and UPDATE), a second `settlement_batches` row + duplicate `commission_settled` notifications are recorded for the same logical payment, inflating the agent's paid total and the notification feed. In the demo this manifests as duplicated bell entries and a wrong "paid" figure. (Confirms baseline SEED-B2/D1.)
- **Recommendation:** Accept a client-supplied idempotency key (e.g. a per-upload `batchNonce`) and store it on `settlement_batches` with a `UNIQUE` constraint; have `apply_settlement` short-circuit (return the prior result) when the nonce already exists. Frontend hardening (disable the Apply button on submit) belongs to Workstream B/D but does not substitute for the server guard.

### F-2 — `0029_commission_simplify.down.sql` is lossy / fundamentally irreversible → must gate cutover behind a prod backup
- **Classification:** quality/tech-debt (rollback-safety); **cutover gate**
- **Severity:** High (awareness — process risk, not in-demo)
- **Evidence:** `supabase/migrations/0029_commission_simplify.down.sql:1-23` self-documents as DESTRUCTIVE/IRREVERSIBLE; `:65-82` re-creates only empty structural shells and explicitly states it "makes NO attempt to restore data" and "must NOT be added to the supabase_migrations history." The forward migration drops `settlement_runs` + `settlement_run_branch_reviews` CASCADE (`0029.sql:86-87`), drops 9 dispute/hold/confirm columns (`:108-117`), and remaps the 7-state enum to 2 lossily (`:124-138`).
- **Impact:** Once 0029 is applied to live (it already is — see live ledger), there is **no automated path back** to the pre-collapse commission state. A bad cutover cannot be rolled back by replaying `.down.sql`. Live currently holds 30,001 commission rows; an incorrect remap or a regression discovered post-cutover would require a restore from backup.
- **Recommendation:** Add an explicit **go/no-go gate**: take (and verify) a full `pg_dump`/PITR snapshot of the live DB immediately before the `feat/simplify-commissions → main` cutover, and record the snapshot ID in the cutover checklist. (0029 is already in the live ledger, so this is forward-looking insurance, not pre-application.) (Confirms baseline SEED-A1.)

### F-3 — Migration-ledger drift: 6 local migrations are absent from the live `schema_migrations` history → `supabase db push` collision risk at cutover
- **Classification:** real-bug (release/ops correctness); **cutover gate**
- **Severity:** High
- **Evidence:** `mcp__supabase__list_migrations` returns **25** rows. Present & tracked: the new trio `20260531130807 commission_simplify` / `…827 settlement_batches` / `…909 notifications`. **Missing from the live ledger** (but present as local files): `0022_audit_perf`, `0023_rls_initplan_fixes`, `0024_upsert_nominees`, `0025_drop_realtime_publication`, `0027_post_audit_polish`, `0028_replay_safety_guards`. Conversely the ledger contains `20260519165115 fix_metrics_rollup_app_role`, which has **no local file** (the known remote-only migration, BACKEND.md §15b audit D5). The *effects* of the 6 missing migrations are verified applied in live: `distributors_update_self` is the wrapped 0023 form (`(( SELECT (auth.jwt() ->> 'distributorId'::text)) = id)`); `_demo_now` has `search_path=pg_catalog, public` (0023); `subscribers_agent_id_idx` duplicate is gone (0023); `upsert_nominees` exists (0024); no `public.*` table is in the realtime publication (0025).
- **Impact:** A future `supabase db push` (or a fresh `supabase db reset` on a new environment) will attempt to (re-)apply 0022–0025/0027/0028 because the ledger says they never ran. Whether that succeeds depends entirely on each file's idempotency — and several legacy files have known bare statements (0025 in BACKEND.md §15b audit D12; see F-7). A non-idempotent statement (e.g. a bare `DROP INDEX CONCURRENTLY` already-dropped, or an `ALTER PUBLICATION` of a publication that no longer has the member) can abort the push mid-stream, leaving the ledger and schema in a half-applied state.
- **Recommendation:** Before cutover, reconcile the ledger to reality. Either (a) `INSERT` the 6 missing rows into `supabase_migrations.schema_migrations` to mark them applied (matching the file hashes), and add the `fix_metrics_rollup_app_role` file locally (or formally retire it), **or** (b) document that `db push` is not the deploy mechanism for this project and that schema changes are applied via MCP/direct SQL. Pick one and write it into the cutover runbook so Workstream G's release-hygiene gate has a clear answer. (Confirms baseline SEED-A7/G4.)

### F-4 — Per-line `commissions.paid_amount` is stamped with the whole-batch total, not the line's own amount → wrong per-line "paid" values surfaced to the agent
- **Classification:** real-bug
- **Severity:** High
- **Evidence:** `supabase/migrations/0031_notifications.sql:157-163` — the bulk `UPDATE public.commissions … SET … paid_amount = v_amount_paid WHERE agent_id = v_agent_id AND status='due'` writes the **single batch-level `amountPaid`** value onto **every** settled line. So if an agent has 9 due lines summing to UGX 90,000 and the distributor pays 90,000, each of the 9 `commissions` rows gets `paid_amount = 90000` (not 10,000 each). `get_agent_commission_detail` then returns this per line as `'paidAmount', c.paid_amount` (`0029_commission_simplify.sql:319`), so the agent's commission detail shows each paid line as if it individually received the full batch amount.
- **Impact:** The agent-facing per-line "paid amount" column is incorrect whenever a batch settles more than one line (the common case — the seed batches are 9 and 5 lines). Per-line paid totals will not reconcile against `amount`; summing `paid_amount` across lines overstates the paid total by `line_count×`. This is a genuine correctness/display bug in a primary role flow (agent commissions), distinct from the demo-scope "no real payment processor."
- **Recommendation:** Decide the column's intended semantics. If `paid_amount` is meant to be per-line, allocate the batch total across lines (e.g. proportional to `amount`, or simply `paid_amount = amount` when fully settled) inside `apply_settlement`. If it is meant to be the batch total, drop the per-line column and read the figure from `settlement_batches` via `txn_ref`/`paid_date` join, and stop exposing it per-line in `get_agent_commission_detail`. Either way, fix the RPC + the read RPC together.

---

## MEDIUM

### F-5 — `notifications.ref_id` has no FK to `settlement_batches.id` → deleting a batch orphans its notifications
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:** `supabase/migrations/0031_notifications.sql:32` declares `ref_id TEXT` with no `REFERENCES`. Live `pg_constraint` confirms `notifications` has only a PK constraint (no FK). `apply_settlement` stores the batch id into `ref_id` by convention (`0031:186, :201`).
- **Impact:** A deleted/re-seeded `settlement_batches` row leaves notifications pointing at a non-existent batch. In the demo the bell would link to a dead reference if any UI dereferences `ref_id`. Low blast radius (notifications/batches are append-only in the demo) but a latent integrity gap. (Confirms baseline SEED-A2.)
- **Recommendation:** Either add `ref_id TEXT REFERENCES public.settlement_batches(id) ON DELETE SET NULL` (preserves the notification, nulls the dangling pointer), or explicitly document `ref_id` as an intentional soft denorm in BACKEND.md so it is not mistaken for a constrained FK.

### F-6 — Money columns are unconstrained `NUMERIC` (no precision/scale, no rounding) → fractional-UGX is representable and `apply_settlement` writes client-supplied amounts verbatim
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:** Live `information_schema.columns` shows `commissions.amount`, `commissions.paid_amount`, `settlement_batches.pending_total`, `settlement_batches.paid_amount`, `notifications.amount` are all `numeric` with `numeric_precision = NULL, numeric_scale = NULL` (unbounded). `apply_settlement` casts the client value `(v_row ->> 'amountPaid')::numeric` (`0031:127`) and writes it straight into `commissions.paid_amount` / `settlement_batches.paid_amount` (`0031:161, :171`) with no `round()`. UGX is a zero-decimal currency.
- **Impact:** A distributor upload containing `"amountPaid": 1200.5` (the `parseAmount` util accepts decimals — Workstream B owns that parser) persists fractional shillings and emits a notification body like `UGX 1200.5 paid…` (`0031:184`). Cosmetic in the demo, but it lets non-integer money into the ledger and the notification feed. (Confirms baseline SEED-A4/B1.)
- **Recommendation:** Either constrain the columns to `NUMERIC(14,0)` (and let the cast truncate/error), or `round(v_amount_paid)` inside `apply_settlement` before writing. Prefer rounding in the RPC so the stored value and the notification body agree. Apply the same to `pending_total`.

### F-7 — Legacy migrations 0003/0006/0010/0025 lack idempotency guards on at least one statement (replay-fragile, compounded by F-3)
- **Classification:** already-known (BACKEND.md §15b audit D12) — re-stated only because F-3 (ledger drift) elevates its likelihood of biting at cutover
- **Severity:** Medium
- **Evidence:** BACKEND.md §15b: "4 migrations lack idempotency guards on at least one statement: `0003`, `0006`, `0010`, `0025` (audit D12)." Baseline §1.1/§5.2 corroborate. `0025_drop_realtime_publication.sql` performs an `ALTER PUBLICATION … DROP TABLE` style operation that is not guarded for the already-removed case.
- **Impact:** On its own this is documented/accepted. **In combination with F-3** (0025 is one of the 6 ledger-missing migrations), a `db push` would attempt to re-run 0025 against a DB where the publication member is already gone — a bare unguarded statement there would error and abort the push. This is the concrete mechanism by which the ledger drift becomes a cutover failure.
- **Recommendation:** No new work on the legacy files themselves (forward-only discipline forbids editing shipped migrations). Resolve via F-3: reconcile the ledger so these are never re-attempted. If a fresh-environment `db reset` is ever needed, add guard-only follow-up migrations rather than editing 0003/0006/0010/0025.

### F-8 — `apply_settlement` (a write RPC) and the settlement-related read RPCs are owned across the wrong migration boundary
- **Classification:** quality/tech-debt
- **Severity:** Medium → Low
- **Evidence:** `settlement_batches` is created in 0030 but the only writer of that table, `apply_settlement`, is defined in **0031** (`0031:93-217`). `0030_settlement_batches.down.sql` (`:11-15`) does not drop `apply_settlement`; `0031_notifications.down.sql` (`:13`) does. So rolling back **only** 0031 while keeping 0030 drops `apply_settlement` while `settlement_batches` survives (consistent), but rolling back **only** 0030 while keeping 0031 leaves `apply_settlement` referencing a dropped table — an `INSERT` into `settlement_batches` would then fail at call time.
- **Impact:** Internally consistent for full-trio rollback (the documented manual order), but the cross-migration coupling is surprising and the partial-rollback ordering is undocumented. Low real-world risk because both down files are manual-only/emergency-use.
- **Recommendation:** Document in BACKEND.md §11 that 0030/0031 must be rolled back as a pair and in the order 0031-then-0030 (drop the RPC before the table). No code change required. (Confirms baseline SEED-A3.)

### F-9 — `distributors` is the only table with RLS enabled but **not FORCE'd**
- **Classification:** quality/tech-debt
- **Severity:** Medium → Low
- **Evidence:** Live `pg_class` scan: 20 of 21 tables have `relforcerowsecurity = true`; `distributors` has `relrowsecurity = true, relforcerowsecurity = false`. Origin: `0016_distributors_table.sql:35` issues only `ENABLE ROW LEVEL SECURITY` (no `FORCE`), unlike the new tables (0030:37-38, 0031:42-43) which do both.
- **Impact:** Without FORCE, the table **owner** (and any role acting as owner) bypasses RLS on `distributors`. In this app all writes go through service-role / SECURITY DEFINER paths, so the practical exposure is minimal, but it is an inconsistency with the house standard and means a future owner-context query (e.g. a migration or a misconfigured connection) reads/writes `distributors` unscoped. The table holds only the `d-001`/`d-002` singleton catalogue (low sensitivity), hence not High.
- **Recommendation:** Add `ALTER TABLE public.distributors FORCE ROW LEVEL SECURITY;` in a new forward migration to match every other table.

### F-10 — Non-trigger SECURITY DEFINER RPCs pin `search_path=public` without `pg_temp`
- **Classification:** quality/tech-debt
- **Severity:** Medium → Low
- **Evidence:** Live `pg_proc.proconfig`: `create_subscriber_from_signup`, `create_subscriber_from_agent_onboard`, `get_entity_metrics_rollup`, `get_top_branch`, `upsert_nominees` have `search_path=public` (no `pg_temp`). The newer RPCs (`apply_settlement`, `mark_notifications_read`) and all three trigger functions correctly pin `search_path=public, pg_temp`. CLAUDE.md/BACKEND.md §16 migration discipline states new SECURITY DEFINER functions MUST set `search_path = public` **or** `public, pg_temp`, so `public` alone is technically within the stated rule.
- **Impact:** With `search_path=public` only, a temp object shadowing a `public` object cannot be injected (no `pg_temp` in path), so this is actually the *safer* of the two forms against temp-table shadowing — but it is inconsistent with the newer convention and the trigger functions. Mostly a consistency/clarity nit; no exploit in the demo (and these predate 0029–0031, so they are not part of the audited change set).
- **Recommendation:** Normalize all SECURITY DEFINER RPCs to the same `search_path` form in a future cleanup migration. Not a cutover blocker. (Note for synthesis: this is pre-existing, not introduced by the 0029–0031 trio.)

### F-11 — `get_entity_metrics_rollup` / `get_top_branch` are SECURITY DEFINER **read** RPCs callable by anon/authenticated — verify internal claim scoping holds post-collapse
- **Classification:** already-known (advisor family, baseline SEED-B3 nuance #2) — flagged for confirmation, not re-litigation
- **Severity:** Medium (awareness)
- **Evidence:** Baseline §5.3: 22 security advisors = 11 SECURITY DEFINER fns executable by anon/authenticated. `get_entity_metrics_rollup` and `get_top_branch` are SECURITY DEFINER reads (live `pg_proc` confirms `prosecdef=true`, volatility `s`). The §5.7 `'role'`-trap historically zeroed these in 0018, fixed in 0019/0020.
- **Impact:** These RPCs run with definer privileges and bypass RLS internally, so they MUST scope by the caller's `app_role`/entity claims in-body. The 0029 commission-summary re-emits (`get_commission_summary`, `get_entity_commission_summary`, `get_agent_commission_detail`) are **SECURITY INVOKER** (live `pg_proc`: `prosecdef=false`) and run under caller RLS — correct and unchanged by the collapse. The rollup RPCs were **not** touched by 0029–0031, so their scoping is governed by 0020 (out of this trio's blast radius).
- **Recommendation:** No change for the audited trio. Workstream B owns confirming the 0020 rollup RPCs still enforce claim scoping; recorded here only to close the advisor item against the new DB work.

---

## LOW

### F-12 — `settlement_batches.branch_id` / `agent_id` FKs have no `ON DELETE` action, inconsistent with `commissions`
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** Live `pg_constraint`: `settlement_batches_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id)` and `settlement_batches_branch_id_fkey … REFERENCES branches(id)` — **no `ON DELETE`** (defaults to `NO ACTION`). By contrast `commissions.branch_id` is `ON DELETE SET NULL` and `commissions.agent_id` is `ON DELETE CASCADE` (live + `0001:348-349`).
- **Impact:** Deleting an agent/branch that has settlement batches will be **blocked** by the FK (NO ACTION). In the demo, entities are never deleted, so no live impact. The inconsistency means batch history pins agent/branch rows in place differently than commissions do.
- **Recommendation:** Decide the intended retention policy and align: e.g. `agent_id … ON DELETE CASCADE` (batches die with the agent, matching commissions) or `ON DELETE RESTRICT` deliberately to preserve audit history. Document the choice.

### F-13 — `nominees` still has no `UNIQUE(subscriber_id, type)`; sum-to-100 invariant lives only in `upsert_nominees`
- **Classification:** already-known (BACKEND.md §15b audit D9)
- **Severity:** Low
- **Evidence:** Live `pg_constraint` for `nominees`: only PK, the subscriber FK, and two range CHECKs (`share ∈ [0,100]`, one of them `NOT VALID`). No uniqueness on `(subscriber_id, type)`. BACKEND.md §15b audit D9 documents this; the share-sum=100 check exists only inside `upsert_nominees`, so a direct INSERT bypasses it.
- **Impact:** Duplicate beneficiaries and >100% share totals are representable via any path that doesn't go through `upsert_nominees`. In the demo all writes go through the RPC, so no live impact. Restated only to confirm it is unchanged by 0029–0031 (it is).
- **Recommendation:** None new — tracked in BACKEND.md. Not a cutover blocker.

### F-14 — TEXT status columns without CHECK constraints (`subscribers.kyc_status`, `withdrawals.status`, `claims.status`, …) — unchanged
- **Classification:** already-known (BACKEND.md §15b audit D8)
- **Severity:** Low
- **Evidence:** BACKEND.md §15b audit D8 lists these implicit-enum TEXT columns. Live confirms `claims`/`withdrawals` carry only PK + subscriber FK (no status CHECK). Note: `commissions.status` is NOT in this bucket — it is a real `commission_status` enum (live `information_schema`: `USER-DEFINED`, default `'due'`), so the 0029 collapse correctly kept enum-level integrity for commissions.
- **Impact:** Discipline lives in client/RPC code. No live impact in the demo. Restated to confirm the 0029 collapse did not regress commission-status integrity (it didn't — it stayed a true enum).
- **Recommendation:** None new — tracked in BACKEND.md.

### F-15 — Denormalized columns are never refreshed (`commissions.subscriber_name`, `agents.coverage_rate/rating`, `branches.score/rank`) — settlement does not stale them further
- **Classification:** already-known (CLAUDE.md §10b / BACKEND.md §15a) / quality
- **Severity:** Low (awareness)
- **Evidence:** `commissions.subscriber_name` is stamped at insert by `trg_transactions_contribution` (`0002:186, :196`) and never updated; `branches.rank`/`agents.*` are seed-time computed (BACKEND.md §15a). `apply_settlement` does not touch any of these denorms.
- **Impact:** A subscriber rename after the first contribution leaves a stale `subscriber_name` on the commission line surfaced by `get_agent_commission_detail` (`0029:323, :343`). Pre-existing demo behaviour; the settlement flow neither fixes nor worsens it.
- **Recommendation:** None new — accepted demo denorm. Noted so synthesis doesn't attribute it to the new feature.

### F-16 — `config.toml` declares `[db.seed] sql_paths = ["./seed.sql"]` but no `seed.sql` exists
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `supabase/config.toml` `[db.seed]` block: `enabled = true`, `sql_paths = ["./seed.sql"]`. There is no `supabase/seed.sql` in the tree; seeding runs via `scripts/seed-supabase.mjs` (`npm run seed`). A `supabase db reset` would log a missing-seed-file warning (or skip) and produce an empty DB, surprising anyone who assumes the documented seed path works.
- **Impact:** Local-CLI-only confusion (`config.toml` governs the local emulator, not hosted). No production/demo impact. (Confirms plan note + baseline.)
- **Recommendation:** Either set `[db.seed] enabled = false` (and document `npm run seed` as the canonical path), or point `sql_paths` at a real generated file. Co-owned with Workstream G.

### F-17 — Unused-index candidates (genuine subset only) — new-feature indexes are *not* candidates
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** Baseline §5.4 (perf advisor `unused_index ×7`). The 3 `settlement_batches_*_idx` + `notifications_created_at_idx` are unused only because the feature is fresh (table empty / 3 rows) — **keep them**. The genuine pre-existing candidates are `idx_subscribers_gender`, `commissions_branch_id_status_idx`, `idx_commissions_status`.
- **Impact:** Marginal write-amplification / storage on the commissions indexes (30,001 rows). The two `commissions` status indexes may have been intended for the pre-collapse multi-state queries and are now redundant under the 2-state model.
- **Recommendation:** After the new flow has run in live for a while, re-check the advisor; drop `idx_subscribers_gender` and re-evaluate the two `commissions` status indexes against the simplified query patterns (the 0029 read RPCs filter on `status IN ('due','paid')` + `agent_id`/`branch_id`). Not a cutover blocker.

### F-18 — `distributors_update_self` perf advisor is a stale/false flag (live policy is already InitPlan-wrapped)
- **Classification:** already-known / no-action
- **Severity:** Low (awareness)
- **Evidence:** Baseline §5.4 flagged `auth_rls_initplan ×1` on `distributors_update_self`. Live `pg_policy` shows the USING clause is already the wrapped form `(( SELECT (auth.jwt() ->> 'distributorId'::text)) = id)` (the 0023 fix landed despite 0023 being ledger-missing — see F-3). The advisor flag does not reflect the current policy text.
- **Impact:** None — the optimization is in place. Recorded so synthesis does not open remediation for an already-fixed item.
- **Recommendation:** No action. (The `distributors` finding that *does* stand is the missing FORCE — F-9.)

---

## Summary table

| ID | Title | Class | Severity |
|---|---|---|---|
| F-1 | `apply_settlement` no idempotency guard → double-pay/double-notify | real-bug | High |
| F-2 | `0029.down.sql` lossy/irreversible → backup-before-cutover gate | quality | High |
| F-3 | Migration-ledger drift (6 missing) → `db push` collision risk | real-bug | High |
| F-4 | Per-line `paid_amount` = batch total (wrong per-line value) | real-bug | High |
| F-5 | `notifications.ref_id` no FK → orphan on batch delete | quality | Medium |
| F-6 | Unconstrained NUMERIC money cols + no rounding → fractional UGX | quality | Medium |
| F-7 | 0003/0006/0010/0025 non-idempotent (elevated by F-3) | already-known | Medium |
| F-8 | `apply_settlement` owned across 0030/0031 boundary; partial-rollback order undocumented | quality | Medium→Low |
| F-9 | `distributors` RLS not FORCE'd (only table) | quality | Medium→Low |
| F-10 | Older SECURITY DEFINER RPCs pin `public` w/o `pg_temp` | quality | Medium→Low |
| F-11 | rollup read RPCs anon-callable — confirm scoping (out of trio) | already-known | Medium (awareness) |
| F-12 | `settlement_batches` FKs no `ON DELETE` (inconsistent w/ commissions) | quality | Low |
| F-13 | `nominees` no `UNIQUE(subscriber_id,type)` | already-known | Low |
| F-14 | TEXT status cols no CHECK (commissions.status is a real enum) | already-known | Low |
| F-15 | Denorm cols never refreshed (settlement doesn't worsen) | already-known | Low |
| F-16 | `config.toml` references nonexistent `seed.sql` | quality | Low |
| F-17 | Unused-index candidates (new-feature ones excluded) | quality | Low |
| F-18 | `distributors_update_self` perf flag is stale (already wrapped) | already-known | Low |

**Cutover blockers (must precede `feat/simplify-commissions → main`):** F-3 (reconcile/clarify the migration ledger so `db push` can't half-apply), F-2 (verified prod backup as a go/no-go gate). Strongly recommended before cutover: F-1 (idempotency guard) and F-4 (per-line paid_amount) — both are reachable in the live settlement demo and produce wrong money/notification state, though neither corrupts the existing seeded dataset.
