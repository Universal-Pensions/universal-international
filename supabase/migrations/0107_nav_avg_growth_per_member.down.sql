-- =============================================================================
-- DOWN for 0107_nav_avg_growth_per_member.sql
-- =============================================================================
-- Restores the pre-0107 body, which returns only the POOLED growth figure.
-- The admin Unit-price page reads `avgGrowthPct`; after this rollback that key
-- is absent and the tile falls back to the shaped default in
-- src/services/nav.js (EMPTY_NAV_OVERVIEW), so it renders 0% rather than
-- breaking. Roll the frontend back with it.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_nav_overview(p_fund_code text DEFAULT 'UPU-BAL'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_cur    RECORD;
  v_prev   RECORD;
  v_result JSONB;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read the NAV overview', v_role USING ERRCODE = 'P0001';
  END IF;

  SELECT unit_price, nav_date INTO v_cur
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  SELECT unit_price, nav_date INTO v_prev
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
     AND nav_date < COALESCE(v_cur.nav_date, CURRENT_DATE)
   ORDER BY nav_date DESC LIMIT 1;

  SELECT jsonb_build_object(
    'fundCode',       p_fund_code,
    'currentNav',     v_cur.unit_price,
    'currentNavDate', to_char(v_cur.nav_date, 'YYYY-MM-DD'),
    'previousNav',    v_prev.unit_price,
    'previousNavDate',to_char(v_prev.nav_date, 'YYYY-MM-DD'),
    'changeAbs',      CASE WHEN v_prev.unit_price IS NOT NULL
                        THEN round(v_cur.unit_price - v_prev.unit_price, 2) END,
    'changePct',      CASE WHEN COALESCE(v_prev.unit_price, 0) > 0
                        THEN round(((v_cur.unit_price - v_prev.unit_price) / v_prev.unit_price) * 100, 2) END,
    'unitsInIssue',   b.units,
    'aum',            b.aum,
    'totalInvested',  b.invested,
    'totalGrowth',    b.aum - b.invested,
    'growthPct',      CASE WHEN b.invested > 0
                        THEN round(((b.aum - b.invested) / b.invested) * 100, 2) ELSE 0 END,
    'membersPriced',  b.priced,
    'membersUnpriced',b.unpriced,
    'firstNavDate',   to_char(r.first_date, 'YYYY-MM-DD'),
    'publishedCount', r.published_count,
    'pendingDays',    r.pending_days,
    'lastPublishedDaysAgo', CURRENT_DATE - v_cur.nav_date,
    'series',         COALESCE(s.series, '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT COALESCE(sum(units), 0)         AS units,
           COALESCE(sum(total_balance), 0) AS aum,
           COALESCE(sum(invested), 0)      AS invested,
           count(*) FILTER (WHERE nav_as_of IS NOT NULL) AS priced,
           count(*) FILTER (WHERE nav_as_of IS NULL)     AS unpriced
      FROM public.subscriber_balances
  ) b,
  (
    SELECT min(nav_date) FILTER (WHERE status = 'published')                       AS first_date,
           count(*)      FILTER (WHERE status = 'published')                       AS published_count,
           count(*)      FILTER (WHERE status = 'pending' AND nav_date < CURRENT_DATE) AS pending_days
      FROM public.nav_snapshots WHERE fund_code = p_fund_code
  ) r,
  (
    SELECT jsonb_agg(jsonb_build_object(
             'date',      to_char(q.nav_date, 'YYYY-MM-DD'),
             'unitPrice', q.unit_price,
             'aum',       q.aum) ORDER BY q.nav_date) AS series
      FROM (
        SELECT nav_date, unit_price, aum
          FROM public.nav_snapshots
         WHERE fund_code = p_fund_code AND status = 'published'
         ORDER BY nav_date DESC LIMIT 260
      ) q
  ) s;

  RETURN v_result;
END;
$function$;

REVOKE ALL    ON FUNCTION public.get_nav_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_nav_overview(TEXT) TO authenticated;

COMMIT;
