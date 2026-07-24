-- Down for 0075_lock_privilege_surface.sql
--
-- ⚠️  This reverses the PRIVILEGE changes (grants / policies / column REVOKEs) back to the
-- pre-0075 state. It intentionally does NOT restore the ungated function bodies — rolling those
-- back would re-open HIGH-1 (anon fabricates subscribers) and HIGH-2 (network commission leak).
-- The re-granted anon EXECUTE below is harmless while the in-body role gates remain: an anon call
-- is now rejected inside the function. If a TRUE full revert is ever required, restore the original
-- bodies from migrations 0041 (rollups) and 0044 (agent onboard) by hand.

-- Reverse HIGH-2 / C3 anon EXECUTE revokes
GRANT EXECUTE ON FUNCTION public.get_agent_commission_list(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_pending_dues_by_agent()      TO anon;
GRANT EXECUTE ON FUNCTION public.get_pending_dues_by_branch()     TO anon;
GRANT EXECUTE ON FUNCTION public.fund_insurance_products(text, text, jsonb, numeric, text) TO anon;

-- Reverse MED-1 column REVOKEs
GRANT UPDATE (agent_id, employer_id, compensation, kyc_status, is_active, nin)
  ON public.subscribers TO authenticated, anon;
GRANT UPDATE (insurance_funding_mode, insurance_premium_target,
              insurance_premium_accrued, last_indexed_at)
  ON public.contribution_schedules TO authenticated, anon;

-- Reverse B5 (restore the original world-readable policy)
DROP POLICY IF EXISTS distributors_select ON public.distributors;
CREATE POLICY distributors_select ON public.distributors
  FOR SELECT TO public
  USING (true);
