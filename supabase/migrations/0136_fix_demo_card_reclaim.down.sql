-- 0136_fix_demo_card_reclaim.down.sql
-- ============================================================================
-- Undo for 0136 — restore 0133's reclaim predicate.
--
-- ⚠️ REVERTING RE-OPENS A11-002. 0133's predicate keys on `subscriber_id`,
-- which nothing writes, so it is unconditionally true after 24h and frees cards
-- whose NIN already belongs to a subscriber. Because the claim is
-- `ORDER BY id LIMIT 1`, a recycled low-id card is handed out FIRST and the next
-- signup 409s on ux_subscribers_nin — the agent onboarding wizard dead on the
-- second attempt, which is the bug the pool was built to end.
--
-- Provided for symmetry only. There is no scenario where running it is correct.
-- The `subscriber_id` backfill is deliberately NOT undone: it is advisory data
-- and removing it would lose information for no benefit.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_demo_id_card(p_session_id TEXT)
RETURNS public.demo_id_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    v_card public.demo_id_cards;
  BEGIN
    IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
      RETURN NULL;
    END IF;

    SELECT * INTO v_card
      FROM public.demo_id_cards
     WHERE claimed_by_session = p_session_id;
    IF FOUND THEN
      RETURN v_card;
    END IF;

    UPDATE public.demo_id_cards
       SET status = 'available', claimed_by_session = NULL, claimed_at = NULL
     WHERE status = 'claimed'
       AND subscriber_id IS NULL
       AND claimed_at < now() - INTERVAL '24 hours';

    UPDATE public.demo_id_cards d
       SET status = 'claimed', claimed_by_session = p_session_id, claimed_at = now()
     WHERE d.id = (
       SELECT c.id FROM public.demo_id_cards c
        WHERE c.status = 'available'
        ORDER BY c.id
          FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING * INTO v_card;

    RETURN v_card;
  END;
$function$;

REVOKE ALL ON FUNCTION public.claim_demo_id_card(TEXT) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  RAISE WARNING 'REVERTED: the demo card reclaim can free spent cards again (A11-002 re-opened).';
END $$;

COMMIT;
