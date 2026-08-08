-- 0102_employer_contributions_all_retirement.down.sql
-- Restores the pre-0102 bodies verbatim: submit_employer_contribution_run from
-- 0093 and create_subscriber_from_employer_invite from 0062.
--
-- ⚠️ Rolling back re-opens what 0102 closed. Employer contribution runs will
-- again allocate by the member's retirement_pct, so a member who has set a
-- liquid share diverts that fraction of their employer's pension money into a
-- pot they can withdraw at any time. The invite UI no longer asks for a split,
-- so those members carry 100/0 and are unaffected until they edit it.
--
-- Schedules stamped 100/0 by 0102 are NOT reverted — there is no record of what
-- each member "would have" chosen, and 80/20 is a guess, not a restoration.

BEGIN;

-- ── submit_employer_contribution_run — back to the 0093 body ────────────────
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

-- ── create_subscriber_from_employer_invite — back to the 0062 body ──────────
CREATE OR REPLACE FUNCTION public.create_subscriber_from_employer_invite(payload jsonb, p_token text, p_nonce text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inv record; v_new_id text; v_prior jsonb; v_phone_norm text; v_existing_id text; v_existing_emp text;
  v_sched jsonb; v_dob date; v_age int; v_today date := CURRENT_DATE; v_b jsonb; v_nom_i int := 0;
BEGIN
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.subscriber_signup_uploads WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN RETURN v_prior #>> '{}'; END IF;
  END IF;
  SELECT * INTO v_inv FROM public.employer_invites WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found' USING ERRCODE='P0002'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'invite already used' USING ERRCODE='P0001'; END IF;
  IF v_inv.expires_at <= now() THEN RAISE EXCEPTION 'invite expired' USING ERRCODE='P0001'; END IF;

  v_phone_norm := right(regexp_replace(COALESCE(payload ->> 'phone',''),'[^0-9]','','g'),9);
  SELECT id, employer_id INTO v_existing_id, v_existing_emp FROM public.subscribers
   WHERE right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),9) = v_phone_norm
   ORDER BY created_at DESC LIMIT 1;

  IF v_existing_id IS NOT NULL AND v_existing_emp IS NOT NULL THEN
    RAISE EXCEPTION 'a subscriber with phone % already belongs to an employer', payload ->> 'phone' USING ERRCODE='P0001';
  ELSIF v_existing_id IS NOT NULL THEN
    UPDATE public.subscribers SET employer_id = v_inv.employer_id WHERE id = v_existing_id;
    v_new_id := v_existing_id;
  ELSIF v_inv.collect_schedule THEN
    -- Co-contribution member. New model: members do NOT self-set a saving amount.
    -- Validate KYC fields inline (the amount>0 rule in _validate_signup_payload no
    -- longer applies) and insert via the shared chain with amount forced to 0 and
    -- the signup deposit skipped (decision D-A(a)) — keeps full-KYC beneficiary /
    -- insurance collection; ongoing runs compute both legs from compensation.
    IF COALESCE(payload ->> 'phone','') !~ '^(\+?256)?[0-9]{9}$' THEN RAISE EXCEPTION 'valid phone is required'; END IF;
    IF length(trim(COALESCE(payload ->> 'fullName',''))) < 2 THEN RAISE EXCEPTION 'fullName is required'; END IF;
    IF COALESCE(payload ->> 'dob','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'dob is required'; END IF;
    IF COALESCE(payload ->> 'gender','') NOT IN ('male','female','other') THEN RAISE EXCEPTION 'gender invalid'; END IF;
    IF COALESCE(payload ->> 'nin','') = '' THEN RAISE EXCEPTION 'nin is required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.districts WHERE id = payload ->> 'districtId') THEN RAISE EXCEPTION 'unknown district'; END IF;
    v_new_id := public._insert_subscriber_chain(payload, NULL, 0, true);
    UPDATE public.subscribers SET employer_id = v_inv.employer_id WHERE id = v_new_id;
  ELSE
    IF COALESCE(payload ->> 'phone','') !~ '^(\+?256)?[0-9]{9}$' THEN RAISE EXCEPTION 'valid phone is required'; END IF;
    IF length(trim(COALESCE(payload ->> 'fullName',''))) < 2 THEN RAISE EXCEPTION 'fullName is required'; END IF;
    IF COALESCE(payload ->> 'dob','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'dob is required'; END IF;
    IF COALESCE(payload ->> 'gender','') NOT IN ('male','female','other') THEN RAISE EXCEPTION 'gender invalid'; END IF;
    IF COALESCE(payload ->> 'nin','') = '' THEN RAISE EXCEPTION 'nin is required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.districts WHERE id = payload ->> 'districtId') THEN RAISE EXCEPTION 'unknown district'; END IF;
    v_sched := COALESCE(payload -> 'contributionSchedule', '{}'::jsonb);
    v_dob := (payload ->> 'dob')::date;
    v_age := EXTRACT(YEAR FROM age(v_today, v_dob))::int;
    v_new_id := 's-' || lpad(nextval('public.subscriber_id_seq')::text, 6, '0');
    INSERT INTO public.subscribers (id, name, email, phone, gender, age, dob, nin, occupation, agent_id, employer_id,
      district_id, kyc_status, is_active, is_demo_signup, insurance_same_as_pension, registered_date, consent_at, contribution_history, products_held)
    VALUES (v_new_id, payload ->> 'fullName', NULLIF(payload ->> 'email',''), payload ->> 'phone', payload ->> 'gender',
      v_age, v_dob, payload ->> 'nin', NULLIF(payload ->> 'occupation',''), NULL, v_inv.employer_id, payload ->> 'districtId',
      'complete', TRUE, TRUE, FALSE, v_today, COALESCE((payload ->> 'consentTimestamp')::timestamptz, now()), '[]'::jsonb, '[]'::jsonb);
    INSERT INTO public.subscriber_balances (subscriber_id, retirement_balance, emergency_balance, total_balance, units, updated_at)
    VALUES (v_new_id, 0, 0, 0, 0, now()) ON CONFLICT (subscriber_id) DO NOTHING;
    INSERT INTO public.contribution_schedules (subscriber_id, frequency, amount, retirement_pct, emergency_pct, include_insurance, insurance_choice_made, next_due_date)
    VALUES (v_new_id, 'monthly', 0, COALESCE((v_sched ->> 'retirementPct')::int, 80),
      COALESCE((v_sched ->> 'emergencyPct')::int, 100 - COALESCE((v_sched ->> 'retirementPct')::int, 80)), FALSE, TRUE, v_today + 30);
    FOR v_b IN SELECT jsonb_array_elements(COALESCE(payload -> 'pensionBeneficiaries', '[]'::jsonb)) LOOP
      v_nom_i := v_nom_i + 1;
      INSERT INTO public.nominees (id, subscriber_id, type, name, phone, relationship, nin, share)
      VALUES ('nom-' || v_new_id || '-p-' || v_nom_i, v_new_id, 'pension', v_b ->> 'name', v_b ->> 'phone', v_b ->> 'relationship', v_b ->> 'nin', COALESCE((v_b ->> 'share')::numeric, 0));
    END LOOP;
  END IF;

  -- Thread the employer-stated monthly compensation onto the member (all branches).
  UPDATE public.subscribers
     SET compensation = COALESCE(NULLIF(v_inv.prefill ->> 'compensation','')::numeric, 0)
   WHERE id = v_new_id;

  UPDATE public.employer_invites SET status='completed', subscriber_id = v_new_id, completed_at = now() WHERE token = p_token;
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    INSERT INTO public.subscriber_signup_uploads (nonce, result) VALUES (p_nonce, to_jsonb(v_new_id)) ON CONFLICT (nonce) DO NOTHING;
  END IF;
  RETURN v_new_id;
END; $function$;

COMMIT;
