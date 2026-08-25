-- 0130_rls_policy_consolidation.sql
-- A21-005 — collapse the six permissive SELECT policies on `public.subscribers`
--           into one `app_role`-branching policy.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  AUTHORED AND VERIFIED, BUT **RECOMMENDED NOT TO BE APPLIED**.           ║
-- ║  Adjudication: EXCLUDE (upheld). The reasoning is below in full, with    ║
-- ║  the live measurements that produced it. Do not apply this file without  ║
-- ║  a deliberate decision to overrule that adjudication.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- This file exists because the remediation programme asked for A21-005 to be
-- authored, verified against live, and RE-ADJUDICATED rather than inherited.
-- All three were done. It is complete, reversible, and provably equivalent —
-- and it should still stay on the shelf. Here is the whole case, both ways.
--
-- ═══ WHAT A21-005 CLAIMS ═══════════════════════════════════════════════════
-- "subscribers SELECT = 6 permissive policies (_select_admin/_agent/_branch/
--  _distributor/_employer/_self) OR-evaluated per row, EACH READING auth.jwt().
--  EXPLAIN ANALYZE of the 5000-row list join executed in ~297ms; this per-row
--  RLS work is part of that cost."
--
-- ═══ THE CENTRAL CLAIM IS NO LONGER TRUE ═══════════════════════════════════
-- "each reading auth.jwt()" per row was fixed years of migrations ago. Every
-- one of the six policies already wraps the call as `(SELECT auth.jwt())`,
-- which the planner hoists into an InitPlan. Measured on live
-- (ilkhfnoyxlxwqadebnkp, 2026-08-25), the distributor's full-table read plans as:
--
--   Seq Scan on subscribers (actual rows=4602)
--     Filter: (… OR … OR … OR … OR … OR …)
--     InitPlan 1  -> Result (actual rows=1 loops=1)      ← ONCE, not per row
--     InitPlan 2  -> Result (never executed)
--     InitPlan 4  -> Result (never executed)
--     …
--
-- `loops=1` on the ones that run, `never executed` on the rest. There is no
-- per-row `auth.jwt()` call to remove, because 0008 (InitPlan wrap) and 0023
-- (initplan fixes) already removed it. What remains per row is six cheap
-- boolean comparisons against an already-computed value.
--
-- The ~297ms figure is also not RLS. Re-measured warm on the same live data,
-- the 5,000-row list join runs in 34ms (admin) / 45ms (distributor); the 297ms
-- was a cold first execution.
--
-- ═══ WHAT CONSOLIDATION ACTUALLY BUYS (measured, live, warm, repeated) ═════
--
--   query                              6 policies   1 policy    delta
--   ---------------------------------  ----------  ----------  --------
--   admin  SELECT * (5,059 rows)          5.1 ms      2.5 ms    −51 %
--   distr. SELECT * (4,602 rows)          8.7 ms      7.7 ms    −12 %
--   admin  list JOIN balances            34.2 ms     23.6 ms    −31 %
--   distr. list JOIN balances            44.6 ms     38.3 ms    −14 %
--   planning time (all cases)            10.6 ms      8.6 ms    −19 %
--
-- The wins are real and reproducible. One is structural and worth naming: the
-- six-policy form gives the planner a row estimate of 50 for a query returning
-- 4,602–5,059 rows — a 92× under-estimate that picks a Nested Loop for the
-- join. The CASE form estimates 2,530, which is still wrong but wrong by 2×
-- instead of 92×, and that is where most of the join saving comes from.
--
-- ═══ WHY IT IS STILL "NO" ══════════════════════════════════════════════════
--
-- 1. THE PRIZE IS 6–11 MILLISECONDS, AND IT IS INVISIBLE. This platform is a
--    sales demo run over Ugandan mobile connections against a Singapore
--    database. Measured round-trip latency from the developer machine to that
--    database is ~93 ms *per statement*. Shaving 10 ms off a 45 ms query that
--    sits behind a 93 ms network hop and a React render is not something any
--    human being will ever perceive. A21-005 is severity `info`,
--    `demo_visible: false`, for exactly this reason.
--
-- 2. THE RISK IS NOT SYMMETRIC WITH THE PRIZE. This is a tenancy change wearing
--    a performance costume. The six policies are the boundary that stops a
--    distributor reading another distributor's members, an employer reading
--    another employer's staff, and a subscriber reading anyone at all — in a
--    system holding Ugandan pension savings and national ID numbers. The upside
--    of this change is 10 ms. The downside of getting one CASE branch subtly
--    wrong is a cross-tenant disclosure of member PII. Trading a catastrophic
--    tail risk for an imperceptible median gain is a bad trade even when — as
--    here — the transcription is verified correct.
--
-- 3. IT WOULD LEAVE TWO RLS IDIOMS SIDE BY SIDE. The advisor reports 90
--    `multiple_permissive_policies` warnings across 18 tables. This file
--    consolidates ONE. Afterwards the codebase has `subscribers` written as a
--    single CASE and seventeen other tables written as per-role policies, and
--    anyone reading the RLS matrix has to hold both shapes in their head. The
--    six-policy-per-table shape is the house convention across 0003, 0007,
--    0008, 0043, 0049 and 0081 — six migrations that each own exactly one role's
--    policy. Under that convention, changing one role's scope is a small,
--    reviewable diff touching one policy. Under a consolidated CASE, the same
--    change rewrites the expression that gates ALL SIX roles. That is a larger
--    blast radius on every future edit, forever, in exchange for a one-off 10 ms.
--
-- 4. THE FINDING'S OWN IMPACT FIELD SAYS SO. "Deliberate 6-roles-one-table
--    design, not a bug." The audit author who filed it did not think it was
--    broken; they thought it could be faster. They were right, and it is not
--    worth it.
--
-- 5. PHASE 3 JUST FINISHED REPAIRING THIS SURFACE. 0118 rebuilt the RLS write
--    surface and 0128 closed a privilege-escalation hole. Re-cutting the read
--    surface immediately afterwards, for a performance reason that measurement
--    shows is already mostly fixed, spends the review budget in the wrong place.
--
-- ═══ THE VERIFICATION THAT WOULD HAVE BEEN REQUIRED, DONE ANYWAY ═══════════
-- Run inside a rolled-back transaction against live on 2026-08-25. For each
-- identity, the visible row COUNT and an md5 fingerprint of the full sorted id
-- set were captured before the change and after it, in the same transaction.
-- The fingerprint is the real test: two different row sets can share a count.
--
--   identity                       before   after   same rows?   verdict
--   -----------------------------  ------   -----   ----------   ---------
--   admin                            5059    5059       yes      identical
--   agent a-001                        11      11       yes      identical
--   agent a-042                         3       3       yes      identical
--   branch b-kam-015                   31      31       yes      identical
--   branch b-mba-290                   11      11       yes      identical
--   distributor d-001                4602    4602       yes      identical
--   distributor d-002                 399     399       yes      identical
--   employer emp-001                   21      21       yes      identical
--   employer emp-002                    7       7       yes      identical
--   subscriber s-100117                 1       1       yes      identical
--   no claims at all                    0       0       yes      identical
--   unknown role ("wizard")             0       0       yes      identical
--   agent with no agentId claim         0       0       yes      identical
--
-- No role gained visibility. The three negative cases matter as much as the ten
-- positive ones: a JWT with no `app_role`, an unrecognised `app_role`, and a
-- valid role missing its scoping claim all still see zero rows. In the CASE
-- form that is the `ELSE false` arm plus SQL NULL semantics (`CASE NULL WHEN
-- 'admin'` falls through to ELSE); in the OR form it was six NULL comparisons
-- OR-ing to NULL, which RLS treats as not-true. Same outcome, reached
-- differently — which is exactly the kind of divergence that had to be measured
-- rather than reasoned about.
--
-- ═══ IF THIS IS EVER APPLIED ═══════════════════════════════════════════════
-- Re-run the probe above first; it is cheap and it is the only thing standing
-- between a transcription slip and a cross-tenant leak. Then consider whether
-- the other 17 tables should follow in the same change, so the codebase ends up
-- with one idiom rather than two.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS subscribers_select_admin       ON public.subscribers;
DROP POLICY IF EXISTS subscribers_select_agent       ON public.subscribers;
DROP POLICY IF EXISTS subscribers_select_branch      ON public.subscribers;
DROP POLICY IF EXISTS subscribers_select_distributor ON public.subscribers;
DROP POLICY IF EXISTS subscribers_select_employer    ON public.subscribers;
DROP POLICY IF EXISTS subscribers_select_self        ON public.subscribers;

-- One policy, six mutually exclusive branches, `ELSE false` as the default deny.
--
-- The branches are transcribed from the live `pg_policies.qual` of the six
-- policies above, not retyped from the migrations that created them — the live
-- text is what actually gates reads today. `(SELECT auth.jwt())` is kept in the
-- original wrapped form so each claim lookup stays an InitPlan.
--
-- `ELSE false` is load-bearing and must never become `ELSE true` or be dropped:
-- it is what denies a JWT carrying an unrecognised or absent `app_role`.
CREATE POLICY subscribers_select ON public.subscribers
  FOR SELECT
  USING (
    CASE ((SELECT auth.jwt()) ->> 'app_role')
      WHEN 'admin'       THEN true
      WHEN 'agent'       THEN agent_id = ((SELECT auth.jwt()) ->> 'agentId')
      WHEN 'branch'      THEN EXISTS (
                               SELECT 1 FROM public.agents a
                                WHERE a.id = subscribers.agent_id
                                  AND a.branch_id = ((SELECT auth.jwt()) ->> 'branchId'))
      WHEN 'distributor' THEN agent_id IN (SELECT public.distributor_agent_ids())
      WHEN 'employer'    THEN employer_id = ((SELECT auth.jwt()) ->> 'employerId')
      WHEN 'subscriber'  THEN id = ((SELECT auth.jwt()) ->> 'subscriberId')
      ELSE false
    END
  );

COMMIT;
