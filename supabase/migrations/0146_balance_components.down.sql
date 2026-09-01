-- DOWN for 0146_balance_components.sql
-- ============================================================================
-- Drops the six pending-component columns.
--
-- ⚠️ SAFE ONLY WHILE THEY ARE ALL ZERO. Verify before running:
--     SELECT count(*) FROM public.subscriber_balances
--      WHERE pending_contribution_retirement <> 0 OR pending_contribution_emergency <> 0
--         OR pending_payout_retirement       <> 0 OR pending_payout_emergency       <> 0
--         OR pending_redemption_retirement   <> 0 OR pending_redemption_emergency   <> 0;
--   A non-zero result means real member money is recorded in these columns and
--   ONLY in these columns: contributions received but not yet allocated, and
--   redemptions struck but not yet paid. Dropping them DESTROYS that money with
--   no other record on the balance row. Set fund_dealing_config.pricing_enabled
--   = false, drain the queue with run_pending_pricing(), confirm the query above
--   returns 0, and only then run this.
--
-- The transactions ledger still holds the underlying rows, so the state is
-- reconstructible in principle — but not by this file, and not automatically.
-- ============================================================================

DO $$
DECLARE v_live INTEGER;
BEGIN
  SELECT count(*) INTO v_live FROM public.subscriber_balances
   WHERE pending_contribution_retirement <> 0 OR pending_contribution_emergency <> 0
      OR pending_payout_retirement       <> 0 OR pending_payout_emergency       <> 0
      OR pending_redemption_retirement   <> 0 OR pending_redemption_emergency   <> 0;
  IF v_live > 0 THEN
    RAISE EXCEPTION 'ABORT: % member(s) hold money in the pending components. Dropping these columns would destroy it. Disable pricing, drain the queue, then retry.', v_live
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE public.subscriber_balances
  DROP COLUMN IF EXISTS pending_contribution_retirement,
  DROP COLUMN IF EXISTS pending_contribution_emergency,
  DROP COLUMN IF EXISTS pending_payout_retirement,
  DROP COLUMN IF EXISTS pending_payout_emergency,
  DROP COLUMN IF EXISTS pending_redemption_retirement,
  DROP COLUMN IF EXISTS pending_redemption_emergency;
