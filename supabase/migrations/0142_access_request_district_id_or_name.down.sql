-- DOWN for 0142_access_request_district_id_or_name.sql
-- ============================================================================
-- Restores the 0140 bodies verbatim: district resolved by NAME only, and no
-- resolved-name projection in list_access_requests.
--
-- REGRESSION WARNING: this re-breaks the two seeded employer requests
-- (ar-demo-001 'd-wakiso', ar-demo-002 'd-kampala'), which become un-approvable
-- again, and the admin panel goes back to showing the raw id. Run it only to
-- reach the exact post-0140 state — e.g. while reverting 0140 itself.
-- ============================================================================

-- ── 4. approve_access_request — carry district/address for BOTH kinds ───────
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

  -- (a) Fail loud BEFORE provisioning. The phone IS the sign-in key.
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
    -- District is OPTIONAL here and only here (see header): two requests
    -- predate the form field. Present-but-unknown is still fatal — that is a
    -- typo the admin must see, not a silent NULL geography.
    IF NULLIF(btrim(v_req.district), '') IS NOT NULL THEN
      SELECT id INTO v_district
        FROM public.districts
       WHERE lower(name) = lower(btrim(v_req.district))
       LIMIT 1;
      IF v_district IS NULL THEN
        RAISE EXCEPTION 'Cannot approve %: district "%" is not a known Uganda district.',
          v_req.org_name, btrim(v_req.district)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120), v_name, v_phone, v_email, 'ug', v_reg_no,
      v_district, NULLIF(left(btrim(COALESCE(v_req.physical_address, '')), 200), ''));
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

  -- (b) THE SIGN-IN IDENTITY. Idempotent after create_*'s best-effort call.
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

-- ── 5. list_access_requests — expose the address ───────────────────────────
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
      id,
      kind,
      org_name         AS "orgName",
      contact_name     AS "contactName",
      contact_email    AS "contactEmail",
      contact_phone    AS "contactPhone",
      registration_no  AS "registrationNo",
      sector,
      district,
      physical_address AS "physicalAddress",
      message,
      status,
      provisioned_id   AS "provisionedId",
      created_at       AS "createdAt",
      decided_at       AS "decidedAt"
    FROM public.access_requests
    WHERE p_status IS NULL OR p_status = 'all' OR status = p_status
  ) r;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_access_requests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_access_requests(text) TO authenticated, service_role;

