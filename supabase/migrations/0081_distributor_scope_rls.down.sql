-- 0081_distributor_scope_rls.down.sql
-- Reverts the distributor role to the pre-0081 platform-wide read surface.
-- ⚠️ This re-opens the cross-tenant read: any distributor JWT will again see
-- every subscriber, every transaction, and the `users` credential store.

BEGIN;

DROP INDEX IF EXISTS public.subscribers_agent_id_id_idx;

DROP TRIGGER  IF EXISTS branches_default_distributor ON public.branches;
DROP FUNCTION IF EXISTS public.trg_branches_default_distributor();

-- distributors — back to any-authenticated.
DROP POLICY IF EXISTS distributors_select_admin ON public.distributors;
DROP POLICY IF EXISTS distributors_select_self  ON public.distributors;
CREATE POLICY distributors_select ON public.distributors
  FOR SELECT USING ((auth.jwt() ->> 'app_role') IS NOT NULL);

-- users — restore the table-wide grant the column-grant replaced.
GRANT SELECT, UPDATE ON public.users TO authenticated;

-- Recreate all 15 policies in their original unscoped form.
DROP POLICY IF EXISTS subscribers_select_distributor ON public.subscribers;
CREATE POLICY subscribers_select_distributor ON public.subscribers
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS subscriber_balances_select_distributor ON public.subscriber_balances;
CREATE POLICY subscriber_balances_select_distributor ON public.subscriber_balances
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS transactions_select_distributor ON public.transactions;
CREATE POLICY transactions_select_distributor ON public.transactions
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS withdrawals_select_distributor ON public.withdrawals;
CREATE POLICY withdrawals_select_distributor ON public.withdrawals
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS claims_select_distributor ON public.claims;
CREATE POLICY claims_select_distributor ON public.claims
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS nominees_select_distributor ON public.nominees;
CREATE POLICY nominees_select_distributor ON public.nominees
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS insurance_policies_select_distributor ON public.insurance_policies;
CREATE POLICY insurance_policies_select_distributor ON public.insurance_policies
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS contribution_schedules_select_distributor ON public.contribution_schedules;
CREATE POLICY contribution_schedules_select_distributor ON public.contribution_schedules
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS commissions_select_distributor ON public.commissions;
CREATE POLICY commissions_select_distributor ON public.commissions
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS settlement_batches_select_distributor ON public.settlement_batches;
CREATE POLICY settlement_batches_select_distributor ON public.settlement_batches
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

DROP POLICY IF EXISTS notifications_select_distributor ON public.notifications;
CREATE POLICY notifications_select_distributor ON public.notifications
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

CREATE POLICY users_select_distributor ON public.users
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');
CREATE POLICY contact_submissions_select_distributor ON public.contact_submissions
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');
CREATE POLICY agent_referrals_select_distributor ON public.agent_referrals
  FOR SELECT USING (((SELECT auth.jwt()) ->> 'app_role') = 'distributor');

-- Helpers last (policies above referenced them).
DROP FUNCTION IF EXISTS public.distributor_subscriber_ids();
DROP FUNCTION IF EXISTS public.distributor_agent_ids();
DROP FUNCTION IF EXISTS public.distributor_branch_ids();
DROP FUNCTION IF EXISTS public.current_distributor_id();

COMMIT;
