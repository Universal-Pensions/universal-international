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
     -- NOT EXISTS, not NOT IN. `NOT IN (subquery)` evaluates to NULL for every
     -- row the moment the subquery yields a single NULL, so the guard would find
     -- nothing and report the frozen set intact while it was not. _frozen_refs
     -- is a PRIMARY KEY so it cannot hold NULL today; this is written to be
     -- correct regardless of that, because a guard that can silently no-op is
     -- exactly the failure mode this migration exists to prevent.
     AND NOT EXISTS (SELECT 1 FROM _frozen_refs f WHERE f.txn_ref = t.txn_ref);

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

-- Secure the snapshot AT CREATION. `CREATE TABLE … AS SELECT` inherits NOTHING
-- from its source — not RLS, not policies, not grants — so a copy of protected
-- rows lands wide open, and `anon` holds SELECT on essentially every table in
-- `public` (A02-101). Supabase's advisor flagged exactly this as CRITICAL on the
-- snapshots that reached live on 2026-08-25. RLS with NO policies is the point:
-- service_role and the owner bypass it, which is precisely and only who should
-- read a recovery snapshot.
ALTER TABLE public.transactions_pre_purge_20260824 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions_pre_purge_20260824 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.transactions_pre_purge_20260824 FROM anon, authenticated;


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

-- Secure the snapshot AT CREATION. `CREATE TABLE … AS SELECT` inherits NOTHING
-- from its source — not RLS, not policies, not grants — so a copy of protected
-- rows lands wide open, and `anon` holds SELECT on essentially every table in
-- `public` (A02-101). Supabase's advisor flagged exactly this as CRITICAL on the
-- snapshots that reached live on 2026-08-25. RLS with NO policies is the point:
-- service_role and the owner bypass it, which is precisely and only who should
-- read a recovery snapshot.
ALTER TABLE public.subscriber_balances_pre_purge_20260824 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_balances_pre_purge_20260824 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriber_balances_pre_purge_20260824 FROM anon, authenticated;


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
-- This is the EXACT INVERSE of what put the money there, not a from-scratch
-- recomputation. Derived by reading the two functions that own these columns:
--
--   trg_transactions_contribution — fires WHEN (new.type = 'contribution')
--   ONLY, and simply ACCUMULATES:
--       retirement_balance += COALESCE(split_retirement, round(amount*0.80))
--       emergency_balance  += COALESCE(split_emergency,  amount - round(amount*0.80))
--       units              += amount / nav_for_date(date)
--       invested           += amount
--   then calls _resync_bucket_units().
--
--   publish_nav_snapshot — the canonical revaluation:
--       total_balance      = round(units * nav)
--       retirement_balance = round(retirement_units * nav)
--       emergency_balance  = round(units * nav) - round(retirement_units * nav)
--
-- Two consequences that a from-scratch rebuild gets wrong:
--
--   1. The 627 `insurance_premium` residue rows NEVER touched subscriber_balances
--      — the trigger's WHEN clause excludes them. Only the 1,254 `contribution`
--      rows did. Subtracting the premiums would corrupt 19 real balances.
--
--   2. total_balance is NOT cost basis. All 5,060 live rows satisfy
--      total_balance = round(units * latest_nav()); an earlier draft of this
--      migration set it to sum(amount) and the dry run failed 19 of 19.
--
-- So: subtract the trigger's contribution, re-derive bucket units the way the
-- system does, then revalue exactly as publish_nav_snapshot does.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _deltas ON COMMIT DROP AS
SELECT p.subscriber_id,
       SUM(COALESCE(p.split_retirement, round(p.amount * 0.80)))                      AS d_ret_bal,
       SUM(COALESCE(p.split_emergency,  p.amount - round(p.amount * 0.80)))           AS d_emg_bal,
       SUM(p.amount / NULLIF(public.nav_for_date(p.date::date), 0))                   AS d_units,
       SUM(p.amount)                                                                  AS d_invested
  FROM public.transactions_pre_purge_20260824 p
 WHERE p.type = 'contribution'          -- the trigger's WHEN clause. Do not widen.
   AND p.subscriber_id IS NOT NULL
 GROUP BY p.subscriber_id;

-- Step 1 — undo the trigger's accumulation.
UPDATE public.subscriber_balances b
   SET retirement_balance = b.retirement_balance - d.d_ret_bal,
       emergency_balance  = b.emergency_balance  - d.d_emg_bal,
       units              = b.units              - d.d_units,
       invested           = COALESCE(b.invested, 0) - d.d_invested,
       updated_at         = now()
  FROM _deltas d
 WHERE b.subscriber_id = d.subscriber_id;

-- Step 2 — re-derive bucket units from the corrected balance ratio, using the
-- system's own function rather than hand-maintaining them (0104's rule).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT subscriber_id FROM _deltas LOOP
    PERFORM public._resync_bucket_units(r.subscriber_id);
  END LOOP;
END $$;

-- Step 3 — revalue at the current NAV, byte-identical to publish_nav_snapshot.
UPDATE public.subscriber_balances b
   SET total_balance      = round(b.units * public.latest_nav()),
       retirement_balance = round(b.retirement_units * public.latest_nav()),
       emergency_balance  = round(b.units * public.latest_nav())
                            - round(b.retirement_units * public.latest_nav())
 WHERE b.subscriber_id IN (SELECT subscriber_id FROM _deltas);

-- ---------------------------------------------------------------------------
-- GUARDS — the three invariants live actually maintains (measured 2026-08-25:
-- they hold for 5060/5060, 5059/5060 and 5060/5060 rows respectively; the one
-- exception is s-0005, which 0112 repairs via A04-016).
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.subscriber_balances b
   WHERE b.subscriber_id IN (SELECT subscriber_id FROM _deltas)
     AND abs((COALESCE(b.retirement_balance,0) + COALESCE(b.emergency_balance,0)) - b.total_balance) > 1;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) break retirement_balance + emergency_balance = total_balance.', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad FROM public.subscriber_balances b
   WHERE b.subscriber_id IN (SELECT subscriber_id FROM _deltas)
     AND abs((COALESCE(b.retirement_units,0) + COALESCE(b.emergency_units,0)) - b.units) > 0.0001;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) break retirement_units + emergency_units = units.', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad FROM public.subscriber_balances b
   WHERE b.subscriber_id IN (SELECT subscriber_id FROM _deltas)
     AND abs(b.total_balance - round(b.units * public.latest_nav())) > 1;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) break total_balance = units x NAV.', v_bad USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad FROM public.subscriber_balances b
   WHERE b.subscriber_id IN (SELECT subscriber_id FROM _deltas)
     AND (b.units < 0 OR b.total_balance < 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % balance(s) went negative.', v_bad USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad FROM public.subscriber_balances
   WHERE units::text = 'NaN' OR total_balance::text = 'NaN';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % balance row(s) hold NaN.', v_bad USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad FROM public.transactions
   WHERE txn_ref IN (SELECT txn_ref FROM _frozen_refs);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: % residue row(s) survived the delete.', v_bad USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'Purged 1881 residue rows across 33 refs; % balance(s) rebuilt. Recoverable from transactions_pre_purge_20260824.',
    (SELECT count(*) FROM _deltas);
END $$;

COMMIT;
