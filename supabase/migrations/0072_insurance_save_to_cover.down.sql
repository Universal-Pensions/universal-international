-- ============================================================================
-- ⚠️  DO NOT RUN THIS FILE WITHOUT READING THIS FIRST  ⚠️
-- ----------------------------------------------------------------------------
-- Audit 2026-08-23 · A04-006 / A05-009 · verified against live 2026-08-25.
--
-- This down-migration CREATE OR REPLACEs `public.trg_transactions_contribution`
-- with the body that was current when this migration was written. That body
-- hardcodes the unit price:
--
--       v_unit_price  NUMERIC := 1000;
--
-- The LIVE body does NOT. Since 0103-0106 (NAV pricing, 2026-08-08) it reads
-- the admin-published fund NAV:
--
--       v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));
--
-- Running this file therefore SILENTLY REVERTS NAV PRICING. Every contribution
-- processed afterwards would buy units at the dead 1,000 UGX price regardless of
-- the published NAV, corrupting units, subscriber_balances and platform AUM. The
-- damage is arithmetically invisible — no error is raised, the numbers just stop
-- meaning what they say. It also drops the later LEAST()/GREATEST() withdrawal
-- guards that prevent negative unit balances.
--
-- `CREATE OR REPLACE` is a WHOLE-BODY REPLACE. It does not merge.
--
-- IF YOU ACTUALLY NEED TO REVERT THIS MIGRATION:
--   1. Capture the CURRENT live body FIRST — never retype it from an older file:
--        SELECT pg_get_functiondef('public.trg_transactions_contribution'::regproc);
--   2. Strip the trg_transactions_contribution block out of this file.
--   3. Re-apply the captured live body afterwards.
--
-- Retyping a function body from an older migration is the exact failure mode
-- that shipped to production once already (0095 over 0090, 2026-08-07).
-- ============================================================================

-- =============================================================================
-- Down migration for 0072 — restore the three function bodies to their exact
-- pre-0072 state (each with its ORIGINAL per-function security context) and drop
-- the 5 contribution_schedules columns.
--
-- Per-function context re-pin (do NOT blanket-copy — mixing these re-introduces
-- the 0042→0052 function_search_path_mutable regression):
--   * trg_transactions_contribution → SECURITY DEFINER  (verbatim 0043 body)
--   * _insert_subscriber_chain      → SECURITY INVOKER   (verbatim 0065 body)
--   * request_withdrawal            → SECURITY DEFINER  (verbatim 0054 body)
--
-- Functions are restored FIRST (so no restored body references the columns being
-- dropped), THEN the columns are dropped. The column-level UPDATE REVOKE from
-- 0072 disappears automatically with the dropped columns — no re-GRANT needed.
--
-- NOTE: any 'premium_sweep' ledger rows already written are LEFT in place. The
-- sweep permanently debited subscriber_balances via the trigger; deleting the
-- marker rows would NOT restore those balances and would desync the ledger
-- sign-sum from the balance snapshot. They read as inert historical outflows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Restore trg_transactions_contribution to the 0043 body (SECURITY DEFINER).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_transactions_contribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit_price       NUMERIC := 1000;
  v_retirement_share NUMERIC;
  v_emergency_share  NUMERIC;
  v_agent_id         TEXT;
  v_branch_id        TEXT;
  v_subscriber_name  TEXT;
  v_commission_rate  NUMERIC;
  v_new_commission_id TEXT;
BEGIN
  -- (b) Bucket split ---------------------------------------------------------
  IF NEW.split_retirement IS NOT NULL AND NEW.split_emergency IS NOT NULL THEN
    v_retirement_share := NEW.split_retirement;
    v_emergency_share  := NEW.split_emergency;
  ELSE
    v_retirement_share := ROUND(NEW.amount * 0.80);
    v_emergency_share  := NEW.amount - v_retirement_share;  -- avoids penny drift
  END IF;

  -- (a) Balance update -------------------------------------------------------
  INSERT INTO public.subscriber_balances (
    subscriber_id,
    retirement_balance,
    emergency_balance,
    total_balance,
    units,
    updated_at
  ) VALUES (
    NEW.subscriber_id,
    v_retirement_share,
    v_emergency_share,
    NEW.amount,
    NEW.amount / v_unit_price,
    now()
  )
  ON CONFLICT (subscriber_id) DO UPDATE SET
    retirement_balance = public.subscriber_balances.retirement_balance + EXCLUDED.retirement_balance,
    emergency_balance  = public.subscriber_balances.emergency_balance  + EXCLUDED.emergency_balance,
    total_balance      = public.subscriber_balances.total_balance      + EXCLUDED.total_balance,
    units              = public.subscriber_balances.units              + EXCLUDED.units,
    updated_at         = now();

  -- (c) First-contribution commission ----------------------------------------
  SELECT s.agent_id, s.name, a.branch_id
    INTO v_agent_id, v_subscriber_name, v_branch_id
    FROM public.subscribers s
    LEFT JOIN public.agents a ON a.id = s.agent_id
   WHERE s.id = NEW.subscriber_id;

  IF v_agent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.commissions
       WHERE subscriber_id = NEW.subscriber_id
         AND agent_id = v_agent_id
    ) THEN
      SELECT rate INTO v_commission_rate
        FROM public.commission_config
       WHERE id = 'default';

      IF v_commission_rate IS NOT NULL THEN
        v_new_commission_id := 'c-' || lpad(
          nextval('public.commission_id_seq')::text, 8, '0'
        );

        INSERT INTO public.commissions (
          id,
          agent_id,
          branch_id,
          subscriber_id,
          subscriber_name,
          amount,
          status,
          first_contribution_date,
          due_date
        ) VALUES (
          v_new_commission_id,
          v_agent_id,
          v_branch_id,
          NEW.subscriber_id,
          v_subscriber_name,
          v_commission_rate,
          'due',
          NEW.date::date,
          NEW.date::date
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_after_insert_contribution ON public.transactions;
CREATE TRIGGER transactions_after_insert_contribution
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  WHEN (NEW.type = 'contribution')
  EXECUTE FUNCTION public.trg_transactions_contribution();

-- -----------------------------------------------------------------------------
-- Restore _insert_subscriber_chain to the 0065 body (SECURITY INVOKER +
-- inline SET search_path — must NOT be DEFINER).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._insert_subscriber_chain(
  p_payload          jsonb,
  p_calling_agent_id text,
  p_amount_override  numeric DEFAULT NULL,
  p_skip_deposit     boolean DEFAULT false
)
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
BEGIN
  v_new_id := 's-' || lpad(nextval('public.subscriber_id_seq')::text, 6, '0');

  v_schedule       := p_payload -> 'contributionSchedule';
  v_amount         := COALESCE(p_amount_override, (v_schedule ->> 'amount')::numeric);
  v_retirement_pct := COALESCE((v_schedule ->> 'retirementPct')::integer, 80);
  v_emergency_pct  := COALESCE((v_schedule ->> 'emergencyPct')::integer,  100 - v_retirement_pct);
  v_frequency      := COALESCE(v_schedule ->> 'frequency', 'monthly');
  v_freq_per_year  := CASE v_frequency
                        WHEN 'weekly'      THEN 52
                        WHEN 'monthly'     THEN 12
                        WHEN 'quarterly'   THEN 4
                        WHEN 'half-yearly' THEN 2
                        WHEN 'annually'    THEN 1
                        ELSE 12
                      END;
  v_next_due := (v_today + CASE v_frequency
                             WHEN 'weekly'      THEN INTERVAL '1 week'
                             WHEN 'monthly'     THEN INTERVAL '1 month'
                             WHEN 'quarterly'   THEN INTERVAL '3 months'
                             WHEN 'half-yearly' THEN INTERVAL '6 months'
                             WHEN 'annually'    THEN INTERVAL '1 year'
                             ELSE INTERVAL '1 month'
                           END)::date;

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
    include_insurance, insurance_choice_made, next_due_date
  ) VALUES (
    v_new_id,
    v_frequency,
    v_amount,
    v_retirement_pct,
    v_emergency_pct,
    COALESCE((v_schedule ->> 'includeInsurance')::boolean, FALSE),
    COALESCE((p_payload ->> 'insuranceChoiceMade')::boolean, TRUE),
    v_next_due
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
        WHEN COALESCE((v_insurance_pol ->> 'cover')::numeric, 0) > 0 THEN 'active'
        ELSE 'inactive'
      END
    );
  END IF;

  -- NEW: extra (non-life) insurance products -> subscriber_insurance_products.
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
            WHEN COALESCE((v_ins_prod ->> 'cover')::numeric, 0) > 0 THEN 'active'
            ELSE 'inactive'
          END,
          now()
        )
        ON CONFLICT (subscriber_id, product) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

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

  RETURN v_new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._insert_subscriber_chain(jsonb, text, numeric, boolean) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Restore request_withdrawal to the 0054 body (SECURITY DEFINER).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_nonce            text,
  p_amount           numeric,
  p_bucket           text    DEFAULT NULL,   -- 'retirement' | 'emergency' | NULL
  p_reason           text    DEFAULT NULL,
  p_method           text    DEFAULT 'MTN Mobile Money',
  p_split_retirement numeric DEFAULT NULL,
  p_split_emergency  numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_subscriber_id text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_total_balance numeric;
  v_unit_price    numeric := 1000;            -- demo-scope (matches contribution trigger)
  v_split_ret     numeric := p_split_retirement;
  v_split_emg     numeric := p_split_emergency;
  v_ref           text;
  v_tx_id         text;
  v_wd_id         text;
  v_bucket        text;
  v_prior         jsonb;
  v_result        jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot request a withdrawal', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_subscriber_id IS NULL OR v_subscriber_id = '' THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency short-circuit: a replay of the same nonce returns the prior
  -- withdrawal row without re-debiting the balance.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  -- F-5: server-side "withdraw ≤ available balance" guard. Lock the balance row
  -- so a concurrent withdrawal can't over-draw past the check.
  SELECT total_balance INTO v_total_balance
    FROM public.subscriber_balances
   WHERE subscriber_id = v_subscriber_id
   FOR UPDATE;
  v_total_balance := COALESCE(v_total_balance, 0);

  IF p_amount > v_total_balance THEN
    RAISE EXCEPTION 'withdrawal of % exceeds available balance %', p_amount, v_total_balance
      USING ERRCODE = 'P0001';
  END IF;

  -- Resolve the split: explicit splits win; else a bucket routes the whole
  -- amount; else NULL (the trigger falls back to emergency-first). Mirrors the
  -- prior JS requestWithdrawal resolution.
  IF v_split_ret IS NULL AND v_split_emg IS NULL AND p_bucket IS NOT NULL THEN
    IF p_bucket = 'retirement' THEN
      v_split_ret := p_amount; v_split_emg := 0;
    ELSE
      v_split_ret := 0; v_split_emg := p_amount;
    END IF;
  END IF;

  -- F-5 (cont.): if both splits are supplied, they must sum to the amount so the
  -- per-bucket debits can't desync from the total (the trigger debits total by
  -- ABS(amount) but buckets by their own splits).
  IF v_split_ret IS NOT NULL AND v_split_emg IS NOT NULL
     AND (v_split_ret + v_split_emg) <> p_amount THEN
    RAISE EXCEPTION 'split_retirement + split_emergency (%) must equal amount %',
      v_split_ret + v_split_emg, p_amount USING ERRCODE = 'P0001';
  END IF;

  v_bucket := COALESCE(p_bucket, 'emergency');
  v_ref    := 'WD-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  v_tx_id  := 'tx-' || v_subscriber_id || '-wd-' || replace(gen_random_uuid()::text, '-', '');
  v_wd_id  := 'wd-' || v_subscriber_id || '-'    || replace(gen_random_uuid()::text, '-', '');

  -- 1. Ledger row → AFTER INSERT trigger debits subscriber_balances buckets.
  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, status, method,
    txn_ref, bucket, split_retirement, split_emergency, source
  ) VALUES (
    v_tx_id, v_subscriber_id, 'withdrawal', p_amount, now(), 'processing', p_method,
    v_ref, p_bucket, v_split_ret, v_split_emg, 'own'
  );

  -- F-3: decrement units, which the withdrawal trigger never touched, so
  -- units ≈ total_balance / 1000 holds after a runtime withdrawal. Floor at 0.
  UPDATE public.subscriber_balances
     SET units      = GREATEST(0, units - (p_amount / v_unit_price)),
         updated_at = now()
   WHERE subscriber_id = v_subscriber_id;

  -- 2. History row → the WithdrawalsHistory report consumes this (same txn).
  INSERT INTO public.withdrawals (
    id, subscriber_id, amount, bucket, reason, method, status, date, reference
  ) VALUES (
    v_wd_id, v_subscriber_id, p_amount, v_bucket, p_reason, p_method, 'processing',
    (now())::date, v_ref
  );

  -- Return shape matches mapWithdrawalRow's camelCase contract (the legacy
  -- requestWithdrawal return object).
  v_result := jsonb_build_object(
    'id',        v_wd_id,
    'amount',    p_amount,
    'bucket',    v_bucket,
    'reason',    p_reason,
    'method',    p_method,
    'status',    'processing',
    'date',      to_char(now(), 'YYYY-MM-DD'),
    'reference', v_ref
  );

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result)
    VALUES (p_nonce, v_subscriber_id, 'withdrawal', v_result)
    ON CONFLICT (nonce) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) TO authenticated;

-- -----------------------------------------------------------------------------
-- Drop the 6 columns (the column-level UPDATE REVOKE goes with them).
-- -----------------------------------------------------------------------------
ALTER TABLE public.contribution_schedules
  DROP COLUMN IF EXISTS last_indexed_at,
  DROP COLUMN IF EXISTS contribution_indexation_pct,
  DROP COLUMN IF EXISTS insurance_savings_pct,
  DROP COLUMN IF EXISTS insurance_premium_accrued,
  DROP COLUMN IF EXISTS insurance_premium_target,
  DROP COLUMN IF EXISTS insurance_funding_mode;

-- =============================================================================
-- End of 0072_insurance_save_to_cover.down.sql
-- =============================================================================
