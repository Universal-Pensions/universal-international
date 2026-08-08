-- =============================================================================
-- Universal Pensions Uganda — 0099: claims carry a PRODUCT, and hospital cash
--                                   is priced by the server
-- =============================================================================
-- WHY
-- `claims` has carried no product or policy reference since 0001. Its `type`
-- column holds an INCIDENT CATEGORY — 'medical' | 'accident' | 'hospitalization'
-- | 'critical_illness' — chosen years before the life / hospital-cash / funeral
-- catalogue existed. The consequences were visible in the UI: the claim form
-- offered four options that mapped to nothing a member actually holds, a member
-- with only funeral cover could file a "Critical illness" claim, and nothing
-- related the claimed amount to the cover.
--
-- THE PRODUCT RULE THIS ENCODES
--   * hospital cash ('health') is the ONLY product a living member can claim;
--   * life and funeral pay out BECAUSE the member has died, so only a nominee
--     can claim them — and a nominee has no account. That path is a public
--     intake form, not this table (see 0100_nominee_claims.sql).
--
-- WHY THE AMOUNT MOVES SERVER-SIDE
-- Hospital cash pays a flat nightly benefit: cover ÷ 20 nights. Under the old
-- `claims_insert_self` INSERT policy the client supplied `amount` directly, so a
-- member could POST any figure and the 20-night cap was decorative. This
-- migration replaces that policy with a SECURITY DEFINER RPC that derives the
-- amount from the member's own policy and enforces the cap against their claim
-- history. Same move as 0054 (subscriber money RPCs) and 0055 (commission rate).
--
-- ORDERING NOTE
-- 0096 adds `claims.expected_by` (payout SLA, DEFAULT submitted_date + 10) and
-- 0097's "delayed insurance payouts" signal reads it. This migration is
-- order-independent with respect to 0096: the RPC below names its columns and
-- deliberately OMITS expected_by, so it picks up 0096's DEFAULT if 0096 landed
-- first, and is backfilled by 0096's `UPDATE … WHERE expected_by IS NULL` if
-- 0096 lands second.
--
-- CONVENTIONS (CLAUDE.md §4/§5, BACKEND.md §7/§8/§9)
--   * RLS/RPC role checks read auth.jwt() ->> 'app_role', NEVER ->> 'role'.
--   * REVOKE ALL … FROM PUBLIC before GRANT (0094: a bare REVOKE FROM anon
--     against a default PUBLIC grant is a silent no-op).
--   * Idempotent throughout; reversed by 0099_claims_products.down.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS product        TEXT,
  ADD COLUMN IF NOT EXISTS discharge_date DATE,
  ADD COLUMN IF NOT EXISTS nights         INTEGER,
  ADD COLUMN IF NOT EXISTS provider       TEXT,
  ADD COLUMN IF NOT EXISTS daily_benefit  NUMERIC;

COMMENT ON COLUMN public.claims.product IS
  'life | health | funeral. THE discriminator from 0099 onward. Distinct from `type`, which is the legacy incident category.';
COMMENT ON COLUMN public.claims.incident_date IS
  'Admission date when product = health. Kept under its original name because every agent/admin listing already renders it as "Incident".';
COMMENT ON COLUMN public.claims.nights IS
  'Nights PAYABLE on this claim (already capped against the 20-night policy-year allowance) — not necessarily nights spent in hospital.';
COMMENT ON COLUMN public.claims.daily_benefit IS
  'cover / 20 at the moment of claim. Denormalised deliberately (cf. commissions.subscriber_name): the cover ladder is client-side, so a later downgrade or repricing would otherwise make an old claim''s amount unexplainable.';
COMMENT ON COLUMN public.claims.type IS
  'Legacy incident category on pre-0099 rows; a MIRROR of `product` on rows written after 0099. NOT NULL and intentionally unconstrained — it holds both vocabularies by design.';

-- `claims_insert_self` was the ONLY INSERT policy, so every existing row was
-- filed by a member, and the only product a member can claim is hospital cash.
UPDATE public.claims SET product = 'health' WHERE product IS NULL;

ALTER TABLE public.claims ALTER COLUMN product SET NOT NULL;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS — guard each with the 0027 idiom.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'claims_product_chk'
                    AND conrelid = 'public.claims'::regclass) THEN
    ALTER TABLE public.claims ADD CONSTRAINT claims_product_chk
      CHECK (product IN ('life', 'health', 'funeral'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'claims_nights_chk'
                    AND conrelid = 'public.claims'::regclass) THEN
    ALTER TABLE public.claims ADD CONSTRAINT claims_nights_chk
      CHECK (nights IS NULL OR nights > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'claims_discharge_after_admission_chk'
                    AND conrelid = 'public.claims'::regclass) THEN
    ALTER TABLE public.claims ADD CONSTRAINT claims_discharge_after_admission_chk
      CHECK (discharge_date IS NULL OR incident_date IS NULL OR discharge_date >= incident_date);
  END IF;
END $$;

-- Serves the policy-year allowance lookup in the RPC below
-- (subscriber_id + product + incident_date >= year start).
CREATE INDEX IF NOT EXISTS claims_subscriber_product_date_idx
  ON public.claims (subscriber_id, product, incident_date DESC);

-- -----------------------------------------------------------------------------
-- 2. The nightly-benefit divisor
-- -----------------------------------------------------------------------------
-- ⚠️ JS↔SQL PARITY OBLIGATION: mirrors HOSPITAL_CASH_DAYS in
-- src/constants/savings.js. Same contract as _normalize_contribution_config ↔
-- contributionModel.js — the two change in ONE commit or the client preview and
-- the stored amount silently disagree.
CREATE OR REPLACE FUNCTION public._hospital_cash_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$ SELECT 20 $$;

REVOKE ALL ON FUNCTION public._hospital_cash_days() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._hospital_cash_days() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. submit_hospital_cash_claim — the only writer of member claims
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_hospital_cash_claim(
  p_nonce           text,
  p_admission_date  date,
  p_discharge_date  date,
  p_provider        text,
  p_description     text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role       text := (SELECT auth.jwt()) ->> 'app_role';
  v_sub        text := (SELECT auth.jwt()) ->> 'subscriberId';
  -- Wall clock, not _demo_now(): a claim is about what happened to a real
  -- person on a real date. Same call 0096 makes for its SLA signals.
  v_today      date := CURRENT_DATE;
  v_days       int  := public._hospital_cash_days();
  v_prior      jsonb;
  v_cover      numeric;
  v_renewal    date;
  v_start      date;
  v_year_start date;
  v_nights     int;
  v_used       int;
  v_payable    int;
  v_daily      numeric;
  v_amount     numeric;
  v_id         text;
  v_result     jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot file a claim', COALESCE(v_role, '(none)')
      USING ERRCODE = 'P0001';
  END IF;
  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: a double-tap or a retried request must not open two claims.
  SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
  IF FOUND THEN RETURN v_prior; END IF;

  -- The member's own active hospital-cash policy. FOR UPDATE serialises
  -- concurrent filings so two in-flight claims cannot both pass the cap check.
  -- funded_by is deliberately NOT filtered: 0068 blocks re-BUYING employer-paid
  -- cover, it does not stop the member claiming on it.
  SELECT cover, renewal_date, policy_start
    INTO v_cover, v_renewal, v_start
    FROM public.subscriber_insurance_products
   WHERE subscriber_id = v_sub
     AND product = 'health'
     AND status = 'active'
     AND cover > 0
     AND (renewal_date IS NULL OR renewal_date >= v_today)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active hospital cash cover' USING ERRCODE = 'P0002';
  END IF;

  IF p_admission_date IS NULL OR p_discharge_date IS NULL
     OR p_admission_date > v_today OR p_discharge_date > v_today THEN
    RAISE EXCEPTION 'admission and discharge must be real dates, not in the future'
      USING ERRCODE = 'P0003';
  END IF;

  v_nights := p_discharge_date - p_admission_date;
  IF v_nights < 1 THEN
    RAISE EXCEPTION 'hospital cash pays per night — discharge must be after admission'
      USING ERRCODE = 'P0003';
  END IF;

  -- renewal_date is the END of the current policy year (utils/policies.js pushes
  -- it forward a year on renewal), so the year opened one year before it. Both
  -- fallbacks only ever WIDEN the window, and a wider window sums MORE prior
  -- nights — so a missing date can never let a member claim beyond their 20.
  v_year_start := COALESCE((v_renewal - INTERVAL '1 year')::date,
                           v_start,
                           (v_today - INTERVAL '1 year')::date);

  IF p_admission_date < v_year_start THEN
    RAISE EXCEPTION 'admission predates the current policy year' USING ERRCODE = 'P0003';
  END IF;

  -- Nights already committed this policy year. 'rejected' is excluded; anything
  -- still under review is NOT — it is allowance we have committed to look at,
  -- and treating it as free would let a member file 20 nights twice while the
  -- first sits pending. Keyed on ADMISSION date so a late filing cannot reopen
  -- last year's allowance.
  SELECT COALESCE(SUM(nights), 0) INTO v_used
    FROM public.claims
   WHERE subscriber_id = v_sub
     AND product = 'health'
     AND status <> 'rejected'
     AND incident_date >= v_year_start;

  v_payable := LEAST(v_nights, GREATEST(0, v_days - v_used));
  IF v_payable < 1 THEN
    RAISE EXCEPTION 'the % covered nights for this policy year are already used up', v_days
      USING ERRCODE = 'P0004';
  END IF;

  v_daily  := round(v_cover / v_days);
  v_amount := v_payable * v_daily;
  v_id     := 'clm-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.claims (
    id, subscriber_id, type, product, status, amount,
    incident_date, discharge_date, nights, provider, daily_benefit,
    submitted_date, description
  ) VALUES (
    v_id, v_sub, 'health', 'health', 'submitted', v_amount,
    p_admission_date, p_discharge_date, v_payable,
    NULLIF(left(btrim(COALESCE(p_provider, '')), 160), ''), v_daily,
    v_today, left(btrim(COALESCE(p_description, '')), 2000)
  );
  -- expected_by deliberately omitted so 0096's DEFAULT applies (see header).

  v_result := jsonb_build_object(
    'id',            v_id,
    'subscriberId',  v_sub,
    'type',          'health',
    'product',       'health',
    'status',        'submitted',
    'amount',        v_amount,
    'incidentDate',  p_admission_date,
    'dischargeDate', p_discharge_date,
    'nights',        v_payable,
    'provider',      NULLIF(left(btrim(COALESCE(p_provider, '')), 160), ''),
    'dailyBenefit',  v_daily,
    'submittedDate', v_today,
    'description',   left(btrim(COALESCE(p_description, '')), 2000)
  );

  INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result)
  VALUES (p_nonce, v_sub, 'claim', v_result)
  ON CONFLICT (nonce) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_hospital_cash_claim(text, date, date, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_hospital_cash_claim(text, date, date, text, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Close the direct-insert lane
-- -----------------------------------------------------------------------------
-- With claims_insert_self in place a client can POST any `amount` straight to
-- PostgREST, which makes the nightly rate and the 20-night cap above purely
-- decorative. The RPC is now the only writer. Mirrors 0072 §1f's column REVOKE
-- on contribution_schedules. Restored by the .down.sql.
DROP POLICY IF EXISTS claims_insert_self ON public.claims;
