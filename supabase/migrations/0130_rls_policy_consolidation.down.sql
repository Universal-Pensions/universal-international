-- 0130_rls_policy_consolidation.down.sql
-- Restores the six per-role SELECT policies on `public.subscribers` exactly as
-- they were LIVE immediately before 0130.
--
-- PROVENANCE. Every `USING` clause below was read from the live catalogue on
-- project ilkhfnoyxlxwqadebnkp (2026-08-25) and transcribed from that output,
-- NOT retyped from 0003 / 0007 / 0008 / 0043 / 0049 / 0081:
--
--   SELECT policyname, permissive, roles, cmd, qual
--     FROM pg_policies
--    WHERE schemaname='public' AND tablename='subscribers' AND cmd='SELECT'
--    ORDER BY policyname;
--
-- All six are PERMISSIVE, FOR SELECT, TO public — the defaults — so no
-- `AS PERMISSIVE` / `TO` clause is needed to reproduce them faithfully.
--
-- NOTE ON `subscribers_update_self`. 0130 does not touch the UPDATE policy, so
-- this file must not recreate it either. It is listed here only so a reader can
-- confirm the omission is deliberate.
--
-- SAFE TO RE-RUN. Each policy is dropped-if-exists before being created, and
-- the consolidated policy 0130 added is dropped first. Running this file
-- against a database that never had 0130 applied is a no-op that rewrites the
-- six policies with identical text.
--
-- ORDER MATTERS. The consolidated policy is dropped FIRST. If it were dropped
-- last, there would be an instant inside the transaction where both shapes were
-- live; they are permissive and therefore OR-ed, so visibility would be the
-- union — which happens to be identical here, but relying on that is exactly
-- the kind of assumption this repo has been bitten by before.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS subscribers_select ON public.subscribers;

DROP POLICY IF EXISTS subscribers_select_admin ON public.subscribers;
CREATE POLICY subscribers_select_admin ON public.subscribers
  FOR SELECT
  USING (((SELECT auth.jwt()) ->> 'app_role') = 'admin');

DROP POLICY IF EXISTS subscribers_select_agent ON public.subscribers;
CREATE POLICY subscribers_select_agent ON public.subscribers
  FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'agent'
    AND agent_id = ((SELECT auth.jwt()) ->> 'agentId')
  );

DROP POLICY IF EXISTS subscribers_select_branch ON public.subscribers;
CREATE POLICY subscribers_select_branch ON public.subscribers
  FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'branch'
    AND EXISTS (
      SELECT 1 FROM public.agents a
       WHERE a.id = subscribers.agent_id
         AND a.branch_id = ((SELECT auth.jwt()) ->> 'branchId')
    )
  );

DROP POLICY IF EXISTS subscribers_select_distributor ON public.subscribers;
CREATE POLICY subscribers_select_distributor ON public.subscribers
  FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND agent_id IN (SELECT public.distributor_agent_ids())
  );

DROP POLICY IF EXISTS subscribers_select_employer ON public.subscribers;
CREATE POLICY subscribers_select_employer ON public.subscribers
  FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'employer'
    AND employer_id = ((SELECT auth.jwt()) ->> 'employerId')
  );

DROP POLICY IF EXISTS subscribers_select_self ON public.subscribers;
CREATE POLICY subscribers_select_self ON public.subscribers
  FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'subscriber'
    AND id = ((SELECT auth.jwt()) ->> 'subscriberId')
  );

COMMIT;
