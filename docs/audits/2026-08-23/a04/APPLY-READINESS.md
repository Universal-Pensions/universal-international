# Apply readiness — the migration set, proven as a sequence

**Verified 2026-08-25** against a scratch PostgreSQL 18 restored from a `pg_dump` of live taken
the same day. **Nothing here has been applied to production.**

Each migration was dry-run individually while it was written. This document records the thing
that individual dry runs cannot establish: that they are correct **applied in order, on top of
each other**, against real live data.

## Apply order

```
0109_settlement_tenancy          — blocks cross-tenant commission settlement   (A05-001 Critical)
0110_purge_employer_run_residue  — removes 1,881 residue rows / 145.37M UGX    (A04-009, A06-001/A14-002)
0111_repair_settlement_ledger    — repairs the settlement ledger               (A05-003, A05-008)
0112_clear_fixture_residue       — clears fixture residue                      (A02-010, A06-017, A05-014, A04-016, A16-003)
0113_e2e_subscriber_cleanup_rpc  — atomic subscriber cleanup RPC               (A04-010)
0120_anon_surface                — binds invites to their invitee              (A03-001..004)
```

**The order is load-bearing in one place.** `0112` runs `_resync_bucket_units('s-0005')`, and the
bucket-sum CHECK constraint that `0114` adds would fail validating that row otherwise. `0114`
must therefore come after `0112`. Its header says so.

Result: **all six applied cleanly, no errors.**

## End state

| check | result |
|---|---|
| `EMP-` residue rows | **0** (was 1,881) |
| orphan `E2E-*` settlement batches | **0** (was 5) |
| `tst-sub-*` subscribers | **0** (was 4) |
| branches with NULL `distributor_id` | **0** (was 1) |
| reconciliation exceptions | **only `agent_mismatch = 3`** — the intended `t-demo-recon-*` fixtures |
| `total_balance = round(units × NAV)` | **5059 / 5059** |
| `retirement_units + emergency_units = units` | **5059 / 5059** |
| `retirement_balance + emergency_balance = total_balance` | **5059 / 5059** |
| NaN balances / negative balances | **0 / 0** |
| `apply_settlement` carries the tenancy guard | **YES** |
| live employer invites (invite demo works) | **1** |
| platform AUM | **2,333,299,787** |

All three balance invariants hold for every row — including the one that did not before
(`s-0005`, A04-016). The row count is 5,059 rather than 5,060 because `0112` removes a test
subscriber.

## Recovery, proven not assumed

- `scratchpad/p2-preapply/live-preapply.dump` — restored into a scratch database and diffed to a
  **byte-identical** row-count manifest before any of this was run.
- `supabase/recovery/0110_unpurge.sql` — proven as a full round trip: purge then unpurge returns
  AUM to **2,450,226,487 exactly** and restores all 1,881 rows. It restores the 19 affected
  balances **verbatim from a snapshot** rather than recomputing them, because a recompute round
  trip was measured 2,022,125 UGX (0.08%) off.
- Every destructive migration writes a `*_pre_purge_20260824` snapshot table first. Those are on
  the do-not-drop list.
- Every `CREATE OR REPLACE FUNCTION` has a `.down.sql` captured from the **live** body with
  `pg_get_functiondef`, never retyped from an older migration. `0109`'s and `0120`'s were both
  verified byte-identical in an up→down round trip.

## Before applying to production

1. **Re-take the dump.** The one above is from 2026-08-25; anything a rep demos after it is not
   in it.
2. **Expect `0110`'s Guard 1 to abort if a new `EMP-` run appeared.** That is the guard working,
   not a failure — it means a real employer run was created after the freeze and the 33-ref list
   must be re-measured.
3. Apply in the order above, each in its own transaction, verifying between.
4. Record each write in `docs/audits/2026-08-23/00d-live-write-ledger.md`.
