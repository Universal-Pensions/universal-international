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
ALTER TABLE public.transactions        DROP CONSTRAINT IF EXISTS transactions_priced_complete_chk;
ALTER TABLE public.transactions        DROP CONSTRAINT IF EXISTS transactions_pricing_status_chk;

ALTER TABLE public.transactions ALTER COLUMN dealing_date DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN received_at  DROP NOT NULL;
