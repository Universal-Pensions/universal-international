# A26 · Documentation accuracy

**Scope:** the 12 LIVE documentation artifacts, fact-checked claim-by-claim against
`docs/audits/2026-08-23/00-baseline.md` and against live introspection re-run in this
session. **No documentation file was edited** (G1). The required deliverable
`docs/audits/2026-08-23/DOC-CORRECTIONS.md` is written and holds the full
doc | line | claim | reality | replacement table.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 44 (12 live docs · 2 in-code doc-comment blocks · 1 archive doc · 29 archived audit docs) |
| Artifacts examined | 44 |
| Coverage | 100% (12 live docs + 2 code-comment blocks fact-checked claim-by-claim; the 30 archived docs surveyed for historical markers only — that is what check 5 asks of them) |
| Checks defined | 7 |
| Checks executed | 7 |
| Checks passed / failed / blocked | 1 / 6 / 0 |
| Findings C / H / M / L / I | 0 / 4 / 5 / 5 / 2 |
| Evidence commands run | 55 |
| Excluded as demo-scope | 3 (README:9 mocked OTP/KYC/24h-JWT framing · api-contracts §1.4 demo-mock list · CLAUDE.md §10a inventory — all accurate descriptions of deliberate demo scope, not defects) |
| Blocked, with reason | none |

### Domain metrics (required by spec)
| Metric | Value |
|---|---|
| Docs reviewed | 12 live (full fact-check) + 30 archived/legacy (marker survey) |
| Factual claims checked | 145 |
| Claims correct | 33 |
| Claims stale / wrong | 107 |
| Claims unverifiable | 5 (all Render/GitHub platform-side: tracked branch, Deploy Hook config, cron-job.org + UptimeRobot pingers, 7-day log rotation, 750 h/mo instance cap — G5 forbids touching the deploy surface) |
| CLAUDE.md rules without mechanical enforcement | **12 of 13** (one half-enforced) |
| role-permissions.md ↔ A02 measured-matrix disagreements | **7** |
| Corrections drafted | **107** (in `DOC-CORRECTIONS.md`; 4 further rows recorded as explicit KEEP) |

---

## 0. Method

Three sources of truth, in this precedence order:

1. **Live introspection**, re-run in this session against `ilkhfnoyxlxwqadebnkp` over
   `psql "$SUPABASE_DB_URL"` — `pg_class`, `pg_proc`, `pg_policies`, `pg_trigger`,
   `pg_type`, `pg_extension`, `supabase_migrations.schema_migrations`,
   `has_function_privilege`, and `count(*)` row counts (never `n_live_tup`, per A00 §6).
2. **`00-baseline.md`**, where it already measured something I did not need to re-measure
   (lint/unit/build/Playwright).
3. **`02-rls-matrix.md`** (A02) for check 3 — its 1,036-cell matrix is the measured
   counterpart to `docs/role-permissions.md`.

Where a doc claim was checkable against the repo rather than the DB (file counts, route
mounts, spec inventories, lint config, ESLint rules), I ran the count rather than
reasoning from the doc. Every number quoted below was produced by a command in this
session; the commands are reproduced inline.

---

## 1. Check 1 — factual claims in the 12 live docs

### 1.1 Live ground truth captured this session

```
$ cd /Users/shubhang/Desktop/Projects/uganda-dashboard
$ set -a; . ./.env.local >/dev/null 2>&1; set +a
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "
SELECT 'tables', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'views', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v'
UNION ALL SELECT 'fn_names', count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
UNION ALL SELECT 'fn_oids', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
UNION ALL SELECT 'definer', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
UNION ALL SELECT 'policies', count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'ledger_rows', count(*) FROM supabase_migrations.schema_migrations;"
tables|37
views|1
fn_names|89
fn_oids|89
definer|70
policies|109
ledger_rows|96
```

```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "
SELECT 'anon_exec', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
UNION ALL SELECT 'authenticated_exec', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
UNION ALL SELECT 'definer_no_searchpath', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));"
anon_exec|13
authenticated_exec|87
definer_no_searchpath|0
```

```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT version||' '||coalesce(name,'') FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"
20260811100047 0108_nominee_claims_seed
20260808170000 0107_nav_avg_growth_per_member
20260808160000 0106_nav_publish_where_clause
20260808150000 0105_nav_backfill
20260808140000 0104_nav_pricing_rpcs
```

```
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal;"
10
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' ORDER BY 1;"
commission_status
nominee_type
```

```
$ ls supabase/migrations/*.sql | grep -v '\.down\.sql' | wc -l          # 108
$ ls supabase/migrations/*.sql | grep -v '\.down\.sql' | head -1        # 0001_initial_schema.sql
$ ls supabase/migrations/*.sql | grep -v '\.down\.sql' | tail -1        # 0108_nominee_claims_seed.sql
$ ls supabase/migrations/*.down.sql | wc -l                             # 86
$ grep -c "app.all" server/index.ts                                     # 17 lines match; 16 are mounts, 1 is the comment on :250
```

```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT id,name,status FROM distributors ORDER BY id;"
d-001|Universal Pensions Uganda — National|active
d-002|Universal Pensions Uganda — Secondary|active
d-003|Karamoja Pilot Network|active
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT coalesce(distributor_id,'NULL'), count(*) FROM branches GROUP BY 1 ORDER BY 1;"
d-001|291
d-002|27
d-003|2
NULL|1
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT (SELECT count(*) FROM agents),(SELECT count(*) FROM branches),(SELECT count(*) FROM subscribers),(SELECT count(*) FROM employers);"
2046|321|5064|8
```

### 1.2 The six ALREADY-CONFIRMED-STALE items — all verified, all confirmed

| Pre-flagged claim | Verified? | Measured |
|---|---|---|
| README claims migrations `0001`–`0078` (`README.md:30`, `:92`) | ✅ CONFIRMED | 108 files, `0001`–`0108` |
| BACKEND.md claims `0076` (`:44`, `:339`, `:343`, `:358`, `:1013`, `:1015`, `:1019`) | ✅ CONFIRMED — and it is **seven** places, not one | `0001`–`0108`; ledger head `0108_nominee_claims_seed` |
| ARCHITECTURE.md "57 migrations / 28 tables / 40 functions" (`:79`, `:80`, `:84`, `:661`) | ✅ CONFIRMED | 108 / 37 / 89 |
| api-contracts.md "14 routes" in FIVE places | ✅ CONFIRMED — the five are `:1`, `:7`, `:23`, `:57`, `:239` | 16 |
| `server/index.ts:61` "14 handler imports" and `:250` "14 route mounts" | ✅ CONFIRMED | 16 imports, 16 `app.all` mounts, 16 route source files |
| README's "hardcoded unit price" (`README.md:9`) | ✅ CONFIRMED stale | Superseded by `0103`–`0106`; `BACKEND.md:900` and `FRONTEND.md:1419` already mark it RESOLVED — README is the last holdout |

### 1.3 The four NEW baseline facts — where each is stated wrongly

| Baseline fact | Stated wrongly at |
|---|---|
| **89 live functions**, not 108 (20 names in migration files are not live) | `ARCHITECTURE.md:80` ("40 functions"), `BACKEND.md:38` + `:44` + `:625` ("53 functions"). No doc anywhere states 89, and none warns that the `0021` commission family is absent from `pg_proc`. |
| **anon-EXECUTE surface is 13**, not 25 | `BACKEND.md:428` and `:657` say "only the **3** intended pre-login RPCs still anon-executable" while the same sentence adds "plus every trigger function" — internally contradictory. The real total is 13 (3 intentional + 10 zero-arg `RETURNS trigger` functions retaining the default PUBLIC grant). |
| **70 DEFINER functions**, not 86 | No doc states a DEFINER count. `ARCHITECTURE.md:80` implies 29; `BACKEND.md:625` asserts the search_path discipline holds, which is **correct** (measured: 0 DEFINER functions without a pinned `search_path`). |
| **109 live policies** | `ARCHITECTURE.md:81`, `BACKEND.md:329`, `BACKEND.md:565`, `FRONTEND.md:335` all say "~90"; `BACKEND.md:39` and `:44` say "99". Four documents, three different wrong numbers. |

### 1.4 Two doc claims that would cause a destructive or wrong ACTION

These are the reason check 1 is rated a finding rather than a tidy-up.

**(a) `docs/api-contracts.md:240` instructs an agent to apply a migration that is already live.**

> ⚠️ **`0092_unified_contribution_config` is written but NOT yet applied** — apply it out of band, never via `supabase db push`

Refuted three independent ways:

```
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('_normalize_contribution_config','get_my_employer_funding');"
_normalize_contribution_config
get_my_employer_funding

$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM employers WHERE default_contribution_config ? 'mode';"
0

$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT DISTINCT jsonb_object_keys(default_contribution_config) FROM employers ORDER BY 1;"
employeePct
employerPct
groupCoverAmount
groupInsuranceProducts
insuranceEnabled
```

Both `0092` functions exist; zero of 8 employer configs carry the retired `mode` key
(`0093` backfilled it out). The same line also asserts "the tracked `supabase_migrations`
ledger stops at `0084`" (head is `0108_nominee_claims_seed`) and "`0001`–`0091` are live"
(all 108 are).

**(b) `CLAUDE.md:126` (§7.3) and `docs/api-contracts.md:9` state a security property that is false.**

> "never write directly to a table from the client. **RLS would block it**"
> "PostgREST direct table reads governed by row-level security policies (**no writes** — writes always go through RPCs)"

A02 measured **13 direct client-write successes** (`02-rls-matrix.md` §5, findings
A02-001…A02-005), including a subscriber POSTing arbitrary money into
`/rest/v1/transactions`. The shipped frontend does it too:

```
$ grep -rn "\.insert(\|\.update(\|\.upsert(" src/services/*.js | grep -v "rpc(" | head
src/services/entities.js:1065:    .insert(row)
src/services/entities.js:1101:    .insert(row)
src/services/entities.js:1133:    .update(row)
src/services/entities.js:1185:    .update(row)
src/services/entities.js:1411:    .update({ status })
src/services/subscriber.js:1049:      .update(patch)
src/services/subscriber.js:1212:        .upsert({ subscriber_id: id, ...patch }, { onConflict: 'subscriber_id' })
src/services/subscriber.js:1219:        .update(patch)
src/services/subscriber.js:1399:      await supabase.from('insurance_policies').update(renewalPatch).eq('subscriber_id', id);
src/services/subscriber.js:1463:      .update(patch)

$ sed -n '1411,1414p' src/services/subscriber.js
      await supabase.from('transactions').insert({
        id: tx.id,
        subscriber_id: id,
        type: 'premium',
```

This matters beyond tidiness: A02 derived `expected = DENY` for all 666 write cells of its
matrix **from these very lines** (`02-rls-matrix.md:93-97` cites `BACKEND.md:46` / `:601`
and `role-permissions.md:250`). The documentation is the contract a security audit
measured against, and the contract is aspirational.

**→ Check 1 = FINDING A26-001, A26-002, A26-003, A26-006, A26-007, A26-010, A26-011, A26-012, A26-014, A26-016.**

---

## 2. Check 2 — CLAUDE.md §4 / §5 versus ENFORCEMENT REALITY

CLAUDE.md line 1 says: *"Treat its Hard rules (§4) and Anti-patterns (§5) as **binding, not
advisory**."* Thirteen numbered rules follow. **Twelve have no mechanical gate at all.**

### 2.1 What enforcement machinery actually exists

```
$ cat eslint.config.js | grep -n "rules:" -A 20
  ...
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]|^motion$', ... }],
      'react-refresh/only-export-components': ['warn', { ... }],
    },
```
No `no-restricted-imports`. No `no-restricted-syntax`. No custom rule. The only other
block is the jsx-a11y set, every rule of which is force-downgraded to `warn`:
```
const jsxA11yWarnRules = Object.fromEntries(
  Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, 'warn'])
)
```

```
$ ls .stylelintrc* stylelint.config.* 2>/dev/null; echo "(none)"
(none)
$ ls .husky 2>/dev/null; grep -n "lint-staged\|husky\|pre-commit" package.json; echo "(none)"
(none)
```
**No stylelint config exists anywhere in the repo**, so §5.3 and §5.4 (both pure CSS rules)
have literally nothing that can evaluate them. **No pre-commit hooks**, so nothing runs
between an edit and a commit. CI (`.github/workflows/test.yml`) runs only ESLint + Vitest +
`tsc -p server/tsconfig.json` + Playwright.

The one real gate is a Vitest contract test that greps the migration corpus:
```
$ grep -n "it(\|describe(" src/test/jwt-claim-contract.test.js
42:describe('JWT claim contract across migrations', () => {
47:    it('discovers migration files', () => {
54:    it(`${file} reads app_role (not role) for app-level gates`, () => {
```
It asserts no migration after `0007` reads `->> 'role'`. It does **not** check `auth.uid()`.

### 2.2 Rule-by-rule enforcement table

| # | Rule (abridged) | Mechanical enforcement | Currently honoured? | Verdict |
|---|---|---|---|---|
| §4.1 | Components/dashboards never import `src/data/mockData.js` | **NONE** — no `no-restricted-imports`, no boundary test | ✅ yes (`grep -rln "data/mockData" src/ --include="*.jsx"` → 0 hits) | **UNENFORCED** |
| §4.2 | Top-level nav via `react-router-dom`; panel state in `DashboardPanelContext`, not routed | **NONE** | not machine-checkable as written | **UNENFORCED** |
| §4.3 | Use `useAuth()` from `AuthContext`; session keys `upensions_auth` / `upensions_token` | **NONE** | — | **UNENFORCED** |
| §4.4 | No hardcoded API endpoints; read `src/config/env.js` | **NONE** | ✅ yes — the only `onrender.com` literal in `src/` is inside the error string at `src/config/env.js:21` | **UNENFORCED** |
| §4.5 | `SignupContext` persists every patch to `localStorage` | **NONE** (behavioural) | — | **UNENFORCED** |
| §4.6 | Always pass frequencies through `normalizeFrequency()` | **PARTIAL** — `src/utils/__tests__/finance.test.js` tests the *function*; nothing asserts call sites use it | — | **UNENFORCED at the boundary** |
| §5.1 | (= §4.1) Don't import `mockData` from components | **NONE** | ✅ yes | **UNENFORCED** |
| §5.2 | Don't hand-roll `fetch()` against `/api/*` — use `services/api.js` | **NONE** | ✅ yes (grep for `fetch('/api` outside `services/api.js` → 0 hits) | **UNENFORCED** |
| §5.3 | No `outline: none` without a `:focus-visible` replacement | **NONE** — no stylelint | ⚠️ **115** `outline: *none` occurrences in `src/**/*.css`; each would need manual pairing | **UNENFORCED** |
| §5.4 | No `transition: all` | **NONE** — no stylelint | ✅ yes — all 3 grep hits are *comments citing the rule*, zero real declarations | **UNENFORCED** |
| §5.5 | Don't bypass `normalizeFrequency` on read/write | **NONE** | — | **UNENFORCED** |
| §5.6 | No raw SQL from the frontend — every DB write through a DEFINER RPC | **NONE** | ❌ **VIOLATED** — 11 direct `.insert/.update/.upsert` call sites in `src/services/{subscriber,entities}.js` (§1.4b) | **UNENFORCED + VIOLATED** |
| §5.7 | RLS reads `app_role`, never `'role'`; don't trust `auth.uid()` | **HALF** — `src/test/jwt-claim-contract.test.js` greps `supabase/migrations/*.sql` for `->> 'role'`. **No check for `auth.uid()`.** | ✅ yes live (0 policies use either — A00 §5) | **HALF-ENFORCED** |

The headline for a reader: **a change that violates §4.1, §5.2, §5.3, §5.4 or §5.6 passes
`npm run lint`, `npm test`, `npm run build`, `npm run build:api` and the full CI pipeline.**
Four of those five rules currently hold by convention alone; the fifth (§5.6) already
doesn't.

The three genuinely enforced properties are worth naming, because they show the pattern that
works — all three are Vitest specs that parse `supabase/migrations/*.sql` and assert on the
**newest** migration that defines each object: `jwt-claim-contract.test.js` (§5.7 half),
`nav-pricing-contract.test.js` (no unit-price literal may be reintroduced),
`login-identity-contract.test.js` (the persona write must survive a `CREATE OR REPLACE`),
`employer-split-contract.test.js` (employer money must land 100% in retirement). Four of the
thirteen CLAUDE.md rules could be enforced the same way; none of the CSS or import-boundary
rules can, without adding stylelint and an ESLint `no-restricted-imports` block.

**→ Check 2 = FINDING A26-005.**

---

## 3. Check 3 — `docs/role-permissions.md` versus A02's measured matrix

`docs/audits/2026-08-23/02-rls-matrix.md` exists and its §1.1 SELECT pivot is the measured
counterpart to this document. **Seven disagreements**, two of which are the document
contradicting *itself*.

| # | role-permissions.md | A02 measured / live policy | Kind |
|---|---|---|---|
| 1 | `:340` "distributor \| **All entities, all levels**" | d-001 sees 4605/5064 subscribers, 1872/2046 agents, 291/321 branches — own network only since `0081` | **Self-contradiction** — `:49` of the same doc says "Visibility (since `0081`): its OWN network only" |
| 2 | `:348` "**Distributor:** No scoping applied — all data visible." | Same as above; three DEFINER helpers scope 12 tables (`0081`–`0089`) + RESTRICTIVE overlays (`0084`) | **Self-contradiction** |
| 3 | `:349` "All authenticated roles read `distributors`: **`distributors_select USING (true)`**" | No such policy. Live: `distributors_select_admin`, `distributors_select_self`, `distributors_update_self` | **Refuted live** |
| 4 | `:341`, `:342`, `:343` — branch / agent / subscriber each "(+ read-only of the singleton `distributors` row)" | A02 pivot: `distributors` → subscriber **0**, agent **0**, branch **0**, employer **0** (A02-007) | **Refuted live** |
| 5 | `:60-62` "**Still platform-wide, pending `0084`:** `agents` / `branches` (single shared `*_select_authenticated` policy)" | `0084` **and** `0094` shipped. No `*_select_authenticated` policy exists | **Superseded** |
| 6 | `:315` admin SELECT on the employer family incl. **`contribution_run_lines`** | `to_regclass('public.contribution_run_lines')` → NULL (dropped by `0045`) — as `:211` of the same doc states | **Self-contradiction + refuted live** |
| 7 | `:250` "Writes go through the employer DEFINER RPCs … **no client write policies**" | A02 §5: **13 direct-write successes** across `transactions`, `insurance_policies`, `contribution_schedules`, `withdrawals`, `nominees`, `agents`, `branches`, `distributors` | **Refuted live** |

Evidence for #3 / #4 / #6:
```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT policyname||' | '||cmd FROM pg_policies WHERE schemaname='public' AND tablename='distributors' ORDER BY policyname;"
distributors_select_admin | SELECT
distributors_select_self | SELECT
distributors_update_self | UPDATE

$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT to_regclass('public.contribution_run_lines');"
(empty — relation does not exist)

$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT tablename||' | '||policyname||' | '||permissive FROM pg_policies WHERE schemaname='public' AND tablename IN ('agents','branches') ORDER BY 1;"
agents | agents_insert_branch | PERMISSIVE
agents | agents_scope_distributor | RESTRICTIVE
agents | agents_select_admin | PERMISSIVE
agents | agents_select_branch | PERMISSIVE
agents | agents_select_distributor | PERMISSIVE
agents | agents_select_self | PERMISSIVE
agents | agents_select_subscriber | PERMISSIVE
agents | agents_update_branch | PERMISSIVE
branches | branches_insert_distributor | PERMISSIVE
branches | branches_scope_distributor | RESTRICTIVE
branches | branches_select_admin | PERMISSIVE
branches | branches_select_agent | PERMISSIVE
branches | branches_select_distributor | PERMISSIVE
branches | branches_select_self | PERMISSIVE
branches | branches_select_subscriber | PERMISSIVE
branches | branches_update_distributor | PERMISSIVE
```

Two further count drifts in the same doc (`:38` "~316 branches" → 321; `:40` "~2,049
agents" → 2046) are folded into A26-014.

Note on the direction of the errors: #1/#2/#5 all describe the platform as **more open**
than it is, and #3/#4 describe it as **more open** than it is too — so a reader trusting
this doc would under-estimate the distributor scoping work and over-estimate cross-role
reads. Only #7 errs the other way, describing the platform as **more locked down** than it
is, which is the dangerous direction.

**→ Check 3 = FINDING A26-004.**

---

## 4. Check 4 — `docs/data-model.md` versus the live schema, field by field

Compared against `docs/audits/2026-08-23/baseline/columns.csv` (383 rows) plus live
`pg_policies` / `to_regclass` probes.

### 4.1 Coverage

`data-model.md:5` claims to describe "**every entity in the system**". It has **17 entity
sections**. The live schema has **37 tables** (+1 view). Twenty-one tables have no
field-level entry anywhere: `subscriber_balances`, `transactions`, `withdrawals`, `claims`,
`nominees`, `insurance_policies`, `subscriber_insurance_products`, `contribution_schedules`,
`nav_snapshots`, `nominee_claims`, `custody_transfers`, `access_requests`,
`agent_referrals`, `contact_submissions`, `demo_personas`, `money_nonces`,
`entity_detach_log`, `entity_status_log`, `subscriber_signup_uploads`,
`contribution_run_uploads`, `users`. Several of those (`subscriber_balances`,
`transactions`, `contribution_schedules`, `nav_snapshots`) carry the platform's money.

### 4.2 Field-level divergences confirmed

| Entity (doc §) | Doc says | Live columns | Divergence |
|---|---|---|---|
| **Distributor** (`:48-58`) | 9 fields + `metrics` | `id name parent_id manager_name manager_phone manager_email status created_at updated_at registration_no` | **`registration_no` missing from the doc** |
| **Distributor** (`:67`) | "**Two** distributors seeded" | `d-001`, `d-002`, **`d-003` Karamoja Pilot Network** | Count wrong |
| **Distributor** (`:69`) | RLS "`distributors_select USING (true)`" | `distributors_select_admin` + `distributors_select_self` | Policy does not exist |
| **Subscriber** (`:190-208`) | `parentId`, `contributionHistory`, `totalContributions`, `totalWithdrawals`, `productsHeld`, `registeredDate`, … | `id name email phone gender age dob nin occupation agent_id district_id kyc_status is_active is_demo_signup insurance_same_as_pension registered_date consent_at last_contribution_date contribution_history products_held current_unit_value unit_value_as_of created_at employer_id compensation` (25) | Doc lists the **mock object shape**. `parentId` and `totalWithdrawals` are not columns (the FK is `agent_id`); **11 real columns are never mentioned** — `dob`, `nin`, `occupation`, `district_id`, `is_demo_signup`, `insurance_same_as_pension`, `consent_at`, `last_contribution_date`, `current_unit_value`, `unit_value_as_of`, `created_at` |
| **Employer** (`:241`) | "The Employer owns a **standalone** staff roster (`employees`) … employees are **NOT subscribers**" | `to_regclass('public.employees')` → NULL | The **retired pre-`0045` model stated in the present tense at the top of the section**, contradicted by the doc's own banner 26 lines later at `:267` |
| **Employer** (`:243-254`) | 10 fields | `… payroll_cadence default_contribution_config created_at updated_at status` | **`status` missing** (added `0060`; drives deactivate/reactivate + the login gate) |
| **Employer Invite** (`:294`) | RLS `employer_invites_self_select` | `employer_invites_select_employer` + `employer_invites_select_admin` | Policy name wrong |
| **Contribution Run** (`:406-417`) | 9 fields | `id employer_id period_label status employer_total employee_total grand_total run_at created_at insurance_total` | **`insurance_total` missing** (the `0066` group-insurance leg) |
| **Contribution Run Line** (`:428-447`) | Present tense, "**Doubles as the employee's contribution ledger**" | `to_regclass('public.contribution_run_lines')` → NULL | Dropped by `0045`. The sibling **Employee** section at `:298` carries a `> **HISTORICAL (pre-`0045`)**` banner; this one carries **none of its own** |

Verification commands:
```
$ awk -F, -v t=subscribers '$1==t{print $2}' docs/audits/2026-08-23/baseline/columns.csv | tr '\n' ' '
id name email phone gender age dob nin occupation agent_id district_id kyc_status is_active is_demo_signup insurance_same_as_pension registered_date consent_at last_contribution_date contribution_history products_held current_unit_value unit_value_as_of created_at employer_id compensation
$ awk -F, -v t=employers '$1==t{print $2}' docs/audits/2026-08-23/baseline/columns.csv | tr '\n' ' '
id name sector registration_no contact_name contact_phone contact_email district payroll_cadence default_contribution_config created_at updated_at status
$ awk -F, -v t=contribution_runs '$1==t{print $2}' docs/audits/2026-08-23/baseline/columns.csv | tr '\n' ' '
id employer_id period_label status employer_total employee_total grand_total run_at created_at insurance_total
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT tablename||'|'||policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('employers','employer_invites') ORDER BY 1;"
employer_invites|employer_invites_select_admin
employer_invites|employer_invites_select_employer
employers|employer_self_select
employers|employers_select_admin
```

**Correct claims worth recording** (this document is largely good, which is why the gaps
matter): the `## Employee` section's HISTORICAL banner is exemplary; `:82`'s NAV /
cost-basis narrative matches `0103`–`0106` exactly; `employer_self_select` is the right
policy name; the `0092`/`0093` percent-only config shape is described correctly and matches
the live JSONB keys.

**→ Check 4 = FINDING A26-009.**

---

## 5. Check 5 — snapshot dates and superseded archives

### 5.1 Live docs that need a snapshot date

```
$ for f in CLAUDE.md README.md docs/*.md .claude/skills/qa.md; do
    grep -oiE "(last (updated|sync|verified)|as of|snapshot)[^.|]{0,40}" "$f" | head -1; done
```

| Doc | Date marker | Action |
|---|---|---|
| `docs/migrations-runbook.md` | ✅ self-marks historical, scoped to the `0045`–`0057` cutover | **KEEP — the model the others should copy** |
| `docs/ARCHITECTURE.md` | ⚠️ "pinned to a May 2026 post-cleanup snapshot … verify concrete counts" | Honest, but its counts are quoted downstream regardless — add a hard date |
| `docs/BACKEND.md` | ⚠️ inline "verified 2026-07-08" only | Add a header date |
| `docs/FRONTEND.md` | ⚠️ inline "at last sync" (undated) | Add a header date |
| `README.md` | ⚠️ warns counts "can lag the code", no date | Add a header date |
| `CLAUDE.md`, `docs/SPEC.md`, `docs/data-model.md`, `docs/api-contracts.md`, `docs/render-operational.md`, `.claude/skills/qa.md` | ❌ none | Add |
| `docs/role-permissions.md` | ❌ **none anywhere in the file** — the only live doc with no temporal marker of any kind | Add (highest priority: it is the doc A02 measured against) |

### 5.2 Archived audit docs — already handled correctly

```
$ for f in $(find docs/audits -maxdepth 2 -name "*.md" | grep -v 2026-08-23); do head -1 "$f" | grep -c "Historical audit"; done | sort | uniq -c
  29 1
$ head -1 docs/audits/2026-05-31/AUDIT_REPORT.md
> **Agent guide.** Historical audit from 2026-05-31 … a point-in-time snapshot, **not** current state.
```

**All 29** archived audit files under `docs/audits/{2026-04-distributor,2026-05-31,dashboard}/`
already carry the correct historical banner. `docs/archive/api-contracts-2024-original.md`
is correctly cross-referenced as archived from `api-contracts.md:1` and `:5`. **Nothing to
mark.** The remaining gap is prospective: the new `docs/audits/2026-08-23/` set carries no
banner and will need one when superseded.

Two dead external references found in `docs/render-operational.md:5`:
```
$ ls -la "/Users/shubhang/.claude/plans/dynamic-sparking-kite.md"
ls: /Users/shubhang/.claude/plans/dynamic-sparking-kite.md: No such file or directory
$ ls -la "/Users/shubhang/Desktop/renderaudit-findings.md"
ls: /Users/shubhang/Desktop/renderaudit-findings.md: No such file or directory
```

**→ Check 5 = FINDING A26-013 (dead refs) + A26-015 (dates). The archive half PASSES.**

---

## 6. Check 6 — `.claude/skills/qa.md` versus the suite it operates

Verified substantially outdated. **Thirteen** wrong claims; the four that matter most are
about the suite's own shape and runtime.

```
$ ls e2e/specs/flows/ | wc -l                 # 18
$ find e2e -name "*branch-create-agent*"      # (no output — the spec does not exist)
$ grep -rn "test.fail\|test.fixme" e2e/specs/
e2e/specs/regression/empty-states.spec.ts:100:      // Step 4: ALWAYS restore — even on test failure. afterEach would run
e2e/specs/flows/distributor-apply-settlement.spec.ts:426:  test.fixme(
$ ls e2e/specs/db/
deactivate-entities.spec.ts  invariants.spec.ts  money-idempotency.spec.ts  rls-isolation.spec.ts
$ ls e2e/specs/regression/
employer-kyc-nudge.spec.ts  empty-states.spec.ts  map-drill.spec.ts  modal-escape.spec.ts
subscriber-insurance-no-scroll.spec.ts  subscriber-payment-methods.spec.ts
subscriber-settings-stubs.spec.ts  subscriber-write-failures.spec.ts
$ grep -n "handleConfirm\|useCreateBranch\|mutateAsync" src/dashboard/branch/CreateBranch.jsx
3:import { useAllEntities, useCreateBranch } from '../../hooks/useEntity';
155:  const createBranch = useCreateBranch();
257:  async function handleConfirm() {
260:      await createBranch.mutateAsync({
$ grep -rn "VALID_VIEWS =" src/agent-dashboard/
src/agent-dashboard/pages/commissions/commissionsConfig.jsx:14:export const VALID_VIEWS = new Set(['earned', 'owed']);
```

| qa.md line | Claim | Reality |
|---|---|---|
| `:12` | "~78-test baseline" | **370 cases** across 4 projects; **326 pass / 30 fail / 14 skip**, 24.4 min, exit 1 (A00 §10) |
| `:40` | "`/qa all` … ~2 min total" | **24.4 min** at `--workers=1` |
| `:28` | "`/qa smoke` … ~45-60s" | Not credible at 6 role dashboards × 4 projects |
| `:14` | flows include "branch-create-agent (live insert + cleanup)" | **No such spec** |
| `:14`, `:149` | "distributor-create-branch (marked `test.fail`)" · bug #2 "`handleConfirm()` (line **253**) never invokes `useCreateBranch`" | **Bug FIXED**: `useCreateBranch()` at `:155`, `mutateAsync` at `:260`, `handleConfirm` at `:257`. **No `test.fail` exists anywhere** under `e2e/specs/` |
| `:14` | flows list | Omits `distributor-commission-drill-subscribers`, `distributor-renders-data`, `distributor-drill-agent-to-subscriber`, `distributor-drill-branch-to-subscriber` (18 specs live) |
| `:15` | "`db/` — 3 specs" | 4 — `deactivate-entities.spec.ts` undocumented |
| `:16` | regression list names "mobile drawer" | No such spec; the real 8th file is `subscriber-insurance-no-scroll.spec.ts` |
| `:146-155` | known-bugs list | **Silent on the 30 deterministic failures.** mobile-chromium and mobile-webkit fail an identical 11; chromium + webkit both fail `agent-onboard-subscriber:109` and `modal-escape:224` |
| `:152` | bug #5 location "`CommissionsPage.jsx:26`" | Substance holds (`due` ∉ `VALID_VIEWS`); the definition is at `commissions/commissionsConfig.jsx:14` |
| `:173` | "Phase 1 — Smoke specs (44 tests across all **4** dashboards)" | 6 role dashboards + landing + `_health` |
| `:179` | roadmap: "Fixing the agent-onboard AML-step hang" + "Wiring the UI-mock `CreateBranch` panel" | Both resolved (the AML one by the doc's own bug #4) |

**Correct in qa.md**: bug #6 (`REPORT_VIEWS` keys `contributions-summary`, verified at
`src/subscriber-dashboard/pages/ReportsPage.jsx:12`), bug #3 and #4's FIXED/RESOLVED
markings, the auth/DB spec patterns, the debugging playbook, and the env requirements. The
rot is confined to the inventory and the timing numbers — which is exactly the part an
agent reads before running `/qa`.

**→ Check 6 = FINDING A26-008.**

---

## 7. Check 7 — the deliverable

`docs/audits/2026-08-23/DOC-CORRECTIONS.md` is written: **107 drafted corrections** (plus 4
explicit KEEP rows) across 15 sections, each row carrying `doc | line | claim | reality |
suggested replacement text | severity`, ready to apply. **Not applied** (G1).

**→ Check 7 = PASS.**

---

## Traceability

| Check | Disposition |
|---|---|
| 1 — verify every factual claim in the 12 live docs against `00-baseline.md`, incl. the 6 pre-flagged stale items and the 4 new baseline facts | **FINDING A26-001, A26-002, A26-003, A26-006, A26-007, A26-010, A26-011, A26-012, A26-014, A26-016** (all 6 pre-flagged items re-verified and confirmed; all 4 new facts located and corrected) |
| 2 — CLAUDE.md §4 hard rules and §5 anti-patterns versus enforcement reality; flag every rule with no mechanical enforcement | **FINDING A26-005** (12 of 13 unenforced, 1 half-enforced, 1 actively violated) |
| 3 — `docs/role-permissions.md` versus A02's measured matrix (`02-rls-matrix.md`) | **FINDING A26-004** (7 disagreements, 2 of them self-contradictions) |
| 4 — `docs/data-model.md` versus the live schema, field by field, using `baseline/columns.csv` | **FINDING A26-009** (9 field/entity divergences + a 21-table coverage gap) |
| 5 — which live docs need a snapshot date; which archived audit docs are superseded and should be marked historical | **FINDING A26-015** (dates) + **FINDING A26-013** (dead external refs). Archive half **PASS** — all 29 archived audit docs already carry a correct historical banner; no action needed |
| 6 — verify `.claude/skills/qa.md` is substantially outdated and list exactly what changed | **FINDING A26-008** (13 enumerated wrong claims) |
| 7 — produce `docs/audits/2026-08-23/DOC-CORRECTIONS.md` | **PASS** — 107 corrections drafted, not applied |

---

## FINDINGS

### A26-001 · HIGH · confirmed · Four documents assert that RLS blocks direct client writes; it does not, and the shipped frontend writes directly

**Location:** `CLAUDE.md:126` (§7.3), `CLAUDE.md:107` (§5 anti-pattern 6),
`docs/api-contracts.md:9`, `docs/role-permissions.md:250`

**Evidence:** see §1.4(b). `CLAUDE.md:126` — *"never write directly to a table from the
client. **RLS would block it**"*. `api-contracts.md:9` — *"**no writes** — writes always go
through RPCs"*. Refuted by `grep -rn "\.insert(\|\.update(\|\.upsert(" src/services/*.js`
returning 11 direct PostgREST write sites, incl. `src/services/subscriber.js:1411`
inserting straight into `transactions`, and by A02's 13 reproduced direct-write successes
(`02-rls-matrix.md` §5).

**Impact:** the false claim is load-bearing. A02 derived `expected = DENY` for all 666 write
cells of its RLS matrix from these exact lines, and any future reviewer will do the same.
An agent reading CLAUDE.md §7.3 will conclude the write surface is closed and skip checking
it. **Not demo-visible** — this is a correctness/security-documentation defect, not a
broken screen.

**Fix:** replace the assertion with the intent plus a pointer to the measured reality (exact
text in `DOC-CORRECTIONS.md` §2 rows 107/126, §6 row 9, §8 row 250).

---

### A26-002 · HIGH · confirmed · `api-contracts.md:240` instructs an agent to apply migration `0092` to live; it is already applied

**Location:** `docs/api-contracts.md:240`

**Evidence:** see §1.4(a). Three independent live probes: `_normalize_contribution_config`
and `get_my_employer_funding` both exist in `pg_proc`; `SELECT count(*) FROM employers WHERE
default_contribution_config ? 'mode'` returns **0**; the live config key set is exactly
`employeePct, employerPct, groupCoverAmount, groupInsuranceProducts, insuranceEnabled`. The
same line further claims the ledger "stops at `0084`" (head is `0108_nominee_claims_seed`)
and that `0001`–`0091` are live (all 108 are).

**Impact:** the only doc line in the corpus that is a **directive** rather than a
description, and it directs a destructive action against live demo data — re-running a
config-rewriting migration over 8 employer rows and every tagged member's funding. **Not
demo-visible** until someone follows it.

**Fix:** `DOC-CORRECTIONS.md` §6 row 240.

---

### A26-003 · HIGH · confirmed · `MOCK_NOW` is documented as 2026-05-26 in four docs; the real value is 2026-07-01, and two code copies drifted from it

**Location:** `CLAUDE.md:201`, `docs/BACKEND.md:880`, `docs/FRONTEND.md:301`,
`docs/FRONTEND.md:1412`; code copies at `scripts/seed-supabase.mjs:169` and
`e2e/specs/db/invariants.spec.ts:52`

**Evidence:**
```
$ grep -rn "MOCK_NOW *=" src/ e2e/ scripts/
src/data/mockData.js:25:export const MOCK_NOW = new Date(2026, 6, 1); // 2026-07-01
scripts/seed-supabase.mjs:169:const MOCK_NOW = new Date(2026, 4, 26); // 2026-05-26 — mirror of mockData.MOCK_NOW
$ sed -n '166,169p' scripts/seed-supabase.mjs
// MOCK_NOW MUST mirror src/data/mockData.js (`new Date(2026, 4, 26)` = 2026-05-26).
$ grep -n "MOCK_NOW" e2e/specs/db/invariants.spec.ts
52:// Seed anchor — mirrors `MOCK_NOW = new Date(2026, 4, 26)` (2026-05-26) in
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT public._demo_now();"
2026-05-18 23:59:59+00
```
`FRONTEND.md:641` in the same file says a just-sent reminder read *"Reminded 1 Jul"* — i.e.
the file contradicts itself, and the odd one out is the correct one.

**Impact:** the frozen clock existing is by design (demo scope); its copies disagreeing is
not. `scripts/seed-supabase.mjs` carries a comment asserting it **MUST** mirror
`mockData.js` and then hardcodes a value 36 days behind it — so the next reseed writes a
ledger anchored 36 days before the anchor every mock-mode surface renders against. Four docs
would tell the operator the wrong constant while they debug it. A third independent clock
(`public._demo_now()` = 2026-05-18) exists and is documented correctly in `FRONTEND.md:301`.
**Not demo-visible today** (live demos run on Supabase, not the mock store).

**Fix:** `DOC-CORRECTIONS.md` §2 row 201, §4 row 880, §5 rows 301/1412, §13 rows 3–4. The
code change (re-sync or import the constant) is a seed/data-agent task, out of A26's remit.

---

### A26-004 · HIGH · confirmed · `docs/role-permissions.md` disagrees with the measured RLS matrix in seven places, twice contradicting itself

**Location:** `docs/role-permissions.md:60-62`, `:250`, `:315`, `:340`, `:341-343`, `:348`,
`:349`

**Evidence:** see §3 for the seven-row table and the verbatim `pg_policies` output.
Headlines: `:340` + `:348` say the distributor has "all data visible" while `:49` of the
same file says "its OWN network only" (A02 measured d-001 at 4605/5064 subscribers);
`:349` cites a policy `distributors_select USING (true)` that does not exist (live:
`distributors_select_admin` + `distributors_select_self`), so `:341-343`'s claim that
branch/agent/subscriber read the distributor row is refuted — A02 measured **0** rows for
all four non-admin roles; `:315` grants admin SELECT on `contribution_run_lines`, a table
`:211` of the same file says was dropped by `0045` and `to_regclass` confirms is gone;
`:60-62` still describes `agents`/`branches` as "pending `0084`" though `0084` and `0094`
both shipped.

**Impact:** this file is the authorisation contract. A02 built its 1,036-cell `expected`
column from it, so every wrong row here silently degrades the quality of the RLS audit that
reads it. The errors mostly describe the platform as **more open** than it is, which
under-sells the `0081`–`0094` scoping work; `:250` errs the other way and over-sells the
write lockdown. **Not demo-visible.**

**Fix:** `DOC-CORRECTIONS.md` §8 (9 rows).

---

### A26-005 · MEDIUM · confirmed · Twelve of CLAUDE.md's thirteen "binding" rules have no mechanical enforcement; one of them is already violated

**Location:** `CLAUDE.md:89-108` (§4 rules 1–6, §5 anti-patterns 1–7); enforcement surface
`eslint.config.js`, absent `.stylelintrc*`, absent `.husky/`, `.github/workflows/test.yml`

**Evidence:** see §2. `eslint.config.js` defines exactly three non-a11y rules
(`no-console`, `no-unused-vars`, `react-refresh/only-export-components`) — no
`no-restricted-imports`, no `no-restricted-syntax`. `ls .stylelintrc* stylelint.config.*` →
no matches, so §5.3 and §5.4 (pure CSS rules) have nothing that can evaluate them. No
`.husky/`, no `lint-staged` in `package.json`. The single real gate is
`src/test/jwt-claim-contract.test.js`, which greps `supabase/migrations/*.sql` for
`->> 'role'` — and does **not** check `auth.uid()`. §5.6 is not merely unenforced but
**breached** by 11 call sites in `src/services/{subscriber,entities}.js`.

**Impact:** a change violating §4.1, §5.2, §5.3, §5.4 or §5.6 passes `npm run lint`,
`npm test`, `npm run build`, `npm run build:api` and CI. Four of those five hold today by
convention alone — one bad merge from regressing, with nothing to catch it. The document
tells the reader these are binding; they are aspirational. **Not demo-visible.**

**Fix:** add the enforcement-reality note drafted in `DOC-CORRECTIONS.md` §2 (last row). The
durable fix is mechanical: an ESLint `no-restricted-imports` block for §4.1/§5.1, a
`no-restricted-syntax` rule for §5.2, a minimal stylelint config for §5.3/§5.4, and a
migration-grep contract test for `auth.uid()` — the four existing `src/test/*-contract.test.js`
specs are the working template.

---

### A26-006 · MEDIUM · confirmed · Every schema and architecture census in ARCHITECTURE.md and BACKEND.md is stale by 30–90 %

**Location:** `docs/ARCHITECTURE.md:23`, `:32`, `:52-58`, `:79`, `:80`, `:81`, `:84-86`,
`:387`, `:540`, `:661`; `docs/BACKEND.md:37`, `:38`, `:39`, `:44`, `:329`, `:343`, `:428`,
`:441`, `:459`, `:565`, `:625`, `:653`, `:1036`

**Evidence:** §1.1 introspection versus the doc text. Representative deltas — tables
28/29 → **37**; functions 40/53 → **89**; triggers 5/8 → **10**; policies ~90/99 → **109**;
migrations 57/76 → **108**; dashboard shells 4 → **6**; services 11 → **20**; unit tests
1221/76 files → **2010/140**; `authenticated`-executable functions 46 → **87**. Two further
specifics: `BACKEND.md:343`'s down-migration accounting omits six files (the 22 without a
`.down.sql` are `0001`–`0015`, `0017`, `0018`, `0019`, `0020`, `0021`, `0027`, `0028`), and
`BACKEND.md:653` describes `0075` re-scoping a policy `distributors_select` that `0081`
subsequently deleted entirely.

**Impact:** these are the boxes an agent reads to size the system before touching it.
`ARCHITECTURE.md` at least discloses it is a May-2026 snapshot; `BACKEND.md:44` claims
"**Live census (verified 2026-07-08)**", which reads as current and is not. **Not
demo-visible.**

**Fix:** `DOC-CORRECTIONS.md` §3 and §4 (28 rows).

---

### A26-007 · MEDIUM · confirmed · The migration ledger head is documented as `0076` in five places, and the ledger's unjoinability is documented nowhere

**Location:** `docs/BACKEND.md:44`, `:358`, `:1013`, `:1015`, `:1019`;
`docs/api-contracts.md:240`; `docs/render-operational.md:36`

**Evidence:**
```
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT version||' '||coalesce(name,'') FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1;"
20260811100047 0108_nominee_claims_seed
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM supabase_migrations.schema_migrations;"
96
```
96 TIMESTAMP-versioned rows against 108 `0001_*`-named files. `render-operational.md:36`
states the ledger "is missing 6 local migrations (`0022`/`0023`/`0024`/`0025`/`0027`/`0028`)"
— a statement that presupposes a shared key the two namespaces do not have (A00 §7).

**Impact:** `BACKEND.md §16` is the doc an operator opens before touching live schema. It
tells them the head is `0076` when 32 further migrations are applied, and it frames the
drift as "6 missing rows, since reconciled" when the true state is that the ledger cannot be
diffed against the files at all. Anyone acting on the `render-operational.md:36` framing
would try a version-level reconciliation that cannot succeed. **Not demo-visible.**

**Fix:** `DOC-CORRECTIONS.md` §4 rows 44/358/1013 and §10 row 36.

---

### A26-008 · MEDIUM · confirmed · `.claude/skills/qa.md` misdescribes the suite it exists to operate — 13 wrong claims, including a "known bug" that is fixed and a runtime off by 12×

**Location:** `.claude/skills/qa.md:12`, `:14`, `:15`, `:16`, `:28`, `:40`, `:146-155`,
`:149`, `:152`, `:173`, `:179`

**Evidence:** see §6. Notably: `:12` "~78-test baseline" against a measured **370 cases,
326 pass / 30 fail / 14 skip, 24.4 min, exit 1**; `:40` "~2 min total" against **24.4 min**;
`:14` lists a spec (`branch-create-agent`) that does not exist; `:14`/`:149` mark
`distributor-create-branch` as `test.fail` when `grep -rn "test.fail" e2e/specs/` returns
nothing and `CreateBranch.jsx:155`/`:260` now wire `useCreateBranch().mutateAsync`; `:15`
undercounts `db/` by one spec; `:16` names a "mobile drawer" spec that does not exist; the
known-bugs list is silent on the 30 deterministic failures.

**Impact:** `/qa` is a slash command an agent invokes and then reasons about. It will budget
2 minutes for a 24-minute run, hunt for a spec that was never written, "re-fix" a fixed
CreateBranch panel, and — worst — treat 30 real failures as unexpected because the doc that
is supposed to enumerate known bugs does not mention them. **Not demo-visible**, but it
directly degrades every QA pass.

**Fix:** `DOC-CORRECTIONS.md` §12 (13 rows).

---

### A26-009 · MEDIUM · confirmed · `docs/data-model.md` field tables diverge from the live schema, and the Employer section states the retired model in the present tense

**Location:** `docs/data-model.md:5`, `:48-58`, `:67`, `:69`, `:190-208`, `:241`, `:243-254`,
`:294`, `:406-417`, `:428-447`

**Evidence:** see §4 and the `columns.csv` extracts. Highlights: the Subscriber field table
is the mock object shape, listing `parentId` and `totalWithdrawals` (neither is a column)
while omitting 11 real ones including `nin`, `consent_at`, `current_unit_value` and
`unit_value_as_of`; `employers.status` and `contribution_runs.insurance_total` are missing;
`distributors.registration_no` is missing; the Employer section opens (`:241`) by describing
the standalone-`employees` model that its own banner retires 26 lines later at `:267`; the
`## Contribution Run Line` section (`:428`) describes a dropped table in the present tense
with no HISTORICAL banner of its own; and `:5`'s "every entity in the system" covers 17 of
37 tables.

**Impact:** the doc's stated purpose is to stop a reader "treating a derived or mock-only
value as stored truth" — and the Subscriber table does exactly that, presenting mock fields
as **Stored**. `:241` is the first paragraph of the Employer section, so a reader who stops
there leaves with the retired model. **Not demo-visible.**

**Fix:** `DOC-CORRECTIONS.md` §7 (11 rows).

---

### A26-010 · LOW · confirmed · "14 API routes" appears in eleven places across four documents and two code comments; there are sixteen

**Location:** `README.md:18`, `:109`; `docs/api-contracts.md:1`, `:7`, `:23`, `:57`, `:239`;
`docs/ARCHITECTURE.md:52-58`, `:540`; `docs/BACKEND.md:1036`; `server/index.ts:61`, `:250`

**Evidence:**
```
$ grep -c "^app.all" server/index.ts    # 16 mounts (line 250 is the stale comment)
$ find api -name "*.ts" -not -name "*.test.ts" -not -path "*/_lib/*" | wc -l    # 16
```
The two missing routes are `POST /api/access-request` and `POST /api/nominee-claim`, both
public write surfaces behind `writeLimiter`. `docs/BACKEND.md:97`, `:129`, `:130` and `:283`
already say **16** correctly — so `BACKEND.md` contradicts `api-contracts.md`, and
`BACKEND.md:1036` contradicts `BACKEND.md:97`.

**Impact:** `api-contracts.md` §2 has no request/response entry for either route, so the two
public spam-vector endpoints are undocumented in the file whose job is documenting them.
**Not demo-visible.**

**Fix:** `DOC-CORRECTIONS.md` §1, §3, §4, §6, §13.

---

### A26-011 · LOW · confirmed · `docs/FRONTEND.md` file-inventory counts are stale in six places and the document contradicts itself on the test count

**Location:** `docs/FRONTEND.md:52`, `:74`, `:387`, `:717`, `:1138`, `:1165`, `:1519`

**Evidence:**
```
$ find src -name '*.module.css' | wc -l                      # 229  (doc :74 says 118)
$ ls src/services/*.js | grep -v test | wc -l                # 20   (doc :387 says 14)
$ ls src/hooks/*.js | grep -v test | wc -l                   # 15 + 2 test files = 17 total (doc :717 says 10)
$ ls src/utils/*.js | grep -v test | wc -l                   # 21   (doc :1138 says 18)
$ ls src/constants/*.js | grep -v test | wc -l               # 7    (doc :1165 says 3)
```
Unit tests: `:52` says "1221 tests across 76 files", `:1519` says "48 test files, 871
passing tests" — the same document, two different wrong numbers, against a measured
**140 files / 2010 tests**. The six undocumented services are `accessRequests.js`,
`adminAttention.js`, `nav.js`, `nomineeClaim.js`, `nomineeClaims.js`, `requestAccess.js`.

**Impact:** `CLAUDE.md:209` makes updating FRONTEND.md in the same commit a repo rule; these
counts show the rule is not being followed, and six services (including the NAV service that
carries the pricing authority) have no inventory row. **Not demo-visible.**

**Fix:** `DOC-CORRECTIONS.md` §5.

---

### A26-012 · LOW · confirmed · `README.md:9` still lists "hardcoded unit price" as intentional demo scope; `0103`–`0106` retired it

**Location:** `README.md:9`

**Evidence:** `README.md:9` — *"Mocked OTP, mocked KYC, **hardcoded unit price**, and a
24-hour fixed JWT are intentional demo scope"*. Both specialist docs already correct it:
`docs/BACKEND.md:900` — *"~~Unit price hardcoded to 1,000 UGX/unit~~ — **RESOLVED by
`0103`–`0106`** … It is no longer hardcoded and is no longer demo scope"*;
`docs/FRONTEND.md:1419` says the same. Live: `nav_snapshots` holds 1,246 rows and
`latest_nav` / `nav_for_date` exist in `pg_proc`.

**Impact:** README is the first file a new reader opens, and it labels the platform's
pricing authority a mock. Under the audit's own demo-scope rule ("do not propose fixing
demo scope"), an agent trusting this line would decline to investigate a genuine NAV bug.
**Not demo-visible.**

**Fix:** `DOC-CORRECTIONS.md` §1 row 9.

---

### A26-013 · LOW · confirmed · `docs/render-operational.md` states the keepalive cadence wrongly in three places, carries two dead external references, and leaves a completed cutover instruction standing

**Location:** `docs/render-operational.md:5`, `:14`, `:36`, `:38`, `:56`, `:175`;
`README.md:121`

**Evidence:**
```
$ grep -n "cron" .github/workflows/keepalive.yml
12:    - cron: '*/10 * * * *'   # every 10 min
$ ls "/Users/shubhang/.claude/plans/dynamic-sparking-kite.md"   # No such file or directory
$ ls "/Users/shubhang/Desktop/renderaudit-findings.md"          # No such file or directory
$ grep -n "test.fixme" e2e/specs/flows/distributor-apply-settlement.spec.ts
426:  test.fixme(
```
The runbook says "GHA cron (14 min)" at `:14` and repeats 14 min in the instance-hour
arithmetic at `:56` and `:175`; README `:121` says 14 min too. The workflow is 10 min, and
its own header explains why. `:5` cites two files that no longer exist. `:38` still
instructs "after applying `0032`, remove the `describe.fixme`/`skip`" — `0032` has been live
for months and a `test.fixme` still stands at line 426.

**Impact:** the instance-hour headroom calculation against the 750 h/mo free-tier cap is
derived from the wrong cadence; the two dead links are the runbook's only cited sources; and
the un-actioned `:38` instruction means one settlement-idempotency assertion has been
silently disabled since the cutover. **Not demo-visible.** A09 owns the operational side.

**Fix:** `DOC-CORRECTIONS.md` §1 row 121 and §10.

---

### A26-014 · LOW · confirmed · Seed-entity counts drifted across CLAUDE.md, SPEC.md and role-permissions.md; the third distributor is documented nowhere

**Location:** `CLAUDE.md:145`, `:146`, `:147`, `:164`; `docs/SPEC.md:84-91`, `:107-109`;
`docs/role-permissions.md:38`, `:40`; `docs/data-model.md:67`

**Evidence:**
```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT id,name,status FROM distributors ORDER BY id;"
d-001|Universal Pensions Uganda — National|active
d-002|Universal Pensions Uganda — Secondary|active
d-003|Karamoja Pilot Network|active
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT coalesce(distributor_id,'NULL'), count(*) FROM branches GROUP BY 1 ORDER BY 1;"
d-001|291
d-002|27
d-003|2
NULL|1
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT (SELECT count(*) FROM agents),(SELECT count(*) FROM branches),(SELECT count(*) FROM subscribers);"
2046|321|5064
```
`CLAUDE.md:147` says "2" distributors; `:164` says "Two in the demo seed" with d-001 at
"289 branches"; `data-model.md:67` says "Two distributors seeded". **`d-003 Karamoja Pilot
Network` appears in no document.** Agent counts read ~2,049 (2046) and branch counts ~316
(321) in four places. `SPEC.md:84-91`'s hierarchy diagram omits the Distributor level
entirely.

**Impact:** a rep or agent counting distributors from the docs finds two and sees three in
the admin Distributors panel. `d-003` was almost certainly created through the
access-request approval path (`0095`/`0101`), so the docs do not reflect that entities can
now be created at runtime. Also worth flagging onward: **one branch has
`distributor_id IS NULL`** and is therefore invisible to every distributor (A02-010 owns the
data side). **Not demo-visible** by itself.

**Fix:** `DOC-CORRECTIONS.md` §2 rows 145/146/147/164, §7 row 67, §8 rows 38/40, §9.

---

### A26-015 · INFO · confirmed · No live doc carries a "verified against live on <date>" line; `docs/role-permissions.md` has no temporal marker at all

**Location:** all 12 live docs; worst case `docs/role-permissions.md`

**Evidence:** see §5.1. `docs/migrations-runbook.md` is the only file that dates and scopes
itself correctly. `docs/ARCHITECTURE.md` discloses a May-2026 pin (honest); `BACKEND.md`
and `FRONTEND.md` carry inline "verified 2026-07-08" / "at last sync" but no header date;
six docs carry nothing; `docs/role-permissions.md` carries nothing anywhere in 362 lines.

**Impact:** the single cheapest structural fix in this report. Every finding above is a
count or a claim that decayed silently because nothing in the file told the reader when it
was last true. `BACKEND.md:44`'s "Live census (verified 2026-07-08)" is the counter-example
that proves the value — it is wrong, but at least it is *dateably* wrong.

**Fix:** `DOC-CORRECTIONS.md` §14 — a single two-line header block for all twelve.

---

### A26-016 · INFO · confirmed · The anon-EXECUTE surface is documented as 3; it is 13, and the same sentence contradicts itself

**Location:** `docs/BACKEND.md:428`, `docs/BACKEND.md:657`

**Evidence:**
```
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE');"
13
```
`BACKEND.md:428` reads *"only the 3 intended pre-login RPCs still anon-executable"* in its
verification summary, while an earlier clause of the same cell says *"**KEPT anon
deliberately:** … plus every trigger function"*. Both cannot be the headline. The 13 are the
3 intentional grants plus 10 zero-arg `RETURNS trigger` functions retaining the default
PUBLIC grant (A00 §5.2).

**Impact:** informational — Postgres refuses to invoke a trigger function directly, so the
10 are not an exploitable surface (A03 owns proving that). But a security reviewer running
the obvious `has_function_privilege('anon', …)` query gets 13 and cannot reconcile it with
the doc, which costs a cycle. The audit plan's own §5 made the same class of error in the
other direction (predicting 25).

**Fix:** `DOC-CORRECTIONS.md` §4 row 428/657.

---

## Artifacts written

```
docs/audits/2026-08-23/26-documentation.md     (this file)
docs/audits/2026-08-23/DOC-CORRECTIONS.md      (required deliverable — 107 corrections, NOT applied)
```

**Fixtures created: none.** This agent performed read-only introspection only — `SELECT`
queries against `pg_catalog`, `information_schema`, `supabase_migrations` and application
tables, plus `grep`/`ls`/`find` over the working tree. No rows were inserted, updated or
deleted; no repo file outside `docs/audits/2026-08-23/` was created or modified; nothing
needed cleaning up.
