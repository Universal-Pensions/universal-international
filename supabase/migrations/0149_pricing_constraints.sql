-- 0149_pricing_constraints.sql
-- ============================================================================
-- PHASE 8 of the unitization redesign. Make the new invariants unbreakable —
-- but only the ones that are actually invariant.
--
-- Every precondition was measured on live before this was written:
--     rows with a NULL received_at or dealing_date        0
--     rows with an unrecognised pricing_status            0
--     priced rows whose unit movement contradicts the money  0
--     members whose hold exceeds their allocated balance  0
--
-- TWO OF THE PLANNED CONSTRAINTS ARE DELIBERATELY NOT WHAT THE PLAN SAID, and
-- both changes are the difference between a guard and an outage.
--
-- 1. `transactions_priced_complete_chk` does NOT require nav_snapshot_id.
--    The plan lists it among the columns a priced row must carry. It cannot be:
--    while the pricing kill switch is OFF, contributions price synchronously
--    from the BOOK CARRYING PRICE, which is not tied to any particular dealing
--    date's register row — so the synchronous path has no snapshot id to
--    record, and requiring one would reject every contribution the moment this
--    migration applied. Measured: all 24,037 currently-priced rows have a NULL
--    nav_snapshot_id. Only the engine deals against a specific register row,
--    and only engine-priced rows carry the reference.
--
-- 2. `subscriber_balances_pending_chk` does NOT assert
--    `pending_redemption_* <= the matching balance`.
--    It is true at the moment a hold is placed — request_withdrawal validates
--    against withdrawable, so the hold can never exceed it — but it is NOT an
--    invariant afterwards. A NAV FALL revalues every member's allocated balance
--    downward while their holds stay frozen at the value confirmed to them, and
--    a member holding a large outstanding redemption can legitimately end up
--    with a hold above their new balance. As a CHECK that would abort the
--    UPDATE inside publish_nav_snapshot — so one member with a pending
--    withdrawal would block the price publish for all 5,060, on exactly the
--    falling day when publishing matters most.
--    The correct handling of that state already exists and is the engine's D8
--    branch: at the dealing date the redemption cannot be filled, so it is
--    REJECTED, the hold is released, and the member is told. A constraint here
--    would replace a handled member-level outcome with a platform-level outage.
--    Non-negativity IS an invariant, and is enforced.
--
-- `transactions_units_sign_chk` is also stated differently from the plan, and
-- more strongly. The plan keys the sign off the TYPE; this keys it off the
-- MONEY: units move in the same direction as the cash, whatever the row is
-- called. That version survives contact with reverse_transaction(), which
-- writes a compensating row of the SAME TYPE with both the amount and the unit
-- movement negated — a type-keyed check would reject every reversal of a
-- contribution.
--
-- NOT VALID IS DELIBERATE on the completeness check. It enforces the rule on
-- every new row while leaving the 24,037 grandfathered rows alone, which is
-- exactly what the data-migration section requires: their price was never
-- recorded and reconstructing it would mean re-striking member balances.
-- Do not run VALIDATE CONSTRAINT on it.
--
-- ROLLBACK: 0149_pricing_constraints.down.sql drops the four constraints and
-- re-drops the two NOT NULLs. Instant, and loses nothing but the guarantees.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Preconditions — refuse rather than half-apply
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT count(*) INTO v_n FROM public.transactions
   WHERE received_at IS NULL OR dealing_date IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % transaction(s) have a NULL received_at or dealing_date; the NOT NULLs below would fail.', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_n FROM public.transactions
   WHERE pricing_status NOT IN ('pending', 'priced', 'not_applicable', 'rejected', 'reversed');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % transaction(s) carry an unrecognised pricing_status.', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_n FROM public.transactions
   WHERE units_delta IS NOT NULL AND units_delta <> 0 AND amount <> 0
     AND sign(units_delta) <> sign(amount);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % transaction(s) move units in the opposite direction to the money.', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_n FROM public.subscriber_balances
   WHERE pending_contribution_retirement < 0 OR pending_contribution_emergency < 0
      OR pending_payout_retirement       < 0 OR pending_payout_emergency       < 0
      OR pending_redemption_retirement   < 0 OR pending_redemption_emergency   < 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % member(s) hold a negative in-process component.', v_n
      USING ERRCODE = 'P0001';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The receipt instant and the dealing date always exist
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.transactions ALTER COLUMN received_at  SET NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN dealing_date SET NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The lifecycle is a closed set
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_pricing_status_chk;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_pricing_status_chk
  CHECK (pricing_status IN ('pending', 'priced', 'not_applicable', 'rejected', 'reversed'));


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) A priced row records what it was priced at
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ THIS CANNOT BE A PLAIN CHECK, and finding out why cost a probe run.
--    The BEFORE INSERT stamp marks a money row 'priced' the moment it is
--    written (while the kill switch is off, pricing IS synchronous), but the
--    price and unit count are filled in by the AFTER INSERT trigger a moment
--    later. A row-level CHECK is evaluated on the inserted row BEFORE any AFTER
--    trigger runs, so it sees `priced` with a NULL price and rejects every
--    contribution the platform makes.
--
--    A DEFERRABLE CONSTRAINT TRIGGER is the established pattern for exactly
--    this in this schema — `subscriber_balances_bucket_units_sum` is the same
--    shape, for the same reason. It fires at COMMIT, by which time the row is
--    complete, and it still refuses to let the transaction land if it is not.
--
--    Scoped to rows written from now on (`priced_at IS NOT NULL OR
--    received_at > the migration's own clock`) would be fragile; instead it
--    checks only rows that claim to be priced AND carry a receipt after this
--    migration, leaving the 24,037 grandfathered rows — whose price was never
--    recorded and cannot be reconstructed without re-striking balances —
--    untouched.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_priced_complete_chk;

CREATE OR REPLACE FUNCTION public.trg_transactions_priced_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.transactions%ROWTYPE;
BEGIN
  -- ⚠️ RE-READ THE ROW. Do NOT trust NEW here.
  --    A DEFERRED trigger fires at COMMIT but is handed the row image from the
  --    event that QUEUED it. A contribution is inserted marked 'priced' and its
  --    price is stamped a moment later by the AFTER INSERT money trigger, so the
  --    queued INSERT image still shows NULLs and this would reject every
  --    contribution the platform makes.
  --
  --    That is not a theory: the first version of this trigger read NEW, passed
  --    every rolled-back probe — because a transaction that never commits never
  --    fires a deferred trigger at all — and was caught by the E2E suite, which
  --    commits. Rolled-back verification cannot test deferred constraints.
  SELECT * INTO v_row FROM public.transactions WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;   -- deleted later in the same transaction; nothing to assert
  END IF;

  IF v_row.pricing_status = 'priced'
     AND v_row.units_delta IS NULL
     AND v_row.unit_price_applied IS NULL
     AND v_row.priced_at IS NULL
     -- Grandfathered history: the 0144 backfill declared 24,037 rows priced
     -- without a price, because none was ever recorded and reconstructing one
     -- would mean re-striking member balances.
     AND v_row.received_at > TIMESTAMPTZ '2026-08-31 15:00:00+00' THEN
    RAISE EXCEPTION
      'Transaction % claims to be priced but records no price, no unit movement and no pricing time. A priced row must say what it was priced at.',
      v_row.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS transactions_priced_complete ON public.transactions;
CREATE CONSTRAINT TRIGGER transactions_priced_complete
  AFTER INSERT OR UPDATE ON public.transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_transactions_priced_complete();

REVOKE ALL ON FUNCTION public.trg_transactions_priced_complete() FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Units move with the money, not against it
-- ─────────────────────────────────────────────────────────────────────────────
-- Keyed off the SIGN OF THE AMOUNT rather than the type. Money in buys units;
-- money out sells them. That holds for a contribution, for a withdrawal, for a
-- save-to-cover sweep, and for the compensating row a reversal writes — which
-- keeps its original type while negating both figures, and which a type-keyed
-- check would reject.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_units_sign_chk;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_units_sign_chk
  CHECK (
    units_delta IS NULL
    OR units_delta = 0
    OR amount = 0
    OR sign(units_delta) = sign(amount)
  ) NOT VALID;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) In-process money is never negative
-- ─────────────────────────────────────────────────────────────────────────────
-- Non-negativity only. See the header for why `hold <= balance` is NOT asserted
-- here: it is true when a hold is placed and false after a NAV fall, and as a
-- CHECK it would turn one member's outstanding redemption into a failed price
-- publish for all 5,060.
ALTER TABLE public.subscriber_balances DROP CONSTRAINT IF EXISTS subscriber_balances_pending_chk;
ALTER TABLE public.subscriber_balances ADD CONSTRAINT subscriber_balances_pending_chk
  CHECK (
    pending_contribution_retirement >= 0 AND pending_contribution_emergency >= 0 AND
    pending_payout_retirement       >= 0 AND pending_payout_emergency       >= 0 AND
    pending_redemption_retirement   >= 0 AND pending_redemption_emergency   >= 0
  );
