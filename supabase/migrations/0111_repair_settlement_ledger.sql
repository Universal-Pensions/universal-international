-- 0111_repair_settlement_ledger.sql
-- ============================================================================
-- Phase 2 · A05-003, A05-008 — repair the settlement ledger.
--
-- Measured live 2026-08-25. Two distinct defects:
--
-- (1) ORPHAN E2E BATCHES. Five settlement_batches rows claim money was paid but
--     no commission row carries their txn_ref — they are e2e residue whose
--     commissions were rolled back or re-flipped to 'due'. Eight notifications
--     reference them, so the agent and branch personas both show payouts that
--     never happened.
--
--     The audit found THREE. There are FIVE: two more were created 2026-08-24 by
--     a remediation agent's own verification run and disclosed in
--     docs/audits/2026-08-23/a04/phase2-emp-predicate.md. A predicate hardcoded
--     to the audit's three would leave two behind, so this matches on the
--     E2E- prefix AND on having no backing commission rows.
--
-- (2) WRONG BRANCH STAMP + UNBACKED TOTALS on the two seeded batches.
--     scripts/seed-supabase.mjs hardcodes branchId (b-kam-015 / b-mba-290)
--     instead of deriving it from the agent as the live apply_settlement does.
--     BOTH seeded batches are wrong:
--         sb-seed-0001  agent a-001  stamped b-kam-015  actually b-bui-001
--         sb-seed-0002  agent a-042  stamped b-mba-290  actually b-buv-007
--     settlement_batches RLS scopes by branch_id, so each payout is routed to a
--     branch that did not earn it, and never reaches the one that did. The
--     b-kam-015 persona is told UGX 45,000 was settled while its own commission
--     ledger reports 0 paid / 0% settled.
--
--     All five E2E batches, created by the real RPC, have the CORRECT branch —
--     which confirms the fix direction: derive from the agent, never hardcode.
--
--     sb-seed-0001 also claims 45,000 / 9 lines while the rows carrying
--     MM-SEED-0001 total 35,000 / 7. sb-seed-0002's totals are already correct.
--
-- The seed script itself is fixed separately so this cannot regenerate.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- RECOVERY — snapshot both tables before touching them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settlement_batches_pre_purge_20260824 AS
SELECT * FROM public.settlement_batches;
CREATE TABLE IF NOT EXISTS public.notifications_pre_purge_20260824 AS
SELECT * FROM public.notifications WHERE ref_id LIKE 'sb-%';

COMMENT ON TABLE public.settlement_batches_pre_purge_20260824 IS
  'Phase 2 (A05-003/A05-008) pre-repair snapshot, 2026-08-25. DO NOT DROP.';

-- Secure the snapshot AT CREATION. `CREATE TABLE … AS SELECT` inherits NOTHING
-- from its source — not RLS, not policies, not grants — so a copy of protected
-- rows lands wide open, and `anon` holds SELECT on essentially every table in
-- `public` (A02-101). Supabase's advisor flagged exactly this as CRITICAL on the
-- snapshots that reached live on 2026-08-25. RLS with NO policies is the point:
-- service_role and the owner bypass it, which is precisely and only who should
-- read a recovery snapshot.
ALTER TABLE public.settlement_batches_pre_purge_20260824 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_batches_pre_purge_20260824 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.settlement_batches_pre_purge_20260824 FROM anon, authenticated;

COMMENT ON TABLE public.notifications_pre_purge_20260824 IS
  'Phase 2 (A05-003/A05-008) pre-repair snapshot of settlement notifications, 2026-08-25. DO NOT DROP.';

-- Secure the snapshot AT CREATION. `CREATE TABLE … AS SELECT` inherits NOTHING
-- from its source — not RLS, not policies, not grants — so a copy of protected
-- rows lands wide open, and `anon` holds SELECT on essentially every table in
-- `public` (A02-101). Supabase's advisor flagged exactly this as CRITICAL on the
-- snapshots that reached live on 2026-08-25. RLS with NO policies is the point:
-- service_role and the owner bypass it, which is precisely and only who should
-- read a recovery snapshot.
ALTER TABLE public.notifications_pre_purge_20260824 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_pre_purge_20260824 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications_pre_purge_20260824 FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- (1) Drop the orphan E2E batches and their notifications.
--     Notifications FIRST — they reference the batch id.
--     Positive discrimination: E2E- prefix AND zero backing commission rows.
--     A batch with real backing lines is NOT residue and is left alone.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _orphan_batches ON COMMIT DROP AS
SELECT b.id, b.txn_ref
  FROM public.settlement_batches b
 WHERE b.txn_ref LIKE 'E2E-%'
   AND NOT EXISTS (
     SELECT 1 FROM public.commissions c
      WHERE c.txn_ref = b.txn_ref AND c.status = 'paid'
   );

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM _orphan_batches;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ABORT: expected orphan E2E batches, found none. Already repaired?'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'Orphan E2E batches to drop: %', v_n;
END $$;

DELETE FROM public.notifications
 WHERE ref_id IN (SELECT id FROM _orphan_batches);

DELETE FROM public.settlement_batches
 WHERE id IN (SELECT id FROM _orphan_batches);

-- ---------------------------------------------------------------------------
-- (2a) Re-derive the branch stamp from the agent, exactly as apply_settlement
--      does (0032:174). Applies to every batch, so a future mis-stamp is
--      corrected too — but only where it actually differs.
-- ---------------------------------------------------------------------------
UPDATE public.settlement_batches b
   SET branch_id = a.branch_id
  FROM public.agents a
 WHERE a.id = b.agent_id
   AND b.branch_id IS DISTINCT FROM a.branch_id;

-- (2b) Recompute paid_amount / line_count from the commission rows that
--      actually carry each batch's txn_ref. Never trust the stored figure.
UPDATE public.settlement_batches b
   SET paid_amount = t.actual_paid,
       line_count  = t.actual_lines
  FROM (
    SELECT b2.id,
           COALESCE(SUM(c.paid_amount), 0) AS actual_paid,
           COUNT(c.id)                     AS actual_lines
      FROM public.settlement_batches b2
      LEFT JOIN public.commissions c
             ON c.txn_ref = b2.txn_ref AND c.status = 'paid'
     GROUP BY b2.id
  ) t
 WHERE t.id = b.id
   AND (b.paid_amount IS DISTINCT FROM t.actual_paid
     OR b.line_count  IS DISTINCT FROM t.actual_lines);

-- (2c) Re-point the branch notifications at the corrected branch, and restate
--      their amounts and copy to match. The seeded bodies also used a raw
--      number and a hardcoded plural ("UGX 45000 paid for 9 commissions.")
--      where the live RPC formats thousands and agrees the noun
--      ("UGX 5,000 paid for 1 commission."). Bring them into line.
UPDATE public.notifications n
   SET recipient_id = b.branch_id
  FROM public.settlement_batches b
 WHERE n.ref_id = b.id
   AND n.recipient_role = 'branch'
   AND n.recipient_id IS DISTINCT FROM b.branch_id;

UPDATE public.notifications n
   SET amount = b.paid_amount,
       body   = 'UGX ' || to_char(b.paid_amount, 'FM999,999,999,999')
                || ' paid for ' || b.line_count
                || CASE WHEN b.line_count = 1 THEN ' commission.' ELSE ' commissions.' END
  FROM public.settlement_batches b
 WHERE n.ref_id = b.id
   AND (n.amount IS DISTINCT FROM b.paid_amount
     OR n.body   IS DISTINCT FROM ('UGX ' || to_char(b.paid_amount, 'FM999,999,999,999')
                || ' paid for ' || b.line_count
                || CASE WHEN b.line_count = 1 THEN ' commission.' ELSE ' commissions.' END));

-- ---------------------------------------------------------------------------
-- GUARDS
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad int;
BEGIN
  -- every surviving batch must agree with its own lines
  SELECT count(*) INTO v_bad FROM (
    SELECT b.id
      FROM public.settlement_batches b
      LEFT JOIN public.commissions c ON c.txn_ref = b.txn_ref AND c.status = 'paid'
     GROUP BY b.id, b.paid_amount, b.line_count
    -- IS DISTINCT FROM, not <>. `<>` yields NULL when either side is NULL, and a
    -- NULL is not TRUE, so a HAVING built on `<>` silently PASSES the very rows
    -- it exists to catch. paid_amount/line_count are NOT NULL today, so this is
    -- defensive — but the UPDATE above already uses IS DISTINCT FROM, and a guard
    -- weaker than the statement it verifies is worse than no guard: it reports
    -- success it cannot actually establish.
    HAVING b.paid_amount IS DISTINCT FROM COALESCE(SUM(c.paid_amount), 0)
        OR b.line_count  IS DISTINCT FROM COUNT(c.id)
  ) x;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % batch(es) still disagree with their commission lines.', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  -- every batch must sit in its agent's real branch
  SELECT count(*) INTO v_bad
    FROM public.settlement_batches b JOIN public.agents a ON a.id = b.agent_id
   WHERE b.branch_id IS DISTINCT FROM a.branch_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % batch(es) still mis-stamped.', v_bad USING ERRCODE = 'P0001';
  END IF;

  -- no notification may point at a batch that no longer exists
  SELECT count(*) INTO v_bad
    FROM public.notifications n
   WHERE n.ref_id LIKE 'sb-%'
     AND NOT EXISTS (SELECT 1 FROM public.settlement_batches b WHERE b.id = n.ref_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % orphaned settlement notification(s) remain.', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'Settlement ledger repaired: batches agree with their lines, branches derived from agents, notifications consistent.';
END $$;

COMMIT;
