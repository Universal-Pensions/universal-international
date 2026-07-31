-- =============================================================================
-- Universal Pensions Uganda — 0093: percent-only employer contribution config
-- =============================================================================
-- WHAT CHANGES. 0092 gave each of the two pension legs a BASIS: a leg was either
-- a percentage of the member's monthly compensation, or a flat UGX amount per
-- member per month. The flat basis is removed here. A leg is now always a
-- percentage, so `employers.default_contribution_config` carries exactly two
-- pension numbers:
--
--     { employeePct, employerPct,                      -- pension (this file)
--       insuranceEnabled, groupCoverAmount,            -- group insurance,
--       groupInsuranceProducts }                       --   untouched by 0093
--
-- WHY. The employer settings screen had to ask "flat amount or share of pay?"
-- before it could ask for the figure — four extra controls and two conditional
-- fields for a choice nobody used. No employer has ever stored a flat amount, on
-- this database or in any seed. Removing the basis lets the screen ask the
-- question employers actually answer ("who contributes?") and then take one
-- number per participating side.
--
-- MONEY DOES NOT MOVE. Every live row normalises to the same two percentages
-- before and after. The backfill in step (1) is a pure re-shaping.
--
-- ⚠️ PARITY OBLIGATION. `_normalize_contribution_config` and the leg math in
-- `submit_employer_contribution_run` are the SQL twins of
-- `normalizeContributionConfig` / `deriveContributionLegs` in
-- src/utils/contributionModel.js. They must change in the same commit or the
-- offline mock path, the seeded ledger, the run-wizard preview and the live RPC
-- diverge.
--
-- Forward-only; reversible via 0093_percent_only_contribution_config.down.sql.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (1) Guard, then backfill every employer row to the percent-only shape
-- -----------------------------------------------------------------------------
-- THE GUARD RUNS FIRST AND RAISES. A flat UGX amount cannot be re-expressed as a
-- percentage without knowing each member's pay, so there is no honest automatic
-- conversion. If such a row ever exists, this migration must stop and force a
-- human decision rather than silently rewriting somebody's funding to 0.
--
-- Verified zero matches on the Singapore database before writing this: all seven
-- employers carry {mode:'co-contribution', employeePct:10, employerMatchPct:50}.
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.employers e
   WHERE jsonb_typeof(e.default_contribution_config) = 'object'
     AND (
           -- unified shape with an explicit fixed basis funding real money
           (e.default_contribution_config ->> 'employeeBasis' = 'fixed'
            AND COALESCE(NULLIF(e.default_contribution_config ->> 'employeeAmount', '')::numeric, 0) > 0)
        OR (e.default_contribution_config ->> 'employerBasis' = 'fixed'
            AND COALESCE(NULLIF(e.default_contribution_config ->> 'employerAmount', '')::numeric, 0) > 0)
           -- pre-0092 employer-only, whose basis was implied by the amount key
        OR (e.default_contribution_config ->> 'mode' = 'employer-only'
            AND COALESCE(NULLIF(e.default_contribution_config ->> 'employerAmount', '')::numeric, 0) > 0)
         );

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '0093: % employer(s) fund a flat UGX amount. A flat amount cannot be converted to a percentage without each member''s pay — decide a percentage for those employers and re-run.', v_bad
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Backfill. Runs BEFORE the helper is replaced, so it uses the 0092 normaliser —
-- the one that still understands the legacy `mode` shapes — to compute the two
-- percentages, then strips every key the model no longer has. The three
-- group-insurance keys and anything else on the row survive untouched, because
-- this rebuilds by SUBTRACTING known-dead keys rather than by constructing a new
-- object from scratch.
UPDATE public.employers e
   SET default_contribution_config =
         (
           e.default_contribution_config
             - 'mode'            - 'employerMatchPct' - 'matchPct'
             - 'employeeBasis'   - 'employerBasis'
             - 'employeeAmount'  - 'employerAmount'
             - 'maxContribution'
         )
         || jsonb_build_object(
              'employeePct', trim_scale(COALESCE(
                (public._normalize_contribution_config(e.default_contribution_config) ->> 'employeePct')::numeric, 0)),
              'employerPct', trim_scale(COALESCE(
                (public._normalize_contribution_config(e.default_contribution_config) ->> 'employerPct')::numeric, 0))
            ),
       updated_at = now()
 WHERE jsonb_typeof(e.default_contribution_config) = 'object'
   AND jsonb_exists_any(
         e.default_contribution_config,
         ARRAY['mode', 'employerMatchPct', 'matchPct', 'employeeBasis',
               'employerBasis', 'employeeAmount', 'employerAmount', 'maxContribution']
       );

-- An employer provisioned with '{}' (create_employer / approve_access_request)
-- is deliberately left alone: it has no dead keys, and it normalises to a legal
-- 0/0 meaning "no contributions set up yet".


-- -----------------------------------------------------------------------------
-- (2) _normalize_contribution_config — two keys out, not six
-- -----------------------------------------------------------------------------
-- SQL twin of normalizeContributionConfig. Both sides now handle exactly two
-- input shapes: the current one, and a pre-0092 `mode:'co-contribution'` row
-- whose employer leg was a percentage OF THE EMPLOYEE LEG.
--
-- ⚠️ BRANCH ORDER IS LOAD-BEARING: `mode` is tested BEFORE the plain read,
-- exactly as the JS does. A pre-0092 row can carry an `employerPct` left over
-- from an earlier shape; reading it instead of converting the match would zero
-- the employer leg with no error.
--
-- The pre-0092 `mode:'employer-only'` shape is deliberately NOT handled. Its
-- distinguishing feature was a flat `employerAmount`, which no longer exists —
-- such a row falls through to the plain read below, which is precisely what the
-- JS does. Step (1) removed every `mode` on this database, so both branches are
-- now restore-from-backup insurance only.
CREATE OR REPLACE FUNCTION public._normalize_contribution_config(p_config jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (
    -- A non-object config (NULL, a scalar, an array) funds nothing rather than
    -- raising: a malformed row must never be able to abort a whole payroll run.
    SELECT CASE
             WHEN jsonb_typeof(COALESCE(p_config, '{}'::jsonb)) = 'object'
               THEN COALESCE(p_config, '{}'::jsonb)
             ELSE '{}'::jsonb
           END AS c
  )
  SELECT CASE
    -- Legacy co-contribution — % of the employee leg becomes % of pay.
    WHEN c ->> 'mode' = 'co-contribution' THEN jsonb_build_object(
      'employeePct', COALESCE(NULLIF(c ->> 'employeePct', '')::numeric, 0),
      -- trim_scale so the division yields 5, not 5.0000000000000000 — JS produces
      -- the short form and this value is echoed to the member by
      -- get_my_employer_funding.
      'employerPct', trim_scale(
                       COALESCE(NULLIF(c ->> 'employeePct', '')::numeric, 0)
                       * COALESCE(
                           NULLIF(c ->> 'employerMatchPct', '')::numeric,
                           NULLIF(c ->> 'matchPct',         '')::numeric,
                           0
                         ) / 100
                     )
    )

    -- Current shape, and everything else. An empty / unrecognised config funds
    -- nothing. Empty-string values read as 0 rather than raising a 22P02.
    ELSE jsonb_build_object(
      'employeePct', COALESCE(NULLIF(c ->> 'employeePct', '')::numeric, 0),
      'employerPct', COALESCE(NULLIF(c ->> 'employerPct', '')::numeric, 0)
    )
  END
  FROM cfg;
$$;

-- Internal leaf helper — its callers are all SECURITY DEFINER, so they execute it
-- as the owner regardless of the caller's grants. No GRANT, matching the stance
-- on _insert_subscriber_chain / _validate_signup_payload.
REVOKE ALL ON FUNCTION public._normalize_contribution_config(jsonb) FROM PUBLIC, anon;

COMMENT ON FUNCTION public._normalize_contribution_config(jsonb) IS
  'Canonicalise employers.default_contribution_config into the two pension '
  'percentages (employeePct, employerPct). SQL twin of normalizeContributionConfig '
  'in src/utils/contributionModel.js — keep in lockstep.';


-- -----------------------------------------------------------------------------
-- (3) submit_employer_contribution_run — both legs are percentages
-- -----------------------------------------------------------------------------
-- Only the config read and the two leg expressions change. Unchanged: the nonce
-- replay guard, the FOR UPDATE row lock, the retirement/emergency split by
-- ret_pct (default 80), the three INSERTs (employee source='own' stamped
-- 'Payroll deduction', employer source='employer', insurance
-- type='insurance_premium' with NULL splits), the insurance leg via
-- group_insurance_premium_per_member, members_funded counting DISTINCT funded
-- members, the skipped[] entries, and the returned jsonb keys.
--
-- CREATE OR REPLACE preserves the ACL set by 0053_schema_hygiene.sql:749-750.
CREATE OR REPLACE FUNCTION public.submit_employer_contribution_run(p_period_label text DEFAULT NULL::text, p_method text DEFAULT NULL::text, p_nonce text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role             text := (SELECT auth.jwt()) ->> 'app_role';
  v_employer_id      text := (SELECT auth.jwt()) ->> 'employerId';
  v_config           jsonb;
  v_norm             jsonb;
  v_employee_pct     numeric;
  v_employer_pct     numeric;
  v_insurance_leg    numeric;
  v_sub              record;
  v_comp             numeric;
  v_ret_pct          numeric;
  v_employee_leg     numeric;
  v_employer_leg     numeric;
  v_retirement       numeric;
  v_emergency        numeric;
  v_funded           boolean;
  v_run_id           text;
  v_tx_ref           text;
  v_members_funded   integer := 0;
  v_employee_total   numeric := 0;
  v_employer_total   numeric := 0;
  v_insurance_total  numeric := 0;
  v_skipped          jsonb := '[]'::jsonb;
  v_prior            jsonb;
  v_result           jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'employer' THEN
    RAISE EXCEPTION 'role % cannot submit a contribution run', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RAISE EXCEPTION 'missing employerId claim' USING ERRCODE = 'P0001';
  END IF;

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.contribution_run_uploads WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  SELECT default_contribution_config INTO v_config FROM public.employers WHERE id = v_employer_id;
  v_config := COALESCE(v_config, '{}'::jsonb);

  -- Canonicalise the PENSION legs. `v_config` stays RAW below because the
  -- group-insurance keys are read straight off it, unchanged.
  v_norm := public._normalize_contribution_config(v_config);

  -- The COALESCEs are belt-and-braces: the helper already guarantees non-NULL.
  v_employee_pct := COALESCE(NULLIF(v_norm ->> 'employeePct', '')::numeric, 0);
  v_employer_pct := COALESCE(NULLIF(v_norm ->> 'employerPct', '')::numeric, 0);

  -- Employer-funded group insurance premium per covered member = Σ products.
  v_insurance_leg := public.group_insurance_premium_per_member(v_config);

  v_run_id := 'run-' || replace(gen_random_uuid()::text, '-', '');
  v_tx_ref := 'EMP-' || substr(v_run_id, 5, 8);
  INSERT INTO public.contribution_runs (
    id, employer_id, period_label, status, employer_total, employee_total, insurance_total, grand_total, run_at
  ) VALUES (
    v_run_id, v_employer_id, p_period_label, 'completed', 0, 0, 0, 0, now()
  );

  FOR v_sub IN
    SELECT s.id,
           COALESCE(s.compensation, 0)        AS compensation,
           COALESCE(cs.retirement_pct, 80)    AS ret_pct
      FROM public.subscribers s
      LEFT JOIN public.contribution_schedules cs ON cs.subscriber_id = s.id
     WHERE s.employer_id = v_employer_id
       AND s.is_active
     FOR UPDATE OF s
  LOOP
    v_comp := v_sub.compensation;

    -- THE canonical math. Each leg is derived INDEPENDENTLY from compensation and
    -- rounded once. The employer leg never references the employee leg — that was
    -- the old match basis and it is gone.
    v_employee_leg := round(v_comp * v_employee_pct / 100);
    v_employer_leg := round(v_comp * v_employer_pct / 100);

    -- Nothing to post for this member: normally a deliberate 0/0 configuration
    -- (legal and saveable — the employer funds no pension yet), or a member on
    -- zero recorded compensation. Reported so the run summary can say who was
    -- left out, NOT flagged as a misconfiguration.
    IF COALESCE(v_employee_leg, 0) <= 0 AND COALESCE(v_employer_leg, 0) <= 0 AND COALESCE(v_insurance_leg, 0) <= 0 THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('subscriberId', v_sub.id, 'reason', 'zero_contribution')
      );
      CONTINUE;
    END IF;

    v_ret_pct := v_sub.ret_pct;
    IF v_ret_pct IS NULL OR v_ret_pct < 0 OR v_ret_pct > 100 THEN
      v_ret_pct := 80;
    END IF;

    v_funded := false;

    IF COALESCE(v_employee_leg, 0) > 0 THEN
      v_retirement := round(v_employee_leg * v_ret_pct / 100);
      v_emergency  := v_employee_leg - v_retirement;
      -- METHOD: the employee leg is stamped 'Payroll deduction', NOT p_method.
      -- p_method describes how the EMPLOYER moved money to the platform (Bank
      -- transfer / MTN / Airtel). Stamping it on this leg makes the member's own
      -- activity feed read "UGX 140,000 added to your savings via MTN Mobile
      -- Money" — as though the member paid it themselves, when in fact their
      -- employer deducted it from their pay and remitted it. The employer and
      -- insurance legs below DO carry p_method, because those really are the
      -- employer's transfer. Parity: src/data/employerSeed.js and
      -- src/services/employer.js::_mockSubmitEmployerRun do the same.
      INSERT INTO public.transactions (
        id, subscriber_id, agent_id, type, amount, date, status, method,
        txn_ref, split_retirement, split_emergency, source, contribution_run_id
      ) VALUES (
        't-' || replace(gen_random_uuid()::text, '-', ''), v_sub.id, NULL, 'contribution',
        v_employee_leg, now(), 'settled', 'Payroll deduction', v_tx_ref, v_retirement, v_emergency, 'own', v_run_id
      );
      v_employee_total := v_employee_total + v_employee_leg;
      v_funded := true;
    END IF;

    IF COALESCE(v_employer_leg, 0) > 0 THEN
      v_retirement := round(v_employer_leg * v_ret_pct / 100);
      v_emergency  := v_employer_leg - v_retirement;
      INSERT INTO public.transactions (
        id, subscriber_id, agent_id, type, amount, date, status, method,
        txn_ref, split_retirement, split_emergency, source, contribution_run_id
      ) VALUES (
        't-' || replace(gen_random_uuid()::text, '-', ''), v_sub.id, NULL, 'contribution',
        v_employer_leg, now(), 'settled', p_method, v_tx_ref, v_retirement, v_emergency, 'employer', v_run_id
      );
      v_employer_total := v_employer_total + v_employer_leg;
      v_funded := true;
    END IF;

    IF COALESCE(v_insurance_leg, 0) > 0 THEN
      INSERT INTO public.transactions (
        id, subscriber_id, agent_id, type, amount, date, status, method,
        txn_ref, split_retirement, split_emergency, source, contribution_run_id
      ) VALUES (
        't-' || replace(gen_random_uuid()::text, '-', ''), v_sub.id, NULL, 'insurance_premium',
        v_insurance_leg, now(), 'settled', p_method, v_tx_ref, NULL, NULL, 'employer', v_run_id
      );
      v_insurance_total := v_insurance_total + v_insurance_leg;
      v_funded := true;
    END IF;

    IF v_funded THEN
      v_members_funded := v_members_funded + 1;
    END IF;
  END LOOP;

  IF v_members_funded > 0 THEN
    UPDATE public.contribution_runs
       SET employer_total  = v_employer_total,
           employee_total  = v_employee_total,
           insurance_total = v_insurance_total,
           grand_total     = v_employer_total + v_employee_total + v_insurance_total
     WHERE id = v_run_id;
  ELSE
    DELETE FROM public.contribution_runs WHERE id = v_run_id;
    v_run_id := NULL;
  END IF;

  v_result := jsonb_build_object(
    'runId',         v_run_id,
    'linesCreated',  v_members_funded,
    'employerTotal', v_employer_total,
    'employeeTotal', v_employee_total,
    'insuranceTotal', v_insurance_total,
    'grandTotal',    v_employer_total + v_employee_total + v_insurance_total,
    'skipped',       v_skipped
  );

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    INSERT INTO public.contribution_run_uploads (nonce, result)
    VALUES (p_nonce, v_result)
    ON CONFLICT (nonce) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$function$;


-- -----------------------------------------------------------------------------
-- (4) get_my_employer_funding — the member-facing read narrows to two keys
-- -----------------------------------------------------------------------------
-- Same scope guard, same "return jsonb null when not employer-sponsored"
-- contract, same reason for existing (a subscriber SELECT policy on
-- public.employers would expose contact details and the registration number to
-- every member). Only the returned pension keys change.
CREATE OR REPLACE FUNCTION public.get_my_employer_funding()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        text := (SELECT auth.jwt()) ->> 'app_role';
  v_sub_id      text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_employer_id text;
  v_comp        numeric;
  v_name        text;
  v_config      jsonb;
  v_norm        jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot read employer funding', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_sub_id IS NULL OR v_sub_id = '' THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;

  -- The subscriber is derived from the VERIFIED claim — never from an argument.
  SELECT s.employer_id, COALESCE(s.compensation, 0)
    INTO v_employer_id, v_comp
    FROM public.subscribers s
   WHERE s.id = v_sub_id;

  -- Self-funded saver (the overwhelming majority — the agent→subscriber tree) or
  -- a claim pointing at a row that no longer exists. Not an error.
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RETURN 'null'::jsonb;
  END IF;

  SELECT e.name, COALESCE(e.default_contribution_config, '{}'::jsonb)
    INTO v_name, v_config
    FROM public.employers e
   WHERE e.id = v_employer_id;

  -- Employer row deleted out from under the tag: degrade to "not sponsored"
  -- rather than raising into the member's dashboard.
  IF NOT FOUND THEN
    RETURN 'null'::jsonb;
  END IF;

  v_norm := public._normalize_contribution_config(v_config);

  -- ONLY the funding facts. No contact details, no registration number.
  -- `compensation` is the member's OWN pay, which they are already shown
  -- elsewhere, and it is what turns a percentage into shillings client-side.
  RETURN jsonb_build_object(
    'employerName', v_name,
    'employeePct',  COALESCE(NULLIF(v_norm ->> 'employeePct', '')::numeric, 0),
    'employerPct',  COALESCE(NULLIF(v_norm ->> 'employerPct', '')::numeric, 0),
    'compensation', COALESCE(v_comp, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_employer_funding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_employer_funding() TO authenticated;

COMMENT ON FUNCTION public.get_my_employer_funding() IS
  'Subscriber-scoped read of who funds the caller''s pension: employer name, the '
  'two contribution percentages, and the caller''s own compensation. Exists so '
  'members can see payroll funding without a SELECT policy that would expose the '
  'whole employers row. Returns jsonb null when not employer-sponsored.';


-- -----------------------------------------------------------------------------
-- (5) _assert_contribution_config_shape — ONE validator, both write paths
-- -----------------------------------------------------------------------------
-- 0092 validated the config in `create_employer` (admin-only, used a handful of
-- times) but NOT in `update_employer_profile` — the RPC employers actually use
-- every day. An employer-role JWT could therefore store a scalar, an array, or
-- `employerPct: 999`, and the next contribution run would apply it verbatim:
-- 999% of pay, posted as real transactions. `_normalize_contribution_config`
-- absorbs a malformed SHAPE (it funds 0), but it has never had an opinion about
-- an out-of-range percentage.
--
-- Extracting the check into one function and calling it from both writers closes
-- that gap and removes the possibility of the two paths drifting apart again.
-- Only keys that ARE present are checked: an empty config stays legal, and there
-- is deliberately no minimum and no cap other than the 0-100 that "percent"
-- means.
CREATE OR REPLACE FUNCTION public._assert_contribution_config_shape(p_config jsonb)
RETURNS void
LANGUAGE plpgsql
-- Deliberately VOLATILE (the default). An IMMUTABLE validator with constant
-- arguments can be folded at plan time, which is a needless subtlety for a
-- function whose entire job is to RAISE.
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public._assert_contribution_config_shape(jsonb) FROM PUBLIC, anon;

COMMENT ON FUNCTION public._assert_contribution_config_shape(jsonb) IS
  'Shared shape/range validation for employers.default_contribution_config. '
  'Called by create_employer and update_employer_profile so the admin and '
  'employer write paths cannot drift apart.';


-- -----------------------------------------------------------------------------
-- (6) create_employer — drop the basis check, keep the percentage range check
-- -----------------------------------------------------------------------------
-- Identical to the 0092 body except that the employeeBasis/employerBasis loop is
-- gone: those keys no longer exist, so validating them would reject nothing and
-- describe a model the app no longer has.
CREATE OR REPLACE FUNCTION public.create_employer(
  p_name                        text,
  p_sector                      text  DEFAULT NULL,
  p_registration_no             text  DEFAULT NULL,
  p_contact_name                text  DEFAULT NULL,
  p_contact_phone               text  DEFAULT NULL,
  p_contact_email               text  DEFAULT NULL,
  p_district                    text  DEFAULT NULL,
  p_payroll_cadence             text  DEFAULT NULL,
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

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) TO authenticated;


-- -----------------------------------------------------------------------------
-- (7) update_employer_profile — validate the config on the path employers use
-- -----------------------------------------------------------------------------
-- Body is 0067's, with ONE addition: the shape assertion from (5), applied only
-- when the patch actually carries a config. See (5) for why this path had no
-- validation and why that mattered.
--
-- Worth recording, because two comments in the tree got it wrong: the config
-- write below is a whole-column REPLACE, not a jsonb merge. `COALESCE(p_patch ->
-- 'defaultContributionConfig', default_contribution_config)` swaps the entire
-- object when the key is present and leaves it untouched when absent. There is no
-- `||`. The merge happens client-side, where settingsTabs.jsx rebuilds every key
-- from the draft before saving.
CREATE OR REPLACE FUNCTION public.update_employer_profile(
  p_patch             jsonb,
  p_group_cover       numeric DEFAULT NULL,
  p_insurance_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        text := (SELECT auth.jwt()) ->> 'app_role';
  v_employer_id text := (SELECT auth.jwt()) ->> 'employerId';
  v_config      jsonb;
  v_gip         jsonb;
  v_cover       numeric;
  v_status      text;
  v_prod        text;
  v_pc          jsonb;
  v_pcover      numeric;
  v_pon         boolean;
  v_result      jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'employer' THEN
    RAISE EXCEPTION 'role % cannot update an employer profile', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RAISE EXCEPTION 'missing employerId claim' USING ERRCODE = 'P0001';
  END IF;

  p_patch := COALESCE(p_patch, '{}'::jsonb);

  -- Only when the caller is actually writing a config. A profile-only patch
  -- (ProfileTab) must stay unaffected.
  IF (p_patch -> 'defaultContributionConfig') IS NOT NULL
     AND jsonb_typeof(p_patch -> 'defaultContributionConfig') <> 'null' THEN
    PERFORM public._assert_contribution_config_shape(p_patch -> 'defaultContributionConfig');
  END IF;

  UPDATE public.employers
     SET name                        = COALESCE(p_patch ->> 'name', name),
         sector                      = COALESCE(p_patch ->> 'sector', sector),
         registration_no             = COALESCE(p_patch ->> 'registrationNo', registration_no),
         contact_name                = COALESCE(p_patch ->> 'contactName', contact_name),
         contact_phone               = COALESCE(p_patch ->> 'contactPhone', contact_phone),
         contact_email               = COALESCE(p_patch ->> 'contactEmail', contact_email),
         district                    = COALESCE(p_patch ->> 'district', district),
         payroll_cadence             = COALESCE(p_patch ->> 'payrollCadence', payroll_cadence),
         default_contribution_config = COALESCE(p_patch -> 'defaultContributionConfig', default_contribution_config),
         updated_at                  = now()
   WHERE id = v_employer_id
  RETURNING to_jsonb(employers.*) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'employer % not found', v_employer_id USING ERRCODE = 'P0001';
  END IF;

  v_config := v_result -> 'default_contribution_config';
  v_gip    := v_config -> 'groupInsuranceProducts';

  IF v_gip IS NOT NULL AND jsonb_typeof(v_gip) = 'object' THEN
    -- Multi-product fan-out. LIFE → insurance_policies (single row per member).
    v_cover := round(COALESCE(NULLIF(v_gip -> 'life' ->> 'cover','')::numeric, 0));
    IF COALESCE((v_gip -> 'life' ->> 'enabled')::boolean, v_cover > 0) AND v_cover > 0 THEN
      INSERT INTO public.insurance_policies (subscriber_id, cover, premium_monthly, status, funded_by, updated_at)
      SELECT id, v_cover, 0, 'active', 'employer', now()
        FROM public.subscribers WHERE employer_id = v_employer_id
      ON CONFLICT (subscriber_id) DO UPDATE SET
        cover = EXCLUDED.cover, premium_monthly = 0, status = 'active',
        funded_by = 'employer', updated_at = now();
    ELSE
      UPDATE public.insurance_policies SET status = 'inactive', updated_at = now()
       WHERE funded_by = 'employer'
         AND subscriber_id IN (SELECT id FROM public.subscribers WHERE employer_id = v_employer_id);
    END IF;

    -- HEALTH + FUNERAL → subscriber_insurance_products (PK subscriber_id, product).
    FOREACH v_prod IN ARRAY ARRAY['health', 'funeral'] LOOP
      v_pc     := v_gip -> v_prod;
      v_pcover := round(COALESCE(NULLIF(v_pc ->> 'cover','')::numeric, 0));
      v_pon    := COALESCE((v_pc ->> 'enabled')::boolean, v_pcover > 0) AND v_pcover > 0;
      IF v_pon THEN
        INSERT INTO public.subscriber_insurance_products (subscriber_id, product, cover, premium_monthly, status, funded_by, updated_at)
        SELECT id, v_prod, v_pcover, 0, 'active', 'employer', now()
          FROM public.subscribers WHERE employer_id = v_employer_id
        ON CONFLICT (subscriber_id, product) DO UPDATE SET
          cover = EXCLUDED.cover, premium_monthly = 0, status = 'active',
          funded_by = 'employer', updated_at = now();
      ELSE
        UPDATE public.subscriber_insurance_products SET status = 'inactive', updated_at = now()
         WHERE product = v_prod AND funded_by = 'employer'
           AND subscriber_id IN (SELECT id FROM public.subscribers WHERE employer_id = v_employer_id);
      END IF;
    END LOOP;

  ELSIF p_insurance_enabled IS NOT NULL THEN
    -- Legacy single flat group life (back-compat with the 0056 two-param call).
    v_cover  := CASE WHEN p_insurance_enabled THEN round(COALESCE(p_group_cover, 0)) ELSE 0 END;
    v_status := CASE WHEN v_cover > 0 THEN 'active' ELSE 'inactive' END;
    INSERT INTO public.insurance_policies (subscriber_id, cover, premium_monthly, status, funded_by, updated_at)
    SELECT id, v_cover, 0, v_status, 'employer', now()
      FROM public.subscribers WHERE employer_id = v_employer_id
    ON CONFLICT (subscriber_id) DO UPDATE SET
      cover = EXCLUDED.cover, premium_monthly = 0, status = EXCLUDED.status,
      funded_by = 'employer', updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.update_employer_profile(jsonb, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_employer_profile(jsonb, numeric, boolean) TO authenticated;

COMMIT;

-- =============================================================================
-- End of 0093_percent_only_contribution_config.sql
-- Reversible via 0093_percent_only_contribution_config.down.sql.
-- =============================================================================
