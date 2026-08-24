# A05 · Commission & Settlement Lifecycle

**Captured:** 2026-08-23 · **Repo:** `/Users/shubhang/Desktop/Projects/uganda-dashboard` @ `bd637f6`
**Live DB:** `ilkhfnoyxlxwqadebnkp` (Singapore) · **Baseline cited:** `docs/audits/2026-08-23/00-baseline.md`

> **Goal:** prove agents are paid exactly once, correctly, and that settlement cannot be replayed
> or mis-allocated. **Result: three of those four properties do not hold.** Payment is not
> tenant-bounded, it *can* be replayed, and the live settlement ledger already disagrees with the
> commission rows it claims to have paid — visibly, on the agent demo persona's headline screen.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 40 |
| Artifacts examined | 40 |
| Coverage | 100% |
| Checks defined | 59 (the spec's 9 checks decomposed into executable sub-checks) |
| Checks executed | 59 |
| Checks passed / failed / blocked | 47 / 12 / 0 |
| Findings C / H / M / L / I | 2 / 3 / 4 / 4 / 2 |
| Evidence commands run | 38 |
| Excluded as demo-scope | 4 (no real payment rail behind the settlement upload; the "Ask for reason" mailto having no backend; no settlement audit trail; support-ticket store) |
| Blocked, with reason | none |

### Domain metrics (required by the A05 spec)
| Metric | Value |
|---|---|
| Commission rows audited | **5001** (live `count(*)`, matches baseline §6) |
| Duplicate-commission cases attempted / created | **2 / 1** — the in-scope case (second contribution, same agent) created **0** ✅; the agent-reassignment case created **1** (latent, no UI path — A05-013) |
| FIFO / allocation cases run / passed | **8 / 6** — failures: silent over-payment (A05-007), NULL `amountPaid` settles the whole slice (A05-006) |
| Replay cases run / passed | **4 / 2** — failures: same file + new nonce re-settles (A05-004), duplicate rows in one file double-settle (A05-005) |
| XLSX cases run / passed | **14 / 12** — failures: a 10× tampered amount is accepted client-side and silently truncated server-side; `parseAmount` misparses formula/scientific cells |
| Batch total mismatches | **4 of 5 live batches** — 25,000 UGX / 5 lines of settlement claimed but not backed by any `paid` commission row |

**Fixture hygiene:** every write probe in this report ran inside `BEGIN … ROLLBACK`. A final sweep
(`commissions`, `settlement_batches`, `settlement_uploads`, `subscribers`, `transactions`,
`notifications`, `commission_config`) returned **0 rows** matching any `A05*`/`AUDIT*`/`a05-*`
marker — **no fixture rows were left behind.** The only non-reversible side effect is that
`public.commission_id_seq` advanced (sequences are non-transactional), leaving a harmless gap in
the `c-NNNNNNNN` id space. `commission_config.rate` is back at 5000 for all three rows.

**Concurrency caveat:** other audit agents were writing to the same live DB during this run.
Mid-audit, `commissions` briefly read 5004 (three `A03AUDIT *` fixture rows for `a-001`, since
cleaned up) and `a-001`'s due slice reached 21 lines / UGX 105K. All figures in this report are
from the settled state: **5001 commissions, `a-001` = 4 due / 7 paid.** Where a screenshot was
taken during the noisy window it is flagged.

---

## 1. What the live commission engine actually is

| Layer | Live object | Verdict |
|---|---|---|
| Generation | `trg_transactions_contribution` (0089 rate lookup, 0104 NAV body) | ✅ correct, exactly-once per (subscriber, agent) |
| Rate resolution | `commission_rate_for_branch()` / `get_commission_rate()` (0089) | ✅ correct per distributor, with platform fallback |
| Rate write | `set_commission_rate()` (0089) | ✅ scoped, range-checked, role-gated |
| Settlement write | `apply_settlement(jsonb, text)` (0032 + 0051) | ❌ **no tenancy check, no NULL guard, no duplicate-reference guard** |
| Settlement ledger | `settlement_batches`, `settlement_uploads` | ❌ **does not reconcile with `commissions` in live data** |
| Reads | `get_commission_summary`, `get_entity_commission_summary`, `get_agent_commission_detail`, `get_agent_commission_list`, `get_pending_dues_by_agent`, `get_pending_dues_by_branch` (0029/0041/0087) | ✅ all correctly tenant-scoped |

The headline structural defect is an **asymmetry**: after the 0081–0089 scoping series every
*read* on the commission surface is bounded by `distributor_branch_ids()`, but the one *write*
that moves money — `apply_settlement` — was never given an ownership predicate. It gates on
`app_role` alone.

---

## 2. Findings

### A05-001 · CRITICAL · confirmed · tenancy
**Any distributor can settle any other distributor's agents' commissions.**

`public.apply_settlement(jsonb, text)` gates only on the caller's *role*
(`IF v_role NOT IN ('distributor','admin')`) and then trusts the caller-supplied `agentId`
verbatim. There is no check that the agent belongs to the caller's distributor. Reads are scoped;
the write is not.

Location: `public.apply_settlement` (live) · `supabase/migrations/0032_fix_settlement_apply.sql:130`
(role gate) and `:180` (the `WHERE agent_id = v_agent_id` line lookup) · widened by
`supabase/migrations/0051_admin_apply_settlement.sql`.

**Evidence** — run under the *real* `authenticated` role so RLS is active, then `RESET ROLE` to
read back what the `SECURITY DEFINER` body actually wrote. Whole thing rolled back.

```
$ psql "$SUPABASE_DB_URL" -X -q -f t_rls2.sql
       phase       | count
-------------------+-------
 baseline_a001_due |    21

       phase       |                                     r
-------------------+----------------------------------------------------------------------------
 d002_settles_a001 | {"skipped": [], "totalPaid": 10000, "linesSettled": 2, "agentsSettled": 1}

        phase        |   id    | agent_id | branch_id | amount | status | paid_amount |    txn_ref
---------------------+---------+----------+-----------+--------+--------+-------------+----------------
 PROOF_lines_flipped | c-00002 | a-001    | b-bui-001 |   5000 | paid   |        5000 | A05-XTEN-PROOF
 PROOF_lines_flipped | c-00003 | a-001    | b-bui-001 |   5000 | paid   |        5000 | A05-XTEN-PROOF

    phase    |                 id                  | agent_id | branch_id | pending_total | paid_amount | line_count |  client_nonce
-------------+-------------------------------------+----------+-----------+---------------+-------------+------------+----------------
 PROOF_batch | sb-25f3aed7c42b4fbf9f59754c0b6ed49c | a-001    | b-bui-001 |        105000 |       10000 |          2 | a05-xten-proof

    phase    | agent_owner_distributor
-------------+-------------------------
 PROOF_owner | d-001
```

The SQL that produced it (verbatim):
```sql
BEGIN;
SELECT 'baseline_a001_due' phase, count(*) FROM commissions WHERE agent_id='a-001' AND status='due';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"app_role":"distributor","distributorId":"d-002","sub":"d-002","role":"authenticated"}';
SELECT 'd002_settles_a001' phase, public.apply_settlement('[{"agentId":"a-001","amountPaid":12000,"paymentRef":"A05-XTEN-PROOF","paymentDate":"2026-08-23"}]'::jsonb,'a05-xten-proof') r;
RESET ROLE;
SELECT 'PROOF_lines_flipped' phase, id, agent_id, branch_id, amount, status, paid_amount, txn_ref FROM commissions WHERE txn_ref='A05-XTEN-PROOF';
SELECT 'PROOF_batch' phase, id, agent_id, branch_id, pending_total, paid_amount, line_count, client_nonce FROM settlement_batches WHERE txn_ref='A05-XTEN-PROOF';
SELECT 'PROOF_owner' phase, b.distributor_id FROM agents a JOIN branches b ON b.id=a.branch_id WHERE a.id='a-001';
ROLLBACK;
```

The write is **invisible to its own author** and **invisible-until-later to its victim**: in the
same session, d-002 could not read a single one of a-001's commission rows.

```
$ psql "$SUPABASE_DB_URL" -X -q -f t_rls.sql
                 phase                 | count
---------------------------------------+-------
 rls_active_d002_sees_a001_commissions |     0
 rls_active_d002_sees_own              |     8
```

It is symmetric — d-001 settling d-002's agent `a-780` works identically:
```
 before | a-780    | d-002          | due    |     8 | 40000
 result | {"skipped": [], "totalPaid": 15000, "linesSettled": 3, "agentsSettled": 1}
```
…while d-001's own scoped read of that agent returns nothing:
```
 d001_can_READ_a780 |     0
 d001_read_rowcount |  1408
```

**Reachable from the UI, unchallenged.** `CommissionPanel.jsx:482-509` (`confirmSummary`) builds a
`pendingMap` from `duesByAgent` — the caller's *scoped* pending list — and only raises an "amount
mismatch" warning for agents **found in that map**. An agent id that is not in it produces no
mismatch entry and no skip entry: the confirm modal renders a plain (non-caution) "Settle 1 agent ·
0 lines · UGX 15,000" and the green Confirm button fires the RPC. Uploading another distributor's
settlement sheet — spec check 6's last case — therefore succeeds end to end (see 6f in §3.6).

**Impact:** d-002 can mark d-001's commissions `paid`, stamp them with a payment reference d-001
never issued, emit `commission_settled` notifications to d-001's agents and branches, and write a
`settlement_batches` row into d-001's branch. d-001's dashboards then show money as settled that
was never paid. This is the exact class of gap the 0081–0089 series was written to close, on the
one surface that actually moves money.

**Fix:** add an ownership predicate inside the per-row loop, mirroring `0087`:
```sql
IF v_role = 'distributor'
   AND NOT EXISTS (SELECT 1 FROM public.agents a
                    WHERE a.id = v_agent_id
                      AND a.branch_id IN (SELECT public.distributor_branch_ids()))
THEN
  v_skipped := v_skipped || jsonb_build_array(
    jsonb_build_object('agentId', v_agent_id, 'reason', 'not_your_agent'));
  CONTINUE;
END IF;
```
plus a `not_your_agent` entry in `SETTLEMENT_SKIP_REASONS` (`src/utils/settlement.js:60`), and a
client-side pre-block in `confirmSummary` for any row whose `agentId` is absent from `pendingMap`.

---

### A05-002 · CRITICAL · confirmed · wrong money on a demo screen
**The agent demo persona's Commissions page presents leftover Playwright test runs as real
payment history, alongside two contradictory outstanding-balance figures.**

Location: live rows in `public.settlement_batches` · rendered by
`src/agent-dashboard/pages/CommissionsDesktop.jsx:206` and
`src/agent-dashboard/pages/CommissionsPage.jsx:124` via
`src/agent-dashboard/pages/commissions/CommissionsParts.jsx:123` (`SettlementMismatchBanner`).

**Evidence** — headless Chromium, `e2e/.auth/agent.json` (persona `a-001`, the documented demo
agent), `http://localhost:5173/dashboard/commissions`, clean baseline state:

```
===== agent /dashboard/commissions (1440x1000) =====
Commissions
UGX 55K earned and owed · 64% settled
Your last settlement was partial
UGX 5K paid against UGX 15K due — UGX 10K is still outstanding (ref sb-09258a3b9cc94064be51e0a6f0a04fa5).
Ask for reason
EARNED    UGX 35K
OWED      UGX 20K
SETTLED   64%
Earned  7 commissions paid   35K
Owed    4 awaiting payout    20K
HISTORY
Settlement history
#   PAID          REFERENCE                    LINES   DUE AT THE TIME   PAID     STATUS
1   3 Aug 2026    E2E-PARTIAL-1785752804482    1       UGX 15K           UGX 5K   PARTIAL
2   2 Aug 2026    E2E-PARTIAL-1785700815516    1       UGX 10K           UGX 5K   PARTIAL
3   2 Aug 2026    E2E-PARTIAL-1785700183410    1       UGX 5K            UGX 5K   FULL
4   16 Jul 2026   MM-SEED-0001                 9       UGX 45K           UGX 45K  FULL
```
Screenshots: `docs/audits/2026-08-23/screenshots/a05-agent-commissions-desktop.png`,
`a05-agent-commissions-mobile.png` (both viewports; the banner and history render identically at
390×844 — the mobile capture was taken during the A03-noise window and shows the inflated 105K).

Three separate wrongnesses on one screen, all visible without scrolling:

1. **The banner contradicts the tile.** "UGX 10K is still outstanding" sits directly above
   "OWED · UGX 20K · 4 awaiting payout". Both claim to be the agent's outstanding commission.
2. **Rows 1–3 are Playwright artifacts.** `E2E-PARTIAL-1785752804482` is a `Date.now()` reference
   minted by `e2e/specs/flows/distributor-apply-settlement.spec.ts:361`
   (`const paymentRef = \`E2E-PARTIAL-${Date.now()}\``) on 2026-08-02/03. The spec's `afterEach`
   deletes the batch only if `createdBatchIds` was assigned — and that assignment is the **last**
   statement of the test body (`:398-403`), so any failure before it leaks the batch permanently.
   Three leaked. **They have zero backing commission rows** (see A05-003).
3. **Row 4 disagrees with the EARNED tile.** `MM-SEED-0001` claims **9 lines / UGX 45K**; the
   EARNED tile says **UGX 35K / 7 commissions paid** — because two of the nine were flipped back to
   `due` by `seedDueCommissionForFixture` (`e2e/fixtures/db.ts:312`) and never restored.

A rep opening the agent persona's Commissions tab — a headline demo surface — lands on this.

**Fix:** delete the three orphan `E2E-PARTIAL-*` batches and their notifications, re-run the
settlement seed so `sb-seed-0001` matches the lines it flipped, and make the E2E `afterEach`
register `createdBatchIds` by `txn_ref` *before* the assertions rather than after. Longer term,
point the settlement specs at a dedicated fixture agent instead of the `a-001` demo persona.

---

### A05-003 · HIGH · confirmed · data invariant (spec check 7)
**`settlement_batches.paid_amount` / `line_count` do not equal the sum and count of the lines they
flipped — for 4 of 5 live batches. 25,000 UGX / 5 lines of settlement are claimed but unbacked.**

Location: live `public.settlement_batches`.

```
$ psql "$SUPABASE_DB_URL" -X -q -c "select b.id, b.txn_ref, b.agent_id, b.line_count claimed_lines, b.paid_amount claimed_paid,
   (select count(*) from commissions c where c.txn_ref=b.txn_ref and c.agent_id=b.agent_id and c.status='paid') actual_lines,
   (select coalesce(sum(c.paid_amount),0) from commissions c where c.txn_ref=b.txn_ref and c.agent_id=b.agent_id and c.status='paid') actual_paid
   from settlement_batches b order by b.created_at;"

                 id                  |          txn_ref          | agent_id | claimed_lines | claimed_paid | actual_lines | actual_paid
-------------------------------------+---------------------------+----------+---------------+--------------+--------------+-------------
 sb-seed-0001                        | MM-SEED-0001              | a-001    |             9 |        45000 |            7 |       35000
 sb-seed-0002                        | MM-SEED-0002              | a-042    |             3 |        15000 |            3 |       15000
 sb-aaa8b14105404d22b9b2a81e8b133cab | E2E-PARTIAL-1785700183410 | a-001    |             1 |         5000 |            0 |           0
 sb-3da879edd4bb4ac98a18346f1b66b6dc | E2E-PARTIAL-1785700815516 | a-001    |             1 |         5000 |            0 |           0
 sb-09258a3b9cc94064be51e0a6f0a04fa5 | E2E-PARTIAL-1785752804482 | a-001    |             1 |         5000 |            0 |           0
(5 rows)
```

Aggregate:
```
$ psql … -At -F'|' -c "select (select sum(paid_amount) from settlement_batches) batches_paid,
    (select sum(paid_amount) from commissions where status='paid') lines_paid,
    (select sum(line_count) from settlement_batches) batches_lines,
    (select count(*) from commissions where status='paid') lines_count;"
75000|50000|15|10
```

**75,000 UGX / 15 lines claimed vs 50,000 UGX / 10 lines actually paid.** The distributor's own
Commissions panel already shows the mismatch from the other side —
`SETTLED 50K · 10 paid` (screenshot `a05-distributor-settlement-feed.png`) — while the agent's
settlement history totals 60K for that same agent.

The RPC itself is *not* the cause: §3.4 proves `apply_settlement` reconciles exactly by
construction. The cause is external mutation — the E2E `afterEach` reverts `commissions` and
deletes batches independently, and any partial failure leaves the two out of step. There is no
constraint, trigger, or periodic check that would catch it.

**Fix:** repair the five rows; add a cheap invariant probe to `/qa` (the query above must return
zero mismatching rows).

---

### A05-004 · HIGH · confirmed · replay (spec check 5)
**Re-uploading the *same* settlement file settles another tranche against the *same* payment
reference. The nonce is minted per file-pick, so it never protects a re-upload.**

Location: `src/dashboard/commissions/CommissionPanel.jsx:358`
(`setPendingUpload({ ...normalized, nonce: newSettlementNonce() })`) and `:324`
(`e.target.value = ''` — an explicit reset so the *same* file can be re-picked) ·
`public.apply_settlement` (no `txn_ref` uniqueness).

Same nonce is genuinely idempotent (this half **passes**); a new nonce is not:

```
$ psql "$SUPABASE_DB_URL" -X -q -f t_replay.sql
   phase    | n |   s
------------+---+-------
 due_before | 4 | 20000

  phase  |                                     r
---------+---------------------------------------------------------------------------
 submit1 | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}

       phase       |                                     r
-------------------+---------------------------------------------------------------------------
 replay_same_nonce | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}

          phase           | count
--------------------------+-------
 batches_after_same_nonce |     1            <-- ✅ replay with the SAME nonce is a no-op

      phase       |                                     r
------------------+---------------------------------------------------------------------------
 replay_new_nonce | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}
 replay_new_nonce_2 | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}

          phase           |                 id                  | agent_id | pending_total | paid_amount | line_count |    txn_ref     | client_nonce
--------------------------+-------------------------------------+----------+---------------+-------------+------------+----------------+--------------
 batches_after_new_nonces | sb-c6ad8744b81c49e9a6a821bc53072cc2 | a-001    |         20000 |        5000 |          1 | A05-REPLAY-REF | a05-nonce-1
 batches_after_new_nonces | sb-8498bec4575b4cd1ab11b8ecf198deca | a-001    |         15000 |        5000 |          1 | A05-REPLAY-REF | a05-nonce-2
 batches_after_new_nonces | sb-19ae093c7dc4451c9dc1efc628fd5d1c | a-001    |         10000 |        5000 |          1 | A05-REPLAY-REF | a05-nonce-3

 phase | n |   s
-------+---+-------
 lines | 3 | 15000        <-- one real UGX 5,000 payment settled UGX 15,000 of commission

 phase  | count
--------+-------
 notifs |     6           <-- and emitted 6 "Commission settled" notifications
```

Three batches, **one payment reference**, three times the money. Nothing in the schema, the RPC,
or the UI treats a repeated `txn_ref` as suspicious. The pre-submit confirm modal *does* list an
"amount mismatch" (entered 5,000 vs pending 15,000) — but that is exactly what a legitimate
partial payment looks like under the documented INFORM-NOT-BLOCK semantics, so it reads as normal.

Double-clicking Confirm is safe: the button carries `disabled={… || applySettlement.isPending}`
(`CommissionPanel.jsx:1134`) and a genuinely concurrent same-nonce pair is serialised by the
`FOR UPDATE` lock, exactly as `0032`'s header claims.

**Coverage gap:** the *only* replay test in the suite is
`e2e/specs/flows/distributor-apply-settlement.spec.ts:432` — a `test.fixme` whose entire body is
`expect(true).toBe(true)`. The replay path has never been exercised by an executing test.

**Fix:** add `CREATE UNIQUE INDEX … ON settlement_batches (agent_id, txn_ref) WHERE txn_ref IS NOT
NULL`, or hash the normalised row set into the nonce so the same file yields the same nonce.

---

### A05-005 · HIGH · confirmed · double payment in a single upload
**Two rows for the same agent in one file settle that agent twice, in one call. The nonce cannot
help — it is one RPC invocation.**

Location: `public.apply_settlement` (`FOR v_row IN SELECT jsonb_array_elements(p_rows)` with no
per-agent grouping) · `src/utils/settlement.js:170` (`normalizeUploadedRows` does not de-duplicate
by `agentId`).

Client-side, both rows survive normalisation:
```
duplicate-agent-rows :: ok=true missing=[] accepted=[
  {"agentId":"a-001","amountPaid":5000,"paymentRef":"R1","paymentDate":""},
  {"agentId":"a-001","amountPaid":5000,"paymentRef":"R1","paymentDate":""}] skipped=[]
```
Server-side, both are applied:
```
$ psql "$SUPABASE_DB_URL" -X -q -f t_dupe.sql
   phase   |                                     r
-----------+----------------------------------------------------------------------------
 dupe_rows | {"skipped": [], "totalPaid": 10000, "linesSettled": 2, "agentsSettled": 2}

  phase  |                 id                  | agent_id | pending_total | paid_amount | line_count
---------+-------------------------------------+----------+---------------+-------------+------------
 batches | sb-370be86ba4974cf9835d00cb9de30ee5 | a-001    |         95000 |        5000 |          1
 batches | sb-11fbd8c1141c4fb79caed9ca14458a93 | a-001    |         90000 |        5000 |          1

 phase | n |   s
-------+---+-------
 lines | 2 | 10000

 phase  | count
--------+-------
 notifs |     4
```
Note `"agentsSettled": 2` for **one** agent — the toast in `CommissionPanel.jsx:372` will read
"Settled 2 agents", and the confirm modal's `agentCount` (`:503`, `pendingUpload.rows.length`) says
2 as well. There is no signal anywhere that it is the same agent twice. A distributor who appends a
correction row to the template instead of editing in place pays twice and is told nothing.

**Fix:** aggregate `p_rows` by `agentId` before the loop
(`SELECT agentId, sum(amountPaid) … GROUP BY agentId`), or reject a duplicated `agentId` with a new
`duplicate_agent` skip reason; mirror the de-duplication in `normalizeUploadedRows` so the confirm
modal counts distinct agents.

---

### A05-006 · MEDIUM · confirmed · missing NULL guard
**A settlement row whose `amountPaid` is NULL settles the agent's ENTIRE due slice.**

Location: `supabase/migrations/0032_fix_settlement_apply.sql:184`
(`EXIT WHEN v_remaining < v_line.amount;`) — with `v_remaining` NULL the comparison yields NULL,
which is not TRUE, so the loop never exits and every due line is stamped `paid`.
`v_amount_paid := round((v_row ->> 'amountPaid')::numeric)` (`:150`) yields NULL for an absent or
null key, and nothing validates it.

```
$ psql "$SUPABASE_DB_URL" -X -q -f t_null.sql
   phase    | n |   s
------------+---+-------
 due_before | 4 | 20000

    phase    |                                     r
-------------+----------------------------------------------------------------------------
 missing_key | {"skipped": [], "totalPaid": 20000, "linesSettled": 4, "agentsSettled": 1}

   phase   | n | s
-----------+---+---
 due_after | 0 |

 phase |     id     | amount | status | paid_amount |   txn_ref
-------+------------+--------+--------+-------------+-------------
 lines | c-00002    |   5000 | paid   |        5000 | A05-NULLAMT
 lines | c-00003    |   5000 | paid   |        5000 | A05-NULLAMT
 lines | c-00001    |   5000 | paid   |        5000 | A05-NULLAMT
 lines | c-01000100 |   5000 | paid   |        5000 | A05-NULLAMT

 phase | agent_id | pending_total | paid_amount | line_count |   txn_ref
-------+----------+---------------+-------------+------------+-------------
 batch | a-001    |         20000 |       20000 |          4 | A05-NULLAMT
```
The payload was `[{"agentId":"a-001","paymentRef":"A05-NULLAMT","paymentDate":"2026-08-23"}]` —
**no amount at all** — and it recorded a UGX 20,000 settlement.

**Not reachable from the current UI**: `normalizeUploadedRows` drops any row whose amount fails
`parseAmount` (`src/utils/settlement.js:190`), so a blank cell becomes a `no_amount` skip
(verified — case 6a in §3.6). But `apply_settlement` is `GRANT EXECUTE … TO authenticated`
(`0032:318`) and every distributor and admin token can call it directly, and `0032`'s own header
claims the RPC applies defence-in-depth on the amount ("defence-in-depth alongside the FE
parseAmount rounding"). It does not.

**Fix:** after the `round()`, add
`IF v_amount_paid IS NULL OR v_amount_paid <= 0 THEN … skip 'no_amount' … CONTINUE; END IF;`.

---

### A05-007 · MEDIUM · confirmed · over-payment silently swallowed
**Entering more than the agent's due total records only the allocated amount, with no skip reason,
no warning, and no record of the difference.**

Location: `supabase/migrations/0032_fix_settlement_apply.sql:203` — the batch records
`v_settled_total` (what was allocated), and the leftover `v_remaining` is discarded when the loop
ends.

```
$ psql "$SUPABASE_DB_URL" -X -q -f t_dupe.sql   (second transaction)
   phase    | n  |   s
------------+----+-------
 due_before | 19 | 95000

  phase  |                                      r
---------+-----------------------------------------------------------------------------
 overpay | {"skipped": [], "totalPaid": 95000, "linesSettled": 19, "agentsSettled": 1}

 phase | agent_id | pending_total | paid_amount | line_count
-------+----------+---------------+-------------+------------
 batch | a-001    |         95000 |       95000 |         19
```
Entered **200,000**; recorded **95,000**; the other **105,000** exists nowhere. `skipped` is empty,
so the post-settlement result panel (`CommissionPanel.jsx:1030`) shows nothing, and the toast
reports the *server's* total, so the discrepancy is never surfaced after the fact. A 10×
fat-fingered or tampered cell is accepted client-side too:
```
6c tampered-10x-and-negative :: accepted=[{"agentId":"a-001","amountPaid":200000,…}] skipped=[{"agentId":"a-042","reason":"no_amount"}]
```
The pre-submit confirm modal *does* list it as an "amount mismatch" (`entered UGX 200,000 vs
pending UGX 20,000`) with a caution-variant Confirm button — that is the only guard, and it is
advisory.

**Fix:** either cap and report (`skipped … 'overpaid'` carrying the unallocated remainder) or
record the entered amount on the batch alongside the allocated one so the two can be reconciled.
Under-payment is deliberately INFORM-NOT-BLOCK; over-payment has no equivalent story.

---

### A05-008 · MEDIUM · confirmed · cross-branch mis-attribution in seeded settlement
**The two seeded settlement batches are stamped with a branch the agent does not belong to, so
`settlement_batches` RLS and the `commission_settled` notification route them to the wrong branch.
The `b-kam-015` demo branch persona is told UGX 45,000 was paid, while its own Commissions page
shows 0 paid and a 0% settlement rate.**

Location: `scripts/seed-supabase.mjs:1108-1109` — `branchId: 'b-kam-015'` for `a-001` and
`branchId: 'b-mba-290'` for `a-042`, neither of which is the agent's branch.

```
$ psql … -c "select b.id, b.agent_id, b.branch_id, a.branch_id as agent_branch
             from settlement_batches b join agents a on a.id=b.agent_id
             where b.branch_id is distinct from a.branch_id;"
sb-seed-0001|a-001|b-kam-015|b-bui-001
sb-seed-0002|a-042|b-mba-290|b-buv-007

$ psql … -c "select status, count(*), sum(amount) from commissions where branch_id='b-kam-015' group by 1;"
due|31|155000                      <-- zero paid commissions in this branch

$ psql … -c "select recipient_role, recipient_id, body, amount, ref_id from notifications where ref_id like 'sb-seed%';"
agent |a-001    |UGX 45000 paid for 9 commissions.|45000|sb-seed-0001
branch|b-kam-015|UGX 45000 paid for 9 commissions.|45000|sb-seed-0001
agent |a-042    |UGX 15000 paid for 3 commissions.|15000|sb-seed-0002
branch|b-mba-290|UGX 15000 paid for 3 commissions.|15000|sb-seed-0002
```

Rendered — headless Chromium, `e2e/.auth/branch.json` (persona `b-kam-015`), notification bell on
`/dashboard` (screenshot `a05-branch-notification-bell.png`):
```
Notifications          Mark all read
Commission settled                      3w
UGX 45000 paid for 9 commissions.
```
…while the same persona's `/dashboard/commissions`
(screenshot `a05-branch-commissions.png`) reads:
```
SETTLED THIS CYCLE  0     Paid across 0 agents
DUE NEXT RUN        155K  Pending settlement
SETTLEMENT RATE     0%    Paid ÷ (paid + due)
```
and its agent roster (`a05-branch-analytics.png`) is Beatrice Drazu, Brenda Nankya, Annet Drazu,
Frank Lubega, Lillian Nankya — **Dorothy Kiiza (`a-001`) is not in this branch at all.**

The live `apply_settlement` does this correctly (`SELECT branch_id INTO v_branch_id FROM agents`,
`0032:174`); only the seed hardcodes it. Note also the unformatted body: the seed writes
`UGX 45000` while every RPC-generated notification writes `UGX 5,000`
(`0032:212`, `to_char(…,'FM999,999,999,999')`).

**Fix:** derive `branchId` from the agent in `settlementSeeds` rather than hardcoding it, and route
the seed's notification bodies through `formatSettlementNotificationBody`
(`src/utils/settlement.js:44`) so live and seeded copy match.

---

### A05-009 · MEDIUM · confirmed · dangerous rollback path
**`0089_per_distributor_commission_rate.down.sql` re-emits `trg_transactions_contribution` from a
pre-NAV snapshot. Executing it would silently revert the 0103–0107 NAV pricing work and reinstate
the hardcoded 1,000 UGX unit price.**

Location: `supabase/migrations/0089_per_distributor_commission_rate.down.sql:22`
(`v_unit_price NUMERIC := 1000;`) vs live (`v_unit_price := public.nav_for_date(...)`).

```
$ grep -n "v_unit_price" supabase/migrations/0089_per_distributor_commission_rate.down.sql
22:  v_unit_price       NUMERIC := 1000;
58:    NEW.amount / v_unit_price,
118:                 units             = units - (v_target / v_unit_price),   -- v_unit_price = 1000

$ psql … -c "select pg_get_functiondef(oid) from pg_proc where proname='trg_transactions_contribution';" | grep -n "v_unit_price"
8:  v_unit_price       NUMERIC;   -- 0104: the fund NAV, assigned in BEGIN
25:  v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));
```
The down file also predates the `invested`-column arithmetic 0104 added at its lines 193-195, so a
rollback would drop that too. **Parsed only — not executed (G6).** The same hazard applies to every
`.down.sql` in the `trg_transactions_contribution` chain authored before 0104 (0042, 0043, 0072
also re-emit it); 0089 is the one inside A05's scope.

**Fix:** either regenerate the affected down files from the live body at authoring time (the
technique 0089's own forward migration used and documented), or mark them
"forward-only — do not execute" and remove the trigger re-emission.

---

### A05-010 · LOW · confirmed · internal identifier shown to the agent
`SettlementMismatchBanner` surfaces the batch's internal UUID rather than the human payment
reference: *"…is still outstanding (ref sb-09258a3b9cc94064be51e0a6f0a04fa5)"*
(`src/agent-dashboard/pages/commissions/CommissionsParts.jsx:149`, and the same id in the mailto
body at `:132`). The batch carries a `txn_ref` (`E2E-PARTIAL-1785752804482` here; `MM-…` in
production shape) which is what a mobile-money payer would actually recognise. A 34-character
opaque token is the opposite of the plain-language, low-literacy copy standard this product holds.

---

### A05-011 · LOW · confirmed · `parseAmount` misparses non-numeric money cells
Location: `src/utils/finance.js:110-122`.
```
$ node u/rt2.mjs
  parseAmount("=1+1")            = 11        <-- a formula cell becomes UGX 11
  parseAmount("1e9")             = 19        <-- scientific notation becomes UGX 19
  parseAmount("0.4")             = 0         <-- returns 0, violating the documented "> 0"
  parseAmount("UGX 20,000")      = 20000     ✅
  parseAmount("20 000")          = 20000     ✅
  parseAmount("4999.6")          = 5000      ✅ (round-to-whole-UGX by design)
  parseAmount("lots")            = null      ✅
  parseAmount("-5") / ("0") / ("")= null      ✅
```
`[^\d.-]` stripping turns `=1+1` into `11` and `1e9` into `19` — plausible-looking amounts that a
distributor would never notice. `0.4` slips through because the `n <= 0` guard runs **before**
`Math.round`, so the function returns `0` despite its contract ("a whole-UGX integer > 0"). Zero
then reaches the RPC and is skipped as `amount_too_low`, so nothing breaks today; the contract is
still violated. Related: the same file-parse path accepted an `Agent ID` of `=cmd|calc`
(case 6c3), which is the classic spreadsheet formula-injection shape.

**Fix:** reject any cell that is not a clean numeric after stripping only currency symbols and
group separators; move the positivity check after the rounding.

---

### A05-012 · LOW · confirmed · a commission rate of 0 creates UGX 0 commission rows
`set_commission_rate` permits `p_rate = 0` (`0089:107`, `IF p_rate < 0 OR p_rate > v_rate_max`).
`commission_rate_for_branch` then returns `0`, and the trigger's guard is
`IF v_commission_rate IS NOT NULL` — `0` is not NULL, so a UGX 0 commission row is inserted rather
than none:
```
$ psql "$SUPABASE_DB_URL" -X -q -f t_zero.sql
        phase         |     id     | agent_id | subscriber_id | amount | status
----------------------+------------+----------+---------------+--------+--------
 zero_rate_commission | c-01000122 | a-001    | a05-zero-sub  |      0 | due
```
An operator who legitimately sets "no commission" gets a ledger full of zero-value `due` lines,
inflating every "N commissions owed" count. Not present in live data (all 5001 rows are 5000).

---

### A05-013 · LOW · confirmed (latent) · one subscriber can yield two commissions
The trigger's exactly-once guard keys on **(subscriber_id, agent_id)**, not on subscriber alone
(`live trg_transactions_contribution`, and `ux_commissions_agent_subscriber` mirrors it). Adding a
second contribution under the same agent correctly creates nothing; re-pointing the subscriber at a
different agent and contributing again creates a second commission:
```
$ psql "$SUPABASE_DB_URL" -X -q -f t_second_contrib.sql
        phase         | commissions_for_sub
----------------------+---------------------
 before               |                   1
 after_second_contrib |                   1      <-- ✅ same agent: no duplicate

     phase      |     id     | agent_id | branch_id | subscriber_id | amount | status
----------------+------------+----------+-----------+---------------+--------+--------
 after_reassign | c-00004    | a-001    | b-bui-001 | s-0004        |   5000 | paid
 after_reassign | c-01000106 | a-042    | b-buv-007 | s-0004        |   5000 | due   <-- second commission
```
`trg_subscribers_enforce_editable_cols` blocks `agent_id` edits **only for `app_role='subscriber'`**,
so any other role with an UPDATE grant on `subscribers` could trigger it. No UI path in the repo
re-assigns `agent_id` (0060's deactivation sets it to NULL, which is safe), and live data has
**zero** subscribers with more than one commission, so this is latent, not live.

---

### A05-014 · INFO · confirmed · `settlement_uploads` is an unbounded, un-reconciled ledger
141 rows, of which 126 claim `linesSettled > 0`, totalling **1,530,000 UGX / 306 lines** "settled" —
against 5 batches and 50,000 UGX actually paid.
```
$ psql … -At -c "select count(*) from settlement_uploads;"                                          141
$ psql … -At -c "select count(*) from settlement_uploads where (result->>'linesSettled')::int > 0;"  126
$ psql … -At -F'|' -c "select sum((result->>'totalPaid')::numeric), sum((result->>'linesSettled')::int) from settlement_uploads;"
1530000|306
```
The E2E `afterEach` reverts the commissions and deletes the batches but never the ledger row, so
the idempotency store accumulates and permanently diverges from reality. Nothing user-visible reads
it (it has no RLS policies and no `authenticated` grant — RPC-internal by design), so this is an
observation, not a defect. Today's baseline Playwright run added 8 more rows and **zero** orphan
batches, i.e. the cleanup works when tests pass.

---

### A05-015 · INFO · confirmed · migration 0087 documents a fix it never emits
`0087_scope_commission_rpcs.sql:15-19` states that `get_agent_commission_detail` gains an ownership
guard and "now returns NULL" for a foreign agent. The migration body contains four numbered
sections and **none of them re-emits that function**; the live definition is still the `0029` body:
```
$ psql … -c "select pg_get_functiondef(oid) from pg_proc where proname='get_agent_commission_detail';" | head -6
CREATE OR REPLACE FUNCTION public.get_agent_commission_detail(p_agent_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
```
The **behaviour is nevertheless correct**, because the function is `SECURITY INVOKER` and RLS on
`public.agents` makes the opening `SELECT … INTO v_agent` find nothing, hitting the `IF NOT FOUND
THEN RETURN NULL`:
```
$ psql … -f t_rls.sql   (SET LOCAL ROLE authenticated; distributorId=d-002)
        phase        | agent_name | agent_phone | branch_name | total | due_lines
---------------------+------------+-------------+-------------+-------+-----------
 d002_detail_of_a001 |            |             |             |       |            <-- NULL
```
Doc/implementation drift only — no user-visible effect. (Under a superuser psql session RLS is
bypassed and the function returns a populated object; that is a testing artefact, not a leak.)

---

## 3. Check-by-check narrative

### 3.1 Two-state `commission_status` — PASS
```
$ psql … -c "select status, count(*) from commissions group by 1 order by 1;"
due|4991
paid|10
$ psql … -c "select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='commission_status' order by enumsortorder;"
due
paid
```
The `0029` enum collapse is complete: two labels in the type, two values in 5001 rows, and none of
`released` / `confirmed` / `in_run` / `held` / `disputed` / `rejected` survives. `\d commissions`
confirms every dispute/hold/confirm column and `run_id` are gone and `paid_amount` is present.

### 3.2 Exactly one commission per first contribution — PASS
```
$ psql … -c "select count(*) from (select subscriber_id from commissions group by 1 having count(*)>1) x;"   0
$ psql … -c "select amount, count(*) from commissions group by 1 order by 2 desc;"                            5000|5001
$ psql … -c "select count(distinct s.id) from subscribers s where s.agent_id is not null
             and exists (select 1 from transactions t where t.subscriber_id=s.id and t.type='contribution');" 5001
$ psql … -c "select count(*) from commissions;"                                                               5001
```
**5001 = 5001.** Every agent-attributed subscriber with a contribution has exactly one commission,
all at the configured 5,000 UGX rate. The fixture test (§A05-013 evidence) confirms a second
contribution creates nothing. Enforced twice: the trigger's `IF NOT EXISTS` guard and
`ux_commissions_agent_subscriber`.

### 3.3 Per-distributor rate resolution — PASS
Distinct rates written per distributor inside a rolled-back transaction, then resolved:
```
 config          | cfg-d-001 | d-001 | 7777
 config          | cfg-d-002 | d-002 | 8888
 config          | default   |       | 9999
 rate_for_branch | b-bui-001           | d-001 | 7777
 rate_for_branch | b-kam-015           | d-001 | 7777
 rate_for_branch | b-bug-074           | d-002 | 8888
 rate_for_branch | b-demo-mrt-001      | d-003 | 9999   <-- d-003 has no config row → platform fallback
 rate_for_branch | tst-branch-msc7w8vm |       | 9999   <-- unowned branch → platform fallback
 rate_null_branch  | 9999      rate_bogus_branch | 9999
 gcr_d001 | 7777   gcr_d002 | 8888   gcr_d003_no_row | 9999   gcr_admin | 9999   gcr_agent | 9999
```
`set_commission_rate` writes only the caller's own row (`d002_sets_own → cfg-d-002 rate 6000,
last_updated_by d-002`; `cfg-d-001` and `default` untouched), enforces the ceiling
(`ERROR: commission rate 1000001 out of range [0, 1000000]`) and the role gate
(`ERROR: role agent cannot set the commission rate`). The only gap is the zero-rate case
(A05-012).

Aside: `tst-branch-msc7w8vm` has `distributor_id IS NULL` — E2E residue that escapes
`distributor_branch_ids()` scoping and falls back to the platform rate. Out of A05's scope; flagged
for whoever owns orphan cleanup.

### 3.4 `apply_settlement` allocation — FIFO correct, guards missing
FIFO was made observable by giving `a-001`'s four due lines distinct amounts and ordered due dates
inside a rolled-back transaction, then paying 8,000:
```
 fixture | c-00001    | 3000 | 2024-01-01
 fixture | c-00002    | 5000 | 2024-02-01
 fixture | c-00003    | 7000 | 2024-03-01
 fixture | c-01000100 | 9000 | 2024-04-01

 fifo8000 | {"skipped": [], "totalPaid": 8000, "linesSettled": 2, "agentsSettled": 1}

 after | c-00001    | 3000 | 2024-01-01 | paid | 3000 | AUDIT-FIFO
 after | c-00002    | 5000 | 2024-02-01 | paid | 5000 | AUDIT-FIFO
 after | c-00003    | 7000 | 2024-03-01 | due  |      |
 after | c-01000100 | 9000 | 2024-04-01 | due  |      |

 batch | a-001 | pending_total 24000 | paid_amount 8000 | line_count 2 | AUDIT-FIFO
```
Oldest-first ✅ · partial leaves the remainder genuinely `due` ✅ · each line stamped with its **own**
amount (BL-2) ✅ · `SUM(paid_amount) == settlement_batches.paid_amount` ✅ · the batch's
`pending_total` is the full due slice at the time ✅.

Edge amounts:
```
 zero     | {"skipped": [{"reason":"amount_too_low","agentId":"a-001"}], "totalPaid": 0, …}   ✅
 negative | {"skipped": [{"reason":"amount_too_low","agentId":"a-001"}], "totalPaid": 0, …}   ✅
 fraction | 4999.6 → {"totalPaid": 5000, "linesSettled": 1}                                   ✅ (round-to-whole-UGX, BL-8)
 NULL     | {"totalPaid": 20000, "linesSettled": 4}                                           ❌ A05-006
 overpay  | 200000 entered → recorded 95000, skipped []                                       ❌ A05-007
```
Role gate: `branch` → `ERROR: role branch cannot apply a settlement` ✅; `admin` allowed (0051, by
design — the admin is platform-wide) ✅; `distributor` allowed but **unbounded** ❌ (A05-001).

### 3.5 Replay — see A05-004 / A05-005.

### 3.6 Excel round trip — 12 of 14 cases pass
Harness: the repo's own `buildWorkbookBuffer` → `File` → `parseSheet` → `detectMissingColumns` →
`normalizeUploadedRows`, i.e. the exact production path, run under Node 24 against the pinned
SheetJS CDN build (`xlsx-0.20.3`).
```
6a unmodified-template     :: accepted=[] skipped=[no_amount ×2]                       ✅
6b filled-correct          :: accepted=[a-001 20000, a-042 15000]                       ✅
6c tampered-10x            :: accepted=[a-001 200000]                                   ❌ → A05-007
6c  negative               :: skipped=[no_amount]                                       ✅
6c2 text-amount            :: skipped=[no_amount]                                       ✅
6c3 formula-injection      :: accepted=[{"agentId":"=cmd|calc","amountPaid":11}]        ❌ → A05-011
6c4 grouped-string         :: "UGX 20,000" → 20000                                      ✅
6d1 wrong-extension (.exe) :: PARSE-ERROR "Unsupported file type \".exe\"…"             ✅
6d2 wrong-mime             :: PARSE-ERROR "Unsupported file type…"                      ✅
6d3 empty-file             :: PARSE-ERROR "The uploaded file is empty."                 ✅
6d4 garbage-bytes          :: PARSE-ERROR "The first sheet contains no data rows."      ✅
6d5 oversize (5 MB + 1 B)  :: PARSE-ERROR "The file is too large (5 MB)…"               ✅
6e  renamed-header         :: ok=false missing=[Agent ID] → actionable toast            ✅
6e2 reordered-header       :: accepted (order-independent, by design)                   ✅
6f  ANOTHER DISTRIBUTOR'S FILE :: accepted=[{"agentId":"a-780","amountPaid":15000,…}]   ❌ → A05-001
```
`parseSheet` hardening (`src/utils/xlsx.js:38-48`) is genuinely good: 5 MB cap, extension
allowlist, MIME cross-check, `sheetRows: 50_000`. Per baseline §3, `npm audit` reports **no
advisory against `xlsx`** — no CVE is claimed here.

### 3.7 Batch reconciliation — see A05-003. Structural sanity is otherwise clean:
```
$ psql … -c "select count(*) filter (where paid_amount>pending_total) overpaid,
             count(*) filter (where line_count<=0) zero_lines,
             count(*) filter (where paid_amount<=0) zero_amount,
             count(*) filter (where branch_id is null) null_branch from settlement_batches;"
0|0|0|0
```

### 3.8 Orphans — PASS
```
orphan commissions (agent)      0        FK: commissions_agent_id_fkey → agents(id) ON DELETE CASCADE
orphan commissions (subscriber) 0        FK: commissions_subscriber_id_fkey → subscribers(id) ON DELETE CASCADE
orphan commissions (branch)     0        FK: commissions_branch_id_fkey → branches(id) ON DELETE SET NULL
commission.branch_id ≠ agent.branch_id   0
paid rows missing paid_amount/date/ref   0 | 0 | 0     paid_amount ≠ amount: 0
due rows carrying a settlement stamp     0
```
`settlement_batches` carries the same two FKs. Note the FK asymmetry: `ON DELETE CASCADE` on
`agent_id` means deleting an agent silently destroys their settlement history — no A05 finding
(no delete path exists), but worth knowing.

### 3.9 The `0021` run model is functionally dead — PASS (A03 owns the report)
```
$ psql … -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in
   ('open_run','cancel_run','release_run','release_branch','branch_approve_all','mark_branch_reviewed',
    'branch_approve_line','branch_hold_line','branch_dispute_line','agent_dispute_line','approve_dispute',
    'reject_dispute','withdraw_dispute','agent_confirm_commission','get_run_branch_breakdown',
    'trg_commissions_before_update');"                                                                  0
$ psql … -c "select count(*) from pg_class where relnamespace='public'::regnamespace
             and relname in ('settlement_runs','settlement_run_branch_reviews');"                       0
```
Zero functions, zero tables. Confirms baseline §5.1. Not re-reported as an A05 finding.

---

## 4. Traceability
| # | Spec check | Disposition |
|---|---|---|
| 1 | `commissions.status` strictly two-state in live data | **PASS** (§3.1) |
| 2 | Exactly one commission per first contribution, correct rate; second contribution creates none | **PASS** for the specified case (§3.2). Adjacent latent case → **FINDING A05-013** |
| 3 | Per-distributor rate resolution (`commission_rate_for_branch` / `get_commission_rate`) incl. fallback, d-001 & d-002 | **PASS** (§3.3). Zero-rate edge → **FINDING A05-012** |
| 4 | `apply_settlement`: FIFO, partial, over-payment, zero, negative, foreign agent | **FINDING A05-001** (foreign agent, Critical), **A05-006** (NULL), **A05-007** (over-payment). FIFO / partial / zero / negative sub-checks **PASS** (§3.4) |
| 5 | Replay: same nonce → single effect; same file + new nonce → ? | **FINDING A05-004** (new nonce re-settles) and **A05-005** (duplicate rows in one call). Same-nonce replay sub-check **PASS** (§3.5) |
| 6 | Excel round trip: download, unmodified, tampered, malformed/oversize, another distributor's file | **FINDING A05-001** (foreign file), **A05-007** (tampered amount), **A05-011** (formula/scientific misparse). 11 of 14 sub-cases **PASS** (§3.6) |
| 7 | `settlement_batches.paid_amount` / `line_count` == the lines they flipped, over all live batches | **FINDING A05-003** (+ the UI consequence, **A05-002**) |
| 8 | No commission references a deleted subscriber or agent | **PASS** (§3.8) |
| 9 | `0021` run-model RPCs functionally dead (one line, A03 owns the report) | **PASS** (§3.9) |
| — | Rollback path for the in-scope migrations (parse only, G6) | **FINDING A05-009** |
| — | Cross-branch attribution of settlement rows + notifications | **FINDING A05-008** |
| — | Agent-facing settlement copy / identifiers | **FINDING A05-010** |
| — | Idempotency-ledger hygiene | **FINDING A05-014** (Info) |
| — | Migration-text vs live-definition drift on the commission read RPCs | **FINDING A05-015** (Info) |

**No check is unmapped. No check was blocked.**

## 5. Artifacts written
```
docs/audits/2026-08-23/05-commission-settlement.md              (this file)
docs/audits/2026-08-23/screenshots/a05-agent-commissions-desktop.png
docs/audits/2026-08-23/screenshots/a05-agent-commissions-mobile.png
docs/audits/2026-08-23/screenshots/a05-branch-commissions.png
docs/audits/2026-08-23/screenshots/a05-branch-notifications.png
docs/audits/2026-08-23/screenshots/a05-distributor-commissions.png
docs/audits/2026-08-23/screenshots/a05-branch-analytics.png
docs/audits/2026-08-23/screenshots/a05-branch-notification-bell.png
docs/audits/2026-08-23/screenshots/a05-distributor-settlement-feed.png
```
No file outside `docs/audits/2026-08-23/` was created or modified. All probe SQL and the XLSX
harness live in the session scratchpad.
