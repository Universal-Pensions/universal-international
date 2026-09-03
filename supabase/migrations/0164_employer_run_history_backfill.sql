-- 0164_employer_run_history_backfill.sql
-- ============================================================================
-- Six of seven employers have never posted a payroll run.
--
-- THE DEFECT
-- ----------
-- `src/data/employerSeed.js:317` builds contribution runs for EMPLOYER.id only,
-- so emp-001 has five runs and 210 transaction legs while emp-002..emp-007 have
-- zero of either — despite carrying 37 members between them. Measured on live
-- 2026-09-03. The consequence is visible on the admin Needs-attention
-- drill-down: 0163 gave those employers a real due date, but every one of them
-- reads "never run", and the employer Runs page is an empty state for six of
-- seven accounts in a demo a sales rep walks a prospect through.
--
-- THE FIX
-- -------
-- Four monthly runs each, shaped EXACTLY like emp-001's, so the six accounts
-- become indistinguishable from the one that already works. Per participating
-- member per run, three legs — the same three `run-005` carries:
--
--     contribution      · own      · 'Payroll deduction'  · A        · split 80/20
--     contribution      · employer · 'Bank transfer'      · A/2      · split 80/20
--     insurance_premium · employer · 'Bank transfer'      · 40,000   · split NULL
--
-- and `grand_total = employee_total + employer_total + insurance_total`, which
-- on emp-001 reconciles to the penny against the sum of its legs. This keeps
-- that property.
--
-- WHY THE LEGS ARE PRICED, NOT QUEUED
-- -----------------------------------
-- `fund_dealing_config.pricing_enabled` is TRUE — forward dealing is on — so a
-- row inserted with the default `pricing_status` would be stamped 'pending' and
-- sit in the pricing queue waiting for `price_pending_transactions()`. That is
-- correct for money arriving today and WRONG for a historical run: it would
-- park backdated payroll in the queue and light up the pending-orphan alarm.
--
-- Each contribution leg is therefore inserted with `pricing_status = 'priced'`
-- explicitly. `trg_transactions_stamp_dealing` documents that contract in its
-- own body — "Untouched default => this trigger decides. Anything else => the
-- caller has already priced the row itself and must not be second-guessed" —
-- and `trg_transactions_contribution` then takes its synchronous path, pricing
-- each leg at `nav_for_date(NEW.date)`: THAT DATE'S price, not today's. This is
-- exactly the back-dated employer run 0104's header describes. All 24 run dates
-- were verified to be business days carrying a published NAV before this file
-- was written.
--
-- SIDE EFFECTS, CHECKED RATHER THAN ASSUMED
-- -----------------------------------------
-- The contribution trigger also does three other things. All three were
-- measured against these 37 members on live and none of them fire:
--   • first-contribution commission — needs `subscribers.agent_id`; all 37 are
--     NULL (the employer roster sits outside the agent→subscriber tree), so no
--     commission is created and no agent is paid for work nobody did;
--   • save-to-cover insurance sweep — needs a `contribution_schedules` row with
--     `insurance_funding_mode = 'save_to_cover'`; none of the 37 has a schedule
--     row at all;
--   • annual indexation — same missing schedule row.
-- The insurance legs are `type = 'insurance_premium'`, and the trigger's WHEN
-- clause is `type = 'contribution' AND units_delta IS NULL`, so they credit no
-- units — matching emp-001, where the 40,000 legs buy nothing.
--
-- WHAT THIS MOVES
-- ---------------
-- AUM rises by the contributed amount, because these members really are being
-- credited money they are recorded as having contributed. That is the honest
-- outcome and the only self-consistent one: adding runs WITHOUT legs would show
-- a `grand_total` no transaction supports, and adding legs without pricing them
-- would leave the ledger and the balances disagreeing.
--
-- Amounts are DERIVED from md5(subscriber_id), never `random()`, so a re-run
-- produces byte-identical figures and the down migration can find exactly what
-- the up migration wrote (0105's rule).
--
-- REVERSIBILITY
-- -------------
-- `subscriber_balances` for the 37 affected members is snapshotted into
-- `subscriber_balances_pre_0164` FIRST; the down restores from it and RAISEs if
-- the table is missing, exactly as 0105 does. The down also needs to delete
-- priced transactions, which `trg_transactions_guard_mutation` refuses — its own
-- HINT names the escape hatch, `SET LOCAL app.allow_transaction_mutation = 'on'`,
-- which the down sets.
-- ============================================================================

-- NOTE: no BEGIN/COMMIT here. scripts/apply-migration.mjs wraps the whole
-- file in ONE transaction and writes the ledger row inside it, so an explicit
-- COMMIT in this file would close that transaction early and split the schema
-- change from its ledger row. TEMP ... ON COMMIT DROP and SET LOCAL both rely
-- on the wrapper's transaction, which is always there.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Restore point — before a single balance moves
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.subscriber_balances_pre_0164;
CREATE TABLE public.subscriber_balances_pre_0164 AS
SELECT b.*
  FROM public.subscriber_balances b
  JOIN public.subscribers s ON s.id = b.subscriber_id
 WHERE s.employer_id IN ('emp-002','emp-003','emp-004','emp-005','emp-006','emp-007');

REVOKE ALL ON public.subscriber_balances_pre_0164 FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.subscriber_balances_pre_0164 IS
  'Restore point for 0164. Balances of the 37 employer members as they stood before the run backfill credited units. 0164_...down.sql restores from this and RAISEs if it is absent. Safe to drop once 0164 is considered permanent.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The runs — four per employer, ending on a staggered date
-- ─────────────────────────────────────────────────────────────────────────────
-- The end dates are deliberately spread either side of the 35-day monthly grace
-- so the Needs-attention signal tells a real story instead of flagging everyone:
-- emp-002/003/006 land current, emp-004/005/007 land overdue by 20/35/62 days,
-- and emp-001 keeps its own 29. A signal that flags every employer teaches a
-- prospect nothing.
CREATE TEMP TABLE _runs_0164 (
  run_id      text PRIMARY KEY,
  employer_id text NOT NULL,
  period      text NOT NULL,
  run_at      timestamptz NOT NULL
) ON COMMIT DROP;

INSERT INTO _runs_0164 (run_id, employer_id, period, run_at) VALUES
  -- emp-002 Mbarara Dairy Co-op — current
  ('run-emp002-1','emp-002','May 2026 payroll',   '2026-05-26 12:00:00+00'),
  ('run-emp002-2','emp-002','June 2026 payroll',  '2026-06-25 12:00:00+00'),
  ('run-emp002-3','emp-002','July 2026 payroll',  '2026-07-24 12:00:00+00'),
  ('run-emp002-4','emp-002','August 2026 payroll','2026-08-20 12:00:00+00'),
  -- emp-003 Gulu Traders Union — current
  ('run-emp003-1','emp-003','May 2026 payroll',   '2026-05-08 12:00:00+00'),
  ('run-emp003-2','emp-003','June 2026 payroll',  '2026-06-10 12:00:00+00'),
  ('run-emp003-3','emp-003','July 2026 payroll',  '2026-07-08 12:00:00+00'),
  ('run-emp003-4','emp-003','August 2026 payroll','2026-08-05 12:00:00+00'),
  -- emp-004 Jinja Steel Mills — 20 days overdue
  ('run-emp004-1','emp-004','April 2026 payroll', '2026-04-10 12:00:00+00'),
  ('run-emp004-2','emp-004','May 2026 payroll',   '2026-05-08 12:00:00+00'),
  ('run-emp004-3','emp-004','June 2026 payroll',  '2026-06-10 12:00:00+00'),
  ('run-emp004-4','emp-004','July 2026 payroll',  '2026-07-10 12:00:00+00'),
  -- emp-005 Mbale Coffee Collective — 35 days overdue
  ('run-emp005-1','emp-005','March 2026 payroll', '2026-03-25 12:00:00+00'),
  ('run-emp005-2','emp-005','April 2026 payroll', '2026-04-24 12:00:00+00'),
  ('run-emp005-3','emp-005','May 2026 payroll',   '2026-05-26 12:00:00+00'),
  ('run-emp005-4','emp-005','June 2026 payroll',  '2026-06-25 12:00:00+00'),
  -- emp-006 Wakiso Agro Ltd — current
  ('run-emp006-1','emp-006','May 2026 payroll',   '2026-05-29 12:00:00+00'),
  ('run-emp006-2','emp-006','June 2026 payroll',  '2026-06-30 12:00:00+00'),
  ('run-emp006-3','emp-006','July 2026 payroll',  '2026-07-30 12:00:00+00'),
  ('run-emp006-4','emp-006','August 2026 payroll','2026-08-28 12:00:00+00'),
  -- emp-007 Lira Cotton Ginnery — 62 days overdue
  ('run-emp007-1','emp-007','February 2026 payroll','2026-02-27 12:00:00+00'),
  ('run-emp007-2','emp-007','March 2026 payroll',   '2026-03-30 12:00:00+00'),
  ('run-emp007-3','emp-007','April 2026 payroll',   '2026-04-29 12:00:00+00'),
  ('run-emp007-4','emp-007','May 2026 payroll',     '2026-05-29 12:00:00+00');

-- Per-member monthly deduction, derived not invented: 50,000–200,000 in 10,000
-- steps, keyed on md5(subscriber_id) so it is byte-reproducible across re-runs.
CREATE TEMP TABLE _members_0164 AS
SELECT s.id AS subscriber_id,
       s.employer_id,
       (50000 + (('x' || substr(md5(s.id), 1, 8))::bit(32)::bigint % 16) * 10000)::numeric AS own_amount
  FROM public.subscribers s
 WHERE s.employer_id IN ('emp-002','emp-003','emp-004','emp-005','emp-006','emp-007');

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM _members_0164;
  IF v_n = 0 THEN
    RAISE EXCEPTION '0164 found no members for emp-002..emp-007 — refusing to write runs with no legs';
  END IF;
  RAISE NOTICE '0164: % members across 6 employers', v_n;
END $$;

INSERT INTO public.contribution_runs
  (id, employer_id, period_label, status, employer_total, employee_total, insurance_total, grand_total, run_at)
SELECT r.run_id, r.employer_id, r.period, 'completed',
       SUM(m.own_amount / 2),                 -- employer match
       SUM(m.own_amount),                     -- employee deduction
       SUM(40000),                            -- insurance premium
       SUM(m.own_amount + m.own_amount / 2 + 40000),
       r.run_at
  FROM _runs_0164 r
  JOIN _members_0164 m ON m.employer_id = r.employer_id
 GROUP BY r.run_id, r.employer_id, r.period, r.run_at;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The legs
-- ─────────────────────────────────────────────────────────────────────────────
-- `dealing_date` is deliberately left to trg_transactions_stamp_dealing, which
-- derives it from received_at through dealing_date_for() — the same path a real
-- receipt takes. Hardcoding it here would be a second, drifting definition of
-- the cutoff rule.
--
-- ids carry the `t-bf164-` prefix so the down migration deletes exactly the rows
-- this migration wrote and can never match a real one.

-- (a) employee deduction — own
INSERT INTO public.transactions
  (id, subscriber_id, type, amount, date, status, method, source,
   contribution_run_id, received_at, pricing_status, split_retirement, split_emergency)
SELECT 't-bf164-own-' || m.subscriber_id || '-' || r.run_id,
       m.subscriber_id, 'contribution', m.own_amount, r.run_at, 'settled',
       'Payroll deduction', 'own', r.run_id, r.run_at, 'priced',
       ROUND(m.own_amount * 0.80), m.own_amount - ROUND(m.own_amount * 0.80)
  FROM _runs_0164 r
  JOIN _members_0164 m ON m.employer_id = r.employer_id;

-- (b) employer match — half the deduction
INSERT INTO public.transactions
  (id, subscriber_id, type, amount, date, status, method, source,
   contribution_run_id, received_at, pricing_status, split_retirement, split_emergency)
SELECT 't-bf164-emp-' || m.subscriber_id || '-' || r.run_id,
       m.subscriber_id, 'contribution', m.own_amount / 2, r.run_at, 'settled',
       'Bank transfer', 'employer', r.run_id, r.run_at, 'priced',
       ROUND((m.own_amount / 2) * 0.80), (m.own_amount / 2) - ROUND((m.own_amount / 2) * 0.80)
  FROM _runs_0164 r
  JOIN _members_0164 m ON m.employer_id = r.employer_id;

-- (c) insurance premium — buys no units (type is not 'contribution', so the
--     money trigger's WHEN clause excludes it), split NULL, exactly as emp-001.
INSERT INTO public.transactions
  (id, subscriber_id, type, amount, date, status, method, source,
   contribution_run_id, received_at)
SELECT 't-bf164-ins-' || m.subscriber_id || '-' || r.run_id,
       m.subscriber_id, 'insurance_premium', 40000, r.run_at, 'settled',
       'Bank transfer', 'employer', r.run_id, r.run_at
  FROM _runs_0164 r
  JOIN _members_0164 m ON m.employer_id = r.employer_id;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Prove it before committing
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_runs      integer;
  v_legs      integer;
  v_mismatch  integer;
  v_unpriced  integer;
  v_never_run integer;
BEGIN
  SELECT count(*) INTO v_runs FROM public.contribution_runs WHERE id LIKE 'run-emp%';
  IF v_runs <> 24 THEN
    RAISE EXCEPTION '0164 expected 24 runs, wrote %', v_runs;
  END IF;

  SELECT count(*) INTO v_legs FROM public.transactions WHERE id LIKE 't-bf164-%';
  RAISE NOTICE '0164: % runs, % legs', v_runs, v_legs;

  -- Every run's grand_total must equal the sum of its own legs, the property
  -- emp-001 already holds and the employer Runs page reads.
  SELECT count(*) INTO v_mismatch
    FROM public.contribution_runs r
    JOIN LATERAL (SELECT COALESCE(SUM(t.amount), 0) AS s
                    FROM public.transactions t
                   WHERE t.contribution_run_id = r.id) l ON TRUE
   WHERE r.id LIKE 'run-emp%' AND l.s <> r.grand_total;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION '0164: % run(s) whose grand_total does not equal the sum of their legs', v_mismatch;
  END IF;

  -- Every contribution leg must have been priced by the money trigger. One
  -- unpriced row means the synchronous path did not run and units are missing.
  SELECT count(*) INTO v_unpriced
    FROM public.transactions
   WHERE id LIKE 't-bf164-%' AND type = 'contribution'
     AND (units_delta IS NULL OR unit_price_applied IS NULL);
  IF v_unpriced > 0 THEN
    RAISE EXCEPTION '0164: % contribution leg(s) were not priced — the money trigger did not run', v_unpriced;
  END IF;

  -- And the thing this migration exists to fix.
  SELECT count(*) INTO v_never_run
    FROM public.employers e
    LEFT JOIN LATERAL (SELECT max(r.run_at) AS last_run FROM public.contribution_runs r
                        WHERE r.employer_id = e.id AND r.status = 'completed') lr ON TRUE
   WHERE lr.last_run IS NULL;
  IF v_never_run > 0 THEN
    RAISE EXCEPTION '0164: % employer(s) still have no completed run', v_never_run;
  END IF;
END $$;
