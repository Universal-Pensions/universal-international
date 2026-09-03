-- DOWN for 0141_distributor_geography_revoke_anon.sql
-- ============================================================================
-- Restores the `anon` EXECUTE grant that 0140's DROP + CREATE left in place.
-- This is a FAITHFUL reversal, not a good state: it re-widens an admin-gated
-- RPC to unauthenticated callers. Only run it to get back to the exact
-- post-0140 ACL — e.g. while reverting 0140 itself, which drops this function
-- signature outright and makes the grant moot anyway.
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text, text, text, text) TO anon;
