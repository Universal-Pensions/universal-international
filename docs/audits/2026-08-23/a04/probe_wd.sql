\set ON_ERROR_STOP off
\echo '======== PRE-STATE s-0004  (total 671179 / ret 536943 / emg 134236)'
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,units,round(invested,6) AS invested,
       round(retirement_units,6) ru, round(emergency_units,6) eu FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT 'nav' AS k, public.latest_nav() AS v;

\echo '======== W1 CHECK 4 — cost basis must fall by the REDEEMED UNIT FRACTION, not the shilling amount'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W1', 100000, 'emergency', 'audit probe', 'MTN', NULL, NULL) ->> 'id' AS wd_id;
RESET ROLE;
SELECT total_balance, retirement_balance, emergency_balance, round(units,10) units, round(invested,6) invested,
       round(retirement_units,6) ru, round(emergency_units,6) eu FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT 'expected_units_removed'  AS k, round(100000/public.latest_nav(),10) AS v
UNION ALL SELECT 'expected_unit_fraction', round((100000/public.latest_nav())/427.1217067764500730, 10)
UNION ALL SELECT 'expected_invested_after', round(609894.30570610624855296304056575900338214555549997862676716795804247414173397319423872 * (1 - (100000/public.latest_nav())/427.1217067764500730), 6)
UNION ALL SELECT 'naive_shilling_basis_would_be', round(609894.30570610624855296304056575900338214555549997862676716795804247414173397319423872 - 100000, 6);
ROLLBACK;

\echo '======== W2 withdrawal > total balance (expect REJECT)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W2', 99999999, 'emergency', 'x', 'MTN', NULL, NULL); ROLLBACK;

\echo '======== W3 withdrawal amount 0 / negative (expect REJECT)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W3', 0, 'emergency', 'x', 'MTN', NULL, NULL); ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W3b', -20000, 'emergency', 'x', 'MTN', NULL, NULL); ROLLBACK;

\echo '======== W4 withdrawal 4999 (BELOW MIN_WITHDRAW 5000)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W4', 4999, 'emergency', 'x', 'MTN', NULL, NULL) ->> 'amount' AS accepted; ROLLBACK;

\echo '======== W5 *** withdraw 400000 from bucket=emergency when emergency is only 134236 ***'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W5', 400000, 'emergency', 'x', 'MTN', NULL, NULL) ->> 'amount' AS accepted;
RESET ROLE;
SELECT total_balance, retirement_balance, emergency_balance,
       (retirement_balance + emergency_balance) AS bucket_sum,
       (retirement_balance + emergency_balance - total_balance) AS INVARIANT_BREAK,
       round(units,8) units FROM subscriber_balances WHERE subscriber_id='s-0004';
ROLLBACK;

\echo '======== W6 same amount, bucket=NULL (trigger emergency-first fallback) — control'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W6', 400000, NULL, 'x', 'MTN', NULL, NULL) ->> 'amount' AS accepted;
RESET ROLE;
SELECT total_balance, retirement_balance, emergency_balance,
       (retirement_balance + emergency_balance - total_balance) AS INVARIANT_BREAK FROM subscriber_balances WHERE subscriber_id='s-0004';
ROLLBACK;

\echo '======== W7 withdrawal NaN'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-W7', 'NaN'::numeric, 'emergency', 'x', 'MTN', NULL, NULL) ->> 'amount' AS accepted;
RESET ROLE;
SELECT total_balance, retirement_balance, emergency_balance, units, invested FROM subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;

\echo '======== POST-ROLLBACK RE-READ (must equal PRE-STATE)'
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,units,round(invested,6) AS invested,
       round(retirement_units,6) ru, round(emergency_units,6) eu FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT count(*) AS a04_nonces FROM money_nonces WHERE nonce LIKE 'A04-%';
SELECT count(*) AS a04_withdrawals FROM withdrawals WHERE reason='audit probe' OR reason='x';
