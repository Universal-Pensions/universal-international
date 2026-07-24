-- 0076_subscribers_column_scoped_update.sql
-- From deep audit 2026-07-08 — completes MED-1 for `subscribers`.
--
-- WHY 0075's column REVOKE was a no-op: a column-level `REVOKE UPDATE (col)` does NOT override a
-- role's TABLE-wide `UPDATE` grant — Postgres unions table-level and column-level privileges. (This
-- is also the true root cause of audit finding A2: 0072's column REVOKE could never have worked while
-- the table-wide grant stood.) The correct pattern is: REVOKE the table-wide UPDATE, then GRANT back
-- only the columns the client legitimately writes.
--
-- Verified safe (2026-07-08): the ONLY direct client UPDATE to `subscribers` is
-- `updateProfile` (src/services/subscriber.js:1190-1223), which writes exactly
-- name/email/phone/occupation/consent_at. All other `.from('subscribers')` calls are SELECTs.
-- After this, a subscriber can no longer PATCH employer_id / agent_id / compensation / kyc_status /
-- is_active / nin (closes the cross-tenant employer-injection vector, audit B3/MED-1).

REVOKE UPDATE ON public.subscribers FROM authenticated, anon;
GRANT  UPDATE (name, email, phone, occupation, consent_at) ON public.subscribers TO authenticated;

-- NOTE (deferred): contribution_schedules insurance money-columns (A2) still need the same
-- table-REVOKE + column-GRANT treatment, but that's the *contained* case (no cross-tenant reach;
-- the sweep's independent v_emg_bal>=v_target guard blocks abuse). Agent 1 handles it after
-- confirming the subscriber schedule-editor write path (RPC vs direct).
