-- 0090_access_request_login_identity.sql
-- Make an approved employer/distributor able to sign in AS ITSELF.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
-- `approve_access_request` (0079) provisions the account via create_employer /
-- create_distributor — and stops there. Neither of those writes a `users` row
-- or a `demo_personas` row.
--
-- But sign-in resolves a non-subscriber identity ONLY through
-- `demo_personas(phone, role) -> entity_id` (api/auth/_lib/personas.ts), and on
-- a miss it falls back to `ROLE_DEFAULTS` — `emp-001` for employer, `d-001` for
-- distributor. So today every approved employer who signs in lands inside the
-- demo Nile Breweries tenant, with write access to its roster and contribution
-- runs; every approved distributor lands in d-001. Silently. The approval looks
-- like it worked.
--
-- Worse, 0079 SILENTLY NULLED a phone that failed its regex and provisioned
-- anyway, producing an account with no sign-in key at all.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
-- (a) FAIL LOUD on a phone/email/district we cannot use, instead of discarding
--     it and provisioning something unusable.
-- (b) After provisioning, write the `demo_personas` row (the actual sign-in key)
--     and a `users` row, both keyed on the CANONICAL phone so they match what
--     `verify-otp` computes at login.
--
-- ⚠️ OPERATIONAL NOTE: after this migration, an existing PENDING request whose
-- phone/email/district is missing or malformed becomes un-approvable, and there
-- is no edit-request screen in the admin UI. Check `access_requests` where
-- status='pending' before applying and re-contact those requesters, or deny and
-- ask them to resubmit through the (now-validating) form.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) canonical_ug_phone — mirrors src/utils/phone.js and api/_lib/phone.ts
--    (strip non-digits, drop a leading 256 or 0, require 9 digits with a known
--    carrier prefix) so the stored value is byte-identical to the one the auth
--    layer derives at sign-in. If these ever drift, approved accounts silently
--    stop matching their persona row — keep the prefix list in sync.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.canonical_ug_phone(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN x.local ~ '^(70|71|74|75|76|77|78)[0-9]{7}$' THEN '+256' || x.local
           ELSE NULL
         END
  FROM (
    SELECT left(
      CASE WHEN d.digits LIKE '256%' THEN substr(d.digits, 4)
           WHEN d.digits LIKE '0%'   THEN substr(d.digits, 2)
           ELSE d.digits END, 9) AS local
    FROM (SELECT regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g') AS digits) d
  ) x;
$$;

REVOKE ALL     ON FUNCTION public.canonical_ug_phone(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.canonical_ug_phone(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) One persona per (phone, role) — so two approvals cannot both claim the
--    same sign-in, which would make the login non-deterministic.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS demo_personas_phone_role_key
  ON public.demo_personas (phone, role);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) approve_access_request — provision AND register the sign-in identity.
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
  v_persona  text;
  v_name     text;
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

  -- (a) Fail loud. The phone IS the sign-in key.
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

  v_name := left(btrim(COALESCE(NULLIF(btrim(v_req.contact_name), ''), v_req.org_name)), 120);

  IF v_req.kind = 'distributor' THEN
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120), v_name, v_phone, v_email, 'ug');
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
    -- 7 positional args; p_payroll_cadence and p_default_contribution_config
    -- keep their defaults (the latter defaults to '{}'::jsonb — passing NULL
    -- would store a null config instead of an empty one).
    v_created := public.create_employer(
      left(btrim(v_req.org_name), 160),
      NULLIF(left(btrim(v_req.sector), 80), ''),
      NULL,
      v_name, v_phone, v_email, v_district);
  END IF;

  v_new_id := v_created ->> 'id';

  -- (b) THE SIGN-IN IDENTITY. Without this row, verify-otp -> resolveDemoPersona
  --     misses and ROLE_DEFAULTS drops the new account's owner into emp-001/d-001.
  INSERT INTO public.demo_personas (id, phone, role, entity_id, label)
  VALUES ('dp-' || replace(gen_random_uuid()::text, '-', ''),
          v_phone, v_persona, v_new_id, left(btrim(v_req.org_name), 120));

  -- `users` row so a password can later be set and last_login tracked. The id
  -- shape matches api/auth/verify-otp.ts's deterministic `${role}:${phone}` so
  -- the first OTP sign-in upserts idempotently instead of colliding.
  INSERT INTO public.users (id, phone, role, name, email, entity_id)
  VALUES (v_persona || ':' || v_phone, v_phone, v_persona, v_name, v_email, v_new_id)
  ON CONFLICT (phone, role) DO UPDATE SET entity_id = EXCLUDED.entity_id;

  UPDATE public.access_requests
     SET status = 'approved', provisioned_id = v_new_id, decided_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'approved', 'provisionedId', v_new_id);
END;
$$;

REVOKE ALL     ON FUNCTION public.approve_access_request(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_access_request(text) TO authenticated;

COMMIT;
