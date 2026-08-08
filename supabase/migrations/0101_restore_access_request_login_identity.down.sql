-- 0101_restore_access_request_login_identity.down.sql
-- Reverts the three function bodies to their pre-0101 (0093 / 0095) state and
-- drops the helper.
--
-- ⚠️ The backfilled `demo_personas` / `users` rows are NOT removed. They are
-- data repair, not schema: deleting them would re-break the sign-in for every
-- account this migration fixed and drop those owners back into emp-001 / d-001.
-- Remove them by hand if you genuinely need to.
--
-- ⚠️ Rolling back re-opens the defect this migration exists to close: approved
-- employers/distributors will again provision with no sign-in identity.

BEGIN;

-- ── approve_access_request — back to the 0095 body ───────────────────────────
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

  v_phone := CASE WHEN NULLIF(btrim(v_req.contact_phone), '') ~ '^\+?[0-9 ()-]{7,32}$'
                  THEN btrim(v_req.contact_phone) ELSE NULL END;
  v_email := CASE WHEN NULLIF(btrim(v_req.contact_email), '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                  THEN btrim(v_req.contact_email) ELSE NULL END;
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
    SELECT id INTO v_district
      FROM public.districts
     WHERE lower(name) = lower(NULLIF(btrim(v_req.district), ''))
     LIMIT 1;
    v_created := public.create_employer(
      left(btrim(v_req.org_name), 160),
      NULLIF(left(btrim(v_req.sector), 80), ''),
      v_reg_no,
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

-- ── create_employer — back to the 0093 body (no identity write) ──────────────
CREATE OR REPLACE FUNCTION public.create_employer(
  p_name                       text,
  p_sector                     text  DEFAULT NULL,
  p_registration_no            text  DEFAULT NULL,
  p_contact_name               text  DEFAULT NULL,
  p_contact_phone              text  DEFAULT NULL,
  p_contact_email              text  DEFAULT NULL,
  p_district                   text  DEFAULT NULL,
  p_payroll_cadence            text  DEFAULT NULL,
  p_default_contribution_config jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   text  := (SELECT auth.jwt()) ->> 'app_role';
  v_config jsonb := COALESCE(p_default_contribution_config, '{}'::jsonb);
  v_id     text;
  v_row    public.employers%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot create an employer', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'employer name is required' USING ERRCODE = 'P0001';
  END IF;

  IF length(btrim(p_name))                    > 160 THEN RAISE EXCEPTION 'employer name is too long (max 160)'    USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_sector,          '')) > 80   THEN RAISE EXCEPTION 'sector is too long (max 80)'            USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_registration_no, '')) > 64   THEN RAISE EXCEPTION 'registration no is too long (max 64)'   USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_name,    '')) > 120  THEN RAISE EXCEPTION 'contact name is too long (max 120)'     USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_phone,   '')) > 32   THEN RAISE EXCEPTION 'contact phone is too long (max 32)'      USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_email,   '')) > 254  THEN RAISE EXCEPTION 'contact email is too long (max 254)'     USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_payroll_cadence, '')) > 32   THEN RAISE EXCEPTION 'payroll cadence is too long (max 32)'    USING ERRCODE = 'P0001'; END IF;

  IF NULLIF(btrim(p_contact_phone), '') IS NOT NULL
     AND btrim(p_contact_phone) !~ '^\+?[0-9 ()-]{7,32}$' THEN
    RAISE EXCEPTION 'contact phone is not a valid phone number' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(p_contact_email), '') IS NOT NULL
     AND btrim(p_contact_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'contact email is not a valid email address' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(btrim(p_district), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.districts WHERE id = btrim(p_district)) THEN
    RAISE EXCEPTION 'district % does not exist', p_district USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_contribution_config_shape(v_config);

  v_id := 'emp-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.employers (
    id, name, sector, registration_no, contact_name, contact_phone,
    contact_email, district, payroll_cadence, default_contribution_config
  ) VALUES (
    v_id, btrim(p_name),
    NULLIF(btrim(p_sector), ''), NULLIF(btrim(p_registration_no), ''),
    NULLIF(btrim(p_contact_name), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_contact_email), ''), NULLIF(btrim(p_district), ''),
    NULLIF(btrim(p_payroll_cadence), ''), v_config
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ── create_distributor — back to the 0095 body (no identity write) ───────────
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

DROP FUNCTION IF EXISTS public.register_login_identity(text, text, text, text, text, text);

COMMIT;
