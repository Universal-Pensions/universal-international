\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE _a04_walk (subscriber_id TEXT PRIMARY KEY, units NUMERIC NOT NULL, invested NUMERIC NOT NULL, capped INT NOT NULL DEFAULT 0) ON COMMIT DROP;
DO $w$
DECLARE r RECORD; v_sub TEXT:=NULL; v_units NUMERIC:=0; v_inv NUMERIC:=0; v_cap INT:=0; v_want NUMERIC; v_red NUMERIC;
BEGIN
  FOR r IN SELECT t.subscriber_id, t.amount, public.nav_for_date(t.date::date) AS px
             FROM public.transactions t
            WHERE t.type IN ('contribution','withdrawal','premium_sweep','claim')
            ORDER BY t.subscriber_id, t.date, t.id
  LOOP
    IF v_sub IS DISTINCT FROM r.subscriber_id THEN
      IF v_sub IS NOT NULL THEN INSERT INTO _a04_walk VALUES (v_sub, v_units, v_inv, v_cap); END IF;
      v_sub := r.subscriber_id; v_units := 0; v_inv := 0; v_cap := 0;
    END IF;
    IF r.amount >= 0 THEN
      v_units := v_units + (r.amount / r.px); v_inv := v_inv + r.amount;
    ELSE
      v_want := (-r.amount)/r.px; v_red := LEAST(v_want, v_units);
      IF v_want > v_units THEN v_cap := v_cap + 1; END IF;
      IF v_units > 0 THEN v_inv := GREATEST(0, v_inv * (1 - (v_red/v_units))); END IF;
      v_units := v_units - v_red;
    END IF;
  END LOOP;
  IF v_sub IS NOT NULL THEN INSERT INTO _a04_walk VALUES (v_sub, v_units, v_inv, v_cap); END IF;
END $w$;

\echo '======== WALK vs LIVE — aggregate'
SELECT count(*) AS members_compared,
       count(*) FILTER (WHERE abs(b.units - w.units) > 0.000001) AS unit_mismatches,
       count(*) FILTER (WHERE abs((b.units - w.units) * public.latest_nav()) > 1) AS unit_mismatch_gt_1UGX,
       round(max(abs((b.units - w.units) * public.latest_nav())),4) AS max_abs_delta_UGX,
       round(sum((b.units - w.units) * public.latest_nav()),2) AS net_delta_UGX
  FROM public.subscriber_balances b JOIN _a04_walk w USING (subscriber_id);

\echo '======== the mismatching members (>1 UGX)'
SELECT b.subscriber_id, round(b.units,8) AS live_units, round(w.units,8) AS walk_units,
       round((b.units - w.units) * public.latest_nav(), 2) AS delta_UGX, w.capped
  FROM public.subscriber_balances b JOIN _a04_walk w USING (subscriber_id)
 WHERE abs((b.units - w.units) * public.latest_nav()) > 1
 ORDER BY abs(b.units - w.units) DESC LIMIT 40;

\echo '======== members with no ledger row at all'
SELECT count(*) AS balances_without_ledger FROM public.subscriber_balances b
 WHERE NOT EXISTS (SELECT 1 FROM _a04_walk w WHERE w.subscriber_id=b.subscriber_id);

\echo '======== seeded-units check: does any live row still sit at units == total/1000 (the seed identity)?'
SELECT count(*) AS rows_at_seed_price FROM public.subscriber_balances
 WHERE units > 0 AND abs(units - total_balance/1000.0) < 0.005;
ROLLBACK;
\echo '======== POST-ROLLBACK: temp table gone, live untouched'
SELECT count(*) AS bal_rows, sum(total_balance) AS aum FROM subscriber_balances;
