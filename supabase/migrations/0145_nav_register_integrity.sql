-- 0145_nav_register_integrity.sql
-- ============================================================================
-- PHASE 3 of the unitization redesign. The register stops destroying history
-- and starts telling the truth about the days it never priced.
--
-- ⚠️ `nav_for_date` AND `latest_nav` ARE DELIBERATELY NOT TOUCHED HERE.
--    They still carry the last known price backwards, still fall back to the
--    first price ever, and still fall back to the literal 1000. Making them
--    strict in this migration would silently re-price live contributions
--    before a pricing engine exists to queue them. Phase 6 (0147) owns that
--    change, and only once `price_pending_transactions` can catch what falls
--    through. `nav_price_row()` below is the strict lookup, added now and
--    called by nothing.
--
-- THREE THINGS THIS FIXES
-- -----------------------
-- 1. THE REGISTER OVERWRITES ITSELF. `publish_nav_snapshot` re-publishes a date
--    with ON CONFLICT DO UPDATE, so correcting a price DESTROYS the price that
--    was previously published for that day — the one members' money was
--    actually dealt at. `nav_snapshot_versions` keeps every version, append-
--    only, with the superseding version recorded on the row it replaced.
--    `nav_snapshots` keeps exactly one current row per (fund, date), because
--    the unique constraint, the price lookup and the register UI all depend on
--    that.
--
-- 2. MISSING DAYS ARE COUNTED TWO DIFFERENT WRONG WAYS.
--      get_nav_overview.pendingDays counts nav_snapshots rows with
--        status='pending' — so a day with NO ROW AT ALL is invisible, and it
--        compares against CURRENT_DATE (UTC) rather than the Kampala date.
--      nav_unsigned_days() generate_series()es from the published frontier + 1
--        — so a hole BEHIND the frontier can never appear, no matter how long
--        it sits there.
--    A fund that skips a Tuesday and publishes Wednesday has a permanent,
--    invisible hole under both definitions. `nav_missing_days()` walks the
--    requested range as business days and LEFT JOINs the register, so it sees
--    holes wherever they are; both callers are re-pointed at it, which also
--    means the badge and the tile can no longer disagree.
--
-- 3. `nav_unsigned_days` HARDCODED WEEKENDS as `isodow < 6` and knew nothing
--    about public holidays, so every Ugandan holiday showed up as an unsigned
--    day the admin could never clear. It now shares `is_business_day()` with
--    the dealing-date rule, so the calendar has exactly one definition.
--
-- publish_nav_snapshot keeps EVERY existing guard, unchanged and in the same
-- order: assert_finite_money, the kampala_today() future-date guard, the row
-- lock, the +-10% p_confirm_move gate, and assert_book_revaluable. This
-- migration adds a version row and two zero-valued counters to its result; it
-- weakens nothing. The counters are wired to the engine in 0147.
--
-- ROLLBACK: 0145_nav_register_integrity.down.sql drops nav_snapshot_versions
-- and restores all three functions to their pre-0145 bodies verbatim from the
-- live catalog. The frontend is additive and reverts independently.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) nav_snapshot_versions — append-only history of the register
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nav_snapshot_versions (
  id            TEXT PRIMARY KEY DEFAULT ('navv-' || replace(gen_random_uuid()::text, '-', '')),
  snapshot_id   TEXT NOT NULL REFERENCES public.nav_snapshots(id) ON DELETE CASCADE,
  fund_code     TEXT NOT NULL,
  nav_date      DATE NOT NULL,
  unit_price    NUMERIC NOT NULL,
  status        TEXT NOT NULL,
  source        TEXT,
  published_by  TEXT,
  published_at  TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,          -- NULL = this is the current version
  superseded_by TEXT,                 -- the version row that replaced it
  version_no    INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, version_no)
);

CREATE INDEX IF NOT EXISTS ix_nav_snapshot_versions_lookup
  ON public.nav_snapshot_versions (fund_code, nav_date, version_no DESC);

ALTER TABLE public.nav_snapshot_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nav_snapshot_versions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nav_snapshot_versions_select_admin ON public.nav_snapshot_versions;
CREATE POLICY nav_snapshot_versions_select_admin ON public.nav_snapshot_versions
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

REVOKE ALL    ON public.nav_snapshot_versions FROM PUBLIC, anon;
GRANT  SELECT ON public.nav_snapshot_versions TO authenticated;

COMMENT ON TABLE public.nav_snapshot_versions IS
  'Append-only history of every price ever published for a (fund, date). nav_snapshots holds the CURRENT version; this holds all of them. Nothing here is ever updated except superseded_at/superseded_by on the row being replaced, and nothing is ever deleted except by cascade when the snapshot itself goes.';

-- Backfill: every existing register row becomes version 1, current.
INSERT INTO public.nav_snapshot_versions
  (snapshot_id, fund_code, nav_date, unit_price, status, source, published_by, published_at, version_no)
SELECT n.id, n.fund_code, n.nav_date, n.unit_price, n.status, n.source, n.published_by, n.published_at, 1
  FROM public.nav_snapshots n
 WHERE NOT EXISTS (SELECT 1 FROM public.nav_snapshot_versions v WHERE v.snapshot_id = n.id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) nav_price_row — the STRICT lookup (added now, called by nothing)
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns the published price for EXACTLY that date, or zero rows. No backward
-- carry, no earliest-price fallback, no literal. It returns the snapshot id
-- alongside the price so the engine can record which register row it dealt
-- against in one lookup rather than two.
CREATE OR REPLACE FUNCTION public.nav_price_row(
  p_date DATE,
  p_fund TEXT DEFAULT 'UPU-BAL'
) RETURNS TABLE (id TEXT, unit_price NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.id, n.unit_price
    FROM public.nav_snapshots n
   WHERE n.fund_code = p_fund
     AND n.nav_date  = p_date
     AND n.status    = 'published'
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.nav_price_row(DATE, TEXT) IS
  'STRICT price lookup: the published price for exactly p_date, or NO ROWS. This is the dealing-price authority from 0147. Contrast nav_for_date(), which carries backwards and is being retired as a pricing input.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) nav_missing_days — one honest definition of "we never priced that day"
-- ─────────────────────────────────────────────────────────────────────────────
-- Walks [p_from, p_to] as BUSINESS days (shared with the dealing-date rule, so
-- holidays are excluded for both) and LEFT JOINs the register. A day with no
-- row comes back 'unpriced'; a day with a non-published row comes back with its
-- actual status. Because the range is given rather than derived from the
-- frontier, a hole BEHIND the frontier is visible — which is the whole point.
CREATE OR REPLACE FUNCTION public.nav_missing_days(
  p_fund TEXT DEFAULT 'UPU-BAL',
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
) RETURNS TABLE (nav_date DATE, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT COALESCE(p_from, (SELECT min(n.nav_date) FROM public.nav_snapshots n
                              WHERE n.fund_code = p_fund AND n.status = 'published')) AS lo,
           COALESCE(p_to, public.kampala_today()) AS hi
  ),
  days AS (
    SELECT d::date AS nav_date
      FROM bounds b, generate_series(b.lo, b.hi, INTERVAL '1 day') d
     WHERE b.lo IS NOT NULL AND public.is_business_day(d::date)
  )
  SELECT d.nav_date, COALESCE(n.status, 'unpriced')::text
    FROM days d
    LEFT JOIN public.nav_snapshots n
           ON n.fund_code = p_fund AND n.nav_date = d.nav_date AND n.status = 'published'
   WHERE n.id IS NULL
   ORDER BY d.nav_date;
$$;

COMMENT ON FUNCTION public.nav_missing_days(TEXT, DATE, DATE) IS
  'Business days in [p_from, p_to] with no PUBLISHED price. Replaces both broken detectors: get_nav_overview.pendingDays could only see rows that exist, and nav_unsigned_days() started its series at the published frontier so a hole behind it was permanently invisible.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) nav_unsigned_days — same answer as the tile, now holiday-aware
-- ─────────────────────────────────────────────────────────────────────────────
-- Reimplemented over nav_missing_days so the "Days not priced" tile and the
-- Needs-attention badge cannot report different numbers again. The navStaleDays
-- grace period and the pending-row union are preserved; the hand-rolled
-- `isodow < 6` weekday test is not, because is_business_day() knows about
-- public holidays and it did not.
CREATE OR REPLACE FUNCTION public.nav_unsigned_days(p_fund_code TEXT DEFAULT 'UPU-BAL')
RETURNS TABLE (nav_date DATE, snapshot_id TEXT, unit_price NUMERIC, source TEXT, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH grace AS (
    SELECT GREATEST(COALESCE((public._admin_attention_thresholds() ->> 'navStaleDays')::int, 1), 0) AS days
  ),
  missing AS (
    SELECT m.nav_date
      FROM grace g,
           public.nav_missing_days(
             p_fund_code,
             (SELECT min(n.nav_date) FROM public.nav_snapshots n
               WHERE n.fund_code = p_fund_code AND n.status = 'published'),
             public.kampala_today() - g.days) m
  ),
  pending_rows AS (
    SELECT n.nav_date
      FROM public.nav_snapshots n
     WHERE n.fund_code = p_fund_code
       AND n.status = 'pending'
       AND n.nav_date < public.kampala_today()
  ),
  days AS (
    SELECT nav_date FROM missing
    UNION
    SELECT nav_date FROM pending_rows
  )
  SELECT d.nav_date, n.id, n.unit_price, n.source, COALESCE(n.status, 'unpriced')
    FROM days d
    LEFT JOIN public.nav_snapshots n
           ON n.fund_code = p_fund_code AND n.nav_date = d.nav_date
   ORDER BY d.nav_date;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) publish_nav_snapshot — same guards, now it keeps history
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-emitted from its 0116 body. EVERY guard is preserved verbatim and in the
-- same order: assert_finite_money, the kampala_today() future-date guard, the
-- FOR UPDATE serialisation, the +-10% p_confirm_move gate, and
-- assert_book_revaluable before the whole-book rewrite. Nothing here weakens
-- any of them.
--
-- Three additions, each marked `0145:`:
--   (i)   a version row on every publish, with the previous version stamped
--         superseded — so correcting a price no longer destroys the price
--         members' money was actually dealt at;
--   (ii)  `priceVersion` in the result, so the UI can say "correction #2";
--   (iii) releasedContributions / releasedRedemptions, zero until 0147 wires
--         the pricing engine in. They exist now so the client contract does
--         not change in the same migration that changes money behaviour.
CREATE OR REPLACE FUNCTION public.publish_nav_snapshot(
  p_nav_date DATE,
  p_unit_price NUMERIC,
  p_fund_code TEXT DEFAULT 'UPU-BAL',
  p_source TEXT DEFAULT 'admin_manual',
  p_confirm_move BOOLEAN DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role       TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_actor      TEXT := COALESCE((SELECT auth.jwt()) ->> 'name', 'admin');
  v_prev_price NUMERIC;
  v_prev_date  DATE;
  v_book_price NUMERIC;   -- 0116/A04-003: the price the BOOK is carried at
  v_move       NUMERIC := NULL;
  v_newest     DATE;
  v_is_newest  BOOLEAN;
  v_id         TEXT;
  v_units      NUMERIC;
  v_aum        NUMERIC;
  v_members    INTEGER;
  v_version    INTEGER;   -- 0145
  v_version_id TEXT;      -- 0145
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot publish a unit price', v_role USING ERRCODE = 'P0001';
  END IF;
  -- 0116 / A04-005 — the guard that stood here was INERT against NaN.
  -- `'NaN'::numeric <= 0` is FALSE in Postgres because NaN sorts ABOVE every
  -- numeric, so a NaN price walked straight past it and, with p_confirm_move,
  -- drove all 5,060 subscriber_balances rows to NaN in one statement.
  -- 0114's shared guard rejects NULL / NaN / +-Infinity by EXPLICIT EQUALITY,
  -- which is the only form that works (`NOT (x > 0)` does not fire either).
  -- 0114's nav_snapshots_unit_price_finite_chk is the table-level backstop;
  -- this call exists so the admin reads a sentence, not a constraint violation.
  -- p_whole_shillings => false: a unit price legitimately carries decimals.
  PERFORM public.assert_finite_money(p_unit_price, 'unit price', 0.01, 1000000, false);

  -- 0116 / A04-015 (server half) — this database's session timezone is UTC
  -- (verified live) but the fund prices on the Kampala calendar (UTC+3, no
  -- DST). Between 00:00 and 03:00 local, CURRENT_DATE is still YESTERDAY, so
  -- this guard rejected a perfectly legitimate same-day publish. The client
  -- half of A04-015 lives in AdminNavDesktop.jsx and is fixed in 0145's
  -- frontend commit.
  IF p_nav_date IS NULL OR p_nav_date > public.kampala_today() THEN
    RAISE EXCEPTION 'cannot publish a price for a future date' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise concurrent publishes on this fund so two admins cannot interleave
  -- a revaluation between each other's register write.
  PERFORM 1 FROM public.nav_snapshots
   WHERE fund_code = p_fund_code FOR UPDATE;

  SELECT unit_price, nav_date INTO v_prev_price, v_prev_date
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published' AND nav_date < p_nav_date
   ORDER BY nav_date DESC LIMIT 1;

  IF v_prev_price IS NOT NULL AND v_prev_price > 0 THEN
    v_move := round(((p_unit_price - v_prev_price) / v_prev_price) * 100, 4);
    -- Server-side guard-rail. The client confirm dialog is a courtesy; THIS is
    -- the gate, so a scripted or replayed call cannot skip it.
    IF abs(v_move) > 10 AND NOT p_confirm_move THEN
      RAISE EXCEPTION
        'price move of %%% from % on % needs confirmation',
        round(v_move, 2), v_prev_price, v_prev_date
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 0116 / A04-003 — capture the price the BOOK is currently carried at BEFORE
  -- the register write below moves the published frontier. After the INSERT
  -- this row IS the newest published price, so the comparison would be against
  -- itself and prove nothing.
  SELECT unit_price INTO v_book_price
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  -- Re-publishing a day CORRECTS it, and flips a 'pending' day to 'published' —
  -- which is exactly how the admin clears a "Delayed NAV updation" signal.
  INSERT INTO public.nav_snapshots
    (fund_code, nav_date, unit_price, status, published_at, source, published_by)
  VALUES
    (p_fund_code, p_nav_date, p_unit_price, 'published', now(), p_source, v_actor)
  ON CONFLICT (fund_code, nav_date) DO UPDATE SET
    unit_price   = EXCLUDED.unit_price,
    status       = 'published',
    published_at = now(),
    source       = EXCLUDED.source,
    published_by = EXCLUDED.published_by
  RETURNING id INTO v_id;

  -- 0145 (i): append the new version, then stamp every older current version as
  -- superseded BY it. The UPDATE runs second and excludes v_version itself, so
  -- the row just written stays current. Nothing is ever overwritten here — the
  -- ON CONFLICT above is the only destructive write left, and this table is
  -- what makes it recoverable.
  SELECT COALESCE(max(version_no), 0) + 1 INTO v_version
    FROM public.nav_snapshot_versions WHERE snapshot_id = v_id;

  INSERT INTO public.nav_snapshot_versions
    (snapshot_id, fund_code, nav_date, unit_price, status, source, published_by, published_at, version_no)
  VALUES
    (v_id, p_fund_code, p_nav_date, p_unit_price, 'published', p_source, v_actor, now(), v_version)
  RETURNING id INTO v_version_id;

  UPDATE public.nav_snapshot_versions
     SET superseded_at = now(), superseded_by = v_version_id
   WHERE snapshot_id = v_id AND version_no < v_version AND superseded_at IS NULL;

  -- Revalue ONLY when this is now the newest published day. A back-dated
  -- correction must not restate today's book at a stale price.
  SELECT max(nav_date) INTO v_newest
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published';
  v_is_newest := (v_newest = p_nav_date);

  IF v_is_newest AND p_fund_code = 'UPU-BAL' THEN
    -- 0116 / A04-003 — REFUSE rather than silently revalue units that were
    -- never priced at a real NAV. A reseed writes units at the dead 1,000 UGX
    -- literal and leaves both bucket-unit columns at their 0 default; the next
    -- publish then multiplied those units by the real NAV and inflated AUM 57%
    -- while zeroing every member's retirement pot. Everything below this line
    -- is a whole-book rewrite, so this is the last place to stop it.
    PERFORM public.assert_book_revaluable(p_fund_code, v_book_price);

    -- Complement rule: round the total and the retirement leg, then take
    -- emergency as the difference. Rounding all three independently is what
    -- would trip v_reconciliation_exceptions.split_mismatch across 5,060 rows.
    UPDATE public.subscriber_balances
       SET total_balance      = round(units * p_unit_price),
           retirement_balance = round(retirement_units * p_unit_price),
           emergency_balance  = round(units * p_unit_price)
                                - round(retirement_units * p_unit_price),
           nav_as_of          = p_nav_date,
           updated_at         = now()
     WHERE subscriber_id IS NOT NULL;

    -- 0072 [H3] parity: a NAV fall can push emergency_balance below an already
    -- accrued save-to-cover target, which would let the next contribution sweep
    -- money that is no longer in the bucket. Same clamp request_withdrawal does.
    UPDATE public.contribution_schedules s
       SET insurance_premium_accrued = LEAST(
             s.insurance_premium_accrued,
             GREATEST(0, (SELECT b.emergency_balance FROM public.subscriber_balances b
                           WHERE b.subscriber_id = s.subscriber_id))),
           updated_at = now()
     WHERE s.insurance_funding_mode = 'save_to_cover';

    -- Denormalised per-member copy of the fund price. Permitted because the
    -- editable-columns trigger returns early for a non-'subscriber' role.
    UPDATE public.subscribers
       SET current_unit_value = p_unit_price,
           unit_value_as_of   = now()
     WHERE id IS NOT NULL;
  END IF;

  SELECT COALESCE(sum(units), 0), COALESCE(sum(total_balance), 0), count(*)
    INTO v_units, v_aum, v_members
    FROM public.subscriber_balances;

  UPDATE public.nav_snapshots
     SET units_in_issue = v_units, aum = v_aum, members_priced = v_members
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'id',                v_id,
    'fundCode',          p_fund_code,
    'navDate',           to_char(p_nav_date, 'YYYY-MM-DD'),
    'unitPrice',         p_unit_price,
    'previousUnitPrice', v_prev_price,
    'previousNavDate',   to_char(v_prev_date, 'YYYY-MM-DD'),
    'changePct',         v_move,
    'revalued',          v_is_newest,
    'unitsInIssue',      v_units,
    'aum',               v_aum,
    'membersPriced',     v_members,
    -- 0145 (ii): 1 on a first publish, 2+ on a correction.
    'priceVersion',           v_version,
    -- 0145 (iii): wired to price_pending_transactions() in 0147. Zero here,
    -- because nothing can be pending until the engine exists.
    'releasedContributions',  0,
    'releasedRedemptions',    0
  );
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) get_nav_overview — the tile now counts the same days as the badge
-- ─────────────────────────────────────────────────────────────────────────────
-- Two changes, both marked `0145:`. Everything else is the 0107 body verbatim,
-- including the deliberate pooled-vs-average growth distinction.
CREATE OR REPLACE FUNCTION public.get_nav_overview(p_fund_code TEXT DEFAULT 'UPU-BAL')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   TEXT := (SELECT auth.jwt()) ->> 'app_role';
  v_cur    RECORD;
  v_prev   RECORD;
  v_result JSONB;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read the NAV overview', v_role USING ERRCODE = 'P0001';
  END IF;

  SELECT unit_price, nav_date INTO v_cur
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
   ORDER BY nav_date DESC LIMIT 1;

  SELECT unit_price, nav_date INTO v_prev
    FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published'
     AND nav_date < COALESCE(v_cur.nav_date, public.kampala_today())
   ORDER BY nav_date DESC LIMIT 1;

  SELECT jsonb_build_object(
    'fundCode',       p_fund_code,
    'currentNav',     v_cur.unit_price,
    'currentNavDate', to_char(v_cur.nav_date, 'YYYY-MM-DD'),
    'previousNav',    v_prev.unit_price,
    'previousNavDate',to_char(v_prev.nav_date, 'YYYY-MM-DD'),
    'changeAbs',      CASE WHEN v_prev.unit_price IS NOT NULL
                        THEN round(v_cur.unit_price - v_prev.unit_price, 2) END,
    'changePct',      CASE WHEN COALESCE(v_prev.unit_price, 0) > 0
                        THEN round(((v_cur.unit_price - v_prev.unit_price) / v_prev.unit_price) * 100, 2) END,
    'unitsInIssue',   b.units,
    'aum',            b.aum,
    'totalInvested',  b.invested,
    'totalGrowth',    b.aum - b.invested,
    'growthPct',      CASE WHEN b.invested > 0
                        THEN round(((b.aum - b.invested) / b.invested) * 100, 2) ELSE 0 END,
    'membersPriced',  b.priced,
    'membersUnpriced',b.unpriced,
    'avgGrowthPct',   round(b.avg_growth_pct, 2),
    'membersWithBasis', b.with_basis,
    'firstNavDate',   to_char(r.first_date, 'YYYY-MM-DD'),
    'publishedCount', r.published_count,
    -- 0145: was count(nav_snapshots WHERE status='pending' AND nav_date <
    -- CURRENT_DATE), which could only ever see days that HAVE a row — a day the
    -- fund simply never priced was invisible — and compared against the UTC
    -- date. Now it is the same function the Needs-attention badge reads.
    'pendingDays',    m.pending_days,
    'missingDays',    m.missing_days,
    -- 0145: kampala_today(), not CURRENT_DATE. Between 00:00 and 03:00 local
    -- the UTC date is still yesterday, so this read one day short.
    'lastPublishedDaysAgo', public.kampala_today() - v_cur.nav_date,
    'series',         COALESCE(s.series, '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT COALESCE(sum(units), 0)         AS units,
           COALESCE(sum(total_balance), 0) AS aum,
           COALESCE(sum(invested), 0)      AS invested,
           count(*) FILTER (WHERE nav_as_of IS NOT NULL) AS priced,
           count(*) FILTER (WHERE nav_as_of IS NULL)     AS unpriced,
           -- 0107: the AVERAGE of each member's OWN growth%, which is what the
           -- admin page reports. Deliberately DISTINCT from the pooled figure
           -- (total growth / total basis) kept below: pooled is money-weighted,
           -- so a handful of large, long-tenured balances pull it away from what
           -- a typical member actually sees. Measured live 2026-08-08: pooled
           -- 9.63% vs average-per-member 9.38%.
           -- Members with no cost basis are EXCLUDED, not counted as 0% — they
           -- would drag the mean toward zero without any member experiencing it.
           COALESCE(avg(((total_balance - invested) / invested) * 100)
                      FILTER (WHERE invested > 0), 0)     AS avg_growth_pct,
           count(*) FILTER (WHERE invested > 0)           AS with_basis
      FROM public.subscriber_balances
  ) b,
  (
    SELECT min(nav_date) FILTER (WHERE status = 'published') AS first_date,
           count(*)      FILTER (WHERE status = 'published') AS published_count
      FROM public.nav_snapshots WHERE fund_code = p_fund_code
  ) r,
  (
    SELECT count(*)::int AS pending_days,
           COALESCE(jsonb_agg(to_char(md.nav_date, 'YYYY-MM-DD') ORDER BY md.nav_date), '[]'::jsonb)
             AS missing_days
      FROM public.nav_missing_days(
             p_fund_code,
             (SELECT min(n2.nav_date) FROM public.nav_snapshots n2
               WHERE n2.fund_code = p_fund_code AND n2.status = 'published'),
             public.kampala_today()) md
  ) m,
  (
    SELECT jsonb_agg(jsonb_build_object(
             'date',      to_char(q.nav_date, 'YYYY-MM-DD'),
             'unitPrice', q.unit_price,
             'aum',       q.aum) ORDER BY q.nav_date) AS series
      FROM (
        SELECT nav_date, unit_price, aum
          FROM public.nav_snapshots
         WHERE fund_code = p_fund_code AND status = 'published'
         ORDER BY nav_date DESC LIMIT 260
      ) q
  ) s;

  RETURN v_result;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Grants
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL     ON FUNCTION public.nav_price_row(DATE, TEXT)              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nav_price_row(DATE, TEXT)              TO authenticated;
REVOKE ALL     ON FUNCTION public.nav_missing_days(TEXT, DATE, DATE)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nav_missing_days(TEXT, DATE, DATE)     TO authenticated;
