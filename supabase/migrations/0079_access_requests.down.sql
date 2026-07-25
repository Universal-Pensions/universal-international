-- =============================================================================
-- Down: 0079_access_requests
-- =============================================================================
-- Reverses 0079: drops the admin RPCs, the RLS policy, and the table. Order:
-- functions → policy → table (the policy is dropped with the table's CASCADE,
-- but we drop it explicitly first for symmetry with the forward migration).
-- =============================================================================

DROP FUNCTION IF EXISTS public.deny_access_request(text);
DROP FUNCTION IF EXISTS public.approve_access_request(text);
DROP FUNCTION IF EXISTS public.list_access_requests(text);

DROP POLICY IF EXISTS access_requests_select_admin ON public.access_requests;

DROP TABLE IF EXISTS public.access_requests;
