-- 0083_repair_search_entities_path.down.sql
-- ⚠️ This RE-BREAKS global search. Dropping `extensions` from the search_path
-- makes pg_trgm's similarity()/% unresolvable again, so every search_entities
-- call throws 42883 — silently, because the UI swallows the rejection into an
-- empty result set. Only run this to reproduce the original defect.

ALTER FUNCTION public.search_entities(text)
  SET search_path = public, pg_temp;
