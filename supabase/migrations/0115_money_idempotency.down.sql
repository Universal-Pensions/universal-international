-- 0115_money_idempotency.down.sql
-- =============================================================================
-- Reverse of 0115_money_idempotency.sql.
--
-- ⚠️⚠️  THIS RESTORES **0114's** BODIES, NOT THE PRE-0114 LIVE ONES.  ⚠️⚠️
--
--   0114_money_numeric_guards.sql was not yet applied to live when 0115 was
--   written, so the bodies you would read out of `pg_get_functiondef` at that
--   moment were OLDER than 0114. Rolling 0115 back to those would delete
--   0114's NaN / Infinity guards along with 0115's idempotency work — turning a
--   rollback of one migration into the silent un-shipping of another. That is
--   exactly the 0095-over-0090 failure this repo has already shipped once.
--
--   The three money RPCs below are therefore 0114's text, byte-for-byte, read
--   straight out of 0114_money_numeric_guards.sql. `trg_transactions_contribution`
--   is 0104's text (0104 IS applied, so its live body was the correct baseline).
--
--   If you are rolling BOTH back, run this file FIRST and then
--   0114_money_numeric_guards.down.sql.
--
-- What comes back:
--   * make_contribution / request_withdrawal / submit_employer_contribution_run
--     with the nonce claimed AFTER the money write (A04-011 reopens).
--   * trg_transactions_contribution with the (agent, member) commission key and
--     the `IS NOT NULL` rate test (A05-012 + A05-013 reopen).
--   * ux_commissions_agent_subscriber, 0017's index.
-- What goes away:
--   * ux_settlement_batches_agent_txn_ref and the settlement_batches trigger
--     (A05-004 + the server half of A05-005 reopen), and with them the
--     requirement that a settlement carry a payment reference.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop 0115's table-level guards.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS settlement_batches_unique_ref ON public.settlement_batches;
DROP FUNCTION IF EXISTS public.trg_settlement_batches_unique_ref();
DROP INDEX IF EXISTS public.ux_settlement_batches_agent_txn_ref;

-- 0017's index first, so the book is never without a commission-uniqueness
-- guard, then drop 0115's.
CREATE UNIQUE INDEX IF NOT EXISTS ux_commissions_agent_subscriber
  ON public.commissions (agent_id, subscriber_id);
DROP INDEX IF EXISTS public.ux_commissions_subscriber;


-- ---------------------------------------------------------------------------
-- 2. make_contribution — 0114's body, verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.make_contribution(p_nonce text, p_amount numeric, p_retirement_pct numeric DEFAULT 80, p_method text DEFAULT 'MTN Mobile Money'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
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

  -- 0114 [A04-001, A04-012]: replaces `IF p_amount IS NULL OR p_amount <= 0`,
  -- which could not reject NaN or Infinity. 5,000 is MIN_CONTRIBUTION in
  -- src/constants/savings.js — the UI has always enforced it, the server never
  -- did. 100,000,000 UGX is ~4x the largest live balance (24,786,589) and ~11x
  -- the largest live contribution (8,640,000).
  PERFORM public.assert_finite_money(p_amount, 'contribution amount', 5000, 100000000, true);

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  -- NaN/Infinity here already fall back to 80 (both are > 100 in Postgres'
  -- ordering), so this branch was never the hole. Left exactly as it was.
  v_ret_pct := COALESCE(p_retirement_pct, 80);
  IF v_ret_pct < 0 OR v_ret_pct > 100 THEN
    v_ret_pct := 80;
  END IF;
  v_retirement := round(p_amount * v_ret_pct / 100);
  v_emergency  := p_amount - v_retirement;

  -- 0114: the legs are what the balance trigger actually adds to each bucket.
  -- Derived from an amount that is already finite and whole, so this can only
  -- fire if the derivation above is ever changed.
  PERFORM public.assert_finite_money(v_retirement, 'retirement share', 0, 100000000, true);
  PERFORM public.assert_finite_money(v_emergency,  'savings share',    0, 100000000, true);

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
$$;

-- ---------------------------------------------------------------------------
-- 3. request_withdrawal — 0114's body, verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_nonce text, p_amount numeric, p_bucket text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_method text DEFAULT 'MTN Mobile Money'::text, p_split_retirement numeric DEFAULT NULL::numeric, p_split_emergency numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role          text := (SELECT auth.jwt()) ->> 'app_role';
  v_subscriber_id text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_total_balance numeric;
  v_ret_balance   numeric;                    -- 0114: read under the same lock
  v_emg_balance   numeric;                    -- 0114: read under the same lock
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

  -- 0114 [A04-001, A04-012]: replaces `IF p_amount IS NULL OR p_amount <= 0`.
  -- 5,000 is MIN_WITHDRAW in src/constants/savings.js; the smallest non-zero
  -- live balance is 42,199, so no member is trapped by the floor.
  PERFORM public.assert_finite_money(p_amount, 'withdrawal amount', 5000, 100000000, true);

  -- 0114: 'retirement' and 'emergency' are the only two buckets that exist, and
  -- everything else used to fall through to emergency silently.
  IF p_bucket IS NOT NULL AND p_bucket NOT IN ('retirement', 'emergency') THEN
    RAISE EXCEPTION 'unknown pot %; choose retirement or emergency', p_bucket USING ERRCODE = 'P0001';
  END IF;

  -- 0114 [A04-002]: the balance trigger only honours the explicit splits when
  -- BOTH are present; a lone leg was written to the ledger row and then quietly
  -- ignored. All-or-nothing, checked before anything is read or written.
  IF (p_split_retirement IS NULL) <> (p_split_emergency IS NULL) THEN
    RAISE EXCEPTION 'give both the retirement and the savings part of the split, or neither'
      USING ERRCODE = 'P0001';
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
  -- 0114: the two bucket balances come back under the SAME lock, so the
  -- per-bucket checks below cannot race the total check.
  SELECT total_balance, retirement_balance, emergency_balance
    INTO v_total_balance, v_ret_balance, v_emg_balance
    FROM public.subscriber_balances
   WHERE subscriber_id = v_subscriber_id
   FOR UPDATE;
  v_total_balance := COALESCE(v_total_balance, 0);
  v_ret_balance   := COALESCE(v_ret_balance, 0);
  v_emg_balance   := COALESCE(v_emg_balance, 0);

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

  -- F-5 (cont.) + 0114 [A04-002, A04-004]. Whether the legs came from the
  -- caller or from p_bucket above, they are the exact figures the trigger will
  -- subtract from each pot, so all four things must hold:
  --   1. each leg is a real, non-negative, whole number  (A04-002: a negative
  --      leg reached GREATEST(0, balance - leg) and ADDED money);
  --   2. they sum to the amount                          (the original check);
  --   3. the retirement leg fits the retirement pot      (A04-004);
  --   4. the savings leg fits the savings pot            (A04-004).
  -- Without 3 and 4 the trigger clamps the pot at 0 but still debits the total,
  -- and the member's two pots stop summing to their headline balance.
  IF v_split_ret IS NOT NULL AND v_split_emg IS NOT NULL THEN
    PERFORM public.assert_finite_money(v_split_ret, 'retirement part of the withdrawal', 0, 100000000, true);
    PERFORM public.assert_finite_money(v_split_emg, 'savings part of the withdrawal',    0, 100000000, true);

    IF (v_split_ret + v_split_emg) <> p_amount THEN
      RAISE EXCEPTION 'split_retirement + split_emergency (%) must equal amount %',
        v_split_ret + v_split_emg, p_amount USING ERRCODE = 'P0001';
    END IF;

    IF v_split_ret > v_ret_balance THEN
      RAISE EXCEPTION 'withdrawal of % from retirement exceeds the retirement balance %',
        v_split_ret, v_ret_balance USING ERRCODE = 'P0001';
    END IF;
    IF v_split_emg > v_emg_balance THEN
      RAISE EXCEPTION 'withdrawal of % from savings exceeds the savings balance %',
        v_split_emg, v_emg_balance USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_bucket := COALESCE(p_bucket, 'emergency');
  v_ref    := 'WD-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  v_tx_id  := 'tx-' || v_subscriber_id || '-wd-' || replace(gen_random_uuid()::text, '-', '');
  v_wd_id  := 'wd-' || v_subscriber_id || '-'    || replace(gen_random_uuid()::text, '-', '');

  -- 1. Ledger row → AFTER INSERT trigger debits subscriber_balances buckets.
  -- 0114 [A04-013/A06-014]: the amount is stored NEGATIVE, matching all 5,402
  -- historical rows, 0105's documented convention and src/data/employerSeed.js.
  -- trg_transactions_withdrawal already reads ABS(NEW.amount), so the debit is
  -- unchanged; what changes is that SUM(amount) over the ledger is now true.
  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, status, method,
    txn_ref, bucket, split_retirement, split_emergency, source
  ) VALUES (
    v_tx_id, v_subscriber_id, 'withdrawal', -p_amount, now(), 'processing', p_method,
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
  --    POSITIVE, like all 4,937 live rows in this table.
  INSERT INTO public.withdrawals (
    id, subscriber_id, amount, bucket, reason, method, status, date, reference
  ) VALUES (
    v_wd_id, v_subscriber_id, p_amount, v_bucket, p_reason, p_method, 'processing',
    (now())::date, v_ref
  );

  -- Return shape matches mapWithdrawalRow's camelCase contract (the legacy
  -- requestWithdrawal return object). `amount` stays POSITIVE — the member's
  -- receipt reads "you took out 100,000", not "-100,000".
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

-- ---------------------------------------------------------------------------
-- 4. submit_employer_contribution_run — 0114's body, verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_employer_contribution_run(p_period_label text DEFAULT NULL::text, p_method text DEFAULT NULL::text, p_nonce text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
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

  -- 0114 [A04-001]: stop a malformed employer config BEFORE the run header is
  -- written, so a bad setting produces a message the employer can act on rather
  -- than a payroll of NaN. A share of pay above 100% is not a configuration.
  PERFORM public.assert_finite_money(v_employee_pct, 'employee share of pay (%)', 0, 100, false);
  PERFORM public.assert_finite_money(v_employer_pct, 'company share of pay (%)',  0, 100, false);
  PERFORM public.assert_finite_money(v_insurance_leg, 'group insurance premium', 0, 100000000, true);

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
    -- 0114 [A04-001]: pay itself is an input, and a NaN there poisons both legs.
    -- Not required to be whole shillings — it is a salary field, not a posting.
    v_comp := public.assert_finite_money(v_sub.compensation, 'recorded pay for ' || v_sub.id, 0, 100000000, false);

    -- THE canonical math. Each leg is derived INDEPENDENTLY from compensation and
    -- rounded once. The employer leg never references the employee leg — that was
    -- the old match basis and it is gone.
    v_employee_leg := round(v_comp * v_employee_pct / 100);
    v_employer_leg := round(v_comp * v_employer_pct / 100);

    -- 0114 [A04-001]: the two figures that are about to become transactions.amount.
    -- Floor is 0, NOT 5,000 — a small share of a small wage is real money and must
    -- keep posting; only the zero legs below are skipped.
    PERFORM public.assert_finite_money(v_employee_leg, 'payroll deduction for ' || v_sub.id, 0, 100000000, true);
    PERFORM public.assert_finite_money(v_employer_leg, 'company contribution for ' || v_sub.id, 0, 100000000, true);

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
$$;

-- ---------------------------------------------------------------------------
-- 5. trg_transactions_contribution — 0104's body, verbatim (captured from
--    pg_get_functiondef on live, where 0104 is the installed definition).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_transactions_contribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_unit_price       NUMERIC;   -- 0104: the fund NAV, assigned in BEGIN
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
  -- 0104: price this contribution at the fund NAV in force on its OWN date, so
  -- a back-dated employer run prices at that period's NAV, not today's. This
  -- cannot be a DECLARE initialiser — that context cannot reference NEW.
  v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));

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
    invested,
    nav_as_of,
    updated_at
  ) VALUES (
    NEW.subscriber_id,
    v_retirement_share,
    v_emergency_share,
    NEW.amount,
    NEW.amount / v_unit_price,
    NEW.amount,
    CURRENT_DATE,
    now()
  )
  ON CONFLICT (subscriber_id) DO UPDATE SET
    retirement_balance = public.subscriber_balances.retirement_balance + EXCLUDED.retirement_balance,
    emergency_balance  = public.subscriber_balances.emergency_balance  + EXCLUDED.emergency_balance,
    total_balance      = public.subscriber_balances.total_balance      + EXCLUDED.total_balance,
    units              = public.subscriber_balances.units              + EXCLUDED.units,
    invested           = public.subscriber_balances.invested           + EXCLUDED.invested,
    nav_as_of          = EXCLUDED.nav_as_of,
    updated_at         = now();

  -- 0104: bucket units are DERIVED, never hand-maintained. See _resync_bucket_units.
  PERFORM public._resync_bucket_units(NEW.subscriber_id);

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
          -- Debit buckets by the ANNUAL target, and units by target/NAV ([H1]) —
          -- NEVER by target — so units × NAV == total_balance stays EXACT
          -- (units are credited un-rounded above; do not round here).
          -- 0104: redeem at the day's NAV, capped at units actually held, and
          -- drop the SAME FRACTION of cost basis as of units (average-cost), so
          -- paying an annual premium out of savings is not read as a loss.
          -- Every SET right-hand side reads the PRE-UPDATE row, so `units` here
          -- is the holding before this redemption.
          UPDATE public.subscriber_balances
             SET emergency_balance = emergency_balance - v_target,
                 total_balance     = total_balance     - v_target,
                 units             = units - LEAST(v_target / v_unit_price, units),
                 invested          = CASE WHEN units > 0
                                       THEN GREATEST(0, invested * (1 - LEAST(v_target / v_unit_price, units) / units))
                                       ELSE 0 END,
                 nav_as_of         = CURRENT_DATE,
                 updated_at        = now()
           WHERE subscriber_id = NEW.subscriber_id;
          PERFORM public._resync_bucket_units(NEW.subscriber_id);

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
      -- 0089: the rate is per-DISTRIBUTOR now. `v_branch_id` is already
      -- resolved above, and the helper walks branch -> distributor -> its rate,
      -- falling back to the platform `id='default'` row. A NULL result still
      -- means "generate no commission", exactly as before.
      v_commission_rate := public.commission_rate_for_branch(v_branch_id);

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
$function$;

COMMIT;
