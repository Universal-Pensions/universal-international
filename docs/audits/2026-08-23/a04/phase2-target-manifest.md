# Phase 2 target manifest — measured live, 2026-08-25

Read-only survey taken before authoring `0110`–`0112`. Every count here is a live measurement,
not a restatement of the audit. Re-measure immediately before applying: these are demo databases
and a rep may add rows at any time.

## 0110 — employer contribution residue (A04-009, A06-001/A14-002)

| | |
|---|---|
| rows | **1,881** |
| distinct `txn_ref` | **33** |
| total | **145,372,000 UGX** |
| orphaned (`contribution_run_id IS NULL`) | **1,824** (32 refs) |
| still linked to a CI-window run | **57** (1 ref) |
| legitimate `EMP-%` rows | **0** |

Signature: 33 refs × exactly 57 rows each — the CI test employer's roster — daily from
2026-07-30. Frozen ref list and the reason the plan's provenance-join fails:
`phase2-emp-predicate.md`.

**Predicate: explicit `txn_ref IN (…33 refs…)`. NOT `LIKE 'EMP-%'`. NOT a `contribution_runs` join.**

## 0111 — settlement orphans (A05-003, A05-008)

5 orphan batches, all `agent_id = a-001`, and **8 notifications** referencing them:

| batch id | txn_ref | paid | created |
|---|---|---|---|
| `sb-aaa8b14105404d22b9b2a81e8b133cab` | `E2E-PARTIAL-1785700183410` | 5,000 | 2026-08-02 |
| `sb-3da879edd4bb4ac98a18346f1b66b6dc` | `E2E-PARTIAL-1785700815516` | 5,000 | 2026-08-02 |
| `sb-09258a3b9cc94064be51e0a6f0a04fa5` | `E2E-PARTIAL-1785752804482` | 5,000 | 2026-08-03 |
| `sb-f7c09fe4e5d34d42ab385ac075367a6b` | `E2E-FULL-1787558947624` | 20,000 | 2026-08-24 |
| `sb-8598ef1286bd4f89b628e4aed9238f6f` | `E2E-PARTIAL-1787558955623` | 5,000 | 2026-08-24 |

The plan expected **3**; there are **5**. The last two were created 2026-08-24 by the
`P0-e2e-teardown` agent's own verification run and are disclosed in `phase2-emp-predicate.md`.
A predicate hardcoded to the plan's 3 would leave 2 behind.

**Delete notifications BEFORE batches** — they reference the batch id.

Also in 0111: recompute `sb-seed-0001` from the lines actually carrying `MM-SEED-0001`, and
correct the wrong branch stamp.

## 0112 — fixtures

**`v_reconciliation_exceptions` today — 7 rows in two classes. Only the first class is residue:**

| check_code | count | disposition |
|---|---|---|
| `missing_balance` | 4 | **DELETE** — `tst-sub-tree-msc7vzsc`, `tst-sub-emp-msc7vzsc`, `tst-sub-retag-msc7vzsc`, `tst-sub-tree-msd3855c` |
| `agent_mismatch` | 3 | **KEEP** — `t-demo-recon-1/2/3` (Denis Byaruhanga ×2, Grace Asiimwe). These are the INTENDED demo fixtures. |

Phase 2's exit criterion "Reconciliation shows only the 3 intended fixtures" therefore means
**delete 4, keep 3** — deleting all 7 would destroy a working demo.

**A04-016 — bucket drift on `s-0005`, confirmed live:**

```
subscriber_id | units       | retirement_units | emergency_units | drift
s-0005        | 203.9864220 | 185.404883       | 24.9452911      | +6.3637520
```

`retirement_units + emergency_units` exceeds `units` by 6.364. Fix with the safe RPC — verified
to exist as `public._resync_bucket_units(p_subscriber_id text)`:

```sql
SELECT public._resync_bucket_units('s-0005');
```

**Never a literal UPDATE.** This is a prerequisite for any bucket-sum CHECK constraint in `0113`
— `ADD CONSTRAINT` would fail validating this row.

Also in 0112: A02-010/A06-017, A05-014 one-time `settlement_uploads` purge, A16-003 (refresh an
invite so the invite demo works).

**A06-020 stays DEFERRED to Phase 3** — deleting the 4 stale pending NAV rows would destroy a
fixture `P3-nav-integrity` has to rebuild.

## Recovery precondition, non-negotiable

Every destructive transaction first does
`CREATE TABLE public.<t>_pre_purge_20260824 AS SELECT * FROM <t> WHERE <exact predicate>`,
mirroring what `0105` did with `_pre_nav`, with a committed `unpurge.sql`. Those tables join the
do-not-drop list. The dump must be re-taken immediately before the purge — the drill's snapshot
is from 2026-08-25 and anything demoed after it is not in it.
