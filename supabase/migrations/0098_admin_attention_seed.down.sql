-- 0098_admin_attention_seed.down.sql
-- Reverses 0098. Run FIRST in the down chain (0098 → 0097 → 0096) — the curated
-- rows live in tables 0096 creates and are read by the 0097 RPCs.
--
-- Order matters: the two closeout reversals (§4/§5) must run BEFORE the curated
-- inserts are deleted, because both match on markers rather than on ids and the
-- curated rows carry no marker.

-- ── 4/5) Reverse the two marked bulk closeouts ───────────────────────────────
-- Withdrawals: strip the marker and restore 'processing'. Rows whose reference
-- was NULL before the sweep were stamped with the bare marker, so they revert to
-- NULL rather than to an empty string.
UPDATE public.withdrawals
   SET status    = 'processing',
       reference = NULLIF(btrim(replace(reference, '[demo-closeout]', '')), '')
 WHERE position('[demo-closeout]' IN COALESCE(reference, '')) > 0;

-- Claims: the prior status was encoded into the description, so restore it
-- exactly instead of guessing. substring() pulls the status back out.
UPDATE public.claims
   SET status      = substring(description FROM '\[demo-closeout:([a-z_]+)\]'),
       description = NULLIF(btrim(regexp_replace(description, '\s*\[demo-closeout:[a-z_]+\]', '')), '')
 WHERE description ~ '\[demo-closeout:[a-z_]+\]';

-- ── 8) Reconciliation breaks ─────────────────────────────────────────────────
-- 8b) The mis-attributed postings. type='premium' fires no trigger, so deleting
--     them moves no balance either.
DELETE FROM public.transactions WHERE id LIKE 't-demo-recon-%';

-- 8a) The split drift. Exact inverse of the 0098 UPDATE — same deterministic
--     window (OFFSET 900 LIMIT 3 over total_balance > 100000), same amounts,
--     negated. total_balance was never touched in either direction.
--     Keep the outer row_number() nesting — see the warning in 0098's §8a; the
--     naive form NULLs out three member balances instead of adjusting them.
UPDATE public.subscriber_balances b
   SET retirement_balance = b.retirement_balance - d.drift
  FROM (
    SELECT t.subscriber_id,
           (ARRAY[12500, -8200, 31000])[(row_number() OVER (ORDER BY t.subscriber_id))::int] AS drift
    FROM (
      SELECT subscriber_id
      FROM public.subscriber_balances
      WHERE total_balance > 100000
      ORDER BY subscriber_id
      OFFSET 900 LIMIT 3
    ) t
  ) d
 WHERE b.subscriber_id = d.subscriber_id
   AND d.drift IS NOT NULL;

-- ── 7) The pilot distributor (agents → branches → distributor: FK order) ─────
DELETE FROM public.agents       WHERE id LIKE 'a-demo-krm-%';
DELETE FROM public.branches     WHERE id LIKE 'b-demo-%';
DELETE FROM public.distributors WHERE id = 'd-003';

-- ── 6/5/4/3/2/1) Curated rows, all id-prefixed ───────────────────────────────
DELETE FROM public.contribution_runs WHERE id LIKE 'run-demo-%';
DELETE FROM public.claims            WHERE id LIKE 'clm-demo-%';
DELETE FROM public.withdrawals       WHERE id LIKE 'wd-demo-%';
DELETE FROM public.custody_transfers WHERE id LIKE 'cbt-demo-%';
DELETE FROM public.nav_snapshots     WHERE id LIKE 'nav-demo-%';
DELETE FROM public.access_requests   WHERE id LIKE 'ar-demo-%';
