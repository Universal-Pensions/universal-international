-- 0118_rls_write_surface.down.sql
-- Reverts 0118 exactly to the state that was LIVE immediately before it.
--
-- PROVENANCE. Every policy body below was captured from the live catalogue with
-- pg_get_expr(pol.polqual/polwithcheck) on project ilkhfnoyxlxwqadebnkp
-- (2026-08-25) and pasted verbatim — not retyped from 0003/0007/0054/0064. The
-- table ACLs restored below were read the same way, from pg_class.relacl:
--   transactions                  anon,authenticated = arwdDxtm
--   withdrawals                   anon,authenticated = arwdDxtm
--   nominees                      anon,authenticated = arwdDxtm
--   contribution_schedules        anon,authenticated = arwdDxtm
--   insurance_policies            anon,authenticated = arwdDxtm
--   subscriber_insurance_products anon,authenticated = arwdDxtm
--   subscribers                   anon,authenticated = ardDxtm   (no UPDATE)
-- (a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER
--  m=MAINTAIN). This file restores only the a/w/d bits 0118 removed; the
-- D/x/t/m bits are 0119's business and are untouched here.
--
-- WARNING — reverting re-opens A02-001 (a subscriber JWT can POST straight to
-- /rest/v1/transactions and credit itself any amount, which the contribution
-- trigger then propagates into every branch, distributor and admin rollup),
-- A02-002 (a subscriber can raise its own insurance cover to any figure at zero
-- premium and flip it active), A02-003, A02-004, the dead half of A02-005,
-- A02-006 and A02-008/A24-003.
--
-- ORDER MATTERS. `updateInsuranceCover` and `renewPolicy` in
-- src/services/subscriber.js must be reverted TOO if this file is run — 0118
-- shipped with renewPolicy rerouted onto the fund_insurance_products RPC. That
-- reroute is harmless with these grants restored (the RPC keeps working), so
-- this file is safe to run on its own; the frontend simply keeps using the RPC.

BEGIN;

-- ── 8. A05-015 comment ─────────────────────────────────────────────────────
-- The function carried no comment before 0118.
COMMENT ON FUNCTION public.get_agent_commission_detail(text) IS NULL;

-- ── 7. anon EXECUTE on the seven RLS helpers (A02-008 / A24-003) ───────────
-- None of the seven carried an anon grant before 0118 — pg_proc.proacl read
-- `postgres=X/postgres authenticated=X/postgres service_role=X/postgres` for all
-- seven, verbatim, on 2026-08-25.
REVOKE EXECUTE ON FUNCTION public.subscriber_agent_id()        FROM anon;
REVOKE EXECUTE ON FUNCTION public.subscriber_branch_id()       FROM anon;
REVOKE EXECUTE ON FUNCTION public.agent_branch_id()            FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_distributor_id()     FROM anon;
REVOKE EXECUTE ON FUNCTION public.distributor_branch_ids()     FROM anon;
REVOKE EXECUTE ON FUNCTION public.distributor_agent_ids()      FROM anon;
REVOKE EXECUTE ON FUNCTION public.distributor_subscriber_ids() FROM anon;

-- ── 6. the four subscriber_insurance_products SELECT policies (A02-006) ────
DROP POLICY IF EXISTS sip_select_admin       ON public.subscriber_insurance_products;
DROP POLICY IF EXISTS sip_select_branch      ON public.subscriber_insurance_products;
DROP POLICY IF EXISTS sip_select_distributor ON public.subscriber_insurance_products;
DROP POLICY IF EXISTS sip_select_employer    ON public.subscriber_insurance_products;

-- ── 5. subscribers (A02-005) ───────────────────────────────────────────────
GRANT INSERT, DELETE ON public.subscribers TO anon, authenticated;

CREATE POLICY subscribers_insert_agent ON public.subscribers FOR INSERT TO public
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'agent'::text) AND (agent_id = (( SELECT auth.jwt() AS jwt) ->> 'agentId'::text))));

-- ── 4. withdrawals + nominees (A02-004) ────────────────────────────────────
GRANT INSERT, UPDATE, DELETE ON public.withdrawals TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.nominees    TO anon, authenticated;

CREATE POLICY withdrawals_insert_self ON public.withdrawals FOR INSERT TO public
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'subscriber'::text) AND (subscriber_id = (( SELECT auth.jwt() AS jwt) ->> 'subscriberId'::text))));

CREATE POLICY nominees_insert_self ON public.nominees FOR INSERT TO public
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'subscriber'::text) AND (subscriber_id = (( SELECT auth.jwt() AS jwt) ->> 'subscriberId'::text))));

CREATE POLICY nominees_update_self ON public.nominees FOR UPDATE TO public
  USING ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'subscriber'::text) AND (subscriber_id = (( SELECT auth.jwt() AS jwt) ->> 'subscriberId'::text))))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'subscriber'::text) AND (subscriber_id = (( SELECT auth.jwt() AS jwt) ->> 'subscriberId'::text))));

CREATE POLICY nominees_delete_self ON public.nominees FOR DELETE TO public
  USING ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'subscriber'::text) AND (subscriber_id = (( SELECT auth.jwt() AS jwt) ->> 'subscriberId'::text))));

-- ── 3. contribution_schedules (A02-003) ────────────────────────────────────
-- Drop the column grants first, then restore the table-level grant. A stray
-- column ACL left behind alongside a table grant is exactly the confusing state
-- 0072 created.
REVOKE UPDATE (
  amount,
  frequency,
  retirement_pct,
  emergency_pct,
  include_insurance,
  insurance_choice_made,
  next_due_date,
  contribution_indexation_pct,
  updated_at
) ON public.contribution_schedules FROM authenticated;

GRANT INSERT, UPDATE, DELETE ON public.contribution_schedules TO anon, authenticated;

-- ── 2. insurance cover (A02-002) ───────────────────────────────────────────
DROP TRIGGER IF EXISTS insurance_policies_enforce_client_writes ON public.insurance_policies;
DROP TRIGGER IF EXISTS sip_enforce_client_writes                ON public.subscriber_insurance_products;
DROP FUNCTION IF EXISTS public.trg_insurance_policies_enforce_client_writes();
DROP FUNCTION IF EXISTS public.trg_sip_enforce_client_writes();

GRANT DELETE         ON public.insurance_policies            TO anon, authenticated;
GRANT INSERT, DELETE ON public.subscriber_insurance_products TO anon, authenticated;

CREATE POLICY sip_insert_self ON public.subscriber_insurance_products FOR INSERT TO public
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'subscriber'::text) AND (subscriber_id = (( SELECT auth.jwt() AS jwt) ->> 'subscriberId'::text))));

-- ── 1. transactions (A02-001) ──────────────────────────────────────────────
GRANT INSERT, UPDATE, DELETE ON public.transactions TO anon, authenticated;

CREATE POLICY transactions_insert_self ON public.transactions FOR INSERT TO public
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'subscriber'::text) AND (subscriber_id = (( SELECT auth.jwt() AS jwt) ->> 'subscriberId'::text))));

COMMIT;
