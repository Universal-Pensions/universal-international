-- DOWN for 0145_nav_register_integrity.sql
-- ============================================================================
-- Restores the three functions to their exact pre-0145 bodies and drops the
-- version history.
--
-- REGRESSION WARNING — this is not a neutral reversal. Running it:
--   * re-breaks missing-day detection in BOTH of its original wrong ways: the
--     tile goes back to counting only rows that exist, and nav_unsigned_days()
--     goes back to starting its series at the published frontier, so a hole
--     behind the frontier becomes permanently invisible again;
--   * re-hardcodes `isodow < 6`, so every Ugandan public holiday reappears as
--     an unsigned day the admin cannot clear;
--   * puts `CURRENT_DATE` back in place of kampala_today(), so between 00:00
--     and 03:00 Kampala the staleness figure reads one day short;
--   * DESTROYS the price history. Every superseded price recorded since 0145
--     goes with the table, and those are the prices members' money was
--     actually dealt at. There is no other copy — nav_snapshots holds only the
--     current version per day. Dump it first if any correction has been
--     published:
--         CREATE TABLE _nav_versions_backup AS
--           SELECT * FROM public.nav_snapshot_versions;
--     (and give it RLS — see 0127.)
--
-- SAFE in one respect: no balance, unit count or price on the CURRENT register
-- changes. nav_for_date and latest_nav were never touched by 0145.
--
-- The three bodies below are reproduced VERBATIM from the live catalog
-- (pg_get_functiondef) as they stood immediately before 0145 — generated, not
-- retyped.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_nav_overview(p_fund_code text DEFAULT 'UPU-BAL'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
     AND nav_date < COALESCE(v_cur.nav_date, CURRENT_DATE)
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
    'pendingDays',    r.pending_days,
    'lastPublishedDaysAgo', CURRENT_DATE - v_cur.nav_date,
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
    SELECT min(nav_date) FILTER (WHERE status = 'published')                       AS first_date,
           count(*)      FILTER (WHERE status = 'published')                       AS published_count,
           count(*)      FILTER (WHERE status = 'pending' AND nav_date < CURRENT_DATE) AS pending_days
      FROM public.nav_snapshots WHERE fund_code = p_fund_code
  ) r,
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

CREATE OR REPLACE FUNCTION public.nav_unsigned_days(p_fund_code text DEFAULT 'UPU-BAL'::text)
 RETURNS TABLE(nav_date date, snapshot_id text, unit_price numeric, source text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH frontier AS (
    SELECT max(n.nav_date) AS last_published
      FROM public.nav_snapshots n
     WHERE n.fund_code = p_fund_code AND n.status = 'published'
  ),
  grace AS (
    SELECT GREATEST(COALESCE((public._admin_attention_thresholds() ->> 'navStaleDays')::int, 1), 0) AS days
  ),
  overdue_weekdays AS (
    SELECT d::date AS nav_date
      FROM frontier f, grace g,
           generate_series(
             COALESCE(f.last_published, public.kampala_today()) + 1,
             public.kampala_today() - g.days,
             INTERVAL '1 day') d
     WHERE extract(isodow FROM d) < 6          -- Mon..Fri; the fund does not price weekends
  ),
  pending_rows AS (
    SELECT n.nav_date
      FROM public.nav_snapshots n
     WHERE n.fund_code = p_fund_code
       AND n.status = 'pending'
       AND n.nav_date < public.kampala_today()
  ),
  days AS (
    SELECT o.nav_date FROM overdue_weekdays o
    UNION
    SELECT p.nav_date FROM pending_rows p
  )
  SELECT d.nav_date,
         n.id,
         n.unit_price,
         n.source,
         COALESCE(n.status, 'unpriced')
    FROM days d
    LEFT JOIN public.nav_snapshots n
           ON n.fund_code = p_fund_code AND n.nav_date = d.nav_date
   ORDER BY d.nav_date;
$function$;

CREATE OR REPLACE FUNCTION public.publish_nav_snapshot(p_nav_date date, p_unit_price numeric, p_fund_code text DEFAULT 'UPU-BAL'::text, p_source text DEFAULT 'admin_manual'::text, p_confirm_move boolean DEFAULT false)
 RETURNS jsonb
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
  -- half of A04-015 lives in AdminNavDesktop.jsx and is escalated separately.
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
    'membersPriced',     v_members
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.nav_missing_days(TEXT, DATE, DATE);
DROP FUNCTION IF EXISTS public.nav_price_row(DATE, TEXT);

DROP TABLE IF EXISTS public.nav_snapshot_versions;
