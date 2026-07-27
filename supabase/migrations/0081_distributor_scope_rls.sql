-- 0081_distributor_scope_rls.sql
-- Scope the DISTRIBUTOR role to its own agent network.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
-- Every other multi-entity role has always been RLS-scoped to what it owns:
--   agent    → subscribers.agent_id    = jwt.agentId
--   branch   → EXISTS(agents a WHERE a.id = subscribers.agent_id
--                                 AND a.branch_id = jwt.branchId)
--   employer → subscribers.employer_id = jwt.employerId
--   self     → subscribers.id          = jwt.subscriberId
-- `distributor` was the lone outlier: 15 tables carried a bare
-- `(auth.jwt() ->> 'app_role') = 'distributor'` with NO ownership predicate, so
-- any distributor JWT could read the entire platform.
--
-- Symptom the user hit: the distributor Subscribers page rendered **5,062**
-- (every subscriber on the platform, including 58 onboarded by EMPLOYERS) while
-- the Overview KPI on the same dashboard rendered **5,004** — because the KPI
-- comes from `get_entity_metrics_rollup`, which correctly counts through the
-- agent tree. Two surfaces, two scopes, one dashboard.
--
-- ── THE RULE ─────────────────────────────────────────────────────────────────
-- A distributor sees exactly the rows reachable from the branches it owns:
--     branches.distributor_id -> agents.branch_id -> subscribers.agent_id
-- Subscribers with `agent_id IS NULL` (the 58 employer-onboarded members today,
-- and any future direct signup) belong to NO distributor — they are visible to
-- their employer, to themselves, and to the super-admin only.
--
-- Two properties that must never be softened:
--   * Key on `branches.distributor_id`, NEVER on `agent_id IS NOT NULL`. Those
--     coincided only while d-001 owned 316/316 branches; the latter would hand
--     every distributor the whole platform.
--   * The predicate must NOT be NULL-tolerant. Any fallback that admits
--     `agent_id IS NULL` re-admits the 58 and recreates the reported bug.
--
-- Super-admin is untouched: every table carries a separate `*_select_admin`
-- policy (0049) and permissive policies are OR-ed, so admin still sees 5,062.
--
-- `agents` / `branches` are DEFERRED to 0084 on purpose: each has exactly ONE
-- SELECT policy (`*_select_authenticated`, `app_role IS NOT NULL`) shared by all
-- roles. ADDing a scoped policy there is a silent no-op (permissive = OR), and
-- REPLACING it would blast 18 call sites across every role. That needs a
-- RESTRICTIVE policy and its own test pass.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) JWT accessor. No DEFINER needed — reads the token only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_distributor_id()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT NULLIF((SELECT auth.jwt()) ->> 'distributorId', '') $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Ownership-set helpers.
--    SECURITY DEFINER (owner postgres, rolbypassrls) so they resolve the
--    ownership path without re-entering RLS — otherwise the policy on
--    `transactions` would recurse into the policy on `subscribers`.
--    A DEFINER `sql` function also cannot be inlined, so the planner evaluates
--    it ONCE per statement as a Function Scan feeding a hashed semi-join,
--    rather than re-planning a 3-way join for every referencing table.
--    They fail CLOSED: a NULL/absent `distributorId` claim yields the empty set.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.distributor_branch_ids()
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id FROM public.branches b
   WHERE b.distributor_id = public.current_distributor_id()
$$;

CREATE OR REPLACE FUNCTION public.distributor_agent_ids()
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id FROM public.agents a
    JOIN public.branches b ON b.id = a.branch_id
   WHERE b.distributor_id = public.current_distributor_id()
$$;

CREATE OR REPLACE FUNCTION public.distributor_subscriber_ids()
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id FROM public.subscribers s
    JOIN public.agents   a ON a.id = s.agent_id
    JOIN public.branches b ON b.id = a.branch_id
   WHERE b.distributor_id = public.current_distributor_id()
$$;

REVOKE ALL ON FUNCTION public.current_distributor_id()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.distributor_branch_ids()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.distributor_agent_ids()       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.distributor_subscriber_ids()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_distributor_id()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.distributor_branch_ids()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.distributor_agent_ids()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.distributor_subscriber_ids() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) subscribers — the reported bug. 5,062 -> 5,004 for the national tree.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS subscribers_select_distributor ON public.subscribers;
CREATE POLICY subscribers_select_distributor ON public.subscribers
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND agent_id IN (SELECT public.distributor_agent_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Subscriber-anchored tables (one hop off `subscribers`).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS subscriber_balances_select_distributor ON public.subscriber_balances;
CREATE POLICY subscriber_balances_select_distributor ON public.subscriber_balances
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND subscriber_id IN (SELECT public.distributor_subscriber_ids()));

DROP POLICY IF EXISTS transactions_select_distributor ON public.transactions;
CREATE POLICY transactions_select_distributor ON public.transactions
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND subscriber_id IN (SELECT public.distributor_subscriber_ids()));

DROP POLICY IF EXISTS withdrawals_select_distributor ON public.withdrawals;
CREATE POLICY withdrawals_select_distributor ON public.withdrawals
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND subscriber_id IN (SELECT public.distributor_subscriber_ids()));

DROP POLICY IF EXISTS claims_select_distributor ON public.claims;
CREATE POLICY claims_select_distributor ON public.claims
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND subscriber_id IN (SELECT public.distributor_subscriber_ids()));

DROP POLICY IF EXISTS nominees_select_distributor ON public.nominees;
CREATE POLICY nominees_select_distributor ON public.nominees
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND subscriber_id IN (SELECT public.distributor_subscriber_ids()));

DROP POLICY IF EXISTS insurance_policies_select_distributor ON public.insurance_policies;
CREATE POLICY insurance_policies_select_distributor ON public.insurance_policies
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND subscriber_id IN (SELECT public.distributor_subscriber_ids()));

DROP POLICY IF EXISTS contribution_schedules_select_distributor ON public.contribution_schedules;
CREATE POLICY contribution_schedules_select_distributor ON public.contribution_schedules
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND subscriber_id IN (SELECT public.distributor_subscriber_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Branch-anchored tables.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS commissions_select_distributor ON public.commissions;
CREATE POLICY commissions_select_distributor ON public.commissions
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND branch_id IN (SELECT public.distributor_branch_ids()));

DROP POLICY IF EXISTS settlement_batches_select_distributor ON public.settlement_batches;
CREATE POLICY settlement_batches_select_distributor ON public.settlement_batches
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND branch_id IN (SELECT public.distributor_branch_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) notifications — recipient-keyed. Matches what the client already filters
--    on (`src/services/notifications.js`), so this is a pure tightening.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS notifications_select_distributor ON public.notifications;
CREATE POLICY notifications_select_distributor ON public.notifications
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND recipient_role = 'distributor'
    AND recipient_id = public.current_distributor_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) No ownership path at all → DROP the policy rather than invent one.
--    None of these three is read by any browser code path; every writer uses
--    the service role (RLS-bypassed), so dropping is zero-regression.
--      users               — no distributor linkage column exists. 60 rows incl.
--                            20 bcrypt hashes were readable by any distributor
--                            JWT. No client reader (`grep "from('users')" src/`
--                            is empty); auth routes all use supabaseAdmin.
--      contact_submissions — public marketing leads; `_select_admin` exists.
--      agent_referrals     — 0040 dropped its last tracking column; the only
--                            conceivable join is phone→subscribers.phone, which
--                            is not an FK. Do NOT infer ownership from a phone.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS users_select_distributor               ON public.users;
DROP POLICY IF EXISTS contact_submissions_select_distributor ON public.contact_submissions;
DROP POLICY IF EXISTS agent_referrals_select_distributor     ON public.agent_referrals;

-- Defence in depth on the credential store. A column-level REVOKE is a
-- documented NO-OP while a table-wide grant stands (Postgres unions table- and
-- column-level privileges — the same trap 0076 documents), so this must be
-- table-REVOKE then column-GRANT.
REVOKE SELECT, UPDATE ON public.users FROM anon, authenticated;
GRANT SELECT (id, phone, role, name, entity_id, email, last_login_at, created_at)
  ON public.users TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) distributors — was readable by ANY authenticated role. Admin keeps the
--    full catalog (ViewDistributors); a distributor sees only its own row,
--    which is all Settings reads. `distributors_update_self` is untouched, so
--    the profile `.update().select()` round-trip still works.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS distributors_select ON public.distributors;
CREATE POLICY distributors_select_admin ON public.distributors
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'admin');
CREATE POLICY distributors_select_self ON public.distributors
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') = 'distributor'
    AND id = public.current_distributor_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) Stamp `distributor_id` on UI-created branches. Without this a branch
--    created in-app carries NULL and is invisible to its own creator — along
--    with every agent and subscriber beneath it. Backs the client-side default
--    in `createBranch` (src/services/entities.js).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_branches_default_distributor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.distributor_id IS NULL THEN
    NEW.distributor_id := public.current_distributor_id();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS branches_default_distributor ON public.branches;
CREATE TRIGGER branches_default_distributor
  BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.trg_branches_default_distributor();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) Supporting index — turns the sequential scan behind
--     distributor_subscriber_ids() into an index-only scan.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS subscribers_agent_id_id_idx
  ON public.subscribers (agent_id, id);

COMMIT;
