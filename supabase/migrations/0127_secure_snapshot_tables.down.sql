-- 0127_secure_snapshot_tables.down.sql
--
-- ⚠️ Running this RE-EXPOSES recovery snapshots to any unauthenticated caller
-- through PostgREST. Supabase's advisor flags exactly this as CRITICAL. There is
-- no legitimate reason to run it; it exists only so 0127 is formally reversible.
--
-- If a restore needs to read a snapshot, use `service_role` or psql — both
-- bypass RLS already. Do not disable it.

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname='public' AND c.relkind='r'
       AND (c.relname LIKE '%\_pre\_purge\_%' ESCAPE '\' OR c.relname LIKE '%\_wd\_sign\_fix\_%' ESCAPE '\')
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;
