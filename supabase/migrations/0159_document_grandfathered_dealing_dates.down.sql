-- DOWN for 0159_document_grandfathered_dealing_dates.sql
-- ============================================================================
-- Restores the previous column comment. No data or behaviour is involved either
-- way; the only loss is the explanation of why 9,290 rows carry a
-- non-business-day dealing date, which will then have to be reconstructed by
-- whoever notices it next.
-- ============================================================================

COMMENT ON COLUMN public.transactions.dealing_date IS
  'The date whose published price applies to this transaction. Derived ONCE at insert from received_at by dealing_date_for(). Never earlier than the Kampala calendar date of receipt.';
