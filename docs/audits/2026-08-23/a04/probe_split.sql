\set ON_ERROR_STOP off
\echo '======== PRE-STATE s-0004'
SELECT total_balance,retirement_balance,emergency_balance,round(units,8) units FROM subscriber_balances WHERE subscriber_id='s-0004';

\echo '======== S1 explicit splits that SUM to the amount but one leg is NEGATIVE'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.request_withdrawal('A04-S1', 100000, NULL, 'x', 'MTN', -100000, 200000) ->> 'amount' AS accepted;
RESET ROLE;
SELECT total_balance, retirement_balance, emergency_balance,
       (retirement_balance+emergency_balance-total_balance) AS invariant_break,
       round(units,8) units FROM subscriber_balances WHERE subscriber_id='s-0004';
ROLLBACK;

\echo '======== S2 CONTRIBUTION with p_retirement_pct = 200 (out of range)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-S2', 10000, 200, 'MTN') AS r; ROLLBACK;

\echo '======== S3 CONTRIBUTION with p_retirement_pct = NaN'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-S3', 10000, 'NaN'::numeric, 'MTN') AS r;
RESET ROLE;
SELECT total_balance,retirement_balance,emergency_balance,units FROM subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;

\echo '======== POST-ROLLBACK RE-READ'
SELECT total_balance,retirement_balance,emergency_balance,round(units,8) units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT count(*) AS a04_nonces FROM money_nonces WHERE nonce LIKE 'A04-%';
