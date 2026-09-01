-- DOWN for 0152_withdrawal_ledger_link.sql
-- ============================================================================
-- Drops withdrawals.transaction_id and restores the four functions 0152
-- rewrote, each to the body it had immediately before:
--
--   request_withdrawal          <- 0147
--   price_pending_transactions  <- 0151
--   reverse_transaction         <- 0148
--   settle_withdrawal           <- 0147
--
-- ⚠️ REGRESSION WARNING — THIS GOES BACK TO MATCHING MONEY BY REFERENCE STRING.
-- 0152 exists because a withdrawal and its ledger transaction had no explicit
-- link: settle_withdrawal() and reverse_transaction() found each other by
-- pattern-matching txn_ref. That works until two rows share a shape, and the
-- failure mode is settling or reversing the WRONG member's money. The FK and
-- its unique index are what make the pairing a fact rather than a guess.
--
-- ⚠️ ALSO SILENTLY UNDOES 0153, 0154 (both reversal defects), 0156, 0157, 0160
-- and 0161, because those rewrite the same functions and this restores bodies
-- that predate them. Reversing this one migration therefore reinstates: the
-- withdrawal-reversal sign bug, cost-basis inflation, the per-bucket shortfall
-- that created phantom money, the pending_orphan release path, the sweep
-- ignoring redemption holds, and the engine's stale book price under lock.
-- docs/runbooks/nav-publishing.md carries the full table.
--
-- ORDER MATTERS: the functions are restored FIRST (the pre-0152 bodies do not
-- reference transaction_id), and only then is the column dropped.
-- ============================================================================

-- ── request_withdrawal() — restored from 0147 ──────────────────────────
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
  v_async         boolean;                  -- 0147: forward-dealing in force?
  v_tx_dealing    date;                     -- 0147: what the receipt promises
  v_tx_status     text;                     -- 0147: pending | priced
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

  -- ── 0147 · forward dealing ────────────────────────────────────────────────
  SELECT c.pricing_enabled INTO v_async
    FROM public.fund_dealing_config c WHERE c.fund_code = 'UPU-BAL';
  v_async := COALESCE(v_async, false);

  IF v_async THEN
    -- Opportunistic, bounded sweep. There is no scheduler by design (a queue
    -- that drains only on a timer is a queue that silently stops draining), so
    -- the member-facing money RPCs each nudge it. 50 rows is index-backed via
    -- ix_transactions_pending and adds no perceptible latency; the real release
    -- happens on publish. Deliberately BEFORE the balance is read, so a
    -- redemption released a moment ago is reflected in what this member can
    -- take out.
    PERFORM public.price_pending_transactions('UPU-BAL', 50);
  ELSE
    -- Legacy path only: redeem at the fund NAV, not a hardcoded 1,000.
    v_unit_price := public.latest_nav();
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'no published unit price is available to price this withdrawal'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 0115 [A04-011] · CLAIM THE NONCE BEFORE THE MONEY MOVES ───────────────
  -- 0114 and every version before it read the nonce here with a plain, UNLOCKED
  -- SELECT and wrote the public.money_nonces row only AFTER the money write, with
  -- ON CONFLICT DO NOTHING. Two taps that arrive together therefore both read
  -- "no such nonce" — neither transaction can see the other's uncommitted row —
  -- both write their money row (the ids are fresh uuids, so nothing collides),
  -- and the loser's DO NOTHING then swallows the duplicate nonce in silence.
  -- Net: one nonce row, the money applied TWICE. The nonce is minted per
  -- confirm-sheet precisely to survive a double-tap, which is exactly the
  -- gesture that produces two near-simultaneous calls.
  --
  -- Two mechanisms, in this order:
  --
  --   1. pg_advisory_xact_lock makes the second caller WAIT, and makes the
  --      read-then-claim pair below one indivisible step. It is TRANSACTION-
  --      scoped: released on COMMIT and on ROLLBACK, nothing to clean up, safe
  --      behind a transaction-mode connection pooler. A hash collision between
  --      two different nonces costs a short wait and can never be incorrect,
  --      because step 2 is the actual arbiter.
  --
  --      The audit's suggested shape — claim with `ON CONFLICT DO NOTHING
  --      RETURNING`, re-read the prior result when nothing comes back — is
  --      equally correct, and was measured rather than assumed: that INSERT
  --      DOES wait on a conflicting in-flight insert (7.28 s against a
  --      held-open session), then does nothing if the other committed and
  --      inserts if it aborted. The widespread claim that DO NOTHING "never
  --      waits" is about the ROW LOCK it skips on an already-committed row,
  --      not about an in-flight one. The explicit lock is used here because a
  --      wait you can read beats a wait you have to know about.
  --
  --   2. the plain INSERT, arbitrated by money_nonces_pkey. This is the
  --      guarantee. If a second claimant ever reaches it, it aborts on the
  --      unique violation — and by then NO money has moved, because the claim
  --      now precedes the ledger write instead of following it.
  --
  -- A failure anywhere after this point rolls the claim back with everything
  -- else, so a rejected call never burns its nonce.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('public.money_nonces'), pg_catalog.hashtext(p_nonce));

    -- New statement, new snapshot: an earlier holder has by now either
    -- committed (row visible → this is a replay) or rolled back (row gone →
    -- the nonce is free again).
    SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      IF v_prior = '{}'::jsonb THEN
        -- The placeholder below is written and overwritten inside ONE
        -- transaction, so it can never be seen committed. Refuse rather than
        -- hand the member an empty receipt.
        RAISE EXCEPTION 'this payment is still being processed; try again in a moment'
          USING ERRCODE = 'P0001';
      END IF;
      RETURN v_prior;
    END IF;

    INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result)
    VALUES (p_nonce, v_subscriber_id, 'withdrawal', '{}'::jsonb);
  END IF;

  -- F-5: server-side "withdraw ≤ available balance" guard. Lock the balance row
  -- so a concurrent withdrawal can't over-draw past the check.
  -- 0114: the two bucket balances come back under the SAME lock, so the
  -- per-bucket checks below cannot race the total check.
  -- 0147: WITHDRAWABLE, not the gross pots. Subtracting the existing holds
  -- here — rather than at each of the three checks below — is deliberate: it
  -- means the total check, the retirement check and the savings check ALL key
  -- off withdrawable money by construction, and a future check added below
  -- inherits that for free. Without it a member could request the same money
  -- twice in the window before their first request deals.
  -- Money in pending_contribution_* is excluded too, by definition: it has
  -- bought no units, so it is not in total_balance at all.
  SELECT total_balance      - CASE WHEN v_async
                                THEN pending_redemption_retirement + pending_redemption_emergency
                                ELSE 0 END,
         retirement_balance - CASE WHEN v_async THEN pending_redemption_retirement ELSE 0 END,
         emergency_balance  - CASE WHEN v_async THEN pending_redemption_emergency  ELSE 0 END
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
  -- 0147: on the async path this function NO LONGER SELLS ANYTHING. The
  -- AFTER INSERT trigger above has placed a hold; the engine cancels the units
  -- at the DEALING date's price, which is not known yet and must not be
  -- guessed. latest_nav() here was the defect: it redeemed at whatever price
  -- happened to be newest, which for a Friday-evening request is a price
  -- struck before the request existed.
  IF NOT v_async THEN
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
  END IF;   -- 0147: end of the synchronous-only block

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
  -- 0147: the client success panel keys off these two. Without them it falls
  -- back to promising the money "within 24 hours", which is exactly the
  -- sentence forward dealing makes false.
  SELECT dealing_date, pricing_status INTO v_tx_dealing, v_tx_status
    FROM public.transactions WHERE id = v_tx_id;

  v_result := jsonb_build_object(
    'dealingDate',   to_char(v_tx_dealing, 'YYYY-MM-DD'),
    'pricingStatus', v_tx_status,
    'id',        v_wd_id,
    'amount',    p_amount,
    'bucket',    v_bucket,
    'reason',    p_reason,
    'method',    p_method,
    'status',    'processing',
    'date',      to_char(now(), 'YYYY-MM-DD'),
    'reference', v_ref
  );

  -- 0115 [A04-011]: the row already exists — it was claimed before the money
  -- moved. Publish the real receipt onto it. No ON CONFLICT: this UPDATE
  -- cannot conflict with anything, and a silent no-op here would be the same
  -- class of bug the DO NOTHING above was.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    UPDATE public.money_nonces SET result = v_result WHERE nonce = p_nonce;
  END IF;

  RETURN v_result;
END;
$function$;

-- ── price_pending_transactions() — restored from 0151 ──────────────────
CREATE OR REPLACE FUNCTION public.price_pending_transactions(
  p_fund     TEXT DEFAULT 'UPU-BAL',
  p_max_rows INTEGER DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg          public.fund_dealing_config%ROWTYPE;
  v_book_price   NUMERIC;
  v_book_date    DATE;
  t              RECORD;
  v_bal          public.subscriber_balances%ROWTYPE;
  v_price        NUMERIC;
  v_snap         TEXT;
  v_units        NUMERIC;
  v_units_before NUMERIC;
  v_ret_leg      NUMERIC;
  v_emg_leg      NUMERIC;
  v_priced       INTEGER := 0;
  v_rejected     INTEGER := 0;
  v_contribs     INTEGER := 0;
  v_redemptions  INTEGER := 0;
  v_units_delta  NUMERIC := 0;
  v_value        NUMERIC := 0;
  -- 0072 save-to-cover locals, ported from the contribution trigger (F6).
  v_sched        public.contribution_schedules%ROWTYPE;
  v_target       NUMERIC;
  v_new_accrued  NUMERIC;
  v_emg_bal      NUMERIC;
  v_sweep_units  NUMERIC;
BEGIN
  SELECT * INTO v_cfg FROM public.fund_dealing_config WHERE fund_code = p_fund;
  IF NOT FOUND OR NOT v_cfg.pricing_enabled THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'pricing is disabled for this fund',
                              'priced', 0, 'rejected', 0);
  END IF;

  -- The price the BOOK is carried at. Read once: it cannot change inside this
  -- transaction, and every re-mark below must use the same one.
  SELECT n.unit_price, n.nav_date INTO v_book_price, v_book_date
    FROM public.nav_snapshots n
   WHERE n.fund_code = p_fund AND n.status = 'published'
   ORDER BY n.nav_date DESC LIMIT 1;

  FOR t IN
    SELECT tx.id, tx.subscriber_id, tx.type, tx.amount, tx.dealing_date,
           tx.split_retirement, tx.split_emergency, tx.source, tx.txn_ref
      FROM public.transactions tx
     WHERE tx.pricing_status = 'pending'
       AND tx.type IN ('contribution', 'withdrawal', 'premium_sweep')
       AND tx.dealing_date IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.nav_snapshots n
                    WHERE n.fund_code = p_fund AND n.nav_date = tx.dealing_date
                      AND n.status = 'published')
     ORDER BY tx.dealing_date,
              CASE tx.type WHEN 'contribution' THEN 0 ELSE 1 END,
              tx.received_at, tx.id
     LIMIT COALESCE(p_max_rows, 2147483647)
     FOR UPDATE OF tx SKIP LOCKED
  LOOP
    -- (a) Lock this member. Everything below reads and writes one balance row.
    SELECT * INTO v_bal FROM public.subscriber_balances
     WHERE subscriber_id = t.subscriber_id FOR UPDATE;
    IF NOT FOUND THEN
      -- The booking triggers create the row, so this can only mean the member's
      -- balance was deleted underneath a pending transaction. Leave it pending
      -- and let reconciliation surface it rather than inventing a balance.
      CONTINUE;
    END IF;

    -- (b) The dealing price, and the exact register row it came from.
    SELECT r.unit_price, r.id INTO v_price, v_snap
      FROM public.nav_price_row(t.dealing_date, p_fund) r;
    IF v_price IS NULL OR v_price <= 0 THEN
      CONTINUE;   -- unreachable given the EXISTS above; belt and braces
    END IF;

    -- Legs. Both booking triggers resolve and write these back onto the row, so
    -- the value struck here is the same one the hold was taken against. They
    -- are re-derived only for a row written by some other path.
    IF t.split_retirement IS NOT NULL AND t.split_emergency IS NOT NULL THEN
      v_ret_leg := t.split_retirement;
      v_emg_leg := t.split_emergency;
    ELSIF t.type = 'contribution' THEN
      v_ret_leg := round(t.amount * 0.80);
      v_emg_leg := t.amount - v_ret_leg;
    ELSE
      v_emg_leg := LEAST(abs(t.amount), GREATEST(v_bal.emergency_balance, 0));
      v_ret_leg := abs(t.amount) - v_emg_leg;
    END IF;

    v_units_before := v_bal.units;

    IF t.type = 'contribution' THEN
      -- (c) ALLOCATE. Units at the DEALING date's price - never today's.
      v_units := t.amount / v_price;

      UPDATE public.subscriber_balances
         SET units              = units + v_units,
             invested           = invested + t.amount,
             retirement_balance = retirement_balance + v_ret_leg,
             emergency_balance  = emergency_balance  + v_emg_leg,
             -- Derived, never rounded independently: bucket_sum_chk is a HARD
             -- equality and rounding all three separately is what trips it.
             total_balance      = retirement_balance + v_ret_leg
                                + emergency_balance  + v_emg_leg,
             -- The money leaves the pending component in the same statement it
             -- enters the allocated one. That is the no-jump property.
             pending_contribution_retirement = GREATEST(0, pending_contribution_retirement - v_ret_leg),
             pending_contribution_emergency  = GREATEST(0, pending_contribution_emergency  - v_emg_leg),
             nav_as_of  = t.dealing_date,
             updated_at = now()
       WHERE subscriber_id = t.subscriber_id;

      v_contribs    := v_contribs + 1;
      v_units_delta := v_units_delta + v_units;
      v_value       := v_value + t.amount;

    ELSE
      -- (c) LIQUIDATE. Same rule, opposite sign.
      v_units := abs(t.amount) / v_price;

      -- D8: the price fell far enough between request and dealing date that the
      -- amount no longer fits the units held. Reject and release the hold — the
      -- member re-requests at a figure that exists. Silently paying out less
      -- than they confirmed is the worse failure.
      IF v_units > v_bal.units + 0.000001 THEN
        UPDATE public.subscriber_balances
           SET pending_redemption_retirement = GREATEST(0, pending_redemption_retirement - v_ret_leg),
               pending_redemption_emergency  = GREATEST(0, pending_redemption_emergency  - v_emg_leg),
               updated_at = now()
         WHERE subscriber_id = t.subscriber_id;

        UPDATE public.transactions
           SET pricing_status = 'rejected', priced_at = now()
         WHERE id = t.id AND pricing_status = 'pending';

        UPDATE public.withdrawals
           SET status = 'rejected'
         WHERE subscriber_id = t.subscriber_id AND reference = t.txn_ref AND status = 'processing';

        v_rejected := v_rejected + 1;
        CONTINUE;
      END IF;

      UPDATE public.subscriber_balances
         SET units              = units - v_units,
             -- Average cost: drop the SAME FRACTION of basis as of units, so a
             -- withdrawal leaves growth% invariant. Reducing by net cash-in
             -- instead produces -233% outliers for heavy withdrawers.
             invested           = CASE WHEN v_units_before > 0
                                    THEN GREATEST(0, invested * (1 - v_units / v_units_before))
                                    ELSE 0 END,
             retirement_balance = GREATEST(0, retirement_balance - v_ret_leg),
             emergency_balance  = GREATEST(0, emergency_balance  - v_emg_leg),
             total_balance      = GREATEST(0, retirement_balance - v_ret_leg)
                                + GREATEST(0, emergency_balance  - v_emg_leg),
             -- The hold is released and the struck value becomes money owed.
             -- The member's TOTAL does not move: they stop owning units and
             -- start being owed exactly what those units were sold for.
             pending_redemption_retirement = GREATEST(0, pending_redemption_retirement - v_ret_leg),
             pending_redemption_emergency  = GREATEST(0, pending_redemption_emergency  - v_emg_leg),
             pending_payout_retirement     = pending_payout_retirement + v_ret_leg,
             pending_payout_emergency      = pending_payout_emergency  + v_emg_leg,
             nav_as_of  = t.dealing_date,
             updated_at = now()
       WHERE subscriber_id = t.subscriber_id;

      v_redemptions := v_redemptions + 1;
      v_units_delta := v_units_delta - v_units;
      v_value       := v_value + abs(t.amount);
    END IF;

    -- (d) BUCKET UNITS. Mandatory: subscriber_balances_bucket_units_sum is a
    -- DEFERRABLE constraint trigger that raises 23514 at COMMIT unless
    -- retirement_units + emergency_units = units within 0.000001. Any statement
    -- that moves `units` must call this before the transaction ends.
    --
    -- ⚠️ THIS MUST PRECEDE THE RE-MARK BELOW. The re-mark READS retirement_units;
    --    the allocation above changed `units` and both bucket balances and left
    --    retirement_units stale, so re-marking first would split the two pots
    --    off a stale ratio. Found by building it, not by reading it.
    PERFORM public._resync_bucket_units(t.subscriber_id);

    -- (f) CLAIM THE ROW. The `pricing_status = 'pending'` predicate is the
    -- idempotency guarantee: a second caller that somehow reached this row
    -- updates nothing.
    UPDATE public.transactions
       SET pricing_status     = 'priced',
           unit_price_applied = v_price,
           units_delta        = CASE WHEN t.type = 'contribution' THEN v_units ELSE -v_units END,
           nav_snapshot_id    = v_snap,
           priced_at          = public.kampala_now(),
           split_retirement   = COALESCE(split_retirement, v_ret_leg),
           split_emergency    = COALESCE(split_emergency, v_emg_leg)
     WHERE id = t.id AND pricing_status = 'pending';

    v_priced := v_priced + 1;

    -- (g) SAVE-TO-COVER (0072), ported out of the contribution trigger.
    -- It used to run at insert time because that was when units existed. Now
    -- units exist HERE, so it runs here — after allocation, at the dealing
    -- price, for own-money contributions only. The employer co-contribution
    -- and the group insurance leg never accrue toward a self policy.
    IF t.type = 'contribution' AND t.source = 'own' THEN
      SELECT * INTO v_sched FROM public.contribution_schedules
        WHERE subscriber_id = t.subscriber_id FOR UPDATE;

      IF v_sched.insurance_funding_mode = 'save_to_cover' THEN
        -- Lazy renewal (no pg_cron): an active self policy past its renewal
        -- date flips back to 'building' so it re-accrues. Both tables.
        UPDATE public.insurance_policies
           SET status = 'building'
         WHERE subscriber_id = t.subscriber_id AND funded_by = 'self'
           AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;
        UPDATE public.subscriber_insurance_products
           SET status = 'building', updated_at = now()
         WHERE subscriber_id = t.subscriber_id AND funded_by = 'self'
           AND status = 'active' AND renewal_date IS NOT NULL AND now() >= renewal_date;

        SELECT COALESCE(SUM(premium_monthly * 12), 0) INTO v_target
          FROM ( SELECT premium_monthly FROM public.insurance_policies
                   WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status <> 'active'
                 UNION ALL
                 SELECT premium_monthly FROM public.subscriber_insurance_products
                   WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status <> 'active' ) q;

        IF v_target > 0 THEN
          v_new_accrued := LEAST(
            v_target,
            v_sched.insurance_premium_accrued
              + v_emg_leg * (COALESCE(v_sched.insurance_savings_pct, 100) / 100.0));

          SELECT emergency_balance INTO v_emg_bal
            FROM public.subscriber_balances WHERE subscriber_id = t.subscriber_id;

          IF v_new_accrued >= v_target AND v_emg_bal >= v_target THEN
            SELECT LEAST(v_target / v_price, units) INTO v_sweep_units
              FROM public.subscriber_balances WHERE subscriber_id = t.subscriber_id;

            UPDATE public.subscriber_balances
               SET emergency_balance = emergency_balance - v_target,
                   total_balance     = total_balance     - v_target,
                   units             = units - v_sweep_units,
                   invested          = CASE WHEN units > 0
                                         THEN GREATEST(0, invested * (1 - v_sweep_units / units))
                                         ELSE 0 END,
                   nav_as_of         = t.dealing_date,
                   updated_at        = now()
             WHERE subscriber_id = t.subscriber_id;
            PERFORM public._resync_bucket_units(t.subscriber_id);

            -- The marker row is written ALREADY PRICED. Its units were debited
            -- inline above, so if it entered the queue as 'pending' the engine
            -- would allocate it a second time and debit the units twice. The
            -- stamp trigger honours an explicitly-supplied status precisely so
            -- this row can opt out.
            INSERT INTO public.transactions
              (id, subscriber_id, type, amount, date, status, method, txn_ref, source,
               dealing_date, pricing_status, unit_price_applied, units_delta, priced_at)
            VALUES ('tx-' || t.subscriber_id || '-sweep-' || replace(gen_random_uuid()::text, '-', ''),
                    t.subscriber_id, 'premium_sweep', -v_target, now(), 'settled',
                    'internal', 'SW-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0'), 'own',
                    t.dealing_date, 'priced', v_price, -v_sweep_units, now());

            UPDATE public.insurance_policies
               SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date
             WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status = 'building';
            UPDATE public.subscriber_insurance_products
               SET status = 'active', policy_start = now()::date, renewal_date = (now() + INTERVAL '1 year')::date, updated_at = now()
             WHERE subscriber_id = t.subscriber_id AND funded_by = 'self' AND status = 'building';

            UPDATE public.contribution_schedules
               SET insurance_premium_target = 0, insurance_premium_accrued = 0, updated_at = now()
             WHERE subscriber_id = t.subscriber_id;
          ELSE
            UPDATE public.contribution_schedules
               SET insurance_premium_accrued = v_new_accrued, insurance_premium_target = v_target, updated_at = now()
             WHERE subscriber_id = t.subscriber_id;
          END IF;
        END IF;
      END IF;

      -- Lazy indexation, independent of insurance. Same no-cron pattern.
      IF v_sched.contribution_indexation_pct > 0
         AND (v_sched.last_indexed_at IS NULL OR now() >= v_sched.last_indexed_at + INTERVAL '1 year') THEN
        UPDATE public.contribution_schedules
           SET amount = ROUND(amount * (1 + contribution_indexation_pct / 100.0)),
               last_indexed_at = now(), updated_at = now()
         WHERE subscriber_id = t.subscriber_id;
      END IF;
    END IF;
    -- (h) RE-MARK TO THE BOOK. LAST, DELIBERATELY. Only when this transaction dealt at a price that
    -- is not the newest published one — i.e. a back-dated publish just filled a
    -- hole and released a stalled queue. The member bought at the dealing
    -- price (correct, and theirs), but the book carries everyone at the newest
    -- price, and nav_mismatch asserts that within 1 UGX per member. Without
    -- this the released member is left off-book by the market movement between
    -- the two dates; measured at -9,150 UGX on a single release, while the
    -- aggregate publish gate showed 0.0000% drift and would never have caught it.
    IF v_book_price IS NOT NULL AND v_price <> v_book_price THEN
      UPDATE public.subscriber_balances
         SET nav_as_of          = v_book_date,
             total_balance      = round(units * v_book_price),
             retirement_balance = round(retirement_units * v_book_price),
             -- Complement rule, exactly as publish_nav_snapshot does it.
             emergency_balance  = round(units * v_book_price)
                                - round(retirement_units * v_book_price),
             updated_at = now()
       WHERE subscriber_id = t.subscriber_id;
      -- The ratio is preserved by the complement rule, so this is stable; it
      -- keeps the F3 invariant exact rather than nearly-exact.
      PERFORM public._resync_bucket_units(t.subscriber_id);
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'skipped',       false,
    'priced',        v_priced,
    'rejected',      v_rejected,
    'contributions', v_contribs,
    'redemptions',   v_redemptions,
    'unitsDelta',    v_units_delta,
    'value',         v_value
  );
END;
$$;

-- ── reverse_transaction() — restored from 0148 ─────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_transaction(
  p_transaction_id TEXT,
  p_reason         TEXT
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx      public.transactions%ROWTYPE;
  v_bal     public.subscriber_balances%ROWTYPE;
  v_ret     NUMERIC;
  v_emg     NUMERIC;
  v_units   NUMERIC;
  v_new_id  TEXT;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can reverse a transaction' USING ERRCODE = 'P0001';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reversal needs a reason - it is written to the ledger' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No transaction %', p_transaction_id USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.pricing_status = 'reversed' THEN
    RAISE EXCEPTION 'Transaction % has already been reversed', p_transaction_id USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.pricing_status = 'pending' THEN
    -- Nothing has been allocated, so there is nothing to unwind. Cancelling a
    -- pending row is a different operation with a different question attached
    -- (the money has already left the member's wallet - see plan D4), and
    -- pretending this is that would quietly strand their cash.
    RAISE EXCEPTION 'Transaction % has not been priced yet, so there is nothing to reverse. It deals on %.',
      p_transaction_id, to_char(v_tx.dealing_date, 'YYYY-MM-DD') USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.units_delta IS NULL OR v_tx.unit_price_applied IS NULL THEN
    RAISE EXCEPTION 'Transaction % predates the pricing audit trail: the price and unit count it was struck at were never recorded, so it cannot be unwound exactly. Adjust the member manually and record why.',
      p_transaction_id USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_bal FROM public.subscriber_balances
   WHERE subscriber_id = v_tx.subscriber_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member % has no balance record to reverse against', v_tx.subscriber_id
      USING ERRCODE = 'P0001';
  END IF;

  v_units := v_tx.units_delta;                       -- signed as originally applied
  v_ret   := COALESCE(v_tx.split_retirement, 0);
  v_emg   := COALESCE(v_tx.split_emergency, abs(v_tx.amount) - COALESCE(v_tx.split_retirement, 0));

  IF v_tx.type = 'contribution' THEN
    UPDATE public.subscriber_balances
       SET units              = GREATEST(0, units - v_units),
           invested           = GREATEST(0, invested - v_tx.amount),
           retirement_balance = GREATEST(0, retirement_balance - v_ret),
           emergency_balance  = GREATEST(0, emergency_balance  - v_emg),
           total_balance      = GREATEST(0, retirement_balance - v_ret)
                              + GREATEST(0, emergency_balance  - v_emg),
           updated_at         = now()
     WHERE subscriber_id = v_tx.subscriber_id;
  ELSE
    -- A redemption: give the units back and restore the value at the SAME price
    -- they were sold at. Cost basis is restored proportionally, mirroring the
    -- average-cost reduction the sale applied.
    UPDATE public.subscriber_balances
       SET units              = units - v_units,          -- v_units is negative
           invested           = invested + abs(v_tx.amount),
           retirement_balance = retirement_balance + v_ret,
           emergency_balance  = emergency_balance  + v_emg,
           total_balance      = retirement_balance + v_ret + emergency_balance + v_emg,
           -- If it was struck but never paid, the money owed goes away with it.
           pending_payout_retirement = GREATEST(0, pending_payout_retirement - v_ret),
           pending_payout_emergency  = GREATEST(0, pending_payout_emergency  - v_emg),
           updated_at         = now()
     WHERE subscriber_id = v_tx.subscriber_id;

    UPDATE public.withdrawals SET status = 'reversed'
     WHERE subscriber_id = v_tx.subscriber_id AND reference = v_tx.txn_ref
       AND status IN ('processing', 'paid');
  END IF;

  -- Mandatory after any units move (deferrable constraint trigger, 23514).
  PERFORM public._resync_bucket_units(v_tx.subscriber_id);

  -- The compensating row. The ledger is append-only: SUM(amount) stays true and
  -- the member can see that something was undone, and why.
  v_new_id := 'tx-' || v_tx.subscriber_id || '-rev-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, received_at, status, method, txn_ref, source,
    split_retirement, split_emergency, dealing_date, pricing_status,
    unit_price_applied, units_delta, nav_snapshot_id, priced_at
  ) VALUES (
    v_new_id, v_tx.subscriber_id, v_tx.type, -v_tx.amount, now(), now(), 'settled',
    v_tx.method, 'RV-' || COALESCE(v_tx.txn_ref, ''), v_tx.source,
    -v_ret, -v_emg, v_tx.dealing_date, 'priced',
    v_tx.unit_price_applied, -v_units, v_tx.nav_snapshot_id, now()
  );

  UPDATE public.transactions
     SET pricing_status = 'reversed'
   WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'reversed',      p_transaction_id,
    'compensatedBy', v_new_id,
    'reason',        p_reason,
    'unitsReturned', -v_units,
    'unitPrice',     v_tx.unit_price_applied
  );
END;
$$;
REVOKE ALL     ON FUNCTION public.reverse_transaction(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reverse_transaction(TEXT, TEXT) TO authenticated;

-- ── settle_withdrawal() — restored from 0147 ───────────────────────────
CREATE OR REPLACE FUNCTION public.settle_withdrawal(p_withdrawal_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wd  public.withdrawals%ROWTYPE;
  v_tx  public.transactions%ROWTYPE;
  v_ret NUMERIC;
  v_emg NUMERIC;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can settle a withdrawal' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wd FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No withdrawal %', p_withdrawal_id USING ERRCODE = 'P0001';
  END IF;
  IF v_wd.status <> 'processing' THEN
    RAISE EXCEPTION 'Withdrawal % is already %', p_withdrawal_id, v_wd.status USING ERRCODE = 'P0001';
  END IF;

  -- The ledger row is the authority for how much was actually struck, and for
  -- whether it has been struck at all.
  SELECT * INTO v_tx FROM public.transactions
   WHERE subscriber_id = v_wd.subscriber_id AND txn_ref = v_wd.reference AND type = 'withdrawal'
   ORDER BY received_at DESC LIMIT 1;

  IF FOUND AND v_tx.pricing_status = 'pending' THEN
    RAISE EXCEPTION 'Withdrawal % has not been priced yet - it deals on %',
      p_withdrawal_id, to_char(v_tx.dealing_date, 'YYYY-MM-DD') USING ERRCODE = 'P0001';
  END IF;

  v_ret := COALESCE(v_tx.split_retirement, 0);
  v_emg := COALESCE(v_tx.split_emergency, v_wd.amount);

  -- Clamp to what is actually owed. A withdrawal struck before 0147 has no
  -- payout component to release, so this correctly releases nothing.
  UPDATE public.subscriber_balances
     SET pending_payout_retirement = GREATEST(0, pending_payout_retirement - v_ret),
         pending_payout_emergency  = GREATEST(0, pending_payout_emergency  - v_emg),
         updated_at = now()
   WHERE subscriber_id = v_wd.subscriber_id;

  UPDATE public.withdrawals SET status = 'paid' WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object(
    'id', p_withdrawal_id, 'status', 'paid',
    'releasedRetirement', v_ret, 'releasedEmergency', v_emg);
END;
$$;

-- ── the link itself ─────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.ux_withdrawals_transaction;

ALTER TABLE public.withdrawals
  DROP COLUMN IF EXISTS transaction_id;
