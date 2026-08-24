# A05 Adversarial Verification — Commissions & Settlement

**Verifier stance:** refute by default. Every write reproduced under `BEGIN … ROLLBACK`
with a post-rollback re-read proving zero persistence. Final sweep: 0 `A05V%` rows in
`settlement_batches`, `commissions`, `settlement_uploads`, `notifications`.

**Bottom line:** all 5 critical/high findings CONFIRMED; all 3 spot-checked mediums
CONFIRMED. No refutations, no demo-scope dismissals, no severity adjustments. A05's
evidence held up on a live re-run — and A05-003's reconciliation gap has actually
*widened* since A05 ran (more Playwright residue accrued).

## Critical / High

### A05-001 — apply_settlement has no tenancy check (critical) → CONFIRMED
Reproduced live: a JWT claiming `app_role=distributor / distributorId=d-002` called
`apply_settlement` on `a-001` (an agent owned by **d-001** via branch `b-bui-001`).
Result `{"linesSettled":2,"totalPaid":10000}`; two commissions flipped to `paid`, a
`settlement_batches` row written into the victim's branch, notifications emitted — all
rolled back. The RPC body checks only `v_role IN ('distributor','admin')`; there is no
predicate tying the agent to the caller's distributor. The function is
`SECURITY DEFINER` + `GRANT EXECUTE … authenticated`, and the client calls
`supabase.rpc('apply_settlement', …)` directly (`src/services/commissions.js:397`) with
no Express gate; the upload UI never filters the file's agentIds to the caller's roster
(`CommissionPanel.jsx handleUploadFile` → `normalizeUploadedRows`, no tenancy check). So
the one write that moves money escaped the 0081–0089 read-side tenancy net. Critical is
correct: it writes another tenant's data and surfaces fabricated settled money on the
victim's dashboards. (Precondition is an authenticated distributor deliberately
supplying a foreign agentId — noted, but explicitly in-scope per the DO-report list.)

### A05-002 — agent Commissions page shows test residue + contradictory balances (critical) → CONFIRMED
Verified at the data layer that drives the UI. `a-001` carries multiple
`settlement_batches` rows with `E2E-PARTIAL-…`/`E2E-FULL-…` refs and **zero** backing
`paid` commissions; the three 2026-08-02/03 rows pre-date this audit, so they are genuine
persistent residue, not an artifact of our own run (two more residue rows dated
2026-08-24 have since appeared — the leak is ongoing). The agent history table reads
`settlement_batches` (`getSettlementsList`), so those machine-token refs render as
"payment history." The partial-settlement banner computes shortfall from the newest
batch's `pending_total − paid_amount` (`CommissionsParts.jsx:126`) — currently
15K "still outstanding" from a stale E2E batch — while the OWED tile reads live `due`
(4 lines / 20K): two different outstanding figures on one screen. Row 4 (`sb-seed-0001`)
claims 9 lines / 45K while `a-001` has only 7 paid / 35K — a seed-level inconsistency
independent of Playwright. Critical stands (agent is a documented demo persona; screen
shows wrong/contradictory money).

### A05-003 — settlement_batches don't reconcile with the lines they flipped (high) → CONFIRMED
Live reconciliation now reads `batches_paid=100000` vs `lines_paid=50000`,
`batches_lines=20` vs `lines_count=10` — i.e. 50K / 10 lines of settlement are unbacked
(A05 measured 25K / 5; the gap grew as more E2E residue accrued). Four+ of the live
batches have zero backing `paid` commissions for their `(txn_ref, agent_id)`. No
constraint/trigger catches it. High confirmed.

### A05-004 — same file re-picked replays a settlement under a new nonce (high) → CONFIRMED
Reproduced live (rolled back): same nonce twice = no-op (idempotent), but three calls
with **new** nonces and the **same** `paymentRef` settled three separate 5K tranches
(15K total, 6 notifications) against one payment reference. Nonce is minted per
file-pick (`CommissionPanel.jsx:358`) and `e.target.value=''` (:324) lets the identical
file be re-selected; `apply_settlement` has no `txn_ref` uniqueness. The only replay
test is `test.fixme(…) { expect(true).toBe(true) }` (spec :426–433). High confirmed.

### A05-005 — duplicate agent rows in one upload settle the agent twice (high) → CONFIRMED
Reproduced live (rolled back): one RPC call with `a-001` listed twice returned
`{"agentsSettled":2,"linesSettled":2,"totalPaid":10000}` and wrote two batches for the
same agent. `normalizeUploadedRows` does not dedupe by agentId, and the loop
`FOR v_row IN SELECT jsonb_array_elements(p_rows)` has no per-agent grouping. The success
toast would read "Settled 2 agents" for one agent. High confirmed.

## Mediums spot-checked

- **A05-006** (NULL amountPaid settles entire slice) → **CONFIRMED**. Payload with no
  `amountPaid` key returned `{"linesSettled":4,"totalPaid":20000}` and zeroed the due
  slice — the `EXIT WHEN v_remaining < v_line.amount` guard is skipped when
  `v_remaining` is NULL. A05 correctly notes it is not UI-reachable (the client filters
  amount-less rows as `no_amount`) but the RPC is directly callable by any authenticated
  distributor/admin. Medium is right.
- **A05-008** (seeded batches stamped with wrong branch) → **CONFIRMED**. `sb-seed-0001`
  (`a-001`) is stamped `b-kam-015` though the agent's branch is `b-bui-001`;
  `sb-seed-0002` (`a-042`) stamped `b-mba-290` vs `b-buv-007`. `b-kam-015` (a documented
  demo branch persona) has 31 due / 0 paid commissions yet receives a
  `UGX 45000 paid for 9 commissions` notification/batch — a demo-visible contradiction.
  Body is unformatted (`UGX 45000`, no separators) unlike RPC-generated ones. Medium right.
- **A05-009** (0089 down-migration reverts NAV pricing) → **CONFIRMED**. `0089…down.sql:15`
  re-`CREATE OR REPLACE`s `trg_transactions_contribution` with hardcoded
  `v_unit_price NUMERIC := 1000`, while the live function assigns
  `v_unit_price := public.nav_for_date(...)` (0104). Running the down would silently
  clobber the 0103–0107 NAV work. Parsed only (G6). Medium (missing safe rollback path).

## Write discipline
Every reproduction ran inside `BEGIN … ROLLBACK`; post-rollback re-reads returned the
baseline. Final residue sweep returned 0 rows for all `A05V%` markers. Nothing committed.
