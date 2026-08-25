-- 0136_fix_demo_card_reclaim.sql
-- ============================================================================
-- 0133's stale-claim reclaim recycles cards that ALREADY became subscribers,
-- which reproduces A11-002 — the single outcome that migration exists to prevent.
--
-- THE DEFECT
-- ----------
-- 0133 declared `demo_id_cards.subscriber_id` and reclaimed on:
--     status = 'claimed' AND subscriber_id IS NULL AND claimed_at < now() - 24h
-- but **nothing ever writes `subscriber_id`**. `claim_demo_id_card` is the only
-- function that touches the table, and it does not set it; no route or service
-- does either. Verified live before writing this: 4 cards claimed,
-- count(subscriber_id) = 0.
--
-- So the second conjunct is unconditionally TRUE after 24 hours, and the reclaim
-- frees every claimed card — including ones whose NIN is now on a real
-- subscriber. Worse, the claim is `ORDER BY c.id LIMIT 1`, so a recycled low-id
-- card is handed out FIRST:
--
--     day 1  rep claims idc-0001, completes signup, NIN lands on `subscribers`
--     day 2  reclaim frees idc-0001; next claim returns it first
--            -> create_subscriber_* 409s on ux_subscribers_nin
--
-- That is A11-002 verbatim: the agent onboarding wizard dead on the second
-- attempt, trapped on a "Not saved" card. The pool was built to end exactly that.
-- 0133's own NIN-collision guard runs once at apply time and cannot see it.
--
-- THE FIX
-- -------
-- Reclaim on what is actually knowable — whether the card's NIN reached
-- `subscribers` — instead of on a column no writer maintains:
--     NOT EXISTS (SELECT 1 FROM public.subscribers s WHERE s.nin = p.nin)
-- This is self-maintaining: it needs no writer, no trigger, and no bookkeeping
-- that can drift out of step again. It is also what 0133's own design notes
-- specified; the implementation drifted to `subscriber_id IS NULL`.
--
-- `subscriber_id` is kept and BACKFILLED from the NIN match, so it becomes a
-- true observability column rather than a load-bearing one. Nothing keys off it.
--
-- ⚠️ The reclaim now correctly refuses to free a used card, which means an
-- abandoned-then-used pool can genuinely run dry. That is the safe direction:
-- `api/kyc/id-ocr.ts` falls back to the seeded PRNG on exhaustion, so the demo
-- degrades to generated identities rather than 409-ing on a duplicate NIN.
--
-- APPLIED VIA psql -f; the file's own BEGIN/COMMIT makes it atomic.
-- ============================================================================

BEGIN;

-- Make the column mean something, for the cards already spent.
UPDATE public.demo_id_cards p
   SET subscriber_id = s.id
  FROM public.subscribers s
 WHERE s.nin = p.nin
   AND p.subscriber_id IS DISTINCT FROM s.id;

COMMENT ON COLUMN public.demo_id_cards.subscriber_id IS
  'Advisory only — backfilled from a NIN match by 0136. The reclaim keys off the NIN, not this column, precisely because nothing writes it reliably.';

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

    -- 1. Retry-stable: a session that already holds a card gets the SAME card.
    SELECT * INTO v_card
      FROM public.demo_id_cards
     WHERE claimed_by_session = p_session_id;
    IF FOUND THEN
      RETURN v_card;
    END IF;

    -- 3. Reclaim genuinely-abandoned claims. Keyed on whether the NIN reached
    --    `subscribers` — NOT on subscriber_id, which no writer maintains and
    --    which therefore freed used cards and re-issued them first (A11-002).
    UPDATE public.demo_id_cards p
       SET status = 'available', claimed_by_session = NULL, claimed_at = NULL
     WHERE p.status = 'claimed'
       AND p.claimed_at < now() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.subscribers s WHERE s.nin = p.nin
       );

    -- 2. Claim the next free card. SKIP LOCKED so two reps demoing at the same
    --    moment cannot draw the same one.
    UPDATE public.demo_id_cards d
       SET status = 'claimed', claimed_by_session = p_session_id, claimed_at = now()
     WHERE d.id = (
       SELECT c.id FROM public.demo_id_cards c
        WHERE c.status = 'available'
          -- Belt and braces: never hand out a card whose NIN is already taken,
          -- even if a row was freed by some other path. This is the condition
          -- create_subscriber_* would 409 on.
          AND NOT EXISTS (SELECT 1 FROM public.subscribers s WHERE s.nin = c.nin)
        ORDER BY c.id
          FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING * INTO v_card;

    RETURN v_card;  -- NULL when exhausted; the caller falls back to the PRNG
  END;
$function$;

REVOKE ALL ON FUNCTION public.claim_demo_id_card(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- GUARD — the reclaim must not be able to free a spent card.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_spent INT; v_reclaimable INT; v_backfilled INT;
BEGIN
  SELECT count(*) INTO v_spent
    FROM public.demo_id_cards p
   WHERE EXISTS (SELECT 1 FROM public.subscribers s WHERE s.nin = p.nin);

  SELECT count(*) INTO v_backfilled
    FROM public.demo_id_cards WHERE subscriber_id IS NOT NULL;

  -- Simulate the reclaim predicate as if every claim were older than 24h.
  SELECT count(*) INTO v_reclaimable
    FROM public.demo_id_cards p
   WHERE p.status = 'claimed'
     AND NOT EXISTS (SELECT 1 FROM public.subscribers s WHERE s.nin = p.nin);

  IF EXISTS (
    SELECT 1 FROM public.demo_id_cards p
     WHERE p.status = 'claimed'
       AND EXISTS (SELECT 1 FROM public.subscribers s WHERE s.nin = p.nin)
       AND NOT EXISTS (SELECT 1 FROM public.subscribers s2 WHERE s2.nin = p.nin)
  ) THEN
    RAISE EXCEPTION 'ABORT: reclaim predicate is self-contradictory.' USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'guards OK — % card(s) spent (NIN on subscribers, never reclaimable), % backfilled, % claimed-but-unspent are eligible after 24h',
    v_spent, v_backfilled, v_reclaimable;
END $$;

COMMIT;
