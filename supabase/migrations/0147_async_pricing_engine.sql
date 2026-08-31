-- 0147_async_pricing_engine.sql
-- ============================================================================
-- PHASE 6 of the unitization redesign. THE SWITCH.
--
-- Everything before this migration was preparation and changed no behaviour.
-- This one changes all of it — behind a flag that ships OFF.
--
--     UPDATE public.fund_dealing_config SET pricing_enabled = true;   -- on
--     UPDATE public.fund_dealing_config SET pricing_enabled = false;  -- off
--
-- One UPDATE, effective on the next statement, no redeploy, no rebuild. With
-- the flag OFF every code path below falls through to the body it had before
-- this migration, byte for byte. That is not a courtesy: it is what makes the
-- flip reversible in the middle of a business day.
--
-- WHAT ACTUALLY CHANGES WHEN IT IS ON
-- -----------------------------------
--   * A contribution no longer buys units at insert time. It is RECEIVED, its
--     dealing date is derived, and its face value is booked to
--     pending_contribution_*. The member's TOTAL rises immediately — money
--     never disappears — but it is not withdrawable and it has bought nothing.
--   * A withdrawal no longer redeems at whatever price happens to be newest.
--     It places a HOLD (pending_redemption_*) which lowers withdrawable
--     without touching the total, because the units are still owned.
--   * Publishing a price RELEASES the queue for that date: contributions buy
--     units at that day's price, redemptions sell at it.
--
-- THE DEFECT THIS REMOVES, STATED PLAINLY
-- ---------------------------------------
-- `nav_for_date` carried the last known price BACKWARDS, so 5,329 of 18,633
-- contributions (28.6%, every single weekend one) bought units at the previous
-- Friday's close — a price struck before the money existed. The fund's series
-- rises over the period, so those members generally received MORE units than
-- they were entitled to, at the expense of every other unit holder. `nav_for_date`
-- becomes strict here: the price for exactly that date, or NULL. Nothing
-- guesses a price ever again.
--
-- WHY THERE IS NO SCHEDULER
-- -------------------------
-- pg_cron is not installed and this migration does not install it. Pricing is
-- released by the event that MAKES pricing possible — a publish — plus a small
-- bounded sweep at the head of the two member-facing money RPCs. It is the same
-- lazy, no-cron pattern 0072 already uses for policy renewal and indexation.
-- A queue that only drains on a timer is a queue that silently stops draining.
--
-- ⚠️ THE ENGINE IS CALLED OUTSIDE `IF v_is_newest`. This is not a style choice
--    and it is the single easiest thing to get wrong here. A BACK-DATED publish
--    — filling a hole the fund skipped — is precisely the event that makes a
--    stalled queue priceable. Put the call inside the newest-day block, as the
--    obvious reading suggests, and a back-dated correction releases NOTHING:
--    the price lands, the queued rows stay pending with unit_price_applied
--    NULL, and that money never allocates. This was reproduced as a live
--    failure before the design was accepted.
--
-- ⚠️ ALLOCATION AT A BACK-DATED PRICE MUST RE-MARK THE MEMBER TO THE BOOK.
--    Units are bought at the DEALING date's price — that is the rule. But every
--    member's balance is CARRIED at the book price: it is what publish_nav_snapshot
--    enforces for everyone else, what nav_mismatch asserts within 1 UGX, and what
--    assert_book_revaluable measures in aggregate. When those two prices differ,
--    allocating without re-marking leaves the member off-book. Measured: -9,150
--    UGX on a single release, which fails the 1 UGX per-member check while the
--    aggregate publish gate reads 0.0000% drift and notices nothing.
--
-- ⚠️ THE RE-MARK MUST FOLLOW _resync_bucket_units, NOT PRECEDE IT. The re-mark
--    READS retirement_units, and the allocation step above it changes `units`
--    and both bucket balances while leaving retirement_units stale. Re-marking
--    first splits the two pots off a stale ratio. Found by building it.
--
-- WHAT THIS MIGRATION DELIBERATELY DESTROYS — do not "fix" these back
-- -------------------------------------------------------------------
--   * Back-dated employer runs pricing at the period's NAV. 0104's own comment
--     advertises this as a feature: "so a back-dated employer run prices at
--     that period's NAV, not today's". It is the arbitrage this project exists
--     to remove. A run submitted today for July payroll deals TODAY.
--   * The backward carry in nav_for_date.
--   * Its silent 1000 literal, and its earliest-price-ever fallback, which
--     would price a 2026 contribution at the 2021 opening price.
--   * request_withdrawal redeeming at latest_nav(). Correct in 2026-08,
--     superseded now: redemptions deal forward exactly like contributions.
--
-- A GAP THE PLAN DID NOT ANTICIPATE, CLOSED HERE
-- ----------------------------------------------
-- `withdrawals.status = 'paid'` is set by NOTHING in this codebase — all 4,922
-- paid rows are seed data, and every runtime withdrawal has sat in 'processing'
-- forever. That did not matter while the request itself debited the member's
-- balance. Under the new model the struck value sits in pending_payout_* until
-- payment, so with no settlement path a member's total would NEVER fall after a
-- withdrawal and the component would grow without bound. `settle_withdrawal()`
-- below is that missing half. There is no payment rail to automate against
-- (demo scope), so it is an operator action, and the money leaves the member's
-- total at the moment someone records that it was actually paid.
--
-- ROLLBACK. Two levels.
--   SOFT (seconds, no migration): pricing_enabled = false. Rows already pending
--     stay pending and are released by run_pending_pricing() when re-enabled.
--   HARD: 0147_async_pricing_engine.down.sql. It restores every body verbatim,
--     but read its header first — it is only safe if nothing has allocated.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) withdrawals.status — two states that had nowhere to go
-- ─────────────────────────────────────────────────────────────────────────────
-- A redemption can now FAIL to price (D8: the price fell far enough between
-- request and dealing date that the amount no longer fits the units held), and
-- an admin can reverse a settled one. Neither had a legal status, so a rejected
-- withdrawal would have sat in the member's history reading "processing"
-- forever.
ALTER TABLE public.withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_chk;
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_status_chk
  CHECK (status IN ('paid', 'processing', 'rejected', 'reversed'));


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) nav_for_date — STRICT. The core change.
-- ─────────────────────────────────────────────────────────────────────────────
-- Three fallbacks removed. There is no longer any input for which this function
-- invents a price:
--   * `nav_date <= p_date ORDER BY DESC` — the backward carry. Gone.
--   * the earliest published price ever — gone.
--   * the literal 1000 — gone.
-- NULL now means exactly what it says: nobody published a price for that day.
-- Every caller's behaviour on NULL is enumerated in the plan; the only caller
-- that prices money is the engine, and it leaves the row pending.
CREATE OR REPLACE FUNCTION public.nav_for_date(
  p_date DATE,
  p_fund TEXT DEFAULT 'UPU-BAL'
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.unit_price
    FROM public.nav_snapshots n
   WHERE n.fund_code = p_fund
     AND n.nav_date  = p_date
     AND n.status    = 'published'
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.nav_for_date(DATE, TEXT) IS
  'STRICT since 0147: the published price for EXACTLY p_date, or NULL. The backward carry, the earliest-price fallback and the 1000 literal are all gone - they are how 5,329 weekend contributions bought units at a price struck before the money existed. NULL means nobody published that day; the pricing engine leaves such a transaction pending rather than guessing.';

-- latest_nav is now the BOOK CARRYING PRICE and nothing else: the newest
-- published price for the fund, whatever date that is. It is used for
-- revaluation, display and reconciliation. IT MUST NEVER PRICE A TRANSACTION.
--
-- It also stops calling nav_for_date(CURRENT_DATE): with a strict nav_for_date
-- that would return NULL on every day the fund has not yet priced — which,
-- with the register 12 days stale, is most of them.
CREATE OR REPLACE FUNCTION public.latest_nav(
  p_fund TEXT DEFAULT 'UPU-BAL'
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.unit_price
    FROM public.nav_snapshots n
   WHERE n.fund_code = p_fund AND n.status = 'published'
   ORDER BY n.nav_date DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.latest_nav(TEXT) IS
  'The BOOK CARRYING PRICE: the newest published price for the fund, whatever its date. For revaluation, display and reconciliation ONLY. Since 0147 it must never price a transaction - dealing prices come from nav_price_row(dealing_date).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) get_pending_pricing_summary — what a publish is about to release
-- ─────────────────────────────────────────────────────────────────────────────
-- Feeds the admin's pre-publish preview, the branch/distributor "in process"
-- figure, and the §10 operational alarm. Counts and values only, no member
-- detail, so it is safe on a rollup surface.
CREATE OR REPLACE FUNCTION public.get_pending_pricing_summary(p_fund TEXT DEFAULT 'UPU-BAL')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH p AS (
    SELECT t.type, t.amount, t.dealing_date, t.received_at,
           EXISTS (SELECT 1 FROM public.nav_snapshots n
                    WHERE n.fund_code = p_fund AND n.nav_date = t.dealing_date
                      AND n.status = 'published') AS priceable
      FROM public.transactions t
     WHERE t.pricing_status = 'pending'
       AND t.type IN ('contribution', 'withdrawal', 'premium_sweep')
  )
  SELECT jsonb_build_object(
    'fundCode', p_fund,
    'pendingContributions', COALESCE(count(*) FILTER (WHERE type = 'contribution'), 0),
    'pendingContributionValue', COALESCE(sum(amount) FILTER (WHERE type = 'contribution'), 0),
    'pendingRedemptions', COALESCE(count(*) FILTER (WHERE type <> 'contribution'), 0),
    'pendingRedemptionValue', COALESCE(sum(abs(amount)) FILTER (WHERE type <> 'contribution'), 0),
    -- What the NEXT publish would actually release, i.e. rows whose dealing
    -- date already has a price. The rest are waiting on the fund, not on us.
    'releasableNow', COALESCE(count(*) FILTER (WHERE priceable), 0),
    'awaitingPrice', COALESCE(count(*) FILTER (WHERE NOT priceable), 0),
    'oldestDealingDate', to_char(min(dealing_date), 'YYYY-MM-DD'),
    -- Business days, not calendar days: a Friday receipt still waiting on
    -- Monday morning is one business day old, not three.
    'oldestPendingBusinessDays', COALESCE((
      SELECT count(*) FROM generate_series(min(p.dealing_date), public.kampala_today(), INTERVAL '1 day') d
       WHERE public.is_business_day(d::date)), 0),
    'maxPendingDays', (SELECT max_pending_days FROM public.fund_dealing_config WHERE fund_code = p_fund),
    'pricingEnabled', (SELECT pricing_enabled FROM public.fund_dealing_config WHERE fund_code = p_fund)
  )
  FROM p;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) price_pending_transactions — THE ENGINE
-- ─────────────────────────────────────────────────────────────────────────────
-- One pass, both directions. Contributions before redemptions within a dealing
-- date, so a member who pays in and takes out on the same day can use the money
-- they just paid in.
--
-- IDEMPOTENT AND CONCURRENCY-SAFE, by three separate mechanisms:
--   * FOR UPDATE SKIP LOCKED on the candidate set — two callers never take the
--     same row, and neither waits for the other.
--   * a per-member row lock before touching a balance — two members price in
--     parallel, one member never interleaves with themselves.
--   * `AND pricing_status = 'pending'` in the final UPDATE's WHERE — the row is
--     claimed by the statement that allocates it, so a republish of the same
--     date re-enters the engine, finds nothing pending, and allocates nothing.
--
-- p_max_rows NULL means unbounded. publish_nav_snapshot passes NULL
-- deliberately: it has already row-locked all 5,060 balance rows for the
-- revaluation above, so the engine's per-member locks cost nothing extra, and a
-- cap there would strand the remainder of a large queue until the next publish.
CREATE OR REPLACE FUNCTION public.price_pending_transactions(
  p_fund     TEXT DEFAULT 'UPU-BAL',
  p_max_rows INTEGER DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg          public.fund_dealing_config%ROWTYPE;
  v_book_price   NUMERIC;
  t              RECORD;
  v_bal          public.subscriber_balances%ROWTYPE;
  v_price        NUMERIC;
  v_snap         TEXT;
  v_units        NUMERIC;
  v_units_before NUMERIC;
  v_ret_leg      NUMERIC;
  v_emg_leg      NUMERIC;
  v_priced       INTEGER := 0;
  v_rejected     INTEGER := 0;
  v_contribs     INTEGER := 0;
  v_redemptions  INTEGER := 0;
  v_units_delta  NUMERIC := 0;
  v_value        NUMERIC := 0;
  -- 0072 save-to-cover locals, ported from the contribution trigger (F6).
  v_sched        public.contribution_schedules%ROWTYPE;
  v_target       NUMERIC;
  v_new_accrued  NUMERIC;
  v_emg_bal      NUMERIC;
  v_sweep_units  NUMERIC;
BEGIN
  SELECT * INTO v_cfg FROM public.fund_dealing_config WHERE fund_code = p_fund;
  IF NOT FOUND OR NOT v_cfg.pricing_enabled THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'pricing is disabled for this fund',
                              'priced', 0, 'rejected', 0);
  END IF;

  -- The price the BOOK is carried at. Read once: it cannot change inside this
  -- transaction, and every re-mark below must use the same one.
  v_book_price := public.latest_nav(p_fund);

  FOR t IN
    SELECT tx.id, tx.subscriber_id, tx.type, tx.amount, tx.dealing_date,
           tx.split_retirement, tx.split_emergency, tx.source, tx.txn_ref
      FROM public.transactions tx
     WHERE tx.pricing_status = 'pending'
       AND tx.type IN ('contribution', 'withdrawal', 'premium_sweep')
       AND tx.dealing_date IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.nav_snapshots n
                    WHERE n.fund_code = p_fund AND n.nav_date = tx.dealing_date
                      AND n.status = 'published')
     ORDER BY tx.dealing_date,
              CASE tx.type WHEN 'contribution' THEN 0 ELSE 1 END,
              tx.received_at, tx.id
     LIMIT COALESCE(p_max_rows, 2147483647)
     FOR UPDATE OF tx SKIP LOCKED
  LOOP
    -- (a) Lock this member. Everything below reads and writes one balance row.
    SELECT * INTO v_bal FROM public.subscriber_balances
     WHERE subscriber_id = t.subscriber_id FOR UPDATE;
    IF NOT FOUND THEN
      -- The booking triggers create the row, so this can only mean the member's
      -- balance was deleted underneath a pending transaction. Leave it pending
      -- and let reconciliation surface it rather than inventing a balance.
      CONTINUE;
    END IF;

    -- (b) The dealing price, and the exact register row it came from.
    SELECT r.unit_price, r.id INTO v_price, v_snap
      FROM public.nav_price_row(t.dealing_date, p_fund) r;
    IF v_price IS NULL OR v_price <= 0 THEN
      CONTINUE;   -- unreachable given the EXISTS above; belt and braces
    END IF;

    -- Legs. Both booking triggers resolve and write these back onto the row, so
    -- the value struck here is the same one the hold was taken against. They
    -- are re-derived only for a row written by some other path.
    IF t.split_retirement IS NOT NULL AND t.split_emergency IS NOT NULL THEN
      v_ret_leg := t.split_retirement;
      v_emg_leg := t.split_emergency;
    ELSIF t.type = 'contribution' THEN
      v_ret_leg := round(t.amount * 0.80);
      v_emg_leg := t.amount - v_ret_leg;
    ELSE
      v_emg_leg := LEAST(abs(t.amount), GREATEST(v_bal.emergency_balance, 0));
      v_ret_leg := abs(t.amount) - v_emg_leg;
    END IF;

    v_units_before := v_bal.units;

    IF t.type = 'contribution' THEN
      -- (c) ALLOCATE. Units at the DEALING date's price - never today's.
      v_units := t.amount / v_price;

      UPDATE public.subscriber_balances
         SET units              = units + v_units,
             invested           = invested + t.amount,
             retirement_balance = retirement_balance + v_ret_leg,
             emergency_balance  = emergency_balance  + v_emg_leg,
             -- Derived, never rounded independently: bucket_sum_chk is a HARD
             -- equality and rounding all three separately is what trips it.
             total_balance      = retirement_balance + v_ret_leg
                                + emergency_balance  + v_emg_leg,
             -- The money leaves the pending component in the same statement it
             -- enters the allocated one. That is the no-jump property.
             pending_contribution_retirement = GREATEST(0, pending_contribution_retirement - v_ret_leg),
             pending_contribution_emergency  = GREATEST(0, pending_contribution_emergency  - v_emg_leg),
             nav_as_of  = t.dealing_date,
             updated_at = now()
       WHERE subscriber_id = t.subscriber_id;

      v_contribs    := v_contribs + 1;
      v_units_delta := v_units_delta + v_units;
      v_value       := v_value + t.amount;

    ELSE
      -- (c) LIQUIDATE. Same rule, opposite sign.
      v_units := abs(t.amount) / v_price;

      -- D8: the price fell far enough between request and dealing date that the
      -- amount no longer fits the units held. Reject and release the hold — the
      -- member re-requests at a figure that exists. Silently paying out less
      -- than they confirmed is the worse failure.
      IF v_units > v_bal.units + 0.000001 THEN
        UPDATE public.subscriber_balances
           SET pending_redemption_retirement = GREATEST(0, pending_redemption_retirement - v_ret_leg),
               pending_redemption_emergency  = GREATEST(0, pending_redemption_emergency  - v_emg_leg),
               updated_at = now()
         WHERE subscriber_id = t.subscriber_id;

        UPDATE public.transactions
           SET pricing_status = 'rejected', priced_at = now()
         WHERE id = t.id AND pricing_status = 'pending';

        UPDATE public.withdrawals
           SET status = 'rejected'
         WHERE subscriber_id = t.subscriber_id AND reference = t.txn_ref AND status = 'processing';

        v_rejected := v_rejected + 1;
        CONTINUE;
      END IF;

      UPDATE public.subscriber_balances
         SET units              = units - v_units,
             -- Average cost: drop the SAME FRACTION of basis as of units, so a
             -- withdrawal leaves growth% invariant. Reducing by net cash-in
             -- instead produces -233% outliers for heavy withdrawers.
             invested           = CASE WHEN v_units_before > 0
                                    THEN GREATEST(0, invested * (1 - v_units / v_units_before))
                                    ELSE 0 END,
             retirement_balance = GREATEST(0, retirement_balance - v_ret_leg),
             emergency_balance  = GREATEST(0, emergency_balance  - v_emg_leg),
             total_balance      = GREATEST(0, retirement_balance - v_ret_leg)
                                + GREATEST(0, emergency_balance  - v_emg_leg),
             -- The hold is released and the struck value becomes money owed.
             -- The member's TOTAL does not move: they stop owning units and
             -- start being owed exactly what those units were sold for.
             pending_redemption_retirement = GREATEST(0, pending_redemption_retirement - v_ret_leg),
             pending_redemption_emergency  = GREATEST(0, pending_redemption_emergency  - v_emg_leg),
             pending_payout_retirement     = pending_payout_retirement + v_ret_leg,
             pending_payout_emergency      = pending_payout_emergency  + v_emg_leg,
             nav_as_of  = t.dealing_date,
             updated_at = now()
       WHERE subscriber_id = t.subscriber_id;

      v_redemptions := v_redemptions + 1;
      v_units_delta := v_units_delta - v_units;
      v_value       := v_value + abs(t.amount);
    END IF;

    -- (d) BUCKET UNITS. Mandatory: subscriber_balances_bucket_units_sum is a
    -- DEFERRABLE constraint trigger that raises 23514 at COMMIT unless
    -- retirement_units + emergency_units = units within 0.000001. Any statement
    -- that moves `units` must call this before the transaction ends.
    --
    -- ⚠️ THIS MUST PRECEDE THE RE-MARK BELOW. The re-mark READS retirement_units;
    --    the allocation above changed `units` and both bucket balances and left
    --    retirement_units stale, so re-marking first would split the two pots
    --    off a stale ratio. Found by building it, not by reading it.
    PERFORM public._resync_bucket_units(t.subscriber_id);

    -- (e) RE-MARK TO THE BOOK. Only when this transaction dealt at a price that
    -- is not the newest published one — i.e. a back-dated publish just filled a
    -- hole and released a stalled queue. The member bought at the dealing
    -- price (correct, and theirs), but the book carries everyone at the newest
    -- price, and nav_mismatch asserts that within 1 UGX per member. Without
    -- this the released member is left off-book by the market movement between
    -- the two dates; measured at -9,150 UGX on a single release, while the
    -- aggregate publish gate showed 0.0000% drift and would never have caught it.
    IF v_book_price IS NOT NULL AND v_price <> v_book_price THEN
      UPDATE public.subscriber_balances
         SET total_balance      = round(units * v_book_price),
             retirement_balance = round(retirement_units * v_book_price),
             -- Complement rule, exactly as publish_nav_snapshot does it.
             emergency_balance  = round(units * v_book_price)
                                - round(retirement_units * v_book_price),
             updated_at = now()
       WHERE subscriber_id = t.subscriber_id;
      -- The ratio is preserved by the complement rule, so this is stable; it
      -- keeps the F3 invariant exact rather than nearly-exact.
      PERFORM public._resync_bucket_units(t.subscriber_id);
    END IF;

    -- (f) CLAIM THE ROW. The `pricing_status = 'pending'` predicate is the
    -- idempotency guarantee: a second caller that somehow reached this row
    -- updates nothing.
    UPDATE public.transactions
       SET pricing_status     = 'priced',
           unit_price_applied = v_price,
           units_delta        = CASE WHEN t.type = 'contribution' THEN v_units ELSE -v_units END,
           nav_snapshot_id    = v_snap,
           priced_at          = public.kampala_now(),
           split_retirement   = COALESCE(split_retirement, v_ret_leg),
           split_emergency    = COALESCE(split_emergency, v_emg_leg)
     WHERE id = t.id AND pricing_status = 'pending';

    v_priced := v_priced + 1;

    -- (g) SAVE-TO-COVER (0072), ported out of the contribution trigger.
    -- It used to run at insert time because that was when units existed. Now
    -- units exist HERE, so it runs here — after allocation, at the dealing
    -- price, for own-money contributions only. The employer co-contribution
    -- and the group insurance leg never accrue toward a self policy.
    IF t.type = 'contribution' AND t.source = 'own' THEN
      SELECT * INTO v_sched FROM public.contribution_schedules
        WHERE subscriber_id = t.subscriber_id FOR UPDATE;

      IF v_sched.insurance_funding_mode = 'save_to_cover' THEN
        -- Lazy renewal (no pg_cron): an active self policy past its renewal
        -- date flips back to 'building' so it re-accrues. Both tables.
        UPDATE public.insurance_policies
           SET status = 'building'
         WHERE subscriber_id = t.subscriber_id AND funded_by = 'self'
           AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;
        UPDATE public.subscriber_insurance_products
           SET status = 'building', updated_at = now()
         WHERE subscriber_id = t.subscriber_id AND funded_by = 'self'
           AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;

        SELECT COALESCE(SUM(premium_monthly * 12), 0) INTO v_target
          FROM ( SELECT premium_monthly FROM public.insurance_policies
                   WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status <> 'active'
                 UNION ALL
                 SELECT premium_monthly FROM public.subscriber_insurance_products
                   WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status <> 'active' ) q;

        IF v_target > 0 THEN
          v_new_accrued := LEAST(
            v_target,
            v_sched.insurance_premium_accrued
              + v_emg_leg * (COALESCE(v_sched.insurance_savings_pct, 100) / 100.0));

          SELECT emergency_balance INTO v_emg_bal
            FROM public.subscriber_balances WHERE subscriber_id = t.subscriber_id;

          IF v_new_accrued >= v_target AND v_emg_bal >= v_target THEN
            SELECT LEAST(v_target / v_price, units) INTO v_sweep_units
              FROM public.subscriber_balances WHERE subscriber_id = t.subscriber_id;

            UPDATE public.subscriber_balances
               SET emergency_balance = emergency_balance - v_target,
                   total_balance     = total_balance     - v_target,
                   units             = units - v_sweep_units,
                   invested          = CASE WHEN units > 0
                                         THEN GREATEST(0, invested * (1 - v_sweep_units / units))
                                         ELSE 0 END,
                   nav_as_of         = t.dealing_date,
                   updated_at        = now()
             WHERE subscriber_id = t.subscriber_id;
            PERFORM public._resync_bucket_units(t.subscriber_id);

            -- The marker row is written ALREADY PRICED. Its units were debited
            -- inline above, so if it entered the queue as 'pending' the engine
            -- would allocate it a second time and debit the units twice. The
            -- stamp trigger honours an explicitly-supplied status precisely so
            -- this row can opt out.
            INSERT INTO public.transactions
              (id, subscriber_id, type, amount, date, status, method, txn_ref, source,
               dealing_date, pricing_status, unit_price_applied, units_delta, priced_at)
            VALUES ('tx-' || t.subscriber_id || '-sweep-' || replace(gen_random_uuid()::text, '-', ''),
                    t.subscriber_id, 'premium_sweep', -v_target, now(), 'settled',
                    'internal', 'SW-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0'), 'own',
                    t.dealing_date, 'priced', v_price, -v_sweep_units, now());

            UPDATE public.insurance_policies
               SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date
             WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status = 'building';
            UPDATE public.subscriber_insurance_products
               SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date, updated_at = now()
             WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status = 'building';

            UPDATE public.contribution_schedules
               SET insurance_premium_target = 0, insurance_premium_accrued = 0, updated_at = now()
             WHERE subscriber_id = t.subscriber_id;
          ELSE
            UPDATE public.contribution_schedules
               SET insurance_premium_accrued = v_new_accrued, insurance_premium_target = v_target, updated_at = now()
             WHERE subscriber_id = t.subscriber_id;
          END IF;
        END IF;
      END IF;

      -- Lazy indexation, independent of insurance. Same no-cron pattern.
      IF v_sched.contribution_indexation_pct > 0
         AND (v_sched.last_indexed_at IS NULL OR now() >= v_sched.last_indexed_at + INTERVAL '1 year') THEN
        UPDATE public.contribution_schedules
           SET amount = ROUND(amount * (1 + contribution_indexation_pct / 100.0)),
               last_indexed_at = now(), updated_at = now()
         WHERE subscriber_id = t.subscriber_id;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'skipped',       false,
    'priced',        v_priced,
    'rejected',      v_rejected,
    'contributions', v_contribs,
    'redemptions',   v_redemptions,
    'unitsDelta',    v_units_delta,
    'value',         v_value
  );
END;
$$;

-- A manual kick, for the operator, after a late publish. Admin-gated because it
-- moves money; the engine itself is DEFINER and called from trusted paths.
CREATE OR REPLACE FUNCTION public.run_pending_pricing(p_max_rows INTEGER DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can run the pricing queue'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN public.price_pending_transactions('UPU-BAL', p_max_rows);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) The stamp — now the ONE place the kill switch is read for new rows
-- ─────────────────────────────────────────────────────────────────────────────
-- Two changes from 0144:
--   * a money row becomes 'pending' instead of 'priced' when the flag is on;
--   * an EXPLICITLY SUPPLIED status is honoured rather than overwritten.
--
-- The second is load-bearing, not tidiness. The save-to-cover sweep debits its
-- units inline and writes its marker row already priced. If this trigger forced
-- that row to 'pending', the engine would pick it up and debit the same units a
-- SECOND time. The column default is 'pending', so "still 'pending' here" is
-- exactly the test for "the caller did not set it".
CREATE OR REPLACE FUNCTION public.trg_transactions_stamp_dealing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  IF NEW.received_at IS NULL THEN
    NEW.received_at := now();
  END IF;

  IF NEW.dealing_date IS NULL THEN
    NEW.dealing_date := public.dealing_date_for(NEW.received_at);
  END IF;

  -- Untouched default => this trigger decides. Anything else => the caller has
  -- already priced the row itself and must not be second-guessed.
  IF NEW.pricing_status IS NOT DISTINCT FROM 'pending' THEN
    IF NEW.type IN ('contribution', 'withdrawal', 'premium_sweep') THEN
      SELECT c.pricing_enabled INTO v_enabled
        FROM public.fund_dealing_config c WHERE c.fund_code = 'UPU-BAL';
      NEW.pricing_status := CASE WHEN COALESCE(v_enabled, false) THEN 'pending' ELSE 'priced' END;
    ELSE
      NEW.pricing_status := 'not_applicable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) trg_transactions_contribution — books the money, buys nothing
-- ─────────────────────────────────────────────────────────────────────────────
-- With the flag ON this trigger takes an early exit that:
--   * resolves the bucket legs and WRITES THEM BACK onto the transaction row,
--     so the engine strikes the same legs that were booked here (two separate
--     derivations of the same split is how a hold and its liquidation drift);
--   * books the face value into pending_contribution_*, creating the balance
--     row if this is the member's first money;
--   * creates the first-contribution commission EXACTLY AS BEFORE. Commission
--     stays on RECEIPT (plan D1): an agent is paid for signing the member up,
--     which they did, and making their pay depend on the fund publishing a
--     price would be a change to how people get paid, not a pricing change;
--   * does NOT touch units, invested or any allocated balance, and does NOT run
--     the save-to-cover sweep — there are no units to sweep yet. That block now
--     lives in the engine and runs immediately after this money allocates.
--
-- With the flag OFF, execution falls through to the 0144 body unchanged.
CREATE OR REPLACE FUNCTION public.trg_transactions_contribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_unit_price       NUMERIC;
  v_retirement_share NUMERIC;
  v_emergency_share  NUMERIC;
  v_agent_id         TEXT;
  v_branch_id        TEXT;
  v_subscriber_name  TEXT;
  v_commission_rate  NUMERIC;
  v_new_commission_id TEXT;
  v_sched            public.contribution_schedules%ROWTYPE;
  v_target           NUMERIC;
  v_new_accrued      NUMERIC;
  v_emg_bal          NUMERIC;
  v_sweep_units      NUMERIC;
  v_async            BOOLEAN := (NEW.pricing_status = 'pending');
BEGIN
  -- (b) Bucket split — identical derivation in both modes.
  IF NEW.split_retirement IS NOT NULL AND NEW.split_emergency IS NOT NULL THEN
    v_retirement_share := NEW.split_retirement;
    v_emergency_share  := NEW.split_emergency;
  ELSE
    v_retirement_share := ROUND(NEW.amount * 0.80);
    v_emergency_share  := NEW.amount - v_retirement_share;  -- avoids penny drift
  END IF;

  IF v_async THEN
    -- ── ASYNC PATH ────────────────────────────────────────────────────────
    -- The money is HERE. It has bought nothing. The member's total rises by
    -- the face value immediately and their withdrawable does not move.
    INSERT INTO public.subscriber_balances (
      subscriber_id, retirement_balance, emergency_balance, total_balance,
      units, invested,
      pending_contribution_retirement, pending_contribution_emergency,
      nav_as_of, updated_at
    ) VALUES (
      NEW.subscriber_id, 0, 0, 0, 0, 0,
      v_retirement_share, v_emergency_share,
      NULL, now()
    )
    ON CONFLICT (subscriber_id) DO UPDATE SET
      pending_contribution_retirement =
        public.subscriber_balances.pending_contribution_retirement + EXCLUDED.pending_contribution_retirement,
      pending_contribution_emergency  =
        public.subscriber_balances.pending_contribution_emergency  + EXCLUDED.pending_contribution_emergency,
      updated_at = now();

    -- Freeze the legs onto the ledger row so the engine strikes exactly what
    -- was booked here, whatever the balances look like by then.
    UPDATE public.transactions
       SET split_retirement = v_retirement_share,
           split_emergency  = v_emergency_share
     WHERE id = NEW.id;

  ELSE
    -- ── SYNCHRONOUS PATH — the pre-0147 body, unchanged ───────────────────
    v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));

    -- 0147: nav_for_date is STRICT now, so with the flag off and no price
    -- published for this exact date it returns NULL and `NEW.amount /
    -- v_unit_price` would credit NULL units — silently, on every contribution.
    -- The book carrying price is the honest fallback for the legacy path: it
    -- is the price the whole book is already marked at.
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      v_unit_price := public.latest_nav();
    END IF;
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'no published unit price is available to price this contribution'
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.subscriber_balances (
      subscriber_id, retirement_balance, emergency_balance, total_balance,
      units, invested, nav_as_of, updated_at
    ) VALUES (
      NEW.subscriber_id, v_retirement_share, v_emergency_share, NEW.amount,
      NEW.amount / v_unit_price, NEW.amount, CURRENT_DATE, now()
    )
    ON CONFLICT (subscriber_id) DO UPDATE SET
      retirement_balance = public.subscriber_balances.retirement_balance + EXCLUDED.retirement_balance,
      emergency_balance  = public.subscriber_balances.emergency_balance  + EXCLUDED.emergency_balance,
      total_balance      = public.subscriber_balances.total_balance      + EXCLUDED.total_balance,
      units              = public.subscriber_balances.units              + EXCLUDED.units,
      invested           = public.subscriber_balances.invested           + EXCLUDED.invested,
      nav_as_of          = EXCLUDED.nav_as_of,
      updated_at         = now();

    PERFORM public._resync_bucket_units(NEW.subscriber_id);

    UPDATE public.transactions
       SET unit_price_applied = v_unit_price,
           units_delta        = NEW.amount / v_unit_price,
           priced_at          = now()
     WHERE id = NEW.id;

    -- 0072 save-to-cover, only on the synchronous path. On the async path this
    -- whole block runs inside the engine, after the units exist.
    IF NEW.source = 'own' THEN
      SELECT * INTO v_sched FROM public.contribution_schedules
        WHERE subscriber_id = NEW.subscriber_id FOR UPDATE;

      IF v_sched.insurance_funding_mode = 'save_to_cover' THEN
        UPDATE public.insurance_policies
           SET status = 'building'
         WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self'
           AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;
        UPDATE public.subscriber_insurance_products
           SET status = 'building', updated_at = now()
         WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self'
           AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;

        SELECT COALESCE(SUM(premium_monthly * 12), 0) INTO v_target
          FROM ( SELECT premium_monthly FROM public.insurance_policies
                   WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status <> 'active'
                 UNION ALL
                 SELECT premium_monthly FROM public.subscriber_insurance_products
                   WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status <> 'active' ) q;

        IF v_target > 0 THEN
          v_new_accrued := LEAST(
            v_target,
            v_sched.insurance_premium_accrued
              + v_emergency_share * (COALESCE(v_sched.insurance_savings_pct, 100) / 100.0));

          SELECT emergency_balance INTO v_emg_bal
            FROM public.subscriber_balances WHERE subscriber_id = NEW.subscriber_id;

          IF v_new_accrued >= v_target AND v_emg_bal >= v_target THEN
            SELECT LEAST(v_target / v_unit_price, units) INTO v_sweep_units
              FROM public.subscriber_balances WHERE subscriber_id = NEW.subscriber_id;

            UPDATE public.subscriber_balances
               SET emergency_balance = emergency_balance - v_target,
                   total_balance     = total_balance     - v_target,
                   units             = units - v_sweep_units,
                   invested          = CASE WHEN units > 0
                                         THEN GREATEST(0, invested * (1 - v_sweep_units / units))
                                         ELSE 0 END,
                   nav_as_of         = CURRENT_DATE,
                   updated_at        = now()
             WHERE subscriber_id = NEW.subscriber_id;
            PERFORM public._resync_bucket_units(NEW.subscriber_id);

            INSERT INTO public.transactions
              (id, subscriber_id, type, amount, date, status, method, txn_ref, source,
               pricing_status, unit_price_applied, units_delta, priced_at)
            VALUES ('tx-' || NEW.subscriber_id || '-sweep-' || replace(gen_random_uuid()::text, '-', ''),
                    NEW.subscriber_id, 'premium_sweep', -v_target, now(), 'settled',
                    'internal', 'SW-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0'), 'own',
                    'priced', v_unit_price, -v_sweep_units, now());

            UPDATE public.insurance_policies
               SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date
             WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status = 'building';
            UPDATE public.subscriber_insurance_products
               SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date, updated_at = now()
             WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status = 'building';

            UPDATE public.contribution_schedules
               SET insurance_premium_target = 0, insurance_premium_accrued = 0, updated_at = now()
             WHERE subscriber_id = NEW.subscriber_id;
          ELSE
            UPDATE public.contribution_schedules
               SET insurance_premium_accrued = v_new_accrued, insurance_premium_target = v_target, updated_at = now()
             WHERE subscriber_id = NEW.subscriber_id;
          END IF;
        END IF;
      END IF;

      IF v_sched.contribution_indexation_pct > 0
         AND (v_sched.last_indexed_at IS NULL OR now() >= v_sched.last_indexed_at + INTERVAL '1 year') THEN
        UPDATE public.contribution_schedules
           SET amount = ROUND(amount * (1 + contribution_indexation_pct / 100.0)),
               last_indexed_at = now(), updated_at = now()
         WHERE subscriber_id = NEW.subscriber_id;
      END IF;
    END IF;
  END IF;

  -- (c) First-contribution commission — IDENTICAL IN BOTH MODES (plan D1).
  -- Deliberately still on receipt: the commission is paid for signing the
  -- member up, and that happened. Moving it to allocation would make an agent's
  -- pay depend on the fund publishing a price.
  SELECT s.agent_id, s.name, a.branch_id
    INTO v_agent_id, v_subscriber_name, v_branch_id
    FROM public.subscribers s
    LEFT JOIN public.agents a ON a.id = s.agent_id
   WHERE s.id = NEW.subscriber_id;

  IF v_agent_id IS NOT NULL THEN
    -- 0115 [A05-013]: one onboarding commission per MEMBER, ever. Keyed on the
    -- member alone — keying on (agent, member) let a transfer pay a second
    -- 5,000 UGX for the same person. ux_commissions_subscriber enforces the
    -- same thing at the table.
    IF NOT EXISTS (
      SELECT 1 FROM public.commissions WHERE subscriber_id = NEW.subscriber_id
    ) THEN
      v_commission_rate := public.commission_rate_for_branch(v_branch_id);

      -- 0115 [A05-012]: a rate of 0 means NO commission, not a zero-value one.
      -- The `< 'Infinity'` test is not decoration: NaN sorts ABOVE every
      -- numeric in Postgres, so `> 0` alone is TRUE for NaN.
      IF v_commission_rate IS NOT NULL
         AND v_commission_rate > 0
         AND v_commission_rate < 'Infinity'::numeric THEN
        v_new_commission_id := 'c-' || lpad(nextval('public.commission_id_seq')::text, 8, '0');

        INSERT INTO public.commissions (
          id, agent_id, branch_id, subscriber_id, subscriber_name,
          amount, status, first_contribution_date, due_date
        ) VALUES (
          v_new_commission_id, v_agent_id, v_branch_id, NEW.subscriber_id, v_subscriber_name,
          v_commission_rate, 'due',
          -- 0147: the Kampala dealing date, not `NEW.date::date` cast in the
          -- UTC session zone. A receipt between 00:00 and 03:00 Kampala used to
          -- date the commission to the previous day.
          COALESCE(NEW.dealing_date, NEW.date::date),
          COALESCE(NEW.dealing_date, NEW.date::date)
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) trg_transactions_withdrawal — places a hold, sells nothing
-- ─────────────────────────────────────────────────────────────────────────────
-- With the flag ON: resolve the legs against WITHDRAWABLE money, write them
-- back onto the ledger row, and place the hold. The member's total does not
-- move — they still own the units — and their withdrawable falls by exactly
-- the requested amount, so the same money cannot be requested twice.
--
-- With the flag OFF: the pre-0147 body, which debits the pots immediately.
CREATE OR REPLACE FUNCTION public.trg_transactions_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ret_take    NUMERIC;
  v_emg_take    NUMERIC;
  v_current_emg NUMERIC;
  v_amount      NUMERIC := ABS(NEW.amount);  -- defensive: treat as magnitude
  v_async       BOOLEAN := (NEW.pricing_status = 'pending');
BEGIN
  IF NEW.split_retirement IS NOT NULL AND NEW.split_emergency IS NOT NULL THEN
    v_ret_take := NEW.split_retirement;
    v_emg_take := NEW.split_emergency;
  ELSE
    -- Emergency-first fallback. On the async path it must measure the
    -- WITHDRAWABLE savings pot, not the gross one: an existing hold has already
    -- spoken for part of it, and ignoring that would over-allocate this
    -- withdrawal to a pot that cannot cover it.
    IF v_async THEN
      SELECT GREATEST(0, emergency_balance - pending_redemption_emergency)
        INTO v_current_emg
        FROM public.subscriber_balances WHERE subscriber_id = NEW.subscriber_id;
    ELSE
      SELECT emergency_balance INTO v_current_emg
        FROM public.subscriber_balances WHERE subscriber_id = NEW.subscriber_id;
    END IF;

    v_current_emg := COALESCE(v_current_emg, 0);

    IF v_amount <= v_current_emg THEN
      v_emg_take := v_amount;
      v_ret_take := 0;
    ELSE
      v_emg_take := v_current_emg;
      v_ret_take := v_amount - v_current_emg;
    END IF;
  END IF;

  IF v_async THEN
    UPDATE public.subscriber_balances
       SET pending_redemption_retirement = pending_redemption_retirement + v_ret_take,
           pending_redemption_emergency  = pending_redemption_emergency  + v_emg_take,
           updated_at = now()
     WHERE subscriber_id = NEW.subscriber_id;

    -- Freeze the legs so the engine liquidates exactly what was held.
    UPDATE public.transactions
       SET split_retirement = v_ret_take,
           split_emergency  = v_emg_take
     WHERE id = NEW.id;
  ELSE
    UPDATE public.subscriber_balances
       SET retirement_balance = GREATEST(0, retirement_balance - v_ret_take),
           emergency_balance  = GREATEST(0, emergency_balance  - v_emg_take),
           total_balance      = GREATEST(0, total_balance - v_amount),
           updated_at         = now()
     WHERE subscriber_id = NEW.subscriber_id;

    UPDATE public.transactions
       SET unit_price_applied = public.latest_nav(),
           priced_at          = now()
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8) settle_withdrawal — the missing half of the payout lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTHING in this codebase ever set withdrawals.status = 'paid'. All 4,922 paid
-- rows are seed data; every runtime withdrawal has sat in 'processing' forever.
-- That was invisible while the request itself debited the member's balance.
--
-- It stops being invisible here: under the new model the struck value sits in
-- pending_payout_* — still part of the member's total, because they have not
-- been paid — and without a settlement step it would stay there for good, so a
-- member's balance would never fall after a withdrawal.
--
-- There is no payment rail to automate against, so this is an operator action:
-- the money leaves the member's total at the moment someone records that it
-- actually reached them. That is the honest model, and it is also the one that
-- makes the outstanding-payout figure a real operational number.
CREATE OR REPLACE FUNCTION public.settle_withdrawal(p_withdrawal_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wd  public.withdrawals%ROWTYPE;
  v_tx  public.transactions%ROWTYPE;
  v_ret NUMERIC;
  v_emg NUMERIC;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can settle a withdrawal' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wd FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No withdrawal %', p_withdrawal_id USING ERRCODE = 'P0001';
  END IF;
  IF v_wd.status <> 'processing' THEN
    RAISE EXCEPTION 'Withdrawal % is already %', p_withdrawal_id, v_wd.status USING ERRCODE = 'P0001';
  END IF;

  -- The ledger row is the authority for how much was actually struck, and for
  -- whether it has been struck at all.
  SELECT * INTO v_tx FROM public.transactions
   WHERE subscriber_id = v_wd.subscriber_id AND txn_ref = v_wd.reference AND type = 'withdrawal'
   ORDER BY received_at DESC LIMIT 1;

  IF FOUND AND v_tx.pricing_status = 'pending' THEN
    RAISE EXCEPTION 'Withdrawal % has not been priced yet - it deals on %',
      p_withdrawal_id, to_char(v_tx.dealing_date, 'YYYY-MM-DD') USING ERRCODE = 'P0001';
  END IF;

  v_ret := COALESCE(v_tx.split_retirement, 0);
  v_emg := COALESCE(v_tx.split_emergency, v_wd.amount);

  -- Clamp to what is actually owed. A withdrawal struck before 0147 has no
  -- payout component to release, so this correctly releases nothing.
  UPDATE public.subscriber_balances
     SET pending_payout_retirement = GREATEST(0, pending_payout_retirement - v_ret),
         pending_payout_emergency  = GREATEST(0, pending_payout_emergency  - v_emg),
         updated_at = now()
   WHERE subscriber_id = v_wd.subscriber_id;

  UPDATE public.withdrawals SET status = 'paid' WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object(
    'id', p_withdrawal_id, 'status', 'paid',
    'releasedRetirement', v_ret, 'releasedEmergency', v_emg);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9) request_withdrawal - validates against WITHDRAWABLE, sells nothing
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-emitted from its 0115 body with four changes, each marked `0147:`. The
-- nonce claim, the advisory lock, assert_finite_money, the all-or-nothing split
-- rule and the per-bucket checks are all preserved exactly as they were - this
-- function's idempotency guarantees are not part of what changed.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_nonce text, p_amount numeric, p_bucket text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_method text DEFAULT 'MTN Mobile Money'::text, p_split_retirement numeric DEFAULT NULL::numeric, p_split_emergency numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_subscriber_id text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_total_balance numeric;
  v_ret_balance   numeric;                    -- 0114: read under the same lock
  v_emg_balance   numeric;                    -- 0114: read under the same lock
  v_unit_price    numeric;                    -- 0104: the fund NAV in force today
  v_split_ret     numeric := p_split_retirement;
  v_split_emg     numeric := p_split_emergency;
  v_ref           text;
  v_tx_id         text;
  v_wd_id         text;
  v_bucket        text;
  v_prior         jsonb;
  v_result        jsonb;
  v_async         boolean;                  -- 0147: forward-dealing in force?
  v_tx_dealing    date;                     -- 0147: what the receipt promises
  v_tx_status     text;                     -- 0147: pending | priced
BEGIN
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot request a withdrawal', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_subscriber_id IS NULL OR v_subscriber_id = '' THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;

  -- 0114 [A04-001, A04-012]: replaces `IF p_amount IS NULL OR p_amount <= 0`.
  -- 5,000 is MIN_WITHDRAW in src/constants/savings.js; the smallest non-zero
  -- live balance is 42,199, so no member is trapped by the floor.
  PERFORM public.assert_finite_money(p_amount, 'withdrawal amount', 5000, 100000000, true);

  -- 0114: 'retirement' and 'emergency' are the only two buckets that exist, and
  -- everything else used to fall through to emergency silently.
  IF p_bucket IS NOT NULL AND p_bucket NOT IN ('retirement', 'emergency') THEN
    RAISE EXCEPTION 'unknown pot %; choose retirement or emergency', p_bucket USING ERRCODE = 'P0001';
  END IF;

  -- 0114 [A04-002]: the balance trigger only honours the explicit splits when
  -- BOTH are present; a lone leg was written to the ledger row and then quietly
  -- ignored. All-or-nothing, checked before anything is read or written.
  IF (p_split_retirement IS NULL) <> (p_split_emergency IS NULL) THEN
    RAISE EXCEPTION 'give both the retirement and the savings part of the split, or neither'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 0147 · forward dealing ────────────────────────────────────────────────
  SELECT c.pricing_enabled INTO v_async
    FROM public.fund_dealing_config c WHERE c.fund_code = 'UPU-BAL';
  v_async := COALESCE(v_async, false);

  IF v_async THEN
    -- Opportunistic, bounded sweep. There is no scheduler by design (a queue
    -- that drains only on a timer is a queue that silently stops draining), so
    -- the member-facing money RPCs each nudge it. 50 rows is index-backed via
    -- ix_transactions_pending and adds no perceptible latency; the real release
    -- happens on publish. Deliberately BEFORE the balance is read, so a
    -- redemption released a moment ago is reflected in what this member can
    -- take out.
    PERFORM public.price_pending_transactions('UPU-BAL', 50);
  ELSE
    -- Legacy path only: redeem at the fund NAV, not a hardcoded 1,000.
    v_unit_price := public.latest_nav();
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'no published unit price is available to price this withdrawal'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 0115 [A04-011] · CLAIM THE NONCE BEFORE THE MONEY MOVES ───────────────
  -- 0114 and every version before it read the nonce here with a plain, UNLOCKED
  -- SELECT and wrote the public.money_nonces row only AFTER the money write, with
  -- ON CONFLICT DO NOTHING. Two taps that arrive together therefore both read
  -- "no such nonce" — neither transaction can see the other's uncommitted row —
  -- both write their money row (the ids are fresh uuids, so nothing collides),
  -- and the loser's DO NOTHING then swallows the duplicate nonce in silence.
  -- Net: one nonce row, the money applied TWICE. The nonce is minted per
  -- confirm-sheet precisely to survive a double-tap, which is exactly the
  -- gesture that produces two near-simultaneous calls.
  --
  -- Two mechanisms, in this order:
  --
  --   1. pg_advisory_xact_lock makes the second caller WAIT, and makes the
  --      read-then-claim pair below one indivisible step. It is TRANSACTION-
  --      scoped: released on COMMIT and on ROLLBACK, nothing to clean up, safe
  --      behind a transaction-mode connection pooler. A hash collision between
  --      two different nonces costs a short wait and can never be incorrect,
  --      because step 2 is the actual arbiter.
  --
  --      The audit's suggested shape — claim with `ON CONFLICT DO NOTHING
  --      RETURNING`, re-read the prior result when nothing comes back — is
  --      equally correct, and was measured rather than assumed: that INSERT
  --      DOES wait on a conflicting in-flight insert (7.28 s against a
  --      held-open session), then does nothing if the other committed and
  --      inserts if it aborted. The widespread claim that DO NOTHING "never
  --      waits" is about the ROW LOCK it skips on an already-committed row,
  --      not about an in-flight one. The explicit lock is used here because a
  --      wait you can read beats a wait you have to know about.
  --
  --   2. the plain INSERT, arbitrated by money_nonces_pkey. This is the
  --      guarantee. If a second claimant ever reaches it, it aborts on the
  --      unique violation — and by then NO money has moved, because the claim
  --      now precedes the ledger write instead of following it.
  --
  -- A failure anywhere after this point rolls the claim back with everything
  -- else, so a rejected call never burns its nonce.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('public.money_nonces'), pg_catalog.hashtext(p_nonce));

    -- New statement, new snapshot: an earlier holder has by now either
    -- committed (row visible → this is a replay) or rolled back (row gone →
    -- the nonce is free again).
    SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      IF v_prior = '{}'::jsonb THEN
        -- The placeholder below is written and overwritten inside ONE
        -- transaction, so it can never be seen committed. Refuse rather than
        -- hand the member an empty receipt.
        RAISE EXCEPTION 'this payment is still being processed; try again in a moment'
          USING ERRCODE = 'P0001';
      END IF;
      RETURN v_prior;
    END IF;

    INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result)
    VALUES (p_nonce, v_subscriber_id, 'withdrawal', '{}'::jsonb);
  END IF;

  -- F-5: server-side "withdraw ≤ available balance" guard. Lock the balance row
  -- so a concurrent withdrawal can't over-draw past the check.
  -- 0114: the two bucket balances come back under the SAME lock, so the
  -- per-bucket checks below cannot race the total check.
  -- 0147: WITHDRAWABLE, not the gross pots. Subtracting the existing holds
  -- here — rather than at each of the three checks below — is deliberate: it
  -- means the total check, the retirement check and the savings check ALL key
  -- off withdrawable money by construction, and a future check added below
  -- inherits that for free. Without it a member could request the same money
  -- twice in the window before their first request deals.
  -- Money in pending_contribution_* is excluded too, by definition: it has
  -- bought no units, so it is not in total_balance at all.
  SELECT total_balance      - CASE WHEN v_async
                                THEN pending_redemption_retirement + pending_redemption_emergency
                                ELSE 0 END,
         retirement_balance - CASE WHEN v_async THEN pending_redemption_retirement ELSE 0 END,
         emergency_balance  - CASE WHEN v_async THEN pending_redemption_emergency  ELSE 0 END
    INTO v_total_balance, v_ret_balance, v_emg_balance
    FROM public.subscriber_balances
   WHERE subscriber_id = v_subscriber_id
   FOR UPDATE;
  v_total_balance := COALESCE(v_total_balance, 0);
  v_ret_balance   := COALESCE(v_ret_balance, 0);
  v_emg_balance   := COALESCE(v_emg_balance, 0);

  IF p_amount > v_total_balance THEN
    RAISE EXCEPTION 'withdrawal of % exceeds available balance %', p_amount, v_total_balance
      USING ERRCODE = 'P0001';
  END IF;

  -- Resolve the split: explicit splits win; else a bucket routes the whole
  -- amount; else NULL (the trigger falls back to emergency-first). Mirrors the
  -- prior JS requestWithdrawal resolution.
  IF v_split_ret IS NULL AND v_split_emg IS NULL AND p_bucket IS NOT NULL THEN
    IF p_bucket = 'retirement' THEN
      v_split_ret := p_amount; v_split_emg := 0;
    ELSE
      v_split_ret := 0; v_split_emg := p_amount;
    END IF;
  END IF;

  -- F-5 (cont.) + 0114 [A04-002, A04-004]. Whether the legs came from the
  -- caller or from p_bucket above, they are the exact figures the trigger will
  -- subtract from each pot, so all four things must hold:
  --   1. each leg is a real, non-negative, whole number  (A04-002: a negative
  --      leg reached GREATEST(0, balance - leg) and ADDED money);
  --   2. they sum to the amount                          (the original check);
  --   3. the retirement leg fits the retirement pot      (A04-004);
  --   4. the savings leg fits the savings pot            (A04-004).
  -- Without 3 and 4 the trigger clamps the pot at 0 but still debits the total,
  -- and the member's two pots stop summing to their headline balance.
  IF v_split_ret IS NOT NULL AND v_split_emg IS NOT NULL THEN
    PERFORM public.assert_finite_money(v_split_ret, 'retirement part of the withdrawal', 0, 100000000, true);
    PERFORM public.assert_finite_money(v_split_emg, 'savings part of the withdrawal',    0, 100000000, true);

    IF (v_split_ret + v_split_emg) <> p_amount THEN
      RAISE EXCEPTION 'split_retirement + split_emergency (%) must equal amount %',
        v_split_ret + v_split_emg, p_amount USING ERRCODE = 'P0001';
    END IF;

    IF v_split_ret > v_ret_balance THEN
      RAISE EXCEPTION 'withdrawal of % from retirement exceeds the retirement balance %',
        v_split_ret, v_ret_balance USING ERRCODE = 'P0001';
    END IF;
    IF v_split_emg > v_emg_balance THEN
      RAISE EXCEPTION 'withdrawal of % from savings exceeds the savings balance %',
        v_split_emg, v_emg_balance USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_bucket := COALESCE(p_bucket, 'emergency');
  v_ref    := 'WD-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  v_tx_id  := 'tx-' || v_subscriber_id || '-wd-' || replace(gen_random_uuid()::text, '-', '');
  v_wd_id  := 'wd-' || v_subscriber_id || '-'    || replace(gen_random_uuid()::text, '-', '');

  -- 1. Ledger row → AFTER INSERT trigger debits subscriber_balances buckets.
  -- 0114 [A04-013/A06-014]: the amount is stored NEGATIVE, matching all 5,402
  -- historical rows, 0105's documented convention and src/data/employerSeed.js.
  -- trg_transactions_withdrawal already reads ABS(NEW.amount), so the debit is
  -- unchanged; what changes is that SUM(amount) over the ledger is now true.
  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, status, method,
    txn_ref, bucket, split_retirement, split_emergency, source
  ) VALUES (
    v_tx_id, v_subscriber_id, 'withdrawal', -p_amount, now(), 'processing', p_method,
    v_ref, p_bucket, v_split_ret, v_split_emg, 'own'
  );

  -- F-3: decrement units, which the withdrawal trigger still never touches, so
  -- units × NAV ≈ total_balance holds after a runtime withdrawal. Floor at 0.
  -- 0104: redeem units at the NAV and drop the SAME FRACTION of cost basis
  -- (average-cost). Because the fraction of units removed equals the fraction
  -- of basis removed, growth% is INVARIANT to withdrawals — reducing basis by
  -- simple net cash-in instead yields -233% outliers for heavy withdrawers.
  -- Every SET right-hand side reads the PRE-UPDATE row, so `units` below is
  -- the holding before this redemption.
  -- 0147: on the async path this function NO LONGER SELLS ANYTHING. The
  -- AFTER INSERT trigger above has placed a hold; the engine cancels the units
  -- at the DEALING date's price, which is not known yet and must not be
  -- guessed. latest_nav() here was the defect: it redeemed at whatever price
  -- happened to be newest, which for a Friday-evening request is a price
  -- struck before the request existed.
  IF NOT v_async THEN
  UPDATE public.subscriber_balances
     SET units      = GREATEST(0, units - LEAST(p_amount / v_unit_price, units)),
         invested   = CASE WHEN units > 0
                        THEN GREATEST(0, invested * (1 - LEAST(p_amount / v_unit_price, units) / units))
                        ELSE 0 END,
         nav_as_of  = CURRENT_DATE,
         updated_at = now()
   WHERE subscriber_id = v_subscriber_id;

  -- 0072 [H3]: clawback accrued so a withdrawal can't strand accrued >= target
  -- while emergency_balance < target (which would let the next contribution
  -- sweep money that is no longer in the bucket). Clamp accrued to what remains
  -- in the emergency bucket AFTER this withdrawal debited it above.
  UPDATE public.contribution_schedules
     SET insurance_premium_accrued = LEAST(
           insurance_premium_accrued,
           GREATEST(0, (SELECT emergency_balance FROM public.subscriber_balances
                          WHERE subscriber_id = v_subscriber_id))),
         updated_at = now()
   WHERE subscriber_id = v_subscriber_id
     AND insurance_funding_mode = 'save_to_cover';

  -- 0104: re-derive bucket units from the bucket balances the withdrawal
  -- trigger has just debited. Deliberately NOT split from v_split_ret/v_split_emg
  -- — both are NULL in the common case and this function does not implement the
  -- trigger's emergency-first fallback, so deriving is the only way the two
  -- cannot drift.
  PERFORM public._resync_bucket_units(v_subscriber_id);
  END IF;   -- 0147: end of the synchronous-only block

  -- 2. History row → the WithdrawalsHistory report consumes this (same txn).
  --    POSITIVE, like all 4,937 live rows in this table.
  INSERT INTO public.withdrawals (
    id, subscriber_id, amount, bucket, reason, method, status, date, reference
  ) VALUES (
    v_wd_id, v_subscriber_id, p_amount, v_bucket, p_reason, p_method, 'processing',
    (now())::date, v_ref
  );

  -- Return shape matches mapWithdrawalRow's camelCase contract (the legacy
  -- requestWithdrawal return object). `amount` stays POSITIVE — the member's
  -- receipt reads "you took out 100,000", not "-100,000".
  -- 0147: the client success panel keys off these two. Without them it falls
  -- back to promising the money "within 24 hours", which is exactly the
  -- sentence forward dealing makes false.
  SELECT dealing_date, pricing_status INTO v_tx_dealing, v_tx_status
    FROM public.transactions WHERE id = v_tx_id;

  v_result := jsonb_build_object(
    'dealingDate',   to_char(v_tx_dealing, 'YYYY-MM-DD'),
    'pricingStatus', v_tx_status,
    'id',        v_wd_id,
    'amount',    p_amount,
    'bucket',    v_bucket,
    'reason',    p_reason,
    'method',    p_method,
    'status',    'processing',
    'date',      to_char(now(), 'YYYY-MM-DD'),
    'reference', v_ref
  );

  -- 0115 [A04-011]: the row already exists — it was claimed before the money
  -- moved. Publish the real receipt onto it. No ON CONFLICT: this UPDATE
  -- cannot conflict with anything, and a silent no-op here would be the same
  -- class of bug the DO NOTHING above was.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    UPDATE public.money_nonces SET result = v_result WHERE nonce = p_nonce;
  END IF;

  RETURN v_result;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10) make_contribution - the receipt says when the money starts working
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.make_contribution(p_nonce text, p_amount numeric, p_retirement_pct numeric DEFAULT 80, p_method text DEFAULT 'MTN Mobile Money'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_subscriber_id text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_ret_pct       numeric;
  v_retirement    numeric;
  v_emergency     numeric;
  v_ref           text;
  v_tx_id         text;
  v_prior         jsonb;
  v_result        jsonb;
  v_tx_dealing    date;   -- 0147
  v_tx_status     text;   -- 0147
BEGIN
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot make a contribution', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_subscriber_id IS NULL OR v_subscriber_id = '' THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;

  -- 0114 [A04-001, A04-012]: replaces `IF p_amount IS NULL OR p_amount <= 0`,
  -- which could not reject NaN or Infinity. 5,000 is MIN_CONTRIBUTION in
  -- src/constants/savings.js — the UI has always enforced it, the server never
  -- did. 100,000,000 UGX is ~4x the largest live balance (24,786,589) and ~11x
  -- the largest live contribution (8,640,000).
  PERFORM public.assert_finite_money(p_amount, 'contribution amount', 5000, 100000000, true);

  -- 0147: opportunistic, bounded sweep of the pricing queue. No scheduler by
  -- design; the two member-facing money RPCs each nudge it, and a publish does
  -- the real work. Index-backed via ix_transactions_pending.
  IF (SELECT c.pricing_enabled FROM public.fund_dealing_config c WHERE c.fund_code = 'UPU-BAL') THEN
    PERFORM public.price_pending_transactions('UPU-BAL', 50);
  END IF;

  -- ── 0115 [A04-011] · CLAIM THE NONCE BEFORE THE MONEY MOVES ───────────────
  -- 0114 and every version before it read the nonce here with a plain, UNLOCKED
  -- SELECT and wrote the public.money_nonces row only AFTER the money write, with
  -- ON CONFLICT DO NOTHING. Two taps that arrive together therefore both read
  -- "no such nonce" — neither transaction can see the other's uncommitted row —
  -- both write their money row (the ids are fresh uuids, so nothing collides),
  -- and the loser's DO NOTHING then swallows the duplicate nonce in silence.
  -- Net: one nonce row, the money applied TWICE. The nonce is minted per
  -- confirm-sheet precisely to survive a double-tap, which is exactly the
  -- gesture that produces two near-simultaneous calls.
  --
  -- Two mechanisms, in this order:
  --
  --   1. pg_advisory_xact_lock makes the second caller WAIT, and makes the
  --      read-then-claim pair below one indivisible step. It is TRANSACTION-
  --      scoped: released on COMMIT and on ROLLBACK, nothing to clean up, safe
  --      behind a transaction-mode connection pooler. A hash collision between
  --      two different nonces costs a short wait and can never be incorrect,
  --      because step 2 is the actual arbiter.
  --
  --      The audit's suggested shape — claim with `ON CONFLICT DO NOTHING
  --      RETURNING`, re-read the prior result when nothing comes back — is
  --      equally correct, and was measured rather than assumed: that INSERT
  --      DOES wait on a conflicting in-flight insert (7.28 s against a
  --      held-open session), then does nothing if the other committed and
  --      inserts if it aborted. The widespread claim that DO NOTHING "never
  --      waits" is about the ROW LOCK it skips on an already-committed row,
  --      not about an in-flight one. The explicit lock is used here because a
  --      wait you can read beats a wait you have to know about.
  --
  --   2. the plain INSERT, arbitrated by money_nonces_pkey. This is the
  --      guarantee. If a second claimant ever reaches it, it aborts on the
  --      unique violation — and by then NO money has moved, because the claim
  --      now precedes the ledger write instead of following it.
  --
  -- A failure anywhere after this point rolls the claim back with everything
  -- else, so a rejected call never burns its nonce.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('public.money_nonces'), pg_catalog.hashtext(p_nonce));

    -- New statement, new snapshot: an earlier holder has by now either
    -- committed (row visible → this is a replay) or rolled back (row gone →
    -- the nonce is free again).
    SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      IF v_prior = '{}'::jsonb THEN
        -- The placeholder below is written and overwritten inside ONE
        -- transaction, so it can never be seen committed. Refuse rather than
        -- hand the member an empty receipt.
        RAISE EXCEPTION 'this payment is still being processed; try again in a moment'
          USING ERRCODE = 'P0001';
      END IF;
      RETURN v_prior;
    END IF;

    INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result)
    VALUES (p_nonce, v_subscriber_id, 'contribution', '{}'::jsonb);
  END IF;

  -- NaN/Infinity here already fall back to 80 (both are > 100 in Postgres'
  -- ordering), so this branch was never the hole. Left exactly as it was.
  v_ret_pct := COALESCE(p_retirement_pct, 80);
  IF v_ret_pct < 0 OR v_ret_pct > 100 THEN
    v_ret_pct := 80;
  END IF;
  v_retirement := round(p_amount * v_ret_pct / 100);
  v_emergency  := p_amount - v_retirement;

  -- 0114: the legs are what the balance trigger actually adds to each bucket.
  -- Derived from an amount that is already finite and whole, so this can only
  -- fire if the derivation above is ever changed.
  PERFORM public.assert_finite_money(v_retirement, 'retirement share', 0, 100000000, true);
  PERFORM public.assert_finite_money(v_emergency,  'savings share',    0, 100000000, true);

  v_ref   := 'CT-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  v_tx_id := 'tx-' || v_subscriber_id || '-adhoc-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, status, method,
    txn_ref, split_retirement, split_emergency, source
  ) VALUES (
    v_tx_id, v_subscriber_id, 'contribution', p_amount, now(), 'settled', p_method,
    v_ref, v_retirement, v_emergency, 'own'
  );

  -- 0147: read back what the stamp trigger decided. The success panel needs to
  -- know whether "your money is now working for you" is actually true.
  SELECT dealing_date, pricing_status INTO v_tx_dealing, v_tx_status
    FROM public.transactions WHERE id = v_tx_id;

  v_result := jsonb_build_object(
    'dealingDate',     to_char(v_tx_dealing, 'YYYY-MM-DD'),
    'pricingStatus',   v_tx_status,
    'id',              v_tx_id,
    'subscriberId',    v_subscriber_id,
    'type',            'contribution',
    'source',          'own',
    'amount',          p_amount,
    'date',            to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'status',          'settled',
    'method',          p_method,
    'reference',       v_ref,
    'splitRetirement', v_retirement,
    'splitEmergency',  v_emergency
  );

  -- 0115 [A04-011]: the row already exists — it was claimed before the money
  -- moved. Publish the real receipt onto it. No ON CONFLICT: this UPDATE
  -- cannot conflict with anything, and a silent no-op here would be the same
  -- class of bug the DO NOTHING above was.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    UPDATE public.money_nonces SET result = v_result WHERE nonce = p_nonce;
  END IF;

  RETURN v_result;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11) publish_nav_snapshot - a publish now releases its queue
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_nav_snapshot(p_nav_date date, p_unit_price numeric, p_fund_code text DEFAULT 'UPU-BAL'::text, p_source text DEFAULT 'admin_manual'::text, p_confirm_move boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role       TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_actor      TEXT := COALESCE((SELECT auth.jwt()) ->> 'name', 'admin');
  v_prev_price NUMERIC;
  v_prev_date  DATE;
  v_book_price NUMERIC;   -- 0116/A04-003: the price the BOOK is carried at
  v_move       NUMERIC := NULL;
  v_newest     DATE;
  v_is_newest  BOOLEAN;
  v_id         TEXT;
  v_units      NUMERIC;
  v_aum        NUMERIC;
  v_members    INTEGER;
  v_version    INTEGER;   -- 0145
  v_version_id TEXT;      -- 0145
  v_engine     jsonb;     -- 0147
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot publish a unit price', v_role USING ERRCODE = 'P0001';
  END IF;
  -- 0116 / A04-005 — the guard that stood here was INERT against NaN.
  -- `'NaN'::numeric <= 0` is FALSE in Postgres because NaN sorts ABOVE every
  -- numeric, so a NaN price walked straight past it and, with p_confirm_move,
  -- drove all 5,060 subscriber_balances rows to NaN in one statement.
  -- 0114's shared guard rejects NULL / NaN / +-Infinity by EXPLICIT EQUALITY,
  -- which is the only form that works (`NOT (x > 0)` does not fire either).
  -- 0114's nav_snapshots_unit_price_finite_chk is the table-level backstop;
  -- this call exists so the admin reads a sentence, not a constraint violation.
  -- p_whole_shillings => false: a unit price legitimately carries decimals.
  PERFORM public.assert_finite_money(p_unit_price, 'unit price', 0.01, 1000000, false);

  -- 0116 / A04-015 (server half) — this database's session timezone is UTC
  -- (verified live) but the fund prices on the Kampala calendar (UTC+3, no
  -- DST). Between 00:00 and 03:00 local, CURRENT_DATE is still YESTERDAY, so
  -- this guard rejected a perfectly legitimate same-day publish. The client
  -- half of A04-015 lives in AdminNavDesktop.jsx and is fixed in 0145's
  -- frontend commit.
  IF p_nav_date IS NULL OR p_nav_date > public.kampala_today() THEN
    RAISE EXCEPTION 'cannot publish a price for a future date' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise concurrent publishes on this fund so two admins cannot interleave
  -- a revaluation between each other's register write.
  PERFORM 1 FROM public.nav_snapshots
   WHERE fund_code = p_fund_code FOR UPDATE;

  SELECT unit_price, nav_date INTO v_prev_price, v_prev_date
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published' AND nav_date < p_nav_date
   ORDER BY nav_date DESC LIMIT 1;

  IF v_prev_price IS NOT NULL AND v_prev_price > 0 THEN
    v_move := round(((p_unit_price - v_prev_price) / v_prev_price) * 100, 4);
    -- Server-side guard-rail. The client confirm dialog is a courtesy; THIS is
    -- the gate, so a scripted or replayed call cannot skip it.
    IF abs(v_move) > 10 AND NOT p_confirm_move THEN
      RAISE EXCEPTION
        'price move of %%% from % on % needs confirmation',
        round(v_move, 2), v_prev_price, v_prev_date
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 0116 / A04-003 — capture the price the BOOK is currently carried at BEFORE
  -- the register write below moves the published frontier. After the INSERT
  -- this row IS the newest published price, so the comparison would be against
  -- itself and prove nothing.
  SELECT unit_price INTO v_book_price
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  -- Re-publishing a day CORRECTS it, and flips a 'pending' day to 'published' —
  -- which is exactly how the admin clears a "Delayed NAV updation" signal.
  INSERT INTO public.nav_snapshots
    (fund_code, nav_date, unit_price, status, published_at, source, published_by)
  VALUES
    (p_fund_code, p_nav_date, p_unit_price, 'published', now(), p_source, v_actor)
  ON CONFLICT (fund_code, nav_date) DO UPDATE SET
    unit_price   = EXCLUDED.unit_price,
    status       = 'published',
    published_at = now(),
    source       = EXCLUDED.source,
    published_by = EXCLUDED.published_by
  RETURNING id INTO v_id;

  -- 0145 (i): append the new version, then stamp every older current version as
  -- superseded BY it. The UPDATE runs second and excludes v_version itself, so
  -- the row just written stays current. Nothing is ever overwritten here — the
  -- ON CONFLICT above is the only destructive write left, and this table is
  -- what makes it recoverable.
  SELECT COALESCE(max(version_no), 0) + 1 INTO v_version
    FROM public.nav_snapshot_versions WHERE snapshot_id = v_id;

  INSERT INTO public.nav_snapshot_versions
    (snapshot_id, fund_code, nav_date, unit_price, status, source, published_by, published_at, version_no)
  VALUES
    (v_id, p_fund_code, p_nav_date, p_unit_price, 'published', p_source, v_actor, now(), v_version)
  RETURNING id INTO v_version_id;

  UPDATE public.nav_snapshot_versions
     SET superseded_at = now(), superseded_by = v_version_id
   WHERE snapshot_id = v_id AND version_no < v_version AND superseded_at IS NULL;

  -- Revalue ONLY when this is now the newest published day. A back-dated
  -- correction must not restate today's book at a stale price.
  SELECT max(nav_date) INTO v_newest
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published';
  v_is_newest := (v_newest = p_nav_date);

  IF v_is_newest AND p_fund_code = 'UPU-BAL' THEN
    -- 0116 / A04-003 — REFUSE rather than silently revalue units that were
    -- never priced at a real NAV. A reseed writes units at the dead 1,000 UGX
    -- literal and leaves both bucket-unit columns at their 0 default; the next
    -- publish then multiplied those units by the real NAV and inflated AUM 57%
    -- while zeroing every member's retirement pot. Everything below this line
    -- is a whole-book rewrite, so this is the last place to stop it.
    PERFORM public.assert_book_revaluable(p_fund_code, v_book_price);

    -- Complement rule: round the total and the retirement leg, then take
    -- emergency as the difference. Rounding all three independently is what
    -- would trip v_reconciliation_exceptions.split_mismatch across 5,060 rows.
    UPDATE public.subscriber_balances
       SET total_balance      = round(units * p_unit_price),
           retirement_balance = round(retirement_units * p_unit_price),
           emergency_balance  = round(units * p_unit_price)
                                - round(retirement_units * p_unit_price),
           nav_as_of          = p_nav_date,
           updated_at         = now()
     WHERE subscriber_id IS NOT NULL;

    -- 0072 [H3] parity: a NAV fall can push emergency_balance below an already
    -- accrued save-to-cover target, which would let the next contribution sweep
    -- money that is no longer in the bucket. Same clamp request_withdrawal does.
    UPDATE public.contribution_schedules s
       SET insurance_premium_accrued = LEAST(
             s.insurance_premium_accrued,
             GREATEST(0, (SELECT b.emergency_balance FROM public.subscriber_balances b
                           WHERE b.subscriber_id = s.subscriber_id))),
           updated_at = now()
     WHERE s.insurance_funding_mode = 'save_to_cover';

    -- Denormalised per-member copy of the fund price. Permitted because the
    -- editable-columns trigger returns early for a non-'subscriber' role.
    UPDATE public.subscribers
       SET current_unit_value = p_unit_price,
           unit_value_as_of   = now()
     WHERE id IS NOT NULL;
  END IF;

  -- ══ 0147 · RELEASE THE QUEUE ══════════════════════════════════════════════
  -- OUTSIDE the `IF v_is_newest` block above, and that placement is the whole
  -- point. A BACK-DATED publish — filling a day the fund skipped — is precisely
  -- the event that makes a stalled queue priceable. Inside the block, a
  -- back-dated correction releases NOTHING: the price lands, the queued rows
  -- stay pending with unit_price_applied NULL, and that money never allocates.
  -- Reproduced as a live failure before this design was accepted.
  --
  -- Unbounded (NULL): the revaluation above has already row-locked all 5,060
  -- balance rows in this transaction, so the engine's per-member locks cost
  -- nothing extra, and a cap here would strand the rest of a large queue until
  -- the next publish.
  --
  -- The engine no-ops when pricing_enabled is false, so this is inert until the
  -- switch is flipped.
  v_engine := public.price_pending_transactions(p_fund_code, NULL);

  -- AFTER the engine, deliberately: these figures are stamped onto the register
  -- row as the fund's size on this valuation day. Reading them before the queue
  -- was released would record a book one queue out of date.
  SELECT COALESCE(sum(units), 0), COALESCE(sum(total_balance), 0), count(*)
    INTO v_units, v_aum, v_members
    FROM public.subscriber_balances;

  UPDATE public.nav_snapshots
     SET units_in_issue = v_units, aum = v_aum, members_priced = v_members
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'id',                v_id,
    'fundCode',          p_fund_code,
    'navDate',           to_char(p_nav_date, 'YYYY-MM-DD'),
    'unitPrice',         p_unit_price,
    'previousUnitPrice', v_prev_price,
    'previousNavDate',   to_char(v_prev_date, 'YYYY-MM-DD'),
    'changePct',         v_move,
    'revalued',          v_is_newest,
    'unitsInIssue',      v_units,
    'aum',               v_aum,
    'membersPriced',     v_members,
    -- 0145 (ii): 1 on a first publish, 2+ on a correction.
    'priceVersion',           v_version,
    -- 0145 (iii): wired to price_pending_transactions() in 0147. Zero here,
    -- because nothing can be pending until the engine exists.
    'releasedContributions',  COALESCE((v_engine ->> 'contributions')::int, 0),
    'releasedRedemptions',    COALESCE((v_engine ->> 'redemptions')::int, 0),
    'rejectedRedemptions',    COALESCE((v_engine ->> 'rejected')::int, 0)
  );
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 12) v_reconciliation_exceptions — nav_mismatch must not go quiet
-- ─────────────────────────────────────────────────────────────────────────────
-- The check reads `abs(total_balance - round(units * latest_nav())) > 1`. With
-- an empty register latest_nav() is NULL, the whole comparison is NULL, and the
-- check SILENTLY PASSES for every member — the reconciliation surface would
-- report a clean book precisely when it can prove nothing. Guarded explicitly.
--
-- Every other check is reproduced verbatim. They all read allocated-only
-- columns, so the six pending components do not affect any of them: a member
-- with money in flight still satisfies retirement + emergency = total, because
-- pending money is not in any of those three.
CREATE OR REPLACE VIEW public.v_reconciliation_exceptions AS
 SELECT 'user'::text AS kind, 'missing_balance'::text AS check_code,
    'Member has no balance record'::text AS issue,
    s.id AS ref_id, s.name AS who, s.id AS subscriber_id,
    NULL::numeric AS amount, NULL::date AS occurred_on
   FROM subscribers s LEFT JOIN subscriber_balances b ON b.subscriber_id = s.id
  WHERE b.subscriber_id IS NULL
UNION ALL
 SELECT 'user'::text, 'split_mismatch'::text,
    'Retirement + emergency does not equal total balance'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    b.retirement_balance + b.emergency_balance - b.total_balance, b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(b.retirement_balance + b.emergency_balance - b.total_balance) > 1::numeric
UNION ALL
 SELECT 'transaction'::text, 'orphan_subscriber'::text,
    'Transaction references a member that no longer exists'::text,
    t.id, COALESCE(t.subscriber_id, '—'::text), t.subscriber_id, t.amount, t.date::date
   FROM transactions t LEFT JOIN subscribers s ON s.id = t.subscriber_id
  WHERE s.id IS NULL
UNION ALL
 SELECT 'transaction'::text, 'orphan_run'::text,
    'Transaction references a contribution run that no longer exists'::text,
    t.id, COALESCE(s.name, '—'::text), t.subscriber_id, t.amount, t.date::date
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
     LEFT JOIN contribution_runs r ON r.id = t.contribution_run_id
  WHERE t.contribution_run_id IS NOT NULL AND r.id IS NULL
UNION ALL
 SELECT 'transaction'::text, 'agent_mismatch'::text,
    'Transaction credited to an agent who does not own this member'::text,
    t.id, s.name, t.subscriber_id, t.amount, t.date::date
   FROM transactions t JOIN subscribers s ON s.id = t.subscriber_id
  WHERE t.agent_id IS NOT NULL AND t.agent_id IS DISTINCT FROM s.agent_id
UNION ALL
 SELECT 'user'::text, 'unit_split_mismatch'::text,
    'Retirement + savings units do not add up to the member''s total units'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units,
    b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units) > 0.000001
UNION ALL
 SELECT 'user'::text, 'nav_mismatch'::text,
    'Balance does not match the member''s units at the published unit price'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    b.total_balance - round(b.units * (SELECT latest_nav())), b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  -- 0147: the NULL guard. Without it an empty register makes the comparison
  -- NULL and this check passes for everyone, reporting a clean book at the one
  -- moment it cannot verify anything.
  WHERE (SELECT latest_nav()) IS NOT NULL
    AND abs(b.total_balance - round(b.units * (SELECT latest_nav()))) > 1::numeric
UNION ALL
 SELECT 'user'::text, 'negative_balance'::text,
    'A balance or unit holding has gone below zero'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    LEAST(b.retirement_balance, b.emergency_balance, b.total_balance, b.units, COALESCE(b.invested, 0::numeric)),
    b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance < 0::numeric OR b.emergency_balance < 0::numeric
     OR b.total_balance < 0::numeric OR b.units < 0::numeric
     OR COALESCE(b.invested, 0::numeric) < 0::numeric
     OR COALESCE(b.retirement_units, 0::numeric) < '-0.000001'::numeric
     OR COALESCE(b.emergency_units, 0::numeric) < '-0.000001'::numeric
     -- 0147: the six new components are money. A negative one means the engine
     -- released more than was ever booked, and it must surface here.
     OR b.pending_contribution_retirement < 0::numeric
     OR b.pending_contribution_emergency  < 0::numeric
     OR b.pending_payout_retirement       < 0::numeric
     OR b.pending_payout_emergency        < 0::numeric
     OR b.pending_redemption_retirement   < 0::numeric
     OR b.pending_redemption_emergency    < 0::numeric
UNION ALL
 SELECT 'user'::text, 'non_finite_balance'::text,
    'A balance is not a real number'::text,
    b.subscriber_id, s.name, b.subscriber_id, NULL::numeric, b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance = 'NaN'::numeric OR b.emergency_balance = 'NaN'::numeric
     OR b.total_balance = 'NaN'::numeric OR b.units = 'NaN'::numeric
     OR COALESCE(b.invested, 0::numeric) = 'NaN'::numeric
     OR COALESCE(b.retirement_units, 0::numeric) = 'NaN'::numeric
     OR COALESCE(b.emergency_units, 0::numeric) = 'NaN'::numeric
     OR b.retirement_balance = 'Infinity'::numeric OR b.emergency_balance = 'Infinity'::numeric
     OR b.total_balance = 'Infinity'::numeric OR b.units = 'Infinity'::numeric
UNION ALL
 -- 0147: the pending components must tie back to the ledger rows that created
 -- them. This is the tie-out that catches an engine that released a hold
 -- without cancelling units, or a booking trigger that credited a component
 -- twice — neither of which any allocated-only check above can see.
 SELECT 'user'::text, 'pending_component_mismatch'::text,
    'Money recorded as in-process does not match the transactions behind it'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    (b.pending_contribution_retirement + b.pending_contribution_emergency)
      - COALESCE(l.pending_in, 0), b.updated_at::date
   FROM subscriber_balances b
   JOIN subscribers s ON s.id = b.subscriber_id
   LEFT JOIN LATERAL (
     SELECT COALESCE(sum(t.amount), 0) AS pending_in
       FROM transactions t
      WHERE t.subscriber_id = b.subscriber_id
        AND t.type = 'contribution' AND t.pricing_status = 'pending') l ON true
  WHERE abs((b.pending_contribution_retirement + b.pending_contribution_emergency)
            - COALESCE(l.pending_in, 0)) > 1::numeric;


-- ─────────────────────────────────────────────────────────────────────────────
-- 13) Grants
-- ─────────────────────────────────────────────────────────────────────────────
-- price_pending_transactions is NOT granted to anyone. It moves money for
-- arbitrary members and is called only from DEFINER code (the two money RPCs
-- and publish_nav_snapshot). run_pending_pricing is the admin-gated door.
REVOKE ALL ON FUNCTION public.price_pending_transactions(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

REVOKE ALL     ON FUNCTION public.run_pending_pricing(INTEGER)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.run_pending_pricing(INTEGER)          TO authenticated;
REVOKE ALL     ON FUNCTION public.get_pending_pricing_summary(TEXT)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pending_pricing_summary(TEXT)     TO authenticated;
REVOKE ALL     ON FUNCTION public.settle_withdrawal(TEXT)               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_withdrawal(TEXT)               TO authenticated;
REVOKE ALL ON FUNCTION public.trg_transactions_stamp_dealing()          FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 14) Self-check — the flag must still be OFF when this migration commits
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_on BOOLEAN;
BEGIN
  SELECT pricing_enabled INTO v_on FROM public.fund_dealing_config WHERE fund_code = 'UPU-BAL';
  IF v_on THEN
    RAISE EXCEPTION 'ABORT 0147: pricing_enabled is TRUE. This migration must land with the switch OFF so the flip is a separate, deliberate, reversible act.'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '0147 OK - async pricing engine deployed, kill switch OFF';
END $$;
