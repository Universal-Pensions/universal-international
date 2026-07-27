-- 0087_scope_commission_rpcs.down.sql
-- Restores the 0075 bodies, which treat `distributor` as equivalent to `admin`.
-- ⚠️ Reverting re-opens a live cross-tenant read: both distributors get the
-- SAME platform-wide commission list (778 rows), agent dues (777) and branch
-- dues (121), and "top branch" can name a branch the caller does not own. These
-- are all SECURITY DEFINER, so no RLS policy compensates.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_agent_commission_list(p_status_focus text DEFAULT NULL::text)
 RETURNS TABLE(agent_id text, agent_name text, employee_id text, branch_id text, branch_name text,
               total_commissions numeric, total_paid numeric, total_due numeric,
               subscribers_onboarded bigint, active_subscribers bigint,
               filtered_amount numeric, filtered_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    a.id, COALESCE(a.name,'Unknown'), COALESCE(a.employee_id,''),
    COALESCE(a.branch_id,''), COALESCE(b.name,'Unknown'),
    COALESCE(SUM(c.amount),0),
    COALESCE(SUM(c.amount) FILTER (WHERE c.status='paid'),0),
    COALESCE(SUM(c.amount) FILTER (WHERE c.status='due'),0),
    COUNT(*), COUNT(*),
    COALESCE(SUM(c.amount) FILTER (
      WHERE p_status_focus NOT IN ('paid','due') OR p_status_focus IS NULL OR c.status::text=p_status_focus),0),
    COUNT(*) FILTER (
      WHERE p_status_focus NOT IN ('paid','due') OR p_status_focus IS NULL OR c.status::text=p_status_focus)
  FROM public.commissions c
  JOIN public.agents a   ON a.id = c.agent_id
  LEFT JOIN public.branches b ON b.id = a.branch_id
  WHERE (
        (auth.jwt() ->> 'app_role') IN ('distributor','admin')
     OR ((auth.jwt() ->> 'app_role') = 'branch' AND a.branch_id = auth.jwt() ->> 'branchId')
  )
  GROUP BY a.id, a.name, a.employee_id, a.branch_id, b.name
  HAVING COUNT(*) > 0;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_dues_by_agent()
 RETURNS TABLE(agent_id text, agent_name text, employee_id text, branch_id text, branch_name text,
               pending_amount numeric, pending_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.id, COALESCE(a.name,'Unknown'), COALESCE(a.employee_id,''),
         COALESCE(a.branch_id,''), COALESCE(b.name,'Unknown'),
         COALESCE(SUM(c.amount),0) AS pending_amount, COUNT(*) AS pending_count
  FROM public.commissions c
  JOIN public.agents a   ON a.id = c.agent_id
  LEFT JOIN public.branches b ON b.id = a.branch_id
  WHERE c.status = 'due'
    AND (
          (auth.jwt() ->> 'app_role') IN ('distributor','admin')
       OR ((auth.jwt() ->> 'app_role') = 'branch' AND a.branch_id = auth.jwt() ->> 'branchId')
    )
  GROUP BY a.id, a.name, a.employee_id, a.branch_id, b.name
  HAVING COUNT(*) > 0
  ORDER BY pending_amount DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_dues_by_branch()
 RETURNS TABLE(branch_id text, branch_name text, pending_amount numeric,
               pending_count bigint, agent_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.branch_id, COALESCE(b.name,'Unknown'),
         COALESCE(SUM(c.amount),0) AS pending_amount, COUNT(*) AS pending_count,
         COUNT(DISTINCT c.agent_id) FILTER (WHERE c.agent_id IS NOT NULL) AS agent_count
  FROM public.commissions c
  LEFT JOIN public.branches b ON b.id = c.branch_id
  WHERE c.status = 'due'
    AND (
          (auth.jwt() ->> 'app_role') IN ('distributor','admin')
       OR ((auth.jwt() ->> 'app_role') = 'branch' AND c.branch_id = auth.jwt() ->> 'branchId')
    )
  GROUP BY c.branch_id, b.name
  HAVING COUNT(*) > 0
  ORDER BY pending_amount DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_top_branch(p_level text, p_parent_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role         TEXT := COALESCE(auth.jwt() ->> 'app_role', '');
  v_result       jsonb;
  v_now          timestamptz := public._demo_now();
  v_month_start  timestamptz := date_trunc('month', v_now);
  v_month_end    timestamptz := v_month_start + interval '1 month';
BEGIN
  IF v_role = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  IF v_role NOT IN ('distributor', 'admin', 'branch', 'agent') THEN
    RAISE EXCEPTION 'role_not_permitted' USING ERRCODE = 'P0002';
  END IF;
  IF p_level NOT IN ('country', 'region', 'district') THEN
    RETURN NULL;
  END IF;

  WITH contrib_by_branch AS (
    SELECT a.branch_id, COALESCE(SUM(t.amount), 0) AS contribution
      FROM public.transactions t
      JOIN public.agents a ON a.id = t.agent_id
     WHERE t.type = 'contribution'
       AND t.date >= v_month_start
       AND t.date <  v_month_end
     GROUP BY a.branch_id
  ),
  scoped AS (
    SELECT b.id, b.name, COALESCE(c.contribution, 0) AS contribution
      FROM public.branches b
      LEFT JOIN contrib_by_branch c ON c.branch_id = b.id
     WHERE p_level = 'country'
        OR (p_level = 'district' AND b.district_id = p_parent_id)
        OR (p_level = 'region'   AND b.district_id IN (
              SELECT d.id FROM public.districts d
               WHERE d.region_id = p_parent_id
           ))
  )
  SELECT jsonb_build_object('name', name, 'contribution', contribution)
    INTO v_result
    FROM scoped
   ORDER BY contribution DESC, name ASC
   LIMIT 1;

  RETURN v_result;
END;
$function$;

COMMIT;
