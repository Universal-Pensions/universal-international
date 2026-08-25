-- 0119_table_grants.sql
-- A02-101 — the privilege FLOOR under every RLS policy this platform has.
--
-- WHAT WAS THERE. `anon` and `authenticated` held the full Supabase default
-- `GRANT ALL ON ALL TABLES IN SCHEMA public` on 35 of the 37 public base tables
-- — transactions, subscriber_balances, commissions, nav_snapshots, money_nonces
-- included. In PG17 ACL letters that is `arwdDxtm`:
--   a INSERT   r SELECT   w UPDATE   d DELETE
--   D TRUNCATE x REFERENCES t TRIGGER m MAINTAIN
-- The last four are the ones this migration removes. (The first four are RLS's
-- job and are dealt with per-table by 0118.)
--
-- WHY IT MATTERS. **RLS does not apply to TRUNCATE.** Row-level security filters
-- rows for SELECT / INSERT / UPDATE / DELETE; TRUNCATE is table-level and is
-- gated ONLY by the table grant. So every policy in 0003…0118 offered exactly
-- zero protection against it. The same is true of MAINTAIN (VACUUM FULL,
-- CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW, LOCK TABLE — all
-- ACCESS EXCLUSIVE) and of TRIGGER (attach arbitrary code to a table).
--
-- HONEST SEVERITY: THIS IS HARDENING, NOT A LIVE HOLE. Checked rather than
-- assumed, before writing this file:
--   • PostgREST exposes no TRUNCATE, VACUUM, or CREATE TRIGGER verb. There is no
--     HTTP request that reaches any of these grants as the system stands today.
--   • Of the 13 functions `anon` may execute, 11 are SECURITY DEFINER (so the
--     anon grant is not what authorises what they do) and the two SECURITY
--     INVOKER ones are the trg_*_enforce_editable_cols column guards, which
--     cannot be called outside a trigger context.
-- It becomes exploitable the moment anyone adds a SECURITY INVOKER function that
-- executes SQL in the caller's context. The failure would then be total and
-- instant, with RLS contributing nothing. That is the layer this restores.
--
-- VERIFIED BEFORE APPLYING — the three checks A02-101 asked for:
--   1. TRIGGER is not load-bearing. All 13 CREATE TRIGGER statements in
--      supabase/migrations run as the migration role (`postgres`, the table
--      owner); no migration does `SET ROLE anon|authenticated`. The client roles
--      have never created a trigger and have no path to.
--   2. REFERENCES is not load-bearing. It is required to create a foreign key
--      that references a table — and every FK in this schema is created by
--      migrations running as `postgres`, which owns the tables and therefore
--      needs no grant at all.
--   3. ALTER DEFAULT PRIVILEGES is REQUIRED, or the next `CREATE TABLE` in the
--      next migration re-grants the whole mess. Confirmed live under
--      BEGIN..ROLLBACK: run as `postgres` it correctly rewrites the postgres
--      default ACL from `anon=arwdDxtm` to `anon=arwdm`.
--      Known limit, stated rather than glossed: pg_default_acl carries a SECOND
--      row for schema public granted by `supabase_admin`, and `postgres` cannot
--      amend it ("permission denied to change default privileges", verified).
--      That row only governs tables CREATED BY supabase_admin, which no
--      migration in this repo does — but a table created through some future
--      supabase_admin path would still arrive wide open.
--   4. INSERT / UPDATE / DELETE are deliberately NOT touched here. Those are
--      genuinely used by the app through RLS and are decided table by table in
--      0118.
--
-- SCOPE. `ON ALL TABLES IN SCHEMA public` covers the 37 base tables and the one
-- view (v_reconciliation_exceptions); it is a no-op on entity_detach_log and
-- entity_status_log, which never had these grants. `service_role` is untouched —
-- the seed script and the e2e harness connect with it and the seed's destructive
-- TRUNCATE + reseed must keep working. SELECT is untouched for every role.

BEGIN;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- MAINTAIN (PG17+) is the same class of privilege — table-level, invisible to
-- RLS, unused by the app. It is not named in A02-101 because
-- information_schema.role_table_grants does not report it (it is not a SQL
-- standard privilege), which is exactly why it went unnoticed. Guarded so this
-- file stays runnable against a pre-17 server.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM anon, authenticated';
  END IF;
END $$;

COMMIT;
