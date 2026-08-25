# RLS matrix — RE-MEASURED against live, 2026-08-25

**Findings:** `A26-004` (high, doc-vs-RLS disagreement) · `A02-007` (low, `distributors` unreadable)
**Agent:** `P7-rls-doc-truth` · **Target:** Supabase `ilkhfnoyxlxwqadebnkp` (Singapore, production)
**This file is the evidence for the edits to `docs/role-permissions.md`.** It is measurement, not narrative.

---

## 0. Why this file exists, and why the audit's matrix could not just be copied

`docs/audits/2026-08-23/02-rls-matrix.md` was measured on **2026-08-23**. Between then and now this
remediation programme applied migrations that **changed the answer**:

| Migration | Applied? | What it moved |
|---|---|---|
| `0109_settlement_tenancy` | ✅ live (`not_your_agent` present in the live body) | `apply_settlement` gained a distributor-ownership predicate |
| `0118_rls_write_surface` | ✅ live (`transactions_insert_self` gone) | Dropped the client `*_insert_self` / `*_update_self` doors on the money + cover tables |
| `0119_table_grants` | ✅ live | Revoked `TRUNCATE` / `REFERENCES` / `TRIGGER` / `MAINTAIN` from `anon` + `authenticated`; floored the money tables to `SELECT` |
| `0120_anon_surface` | ✅ live | Narrowed the anon RPC surface |
| `0121_provisioning_integrity` | ✅ live | Tenant-creation identity writes |
| `0127_secure_snapshot_tables` | ✅ live (`supabase_migrations` version `20260825064701`) | RLS + `FORCE` on the `*_pre_purge_*` / `*_pre_nav` snapshot tables |
| `0128_revoke_identity_and_trigger_execute` | ✅ live (version `20260825065644`) | Revoked `EXECUTE` on `register_login_identity` from `authenticated` |
| `0130_rls_policy_consolidation` | ❌ **authored, deliberately NOT applied** (EXCLUDE, upheld) | Would have collapsed the six `subscribers` SELECT policies into one |

Two of those (`0127`, `0128`) landed **after** the previous documentation pass
(commit `957c01e`, 2026-08-25 08:57 +0530 = 03:27 UTC; `0128` applied 06:56 UTC). So the doc as it
stood this morning was already behind live again by the time it was committed. That is the whole
reason this file records **method and timestamp** alongside every number.

⚠️ **The migration ledger cannot establish applied state.** Only `0127` and `0128` registered in
`supabase_migrations.schema_migrations`; `0109`–`0122`, `0126`, `0129` were applied directly and
never registered, and the ledger versions rows as timestamps while files are named `0001_*`
(A26-007). Every "applied?" verdict above was established by **introspecting the live object**, not
by reading a ledger.

---

## 1. Method

**Provenance rules used here.**

* A **policy's text is a claim; a probe is evidence.** Every SELECT cell in §2 is a real
  `count(*)` executed under `SET LOCAL ROLE authenticated` with a forged
  `request.jwt.claims`, inside a transaction that was rolled back.
* Probes ran through **`scripts/psql-probe.sh`**, which refuses files containing column-0
  transaction control and asserts the transaction is *still open* immediately before rolling back.
  Both runs ended `probe-txn-state: no writes (safe)` → `ROLLBACK`. Nothing was written.
* **No write was executed.** This agent had read-only mandate. Write verdicts in §3 are therefore
  derived from the two layers that *both* have to permit a write, each read straight from the
  catalog:
  1. the **privilege floor** — `information_schema.role_table_grants` +
     `information_schema.column_privileges` for `anon` / `authenticated`;
  2. the **policy layer** — `pg_policies` rows with `cmd <> 'SELECT'`.

  With `relrowsecurity = true` **and** `relforcerowsecurity = true` on every table in §3, the
  absence of a policy for a command is a deny, and the absence of a grant is a deny. Both are
  exact. This is a stronger statement than a probe would give, because it holds for *every* row,
  not just the row a probe happened to pick.

**Personas** (real live ids, one consistent chain under `d-001`):

| Persona | JWT claims |
|---|---|
| subscriber | `app_role=subscriber, subscriberId=s-0001` |
| agent | `app_role=agent, agentId=a-001` |
| branch | `app_role=branch, branchId=b-bui-001` |
| distributor | `app_role=distributor, distributorId=d-001` |
| employer | `app_role=employer, employerId=emp-001` |
| admin | `app_role=admin, adminId=admin-001` |
| anon | `role=anon`, no `app_role` |

`s-0001 → a-001 → b-bui-001 → d-001`, so the chain exercises every hop of the ownership edge.

**Live population at measurement time** (service role): 3 distributors · **320** branches ·
2,046 agents · 5,059 subscribers · 8 employers · 27,432 transactions · 5,001 commissions ·
24,388 nominees · 5,022 schedules · 23 users · 6 notifications · 2 settlement batches.

---

## 2. SELECT — measured row counts per persona

Every cell is a live `count(*)`. `DENIED` = the statement errored with *permission denied for
table* (no grant at all); `0` = the query ran and RLS returned nothing.

| Table | subscriber | agent | branch | distributor | employer | admin | anon |
|---|---:|---:|---:|---:|---:|---:|---:|
| `distributors` | **0** | **0** | **0** | **1** | **0** | **3** | 0 |
| `branches` | 1 | 1 | 1 | 291 | 0 | 320 | 0 |
| `agents` | 1 | 1 | 8 | 1,872 | 0 | 2,046 | 0 |
| `subscribers` | 1 | 11 | 34 | 4,602 | 21 | 5,059 | 0 |
| `subscriber_balances` | 1 | 11 | 34 | 4,602 | 21 | 5,059 | 0 |
| `transactions` | 11 | 75 | 208 | 24,959 | 235 | 27,432 | 0 |
| `contribution_schedules` | 1 | 11 | 34 | 4,602 | 21 | 5,022 | 0 |
| `commissions` | 0 | 11 | 34 | 4,602 | 0 † | 5,001 | 0 |
| `settlement_batches` | 0 | 1 | 1 | 2 | 0 | 2 | 0 |
| `insurance_policies` | 1 | 7 | 20 | 2,478 | 21 | 2,731 | 0 |
| `subscriber_insurance_products` | 2 | 11 | 18 | 1,328 | 21 | 1,473 | 0 |
| `nominees` | 3 | 47 | 155 | 22,543 | 0 ‡ | 24,388 | 0 |
| `withdrawals` | 1 | 19 | 48 | 4,506 | 0 | 4,937 | 0 |
| `claims` | 1 | 1 | 14 | 1,750 | 0 | 1,907 | 0 |
| `notifications` | 0 | 2 | 2 | 0 § | 0 | 6 | 0 |
| `employers` | 0 | 0 | 0 | 0 | 1 | 8 | 0 |
| `contribution_runs` | 0 | 0 | 0 | 0 | 6 | 9 | 0 |
| `employer_invites` | 0 | 0 | 0 | 0 | 4 | 4 | 0 |
| `commission_config` | 1 | 1 | 1 | 2 | 1 | 3 | 0 |
| `demo_personas` | 17 | 17 | 17 | 17 | 17 | 17 | 0 |
| `users` | 0 | 0 | 0 | 0 | 0 | 23 | **DENIED** |
| `regions` | 4 | 4 | 4 | 4 | 4 | 4 | **4** |
| `districts` | 136 | 136 | 136 | 136 | 136 | 136 | **136** |
| `nav_snapshots` | 0 | 0 | 0 | 0 | 0 | 1,254 | 0 |
| `access_requests` | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| `nominee_claims` | 0 | 0 | 0 | 0 | 0 | 9 | 0 |
| `custody_transfers` | 0 | 0 | 0 | 0 | 0 | 9 | 0 |
| `contact_submissions` | 0 | 0 | 0 | 0 | 0 | 0 ¶ | 0 |
| `agent_referrals` | 0 | 0 | 0 | 0 | 0 | 0 ¶ | 0 |
| `money_nonces` (10 rows live) | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| `settlement_uploads` (5 rows) | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| `subscriber_signup_uploads` (104 rows) | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| `contribution_run_uploads` (33 rows) | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| `entity_status_log` | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| `entity_detach_log` | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |

† employer `commissions` = 0 **by design and by data**: employer-funded members carry `agent_id`
NULL, so they generate no commission rows (`emp-001` has 21 members, 0 commissions). There is no
`commissions_select_employer` policy either — both layers agree.
‡ employer `nominees` = 0 is **data, not policy**: `nominees_select_employer` exists;
`emp-001`'s 21 members simply hold no nominee rows.
§ distributor `notifications` = 0 is **data, not policy**: `notifications_select_distributor`
exists; all 6 live notifications carry `recipient_role` ∈ {`agent`,`branch`}.
¶ admin 0 = **table is empty** (0 rows live), not a deny. Contrast with the four bolded `0`s
below it, which are RLS denials on non-empty tables — those four carry **zero policies**, so no
client role, admin included, can read them.

**Three structural facts this table establishes:**

1. **`distributors` is admin-only + distributor-self.** subscriber/agent/branch/employer all
   return 0. `A02-007` still reproduces exactly as written, two days and eight migrations later.
2. **`regions` and `districts` are anon-readable**, not merely authenticated-readable — their
   policies are `USING (true)` granted to role `public`.
3. **`branches` and `agents` are NOT blanket-readable by any authenticated role.** A subscriber
   sees exactly 1 branch and 1 agent (its own). The old `*_select_authenticated` policies are gone;
   what replaced them is one policy per role plus a RESTRICTIVE `*_scope_distributor` overlay.

---

## 3. Write surface — the privilege floor, table × verb × role

**Every write policy that exists live. There are exactly ten.**

| Table | Policy | Verb | Who |
|---|---|---|---|
| `agents` | `agents_insert_branch` | INSERT | `app_role='branch'` AND `branch_id = branchId` |
| `agents` | `agents_update_branch` | UPDATE | `app_role='branch'` AND `branch_id = branchId` |
| `branches` | `branches_insert_distributor` | INSERT | `app_role='distributor'` AND `distributor_id = current_distributor_id()` |
| `branches` | `branches_update_distributor` | UPDATE | same |
| `distributors` | `distributors_update_self` | UPDATE | `app_role='distributor'` AND `id = distributorId` |
| `subscribers` | `subscribers_update_self` | UPDATE | `app_role='subscriber'` AND `id = subscriberId` |
| `contribution_schedules` | `contribution_schedules_update_self` | UPDATE | `app_role='subscriber'` AND `subscriber_id = subscriberId` |
| `insurance_policies` | `insurance_policies_insert_self` | INSERT | `app_role='subscriber'` AND `subscriber_id = subscriberId` |
| `insurance_policies` | `insurance_policies_update_self` | UPDATE | same |
| `subscriber_insurance_products` | `sip_update_self` | UPDATE | same |

**Column-level narrowing on top of that** (`information_schema.column_privileges`, `authenticated`):

| Table | Verb | Columns the client may touch |
|---|---|---|
| `subscribers` | UPDATE | `consent_at, email, name, occupation, phone` — 5 of the table's columns |
| `contribution_schedules` | UPDATE | `amount, contribution_indexation_pct, emergency_pct, frequency, include_insurance, insurance_choice_made, next_due_date, retirement_pct, updated_at` |
| `users` | SELECT | `created_at, email, entity_id, id, last_login_at, name, phone, role` (RLS still restricts to admin) |

`insurance_policies` and `subscriber_insurance_products` writes are further constrained at runtime
by the `trg_insurance_policies_enforce_client_writes` / `trg_sip_enforce_client_writes` column
guards (both SECURITY INVOKER, callable only in trigger context).

**Money and cover tables — floored to SELECT.** `transactions`, `withdrawals`, `nominees`,
`subscribers`, `contribution_schedules` now grant `anon`/`authenticated` only `SELECT` at table
level (`insurance_policies` = `INSERT,SELECT,UPDATE`; `subscriber_insurance_products` =
`SELECT,UPDATE`). Tables that still carry the fuller `DELETE,INSERT,SELECT,UPDATE` grant —
`commissions`, `settlement_batches`, `subscriber_balances`, `nav_snapshots`, `employers`,
`contribution_runs`, `employer_invites`, `claims`, `notifications`, `distributors`, `money_nonces`
— carry **no write policy at all**, so RLS denies. Two layers, and the deny only needs one.

**The write path is therefore, today, exactly this and nothing else:**

| What the app writes directly | Live authority |
|---|---|
| `entities.js:1102` branch INSERT | `branches_insert_distributor` |
| `entities.js:1138` agent INSERT | `agents_insert_branch` (**branch role only**) |
| `entities.js:1170` branch UPDATE | `branches_update_distributor` |
| `entities.js:1222` distributor UPDATE | `distributors_update_self` |
| `entities.js:1448` agent status UPDATE | `agents_update_branch` |
| `subscriber.js:1097` schedule UPDATE | `contribution_schedules_update_self` (9 columns) |
| `subscriber.js:1260` insurance policy UPSERT | `insurance_policies_insert_self` + `_update_self` |
| `subscriber.js:1267` insurance product UPDATE | `sip_update_self` |
| `subscriber.js:1520` profile UPDATE | `subscribers_update_self` (5 columns) |

That is a one-to-one match. `src/services/**` contains **no** client write that live RLS would
reject, and live RLS grants **no** client write the app does not use. Money moves only through the
`SECURITY DEFINER` RPCs (`make_contribution`, `request_withdrawal`, `upsert_nominees`,
`submit_hospital_cash_claim`, `fund_insurance_products`, `apply_settlement`,
`submit_employer_contribution_run`) — verified by grep: `nominees` and `claims` have no
`.insert()`/`.update()` call site at all; both route through their RPC.

**RPC EXECUTE surface.** `register_login_identity` still exists but
`has_function_privilege('authenticated', …, 'EXECUTE')` is now **false** — `0128` applied. Of the
functions `anon` may still execute, the set is the invite/signup path
(`create_subscriber_from_signup`, `create_subscriber_from_employer_invite`, `get_employer_invite`)
plus the RLS helper functions and the two trigger guards.

---

## 4. Claim-by-claim verdict against `docs/role-permissions.md`

Line numbers are as the file stood **before** this agent's edit (i.e. at commit `1f8985b`).

| # | Line | Doc's claim | Measured live 2026-08-25 | Verdict |
|---|---|---|---|---|
| 1 | 40 | distributor View Branches — "All **~321** branches" | distributor sees **291**; platform total is **320** | ✏️ **WRONG — fix.** Two errors: the count is stale (320, not 321 — `0112` removed the E2E fixture branches) *and* a distributor never sees the platform total. Self-contradicts line 49 ("its OWN network only"). |
| 2 | 42 | distributor View Agents — "All ~2,046 agents" | distributor sees **1,872**; total 2,046 | ✏️ **WRONG — fix.** Same self-contradiction. |
| 3 | 43 | distributor View Subscribers — "All ~5,000 subscribers" | distributor sees **4,602**; total 5,059 | ✏️ **WRONG — fix.** Same self-contradiction. |
| 4 | 77 | "View entities at any level \| Read \| **All**" | own network only | ✏️ **WRONG — fix.** |
| 5 | 78 | "Drill down through hierarchy \| Read \| All" | own network only | ✏️ **WRONG — fix.** |
| 6 | 79 | "Create branch \| Create \| **Any district**" | `branches_insert_distributor` pins `distributor_id`; district unconstrained. The `branches_default_distributor` BEFORE-INSERT trigger stamps the caller's own claim | ⚠️ **MISLEADING — fix.** Any district, but only under its **own** distributor. |
| 7 | 80 | "Create agent \| Create \| Any branch (**accessible from distributor too**)" | `agents_insert_branch` requires `app_role='branch'`. There is **no** distributor INSERT policy on `agents`, and `createAgent` is called only from `src/branch-dashboard/**` | ❌ **FALSE — fix.** A distributor cannot create an agent, in the UI or at the database. |
| 8 | 81 | "View agent commissions \| Read \| **All agents**" | `commissions_select_distributor` bounded by `distributor_branch_ids()`; d-001 sees 4,602 of 5,001 | ✏️ **WRONG — fix.** |
| 9 | 82 | "Set commission rate \| Update \| **Global** (flat rate-per-subscriber)" | `set_commission_rate` is **per-distributor** since `0089`; live `commission_config` = `cfg-d-001`, `cfg-d-002`, `default` | ✏️ **WRONG — fix.** Self-contradicts line 322 of the same file, which describes it correctly. |
| 10 | 83 | "Apply settlement \| Update \| **Any agent's** due commissions" | `0109` (this programme) added the ownership predicate: a distributor settles only agents whose branch is in `distributor_branch_ids()`; foreign rows are skipped with `not_your_agent`. Verified in the **live** function body | ❌ **FALSE — fix, and mark as intentional hardening.** This is the A05-001 cross-tenant payout hole. A future reader must not "restore" it. |
| 11 | 86 | "Search entities \| Read \| **All entities**" | `search_entities` is `SECURITY INVOKER` → RLS applies → own network | ✏️ **WRONG — fix.** |
| 12 | 253 | employer scoping: "13 direct-write successes were measured live on other tables (`transactions`, `insurance_policies`, `contribution_schedules`, `withdrawals`, `nominees`, `agents`, `branches`, `distributors`)" — written 2026-08-25 morning | **Now stale.** `0118` + `0119` shipped. `transactions`, `withdrawals`, `nominees` have no write policy *and* a SELECT-only grant. Exactly ten write policies survive, all tenancy-pinned, five of them column-scoped | ✏️ **WRONG (in the safe direction) — fix.** The warning was correct when written and is now the opposite of the truth. Left alone it would tell a future engineer the money tables are still open. |
| 13 | 318 | admin: "Reference tables (`regions`/`districts`/`branches`/`agents`) are **authenticated-readable**" | `regions`/`districts` are **anon**-readable (`USING (true)` to `public`); `branches`/`agents` are **not** blanket-readable — per-role scoped policies + RESTRICTIVE overlay. A subscriber sees 1 branch, 1 agent | ✏️ **WRONG both ways — fix.** Under-states the reference tables, over-states `branches`/`agents`. |
| 14 | 332 | admin: "Reused distributor actions (**create branch**, settle commissions, etc.) \| As distributor \| Inherited from the reused panels" | There is **no** `branches_insert_admin` policy — the only INSERT policy on `branches` requires `app_role='distributor'`. `apply_settlement` *does* admit admin (platform-wide, no ownership bound) | ❌ **FALSE for create-branch — fix.** Settle-commissions is correct. |
| 15 | 350 | "Any 'Operated by …' attribution surface for branch / agent / subscriber / employer **renders empty** (A02-007)" | `grep -rn "Operated by" src/` → **no matches anywhere.** All five `useEntity('distributor', …)` call sites are in `src/dashboard/**` (the distributor shell); `entities.js:1221` is the only other `distributors` reference | ⚠️ **MISLEADING — sharpen.** There is no such surface to render empty. Saying it "renders empty" invites someone to widen the policy to fill it. |
| 16 | 302 | admin: "Reused verbatim from `src/dashboard/`: … `ViewTickets` / **`CreateBranch`** panels — they are role-blind (RLS scopes data) and admin holds the SELECT grants" | `AdminDashboardShell.jsx:393` deliberately does **not** render `<CreateBranch>`, and says why in a code comment: *"no `<CreateBranch>` — admins have no branch-INSERT RLS grant"* | ❌ **FALSE — fix.** The frontend already knows this; only the doc did not. Caught while correcting row 14 — the first draft of that fix said "reachable from the admin shell but the write fails at RLS", which the code refutes. |
| 17 | 210 | subscriber: "**No access to:** Other subscribers, **agents**, **branches**, commissions, or network data" | subscriber reads exactly **1 agent** (its own, via `agents_select_subscriber` → `subscriber_agent_id()`) and **1 branch** (`branches_select_subscriber`) | ✏️ **WRONG — fix.** Blanket "no access to agents, branches" is false; the own-agent read is what the Agent (DM) screen resolves a name from. Everything else in the row is correct. |
| 18 | 297 | agent: "**No access to:** Other agents, **branch-level data**, or network data" | agent reads its own `branches` row (`branches_select_agent` → `agent_branch_id()`), measured 1 | ✏️ **WRONG — fix.** Same shape as row 17. |
| 19 | 300 | agent: sees policy product + status "but **never the cover amount or premium**" | `sip_select_agent` and `insurance_policies_select_agent` return the **whole row**, `cover` and `premium_monthly` included. No column-level grant narrows an agent's SELECT. The redaction happens in `services/agent.js` | ⚠️ **MISLEADING — qualify.** True of the UI, false of the authorization boundary. A direct PostgREST call with an agent JWT sees both figures. In a document whose job is the access contract, "never" must not be left unqualified. |
| 20 | 3, 49, 61-64, 341-349 | The A26-004 corrections applied by commit `957c01e` — distributor own-network scoping, `0084`+`0094` closure, `contribution_run_lines` dropped, `distributors_select_admin`/`_self`, the four role rows in the summary table | All re-verified against live and **still correct** | ✅ **KEEP.** |

### Verdict on `A02-007` — correct the doc, do **not** widen RLS

The finding offered two directions. The measured position:

* The restriction still reproduces exactly (subscriber/agent/branch/employer = 0, distributor = 1,
  admin = 3).
* **Nothing renders "Operated by …".** The string does not exist in `src/`. The five
  `useEntity('distributor')` call sites are `Settings.jsx:37`, `DistributorOverview.jsx:162`,
  `DistributorHomeMobile.jsx:118`, `DistributorHubMobile.jsx:61`, `SettingsMobile.jsx:16` — every
  one inside the distributor shell, which has `distributors_select_self`. No blank field, no
  broken UI, no user-visible defect for any role.
* So there is nothing to fix in the product, and re-opening a cross-tenant read on the tenant table
  to satisfy a sentence would run directly against `0080`–`0089`, the distributor-scoping work this
  same programme hardened.

**Decision: correct the four role rows (already done by `957c01e`, re-verified here) and sharpen
the A02-007 note. No policy change. `distributors_select_attribution` is NOT created.**

---

## 5. Discrepancy count

The audit said **seven**. Re-measured against live today it is **nineteen** — but that number needs
its provenance stated, because it is not a claim that the doc got worse:

* The original seven (`A26-004` items 1–7) were **all fixed** by commit `957c01e` and all
  re-verified correct here. They are row 20 of §4, the KEEP row.
* Of the nineteen now open: **eleven** (§4 rows 1–11) are in the distributor **Pages/Views** and
  **Actions** tables — surfaces the audit sampled at `:340`/`:348` but never walked row by row.
  They are the same self-contradiction against line 49, in eleven more places.
* **Two** (rows 12, 13) are *newly* wrong — text written on the morning of 2026-08-25 that
  migrations `0118`, `0119`, `0127` and `0128` invalidated within hours of it being committed.
* **Four** (rows 14, 16, 17, 18) are pre-existing, unsampled, and each states an access boundary
  the live catalog contradicts.
* **Two** (rows 15, 19) are true of the UI but not of the authorization boundary — the category
  most likely to mislead the next engineer, because both read as reassurance.

So: 7 found → 7 fixed → 19 more found by walking every row instead of the seven cited lines. The
count moved because the method changed, not because the file regressed. **Do not treat 19 as the
ceiling** — this pass walked every *access* claim, not every sentence.

**Direction of error matters more than the count.** Sixteen of the nineteen describe the platform
as **more open** than it is; three (rows 12, 15, 19) describe it as **safer** or **more broken**
than it is. Row 12 is the dangerous one in the old direction and rows 15/19 in the new: a reader
who believed row 12 would think the money tables are still writable by any subscriber, and a reader
who believed row 19 would think RLS hides premiums from agents. Both would make the wrong call.

---

## 6. Reproduce this

```bash
cd ~/Desktop/Projects/uganda-dashboard

# SELECT matrix — role-simulated, rolled back, commit-guarded
scripts/psql-probe.sh <probe.sql>     # generator + inputs: see §1

# Write surface — no writes needed, the catalog is exact
psql "$SUPABASE_DB_URL" -X -At -F'|' -c \
  "SELECT tablename,policyname,cmd FROM pg_policies
    WHERE schemaname='public' AND cmd<>'SELECT' ORDER BY 1,2;"     # expect exactly 10 rows

psql "$SUPABASE_DB_URL" -X -At -F'|' -c \
  "SELECT table_name,grantee,string_agg(DISTINCT privilege_type,',' ORDER BY privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee IN ('anon','authenticated')
    GROUP BY 1,2 ORDER BY 1,2;"

# The two claims most worth re-checking before trusting this file
psql "$SUPABASE_DB_URL" -X -At -c \
  "SELECT pg_get_functiondef('public.apply_settlement(jsonb,text)'::regprocedure)
          ILIKE '%not_your_agent%';"                                # expect t  (0109 live)
psql "$SUPABASE_DB_URL" -X -At -c \
  "SELECT has_function_privilege('authenticated',
          'public.register_login_identity(text,text,text,text,text,text)','EXECUTE');"  # expect f (0128 live)

grep -rn "Operated by" src/                                          # expect: no matches
```

**These numbers decay fast.** They were true at 2026-08-25. `0130` is on the shelf and would change
§3 the day anyone applies it. Re-measure before relying on any cell here.
