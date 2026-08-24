# A06 — Adversarial Verification

Verifier ran every critical/high finding against the LIVE DB from a clean state (all writes wrapped in BEGIN…ROLLBACK; nothing committed). 3 mediums spot-checked. No fixture rows created.

## Critical / High

### A06-001 (critical) — CONFIRMED
emp-001 EMP- residue = **1,881 rows, ALL belonging to emp-001** (`group by employer_id` returns `emp-001|1881` only). Contribution legs 60,146,000 + 60,146,000 = **120,292,000** fabricated. Roster balance 197,491,903 → 60.9% residue. Per-head emp-001 **9,404,376** vs next employer ~4.2M (emp-004) / 3.70M (emp-002). AUM 2,450,226,487. empe-001 has 99 of 116 txns as EMP-%. emp-001 is the default employer persona (dp-e-001) and every member's transaction list shows the payroll triple repeated ~33×. A rep scrolling a member's history sees obviously duplicated data → visible demo failure. Nuance: balances are internally consistent with the ledger (the ledger itself is polluted), and "3.70M next employer" in the write-up is emp-002's per-head, not emp-004's — immaterial. **Critical stands.**

### A06-002 (high) — CONFIRMED
`transactions_contribution_run_id_fkey … ON DELETE SET NULL` exists → the cleanup comment's premise ("no run_id FK on transactions") is false. 33 refs / 1,881 rows / only 57 still carry contribution_run_id. `contribution_run_lines` table does not exist (0). `contribution_run_uploads` columns are `nonce, result, created_at` (no employer_id) and holds 33 rows. Every claim reproduced.

### A06-003 (high) — CONFIRMED (borderline medium)
Seed `MOCK_NOW = new Date(2026,4,26)` (2026-05-26) vs mockData `new Date(2026,6,1)` (2026-07-01) — the seed's own comment ("MUST mirror … = 2026-05-26") is now false. Live next_due distribution: 4,137 rows in 2026-09, s-0004 (weekly) due 2026-09-22. Schedule page DOES read the DB value (`subscriber.js:284 nextDueDate: sched.next_due_date`, :1062) so it is demo-visible. Caveat: the "8 weeks out" repro figure is loose — 2026-09-22 is ~4 weeks from today's wall clock, ~12 weeks from the app's MOCK_NOW; either way implausibly distant for a weekly saver. Drift between MOCK_NOW copies is explicitly in-scope per baseline. Confirmed; high is defensible via the "invariant violated in live data" clause, sits on the medium boundary.

### A06-004 (high) — CONFIRMED (borderline medium)
`policies.js derivePolicyStatus` derives by date with `now`; `subscriber.js:145` injects `currentTime()` (MOCK_NOW 2026-07-01). `agent.js buildAgentPolicies` trusts `lifeIns.status === 'active'` (raw stored flag); `agent.js:174` selects `insurance_policies(…, status)`. Live: 1,284 active-flagged policies have renewal_date < 2026-07-01 (agent → Active, subscriber → Expired). Demo persona s-0003 (renewal 2026-04-16, status active) is affected. Not demo-scope: the derive comment explicitly says the date is the dominant signal over a "stale stored flag" — the agent path is the bug. Confirmed.

### A06-005 (high) — CONFIRMED (code/RPC-layer; reachability-limited)
`register_login_identity('+256700000031','employer',…)` returns NULL (phone already bound to emp-001) — verified in a rolled-back txn, nothing persisted. `create_employer` and `create_distributor` call it via **PERFORM** (return ignored); only `approve_access_request` does `v_bound := … ; IF v_bound IS NULL THEN RAISE`. create_employer even documents "Best-effort … already another employer's sign-in -> returns NULL, create still succeeds." Real inconsistency + multi-tenancy risk (owner falls back to emp-001/d-001). Reachability nuance: no live orphan currently exists from this path — the one non-seed employer (Uniclusion) used the guarded approve path and IS bound (dp-3b45c…); the failure requires a colliding/invalid phone. Confirmed as a code defect, not observed in live data.

### A06-006 (high) — CONFIRMED reproduction, SEVERITY-ADJUST → medium
The 4 TST subscribers with no balance row (`tst-sub-tree/emp/retag-*`) render on `v_reconciliation_exceptions` as `missing_balance`, alongside 3 deliberate `t-demo-recon-*` agent_mismatch rows — exactly as claimed, and they are the baseline's 4-row subscribers-vs-balances gap. But blast radius is small: 4 admin-only test rows, trivially deletable, no wrong money, no feature break — the reconciliation view is in fact working correctly by surfacing real orphans. The high clause "invariant violated in live data" is textually satisfied, but impact is medium (demo-visible litter on an admin credibility screen). Recommend **medium**.

### A06-007 (high) — REFUTED (no longer reproducible)
The A24XSSPROBE rows have been **deleted since A06 captured evidence**. Full text-column XSS scan now returns **0 hits**; the two access_requests IDs and two nominee_claims IDs A06 named no longer exist; pending access_requests count is now **4** (finding claimed 6). Cannot reproduce against the live system from a clean state → REFUTED. Was valid when captured (transient probe litter left by A24), and the actual stored-XSS vulnerability is A24's render-side finding, not A06's data-presence observation.

## Medium spot-checks

- **A06-008 — CONFIRMED.** `next_due_date < '2026-05-26'` = 0 (min live value 2026-07-06, 41-day slack); `.lt` excludes the 21 NULL rows; 717 rows stale vs wall clock. Vacuous guard reproduced.
- **A06-009 — CONFIRMED.** `_demo_now()` = 2026-05-18 23:59:59, referenced by get_employer_activity_rollup, get_entity_metrics_rollup, get_top_branch, submit_hospital_cash_claim. Real fifth clock; drift in-scope.
- **A06-011 — CONFIRMED.** Uniclusion employer: sector `Fintechj`, district `d-budaka` (ID in name field), payroll_cadence empty/NULL, default_contribution_config `{}`. All reproduced.

## Summary
7/7 critical+high verified: 5 CONFIRMED (A06-001,002,003,004,005), 1 SEVERITY-ADJUST to medium (A06-006), 1 REFUTED (A06-007, rows cleaned up post-capture). 3/3 medium spot-checks CONFIRMED. All write-probes rolled back; no data mutated.
