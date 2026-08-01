-- =============================================================================
-- Universal Pensions Uganda — 0094 DOWN: restore the blanket directory reads
-- =============================================================================
-- Restores `agents_select_authenticated` / `branches_select_authenticated` (the
-- 0003/0007/0008 blanket policies), drops the five per-role SELECT policies on
-- each table, drops the three ownership-edge helpers, and re-grants anon EXECUTE
-- on the 20 functions 0094 revoked.
--
-- ⚠️ Rolling back RE-OPENS the read: every authenticated role can again read all
-- 2,043 agents and all 316 branches, including another distributor's network.
-- Only roll back to unblock a broken surface, and re-apply once it is fixed.
--
-- The RESTRICTIVE `agents_scope_distributor` / `branches_scope_distributor`
-- overlays (0084) are NOT touched here — 0094 left them in place, so the
-- distributor boundary survives this rollback.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (1) restore the blanket SELECT policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS agents_select_admin       ON public.agents;
DROP POLICY IF EXISTS agents_select_distributor ON public.agents;
DROP POLICY IF EXISTS agents_select_branch      ON public.agents;
DROP POLICY IF EXISTS agents_select_self        ON public.agents;
DROP POLICY IF EXISTS agents_select_subscriber  ON public.agents;

CREATE POLICY agents_select_authenticated ON public.agents FOR SELECT
  USING (((SELECT auth.jwt()) ->> 'app_role') IS NOT NULL);

DROP POLICY IF EXISTS branches_select_admin       ON public.branches;
DROP POLICY IF EXISTS branches_select_distributor ON public.branches;
DROP POLICY IF EXISTS branches_select_self        ON public.branches;
DROP POLICY IF EXISTS branches_select_agent       ON public.branches;
DROP POLICY IF EXISTS branches_select_subscriber  ON public.branches;

CREATE POLICY branches_select_authenticated ON public.branches FOR SELECT
  USING (((SELECT auth.jwt()) ->> 'app_role') IS NOT NULL);


-- -----------------------------------------------------------------------------
-- (2) drop the ownership-edge helpers
-- -----------------------------------------------------------------------------
-- Dropped AFTER the policies that reference them, or the DROP would fail.
DROP FUNCTION IF EXISTS public.subscriber_branch_id();
DROP FUNCTION IF EXISTS public.subscriber_agent_id();
DROP FUNCTION IF EXISTS public.agent_branch_id();


-- -----------------------------------------------------------------------------
-- (3) re-grant anon EXECUTE
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.cancel_employer_invite(text)                               TO anon;
GRANT EXECUTE ON FUNCTION public.create_subscriber_from_agent_onboard(jsonb, text, text)    TO anon;
GRANT EXECUTE ON FUNCTION public.create_subscriber_from_employer_onboard(jsonb, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_all_employers_metrics()                                TO anon;
GRANT EXECUTE ON FUNCTION public.get_branch_pending_contributions(text)                     TO anon;
GRANT EXECUTE ON FUNCTION public.get_breadcrumb(text, jsonb)                                TO anon;
GRANT EXECUTE ON FUNCTION public.get_commission_summary(text)                               TO anon;
GRANT EXECUTE ON FUNCTION public.get_employer_activity_rollup()                             TO anon;
GRANT EXECUTE ON FUNCTION public.get_employer_geo_rollup()                                  TO anon;
GRANT EXECUTE ON FUNCTION public.get_entity_commission_summary(text, text)                  TO anon;
GRANT EXECUTE ON FUNCTION public.get_platform_overview()                                    TO anon;
GRANT EXECUTE ON FUNCTION public.make_contribution(text, numeric, numeric, text)            TO anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_employer_contribution_run(text, text, text)         TO anon;
GRANT EXECUTE ON FUNCTION public.update_employer_member_compensation(text, numeric)         TO anon;
GRANT EXECUTE ON FUNCTION public._canonical_ug_phone(text)                                  TO anon;
GRANT EXECUTE ON FUNCTION public._demo_now()                                                TO anon;
GRANT EXECUTE ON FUNCTION public._insert_subscriber_chain(jsonb, text, numeric, boolean)    TO anon;
GRANT EXECUTE ON FUNCTION public._validate_signup_payload(jsonb)                            TO anon;
GRANT EXECUTE ON FUNCTION public.group_insurance_premium_per_member(jsonb)                  TO anon;

COMMIT;

-- =============================================================================
-- End of 0094_tighten_directory_reads_and_anon_grants.down.sql
-- =============================================================================
