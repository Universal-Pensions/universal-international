-- 0127_secure_snapshot_tables.sql
-- ============================================================================
-- Recovery snapshot tables were created WITHOUT row-level security.
--
-- Supabase's own advisor flagged four of them CRITICAL ("RLS Disabled in
-- Public"), and it is right. `CREATE TABLE x AS SELECT …` inherits nothing: not
-- the source table's RLS, not its policies, not its grants. The source is
-- protected and the copy is wide open, which is the worst possible default for a
-- table whose entire purpose is to hold a verbatim copy of production rows.
--
-- Compounding it, `anon` and `authenticated` hold SELECT on essentially every
-- table in `public` (finding A02-101), so these were readable through PostgREST
-- by an unauthenticated caller.
--
-- WHAT WAS ACTUALLY EXPOSED (measured before fixing, 2026-08-25):
--   subscribers_pre_purge_20260824        5 rows — all tst-sub-* / s-e2e-* fixtures
--   branches_pre_purge_20260824           1 row  — tst-branch-msc7w8vm
--   transactions_wd_sign_fix_20260825     1 row
--   settlement_uploads_pre_purge_20260824 157 rows — nonces + result JSON, no PII
-- So no real member data leaked. The pattern is still wrong, and the NEXT
-- snapshots would not be so lucky: 0110 and 0111 (authored, not yet applied)
-- create tables holding 1,881 real transaction rows and 19 real balance rows.
-- Those migrations are fixed at source in the same change as this one.
--
-- 0105 got this right for `subscriber_balances_pre_nav` and
-- `subscribers_unit_value_pre_nav` — both already have RLS enabled. This brings
-- the newer snapshots up to that standard.
--
-- RLS ENABLED WITH NO POLICIES IS THE POINT. A recovery snapshot must be
-- readable by NOBODY through the API. `service_role` bypasses RLS and the table
-- owner is exempt, so `psql` and the admin key can still read it — which is
-- exactly and only who should, during a restore.
-- ============================================================================

DO $$
DECLARE
  t text;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind = 'r'
       AND (c.relname LIKE '%\_pre\_purge\_%' ESCAPE '\'
         OR c.relname LIKE '%\_wd\_sign\_fix\_%' ESCAPE '\'
         OR c.relname LIKE '%\_pre\_nav' ESCAPE '\')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    n := n + 1;
    RAISE NOTICE 'secured snapshot table: public.%', t;
  END LOOP;
  RAISE NOTICE '% snapshot table(s) secured.', n;
END $$;

-- Guard: nothing matching the snapshot naming convention may be left unsecured.
DO $$
DECLARE v_bad text[];
BEGIN
  SELECT array_agg(c.relname) INTO v_bad
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public' AND c.relkind='r'
     AND (c.relname LIKE '%\_pre\_purge\_%' ESCAPE '\'
       OR c.relname LIKE '%\_wd\_sign\_fix\_%' ESCAPE '\'
       OR c.relname LIKE '%\_pre\_nav' ESCAPE '\')
     AND (NOT c.relrowsecurity OR has_table_privilege('anon', c.oid, 'SELECT'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: snapshot table(s) still readable or without RLS: %', v_bad
      USING ERRCODE = 'P0001';
  END IF;
END $$;
