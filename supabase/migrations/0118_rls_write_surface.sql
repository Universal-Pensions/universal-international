-- 0118_rls_write_surface.sql
-- Phase 3 · P3-rls-writes — close the client WRITE surface on the money and
-- cover tables. Findings A02-001 … A02-008, A24-003, A05-015.
--
-- THE SHAPE THIS RESTORES
-- Every write that moves money or grants cover already has a SECURITY DEFINER
-- RPC that owns it: make_contribution, request_withdrawal,
-- fund_insurance_products, pay_insurance_premium, upsert_nominees,
-- submit_hospital_cash_claim, apply_settlement. Those RPCs carry the nonce
-- (money_nonces idempotency), the balance/bucket guards, the employer-funded
-- guard, and the audit trail. Alongside them the client kept a second, unguarded
-- door: a set of `*_insert_self` / `*_update_self` RLS policies whose WITH CHECK
-- pins WHO the row belongs to and says nothing about WHAT the row is. This
-- migration removes that second door wherever nothing uses it, and constrains it
-- to the exact shape the app needs where something does.
--
-- ── A02-001 (the critical one) ──────────────────────────────────────────────
-- `transactions_insert_self` let a subscriber JWT POST straight to
-- /rest/v1/transactions. Proven live under BEGIN..ROLLBACK: a fabricated
-- 999,000,000 UGX 'contribution' for s-0002 fired
-- transactions_after_insert_contribution and took the member from
-- 110.93 units / 174,314 UGX to 635,849 units / 999,174,314 UGX — and because
-- the trigger writes subscriber_balances, the fabricated money propagated into
-- every agent, branch, distributor and admin rollup.
--
-- DECISION: revoke direct INSERT entirely rather than narrow the policy.
-- The audit's suggested fix was to narrow WITH CHECK to
-- `type = 'premium' AND amount >= 0 AND source = 'own'`. Rejected, for four
-- reasons:
--   1. A 'premium' row is still money. At 999,000,000 UGX it still corrupts the
--      Insurance Statement report and the premiums-paid totals; it just stops
--      moving subscriber_balances. Narrowing the type moves the blast radius,
--      it does not remove it.
--   2. RLS WITH CHECK cannot express the invariant that actually matters — that
--      the amount equals 12 × the premium_monthly stored on the member's own
--      policy row. Only a DEFINER function can derive the amount server-side
--      instead of trusting the caller's number.
--   3. It leaves no nonce. Every other money path is idempotent on money_nonces;
--      a client INSERT is a replayable debit/credit with a client-chosen txn_ref.
--   4. It makes the whole money model hang on one string comparison in a policy:
--      `type` is a privilege boundary because two AFTER INSERT triggers switch on
--      it. That is a fragile place to put a security control.
-- The cost of revoking is zero: exactly one frontend path used this policy
-- (src/services/subscriber.js renewPolicy), it is rerouted in the same change to
-- fund_insurance_products, and every other transactions write already runs
-- inside a DEFINER RPC (current_user = postgres there, so the revoke cannot
-- reach them).
--
-- ── A02-002 (insurance cover) ───────────────────────────────────────────────
-- Neither insurance_policies nor subscriber_insurance_products had an
-- editable-column trigger, and both `*_update_self` policies pin only
-- subscriber_id. Proven live: a subscriber JWT set cover 1,000,000 →
-- 500,000,000, premium_monthly 2,000 → 0 and status → 'active'.
--
-- One of the two client write paths is genuine and must keep working:
-- `updateInsuranceCover` (src/services/subscriber.js) is the free DOWNGRADE —
-- lowering cover costs nothing, so it writes directly instead of taking a money
-- RPC. Upgrades already go through fund_insurance_products.
-- Consequently the fix here is NOT a blanket revoke but the codebase's own
-- guard-trigger pattern (trg_subscribers_enforce_editable_cols, 0006;
-- trg_distributors_enforce_editable_cols, 0081), extended from column
-- immutability to the value invariant that defines a downgrade:
--   • cover and premium_monthly may only go DOWN
--   • a policy may not be raised into force ('active'/'building') by a client
--   • renewal_date, policy_start, funded_by, subscriber_id (and product) are not
--     the downgrade path's to set
--   • employer-funded cover is untouchable from the client, exactly as
--     fund_insurance_products and pay_insurance_premium already enforce
-- The trigger policies CLIENT sessions only. Inside a SECURITY DEFINER RPC
-- `current_user` is the function owner (postgres), so fund_insurance_products,
-- pay_insurance_premium, apply_group_insurance, update_employer_profile and the
-- 0072 accrual sweep in trg_transactions_contribution all pass through
-- untouched. Verified live before writing this file: a direct client UPDATE
-- reports current_user=authenticated, the same UPDATE issued from inside
-- fund_insurance_products reports current_user=postgres.
--
-- ── A02-003 (contribution_schedules columns) ────────────────────────────────
-- 0072 already tried this, with
--   REVOKE UPDATE (insurance_funding_mode, …) ON public.contribution_schedules
-- and it has been a silent no-op ever since. Postgres: "if a role has been
-- granted privileges on a table, then revoking the same privileges from
-- individual columns will have no effect." `authenticated` holds a TABLE-level
-- UPDATE grant on contribution_schedules (Supabase's default GRANT ALL), so the
-- column REVOKE never bit — which is why the audit still finds all 15 columns
-- writable. The working pattern is the one already on public.subscribers:
-- revoke UPDATE at TABLE level first, then grant it back column by column.
--
-- ── A02-004 / A02-005 (writes that bypass an RPC that already exists) ───────
-- withdrawals_insert_self, the three nominees_*_self policies and
-- subscribers_insert_agent are all dead: requestWithdrawal calls
-- request_withdrawal, updateNominees calls upsert_nominees (which enforces the
-- sum-to-100 invariant the direct writes never did), and agent onboarding calls
-- create_subscriber_from_agent_onboard. Dropped, with the table grants that
-- backed them.
-- NOT dropped: agents_insert_branch, agents_update_branch,
-- branches_insert_distributor, branches_update_distributor,
-- distributors_update_self. The audit proposed dropping these six as a set; five
-- of them are load-bearing — src/services/entities.js createBranch, createAgent,
-- updateBranch, updateDistributor and setAgentStatus are direct client writes
-- with no RPC behind them. Dropping them would break branch, agent and
-- distributor management. The remaining half of A02-005 is a docs correction
-- (docs/BACKEND.md:601, docs/role-permissions.md:250 claim "no client write
-- policies"), which is outside this migration's scope.
--
-- ── A02-006 (read gap) ─────────────────────────────────────────────────────
-- subscriber_insurance_products carried only the self + agent SELECT policies;
-- the four that 0064/0065 forgot are added here, cloned from the live
-- insurance_policies_select_* definitions.
--
-- ── A02-008 / A24-003 (same defect, one fix) ───────────────────────────────
-- Postgres OR-evaluates every permissive SELECT policy, so an anon read of any
-- table whose policy set mentions one of the RLS claim helpers hard-errors with
-- 42501 naming the function, instead of returning []. They are all claims
-- readers with no arguments: with no claims they return NULL / zero rows, so
-- granting anon EXECUTE discloses nothing and makes the anon surface uniformly
-- fail-closed-and-empty. It also removes a live trap —
-- src/services/supabaseClient.js treats HTTP 401 as token expiry and forces a
-- logout, so the first logged-out feature to read branches would have bounced
-- the user to '/'.
-- CORRECTION TO THE FINDING: A02-008 names three helpers and A24-003 names one
-- of those. There are SEVEN in the policy set, and anon can execute none of
-- them — verified by joining pg_policy expressions against the zero-argument
-- functions in `public`. Granting only the three named leaves `branches` still
-- returning 42501, on `subscriber_branch_id`. All seven are granted below.
--
-- ── A05-015 (doc drift) ────────────────────────────────────────────────────
-- 0087's header claims it added an ownership guard to get_agent_commission_detail;
-- its body never re-emits that function. The behaviour is nevertheless correct,
-- but incidentally: the function is SECURITY INVOKER, so RLS on public.agents
-- makes its opening SELECT find nothing and it returns NULL. 0087's body is left
-- exactly as it is; the correction is recorded as a COMMENT on the live function,
-- where the next reader will actually meet it.
--
-- NOTHING HERE TOUCHES SELECT for authenticated roles. Every role reads what it
-- read before; A02-006 adds reads.
--
-- ── RELATIONSHIP TO 0114 ───────────────────────────────────────────────────
-- 0114 (P3-money-validator) adds `transactions_withdrawal_sign_chk`:
--   CHECK (type <> 'withdrawal' OR (amount <= 0 AND amount > '-Infinity'))
-- No object conflict — a named CHECK is additive and cannot clobber, or be
-- clobbered by, a policy or a grant. The two reinforce each other: 0114 puts a
-- floor under the transactions TABLE that holds whatever anyone later decides
-- about the policy surface, and 0118 removes the client's ability to reach that
-- table at all. Applying them in either order is safe; both were verified
-- together against live under BEGIN..ROLLBACK.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. transactions — money moves only through the RPCs   (A02-001, CRITICAL)
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS transactions_insert_self ON public.transactions;

-- No UPDATE or DELETE policy has ever existed on this table, so those two are
-- already dead by RLS; revoking them puts the privilege floor where the policy
-- set already is.
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. insurance cover — downgrade-only from a client session      (A02-002)
-- ───────────────────────────────────────────────────────────────────────────

-- 2a. subscriber_insurance_products: nothing in the app inserts these rows from
--     the client. fund_insurance_products and pay_insurance_premium create them
--     as DEFINER. Drop the policy and the grant.
DROP POLICY IF EXISTS sip_insert_self ON public.subscriber_insurance_products;
REVOKE INSERT, DELETE ON public.subscriber_insurance_products FROM anon, authenticated;

-- 2b. insurance_policies keeps its INSERT policy. updateInsuranceCover uses a
--     PostgREST upsert for life cover (a member who declined at signup has no
--     row), and INSERT ... ON CONFLICT DO UPDATE requires the INSERT policy's
--     WITH CHECK to pass on the proposed row even when the conflict resolves to
--     the UPDATE branch. The trigger below is what makes that lane safe.
REVOKE DELETE ON public.insurance_policies FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_insurance_policies_enforce_client_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Client sessions only. Inside a SECURITY DEFINER RPC current_user is the
  -- function owner (postgres), so every sanctioned insurance write is exempt.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A PostgREST upsert fires BEFORE INSERT even when it resolves to the
    -- DO UPDATE branch. When a row already exists this is that case: let it
    -- through and let the BEFORE UPDATE leg validate it against the true OLD.
    PERFORM 1 FROM public.insurance_policies WHERE subscriber_id = NEW.subscriber_id;
    IF FOUND THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'life cover is created by fund_insurance_products, not by a direct write'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.funded_by = 'employer' THEN
    RAISE EXCEPTION 'employer-funded cover cannot be changed from here'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.cover > OLD.cover THEN
    RAISE EXCEPTION
      'cover can only be lowered here — raising it goes through fund_insurance_products'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.premium_monthly > OLD.premium_monthly THEN
    RAISE EXCEPTION
      'premium can only be lowered here — raising it goes through fund_insurance_products'
      USING ERRCODE = 'P0001';
  END IF;

  -- Columns the downgrade path does not own. Coerced back to OLD rather than
  -- raised on: the client does not send them today, and a client that starts
  -- sending them should get the correct row, not an error in the member's face.
  NEW.subscriber_id := OLD.subscriber_id;
  NEW.funded_by     := OLD.funded_by;
  NEW.policy_start  := OLD.policy_start;
  NEW.renewal_date  := OLD.renewal_date;

  -- Status may be kept, or dropped to 'inactive' (cover lowered to nil). It may
  -- never be raised into force from a client write — that is what the premium
  -- buys, and only fund_insurance_products / pay_insurance_premium / the 0072
  -- accrual sweep may do it. Coerced, not raised, so lowering the cover on a
  -- 'building' policy still succeeds (updateInsuranceCover derives
  -- status = cover > 0 ? 'active' : 'inactive' and would otherwise send
  -- 'building' → 'active' for free).
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'inactive' THEN
    NEW.status := OLD.status;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sip_enforce_client_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- sip_insert_self is dropped above, so a client INSERT cannot reach this
  -- trigger through RLS. Kept fail-closed anyway, so re-adding the policy
  -- without re-reading this file cannot silently hand out free cover.
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION
      'insurance cover is created by fund_insurance_products, not by a direct write'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.funded_by = 'employer' THEN
    RAISE EXCEPTION 'employer-funded cover cannot be changed from here'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.cover > OLD.cover THEN
    RAISE EXCEPTION
      'cover can only be lowered here — raising it goes through fund_insurance_products'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.premium_monthly > OLD.premium_monthly THEN
    RAISE EXCEPTION
      'premium can only be lowered here — raising it goes through fund_insurance_products'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.subscriber_id := OLD.subscriber_id;
  NEW.product       := OLD.product;
  NEW.funded_by     := OLD.funded_by;
  NEW.policy_start  := OLD.policy_start;
  NEW.renewal_date  := OLD.renewal_date;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'inactive' THEN
    NEW.status := OLD.status;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS insurance_policies_enforce_client_writes ON public.insurance_policies;
CREATE TRIGGER insurance_policies_enforce_client_writes
  BEFORE INSERT OR UPDATE ON public.insurance_policies
  FOR EACH ROW EXECUTE FUNCTION public.trg_insurance_policies_enforce_client_writes();

DROP TRIGGER IF EXISTS sip_enforce_client_writes ON public.subscriber_insurance_products;
CREATE TRIGGER sip_enforce_client_writes
  BEFORE INSERT OR UPDATE ON public.subscriber_insurance_products
  FOR EACH ROW EXECUTE FUNCTION public.trg_sip_enforce_client_writes();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. contribution_schedules — the column lock 0072 intended       (A02-003)
-- ───────────────────────────────────────────────────────────────────────────

-- Table-level first (this is the step 0072 missed), then grant back exactly the
-- columns src/services/subscriber.js updateContributionSchedule writes.
-- `anon` gets nothing: a schedule belongs to a signed-in member.
REVOKE INSERT, UPDATE, DELETE ON public.contribution_schedules FROM anon, authenticated;

GRANT UPDATE (
  amount,
  frequency,
  retirement_pct,
  emergency_pct,
  include_insurance,
  insurance_choice_made,
  next_due_date,
  contribution_indexation_pct,
  updated_at
) ON public.contribution_schedules TO authenticated;

-- Deliberately NOT granted, i.e. now genuinely locked to the RPCs:
--   subscriber_id             — repointing a schedule at another member
--   insurance_funding_mode    — fund_insurance_products owns the save-to-cover switch
--   insurance_premium_target  — derived by fund_insurance_products from held cover
--   insurance_premium_accrued — driven by the 0072 sweep in trg_transactions_contribution
--   insurance_savings_pct     — fund_insurance_products owns the build speed
--   last_indexed_at           — stamped by the contribution trigger
-- The audit also listed include_insurance and insurance_choice_made for revoke;
-- those two ARE written by updateContributionSchedule (they carry the member's
-- own "do I want cover" answer and hold no money), so they stay granted.

-- ───────────────────────────────────────────────────────────────────────────
-- 4. withdrawals + nominees — dead policies behind live RPCs      (A02-004)
-- ───────────────────────────────────────────────────────────────────────────

-- requestWithdrawal has called the request_withdrawal DEFINER RPC since 0054
-- (balance check, bucket validation, nonce idempotency, atomic ledger + history
-- insert). The direct lane only ever let a fabricated payout request into the
-- agent / branch / distributor / admin queues.
DROP POLICY IF EXISTS withdrawals_insert_self ON public.withdrawals;
REVOKE INSERT, UPDATE, DELETE ON public.withdrawals FROM anon, authenticated;

-- updateNominees was rerouted to the upsert_nominees DEFINER RPC in an earlier
-- remediation (it DELETE+INSERTs in one transaction and enforces sum-to-100 per
-- category). These three policies have been unreachable from the app ever since
-- and are the only way nominee shares could drift off 100%.
DROP POLICY IF EXISTS nominees_insert_self ON public.nominees;
DROP POLICY IF EXISTS nominees_update_self ON public.nominees;
DROP POLICY IF EXISTS nominees_delete_self ON public.nominees;
REVOKE INSERT, UPDATE, DELETE ON public.nominees FROM anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. subscribers — the one dead hierarchy write policy            (A02-005)
-- ───────────────────────────────────────────────────────────────────────────

-- Agent onboarding calls create_subscriber_from_agent_onboard (DEFINER), which
-- validates NIN, phone and district and builds the balances/schedule chain. The
-- direct lane skipped all of it while still firing trg_subscribers_after_insert,
-- producing a half-formed but plausible-looking member.
-- subscribers_update_self stays: updateProfile is a real client write, already
-- column-locked (name, email, phone, occupation, consent_at) and guarded by
-- trg_subscribers_enforce_editable_cols.
DROP POLICY IF EXISTS subscribers_insert_agent ON public.subscribers;
REVOKE INSERT, DELETE ON public.subscribers FROM anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. subscriber_insurance_products — the four missing reads       (A02-006)
-- ───────────────────────────────────────────────────────────────────────────
-- Cloned from the live insurance_policies_select_* definitions, with the table
-- reference retargeted. 1,473 rows were invisible to branch, distributor,
-- employer and admin — a silent [] rather than an error, so a future
-- multi-product panel would have under-reported health/funeral cover with no
-- signal at all.

DROP POLICY IF EXISTS sip_select_admin ON public.subscriber_insurance_products;
CREATE POLICY sip_select_admin ON public.subscriber_insurance_products
  FOR SELECT TO public
  USING (((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'admin'::text));

DROP POLICY IF EXISTS sip_select_branch ON public.subscriber_insurance_products;
CREATE POLICY sip_select_branch ON public.subscriber_insurance_products
  FOR SELECT TO public
  USING ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'branch'::text) AND (EXISTS ( SELECT 1
     FROM (subscribers s
       JOIN agents a ON ((a.id = s.agent_id)))
    WHERE ((s.id = subscriber_insurance_products.subscriber_id) AND (a.branch_id = (( SELECT auth.jwt() AS jwt) ->> 'branchId'::text)))))));

DROP POLICY IF EXISTS sip_select_distributor ON public.subscriber_insurance_products;
CREATE POLICY sip_select_distributor ON public.subscriber_insurance_products
  FOR SELECT TO public
  USING ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'distributor'::text) AND (subscriber_id IN ( SELECT distributor_subscriber_ids() AS distributor_subscriber_ids))));

DROP POLICY IF EXISTS sip_select_employer ON public.subscriber_insurance_products;
CREATE POLICY sip_select_employer ON public.subscriber_insurance_products
  FOR SELECT TO public
  USING ((((( SELECT auth.jwt() AS jwt) ->> 'app_role'::text) = 'employer'::text) AND (EXISTS ( SELECT 1
     FROM subscribers s
    WHERE ((s.id = subscriber_insurance_products.subscriber_id) AND (s.employer_id = (( SELECT auth.jwt() AS jwt) ->> 'employerId'::text)))))));

-- ───────────────────────────────────────────────────────────────────────────
-- 7. anon reads return [] instead of 42501         (A02-008 = A24-003)
-- ───────────────────────────────────────────────────────────────────────────
-- Every one of the seven takes no arguments and resolves entirely from the JWT.
-- With no claims:
--   current_distributor_id()     → NULL       (reads the JWT only)
--   subscriber_agent_id()        → NULL       (subscribers WHERE id = NULL)
--   agent_branch_id()            → NULL       (agents WHERE id = NULL)
--   subscriber_branch_id()       → NULL       (agents WHERE id = NULL)
--   distributor_branch_ids()     → zero rows  (branches WHERE distributor_id = NULL)
--   distributor_agent_ids()      → zero rows
--   distributor_subscriber_ids() → zero rows
-- so anon learns nothing it could not already learn from an empty result set.

GRANT EXECUTE ON FUNCTION public.subscriber_agent_id()          TO anon;
GRANT EXECUTE ON FUNCTION public.subscriber_branch_id()         TO anon;
GRANT EXECUTE ON FUNCTION public.agent_branch_id()              TO anon;
GRANT EXECUTE ON FUNCTION public.current_distributor_id()       TO anon;
GRANT EXECUTE ON FUNCTION public.distributor_branch_ids()       TO anon;
GRANT EXECUTE ON FUNCTION public.distributor_agent_ids()        TO anon;
GRANT EXECUTE ON FUNCTION public.distributor_subscriber_ids()   TO anon;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. 0087's header vs get_agent_commission_detail's body          (A05-015)
-- ───────────────────────────────────────────────────────────────────────────
-- 0087's body is NOT touched. The correction lives where it is useful — on the
-- function itself.

COMMENT ON FUNCTION public.get_agent_commission_detail(text) IS
  'Distributor/admin agent commission detail. NOTE (A05-015, migration 0118): '
  '0087''s header claims it added an explicit ownership guard to this function. '
  'It did not — 0087''s body never re-emits it, and the live body is still 0029''s. '
  'The scoping is real but INCIDENTAL: the function is SECURITY INVOKER, so RLS on '
  'public.agents makes the opening SELECT ... INTO v_agent find nothing for an '
  'agent the caller does not own, and it returns NULL via IF NOT FOUND. '
  'If this function is ever converted to SECURITY DEFINER that protection '
  'disappears silently — add the explicit branch-ownership guard '
  '(distributor_branch_ids(), 0081) at the same time.';

COMMIT;
