-- 0080_reversible_entity_detach.down.sql
-- Reverts to 0060's one-way, non-reversible detach semantics.
--
-- ⚠️ Any linkage still recorded as OPEN (restored_at IS NULL) in
-- `entity_detach_log` is lost when the journals are dropped. Replay it first if
-- a distributor/employer is currently deactivated:
--
--   UPDATE public.subscribers s SET agent_id = j.prior_value
--     FROM public.entity_detach_log j
--    WHERE j.link_kind='agent' AND j.restored_at IS NULL
--      AND s.id = j.subscriber_id AND s.agent_id IS NULL;
--   UPDATE public.subscribers s SET employer_id = j.prior_value
--     FROM public.entity_detach_log j
--    WHERE j.link_kind='employer' AND j.restored_at IS NULL
--      AND s.id = j.subscriber_id AND s.employer_id IS NULL;

DROP TRIGGER IF EXISTS subscribers_guard_mass_detach ON public.subscribers;
DROP FUNCTION IF EXISTS public.guard_mass_subscriber_detach();

-- Restore 0060's set_distributor_status verbatim.
CREATE OR REPLACE FUNCTION public.set_distributor_status(
  p_distributor_id text,
  p_status         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role          text    := (SELECT auth.jwt()) ->> 'app_role';
  v_dist_updated  integer := 0;
  v_branches      integer := 0;
  v_agents        integer := 0;
  v_subs_detached integer := 0;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot set distributor status', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.distributors SET status = p_status, updated_at = now() WHERE id = p_distributor_id;
  GET DIAGNOSTICS v_dist_updated = ROW_COUNT;
  IF v_dist_updated = 0 THEN
    RAISE EXCEPTION 'no distributor %', p_distributor_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.branches
     SET status = p_status
   WHERE distributor_id = p_distributor_id;
  GET DIAGNOSTICS v_branches = ROW_COUNT;

  UPDATE public.agents
     SET status = p_status
   WHERE branch_id IN (SELECT id FROM public.branches WHERE distributor_id = p_distributor_id);
  GET DIAGNOSTICS v_agents = ROW_COUNT;

  IF p_status = 'inactive' THEN
    UPDATE public.subscribers
       SET agent_id = NULL
     WHERE agent_id IN (
       SELECT a.id
         FROM public.agents a
         JOIN public.branches b ON b.id = a.branch_id
        WHERE b.distributor_id = p_distributor_id
     );
    GET DIAGNOSTICS v_subs_detached = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'id',                  p_distributor_id,
    'status',              p_status,
    'branchesUpdated',     v_branches,
    'agentsUpdated',       v_agents,
    'subscribersDetached', v_subs_detached
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_distributor_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_distributor_status(text, text) TO authenticated;

-- Restore 0060's set_employer_status verbatim.
CREATE OR REPLACE FUNCTION public.set_employer_status(
  p_employer_id text,
  p_status      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        text    := (SELECT auth.jwt()) ->> 'app_role';
  v_emp_updated integer := 0;
  v_members     integer := 0;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot set employer status', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.employers SET status = p_status, updated_at = now() WHERE id = p_employer_id;
  GET DIAGNOSTICS v_emp_updated = ROW_COUNT;
  IF v_emp_updated = 0 THEN
    RAISE EXCEPTION 'no employer %', p_employer_id USING ERRCODE = 'P0001';
  END IF;

  IF p_status = 'inactive' THEN
    UPDATE public.subscribers
       SET employer_id = NULL
     WHERE employer_id = p_employer_id;
    GET DIAGNOSTICS v_members = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'id',              p_employer_id,
    'status',          p_status,
    'membersDetached', v_members
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_employer_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employer_status(text, text) TO authenticated;

DROP TABLE IF EXISTS public.entity_detach_log;
DROP TABLE IF EXISTS public.entity_status_log;
