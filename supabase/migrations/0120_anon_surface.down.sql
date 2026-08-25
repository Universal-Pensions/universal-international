-- =============================================================================
-- DOWN for 0120_anon_surface.sql
-- =============================================================================
-- Restores the pre-0120 state exactly:
--   * both function bodies below were captured VERBATIM from the live database
--     with pg_get_functiondef() immediately before 0120 was written — they are
--     not retyped from an older migration, so they carry every change that had
--     accumulated on live since each function was last defined in a file.
--   * the five CHECK constraints are dropped.
--   * the sequence grants are restored to the Supabase default (rwU) that
--     commission_id_seq / subscriber_id_seq carried before 0120.
--
-- WARNING: running this re-opens A03-001 — any valid invite token can once more
-- re-home a subscriber it was never issued for and overwrite their compensation.
-- =============================================================================

BEGIN;

-- ── 1. live body of create_subscriber_from_employer_invite, pre-0120 ─────────
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
    -- 0102: the chain already defaults the split to 80/20 when the payload
    -- carries none, which is what we want. Nothing to restate — see the note on
    -- the ELSE branch below.
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
    -- 0102: the member's OWN schedule, created dormant at the standard 80/20
    -- default (amount 0 — they have not set one up yet). Deliberately NOT 100/0:
    -- where their employer's money lands is fixed by the run engine and is no
    -- business of this row, so stamping the employer's allocation here would
    -- pre-decide the member's own split for them. Any split in the payload is
    -- ignored — the invite UI stopped collecting one, so a value there can only
    -- come from a stale client.
    INSERT INTO public.contribution_schedules (subscriber_id, frequency, amount, retirement_pct, emergency_pct, include_insurance, insurance_choice_made, next_due_date)
    VALUES (v_new_id, 'monthly', 0, 80, 20, FALSE, TRUE, v_today + 30);
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

-- ── 2. live body of _insert_subscriber_chain, pre-0120 ──────────────────────
CREATE OR REPLACE FUNCTION public._insert_subscriber_chain(p_payload jsonb, p_calling_agent_id text, p_amount_override numeric DEFAULT NULL::numeric, p_skip_deposit boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_id         TEXT;
  v_schedule       jsonb;
  v_amount         NUMERIC;
  v_retirement_pct INTEGER;
  v_emergency_pct  INTEGER;
  v_frequency      TEXT;
  v_freq_per_year  INTEGER;
  v_next_due       DATE;
  v_p_ben          jsonb;
  v_i_ben          jsonb;
  v_b              jsonb;
  v_nom_counter    INTEGER := 0;
  v_today          DATE := CURRENT_DATE;
  v_dob            DATE;
  v_age            INTEGER;
  v_insurance_pol  jsonb;
  v_ins_prod       jsonb;   -- one element of payload.insuranceProducts
  v_tx_id          TEXT;
  v_p_count        INTEGER;
  v_p_sum          NUMERIC;
  v_i_count        INTEGER;
  v_i_sum          NUMERIC;
  -- 0072 additions (save-to-cover + indexation):
  v_funding_mode   TEXT;
  v_index_pct      NUMERIC;
  v_prem_target    NUMERIC;
  v_savings_pct    NUMERIC;
  v_prem_tx_id     TEXT;
  v_prem_ref       TEXT;
BEGIN
  v_new_id := 's-' || lpad(nextval('public.subscriber_id_seq')::text, 6, '0');

  v_schedule       := p_payload -> 'contributionSchedule';
  -- p_amount_override forces the schedule amount (0 for employer co-contribution
  -- members, who do not self-save under the new model); NULL => use payload.
  v_amount         := COALESCE(p_amount_override, (v_schedule ->> 'amount')::numeric);
  v_retirement_pct := COALESCE((v_schedule ->> 'retirementPct')::integer, 80);
  v_emergency_pct  := COALESCE((v_schedule ->> 'emergencyPct')::integer,  100 - v_retirement_pct);
  v_frequency      := COALESCE(v_schedule ->> 'frequency', 'monthly');
  v_freq_per_year  := CASE v_frequency
                        WHEN 'daily'       THEN 365
                        WHEN 'weekly'      THEN 52
                        WHEN 'monthly'     THEN 12
                        WHEN 'quarterly'   THEN 4
                        WHEN 'half-yearly' THEN 2
                        WHEN 'annually'    THEN 1
                        ELSE 12
                      END;
  v_next_due := (v_today + CASE v_frequency
                             WHEN 'daily'       THEN INTERVAL '1 day'
                             WHEN 'weekly'      THEN INTERVAL '1 week'
                             WHEN 'monthly'     THEN INTERVAL '1 month'
                             WHEN 'quarterly'   THEN INTERVAL '3 months'
                             WHEN 'half-yearly' THEN INTERVAL '6 months'
                             WHEN 'annually'    THEN INTERVAL '1 year'
                             ELSE INTERVAL '1 month'
                           END)::date;

  -- 0072: funding mode / indexation / annual premium target from the schedule.
  v_funding_mode := COALESCE(v_schedule ->> 'insuranceFundingMode', 'pay_now');
  v_index_pct    := COALESCE((v_schedule ->> 'contributionIndexationPct')::numeric, 0);
  v_prem_target  := COALESCE((v_schedule ->> 'insurancePremiumTarget')::numeric, 0);
  v_savings_pct  := COALESCE((v_schedule ->> 'insuranceSavingsPct')::numeric, 100);

  v_dob := (p_payload ->> 'dob')::date;
  v_age := EXTRACT(YEAR FROM age(v_today, v_dob))::int;

  INSERT INTO public.subscribers (
    id, name, email, phone, gender, age, dob, nin, occupation, agent_id,
    district_id, kyc_status, is_active, is_demo_signup, insurance_same_as_pension,
    registered_date, consent_at, contribution_history, products_held
  ) VALUES (
    v_new_id,
    p_payload ->> 'fullName',
    NULLIF(p_payload ->> 'email', ''),
    p_payload ->> 'phone',
    p_payload ->> 'gender',
    v_age,
    v_dob,
    p_payload ->> 'nin',
    NULLIF(p_payload ->> 'occupation', ''),
    p_calling_agent_id,
    p_payload ->> 'districtId',
    'complete',
    TRUE,
    TRUE,
    COALESCE((p_payload ->> 'insuranceSameAsPension')::boolean, TRUE),
    v_today,
    COALESCE((p_payload ->> 'consentTimestamp')::timestamptz, now()),
    '[]'::jsonb,
    '[]'::jsonb
  );

  INSERT INTO public.contribution_schedules (
    subscriber_id, frequency, amount, retirement_pct, emergency_pct,
    include_insurance, insurance_choice_made, next_due_date,
    insurance_funding_mode, insurance_premium_target, insurance_premium_accrued,
    insurance_savings_pct, contribution_indexation_pct, last_indexed_at
  ) VALUES (
    v_new_id,
    v_frequency,
    v_amount,
    v_retirement_pct,
    v_emergency_pct,
    COALESCE((v_schedule ->> 'includeInsurance')::boolean, FALSE),
    COALESCE((p_payload ->> 'insuranceChoiceMade')::boolean, TRUE),
    v_next_due,
    v_funding_mode,
    v_prem_target,
    0,
    v_savings_pct,
    v_index_pct,
    v_today       -- anniversary marker: first index bump is a year out
  );

  v_p_ben := COALESCE(p_payload -> 'pensionBeneficiaries', '[]'::jsonb);

  SELECT COUNT(*), COALESCE(SUM((n->>'share')::numeric), 0)
    INTO v_p_count, v_p_sum
    FROM jsonb_array_elements(v_p_ben) n;
  IF v_p_count > 0 AND ABS(v_p_sum - 100) > 0.01 THEN
    RAISE EXCEPTION 'pension_share_sum_must_equal_100 (got %)', v_p_sum
      USING ERRCODE = 'P0005';
  END IF;

  IF NOT COALESCE((p_payload ->> 'insuranceSameAsPension')::boolean, TRUE) THEN
    v_i_ben := COALESCE(p_payload -> 'insuranceBeneficiaries', '[]'::jsonb);
    SELECT COUNT(*), COALESCE(SUM((n->>'share')::numeric), 0)
      INTO v_i_count, v_i_sum
      FROM jsonb_array_elements(v_i_ben) n;
    IF v_i_count > 0 AND ABS(v_i_sum - 100) > 0.01 THEN
      RAISE EXCEPTION 'insurance_share_sum_must_equal_100 (got %)', v_i_sum
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

  FOR v_b IN SELECT jsonb_array_elements(v_p_ben) LOOP
    v_nom_counter := v_nom_counter + 1;
    INSERT INTO public.nominees (
      id, subscriber_id, type, name, phone, relationship, nin, share
    ) VALUES (
      'nom-' || v_new_id || '-p-' || v_nom_counter,
      v_new_id, 'pension',
      v_b ->> 'name', v_b ->> 'phone', v_b ->> 'relationship', v_b ->> 'nin',
      COALESCE((v_b ->> 'share')::numeric, 0)
    );
  END LOOP;

  IF COALESCE((p_payload ->> 'insuranceSameAsPension')::boolean, TRUE) THEN
    v_nom_counter := 0;
    FOR v_b IN SELECT jsonb_array_elements(v_p_ben) LOOP
      v_nom_counter := v_nom_counter + 1;
      INSERT INTO public.nominees (
        id, subscriber_id, type, name, phone, relationship, nin, share
      ) VALUES (
        'nom-' || v_new_id || '-i-' || v_nom_counter,
        v_new_id, 'insurance',
        v_b ->> 'name', v_b ->> 'phone', v_b ->> 'relationship', v_b ->> 'nin',
        COALESCE((v_b ->> 'share')::numeric, 0)
      );
    END LOOP;
  ELSE
    v_i_ben := COALESCE(p_payload -> 'insuranceBeneficiaries', '[]'::jsonb);
    v_nom_counter := 0;
    FOR v_b IN SELECT jsonb_array_elements(v_i_ben) LOOP
      v_nom_counter := v_nom_counter + 1;
      INSERT INTO public.nominees (
        id, subscriber_id, type, name, phone, relationship, nin, share
      ) VALUES (
        'nom-' || v_new_id || '-i-' || v_nom_counter,
        v_new_id, 'insurance',
        v_b ->> 'name', v_b ->> 'phone', v_b ->> 'relationship', v_b ->> 'nin',
        COALESCE((v_b ->> 'share')::numeric, 0)
      );
    END LOOP;
  END IF;

  v_insurance_pol := p_payload -> 'insurancePolicy';
  IF v_insurance_pol IS NOT NULL THEN
    INSERT INTO public.insurance_policies (
      subscriber_id, cover, premium_monthly, policy_start, renewal_date, status
    ) VALUES (
      v_new_id,
      COALESCE((v_insurance_pol ->> 'cover')::numeric, 0),
      COALESCE((v_insurance_pol ->> 'premiumMonthly')::numeric, 0),
      COALESCE((v_insurance_pol ->> 'policyStart')::date, v_today),
      COALESCE((v_insurance_pol ->> 'renewalDate')::date, (v_today + INTERVAL '1 year')::date),
      CASE
        WHEN v_funding_mode = 'save_to_cover' THEN 'building'
        WHEN COALESCE((v_insurance_pol ->> 'cover')::numeric, 0) > 0 THEN 'active'
        ELSE 'inactive'
      END
    );
  END IF;

  -- extra (non-life) insurance products -> subscriber_insurance_products.
  -- payload.insuranceProducts = [{product, cover, premiumMonthly, policyStart?,
  -- renewalDate?}]. 'life' lives in insurance_policies (above), so it is ignored
  -- here. status derived from cover>0 to match the life branch, EXCEPT when
  -- save_to_cover forces 'building'. ON CONFLICT keeps a payload-dup idempotent.
  -- NO transactions row -> no balance trigger.
  IF jsonb_typeof(p_payload -> 'insuranceProducts') = 'array' THEN
    FOR v_ins_prod IN SELECT jsonb_array_elements(p_payload -> 'insuranceProducts') LOOP
      IF (v_ins_prod ->> 'product') IN ('health', 'funeral') THEN
        INSERT INTO public.subscriber_insurance_products (
          subscriber_id, product, cover, premium_monthly, policy_start, renewal_date, status, updated_at
        ) VALUES (
          v_new_id,
          v_ins_prod ->> 'product',
          COALESCE((v_ins_prod ->> 'cover')::numeric, 0),
          COALESCE((v_ins_prod ->> 'premiumMonthly')::numeric, 0),
          COALESCE((v_ins_prod ->> 'policyStart')::date, v_today),
          COALESCE((v_ins_prod ->> 'renewalDate')::date, (v_today + INTERVAL '1 year')::date),
          CASE
            WHEN v_funding_mode = 'save_to_cover' THEN 'building'
            WHEN COALESCE((v_ins_prod ->> 'cover')::numeric, 0) > 0 THEN 'active'
            ELSE 'inactive'
          END,
          now()
        )
        ON CONFLICT (subscriber_id, product) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  -- Signup first-contribution deposit. Skipped for employer co-contribution
  -- members (p_skip_deposit) and never posted for a zero amount.
  IF NOT p_skip_deposit AND COALESCE(v_amount, 0) > 0 THEN
    v_tx_id := 'tx-' || v_new_id || '-init';
    INSERT INTO public.transactions (
      id, subscriber_id, agent_id, type, amount, date, status, method,
      txn_ref, split_retirement, split_emergency
    ) VALUES (
      v_tx_id, v_new_id, p_calling_agent_id, 'contribution', v_amount, now(), 'settled',
      COALESCE(p_payload ->> 'paymentMethod', 'MTN Mobile Money'),
      'CT-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0'),
      ROUND(v_amount * (v_retirement_pct / 100.0)),
      v_amount - ROUND(v_amount * (v_retirement_pct / 100.0))
    );
  END IF;

  -- 0072 Route A (pay_now): charge the combined ANNUAL premium as its own ledger
  -- row (type='premium' -> never fires the contribution balance trigger).
  -- save_to_cover posts NO premium here (the trigger sweeps it later from savings).
  IF v_funding_mode = 'pay_now' AND COALESCE(v_prem_target, 0) > 0 THEN
    v_prem_ref   := 'PR-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    v_prem_tx_id := 'tx-' || v_new_id || '-prem-' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.transactions (
      id, subscriber_id, type, amount, date, status, method, txn_ref, source
    ) VALUES (
      v_prem_tx_id, v_new_id, 'premium', v_prem_target, now(), 'settled',
      COALESCE(p_payload ->> 'paymentMethod', 'MTN Mobile Money'),
      v_prem_ref, 'own'
    );
  END IF;

  RETURN v_new_id;
END;
$function$;

-- ── 3. drop the length CHECK constraints ────────────────────────────────────
ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_name_len_chk,
  DROP CONSTRAINT IF EXISTS subscribers_email_len_chk,
  DROP CONSTRAINT IF EXISTS subscribers_phone_len_chk,
  DROP CONSTRAINT IF EXISTS subscribers_nin_len_chk,
  DROP CONSTRAINT IF EXISTS subscribers_occupation_len_chk;

-- ── 4. restore the Supabase-default sequence grants ─────────────────────────
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.commission_id_seq TO anon, authenticated;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.subscriber_id_seq TO anon, authenticated;

COMMIT;
