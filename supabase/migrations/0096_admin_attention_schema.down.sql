-- 0096_admin_attention_schema.down.sql
-- Reverses 0096. Run AFTER 0098.down.sql and 0097.down.sql — the RPCs in 0097
-- read v_reconciliation_exceptions and the two new tables, and the 0098 DML
-- lives in them.
--
-- The frontend must be reverted in the same change: the admin Needs-attention
-- card renders `useAdminAttention`, whose service falls back to zeros on error,
-- so without the revert the card silently shows 10 all-clear rows instead of
-- surfacing the failure.

-- Value domain (the SELECT policies are NOT dropped here — 0049/0081 own them).
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_recipient_role_check;

DROP VIEW IF EXISTS public.v_reconciliation_exceptions;

-- Payout SLA columns. Dropping expected_by also drops its DEFAULT, which is what
-- request_withdrawal relies on; no RPC re-emission is needed either way because
-- that function never names the column.
ALTER TABLE public.claims      DROP COLUMN IF EXISTS expected_by;
ALTER TABLE public.withdrawals DROP COLUMN IF EXISTS expected_by;

-- Tables (policies + indexes go with them).
DROP TABLE IF EXISTS public.custody_transfers;
DROP TABLE IF EXISTS public.nav_snapshots;
