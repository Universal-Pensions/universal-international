-- =============================================================================
-- Universal Pensions Uganda — 0097: admin "Needs attention" RPCs
-- =============================================================================
-- Phase 2 of the admin Needs-attention rebuild. Adds:
--
--   * get_admin_attention()                      — all counts in ONE round-trip
--   * get_admin_attention_rows(p_type, p_limit)  — polymorphic drill-down rows
--   * admin_notify(...)                          — admin → stakeholder notification
--   * mark_notifications_read(...)               — re-emitted with employer + admin
--
-- WHY ONE AGGREGATE RPC (not nine per-signal calls):
--   The card renders on every admin home load, on BOTH the desktop and mobile
--   surfaces. Nine round-trips × two surfaces is 18 queries for numbers that are
--   all independent single-table aggregates behind one identical JWT gate.
--   get_platform_overview() (0050/0058) already set this precedent with 13 keys
--   in one function. A single cache key also means desktop and mobile can never
--   render different numbers for the same signal.
--
-- CLOCK: CURRENT_DATE, not public._demo_now() — see the 0096 header for why
--   (_demo_now() is pinned to 2026-05-18 while the live ledger runs months past
--   it, so SLA maths against it silently marks late items "not yet due").
--
-- CONVENTIONS (CLAUDE.md §4/§5, BACKEND.md §9):
--   * LANGUAGE plpgsql · STABLE (VOLATILE for the write) · SECURITY DEFINER ·
--     SET search_path = public, pg_temp
--   * admin gate reads (SELECT auth.jwt()) ->> 'app_role'  — NEVER ->> 'role'
--   * REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated
--   * Forward-only; reversed by 0097_admin_attention_rpcs.down.sql.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- Shared SLA constants
-- ─────────────────────────────────────────────────────────────────────────────
-- Returned to the client inside get_admin_attention() so the UI can render
-- "Past the 5-day payout SLA" without ever hardcoding 5 or doing date maths.
-- The server owns the clock and the thresholds; the client only formats.
CREATE OR REPLACE FUNCTION public._admin_attention_thresholds()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'withdrawalSlaDays', 5,
    'claimSlaDays',      10,
    'navStaleDays',      1,
    'custodyGraceDays',  0,
    'underperformActiveRatePct', 60,
    'employerGraceDays', jsonb_build_object(
      'weekly', 10, 'monthly', 35, 'quarterly', 100,
      'half-yearly', 190, 'annually', 380)
  );
$$;

REVOKE ALL    ON FUNCTION public._admin_attention_thresholds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._admin_attention_thresholds() TO authenticated;


-- Grace period in days for an employer's payroll cadence. Unknown/NULL cadence
-- falls back to the monthly grace rather than never flagging.
CREATE OR REPLACE FUNCTION public._employer_grace_days(p_cadence text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (public._admin_attention_thresholds() -> 'employerGraceDays' ->> lower(COALESCE(p_cadence, 'monthly')))::int,
    35);
$$;

REVOKE ALL    ON FUNCTION public._employer_grace_days(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._employer_grace_days(text) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- get_admin_attention() — every Needs-attention count in one call
-- ─────────────────────────────────────────────────────────────────────────────
-- `pendingComplaints` is deliberately ABSENT. Ticketing has no Supabase tables
-- (src/services/tickets.js is an in-memory session store seeded from
-- src/data/ticketsSeed.js), so that count is merged client-side in
-- adminAttentionDerive. Everything else here is a real query.
--
-- `inactiveBranches` is not one of the ten signals; it rides along so the
-- overview's Platform-network card can caption "N inactive branches" without
-- re-introducing a whole-collection useAllEntities('branch') fetch.
CREATE OR REPLACE FUNCTION public.get_admin_attention()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL    ON FUNCTION public.get_admin_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attention() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- get_admin_attention_rows(p_type, p_limit) — the drill-down list
-- ─────────────────────────────────────────────────────────────────────────────
-- One polymorphic RPC returning a UNIFORM row shape, so a single React table
-- renders every drill-down instead of nine bespoke components:
--
--   { id, primary, secondary, amount, date, dueBy, daysLate, status,
--     recipientRole, recipientId, recipientName, href }
--
-- `recipientRole` / `recipientId` are what the Notify composer posts back to
-- admin_notify(), so the responsible party is resolved server-side per row
-- rather than guessed in the UI. Internal ops queues use recipientRole='admin'
-- with a fixed queue id (ops-fund-admin / ops-treasury / ops-claims /
-- ops-finance); everything else addresses a real entity.
CREATE OR REPLACE FUNCTION public.get_admin_attention_rows(
  p_type  text,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL    ON FUNCTION public.get_admin_attention_rows(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attention_rows(text, int) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- admin_notify(...) — admin → stakeholder in-app notification
-- ─────────────────────────────────────────────────────────────────────────────
-- The only write in this feature. Until now the sole writer of `notifications`
-- was apply_settlement (0031), which emits commission_settled to agent + branch.
-- This widens the writers, so the recipient is validated against real rows (or,
-- for internal queues, against a fixed whitelist) before insert — a typo'd
-- recipient would otherwise create a row nobody can ever read.
--
-- Demo scope (CLAUDE.md §10a): this delivers an IN-APP notification only. There
-- is no SMS/email provider and none should be added.
CREATE OR REPLACE FUNCTION public.admin_notify(
  p_recipient_role text,
  p_recipient_id   text,
  p_type           text,
  p_title          text,
  p_body           text,
  p_ref_id         text    DEFAULT NULL,
  p_amount         numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   text := (SELECT auth.jwt()) ->> 'app_role';
  v_id     text := 'ntf-' || replace(gen_random_uuid()::text, '-', '');
  v_exists boolean;
  v_row    public.notifications%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot send platform notifications', v_role USING ERRCODE = 'P0001';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'notification title and body are required' USING ERRCODE = 'P0001';
  END IF;

  -- 'subscriber' is intentionally NOT accepted: the subscriber dashboard reads a
  -- different feed component, so such a row would be written but never shown.
  IF p_recipient_role NOT IN ('agent', 'branch', 'distributor', 'employer', 'admin') THEN
    RAISE EXCEPTION 'cannot notify recipient role %', p_recipient_role USING ERRCODE = 'P0001';
  END IF;

  IF p_type NOT IN (
    'dormantSubscribers', 'delayedEmployerTransfers', 'delayedNav',
    'pendingComplaints', 'pendingAccessRequests', 'underperformingDistributors',
    'delayedInsurancePayouts', 'delayedWithdrawals',
    'delayedWithdrawalsRetirement', 'delayedWithdrawalsEmergency',
    'delayedCustodyTransfers', 'reconciliation'
  ) THEN
    RAISE EXCEPTION 'unknown notification type %', p_type USING ERRCODE = 'P0001';
  END IF;

  -- Recipient must exist. Internal ops queues are addressed by a fixed id rather
  -- than a person — there is one head-office admin, and these are work queues.
  v_exists := CASE p_recipient_role
    WHEN 'agent'       THEN EXISTS (SELECT 1 FROM public.agents       WHERE id = p_recipient_id)
    WHEN 'branch'      THEN EXISTS (SELECT 1 FROM public.branches     WHERE id = p_recipient_id)
    WHEN 'distributor' THEN EXISTS (SELECT 1 FROM public.distributors WHERE id = p_recipient_id)
    WHEN 'employer'    THEN EXISTS (SELECT 1 FROM public.employers    WHERE id = p_recipient_id)
    WHEN 'admin'       THEN p_recipient_id IN
      ('ops-fund-admin', 'ops-treasury', 'ops-claims', 'ops-finance', 'ops-support')
  END;

  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION 'unknown % recipient %', p_recipient_role, p_recipient_id USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notifications
    (id, recipient_role, recipient_id, type, title, body, amount, ref_id, is_read)
  VALUES
    (v_id, p_recipient_role, p_recipient_id, p_type,
     left(btrim(p_title), 200), left(btrim(p_body), 1000), p_amount, p_ref_id, false)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id',            v_row.id,
    'recipientRole', v_row.recipient_role,
    'recipientId',   v_row.recipient_id,
    'type',          v_row.type,
    'title',         v_row.title,
    'body',          v_row.body,
    'amount',        v_row.amount,
    'refId',         v_row.ref_id,
    'isRead',        v_row.is_read,
    'createdAt',     v_row.created_at
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_notify(text, text, text, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_notify(text, text, text, text, text, text, numeric) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- mark_notifications_read(p_ids) — re-emitted with employer + admin branches
-- ─────────────────────────────────────────────────────────────────────────────
-- The 0031 body RAISEs for any role outside distributor/agent/branch. Both the
-- employer bell (already mounted, and readable since the 0049 policy) and the
-- new admin bell would therefore throw the moment the feed is opened. Scoping
-- mirrors each role's SELECT policy exactly so a caller can never mark a row
-- read that it cannot see.
--
-- RETURNS void is deliberate — it matches the deployed 0031 signature exactly.
-- CREATE OR REPLACE cannot change a function's return type, so widening this to
-- `integer` would need a DROP first and would break every existing caller's
-- contract for no gain (useNotifications ignores the result).
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids text[])
RETURNS void
LANGUAGE plpgsql
VOLATILE
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

  ELSIF v_role = 'employer' THEN
    UPDATE public.notifications SET is_read = true
     WHERE id = ANY(p_ids)
       AND recipient_role = 'employer'
       AND recipient_id = (SELECT auth.jwt()) ->> 'employerId';

  ELSIF v_role = 'admin' THEN
    -- notifications_select_admin (0049) is role-wide, so the admin may clear any
    -- row it can see. In practice the bell only ever lists recipient_role='admin'
    -- ops-queue rows (services/notifications.js filters), but the UPDATE is left
    -- unfiltered to stay consistent with the policy rather than narrower than it.
    UPDATE public.notifications SET is_read = true
     WHERE id = ANY(p_ids);

  ELSE
    RAISE EXCEPTION 'role % cannot mark notifications read', v_role USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.mark_notifications_read(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(text[]) TO authenticated;
