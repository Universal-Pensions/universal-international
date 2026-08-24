-- 0110_purge_employer_run_residue.sql
-- ============================================================================
-- Phase 2 · A04-009, A06-001/A14-002 — remove employer contribution-run residue
-- injected into LIVE by the broken e2e teardown (A06-002, fixed in Phase 0).
--
-- 1,881 rows · 33 txn_refs · 145,372,000 UGX · inflating live AUM ~4.9%.
--
-- ⚠️ READ THIS BEFORE CHANGING THE PREDICATE ⚠️
--
-- `EMP-` IS THE LIVE EMPLOYER-RUN PREFIX. It is emitted by the SHIPPING
-- submit_employer_contribution_run as 'EMP-' || substr(v_run_id, 5, 8), in
-- migrations 0044, 0053, 0062, 0066, 0067, 0092, 0093 and 0102. It is NOT a
-- residue marker. A bare `txn_ref LIKE 'EMP-%'` delete would destroy any
-- employer run a sales rep demos between now and this migration running, and
-- the paired balance rebuild would make the loss arithmetically invisible.
-- On a free tier with no point-in-time recovery.
--
-- The remediation plan proposed discriminating positively by joining
-- contribution_runs for CI-window provenance. MEASURED 2026-08-25: that matches
-- 57 of the 1,881 rows. The other 1,824 have contribution_run_id IS NULL —
-- the teardown deleted the run header first and the FK is ON DELETE SET NULL,
-- so their provenance was destroyed. They are orphans BECAUSE the join key is
-- gone. See docs/audits/2026-08-23/a04/phase2-emp-predicate.md.
--
-- Therefore: an EXPLICIT FROZEN LIST of the 33 refs, captured 2026-08-25, and
-- RE-ASSERTED against live immediately before the delete. If the EMP- set has
-- grown, a rep created a real run and this migration ABORTS rather than guess.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- The frozen residue set. Captured 2026-08-25. Do not edit without re-measuring.
-- Signature: 33 refs x exactly 57 rows each (the CI employer's roster), daily
-- from 2026-07-30, with repeating identical amounts.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _frozen_refs (txn_ref text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _frozen_refs (txn_ref) VALUES
   ('EMP-d7980790')
 ,('EMP-32ef1f4a')
 ,('EMP-2ed0f1dd')
 ,('EMP-ef1d1d3b')
 ,('EMP-5238676e')
 ,('EMP-a9dc6ea4')
 ,('EMP-0bd986bc')
 ,('EMP-0cb1c4c2')
 ,('EMP-a3f6d4e5')
 ,('EMP-2e6bb16c')
 ,('EMP-31b20e2d')
 ,('EMP-933ab180')
 ,('EMP-6073c63d')
 ,('EMP-fff6f9b0')
 ,('EMP-ac9e11ee')
 ,('EMP-7dd90666')
 ,('EMP-587135d6')
 ,('EMP-fa34cc15')
 ,('EMP-07cfa1ea')
 ,('EMP-8ac86e9a')
 ,('EMP-c0ec2e47')
 ,('EMP-f6de2f1a')
 ,('EMP-1efe9caa')
 ,('EMP-17966c8e')
 ,('EMP-0ab9562a')
 ,('EMP-39d05d6a')
 ,('EMP-73a0e5c8')
 ,('EMP-f3816bc6')
 ,('EMP-a2d4d427')
 ,('EMP-c4642919')
 ,('EMP-1bd291a9')
 ,('EMP-f516defb')
 ,('EMP-b4a27020')
;

-- ---------------------------------------------------------------------------
-- GUARD 1 — the frozen list must still describe reality.
-- Aborts if any EMP- ref exists that is NOT in the frozen list: that is a
-- legitimate employer run created after the freeze, and it must be left alone.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_new_refs   text[];
  v_frozen_cnt int;
BEGIN
  SELECT array_agg(DISTINCT t.txn_ref)
    INTO v_new_refs
    FROM transactions t
   WHERE t.txn_ref LIKE 'EMP-%'
     AND t.txn_ref NOT IN (SELECT txn_ref FROM _frozen_refs);

  IF v_new_refs IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: % new EMP- ref(s) exist that were not in the 2026-08-25 freeze: %. '
      'These are legitimate employer runs. Re-measure before purging — do NOT widen the predicate.',
      array_length(v_new_refs, 1), v_new_refs
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_frozen_cnt FROM _frozen_refs;
  IF v_frozen_cnt <> 33 THEN
    RAISE EXCEPTION 'ABORT: frozen list holds % refs, expected 33.', v_frozen_cnt
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RECOVERY — snapshot before deleting, mirroring what 0105 did with _pre_nav.
-- This table joins the do-not-drop list. unpurge.sql restores from it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions_pre_purge_20260824 AS
SELECT * FROM public.transactions
 WHERE txn_ref IN (SELECT txn_ref FROM _frozen_refs);

COMMENT ON TABLE public.transactions_pre_purge_20260824 IS
  'Phase 2 (A04-009) pre-purge snapshot of employer-run residue, 2026-08-25. '
  'DO NOT DROP — this is the only recovery path for 0110. See docs/rollback.md.';

-- Snapshot the AFFECTED BALANCES verbatim too, not just the transactions.
-- Recomputing balances is NOT a perfect inverse of the incremental history the
-- trigger built up over time: proven on the scratch restore, a purge->unpurge
-- round trip that recomputed balances landed 2,022,125 UGX (0.08%) away from
-- the originals. Restoring the rows exactly but the balances approximately is
-- not a real undo. So keep the originals.
CREATE TABLE IF NOT EXISTS public.subscriber_balances_pre_purge_20260824 AS
SELECT * FROM public.subscriber_balances
 WHERE subscriber_id IN (
   SELECT DISTINCT subscriber_id FROM public.transactions
    WHERE txn_ref IN (SELECT txn_ref FROM _frozen_refs) AND subscriber_id IS NOT NULL
 );

COMMENT ON TABLE public.subscriber_balances_pre_purge_20260824 IS
  'Phase 2 (A04-009) pre-purge snapshot of the 19 affected balances, 2026-08-25. '
  'DO NOT DROP — 0110_unpurge.sql restores from this verbatim.';

-- GUARD 2 — the snapshot must have captured exactly what we are about to delete.
DO $$
DECLARE v_snap bigint; v_live bigint;
BEGIN
  SELECT count(*) INTO v_snap FROM public.transactions_pre_purge_20260824;
  SELECT count(*) INTO v_live FROM public.transactions
   WHERE txn_ref IN (SELECT txn_ref FROM _frozen_refs);
  IF v_snap <> v_live THEN
    RAISE EXCEPTION 'ABORT: snapshot holds % rows but % are live. Refusing to delete.', v_snap, v_live
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'Pre-purge snapshot: % rows captured.', v_snap;
END $$;

-- ---------------------------------------------------------------------------
-- THE PURGE
-- ---------------------------------------------------------------------------
DELETE FROM public.transactions
 WHERE txn_ref IN (SELECT txn_ref FROM _frozen_refs);

-- ---------------------------------------------------------------------------
-- REBUILD the balances the residue inflated, in the SAME transaction.
--
-- This system stores total_balance as CURRENT MARKET VALUE, not cost basis.
-- Verified on live 2026-08-25: all 5,060 balance rows satisfy
--     total_balance = round(units * latest_nav())
-- exactly (e.g. s-0001: 897.9839115963516446 x 1571.4 = 1,411,092).
--
-- So the rebuild is two steps, in this order:
--   1. units — recomputed from the surviving settled transactions, each priced
--      at the NAV in force ON ITS OWN DATE (nav_for_date), never at a single
--      current NAV, which would misprice historical rows. Verified that
--      nav_for_date returns real historical values (2026-07-30 -> 1580.72,
--      today -> 1571.4).
--   2. total_balance — DERIVED from units at the current NAV.
--
-- An earlier draft rebuilt total_balance as sum(amount) (cost basis). The dry
-- run against a restored copy of live caught it: 19 of 19 touched balances
-- failed the units x NAV check. That is what the dry run is for.
-- ---------------------------------------------------------------------------
WITH touched AS (
  SELECT DISTINCT subscriber_id
    FROM public.transactions_pre_purge_20260824
   WHERE subscriber_id IS NOT NULL
),
rebuilt AS (
  SELECT s.subscriber_id,
         COALESCE(SUM(
           CASE WHEN t.type = 'contribution'
                THEN  t.amount / NULLIF(public.nav_for_date(t.date::date), 0)
                WHEN t.type = 'withdrawal'
                THEN -t.amount / NULLIF(public.nav_for_date(t.date::date), 0)
                ELSE 0 END), 0) AS units
    FROM touched s
    LEFT JOIN public.transactions t
           ON t.subscriber_id = s.subscriber_id
          AND t.status = 'settled'
   GROUP BY s.subscriber_id
)
UPDATE public.subscriber_balances b
   SET units         = r.units,
       total_balance = round(r.units * public.latest_nav())
  FROM rebuilt r
 WHERE b.subscriber_id = r.subscriber_id;

-- ---------------------------------------------------------------------------
-- GUARD 3 — no rebuilt balance may be negative or NaN.
-- (Asserting total_balance = units x NAV here would be circular, since the
-- UPDATE above derives it that way. These check the things that CAN go wrong.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.subscriber_balances b
   WHERE b.subscriber_id IN (SELECT DISTINCT subscriber_id FROM public.transactions_pre_purge_20260824)
     AND (b.units < 0 OR b.total_balance < 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % touched balance(s) went negative.', v_bad USING ERRCODE = 'P0001';
  END IF;
END $$;

-- GUARD 4 — no NaN anywhere in balances (A04-001's failure mode; NaN survives
-- every arithmetic check written as `<= 0`, so it must be tested explicitly).
DO $$
DECLARE v_nan int;
BEGIN
  SELECT count(*) INTO v_nan FROM public.subscriber_balances
   WHERE units::text = 'NaN' OR total_balance::text = 'NaN';
  IF v_nan > 0 THEN
    RAISE EXCEPTION 'ABORT: % balance row(s) hold NaN.', v_nan USING ERRCODE = 'P0001';
  END IF;
END $$;

-- GUARD 5 — the whole EMP- residue must be gone, and only it.
DO $$
DECLARE v_left bigint; v_snap bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.transactions
   WHERE txn_ref IN (SELECT txn_ref FROM _frozen_refs);
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ABORT: % residue row(s) survived the delete.', v_left USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_snap FROM public.transactions_pre_purge_20260824;
  RAISE NOTICE 'Purged % residue rows across 33 refs. Recoverable from transactions_pre_purge_20260824.', v_snap;
END $$;

COMMIT;
