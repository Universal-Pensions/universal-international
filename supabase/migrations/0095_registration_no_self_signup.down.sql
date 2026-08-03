-- Down-migration for 0095 — drop the registration-number capture again.
--
-- Restores create_distributor to its 0049 five-argument shape, list_access_requests
-- and approve_access_request to their 0079 bodies (registration_no back to a
-- literal NULL for employers), then drops the two columns.

-- ── create_distributor — back to the 0049 signature ──────────────────────────
DROP FUNCTION IF EXISTS public.create_distributor(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_distributor(
  p_name          text,
  p_manager_name  text DEFAULT NULL,
  p_manager_phone text DEFAULT NULL,
  p_manager_email text DEFAULT NULL,
  p_parent_id     text DEFAULT 'ug'
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
    id, name, parent_id, manager_name, manager_phone, manager_email, status
  ) VALUES (
    v_id, btrim(p_name), COALESCE(NULLIF(btrim(p_parent_id), ''), 'ug'),
    p_manager_name, p_manager_phone, p_manager_email, 'active'
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_distributor(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text) TO authenticated;

-- ── list_access_requests — drop registrationNo from the projection ───────────
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
      org_name       AS "orgName",
      contact_name   AS "contactName",
      contact_email  AS "contactEmail",
      contact_phone  AS "contactPhone",
      sector,
      district,
      message,
      status,
      provisioned_id AS "provisionedId",
      created_at     AS "createdAt",
      decided_at     AS "decidedAt"
    FROM public.access_requests
    WHERE p_status IS NULL OR p_status = 'all' OR status = p_status
  ) r;

  RETURN v_result;
END;
$$;

REVOKE ALL     ON FUNCTION public.list_access_requests(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_access_requests(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.list_access_requests(text) TO authenticated;

-- ── approve_access_request — back to passing NULL for registration_no ───────
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

  v_phone := CASE WHEN NULLIF(btrim(v_req.contact_phone), '') ~ '^\+?[0-9 ()-]{7,32}$'
                  THEN btrim(v_req.contact_phone) ELSE NULL END;
  v_email := CASE WHEN NULLIF(btrim(v_req.contact_email), '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                  THEN btrim(v_req.contact_email) ELSE NULL END;

  IF v_req.kind = 'distributor' THEN
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120),
      NULLIF(left(btrim(v_req.contact_name), 120), ''),
      v_phone,
      v_email
    );
  ELSE
    SELECT id INTO v_district
      FROM public.districts
     WHERE lower(name) = lower(NULLIF(btrim(v_req.district), ''))
     LIMIT 1;
    v_created := public.create_employer(
      left(btrim(v_req.org_name), 160),
      NULLIF(left(btrim(v_req.sector), 80), ''),
      NULL,                -- registration_no not captured on the public form
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

-- ── columns last (functions above no longer reference them) ─────────────────
ALTER TABLE public.distributors     DROP COLUMN IF EXISTS registration_no;
ALTER TABLE public.access_requests  DROP COLUMN IF EXISTS registration_no;
