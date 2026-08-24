`e2e/specs/db/invariants.spec.ts` holds 8 assertions. Only two of them are about money
(`commissions` status/paid-date shape); none reconciles a balance, a unit count, or a price.
`money-idempotency.spec.ts` adds 2 (`make_contribution` nonce replay; over-balance
`request_withdrawal` raises). That is the entire money-invariant surface: **10 assertions over a
29 027-row ledger, 5 060 balance rows and 1 246 NAV snapshots.**

I probed nine candidate invariants directly against the live database. **Two are violated right
now, and no test in the repo would notice either.**

```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "
SELECT 'txn_split_mismatch', count(*) FROM transactions WHERE split_retirement IS NOT NULL AND split_emergency IS NOT NULL AND (split_retirement+split_emergency) <> amount
UNION ALL SELECT 'txn_null_splits', count(*) FROM transactions WHERE split_retirement IS NULL OR split_emergency IS NULL
UNION ALL SELECT 'negative_balances', count(*) FROM subscriber_balances WHERE retirement_balance<0 OR emergency_balance<0 OR total_balance<0
UNION ALL SELECT 'balance_total_mismatch', count(*) FROM subscriber_balances WHERE round(total_balance::numeric,2) <> round((retirement_balance+emergency_balance)::numeric,2)
UNION ALL SELECT 'units_total_mismatch', count(*) FROM subscriber_balances WHERE units IS NOT NULL AND retirement_units IS NOT NULL AND emergency_units IS NOT NULL AND round(units::numeric,4) <> round((retirement_units+emergency_units)::numeric,4)
UNION ALL SELECT 'balances_with_null_nav_as_of', count(*) FROM subscriber_balances WHERE nav_as_of IS NULL
UNION ALL SELECT 'commissions_orphan_agent', count(*) FROM commissions c LEFT JOIN agents a ON a.id=c.agent_id WHERE a.id IS NULL
UNION ALL SELECT 'txn_orphan_subscriber', count(*) FROM transactions t LEFT JOIN subscribers s ON s.id=t.subscriber_id WHERE s.id IS NULL;"
txn_split_mismatch|0
txn_null_splits|27827
negative_balances|0
balance_total_mismatch|0
units_total_mismatch|1          ← VIOLATED
balances_with_null_nav_as_of|0
commissions_orphan_agent|0
txn_orphan_subscriber|0

$ psql … -c "SELECT 'subscribers_without_balance', count(*) FROM subscribers s LEFT JOIN subscriber_balances b ON b.subscriber_id=s.id WHERE b.subscriber_id IS NULL
             UNION ALL SELECT 'balances_without_subscriber', count(*) FROM subscriber_balances b LEFT JOIN subscribers s ON s.id=b.subscriber_id WHERE s.id IS NULL;"
subscribers_without_balance|4    ← VIOLATED (this is A00's 5064-vs-5060 gap)
balances_without_subscriber|0
```

The bucket-units violation, in full:

```
$ psql … -c "SELECT subscriber_id, units, retirement_units, emergency_units,
   (retirement_units+emergency_units) AS sum_parts, units-(retirement_units+emergency_units) AS delta,
   total_balance, nav_as_of FROM subscriber_balances
   WHERE round(units::numeric,4) <> round((retirement_units+emergency_units)::numeric,4);"
s-0005|203.98642208035116|185.404883|24.9452911485705822|210.3501741485705822|-6.3637520682194222|320544|2026-08-24
```

`s-0005`'s headline unit count is **6.36 units short** of the sum of its two buckets. At the
published NAV (`2026-08-08 · 1 571.4 UGX/unit`) that is ≈ **10 000 UGX** of disagreement between
two numbers rendered on the same subscriber screen. `_resync_bucket_units()` exists precisely to
keep these in step (and the NAV contract test asserts it is never granted to `authenticated`) —
but nothing asserts the *outcome*. Data ownership sits with A04/A06; the **test-coverage** finding
is that this class of defect is entirely unguarded.

### Proposed invariant tests (do not write them here — proposal only)

Ranked by "would it have caught something that is wrong today".

| # | Proposed test | Assertion | Would fire today |
|---|---|---|---|
| M1 | every subscriber has exactly one balance row | `count(subscribers) = count(subscriber_balances)` **and** the two anti-joins are 0 | **YES — 4 rows** |
| M2 | bucket units reconcile | `units = retirement_units + emergency_units` for every row (tolerance 1e-6) | **YES — s-0005** |
| M3 | balances reconcile | `total_balance = retirement_balance + emergency_balance` | no |
| M4 | no negative money | no negative balance, unit or `transactions.amount` for a credit type | no |
| M5 | every transaction split sums to its amount when both legs are present | `split_retirement + split_emergency = amount` | no |
| M6 | pricing is total | every `subscriber_balances.nav_as_of` resolves to a **published** `nav_snapshots` row; `latest_nav()` is non-NULL | no |
| M7 | NAV register is sane | one row per `(fund_code, nav_date)`, `unit_price > 0`, no `published` row dated after `MOCK_NOW`, no gap longer than N days | no (1 `pending` row at 2026-08-07 sits *behind* the published 2026-08-08 — worth an explicit rule) |
| M8 | `apply_settlement` is idempotent | replay the same batch id twice → one `settlement_batches` row, commissions flip `due→paid` once, `paid_amount` unchanged. Mirrors the `make_contribution` nonce test, which is the only idempotency test that exists | unknown — untested |
| M9 | commission ↔ settlement reconciliation | `Σ commissions.paid_amount WHERE status='paid'` equals `Σ settlement_batches.amount` for the same period | unknown — untested |
| M10 | ledger ↔ balance reconciliation | for a sample of N subscribers, `Σ transactions` by bucket equals `subscriber_balances` by bucket at the current NAV | unknown — untested |
| M11 | `MOCK_NOW` copies agree | every source that defines a frozen clock (JS constants, SQL defaults, seed script, e2e fixtures) resolves to the same instant | drift is A01/A21's finding; a test makes it non-recurring |
| M12 | function deployment contract | for each name asserted by the four migration-text contract tests: `count(oid) = 1` in `pg_proc` **and** `pg_get_functiondef` satisfies the same regex battery | no (all 25 agree today) — but this is the guard §5 says is missing |

M1, M2, M8 and M12 are the four worth writing first: two of them fail on the live database as of
this run, one closes the only asymmetry in the idempotency coverage, and one converts the whole
text-grep contract suite into a behavioural one.
