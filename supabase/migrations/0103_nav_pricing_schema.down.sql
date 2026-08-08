-- =============================================================================
-- DOWN for 0103_nav_pricing_schema.sql
-- =============================================================================
-- Run order for the full NAV trio: 0105.down → 0104.down → 0103.down.
-- Running this while 0104 is still applied will BREAK the money path —
-- trg_transactions_contribution and request_withdrawal call nav_for_date() and
-- _resync_bucket_units(), and dropping them leaves both functions raising on
-- every contribution and withdrawal.
--
-- ⚠️ This restores SCHEMA, not MONEY. It drops the cost-basis and bucket-unit
--    columns outright; the figures in them are gone. 0105's down is the one that
--    restores balances, and it needs the pre-0105 snapshot table to do it.
--
-- ⚠️ nav_snapshots is DELIBERATELY NOT DROPPED. It is owned by
--    0096_admin_attention_schema.sql and still powers the "Delayed NAV updation"
--    signal. Only the four columns 0103 added come off.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public._resync_bucket_units(TEXT);
DROP FUNCTION IF EXISTS public.latest_nav(TEXT);
DROP FUNCTION IF EXISTS public.nav_for_date(DATE, TEXT);

ALTER TABLE public.subscriber_balances
  DROP COLUMN IF EXISTS retirement_units,
  DROP COLUMN IF EXISTS emergency_units,
  DROP COLUMN IF EXISTS invested,
  DROP COLUMN IF EXISTS nav_as_of;

ALTER TABLE public.nav_snapshots
  DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS units_in_issue,
  DROP COLUMN IF EXISTS aum,
  DROP COLUMN IF EXISTS members_priced;

COMMENT ON COLUMN public.nav_snapshots.unit_price IS NULL;

COMMIT;
