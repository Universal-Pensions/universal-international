-- 0162_nav_missed_day_resolutions.sql
-- ============================================================================
-- "Delayed NAV updation" nags forever.
--
-- THE DEFECT
-- ----------
-- The admin Needs-attention drill-down for delayedNav offers exactly one
-- action, Escalate, which sends a notification to the Fund Administration ops
-- queue and deliberately changes nothing about the signal. The ONLY way a day
-- leaves that list is for someone to publish a price for it
-- (publish_nav_snapshot). So a day that will never be priced — the fund did
-- not deal, the feed was confirmed missing, the gap was investigated and
-- closed — sits in the queue permanently, and the badge never returns to zero.
--
-- An admin had no way to say "looked at it, it is closed" that did not involve
-- inventing a unit price, which would falsify the register and revalue members'
-- money.
--
-- THE FIX
-- -------
-- A resolution is recorded against the DATE, in its own table, and the
-- Needs-attention COUNT skips resolved days. Everything else keeps telling the
-- truth. This rests on a seam that already exists in the schema:
--
--   nav_unsigned_days()  -> read ONLY by get_admin_attention (the badge) and
--                           get_admin_attention_rows (the drill-down)
--   nav_missing_days()   -> read by get_nav_overview (the Unit-price page's
--                           "Days with no published price" chips) and by
--                           forward_dealing_readiness()
--
-- Only the first is made resolution-aware. The Unit-price page still lists the
-- day as unpriced and forward dealing still treats it as a blocker, so
-- resolving silences a nag and can never misreport the book as complete.
--
-- WHY A TABLE KEYED ON (fund_code, nav_date)
-- ------------------------------------------
-- Most flagged days have NO nav_snapshots row at all — nothing in the platform
-- creates a pending row per weekday, so the drill-down synthesises the id
-- ('nav-unpriced-YYYYMMDD') and u.snapshot_id is NULL. There is therefore
-- nothing to hang a resolved_at column off, and nav_snapshot_versions cannot
-- serve either: its FK requires an existing nav_snapshots.id. The resolution
-- has to be keyed on the date itself.
--
-- RESOLVE IS FINAL. There is no reopen RPC, by product decision. The UI asks
-- for confirmation before calling this, which is the only guard against a
-- mis-click — do not turn that into a one-click action.
--
-- The two attention function bodies below were extracted VERBATIM from 0116
-- (whose bodies were md5-verified byte-identical to live on 2026-09-03:
-- get_admin_attention 7dec00c9…, get_admin_attention_rows dedfcae8…) and
-- patched by anchored replacement. Only the nav_late CTE and the delayedNav
-- branch differ; every other byte is unchanged. Regenerate rather than
-- hand-edit: scripts kept alongside this migration in the session notes.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The record of a missed valuation day that was closed out
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nav_missed_day_resolutions (
  fund_code   TEXT        NOT NULL DEFAULT 'UPU-BAL',
  nav_date    DATE        NOT NULL,
  note        TEXT,
  resolved_by TEXT        NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fund_code, nav_date)
);

ALTER TABLE public.nav_missed_day_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nav_missed_day_resolutions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nav_missed_day_resolutions_select_admin ON public.nav_missed_day_resolutions;
CREATE POLICY nav_missed_day_resolutions_select_admin ON public.nav_missed_day_resolutions
  FOR SELECT USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin');

REVOKE ALL    ON public.nav_missed_day_resolutions FROM PUBLIC, anon;
GRANT  SELECT ON public.nav_missed_day_resolutions TO authenticated;

COMMENT ON TABLE public.nav_missed_day_resolutions IS
  'One row per valuation day an admin has closed out without a price. Silences that day in the Needs-attention badge ONLY: the day remains unpriced in nav_snapshots, still appears in get_nav_overview''s "no published price" list, and is still a forward_dealing_readiness blocker. Written only by resolve_nav_missed_day(); there is no reopen.';

COMMENT ON COLUMN public.nav_missed_day_resolutions.note IS
  'Optional free-text reason, capped at 500 chars. Optional by product decision - an admin closing an obvious non-dealing day should not be forced to narrate it.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) resolve_nav_missed_day — the only writer
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_nav_missed_day(
  p_nav_date  DATE,
  p_note      TEXT DEFAULT NULL,
  p_fund_code TEXT DEFAULT 'UPU-BAL'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     text := (SELECT auth.jwt()) ->> 'app_role';
  v_who      text := COALESCE(NULLIF(btrim(COALESCE((SELECT auth.jwt()) ->> 'sub', '')), ''), 'admin');
  v_note     text := NULLIF(left(btrim(COALESCE(p_note, '')), 500), '');
  v_status   text;
  v_existing public.nav_missed_day_resolutions%ROWTYPE;
  v_row      public.nav_missed_day_resolutions%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot resolve a missed valuation day', COALESCE(v_role, '(none)')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_nav_date IS NULL THEN
    RAISE EXCEPTION 'a valuation date is required' USING ERRCODE = 'P0001';
  END IF;

  -- Only a day the signal is ACTUALLY flagging may be resolved. Without this an
  -- admin could pre-resolve arbitrary future dates and blind the signal for
  -- good — the resolution is keyed on a bare date, so nothing else constrains
  -- which dates are writable.
  SELECT u.status INTO v_status
    FROM public.nav_unsigned_days(p_fund_code) u
   WHERE u.nav_date = p_nav_date;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'valuation day % is not currently flagged as missing',
      to_char(p_nav_date, 'DD Mon YYYY') USING ERRCODE = 'P0002';
  END IF;

  -- A 'pending' day is NOT a missing price — fund administration has already
  -- sent one and it is sitting unconfirmed. Publishing it is a single click and
  -- actually fixes the day; resolving it would bury the one case where the
  -- signal was pointing at real, actionable work. Refuse and say which door to
  -- use. This is the guard that stops Resolve becoming a way to hide money
  -- that is genuinely stuck waiting on a price.
  IF v_status = 'pending' THEN
    RAISE EXCEPTION 'valuation day % already has a price waiting for sign-off — publish it instead of resolving it',
      to_char(p_nav_date, 'DD Mon YYYY') USING ERRCODE = 'P0001';
  END IF;

  -- ON CONFLICT rather than a SELECT ... FOR UPDATE probe: the row may not
  -- exist yet, so there would be nothing to lock, and two admins resolving the
  -- same day would race into a raw 23505.
  INSERT INTO public.nav_missed_day_resolutions (fund_code, nav_date, note, resolved_by)
  VALUES (p_fund_code, p_nav_date, v_note, v_who)
  ON CONFLICT (fund_code, nav_date) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.nav_date IS NULL THEN
    SELECT * INTO v_existing FROM public.nav_missed_day_resolutions
     WHERE fund_code = p_fund_code AND nav_date = p_nav_date;
    RAISE EXCEPTION 'valuation day % was already resolved on %',
      to_char(p_nav_date, 'DD Mon YYYY'),
      to_char(v_existing.resolved_at AT TIME ZONE 'Africa/Kampala', 'DD Mon YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'fundCode',   v_row.fund_code,
    'navDate',    v_row.nav_date,
    'note',       v_row.note,
    'resolvedBy', v_row.resolved_by,
    'resolvedAt', v_row.resolved_at
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_nav_missed_day(date, text, text) IS
  'Closes out one missing valuation day so it stops counting in the admin Needs-attention badge. Refuses a date the signal is not currently flagging, and refuses a second resolution of the same day. Does NOT publish a price and does NOT change nav_snapshots.';

-- REVOKE FROM PUBLIC first: a bare REVOKE ... FROM anon is a silent no-op
-- against the default PUBLIC grant (0094 measured 7 of 20 functions still
-- anon-executable after exactly that mistake).
REVOKE ALL     ON FUNCTION public.resolve_nav_missed_day(date, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_nav_missed_day(date, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.resolve_nav_missed_day(date, text, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) get_admin_attention — the badge skips resolved days
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_attention()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := (SELECT auth.jwt()) ->> 'app_role';
  v_today  date := CURRENT_DATE;
  v_result jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read platform attention', v_role USING ERRCODE = 'P0001';
  END IF;

  WITH
  -- #1 Dormant members.
  -- NOTE: this is the is_active flag, NOT a "no contribution in N days" recency
  -- test. Recency was measured and rejected: 5,000 of 5,063 members carry a
  -- last_contribution_date inside 30 days and the transaction ledger agrees, so
  -- every threshold from 60 to 120 days returns the same 47 rows. The flag is
  -- the only column with real spread (1,096 on live) and is what the card has
  -- always shown.
  dormant AS (
    SELECT count(*) AS n FROM public.subscribers WHERE NOT is_active
  ),

  -- #2 Employers past their payroll cadence (never run, or last run too old).
  emp_late AS (
    SELECT count(*) AS n
    FROM public.employers e
    LEFT JOIN LATERAL (
      SELECT max(r.run_at) AS last_run
      FROM public.contribution_runs r
      WHERE r.employer_id = e.id AND r.status = 'completed'
    ) lr ON TRUE
    WHERE COALESCE(e.status, 'active') <> 'inactive'
      AND (lr.last_run IS NULL
           OR lr.last_run::date < v_today - public._employer_grace_days(e.payroll_cadence))
  ),

  -- #3 Valuation days still unsigned after the day itself has passed.
  -- 0116 / A04-007 — this counted ONLY pre-seeded `pending` rows. Nothing in
  -- the platform creates a pending row per weekday, so on 2026-08-24 it read
  -- "4" while ELEVEN weekdays had no nav_snapshots row at ALL and the fund had
  -- been unpriced for 16 days. The fund could stay unpriced forever without
  -- the number ever moving. public.nav_unsigned_days() enumerates every
  -- overdue weekday since the last SIGNED-OFF price, whether or not a row
  -- exists for it, and get_admin_attention_rows lists exactly that same set so
  -- the badge and the drill-down can never disagree again.
  -- 0162 — a day an admin has explicitly RESOLVED stops counting here, so the
  -- Needs-attention badge can be cleared without falsifying the register. The
  -- day itself stays unpriced and keeps showing in the drill-down flagged
  -- 'resolved'; nav_missing_days(), get_nav_overview's "no published price"
  -- chip list and forward_dealing_readiness() read the RAW truth and are
  -- deliberately untouched, so this can never report the book as complete.
  nav_late AS (
    SELECT count(*) AS n
      FROM public.nav_unsigned_days('UPU-BAL') u
      LEFT JOIN public.nav_missed_day_resolutions r
             ON r.fund_code = 'UPU-BAL' AND r.nav_date = u.nav_date
     WHERE r.nav_date IS NULL
  ),
  nav_frontier AS (
    SELECT max(nav_date) AS last_published FROM public.nav_snapshots
     WHERE fund_code = 'UPU-BAL' AND status = 'published'
  ),

  -- #5 Access requests awaiting a decision.
  access_pending AS (
    SELECT count(*) AS n FROM public.access_requests WHERE status = 'pending'
  ),

  -- #6 Underperforming distributors. No distributors.score column exists (only
  -- branches and agents have one), so this is derived: any deactivated tenant,
  -- plus any live tenant whose active-contribution rate sits below the platform
  -- threshold, plus any live tenant holding branches but no members at all.
  dist_roll AS (
    SELECT d.id, COALESCE(d.status, 'active') AS status,
           count(DISTINCT b.id) AS branches,
           count(DISTINCT s.id) AS subscribers,
           count(DISTINCT s.id) FILTER (WHERE s.is_active) AS active_subscribers
    FROM public.distributors d
    LEFT JOIN public.branches    b ON b.distributor_id = d.id
    LEFT JOIN public.agents      a ON a.branch_id      = b.id
    LEFT JOIN public.subscribers s ON s.agent_id       = a.id
    GROUP BY d.id, d.status
  ),
  dist_under AS (
    SELECT count(*) AS n FROM dist_roll
    WHERE status = 'inactive'
       OR (branches > 0 AND subscribers = 0)
       OR (subscribers > 0
           AND (active_subscribers::numeric / subscribers) * 100
               < (public._admin_attention_thresholds() ->> 'underperformActiveRatePct')::numeric)
  ),

  -- #7 Claims past their decision SLA and not yet terminal.
  claims_late AS (
    SELECT count(*) AS n FROM public.claims
    WHERE status NOT IN ('paid', 'rejected') AND expected_by < v_today
  ),

  -- #8 Withdrawals still processing past their payout SLA, split by bucket.
  wd_late AS (
    SELECT count(*)                                          AS n,
           count(*) FILTER (WHERE bucket = 'retirement')      AS n_ret,
           count(*) FILTER (WHERE bucket = 'emergency')       AS n_emg
    FROM public.withdrawals
    WHERE status = 'processing' AND expected_by < v_today
  ),

  -- #9 Custody batches past due (pending) or outright failed.
  custody_late AS (
    SELECT count(*) AS n FROM public.custody_transfers
    WHERE status IN ('pending', 'failed') AND due_by < v_today
  ),

  -- #10 Named integrity breaks (0096 view).
  recon AS (
    SELECT count(*)                                    AS n,
           count(*) FILTER (WHERE kind = 'user')        AS n_user,
           count(*) FILTER (WHERE kind = 'transaction') AS n_txn
    FROM public.v_reconciliation_exceptions
  ),

  branches_off AS (
    SELECT count(*) AS n FROM public.branches WHERE status = 'inactive'
  )

  SELECT jsonb_build_object(
    'asOf',                        (now() AT TIME ZONE 'UTC'),
    'today',                       v_today,
    'dormantSubscribers',          dormant.n,
    'delayedEmployerTransfers',    emp_late.n,
    'delayedNav',                  nav_late.n,
    -- 0116 / A04-007: surface the real staleness next to the count. Kampala,
    -- not CURRENT_DATE — the session timezone is UTC and the fund prices at
    -- UTC+3. v_today is left alone so the other nine signals do not shift.
    'navLastPublishedDate',        nav_frontier.last_published,
    'navLastPublishedDaysAgo',     (public.kampala_today() - nav_frontier.last_published),
    'pendingAccessRequests',       access_pending.n,
    'underperformingDistributors', dist_under.n,
    'delayedInsurancePayouts',     claims_late.n,
    'delayedWithdrawals', jsonb_build_object(
        'total',      wd_late.n,
        'retirement', wd_late.n_ret,
        'emergency',  wd_late.n_emg),
    'delayedCustodyTransfers',     custody_late.n,
    'reconciliation', jsonb_build_object(
        'total',           recon.n,
        'userWise',        recon.n_user,
        'transactionWise', recon.n_txn),
    'inactiveBranches',            branches_off.n,
    'thresholds',                  public._admin_attention_thresholds()
  )
  INTO v_result
  FROM dormant, emp_late, nav_late, nav_frontier, access_pending, dist_under,
       claims_late, wd_late, custody_late, recon, branches_off;

  RETURN v_result;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) get_admin_attention_rows — the drill-down KEEPS resolved days, flagged
-- ─────────────────────────────────────────────────────────────────────────────
-- Resolved days deliberately stay in this list: the record of which date was
-- missed, who closed it and when is the point of the feature, and the drill-down
-- is where an admin acts on it. They sort last.
--
-- `status` keeps meaning the PRICING status ('unpriced'/'pending') that the
-- other eight signal branches also use and that cellFor(COLUMN.STATUS) already
-- renders — resolution rides alongside it as a separate `resolved` boolean
-- rather than overloading it, so no information is lost and no other branch's
-- column semantics shift. The client renders the "Resolved" badge off
-- `resolved`, not off `status`.
--
-- The client MUST exclude resolved rows from its own headline tile, or that
-- tile and the badge disagree — the exact drift A04-007 raised and 0116 fixed.
CREATE OR REPLACE FUNCTION public.get_admin_attention_rows(p_type text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := (SELECT auth.jwt()) ->> 'app_role';
  v_today  date := CURRENT_DATE;
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_bucket text;
  v_result jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot read platform attention', v_role USING ERRCODE = 'P0001';
  END IF;

  IF p_type = 'dormantSubscribers' THEN
    -- Rows are AGENTS ranked by how many of their members have gone dormant —
    -- the actionable unit, mirroring the branch AttentionAgents drill-down.
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', a.id,
        'primary', a.name,
        'secondary', COALESCE(b.name, '—'),
        'amount', NULL,
        'date', NULL,
        'dueBy', NULL,
        'daysLate', NULL,
        'status', a.status,
        'count', count(s.id),
        'recipientRole', 'agent',
        'recipientId', a.id,
        'recipientName', a.name,
        'href', '/dashboard/agents/' || a.id
      ) AS x
      FROM public.agents a
      LEFT JOIN public.branches b ON b.id = a.branch_id
      JOIN public.subscribers s ON s.agent_id = a.id AND NOT s.is_active
      GROUP BY a.id, a.name, a.status, b.name
      ORDER BY count(s.id) DESC, a.name
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedEmployerTransfers' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', e.id,
        'primary', e.name,
        'secondary', COALESCE(initcap(e.payroll_cadence), 'Monthly') || ' payroll · ' ||
                     COALESCE(to_char(lr.last_run, 'DD Mon YYYY'), 'no run recorded'),
        'amount', NULL,
        'date', lr.last_run::date,
        'dueBy', (lr.last_run::date + public._employer_grace_days(e.payroll_cadence)),
        'daysLate', CASE WHEN lr.last_run IS NULL THEN NULL
                         ELSE v_today - (lr.last_run::date + public._employer_grace_days(e.payroll_cadence)) END,
        'status', COALESCE(e.status, 'active'),
        'recipientRole', 'employer',
        'recipientId', e.id,
        'recipientName', e.name,
        'href', NULL
      ) AS x
      FROM public.employers e
      LEFT JOIN LATERAL (
        SELECT max(r.run_at) AS last_run FROM public.contribution_runs r
        WHERE r.employer_id = e.id AND r.status = 'completed'
      ) lr ON TRUE
      WHERE COALESCE(e.status, 'active') <> 'inactive'
        AND (lr.last_run IS NULL
             OR lr.last_run::date < v_today - public._employer_grace_days(e.payroll_cadence))
      ORDER BY lr.last_run NULLS FIRST
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedNav' THEN
    -- 0116 / A04-007 — reads the SAME helper get_admin_attention counts, so the
    -- badge and this list are one definition. Days with no register row at all
    -- (the majority: nothing creates a pending row per weekday) now appear with
    -- status 'unpriced' and a synthetic id instead of being invisible.
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', COALESCE(u.snapshot_id, 'nav-unpriced-' || to_char(u.nav_date, 'YYYYMMDD')),
        'primary', to_char(u.nav_date, 'DD Mon YYYY'),
        'secondary', 'UPU-BAL · ' || COALESCE(u.source, 'no price received'),
        'amount', u.unit_price,
        'date', u.nav_date,
        'dueBy', u.nav_date,
        'daysLate', public.kampala_today() - u.nav_date,
        'status', u.status,
        'resolved', (r.nav_date IS NOT NULL),
        'resolvedAt', r.resolved_at,
        'resolvedBy', r.resolved_by,
        'resolutionNote', r.note,
        'recipientRole', 'admin',
        'recipientId', 'ops-fund-admin',
        'recipientName', 'Fund Administration',
        'href', NULL
      ) AS x
      FROM public.nav_unsigned_days('UPU-BAL') u
      LEFT JOIN public.nav_missed_day_resolutions r
             ON r.fund_code = 'UPU-BAL' AND r.nav_date = u.nav_date
      ORDER BY (r.nav_date IS NOT NULL), u.nav_date
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'pendingAccessRequests' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', ar.id,
        'primary', ar.org_name,
        'secondary', initcap(ar.kind) || ' · ' || COALESCE(ar.contact_name, '—'),
        'amount', NULL,
        'date', ar.created_at::date,
        'dueBy', NULL,
        'daysLate', v_today - ar.created_at::date,
        'status', ar.status,
        'recipientRole', NULL,
        'recipientId', NULL,
        'recipientName', NULL,
        'href', NULL
      ) AS x
      FROM public.access_requests ar
      WHERE ar.status = 'pending'
      ORDER BY ar.created_at
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'underperformingDistributors' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      WITH roll AS (
        SELECT d.id, d.name, COALESCE(d.status, 'active') AS status,
               count(DISTINCT b.id) AS branches,
               count(DISTINCT a.id) AS agents,
               count(DISTINCT s.id) AS subscribers,
               count(DISTINCT s.id) FILTER (WHERE s.is_active) AS active_subscribers,
               COALESCE(sum(sb.total_balance), 0) AS aum
        FROM public.distributors d
        LEFT JOIN public.branches            b  ON b.distributor_id = d.id
        LEFT JOIN public.agents              a  ON a.branch_id      = b.id
        LEFT JOIN public.subscribers         s  ON s.agent_id       = a.id
        LEFT JOIN public.subscriber_balances sb ON sb.subscriber_id = s.id
        GROUP BY d.id, d.name, d.status
      )
      SELECT jsonb_build_object(
        'id', r.id,
        'primary', r.name,
        'secondary', r.agents || ' agents · ' || r.subscribers || ' members · ' ||
                     CASE WHEN r.subscribers = 0 THEN 'no members yet'
                          ELSE round((r.active_subscribers::numeric / r.subscribers) * 100) || '% active' END,
        'amount', r.aum,
        'date', NULL,
        'dueBy', NULL,
        'daysLate', NULL,
        'status', r.status,
        'recipientRole', 'distributor',
        'recipientId', r.id,
        'recipientName', r.name,
        'href', NULL
      ) AS x
      FROM roll r
      WHERE r.status = 'inactive'
         OR (r.branches > 0 AND r.subscribers = 0)
         OR (r.subscribers > 0
             AND (r.active_subscribers::numeric / r.subscribers) * 100
                 < (public._admin_attention_thresholds() ->> 'underperformActiveRatePct')::numeric)
      ORDER BY (r.status = 'inactive') DESC, r.subscribers
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedInsurancePayouts' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', c.id,
        'primary', s.name,
        'secondary', initcap(replace(c.type, '_', ' ')) || ' · ' || replace(initcap(replace(c.status, '_', ' ')), ' ', ' '),
        'amount', c.amount,
        'date', c.submitted_date,
        'dueBy', c.expected_by,
        'daysLate', v_today - c.expected_by,
        'status', c.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-claims',
        'recipientName', 'Claims Operations',
        'href', '/dashboard/subscribers/' || c.subscriber_id
      ) AS x
      FROM public.claims c
      JOIN public.subscribers s ON s.id = c.subscriber_id
      WHERE c.status NOT IN ('paid', 'rejected') AND c.expected_by < v_today
      ORDER BY c.expected_by
      LIMIT v_limit
    ) q;

  ELSIF p_type IN ('delayedWithdrawals', 'delayedWithdrawalsRetirement', 'delayedWithdrawalsEmergency') THEN
    v_bucket := CASE p_type
                  WHEN 'delayedWithdrawalsRetirement' THEN 'retirement'
                  WHEN 'delayedWithdrawalsEmergency'  THEN 'emergency'
                  ELSE NULL END;
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', w.id,
        'primary', s.name,
        'secondary', initcap(w.bucket) || ' payout · ' || COALESCE(w.method, 'method not set'),
        'amount', w.amount,
        'date', w.date,
        'dueBy', w.expected_by,
        'daysLate', v_today - w.expected_by,
        'status', w.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-treasury',
        'recipientName', 'Treasury Operations',
        'href', '/dashboard/subscribers/' || w.subscriber_id
      ) AS x
      FROM public.withdrawals w
      JOIN public.subscribers s ON s.id = w.subscriber_id
      WHERE w.status = 'processing'
        AND w.expected_by < v_today
        AND (v_bucket IS NULL OR w.bucket = v_bucket)
      ORDER BY w.expected_by
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'delayedCustodyTransfers' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', ct.id,
        'primary', ct.batch_label,
        'secondary', ct.custodian || ' · ' ||
                     to_char(ct.collected_from, 'DD Mon') || '–' || to_char(ct.collected_to, 'DD Mon') ||
                     COALESCE(' · ' || ct.failure_reason, ''),
        'amount', ct.amount,
        'date', ct.collected_to,
        'dueBy', ct.due_by,
        'daysLate', v_today - ct.due_by,
        'status', ct.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-treasury',
        'recipientName', 'Treasury Operations',
        'href', NULL
      ) AS x
      FROM public.custody_transfers ct
      WHERE ct.status IN ('pending', 'failed') AND ct.due_by < v_today
      ORDER BY ct.due_by
      LIMIT v_limit
    ) q;

  ELSIF p_type = 'reconciliation' THEN
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', re.ref_id,
        'primary', re.who,
        'secondary', re.issue,
        'amount', re.amount,
        'date', re.occurred_on,
        'dueBy', NULL,
        'daysLate', NULL,
        'status', re.check_code,
        'kind', re.kind,
        'recipientRole', 'admin',
        'recipientId', 'ops-finance',
        'recipientName', 'Finance Operations',
        'href', CASE WHEN re.subscriber_id IS NOT NULL
                     THEN '/dashboard/subscribers/' || re.subscriber_id END
      ) AS x
      FROM public.v_reconciliation_exceptions re
      ORDER BY re.kind, re.check_code, re.ref_id
      LIMIT v_limit
    ) q;

  ELSE
    RAISE EXCEPTION 'unknown attention type %', p_type USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
