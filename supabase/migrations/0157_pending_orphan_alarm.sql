-- 0157_pending_orphan_alarm.sql
-- ============================================================================
-- THE ALARM THIS DESIGN RESTS ON WAS NEVER BUILT, and a legacy settlement could
-- eat a live payout. Both found by auditing 0147-0156.
--
-- 1. `pending_orphan` DID NOT EXIST.
--    The plan's section 7 specifies it. 0148's own comment says
--    v_pending_pricing_orphans "feeds the pending_orphan reconciliation check".
--    docs/runbooks/nav-publishing.md tells an operator to watch for it. Every
--    one of those was written against a check that no code ever created —
--    v_reconciliation_exceptions gained `pending_component_mismatch` and nothing
--    else. Confirmed on live: zero rows carry that check_code and the view
--    definition never mentions it.
--
--    It matters more than a missing metric usually would, because forward
--    dealing INVERTS the failure mode. Before it, a missing price silently
--    produced a WRONG number and nobody noticed for twelve days — which is
--    exactly the state the register was in when this work began. After it, a
--    missing price produces a visible queue of member money that has been
--    received and has bought nothing. That is strictly better ONLY if somebody
--    is told, and this is the telling. Shipping the inversion without the alarm
--    traded a silent wrong number for silent stuck money.
--
-- 2. settle_withdrawal COULD RELEASE SOMEONE ELSE'S PAYOUT.
--    For a withdrawal with no ledger link it fell back to releasing the FULL
--    withdrawal amount from pending_payout_emergency. For a pre-0152 row that
--    component is zero, and the GREATEST(0, ...) clamp made that look harmless —
--    but the clamp does not distinguish WHOSE payout it is eating. A member with
--    a live struck-but-unpaid redemption who also has one of the 15 unlinked
--    'processing' rows still on live would have had the legacy settlement
--    silently consume the real one's component, dropping their total for money
--    they were never paid.
--
--    A row predating the ledger link has no payout component by construction, so
--    releasing zero is not a compromise — it is the correct amount.
--
-- ROLLBACK: 0157_pending_orphan_alarm.down.sql removes the check and restores
-- the previous settle_withdrawal.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_reconciliation_exceptions AS
 SELECT 'user'::text AS kind,
    'missing_balance'::text AS check_code,
    'Member has no balance record'::text AS issue,
    s.id AS ref_id,
    s.name AS who,
    s.id AS subscriber_id,
    NULL::numeric AS amount,
    NULL::date AS occurred_on
   FROM subscribers s
     LEFT JOIN subscriber_balances b ON b.subscriber_id = s.id
  WHERE b.subscriber_id IS NULL
UNION ALL
 SELECT 'user'::text AS kind,
    'split_mismatch'::text AS check_code,
    'Retirement + emergency does not equal total balance'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    b.retirement_balance + b.emergency_balance - b.total_balance AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(b.retirement_balance + b.emergency_balance - b.total_balance) > 1::numeric
UNION ALL
 SELECT 'transaction'::text AS kind,
    'orphan_subscriber'::text AS check_code,
    'Transaction references a member that no longer exists'::text AS issue,
    t.id AS ref_id,
    COALESCE(t.subscriber_id, '—'::text) AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
  WHERE s.id IS NULL
UNION ALL
 SELECT 'transaction'::text AS kind,
    'orphan_run'::text AS check_code,
    'Transaction references a contribution run that no longer exists'::text AS issue,
    t.id AS ref_id,
    COALESCE(s.name, '—'::text) AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
     LEFT JOIN contribution_runs r ON r.id = t.contribution_run_id
  WHERE t.contribution_run_id IS NOT NULL AND r.id IS NULL
UNION ALL
 SELECT 'transaction'::text AS kind,
    'agent_mismatch'::text AS check_code,
    'Transaction credited to an agent who does not own this member'::text AS issue,
    t.id AS ref_id,
    s.name AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     JOIN subscribers s ON s.id = t.subscriber_id
  WHERE t.agent_id IS NOT NULL AND t.agent_id IS DISTINCT FROM s.agent_id
UNION ALL
 SELECT 'user'::text AS kind,
    'unit_split_mismatch'::text AS check_code,
    'Retirement + savings units do not add up to the member''s total units'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(COALESCE(b.retirement_units, 0::numeric) + COALESCE(b.emergency_units, 0::numeric) - b.units) > 0.000001
UNION ALL
 SELECT 'user'::text AS kind,
    'nav_mismatch'::text AS check_code,
    'Balance does not match the member''s units at the published unit price'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    b.total_balance - round(b.units * (( SELECT latest_nav() AS latest_nav))) AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE (( SELECT latest_nav() AS latest_nav)) IS NOT NULL AND abs(b.total_balance - round(b.units * (( SELECT latest_nav() AS latest_nav)))) > 1::numeric
UNION ALL
 SELECT 'user'::text AS kind,
    'negative_balance'::text AS check_code,
    'A balance or unit holding has gone below zero'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    LEAST(b.retirement_balance, b.emergency_balance, b.total_balance, b.units, COALESCE(b.invested, 0::numeric)) AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance < 0::numeric OR b.emergency_balance < 0::numeric OR b.total_balance < 0::numeric OR b.units < 0::numeric OR COALESCE(b.invested, 0::numeric) < 0::numeric OR COALESCE(b.retirement_units, 0::numeric) < '-0.000001'::numeric OR COALESCE(b.emergency_units, 0::numeric) < '-0.000001'::numeric OR b.pending_contribution_retirement < 0::numeric OR b.pending_contribution_emergency < 0::numeric OR b.pending_payout_retirement < 0::numeric OR b.pending_payout_emergency < 0::numeric OR b.pending_redemption_retirement < 0::numeric OR b.pending_redemption_emergency < 0::numeric
UNION ALL
 SELECT 'user'::text AS kind,
    'non_finite_balance'::text AS check_code,
    'A balance is not a real number'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    NULL::numeric AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE b.retirement_balance = 'NaN'::numeric OR b.emergency_balance = 'NaN'::numeric OR b.total_balance = 'NaN'::numeric OR b.units = 'NaN'::numeric OR COALESCE(b.invested, 0::numeric) = 'NaN'::numeric OR COALESCE(b.retirement_units, 0::numeric) = 'NaN'::numeric OR COALESCE(b.emergency_units, 0::numeric) = 'NaN'::numeric OR b.retirement_balance = 'Infinity'::numeric OR b.emergency_balance = 'Infinity'::numeric OR b.total_balance = 'Infinity'::numeric OR b.units = 'Infinity'::numeric
UNION ALL
 SELECT 'user'::text AS kind,
    'pending_component_mismatch'::text AS check_code,
    'Money recorded as in-process does not match the transactions behind it'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    b.pending_contribution_retirement + b.pending_contribution_emergency - COALESCE(l.pending_in, 0::numeric) AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(t.amount), 0::numeric) AS pending_in
           FROM transactions t
          WHERE t.subscriber_id = b.subscriber_id AND t.type = 'contribution'::text AND t.pricing_status = 'pending'::text) l ON true
  WHERE abs(b.pending_contribution_retirement + b.pending_contribution_emergency - COALESCE(l.pending_in, 0::numeric)) > 1::numeric
UNION ALL
 -- 0157: pending_orphan — THE alarm this whole design rests on, and it was
 -- never built. The plan's section 7 specifies it, 0148's own comment says
 -- v_pending_pricing_orphans "feeds the pending_orphan reconciliation check",
 -- and the runbook tells an operator to watch for it. Nothing implemented it.
 --
 -- It matters because forward dealing INVERTS the failure mode. Before it, a
 -- missing price silently produced a WRONG number and nobody noticed for days.
 -- After it, a missing price produces a visible queue of member money that has
 -- been received and has bought nothing. That is strictly better ONLY if
 -- somebody is told, and this is the telling.
 SELECT 'transaction'::text AS kind,
    'pending_orphan'::text AS check_code,
    'Member money has been waiting for a price longer than the fund allows'::text AS issue,
    t.id AS ref_id,
    s.name AS who,
    t.subscriber_id,
    t.amount,
    t.dealing_date AS occurred_on
   FROM transactions t
     JOIN subscribers s ON s.id = t.subscriber_id
     CROSS JOIN LATERAL ( SELECT COALESCE(max_pending_days, 3) AS lim
                            FROM fund_dealing_config WHERE fund_code = 'UPU-BAL') c
  WHERE t.pricing_status = 'pending'
    AND ( SELECT count(*) FROM generate_series(t.dealing_date, kampala_today(), '1 day'::interval) d
           WHERE is_business_day(d::date)) > c.lim;

CREATE OR REPLACE FUNCTION public.settle_withdrawal(p_withdrawal_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_wd  public.withdrawals%ROWTYPE;
  v_tx  public.transactions%ROWTYPE;
  v_ret NUMERIC;
  v_emg NUMERIC;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'app_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can settle a withdrawal' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wd FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No withdrawal %', p_withdrawal_id USING ERRCODE = 'P0001';
  END IF;
  IF v_wd.status <> 'processing' THEN
    RAISE EXCEPTION 'Withdrawal % is already %', p_withdrawal_id, v_wd.status USING ERRCODE = 'P0001';
  END IF;

  -- The ledger row is the authority for how much was actually struck, and for
  -- whether it has been struck at all.
  -- 0152: exact FK lookup. Matching on (subscriber_id, reference) resolved for
  -- exactly ONE of the 4,937 existing withdrawals, so this silently found no
  -- ledger row for essentially every historical settlement and skipped the
  -- not-yet-priced guard below without saying so.
  SELECT * INTO v_tx FROM public.transactions WHERE id = v_wd.transaction_id;

  -- A row written before 0152 carries no link. It also predates forward dealing,
  -- so it cannot be mid-pricing; settle it without the guard and say so here
  -- rather than letting a silent no-match look like a passed check.
  IF v_wd.transaction_id IS NULL THEN
    RAISE NOTICE 'withdrawal % predates the ledger link; settling without a pricing check', p_withdrawal_id;
  ELSIF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal % points at transaction % which no longer exists',
      p_withdrawal_id, v_wd.transaction_id USING ERRCODE = 'P0001';
  ELSIF v_tx.pricing_status = 'pending' THEN
    RAISE EXCEPTION 'Withdrawal % has not been priced yet - it deals on %',
      p_withdrawal_id, to_char(v_tx.dealing_date, 'YYYY-MM-DD') USING ERRCODE = 'P0001';
  END IF;

  -- 0157: an UNLINKED legacy row releases NOTHING.
  --
  -- The fallback used to be `COALESCE(v_tx.split_emergency, v_wd.amount)`, so a
  -- withdrawal with no ledger link fell back to releasing its FULL amount from
  -- pending_payout_emergency. For a pre-0152 row that component is zero and the
  -- GREATEST(0, ...) clamp made it look harmless — but the clamp does not
  -- distinguish WHOSE payout it is eating. A member with a live struck-but-
  -- unpaid redemption who also has one of the 15 unlinked 'processing' rows
  -- still on live would have had that legacy settlement silently consume the
  -- real one's payout component, and their total would drop for money they were
  -- never paid.
  --
  -- A row that predates the ledger link has no payout component by construction,
  -- so releasing zero is not a compromise — it is the correct amount.
  IF v_wd.transaction_id IS NULL THEN
    v_ret := 0;
    v_emg := 0;
  ELSE
    v_ret := COALESCE(v_tx.split_retirement, 0);
    v_emg := COALESCE(v_tx.split_emergency, abs(v_tx.amount) - COALESCE(v_tx.split_retirement, 0));
  END IF;

  -- Clamp to what is actually owed. A withdrawal struck before 0147 has no
  -- payout component to release, so this correctly releases nothing.
  UPDATE public.subscriber_balances
     SET pending_payout_retirement = GREATEST(0, pending_payout_retirement - v_ret),
         pending_payout_emergency  = GREATEST(0, pending_payout_emergency  - v_emg),
         updated_at = now()
   WHERE subscriber_id = v_wd.subscriber_id;

  UPDATE public.withdrawals SET status = 'paid' WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object(
    'id', p_withdrawal_id, 'status', 'paid',
    'releasedRetirement', v_ret, 'releasedEmergency', v_emg);
END;
$function$;

