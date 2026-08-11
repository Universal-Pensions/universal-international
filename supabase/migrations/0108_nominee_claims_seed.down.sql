-- =============================================================================
-- DOWN — 0108: demo population for the nominee-claim queue
-- =============================================================================
-- Deletes exactly the rows 0108 inserted and nothing else.
--
-- The `nc-demo-` id prefix is what makes this safe: real claims arrive from
-- api/nominee-claim.ts with the table's DEFAULT id (`nc-` + a bare uuid, no
-- `demo-` segment), so a genuinely submitted claim can never match this pattern.
-- Deleting by status or by date would not have that property.
--
-- NOT lossy for anything else: `nominee_claims` is referenced by no other table
-- (its only FK points OUT, at subscribers), and nothing was mutated on the way
-- in — 0108 is INSERT-only.
-- =============================================================================

DELETE FROM public.nominee_claims WHERE id LIKE 'nc-demo-%';

DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left FROM public.nominee_claims WHERE id LIKE 'nc-demo-%';
  IF v_left > 0 THEN
    RAISE EXCEPTION '0108 down left % demo nominee claims behind', v_left;
  END IF;
  RAISE NOTICE '0108 down: demo nominee claims removed; % real claims remain',
    (SELECT count(*) FROM public.nominee_claims);
END $$;
