-- Amends the create_subscriber_from_employer_invite half of 0102.
--
-- 0102's first revision stamped a new employer member's schedule at 100/0,
-- reasoning from where their employer's money lands. That is the same coupling
-- in the opposite direction: `contribution_schedules` is the MEMBER's own plan —
-- their amount, their split — and pinning it to the employer's allocation
-- pre-decides it for them.
--
-- The two are independent:
--   employer legs          → contribution runs, 100% retirement, fixed in the run
--                            engine, never routed through a schedule row.
--   contribution_schedules → the member's own, default 80/20, theirs to set to
--                            60/40 or 100/0 or anything else; governs only money
--                            they put in themselves.
--
-- The run half of 0102 (submit_employer_contribution_run) is unchanged.
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
