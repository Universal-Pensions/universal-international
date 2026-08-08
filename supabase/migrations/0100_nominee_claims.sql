-- =============================================================================
-- Universal Pensions Uganda — 0100: nominee claim intake (public, pre-login)
-- =============================================================================
-- WHY THIS TABLE EXISTS SEPARATELY FROM `claims`
-- Life and funeral cover pay out BECAUSE the member has died. The person making
-- the claim is therefore the nominee, and a nominee has no account, no JWT, and
-- no reason to ever have one. `claims` is keyed on subscriber_id and gated by
-- `claims_select_self` — it cannot represent a claim by someone who is not the
-- member. This is the intake register for that case; a super-admin triages a row
-- and matches it to a real member by hand.
--
-- WHY NOT AN ANON RPC
-- 0094 fixed the pre-login RPC registry at exactly three functions
-- (create_subscriber_from_signup, get_employer_invite,
-- create_subscriber_from_employer_invite) and documents that list as the closed
-- set of anon surfaces. This feature adds NONE. Any phone- or NIN-keyed anon
-- lookup against `nominees` would be a member-enumeration oracle: submit a
-- phone, learn whether that person holds a policy. Public writes therefore go
-- through the service-role key in api/nominee-claim.ts (RLS bypassed), exactly
-- as /api/contact and /api/access-request already do — 0095's header restates
-- that this is the deliberate house stance for public intake.
--
-- CONVENTIONS (CLAUDE.md §4/§5, BACKEND.md §7/§8/§9)
--   * Admin-only SELECT cloning the 0049 *_select_admin idiom, reading
--     auth.jwt() ->> 'app_role' — NEVER ->> 'role'.
--   * No INSERT/UPDATE policy: public writes are service-role, admin mutations
--     go through the DEFINER RPC below.
--   * REVOKE ALL … FROM PUBLIC before GRANT (0094: a bare REVOKE FROM anon
--     against a default PUBLIC grant is a silent no-op — it measured 7 of 20
--     functions still anon-executable after exactly that mistake).
--   * Idempotent throughout; reversed by 0100_nominee_claims.down.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nominee_claims (
  id            TEXT PRIMARY KEY
                  DEFAULT ('nc-' || replace(gen_random_uuid()::text, '-', '')),

  -- Short enough for a grieving relative to write down and read back over the
  -- phone. UNIQUE so support can key on it. Same intent as the UAG-XXXX ticket
  -- id in api/kyc/agent-referral.ts.
  reference     TEXT NOT NULL UNIQUE
                  DEFAULT ('NC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),

  -- life | funeral ONLY. Hospital cash is claimed by the member in-app and
  -- lives in `claims` (0099) — it is not a death benefit.
  product       TEXT NOT NULL CHECK (product IN ('life', 'funeral')),

  -- ── The deceased member ────────────────────────────────────────────────────
  deceased_name   TEXT NOT NULL,
  deceased_nin    TEXT,
  deceased_phone  TEXT,                    -- canonical +256XXXXXXXXX
  date_of_death   DATE NOT NULL,

  -- ── The claimant ───────────────────────────────────────────────────────────
  claimant_name   TEXT NOT NULL,
  claimant_nin    TEXT,
  claimant_phone  TEXT NOT NULL,           -- canonical; the ONLY channel we rely on
  claimant_email  TEXT,                    -- optional by design, see below
  relationship    TEXT NOT NULL,
  district        TEXT,
  notes           TEXT,

  -- ── Triage ─────────────────────────────────────────────────────────────────
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
  reviewed_by   TEXT,                      -- the admin JWT `sub`
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  -- Filled in by the admin once they identify the deceased. Nullable with
  -- ON DELETE SET NULL: an intake row must outlive a failed match, and must not
  -- vanish if the subscriber is later removed.
  matched_subscriber_id TEXT REFERENCES public.subscribers(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A widow may not know which number was the platform login, but the NIN is on
  -- the death paperwork. Ask for both, require one.
  CONSTRAINT nominee_claims_deceased_id_chk
    CHECK (deceased_nin IS NOT NULL OR deceased_phone IS NOT NULL)
);

-- NOTE on claimant_email being nullable while claimant_phone is NOT NULL: this
-- deviates from access_requests on purpose. That form is a B2B lead where email
-- is the reply channel; this one is filled in by a bereaved relative in Uganda
-- who often has no email address, and phone is the identity key everywhere else
-- in this system.

COMMENT ON TABLE public.nominee_claims IS
  'Public intake register for death benefits (life/funeral) claimed by a nominee. Written ONLY by the service role via api/nominee-claim.ts; read and triaged by admins. Not the same thing as `claims`, which is the member''s own hospital-cash claim.';

CREATE INDEX IF NOT EXISTS nominee_claims_status_idx
  ON public.nominee_claims (status, created_at DESC);
-- FK covering index (the 0009 / 0053 lesson).
CREATE INDEX IF NOT EXISTS nominee_claims_matched_subscriber_idx
  ON public.nominee_claims (matched_subscriber_id);

ALTER TABLE public.nominee_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nominee_claims FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nominee_claims_select_admin ON public.nominee_claims;
CREATE POLICY nominee_claims_select_admin ON public.nominee_claims
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

-- -----------------------------------------------------------------------------
-- list_nominee_claims(p_status) — admin-only read
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_nominee_claims(p_status text DEFAULT 'pending')
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
    RAISE EXCEPTION 'role % cannot read nominee claims', COALESCE(v_role, '(none)')
      USING ERRCODE = 'P0001';
  END IF;

  -- The subquery renames created_at → "createdAt", so the outer ORDER BY must
  -- use the alias (the list_access_requests gotcha).
  SELECT COALESCE(jsonb_agg(r ORDER BY r."createdAt" DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      id,
      reference,
      product,
      deceased_name         AS "deceasedName",
      deceased_nin          AS "deceasedNin",
      deceased_phone        AS "deceasedPhone",
      date_of_death         AS "dateOfDeath",
      claimant_name         AS "claimantName",
      claimant_nin          AS "claimantNin",
      claimant_phone        AS "claimantPhone",
      claimant_email        AS "claimantEmail",
      relationship,
      district,
      notes,
      status,
      reviewed_by           AS "reviewedBy",
      reviewed_at           AS "reviewedAt",
      review_note           AS "reviewNote",
      matched_subscriber_id AS "matchedSubscriberId",
      created_at            AS "createdAt"
    FROM public.nominee_claims
    WHERE p_status IS NULL OR p_status = 'all' OR status = p_status
  ) r;

  RETURN v_result;
END;
$$;

REVOKE ALL     ON FUNCTION public.list_nominee_claims(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_nominee_claims(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.list_nominee_claims(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- review_nominee_claim(p_id, p_status, p_note, p_subscriber_id) — admin-only
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_nominee_claim(
  p_id            text,
  p_status        text,
  p_note          text DEFAULT NULL,
  p_subscriber_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := (SELECT auth.jwt()) ->> 'app_role';
  v_who  text := (SELECT auth.jwt()) ->> 'sub';
  v_row  public.nominee_claims%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot review nominee claims', COALESCE(v_role, '(none)')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('in_review', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'unknown review status %', p_status USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_row FROM public.nominee_claims WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nominee claim % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Approved and rejected are terminal: a second decision would silently
  -- overwrite an auditable one.
  IF v_row.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'nominee claim % is already %', p_id, v_row.status
      USING ERRCODE = 'P0001';
  END IF;

  IF p_subscriber_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.subscribers WHERE id = p_subscriber_id) THEN
    RAISE EXCEPTION 'subscriber % not found', p_subscriber_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.nominee_claims
     SET status                = p_status,
         review_note           = COALESCE(p_note, review_note),
         matched_subscriber_id = COALESCE(p_subscriber_id, matched_subscriber_id),
         reviewed_by           = v_who,
         reviewed_at           = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id',                  v_row.id,
    'reference',           v_row.reference,
    'status',              v_row.status,
    'reviewNote',          v_row.review_note,
    'matchedSubscriberId', v_row.matched_subscriber_id,
    'reviewedBy',          v_row.reviewed_by,
    'reviewedAt',          v_row.reviewed_at
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.review_nominee_claim(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.review_nominee_claim(text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.review_nominee_claim(text, text, text, text) TO authenticated;
