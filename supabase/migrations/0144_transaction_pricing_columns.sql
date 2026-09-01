-- 0144_transaction_pricing_columns.sql
-- ============================================================================
-- PHASE 2 of the unitization redesign. EXPAND, and start telling the truth.
--
-- Every transaction gains the columns that record what it was priced at, WHILE
-- PRICING STILL HAPPENS EXACTLY AS IT DOES TODAY. Nothing in this migration
-- changes a balance, a unit count or a price. INV-1 must come back byte-
-- identical.
--
-- WHY THIS PHASE EARNS ITS KEEP ON ITS OWN
-- ----------------------------------------
-- Today the price a contribution was struck at is NOT RECORDED ANYWHERE. It is
-- computed inside the trigger, used to divide, and thrown away. That is why the
-- historical mispricing in §9 of the plan has to be reconstructed by re-running
-- `nav_for_date` over `t.date` rather than simply read. From this migration
-- forward every new contribution records its own price, so the drift between
-- what we DO and what the rule SAYS is measurable per row instead of inferred.
--
-- A DESIGN CORRECTION THE PLAN DID NOT ANTICIPATE
-- -----------------------------------------------
-- The plan has the two money triggers stamp `dealing_date` "at the top". They
-- cannot: `transactions_after_insert_contribution` and its withdrawal sibling
-- are both AFTER INSERT, and an assignment to NEW in an AFTER trigger is
-- discarded silently. So the stamp gets its own BEFORE INSERT trigger,
-- `transactions_before_insert_stamp`, which fires for EVERY type — including
-- `premium`, `claim` and `insurance_premium`, which no AFTER trigger touches.
--
-- That turns out to be the better shape anyway, and Phase 6 depends on it: the
-- lifecycle state of a transaction is decided in exactly ONE place, before the
-- row exists, rather than in two AFTER triggers that would each have to
-- re-derive it.
--
-- ⚠️ POSTGRES 11+ STAMPS EXISTING ROWS WITH A NON-VOLATILE ADD COLUMN DEFAULT.
--    All 27,433 existing rows land as `pricing_status = 'pending'` the instant
--    the column is added, so a backfill written as `WHERE pricing_status IS
--    NULL` matches NOTHING and silently no-ops. This is the exact trap recorded
--    from the 0103-0106 NAV work. The backfill below therefore keys on `type`,
--    never on IS NULL.
--
--    IT APPLIES TO `received_at` TOO, AND THAT IS THE EASY ONE TO MISS. The
--    column is added `DEFAULT now()`, so every pre-existing row is stamped with
--    THIS MIGRATION'S OWN TIMESTAMP. A backfill written the obvious way —
--    `received_at = COALESCE(received_at, date)` — therefore finds a non-NULL
--    value and keeps it, and all 27,433 historical rows end up claiming they
--    were received the moment the migration ran. Measured, not theorised: the
--    first run of this migration did exactly that, and every one of the 24,037
--    priced rows then reported a dealing date EARLIER than its own receipt
--    date — the precise invariant this project exists to guarantee, violated by
--    the migration that introduces it. The assignment below is unconditional
--    for that reason.
--
-- WHAT IS DELIBERATELY LEFT NULL ON HISTORY
-- -----------------------------------------
-- `unit_price_applied`, `units_delta` and `nav_snapshot_id` stay NULL for all
-- 27,433 pre-existing rows. The per-transaction price was never stored and
-- cannot be recovered without re-striking balances, which §9 of the plan
-- forbids. A NULL that says "we do not know" is worth more than a reconstructed
-- number that reads like a record.
--
-- WHY WITHDRAWALS RECORD A PRICE BUT NOT A UNITS DELTA
-- ----------------------------------------------------
-- `trg_transactions_withdrawal` debits the two POT BALANCES and nothing else;
-- the units debit lives in `request_withdrawal`, which runs it AFTER this
-- trigger has already returned. Worse, a withdrawal row written by the seed
-- never debits units at all, because it never goes through that RPC. Recording
-- a units_delta here would therefore assert a unit movement that, for some
-- rows, did not happen. The price is real and is recorded; the delta waits for
-- Phase 6, where the engine is the single thing that moves units in either
-- direction.
--
-- ROLLBACK: 0144_transaction_pricing_columns.down.sql drops the eight columns
-- and both indexes and re-emits both trigger bodies verbatim from their
-- pre-0144 (0115/0116) form. Dropping a column is instant and loses only
-- metadata — no money is involved in either direction.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The audit-trail columns
-- ─────────────────────────────────────────────────────────────────────────────
-- No CHECK constraints in this phase. They arrive in 0149 (Phase 8), once live
-- data has proved they hold, and `transactions_priced_complete_chk` will be
-- NOT VALID so history is never retro-judged by a rule it predates.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS received_at           TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dealing_date          DATE,
  ADD COLUMN IF NOT EXISTS pricing_status        TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS unit_price_applied    NUMERIC,
  ADD COLUMN IF NOT EXISTS units_delta           NUMERIC,
  ADD COLUMN IF NOT EXISTS nav_snapshot_id       TEXT,
  ADD COLUMN IF NOT EXISTS priced_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dealing_date_original DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_nav_snapshot_fk') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_nav_snapshot_fk
      FOREIGN KEY (nav_snapshot_id) REFERENCES public.nav_snapshots(id);
  END IF;
END $$;

COMMENT ON COLUMN public.transactions.received_at IS
  'The true receipt instant, and the ONLY input to the dealing-date derivation. IMMUTABLE: unlike `date`, this is never back-dated by a seed or a re-anchor migration. That is precisely why it exists - `date` already carries now() for runtime rows but is also the field 0134/0135/0138 rewrite.';
COMMENT ON COLUMN public.transactions.dealing_date IS
  'The date whose published price applies to this transaction. Derived ONCE at insert from received_at by dealing_date_for(). Never earlier than the Kampala calendar date of receipt.';
COMMENT ON COLUMN public.transactions.pricing_status IS
  'Lifecycle: pending (received, awaiting a price) -> priced (units allocated or cancelled). not_applicable = never touches the fund (premium, claim, insurance_premium). rejected = could not be filled at the dealing price. reversed = unwound by reverse_transaction().';
COMMENT ON COLUMN public.transactions.unit_price_applied IS
  'The price this transaction was ACTUALLY struck at. NULL on the 27,433 rows that predate 0144 - it was never recorded and cannot be recovered without re-striking balances.';
COMMENT ON COLUMN public.transactions.units_delta IS
  'Signed change in the member unit holding: positive when units were allocated, negative when cancelled. NULL until the transaction is priced.';
COMMENT ON COLUMN public.transactions.dealing_date_original IS
  'Set only when a stalled row is re-dealt forward because its dealing date was never priced (plan D11). NULL means the row dealt on its first-derived date. Makes every roll-forward countable.';

-- The partial index is what makes Phase 6's opportunistic sweep cheap: it is
-- the entire working set of the pricing engine and nothing else.
CREATE INDEX IF NOT EXISTS ix_transactions_pending
  ON public.transactions (dealing_date, id) WHERE pricing_status = 'pending';
CREATE INDEX IF NOT EXISTS ix_transactions_received
  ON public.transactions (received_at);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Backfill — a DECLARATION about history, not a re-derivation
-- ─────────────────────────────────────────────────────────────────────────────
-- This says "this row was priced, on this date", which is exactly what
-- happened. It touches no balance column, allocates no units and moves no
-- money. Keyed on `type`, never on IS NULL (see the header).
UPDATE public.transactions SET
  -- UNCONDITIONAL, not COALESCE — see the ADD COLUMN DEFAULT warning in the
  -- header. Every row visible to this statement predates the migration, so
  -- `date` is the best available record of when the money actually arrived.
  received_at    = date,
  dealing_date   = date::date,
  pricing_status = CASE WHEN type IN ('contribution', 'withdrawal', 'premium_sweep')
                        THEN 'priced' ELSE 'not_applicable' END,
  priced_at      = created_at;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The stamp — one place where a transaction's lifecycle begins
-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE INSERT, every type. In Phase 2 it is observational: `pricing_status`
-- is set to its terminal value immediately because pricing is still
-- synchronous. Phase 6 changes ONLY the CASE below, to read
-- fund_dealing_config.pricing_enabled and stamp 'pending' instead.
--
-- `dealing_date` is derived here even for types that never touch the fund, so
-- 0149 can make the column NOT NULL without carving out exceptions.
CREATE OR REPLACE FUNCTION public.trg_transactions_stamp_dealing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Never back-dated. A caller may supply it (a genuine late-recorded receipt),
  -- but the default is the real instant this row reached us.
  IF NEW.received_at IS NULL THEN
    NEW.received_at := now();
  END IF;

  IF NEW.dealing_date IS NULL THEN
    NEW.dealing_date := public.dealing_date_for(NEW.received_at);
  END IF;

  -- PHASE 2: pricing is still synchronous, so a money row is priced by the time
  -- this statement completes. Phase 6 branches here on pricing_enabled.
  NEW.pricing_status := CASE
    WHEN NEW.type IN ('contribution', 'withdrawal', 'premium_sweep') THEN 'priced'
    ELSE 'not_applicable'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_before_insert_stamp ON public.transactions;
CREATE TRIGGER transactions_before_insert_stamp
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_transactions_stamp_dealing();

REVOKE ALL ON FUNCTION public.trg_transactions_stamp_dealing() FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) trg_transactions_contribution — unchanged behaviour, now it keeps a record
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-emitted VERBATIM from its 0115 body with exactly three additions, each
-- marked `0144:`. No pricing, splitting, sweep, accrual, indexation or
-- commission logic is touched.
--
--   (i)   one UPDATE recording the price and units this contribution was
--         actually struck at;
--   (ii)  v_sweep_units, so the save-to-cover sweep's unit debit is computed
--         ONCE and both applied and recorded from the same value rather than
--         re-derived (the two would silently disagree the day the expression
--         changed);
--   (iii) the sweep's own marker row now carries its price and units, closing
--         the one money row in the schema that no trigger records.
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
  v_sweep_units      NUMERIC;   -- 0144: computed once, applied and recorded
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

  -- 0144 (i): record what this contribution was actually struck at. This is
  -- metadata only — the allocation above already happened and is untouched.
  UPDATE public.transactions
     SET unit_price_applied = v_unit_price,
         units_delta        = NEW.amount / v_unit_price,
         priced_at          = now()
   WHERE id = NEW.id;

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
          -- 0144 (ii): compute the unit debit ONCE. `units` here is the holding
          -- before the sweep, which is exactly what the UPDATE's SET right-hand
          -- sides read, so this is behaviour-identical to the inline LEAST() it
          -- replaces — and it is now the same number that gets recorded.
          SELECT LEAST(v_target / v_unit_price, units) INTO v_sweep_units
            FROM public.subscriber_balances WHERE subscriber_id = NEW.subscriber_id;

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
                 units             = units - v_sweep_units,
                 invested          = CASE WHEN units > 0
                                       THEN GREATEST(0, invested * (1 - v_sweep_units / units))
                                       ELSE 0 END,
                 nav_as_of         = CURRENT_DATE,
                 updated_at        = now()
           WHERE subscriber_id = NEW.subscriber_id;
          PERFORM public._resync_bucket_units(NEW.subscriber_id);

          -- Internal, non-recursive marker row. amount = -target (NEGATIVE).
          -- type='premium_sweep' matches neither AFTER trigger's WHEN clause.
          -- 0144 (iii): it does now carry its own price and unit movement — this
          -- was the one money row in the schema nothing recorded.
          INSERT INTO public.transactions
            (id, subscriber_id, type, amount, date, status, method, txn_ref, source,
             unit_price_applied, units_delta, priced_at)
          VALUES ('tx-' || NEW.subscriber_id || '-sweep-' || replace(gen_random_uuid()::text, '-', ''),
                  NEW.subscriber_id, 'premium_sweep', -v_target, now(), 'settled',
                  'internal', 'SW-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0'), 'own',
                  v_unit_price, -v_sweep_units, now());

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


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) trg_transactions_withdrawal — unchanged behaviour, records the price
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-emitted verbatim from its 0114 body with ONE addition, marked `0144:`.
-- See the header for why the units delta is deliberately not recorded here.
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

  -- 0144: record the price this redemption was struck at. latest_nav() is
  -- STABLE, so this is the SAME value request_withdrawal computed a few
  -- statements earlier in this transaction, not a second reading.
  UPDATE public.transactions
     SET unit_price_applied = public.latest_nav(),
         priced_at          = now()
   WHERE id = NEW.id;

  RETURN NEW;
END;
$function$;
