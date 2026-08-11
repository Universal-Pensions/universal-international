-- =============================================================================
-- Universal Pensions Uganda — 0108: demo population for the nominee-claim queue
-- =============================================================================
-- WHY
-- `nominee_claims` (0100) shipped with the public /claim form and the admin
-- triage surfaces, and has been EMPTY ever since — measured live 2026-08-11:
-- zero rows, any status. So both doors onto it (the desktop panel and the phone
-- page added 2026-08-11) open on their empty state, and a sales rep walking a
-- prospect through "what happens when a member dies" has nothing to show. This
-- fills the queue with work.
--
-- ⚠️ THE ROWS ARE DERIVED FROM REAL MEMBERS, NOT INVENTED.
-- The entire point of this queue is the admin finding the deceased in the member
-- records and matching the claim to them. A fictional name makes that step a
-- dead end — the admin searches, finds nothing, and the demo stops at the
-- interesting part. Every row therefore names a real seeded subscriber who holds
-- ACTIVE cover of the product being claimed, and its claimant is one of that
-- member's own `nominees` rows (their real name, phone and relationship). The
-- three decided rows carry a `matched_subscriber_id` that is that same member,
-- so the FK resolves and the "matched" state is honest.
--
-- WHY DERIVED RATHER THAN HARDCODED IDS
-- A reseed regenerates names and nominees; hardcoded ids would keep resolving
-- (the FK is satisfied) while the NAME on the claim silently stopped matching
-- the member it points at — a wrong demo that still looks right. Selecting the
-- members at apply time cannot drift. Same reasoning as 0098's derived windows.
--
-- SHAPE — 9 rows, 9 distinct members, 9 distinct districts:
--   * 6 pending    — the work queue the card and both surfaces render
--   * 1 in_review  — someone has picked it up but not decided
--   * 1 approved   — terminal, matched
--   * 1 rejected   — terminal, a duplicate filing (see the note on it below)
--   4 funeral + 5 life. Funeral is picked FIRST because it is the scarcer pool
--   (545 active funeral vs 2,730 active life measured live), so picking life
--   first would leave funeral competing for leftovers.
--
-- SAFETY — additive, reversible, safe on live, NO reseed required:
--   * Only ever INSERTs into `nominee_claims`. No other table is read for
--     anything but selection, and none is written.
--   * Every id is `nc-demo-XXXX` and every reference `NC-DEMO-XXXX`, so the down
--     removes exactly these rows and cannot touch a real submitted claim.
--   * ON CONFLICT DO NOTHING on the id — re-applying is a no-op.
--   * No trigger exists on `nominee_claims`, so no balance moves.
--
-- CONVENTIONS
--   * Dates are relative to CURRENT_DATE, not `public._demo_now()` (pinned to
--     2026-05-18 while the ledger runs months past it) — a work queue must read
--     as recent whenever it is demoed. Same choice as 0096/0097/0098.
--   * `relationship` uses the PUBLIC FORM's vocabulary (`RELATIONSHIPS` in
--     src/pages/NomineeClaim.jsx: Spouse | Child | Parent | Sibling | Other
--     relative | Friend), NOT the lowercase `nominees.relationship` enum these
--     rows are derived from. A seeded row must be indistinguishable from one the
--     form could actually produce; the CASE below is that translation.
--   * The deceased is identified by PHONE, with `deceased_nin` NULL on all but
--     one row. That is not laziness: only 22 of 5,064 seeded subscribers carry a
--     NIN, and the table's own CHECK asks for NIN *or* phone precisely because a
--     widow more often has the phone. The one NIN-bearing row exercises the
--     other branch.
--   * `reviewed_by` = 'admin-001' — the demo admin's JWT `sub` (ROLE_DEFAULTS in
--     api/auth/_lib/personas.ts), i.e. exactly what review_nominee_claim() would
--     have written had a human clicked the button.
--
-- Reversed by 0108_nominee_claims_seed.down.sql.
-- =============================================================================

WITH elig AS (
  -- Members who could plausibly be the subject of a claim: active, and carrying
  -- at least one usable death-benefit nominee. WHICH nominee is chosen is
  -- decided per row further down, once the row's script is known.
  SELECT s.id, s.name, s.phone, s.district_id
  FROM public.subscribers s
  WHERE s.is_active
    AND EXISTS (
      SELECT 1 FROM public.nominees n
       WHERE n.subscriber_id = s.id
         AND n.type = 'insurance'      -- the death-benefit nominee; pension is a separate row
         AND n.name <> 'test'          -- a junk row in the live seed
         AND n.phone IS NOT NULL
    )
),
holds AS (
  -- Active DEATH cover only. Life lives in its own table; hospital cash is
  -- excluded by construction — a living member claims that themselves (0099).
  SELECT subscriber_id, 'life'::text AS product
    FROM public.insurance_policies WHERE status = 'active'
  UNION ALL
  SELECT subscriber_id, 'funeral'
    FROM public.subscriber_insurance_products
   WHERE product = 'funeral' AND status = 'active'
),
cand AS (SELECT e.*, h.product FROM elig e JOIN holds h ON h.subscriber_id = e.id),

-- One candidate per district, per product. Without this every pick lands in the
-- same district (candidates order by subscriber id, which is issued in district
-- blocks), and a national platform demos as one town.
fun1 AS (SELECT DISTINCT ON (district_id) * FROM cand WHERE product = 'funeral' ORDER BY district_id, id),
funeral_pick AS (
  -- ⚠️ row_number() in an INNER query, filtered in an OUTER one (the 0098 §8a
  -- lesson) — computed alongside a WHERE on itself it is not yet defined.
  SELECT * FROM (SELECT *, row_number() OVER (ORDER BY md5(id)) AS rn FROM fun1) z WHERE rn <= 4
),
life1 AS (
  SELECT DISTINCT ON (district_id) * FROM cand
   WHERE product = 'life'
     -- Disjoint from the funeral picks on BOTH axes: the same person must not
     -- die twice in one queue, and two deaths in one district reads as an event.
     AND id          NOT IN (SELECT id          FROM funeral_pick)
     AND district_id NOT IN (SELECT district_id FROM funeral_pick)
   ORDER BY district_id, id
),
life_pick AS (
  SELECT * FROM (SELECT *, row_number() OVER (ORDER BY md5(id)) + 4 AS rn FROM life1) z WHERE rn <= 9
),
picked AS (SELECT * FROM funeral_pick UNION ALL SELECT * FROM life_pick),

-- The human half: what happened, when, and what the admin has done about it.
-- `death_days` > `filed_days` on every row — a claim cannot precede the death.
script (rn, status, death_days, filed_days, reviewed_days, with_nin, pref_rel, notes, review_note, matched) AS (
  VALUES
    (1, 'pending',   9,  2,  NULL, false, 'spouse',
     'Burial is on Saturday and we are short for the coffin. Please call me any time.', NULL, false),
    (2, 'pending',   21, 6,  NULL, false, 'child',
     NULL, NULL, false),
    (3, 'pending',   5,  1,  NULL, false, 'sibling',
     'She was admitted in Mbarara for two weeks before she passed away.', NULL, false),
    (4, 'pending',   30, 11, NULL, true,  'child',
     'I am filing for my mother. She has no phone, so please call me instead.', NULL, false),
    (5, 'pending',   14, 4,  NULL, false, 'spouse',
     NULL, NULL, false),
    (6, 'pending',   12, 3,  NULL, false, 'parent',
     'The death certificate is with the LC1 chairperson. I can bring it to any branch.', NULL, false),
    (7, 'in_review', 26, 13, 9,    false, 'spouse',
     'We buried him at home in the village.',
     'Spoke to the family. Waiting on the death certificate from the LC1 before deciding.', true),
    (8, 'approved',  40, 24, 15,   false, 'child',
     NULL,
     'Death certificate seen and the member record matches. Sent to payouts.', true),
    -- Rejected as a DUPLICATE, deliberately. Every other rejection reason a demo
    -- could carry ("no cover", "not our member") contradicts the row's own data,
    -- since these are real members holding real active cover. A second filing by
    -- an anxious family is both realistic and consistent.
    (9, 'rejected',  55, 20, 12,   false, 'other',
     'I filed once already but I did not hear anything, so I am filing again.',
     'Duplicate of an earlier claim from the same family, which was already paid. Called them to explain.', true)
),
claimant AS (
  -- The claimant is ALWAYS one of this member's own nominees — that is what makes
  -- the row matchable against the member record. The script's `pref_rel` only
  -- chooses AMONG them, so the queue shows a natural spread of who turns up
  -- (spouse, child, sibling…) instead of whatever one relationship the seed
  -- happened to order first. A member without the preferred relationship falls
  -- back to a deterministic hash pick, so the row is still real.
  SELECT DISTINCT ON (sc.rn)
         sc.rn,
         n.name  AS claimant_name,
         n.phone AS claimant_phone,
         CASE lower(n.relationship)
           WHEN 'spouse'  THEN 'Spouse'
           WHEN 'child'   THEN 'Child'
           WHEN 'parent'  THEN 'Parent'
           WHEN 'sibling' THEN 'Sibling'
           ELSE 'Other relative'
         END AS relationship
  FROM script sc
  JOIN picked p ON p.rn = sc.rn
  JOIN public.nominees n
    ON n.subscriber_id = p.id
   AND n.type = 'insurance'
   AND n.name <> 'test'
   AND n.phone IS NOT NULL
  ORDER BY sc.rn, (lower(n.relationship) = sc.pref_rel) DESC, md5(n.id)
)
INSERT INTO public.nominee_claims (
  id, reference, product,
  deceased_name, deceased_nin, deceased_phone, date_of_death,
  claimant_name, claimant_nin, claimant_phone, claimant_email, relationship,
  district, notes, status, reviewed_by, reviewed_at, review_note,
  matched_subscriber_id, created_at
)
SELECT
  'nc-demo-'  || to_char(sc.rn, 'FM0000'),
  'NC-DEMO-'  || to_char(sc.rn, 'FM0000'),
  p.product,
  p.name,
  -- The NIN branch: one row carries a checksum-shaped Ugandan NIN so the "we
  -- have their National ID" path is visible. The rest identify by phone.
  CASE WHEN sc.with_nin THEN 'CM' || to_char(sc.rn, 'FM00') || 'A' || upper(substr(md5(p.id), 1, 9)) END,
  p.phone,
  CURRENT_DATE - sc.death_days,
  c.claimant_name,
  NULL,
  c.claimant_phone,
  -- One email in nine. The form makes it optional precisely because a bereaved
  -- relative in Uganda often has none — a fully-populated column would misstate
  -- what actually arrives.
  CASE WHEN sc.rn = 8 THEN lower(replace(split_part(c.claimant_name, ' ', 1), '''', '')) || '.' ||
                            lower(replace(split_part(c.claimant_name, ' ', 2), '''', '')) || '@gmail.com' END,
  c.relationship,
  d.name,
  sc.notes,
  sc.status,
  CASE WHEN sc.status <> 'pending' THEN 'admin-001' END,
  CASE WHEN sc.reviewed_days IS NOT NULL THEN now() - (sc.reviewed_days || ' days')::interval END,
  sc.review_note,
  CASE WHEN sc.matched THEN p.id END,
  now() - (sc.filed_days || ' days')::interval
FROM script sc
JOIN picked p   ON p.rn = sc.rn
JOIN claimant c ON c.rn = sc.rn
LEFT JOIN public.districts d ON d.id = p.district_id
ON CONFLICT (id) DO NOTHING;

-- Fail loudly on an empty seed. A demo fixture that silently inserts nothing —
-- because a reseed emptied a pool, or the nominee/product join stopped matching —
-- is indistinguishable from the empty queue this migration exists to fix. This is
-- the 0096 `expected_by` no-op lesson: assert the write happened.
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.nominee_claims WHERE id LIKE 'nc-demo-%';
  IF v_count = 0 THEN
    RAISE EXCEPTION '0108 seeded no nominee claims — the candidate pool is empty (no active life/funeral holder with an insurance nominee?)';
  END IF;
  RAISE NOTICE '0108: % demo nominee claims present (% pending)',
    v_count,
    (SELECT count(*) FROM public.nominee_claims WHERE id LIKE 'nc-demo-%' AND status = 'pending');
END $$;
