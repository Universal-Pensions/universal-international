-- 0101_restore_access_request_login_identity.sql
-- Restore (and generalise) the 0090 fix that 0095 silently reverted.
--
-- ── WHAT HAPPENED ────────────────────────────────────────────────────────────
-- `0090_access_request_login_identity.sql` fixed the defect where an approved
-- employer/distributor signing in landed inside the demo `emp-001` (Nile
-- Breweries) / `d-001` tenant: it made `approve_access_request` fail loud on an
-- unusable phone/email/district, and — the actual fix — write the
-- `demo_personas` row that `api/auth/_lib/personas.ts` resolves a sign-in
-- through, plus a matching `users` row.
--
-- `0095_registration_no_self_signup.sql` then needed to carry the new
-- `registration_no` into the two create_* calls. It did that with a
-- `CREATE OR REPLACE FUNCTION public.approve_access_request` whose body was
-- built from the **0079** version, not the 0090 one. CREATE OR REPLACE does not
-- merge — it overwrites. Every 0090 improvement was dropped in that one
-- statement:
--   * `canonical_ug_phone()`      -> back to a loose `^\+?[0-9 ()-]{7,32}$`
--   * fail-loud validation        -> back to silently NULLing a bad phone
--   * `demo_personas` INSERT      -> gone
--   * `users` INSERT              -> gone
-- Nothing failed. The approval still returned `{status: 'approved'}` with a real
-- `provisionedId`, so from the admin screen it looked like it worked.
--
-- Observed on production 2026-08-07: access request `ar-1786103803205-x30h`
-- ("Uniclusion Uganda", +256701232323) approved at 11:57:13 -> employer
-- `emp-80511f65be7a4656b2bd45b6fad18625` created, ZERO `demo_personas` rows
-- written. The owner signed in at 11:58:13, `resolveDemoPersona` missed, and
-- `ROLE_DEFAULTS.employer` dropped them into `emp-001` — Nile Breweries — with
-- write access to its roster.
--
-- ── WHAT THIS MIGRATION DOES ─────────────────────────────────────────────────
-- 1) `register_login_identity()` — the persona+users write extracted into ONE
--    function. 0090 inlined it in `approve_access_request`, which is precisely
--    why a routine CREATE OR REPLACE of that function could delete it. Now the
--    identity write lives somewhere a rewrite of the caller cannot silently
--    drop, and there is a single place to keep in sync with personas.ts.
-- 2) `approve_access_request` — 0090's fail-loud semantics AND 0095's
--    registration_no, together. This is the merge that should have happened.
-- 3) `create_employer` / `create_distributor` — best-effort identity write, so
--    the admin "+ New Employer" / "+ New Distributor" forms stop producing the
--    same orphaned account. Same defect, second door: neither RPC ever wrote a
--    persona either. Best-effort by design — these two take an OPTIONAL contact
--    phone, so an unusable/absent one must not fail the create.
-- 4) Backfill — repairs accounts provisioned during the regression window.
--
-- ⚠️ As with 0090: a PENDING request whose phone/email/district is missing or
-- malformed becomes un-approvable, and there is no edit-request screen. Check
-- `access_requests WHERE status='pending'` before applying.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) register_login_identity — the sign-in key, written in one place.
--
-- Returns the canonical phone on success, or NULL when the identity could not
-- be registered (unusable phone, or the phone already signs in to a DIFFERENT
-- account of that role). Callers that must not proceed without a working login
-- check for NULL and raise; callers where the phone is optional ignore it.
--
-- It NEVER steals an existing sign-in: if `(phone, role)` already resolves to
-- another entity we return NULL rather than repointing it, because repointing
-- would silently move the previous owner into someone else's tenant — the exact
-- failure this whole migration exists to stop.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_login_identity(
  p_phone_raw text,
  p_role      text,
  p_entity_id text,
  p_label     text,
  p_name      text DEFAULT NULL,
  p_email     text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text := public.canonical_ug_phone(p_phone_raw);
BEGIN
  IF v_phone IS NULL OR NULLIF(btrim(COALESCE(p_entity_id, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.demo_personas
     WHERE phone = v_phone AND role = p_role
       AND entity_id IS DISTINCT FROM p_entity_id
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.demo_personas (id, phone, role, entity_id, label)
  VALUES ('dp-' || replace(gen_random_uuid()::text, '-', ''),
          v_phone, p_role, p_entity_id,
          NULLIF(left(btrim(COALESCE(p_label, '')), 120), ''))
  ON CONFLICT (phone, role) DO NOTHING;

  -- `users` carries the password + last_login. The id shape matches the
  -- deterministic `${role}:${phone}` that api/auth/verify-otp.ts upserts, so a
  -- first OTP sign-in updates this row instead of colliding with it.
  --
  -- COALESCE keeps any value already on the row: an existing non-null
  -- entity_id/name/email is authoritative and must not be clobbered by a later
  -- create. (The NULL entity_id that verify-otp's upsert leaves behind IS
  -- filled in — that is the backfill case below.)
  INSERT INTO public.users (id, phone, role, name, email, entity_id)
  VALUES (p_role || ':' || v_phone, v_phone, p_role,
          NULLIF(left(btrim(COALESCE(p_name, '')), 120), ''),
          NULLIF(btrim(COALESCE(p_email, '')), ''),
          p_entity_id)
  ON CONFLICT (phone, role) DO UPDATE
     SET entity_id = COALESCE(users.entity_id, EXCLUDED.entity_id),
         name      = COALESCE(users.name,      EXCLUDED.name),
         email     = COALESCE(users.email,     EXCLUDED.email);

  RETURN v_phone;
END;
$$;

COMMENT ON FUNCTION public.register_login_identity(text, text, text, text, text, text) IS
  'Writes the demo_personas (+ users) row that api/auth/_lib/personas.ts resolves a non-subscriber sign-in through. Returns the canonical phone, or NULL if the phone is unusable or already signs in to a different account. Called by approve_access_request (fail-loud) and create_employer / create_distributor (best-effort).';

REVOKE ALL ON FUNCTION public.register_login_identity(text, text, text, text, text, text) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) approve_access_request — 0090's fail-loud identity write + 0095's
--    registration_no. Neither half is optional.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- (a) Fail loud BEFORE provisioning. The phone IS the sign-in key: an account
  --     created without a usable one cannot be signed into as itself, and the
  --     owner silently lands on ROLE_DEFAULTS instead.
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
  -- Truncated to the same cap the API enforces, so a legacy over-long row can
  -- never block an approval (0095).
  v_reg_no := NULLIF(left(btrim(COALESCE(v_req.registration_no, '')), 64), '');

  IF v_req.kind = 'distributor' THEN
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120), v_name, v_phone, v_email, 'ug', v_reg_no);
  ELSE
    -- create_employer validates p_district against districts.id — resolve the
    -- captured district NAME to its id.
    SELECT id INTO v_district
      FROM public.districts
     WHERE lower(name) = lower(NULLIF(btrim(v_req.district), ''))
     LIMIT 1;
    IF v_district IS NULL THEN
      RAISE EXCEPTION 'Cannot approve %: district "%" is not a known Uganda district.',
        v_req.org_name, COALESCE(NULLIF(btrim(v_req.district), ''), 'missing')
        USING ERRCODE = 'P0001';
    END IF;
    -- 7 positional args; p_payroll_cadence and p_default_contribution_config
    -- keep their defaults (the latter defaults to '{}'::jsonb — passing NULL
    -- would store a null config instead of an empty one).
    v_created := public.create_employer(
      left(btrim(v_req.org_name), 160),
      NULLIF(left(btrim(v_req.sector), 80), ''),
      v_reg_no,
      v_name, v_phone, v_email, v_district);
  END IF;

  v_new_id := v_created ->> 'id';

  -- (b) THE SIGN-IN IDENTITY. create_* already registered it best-effort; this
  --     call is idempotent and turns the one case that must never pass silently
  --     — the identity did not get written — into a failed approval rather than
  --     an approved account nobody can sign in to.
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
$$;

REVOKE ALL     ON FUNCTION public.approve_access_request(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_access_request(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) create_employer / create_distributor — register the sign-in identity too.
--
-- Body is otherwise unchanged from the live 0093 / 0095 definitions; the only
-- edit is the PERFORM before RETURN. Best-effort on purpose: the contact phone
-- is optional on the admin "+ New" forms, so an absent or non-Ugandan number
-- must leave the create working exactly as it does today.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Length caps (§2a.8).
  IF length(btrim(p_name))                    > 160 THEN RAISE EXCEPTION 'employer name is too long (max 160)'    USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_sector,          '')) > 80   THEN RAISE EXCEPTION 'sector is too long (max 80)'            USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_registration_no, '')) > 64   THEN RAISE EXCEPTION 'registration no is too long (max 64)'   USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_name,    '')) > 120  THEN RAISE EXCEPTION 'contact name is too long (max 120)'     USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_phone,   '')) > 32   THEN RAISE EXCEPTION 'contact phone is too long (max 32)'      USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_email,   '')) > 254  THEN RAISE EXCEPTION 'contact email is too long (max 254)'     USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_payroll_cadence, '')) > 32   THEN RAISE EXCEPTION 'payroll cadence is too long (max 32)'    USING ERRCODE = 'P0001'; END IF;

  -- Format checks (only when a value is supplied).
  IF NULLIF(btrim(p_contact_phone), '') IS NOT NULL
     AND btrim(p_contact_phone) !~ '^\+?[0-9 ()-]{7,32}$' THEN
    RAISE EXCEPTION 'contact phone is not a valid phone number' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(p_contact_email), '') IS NOT NULL
     AND btrim(p_contact_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'contact email is not a valid email address' USING ERRCODE = 'P0001';
  END IF;

  -- District (when supplied) must exist (§1b.5).
  IF NULLIF(btrim(p_district), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.districts WHERE id = btrim(p_district)) THEN
    RAISE EXCEPTION 'district % does not exist', p_district USING ERRCODE = 'P0001';
  END IF;

  -- An EMPTY config stays legal: '{}' is how this function and
  -- approve_access_request provision a new employer, and it normalises to a legal
  -- 0/0 (funds no pension until the employer sets it up).
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
$$;

REVOKE ALL     ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) TO authenticated;

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

  -- Sign-in identity (0101) — best-effort, same rationale as create_employer.
  PERFORM public.register_login_identity(
    v_row.manager_phone, 'distributor', v_row.id,
    v_row.name, v_row.manager_name, v_row.manager_email);

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL     ON FUNCTION public.create_distributor(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Backfill — accounts approved while the regressed function was live.
--
-- Driven off `access_requests`, which is the only record of which phone was
-- meant to own which provisioned account. Skips anything already claimed
-- (ON CONFLICT DO NOTHING / the helper's own guard), so it is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       record;
  v_bound text;
  v_fixed int := 0;
  v_skip  int := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.kind, a.org_name, a.contact_name, a.contact_email,
           a.contact_phone, a.provisioned_id
      FROM public.access_requests a
     WHERE a.status = 'approved'
       AND a.provisioned_id IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.demo_personas dp
              WHERE dp.entity_id = a.provisioned_id
           )
     ORDER BY a.decided_at
  LOOP
    v_bound := public.register_login_identity(
      r.contact_phone,
      CASE WHEN r.kind = 'distributor' THEN 'distributor' ELSE 'employer' END,
      r.provisioned_id,
      left(btrim(r.org_name), 120),
      left(btrim(COALESCE(NULLIF(btrim(r.contact_name), ''), r.org_name)), 120),
      NULLIF(btrim(r.contact_email), '')
    );
    IF v_bound IS NULL THEN
      v_skip := v_skip + 1;
      RAISE WARNING '0101 backfill: could not bind a sign-in for % (request %, phone %) — resolve by hand.',
        r.org_name, r.id, COALESCE(NULLIF(btrim(r.contact_phone), ''), 'missing');
    ELSE
      v_fixed := v_fixed + 1;
      RAISE NOTICE '0101 backfill: % -> % now signs in as %.', r.org_name, v_bound, r.provisioned_id;
    END IF;
  END LOOP;
  RAISE NOTICE '0101 backfill complete: % repaired, % skipped.', v_fixed, v_skip;
END;
$$;

COMMIT;
