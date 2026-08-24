BEGIN;
CREATE TEMP TABLE _w (subscriber_id TEXT PRIMARY KEY, units NUMERIC, invested NUMERIC) ON COMMIT DROP;
DO $w$
DECLARE r RECORD; v_sub TEXT:=NULL; v_units NUMERIC:=0; v_inv NUMERIC:=0; v_want NUMERIC; v_red NUMERIC;
BEGIN
  FOR r IN SELECT t.subscriber_id, t.amount, public.nav_for_date(t.date::date) AS px FROM public.transactions t
            WHERE t.type IN ('contribution','withdrawal','premium_sweep','claim') AND t.subscriber_id IN ('s-0005','s-0001','s-0004')
            ORDER BY t.subscriber_id, t.date, t.id LOOP
    IF v_sub IS DISTINCT FROM r.subscriber_id THEN
      IF v_sub IS NOT NULL THEN INSERT INTO _w VALUES (v_sub, v_units, v_inv); END IF;
      v_sub := r.subscriber_id; v_units := 0; v_inv := 0;
    END IF;
    IF r.amount >= 0 THEN v_units := v_units + (r.amount/r.px); v_inv := v_inv + r.amount;
    ELSE v_want := (-r.amount)/r.px; v_red := LEAST(v_want, v_units);
      IF v_units > 0 THEN v_inv := GREATEST(0, v_inv*(1-(v_red/v_units))); END IF;
      v_units := v_units - v_red; END IF;
  END LOOP;
  IF v_sub IS NOT NULL THEN INSERT INTO _w VALUES (v_sub, v_units, v_inv); END IF;
END $w$;
SELECT b.subscriber_id, round(b.units,12) AS live_units, round(w.units,12) AS walk_units,
       round(b.units-w.units,12) AS unit_delta,
       round(b.retirement_units,6) ru, round(b.emergency_units,12) eu,
       round(b.retirement_units+b.emergency_units-b.units,12) AS bucket_unit_gap,
       b.total_balance, b.retirement_balance, b.emergency_balance,
       round(b.units*public.latest_nav(),4) AS units_x_nav
  FROM subscriber_balances b JOIN _w w USING (subscriber_id) ORDER BY 1;
ROLLBACK;
