-- 0135_reanchor_employer_recent_hires.down.sql
-- ============================================================================
-- Undo for 0135 — move the five recent-hire members (and their single
-- transaction each) back 8 days.
--
-- Symmetric by construction: 0135's shift is exactly +8 days, so -8 restores it
-- precisely. No snapshot is needed for a pure constant offset — unlike 0134,
-- which moved a per-employer computed amount and therefore ships snapshots.
--
-- ⚠️ REVERTING RE-OPENS the second half of the 0126 regression: the admin
-- "Employers" New-Members tiles go back to reading 0 today / 0 this week /
-- 0 this month while the previous-period tiles hold 2 and 4.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _hires ON COMMIT DROP AS
SELECT id FROM public.subscribers
 WHERE id IN ('empe-017', 'empe-018', 'empe-019', 'empe-020', 'empe-021');

UPDATE public.transactions t
   SET date = t.date - INTERVAL '8 days'
 WHERE t.subscriber_id IN (SELECT id FROM _hires);

UPDATE public.subscribers s
   SET registered_date = s.registered_date - 8,
       last_contribution_date = CASE
         WHEN s.last_contribution_date IS NULL THEN NULL
         ELSE s.last_contribution_date - 8 END
 WHERE s.id IN (SELECT id FROM _hires);

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad
    FROM public.subscribers s JOIN public.transactions t ON t.subscriber_id = s.id
   WHERE s.id IN (SELECT id FROM _hires) AND t.date::date <> s.registered_date;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: % transaction(s) no longer sit on their join date.', v_bad USING ERRCODE = 'P0001';
  END IF;
  RAISE WARNING 'REVERTED: employer New-Members tiles will read zero again.';
END $$;

COMMIT;
