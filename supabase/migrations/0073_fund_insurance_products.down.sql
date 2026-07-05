-- Down-migration for 0073_fund_insurance_products.sql
-- Drops the post-signup insurance funding RPC. No schema/data was altered by
-- 0073 (it only added a function), so this fully reverts it.
DROP FUNCTION IF EXISTS public.fund_insurance_products(text, text, jsonb, numeric, text);
