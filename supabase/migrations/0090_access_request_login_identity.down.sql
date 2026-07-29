-- 0090_access_request_login_identity.down.sql
-- Restores 0079's approve_access_request.
--
-- ⚠️ Reverting re-opens a CROSS-ACCOUNT defect, not just a validation gap:
-- without the demo_personas row this migration writes, an approved employer
-- signing in with their own phone resolves through ROLE_DEFAULTS and lands
-- inside emp-001 (the demo Nile Breweries tenant), with write access to its
-- roster; an approved distributor lands in d-001. It also restores the silent
-- NULLing of a malformed phone, which provisions accounts nobody can sign in to.
--
-- Personas/users rows already written by 0090 are intentionally left in place —
-- deleting them would break sign-in for accounts approved while it was active.

BEGIN;

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
      NULL,
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

REVOKE ALL     ON FUNCTION public.approve_access_request(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_access_request(text) TO authenticated;

DROP INDEX    IF EXISTS public.demo_personas_phone_role_key;
DROP FUNCTION IF EXISTS public.canonical_ug_phone(text);

COMMIT;
