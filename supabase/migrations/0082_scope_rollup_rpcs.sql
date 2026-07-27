-- 0082_scope_rollup_rpcs.sql
-- Re-emits get_entity_metrics_rollup (source of truth: 0057_perf_rpcs.sql) with
-- two changes. Everything else is byte-identical to 0057.
--
-- ── 1. The COUNTRY level is now distributor-scoped ───────────────────────────
-- 0081 scoped the distributor's TABLE reads via RLS, but this RPC is
-- SECURITY DEFINER — RLS cannot touch it. Left alone, the distributor Overview
-- KPI would report the whole platform while the Subscribers list (correctly)
-- reported only the distributor's own network: the exact 5,004-vs-5,062 split
-- the user reported, just with different numbers.
--
-- Worse, the country branch was ALREADY internally inconsistent for everyone:
--   per_agent / counts  -> walked agents LEFT JOIN subscribers  (agent tree)
--   aum_cte, txn, monthly_arr, subs_buckets, demo_agg -> read the base tables
-- so one card row showed "5,004 subscribers" beside "UGX 1.99B" — a headcount
-- from the agent tree next to money from the whole platform (incl. the 58
-- employer-channel members' UGX 173M). All seven CTEs now share one scope.
--
-- `v_all` is TRUE for admin/branch/agent, so their results are unchanged:
-- admin stays platform-wide by design, and branch/agent are already pinned by
-- the out_of_scope guards. Only 'distributor' gains a filter, and it fails
-- closed (no distributorId claim -> empty ownership set -> zeros).
--
-- ── 2. `activeSubscribers` is now returned at every level ────────────────────
-- The payload exposed only `activeRate`, ROUNDed to an integer percent, so four
-- call sites reconstructed a headcount as `total * pct/100` — reporting 3,953
-- active where the truth was 3,940, and 1,051 dormant where the truth was
-- 1,064. Every level's `counts` CTE already computes the exact figure; it was
-- simply never emitted.
--
-- NOT changed here (deliberately): the region/district/branch/agent drill-down
-- levels remain unscoped for a distributor. That leak is the twin of the still
-- platform-wide `agents_select_authenticated` / `branches_select_authenticated`
-- policies, and both are fixed together in 0084 — scoping one without the other
-- would give a half-filtered drill-down that is harder to reason about than a
-- consistently open one.

CREATE OR REPLACE FUNCTION public.get_entity_metrics_rollup(
  p_level      TEXT,
  p_entity_ids TEXT[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- COALESCE collapses NULL to '' so the NOT-IN check below raises reliably.
  -- `NULL NOT IN (...)` evaluates to NULL (not TRUE) and the IF silently falls
  -- through, leading to the silent-zero regression that prompted this migration.
  v_role         TEXT := COALESCE(auth.jwt() ->> 'app_role', '');
  v_result       jsonb;
  -- 0082: distributor scoping. `v_all` is TRUE for every role whose reach is
  -- already constrained elsewhere (admin is platform-wide by design; branch and
  -- agent are pinned by the out_of_scope guards below), so ONLY 'distributor'
  -- picks up an ownership filter. Fails closed: a distributor with no
  -- distributorId claim matches no branches and sees zeros.
  v_dist         TEXT := auth.jwt() ->> 'distributorId';
  v_all          BOOLEAN := (COALESCE(auth.jwt() ->> 'app_role', '') <> 'distributor');
  v_now          timestamptz := public._demo_now();
  v_today_start  timestamptz := date_trunc('day',   v_now);
  v_today_end    timestamptz := v_today_start + interval '1 day';
  v_yest_start   timestamptz := v_today_start - interval '1 day';
  v_yest_end     timestamptz := v_today_start;
  v_week_start   timestamptz := date_trunc('week',  v_now);
  v_week_end     timestamptz := v_week_start  + interval '7 days';
  v_lastw_start  timestamptz := v_week_start  - interval '7 days';
  v_lastw_end    timestamptz := v_week_start;
  v_month_start  timestamptz := date_trunc('month', v_now);
  v_month_end    timestamptz := v_month_start + interval '1 month';
  v_lastm_start  timestamptz := v_month_start - interval '1 month';
  v_lastm_end    timestamptz := v_month_start;
  v_arr_start    timestamptz := v_month_start - interval '11 months';
BEGIN
  -- ---------------------------------------------------------------------------
  -- Role gate. Reads `app_role` per the canonical JWT contract (api/_lib/jwt.ts).
  -- ---------------------------------------------------------------------------
  IF v_role = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  IF v_role NOT IN ('distributor', 'admin', 'branch', 'agent') THEN
    RAISE EXCEPTION 'role_not_permitted' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'branch' AND p_level IN ('country', 'region', 'district') THEN
    RAISE EXCEPTION 'out_of_scope' USING ERRCODE = 'P0003';
  END IF;
  IF v_role = 'agent' AND p_level <> 'agent' THEN
    RAISE EXCEPTION 'out_of_scope' USING ERRCODE = 'P0003';
  END IF;

  IF p_entity_ids IS NULL OR array_length(p_entity_ids, 1) IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- ===========================================================================
  -- COUNTRY level (singleton — 'ug')
  -- ===========================================================================
  IF p_level = 'country' THEN
    WITH input AS (
      SELECT 'ug'::text AS entity_id
    ),
    per_agent AS (
      SELECT a.id AS agent_id, a.coverage_rate,
             COUNT(s.id)::bigint                            AS total_subs,
             COUNT(s.id) FILTER (WHERE s.is_active)::bigint AS active_subs
        FROM public.agents a
        LEFT JOIN public.subscribers s ON s.agent_id = a.id
       WHERE v_all OR a.branch_id IN (SELECT public.distributor_branch_ids())
       GROUP BY a.id, a.coverage_rate
    ),
    counts AS (
      SELECT SUM(total_subs)::bigint                           AS total_subscribers,
             SUM(active_subs)::bigint                          AS active_subscribers,
             (SELECT COUNT(*) FROM public.agents a2
                WHERE v_all OR a2.branch_id IN (SELECT public.distributor_branch_ids()))::bigint
                                                              AS total_agents,
             (SELECT COUNT(*) FROM public.branches b2
                WHERE v_all OR b2.distributor_id = v_dist)::bigint
                                                              AS total_branches,
             CASE WHEN SUM(total_subs) > 0
                  THEN ROUND(SUM(coverage_rate * total_subs)::numeric
                               / NULLIF(SUM(total_subs), 0))
                  ELSE 0 END                                   AS coverage_rate
        FROM per_agent
    ),
    aum_cte AS (
      SELECT COALESCE(SUM(sb.total_balance), 0) AS aum
        FROM public.subscriber_balances sb
       WHERE v_all OR sb.subscriber_id IN (SELECT public.distributor_subscriber_ids())
    ),
    txn AS (
      SELECT
        COALESCE(SUM(amount)      FILTER (WHERE type='contribution'), 0) AS contributions,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE type='withdrawal'),   0) AS withdrawals,

        COALESCE(SUM(amount)      FILTER (WHERE type='contribution' AND date >= v_today_start AND date < v_today_end), 0) AS daily_contrib,
        COALESCE(SUM(amount)      FILTER (WHERE type='contribution' AND date >= v_yest_start  AND date < v_yest_end),  0) AS prev_daily_contrib,
        COALESCE(SUM(amount)      FILTER (WHERE type='contribution' AND date >= v_week_start  AND date < v_week_end),  0) AS weekly_contrib,
        COALESCE(SUM(amount)      FILTER (WHERE type='contribution' AND date >= v_lastw_start AND date < v_lastw_end), 0) AS prev_weekly_contrib,
        COALESCE(SUM(amount)      FILTER (WHERE type='contribution' AND date >= v_month_start AND date < v_month_end), 0) AS monthly_contrib,

        COALESCE(SUM(ABS(amount)) FILTER (WHERE type='withdrawal'   AND date >= v_today_start AND date < v_today_end), 0) AS daily_withdraw,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE type='withdrawal'   AND date >= v_yest_start  AND date < v_yest_end),  0) AS prev_daily_withdraw,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE type='withdrawal'   AND date >= v_week_start  AND date < v_week_end),  0) AS weekly_withdraw,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE type='withdrawal'   AND date >= v_lastw_start AND date < v_lastw_end), 0) AS prev_weekly_withdraw,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE type='withdrawal'   AND date >= v_month_start AND date < v_month_end), 0) AS monthly_withdraw,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE type='withdrawal'   AND date >= v_lastm_start AND date < v_lastm_end), 0) AS prev_monthly_withdraw
        FROM public.transactions
       WHERE v_all OR subscriber_id IN (SELECT public.distributor_subscriber_ids())
    ),
    monthly_arr AS (
      SELECT jsonb_agg(amt ORDER BY bucket_idx) AS month_array
        FROM (
          SELECT gs.idx AS bucket_idx,
                 COALESCE(SUM(t.amount), 0) AS amt
            FROM generate_series(0, 11) AS gs(idx)
            LEFT JOIN public.transactions t
              ON t.type = 'contribution'
             AND t.date >= v_arr_start + (gs.idx * interval '1 month')
             AND t.date <  v_arr_start + ((gs.idx + 1) * interval '1 month')
             AND (v_all OR t.subscriber_id IN (SELECT public.distributor_subscriber_ids()))
           GROUP BY gs.idx
        ) m
    ),
    subs_buckets AS (
      SELECT
        COUNT(*) FILTER (WHERE registered_date >= v_today_start::date AND registered_date < v_today_end::date)::bigint   AS new_today,
        COUNT(*) FILTER (WHERE registered_date >= v_yest_start::date  AND registered_date < v_yest_end::date)::bigint    AS prev_new_today,
        COUNT(*) FILTER (WHERE registered_date >= v_week_start::date  AND registered_date < v_week_end::date)::bigint    AS new_week,
        COUNT(*) FILTER (WHERE registered_date >= v_lastw_start::date AND registered_date < v_lastw_end::date)::bigint   AS prev_new_week,
        COUNT(*) FILTER (WHERE registered_date >= v_month_start::date AND registered_date < v_month_end::date)::bigint   AS new_month,
        COUNT(*) FILTER (WHERE registered_date >= v_lastm_start::date AND registered_date < v_lastm_end::date)::bigint   AS prev_new_month
      FROM public.subscribers
     WHERE v_all OR agent_id IN (SELECT public.distributor_agent_ids())
    ),
    demo_agg AS (
      SELECT
        COUNT(*) FILTER (WHERE gender='male')::bigint   AS male_n,
        COUNT(*) FILTER (WHERE gender='female')::bigint AS female_n,
        COUNT(*) FILTER (WHERE gender='other')::bigint  AS other_n,
        COUNT(*)::bigint                                 AS total_n,
        COUNT(*) FILTER (WHERE COALESCE(age, EXTRACT(YEAR FROM age(v_now::date, dob))::int) BETWEEN 18 AND 25)::bigint AS age_18_25,
        COUNT(*) FILTER (WHERE COALESCE(age, EXTRACT(YEAR FROM age(v_now::date, dob))::int) BETWEEN 26 AND 35)::bigint AS age_26_35,
        COUNT(*) FILTER (WHERE COALESCE(age, EXTRACT(YEAR FROM age(v_now::date, dob))::int) BETWEEN 36 AND 45)::bigint AS age_36_45,
        COUNT(*) FILTER (WHERE COALESCE(age, EXTRACT(YEAR FROM age(v_now::date, dob))::int) BETWEEN 46 AND 55)::bigint AS age_46_55,
        COUNT(*) FILTER (WHERE COALESCE(age, EXTRACT(YEAR FROM age(v_now::date, dob))::int) >= 56)::bigint              AS age_56_plus,
        COUNT(*) FILTER (WHERE kyc_status='pending')::bigint    AS kyc_pending,
        COUNT(*) FILTER (WHERE kyc_status='incomplete')::bigint AS kyc_incomplete
      FROM public.subscribers
     WHERE v_all OR agent_id IN (SELECT public.distributor_agent_ids())
    )
    SELECT jsonb_build_object(
      i.entity_id,
      jsonb_build_object(
        'totalSubscribers',   c.total_subscribers,
        'activeSubscribers',  c.active_subscribers,
        'totalAgents',        c.total_agents,
        'totalBranches',      c.total_branches,
        'totalContributions', t.contributions,
        'totalWithdrawals',   t.withdrawals,
        'aum',                a.aum,
        'activeRate',         CASE WHEN c.total_subscribers > 0
                                   THEN ROUND((c.active_subscribers::numeric / c.total_subscribers) * 100)
                                   ELSE 0 END,
        'coverageRate',       c.coverage_rate,
        'dailyContributions',           t.daily_contrib,
        'prevDailyContributions',       t.prev_daily_contrib,
        'weeklyContributions',          t.weekly_contrib,
        'prevWeeklyContributions',      t.prev_weekly_contrib,
        'monthlyContributions',         COALESCE(ma.month_array, '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb),
        'dailyWithdrawals',             t.daily_withdraw,
        'prevDailyWithdrawals',         t.prev_daily_withdraw,
        'weeklyWithdrawals',            t.weekly_withdraw,
        'prevWeeklyWithdrawals',        t.prev_weekly_withdraw,
        'monthlyWithdrawals',           t.monthly_withdraw,
        'prevMonthlyWithdrawals',       t.prev_monthly_withdraw,
        'newSubscribersToday',          sb.new_today,
        'prevNewSubscribersToday',      sb.prev_new_today,
        'newSubscribersThisWeek',       sb.new_week,
        'prevNewSubscribersThisWeek',   sb.prev_new_week,
        'newSubscribersThisMonth',      sb.new_month,
        'prevNewSubscribersThisMonth',  sb.prev_new_month,
        'genderRatio',  jsonb_build_object(
                          'male',   CASE WHEN d.total_n > 0 THEN ROUND((d.male_n::numeric   / d.total_n) * 100) ELSE 0 END,
                          'female', CASE WHEN d.total_n > 0 THEN ROUND((d.female_n::numeric / d.total_n) * 100) ELSE 0 END,
                          'other',  CASE WHEN d.total_n > 0 THEN ROUND((d.other_n::numeric  / d.total_n) * 100) ELSE 0 END
                        ),
        'ageDistribution', jsonb_build_object(
                             '18-25', d.age_18_25,
                             '26-35', d.age_26_35,
                             '36-45', d.age_36_45,
                             '46-55', d.age_46_55,
                             '56+',   d.age_56_plus
                           ),
        'kycPending',    d.kyc_pending,
        'kycIncomplete', d.kyc_incomplete
      )
    )
      INTO v_result
      FROM input i, counts c, aum_cte a, txn t, monthly_arr ma, subs_buckets sb, demo_agg d;

    RETURN COALESCE(v_result, '{}'::jsonb);
  END IF;

  -- ===========================================================================
  -- REGION level
  -- ===========================================================================
  IF p_level = 'region' THEN
    WITH input AS (
      SELECT unnest(p_entity_ids) AS entity_id
    ),
    scope_subscriber AS (
      SELECT d.region_id AS entity_id, s.id AS subscriber_id, s.agent_id,
             s.gender, s.age, s.dob, s.kyc_status, s.is_active, s.registered_date
        FROM public.districts d
        JOIN public.branches  b ON b.district_id = d.id
        JOIN public.agents    a ON a.branch_id   = b.id
        JOIN public.subscribers s ON s.agent_id  = a.id
       WHERE d.region_id = ANY(p_entity_ids)
    ),
    scope_agent AS (
      SELECT d.region_id AS entity_id, a.id AS agent_id, a.coverage_rate
        FROM public.districts d
        JOIN public.branches  b ON b.district_id = d.id
        JOIN public.agents    a ON a.branch_id   = b.id
       WHERE d.region_id = ANY(p_entity_ids)
    ),
    per_agent AS (
      SELECT sa.entity_id, sa.agent_id, sa.coverage_rate,
             COUNT(s.subscriber_id)                            AS total_subs,
             COUNT(s.subscriber_id) FILTER (WHERE s.is_active) AS active_subs
        FROM scope_agent sa
        LEFT JOIN scope_subscriber s
          ON s.entity_id = sa.entity_id AND s.agent_id = sa.agent_id
       GROUP BY sa.entity_id, sa.agent_id, sa.coverage_rate
    ),
    counts AS (
      SELECT entity_id,
             SUM(total_subs)::bigint                AS total_subscribers,
             SUM(active_subs)::bigint               AS active_subscribers,
             COUNT(DISTINCT agent_id)::bigint       AS total_agents,
             CASE WHEN SUM(total_subs) > 0
                  THEN ROUND(SUM(coverage_rate * total_subs)::numeric
                               / NULLIF(SUM(total_subs), 0))
                  ELSE 0 END                        AS coverage_rate
        FROM per_agent
       GROUP BY entity_id
    ),
    branch_count AS (
      SELECT d.region_id AS entity_id, COUNT(b.id)::bigint AS total_branches
        FROM public.districts d
        JOIN public.branches  b ON b.district_id = d.id
       WHERE d.region_id = ANY(p_entity_ids)
       GROUP BY d.region_id
    ),
    aum_cte AS (
      SELECT ss.entity_id, COALESCE(SUM(sb.total_balance), 0) AS aum
        FROM scope_subscriber ss
        JOIN public.subscriber_balances sb ON sb.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    txn AS (
      SELECT ss.entity_id,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution'), 0) AS contributions,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'),   0) AS withdrawals,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_contrib,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastm_start AND t.date < v_lastm_end), 0) AS prev_monthly_withdraw
        FROM scope_subscriber ss
        JOIN public.transactions t ON t.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    monthly_arr_per_entity AS (
      SELECT entity_id, bucket_idx, COALESCE(SUM(amt), 0) AS amt
        FROM (
          SELECT ss.entity_id, gs.idx AS bucket_idx, t.amount AS amt
            FROM scope_subscriber ss
            CROSS JOIN generate_series(0, 11) AS gs(idx)
            LEFT JOIN public.transactions t
              ON t.subscriber_id = ss.subscriber_id
             AND t.type = 'contribution'
             AND t.date >= v_arr_start + (gs.idx * interval '1 month')
             AND t.date <  v_arr_start + ((gs.idx + 1) * interval '1 month')
        ) src
       GROUP BY entity_id, bucket_idx
    ),
    monthly_arr AS (
      SELECT entity_id, jsonb_agg(amt ORDER BY bucket_idx) AS month_array
        FROM monthly_arr_per_entity
       GROUP BY entity_id
    ),
    subs_buckets AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_today_start::date AND ss.registered_date < v_today_end::date)::bigint   AS new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_yest_start::date  AND ss.registered_date < v_yest_end::date)::bigint    AS prev_new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_week_start::date  AND ss.registered_date < v_week_end::date)::bigint    AS new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastw_start::date AND ss.registered_date < v_lastw_end::date)::bigint   AS prev_new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_month_start::date AND ss.registered_date < v_month_end::date)::bigint   AS new_month,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastm_start::date AND ss.registered_date < v_lastm_end::date)::bigint   AS prev_new_month
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    ),
    demo_agg AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.gender='male')::bigint   AS male_n,
        COUNT(*) FILTER (WHERE ss.gender='female')::bigint AS female_n,
        COUNT(*) FILTER (WHERE ss.gender='other')::bigint  AS other_n,
        COUNT(*)::bigint                                    AS total_n,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 18 AND 25)::bigint AS age_18_25,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 26 AND 35)::bigint AS age_26_35,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 36 AND 45)::bigint AS age_36_45,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 46 AND 55)::bigint AS age_46_55,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) >= 56)::bigint              AS age_56_plus,
        COUNT(*) FILTER (WHERE ss.kyc_status='pending')::bigint    AS kyc_pending,
        COUNT(*) FILTER (WHERE ss.kyc_status='incomplete')::bigint AS kyc_incomplete
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    )
    SELECT jsonb_object_agg(
      i.entity_id,
      jsonb_build_object(
        'totalSubscribers',   COALESCE(c.total_subscribers, 0),
        'activeSubscribers',  COALESCE(c.active_subscribers, 0),
        'totalAgents',        COALESCE(c.total_agents, 0),
        'totalBranches',      COALESCE(bc.total_branches, 0),
        'totalContributions', COALESCE(tx.contributions, 0),
        'totalWithdrawals',   COALESCE(tx.withdrawals, 0),
        'aum',                COALESCE(au.aum, 0),
        'activeRate',         CASE WHEN COALESCE(c.total_subscribers, 0) > 0
                                   THEN ROUND((c.active_subscribers::numeric / c.total_subscribers) * 100)
                                   ELSE 0 END,
        'coverageRate',       COALESCE(c.coverage_rate, 0),
        'dailyContributions',           COALESCE(tx.daily_contrib, 0),
        'prevDailyContributions',       COALESCE(tx.prev_daily_contrib, 0),
        'weeklyContributions',          COALESCE(tx.weekly_contrib, 0),
        'prevWeeklyContributions',      COALESCE(tx.prev_weekly_contrib, 0),
        'monthlyContributions',         COALESCE(ma.month_array, '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb),
        'dailyWithdrawals',             COALESCE(tx.daily_withdraw, 0),
        'prevDailyWithdrawals',         COALESCE(tx.prev_daily_withdraw, 0),
        'weeklyWithdrawals',            COALESCE(tx.weekly_withdraw, 0),
        'prevWeeklyWithdrawals',        COALESCE(tx.prev_weekly_withdraw, 0),
        'monthlyWithdrawals',           COALESCE(tx.monthly_withdraw, 0),
        'prevMonthlyWithdrawals',       COALESCE(tx.prev_monthly_withdraw, 0),
        'newSubscribersToday',          COALESCE(sb.new_today, 0),
        'prevNewSubscribersToday',      COALESCE(sb.prev_new_today, 0),
        'newSubscribersThisWeek',       COALESCE(sb.new_week, 0),
        'prevNewSubscribersThisWeek',   COALESCE(sb.prev_new_week, 0),
        'newSubscribersThisMonth',      COALESCE(sb.new_month, 0),
        'prevNewSubscribersThisMonth',  COALESCE(sb.prev_new_month, 0),
        'genderRatio',  jsonb_build_object(
                          'male',   CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.male_n::numeric   / d.total_n) * 100) ELSE 0 END,
                          'female', CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.female_n::numeric / d.total_n) * 100) ELSE 0 END,
                          'other',  CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.other_n::numeric  / d.total_n) * 100) ELSE 0 END
                        ),
        'ageDistribution', jsonb_build_object(
                             '18-25', COALESCE(d.age_18_25,   0),
                             '26-35', COALESCE(d.age_26_35,   0),
                             '36-45', COALESCE(d.age_36_45,   0),
                             '46-55', COALESCE(d.age_46_55,   0),
                             '56+',   COALESCE(d.age_56_plus, 0)
                           ),
        'kycPending',    COALESCE(d.kyc_pending,    0),
        'kycIncomplete', COALESCE(d.kyc_incomplete, 0)
      )
    )
      INTO v_result
      FROM input i
      LEFT JOIN counts        c  ON c.entity_id  = i.entity_id
      LEFT JOIN branch_count  bc ON bc.entity_id = i.entity_id
      LEFT JOIN aum_cte       au ON au.entity_id = i.entity_id
      LEFT JOIN txn           tx ON tx.entity_id = i.entity_id
      LEFT JOIN monthly_arr   ma ON ma.entity_id = i.entity_id
      LEFT JOIN subs_buckets  sb ON sb.entity_id = i.entity_id
      LEFT JOIN demo_agg      d  ON d.entity_id  = i.entity_id;

    RETURN COALESCE(v_result, '{}'::jsonb);
  END IF;

  -- ===========================================================================
  -- DISTRICT level
  -- ===========================================================================
  IF p_level = 'district' THEN
    WITH input AS (
      SELECT unnest(p_entity_ids) AS entity_id
    ),
    scope_subscriber AS (
      SELECT b.district_id AS entity_id, s.id AS subscriber_id, s.agent_id,
             s.gender, s.age, s.dob, s.kyc_status, s.is_active, s.registered_date
        FROM public.branches b
        JOIN public.agents   a ON a.branch_id = b.id
        JOIN public.subscribers s ON s.agent_id = a.id
       WHERE b.district_id = ANY(p_entity_ids)
    ),
    scope_agent AS (
      SELECT b.district_id AS entity_id, a.id AS agent_id, a.coverage_rate
        FROM public.branches b
        JOIN public.agents   a ON a.branch_id = b.id
       WHERE b.district_id = ANY(p_entity_ids)
    ),
    per_agent AS (
      SELECT sa.entity_id, sa.agent_id, sa.coverage_rate,
             COUNT(s.subscriber_id)                            AS total_subs,
             COUNT(s.subscriber_id) FILTER (WHERE s.is_active) AS active_subs
        FROM scope_agent sa
        LEFT JOIN scope_subscriber s
          ON s.entity_id = sa.entity_id AND s.agent_id = sa.agent_id
       GROUP BY sa.entity_id, sa.agent_id, sa.coverage_rate
    ),
    counts AS (
      SELECT entity_id,
             SUM(total_subs)::bigint                AS total_subscribers,
             SUM(active_subs)::bigint               AS active_subscribers,
             COUNT(DISTINCT agent_id)::bigint       AS total_agents,
             CASE WHEN SUM(total_subs) > 0
                  THEN ROUND(SUM(coverage_rate * total_subs)::numeric
                               / NULLIF(SUM(total_subs), 0))
                  ELSE 0 END                        AS coverage_rate
        FROM per_agent
       GROUP BY entity_id
    ),
    branch_count AS (
      SELECT b.district_id AS entity_id, COUNT(*)::bigint AS total_branches
        FROM public.branches b
       WHERE b.district_id = ANY(p_entity_ids)
       GROUP BY b.district_id
    ),
    aum_cte AS (
      SELECT ss.entity_id, COALESCE(SUM(sb.total_balance), 0) AS aum
        FROM scope_subscriber ss
        JOIN public.subscriber_balances sb ON sb.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    txn AS (
      SELECT ss.entity_id,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution'), 0) AS contributions,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'),   0) AS withdrawals,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_contrib,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastm_start AND t.date < v_lastm_end), 0) AS prev_monthly_withdraw
        FROM scope_subscriber ss
        JOIN public.transactions t ON t.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    monthly_arr_per_entity AS (
      SELECT entity_id, bucket_idx, COALESCE(SUM(amt), 0) AS amt
        FROM (
          SELECT ss.entity_id, gs.idx AS bucket_idx, t.amount AS amt
            FROM scope_subscriber ss
            CROSS JOIN generate_series(0, 11) AS gs(idx)
            LEFT JOIN public.transactions t
              ON t.subscriber_id = ss.subscriber_id
             AND t.type = 'contribution'
             AND t.date >= v_arr_start + (gs.idx * interval '1 month')
             AND t.date <  v_arr_start + ((gs.idx + 1) * interval '1 month')
        ) src
       GROUP BY entity_id, bucket_idx
    ),
    monthly_arr AS (
      SELECT entity_id, jsonb_agg(amt ORDER BY bucket_idx) AS month_array
        FROM monthly_arr_per_entity
       GROUP BY entity_id
    ),
    subs_buckets AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_today_start::date AND ss.registered_date < v_today_end::date)::bigint   AS new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_yest_start::date  AND ss.registered_date < v_yest_end::date)::bigint    AS prev_new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_week_start::date  AND ss.registered_date < v_week_end::date)::bigint    AS new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastw_start::date AND ss.registered_date < v_lastw_end::date)::bigint   AS prev_new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_month_start::date AND ss.registered_date < v_month_end::date)::bigint   AS new_month,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastm_start::date AND ss.registered_date < v_lastm_end::date)::bigint   AS prev_new_month
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    ),
    demo_agg AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.gender='male')::bigint   AS male_n,
        COUNT(*) FILTER (WHERE ss.gender='female')::bigint AS female_n,
        COUNT(*) FILTER (WHERE ss.gender='other')::bigint  AS other_n,
        COUNT(*)::bigint                                    AS total_n,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 18 AND 25)::bigint AS age_18_25,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 26 AND 35)::bigint AS age_26_35,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 36 AND 45)::bigint AS age_36_45,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 46 AND 55)::bigint AS age_46_55,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) >= 56)::bigint              AS age_56_plus,
        COUNT(*) FILTER (WHERE ss.kyc_status='pending')::bigint    AS kyc_pending,
        COUNT(*) FILTER (WHERE ss.kyc_status='incomplete')::bigint AS kyc_incomplete
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    )
    SELECT jsonb_object_agg(
      i.entity_id,
      jsonb_build_object(
        'totalSubscribers',   COALESCE(c.total_subscribers, 0),
        'activeSubscribers',  COALESCE(c.active_subscribers, 0),
        'totalAgents',        COALESCE(c.total_agents, 0),
        'totalBranches',      COALESCE(bc.total_branches, 0),
        'totalContributions', COALESCE(tx.contributions, 0),
        'totalWithdrawals',   COALESCE(tx.withdrawals, 0),
        'aum',                COALESCE(au.aum, 0),
        'activeRate',         CASE WHEN COALESCE(c.total_subscribers, 0) > 0
                                   THEN ROUND((c.active_subscribers::numeric / c.total_subscribers) * 100)
                                   ELSE 0 END,
        'coverageRate',       COALESCE(c.coverage_rate, 0),
        'dailyContributions',           COALESCE(tx.daily_contrib, 0),
        'prevDailyContributions',       COALESCE(tx.prev_daily_contrib, 0),
        'weeklyContributions',          COALESCE(tx.weekly_contrib, 0),
        'prevWeeklyContributions',      COALESCE(tx.prev_weekly_contrib, 0),
        'monthlyContributions',         COALESCE(ma.month_array, '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb),
        'dailyWithdrawals',             COALESCE(tx.daily_withdraw, 0),
        'prevDailyWithdrawals',         COALESCE(tx.prev_daily_withdraw, 0),
        'weeklyWithdrawals',            COALESCE(tx.weekly_withdraw, 0),
        'prevWeeklyWithdrawals',        COALESCE(tx.prev_weekly_withdraw, 0),
        'monthlyWithdrawals',           COALESCE(tx.monthly_withdraw, 0),
        'prevMonthlyWithdrawals',       COALESCE(tx.prev_monthly_withdraw, 0),
        'newSubscribersToday',          COALESCE(sb.new_today, 0),
        'prevNewSubscribersToday',      COALESCE(sb.prev_new_today, 0),
        'newSubscribersThisWeek',       COALESCE(sb.new_week, 0),
        'prevNewSubscribersThisWeek',   COALESCE(sb.prev_new_week, 0),
        'newSubscribersThisMonth',      COALESCE(sb.new_month, 0),
        'prevNewSubscribersThisMonth',  COALESCE(sb.prev_new_month, 0),
        'genderRatio',  jsonb_build_object(
                          'male',   CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.male_n::numeric   / d.total_n) * 100) ELSE 0 END,
                          'female', CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.female_n::numeric / d.total_n) * 100) ELSE 0 END,
                          'other',  CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.other_n::numeric  / d.total_n) * 100) ELSE 0 END
                        ),
        'ageDistribution', jsonb_build_object(
                             '18-25', COALESCE(d.age_18_25,   0),
                             '26-35', COALESCE(d.age_26_35,   0),
                             '36-45', COALESCE(d.age_36_45,   0),
                             '46-55', COALESCE(d.age_46_55,   0),
                             '56+',   COALESCE(d.age_56_plus, 0)
                           ),
        'kycPending',    COALESCE(d.kyc_pending,    0),
        'kycIncomplete', COALESCE(d.kyc_incomplete, 0)
      )
    )
      INTO v_result
      FROM input i
      LEFT JOIN counts        c  ON c.entity_id  = i.entity_id
      LEFT JOIN branch_count  bc ON bc.entity_id = i.entity_id
      LEFT JOIN aum_cte       au ON au.entity_id = i.entity_id
      LEFT JOIN txn           tx ON tx.entity_id = i.entity_id
      LEFT JOIN monthly_arr   ma ON ma.entity_id = i.entity_id
      LEFT JOIN subs_buckets  sb ON sb.entity_id = i.entity_id
      LEFT JOIN demo_agg      d  ON d.entity_id  = i.entity_id;

    RETURN COALESCE(v_result, '{}'::jsonb);
  END IF;

  -- ===========================================================================
  -- BRANCH level
  -- ===========================================================================
  IF p_level = 'branch' THEN
    IF v_role = 'branch' THEN
      IF EXISTS (
        SELECT 1 FROM unnest(p_entity_ids) AS bid
         WHERE bid <> (auth.jwt() ->> 'branchId')
      ) THEN
        RAISE EXCEPTION 'out_of_scope' USING ERRCODE = 'P0003';
      END IF;
    END IF;

    WITH input AS (
      SELECT unnest(p_entity_ids) AS entity_id
    ),
    scope_subscriber AS (
      SELECT a.branch_id AS entity_id, s.id AS subscriber_id, s.agent_id,
             s.gender, s.age, s.dob, s.kyc_status, s.is_active, s.registered_date
        FROM public.agents a
        JOIN public.subscribers s ON s.agent_id = a.id
       WHERE a.branch_id = ANY(p_entity_ids)
    ),
    scope_agent AS (
      SELECT a.branch_id AS entity_id, a.id AS agent_id, a.coverage_rate
        FROM public.agents a
       WHERE a.branch_id = ANY(p_entity_ids)
    ),
    per_agent AS (
      SELECT sa.entity_id, sa.agent_id, sa.coverage_rate,
             COUNT(s.subscriber_id)                            AS total_subs,
             COUNT(s.subscriber_id) FILTER (WHERE s.is_active) AS active_subs
        FROM scope_agent sa
        LEFT JOIN scope_subscriber s
          ON s.entity_id = sa.entity_id AND s.agent_id = sa.agent_id
       GROUP BY sa.entity_id, sa.agent_id, sa.coverage_rate
    ),
    counts AS (
      SELECT entity_id,
             SUM(total_subs)::bigint                AS total_subscribers,
             SUM(active_subs)::bigint               AS active_subscribers,
             COUNT(DISTINCT agent_id)::bigint       AS total_agents,
             CASE WHEN SUM(total_subs) > 0
                  THEN ROUND(SUM(coverage_rate * total_subs)::numeric
                               / NULLIF(SUM(total_subs), 0))
                  ELSE 0 END                        AS coverage_rate
        FROM per_agent
       GROUP BY entity_id
    ),
    aum_cte AS (
      SELECT ss.entity_id, COALESCE(SUM(sb.total_balance), 0) AS aum
        FROM scope_subscriber ss
        JOIN public.subscriber_balances sb ON sb.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    txn AS (
      SELECT ss.entity_id,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution'), 0) AS contributions,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'),   0) AS withdrawals,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_contrib,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastm_start AND t.date < v_lastm_end), 0) AS prev_monthly_withdraw
        FROM scope_subscriber ss
        JOIN public.transactions t ON t.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    monthly_arr_per_entity AS (
      SELECT entity_id, bucket_idx, COALESCE(SUM(amt), 0) AS amt
        FROM (
          SELECT ss.entity_id, gs.idx AS bucket_idx, t.amount AS amt
            FROM scope_subscriber ss
            CROSS JOIN generate_series(0, 11) AS gs(idx)
            LEFT JOIN public.transactions t
              ON t.subscriber_id = ss.subscriber_id
             AND t.type = 'contribution'
             AND t.date >= v_arr_start + (gs.idx * interval '1 month')
             AND t.date <  v_arr_start + ((gs.idx + 1) * interval '1 month')
        ) src
       GROUP BY entity_id, bucket_idx
    ),
    monthly_arr AS (
      SELECT entity_id, jsonb_agg(amt ORDER BY bucket_idx) AS month_array
        FROM monthly_arr_per_entity
       GROUP BY entity_id
    ),
    subs_buckets AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_today_start::date AND ss.registered_date < v_today_end::date)::bigint   AS new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_yest_start::date  AND ss.registered_date < v_yest_end::date)::bigint    AS prev_new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_week_start::date  AND ss.registered_date < v_week_end::date)::bigint    AS new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastw_start::date AND ss.registered_date < v_lastw_end::date)::bigint   AS prev_new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_month_start::date AND ss.registered_date < v_month_end::date)::bigint   AS new_month,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastm_start::date AND ss.registered_date < v_lastm_end::date)::bigint   AS prev_new_month
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    ),
    demo_agg AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.gender='male')::bigint   AS male_n,
        COUNT(*) FILTER (WHERE ss.gender='female')::bigint AS female_n,
        COUNT(*) FILTER (WHERE ss.gender='other')::bigint  AS other_n,
        COUNT(*)::bigint                                    AS total_n,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 18 AND 25)::bigint AS age_18_25,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 26 AND 35)::bigint AS age_26_35,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 36 AND 45)::bigint AS age_36_45,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 46 AND 55)::bigint AS age_46_55,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) >= 56)::bigint              AS age_56_plus,
        COUNT(*) FILTER (WHERE ss.kyc_status='pending')::bigint    AS kyc_pending,
        COUNT(*) FILTER (WHERE ss.kyc_status='incomplete')::bigint AS kyc_incomplete
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    )
    SELECT jsonb_object_agg(
      i.entity_id,
      jsonb_build_object(
        'totalSubscribers',   COALESCE(c.total_subscribers, 0),
        'activeSubscribers',  COALESCE(c.active_subscribers, 0),
        'totalAgents',        COALESCE(c.total_agents, 0),
        'totalBranches',      1,
        'totalContributions', COALESCE(tx.contributions, 0),
        'totalWithdrawals',   COALESCE(tx.withdrawals, 0),
        'aum',                COALESCE(au.aum, 0),
        'activeRate',         CASE WHEN COALESCE(c.total_subscribers, 0) > 0
                                   THEN ROUND((c.active_subscribers::numeric / c.total_subscribers) * 100)
                                   ELSE 0 END,
        'coverageRate',       COALESCE(c.coverage_rate, 0),
        'dailyContributions',           COALESCE(tx.daily_contrib, 0),
        'prevDailyContributions',       COALESCE(tx.prev_daily_contrib, 0),
        'weeklyContributions',          COALESCE(tx.weekly_contrib, 0),
        'prevWeeklyContributions',      COALESCE(tx.prev_weekly_contrib, 0),
        'monthlyContributions',         COALESCE(ma.month_array, '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb),
        'dailyWithdrawals',             COALESCE(tx.daily_withdraw, 0),
        'prevDailyWithdrawals',         COALESCE(tx.prev_daily_withdraw, 0),
        'weeklyWithdrawals',            COALESCE(tx.weekly_withdraw, 0),
        'prevWeeklyWithdrawals',        COALESCE(tx.prev_weekly_withdraw, 0),
        'monthlyWithdrawals',           COALESCE(tx.monthly_withdraw, 0),
        'prevMonthlyWithdrawals',       COALESCE(tx.prev_monthly_withdraw, 0),
        'newSubscribersToday',          COALESCE(sb.new_today, 0),
        'prevNewSubscribersToday',      COALESCE(sb.prev_new_today, 0),
        'newSubscribersThisWeek',       COALESCE(sb.new_week, 0),
        'prevNewSubscribersThisWeek',   COALESCE(sb.prev_new_week, 0),
        'newSubscribersThisMonth',      COALESCE(sb.new_month, 0),
        'prevNewSubscribersThisMonth',  COALESCE(sb.prev_new_month, 0),
        'genderRatio',  jsonb_build_object(
                          'male',   CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.male_n::numeric   / d.total_n) * 100) ELSE 0 END,
                          'female', CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.female_n::numeric / d.total_n) * 100) ELSE 0 END,
                          'other',  CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.other_n::numeric  / d.total_n) * 100) ELSE 0 END
                        ),
        'ageDistribution', jsonb_build_object(
                             '18-25', COALESCE(d.age_18_25,   0),
                             '26-35', COALESCE(d.age_26_35,   0),
                             '36-45', COALESCE(d.age_36_45,   0),
                             '46-55', COALESCE(d.age_46_55,   0),
                             '56+',   COALESCE(d.age_56_plus, 0)
                           ),
        'kycPending',    COALESCE(d.kyc_pending,    0),
        'kycIncomplete', COALESCE(d.kyc_incomplete, 0)
      )
    )
      INTO v_result
      FROM input i
      LEFT JOIN counts        c  ON c.entity_id  = i.entity_id
      LEFT JOIN aum_cte       au ON au.entity_id = i.entity_id
      LEFT JOIN txn           tx ON tx.entity_id = i.entity_id
      LEFT JOIN monthly_arr   ma ON ma.entity_id = i.entity_id
      LEFT JOIN subs_buckets  sb ON sb.entity_id = i.entity_id
      LEFT JOIN demo_agg      d  ON d.entity_id  = i.entity_id;

    RETURN COALESCE(v_result, '{}'::jsonb);
  END IF;

  -- ===========================================================================
  -- AGENT level
  -- ===========================================================================
  IF p_level = 'agent' THEN
    IF v_role = 'agent' THEN
      IF EXISTS (
        SELECT 1 FROM unnest(p_entity_ids) AS aid
         WHERE aid <> (auth.jwt() ->> 'agentId')
      ) THEN
        RAISE EXCEPTION 'out_of_scope' USING ERRCODE = 'P0003';
      END IF;
    END IF;

    WITH input AS (
      SELECT unnest(p_entity_ids) AS entity_id
    ),
    scope_subscriber AS (
      SELECT s.agent_id AS entity_id, s.id AS subscriber_id,
             s.gender, s.age, s.dob, s.kyc_status, s.is_active, s.registered_date
        FROM public.subscribers s
       WHERE s.agent_id = ANY(p_entity_ids)
    ),
    counts AS (
      SELECT a.id AS entity_id, a.coverage_rate,
             COUNT(s.subscriber_id)::bigint                            AS total_subscribers,
             COUNT(s.subscriber_id) FILTER (WHERE s.is_active)::bigint AS active_subscribers
        FROM public.agents a
        LEFT JOIN scope_subscriber s ON s.entity_id = a.id
       WHERE a.id = ANY(p_entity_ids)
       GROUP BY a.id, a.coverage_rate
    ),
    aum_cte AS (
      SELECT ss.entity_id, COALESCE(SUM(sb.total_balance), 0) AS aum
        FROM scope_subscriber ss
        JOIN public.subscriber_balances sb ON sb.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    txn AS (
      SELECT ss.entity_id,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution'), 0) AS contributions,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'),   0) AS withdrawals,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_contrib,
        COALESCE(SUM(t.amount)      FILTER (WHERE t.type='contribution' AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_contrib,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_today_start AND t.date < v_today_end), 0) AS daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_yest_start  AND t.date < v_yest_end),  0) AS prev_daily_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_week_start  AND t.date < v_week_end),  0) AS weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastw_start AND t.date < v_lastw_end), 0) AS prev_weekly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_month_start AND t.date < v_month_end), 0) AS monthly_withdraw,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='withdrawal'   AND t.date >= v_lastm_start AND t.date < v_lastm_end), 0) AS prev_monthly_withdraw
        FROM scope_subscriber ss
        JOIN public.transactions t ON t.subscriber_id = ss.subscriber_id
       GROUP BY ss.entity_id
    ),
    monthly_arr_per_entity AS (
      SELECT entity_id, bucket_idx, COALESCE(SUM(amt), 0) AS amt
        FROM (
          SELECT ss.entity_id, gs.idx AS bucket_idx, t.amount AS amt
            FROM scope_subscriber ss
            CROSS JOIN generate_series(0, 11) AS gs(idx)
            LEFT JOIN public.transactions t
              ON t.subscriber_id = ss.subscriber_id
             AND t.type = 'contribution'
             AND t.date >= v_arr_start + (gs.idx * interval '1 month')
             AND t.date <  v_arr_start + ((gs.idx + 1) * interval '1 month')
        ) src
       GROUP BY entity_id, bucket_idx
    ),
    monthly_arr AS (
      SELECT entity_id, jsonb_agg(amt ORDER BY bucket_idx) AS month_array
        FROM monthly_arr_per_entity
       GROUP BY entity_id
    ),
    subs_buckets AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_today_start::date AND ss.registered_date < v_today_end::date)::bigint   AS new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_yest_start::date  AND ss.registered_date < v_yest_end::date)::bigint    AS prev_new_today,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_week_start::date  AND ss.registered_date < v_week_end::date)::bigint    AS new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastw_start::date AND ss.registered_date < v_lastw_end::date)::bigint   AS prev_new_week,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_month_start::date AND ss.registered_date < v_month_end::date)::bigint   AS new_month,
        COUNT(*) FILTER (WHERE ss.registered_date >= v_lastm_start::date AND ss.registered_date < v_lastm_end::date)::bigint   AS prev_new_month
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    ),
    demo_agg AS (
      SELECT ss.entity_id,
        COUNT(*) FILTER (WHERE ss.gender='male')::bigint   AS male_n,
        COUNT(*) FILTER (WHERE ss.gender='female')::bigint AS female_n,
        COUNT(*) FILTER (WHERE ss.gender='other')::bigint  AS other_n,
        COUNT(*)::bigint                                    AS total_n,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 18 AND 25)::bigint AS age_18_25,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 26 AND 35)::bigint AS age_26_35,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 36 AND 45)::bigint AS age_36_45,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) BETWEEN 46 AND 55)::bigint AS age_46_55,
        COUNT(*) FILTER (WHERE COALESCE(ss.age, EXTRACT(YEAR FROM age(v_now::date, ss.dob))::int) >= 56)::bigint              AS age_56_plus,
        COUNT(*) FILTER (WHERE ss.kyc_status='pending')::bigint    AS kyc_pending,
        COUNT(*) FILTER (WHERE ss.kyc_status='incomplete')::bigint AS kyc_incomplete
        FROM scope_subscriber ss
       GROUP BY ss.entity_id
    )
    SELECT jsonb_object_agg(
      i.entity_id,
      jsonb_build_object(
        'totalSubscribers',   COALESCE(c.total_subscribers, 0),
        'activeSubscribers',  COALESCE(c.active_subscribers, 0),
        'totalAgents',        1,
        'totalBranches',      0,
        'totalContributions', COALESCE(tx.contributions, 0),
        'totalWithdrawals',   COALESCE(tx.withdrawals, 0),
        'aum',                COALESCE(au.aum, 0),
        'activeRate',         CASE WHEN COALESCE(c.total_subscribers, 0) > 0
                                   THEN ROUND((c.active_subscribers::numeric / c.total_subscribers) * 100)
                                   ELSE 0 END,
        'coverageRate',       COALESCE(c.coverage_rate, 0),
        'dailyContributions',           COALESCE(tx.daily_contrib, 0),
        'prevDailyContributions',       COALESCE(tx.prev_daily_contrib, 0),
        'weeklyContributions',          COALESCE(tx.weekly_contrib, 0),
        'prevWeeklyContributions',      COALESCE(tx.prev_weekly_contrib, 0),
        'monthlyContributions',         COALESCE(ma.month_array, '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb),
        'dailyWithdrawals',             COALESCE(tx.daily_withdraw, 0),
        'prevDailyWithdrawals',         COALESCE(tx.prev_daily_withdraw, 0),
        'weeklyWithdrawals',            COALESCE(tx.weekly_withdraw, 0),
        'prevWeeklyWithdrawals',        COALESCE(tx.prev_weekly_withdraw, 0),
        'monthlyWithdrawals',           COALESCE(tx.monthly_withdraw, 0),
        'prevMonthlyWithdrawals',       COALESCE(tx.prev_monthly_withdraw, 0),
        'newSubscribersToday',          COALESCE(sb.new_today, 0),
        'prevNewSubscribersToday',      COALESCE(sb.prev_new_today, 0),
        'newSubscribersThisWeek',       COALESCE(sb.new_week, 0),
        'prevNewSubscribersThisWeek',   COALESCE(sb.prev_new_week, 0),
        'newSubscribersThisMonth',      COALESCE(sb.new_month, 0),
        'prevNewSubscribersThisMonth',  COALESCE(sb.prev_new_month, 0),
        'genderRatio',  jsonb_build_object(
                          'male',   CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.male_n::numeric   / d.total_n) * 100) ELSE 0 END,
                          'female', CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.female_n::numeric / d.total_n) * 100) ELSE 0 END,
                          'other',  CASE WHEN COALESCE(d.total_n,0) > 0 THEN ROUND((d.other_n::numeric  / d.total_n) * 100) ELSE 0 END
                        ),
        'ageDistribution', jsonb_build_object(
                             '18-25', COALESCE(d.age_18_25,   0),
                             '26-35', COALESCE(d.age_26_35,   0),
                             '36-45', COALESCE(d.age_36_45,   0),
                             '46-55', COALESCE(d.age_46_55,   0),
                             '56+',   COALESCE(d.age_56_plus, 0)
                           ),
        'kycPending',    COALESCE(d.kyc_pending,    0),
        'kycIncomplete', COALESCE(d.kyc_incomplete, 0)
      )
    )
      INTO v_result
      FROM input i
      LEFT JOIN counts        c  ON c.entity_id  = i.entity_id
      LEFT JOIN aum_cte       au ON au.entity_id = i.entity_id
      LEFT JOIN txn           tx ON tx.entity_id = i.entity_id
      LEFT JOIN monthly_arr   ma ON ma.entity_id = i.entity_id
      LEFT JOIN subs_buckets  sb ON sb.entity_id = i.entity_id
      LEFT JOIN demo_agg      d  ON d.entity_id  = i.entity_id;

    RETURN COALESCE(v_result, '{}'::jsonb);
  END IF;

  RAISE EXCEPTION 'unknown_level: %', p_level USING ERRCODE = 'P0004';
END;
$$;
