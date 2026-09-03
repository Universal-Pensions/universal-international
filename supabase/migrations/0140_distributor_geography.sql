-- 0140_distributor_geography.sql
-- ============================================================================
-- A distributor has no geography. `distributors` is (id, name, parent_id,
-- manager_*, status, registration_no) and nothing else — every row sits at
-- parent_id = 'ug', so the platform cannot say WHERE a distributor is based.
--
-- THE DEFECT
-- ----------
-- The employer and distributor onboarding journeys were built as twins (0079
-- request-access, 0095 registration_no, 0101 login identity) and have been
-- pulled back into line twice already. District is the last field where they
-- still diverge, and it diverges in THREE places at once:
--
--   1. `validateAccessRequest.FIELD_ORDER.distributor` omits `district`, so the
--      public form never renders the input.
--   2. `api/access-request.ts` stores `district: kind === 'employer' ? … : null`
--      — even a district that somehow arrived would be discarded.
--   3. `distributors` has no column, so `create_distributor` has nowhere to put
--      one and the admin "+ New Distributor" form does not ask.
--
-- Fixing only the form would hit (2); fixing only (1)+(2) would hit (3). All
-- three move together here, and the admin door and the self-signup door end up
-- asking for the SAME fields — the deviation 0095's header calls out by name.
--
-- THE FIX
-- -------
-- `distributors.district` + `distributors.physical_address`, mirroring the
-- `employers` contract exactly:
--   • district stores the district NAME, never the id (A06-011, settled in
--     0121 for create_employer). Callers may pass either form; both resolve.
--   • an unresolvable district is fatal; an ABSENT one is not (see below).
--
-- BACKFILL — an inference, deliberately labelled as one
-- ----------------------------------------------------
-- The three live distributors predate the column. Their head office is not
-- recorded anywhere, but their branches are: `branches.distributor_id` is
-- populated for 318 rows and `branches.district_id` is NOT NULL. So each
-- distributor is seeded with the district holding the MOST of its branches:
--   d-001 National        -> Kampala (Central,  8 branches)
--   d-002 Secondary       -> Jinja   (Eastern,  5 branches)  [Busoga, per 0080-0089]
--   d-003 Karamoja Pilot  -> Kotido  (Northern, 1 branch)
-- That is a plausible operating base, not a registered address. New rows get a
-- real value from the form; nothing else is invented here.
--
-- WHY MISSING STAYS NON-FATAL ON APPROVE
-- --------------------------------------
-- Two distributor access requests are pending RIGHT NOW with district IS NULL —
-- they were submitted through the form that never asked. Making district fatal
-- in `approve_access_request` would strand both permanently, which is the exact
-- un-approvable-request failure 0090's header warns about. So: a district that
-- is present must resolve, and a district that is absent provisions as today.
-- The API route requires it going forward, so only these legacy rows can be NULL.
-- ============================================================================

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.distributors
  ADD COLUMN IF NOT EXISTS district         TEXT,
  ADD COLUMN IF NOT EXISTS physical_address TEXT;

COMMENT ON COLUMN public.distributors.district IS
  'District NAME (not districts.id) — same contract as employers.district (A06-011).';
COMMENT ON COLUMN public.distributors.physical_address IS
  'Free-text office/street address. Optional; the district is the map-bearing field.';

-- The request row needs somewhere to carry the address between submit and
-- approve. `district` already exists on this table (0079) and was only
-- employer-populated by convention, so it needs no DDL.
ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS physical_address TEXT;

COMMENT ON COLUMN public.access_requests.physical_address IS
  'Distributor office address from the public form; rides through to create_distributor on approve.';

-- ── 2. Backfill (see header — modal branch district, demo inference) ────────
WITH modal AS (
  SELECT DISTINCT ON (b.distributor_id)
         b.distributor_id, d.name AS district_name
    FROM public.branches b
    JOIN public.districts d ON d.id = b.district_id
   WHERE b.distributor_id IS NOT NULL
   GROUP BY b.distributor_id, d.name
   ORDER BY b.distributor_id, count(*) DESC, d.name
)
UPDATE public.distributors dist
   SET district = modal.district_name, updated_at = now()
  FROM modal
 WHERE modal.distributor_id = dist.id
   AND dist.district IS NULL;

-- ── 3. create_distributor — district + address ─────────────────────────────
-- DROP first, not CREATE OR REPLACE: adding defaulted parameters creates a
-- second OVERLOAD rather than replacing, and then the 6-arg call inside
-- approve_access_request matches BOTH and fails ambiguous.
DROP FUNCTION IF EXISTS public.create_distributor(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_distributor(
  p_name             text,
  p_manager_name     text DEFAULT NULL,
  p_manager_phone    text DEFAULT NULL,
  p_manager_email    text DEFAULT NULL,
  p_parent_id        text DEFAULT 'ug',
  p_registration_no  text DEFAULT NULL,
  p_district         text DEFAULT NULL,
  p_physical_address text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_district_name text;
  v_bound         text;
  v_id            text;
  v_row           public.distributors%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot create a distributor', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'distributor name is required' USING ERRCODE = 'P0001';
  END IF;

  IF length(btrim(p_name))                     > 120 THEN RAISE EXCEPTION 'distributor name is too long (max 120)' USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_registration_no,  '')) > 64  THEN RAISE EXCEPTION 'registration no is too long (max 64)'    USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_physical_address, '')) > 200 THEN RAISE EXCEPTION 'address is too long (max 200)'           USING ERRCODE = 'P0001'; END IF;

  -- District accepts EITHER `districts.id` or `districts.name` and always
  -- STORES the name — byte-for-byte the create_employer contract (A06-011), so
  -- the two tables stay joinable the same way.
  IF NULLIF(btrim(p_district), '') IS NOT NULL THEN
    SELECT name INTO v_district_name
      FROM public.districts
     WHERE id = btrim(p_district) OR lower(name) = lower(btrim(p_district))
     LIMIT 1;
    IF v_district_name IS NULL THEN
      RAISE EXCEPTION 'district % does not exist', p_district USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_id := 'd-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.distributors (
    id, name, parent_id, manager_name, manager_phone, manager_email,
    registration_no, district, physical_address, status
  ) VALUES (
    v_id, btrim(p_name), COALESCE(NULLIF(btrim(p_parent_id), ''), 'ug'),
    p_manager_name, p_manager_phone, p_manager_email,
    NULLIF(btrim(COALESCE(p_registration_no, '')), ''),
    v_district_name,
    NULLIF(btrim(COALESCE(p_physical_address, '')), ''),
    'active'
  )
  RETURNING * INTO v_row;

  -- Sign-in identity (0101 / A06-005) — unchanged from the 6-arg version.
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

REVOKE ALL ON FUNCTION public.create_distributor(text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text, text, text, text) TO authenticated, service_role;

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

