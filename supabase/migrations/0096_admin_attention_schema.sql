-- =============================================================================
-- Universal Pensions Uganda — 0096: admin "Needs attention" schema
-- =============================================================================
-- Phase 1 of the admin Needs-attention rebuild (10 signals, drill-downs, notify).
-- Adds ONLY the schema the 10 signals cannot express today:
--
--   * nav_snapshots      — per-day NAV publication register (signal #3)
--   * custody_transfers  — fund → custody-bank settlement register (signal #9)
--   * withdrawals.expected_by / claims.expected_by — payout SLA dates (#7, #8)
--   * v_reconciliation_exceptions — named integrity checks (#10)
--   * notifications.recipient_role CHECK — the value domain 0031 only commented
--
-- 0097 adds the RPCs; 0098 adds the demo DML. Down order: 0098 → 0097 → 0096.
--
-- CONVENTIONS (CLAUDE.md §4/§5, BACKEND.md §7/§8/§9):
--   * Admin-only SELECT policies clone the 0049 `*_select_admin` idiom, reading
--     (SELECT auth.jwt()) ->> 'app_role'  — NEVER ->> 'role' (§5.7).
--   * No INSERT/UPDATE/DELETE policies: writes go through DEFINER RPCs (0097)
--     or the seed migration (0098), which runs as the migration role.
--   * Idempotent throughout (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS).
--   * Forward-only; reversed by 0096_admin_attention_schema.down.sql.
--
-- CLOCK NOTE (important, differs from most rollup RPCs):
--   The attention signals are answering "is this late RIGHT NOW", so they use
--   CURRENT_DATE, not public._demo_now(). _demo_now() is pinned to 2026-05-18
--   to anchor the SEEDED history that feeds the 12-month charts, but the live
--   ledger now carries real wall-clock rows well past it (contributions dated
--   2026-08-03 at the time of writing). Measuring an SLA against a clock that
--   is ~3 months behind the data silently marks genuinely-late items as "not
--   yet due". Precedent for wall-clock here: get_branch_pending_contributions
--   (0069) also reads CURRENT_DATE.
--
-- DEMO-SCOPE NOTE (CLAUDE.md §10a):
--   nav_snapshots does NOT change how contributions are priced. The 1,000
--   UGX/unit constant inside trg_transactions_contribution is untouched and
--   every row seeded here pins unit_price to exactly 1000.00, so the register
--   can never contradict the ledger. The signal is about whether a valuation
--   day was signed off on time, not about the price itself.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) nav_snapshots — NAV publication register (signal #3, "Delayed NAV updation")
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per fund per valuation day. `status='pending'` on a day that has
-- already passed IS the signal; without a per-day row the drill-down would have
-- nothing to list and the admin could only ever see a scalar staleness number.
CREATE TABLE IF NOT EXISTS public.nav_snapshots (
  id           TEXT PRIMARY KEY DEFAULT ('nav-' || replace(gen_random_uuid()::text, '-', '')),
  fund_code    TEXT NOT NULL DEFAULT 'UPU-BAL',
  nav_date     DATE NOT NULL,
  unit_price   NUMERIC NOT NULL DEFAULT 1000 CHECK (unit_price > 0),
  status       TEXT NOT NULL DEFAULT 'published'
                 CHECK (status IN ('published', 'pending')),
  published_at TIMESTAMPTZ,
  source       TEXT,                        -- e.g. 'fund_admin_feed' — drill-down provenance
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) custody_transfers — fund → custody bank register (signal #9)
-- ─────────────────────────────────────────────────────────────────────────────
-- Shape follows settlement_batches (0030) + the commissions.due_date/paid_date
-- pair — the only existing idiom in this schema for "was this money moved on
-- time". `due_by` is the sole way to express "delayed"; collected_from/to double
-- as the window 0098 uses to derive `amount` from real contribution rows, so the
-- money in each batch ties back to the actual ledger.
CREATE TABLE IF NOT EXISTS public.custody_transfers (
  id             TEXT PRIMARY KEY DEFAULT ('cbt-' || replace(gen_random_uuid()::text, '-', '')),
  batch_label    TEXT NOT NULL,
  custodian      TEXT NOT NULL DEFAULT 'Stanbic Bank Uganda — Custody',
  source         TEXT NOT NULL
                   CHECK (source IN ('member_contributions', 'employer_runs', 'insurance_premiums')),
  amount         NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  collected_from DATE NOT NULL,
  collected_to   DATE NOT NULL,
  due_by         DATE NOT NULL,
  transferred_at DATE,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'transferred', 'failed')),
  bank_ref       TEXT,
  failure_reason TEXT,                      -- makes a 'failed' row actionable, not just red
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT custody_transfers_window_chk CHECK (collected_to >= collected_from)
);

CREATE INDEX IF NOT EXISTS custody_transfers_status_due_idx
  ON public.custody_transfers (status, due_by);

ALTER TABLE public.custody_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_transfers FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custody_transfers_select_admin ON public.custody_transfers;
CREATE POLICY custody_transfers_select_admin ON public.custody_transfers
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

GRANT SELECT ON public.custody_transfers TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Payout SLA dates — withdrawals.expected_by / claims.expected_by (#7, #8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Why a column and not `CURRENT_DATE - submitted_date > N`:
--   age tells you a row is OLD; only a due date tells you it is LATE, and it
--   keeps the SLA in ONE place. The drill-down renders "Due 14 May · 4 days
--   late" straight off the row instead of re-deriving a constant client-side.
--
-- The DEFAULT is load-bearing: request_withdrawal (0054, re-emitted 0072:116)
-- INSERTs an explicit column list that omits expected_by, so new withdrawals
-- pick the SLA up with no RPC re-emission. If that RPC is ever changed to name
-- every column, this DEFAULT stops applying and it must be re-emitted.
-- ⚠️ THE BACKFILL CANNOT KEY OFF `IS NULL`. Postgres 11+ rewrites nothing on
--    ADD COLUMN with a NON-VOLATILE default — it stamps every existing row with
--    that default immediately. `CURRENT_DATE + 5` is STABLE, so all 4,923
--    historical withdrawals came out holding today+5 and NOT NULL, and a
--    `WHERE expected_by IS NULL` backfill matched exactly zero rows. The symptom
--    is silent and severe: every months-old payout reads "due in 5 days", so the
--    #7/#8 SLA signals report 0 and 0098's closeout sweeps no-op.
--    Match the stamped default instead. `date + 5 = CURRENT_DATE + 5` only when
--    the row is dated today, in which case the write is a no-op anyway — so this
--    is safe to re-run and safe on rows created after this migration.
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS expected_by DATE DEFAULT (CURRENT_DATE + 5);
UPDATE public.withdrawals SET expected_by = date + 5
 WHERE expected_by IS NULL OR expected_by = CURRENT_DATE + 5;

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS expected_by DATE DEFAULT (CURRENT_DATE + 10);
UPDATE public.claims SET expected_by = submitted_date + 10
 WHERE expected_by IS NULL OR expected_by = CURRENT_DATE + 10;

COMMENT ON COLUMN public.withdrawals.expected_by IS
  'Payout SLA date (request date + 5d). Past-due + status=processing drives the admin Needs-attention withdrawal signal.';
COMMENT ON COLUMN public.claims.expected_by IS
  'Claim decision SLA date (submitted + 10d). Past-due + non-terminal status drives the admin Needs-attention insurance signal.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) v_reconciliation_exceptions — named integrity checks (signal #10)
-- ─────────────────────────────────────────────────────────────────────────────
-- DELIBERATELY NOT "Σ transactions vs subscriber_balances".
--
-- That diff was the original design, and it does not survive contact with the
-- data. Measured on the live Singapore DB (2026-08-07): 2,321 of the 5,000
-- agent-tree subscribers drift from their transaction sum, and all 58
-- employer-onboarded members carry a balance with no contribution rows behind
-- it at all. The seed script rebuilds the invariant once (scripts/seed-supabase
-- .mjs "Opening-balance reconciliation") and nothing maintains it afterwards,
-- so a balance-vs-ledger view would flag ~46% of the book — noise, not a signal.
--
-- What IS both real and rare is a set of named referential/consistency checks.
-- Measured on live: missing_balance 4 (genuine orphaned `tst-sub-*` rows),
-- split_mismatch 0, orphan_subscriber 0, orphan_run 0, agent_mismatch 0.
-- Each row carries its own `check_code` so the drill-down can group and explain
-- them, and 0098 seeds deliberate breaks so the demo has something to work.
CREATE OR REPLACE VIEW public.v_reconciliation_exceptions AS
  -- ── user-wise ──────────────────────────────────────────────────────────────
  -- A member with no balance row at all: every read path does `?? 0`, so this
  -- fails silently as "UGX 0" rather than as an error.
  SELECT
    'user'::text                                   AS kind,
    'missing_balance'::text                        AS check_code,
    'Member has no balance record'::text           AS issue,
    s.id                                           AS ref_id,
    s.name                                         AS who,
    s.id                                           AS subscriber_id,
    NULL::numeric                                  AS amount,
    NULL::date                                     AS occurred_on
  FROM public.subscribers s
  LEFT JOIN public.subscriber_balances b ON b.subscriber_id = s.id
  WHERE b.subscriber_id IS NULL

  UNION ALL

  -- Bucket split must reconstitute the total. This one is maintained by the
  -- contribution/withdrawal triggers, so any drift is a genuine trigger escape.
  SELECT
    'user', 'split_mismatch',
    'Retirement + emergency does not equal total balance',
    b.subscriber_id, s.name, b.subscriber_id,
    (b.retirement_balance + b.emergency_balance) - b.total_balance,
    b.updated_at::date
  FROM public.subscriber_balances b
  JOIN public.subscribers s ON s.id = b.subscriber_id
  WHERE abs((b.retirement_balance + b.emergency_balance) - b.total_balance) > 1

  UNION ALL

  -- ── transaction-wise ───────────────────────────────────────────────────────
  -- Transaction pointing at a subscriber that no longer exists.
  SELECT
    'transaction', 'orphan_subscriber',
    'Transaction references a member that no longer exists',
    t.id, COALESCE(t.subscriber_id, '—'), t.subscriber_id, t.amount, t.date::date
  FROM public.transactions t
  LEFT JOIN public.subscribers s ON s.id = t.subscriber_id
  WHERE s.id IS NULL

  UNION ALL

  -- Transaction tagged to an employer contribution run that no longer exists.
  SELECT
    'transaction', 'orphan_run',
    'Transaction references a contribution run that no longer exists',
    t.id, COALESCE(s.name, '—'), t.subscriber_id, t.amount, t.date::date
  FROM public.transactions t
  LEFT JOIN public.subscribers s ON s.id = t.subscriber_id
  LEFT JOIN public.contribution_runs r ON r.id = t.contribution_run_id
  WHERE t.contribution_run_id IS NOT NULL AND r.id IS NULL

  UNION ALL

  -- Commission/attribution break: the transaction credits an agent that does not
  -- own the member. Silently misdirects commission.
  SELECT
    'transaction', 'agent_mismatch',
    'Transaction credited to an agent who does not own this member',
    t.id, s.name, t.subscriber_id, t.amount, t.date::date
  FROM public.transactions t
  JOIN public.subscribers s ON s.id = t.subscriber_id
  WHERE t.agent_id IS NOT NULL
    AND t.agent_id IS DISTINCT FROM s.agent_id;

-- NO duplicate-posting check. It was in the original design and was removed
-- after measuring it: "same member + same txn_ref + same amount + same day"
-- fires 442 times on live, and every single hit is an `EMP-*` reference on an
-- `empe-*` member — i.e. the employer and employee LEGS of one contribution run,
-- which the two-leg model (0092) posts as two identical-looking rows by design.
-- A check whose every real-world hit is correct behaviour is a false-positive
-- generator, not a signal. ('OPENING' is likewise reused on 5,000 rows by the
-- seed, so no ref-based dedupe is safe here.)

-- Read exclusively through the 0097 DEFINER RPCs — no direct client grant.
REVOKE ALL ON public.v_reconciliation_exceptions FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.v_reconciliation_exceptions IS
  'Named referential/consistency breaks powering the admin Needs-attention reconciliation signal. Read only via get_admin_attention / get_admin_attention_rows (0097).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) notifications.recipient_role — pin the value domain
-- ─────────────────────────────────────────────────────────────────────────────
-- 0031 declared the allowed roles in a COMMENT only, and the admin notify RPC
-- (0097) is about to widen writers beyond apply_settlement. The SELECT policies
-- for every role below already exist and are correctly scoped — 0049 added the
-- admin + employer policies and 0081 tightened the distributor one — so this
-- migration adds no policy, only the constraint that keeps a typo'd role from
-- creating a row nobody can ever read.
--
-- 'subscriber' is listed for completeness but nothing writes it: the subscriber
-- dashboard reads a different feed component entirely, so such a row would be
-- invisible. admin_notify (0097) rejects it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.notifications'::regclass
       AND conname  = 'notifications_recipient_role_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_recipient_role_check
      CHECK (recipient_role IN ('agent', 'branch', 'distributor', 'employer', 'subscriber', 'admin'));
  END IF;
END
$$;
