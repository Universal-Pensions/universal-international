-- 0122_repair_orphan_login_identity.sql
-- ============================================================================
-- One member can authenticate but cannot be resolved to their own account.
--
-- Found 2026-08-25 while verifying 0121. NOT one of the 221 findings — it is a
-- surviving casualty of the 2026-08-07 login-identity regression (0095's
-- CREATE OR REPLACE silently dropped 0090's persona write; 0101 extracted
-- register_login_identity() and backfilled). One row was missed by that backfill.
--
--   public.users  id = 'subscriber:+256701231323'
--     role          = 'subscriber'
--     password_hash = SET  (a real, usable credential)
--     entity_id     = NULL   <-- the defect
--
--   public.subscribers  s-100117  "Namukasa Sarah Kintu"  +256701231323
--     created 2026-08-07 11:35:20.304  — the users row followed 1.5s later at
--     11:35:21.818, so signup wrote the subscriber and the credential but never
--     the link between them.
--
-- Effect: that person can sign in successfully and then resolve to nothing.
-- Every RLS policy keys off the JWT's entity claim, so the session authenticates
-- and then sees an empty product — the worst-feeling failure mode there is,
-- because it looks like their money is gone rather than like an error.
--
-- Measured scope — exactly ONE row, not a set:
--   can log in but unresolvable  : 1   <-- this
--   no password, no entity       : 32  <-- A06-013 breadcrumbs, pruned by 0121
--   healthy                      : 15
--   total public.users           : 48
--
-- Uses register_login_identity() — the function 0101 created precisely to be the
-- single writer of this relationship — rather than a hand-written UPDATE, so the
-- repair goes through the same code path a correct signup would and cannot drift
-- from it.
--
-- APPLY AFTER 0121 (which prunes the 32 breadcrumbs and makes this failure fatal
-- going forward). Order is not strictly required, but verifying is easier when
-- the breadcrumbs are already gone.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_uid    text;
  v_entity text;
  v_result text;
BEGIN
  SELECT u.id, u.entity_id INTO v_uid, v_entity
    FROM public.users u
   WHERE u.id = 'subscriber:+256701231323';

  IF v_uid IS NULL THEN
    RAISE NOTICE 'Nothing to repair: no users row for +256701231323. Skipping.';
    RETURN;
  END IF;

  IF v_entity IS NOT NULL THEN
    RAISE NOTICE 'Already repaired: entity_id = %. Skipping.', v_entity;
    RETURN;
  END IF;

  -- Refuse if the subscriber this credential should point at is not there. A
  -- credential pointed at a missing row is worse than one pointed at nothing.
  IF NOT EXISTS (
    SELECT 1 FROM public.subscribers s
     WHERE s.id = 's-100117' AND s.phone = '+256701231323'
  ) THEN
    RAISE EXCEPTION
      'ABORT: s-100117 with phone +256701231323 does not exist. Re-measure before repairing — '
      'the subscriber may have been deleted or its phone changed since 2026-08-25.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT public.register_login_identity(
           '+256701231323', 'subscriber', 's-100117',
           'Namukasa Sarah Kintu', 'Namukasa Sarah Kintu', NULL
         ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION
      'ABORT: register_login_identity returned NULL — the phone is invalid or already '
      'signs in to a different entity. Investigate rather than forcing the link.'
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'Repaired: subscriber:+256701231323 -> s-100117.';
END $$;

-- The credential must survive. register_login_identity must not have reset it —
-- a "repair" that silently locks the member out is not a repair.
DO $$
DECLARE v_entity text; v_has_pw boolean;
BEGIN
  SELECT entity_id, password_hash IS NOT NULL
    INTO v_entity, v_has_pw
    FROM public.users WHERE id = 'subscriber:+256701231323';

  IF v_entity IS DISTINCT FROM 's-100117' THEN
    RAISE EXCEPTION 'ABORT: entity_id is % after repair, expected s-100117.', v_entity
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_has_pw THEN
    RAISE EXCEPTION 'ABORT: the repair cleared password_hash — the member could no longer sign in.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Nobody else may be left in this state.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.users
   WHERE entity_id IS NULL AND password_hash IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % user(s) can still authenticate but resolve to nothing.', v_bad
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'No user can authenticate without resolving to an entity.';
END $$;

COMMIT;
