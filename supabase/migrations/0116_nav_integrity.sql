-- =============================================================================
-- Universal Pensions Uganda — 0116: NAV integrity
-- =============================================================================
-- Agent P3-nav-integrity · audit 2026-08-23 · closes A04-003, A04-005, A04-007,
-- A04-008, and the SERVER half of A04-015.
--
-- ---------------------------------------------------------------------------
-- READ THIS FIRST — the NaN correction that governs every guard in this file
-- ---------------------------------------------------------------------------
-- An earlier note in this repo claimed `NOT (x > 0)` rejects NaN. It does not.
-- Measured on this database (PostgreSQL 17.6):
--
--     'NaN'::numeric > 0                -> t     NaN sorts ABOVE every numeric
--     not('NaN'::numeric > 0)           -> f     <-- NEVER fires
--     'NaN'::numeric = 'NaN'::numeric   -> t     <-- unlike float8: a
--                                                    CHECK (col = col) is USELESS
--     'NaN'::numeric >= 0
--       and 'NaN'::numeric < 'Infinity' -> f     <-- the working form
--
-- So NOTHING in this file hand-rolls a NaN test. Every amount goes through
-- public.assert_finite_money(), shipped by 0114, which rejects NULL / NaN /
-- +-Infinity by EXPLICIT EQUALITY. 0114 also already added
-- nav_snapshots_unit_price_finite_chk to the register table — this migration
-- does NOT touch that constraint and does not duplicate it.
--
-- ---------------------------------------------------------------------------
-- WHAT EACH FINDING GETS
-- ---------------------------------------------------------------------------
-- A04-005  publish_nav_snapshot's `p_unit_price <= 0` guard was inert for NaN.
--          Replaced with assert_finite_money(). 0114's table CHECK already
--          blocks the catastrophic path (the register INSERT happens BEFORE the
--          balance UPDATE — verified in the live body), so what this buys is
--          that the admin reads a sentence instead of a constraint violation.
--
-- A04-003  THE DANGEROUS ONE. scripts/seed-supabase.mjs:74-83 derives units from
--          a hardcoded `const UNIT_PRICE = 1000`, never writes retirement_units
--          / emergency_units / invested (all three default to 0), and never
--          touches nav_snapshots — so after a reseed the register still says
--          1,571.40 while every member's units were bought at 1,000. The next
--          NAV publish multiplies those units by the real NAV:
--
--            s-0004  before   671,179 = 536,943 retirement + 134,236 savings
--            s-0004  after  1,054,692 =       0 retirement + 1,054,692 savings
--
--          +57.1% AUM with no money in, every retirement pot zeroed, every
--          shilling reclassified as withdrawable savings, all growth to 0%.
--
--          The fix is STRUCTURAL: a publish is a REVALUATION — it takes a book
--          already carried at price P_old and restates it at P_new. If the book
--          is not currently carried at the register's own last published price,
--          the operation is not a revaluation and must not proceed.
--          public.assert_book_revaluable() enforces exactly that, and
--          publish_nav_snapshot calls it immediately before the whole-book
--          UPDATE. public.reprice_book_to_register() is the way back.
--
-- A04-007  get_admin_attention's nav_late CTE counted only pre-seeded `pending`
--          rows, so eleven unpriced weekdays were invisible and the fund could
--          stay unpriced indefinitely without the alert moving.
--          public.nav_unsigned_days() replaces it, and get_admin_attention_rows
--          now reads the SAME helper so badge and drill-down cannot drift.
--
-- A04-008  v_reconciliation_exceptions checked the shilling split but not the
--          UNIT ledger — and units are what price every member's money. Three
--          new branches: unit_split_mismatch, nav_mismatch, negative_balance,
--          non_finite_balance.
--
-- A04-015  SERVER half only. The session timezone is UTC; Uganda is UTC+3 with
--          no DST, so publish_nav_snapshot's own `p_nav_date > CURRENT_DATE`
--          guard rejected a legitimate same-day publish between 00:00 and 03:00
--          Kampala. public.kampala_today() fixes it. The CLIENT half
--          (AdminNavDesktop.jsx:110) is outside this agent's write-set and is
--          escalated, not silently left.
--
-- ---------------------------------------------------------------------------
-- HOW THE REPLACED BODIES WERE PRODUCED
-- ---------------------------------------------------------------------------
-- publish_nav_snapshot, get_admin_attention, get_admin_attention_rows and
-- v_reconciliation_exceptions were captured from pg_get_functiondef /
-- pg_get_viewdef on LIVE on 2026-08-25 and patched by anchored string
-- replacement — NOT retyped, and NOT copied from an older migration. That is
-- the 0095-over-0090 failure mode this repo has already shipped once, and the
-- same trap ef2c3d2 documented in four .down.sql files. 0116.down.sql restores
-- the byte-exact captures.
--
-- A04-006 / A05-009 guard headers already live in 0042/0043/0072/0089.down.sql
-- (commit ef2c3d2). They are NOT re-added here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-flight — refuse to run against a database that is not the one measured
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.assert_finite_money(numeric,text,numeric,numeric,boolean)') IS NULL THEN
    RAISE EXCEPTION
      'ABORT: 0114 has not been applied — public.assert_finite_money() does not exist. Apply 0114 first; this migration will not hand-roll a NaN test.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(x, ', ') INTO v_missing FROM (
    SELECT unnest(ARRAY[
      'public.publish_nav_snapshot(date,numeric,text,text,boolean)',
      'public.get_admin_attention()',
      'public.get_admin_attention_rows(text,integer)',
      'public.nav_for_date(date,text)',
      'public.latest_nav(text)',
      'public._admin_attention_thresholds()',
      'public._resync_bucket_units(text)'
    ]) AS x
  ) q WHERE to_regprocedure(q.x) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: expected function(s) missing: %', v_missing USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.v_reconciliation_exceptions') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.v_reconciliation_exceptions does not exist.' USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE '0116 pre-flight clean.';
END
$preflight$;


-- ---------------------------------------------------------------------------
-- 1. kampala_today() — A04-015 (server half)
-- ---------------------------------------------------------------------------
-- One definition of "what day is it in Uganda". The database session timezone
-- is UTC (verified live, and documented in 0126's header); Uganda is UTC+3 all
-- year with no DST, so for the first three hours of every Ugandan day
-- CURRENT_DATE is still yesterday.
--
--   select (timestamptz '2026-08-25 01:30:00+03')::date              -> 2026-08-24
--   select (timestamptz '2026-08-25 01:30:00+03'
--             at time zone 'Africa/Kampala')::date                   -> 2026-08-25
--
-- STABLE, not IMMUTABLE: it reads the transaction clock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kampala_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT (now() AT TIME ZONE 'Africa/Kampala')::date;
$$;

COMMENT ON FUNCTION public.kampala_today() IS
  '0116 (A04-015): today on the Kampala calendar. The session timezone is UTC and Uganda is UTC+3 with no DST, so CURRENT_DATE lags the Ugandan day between 00:00 and 03:00 local.';


-- ---------------------------------------------------------------------------
-- 2. assert_book_revaluable() — A04-003, the structural half
-- ---------------------------------------------------------------------------
-- A NAV publish is a REVALUATION. It takes a book already carried at the
-- register's last published price and restates it at the new one. If the book
-- is NOT carried at that price, the units are not real NAV units and
-- multiplying them by a real NAV produces money that nobody paid in.
--
-- TWO SIGNALS, deliberately different in kind:
--
-- SIGNAL 1 — the exact reseed signature, no threshold needed.
--   A reseed leaves `units > 0` with BOTH bucket-unit columns at their 0
--   default. That shape is IMPOSSIBLE for any row that has ever been through
--   public._resync_bucket_units(): that function sets
--   emergency_units = units - retirement_units, so whenever units > 0 at least
--   one bucket column is non-zero. Zero false positives by construction.
--
-- SIGNAL 2 — the aggregate implied price, for every OTHER way units can be
--   wrong. implied = SUM(total_balance) / SUM(units). Measured headroom:
--
--     live, healthy book   implied 1571.399992  vs register 1571.4  -> 0.0000005%
--     after a reseed       implied 1000.00      vs register 1571.4  ->     36.4%
--
--   Legitimate drift is tiny because trg_transactions_contribution credits
--   `amount` shillings and `amount / nav_for_date(txn date)` units together.
--   The only real source is BACK-DATED contributions priced at an older NAV,
--   and the arithmetic bounds it: 100,000,000 UGX (4% of the book) back-dated
--   to a NAV 12% below today's moves the implied price by 0.37%. The tolerance
--   is 2% — 5x that worst case, and 18x below the failure signature.
--
-- WHAT THIS DELIBERATELY DOES NOT BLOCK: a handful of rows whose bucket units
-- do not sum to units (A04-016 / s-0005). That error is bounded to the SPLIT of
-- one member's money — round(units * p) still gives the right total — so it is
-- reported through v_reconciliation_exceptions below, not used to freeze
-- platform-wide NAV publishing. A guard that blocks a legitimate NAV update is
-- worse than the bug.
--
-- NaN safety: if the book itself is already NaN, `v_units <= 0` is FALSE (NaN
-- sorts above), the drift computes to NaN, and `NaN > 2` is TRUE — so a NaN
-- book refuses further revaluation. That is the safe direction, and it is the
-- one place an inequality against NaN is doing what we want on purpose.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_book_revaluable(
  p_fund_code  text    DEFAULT 'UPU-BAL',
  p_book_price numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rows      bigint;
  v_units     numeric;
  v_aum       numeric;
  v_dead      bigint;
  v_implied   numeric;
  v_drift     numeric;
  c_tolerance CONSTANT numeric := 2;   -- percent; see the header arithmetic
BEGIN
  -- Only UPU-BAL carries the member book; any other fund revalues nothing.
  IF p_fund_code IS DISTINCT FROM 'UPU-BAL' THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'fund does not carry the member book');
  END IF;

  SELECT count(*),
         COALESCE(sum(units), 0),
         COALESCE(sum(total_balance), 0),
         count(*) FILTER (
           WHERE units > 0
             AND COALESCE(retirement_units, 0) = 0
             AND COALESCE(emergency_units,  0) = 0)
    INTO v_rows, v_units, v_aum, v_dead
    FROM public.subscriber_balances;

  IF v_rows = 0 OR v_units <= 0 THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'no member units to revalue', 'rows', v_rows);
  END IF;

  -- SIGNAL 1 — the reseed signature.
  IF v_dead > 0 THEN
    RAISE EXCEPTION
      'This price cannot be published. % member record(s) hold units that were never bought at a real unit price - their retirement and savings units are both zero, which is what a fresh data load leaves behind. Publishing now would rewrite every member''s balance at a price they never paid. Price the book from the register first (public.reprice_book_to_register), then publish.',
      v_dead
      USING ERRCODE = 'P0001',
            HINT    = 'A04-003: the seed derives units from a hardcoded 1,000 UGX price and leaves retirement_units / emergency_units / invested at 0.';
  END IF;

  -- SIGNAL 2 — the aggregate implied price.
  IF p_book_price IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'no published price to compare against',
                              'rows', v_rows, 'units', v_units, 'aum', v_aum);
  END IF;

  v_implied := v_aum / v_units;
  v_drift   := abs(v_implied - p_book_price) / p_book_price * 100;

  IF v_drift > c_tolerance THEN
    RAISE EXCEPTION
      'This price cannot be published. The member book is currently worth % per unit but the last published price is % - a gap of % percent. Publishing now would restate every member''s balance from a price they were never bought at. Price the book from the register first (public.reprice_book_to_register), then publish.',
      round(v_implied, 4), p_book_price, round(v_drift, 2)
      USING ERRCODE = 'P0001',
            HINT    = 'A04-003: units and the NAV register have gone out of step. This is what a reseed leaves behind.';
  END IF;

  RETURN jsonb_build_object(
    'checked',      true,
    'rows',         v_rows,
    'units',        v_units,
    'aum',          v_aum,
    'impliedPrice', round(v_implied, 6),
    'bookPrice',    p_book_price,
    'driftPct',     round(v_drift, 6),
    'tolerancePct', c_tolerance
  );
END;
$$;

COMMENT ON FUNCTION public.assert_book_revaluable(text, numeric) IS
  '0116 (A04-003): refuses a NAV revaluation when the member book is not carried at the register''s last published price. Signal 1 is the exact reseed signature (units > 0 with both bucket-unit columns at 0); signal 2 is a 2% tolerance on SUM(total_balance)/SUM(units).';


-- ---------------------------------------------------------------------------
-- 3. reprice_book_to_register() — the way back out of A04-003
-- ---------------------------------------------------------------------------
-- Without this, assert_book_revaluable would brick NAV publishing forever after
-- a reseed. This is the post-load repair the seed should run: it keeps every
-- member's SHILLINGS exactly as loaded and re-derives units from the register's
-- own last published price, so units x NAV == total_balance again.
--
-- Direction matters. After a reseed the balances are the real money and the
-- units are the garbage, so units are recomputed FROM total_balance — never the
-- other way round. Bucket units use public._resync_bucket_units()'s exact
-- arithmetic, inlined set-based so this is one statement and not 5,060 calls.
--
-- service_role only. It rewrites the whole book, there is no UI for it, and it
-- is only ever correct immediately after a bulk load. Same posture as
-- _resync_bucket_units.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reprice_book_to_register(p_fund_code text DEFAULT 'UPU-BAL')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_price numeric;
  v_date  date;
  v_rows  bigint;
BEGIN
  SELECT unit_price, nav_date INTO v_price, v_date
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'no published unit price for % - publish one before pricing the book', p_fund_code
      USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.assert_finite_money(v_price, 'published unit price', 0.01, 1000000, false);

  UPDATE public.subscriber_balances b
     SET units            = b.total_balance / v_price,
         retirement_units = CASE
             WHEN COALESCE(b.retirement_balance, 0) + COALESCE(b.emergency_balance, 0) > 0
               THEN round((b.total_balance / v_price) * b.retirement_balance
                          / (b.retirement_balance + b.emergency_balance), 6)
             ELSE 0 END,
         emergency_units  = (b.total_balance / v_price) - CASE
             WHEN COALESCE(b.retirement_balance, 0) + COALESCE(b.emergency_balance, 0) > 0
               THEN round((b.total_balance / v_price) * b.retirement_balance
                          / (b.retirement_balance + b.emergency_balance), 6)
             ELSE 0 END,
         -- A fresh load has no cost basis, so growth would otherwise read as a
         -- 100% gain. invested = what is in the pot means growth starts at 0%.
         invested         = CASE WHEN COALESCE(b.invested, 0) = 0 THEN b.total_balance ELSE b.invested END,
         nav_as_of        = v_date,
         updated_at       = now()
   WHERE b.subscriber_id IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE public.subscribers
     SET current_unit_value = v_price,
         unit_value_as_of   = now()
   WHERE id IS NOT NULL;

  RETURN jsonb_build_object(
    'fundCode',  p_fund_code,
    'unitPrice', v_price,
    'navDate',   to_char(v_date, 'YYYY-MM-DD'),
    'repriced',  v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.reprice_book_to_register(text) IS
  '0116 (A04-003): post-bulk-load repair. Keeps every member''s shillings and re-derives units, bucket units and cost basis from the register''s last published price. Run this after any reseed, BEFORE publishing a NAV.';


-- ---------------------------------------------------------------------------
-- 4. nav_unsigned_days() — A04-007
-- ---------------------------------------------------------------------------
-- ONE definition of "valuation days not signed off", read by both the count
-- (get_admin_attention) and the drill-down list (get_admin_attention_rows), so
-- the badge and the table it opens can never disagree again.
--
-- A day counts when it is a WEEKDAY, it falls after the last signed-off price,
-- and the navStaleDays grace has elapsed - whether or not a nav_snapshots row
-- exists for it. That last clause is the whole point: nothing in the platform
-- creates a pending row per weekday, so counting pending rows made an unpriced
-- fund look fine. Explicitly pending rows whose day has passed are unioned in
-- as well, so residue behind the published frontier still shows up.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nav_unsigned_days(p_fund_code text DEFAULT 'UPU-BAL')
RETURNS TABLE (nav_date date, snapshot_id text, unit_price numeric, source text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH frontier AS (
    SELECT max(n.nav_date) AS last_published
      FROM public.nav_snapshots n
     WHERE n.fund_code = p_fund_code AND n.status = 'published'
  ),
  grace AS (
    SELECT GREATEST(COALESCE((public._admin_attention_thresholds() ->> 'navStaleDays')::int, 1), 0) AS days
  ),
  overdue_weekdays AS (
    SELECT d::date AS nav_date
      FROM frontier f, grace g,
           generate_series(
             COALESCE(f.last_published, public.kampala_today()) + 1,
             public.kampala_today() - g.days,
             INTERVAL '1 day') d
     WHERE extract(isodow FROM d) < 6          -- Mon..Fri; the fund does not price weekends
  ),
  pending_rows AS (
    SELECT n.nav_date
      FROM public.nav_snapshots n
     WHERE n.fund_code = p_fund_code
       AND n.status = 'pending'
       AND n.nav_date < public.kampala_today()
  ),
  days AS (
    SELECT o.nav_date FROM overdue_weekdays o
    UNION
    SELECT p.nav_date FROM pending_rows p
  )
  SELECT d.nav_date,
         n.id,
         n.unit_price,
         n.source,
         COALESCE(n.status, 'unpriced')
    FROM days d
    LEFT JOIN public.nav_snapshots n
           ON n.fund_code = p_fund_code AND n.nav_date = d.nav_date
   ORDER BY d.nav_date;
$$;

COMMENT ON FUNCTION public.nav_unsigned_days(text) IS
  '0116 (A04-007): every weekday since the last SIGNED-OFF unit price that is still unsigned, whether or not a nav_snapshots row exists for it, plus any pending row whose day has passed. The single source for both the "Delayed NAV updation" count and its drill-down.';


-- ---------------------------------------------------------------------------
-- 5. publish_nav_snapshot — A04-005, A04-003, A04-015 (server half)
-- ---------------------------------------------------------------------------
-- Body captured from pg_get_functiondef on live 2026-08-25 and patched by
-- anchored replacement. Everything not marked "0116" is byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_nav_snapshot(p_nav_date date, p_unit_price numeric, p_fund_code text DEFAULT 'UPU-BAL'::text, p_source text DEFAULT 'admin_manual'::text, p_confirm_move boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role       TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_actor      TEXT := COALESCE((SELECT auth.jwt()) ->> 'name', 'admin');
  v_prev_price NUMERIC;
  v_prev_date  DATE;
  v_book_price NUMERIC;   -- 0116/A04-003: the price the BOOK is carried at
  v_move       NUMERIC := NULL;
  v_newest     DATE;
  v_is_newest  BOOLEAN;
  v_id         TEXT;
  v_units      NUMERIC;
  v_aum        NUMERIC;
  v_members    INTEGER;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot publish a unit price', v_role USING ERRCODE = 'P0001';
  END IF;
  -- 0116 / A04-005 — the guard that stood here was INERT against NaN.
  -- `'NaN'::numeric <= 0` is FALSE in Postgres because NaN sorts ABOVE every
  -- numeric, so a NaN price walked straight past it and, with p_confirm_move,
  -- drove all 5,060 subscriber_balances rows to NaN in one statement.
  -- 0114's shared guard rejects NULL / NaN / +-Infinity by EXPLICIT EQUALITY,
  -- which is the only form that works (`NOT (x > 0)` does not fire either).
  -- 0114's nav_snapshots_unit_price_finite_chk is the table-level backstop;
  -- this call exists so the admin reads a sentence, not a constraint violation.
  -- p_whole_shillings => false: a unit price legitimately carries decimals.
  PERFORM public.assert_finite_money(p_unit_price, 'unit price', 0.01, 1000000, false);

  -- 0116 / A04-015 (server half) — this database's session timezone is UTC
  -- (verified live) but the fund prices on the Kampala calendar (UTC+3, no
  -- DST). Between 00:00 and 03:00 local, CURRENT_DATE is still YESTERDAY, so
  -- this guard rejected a perfectly legitimate same-day publish. The client
  -- half of A04-015 lives in AdminNavDesktop.jsx and is escalated separately.
  IF p_nav_date IS NULL OR p_nav_date > public.kampala_today() THEN
    RAISE EXCEPTION 'cannot publish a price for a future date' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise concurrent publishes on this fund so two admins cannot interleave
  -- a revaluation between each other's register write.
  PERFORM 1 FROM public.nav_snapshots
   WHERE fund_code = p_fund_code FOR UPDATE;

  SELECT unit_price, nav_date INTO v_prev_price, v_prev_date
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published' AND nav_date < p_nav_date
   ORDER BY nav_date DESC LIMIT 1;

  IF v_prev_price IS NOT NULL AND v_prev_price > 0 THEN
    v_move := round(((p_unit_price - v_prev_price) / v_prev_price) * 100, 4);
    -- Server-side guard-rail. The client confirm dialog is a courtesy; THIS is
    -- the gate, so a scripted or replayed call cannot skip it.
    IF abs(v_move) > 10 AND NOT p_confirm_move THEN
      RAISE EXCEPTION
        'price move of %%% from % on % needs confirmation',
        round(v_move, 2), v_prev_price, v_prev_date
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 0116 / A04-003 — capture the price the BOOK is currently carried at BEFORE
  -- the register write below moves the published frontier. After the INSERT
  -- this row IS the newest published price, so the comparison would be against
  -- itself and prove nothing.
  SELECT unit_price INTO v_book_price
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  -- Re-publishing a day CORRECTS it, and flips a 'pending' day to 'published' —
  -- which is exactly how the admin clears a "Delayed NAV updation" signal.
  INSERT INTO public.nav_snapshots
    (fund_code, nav_date, unit_price, status, published_at, source, published_by)
  VALUES
    (p_fund_code, p_nav_date, p_unit_price, 'published', now(), p_source, v_actor)
  ON CONFLICT (fund_code, nav_date) DO UPDATE SET
    unit_price   = EXCLUDED.unit_price,
    status       = 'published',
    published_at = now(),
    source       = EXCLUDED.source,
    published_by = EXCLUDED.published_by
  RETURNING id INTO v_id;

  -- Revalue ONLY when this is now the newest published day. A back-dated
  -- correction must not restate today's book at a stale price.
  SELECT max(nav_date) INTO v_newest
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published';
  v_is_newest := (v_newest = p_nav_date);

  IF v_is_newest AND p_fund_code = 'UPU-BAL' THEN
    -- 0116 / A04-003 — REFUSE rather than silently revalue units that were
    -- never priced at a real NAV. A reseed writes units at the dead 1,000 UGX
    -- literal and leaves both bucket-unit columns at their 0 default; the next
    -- publish then multiplied those units by the real NAV and inflated AUM 57%
    -- while zeroing every member's retirement pot. Everything below this line
    -- is a whole-book rewrite, so this is the last place to stop it.
    PERFORM public.assert_book_revaluable(p_fund_code, v_book_price);

    -- Complement rule: round the total and the retirement leg, then take
    -- emergency as the difference. Rounding all three independently is what
    -- would trip v_reconciliation_exceptions.split_mismatch across 5,060 rows.
    UPDATE public.subscriber_balances
       SET total_balance      = round(units * p_unit_price),
           retirement_balance = round(retirement_units * p_unit_price),
           emergency_balance  = round(units * p_unit_price)
                                - round(retirement_units * p_unit_price),
           nav_as_of          = p_nav_date,
           updated_at         = now()
     WHERE subscriber_id IS NOT NULL;

    -- 0072 [H3] parity: a NAV fall can push emergency_balance below an already
    -- accrued save-to-cover target, which would let the next contribution sweep
    -- money that is no longer in the bucket. Same clamp request_withdrawal does.
    UPDATE public.contribution_schedules s
       SET insurance_premium_accrued = LEAST(
             s.insurance_premium_accrued,
             GREATEST(0, (SELECT b.emergency_balance FROM public.subscriber_balances b
                           WHERE b.subscriber_id = s.subscriber_id))),
           updated_at = now()
     WHERE s.insurance_funding_mode = 'save_to_cover';

    -- Denormalised per-member copy of the fund price. Permitted because the
    -- editable-columns trigger returns early for a non-'subscriber' role.
    UPDATE public.subscribers
       SET current_unit_value = p_unit_price,
           unit_value_as_of   = now()
     WHERE id IS NOT NULL;
  END IF;

  SELECT COALESCE(sum(units), 0), COALESCE(sum(total_balance), 0), count(*)
    INTO v_units, v_aum, v_members
    FROM public.subscriber_balances;

  UPDATE public.nav_snapshots
     SET units_in_issue = v_units, aum = v_aum, members_priced = v_members
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'id',                v_id,
    'fundCode',          p_fund_code,
    'navDate',           to_char(p_nav_date, 'YYYY-MM-DD'),
    'unitPrice',         p_unit_price,
    'previousUnitPrice', v_prev_price,
    'previousNavDate',   to_char(v_prev_date, 'YYYY-MM-DD'),
    'changePct',         v_move,
    'revalued',          v_is_newest,
    'unitsInIssue',      v_units,
    'aum',               v_aum,
    'membersPriced',     v_members
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 6. v_reconciliation_exceptions — A04-008
-- ---------------------------------------------------------------------------
-- The live view (pg_get_viewdef, 2026-08-25) had exactly five branches, all of
-- them about SHILLINGS: missing_balance, split_mismatch, orphan_subscriber,
-- orphan_run, agent_mismatch. Nothing checked the unit ledger, nothing checked
-- balance-vs-units-at-NAV, nothing checked negatives, nothing checked NaN — and
-- subscriber_balances carries no CHECK constraint of any kind (0 rows from
-- pg_constraint). Live proof of the gap: 1 member (s-0005, a 6.363752 unit gap
-- = exactly 10,000 UGX at the current price) was completely invisible to the
-- admin panel.
--
-- Four branches added below. The five original branches are the byte-exact
-- live text; 0116.down.sql restores that capture unchanged.
--
-- No frontend reads this view directly (grep: zero hits in src/ and server/).
-- Its only consumer is get_admin_attention's `recon` CTE, which counts by
-- `kind`, so the new branches surface as a higher "Reconciliation" number —
-- which is exactly the point of the finding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_reconciliation_exceptions AS
 SELECT 'user'::text AS kind,
    'missing_balance'::text AS check_code,
    'Member has no balance record'::text AS issue,
    s.id AS ref_id,
    s.name AS who,
    s.id AS subscriber_id,
    NULL::numeric AS amount,
    NULL::date AS occurred_on
   FROM subscribers s
     LEFT JOIN subscriber_balances b ON b.subscriber_id = s.id
  WHERE b.subscriber_id IS NULL
UNION ALL
 SELECT 'user'::text AS kind,
    'split_mismatch'::text AS check_code,
    'Retirement + emergency does not equal total balance'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    b.retirement_balance + b.emergency_balance - b.total_balance AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(b.retirement_balance + b.emergency_balance - b.total_balance) > 1::numeric
UNION ALL
 SELECT 'transaction'::text AS kind,
    'orphan_subscriber'::text AS check_code,
    'Transaction references a member that no longer exists'::text AS issue,
    t.id AS ref_id,
    COALESCE(t.subscriber_id, '—'::text) AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
  WHERE s.id IS NULL
UNION ALL
 SELECT 'transaction'::text AS kind,
    'orphan_run'::text AS check_code,
    'Transaction references a contribution run that no longer exists'::text AS issue,
    t.id AS ref_id,
    COALESCE(s.name, '—'::text) AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
     LEFT JOIN contribution_runs r ON r.id = t.contribution_run_id
  WHERE t.contribution_run_id IS NOT NULL AND r.id IS NULL
UNION ALL
 SELECT 'transaction'::text AS kind,
    'agent_mismatch'::text AS check_code,
    'Transaction credited to an agent who does not own this member'::text AS issue,
    t.id AS ref_id,
    s.name AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     JOIN subscribers s ON s.id = t.subscriber_id
  WHERE t.agent_id IS NOT NULL AND t.agent_id IS DISTINCT FROM s.agent_id
UNION ALL
-- 0116 / A04-008 ── the UNIT ledger. units are what price every member's money;
-- total_balance is DERIVED from them on every NAV publish. Until now the only
-- monitored invariant was the shilling split those units produce, so a broken
-- unit ledger survived silently until a publish turned it into wrong shillings.
 SELECT 'user'::text AS kind,
    'unit_split_mismatch'::text AS check_code,
    'Retirement + savings units do not add up to the member''s total units'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units) > 0.000001
UNION ALL
-- The A04-003 signature, per member. Wrapped in a scalar subquery so
-- latest_nav() is an InitPlan evaluated ONCE, not once per row.
 SELECT 'user'::text AS kind,
    'nav_mismatch'::text AS check_code,
    'Balance does not match the member''s units at the published unit price'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    b.total_balance - round(b.units * (SELECT public.latest_nav())) AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(b.total_balance - round(b.units * (SELECT public.latest_nav()))) > 1::numeric
UNION ALL
 SELECT 'user'::text AS kind,
    'negative_balance'::text AS check_code,
    'A balance or unit holding has gone below zero'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    LEAST(b.retirement_balance, b.emergency_balance, b.total_balance, b.units, COALESCE(b.invested, 0::numeric)) AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance < 0::numeric OR b.emergency_balance < 0::numeric
     OR b.total_balance < 0::numeric OR b.units < 0::numeric
     OR COALESCE(b.invested, 0::numeric) < 0::numeric
     OR COALESCE(b.retirement_units, 0::numeric) < '-0.000001'::numeric
     OR COALESCE(b.emergency_units, 0::numeric) < '-0.000001'::numeric
UNION ALL
-- NaN / Infinity MUST be caught by explicit equality. For numeric,
-- 'NaN' = 'NaN' is TRUE and 'NaN' > anything is TRUE, so every inequality
-- test silently passes it. See this migration's header.
 SELECT 'user'::text AS kind,
    'non_finite_balance'::text AS check_code,
    'A balance is not a real number'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    NULL::numeric AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance = 'NaN'::numeric OR b.emergency_balance = 'NaN'::numeric
     OR b.total_balance = 'NaN'::numeric OR b.units = 'NaN'::numeric
     OR COALESCE(b.invested, 0::numeric) = 'NaN'::numeric
     OR COALESCE(b.retirement_units, 0::numeric) = 'NaN'::numeric
     OR COALESCE(b.emergency_units, 0::numeric) = 'NaN'::numeric
     OR b.retirement_balance = 'Infinity'::numeric OR b.emergency_balance = 'Infinity'::numeric
     OR b.total_balance = 'Infinity'::numeric OR b.units = 'Infinity'::numeric;


-- ---------------------------------------------------------------------------
-- 7. get_admin_attention — A04-007
-- ---------------------------------------------------------------------------
-- Body captured from pg_get_functiondef on live 2026-08-25 and patched by
-- anchored replacement. Only the nav_late CTE, two new payload keys and the
-- FROM list change; everything else is byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_attention()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := (SELECT auth.jwt()) ->> 'app_role';
  v_today  date := CURRENT_DATE;
  v_result jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read platform attention', v_role USING ERRCODE = 'P0001';
  END IF;

  WITH
  -- #1 Dormant members.
  -- NOTE: this is the is_active flag, NOT a "no contribution in N days" recency
  -- test. Recency was measured and rejected: 5,000 of 5,063 members carry a
  -- last_contribution_date inside 30 days and the transaction ledger agrees, so
  -- every threshold from 60 to 120 days returns the same 47 rows. The flag is
  -- the only column with real spread (1,096 on live) and is what the card has
  -- always shown.
  dormant AS (
    SELECT count(*) AS n FROM public.subscribers WHERE NOT is_active
  ),

  -- #2 Employers past their payroll cadence (never run, or last run too old).
  emp_late AS (
    SELECT count(*) AS n
    FROM public.employers e
    LEFT JOIN LATERAL (
      SELECT max(r.run_at) AS last_run
      FROM public.contribution_runs r
      WHERE r.employer_id = e.id AND r.status = 'completed'
    ) lr ON TRUE
    WHERE COALESCE(e.status, 'active') <> 'inactive'
      AND (lr.last_run IS NULL
           OR lr.last_run::date < v_today - public._employer_grace_days(e.payroll_cadence))
  ),

  -- #3 Valuation days still unsigned after the day itself has passed.
  -- 0116 / A04-007 — this counted ONLY pre-seeded `pending` rows. Nothing in
  -- the platform creates a pending row per weekday, so on 2026-08-24 it read
  -- "4" while ELEVEN weekdays had no nav_snapshots row at ALL and the fund had
  -- been unpriced for 16 days. The fund could stay unpriced forever without
  -- the number ever moving. public.nav_unsigned_days() enumerates every
  -- overdue weekday since the last SIGNED-OFF price, whether or not a row
  -- exists for it, and get_admin_attention_rows lists exactly that same set so
  -- the badge and the drill-down can never disagree again.
  nav_late AS (
    SELECT count(*) AS n FROM public.nav_unsigned_days('UPU-BAL')
  ),
  nav_frontier AS (
    SELECT max(nav_date) AS last_published FROM public.nav_snapshots
     WHERE fund_code = 'UPU-BAL' AND status = 'published'
  ),

  -- #5 Access requests awaiting a decision.
  access_pending AS (
    SELECT count(*) AS n FROM public.access_requests WHERE status = 'pending'
  ),

  -- #6 Underperforming distributors. No distributors.score column exists (only
  -- branches and agents have one), so this is derived: any deactivated tenant,
  -- plus any live tenant whose active-contribution rate sits below the platform
  -- threshold, plus any live tenant holding branches but no members at all.
  dist_roll AS (
    SELECT d.id, COALESCE(d.status, 'active') AS status,
           count(DISTINCT b.id) AS branches,
           count(DISTINCT s.id) AS subscribers,
           count(DISTINCT s.id) FILTER (WHERE s.is_active) AS active_subscribers
    FROM public.distributors d
    LEFT JOIN public.branches    b ON b.distributor_id = d.id
    LEFT JOIN public.agents      a ON a.branch_id      = b.id
    LEFT JOIN public.subscribers s ON s.agent_id       = a.id
    GROUP BY d.id, d.status
  ),
  dist_under AS (
    SELECT count(*) AS n FROM dist_roll
    WHERE status = 'inactive'
       OR (branches > 0 AND subscribers = 0)
       OR (subscribers > 0
           AND (active_subscribers::numeric / subscribers) * 100
               < (public._admin_attention_thresholds() ->> 'underperformActiveRatePct')::numeric)
  ),

  -- #7 Claims past their decision SLA and not yet terminal.
  claims_late AS (
    SELECT count(*) AS n FROM public.claims
    WHERE status NOT IN ('paid', 'rejected') AND expected_by < v_today
  ),

  -- #8 Withdrawals still processing past their payout SLA, split by bucket.
  wd_late AS (
    SELECT count(*)                                          AS n,
           count(*) FILTER (WHERE bucket = 'retirement')      AS n_ret,
           count(*) FILTER (WHERE bucket = 'emergency')       AS n_emg
    FROM public.withdrawals
    WHERE status = 'processing' AND expected_by < v_today
  ),

  -- #9 Custody batches past due (pending) or outright failed.
  custody_late AS (
    SELECT count(*) AS n FROM public.custody_transfers
    WHERE status IN ('pending', 'failed') AND due_by < v_today
  ),

  -- #10 Named integrity breaks (0096 view).
  recon AS (
    SELECT count(*)                                    AS n,
           count(*) FILTER (WHERE kind = 'user')        AS n_user,
           count(*) FILTER (WHERE kind = 'transaction') AS n_txn
    FROM public.v_reconciliation_exceptions
  ),

  branches_off AS (
    SELECT count(*) AS n FROM public.branches WHERE status = 'inactive'
  )

  SELECT jsonb_build_object(
    'asOf',                        (now() AT TIME ZONE 'UTC'),
    'today',                       v_today,
    'dormantSubscribers',          dormant.n,
    'delayedEmployerTransfers',    emp_late.n,
    'delayedNav',                  nav_late.n,
    -- 0116 / A04-007: surface the real staleness next to the count. Kampala,
    -- not CURRENT_DATE — the session timezone is UTC and the fund prices at
    -- UTC+3. v_today is left alone so the other nine signals do not shift.
    'navLastPublishedDate',        nav_frontier.last_published,
    'navLastPublishedDaysAgo',     (public.kampala_today() - nav_frontier.last_published),
    'pendingAccessRequests',       access_pending.n,
    'underperformingDistributors', dist_under.n,
    'delayedInsurancePayouts',     claims_late.n,
    'delayedWithdrawals', jsonb_build_object(
        'total',      wd_late.n,
        'retirement', wd_late.n_ret,
        'emergency',  wd_late.n_emg),
    'delayedCustodyTransfers',     custody_late.n,
    'reconciliation', jsonb_build_object(
        'total',           recon.n,
        'userWise',        recon.n_user,
        'transactionWise', recon.n_txn),
    'inactiveBranches',            branches_off.n,
    'thresholds',                  public._admin_attention_thresholds()
  )
  INTO v_result
  FROM dormant, emp_late, nav_late, nav_frontier, access_pending, dist_under,
       claims_late, wd_late, custody_late, recon, branches_off;

  RETURN v_result;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 8. get_admin_attention_rows — A04-007 (the paired drill-down)
-- ---------------------------------------------------------------------------
-- The count and this list MUST enumerate the same set. Changing the badge in
-- section 7 without changing this branch would have created a fresh
-- ui-server mismatch — badge 15, table 4 — which is the same class of defect
-- as A04-014. Body captured live 2026-08-25; only the `delayedNav` branch
-- changes, and it now reads public.nav_unsigned_days() like the count does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_attention_rows(p_type text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := (SELECT auth.jwt()) ->> 'app_role';
  v_today  date := CURRENT_DATE;
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_bucket text;
  v_result jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read platform attention', v_role USING ERRCODE = 'P0001';
  END IF;

  IF p_type = 'dormantSubscribers' THEN
    -- Rows are AGENTS ranked by how many of their members have gone dormant —
    -- the actionable unit, mirroring the branch AttentionAgents drill-down.
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', a.id,
        'primary', a.name,
        'secondary', COALESCE(b.name, '—'),
        'amount', NULL,
        'date', NULL,
        'dueBy', NULL,
        'daysLate', NULL,
        'status', a.status,
        'count', count(s.id),
        'recipientRole', 'agent',
        'recipientId', a.id,
        'recipientName', a.name,
        'href', '/dashboard/agents/' || a.id
      ) AS x
      FROM public.agents a
      LEFT JOIN public.branches b ON b.id = a.branch_id
      JOIN public.subscribers s ON s.agent_id = a.id AND NOT s.is_active
      GROUP BY a.id, a.name, a.status, b.name
      ORDER BY count(s.id) DESC, a.name
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedEmployerTransfers' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', e.id,
        'primary', e.name,
        'secondary', COALESCE(initcap(e.payroll_cadence), 'Monthly') || ' payroll · ' ||
                     COALESCE(to_char(lr.last_run, 'DD Mon YYYY'), 'no run recorded'),
        'amount', NULL,
        'date', lr.last_run::date,
        'dueBy', (lr.last_run::date + public._employer_grace_days(e.payroll_cadence)),
        'daysLate', CASE WHEN lr.last_run IS NULL THEN NULL
                         ELSE v_today - (lr.last_run::date + public._employer_grace_days(e.payroll_cadence)) END,
        'status', COALESCE(e.status, 'active'),
        'recipientRole', 'employer',
        'recipientId', e.id,
        'recipientName', e.name,
        'href', NULL
      ) AS x
      FROM public.employers e
      LEFT JOIN LATERAL (
        SELECT max(r.run_at) AS last_run FROM public.contribution_runs r
        WHERE r.employer_id = e.id AND r.status = 'completed'
      ) lr ON TRUE
      WHERE COALESCE(e.status, 'active') <> 'inactive'
        AND (lr.last_run IS NULL
             OR lr.last_run::date < v_today - public._employer_grace_days(e.payroll_cadence))
      ORDER BY lr.last_run NULLS FIRST
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedNav' THEN
    -- 0116 / A04-007 — reads the SAME helper get_admin_attention counts, so the
    -- badge and this list are one definition. Days with no register row at all
    -- (the majority: nothing creates a pending row per weekday) now appear with
    -- status 'unpriced' and a synthetic id instead of being invisible.
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', COALESCE(u.snapshot_id, 'nav-unpriced-' || to_char(u.nav_date, 'YYYYMMDD')),
        'primary', to_char(u.nav_date, 'DD Mon YYYY'),
        'secondary', 'UPU-BAL · ' || COALESCE(u.source, 'no price received'),
        'amount', u.unit_price,
        'date', u.nav_date,
        'dueBy', u.nav_date,
        'daysLate', public.kampala_today() - u.nav_date,
        'status', u.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-fund-admin',
        'recipientName', 'Fund Administration',
        'href', NULL
      ) AS x
      FROM public.nav_unsigned_days('UPU-BAL') u
      ORDER BY u.nav_date
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'pendingAccessRequests' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', ar.id,
        'primary', ar.org_name,
        'secondary', initcap(ar.kind) || ' · ' || COALESCE(ar.contact_name, '—'),
        'amount', NULL,
        'date', ar.created_at::date,
        'dueBy', NULL,
        'daysLate', v_today - ar.created_at::date,
        'status', ar.status,
        'recipientRole', NULL,
        'recipientId', NULL,
        'recipientName', NULL,
        'href', NULL
      ) AS x
      FROM public.access_requests ar
      WHERE ar.status = 'pending'
      ORDER BY ar.created_at
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'underperformingDistributors' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      WITH roll AS (
        SELECT d.id, d.name, COALESCE(d.status, 'active') AS status,
               count(DISTINCT b.id) AS branches,
               count(DISTINCT a.id) AS agents,
               count(DISTINCT s.id) AS subscribers,
               count(DISTINCT s.id) FILTER (WHERE s.is_active) AS active_subscribers,
               COALESCE(sum(sb.total_balance), 0) AS aum
        FROM public.distributors d
        LEFT JOIN public.branches            b  ON b.distributor_id = d.id
        LEFT JOIN public.agents              a  ON a.branch_id      = b.id
        LEFT JOIN public.subscribers         s  ON s.agent_id       = a.id
        LEFT JOIN public.subscriber_balances sb ON sb.subscriber_id = s.id
        GROUP BY d.id, d.name, d.status
      )
      SELECT jsonb_build_object(
        'id', r.id,
        'primary', r.name,
        'secondary', r.agents || ' agents · ' || r.subscribers || ' members · ' ||
                     CASE WHEN r.subscribers = 0 THEN 'no members yet'
                          ELSE round((r.active_subscribers::numeric / r.subscribers) * 100) || '% active' END,
        'amount', r.aum,
        'date', NULL,
        'dueBy', NULL,
        'daysLate', NULL,
        'status', r.status,
        'recipientRole', 'distributor',
        'recipientId', r.id,
        'recipientName', r.name,
        'href', NULL
      ) AS x
      FROM roll r
      WHERE r.status = 'inactive'
         OR (r.branches > 0 AND r.subscribers = 0)
         OR (r.subscribers > 0
             AND (r.active_subscribers::numeric / r.subscribers) * 100
                 < (public._admin_attention_thresholds() ->> 'underperformActiveRatePct')::numeric)
      ORDER BY (r.status = 'inactive') DESC, r.subscribers
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedInsurancePayouts' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', c.id,
        'primary', s.name,
        'secondary', initcap(replace(c.type, '_', ' ')) || ' · ' || replace(initcap(replace(c.status, '_', ' ')), ' ', ' '),
        'amount', c.amount,
        'date', c.submitted_date,
        'dueBy', c.expected_by,
        'daysLate', v_today - c.expected_by,
        'status', c.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-claims',
        'recipientName', 'Claims Operations',
        'href', '/dashboard/subscribers/' || c.subscriber_id
      ) AS x
      FROM public.claims c
      JOIN public.subscribers s ON s.id = c.subscriber_id
      WHERE c.status NOT IN ('paid', 'rejected') AND c.expected_by < v_today
      ORDER BY c.expected_by
      LIMIT v_limit
    ) q;

  ELSIF p_type IN ('delayedWithdrawals', 'delayedWithdrawalsRetirement', 'delayedWithdrawalsEmergency') THEN
    v_bucket := CASE p_type
                  WHEN 'delayedWithdrawalsRetirement' THEN 'retirement'
                  WHEN 'delayedWithdrawalsEmergency'  THEN 'emergency'
                  ELSE NULL END;
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', w.id,
        'primary', s.name,
        'secondary', initcap(w.bucket) || ' payout · ' || COALESCE(w.method, 'method not set'),
        'amount', w.amount,
        'date', w.date,
        'dueBy', w.expected_by,
        'daysLate', v_today - w.expected_by,
        'status', w.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-treasury',
        'recipientName', 'Treasury Operations',
        'href', '/dashboard/subscribers/' || w.subscriber_id
      ) AS x
      FROM public.withdrawals w
      JOIN public.subscribers s ON s.id = w.subscriber_id
      WHERE w.status = 'processing'
        AND w.expected_by < v_today
        AND (v_bucket IS NULL OR w.bucket = v_bucket)
      ORDER BY w.expected_by
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedCustodyTransfers' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', ct.id,
        'primary', ct.batch_label,
        'secondary', ct.custodian || ' · ' ||
                     to_char(ct.collected_from, 'DD Mon') || '–' || to_char(ct.collected_to, 'DD Mon') ||
                     COALESCE(' · ' || ct.failure_reason, ''),
        'amount', ct.amount,
        'date', ct.collected_to,
        'dueBy', ct.due_by,
        'daysLate', v_today - ct.due_by,
        'status', ct.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-treasury',
        'recipientName', 'Treasury Operations',
        'href', NULL
      ) AS x
      FROM public.custody_transfers ct
      WHERE ct.status IN ('pending', 'failed') AND ct.due_by < v_today
      ORDER BY ct.due_by
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'reconciliation' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', re.ref_id,
        'primary', re.who,
        'secondary', re.issue,
        'amount', re.amount,
        'date', re.occurred_on,
        'dueBy', NULL,
        'daysLate', NULL,
        'status', re.check_code,
        'kind', re.kind,
        'recipientRole', 'admin',
        'recipientId', 'ops-finance',
        'recipientName', 'Finance Operations',
        'href', CASE WHEN re.subscriber_id IS NOT NULL
                     THEN '/dashboard/subscribers/' || re.subscriber_id END
      ) AS x
      FROM public.v_reconciliation_exceptions re
      ORDER BY re.kind, re.check_code, re.ref_id
      LIMIT v_limit
    ) q;

  ELSE
    RAISE EXCEPTION 'unknown attention type %', p_type USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;


-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
-- The four replaced objects keep exactly the ACL they had (captured live
-- 2026-08-25: postgres, authenticated, service_role for the three functions).
-- CREATE OR REPLACE preserves it; these are re-asserted so the file states the
-- intent rather than relying on it. The nav-pricing contract test
-- (src/test/nav-pricing-contract.test.js) asserts the REVOKE line exists for
-- every NAV function in the newest migration that defines it.
REVOKE ALL ON FUNCTION public.publish_nav_snapshot(date, numeric, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_nav_snapshot(date, numeric, text, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_admin_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attention() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_admin_attention_rows(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attention_rows(text, integer) TO authenticated, service_role;

-- kampala_today() is a pure clock read with no data in it; the client needs the
-- same answer the server uses, so authenticated may call it.
REVOKE ALL ON FUNCTION public.kampala_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kampala_today() TO authenticated, service_role;

-- nav_unsigned_days() reads nav_snapshots, which has FORCE RLS with an
-- admin-only SELECT policy, so it is DEFINER. Its two callers are themselves
-- DEFINER and admin-gated; exposing it directly would be a PostgREST endpoint
-- that leaks the pricing calendar to every signed-in member.
REVOKE ALL ON FUNCTION public.nav_unsigned_days(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nav_unsigned_days(text) TO service_role;

-- assert_book_revaluable() is internal — called from publish_nav_snapshot's
-- DEFINER body, which executes as the owner and does not need the grant. Same
-- posture as 0114's assert_finite_money and _resync_bucket_units.
REVOKE ALL ON FUNCTION public.assert_book_revaluable(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_book_revaluable(text, numeric) TO service_role;

-- reprice_book_to_register() rewrites the WHOLE book. service_role only: it is
-- a post-bulk-load repair with no UI, and it is only ever correct immediately
-- after a load.
REVOKE ALL ON FUNCTION public.reprice_book_to_register(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reprice_book_to_register(text) TO service_role;


-- ---------------------------------------------------------------------------
-- 10. Post-flight
-- ---------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_probe   jsonb;
  v_body    text;
  v_codes   text;
BEGIN
  -- (a) the NaN guard is actually wired into the live body, not just written here
  SELECT prosrc INTO v_body FROM pg_proc
   WHERE oid = 'public.publish_nav_snapshot(date,numeric,text,text,boolean)'::regprocedure;
  IF position('assert_finite_money' IN v_body) = 0 THEN
    RAISE EXCEPTION 'ABORT: publish_nav_snapshot did not pick up the assert_finite_money guard.' USING ERRCODE = 'P0001';
  END IF;
  IF position('assert_book_revaluable' IN v_body) = 0 THEN
    RAISE EXCEPTION 'ABORT: publish_nav_snapshot did not pick up the assert_book_revaluable guard.' USING ERRCODE = 'P0001';
  END IF;
  -- Test the CODE, not the file: prosrc includes this migration's own comments,
  -- and those legitimately mention CURRENT_DATE while explaining why it is wrong.
  IF position('p_nav_date > CURRENT_DATE' IN v_body) > 0
     OR position('kampala_today' IN v_body) = 0 THEN
    RAISE EXCEPTION 'ABORT: publish_nav_snapshot still compares the NAV date against CURRENT_DATE (UTC) instead of public.kampala_today().' USING ERRCODE = 'P0001';
  END IF;

  -- (b) the healthy live book must still pass. A guard that blocks a legitimate
  --     NAV update is worse than the bug it prevents.
  v_probe := public.assert_book_revaluable('UPU-BAL', public.latest_nav());
  IF (v_probe ->> 'checked')::boolean IS NOT TRUE THEN
    RAISE NOTICE '0116: book check skipped - %', v_probe ->> 'reason';
  ELSIF (v_probe ->> 'driftPct')::numeric > 2 THEN
    RAISE EXCEPTION 'ABORT: the book is already out of step with the register: %', v_probe USING ERRCODE = 'P0001';
  ELSE
    RAISE NOTICE '0116: book is revaluable - implied % vs register %, drift % percent',
      v_probe ->> 'impliedPrice', v_probe ->> 'bookPrice', v_probe ->> 'driftPct';
  END IF;

  -- (c) the new reconciliation branches are live and parse
  SELECT string_agg(DISTINCT check_code, ', ' ORDER BY check_code) INTO v_codes
    FROM public.v_reconciliation_exceptions;
  RAISE NOTICE '0116: reconciliation codes now firing: %', COALESCE(v_codes, '(none)');

  -- (d) the badge and its drill-down read the same helper
  IF (SELECT count(*) FROM public.nav_unsigned_days('UPU-BAL')) IS NULL THEN
    RAISE EXCEPTION 'ABORT: nav_unsigned_days returned NULL.' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '0116: % valuation day(s) unsigned; last published %.',
    (SELECT count(*) FROM public.nav_unsigned_days('UPU-BAL')),
    (SELECT max(nav_date) FROM public.nav_snapshots WHERE fund_code = 'UPU-BAL' AND status = 'published');

  RAISE NOTICE '0116 post-flight clean.';
END
$postflight$;
