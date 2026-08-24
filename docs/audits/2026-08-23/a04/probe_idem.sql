\set ON_ERROR_STOP on
\echo '### PRE-STATE s-0002'
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,units,invested FROM subscriber_balances WHERE subscriber_id='s-0002';
SELECT count(*) AS txn_rows FROM transactions WHERE subscriber_id='s-0002';
SELECT count(*) AS nonce_rows FROM money_nonces WHERE nonce LIKE 'A04-%';

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"s-0002","role":"authenticated","app_role":"subscriber","subscriberId":"s-0002"}', true);
\echo '### CALL 1'
SELECT public.make_contribution('A04-IDEM-NONCE', 10000, 80, 'MTN Mobile Money') AS call1;
\echo '### CALL 2 (identical nonce)'
SELECT public.make_contribution('A04-IDEM-NONCE', 10000, 80, 'MTN Mobile Money') AS call2;
\echo '### CALL 3 (identical nonce, DIFFERENT amount 999999)'
SELECT public.make_contribution('A04-IDEM-NONCE', 999999, 80, 'MTN Mobile Money') AS call3;
RESET ROLE;
\echo '### EFFECT COUNT inside txn'
SELECT count(*) AS new_txn_rows FROM transactions WHERE subscriber_id='s-0002' AND txn_ref LIKE 'CT-%' AND date > now() - interval '2 minutes';
SELECT count(*) AS nonce_rows FROM money_nonces WHERE nonce='A04-IDEM-NONCE';
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,units,invested FROM subscriber_balances WHERE subscriber_id='s-0002';
ROLLBACK;

\echo '### POST-ROLLBACK RE-READ (must equal PRE-STATE)'
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,units,invested FROM subscriber_balances WHERE subscriber_id='s-0002';
SELECT count(*) AS txn_rows FROM transactions WHERE subscriber_id='s-0002';
SELECT count(*) AS nonce_rows FROM money_nonces WHERE nonce LIKE 'A04-%';
