\set ON_ERROR_STOP off
\set SUB 's-0004'
\echo '======== PRE-STATE s-0004'
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,units,round(invested,4) AS invested FROM subscriber_balances WHERE subscriber_id='s-0004';

\echo '======== G1 contribution amount = 0 (expect REJECT)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-G1', 0, 80, 'MTN'); ROLLBACK;

\echo '======== G2 contribution amount = -50000 (expect REJECT)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-G2', -50000, 80, 'MTN'); ROLLBACK;

\echo '======== G3 contribution amount = 1 (BELOW MIN_CONTRIBUTION 5000)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-G3', 1, 80, 'MTN') ->> 'amount' AS accepted_amount; ROLLBACK;

\echo '======== G4 contribution amount = 0.004 (SUB-SHILLING)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-G4', 0.004, 80, 'MTN') AS result;
SELECT total_balance, retirement_balance, emergency_balance, units FROM public.subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;

\echo '======== G5 contribution amount = NaN'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-G5', 'NaN'::numeric, 80, 'MTN') AS result;
SELECT total_balance, retirement_balance, emergency_balance, units, invested FROM public.subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;

\echo '======== G6 contribution amount = Infinity'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-G6', 'Infinity'::numeric, 80, 'MTN') AS result; ROLLBACK;

\echo '======== G7 contribution amount = 1e30 (overflow-ish)'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"s-0004","role":"authenticated","app_role":"subscriber","subscriberId":"s-0004"}',true);
SELECT public.make_contribution('A04-G7', 1e30::numeric, 80, 'MTN') ->> 'amount' AS accepted;
SELECT total_balance, units FROM public.subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;

\echo '======== POST-ROLLBACK RE-READ (must equal PRE-STATE)'
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,units,round(invested,4) AS invested FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT count(*) AS a04_nonces FROM money_nonces WHERE nonce LIKE 'A04-%';
