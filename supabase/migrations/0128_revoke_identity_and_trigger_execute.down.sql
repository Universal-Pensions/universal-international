-- 0128_…down.sql
--
-- ⚠️ RUNNING THIS RE-OPENS A PROVEN PRIVILEGE ESCALATION TO ADMIN (A03-101).
--
-- With EXECUTE restored to `authenticated`, any signed-in subscriber can call
-- register_login_identity and mint an admin login identity on a phone they
-- control, then sign in as admin — the demo OTP route accepts any 6-digit code.
-- Demonstrated live on 2026-08-25.
--
-- There is no legitimate reason to run this. It exists only so 0128 is formally
-- reversible. The function's three real callers are SECURITY DEFINER and reach it
-- as the owner; they do NOT need this grant.

GRANT EXECUTE ON FUNCTION
  public.register_login_identity(text, text, text, text, text, text)
  TO anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname='public' AND p.prorettype='trigger'::regtype
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END $$;
