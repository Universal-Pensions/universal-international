-- 0155_lock_down_helper_surface.sql
-- ============================================================================
-- SIX FUNCTIONS FROM 0143/0145/0147 WERE REACHABLE BY ANY SIGNED-IN USER, and
-- one of them returned platform-wide money figures with no role check at all.
-- Found by auditing my own work: I granted EXECUTE to `authenticated` by reflex,
-- following the house pattern for CLIENT-FACING RPCs, without asking which of
-- these the client actually calls. Measured: five of the six have ZERO call
-- sites in src/, api/ or server/.
--
-- 1. get_pending_pricing_summary — THE REAL ONE.
--    SECURITY DEFINER, granted to `authenticated`, and NO app_role gate. It
--    returns pendingContributionValue, pendingRedemptionValue and counts for
--    the WHOLE PLATFORM. Any subscriber, agent or employer could call it and
--    read aggregate fund flow — how much money is sitting unallocated and how
--    much is queued to leave.
--    Its sibling get_nav_overview, which returns comparable figures, RAISEs for
--    any role other than admin. That gate is the pattern; this function simply
--    did not copy it. It is used by exactly one screen, the admin NAV page.
--    Now gated in the body, like every other admin RPC in this schema.
--
-- 2. nav_price_row — WIDENS A DELIBERATE RESTRICTION.
--    `nav_snapshots` carries FORCE RLS with an admin-only SELECT policy, so the
--    fund's price history is deliberately not readable by members. nav_price_row
--    is SECURITY DEFINER (it must be — the engine calls it), and granting it to
--    `authenticated` handed every member a day-by-day oracle over that exact
--    history, one call per date. 0132's header already records unit-price
--    history leaking through PostgREST as a finding worth a migration.
--
-- 3-6. nav_missing_days, is_business_day, next_business_day, kampala_now.
--    All DEFINER over the admin-only calendar and register. None is called from
--    the client. Granting them bought nothing and widened the surface.
--
-- dealing_date_for KEEPS its grant: useDealingDate() calls it so an agent can
-- tell a member at the counter when their money starts working. It returns a
-- date and nothing else, and the alternative — recomputing the cutoff, timezone
-- and holiday calendar in JavaScript — is the duplication 0143 exists to prevent.
--
-- NOT ADDRESSED HERE, and pre-existing: nav_unsigned_days (0107) is also DEFINER
-- with no role gate. It is not part of this work and is left alone rather than
-- quietly widened in scope, but it is the same shape and worth a look.
--
-- ROLLBACK: 0155_lock_down_helper_surface.down.sql restores the grants and the
-- ungated body.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) get_pending_pricing_summary — admin only, in the body
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-emitted as plpgsql so it can carry the gate. The query is unchanged.
CREATE OR REPLACE FUNCTION public.get_pending_pricing_summary(p_fund TEXT DEFAULT 'UPU-BAL')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_result JSONB;
BEGIN
  -- Same gate, same wording shape, as get_nav_overview. These are platform-wide
  -- money figures; a member has no business reading them.
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read the pricing queue', v_role USING ERRCODE = 'P0001';
  END IF;

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
  ) INTO v_result
  FROM p;

  RETURN v_result;
END;
$$;

REVOKE ALL     ON FUNCTION public.get_pending_pricing_summary(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pending_pricing_summary(TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) SQL-only helpers: no client calls them, so nothing may call them from the API
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.nav_price_row(DATE, TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nav_missing_days(TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_business_day(DATE)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_business_day(DATE)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kampala_now()                      FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Guard — assert the surface is what this migration claims it is
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT g.routine_name, ', ') INTO v_bad
    FROM information_schema.role_routine_grants g
   WHERE g.specific_schema = 'public'
     AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
     AND g.routine_name IN ('nav_price_row', 'nav_missing_days', 'is_business_day',
                            'next_business_day', 'kampala_now', 'price_pending_transactions');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: SQL-only helper(s) still callable from the API: %', v_bad
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '0155 OK - only dealing_date_for and the admin-gated RPCs remain client-callable';
END $$;
