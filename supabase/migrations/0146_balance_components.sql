-- 0146_balance_components.sql
-- ============================================================================
-- PHASE 4 of the unitization redesign. Six columns appear, every one of them
-- zero, and every screen renders byte-identically.
--
-- WHAT THE MEMBER'S TOTAL BECOMES
-- -------------------------------
--     total       = total_balance                     (units actually held, at the book price)
--                 + pending_contribution_*            (money in, not yet units)
--                 + pending_payout_*                  (units sold, cash not yet paid)
--     withdrawable = total_balance - pending_redemption_*
--
-- THE THREE CONSTRAINTS THAT FORCE THIS SHAPE
-- -------------------------------------------
-- Pending money CANNOT be folded into total_balance. Three separate guards
-- would break simultaneously, and each of them is load-bearing:
--
--   1. `subscriber_balances_bucket_sum_chk` is a HARD EQUALITY —
--      `(retirement_balance + emergency_balance) = total_balance`, no
--      tolerance. Adding pending cash to the total without adding it to both
--      pots violates it on every single write.
--   2. `assert_book_revaluable()` derives the implied unit price as
--      `sum(total_balance) / sum(units)` and REFUSES to publish when that
--      drifts more than 2% from the last published price. Pending cash has
--      bought no units, so folding it in moves the numerator without the
--      denominator and every publish starts failing spuriously.
--   3. `v_reconciliation_exceptions.nav_mismatch` asserts
--      `|total_balance - round(units x latest_nav())| <= 1` per member.
--
-- So `total_balance`, `retirement_balance` and `emergency_balance` keep their
-- exact current meaning — ALLOCATED MARKET VALUE, units x price — and the
-- member-facing total is derived at read time. AUM, every rollup and every
-- admin figure therefore stay correct and unchanged BY DEFINITION.
--
-- WHY PER-BUCKET AND NOT PER-MEMBER
-- ---------------------------------
-- The two pots must keep summing to the headline on screen, and withdrawal
-- validation is per-bucket today (WithdrawPage.jsx checks the retirement and
-- savings pots separately). A single per-member pending figure could not
-- answer "how much of the savings pot can this member take out".
--
-- WHY `pending_redemption_*` EXISTS AT ALL — this is a refinement of the brief
-- ------------------------------------------------------------------------
-- The brief says withdrawable = allocated units only. That is true ONLY once
-- units are actually liquidated. Between a withdrawal request and its dealing
-- date the units are still held and still counted in total_balance, so without
-- an explicit hold a member could request the same money twice — the exact
-- failure the brief asks to prevent. The hold closes that window and
-- disappears at liquidation, when the value moves to pending_payout_*.
--
-- NOTHING WRITES THESE COLUMNS YET. No trigger changes, no CHECK constraints
-- (those land in 0149, after live data has proved they hold). While all six
-- are 0, every derived figure equals today's value exactly.
--
-- ROLLBACK: drop the six columns. Instant, and loses nothing while they are
-- still zero. After 0147 is live, DO NOT run it without first setting
-- pricing_enabled = false and draining the queue — the columns would take
-- real member money with them.
-- ============================================================================

ALTER TABLE public.subscriber_balances
  ADD COLUMN IF NOT EXISTS pending_contribution_retirement NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_contribution_emergency  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_payout_retirement       NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_payout_emergency        NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_redemption_retirement   NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_redemption_emergency    NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.subscriber_balances.pending_contribution_retirement IS
  'Money received into the retirement pot that has NOT yet bought units, at face value. Counts toward the member total, never toward withdrawable, never toward AUM. Frozen: a NAV publish does not move it, because it has bought nothing.';
COMMENT ON COLUMN public.subscriber_balances.pending_contribution_emergency IS
  'Savings-pot half of the same. See pending_contribution_retirement.';
COMMENT ON COLUMN public.subscriber_balances.pending_payout_retirement IS
  'Units already SOLD at a struck price whose cash has not yet reached the member. Frozen at the struck value - the member no longer owns units, so a later price move is not theirs.';
COMMENT ON COLUMN public.subscriber_balances.pending_payout_emergency IS
  'Savings-pot half of the same. See pending_payout_retirement.';
COMMENT ON COLUMN public.subscriber_balances.pending_redemption_retirement IS
  'Value of a requested withdrawal whose units are still held and still counted in retirement_balance. Subtracted from withdrawable so the same money cannot be requested twice. Released at liquidation, when it becomes pending_payout_retirement.';
COMMENT ON COLUMN public.subscriber_balances.pending_redemption_emergency IS
  'Savings-pot half of the same. See pending_redemption_retirement.';

COMMENT ON COLUMN public.subscriber_balances.total_balance IS
  'ALLOCATED market value only: round(units x the book unit price). Since 0146 this is deliberately NOT the member-facing total - money in process lives in the six pending_* columns and is added at read time. Three guards depend on this column meaning exactly units x price: bucket_sum_chk, assert_book_revaluable() and the nav_mismatch reconciliation check. Do not fold pending money in here.';
