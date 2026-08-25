-- =============================================================================
-- 0117_nav_fixtures.down.sql — put the NAV register and the book back
-- =============================================================================
-- Everything this needs is in public.nav_fixture_rollback_0117, which 0117
-- wrote as it went. Nothing here is reconstructed from memory or from a
-- hardcoded date — that is the point of the ledger.
--
-- THE REVALUATION NEEDS NO ROW-LEVEL ROLLBACK DATA. 0117 restated the book with
--     total_balance      = round(units * P)
--     retirement_balance = round(retirement_units * P)
--     emergency_balance  = round(units * P) - round(retirement_units * P)
-- and did NOT touch units or retirement_units. That is a pure function of the
-- units (unchanged) and the price, so replaying it with the previous frontier
-- price reproduces the previous balances EXACTLY — not approximately. The
-- ledger's `frontier_before` row carries that price.
--
-- WHAT COMES BACK IF YOU RUN THIS:
--   * the four stale pending rows at the retired 1,000.00 price, sitting behind
--     the published frontier again (A06-020);
--   * the "publish moves AUM" demo stops working again, because every pending
--     day is once more BEHIND the newest published day (A04-007).
-- =============================================================================

DO $rollback$
DECLARE
  v_price    numeric;
  v_date     date;
  v_units    numeric;
  v_aum      numeric;
  v_members  int;
  v_n        int;
BEGIN
  IF to_regclass('public.nav_fixture_rollback_0117') IS NULL THEN
    RAISE NOTICE '0117.down: no rollback ledger — 0117 was never applied, or has already been rolled back. Nothing to do.';
    RETURN;
  END IF;

  SELECT unit_price, nav_date INTO v_price, v_date
    FROM public.nav_fixture_rollback_0117
   WHERE kind = 'frontier_before'
   ORDER BY seq DESC LIMIT 1;

  -- 1. Undo the only lossy step first, while the balances 0117 left are still
  --    in place (LEAST() clamped these down; nothing else touched them).
  UPDATE public.contribution_schedules s
     SET insurance_premium_accrued = r.amount_before,
         updated_at = now()
    FROM public.nav_fixture_rollback_0117 r
   WHERE r.kind = 'accrual_clamped' AND s.subscriber_id = r.subscriber_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE '0117.down: restored % clamped insurance accrual(s).', v_n; END IF;

  -- 2. Remove every register row 0117 wrote.
  DELETE FROM public.nav_snapshots n
   USING public.nav_fixture_rollback_0117 r
   WHERE r.kind = 'inserted'
     AND n.fund_code = r.fund_code
     AND n.nav_date  = r.nav_date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '0117.down: deleted % nav row(s) 0117 inserted.', v_n;

  -- 3. Put the stale pending rows back, ids and all.
  INSERT INTO public.nav_snapshots
    (id, fund_code, nav_date, unit_price, status, published_at, source, published_by,
     units_in_issue, aum, members_priced)
  SELECT r.snapshot_id, r.fund_code, r.nav_date, r.unit_price, r.status, r.published_at,
         r.source, r.published_by, r.units_in_issue, r.aum, r.members_priced
    FROM public.nav_fixture_rollback_0117 r
   WHERE r.kind = 'deleted_pending'
  ON CONFLICT (fund_code, nav_date) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '0117.down: restored % stale pending row(s).', v_n;

  -- 4. Restate the book at the previous frontier price.
  IF v_price IS NULL THEN
    RAISE NOTICE '0117.down: no frontier_before price recorded; leaving the book as it stands.';
  ELSE
    UPDATE public.subscriber_balances
       SET total_balance      = round(units * v_price),
           retirement_balance = round(retirement_units * v_price),
           emergency_balance  = round(units * v_price)
                                - round(retirement_units * v_price),
           nav_as_of          = v_date,
           updated_at         = now()
     WHERE subscriber_id IS NOT NULL;

    UPDATE public.subscribers
       SET current_unit_value = v_price,
           unit_value_as_of   = now()
     WHERE id IS NOT NULL;

    SELECT COALESCE(sum(units), 0), COALESCE(sum(total_balance), 0), count(*)
      INTO v_units, v_aum, v_members FROM public.subscriber_balances;
    RAISE NOTICE '0117.down: book restated at % (frontier %). AUM %.', v_price, v_date, v_aum;
  END IF;

  -- 5. Verify before declaring success.
  SELECT count(*) INTO v_n FROM public.subscriber_balances
   WHERE retirement_balance + emergency_balance <> total_balance
      OR total_balance <> round(units * public.latest_nav());
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % member row(s) do not reconcile after the rollback.', v_n USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '0117.down complete: register and book restored, invariants hold.';
END
$rollback$;

-- The ledger is consumed. Dropping it means a later re-apply of 0117 starts
-- from a clean sheet instead of appending to stale rollback data.
DROP TABLE IF EXISTS public.nav_fixture_rollback_0117;
