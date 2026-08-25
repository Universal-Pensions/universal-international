-- 0128_revoke_identity_and_trigger_execute.sql
-- ============================================================================
-- NEW FINDING A03-101 (CRITICAL, not in the 221) — PRIVILEGE ESCALATION TO ADMIN
--
-- `public.register_login_identity(text,text,text,text,text,text)` is
-- SECURITY DEFINER, has NO role guard of any kind, and EXECUTE is granted to
-- `authenticated`. So ANY signed-in user — a subscriber, the lowest-privileged
-- role — can call it via /rest/v1/rpc/register_login_identity and mint a login
-- identity for ANY role against ANY entity.
--
-- PROVEN LIVE on 2026-08-25, inside a transaction that was rolled back. A JWT
-- carrying app_role=subscriber, subscriberId=s-0001 called:
--
--   select public.register_login_identity(
--            '+256711999888', 'admin', 'admin-001', 'Escalation Probe', …);
--
-- and it returned '+256711999888' having written BOTH:
--   public.users          id='admin:+256711999888'  role='admin'  entity_id='admin-001'
--   public.demo_personas  phone='+256711999888'     role='admin'  entity_id='admin-001'
--
-- The attacker chooses the phone, so they control it. And per CLAUDE.md §8 the
-- demo OTP route accepts ANY 6-digit code. So the next step is simply to sign in
-- on that phone and be an admin — with platform-wide visibility across every
-- distributor, employer and member.
--
-- This is a wider hole than A02-001. A02-001 lets a subscriber inflate their own
-- balance; this hands over the whole platform.
--
-- The function's only existing check is:
--     IF EXISTS (… demo_personas WHERE phone=v_phone AND role=p_role
--                  AND entity_id IS DISTINCT FROM p_entity_id) THEN RETURN NULL;
-- which prevents HIJACKING an existing phone+role binding. It does nothing at
-- all to stop MINTING A NEW ONE, which is the attack.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- Revoke EXECUTE. Do NOT add a role guard inside the body: the function's three
-- legitimate callers all need it to run in contexts where the *caller* may not
-- be an admin (a public access-request approval, tenant creation), and a body
-- guard would have to encode all three exceptions — more surface, not less.
--
-- All three callers are SECURITY DEFINER, verified live:
--     approve_access_request (DEFINER) · create_distributor (DEFINER) · create_employer (DEFINER)
-- A SECURITY DEFINER function executes as its OWNER, so it reaches
-- register_login_identity through the owner's privileges, not the caller's.
-- Revoking from anon/authenticated therefore breaks none of them. No application
-- code calls it directly either (only src/test/login-identity-contract.test.js
-- references it, and that reads MIGRATION FILES rather than calling the RPC).
--
-- ── ALSO REVOKED: eight trigger functions ──────────────────────────────────
-- Supabase's advisor flags these as anon/authenticated-executable SECURITY
-- DEFINER functions. They cannot actually be invoked through PostgREST (Postgres
-- refuses to call a `RETURNS trigger` function directly), so this is hygiene
-- rather than a hole — but it removes eight standing warnings that would
-- otherwise mask a real one.
--
-- Verified empirically before doing it, rather than assumed: a role with EXECUTE
-- REVOKED on a trigger function still has the trigger fire normally, because
-- Postgres performs no EXECUTE check at trigger-fire time.
--     has_function_privilege('probe_user','_t_probe_fn()','EXECUTE') -> f
--     INSERT as probe_user -> trigger fired, NEW.touched -> t
-- ============================================================================

-- ── The escalation fix ──────────────────────────────────────────────────────
-- FROM PUBLIC as well as the named roles. Postgres's DEFAULT for a function is
-- EXECUTE to PUBLIC, which shows in pg_proc.proacl as a leading `=X/owner` entry
-- and is NOT removed by revoking from anon/authenticated individually. Live
-- currently has an explicit grant and no PUBLIC entry for this function, so the
-- named revoke alone would suffice today — but a future CREATE OR REPLACE that
-- drops the ACL would silently restore the PUBLIC default and re-open A03-101.
REVOKE EXECUTE ON FUNCTION
  public.register_login_identity(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.register_login_identity(text, text, text, text, text, text) IS
  'Binds a phone to a (role, entity) login identity. SECURITY DEFINER with NO role '
  'guard by design — its callers (approve_access_request, create_distributor, '
  'create_employer) are themselves SECURITY DEFINER and reach it as the owner. '
  'EXECUTE is deliberately NOT granted to anon or authenticated: it was, and any '
  'signed-in subscriber could mint an admin identity on a phone they control and '
  'then sign in as admin (finding A03-101, proven 2026-08-25, migration 0128). '
  'Do not re-grant it.';

-- ── Trigger functions: hygiene ──────────────────────────────────────────────
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prorettype = 'trigger'::regtype
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    -- PUBLIC first: trigger functions here carry the default `=X/postgres`
    -- PUBLIC grant, which revoking from anon/authenticated alone leaves intact.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    n := n + 1;
    RAISE NOTICE 'revoked EXECUTE on trigger function: %', r.proname;
  END LOOP;
  RAISE NOTICE '% trigger function(s) revoked.', n;
END $$;

-- ── Guards ──────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad int;
BEGIN
  IF has_function_privilege('authenticated',
       'public.register_login_identity(text,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.register_login_identity(text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: register_login_identity is still executable by a client role.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname='public' AND p.prorettype='trigger'::regtype
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % trigger function(s) still client-executable.', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  -- The three legitimate callers must still exist and still be DEFINER, or the
  -- revoke above has broken tenant creation and access-request approval.
  SELECT count(*) INTO v_bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname IN ('approve_access_request','create_distributor','create_employer')
     AND p.prosecdef;
  IF v_bad <> 3 THEN
    RAISE EXCEPTION 'ABORT: expected 3 SECURITY DEFINER callers, found %.', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'A03-101 closed: register_login_identity is no longer client-callable.';
END $$;
