-- =============================================================================
-- Universal Pensions Uganda — 0092: ONE unified two-leg contribution model
-- =============================================================================
-- Collapses the employer's two contribution MODES into a single model in which
-- the employee leg and the employer leg are INDEPENDENT shares of the member's
-- monthly COMPENSATION.
--
-- WHY (the bug this migration exists to kill):
--   `employers.default_contribution_config` was mode-switched, and in
--   `mode = 'co-contribution'` the employer leg was computed as a percentage OF
--   THE EMPLOYEE LEG:
--       employee_leg = round(comp * employeePct / 100)
--       employer_leg = round(employee_leg * employerMatchPct / 100)   -- ✗
--   That is the wrong basis. An employer that told us "staff put in 10% and we
--   add 5%" had `employerMatchPct = 5` stored, and every run funded
--   round(comp * 10% * 5%) = 0.5% of pay — a tenth of what the employer meant.
--   The employer leg is a share of PAY and is never a function of the employee
--   leg. `mode`, `employerMatchPct` and `matchPct` are deleted outright.
--
-- CANONICAL CONFIG SHAPE (all six pension keys always written by the frontend):
--   {
--     employeeBasis: 'percent' | 'fixed', employeePct, employeeAmount,
--     employerBasis: 'percent' | 'fixed', employerPct, employerAmount,
--     -- group-insurance keys ride along COMPLETELY UNCHANGED:
--     insuranceEnabled, groupCoverAmount, groupInsuranceProducts
--   }
--     employee_leg = employeeBasis='percent' ? round(comp * employeePct/100)
--                                            : round(employeeAmount)
--     employer_leg = employerBasis='percent' ? round(comp * employerPct/100)
--                                            : round(employerAmount)
--   Either leg may be 0. 0/0 is a LEGAL, SAVEABLE config — it simply funds no
--   pension. There is NO cap and NO minimum. Company-wide only; there is no
--   per-employee override.
--
-- WHAT THIS MIGRATION DOES:
--   (1) public._normalize_contribution_config(jsonb) — NEW internal IMMUTABLE
--       helper that canonicalises any stored config (new shape, legacy mode
--       shapes, or '{}') into the six keys. Called by BOTH (2) and (5) so the
--       run math and the member-facing read can never drift.
--   (2) submit_employer_contribution_run — the core fix. Two independent legs off
--       compensation. Supersedes the live body (0067).
--   (3) create_employer_invite — collect_schedule becomes a constant TRUE. It is
--       no longer a funding flag; it selects KYC DEPTH. See the note in-body.
--   (4) get_employer_metrics — drops the meaningless `modeSplit` key.
--   (5) get_my_employer_funding() — NEW subscriber-scoped read so a member can
--       finally see who funds their pension and at what rate, without widening
--       RLS on `public.employers`.
--   (6) create_employer — light shape validation for the unified config.
--
-- ⚠️ JS PARITY OBLIGATION. `src/utils/contributionModel.js` is the single source
--    of truth for this math (`normalizeContributionConfig` +
--    `deriveContributionLegs`). (1) and (2) below re-implement it in PL/pgSQL.
--    Any change to one MUST land in the same commit as the other, or the offline
--    mock path (VITE_USE_SUPABASE='false'), the seeded ledger, the run-wizard
--    preview and this live RPC diverge. Rounding is a single round() per leg,
--    which matches JS Math.round for the non-negative values this model permits.
--
-- ⚠️ APPLY OUT OF BAND. The tracked `supabase_migrations` ledger stops at 0084 —
--    0085-0091 were applied directly against the live project. Apply this file
--    the same way (Supabase SQL editor / apply_migration), NOT via
--    `supabase db push`, which would try to replay 0085-0091 on top.
--
-- CONVENTIONS: TEXT keys; snake_case; SECURITY DEFINER + SET search_path =
-- public, pg_temp; role read via (SELECT auth.jwt()) ->> 'app_role' (NEVER
-- 'role'); REVOKE from PUBLIC/anon then GRANT to authenticated; forward-only +
-- a matching .down.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (1) _normalize_contribution_config(jsonb) → jsonb  (internal, IMMUTABLE)
-- -----------------------------------------------------------------------------
-- The SQL twin of `normalizeContributionConfig` in src/utils/contributionModel.js.
-- Returns exactly the six canonical pension keys — bases guaranteed to be
-- 'percent' | 'fixed', amounts guaranteed non-NULL numerics. Group-insurance keys
-- are NOT returned; they are read straight off the raw config by
-- `group_insurance_premium_per_member` (0067/0071) and are untouched by this
-- change.
--
-- Three input shapes, in priority order:
--   A. UNIFIED (0092+) — an EXPLICIT basis on either leg is the marker. A basis
--      is never inferred from the presence of an amount: that inference is
--      exactly what silently flipped percent employers to fixed under the old
--      shape (see the employerBasis default note in (2)).
--   B. LEGACY mode-switched — converted MONEY-PRESERVINGLY so a config saved
--      before 0092 keeps funding the same shillings it funded yesterday:
--        'co-contribution' → employee percent employeePct, employer percent
--                            (employeePct * employerMatchPct / 100).
--                            10% + 50% match ≡ 5% of pay.
--        'employer-only'   → employee 0; employer from the old
--                            employerBasis / employerPct / employerAmount.
--   C. EMPTY / unrecognised — '{}' (how create_employer and
--      approve_access_request provision a new employer) normalises to 0/0, which
--      the UI surfaces as "No contributions set up yet" rather than the old bogus
--      "Employer-only — UGX 0 per member".
--
-- This exists ONLY for back-compat with pre-0092 rows; every writer (the
-- employer Contribution settings form, the seeds, create_employer) emits shape A.
CREATE OR REPLACE FUNCTION public._normalize_contribution_config(p_config jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (
    -- A non-object config (NULL, a scalar, an array) funds nothing rather than
    -- raising: a malformed row must never be able to abort a whole payroll run.
    SELECT CASE
             WHEN jsonb_typeof(COALESCE(p_config, '{}'::jsonb)) = 'object'
               THEN COALESCE(p_config, '{}'::jsonb)
             ELSE '{}'::jsonb
           END AS c
  ),
  shape AS (
    SELECT
      c,
      c ->> 'mode' AS mode,
      -- Unified-shape marker. Mirrors JS `cfg.employeeBasis != null ||
      -- cfg.employerBasis != null`: the key must be present AND not JSON null.
      --
      -- ⚠️ BRANCH ORDER BELOW IS LOAD-BEARING: `mode` is tested BEFORE this
      -- marker, exactly as src/utils/contributionModel.js does. Reason:
      -- update_employer_profile patches this column by jsonb MERGE, so a row
      -- switched from employer-only to co-contribution can still carry a STALE
      -- employerBasis/employerPct from its previous shape. Reading the unified
      -- branch first would take that stale employerPct and silently ignore
      -- employerMatchPct — zeroing or wildly inflating the employer leg with no
      -- error. `mode` is never written again from 0092 onward, so its presence
      -- unambiguously means "this row predates 0092" and is the only safe
      -- discriminator. Swap the branch order and JS/SQL parity breaks.
      (
        ((c -> 'employeeBasis') IS NOT NULL AND jsonb_typeof(c -> 'employeeBasis') <> 'null')
        OR
        ((c -> 'employerBasis') IS NOT NULL AND jsonb_typeof(c -> 'employerBasis') <> 'null')
      ) AS unified,
      -- Legacy 'employer-only' had no employeeBasis/employerBasis, so the basis
      -- was implied by WHICH employer key was set. Mirrors JS
      -- `cfg.employerAmount != null`.
      ((c -> 'employerAmount') IS NOT NULL AND jsonb_typeof(c -> 'employerAmount') <> 'null')
        AS legacy_employer_fixed
      FROM cfg
  )
  SELECT CASE
    -- A1. legacy co-contribution — % of the employee leg becomes % of pay.
    WHEN mode = 'co-contribution' THEN jsonb_build_object(
      'employeeBasis',  'percent',
      'employeePct',    COALESCE(NULLIF(c ->> 'employeePct', '')::numeric, 0),
      'employeeAmount', 0,
      'employerBasis',  'percent',
      -- trim_scale so the division yields 5, not 5.0000000000000000 — JS produces
      -- the short form and this value is echoed to the member by (5).
      'employerPct',    trim_scale(
                          COALESCE(NULLIF(c ->> 'employeePct', '')::numeric, 0)
                          * COALESCE(
                              NULLIF(c ->> 'employerMatchPct', '')::numeric,
                              NULLIF(c ->> 'matchPct',         '')::numeric,
                              0
                            ) / 100
                        ),
      'employerAmount', 0
    )

    -- A2. legacy employer-only — staff contributed nothing.
    WHEN mode = 'employer-only' THEN jsonb_build_object(
      'employeeBasis',  'percent',
      'employeePct',    0,
      'employeeAmount', 0,
      'employerBasis',  CASE WHEN legacy_employer_fixed THEN 'fixed' ELSE 'percent' END,
      'employerPct',    COALESCE(NULLIF(c ->> 'employerPct',    '')::numeric, 0),
      'employerAmount', COALESCE(NULLIF(c ->> 'employerAmount', '')::numeric, 0)
    )

    -- C1. already unified (and therefore NOT carrying a legacy `mode`) — read
    -- as-is. Anything other than the literal 'fixed' is 'percent' (JS basisOf), so
    -- a typo degrades to the safe percent basis.
    WHEN unified THEN jsonb_build_object(
      'employeeBasis',  CASE WHEN c ->> 'employeeBasis' = 'fixed' THEN 'fixed' ELSE 'percent' END,
      'employeePct',    COALESCE(NULLIF(c ->> 'employeePct',    '')::numeric, 0),
      'employeeAmount', COALESCE(NULLIF(c ->> 'employeeAmount', '')::numeric, 0),
      'employerBasis',  CASE WHEN c ->> 'employerBasis' = 'fixed' THEN 'fixed' ELSE 'percent' END,
      'employerPct',    COALESCE(NULLIF(c ->> 'employerPct',    '')::numeric, 0),
      'employerAmount', COALESCE(NULLIF(c ->> 'employerAmount', '')::numeric, 0)
    )

    -- C. empty / unrecognised — nothing is funded.
    ELSE jsonb_build_object(
      'employeeBasis',  'percent',
      'employeePct',    0,
      'employeeAmount', 0,
      'employerBasis',  'percent',
      'employerPct',    0,
      'employerAmount', 0
    )
  END
  FROM shape;
$$;

-- Internal leaf helper — nothing outside this file calls it, and its two callers
-- are SECURITY DEFINER (so they execute it as the owner regardless of the caller's
-- grants). No GRANT, matching the stance on _insert_subscriber_chain /
-- _validate_signup_payload.
REVOKE ALL ON FUNCTION public._normalize_contribution_config(jsonb) FROM PUBLIC, anon;

COMMENT ON FUNCTION public._normalize_contribution_config(jsonb) IS
  'Canonicalise employers.default_contribution_config into the six unified pension '
  'keys (employee/employer × basis/pct/amount). SQL twin of '
  'normalizeContributionConfig in src/utils/contributionModel.js — keep in lockstep.';


-- -----------------------------------------------------------------------------
-- (2) submit_employer_contribution_run — two INDEPENDENT legs off compensation
-- -----------------------------------------------------------------------------
-- Supersedes the live body (0067). Everything except the config read and the leg
-- math is unchanged: the nonce replay guard, the FOR UPDATE row lock, the
-- retirement/emergency split by ret_pct (default 80), the three INSERTs
-- (employee source='own', employer source='employer', insurance
-- type='insurance_premium' source='employer' with NULL splits), the insurance leg
-- via group_insurance_premium_per_member, members_funded counting DISTINCT funded
-- members, the skipped[] entries, grand_total = employee + employer + insurance,
-- and the returned jsonb keys.
--
-- ⚠️ THE `employerBasis` DEFAULT. The 0067 body defaulted `employerBasis` to
--    'fixed'. Both bases now default to 'percent'. This is not cosmetic: with a
--    'fixed' default, a config carrying percent keys (employerPct) but NO explicit
--    basis fell to `round(employerAmount)` = round(0) = 0 and funded NOTHING. It
--    raised no error, and the only trace was a skipped[] entry reading
--    'zero_contribution' — indistinguishable from a deliberate 0/0 config, so the
--    employer had no way to tell a misread config from an intentional one.
--    Verified against a local replica: {employeeBasis:'percent', employeePct:10,
--    employerPct:5} on UGX 1,000,000 funded 0/0 under the old default and funds
--    100,000/50,000 here. 'percent' is the shape every writer emits and is the
--    only safe default.
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
  v_employee_basis   text;
  v_employee_pct     numeric;
  v_employee_amount  numeric;
  v_employer_basis   text;
  v_employer_pct     numeric;
  v_employer_amount  numeric;
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

  -- Canonicalise the PENSION legs. The helper also money-preservingly converts a
  -- pre-0092 mode-switched config, so an employer who has not re-saved their
  -- settings since the model change still funds correctly. Every writer today
  -- emits the unified shape, so that path is defensive only. `v_config` stays RAW
  -- below because the group-insurance keys are read straight off it, unchanged.
  v_norm := public._normalize_contribution_config(v_config);

  -- Both bases default to 'percent' — see the ⚠️ note above this function. The
  -- COALESCEs are belt-and-braces: the helper already guarantees non-NULL.
  v_employee_basis   := COALESCE(NULLIF(v_norm ->> 'employeeBasis', ''), 'percent');
  v_employee_pct     := COALESCE(NULLIF(v_norm ->> 'employeePct',     '')::numeric, 0);
  v_employee_amount  := COALESCE(NULLIF(v_norm ->> 'employeeAmount',  '')::numeric, 0);
  v_employer_basis   := COALESCE(NULLIF(v_norm ->> 'employerBasis', ''), 'percent');
  v_employer_pct     := COALESCE(NULLIF(v_norm ->> 'employerPct',     '')::numeric, 0);
  v_employer_amount  := COALESCE(NULLIF(v_norm ->> 'employerAmount',  '')::numeric, 0);

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

    -- THE unified math. Each leg is derived INDEPENDENTLY from compensation per
    -- its own basis, rounded once. The employer leg never references the employee
    -- leg — that was the old match basis and it is gone.
    v_employee_leg := CASE
                        WHEN v_employee_basis = 'percent' THEN round(v_comp * v_employee_pct / 100)
                        ELSE round(v_employee_amount)
                      END;
    v_employer_leg := CASE
                        WHEN v_employer_basis = 'percent' THEN round(v_comp * v_employer_pct / 100)
                        ELSE round(v_employer_amount)
                      END;

    -- Nothing to post for this member. Under the unified model this is normally a
    -- deliberate 0/0 configuration (legal and saveable — the employer funds no
    -- pension yet), or a member on zero recorded compensation. It is reported so
    -- the run summary can say who was left out, NOT flagged as a misconfiguration.
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
      -- activity feed and notifications read "UGX 140,000 added to your savings
      -- via MTN Mobile Money" — i.e. as though the member paid it themselves,
      -- when in fact their employer deducted it from their pay and remitted it.
      -- The employer and insurance legs below DO carry p_method, because those
      -- really are the employer's transfer. Parity: src/data/employerSeed.js and
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


-- -----------------------------------------------------------------------------
-- (3) create_employer_invite — collect_schedule is now a CONSTANT TRUE
-- -----------------------------------------------------------------------------
-- `collect_schedule` was set from `default_contribution_config ->> 'mode'`
-- (TRUE only for 'co-contribution'). With `mode` deleted, that expression would
-- evaluate FALSE forever and silently route EVERY future member down the thin
-- KYC branch — so it has to become a decision, not a leftover.
--
-- WHY FALSE. collect_schedule is no longer a funding flag at all — but it is also
-- not purely a server-side KYC-depth switch, because the FRONTEND branches on it:
-- ContributionSettings renders the full wizard (frequency + amount + insurance +
-- "Pay {total}") when it is TRUE, and the compact SplitOnlyView when it is FALSE.
--
-- Both branches of create_subscriber_from_employer_invite already force schedule
-- amount 0 and skip the signup deposit, so a TRUE value asks an invited member to
-- choose a saving amount and pay a first deposit that the server then DISCARDS.
-- Under the unified model the employer sets BOTH legs, so the member has no amount
-- to choose at all — TRUE would put a visible falsehood in front of them.
--
-- FALSE is correct for a sponsored member on every count:
--   • no amount and no deposit are requested (the honest flow);
--   • pension nominees are still collected;
--   • insurance is NOT offered — group cover is employer-funded via the 0067
--     fan-out, and 0068 already REJECTS a member trying to buy a product their
--     employer pays for, so offering it would walk them into a server error;
--   • it is the behaviour employer-only employers already had, so no new risk.
-- What FALSE gives up is insurance-nominee capture, which is moot for a member
-- whose cover is employer-funded and created by the fan-out without nominees.
--
-- The column and the returned `collectSchedule` key are KEPT: the invite frontend
-- and the e2e/unit fixtures read them, and a subsequent migration may want to make
-- this an explicit employer preference rather than a constant.
CREATE OR REPLACE FUNCTION public.create_employer_invite(p_prefill jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role        text := (SELECT auth.jwt()) ->> 'app_role';
  v_employer_id text := (SELECT auth.jwt()) ->> 'employerId';
  -- Not a funding flag. Constant so it cannot silently drift with the config the
  -- way the deleted `mode` read did. See the WHY FALSE note above this function.
  v_collect     CONSTANT boolean := FALSE;
  v_token       text;
  v_phone_norm  text;
BEGIN
  IF v_role IS DISTINCT FROM 'employer' THEN
    RAISE EXCEPTION 'role % cannot invite a member', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RAISE EXCEPTION 'missing employerId claim' USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(COALESCE(p_prefill ->> 'fullName', ''))) < 2 THEN
    RAISE EXCEPTION 'member full name is required';
  END IF;
  IF COALESCE(p_prefill ->> 'phone', '') !~ '^(\+?256)?[0-9]{9}$' THEN
    RAISE EXCEPTION 'a valid member phone is required';
  END IF;

  v_phone_norm := right(regexp_replace(COALESCE(p_prefill ->> 'phone', ''), '[^0-9]', '', 'g'), 9);

  -- Dup-guard: don't invite someone already on this employer's roster …
  IF EXISTS (
    SELECT 1 FROM public.subscribers s
     WHERE s.employer_id = v_employer_id
       AND right(regexp_replace(COALESCE(s.phone, ''), '[^0-9]', '', 'g'), 9) = v_phone_norm
  ) THEN
    RAISE EXCEPTION 'a member with phone % is already on your roster', p_prefill ->> 'phone' USING ERRCODE = 'P0001';
  END IF;
  -- … or already has a live pending invite.
  IF EXISTS (
    SELECT 1 FROM public.employer_invites i
     WHERE i.employer_id = v_employer_id AND i.status = 'pending' AND i.expires_at > now()
       AND right(regexp_replace(COALESCE(i.prefill ->> 'phone', ''), '[^0-9]', '', 'g'), 9) = v_phone_norm
  ) THEN
    RAISE EXCEPTION 'phone % already has a pending invite', p_prefill ->> 'phone' USING ERRCODE = 'P0001';
  END IF;

  v_token := 'inv-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.employer_invites (token, employer_id, prefill, collect_schedule)
  VALUES (v_token, v_employer_id, COALESCE(p_prefill, '{}'::jsonb), v_collect);

  RETURN jsonb_build_object('token', v_token, 'collectSchedule', v_collect);
END; $$;
REVOKE ALL ON FUNCTION public.create_employer_invite(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_employer_invite(jsonb) TO authenticated;

-- 0047:26 documented this column as "true = co-contribution flow", which is now
-- doubly wrong: there are no modes, and the flag never controlled funding.
COMMENT ON COLUMN public.employer_invites.collect_schedule IS
  'SIGNUP DEPTH for the invite, NOT a funding flag. FALSE (the only value written '
  'since 0092) = the compact split-only completion: pension nominees plus the '
  'retirement/emergency split, no contribution amount, no first deposit, no '
  'insurance purchase (group cover is employer-funded by the 0067 fan-out and 0068 '
  'rejects a re-buy). TRUE = the full wizard, which would ask a sponsored member '
  'for an amount and a deposit that the server discards. Neither branch collects a '
  'contribution amount — both legs are payroll-processed from '
  'employers.default_contribution_config.';


-- -----------------------------------------------------------------------------
-- (4) get_employer_metrics — drop `modeSplit`
-- -----------------------------------------------------------------------------
-- `modeSplit` reported the single company mode as a fake per-member split
-- ({ coContribution: headcount, employerOnly: 0 }). With one unified model it is
-- meaningless, and it has ZERO UI consumers across all six roles. Every other key
-- is byte-identical to the live body (0044).
CREATE OR REPLACE FUNCTION public.get_employer_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        text := (SELECT auth.jwt()) ->> 'app_role';
  v_employer_id text := (SELECT auth.jwt()) ->> 'employerId';
  v_sub         record;
  v_tx          record;
  v_insured     integer;
  v_result      jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'employer' THEN
    RAISE EXCEPTION 'role % cannot read employer metrics', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT
    COUNT(*)                                   AS headcount,
    COUNT(*) FILTER (WHERE s.is_active)        AS active,
    COUNT(*) FILTER (WHERE NOT s.is_active)    AS suspended,
    COALESCE(SUM(b.total_balance), 0)          AS total_balance
    INTO v_sub
    FROM public.subscribers s
    LEFT JOIN public.subscriber_balances b ON b.subscriber_id = s.id
   WHERE s.employer_id = v_employer_id;

  SELECT
    COALESCE(SUM(t.amount) FILTER (WHERE t.source = 'own'), 0)      AS own_total,
    COALESCE(SUM(t.amount) FILTER (WHERE t.source = 'employer'), 0) AS employer_total,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source = 'own' AND date_part('year', t.date) = date_part('year', now())), 0)      AS own_ytd,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source = 'employer' AND date_part('year', t.date) = date_part('year', now())), 0) AS employer_ytd
    INTO v_tx
    FROM public.transactions t
    JOIN public.subscribers s ON s.id = t.subscriber_id
   WHERE s.employer_id = v_employer_id
     AND t.type = 'contribution';

  SELECT COUNT(*) INTO v_insured
    FROM public.insurance_policies ip
    JOIN public.subscribers s ON s.id = ip.subscriber_id
   WHERE s.employer_id = v_employer_id
     AND ip.status = 'active';

  v_result := jsonb_build_object(
    'headcount',             COALESCE(v_sub.headcount, 0),
    'active',                COALESCE(v_sub.active, 0),
    'suspended',             COALESCE(v_sub.suspended, 0),
    'totalBalance',          COALESCE(v_sub.total_balance, 0),
    'totalContributions',    COALESCE(v_tx.own_total, 0) + COALESCE(v_tx.employer_total, 0),
    'ownContributions',      COALESCE(v_tx.own_total, 0),
    'employerContributions', COALESCE(v_tx.employer_total, 0),
    'insuredCount',          COALESCE(v_insured, 0),
    'employerYtd',           COALESCE(v_tx.employer_ytd, 0),
    'employeeYtd',           COALESCE(v_tx.own_ytd, 0)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_metrics() TO authenticated;


-- -----------------------------------------------------------------------------
-- (5) get_my_employer_funding() → jsonb | null   (NEW, subscriber-scoped)
-- -----------------------------------------------------------------------------
-- WHY THIS EXISTS. The only SELECT policies on public.employers are
-- `employer_self_select` (0036) and `employers_select_admin` (0049), so a
-- subscriber JWT cannot read its own employer row — not the contribution config,
-- not even the employer's NAME. That is why the subscriber Policies page's
-- "Paid by {employerName}" badge always fell back to "your employer", and why a
-- sponsored member had no way to see that their pension is payroll-funded.
--
-- WHY NOT WIDEN RLS. A subscriber-facing SELECT policy on public.employers would
-- expose the WHOLE row — contact_name / contact_phone / contact_email /
-- registration_no / district — to every member of every employer. A narrow
-- SECURITY DEFINER RPC that returns only the funding facts is the correct shape.
--
-- Returns jsonb `null` when the member is not employer-sponsored, so callers can
-- treat "no employer" as a normal state (hide the funding surface) rather than an
-- error. Uses the SAME `_normalize_contribution_config` as the run RPC (2), so
-- what the member is told and what the run actually posts can never disagree.
CREATE OR REPLACE FUNCTION public.get_my_employer_funding()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        text := (SELECT auth.jwt()) ->> 'app_role';
  v_sub_id      text := (SELECT auth.jwt()) ->> 'subscriberId';
  v_employer_id text;
  v_comp        numeric;
  v_name        text;
  v_config      jsonb;
  v_norm        jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'subscriber' THEN
    RAISE EXCEPTION 'role % cannot read employer funding', v_role USING ERRCODE = 'P0001';
  END IF;
  IF v_sub_id IS NULL OR v_sub_id = '' THEN
    RAISE EXCEPTION 'missing subscriberId claim' USING ERRCODE = 'P0001';
  END IF;

  -- The subscriber is derived from the VERIFIED claim — never from an argument.
  SELECT s.employer_id, COALESCE(s.compensation, 0)
    INTO v_employer_id, v_comp
    FROM public.subscribers s
   WHERE s.id = v_sub_id;

  -- Self-funded saver (the overwhelming majority — the agent→subscriber tree) or
  -- a claim pointing at a row that no longer exists. Not an error.
  IF v_employer_id IS NULL OR v_employer_id = '' THEN
    RETURN 'null'::jsonb;
  END IF;

  SELECT e.name, COALESCE(e.default_contribution_config, '{}'::jsonb)
    INTO v_name, v_config
    FROM public.employers e
   WHERE e.id = v_employer_id;

  -- Employer row deleted out from under the tag: degrade to "not sponsored"
  -- rather than raising into the member's dashboard.
  IF NOT FOUND THEN
    RETURN 'null'::jsonb;
  END IF;

  v_norm := public._normalize_contribution_config(v_config);

  -- ONLY the funding facts. No contact details, no registration number.
  -- `compensation` is the member's OWN pay, which they are already shown
  -- elsewhere, and it is what turns a percent basis into shillings client-side.
  RETURN jsonb_build_object(
    'employerName',   v_name,
    'employeeBasis',  COALESCE(NULLIF(v_norm ->> 'employeeBasis', ''), 'percent'),
    'employeePct',    COALESCE(NULLIF(v_norm ->> 'employeePct',    '')::numeric, 0),
    'employeeAmount', COALESCE(NULLIF(v_norm ->> 'employeeAmount', '')::numeric, 0),
    'employerBasis',  COALESCE(NULLIF(v_norm ->> 'employerBasis', ''), 'percent'),
    'employerPct',    COALESCE(NULLIF(v_norm ->> 'employerPct',    '')::numeric, 0),
    'employerAmount', COALESCE(NULLIF(v_norm ->> 'employerAmount', '')::numeric, 0),
    'compensation',   COALESCE(v_comp, 0)
  );
END;
$$;

-- A prior platform audit flagged anon-executable ungated RPCs as the top risk on
-- this project. A freshly created function carries a default PUBLIC EXECUTE grant
-- (which is how anon inherits access transitively — see the 0086 header), so the
-- REVOKE must name PUBLIC, not just anon.
REVOKE ALL ON FUNCTION public.get_my_employer_funding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_employer_funding() TO authenticated;

COMMENT ON FUNCTION public.get_my_employer_funding() IS
  'Subscriber-scoped read of who funds the caller''s pension: employer name, the '
  'six unified contribution keys, and the caller''s own compensation. Exists so '
  'members can see payroll funding without a SELECT policy that would expose the '
  'whole employers row. Returns jsonb null when not employer-sponsored.';


-- -----------------------------------------------------------------------------
-- (6) create_employer — shape validation for the unified config
-- -----------------------------------------------------------------------------
-- Adds light validation of the unified pension keys on top of the live body
-- (0053). '{}' stays legal — it is the 0/0 provisioning default used by the admin
-- CreateEmployer form and by approve_access_request (0090) — but a basis that IS
-- present must name a real basis, and a percentage that IS present must be a
-- number in 0-100. Nothing else about the function changes.
CREATE OR REPLACE FUNCTION public.create_employer(
  p_name                        text,
  p_sector                      text  DEFAULT NULL,
  p_registration_no             text  DEFAULT NULL,
  p_contact_name                text  DEFAULT NULL,
  p_contact_phone               text  DEFAULT NULL,
  p_contact_email               text  DEFAULT NULL,
  p_district                    text  DEFAULT NULL,
  p_payroll_cadence             text  DEFAULT NULL,
  p_default_contribution_config jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   text  := (SELECT auth.jwt()) ->> 'app_role';
  v_config jsonb := COALESCE(p_default_contribution_config, '{}'::jsonb);
  v_key    text;
  v_id     text;
  v_row    public.employers%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot create an employer', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'employer name is required' USING ERRCODE = 'P0001';
  END IF;

  -- Length caps (§2a.8).
  IF length(btrim(p_name))                    > 160 THEN RAISE EXCEPTION 'employer name is too long (max 160)'    USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_sector,          '')) > 80   THEN RAISE EXCEPTION 'sector is too long (max 80)'            USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_registration_no, '')) > 64   THEN RAISE EXCEPTION 'registration no is too long (max 64)'   USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_name,    '')) > 120  THEN RAISE EXCEPTION 'contact name is too long (max 120)'     USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_phone,   '')) > 32   THEN RAISE EXCEPTION 'contact phone is too long (max 32)'      USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_contact_email,   '')) > 254  THEN RAISE EXCEPTION 'contact email is too long (max 254)'     USING ERRCODE = 'P0001'; END IF;
  IF length(COALESCE(p_payroll_cadence, '')) > 32   THEN RAISE EXCEPTION 'payroll cadence is too long (max 32)'    USING ERRCODE = 'P0001'; END IF;

  -- Format checks (only when a value is supplied).
  IF NULLIF(btrim(p_contact_phone), '') IS NOT NULL
     AND btrim(p_contact_phone) !~ '^\+?[0-9 ()-]{7,32}$' THEN
    RAISE EXCEPTION 'contact phone is not a valid phone number' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(p_contact_email), '') IS NOT NULL
     AND btrim(p_contact_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'contact email is not a valid email address' USING ERRCODE = 'P0001';
  END IF;

  -- District (when supplied) must exist (§1b.5).
  IF NULLIF(btrim(p_district), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.districts WHERE id = btrim(p_district)) THEN
    RAISE EXCEPTION 'district % does not exist', p_district USING ERRCODE = 'P0001';
  END IF;

  -- Config must be a jsonb OBJECT (§2a.8: a malformed config is read on every
  -- contribution run for the two pension legs and the group-insurance keys).
  IF jsonb_typeof(v_config) <> 'object' THEN
    RAISE EXCEPTION 'default contribution config must be a JSON object' USING ERRCODE = 'P0001';
  END IF;

  -- 0092 — shape of the unified two-leg config. An EMPTY config stays legal: '{}'
  -- is how this function and approve_access_request provision a new employer, and
  -- it normalises to a legal 0/0 (funds no pension until the employer sets it up).
  -- Only keys that ARE present are checked, and only for shape — there is no cap
  -- and no minimum on either leg by design.
  FOREACH v_key IN ARRAY ARRAY['employeeBasis', 'employerBasis'] LOOP
    IF (v_config -> v_key) IS NOT NULL AND jsonb_typeof(v_config -> v_key) <> 'null'
       AND COALESCE(v_config ->> v_key, '') NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION '% must be "percent" or "fixed"', v_key USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY['employeePct', 'employerPct'] LOOP
    IF (v_config -> v_key) IS NOT NULL AND jsonb_typeof(v_config -> v_key) <> 'null' THEN
      -- Type-check BEFORE casting so a garbage value gets the friendly P0001 the
      -- service layer surfaces, not a raw 22P02 invalid_text_representation.
      IF jsonb_typeof(v_config -> v_key) <> 'number' THEN
        RAISE EXCEPTION '% must be a number', v_key USING ERRCODE = 'P0001';
      END IF;
      IF (v_config ->> v_key)::numeric < 0 OR (v_config ->> v_key)::numeric > 100 THEN
        RAISE EXCEPTION '% must be between 0 and 100', v_key USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  v_id := 'emp-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.employers (
    id, name, sector, registration_no, contact_name, contact_phone,
    contact_email, district, payroll_cadence, default_contribution_config
  ) VALUES (
    v_id, btrim(p_name),
    NULLIF(btrim(p_sector), ''), NULLIF(btrim(p_registration_no), ''),
    NULLIF(btrim(p_contact_name), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_contact_email), ''), NULLIF(btrim(p_district), ''),
    NULLIF(btrim(p_payroll_cadence), ''), v_config
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_employer(text, text, text, text, text, text, text, text, jsonb) TO authenticated;

-- =============================================================================
-- End of 0092_unified_contribution_config.sql
-- Reversible via 0092_unified_contribution_config.down.sql (restores 0067's run
-- RPC, 0047's create_employer_invite, 0044's get_employer_metrics and 0053's
-- create_employer, and drops the two new functions).
-- =============================================================================
