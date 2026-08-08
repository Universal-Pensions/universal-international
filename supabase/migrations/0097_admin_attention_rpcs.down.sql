-- 0097_admin_attention_rpcs.down.sql
-- Reverses 0097. Run AFTER 0098.down.sql (that migration's DML is addressed by
-- these RPCs' tables) and BEFORE 0096.down.sql (these functions read the 0096
-- view and tables).

DROP FUNCTION IF EXISTS public.admin_notify(text, text, text, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.get_admin_attention_rows(text, int);
DROP FUNCTION IF EXISTS public.get_admin_attention();
DROP FUNCTION IF EXISTS public._employer_grace_days(text);
DROP FUNCTION IF EXISTS public._admin_attention_thresholds();

-- Restore the 0031 mark_notifications_read body verbatim (agent / branch /
-- distributor only). Same signature, so CREATE OR REPLACE is sufficient — do
-- NOT drop it, other roles' bells depend on it existing.
--
-- NOTE: the distributor branch below is the 0081-scoped form that is actually
-- deployed, not the original 0031 oversight-wide form. 0081 owns that scoping
-- and is not being reversed here.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := (SELECT auth.jwt()) ->> 'app_role';
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  IF v_role = 'agent' THEN
    UPDATE public.notifications SET is_read = true
     WHERE id = ANY(p_ids)
       AND recipient_role = 'agent'
       AND recipient_id = (SELECT auth.jwt()) ->> 'agentId';

  ELSIF v_role = 'branch' THEN
    UPDATE public.notifications SET is_read = true
     WHERE id = ANY(p_ids)
       AND recipient_role = 'branch'
       AND recipient_id = (SELECT auth.jwt()) ->> 'branchId';

  ELSIF v_role = 'distributor' THEN
    UPDATE public.notifications SET is_read = true
     WHERE id = ANY(p_ids)
       AND recipient_role = 'distributor'
       AND recipient_id = public.current_distributor_id();

  ELSE
    RAISE EXCEPTION 'role % cannot mark notifications read', v_role USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.mark_notifications_read(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(text[]) TO authenticated;
