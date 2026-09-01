-- 0160_sweep_respects_redemption_hold.sql
-- ============================================================================
-- THE SAVE-TO-COVER SWEEP COULD SPEND MONEY A MEMBER HAD ALREADY ASKED FOR.
--
-- The sweep's eligibility test read the GROSS savings pot:
--     SELECT emergency_balance INTO v_emg_bal ...
--     IF v_new_accrued >= v_target AND v_emg_bal >= v_target THEN
-- and then debited the pot by the full annual premium.
--
-- But a pending withdrawal has already promised part of that pot to the member —
-- that is precisely what pending_redemption_emergency means, and every other
-- read in the system nets it off. The sweep did not.
--
-- WHY IT IS REACHABLE AND NOT MERELY THEORETICAL. The sweep runs at the
-- CONTRIBUTION's dealing date. A contribution received before the cutoff deals
-- today; a withdrawal requested after it deals tomorrow. So the sweep routinely
-- runs while a redemption hold is outstanding — the ordering is the normal case,
-- not a race.
--
-- THE OUTCOME WAS THE INDEFENSIBLE PART. The arithmetic stayed consistent:
-- balances tie, units tie, no guardrail trips. What happens instead is that the
-- member's own insurance quietly takes the money, and their withdrawal — the one
-- they asked for FIRST — is then REJECTED at its dealing date by the per-bucket
-- sufficiency check added in 0156. They would be told their withdrawal could not
-- be completed, with nothing on any screen connecting that to the premium.
--
-- Netting the hold off means the sweep simply waits. The accrual is preserved
-- (it is capped at target, never consumed), so it fires on a later contribution
-- once the redemption has cleared, and the request the member made first wins.
--
-- Only the ENGINE path needs this. The synchronous trigger cannot encounter a
-- hold at all — pending_redemption_* is only ever written while the kill switch
-- is on — so it is left untouched rather than given a subtraction that is
-- always zero.
--
-- ROLLBACK: 0160_sweep_respects_redemption_hold.down.sql restores the gross read.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.price_pending_transactions(p_fund text DEFAULT 'UPU-BAL'::text, p_max_rows integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg          public.fund_dealing_config%ROWTYPE;
  v_book_price   NUMERIC;
  v_book_date    DATE;
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
  SELECT n.unit_price, n.nav_date INTO v_book_price, v_book_date
    FROM public.nav_snapshots n
   WHERE n.fund_code = p_fund AND n.status = 'published'
   ORDER BY n.nav_date DESC LIMIT 1;

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
      -- ⚠️ PER-BUCKET, NOT JUST TOTAL UNITS.
      --    The hold is frozen at the amount the member was promised, but their
      --    POTS are revalued by every publish. A price FALL between request and
      --    dealing date can leave the requested pot worth less than the leg,
      --    even while the member still holds plenty of units overall — so a
      --    total-units check passes and the leg is applied anyway. The
      --    GREATEST(0, ...) clamps below then absorb the shortfall silently:
      --    total_balance drops by only what the pot held while `units` drops by
      --    the FULL amount/price, and the member is left carrying phantom value.
      --    Measured: a 30% fall against a 362,567 hold on a 381,650 savings pot
      --    left one member 95,411 UGX above units x price, with a nav_mismatch
      --    exception and no other sign anything had gone wrong.
      --
      --    Rejecting is the consistent answer, and the same one D8 already gives
      --    for the total: the amount the member confirmed can no longer be taken
      --    from the pot they chose, and silently paying out something else is
      --    worse than telling them. The 0.5 tolerance is one rounding step on
      --    whole shillings.
      IF v_units > v_bal.units + 0.000001
         OR v_ret_leg > v_bal.retirement_balance + 0.5
         OR v_emg_leg > v_bal.emergency_balance  + 0.5 THEN
        UPDATE public.subscriber_balances
           SET pending_redemption_retirement = GREATEST(0, pending_redemption_retirement - v_ret_leg),
               pending_redemption_emergency  = GREATEST(0, pending_redemption_emergency  - v_emg_leg),
               updated_at = now()
         WHERE subscriber_id = t.subscriber_id;

        UPDATE public.transactions
           SET pricing_status = 'rejected', priced_at = now()
         WHERE id = t.id AND pricing_status = 'pending';

        -- 0152: keyed on the FK, not on `reference`. The old predicate could
        -- match SEVERAL history rows for one member (221 members share a
        -- reference across up to 4 withdrawals), so rejecting one redemption
        -- could have rejected three unrelated ones with it.
        UPDATE public.withdrawals
           SET status = 'rejected'
         WHERE transaction_id = t.id AND status = 'processing';

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

          -- 0160: UNHELD savings, not the gross pot.
          --
          -- A pending withdrawal has already promised part of this pot to the
          -- member; that is exactly what pending_redemption_emergency means.
          -- Reading the gross balance let the save-to-cover sweep spend money
          -- the member had already asked for, and because the sweep runs at the
          -- CONTRIBUTION's dealing date it can fire BEFORE a redemption dealing
          -- a day later. The member's own insurance would then take the money
          -- and their withdrawal — requested first — would be rejected at its
          -- dealing date by the per-bucket check in 0156. Correct arithmetic,
          -- indefensible outcome.
          --
          -- Netting the hold off means the sweep simply waits. The accrual is
          -- preserved (it is capped at target, not consumed), so it fires on a
          -- later contribution once the redemption has cleared, and the request
          -- the member made first is the one that is honoured.
          SELECT GREATEST(0, emergency_balance - pending_redemption_emergency) INTO v_emg_bal
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
    -- (h) RE-MARK TO THE BOOK. LAST, DELIBERATELY. Only when this transaction dealt at a price that
    -- is not the newest published one — i.e. a back-dated publish just filled a
    -- hole and released a stalled queue. The member bought at the dealing
    -- price (correct, and theirs), but the book carries everyone at the newest
    -- price, and nav_mismatch asserts that within 1 UGX per member. Without
    -- this the released member is left off-book by the market movement between
    -- the two dates; measured at -9,150 UGX on a single release, while the
    -- aggregate publish gate showed 0.0000% drift and would never have caught it.
    IF v_book_price IS NOT NULL AND v_price <> v_book_price THEN
      UPDATE public.subscriber_balances
         SET nav_as_of          = v_book_date,
             total_balance      = round(units * v_book_price),
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
$function$;

