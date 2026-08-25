-- 0133_demo_id_cards.down.sql
-- ============================================================================
-- Undo for 0133 — drop the demo ID-card pool and its claim RPC.
--
-- SAFE TO RUN. api/kyc/id-ocr.ts treats a missing/failing pool exactly like an
-- exhausted one and falls back to mintIdentity() (the seeded PRNG), which is
-- retained for precisely this reason. So reverting degrades to TODAY'S working
-- behaviour, not to the original A11-002 breakage where the mock returned one
-- constant NIN and the second onboarding 409'd forever.
--
-- The only loss is demo-data quality: scanned IDs go back to being generated
-- rather than curated.
--
-- `subscriber_id` is ON DELETE SET NULL, so dropping this table cannot cascade
-- into `subscribers`. No member data is touched.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.claim_demo_id_card(TEXT);
DROP TABLE IF EXISTS public.demo_id_cards;

DO $$
BEGIN
  IF to_regclass('public.demo_id_cards') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: demo_id_cards still exists after DROP.' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'reverted — demo_id_cards and claim_demo_id_card dropped; id-ocr falls back to the PRNG.';
END $$;

COMMIT;
