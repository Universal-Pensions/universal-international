# Phase 2 pre-flight — the `EMP-` predicate, re-measured

**Captured:** 2026-08-25, read-only against live `ilkhfnoyxlxwqadebnkp`.

The remediation plan calls the `EMP-` predicate "the whole risk" of Phase 2 and gives a specific
method for discriminating residue from live data. **That method does not work.** Measuring it
before writing the migration is why.

## What the plan says to do

> Discriminate positively by joining `contribution_runs` for CI-window provenance
> (`created_at > '2026-07-27 14:26:07+00'`).

## What live actually contains

```
select count(*) filter (where t.contribution_run_id is null)                       as orphaned_null_fk,
       count(*) filter (where t.contribution_run_id is not null and cr.id is null) as dangling_fk,
       count(*) filter (where cr.created_at >  '2026-07-27 14:26:07+00')            as run_in_ci_window,
       count(*) filter (where cr.created_at <= '2026-07-27 14:26:07+00')            as run_before_window,
       count(*)                                                                     as total
from transactions t left join contribution_runs cr on cr.id = t.contribution_run_id
where t.txn_ref like 'EMP-%';

 orphaned_null_fk | dangling_fk | run_in_ci_window | run_before_window | total
 ---------------- | ----------- | ---------------- | ----------------- | -----
             1824 |           0 |               57 |                 0 |  1881
```

## Why the plan's method fails

**1,824 of the 1,881 rows have `contribution_run_id IS NULL`.** They cannot be joined to
`contribution_runs` at all — which is the entire point of A06-002. The broken teardown deleted
the run header first, and `transactions_contribution_run_id_fkey` is `ON DELETE SET NULL`, so
the link was erased. Those rows became orphans precisely *because* their provenance was destroyed.

A provenance join therefore matches **57 rows of 1,881 — 3%**. A Phase 2 migration written to
the plan's stated method would leave 1,824 residue rows in place and report success, while the
employer dashboard kept reading 145M UGX of fake money.

## What does work

`txn_ref` survives the FK nulling. The plan's *other* instruction — freeze an explicit
`txn_ref IN (…)` list of the 33 refs — is sound and is the one to use.

The residue signature is unambiguous: **33 refs × exactly 57 rows each** (the CI test employer's
roster size), repeating daily from 2026-07-30, with repeating identical amounts.

| txn_ref | rows | UGX | orphaned | first seen |
|---|---|---|---|---|
| `EMP-d7980790` | 57 | 3718000 | 57 | 2026-07-30 |
| `EMP-32ef1f4a` | 57 | 3718000 | 57 | 2026-07-30 |
| `EMP-2ed0f1dd` | 57 | 3718000 | 57 | 2026-07-30 |
| `EMP-ef1d1d3b` | 57 | 3718000 | 57 | 2026-07-30 |
| `EMP-5238676e` | 57 | 3718000 | 57 | 2026-07-31 |
| `EMP-a9dc6ea4` | 57 | 4704000 | 57 | 2026-07-31 |
| `EMP-0bd986bc` | 57 | 4704000 | 57 | 2026-07-31 |
| `EMP-0cb1c4c2` | 57 | 4704000 | 57 | 2026-08-01 |
| `EMP-a3f6d4e5` | 57 | 4704000 | 57 | 2026-08-01 |
| `EMP-2e6bb16c` | 57 | 4704000 | 57 | 2026-08-01 |
| `EMP-31b20e2d` | 57 | 4704000 | 57 | 2026-08-01 |
| `EMP-933ab180` | 57 | 4704000 | 57 | 2026-08-01 |
| `EMP-6073c63d` | 57 | 4704000 | 57 | 2026-08-01 |
| `EMP-fff6f9b0` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-ac9e11ee` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-7dd90666` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-587135d6` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-fa34cc15` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-07cfa1ea` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-8ac86e9a` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-c0ec2e47` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-f6de2f1a` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-1efe9caa` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-17966c8e` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-0ab9562a` | 57 | 4704000 | 57 | 2026-08-02 |
| `EMP-39d05d6a` | 57 | 4704000 | 57 | 2026-08-03 |
| `EMP-73a0e5c8` | 57 | 4704000 | 0 | 2026-08-03 |
| `EMP-f3816bc6` | 57 | 4704000 | 57 | 2026-08-03 |
| `EMP-a2d4d427` | 57 | 3718000 | 57 | 2026-08-23 |
| `EMP-c4642919` | 57 | 3718000 | 57 | 2026-08-23 |
| `EMP-1bd291a9` | 57 | 3718000 | 57 | 2026-08-24 |
| `EMP-f516defb` | 57 | 3718000 | 57 | 2026-08-24 |
| `EMP-b4a27020` | 57 | 3718000 | 57 | 2026-08-24 |

**Totals:** 33 refs · 1,881 rows · 145,372,000 UGX · 1,824 orphaned (32 refs fully orphaned, 1 ref still linked).

## Also worth recording

There are currently **zero legitimate `EMP-%` rows** — every one is CI residue. That does *not*
make a bare `txn_ref LIKE 'EMP-%'` delete safe. `EMP-` is the live prefix emitted by the shipping
`submit_employer_contribution_run` (`'EMP-' || substr(v_run_id,5,8)`, in 0044→0102), so any
employer run a rep demos between now and the purge would be swept up by it. The plan's B1 warning
is right in principle; it is only the *discrimination method* that needs replacing.

## The rule for Phase 2

1. Freeze the 33 refs above as an explicit `IN (…)` list — do **not** use `LIKE 'EMP-%'`, and do
   **not** rely on a `contribution_runs` join.
2. Immediately before COMMIT, re-assert that the live `EMP-%` set has not grown beyond these 33.
   Abort if it has: a new ref means a rep created a real run, and it must be left alone.
3. `CREATE TABLE transactions_pre_purge_20260824 AS SELECT * FROM transactions WHERE txn_ref IN
   (…)` first, with a committed `unpurge.sql`.
