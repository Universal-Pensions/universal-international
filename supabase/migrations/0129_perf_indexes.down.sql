-- 0129_perf_indexes.down.sql
-- Restores the index set exactly as it was LIVE immediately before 0129.
--
-- PROVENANCE. Both statements were generated from the live catalogue on project
-- ilkhfnoyxlxwqadebnkp (2026-08-25), not retyped from 0090:
--   SELECT pg_get_indexdef(indexrelid) FROM pg_stat_user_indexes
--    WHERE schemaname='public' AND indexrelname='demo_personas_phone_role_key';
--     → CREATE UNIQUE INDEX demo_personas_phone_role_key
--         ON public.demo_personas USING btree (phone, role)
--
-- Re-creating the duplicate is harmless: it is a second identical unique index
-- over (phone, role), which is precisely the redundant state 0129 removed.
-- `money_nonces_subscriber_id_idx` did not exist before 0129, so the down
-- migration drops it.
--
-- Both statements are idempotent, so this file is safe to re-run.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS demo_personas_phone_role_key
  ON public.demo_personas USING btree (phone, role);

DROP INDEX IF EXISTS public.money_nonces_subscriber_id_idx;

COMMIT;
