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

## ⚠️ CORRECTION (2026-08-25) — the fix this note originally recommended DOES NOT WORK

**This section originally said to use `NOT (p_amount > 0)`, "which rejects NaN where
`p_amount <= 0` does not". That is FALSE.** `P3-money-validator` caught it while implementing
`0114`; re-measured against live:

```sql
select 'NaN'::numeric > 0              as nan_gt_zero,          -- t
       not('NaN'::numeric > 0)         as the_recommended_guard, -- f   <-- DOES NOT FIRE
       'NaN'::numeric <= 0             as the_original_bug,      -- f
       'NaN'::numeric = 'NaN'::numeric as nan_eq_nan_numeric,    -- t   <-- unlike float8 intuition
       ('NaN'::numeric >= 0 and 'NaN'::numeric < 'Infinity'::numeric) as the_working_form; -- f
```

Because NaN sorts **above** every numeric, `NaN > 0` is **TRUE**, so `NOT (NaN > 0)` is **FALSE**
and the guard never fires. It is exactly as broken as the `<= 0` it was meant to replace, just
spelled differently. Anyone who copied it would have shipped a Critical marked fixed.

The error came from carrying IEEE-754 float intuition into `numeric`. In float8 every NaN
comparison is false; in `numeric` NaN is ordered, and `NaN = NaN` is **TRUE**.

### What actually works

**In a guard, test explicitly** — do not rely on any inequality:

```sql
IF p_value = 'NaN'::numeric
   OR p_value = 'Infinity'::numeric
   OR p_value = '-Infinity'::numeric THEN
  RAISE EXCEPTION '% must be a real number (got %)', p_label, p_value;
END IF;
```

**In a CHECK constraint, bound it from above** — the upper bound is what rejects NaN, +Inf and
-Inf in one expression:

```sql
CHECK (col >= 0 AND col < 'Infinity'::numeric)
```

**Do NOT use `CHECK (col = col)` as a NaN trap.** A04-001's own suggested_fix proposes it. It
works for `float8` and is useless for `numeric`, where `NaN = NaN` is TRUE.

`0114` ships this as one shared `public.assert_finite_money(...)` called by
`make_contribution`, `request_withdrawal` and `submit_employer_contribution_run`, so the three
cannot drift apart.

---

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
