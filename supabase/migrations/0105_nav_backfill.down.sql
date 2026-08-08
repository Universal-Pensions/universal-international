-- =============================================================================
-- DOWN for 0105_nav_backfill.sql
-- =============================================================================
-- Run order for the full NAV trio: 0105.down (this) -> 0104.down -> 0103.down.
--
-- This is the ONE down in the trio that restores MONEY. It puts every member's
-- units, cost basis and all three balance columns back to the values captured in
-- public.subscriber_balances_pre_nav, and restores the per-member unit values
-- from public.subscribers_unit_value_pre_nav.
--
-- ⚠️ It FAILS LOUDLY if either snapshot table is missing, rather than leaving
--    the book half-restored. If they have been dropped, there is no way back
--    from this migration and the balances must be rebuilt by reseeding.
--
-- ⚠️ NOT PERFECTLY REVERSIBLE IF PRICES WERE PUBLISHED AFTERWARDS. Any NAV the
--    admin published after 0105 revalued the book again; this restores the
--    pre-0105 figures regardless, discarding those revaluations. That is the
--    intended behaviour — the snapshot is the reference point, not the latest
--    state.
--
-- nav_snapshots rows written by 0105 are removed, but 0098's own seeded rows are
-- preserved: only rows whose source marks them as this migration's are deleted,
-- and the 4 status='pending' rows are never touched.
-- =============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.subscriber_balances_pre_nav') IS NULL THEN
    RAISE EXCEPTION 'subscriber_balances_pre_nav is missing — cannot restore balances';
  END IF;
  IF to_regclass('public.subscribers_unit_value_pre_nav') IS NULL THEN
    RAISE EXCEPTION 'subscribers_unit_value_pre_nav is missing — cannot restore unit values';
  END IF;
END
$guard$;

UPDATE public.subscriber_balances b
   SET retirement_balance = s.retirement_balance,
       emergency_balance  = s.emergency_balance,
       total_balance      = s.total_balance,
       units              = s.units,
       retirement_units   = s.retirement_units,
       emergency_units    = s.emergency_units,
       invested           = s.invested,
       nav_as_of          = s.nav_as_of,
       updated_at         = now()
  FROM public.subscriber_balances_pre_nav s
 WHERE b.subscriber_id = s.subscriber_id;

UPDATE public.subscribers t
   SET current_unit_value = s.current_unit_value,
       unit_value_as_of   = s.unit_value_as_of
  FROM public.subscribers_unit_value_pre_nav s
 WHERE t.id = s.id;

-- Remove only the rows this migration authored. 0098's seeded register and its
-- 4 pending valuation days survive, so the "Delayed NAV updation" signal keeps
-- working after a rollback.
DELETE FROM public.nav_snapshots
 WHERE fund_code = 'UPU-BAL'
   AND source    = 'nav_backfill_0105'
   AND status    = 'published';

DROP TABLE IF EXISTS public.subscribers_unit_value_pre_nav;
DROP TABLE IF EXISTS public.subscriber_balances_pre_nav;

COMMIT;
