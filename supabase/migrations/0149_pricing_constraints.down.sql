-- DOWN for 0149_pricing_constraints.sql
-- ============================================================================
-- Drops the four constraints and re-drops the two NOT NULLs. Instant, loses
-- nothing but the guarantees.
--
-- Nothing here is destructive: no row changes, and every value that satisfied
-- the constraints still satisfies nothing at all afterwards. Run it only if a
-- constraint is genuinely blocking legitimate work — and if one is, the more
-- likely reading is that the code writing that row is wrong.
-- ============================================================================

ALTER TABLE public.subscriber_balances DROP CONSTRAINT IF EXISTS subscriber_balances_pending_chk;
ALTER TABLE public.transactions        DROP CONSTRAINT IF EXISTS transactions_units_sign_chk;
ALTER TABLE public.transactions        DROP CONSTRAINT IF EXISTS transactions_pricing_status_chk;

-- ⚠️ THE COMPLETENESS RULE IS A CONSTRAINT TRIGGER, NOT A CHECK.
--    An earlier version of this file dropped `transactions_priced_complete_chk`
--    — the CHECK constraint that 0149's forward migration itself deletes on its
--    way to replacing it. `DROP CONSTRAINT IF EXISTS` on a name that no longer
--    exists succeeds silently, so this file APPEARED to reverse 0149 while
--    leaving the actual enforcement fully live. Worse, the surviving trigger
--    reads `pricing_status`, `units_delta` and `received_at`, so a later
--    0144.down that drops those columns would then fail on a dependency nobody
--    knew was still there.
DROP TRIGGER  IF EXISTS transactions_priced_complete ON public.transactions;
DROP FUNCTION IF EXISTS public.trg_transactions_priced_complete();

ALTER TABLE public.transactions ALTER COLUMN dealing_date DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN received_at  DROP NOT NULL;
