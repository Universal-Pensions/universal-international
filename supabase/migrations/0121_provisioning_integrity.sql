-- 0121_provisioning_integrity.sql
-- P3-provisioning: remediation for audit 2026-08-23 findings A06-005, A06-011,
-- A06-012, A06-013 (docs/audits/2026-08-23/06-data-integrity.md §9).
--
-- ── A06-005 — the identity-write failure was silent, for the THIRD time ─────
-- `register_login_identity()` (0101) returns NULL and writes NOTHING when the
-- (phone, role) pair it's asked to bind is already the sign-in for a
-- DIFFERENT entity. `approve_access_request` checks that return and aborts.
-- `create_employer` / `create_distributor` called it via bare `PERFORM` and
-- ignored the result — verified live 2026-08-25, both still exactly match
-- their 0101 forward bodies. Driven end-to-end through the admin "+ New
-- Employer" door with a colliding phone, inside a rolled-back transaction,
-- the employer was created and returned as a success with ZERO
-- `demo_personas` / `users` rows, and the phone it was given still resolved
-- to the OLD employer. That owner's next sign-in lands inside a stranger's
-- tenant (ROLE_DEFAULTS: `emp-001` / `d-001`) with write access to its
-- roster, and nothing anywhere errors — this exact mechanism has now shipped
-- to production twice under different names (0079/0090, 0095/0101).
--
-- The fix distinguishes the two ways `register_login_identity` can return
-- NULL, which the caller — not the callee — is the only one who can tell
-- apart:
--   * No phone was supplied at all. Both admin doors take an OPTIONAL contact
--     phone (`CreateEmployer.jsx` has no required-field marker on it; several
--     seeded employers/distributors run with no persona by design — A06-012).
--     Unchanged: the create still succeeds with no sign-in bound.
--   * A phone WAS supplied and still came back NULL — it doesn't canonicalise
--     as a Uganda mobile, or it already signs in to someone else. This is the
--     failure this migration exists to close: the admin believes they just
--     handed the tenant to a named owner, and that belief is false. Now
--     FATAL — the whole creation rolls back rather than leaving a
--     half-bound tenant nobody discovers is broken until someone signs in.
--
-- `register_login_identity` itself and `approve_access_request` are UNCHANGED
-- — both already hold live, byte-verified against `pg_get_functiondef`
-- against their 0101 forward bodies. Touching them is out of scope and would
-- violate this migration's own write-set discipline.
--
-- ── A06-011 — the one employer the live approval path actually produced ────
-- `emp-80511f65be7a4656b2bd45b6fad18625` ("Uniclusion Uganda") is the ONLY
-- employer ever created through the live `approve_access_request` ->
-- `create_employer` chain. It diverges from every other employer three ways
-- at once, all traceable to `create_employer`'s own defaults/validation:
--
--   1. `district = 'd-budaka'` — the raw `districts.id`, not a name. Every
--      other employer (seeded directly, not via this RPC) holds a NAME
--      ("Kampala", "Gulu", ...), and every UI site that renders `.district`
--      treats it as literal display text (ViewEmployers.jsx,
--      EmployersMobile.jsx, EmployerDetailMobile.jsx, ProfileMobile.jsx,
--      settingsTabs.jsx — none of them resolve an id to a name). The admin
--      map's geo rollup is explicit about the contract:
--      `src/data/employerGeoSeed.js:12` — "`district` MUST equal a real
--      `districts.name` (the geo rollup joins on name)." `create_employer`
--      validated `p_district` against `districts.id` and then stored that
--      SAME id verbatim — the id/name mismatch is the bug. `d-budaka` would
--      render literally on every employer/admin screen that shows district.
--   2. `default_contribution_config = '{}'` — no `employeePct` / `employerPct`
--      at all, so the funding-setup screen has nothing to show and any
--      contribution run for this employer computes zero legs.
--      `_assert_contribution_config_shape` only validates keys that are
--      PRESENT, so `{}` sails through with zero complaints (confirmed live:
--      0/8 employers fail the shape check).
--   3. `payroll_cadence = NULL` — every other employer is `'monthly'`.
--
-- Neither admin door (`approve_access_request`, and `CreateEmployer.jsx` via
-- `services/employer.js:createEmployer`) ever passes
-- `p_payroll_cadence` / `p_default_contribution_config` — both omit those two
-- positional args entirely and always ran on the RPC's own bare SQL defaults
-- (`NULL` / `'{}'::jsonb`). Verified live: the 6 non-flagship seeded
-- employers (emp-002..emp-007, inserted directly by the seed script, not
-- this RPC) all carry the IDENTICAL
-- `{"employeePct":10,"employerPct":5,"insuranceEnabled":false}` /
-- `'monthly'` pair. That pair — not `{}` / `NULL` — is the platform's actual
-- "employer not yet configured" starting point; this migration makes the RPC
-- default to it too, and repairs the one live row that was provisioned
-- before the fix.
--
-- `_assert_contribution_config_shape` is also tightened: a config with
-- EXACTLY ONE of `employeePct` / `employerPct` present is now rejected. This
-- was already the intended contract — `settingsTabs.jsx:215` (the employer's
-- own Pension/Insurance settings tab, the only other caller of this
-- validator via `update_employer_profile`) documents "Both pension keys are
-- always written — one flat shape, ... per the migration 0093 DB contract" —
-- the validator just never enforced it. A fully-empty `{}` (both keys
-- absent) stays legal, matching that same file's "0/0 is a LEGAL
-- configuration" comment, and matching `create_employer`'s own explicit
-- support for an unconfigured employer.
--
-- ── A06-012 — six employers and one distributor have no sign-in path ───────
-- Every seeded employer/distributor has a real contact phone in its own
-- table, but only 2 of 8 employers and 1 of 2 non-flagship distributors have
-- a matching `demo_personas` row (verified live 2026-08-25 — the numbers in
-- the audit report have already moved as other remediation agents work this
-- same database, which is exactly why this migration re-queries rather than
-- trusting the report). Backfilled the same way 0101 backfilled
-- `access_requests` — via `register_login_identity()`, idempotent, so
-- re-running this migration is a no-op for anything already bound.
--
-- ── A06-013 — 39-of-54 `users` rows carry no `entity_id` ────────────────────
-- `api/auth/verify-otp.ts` upserts a `users(phone, role)` row on EVERY OTP
-- sign-in attempt with no `entity_id`. Neither subscriber logins (resolved
-- via `subscribers.phone`) nor non-subscriber logins (resolved via
-- `demo_personas`) ever read `users.entity_id`, so these rows are inert
-- breadcrumbs, not broken provisioning — pruned here as a one-time cleanup.
-- The API route that writes them is outside this migration's write-set, so
-- fresh breadcrumbs will keep accumulating; see the escalation note in the
-- P3-provisioning report.
--
-- ⚠️ Consequence of the A06-005 fix: an admin "+ New Employer" / "+ New
-- Distributor" submission with a phone that collides with an existing
-- sign-in of that role now FAILS instead of silently succeeding. That is the
-- point — see the repro above — but it does mean an admin who mistypes a
-- phone now gets a hard error where before they got a false "success".

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) create_employer
--    A06-005: fatal identity-write check when a contact phone IS supplied.
--    A06-011: district normalised to districts.name; sane payroll_cadence /
--             default_contribution_config defaults when the caller omits them.
--
--    Everything else is byte-identical to the live body (captured via
--    `pg_get_functiondef` immediately before writing this migration, matching
--    the 0101 forward definition) — validation order, length caps, format
--    checks, and the admin-only / name-required guards are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_employer(
  p_name                       text,
  p_sector                     text  DEFAULT NULL,
  p_registration_no            text  DEFAULT NULL,
  p_contact_name               text  DEFAULT NULL,
  p_contact_phone              text  DEFAULT NULL,
  p_contact_email              text  DEFAULT NULL,
  p_district                   text  DEFAULT NULL,
  p_payroll_cadence            text  DEFAULT 'monthly',
  p_default_contribution_config jsonb DEFAULT '{"employeePct":10,"employerPct":5,"insuranceEnabled":false}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role          text  := (SELECT auth.jwt()) ->> 'app_role';
  v_config        jsonb := COALESCE(p_default_contribution_config, '{"employeePct":10,"employerPct":5,"insuranceEnabled":false}'::jsonb);
  v_district_name text;
  v_bound         text;
  v_id            text;
  v_row           public.employers%ROWTYPE;
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

  -- District (when supplied) must resolve to a known Uganda district, by
  -- EITHER its `districts.id` (what `approve_access_request` passes — it
  -- resolves the requester's typed name to an id first) OR its
  -- `districts.name` (what the admin "+ New Employer" free-text field
  -- actually collects, per its own placeholder). Whichever form arrives, we
  -- ALWAYS store the NAME (A06-011) — that is the column's real contract
  -- everywhere else in this codebase.
  IF NULLIF(btrim(p_district), '') IS NOT NULL THEN
    SELECT name INTO v_district_name
      FROM public.districts
     WHERE id = btrim(p_district) OR lower(name) = lower(btrim(p_district))
     LIMIT 1;
    IF v_district_name IS NULL THEN
      RAISE EXCEPTION 'district % does not exist', p_district USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- An EMPTY config stays legal — `_assert_contribution_config_shape` still
  -- accepts `{}` (a deliberately-passed one), it just isn't the DEFAULT
  -- anymore (A06-011): the SQL defaults above mean a caller that omits both
  -- trailing args — every current caller — lands on the same starting point
  -- every other non-flagship employer already has, instead of a blank
  -- funding screen and zero-leg contribution runs.
  PERFORM public._assert_contribution_config_shape(v_config);

  v_id := 'emp-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.employers (
    id, name, sector, registration_no, contact_name, contact_phone,
    contact_email, district, payroll_cadence, default_contribution_config
  ) VALUES (
    v_id, btrim(p_name),
    NULLIF(btrim(p_sector), ''), NULLIF(btrim(p_registration_no), ''),
    NULLIF(btrim(p_contact_name), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_contact_email), ''), v_district_name,
    COALESCE(NULLIF(btrim(p_payroll_cadence), ''), 'monthly'), v_config
  )
  RETURNING * INTO v_row;

  -- Sign-in identity (0101 / A06-005). The contact phone is an OPTIONAL field
  -- on this form: an ABSENT phone leaves the employer provisioned with no
  -- sign-in bound yet, unchanged from today (A06-012 — several seeded
  -- employers deliberately run this way).
  --
  -- A SUPPLIED phone that `register_login_identity` still can't bind — not a
  -- valid Uganda mobile, or already another employer's/distributor's sign-in
  -- — is different: the admin believes they just handed this tenant to a
  -- named owner. That owner would instead land inside a DIFFERENT tenant on
  -- next sign-in (ROLE_DEFAULTS) with write access to its roster. A
  -- half-bound tenant is worse than no tenant, so this is now FATAL and
  -- rolls back the entire creation (A06-005).
  IF NULLIF(btrim(v_row.contact_phone), '') IS NOT NULL THEN
    v_bound := public.register_login_identity(
      v_row.contact_phone, 'employer', v_row.id,
      v_row.name, v_row.contact_name, v_row.contact_email);
    IF v_bound IS NULL THEN
      RAISE EXCEPTION
        'Cannot create %: phone % could not be registered as its sign-in — it is not a valid Uganda mobile, or it already signs in to a different employer.',
        v_row.name, v_row.contact_phone
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL     ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) create_distributor
--    A06-005: fatal identity-write check when a manager phone IS supplied.
--    Distributors have no district / contribution-config / cadence columns,
--    so A06-011 does not apply here. Everything else is byte-identical to the
--    live body (captured via `pg_get_functiondef`, matching 0101).
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_role  text := (SELECT auth.jwt()) ->> 'app_role';
  v_bound text;
  v_id    text;
  v_row   public.distributors%ROWTYPE;
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

  -- Sign-in identity (0101 / A06-005) — same fatal-on-supplied-phone rule as
  -- create_employer above; see that function's comment for the full rationale.
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
$$;

REVOKE ALL     ON FUNCTION public.create_distributor(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_distributor(text, text, text, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) _assert_contribution_config_shape
--    A06-011: employeePct / employerPct must now travel together — both
--    present, or both absent. A config with exactly one of them is rejected;
--    it would let a contribution run compute one leg and silently treat the
--    missing side as zero. `{}` (both absent) stays legal — an employer with
--    no funding configured yet is still a valid state (create_employer's own
--    comment above, and settingsTabs.jsx's "0/0 is a LEGAL configuration").
--    Per-key type/range checks are otherwise byte-identical to the live body.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_contribution_config_shape(p_config jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key   text;
  v_has_ee boolean;
  v_has_er boolean;
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

  -- A06-011: half-specified funding is worse than none.
  v_has_ee := (p_config -> 'employeePct') IS NOT NULL AND jsonb_typeof(p_config -> 'employeePct') <> 'null';
  v_has_er := (p_config -> 'employerPct') IS NOT NULL AND jsonb_typeof(p_config -> 'employerPct') <> 'null';
  IF v_has_ee IS DISTINCT FROM v_has_er THEN
    RAISE EXCEPTION 'employeePct and employerPct must both be set, or both omitted (got % without %)',
      CASE WHEN v_has_ee THEN 'employeePct' ELSE 'employerPct' END,
      CASE WHEN v_has_ee THEN 'employerPct' ELSE 'employeePct' END
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) A06-011 data repair — the live employer row(s) provisioned before this
--    fix. Each UPDATE is guarded to only touch rows still in the broken
--    state, so re-running this migration is a no-op once repaired. Targets
--    the PATTERN (district holding a districts.id; an empty config; a NULL
--    cadence), not today's specific row id, so it also repairs any other row
--    provisioned the same way between the audit and this migration landing.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.employers e
   SET district = d.name
  FROM public.districts d
 WHERE e.district = d.id;

UPDATE public.employers
   SET default_contribution_config = '{"employeePct":10,"employerPct":5,"insuranceEnabled":false}'::jsonb
 WHERE default_contribution_config = '{}'::jsonb;

UPDATE public.employers
   SET payroll_cadence = 'monthly'
 WHERE payroll_cadence IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) A06-012 — backfill a sign-in for every employer/distributor that has a
--    usable contact phone but no `demo_personas` row yet. Uses the same
--    `register_login_identity()` helper 0101 backfilled `access_requests`
--    with — idempotent (ON CONFLICT DO NOTHING inside it), never repoints an
--    existing binding, safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       record;
  v_bound text;
  v_fixed int := 0;
  v_skip  int := 0;
BEGIN
  FOR r IN
    SELECT 'employer' AS kind, e.id, e.name,
           e.contact_phone AS phone, e.contact_name AS person_name, e.contact_email AS email
      FROM public.employers e
     WHERE NOT EXISTS (
             SELECT 1 FROM public.demo_personas p
              WHERE p.role = 'employer' AND p.entity_id = e.id
           )
    UNION ALL
    SELECT 'distributor' AS kind, d.id, d.name,
           d.manager_phone AS phone, d.manager_name AS person_name, d.manager_email AS email
      FROM public.distributors d
     WHERE NOT EXISTS (
             SELECT 1 FROM public.demo_personas p
              WHERE p.role = 'distributor' AND p.entity_id = d.id
           )
  LOOP
    v_bound := public.register_login_identity(
      r.phone, r.kind, r.id, left(btrim(r.name), 120),
      left(btrim(COALESCE(NULLIF(btrim(r.person_name), ''), r.name)), 120),
      NULLIF(btrim(r.email), '')
    );
    IF v_bound IS NULL THEN
      v_skip := v_skip + 1;
      RAISE WARNING '0121 A06-012 backfill: could not bind a sign-in for % % (%, phone %) — resolve by hand.',
        r.kind, r.name, r.id, COALESCE(NULLIF(btrim(r.phone), ''), 'missing');
    ELSE
      v_fixed := v_fixed + 1;
      RAISE NOTICE '0121 A06-012 backfill: % % -> % now signs in as %.', r.kind, r.name, v_bound, r.id;
    END IF;
  END LOOP;
  RAISE NOTICE '0121 A06-012 backfill complete: % repaired, % skipped.', v_fixed, v_skip;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) A06-013 — prune inert `users` login breadcrumbs: rows with no
--    `entity_id` AND no `password_hash`. `api/auth/verify-otp.ts` upserts a
--    `users(phone, role)` row on every OTP sign-in with no entity_id; neither
--    subscriber logins (resolved via `subscribers.phone`) nor non-subscriber
--    logins (resolved via `demo_personas`) ever read `users.entity_id`, so
--    these are pure noise, not broken provisioning. The `password_hash IS
--    NULL` guard is what distinguishes a breadcrumb from a real
--    password-bearing identity that happens to carry no entity_id (verified
--    live 2026-08-25: the pinned demo admin row and one subscriber row both
--    carry a password_hash with a NULL entity_id — this DELETE's WHERE
--    clause excludes both by construction).
--
--    This is a one-time cleanup, not a fix at the source: verify-otp.ts is
--    outside this migration's write-set, so fresh breadcrumbs will keep
--    accumulating. See the P3-provisioning report's escalations.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.users WHERE entity_id IS NULL AND password_hash IS NULL;

COMMIT;
