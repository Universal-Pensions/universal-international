
  UPDATE public.subscriber_balances b
     SET retirement_units = r.ru,
         emergency_units  = b.units - r.ru
    FROM (
      SELECT CASE
               WHEN COALESCE(retirement_balance, 0) + COALESCE(emergency_balance, 0) > 0
                 THEN round(units * retirement_balance
                            / (retirement_balance + emergency_balance), 6)
               ELSE 0
             END AS ru
        FROM public.subscriber_balances
       WHERE subscriber_id = p_subscriber_id
    ) r
   WHERE b.subscriber_id = p_subscriber_id;

