-- 0134_reanchor_employer_runs.sql
-- ============================================================================
-- Re-anchor seeded employer payroll runs to the demo clock, and remove one
-- surviving piece of E2E residue.
--
-- WHY — the regression 0126 caused
-- --------------------------------
-- 0126 unified public._demo_now() onto the JS anchor, moving it 2026-05-18 ->
-- 2026-07-01. That fix was right (audit A06-009: five clocks up to 44 days
-- apart). What it could not move is the seeded employer data, whose dates are
-- absolute literals in src/data/employerSeed.js.
--
-- Result on the admin Platform Overview "Employers" scope: every current-period
-- tile reads 0 while the previous-period tiles hold data — it reads as though
-- all employer activity stopped. get_employer_activity_rollup buckets
-- transactions.date against date_trunc('day'/'week'/'month', _demo_now()), and
-- emp-001's newest legs sat 44 days before that window.
-- Proven by A/B inside one rolled-back transaction, swapping only _demo_now():
--     2026-07-01 (live)  ->  daily 0        weekly 0
--     2026-05-18 (prior) ->  daily 2358000  weekly 2463000
-- Full write-up: docs/audits/2026-08-23/a06/REGRESSION-0126-employer-trends.md
--
-- THE RULE, applied uniformly
-- ---------------------------
-- Shift each employer's ENTIRE run set so that employer's NEWEST run lands on
-- the demo clock's date, carrying its transaction legs by the same offset.
-- One rule, four employers, both directions:
--     emp-001  newest 2026-05-18  ->  +44 days  (it was in the past)
--     emp-002  newest 2026-07-27  ->  -26 days  (it was in the FUTURE)
--     emp-004  newest 2026-07-30  ->  -29 days  (future)
--     emp-006  newest 2026-08-03  ->  -33 days  (future)
-- Three of them were future-dated "completed" payroll runs, which is its own
-- small absurdity on the employer Runs page and is fixed by the same rule.
--
-- The offset is COMPUTED from _demo_now(), not hardcoded, so this migration
-- re-anchors correctly whatever the clock says and is a no-op if run twice.
--
-- ⚠️ ONLY DATES MOVE. No amount, no unit, no balance, no NAV is touched, so
-- AUM and every money invariant are arithmetically unaffected. The guards at
-- the foot assert exactly that against a pre-shift snapshot.
--
-- ⚠️ THE LEGS MUST MOVE WITH THE HEADER. Measured before writing this: all 210
-- of emp-001's legs sit at exactly their run's date at 12:00:00+00 (42 per run,
-- of which 28 are type='contribution' summing 2,358,000). Shifting headers
-- without legs would desynchronise the Runs page from the ledger.
--
-- ALSO REMOVED — surviving E2E residue that 0110 could not see.
-- run-73a0e5c89d06448fb7b49696fe8946b4, "E2E Run 1785753040826", 2026-08-03,
-- grand_total 4,704,000, ZERO legs. 0110 purged residue by transactions.txn_ref;
-- this is an orphaned RUN HEADER with no transactions, so it matched nothing and
-- survived. It inflates emp-001's run total by 4.7M (19,294,000 vs the real
-- 14,590,000) and would show as that employer's newest run.
--
-- APPLIED VIA psql -f, so the file's own BEGIN/COMMIT makes it atomic.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- RECOVERY snapshots. Named to match the %_pre_purge_% convention 0127/0132's
-- standing guards key on, and secured immediately: `CREATE TABLE … AS SELECT`
-- inherits no RLS, no policies and no grants, which is what produced four
-- CRITICAL advisor findings earlier in this programme.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contribution_runs_pre_purge_20260825 AS
SELECT * FROM public.contribution_runs;
CREATE TABLE IF NOT EXISTS public.transactions_runshift_pre_purge_20260825 AS
SELECT * FROM public.transactions WHERE contribution_run_id IS NOT NULL;

ALTER TABLE public.contribution_runs_pre_purge_20260825      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contribution_runs_pre_purge_20260825      FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.contribution_runs_pre_purge_20260825     FROM anon, authenticated;
ALTER TABLE public.transactions_runshift_pre_purge_20260825  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions_runshift_pre_purge_20260825  FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.transactions_runshift_pre_purge_20260825 FROM anon, authenticated;

COMMENT ON TABLE public.contribution_runs_pre_purge_20260825 IS
  '0134 pre-shift snapshot of contribution_runs, 2026-08-25. DO NOT DROP.';
COMMENT ON TABLE public.transactions_runshift_pre_purge_20260825 IS
  '0134 pre-shift snapshot of run-linked transactions, 2026-08-25. DO NOT DROP.';

-- Money totals BEFORE, so the guards can prove nothing but dates moved.
CREATE TEMP TABLE _pre_money ON COMMIT DROP AS
SELECT (SELECT COALESCE(SUM(total_balance), 0) FROM public.subscriber_balances)          AS aum,
       (SELECT COALESCE(SUM(amount), 0) FROM public.transactions)                         AS txn_sum,
       (SELECT COUNT(*) FROM public.transactions)                                         AS txn_n,
       (SELECT COUNT(*) FROM public.contribution_runs)                                    AS run_n;

-- ---------------------------------------------------------------------------
-- 1. The E2E residue run header. Frozen id, not a LIKE on the label — a label
--    prefix is not a residue marker (the 0110 lesson).
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_legs INT; v_total NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_legs FROM public.transactions
   WHERE contribution_run_id = 'run-73a0e5c89d06448fb7b49696fe8946b4';
  IF v_legs <> 0 THEN
    RAISE EXCEPTION 'ABORT: the E2E run header has % transaction leg(s) — it is not an orphan, do not delete it.', v_legs
      USING ERRCODE = 'P0001';
  END IF;

  SELECT grand_total INTO v_total FROM public.contribution_runs
   WHERE id = 'run-73a0e5c89d06448fb7b49696fe8946b4';
  IF v_total IS NULL THEN
    RAISE NOTICE 'E2E run header already absent — nothing to remove.';
  ELSE
    DELETE FROM public.contribution_runs WHERE id = 'run-73a0e5c89d06448fb7b49696fe8946b4';
    RAISE NOTICE 'removed orphan E2E run header (phantom total %)', v_total;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Re-anchor. Per employer: offset = demo-clock date - that employer's newest
--    run date. Applied to the run headers AND their legs.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _shift ON COMMIT DROP AS
SELECT employer_id,
       (public._demo_now()::date - MAX(run_at)::date) AS days
  FROM public.contribution_runs
 GROUP BY employer_id;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM _shift ORDER BY employer_id LOOP
    RAISE NOTICE 'employer % -> shift % day(s)', r.employer_id, r.days;
  END LOOP;
END $$;

UPDATE public.transactions t
   SET date = t.date + (s.days * INTERVAL '1 day')
  FROM public.contribution_runs r
  JOIN _shift s ON s.employer_id = r.employer_id
 WHERE t.contribution_run_id = r.id
   AND s.days <> 0;

UPDATE public.contribution_runs r
   SET run_at = r.run_at + (s.days * INTERVAL '1 day')
  FROM _shift s
 WHERE s.employer_id = r.employer_id
   AND s.days <> 0;

-- Period labels are hand-written month names and would now contradict their own
-- dates. Recompute from the shifted date, preserving the "mid-cycle"/"latest"
-- qualifier where the original carried one.
UPDATE public.contribution_runs
   SET period_label = to_char(run_at, 'FMMonth YYYY') || ' ' ||
       CASE
         WHEN period_label ILIKE '%mid-cycle%' THEN 'mid-cycle'
         WHEN period_label ILIKE '%latest%'    THEN 'latest'
         ELSE 'payroll'
       END
 WHERE period_label ~* '(payroll|mid-cycle|latest)';

-- ---------------------------------------------------------------------------
-- GUARDS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_aum NUMERIC; v_txn_sum NUMERIC; v_txn_n INT; v_run_n INT;
  p RECORD; v_future INT; v_newest DATE; v_today DATE := public._demo_now()::date;
BEGIN
  SELECT * INTO p FROM _pre_money;

  SELECT COALESCE(SUM(total_balance), 0) INTO v_aum     FROM public.subscriber_balances;
  SELECT COALESCE(SUM(amount), 0)        INTO v_txn_sum FROM public.transactions;
  SELECT COUNT(*)                        INTO v_txn_n   FROM public.transactions;
  SELECT COUNT(*)                        INTO v_run_n   FROM public.contribution_runs;

  -- Only dates moved. Any drift here means this migration did something it
  -- must not have.
  IF v_aum <> p.aum THEN
    RAISE EXCEPTION 'ABORT: AUM changed % -> %. Dates only — no money may move.', p.aum, v_aum USING ERRCODE='P0001';
  END IF;
  IF v_txn_sum <> p.txn_sum OR v_txn_n <> p.txn_n THEN
    RAISE EXCEPTION 'ABORT: transactions changed (sum % -> %, count % -> %).', p.txn_sum, v_txn_sum, p.txn_n, v_txn_n USING ERRCODE='P0001';
  END IF;
  IF v_run_n <> p.run_n - 1 THEN
    RAISE EXCEPTION 'ABORT: expected exactly one run removed, went % -> %.', p.run_n, v_run_n USING ERRCODE='P0001';
  END IF;

  -- No "completed" payroll run may sit in the future on the demo clock.
  SELECT COUNT(*) INTO v_future FROM public.contribution_runs WHERE run_at::date > v_today;
  IF v_future <> 0 THEN
    RAISE EXCEPTION 'ABORT: % run(s) still dated after the demo clock.', v_future USING ERRCODE='P0001';
  END IF;

  -- Every employer with runs must now have its newest ON the clock, which is
  -- what makes the "today" tile non-zero.
  FOR p IN SELECT employer_id, MAX(run_at)::date AS newest
             FROM public.contribution_runs GROUP BY employer_id LOOP
    IF p.newest <> v_today THEN
      RAISE EXCEPTION 'ABORT: employer % newest run is %, expected %.', p.employer_id, p.newest, v_today USING ERRCODE='P0001';
    END IF;
  END LOOP;

  -- Legs must still sit on their header's date.
  SELECT COUNT(*) INTO v_future
    FROM public.transactions t JOIN public.contribution_runs r ON r.id = t.contribution_run_id
   WHERE t.date::date <> r.run_at::date;
  IF v_future <> 0 THEN
    RAISE EXCEPTION 'ABORT: % leg(s) no longer sit on their run date.', v_future USING ERRCODE='P0001';
  END IF;

  SELECT MAX(run_at)::date INTO v_newest FROM public.contribution_runs;
  RAISE NOTICE 'guards OK — AUM unchanged, txns unchanged, 1 orphan run removed, newest run % = demo clock', v_newest;
END $$;

COMMIT;
