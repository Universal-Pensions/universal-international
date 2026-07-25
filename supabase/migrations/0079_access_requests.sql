-- =============================================================================
-- Universal Pensions Uganda — 0079: access_requests (public lead-capture + admin triage)
-- =============================================================================
-- The employer / distributor "get started" path is a public request-access form
-- (those two roles are provisioned by an admin, not self-signed-up). This adds:
--
--   * access_requests — one pending row per public submission. Inserted
--     SERVER-SIDE via the service-role client (api/access-request.ts), mirroring
--     contact_submissions — so there is NO anon INSERT policy and NO anon RPC
--     (zero anon surface, matching the 0075/0078 hardening direction).
--   * list_access_requests(p_status)  — admin-only read (jsonb array, camelCase).
--   * approve_access_request(p_id)     — admin-only: provisions the real account
--     by delegating to the existing create_distributor / create_employer RPCs
--     (their in-body admin gate still passes — auth.jwt() reflects the admin
--     caller through the nested SECURITY DEFINER call), then marks the row
--     approved + stamps the provisioned entity id.
--   * deny_access_request(p_id)        — admin-only status flip.
--
-- CONVENTIONS (mirroring 0049 / 0075 / 0078):
--   * LANGUAGE plpgsql; SECURITY DEFINER; SET search_path = public, pg_temp
--   * admin gate reads (SELECT auth.jwt()) ->> 'app_role' = 'admin'  (NEVER 'role')
--   * REVOKE ALL FROM PUBLIC; explicit REVOKE EXECUTE ... FROM anon; GRANT to authenticated
--   * Idempotent (CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
--     Forward-only per BACKEND.md §7; reversed by 0079_access_requests.down.sql.
-- =============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_requests (
  id             TEXT PRIMARY KEY DEFAULT ('ar-' || replace(gen_random_uuid()::text, '-', '')),
  kind           TEXT NOT NULL CHECK (kind IN ('employer', 'distributor')),
  org_name       TEXT NOT NULL,
  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  sector         TEXT,               -- employer only
  district       TEXT,               -- employer only
  message        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'denied')),
  provisioned_id TEXT,               -- 'd-…' / 'emp-…' once approved
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS access_requests_status_idx
  ON public.access_requests (status, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Admin-only SELECT (clone of the 0049 *_select_admin idiom). No INSERT/UPDATE
-- policy: public inserts happen server-side via the service-role key (which
-- bypasses RLS), and admin mutations go through the DEFINER RPCs below.
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_requests FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_requests_select_admin ON public.access_requests;
CREATE POLICY access_requests_select_admin ON public.access_requests
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

-- ── list_access_requests(p_status) — admin-only read ─────────────────────────
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

  -- Order the aggregate by the aliased "createdAt" (the subquery renames
  -- created_at → "createdAt", so the outer ORDER BY must use the alias).
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

-- ── approve_access_request(p_id) — admin-only: provision + mark approved ──────
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

  -- Sanitize free-text lead fields so the create_* validators (length caps,
  -- phone/email regex, district-id existence) never reject an otherwise-valid
  -- request: drop a malformed phone/email; resolve the district NAME to its id.
  v_phone := CASE WHEN NULLIF(btrim(v_req.contact_phone), '') ~ '^\+?[0-9 ()-]{7,32}$'
                  THEN btrim(v_req.contact_phone) ELSE NULL END;
  v_email := CASE WHEN NULLIF(btrim(v_req.contact_email), '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                  THEN btrim(v_req.contact_email) ELSE NULL END;

  -- Provision via the canonical create RPCs (DRY — same path as the admin
  -- "+ New" forms; the nested admin gate passes because auth.jwt() reflects
  -- this admin caller).
  IF v_req.kind = 'distributor' THEN
    v_created := public.create_distributor(
      left(btrim(v_req.org_name), 120),
      NULLIF(left(btrim(v_req.contact_name), 120), ''),
      v_phone,
      v_email
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

-- ── deny_access_request(p_id) — admin-only status flip ───────────────────────
CREATE OR REPLACE FUNCTION public.deny_access_request(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := (SELECT auth.jwt()) ->> 'app_role';
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot deny access requests', v_role USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.access_requests
     SET status = 'denied', decided_at = now()
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access request % not found or already decided', p_id USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', 'denied');
END;
$$;

REVOKE ALL     ON FUNCTION public.deny_access_request(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deny_access_request(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.deny_access_request(text) TO authenticated;
