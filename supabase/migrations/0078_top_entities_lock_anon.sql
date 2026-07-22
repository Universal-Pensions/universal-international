-- =============================================================================
-- Universal Pensions Uganda — 0078: lock get_top_entities to authenticated only
-- =============================================================================
-- 0077 created get_top_entities with the pre-0075 grant idiom (REVOKE FROM PUBLIC
-- + GRANT authenticated). Supabase's default privileges still auto-grant EXECUTE
-- to `anon`, so the function was anon-callable (though its in-body app_role gate
-- rejects unauthenticated callers). 0075 (lock_privilege_surface) established the
-- current convention of an explicit `REVOKE EXECUTE ... FROM anon` on every
-- SECURITY DEFINER RPC for defense-in-depth; this brings 0077 in line, clearing
-- the anon_security_definer_function_executable advisor (lint 0028).
--
-- Only distributor/admin land on the country overview that calls this RPC, and
-- the frontend always calls it with an authenticated JWT — so anon never needs it.
-- Idempotent. Forward-only per BACKEND.md §7.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.get_top_entities(TEXT, TEXT, INT) FROM anon;

-- =============================================================================
-- End of 0078_top_entities_lock_anon.sql
-- =============================================================================
