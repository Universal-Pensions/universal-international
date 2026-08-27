-- 0138_reanchor_qa_residue_dates.down.sql
-- ============================================================================
-- Reverse of 0138: add back the 57 days it subtracted, restoring the QA residue
-- to its original (future-dated) positions.
--
-- Exact, because the up-migration was a single uniform whole-day shift over a
-- fixed ID list and touched nothing else. Guarded the same way: AUM and the
-- transaction sum must come back byte-identical, and it no-ops on replay.
--
-- You almost certainly do not want to run this — it re-introduces the demo
-- defect. It exists so 0138 is not one more entry in the "ups with no down"
-- column the 2026-08-26 review flagged (§2.2).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _residue_txn ON COMMIT DROP AS
SELECT id FROM (VALUES
  ('tx-s-0001-adhoc-23aad55df71b48a48837a1a1ede5cd6a'),
  ('tx-s-0001-adhoc-5f3f301eb2c74da1a072eccdeb8bd1de'),
  ('tx-s-0005-adhoc-19b8e33f2f534c24ba04a7c6a40cc6db'),
  ('tx-s-100117-init'),
  ('tx-s-100117-adhoc-62e94f61f21a49b1a345664a8eb268c4'),
  ('tx-s-0001-adhoc-0b39ecf3bdf84a2abae317a6a2729387'),
  ('tx-s-0001-adhoc-9d14c718d548444bbc0902df56cac582'),
  ('tx-s-100117-adhoc-666de5214f7646cd9c595e1bf36cb88b'),
  ('tx-s-100117-adhoc-c6f6e38e36404126ad62eb2b93e2931c'),
  ('tx-s-100117-sweep-5c3074652116425c91f013501f980c0a'),
  ('tx-s-100117-wd-9d3276ed45564b3caead81d55fca579b'),
  ('tx-s-0001-adhoc-04792fe870b84142974a0d2156002571'),
  ('tx-s-100170-init')
) AS v(id);

CREATE TEMP TABLE _pre ON COMMIT DROP AS
SELECT (SELECT COALESCE(SUM(total_balance), 0) FROM public.subscriber_balances) AS aum,
       (SELECT COALESCE(SUM(amount), 0)        FROM public.transactions)         AS txn_sum;

DO $$
DECLARE v_shift INT := 57; v_newest TIMESTAMPTZ;
BEGIN
  SELECT MAX(date) INTO v_newest FROM public.transactions WHERE id IN (SELECT id FROM _residue_txn);
  IF v_newest > public._demo_now() THEN
    RAISE NOTICE '0138.down: residue already sits after the clock — no-op.';
    RETURN;
  END IF;

  UPDATE public.transactions
     SET date = date + make_interval(days => v_shift)
   WHERE id IN (SELECT id FROM _residue_txn);

  UPDATE public.commissions
     SET first_contribution_date = first_contribution_date + v_shift,
         due_date                = due_date + v_shift
   WHERE id IN ('c-01000100', 'c-01000146');

  UPDATE public.withdrawals
     SET date        = date + v_shift,
         expected_by = expected_by + v_shift
   WHERE id = 'wd-s-100117-def63f699d0341e2876fc61d4de75468';
END $$;

DO $$
DECLARE v_pre RECORD; v_aum NUMERIC; v_sum NUMERIC;
BEGIN
  SELECT * INTO v_pre FROM _pre;
  SELECT COALESCE(SUM(total_balance), 0) INTO v_aum FROM public.subscriber_balances;
  SELECT COALESCE(SUM(amount), 0)        INTO v_sum FROM public.transactions;
  IF v_aum <> v_pre.aum OR v_sum <> v_pre.txn_sum THEN
    RAISE EXCEPTION '0138.down: money moved. AUM % -> %, txn sum % -> %.', v_pre.aum, v_aum, v_pre.txn_sum, v_sum;
  END IF;
END $$;

COMMIT;
