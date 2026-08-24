# A01 · Schema & Migration Integrity

**Scope:** `supabase/migrations/**` (194 files) vs the live Singapore project `ilkhfnoyxlxwqadebnkp`.
**Method:** every claim below is measured against the live database over a direct `psql` connection,
or parsed from the migration text with a purpose-built SQL tokenizer. Per **G8** the ledger
(`supabase_migrations.schema_migrations`) was **not** used to establish applied state — the baseline
(§7) proved it is structurally unjoinable to the `0001_*`-named files. **Behaviour was diffed, not versions.**

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 194 migration files + 796 live schema objects (38 relations · 382 columns · 94 constraints · 85 indexes · 109 policies · 89 functions) |
| Artifacts examined | 194 / 194 files · 796 / 796 live objects |
| Coverage | 100% |
| Checks defined | 10 |
| Checks executed | 10 |
| Checks passed / failed / blocked | 7 / 3 / 0 |
| Findings C / H / M / L / I | 0 / 1 / 3 / 4 / 2 |
| Evidence commands run | 60 |
| Excluded as demo-scope | 1 (blanket `TRUNCATE` grant to `anon`/`authenticated` on all 35 base tables — a Supabase platform default, unreachable through PostgREST; recorded as A01-010 Info and handed to A03, not scored as a divergence) |
| Blocked, with reason | 1 sub-probe: an empirical `TRUNCATE … ROLLBACK` on `subscriber_balances_pre_nav` was refused by the auto-mode classifier. It changes no finding — the grant survey answered the question read-only. |

### Domain metrics
| Metric | Value |
|---|---|
| Migrations parsed | **194** (108 forward + 86 down) |
| `CREATE FUNCTION` statements parsed | **203**, across **108** distinct names, **53** of them multi-defined |
| Tables / views verified | **37 tables + 1 view**, both directions |
| Columns verified | **382** (374 on base tables), both directions |
| Constraints verified | **94** (35 PK · 30 FK · 24 CHECK · 5 UNIQUE), both directions |
| Indexes verified | **85**, both directions |
| Policies verified | **109**, both directions |
| Function bodies diffed against `pg_proc.prosrc` | **89** (every live function) |
| Body mismatches — raw text | **26** |
| Body mismatches — after whitespace/comment normalisation | **1** |
| Body mismatches — **unexplained** | **0** |
| Overloads found (`proname` with >1 OID) | **0** |
| DEFINER functions without a pinned `search_path` | **0 of 70** |
| Backfill-no-op candidates found / confirmed | **22 found** (19 `ADD COLUMN … DEFAULT` + 3 `WHERE … IS NULL` backfills) / **0 confirmed no-ops** |

---

## 1. Headline: the CREATE-OR-REPLACE history has NOT diverged

This agent exists because `0095` once silently clobbered `0090`. **That failure class does not recur
anywhere in the current history.** All 89 live functions carry exactly the body their latest migration
defines.

Method: parse every `CREATE [OR REPLACE] FUNCTION` in the 108 forward migrations in filename order,
keep the last definition per name, and compare its dollar-quoted body against `pg_proc.prosrc`.

```
$ python3 parse_fns.py
total CREATE FUNCTION statements: 203
distinct names: 108
multi-defined names: 53

$ python3 diff_fns.py
in files not live: 19
['agent_confirm_commission', 'agent_dispute_line', 'approve_dispute', 'branch_approve_all',
 'branch_approve_line', 'branch_dispute_line', 'branch_hold_line', 'cancel_run',
 'get_run_branch_breakdown', 'mark_branch_reviewed', 'open_run', 'reject_dispute',
 'release_branch', 'release_run', 'submit_contribution_run', 'trg_commissions_before_update',
 'update_employee_contribution_config', 'update_employee_insurance', 'withdraw_dispute']

live not in files: 0
[]

MATCH exact: 63
MISMATCH: 26
```

The 19 in-files-not-live are exactly the `0021` commission run-model that `0029_commission_simplify.sql`
dropped — the baseline's §5.1 finding, re-confirmed independently.

The 26 raw mismatches were then re-diffed on a **SQL token stream** (comments stripped, whitespace
collapsed, string literals and identifiers preserved):

```
$ python3 tok.py
COSMETIC-ONLY (token-identical): 25
    apply_group_insurance, approve_access_request, cancel_employer_invite, create_employer,
    create_subscriber_from_agent_onboard, create_subscriber_from_employer_onboard,
    create_subscriber_from_signup, fund_insurance_products, get_agent_commission_detail,
    get_all_employers_metrics, get_branch_pending_contributions, get_employer_activity_rollup,
    get_employer_geo_rollup, get_employer_invite, get_platform_overview,
    group_insurance_premium_per_member, guard_mass_subscriber_detach, make_contribution,
    pay_insurance_premium, register_login_identity, set_distributor_status, set_employer_status,
    trg_distributors_enforce_editable_cols, trg_subscribers_enforce_editable_cols, upsert_nominees

SEMANTIC MISMATCH: 1
    apply_settlement last-file: 0032_fix_settlement_apply.sql
```

Representative cosmetic case (`get_employer_invite`) — pure reflow, identical tokens:

```diff
--- FILE:0047_employer_invites.sql
+++ LIVE:get_employer_invite
-  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found' USING ERRCODE = 'P0002'; END IF;
+  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found' USING ERRCODE='P0002'; END IF;
-  RETURN jsonb_build_object(
-    'employerId', v_inv.employer_id,
-    'employerName', v_employer_name,
+  RETURN jsonb_build_object('employerId', v_inv.employer_id, 'employerName', v_employer_name,
```

### The one semantic mismatch is not a divergence — it is a dynamic patch my parser could not see

```
$ cat tdiffs/apply_settlement.tdiff
--- FILE:0032_fix_settlement_apply.sql
+++ LIVE
 if v_role
-is distinct from 'distributor'
+not in ( 'distributor' , 'admin' )
 then raise exception 'role % cannot apply a settlement'
```

```
$ grep -n "cannot apply a settlement" -B4 supabase/migrations/0032_fix_settlement_apply.sql
133-  IF v_role IS DISTINCT FROM 'distributor' THEN
134:    RAISE EXCEPTION 'role % cannot apply a settlement', v_role

$ psql -c "SELECT l.n, l.t FROM pg_proc p, LATERAL unnest(string_to_array(p.prosrc,E'\n'))
           WITH ORDINALITY AS l(t,n) WHERE p.proname='apply_settlement' AND l.t ILIKE '%cannot apply%'"
25|  IF v_role NOT IN ('distributor', 'admin') THEN
26|    RAISE EXCEPTION 'role % cannot apply a settlement', v_role
```

The source is `0051_admin_apply_settlement.sql`, which patches the body **dynamically**:

```sql
DO $migration$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.apply_settlement(jsonb, text)'::regprocedure);
  v_def := replace(v_def,
    'v_role IS DISTINCT FROM ''distributor''',
    'v_role NOT IN (''distributor'', ''admin'')');
  EXECUTE v_def;
END
$migration$;
```

Live == files. **Check 2 PASSES with zero unexplained divergences.**

Only four forward migrations use `pg_get_functiondef` (`0007`, `0051`, `0103`, `0104`); in `0103`/`0104`
the mentions are commentary — the bodies are emitted literally, and they match live byte-for-byte.

### Function attributes also reconcile

Signature, return type, language, volatility, `SECURITY DEFINER` and `search_path` were compared
separately from the body. Every apparent difference resolves to a later bare `ALTER FUNCTION`
(`0006`, `0010`, `0012`, `0014`, `0015`, `0023`, `0028`, `0052`, `0053`, `0083`) — for example
`trg_subscribers_after_insert` is INVOKER in `0002` and DEFINER live because `0006:20` and `0052:31`
altered it; `search_entities` gains `extensions` on its path from `0012` and is repaired by `0083`.
After correcting the parser for trailing clauses, **RETURNS mismatches = 0**.

---

## 2. Live schema == migration schema, both directions

### Tables
```
$ python3 (table reconciliation)
live relations: 38
IN FILES, NOT LIVE:
   contribution_run_lines  created: 0034  dropped: 0045_retire_employees.sql
   employees               created: 0034  dropped: 0045_retire_employees.sql
   settlement_run_branch_reviews  created: 0001  dropped: 0029_commission_simplify.sql
   settlement_runs                created: 0001  dropped: 0029_commission_simplify.sql
LIVE, NOT IN FILES:   (none)
```
(The apparent "`commissions` dropped by 0025" is an artifact of `ALTER PUBLICATION supabase_realtime
DROP TABLE public.commissions` at `0025:15` — verified, not a real `DROP TABLE`.)

### Columns
```
$ python3 cols.py
tables parsed from files: 37
COLUMNS IN FILES BUT NOT LIVE: 0
COLUMNS LIVE BUT NOT IN ANY FORWARD MIGRATION: 15
   subscriber_balances_pre_nav.{subscriber_id, retirement_balance, emergency_balance, total_balance,
     units, retirement_units, emergency_units, invested, nav_as_of, updated_at, snapshot_at}
   subscribers_unit_value_pre_nav.{id, current_unit_value, unit_value_as_of, snapshot_at}
```
Both tables are created by `0105_nav_backfill.sql:72` / `:86` with `CREATE TABLE … AS SELECT`, which
carries no paren column list — the columns are inherited from the source tables, so this is a parser
blind spot, not a divergence. They are the documented rollback snapshot for the NAV migration.

I also proved there is **no DDL hidden inside `DO` blocks** that the column parser could have missed:
scanning every dollar-quoted region across all 108 forward migrations finds only `ALTER TABLE … ADD
CONSTRAINT` (`0027`, `0033`, `0096`, `0099`) and `ALTER PUBLICATION` (`0003`, `0028`) — **zero**
`ADD COLUMN` / `DROP COLUMN` / `CREATE TABLE`.

### Types, nullability, defaults
After correcting two parser bugs (a `|` field separator colliding with the `||` operator inside
`column_default`, and a lower-cased declaration string), the only surviving differences are Postgres
canonicalisations — `'due'` → `'due'::commission_status`, `now() + interval '7 days'` →
`(now() + '7 days'::interval)`, `bigserial` → `nextval(...)`, and `ALTER COLUMN product SET NOT NULL`
applied by `0099:68` after the `ADD COLUMN`. **Zero real mismatches.**

### Constraints
```
$ psql -c "SELECT contype, count(*) FROM pg_constraint … WHERE nspname='public' GROUP BY 1"
c | 24     f | 30     p | 35     u | 5      (94 total)
```
* **FK, live → files:** all 30 trace to a forward migration with a matching `ON DELETE` action. The one
  not declared inline is `notifications_ref_id_fkey`, added inside the DO block at
  `0033_post_audit_hardening.sql`.
* **FK, files → live:** `FK declared in a forward migration but ABSENT live: 0`.
* **CHECK:** all 24 live checks trace to a forward migration (11 explicitly named, 13 auto-named from
  inline `CHECK (…)` in `CREATE TABLE` — each verified by reading the source line).
* **Files → live:** the only named constraint in the files that is not live is
  `settlement_runs_state_chk`, on the table `0029` dropped.
* Two tables have no primary key: `subscriber_balances_pre_nav`, `subscribers_unit_value_pre_nav` —
  both `CREATE TABLE AS` snapshots. Expected.

### Indexes
```
LIVE indexes not named in any CREATE INDEX and not a constraint: []
CREATE INDEX in files but NOT live (and not dropped later):
   contribution_run_lines_employee_id_idx, contribution_run_lines_run_id_idx, employees_employer_id_idx
```
All three sit on tables `0045` dropped; the indexes went with them. No divergence.

### Policies
```
$ psql -c "SELECT json_agg(...) FROM pg_policies WHERE schemaname='public'"
live policies: 109
LIVE NOT IN ANY FORWARD MIGRATION: []
policies using auth.uid(): []
policies using ->> 'role': []
```
Independently reproduces the baseline. **The 8 policies stranded on dropped tables (check 6) are:**
`contribution_run_lines_by_employer_select`, `contribution_run_lines_select_admin`,
`employees_by_employer_select`, `settlement_run_branch_reviews_select_branch`,
`settlement_run_branch_reviews_select_distributor`, `settlement_runs_select_agent`,
`settlement_runs_select_branch`, `settlement_runs_select_distributor` — all absent live because their
tables are absent. Harmless: a policy cannot outlive its table in Postgres. The remaining 10
in-files-not-live policies each carry an explicit later `DROP POLICY` (`0014`, `0081`, `0089`, `0094`, `0099`).

---

## 3. Overloads and DEFINER hygiene (checks 3 & 4) — both clean

```
$ psql -c "SELECT p.proname, count(*) FROM pg_proc p … GROUP BY 1 HAVING count(*)>1"
(0 rows)

$ psql -c "SELECT count(*) AS oids, count(DISTINCT proname) AS names FROM pg_proc …"
89 | 89

$ psql -c "SELECT p.proname, p.oid::text, pg_get_function_identity_arguments(p.oid) …
           WHERE proname IN ('create_distributor','update_employer_profile')"
create_distributor      | 29390 | p_name text, p_manager_name text, p_manager_phone text,
                                   p_manager_email text, p_parent_id text, p_registration_no text
update_employer_profile | 24885 | p_patch jsonb, p_group_cover numeric, p_insurance_enabled boolean
```
One OID per name. The audit plan's "orphaned 5-arg `create_distributor` / 1-arg
`update_employer_profile` still reachable" hypothesis is **refuted at the DB layer**, exactly as the
baseline predicted. Recorded as a PASS; no finding manufactured.

```
$ psql -c "SELECT p.proname FROM pg_proc p WHERE prosecdef AND (proconfig IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'))"
(0 rows)

$ psql -c "SELECT count(*) FILTER (WHERE prosecdef), count(*) FILTER (WHERE prosecdef AND proconfig IS NOT NULL) …"
70 | 70
```

---

## 4. `entity_detach_log` / `entity_status_log` (check 7) — answered empirically

Both carry `ENABLE` without `FORCE` and hold **zero policies**:

```
$ psql -c "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, (policy count) …"
entity_detach_log|t|f|0
entity_status_log|t|f|0
subscriber_balances_pre_nav|t|t|0
subscribers_unit_value_pre_nav|t|t|0
```

The point of the check is whether any path can actually read or write them. It cannot — the defence is
the **table grant**, not RLS:

```
$ for t in entity_detach_log entity_status_log …; for r in anon authenticated; do
    psql -c "BEGIN; SET LOCAL ROLE $r; SELECT count(*) FROM public.$t; ROLLBACK;"
SELECT entity_detach_log as anon          => ERROR:  permission denied for table entity_detach_log
SELECT entity_detach_log as authenticated => ERROR:  permission denied for table entity_detach_log
SELECT entity_status_log as anon          => ERROR:  permission denied for table entity_status_log
SELECT entity_status_log as authenticated => ERROR:  permission denied for table entity_status_log
SELECT subscriber_balances_pre_nav as anon/authenticated    => 0
SELECT subscribers_unit_value_pre_nav as anon/authenticated => 0
```

`entity_detach_log` and `entity_status_log` are the **only two of 35 base tables with no grant at all**
to `anon`/`authenticated` (see A01-010). Missing `FORCE` is therefore inert: the only role that would
benefit from bypassing RLS is the table owner `postgres`, which carries `rolbypassrls` regardless.
**PASS**, with the caveat that the protection is one `GRANT` away from evaporating, since with zero
policies a grant would still yield zero rows for a non-owner — so even then the exposure is nil.

---

## 5. `nav_snapshots` created twice (check 8) — the second is a true no-op

`0096_admin_attention_schema.sql:47` and `0103_nav_pricing_schema.sql:77` both emit the table. Diffed
line by line: the 9 columns, the `UNIQUE (fund_code, nav_date)` constraint, the two `CREATE INDEX IF NOT
EXISTS`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, the `DROP POLICY IF EXISTS` + `CREATE POLICY
nav_snapshots_select_admin`, and `GRANT SELECT … TO authenticated` are **identical**; the only textual
difference is a trailing comment on the `source` column. Guarded by `IF NOT EXISTS` throughout, so the
second emission changes nothing. `0103` then extends the table with four new columns, and
`0103_nav_pricing_schema.down.sql` correctly refuses to drop the table (`⚠️ nav_snapshots is
DELIBERATELY NOT DROPPED. It is owned by 0096…`). **PASS.**

---

## 6. Down-migration coverage (check 5)

```
$ for f in $(ls *.sql | grep -v '\.down\.sql$'); do [ -f "${f%.sql}.down.sql" ] || echo "NO-DOWN: $f"; done
NO-DOWN: 0001 … 0015, 0017 … 0021, 0027, 0028   (22 files)
$ for f in $(ls *.down.sql); do [ -f "${f%.down.sql}.sql" ] || echo "ORPHAN-DOWN: $f"; done
(none)
```
The 22 gaps are confirmed and are all pre-`0029` — `0016` and `0022`–`0026` do have downs. See **A01-008**.

The newest 10 downs (`0099`–`0108`) were parsed, **never executed** (G6). Four mechanical hazards were
tested:

1. **`DROP FUNCTION` with a signature that no longer resolves** (a silent no-op). All 11 signatures
   across the 10 downs resolve:
   ```
   $ psql -c "SELECT s, coalesce(to_regprocedure(s)::text,'*** NO SUCH LIVE FUNCTION ***') FROM unnest(ARRAY[…]) s"
   public._hospital_cash_days()                                    =>  _hospital_cash_days()
   public._resync_bucket_units(TEXT)                               =>  _resync_bucket_units(text)
   public.get_nav_overview(TEXT)                                   =>  get_nav_overview(text)
   public.latest_nav(TEXT)                                         =>  latest_nav(text)
   public.list_nav_snapshots(TEXT, INTEGER, INTEGER, TEXT)          =>  list_nav_snapshots(text,integer,integer,text)
   public.list_nominee_claims(text)                                =>  list_nominee_claims(text)
   public.nav_for_date(DATE, TEXT)                                 =>  nav_for_date(date,text)
   public.publish_nav_snapshot(DATE, NUMERIC, TEXT, TEXT, BOOLEAN)  =>  publish_nav_snapshot(date,numeric,text,text,boolean)
   public.register_login_identity(text,text,text,text,text,text)    =>  register_login_identity(text,…)
   public.review_nominee_claim(text, text, text, text)              =>  review_nominee_claim(text,text,text,text)
   public.submit_hospital_cash_claim(text, date, date, text, text)  =>  submit_hospital_cash_claim(text,date,date,text,text)
   ```
2. **A down that drops a column its own forward never added** (would delete pre-existing data). Scanned
   all 86 downs: `DOWN drops a column its own FORWARD never added: 0`.
3. **A down that drops a table its own forward never created**: `0`.
4. **A `CREATE OR REPLACE` down that restores a body a *later* migration has since changed** (the
   stale-restore trap). For each of the newest 10 downs, cross-checked every function it re-emits
   against all higher-numbered forwards: `DOWN re-emits a function that a LATER forward migration also
   changed: 0`.

Two downs that *look* dangerous already document themselves correctly and are therefore **not** findings:
* `0101…down.sql` re-emits the `0095` body of `approve_access_request` — i.e. rolling back deliberately
  re-opens the tenant-crossover regression. Its header says so verbatim (`⚠️ Rolling back re-opens the
  defect this migration exists to close`), it reverts all three callers **before** dropping
  `register_login_identity` at line 206 (correct order), and it deliberately preserves the data repair.
* `0103…down.sql` drops `subscriber_balances.{retirement_units, emergency_units, invested, nav_as_of}`
  while the live `0104` bodies of `trg_transactions_contribution` and `request_withdrawal` still
  reference them. Its header states the required order (`0105.down → 0104.down → 0103.down`) and the
  consequence of getting it wrong.

**Disposition: FINDING A01-008** for the 22 missing downs; the mechanical reversibility of the newest
10 is clean.

---

## 7. Index health (check 9) — structural only

**On statistics:** `pg_stat_user_tables.n_live_tup` reads 0 for every table because the restore reset
the collector (baseline §6). `pg_stat_user_indexes.idx_scan` is a *different* story and the baseline's
warning must not be over-applied — it has already accumulated:

```
$ psql -c "SELECT count(*) total_indexes, count(*) FILTER (WHERE idx_scan=0) zero_scans, max(idx_scan)
           FROM pg_stat_user_indexes WHERE schemaname='public'"
85 | 31 | 107674
```

31 of 85 indexes show zero scans, but the counter has only been running since this morning's restore
and the only workload it has seen is the audit's own Playwright suite plus these queries.
**I therefore make no "unused index" claim** — that reading is not evidence. Everything below is
structural and valid without statistics.

* **FK columns with no covering index** — see A01-007.
* **Exact-duplicate index** — see A01-005.
* **Redundant leading-prefix indexes** — see A01-006.

---

## 8. The Postgres 11 `ADD COLUMN … DEFAULT` stamping trap (check 10)

Postgres 11+ does not rewrite the heap for `ADD COLUMN … DEFAULT <non-volatile>`; it stamps every
existing row immediately, so a later `WHERE col IS NULL` backfill matches nothing.

**19 `ADD COLUMN … DEFAULT` statements** exist across the forward migrations, and **3 top-level
`WHERE … IS NULL` backfills**. Pairing them:

| Pair | Verdict |
|---|---|
| `0096:139` `withdrawals.expected_by DATE DEFAULT (CURRENT_DATE + 5)` → `0096:141` `UPDATE … WHERE expected_by IS NULL OR expected_by = CURRENT_DATE + 5` | **Author was already aware.** `0096:129-137` documents the trap by name and keys the backfill on the *stamped value*, not on NULL. |
| `0096:144` `claims.expected_by DATE DEFAULT (CURRENT_DATE + 10)` → `0096:146` same idiom | Same. |
| `0099:47` `claims.product TEXT` (**no default**) → `0099:66` `UPDATE … WHERE product IS NULL` → `0099:68` `SET NOT NULL` | Safe by construction — no default means the rows really are NULL. |
| `0060:42` `branches.distributor_id text` (**no default**) → `0060:48` `UPDATE … WHERE distributor_id IS NULL` | Safe by construction. |

The remaining 15 `ADD COLUMN … DEFAULT` statements are `NOT NULL DEFAULT`, where stamping is the
*intent* (e.g. `0063:34` adds `insurance_policies.product NOT NULL DEFAULT 'life'` and immediately
`DROP DEFAULT` so later inserts must be explicit — `0064:36` then drops the column again, which is why
it is correctly absent live).

**Confirmed no-ops: 0.** Verified against live data, not reasoned:

```
$ psql -c "SELECT count(*) total, count(*) FILTER (WHERE expected_by IS NULL) nulls,
           count(*) FILTER (WHERE expected_by = date + 5) matches, … FROM public.withdrawals"
4937|0|4937|0|2025-06-01|2026-08-12|2025-05-27|2026-08-07

$ psql -c "… FROM public.claims"           -- expected_by vs submitted_date + 10
1907|0|1907|0

$ psql -c "SELECT product, count(*) FROM public.claims GROUP BY 1"
health|1907
```

The same check applied to the **other 16 top-level backfills** (not IS-NULL-keyed, so outside the
literal trap but inside the "verify the data actually landed" mandate) found one that **did not
survive** — see **A01-002** — and three healthy:

```
$ psql -c "SELECT count(*) FILTER (WHERE default_contribution_config ? 'mode'),
           … ? 'employerMatchPct', … ? 'matchPct', … ? 'maxContribution', count(*) FROM public.employers"
0 | 0 | 0 | 0 | 8                      -- 0062 + 0093 config migrations fully landed

$ psql -c "SELECT count(*) total, count(*) FILTER (WHERE compensation=0) FROM public.subscribers"
5064 | 5006                            -- 58 non-zero == the 58 employer members. 0062 landed.

$ psql -c "SELECT count(*) FILTER (WHERE is_demo_signup),
           count(*) FILTER (WHERE is_demo_signup AND phone IS DISTINCT FROM public._canonical_ug_phone(phone)
           AND public._canonical_ug_phone(phone) IS NOT NULL) FROM public.subscribers"
5 | 0                                  -- 0014 phone canonicalisation landed

$ psql -c "SELECT count(*), count(*) FILTER (WHERE nav_as_of IS NULL), … FROM public.subscriber_balances"
5060 | 0 | 1 | 1 | 1                   -- 0103/0105 NAV backfill landed; the three 1s are A01-004
```

---

## 9. Findings

### A01-001 · **HIGH** · confirmed · E2E fixture rows are permanently resident in the live demo database and are named on the admin "Needs attention" screen

**Location:** live data — `public.subscribers` (4 rows), `public.branches` (1 row); teardown at
`e2e/specs/db/deactivate-entities.spec.ts:153-170`

Four `TST` subscribers and one `TST` branch, left behind by at least three separate interrupted runs of
the `deactivate-entities` DB spec (run tags `msc7vzsc`, `msc7w8vm`, `msd3855c`), are still in the live
database. They are not inert: they violate the invariant that every subscriber has a balance row
(enforced by `trg_subscribers_after_insert`), and `v_reconciliation_exceptions` — which drives the admin
Needs-attention panel — reports each one by name.

**Evidence**

```
$ psql -c "SELECT id, name FROM public.subscribers WHERE id ILIKE 'tst%' OR name ILIKE '%TST%'"
tst-sub-tree-msc7vzsc |TST tree member
tst-sub-emp-msc7vzsc  |TST employer member
tst-sub-retag-msc7vzsc|TST retag probe
tst-sub-tree-msd3855c |TST tree member
$ psql -c "SELECT id, name FROM public.branches WHERE id ILIKE 'tst%'"
tst-branch-msc7w8vm|TST throwaway branch

$ psql -c "SELECT s.id, s.name FROM public.subscribers s
           LEFT JOIN public.subscriber_balances b ON b.subscriber_id=s.id WHERE b.subscriber_id IS NULL"
tst-sub-emp-msc7vzsc  |TST employer member
tst-sub-retag-msc7vzsc|TST retag probe
tst-sub-tree-msc7vzsc |TST tree member
tst-sub-tree-msd3855c |TST tree member          -- exactly 4: this IS the baseline's 5064 vs 5060 gap
$ psql -c "SELECT count(*) FROM public.subscriber_balances b
           LEFT JOIN public.subscribers s ON s.id=b.subscriber_id WHERE s.id IS NULL"
0                                                -- no orphan balances; the gap is one-directional
```

Demo-visible, as the admin sees it:

```
$ psql -c "BEGIN; SET LOCAL request.jwt.claims='{\"app_role\":\"admin\",\"sub\":\"admin-001\"}';
           SET LOCAL ROLE authenticated; SELECT jsonb_pretty(public.get_admin_attention()); ROLLBACK;"
    "reconciliation": { "total": 7, "userWise": 4, "transactionWise": 3 },

$ psql -c "… SELECT jsonb_pretty(public.get_admin_attention_rows('reconciliation', 10)); …"
    { "id": "tst-sub-emp-msc7vzsc",    "kind": "user", "status": "missing_balance",
      "primary": "TST employer member", "secondary": "Member has no balance record",
      "href": "/dashboard/subscribers/tst-sub-emp-msc7vzsc" },
    { "id": "tst-sub-retag-msc7vzsc",   "primary": "TST retag probe",     … },
    …
```

Three of the seven exceptions are the intentional demo seed (`t-demo-recon-1..3`, "Transaction credited
to an agent who does not own this member"). **The other four are test garbage** — and the drill-down
renders `primary` as the headline, so a prospect reads "TST retag probe" on the admin console.

The same rows also poison the platform overview's "Direct" channel, which is **100% test residue**:

```
$ psql -c "SELECT id, name, is_active FROM public.subscribers WHERE agent_id IS NULL AND employer_id IS NULL"
s-e2e-emp-foreign-1785752999757|E2E Foreign Member (RLS probe)|t
tst-sub-emp-msc7vzsc  |TST employer member|t
tst-sub-retag-msc7vzsc|TST retag probe|t
tst-sub-tree-msc7vzsc |TST tree member|t
tst-sub-tree-msd3855c |TST tree member|t

$ psql -c "… SELECT jsonb_pretty(public.get_platform_overview()); …"
    "byChannel": { "direct": { "aum": 0, "active": 5, "inactive": 0, "subscribers": 5, … } },
    "subscribersDirect": 5,
```

**Mechanism.** Nothing in the database blocks removal — a `DELETE … ROLLBACK` probe succeeded, and the
rows have no child rows left (`transactions|0  commissions|0  insurance_policies|0`), because the
teardown loop at `:161-164` deletes the child tables **before** `subscribers` at `:165`. The teardown
simply did not reach line 165. It also never inspects a single delete result:

```ts
    for (const table of ['subscriber_balances', 'transactions', …]) {
      await supabaseAdmin.from(table).delete().in('subscriber_id', subIds);
    }
    await supabaseAdmin.from('subscribers').delete().in('id', subIds);
    await supabaseAdmin.from('agents').delete().eq('id', TST.agent);
    await supabaseAdmin.from('branches').delete().eq('id', TST.branch);
```
so a partial teardown is silent and the residue compounds run over run.

**Impact.** A rep who opens Admin → Needs attention → Reconciliation during a demo shows a prospect four
rows labelled "TST tree member" / "TST retag probe". The "Direct" acquisition channel reads 5 members
with 0 UGX AUM, all of them fake. The baseline's unexplained 4-row `subscribers`/`subscriber_balances`
gap is fully accounted for.

**Suggested fix.** (1) Delete the 5 residue rows (`tst-sub-*`, `tst-branch-*`, and
`s-e2e-emp-foreign-*`) from live. (2) Check the `error` on every delete in the `afterAll` and fail the
suite loudly on a partial teardown. (3) Add a standing janitor assertion — a cheap DB spec that fails
if any `tst-`/`e2e-` id survives — so the next partial run is caught immediately rather than
accumulating.

---

### A01-002 · **MEDIUM** · confirmed · `agents.coverage_rate` is 0 for all 2046 agents; the seeder overwrites the `0018` backfill, so every branch reports "0% coverage rate"

**Location:** `supabase/migrations/0018_entity_metrics_rollup.sql:33,46` vs
`scripts/seed-supabase.mjs:516-535`

`0018` adds the column with `NOT NULL DEFAULT 0`, then backfills it to
`LEAST(100, GREATEST(0, (COALESCE(aa.active_pct,0)*0.4 + 60)::integer))` — an expression whose **minimum
possible value is 60**. Live, every agent is 0:

```
$ psql -c "SELECT count(*) total, count(*) FILTER (WHERE coverage_rate=0) zero,
           min(coverage_rate), max(coverage_rate), round(avg(coverage_rate),1) FROM public.agents"
2046 | 2046 | 0 | 0 | 0.0
```

**Root cause.** `scripts/seed-supabase.mjs` bulk-inserts `agents` with an explicit 16-column list that
**omits `coverage_rate`**:

```js
    await bulkInsert(client, 'agents', [
      { name: 'id' }, { name: 'name' }, { name: 'gender' }, { name: 'employee_id' },
      { name: 'branch_id' }, { name: 'center_lng' }, { name: 'center_lat' }, { name: 'phone' },
      { name: 'email' }, { name: 'rating' }, { name: 'performance' }, { name: 'status' },
      { name: 'languages' }, { name: 'specialties' }, { name: 'tenure_months' }, { name: 'joined_date' },
    ], …
$ grep -n "coverage" scripts/seed-supabase.mjs
(no matches)
```
so every reseed re-stamps the column with its `DEFAULT 0` and permanently erases the one-shot migration
`UPDATE`. The most recent destructive reseed (2026-06-16) is when this went to zero.

**Demo-visible.** The metric flows straight through the live rollup RPC into the distributor Reports hub:

```
$ psql -c "BEGIN; SET LOCAL request.jwt.claims='{\"app_role\":\"distributor\",\"distributorId\":\"d-001\"}';
           SET LOCAL ROLE authenticated;
           SELECT left(public.get_entity_metrics_rollup('branch', ARRAY(SELECT id FROM public.branches
             WHERE distributor_id='d-001' LIMIT 3))::text, 900); ROLLBACK;"
{"b-bui-001": {"aum": 15750384, "activeRate": 85, "totalAgents": 8, "coverageRate": 0,
               "totalSubscribers": 34, "totalWithdrawals": 1453189, …
```
Every other figure on that card is real; `coverageRate` alone is 0. It renders as a `MiniDonut` at
`src/dashboard/reports/ReportsHub.jsx:430` with the caption `{m.coverageRate}% coverage rate` (`:433`),
as a sortable column in `src/dashboard/reports/views/DistributionSummary.jsx:77-82`, and in
`src/dashboard/overlay/OverlayPanel.jsx:752`.

**Impact.** A distributor demo that reaches Reports → Distribution summary shows an empty donut and
"0% coverage rate" for all 291 branches, sitting next to correct AUM and active-rate figures — which
reads as a broken metric rather than a zero.

**Suggested fix.** Have `scripts/seed-supabase.mjs` compute and insert `coverage_rate` alongside
`performance`/`rating` (the same synthetic-metric family it already emits), so the value is a property
of the seed rather than of a migration that ran once. Failing that, drop `coverageRate` from the three
UI surfaces rather than shipping a permanent 0.

---

### A01-003 · **MEDIUM** · confirmed · a branch can be created with a NULL `distributor_id`, making it invisible to every distributor-scoped rollup

**Location:** `public.trg_branches_default_distributor` (from `0081_distributor_scope_rls.sql`);
live row `branches.tst-branch-msc7w8vm`

`0060:48` backfilled every branch to `d-001`, and `0081` added a BEFORE-INSERT trigger to keep new ones
scoped. The trigger defaults to `current_distributor_id()`, which returns NULL for any caller that is
not a distributor — admin, `service_role`, the seeder. So an admin- or service-role-created branch lands
unscoped and there is no `NOT NULL` or CHECK to stop it:

```
$ psql -c "SELECT prosrc FROM pg_proc WHERE proname='trg_branches_default_distributor'"
BEGIN
  IF NEW.distributor_id IS NULL THEN
    NEW.distributor_id := public.current_distributor_id();
  END IF;
  RETURN NEW;
END
$ psql -c "SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.branches'::regclass AND NOT tgisinternal"
branches_default_distributor|CREATE TRIGGER branches_default_distributor BEFORE INSERT ON public.branches
                             FOR EACH ROW EXECUTE FUNCTION trg_branches_default_distributor()

$ psql -c "SELECT coalesce(distributor_id,'<NULL>'), count(*) FROM public.branches GROUP BY 1 ORDER BY 1"
<NULL>|1
d-001 |291
d-002 |27
d-003 |2
$ psql -c "SELECT id, name, district_id, distributor_id FROM public.branches WHERE distributor_id IS NULL"
tst-branch-msc7w8vm|TST throwaway branch|d-buikwe|
```

**Impact.** 291 + 27 + 2 = **320**, but the admin platform overview reports **321** branches
(`"branches": 321` in `get_platform_overview()`). Any side-by-side of "admin total" against "sum of the
three distributors" is off by one, and the unscoped branch is invisible to every distributor's
dashboard, map and export. Today the only such row is the A01-001 residue, so fixing A01-001 hides the
symptom — but the schema gap remains: nothing prevents the next admin-created branch from doing the same.

**Suggested fix.** Either make the trigger fall back to the singleton national distributor when
`current_distributor_id()` is NULL (the `0060` policy, applied to new rows), or add
`CHECK (distributor_id IS NOT NULL)` / `SET NOT NULL` once the residue is cleaned.

---

### A01-004 · **MEDIUM** · confirmed · the `retirement_units + emergency_units = units` invariant is violated on one live member

**Location:** live row `subscriber_balances.s-0005`; invariant declared in
`0103_nav_pricing_schema.sql:57-59` ("`retirement_units + emergency_units` … always sum back to it
exactly") — **cross-reference A08 (money RPCs), which owns the write path.**

```
$ psql -c "SELECT count(*) FILTER (WHERE abs(retirement_units+emergency_units-units)>0.000001) mismatched,
           max(abs(retirement_units+emergency_units-units)) worst FROM public.subscriber_balances"
1 | 6.3637520682194222

$ psql -c "SELECT subscriber_id, retirement_balance, emergency_balance, total_balance, units,
           retirement_units, emergency_units, invested, nav_as_of FROM public.subscriber_balances
           WHERE abs(retirement_units+emergency_units-units)>0.00001"
s-0005 | 283345 | 37199 | 320544 | 203.98642208035116 | 185.404883 | 24.9452911485705822
       | 295177.2613833044958892098646447506445725757503102859244230007420941969886420393313104 | 2026-08-23
```

`185.404883 + 24.945291 = 210.350174` against a stored `units` of `203.986422` — a 6.36-unit gap, about
**10,000 UGX at the live NAV of 1571.4**. Two secondary signals on the same row: `nav_as_of` is *today*
(only 20 of 5060 rows carry today's date — those are the rows written during this audit window, so the
break was produced by a live write path, not by the `0105` backfill), and `invested` carries an
80-significant-digit value where every other row is bounded.

`v_reconciliation_exceptions.split_mismatch` does **not** catch this: it tests
`retirement_balance + emergency_balance` against `total_balance` (283345 + 37199 = 320544 ✓), and there
is no equivalent check on the unit buckets. So the admin console reports the platform as clean while a
unit-level invariant is broken.

**Impact.** `src/services/subscriber.js:259-260` exposes `retirementUnits`/`emergencyUnits` to the
subscriber surface. A revaluation that prices the buckets independently would over-state this member's
balance by ~10,000 UGX. Contained to one member today, but the write path that produced it is live.

**Suggested fix.** A08 to identify which of `trg_transactions_contribution` / `request_withdrawal` /
the save-to-cover sweep skips `_resync_bucket_units()`. Independently, extend
`v_reconciliation_exceptions` with a `unit_split_mismatch` arm so the console can see the class at all.

---

### A01-005 · **LOW** · confirmed · duplicate unique index on `demo_personas(phone, role)`

**Location:** `supabase/migrations/0090_access_request_login_identity.sql:68` vs
`supabase/migrations/0001_initial_schema.sql:442`

```
$ psql -c "SELECT indrelid::regclass, string_agg(indexrelid::regclass::text, ', '), count(*)
           FROM pg_index … GROUP BY indrelid, indkey::text, pred, indisunique HAVING count(*)>1"
demo_personas | demo_personas_phone_role_key, demo_personas_phone_role_unique | 2

$ psql -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='demo_personas'"
demo_personas_phone_role_unique | CREATE UNIQUE INDEX … ON public.demo_personas USING btree (phone, role)
demo_personas_phone_role_key    | CREATE UNIQUE INDEX … ON public.demo_personas USING btree (phone, role)
```

`0001:442` declares `CONSTRAINT demo_personas_phone_role_unique UNIQUE (phone, role)`; `0090:68` then
issues `CREATE UNIQUE INDEX IF NOT EXISTS demo_personas_phone_role_key ON … (phone, role)`. The
`IF NOT EXISTS` guard keys on the *name*, so it could not see the equivalent constraint under a
different name.

Not harmful beyond a redundant index maintenance cost on a 9-row table — `ON CONFLICT (phone, role)`
inference, used twice inside `register_login_identity`, still resolves cleanly:

```
$ psql -c "BEGIN; INSERT INTO public.demo_personas (id,phone,role,entity_id)
           VALUES ('a01-probe','+256700000001','subscriber','s-0001')
           ON CONFLICT (phone, role) DO NOTHING;
           SELECT 'ON CONFLICT (phone,role) inference OK with 2 identical unique indexes'; ROLLBACK;"
ON CONFLICT (phone,role) inference OK with 2 identical unique indexes
$ psql -c "SELECT count(*) FROM public.demo_personas WHERE id='a01-probe'"
0                                                   -- probe rolled back, nothing persisted
```

**Suggested fix.** Drop `demo_personas_phone_role_key`; keep the `0001` constraint (which is what the
`users_phone_role_unique` sibling uses).

---

### A01-006 · **LOW** · confirmed · two indexes are strict leading prefixes of a wider index on the same table

**Location:** `claims.claims_subscriber_id_idx`, `subscribers.idx_subscribers_agent_id`

```
$ psql -c "(prefix-redundancy query over pg_index, non-partial, non-unique)"
claims      | claims_subscriber_id_idx  | claims_subscriber_product_date_idx | {2}  | {2,10,6}
subscribers | idx_subscribers_agent_id  | subscribers_agent_id_id_idx        | {10} | {10,1}
```

A btree on `(a)` is fully served by a btree on `(a, b, …)`, so each of these two is dead weight on every
write to two of the busiest tables in the schema. Both wider indexes came later
(`claims_subscriber_product_date_idx` from `0099:100`), and the narrow one was never retired.

**Suggested fix.** Drop `claims_subscriber_id_idx` and `idx_subscribers_agent_id` in a single
housekeeping migration with a matching `.down.sql`.

---

### A01-007 · **LOW** · confirmed · three foreign keys have no covering index

**Location:** `commission_config.distributor_id`, `entity_detach_log.subscriber_id`,
`money_nonces.subscriber_id`

```
$ psql -c "(FK vs leading-prefix non-partial index coverage query)"
commission_config | commission_config_distributor_id_fkey  | {7} | 0
entity_detach_log | entity_detach_log_subscriber_id_fkey   | {2} | 0
money_nonces      | money_nonces_subscriber_id_fkey        | {2} | 0
(27 other FKs: coverage >= 1)
```

`entity_detach_log` does have `entity_detach_log_sub_idx` from `0080:55`, but it is **partial**
(`WHERE restored_at IS NULL`), so the planner cannot use it for the FK's full-table lookup. All three
FKs are `ON DELETE CASCADE`, so the cost lands on `DELETE FROM subscribers` / `DELETE FROM distributors`
— which is precisely the path the E2E teardown of A01-001 exercises.

Currently cheap (`entity_detach_log|0`, `money_nonces|9`, `commission_config|3` rows), so LOW; it
becomes a real cost if the detach log ever fills. `0009` and `0013` were the FK-covering-index sweeps
and predate all three tables.

**Suggested fix.** Add three plain btree indexes, or accept and note them explicitly in
`docs/BACKEND.md` so the next FK-index sweep does not re-discover them.

---

### A01-008 · **LOW** · confirmed · 22 forward migrations — the entire schema foundation — have no `.down.sql`

**Location:** `supabase/migrations/0001`–`0015`, `0017`–`0021`, `0027`, `0028`

```
$ for f in $(ls *.sql | grep -v '\.down\.sql$'); do [ -f "${f%.sql}.down.sql" ] || echo "NO-DOWN: $f"; done | wc -l
22
$ for f in $(ls *.down.sql); do [ -f "${f%.down.sql}.sql" ] || echo "ORPHAN-DOWN: $f"; done
(none)
```

The gap is contiguous and entirely pre-`0029`: the initial schema, all RLS policies, the
`role` → `app_role` swap (`0007`), the `search_path` pinning sweep (`0010`), the FK-index sweeps
(`0009`/`0013`) and the replay guards (`0028`). From `0029` onward the discipline is perfect — 86 downs
for 86 forwards, zero orphans.

Rated LOW rather than MEDIUM because nobody would roll back `0001`, and `0021`'s family is already
dropped. It is recorded so the traceability table shows the rollback frontier honestly: **the platform
can be reversed to the `0029` state and no further.**

**Suggested fix.** Document the frontier in `docs/BACKEND.md` ("migrations are reversible to `0029`;
below that, restore from a snapshot") rather than back-writing 22 speculative downs.

---

### A01-009 · **INFO** · the live database mutated underneath this audit, and `0105`'s rollback snapshots are still resident

Row counts moved twice during the run — other agents in this 27-agent audit are exercising the live demo:

```
10:38  subscribers 5064 | subscriber_balances 5060 | transactions 29027 | commissions 5001
10:44  subscribers 5081 | subscriber_balances 5077 | transactions 29158 | commissions 5018
10:52  subscribers 5064 | subscriber_balances 5060
```

The `subscribers − subscriber_balances` gap held at exactly **4** at every sampling, which is what makes
A01-001 a stable finding rather than a race. Downstream agents should re-measure rather than cite an
absolute count from any single report.

Separately, `subscriber_balances_pre_nav` (5060 rows) and `subscribers_unit_value_pre_nav` are still
present 15 days after `0105`. That is **correct** — `0105_nav_backfill.down.sql` raises
`'subscriber_balances_pre_nav is missing — cannot restore balances'` without them, so they are the
NAV migration's only rollback path. Noted so nobody "tidies them away". Both are `ENABLE` + `FORCE` RLS
with zero policies, and both read as 0 rows for `anon` and `authenticated` (§4).

---

### A01-010 · **INFO** · every base table grants `TRUNCATE`/`DELETE`/`INSERT`/`UPDATE` to `anon` and `authenticated` — ambient, not a divergence (hand-off to A03)

```
$ psql -c "SELECT table_name, grantee, string_agg(privilege_type,',') FROM information_schema.role_table_grants
           WHERE table_schema='public' AND grantee IN ('anon','authenticated')
             AND privilege_type IN ('TRUNCATE','DELETE','UPDATE','INSERT','REFERENCES','TRIGGER') GROUP BY 1,2"
access_requests | anon          | DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE,UPDATE
…  (all 35 base tables, both roles) …
subscribers     | authenticated | DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE   ← no UPDATE: 0075 revoked it
users           | authenticated | DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE
```

This is Supabase's default `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`, and the
migrations narrow it only in specific places (`subscribers`/`users` lost `UPDATE`). It is **not** a
divergence between the files and live, so it is not scored here. Two things make it low-risk in
practice: RLS gates every DML verb, and PostgREST cannot emit `TRUNCATE` at all — the one verb RLS does
*not* gate is unreachable from the app. **A03 owns the privilege-surface judgement.** The two tables
with no grant at all to either role are `entity_detach_log` and `entity_status_log`, which is what makes
check 7 pass.

*(An empirical `TRUNCATE … ROLLBACK` probe was refused by the auto-mode classifier — correctly. It would
not have changed this finding: the grant survey above already answers the question read-only.)*

---

## Traceability

| # | Check | Disposition |
|---|---|---|
| 1 | Every table, column, type, default, NOT NULL, CHECK, FK, UNIQUE in the forward migrations exists live with the same definition — both directions | **PASS** — 38 relations, 382 columns, 94 constraints, 85 indexes reconciled in both directions; 0 unexplained differences. In-files-not-live = 4 tables + 3 indexes + 1 CHECK, all on tables explicitly dropped by `0029`/`0045`. Live-not-in-files = 15 columns on the two `CREATE TABLE AS` snapshots from `0105`, plus 0 tables, 0 indexes, 0 FKs, 0 CHECKs. Verified no DDL hides inside `DO` blocks. |
| 2 | Diff the latest migration body against live `pg_proc.prosrc` for every multi-defined function | **PASS** — 89/89 bodies diffed. 63 byte-identical, 25 token-identical (whitespace/comments only), 1 semantic difference (`apply_settlement`) fully explained by the dynamic `pg_get_functiondef` patch in `0051`. **0 unexplained divergences — the `0095`-clobbers-`0090` failure class does not recur.** Attributes (signature, RETURNS, language, volatility, SECURITY, `search_path`) reconciled separately; all differences trace to a later bare `ALTER FUNCTION`. |
| 3 | Enumerate `pg_proc` grouped by `proname` with >1 OID | **PASS** — 89 OIDs / 89 names, zero overloads. `create_distributor` (oid 29390, 6-arg) and `update_employer_profile` (oid 24885, 3-arg) each have exactly one OID. No finding manufactured. |
| 4 | Every DEFINER function has a pinned `search_path` in `proconfig` | **PASS** — 70 DEFINER, 70 with a pinned `search_path`, 0 violations. |
| 5 | Down-migration coverage: confirm the 22 pre-`0029` gaps; parse (never execute) the newest 10 downs and flag any that would not cleanly reverse | **FINDING A01-008** — 22 gaps confirmed (`0001`–`0015`, `0017`–`0021`, `0027`, `0028`), 0 orphan downs. The newest 10 downs are mechanically clean on all four hazards tested: 11/11 `DROP FUNCTION` signatures resolve live, 0 columns dropped that the forward never added, 0 tables dropped that the forward never created, 0 stale-body restores. `0101.down` and `0103.down` already carry explicit ⚠️ headers about their real risks. |
| 6 | The 8 policies stranded on dropped tables — confirm absent live and harmless | **PASS** — all 8 named (2 × `contribution_run_lines`, 1 × `employees`, 2 × `settlement_run_branch_reviews`, 3 × `settlement_runs`), all absent live because their tables are absent. 109 live policies, 0 live-not-in-files, 0 using `auth.uid()`, 0 using `->> 'role'`. |
| 7 | `entity_detach_log` / `entity_status_log`: determine EMPIRICALLY whether any path can read or write them as `authenticated` | **PASS** — proved by execution, not by config: `SET LOCAL ROLE authenticated; SELECT … ` → `ERROR: permission denied for table entity_detach_log` (and `entity_status_log`), same for `anon`. They are the only 2 of 35 base tables with no grant to either role. Missing `FORCE` is inert — the only beneficiary would be the owner `postgres`, which already carries `rolbypassrls`. |
| 8 | `nav_snapshots` created twice (`0096`, `0103`) — confirm identical shapes and a true no-op | **PASS** — the two `CREATE TABLE IF NOT EXISTS` blocks are identical apart from one trailing comment; the surrounding indexes, RLS `ENABLE`/`FORCE`, policy and grant are identical too, all `IF NOT EXISTS`/`DROP … IF EXISTS`-guarded. `0103.down` correctly refuses to drop the table. |
| 9 | Index health: unused, missing FK covering indexes, duplicates — structural analysis | **FINDING A01-005** (exact-duplicate unique index on `demo_personas`), **A01-006** (2 redundant prefix indexes), **A01-007** (3 FKs with no covering index). Explicitly declined to call any index "unused": `idx_scan` has been accumulating since the restore (max 107,674; 31/85 at zero), so a zero reading is not evidence. |
| 10 | The Postgres 11+ `ADD COLUMN … DEFAULT` stamping trap: find every pair and verify the data actually landed | **FINDING A01-002** — 22 candidates found (19 `ADD COLUMN … DEFAULT` + 3 `IS NULL`-keyed backfills), **0 confirmed no-ops**: `0096` documents the trap by name and keys on the stamped value; `0099` and `0060` add the column without a default. Live verification (`withdrawals` 4937/4937, `claims` 1907/1907, `claims.product` 1907 × `health`) confirms each landed. Extending the mandate to the other 16 top-level backfills found one that did **not** survive — `agents.coverage_rate`, 0 across all 2046 rows (A01-002) — and surfaced A01-001, A01-003 and A01-004 in the same live-data sweep. |

---

## Data hygiene statement

**No fixture rows were created and none were left behind.** Three write probes were run, each inside an
explicit transaction that was `ROLLBACK`-ed, and each verified afterwards:

| Probe | Purpose | Verification after rollback |
|---|---|---|
| `DELETE FROM public.subscribers WHERE id='tst-sub-retag-msc7vzsc'` | prove nothing in the DB blocks removal of the A01-001 residue | `SELECT count(*) … WHERE id LIKE 'tst-%'` → **4** (unchanged) |
| `INSERT INTO public.demo_personas … ON CONFLICT (phone, role) DO NOTHING` | prove the duplicate unique index does not break arbiter inference (A01-005) | `SELECT count(*) … WHERE id='a01-probe'` → **0** |
| `SET LOCAL ROLE anon/authenticated; SELECT count(*) FROM …` × 8 | check 7 | read-only |

All RPC calls (`get_admin_attention`, `get_admin_attention_rows`, `get_platform_overview`,
`get_entity_metrics_rollup`) were made inside `BEGIN … ROLLBACK` with `SET LOCAL request.jwt.claims`;
all four are `STABLE` and write nothing.

**G1 compliance:** the only file written by this agent is
`docs/audits/2026-08-23/01-schema-migrations.md`. Nothing under `src/`, `api/`, `server/`,
`supabase/`, `scripts/`, `public/` or any config was read-modified, staged or reverted. **G6:** no
down-migration was executed — all 86 were parsed as text only.
