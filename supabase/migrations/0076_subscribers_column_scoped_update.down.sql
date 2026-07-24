-- Down for 0076 — restore the (pre-audit) table-wide UPDATE grant on subscribers.
-- ⚠️ This re-opens the employer-injection vector (audit B3/MED-1). Use only for a true rollback.
GRANT UPDATE ON public.subscribers TO authenticated, anon;
