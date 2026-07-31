-- =============================================================================
-- 0092_unified_contribution_config.down.sql
-- =============================================================================
-- ⚠️ REINSTATES THE WRONG-BASIS BUG. Running this restores the mode-switched
--    contribution model in which the employer leg was a percentage OF THE
--    EMPLOYEE LEG (`employerMatchPct`) instead of a share of pay — an employer
--    who meant "staff 10%, we add 5%" goes back to funding 0.5% of pay. There is
--    no reason to run this except to unwind a bad deploy.
--
-- Restores the exact prior LIVE bodies:
--   submit_employer_contribution_run  → 0067_employer_multiproduct_insurance.sql
--   create_employer_invite            → 0047_employer_invites.sql
--   get_employer_metrics              → 0044_employer_subscriber_rpcs.sql
--   create_employer                   → 0053_schema_hygiene.sql
-- …then drops the two functions 0092 introduced and clears the collect_schedule
-- column comment (0047 documented that column with an inline `--` comment only —
-- there was no COMMENT ON COLUMN in the database, so NULL is the original state).
--
-- ⚠️ WHAT HAPPENS TO CONFIGS SAVED WHILE 0092 WAS LIVE. They carry the unified
--    six-key shape and no `mode`, so the restored 0067 body reads
--    `COALESCE(mode, 'employer-only')` and funds the EMPLOYEE LEG AT ZERO. The
--    employer leg survives (the unified shape reuses the same employerBasis /
--    employerPct / employerAmount key names 0067 reads). Measured on a local
--    replica of this migration pair — employee/employer totals for one member on
--    UGX 1,000,000:
--      {ee 10% , er 5%    }  100,000 / 50,000  →  0 / 50,000
--      {ee 30k , er 20k   }   30,000 / 20,000  →  0 / 20,000
--      {ee 10% , er 25k   }   75,000 / 25,000  →  0 / 25,000
--      {ee 10% , er 5% , no explicit employerBasis}
--                            100,000 / 50,000  →  0 /      0
--    That last row is the 'fixed' employerBasis default 0092 removed: with no
--    explicit basis 0067 falls to round(employerAmount) = 0 and funds NOTHING,
--    silently. So after running this down migration, STAFF DEDUCTIONS STOP BEING
--    REMITTED for every employer, and percent-only employers may stop funding
--    entirely. Restore the `employers.default_contribution_config` rows from a
--    pre-0092 backup, or hand-write a `mode` back onto each row, before allowing
--    another contribution run.
--
-- ⚠️ Apply OUT OF BAND (Supabase SQL editor / apply_migration), not via
--    `supabase db push` — the tracked ledger stops at 0084.
-- =============================================================================


-- ── restore 0067's submit_employer_contribution_run (mode + match basis) ─────
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
  v_mode             text;
  v_basis            text;
  v_employee_pct     numeric;
  v_employer_pct     numeric;
  v_match_pct        numeric;
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
  v_mode   := COALESCE(v_config ->> 'mode', 'employer-only');

  v_basis            := COALESCE(v_config ->> 'employerBasis', 'fixed');
  v_employee_pct     := COALESCE(NULLIF(v_config ->> 'employeePct', '')::numeric, 0);
  v_match_pct        := COALESCE(NULLIF(v_config ->> 'employerMatchPct', '')::numeric, 0);
  v_employer_pct     := COALESCE(NULLIF(v_config ->> 'employerPct', '')::numeric, 0);
  v_employer_amount  := COALESCE(NULLIF(v_config ->> 'employerAmount', '')::numeric, 0);

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

    IF v_mode = 'co-contribution' THEN
      v_employee_leg := round(v_comp * v_employee_pct / 100);
      v_employer_leg := round(v_employee_leg * v_match_pct / 100);
    ELSE
      v_employee_leg := 0;
      IF v_basis = 'percent' THEN
        v_employer_leg := round(v_comp * v_employer_pct / 100);
      ELSE
        v_employer_leg := round(v_employer_amount);
      END IF;
    END IF;

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
        v_employee_leg, now(), 'settled', p_method, v_tx_ref, v_retirement, v_emergency, 'own', v_run_id
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


-- ── restore 0047's create_employer_invite (collect_schedule from mode) ───────
CREATE OR REPLACE FUNCTION public.create_employer_invite(p_prefill jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role        text := (SELECT auth.jwt()) ->> 'app_role';
  v_employer_id text := (SELECT auth.jwt()) ->> 'employerId';
  v_mode        text;
  v_collect     boolean;
  v_token       text;
  v_phone_norm  text;
BEGIN
  IF v_role IS DISTINCT FROM 'employer' THEN
    RAISE EXCEPTION 'role % cannot invite a member', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RAISE EXCEPTION 'missing employerId claim' USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(COALESCE(p_prefill ->> 'fullName', ''))) < 2 THEN
    RAISE EXCEPTION 'member full name is required';
  END IF;
  IF COALESCE(p_prefill ->> 'phone', '') !~ '^(\+?256)?[0-9]{9}$' THEN
    RAISE EXCEPTION 'a valid member phone is required';
  END IF;

  SELECT default_contribution_config ->> 'mode' INTO v_mode FROM public.employers WHERE id = v_employer_id;
  v_collect := (v_mode = 'co-contribution');

  v_phone_norm := right(regexp_replace(COALESCE(p_prefill ->> 'phone', ''), '[^0-9]', '', 'g'), 9);

  -- Dup-guard: don't invite someone already on this employer's roster …
  IF EXISTS (
    SELECT 1 FROM public.subscribers s
     WHERE s.employer_id = v_employer_id
       AND right(regexp_replace(COALESCE(s.phone, ''), '[^0-9]', '', 'g'), 9) = v_phone_norm
  ) THEN
    RAISE EXCEPTION 'a member with phone % is already on your roster', p_prefill ->> 'phone' USING ERRCODE = 'P0001';
  END IF;
  -- … or already has a live pending invite.
  IF EXISTS (
    SELECT 1 FROM public.employer_invites i
     WHERE i.employer_id = v_employer_id AND i.status = 'pending' AND i.expires_at > now()
       AND right(regexp_replace(COALESCE(i.prefill ->> 'phone', ''), '[^0-9]', '', 'g'), 9) = v_phone_norm
  ) THEN
    RAISE EXCEPTION 'phone % already has a pending invite', p_prefill ->> 'phone' USING ERRCODE = 'P0001';
  END IF;

  v_token := 'inv-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.employer_invites (token, employer_id, prefill, collect_schedule)
  VALUES (v_token, v_employer_id, COALESCE(p_prefill, '{}'::jsonb), v_collect);

  RETURN jsonb_build_object('token', v_token, 'collectSchedule', v_collect);
END; $$;
REVOKE ALL ON FUNCTION public.create_employer_invite(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_employer_invite(jsonb) TO authenticated;

-- 0047 carried no COMMENT ON COLUMN for this column — clearing it is the restore.
COMMENT ON COLUMN public.employer_invites.collect_schedule IS NULL;


-- ── restore 0044's get_employer_metrics (with the modeSplit key) ─────────────
CREATE OR REPLACE FUNCTION public.get_employer_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        text := (SELECT auth.jwt()) ->> 'app_role';
  v_employer_id text := (SELECT auth.jwt()) ->> 'employerId';
  v_sub         record;
  v_tx          record;
  v_insured     integer;
  v_mode        text;
  v_result      jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'employer' THEN
    RAISE EXCEPTION 'role % cannot read employer metrics', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT
    COUNT(*)                                   AS headcount,
    COUNT(*) FILTER (WHERE s.is_active)        AS active,
    COUNT(*) FILTER (WHERE NOT s.is_active)    AS suspended,
    COALESCE(SUM(b.total_balance), 0)          AS total_balance
    INTO v_sub
    FROM public.subscribers s
    LEFT JOIN public.subscriber_balances b ON b.subscriber_id = s.id
   WHERE s.employer_id = v_employer_id;

  SELECT
    COALESCE(SUM(t.amount) FILTER (WHERE t.source = 'own'), 0)      AS own_total,
    COALESCE(SUM(t.amount) FILTER (WHERE t.source = 'employer'), 0) AS employer_total,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source = 'own' AND date_part('year', t.date) = date_part('year', now())), 0)      AS own_ytd,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source = 'employer' AND date_part('year', t.date) = date_part('year', now())), 0) AS employer_ytd
    INTO v_tx
    FROM public.transactions t
    JOIN public.subscribers s ON s.id = t.subscriber_id
   WHERE s.employer_id = v_employer_id
     AND t.type = 'contribution';

  SELECT COUNT(*) INTO v_insured
    FROM public.insurance_policies ip
    JOIN public.subscribers s ON s.id = ip.subscriber_id
   WHERE s.employer_id = v_employer_id
     AND ip.status = 'active';

  SELECT default_contribution_config ->> 'mode' INTO v_mode
    FROM public.employers WHERE id = v_employer_id;

  v_result := jsonb_build_object(
    'headcount',             COALESCE(v_sub.headcount, 0),
    'active',                COALESCE(v_sub.active, 0),
    'suspended',             COALESCE(v_sub.suspended, 0),
    'totalBalance',          COALESCE(v_sub.total_balance, 0),
    'totalContributions',    COALESCE(v_tx.own_total, 0) + COALESCE(v_tx.employer_total, 0),
    'ownContributions',      COALESCE(v_tx.own_total, 0),
    'employerContributions', COALESCE(v_tx.employer_total, 0),
    'insuredCount',          COALESCE(v_insured, 0),
    'employerYtd',           COALESCE(v_tx.employer_ytd, 0),
    'employeeYtd',           COALESCE(v_tx.own_ytd, 0),
    'modeSplit', CASE
      WHEN v_mode = 'co-contribution'
        THEN jsonb_build_object('coContribution', COALESCE(v_sub.headcount, 0), 'employerOnly', 0)
      ELSE jsonb_build_object('coContribution', 0, 'employerOnly', COALESCE(v_sub.headcount, 0))
    END
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employer_metrics() TO authenticated;


-- ── restore 0053's create_employer (no unified-config shape validation) ──────
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

  -- Config must be a jsonb OBJECT (§2a.8: a malformed config breaks downstream
  -- contribution runs which read mode/matchPct/employerAmount off it).
  IF jsonb_typeof(v_config) <> 'object' THEN
    RAISE EXCEPTION 'default contribution config must be a JSON object' USING ERRCODE = 'P0001';
  END IF;

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

REVOKE ALL ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) TO authenticated;


-- ── drop what 0092 added ────────────────────────────────────────────────────
-- Order matters: get_my_employer_funding is the only caller of the normaliser
-- left once the run RPC above has been rolled back to 0067's body.
DROP FUNCTION IF EXISTS public.get_my_employer_funding();
DROP FUNCTION IF EXISTS public._normalize_contribution_config(jsonb);

-- =============================================================================
-- End of 0092_unified_contribution_config.down.sql
-- =============================================================================
