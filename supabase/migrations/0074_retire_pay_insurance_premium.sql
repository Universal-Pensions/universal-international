-- =============================================================================
-- Universal Pensions Uganda — 0074: retire the legacy pay_insurance_premium RPC.
-- =============================================================================
-- WHY: pay_insurance_premium (0063 → 0064 → 0068) is the last surviving path that
--   records a SELF-paid insurance premium at MONTHLY magnitude — it inserts a
--   type='premium', source='own' row with amount = p_premium, and its only caller
--   passed the MONTHLY rate. That contradicts the platform invariant that a
--   self-funded (funded_by='self') member pays insurance ONLY as a single ANNUAL
--   premium (pay_now → amount = premium_monthly * 12) or via save_to_cover
--   accrual — never a monthly out-of-pocket stream. Monthly premiums are legitimate
--   ONLY when the EMPLOYER funds them (type='insurance_premium', source='employer').
--
--   The subscriber InsurancePage activate/upgrade flow now routes through
--   fund_insurance_products (0073), which upserts the policy AND charges the
--   combined ANNUAL premium as one row — the correct, single self-pay code path.
--
-- WHAT: revoke EXECUTE so no client (authenticated/anon) can call the legacy RPC.
--   The function body is left in place (its 0068 employer-guard is harmless and
--   the historical down-migrations still reference it); only the grant is removed,
--   so a direct RPC call can no longer create a member-paid monthly premium row.
--
-- Forward-only; reversible via 0074_retire_pay_insurance_premium.down.sql.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.pay_insurance_premium(text, text, numeric, numeric, text)
  FROM authenticated, anon, PUBLIC;

-- =============================================================================
-- End of 0074_retire_pay_insurance_premium.sql
-- =============================================================================
