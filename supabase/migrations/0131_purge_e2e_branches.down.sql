-- 0131_purge_e2e_branches.down.sql
-- ============================================================================
-- Undo for 0131 — restore the two E2E-leftover branch rows.
--
-- Restores VERBATIM FROM THE SNAPSHOT, never recomputed. That is the house rule
-- and it was learned the hard way: 0110's recovery originally rebuilt balances
-- by recomputing them and the round trip came back 2,022,125 UGX (0.08%) off.
-- A snapshot is the only thing that restores what was actually there.
--
-- Restoring these rows re-creates the exact A12-I01 condition (two E2E branches
-- polluting d-kampala). It exists so the purge is reversible, not because
-- reverting is desirable.
-- ============================================================================

BEGIN;

DO $$
DECLARE v_snap int; v_live int;
BEGIN
  IF to_regclass('public.branches_e2e_pre_purge_20260825') IS NULL THEN
    RAISE EXCEPTION 'ABORT: snapshot table branches_e2e_pre_purge_20260825 does not exist. Nothing to restore from.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_snap FROM public.branches_e2e_pre_purge_20260825;
  IF v_snap <> 2 THEN
    RAISE EXCEPTION 'ABORT: snapshot holds % row(s), expected 2.', v_snap USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_live
    FROM public.branches b
    JOIN public.branches_e2e_pre_purge_20260825 s ON s.id = b.id;
  IF v_live <> 0 THEN
    RAISE EXCEPTION 'ABORT: % of the 2 rows are already live. 0131 was not applied, or was already reverted.', v_live
      USING ERRCODE = 'P0001';
  END IF;
END $$;

INSERT INTO public.branches
SELECT * FROM public.branches_e2e_pre_purge_20260825;

DO $$
DECLARE v_kampala int;
BEGIN
  SELECT count(*) INTO v_kampala FROM public.branches WHERE district_id = 'd-kampala';
  IF v_kampala <> 10 THEN
    RAISE EXCEPTION 'ABORT: Kampala has % branches after restore, expected 10.', v_kampala USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'restore OK — 2 rows returned, Kampala back to 10.';
END $$;

-- The snapshot table is deliberately NOT dropped. It is the only copy, and
-- 0127's standing guard expects every %_pre_purge_% table to stay secured.

COMMIT;
