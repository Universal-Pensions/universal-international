# A08 · RPC & PostgREST contract conformance

**Agent:** A08 · **Date:** 2026-08-23 · **Mode:** REPORT-ONLY
**Baseline cited:** `docs/audits/2026-08-23/00-baseline.md` (89 live functions, 13 anon-EXECUTE,
70 DEFINER all with pinned `search_path`, 16 API routes, `n_live_tup` unusable).

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | **181** — 20 `src/services/*.js` · 16 `src/hooks/*.js` · 89 live `pg_proc` functions · 38 relations (37 tables + 1 view) in `information_schema.columns` · 16 `api/` routes · `docs/api-contracts.md` · `server/index.ts` |
| Artifacts examined | **181** (plus a full 610-file walk of `src/**` for call sites) |
| Coverage | **100%** |
| Checks defined | **27** (spec checks 1–7, decomposed) |
| Checks executed | **27** |
| Checks passed / failed / blocked | **19 / 8 / 0** |
| Findings C / H / M / L / I | **1 / 0 / 0 / 5 / 3** |
| Evidence commands run | **48** |
| Excluded as demo-scope | **2** — (a) `VITE_USE_SUPABASE=false` being a break-glass rollback rather than a demo default; (b) mocked KYC / OTP / chat request-response shapes (`api/kyc/_lib/mocks.ts`) |
| Blocked, with reason | **none** |

### Domain metrics (required by spec)
| Metric | Value |
|---|---|
| RPC call sites found | **55** (55 distinct names — no name is called twice) |
| RPC call sites verified | **55 / 55** |
| RPC call sites mismatched | **0** — zero missing functions, zero unknown arg names, zero missing required args |
| Frontend calls to the 19 dropped `0021`-family names | **0** |
| `.select()` statements parsed | **38** (36 inline literals + 2 constant-indirected, both resolved) |
| Column references verified | **106** statically + **30** selects re-verified by live HTTP GET |
| Invalid column references | **0** |
| Embeds verified | **18** (+ `LEVEL_LIST_COLUMNS` / `MEMBER_SELECT` live-probed) |
| Invalid embeds | **0** |
| Filter/order columns verified | **56 / 56** |
| Mock-vs-live shape diffs | **2 confirmed** (A08-001, A08-005) |
| Import-boundary violations | **0** (and **0** lint rules enforcing it) |
| PostgREST live probes issued | **148** (55 RPC-resolution + 26 read-RPC executions + 10 attention types + 34 select/order + 23 cap/pagination) |

**No fixture rows were created and nothing was written.** Every live probe was a `GET`, a
`HEAD`, or a POST to an RPC that is either (a) `provolatile='s'` (STABLE — cannot write) or
(b) deliberately malformed so PostgREST rejects it at signature resolution and the body never
runs. No `INSERT`/`UPDATE`/`DELETE` was issued and no write RPC was executed.

### Scripts (evidence, re-runnable)
| Path | What it does |
|---|---|
| `docs/audits/2026-08-23/a08-contract-check.mjs` | Static: parses every `.rpc()` / `.from().select()...` chain in `src/**` and cross-checks against live introspection. Output → `a08-contract-report.json` |
| `docs/audits/2026-08-23/a08-live-probe.mjs` | Live: RPC signature resolution (bogus-arg probe) + SELECT column validity + row-cap probe → `a08-live-probe.json` |
| `docs/audits/2026-08-23/a08-live-probe2.mjs` | Live: constant-indirected selects (`LEVEL_LIST_COLUMNS`, `MEMBER_SELECT`) + every `.order()` column → `a08-live-probe2.json` |
| `docs/audits/2026-08-23/a08-live-probe3.mjs` · `4.mjs` | Live: `getEntityPage`'s `count=estimated` semantics vs `exact` / `planned` |
| `docs/audits/2026-08-23/a08-live-probe5.mjs` | Live: reproduces `getAllAtLevel`'s parallel unordered `range()` fan-out and tests for duplicate/skipped rows |
| `docs/audits/2026-08-23/a08-live-probe6.mjs` | Live: executes all 26 STABLE read RPCs with the frontend's real args, as the calling role → `a08-rpc-shapes.json` |
| `docs/audits/2026-08-23/a08-live-probe7.mjs` | Live: all 10 `get_admin_attention_rows` drill types |
| `docs/audits/2026-08-23/a08-live-probe8.mjs` | Live: proves the subscriber list-path row carries no `total_contributions` |
| `docs/audits/2026-08-23/a08-live-probe9.mjs` | Live: role-gate matrix (branch/agent/subscriber/employer × role-gated RPCs) |
| `docs/audits/2026-08-23/a08-mock-parity.mjs` | Static mock-vs-live return-shape extractor → `a08-mock-parity.json` (noisy; used only to generate candidates, every candidate manually confirmed or discarded) |
| `docs/audits/2026-08-23/baseline/a08-functions.txt` | 89 live functions: identity args, full args w/ defaults, result type, SECDEF, anon/auth/svc EXECUTE |
| `docs/audits/2026-08-23/baseline/a08-fk.txt` | 30 live foreign keys (the embed graph) |

---

## 1. Headline: the RPC/PostgREST surface is clean; the *derived* money field is not

The high-yield hypothesis this agent was sent to test — "one bad column blanks a whole screen" —
**does not fire anywhere.** All 55 RPC call sites resolve; all 106 column references exist; all 18
embeds resolve through real FKs; all 56 filter/order columns exist; and a live HTTP probe of every
resolvable `.select()` returned **200, not one 400**.

```
$ node docs/audits/2026-08-23/a08-contract-check.mjs
{
  "filesScanned": 610,
  "rpcSites": 55,
  "rpcOk": 55,
  "rpcMissingLive": 0,
  "rpcArgMismatch": 0,
  "rpcMissingRequired": 0,
  "selectSites": 38,
  "selectDynamic": 2,
  "colRefsVerified": 106,
  "colIssues": 0,
  "embedsVerified": 18,
  "embedIssues": 0,
  "filterSites": 56,
  "filtersVerified": 56,
  "filterIssues": 0,
  "orderIssues": 0,
  "writeSites": 12
}

--- RPC PROBLEMS ---
(none)
--- COLUMN ISSUES ---
(none)
--- EMBED ISSUES ---
(none)
--- FILTER ISSUES ---
(none)
--- ORDER ON UNINDEXED ---
(none)
```

The one real data-correctness defect is one layer up: a **mapper** that reads two columns which
exist on no live table, silently yielding `0`, and a report that renders that `0` as money.

---

## 2. Check 1 — every RPC exists, matches, and is callable by the caller's role

### 2.1 The dropped `0021` family is not referenced anywhere (highest-value single query)

```
$ for f in agent_confirm_commission agent_dispute_line approve_dispute branch_approve_all \
    branch_approve_line branch_dispute_line branch_hold_line cancel_run get_run_branch_breakdown \
    mark_branch_reviewed open_run reject_dispute release_branch release_run \
    submit_contribution_run withdraw_dispute trg_commissions_before_update \
    update_employee_contribution_config update_employee_insurance; do
    echo "$f : $(grep -rn "$f" src api server e2e 2>/dev/null | grep -v 'scripts/.baseline' | wc -l | tr -d ' ')"
  done
agent_confirm_commission : 0
agent_dispute_line : 1
approve_dispute : 0
branch_approve_all : 0
branch_approve_line : 0
branch_dispute_line : 0
branch_hold_line : 0
cancel_run : 0
get_run_branch_breakdown : 0
mark_branch_reviewed : 0
open_run : 0
reject_dispute : 0
release_branch : 0
release_run : 0
submit_contribution_run : 0
withdraw_dispute : 0
trg_commissions_before_update : 0
update_employee_contribution_config : 0
update_employee_insurance : 0

$ grep -rn "agent_dispute_line" src api server e2e
e2e/specs/db/invariants.spec.ts:41://      `agent_dispute_line` probe — that RPC was removed by 0029 line 55).
```

The single hit is a comment. **PASS — no guaranteed-runtime-failure call site exists.**

### 2.2 Argument names and types match the live identity args

Every one of the 55 sites passes an object whose keys are a subset of the live parameter names,
with every non-defaulted parameter supplied. Two sites deserve explicit note because they look
like mismatches and are not:

- `src/services/employer.js:628` `create_employer` passes 7 of 9 params. The other two carry
  `DEFAULT`s — see A08-005 for the consequence.
- `src/services/employer.js:907` `update_employer_profile` passes a **variable** `args` object
  (`{ p_patch }`, conditionally `+ p_insurance_enabled + p_group_cover`). All three names are real;
  `p_group_cover` / `p_insurance_enabled` both `DEFAULT NULL`.

```
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT proname||' :: '||pg_get_function_arguments(oid) FROM pg_proc WHERE proname IN ('create_employer','update_employer_profile','create_distributor','get_employer_invite');"
create_distributor :: p_name text, p_manager_name text DEFAULT NULL::text, p_manager_phone text DEFAULT NULL::text, p_manager_email text DEFAULT NULL::text, p_parent_id text DEFAULT 'ug'::text, p_registration_no text DEFAULT NULL::text
create_employer :: p_name text, p_sector text DEFAULT NULL::text, p_registration_no text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_district text DEFAULT NULL::text, p_payroll_cadence text DEFAULT NULL::text, p_default_contribution_config jsonb DEFAULT '{}'::jsonb
get_employer_invite :: p_token text
update_employer_profile :: p_patch jsonb, p_group_cover numeric DEFAULT NULL::numeric, p_insurance_enabled boolean DEFAULT NULL::boolean
```

### 2.3 PostgREST's schema cache resolves all 55 (not just `pg_proc`)

A function present in `pg_proc` but absent from PostgREST's schema cache is a runtime 404. Probed
all 55 with a deliberately bogus argument (`{"__a08_probe__":1}`), which forces signature
resolution without executing the body — safe for write RPCs:

```
$ node docs/audits/2026-08-23/a08-live-probe.mjs | head -20
=== RPC PROBES (PGRST202 expected; anything else is notable) ===
RESOLVED  list_access_requests      role=admin       http=404 code=PGRST202
RESOLVED  approve_access_request    role=admin       http=404 code=PGRST202
...
RESOLVED  create_subscriber_from_agent_onboard  role=subscriber  http=404 code=PGRST202
(55/55 RESOLVED)
```

### 2.4 EXECUTE-ability by the calling role — proven by execution, not inference

The JWT always carries the Postgres role `authenticated` (`api/_lib/jwt.test.ts:74-76`: *"`role`
is the Postgres role for PostgREST SET ROLE — always literal 'authenticated', NOT the application
role"*); the application role lives in `app_role`. So there are two gates: the GRANT, and the
in-function `app_role` check.

- **GRANT gate:** 52 of 55 are `authenticated`-executable and called post-login; the 3 that are
  called pre-login (`create_subscriber_from_signup`, `get_employer_invite`,
  `create_subscriber_from_employer_invite`) are exactly the 3 intentional anon grants the baseline
  identified. **PASS.**
- **`app_role` gate:** all 26 STABLE read RPCs were **executed as the role that calls them** and
  all returned HTTP 200:

```
$ node docs/audits/2026-08-23/a08-live-probe6.mjs
http=200 get_admin_attention        role=admin       keys=["asOf","today","delayedNav","thresholds","reconciliation","inactiveBranches","delayedWithdrawals","dormantSubscribers","pendingAccessRequests","delayedCustodyTransfers","delayedInsurancePayouts","delayedEmployerTransfers","underperformingDistributors"]
http=200 get_commission_summary     role=distributor keys=["countDue","totalDue","countPaid","totalPaid","countTotal","totalCommissions"]
http=200 get_employer_metrics       role=employer    keys=["active","headcount","suspended","employeeYtd","employerYtd","insuredCount","totalBalance","ownContributions","totalContributions","employerContributions"]
http=200 get_nav_overview           role=admin       keys=["aum","series","fundCode","changeAbs","changePct","growthPct","currentNav","pendingDays","previousNav","totalGrowth","avgGrowthPct","firstNavDate","unitsInIssue","membersPriced","totalInvested","currentNavDate","publishedCount","membersUnpriced","previousNavDate","membersWithBasis","lastPublishedDaysAgo"]
http=200 get_my_employer_funding    role=subscriber  keys=["scalar:object:null"]
... (26/26 HTTP 200; full capture in a08-rpc-shapes.json)
```

For write RPCs (which must not be executed) the gate was read out of `pg_proc.prosrc` and matched
against the dashboards that mount each hook. Every gate matches its caller — full matrix in §6.

### 2.5 The one polymorphic argument that *can* be wrong: `get_admin_attention_rows(p_type)`

All 10 `ATTENTION_TYPES` probed live:

```
$ node docs/audits/2026-08-23/a08-live-probe7.mjs
http=200 p_type=dormantSubscribers          rows=50 keys=id,date,href,count,dueBy,amount,status,primary,daysLate,secondary,recipientId,recipientName,recipientRole
http=200 p_type=delayedEmployerTransfers    rows=4  ...
http=200 p_type=delayedNav                  rows=4  ...
http=400 p_type=pendingComplaints           {"code":"P0001","details":null,"hint":null,"message":"unknown attention type pendingComplaints"}
http=200 p_type=pendingAccessRequests       rows=4  ...
http=200 p_type=underperformingDistributors rows=1  ...
http=200 p_type=delayedInsurancePayouts     rows=12 ...
http=200 p_type=delayedWithdrawals          rows=15 ...
http=200 p_type=delayedCustodyTransfers     rows=4  ...
http=200 p_type=reconciliation              rows=7  ...
```

`pendingComplaints` 400s — **but it is unreachable.** `src/admin-dashboard/attention/attentionMeta.js`
has no entry for it, and `useAttentionDrill.js:29-30` disables the query for an unknown type
(*"Query stays disabled for an unknown type, so a bad route param costs nothing"*), with
`useAdminAttention.js:41 enabled: Boolean(type)`. Ticketing is routed to its own panel via
`REUSES_EXISTING_PANEL`. **Not a finding.**

---

## 3. Checks 2 + 3 — columns and embeds (the LEVEL_LIST_COLUMNS failure class)

### 3.1 Constant-indirected selects — the two my static parser could not inline

Both resolved and live-probed:

- `LEVEL_LIST_COLUMNS` (`src/services/entities.js:242-263`) — the projection used by
  `getChildren` / `getAllAtLevel` / `getEntityPage`.
- `MEMBER_SELECT` (`src/services/employer.js:363-364`) — the employer roster read.

```
$ node docs/audits/2026-08-23/a08-live-probe2.mjs
OK   http=200 LEVEL_LIST_COLUMNS regions      role=admin
OK   http=200 LEVEL_LIST_COLUMNS districts    role=admin
OK   http=200 LEVEL_LIST_COLUMNS subscribers  role=admin
OK   http=200 LEVEL_LIST_COLUMNS distributors role=admin
OK   http=200 LEVEL_LIST_COLUMNS branches     role=admin
OK   http=200 LEVEL_LIST_COLUMNS agents       role=admin
... (same 6 × distributor, × branch — 18/18 200)
OK   http=200 MEMBER_SELECT subscribers role=employer
OK   http=200 ORDER subscribers.registered_date role=admin
OK   http=200 ORDER transactions.date role=subscriber
... (14/14 order probes 200)
```

### 3.2 `subscriber_balances` embed hygiene — check 3's named invariant

Live column list is exactly the 6 the spec names:

```
$ grep '^subscriber_balances,' docs/audits/2026-08-23/baseline/columns.csv | cut -d, -f2
subscriber_id
retirement_balance
emergency_balance
total_balance
units
updated_at
```

Every embed of it in `src/**` names only members of that set — `subscriber_balances(*)`,
`subscriber_balances(total_balance)`, `subscriber_balances(total_balance, retirement_balance,
emergency_balance)`. **0 invalid.** The historical `total_contributions` / `total_withdrawals`
trap has been removed from every `.select()` string (verified by grep — the only remaining hits are
comments *and* the mapper in A08-001).

### 3.3 Embed ambiguity

All 30 FKs enumerated (`baseline/a08-fk.txt`). No table has two FKs pointing at the same target
table, so no embed in `src/**` is ambiguous and none needs a `!constraint` disambiguator.

---

## 4. Check 4 — filters, ordering, and the measured PostgREST row cap

`db-max-rows` is **1000** on this project — measured, not assumed:

```
$ node docs/audits/2026-08-23/a08-live-probe4.mjs
limit=10     estimated -> 0-9/1001      exact -> 0-9/5081      planned -> 0-9/51
limit=100    estimated -> 0-99/1001     exact -> 0-99/5081     planned -> 0-99/51
limit=1000   estimated -> 0-999/1001    exact -> 0-999/5081    planned -> 0-999/51
limit=(none) estimated -> 0-999/1001    exact -> 0-999/5081    planned -> 0-999/51
```

An over-cap read returns **HTTP 206 + `Content-Range: 0-999/N`**, and `postgrest-js` does **not**
throw on 206 — it hands back a silently truncated array. Every unbounded `.from().select()` in
`src/services/` was therefore measured against its live worst case:

| Call site | Scope filter | Live max rows | Headroom |
|---|---|---|---|
| `employer.js:560` `getEmployerContributions` | RLS (employer) + `type` + `run_id NOT NULL` | **178** (emp-001) | 5.6× |
| `employer.js:397/433` roster `MEMBER_SELECT` | `.eq('employer_id')` | **21** | 47× |
| `employer.js:488` run lines | `.eq('contribution_run_id')` | **57** | 17× |
| `commissions.js:283/291` | `.eq('agent_id')` | **14** | 71× |
| `agent.js:168/219` | `.eq('agent_id')` | **26** | 38× |
| `subscriber.js:519/583` | `.eq('subscriber_id')` | **107** | 9.3× |
| `notifications.js:95/131` | RLS (recipient) | **4** | 250× |
| `commissions.js:421` `settlement_batches` | RLS | **5** | 200× |
| `entities.js` list paths | `.range()` PAGE_SIZE 1000 + `count:'exact'` fan-out | paged correctly | — |

```
$ node docs/audits/2026-08-23/a08-live-probe2.mjs   # tail
=== unbounded-read caps ===
employer run contributions (getEmployerContributions) role=employer http=200 Content-Range=0-177/178
distributor commissions (unbounded .from(commissions)) role=distributor http=206 Content-Range=0-999/4617
agent subscriber list role=agent http=200 Content-Range=0-25/26
subscriber transactions role=subscriber http=200 Content-Range=0-9/10
```

The 206 row above is my *deliberately unfiltered* control — the real call site
(`commissions.js:283`) carries `.eq('agent_id', agentId)`. **No live read is truncated today**
(A08-007 records the headroom so a future agent does not have to re-derive it).

Index coverage on the order columns that matter: `transactions` is covered by
`transactions_subscriber_id_date_idx (subscriber_id, date DESC)` and `idx_transactions_date`.
`subscribers.registered_date` and `subscribers.name` are **not** indexed, but the only path that
orders on them is `getEntityPage`, which has no UI consumer (see A08-006). Measured cost of that
sort anyway: 836 ms as admin, 615 ms as distributor over 5 081 rows — under the 8 s
`authenticated` `statement_timeout`.

---

## 5. Check 5 — `docs/api-contracts.md` and `server/index.ts` vs the real 16 routes

```
$ grep -c "^import .* from '\.\./api/" server/index.ts   # 17 (16 handlers + supabase-admin)
17
$ grep -c "^app\.all('/api/" server/index.ts
16
$ grep -n "14 handler imports\|14 route mounts" server/index.ts
61:// 14 handler imports — every handler exports a Vercel-shaped default. NodeNext
250:// ─── 9. 14 route mounts (B5) — `app.all` is REQUIRED. Every handler
$ find api -name "*.ts" -not -name "*.test.ts" -not -path "*/_lib/*" | wc -l
16
```

Every frontend `/api/*` path maps to a mounted route (13 distinct paths enumerated from
`api.post(...)` call sites, plus the 3 KYC image routes whose path literal sits on a continuation
line — `id-ocr`, `id-quality`, `face-match`). All 16 routes answer the documented 405 envelope:

```
$ for r in /api/access-request /api/nominee-claim /api/contact /api/chat; do printf "%s -> " "$r"; curl -s -X GET "http://localhost:3001$r"; echo; done
/api/access-request -> {"code":"method_not_allowed"}
/api/nominee-claim -> {"code":"method_not_allowed"}
/api/contact -> {"code":"method_not_allowed"}
/api/chat -> {"code":"method_not_allowed"}
```

But `/api/access-request` and `/api/nominee-claim` appear **nowhere** in `docs/api-contracts.md`
(`grep -n "access-request\|nominee-claim" docs/api-contracts.md` → 0 hits), and §2.3 is titled
"Misc (**2 routes**)" listing only `contact` and `chat`. Details in A08-002 / A08-003 / A08-004.

---

## 6. Role-gate matrix (check 1e, extended)

Gates read from `pg_proc.prosrc`, callers traced hook → component:

| RPC | live `app_role` gate | mounted in | verdict |
|---|---|---|---|
| `create_employer`, `set_employer_status`, `create_distributor`, `set_distributor_status`, `admin_notify`, `publish_nav_snapshot`, `review_nominee_claim`, `approve/deny_access_request`, `list_nav_snapshots`, `list_nominee_claims`, `list_access_requests`, `get_all_employers_metrics`, `get_platform_overview`, `get_employer_geo_rollup`, `get_employer_activity_rollup`, `get_nav_overview`, `get_admin_attention(_rows)`, `get_distributor_rollup` | `admin` | `src/admin-dashboard/**` | ✅ |
| `apply_settlement`, `set_commission_rate` | `distributor`\|`admin` | `src/dashboard/commissions/CommissionPanel.jsx` | ✅ |
| `get_top_entities` | `distributor`\|`admin` | `AdminOverview`, `DistributorOverview`, both mobile homes | ✅ |
| `get_employer_metrics`, `update_employer_profile`, `submit_employer_contribution_run`, `apply_group_insurance`, `remove_employer_member`, `update_employer_member_compensation`, `create_employer_invite`, `cancel_employer_invite`, `create_subscriber_from_employer_onboard` | `employer` | `src/employer-dashboard/**` | ✅ |
| `make_contribution`, `request_withdrawal`, `submit_hospital_cash_claim`, `fund_insurance_products`, `get_my_employer_funding` | `subscriber` | `src/subscriber-dashboard/**`, `src/dashboard/**` subscriber routes | ✅ |
| `upsert_nominees` | `subscriber`\|`admin` | subscriber nominees | ✅ |
| `create_subscriber_from_agent_onboard` | `agent` | `src/agent-dashboard/**` | ✅ |
| `get_entity_metrics_rollup` | `distributor`\|`admin`\|`branch`\|`agent`, **+ branch may not ask for country/region/district** | `branch-dashboard` asks `branch`/`agent` only; `district`/`region`/`country` levels only from `src/dashboard/reports/**` (distributor) | ✅ |
| `get_branch_pending_contributions` | `branch`\|`distributor`\|`admin`, branch pinned to own `branchId` | branch home | ✅ |
| `mark_notifications_read` | agent/branch/distributor/employer/admin branches; subscriber returns 204 no-op | all shells' bells | ✅ |

The two narrow gates were confirmed to raise as designed — and confirmed **unreachable**:

```
$ node docs/audits/2026-08-23/a08-live-probe9.mjs
get_entity_metrics_rollup role=branch args={"p_level":"district",...} -> http=500 P0003 out_of_scope
get_entity_metrics_rollup role=branch args={"p_level":"region",...}   -> http=500 P0003 out_of_scope
get_entity_metrics_rollup role=branch args={"p_level":"country",...}  -> http=500 P0003 out_of_scope
get_entity_metrics_rollup role=branch args={"p_level":"branch",...}   -> http=200 OK keys=b-kam-015
get_entity_metrics_rollup role=branch args={"p_level":"agent",...}    -> http=200 OK keys=a-001
get_top_entities          role=branch                                 -> http=500 P0002 role_not_permitted
```

`src/dashboard/reports/views/{ContributionsCollections,WithdrawalsPayouts,SubscriberDemographics,
SubscriberGrowth,DistributionSummary}.jsx` call `useAllEntitiesMetrics('district'|'region')` /
`useEntityMetrics('country','ug')`, which **would** 500 for a branch admin — but the branch
dashboard does not mount `src/dashboard/reports/**` (it replaced it with its own four-tab
`AnalyticsDesktop`, per that file's own header comment), and `useBranchScope()` safely defaults
`branchId` to `null` outside `BranchScopeProvider` (`src/contexts/BranchScopeContext.jsx`).
**Recorded so a future "give branch admins the reports hub" change does not walk into it.**

---

## Findings

### A08-001 · CRITICAL · confirmed · data-correctness / mock-vs-live parity
**The subscriber list path reports UGX 0 lifetime contributions for every subscriber, and the
"All Subscribers" report renders that zero as money and default-sorts on it.**

**Location:** `src/services/entities.js:152-153` (`mapSubscriber`); rendered at
`src/dashboard/reports/views/AllSubscribers.jsx:113-117` and `:157`.

**Mechanism.** `LEVEL_LIST_COLUMNS.subscriber` (`entities.js:255-259`) correctly projects only real
columns. `mapSubscriber` then reads two that exist on **no live relation**:

```js
// src/services/entities.js:151-153
const totalBalance      = row.total_balance      ?? balRow?.total_balance      ?? 0;
const totalContributions = row.total_contributions ?? balRow?.total_contributions ?? 0;  // always 0
const totalWithdrawals   = row.total_withdrawals   ?? balRow?.total_withdrawals   ?? 0;  // always 0
```

`total_contributions` / `total_withdrawals` died with the `employees` table in `0045`. Because
PostgREST simply omits absent keys rather than erroring (they are never *named* in the select), the
`??` chain silently lands on `0` on **every** row — no 400, no console warning, no test failure.

**Evidence — the live row, then the mapper run against it verbatim:**
```
$ node docs/audits/2026-08-23/a08-live-probe8.mjs
HTTP 200
row[0] keys: id,name,phone,email,gender,age,dob,nin,occupation,agent_id,district_id,kyc_status,is_active,registered_date,products_held,contribution_history,current_unit_value,unit_value_as_of,subscriber_balances
row[0].total_contributions = undefined
row[0].subscriber_balances = {"total_balance":174314}
SAMPLE: {"id":"s-0002","name":"Mary Kiiza",...,"contribution_history":[12709,12207,12989,12514,13364,13439,13464,12923,13052,12580,13155,13177],...}

$ node -e '<mapSubscriber lines 143-176 replayed against that exact row>'
mapSubscriber -> {
  "id": "s-0002",
  "totalBalance": 174314,
  "totalContributions": 0,
  "totalWithdrawals": 0,
  "sumOfContributionHistory": 155573
}
```

**Impact.** `AllSubscribers.jsx` builds a column literally labelled **"Total Contributions"**,
right-aligned, `render: (row) => formatUGX(row.totalContributions || 0)`, and sets
`defaultSort="totalContributions"`. So the report opens showing **UGX 0 for all ~5 081 subscribers**
— beside a working balance column — and its default sort is inert. `exportColumns={columns}` means
the CSV export ships the same zero column. Reachable on desktop and mobile from at least four
entry points:
`src/dashboard/reports/ReportsHub.jsx:26,259` · `src/dashboard/reports/ViewReports.jsx:16` ·
`src/dashboard/mobile/ReportViewMobile.jsx:11` + `ReportsMobile.jsx:21` ·
`src/admin-dashboard/AdminCountryOverview.jsx:142` · `src/dashboard/overlay/OverlayPanel.jsx:739,762,777`.

Secondary, same root cause: `src/dashboard/subscriber/ViewSubscribers.jsx:58` offers a
"Contributions" sort that compares `0 - 0` for every pair (inert control), and `:293` accumulates
`totals.totalContrib` to 0 (currently not rendered). The detail pane at `:85-86` is **already
fixed** — it recomputes from a per-subscriber transactions read, and its own comment records the
symptom: *"the list row carries 0 for both and this pane showed 'Total Contributions UGX 0' for
subscribers that plainly had a balance."* The report was not given the same fix.

**Mock-vs-live divergence (this is also the check-6 finding).** `src/data/mockData.js:534-535`
gives every mock subscriber a real `totalContributions` / `totalWithdrawals`. So under
`VITE_USE_SUPABASE=false` the identical report shows plausible money, and on the live default it
shows zeros — the modes disagree, and it is the **live** side that is wrong.

**Suggested fix.** The data is already on the wire: `contribution_history` is in
`LEVEL_LIST_COLUMNS.subscriber` and sums to 155 573 for `s-0002`. Either (a) derive
`totalContributions` from `contribution_history` in `mapSubscriber` (12-month, so label it as such),
(b) add a bounded roll-up RPC as the file's own TODO suggests, or (c) at minimum drop the column and
the `contributions` sort key rather than render a fabricated zero. Do **not** re-add
`total_contributions` to any `.select()` — that would 400 the whole request.

---

### A08-002 · LOW · confirmed · doc conformance
**`docs/api-contracts.md` — the file that calls itself the agent guide for "a concrete
request/response shape, error `code`, or RPC signature" — is wrong about routes, RPC coverage, two
RPC signatures, the table count, and applied migration state.**

**Location:** `docs/api-contracts.md:1, 7, 23, 57, 126, 151, 181, 239-247`

| Claim | Line(s) | Live truth |
|---|---|---|
| "the 14 `api/` routes" | 1, 7, 23, 57, 239 | **16**; `/api/access-request` and `/api/nominee-claim` appear **nowhere** in the file (0 grep hits), and §2.3 is "Misc (**2 routes**)" |
| `get_top_branch` \| `p_level text, p_entity_id text` | 156 | live `p_level text, p_parent_id text` — the frontend correctly sends `p_parent_id` (`entities.js:779`); the doc would produce a PGRST202 |
| `get_entity_metrics_rollup` \| `p_level text, p_entity_id text` | 155 | live `p_level text, p_entity_ids text[]`, returning a **map keyed by entity id** (`{"b-kam-015":{…}}`), not a single object |
| `apply_settlement` "Distributor-only" | 176 | live gate is `v_role NOT IN ('distributor','admin')` |
| Tables 28 | 246 | **37** |
| "`0092` is written but **NOT yet applied**"; "`0001`–`0091` are live" | 240 | `0092` is live and 16 further migrations exist (`0093`–`0108`); `get_nav_overview` / `publish_nav_snapshot` (`0104`–`0107`) are live and called by the frontend |

**Coverage gap, measured:**
```
$ node -e "<diff of the 55 frontend RPC names against docs/api-contracts.md>"
distinct RPCs called by frontend: 55
NOT mentioned anywhere in docs/api-contracts.md: 31
admin_notify · approve_access_request · cancel_employer_invite · create_distributor ·
create_employer_invite · create_subscriber_from_employer_invite ·
create_subscriber_from_employer_onboard · deny_access_request · fund_insurance_products ·
get_admin_attention · get_admin_attention_rows · get_all_employers_metrics ·
get_branch_pending_contributions · get_commission_rate · get_distributor_rollup ·
get_employer_activity_rollup · get_employer_invite · get_nav_overview · list_access_requests ·
list_nav_snapshots · list_nominee_claims · make_contribution · publish_nav_snapshot ·
remove_employer_member · request_withdrawal · review_nominee_claim · set_commission_rate ·
set_distributor_status · set_employer_status · submit_hospital_cash_claim ·
update_employer_member_compensation
```
**56% of the RPCs the frontend actually calls are undocumented**, including all three subscriber
money writes (`make_contribution`, `request_withdrawal`, `fund_insurance_products`) and the entire
NAV surface.

**Impact.** No user-visible effect today. But this is the canonical reference an agent or engineer
consults before wiring a call, and two of the signatures it gives are ones that would 404 at
runtime. **Suggested fix:** regenerate §2/§3/§6 from `pg_get_function_arguments` +
`find api -name '*.ts'` rather than hand-maintaining them.

---

### A08-003 · INFO · confirmed · doc/comment drift
**`server/index.ts:61` and `:250` both say "14"; the file has 16.**

**Location:** `server/index.ts:61`, `server/index.ts:250`
**Evidence:** see §5 — `grep -c "^import .* from '\.\./api/"` → 17 (16 handlers + `supabase-admin`),
`grep -c "^app\.all('/api/"` → 16, `find api -name '*.ts' -not -name '*.test.ts' -not -path '*/_lib/*' | wc -l` → 16.
**Impact:** none at runtime; corroborates baseline §9.5. **Fix:** change both comments to 16, or
drop the count.

---

### A08-004 · LOW · confirmed · documented invariant is false
**`docs/api-contracts.md §4` asserts "Writes are NEVER permitted directly through PostgREST — all
writes flow through SECURITY DEFINER RPCs (CLAUDE.md §7)". There are 12 direct PostgREST write call
sites and every one is permitted by live GRANTs + RLS.**

**Location:** `docs/api-contracts.md:227`
```
$ node -e "<print writeSites from a08-contract-report.json>"
src/services/entities.js:1065   || branches                      || insert
src/services/entities.js:1101   || agents                        || insert
src/services/entities.js:1133   || branches                      || update
src/services/entities.js:1185   || distributors                  || update
src/services/entities.js:1411   || agents                        || update  { status }
src/services/subscriber.js:1049 || contribution_schedules        || update
src/services/subscriber.js:1212 || insurance_policies            || upsert
src/services/subscriber.js:1219 || subscriber_insurance_products || update
src/services/subscriber.js:1399 || insurance_policies            || update
src/services/subscriber.js:1403 || subscriber_insurance_products || update
src/services/subscriber.js:1411 || transactions                  || insert
src/services/subscriber.js:1463 || subscribers                   || update
```
Each has a matching write policy (`branches_insert_distributor`, `agents_update_branch`,
`contribution_schedules_update_self`, `insurance_policies_*_self`, `sip_*_self`,
`transactions_insert_self`, `subscribers_update_self`) and the required GRANT.

**Worth recording (this is *correct* and easy to break):** `subscribers` has **no table-level
UPDATE grant** — only a 5-column grant, and `updateProfile` whitelists exactly those 5:
```
$ psql ... -c "SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='subscribers' AND grantee IN ('anon','authenticated') AND privilege_type='UPDATE'"
authenticated|UPDATE|consent_at
authenticated|UPDATE|email
authenticated|UPDATE|name
authenticated|UPDATE|occupation
authenticated|UPDATE|phone
```
`src/services/subscriber.js:1444-1449` builds `patch` from exactly `{name, email, phone, occupation,
consent_at}`. Adding a sixth field to that patch would 42501 the whole profile save. **Contract
holds today.**

**Impact:** documentation states a security invariant the code does not honour, which could lead a
reviewer to skip auditing PostgREST write policies. **Fix:** amend §4 to "writes go through
SECURITY DEFINER RPCs *except* the 12 RLS-policied direct writes listed in §4.1", or add the list.

---

### A08-005 · LOW · confirmed · mock-vs-live parity + latent live gap
**`createEmployer`'s live branch drops 2 of `create_employer`'s 9 parameters that its own mock
branch honours.**

**Location:** `src/services/employer.js:610-639`

Mock branch (`:613-631`) builds the row with `payroll_cadence: payload.payrollCadence` and
`default_contribution_config: payload.defaultContributionConfig ?? {}`. Live branch (`:632-641`)
sends only `p_name … p_district` — never `p_payroll_cadence`, never
`p_default_contribution_config`. Live defaults are `NULL` and `'{}'::jsonb`.

**Impact today: none** — neither `src/admin-dashboard/employers/CreateEmployer.jsx:75-83` nor its
mobile twin collects those fields, so nothing is lost. **Latent:** the moment either field is added
to the form, mock mode persists it and live mode silently discards it. And a live-created employer
starts on a `'{}'` config, which `submit_employer_contribution_run` treats as a legal 0/0 no-op
(`runId` null, every member skipped `zero_contribution`) until an employer saves Settings — worth
knowing before demoing "create an employer, then run payroll".

**Fix:** forward both params (they are already `DEFAULT`ed, so adding them is backward-compatible),
or delete them from the mock branch so the two agree.

---

### A08-006 · LOW · confirmed · latent (dead code) + a provably false in-code claim
**`getEntityPage` uses `Prefer: count=estimated`, which on this project reports `1001` where the
exact count is `5081`. The in-file comment claims "< 1% drift"; the measured drift is −80.3%.**

**Location:** `src/services/entities.js:586-592` (comment at `:585-588`, usage at `:592`)

```
$ node docs/audits/2026-08-23/a08-live-probe3.mjs
count=estimated admin       {"ms":836,"status":206,"cr":"0-999/1001","n":1000}
count=estimated distributor {"ms":615,"status":206,"cr":"0-999/1001","n":1000}
count=exact     admin       {"ms":566,"status":206,"cr":"0-999/5081","n":1000}
page2 admin                 {"ms":640,"status":206,"cr":"1000-1999/1001","n":1000}
```

Root cause: the planner's estimate for the RLS-filtered query is **51** (`planned -> 0-999/51`,
because `pg_stat_user_tables.last_analyze` is `never` for every table post-restore), which is below
`db-max-rows`, so PostgREST falls back to an exact count *capped at max-rows+1* = 1001. Not a
`reltuples` problem — `reltuples` is intact (`subscribers` 5064 vs actual 5081).

**Consequence if the path were live:** `const total = count ?? 0` → 1001; `hasMore = offset +
rows.length < total`. Page 0 → `1000 < 1001` true; page 1 → `2000 < 1001` false. The infinite list
would stop at **2 000 of 5 081** and the header would read "Showing 2,000 of 1,001".

**Why only LOW:** `getEntityPage`'s sole caller is `useInfiniteEntityList`
(`src/hooks/useEntity.js:160`), which has **no consumers** — confirmed by grep and by the file's own
`⚠️ CURRENTLY UNUSED` header at `entities.js:535`. The live subscriber list uses `getAllAtLevel`,
which correctly uses `count:'exact', head:true` (`entities.js:492`) and pages the true 5 081.

**Fix:** if this path is ever revived, switch to `count:'exact'` (measured 566 ms, *faster* than the
estimated probe here) and correct the comment.

---

### A08-007 · INFO · confirmed · measured ground truth for other agents
**PostgREST `db-max-rows = 1000` on `ilkhfnoyxlxwqadebnkp`; over-cap reads return HTTP 206 and
`postgrest-js` does not throw. No live read in `src/services/` is currently truncated.**

Evidence and the full headroom table are in §4. The narrowest headroom is
`getEmployerContributions` at **178 / 1000 (5.6×)** for `emp-001`; it grows by ≈42 rows per
employer contribution run, so ≈20 further demo runs would reach the cap and silently truncate a
list whose own doc-comment promises "Sums over this list therefore equal Σ runs.employeeTotal /
Σ runs.employerTotal" (`employer.js:527-533`). Recorded, not raised as a defect.

---

### A08-008 · INFO · confirmed · check 7
**The `mockData` import boundary holds — 9 importers, all in `src/services/**`, 0 violations — and
it is enforced by prose only.**

```
$ grep -rn "from '.*data/mockData" src/ | sed 's/:.*from/ -> from/' | sort
src/services/agent.js         -> from '../data/mockData';
src/services/chat.js          -> from '../data/mockData';
src/services/commissions.js   -> from '../data/mockData';
src/services/employer.js      -> from '../data/mockData';
src/services/entities.js      -> from '../data/mockData';
src/services/notifications.js -> from '../data/mockData';
src/services/search.js        -> from '../data/mockData';
src/services/subscriber.js    -> from '../data/mockData';
src/services/tickets.js       -> from '../data/mockData';
```
The only other files mentioning `mockData` are
`src/branch-dashboard/analytics/deriveBranchAnalytics.js:9` and `src/utils/policies.js:12` — both
in **comments asserting they do not import it**. Two test files import it legitimately.

`eslint.config.js` contains no `no-restricted-imports` rule (rules present:
`no-console`, `no-unused-vars`, `react-refresh/only-export-components`, plus the jsx-a11y set).
CLAUDE.md §4.1 line 91 and §"Don'ts" line 102 are the only enforcement.
**Fix (optional):** add
`'no-restricted-imports': ['error', { patterns: [{ group: ['**/data/mockData*'], message: 'services only — CLAUDE.md §4.1' }] }]`
scoped to `src/**` with an override for `src/services/**` and `**/__tests__/**`.

---

### A08-009 · LOW · plausible · read-correctness hazard, not reproduced
**`getAllAtLevel` pages with `.range()` and no `.order()`; unordered `LIMIT/OFFSET` has no
stable-order guarantee, so concurrent pages can in principle duplicate or skip rows.**

**Location:** `src/services/entities.js:476-509` (`applyScope(supabase.from(table).select(columns)).range(from, to)` — no `.order()` anywhere in the fan-out)

The doc-comment on the function states the stakes: *"callers reduce/aggregate over the whole list —
reports, totals, charts — so truncation would silently corrupt their numbers"* (`:427-428`). The
6 pages for `subscribers` are issued **in parallel** (`Promise.all`, `:504-509`).

**Negative repro — stated plainly:** 5 trials of the exact fan-out found 0 duplicates and 0 gaps.
```
$ node docs/audits/2026-08-23/a08-live-probe5.mjs
trial 1: exactTotal=5082 fetched=5082 distinct=5082 duplicates=0 missing=0
trial 2: exactTotal=5082 fetched=5082 distinct=5082 duplicates=0 missing=0
trial 3: exactTotal=5082 fetched=5082 distinct=5082 duplicates=0 missing=0
trial 4: exactTotal=5082 fetched=5082 distinct=5082 duplicates=0 missing=0
trial 5: exactTotal=5082 fetched=5082 distinct=5082 duplicates=0 missing=0
```
A quiescent heap seq-scans in stable physical order, so this does not bite today. It becomes real
if a row is inserted mid-fan-out (agent onboarding runs during a demo) or if the planner switches
plans. **Fix:** add `.order('id')` to the fan-out — one deterministic key makes `range()` sound at
zero cost (`subscribers_pkey` already exists).

---

## Traceability

Every numbered check in the A08 spec, decomposed, with exactly one disposition.

| # | Check | Disposition |
|---|---|---|
| **1a** | Every `.rpc()` name exists among the 89 live | **PASS** (55/55) |
| **1b** | No call site references any of the 19 dropped `0021`-family names | **PASS** (0 hits outside one comment) |
| **1c** | Argument NAMES match `pg_get_function_identity_arguments` | **PASS** (0 unknown keys) |
| **1d** | Every non-defaulted parameter is supplied | **PASS** |
| **1e** | EXECUTE-able by the DB role that calls it (`anon` / `authenticated`) | **PASS** (3 pre-login sites ↔ the 3 intentional anon grants) |
| **1f** | PostgREST schema cache resolves each name (live probe, not just `pg_proc`) | **PASS** (55/55 PGRST202-resolved) |
| **1g** | In-function `app_role` gate matches the dashboard(s) that mount the hook | **PASS** (26 read RPCs executed as caller → all 200; write gates matched by source, matrix in §6) |
| **2a** | Every column in an inline `.select()` literal exists on that table | **PASS** (106 verified, 0 invalid) |
| **2b** | Constant-indirected selects resolved (`LEVEL_LIST_COLUMNS`, `MEMBER_SELECT`) | **PASS** |
| **2c** | Live HTTP probe of every resolvable select returns 200, not 400 | **PASS** (30/30 + 19 indirected) |
| **3a** | Every embed resolves to a real table via a real FK | **PASS** (18/18) |
| **3b** | `subscriber_balances` embeds name only its 6 real columns | **PASS** |
| **3c** | No embed ambiguity (no table with 2 FKs to one target) | **PASS** (30 FKs enumerated) |
| **4a** | `.eq/.in/.is/.not/.or` filter columns exist | **PASS** (56/56) |
| **4b** | `.order()` columns exist (live-probed) | **PASS** (14/14) |
| **4c** | Ordering on large tables is index-covered / cost-measured | **PASS** — `transactions` covered; `subscribers.registered_date`/`name` unindexed but only on the dead `getEntityPage` path (836 ms measured, < 8 s timeout) |
| **4d** | `.range()` / unbounded reads vs PostgREST `db-max-rows` | **FINDING A08-007** (info) **+ A08-009** (low) |
| **5a** | `docs/api-contracts.md` route count vs the real 16 | **FINDING A08-002** |
| **5b** | `server/index.ts:61` / `:250` "14" comments | **FINDING A08-003** |
| **5c** | Every frontend `/api/*` path maps to a mounted route | **PASS** (16/16) |
| **5d** | `docs/api-contracts.md` RPC coverage + signatures | **FINDING A08-002** |
| **5e** | `docs/api-contracts.md §4` "no direct PostgREST writes" claim | **FINDING A08-004** |
| **6a** | Read-RPC-backed services: live-measured shape ↔ mapper ↔ mock, field for field | **PASS** (26/26 — incl. `search_entities` `entity_id`→`id`, `get_branch_pending_contributions` snake→camel, `get_top_entities` `m:{}` block, `get_employer_metrics` 10/10 keys, `get_all_employers_metrics` 13/13 keys) |
| **6b** | Subscriber list path: mock money fields vs live | **FINDING A08-001** |
| **6c** | `createEmployer` mock vs live parameter set | **FINDING A08-005** |
| **7a** | Only `src/services/**` imports `src/data/mockData.js` | **PASS** (9 importers, 0 violations) |
| **7b** | A lint rule enforces the boundary | **FINDING A08-008** (info — prose only) |

**Excluded as demo-scope (2):**
1. `VITE_USE_SUPABASE=false` being a break-glass rollback rather than a demo default — prior audits
   (`docs/audits/2026-05-31/AUDIT_REPORT.md:377`) established this, and `.env.local.example:9` ships
   `true`. Mock-vs-live gaps are therefore reported only where the **live** side is wrong (A08-001)
   or where the divergence is a live functional gap (A08-005).
2. Mocked KYC / OTP / chat request-response shapes (`api/kyc/_lib/mocks.ts`) — deliberate per the
   audit brief; their client↔handler field contracts were still checked and match.

**Blocked: none.**

---

## Cross-agent handoffs
- **A10 / A13 / A19 (dashboards):** A08-001 lands on `src/dashboard/reports/views/AllSubscribers.jsx`
  and `src/dashboard/subscriber/ViewSubscribers.jsx:58` — the fix is a UI/mapper decision, not a
  schema one.
- **A21 (perf):** `db-max-rows=1000` and the headroom table in §4 are measured; also note
  `last_analyze`/`last_autoanalyze` are `never` for all 37 tables, so the planner is estimating
  `subscribers` at 51 rows (see A08-006 root cause) — that will distort any EXPLAIN-based timing.
- **A03 (RLS/security):** the 12 PostgREST write sites in A08-004 all have policies; the
  column-level-only UPDATE grant on `subscribers` (5 columns) is the tightest contract in the
  schema and is currently honoured exactly.
- **A24 / docs owner:** A08-002 and A08-003 are pure documentation work.
