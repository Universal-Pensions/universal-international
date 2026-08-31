-- DOWN for 0147_async_pricing_engine.sql
-- ============================================================================
-- Restores synchronous pricing: every body below is reproduced VERBATIM from
-- the live catalog as it stood immediately before 0147 — generated, not
-- retyped.
--
-- ⚠️ READ THE GUARD BELOW BEFORE RUNNING THIS.
--
-- THIS IS NOT THE ROLLBACK YOU WANT IN AN INCIDENT. The rollback for a bad flip
-- is one UPDATE and takes effect on the next statement:
--
--     UPDATE public.fund_dealing_config SET pricing_enabled = false;
--
-- That leaves already-pending rows intact, to be released by
-- run_pending_pricing() whenever the switch goes back on. It loses nothing.
--
-- This file is the HARD reversal, and it is only safe from a standing start. It
-- refuses to run if:
--   * the switch is still on — turn it off first, deliberately;
--   * any transaction is still `pending` — that money has been received and has
--     bought nothing. Restoring the old triggers would strand it: no code path
--     would ever price it again, and it would sit in the ledger forever while
--     the member's balance silently omitted it. Drain the queue first, or
--     reverse those transactions.
--   * any member holds money in the six pending components — same reason. The
--     columns survive this migration (they belong to 0146), but nothing would
--     ever clear them again.
--
-- WHAT COMES BACK, and it is worth being explicit that this is a REGRESSION:
--   * nav_for_date carries the last known price BACKWARDS again, falls back to
--     the earliest price ever, and finally to the literal 1000. Weekend money
--     goes back to buying units at Friday's close.
--   * request_withdrawal redeems at latest_nav() again — whatever price happens
--     to be newest, which for an evening request is a price struck before the
--     request existed.
--   * a back-dated employer run prices at the period's NAV again.
-- ============================================================================

DO $$
DECLARE v_on BOOLEAN; v_pending INTEGER; v_held INTEGER;
BEGIN
  SELECT pricing_enabled INTO v_on FROM public.fund_dealing_config WHERE fund_code = 'UPU-BAL';
  IF COALESCE(v_on, false) THEN
    RAISE EXCEPTION 'ABORT: pricing_enabled is still TRUE. Set it false, let the queue drain, then reverse.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_pending FROM public.transactions WHERE pricing_status = 'pending';
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'ABORT: % transaction(s) are still pending. Restoring synchronous pricing would strand that money - nothing would ever price it. Run run_pending_pricing() after publishing the missing prices, or reverse those rows.', v_pending
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_held FROM public.subscriber_balances
   WHERE pending_contribution_retirement <> 0 OR pending_contribution_emergency <> 0
      OR pending_payout_retirement       <> 0 OR pending_payout_emergency       <> 0
      OR pending_redemption_retirement   <> 0 OR pending_redemption_emergency   <> 0;
  IF v_held > 0 THEN
    RAISE EXCEPTION 'ABORT: % member(s) hold money in the in-process components. Nothing would ever clear it after this reversal.', v_held
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.settle_withdrawal(TEXT);
DROP FUNCTION IF EXISTS public.run_pending_pricing(INTEGER);
DROP FUNCTION IF EXISTS public.get_pending_pricing_summary(TEXT);
DROP FUNCTION IF EXISTS public.price_pending_transactions(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.latest_nav(p_fund text DEFAULT 'UPU-BAL'::text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.nav_for_date(CURRENT_DATE, p_fund);
$function$;

CREATE OR REPLACE FUNCTION public.nav_for_date(p_date date, p_fund text DEFAULT 'UPU-BAL'::text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT n.unit_price FROM public.nav_snapshots n
      WHERE n.fund_code = p_fund AND n.status = 'published' AND n.nav_date <= p_date
      ORDER BY n.nav_date DESC LIMIT 1),
    (SELECT n.unit_price FROM public.nav_snapshots n
      WHERE n.fund_code = p_fund AND n.status = 'published'
      ORDER BY n.nav_date ASC LIMIT 1),
    1000
  );
$function$;

CREATE OR REPLACE FUNCTION public.publish_nav_snapshot(p_nav_date date, p_unit_price numeric, p_fund_code text DEFAULT 'UPU-BAL'::text, p_source text DEFAULT 'admin_manual'::text, p_confirm_move boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role       TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_actor      TEXT := COALESCE((SELECT auth.jwt()) ->> 'name', 'admin');
  v_prev_price NUMERIC;
  v_prev_date  DATE;
  v_book_price NUMERIC;   -- 0116/A04-003: the price the BOOK is carried at
  v_move       NUMERIC := NULL;
  v_newest     DATE;
  v_is_newest  BOOLEAN;
  v_id         TEXT;
  v_units      NUMERIC;
  v_aum        NUMERIC;
  v_members    INTEGER;
  v_version    INTEGER;   -- 0145
  v_version_id TEXT;      -- 0145
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot publish a unit price', v_role USING ERRCODE = 'P0001';
  END IF;
  -- 0116 / A04-005 — the guard that stood here was INERT against NaN.
  -- `'NaN'::numeric <= 0` is FALSE in Postgres because NaN sorts ABOVE every
  -- numeric, so a NaN price walked straight past it and, with p_confirm_move,
  -- drove all 5,060 subscriber_balances rows to NaN in one statement.
  -- 0114's shared guard rejects NULL / NaN / +-Infinity by EXPLICIT EQUALITY,
  -- which is the only form that works (`NOT (x > 0)` does not fire either).
  -- 0114's nav_snapshots_unit_price_finite_chk is the table-level backstop;
  -- this call exists so the admin reads a sentence, not a constraint violation.
  -- p_whole_shillings => false: a unit price legitimately carries decimals.
  PERFORM public.assert_finite_money(p_unit_price, 'unit price', 0.01, 1000000, false);

  -- 0116 / A04-015 (server half) — this database's session timezone is UTC
  -- (verified live) but the fund prices on the Kampala calendar (UTC+3, no
  -- DST). Between 00:00 and 03:00 local, CURRENT_DATE is still YESTERDAY, so
  -- this guard rejected a perfectly legitimate same-day publish. The client
  -- half of A04-015 lives in AdminNavDesktop.jsx and is fixed in 0145's
  -- frontend commit.
  IF p_nav_date IS NULL OR p_nav_date > public.kampala_today() THEN
    RAISE EXCEPTION 'cannot publish a price for a future date' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise concurrent publishes on this fund so two admins cannot interleave
  -- a revaluation between each other's register write.
  PERFORM 1 FROM public.nav_snapshots
   WHERE fund_code = p_fund_code FOR UPDATE;

  SELECT unit_price, nav_date INTO v_prev_price, v_prev_date
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published' AND nav_date < p_nav_date
   ORDER BY nav_date DESC LIMIT 1;

  IF v_prev_price IS NOT NULL AND v_prev_price > 0 THEN
    v_move := round(((p_unit_price - v_prev_price) / v_prev_price) * 100, 4);
    -- Server-side guard-rail. The client confirm dialog is a courtesy; THIS is
    -- the gate, so a scripted or replayed call cannot skip it.
    IF abs(v_move) > 10 AND NOT p_confirm_move THEN
      RAISE EXCEPTION
        'price move of %%% from % on % needs confirmation',
        round(v_move, 2), v_prev_price, v_prev_date
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 0116 / A04-003 — capture the price the BOOK is currently carried at BEFORE
  -- the register write below moves the published frontier. After the INSERT
  -- this row IS the newest published price, so the comparison would be against
  -- itself and prove nothing.
  SELECT unit_price INTO v_book_price
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  -- Re-publishing a day CORRECTS it, and flips a 'pending' day to 'published' —
  -- which is exactly how the admin clears a "Delayed NAV updation" signal.
  INSERT INTO public.nav_snapshots
    (fund_code, nav_date, unit_price, status, published_at, source, published_by)
  VALUES
    (p_fund_code, p_nav_date, p_unit_price, 'published', now(), p_source, v_actor)
  ON CONFLICT (fund_code, nav_date) DO UPDATE SET
    unit_price   = EXCLUDED.unit_price,
    status       = 'published',
    published_at = now(),
    source       = EXCLUDED.source,
    published_by = EXCLUDED.published_by
  RETURNING id INTO v_id;

  -- 0145 (i): append the new version, then stamp every older current version as
  -- superseded BY it. The UPDATE runs second and excludes v_version itself, so
  -- the row just written stays current. Nothing is ever overwritten here — the
  -- ON CONFLICT above is the only destructive write left, and this table is
  -- what makes it recoverable.
  SELECT COALESCE(max(version_no), 0) + 1 INTO v_version
    FROM public.nav_snapshot_versions WHERE snapshot_id = v_id;

  INSERT INTO public.nav_snapshot_versions
    (snapshot_id, fund_code, nav_date, unit_price, status, source, published_by, published_at, version_no)
  VALUES
    (v_id, p_fund_code, p_nav_date, p_unit_price, 'published', p_source, v_actor, now(), v_version)
  RETURNING id INTO v_version_id;

  UPDATE public.nav_snapshot_versions
     SET superseded_at = now(), superseded_by = v_version_id
   WHERE snapshot_id = v_id AND version_no < v_version AND superseded_at IS NULL;

  -- Revalue ONLY when this is now the newest published day. A back-dated
  -- correction must not restate today's book at a stale price.
  SELECT max(nav_date) INTO v_newest
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published';
  v_is_newest := (v_newest = p_nav_date);

  IF v_is_newest AND p_fund_code = 'UPU-BAL' THEN
    -- 0116 / A04-003 — REFUSE rather than silently revalue units that were
    -- never priced at a real NAV. A reseed writes units at the dead 1,000 UGX
    -- literal and leaves both bucket-unit columns at their 0 default; the next
    -- publish then multiplied those units by the real NAV and inflated AUM 57%
    -- while zeroing every member's retirement pot. Everything below this line
    -- is a whole-book rewrite, so this is the last place to stop it.
    PERFORM public.assert_book_revaluable(p_fund_code, v_book_price);

    -- Complement rule: round the total and the retirement leg, then take
    -- emergency as the difference. Rounding all three independently is what
    -- would trip v_reconciliation_exceptions.split_mismatch across 5,060 rows.
    UPDATE public.subscriber_balances
       SET total_balance      = round(units * p_unit_price),
           retirement_balance = round(retirement_units * p_unit_price),
           emergency_balance  = round(units * p_unit_price)
                                - round(retirement_units * p_unit_price),
           nav_as_of          = p_nav_date,
           updated_at         = now()
     WHERE subscriber_id IS NOT NULL;

    -- 0072 [H3] parity: a NAV fall can push emergency_balance below an already
    -- accrued save-to-cover target, which would let the next contribution sweep
    -- money that is no longer in the bucket. Same clamp request_withdrawal does.
    UPDATE public.contribution_schedules s
       SET insurance_premium_accrued = LEAST(
             s.insurance_premium_accrued,
             GREATEST(0, (SELECT b.emergency_balance FROM public.subscriber_balances b
                           WHERE b.subscriber_id = s.subscriber_id))),
           updated_at = now()
     WHERE s.insurance_funding_mode = 'save_to_cover';

    -- Denormalised per-member copy of the fund price. Permitted because the
    -- editable-columns trigger returns early for a non-'subscriber' role.
    UPDATE public.subscribers
       SET current_unit_value = p_unit_price,
           unit_value_as_of   = now()
     WHERE id IS NOT NULL;
  END IF;

  SELECT COALESCE(sum(units), 0), COALESCE(sum(total_balance), 0), count(*)
    INTO v_units, v_aum, v_members
    FROM public.subscriber_balances;

  UPDATE public.nav_snapshots
     SET units_in_issue = v_units, aum = v_aum, members_priced = v_members
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'id',                v_id,
    'fundCode',          p_fund_code,
    'navDate',           to_char(p_nav_date, 'YYYY-MM-DD'),
    'unitPrice',         p_unit_price,
    'previousUnitPrice', v_prev_price,
    'previousNavDate',   to_char(v_prev_date, 'YYYY-MM-DD'),
    'changePct',         v_move,
    'revalued',          v_is_newest,
    'unitsInIssue',      v_units,
    'aum',               v_aum,
    'membersPriced',     v_members,
    -- 0145 (ii): 1 on a first publish, 2+ on a correction.
    'priceVersion',           v_version,
    -- 0145 (iii): wired to price_pending_transactions() in 0147. Zero here,
    -- because nothing can be pending until the engine exists.
    'releasedContributions',  0,
    'releasedRedemptions',    0
  );
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.trg_transactions_stamp_dealing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- 0114 [A04-001, A04-012]: replaces `IF p_amount IS NULL OR p_amount <= 0`,
  -- which could not reject NaN or Infinity. 5,000 is MIN_CONTRIBUTION in
  -- src/constants/savings.js — the UI has always enforced it, the server never
  -- did. 100,000,000 UGX is ~4x the largest live balance (24,786,589) and ~11x
  -- the largest live contribution (8,640,000).
  PERFORM public.assert_finite_money(p_amount, 'contribution amount', 5000, 100000000, true);

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
    VALUES (p_nonce, v_subscriber_id, 'contribution', '{}'::jsonb);
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

-- The reconciliation view, back to its pre-0147 shape: no NULL guard on
-- nav_mismatch (so an empty register silently reports a clean book), no
-- negative-component check, and no ledger tie-out for the in-process money.
CREATE OR REPLACE VIEW public.v_reconciliation_exceptions AS
 SELECT 'user'::text AS kind, 'missing_balance'::text AS check_code,
    'Member has no balance record'::text AS issue,
    s.id AS ref_id, s.name AS who, s.id AS subscriber_id,
    NULL::numeric AS amount, NULL::date AS occurred_on
   FROM subscribers s LEFT JOIN subscriber_balances b ON b.subscriber_id = s.id
  WHERE b.subscriber_id IS NULL
UNION ALL
 SELECT 'user'::text, 'split_mismatch'::text,
    'Retirement + emergency does not equal total balance'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    b.retirement_balance + b.emergency_balance - b.total_balance, b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(b.retirement_balance + b.emergency_balance - b.total_balance) > 1::numeric
UNION ALL
 SELECT 'transaction'::text, 'orphan_subscriber'::text,
    'Transaction references a member that no longer exists'::text,
    t.id, COALESCE(t.subscriber_id, '—'::text), t.subscriber_id, t.amount, t.date::date
   FROM transactions t LEFT JOIN subscribers s ON s.id = t.subscriber_id
  WHERE s.id IS NULL
UNION ALL
 SELECT 'transaction'::text, 'orphan_run'::text,
    'Transaction references a contribution run that no longer exists'::text,
    t.id, COALESCE(s.name, '—'::text), t.subscriber_id, t.amount, t.date::date
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
     LEFT JOIN contribution_runs r ON r.id = t.contribution_run_id
  WHERE t.contribution_run_id IS NOT NULL AND r.id IS NULL
UNION ALL
 SELECT 'transaction'::text, 'agent_mismatch'::text,
    'Transaction credited to an agent who does not own this member'::text,
    t.id, s.name, t.subscriber_id, t.amount, t.date::date
   FROM transactions t JOIN subscribers s ON s.id = t.subscriber_id
  WHERE t.agent_id IS NOT NULL AND t.agent_id IS DISTINCT FROM s.agent_id
UNION ALL
 SELECT 'user'::text, 'unit_split_mismatch'::text,
    'Retirement + savings units do not add up to the member''s total units'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units,
    b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units) > 0.000001
UNION ALL
 SELECT 'user'::text, 'nav_mismatch'::text,
    'Balance does not match the member''s units at the published unit price'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    b.total_balance - round(b.units * (SELECT latest_nav())), b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(b.total_balance - round(b.units * (SELECT latest_nav()))) > 1::numeric
UNION ALL
 SELECT 'user'::text, 'negative_balance'::text,
    'A balance or unit holding has gone below zero'::text,
    b.subscriber_id, s.name, b.subscriber_id,
    LEAST(b.retirement_balance, b.emergency_balance, b.total_balance, b.units, COALESCE(b.invested, 0::numeric)),
    b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance < 0::numeric OR b.emergency_balance < 0::numeric
     OR b.total_balance < 0::numeric OR b.units < 0::numeric
     OR COALESCE(b.invested, 0::numeric) < 0::numeric
     OR COALESCE(b.retirement_units, 0::numeric) < '-0.000001'::numeric
     OR COALESCE(b.emergency_units, 0::numeric) < '-0.000001'::numeric
UNION ALL
 SELECT 'user'::text, 'non_finite_balance'::text,
    'A balance is not a real number'::text,
    b.subscriber_id, s.name, b.subscriber_id, NULL::numeric, b.updated_at::date
   FROM subscriber_balances b JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance = 'NaN'::numeric OR b.emergency_balance = 'NaN'::numeric
     OR b.total_balance = 'NaN'::numeric OR b.units = 'NaN'::numeric
     OR COALESCE(b.invested, 0::numeric) = 'NaN'::numeric
     OR COALESCE(b.retirement_units, 0::numeric) = 'NaN'::numeric
     OR COALESCE(b.emergency_units, 0::numeric) = 'NaN'::numeric
     OR b.retirement_balance = 'Infinity'::numeric OR b.emergency_balance = 'Infinity'::numeric
     OR b.total_balance = 'Infinity'::numeric OR b.units = 'Infinity'::numeric;

-- Narrow the withdrawal statuses back. Any row parked in a state the old
-- constraint does not know about is moved to the nearest legal one first,
-- because ALTER would otherwise fail and leave the reversal half-applied.
UPDATE public.withdrawals SET status = 'processing' WHERE status IN ('rejected', 'reversed');
ALTER TABLE public.withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_chk;
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_status_chk
  CHECK (status IN ('paid', 'processing'));
