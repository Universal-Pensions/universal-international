-- =============================================================================
-- DOWN — 0099: claims products + hospital-cash RPC
-- =============================================================================
-- Restores the direct-insert lane FIRST so the table is writable again the
-- moment the RPC goes, then drops the RPC, the constraints and the columns.
--
-- LOSSY: dropping the columns discards product / discharge_date / nights /
-- provider / daily_benefit on every row filed since 0099. The claim rows
-- themselves survive; their hospital-cash detail does not. `type` is untouched
-- throughout — rows written after 0099 keep 'health' there, which the legacy
-- label map renders as its product name.
-- =============================================================================

-- 1. Restore the pre-0099 INSERT policy (0007_rls_use_app_role.sql:528-534).
DROP POLICY IF EXISTS claims_insert_self ON public.claims;
CREATE POLICY claims_insert_self ON public.claims
  FOR INSERT WITH CHECK (
    (SELECT auth.jwt()) ->> 'app_role' = 'subscriber'
    AND subscriber_id = (SELECT auth.jwt()) ->> 'subscriberId'
  );

-- 2. Drop the RPC + its divisor helper.
DROP FUNCTION IF EXISTS public.submit_hospital_cash_claim(text, date, date, text, text);
DROP FUNCTION IF EXISTS public._hospital_cash_days();

-- 3. Constraints + index.
ALTER TABLE public.claims
  DROP CONSTRAINT IF EXISTS claims_discharge_after_admission_chk,
  DROP CONSTRAINT IF EXISTS claims_nights_chk,
  DROP CONSTRAINT IF EXISTS claims_product_chk;

DROP INDEX IF EXISTS public.claims_subscriber_product_date_idx;

-- 4. Columns.
ALTER TABLE public.claims
  DROP COLUMN IF EXISTS daily_benefit,
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS nights,
  DROP COLUMN IF EXISTS discharge_date,
  DROP COLUMN IF EXISTS product;

-- 5. Restore the original column comment (0099 rewrote it).
COMMENT ON COLUMN public.claims.incident_date IS NULL;
COMMENT ON COLUMN public.claims.type IS NULL;

-- money_nonces rows of kind 'claim' are left in place — harmless, and the same
-- choice 0063's down.sql makes for 'premium' nonces.
