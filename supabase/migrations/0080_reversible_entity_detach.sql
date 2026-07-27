-- 0080_reversible_entity_detach.sql
-- Makes admin deactivate/reactivate NON-DESTRUCTIVE and REVERSIBLE.
--
-- ── INCIDENT THIS FIXES ──────────────────────────────────────────────────────
-- On 2026-07-27 06:26:03 UTC a single call to `set_distributor_status('d-001',
-- 'inactive')` nulled `subscribers.agent_id` for the entire national agent tree
-- (5,003 rows). The operator immediately reactivated, which restored
-- `distributors/branches/agents.status` — but 0060's reactivate leg is a pure
-- status flip that never re-tags subscribers, so the linkage loss was permanent
-- in-product. Every metric that reaches subscribers through
-- `subscribers.agent_id = agents.id` (get_entity_metrics_rollup, get_top_entities,
-- get_branch_pending_contributions, the agent dashboard, the distributor map
-- drill-down) collapsed to ~zero below country level, while country-level totals
-- stayed correct — which is why it read as a rendering bug rather than data loss.
-- The links were only recoverable because `commissions`/`transactions` retained
-- their own `agent_id`; a reseed-free repair was possible but manual.
--
-- The same reactivate leg also blanket-set `status='active'` on every branch and
-- agent, silently destroying the seed's 391 inactive agents / 31 inactive
-- branches with no record of what they had been.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
-- 1. Two append-only journals record what a deactivate is about to destroy.
-- 2. `set_distributor_status` / `set_employer_status` write the journal BEFORE
--    detaching, and REPLAY it on reactivate. Deactivate → reactivate is now a
--    round trip.
-- 3. A statement-level trigger aborts any bulk detach that is not journalled,
--    so the incident cannot be reproduced by a stray UPDATE either.
--
-- ⚠️ SEMANTICS CHANGE (deliberate, supersedes 0060's header contract):
--    reactivate now DOES re-tag the subscribers that this distributor/employer
--    detached. `e2e/specs/db/deactivate-entities.spec.ts` is updated in the same
--    commit. Re-onboarding done during the inactive window is never clobbered:
--    the replay only fills rows that are still NULL.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Journals
-- ─────────────────────────────────────────────────────────────────────────────

-- Subscriber linkage cleared by a deactivate (agent_id or employer_id).
CREATE TABLE IF NOT EXISTS public.entity_detach_log (
  id            bigserial   PRIMARY KEY,
  subscriber_id text        NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  link_kind     text        NOT NULL CHECK (link_kind IN ('agent', 'employer')),
  prior_value   text        NOT NULL,   -- the agent_id / employer_id that was cleared
  scope_id      text        NOT NULL,   -- distributor_id / employer_id that triggered it
  detached_at   timestamptz NOT NULL DEFAULT now(),
  restored_at   timestamptz
);

-- Partial index: the replay + the guard only ever read OPEN (unrestored) rows.
CREATE INDEX IF NOT EXISTS entity_detach_log_open_idx
  ON public.entity_detach_log (link_kind, scope_id) WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS entity_detach_log_subscriber_idx
  ON public.entity_detach_log (subscriber_id) WHERE restored_at IS NULL;

-- Prior branch/agent status, so reactivate restores instead of blanket-activating.
CREATE TABLE IF NOT EXISTS public.entity_status_log (
  id           bigserial   PRIMARY KEY,
  entity_kind  text        NOT NULL CHECK (entity_kind IN ('branch', 'agent')),
  entity_id    text        NOT NULL,
  prior_status text        NOT NULL,
  scope_id     text        NOT NULL,   -- distributor_id that triggered the flip
  changed_at   timestamptz NOT NULL DEFAULT now(),
  restored_at  timestamptz
);

CREATE INDEX IF NOT EXISTS entity_status_log_open_idx
  ON public.entity_status_log (scope_id, entity_kind) WHERE restored_at IS NULL;

-- Server-side only. RLS on with zero policies + no grants = unreachable from the
-- client under any role; the SECURITY DEFINER RPCs below run as owner and bypass it.
ALTER TABLE public.entity_detach_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_status_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.entity_detach_log FROM anon, authenticated;
REVOKE ALL ON public.entity_status_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.entity_detach_log_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.entity_status_log_id_seq FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) set_distributor_status — journal on deactivate, replay on reactivate
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_distributor_status(
  p_distributor_id text,
  p_status         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role          text    := (SELECT auth.jwt()) ->> 'app_role';
  v_dist_updated  integer := 0;
  v_branches      integer := 0;
  v_agents        integer := 0;
  v_subs_detached integer := 0;
  v_subs_restored integer := 0;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot set distributor status', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.distributors SET status = p_status, updated_at = now() WHERE id = p_distributor_id;
  GET DIAGNOSTICS v_dist_updated = ROW_COUNT;
  IF v_dist_updated = 0 THEN
    RAISE EXCEPTION 'no distributor %', p_distributor_id USING ERRCODE = 'P0001';
  END IF;

  IF p_status = 'inactive' THEN
    -- Journal BEFORE mutating. Ordering matters twice over: the guard trigger in
    -- §4 requires the journal rows to already exist, and once agent_id is NULL
    -- the linkage is no longer derivable from `subscribers` alone.
    INSERT INTO public.entity_status_log (entity_kind, entity_id, prior_status, scope_id)
    SELECT 'branch', b.id, b.status, p_distributor_id
      FROM public.branches b
     WHERE b.distributor_id = p_distributor_id;

    INSERT INTO public.entity_status_log (entity_kind, entity_id, prior_status, scope_id)
    SELECT 'agent', a.id, a.status, p_distributor_id
      FROM public.agents a
      JOIN public.branches b ON b.id = a.branch_id
     WHERE b.distributor_id = p_distributor_id;

    INSERT INTO public.entity_detach_log (subscriber_id, link_kind, prior_value, scope_id)
    SELECT s.id, 'agent', s.agent_id, p_distributor_id
      FROM public.subscribers s
      JOIN public.agents a   ON a.id = s.agent_id
      JOIN public.branches b ON b.id = a.branch_id
     WHERE b.distributor_id = p_distributor_id;

    UPDATE public.branches SET status = 'inactive' WHERE distributor_id = p_distributor_id;
    GET DIAGNOSTICS v_branches = ROW_COUNT;

    UPDATE public.agents SET status = 'inactive'
     WHERE branch_id IN (SELECT id FROM public.branches WHERE distributor_id = p_distributor_id);
    GET DIAGNOSTICS v_agents = ROW_COUNT;

    UPDATE public.subscribers
       SET agent_id = NULL
     WHERE agent_id IN (
       SELECT a.id FROM public.agents a
         JOIN public.branches b ON b.id = a.branch_id
        WHERE b.distributor_id = p_distributor_id
     );
    GET DIAGNOSTICS v_subs_detached = ROW_COUNT;

  ELSE
    -- Reactivate: restore each branch/agent to the status it actually had.
    -- Entities with no open journal row (created during the inactive window, or
    -- a distributor that was never deactivated through this RPC) fall back to
    -- 'active', preserving 0060's behaviour for them.
    UPDATE public.branches b
       SET status = COALESCE(j.prior_status, 'active')
      FROM public.branches src
      LEFT JOIN LATERAL (
        SELECT l.prior_status
          FROM public.entity_status_log l
         WHERE l.scope_id = p_distributor_id AND l.entity_kind = 'branch'
           AND l.entity_id = src.id AND l.restored_at IS NULL
         ORDER BY l.id DESC LIMIT 1
      ) j ON true
     WHERE b.id = src.id AND src.distributor_id = p_distributor_id;
    GET DIAGNOSTICS v_branches = ROW_COUNT;

    UPDATE public.agents a
       SET status = COALESCE(j.prior_status, 'active')
      FROM public.agents src
      JOIN public.branches b ON b.id = src.branch_id
      LEFT JOIN LATERAL (
        SELECT l.prior_status
          FROM public.entity_status_log l
         WHERE l.scope_id = p_distributor_id AND l.entity_kind = 'agent'
           AND l.entity_id = src.id AND l.restored_at IS NULL
         ORDER BY l.id DESC LIMIT 1
      ) j ON true
     WHERE a.id = src.id AND b.distributor_id = p_distributor_id;
    GET DIAGNOSTICS v_agents = ROW_COUNT;

    -- Replay the detached links. `s.agent_id IS NULL` guarantees we never
    -- clobber a re-onboarding that happened while the distributor was inactive.
    UPDATE public.subscribers s
       SET agent_id = j.prior_value
      FROM (
        SELECT DISTINCT ON (subscriber_id) subscriber_id, prior_value
          FROM public.entity_detach_log
         WHERE scope_id = p_distributor_id AND link_kind = 'agent' AND restored_at IS NULL
         ORDER BY subscriber_id, id DESC
      ) j
     WHERE s.id = j.subscriber_id AND s.agent_id IS NULL;
    GET DIAGNOSTICS v_subs_restored = ROW_COUNT;

    UPDATE public.entity_detach_log SET restored_at = now()
     WHERE scope_id = p_distributor_id AND link_kind = 'agent' AND restored_at IS NULL;
    UPDATE public.entity_status_log SET restored_at = now()
     WHERE scope_id = p_distributor_id AND restored_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'id',                  p_distributor_id,
    'status',              p_status,
    'branchesUpdated',     v_branches,
    'agentsUpdated',       v_agents,
    'subscribersDetached', v_subs_detached,
    'subscribersRestored', v_subs_restored
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_distributor_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_distributor_status(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) set_employer_status — same journal/replay contract
--    Worse than the distributor case if lost: `commissions`/`transactions` carry
--    agent_id but NOT employer_id, so a detached employer membership is only
--    ~1/3 reconstructible. The journal is the only reliable record.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_employer_status(
  p_employer_id text,
  p_status      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role          text    := (SELECT auth.jwt()) ->> 'app_role';
  v_emp_updated   integer := 0;
  v_members       integer := 0;
  v_members_back  integer := 0;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'role % cannot set employer status', v_role USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE = 'P0001';
  END IF;

  -- The status flip must land FIRST on the reactivate path: 0061's
  -- `trg_block_inactive_employer_subscriber_update` rejects any write that sets
  -- employer_id to a still-inactive employer, which would abort the replay.
  UPDATE public.employers SET status = p_status, updated_at = now() WHERE id = p_employer_id;
  GET DIAGNOSTICS v_emp_updated = ROW_COUNT;
  IF v_emp_updated = 0 THEN
    RAISE EXCEPTION 'no employer %', p_employer_id USING ERRCODE = 'P0001';
  END IF;

  IF p_status = 'inactive' THEN
    INSERT INTO public.entity_detach_log (subscriber_id, link_kind, prior_value, scope_id)
    SELECT s.id, 'employer', s.employer_id, p_employer_id
      FROM public.subscribers s
     WHERE s.employer_id = p_employer_id;

    UPDATE public.subscribers SET employer_id = NULL WHERE employer_id = p_employer_id;
    GET DIAGNOSTICS v_members = ROW_COUNT;

  ELSE
    UPDATE public.subscribers s
       SET employer_id = j.prior_value
      FROM (
        SELECT DISTINCT ON (subscriber_id) subscriber_id, prior_value
          FROM public.entity_detach_log
         WHERE scope_id = p_employer_id AND link_kind = 'employer' AND restored_at IS NULL
         ORDER BY subscriber_id, id DESC
      ) j
     WHERE s.id = j.subscriber_id AND s.employer_id IS NULL;
    GET DIAGNOSTICS v_members_back = ROW_COUNT;

    UPDATE public.entity_detach_log SET restored_at = now()
     WHERE scope_id = p_employer_id AND link_kind = 'employer' AND restored_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'id',              p_employer_id,
    'status',          p_status,
    'membersDetached', v_members,
    'membersRestored', v_members_back
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_employer_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employer_status(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Trip-wire: no unjournalled bulk detach, from ANY code path
--    Statement-level so it costs one aggregate per UPDATE statement, not per row.
--    Single-row edits (the ordinary case: an agent re-assignment, a profile save)
--    stay untouched — only mass clearing is gated.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_mass_subscriber_detach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_threshold  constant integer := 50;
  v_agent_det  integer;
  v_agent_jrn  integer;
  v_emp_det    integer;
  v_emp_jrn    integer;
BEGIN
  SELECT count(*) INTO v_agent_det
    FROM new_rows n JOIN old_rows o ON o.id = n.id
   WHERE o.agent_id IS NOT NULL AND n.agent_id IS NULL;

  IF v_agent_det > v_threshold THEN
    SELECT count(*) INTO v_agent_jrn
      FROM public.entity_detach_log j
      JOIN new_rows n ON n.id = j.subscriber_id
     WHERE j.link_kind = 'agent' AND j.restored_at IS NULL
       AND j.detached_at > now() - interval '1 minute';
    IF v_agent_jrn < v_agent_det THEN
      RAISE EXCEPTION
        'mass agent detach blocked: % of % rows unjournalled — use set_distributor_status()',
        v_agent_det - v_agent_jrn, v_agent_det
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT count(*) INTO v_emp_det
    FROM new_rows n JOIN old_rows o ON o.id = n.id
   WHERE o.employer_id IS NOT NULL AND n.employer_id IS NULL;

  IF v_emp_det > v_threshold THEN
    SELECT count(*) INTO v_emp_jrn
      FROM public.entity_detach_log j
      JOIN new_rows n ON n.id = j.subscriber_id
     WHERE j.link_kind = 'employer' AND j.restored_at IS NULL
       AND j.detached_at > now() - interval '1 minute';
    IF v_emp_jrn < v_emp_det THEN
      RAISE EXCEPTION
        'mass employer detach blocked: % of % rows unjournalled — use set_employer_status()',
        v_emp_det - v_emp_jrn, v_emp_det
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NULL;  -- AFTER STATEMENT trigger: return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS subscribers_guard_mass_detach ON public.subscribers;
CREATE TRIGGER subscribers_guard_mass_detach
AFTER UPDATE ON public.subscribers
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_mass_subscriber_detach();

-- NOTE: `scripts/seed-supabase.mjs` runs under `session_replication_role =
-- replica`, so this trigger is inert during a reseed (as are 0060/0061's).
-- `TRUNCATE ... CASCADE` in that script also clears both journals, which is the
-- correct behaviour — a reseed has no prior state worth replaying.
