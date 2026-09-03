-- DOWN for 0140_distributor_geography.sql
-- ============================================================================
-- Restores the 6-arg create_distributor, the district-fatal-for-employers-only
-- approve_access_request, and the address-free list_access_requests, then drops
-- the two columns.
--
-- DATA LOSS: dropping `distributors.district` / `.physical_address` and
-- `access_requests.physical_address` discards every value captured since 0140.
-- The distributor districts are re-derivable from `branches` (the same modal
-- query 0140 backfilled with); a typed office address is NOT recoverable.
-- ============================================================================

-- ── 1. list_access_requests — drop "physicalAddress" from the projection ───
CREATE OR REPLACE FUNCTION public.list_access_requests(p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := (SELECT auth.jwt()) ->> 'app_role';
  v_result jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read access requests', v_role USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r."createdAt" DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      id, kind,
      org_name        AS "orgName",
      contact_name    AS "contactName",
      contact_email   AS "contactEmail",
      contact_phone   AS "contactPhone",
      registration_no AS "registrationNo",
      sector, district, message, status,
      provisioned_id  AS "provisionedId",
      created_at      AS "createdAt",
      decided_at      AS "decidedAt"
    FROM public.access_requests
    WHERE p_status IS NULL OR p_status = 'all' OR status = p_status
  ) r;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_access_requests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_access_requests(text) TO authenticated, service_role;

-- ── 2. approve_access_request — pre-0140 body (verbatim) ──────────────────
CREATE OR REPLACE FUNCTION public.approve_access_request(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role     text := (SELECT auth.jwt()) ->> 'app_role';
  v_req      public.access_requests%ROWTYPE;
  v_created  jsonb;
  v_new_id   text;
  v_phone    text;
  v_email    text;
  v_district text;
  v_reg_no   text;
  v_persona  text;
  v_name     text;
  v_bound    text;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot approve access requests', v_role USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.access_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access request % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'access request already %', v_req.status USING ERRCODE = 'P0001';
  END IF;

  v_persona := CASE WHEN v_req.kind = 'distributor' THEN 'distributor' ELSE 'employer' END;

  v_phone := public.canonical_ug_phone(v_req.contact_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION
      'Cannot approve %: the contact phone (%) is not a valid Uganda mobile, and the phone is the sign-in key.',
      v_req.org_name, COALESCE(NULLIF(btrim(v_req.contact_phone), ''), 'missing')
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demo_personas WHERE phone = v_phone AND role = v_persona) THEN
    RAISE EXCEPTION 'Phone % is already the sign-in for another % account.', v_phone, v_persona
      USING ERRCODE = 'P0001';
  END IF;

  v_email := NULLIF(btrim(v_req.contact_email), '');
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Cannot approve %: a valid contact email is required.', v_req.org_name
      USING ERRCODE = 'P0001';
  END IF;

  v_name   := left(btrim(COALESCE(NULLIF(btrim(v_req.contact_name), ''), v_req.org_name)), 120);
  v_reg_no := NULLIF(left(btrim(COALESCE(v_req.registration_no, '')), 64), '');

  IF v_req.kind = 'distributor' THEN
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120), v_name, v_phone, v_email, 'ug', v_reg_no);
  ELSE
    SELECT id INTO v_district
      FROM public.districts
     WHERE lower(name) = lower(NULLIF(btrim(v_req.district), ''))
     LIMIT 1;
    IF v_district IS NULL THEN
      RAISE EXCEPTION 'Cannot approve %: district "%" is not a known Uganda district.',
        v_req.org_name, COALESCE(NULLIF(btrim(v_req.district), ''), 'missing')
        USING ERRCODE = 'P0001';
    END IF;
    v_created := public.create_employer(
      left(btrim(v_req.org_name), 160),
      NULLIF(left(btrim(v_req.sector), 80), ''),
      v_reg_no,
      v_name, v_phone, v_email, v_district);
  END IF;

  v_new_id := v_created ->> 'id';

  v_bound := public.register_login_identity(
    v_phone, v_persona, v_new_id, left(btrim(v_req.org_name), 120), v_name, v_email);
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'Cannot approve %: failed to register % as the sign-in for %.',
      v_req.org_name, v_phone, v_new_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.access_requests
     SET status = 'approved', provisioned_id = v_new_id, decided_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'approved', 'provisionedId', v_new_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_access_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_access_request(text) TO authenticated, service_role;

-- ── 3. create_distributor — back to 6 args ────────────────────────────────
-- Drop the 8-arg form FIRST: leaving both overloads live makes the 6-arg call
-- in approve_access_request above ambiguous.
DROP FUNCTION IF EXISTS public.create_distributor(text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_distributor(
  p_name            text,
  p_manager_name    text DEFAULT NULL,
  p_manager_phone   text DEFAULT NULL,
  p_manager_email   text DEFAULT NULL,
  p_parent_id       text DEFAULT 'ug',
  p_registration_no text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role  text := (SELECT auth.jwt()) ->> 'app_role';
  v_bound text;
  v_id    text;
  v_row   public.distributors%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot create a distributor', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'distributor name is required' USING ERRCODE = 'P0001';
  END IF;

  v_id := 'd-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.distributors (
    id, name, parent_id, manager_name, manager_phone, manager_email,
    registration_no, status
  ) VALUES (
    v_id, btrim(p_name), COALESCE(NULLIF(btrim(p_parent_id), ''), 'ug'),
    p_manager_name, p_manager_phone, p_manager_email,
    NULLIF(btrim(COALESCE(p_registration_no, '')), ''), 'active'
  )
  RETURNING * INTO v_row;

  IF NULLIF(btrim(v_row.manager_phone), '') IS NOT NULL THEN
    v_bound := public.register_login_identity(
      v_row.manager_phone, 'distributor', v_row.id,
      v_row.name, v_row.manager_name, v_row.manager_email);
    IF v_bound IS NULL THEN
      RAISE EXCEPTION
        'Cannot create %: phone % could not be registered as its sign-in — it is not a valid Uganda mobile, or it already signs in to a different distributor.',
        v_row.name, v_row.manager_phone
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_distributor(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text, text) TO authenticated, service_role;
-- Same ACL reset as the forward migration: DROP + CREATE re-grants `anon` via
-- Supabase default privileges. Strip it so the restored 6-arg function matches
-- its pre-0140 ACL exactly.
REVOKE ALL ON FUNCTION public.create_distributor(text, text, text, text, text, text) FROM anon;

-- ── 4. Columns last (functions above no longer reference them) ────────────
ALTER TABLE public.distributors    DROP COLUMN IF EXISTS district;
ALTER TABLE public.distributors    DROP COLUMN IF EXISTS physical_address;
ALTER TABLE public.access_requests DROP COLUMN IF EXISTS physical_address;
