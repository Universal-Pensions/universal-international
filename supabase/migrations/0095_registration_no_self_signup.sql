-- =============================================================================
-- 0095 — company registration number on the self-signup (access-request) path
-- =============================================================================
-- The admin "+ New Employer" form captures a company registration number, and
-- `employers.registration_no` + `create_employer(p_registration_no)` have
-- supported it since 0034/0049. The PUBLIC request-access form never asked for
-- it, so `approve_access_request` passed a literal NULL — the comment on that
-- line said as much ("registration_no not captured on the public form"). An
-- employer that self-signed-up therefore provisioned WITHOUT the registration
-- number an admin-created one always has.
--
-- Distributors had the same hole and one level deeper: a distributor is a
-- registered company in Uganda too, but `distributors` had no registration_no
-- column at all, so neither the admin form nor the public form could capture it.
--
-- This migration closes both:
--   1) access_requests.registration_no  — captured by the public form
--   2) distributors.registration_no     — new column, mirrors employers
--   3) create_distributor(...)          — gains p_registration_no
--   4) list_access_requests             — returns it so an admin sees it
--   5) approve_access_request           — carries it into BOTH create_* calls
--
-- Nullable + no backfill: existing rows genuinely predate the capture, and a
-- placeholder would be worse than an honest NULL.

-- ── 1) access_requests.registration_no ───────────────────────────────────────
ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS registration_no TEXT;

COMMENT ON COLUMN public.access_requests.registration_no IS
  'Company/network registration number captured on the public request-access form; passed to create_employer / create_distributor on approval.';

-- ── 2) distributors.registration_no ──────────────────────────────────────────
ALTER TABLE public.distributors
  ADD COLUMN IF NOT EXISTS registration_no TEXT;

COMMENT ON COLUMN public.distributors.registration_no IS
  'Company registration number. A distributor is a registered company in Uganda, so this mirrors employers.registration_no.';

-- ── 3) create_distributor — add p_registration_no ────────────────────────────
-- DROP first, not CREATE OR REPLACE: adding a parameter creates an OVERLOAD
-- rather than replacing, and two candidates make the PostgREST call ambiguous.
-- The new parameter is appended AFTER p_parent_id so every existing positional
-- caller (including approve_access_request below, which passes four args) keeps
-- resolving through the defaults.
DROP FUNCTION IF EXISTS public.create_distributor(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_distributor(
  p_name            text,
  p_manager_name    text DEFAULT NULL,
  p_manager_phone   text DEFAULT NULL,
  p_manager_email   text DEFAULT NULL,
  p_parent_id       text DEFAULT 'ug',
  p_registration_no text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := (SELECT auth.jwt()) ->> 'app_role';
  v_id   text;
  v_row  public.distributors%ROWTYPE;
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

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_distributor(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text, text) TO authenticated;

-- ── 4) list_access_requests — surface registrationNo to the admin ────────────
CREATE OR REPLACE FUNCTION public.list_access_requests(p_status text DEFAULT 'pending')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
      org_name        AS "orgName",
      contact_name    AS "contactName",
      contact_email   AS "contactEmail",
      contact_phone   AS "contactPhone",
      registration_no AS "registrationNo",
      sector,
      district,
      message,
      status,
      provisioned_id  AS "provisionedId",
      created_at      AS "createdAt",
      decided_at      AS "decidedAt"
    FROM public.access_requests
    WHERE p_status IS NULL OR p_status = 'all' OR status = p_status
  ) r;

  RETURN v_result;
END;
$$;

REVOKE ALL     ON FUNCTION public.list_access_requests(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_access_requests(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.list_access_requests(text) TO authenticated;

-- ── 5) approve_access_request — carry registration_no into BOTH create_* ─────
CREATE OR REPLACE FUNCTION public.approve_access_request(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     text := (SELECT auth.jwt()) ->> 'app_role';
  v_req      public.access_requests%ROWTYPE;
  v_created  jsonb;
  v_new_id   text;
  v_phone    text;
  v_email    text;
  v_district text;
  v_reg_no   text;
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

  -- Sanitize free-text lead fields so the create_* validators (length caps,
  -- phone/email regex, district-id existence) never reject an otherwise-valid
  -- request: drop a malformed phone/email; resolve the district NAME to its id.
  v_phone := CASE WHEN NULLIF(btrim(v_req.contact_phone), '') ~ '^\+?[0-9 ()-]{7,32}$'
                  THEN btrim(v_req.contact_phone) ELSE NULL END;
  v_email := CASE WHEN NULLIF(btrim(v_req.contact_email), '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                  THEN btrim(v_req.contact_email) ELSE NULL END;
  -- Truncated to the same cap the API enforces, so a legacy over-long row can
  -- never block an approval.
  v_reg_no := NULLIF(left(btrim(COALESCE(v_req.registration_no, '')), 64), '');

  IF v_req.kind = 'distributor' THEN
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120),
      NULLIF(left(btrim(v_req.contact_name), 120), ''),
      v_phone,
      v_email,
      'ug',
      v_reg_no
    );
  ELSE
    -- create_employer validates p_district against districts.id — resolve the
    -- captured district NAME to its id (NULL if it doesn't match one).
    SELECT id INTO v_district
      FROM public.districts
     WHERE lower(name) = lower(NULLIF(btrim(v_req.district), ''))
     LIMIT 1;
    v_created := public.create_employer(
      left(btrim(v_req.org_name), 160),
      NULLIF(left(btrim(v_req.sector), 80), ''),
      v_reg_no,            -- was a literal NULL before 0095
      NULLIF(left(btrim(v_req.contact_name), 120), ''),
      v_phone,
      v_email,
      v_district
    );
  END IF;

  v_new_id := v_created ->> 'id';

  UPDATE public.access_requests
     SET status = 'approved', provisioned_id = v_new_id, decided_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'approved', 'provisionedId', v_new_id);
END;
$$;

REVOKE ALL     ON FUNCTION public.approve_access_request(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_access_request(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_access_request(text) TO authenticated;
