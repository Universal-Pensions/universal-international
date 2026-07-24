-- 0075_lock_privilege_surface.sql
-- From deep platform audit 2026-07-08 (~/Desktop/uganda-deep-audit-2026-07-08.md).
--
-- APPLIED SUBSET (verified safe against live callers 2026-07-08):
--   HIGH-1  create_subscriber_from_agent_onboard — add app_role gate + fail-closed ownership
--   HIGH-2  the three 0041 commission rollups — caller-scope + REVOKE anon
--   C3      fund_insurance_products — REVOKE anon (already role-guarded in body)
--   MED-1c  REVOKE client UPDATE on the sensitive subscribers + insurance money columns
--   B5      distributors_select — scope to authenticated (was USING(true), anon PII read)
--
-- DEFERRED to the code phase (a direct client write still depends on them):
--   Part B ledger self-write policy drops — src/services/subscriber.js:1166 still inserts a
--          `transactions` row directly (renewPolicy). Convert it (+ withdrawals/claims paths) to
--          a DEFINER RPC first, THEN drop transactions/withdrawals/claims_insert_self.
--   MED-2  directory read re-scope (agents/branches/demo_personas) — needs the subscriber
--          "your agent" read path re-pointed first so it doesn't break.

-- ─── HIGH-1 ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_subscriber_from_agent_onboard(
  payload jsonb, calling_agent_id text, p_nonce text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jwt_agent_id TEXT;
  v_role         TEXT := auth.jwt() ->> 'app_role';
  v_new_id       TEXT;
  v_prior        JSONB;
BEGIN
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.subscriber_signup_uploads WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior #>> '{}';
    END IF;
  END IF;

  -- 0075 SECURITY (audit HIGH-1): hard role gate (mirrors the employer sibling).
  IF v_role IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'role % cannot onboard via the agent flow', COALESCE(v_role, '<anon>')
      USING ERRCODE = 'P0001';
  END IF;

  IF calling_agent_id IS NULL OR calling_agent_id = '' THEN
    RAISE EXCEPTION 'calling_agent_id is required';
  END IF;

  -- 0075 SECURITY (audit HIGH-1): fail-CLOSED ownership (was skipped when agentId was NULL).
  v_jwt_agent_id := auth.jwt() ->> 'agentId';
  IF v_jwt_agent_id IS NULL OR v_jwt_agent_id <> calling_agent_id THEN
    RAISE EXCEPTION 'calling_agent_id (%) must match the JWT agentId', calling_agent_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = calling_agent_id) THEN
    RAISE EXCEPTION 'unknown agent: %', calling_agent_id;
  END IF;

  PERFORM public._validate_signup_payload(payload);
  v_new_id := public._insert_subscriber_chain(payload, calling_agent_id);

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    INSERT INTO public.subscriber_signup_uploads (nonce, result)
    VALUES (p_nonce, to_jsonb(v_new_id))
    ON CONFLICT (nonce) DO NOTHING;
  END IF;

  RETURN v_new_id;
END;
$function$;

-- ─── HIGH-2 ───────────────────────────────────────────────────────────────────
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
  WHERE (  -- 0075 SECURITY (audit HIGH-2): caller scoping
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
    AND (  -- 0075 SECURITY (audit HIGH-2)
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
    AND (  -- 0075 SECURITY (audit HIGH-2)
          (auth.jwt() ->> 'app_role') IN ('distributor','admin')
       OR ((auth.jwt() ->> 'app_role') = 'branch' AND c.branch_id = auth.jwt() ->> 'branchId')
    )
  GROUP BY c.branch_id, b.name
  HAVING COUNT(*) > 0
  ORDER BY pending_amount DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_agent_commission_list(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_pending_dues_by_agent()      FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_pending_dues_by_branch()     FROM anon;

-- ─── C3 ───────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fund_insurance_products(text, text, jsonb, numeric, text) FROM anon;

-- ─── MED-1 (columns) ──────────────────────────────────────────────────────────
-- updateProfile (subscriber.js:1190) only writes name/email/phone/occupation/consent_at,
-- so revoking UPDATE on these tenancy/status/money columns is safe.
REVOKE UPDATE (agent_id, employer_id, compensation, kyc_status, is_active, nin)
  ON public.subscribers FROM authenticated, anon;
-- Re-apply 0072 §1f, which never took effect live (audit A2). No client writes these directly.
REVOKE UPDATE (insurance_funding_mode, insurance_premium_target,
               insurance_premium_accrued, last_indexed_at)
  ON public.contribution_schedules FROM authenticated, anon;

-- ─── B5 ───────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS distributors_select ON public.distributors;
CREATE POLICY distributors_select ON public.distributors
  FOR SELECT TO public
  USING ((auth.jwt() ->> 'app_role') IS NOT NULL);
