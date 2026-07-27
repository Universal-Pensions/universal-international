-- 0084_scope_agents_branches.sql
-- Closes the last two platform-wide reads for the distributor role, and the
-- write-side hole beside them. Completes what 0081 started.
--
-- ── WHY THIS COULD NOT GO IN 0081 ────────────────────────────────────────────
-- Every table 0081 scoped had one policy PER ROLE, so replacing the distributor
-- policy touched nothing else. `agents` and `branches` are different: each has
-- exactly ONE SELECT policy — `agents_select_authenticated` /
-- `branches_select_authenticated`, qual `app_role IS NOT NULL` — shared by
-- every role. That leaves two traps:
--
--   1. ADDING a scoped permissive policy is a SILENT NO-OP. Permissive policies
--      are OR-ed, so the blanket policy still admits every row. Tests would go
--      green and the leak would remain.
--   2. REPLACING the blanket policy blasts every role. 18 call sites depend on
--      it — the super-admin overview, the branch dashboard, the agent
--      dashboard, ticket views, commission settlement name resolution, and
--      `createBranch`'s `.insert().select()` RETURNING clause. Reproducing all
--      of that as per-role policies risks silently blanking a surface (e.g. the
--      subscriber "Your agent" card reads `agents(*, branches(name))` as ONE
--      embed, and RLS is evaluated per embedded table — omitting the branches
--      arm blanks the branch line with no error).
--
-- ── THE FIX: RESTRICTIVE policies ────────────────────────────────────────────
-- A RESTRICTIVE policy is AND-ed with the permissive set instead of OR-ed, so
-- it can subtract from the blanket grant without redefining it. Every
-- non-distributor role keeps byte-identical visibility; only `distributor`
-- gains the ownership predicate. This is why the blanket
-- `*_select_authenticated` policies are deliberately left in place below.
--
-- Written with COALESCE(..., '') so a NULL `app_role` evaluates FALSE rather
-- than NULL (a NULL USING result filters the row, but being explicit keeps the
-- intent readable and matches 0082's `v_all`).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) READ scoping. Non-distributor roles are unaffected by construction.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS branches_scope_distributor ON public.branches;
CREATE POLICY branches_scope_distributor ON public.branches
  AS RESTRICTIVE FOR SELECT
  USING (
    COALESCE((SELECT auth.jwt()) ->> 'app_role', '') <> 'distributor'
    OR distributor_id = public.current_distributor_id());

DROP POLICY IF EXISTS agents_scope_distributor ON public.agents;
CREATE POLICY agents_scope_distributor ON public.agents
  AS RESTRICTIVE FOR SELECT
  USING (
    COALESCE((SELECT auth.jwt()) ->> 'app_role', '') <> 'distributor'
    OR branch_id IN (SELECT public.distributor_branch_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) WRITE scoping — worse than the read gap it accompanies.
--    `branches_update_distributor` was `app_role = 'distributor'` with NO
--    ownership predicate, so ANY distributor could rename, re-district or
--    deactivate ANY of the 316 branches (reachable from the UI via
--    `updateBranch`). USING gates which rows may be targeted; WITH CHECK stops
--    a row being handed to another distributor on the way out.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS branches_update_distributor ON public.branches;
CREATE POLICY branches_update_distributor ON public.branches
  FOR UPDATE
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND distributor_id = public.current_distributor_id())
  WITH CHECK (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND distributor_id = public.current_distributor_id());

-- INSERT: a distributor may only create branches under itself. 0081's
-- `branches_default_distributor` BEFORE INSERT trigger stamps the claim when
-- the client omits the column, so this WITH CHECK passes for honest inserts and
-- rejects a hand-crafted one naming another distributor.
DROP POLICY IF EXISTS branches_insert_distributor ON public.branches;
CREATE POLICY branches_insert_distributor ON public.branches
  FOR INSERT
  WITH CHECK (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND distributor_id = public.current_distributor_id());

COMMIT;

-- ── DELIBERATELY NOT CHANGED ─────────────────────────────────────────────────
-- `commission_config_update_distributor` is still `app_role = 'distributor'`
-- with no ownership predicate. That is NOT an oversight: `commission_config` is
-- a single platform-wide row with no `distributor_id` column, so there is
-- nothing to scope against. Making the commission rate per-distributor is a
-- schema change (add the column, backfill, re-point `set_commission_rate` and
-- every commission computation) and belongs in its own migration. Until then a
-- distributor can change the platform rate — acceptable while the product is a
-- single-operator demo, but it should not stay true once tenants are real.
