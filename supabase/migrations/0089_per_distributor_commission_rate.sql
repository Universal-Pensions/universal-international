-- 0089_per_distributor_commission_rate.sql
-- Makes the commission rate per-distributor. This was the last unscoped WRITE
-- in the platform: `commission_config` held ONE row (`id='default'`) and
-- `commission_config_update_distributor` gated only on `app_role='distributor'`,
-- so d-002 could change the rate d-001's commissions are generated at.
-- Unlike every other tenancy gap in the 0081-0088 series this could not be
-- fixed by scoping a predicate — there was nothing to scope against.
--
-- ── SHAPE ────────────────────────────────────────────────────────────────────
-- `commission_config` gains a nullable `distributor_id`:
--   * one row per distributor  → that operator's rate
--   * the pre-existing `id='default'` row (distributor_id IS NULL) is retained
--     as the PLATFORM FALLBACK, used when a distributor has no row of its own
--     (e.g. one created after this migration) and owned by the admin.
-- A partial unique index keeps it to at most one config per distributor.
--
-- ── WHAT DOES NOT CHANGE ─────────────────────────────────────────────────────
-- Existing `commissions` rows are untouched. The rate is read ONCE, at
-- first-contribution time, and the resulting amount is stored on the commission
-- row — so historical commissions keep the amount they were generated with and
-- changing a rate is never retroactive. That is pre-existing behaviour and the
-- reason this migration needs no data backfill on `commissions`.
--
-- ── RATE RESOLUTION ──────────────────────────────────────────────────────────
-- `trg_transactions_contribution` already resolves the subscriber's branch
-- (`v_branch_id`) before it looks the rate up, so the owning distributor is one
-- join away. The lookup moves into `commission_rate_for_branch()` so the
-- fallback chain lives in exactly one place.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Schema
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.commission_config
  ADD COLUMN IF NOT EXISTS distributor_id text
    REFERENCES public.distributors(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.commission_config.distributor_id IS
  'Owning distributor. NULL = the platform fallback row (id=''default''), used '
  'when a distributor has no config of its own. At most one row per distributor.';

CREATE UNIQUE INDEX IF NOT EXISTS commission_config_distributor_key
  ON public.commission_config (distributor_id) WHERE distributor_id IS NOT NULL;

-- 0001 enforced the singleton with `CHECK (id = 'default')`. Relax it to the
-- per-distributor shape rather than dropping it — the point of that constraint
-- was to stop arbitrary config rows appearing, and that still holds. Exactly two
-- legal shapes now: the platform fallback, or one deterministically-named row
-- per distributor (so the id can never drift from the owner it claims).
ALTER TABLE public.commission_config DROP CONSTRAINT IF EXISTS commission_config_id_check;
ALTER TABLE public.commission_config ADD CONSTRAINT commission_config_id_check
  CHECK (
       (distributor_id IS NULL     AND id = 'default')
    OR (distributor_id IS NOT NULL AND id = 'cfg-' || distributor_id)
  );

-- 2) Backfill — every existing distributor inherits today's platform rate, so
--    no operator's economics change on the day this ships.
INSERT INTO public.commission_config (id, distributor_id, rate, cadence, last_updated_by, updated_at)
SELECT 'cfg-' || d.id, d.id, def.rate, def.cadence, '0089-backfill', now()
  FROM public.distributors d
 CROSS JOIN (SELECT rate, cadence FROM public.commission_config WHERE id = 'default') def
 WHERE NOT EXISTS (
   SELECT 1 FROM public.commission_config c WHERE c.distributor_id = d.id
 );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Resolution helper. SECURITY DEFINER so the trigger resolves the chain
--    regardless of who is inserting the transaction (a subscriber paying in
--    cannot read `branches`). Falls back to the platform row, then to NULL —
--    the trigger already treats a NULL rate as "generate no commission".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.commission_rate_for_branch(p_branch_id text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT c.rate
       FROM public.branches b
       JOIN public.commission_config c ON c.distributor_id = b.distributor_id
      WHERE b.id = p_branch_id),
    (SELECT c.rate FROM public.commission_config c WHERE c.id = 'default')
  );
$$;

REVOKE ALL   ON FUNCTION public.commission_rate_for_branch(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_rate_for_branch(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) The caller's own effective rate, for the Commissions settings UI.
--    Replaces a direct `.from('commission_config').eq('id','default')` client
--    read, which would now return the wrong operator's rate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_commission_rate()
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT c.rate FROM public.commission_config c
      WHERE c.distributor_id = NULLIF((SELECT auth.jwt()) ->> 'distributorId', '')),
    (SELECT c.rate FROM public.commission_config c WHERE c.id = 'default')
  );
$$;

REVOKE ALL   ON FUNCTION public.get_commission_rate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commission_rate() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) set_commission_rate — writes the CALLER'S OWN row.
--    A distributor upserts its own config; the admin edits the platform
--    fallback. Neither can now touch another operator's rate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_commission_rate(p_rate numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_role     text    := (SELECT auth.jwt()) ->> 'app_role';
  v_dist     text    := NULLIF((SELECT auth.jwt()) ->> 'distributorId', '');
  v_rate_max numeric := 1000000;   -- 1,000,000 UGX/subscriber ceiling (0055)
  v_rate     numeric;
BEGIN
  IF v_role NOT IN ('distributor', 'admin') THEN
    RAISE EXCEPTION 'role % cannot set the commission rate', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_rate IS NULL THEN
    RAISE EXCEPTION 'commission rate is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_rate < 0 OR p_rate > v_rate_max THEN
    RAISE EXCEPTION 'commission rate % out of range [0, %]', p_rate, v_rate_max
      USING ERRCODE = 'P0001';
  END IF;

  IF v_role = 'distributor' THEN
    IF v_dist IS NULL THEN
      RAISE EXCEPTION 'distributor identity missing from token' USING ERRCODE = 'P0001';
    END IF;
    -- Upsert: a distributor created after 0089's backfill has no row yet.
    INSERT INTO public.commission_config (id, distributor_id, rate, cadence, last_updated_by, updated_at)
    SELECT 'cfg-' || v_dist, v_dist, p_rate,
           COALESCE((SELECT cadence FROM public.commission_config WHERE id = 'default'), 'monthly-first'),
           v_dist, now()
    ON CONFLICT (distributor_id) WHERE distributor_id IS NOT NULL
    DO UPDATE SET rate = EXCLUDED.rate, last_updated_by = EXCLUDED.last_updated_by, updated_at = now()
    RETURNING rate INTO v_rate;
  ELSE
    UPDATE public.commission_config
       SET rate = p_rate, last_updated_by = 'admin', updated_at = now()
     WHERE id = 'default'
    RETURNING rate INTO v_rate;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'commission_config row not found' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_rate;
END;
$$;

REVOKE ALL ON FUNCTION public.set_commission_rate(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_commission_rate(numeric) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RLS. The direct UPDATE grant is dropped entirely: the only supported write
--    path is the RPC above, which validates the range and picks the right row.
--    (0055 already routed the client through the RPC; the table grant was a
--    leftover.) Reads are scoped so an operator sees its own row + the fallback.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS commission_config_update_distributor ON public.commission_config;

DROP POLICY IF EXISTS commission_config_select_authenticated ON public.commission_config;
CREATE POLICY commission_config_select_authenticated ON public.commission_config
  FOR SELECT USING (
    ((SELECT auth.jwt()) ->> 'app_role') IS NOT NULL
    AND (
      -- The platform fallback stays readable by every role: branch/agent
      -- surfaces show "commission per subscriber" without a distributorId claim.
      distributor_id IS NULL
      OR ((SELECT auth.jwt()) ->> 'app_role') = 'admin'
      OR distributor_id = NULLIF((SELECT auth.jwt()) ->> 'distributorId', '')
    ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Re-emit trg_transactions_contribution with ONLY the rate lookup changed.
--    Generated by an asserted single-match transform of the live definition and
--    diffed to prove nothing else moved (the rest of this ~200-line trigger is
--    the 0072 save-to-cover accrual/sweep block and must not be disturbed).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_transactions_contribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

COMMIT;
