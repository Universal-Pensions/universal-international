-- 0143_dealing_calendar.sql
-- ============================================================================
-- PHASE 1 of the unitization redesign (plan: ~/Desktop/unitization-implementation-plan-2026-08-31.md).
--
-- Ships every INGREDIENT of the forward-dealing rule and wires NONE of them to
-- money. After this migration the platform prices exactly as it did before; the
-- only observable change is that seven new functions and two new tables exist.
--
-- THE RULE THIS BUILDS TOWARDS
-- ----------------------------
--   received at or before the cutoff, on a business day  -> that day's price
--   received after the cutoff, or on a weekend/holiday   -> the next business day's price
-- and, as an absolute invariant, the dealing date is NEVER EARLIER than the
-- Kampala calendar date of receipt.
--
-- WHY A CONFIG TABLE AND NOT A CONSTANT
-- -------------------------------------
-- The brief requires the 14:00 cutoff be configurable without a redeploy. The
-- repo's existing idiom for thresholds — `_admin_attention_thresholds()`, an
-- IMMUTABLE function returning a jsonb literal — is a hardcoded literal wearing
-- a function's clothes, so it cannot serve. `fund_dealing_config` is a real
-- table with a real row: changing the cutoff, the timezone or the pending-age
-- SLA is one UPDATE.
--
-- `pricing_enabled` in that same table is the Phase 6 kill switch. It ships
-- FALSE here and stays FALSE until Phase 6 is deployed and verified. Nothing in
-- this migration reads it.
--
-- THE TIMEZONE DEFECT THIS FIXES GOING FORWARD
-- --------------------------------------------
-- Every money writer today casts `NEW.date::date` in the session timezone, which
-- is UTC. A receipt between 00:00 and 03:00 Kampala therefore dates to the
-- PREVIOUS day. Measured on live before writing this: 0 of 27,433 existing rows
-- are affected, because 27,206 of them sit at exactly 00:00 UTC (= 03:00
-- Kampala) and the rest fall later in the day. So the defect is entirely
-- forward-looking and no historical row needs a timezone repair.
-- `dealing_date_for` reads the timezone from config and never casts in the
-- session zone.
--
-- MOVABLE HOLIDAYS ARE DELIBERATELY ABSENT
-- ----------------------------------------
-- The seed below is the FIXED-DATE Ugandan public holidays only, 2020-2030.
-- Good Friday, Easter Monday, Eid al-Fitr and Eid al-Adha are NOT computed and
-- must not be invented: the Eid dates are moon-sighted and declared by the
-- Uganda Muslim Supreme Council, so there is no formula that is correct in
-- advance. An admin enters next year's movable dates from the official gazette
-- via `upsert_business_holiday`. §10 of the plan defines the alarm that fires
-- when the calendar runs thin; forgetting is therefore visible, not silent.
--
-- A WRONG CALENDAR FAILS LOUD. `dealing_date_for` raises P0001 if it cannot
-- find a business day within 14 days, which is what a mis-entered calendar (a
-- whole month marked as holidays) looks like. Rolling silently for a year and
-- pricing money in 2027 is the failure this guard exists to prevent.
--
-- SECURITY DEFINER IS MANDATORY, not house style. Both new tables carry FORCE
-- RLS with an admin-only SELECT policy, exactly like `nav_snapshots`. Under
-- SECURITY INVOKER `is_business_day` returns TRUE on Christmas Day for every
-- subscriber, because the holiday row is invisible to them and `NOT EXISTS`
-- passes. The owner has rolbypassrls, so DEFINER sees the calendar regardless
-- of who is calling.
--
-- ROLLBACK: 0143_dealing_calendar.down.sql drops all seven functions and both
-- tables unconditionally. Nothing references them yet, which is the entire
-- point of shipping them as their own phase.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) business_holidays — observed closure dates
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per day the market is actually shut. Substitution rules (a holiday
-- falling on Sunday and observed the following Monday) are handled by DATA
-- ENTRY, not by code: the admin enters the Monday. Encoding substitution in SQL
-- means encoding a rule that Uganda applies by gazette, not by algorithm.
--
-- `is_observed` exists so a mistaken entry can be switched off without losing
-- the record of what was believed and when.
CREATE TABLE IF NOT EXISTS public.business_holidays (
  holiday_date  DATE        PRIMARY KEY,
  name          TEXT        NOT NULL,
  country_code  TEXT        NOT NULL DEFAULT 'UG',
  is_observed   BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT
);

ALTER TABLE public.business_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_holidays FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_holidays_select_admin ON public.business_holidays;
CREATE POLICY business_holidays_select_admin ON public.business_holidays
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

REVOKE ALL    ON public.business_holidays FROM PUBLIC, anon;
GRANT  SELECT ON public.business_holidays TO authenticated;

COMMENT ON TABLE public.business_holidays IS
  'Days the fund does not deal. Read only through SECURITY DEFINER helpers (is_business_day). Fixed-date Ugandan holidays are seeded by 0143 through 2030; movable holidays (Good Friday, Easter Monday, Eid al-Fitr, Eid al-Adha) MUST be entered per year from the official gazette and must never be computed.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fund_dealing_config — the configurable cutoff, and the kill switch
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fund_dealing_config (
  fund_code          TEXT        PRIMARY KEY DEFAULT 'UPU-BAL',
  cutoff_local_time  TIME        NOT NULL DEFAULT '14:00:00',
  timezone           TEXT        NOT NULL DEFAULT 'Africa/Kampala',
  pricing_enabled    BOOLEAN     NOT NULL DEFAULT false,
  max_pending_days   INTEGER     NOT NULL DEFAULT 3,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT
);

ALTER TABLE public.fund_dealing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_dealing_config FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fund_dealing_config_select_admin ON public.fund_dealing_config;
CREATE POLICY fund_dealing_config_select_admin ON public.fund_dealing_config
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

REVOKE ALL    ON public.fund_dealing_config FROM PUBLIC, anon;
GRANT  SELECT ON public.fund_dealing_config TO authenticated;

INSERT INTO public.fund_dealing_config (fund_code, updated_by)
VALUES ('UPU-BAL', 'migration:0143')
ON CONFLICT (fund_code) DO NOTHING;

COMMENT ON COLUMN public.fund_dealing_config.cutoff_local_time IS
  'Dealing cutoff in `timezone`. At or before it a receipt deals the same business day; after it, the next. Configurable by design - the brief forbids a hardcoded literal, and dealing_date_for() must never contain one.';
COMMENT ON COLUMN public.fund_dealing_config.pricing_enabled IS
  'Phase 6 kill switch. FALSE = money prices synchronously exactly as it did before the unitization redesign. TRUE = contributions and redemptions queue and are allocated by price_pending_transactions(). One UPDATE, no redeploy, effective on the next statement.';
COMMENT ON COLUMN public.fund_dealing_config.max_pending_days IS
  'Business days a transaction may sit pending before it is an operational fault. Feeds the §10 alarm and the pending_orphan reconciliation check.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) kampala_now — the clock seam
-- ─────────────────────────────────────────────────────────────────────────────
-- Deliberately `now()`, the REAL wall clock, not `_demo_now()`. The demo clock
-- is anchored to 2026-07-01 while every money writer stamps real time; wiring
-- the demo clock into the money path would back-date live money by two months,
-- which is the exact class of defect this project exists to remove. This
-- function exists so that decision has ONE place to be revisited rather than
-- being scattered across the engine.
CREATE OR REPLACE FUNCTION public.kampala_now()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT now();
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) is_business_day / next_business_day
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_business_day(p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_date IS NOT NULL
     AND EXTRACT(ISODOW FROM p_date) < 6
     AND NOT EXISTS (
           SELECT 1 FROM public.business_holidays h
            WHERE h.holiday_date = p_date AND h.is_observed);
$$;

-- STRICTLY after p_date. Returns NULL if there is no business day within 21
-- days, which can only mean a misconfigured calendar; callers that price money
-- must treat NULL as an error, not as "no roll needed".
CREATE OR REPLACE FUNCTION public.next_business_day(p_date DATE)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT min(g.d)::date
    FROM generate_series(p_date + 1, p_date + 21, interval '1 day') g(d)
   WHERE public.is_business_day(g.d::date);
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) dealing_date_for — THE SINGLE DERIVATION
-- ─────────────────────────────────────────────────────────────────────────────
-- Every dealing date in the platform comes from here. There must never be a
-- second implementation, in SQL or in JavaScript.
--
-- THE COMPARISON IS `>`, NOT `>=`. A receipt at exactly 14:00:00.000 deals the
-- SAME day. This is a deliberate reading of "at or before the cutoff" and it is
-- asserted in both the contract test and the generative test.
--
-- THE ROLL LOOP RUNS AFTER THE CUTOFF BUMP, which is what makes a weekend
-- receipt roll regardless of time of day: Saturday 09:00 does not trip the
-- cutoff, but Saturday is not a business day, so the loop advances it to Monday.
CREATE OR REPLACE FUNCTION public.dealing_date_for(
  p_received_at TIMESTAMPTZ,
  p_fund        TEXT DEFAULT 'UPU-BAL'
) RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg   public.fund_dealing_config%ROWTYPE;
  v_local TIMESTAMP;
  v_date  DATE;
  v_rolls INTEGER := 0;
BEGIN
  IF p_received_at IS NULL THEN
    RAISE EXCEPTION 'dealing_date_for: a receipt instant is required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cfg FROM public.fund_dealing_config WHERE fund_code = p_fund;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dealing_date_for: no dealing configuration for fund %', p_fund
      USING ERRCODE = 'P0001';
  END IF;

  -- Kampala wall clock. NOT the session timezone, which is UTC.
  v_local := p_received_at AT TIME ZONE v_cfg.timezone;
  v_date  := v_local::date;

  IF v_local::time > v_cfg.cutoff_local_time THEN
    v_date := v_date + 1;
  END IF;

  WHILE NOT public.is_business_day(v_date) LOOP
    v_date  := v_date + 1;
    v_rolls := v_rolls + 1;
    IF v_rolls > 14 THEN
      RAISE EXCEPTION 'dealing_date_for: no business day within 14 days of % - business_holidays is misconfigured', v_local::date
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN v_date;
END;
$$;

COMMENT ON FUNCTION public.dealing_date_for(TIMESTAMPTZ, TEXT) IS
  'The one and only derivation of a dealing date. Reads the cutoff and timezone from fund_dealing_config - it must never contain a time literal. Guarantees the result is a business day and is never earlier than the Kampala calendar date of receipt.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Admin maintenance RPCs
-- ─────────────────────────────────────────────────────────────────────────────
-- Gated in the function body on the JWT app_role, matching publish_nav_snapshot.
-- The tables have no write policies at all (F4): every write to money-adjacent
-- state in this schema goes through a SECURITY DEFINER RPC, so the write surface
-- stays enumerable.
CREATE OR REPLACE FUNCTION public.set_fund_dealing_config(
  p_fund_code         TEXT    DEFAULT 'UPU-BAL',
  p_cutoff_local_time TIME    DEFAULT NULL,
  p_timezone          TEXT    DEFAULT NULL,
  p_pricing_enabled   BOOLEAN DEFAULT NULL,
  p_max_pending_days  INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.fund_dealing_config%ROWTYPE;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can change the dealing configuration'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION '% is not a known timezone', p_timezone USING ERRCODE = 'P0001';
  END IF;

  IF p_max_pending_days IS NOT NULL AND (p_max_pending_days < 1 OR p_max_pending_days > 30) THEN
    RAISE EXCEPTION 'max_pending_days must be between 1 and 30 (got %)', p_max_pending_days
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.fund_dealing_config SET
    cutoff_local_time = COALESCE(p_cutoff_local_time, cutoff_local_time),
    timezone          = COALESCE(p_timezone,          timezone),
    pricing_enabled   = COALESCE(p_pricing_enabled,   pricing_enabled),
    max_pending_days  = COALESCE(p_max_pending_days,  max_pending_days),
    updated_at        = now(),
    updated_by        = COALESCE((SELECT auth.jwt()) ->> 'sub', 'admin')
  WHERE fund_code = p_fund_code
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No dealing configuration for fund %', p_fund_code USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'fundCode',        v_row.fund_code,
    'cutoffLocalTime', to_char(v_row.cutoff_local_time, 'HH24:MI:SS'),
    'timezone',        v_row.timezone,
    'pricingEnabled',  v_row.pricing_enabled,
    'maxPendingDays',  v_row.max_pending_days,
    'updatedAt',       v_row.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_business_holiday(
  p_date DATE,
  p_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can change the holiday calendar'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_date IS NULL OR btrim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'A holiday needs both a date and a name' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.business_holidays (holiday_date, name, created_by, is_observed)
  VALUES (p_date, btrim(p_name), COALESCE((SELECT auth.jwt()) ->> 'sub', 'admin'), true)
  ON CONFLICT (holiday_date) DO UPDATE
    SET name = EXCLUDED.name, is_observed = true;

  RETURN jsonb_build_object('holidayDate', to_char(p_date, 'YYYY-MM-DD'), 'name', btrim(p_name));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_business_holiday(p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deleted INTEGER;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can change the holiday calendar'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.business_holidays WHERE holiday_date = p_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('holidayDate', to_char(p_date, 'YYYY-MM-DD'), 'deleted', v_deleted);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Grants — every new function revoked from PUBLIC and anon
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL    ON FUNCTION public.kampala_now()                    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kampala_now()                    TO authenticated;
REVOKE ALL    ON FUNCTION public.is_business_day(DATE)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_business_day(DATE)            TO authenticated;
REVOKE ALL    ON FUNCTION public.next_business_day(DATE)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.next_business_day(DATE)          TO authenticated;
REVOKE ALL    ON FUNCTION public.dealing_date_for(TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dealing_date_for(TIMESTAMPTZ, TEXT) TO authenticated;
REVOKE ALL    ON FUNCTION public.set_fund_dealing_config(TEXT, TIME, TEXT, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_fund_dealing_config(TEXT, TIME, TEXT, BOOLEAN, INTEGER) TO authenticated;
REVOKE ALL    ON FUNCTION public.upsert_business_holiday(DATE, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_business_holiday(DATE, TEXT) TO authenticated;
REVOKE ALL    ON FUNCTION public.delete_business_holiday(DATE)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_business_holiday(DATE)    TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Seed — FIXED-DATE Ugandan public holidays only, 2020-2030
-- ─────────────────────────────────────────────────────────────────────────────
-- 10 holidays x 11 years = 110 rows. No Easter. No Eid. See the header.
INSERT INTO public.business_holidays (holiday_date, name, country_code, created_by)
SELECT make_date(y.yr, h.mth, h.dy), h.nm, 'UG', 'migration:0143'
  FROM generate_series(2020, 2030) AS y(yr)
 CROSS JOIN (VALUES
     ( 1,  1, 'New Year''s Day'),
     ( 1, 26, 'NRM Liberation Day'),
     ( 2, 16, 'Archbishop Janani Luwum Day'),
     ( 3,  8, 'International Women''s Day'),
     ( 5,  1, 'Labour Day'),
     ( 6,  3, 'Uganda Martyrs'' Day'),
     ( 6,  9, 'National Heroes'' Day'),
     (10,  9, 'Independence Day'),
     (12, 25, 'Christmas Day'),
     (12, 26, 'Boxing Day')
   ) AS h(mth, dy, nm)
ON CONFLICT (holiday_date) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9) Self-check — the migration proves the rule before it commits
-- ─────────────────────────────────────────────────────────────────────────────
-- These are the plan's Phase 1 acceptance cases. If the calendar or the cutoff
-- is wrong, this migration aborts rather than shipping a broken derivation.
DO $$
DECLARE
  v_fail TEXT := '';
BEGIN
  IF public.dealing_date_for('2026-09-04 13:59+03') <> DATE '2026-09-04' THEN
    v_fail := v_fail || ' [Fri 13:59 should deal same day]'; END IF;
  IF public.dealing_date_for('2026-09-04 14:00+03') <> DATE '2026-09-04' THEN
    v_fail := v_fail || ' [AT the cutoff should deal same day]'; END IF;
  IF public.dealing_date_for('2026-09-04 14:01+03') <> DATE '2026-09-07' THEN
    v_fail := v_fail || ' [Fri after cutoff should deal Mon]'; END IF;
  IF public.dealing_date_for('2026-09-05 09:00+03') <> DATE '2026-09-07' THEN
    v_fail := v_fail || ' [Sat should deal Mon]'; END IF;
  IF public.dealing_date_for('2026-10-08 20:00+03') <> DATE '2026-10-12' THEN
    v_fail := v_fail || ' [Thu after cutoff, Fri 9 Oct Independence Day, should deal Mon 12 Oct]'; END IF;
  -- The same instant written two ways must give the same answer (F8).
  IF public.dealing_date_for('2026-09-04 01:30+03') <> public.dealing_date_for('2026-09-03 22:30Z') THEN
    v_fail := v_fail || ' [Kampala/UTC disagreement - the timezone fix is not working]'; END IF;
  IF public.dealing_date_for('2026-09-04 01:30+03') <> DATE '2026-09-04' THEN
    v_fail := v_fail || ' [00:00-03:00 Kampala must date to the Kampala day, not the UTC day]'; END IF;

  IF v_fail <> '' THEN
    RAISE EXCEPTION 'ABORT 0143: dealing-date derivation failed:%', v_fail USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '0143 OK - dealing-date derivation passes all 7 acceptance cases';
END $$;
