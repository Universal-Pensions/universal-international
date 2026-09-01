-- 0154_reverse_restores_cost_basis.sql
-- ============================================================================
-- reverse_transaction() INFLATED A MEMBER'S COST BASIS when undoing a
-- withdrawal. Found by measuring a full round trip, not by a failure — every
-- other figure came back exactly right, which is what made it easy to miss.
--
-- THE DEFECT
-- A redemption reduces `invested` by AVERAGE COST: it multiplies the basis by
-- units_after / units_before, so the basis removed is proportional to the UNITS
-- sold, not equal to the CASH taken out. The two coincide only when the unit
-- price exactly equals the member's average cost.
--
-- The reversal added back `abs(amount)` — the cash figure. So a withdraw-then-
-- reverse round trip left the member with MORE cost basis than they started
-- with. Measured: units returned to the baseline exactly (delta 0.00000000),
-- total_balance returned exactly (delta 0), and `invested` came back
-- **+2,654 UGX** on a 20,000 UGX withdrawal.
--
-- WHY THAT MATTERS beyond the number: `invested` is the denominator of every
-- growth figure the platform shows. growth = total_balance - invested, and
-- growthPct = growth / invested. An inflated basis permanently UNDERSTATES a
-- member's return, on the admin NAV page (avgGrowthPct), on their own dashboard,
-- and in every export — and it never self-corrects, because nothing recomputes
-- basis from history.
--
-- THE FIX is the exact inverse of the sale: scale by
-- units_before / units_after rather than adding the cash back.
--
-- THE ONE CASE THAT CANNOT BE FIXED, and now says so: if the redemption took the
-- member's ENTIRE holding, units_after is 0 and `invested` was set to 0. The
-- ratio is undefined and the original basis is genuinely unrecoverable from the
-- ledger — nothing records it. The function now REFUSES that reversal with an
-- explanation rather than inventing a figure. That is a real limitation, not an
-- oversight: restoring it needs a balance snapshot.
--
-- Contribution reversals are unaffected — subtracting the contribution's own
-- amount is exact, because that is precisely what was added.
--
-- ROLLBACK: 0154_reverse_restores_cost_basis.down.sql restores the previous
-- body, which inflates the basis.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reverse_transaction(p_transaction_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tx      public.transactions%ROWTYPE;
  v_bal     public.subscriber_balances%ROWTYPE;
  v_ret     NUMERIC;
  v_emg     NUMERIC;
  v_units   NUMERIC;
  v_new_id  TEXT;
  v_sign    INTEGER;   -- 0153: direction of the compensating entry
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can reverse a transaction' USING ERRCODE = 'P0001';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reversal needs a reason - it is written to the ledger' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No transaction %', p_transaction_id USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.pricing_status = 'reversed' THEN
    RAISE EXCEPTION 'Transaction % has already been reversed', p_transaction_id USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.pricing_status = 'pending' THEN
    -- Nothing has been allocated, so there is nothing to unwind. Cancelling a
    -- pending row is a different operation with a different question attached
    -- (the money has already left the member's wallet - see plan D4), and
    -- pretending this is that would quietly strand their cash.
    RAISE EXCEPTION 'Transaction % has not been priced yet, so there is nothing to reverse. It deals on %.',
      p_transaction_id, to_char(v_tx.dealing_date, 'YYYY-MM-DD') USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.units_delta IS NULL OR v_tx.unit_price_applied IS NULL THEN
    RAISE EXCEPTION 'Transaction % predates the pricing audit trail: the price and unit count it was struck at were never recorded, so it cannot be unwound exactly. Adjust the member manually and record why.',
      p_transaction_id USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_bal FROM public.subscriber_balances
   WHERE subscriber_id = v_tx.subscriber_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member % has no balance record to reverse against', v_tx.subscriber_id
      USING ERRCODE = 'P0001';
  END IF;

  v_units := v_tx.units_delta;                       -- signed as originally applied
  v_ret   := COALESCE(v_tx.split_retirement, 0);
  v_emg   := COALESCE(v_tx.split_emergency, abs(v_tx.amount) - COALESCE(v_tx.split_retirement, 0));

  IF v_tx.type = 'contribution' THEN
    UPDATE public.subscriber_balances
       SET units              = GREATEST(0, units - v_units),
           invested           = GREATEST(0, invested - v_tx.amount),
           retirement_balance = GREATEST(0, retirement_balance - v_ret),
           emergency_balance  = GREATEST(0, emergency_balance  - v_emg),
           total_balance      = GREATEST(0, retirement_balance - v_ret)
                              + GREATEST(0, emergency_balance  - v_emg),
           updated_at         = now()
     WHERE subscriber_id = v_tx.subscriber_id;
  ELSE
    -- A redemption: give the units back and restore the value at the SAME price
    -- they were sold at.
    --
    -- ⚠️ COST BASIS IS RESTORED BY RATIO, NOT BY FACE VALUE. The sale applied an
    --    AVERAGE-COST reduction — it multiplied `invested` by
    --    units_after / units_before — so the basis it removed is almost never
    --    equal to the cash amount withdrawn. Adding abs(amount) back, as this
    --    function originally did, therefore INFLATES the member's cost basis and
    --    permanently understates their growth. Measured on a 20,000 UGX
    --    withdrawal: basis came back 2,654 UGX too high.
    --
    --    The exact inverse is to scale by units_before / units_after. Here the
    --    pre-UPDATE `units` IS units_after, and units_before = units - v_units
    --    (v_units is negative for a redemption), so the factor below is exact.
    IF v_bal.units <= 0 THEN
      RAISE EXCEPTION
        'Transaction % redeemed this member''s ENTIRE holding, so their cost basis was reduced to zero and the original figure cannot be reconstructed from the ledger. Reverse it manually and restore `invested` from a balance snapshot.',
        p_transaction_id USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.subscriber_balances
       SET units              = units - v_units,          -- v_units is negative
           invested           = invested * (units - v_units) / units,
           retirement_balance = retirement_balance + v_ret,
           emergency_balance  = emergency_balance  + v_emg,
           total_balance      = retirement_balance + v_ret + emergency_balance + v_emg,
           -- If it was struck but never paid, the money owed goes away with it.
           pending_payout_retirement = GREATEST(0, pending_payout_retirement - v_ret),
           pending_payout_emergency  = GREATEST(0, pending_payout_emergency  - v_emg),
           updated_at         = now()
     WHERE subscriber_id = v_tx.subscriber_id;

    -- 0152: keyed on the FK. On `reference` this could flip up to four
    -- unrelated withdrawals to 'reversed' for the same member.
    UPDATE public.withdrawals SET status = 'reversed'
     WHERE transaction_id = p_transaction_id AND status IN ('processing', 'paid');
  END IF;

  -- Mandatory after any units move (deferrable constraint trigger, 23514).
  PERFORM public._resync_bucket_units(v_tx.subscriber_id);

  -- The compensating row. The ledger is append-only: SUM(amount) stays true and
  -- the member can see that something was undone, and why.
  -- 0153: the compensating row is type 'reversal', NOT the original type.
  --
  -- Reversing a WITHDRAWAL means money coming back, so the compensating amount
  -- is POSITIVE — and `transactions_withdrawal_sign_chk` (0114) requires every
  -- row typed 'withdrawal' to carry a NON-POSITIVE amount, precisely so that
  -- SUM(amount) over the ledger is true. Writing the compensating row with the
  -- original type therefore made reverse_transaction RAISE on every withdrawal:
  -- half of what this function exists to do had never worked, because Phase 7
  -- only ever tested it on a contribution.
  --
  -- 'reversal' matches neither money trigger's WHEN clause, is excluded from the
  -- pricing engine's candidate types, and is subject to no sign constraint - so
  -- it can carry either direction honestly. SUM(amount) stays true.
  --
  -- ⚠️ Aggregates that filter `type = 'contribution'` or `type = 'withdrawal'`
  --    do NOT see these rows. That is deliberate — a reversal is not a new
  --    contribution — but it means such an aggregate still counts the ORIGINAL,
  --    which is now flagged pricing_status = 'reversed'. Any total that must
  --    exclude undone money has to filter on pricing_status, not on type.
  v_sign   := CASE WHEN v_tx.amount >= 0 THEN -1 ELSE 1 END;
  v_new_id := 'tx-' || v_tx.subscriber_id || '-rev-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, received_at, status, method, txn_ref, source,
    split_retirement, split_emergency, dealing_date, pricing_status,
    unit_price_applied, units_delta, nav_snapshot_id, priced_at
  ) VALUES (
    v_new_id, v_tx.subscriber_id, 'reversal', -v_tx.amount, now(), now(), 'settled',
    v_tx.method, 'RV-' || COALESCE(v_tx.txn_ref, ''), v_tx.source,
    v_sign * v_ret, v_sign * v_emg, v_tx.dealing_date, 'priced',
    v_tx.unit_price_applied, -v_units, v_tx.nav_snapshot_id, now()
  );

  UPDATE public.transactions
     SET pricing_status = 'reversed'
   WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'reversed',      p_transaction_id,
    'compensatedBy', v_new_id,
    'reason',        p_reason,
    'unitsReturned', -v_units,
    'unitPrice',     v_tx.unit_price_applied
  );
END;
$function$;

