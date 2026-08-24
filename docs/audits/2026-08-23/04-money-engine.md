# A04 · Money engine — NAV, units, balances, idempotency

**Run:** 2026-08-24 · **Repo:** `/Users/shubhang/Desktop/Projects/uganda-dashboard` @ `bd637f6`
**Live DB:** `ilkhfnoyxlxwqadebnkp` (Singapore) · **NAV at time of audit:** 1,571.40 UGX as at 2026-08-08

> **COMMITTED WRITES MADE: 0.** Every write probe ran inside `BEGIN … ROLLBACK` and every
> rollback was proven by re-reading the row afterwards. Six independent residue probes are
> quoted in §14. No NAV snapshot was published. No fixture row was left behind.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 47 |
| Artifacts examined | 47 |
| Coverage | 100% |
| Checks defined | 12 |
| Checks executed | 12 |
| Checks passed / failed / blocked | 7 / 5 / 0 (2 *sub*-checks blocked — see §13) |
| Findings C / H / M / L / I | 0 / 3 / 8 / 4 / 2 |
| Evidence commands run | 68 |
| Excluded as demo-scope | 3 (mobile-money method strings cosmetic; claims never leaving `submitted`; absence of a real custodian settlement rail) |
| Blocked, with reason | 2 sub-checks: (a) concurrent same-nonce execution — the two-session orchestration was **denied by the Claude Code auto-mode permission classifier**, so the concurrent case is reported at `plausible` from the RPC body per spec; (b) reproducing the `safeupdate` failure 0106 fixed — `sql_safe_updates` is `unrecognized configuration parameter` for a direct `postgres` psql session, which is exactly what 0106's header predicts |

### Domain metrics
| Metric | Value |
|---|---|
| Subscribers reconciled | **5,060** of 5,064 (4 excluded, §2) |
| Reconciliation mismatches (`total_balance` vs `units × NAV`) | **0** beyond rounding |
| Max abs delta | **0.499771 UGX** · net across the book **−11.99 UGX** |
| Three-way AUM: A `Σ subscriber_balances.total_balance` | **2,450,226,487** |
| Three-way AUM: B `get_nav_overview().aum` | **2,450,226,487** (Δ vs A = **0**) |
| Three-way AUM: C `Σ units × NAV` | **2,450,226,498.99** (Δ vs A = **−11.99**) |
| Three-way AUM: D `Σ transactions.amount` (corpus types) | **2,103,378,441** (Δ vs A = **+346,848,046**, fully decomposed §3) |
| Idempotency replays run / passed | 3 / 3 (serial) · concurrent: 0 run (blocked) |
| Guard cases run / passed | **17 / 11** (6 failures → A04-001, A04-002, A04-004, A04-005, A04-012) |
| Invariants defined / passed | **6 / 5** (the 1 failure is audit-caused, not product — §11) |
| **Committed writes made** | **0** |

---

## 1. Method

```
cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a
psql "$SUPABASE_DB_URL" -X -q ...
```
Live function bodies were read from `pg_proc.prosrc`, never from the migration files (G8). All
eleven money functions are dumped verbatim under `docs/audits/2026-08-23/a04/fn_*.sql`; the probe
scripts are `docs/audits/2026-08-23/a04/probe_*.sql`. Write probes used
`SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', …, true)` — the same shape A02
used, which is what `auth.jwt()` reads.

**Live data moved under me during the run.** Three concurrent audit agents committed employer
contribution runs at 07:54, 08:02 and 08:10 UTC on 2026-08-24 (§10). AUM therefore reads
2,447,268,487 in my first pass and 2,450,226,487 in my last. Both figures are quoted where they
appear; the final section uses the last measurement.

---

## 2. The 5,064 / 5,060 gap — identified, and legitimately excluded

```
$ psql -At -F'|' -c "select s.id, s.name, s.is_active, s.kyc_status, s.is_demo_signup, s.created_at,
    (select count(*) from transactions t where t.subscriber_id=s.id) as txns
  from subscribers s left join subscriber_balances b on b.subscriber_id=s.id
 where b.subscriber_id is null order by s.created_at;"
tst-sub-tree-msc7vzsc|TST tree member|t|complete|t|2026-08-02 19:53:06.406768+00|0
tst-sub-emp-msc7vzsc|TST employer member|t|complete|t|2026-08-02 19:53:08.307374+00|0
tst-sub-retag-msc7vzsc|TST retag probe|t|complete|t|2026-08-03 10:29:56.575797+00|0
tst-sub-tree-msd3855c|TST tree member|t|complete|t|2026-08-03 10:29:56.575797+00|0
```
Also: `orphan_balances_no_subscriber = 0`.

All four are **E2E fixtures**, `is_demo_signup = true`, **zero transactions**, no agent, no employer.
They carry no money and cannot affect any reconciliation, so they are excluded with that stated
reason. The **cause** is precise: `e2e/fixtures/db.ts::cleanupSubscriberByPhone` deletes every child
table *first* (`SUBSCRIBER_CHILD_TABLES`, incl. `subscriber_balances`) and the parent `subscribers`
row *last*; an abort between the two leaves exactly this shape. `assertNoSubscriberOrphans` probes
only the **reverse** direction (child without parent), so it is structurally unable to detect it.
They are nonetheless **demo-visible** — see **A04-010**.

---

## 3. CHECK 1 + CHECK 2 — reconciliation and three-way AUM · **PASS**

### Check 1 — `total_balance == units × nav_for_date(today)`
```
$ psql -At -F'|' -c "
with p as (select public.nav_for_date(CURRENT_DATE) nav),
 d as (select b.*, (b.total_balance - b.units*p.nav) delta from subscriber_balances b, p)
select count(*) rows, count(*) filter (where abs(delta)>0.5) mm_gt_half,
       count(*) filter (where abs(delta)>1) mm_gt_1,
       round(max(abs(delta)),6) max_abs_delta_UGX, round(sum(delta),2) net_delta_UGX from d;"
5060|0|0|0.499771|-11.99
```
**0 mismatches. Max |delta| 0.499771 UGX** — i.e. strictly under the half-shilling that
`round(units × price)` can produce, on every one of 5,060 rows. Net drift across the entire book is
**−11.99 UGX**. This is the tightest possible result.

### Check 2 — three-way AUM, and where the ledger delta comes from
```
A_sum_subscriber_balances_total   | 2450226487
B_get_nav_overview_aum            | 2450226487        (admin RPC, measured)
C_sum_units_x_latest_nav          | 2450226498.9881
D_sum_ALL_transactions_amount     | 2196395441
F_corpus_types_only               | 2103378441        (contribution+withdrawal+premium_sweep+claim)
G_sum_invested_cost_basis         | 2236326511.813737
```
| Pair | Delta | Explanation |
|---|---|---|
| A − B | **0** | same source; `get_nav_overview` reads `Σ total_balance` |
| A − C | **−11.99** | rounding only (check 1) |
| A − F | **+346,848,046** | decomposed exactly below |

```
$ psql -At -F'|' -c "... select 'A_minus_G_navgrowth', 'G_minus_F_capped_redemption_artefact', ..."
A_minus_G_navgrowth                  | 213899975.186263
G_minus_F_capped_redemption_artefact | 132948070.813737
SUM_of_the_two_components            | 346848046.000000
```
**The ledger→balance delta reconciles to the last shilling**, as the sum of exactly two documented
quantities:

1. **213,899,975.19 UGX** — realised NAV growth. This is *identically* the `totalGrowth` key
   `get_nav_overview` returns (`213899975.1862627740…`), so the admin page and the raw ledger agree.
2. **132,948,070.81 UGX** — the cost-basis inflation `0105_nav_backfill.sql` disclosed in its own
   header: *"⚠️ HONEST DISCLOSURE — ~133M OF THE AUM RISE IS NOT RETURNS"*, caused by §3 capping
   redemptions at units actually held for the 1,024 members whose seeded opening plug sorts first.
   The header predicted ~133M. **Measured: 132,948,070.81.**

**Do the E2E employer-run leftovers explain any delta? No.** They land on *both* sides
symmetrically (a `transactions` row and, via the trigger, a `subscriber_balances` credit at the same
day's NAV), so they inflate A and F together and create no gap. They do inflate the absolute figures
— see **A04-009**.

> **Correction to `00d-live-write-ledger.md`.** That file records "114 `transactions` rows,
> `txn_ref = EMP-c4642919`". Measured: `EMP-c4642919` holds **57** rows. The 114 is two runs
> (`EMP-a2d4d427` 09:43 + `EMP-c4642919` 09:50). The true leftover population is far larger — §10.

---

## 4. CHECK 3 — bucket invariants

```
$ psql -At -F'|' -c "select count(*) rows,
 count(*) filter (where retirement_balance+emergency_balance<>total_balance) shilling_split_violations,
 count(*) filter (where coalesce(retirement_units,0)+coalesce(emergency_units,0)<>units) unit_split_violations,
 count(*) filter (where total_balance<0 or retirement_balance<0 or emergency_balance<0 or units<0 or invested<0) negatives,
 count(*) filter (where total_balance='NaN'::numeric or units='NaN'::numeric or invested='NaN'::numeric) nan_rows
from subscriber_balances;"
5060|0|1|0|0
```
* **Shilling split `retirement + emergency = total`: 0 violations across 5,060 rows. PASS.**
* Unit split `retirement_units + emergency_units = units`: **1 violation** — `s-0005`, gap
  6.363752068219 units. **This is audit-caused, not a product defect** — proof in §11.
* 0 negatives, 0 NaN rows, 0 NULLs.

---

## 5. CHECK 4 — cost basis reduces by the redeemed UNIT FRACTION · **PASS (confirmed, rolled back)**

`request_withdrawal` (live body, line 95-97):
```sql
invested = CASE WHEN units > 0
             THEN GREATEST(0, invested * (1 - LEAST(p_amount / v_unit_price, units) / units))
             ELSE 0 END,
```
Probe on `s-0004` (100,000 UGX withdrawal), inside `BEGIN … ROLLBACK`:

| Quantity | Value |
|---|---|
| units before | 427.1217067764500730 |
| units removed = 100000/1571.4 | 63.6375206822 |
| unit fraction redeemed | 0.1489915396 |
| `invested` before | 609,894.305706 |
| **`invested` after (measured)** | **519,025.214116** |
| expected = 609894.305706 × (1 − 0.1489915396) | **519,025.214116** ✅ |
| what a naive *shilling* reduction would give | 509,894.305706 ❌ |

Average-cost is implemented correctly, so growth % is invariant to withdrawals — exactly as the
0104 comment claims. The same fraction rule is used by the save-to-cover sweep
(`trg_transactions_contribution` lines 119-121). **PASS.**

---

## 6. CHECK 5 — idempotency

### Serial replay · **PASS (confirmed, rolled back)**
```
### CALL 1  {"id":"tx-s-0002-adhoc-d352654f…","amount":10000,"reference":"CT-533251","splitRetirement":8000,"splitEmergency":2000}
### CALL 2 (identical nonce)                       → byte-identical JSON
### CALL 3 (identical nonce, amount 999999)        → byte-identical JSON (nonce wins over payload)
### EFFECT COUNT inside txn:  new_txn_rows = 1 ·  nonce_rows = 1
balance in txn: 174314 → 184314 · units 110.9288017429655341 → 117.2925538111849563
### POST-ROLLBACK RE-READ:  174314 / 156882 / 17432 / 110.9288017429655341 / 152828   ← identical to PRE
txn_rows 4 → 4 · a04 nonce rows 0 → 0
```
Three calls, one effect, identical returns. Units arithmetic verified:
110.9288017429655341 + 10000/1571.4 = 117.2925538111849563 ✅.

### Concurrent same-nonce · **FINDING A04-011 (plausible — not executed)**
Execution was **blocked** (permission classifier denied the two-session orchestration). Verdict from
the RPC body, per spec. The claim sequence in `public.make_contribution` is:

```
line 24  SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;   -- plain read, NO lock
line 40  INSERT INTO public.transactions (...)                                        -- MONEY MOVES HERE
line 63  INSERT INTO public.money_nonces (...) ON CONFLICT (nonce) DO NOTHING;        -- nonce claimed AFTER
```
Structural facts measured live:
```
money_nonces_pkey | CREATE UNIQUE INDEX money_nonces_pkey ON public.money_nonces USING btree (nonce)
transactions_pkey | PRIMARY KEY (id)          ← id is gen_random_uuid(); no constraint ties a txn to a nonce
```
Under READ COMMITTED neither session sees the other's uncommitted nonce row at line 24, and nothing
at line 40 can collide, so **both write a `transactions` row**. The `subscriber_balances` upsert in
the trigger serialises the two but does not de-duplicate: `DO UPDATE SET … = balance + EXCLUDED.…`
re-reads the winner's committed row and adds its own delta on top. `ON CONFLICT DO NOTHING` at line
63 then silently swallows the second nonce. Net: **one nonce row, two contributions applied.**
`request_withdrawal` has the identical shape (lines 32-36 / 143-147).

The safe pattern is to claim the nonce **first**
(`INSERT … ON CONFLICT DO NOTHING RETURNING nonce`) and abort when nothing is returned.

---

## 7. CHECK 6 — server-side guards · **FAIL**

All 17 probes ran inside `BEGIN … ROLLBACK` on `s-0004`; the post-rollback re-read is quoted in §14.
Cases marked *(rejected)* wrote nothing at all before the rollback was even needed.

| # | Probe | Result |
|---|---|---|
| G1 | `make_contribution(amount = 0)` | *(rejected)* `ERROR: amount must be positive` ✅ |
| G2 | `make_contribution(amount = -50000)` | *(rejected)* `ERROR: amount must be positive` ✅ |
| G3 | `make_contribution(amount = 1)` — below `MIN_CONTRIBUTION` 5000 | **ACCEPTED**, `amount: 1` → **A04-012** |
| G4 | `make_contribution(amount = 0.004)` — sub-shilling | **ACCEPTED**; balance became `671179.004`, split `0 / 0.004` → **A04-012** |
| G5 | `make_contribution(amount = 'NaN')` | **ACCEPTED** → whole row NaN → **A04-001** |
| G6 | `make_contribution(amount = 'Infinity')` | **ACCEPTED**, `splitRetirement: Infinity`, `splitEmergency: NaN` → **A04-001** |
| G7 | `make_contribution(amount = 1e30)` | **ACCEPTED**; `total_balance = 1000000000000000000000000671179` → **A04-001** |
| S2 | `p_retirement_pct = 200` | clamped to 80 → split 8000/2000 ✅ |
| S3 | `p_retirement_pct = 'NaN'` | clamped to 80 (`NaN > 100` is TRUE in PG) → split 8000/2000 ✅ |
| W2 | `request_withdrawal(99999999)` > balance | *(rejected)* `withdrawal of 99999999 exceeds available balance 671179` ✅ |
| W3 | `request_withdrawal(0)` / `(-20000)` | *(rejected)* `amount must be positive` ✅ |
| W4 | `request_withdrawal(4999)` — below `MIN_WITHDRAW` | **ACCEPTED** → **A04-012** |
| W5 | `request_withdrawal(400000, bucket='emergency')` with only 134,236 in emergency | **ACCEPTED — invariant broken** → **A04-004** |
| W6 | same amount, `bucket = NULL` (trigger fallback) — **control** | correct: 271179 / 271179 / 0, break **0** ✅ |
| W7 | `request_withdrawal('NaN')` | *(rejected)* — `NaN > v_total_balance` is TRUE, so the balance check catches it ✅ |
| S1 | `request_withdrawal(100000, split_ret = -100000, split_emg = 200000)` | **ACCEPTED — money created** → **A04-002** |

### G5 verbatim — NaN poisoning
```
{"id":"tx-s-0004-adhoc-29ba8243…","amount":"NaN","splitEmergency":"NaN","splitRetirement":"NaN"}
 total_balance | retirement_balance | emergency_balance | units | invested
 NaN           | NaN                | NaN               | NaN   | NaN
```
`NaN <= 0` is **FALSE** in PostgreSQL (`NaN` sorts above every other numeric), so the sole amount
guard `IF p_amount IS NULL OR p_amount <= 0` does not fire. `units` and `invested` are themselves
poisoned, and **nothing in the system ever recomputes them** — `publish_nav_snapshot` derives
`total_balance = round(units × price)`, so `NaN` propagates forever. One poisoned member makes
`Σ units` and `Σ total_balance` NaN, i.e. **every AUM figure on the platform reads NaN.**

### W5 verbatim — the two buckets stop summing to the total
```
 accepted = 400000
 total_balance | retirement_balance | emergency_balance | bucket_sum | invariant_break | units
 271179        | 536943             | 0                 | 536943     | 265764          | 172.57162405
```
`request_withdrawal` lines 54-60 turn `p_bucket='emergency'` into `split_emergency := p_amount`
with **no check against the emergency balance**; the trigger then clamps with
`GREATEST(0, emergency_balance - v_emg_take)` while debiting `total_balance` by the full amount. The
member's own dashboard would show *Retirement 536,943 + Savings 0* against *Total 271,179* — two
contradictory money figures on one screen. `total_balance` and `units` stay mutually consistent
(172.5716 × 1571.4 = 271,179), so check 1 would not catch it either.

### S1 verbatim — a withdrawal that CREATES money
```
 accepted = 100000
 total_balance | retirement_balance | emergency_balance | invariant_break | units
 571179        | 636943             | 0                 | 65764           | 363.48418609
```
The only validation on explicit splits is that they **sum** to the amount (lines 65-69).
`(-100000) + 200000 = 100000` passes. `trg_transactions_withdrawal` then computes
`GREATEST(0, retirement_balance - (-100000))` → **retirement_balance rises by 100,000 UGX on a
withdrawal.** Neither leg is checked for sign or against its own bucket.

**UI reachability.** `src/subscriber-dashboard/pages/WithdrawPage.jsx:68,76,77` caps the amount at
the selected bucket's balance and disables submit when `max < MIN_WITHDRAW`, so the shipped UI
cannot produce W5 or S1. `src/services/subscriber.js:824` passes `p_amount: amount` with no
`Number.isFinite` check, but `JSON.stringify(NaN)` → `null`, which the RPC's NULL guard rejects — so
the shipped UI cannot produce G5 either. All six failures require a direct RPC call (a stale client,
a script, or a hand-built request). PostgREST casts a JSON **string** to the parameter type, so
`{"p_amount":"NaN"}` is the plausible delivery vector; that HTTP leg was not executed because doing
so would commit.

---

## 8. CHECK 7 — `publish_nav_snapshot` · **PASS on (a) and (c); FAIL on (b) for NaN/Infinity**

**No snapshot was published.** Every probe rolled back; §14 proves `published_by='A04PROBE'` count
is 0 and the register still holds 1,242 published + 4 pending rows.

| # | Probe | Result |
|---|---|---|
| P1 | subscriber role publishes | *(rejected)* `ERROR: role subscriber cannot publish a unit price` ✅ |
| P1b | `anon` publishes | *(rejected)* `ERROR: permission denied for function publish_nav_snapshot` ✅ |
| P2 | `p_unit_price = 0` | *(rejected)* `unit price must be greater than zero` ✅ |
| P3 | `p_unit_price = -5` | *(rejected)* `unit price must be greater than zero` ✅ |
| P4 | future date | *(rejected)* `cannot publish a price for a future date` ✅ |
| P5 | back-dated 2026-08-05 @ 1600 | `"revalued": false` · book **unchanged** · pending 4→3 ✅ |
| P6 | today @ 1571.40 (re-publish) | `"revalued": true` · **0 recon mismatch, 0 split break** across 5,060 ✅ |
| P7 | today @ 2500 (+59.09%) **without** confirm | *(rejected)* `price move of %59.09 from 1571.4 on 2026-08-08 needs confirmation` ✅ |
| P8 | today @ 2500 **with** confirm | revalues correctly (below) ✅ |
| P3b | today @ `'NaN'` **without** confirm | *incidentally* stopped by the move gate, **not** the price gate ⚠️ |
| P9 | today @ `'NaN'` **with** confirm | **whole book → NaN** → **A04-005** |
| P10 | today @ `'Infinity'` with confirm | **accepted**, `unitPrice: "Infinity"`, `aum: "NaN"` → **A04-005** |

### (a) admin-only gate — **PASS**, and defended twice
The `app_role <> 'admin'` RAISE stops an authenticated non-admin; the missing `anon` EXECUTE grant
stops anonymous callers before the body runs at all.

### (b) `p_unit_price <= 0` — **PASS for 0/-5, FAIL for NaN/Infinity**
```
P9:  {"aum":"NaN","navDate":"2026-08-24","revalued":true,"unitPrice":"NaN","unitsInIssue":1559263.395…,"membersPriced":5060}
     after_NaN | total_balance NaN | retirement NaN | emergency NaN | units 427.1217067764500730
     book      | nan_rows 5060 | aum NaN
     nav_row   | 2026-08-24 | NaN | published
```
The `nav_snapshots_unit_price_check CHECK (unit_price > 0)` constraint **also** passes NaN
(`NaN > 0` is TRUE), so the register itself stores it. All 5,060 balance rows go NaN in one
statement. It *is* recoverable — `units` and `retirement_units` survive, so publishing a valid price
restores the book — which is why this is medium and A04-001 (which poisons `units` itself) is high.

### (c) the 0106 WHERE-clause fix — **PASS (verified in the live body)**
Both statements carry the guard in `pg_proc.prosrc`:
```
line 72-79  UPDATE public.subscriber_balances SET … WHERE subscriber_id IS NOT NULL;
line 94-97  UPDATE public.subscribers        SET … WHERE id IS NOT NULL;
```
Reproducing the *failure* was **blocked**: `SET LOCAL sql_safe_updates = on` returns
`ERROR: unrecognized configuration parameter "sql_safe_updates"` for a direct `postgres` session —
the `safeupdate` extension is preloaded only for the API roles. That is precisely what 0106's header
predicts (*"it follows the CALLER … over psql the caller is `postgres`, which has the guard OFF"*).
I therefore swept **every** live function for the same bug class instead:
```
$ psql -At -c "select p.proname, m[1] from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
   lateral regexp_matches(p.prosrc,'(UPDATE\s+public\.[a-z_]+\s+SET[^;]*;)','gi') m
  where n.nspname='public' and m[1] !~* 'WHERE' order by 1;"
(0 rows)
```
**No live function has an unqualified UPDATE.** 0106's fix is complete platform-wide.

### Duplicate-date and back-dated behaviour
Re-publishing a date **corrects** it via `ON CONFLICT (fund_code, nav_date) DO UPDATE` and flips
`pending → published` (P5 measured pending 4→3 inside the transaction). A back-dated publish returns
`"revalued": false` and leaves the book alone — P5 confirmed `s-0004` byte-identical after it. The
UI surfaces this honestly: *"Price saved for … Today's prices are unchanged because a newer price is
already published."* (`AdminNavDesktop.jsx:169`).

### Revaluation arithmetic (P8, +59% move)
```
{"aum":3898158513,"unitPrice":2500,"unitsInIssue":1559263.39505418611942857976,"membersPriced":5060,"revalued":true,"changePct":59.0938}
after_2500 | 1067804 | 854243 | 213561 | units 427.1217067765 | invariant_break 0
book       | rows 5060 | recon_mismatch 0 | split_break 0
```
`round(427.1217067765 × 2500) = 1,067,804` ✅, buckets sum exactly, and **all 5,060 rows** satisfy
both invariants after the revaluation. The complement rule (round total, round retirement, take
emergency as the difference) is doing exactly the job 0104/0106 claim.

---

## 9. CHECK 8 — `nav_for_date` interpolation · **PASS**

```
$ psql -At -F'|' -c "select d::text, public.nav_for_date(d),
   (select max(nav_date)::text from nav_snapshots where status='published' and nav_date<=d) from (values …) v(d);"
2020-01-01|1001.93|            ← before the series: falls back to the FIRST published price
2021-10-31|1001.93|
2021-11-01|1001.93|2021-11-01  ← exact hit
2021-11-06|1006.77|2021-11-05  ← weekend: carries Friday forward
2026-08-04|1565.02|2026-08-03  ← the 4 'pending' days are correctly IGNORED
2026-08-07|1565.02|2026-08-03
2026-08-08|1571.4 |2026-08-08
2026-08-24|1571.4 |2026-08-08  ← today: carries the newest published price
2030-01-01|1571.4 |2026-08-08
```
The direction is **backward carry** — the last price published *on or before* the date. That is the
correct convention for a unit-priced fund: a NAV is in force until the next pricing day, so a
weekend, a holiday or an unpriced gap prices at the preceding valuation, never at a future one that
did not exist yet. Dates before the register begin fall back to the **earliest** published price
rather than the 1,000 literal, and `status='published'` correctly excludes the 4 pending days
(which carry a stale `1000.00`). The final `COALESCE(…, 1000)` is reachable only on a completely
empty register. **Correct in every direction tested.**

---

## 10. CHECK 9 — employer money never reaches the emergency bucket · **PASS (verified against live)**

RPC level (`submit_employer_contribution_run`, live body lines 91-127): both pension legs set
`v_retirement := v_<leg>; v_emergency := 0`, matching
`src/utils/contributionModel.js:147` `EMPLOYER_FUNDED_SPLIT = {retirementPct:100, emergencyPct:0}`
and `splitEmployerLeg(leg) → {retirement: amount, emergency: 0}`.

Live natural experiment — every `source='employer'` contribution row, by day:
```
$ psql -At -F'|' -c "select date_trunc('day',date)::date, count(*), sum(amount),
   count(*) filter (where split_emergency>0) emg_rows, coalesce(sum(split_emergency),0) emg_ugx
  from transactions where source='employer' and type='contribution' group by 1 order by 1;"
2026-03-15|14 |786000  |14 |157200
…
2026-08-02|228|23664000|228|4732800
2026-08-03|57 |5916000 |57 |1183200
2026-08-23|38 |3944000 |  0|      0    ← 0102 cutover is visible in the data
2026-08-24|57 |5916000 |  0|      0
```
**Every employer-source row written on or after 2026-08-23 has `split_emergency = 0`.** The
`EMP-c4642919` batch named in the write ledger shows `min(split_retirement)=60000, max(split_emergency)=0`.

The 602 earlier rows carrying 10,843,200 UGX of employer money in the emergency bucket are
**pre-0102 and deliberately not backfilled** — 0102's own header: *"Existing transactions keep the
splits they were posted with. Those runs really did allocate that way; rewriting them would falsify
the ledger and desync `subscriber_balances`."* Recorded as **A04-017 (info)**, not a defect.

### But the runs themselves are E2E litter — **A04-009**
```
$ psql -At -F'|' -c "select count(distinct txn_ref) runs, count(*) rows, sum(amount) ugx from transactions where txn_ref like 'EMP-%';"
33|1881|145372000
$ psql -At -F'|' -c "select type, count(*), sum(amount) from transactions where txn_ref like 'EMP-%' group by 1;"
contribution      |1254|120292000
insurance_premium | 627| 25080000
$ psql -At -F'|' -c "select 'pct_of_AUM', round(100.0*(select sum(amount) from transactions where txn_ref like 'EMP-%' and type='contribution')/(select sum(total_balance) from subscriber_balances),3);"
4.909
```
**33 runs · 1,881 rows · 145,372,000 UGX**, of which **120,292,000 UGX (4.9% of live AUM)** is
balance-affecting. Runs are dated 2026-07-30 → 2026-08-24 and **five of them landed during this
audit** (2026-08-23 09:43, 09:50; 2026-08-24 07:54, 08:02, 08:10). Each full suite adds
+3,718,000 UGX permanently.

---

## 11. CHECK 3 addendum — the single unit-split break is AUDIT-CAUSED, not a product defect

`s-0005` is the one row failing `retirement_units + emergency_units = units`:
```
subscriber_id | units 203.986422080351 | retirement_units 185.404883 | emergency_units 24.945291148571
bucket_unit_gap 6.363752068219 | updated_at 2026-08-24 08:01:28.956196+00
$ select 6.3637520682194222 * 1571.4  →  10000.00000000000004508
```
Five facts settle it:
1. `s-0005`'s **`units` is exactly ledger-consistent** — the independent replay in §12 reproduces it
   to 12 decimal places (`unit_delta 0.000000000000`). Nothing corrupted `units`.
2. Only `emergency_units` is wrong, by **exactly 10,000.00 UGX at the current NAV**.
3. `subscriber_balances.updated_at` is **2026-08-24 08:01:28 UTC — inside this audit's window** —
   yet `s-0005` has **no `transactions` row and no `withdrawals` row** on that date.
4. Only two live functions write `retirement_units`/`emergency_units`
   (`_resync_bucket_units`, `publish_nav_snapshot`), and `grep -rn "subscriber_balances" src api server`
   shows **no application code writes the table at all**.
5. Every product path that changes `units` calls `_resync_bucket_units` immediately after
   (`request_withdrawal:120`, `trg_transactions_contribution:61,125`).

⇒ The write came from an **ad-hoc SQL statement issued by another audit agent** that replicated
`request_withdrawal`'s balance UPDATE without its `PERFORM public._resync_bucket_units(...)` call.
**This belongs in `00d-live-write-ledger.md` as a third event, not in any product finding.** I did
not repair it (repairing it by hand is exactly the class of action the ledger warns against).

---

## 12. CHECK 11 — the seeded ledger vs the published NAV series · **PASS (spectacularly)**

I re-ran 0105's chronological walk **read-only** — every `contribution`/`withdrawal`/`premium_sweep`/
`claim` row priced at `nav_for_date(its own date)` off the 1,242-row published register, with the
same average-cost redemption capping — inside `BEGIN … ROLLBACK` using an `ON COMMIT DROP` temp table:

```
======== WALK vs LIVE — aggregate
 members_compared | unit_mismatches | unit_mismatch_gt_1ugx | max_abs_delta_ugx | net_delta_ugx
             5059 |               0 |                     0 |            0.0000 |          0.00
======== the mismatching members (>1 UGX)
(0 rows)
======== members with no ledger row at all
                       1
======== seeded-units check: rows still at units == total_balance/1000
                       0
```

**An independent replay of 29,000+ ledger rows reproduces the live `units` column for all 5,059
members with a ledger, exactly.** Not one row still sits at the seed's `units == total/1000`
identity. The seeded transaction history and the published NAV register are in complete agreement,
and 0105's restatement is verifiably intact 16 days later.

### But `scripts/seed-supabase.mjs:78` is a loaded gun — **A04-003**

```js
// scripts/seed-supabase.mjs:74-83
const UNIT_PRICE = 1000;
function unitsFromBalance(netBalance) { return Math.round(((netBalance ?? 0) / UNIT_PRICE) * 100) / 100; }
```
Three measured facts make this dangerous *now*, not historically:

1. **`nav_snapshots` is NOT in the seed's `TRUNCATE` list** (`scripts/seed-supabase.mjs:361-397`) and
   the seed never inserts into it. A reseed wipes balances but leaves the register saying **1,571.40**.
2. The `subscriber_balances` insert (`:639-658`) writes only
   `subscriber_id, retirement_balance, emergency_balance, total_balance, units`. It does **not** write
   `retirement_units`, `emergency_units` or `invested`, which take their column defaults:
   ```
   retirement_units | numeric | NO | 0
   emergency_units  | numeric | NO | 0
   invested         | numeric | NO | 0
   ```
3. Therefore a reseed leaves `units = total/1000` (57% too many units for the live NAV) and
   **zero bucket units**.

**Reproduced against live, inside `BEGIN … ROLLBACK`**, by writing the seed shape onto `s-0004` and
then applying `publish_nav_snapshot`'s revaluation arithmetic **verbatim** (0106 body lines 72-79):

```
-- pre (real)      671179 | 536943 | 134236 | units 427.1217067764500730 | ru 341.697365 | invested 609894.31
-- seed shape      671179 | 536943 | 134236 | units 671.1800000000000000 | ru 0         | invested 0
-- AFTER_PUBLISH  1054692 |      0 |1054692 | units 671.1800000000000000 |               invested 0
```

| Field | Today | After reseed + one NAV publish | Change |
|---|---|---|---|
| `total_balance` | 671,179 | **1,054,692** | **+57.1%** |
| `retirement_balance` | 536,943 | **0** | **−100%** |
| `emergency_balance` | 134,236 | **1,054,692** | **+686%** |
| `invested` | 609,894 | 0 | growth becomes undefined |

Across 5,060 members: platform AUM inflates ~57% with no money in, **every member's retirement pot
reads zero**, every shilling becomes withdrawable "emergency" money, and every growth figure
collapses to 0% (`get_nav_overview`'s `avgGrowthPct` filters on `invested > 0`, which no row would
satisfy). `subscribers.current_unit_value` also reverts to the seed's random 950-1050 while the
register says 1,571.40, so the "@ X/unit" line is wrong too.

Even **before** any publish, the reseed alone breaks check 1 by 57% for every row, and the admin NAV
page's own `projectedAum = unitsInIssue × typedPrice` (`AdminNavDesktop.jsx:131-133`) would sit 57%
above the AUM tile immediately beside it.

---

## 13. CHECK 10 — the legacy `v_unit_price := 1000` · **forward PASS, down path FLAGGED**

### Forward path — unreachable, proven live
```
$ psql -At -c "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosrc ~ 'v_unit_price\s*(NUMERIC|numeric)?\s*:=\s*1000';"
(0 rows)
```
* **0038 forward** puts the constant in `submit_contribution_run` — a member of the `0021` family
  that A00 §5.1 proved is **not live** (dropped by 0029). Unreachable.
* **0043 forward** puts it in `trg_transactions_contribution`, but 0072 → 0089 → 0104 each
  `CREATE OR REPLACE` that function and the **live** body opens with
  `v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));` (line 20). Unreachable.
* The only `1000` left in a pricing position anywhere live is `nav_for_date`'s final `COALESCE`
  fallback, reachable only on an empty register. Legitimate.

### Down path — a silent clobber waiting to happen · **A04-006**
```
$ for f in 0038 0042 0043 0045 0072 0089 0104 …
0042_signup_writeflow_hardening.down: 1 trg_contrib CREATE-OR-REPLACE | 4 unit_price refs | 0 req_wd
0043_subscriber_employer_link.down:   1 trg_contrib CREATE-OR-REPLACE | 2 unit_price refs | 0 req_wd
0072_insurance_save_to_cover.down:    1 trg_contrib CREATE-OR-REPLACE | 4 unit_price refs | 1 req_wd
0089_per_distributor_commission_rate.down: 1 trg_contrib CREATE-OR-REPLACE | 3 unit_price refs | 0 req_wd
0104_nav_pricing_rpcs.down:           1 trg_contrib CREATE-OR-REPLACE | 5 unit_price refs | 1 req_wd
```
Four down-migrations that have **nothing to do with NAV** (`0042` signup hardening, `0043` employer
link, `0072` insurance save-to-cover, `0089` per-distributor commission) each
`CREATE OR REPLACE FUNCTION public.trg_transactions_contribution()` carrying
`v_unit_price NUMERIC := 1000`. Two of them also replace `request_withdrawal`. Running **any** of
them to roll back its own unrelated change would silently revert the money engine to the flat 1,000
price — no error, no version check, no guard. Every subsequent contribution would then buy **57%
more units per shilling** than it paid for, and the next NAV publish would restate that member's
balance upward accordingly.

This is the identical `CREATE OR REPLACE` clobber pattern that produced the project's own
`0095`-over-`0090` login-identity regression (`project_uganda_login_identity_regression_2026_08_07`).
0104 shipped no guard against it — e.g. a `DO $$ … RAISE EXCEPTION` header in each down file
asserting the NAV migrations are not applied. **G6 respected: no down-migration was executed.**

> Rollback assets intact: `subscriber_balances_pre_nav` (5,060 rows) and
> `subscribers_unit_value_pre_nav` (5,060 rows) both still exist, so `0105_nav_backfill.down.sql`
> remains executable. **A04-018 (info).**

---

## 14. CHECK 12 — rounding, column types, drift · **PASS**

```
======== D4 float columns anywhere in the schema? (data_type IN ('double precision','real'))
(0 rows)
```
**Every money column in all 37 tables is unconstrained `numeric`** — exact decimal, no binary
floating point anywhere. `subscriber_balances`: `retirement_balance`, `emergency_balance`,
`total_balance`, `units`, `retirement_units`, `emergency_units`, `invested` — all `numeric NOT NULL
DEFAULT 0`. `nav_snapshots.unit_price`, `transactions.amount`, `transactions.split_*`,
`withdrawals.amount`, `custody_transfers.amount` — all `numeric`.

```
======== D1 division scale actually produced by amount/NAV
 5000/1571.4 = 3.1818760341097111 | result_scale 16 | numeric
======== D2 accumulated drift: 10,000 x 5,000 UGX contributions summed as the trigger does
 accumulated 31818.7603410971110000 | exact 31818.760341097111 | unit_drift 0.0000000000000000 | drift_in_UGX 0.000000000000
======== D3 split residual: round(amt*80/100) + (amt - round(amt*80/100)) - amt
 5001|5002|12345|99999|1  →  residual 0 in every case
```
* Unit credits are **un-rounded** `NEW.amount / v_unit_price` at scale 16.
* **10,000 successive 5,000-UGX contributions drift 0.000000000000 UGX** from the exact figure. The
  arithmetic bound is ~N × 10⁻¹⁶ units ≈ N × 1.6 × 10⁻¹³ UGX; you would need ~10¹⁵ contributions to
  drift a single shilling. **No accumulating drift is possible.** (No committed iterations were run —
  this is a pure aggregate over `generate_series`.)
* The split uses the **complement rule** (`emg = amt − round(amt × pct/100)`) in both the RPC
  (`make_contribution:34-35`) and the trigger (`trg_transactions_contribution:27-28`), so the two
  legs always sum to the amount exactly — residual 0 on every probe.
* `publish_nav_snapshot` and 0105 §4 use the same complement rule on the revaluation, which is why
  P6/P8 measured **0 split_break across 5,060 rows** at two different prices.

The only rounding exposure is fractional inputs (G4: 0.004 UGX is accepted and persisted), covered
by **A04-012**.

---

## 15. Residue check — proof of zero committed writes

```
$ psql -At -F'|' -c "
select 'money_nonces A04', count(*) from money_nonces where nonce like 'A04%'
union all select 'nav_snapshots A04PROBE', count(*) from nav_snapshots where published_by='A04PROBE'
union all select 'withdrawals reason=audit probe', count(*) from withdrawals where reason in ('audit probe','x')
union all select 'transactions in last 12 min', count(*) from transactions where created_at > now() - interval '12 minutes'
union all select 'balances updated in last 12 min', count(*) from subscriber_balances where updated_at > now() - interval '12 minutes'
union all select 'temp tables left', count(*) from pg_class where relname like '_a04%' or relname like '_w';"
money_nonces A04|0
nav_snapshots A04PROBE|0
withdrawals reason=audit probe|0
transactions in last 12 min|0
balances updated in last 12 min|0
temp tables left|0
```
Plus the per-probe post-rollback re-reads quoted in §5-§8 and §12, and the register still at
1,242 published / 4 pending / `latest_nav() = 1571.4`.

**No fixture rows were created that survived. Nothing needed cleaning up. No NAV snapshot was
published. No down-migration was executed. No file outside `docs/audits/2026-08-23/` was written.**

---

## 16. Findings

| id | sev | conf | title | location |
|---|---|---|---|---|
| A04-001 | high | confirmed | `make_contribution` accepts NaN / Infinity / unbounded amounts; NaN irrecoverably poisons `units` and every platform AUM figure | `public.make_contribution:19` |
| A04-002 | high | confirmed | `request_withdrawal` validates only that the two split legs *sum* to the amount, so a negative leg **creates** money in the retirement bucket | `public.request_withdrawal:65-69` |
| A04-003 | high | confirmed | A reseed writes `units = total/1000` and leaves `retirement_units`/`emergency_units`/`invested` at 0; the next NAV publish inflates AUM 57% and zeroes every retirement pot | `scripts/seed-supabase.mjs:78` |
| A04-004 | medium | confirmed | `request_withdrawal(bucket='emergency')` for more than the emergency balance clamps the bucket at 0 but debits the full total — the buckets stop summing to the total | `public.request_withdrawal:54-60` |
| A04-005 | medium | confirmed | `publish_nav_snapshot`'s `p_unit_price <= 0` guard **and** the `unit_price > 0` CHECK both pass NaN/Infinity; with `confirmMove` the whole book goes NaN | `public.publish_nav_snapshot:18-20` |
| A04-006 | medium | confirmed | Four unrelated down-migrations `CREATE OR REPLACE` the contribution trigger with the hardcoded 1,000 price, silently reverting NAV pricing | `supabase/migrations/0089_per_distributor_commission_rate.down.sql:22` |
| A04-007 | medium | confirmed | NAV is 16 days stale; `delayedNav` counts only pre-seeded `pending` rows, so 11 unpriced weekdays are invisible and the 4 flagged days sit *behind* the newest price | `public.get_admin_attention` (`nav_late` CTE) |
| A04-008 | medium | confirmed | `v_reconciliation_exceptions` checks the shilling split but not the unit ledger, so a broken `units` invariant is invisible to the admin — demonstrated by the one live row currently broken | `public.v_reconciliation_exceptions` |
| A04-009 | medium | confirmed | 33 leftover E2E employer runs (1,881 rows, 145.37M UGX; 120.29M balance-affecting = 4.9% of AUM) permanently inflate live AUM, +3.7M per suite run | `e2e` / `public.submit_employer_contribution_run` |
| A04-010 | medium | confirmed | 4 leftover E2E subscribers ("TST retag probe", …) surface on the admin Needs Attention panel as `missing_balance` exceptions during a live demo | `e2e/fixtures/db.ts:100-127` |
| A04-011 | medium | plausible | The idempotency nonce is claimed **after** the money write with `ON CONFLICT DO NOTHING`; two concurrent same-nonce calls both apply | `public.make_contribution:23-28,62-66` |
| A04-012 | low | confirmed | `MIN_CONTRIBUTION`/`MIN_WITHDRAW` = 5,000 and the zero-decimal UGX rule are client-only; the RPCs accept 1 UGX and 0.004 UGX | `src/constants/savings.js:12-13` |
| A04-013 | low | confirmed | `request_withdrawal` writes a **positive** `transactions.amount` while all 5,402 historical withdrawal rows are negative | `public.request_withdrawal:77-83` |
| A04-014 | low | confirmed | The publish form computes the move against `currentNav`, the RPC against the price preceding `p_nav_date`; for a back-dated publish the two disagree | `src/admin-dashboard/nav/AdminNavDesktop.jsx:128-130` |
| A04-015 | low | confirmed | `todayIso` uses UTC, so between 00:00 and 03:00 EAT the publish form defaults to *yesterday* | `src/admin-dashboard/nav/AdminNavDesktop.jsx:110` |
| A04-016 | info | confirmed | `s-0005`'s unit-bucket break is audit-caused (an ad-hoc SQL write at 08:01:28 UTC that skipped `_resync_bucket_units`), not a product defect — belongs in the write ledger | `subscriber_balances` / `00d-live-write-ledger.md` |
| A04-017 | info | confirmed | 602 pre-0102 employer rows hold 10,843,200 UGX in the emergency bucket; 0102 documents this as a deliberate non-backfill. Not a defect | `supabase/migrations/0102_employer_contributions_all_retirement.sql:52-58` |
| A04-018 | info | confirmed | 0105's rollback artefacts (`subscriber_balances_pre_nav`, `subscribers_unit_value_pre_nav`, 5,060 rows each) are intact, so `0105_nav_backfill.down.sql` remains executable | `public.subscriber_balances_pre_nav` |

**Ranked remediation order:** A04-003 (becomes *critical* the moment anyone reseeds) →
A04-001 / A04-002 (one-line guards, catastrophic blast radius) → A04-011 → A04-004 / A04-005 →
A04-008 → A04-006 → A04-007 → A04-009 / A04-010 → the lows.

The single highest-value fix is a shared validator applied to every money RPC parameter:
```sql
IF p_amount IS NULL OR p_amount <= 0 OR p_amount = 'NaN'::numeric
   OR p_amount = 'Infinity'::numeric OR p_amount > 100000000 THEN RAISE …
```
plus, for `request_withdrawal`, `v_split_ret >= 0 AND v_split_emg >= 0` and a per-bucket
sufficiency check. That closes A04-001, A04-002, A04-004, A04-005 and A04-012 at once.

---

## 17. Traceability

| # | Check | Disposition |
|---|---|---|
| 1 | Reconciliation `total_balance` vs `units × nav_for_date(today)` — count + max delta | **PASS** — 5,060 rows, 0 mismatches, max 0.499771 UGX, net −11.99 UGX (§3) |
| 2 | Three-way AUM: transactions vs balances vs `get_nav_overview` | **PASS** — A=B exactly; A−C = −11.99 rounding; A−F = 346,848,046 decomposed to the shilling as NAV growth 213,899,975.19 + the 0105-disclosed capped-redemption artefact 132,948,070.81. The E2E employer rows explain **no** delta (they move both sides) (§3, §10) |
| 3 | Bucket invariant `retirement + emergency == total` | **PASS** — 0 shilling violations / 5,060. The 1 *unit*-split violation is audit-caused: **FINDING A04-016** (§4, §11) |
| 4 | Cost basis reduced by the redeemed unit FRACTION, not the shilling amount | **PASS (confirmed, rolled back)** — measured 519,025.214116 = fraction rule; naive shilling rule would give 509,894.305706 (§5) |
| 5 | Idempotency — serial replay, and the concurrent case | serial **PASS** (3 calls, 1 effect, identical returns). Concurrent: **BLOCKED** (two-session orchestration denied by the auto-mode permission classifier) → code-level verdict **FINDING A04-011 (plausible)**, explicitly not executed against live (§6) |
| 6 | Guards: MIN 5000, negative/zero, exceeding the emergency bucket, non-numeric, overflow | **FINDING A04-001, A04-002, A04-004, A04-012** — 17 probes, 11 pass, 6 fail. Rejected-before-any-write cases marked *(rejected)* in the §7 table |
| 7 | `publish_nav_snapshot`: admin gate, `p_unit_price <= 0`, the 0106 WHERE fix, duplicate + back-dated | (a) **PASS**, (c) **PASS** (verified in the live body; failure reproduction **BLOCKED** — `sql_safe_updates` unrecognised for a direct psql session, exactly as 0106 predicts; swept all 89 live functions instead → 0 unqualified UPDATEs). Duplicate/back-dated **PASS**. (b) **FINDING A04-005** for NaN/Infinity. **No snapshot was published** (§8) |
| 8 | `nav_for_date` for a date with no snapshot — direction and correctness | **PASS** — backward carry (last published on or before), correct fund convention; pending days excluded; pre-series falls back to the earliest published price (§9) |
| 9 | `EMPLOYER_FUNDED_SPLIT` 100/0 — employer money never in emergency, verified against the live EMP rows | **PASS** — every employer-source row from 2026-08-23 on has `split_emergency = 0`; the pre-0102 residue is documented as deliberate → **A04-017 (info)** (§10) |
| 10 | Legacy `v_unit_price := 1000` in 0038/0043, forward AND down | forward **PASS** (0 live functions match; 0038's copy is in the non-live `0021` family, 0043's was replaced by 0104). Down path → **FINDING A04-006**. G6 respected — no down-migration executed (§13) |
| 11 | `seed-supabase.mjs:78` UNIT_PRICE 1000 reconciled against the 1,246-row NAV register | **PASS** for live data — an independent replay of 29k+ ledger rows reproduces live `units` for all 5,059 members exactly (0 mismatches, max 0.0000 UGX); 0 rows remain at the seed identity. Forward-looking hazard → **FINDING A04-003** (§12) |
| 12 | Rounding: fractional units, float vs numeric column types, accumulated drift | **PASS** — 0 float/real columns anywhere; division at scale 16; 10,000 accumulated contributions drift **0.000000000000 UGX**; complement rule gives 0 split residual. Fractional-input exposure → **A04-012** (§14) |
| — | The 5,064 / 5,060 gap | **Excluded from reconciliation with stated reason** (4 E2E fixtures, 0 transactions, 0 balances) **and reported** as **A04-010** because they surface on the admin Needs Attention panel (§2) |
