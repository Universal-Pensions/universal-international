-- =============================================================================
-- DOWN — 0100: nominee claim intake
-- =============================================================================
-- LOSSY: drops the table and every submitted claim with it. Nothing else
-- references nominee_claims (its only FK points OUT, at subscribers), so the
-- drop is safe in any order.
-- =============================================================================

DROP FUNCTION IF EXISTS public.review_nominee_claim(text, text, text, text);
DROP FUNCTION IF EXISTS public.list_nominee_claims(text);

DROP POLICY IF EXISTS nominee_claims_select_admin ON public.nominee_claims;

DROP INDEX IF EXISTS public.nominee_claims_matched_subscriber_idx;
DROP INDEX IF EXISTS public.nominee_claims_status_idx;

DROP TABLE IF EXISTS public.nominee_claims;
