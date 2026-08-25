-- 0137_revoke_trigger_execute_again.down.sql
-- ============================================================================
-- Undo for 0137 — restore client EXECUTE on the two trigger functions 0118
-- created.
--
-- ⚠️ REVERTING RE-OPENS THE FINDING AND BREAKS 0128'S STANDING GUARD, which
-- aborts while any trigger function is client-executable. There is no scenario
-- where running this is correct; it exists because every migration in this
-- programme ships a down.
--
-- Scoped to the two functions 0137 actually revoked, NOT a blanket grant over
-- every trigger function in the schema — 0128's own down does that, and it
-- grants more than its up ever took away.
-- ============================================================================

BEGIN;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('trg_insurance_policies_enforce_client_writes',
                         'trg_sip_enforce_client_writes')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
  RAISE WARNING 'REVERTED: two trigger functions are client-executable again; 0128''s guard will now abort.';
END $$;

COMMIT;
