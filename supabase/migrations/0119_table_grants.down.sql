-- 0119_table_grants.down.sql
-- Restores the blanket table grants 0119 removed, exactly as they were LIVE
-- immediately before it.
--
-- PROVENANCE. Read from the live catalogue on project ilkhfnoyxlxwqadebnkp
-- (2026-08-25), not retyped from any migration — these grants were never
-- written by a migration in this repo in the first place. They are Supabase's
-- project-bootstrap default:
--   SELECT relname, array_to_string(relacl, E'\n') FROM pg_class
--    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
--     → anon=arwdDxtm/postgres  authenticated=arwdDxtm/postgres  (35 of 37 tables)
--   SELECT pg_get_userbyid(defaclrole), array_to_string(defaclacl,' ')
--     FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
--    WHERE n.nspname = 'public' AND d.defaclobjtype = 'r';
--     → postgres | anon=arwdDxtm/postgres authenticated=arwdDxtm/postgres …
--
-- NOT A BLANKET RE-GRANT, AND NOT A HARDCODED EXCLUSION LIST EITHER. 0119
-- revokes with `ON ALL TABLES IN SCHEMA public`, but a growing set of relations
-- never held these grants and must not receive them here — as of 2026-08-25:
-- entity_detach_log, entity_status_log, the view v_reconciliation_exceptions,
-- and the snapshot/backup tables left by 0105, 0112 and 0114
-- (subscriber_balances_pre_nav, subscribers_unit_value_pre_nav,
-- subscribers_pre_purge_20260824, branches_pre_purge_20260824,
-- settlement_uploads_pre_purge_20260824, transactions_wd_sign_fix_20260825).
-- That list grows every time a migration takes a snapshot, so naming it would
-- rot. Instead the loop below re-grants ONLY to relations that still carry a
-- SELECT, INSERT, UPDATE or DELETE privilege for the role — the observable
-- signature of "this relation was in Supabase's blanket GRANT ALL", since 0119
-- removes only D/x/t/m and leaves a/r/w/d untouched. All four are tested, not
-- just SELECT: `public.users` had its anon SELECT revoked back in 0036 and
-- carries `anon=adDxtm`, so a SELECT-only test would have silently stripped its
-- TRUNCATE/REFERENCES/TRIGGER on revert. Self-maintaining, and verified by diffing pg_class.relacl
-- across a full apply→revert round-trip under BEGIN..ROLLBACK: identical, 277
-- catalogue facts, zero drift. (Two earlier drafts of this file — one blanket,
-- one with a hardcoded exclusion list — each handed relations privileges they
-- had never had. The diff is what caught both.)
--
-- WARNING — reverting re-opens A02-101: `anon` and `authenticated` regain
-- TRUNCATE on essentially every table in the schema, and RLS does not apply to
-- TRUNCATE. Every policy in 0003…0118 stops protecting the data the moment any
-- SECURITY INVOKER path can execute caller-context SQL.

BEGIN;

DO $$
DECLARE
  r          record;
  v_maintain boolean := current_setting('server_version_num')::int >= 170000;
  v_rel      text;
BEGIN
  FOR r IN
    SELECT c.relname,
           has_table_privilege('anon',          c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS anon_had,
           has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS auth_had
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'v', 'p', 'm')
  LOOP
    v_rel := format('public.%I', r.relname);

    IF r.anon_had THEN
      EXECUTE format('GRANT TRUNCATE, REFERENCES, TRIGGER ON %s TO anon', v_rel);
      IF v_maintain THEN
        EXECUTE format('GRANT MAINTAIN ON %s TO anon', v_rel);
      END IF;
    END IF;

    IF r.auth_had THEN
      EXECUTE format('GRANT TRUNCATE, REFERENCES, TRIGGER ON %s TO authenticated', v_rel);
      IF v_maintain THEN
        EXECUTE format('GRANT MAINTAIN ON %s TO authenticated', v_rel);
      END IF;
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT MAINTAIN ON TABLES TO anon, authenticated';
  END IF;
END $$;

COMMIT;
