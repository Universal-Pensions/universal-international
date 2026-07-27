-- 0084_scope_agents_branches.down.sql
-- ⚠️ Reverting re-opens the cross-tenant read on `agents` / `branches` (any
-- distributor sees all 316 branches and all 2,043 agents) AND the write hole
-- (any distributor may UPDATE any branch).

BEGIN;

DROP POLICY IF EXISTS branches_scope_distributor ON public.branches;
DROP POLICY IF EXISTS agents_scope_distributor   ON public.agents;

DROP POLICY IF EXISTS branches_update_distributor ON public.branches;
CREATE POLICY branches_update_distributor ON public.branches
  FOR UPDATE
  USING      (((SELECT auth.jwt()) ->> 'app_role') = 'distributor')
  WITH CHECK (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS branches_insert_distributor ON public.branches;
CREATE POLICY branches_insert_distributor ON public.branches
  FOR INSERT
  WITH CHECK (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

COMMIT;
