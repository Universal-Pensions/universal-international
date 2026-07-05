-- Down: restore client EXECUTE on the legacy pay_insurance_premium RPC (matches
-- the grant last set by 0068/0064/0063). Reverses 0074.
GRANT EXECUTE ON FUNCTION public.pay_insurance_premium(text, text, numeric, numeric, text)
  TO authenticated;
