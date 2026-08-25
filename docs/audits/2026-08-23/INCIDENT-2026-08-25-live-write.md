# Incident — three migrations reached live during a probe that should have rolled back

**2026-08-25.** Reported by the agent that caused it, rather than discovered afterwards.
Independently verified before writing this.

## What happened

`0112_clear_fixture_residue`, `0114_money_numeric_guards` and `0116_nav_integrity` are **applied
to the live Singapore database**. They were meant to be authored-and-proven only; the standing
rule for this whole programme was that **no agent applies anything to live**.

An agent ran a verification probe of the shape:

```
BEGIN;
\i supabase/migrations/0112_clear_fixture_residue.sql
\i supabase/migrations/0114_money_numeric_guards.sql
… probes …
ROLLBACK;
```

and believed it had rolled back. It had not. Nothing errored.

## Why it did not error — the part worth understanding

**Every migration in this repo from `0101` onward carries its own `BEGIN;` and `COMMIT;` at
column 0.** That is the house convention, not something this programme introduced: 20 forward
migrations and 17 down migrations on this branch do it, going back to `0101`.

**Postgres transactions do not nest.** So the file's inner `BEGIN;` raises only a *warning* —
`there is already a transaction in progress` — which psql prints and walks straight past. Then the
file's inner **`COMMIT;` commits the caller's outer transaction.** Everything executed to that
point becomes permanent. The trailing `ROLLBACK` finds nothing to undo and reports nothing wrong.

The result is a probe that looks completely clean and has written to production.

`0114` then committed itself the same way, and `0116` — which has no transaction control of its
own — ran statement-by-statement in autocommit.

## Live state — verified independently, not taken on trust

| check | result |
|---|---|
| `subscriber_balances` rows | 5,059 |
| `retirement_balance + emergency_balance = total_balance` | **5059 / 5059** |
| `retirement_units + emergency_units = units` | **5059 / 5059** |
| `total_balance = round(units × latest_nav())` | **5059 / 5059** |
| NaN balances / negative balances | **0 / 0** |
| platform AUM | **2,453,184,487** — unchanged |
| `nav_snapshots` | 1,246 rows, unchanged |
| pre-purge recovery tables written by `0112` | **3 present** |

**The database is healthy.** Every invariant holds, including one that did *not* hold before
(`s-0005`'s bucket drift, which `0112` repaired via the safe `_resync_bucket_units` RPC).

**No destructive purge ran.** `0110` and `0111` are NOT applied — the 1,881 `EMP-` residue rows
and 5 orphan settlement batches are still present, exactly as before. What `0112` did delete was
5 test subscribers and 1 null-distributor test branch, and it wrote pre-purge snapshot tables for
all of it first.

Not applied: `0109`, `0110`, `0111`, `0113`, `0115`, `0117`–`0126`.

## Operator actions

1. **`0112` is NOT idempotent.** Re-applying it now aborts with *"expected 5 test subscribers,
   found 0"* — the guard working correctly. **Mark it applied; do not re-run.**
2. **`0114` is mostly idempotent** (`IF NOT EXISTS` / `ON CONFLICT`), and its sign-flip block
   re-runs harmlessly since zero positive withdrawal rows remain. Verify before re-running.
3. **`0116` is fully idempotent** (`CREATE OR REPLACE` + pre-flight). Live currently carries a
   pre-final build whose only difference is cosmetic — two `RAISE` messages rendering `%0.00`
   instead of `0.00 percent`. Re-applying brings live to the committed file.
4. **`supabase_migrations.schema_migrations` does not record any of the three.** The ledger and
   reality disagree until someone reconciles them — which is finding A26-007's exact complaint,
   now true again for a new reason.

## What has been done so that it cannot recur

`scripts/psql-probe.sh` — a probe harness that:

- **refuses outright** to `\i` any file containing column-0 `BEGIN`/`COMMIT`/`ROLLBACK`,
- offers `--strip` to remove a migration's own transaction control so the body can be probed,
- **asks the server whether the transaction is still open** immediately before rolling back, and
- treats either transaction warning as fatal, printing
  `*** THE PROBE ESCAPED ITS TRANSACTION — SOMETHING MAY BE LIVE ***` and exiting non-zero.

Self-tested both ways: it refuses `0114` outright, and a clean probe reports
`probe-txn-state: open with writes (safe, will roll back)` and rolls back.

Every agent still writing SQL has been warned directly.

## The honest lesson

The migrations were written to be self-contained and atomic, which is right for *applying* them —
and it is the convention this repo already had. What nobody accounted for is that the same
property makes them **unsafe to probe**: a file that guarantees its own atomicity necessarily
takes transaction control away from its caller.

"Wrap it in `BEGIN … ROLLBACK`" was treated throughout this programme as a sufficient safety net.
It is not, whenever the thing being wrapped can commit on its own behalf.
