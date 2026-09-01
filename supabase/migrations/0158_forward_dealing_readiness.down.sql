-- DOWN for 0158_forward_dealing_readiness.sql
-- ============================================================================
-- Drops the pre-flight report. Nothing depends on it; the only cost is that
-- deciding whether it is safe to flip the switch goes back to being something
-- an operator has to remember rather than something they can ask.
-- ============================================================================
DROP FUNCTION IF EXISTS public.forward_dealing_readiness(TEXT);
