-- =============================================================================
-- Universal Pensions Uganda — 0126: unify the SQL demo clock with the JS one
-- =============================================================================
-- AUDIT A06-009 (medium, confirmed) — public._demo_now() is a FIFTH,
-- independent "now" living in SQL, 44 days behind the JS MOCK_NOW anchor:
--
--   $ psql … -c "select public._demo_now();"
--   2026-05-18 23:59:59+00
--
--   Same live rows, same wall-clock day, three different "today"s:
--     28  |  29  | 5408    <- public._demo_now()  (2026-05-18)
--   1110  |2524  |  844    <- JS MOCK_NOW           (2026-07-01, this migration's target)
--    114  | 114  |  998    <- real wall clock       (2026-08-24, for reference only)
--   (today / this_week / this_month contribution counts, same query, same day)
--
-- public._demo_now() is read by four RPCs: get_employer_activity_rollup,
-- get_entity_metrics_rollup, get_top_branch, submit_hospital_cash_claim —
-- i.e. the admin / distributor / branch / employer "today" / "this week" /
-- "this month" tiles, and hospital-cash claim pricing (0099). Every one of
-- them was computing "now" 44 days behind what the subscriber/agent surfaces
-- (which read JS MOCK_NOW via src/data/mockData.js) already showed.
--
-- THE FIX — src/constants/demoClock.js (audit A06-003/A06-008/A26-003, same
-- remediation) is now the ONE literal every JS consumer reads. Postgres
-- cannot import a JS constant, so public._demo_now() stays a second,
-- necessarily-independent literal — this migration brings it into agreement
-- BY VALUE with src/constants/demoClock.js's MOCK_NOW (2026-07-01), and
-- e2e/specs/db/invariants.spec.ts now asserts the two resolve to the same
-- calendar date, so a future roll-forward that updates only one side fails
-- loudly instead of drifting silently again for weeks.
--
-- TO ROLL FORWARD AGAIN: change src/constants/demoClock.js's MOCK_NOW, then
-- author a migration exactly like this one (CREATE OR REPLACE the function
-- body below with the new date) — always both, always together.
--
-- WHY 23:59:59 UTC (end of day), not midnight: matches the function's own
-- pre-existing convention ('2026-05-18 23:59:59+00') — every date-window
-- comparison downstream (date_trunc('day'/'week'/'month', _demo_now())) is
-- unaffected by the time-of-day component, only the calendar date; kept for
-- minimal diff against the value being replaced.
--
-- TIMEZONE — this project's Postgres session default is UTC (`SHOW timezone`
-- verified live), so `(public._demo_now())::date` reads '2026-07-01' with no
-- session-timezone-dependent shift. src/constants/demoClock.js's
-- MOCK_NOW_ISO_DATE is read off MOCK_NOW's LOCAL Date components (see that
-- file), which is the same calendar date this literal encodes.
--
-- INDEPENDENT OF THE SEED / A04-003 — this migration only changes what four
-- RPCs compute "today" as; it reads and writes no table, touches no pricing
-- or unit data, and does NOT require, trigger, or invite a reseed. (Contrast
-- with the separate, sibling fix in scripts/seed-supabase.mjs, which corrects
-- the seed's OWN stale MOCK_NOW mirror (A06-003) but only manifests on a
-- FUTURE `npm run seed` run — and per this phase's guardrails, that reseed
-- must NOT happen until A04-003 (NAV/unit-price fix, owned by a concurrently
-- running agent) is applied, or seeded units revert to the dead 1,000 UGX
-- price. Applying THIS migration on its own carries no such dependency.)
--
-- SIGNATURE UNCHANGED — CREATE OR REPLACE FUNCTION on the same name/arg list
-- preserves the function's owner and existing GRANTs (verified: EXECUTE was
-- already granted to `authenticated` + `service_role`, not `anon`); this
-- migration does not re-grant anything.
--
-- VERIFICATION — dry-run only (guardrail: no migration applied to live by
-- this agent). Inside BEGIN … ROLLBACK against the live project:
--   BEFORE: public._demo_now()                = 2026-05-18 23:59:59+00
--   (apply the CREATE OR REPLACE below)
--   AFTER:  public._demo_now()                = 2026-07-01 23:59:59+00
--           (public._demo_now())::date::text  = '2026-07-01'  (matches
--             src/constants/demoClock.js MOCK_NOW_ISO_DATE exactly)
--           today/this_week/this_month via _demo_now() = 844/2524/1110,
--             now IDENTICAL to the JS-MOCK_NOW-anchored figures above
--           get_employer_activity_rollup() still resolves and executes
--             (reaches its own role-gate check — proves CREATE OR REPLACE
--             did not break function resolution for its callers)
--   ROLLBACK: public._demo_now() reverts to 2026-05-18 23:59:59+00 — nothing
--             persisted.
-- NOT YET APPLIED to the live project — authored + dry-run verified only.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._demo_now()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$ SELECT '2026-07-01 23:59:59+00'::timestamptz $function$;

COMMIT;
