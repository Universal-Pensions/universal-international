-- =============================================================================
-- 0116_nav_integrity.down.sql — restore the pre-0116 NAV surface
-- =============================================================================
-- ⚠️ THE BODIES BELOW WERE CAPTURED FROM LIVE, NOT RETYPED AND NOT COPIED FROM
--    AN OLDER MIGRATION.
--
--    Every CREATE OR REPLACE in this file is the verbatim output of
--    pg_get_functiondef() / pg_get_viewdef() taken from the live Singapore
--    database on 2026-08-25, immediately before 0116 was authored. Rebuilding a
--    body from an older migration file is how 0095 silently un-shipped 0090's
--    login-identity work, and it is the same trap ef2c3d2 had to guard in four
--    other .down.sql files — where the stale body would have quietly restored
--    the dead 1,000 UGX unit price.
--
--    If you edit this file, re-capture. Do not retype.
--
-- WHAT COMES BACK IF YOU RUN THIS — be clear-eyed about it:
--   * publish_nav_snapshot's NaN hole reopens (A04-005). 0114's
--     nav_snapshots_unit_price_finite_chk still backstops the register, so the
--     book cannot go NaN while 0114 is applied — the admin just gets a raw
--     constraint violation instead of a sentence.
--   * The A04-003 revaluation guard is gone. A reseed followed by a NAV publish
--     will again inflate AUM ~57% and zero every retirement pot, silently.
--   * "Delayed NAV updation" goes back to counting only pre-seeded pending rows
--     and stops being able to see an unpriced fund at all (A04-007).
--   * The unit ledger stops being monitored (A04-008).
--   * The Kampala-date guard reverts to UTC (A04-015 server half).
-- =============================================================================

DROP FUNCTION IF EXISTS public.assert_book_revaluable(text, numeric);
DROP FUNCTION IF EXISTS public.reprice_book_to_register(text);
DROP FUNCTION IF EXISTS public.nav_unsigned_days(text);

-- ---------------------------------------------------------------------------
-- publish_nav_snapshot — live capture 2026-08-25
-- ---------------------------------------------------------------------------
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
  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'unit price must be greater than zero' USING ERRCODE = 'P0001';
  END IF;
  IF p_nav_date IS NULL OR p_nav_date > CURRENT_DATE THEN
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

-- ---------------------------------------------------------------------------
-- v_reconciliation_exceptions — live capture 2026-08-25 (five branches)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_reconciliation_exceptions AS
 SELECT 'user'::text AS kind,
    'missing_balance'::text AS check_code,
    'Member has no balance record'::text AS issue,
    s.id AS ref_id,
    s.name AS who,
    s.id AS subscriber_id,
    NULL::numeric AS amount,
    NULL::date AS occurred_on
   FROM subscribers s
     LEFT JOIN subscriber_balances b ON b.subscriber_id = s.id
  WHERE b.subscriber_id IS NULL
UNION ALL
 SELECT 'user'::text AS kind,
    'split_mismatch'::text AS check_code,
    'Retirement + emergency does not equal total balance'::text AS issue,
    b.subscriber_id AS ref_id,
    s.name AS who,
    b.subscriber_id,
    b.retirement_balance + b.emergency_balance - b.total_balance AS amount,
    b.updated_at::date AS occurred_on
   FROM subscriber_balances b
     JOIN subscribers s ON s.id = b.subscriber_id
  WHERE abs(b.retirement_balance + b.emergency_balance - b.total_balance) > 1::numeric
UNION ALL
 SELECT 'transaction'::text AS kind,
    'orphan_subscriber'::text AS check_code,
    'Transaction references a member that no longer exists'::text AS issue,
    t.id AS ref_id,
    COALESCE(t.subscriber_id, '—'::text) AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
  WHERE s.id IS NULL
UNION ALL
 SELECT 'transaction'::text AS kind,
    'orphan_run'::text AS check_code,
    'Transaction references a contribution run that no longer exists'::text AS issue,
    t.id AS ref_id,
    COALESCE(s.name, '—'::text) AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     LEFT JOIN subscribers s ON s.id = t.subscriber_id
     LEFT JOIN contribution_runs r ON r.id = t.contribution_run_id
  WHERE t.contribution_run_id IS NOT NULL AND r.id IS NULL
UNION ALL
 SELECT 'transaction'::text AS kind,
    'agent_mismatch'::text AS check_code,
    'Transaction credited to an agent who does not own this member'::text AS issue,
    t.id AS ref_id,
    s.name AS who,
    t.subscriber_id,
    t.amount,
    t.date::date AS occurred_on
   FROM transactions t
     JOIN subscribers s ON s.id = t.subscriber_id
  WHERE t.agent_id IS NOT NULL AND t.agent_id IS DISTINCT FROM s.agent_id;

-- ---------------------------------------------------------------------------
-- get_admin_attention — live capture 2026-08-25
-- ---------------------------------------------------------------------------
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
  nav_late AS (
    SELECT count(*) AS n FROM public.nav_snapshots
    WHERE status = 'pending' AND nav_date < v_today
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
  FROM dormant, emp_late, nav_late, access_pending, dist_under,
       claims_late, wd_late, custody_late, recon, branches_off;

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- get_admin_attention_rows — live capture 2026-08-25
-- ---------------------------------------------------------------------------
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
    SELECT jsonb_agg(x) INTO v_result FROM (
      SELECT jsonb_build_object(
        'id', n.id,
        'primary', to_char(n.nav_date, 'DD Mon YYYY'),
        'secondary', n.fund_code || ' · ' || COALESCE(n.source, 'no feed received'),
        'amount', n.unit_price,
        'date', n.nav_date,
        'dueBy', n.nav_date,
        'daysLate', v_today - n.nav_date,
        'status', n.status,
        'recipientRole', 'admin',
        'recipientId', 'ops-fund-admin',
        'recipientName', 'Fund Administration',
        'href', NULL
      ) AS x
      FROM public.nav_snapshots n
      WHERE n.status = 'pending' AND n.nav_date < v_today
      ORDER BY n.nav_date
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

-- kampala_today() is dropped LAST: the three bodies above no longer reference
-- it, but 0117's fixture does, so 0117.down.sql must run first.
DROP FUNCTION IF EXISTS public.kampala_today();

-- Grants restored to the live 2026-08-25 ACL.
REVOKE ALL ON FUNCTION public.publish_nav_snapshot(date, numeric, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_nav_snapshot(date, numeric, text, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attention() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_attention_rows(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attention_rows(text, integer) TO authenticated, service_role;
