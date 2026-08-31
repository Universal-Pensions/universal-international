-- DOWN for 0150_close_pending_orphans_leak.sql
-- ============================================================================
-- ⚠️ THIS RE-OPENS A CROSS-TENANT PII LEAK. Read 0150's header before running.
--
-- Restoring the SELECT grant on v_pending_pricing_orphans lets any signed-in
-- user of any role read every member's name and pending money through
-- PostgREST, because the view executes with its owner's privileges and so
-- bypasses RLS on transactions and subscribers.
--
-- The only defensible reason to run this is to reach the exact post-0148 state
-- while reversing 0148 itself.
-- ============================================================================

ALTER VIEW public.v_pending_pricing_orphans RESET (security_invoker);
GRANT SELECT ON public.v_pending_pricing_orphans TO authenticated;

GRANT SELECT ON public.business_holidays     TO authenticated;
GRANT SELECT ON public.fund_dealing_config   TO authenticated;
GRANT SELECT ON public.nav_snapshot_versions TO authenticated;
