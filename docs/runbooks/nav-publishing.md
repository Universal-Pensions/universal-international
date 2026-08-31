# Publishing the unit price

**Who this is for:** whoever publishes the fund's daily price.
**Why it now matters more than it did:** since the unitization redesign, money
waits for a price instead of guessing one. Publishing is no longer bookkeeping —
it is the event that actually invests members' money.

---

## The one-paragraph version

Members' money is dealt **forward**. Money received at or before **14:00
Kampala** on a business day buys units at **that day's** price. Money received
after 14:00, or at a weekend, or on a public holiday, buys units at the **next
business day's** price. Nothing is ever priced at a date earlier than the day it
arrived. Until the fund publishes the price for a member's dealing date, their
money sits visible in their balance but not yet invested — so **a day you do not
publish is a day somebody's money does not start earning.**

---

## The daily job

1. Open **Admin → Unit price**.
2. Check the date. It is seeded from the **Kampala** calendar, not the browser's.
3. Enter the price from the fund manager.
4. Read the line above the button. It says what publishing will actually do:

   > Waiting on a price: 3 payments in worth UGX 1,450,000, and 1 payment out
   > worth UGX 300,000. 3 of them can be settled now.

5. Publish.

A move of more than ±10% needs an explicit confirmation. That gate is enforced
by the server, not the dialog, so it cannot be skipped by a scripted call.

### If the price is late

**Publish nothing.** Never invent a price to clear the queue. The queue is the
correct behaviour: members' money is safe, visible in their balance, and will be
invested at the real price for its dealing date as soon as you have one. A
guessed price permanently mis-issues units at every other member's expense, and
cannot be undone without re-striking balances.

When the real price arrives, publish it **for the day it belongs to**, even if
that day has passed. A back-dated publish releases exactly the money that was
waiting on that day, at that day's price. It deliberately does **not** restate
today's book at a stale price.

---

## What to watch

| Signal | Where | Threshold |
|---|---|---|
| Days with no published price | NAV page, "Days not priced" | > 1 is worth a look; > 3 is a fault |
| Oldest money waiting | pre-publish line, Needs-attention badge | > **3 working days** |
| Holes behind the frontier | same tile | any |
| Redemptions struck but unpaid | `settle_withdrawal` backlog | > 5 days |
| Holiday calendar running thin | see below | < 90 days of cover |

The maximum a member's money should wait is **3 working days**. That is a
configurable number, not a law:

```sql
SELECT public.set_fund_dealing_config(p_max_pending_days := 5);
```

---

## Things you may need to do

All of these are admin-only RPCs. There is no screen for them yet.

**Release a stalled queue after a late publish.** Publishing does this
automatically; this is the manual kick if you need it.
```sql
SELECT public.run_pending_pricing();
```

**See what is waiting.**
```sql
SELECT public.get_pending_pricing_summary('UPU-BAL');
SELECT * FROM public.v_pending_pricing_orphans ORDER BY business_days_waiting DESC;
```

**Record that a withdrawal was actually paid.** Until you do, the money stays in
the member's total, because they still have not received it.
```sql
SELECT public.settle_withdrawal('wd-...');
```

**Undo an allocation.** Unwinds at the price it was struck at, and leaves a
compensating row so the ledger stays honest.
```sql
SELECT public.reverse_transaction('tx-...', 'why you are doing this');
```

**Change the cutoff.**
```sql
SELECT public.set_fund_dealing_config(p_cutoff_local_time := '15:00:00');
```

---

## The holiday calendar

Fixed-date Ugandan public holidays are loaded through **2030**. The movable ones
are **not**, and must never be computed: Good Friday and Easter Monday move, and
Eid al-Fitr and Eid al-Adha are moon-sighted and declared by the Uganda Muslim
Supreme Council. There is no formula that is correct in advance.

**Every December, enter next year's movable holidays from the official gazette:**
```sql
SELECT public.upsert_business_holiday('2027-03-26', 'Good Friday');
SELECT public.upsert_business_holiday('2027-03-29', 'Easter Monday');
-- Eid dates as gazetted
```

Getting this wrong deals money on a day the market is shut, and that day will
never have a price.

---

## The kill switch

Forward dealing is behind one row. Turning it off is instant, needs no deploy,
and takes effect on the next statement.

```sql
-- off: money prices immediately again, exactly as it did before the redesign
UPDATE public.fund_dealing_config SET pricing_enabled = false WHERE fund_code = 'UPU-BAL';

-- on
UPDATE public.fund_dealing_config SET pricing_enabled = true  WHERE fund_code = 'UPU-BAL';
```

Turning it off does **not** discard money already waiting. Those rows stay
pending and are released by `run_pending_pricing()` when it goes back on.

**Do not reverse migration 0147 to turn this off.** That is the hard rollback and
it refuses to run while anything is pending, for good reason. The switch is the
rollback.

---

## Rollback ordering, if you ever need it

Deploy is database first, then frontend. Rollback is the exact reverse, with one
absolute rule:

> **Never roll back the lifecycle UI while `pricing_enabled = true`.**
> The UI is what makes waiting money legible. Reverting it while the engine is
> live leaves members looking at a balance whose parts they cannot see and a
> withdrawal cap they cannot explain. Set `pricing_enabled = false` first, let
> the queue drain, then revert.

---

## Recovery artefacts

`public._pre_unitization_balances` holds every member's balance as it stood
before any of this shipped (5,060 rows, captured 2026-08-31). It is the restore
source if the book ever needs to be put back. It has RLS on and no policies, so
only `service_role` and the database owner can read it. Drop it once this work is
signed off.
