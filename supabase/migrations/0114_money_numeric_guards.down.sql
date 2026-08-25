-- 0114_money_numeric_guards.down.sql
-- =============================================================================
-- DOWN for 0114_money_numeric_guards.sql
--
-- ⚠️ THIS RESTORES THE NaN HOLE. After running it, any authenticated subscriber
--    can call make_contribution with 'NaN' and take that member's balance, the
--    branch and distributor rollups and platform AUM to NaN, irrecoverably.
--    Only run it to unblock something worse.
--
-- The three function bodies below were captured VERBATIM from the LIVE database
-- on 2026-08-25 with
--     select pg_get_functiondef('public.<fn>(<args>)'::regprocedure);
-- and are pasted unedited. They were NOT retyped from an older migration file:
-- re-emitting a money function from a stale copy is exactly how 0095 silently
-- un-shipped 0090's login identity, and how four down-migrations still revert
-- NAV pricing (A04-006, A05-009).
--
-- ORDER MATTERS. The transactions sign CHECK has to go before the signs are put
-- back, or the restore violates the constraint it is undoing.
-- =============================================================================
--
-- ⚠️⚠️ THIS FILE ALSO UN-SHIPS 0115, SILENTLY. ⚠️⚠️
-- The three bodies below were captured from live BEFORE 0115 was applied, so
-- they contain ZERO `pg_advisory_xact_lock` calls. 0115 later rewrote all three
-- of these same RPCs to claim the nonce BEFORE moving money (A04-011, the
-- double-tap double-spend). Running this down against today's database restores
-- the pre-0115 bodies over the top and deletes that fix — while leaving 0115's
-- indexes and trigger in place, so nothing errors and nothing looks wrong.
--
-- That is precisely the failure mode this header already warns about two
-- paragraphs up: 0095 silently un-shipping 0090. The warning was written about
-- OTHER people's migrations and then reproduced here.
--
-- The guard below refuses to run while 0115 is live. To genuinely revert 0114:
-- revert 0115 first (`0115_money_idempotency.down.sql`, which correctly
-- PRESERVES 0114's assert_finite_money calls), then run this.
-- =============================================================================

DO $$
DECLARE v_locked INT;
BEGIN
  SELECT count(*) INTO v_locked
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('make_contribution', 'request_withdrawal', 'submit_employer_contribution_run')
     AND pg_get_functiondef(p.oid) LIKE '%pg_advisory_xact_lock%';

  IF v_locked > 0 THEN
    RAISE EXCEPTION
      'ABORT: % money RPC(s) live carry 0115''s advisory-lock nonce claim. The bodies in this file predate 0115 and would silently delete it (A04-011, double-tap double-spend), leaving 0115''s indexes and trigger in place so nothing errors. Run 0115_money_idempotency.down.sql FIRST, then re-run this.',
      v_locked USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'pre-flight OK — 0115 is not live, safe to restore the pre-0114 bodies.';
END $$;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Constraints and the deferred bucket-units trigger.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS subscriber_balances_bucket_units_sum ON public.subscriber_balances;
DROP FUNCTION IF EXISTS public.trg_subscriber_balances_bucket_units();

ALTER TABLE public.subscriber_balances DROP CONSTRAINT IF EXISTS subscriber_balances_amounts_chk;
ALTER TABLE public.subscriber_balances DROP CONSTRAINT IF EXISTS subscriber_balances_bucket_units_chk;
ALTER TABLE public.subscriber_balances DROP CONSTRAINT IF EXISTS subscriber_balances_bucket_sum_chk;
ALTER TABLE public.nav_snapshots       DROP CONSTRAINT IF EXISTS nav_snapshots_unit_price_finite_chk;
ALTER TABLE public.transactions        DROP CONSTRAINT IF EXISTS transactions_withdrawal_sign_chk;

-- ---------------------------------------------------------------------------
-- 2. A04-013 sign flip — put back exactly the rows 0114 flipped, by id.
--    Predicate-based restoration is impossible here: once flipped, those rows
--    are indistinguishable from the 5,402 legitimately negative ones. The
--    ledger table is the only record of which they were.
-- ---------------------------------------------------------------------------
DO $restore$
DECLARE v_n int := 0;
BEGIN
  IF to_regclass('public.transactions_wd_sign_fix_20260825') IS NULL THEN
    RAISE NOTICE 'No sign-flip ledger table; nothing to restore.';
    RETURN;
  END IF;

  UPDATE public.transactions t
     SET amount = f.amount_before
    FROM public.transactions_wd_sign_fix_20260825 f
   WHERE t.id = f.id
     AND t.amount = -f.amount_before;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Restored % withdrawal row(s) to their original sign.', v_n;
END
$restore$;

DROP TABLE IF EXISTS public.transactions_wd_sign_fix_20260825;

-- ---------------------------------------------------------------------------
-- 3. The three RPCs, restored byte-for-byte from the live bodies captured
--    2026-08-25 (pg_get_functiondef). Do not edit these.
-- ---------------------------------------------------------------------------

-- ── make_contribution ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.make_contribution(p_nonce text, p_amount numeric, p_retirement_pct numeric DEFAULT 80, p_method text DEFAULT 'MTN Mobile Money'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_subscriber_id text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_ret_pct       numeric;
  v_retirement    numeric;
  v_emergency     numeric;
  v_ref           text;
  v_tx_id         text;
  v_prior         jsonb;
  v_result        jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot make a contribution', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_subscriber_id IS NULL OR v_subscriber_id = '' THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  v_ret_pct := COALESCE(p_retirement_pct, 80);
  IF v_ret_pct < 0 OR v_ret_pct > 100 THEN
    v_ret_pct := 80;
  END IF;
  v_retirement := round(p_amount * v_ret_pct / 100);
  v_emergency  := p_amount - v_retirement;

  v_ref   := 'CT-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  v_tx_id := 'tx-' || v_subscriber_id || '-adhoc-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, status, method,
    txn_ref, split_retirement, split_emergency, source
  ) VALUES (
    v_tx_id, v_subscriber_id, 'contribution', p_amount, now(), 'settled', p_method,
    v_ref, v_retirement, v_emergency, 'own'
  );

  v_result := jsonb_build_object(
    'id',              v_tx_id,
    'subscriberId',    v_subscriber_id,
    'type',            'contribution',
    'source',          'own',
    'amount',          p_amount,
    'date',            to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'status',          'settled',
    'method',          p_method,
    'reference',       v_ref,
    'splitRetirement', v_retirement,
    'splitEmergency',  v_emergency
  );

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result)
    VALUES (p_nonce, v_subscriber_id, 'contribution', v_result)
    ON CONFLICT (nonce) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$function$

;

-- ── submit_employer_contribution_run ───────────────────────────────────────
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
           COALESCE(s.compensation, 0)        AS compensation
      FROM public.subscribers s
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

    v_funded := false;

    IF COALESCE(v_employee_leg, 0) > 0 THEN
      -- 0102: wholly to retirement. See the header note.
      v_retirement := v_employee_leg;
      v_emergency  := 0;
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
      -- 0102: wholly to retirement. See the header note.
      v_retirement := v_employer_leg;
      v_emergency  := 0;
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
$function$

;

-- ── request_withdrawal ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_nonce text, p_amount numeric, p_bucket text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_method text DEFAULT 'MTN Mobile Money'::text, p_split_retirement numeric DEFAULT NULL::numeric, p_split_emergency numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_subscriber_id text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_total_balance numeric;
  v_unit_price    numeric;                    -- 0104: the fund NAV in force today
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

  -- 0104: redeem at the fund NAV, not a hardcoded 1,000.
  v_unit_price := public.latest_nav();

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

  -- F-3: decrement units, which the withdrawal trigger still never touches, so
  -- units × NAV ≈ total_balance holds after a runtime withdrawal. Floor at 0.
  -- 0104: redeem units at the NAV and drop the SAME FRACTION of cost basis
  -- (average-cost). Because the fraction of units removed equals the fraction
  -- of basis removed, growth% is INVARIANT to withdrawals — reducing basis by
  -- simple net cash-in instead yields -233% outliers for heavy withdrawers.
  -- Every SET right-hand side reads the PRE-UPDATE row, so `units` below is
  -- the holding before this redemption.
  UPDATE public.subscriber_balances
     SET units      = GREATEST(0, units - LEAST(p_amount / v_unit_price, units)),
         invested   = CASE WHEN units > 0
                        THEN GREATEST(0, invested * (1 - LEAST(p_amount / v_unit_price, units) / units))
                        ELSE 0 END,
         nav_as_of  = CURRENT_DATE,
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

  -- 0104: re-derive bucket units from the bucket balances the withdrawal
  -- trigger has just debited. Deliberately NOT split from v_split_ret/v_split_emg
  -- — both are NULL in the common case and this function does not implement the
  -- trigger's emergency-first fallback, so deriving is the only way the two
  -- cannot drift.
  PERFORM public._resync_bucket_units(v_subscriber_id);

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
$function$

;

-- ---------------------------------------------------------------------------
-- 4. The shared guard itself.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.assert_finite_money(numeric, text, numeric, numeric, boolean);

-- ---------------------------------------------------------------------------
-- 5. Grants, as they were on live 2026-08-25.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.make_contribution(text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.make_contribution(text, numeric, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_employer_contribution_run(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_employer_contribution_run(text, text, text) TO authenticated, service_role;

DO $postdown$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'assert_finite_money') THEN
    RAISE EXCEPTION 'ABORT: assert_finite_money still exists after the down migration.' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '0114 rolled back. The NaN hole is open again — see the header.';
END
$postdown$;

COMMIT;
