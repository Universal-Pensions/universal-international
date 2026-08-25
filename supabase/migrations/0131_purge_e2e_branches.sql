-- 0131_purge_e2e_branches.sql
-- ============================================================================
-- Phase 2 tail · A12-I01 — remove the two E2E-leftover branch rows from live.
--
-- Measured live 2026-08-25 (re-asserted by the guards below before any delete):
--   b-new-1785700420016  "E2E Branch 1785700415857"  d-kampala  d-001  2026-08-02
--   b-new-1785753024670  "E2E Branch 1785753020590"  d-kampala  d-001  2026-08-03
--
-- ⚠️ WHY AN EXPLICIT FROZEN ID LIST AND NOT `name LIKE 'E2E%'` ⚠️
-- The same reasoning as 0110's EMP- prefix: a NAME PREFIX IS NOT A RESIDUE
-- MARKER. Nothing stops a sales rep creating a branch called "E2E Demo" between
-- this file being written and it being applied, and a LIKE predicate would take
-- it out silently. The two ids are frozen and re-asserted immediately before the
-- delete; if the matching set is not exactly these two rows, this ABORTS.
--
-- ⚠️ THE `SET NULL` HAZARD ⚠️
-- `branches` is referenced by three foreign keys:
--     agents.branch_id             ON DELETE RESTRICT
--     commissions.branch_id        ON DELETE SET NULL
--     settlement_batches.branch_id ON DELETE SET NULL
-- The two SET NULL rules are the SAME MECHANISM that destroyed the provenance of
-- 1,824 of A04-009's orphan transactions: the parent went, the FK quietly
-- nulled, and the rows became unattributable. If either table referenced these
-- branches, deleting them would null those links and the undo below could not
-- restore the association. Measured 2026-08-25: 0 rows in all three, plus 0
-- users.entity_id breadcrumbs. The guards re-assert all four before deleting.
--
-- district_branch_count is already 8 for every Kampala row and there are 10 rows,
-- so these two are ALREADY excluded from the "#3 of 8" chip. Removing them
-- brings the row count into line with the count the UI has been showing all along
-- — it does not change any displayed figure. Verified in the post-guard.
--
-- APPLIED VIA the Supabase migration API, which supplies its own transaction.
-- The BEGIN/COMMIT below are the house convention for the psql path. They are
-- STRIPPED before applying — Postgres transactions do not nest, and an inner
-- COMMIT commits the caller's transaction. See scripts/psql-probe.sh.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- The frozen residue set.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _frozen_branches (id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _frozen_branches (id) VALUES
   ('b-new-1785700420016')
 ,('b-new-1785753024670');

-- ---------------------------------------------------------------------------
-- GUARD 1 — the frozen set must still match live exactly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_names text;
BEGIN
  SELECT count(*), string_agg(b.name, ' | ' ORDER BY b.id)
    INTO v_n, v_names
    FROM public.branches b JOIN _frozen_branches f ON f.id = b.id;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected 2 frozen E2E branches, found %. Re-measure.', v_n
      USING ERRCODE = 'P0001';
  END IF;
  IF v_names !~ '^E2E Branch ' THEN
    RAISE EXCEPTION 'ABORT: frozen ids no longer name E2E branches (got: %). A real branch may have reused an id.', v_names
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'guard 1 OK — 2 frozen E2E branches present: %', v_names;
END $$;

-- ---------------------------------------------------------------------------
-- GUARD 2 — nothing may reference them. All three FKs plus the non-FK
-- users.entity_id breadcrumb (there is no FK on it, so nothing would stop it
-- being orphaned silently).
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_agents int; v_comm int; v_batch int; v_users int;
BEGIN
  SELECT count(*) INTO v_agents FROM public.agents            WHERE branch_id IN (SELECT id FROM _frozen_branches);
  SELECT count(*) INTO v_comm   FROM public.commissions       WHERE branch_id IN (SELECT id FROM _frozen_branches);
  SELECT count(*) INTO v_batch  FROM public.settlement_batches WHERE branch_id IN (SELECT id FROM _frozen_branches);
  SELECT count(*) INTO v_users  FROM public.users             WHERE entity_id IN (SELECT id FROM _frozen_branches);
  IF v_agents <> 0 OR v_comm <> 0 OR v_batch <> 0 OR v_users <> 0 THEN
    RAISE EXCEPTION 'ABORT: E2E branches are referenced (agents=%, commissions=%, settlement_batches=%, users=%). Deleting would SET NULL real links.',
      v_agents, v_comm, v_batch, v_users USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'guard 2 OK — 0 agents, 0 commissions, 0 settlement_batches, 0 users reference them';
END $$;

-- ---------------------------------------------------------------------------
-- RECOVERY snapshot. Name matches the `%_pre_purge_%` convention that 0127's
-- sweep and its standing guard key on, so it cannot be left unsecured.
-- `CREATE TABLE … AS SELECT` inherits NO RLS, NO policies and NO grants — that
-- is exactly what produced four CRITICAL advisor findings, so it is secured
-- explicitly and immediately, in this same transaction.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branches_e2e_pre_purge_20260825 AS
SELECT b.* FROM public.branches b JOIN _frozen_branches f ON f.id = b.id;

ALTER TABLE public.branches_e2e_pre_purge_20260825 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches_e2e_pre_purge_20260825 FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.branches_e2e_pre_purge_20260825 FROM anon, authenticated;

COMMENT ON TABLE public.branches_e2e_pre_purge_20260825 IS
  'Phase 2 tail (A12-I01) pre-purge snapshot, 2026-08-25. RLS on, no policies, by design. DO NOT DROP.';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.branches_e2e_pre_purge_20260825;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: snapshot holds % row(s), expected 2. Refusing to delete without a complete undo.', v_n
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'snapshot OK — 2 rows captured, RLS enabled, anon/authenticated revoked';
END $$;

-- ---------------------------------------------------------------------------
-- The delete.
-- ---------------------------------------------------------------------------
DELETE FROM public.branches WHERE id IN (SELECT id FROM _frozen_branches);

-- ---------------------------------------------------------------------------
-- POST-GUARD — exactly 2 gone, Kampala consistent, no collateral.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_left int; v_kampala int; v_counts text; v_total int;
BEGIN
  SELECT count(*) INTO v_left FROM public.branches WHERE id IN (SELECT id FROM _frozen_branches);
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ABORT: % frozen row(s) survived the delete.', v_left USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*), string_agg(DISTINCT district_branch_count::text, ',')
    INTO v_kampala, v_counts
    FROM public.branches WHERE district_id = 'd-kampala';

  IF v_kampala <> 8 THEN
    RAISE EXCEPTION 'ABORT: Kampala has % branches after purge, expected 8.', v_kampala USING ERRCODE = 'P0001';
  END IF;
  IF v_counts <> '8' THEN
    RAISE EXCEPTION 'ABORT: Kampala district_branch_count is now inconsistent (%). The UI chip would drift.', v_counts
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_total FROM public.branches;
  RAISE NOTICE 'post-guard OK — Kampala row count 10 -> 8, matching the district_branch_count of 8 the UI already showed. % branches total.', v_total;
END $$;

COMMIT;
