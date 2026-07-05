-- =============================================================================
-- Universal Pensions Uganda — 0072: insurance "save-to-cover" + contribution
--   indexation (schema + accrual/sweep trigger + chain + withdrawal clawback).
-- =============================================================================
-- WHY: subscribers can now fund insurance in two ways at onboarding —
--   * Route A "pay_now"      — pay the combined ANNUAL premium up front; the
--     policy activates immediately.
--   * Route B "save_to_cover" — save gradually; every OWN-money contribution's
--     emergency slice accrues toward the combined annual premium, and once the
--     accrual reaches the target (and the money is actually in the emergency
--     bucket) the trigger sweeps it, activating the "building" policies.
--   Plus an optional yearly "step-up" (contribution_indexation_pct 0..15) that
--   lazily bumps the schedule amount once per anniversary.
--
-- This migration is money-critical. Every function below is a byte-faithful
-- CREATE OR REPLACE of its CURRENT live body with a surgical insertion, and
-- each keeps its ORIGINAL per-function security context (do NOT blanket-copy):
--   * trg_transactions_contribution → SECURITY DEFINER  (base 0043:157-262)
--   * _insert_subscriber_chain      → SECURITY INVOKER   (base 0065:57-286)
--       ^ MUST stay INVOKER + inline search_path — DEFINER here is the exact
--         0042→0052 function_search_path_mutable regression.
--   * request_withdrawal            → SECURITY DEFINER  (base 0054:180-313)
--
-- SCHEMA FACTS VERIFIED before writing (0001 + later ALTERs):
--   * transactions.type   — TEXT, NO CHECK, NOT an enum → 'premium_sweep' is a
--     clean new type (no ALTER). type='premium_sweep' fires NEITHER the
--     contribution (WHEN type='contribution') nor the withdrawal
--     (WHEN type='withdrawal') trigger → no recursion.
--   * transactions.amount — NUMERIC NOT NULL, NO `amount >= 0` CHECK → the
--     sweep row is stored NEGATIVE (amount = -target) so the sign-bucketing
--     feeds read it as an outflow without touching mapTransactionRow.
--   * transactions.source — CHECK IN ('own','employer') (0043:47) → the sweep
--     uses source='own' (NOT a new source value).
--   * insurance_policies.status / subscriber_insurance_products.status — TEXT,
--     NO CHECK → 'building' is a clean free-text add.
--   * insurance_policies.funded_by / subscriber_insurance_products.funded_by —
--     TEXT NOT NULL DEFAULT 'self' (0067) → accrual/sweep scope funded_by='self'
--     so the EMPLOYER-funded branch is never touched.
--
-- POST-APPLY CHECK (§1h): run get_advisors('security') and confirm NO
--   function_search_path_mutable hit on _insert_subscriber_chain (it must remain
--   INVOKER + inline search_path). Forward-only; reversible via the .down.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a) contribution_schedules — additive, all defaulted (1:1 with subscriber).
-- -----------------------------------------------------------------------------
ALTER TABLE public.contribution_schedules
  ADD COLUMN IF NOT EXISTS insurance_funding_mode      TEXT    NOT NULL DEFAULT 'pay_now',   -- 'pay_now' | 'save_to_cover'
  ADD COLUMN IF NOT EXISTS insurance_premium_target    NUMERIC NOT NULL DEFAULT 0,           -- combined ANNUAL premium of building products
  ADD COLUMN IF NOT EXISTS insurance_premium_accrued   NUMERIC NOT NULL DEFAULT 0,           -- accrued so far toward the target
  ADD COLUMN IF NOT EXISTS insurance_savings_pct       NUMERIC NOT NULL DEFAULT 100,         -- % of each emergency slice redirected to build cover (0..100); rest stays liquid
  ADD COLUMN IF NOT EXISTS contribution_indexation_pct NUMERIC NOT NULL DEFAULT 0,           -- 0..15 yearly step-up
  ADD COLUMN IF NOT EXISTS last_indexed_at             TIMESTAMPTZ;                            -- indexation anniversary marker (NULL = never bumped)

COMMENT ON COLUMN public.contribution_schedules.insurance_funding_mode IS
  '''pay_now'' = annual premium charged up front; ''save_to_cover'' = accrue the '
  'emergency slice of each own-money contribution until it funds the annual '
  'premium, then sweep + activate (0072).';
COMMENT ON COLUMN public.contribution_schedules.insurance_premium_target IS
  'Combined ANNUAL premium (premium_monthly * 12) of the subscriber''s non-active '
  'self-funded policies; recomputed by trg_transactions_contribution (0072).';
COMMENT ON COLUMN public.contribution_schedules.contribution_indexation_pct IS
  'Optional yearly step-up (0..15). The contribution trigger lazily bumps '
  'contribution_schedules.amount once per anniversary (0072).';

-- -----------------------------------------------------------------------------
-- 1c) trg_transactions_contribution — CREATE OR REPLACE (base = 0043:157-262).
--     BYTE-FAITHFUL to 0043; the ONLY change is the save-to-cover accrual/sweep
--     + lazy-renewal + lazy-indexation block inserted AFTER the balance upsert
--     and BEFORE the commission block. Keeps SECURITY DEFINER + search_path.
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
  -- 0072 additions (save-to-cover accrual/sweep + lazy indexation):
  v_sched            public.contribution_schedules%ROWTYPE;
  v_target           NUMERIC;
  v_new_accrued      NUMERIC;
  v_emg_bal          NUMERIC;
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

  -- ── 0072: save-to-cover accrual + lazy renewal + lazy indexation ──────────
  -- [M4] Own-money legs only — the employer co-contribution (source='employer')
  -- and the employer group insurance leg never accrue toward a self policy.
  IF NEW.source = 'own' THEN
    SELECT * INTO v_sched FROM public.contribution_schedules
      WHERE subscriber_id = NEW.subscriber_id FOR UPDATE;   -- lock the 1:1 row

    IF v_sched.insurance_funding_mode = 'save_to_cover' THEN

      -- [M1] LAZY RENEWAL (no pg_cron): any active SELF policy whose renewal_date
      -- has passed flips back to 'building' so it re-accrues. Flip BOTH tables.
      UPDATE public.insurance_policies
         SET status = 'building'
       WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self'
         AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;
      UPDATE public.subscriber_insurance_products
         SET status = 'building', updated_at = now()
       WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self'
         AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;

      -- [M8] Recompute target = SUM(annual premium of every NON-active self
      -- policy). annual = premium_monthly * 12 (the app's single annual anchor).
      SELECT COALESCE(SUM(premium_monthly * 12), 0) INTO v_target
        FROM ( SELECT premium_monthly FROM public.insurance_policies
                 WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status <> 'active'
               UNION ALL
               SELECT premium_monthly FROM public.subscriber_insurance_products
                 WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status <> 'active' ) q;

      IF v_target > 0 THEN
        -- Accrue the ASSIGNED SHARE of this contribution's emergency slice toward
        -- cover (insurance_savings_pct; the rest stays liquid/withdrawable), CAPPED
        -- at target ([L1] any excess simply stays in emergency_balance — never lost).
        v_new_accrued := LEAST(
          v_target,
          v_sched.insurance_premium_accrued
            + v_emergency_share * (COALESCE(v_sched.insurance_savings_pct, 100) / 100.0));

        -- Read the emergency balance we just credited above.
        SELECT emergency_balance INTO v_emg_bal
          FROM public.subscriber_balances WHERE subscriber_id = NEW.subscriber_id;

        -- [H3] SWEEP GUARD: accrued reached target AND the money is actually there.
        IF v_new_accrued >= v_target AND v_emg_bal >= v_target THEN
          -- Debit buckets by the ANNUAL target. Units by target/1000 ([H1]) —
          -- NEVER by target — so units == total_balance/1000 stays EXACT
          -- (units are credited un-rounded above; do not round here).
          UPDATE public.subscriber_balances
             SET emergency_balance = emergency_balance - v_target,
                 total_balance     = total_balance     - v_target,
                 units             = units - (v_target / v_unit_price),   -- v_unit_price = 1000
                 updated_at        = now()
           WHERE subscriber_id = NEW.subscriber_id;

          -- Internal, non-recursive marker row. amount = -target (NEGATIVE).
          -- type='premium_sweep' matches neither trigger's WHEN clause.
          INSERT INTO public.transactions
            (id, subscriber_id, type, amount, date, status, method, txn_ref, source)
          VALUES ('tx-' || NEW.subscriber_id || '-sweep-' || replace(gen_random_uuid()::text, '-', ''),
                  NEW.subscriber_id, 'premium_sweep', -v_target, now(), 'settled',
                  'internal', 'SW-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0'), 'own');

          -- Activate the building policies (BOTH tables) + reset accrued/target.
          UPDATE public.insurance_policies
             SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date
           WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status = 'building';
          UPDATE public.subscriber_insurance_products
             SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date, updated_at = now()
           WHERE subscriber_id = NEW.subscriber_id AND funded_by = 'self' AND status = 'building';

          UPDATE public.contribution_schedules
             SET insurance_premium_target = 0, insurance_premium_accrued = 0, updated_at = now()
           WHERE subscriber_id = NEW.subscriber_id;
        ELSE
          -- Not yet — persist the accrual + the refreshed target.
          UPDATE public.contribution_schedules
             SET insurance_premium_accrued = v_new_accrued, insurance_premium_target = v_target, updated_at = now()
           WHERE subscriber_id = NEW.subscriber_id;
        END IF;
      END IF;
    END IF;

    -- [rev] LAZY INDEXATION (independent of insurance): bump the schedule amount
    -- once per anniversary year. Same no-pg_cron pattern. v_sched is the pre-
    -- update snapshot, so the pct/marker read here are the original values.
    IF v_sched.contribution_indexation_pct > 0
       AND (v_sched.last_indexed_at IS NULL OR now() >= v_sched.last_indexed_at + INTERVAL '1 year') THEN
      UPDATE public.contribution_schedules
         SET amount = ROUND(amount * (1 + contribution_indexation_pct / 100.0)),
             last_indexed_at = now(), updated_at = now()
       WHERE subscriber_id = NEW.subscriber_id;
    END IF;
  END IF;
  -- ── end 0072 block ────────────────────────────────────────────────────────

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

-- Re-bind idempotently (matches the 0002/0042/0043 DROP/CREATE shape).
DROP TRIGGER IF EXISTS transactions_after_insert_contribution ON public.transactions;
CREATE TRIGGER transactions_after_insert_contribution
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  WHEN (NEW.type = 'contribution')
  EXECUTE FUNCTION public.trg_transactions_contribution();

-- -----------------------------------------------------------------------------
-- 1d) _insert_subscriber_chain — CREATE OR REPLACE (base = 0065:57-286).
--     BYTE-FAITHFUL to 0065; changes: read the 3 funding fields; write the 5 new
--     schedule columns; force policy/product status='building' when
--     save_to_cover; post an annual type='premium' row for pay_now w/ products.
--     KEEPS SECURITY INVOKER + inline SET search_path (do NOT make DEFINER).
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
REVOKE ALL ON FUNCTION public._insert_subscriber_chain(jsonb, text, numeric, boolean) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 1e) request_withdrawal — CREATE OR REPLACE (base = 0054:180-313).
--     BYTE-FAITHFUL to 0054; the ONLY change is the [H3] accrued clawback after
--     the units decrement so a withdrawal can't strand accrued >= target while
--     emergency_balance < target. Keeps SECURITY DEFINER + search_path.
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

  -- 0072 [H3]: clawback accrued so a withdrawal can't strand accrued >= target
  -- while emergency_balance < target (which would let the next contribution
  -- sweep money that is no longer in the bucket). Clamp accrued to what remains
  -- in the emergency bucket AFTER this withdrawal debited it above.
  UPDATE public.contribution_schedules
     SET insurance_premium_accrued = LEAST(
           insurance_premium_accrued,
           GREATEST(0, (SELECT emergency_balance FROM public.subscriber_balances
                          WHERE subscriber_id = v_subscriber_id))),
         updated_at = now()
   WHERE subscriber_id = v_subscriber_id
     AND insurance_funding_mode = 'save_to_cover';

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
-- 1f) Column-level REVOKE — lock the money columns so a subscriber can't PATCH
--     them directly (the client PATCHes contribution_schedules; the only UPDATE
--     policy scopes by row, NOT by column). These move ONLY via the DEFINER
--     trigger / the INVOKER chain running under the DEFINER parent RPC's owner.
--     contribution_indexation_pct is intentionally LEFT editable (a user choice).
-- -----------------------------------------------------------------------------
REVOKE UPDATE (insurance_funding_mode, insurance_premium_target, insurance_premium_accrued, last_indexed_at)
  ON public.contribution_schedules FROM authenticated, anon;

-- =============================================================================
-- End of 0072_insurance_save_to_cover.sql
-- Reversible via 0072_insurance_save_to_cover.down.sql (drops the 5 columns +
-- restores the 3 ORIGINAL function bodies with their ORIGINAL security context).
-- =============================================================================
