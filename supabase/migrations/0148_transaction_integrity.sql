-- 0148_transaction_integrity.sql
-- ============================================================================
-- PHASE 7 of the unitization redesign. Closing the AFTER-INSERT-only hole.
--
-- Every money trigger in this schema fires on INSERT and only on INSERT. So the
-- ledger and the book agree only as long as nobody ever UPDATEs or DELETEs a
-- transaction — and nothing has ever enforced that. Change an `amount` after
-- the fact and the balances do not move. Delete a contribution and the units it
-- bought stay bought, owned by nobody, priced into AUM forever. Neither leaves
-- a trace.
--
-- Two things land here: a guard that refuses those mutations, and
-- reverse_transaction() — a supported way to actually undo an allocation, which
-- is what makes the guard reasonable rather than merely obstructive.
--
-- WHO IS ALLOWED THROUGH, AND WHY
-- -------------------------------
-- The guard has exactly two escapes, and both are deliberate:
--
--   1. `SET LOCAL app.allow_transaction_mutation = 'on'` — for a migration or
--      an operator that genuinely needs to rewrite history (a data repair, a
--      purge). It is session-local, greppable, and impossible to trip over by
--      accident: you cannot desync the book without first saying that you meant
--      to.
--
--   2. DELETE issued as `service_role` through PostgREST. This is the E2E
--      suite's teardown and the seed tooling, and it is the SAME key that could
--      already drop the whole table. Blocking it here would not add security;
--      it would break the fixture cleanup whose absence is audit finding
--      A25-004 (test rows leaking into the live demo database permanently
--      unnoticed). Measured, not assumed: through PostgREST with the service
--      key, current_setting('role') is 'service_role'; from a migration or psql
--      it is not.
--
-- Note what is NOT exempt: a DEFINER RPC running as the owner. That is the
-- realistic accident — a future money function that "fixes up" a row — and it
-- is exactly what this guard exists to catch.
--
-- WHAT IS BLOCKED ON AN UPDATE
-- ----------------------------
-- Only the columns that DEFINE the money: amount, subscriber_id, type,
-- received_at, dealing_date, split_retirement, split_emergency, units_delta,
-- unit_price_applied. `date` is deliberately NOT among them — 0134, 0135 and
-- 0138 re-anchor demo dates and must keep working — and neither is
-- pricing_status, because the engine's whole job is to advance it.
--
-- ROLLBACK: 0148_transaction_integrity.down.sql drops both objects. Nothing
-- depends on them; the system simply goes back to being unguarded.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The guard
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_transactions_guard_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_override BOOLEAN := COALESCE(current_setting('app.allow_transaction_mutation', true), 'off') = 'on';
  v_role     TEXT    := COALESCE(current_setting('role', true), '');
BEGIN
  IF v_override THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Fixture teardown and seed tooling come through PostgREST as service_role.
    IF v_role = 'service_role' THEN
      RETURN OLD;
    END IF;
    IF OLD.pricing_status = 'priced' AND OLD.units_delta IS NOT NULL THEN
      RAISE EXCEPTION
        'Transaction % bought or sold units and cannot be deleted - deleting it would leave those units owned by nobody while they stay priced into AUM. Use public.reverse_transaction(%L, <reason>), which unwinds the allocation and leaves a compensating row.',
        OLD.id, OLD.id
        USING ERRCODE = 'P0001',
              HINT = 'A migration that genuinely must delete it can SET LOCAL app.allow_transaction_mutation = ''on'' first.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE. Only a change to a money-defining column on an allocated row is
  -- refused; advancing pricing_status, stamping a price, or re-anchoring `date`
  -- are all normal and stay legal.
  IF OLD.pricing_status = 'priced' AND (
       NEW.amount           IS DISTINCT FROM OLD.amount
    OR NEW.subscriber_id    IS DISTINCT FROM OLD.subscriber_id
    OR NEW.type             IS DISTINCT FROM OLD.type
    OR NEW.received_at      IS DISTINCT FROM OLD.received_at
    OR NEW.dealing_date     IS DISTINCT FROM OLD.dealing_date
    -- NULL -> value is the PRICING PATH FILLING IN A BLANK, not an edit. The
    -- synchronous contribution trigger stamps unit_price_applied and
    -- units_delta immediately after the insert, on a row the stamp trigger has
    -- already marked 'priced'; blocking that breaks every contribution while
    -- the kill switch is off. Measured, not theorised - the first version of
    -- this guard did exactly that and the probe caught it on the first insert.
    -- What must never happen is a SETTLED figure changing to a different one.
    OR (OLD.split_retirement   IS NOT NULL AND NEW.split_retirement   IS DISTINCT FROM OLD.split_retirement)
    OR (OLD.split_emergency    IS NOT NULL AND NEW.split_emergency    IS DISTINCT FROM OLD.split_emergency)
    OR (OLD.units_delta        IS NOT NULL AND NEW.units_delta        IS DISTINCT FROM OLD.units_delta)
    OR (OLD.unit_price_applied IS NOT NULL AND NEW.unit_price_applied IS DISTINCT FROM OLD.unit_price_applied)
  ) THEN
    RAISE EXCEPTION
      'Transaction % has already been priced; its amount, member, type, dates, split and unit figures are settled and cannot be edited. The balances were computed from these values and no trigger would recompute them.',
      OLD.id
      USING ERRCODE = 'P0001',
            HINT = 'Use public.reverse_transaction() and post a corrected row, or SET LOCAL app.allow_transaction_mutation = ''on'' for a deliberate repair.';
  END IF;

  -- A pending row whose receipt instant moves must re-derive its dealing date;
  -- leaving a stale one would price it on a day unrelated to when it arrived.
  IF OLD.pricing_status = 'pending'
     AND NEW.received_at IS DISTINCT FROM OLD.received_at
     AND NEW.dealing_date IS NOT DISTINCT FROM OLD.dealing_date THEN
    NEW.dealing_date := public.dealing_date_for(NEW.received_at);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_guard_mutation ON public.transactions;
CREATE TRIGGER transactions_guard_mutation
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_transactions_guard_mutation();

REVOKE ALL ON FUNCTION public.trg_transactions_guard_mutation() FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) reverse_transaction — the supported unwind
-- ─────────────────────────────────────────────────────────────────────────────
-- The first general unwind in this schema. 0110's employer-run purge is the
-- only prior art and it is a one-shot.
--
-- ⚠️ IT UNWINDS AT THE ROW'S OWN STRUCK PRICE, NEVER AT A CURRENT ONE. Reversing
--    a contribution at today's price would hand back a different number of units
--    than were issued, and the difference is a silent transfer between the
--    member and every other unit holder. `units_delta` and `unit_price_applied`
--    are recorded precisely so this is possible.
--
-- The ledger stays append-only: the original is marked `reversed` and a
-- compensating row is written, so SUM(amount) over the ledger remains true and
-- the reversal is itself visible in the member's history.
CREATE OR REPLACE FUNCTION public.reverse_transaction(
  p_transaction_id TEXT,
  p_reason         TEXT
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

    UPDATE public.withdrawals SET status = 'reversed'
     WHERE subscriber_id = v_tx.subscriber_id AND reference = v_tx.txn_ref
       AND status IN ('processing', 'paid');
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
$$;

REVOKE ALL     ON FUNCTION public.reverse_transaction(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reverse_transaction(TEXT, TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) A row that arrives already accounted for must not be accounted for twice
-- ─────────────────────────────────────────────────────────────────────────────
-- reverse_transaction() writes a COMPENSATING row of the same type with the
-- amount negated, so the ledger stays append-only and SUM(amount) stays true.
-- But `transactions_after_insert_contribution` fires on `new.type =
-- 'contribution'` alone — so that compensating row would fire the contribution
-- trigger and apply the money a SECOND time, in the opposite direction, on top
-- of the unwind the reversal just performed. The member would end up with the
-- reversal applied twice.
--
-- The discriminator is `units_delta`. A normal contribution or withdrawal
-- arrives with it NULL and the trigger (or the engine) fills it in afterwards.
-- A row that arrives ALREADY CARRYING its unit movement was written by
-- something that has already done the accounting — a reversal, or the
-- save-to-cover sweep marker. Expressing that in the trigger's WHEN clause is
-- both cheaper and clearer than a guard inside two long function bodies, and it
-- cannot be lost the next time either body is re-emitted from a stale copy.
DROP TRIGGER IF EXISTS transactions_after_insert_contribution ON public.transactions;
CREATE TRIGGER transactions_after_insert_contribution
  AFTER INSERT ON public.transactions
  FOR EACH ROW WHEN (new.type = 'contribution' AND new.units_delta IS NULL)
  EXECUTE FUNCTION public.trg_transactions_contribution();

DROP TRIGGER IF EXISTS transactions_after_insert_withdrawal ON public.transactions;
CREATE TRIGGER transactions_after_insert_withdrawal
  AFTER INSERT ON public.transactions
  FOR EACH ROW WHEN (new.type = 'withdrawal' AND new.units_delta IS NULL)
  EXECUTE FUNCTION public.trg_transactions_withdrawal();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) pending_orphan — money that has been waiting too long
-- ─────────────────────────────────────────────────────────────────────────────
-- The failure mode inverts with this project. Before it, a missing NAV silently
-- produced a WRONG price and nobody noticed for twelve days — which is exactly
-- the state the register was in when this work started. After it, a missing NAV
-- produces a visible queue of unallocated member money. That is strictly
-- better, but only if somebody is actually told.
--
-- This is the reconciliation half of that. The Needs-attention badge and the
-- NAV page tile are the other half.
CREATE OR REPLACE VIEW public.v_pending_pricing_orphans AS
  SELECT t.id AS ref_id,
         t.subscriber_id,
         s.name AS who,
         t.type,
         t.amount,
         t.dealing_date,
         (SELECT count(*) FROM generate_series(t.dealing_date, public.kampala_today(), INTERVAL '1 day') d
           WHERE public.is_business_day(d::date)) AS business_days_waiting
    FROM public.transactions t
    JOIN public.subscribers s ON s.id = t.subscriber_id
   WHERE t.pricing_status = 'pending';

REVOKE ALL    ON public.v_pending_pricing_orphans FROM PUBLIC, anon;
GRANT  SELECT ON public.v_pending_pricing_orphans TO authenticated;

COMMENT ON VIEW public.v_pending_pricing_orphans IS
  'Every transaction still waiting for a price, with how many BUSINESS days it has waited. Feeds the pending_orphan reconciliation check; a row past fund_dealing_config.max_pending_days is an operational fault, not a quirk.';
