
  SELECT COALESCE(
    (SELECT n.unit_price FROM public.nav_snapshots n
      WHERE n.fund_code = p_fund AND n.status = 'published' AND n.nav_date <= p_date
      ORDER BY n.nav_date DESC LIMIT 1),
    (SELECT n.unit_price FROM public.nav_snapshots n
      WHERE n.fund_code = p_fund AND n.status = 'published'
      ORDER BY n.nav_date ASC LIMIT 1),
    1000
  );

