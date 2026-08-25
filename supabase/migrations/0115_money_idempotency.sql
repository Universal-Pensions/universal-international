-- 0115_money_idempotency.sql
-- =============================================================================
-- Phase 3 · A04-011, A05-004, A05-005 (server half), A05-012, A05-013
--
-- Claim the idempotency nonce BEFORE the money moves, and give the two
-- commission ledgers the uniqueness their invariants always assumed.
--
-- ⚠️⚠️  APPLY ORDER — 0115 MUST BE APPLIED **AFTER** 0114 (which is after 0112).
--
--   0114 rewrites `make_contribution`, `request_withdrawal` and
--   `submit_employer_contribution_run` with CREATE OR REPLACE and is NOT yet
--   applied to live. This file re-emits those same three bodies, so it was
--   built by TRANSFORMING 0114's text — not the live text, and not by retyping.
--   Every `assert_finite_money` call 0114 added is carried through verbatim.
--   The pre-flight below REFUSES to run if 0114 is not in place, because
--   applying this file first would delete 0114's NaN guards in silence — which
--   is exactly how 0095 un-shipped 0090's login identity in this repo.
--
--   `public.apply_settlement` is deliberately NOT touched here. 0109 rewrites
--   it with its cross-tenant ownership predicate (A05-001, Critical) and is
--   also unapplied; re-emitting it from any other copy would reopen that hole.
--   0115 has NO ordering relationship with 0109 — it adds table-level guards
--   around that RPC instead of editing it.
--
-- -----------------------------------------------------------------------------
-- 1. A04-011 — THE NONCE WAS CLAIMED AFTER THE MONEY MOVED
-- -----------------------------------------------------------------------------
-- All three money RPCs had the same shape:
--
--     SELECT result INTO v_prior FROM money_nonces WHERE nonce = p_nonce;  -- unlocked read
--     ...
--     INSERT INTO transactions (...);                                      -- MONEY MOVES
--     ...
--     INSERT INTO money_nonces (...) ON CONFLICT (nonce) DO NOTHING;       -- claimed LAST
--
-- Under READ COMMITTED two taps that arrive together each read "no such nonce"
-- — neither can see the other's uncommitted row — and nothing at the ledger
-- INSERT collides, because the transaction id is a fresh uuid and no constraint
-- ties a transaction to a nonce. Both write. The `subscriber_balances` upsert
-- in the balance trigger serialises them but does not de-duplicate: its
-- `DO UPDATE SET balance = balance + EXCLUDED.balance` re-reads the winner's
-- committed row and adds its own delta on top. `ON CONFLICT DO NOTHING` then
-- swallows the loser's nonce without a word. One nonce row; the money applied
-- TWICE. The nonce is minted per confirm-sheet specifically to survive a
-- double-tap, which is the very gesture that produces two near-simultaneous
-- calls.
--
-- The audit's suggested fix — claim with `ON CONFLICT (nonce) DO NOTHING
-- RETURNING nonce`, and re-read the prior result when nothing comes back — is
-- SOUND. It was measured rather than trusted, because the usual folklore about
-- it is wrong: against a session held open on the same nonce, that INSERT
-- WAITED 7.28 s and then, once the other session ended, either did nothing (if
-- it committed) or inserted (if it aborted). What `DO NOTHING` skips is the ROW
-- LOCK on an ALREADY-COMMITTED conflicting row — not the wait on an in-flight
-- one. Either shape closes A04-011.
--
-- This file takes the equivalent route with the wait spelled out, so the
-- ordering is legible to the next reader instead of being a property of
-- speculative insertion they have to already know. In every one of the three
-- RPCs:
--
--     pg_advisory_xact_lock(hashtext(<table>), hashtext(p_nonce))   -- MAKES THE SECOND CALLER WAIT
--     SELECT result … WHERE nonce = p_nonce  → replay? return it     -- fresh snapshot
--     INSERT INTO <nonce table> … VALUES (…, '{}'::jsonb)            -- CLAIM, arbitrated by the pkey
--     … money moves …
--     UPDATE <nonce table> SET result = v_result WHERE nonce = …     -- publish the receipt
--
-- The advisory lock is transaction-scoped: released on COMMIT and on ROLLBACK,
-- nothing to clean up, safe behind a transaction-mode pooler. It also makes the
-- read-then-claim pair one indivisible step. The unique index is the actual
-- guarantee — and it now fires BEFORE any money has moved rather than after. A failure anywhere later rolls the claim back with everything
-- else, so a rejected call never burns its nonce (the e2e spec
-- `money-idempotency.spec.ts` asserts exactly that for an over-balance
-- withdrawal).
--
-- -----------------------------------------------------------------------------
-- 2. A05-004 / A05-005 — ONE PAYMENT SETTLES AN AGENT ONCE
-- -----------------------------------------------------------------------------
-- The settlement nonce is minted per FILE-PICK (CommissionPanel.jsx:358) and
-- the file input is explicitly reset (:324) so the same file can be re-picked.
-- Re-uploading it therefore arrives with a NEW nonce and settles another
-- tranche against the SAME payment reference — proven live: one real UGX 5,000
-- payment settled UGX 15,000 across three batches and emitted 6 notifications.
-- The sibling case (A05-005) needs no replay at all: two rows for one agent in
-- ONE file settle that agent twice inside a single RPC call.
--
-- Neither is a nonce problem, so no nonce can fix them. The missing invariant
-- is on the table: **a payment reference settles a given agent at most once.**
-- This file states it as a partial UNIQUE index plus a BEFORE INSERT trigger
-- that turns the unique violation into a sentence a distributor can act on.
-- The trigger sees rows written earlier in the SAME transaction, so it also
-- catches A05-005's duplicated line before the second batch is written.
--
-- ⚠️ DELIBERATE BEHAVIOUR CHANGE: a settlement batch must now carry a NON-BLANK
--    payment reference. `normalizeUploadedRows` passes '' through for a blank
--    'Payment Reference' cell, and a blank reference has no identity — you
--    cannot tell a second payment from a re-upload of the first. Without this,
--    the guard has a hole a distributor can walk through by leaving one column
--    empty. All 7 live batches already carry a reference, and every e2e
--    settlement spec supplies one, so nothing existing is affected.
--
-- The remaining halves of A05-005 (aggregate duplicated agent rows instead of
-- failing the upload) and of A05-004 (derive the client nonce from the file
-- content) live in `apply_settlement` and in the React panel respectively —
-- both outside this migration's remit. They are escalated, not silently
-- dropped.
--
-- -----------------------------------------------------------------------------
-- 3. A05-012 / A05-013 — THE COMMISSION LEDGER'S TWO SOFT INVARIANTS
-- -----------------------------------------------------------------------------
-- `trg_transactions_contribution` is re-emitted from the LIVE body (0104 is its
-- newest definition and 0104 IS applied, so live == newest) with exactly two
-- changed lines:
--
--   A05-012  `IF v_commission_rate IS NOT NULL` accepted a deliberately
--            configured rate of 0 and wrote a UGX 0 row with status 'due'.
--            Turning commission off produced a ledger full of zero-value dues
--            that inflate every "N commissions owed" count. 0 now means none.
--   A05-013  the "one commission per onboarding" guard was keyed on
--            (subscriber, agent), so moving a member to another agent and
--            posting a contribution paid a SECOND onboarding commission for the
--            same person. It is keyed on the member alone now, and
--            ux_commissions_subscriber holds the same line at the table so a
--            future rewrite of the trigger cannot quietly reopen it.
--
-- Live is already clean for both: 0 members with more than one commission,
-- 0 commissions of 0 UGX, 0 duplicate (agent, reference) batches. The pre-flight
-- re-checks all three and ABORTS rather than half-applying.
-- =============================================================================

BEGIN;

-- ===========================================================================
-- 0. PRE-FLIGHT
-- ===========================================================================
DO $preflight$
DECLARE
  v_missing text[] := '{}';
  v_dupsub  int;
  v_zero    int;
  v_dupref  int;
BEGIN
  -- (a) 0114 must be in place. `assert_finite_money` existing is not enough —
  --     the three bodies below are re-emitted, so what matters is that the
  --     bodies this file was built from are the ones currently installed.
  IF to_regprocedure('public.assert_finite_money(numeric,text,numeric,numeric,boolean)') IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.assert_finite_money() does not exist. Apply 0114_money_numeric_guards.sql FIRST (and 0112 before it). 0115 re-emits the three money RPCs and was written on top of 0114; applying it first would ship them WITHOUT 0114''s NaN guards.'
      USING ERRCODE = 'P0001';
  END IF;

  IF pg_get_functiondef('public.make_contribution(text,numeric,numeric,text)'::regprocedure)
       NOT LIKE '%assert_finite_money%' THEN
    v_missing := v_missing || 'make_contribution';
  END IF;
  IF pg_get_functiondef('public.request_withdrawal(text,numeric,text,text,text,numeric,numeric)'::regprocedure)
       NOT LIKE '%assert_finite_money%' THEN
    v_missing := v_missing || 'request_withdrawal';
  END IF;
  IF pg_get_functiondef('public.submit_employer_contribution_run(text,text,text)'::regprocedure)
       NOT LIKE '%assert_finite_money%' THEN
    v_missing := v_missing || 'submit_employer_contribution_run';
  END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'ABORT: % still carry the pre-0114 body. Apply 0114_money_numeric_guards.sql FIRST — 0115 merges 0114''s guards forward and must not be applied over an older body.',
      array_to_string(v_missing, ', ') USING ERRCODE = 'P0001';
  END IF;

  -- (b) 0109 is not required, but settling for an agent you do not own is a
  --     Critical this file does not close. Say so rather than imply otherwise.
  IF pg_get_functiondef('public.apply_settlement(jsonb,text)'::regprocedure)
       NOT LIKE '%not_your_agent%' THEN
    RAISE NOTICE
      '0115: apply_settlement still has no tenancy guard (A05-001). 0115 does not touch that RPC — apply 0109_settlement_tenancy.sql as well.';
  END IF;

  -- (c) the data the two new unique indexes describe.
  SELECT count(*) INTO v_dupsub FROM (
    SELECT subscriber_id FROM public.commissions GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF v_dupsub > 0 THEN
    RAISE EXCEPTION
      'ABORT: % member(s) already hold more than one commission. ux_commissions_subscriber cannot be created over them — decide which row is the real onboarding commission and remove the rest before applying 0115.',
      v_dupsub USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_dupref FROM (
    SELECT agent_id, txn_ref FROM public.settlement_batches
     WHERE txn_ref IS NOT NULL AND txn_ref <> ''
     GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF v_dupref > 0 THEN
    RAISE EXCEPTION
      'ABORT: % (agent, payment reference) pair(s) already appear on more than one settlement batch — i.e. A05-004 has already fired against this book. Reconcile those batches before applying 0115.',
      v_dupref USING ERRCODE = 'P0001';
  END IF;

  -- (d) informational only: a zero-value commission is A05-012's residue. It
  --     does not block anything, but it should not go unmentioned.
  SELECT count(*) INTO v_zero FROM public.commissions WHERE amount <= 0;
  IF v_zero > 0 THEN
    RAISE NOTICE
      '0115: % commission row(s) hold an amount of 0 or less (A05-012 residue). The trigger below stops creating them; existing rows are left alone deliberately — deleting settled money history is not a migration''s job.',
      v_zero;
  END IF;
END;
$preflight$;


-- ===========================================================================
-- 1. make_contribution — A04-011
-- ===========================================================================
-- 0114's body with ONE change: the nonce block moves ahead of the ledger write
-- and becomes a claim. Every 0114 / 0104 / 0102 line is carried through.
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
$$;

-- ===========================================================================
-- 2. request_withdrawal — A04-011
-- ===========================================================================
-- Identical treatment. The claim lands where the old short-circuit was: after
-- the amount / bucket / split-pairing guards and before the balance row is
-- locked, so the lock order is always (nonce advisory lock → balance row) and
-- nothing can deadlock against it.
--
-- e2e/specs/db/money-idempotency.spec.ts asserts that a REJECTED over-balance
-- withdrawal leaves NO money_nonces row. It still does not: the claim is part
-- of the same transaction as the RAISE, so it rolls back with it.
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
$$;

-- ===========================================================================
-- 3. submit_employer_contribution_run — A04-011 on the employer path
-- ===========================================================================
-- The run's nonce lives in `contribution_run_uploads` (nonce, result) rather
-- than `money_nonces`, but the defect and the fix are the same shape. The claim
-- sits before the employer config is even read, so a double-submitted payroll
-- cannot post two runs.
--
-- ⚠️ src/test/employer-split-contract.test.js reads the NEWEST migration
--    definition of this function and fails if it mentions a per-member
--    percentage, or if the two `v_retirement := v_employee_leg;` /
--    `v_retirement := v_employer_leg;` lines are missing. 0102's allocation is
--    carried through unchanged — this is a merge, not a rewrite.
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

  -- ── 0115 [A04-011] · CLAIM THE NONCE BEFORE THE MONEY MOVES ───────────────
  -- 0114 and every version before it read the nonce here with a plain, UNLOCKED
  -- SELECT and wrote the public.contribution_run_uploads row only AFTER the money write, with
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
  --   2. the plain INSERT, arbitrated by contribution_run_uploads_pkey. This is the
  --      guarantee. If a second claimant ever reaches it, it aborts on the
  --      unique violation — and by then NO money has moved, because the claim
  --      now precedes the ledger write instead of following it.
  --
  -- A failure anywhere after this point rolls the claim back with everything
  -- else, so a rejected call never burns its nonce.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('public.contribution_run_uploads'), pg_catalog.hashtext(p_nonce));

    -- New statement, new snapshot: an earlier holder has by now either
    -- committed (row visible → this is a replay) or rolled back (row gone →
    -- the nonce is free again).
    SELECT result INTO v_prior FROM public.contribution_run_uploads WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      IF v_prior = '{}'::jsonb THEN
        RAISE EXCEPTION 'this contribution run is still being processed; try again in a moment'
          USING ERRCODE = 'P0001';
      END IF;
      RETURN v_prior;
    END IF;

    INSERT INTO public.contribution_run_uploads (nonce, result)
    VALUES (p_nonce, '{}'::jsonb);
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

  -- 0115 [A04-011]: the row already exists — it was claimed before the first
  -- payroll line was written. Publish the real summary onto it.
  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    UPDATE public.contribution_run_uploads SET result = v_result WHERE nonce = p_nonce;
  END IF;

  RETURN v_result;
END;
$$;

-- ===========================================================================
-- 4. One payment reference settles an agent once — A05-004, A05-005
-- ===========================================================================
-- The readable half of the guard. The UNIQUE index below is the half that
-- cannot be argued with; this exists so a distributor who re-picks the same
-- file reads a sentence instead of
-- `duplicate key value violates unique constraint "ux_..."`.
--
-- SECURITY DEFINER because `settlement_batches` has FORCE row security: the
-- owner (postgres, BYPASSRLS) must do the lookup, or a distributor whose batch
-- carries a NULL branch_id would fail their own SELECT policy and the check
-- would silently pass.
--
-- Reading `settlement_batches` from a BEFORE INSERT trigger sees rows this same
-- transaction has already written, which is what catches A05-005 — two rows for
-- one agent inside a SINGLE apply_settlement call, where no nonce and no
-- committed-row check could ever help.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_settlement_batches_unique_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- A blank reference has no identity — you cannot tell a second payment from a
  -- re-upload of the first — so it is refused rather than waved through. See the
  -- DELIBERATE BEHAVIOUR CHANGE note in this file's header.
  IF NEW.txn_ref IS NULL OR btrim(NEW.txn_ref) = '' THEN
    RAISE EXCEPTION
      'Enter the payment reference for agent % before settling. It is how one payment is told apart from another.',
      NEW.agent_id USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.settlement_batches b
     WHERE b.agent_id = NEW.agent_id
       AND b.txn_ref  = NEW.txn_ref
       AND b.id      <> NEW.id
  ) THEN
    RAISE EXCEPTION
      'Payment reference % has already settled agent %. One payment settles an agent once — use a new reference for a new payment, or remove the repeated row.',
      NEW.txn_ref, NEW.agent_id USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settlement_batches_unique_ref ON public.settlement_batches;
CREATE TRIGGER settlement_batches_unique_ref
  BEFORE INSERT ON public.settlement_batches
  FOR EACH ROW EXECUTE FUNCTION public.trg_settlement_batches_unique_ref();

COMMENT ON FUNCTION public.trg_settlement_batches_unique_ref() IS
  'A05-004/A05-005 (0115). Refuses a blank payment reference, and refuses to settle the same agent twice against one reference — including twice inside a single apply_settlement call. ux_settlement_batches_agent_txn_ref is the hard backstop; this trigger exists for the message.';

-- The invariant itself. Partial on a non-blank reference: the trigger already
-- refuses blanks on the way in, and the predicate keeps the index honest about
-- the 7 historical rows rather than pretending to describe rows it cannot.
CREATE UNIQUE INDEX IF NOT EXISTS ux_settlement_batches_agent_txn_ref
  ON public.settlement_batches (agent_id, txn_ref)
  WHERE txn_ref IS NOT NULL AND txn_ref <> '';

COMMENT ON INDEX public.ux_settlement_batches_agent_txn_ref IS
  'A05-004 (0115): one payment reference settles a given agent at most once. Re-uploading the same settlement file mints a NEW client nonce, so the nonce ledger cannot stop it — this index can.';


-- ===========================================================================
-- 5. trg_transactions_contribution — A05-012, A05-013
-- ===========================================================================
-- Re-emitted from the LIVE body (0104 is its newest definition and 0104 is
-- applied, so live IS the newest text) with two changed conditions and nothing
-- else. The 0072 save-to-cover sweep, the 0104 NAV pricing and the lazy
-- indexation block are carried through untouched.
--
-- ⚠️ src/test/nav-pricing-contract.test.js reads the NEWEST migration definition
--    of this function and fails if it stops calling nav_for_date()/latest_nav(),
--    reintroduces a 1000 unit-price literal, or loses SECURITY DEFINER / the
--    pinned search_path.
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

-- ===========================================================================
-- 6. One onboarding commission per member — A05-013
-- ===========================================================================
-- 0017 created ux_commissions_agent_subscriber on (agent_id, subscriber_id),
-- stating the invariant as "at most one commission per (agent, member) pair".
-- That is not the invariant: the onboarding commission is paid for signing a
-- person up, and a person is signed up once. Keyed on the pair, moving a member
-- to another agent makes the pair new and the next contribution pays a second
-- 5,000 UGX. Live has 0 members holding more than one commission, so this is a
-- tightening, not a repair.
--
-- The new index SUBSUMES the old one — uniqueness on (subscriber_id) implies
-- uniqueness on (agent_id, subscriber_id) — so the old one is dropped rather
-- than left behind as a redundant write cost. Nothing references it by name
-- (no ON CONFLICT anywhere targets it; grep: only 0017 mentions it).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_commissions_subscriber
  ON public.commissions (subscriber_id);

COMMENT ON INDEX public.ux_commissions_subscriber IS
  'A05-013 (0115): exactly one onboarding commission per member, ever. Replaces ux_commissions_agent_subscriber, which keyed the invariant on (agent, member) and so paid a second commission when a member was re-assigned.';

DROP INDEX IF EXISTS public.ux_commissions_agent_subscriber;


-- ===========================================================================
-- 7. GRANTS
-- ===========================================================================
-- CREATE OR REPLACE preserves the owner and existing grants, so the three money
-- RPCs keep 0114's. Re-stated anyway so this file is self-describing, and so a
-- future reader does not have to diff two migrations to learn who may call them.
REVOKE ALL ON FUNCTION public.make_contribution(text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.make_contribution(text, numeric, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(text, numeric, text, text, text, numeric, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_employer_contribution_run(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_employer_contribution_run(text, text, text) TO authenticated, service_role;

-- Trigger functions are invoked by the system, never over PostgREST. Postgres
-- does not check EXECUTE when a trigger fires, so revoking costs nothing and
-- keeps them off the callable surface.
REVOKE ALL ON FUNCTION public.trg_settlement_batches_unique_ref() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_transactions_contribution() FROM PUBLIC, anon, authenticated;


COMMIT;

-- =============================================================================
-- HOW THIS WAS VERIFIED (live, entirely inside BEGIN … ROLLBACK; nothing applied)
-- =============================================================================
-- BEFORE — two concurrent psql sessions, both rolled back, both holding a
-- subscriber JWT for s-0004 and passing the SAME nonce to make_contribution:
--
--   session A  BEGIN; make_contribution('p3-race', 10000) -> tx-s-0004-adhoc-8d0…
--   session B  BEGIN; make_contribution('p3-race', 10000) -> tx-s-0004-adhoc-1c4…
--
-- B did not block and did not short-circuit. Two DISTINCT ledger rows, each
-- crediting 10,000, for ONE nonce. Had both committed, the member would have
-- been charged once and credited twice.
--
-- AFTER — same two sessions, with 0112 + 0114 + 0115 applied inside session A's
-- transaction is not possible (B cannot see A's uncommitted catalog), so the two
-- halves were measured separately:
--
--   * the arbitration, with two live sessions on money_nonces itself: session A
--     takes the nonce's advisory lock and claims the row; session B asks for the
--     same lock and BLOCKS for 7.37 s (every other statement in that session ran
--     in ~88 ms), then proceeds only once A has ended — and sees 0 rows, because
--     A rolled back, i.e. the nonce is correctly free again.
--     The same pair using `ON CONFLICT (nonce) DO NOTHING RETURNING` also
--     blocked (7.28 s) and then inserted, which is what corrected the claim
--     originally written here that DO NOTHING does not wait. Both shapes are
--     safe; the lock is kept because it is visible in the source.
--   * the ordering, in one session with 0112 + 0114 + 0115 applied and a probe
--     trigger on `public.transactions` recording whether the nonce was already
--     claimed at the instant the money row was written:
--         pre-0115   nonce_claimed_when_money_written = false
--         post-0115  nonce_claimed_when_money_written = true
--
-- Together: the second caller can no longer reach the money write, and the
-- claim now precedes it rather than following it.
--
-- Also confirmed post-apply, same rolled-back transaction: a normal
-- contribution, a normal withdrawal and a normal employer run all succeed; a
-- same-nonce replay of each returns the prior result and applies once; a
-- duplicated settlement row and a re-uploaded settlement file are both refused
-- with a readable message; and pg_get_functiondef still shows
-- `assert_finite_money` in all three money RPCs — 0114 survived.
-- =============================================================================
