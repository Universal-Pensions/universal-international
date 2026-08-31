-- 0150_close_pending_orphans_leak.sql
-- ============================================================================
-- A CROSS-TENANT PII LEAK INTRODUCED BY 0148, and the inert write grants that
-- came with 0143/0145. Found by auditing my own work, not by a report.
--
-- THE LEAK
-- --------
-- 0148 created `public.v_pending_pricing_orphans` and granted SELECT on it to
-- `authenticated`. Two things make that a hole rather than a convenience:
--
--   1. IT IS A VIEW, and a view does not have row-level security of its own.
--      Unless it is declared `security_invoker = true`, it executes with the
--      privileges of its OWNER — here `postgres`, which has rolbypassrls. So
--      every RLS policy protecting `transactions` and `subscribers` is bypassed
--      when reading through it.
--   2. It projects `subscriber_id`, the member's NAME, the transaction type and
--      the AMOUNT.
--
-- Net effect: any signed-in user of any role — a subscriber, an agent, an
-- employer — could read every other member's name and pending money with one
-- PostgREST call. `v_reconciliation_exceptions`, the sibling operator view this
-- one was modelled on, carries NO grants to anon or authenticated at all, and
-- that is exactly why it is safe. This one was written without checking that.
--
-- It has leaked nothing so far, and only because of an accident of timing: the
-- view selects `pricing_status = 'pending'`, and no row can be pending until
-- fund_dealing_config.pricing_enabled is turned on, which has not happened. It
-- would have started leaking on the first flip.
--
-- BOTH HALVES ARE FIXED, deliberately belt-and-braces:
--   * every API grant is revoked, matching v_reconciliation_exceptions;
--   * `security_invoker = true` is set anyway, so that IF someone re-grants it
--     later, the reader's own RLS applies instead of the owner's bypass.
--
-- THE INERT GRANTS
-- ----------------
-- `business_holidays`, `fund_dealing_config` and `nav_snapshot_versions` (0143,
-- 0145) each carry INSERT/UPDATE/DELETE for `authenticated`. Those are not mine
-- by intent — Supabase's default privileges grant all four to `authenticated`
-- at CREATE TABLE time, and each migration's `REVOKE ALL … FROM PUBLIC, anon`
-- did not name `authenticated`, so they survived.
--
-- They do NOTHING today: all three have FORCE RLS with a single admin-only
-- SELECT policy, and a table with RLS and no write policy denies every write.
-- 0132 named this shape precisely and is worth quoting rather than
-- paraphrasing: it is "a loaded trap for tomorrow: the day someone adds a
-- permissive policy, the stale grant goes live with it." Closed here at the
-- source.
--
-- SELECT is revoked too. Nothing in src/, api/, server/ or scripts/ reads any
-- of these three tables through PostgREST — verified by grep before writing
-- this. They are read only through SECURITY DEFINER helpers (dealing_date_for,
-- is_business_day, get_pending_pricing_summary), which bypass both grant and
-- policy by design. Granting SELECT bought nothing and widened the surface.
--
-- ROLLBACK: 0150_close_pending_orphans_leak.down.sql restores the grants
-- exactly as they were. It re-opens the leak, and says so.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The view: no API access, and RLS-respecting if it is ever re-granted
-- ─────────────────────────────────────────────────────────────────────────────
ALTER VIEW public.v_pending_pricing_orphans SET (security_invoker = true);
REVOKE ALL ON public.v_pending_pricing_orphans FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.v_pending_pricing_orphans IS
  'Operator-only. Every transaction still waiting for a price, with how many BUSINESS days it has waited. Reachable through service_role or psql ONLY - it projects member names and amounts across every tenant, so it must never be granted to anon or authenticated. security_invoker is set so that a future accidental grant still respects the reader''s RLS instead of the owner''s bypass.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The three config/reference tables: close the inert write grants
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.business_holidays     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fund_dealing_config   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.nav_snapshot_versions FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Guards — the same two 0132 asserts, re-run over what this migration owns
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad TEXT;
BEGIN
  -- GUARD 1 — no table this work introduced may be missing RLS.
  SELECT string_agg(c.relname, ', ') INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('business_holidays','fund_dealing_config','nav_snapshot_versions','_pre_unitization_balances')
     AND NOT c.relrowsecurity;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: table(s) without RLS: %', v_bad USING ERRCODE = 'P0001';
  END IF;

  -- GUARD 2 — nothing this work introduced is readable through the API.
  SELECT string_agg(DISTINCT g.table_name, ', ') INTO v_bad
    FROM information_schema.role_table_grants g
   WHERE g.table_schema = 'public'
     AND g.grantee IN ('anon', 'authenticated')
     AND g.table_name IN ('business_holidays','fund_dealing_config','nav_snapshot_versions',
                          '_pre_unitization_balances','v_pending_pricing_orphans');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: object(s) still API-reachable: %', v_bad USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE '0150 OK - pending-orphans view is operator-only; no unitization object is API-reachable';
END $$;
