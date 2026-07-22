-- =============================================================================
-- Universal Pensions Uganda — 0077: get_top_entities (bounded top-N landing read)
-- =============================================================================
-- The distributor + admin country overviews (DistributorOverview / AdminOverview)
-- render a "Top branches" and a "Top agents" table (6 rows each) on the DEFAULT
-- dash landing shown at every desktop login. Previously they did this by pulling
-- the ENTIRE agent collection (~2,000+ rows, paginated over ~4 round-trips) and
-- the entire branch collection into the browser via useAllEntities(...) +
-- useAllEntitiesMetrics(...), then sorting client-side and slicing the top 6 —
-- re-introducing the exact cold-load fan-out the AUDIT-1-10 lazy-mount work had
-- removed. It does not scale past a fixed demo seed.
--
-- This RPC returns ONLY the N rows each table renders, sorted + limited
-- server-side, as display-ready rows (identity + parent name + the table metrics).
-- Metric semantics MIRROR get_entity_metrics_rollup (0020/0057) exactly:
--   * aum                 = SUM(subscriber_balances.total_balance)  — its own CTE
--   * total_contributions = SUM(transactions.amount) FILTER contribution — its own CTE
--   * total_subscribers / active_subs via the agent tree
-- AUM and contributions live in SEPARATE CTEs joined per-entity so the
-- one-balance-row vs many-transaction-rows fan-out never double-counts (identical
-- structure to the rollup's aum_cte / txn split).
--
-- Sort keys: 'aum' | 'contributions' | 'subscribers' (default aum for branch,
-- contributions for agent — what the two tables use). Levels: 'branch' | 'agent'.
--
-- CONVENTIONS (mirroring 0050 / 0057):
--   * LANGUAGE plpgsql; STABLE; SECURITY DEFINER; SET search_path = public, pg_temp
--   * REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated
--   * Role gate reads (auth.jwt() ->> 'app_role') per the canonical JWT contract
--     (api/_lib/jwt.ts) — NOT 'role' (which is always 'authenticated'). Only the
--     platform-wide roles that land on the country overview may call it.
-- Idempotent: CREATE OR REPLACE. Forward-only per BACKEND.md §7.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_top_entities(
  p_level    TEXT,
  p_sort_key TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 6
)
RETURNS TABLE (
  id                  TEXT,
  name                TEXT,
  parent_id           TEXT,
  parent_name         TEXT,
  manager_name        TEXT,
  status              TEXT,
  total_subscribers   BIGINT,
  active_rate         INT,
  aum                 NUMERIC,
  total_contributions NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- COALESCE NULL→'' so the NOT-IN gate raises reliably (NULL NOT IN (...) is NULL).
  v_role  TEXT := COALESCE(auth.jwt() ->> 'app_role', '');
  v_sort  TEXT := COALESCE(p_sort_key, CASE WHEN p_level = 'agent' THEN 'contributions' ELSE 'aum' END);
  v_limit INT  := LEAST(GREATEST(COALESCE(p_limit, 6), 1), 50);
BEGIN
  IF v_role = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  -- Only distributor + admin land on the country overview that renders these
  -- tables; branch/agent have their own dashboards.
  IF v_role NOT IN ('distributor', 'admin') THEN
    RAISE EXCEPTION 'role_not_permitted' USING ERRCODE = 'P0002';
  END IF;

  IF p_level = 'branch' THEN
    RETURN QUERY
    WITH sub_per_branch AS (
      SELECT a.branch_id AS bid,
             COUNT(s.id)                            AS total_subs,
             COUNT(s.id) FILTER (WHERE s.is_active) AS active_subs
        FROM public.agents a
        LEFT JOIN public.subscribers s ON s.agent_id = a.id
       GROUP BY a.branch_id
    ),
    aum_per_branch AS (
      SELECT a.branch_id AS bid, COALESCE(SUM(sb.total_balance), 0) AS aum
        FROM public.agents a
        JOIN public.subscribers s ON s.agent_id = a.id
        JOIN public.subscriber_balances sb ON sb.subscriber_id = s.id
       GROUP BY a.branch_id
    ),
    contrib_per_branch AS (
      SELECT a.branch_id AS bid,
             COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'contribution'), 0) AS total_contrib
        FROM public.agents a
        JOIN public.subscribers s ON s.agent_id = a.id
        JOIN public.transactions t ON t.subscriber_id = s.id
       GROUP BY a.branch_id
    )
    SELECT b.id, b.name, b.district_id, d.name, b.manager_name, b.status,
           COALESCE(spb.total_subs, 0)::BIGINT,
           CASE WHEN COALESCE(spb.total_subs, 0) > 0
                THEN ROUND(spb.active_subs::NUMERIC / spb.total_subs * 100)::INT
                ELSE 0 END,
           COALESCE(apb.aum, 0)::NUMERIC,
           COALESCE(cpb.total_contrib, 0)::NUMERIC
      FROM public.branches b
      LEFT JOIN public.districts   d   ON d.id  = b.district_id
      LEFT JOIN sub_per_branch     spb ON spb.bid = b.id
      LEFT JOIN aum_per_branch     apb ON apb.bid = b.id
      LEFT JOIN contrib_per_branch cpb ON cpb.bid = b.id
     ORDER BY CASE v_sort
                WHEN 'contributions' THEN COALESCE(cpb.total_contrib, 0)
                WHEN 'subscribers'   THEN COALESCE(spb.total_subs, 0)::NUMERIC
                ELSE COALESCE(apb.aum, 0)
              END DESC
     LIMIT v_limit;
    RETURN;
  END IF;

  IF p_level = 'agent' THEN
    RETURN QUERY
    WITH sub_per_agent AS (
      SELECT s.agent_id AS aid,
             COUNT(*)                            AS total_subs,
             COUNT(*) FILTER (WHERE s.is_active) AS active_subs
        FROM public.subscribers s
       GROUP BY s.agent_id
    ),
    aum_per_agent AS (
      SELECT s.agent_id AS aid, COALESCE(SUM(sb.total_balance), 0) AS aum
        FROM public.subscribers s
        JOIN public.subscriber_balances sb ON sb.subscriber_id = s.id
       GROUP BY s.agent_id
    ),
    contrib_per_agent AS (
      SELECT s.agent_id AS aid,
             COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'contribution'), 0) AS total_contrib
        FROM public.subscribers s
        JOIN public.transactions t ON t.subscriber_id = s.id
       GROUP BY s.agent_id
    )
    SELECT a.id, a.name, a.branch_id, br.name, NULL::TEXT, a.status,
           COALESCE(spa.total_subs, 0)::BIGINT,
           CASE WHEN COALESCE(spa.total_subs, 0) > 0
                THEN ROUND(spa.active_subs::NUMERIC / spa.total_subs * 100)::INT
                ELSE 0 END,
           COALESCE(apa.aum, 0)::NUMERIC,
           COALESCE(cpa.total_contrib, 0)::NUMERIC
      FROM public.agents a
      LEFT JOIN public.branches     br  ON br.id = a.branch_id
      LEFT JOIN sub_per_agent       spa ON spa.aid = a.id
      LEFT JOIN aum_per_agent       apa ON apa.aid = a.id
      LEFT JOIN contrib_per_agent   cpa ON cpa.aid = a.id
     ORDER BY CASE v_sort
                WHEN 'aum'         THEN COALESCE(apa.aum, 0)
                WHEN 'subscribers' THEN COALESCE(spa.total_subs, 0)::NUMERIC
                ELSE COALESCE(cpa.total_contrib, 0)
              END DESC
     LIMIT v_limit;
    RETURN;
  END IF;

  RAISE EXCEPTION 'unknown_level: %', p_level USING ERRCODE = 'P0004';
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_entities(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_entities(TEXT, TEXT, INT) TO authenticated;

-- =============================================================================
-- End of 0077_top_entities.sql
-- =============================================================================
