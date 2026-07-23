> **Agent guide.** This is the one-time apply/verify/rollback runbook for the migrations (`0045`–`0057`) a human landed at the **G-DB** gate during the 2026-06 audit-remediation cutover of the live Singapore Supabase project. An AI agent almost never needs it for day-to-day work — read it only to reconstruct that specific cutover or to reuse its apply-in-order → verify-SELECT → reverse-`.down` pattern for a new migration campaign. Treat it as a historical record, not the current schema state (many later migrations have since shipped) nor a general migrations guide — for that, start at `docs/BACKEND.md`.

# Migrations apply runbook — audit-remediation cutover (2026-06)

Authoritative apply/verify/rollback procedure for the migrations that re-converge
the live Singapore Supabase project (`ilkhfnoyxlxwqadebnkp`, `ap-southeast-1`)
with the repo after the 2026-06-08 audit. A human applies these at the **G-DB**
gate; the agents only authored the `.sql` files.

> **Context (audit §0 / §1b.4):** `list_migrations` on live shows **48 applied**;
> **`0045` and `0048` were committed earlier but NEVER applied to live** (the
> live run went `0044 → 0046` and `0047 → 0049`, skipping both). Everything
> `0049 → 0051` (admin role) IS live. `0052 → 0057` are NEW this campaign.

---

## 0. Migration classification

| # | Migration | Class | One-line purpose |
|---|---|---|---|
| `0045` | `retire_employees` | **PRE-EXISTING, apply-forward** | Drops the dead standalone `employees` / `contribution_run_lines` tables + 3 orphan money RPCs (`submit_contribution_run`, `update_employee_*`). ⚠️ **one-way door** (§1b.6). |
| `0048` | `remove_employer_member` | **PRE-EXISTING, apply-forward** | Adds the `remove_employer_member(text)` RPC the employer "Remove from company" UI calls (else `PGRST202` on prod). |
| `0052` | `repin_insert_chain` | NEW (campaign) | Re-pins `_insert_subscriber_chain` `search_path` (sole `function_search_path_mutable` advisor) + defensively re-asserts the 3 balance triggers' DEFINER+pin. §1b.8. |
| `0053` | `schema_hygiene` | NEW (campaign) | This author's hygiene sweep: dup `nominees` CHECK, `coverage_rate` doc, `employer_invites` index, 5 bare-`public` pins, `employer_id` self-edit lock, `notifications` employer policy, `next_due_date` interval math, `create_*` input validation, `maxContribution` NULLIF, `users.phone` rationale. §1a.6/.7/.8/.9/.11, §1b.1/.5, §2a.8, §4a D-2, §4b.10. |
| `0054` | `subscriber_money_rpcs` | NEW (campaign) | `make_contribution` / `request_withdrawal` DEFINER RPCs + `money_nonces` ledger (idempotent, atomic). §4a F-1/F-2/F-3/F-5. |
| `0055` | `set_commission_rate` | NEW (campaign) | `set_commission_rate(numeric)` DEFINER RPC (bounded) replacing the unvalidated direct `commission_config.rate` client write. §4a F-7. |
| `0056` | `atomic_employer_config` | NEW (campaign) | Atomic employer config + group-insurance save (`update_employer_profile` re-emit). §7d-3. |
| `0057` | `perf_rpcs` | NEW (campaign) | Set-based rewrites of `get_platform_overview` / `get_all_employers_metrics` / `get_entity_metrics_rollup` (identical output contracts). §5b.1/.2/.3. |

**Reseed** (`npm run seed`, `scripts/seed-supabase.mjs`) runs **AFTER all eight
migrations apply** — never interleaved (so the seed writes against the final
schema, incl. the dropped `employees` tables and the new constraints/indexes).

---

## 1. Apply order

Apply strictly in this order. After EACH migration run its **verify SELECT**
(read-only). **On any verify failure: run that migration's `.down`, then HALT**
and escalate — do not proceed to the next.

```
0045  →  0048  →  0052  →  0053  →  0054  →  0055  →  0056  →  0057
```

### ⚠️ 0045 is a ONE-WAY DOOR — apply FIRST, verify, then proceed

`0045` issues unconditional `DROP TABLE public.contribution_run_lines` and
`DROP TABLE public.employees` (§1b.6). On live these tables still hold the
seed's 16 `employees` rows. **The drop is irreversible live data loss** — its
`.down` recreates the *table shells* (+ indexes, RLS, the 3 RPC bodies) but
**cannot restore the dropped rows**. Confirm the unified model (tagged
subscribers, `0043/0044`) is the only roster any dashboard reads (it is — the
seed never re-populates `employees`) BEFORE applying. Because live ran
`0049` while `contribution_run_lines` still existed, `0049` created
`contribution_run_lines_select_admin` on it; `0045` then drops the table
(taking the policy with it — fine forward), which is why `0049.down` was
hardened with a `to_regclass` guard (§1b.6).

**Seed reconcile with 0045:** the seed already does **not** insert `employees`
/ `contribution_run_lines` and its TRUNCATE block does not list them, so no seed
change is required for the drop. (Separately, §1b.9 asks the seed-reconcile
agent to ADD `employer_invites` + `subscriber_signup_uploads` to the TRUNCATE
block — that is a seed change, owned by C6, not a migration.)

### Interim mitigation if 0045 is DEFERRED

If the cutover ships without `0045` (the one-way door is judged too risky for
this window), immediately neutralise the orphan money RPCs it would have
dropped — they are live, dead, and `anon`/`authenticated`-EXECUTE-able
(§1a.5 / audit recommendation #11):

```sql
-- Interim hardening ONLY (skip if 0045 was applied — 0045 drops these outright):
REVOKE EXECUTE ON FUNCTION public.submit_contribution_run(jsonb, text, text, text)        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_employee_contribution_config(text, jsonb)         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_employee_insurance(text, numeric, numeric)        FROM anon, authenticated;
```
Track the deferral; `0045` must still land before any real-data launch.

---

## 2. Per-migration verify SELECT

All verifies are **read-only**. "PASS" = the expected row(s) returned. On FAIL,
run the migration's `.down` and HALT.

### 0045 — `retire_employees`
```sql
-- PASS: both legacy tables are GONE (each returns NULL).
SELECT to_regclass('public.employees')              AS employees,
       to_regclass('public.contribution_run_lines') AS run_lines;
-- PASS: the 3 orphan RPCs are GONE (0 rows).
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND proname IN ('submit_contribution_run','update_employee_contribution_config','update_employee_insurance');
```

### 0048 — `remove_employer_member`
```sql
-- PASS: the RPC now resolves (1 row).
SELECT 'remove_employer_member'::regproc;
```

### 0052 — `repin_insert_chain`
```sql
-- PASS: proconfig pins search_path (NOT null).
SELECT proname, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND proname = '_insert_subscriber_chain';
-- PASS: get_advisors(security) no longer lists function_search_path_mutable.
```

### 0053 — `schema_hygiene`
```sql
-- (a) §1a.6 — only ONE nominees range CHECK remains (the 0001 inline one).
SELECT conname FROM pg_constraint
 WHERE conrelid = 'public.nominees'::regclass AND contype = 'c'
   AND conname IN ('nominees_share_check','nominees_share_range_chk');
--    PASS: returns nominees_share_check only; nominees_share_range_chk ABSENT.

-- (b) §1a.11 — covering index present.
SELECT to_regclass('public.employer_invites_subscriber_id_idx');   -- PASS: not null.

-- (c) §1b.1 — all 5 functions now pin public, pg_temp.
SELECT proname, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND proname IN ('create_subscriber_from_signup','create_subscriber_from_agent_onboard',
                   'get_entity_metrics_rollup','upsert_nominees','trg_distributors_enforce_editable_cols');
--    PASS: every proconfig = {search_path=public,pg_temp}.

-- (d) §1a.8 — employer_id is now in the lock-list (body contains the guard).
SELECT pg_get_functiondef('public.trg_subscribers_enforce_editable_cols()'::regprocedure) LIKE '%cannot modify employer_id%';
--    PASS: true.

-- (e) §1a.9 — notifications employer SELECT policy present.
SELECT polname FROM pg_policy WHERE polrelid = 'public.notifications'::regclass
   AND polname = 'notifications_select_employer';                  -- PASS: 1 row.

-- (f) §2a.8 — create_employer now validates (district-existence guard in body).
SELECT pg_get_functiondef('public.create_employer(text,text,text,text,text,text,text,text,jsonb)'::regprocedure) LIKE '%does not exist%';
--    PASS: true.

-- (g) §1a.7 — coverage_rate documented (and still present — NOT dropped).
SELECT col_description('public.agents'::regclass,
         (SELECT attnum FROM pg_attribute WHERE attrelid='public.agents'::regclass AND attname='coverage_rate')) IS NOT NULL;
--    PASS: true.
```

### 0054 — `subscriber_money_rpcs`
```sql
-- PASS: both RPCs + the nonce ledger exist.
SELECT 'make_contribution'::regproc, 'request_withdrawal'::regproc;
SELECT to_regclass('public.money_nonces');                         -- PASS: not null.
```

### 0055 — `set_commission_rate`
```sql
SELECT 'set_commission_rate'::regproc;                             -- PASS: 1 row.
```

### 0056 — `atomic_employer_config`
```sql
-- PASS: update_employer_profile re-emitted (still resolves; body atomic).
SELECT 'update_employer_profile'::regproc;
```

### 0057 — `perf_rpcs`
```sql
-- PASS: the three rollups still resolve and still pin search_path.
SELECT proname, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND proname IN ('get_platform_overview','get_all_employers_metrics','get_entity_metrics_rollup');
--    PASS: 3 rows, each proconfig = {search_path=public,pg_temp}.
-- Smoke (admin JWT context): SELECT public.get_platform_overview();  -- returns the 13-key object.
```

> **Benign overlap (0053 ↔ 0057):** both pin `get_entity_metrics_rollup` to
> `public, pg_temp` (§1b.1 in 0053 via `ALTER`; §5b.1 in 0057 via body re-emit).
> Applying 0057 after 0053 simply re-asserts the same pin — idempotent, no
> conflict. The 0057 verify above is the canonical post-state.

### Final (after all 8 apply, before reseed)
```sql
-- get_advisors(security): function_search_path_mutable count should be 0.
-- get_advisors(performance): the 90× multiple_permissive_policies remain
--   (expected — the 0049 admin clones, accepted per §1a.12; NOT a failure).
```

---

## 3. Rollback (reverse order)

If a later step fails after earlier steps committed, roll back the COMMITTED
steps in **reverse** apply order, each via its `.down`, running the same verify
inverted (object ABSENT / restored):

```
0057.down → 0056.down → 0055.down → 0054.down → 0053.down → 0052.down → 0048.down → 0045.down
```

Notes per `.down` (§1b.6 hardening — every `.down` restores the **hardened**
prior definition, never a vulnerable one):

- **`0057.down` / `0056.down` / `0055.down` / `0054.down`** — additive RPCs /
  body re-emits; `.down` restores the prior body or `DROP FUNCTION IF EXISTS`.
- **`0053.down`** — reverses all 10 blocks in reverse order with
  `IF EXISTS` / `to_regclass` / `to_regprocedure` guards (safe to re-run):
  re-adds the duplicate `nominees` CHECK (`NOT VALID`, like 0024), drops the
  `coverage_rate` comment + the index, reverts the 5 pins to bare `public`
  (still-safe hardened state), restores `_insert_subscriber_chain` (365-day
  math) and `trg_subscribers_enforce_editable_cols` (no `employer_id` lock) and
  the two `create_*` + `submit_employer_contribution_run` bodies — **all with
  the `public, pg_temp` pin retained** (never the un-pinned 0042 form), drops the
  `notifications` employer policy, clears the `users` comment.
- **`0052.down`** — RESETs only `_insert_subscriber_chain`'s pin; the step-2
  balance-trigger DEFINER+pin re-assertions are **intentionally left in place**
  (undoing them would re-open the security regression — §1b.6).
- **`0048.down`** — `DROP FUNCTION IF EXISTS public.remove_employer_member(text)`.
- **`0045.down`** — recreates the `employees` / `contribution_run_lines` table
  shells, indexes, RLS, and the 3 RPC bodies. ⚠️ **Cannot restore the dropped
  rows** (the one-way-door data loss is permanent). Must run **before**
  `0044.down` in any deeper rollback (so `0044.down`'s employees-based bodies
  bind). After `0045.down`, if `0049` is still live, its
  `contribution_run_lines_select_admin` policy is recreated by `0045.down`'s RLS
  block — consistent with the `to_regclass`-guarded `0049.down`.

---

## 4. Quick checklist

1. Snapshot / PITR marker on live (the `0045` drop is irreversible).
2. Apply `0045` → verify → (if deferred, run the §1 interim REVOKE instead).
3. Apply `0048` → `0052` → `0053` → `0054` → `0055` → `0056` → `0057`, verifying after each.
4. Run the final `get_advisors` check (`function_search_path_mutable` → 0).
5. **Then** `npm run seed` (reseed once, against the final schema).
6. Smoke the employer "Remove from company" action (0048) and an admin
   create-employer with a bad district (0053 — should now error friendly).
