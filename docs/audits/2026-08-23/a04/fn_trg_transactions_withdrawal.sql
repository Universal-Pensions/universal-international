
DECLARE
  v_ret_take       NUMERIC;
  v_emg_take       NUMERIC;
  v_current_emg    NUMERIC;
  v_amount         NUMERIC := ABS(NEW.amount);  -- defensive: treat as magnitude
BEGIN
  -- Resolve the split first.
  IF NEW.split_retirement IS NOT NULL AND NEW.split_emergency IS NOT NULL THEN
    v_ret_take := NEW.split_retirement;
    v_emg_take := NEW.split_emergency;
  ELSE
    -- Read current emergency balance to compute the fallback.
    SELECT emergency_balance
      INTO v_current_emg
      FROM public.subscriber_balances
     WHERE subscriber_id = NEW.subscriber_id;

    v_current_emg := COALESCE(v_current_emg, 0);

    IF v_amount <= v_current_emg THEN
      v_emg_take := v_amount;
      v_ret_take := 0;
    ELSE
      v_emg_take := v_current_emg;
      v_ret_take := v_amount - v_current_emg;
    END IF;
  END IF;

  UPDATE public.subscriber_balances
     SET retirement_balance = GREATEST(0, retirement_balance - v_ret_take),
         emergency_balance  = GREATEST(0, emergency_balance  - v_emg_take),
         total_balance      = GREATEST(0, total_balance - v_amount),
         updated_at         = now()
   WHERE subscriber_id = NEW.subscriber_id;

  RETURN NEW;
END;

