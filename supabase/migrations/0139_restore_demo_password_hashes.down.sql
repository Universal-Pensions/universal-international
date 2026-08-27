-- 0139_restore_demo_password_hashes.down.sql
-- ============================================================================
-- Reverse of 0139: clear the password hash on the two demo rows it repaired,
-- returning them to `401 password_not_set`.
--
-- Scoped to the exact hash 0139 wrote, so if a real user has since rotated
-- either credential through /api/auth/change-password this leaves that new hash
-- alone rather than destroying it.
--
-- Running this re-breaks a documented demo affordance (CLAUDE.md §8). It exists
-- so 0139 is not another "up with no down" — the 2026-08-26 review counted 25
-- of those (§2.2).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_hash CONSTANT TEXT := '$2a$10$oTwaONtnV0bWgL7bUa5xzuP13lUIcbtqV48JL4F.iLIu3l7hAnQtq';
  v_n INT;
BEGIN
  UPDATE public.users
     SET password_hash = NULL
   WHERE (phone, role) IN (('+256700000021','distributor'), ('+256711000001','subscriber'))
     AND password_hash = v_hash;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '0139.down: cleared % row(s).', v_n;
END $$;

COMMIT;
