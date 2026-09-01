-- DOWN for 0143_dealing_calendar.sql
-- ============================================================================
-- Drops all seven functions and both tables.
--
-- SAFE TO RUN ONLY WHILE PHASE 1 IS THE HEAD. From Phase 2 (0144) onwards the
-- transaction triggers call `dealing_date_for`, and from Phase 6 (0147) the
-- pricing engine reads `fund_dealing_config` — so this file must be run only
-- after those migrations have themselves been reversed. The CASCADE-free drops
-- below will refuse rather than silently break a dependent function, which is
-- the behaviour we want: if a drop errors here, something downstream is still
-- live and it is not safe to continue.
--
-- DATA LOSS: any movable holidays an admin entered by hand (Easter, Eid) are
-- destroyed with the table and cannot be recomputed. Dump business_holidays
-- before running this if the calendar has been maintained.
-- ============================================================================

DROP FUNCTION IF EXISTS public.delete_business_holiday(DATE);
DROP FUNCTION IF EXISTS public.upsert_business_holiday(DATE, TEXT);
DROP FUNCTION IF EXISTS public.set_fund_dealing_config(TEXT, TIME, TEXT, BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS public.dealing_date_for(TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.next_business_day(DATE);
DROP FUNCTION IF EXISTS public.is_business_day(DATE);
DROP FUNCTION IF EXISTS public.kampala_now();

DROP TABLE IF EXISTS public.fund_dealing_config;
DROP TABLE IF EXISTS public.business_holidays;
