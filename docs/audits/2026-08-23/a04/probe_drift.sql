\set ON_ERROR_STOP off
\echo '======== D1 numeric division scale actually produced by amount/NAV'
SELECT 5000/1571.4::numeric AS q, scale(5000/1571.4::numeric) AS result_scale,
       pg_typeof(5000/1571.4::numeric) AS t;
\echo '======== D2 accumulated drift: 10,000 x 5,000 UGX contributions, summed as the trigger does'
WITH s AS (SELECT sum(5000/1571.4::numeric) AS acc FROM generate_series(1,10000))
SELECT acc AS accumulated_units,
       (10000*5000)/1571.4::numeric AS exact_units,
       acc - (10000*5000)/1571.4::numeric AS unit_drift,
       round((acc - (10000*5000)/1571.4::numeric) * 1571.4, 12) AS drift_in_UGX
  FROM s;
\echo '======== D3 worst-case per-contribution rounding on the split (round to whole UGX)'
SELECT amt, round(amt*80/100) AS ret, amt - round(amt*80/100) AS emg,
       round(amt*80/100) + (amt - round(amt*80/100)) - amt AS split_residual
  FROM (VALUES (5001::numeric),(5002),(12345),(99999),(1)) v(amt);
\echo '======== D4 float columns anywhere in the money tables? (expect none)'
SELECT table_name, column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND data_type IN ('double precision','real')
 ORDER BY 1,2;
\echo '(empty above = no float money columns)'

\echo '======== D5 RESEED-SHAPE SIMULATION on s-0004 (what npm run seed leaves behind), then a NAV publish'
BEGIN;
\echo '-- pre'
SELECT total_balance, retirement_balance, emergency_balance, units, retirement_units, emergency_units, invested
  FROM subscriber_balances WHERE subscriber_id='s-0004';
\echo '-- write the seed shape: units = total/1000 (scripts/seed-supabase.mjs:78,81), and the columns the seed does NOT write take their column DEFAULTs (0)'
UPDATE subscriber_balances
   SET units = round((total_balance/1000)*100)/100,
       retirement_units = DEFAULT, emergency_units = DEFAULT, invested = DEFAULT, nav_as_of = NULL
 WHERE subscriber_id='s-0004';
SELECT total_balance, retirement_balance, emergency_balance, units, retirement_units, emergency_units, invested
  FROM subscriber_balances WHERE subscriber_id='s-0004';
\echo '-- now apply publish_nav_snapshot(2026-08-24, 1571.40) revaluation arithmetic VERBATIM (0106 body lines 72-79)'
UPDATE public.subscriber_balances
   SET total_balance      = round(units * 1571.40),
       retirement_balance = round(retirement_units * 1571.40),
       emergency_balance  = round(units * 1571.40) - round(retirement_units * 1571.40),
       nav_as_of          = DATE '2026-08-24',
       updated_at         = now()
 WHERE subscriber_id = 's-0004';
SELECT 'AFTER_PUBLISH' AS k, total_balance, retirement_balance, emergency_balance, units, invested
  FROM subscriber_balances WHERE subscriber_id='s-0004';
ROLLBACK;
\echo '======== POST-ROLLBACK RE-READ'
SELECT total_balance, retirement_balance, emergency_balance, units, retirement_units, emergency_units, round(invested,4) invested
  FROM subscriber_balances WHERE subscriber_id='s-0004';
