-- 0114_money_numeric_guards.sql
-- =============================================================================
-- Phase 3 · A04-001, A04-002, A04-004, A04-012, A04-013/A06-014
--           (+ the table half of A04-005)
--
-- ONE shared numeric guard for the three money-writing RPCs, plus the CHECK
-- constraints `subscriber_balances` has never had.
--
-- ⚠️⚠️  APPLY ORDER — 0114 MUST BE APPLIED **AFTER** 0112.  ⚠️⚠️
--
--   `ALTER TABLE … ADD CONSTRAINT` validates every existing row. `s-0005`
--   currently carries a bucket-unit drift of +6.3637520682194222 units
--   (A04-016 — an audit-caused write, not a product defect). 0112 repairs it
--   with `SELECT public._resync_bucket_units('s-0005')`. Applying 0114 first
--   leaves that row live and the deferred bucket-unit check would then fail the
--   NEXT `publish_nav_snapshot` — i.e. it would break the demo, not the
--   migration. This file therefore ABORTS up front if the drift is still there
--   and names 0112 in the message. Do not "fix" s-0005 here; 0112 owns it.
--
--   (0112's own header calls the constraint migration "0113". That number was
--   taken by 0113_e2e_subscriber_cleanup_rpc while 0112 was being written; the
--   constraints live HERE, in 0114. 0112's body is not edited — an applied or
--   about-to-be-applied migration's body is never rewritten.)
--
-- -----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS: `NaN <= 0` IS FALSE IN POSTGRES
-- -----------------------------------------------------------------------------
-- Postgres sorts `NaN` GREATER than every other numeric — unlike IEEE-754 and
-- unlike every language a developer's intuition comes from. Measured on live:
--
--   select 'NaN'::numeric <= 0,  'NaN'::numeric > 0,  not('NaN'::numeric > 0),
--          'Infinity'::numeric > 0, 'NaN'::numeric = 'NaN'::numeric;
--   -->        f                        t                    f
--                                       t                    t
--
-- So `make_contribution`'s only amount guard —
--     IF p_amount IS NULL OR p_amount <= 0 THEN RAISE 'amount must be positive'
-- — is INERT against NaN. Reproduced live through the real RPC on a subscriber
-- JWT inside BEGIN…ROLLBACK: the call returned a transaction marked 'settled'
-- and s-0004's total_balance, retirement_balance, emergency_balance, units,
-- retirement_units, emergency_units and invested all became NaN, taking
-- platform AUM and unitsInIssue to NaN in the same statement. NaN propagates
-- through every SUM and there is no arithmetic undo — only a restore, on a free
-- tier with no PITR.
--
-- ⚠️ THE TWO "OBVIOUS" FIXES BOTH FAIL. Read this before touching the guard:
--
--   *  `p_amount <= 0`            → FALSE for NaN.        Does not reject it.
--   *  `NOT (p_amount > 0)`       → ALSO FALSE for NaN,   because `NaN > 0` is
--      TRUE in Postgres. This is the form the audit report and the phase-3
--      proof note both recommend, and it is WRONG for numeric. Verified live:
--      `select not('NaN'::numeric > 0)` --> f. It is right for float8 in C/JS,
--      where every NaN comparison is false. It is not right here.
--
-- The ONLY reliable rejections for `numeric` are the explicit ones:
--     p_value = 'NaN'::numeric            -- NaN = NaN is TRUE for numeric
--     p_value = 'Infinity'::numeric
--     p_value = '-Infinity'::numeric
-- (equivalently `p_value < 'Infinity'::numeric`, since NaN sorts above +Inf).
-- `public.assert_finite_money()` below uses the explicit form so the intent is
-- readable at the call site and cannot be "simplified" back into a hole.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT. Refuse to run against a book the new constraints cannot describe.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_drift   int;
  v_nonfin  int;
  v_neg     int;
  v_balsum  int;
  v_navbad  int;
BEGIN
  SELECT count(*) INTO v_drift FROM public.subscriber_balances
   WHERE abs((COALESCE(retirement_units,0) + COALESCE(emergency_units,0)) - units) > 0.000001;
  IF v_drift > 0 THEN
    RAISE EXCEPTION
      'ABORT: % subscriber_balances row(s) still have bucket-unit drift. Apply 0112 FIRST — it repairs s-0005 with public._resync_bucket_units(). 0114 must never run before 0112.',
      v_drift USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_nonfin FROM public.subscriber_balances
   WHERE NOT (retirement_balance > '-Infinity'::numeric AND retirement_balance < 'Infinity'::numeric)
      OR NOT (emergency_balance  > '-Infinity'::numeric AND emergency_balance  < 'Infinity'::numeric)
      OR NOT (total_balance      > '-Infinity'::numeric AND total_balance      < 'Infinity'::numeric)
      OR NOT (units              > '-Infinity'::numeric AND units              < 'Infinity'::numeric)
      OR NOT (retirement_units   > '-Infinity'::numeric AND retirement_units   < 'Infinity'::numeric)
      OR NOT (emergency_units    > '-Infinity'::numeric AND emergency_units    < 'Infinity'::numeric)
      OR NOT (invested           > '-Infinity'::numeric AND invested           < 'Infinity'::numeric);
  IF v_nonfin > 0 THEN
    RAISE EXCEPTION
      'ABORT: % subscriber_balances row(s) already hold NaN or Infinity. The book is poisoned; repair it before adding the constraint (there is no arithmetic undo — restore units from public.subscriber_balances_pre_nav).',
      v_nonfin USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_neg FROM public.subscriber_balances
   WHERE retirement_balance < 0 OR emergency_balance < 0 OR total_balance < 0
      OR units < 0 OR invested < 0
      OR retirement_units < -0.000001 OR emergency_units < -0.000001;
  IF v_neg > 0 THEN
    RAISE EXCEPTION 'ABORT: % subscriber_balances row(s) are negative.', v_neg USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_balsum FROM public.subscriber_balances
   WHERE retirement_balance + emergency_balance <> total_balance;
  IF v_balsum > 0 THEN
    RAISE EXCEPTION 'ABORT: % subscriber_balances row(s) have buckets that do not sum to the total.', v_balsum
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_navbad FROM public.nav_snapshots
   WHERE NOT (unit_price > 0 AND unit_price < 'Infinity'::numeric);
  IF v_navbad > 0 THEN
    RAISE EXCEPTION 'ABORT: % nav_snapshots row(s) hold a non-finite unit price.', v_navbad
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'Pre-flight clean: no drift, no NaN, no negatives, buckets sum, NAV register finite.';
END
$preflight$;


-- ===========================================================================
-- 1. THE SHARED GUARD
-- ===========================================================================
-- ONE validator for every amount the money engine writes, so the three RPCs
-- cannot drift apart. Returns the value so it can be used inline
-- (`v := public.assert_finite_money(...)`) or discarded with PERFORM.
--
-- IMMUTABLE: it reads nothing and depends only on its arguments.
-- NOT STRICT: a STRICT function returns NULL for a NULL argument WITHOUT
--   running the body, which would silently skip the NULL check — the one input
--   the old guard actually caught.
-- SECURITY INVOKER (the default): it touches no table, so there is nothing to
--   escalate. It is REVOKEd from PUBLIC/anon/authenticated at the bottom of this
--   file so it never becomes a PostgREST surface; the three callers are all
--   SECURITY DEFINER and execute as the owner, so they do not need the grant.
--
-- p_min / p_max are INCLUSIVE bounds. p_whole_shillings enforces the
-- zero-decimal UGX rule that src/utils/finance.js:95-97 states and that nothing
-- server-side has ever enforced (A04-012).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_finite_money(
  p_value            numeric,
  p_label            text,
  p_min              numeric DEFAULT 0,
  p_max              numeric DEFAULT 100000000,
  p_whole_shillings  boolean DEFAULT true
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION '% is required', p_label USING ERRCODE = 'P0001';
  END IF;

  -- The NaN / Infinity gate. These three equality tests are the whole point of
  -- this function: `<= 0` and `NOT (> 0)` BOTH pass NaN for numeric. Do not
  -- replace them with an inequality. See the file header.
  IF p_value = 'NaN'::numeric THEN
    RAISE EXCEPTION '% must be a real number (got NaN)', p_label USING ERRCODE = 'P0001';
  END IF;
  IF p_value = 'Infinity'::numeric OR p_value = '-Infinity'::numeric THEN
    RAISE EXCEPTION '% must be a real number (got %)', p_label, p_value USING ERRCODE = 'P0001';
  END IF;

  -- Past this point p_value is finite, so ordinary comparisons mean what they
  -- look like they mean.
  IF p_value < p_min THEN
    RAISE EXCEPTION '% of % is below the minimum of %', p_label, p_value, p_min
      USING ERRCODE = 'P0001';
  END IF;
  IF p_value > p_max THEN
    RAISE EXCEPTION '% of % is above the maximum of %', p_label, p_value, p_max
      USING ERRCODE = 'P0001';
  END IF;
  IF p_whole_shillings AND p_value <> round(p_value) THEN
    RAISE EXCEPTION '% must be a whole number of shillings (got %)', p_label, p_value
      USING ERRCODE = 'P0001';
  END IF;

  RETURN p_value;
END;
$$;

COMMENT ON FUNCTION public.assert_finite_money(numeric, text, numeric, numeric, boolean) IS
  'Shared money-amount guard (0114). Rejects NULL, NaN, +/-Infinity, out-of-range and sub-shilling values. NaN MUST be rejected by explicit equality: in Postgres NaN sorts above every numeric, so both `x <= 0` and `NOT (x > 0)` pass it.';


-- ===========================================================================
-- 2. make_contribution — A04-001, A04-012
-- ===========================================================================
-- Only the guard block changes. Everything else is byte-identical to the live
-- body captured from pg_get_functiondef on 2026-08-25.
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


-- ===========================================================================
-- 3. submit_employer_contribution_run — A04-001 on the employer path
-- ===========================================================================
-- The employer run never took an amount from the caller, so it looked safe. It
-- is not: every leg is DERIVED from `subscribers.compensation` and from
-- percentages read out of `employers.default_contribution_config` (jsonb). A
-- config holding the string "NaN" casts cleanly to NaN, `round(comp * NaN/100)`
-- is NaN, and `COALESCE(v_leg,0) > 0` is TRUE for NaN — so the run would post a
-- NaN contribution for EVERY member of that employer in one call. Neither
-- _normalize_contribution_config nor group_insurance_premium_per_member clamps
-- (both verified live 2026-08-25), so the guard has to live here.
--
-- ⚠️ src/test/employer-split-contract.test.js reads the NEWEST migration
--    definition of this function and fails if it mentions a per-member
--    percentage, or if the two `v_retirement := v_employee_leg;` /
--    `v_retirement := v_employer_leg;` lines are missing. 0102's allocation is
--    carried through unchanged below — this is a merge, not a rewrite.
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


-- ===========================================================================
-- 4. request_withdrawal — A04-001, A04-002, A04-004, A04-012, A04-013/A06-014
-- ===========================================================================
-- Four defects, one function:
--
--  A04-001  the same inert `p_amount <= 0` guard.
--  A04-002  the split legs were only checked to SUM to the amount, so
--           (-100000, 200000) passed and the withdrawal ADDED 100,000 UGX to
--           the retirement pot. Reproduced live. Each leg is now validated on
--           its own, not just the total.
--  A04-004  p_bucket='emergency' routed the WHOLE amount to a bucket that might
--           not hold it; the trigger clamps the bucket at 0 but debits the
--           total in full, so the member's screen showed Retirement 536,943 +
--           Savings 0 against a Total of 271,179. The per-leg check below covers
--           this too, because the bucket branch produces the same two legs.
--  A04-013  the ledger row was written with a POSITIVE amount while all 5,402
--  /A06-014 historical withdrawal rows are negative. Now -p_amount. The
--           `withdrawals` history row stays POSITIVE — all 4,937 live rows there
--           are positive, and so is the returned jsonb the UI renders. Only the
--           `transactions` ledger carries the sign.
--
-- ⚠️ src/test/nav-pricing-contract.test.js reads the NEWEST migration definition
--    of this function and fails if it stops calling latest_nav()/nav_for_date(),
--    reintroduces a 1000 unit-price literal, or loses SECURITY DEFINER / the
--    pinned search_path. 0104's NAV pricing is carried through unchanged.
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


-- ===========================================================================
-- 5. subscriber_balances — the CHECK constraints the table has never had
-- ===========================================================================
-- Before this migration `subscriber_balances` had exactly two constraints: a
-- primary key and a foreign key. Nothing stopped a NaN, a negative balance, or
-- two pots that disagree with the headline total.
--
-- ⚠️ HOW TO WRITE A NaN-REJECTING CHECK. A plain `CHECK (units >= 0)` ACCEPTS
--    NaN — `'NaN'::numeric >= 0` is TRUE, because NaN sorts above every numeric.
--    Verified live. Every money constraint below is therefore written as
--        (col >= 0 AND col < 'Infinity'::numeric)
--    The upper bound is what does the rejecting: `NaN < 'Infinity'` is FALSE
--    (NaN sorts ABOVE +Infinity), `Infinity < 'Infinity'` is FALSE, and
--    `-Infinity >= 0` is FALSE. One expression, all three non-finite values out.
-- ---------------------------------------------------------------------------

ALTER TABLE public.subscriber_balances
  DROP CONSTRAINT IF EXISTS subscriber_balances_amounts_chk;
ALTER TABLE public.subscriber_balances
  ADD CONSTRAINT subscriber_balances_amounts_chk CHECK (
        retirement_balance >= 0 AND retirement_balance < 'Infinity'::numeric
    AND emergency_balance  >= 0 AND emergency_balance  < 'Infinity'::numeric
    AND total_balance      >= 0 AND total_balance      < 'Infinity'::numeric
    AND units              >= 0 AND units              < 'Infinity'::numeric
    AND invested           >= 0 AND invested           < 'Infinity'::numeric
  );

COMMENT ON CONSTRAINT subscriber_balances_amounts_chk ON public.subscriber_balances IS
  '0114 (A04-001): money and units are finite and non-negative. The `< Infinity` half is the NaN trap — `>= 0` alone accepts NaN in Postgres.';

-- The two bucket-unit columns are DERIVED, not authoritative:
-- `_resync_bucket_units` sets retirement_units = round(units * ret/(ret+emg), 6)
-- and emergency_units = units - retirement_units. When a pot empties the ratio
-- is exactly 1 and the round(…, 6) can land a hair ABOVE `units`, leaving
-- emergency_units at about -5e-7. That is the rounding, not a broken balance, so
-- the floor carries a one-millionth tolerance. The NaN trap is unchanged.
ALTER TABLE public.subscriber_balances
  DROP CONSTRAINT IF EXISTS subscriber_balances_bucket_units_chk;
ALTER TABLE public.subscriber_balances
  ADD CONSTRAINT subscriber_balances_bucket_units_chk CHECK (
        retirement_units >= -0.000001 AND retirement_units < 'Infinity'::numeric
    AND emergency_units  >= -0.000001 AND emergency_units  < 'Infinity'::numeric
  );

COMMENT ON CONSTRAINT subscriber_balances_bucket_units_chk ON public.subscriber_balances IS
  '0114 (A04-001): derived bucket units are finite and effectively non-negative (1e-6 tolerance for _resync_bucket_units'' round(…,6) complement).';

-- The invariant A04-002 and A04-004 both broke: the two pots on the member's
-- screen must add up to the headline balance. Measured live 2026-08-25 across
-- all 5,060 rows: zero breaks, max drift 0 — so this is EXACT equality, not a
-- tolerance. Every writer maintains it exactly:
--   trg_transactions_contribution  credits ret + emg = amount into total
--   trg_transactions_contribution  sweep debits emg and total by the same target
--   trg_transactions_withdrawal    debits all three in ONE statement
--   publish_nav_snapshot           uses the complement rule (emg = total - ret)
--   the three signup paths         insert 0 / 0 / 0
ALTER TABLE public.subscriber_balances
  DROP CONSTRAINT IF EXISTS subscriber_balances_bucket_sum_chk;
ALTER TABLE public.subscriber_balances
  ADD CONSTRAINT subscriber_balances_bucket_sum_chk CHECK (
    retirement_balance + emergency_balance = total_balance
  );

COMMENT ON CONSTRAINT subscriber_balances_bucket_sum_chk ON public.subscriber_balances IS
  '0114 (A04-002, A04-004): the retirement and savings pots must sum to the headline balance. Both findings showed the member two contradictory money figures on one screen.';


-- ---------------------------------------------------------------------------
-- 5b. Bucket UNITS must sum to units — as a DEFERRED constraint trigger,
--     because a plain CHECK would block every contribution and every withdrawal.
--
-- ⚠️ READ THIS BEFORE "SIMPLIFYING" IT INTO A CHECK CONSTRAINT ⚠️
--
--   Both money paths change `units` in one statement and re-derive the bucket
--   units in the NEXT one:
--
--     trg_transactions_contribution:  INSERT … ON CONFLICT DO UPDATE SET units …
--                                     then PERFORM _resync_bucket_units(…)
--     request_withdrawal:             UPDATE … SET units = GREATEST(0, …)
--                                     then PERFORM _resync_bucket_units(…)
--
--   A CHECK constraint is evaluated per STATEMENT, so it would fire on that
--   intermediate row — where the buckets legitimately do not yet sum — and every
--   contribution and every withdrawal on the platform would fail. Postgres does
--   not support DEFERRABLE CHECK constraints, so the invariant has to be a
--   DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER, which runs at COMMIT,
--   after the resync.
--
--   The trigger RE-READS the row rather than trusting NEW. A deferred AFTER ROW
--   trigger queues one event per row VERSION, each carrying the NEW tuple as it
--   was at that statement — so the event queued by the mid-flight `units` update
--   would still fire at commit with its stale, violating NEW. Re-reading means
--   every queued event sees the same final state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_subscriber_balances_bucket_units()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_units numeric;
  v_ret   numeric;
  v_emg   numeric;
BEGIN
  SELECT units, retirement_units, emergency_units
    INTO v_units, v_ret, v_emg
    FROM public.subscriber_balances
   WHERE subscriber_id = NEW.subscriber_id;

  -- The row was deleted later in the same transaction; nothing to check.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF abs((COALESCE(v_ret, 0) + COALESCE(v_emg, 0)) - v_units) > 0.000001 THEN
    RAISE EXCEPTION
      'bucket units for % do not sum to units (% + % <> %) — call public._resync_bucket_units(%) after any change to units',
      NEW.subscriber_id, v_ret, v_emg, v_units, quote_literal(NEW.subscriber_id)
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS subscriber_balances_bucket_units_sum ON public.subscriber_balances;
CREATE CONSTRAINT TRIGGER subscriber_balances_bucket_units_sum
  AFTER INSERT OR UPDATE ON public.subscriber_balances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_subscriber_balances_bucket_units();

COMMENT ON FUNCTION public.trg_subscriber_balances_bucket_units() IS
  '0114 (A04-001/A04-016): deferred check that retirement_units + emergency_units = units at COMMIT. Deferred, and re-reads the row, because both money paths update units and re-derive the buckets in separate statements.';


-- ===========================================================================
-- 6. nav_snapshots — the TABLE half of A04-005
-- ===========================================================================
-- `nav_snapshots_unit_price_check CHECK (unit_price > 0)` passes NaN, because
-- `'NaN'::numeric > 0` is TRUE. publish_nav_snapshot's own `p_unit_price <= 0`
-- guard passes it for the same reason, and with p_confirm_move => true a NaN
-- price drove all 5,060 subscriber_balances rows to NaN in one statement.
--
-- The register INSERT happens BEFORE the revaluation UPDATE in that function's
-- body, so a finite-price constraint stops the publish before a single balance
-- row is touched. Measured live: 1,246 rows, 996.38 – 1580.72, none non-finite.
--
-- ⚠️ NOT DONE HERE: the in-function guard in publish_nav_snapshot. That function
--    is outside this agent's ownership (make_contribution, request_withdrawal,
--    submit_employer_contribution_run). Two agents CREATE OR REPLACE-ing one
--    function in the same phase is how 0095 silently un-shipped 0090. Whoever
--    owns it should add
--        PERFORM public.assert_finite_money(p_unit_price, 'unit price', 0.01, 1000000, false);
--    so the admin gets a sentence instead of a constraint violation. The
--    constraint below is the backstop either way.
-- ---------------------------------------------------------------------------
ALTER TABLE public.nav_snapshots
  DROP CONSTRAINT IF EXISTS nav_snapshots_unit_price_finite_chk;
ALTER TABLE public.nav_snapshots
  ADD CONSTRAINT nav_snapshots_unit_price_finite_chk CHECK (
    unit_price > 0 AND unit_price < 'Infinity'::numeric
  );

COMMENT ON CONSTRAINT nav_snapshots_unit_price_finite_chk ON public.nav_snapshots IS
  '0114 (A04-005): the published unit price must be finite. The pre-existing unit_price > 0 check passes NaN — NaN sorts above every numeric.';


-- ===========================================================================
-- 7. A04-013 / A06-014 — the one live positive withdrawal row
-- ===========================================================================
-- request_withdrawal has written a POSITIVE transactions.amount since 0054,
-- against 5,402 negative historical rows. Exactly one row was created that way
-- on live (tx-s-100117-wd-9d3276ed…, 5,000 UGX, 2026-08-07), and it makes
-- SUM(amount) over the ledger disagree with SUM(ABS(amount)) by 10,000.
--
-- Flipping the sign is arithmetically inert: both balance triggers are AFTER
-- INSERT only (verified live), so no UPDATE re-fires them, and every reader
-- normalises with ABS. The affected ids are recorded so the down migration can
-- restore them exactly rather than guessing which negatives were flipped.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions_wd_sign_fix_20260825 (
  id            text PRIMARY KEY,
  amount_before numeric NOT NULL,
  fixed_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.transactions_wd_sign_fix_20260825 IS
  '0114 (A04-013/A06-014) sign-flip ledger. Rollback data for 0114_money_numeric_guards.down.sql. DO NOT DROP.';

DO $sign$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.transactions WHERE type = 'withdrawal' AND amount > 0;
  IF v_n > 50 THEN
    RAISE EXCEPTION
      'ABORT: % positive withdrawal rows — expected 1. Something other than request_withdrawal is writing this ledger; re-measure before flipping signs.',
      v_n USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'A04-013: flipping % positive withdrawal row(s) to negative.', v_n;
END
$sign$;

INSERT INTO public.transactions_wd_sign_fix_20260825 (id, amount_before)
SELECT id, amount FROM public.transactions
 WHERE type = 'withdrawal' AND amount > 0
ON CONFLICT (id) DO NOTHING;

UPDATE public.transactions
   SET amount = -amount
 WHERE type = 'withdrawal' AND amount > 0;

-- With the residue gone the convention is enforceable. `amount <= 0` and not
-- `< 0` because a zero-amount withdrawal, while pointless, is not a sign error.
-- NaN is excluded explicitly: `NaN <= 0` is FALSE, so it would otherwise be the
-- one value this constraint lets through.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_withdrawal_sign_chk;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_withdrawal_sign_chk CHECK (
    type <> 'withdrawal' OR (amount <= 0 AND amount > '-Infinity'::numeric)
  );

COMMENT ON CONSTRAINT transactions_withdrawal_sign_chk ON public.transactions IS
  '0114 (A04-013/A06-014): withdrawals are stored NEGATIVE, as 0105 documents and as all 5,402 historical rows are.';


-- ===========================================================================
-- 8. Grants
-- ===========================================================================
-- The three RPCs keep exactly the ACL they had (postgres, authenticated,
-- service_role — captured live 2026-08-25). CREATE OR REPLACE preserves it;
-- these are re-asserted so the file states the intent rather than relying on it.
REVOKE ALL ON FUNCTION public.make_contribution(text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.make_contribution(text, numeric, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_employer_contribution_run(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_employer_contribution_run(text, text, text) TO authenticated, service_role;

-- The guard is internal. It is called only from SECURITY DEFINER bodies, which
-- execute as the owner and so do not need the grant; exposing it would add a
-- pointless PostgREST endpoint. Same posture as _resync_bucket_units.
REVOKE ALL ON FUNCTION public.assert_finite_money(numeric, text, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_finite_money(numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.trg_subscriber_balances_bucket_units() FROM PUBLIC, anon, authenticated;


-- ===========================================================================
-- 9. Post-flight
-- ===========================================================================
DO $postflight$
DECLARE
  v_constraints int;
  v_positive    int;
BEGIN
  SELECT count(*) INTO v_constraints FROM pg_constraint
   WHERE conname IN ('subscriber_balances_amounts_chk',
                     'subscriber_balances_bucket_units_chk',
                     'subscriber_balances_bucket_sum_chk',
                     'nav_snapshots_unit_price_finite_chk',
                     'transactions_withdrawal_sign_chk');
  IF v_constraints <> 5 THEN
    RAISE EXCEPTION 'ABORT: expected 5 new CHECK constraints, found %.', v_constraints USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_positive FROM public.transactions WHERE type = 'withdrawal' AND amount > 0;
  IF v_positive > 0 THEN
    RAISE EXCEPTION 'ABORT: % withdrawal row(s) still positive.', v_positive USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'subscriber_balances_bucket_units_sum'
                    AND tgrelid = 'public.subscriber_balances'::regclass) THEN
    RAISE EXCEPTION 'ABORT: the deferred bucket-units constraint trigger is missing.' USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE '0114 applied: shared guard live in 3 RPCs, 5 CHECK constraints, 1 deferred constraint trigger.';
END
$postflight$;

COMMIT;
