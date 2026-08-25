-- 0135_reanchor_employer_recent_hires.sql
-- ============================================================================
-- The second half of the 0126 regression: the admin "Employers" scope
-- New-Members trend also reads zero.
--
-- 0134 fixed the contribution tiles by re-anchoring the payroll runs. The
-- new-member tiles were still 0 today / 0 this week / 0 this month against
-- 2 and 4 in the PREVIOUS windows — the same "all activity stopped" shape, from
-- the same root cause.
--
-- WHY, EXACTLY — and why the fix is a single number
-- --------------------------------------------------
-- src/data/employerSeed.js:169-172 states the calibration in its own words:
--     "Anchored to _demo_now() (2026-05-18) via days-ago-from-MOCK_NOW
--      (MOCK_NOW = _demo_now + 8d): day 8 = today/this-week, 12 = last week,
--      21 = earlier this month, 41 = last month."
-- Those five members' join dates ARE clock-relative (dateDaysAgo() follows
-- MOCK_NOW), so they moved when the clock moved. What did NOT survive is the
-- **8-day gap** the offsets were chosen against: 0126 set _demo_now() equal to
-- MOCK_NOW, so "8 days before MOCK_NOW" stopped meaning "today" and started
-- meaning "8 days ago". Every hire landed exactly one bucket too early.
--
-- So the repair is precisely +8 days — restoring the gap 0126 removed. Not a
-- tuned number: it is the same 8 the seed comment names.
--
--     empe-017  2026-06-23 -> 2026-07-01   today / this week / this month
--     empe-018  2026-06-23 -> 2026-07-01   today / this week / this month
--     empe-019  2026-06-19 -> 2026-06-27   last week
--     empe-020  2026-06-10 -> 2026-06-18   last month
--     empe-021  2026-05-21 -> 2026-05-29   earlier
--
-- ⚠️ EACH MEMBER'S SINGLE TRANSACTION MOVES WITH THEM. Measured first: all five
-- have exactly ONE transaction, dated on their join date (they are excluded
-- from the back-dated contribution history by the seed's ACTIVE_MEMBERS
-- filter). Moving the join date alone would leave a member contributing before
-- they existed.
--
-- ⚠️ ONLY DATES MOVE. No amount, unit, balance or NAV is touched; the guards
-- assert AUM and the transaction sum are byte-identical to a pre-shift snapshot.
--
-- The 8 is applied from the seed's own constant rather than hardcoded per row,
-- and the migration is a no-op if the rows have already been shifted.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _hires ON COMMIT DROP AS
SELECT id FROM public.subscribers
 WHERE id IN ('empe-017', 'empe-018', 'empe-019', 'empe-020', 'empe-021');

CREATE TEMP TABLE _pre ON COMMIT DROP AS
SELECT (SELECT COALESCE(SUM(total_balance), 0) FROM public.subscriber_balances) AS aum,
       (SELECT COALESCE(SUM(amount), 0)        FROM public.transactions)         AS txn_sum,
       (SELECT COUNT(*)                        FROM public.transactions)         AS txn_n,
       (SELECT COALESCE(MAX(registered_date), DATE '1900-01-01')
          FROM public.subscribers WHERE id IN (SELECT id FROM _hires))           AS newest_join;

DO $$
DECLARE v_n INT; v_bad INT; v_newest DATE; v_today DATE := public._demo_now()::date;
BEGIN
  SELECT COUNT(*) INTO v_n FROM _hires;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'ABORT: expected 5 recent-hire members, found %.', v_n USING ERRCODE = 'P0001';
  END IF;

  -- Each must have exactly one transaction, on their join date. If that is not
  -- true any more, this shift is unsafe and must be re-derived.
  SELECT COUNT(*) INTO v_bad
    FROM public.subscribers s
    JOIN _hires h ON h.id = s.id
   WHERE (SELECT COUNT(*) FROM public.transactions t WHERE t.subscriber_id = s.id) <> 1
      OR (SELECT MIN(t.date)::date FROM public.transactions t WHERE t.subscriber_id = s.id)
         IS DISTINCT FROM s.registered_date;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: % recent-hire member(s) no longer have exactly one txn on their join date.', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  SELECT newest_join INTO v_newest FROM _pre;
  IF v_newest = v_today THEN
    RAISE NOTICE 'already re-anchored (newest hire = %) — nothing to do.', v_today;
  END IF;
END $$;

-- The transaction first, so it can be matched on the OLD join date.
UPDATE public.transactions t
   SET date = t.date + INTERVAL '8 days'
  FROM public.subscribers s
 WHERE s.id = t.subscriber_id
   AND s.id IN (SELECT id FROM _hires)
   AND (SELECT newest_join FROM _pre) <> public._demo_now()::date;

UPDATE public.subscribers s
   SET registered_date = s.registered_date + 8,
       last_contribution_date = CASE
         WHEN s.last_contribution_date IS NULL THEN NULL
         ELSE s.last_contribution_date + 8 END
 WHERE s.id IN (SELECT id FROM _hires)
   AND (SELECT newest_join FROM _pre) <> public._demo_now()::date;

-- ---------------------------------------------------------------------------
-- GUARDS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  p RECORD; v_aum NUMERIC; v_sum NUMERIC; v_n INT;
  v_today DATE := public._demo_now()::date; v_newest DATE; v_bad INT;
BEGIN
  SELECT * INTO p FROM _pre;
  SELECT COALESCE(SUM(total_balance), 0) INTO v_aum FROM public.subscriber_balances;
  SELECT COALESCE(SUM(amount), 0)        INTO v_sum FROM public.transactions;
  SELECT COUNT(*)                        INTO v_n   FROM public.transactions;

  IF v_aum <> p.aum THEN
    RAISE EXCEPTION 'ABORT: AUM changed % -> %. Dates only.', p.aum, v_aum USING ERRCODE='P0001';
  END IF;
  IF v_sum <> p.txn_sum OR v_n <> p.txn_n THEN
    RAISE EXCEPTION 'ABORT: transactions changed (sum % -> %, count % -> %).', p.txn_sum, v_sum, p.txn_n, v_n USING ERRCODE='P0001';
  END IF;

  -- The point of the whole migration: at least one hire on the clock date, so
  -- the "new members today / this week / this month" tiles are non-zero.
  SELECT MAX(registered_date) INTO v_newest
    FROM public.subscribers WHERE id IN (SELECT id FROM _hires);
  IF v_newest <> v_today THEN
    RAISE EXCEPTION 'ABORT: newest hire is %, expected the demo clock %.', v_newest, v_today USING ERRCODE='P0001';
  END IF;

  -- Nobody may contribute before they joined.
  SELECT COUNT(*) INTO v_bad
    FROM public.subscribers s JOIN public.transactions t ON t.subscriber_id = s.id
   WHERE s.id IN (SELECT id FROM _hires) AND t.date::date < s.registered_date;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: % transaction(s) now predate their member''s join date.', v_bad USING ERRCODE='P0001';
  END IF;

  -- And nobody may have joined in the future.
  SELECT COUNT(*) INTO v_bad FROM public.subscribers
   WHERE id IN (SELECT id FROM _hires) AND registered_date > v_today;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: % hire(s) dated after the demo clock.', v_bad USING ERRCODE='P0001';
  END IF;

  RAISE NOTICE 'guards OK — AUM and txn totals unchanged, newest hire % = demo clock', v_newest;
END $$;

COMMIT;
