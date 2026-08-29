-- Audit S1: add a JWT app_role/branchId scope guard to the branch
-- pending-contributions RPC. The prior live version was SECURITY DEFINER with a
-- bare `WHERE a.branch_id = p_branch_id` and no claim check, letting any
-- authenticated user read any branch's agent roster + per-agent counts.
CREATE OR REPLACE FUNCTION public.get_branch_pending_contributions(p_branch_id TEXT)
RETURNS TABLE (
  agent_id   TEXT,
  agent_name TEXT,
  total      BIGINT,
  pending    BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   TEXT := COALESCE((SELECT auth.jwt()) ->> 'app_role', '');
  v_branch TEXT := (SELECT auth.jwt()) ->> 'branchId';
BEGIN
  IF v_role = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  IF v_role NOT IN ('branch', 'distributor', 'admin') THEN
    RAISE EXCEPTION 'role_not_permitted' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'branch' AND (v_branch IS NULL OR p_branch_id <> v_branch) THEN
    RAISE EXCEPTION 'out_of_scope' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    a.id   AS agent_id,
    a.name AS agent_name,
    COUNT(s.id)::bigint AS total,
    COUNT(s.id) FILTER (
      WHERE cs.next_due_date IS NOT NULL AND cs.next_due_date < CURRENT_DATE
    )::bigint AS pending
  FROM public.agents a
  JOIN public.subscribers s
    ON s.agent_id = a.id AND s.is_active
  LEFT JOIN public.contribution_schedules cs
    ON cs.subscriber_id = s.id
  WHERE a.branch_id = p_branch_id
  GROUP BY a.id, a.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_branch_pending_contributions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_pending_contributions(TEXT) TO authenticated;
