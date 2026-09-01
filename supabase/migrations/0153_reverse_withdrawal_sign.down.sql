-- DOWN for 0153_reverse_withdrawal_sign.sql
-- ============================================================================
-- Restores reverse_transaction() to its 0152 body, verbatim.
--
-- ⚠️ REGRESSION WARNING — THIS REINSTATES A MONEY BUG.
-- 0153 exists because reversing a WITHDRAWAL wrote its compensating row with
-- the wrong sign: money that had never actually left was recorded as leaving
-- again, so a cancelled withdrawal debited the member a second time instead of
-- putting the amount back. 0153 derives the sign from the original row's own
-- amount (`CASE WHEN v_tx.amount >= 0 THEN -1 ELSE 1 END`) rather than assuming
-- the direction, and types the row 'reversal'. This puts the assumption back.
--
-- ⚠️ ALSO SILENTLY UNDOES 0154 (cost-basis restoration on reversal), because
-- both migrations rewrite this same function and this restores a body that
-- predates it. See docs/runbooks/nav-publishing.md for the full table of what
-- each down migration takes with it.
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
  v_new_id := 'tx-' || v_tx.subscriber_id || '-rev-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, received_at, status, method, txn_ref, source,
    split_retirement, split_emergency, dealing_date, pricing_status,
    unit_price_applied, units_delta, nav_snapshot_id, priced_at
  ) VALUES (
    v_new_id, v_tx.subscriber_id, v_tx.type, -v_tx.amount, now(), now(), 'settled',
    v_tx.method, 'RV-' || COALESCE(v_tx.txn_ref, ''), v_tx.source,
    -v_ret, -v_emg, v_tx.dealing_date, 'priced',
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
