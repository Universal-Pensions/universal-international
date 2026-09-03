-- 0164_employer_run_history_backfill.down.sql
-- ============================================================================
-- Reverses 0164: removes the 24 backfilled runs and their legs, and restores
-- the 37 members' balances to the snapshot taken before any units were credited.
--
-- ORDER MATTERS. Legs first, then balances, then runs:
--   • deleting a leg does NOT unwind its unit allocation — nothing recomputes
--     balances on delete — so the restore has to follow the delete, not precede
--     it, or the units would be credited back on top of the restored figures;
--   • the runs go last because the legs FK to them.
--
-- `trg_transactions_guard_mutation` refuses to delete a priced row that moved
-- units. Its own HINT names the way through for a migration that genuinely must:
-- SET LOCAL app.allow_transaction_mutation = 'on'. That is deliberate here — the
-- balances are being restored wholesale from the snapshot in the same
-- transaction, so the units are not left owned by nobody.
-- ============================================================================

-- NOTE: no BEGIN/COMMIT here — see the up migration's note. SET LOCAL below
-- relies on the transaction scripts/apply-migration.mjs opens around the file.

SET LOCAL app.allow_transaction_mutation = 'on';

DO $$
BEGIN
  IF to_regclass('public.subscriber_balances_pre_0164') IS NULL THEN
    RAISE EXCEPTION
      '0164 down: public.subscriber_balances_pre_0164 is missing. Without it the credited units cannot be unwound and this rollback would leave 37 members holding units no ledger row supports. Restore the snapshot table first.';
  END IF;
END $$;

-- 1) The legs. Only ids this migration minted.
DELETE FROM public.transactions WHERE id LIKE 't-bf164-%';

-- 2) Balances back to the pre-backfill snapshot.
UPDATE public.subscriber_balances b
   SET retirement_balance = p.retirement_balance,
       emergency_balance  = p.emergency_balance,
       total_balance      = p.total_balance,
       units              = p.units,
       invested           = p.invested,
       nav_as_of          = p.nav_as_of,
       updated_at         = now()
  FROM public.subscriber_balances_pre_0164 p
 WHERE b.subscriber_id = p.subscriber_id;

-- A member with no snapshot row had no balance row before 0164 either, so the
-- backfill created it. Remove those rather than leaving a zeroed orphan.
DELETE FROM public.subscriber_balances b
 WHERE b.subscriber_id IN (SELECT id FROM public.subscribers
                            WHERE employer_id IN ('emp-002','emp-003','emp-004','emp-005','emp-006','emp-007'))
   AND NOT EXISTS (SELECT 1 FROM public.subscriber_balances_pre_0164 p
                    WHERE p.subscriber_id = b.subscriber_id);

-- 3) The runs.
DELETE FROM public.contribution_runs WHERE id LIKE 'run-emp%';

DO $$
DECLARE v_legs integer; v_runs integer;
BEGIN
  SELECT count(*) INTO v_legs FROM public.transactions       WHERE id LIKE 't-bf164-%';
  SELECT count(*) INTO v_runs FROM public.contribution_runs  WHERE id LIKE 'run-emp%';
  IF v_legs > 0 OR v_runs > 0 THEN
    RAISE EXCEPTION '0164 down: % leg(s) and % run(s) survived', v_legs, v_runs;
  END IF;
END $$;

DROP TABLE IF EXISTS public.subscriber_balances_pre_0164;
