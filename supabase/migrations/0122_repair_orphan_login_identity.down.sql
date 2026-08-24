-- 0122_repair_orphan_login_identity.down.sql
--
-- ⚠️ Running this RE-BREAKS a real member's sign-in. It restores the exact state
-- captured on 2026-08-25 — a usable credential pointing at nothing — in which
-- Namukasa Sarah Kintu can authenticate and then see an empty product.
--
-- It exists only so 0122 is formally reversible. There is no good reason to run
-- it. If 0122 caused a problem, the problem is more likely in
-- register_login_identity() than in the link this restored.
--
-- The credential itself is NOT touched, only the entity link.

BEGIN;

UPDATE public.users
   SET entity_id = NULL
 WHERE id = 'subscriber:+256701231323'
   AND entity_id = 's-100117';

COMMIT;
