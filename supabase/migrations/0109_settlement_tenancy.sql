-- 0109_settlement_tenancy.sql
-- A05-001 (CRITICAL) — `public.apply_settlement` had no tenancy check.
--
-- The 0081-0089 series bounded every commission READ to the caller's own
-- branches via `public.distributor_branch_ids()`. The one WRITE that moves
-- money was left gating on the caller's ROLE alone
-- (`IF v_role NOT IN ('distributor','admin')`, 0032:130, widened for admin by
-- 0051) and then trusted the caller-supplied `agentId` verbatim. Proven live
-- under BEGIN..ROLLBACK: a JWT claiming distributorId=d-002 settled agent
-- a-001, whose branch b-bui-001 belongs to d-001 — 2 commission lines flipped
-- to `paid`, 1 settlement_batches row landed in d-001's branch, and RLS hid
-- the whole thing from its own author.
--
-- Fix: one ownership predicate in the per-row loop, following the pattern 0087
-- established for the read RPCs — `admin` keeps the platform-wide view, and
-- `distributor` is bounded by `public.distributor_branch_ids()` (0081). A row
-- for an agent the caller does not own is SKIPPED with the new reason
-- `not_your_agent`, not fatal: one bad line in an upload must not abandon the
-- good ones mid-batch, and the distributor gets a per-row explanation in the
-- confirm modal (`SETTLEMENT_SKIP_REASONS` in src/utils/settlement.js).
--
-- The guard sits BEFORE the pending-dues lookup so a foreign (or non-existent)
-- agent id also leaks no pending totals, and so "not yours" and "doesn't
-- exist" are indistinguishable to the caller. It is fail-closed: a distributor
-- JWT with no `distributorId` claim owns no branches and can settle nothing.
--
-- Everything else in this body is byte-identical to the live definition
-- captured with pg_get_functiondef immediately before this migration was
-- written; only the block marked `0109` is new. CREATE OR REPLACE preserves
-- the owner and the existing EXECUTE grants.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_settlement(p_rows jsonb, p_nonce text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role           text := (SELECT auth.jwt()) ->> 'app_role';
  v_row            jsonb;
  v_agent_id       text;
  v_amount_paid    numeric;
  v_payment_ref    text;
  v_payment_date   date;
  v_branch_id      text;
  v_pending_total  numeric;
  v_line_count     integer;
  v_batch_id       text;
  v_skipped        jsonb := '[]'::jsonb;
  v_agents_settled integer := 0;
  v_lines_settled  integer := 0;
  v_total_paid     numeric := 0;
  v_remaining      numeric;
  v_settled_count  integer;
  v_settled_total  numeric;
  v_line           record;
  v_body           text;
  v_prior          jsonb;
  v_result         jsonb;
BEGIN
  IF v_role NOT IN ('distributor', 'admin') THEN
    RAISE EXCEPTION 'role % cannot apply a settlement', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    SELECT result INTO v_prior FROM public.settlement_uploads WHERE nonce = p_nonce;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  FOR v_row IN SELECT jsonb_array_elements(p_rows) LOOP
    v_agent_id     := v_row ->> 'agentId';
    v_amount_paid  := round((v_row ->> 'amountPaid')::numeric);
    v_payment_ref  := v_row ->> 'paymentRef';
    v_payment_date := COALESCE((v_row ->> 'paymentDate')::date, current_date);

    IF v_agent_id IS NULL OR v_agent_id = '' THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('agentId', v_agent_id, 'reason', 'missing_agent_id')
      );
      CONTINUE;
    END IF;

    -- ── 0109 · tenancy guard (A05-001) ──────────────────────────────────────
    -- A distributor may settle ONLY agents whose branch belongs to them.
    -- Mirrors the 0087 read-side pattern: admin stays platform-wide (0051),
    -- distributor is bounded by public.distributor_branch_ids() (0081).
    -- Fail-closed: an unknown agent id, an agent with no branch, or a
    -- distributor JWT carrying no distributorId all fall through to the skip.
    IF v_role = 'distributor'
       AND NOT EXISTS (
             SELECT 1
               FROM public.agents a
              WHERE a.id = v_agent_id
                AND a.branch_id IN (SELECT public.distributor_branch_ids())
           )
    THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('agentId', v_agent_id, 'reason', 'not_your_agent')
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(amount), 0), COUNT(*)
      INTO v_pending_total, v_line_count
      FROM public.commissions
     WHERE agent_id = v_agent_id
       AND status = 'due';

    IF v_line_count = 0 THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('agentId', v_agent_id, 'reason', 'no_due')
      );
      CONTINUE;
    END IF;

    SELECT branch_id INTO v_branch_id FROM public.agents WHERE id = v_agent_id;

    v_remaining     := v_amount_paid;
    v_settled_count := 0;
    v_settled_total := 0;

    FOR v_line IN
      SELECT id, amount
        FROM public.commissions
       WHERE agent_id = v_agent_id
         AND status = 'due'
       ORDER BY due_date ASC NULLS LAST, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining < v_line.amount;
      UPDATE public.commissions
         SET status      = 'paid',
             paid_date   = v_payment_date,
             txn_ref     = v_payment_ref,
             paid_amount = v_line.amount
       WHERE id = v_line.id;
      v_remaining     := v_remaining - v_line.amount;
      v_settled_count := v_settled_count + 1;
      v_settled_total := v_settled_total + v_line.amount;
    END LOOP;

    IF v_settled_count = 0 THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('agentId', v_agent_id, 'reason', 'amount_too_low')
      );
      CONTINUE;
    END IF;

    v_batch_id := 'sb-' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.settlement_batches (
      id, agent_id, branch_id, pending_total, paid_amount,
      txn_ref, paid_date, line_count, client_nonce
    ) VALUES (
      v_batch_id, v_agent_id, v_branch_id, v_pending_total, v_settled_total,
      v_payment_ref, v_payment_date, v_settled_count, NULLIF(p_nonce, '')
    );

    v_body := 'UGX ' || trim(to_char(v_settled_total, 'FM999,999,999,999'))
           || ' paid for ' || v_settled_count || ' '
           || CASE WHEN v_settled_count = 1 THEN 'commission' ELSE 'commissions' END
           || '.';

    INSERT INTO public.notifications (
      id, recipient_role, recipient_id, type, title, body, amount, ref_id
    ) VALUES (
      'ntf-' || replace(gen_random_uuid()::text, '-', ''),
      'agent',
      v_agent_id,
      'commission_settled',
      'Commission settled',
      v_body,
      v_settled_total,
      v_batch_id
    );

    IF v_branch_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        id, recipient_role, recipient_id, type, title, body, amount, ref_id
      ) VALUES (
        'ntf-' || replace(gen_random_uuid()::text, '-', ''),
        'branch',
        v_branch_id,
        'commission_settled',
        'Commission settled',
        v_body,
        v_settled_total,
        v_batch_id
      );
    END IF;

    v_agents_settled := v_agents_settled + 1;
    v_lines_settled  := v_lines_settled + v_settled_count;
    v_total_paid     := v_total_paid + v_settled_total;
  END LOOP;

  v_result := jsonb_build_object(
    'agentsSettled', v_agents_settled,
    'linesSettled',  v_lines_settled,
    'totalPaid',     v_total_paid,
    'skipped',       v_skipped
  );

  IF p_nonce IS NOT NULL AND p_nonce <> '' THEN
    INSERT INTO public.settlement_uploads (nonce, result)
    VALUES (p_nonce, v_result)
    ON CONFLICT (nonce) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$function$;

COMMIT;
