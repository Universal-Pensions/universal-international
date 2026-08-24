\set ON_ERROR_STOP off
\echo '======== PRE-STATE'
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT sum(total_balance) AS aum, round(sum(units),8) AS units_in_issue FROM subscriber_balances;

\echo '======== P5 admin, BACK-DATED 2026-08-05 @ 1600 — must NOT revalue the book'
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(DATE '2026-08-05', 1600) AS r;
RESET ROLE;
SELECT 'after_backdate' AS k, total_balance, emergency_balance, round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT 'pending_left' AS k, count(*) FROM nav_snapshots WHERE status='pending';
ROLLBACK;

\echo '======== P6 admin, TODAY @ 1571.40 (re-publish at same price) — revalues, should be rounding-neutral'
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 1571.40) AS r;
RESET ROLE;
SELECT 'after_today' AS k, total_balance, retirement_balance, emergency_balance, round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT 'book' AS k, count(*) rows, count(*) FILTER (WHERE total_balance <> round(units*1571.40)) AS recon_mismatch,
       count(*) FILTER (WHERE retirement_balance+emergency_balance <> total_balance) AS split_break FROM subscriber_balances;
ROLLBACK;

\echo '======== P7 admin, TODAY @ 2500 (+59%) WITHOUT confirm — expect REJECT'
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 2500, 'UPU-BAL', 'admin_manual', false); ROLLBACK;

\echo '======== P8 admin, TODAY @ 2500 WITH confirm — revalues'
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 2500, 'UPU-BAL', 'admin_manual', true) AS r;
RESET ROLE;
SELECT 'after_2500' AS k, total_balance, retirement_balance, emergency_balance, round(units,10) units,
       (retirement_balance+emergency_balance-total_balance) AS invariant_break FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT 'book' AS k, count(*) rows, count(*) FILTER (WHERE total_balance <> round(units*2500)) AS recon_mismatch,
       count(*) FILTER (WHERE retirement_balance+emergency_balance <> total_balance) AS split_break FROM subscriber_balances;
ROLLBACK;

\echo '======== P9 *** admin, TODAY @ NaN WITH confirm=true ***'
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 'NaN'::numeric, 'UPU-BAL', 'admin_manual', true) AS r;
RESET ROLE;
SELECT 'after_NaN' AS k, total_balance, retirement_balance, emergency_balance, units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT 'book' AS k, count(*) FILTER (WHERE total_balance = 'NaN'::numeric) AS nan_rows, sum(total_balance) AS aum FROM subscriber_balances;
SELECT 'nav_row' AS k, nav_date, unit_price, status FROM nav_snapshots WHERE published_by='A04PROBE';
ROLLBACK;

\echo '======== P10 admin, TODAY @ Infinity WITH confirm=true'
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"app_role":"admin","role":"authenticated","name":"A04PROBE"}',true);
SELECT public.publish_nav_snapshot(CURRENT_DATE, 'Infinity'::numeric, 'UPU-BAL', 'admin_manual', true) AS r; ROLLBACK;

\echo '======== POST-ROLLBACK RE-READ (must equal PRE-STATE)'
SELECT count(*) AS snaps, max(nav_date) AS newest, public.latest_nav() AS nav FROM nav_snapshots WHERE fund_code='UPU-BAL' AND status='published';
SELECT count(*) AS pending FROM nav_snapshots WHERE status='pending';
SELECT count(*) AS a04probe_snaps FROM nav_snapshots WHERE published_by='A04PROBE';
SELECT subscriber_id,total_balance,retirement_balance,emergency_balance,round(units,10) units FROM subscriber_balances WHERE subscriber_id='s-0004';
SELECT sum(total_balance) AS aum, round(sum(units),8) AS units_in_issue FROM subscriber_balances;
