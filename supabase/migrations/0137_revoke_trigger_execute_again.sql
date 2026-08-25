-- 0137_revoke_trigger_execute_again.sql
-- ============================================================================
-- 0118 re-opened what 0128 closed, and 0128's own standing guard now fails.
--
-- WHAT HAPPENED
-- -------------
-- 0128 revoked client EXECUTE from every trigger function in `public` and ends
-- with a standing guard:
--     IF v_bad > 0 THEN RAISE EXCEPTION '... trigger function(s) still
--     client-executable.'
-- 0118 then created two more —
--     trg_insurance_policies_enforce_client_writes
--     trg_sip_enforce_client_writes
-- — without revoking. Measured live 2026-08-25: both carry EXECUTE for `anon`
-- AND `authenticated`, so re-running 0128 today ABORTS on its own guard.
--
-- ⚠️ THE ROOT CAUSE IS NOT THAT SOMEONE FORGOT.
-- This project carries Supabase's stock default ACL for `public`:
--     postgres:       {postgres=X, anon=X, authenticated=X, service_role=X}
--     supabase_admin: {postgres=X, anon=X, authenticated=X, service_role=X}
-- So EVERY function created in `public` is granted EXECUTE to `anon` and
-- `authenticated` automatically, the moment it is created. A trigger function
-- has no business being callable by a client — it is invoked by the trigger
-- mechanism, which does not consult the caller's EXECUTE privilege — but it
-- gets the grant anyway.
--
-- That makes 0128's approach (revoke the set that exists today) permanently
-- temporary: the NEXT `CREATE FUNCTION ... RETURNS trigger` re-opens it. This
-- migration sweeps again, and the sweep is written to be idempotent and
-- re-runnable rather than a frozen list, so replaying it is a valid remedy.
--
-- THE STRUCTURAL FIX IS NOT TAKEN HERE, DELIBERATELY.
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
-- would close the class for good, and it is SAFE BY MEASUREMENT — all 77
-- client-callable (non-trigger) RPCs already carry an EXPLICIT `authenticated`
-- grant, and ZERO rely on the default (verified 2026-08-25). But it changes a
-- platform-level default on a live project: every future function would need an
-- explicit grant, and one forgotten grant fails at runtime as a confusing
-- permission error rather than at migration time. That is the user's call, not
-- a side effect of a bug fix. Recorded here so the option is not lost.
--
-- APPLIED VIA psql -f; the file's own BEGIN/COMMIT makes it atomic.
-- ============================================================================

BEGIN;

DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prorettype = 'trigger'::regtype
       AND (has_function_privilege('anon',          p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    n := n + 1;
    RAISE NOTICE 'revoked client EXECUTE on trigger function %', r.proname;
  END LOOP;
  RAISE NOTICE '% trigger function(s) revoked.', n;
END $$;

-- ---------------------------------------------------------------------------
-- GUARDS
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad INT; v_rpcs INT; v_names TEXT;
BEGIN
  -- 1. 0128's guard, restated. This is the assertion that fails today.
  SELECT count(*), string_agg(p.proname, ', ') INTO v_bad, v_names
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prorettype = 'trigger'::regtype
     AND (has_function_privilege('anon',          p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % trigger function(s) still client-executable: %', v_bad, v_names
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. And the revoke must not have caught a legitimately client-callable RPC.
  --    Trigger functions are invoked by the trigger mechanism, which never
  --    consults the caller's EXECUTE, so revoking them cannot break anything.
  --
  --    ⚠️ COUNT NON-TRIGGER FUNCTIONS ONLY. A first version of this guard
  --    asserted `>= 79` against a count that INCLUDED the two trigger functions
  --    being revoked, so it fired on its own correct behaviour (79 -> 77) and
  --    aborted the migration. The baseline was wrong, not the revoke. Measured:
  --    77 non-trigger + 2 trigger = the 79 that number came from.
  SELECT count(*) INTO v_rpcs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prorettype <> 'trigger'::regtype
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 'authenticated'::regrole AND a.privilege_type = 'EXECUTE');
  IF v_rpcs < 77 THEN
    RAISE EXCEPTION 'ABORT: client-callable RPC grants fell to % (expected at least 77). The revoke over-matched.', v_rpcs
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'guards OK — 0 trigger functions client-executable, % client RPCs intact', v_rpcs;
END $$;

COMMIT;
