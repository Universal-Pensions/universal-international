-- 0134_reanchor_employer_runs.down.sql
-- ============================================================================
-- Undo for 0134 — restore run dates, labels and the deleted E2E run header.
--
-- Restores VERBATIM FROM THE SNAPSHOTS, never recomputed. That is the house
-- rule and it was learned the hard way: 0110's recovery originally rebuilt
-- balances arithmetically and the round trip came back 2,022,125 UGX (0.08%)
-- off. Only a snapshot restores what was actually there.
--
-- ⚠️ REVERTING RE-OPENS THE REGRESSION. It puts emp-001's newest legs back 44
-- days before the demo clock, so the admin "Employers" trends strip returns to
-- reading zero across every current-period tile, and re-inserts the orphan
-- "E2E Run 1785753040826" header that inflates emp-001's run total by 4.7M.
-- ============================================================================

BEGIN;

DO $$
DECLARE v_runs INT; v_txns INT;
BEGIN
  IF to_regclass('public.contribution_runs_pre_purge_20260825') IS NULL
     OR to_regclass('public.transactions_runshift_pre_purge_20260825') IS NULL THEN
    RAISE EXCEPTION 'ABORT: 0134 snapshot table(s) missing — nothing to restore from.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_runs FROM public.contribution_runs_pre_purge_20260825;
  SELECT COUNT(*) INTO v_txns FROM public.transactions_runshift_pre_purge_20260825;
  RAISE NOTICE 'restoring from snapshot: % run(s), % leg(s)', v_runs, v_txns;
END $$;

-- Dates + labels back to their pre-shift values.
UPDATE public.contribution_runs r
   SET run_at = s.run_at, period_label = s.period_label
  FROM public.contribution_runs_pre_purge_20260825 s
 WHERE s.id = r.id;

UPDATE public.transactions t
   SET date = s.date
  FROM public.transactions_runshift_pre_purge_20260825 s
 WHERE s.id = t.id;

-- The removed orphan run header.
INSERT INTO public.contribution_runs
SELECT * FROM public.contribution_runs_pre_purge_20260825 s
 WHERE NOT EXISTS (SELECT 1 FROM public.contribution_runs r WHERE r.id = s.id);

DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.contribution_runs;
  IF v_n <> (SELECT COUNT(*) FROM public.contribution_runs_pre_purge_20260825) THEN
    RAISE EXCEPTION 'ABORT: run count % does not match the snapshot.', v_n USING ERRCODE = 'P0001';
  END IF;
  RAISE WARNING 'REVERTED: employer trends strip will read zero again (0126 regression re-opened).';
END $$;

-- Snapshots are deliberately NOT dropped: they are the only copy, and 0132's
-- standing guard expects every %_pre_purge_% table to stay secured.

COMMIT;
