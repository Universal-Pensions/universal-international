-- =============================================================================
-- Universal Pensions Uganda — 0093 DOWN: restore the two-basis contribution model
-- =============================================================================
-- Restores 0092's six-key `_normalize_contribution_config`, its
-- `submit_employer_contribution_run`, `get_my_employer_funding` and
-- `create_employer`, restores 0067's `update_employer_profile`, and drops the
-- shared validator introduced by 0093.
--
-- ⚠️ DATA. The 0093 backfill is NOT undone. Rows are left in the percent-only
-- shape `{employeePct, employerPct, …}`, which the restored 0092 normaliser
-- reads correctly: it has no `mode`, so it falls to the "already unified" branch,
-- where an absent basis defaults to 'percent' and the absent amounts read as 0 —
-- exactly the intended values. Money is therefore unchanged by rolling back, and
-- the pre-0092 `mode`/`employerMatchPct` keys stay retired (re-deriving a match
-- percentage from a percent-of-pay figure would be guesswork).
--
-- Pair with a matching revert of src/utils/contributionModel.js — the JS and SQL
-- twins must not straddle this boundary.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (1) restore 0092's six-key normaliser
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._normalize_contribution_config(p_config jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (
    SELECT CASE
             WHEN jsonb_typeof(COALESCE(p_config, '{}'::jsonb)) = 'object'
               THEN COALESCE(p_config, '{}'::jsonb)
             ELSE '{}'::jsonb
           END AS c
  ),
  shape AS (
    SELECT
      c,
      c ->> 'mode' AS mode,
      (
        ((c -> 'employeeBasis') IS NOT NULL AND jsonb_typeof(c -> 'employeeBasis') <> 'null')
        OR
        ((c -> 'employerBasis') IS NOT NULL AND jsonb_typeof(c -> 'employerBasis') <> 'null')
      ) AS unified,
      ((c -> 'employerAmount') IS NOT NULL AND jsonb_typeof(c -> 'employerAmount') <> 'null')
        AS legacy_employer_fixed
      FROM cfg
  )
  SELECT CASE
    WHEN mode = 'co-contribution' THEN jsonb_build_object(
      'employeeBasis',  'percent',
      'employeePct',    COALESCE(NULLIF(c ->> 'employeePct', '')::numeric, 0),
      'employeeAmount', 0,
      'employerBasis',  'percent',
      'employerPct',    trim_scale(
                          COALESCE(NULLIF(c ->> 'employeePct', '')::numeric, 0)
                          * COALESCE(
                              NULLIF(c ->> 'employerMatchPct', '')::numeric,
                              NULLIF(c ->> 'matchPct',         '')::numeric,
                              0
                            ) / 100
                        ),
      'employerAmount', 0
    )
    WHEN mode = 'employer-only' THEN jsonb_build_object(
      'employeeBasis',  'percent',
      'employeePct',    0,
      'employeeAmount', 0,
      'employerBasis',  CASE WHEN legacy_employer_fixed THEN 'fixed' ELSE 'percent' END,
      'employerPct',    COALESCE(NULLIF(c ->> 'employerPct',    '')::numeric, 0),
      'employerAmount', COALESCE(NULLIF(c ->> 'employerAmount', '')::numeric, 0)
    )
    WHEN unified THEN jsonb_build_object(
      'employeeBasis',  CASE WHEN c ->> 'employeeBasis' = 'fixed' THEN 'fixed' ELSE 'percent' END,
      'employeePct',    COALESCE(NULLIF(c ->> 'employeePct',    '')::numeric, 0),
      'employeeAmount', COALESCE(NULLIF(c ->> 'employeeAmount', '')::numeric, 0),
      'employerBasis',  CASE WHEN c ->> 'employerBasis' = 'fixed' THEN 'fixed' ELSE 'percent' END,
      'employerPct',    COALESCE(NULLIF(c ->> 'employerPct',    '')::numeric, 0),
      'employerAmount', COALESCE(NULLIF(c ->> 'employerAmount', '')::numeric, 0)
    )
    ELSE jsonb_build_object(
      'employeeBasis',  'percent',
      'employeePct',    0,
      'employeeAmount', 0,
      'employerBasis',  'percent',
      'employerPct',    0,
      'employerAmount', 0
    )
  END
  FROM shape;
$$;

REVOKE ALL ON FUNCTION public._normalize_contribution_config(jsonb) FROM PUBLIC, anon;

COMMENT ON FUNCTION public._normalize_contribution_config(jsonb) IS
  'Canonicalise employers.default_contribution_config into the six unified pension '
  'keys (employee/employer × basis/pct/amount). SQL twin of '
  'normalizeContributionConfig in src/utils/contributionModel.js — keep in lockstep.';


-- -----------------------------------------------------------------------------
-- (2) restore 0092's run RPC (basis-switched leg math)
-- -----------------------------------------------------------------------------
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
  v_employee_basis   text;
  v_employee_pct     numeric;
  v_employee_amount  numeric;
  v_employer_basis   text;
  v_employer_pct     numeric;
  v_employer_amount  numeric;
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

  v_norm := public._normalize_contribution_config(v_config);

  v_employee_basis   := COALESCE(NULLIF(v_norm ->> 'employeeBasis', ''), 'percent');
  v_employee_pct     := COALESCE(NULLIF(v_norm ->> 'employeePct',     '')::numeric, 0);
  v_employee_amount  := COALESCE(NULLIF(v_norm ->> 'employeeAmount',  '')::numeric, 0);
  v_employer_basis   := COALESCE(NULLIF(v_norm ->> 'employerBasis', ''), 'percent');
  v_employer_pct     := COALESCE(NULLIF(v_norm ->> 'employerPct',     '')::numeric, 0);
  v_employer_amount  := COALESCE(NULLIF(v_norm ->> 'employerAmount',  '')::numeric, 0);

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

    v_employee_leg := CASE
                        WHEN v_employee_basis = 'percent' THEN round(v_comp * v_employee_pct / 100)
                        ELSE round(v_employee_amount)
                      END;
    v_employer_leg := CASE
                        WHEN v_employer_basis = 'percent' THEN round(v_comp * v_employer_pct / 100)
                        ELSE round(v_employer_amount)
                      END;

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
-- (3) restore 0092's get_my_employer_funding (six keys)
-- -----------------------------------------------------------------------------
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

  SELECT s.employer_id, COALESCE(s.compensation, 0)
    INTO v_employer_id, v_comp
    FROM public.subscribers s
   WHERE s.id = v_sub_id;

  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RETURN 'null'::jsonb;
  END IF;

  SELECT e.name, COALESCE(e.default_contribution_config, '{}'::jsonb)
    INTO v_name, v_config
    FROM public.employers e
   WHERE e.id = v_employer_id;

  IF NOT FOUND THEN
    RETURN 'null'::jsonb;
  END IF;

  v_norm := public._normalize_contribution_config(v_config);

  RETURN jsonb_build_object(
    'employerName',   v_name,
    'employeeBasis',  COALESCE(NULLIF(v_norm ->> 'employeeBasis', ''), 'percent'),
    'employeePct',    COALESCE(NULLIF(v_norm ->> 'employeePct',    '')::numeric, 0),
    'employeeAmount', COALESCE(NULLIF(v_norm ->> 'employeeAmount', '')::numeric, 0),
    'employerBasis',  COALESCE(NULLIF(v_norm ->> 'employerBasis', ''), 'percent'),
    'employerPct',    COALESCE(NULLIF(v_norm ->> 'employerPct',    '')::numeric, 0),
    'employerAmount', COALESCE(NULLIF(v_norm ->> 'employerAmount', '')::numeric, 0),
    'compensation',   COALESCE(v_comp, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_employer_funding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_employer_funding() TO authenticated;

COMMENT ON FUNCTION public.get_my_employer_funding() IS
  'Subscriber-scoped read of who funds the caller''s pension: employer name, the '
  'six unified contribution keys, and the caller''s own compensation. Exists so '
  'members can see payroll funding without a SELECT policy that would expose the '
  'whole employers row. Returns jsonb null when not employer-sponsored.';


-- -----------------------------------------------------------------------------
-- (4) restore 0092's create_employer (inline basis + percentage validation)
-- -----------------------------------------------------------------------------
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
  v_key    text;
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

  IF jsonb_typeof(v_config) <> 'object' THEN
    RAISE EXCEPTION 'default contribution config must be a JSON object' USING ERRCODE = 'P0001';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['employeeBasis', 'employerBasis'] LOOP
    IF (v_config -> v_key) IS NOT NULL AND jsonb_typeof(v_config -> v_key) <> 'null'
       AND COALESCE(v_config ->> v_key, '') NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION '% must be "percent" or "fixed"', v_key USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY['employeePct', 'employerPct'] LOOP
    IF (v_config -> v_key) IS NOT NULL AND jsonb_typeof(v_config -> v_key) <> 'null' THEN
      IF jsonb_typeof(v_config -> v_key) <> 'number' THEN
        RAISE EXCEPTION '% must be a number', v_key USING ERRCODE = 'P0001';
      END IF;
      IF (v_config ->> v_key)::numeric < 0 OR (v_config ->> v_key)::numeric > 100 THEN
        RAISE EXCEPTION '% must be between 0 and 100', v_key USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

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
-- (5) restore 0067's update_employer_profile (no config validation)
-- -----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.update_employer_profile(jsonb, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_employer_profile(jsonb, numeric, boolean) TO authenticated;


-- -----------------------------------------------------------------------------
-- (6) drop the 0093-only validator
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._assert_contribution_config_shape(jsonb);

COMMIT;

-- =============================================================================
-- End of 0093_percent_only_contribution_config.down.sql
-- =============================================================================
