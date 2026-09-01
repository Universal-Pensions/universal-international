-- 0161_engine_rereads_book_price_under_lock.sql
-- ============================================================================
-- A CONCURRENT PUBLISH COULD LEAVE ONE MEMBER MARKED AT A PRICE THE BOOK NO
-- LONGER CARRIES. Found by the second audit pass.
--
-- The engine read the book carrying price ONCE, at entry, and then used that
-- cached value per row to decide whether to re-mark and what to re-mark to.
-- That is safe only if the book price cannot change between entry and use. It
-- can:
--
--   * The engine is not confined to a publish transaction. There is no
--     scheduler BY DESIGN, so make_contribution and request_withdrawal each
--     nudge it inside their own transaction, and run_pending_pricing is a third
--     caller.
--   * publish_nav_snapshot takes no lock those callers also take. Its
--     `nav_snapshots ... FOR UPDATE` serialises publishes against each OTHER;
--     the engine reads prices with plain SELECTs and is not held by it.
--   * The database runs READ COMMITTED (verified live), so each statement in
--     the engine takes a fresh snapshot.
--
-- The interleaving is ordinary, not exotic: a member's contribution nudges the
-- engine, which reads the book price as P_old and then blocks on
-- `subscriber_balances ... FOR UPDATE` — a publish in flight holds every
-- balance row from its revaluation onward. The publish commits at P_new. The
-- member's engine call resumes, and re-marks that member to P_old.
--
-- The publish has already moved all 5,060 other members to P_new, so exactly
-- one member is left carrying a stale price. It raises nav_mismatch for them,
-- the aggregate publish gate cannot see a single-member break (measured at
-- 0.0000% drift for a comparable one earlier in this work), and nothing repairs
-- it until the next newest-day publish.
--
-- THE FIX is to read the book price INSIDE the loop, immediately before the
-- re-mark, while the member's balance row is still held by step (a)'s
-- FOR UPDATE. Any publish that could change the book price must acquire that
-- same row, so it either committed before this read — and we see P_new — or it
-- cannot commit until we release, in which case we are the ones setting the
-- price. The entry read is kept only as a starting value.
--
-- ROLLBACK: 0161_engine_rereads_book_price_under_lock.down.sql restores the
-- cached read.
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
  -- Read once for the skip-fast path below; the AUTHORITATIVE read happens per
  -- row, under the member's lock. See the re-mark step.
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
    -- ⚠️ RE-READ THE BOOK PRICE HERE, under the member's row lock.
    --
    -- Reading it once at entry is not safe. The engine is NOT confined to a
    -- publish transaction: make_contribution and request_withdrawal each nudge
    -- it (there is no scheduler, by design), and publish_nav_snapshot takes no
    -- lock those callers also take — its `nav_snapshots ... FOR UPDATE`
    -- serialises publishes against each other only, while the engine reads
    -- prices with plain SELECTs.
    --
    -- Under READ COMMITTED a member RPC can therefore: read the book price as
    -- P_old, block on `subscriber_balances ... FOR UPDATE` (a publish holds
    -- every balance row from its revaluation onward), resume after that publish
    -- commits, and then re-mark the member to P_old — a price the book no
    -- longer carries. The revaluation has already moved everyone else to P_new,
    -- so that one member is left behind, and nothing self-heals them until the
    -- NEXT newest-day publish.
    --
    -- Re-reading while the row lock is held closes it: any publish that could
    -- change the book price must first acquire this same row, so it either
    -- committed before this read (and we see P_new) or cannot commit until we
    -- release (and we are the ones setting the price).
    SELECT n.unit_price, n.nav_date INTO v_book_price, v_book_date
      FROM public.nav_snapshots n
     WHERE n.fund_code = p_fund AND n.status = 'published'
     ORDER BY n.nav_date DESC LIMIT 1;

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

