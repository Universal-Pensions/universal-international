-- 0158_forward_dealing_readiness.sql
-- ============================================================================
-- A PRE-FLIGHT CHECK FOR THE ONE UPDATE THAT CHANGES EVERYTHING.
--
-- Turning forward dealing on is a single statement:
--     UPDATE public.fund_dealing_config SET pricing_enabled = true;
-- and it is instant, un-announced, and affects every member's money from the
-- next contribution onward. There has been nothing to tell an operator whether
-- the system is in a state where that is safe.
--
-- IT IS NOT SAFE TODAY, and the reason is easy to miss: the NAV register is
-- 8 BUSINESS DAYS STALE (last published 2026-08-19). Under forward dealing a
-- contribution buys units at its dealing date's price and waits until that price
-- exists. Flip the switch while the fund is 8 days behind and every new
-- contribution goes straight into the queue and STAYS there — not for a day, but
-- until somebody back-fills the whole gap. Members would see their money arrive,
-- sit in "being put into savings", and never move.
--
-- That is not a defect in the design; it is the design working. Money is not
-- priced at a number nobody published. But it makes the ORDER of operations
-- load-bearing in a way nothing recorded: publish first, flip second.
--
-- This function answers "can I flip?" with a reason, rather than leaving it to
-- whoever happens to remember. It checks:
--   * the register is current — no unpriced business day up to yesterday
--   * nothing is already queued
--   * no member is already holding in-flight money
--   * the holiday calendar covers the next 90 days
--   * the movable holidays (Easter, Eid) are entered for the next 12 months —
--     they cannot be computed and are the thing most likely to be forgotten
--   * the cutoff and timezone are sane
--
-- It is READ-ONLY and never flips anything. Deciding remains a human act; this
-- just means the human is deciding with the facts in front of them.
--
-- ROLLBACK: 0158_forward_dealing_readiness.down.sql drops the function. Nothing
-- depends on it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.forward_dealing_readiness(p_fund TEXT DEFAULT 'UPU-BAL')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role      TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_cfg       public.fund_dealing_config%ROWTYPE;
  v_unpriced  INTEGER;
  v_oldest    DATE;
  v_queued    INTEGER;
  v_inflight  INTEGER;
  v_cal_to    DATE;
  v_movable   INTEGER;
  v_blockers  TEXT[] := ARRAY[]::TEXT[];
  v_warnings  TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read the dealing readiness report', v_role USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cfg FROM public.fund_dealing_config WHERE fund_code = p_fund;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No dealing configuration for fund %', p_fund USING ERRCODE = 'P0001';
  END IF;

  -- 1. THE BIG ONE. Every business day up to YESTERDAY must have a published
  --    price. Today is excluded: the fund legitimately has not priced it yet.
  SELECT count(*), min(nav_date) INTO v_unpriced, v_oldest
    FROM public.nav_missing_days(p_fund, NULL, public.kampala_today() - 1);
  IF v_unpriced > 0 THEN
    v_blockers := array_append(v_blockers, format(
      '%s business day(s) have no published price, oldest %s. Flipping now sends every new contribution into a queue that cannot clear until these are back-filled.',
      v_unpriced, to_char(v_oldest, 'YYYY-MM-DD')));
  END IF;

  -- 2/3. Nothing should already be in flight before the very first flip.
  SELECT count(*) INTO v_queued FROM public.transactions WHERE pricing_status = 'pending';
  IF v_queued > 0 THEN
    v_blockers := array_append(v_blockers, format('%s transaction(s) are already pending. Release them with run_pending_pricing() before changing the switch.', v_queued));
  END IF;

  SELECT count(*) INTO v_inflight FROM public.subscriber_balances
   WHERE pending_contribution_retirement <> 0 OR pending_contribution_emergency <> 0
      OR pending_payout_retirement       <> 0 OR pending_payout_emergency       <> 0
      OR pending_redemption_retirement   <> 0 OR pending_redemption_emergency   <> 0;
  IF v_inflight > 0 THEN
    v_blockers := array_append(v_blockers, format('%s member(s) already hold money in the in-flight components with nothing queued to release it.', v_inflight));
  END IF;

  -- 4. The calendar has to reach past the horizon any dealing date can land on.
  SELECT max(holiday_date) INTO v_cal_to FROM public.business_holidays WHERE is_observed;
  IF v_cal_to IS NULL OR v_cal_to < public.kampala_today() + 90 THEN
    v_blockers := array_append(v_blockers, format('The holiday calendar ends %s and must cover at least the next 90 days.',
      COALESCE(to_char(v_cal_to, 'YYYY-MM-DD'), 'never (empty)')));
  END IF;

  -- 5. Movable holidays CANNOT be computed — Eid is moon-sighted and declared by
  --    the Uganda Muslim Supreme Council. Their absence is the single most
  --    likely way this calendar goes quietly wrong, so it is called out by name.
  SELECT count(*) INTO v_movable FROM public.business_holidays
   WHERE is_observed AND holiday_date BETWEEN public.kampala_today() AND public.kampala_today() + 365
     AND (name ILIKE '%eid%' OR name ILIKE '%easter%' OR name ILIKE '%good friday%');
  IF v_movable = 0 THEN
    v_warnings := array_append(v_warnings, 'No movable holidays (Good Friday, Easter Monday, Eid al-Fitr, Eid al-Adha) are entered for the next 12 months. They cannot be computed and must come from the official gazette - without them money will deal on days the market is shut.');
  END IF;

  -- 6. Config sanity.
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_cfg.timezone) THEN
    v_blockers := array_append(v_blockers, format('timezone %L is not a known timezone.', v_cfg.timezone));
  END IF;
  IF v_cfg.max_pending_days < 1 OR v_cfg.max_pending_days > 30 THEN
    v_warnings := array_append(v_warnings, format('max_pending_days is %s, outside the sensible 1-30 range.', v_cfg.max_pending_days));
  END IF;

  RETURN jsonb_build_object(
    'fundCode',            p_fund,
    'pricingEnabled',      v_cfg.pricing_enabled,
    'ready',               (cardinality(v_blockers) = 0),
    'blockers',            to_jsonb(v_blockers),
    'warnings',            to_jsonb(v_warnings),
    'unpricedBusinessDays', v_unpriced,
    'oldestUnpricedDay',   to_char(v_oldest, 'YYYY-MM-DD'),
    'queuedTransactions',  v_queued,
    'membersHoldingInFlight', v_inflight,
    'calendarCoverTo',     to_char(v_cal_to, 'YYYY-MM-DD'),
    'movableHolidaysNext12Months', v_movable,
    'cutoffLocalTime',     to_char(v_cfg.cutoff_local_time, 'HH24:MI:SS'),
    'timezone',            v_cfg.timezone
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.forward_dealing_readiness(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.forward_dealing_readiness(TEXT) TO authenticated;

COMMENT ON FUNCTION public.forward_dealing_readiness(TEXT) IS
  'Read-only pre-flight report for turning forward dealing on. `ready` is false while any blocker stands - most importantly an unpriced business day, because flipping while the register is behind sends every new contribution into a queue that cannot clear until the gap is back-filled. Publish first, flip second.';
