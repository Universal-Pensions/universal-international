\set ON_ERROR_STOP off
\echo '======== PRE-STATE'
SELECT count(*) AS snaps, max(nav_date) AS newest, public.latest_nav() AS nav FROM nav_snapshots WHERE fund_code='UPU-BAL' AND status='published';
SELECT count(*) AS pending FROM nav_snapshots WHERE status='pending';
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT sum(total_balance) AS aum, round(sum(units),8) AS units_in_issue FROM subscriber_balances;

\echo '======== P1 non-admin (subscriber) tries to publish — expect REJECT'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"app_role":"subscriber","subscriberId":"s-0004","role":"authenticated"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 1600); ROLLBACK;

\echo '======== P1b anon tries to publish — expect REJECT'
BEGIN; SET LOCAL ROLE anon; SELECT public.publish_nav_snapshot(CURRENT_DATE, 1600); ROLLBACK;

\echo '======== P2 admin, unit_price = 0 — expect REJECT'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 0); ROLLBACK;

\echo '======== P3 admin, unit_price = -5 — expect REJECT'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, -5); ROLLBACK;

\echo '======== P3b admin, unit_price = NaN'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 'NaN'::numeric) AS r; ROLLBACK;

\echo '======== P4 admin, FUTURE date — expect REJECT'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE + 1, 1600); ROLLBACK;

\echo '======== P5 admin, BACK-DATED 2026-08-05 @ 1600 — must NOT revalue the book'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL sql_safe_updates = on;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(DATE '2026-08-05', 1600) AS r;
RESET ROLE;
SELECT 'after_backdate' AS k, total_balance, retirement_balance, emergency_balance, round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
ROLLBACK;

\echo '======== P6 admin, TODAY @ 1571.40 with sql_safe_updates=on (reproduces the PostgREST condition 0106 fixed)'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL sql_safe_updates = on;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 1571.40) AS r;
RESET ROLE;
SELECT 'after_today_republish' AS k, total_balance, retirement_balance, emergency_balance, round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
ROLLBACK;

\echo '======== P7 admin, TODAY @ 2500 (+59% move) WITHOUT confirm — expect REJECT'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL sql_safe_updates = on;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 2500, 'UPU-BAL', 'admin_manual', false); ROLLBACK;

\echo '======== P8 admin, TODAY @ 2500 WITH confirm — revalues; check arithmetic then ROLLBACK'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL sql_safe_updates = on;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 2500, 'UPU-BAL', 'admin_manual', true) AS r;
RESET ROLE;
SELECT 'after_2500' AS k, total_balance, retirement_balance, emergency_balance, round(units,10) units,
       (retirement_balance+emergency_balance-total_balance) AS invariant_break FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT 'book' AS k, count(*) rows, count(*) FILTER (WHERE total_balance <> round(units*2500)) AS mismatch,
       count(*) FILTER (WHERE retirement_balance+emergency_balance <> total_balance) AS split_break FROM subscriber_balances;
ROLLBACK;

\echo '======== POST-ROLLBACK RE-READ (must equal PRE-STATE)'
SELECT count(*) AS snaps, max(nav_date) AS newest, public.latest_nav() AS nav FROM nav_snapshots WHERE fund_code='UPU-BAL' AND status='published';
SELECT count(*) AS pending FROM nav_snapshots WHERE status='pending';
SELECT count(*) AS a04probe_snaps FROM nav_snapshots WHERE published_by='A04PROBE';
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT sum(total_balance) AS aum, round(sum(units),8) AS units_in_issue FROM subscriber_balances;
