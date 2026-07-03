-- Down: revert public.group_insurance_premium_per_member(jsonb) to the 0067
-- definition (no pinned search_path). Body byte-identical to 0067.

CREATE OR REPLACE FUNCTION public.group_insurance_premium_per_member(p_config jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
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
