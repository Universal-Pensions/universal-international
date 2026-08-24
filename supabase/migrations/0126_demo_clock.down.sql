-- =============================================================================
-- DOWN for 0126_demo_clock.sql
-- =============================================================================
-- Restores public._demo_now() to the exact literal it held before 0126
-- ('2026-05-18 23:59:59+00' — captured live via `pg_get_functiondef` before
-- authoring 0126). CREATE OR REPLACE only; no table was written by 0126 (it
-- creates/replaces one function), so there is nothing else to restore, and
-- this does not touch the function's owner or existing GRANTs either.
--
-- Running this down migration re-introduces the 44-day drift 0126 fixed
-- (A06-009) and will turn e2e/specs/db/invariants.spec.ts's
-- "public._demo_now() (SQL clock) resolves to the same calendar date as the
-- JS MOCK_NOW anchor" assertion red again — expected, not a bug in that test.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._demo_now()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$ SELECT '2026-05-18 23:59:59+00'::timestamptz $function$;

COMMIT;
