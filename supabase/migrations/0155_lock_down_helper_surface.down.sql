-- DOWN for 0155_lock_down_helper_surface.sql
-- ============================================================================
-- ⚠️ RE-OPENS TWO DISCLOSURES. Read 0155's header.
--   * get_pending_pricing_summary goes back to having NO role gate, so any
--     signed-in user can read platform-wide pending money totals.
--   * nav_price_row becomes callable by any signed-in user again, handing them
--     a day-by-day oracle over the fund's price history that nav_snapshots'
--     admin-only policy exists to prevent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_pricing_summary(p_fund TEXT DEFAULT 'UPU-BAL')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH p AS (
    SELECT t.type, t.amount, t.dealing_date, t.received_at,
           EXISTS (SELECT 1 FROM public.nav_snapshots n
                    WHERE n.fund_code = p_fund AND n.nav_date = t.dealing_date
                      AND n.status = 'published') AS priceable
      FROM public.transactions t
     WHERE t.pricing_status = 'pending'
       AND t.type IN ('contribution', 'withdrawal', 'premium_sweep')
  )
  SELECT jsonb_build_object(
    'fundCode', p_fund,
    'pendingContributions', COALESCE(count(*) FILTER (WHERE type = 'contribution'), 0),
    'pendingContributionValue', COALESCE(sum(amount) FILTER (WHERE type = 'contribution'), 0),
    'pendingRedemptions', COALESCE(count(*) FILTER (WHERE type <> 'contribution'), 0),
    'pendingRedemptionValue', COALESCE(sum(abs(amount)) FILTER (WHERE type <> 'contribution'), 0),
    'releasableNow', COALESCE(count(*) FILTER (WHERE priceable), 0),
    'awaitingPrice', COALESCE(count(*) FILTER (WHERE NOT priceable), 0),
    'oldestDealingDate', to_char(min(dealing_date), 'YYYY-MM-DD'),
    'oldestPendingBusinessDays', COALESCE((
      SELECT count(*) FROM generate_series(min(p.dealing_date), public.kampala_today(), INTERVAL '1 day') d
       WHERE public.is_business_day(d::date)), 0),
    'maxPendingDays', (SELECT max_pending_days FROM public.fund_dealing_config WHERE fund_code = p_fund),
    'pricingEnabled', (SELECT pricing_enabled FROM public.fund_dealing_config WHERE fund_code = p_fund)
  )
  FROM p;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_pricing_summary(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nav_price_row(DATE, TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.nav_missing_days(TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_day(DATE)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_business_day(DATE)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.kampala_now()                      TO authenticated;
