-- 0088_distributor_rollup.sql
-- Per-distributor counts for the admin's Distributor Network page.
--
-- Until 0060 there was no ownership column, so ViewDistributors repeated
-- PLATFORM-WIDE totals under every distributor row and its file header
-- explained that per-distributor rollups were impossible. Both are now false:
-- `branches.distributor_id` exists, is backfilled and indexed, and 0081 made it
-- the ownership edge for every scoped read. With two real tenants (d-001: 289
-- branches / d-002: 27) showing "316 branches" under each row is actively
-- misleading.
--
-- Bounded by construction — one row per distributor (2 today) — so this follows
-- the `get_top_entities` (0077) precedent of aggregating server-side instead of
-- shipping the ~2k-agent and ~5k-subscriber collections to the client just to
-- length them. Admin-only: the page is admin-only, and a distributor has no
-- business reading another's totals.
--
-- LEFT JOINs throughout: a distributor that owns nothing must still appear,
-- with zeros, rather than vanishing from the catalog.

CREATE OR REPLACE FUNCTION public.get_distributor_rollup()
RETURNS TABLE(
  distributor_id text,
  branches       bigint,
  agents         bigint,
  subscribers    bigint,
  active_subscribers bigint,
  aum            numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    d.id,
    COUNT(DISTINCT b.id)                                                   AS branches,
    COUNT(DISTINCT a.id)                                                   AS agents,
    COUNT(DISTINCT s.id)                                                   AS subscribers,
    COUNT(DISTINCT s.id) FILTER (WHERE s.is_active)                        AS active_subscribers,
    COALESCE(SUM(sb.total_balance), 0)                                     AS aum
  FROM public.distributors d
  LEFT JOIN public.branches           b  ON b.distributor_id = d.id
  LEFT JOIN public.agents             a  ON a.branch_id      = b.id
  LEFT JOIN public.subscribers        s  ON s.agent_id       = a.id
  LEFT JOIN public.subscriber_balances sb ON sb.subscriber_id = s.id
  WHERE (auth.jwt() ->> 'app_role') = 'admin'
  GROUP BY d.id;
$$;

REVOKE ALL   ON FUNCTION public.get_distributor_rollup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_distributor_rollup() TO authenticated;
