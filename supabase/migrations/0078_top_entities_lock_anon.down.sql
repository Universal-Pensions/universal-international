-- Down migration for 0078_top_entities_lock_anon.sql
-- Restores the pre-0078 (0077) grant surface. The in-body app_role gate still
-- rejects anon, so this only re-widens EXECUTE to match 0077's original idiom.
GRANT EXECUTE ON FUNCTION public.get_top_entities(TEXT, TEXT, INT) TO anon;
