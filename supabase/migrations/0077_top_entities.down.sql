-- Down migration for 0077_top_entities.sql
DROP FUNCTION IF EXISTS public.get_top_entities(TEXT, TEXT, INT);
