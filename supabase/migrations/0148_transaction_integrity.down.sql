-- DOWN for 0148_transaction_integrity.sql
-- ============================================================================
-- Removes the mutation guard and the reversal path, and restores the two money
-- triggers' original WHEN clauses.
--
-- REGRESSION WARNING. After this the ledger is unguarded again: an UPDATE to a
-- priced transaction's amount, or a DELETE of one, silently desyncs the book —
-- the money triggers fire on INSERT and only on INSERT, so nothing recomputes
-- the balances. Deleting an allocated contribution leaves the units it bought
-- owned by nobody while they stay priced into AUM.
--
-- ⚠️ THE WHEN-CLAUSE REVERSION IS THE DANGEROUS HALF. 0148 narrowed both money
--    triggers to `new.units_delta IS NULL`, which is what stops a row that
--    ARRIVES already carrying its unit movement from being accounted for a
--    second time. Restoring the broad clauses is safe only because
--    reverse_transaction() — the only writer of such rows — is dropped in the
--    same file. If you keep the reversal function and revert the triggers,
--    every reversal will apply itself twice.
-- ============================================================================

DROP TRIGGER   IF EXISTS transactions_guard_mutation ON public.transactions;
DROP FUNCTION  IF EXISTS public.trg_transactions_guard_mutation();
DROP FUNCTION  IF EXISTS public.reverse_transaction(TEXT, TEXT);
DROP VIEW      IF EXISTS public.v_pending_pricing_orphans;

DROP TRIGGER IF EXISTS transactions_after_insert_contribution ON public.transactions;
CREATE TRIGGER transactions_after_insert_contribution
  AFTER INSERT ON public.transactions
  FOR EACH ROW WHEN (new.type = 'contribution')
  EXECUTE FUNCTION public.trg_transactions_contribution();

DROP TRIGGER IF EXISTS transactions_after_insert_withdrawal ON public.transactions;
CREATE TRIGGER transactions_after_insert_withdrawal
  AFTER INSERT ON public.transactions
  FOR EACH ROW WHEN (new.type = 'withdrawal')
  EXECUTE FUNCTION public.trg_transactions_withdrawal();
