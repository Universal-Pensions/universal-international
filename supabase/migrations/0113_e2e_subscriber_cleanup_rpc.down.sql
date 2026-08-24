-- =============================================================================
-- DOWN for 0113_e2e_subscriber_cleanup_rpc.sql
-- =============================================================================
-- Drops the RPC only. No data was written by 0113 (it only creates a
-- function), so there is nothing to restore. Once this runs,
-- e2e/fixtures/db.ts::cleanupSubscriberByPhone's own isMissingFunctionError
-- fallback takes over automatically (non-atomic, pre-0113 behaviour) — no
-- code change required.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.e2e_delete_subscriber_tree(text[]);

COMMIT;
