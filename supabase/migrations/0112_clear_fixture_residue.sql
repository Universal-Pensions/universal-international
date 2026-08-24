-- 0112_clear_fixture_residue.sql
-- ============================================================================
-- Phase 2 · A02-010, A06-017, A04-010 residue, A05-014, A04-016, A16-003,
--            plus the orphan run header found during Phase 1.
--
-- All counts measured live 2026-08-25.
--
-- ⚠️ A06-020 IS DELIBERATELY NOT HERE. Deleting the four stale pending
--    nav_snapshots would destroy a fixture P3-nav-integrity has to rebuild so
--    the "publish moves AUM" demo works. It is deferred to Phase 3 on purpose —
--    do not "tidy" it in.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- RECOVERY snapshots.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscribers_pre_purge_20260824 AS
SELECT * FROM public.subscribers
 WHERE id LIKE 'tst-sub-%' OR id LIKE 's-e2e-%';
CREATE TABLE IF NOT EXISTS public.branches_pre_purge_20260824 AS
SELECT * FROM public.branches WHERE id LIKE 'tst-%' OR distributor_id IS NULL;

COMMENT ON TABLE public.subscribers_pre_purge_20260824 IS
  'Phase 2 (A06-017/A04-010) pre-purge snapshot, 2026-08-25. DO NOT DROP.';
COMMENT ON TABLE public.branches_pre_purge_20260824 IS
  'Phase 2 (A02-010/A06-017) pre-purge snapshot, 2026-08-25. DO NOT DROP.';

-- ---------------------------------------------------------------------------
-- A06-017 + A04-010 residue — the five test subscribers.
--   4 x tst-sub-*  (the missing_balance rows on admin's Needs Attention panel:
--                   tst-sub-tree-msc7vzsc, tst-sub-emp-msc7vzsc,
--                   tst-sub-retag-msc7vzsc, tst-sub-tree-msd3855c)
--   1 x s-e2e-*
--
-- Thirteen child tables carry an FK to subscribers and all but two CASCADE, so
-- the parent delete is enough for them. The two NAV snapshot tables
-- (subscriber_balances_pre_nav, subscribers_unit_value_pre_nav) carry NO
-- foreign key at all — that is finding A06-010 — so nothing cascades and they
-- must be cleared explicitly or these rows outlive the subscriber forever.
--
-- ⚠️ Those two tables are 0105's NAV migration snapshots and are on the
--    do-not-drop list. Only rows whose key matches a TEST subscriber id are
--    touched; a real subscriber's snapshot is never in scope.
--    Note the differing key columns: subscriber_id here, id there.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _doomed_subs ON COMMIT DROP AS
SELECT id FROM public.subscribers WHERE id LIKE 'tst-sub-%' OR id LIKE 's-e2e-%';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM _doomed_subs;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'ABORT: expected 5 test subscribers, found %. Re-measure before purging.', v_n
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DELETE FROM public.subscriber_balances_pre_nav
 WHERE subscriber_id IN (SELECT id FROM _doomed_subs);
DELETE FROM public.subscribers_unit_value_pre_nav
 WHERE id IN (SELECT id FROM _doomed_subs);          -- keyed on id, not subscriber_id
DELETE FROM public.subscribers
 WHERE id IN (SELECT id FROM _doomed_subs);

-- ---------------------------------------------------------------------------
-- A02-010 + A06-017 (same row) — `tst-branch-msc7w8vm` "TST throwaway branch"
-- has distributor_id IS NULL, so it is invisible to every distributor while
-- still counting in platform totals. One delete closes both findings.
-- ---------------------------------------------------------------------------
DELETE FROM public.branches
 WHERE id LIKE 'tst-%' AND distributor_id IS NULL;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.branches WHERE distributor_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % branch(es) still have a NULL distributor_id.', v_n USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Orphan contribution-run header. Found in Phase 1, not by the audit:
-- run-73a0e5c89d06448fb7b49696fe8946b4 ("E2E Run …") holds the 57 EMP- rows
-- that 0110 deletes, so it survives as a header with no transactions and keeps
-- appearing in the employer's run history as a line item backed by nothing.
--
-- Positive discrimination: only a run with ZERO surviving transactions AND a
-- test-shaped name. A legitimate run that happens to be empty is left alone.
-- ---------------------------------------------------------------------------
DELETE FROM public.contribution_runs r
 WHERE r.period_label ILIKE 'E2E Run%'   -- the label column; there is no `name`
   AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.contribution_run_id = r.id);

-- ---------------------------------------------------------------------------
-- A05-014 — the settlement_uploads nonce ledger has never been cleaned.
--
-- ⚠️ This is REPLAY-PROTECTION data, not cosmetic residue. Removing a nonce
--    lets that exact nonce be processed again as new. Only rows with no
--    surviving settlement_batches row are purged: if the batch is gone the
--    nonce guards nothing, and every nonce here is a per-run UUID that cannot
--    recur in practice. Uploads still tied to a live batch are KEPT.
--
-- The e2e teardown now cleans these by nonce going forward (Phase 0), so this
-- is a one-time catch-up, not a recurring sweep.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settlement_uploads_pre_purge_20260824 AS
SELECT * FROM public.settlement_uploads;
COMMENT ON TABLE public.settlement_uploads_pre_purge_20260824 IS
  'Phase 2 (A05-014) pre-purge snapshot of the settlement nonce ledger, 2026-08-25. DO NOT DROP.';

DELETE FROM public.settlement_uploads u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.settlement_batches b WHERE b.client_nonce = u.nonce
 );

-- ---------------------------------------------------------------------------
-- A04-016 — s-0005's bucket units do not sum to its total units
-- (measured: units 203.9864220, retirement 185.404883, emergency 24.9452911,
--  drift +6.3637520). Repaired with the SAFE RPC, never a literal UPDATE.
-- This is a prerequisite for the bucket-sum CHECK constraint 0113 adds:
-- ADD CONSTRAINT would fail validating this row.
-- ---------------------------------------------------------------------------
SELECT public._resync_bucket_units('s-0005');

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.subscriber_balances
   WHERE abs((COALESCE(retirement_units,0) + COALESCE(emergency_units,0)) - units) > 0.0001;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % balance row(s) still have bucket drift. 0113''s CHECK would fail.', v_bad
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- A16-003 — every seeded employer invite is expired, so the /invite/:token
-- entry flow cannot be demoed at all. Push the most recent one into the future.
-- ---------------------------------------------------------------------------
UPDATE public.employer_invites
   SET expires_at = now() + interval '90 days'
 WHERE token = (SELECT token FROM public.employer_invites ORDER BY created_at DESC LIMIT 1);
 -- keyed on `token`; employer_invites has no `id` column

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.employer_invites WHERE expires_at > now();
  IF v_n < 1 THEN
    RAISE EXCEPTION 'ABORT: no employer invite is live; the invite demo is still broken.'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'Fixture residue cleared. % live employer invite(s).', v_n;
END $$;

COMMIT;
