-- DOWN for 0144_transaction_pricing_columns.sql
-- ============================================================================
-- Removes the audit trail and restores the two money triggers to their exact
-- pre-0144 bodies.
--
-- SAFE: no money is involved in either direction. 0144 added metadata columns
-- and two recording statements; this drops the columns and the statements. No
-- balance, unit count or price changes.
--
-- DATA LOSS: every `unit_price_applied` and `units_delta` recorded since 0144
-- was applied is destroyed, and cannot be reconstructed — that record is the
-- whole reason the columns exist. Dump them before running this if the drift
-- measurement matters:
--     CREATE TABLE _tx_pricing_backup AS SELECT id, received_at, dealing_date,
--       pricing_status, unit_price_applied, units_delta, nav_snapshot_id,
--       priced_at, dealing_date_original FROM public.transactions
--      WHERE unit_price_applied IS NOT NULL;
-- (and give it RLS — see 0127.)
--
-- ORDER MATTERS: the trigger bodies below must be restored BEFORE the columns
-- are dropped, or the DROP fails on a dependent function.
--
-- The two trigger bodies are reproduced VERBATIM from the live catalog
-- (pg_get_functiondef) as they stood immediately before 0144 was applied —
-- generated, not retyped.
-- ============================================================================

DROP TRIGGER   IF EXISTS transactions_before_insert_stamp ON public.transactions;
DROP FUNCTION  IF EXISTS public.trg_transactions_stamp_dealing();

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
    -- ── 0115 [A05-013] · one onboarding commission per MEMBER, ever ─────────
    -- This guard used to read `... AND agent_id = v_agent_id`, i.e. "at most
    -- one commission per (agent, member) pair". Move the member to a different
    -- agent and post another contribution and the pair is new, so a SECOND
    -- 5,000 UGX onboarding commission is paid for the same person. Reproduced
    -- live. The invariant the product actually means is one onboarding
    -- commission per member — the money is paid for signing them up, and they
    -- are only signed up once. ux_commissions_subscriber (below) enforces the
    -- same thing at the table, so a future rewrite of this body cannot quietly
    -- reopen it.
    IF NOT EXISTS (
      SELECT 1 FROM public.commissions
       WHERE subscriber_id = NEW.subscriber_id
    ) THEN
      -- 0089: the rate is per-DISTRIBUTOR now. `v_branch_id` is already
      -- resolved above, and the helper walks branch -> distributor -> its rate,
      -- falling back to the platform `id='default'` row. A NULL result still
      -- means "generate no commission", exactly as before.
      v_commission_rate := public.commission_rate_for_branch(v_branch_id);

      -- ── 0115 [A05-012] · a rate of 0 means NO commission, not a 0 one ──────
      -- `IS NOT NULL` let a deliberately-configured rate of 0 through, and the
      -- INSERT below then wrote a UGX 0 row with status 'due'. An operator who
      -- turns commission off got a ledger full of zero-value dues, inflating
      -- every "N commissions owed" count and every agent's record count.
      -- 0 now means what it says. The `< 'Infinity'` test is not decoration:
      -- in Postgres NaN sorts ABOVE every numeric, so `v_commission_rate > 0`
      -- alone is TRUE for NaN — the same trap 0114 documents at length.
      IF v_commission_rate IS NOT NULL
         AND v_commission_rate > 0
         AND v_commission_rate < 'Infinity'::numeric THEN
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

CREATE OR REPLACE FUNCTION public.trg_transactions_withdrawal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ret_take       NUMERIC;
  v_emg_take       NUMERIC;
  v_current_emg    NUMERIC;
  v_amount         NUMERIC := ABS(NEW.amount);  -- defensive: treat as magnitude
BEGIN
  -- Resolve the split first.
  IF NEW.split_retirement IS NOT NULL AND NEW.split_emergency IS NOT NULL THEN
    v_ret_take := NEW.split_retirement;
    v_emg_take := NEW.split_emergency;
  ELSE
    -- Read current emergency balance to compute the fallback.
    SELECT emergency_balance
      INTO v_current_emg
      FROM public.subscriber_balances
     WHERE subscriber_id = NEW.subscriber_id;

    v_current_emg := COALESCE(v_current_emg, 0);

    IF v_amount <= v_current_emg THEN
      v_emg_take := v_amount;
      v_ret_take := 0;
    ELSE
      v_emg_take := v_current_emg;
      v_ret_take := v_amount - v_current_emg;
    END IF;
  END IF;

  UPDATE public.subscriber_balances
     SET retirement_balance = GREATEST(0, retirement_balance - v_ret_take),
         emergency_balance  = GREATEST(0, emergency_balance  - v_emg_take),
         total_balance      = GREATEST(0, total_balance - v_amount),
         updated_at         = now()
   WHERE subscriber_id = NEW.subscriber_id;

  RETURN NEW;
END;
$function$;

DROP INDEX IF EXISTS public.ix_transactions_pending;
DROP INDEX IF EXISTS public.ix_transactions_received;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_nav_snapshot_fk;

ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS received_at,
  DROP COLUMN IF EXISTS dealing_date,
  DROP COLUMN IF EXISTS pricing_status,
  DROP COLUMN IF EXISTS unit_price_applied,
  DROP COLUMN IF EXISTS units_delta,
  DROP COLUMN IF EXISTS nav_snapshot_id,
  DROP COLUMN IF EXISTS priced_at,
  DROP COLUMN IF EXISTS dealing_date_original;
