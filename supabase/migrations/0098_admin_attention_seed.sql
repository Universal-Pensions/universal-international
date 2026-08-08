-- =============================================================================
-- Universal Pensions Uganda — 0098: admin "Needs attention" demo data
-- =============================================================================
-- Phase 3 of the admin Needs-attention rebuild. Gives each of the ten signals a
-- credible, clickable population so the card is a working demo rather than ten
-- zeros. Runs AFTER 0096 (schema) and 0097 (RPCs).
--
-- SAFE ON LIVE — NO RESEED REQUIRED. Everything here is either an INSERT with a
-- '*-demo-*' id (findable + deletable by the .down.sql) or a marked, reversible
-- UPDATE. `npm run seed` is NOT needed and must NOT be run for this feature.
--
-- ⚠️  This migration DOES mutate existing rows — see §4/§5. Two bulk UPDATEs
--     close out the historical processing/open backlog so the counts are
--     believable. Both stamp a '[demo-closeout]' marker so the down migration
--     can find and reverse exactly the rows it touched. Read those sections
--     before applying to production.
--
-- MEASURED BASELINE (live Singapore DB, 2026-08-07, before this migration):
--   dormant 1,096 · employers-late 6 · NAV 0 (no table) · access requests 0 ·
--   underperforming distributors 0 · claims past SLA 912 · withdrawals past SLA
--   1,191 (299 retirement / 892 emergency) · custody 0 (no table) ·
--   reconciliation 4 (all genuine orphaned `tst-sub-*` rows)
--
-- TARGET AFTER THIS MIGRATION:
--   dormant 1,096 (untouched — real) · employers-late 3 · NAV 4 · access
--   requests 4 · underperforming distributors 1 · claims 11 · withdrawals 14
--   (5 retirement / 9 emergency) · custody 4 · reconciliation ~10
--
-- TRIGGER SAFETY (verified against the live catalog):
--   Only two triggers fire on `transactions`, both WHEN-gated:
--     transactions_after_insert_contribution  WHEN (new.type = 'contribution')
--     transactions_after_insert_withdrawal    WHEN (new.type = 'withdrawal')
--   Every transaction inserted here uses type='premium', which fires NEITHER, so
--   no member balance is moved by this migration. The curated withdrawals and
--   claims are inserted into `withdrawals` / `claims` only — never into
--   `transactions` — for the same reason.
--   `subscribers` is never UPDATEd here: it carries a statement-level
--   guard_mass_subscriber_detach trigger and a BEFORE UPDATE editable-columns
--   guard, neither of which this migration has any business tripping.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Access requests — signal #5 (target: 4 pending)
-- ─────────────────────────────────────────────────────────────────────────────
-- The table ships empty by design (0079 seeds nothing; the public form fills it),
-- so the signal reads 0 until someone submits. Four realistic pending leads.
--
-- ⚠️  DEMO NOTE: approving one of these really provisions a distributor/employer
--     through create_distributor / create_employer (0079 → 0091). It is a live
--     mutation, not a mock. Brief demo reps accordingly.
INSERT INTO public.access_requests
  (id, kind, org_name, contact_name, contact_email, contact_phone, sector, district, message, status, created_at)
VALUES
  ('ar-demo-001', 'employer', 'Kigo Tea Estates Ltd', 'Sarah Nabbosa',
   'sarah.nabbosa@kigotea.co.ug', '+256701440101', 'Agriculture', 'd-wakiso',
   'We employ 340 seasonal pickers and want to start a pension scheme for the permanent staff first.',
   'pending', now() - INTERVAL '11 days'),
  ('ar-demo-002', 'employer', 'Nsambya Medical Centre', 'Dr Andrew Kizito',
   'a.kizito@nsambyamed.ug', '+256701440102', 'Healthcare', 'd-kampala',
   'Referred by our insurance broker. 62 clinical and admin staff.',
   'pending', now() - INTERVAL '6 days'),
  ('ar-demo-003', 'distributor', 'Rwenzori Financial Services', 'Grace Businge',
   'grace@rwenzorifin.ug', '+256701440103', NULL, NULL,
   'SACCO network across Kasese and Bundibugyo. 40 field officers ready to onboard.',
   'pending', now() - INTERVAL '3 days'),
  ('ar-demo-004', 'distributor', 'Teso Cooperative Union', 'Michael Emiu',
   'm.emiu@tesocoop.ug', '+256701440104', NULL, NULL,
   'Cooperative union covering Soroti, Kumi and Ngora. Requesting distributor access.',
   'pending', now() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) NAV register — signal #3 (target: 4 pending valuation days)
-- ─────────────────────────────────────────────────────────────────────────────
-- 180 days of weekday history so the drill-down has context, then the four most
-- recent weekdays left unsigned. unit_price is pinned to 1000.00 on EVERY row:
-- the ledger prices contributions at a hardcoded 1,000 UGX/unit inside
-- trg_transactions_contribution (CLAUDE.md §10a) and this register must never
-- contradict it. The signal is "was the day signed off", not "what is the price".
INSERT INTO public.nav_snapshots (id, fund_code, nav_date, unit_price, status, published_at, source)
SELECT
  'nav-demo-' || to_char(d::date, 'YYYYMMDD'),
  'UPU-BAL',
  d::date,
  1000.00,
  'published',
  d::date + TIME '18:00',
  'fund_admin_feed'
FROM generate_series(CURRENT_DATE - 180, CURRENT_DATE - 1, INTERVAL '1 day') d
WHERE EXTRACT(ISODOW FROM d) < 6          -- weekdays only; funds do not price weekends
ON CONFLICT (fund_code, nav_date) DO NOTHING;

-- The four most recent weekdays: feed never arrived, nobody signed off.
UPDATE public.nav_snapshots
   SET status = 'pending', published_at = NULL, source = 'fund_admin_feed'
 WHERE id IN (
   SELECT id FROM public.nav_snapshots
    WHERE fund_code = 'UPU-BAL' AND nav_date < CURRENT_DATE
    ORDER BY nav_date DESC LIMIT 4);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Custody transfers — signal #9 (target: 4 late)
-- ─────────────────────────────────────────────────────────────────────────────
-- Nine monthly batches. `amount` is NOT invented: each batch sums the real
-- contribution transactions inside its collection window, so the money in the
-- register ties back to the actual ledger. The transfer record itself is
-- authored — the platform has no real bank leg — which is stated here rather
-- than hidden.
--
-- 28-day windows, not weekly: contribution volume is very unevenly distributed
-- across the seeded history (140 txns in 2025-08 vs 5,408 in 2026-05), so weekly
-- windows produced several UGX 0 batches — including all three pending ones,
-- which are exactly the rows the drill-down shows. Monthly windows yield
-- 39M–152M on every batch. Verified against live before committing.
INSERT INTO public.custody_transfers
  (id, batch_label, custodian, source, amount, collected_from, collected_to,
   due_by, transferred_at, status, bank_ref, failure_reason)
SELECT
  'cbt-demo-' || lpad(w::text, 2, '0'),
  to_char(CURRENT_DATE - (w * 28), 'FMMon YYYY') || ' member contributions',
  'Stanbic Bank Uganda — Custody',
  'member_contributions',
  COALESCE((SELECT sum(t.amount) FROM public.transactions t
             WHERE t.type = 'contribution'
               AND t.date::date BETWEEN (CURRENT_DATE - (w * 28) - 27) AND (CURRENT_DATE - (w * 28))), 0),
  CURRENT_DATE - (w * 28) - 27,
  CURRENT_DATE - (w * 28),
  CURRENT_DATE - (w * 28) + 3,                                  -- T+3 settlement SLA
  CASE WHEN w >= 5 THEN CURRENT_DATE - (w * 28) + 3 END,        -- oldest 5 settled on time
  CASE WHEN w >= 5 THEN 'transferred' WHEN w = 1 THEN 'failed' ELSE 'pending' END,
  CASE WHEN w >= 5 THEN 'STB' || to_char(CURRENT_DATE - (w * 28), 'YYYYMMDD') || lpad(w::text, 3, '0') END,
  CASE WHEN w = 1 THEN 'Beneficiary account name mismatch — returned by bank' END
FROM generate_series(1, 9) w
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Withdrawals — signal #8 (target: exactly 14 late = 5 retirement + 9 emergency)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️  MUTATES EXISTING ROWS.
--
-- The seeded book carries 1,191 withdrawals stuck in 'processing', nearly all
-- months old, because nothing in the demo ever completes a payout. Surfacing
-- "1,191 delayed payouts" would read as a broken platform, not as a work queue.
-- So: close out the historical backlog, then insert a small curated set with
-- realistic ageing.
--
-- Reversibility: every closed-out row is stamped ' [demo-closeout]' in
-- `reference`, which the .down.sql matches on to restore status='processing'.
-- Only rows already past SLA are touched, so a genuinely fresh request is never
-- swept up.
UPDATE public.withdrawals
   SET status    = 'paid',
       reference = COALESCE(reference, '') || ' [demo-closeout]'
 WHERE status = 'processing'
   AND expected_by < CURRENT_DATE
   AND reference IS DISTINCT FROM NULL
   AND position('[demo-closeout]' IN COALESCE(reference, '')) = 0;

-- Catch rows with a NULL reference in the same sweep (the marker still lands).
UPDATE public.withdrawals
   SET status    = 'paid',
       reference = '[demo-closeout]'
 WHERE status = 'processing'
   AND expected_by < CURRENT_DATE
   AND reference IS NULL;

-- 14 curated late payouts: 5 retirement, 9 emergency, aged 8–34 days past
-- request so `daysLate` spreads across the drill-down instead of clustering.
-- Members are picked deterministically (ORDER BY id OFFSET) so re-running on a
-- fresh database produces the same demo every time.
--
-- The row_number() MUST sit in an outer query over the already-offset subquery.
-- Written the obvious way — window function alongside OFFSET in one SELECT — it
-- numbers before the offset is applied, so rn starts at 221 rather than 1: every
-- array subscript overflows to NULL, every generated id collides, and the
-- bucket/status CASE splits collapse to a single branch. Caught in dry-run.
WITH picked AS (
  SELECT sub.subscriber_id, (row_number() OVER (ORDER BY sub.subscriber_id))::int AS rn
  FROM (
    SELECT id AS subscriber_id
    FROM public.subscribers
    WHERE is_active AND agent_id IS NOT NULL
    ORDER BY id
    OFFSET 220 LIMIT 14
  ) sub
)
INSERT INTO public.withdrawals
  (id, subscriber_id, amount, bucket, reason, method, status, date, expected_by, reference)
SELECT
  'wd-demo-' || lpad(p.rn::text, 2, '0'),
  p.subscriber_id,
  (ARRAY[450000, 1200000, 300000, 875000, 2400000, 180000, 640000,
         1500000, 220000, 960000, 380000, 1750000, 540000, 290000])[p.rn],
  CASE WHEN p.rn <= 5 THEN 'retirement' ELSE 'emergency' END,
  CASE WHEN p.rn <= 5 THEN 'Retirement at 60' ELSE
       (ARRAY['Medical emergency', 'School fees', 'Funeral expenses', 'Medical emergency',
              'Home repair', 'School fees', 'Medical emergency', 'Business capital',
              'Funeral expenses'])[p.rn - 5] END,
  (ARRAY['MTN MoMo', 'Airtel Money', 'Bank transfer'])[1 + (p.rn % 3)],
  'processing',
  CURRENT_DATE - (6 + (p.rn * 2)),                 -- 8 … 34 days back
  CURRENT_DATE - (6 + (p.rn * 2)) + 5,             -- +5d SLA → 3 … 29 days late
  'WD-DEMO-' || lpad(p.rn::text, 4, '0')
FROM picked p
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Insurance claims — signal #7 (target: 11 past decision SLA)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️  MUTATES EXISTING ROWS. Same reasoning and same reversibility mechanism as
--     §4: 912 open claims, most over a year old. The prior status is encoded in
--     `description` so the down migration restores each row to what it was, not
--     to a guess.
UPDATE public.claims
   SET description = COALESCE(description, '') || ' [demo-closeout:' || status || ']',
       status      = 'paid'
 WHERE status NOT IN ('paid', 'rejected')
   AND expected_by < CURRENT_DATE
   AND position('[demo-closeout:' IN COALESCE(description, '')) = 0;

-- 11 curated open claims spread across the decision pipeline.
-- Same outer-row_number() shape as §4 — see the note there for why.
WITH picked AS (
  SELECT sub.subscriber_id, (row_number() OVER (ORDER BY sub.subscriber_id))::int AS rn
  FROM (
    SELECT id AS subscriber_id
    FROM public.subscribers
    WHERE is_active AND agent_id IS NOT NULL
    ORDER BY id
    OFFSET 400 LIMIT 11
  ) sub
)
-- `product` is NOT NULL + CHECK IN ('life','health','funeral') since 0099, which
-- was authored AFTER this file and applied to live BEFORE it. Per 0099's rule —
-- hospital cash is the only product a living member can claim — every curated
-- row is 'health'; `type` keeps the legacy vocabulary it is documented to mirror.
INSERT INTO public.claims
  (id, subscriber_id, type, product, status, amount, incident_date, submitted_date, expected_by, description)
SELECT
  'clm-demo-' || lpad(p.rn::text, 2, '0'),
  p.subscriber_id,
  (ARRAY['medical', 'accident', 'hospitalization', 'critical_illness'])[1 + (p.rn % 4)],
  'health',
  CASE WHEN p.rn <= 4 THEN 'approved'
       WHEN p.rn <= 8 THEN 'under_review'
       ELSE 'submitted' END,
  (ARRAY[850000, 2200000, 470000, 1350000, 3100000, 690000,
         1800000, 520000, 2750000, 940000, 1150000])[p.rn],
  CURRENT_DATE - (18 + (p.rn * 3)),
  CURRENT_DATE - (12 + (p.rn * 3)),                -- 15 … 45 days back
  CURRENT_DATE - (12 + (p.rn * 3)) + 10,           -- +10d SLA → 5 … 35 days late
  CASE WHEN p.rn <= 4 THEN 'Approved — awaiting disbursement'
       WHEN p.rn <= 8 THEN 'Assessor report received, pending adjudication'
       ELSE 'Awaiting supporting documents from member' END
FROM picked p
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Employer contribution runs — signal #2 (target: 3 late, down from 6)
-- ─────────────────────────────────────────────────────────────────────────────
-- All seven employers are on a monthly cadence but only emp-001 has ever posted
-- a run, so every other employer flags. Six of seven late reads as a data gap
-- rather than a work queue. Give three of them a recent run; emp-003 / emp-005 /
-- emp-007 stay late, which is a credible number to act on.
--
-- Totals are token — the signal is recency, not amount — and no `transactions`
-- rows are created, so no member balance moves.
-- (trg_block_inactive_employer_run rejects runs for inactive employers; all
-- three targets are active.)
INSERT INTO public.contribution_runs
  (id, employer_id, period_label, status, employer_total, employee_total,
   insurance_total, grand_total, run_at)
VALUES
  ('run-demo-002', 'emp-002', to_char(CURRENT_DATE - 12, 'FMMonth YYYY') || ' payroll',
   'completed', 1240000, 2480000, 0, 3720000, (CURRENT_DATE - 12)::timestamptz + TIME '12:00'),
  ('run-demo-004', 'emp-004', to_char(CURRENT_DATE - 9, 'FMMonth YYYY') || ' payroll',
   'completed',  890000, 1780000, 0, 2670000, (CURRENT_DATE -  9)::timestamptz + TIME '12:00'),
  ('run-demo-006', 'emp-006', to_char(CURRENT_DATE - 5, 'FMMonth YYYY') || ' payroll',
   'completed', 1610000, 3220000, 0, 4830000, (CURRENT_DATE -  5)::timestamptz + TIME '12:00')
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) A structurally underperforming distributor — signal #6 (target: 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Both live tenants sit at 78% / 76% active rate, comfortably above the 60%
-- threshold, so the signal reads 0 and the row can never be demoed. The only
-- honest lever is another tenant: d-003 is a real pilot network with branches
-- and agents but no members yet, which is exactly what "underperforming" should
-- catch. Deliberately NOT done: re-pointing existing branches, which would shift
-- every distributor-scoped read (0081/0084) and the d-001/d-002 rollups.
--
-- Side effect worth knowing: the two branches and three agents below join the
-- Northern-region agent tree, so region-level agent counts rise by 3. Member
-- counts and AUM are unchanged (d-003 has no subscribers).
INSERT INTO public.distributors (id, name, parent_id, manager_name, manager_phone, manager_email, status)
VALUES ('d-003', 'Karamoja Pilot Network', 'ug', 'Lomongin Achia',
        '+256701440300', 'l.achia@karamojapilot.ug', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.branches
  (id, name, district_id, center_lng, center_lat, manager_name, manager_phone, status, score, distributor_id)
VALUES
  ('b-demo-mrt-001', 'Moroto Pilot', 'd-moroto', 34.6408, 2.6134, 'Cecilia Nakut', '+256701440301', 'active', 0, 'd-003'),
  ('b-demo-kot-001', 'Kotido Pilot', 'd-kotido', 34.0345, 2.9892, 'Peter Lokiru',  '+256701440302', 'active', 0, 'd-003')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agents (id, name, gender, employee_id, branch_id, phone, status, joined_date, performance, rating)
VALUES
  ('a-demo-krm-001', 'Mary Akello',   'female', 'EMP-D003-1', 'b-demo-mrt-001', '+256701440311', 'active', CURRENT_DATE - 45, 0, 0),
  ('a-demo-krm-002', 'Joseph Lokwang', 'male',  'EMP-D003-2', 'b-demo-mrt-001', '+256701440312', 'active', CURRENT_DATE - 40, 0, 0),
  ('a-demo-krm-003', 'Esther Napeyok', 'female','EMP-D003-3', 'b-demo-kot-001', '+256701440313', 'active', CURRENT_DATE - 30, 0, 0)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Reconciliation breaks — signal #10 (target: ~10)
-- ─────────────────────────────────────────────────────────────────────────────
-- The view (0096) only reports breaks that are genuinely rare. Live already
-- carries 4 real `missing_balance` rows (orphaned `tst-sub-*` probes). Two of
-- the remaining checks can be induced safely; two cannot, and are left to read
-- zero as the safety nets they are:
--
--   missing_balance    — cannot seed: subscribers_after_insert auto-creates the
--                        balance row. The 4 real ones stand.
--   orphan_subscriber  — cannot seed: transactions.subscriber_id is FK CASCADE.
--   orphan_run         — cannot seed: contribution_run_id is FK SET NULL.
--   split_mismatch     — seeded below (3 rows).
--   agent_mismatch     — seeded below (3 rows).
--
-- 8a) Split mismatch: retirement + emergency no longer reconstitutes the total.
--     Only the two bucket columns move, so total_balance — and therefore
--     platform AUM, every rollup and every chart — is completely unaffected.
--     Exactly 3 rows, chosen deterministically.
--
--     ⚠️  The outer row_number() is not cosmetic here. Numbering inside the
--     offset SELECT yields 901/902/903, every ARRAY subscript falls out of
--     range and evaluates to NULL, and `retirement_balance + NULL` would NULL
--     OUT three real member balances. Keep the subquery nesting.
UPDATE public.subscriber_balances b
   SET retirement_balance = b.retirement_balance + d.drift
  FROM (
    SELECT t.subscriber_id,
           (ARRAY[12500, -8200, 31000])[(row_number() OVER (ORDER BY t.subscriber_id))::int] AS drift
    FROM (
      SELECT subscriber_id
      FROM public.subscriber_balances
      WHERE total_balance > 100000
      ORDER BY subscriber_id
      OFFSET 900 LIMIT 3
    ) t
  ) d
 WHERE b.subscriber_id = d.subscriber_id
   AND d.drift IS NOT NULL;

-- 8b) Agent mismatch: a posting credited to an agent who does not own the member
--     — the shape a mis-keyed commission attribution takes. type='premium' fires
--     NEITHER balance trigger, so no money moves.
-- Same outer-row_number() shape as §4/§5 — without it the two CTEs number from
-- 701 and 6 respectively and the rn join matches nothing at all.
WITH victim AS (
  SELECT v.subscriber_id, v.agent_id, (row_number() OVER (ORDER BY v.subscriber_id))::int AS rn
  FROM (
    SELECT s.id AS subscriber_id, s.agent_id
    FROM public.subscribers s
    WHERE s.agent_id IS NOT NULL
    ORDER BY s.id
    OFFSET 700 LIMIT 3
  ) v
), wrong AS (
  SELECT g.agent_id, (row_number() OVER (ORDER BY g.agent_id))::int AS rn
  FROM (
    SELECT a.id AS agent_id
    FROM public.agents a
    WHERE a.id LIKE 'a-0%'
    ORDER BY a.id
    OFFSET 5 LIMIT 3
  ) g
)
INSERT INTO public.transactions
  (id, subscriber_id, agent_id, type, amount, date, status, method, txn_ref, source)
SELECT
  't-demo-recon-' || v.rn,
  v.subscriber_id,
  w.agent_id,                                   -- deliberately NOT v.agent_id
  'premium',
  (ARRAY[45000, 62000, 38000])[v.rn],
  CURRENT_DATE - (10 + v.rn * 4),
  'settled',
  'Bank transfer',
  'RECON-DEMO-' || lpad(v.rn::text, 3, '0'),
  'own'
FROM victim v
JOIN wrong w ON w.rn = v.rn
WHERE w.agent_id IS DISTINCT FROM v.agent_id
ON CONFLICT (id) DO NOTHING;
