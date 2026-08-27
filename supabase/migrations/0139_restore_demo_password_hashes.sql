-- 0139_restore_demo_password_hashes.sql
-- ============================================================================
-- Two of the fourteen documented demo logins cannot sign in with a password.
-- CLAUDE.md §8 publishes `Demo1234` as working for "the 5 subscribers, 3 agents,
-- 2 branches, 2 distributors, the employer, and the pinned admin". Measured on
-- live 2026-08-27, two of those rows carry a NULL `password_hash`:
--
--     distributor  +256700000021   d-001    <- the FIRST distributor
--     subscriber   +256711000001   s-0001   <- the FIRST subscriber
--
-- Both return `401 password_not_set` and the sign-in UI falls back to the OTP
-- toast. The other twelve verify fine. These two are the worst possible pair to
-- lose: they are the first of their role, the ones a rep reaches for, and
-- `s-0001` is additionally the subscriber fallback persona (CLAUDE.md §8).
--
-- HOW THEY LOST IT — the mechanism is documented, the specific event is not
-- ----------------------------------------------------------------------
-- `api/auth/verify-otp.ts`'s own header records the behaviour that fits: before
-- the E18 / A06-013 fix, `upsertOrTouchUser` called `.upsert()` UNCONDITIONALLY,
-- writing `password_hash` from a value that is NULL whenever the caller supplied
-- no password — i.e. every ordinary OTP sign-in. On a row the seed had already
-- stamped, that upsert overwrote a good hash with NULL. The current code takes
-- an UPDATE-only branch when no password is supplied precisely so this cannot
-- happen again.
--
-- Stated as the mechanism that FITS, not as a proven cause: the agent row
-- +256700000001 has an equally recent `last_login_at` and kept its hash, so the
-- exact sequence is not recoverable from the surviving state. What is certain is
-- the current state and that the code path which could produce it is closed.
--
-- WHY NOT JUST RE-SEED
-- --------------------
-- `npm run seed` TRUNCATEs and rebuilds the entire demo dataset — 5,060
-- subscribers, 27k transactions, the NAV register — to fix one column on two
-- rows, and would discard every legitimate signup identity created since. Two
-- targeted UPDATEs are the proportionate repair.
--
-- THE HASH
-- --------
-- bcrypt, cost 10 — matching `api/auth/_lib/password.ts` and
-- `scripts/seed-supabase.mjs:1944`, so `bcryptjs.compare` verifies it exactly as
-- it does for the twelve healthy rows. Generated with the repo's own bcryptjs
-- and self-checked before being embedded here: it accepts 'Demo1234' and
-- rejects 'Demo12345'. A published shared demo password is intentional scope
-- (CLAUDE.md §8/§10a); this is not a credential worth protecting, it is a
-- documented demo affordance that had stopped working.
--
-- SCOPE GUARDS
-- ------------
-- Pinned to the two (phone, role) pairs AND to `password_hash IS NULL`, so it
-- can never overwrite a hash a user rotated through /api/auth/change-password.
-- The many OTHER `users` rows with a NULL hash are CORRECT and deliberately left
-- alone — they are self-signup and access-request identities that never set a
-- password, and handing them one would invent credentials nobody chose.
--
-- Idempotent: the NULL predicate makes a replay a no-op.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  -- bcrypt('Demo1234', cost 10)
  v_hash CONSTANT TEXT := '$2a$10$oTwaONtnV0bWgL7bUa5xzuP13lUIcbtqV48JL4F.iLIu3l7hAnQtq';
  v_target INT;
  v_fixed  INT;
BEGIN
  IF length(v_hash) <> 60 OR left(v_hash, 7) <> '$2a$10$' THEN
    RAISE EXCEPTION '0139: hash is not a cost-10 bcrypt digest.';
  END IF;

  SELECT COUNT(*) INTO v_target
    FROM public.users
   WHERE (phone, role) IN (('+256700000021','distributor'), ('+256711000001','subscriber'));
  IF v_target <> 2 THEN
    RAISE EXCEPTION '0139: expected both demo rows to exist, found %.', v_target;
  END IF;

  UPDATE public.users
     SET password_hash = v_hash
   WHERE (phone, role) IN (('+256700000021','distributor'), ('+256711000001','subscriber'))
     AND password_hash IS NULL;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  IF v_fixed = 0 THEN
    RAISE NOTICE '0139: both rows already carry a hash — no-op.';
  ELSE
    RAISE NOTICE '0139: restored the demo password hash on % row(s).', v_fixed;
  END IF;
END $$;

-- ── Guard: all fourteen documented demo logins must now carry a hash ─────────
DO $$
DECLARE v_missing TEXT;
BEGIN
  SELECT string_agg(role || ' ' || phone, ', ' ORDER BY role, phone) INTO v_missing
    FROM public.users
   WHERE password_hash IS NULL
     AND (phone, role) IN (
       ('+256711000001','subscriber'), ('+256711000002','subscriber'), ('+256711000003','subscriber'),
       ('+256711000004','subscriber'), ('+256711000005','subscriber'),
       ('+256700000001','agent'),      ('+256700000002','agent'),      ('+256700000003','agent'),
       ('+256700000011','branch'),     ('+256700000012','branch'),
       ('+256700000021','distributor'),('+256700000022','distributor'),
       ('+256700000031','employer'),   ('+256700000099','admin'));

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0139: CLAUDE.md §8 documents password login for these, but they still have no hash: %', v_missing;
  END IF;

  RAISE NOTICE '0139: all 14 documented demo logins carry a password hash.';
END $$;

COMMIT;
