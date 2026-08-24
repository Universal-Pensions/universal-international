
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

