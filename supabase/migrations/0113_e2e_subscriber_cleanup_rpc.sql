-- =============================================================================
-- Universal Pensions Uganda — 0113: atomic E2E subscriber-tree cleanup RPC
-- =============================================================================
-- AUDIT A04-010 (medium, confirmed) — 4 leftover E2E subscribers ("TST tree
-- member" / "TST retag probe" / "TST employer member") surface on the admin
-- Needs Attention panel as `missing_balance` reconciliation exceptions during
-- a live demo:
--
--   $ psql … -c "select ref_id, who from v_reconciliation_exceptions
--                 where check_code='missing_balance' order by ref_id;"
--   tst-sub-emp-msc7vzsc   |TST employer member
--   tst-sub-retag-msc7vzsc|TST retag probe
--   tst-sub-tree-msc7vzsc |TST tree member
--   tst-sub-tree-msd3855c |TST tree member
--
-- ROOT CAUSE
-- e2e/fixtures/db.ts::cleanupSubscriberByPhone deleted every child-table row
-- (including subscriber_balances) and the parent `subscribers` row as
-- SEPARATE, non-atomic PostgREST round-trips (supabase-js has no
-- multi-statement transaction). A crash/timeout/assertion failure between the
-- last child delete and the parent delete leaves a subscriber row with no
-- subscriber_balances row — exactly the live shape above.
--
-- WHY NOT JUST REORDER (parent-first, relying on ON DELETE CASCADE)?
-- e2e/fixtures/db.ts's own doc-comment states the explicit child-loop exists
-- SPECIFICALLY so cleanup does not depend on cascades: "guarantee no orphans
-- linger if cascades are removed on a future migration". Deleting the parent
-- first and trusting CASCADE would restore atomicity (a single DML statement
-- is always atomic) but silently abandon that defense — the day a future
-- migration weakens a child FK to SET NULL/RESTRICT (as already happened for
-- employer_invites.subscriber_id and transactions.contribution_run_id — see
-- A06-002), cleanup would stop working with no warning. This RPC keeps BOTH
-- properties: it still deletes every child table explicitly (does not lean on
-- CASCADE), and it is atomic because the whole body runs inside the one
-- implicit transaction of a single function call.
--
-- CHILD-TABLE LIST — kept in lockstep with SUBSCRIBER_CHILD_TABLES +
-- SUBSCRIBER_ID_KEYED_TABLE in e2e/fixtures/db.ts (audit A06-010, same PR).
-- Includes the three tables that carry a real subscriber_id FK but were
-- missing from that list (money_nonces, employer_invites, entity_detach_log),
-- and the two 0105 NAV-migration snapshot tables, which have NO FK at all so
-- nothing else would ever clean them:
--   * subscriber_balances_pre_nav      — keyed on subscriber_id (no FK)
--   * subscribers_unit_value_pre_nav   — keyed on `id` (no FK) — bespoke
--
-- SAFETY OF THOSE TWO SNAPSHOT TABLES: they are do-not-drop rollback
-- artefacts for 0105_nav_backfill.down.sql — see that file's header. This RPC
-- never drops or truncates either table, and only ever deletes rows whose key
-- is in the caller-supplied `p_subscriber_ids` array, which the ONLY caller
-- (cleanupSubscriberByPhone) resolves strictly from
-- `subscribers WHERE phone = <the phone passed in>` — never a wildcard or
-- bulk predicate. A real subscriber's snapshot row can only be reached by
-- this function if that subscriber's own phone were passed in by the caller,
-- which is exactly the same blast radius cleanupSubscriberByPhone already had
-- against every other child table before this migration.
--
-- PRIVILEGE — this function grants NO new power. supabaseAdmin already holds
-- the service_role key, which bypasses RLS and can already delete from every
-- table touched here via plain PostgREST calls (that is what the pre-0113
-- code did). This RPC only makes the SAME operation atomic; REVOKE/GRANT
-- below still confine it to service_role so it can never be reached by a
-- live app session (anon/authenticated), matching CLAUDE.md's "all writes
-- flow through SECURITY DEFINER RPCs" convention.
--
-- ⚠️ NOT APPLIED TO LIVE. Phase 0 of the 2026-08-23 audit remediation commits
-- no live writes — this file is authored and escalated for a human (or a
-- later phase) to apply. e2e/fixtures/db.ts::cleanupSubscriberByPhone calls
-- this RPC and transparently falls back to the pre-0113 non-atomic behaviour
-- if it is not yet deployed (isMissingFunctionError), so nothing in the E2E
-- suite breaks while this migration is pending — the atomicity fix simply
-- activates the moment it is applied, no further code change required.
--
-- NUMBERING NOTE: originally authored as 0111, renamed to 0113 — 0111/0112
-- are committed Phase 2 migrations (0111_repair_settlement_ledger.sql,
-- 0112_clear_fixture_residue.sql) this agent did not know about when first
-- picking a number. Phase 3 now starts at 0114 per the integrator.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.e2e_delete_subscriber_tree(p_subscriber_ids text[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_subscriber_ids IS NULL OR array_length(p_subscriber_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Child tables first (FK-respecting order), all inside this function's own
  -- implicit transaction — either every delete below commits, or none do.
  DELETE FROM public.transactions                WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.nominees                     WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.subscriber_balances          WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.contribution_schedules       WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.insurance_policies           WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.subscriber_insurance_products WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.claims                       WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.withdrawals                  WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.commissions                  WHERE subscriber_id = ANY(p_subscriber_ids);
  -- A06-010 additions — real subscriber_id FK, previously uncleaned:
  DELETE FROM public.money_nonces                 WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.employer_invites             WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.entity_detach_log            WHERE subscriber_id = ANY(p_subscriber_ids);
  -- A06-010 additions — 0105 NAV snapshot tables, no FK, previously uncleaned:
  DELETE FROM public.subscriber_balances_pre_nav  WHERE subscriber_id = ANY(p_subscriber_ids);
  DELETE FROM public.subscribers_unit_value_pre_nav WHERE id = ANY(p_subscriber_ids); -- bespoke key

  DELETE FROM public.subscribers WHERE id = ANY(p_subscriber_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

-- REVOKE ALL … FROM PUBLIC before GRANT (0094/0099 convention: a bare REVOKE
-- FROM anon against a default PUBLIC grant is a silent no-op). This RPC is
-- test-harness-only tooling — never reachable by a live app session.
REVOKE ALL     ON FUNCTION public.e2e_delete_subscriber_tree(text[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.e2e_delete_subscriber_tree(text[]) TO service_role;

COMMENT ON FUNCTION public.e2e_delete_subscriber_tree(text[]) IS
  'Test-harness-only (E2E fixtures): atomically deletes a subscriber tree (every subscriber-FK child table + the parent subscribers row) in one transaction. Fixes A04-010. Never granted to anon/authenticated.';

COMMIT;
