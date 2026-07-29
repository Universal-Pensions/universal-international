-- 0091_create_distributor_country_parent.sql
-- `create_distributor` could never succeed with its own DEFAULT parent.
--
-- The function defaults `p_parent_id` to 'ug' and then requires that value to
-- exist as a row in `public.distributors`. It does not: 'ug' is the COUNTRY
-- root of the geo hierarchy (the four regions hang off it), and it is exactly
-- what both seeded distributors already carry as their own `parent_id`.
--
-- So EVERY call with the default raised
--     parent distributor ug does not exist
-- which silently broke two flows outright:
--   * the admin's "+ New distributor" form (src/admin-dashboard/distributors)
--   * approving a distributor access request (approve_access_request -> 0090)
--
-- Found by running the access-request approval end to end against production;
-- no test covered it, because nothing in the suite creates a distributor.
--
-- Fix: only validate a parent that is genuinely another distributor. Employer
-- creation is unaffected (`create_employer` has no parent concept).

CREATE OR REPLACE FUNCTION public.create_distributor(p_name text, p_manager_name text DEFAULT NULL::text, p_manager_phone text DEFAULT NULL::text, p_manager_email text DEFAULT NULL::text, p_parent_id text DEFAULT 'ug'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := (SELECT auth.jwt()) ->> 'app_role';
  v_parent text := COALESCE(NULLIF(btrim(p_parent_id), ''), 'ug');
  v_id     text;
  v_row    public.distributors%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot create a distributor', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'distributor name is required' USING ERRCODE = 'P0001';
  END IF;

  IF length(btrim(p_name))       > 120 THEN RAISE EXCEPTION 'distributor name is too long (max 120)'    USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_manager_name,  '')) > 120 THEN RAISE EXCEPTION 'manager name is too long (max 120)'  USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_manager_phone, '')) > 32  THEN RAISE EXCEPTION 'manager phone is too long (max 32)'  USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_manager_email, '')) > 254 THEN RAISE EXCEPTION 'manager email is too long (max 254)' USING ERRCODE = 'P0001'; END IF;

  IF NULLIF(btrim(p_manager_phone), '') IS NOT NULL
     AND btrim(p_manager_phone) !~ '^\+?[0-9 ()-]{7,32}$' THEN
    RAISE EXCEPTION 'manager phone is not a valid phone number' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(p_manager_email), '') IS NOT NULL
     AND btrim(p_manager_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'manager email is not a valid email address' USING ERRCODE = 'P0001';
  END IF;

  -- 'ug' is the COUNTRY root, not a distributor row — it is what both seeded
  -- distributors already carry as parent_id. Requiring it to exist in
  -- `distributors` made this function fail on its own DEFAULT, so no distributor
  -- could ever be created: not by the admin's "+ New" form, not by approving an
  -- access request. Only validate a parent that is genuinely another distributor.
  IF v_parent <> 'ug'
     AND NOT EXISTS (SELECT 1 FROM public.distributors WHERE id = v_parent) THEN
    RAISE EXCEPTION 'parent distributor % does not exist', v_parent USING ERRCODE = 'P0001';
  END IF;

  v_id := 'd-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.distributors (
    id, name, parent_id, manager_name, manager_phone, manager_email, status
  ) VALUES (
    v_id, btrim(p_name), v_parent,
    NULLIF(btrim(p_manager_name), ''), NULLIF(btrim(p_manager_phone), ''), NULLIF(btrim(p_manager_email), ''),
    'active'
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$
;