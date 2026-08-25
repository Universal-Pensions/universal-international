-- 0132_secure_nav_rollback_and_universal_rls_guard.down.sql
-- ============================================================================
-- Undo for 0132.
--
-- ⚠️ REVERTING RE-OPENS AN ERROR-LEVEL SECURITY FINDING. It restores a state
-- where fund-wide NAV rollback data (unit-price history, insurance accruals) is
-- readable unauthenticated through PostgREST. It exists because every migration
-- in this programme ships a down, not because reverting is ever right.
--
-- Nothing needs it: 0117_nav_fixtures.down.sql reads nav_fixture_rollback_0117
-- as service_role/owner, which bypasses RLS entirely and is UNAFFECTED by 0132.
--
-- The two guards in 0132 are assertions, not state — nothing to undo for them.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.nav_fixture_rollback_0117') IS NULL THEN
    RAISE NOTICE 'nav_fixture_rollback_0117 does not exist — nothing to revert.';
  ELSE
    EXECUTE 'ALTER TABLE public.nav_fixture_rollback_0117 NO FORCE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.nav_fixture_rollback_0117 DISABLE ROW LEVEL SECURITY';
    EXECUTE 'GRANT SELECT ON public.nav_fixture_rollback_0117 TO anon, authenticated';
    RAISE WARNING 'REVERTED: public.nav_fixture_rollback_0117 is API-readable again (advisor ERROR restored).';
  END IF;
END $$;

-- The four nonce/idempotency ledgers. Restoring SELECT is inert while their RLS
-- stays on with zero policies — which is exactly why 0132 called the grant a
-- trap rather than a hole. Restored only so the revert is faithful.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contribution_run_uploads','money_nonces',
                           'settlement_uploads','subscriber_signup_uploads']
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
      RAISE NOTICE 'restored inert grant on public.%', t;
    END IF;
  END LOOP;
END $$;

COMMIT;
