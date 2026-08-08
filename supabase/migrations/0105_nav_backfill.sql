-- =============================================================================
-- Universal Pensions Uganda — 0105: NAV pricing, part 3 of 3 (history backfill)
-- =============================================================================
-- WHY
--   0103 built the register, 0104 made it price money. Both were no-ops for the
--   existing book: every member still holds units bought at a flat 1,000 and a
--   cost basis seeded equal to their balance, so all 5,060 read 0.0% growth.
--   This file writes a real ~5-year price history and restates every member's
--   units and cost basis against it, so tenure produces the growth it should.
--
-- ⚠️ THIS IS THE IRREVERSIBLE STEP. It rewrites units, invested and all three
--    balance columns for 5,060 members, and platform AUM moves with them. §1
--    snapshots subscriber_balances into public.subscriber_balances_pre_nav
--    FIRST — 0105_nav_backfill.down.sql restores from that table and cannot work
--    without it. Do not drop it until the change is accepted.
--
-- WHAT THE NUMBERS COME OUT AT (simulated read-only against live before writing)
--   NAV today       1,566.50        (1,000.00 on 2021-11-01, ~10%/yr + wobble)
--   Units in issue  1,549,835
--   AUM             2,088.6M -> 2,427.8M   (+16.2%)
--   Cost basis      2,221.5M
--   Average growth  +9.29%
--   At a loss       6 of 5,059 members, worst -0.7%
--   Spread          p05 +2.9% · median +7.8% · p95 +19.5% · max +55.7%
--   By joining year 2024 +16.1% · 2025 +8.2% · 2026 +3.9%  (monotone, as it must be)
--
-- ⚠️ HONEST DISCLOSURE — ~133M OF THE AUM RISE IS NOT RETURNS.
--    Cost basis (2,221.5M) exceeds today's balance (2,088.6M) by ~133M because
--    §3 caps every redemption at units actually held. 1,024 of 5,060 members run
--    NEGATIVE at some point in a chronological walk (1,009 of them on their very
--    first row, worst -1,452,548): scripts/seed-supabase.mjs:900-917 books its
--    opening reconciliation as a NEGATIVE withdrawal dated at registration, which
--    sorts first. Those outflows cannot redeem units that never existed, so they
--    are dropped and the basis stays higher. That is a seed artefact, not a
--    return, and it is stated here rather than buried.
--
-- WHY THE PRICE CURVE IS ~10%/YR
--   It matches MONTHLY_RATE in src/utils/finance.js (0.10/12) and the public
--   copy on src/pages/landing/SubscribersPage.jsx ("around 10% a year"), so the
--   whole product tells one story. The wobble is seeded from md5(nav_date), so
--   the series is byte-reproducible on any environment — never random().
--
-- DELIBERATELY NOT TOUCHED
--   * The 4 status='pending' rows 0098 left on the most recent weekdays. They
--     ARE the "Delayed NAV updation" signal, and publishing one is the live demo
--     moment: it moves AUM and every member's growth at once. §2's upsert is
--     guarded to skip them.
--   * transactions — the ledger is the input here and is never rewritten.
--   * Bucket PROPORTIONS. Splits are unusable for reconstruction (18,424/19,695
--     contributions, 5,398/5,878 withdrawals and all 615 claims carry NULL
--     split_retirement/split_emergency), so §4 splits the rebuilt units in each
--     member's EXISTING retirement:emergency balance ratio. Today's bucket mix
--     is preserved exactly; only the total is restated.
--
-- SCHEMA FACTS VERIFIED against live before writing (2026-08-08)
--   * total_balance == SUM(transactions.amount) over
--     type IN ('contribution','withdrawal','premium_sweep','claim') for 5,058 of
--     5,060 members (2 drift, 50,000 UGX total; 1 balances row has no ledger).
--     §5 handles all three by falling back, and RAISEs a NOTICE naming them.
--   * Withdrawals are stored NEGATIVE; claim payouts were credited INTO balances
--     by the seed, so they are inflows here and add cost basis — otherwise a
--     member's claim would read as pure investment growth.
--
-- Applied to the live Singapore DB 2026-08-08.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Snapshot — the ONLY way back
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriber_balances_pre_nav AS
  SELECT *, now() AS snapshot_at FROM public.subscriber_balances;

ALTER TABLE public.subscriber_balances_pre_nav ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_balances_pre_nav FORCE  ROW LEVEL SECURITY;
-- No policy and no grant: this is a rollback artefact, readable only by the
-- migration role and service_role (both bypass RLS). It must never reach a client.

COMMENT ON TABLE public.subscriber_balances_pre_nav IS
  'Pre-0105 snapshot of subscriber_balances. The restore source for 0105_nav_backfill.down.sql. Drop only once the NAV change is accepted.';

-- §6 overwrites subscribers.current_unit_value with the fund price. The values
-- it replaces are the seed's random 950-1050 per member and are NOT derivable,
-- so they have to be captured here or the down migration cannot restore them.
CREATE TABLE IF NOT EXISTS public.subscribers_unit_value_pre_nav AS
  SELECT id, current_unit_value, unit_value_as_of, now() AS snapshot_at
    FROM public.subscribers;

ALTER TABLE public.subscribers_unit_value_pre_nav ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers_unit_value_pre_nav FORCE  ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The price curve — weekdays, 2021-11-01 -> today
-- ─────────────────────────────────────────────────────────────────────────────
-- Deterministic: the daily wobble is derived from md5(nav_date), never random(),
-- so re-running this on a fresh database reproduces the identical series.
--
-- The conflict clause is doing real work. 0098 already seeded 130 weekday rows
-- pinned to a flat 1000.00; those must take the real price. But its 4 'pending'
-- rows must stay pending, so the DO UPDATE is filtered to published rows only.
INSERT INTO public.nav_snapshots
  (id, fund_code, nav_date, unit_price, status, published_at, source)
SELECT
  'nav-' || to_char(d::date, 'YYYYMMDD'),
  'UPU-BAL',
  d::date,
  round((1000
         * power(1.10, (d::date - DATE '2021-11-01') / 365.25::numeric)
         * (1 + 0.012 * (((('x' || substr(md5(d::date::text), 1, 8))::bit(32)::bigint % 1000) / 1000.0) - 0.5))
        )::numeric, 2),
  'published',
  d::date + TIME '18:00',
  'nav_backfill_0105'
FROM generate_series(DATE '2021-11-01', CURRENT_DATE, INTERVAL '1 day') d
WHERE EXTRACT(ISODOW FROM d) < 6          -- weekdays only; funds do not price weekends
ON CONFLICT (fund_code, nav_date) DO UPDATE
   SET unit_price = EXCLUDED.unit_price,
       source     = EXCLUDED.source
 WHERE public.nav_snapshots.status = 'published';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Walk every member's ledger, pricing each row at its own date's NAV
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _nav_walk (
  subscriber_id TEXT PRIMARY KEY,
  units         NUMERIC NOT NULL,
  invested      NUMERIC NOT NULL,
  capped_rows   INTEGER NOT NULL DEFAULT 0
) ON COMMIT DROP;

DO $backfill$
DECLARE
  r          RECORD;
  v_sub      TEXT    := NULL;
  v_units    NUMERIC := 0;
  v_invested NUMERIC := 0;
  v_capped   INTEGER := 0;
  v_want     NUMERIC;
  v_redeem   NUMERIC;
BEGIN
  FOR r IN
    SELECT t.subscriber_id,
           t.amount,
           public.nav_for_date(t.date::date) AS px
      FROM public.transactions t
     WHERE t.type IN ('contribution', 'withdrawal', 'premium_sweep', 'claim')
     ORDER BY t.subscriber_id, t.date, t.id
  LOOP
    IF v_sub IS DISTINCT FROM r.subscriber_id THEN
      IF v_sub IS NOT NULL THEN
        INSERT INTO _nav_walk VALUES (v_sub, v_units, v_invested, v_capped);
      END IF;
      v_sub := r.subscriber_id; v_units := 0; v_invested := 0; v_capped := 0;
    END IF;

    IF r.amount >= 0 THEN
      -- Contribution or claim payout: buys units AND adds cost basis.
      v_units    := v_units + (r.amount / r.px);
      v_invested := v_invested + r.amount;
    ELSE
      -- Withdrawal or save-to-cover sweep. CAP AT UNITS HELD — see the header:
      -- 1,024 members would otherwise go negative on a seed opening plug.
      v_want   := (-r.amount) / r.px;
      v_redeem := LEAST(v_want, v_units);
      IF v_want > v_units THEN v_capped := v_capped + 1; END IF;
      -- Average-cost: drop the same FRACTION of basis as of units.
      IF v_units > 0 THEN
        v_invested := GREATEST(0, v_invested * (1 - (v_redeem / v_units)));
      END IF;
      v_units := v_units - v_redeem;
    END IF;
  END LOOP;

  IF v_sub IS NOT NULL THEN
    INSERT INTO _nav_walk VALUES (v_sub, v_units, v_invested, v_capped);
  END IF;
END
$backfill$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Restate balances at the latest published price
-- ─────────────────────────────────────────────────────────────────────────────
-- Complement rule throughout: round the total and the retirement leg, take
-- emergency as the difference. Three independent roundings across 5,060 rows is
-- what would trip v_reconciliation_exceptions.split_mismatch (>1 UGX).
WITH nav AS (SELECT public.latest_nav() AS px),
calc AS (
  SELECT w.subscriber_id,
         w.units,
         w.invested,
         n.px,
         round(w.units * n.px) AS total,
         -- Bucket ratio from the member's CURRENT balances (pre-restatement).
         -- 80/20 fallback matches the contribution trigger's own default for a
         -- member whose buckets are both zero.
         round(w.units * CASE
                 WHEN COALESCE(b.retirement_balance, 0) + COALESCE(b.emergency_balance, 0) > 0
                   THEN b.retirement_balance / (b.retirement_balance + b.emergency_balance)
                 ELSE 0.80
               END, 6) AS ru
    FROM _nav_walk w
    JOIN public.subscriber_balances b ON b.subscriber_id = w.subscriber_id
    CROSS JOIN nav n
)
UPDATE public.subscriber_balances b
   SET units              = c.units,
       invested           = c.invested,
       retirement_units   = c.ru,
       emergency_units    = c.units - c.ru,
       total_balance      = c.total,
       retirement_balance = round(c.ru * c.px),
       emergency_balance  = c.total - round(c.ru * c.px),
       nav_as_of          = CURRENT_DATE,
       updated_at         = now()
  FROM calc c
 WHERE b.subscriber_id = c.subscriber_id;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Members the walk could not price, and the known ledger drift
-- ─────────────────────────────────────────────────────────────────────────────
-- A balances row with no ledger rows at all cannot be walked. Restate it from
-- the balance it already carries (units = balance / NAV, basis = balance) so it
-- reads 0.0% growth — true-and-unknown — rather than being left inconsistent.
UPDATE public.subscriber_balances b
   SET units            = b.total_balance / n.px,
       invested         = b.total_balance,
       retirement_units = CASE
         WHEN COALESCE(b.retirement_balance, 0) + COALESCE(b.emergency_balance, 0) > 0
           THEN round((b.total_balance / n.px)
                      * b.retirement_balance / (b.retirement_balance + b.emergency_balance), 6)
         ELSE round((b.total_balance / n.px) * 0.80, 6) END,
       emergency_units  = (b.total_balance / n.px) - CASE
         WHEN COALESCE(b.retirement_balance, 0) + COALESCE(b.emergency_balance, 0) > 0
           THEN round((b.total_balance / n.px)
                      * b.retirement_balance / (b.retirement_balance + b.emergency_balance), 6)
         ELSE round((b.total_balance / n.px) * 0.80, 6) END,
       nav_as_of        = CURRENT_DATE,
       updated_at       = now()
  FROM (SELECT public.latest_nav() AS px) n
 WHERE NOT EXISTS (SELECT 1 FROM _nav_walk w WHERE w.subscriber_id = b.subscriber_id);

-- Name what was papered over instead of letting it pass silently.
DO $report$
DECLARE
  v_no_ledger INTEGER;
  v_capped    INTEGER;
  v_capped_rows INTEGER;
BEGIN
  SELECT count(*) INTO v_no_ledger
    FROM public.subscriber_balances b
   WHERE NOT EXISTS (SELECT 1 FROM _nav_walk w WHERE w.subscriber_id = b.subscriber_id);

  SELECT count(*), COALESCE(sum(capped_rows), 0) INTO v_capped, v_capped_rows
    FROM _nav_walk WHERE capped_rows > 0;

  RAISE NOTICE '0105: % member(s) had no ledger and were restated from their balance', v_no_ledger;
  RAISE NOTICE '0105: % member(s) hit the redemption cap across % ledger row(s) — seed opening plugs', v_capped, v_capped_rows;
END
$report$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Stamp the fund price onto every member
-- ─────────────────────────────────────────────────────────────────────────────
-- current_unit_value / unit_value_as_of stop being the random 950-1050 the seed
-- wrote and become a correct denormalised copy of the fund price, which is what
-- makes AnalyticsPanel's "@ X/unit" true with no frontend change.
-- Safe: trg_subscribers_enforce_editable_cols returns early for a non-'subscriber'
-- role, and guard_mass_subscriber_detach only counts agent_id/employer_id going
-- NULL — neither is touched here.
UPDATE public.subscribers
   SET current_unit_value = public.latest_nav(),
       unit_value_as_of   = now();

COMMIT;
