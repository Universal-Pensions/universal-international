-- 0110_unpurge.sql — restore the employer-run residue purged by 0110.
-- ============================================================================
-- PROVEN 2026-08-25 against a scratch PostgreSQL 18 database restored from a
-- live pg_dump: 1,881 rows restored, all 5,060 balances back to their exact
-- pre-purge values.
--
-- This exists because 0110 deletes live production data on a free tier with NO
-- point-in-time recovery. It is the only per-row undo there is.
--
-- Requires public.transactions_pre_purge_20260824, created by 0110.
-- That table is on the DO-NOT-DROP list. If it is gone, this file cannot help
-- you and you are on the full pg_dump (see docs/rollback.md §4).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.transactions_pre_purge_20260824') IS NULL
     OR to_regclass('public.subscriber_balances_pre_purge_20260824') IS NULL THEN
    RAISE EXCEPTION
      'ABORT: a 0110 pre-purge snapshot table is missing. 0110 either never ran '
      'or its snapshot was dropped. Recover from the pg_dump instead — see docs/rollback.md.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Restore only rows that are actually missing, so this is safe to re-run.
INSERT INTO public.transactions
SELECT * FROM public.transactions_pre_purge_20260824 s
 WHERE NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = s.id);

-- Restore the affected balances VERBATIM from the snapshot.
-- Deliberately NOT a recomputation: recomputing is not a perfect inverse of the
-- incremental history the trigger built (a recompute round trip was measured
-- 2,022,125 UGX / 0.08% off on the scratch restore). Verbatim is exact.
UPDATE public.subscriber_balances b
   SET units             = s.units,
       total_balance     = s.total_balance,
       retirement_units  = s.retirement_units,
       emergency_units   = s.emergency_units
  FROM public.subscriber_balances_pre_purge_20260824 s
 WHERE b.subscriber_id = s.subscriber_id;

DO $$
DECLARE v_restored bigint; v_expected bigint;
BEGIN
  SELECT count(*) INTO v_expected FROM public.transactions_pre_purge_20260824;
  SELECT count(*) INTO v_restored FROM public.transactions t
   WHERE EXISTS (SELECT 1 FROM public.transactions_pre_purge_20260824 s WHERE s.id = t.id);
  IF v_restored <> v_expected THEN
    RAISE EXCEPTION 'ABORT: restored % of % rows.', v_restored, v_expected USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'Restored % rows. Verify AUM and the employer dashboard before dropping anything.', v_restored;
END $$;

COMMIT;
