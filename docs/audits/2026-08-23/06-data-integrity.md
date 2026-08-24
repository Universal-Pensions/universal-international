# A06 · Data integrity & reconciliation

**Snapshot taken:** 2026-08-24 08:18:55 UTC → 08:21:51 UTC (live project `ilkhfnoyxlxwqadebnkp`).
**Report-only.** No product code, SQL, migration or config was modified. Every write probe ran
inside `BEGIN … ROLLBACK` and post-rollback state was re-verified. **No fixture rows were left
behind** — see §9.

> ⚠️ **Live counts moved DURING this audit.** Baseline (2026-08-23) recorded `transactions` 29027 /
> `users` 48. At 08:18 today they read **29199 / 54**, and `entity_status_log` went 62 → 64,
> `settlement_uploads` 145 → 153, `subscriber_signup_uploads` 96 → 98 *between two of my own
> queries*. Other audit agents are writing to live right now. Every number below is a snapshot at
> the stated time, not a stable value.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 46 (37 tables + 7 `src/data/*` + `e2e/specs/db/invariants.spec.ts` + `scripts/seed-supabase.mjs`) |
| Artifacts examined | 43 |
| Coverage | 93% |
| Checks defined | 24 |
| Checks executed | 24 |
| Checks passed / failed / blocked | 13 / 11 / 0 |
| Findings C / H / M / L / I | 1 / 6 / 4 / 6 / 3 |
| Evidence commands run | 34 |
| Excluded as demo-scope | 1 (`contact_submissions` / `agent_referrals` both empty — 0 rows is not evidence the writer is broken; route probing belongs to A02/A08) |
| Blocked, with reason | none |

### Domain metrics
| Metric | Value |
|---|---|
| Invariants defined | 8 existing + **22 new** = **30** |
| Invariants run | 30 |
| Invariants passed | 24 |
| Invariants violated | **6** |
| Rows violating each | see §1.3 table |
| Clock-drift sites found | **9** (across **3** distinct anchor values: `2026-05-18`, `2026-05-26`, `2026-07-01`) |
| Table count deltas | 4 tables off their seed target (`subscribers` +6, `agents` +3, `branches` +1, `transactions` +1 891 EMP residue) |
| Orphans by table | **0** in all 9 `SUBSCRIBER_CHILD_TABLES`; **0** across 12 further cross-entity relationships |
| Login-identity mismatches | 0 dangling `entity_id`; 0 approved-request mismatches; **39** `users` rows with NULL `entity_id`; **1 reproducible cross-tenant provisioning hole** |

---

## 1. Invariants

### 1.1 The 8 existing invariants — ALL PASS

`e2e/specs/db/invariants.spec.ts` asserts 8 things through PostgREST. I re-ran every one directly
against Postgres (service-role `psql`, RLS-blind, so a PostgREST quirk cannot mask a violation).

```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' <<'SQL'  … (full script in §10) …
INV1 dup_agent_emails
0
INV2 dup_subscriber_nin
0
INV3 commission_status_outside_due_paid
0
INV4a paid_no_paid_date
0
INV4b paid_no_paid_amount
0
INV4c due_with_paid_date
0
INV5 schedules_next_due_before_2026-05-26
0
INV6 distributors_d001
1
INV7 rpcs_present
1|1
INV8 orphaned_attribution
0
```

All 8 pass. **Two of them pass for the wrong reason** — see A06-008 (INV5 is vacuous) and A06-019
(INV2 covers 22 of 5 064 rows).

### 1.2 The 22 new invariants

| # | Invariant | Result |
|---|---|---|
| N01 | nominee `share` sums to exactly 100 per **(subscriber, type)** | ✅ 0 violations |
| N02 | no orphan nominees | ✅ 0 |
| N03 | every subscriber holds BOTH a pension and an insurance nominee set (or neither) | ✅ 5 001 both / 0 one-sided |
| N04 | no duplicate phone in `subscribers` | ✅ 0 |
| N05 | no duplicate phone in `agents` | ✅ 0 |
| N06 | no duplicate `(phone, role)` in `users` | ✅ 0 (7 phones carry >1 **role** — legal: PK is `role:phone`) |
| N07 | `subscribers.agent_id` resolves | ✅ 0 dangling |
| N08 | `subscribers.district_id` resolves | ✅ 0 dangling (5 NULL) |
| N09 | `subscribers.employer_id` resolves | ✅ 0 dangling |
| N10 | `agents.branch_id`, `branches.district_id/distributor_id`, `districts.region_id` resolve | ✅ 0 dangling (1 NULL `distributor_id`) |
| N11 | `commissions.{agent,branch,subscriber}_id` + `transactions.{subscriber,agent}_id` resolve | ✅ 0 |
| N12 | every `employers.default_contribution_config` passes `_assert_contribution_config_shape` | ✅ 0 failures |
| N13 | `retirement_pct + emergency_pct = 100` on every schedule | ✅ 0 |
| N14 | every schedule has `amount > 0` | ❌ **21** → A06-015 |
| N15 | ≤ 1 self-paid `premium` transaction per subscriber | ❌ **2** → A06-018 |
| N16 | every self-paid `premium` = `premium_monthly × 12` = 24 000 | ❌ **3** → A06-018 |
| N17 | no `premium` row uses `method='Auto-debit'` | ✅ 0 |
| N18 | no `insurance_premium` row on a non-employer source | ✅ 0 |
| N19 | every employer member has BOTH `employer_id` AND `compensation` | ✅ 0 violations (58/58 members) |
| N20 | `retirement_balance + emergency_balance = total_balance` (±1) | ✅ 0 |
| N21 | no negative balance / unit count; no NULL `units`/`nav_as_of` | ✅ 0 |
| N22 | `transactions.amount` sign matches type (withdrawal < 0) | ❌ **1** → A06-014 |

### 1.3 Rows violating each broken invariant

| Invariant | Rows | Which |
|---|---|---|
| N14 amount > 0 | 21 | `empe-001` … `empe-021` |
| N15 ≤1 self-paid premium | 2 | `s-0701`, `s-0703` |
| N16 premium = 24 000 | 3 | `t-demo-recon-1/2/3` (45 000 / 62 000 / 38 000) |
| N22 withdrawal sign | 1 | `tx-s-100117-wd-9d3276ed45564b3caead81d55fca579b` (+5 000) |
| INV5 vacuity (latent) | 717 | schedules with `next_due_date < current_date` that INV5 reports as 0 |
| A06-004 policy status | 1 284 | `insurance_policies` rows `status='active'` with `renewal_date < 2026-07-01` |

---

## 2. THE 4-ROW GAP — chased to a conclusion

`subscribers` 5 064 vs `subscriber_balances` 5 060. The four are:

```
$ psql … -c "select s.id, s.name, s.phone, s.agent_id, s.employer_id, s.district_id,
             s.is_demo_signup, s.created_at
             from public.subscribers s
             left join public.subscriber_balances b on b.subscriber_id=s.id
             where b.subscriber_id is null order by s.created_at;"
tst-sub-tree-msc7vzsc |TST tree member    |+25679sc7vzsc|||| t |2026-08-02 19:53:06.406768+00
tst-sub-emp-msc7vzsc  |TST employer member|+25678sc7vzsc|||| t |2026-08-02 19:53:08.307374+00
tst-sub-retag-msc7vzsc|TST retag probe    |+25677sc7vzsc|||| t |2026-08-03 10:29:56.575797+00
tst-sub-tree-msd3855c |TST tree member    |+25679sd3855c|||| t |2026-08-03 10:29:56.575797+00
```

**How they were created.** `is_demo_signup = true`, ids follow the `tst-<purpose>-<base36 ms>` shape
used by the Playwright RLS/tree fixtures, and the suffixes (`msc7vzsc`, `msd3855c`) match
`entity_status_log` scope ids from the same minutes (`tst-dist-msc7vzsc`-era rows at
2026-08-02 19:53 and 2026-08-03 10:29). They are **abandoned E2E fixtures from the 2026-08-02/03
runs**, created directly (not through `create_subscriber_from_signup`, which also writes a balance
row), and never cleaned up. They carry **zero child rows in all 12 subscriber-FK tables**.

**Would a rep see a broken screen?** Yes — and not the one you would guess. They have no agent, no
employer and no district, so they are invisible to every scoped roster. But the platform ships a
reconciliation view whose FIRST check is exactly "member has no balance record":

```
$ psql … -c "select kind, check_code, issue, ref_id, who from public.v_reconciliation_exceptions
             order by check_code, ref_id;"
transaction|agent_mismatch |Transaction credited to an agent who does not own this member|t-demo-recon-1|Denis Byaruhanga
transaction|agent_mismatch |Transaction credited to an agent who does not own this member|t-demo-recon-2|Grace Asiimwe
transaction|agent_mismatch |Transaction credited to an agent who does not own this member|t-demo-recon-3|Denis Byaruhanga
user       |missing_balance|Member has no balance record|tst-sub-emp-msc7vzsc  |TST employer member
user       |missing_balance|Member has no balance record|tst-sub-retag-msc7vzsc|TST retag probe
user       |missing_balance|Member has no balance record|tst-sub-tree-msc7vzsc |TST tree member
user       |missing_balance|Member has no balance record|tst-sub-tree-msd3855c |TST tree member
```

The Admin reconciliation screen shows **7 exceptions, 4 of which are literally named
"TST tree member", "TST employer member" and "TST retag probe"**. The 3 `t-demo-recon-*` rows are
*deliberate* demo fixtures (seeded 2026-08-08 alongside the `ar-demo-*` / `d-003` demo set) that
tell a nice story; the 4 TST rows are test litter sitting next to them. → **A06-006**.

---

## 3. Clock drift — 9 sites, 3 values, and what each one actually breaks

### 3.1 The sites

| # | Site | Value | Kind | What it drives |
|---|---|---|---|---|
| 1 | `src/data/mockData.js:25` `new Date(2026, 6, 1)` | **2026-07-01** | executable | the entire JS mock population + `currentTime()`, consumed by `services/commissions.js`, `services/notifications.js`, `services/subscriber.js:145/182/545/958`, `utils/settlementCycle.js` |
| 2 | `scripts/seed-supabase.mjs:169` `new Date(2026, 4, 26)` | **2026-05-26** | executable | `DATE_SHIFT_DAYS` → re-anchors every forward-looking date the seed writes |
| 3 | `e2e/specs/db/invariants.spec.ts:61` `'2026-05-26'` | **2026-05-26** | executable | the INV5 freshness assertion |
| 4 | `src/utils/periodSettlement.test.js:11` | **2026-05-26** | executable | 30+ settle-period unit assertions |
| 5 | `src/utils/policies.test.js:14` | **2026-05-26** | executable | policy active/expired unit assertions (**not listed in my brief — a 5th executable copy**) |
| 6 | `public._demo_now()` (live DB) | **2026-05-18 23:59:59+00** | executable | `get_entity_metrics_rollup`, `get_employer_activity_rollup`, `get_top_branch`, `submit_hospital_cash_claim` (**a 5th distinct clock, and the only one in SQL**) |
| 7 | `src/admin-dashboard/overview/adminAttentionDerive.js:13` | 2026-05-26 (comment) | stale doc | — |
| 8 | `src/data/employerSeed.js:14` | 2026-05-26 (comment) | stale doc | — |
| 9 | `src/services/adminAttention.js:19` | "a third clock again" (comment) | stale doc | — |

```
$ psql … -c "select public._demo_now();"
2026-05-18 23:59:59+00
$ psql … -c "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.prosrc ilike '%_demo_now%' and p.proname<>'_demo_now';"
get_employer_activity_rollup
get_entity_metrics_rollup
get_top_branch
submit_hospital_cash_claim
```

### 3.2 The seed's comment is FALSE, and it costs 36 days of demo realism

`scripts/seed-supabase.mjs:166-168` says verbatim:

> `MOCK_NOW MUST mirror src/data/mockData.js (`new Date(2026, 4, 26)` = 2026-05-26).`
> `If that constant moves, update this to match`

It moved (mockData.js:21-25 documents the roll-forward to 2026-07-01 "per ADR-006"). The seed was
not updated. The arithmetic consequence is exact and provable:

* `mockData.js:357-361` — `nextDueOffsetDays = randInt(1, 30)`; `nextDue = MOCK_NOW + offset`
  ⇒ **2026-07-02 … 2026-07-31**.
* `seed-supabase.mjs:174-177` — `DATE_SHIFT_DAYS = SEED_TODAY − MOCK_NOW_seed`. The seed ran
  2026-07-27 (`created_at` of every seeded row = `2026-07-27 14:26:06.958998+00`), so
  `DATE_SHIFT_DAYS = 2026-07-27 − 2026-05-26 = 62`.
* `reanchorDateStr` (line 696) ⇒ **2026-09-02 … 2026-10-01**.

Live data matches the prediction to the row:

```
$ psql … -c "select to_char(next_due_date,'YYYY-MM'), count(*)
             from public.contribution_schedules group by 1 order by 1;"
2026-07|716        ← the deliberate ~18% overdue backlog (seeded against SEED_TODAY, not re-anchored)
2026-08|1
2026-09|4137       ← predicted 2026-09-02 … 2026-09-30
2026-10|147        ← predicted … 2026-10-01
       |21         ← NULL (empe-* employer members)
```

**With a correct mirror**, `DATE_SHIFT_DAYS` would be `2026-07-27 − 2026-07-01 = 26`, putting every
schedule at **2026-07-28 … 2026-08-26** — i.e. "due in 1–30 days" from the seed run, which is the
stated design intent ("preserving their MOCK_NOW-relative offset … so no schedule is born stale").
Instead `randInt(1,30)` becomes an effective `randInt(37,66)`.

**What a rep actually sees.** The offset is not cosmetic — it breaks the schedule's own frequency:

```
$ psql … -c "select subscriber_id, frequency, amount::bigint, next_due_date,
             (next_due_date - current_date) days_from_today,
             (next_due_date - date '2026-07-27') days_from_seed_run
             from public.contribution_schedules
             where subscriber_id in ('s-0001','s-0002','s-0003','s-0004','s-0005') order by 1;"
s-0001|annually |500000|2026-09-29|36|64
s-0002|monthly  | 13000|2026-09-09|16|44   ← a MONTHLY plan next due 44 days after seeding
s-0003|annually |348000|2026-09-20|27|55
s-0004|weekly   | 10000|2026-09-22|29|57   ← a WEEKLY plan next due 57 days after seeding
s-0005|quarterly| 57000|2026-09-29|36|64

$ psql … -c "select count(*) from public.contribution_schedules
             where frequency='weekly' and next_due_date > current_date + 7;"
610          (of 701 weekly savers — max 38 days out)
$ psql … -c "select count(*) from public.contribution_schedules
             where frequency='monthly' and next_due_date > current_date + 31;"
391          (of 2102 monthly savers)
```

`s-0004` is a **weekly** saver whose next payment is two months away. `s-0002` — the save-to-cover
demo persona a rep is most likely to open — is a **monthly** saver next due in six weeks. → **A06-003**

The same over-shift lands on other reanchored constants:
`seed-supabase.mjs:751-752` writes every `subscriber_insurance_products` row with
`policy_start = reanchorDateStr('2026-01-01')` and `renewal_date = reanchorDateStr('2027-01-01')`.
Live confirms **2026-03-04 / 2027-03-04** for all 1 473 rows (intended: 2026-01-27 / 2027-01-27).

### 3.3 INV5 is now vacuous — proven, not argued

```
$ psql … -c "select min(next_due_date), max(next_due_date), count(*) from public.contribution_schedules;"
2026-07-06|2026-10-01|5022

$ psql … -c "select count(*) filter (where next_due_date < date '2026-05-26') lt_seed_anchor,
             count(*) filter (where next_due_date < date '2026-07-01')       lt_mockdata,
             count(*) filter (where next_due_date < current_date)            lt_today,
             count(*) filter (where next_due_date is null)                   null_due
             from public.contribution_schedules;"
0|0|717|21
```

Three separate ways INV5 cannot fail:

1. **41 days of slack.** The live minimum is `2026-07-06`; the assertion threshold is `2026-05-26`.
   A regression would have to move `next_due_date` back by more than six weeks before the test
   notices.
2. **It reports 0 while 717 rows ARE stale.** Against the wall clock, 717 schedules are between
   10 and 49 days overdue. The invariant's whole purpose ("every schedule row has a non-stale
   next_due_date") is unmet in live data and the guard is green.
3. **21 rows are invisible to it.** `.lt('next_due_date', isoDate)` is SQL `<`, so the 21 NULL
   `next_due_date` rows (`empe-001`…`empe-021`) are silently excluded — a schedule with *no* due
   date at all is the most stale state possible and the assertion cannot see it.

Note the drift between sites 1 and 3 does **not** change INV5's verdict — `lt_mockdata` is also 0.
The vacuity is caused by the 36-day over-shift in §3.2, which the stale anchor also caused.
→ **A06-008**

### 3.4 `_demo_now()` — the fifth clock, live in SQL

`adminAttentionDerive.js:11-16` states the rule ("NO DATE MATHS HERE. The server owns the clock")
and names three clocks. There are five, and the server's own one is 44 days behind mockData:

```
$ psql … <<'SQL'
with d as (select public._demo_now() n)
select (select count(*) from public.transactions t, d where t.type='contribution'
          and t.date >= date_trunc('day', d.n) and t.date < date_trunc('day', d.n)+interval '1 day') today,
       (select count(*) from public.transactions t, d where t.type='contribution'
          and t.date >= date_trunc('week', d.n) and t.date < date_trunc('week', d.n)+interval '1 week') this_week,
       (select count(*) from public.transactions t, d where t.type='contribution'
          and t.date >= date_trunc('month', d.n) and t.date < date_trunc('month', d.n)+interval '1 month') this_month;
SQL
28|29|5408          ← _demo_now = 2026-05-18
114|114|998         ← wall clock 2026-08-24
844|2524|1110       ← JS MOCK_NOW 2026-07-01
```

`_demo_now()` still lands inside the seeded data mass (2026-05 is the peak month, 5 408 rows), so
the admin/distributor "this month" tiles are not empty — the anchor was well chosen **for the
pre-roll-forward seed**. But "today = 28 contributions" and "this week = 29" now sit six weeks
behind the JS surfaces, which read 844 and 2 524 for the same labels off the same rows. Two roles
looking at the same platform on the same day get "today" numbers that differ by 30×. → **A06-009**

### 3.5 Stale sites with no runtime effect
`adminAttentionDerive.js:13` and `employerSeed.js:14` both name 2026-05-26; `employerSeed.js`
actually `import { MOCK_NOW }`s the live 2026-07-01 binding, so only the comment is wrong.
`periodSettlement.test.js:11` and `policies.test.js:14` pin the retired anchor as an injected `NOW`;
they pass, but they no longer exercise the clock the demo runs on. → **A06-017**

---

## 4. Seed vs live drift — every table, with the overshoot explained

Snapshot 2026-08-24 08:18:55 UTC. `count(*)` throughout (never `n_live_tup` — statistics are zeroed
by the restore).

| Table | Live | Seed target | Δ | Explanation |
|---|---|---|---|---|
| `subscribers` | **5064** | 5058 (`TARGET_SUBS`=5000 + 37 `emp-*` + 21 `empe-*`) | **+6** | 4 `tst-*` + 1 `s-e2e-emp-foreign-*` + 1 `s-100117` (real self-signup, 2026-08-07) |
| `subscriber_balances` | **5060** | 5064 | **−4** | the 4 `tst-*` fixtures (§2) |
| `subscriber_balances_pre_nav` | 5060 | 5060 | 0 | NAV cutover snapshot |
| `subscribers_unit_value_pre_nav` | 5064 | 5064 | 0 | — |
| `transactions` | **29199** | ~27 300 | **+1891** | 1 881 `EMP-*` employer-run rows (33 runs) + 10 ad-hoc; see §5 |
| `agents` | **2046** | 2043 | **+3** | `a-demo-krm-001/002/003` (Karamoja demo set, 2026-08-08) |
| `branches` | **321** | 318 | **+3** | `b-demo-mrt-001`, `b-demo-kot-001` (Karamoja) + `tst-branch-msc7w8vm` (E2E litter) |
| `distributors` | **3** | 2 | **+1** | `d-003` Karamoja Pilot Network (demo set) |
| `districts` | 136 | 136 | 0 | ✅ |
| `regions` | 4 | 4 | 0 | ✅ |
| `commissions` | 5001 | ~5000 | +1 | — |
| `nominees` | 24388 | — | — | 5 001 subscribers × 1–4 × 2 types |
| `contribution_schedules` | 5022 | 5022 | 0 | 5000 + 21 `empe-*` + 1 |
| `insurance_policies` | 2731 | — | — | 2 730 active + 1 building |
| `subscriber_insurance_products` | 1473 | — | — | — |
| `claims` | 1907 | — | — | — |
| `withdrawals` | 4937 | — | — | — |
| `nav_snapshots` | 1246 | — | — | 1 242 published + **4 stale `pending`** → A06-020 |
| `users` | **54** | 12 personas | **+42** | 39 NULL-`entity_id` login breadcrumbs + 3 |
| `demo_personas` | 9 | 8 | +1 | `dp-3b45c63…` (Uniclusion, real approval) |
| `employers` | 8 | 7 | +1 | `emp-80511f65…` (real approval) |
| `access_requests` | **7** | 5 | **+2** | 2 A24 XSS probes (today) |
| `nominee_claims` | **11** | 9 | **+2** | 2 A24 XSS probes (today) |
| `contribution_runs` | **9** | 5 | +4 | 3 `run-demo-*` + 1 surviving E2E run |
| `contribution_run_uploads` | **33** | 0 | **+33** | idempotency nonces, cleanup never worked (§5) |
| `settlement_uploads` | **153** | 0 | **+153** | same class |
| `subscriber_signup_uploads` | **98** | 0 | **+98** | same class |
| `money_nonces` | 10 | 0 | +10 | same class |
| `entity_status_log` | **64** | 0 | **+64** | 100% `tst-*` E2E scope ids |
| `entity_detach_log` | **0** | 0 | 0 | ✅ no mass-detach recurrence |
| `contact_submissions` / `agent_referrals` | 0 / 0 | 0 | 0 | never exercised |
| `commission_config` | 3 | 3 | 0 | one per distributor |
| `employer_invites` | 4 | — | — | — |
| `custody_transfers` | 9 | — | — | — |
| `settlement_batches` | 5 | — | — | — |
| `notifications` | 10 | — | — | — |

**The overshoot is not seed noise. It is uncleaned test output**, and §5 is where it becomes money.

---

## 5. The employer contribution-run leak (the single biggest data-integrity defect found)

### 5.1 What is in the database

```
$ psql … -c "select date_trunc('day',created_at)::date, count(distinct txn_ref), count(*)
             from public.transactions where txn_ref like 'EMP-%' group by 1 order by 1;"
2026-07-30| 4|228
2026-07-31| 3|171
2026-08-01| 6|342
2026-08-02|12|684
2026-08-03| 3|171
2026-08-23| 2|114     ← the A00 Playwright baseline run
2026-08-24| 3|171     ← TODAY, another audit agent

$ psql … -c "select count(distinct txn_ref) refs, count(*) rows,
             count(*) filter (where contribution_run_id is not null) with_run_id
             from public.transactions where txn_ref like 'EMP-%';"
33|1881|57
```

**33 employer contribution runs. 1 881 transaction rows. 57 of them still attached to a run.**
`contribution_run_uploads` holds exactly 33 nonces — one per run — confirming the count.

### 5.2 Root cause, with the test's own words

`e2e/specs/flows/employer-contribution-run.spec.ts:66-71`:

```ts
// Employer-source transactions stamped by this run carry source='employer';
// there is no run_id FK on transactions, so we scope by the run's window is
// not reliable — instead delete the run rows + their lines (the ledger rows
// are demo-scope residue, consistent with the settlement spec's discipline).
await supabaseAdmin.from('contribution_runs').delete().in('id', runIds);
```

The premise is **factually wrong**:

```
$ psql … -c "select conname, pg_get_constraintdef(oid) from pg_constraint
             where conrelid='public.transactions'::regclass;"
transactions_contribution_run_id_fkey|FOREIGN KEY (contribution_run_id)
    REFERENCES contribution_runs(id) ON DELETE SET NULL
```

There **is** a `run_id` FK. The cleanup could have deleted the transactions by
`contribution_run_id IN (runIds)`. Instead it deletes only the header — and `ON DELETE SET NULL`
then erases the very column that identified them. Every run's rows become permanently
unattributable. Two further defects in the same 30 lines:

* `.from('contribution_run_lines')` — **that table does not exist**
  (`select count(*) from information_schema.tables where table_name='contribution_run_lines'` → `0`).
* `.from('contribution_run_uploads').delete().eq('employer_id', EMPLOYER_ID)` — that table has
  **no `employer_id` column** (`nonce, result, created_at`). The call is wrapped in
  `.then(() => undefined, () => undefined)`, so the error is swallowed. That is why 33 nonces
  accumulated.

### 5.3 The money

```
$ psql … -c "select type, source, count(*), sum(amount)::bigint from public.transactions
             where txn_ref like 'EMP-%' and created_at > timestamptz '2026-07-27 14:26:07+00'
             group by 1,2 order by 1,2;"
contribution     |employer|627|60146000
contribution     |own     |627|60146000
insurance_premium|employer|627|25080000

$ psql … -c "select sum(b.total_balance)::bigint from public.subscribers s
             join public.subscriber_balances b on b.subscriber_id=s.id where s.employer_id='emp-001';"
197491903
```

**120 292 000 UGX of the 197 491 903 UGX standing in `emp-001`'s roster — 60.9 % — is E2E test
residue.** `emp-001` is *Nile Breweries Demo Ltd*: the default employer persona
(`dp-e-001 / +256700000031`) and the `ROLE_DEFAULTS.employer` fallback every unrecognised employer
login lands on. It is the employer a rep demos.

Per-member it is worse, because it is visibly repetitive:

```
$ psql … -c "select count(*), count(*) filter (where txn_ref like 'EMP-%'), sum(amount)::bigint
             from public.transactions where subscriber_id='empe-001';"
116|99|23780000

$ psql … -c "select id, type, amount, date::date, source, txn_ref from public.transactions
             where subscriber_id='empe-001' and created_at > timestamptz '2026-07-27 14:26:07+00'
             order by created_at limit 12;"
t-ef9695a7…|contribution     |210000|2026-07-30|own     |EMP-d7980790
t-1eb55d0d…|contribution     |105000|2026-07-30|employer|EMP-d7980790
t-4407d3f2…|insurance_premium| 40000|2026-07-30|employer|EMP-d7980790
t-e91c8610…|contribution     |105000|2026-07-30|employer|EMP-32ef1f4a
t-ce3e9f2a…|insurance_premium| 40000|2026-07-30|employer|EMP-32ef1f4a
t-a88048fb…|contribution     |210000|2026-07-30|own     |EMP-32ef1f4a
t-6a852a90…|contribution     |105000|2026-07-30|employer|EMP-2ed0f1dd
t-d7d66b4b…|contribution     |210000|2026-07-30|own     |EMP-2ed0f1dd
t-971a7efd…|insurance_premium| 40000|2026-07-30|employer|EMP-2ed0f1dd
t-2af09e93…|insurance_premium| 40000|2026-07-30|employer|EMP-ef1d1d3b
t-fa1235cd…|contribution     |210000|2026-07-30|own     |EMP-ef1d1d3b
t-520e9dfc…|contribution     |105000|2026-07-30|employer|EMP-ef1d1d3b
```

**The identical July payroll triple, four times on one date.** Every one of the 19 members carries
99 such rows (33 runs × 3). Per-head, `emp-001`'s members hold 9.4 M UGX against 3.7 M for the next
employer:

```
$ psql … -c "select s.employer_id, count(*), sum(b.total_balance)::bigint from public.subscribers s
             join public.subscriber_balances b on b.subscriber_id=s.id
             where s.employer_id is not null group by 1 order by 3 desc;"
emp-001|21|197491903     ← 9.40 M/member
emp-004| 8| 33833117     ← 4.23 M
emp-002| 7| 25926552     ← 3.70 M
emp-003| 6| 18524479
emp-006| 6| 18267018
emp-007| 5| 16490925
emp-005| 5| 14696106
```

Platform-wide, post-seed writes add **121 567 000 UGX of contributions** to a 2 450 226 487 UGX AUM
— **5.0 % of total AUM is test residue**, and it grows by ~3.6 M UGX every time the suite runs.
→ **A06-001** (money) and **A06-002** (mechanism).

---

## 6. Mass-detach guard — CONFIRMED FIRING (both legs), tested and rolled back

`entity_detach_log` is **empty** — no recurrence of the 2026-07-27 incident. `entity_status_log`
holds 64 rows, every one an E2E `tst-*` scope id (max `id` 2423 against 64 live rows, so ~2 360
earlier rows were purged at some point).

```
$ psql … -c "select count(*) from public.subscribers where agent_id is not null;"
5001
$ psql … -v ON_ERROR_STOP=0 <<'SQL'
BEGIN;
UPDATE public.subscribers SET agent_id = NULL
 WHERE id IN (SELECT id FROM public.subscribers WHERE agent_id IS NOT NULL ORDER BY id LIMIT 60);
ROLLBACK;
SQL
ERROR:  mass agent detach blocked: 60 of 60 rows unjournalled — use set_distributor_status()
CONTEXT:  PL/pgSQL function guard_mass_subscriber_detach() line 20 at RAISE
$ psql … -c "select count(*) from public.subscribers where agent_id is not null;"
5001
```

The employer leg fires too:

```
BEGIN; UPDATE public.subscribers SET employer_id = NULL WHERE employer_id IS NOT NULL; ROLLBACK;
ERROR:  mass employer detach blocked: 58 of 58 rows unjournalled — use set_employer_status()
CONTEXT:  PL/pgSQL function guard_mass_subscriber_detach() line 38 at RAISE

-- post-rollback verify (agent-linked | employer-linked | total)
5001|58|5064
```

**Blind spot.** The threshold is `> 50` and the trigger is `FOR EACH STATEMENT`. A 50-row statement
passes silently:

```
BEGIN;
UPDATE public.subscribers SET agent_id = NULL
 WHERE id IN (SELECT id FROM public.subscribers WHERE agent_id IS NOT NULL ORDER BY id LIMIT 50);
SELECT 'rows now unattached: '||count(*) FROM public.subscribers WHERE agent_id IS NULL;
ROLLBACK;
rows now unattached: 113        ← 63 legitimately NULL + 50 just detached, NO error
```

101 statements of 50 would detach all 5 001 without tripping the guard. The 0060 incident was a
single 5 003-row statement, so the guard does close the observed hole — but it is a bulk-statement
guard, not a cumulative one. → **A06-016** (low; documented, not a regression).

---

## 7. Orphan sweep — zero orphans, one list gap

```
$ psql … (9 SUBSCRIBER_CHILD_TABLES)
transactions|0   nominees|0   subscriber_balances|0   contribution_schedules|0
insurance_policies|0   subscriber_insurance_products|0   claims|0   withdrawals|0   commissions|0

$ psql … (12 further cross-entity relationships)
commissions.agent_id|0            settlement_batches.agent_id|0    settlement_batches.branch_id|0
contribution_runs.employer_id|0   employer_invites.employer_id|0   commission_config.distributor_id|0
demo_personas.entity_id(agent)|0  …(branch)|0  …(distributor)|0    …(employer)|0
nominee_claims.matched_subscriber_id|0                             agents.branch_id|0
```

**Zero orphans anywhere.** But `SUBSCRIBER_CHILD_TABLES` is incomplete:

```
$ psql … -c "select table_name from information_schema.columns
             where table_schema='public' and column_name='subscriber_id'
               and table_name not in (<the 9>) order by 1;"
employer_invites
entity_detach_log
money_nonces
subscriber_balances_pre_nav
v_reconciliation_exceptions
```

Three real tables (`money_nonces`, `subscriber_balances_pre_nav`, `employer_invites`) carry
`subscriber_id` and are not in the list. `cleanupSubscriberByPhone` walks only the 9, so it leaves
those rows to the FK cascade — precisely what the list's own docstring says it must not rely on
("so no orphans linger **if `ON DELETE CASCADE` is dropped** on a future migration"). Worse,
`subscriber_balances_pre_nav` has **no FK at all**:

```
$ psql … -c "select c.relname, con.conname, pg_get_constraintdef(con.oid) from pg_constraint con
             join pg_class c on c.oid=con.conrelid … where c.relname in
             ('money_nonces','subscriber_balances_pre_nav','subscribers_unit_value_pre_nav',
              'employer_invites','entity_detach_log') and con.contype='f';"
employer_invites  |…_employer_id_fkey  |FOREIGN KEY (employer_id)   REFERENCES employers(id)   ON DELETE CASCADE
employer_invites  |…_subscriber_id_fkey|FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL
entity_detach_log |…_subscriber_id_fkey|FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
money_nonces      |…_subscriber_id_fkey|FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
```

`subscriber_balances_pre_nav` (5 060 rows) and `subscribers_unit_value_pre_nav` (5 064 rows) have
**no FK to `subscribers`**, so nothing removes their rows when a subscriber is deleted, and nothing
in the cleanup list targets them. Live count is 0 orphans only because no seeded subscriber has been
deleted since the NAV cutover. → **A06-010**

---

## 8. Unbounded public-write tables + LIVE stored-XSS payloads

| Table | Rows | Junk / payloads |
|---|---|---|
| `access_requests` | 7 | **2 rows carrying script payloads** |
| `nominee_claims` | 11 | **2 rows carrying script payloads** |
| `agent_referrals` | 0 | — |
| `contact_submissions` | 0 | — |

I scanned **every `text`/`varchar` column of every base table** in the schema for
`<script`, `onerror=`, `onload=`, `javascript:`, `<img … src=`, `<svg`, `<iframe`, `{{`, `${`,
SQL metacharacters and trailing `--`:

```
$ psql … <<'SQL' (DO block iterating information_schema.columns) …
NOTICE:  HIT access_requests . contact_email  => 1 row(s)
NOTICE:  HIT access_requests . contact_name   => 2 row(s)
NOTICE:  HIT access_requests . district       => 1 row(s)
NOTICE:  HIT access_requests . message        => 1 row(s)
NOTICE:  HIT access_requests . org_name       => 2 row(s)
NOTICE:  HIT access_requests . registration_no=> 1 row(s)
NOTICE:  HIT access_requests . sector         => 1 row(s)
NOTICE:  HIT nominee_claims  . claimant_name  => 2 row(s)
NOTICE:  HIT nominee_claims  . deceased_name  => 2 row(s)
NOTICE:  HIT nominee_claims  . deceased_nin   => 1 row(s)
NOTICE:  HIT nominee_claims  . district       => 1 row(s)
NOTICE:  HIT nominee_claims  . notes          => 1 row(s)
NOTICE:  HIT nominee_claims  . relationship   => 1 row(s)
NOTICE:  TOTAL flagged column-hits: 17
```

**Every hit belongs to 4 rows, all created 2026-08-24 08:04:59 – 08:05:03 — the A24 XSS probe,
which is still in the live database.** There is no pre-existing junk anywhere in the schema.

```
ar-1787558699527-rmm4|employer|A24XSSPROBE <img src=x onerror="window.__A24_XSS_ORG=1">
  |A24XSSPROBE<svg/onload=window.__A24_XSS_NAME=1>
  |"><script>window.__A24_XSS_EMAIL=1</script>@a24probe.test|+256770000191
  |A24XSSPROBE"><img src=x onerror=window.__A24_XSS_SECTOR=1>
  |A24XSSPROBE<iframe src="javascript:window.__A24_XSS_DISTRICT=1"></iframe>
  |A24XSSPROBE<script>window.__A24_XSS_REG=1</script>|pending||2026-08-24 08:04:59.700516+00
  |A24XSSPROBE <script>window.__A24_XSS_MSG=1</script>
ar-1787558701196-dksm|distributor|A24XSSPROBE "><script>window.__A24_XSS_ORG2=1</script>|…|pending
nc-bbf6090b…|NC-BB9B0A6D|life   |A24XSSPROBE <img src=x onerror="window.__A24_XSS_DEC=1">|…|pending
nc-d810114b…|NC-E40BFC56|funeral|A24XSSPROBE2 "><script>window.__A24_XSS_DEC2=1</script>|…|pending
```

All 4 are `status='pending'` and are the **newest** rows in their tables, so they sit at the top of
the admin Access-requests and Nominee-claims queues, and they push the admin "Needs attention"
pending-access-requests count from 4 to **6**:

```
$ psql … -c "select count(*) filter (where status='pending'), count(*) from public.access_requests;"
6|7
```

**Whether they execute is A24's call** — I am reporting the storage side, which is unambiguous: a
rep opening either admin queue today sees `A24XSSPROBE <img src=x onerror=…>` as the first row.
These rows must be deleted before any demo. I did not delete them: they are another agent's probe
fixtures and removing them could invalidate A24's render-side verification. → **A06-007**

---

## 9. Login-identity coherence — the 0090/0095/0101 class, re-verified against LIVE

### 9.1 What holds

`src/test/login-identity-contract.test.js` only greps **migration text**. I verified the same
contract against `pg_proc.prosrc` on the live database, and then against live rows.

```
$ psql … -c "select p.proname, (position('register_login_identity' in p.prosrc)>0) calls_rli,
             (position('demo_personas' in p.prosrc)>0) touches_dp from pg_proc p … ;"
approve_access_request              |t|t
create_distributor                  |t|f
create_employer                     |t|f
create_subscriber_from_employer_invite|f|f
create_subscriber_from_signup       |f|f
register_login_identity             |f|t
```

* ✅ **The 0101 fix is live.** All three provisioning RPCs call `register_login_identity`.
* ✅ **The one approved access request is coherent** — `ar-1786103803205-x30h` →
  `emp-80511f65…`, with `persona_ok=1` and `user_ok=1` (matching phone, role and `entity_id`).
* ✅ **All 9 `demo_personas` rows have a matching `users` row** with the same `entity_id`.
* ✅ **Zero dangling `entity_id`** — every non-NULL `users.entity_id` resolves to a live row of its
  role's table.

### 9.2 The hole that survives — REPRODUCED

`register_login_identity` **returns NULL and writes nothing** when the `(phone, role)` pair is
already bound to a different entity:

```
BEGIN;
select id, phone, role, entity_id from public.demo_personas
  where phone='+256700000031' and role='employer';
dp-e-001|+256700000031|employer|emp-001
select coalesce(public.register_login_identity(
         '+256700000031','employer','emp-A06-PROBE','Probe Co',null),
       '(NULL RETURNED — identity NOT written)');
(NULL RETURNED — identity NOT written)
ROLLBACK;
```

`approve_access_request` checks the return and aborts (`IF v_bound IS NULL THEN RAISE EXCEPTION
'Cannot approve %: failed to register % as the sign-in for %.'`). **`create_employer` and
`create_distributor` use `PERFORM` and ignore it:**

```
$ psql … -c "select p.proname||' :: '||l from pg_proc p …, lateral unnest(string_to_array(p.prosrc,E'\n')) l
             where l ilike '%register_login_identity%' and p.proname<>'register_login_identity';"
approve_access_request :: v_bound := public.register_login_identity(
create_employer        :: PERFORM public.register_login_identity(
create_distributor     :: PERFORM public.register_login_identity(
```

Driven end-to-end through the admin "+ New Employer" door, with an admin JWT, inside a rolled-back
transaction:

```
BEGIN;
select set_config('request.jwt.claims',
  '{"app_role":"admin","adminId":"admin-001","role":"authenticated"}', true);
select public.create_employer('A06 Probe Co','Agriculture','A06-REG-1','Probe Owner',
                              '+256700000031','probe@a06.test','d-kampala','monthly','{}'::jsonb);
{"id": "emp-b78ccd0755cf4b59a8fca5678f143cfc", "name": "A06 Probe Co", … "status": "active" …}

-- sign-in bindings for the new employer (demo_personas | users)
0|0
-- what +256700000031 / employer STILL resolves to
emp-001
ROLLBACK;
== POST-ROLLBACK VERIFY (employers|demo_personas|users|probe rows)
8|9|54|0
```

**The employer is created and returned as a success. It has no `demo_personas` row and no `users`
row. Its owner's phone still resolves to `emp-001` — Nile Breweries.** Per
`api/auth/_lib/personas.ts:96-110`, `resolveDemoPersona` misses and returns
`ROLE_DEFAULTS.employer = 'emp-001'`, so the new employer's owner signs in **inside Nile Breweries'
tenant with write access to their roster, and nothing errors** — the exact failure the contract
test's own header describes as having "shipped to production twice". `create_distributor` has the
identical shape (fallback `d-001`).

The contract test cannot catch this: it asserts only that the string `register_login_identity`
appears in the newest definition, never that the caller checks the result. → **A06-005**

### 9.3 Login breadcrumbs (not a regression)

```
$ psql … -c "select role, count(*) from public.users where entity_id is null group by 1 order by 2 desc;"
subscriber|13   admin|12   distributor|6   employer|4   branch|2   agent|2
```

39 of 54 `users` rows carry no `entity_id`. These are **not** broken provisioning:
`api/auth/verify-otp.ts:67-99` upserts a `users(phone, role)` row on *every* sign-in with no
`entity_id`, so any phone anyone ever typed leaves a row. Subscriber logins resolve through
`subscribers.phone` (not `users`), and non-subscriber logins through `demo_personas`, so these rows
are inert. Worth knowing when reading the table, and worth pruning. → **A06-013**

One collision to be aware of: `distributor:+256700000011` was created **today at 07:44:10** by an
audit agent, on the phone that `dp-b-001` uses for the `b-kam-015` branch-admin persona. It has no
`demo_personas` counterpart, so signing in as *distributor* on that phone falls back to `d-001`.

### 9.4 Entities with no sign-in path

```
$ psql … (7e)
employer   |emp-002|Mbarara Dairy Co-op
employer   |emp-003|Gulu Traders Union
employer   |emp-004|Jinja Steel Mills
employer   |emp-005|Mbale Coffee Collective
employer   |emp-006|Wakiso Agro Ltd
employer   |emp-007|Lira Cotton Ginnery
distributor|d-003  |Karamoja Pilot Network
```

Six of seven seeded employers and the Karamoja demo distributor have no persona. Any employer login
attempted on their contact phone lands on `emp-001`. Consistent with "one employer persona by
design", but it means the ROLE_DEFAULTS fallback is the *normal* path for six of eight employers.
→ **A06-012**

### 9.5 The only approval-path employer is malformed

`emp-80511f65be7a4656b2bd45b6fad18625` (Uniclusion Uganda) is the sole employer created through the
live `approve_access_request` → `create_employer` path — i.e. the exact row a rep produces when
demoing "approve an access request":

```
$ psql … -c "select id, name, sector, district, payroll_cadence, status,
             coalesce(default_contribution_config::text,'(null)') from public.employers …;"
emp-001                            |Nile Breweries Demo Ltd|Manufacturing|Kampala |monthly|active|{"employeePct":5,"employerPct":10,"insuranceEnabled":true,…}
emp-002 … emp-007                  |…                      |…            |Mbarara…|monthly|active|{"employeePct":10,"employerPct":5,"insuranceEnabled":false}
emp-80511f65be7a4656b2bd45b6fad18625|Uniclusion Uganda     |Fintechj     |d-budaka|       |active|{}
```

Three divergences from every seeded row, all on the one row a demo creates live:
`default_contribution_config = {}` (no `employeePct`/`employerPct` — the funding setup is empty),
`payroll_cadence` **NULL** (every other employer is `monthly`), and `district` holding the district
**ID** `d-budaka` where every seeded row holds a **name** (`Kampala`, `Gulu`, `Mbarara`). The empty
config still passes `_assert_contribution_config_shape` (it returns early on absent keys), so no
guard catches it. → **A06-011**

---

## 10. Cross-role policy-status divergence

Two code paths derive "is this cover active?" from the same rows, and they disagree.

* **Subscriber's own Policies page** — `src/utils/policies.js:56-60` `derivePolicyStatus` returns
  `renewalDate >= now ? 'active' : 'expired'`, with `now` supplied by
  `src/services/subscriber.js:145` as `currentTime()` = **MOCK_NOW 2026-07-01**.
* **Agent's member detail** — `src/services/agent.js:26-35` `buildAgentPolicies` reads the **stored
  flag**: `if (lifeIns && lifeIns.status === 'active' && Number(lifeIns.cover) > 0)`, and
  `src/services/agent.js:174` selects `insurance_policies(cover, premium_monthly, status)`.

```
$ psql … <<'SQL'
select count(*) from public.insurance_policies where status='active' and renewal_date < date '2026-07-01';
select count(*) from public.insurance_policies where status='active' and renewal_date < current_date;
select count(*) from public.insurance_policies where status='active' and renewal_date < date '2026-05-18';
select count(*) from public.insurance_policies where status='active';
SQL
1284      ← expired per the subscriber page (MOCK_NOW)
1473      ← expired per the wall clock
1143      ← expired per _demo_now()
2730      ← "active" per the agent page (stored flag)
```

For **1 284 members — 47 % of the seeded population** — the agent sees "Life cover · Active" while
the member's own dashboard says "Life cover · Expired", on the same day, from the same row. Demo
persona `s-0003` is one of them (`renewal_date 2026-04-16`). And because the count depends on which
of the three clocks a surface reads, the *number* of disagreeing members is itself clock-dependent
(1 143 / 1 284 / 1 473). → **A06-004**

---

## 11. Findings

| id | sev | conf | title |
|---|---|---|---|
| A06-001 | critical | confirmed | 61 % of the default employer persona's roster balance is uncleaned E2E test money |
| A06-002 | high | confirmed | E2E contribution-run cleanup orphans 1 824 transactions on a premise the schema refutes |
| A06-003 | high | confirmed | Seed's stale `MOCK_NOW` mirror pushes every schedule 36 days too far out; weekly savers due in 8 weeks |
| A06-004 | high | confirmed | Agent and subscriber disagree on 1 284 members' policy status |
| A06-005 | high | confirmed | `create_employer`/`create_distributor` ignore the identity-write failure → new tenant lands in Nile Breweries |
| A06-006 | high | confirmed | Four "TST …" E2E fixtures surface as 4 of 7 rows on the Admin Reconciliation screen |
| A06-007 | high | confirmed | Live stored XSS payloads sit at the top of two admin queues |
| A06-008 | medium | confirmed | DB invariant #5 is vacuous by 41 days and blind to 21 NULL rows |
| A06-009 | medium | confirmed | A fifth clock, `_demo_now() = 2026-05-18`, is live and 44 days behind the JS anchor |
| A06-010 | medium | confirmed | `SUBSCRIBER_CHILD_TABLES` misses 3 subscriber-FK tables; 2 have no FK at all |
| A06-011 | medium | confirmed | The only approval-path employer has an empty config, NULL cadence and a district ID in the name field |
| A06-012 | low | confirmed | Six of eight employers and `d-003` have no sign-in path |
| A06-013 | low | confirmed | 39 `users` rows carry no `entity_id` |
| A06-014 | low | confirmed | `request_withdrawal` writes a positive amount against a negative seed convention |
| A06-015 | low | confirmed | 21 employer-member schedules have `amount = 0` and NULL `next_due_date` |
| A06-016 | low | confirmed | Mass-detach guard passes 50-row batches unjournalled |
| A06-017 | low | confirmed | E2E entity residue across 6 tables |
| A06-018 | info | confirmed | The insurance-premium invariant is violated in live data by 3 deliberate demo fixtures |
| A06-019 | info | confirmed | The duplicate-NIN invariant covers 22 of 5 064 rows |
| A06-020 | info | confirmed | Four stale `pending` NAV snapshots sit behind a later published price |

---

## 12. Traceability

| # | Check (from the A06 spec) | Disposition |
|---|---|---|
| 1.1 | INV1 — no duplicate agent emails | **PASS** |
| 1.2 | INV2 — no duplicate subscriber NINs | **PASS** (near-vacuous → FINDING A06-019) |
| 1.3 | INV3 — commission status ∈ {due, paid} | **PASS** |
| 1.4 | INV4 — paid/due settlement-stamp coherence | **PASS** |
| 1.5 | INV5 — `next_due_date ≥ MOCK_NOW` | **PASS but vacuous → FINDING A06-008** |
| 1.6 | INV6 — `distributors` live, `d-001` present | **PASS** |
| 1.7 | INV7 — `apply_settlement` + `mark_notifications_read` in `pg_proc` | **PASS** |
| 1.8 | INV8 — no orphaned agent attribution | **PASS** |
| 1.9 | Nominee allocations sum to 100 per subscriber | **PASS** (per `(subscriber, type)`; naive per-subscriber sums to 200 because nominees are typed pension/insurance) |
| 1.10 | Orphan nominees | **PASS** (0) |
| 1.11 | Duplicate NIN; duplicate phone across subscribers AND users | **PASS** (0 dup NIN, 0 dup subscriber phone, 0 dup `(phone,role)`; 7 phones legally carry >1 role) |
| 1.12 | Every `agent_id` / `district_id` / `employer_id` resolves | **PASS** (0 dangling across all three, plus 9 further FKs) |
| 1.13 | Every contribution config passes `_assert_contribution_config_shape` | **PASS** (0/8 failures) — but see **FINDING A06-011** |
| 1.14 | Self-pay insurance ANNUAL only; ≤1 self-paid premium row | **FINDING A06-018** (2 subscribers with 2 rows, 3 off-amount rows — all 3 are deliberate `t-demo-recon-*` fixtures) |
| 1.15 | Every employer member has BOTH `employer_id` AND `compensation` | **PASS** (58/58) |
| 1.16 | THE 4-ROW GAP — identify, date, judge demo impact | **FINDING A06-006** (identified, dated to the 2026-08-02/03 E2E runs, proven to render on Admin Reconciliation) |
| 1.17 | Balance split `ret + emg = total` | **PASS** (0) |
| 1.18 | No negative balances/units, no NULL `units`/`nav_as_of` | **PASS** (0) |
| 1.19 | Transaction amount sign matches type | **FINDING A06-014** |
| 1.20 | Stored policy status vs renewal date | **FINDING A06-004** |
| 2 | CLOCK DRIFT — what each copy drives, which assertions are vacuous, what a rep sees, incl. the two stale comments; prove INV5 vacuity from live `next_due_date` | **FINDING A06-003, A06-008, A06-009, A06-017** (9 sites, 3 values, vacuity proven from the live distribution) |
| 3 | Seed vs live drift: every table's count + delta + explanation of the overshoot | **FINDING A06-001, A06-002** (full 37-table table in §4; overshoot traced to uncleaned E2E output) |
| 4 | `entity_detach_log`/`entity_status_log` recurrence; prove the 0080 guard fires via a rolled-back fixture | **PASS** (0 detach rows; both guard legs fire, verified rolled back) + **FINDING A06-016** for the 50-row threshold |
| 5 | Orphan sweep across the 9 `SUBSCRIBER_CHILD_TABLES` | **PASS** (0 orphans in all 9, and in 12 further relationships) + **FINDING A06-010** for the list gap |
| 6 | `access_requests`, `nominee_claims`, `agent_referrals`, `contact_submissions` — counts, junk, injection payloads | **FINDING A06-007** (schema-wide scan; the only payloads are A24's live probes) |
| 6b | `contact_submissions` / `agent_referrals` writer health | **EXCLUDED-DEMO-SCOPE** — both tables are empty; 0 rows is not evidence of breakage, and route probing would require a committed write (A02/A08 own it) |
| 7 | Login-identity coherence; verify `login-identity-contract.test.js` against LIVE | **FINDING A06-005, A06-011, A06-012, A06-013** (contract verified live at the `pg_proc` and row level — it holds; the residual hole is the unchecked return value, reproduced and rolled back) |

---

## 13. Fixture-row disclosure (G-compliance)

**I created no fixture rows.** Every write probe in this report ran inside an explicit
`BEGIN … ROLLBACK`, and each was followed by a verification query proving the pre-probe state:

| Probe | Verification after ROLLBACK |
|---|---|
| 60-row agent detach | `subscribers where agent_id is not null` = **5001** (unchanged) |
| 50-row agent detach (threshold) | `5001 \| 58 \| 5064` (agent-linked \| employer-linked \| total, unchanged) |
| 58-row employer detach | same, unchanged |
| `register_login_identity` collision | `demo_personas` **9**, `users` **54**, probe rows **0** |
| `create_employer` collision (admin JWT) | `employers` **8**, `demo_personas` **9**, `users` **54**, probe rows **0** |

The four A24 XSS probe rows in `access_requests` / `nominee_claims` and the 171 employer-run
transactions written on 2026-08-24 are **not mine** — they belong to other audit agents (§8, §5.1).
I did not delete them; removing another agent's probe fixtures could invalidate their verification.
They are reported here so the owning agents can clean up.
