-- =============================================================================
-- ⚠️ DEPRECATED / DEAD — DO NOT APPLY, RE-APPLY, OR COPY FROM THIS FILE
-- (deprecation header added 2026-08-25, audit finding A03-005; body below is
-- otherwise UNCHANGED and this migration is NOT being deleted)
-- =============================================================================
-- Every function this migration creates/replaces was DROPPED by
-- `0029_commission_simplify.sql` and is absent from live `pg_proc` (verified
-- 2026-08-25): `SELECT count(*) FROM pg_proc WHERE proname IN (open_run,
-- cancel_run, release_run, ..., mark_branch_reviewed)` → 0, and no live
-- function's `prosrc` references `commission_runs` or `commission_lines`.
-- The run/dispute tables these functions operated on do not exist either —
-- only `contribution_runs` / `contribution_run_uploads` do. There is no
-- `0021...down.sql`.
--
-- Retained for historical/provenance reasons only (A03-005,
-- `docs/audits/2026-08-23/findings.json`). See `0029_commission_simplify.sql`
-- and `docs/BACKEND.md §16` for what actually runs live today.
-- =============================================================================
-- =============================================================================
-- Universal Pensions Uganda — 0021: Commission RPCs `app_role` migration
-- =============================================================================
-- Forward-port of `0004_commission_run_rpcs.sql` with the JWT claim corrected:
-- `auth.jwt() ->> 'role'` → `auth.jwt() ->> 'app_role'`. The function bodies
-- are otherwise byte-identical to 0004 (CREATE OR REPLACE).
--
-- WHY: 0004 was authored before `0007_rls_use_app_role.sql` introduced the
-- canonical `app_role` claim. The JWT signer (`api/_lib/jwt.ts`) emits both
-- `role: 'authenticated'` (the Postgres role PostgREST uses for SET ROLE) and
-- `app_role: <JwtRole>` (the application role: subscriber/agent/branch/
-- distributor/admin). All 65 RLS policies have been keying off `app_role`
-- since 0007. The 13 RPCs in 0004 still read `role`, which is always
-- `'authenticated'` — so every commission state-machine write raised
-- `role_not_permitted`. This was the same trap that produced the
-- region/district/branch drill-down zeros (see 0020 header).
--
-- Forward-only per BACKEND.md §7. Idempotent — every block is CREATE OR REPLACE.
-- =============================================================================
-- Original 0004 header (preserved for historical context):
-- =============================================================================
-- Defines the 13 transactional SQL functions that mirror every state
-- transition currently in src/services/commissions.js. Each JS function maps
-- to one Postgres function below; the function body is the canonical authority
-- once these migrations are applied.
--
-- All functions are LANGUAGE plpgsql SECURITY DEFINER so they can mutate the
-- `commissions` and `settlement_runs` tables despite RLS providing no direct
-- INSERT/UPDATE policies on those tables (per plan §"Commission state-machine
-- RPCs" and §"Row-level security"). Each function body validates the caller's
-- role/branch/agent via auth.jwt() claims before touching any row.
--
-- Plan §"Risks & gotchas" #1: auth.uid() is NULL for custom-issued JWTs. All
-- claim reads use auth.jwt() ->> '<claim>' exclusively. The expected claims
-- shape lives in plan §"Backend API routes":
--   { role, phone, subscriberId, agentId, branchId, distributorId, aud, exp }
--
-- Dependencies (NOT created here — installed by Agent 2 in 0002_rpc_functions.sql):
--   * BEFORE UPDATE trigger on commissions that captures OLD.status into
--     NEW.previous_status when NEW.status = 'disputed'. The approve_dispute /
--     reject_dispute functions below read commissions.previous_status to
--     restore the pre-dispute state, so they REQUIRE that trigger to be
--     present for branch_dispute_line / withdraw_dispute / approve_dispute /
--     reject_dispute to work correctly. If the trigger is missing,
--     previous_status will be NULL and approve_dispute falls back to 'due'
--     (mirrors JS behaviour at commissions.js#approveDispute line 788–795).
--
-- disputed_by convention:
--   Schema column commissions.disputed_by is TEXT (0001 line 364:
--   "'agent' | 'branch' (mockData convention)"). mockData stores the literal
--   role label, not the user reference (verified at mockData.js line 801, 833:
--   "disputedBy = 'agent'", "disputedBy = 'branch'"). We follow that
--   convention so the seed does not have to translate. branch_dispute_line
--   stores the literal 'branch'; withdraw_dispute / agent-side flows would
--   store the literal 'agent' if/when the agent dispute RPC exists in this
--   file (it doesn't — disputeCommission(by='agent') is not in the 13-RPC
--   surface; only branch_dispute_line is). Decision: disputed_by gets the
--   literal role label.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- open_run() RETURNS text
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#openRun (line 449).
-- Allowed role: distributor.
--
-- Generates a new run_id of the form r-YYYY-MM based on now() at the server.
-- Pulls every commission currently in status 'due' into the new run, sets
-- their status to 'in_run' and run_id to the new id, and seeds a 'pending'
-- branchReview row for every touched branch. Run state starts at
-- 'branch_review' (matches JS at line 481).
--
-- Guards:
--   * No other run may be open (state in ('draft','branch_review')).
--   * At least one 'due' commission must exist.
--
-- Returns: the new run id.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION open_run()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       text  := auth.jwt() ->> 'app_role';
  v_run_id     text;
  v_now        timestamptz := now();
  v_due_count  integer;
  v_total      numeric := 0;
  v_cadence    text;
BEGIN
  IF v_role IS DISTINCT FROM 'distributor' THEN
    RAISE EXCEPTION 'role % cannot open a settlement run', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM settlement_runs
    WHERE state IN ('draft', 'branch_review')
  ) THEN
    RAISE EXCEPTION 'A settlement run is already open'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_due_count, v_total
  FROM commissions
  WHERE status = 'due';

  IF v_due_count = 0 THEN
    RAISE EXCEPTION 'No due commissions to bundle into a run'
      USING ERRCODE = 'P0001';
  END IF;

  v_run_id := 'r-' || to_char(v_now, 'YYYY-MM');

  -- Disambiguate if a run already exists for this month (the JS uses a
  -- Date.now() suffix; we use a 4-char base36-ish suffix derived from epoch ms
  -- to keep IDs short and unique across same-month opens).
  IF EXISTS (SELECT 1 FROM settlement_runs WHERE id = v_run_id) THEN
    v_run_id := v_run_id || '-' || substr(
      to_hex((extract(epoch from v_now) * 1000)::bigint), -- ms since epoch
      -4
    );
  END IF;

  -- Pick the current cadence off commission_config; fall back to a sensible
  -- default if the row is missing (the seed always populates it).
  SELECT cadence INTO v_cadence FROM commission_config LIMIT 1;
  IF v_cadence IS NULL THEN
    v_cadence := 'monthly-first';
  END IF;

  INSERT INTO settlement_runs (
    id, cadence, opened_at, state, total_amount, commission_count,
    released_at, released_by, notes
  ) VALUES (
    v_run_id, v_cadence, v_now, 'branch_review', v_total, v_due_count,
    NULL, NULL, ''
  );

  -- Promote the due rows into the new run.
  UPDATE commissions
     SET status = 'in_run',
         run_id = v_run_id
   WHERE status = 'due';

  -- Seed pending branch-review rows for every branch touched by the run.
  INSERT INTO settlement_run_branch_reviews (run_id, branch_id, state)
  SELECT DISTINCT v_run_id, branch_id, 'pending'::settlement_run_branch_review_state
    FROM commissions
   WHERE run_id = v_run_id
     AND branch_id IS NOT NULL
  ON CONFLICT (run_id, branch_id) DO NOTHING;

  RETURN v_run_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- cancel_run(run_id text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#cancelRun (line 502).
-- Allowed role: distributor.
--
-- Aborts an open run. All 'in_run' lines fall back to 'due' and lose their
-- run_id. 'held' lines stay held (mirrors JS at line 506: only in_run lines
-- are reset). Run state → 'cancelled'.
--
-- Guards:
--   * Run must exist.
--   * Run state must NOT already be 'released' or 'cancelled' (idempotent
--     no-op in those cases — mirrors JS at line 504).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_run(p_run_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text := auth.jwt() ->> 'app_role';
  v_state settlement_run_state;
BEGIN
  IF v_role IS DISTINCT FROM 'distributor' THEN
    RAISE EXCEPTION 'role % cannot cancel a settlement run', v_role
      USING ERRCODE = 'P0001';
  END IF;

  SELECT state INTO v_state FROM settlement_runs WHERE id = p_run_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  -- No-op for terminal states.
  IF v_state IN ('released', 'cancelled') THEN
    RETURN;
  END IF;

  -- Fall in_run lines back to due. Held lines retain their hold_reason and
  -- remain held (JS at line 506-509 only resets in_run).
  UPDATE commissions
     SET status = 'due',
         run_id = NULL
   WHERE run_id = p_run_id
     AND status = 'in_run';

  UPDATE settlement_runs
     SET state = 'cancelled'
   WHERE id = p_run_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- release_run(run_id text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#releaseRun (line 673).
-- Allowed role: distributor.
--
-- Bulk version of release_branch. Releases every branch currently in
-- 'approved' state within the run. Pending or held branches are left alone
-- and the run stays in 'branch_review' until they sign off (mirrors JS at
-- line 685-687: only iterates approved branch IDs).
--
-- Guards:
--   * Run must exist.
--   * Run state must be 'draft' or 'branch_review' (JS at line 676).
--   * At least one branch must be in 'approved' state (JS at line 682).
--
-- Side effect: when every branch reaches 'released', release_branch promotes
-- the run to 'released' (see that function).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_run(p_run_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text := auth.jwt() ->> 'app_role';
  v_state settlement_run_state;
  v_bid   text;
  v_any   boolean := false;
BEGIN
  IF v_role IS DISTINCT FROM 'distributor' THEN
    RAISE EXCEPTION 'role % cannot release a settlement run', v_role
      USING ERRCODE = 'P0001';
  END IF;

  SELECT state INTO v_state FROM settlement_runs WHERE id = p_run_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  IF v_state NOT IN ('draft', 'branch_review') THEN
    RAISE EXCEPTION 'Run cannot be released from state: %', v_state
      USING ERRCODE = 'P0001';
  END IF;

  -- Iterate every approved branch in this run and release each. release_branch
  -- handles the per-branch commission updates and the run-level promotion when
  -- all branches reach 'released'.
  FOR v_bid IN
    SELECT branch_id
      FROM settlement_run_branch_reviews
     WHERE run_id = p_run_id
       AND state = 'approved'
  LOOP
    v_any := true;
    PERFORM release_branch(p_run_id, v_bid);
  END LOOP;

  IF NOT v_any THEN
    RAISE EXCEPTION 'No approved branches to release'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- release_branch(run_id text, branch_id text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#releaseBranch (line 632).
-- Allowed role: distributor.
--
-- Distributor releases a single branch's slice of a run. Every 'in_run' line
-- in that branch flips to 'released' with paid_date = today; the branch's
-- review state flips to 'released'.
--
-- Partial release is intentional (JS comment at line 627): one slow branch
-- shouldn't gate every other branch's payout.
--
-- Run-level promotion: if every branch in the run is now 'released', the run
-- itself flips to 'released' and sets released_at/released_by (JS at line
-- 655-660).
--
-- Guards:
--   * Run must exist.
--   * Branch row must exist within the run.
--   * Branch review state must be 'approved'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_branch(p_run_id text, p_branch_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        text := auth.jwt() ->> 'app_role';
  v_run_state   settlement_run_state;
  v_review      settlement_run_branch_review_state;
  v_now         timestamptz := now();
  v_all_done    boolean;
BEGIN
  IF v_role IS DISTINCT FROM 'distributor' THEN
    RAISE EXCEPTION 'role % cannot release a branch slice', v_role
      USING ERRCODE = 'P0001';
  END IF;

  SELECT state INTO v_run_state FROM settlement_runs WHERE id = p_run_id;
  IF v_run_state IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  SELECT state INTO v_review
    FROM settlement_run_branch_reviews
   WHERE run_id = p_run_id AND branch_id = p_branch_id;

  IF v_review IS NULL THEN
    RAISE EXCEPTION 'Branch % not in run %', p_branch_id, p_run_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_review IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Branch must approve their slice before release'
      USING ERRCODE = 'P0001';
  END IF;

  -- Flip the in_run lines for this branch to released with today's paid_date.
  -- Note: we do not write txn_ref here. The JS supports passing a txnRefByAgent
  -- map; the seed sets txn_ref directly for the released r-2026-03 run
  -- (plan §"Seed strategy"). A future enhancement could accept a JSONB map.
  UPDATE commissions
     SET status    = 'released',
         paid_date = v_now::date
   WHERE run_id   = p_run_id
     AND branch_id = p_branch_id
     AND status    = 'in_run';

  -- Flip the branch review row to released with timestamps.
  UPDATE settlement_run_branch_reviews
     SET state       = 'released',
         released_at = v_now
   WHERE run_id = p_run_id AND branch_id = p_branch_id;

  -- Run-level promotion: if every branch review row is now 'released',
  -- mark the run itself released (JS at line 655-660).
  SELECT NOT EXISTS (
    SELECT 1 FROM settlement_run_branch_reviews
     WHERE run_id = p_run_id
       AND state IS DISTINCT FROM 'released'
  ) INTO v_all_done;

  IF v_all_done THEN
    UPDATE settlement_runs
       SET state       = 'released',
           released_at = v_now,
           released_by = 'Distributor admin'
     WHERE id = p_run_id;
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- branch_approve_all(run_id text) RETURNS integer
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#branchApproveAll (line 590).
-- Allowed role: branch.
-- Branch scoping: derives branch_id from auth.jwt() ->> 'branchId'. The branch
--   user can only sign off on their own branch's slice.
--
-- Marks the branch's review row as 'approved' and returns the count of
-- commissions in this branch's slice of the run. The JS at line 593 does NOT
-- filter by status — it counts every line the branch is responsible for in
-- the run, regardless of in_run/held/disputed — so we mirror that exactly.
--
-- Guards:
--   * Caller must be role 'branch'.
--   * branchId claim must be present.
--   * Run must exist.
--   * branchReview row for this branch must exist in the run (the run touched
--     this branch).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION branch_approve_all(p_run_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text := auth.jwt() ->> 'app_role';
  v_branch   text := auth.jwt() ->> 'branchId';
  v_count    integer;
  v_run_exists boolean;
  v_review_exists boolean;
BEGIN
  IF v_role IS DISTINCT FROM 'branch' THEN
    RAISE EXCEPTION 'role % cannot approve a branch slice', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF v_branch IS NULL OR v_branch = '' THEN
    RAISE EXCEPTION 'branchId claim missing from JWT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM settlement_runs WHERE id = p_run_id)
    INTO v_run_exists;
  IF NOT v_run_exists THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM settlement_run_branch_reviews
     WHERE run_id = p_run_id AND branch_id = v_branch
  ) INTO v_review_exists;
  IF NOT v_review_exists THEN
    RAISE EXCEPTION 'Branch % not in run %', v_branch, p_run_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Count of commissions the branch is responsible for in this run (mirrors
  -- JS lines.length at branchApproveAll line 593 — no status filter).
  SELECT COUNT(*) INTO v_count
    FROM commissions
   WHERE run_id = p_run_id AND branch_id = v_branch;

  UPDATE settlement_run_branch_reviews
     SET state       = 'approved',
         reviewed_by = 'Branch admin',
         reviewed_at = now()
   WHERE run_id = p_run_id AND branch_id = v_branch;

  RETURN v_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- mark_branch_reviewed(run_id text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#markBranchReviewed (line 608).
-- Allowed role: branch.
-- Branch scoping: branchId from JWT.
--
-- Marks the branch's review row as 'approved' without acting on individual
-- lines. Useful when the branch has already touched every line individually.
--
-- Idempotent: re-calling on an already-approved row is a no-op success
-- (JS at line 611-616 unconditionally overwrites state to 'approved').
--
-- Guards:
--   * Caller must be role 'branch'.
--   * branchId claim must be present.
--   * Run must exist.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_branch_reviewed(p_run_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := auth.jwt() ->> 'app_role';
  v_branch text := auth.jwt() ->> 'branchId';
BEGIN
  IF v_role IS DISTINCT FROM 'branch' THEN
    RAISE EXCEPTION 'role % cannot mark a branch reviewed', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF v_branch IS NULL OR v_branch = '' THEN
    RAISE EXCEPTION 'branchId claim missing from JWT'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM settlement_runs WHERE id = p_run_id) THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  -- Upsert: JS at line 611-613 creates a fresh review row if missing. Mirror
  -- that, then set the canonical fields. This makes the function idempotent
  -- and self-healing if the open_run seed step missed a branch for any reason.
  INSERT INTO settlement_run_branch_reviews (run_id, branch_id, state, reviewed_by, reviewed_at)
  VALUES (p_run_id, v_branch, 'approved', 'Branch admin', now())
  ON CONFLICT (run_id, branch_id)
  DO UPDATE SET state       = 'approved',
                reviewed_by = 'Branch admin',
                reviewed_at = now();
END;
$$;


-- -----------------------------------------------------------------------------
-- branch_approve_line(commission_id text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#branchApproveLine (line 539).
-- Allowed role: branch.
-- Branch scoping: branchId from JWT must match the commission's branch_id.
--
-- Per-line branch sign-off. The JS at line 542 only does work when the line
-- is currently 'held' — for an 'in_run' line, the line is already in the run
-- and branch_approve_line is effectively a no-op (the branch is implicitly
-- approving by leaving it alone). We mirror that: 'held' → 'in_run' if an
-- open run exists, otherwise 'held' → 'due'. Also clears hold_reason.
--
-- Guards:
--   * Commission must exist.
--   * Commission's branch_id must match caller's branchId claim.
--
-- Idempotency: silently no-ops on commissions that are not in 'held' state
-- (matches JS — no error thrown, the function just returns).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION branch_approve_line(p_commission_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text := auth.jwt() ->> 'app_role';
  v_branch   text := auth.jwt() ->> 'branchId';
  v_c_branch text;
  v_status   commission_status;
  v_open_run text;
BEGIN
  IF v_role IS DISTINCT FROM 'branch' THEN
    RAISE EXCEPTION 'role % cannot approve a commission line', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF v_branch IS NULL OR v_branch = '' THEN
    RAISE EXCEPTION 'branchId claim missing from JWT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT branch_id, status INTO v_c_branch, v_status
    FROM commissions WHERE id = p_commission_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Commission not found: %', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c_branch IS DISTINCT FROM v_branch THEN
    RAISE EXCEPTION 'Commission % is not in branch %', p_commission_id, v_branch
      USING ERRCODE = 'P0001';
  END IF;

  -- JS at line 542: only mutate 'held' lines. Other states are a no-op.
  IF v_status <> 'held' THEN
    RETURN;
  END IF;

  -- If an open run exists, re-attach as in_run; otherwise fall back to due.
  SELECT id INTO v_open_run
    FROM settlement_runs
   WHERE state IN ('draft', 'branch_review')
   LIMIT 1;

  IF v_open_run IS NOT NULL THEN
    UPDATE commissions
       SET status      = 'in_run',
           run_id      = v_open_run,
           hold_reason = NULL
     WHERE id = p_commission_id;
  ELSE
    UPDATE commissions
       SET status      = 'due',
           run_id      = NULL,
           hold_reason = NULL
     WHERE id = p_commission_id;
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- branch_hold_line(commission_id text, hold_reason text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#branchHoldLine (line 570).
-- Allowed role: branch.
-- Branch scoping: branchId from JWT must match the commission's branch_id.
--
-- Branch holds an 'in_run' line out of the current run. Status flips to
-- 'held', run_id is cleared (line is detached from the run), hold_reason is
-- recorded.
--
-- Guards:
--   * Commission must exist.
--   * Commission's branch_id must match caller's branchId claim.
--   * Commission status must be 'in_run' (JS at line 572). Reject other states
--     so accidental clicks from stale UI can't corrupt state.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION branch_hold_line(p_commission_id text, p_hold_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text := auth.jwt() ->> 'app_role';
  v_branch   text := auth.jwt() ->> 'branchId';
  v_c_branch text;
  v_status   commission_status;
BEGIN
  IF v_role IS DISTINCT FROM 'branch' THEN
    RAISE EXCEPTION 'role % cannot hold a commission line', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF v_branch IS NULL OR v_branch = '' THEN
    RAISE EXCEPTION 'branchId claim missing from JWT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT branch_id, status INTO v_c_branch, v_status
    FROM commissions WHERE id = p_commission_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Commission not found: %', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c_branch IS DISTINCT FROM v_branch THEN
    RAISE EXCEPTION 'Commission % is not in branch %', p_commission_id, v_branch
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'in_run' THEN
    RAISE EXCEPTION 'Commission % cannot be held from status %', p_commission_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE commissions
     SET status      = 'held',
         run_id      = NULL,
         hold_reason = p_hold_reason
   WHERE id = p_commission_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- branch_dispute_line(commission_id text, dispute_reason text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#branchDisputeLine (line 747) → disputeCommission
--   (line 723) with by='branch'.
-- Allowed role: branch.
-- Branch scoping: branchId from JWT must match the commission's branch_id.
--
-- Raises a dispute on a commission. Stores dispute_reason, disputed_at=now(),
-- disputed_by='branch' (literal role label per mockData convention). If the
-- line was currently 'in_run', detaches it from the run (run_id → NULL); for
-- already-paid lines we keep run_id/txn_ref/paid_date intact so the audit
-- trail survives the dispute round-trip (JS comment at line 718-720).
--
-- previous_status is NOT set by this function. A BEFORE-UPDATE trigger
-- installed in 0002_rpc_functions.sql (Agent 2) captures OLD.status into
-- NEW.previous_status when NEW.status='disputed'. This function depends on
-- that trigger; without it, approve_dispute/reject_dispute fall back to 'due'.
--
-- Guards:
--   * Commission must exist.
--   * Commission's branch_id must match caller's branchId claim.
--   * No-op if already 'disputed' (JS at line 726 returns same row).
--   * Reject if 'rejected' (JS at line 727 returns null — translate to error
--     since a void RPC has no way to signal "already terminal").
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION branch_dispute_line(p_commission_id text, p_dispute_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text := auth.jwt() ->> 'app_role';
  v_branch   text := auth.jwt() ->> 'branchId';
  v_c_branch text;
  v_status   commission_status;
BEGIN
  IF v_role IS DISTINCT FROM 'branch' THEN
    RAISE EXCEPTION 'role % cannot dispute a commission line', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF v_branch IS NULL OR v_branch = '' THEN
    RAISE EXCEPTION 'branchId claim missing from JWT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT branch_id, status INTO v_c_branch, v_status
    FROM commissions WHERE id = p_commission_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Commission not found: %', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c_branch IS DISTINCT FROM v_branch THEN
    RAISE EXCEPTION 'Commission % is not in branch %', p_commission_id, v_branch
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent on already-disputed (JS at line 726).
  IF v_status = 'disputed' THEN
    RETURN;
  END IF;

  -- Terminal 'rejected' state cannot be re-disputed.
  IF v_status = 'rejected' THEN
    RAISE EXCEPTION 'Commission % is rejected; cannot dispute', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  -- For in_run lines, detach from the run. For paid lines (released/confirmed)
  -- keep run_id/txn_ref/paid_date — audit trail must survive the dispute.
  -- The BEFORE-UPDATE trigger (Agent 2) captures the OLD status into
  -- commissions.previous_status when status flips to 'disputed'.
  IF v_status = 'in_run' THEN
    UPDATE commissions
       SET status         = 'disputed',
           run_id         = NULL,
           dispute_reason = COALESCE(p_dispute_reason, 'Dispute raised'),
           disputed_at    = now(),
           disputed_by    = 'branch',
           resolved_at    = NULL,
           resolved_by    = NULL,
           outcome_reason = NULL
     WHERE id = p_commission_id;
  ELSE
    UPDATE commissions
       SET status         = 'disputed',
           dispute_reason = COALESCE(p_dispute_reason, 'Dispute raised'),
           disputed_at    = now(),
           disputed_by    = 'branch',
           resolved_at    = NULL,
           resolved_by    = NULL,
           outcome_reason = NULL
     WHERE id = p_commission_id;
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- approve_dispute(commission_id text, outcome_reason text DEFAULT NULL) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#approveDispute (line 785).
-- Allowed role: distributor.
--
-- Resolves a dispute in the agent's favour. Behaviour depends on the line's
-- pre-dispute state (commissions.previous_status, set by the BEFORE-UPDATE
-- trigger when the dispute was raised):
--
--   * previous_status in ('released','confirmed') — POST-payment dispute.
--     Restore the previous status; the payment record stands. The
--     distributor re-issues offline; outcome_reason captures what was done.
--   * Otherwise (or NULL) — PRE-payment dispute. Status → 'due', run_id
--     cleared so the next open_run can pick the line up again. NULL
--     previous_status falls into this branch and uses 'due' (mirrors JS at
--     line 793).
--
-- Guards:
--   * Commission must exist.
--   * Status must be 'disputed'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_dispute(p_commission_id text, p_outcome_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := auth.jwt() ->> 'app_role';
  v_status commission_status;
  v_prev   commission_status;
BEGIN
  IF v_role IS DISTINCT FROM 'distributor' THEN
    RAISE EXCEPTION 'role % cannot approve a dispute', v_role
      USING ERRCODE = 'P0001';
  END IF;

  SELECT status, previous_status INTO v_status, v_prev
    FROM commissions WHERE id = p_commission_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Commission not found: %', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'disputed' THEN
    RAISE EXCEPTION 'Commission % is not disputed (status: %)', p_commission_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_prev IN ('released', 'confirmed') THEN
    -- Post-payment: restore the released/confirmed status. Keep run_id,
    -- txn_ref, paid_date untouched (we never cleared them at dispute time).
    UPDATE commissions
       SET status         = v_prev,
           previous_status = NULL,
           dispute_reason = NULL,
           resolved_at    = now(),
           resolved_by    = 'Distributor admin',
           outcome_reason = p_outcome_reason
     WHERE id = p_commission_id;
  ELSE
    -- Pre-payment (or unknown previous_status): bounce back to 'due' so the
    -- next open_run can include it again.
    UPDATE commissions
       SET status         = 'due',
           run_id         = NULL,
           previous_status = NULL,
           dispute_reason = NULL,
           resolved_at    = now(),
           resolved_by    = 'Distributor admin',
           outcome_reason = p_outcome_reason
     WHERE id = p_commission_id;
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- reject_dispute(commission_id text, outcome_reason text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#rejectDispute (line 813).
-- Allowed role: distributor.
--
-- Resolves a dispute against the agent. Behaviour depends on
-- previous_status (set by trigger):
--
--   * previous_status in ('released','confirmed') — POST-payment dispute.
--     Restore the previous status; the release record stands (proof of
--     payment exists). outcome_reason explains the resolution.
--   * Otherwise — PRE-payment dispute. Status → 'rejected' (commission is
--     voided), run_id cleared.
--
-- outcome_reason is required (no DEFAULT) — rejecting a dispute without
-- explaining why would be poor audit hygiene.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_dispute(p_commission_id text, p_outcome_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := auth.jwt() ->> 'app_role';
  v_status commission_status;
  v_prev   commission_status;
BEGIN
  IF v_role IS DISTINCT FROM 'distributor' THEN
    RAISE EXCEPTION 'role % cannot reject a dispute', v_role
      USING ERRCODE = 'P0001';
  END IF;

  SELECT status, previous_status INTO v_status, v_prev
    FROM commissions WHERE id = p_commission_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Commission not found: %', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'disputed' THEN
    RAISE EXCEPTION 'Commission % is not disputed (status: %)', p_commission_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_prev IN ('released', 'confirmed') THEN
    UPDATE commissions
       SET status         = v_prev,
           previous_status = NULL,
           dispute_reason = NULL,
           resolved_at    = now(),
           resolved_by    = 'Distributor admin',
           outcome_reason = p_outcome_reason
     WHERE id = p_commission_id;
  ELSE
    UPDATE commissions
       SET status         = 'rejected',
           run_id         = NULL,
           previous_status = NULL,
           dispute_reason = NULL,
           resolved_at    = now(),
           resolved_by    = 'Distributor admin',
           outcome_reason = p_outcome_reason
     WHERE id = p_commission_id;
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- withdraw_dispute(commission_id text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#withdrawDispute (line 758).
-- Allowed role: agent.
-- Agent scoping: agentId from JWT must match the commission's agent_id.
--
-- Agent withdraws their own pending dispute. Only allowed while the dispute
-- is still untouched by an admin (resolved_at IS NULL). Restores the line to
-- whatever previous_status was captured by the BEFORE-UPDATE trigger.
--
-- If previous_status is NULL (trigger missing or never ran) we fall back to
-- 'due' — mirrors JS default at line 763.
--
-- Guards:
--   * Caller must be role 'agent'.
--   * agentId claim must be present.
--   * Commission must exist.
--   * Commission's agent_id must match caller's agentId claim.
--   * Status must be 'disputed'.
--   * resolved_at must be NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION withdraw_dispute(p_commission_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text := auth.jwt() ->> 'app_role';
  v_agent    text := auth.jwt() ->> 'agentId';
  v_c_agent  text;
  v_status   commission_status;
  v_prev     commission_status;
  v_resolved timestamptz;
  v_restore  commission_status;
BEGIN
  IF v_role IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'role % cannot withdraw a dispute', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF v_agent IS NULL OR v_agent = '' THEN
    RAISE EXCEPTION 'agentId claim missing from JWT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT agent_id, status, previous_status, resolved_at
    INTO v_c_agent, v_status, v_prev, v_resolved
    FROM commissions WHERE id = p_commission_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Commission not found: %', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c_agent IS DISTINCT FROM v_agent THEN
    RAISE EXCEPTION 'Commission % does not belong to agent %', p_commission_id, v_agent
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'disputed' THEN
    RAISE EXCEPTION 'Commission % is not disputed', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_resolved IS NOT NULL THEN
    RAISE EXCEPTION 'Dispute on % is already resolved; cannot withdraw', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  v_restore := COALESCE(v_prev, 'due'::commission_status);

  UPDATE commissions
     SET status         = v_restore,
         previous_status = NULL,
         dispute_reason = NULL,
         disputed_at    = NULL,
         disputed_by    = NULL,
         resolved_at    = NULL,
         resolved_by    = NULL,
         outcome_reason = NULL
   WHERE id = p_commission_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- agent_confirm_commission(commission_id text) RETURNS void
-- -----------------------------------------------------------------------------
-- JS source: commissions.js#confirmCommission (line 849).
-- Allowed role: agent.
-- Agent scoping: agentId from JWT must match the commission's agent_id.
--
-- Agent confirms they received the released payment. Sets agent_confirmed
-- = TRUE and transitions status 'released' → 'confirmed'.
--
-- Idempotency: if the commission is already 'confirmed', this is a no-op
-- success (the agent re-tapped Confirm; we don't want to throw). For any
-- other status (due/in_run/held/disputed/rejected) we reject — the JS at
-- line 851 returns null for those, but a void RPC needs an explicit error
-- so the UI can surface "this commission has not been released yet".
--
-- Guards:
--   * Caller must be role 'agent'.
--   * agentId claim must be present.
--   * Commission must exist.
--   * Commission's agent_id must match caller's agentId claim.
--   * Status must be 'released' (acts) or 'confirmed' (no-op).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION agent_confirm_commission(p_commission_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    text := auth.jwt() ->> 'app_role';
  v_agent   text := auth.jwt() ->> 'agentId';
  v_c_agent text;
  v_status  commission_status;
BEGIN
  IF v_role IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'role % cannot confirm a commission', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF v_agent IS NULL OR v_agent = '' THEN
    RAISE EXCEPTION 'agentId claim missing from JWT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT agent_id, status INTO v_c_agent, v_status
    FROM commissions WHERE id = p_commission_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Commission not found: %', p_commission_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c_agent IS DISTINCT FROM v_agent THEN
    RAISE EXCEPTION 'Commission % does not belong to agent %', p_commission_id, v_agent
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent no-op for already-confirmed lines.
  IF v_status = 'confirmed' THEN
    RETURN;
  END IF;

  IF v_status <> 'released' THEN
    RAISE EXCEPTION 'Commission % is not released (status: %); nothing to confirm',
      p_commission_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE commissions
     SET status          = 'confirmed',
         agent_confirmed = TRUE
   WHERE id = p_commission_id;
END;
$$;


-- =============================================================================
-- End of 0004_commission_run_rpcs.sql
-- 13 functions, one per JS state transition. All SECURITY DEFINER. All claim
-- reads use auth.jwt() ->> '<claim>' — never auth.uid().
-- =============================================================================
