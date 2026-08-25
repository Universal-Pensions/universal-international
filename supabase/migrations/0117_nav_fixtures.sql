-- =============================================================================
-- Universal Pensions Uganda — 0117: re-anchor the NAV demo fixture
-- =============================================================================
-- Agent P3-nav-integrity · audit 2026-08-23 · closes A06-020 and the FIXTURE
-- half of A04-007. (The code half of A04-007 is in 0116.)
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- Live carried four `pending` nav_snapshots for 2026-08-04..07, every one of
-- them priced at the RETIRED hardcoded 1,000.00 — and all four sat BEHIND the
-- newest published day, 2026-08-08 @ 1,571.40:
--
--   published | 1242 | 2021-11-01 .. 2026-08-08 |  996.38 .. 1580.72
--   pending   |    4 | 2026-08-04 .. 2026-08-07 | 1000.00 .. 1000.00
--
-- Two consequences:
--
--   1. On the admin NAV screen they read as "awaiting approval" for days that
--      are already priced (A06-020).
--   2. Publishing one returns revalued:false and CANNOT move AUM, because
--      publish_nav_snapshot only revalues when the day being published becomes
--      the newest published day. 0105's own header calls that publish "the live
--      demo moment: it moves AUM and every member's growth at once" — and the
--      demo had silently stopped working.
--
-- 0112 deliberately left them alone because deleting them destroys the fixture
-- without rebuilding it. This migration deletes AND rebuilds.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS BUILDS
-- ---------------------------------------------------------------------------
--   * every stale pending row (any pending day not part of the new fixture) is
--     recorded and deleted;
--   * the gap between the old frontier and the new one is filled with PUBLISHED
--     weekdays on a deterministic price walk, and the member book is REVALUED
--     to the new frontier price so units x NAV == total_balance stays exact —
--     inserting published rows without revaluing would leave the book carried
--     at a price the register no longer states, which is precisely the drift
--     0116's assert_book_revaluable() exists to refuse;
--   * the last four weekdays are left PENDING at real prices AHEAD of the
--     frontier, so publishing the newest one is once again the newest day, does
--     revalue, and does move AUM.
--
-- DATES ARE RELATIVE, NOT HARDCODED. The fixture anchors itself off
-- public.kampala_today() and the register's own frontier, so it is still
-- correct whenever it is applied rather than decaying the way the 2026-08-04
-- rows did. Weekends are skipped: the fund does not price them.
--
-- PRICES ARE DETERMINISTIC, NOT RANDOM. Each day's move is derived from an md5
-- of the date, so re-running against the same calendar produces the same walk
-- and a reviewer can reproduce every number. Daily moves are bounded to
-- -0.28% .. +0.36%, far inside publish_nav_snapshot's 10% confirm gate.
--
-- ---------------------------------------------------------------------------
-- REVERSIBILITY
-- ---------------------------------------------------------------------------
-- public.nav_fixture_rollback_0117 records the deleted rows in full, every row
-- inserted, the previous frontier price, and any insurance accrual the
-- revaluation clamped. The revaluation itself needs no row-level rollback data:
-- it is a PURE FUNCTION of units and price, and this migration does not touch
-- units, so restating the book at the previous frontier price restores it
-- EXACTLY. 0117_nav_fixtures.down.sql does that.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-flight
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_bad      bigint;
  v_price    numeric;
BEGIN
  IF to_regprocedure('public.kampala_today()') IS NULL
     OR to_regprocedure('public.assert_book_revaluable(text,numeric)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: 0116 has not been applied. Apply it first — this fixture relies on its guards.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT unit_price INTO v_price FROM public.nav_snapshots
   WHERE fund_code = 'UPU-BAL' AND status = 'published' ORDER BY nav_date DESC LIMIT 1;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'ABORT: no published unit price for UPU-BAL to anchor the fixture to.' USING ERRCODE = 'P0001';
  END IF;

  -- The book must already be internally sound, because this migration is about
  -- to restate all of it. If it is not, 0112 / reprice_book_to_register first.
  SELECT count(*) INTO v_bad FROM public.subscriber_balances
   WHERE abs(COALESCE(retirement_units, 0) + COALESCE(emergency_units, 0) - units) > 0.000001;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ABORT: % member row(s) have bucket units that do not sum to total units (A04-016). Apply 0112, or run public.reprice_book_to_register(), before re-anchoring the fixture.',
      v_bad USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad FROM public.subscriber_balances
   WHERE retirement_balance + emergency_balance <> total_balance;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % member row(s) have buckets that do not sum to the total.', v_bad USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad FROM public.subscriber_balances
   WHERE total_balance <> round(units * v_price);
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ABORT: % member row(s) are not carried at the register price of %. Run public.reprice_book_to_register() first.',
      v_bad, v_price USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE '0117 pre-flight clean: book carried at %, 0 drift.', v_price;
END
$preflight$;


-- ---------------------------------------------------------------------------
-- 1. Rollback ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nav_fixture_rollback_0117 (
  seq           bigserial PRIMARY KEY,
  kind          text NOT NULL,          -- deleted_pending | inserted | frontier_before | accrual_clamped
  snapshot_id   text,
  fund_code     text,
  nav_date      date,
  unit_price    numeric,
  status        text,
  published_at  timestamptz,
  published_by  text,
  source        text,
  units_in_issue numeric,
  aum           numeric,
  members_priced integer,
  subscriber_id text,
  amount_before numeric,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nav_fixture_rollback_0117 IS
  '0117 (A06-020 / A04-007) rollback data: the pending rows deleted, every row inserted, the frontier price the book was carried at before the revaluation, and any insurance accrual the revaluation clamped. Read by 0117_nav_fixtures.down.sql. DO NOT DROP.';


-- ---------------------------------------------------------------------------
-- 2. Rebuild
-- ---------------------------------------------------------------------------
DO $fixture$
DECLARE
  c_fund         CONSTANT text := 'UPU-BAL';
  -- Four unsigned days is a deliberate demo choice: the admin "Needs attention"
  -- card turns `delayedNav` red at 3 (adminAttentionDerive.js ALERT_AT), so the
  -- rebuilt fixture lights the signal the demo is about to clear.
  c_pending_days CONSTANT int  := 4;

  v_today        date := public.kampala_today();
  v_prev_date    date;
  v_prev_price   numeric;
  v_weekdays     date[];
  v_n            int;
  v_pending      date[];
  v_backfill     date[];
  v_price        numeric;
  v_delta        numeric;
  v_frontier     date;
  v_frontier_px  numeric;
  v_units        numeric;
  v_aum          numeric;
  v_members      int;
  v_deleted      int;
  v_clamped      int;
  d              date;
BEGIN
  SELECT nav_date, unit_price INTO v_prev_date, v_prev_price
    FROM public.nav_snapshots
   WHERE fund_code = c_fund AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  -- Every weekday after the current frontier, up to and including today.
  SELECT array_agg(g::date ORDER BY g)
    INTO v_weekdays
    FROM generate_series(v_prev_date + 1, v_today, INTERVAL '1 day') g
   WHERE extract(isodow FROM g) < 6;

  v_n := COALESCE(array_length(v_weekdays, 1), 0);
  IF v_n < c_pending_days THEN
    -- Not enough calendar since the last publish to build the fixture without
    -- un-publishing a day that is already signed off. Never do that: clear the
    -- stale residue and stop.
    RAISE NOTICE
      '0117: only % weekday(s) since the last published price (%). Clearing stale pending rows only; no pending fixture built.',
      v_n, v_prev_date;
    v_pending  := ARRAY[]::date[];
    v_backfill := ARRAY[]::date[];
  ELSE
    v_pending  := v_weekdays[(v_n - c_pending_days + 1) : v_n];
    v_backfill := v_weekdays[1 : (v_n - c_pending_days)];
  END IF;

  -- ---- 2a. A06-020: record and delete every pending row that is not part of
  --          the fixture being built. All four live rows qualify: they sit
  --          behind the frontier and carry the retired 1,000.00 price.
  INSERT INTO public.nav_fixture_rollback_0117
    (kind, snapshot_id, fund_code, nav_date, unit_price, status, published_at,
     published_by, source, units_in_issue, aum, members_priced)
  SELECT 'deleted_pending', n.id, n.fund_code, n.nav_date, n.unit_price, n.status,
         n.published_at, n.published_by, n.source, n.units_in_issue, n.aum, n.members_priced
    FROM public.nav_snapshots n
   WHERE n.status = 'pending'
     AND NOT (n.fund_code = c_fund AND n.nav_date = ANY(v_pending));

  DELETE FROM public.nav_snapshots n
   WHERE n.status = 'pending'
     AND NOT (n.fund_code = c_fund AND n.nav_date = ANY(v_pending));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '0117: cleared % stale pending nav row(s).', v_deleted;

  -- ---- 2b. Record the price the book is carried at, for the down migration.
  INSERT INTO public.nav_fixture_rollback_0117 (kind, fund_code, nav_date, unit_price)
  VALUES ('frontier_before', c_fund, v_prev_date, v_prev_price);

  -- ---- 2c. Fill the gap with PUBLISHED weekdays on a deterministic walk.
  v_price := v_prev_price;
  IF array_length(v_backfill, 1) IS NOT NULL THEN
    FOREACH d IN ARRAY v_backfill LOOP
      -- Deterministic per-date move in [-0.0028, +0.0036]. md5 of the date, so
      -- the same calendar always yields the same walk.
      v_delta := ((abs((('x' || substr(md5(c_fund || d::text), 1, 8))::bit(32)::int)::bigint) % 65) - 28)::numeric / 10000.0;
      v_price := round(v_price * (1 + v_delta), 2);
      PERFORM public.assert_finite_money(v_price, 'backfilled unit price', 0.01, 1000000, false);

      INSERT INTO public.nav_snapshots
        (fund_code, nav_date, unit_price, status, published_at, source, published_by)
      VALUES (c_fund, d, v_price, 'published', now(), 'nav_fixture_0117', 'Fund Administration')
      ON CONFLICT (fund_code, nav_date) DO NOTHING;

      INSERT INTO public.nav_fixture_rollback_0117 (kind, fund_code, nav_date, unit_price, status)
      SELECT 'inserted', c_fund, d, v_price, 'published'
       WHERE EXISTS (SELECT 1 FROM public.nav_snapshots WHERE fund_code = c_fund AND nav_date = d);
    END LOOP;
  END IF;

  -- ---- 2d. Revalue the book onto the new frontier.
  SELECT nav_date, unit_price INTO v_frontier, v_frontier_px
    FROM public.nav_snapshots
   WHERE fund_code = c_fund AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  IF v_frontier <> v_prev_date THEN
    -- publish_nav_snapshot's COMPLEMENT RULE, verbatim: round the total and the
    -- retirement leg, take emergency as the difference. Rounding all three
    -- independently is what would trip v_reconciliation_exceptions.split_mismatch
    -- across every member.
    UPDATE public.subscriber_balances
       SET total_balance      = round(units * v_frontier_px),
           retirement_balance = round(retirement_units * v_frontier_px),
           emergency_balance  = round(units * v_frontier_px)
                                - round(retirement_units * v_frontier_px),
           nav_as_of          = v_frontier,
           updated_at         = now()
     WHERE subscriber_id IS NOT NULL;

    -- 0072 [H3] parity, and the ONLY lossy step in this migration: a NAV fall
    -- can push emergency_balance below an already accrued save-to-cover target.
    -- Rows it actually changes are recorded so the down migration can put them
    -- back. (Measured live 2026-08-25: 1 save_to_cover schedule, accrued 0 —
    -- this clamps nothing. The ledger exists so that stays true by evidence.)
    INSERT INTO public.nav_fixture_rollback_0117 (kind, subscriber_id, amount_before)
    SELECT 'accrual_clamped', s.subscriber_id, s.insurance_premium_accrued
      FROM public.contribution_schedules s
      JOIN public.subscriber_balances b ON b.subscriber_id = s.subscriber_id
     WHERE s.insurance_funding_mode = 'save_to_cover'
       AND s.insurance_premium_accrued > GREATEST(0, b.emergency_balance);

    UPDATE public.contribution_schedules s
       SET insurance_premium_accrued = LEAST(
             s.insurance_premium_accrued,
             GREATEST(0, (SELECT b.emergency_balance FROM public.subscriber_balances b
                           WHERE b.subscriber_id = s.subscriber_id))),
           updated_at = now()
     WHERE s.insurance_funding_mode = 'save_to_cover';
    GET DIAGNOSTICS v_clamped = ROW_COUNT;

    UPDATE public.subscribers
       SET current_unit_value = v_frontier_px,
           unit_value_as_of   = now()
     WHERE id IS NOT NULL;

    SELECT COALESCE(sum(units), 0), COALESCE(sum(total_balance), 0), count(*)
      INTO v_units, v_aum, v_members
      FROM public.subscriber_balances;

    UPDATE public.nav_snapshots
       SET units_in_issue = v_units, aum = v_aum, members_priced = v_members
     WHERE fund_code = c_fund AND nav_date = v_frontier;

    RAISE NOTICE '0117: book revalued % -> % (frontier % -> %). AUM now %.',
      v_prev_price, v_frontier_px, v_prev_date, v_frontier, v_aum;
  ELSE
    RAISE NOTICE '0117: no backfill needed; frontier stays % @ %.', v_prev_date, v_prev_price;
    v_frontier_px := v_prev_price;
  END IF;

  -- ---- 2e. The demo fixture: unsigned days AHEAD of the frontier, at REAL
  --          prices. These are what the admin publishes on stage.
  v_price := v_frontier_px;
  IF array_length(v_pending, 1) IS NOT NULL THEN
    FOREACH d IN ARRAY v_pending LOOP
      v_delta := ((abs((('x' || substr(md5(c_fund || d::text), 1, 8))::bit(32)::int)::bigint) % 65) - 28)::numeric / 10000.0;
      v_price := round(v_price * (1 + v_delta), 2);
      PERFORM public.assert_finite_money(v_price, 'pending unit price', 0.01, 1000000, false);

      INSERT INTO public.nav_snapshots
        (fund_code, nav_date, unit_price, status, source)
      VALUES (c_fund, d, v_price, 'pending', 'fund_admin_feed')
      ON CONFLICT (fund_code, nav_date) DO UPDATE
        SET unit_price = EXCLUDED.unit_price,
            status     = 'pending',
            source     = EXCLUDED.source;

      INSERT INTO public.nav_fixture_rollback_0117 (kind, fund_code, nav_date, unit_price, status)
      VALUES ('inserted', c_fund, d, v_price, 'pending');
    END LOOP;
    RAISE NOTICE '0117: % unsigned valuation day(s) queued, % .. %, ending at %.',
      array_length(v_pending, 1), v_pending[1], v_pending[array_length(v_pending, 1)], v_price;
  END IF;
END
$fixture$;


-- ---------------------------------------------------------------------------
-- 3. Post-flight — the fixture must be sound AND the demo must work
-- ---------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_pub_date   date;
  v_pub_price  numeric;
  v_pend_max   date;
  v_pend_min   date;
  v_n          bigint;
  v_probe      jsonb;
BEGIN
  SELECT nav_date, unit_price INTO v_pub_date, v_pub_price
    FROM public.nav_snapshots WHERE fund_code = 'UPU-BAL' AND status = 'published'
    ORDER BY nav_date DESC LIMIT 1;
  SELECT min(nav_date), max(nav_date) INTO v_pend_min, v_pend_max
    FROM public.nav_snapshots WHERE fund_code = 'UPU-BAL' AND status = 'pending';

  -- (a) the three money invariants
  SELECT count(*) INTO v_n FROM public.subscriber_balances
   WHERE retirement_balance + emergency_balance <> total_balance;
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % row(s) fail ret+emg = total.', v_n USING ERRCODE = 'P0001'; END IF;

  SELECT count(*) INTO v_n FROM public.subscriber_balances
   WHERE abs(COALESCE(retirement_units,0) + COALESCE(emergency_units,0) - units) > 0.000001;
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % row(s) fail ret_units+emg_units = units.', v_n USING ERRCODE = 'P0001'; END IF;

  SELECT count(*) INTO v_n FROM public.subscriber_balances
   WHERE total_balance <> round(units * v_pub_price);
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % row(s) fail total = round(units x NAV) at %.', v_n, v_pub_price USING ERRCODE = 'P0001'; END IF;

  -- (b) no stale pending row survives behind the frontier (A06-020)
  SELECT count(*) INTO v_n FROM public.nav_snapshots
   WHERE status = 'pending' AND nav_date <= v_pub_date;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % pending row(s) still sit behind the published frontier %.', v_n, v_pub_date USING ERRCODE = 'P0001';
  END IF;

  -- (c) no pending row still carries the retired 1,000 price
  SELECT count(*) INTO v_n FROM public.nav_snapshots WHERE status = 'pending' AND unit_price = 1000;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % pending row(s) still carry the retired 1,000.00 unit price.', v_n USING ERRCODE = 'P0001';
  END IF;

  -- (d) THE DEMO. Publishing the newest pending day must be able to revalue,
  --     which requires it to be strictly newer than the newest published day.
  IF v_pend_max IS NULL THEN
    RAISE NOTICE '0117: no pending fixture was built (not enough calendar). The "publish moves AUM" demo will not run.';
  ELSIF v_pend_max <= v_pub_date THEN
    RAISE EXCEPTION
      'ABORT: newest pending day % is not ahead of the newest published day % — publishing it would return revalued:false and could not move AUM.',
      v_pend_max, v_pub_date USING ERRCODE = 'P0001';
  ELSE
    RAISE NOTICE '0117: demo armed — published through % @ %, unsigned % .. %. Publishing % revalues.',
      v_pub_date, v_pub_price, v_pend_min, v_pend_max, v_pend_max;
  END IF;

  -- (e) 0116's guard must PASS on the fixture just built. A fixture that its own
  --     publish guard would refuse is a broken fixture.
  v_probe := public.assert_book_revaluable('UPU-BAL', v_pub_price);
  IF (v_probe ->> 'checked')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ABORT: assert_book_revaluable could not check the book: %', v_probe USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '0117: book revaluable — implied %, register %, drift % percent.',
    v_probe ->> 'impliedPrice', v_probe ->> 'bookPrice', v_probe ->> 'driftPct';

  SELECT count(*) INTO v_n FROM public.nav_unsigned_days('UPU-BAL');
  RAISE NOTICE '0117: "Delayed NAV updation" now reads %.', v_n;
  RAISE NOTICE '0117 post-flight clean.';
END
$postflight$;
