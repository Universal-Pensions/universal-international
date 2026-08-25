-- 0132_secure_nav_rollback_and_universal_rls_guard.sql
-- ============================================================================
-- `public.nav_fixture_rollback_0117` had RLS DISABLED and was SELECTable by
-- both `anon` and `authenticated`. Supabase's advisor rates it ERROR ("RLS
-- Disabled in Public"). Found 2026-08-25 while verifying 0131. It was the ONLY
-- table of 47 in `public` without RLS.
--
-- WHY 0127 MISSED IT — the part worth keeping
-- -------------------------------------------
-- 0127 secured the recovery snapshots by sweeping tables whose NAME matched:
--     %_pre_purge_%   |   %_wd_sign_fix_%   |   %_pre_nav
-- `nav_fixture_rollback_0117` matches none of the three. So the sweep skipped
-- it — and 0127's standing guard keys on the SAME three patterns, so the guard
-- shared the blind spot. A guard that cannot see what its sweep cannot see is
-- not a guard; it is a restatement.
--
-- THE FIRST ATTEMPT AT THIS MIGRATION WAS WRONG, AND THE GUARD CAUGHT IT.
-- Broadening the name list to include `%snapshot%` matched `public.nav_snapshots`
-- — the live NAV publication table the whole platform reads. Because the guard
-- ASSERTS rather than auto-revokes, it aborted instead of quietly revoking
-- SELECT on a business-critical table. Had it "fixed" what it matched, it would
-- have broken NAV reads for every role. Name patterns are the wrong instrument.
--
-- THE RIGHT DISCRIMINATOR is policies, not names:
--   nav_snapshots            RLS on, 1 policy   -> deliberate, stays readable
--   every recovery table     RLS on, 0 policies -> denies everything already
-- A table with RLS enabled and ZERO policies denies all non-owner access no
-- matter what grants exist. So the dangerous shape is precisely:
--   zero policies AND API-readable AND RLS disabled  = wide open.
-- Both invariants below are expressed that way and need no name list at all.
--
-- WHAT WAS EXPOSED (measured before fixing, 2026-08-25):
--   32 kB of 0117's NAV rollback data — the pending nav_snapshots rows it
--   deleted, every row it inserted, the frontier price the book was carried at
--   before revaluation, and any insurance accrual the revaluation clamped.
--   No member PII. But it is fund-wide unit-price history readable
--   unauthenticated through PostgREST, and 0117's own down migration reads this
--   table to restore the book — so its integrity is load-bearing.
--
-- ALSO CLOSED: four inert grants. `contribution_run_uploads`, `money_nonces`,
-- `settlement_uploads` and `subscriber_signup_uploads` are nonce / idempotency
-- ledgers with RLS on and zero policies, so their `anon`/`authenticated` SELECT
-- grant does nothing TODAY. It is a loaded trap for tomorrow: the day someone
-- adds a permissive policy, the stale grant goes live with it. Verified 0
-- client `.from()` references across src/, server/ and api/ — all four are
-- reached only through SECURITY DEFINER RPCs, which bypass both grant and RLS.
--
-- RLS ENABLED WITH NO POLICIES IS THE POINT (same as 0127). `service_role`
-- bypasses RLS and the owner is exempt, so psql and the admin key still read
-- these — exactly and only who should, during a restore.
-- 0117_nav_fixtures.down.sql is UNAFFECTED.
--
-- APPLIED VIA the Supabase migration API, which supplies its own transaction.
-- The BEGIN/COMMIT are the house convention for the psql path and are STRIPPED
-- before applying: Postgres transactions do not nest, and an inner COMMIT
-- commits the caller's. See scripts/psql-probe.sh.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The actual hole.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.nav_fixture_rollback_0117') IS NULL THEN
    RAISE NOTICE 'nav_fixture_rollback_0117 does not exist (0117 reverted?) — nothing to secure.';
  ELSE
    EXECUTE 'ALTER TABLE public.nav_fixture_rollback_0117 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.nav_fixture_rollback_0117 FORCE  ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.nav_fixture_rollback_0117 FROM anon, authenticated';
    RAISE NOTICE 'secured public.nav_fixture_rollback_0117';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The four inert grants.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contribution_run_uploads','money_nonces',
                           'settlement_uploads','subscriber_signup_uploads']
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
      RAISE NOTICE 'revoked inert anon/authenticated grant on public.%', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- GUARD 1 — every table in `public` has RLS enabled.
-- No exceptions list: the moment there is one, the next table added to it is
-- the next silent hole. If a future table genuinely must be RLS-free, this is
-- where that decision gets argued in writing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % table(s) in public have RLS disabled: %',
      array_length(v_bad, 1), array_to_string(v_bad, ', ') USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'guard 1 OK — all % tables in public have RLS enabled',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r');
END $$;

-- ---------------------------------------------------------------------------
-- GUARD 2 — a table governed by NO policy must not be API-readable.
-- Policy-based, not name-based. `nav_snapshots` (1 policy) is deliberately
-- readable and correctly ignored here; every recovery table (0 policies) must
-- not be reachable through PostgREST at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND (SELECT count(*) FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname) = 0
     AND (has_table_privilege('anon',          c.oid, 'SELECT')
       OR has_table_privilege('authenticated', c.oid, 'SELECT'));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: policy-less table(s) still API-readable: %',
      array_to_string(v_bad, ', ') USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'guard 2 OK — no policy-less table is readable by anon or authenticated';
END $$;

COMMIT;
