# A02 · RLS Isolation Matrix — 6 roles × 37 tables × 4 ops, plus anon

**Agent:** A02 · **Date:** 2026-08-23 · **Mode:** REPORT-ONLY
**DB:** `ilkhfnoyxlxwqadebnkp` (live) · **Baseline:** `docs/audits/2026-08-23/00-baseline.md` (cited, and confirmed on every overlapping metric)
**Full matrix:** `docs/audits/2026-08-23/baseline/rls-matrix.csv` (1,036 rows + header)

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 109 live policies · 37 tables · 7 principals (6 app roles + `anon`) · 37 table ACLs · 447 column ACLs |
| Artifacts examined | 109 policies · 37 tables · 7 principals · 37 table ACLs · 447 column ACLs |
| Coverage | 100% |
| Checks defined | 7 |
| Checks executed | 7 |
| Checks passed / failed / blocked | 4 / 3 / 0 |
| Findings C / H / M / L / I | 0 / 2 / 3 / 3 / 2 |
| Evidence commands run | 31 |
| Excluded as demo-scope | 2 (`demo_personas` readable by every authenticated role — explicit demo fallback per the brief; `transactions_insert_self` **not** excluded, see A02-001) |
| Blocked, with reason | none |

### Domain metrics (required by spec)
| Metric | Value |
|---|---|
| Cells defined | **925** (6 roles × 37 tables × 4 ops = 888, + 37 anon SELECT) |
| Cells tested | **1,036** (925 required + 111 extra: anon INSERT/UPDATE/DELETE on all 37 tables) |
| Cells pass / fail / gap / n-a | **1,011 / 13 / 7 / 5** (0 blocked) |
| Cross-tenant probes run | **32** (+ 6 positive controls, + 6 HTTP cross-tenant probes) |
| **Cross-tenant leaks found** | **0** |
| Direct-write successes (target 0) | **13** cells across 5 roles (see A02-001…A02-005) |
| FORCE-less tables (expect 2) | **2** — `entity_detach_log`, `entity_status_log` (no third has appeared) |
| Policies using `auth.uid()` | **0** (verified live) |
| Policies using `->> 'role'` | **0** (verified live) |
| Fixture rows created | **0** — every write probe ran inside a transaction that was `ROLLBACK`-ed, or was forced into a post-RLS unique/NOT-NULL violation so nothing was ever committed. **Nothing to clean up; nothing was left behind.** |

---

## 0. Method, and why the results are trustworthy

Two independent harnesses were used, and they agree on every overlapping cell.

**(a) In-database role simulation over `psql`.** Claim shape taken verbatim from
`e2e/fixtures/auth.ts:100-118` (`mintRoleJwt`): `{sub, role:'authenticated', app_role, phone, <role>Id}`.
`auth.jwt()` on this project is
`coalesce(nullif(current_setting('request.jwt.claim',true),''), nullif(current_setting('request.jwt.claims',true),''))::jsonb`,
so `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', …, true)` reproduces exactly what
PostgREST does. `authenticated` and `anon` both have `rolbypassrls = f`, so RLS genuinely applies.

```
$ psql "$SUPABASE_DB_URL" -X -q -At -c "select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('postgres','authenticated','anon','service_role');"
authenticated|f|f
anon|f|f
service_role|f|t
postgres|f|t
```

Every probe ran inside its own PL/pgSQL sub-block that **always** ends in `RAISE EXCEPTION` (the row
count is smuggled out in the message), so the sub-transaction is *always* aborted — no write can persist
even in principle. The whole run is wrapped in `BEGIN … ROLLBACK`.

**Harness validation (mandatory positive controls).** A matrix that reports "denied" everywhere because
the harness is broken is worthless. These six controls all returned non-zero, so the claim plumbing works:

```
P01 s-0001 sees own subscriber row      || OK || 1
P02 a-001 sees own subscribers          || OK || 26
P03 b-kam-015 sees own agents           || OK || 5
P04 d-001 sees own branches             || OK || 291
P05 emp-001 sees own staff              || OK || 21
P06 admin sees all subscribers          || OK || 5079
```

**(b) Real PostgREST over HTTPS.** HS256 JWTs minted from `SUPABASE_JWT_SECRET` exactly as
`e2e/global-setup.ts` does (tokens redacted per G2: `eyJ...<328>`), sent to
`${VITE_SUPABASE_URL}/rest/v1/<table>` with the shipped `apikey` anon header. This proves the paths are
reachable from the browser bundle, not just from a superuser session. **All HTTP write probes were
constructed to be zero-mutation** — either a duplicate PK (unique violation fires *after* the RLS
`WITH CHECK`, so a `409` proves RLS *allowed* the row while nothing is written) or a `NULL` into a
`NOT NULL` column (`ExecConstraints` runs after the ACL check and after the RLS `USING` filter, so a
`400 23502` proves *"grant OK + row visible + update permitted"* while nothing is written).

**Environment caveat (Info, A02-009).** Live data drifted materially *during* this audit — other
audit agents are writing through the app. `subscribers` 5064 → **5081**, `transactions` 29027 → **29158**,
`users` 48 → **51**, `a-001`'s roster 11 → **28**. All row counts below are point-in-time.

---

## 1. Check 1 — the full matrix

`docs/audits/2026-08-23/baseline/rls-matrix.csv` — 1,036 cells, columns
`role,table,op,expected,actual_outcome,actual_rows,actual_error,verdict,note`.

`expected` is derived from `docs/role-permissions.md` for SELECT, and from
`docs/BACKEND.md:46` / `:601` + `docs/role-permissions.md:250` for writes — all three state that
**every client write goes through a `SECURITY DEFINER` RPC and there are no client write policies**.
That is the documented contract, so every one of the 666 write cells has `expected = DENY`.

### 1.1 SELECT visibility pivot (rows returned; `ERR` = hard error)

| table | anon | subscriber | agent | branch | distributor | employer | admin |
|---|---|---|---|---|---|---|---|
| access_requests | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| agent_referrals | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| agents | ERR | 1 | 1 | 5 | 1872 | 0 | 2046 |
| branches | ERR | 1 | 1 | 1 | 291 | 0 | 321 |
| claims | ERR | 1 | 1 | 15 | 1750 | 0 | 1907 |
| commission_config | 0 | 1 | 1 | 1 | 2 | 1 | 3 |
| commissions | ERR | 0 | 14 | 31 | 4605 | 0 | 5004 |
| contact_submissions | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| contribution_run_uploads | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| contribution_runs | 0 | 0 | 0 | 0 | 0 | 6 | 9 |
| contribution_schedules | ERR | 1 | 14 | 31 | 4605 | 21 | 5025 |
| custody_transfers | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| demo_personas | 0 | 9 | 9 | 9 | 9 | 9 | 9 |
| distributors | ERR | **0** | **0** | **0** | 1 | 0 | 3 |
| districts | 136 | 136 | 136 | 136 | 136 | 136 | 136 |
| employer_invites | 0 | 0 | 0 | 0 | 0 | 4 | 4 |
| employers | 0 | 0 | 0 | 0 | 0 | 1 | 8 |
| entity_detach_log | ERR | ERR | ERR | ERR | ERR | ERR | ERR |
| entity_status_log | ERR | ERR | ERR | ERR | ERR | ERR | ERR |
| insurance_policies | ERR | 1 | 7 | 13 | 2478 | 21 | 2731 |
| money_nonces | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nav_snapshots | 0 | 0 | 0 | 0 | 0 | 0 | 1246 |
| nominee_claims | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| nominees | ERR | 3 | 47 | 167 | 22543 | 0 | 24388 |
| notifications | ERR | 0 | 4 | 1 | 0 | 0 | 10 |
| regions | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| settlement_batches | ERR | 0 | 4 | 1 | 5 | 0 | 5 |
| settlement_uploads | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| subscriber_balances | ERR | 1 | 14 | 31 | 4605 | 21 | 5063 |
| subscriber_balances_pre_nav | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| subscriber_insurance_products | ERR | 2 | 11 | **0** | **0** | **0** | **0** |
| subscriber_signup_uploads | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| subscribers | ERR | 1 | 14 | 31 | 4605 | 21 | 5067 |
| subscribers_unit_value_pre_nav | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| transactions | ERR | 10 | 77 | 165 | 24961 | 1945 | 29144 |
| users | ERR | 0 | 0 | 0 | 0 | 0 | 49 |
| withdrawals | ERR | 1 | 19 | 34 | 4506 | 0 | 4937 |

Read-side verdict: **every role sees exactly its own scope and nothing more.** The two zero-columns in
bold are coverage *gaps* (A02-006, A02-007), not leaks. `anon` sees only `districts` (136) and
`regions` (4); every other table is 0 rows or a hard denial.

**Check 1 → PASS (matrix produced; 1,011/1,036 cells match the documented contract).**

---

## 2. Check 2 — cross-tenant probes · **0 leaks**

All 32 probes used **real live IDs**, never invented ones (`d-002`/`b-bug-074`/`a-478`/`s-1797`/`c-01797`,
`emp-002`/`emp-002-e01`/`run-demo-002`, `a-042`/`s-0133`, `b-mba-290`/`a-1879`, `s-0002`).

```
X01 d-001 reads d-002 branches                  || OK || 0
X02 d-001 reads d-002 agents                    || OK || 0
X02b d-001 reads d-002 agent a-478              || OK || 0
X03 d-001 reads d-002 subscriber s-1797         || OK || 0
X04 d-001 reads d-002 commission c-01797        || OK || 0
X04b d-001 reads d-002 balances                 || OK || 0
X04c d-001 reads d-002 transactions             || OK || 0
X04d d-001 reads d-002 distributor row          || OK || 0
X05 emp-001 reads emp-002 staff                 || OK || 0
X06 emp-001 reads emp-002 runs                  || OK || 0
X07 emp-001 reads emp-002 invites               || OK || 0
X07b emp-001 reads emp-002 employer row         || OK || 0
X07c emp-001 reads emp-002 balances             || OK || 0
X07d emp-001 reads emp-002 transactions         || OK || 0
X08 a-001 reads a-042 subscribers               || OK || 0
X09 a-001 reads a-042 balances                  || OK || 0
X10 a-001 reads a-042 transactions              || OK || 0
X10b a-001 reads a-042 commissions              || OK || 0
X10c a-001 reads a-042 agent row                || OK || 0
X11 b-kam-015 reads b-mba-290 agents            || OK || 0
X11b b-kam-015 reads b-mba-290 branch row       || OK || 0
X11c b-kam-015 reads other-branch commissions   || OK || 0
X12 s-0001 reads s-0002 balances                || OK || 0
X13 s-0001 reads other nominees                 || OK || 0
X14 s-0001 reads other transactions             || OK || 0
X15 s-0001 reads other claims                   || OK || 0
X16 s-0001 reads other withdrawals              || OK || 0
X17 s-0001 reads other schedules                || OK || 0
X18 s-0001 reads other insurance_policies       || OK || 0
X19 s-0001 reads other subscribers              || OK || 0
X20 s-0001 reads agents (own agent only)        || OK || 1
X21 s-0001 reads commissions                    || OK || 0
```

Confirmed independently over real HTTPS/PostgREST:

```
S1 sub GET subscribers        :: HTTP 200 :: [{"id":"s-0001"}]
S2 sub GET other balances     :: HTTP 200 :: []
S3 dis GET d-002 branches     :: HTTP 200 :: []
```

Cross-tenant **writes** are denied too:

```
W02 sub POST transactions FOR s-0002        :: HTTP 403 :: new row violates row-level security policy for table "transactions"
W06 agent POST subscribers under a-042      :: HTTP 403 :: new row violates row-level security policy for table "subscribers"
N2  sub PATCH s-0002 insurance_policies     :: HTTP 200 :: []
N4  sub PATCH s-0002 contribution_schedules :: HTTP 200 :: []
N7  agent PATCH s-0001 insurance_policies   :: HTTP 200 :: []   (agent has no UPDATE policy)
R05 sub INSERT withdrawals for s-0002       :: ERROR   :: new row violates RLS for table "withdrawals"
R07 sub INSERT nominee for s-0002           :: ERROR   :: new row violates RLS for table "nominees"
R08 sub DELETE s-0002 nominees              :: OK || 0 rows
W10 agent INSERT subscriber under a-042     :: ERROR   :: new row violates RLS for table "subscribers"
W13 branch INSERT agent in b-mba-290        :: ERROR   :: new row violates RLS for table "agents"
W14 branch UPDATE agent a-1879              :: OK || 0 rows
W17 distributor INSERT branch under d-002   :: ERROR   :: new row violates RLS for table "branches"
W18 distributor UPDATE branch b-bug-074     :: OK || 0 rows
W20 distributor UPDATE distributors d-002   :: OK || 0 rows
```

Also verified fail-closed: `current_distributor_id()` is `NULLIF(auth.jwt() ->> 'distributorId','')`, and
`agents_scope_distributor` / `branches_scope_distributor` are **RESTRICTIVE** — a distributor JWT with no
`distributorId` claim matches nothing (`x = NULL` → NULL → not true).

**Check 2 → PASS. Zero leaks across all six tenancy boundaries.**

---

## 3. Check 3 — `auth.uid()` and `->> 'role'` · **0 / 0, verified live**

```
$ psql -At -c "select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%auth.uid%';"
0
$ psql -At -c "select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ~ '->>\s*''role''';"
0
$ psql -At -c "select count(*) from pg_policies p join pg_class c on c.relname=p.tablename and c.relnamespace='public'::regnamespace and c.relkind='r' where p.schemaname='public';"
109
```

Every policy keys on `(SELECT auth.jwt()) ->> 'app_role'` plus a role-scoped `*Id` claim, matching the
JWT shape minted by `api/_lib/jwt.ts` / `e2e/fixtures/auth.ts`. **Check 3 → PASS** (baseline confirmed).

---

## 4. Check 4 — ENABLE / FORCE · **exactly the two known**

```
$ psql -At -F'|' -c "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by 1;"   # 37 rows
… (all 37 → t|t) except:
entity_detach_log|t|f
entity_status_log|t|f
```

37/37 ENABLE. 35/37 FORCE. The two FORCE-less tables also carry **no grant at all** to `anon` or
`authenticated` (`service_role` only), so the missing FORCE is not reachable — confirmed empirically at
every layer:

```
L05 anon entity_detach_log  || ERROR || permission denied for table entity_detach_log
L15 admin entity_status_log || ERROR || permission denied for table entity_status_log
A5 anon GET entity_status_log :: HTTP 401 :: permission denied for table entity_status_log
```

**No third FORCE-less table has appeared. Check 4 → PASS.**

---

## 5. Check 5 — write-path probes · **13 direct-write successes (target 0)**

The documented contract (`docs/BACKEND.md:46`, `:601`; `docs/role-permissions.md:250`) is that clients
never write tables directly. **That is not what the live database enforces.** 13 of 666 write cells
succeed. All 13 are same-tenant; none crosses a tenancy boundary. Ranked by blast radius:

| role | table | op | rows | finding |
|---|---|---|---|---|
| subscriber | `transactions` | INSERT | 1 | **A02-001** — mints money |
| subscriber | `insurance_policies` | UPDATE | 1 | **A02-002** |
| subscriber | `subscriber_insurance_products` | UPDATE | 2 | **A02-002** |
| subscriber | `contribution_schedules` | UPDATE | 1 | **A02-003** |
| subscriber | `subscribers` | UPDATE | 1 | A02-003 (column-limited — see §7) |
| subscriber | `nominees` | INSERT/UPDATE/DELETE | RLS-passed / 3 / 3 | A02-004 |
| subscriber | `withdrawals` | INSERT | 1 | **A02-004** |
| agent | `subscribers` | INSERT | RLS-passed | **A02-005** |
| branch | `agents` | INSERT/UPDATE | 1 / 5 | **A02-005** |
| distributor | `branches` | INSERT/UPDATE | 1 / 291 | **A02-005** |
| distributor | `distributors` | UPDATE | 1 | A02-005 (guarded by `trg_distributors_enforce_editable_cols`) |

Everything else is denied — the 29 tables with no INSERT policy return
`new row violates row-level security policy`, and tables with no UPDATE/DELETE policy silently affect
0 rows. Notably denied: `commissions` (agent cannot self-award: `R28 → RLS violation`; cannot self-settle:
`R29 → 0 rows`), `commission_config` (`R21`/`R22` → 0 rows — `0089`'s dropped grant confirmed),
`subscriber_balances` (`W24`/`W36` → 0 rows), `nav_snapshots` (`R25`/`R25b` → RLS violation),
`contribution_runs` (`R27` → RLS violation, `R27b` → 0 rows), `employers` (`W26` → 0 rows),
`access_requests` / `contact_submissions` from `anon` (`W29`/`W30` → RLS violation — the public forms
must be going through the server's service-role path, not PostgREST).

**Check 5 → FAIL (13 successes; see A02-001…A02-005).**

---

## 6. Check 6 — the 8 RPC-internal ledgers · **all unreachable**

| table | policies | grant to anon/authenticated | anon | subscriber | distributor | employer | admin |
|---|---|---|---|---|---|---|---|
| `settlement_uploads` | 0 | full | 0 | 0 | 0 | 0 | 0 |
| `contribution_run_uploads` | 0 | full | 0 | 0 | 0 | 0 | 0 |
| `subscriber_signup_uploads` | 0 | full | 0 | 0 | 0 | 0 | 0 |
| `money_nonces` | 0 | full | 0 | 0 | 0 | 0 | 0 |
| `entity_detach_log` | 0 | **none** | ERR | ERR | ERR | ERR | ERR |
| `entity_status_log` | 0 | **none** | ERR | ERR | ERR | ERR | ERR |
| `subscriber_balances_pre_nav` | 0 | full | 0 | 0 | 0 | 0 | 0 |
| `subscribers_unit_value_pre_nav` | 0 | full | 0 | 0 | 0 | 0 | 0 |

RLS is ENABLEd on all 8 with **zero policies**, so PostgreSQL default-denies: reads return `[]`, writes
return `new row violates row-level security policy`. Confirmed over HTTP too:
`A4 anon GET money_nonces :: HTTP 200 :: []`.

All 32 (8 tables × 4 ops) cells across all 7 principals are DENY/PASS in the CSV.
**Check 6 → PASS.**

---

## 7. Check 7 — column-level grants

`subscribers` and `users` are the only two tables whose table-level grant set is trimmed:

```
$ psql -At -F'|' -c "select c.relname,g.grantee,string_agg(distinct g.privilege_type,',' order by g.privilege_type) from information_schema.table_privileges g join pg_class c on c.relname=g.table_name and c.relnamespace='public'::regnamespace and c.relkind='r' where g.table_schema='public' and g.grantee in ('anon','authenticated') group by 1,2 having string_agg(distinct g.privilege_type,',' order by g.privilege_type) <> 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';"
subscribers|anon|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE
subscribers|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE
users|anon|DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE
users|authenticated|DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE
```

`subscribers` UPDATE is column-granted to exactly 5 columns:

```
$ psql -At -c "select column_name from information_schema.column_privileges where table_schema='public' and table_name='subscribers' and grantee='authenticated' and privilege_type='UPDATE' order by 1;"
consent_at
email
name
occupation
phone
```

### 7.1 `subscribers` — **PASS** (6/6 rejected)
```
C01 sub sets subscribers.agent_id       || ERROR || permission denied for table subscribers
C02 sub sets subscribers.employer_id    || ERROR || permission denied for table subscribers
C03 sub sets subscribers.compensation   || ERROR || permission denied for table subscribers
C04 sub sets subscribers.kyc_status     || ERROR || permission denied for table subscribers
C05 sub sets subscribers.is_active      || ERROR || permission denied for table subscribers
C06 sub sets subscribers.nin            || ERROR || permission denied for table subscribers
C07 sub sets subscribers.name           || OK || 1     (by design — profile edit)
C16 sub sets subscribers.phone          || OK || 1     (by design — profile edit)
```
Over HTTP: `W5 sub PATCH subscribers.kyc_status :: HTTP 403 :: permission denied for table subscribers`.
An employer is blocked the same way: `W28 employer UPDATE own staff compensation || ERROR || permission denied for table subscribers`.

### 7.2 `contribution_schedules.insurance_funding_mode` — **FAIL**
The spec requires this to be rejected. It is **granted and it succeeds**:

```
$ psql -At -c "select column_name from information_schema.column_privileges where table_schema='public' and table_name='contribution_schedules' and grantee='authenticated' and privilege_type='UPDATE' order by 1;"
amount
contribution_indexation_pct
emergency_pct
frequency
include_insurance
insurance_choice_made
insurance_funding_mode      <-- must be rejected per spec ✗
insurance_premium_accrued   <-- money-adjacent accrual counter ✗
insurance_premium_target
insurance_savings_pct
last_indexed_at
next_due_date
retirement_pct
subscriber_id
updated_at

C08 sub sets schedules.insurance_funding_mode    || OK || 1
C09 sub sets schedules.insurance_premium_accrued || OK || 1
C10 sub sets schedules.insurance_premium_target  || OK || 1
C11 sub sets schedules.subscriber_id (repoint)   || ERROR || new row violates RLS for "contribution_schedules"  (WITH CHECK holds)
```

**Check 7 → FAIL** on `contribution_schedules` (A02-003); PASS on `subscribers`.

---

## FINDINGS

### A02-001 · HIGH · confirmed · A subscriber JWT can mint arbitrary money by POSTing straight to `/rest/v1/transactions`

**Location:** policy `transactions_insert_self` on `public.transactions` (+ trigger
`transactions_after_insert_contribution` → `public.trg_transactions_contribution`)

The policy is
`WITH CHECK ((auth.jwt() ->> 'app_role') = 'subscriber' AND subscriber_id = (auth.jwt() ->> 'subscriberId'))`.
It constrains **who** the row belongs to but not **what kind of row it is**. The table has an AFTER-INSERT
trigger `WHEN (new.type = 'contribution')` that credits `subscriber_balances` (and can generate a
`commissions` row). So any logged-in demo subscriber can set their own balance to any number.

The policy exists to support one narrow app path — `src/services/subscriber.js:1411` inserts a
`type='premium'` marker row on insurance renewal (`'premium'` fires neither trigger). The grant is far
wider than that need.

**Evidence — balance actually moves (psql, fully rolled back):**
```
BEGIN;
SELECT 'BEFORE (as postgres)', total_balance, retirement_balance, emergency_balance, units FROM subscriber_balances WHERE subscriber_id='s-0001';
  BEFORE (as postgres) || 1386092 || 1108874 || 277218 || 882.0745314258030892
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"s-0001","role":"authenticated","app_role":"subscriber","phone":"+256711000001","subscriberId":"s-0001"}', true);
INSERT INTO transactions (id,subscriber_id,type,amount,date,status,method,txn_ref,source,split_retirement,split_emergency)
VALUES ('a02-probe-tx1','s-0001','contribution',1000000000,now(),'settled','mobile_money','A02PROBE','own',800000000,200000000);
SELECT 'AFTER (as subscriber, own row)', total_balance, retirement_balance, emergency_balance, units FROM subscriber_balances WHERE subscriber_id='s-0001';
  AFTER (as subscriber, own row) || 1001386092 || 801108874 || 200277218 || 637257.2813533680200892
ROLLBACK;
SELECT 'POST-ROLLBACK balance', total_balance FROM subscriber_balances WHERE subscriber_id='s-0001';
  POST-ROLLBACK balance || 1386092
SELECT 'POST-ROLLBACK probe txn rows', count(*) FROM transactions WHERE id like 'a02-probe%';
  POST-ROLLBACK probe txn rows || 0
```
UGX 1,386,092 → UGX 1,001,386,092; units 882 → 637,257. Fully reverted.

**Evidence — reachable over real HTTPS from the shipped browser bundle (zero-mutation proof).**
`src/services/supabaseClient.js:172-173` ships `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to the
browser and its `fetch` wrapper attaches the `upensions_token` JWT from `localStorage` on every request.
Re-using an existing PK forces the unique violation to fire *after* the RLS `WITH CHECK`, so a `409`
proves RLS **allowed** the row while nothing was written:
```
W1 sub POST /rest/v1/transactions {type:'contribution', amount:1000000000, subscriber_id:'s-0001', id:<existing pk>}
   :: HTTP 409 :: {"code":"23505","message":"duplicate key value violates unique constraint \"transactions_pkey\""}
W2 sub POST same but subscriber_id:'s-0002'
   :: HTTP 403 :: {"code":"42501","message":"new row violates row-level security policy for table \"transactions\""}
```
(Change the `id` and it commits. The 403 on W2 shows the *tenant* half of the policy works fine.)

**Impact:** fabricated money propagates upward — a doctored balance is summed into the agent portfolio,
the branch and distributor rollups and the admin AUM KPI, so *other roles' dashboards display wrong
money*. It also bypasses `money_nonces` idempotency and can fabricate an agent commission. `withdrawal`
rows work the same way in reverse (`W03 sub INSERT own withdrawal txn -500,000 || OK || 1`). Scored HIGH
under this audit's rubric ("a write can corrupt … data"); it is the single highest-priority item here and
would be CRITICAL on a production deployment.

**Suggested fix:** narrow the policy to the one shape the app needs —
`WITH CHECK (… AND type = 'premium' AND amount >= 0 AND source = 'own')` — or drop
`transactions_insert_self` entirely and route the renewal marker through the existing
`pay_insurance_premium` DEFINER RPC.

---

### A02-002 · HIGH · confirmed · A subscriber can rewrite their own insurance cover, premium and status to anything

**Location:** policies `insurance_policies_update_self`, `sip_update_self` (and `sip_insert_self`,
`insurance_policies_insert_self`) — `public.insurance_policies`, `public.subscriber_insurance_products`

Neither table has an editable-column trigger (unlike `subscribers` / `distributors`, which do), and
`authenticated` holds a full table-level UPDATE grant on both. The `USING`/`WITH CHECK` only pin
`subscriber_id`, so every business column is writable by the policy-holder.

**Evidence (psql, rolled back):**
```
C12 sub sets insurance_policies.cover = 500,000,000     || OK || 1
C13 sub sets insurance_policies.premium_monthly = 0     || OK || 1
C14 sub sets insurance_policies.status='active', funded_by='self' || OK || 1
C15 sub sets subscriber_insurance_products.status='active'        || OK || 2
R31 sub INSERT sip row for self || ERROR || duplicate key value violates unique constraint "subscriber_insurance_products_pkey"   (⇒ RLS WITH CHECK PASSED)
```

**Evidence over HTTPS (zero-write — `NULL` into a `NOT NULL` column aborts *after* the ACL check and
after the RLS `USING` filter, so `400 23502` = "grant OK, row visible, update permitted"):**
```
N1 sub PATCH /rest/v1/insurance_policies?subscriber_id=eq.s-0001  {cover:null}
   :: HTTP 400 :: {"code":"23502","message":"null value in column \"cover\" of relation \"insurance_policies\" violates not-null constraint"}
N6 sub PATCH /rest/v1/subscriber_insurance_products?subscriber_id=eq.s-0001 {status:null}
   :: HTTP 400 :: {"code":"23502","message":"null value in column \"status\" of relation \"subscriber_insurance_products\" violates not-null constraint"}
N2 sub PATCH …subscriber_id=eq.s-0002 {cover:null} :: HTTP 200 :: []    (cross-tenant correctly denied)
N7 agent PATCH …subscriber_id=eq.s-0001 {cover:null} :: HTTP 200 :: []  (agent has no UPDATE policy — correct)
N8 anon  PATCH …                        :: HTTP 401                     (correct)
```

**Impact:** a subscriber can grant themselves unlimited life/health/funeral cover at zero premium and
flip `status` to `active` with nothing paid — directly falsifying the insurance-premium invariant
(`docs/…/project_insurance_premium_invariant`, "self-pay insurance = ANNUAL only") and the `0072`
save-to-cover state machine. The Insurance Statement report and the employer Insurance page then show
cover that was never funded. This is wrong money in the insurance ledger.

**Suggested fix:** revoke UPDATE on the business columns (keep at most nothing) and route the two real
app paths — renewal (`src/services/subscriber.js:1399-1404`) and upgrade/downgrade — through the existing
`fund_insurance_products` / `pay_insurance_premium` DEFINER RPCs; or add a
`trg_*_enforce_editable_cols` BEFORE-UPDATE trigger mirroring the one already on `subscribers`.

---

### A02-003 · MEDIUM · confirmed · `contribution_schedules.insurance_funding_mode` (and the accrual counters) are directly writable by the subscriber — spec check 7 violated

**Location:** column grant `UPDATE(insurance_funding_mode, insurance_premium_accrued,
insurance_premium_target, retirement_pct, emergency_pct, …)` on `public.contribution_schedules` TO
`authenticated`, + policy `contribution_schedules_update_self`

`insurance_funding_mode` is the switch between `pay_now` and `save_to_cover` and is read by
`trg_transactions_contribution` to decide whether to accrue and sweep. `insurance_premium_accrued` is the
accrual counter that same trigger reads (`v_new_accrued := LEAST(v_target, v_sched.insurance_premium_accrued + …)`).
Both are client-writable, bypassing the subscriber-gated `fund_insurance_products` RPC.

**Evidence:**
```
C08 sub sets schedules.insurance_funding_mode='save_to_cover'  || OK || 1
C09 sub sets schedules.insurance_premium_accrued=99999999      || OK || 1
C10 sub sets schedules.insurance_premium_target=0              || OK || 1
N3 sub PATCH /rest/v1/contribution_schedules?subscriber_id=eq.s-0001 {insurance_funding_mode:null}
   :: HTTP 400 :: {"code":"23502","message":"null value in column \"insurance_funding_mode\" … violates not-null constraint"}
N5 … {retirement_pct:null} :: HTTP 400 :: 23502 not-null on retirement_pct
N4 sub PATCH …subscriber_id=eq.s-0002 :: HTTP 200 :: []   (cross-tenant denied)
```

**Impact:** bounded, because the sweep in `trg_transactions_contribution` also requires
`v_emg_bal >= v_target` — real money must actually be in `emergency_balance`, so accrued cannot be
conjured on its own. What it *does* allow is silently flipping the funding mode, zeroing the accrual, and
re-splitting retirement/emergency percentages outside the RPC that owns those invariants — i.e. the
schedule shown in the demo can disagree with what the RPC believes.

**Suggested fix:** `REVOKE UPDATE (insurance_funding_mode, insurance_premium_accrued,
insurance_premium_target, insurance_savings_pct, insurance_choice_made, include_insurance) ON
public.contribution_schedules FROM authenticated, anon;` — the pattern already used on `subscribers`.

---

### A02-004 · MEDIUM · confirmed · A subscriber can create `withdrawals` and `nominees` rows directly, bypassing the DEFINER RPCs

**Location:** policies `withdrawals_insert_self`, `nominees_insert_self` / `nominees_update_self` /
`nominees_delete_self`

```
R04 sub INSERT own withdrawals row (250,000 UGX, bucket=emergency) || OK || 1
R05 sub INSERT withdrawals for s-0002 || ERROR || new row violates RLS for "withdrawals"
R06 sub INSERT own nominee            || OK || 1
R07 sub INSERT nominee for s-0002     || ERROR || new row violates RLS for "nominees"
subscriber | nominees | UPDATE || OK || 3      (own rows)
subscriber | nominees | DELETE || OK || 3      (own rows)
R08 sub DELETE s-0002 nominees        || OK || 0 rows
```

**Impact:** a withdrawal request created this way skips `request_withdrawal`'s balance check, bucket
validation and nonce idempotency, yet it appears in the agent / branch / distributor / admin withdrawal
queues and in the Withdrawals & Payouts report as a genuine payout request. Nominee shares can be set so
they do not sum to 100. Same-tenant only — no cross-tenant exposure.

**Suggested fix:** drop `withdrawals_insert_self` (the app already has `request_withdrawal`); keep the
nominee policies only if `useUpdateNominees` really writes the table directly, otherwise drop them too.

---

### A02-005 · MEDIUM · confirmed · agent / branch / distributor can create and edit their own hierarchy rows directly, bypassing the creation RPCs

**Location:** policies `subscribers_insert_agent`, `agents_insert_branch`, `agents_update_branch`,
`branches_insert_distributor`, `branches_update_distributor`, `distributors_update_self`

```
W09 agent INSERT subscriber under a-001         || OK || 1   (fires trg_subscribers_after_insert)
W10 agent INSERT subscriber under a-042         || ERROR || new row violates RLS for "subscribers"
W12 branch INSERT agent in b-kam-015            || OK || 1
W13 branch INSERT agent in b-mba-290            || ERROR || new row violates RLS for "agents"
W15 branch UPDATE own agents                    || OK || 5
W14 branch UPDATE agent a-1879 (other branch)   || OK || 0 rows
W16 distributor INSERT branch under d-001       || OK || 1
W17 distributor INSERT branch under d-002       || ERROR || new row violates RLS for "branches"
W18 distributor UPDATE branch b-bug-074 (d-002) || OK || 0 rows
W19 distributor UPDATE own distributors row     || OK || 1   (guarded by trg_distributors_enforce_editable_cols)
W20 distributor UPDATE d-002 row                || OK || 0 rows
agent | subscribers | INSERT || ALLOWED-RLS-PASSED || duplicate key value violates unique constraint "subscribers_phone_unique_non_demo_idx"
```

**Impact:** every one of these is tenant-correct, so there is **no isolation failure** — the issue is that
`docs/BACKEND.md:46` / `:601` and `docs/role-permissions.md:250` all assert "no client write policies;
every write goes through a SECURITY DEFINER RPC", and that is simply not true of the live database. A
row created this way skips the RPC's validation (NIN/phone/district checks in `create_subscriber_*`,
`create_branch`'s district FK check, the `create_agent` shape) while still firing
`trg_subscribers_after_insert`, so it can produce a half-formed but *plausible-looking* subscriber.
`subscribers.phone` uniqueness is the only backstop, and it held (see the unique violation above).

**Suggested fix:** either drop the six write policies and let the RPCs be the only door, or update
`BACKEND.md` + `role-permissions.md` to state the truth. Do not leave the doc and the DB disagreeing —
the doc is what the next contributor will trust.

---

### A02-006 · LOW · confirmed · `subscriber_insurance_products` has no SELECT policy for branch, distributor, employer or admin — 1,473 live rows are invisible to four roles

**Location:** `public.subscriber_insurance_products` — only 4 policies exist
(`sip_select_self`, `sip_select_agent`, `sip_insert_self`, `sip_update_self`)

The parallel table `insurance_policies` (life) has **eight** policies including
`insurance_policies_select_admin/_branch/_distributor/_employer`. When `0064`/`0065` split health and
funeral cover into `subscriber_insurance_products`, only the self + agent policies were carried over.

```
$ psql -At -F'|' -c "select 'sip_rows_total',count(*)::text from subscriber_insurance_products
  union all select 'sip_rows_for_emp001_staff',count(*)::text from subscriber_insurance_products p join subscribers s on s.id=p.subscriber_id where s.employer_id='emp-001'
  union all select 'sip_rows_under_d001',count(*)::text from subscriber_insurance_products p join subscribers s on s.id=p.subscriber_id join agents a on a.id=s.agent_id join branches b on b.id=a.branch_id where b.distributor_id='d-001'
  union all select 'sip_rows_under_bkam015',count(*)::text from subscriber_insurance_products p join subscribers s on s.id=p.subscriber_id join agents a on a.id=s.agent_id where a.branch_id='b-kam-015';"
sip_rows_total|1473
sip_rows_for_emp001_staff|21
sip_rows_under_d001|1328
sip_rows_under_bkam015|6
```
…yet the matrix shows `subscriber_insurance_products` SELECT = **0** for branch, distributor, employer
and admin. `docs/role-permissions.md` says the admin's `*_select_admin` policies "clone the distributor
see-everything grants" and that the employer Insurance page shows "per-member cover/status".

**Impact today: none user-visible.** `src/services/employer.js:364` selects only `insurance_policies(*)`,
and no admin/distributor rollup RPC reads the table (`select proname from pg_proc where prosrc ilike
'%subscriber_insurance_products%'` returns only `fund_insurance_products`, `pay_insurance_premium`,
`submit_hospital_cash_claim`, `update_employer_profile`, `trg_transactions_contribution`,
`_insert_subscriber_chain`). It is a latent gap: the moment anyone adds a multi-product insurance panel
for those roles it will silently return `[]` rather than error.

**Suggested fix:** add `sip_select_admin` / `_branch` / `_distributor` / `_employer` mirroring the four
`insurance_policies_select_*` policies verbatim.

---

### A02-007 · LOW · confirmed · `distributors` is unreadable by subscriber / agent / branch / employer, contradicting `docs/role-permissions.md`

**Location:** `public.distributors` — policies `distributors_select_admin`, `distributors_select_self`,
`distributors_update_self`

`docs/role-permissions.md` (Data Scoping Rules Summary) states: *"All authenticated roles read
`distributors`: `distributors_select USING (true)` lets the singleton row resolve for every dashboard's
'Operated by …' attribution"*, and lists "read-only of the singleton `distributors` row" for the
subscriber, agent and branch rows of the matrix. `0081` replaced that with admin-only + distributor-self.

```
R41 subscriber SELECT distributors || OK || 0
R42 agent      SELECT distributors || OK || 0
R43 branch     SELECT distributors || OK || 0
R39 employer   SELECT distributors || OK || 0
X04d d-001 reads d-002 distributor row || OK || 0
```
Live: distributor sees 1 (own), admin sees 3.

**Impact:** doc drift only, today. `useEntity('distributor', …)` is called from
`src/dashboard/settings/Settings.jsx:37`, `src/dashboard/overview/DistributorOverview.jsx:143`,
`src/dashboard/mobile/{DistributorHomeMobile,DistributorHubMobile,SettingsMobile}.jsx` — all
distributor-shell files, which do have access. No subscriber/agent/branch component reads it.

**Suggested fix:** correct four rows of `docs/role-permissions.md` (it is the reference this very check
was scored against), or restore a narrow `distributors_select_attribution` if the attribution line is
still wanted on the other shells.

---

### A02-008 · LOW · confirmed · `anon` reads of 15 tables return HTTP 401 with an internal function name instead of an empty result

**Location:** missing `EXECUTE` grant to `anon` on `public.subscriber_agent_id()`,
`public.current_distributor_id()`, `public.distributor_branch_ids()` — referenced by policies on
`agents`, `branches`, `claims`, `commissions`, `contribution_schedules`, `distributors`,
`insurance_policies`, `nominees`, `notifications`, `settlement_batches`, `subscriber_balances`,
`subscriber_insurance_products`, `subscribers`, `transactions`, `withdrawals`

```
A2 anon GET /rest/v1/subscribers?select=id&limit=2
   :: HTTP 401 :: {"code":"42501","message":"permission denied for function subscriber_agent_id"}
A3 anon GET /rest/v1/transactions?select=id&limit=2
   :: HTTP 401 :: {"code":"42501","message":"permission denied for function subscriber_agent_id"}
A6 anon GET /rest/v1/users?select=id&limit=2
   :: HTTP 401 :: {"code":"42501","hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.users TO anon;","message":"permission denied for table users"}
```
Matrix: 31 anon cells error this way (20 `subscriber_agent_id`, 7 `current_distributor_id`,
4 `distributor_branch_ids`) plus 10 table-ACL denials.

**Impact:** fail-closed — no data leaks, and the analogous tables with no helper in the policy
(`money_nonces`, `settlement_uploads`, …) correctly return `HTTP 200 []`. But the response leaks internal
schema identifiers and a `GRANT …` hint to unauthenticated callers, and it is a `401` rather than an
empty set — `src/services/supabaseClient.js:131-137` (`isSupabaseAuthError`) treats `status === 401` as
token expiry and forces a logout+redirect, so any future pre-login read of one of these tables would
bounce the visitor to `/`. (Not reproduced end-to-end: no current anon code path reads these tables —
the landing/signup flow only reads `districts`/`regions` and calls the three anon-granted RPCs.)

**Suggested fix:** either `GRANT EXECUTE … TO anon` on the three helpers so anon reads return `[]`
consistently, or `REVOKE` the table-level grants from `anon` on those 15 tables so the denial is uniform
and says nothing about the schema.

---

### A02-009 · INFO · confirmed · Live data drifted materially during the audit window

Row counts moved *between* my own queries — other audit agents are exercising the app against live data.

```
baseline 00-baseline.md §6      →  measured mid-A02
subscribers   5064              →  5081
transactions  29027             →  29158
users         48                →  51
agents        2046              →  2046
subscribers where agent_id='a-001'  11  →  28
```
Nothing in A02 wrote anything (all probes rolled back / forced into constraint violations). Consumers of
this report should treat every absolute count as point-in-time; the *relative* verdicts (0 vs non-zero,
allowed vs denied) are unaffected.

---

### A02-010 · INFO · confirmed · One `branches` row has `distributor_id IS NULL` and is invisible to every distributor

```
$ psql -At -F'|' -c "select distributor_id, count(*) from branches group by 1 order by 1;"
d-001|291
d-002|27
d-003|2
|1
$ psql -At -F'|' -c "select id from branches where distributor_id is null;"
tst-branch-msc7w8vm
```
`branches_scope_distributor` is RESTRICTIVE with `distributor_id = current_distributor_id()`, so a NULL
owner matches no distributor; only the admin can see it (321 vs 291+27+2 = 320). Looks like a leftover
test fixture. Flagged for A06 (ownership/invariants), not remediated here.

---

## Traceability

| # | Check (from spec) | Disposition |
|---|---|---|
| 1 | Build the full 925-cell matrix (6 roles × 37 tables × 4 ops + 37 anon SELECT); expected vs actual vs verdict; write to `baseline/rls-matrix.csv`; scripted | **PASS** — 1,036 cells written (925 required + 111 extra anon write cells); 1,011 PASS / 13 FAIL / 7 GAP / 5 N-A. The 13 FAILs are A02-001…A02-005; the 7 GAPs are A02-006 and A02-007. |
| 2 | Cross-tenant probes (d-001↔d-002, emp-001↔emp-002, a-001↔a-042, b-kam-015↔b-mba-290, s-0001↔s-0002) must each return zero rows, using real live IDs | **PASS** — 32 psql probes + 6 HTTP probes, all 0 rows; 6 positive controls non-zero, proving the harness. **0 leaks.** |
| 3 | Live `pg_policies` contains zero `auth.uid()` and zero `->> 'role'` | **PASS** — 0 and 0 of 109 policies, verified live. |
| 4 | Every table ENABLE + FORCE except the two known; confirm no third has appeared | **PASS** — 37/37 ENABLE, 35/37 FORCE; exactly `entity_detach_log` + `entity_status_log`, both with no `anon`/`authenticated` grant at all. |
| 5 | Direct-table INSERT/UPDATE probes as each role on every table; all should fail; roll back every probe | **FINDING A02-001, A02-002, A02-003, A02-004, A02-005** — 13 of 666 write cells succeed (all same-tenant; 0 cross-tenant). Every probe rolled back; 0 rows persisted. |
| 6 | The 8 RPC-internal ledgers unreachable as anon AND authenticated | **PASS** — 6 default-deny to `[]` (0 policies), 2 hard `permission denied` (no grant); all 7 principals, all 4 ops. |
| 7 | Column-level grants: `subscribers.{agent_id,employer_id,compensation,kyc_status,is_active,nin}` and `contribution_schedules.insurance_funding_mode` all rejected | **FINDING A02-003** — `subscribers` PASSES all 6 (column grant limited to `consent_at,email,name,occupation,phone`; rejected over psql *and* HTTP 403). `contribution_schedules.insurance_funding_mode` **is granted and succeeds**, together with `insurance_premium_accrued` / `insurance_premium_target` / `retirement_pct` / `emergency_pct`. |

## Artifacts

- `docs/audits/2026-08-23/baseline/rls-matrix.csv` — the full 1,036-cell matrix
- `docs/audits/2026-08-23/02-rls-matrix.md` — this file

**No fixture rows were created and none were left behind.** Every write probe executed inside a
transaction that was rolled back, or was deliberately shaped to abort on a post-RLS unique / NOT NULL
constraint so that nothing was ever written. Verified after the fact:
`SELECT count(*) FROM transactions WHERE id LIKE 'a02-probe%'` → `0`;
`SELECT total_balance FROM subscriber_balances WHERE subscriber_id='s-0001'` → `1386092` (unchanged).
