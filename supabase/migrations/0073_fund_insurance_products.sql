-- =============================================================================
-- Universal Pensions Uganda — 0073: post-signup insurance funding RPC.
-- =============================================================================
-- WHY: migration 0072 gave subscribers the annual-premium "save-to-cover" model,
--   but ONLY at onboarding (the SECURITY INVOKER `_insert_subscriber_chain`).
--   Post-signup, the schedule page had NO way to (a) start a NEW policy on the
--   annual model, or (b) put the schedule into 'save_to_cover' — because 0072
--   column-REVOKEs `insurance_funding_mode` / `insurance_premium_target` /
--   `insurance_premium_accrued` from the client, and `pay_insurance_premium`
--   (0063/0068) only ever creates an 'active' policy priced MONTHLY.
--
--   This adds ONE SECURITY DEFINER RPC — `fund_insurance_products` — that the
--   subscriber schedule editor calls to fund newly-chosen cover in either route:
--     * Route A "pay_now"      — activate each product NOW (store the true
--       premium_monthly) and charge the combined ANNUAL premium as a single
--       type='premium' row. Leaves the schedule's building state untouched.
--     * Route B "save_to_cover" — create each product as 'building', set the
--       schedule to save_to_cover + the savings split, and recompute the target
--       from all non-active self policies (the SAME anchor the 0072 accrual
--       trigger uses). Charges NOTHING now; the trigger sweeps from savings later.
--
-- This function is money-adjacent. Invariants it preserves (verified vs live):
--   * type='premium' rows fire NEITHER balance trigger (WHEN type='contribution'
--     / 'withdrawal') → cover charges never touch balances/units/AUM (0063 rule).
--   * The DEFINER context sets the 0072-REVOKE'd schedule columns as the table
--     owner — the ONLY correct way to move them post-signup (CLAUDE.md §7.3).
--   * funded_by='self' on every write; the employer-funded ACTIVE branch is
--     guarded exactly as pay_insurance_premium does (never overwrite group cover).
--   * Idempotent on the client `nonce` (money_nonces, kind='insurance_funding')
--     so a double-tap can't double-charge or duplicate a build.
--   * Route B's target = SUM(premium_monthly * 12) of non-active self policies,
--     byte-identical to the 0072 trigger's recompute → no target drift on the
--     next contribution.
--
-- CALLER CONTRACT: p_products carries ONLY the products being newly funded
--   (the client de-dups already-held active/building cover), so an upsert never
--   downgrades a paid 'active' policy back to 'building'.
--
-- Forward-only; reversible via 0073_fund_insurance_products.down.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fund_insurance_products(
  p_nonce        text,
  p_funding_mode text,                                   -- 'pay_now' | 'save_to_cover'
  p_products     jsonb,                                  -- [{product, cover, premiumMonthly}]
  p_savings_pct  numeric DEFAULT 100,                    -- % of the emergency slice that builds cover (Route B)
  p_method       text    DEFAULT 'MTN Mobile Money'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_subscriber_id text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_renewal       date := (now() + interval '1 year')::date;
  v_prior         jsonb;
  v_result        jsonb;
  v_prod          jsonb;
  v_pid           text;
  v_cover         numeric;
  v_premium       numeric;                               -- monthly premium (stored as-is)
  v_annual_total  numeric := 0;                          -- Σ(premium_monthly * 12) of the passed products
  v_new_status    text;
  v_ref           text;
  v_tx_id         text;
  v_target        numeric;
  v_savings       numeric;
BEGIN
  -- Role guard — subscriber-only, self-scoped by JWT (mirrors pay_insurance_premium).
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot fund insurance', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_subscriber_id IS NULL OR v_subscriber_id = '' THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;
  IF p_funding_mode IS NULL OR p_funding_mode NOT IN ('pay_now', 'save_to_cover') THEN
    RAISE EXCEPTION 'unknown funding mode %', p_funding_mode USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency short-circuit: a replay of the same nonce returns the prior
  -- result WITHOUT re-charging / re-writing.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  v_new_status := CASE WHEN p_funding_mode = 'save_to_cover' THEN 'building' ELSE 'active' END;
  v_savings    := GREATEST(0, LEAST(100, COALESCE(p_savings_pct, 100)));

  -- Upsert each newly-funded product. p_products may be empty (a funding-only
  -- update, e.g. changing just the savings split on an existing build).
  IF jsonb_typeof(p_products) = 'array' THEN
    FOR v_prod IN SELECT jsonb_array_elements(p_products) LOOP
      v_pid     := v_prod ->> 'product';
      v_cover   := COALESCE((v_prod ->> 'cover')::numeric, 0);
      v_premium := COALESCE((v_prod ->> 'premiumMonthly')::numeric, 0);   -- TRUE monthly, stored as-is

      IF v_pid IS NULL OR v_pid NOT IN ('health', 'funeral', 'life') THEN
        RAISE EXCEPTION 'unknown insurance product %', v_pid USING ERRCODE = 'P0001';
      END IF;
      IF v_premium < 0 OR v_cover < 0 THEN
        RAISE EXCEPTION 'cover and premium must be non-negative' USING ERRCODE = 'P0001';
      END IF;

      IF v_pid = 'life' THEN
        -- Never overwrite employer-paid group life (same guard as 0068).
        IF EXISTS (
          SELECT 1 FROM public.insurance_policies
           WHERE subscriber_id = v_subscriber_id AND funded_by = 'employer' AND status = 'active'
        ) THEN
          RAISE EXCEPTION 'life cover is provided and paid for by your employer' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.insurance_policies (
          subscriber_id, cover, premium_monthly, policy_start, renewal_date, status, funded_by, updated_at
        ) VALUES (
          v_subscriber_id, v_cover, v_premium, now()::date, v_renewal, v_new_status, 'self', now()
        )
        ON CONFLICT (subscriber_id) DO UPDATE SET
          cover = EXCLUDED.cover, premium_monthly = EXCLUDED.premium_monthly,
          policy_start = EXCLUDED.policy_start, renewal_date = EXCLUDED.renewal_date,
          status = EXCLUDED.status, funded_by = 'self', updated_at = now();
      ELSE
        IF EXISTS (
          SELECT 1 FROM public.subscriber_insurance_products
           WHERE subscriber_id = v_subscriber_id AND product = v_pid AND funded_by = 'employer' AND status = 'active'
        ) THEN
          RAISE EXCEPTION '% cover is provided and paid for by your employer', v_pid USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.subscriber_insurance_products (
          subscriber_id, product, cover, premium_monthly, policy_start, renewal_date, status, funded_by, updated_at
        ) VALUES (
          v_subscriber_id, v_pid, v_cover, v_premium, now()::date, v_renewal, v_new_status, 'self', now()
        )
        ON CONFLICT (subscriber_id, product) DO UPDATE SET
          cover = EXCLUDED.cover, premium_monthly = EXCLUDED.premium_monthly,
          policy_start = EXCLUDED.policy_start, renewal_date = EXCLUDED.renewal_date,
          status = EXCLUDED.status, funded_by = 'self', updated_at = now();
      END IF;

      v_annual_total := v_annual_total + (v_premium * 12);
    END LOOP;
  END IF;

  IF p_funding_mode = 'pay_now' THEN
    -- Route A: activate now + charge the combined ANNUAL premium as ONE ledger
    -- row (type='premium' fires no balance trigger). Only when there's a charge.
    -- The schedule's building state is left untouched, so any concurrently
    -- building policies keep accruing under their existing save_to_cover mode.
    IF v_annual_total > 0 THEN
      v_ref   := 'PR-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
      v_tx_id := 'tx-' || v_subscriber_id || '-prem-' || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO public.transactions (
        id, subscriber_id, type, amount, date, status, method, txn_ref, source
      ) VALUES (
        v_tx_id, v_subscriber_id, 'premium', v_annual_total, now(), 'settled', p_method, v_ref, 'own'
      );
    END IF;
  ELSE
    -- Route B: put the schedule into save_to_cover, set the savings split, and
    -- recompute the target from ALL non-active self policies (the anchor the 0072
    -- accrual trigger uses — kept byte-identical so the next contribution reads
    -- the same target). Accrued is left as-is: switching mid-build keeps progress.
    SELECT COALESCE(SUM(premium_monthly * 12), 0) INTO v_target
      FROM ( SELECT premium_monthly FROM public.insurance_policies
               WHERE subscriber_id = v_subscriber_id AND funded_by = 'self' AND status <> 'active'
             UNION ALL
             SELECT premium_monthly FROM public.subscriber_insurance_products
               WHERE subscriber_id = v_subscriber_id AND funded_by = 'self' AND status <> 'active' ) q;

    UPDATE public.contribution_schedules
       SET insurance_funding_mode   = 'save_to_cover',
           insurance_premium_target = v_target,
           insurance_savings_pct    = v_savings,
           updated_at               = now()
     WHERE subscriber_id = v_subscriber_id;
  END IF;

  v_result := jsonb_build_object(
    'fundingMode', p_funding_mode,
    'annualTotal', v_annual_total,
    'charged',     CASE WHEN p_funding_mode = 'pay_now' THEN v_annual_total ELSE 0 END,
    'status',      v_new_status,
    'reference',   v_ref,
    'method',      p_method,
    'date',        to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result)
    VALUES (p_nonce, v_subscriber_id, 'insurance_funding', v_result)
    ON CONFLICT (nonce) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fund_insurance_products(text, text, jsonb, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fund_insurance_products(text, text, jsonb, numeric, text) TO authenticated;

-- =============================================================================
-- End of 0073_fund_insurance_products.sql
-- =============================================================================
