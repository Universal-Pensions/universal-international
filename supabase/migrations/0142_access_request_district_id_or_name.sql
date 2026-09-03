-- 0142_access_request_district_id_or_name.sql
-- ============================================================================
-- Both pending EMPLOYER access requests are un-approvable, and have been since
-- they were seeded. Approve raises:
--     Cannot approve Nsambya Medical Centre: district "d-kampala" is not a
--     known Uganda district.
--
-- THE DEFECT
-- ----------
-- `access_requests.district` holds whatever the writer put there. The public
-- form writes a NAME ("Budaka" — the approved Uniclusion row proves it), but
-- the demo seed writes an ID:
--     ar-demo-001  Kigo Tea Estates Ltd    d-wakiso
--     ar-demo-002  Nsambya Medical Centre  d-kampala
-- `approve_access_request` resolved by NAME only:
--     WHERE lower(name) = lower(btrim(v_req.district))
-- so both seeded rows miss and the approval aborts. `create_employer` has
-- accepted EITHER form since 0121 (A06-011) — the approve path in front of it
-- never caught up, so the tolerance that exists one layer down is unreachable.
--
-- Found while adding distributor geography in 0140: putting a District column
-- on every row of the admin Access-requests panel made "d-kampala" visible on
-- screen, which is how a latent seed/RPC mismatch became a demo-breaking bug a
-- sales rep would hit on the first Approve click.
--
-- THE FIX
-- -------
-- One resolution for both kinds, `id OR name`, matching create_employer and
-- create_distributor exactly. 0140's distributor branch had the same name-only
-- narrowness and is folded into the shared block here.
--
-- `list_access_requests` also projects the RESOLVED name, so the panel reads
-- "Kampala" rather than "d-kampala". COALESCE leaves an unresolvable value
-- visible verbatim — that is what the admin needs in order to fix it, and a
-- blank would hide the problem this migration exists to surface.
--
-- NOT FIXED HERE: the seed rows themselves still hold ids. They are now
-- approvable and display correctly, and rewriting demo data to paper over an
-- RPC that should have been tolerant is the wrong half of the fix.
--
-- VERIFIED on the live DB before commit, in a rolled-back probe:
--     d-kampala -> Kampala | d-wakiso -> Wakiso
-- ============================================================================

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
  v_raw_dist text;
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

  -- ONE resolution for both kinds, by districts.id OR districts.name — the
  -- create_employer / create_distributor contract (A06-011). Resolving by id
  -- too is what makes the seeded 'd-kampala' rows approvable.
  v_raw_dist := NULLIF(btrim(v_req.district), '');
  IF v_raw_dist IS NOT NULL THEN
    SELECT id INTO v_district
      FROM public.districts
     WHERE id = v_raw_dist OR lower(name) = lower(v_raw_dist)
     LIMIT 1;
    IF v_district IS NULL THEN
      RAISE EXCEPTION 'Cannot approve %: district "%" is not a known Uganda district.',
        v_req.org_name, v_raw_dist USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_req.kind = 'distributor' THEN
    -- Absent stays legal for a distributor only: two requests predate the form
    -- field (0140) and would otherwise be permanently un-approvable.
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120), v_name, v_phone, v_email, 'ug', v_reg_no,
      v_district, NULLIF(left(btrim(COALESCE(v_req.physical_address, '')), 200), ''));
  ELSE
    IF v_district IS NULL THEN
      RAISE EXCEPTION 'Cannot approve %: district "%" is not a known Uganda district.',
        v_req.org_name, COALESCE(v_raw_dist, 'missing') USING ERRCODE = 'P0001';
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

REVOKE ALL ON FUNCTION public.approve_access_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_access_request(text) TO authenticated, service_role;

-- Display the resolved NAME. An unresolvable value falls through verbatim so
-- the admin can see what needs fixing rather than a silent blank.
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
      ar.id,
      ar.kind,
      ar.org_name         AS "orgName",
      ar.contact_name     AS "contactName",
      ar.contact_email    AS "contactEmail",
      ar.contact_phone    AS "contactPhone",
      ar.registration_no  AS "registrationNo",
      ar.sector,
      COALESCE(
        (SELECT d.name FROM public.districts d
          WHERE d.id = btrim(ar.district) OR lower(d.name) = lower(btrim(ar.district))
          LIMIT 1),
        ar.district
      )                   AS district,
      ar.physical_address AS "physicalAddress",
      ar.message,
      ar.status,
      ar.provisioned_id   AS "provisionedId",
      ar.created_at       AS "createdAt",
      ar.decided_at       AS "decidedAt"
    FROM public.access_requests ar
    WHERE p_status IS NULL OR p_status = 'all' OR ar.status = p_status
  ) r;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_access_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_access_requests(text) TO authenticated, service_role;
