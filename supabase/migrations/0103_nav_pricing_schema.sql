-- =============================================================================
-- Universal Pensions Uganda — 0103: NAV pricing, part 1 of 3 (schema + helpers)
-- =============================================================================
-- WHY
--   Until now the platform priced every unit at a hardcoded 1,000 UGX inside
--   trg_transactions_contribution. With a frozen price, units × price ALWAYS
--   equals money contributed, so realised growth is structurally zero — and to
--   fill that hole the frontend invented one. src/utils/finance.js
--   deriveInvestmentGrowth() discounted the balance backwards over a synthetic
--   tenure clamped to a 3-month floor; 3 months at 10%/yr is exactly +2.5%, so a
--   member who joined TODAY and paid once saw "INVESTMENT GROWTH +2.5%".
--
--   This trio replaces the constant with a real, admin-published fund NAV:
--     0103 (this file) — the register, the balance columns, the price helpers.
--     0104            — re-emits the two money functions + the admin RPCs.
--     0105            — the NAV history backfill and the balance restatement.
--
-- THIS FILE CHANGES NO BEHAVIOUR AND MOVES NO MONEY — DELIBERATELY.
--   Split this way so there is a verifiable checkpoint between "the machinery
--   exists" and "the money moved". nav_for_date() is TOTAL (see §3): with an
--   empty-or-partial register it falls back to 1000, so every downstream caller
--   behaves byte-identically to today until 0105 writes a real curve.
--
-- DELIBERATELY NOT TOUCHED
--   * trg_transactions_contribution / request_withdrawal — 0104 owns those.
--   * trg_transactions_withdrawal — it debits bucket BALANCES by withdrawn cash
--     and never touches units. request_withdrawal redeems units at the same NAV
--     inside the same statement, so the two stay consistent. No change needed.
--   * _insert_subscriber_chain — SECURITY INVOKER and MUST STAY INVOKER (the
--     exact 0042→0052 regression). Its literal 1000 is the txn_ref random
--     generator, not a unit price.
--   * submit_employer_contribution_run (0102) — writes only `transactions`; its
--     legs get priced by the trigger for free once 0104 lands.
--   * create_subscriber_from_employer_invite / _onboard — they INSERT an
--     EXPLICIT column list into subscriber_balances. See §2: the new columns are
--     NOT NULL DEFAULT 0 precisely so neither RPC needs re-emitting.
--   * subscribers.current_unit_value / unit_value_as_of — NOT dropped. 0104's
--     publish RPC writes the fund NAV into them, turning a random seeded value
--     into a correct denormalised copy. This avoids re-emitting the INVOKER
--     trigger trg_subscribers_enforce_editable_cols and edits across six files
--     for a cosmetic gain, in exchange for an irreversible DDL drop.
--   * nav_snapshots itself is OWNED BY 0096. §1 restates it idempotently only so
--     this file is self-contained; the .down.sql must NOT drop the table.
--
-- SCHEMA FACTS VERIFIED against the live Singapore DB before writing (2026-08-08)
--   * Exactly TWO live functions carry a unit-price literal:
--     trg_transactions_contribution and request_withdrawal. Confirmed by
--     scanning pg_get_functiondef across every function in `public`.
--   * subscriber_balances is (subscriber_id PK, retirement_balance,
--     emergency_balance, total_balance, units, updated_at); 5,060 rows;
--     units == total_balance / 1000 to within 5 UGX.
--   * nav_snapshots exists and carries 130 weekday rows (0098), 4 of them
--     status='pending'. Those four ARE the "Delayed NAV updation" signal and
--     must survive 0105 unpublished.
--   * nav_snapshots has ENABLE + FORCE RLS with an admin-only SELECT policy and
--     NO write policy. Function owner `postgres` has rolbypassrls = true.
--   * v_reconciliation_exceptions.split_mismatch (0096) fires when
--     |retirement + emergency − total| > 1, so bucket maths must use the
--     complement rule, never two independent roundings.
--
-- CONVENTIONS (CLAUDE.md §4/§5, BACKEND.md §7/§8/§9)
--   * RLS gates read (SELECT auth.jwt()) ->> 'app_role' — NEVER ->> 'role'.
--   * Writes go through SECURITY DEFINER RPCs; no client write policies.
--   * REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated.
--   * Idempotent throughout. Forward-only. Reversed by 0103_*.down.sql.
--
-- Applied to the live Singapore DB 2026-08-08.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) nav_snapshots — restated idempotently, then extended
-- ─────────────────────────────────────────────────────────────────────────────
-- Byte-for-byte the 0096 shape. Present so this file stands alone if it is ever
-- replayed against a database where 0096 has not run; a no-op where it has.
CREATE TABLE IF NOT EXISTS public.nav_snapshots (
  id           TEXT PRIMARY KEY DEFAULT ('nav-' || replace(gen_random_uuid()::text, '-', '')),
  fund_code    TEXT NOT NULL DEFAULT 'UPU-BAL',
  nav_date     DATE NOT NULL,
  unit_price   NUMERIC NOT NULL DEFAULT 1000 CHECK (unit_price > 0),
  status       TEXT NOT NULL DEFAULT 'published'
                 CHECK (status IN ('published', 'pending')),
  published_at TIMESTAMPTZ,
  source       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nav_snapshots_fund_date_key UNIQUE (fund_code, nav_date)
);

CREATE INDEX IF NOT EXISTS nav_snapshots_date_idx
  ON public.nav_snapshots (fund_code, nav_date DESC);
CREATE INDEX IF NOT EXISTS nav_snapshots_pending_idx
  ON public.nav_snapshots (status, nav_date) WHERE status = 'pending';

ALTER TABLE public.nav_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nav_snapshots FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nav_snapshots_select_admin ON public.nav_snapshots;
CREATE POLICY nav_snapshots_select_admin ON public.nav_snapshots
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

GRANT SELECT ON public.nav_snapshots TO authenticated;

-- Register columns. published_by answers "who signed this valuation off"; the
-- other three are stamped by publish_nav_snapshot (0104) at revaluation time so
-- the history table and the trend chart can show the fund's size on each day
-- without a second query. They stay NULL on rows backfilled by 0105, which the
-- UI renders as "—" rather than inventing a figure.
ALTER TABLE public.nav_snapshots
  ADD COLUMN IF NOT EXISTS published_by   TEXT,
  ADD COLUMN IF NOT EXISTS units_in_issue NUMERIC,
  ADD COLUMN IF NOT EXISTS aum            NUMERIC,
  ADD COLUMN IF NOT EXISTS members_priced INTEGER;

COMMENT ON COLUMN public.nav_snapshots.unit_price IS
  'Price of one unit on nav_date. Since 0103 this is the PRICING AUTHORITY for the whole platform: contributions buy units at it, withdrawals redeem at it, and every balance is revalued to it. It is no longer decorative and must never be edited outside publish_nav_snapshot().';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) subscriber_balances — bucket units, cost basis, valuation stamp
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ NOT NULL DEFAULT 0 IS LOAD-BEARING, not stylistic. Both
--    create_subscriber_from_employer_invite and _onboard INSERT an EXPLICIT
--    column list into this table (…, total_balance, units, updated_at). A
--    nullable column would leave new employer members with NULL units and force
--    both RPCs to be re-emitted; a default means neither has to change.
--
-- `units` (0001) stays the TOTAL and remains the authoritative figure.
-- retirement_units + emergency_units are DERIVED from it by
-- _resync_bucket_units (§4) and always sum back to it exactly.
--
-- `invested` is the member's cost basis — what they actually paid in, after
-- proportional average-cost reduction on every withdrawal. growth = total_balance
-- − invested. There has never been a cost-basis column in this schema; its
-- absence is why the growth figure had to be invented.
ALTER TABLE public.subscriber_balances
  ADD COLUMN IF NOT EXISTS retirement_units NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emergency_units  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invested         NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nav_as_of        DATE;

COMMENT ON COLUMN public.subscriber_balances.invested IS
  'Cost basis: money actually paid in, reduced PROPORTIONALLY on withdrawal (average-cost). growth = total_balance - invested. Reducing it by simple net cash-in instead produces -233% growth outliers for heavy withdrawers - measured, not theoretical.';
COMMENT ON COLUMN public.subscriber_balances.nav_as_of IS
  'The valuation day the cached balance figures reflect. Stamped by publish_nav_snapshot() and by every cash mutation.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Price lookup — nav_for_date / latest_nav
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ SECURITY DEFINER IS MANDATORY HERE, not house style. nav_snapshots carries
--    FORCE ROW LEVEL SECURITY with an admin-only SELECT policy. Under SECURITY
--    INVOKER this function returns NULL for every subscriber, agent and employer
--    — and then `NEW.amount / v_unit_price` divides by NULL and every
--    contribution silently credits zero units. The owner (postgres) has
--    rolbypassrls, so DEFINER sees the register regardless of the caller.
--
-- ⚠️ TOTAL BY CONSTRUCTION. The triple COALESCE — last published on-or-before,
--    then first published ever, then the literal 1000 — is what lets 0103 land
--    with an empty register and change nothing, and what stops a transaction
--    dated before the first valuation day from pricing at NULL.
CREATE OR REPLACE FUNCTION public.nav_for_date(
  p_date DATE,
  p_fund TEXT DEFAULT 'UPU-BAL'
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT n.unit_price FROM public.nav_snapshots n
      WHERE n.fund_code = p_fund AND n.status = 'published' AND n.nav_date <= p_date
      ORDER BY n.nav_date DESC LIMIT 1),
    (SELECT n.unit_price FROM public.nav_snapshots n
      WHERE n.fund_code = p_fund AND n.status = 'published'
      ORDER BY n.nav_date ASC LIMIT 1),
    1000
  );
$$;

CREATE OR REPLACE FUNCTION public.latest_nav(
  p_fund TEXT DEFAULT 'UPU-BAL'
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.nav_for_date(CURRENT_DATE, p_fund);
$$;

REVOKE ALL    ON FUNCTION public.nav_for_date(DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nav_for_date(DATE, TEXT) TO authenticated;
REVOKE ALL    ON FUNCTION public.latest_nav(TEXT)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.latest_nav(TEXT)         TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) _resync_bucket_units — the ONE place bucket units are computed
-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket units are never hand-maintained. Three separate code paths move the
-- bucket BALANCES (the contribution trigger's 80/20 split, the withdrawal
-- trigger's emergency-first fallback, and 0072's save-to-cover sweep) and
-- replicating the split logic in each would guarantee drift — request_withdrawal
-- in particular does NOT know the trigger's emergency-first rule, and its
-- p_split_retirement / p_split_emergency are both NULL in the common case.
--
-- So: derive. Split `units` in the bucket-balance ratio the existing code has
-- already settled, and take emergency as the COMPLEMENT so
-- retirement_units + emergency_units == units EXACTLY, with no rounding drift.
--
-- No GRANT to authenticated — this is called only from DEFINER code in 0104.
CREATE OR REPLACE FUNCTION public._resync_bucket_units(p_subscriber_id TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.subscriber_balances b
     SET retirement_units = r.ru,
         emergency_units  = b.units - r.ru
    FROM (
      SELECT CASE
               WHEN COALESCE(retirement_balance, 0) + COALESCE(emergency_balance, 0) > 0
                 THEN round(units * retirement_balance
                            / (retirement_balance + emergency_balance), 6)
               ELSE 0
             END AS ru
        FROM public.subscriber_balances
       WHERE subscriber_id = p_subscriber_id
    ) r
   WHERE b.subscriber_id = p_subscriber_id;
$$;

REVOKE ALL ON FUNCTION public._resync_bucket_units(TEXT) FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) One-time initialisation of the new columns
-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket units: split today's `units` in each member's current bucket ratio.
-- Set-based equivalent of §4 applied to every row at once.
UPDATE public.subscriber_balances
   SET retirement_units = CASE
         WHEN COALESCE(retirement_balance, 0) + COALESCE(emergency_balance, 0) > 0
           THEN round(units * retirement_balance
                      / (retirement_balance + emergency_balance), 6)
         ELSE 0 END,
       emergency_units  = units - CASE
         WHEN COALESCE(retirement_balance, 0) + COALESCE(emergency_balance, 0) > 0
           THEN round(units * retirement_balance
                      / (retirement_balance + emergency_balance), 6)
         ELSE 0 END;

-- Cost basis: seed it to today's balance so the interim state is HONEST. Until
-- 0105 walks the real ledger, growth = total_balance − invested = 0 for
-- everyone. Zero is true-and-unknown; leaving invested at 0 would make growth
-- read as +infinity%, which is the same class of lie this change exists to kill.
UPDATE public.subscriber_balances
   SET invested  = total_balance,
       nav_as_of = CURRENT_DATE;

COMMIT;
