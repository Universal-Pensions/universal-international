-- DOWN for 0154_reverse_restores_cost_basis.sql
-- ============================================================================
-- Restores reverse_transaction() to its 0153 body, verbatim.
--
-- ⚠️ REGRESSION WARNING — THIS REINSTATES A MONEY BUG.
-- 0154 exists because reversing a priced contribution took the units back out
-- but left `invested` (the member's cost basis) at its full pre-reversal value.
-- The member kept the cost of savings they no longer owned, so their growth
-- percentage — and every rollup built on it — understated reality, permanently
-- and silently. Running this down migration puts that behaviour back.
--
-- It also removes 0154's guard against dividing by zero units, so a reversal
-- that empties a member's holding raises instead of corrupting the basis.
--
-- Run this ONLY to reach the exact post-0153 state, and only knowing that any
-- reversal performed afterwards will inflate the cost basis again.
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
    -- they were sold at. Cost basis is restored proportionally, mirroring the
    -- average-cost reduction the sale applied.
    UPDATE public.subscriber_balances
       SET units              = units - v_units,          -- v_units is negative
           invested           = invested + abs(v_tx.amount),
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
