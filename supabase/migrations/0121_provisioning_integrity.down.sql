-- 0121_provisioning_integrity.down.sql
-- Reverts the three function bodies to their EXACT pre-0121 state, captured
-- live via `pg_get_functiondef()` immediately before 0121 was written (NOT
-- retyped from 0101 or any other older migration file — retyping from an
-- older file is the precise mechanism that caused A06-005 in the first
-- place: 0095's CREATE OR REPLACE was built from the 0079 body instead of
-- 0090's, and silently deleted every 0090 improvement. See 0121's header).
--
-- ⚠️ Data changes are NOT reverted:
--   * A06-011 employer repair (district name / default_contribution_config /
--     payroll_cadence on the employer(s) that were malformed) — deleting the
--     repair would put the district id back in the name field, empty the
--     contribution config, and null the cadence again, undoing an unambiguous
--     data-quality fix for no benefit.
--   * A06-012 `demo_personas`/`users` backfill for previously login-less
--     employers/distributors — removing these rows would re-break sign-in for
--     every account this migration bound, dropping their owners back onto
--     ROLE_DEFAULTS (`emp-001` / `d-001`) exactly as 0101's down migration
--     already established as the wrong move for the same class of row.
--   * A06-013 `users` breadcrumb prune — deleted rows are inert login
--     breadcrumbs (no entity_id, no password_hash); they are recreated
--     automatically on the next OTP sign-in attempt for that phone/role, so
--     there is nothing meaningful to restore.
-- Remove/restore any of the above by hand if you genuinely need to.
--
-- ⚠️ Rolling back re-opens A06-005: `create_employer` / `create_distributor`
-- go back to ignoring `register_login_identity`'s return value, so an admin
-- "+ New Employer" / "+ New Distributor" submission with a phone that
-- collides with an existing sign-in will once again silently succeed while
-- leaving that phone still pointing at its original entity. It also re-opens
-- A06-011's district/config/cadence defaults for any NEW employer created
-- after the rollback (does not affect rows already repaired above).

BEGIN;

-- ── create_employer — back to the exact live (0101) body ─────────────────────
CREATE OR REPLACE FUNCTION public.create_employer(p_name text, p_sector text DEFAULT NULL::text, p_registration_no text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_district text DEFAULT NULL::text, p_payroll_cadence text DEFAULT NULL::text, p_default_contribution_config jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Sign-in identity (0101). Best-effort: no phone / not a Ugandan mobile /
  -- already another employer's sign-in -> returns NULL, create still succeeds.
  PERFORM public.register_login_identity(
    v_row.contact_phone, 'employer', v_row.id,
    v_row.name, v_row.contact_name, v_row.contact_email);

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL     ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) TO authenticated;

-- ── create_distributor — back to the exact live (0101) body ──────────────────
CREATE OR REPLACE FUNCTION public.create_distributor(p_name text, p_manager_name text DEFAULT NULL::text, p_manager_phone text DEFAULT NULL::text, p_manager_email text DEFAULT NULL::text, p_parent_id text DEFAULT 'ug'::text, p_registration_no text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Sign-in identity (0101) — best-effort, same rationale as create_employer.
  PERFORM public.register_login_identity(
    v_row.manager_phone, 'distributor', v_row.id,
    v_row.name, v_row.manager_name, v_row.manager_email);

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL     ON FUNCTION public.create_distributor(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text, text) TO authenticated;

-- ── _assert_contribution_config_shape — back to the exact live (0093) body ──
CREATE OR REPLACE FUNCTION public._assert_contribution_config_shape(p_config jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF p_config IS NULL THEN
    RETURN;
  END IF;

  IF jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'default contribution config must be a JSON object' USING ERRCODE = 'P0001';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['employeePct', 'employerPct'] LOOP
    IF (p_config -> v_key) IS NOT NULL AND jsonb_typeof(p_config -> v_key) <> 'null' THEN
      -- Type-check BEFORE casting so a garbage value gets the friendly P0001 the
      -- service layer surfaces, not a raw 22P02 invalid_text_representation.
      IF jsonb_typeof(p_config -> v_key) <> 'number' THEN
        RAISE EXCEPTION '% must be a number', v_key USING ERRCODE = 'P0001';
      END IF;
      IF (p_config ->> v_key)::numeric < 0 OR (p_config ->> v_key)::numeric > 100 THEN
        RAISE EXCEPTION '% must be between 0 and 100', v_key USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
END;
$function$;

COMMIT;
