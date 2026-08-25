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
-- ⚠️ RESTORE THE PARENT RUN HEADERS FIRST.
-- 57 of the snapshot's transactions carry a `contribution_run_id`, and one of
-- those parents — run-73a0e5c89d06448fb7b49696fe8946b4, the orphan "E2E Run"
-- header — was deleted by migration 0134. Without this block the transaction
-- INSERT below dies on transactions_contribution_run_id_fkey and the whole
-- recovery aborts. (Found by running this script after 0134 shipped; the
-- failure is silent-looking, so it is exactly the kind that only appears on the
-- day you actually need the restore.)
--
-- 0134 snapshotted contribution_runs before deleting, so the parent is
-- recoverable. Only rows the snapshot needs and live lacks are re-inserted.
INSERT INTO public.contribution_runs
SELECT r.* FROM public.contribution_runs_pre_purge_20260825 r
 WHERE r.id IN (
   SELECT DISTINCT s.contribution_run_id
     FROM public.transactions_pre_purge_20260824 s
    WHERE s.contribution_run_id IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM public.contribution_runs c WHERE c.id = r.id);

DO $$
DECLARE v_missing INT;
BEGIN
  SELECT count(*) INTO v_missing
    FROM public.transactions_pre_purge_20260824 s
   WHERE s.contribution_run_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.contribution_runs r WHERE r.id = s.contribution_run_id);
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'ABORT: % snapshot transaction(s) still reference a run header that does not exist and is not in 0134''s snapshot. The FK insert below would fail. Recover the parent runs first.', v_missing
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE public.transactions DISABLE TRIGGER transactions_after_insert_contribution;
ALTER TABLE public.transactions DISABLE TRIGGER transactions_after_insert_withdrawal;

INSERT INTO public.transactions
SELECT * FROM public.transactions_pre_purge_20260824 s
 WHERE NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = s.id);

ALTER TABLE public.transactions ENABLE TRIGGER transactions_after_insert_contribution;
ALTER TABLE public.transactions ENABLE TRIGGER transactions_after_insert_withdrawal;

-- ⚠️ The INSERT above re-fires `transactions_after_insert_contribution`, which
-- is NOT inert: for a save_to_cover member it can re-cross the accrual target,
-- flip insurance_policies back to 'active' with a fresh policy_start /
-- renewal_date, insert sweep transactions that were never in the snapshot, and
-- zero contribution_schedules.insurance_premium_target/accrued. The final guard
-- only counts snapshot ids, so it passes while those extras persist.
--
-- The restore is meant to be VERBATIM. The triggers are disabled around it and
-- the balances are then written from the snapshot directly (below), which is
-- the authoritative state — re-deriving it from replayed inserts is exactly the
-- recomputation this script exists to avoid.
--
-- NOTE the ordering: this block must run BEFORE the INSERT. It is written after
-- it only in this comment; see the ALTER TABLE pair that now brackets it.

-- Restore the affected balances VERBATIM from the snapshot.
-- Deliberately NOT a recomputation: recomputing is not a perfect inverse of the
-- incremental history the trigger built (a recompute round trip was measured
-- 2,022,125 UGX / 0.08% off on the scratch restore). Verbatim is exact.
--
-- ⚠️ retirement_balance / emergency_balance ARE RESTORED TOO, and must be.
-- This script used to set only units/total_balance/*_units. Migration 0114 then
-- added, VALIDATED and IMMEDIATE:
--     subscriber_balances_bucket_sum_chk
--       CHECK (retirement_balance + emergency_balance = total_balance)
-- Restoring total_balance while leaving the buckets at their post-purge values
-- violates it, so this UPDATE ABORTED — measured against live: 19 of 19
-- affected members would have failed. The only undo for a destructive purge of
-- production data, on a free tier with no PITR, was dead.
--
-- The header's "PROVEN against a scratch PostgreSQL 18 database" was true when
-- written and stopped being true when 0114 shipped: that proof ran against a
-- dump taken before the constraint existed. A recovery script is only as
-- verified as its LAST run against the schema it will actually meet.
--
-- `invested` (cost basis) and `nav_as_of` are restored for the same reason —
-- 0110 repriced the book at :257-260, so every derived column moved, not just
-- the ones it decremented.
UPDATE public.subscriber_balances b
   SET units              = s.units,
       total_balance      = s.total_balance,
       retirement_units   = s.retirement_units,
       emergency_units    = s.emergency_units,
       retirement_balance = s.retirement_balance,
       emergency_balance  = s.emergency_balance,
       invested           = s.invested,
       nav_as_of          = s.nav_as_of
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
