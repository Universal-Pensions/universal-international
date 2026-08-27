-- 0138_reanchor_qa_residue_dates.sql
-- ============================================================================
-- Manual QA/demo walkthroughs left 13 transactions dated AFTER the demo clock.
-- Re-anchor them (and the three rows that were created alongside them) to sit
-- before it, so nothing in the demo reads as having happened in the future.
--
-- WHY THIS IS DEMO-VISIBLE, NOT COSMETIC
-- --------------------------------------
-- Four of the thirteen belong to `s-0001` (Carol Obua) — the SUBSCRIBER FALLBACK
-- PERSONA. Per CLAUDE.md §8 every demo login with an unseeded phone resolves to
-- `s-0001`, so a sales rep signing in as a subscriber opens a transaction list
-- whose newest entries are dated August 2026 while the dashboard's "today" is
-- 2026-07-01 (`public._demo_now()`). One more sits on `s-0005`, and the rest on
-- two subscribers created by QA onboarding runs (`s-100117`, `s-100170`).
--
-- These are REAL contributions in the demo narrative — the money is correct and
-- the balances are correct. Only the dates are wrong. So this re-anchors rather
-- than deletes, exactly as 0134/0135 did for the employer payroll runs.
--
-- WHY -57 DAYS
-- ------------
-- Not tuned: it is the offset that lands the NEWEST residue row on the day
-- before the clock, computed from the data rather than hardcoded per row.
--     newest residue  2026-08-26  ->  2026-06-30  (_demo_now()::date - 1)
--     oldest residue  2026-08-02  ->  2026-06-06
-- A single uniform whole-day shift preserves every relative gap (the s-100117
-- contribution -> premium sweep -> withdrawal sequence stays intact, and the
-- time-of-day component is untouched), and it is exactly reversible: the .down
-- adds the same 57 days back.
--
-- THREE COMPANION ROWS MOVE TOO — measured, not assumed
-- ----------------------------------------------------
-- Each was written by the live app in the same instant as its transaction and
-- carries a timestamp-identical date. Shifting the transaction alone would put
-- a first-contribution commission 57 days after the contribution that earned it:
--     commissions.c-01000100   s-100117   first_contribution_date + due_date
--     commissions.c-01000146   s-100170   first_contribution_date + due_date
--     withdrawals.wd-s-100117-def63f69…   date + expected_by
--
-- WHAT IS DELIBERATELY NOT TOUCHED
-- --------------------------------
-- * `t-demo-recon-1/2/3` (RECON-DEMO-001..003). Future-dated on purpose —
--   0098_admin_attention_seed created them to drive the admin reconciliation
--   signal. Excluded by ID, and the guard below asserts they survive.
-- * `created_at` anywhere. It is a technical insert stamp, not a demo-facing
--   date, and rewriting it would destroy the provenance that identified these
--   rows in the first place.
-- * Every OTHER future-dated demo date on the platform. A full sweep found the
--   same class in `withdrawals.date` (14 seeded `wd-demo-*` fixtures),
--   `commissions.paid_date` (10 seeded rows), `claims.*`, `nominee_claims.*`,
--   `agents.joined_date` and more — none of it QA residue, and some future
--   dates there are CORRECT BY DESIGN (`contribution_schedules.next_due_date`,
--   `*.renewal_date`, `employer_invites.expires_at`, the deliberately
--   unpublished `nav_snapshots` days that drive the "Delayed NAV updation"
--   signal). Separating those needs a per-column judgement call, so it is left
--   for its own migration rather than guessed at here.
--
-- ⚠️ ONLY DATES MOVE. No amount, unit, balance, NAV or status is touched. The
-- money triggers on `transactions` are AFTER INSERT only (verified against
-- pg_trigger: transactions_after_insert_contribution and
-- transactions_after_insert_withdrawal), so an UPDATE of `date` cannot re-price
-- a contribution or move units. The guards below assert AUM, the transaction
-- sum and the row count are byte-identical to a pre-shift snapshot.
--
-- Idempotent: re-running is a no-op once no residue row sits after the clock.
-- ============================================================================

BEGIN;

-- The residue set, pinned by ID so a later stray write can never be swept in.
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
SELECT (SELECT COALESCE(SUM(total_balance), 0) FROM public.subscriber_balances)  AS aum,
       (SELECT COALESCE(SUM(amount), 0)        FROM public.transactions)          AS txn_sum,
       (SELECT COUNT(*)                        FROM public.transactions)          AS txn_n,
       (SELECT COUNT(*) FROM public.transactions
         WHERE txn_ref LIKE 'RECON-DEMO-%')                                       AS recon_n;

DO $$
DECLARE
  v_shift  INT := 57;                                   -- see header
  v_today  DATE := public._demo_now()::date;
  v_n      INT;
  v_newest TIMESTAMPTZ;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.transactions WHERE id IN (SELECT id FROM _residue_txn);
  IF v_n <> 13 THEN
    RAISE EXCEPTION '0138: expected 13 residue transactions, found %. Re-measure before shifting.', v_n;
  END IF;

  -- Already shifted? Then this is a replay: leave everything alone.
  SELECT MAX(date) INTO v_newest FROM public.transactions WHERE id IN (SELECT id FROM _residue_txn);
  IF v_newest <= public._demo_now() THEN
    RAISE NOTICE '0138: residue already precedes the demo clock (newest %) — no-op.', v_newest;
    RETURN;
  END IF;

  -- The shift must land the newest row strictly before the clock, and must not
  -- push the oldest before the platform's first transaction.
  IF (v_newest - make_interval(days => v_shift))::date <> v_today - 1 THEN
    RAISE EXCEPTION '0138: shift of % days lands the newest row on %, expected %. Data moved since this was measured.',
      v_shift, (v_newest - make_interval(days => v_shift))::date, v_today - 1;
  END IF;

  UPDATE public.transactions
     SET date = date - make_interval(days => v_shift)
   WHERE id IN (SELECT id FROM _residue_txn);

  -- Companions, shifted by the SAME offset so each stays welded to its txn.
  UPDATE public.commissions
     SET first_contribution_date = first_contribution_date - v_shift,
         due_date                = due_date - v_shift
   WHERE id IN ('c-01000100', 'c-01000146');

  UPDATE public.withdrawals
     SET date        = date - v_shift,
         expected_by = expected_by - v_shift
   WHERE id = 'wd-s-100117-def63f699d0341e2876fc61d4de75468';
END $$;

-- ── Guards ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pre    RECORD;
  v_after  INT;
  v_aum    NUMERIC;
  v_sum    NUMERIC;
  v_n      INT;
  v_recon  INT;
BEGIN
  SELECT * INTO v_pre FROM _pre;

  SELECT COALESCE(SUM(total_balance), 0) INTO v_aum FROM public.subscriber_balances;
  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO v_sum, v_n FROM public.transactions;
  SELECT COUNT(*) INTO v_recon FROM public.transactions WHERE txn_ref LIKE 'RECON-DEMO-%';

  IF v_aum <> v_pre.aum THEN
    RAISE EXCEPTION '0138: AUM moved % -> %. Only dates may change.', v_pre.aum, v_aum;
  END IF;
  IF v_sum <> v_pre.txn_sum OR v_n <> v_pre.txn_n THEN
    RAISE EXCEPTION '0138: transaction sum/count moved %/% -> %/%.', v_pre.txn_sum, v_pre.txn_n, v_sum, v_n;
  END IF;
  IF v_recon <> v_pre.recon_n OR v_recon <> 3 THEN
    RAISE EXCEPTION '0138: the 3 RECON-DEMO fixtures must be untouched, found %.', v_recon;
  END IF;

  -- No residue row may remain after the clock.
  SELECT COUNT(*) INTO v_after
    FROM public.transactions
   WHERE id IN (SELECT id FROM _residue_txn) AND date > public._demo_now();
  IF v_after <> 0 THEN
    RAISE EXCEPTION '0138: % residue transaction(s) still sit after the demo clock.', v_after;
  END IF;

  -- Every commission must still be earned on or before its first contribution.
  SELECT COUNT(*) INTO v_after
    FROM public.commissions
   WHERE id IN ('c-01000100', 'c-01000146') AND first_contribution_date > public._demo_now()::date;
  IF v_after <> 0 THEN
    RAISE EXCEPTION '0138: % companion commission(s) still future-dated.', v_after;
  END IF;

  RAISE NOTICE '0138: 13 transactions + 3 companions re-anchored. AUM %, txn sum % — both unchanged.', v_aum, v_sum;
END $$;

COMMIT;
