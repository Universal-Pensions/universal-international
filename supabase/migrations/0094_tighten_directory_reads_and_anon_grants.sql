-- =============================================================================
-- Universal Pensions Uganda — 0094: least-privilege directory reads + anon grants
-- =============================================================================
-- Two findings from the 2026-08-01 cross-role audit, both PRE-EXISTING (neither
-- was introduced by the distributor scoping work or by 0092/0093):
--
-- (A) `agents` and `branches` were readable IN FULL by every authenticated role.
--     `agents_select_authenticated` / `branches_select_authenticated` (from
--     `0003_rls_policies.sql`, re-emitted by 0007 and 0008) grant SELECT on the
--     mere existence of an `app_role` claim. Measured on the live DB: a
--     SUBSCRIBER could read all 2,043 agents and all 316 branches — every agent's
--     name, phone, email and branch posting, plus the whole branch directory of a
--     competing distributor's network. An employer could too.
--
--     `0084` added the RESTRICTIVE `*_scope_distributor` overlays, which fixed the
--     distributor case only; every other role kept the blanket read. This
--     migration replaces the blanket policies with one policy per role.
--
-- (B) 15 RPCs and 5 internal helpers carried an EXECUTE grant for `anon`.
--     Not exploitable — the SECURITY DEFINER bodies all gate on
--     `auth.jwt() ->> 'app_role'`, which is NULL for anon, so they RAISE — but a
--     prior platform audit flagged anon-executable RPCs as the top risk on this
--     project, and defence in depth should not rest on every future edit
--     remembering to re-add the role guard.
--
-- WHAT EACH ROLE CAN READ AFTER THIS (measured, in one rolled-back transaction,
-- before this file was written):
--
--     role                agents   branches      (was 2043 / 316 for every row
--     admin                 2043        316       below the distributors)
--     distributor d-001     1872        289
--     distributor d-002      171         27
--     branch b-kam-015         5          1
--     agent a-001              1          1
--     subscriber s-1001        1          1
--     employer emp-001         0          0
--
-- ⚠️ WHY THE HELPER FUNCTIONS. A policy on `agents` that sub-queries
-- `subscribers` recurses: reading `agents` evaluates every permissive policy on
-- `subscribers`, one of which (`subscribers_select_branch`) sub-queries `agents`
-- again, and Postgres aborts with "infinite recursion detected in policy". The
-- three SECURITY DEFINER helpers below break the cycle by reading the parent row
-- with RLS bypassed — exactly the idiom `current_distributor_id()` /
-- `distributor_branch_ids()` already use for the distributor edges.
--
-- Forward-only; reversible via
-- 0094_tighten_directory_reads_and_anon_grants.down.sql.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (1) Ownership-edge helpers (SECURITY DEFINER — see the recursion note above)
-- -----------------------------------------------------------------------------
-- Each resolves ONE edge from the caller's own verified claim. None takes an
-- argument, so none can be pointed at another tenant's row.

-- The agent who serves the calling SUBSCRIBER.
CREATE OR REPLACE FUNCTION public.subscriber_agent_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.agent_id
    FROM public.subscribers s
   WHERE s.id = ((SELECT auth.jwt()) ->> 'subscriberId')
$$;

-- The branch the calling AGENT is posted to.
CREATE OR REPLACE FUNCTION public.agent_branch_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.branch_id
    FROM public.agents a
   WHERE a.id = ((SELECT auth.jwt()) ->> 'agentId')
$$;

-- The branch behind the calling SUBSCRIBER's agent. The subscriber dashboard's
-- "My agent" page reads `subscribers → agents(*, branches(name))`, and PostgREST
-- applies RLS to each embedded table independently, so the member needs SELECT on
-- that ONE branch row for the branch name to resolve.
CREATE OR REPLACE FUNCTION public.subscriber_branch_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.branch_id
    FROM public.agents a
   WHERE a.id = public.subscriber_agent_id()
$$;

REVOKE ALL ON FUNCTION public.subscriber_agent_id()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agent_branch_id()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.subscriber_branch_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscriber_agent_id()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_branch_id()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscriber_branch_id() TO authenticated;

COMMENT ON FUNCTION public.subscriber_agent_id() IS
  'The calling subscriber''s own agent id, read with RLS bypassed so agents RLS '
  'policies can reference it without recursing through subscribers policies.';
COMMENT ON FUNCTION public.agent_branch_id() IS
  'The calling agent''s own branch id (RLS-bypassing, argument-free).';
COMMENT ON FUNCTION public.subscriber_branch_id() IS
  'The branch behind the calling subscriber''s agent — needed for the embedded '
  'branches(name) read on the subscriber "My agent" page.';


-- -----------------------------------------------------------------------------
-- (2) agents — one SELECT policy per role, replacing the blanket read
-- -----------------------------------------------------------------------------
-- The RESTRICTIVE `agents_scope_distributor` (0084) is deliberately LEFT IN
-- PLACE. It is now redundant with `agents_select_distributor` below, but a
-- restrictive policy is a second, independent gate: if a future permissive policy
-- is ever added carelessly, the distributor boundary still holds.
DROP POLICY IF EXISTS agents_select_authenticated ON public.agents;

DROP POLICY IF EXISTS agents_select_admin ON public.agents;
CREATE POLICY agents_select_admin ON public.agents FOR SELECT
  USING (((SELECT auth.jwt()) ->> 'app_role') = 'admin');

DROP POLICY IF EXISTS agents_select_distributor ON public.agents;
CREATE POLICY agents_select_distributor ON public.agents FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND branch_id IN (SELECT public.distributor_branch_ids())
  );

DROP POLICY IF EXISTS agents_select_branch ON public.agents;
CREATE POLICY agents_select_branch ON public.agents FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'branch'
    AND branch_id = ((SELECT auth.jwt()) ->> 'branchId')
  );

DROP POLICY IF EXISTS agents_select_self ON public.agents;
CREATE POLICY agents_select_self ON public.agents FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'agent'
    AND id = ((SELECT auth.jwt()) ->> 'agentId')
  );

-- A member may see the ONE agent who serves them (the "My agent" page), and
-- nothing else. Employers get no policy at all: employer staff sit outside the
-- agent tree entirely (`subscribers.agent_id IS NULL`, no commissions), so no
-- employer surface reads this table.
DROP POLICY IF EXISTS agents_select_subscriber ON public.agents;
CREATE POLICY agents_select_subscriber ON public.agents FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'subscriber'
    AND id = public.subscriber_agent_id()
  );


-- -----------------------------------------------------------------------------
-- (3) branches — one SELECT policy per role
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS branches_select_authenticated ON public.branches;

DROP POLICY IF EXISTS branches_select_admin ON public.branches;
CREATE POLICY branches_select_admin ON public.branches FOR SELECT
  USING (((SELECT auth.jwt()) ->> 'app_role') = 'admin');

DROP POLICY IF EXISTS branches_select_distributor ON public.branches;
CREATE POLICY branches_select_distributor ON public.branches FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND distributor_id = public.current_distributor_id()
  );

DROP POLICY IF EXISTS branches_select_self ON public.branches;
CREATE POLICY branches_select_self ON public.branches FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'branch'
    AND id = ((SELECT auth.jwt()) ->> 'branchId')
  );

-- The agent's own branch: `listSettlements` resolves a branch NAME for each
-- settlement batch, and the agent dashboard shows the posting.
DROP POLICY IF EXISTS branches_select_agent ON public.branches;
CREATE POLICY branches_select_agent ON public.branches FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'agent'
    AND id = public.agent_branch_id()
  );

DROP POLICY IF EXISTS branches_select_subscriber ON public.branches;
CREATE POLICY branches_select_subscriber ON public.branches FOR SELECT
  USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'subscriber'
    AND id = public.subscriber_branch_id()
  );


-- -----------------------------------------------------------------------------
-- (4) Drop the anon EXECUTE grants that no pre-login surface needs
-- -----------------------------------------------------------------------------
-- KEPT anon deliberately — these three ARE the pre-login surfaces:
--   * create_subscriber_from_signup          — self-signup creates the subscriber
--                                              BEFORE the JWT is minted.
--   * create_subscriber_from_employer_invite — the invitee completes KYC pre-login.
--   * get_employer_invite                    — /invite/:token reads the prefill
--                                              before any session exists.
--
-- ALSO KEPT: every trigger function (trg_*, block_*, guard_*). They are not
-- callable as RPCs in any useful way (Postgres rejects a direct call with
-- "trigger functions can only be called as triggers"), so revoking buys nothing,
-- while a mistake there would break INSERTs on the anon signup path.
-- ⚠️ EVERY REVOKE MUST NAME **PUBLIC**, NOT JUST anon. A function created without
-- an explicit grant carries a default PUBLIC EXECUTE (`=X/postgres` in proacl),
-- and anon inherits it transitively. `REVOKE ... FROM anon` against a PUBLIC
-- grant is a silent no-op: it succeeds, changes nothing, and
-- `has_function_privilege('anon', …)` still returns true. Measured here — the
-- first pass of this migration used `FROM anon` and left 7 of the 20 functions
-- fully anon-executable. Same lesson as the 0086 / 0092 headers.
--
-- Logged-in RPC surfaces.
REVOKE EXECUTE ON FUNCTION public.cancel_employer_invite(text)                               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_subscriber_from_agent_onboard(jsonb, text, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_subscriber_from_employer_onboard(jsonb, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_all_employers_metrics()                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_branch_pending_contributions(text)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_breadcrumb(text, jsonb)                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_commission_summary(text)                               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_employer_activity_rollup()                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_employer_geo_rollup()                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_entity_commission_summary(text, text)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_platform_overview()                                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.make_contribution(text, numeric, numeric, text)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_employer_contribution_run(text, text, text)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_employer_member_compensation(text, numeric)         FROM PUBLIC, anon;

-- Internal helpers. Every one of these is reached only from inside a SECURITY
-- DEFINER body, where the effective user is the function owner rather than the
-- caller — so the anon grant was never load-bearing, including on the pre-login
-- signup path that runs through `create_subscriber_from_signup`.
REVOKE EXECUTE ON FUNCTION public._canonical_ug_phone(text)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._demo_now()                                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._insert_subscriber_chain(jsonb, text, numeric, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._validate_signup_payload(jsonb)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.group_insurance_premium_per_member(jsonb)       FROM PUBLIC, anon;

COMMIT;

-- =============================================================================
-- End of 0094_tighten_directory_reads_and_anon_grants.sql
-- Reversible via 0094_tighten_directory_reads_and_anon_grants.down.sql.
-- =============================================================================
