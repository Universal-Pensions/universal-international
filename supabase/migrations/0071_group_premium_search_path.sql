-- 0071_group_premium_search_path
--
-- Pin the search_path on public.group_insurance_premium_per_member(jsonb).
--
-- The function was introduced in 0067 as a pure IMMUTABLE SQL helper but without
-- a `SET search_path`, so it is the sole function flagged by the Supabase advisor
-- ("function_search_path_mutable", WARN). It references only built-in operators
-- and jsonb functions (no application tables), so the risk is negligible — this
-- migration exists purely to clear the advisor and keep every function's
-- search_path pinned. Body is byte-identical to 0067; only the `SET search_path`
-- clause is added.

CREATE OR REPLACE FUNCTION public.group_insurance_premium_per_member(p_config jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (SELECT COALESCE(p_config, '{}'::jsonb) AS c),
       gip AS (SELECT (SELECT c FROM cfg) -> 'groupInsuranceProducts' AS g)
  SELECT COALESCE(
    CASE
      WHEN (SELECT g FROM gip) IS NOT NULL AND jsonb_typeof((SELECT g FROM gip)) = 'object' THEN (
        SELECT COALESCE(SUM(
          CASE
            WHEN COALESCE((v.value ->> 'enabled')::boolean, COALESCE(NULLIF(v.value ->> 'cover','')::numeric, 0) > 0)
                 AND COALESCE(NULLIF(v.value ->> 'cover','')::numeric, 0) > 0
            THEN round(COALESCE(NULLIF(v.value ->> 'cover','')::numeric, 0) * 0.002)
            ELSE 0
          END), 0)
        FROM jsonb_each((SELECT g FROM gip)) v
        WHERE v.key IN ('life', 'health', 'funeral')
      )
      ELSE  -- legacy single flat group life
        CASE
          WHEN COALESCE(((SELECT c FROM cfg) ->> 'insuranceEnabled')::boolean,
                        COALESCE(NULLIF((SELECT c FROM cfg) ->> 'groupCoverAmount','')::numeric, 0) > 0)
               AND COALESCE(NULLIF((SELECT c FROM cfg) ->> 'groupCoverAmount','')::numeric, 0) > 0
          THEN round(COALESCE(NULLIF((SELECT c FROM cfg) ->> 'groupCoverAmount','')::numeric, 0) * 0.002)
          ELSE 0
        END
    END, 0);
$$;
