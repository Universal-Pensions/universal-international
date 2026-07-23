> **Agent guide.** Historical report from 2026-05-22, covering the audit-remediation follow-up backlog of items deferred out of the sprint — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Deferred items — audit remediation follow-up backlog

**Date:** 2026-05-22 · **Sprint:** Phase 7 close-out
**Purpose:** Ticket-shaped entries for every audit item that was NOT closed in the sprint. Each item names a recommended next action + blocker + originating finding ID.

---

## P0 / P1 items still open after the sprint

### PR-4b — ViewSubscribers cursor pagination

| Field | Value |
|---|---|
| Closes | AUDIT-1-7, AUDIT-2-1, AUDIT-4-2 (xref) |
| Severity | P0 (the user-visible "Showing X of Y" stall in distributor → Subscribers panel) |
| Why deferred | Infrastructure (`getEntityPage`, `useInfiniteEntityList`) landed but consumer wiring failed e2e silently — `useInfiniteQuery` returned empty `data` despite the same query working via curl. Root cause not isolated in time-box. |
| Mitigation today | Phase 2's lazy-mount removes the 30-page fetch from the distributor home cold load. ViewSubscribers still pulls 30 pages but only when user clicks the panel. |
| Recommended next action | Author server-side RPC `get_subscriber_page(p_search, p_status, p_sort, p_offset, p_limit) RETURNS jsonb` that bypasses PostgREST embedded-resource quirks. Then rewire ViewSubscribers to call `useInfiniteEntityList('subscriber', ...)` against the RPC. |
| Blocker | Bandwidth (~3-4h focused dev) |
| Owner | Engineering lead |

### PR-6b — Full RLS-policy flatten

| Field | Value |
|---|---|
| Closes | AUDIT-2-5 (55 `multiple_permissive_policies` warnings across 11 tables) |
| Severity | P1 |
| Why deferred | Each table has 2-4 SELECT policies; flattening into one CASE-based USING clause per table requires per-table semantic-equivalence testing (before/after row counts per role must match exactly). |
| Recommended next action | Per-table migration that DROPs the OR'd policies + CREATEs unified CASE-based equivalent. Use SECURITY DEFINER `RPC` to test row counts per role before merging. |
| Blocker | UX-design buy-in not needed; pure backend; ~30-60min for the migration + 2-3h for the test passes. |
| Owner | Engineering lead |

### PR-7b — Supabase-js → postgrest-js client swap

| Field | Value |
|---|---|
| Closes | AUDIT-3-4 (vendor-BoVtWV09 230 KB gzip of supabase-js transitive baggage) |
| Severity | P1 (bundle bloat; mobile Lighthouse delta) |
| Why deferred | The Phase 5 scope check (A5.1) confirmed only `.from()`/`.rpc()` are used (40 call sites) — SAFE to swap. But the swap is an 11-file edit + TypeScript validation in `api/_lib/supabase-admin.ts`. Time-budget vote was Leaflet lazy-load first (lower risk, immediate win). |
| Recommended next action | Replace `createClient` in `src/services/supabaseClient.js` with a `new PostgrestClient(url, { headers: { Authorization: ... } })` factory. Preserve the `.from()`/`.rpc()` ergonomics; check every consumer's response shape (postgrest-js returns `{ data, error }` like supabase-js, so most callers shouldn't change). |
| Expected saving | ~200 KB gzip across every dashboard route. |
| Owner | Engineering lead |

### `get_entity_metrics_rollup` body rewrite

| Field | Value |
|---|---|
| Closes | AUDIT-1-3 (region/district rollup 360k Memoize evictions + 11 MB disk spill) |
| Severity | P0 (cold rollup at region level still ~3.6 s mean) |
| Why deferred | Phase 1 added the `(type, date)` index, which helps the FILTER predicates inside the rollup but does not eliminate the `monthly_arr_per_entity` CTE pattern. |
| Recommended next action | Rewrite the CTE in `0020_entity_metrics_rollup_v3.sql` (currently 965 LOC) — compute `(subscriber_id, month_idx, sum(amount))` FIRST via the index, then aggregate to entity. Avoid the `subscribers × 12` CROSS JOIN. |
| Owner | Engineering lead |

---

## P1 from prior audit (DASHBOARD_AUDIT_FIXES "Deferred")

These were already deferred BEFORE the remediation sprint; carried forward as-is.

| Item | Closes | Notes |
|---|---|---|
| Extract `<EntityListPanel>` | DASHBOARD_AUDIT.md #60 | Collapses ViewBranches (1035L) + ViewAgents (639L) into one configurable panel |
| Extract `<ChatThread>` | DASHBOARD_AUDIT.md #57 | Consolidate 5 chat surfaces (CoPilot, BranchHealthScore copilot, MetricsRow ChatCard, AgentPage, HelpPage) |
| Extract `<RoleSidebar>` | DASHBOARD_AUDIT.md #71 | Consolidate 3 sidebars (distributor, branch, subscriber) |
| Decompose `BranchHealthScore.jsx` (522 LOC) | DASHBOARD_AUDIT.md #39 | Into `useBranchHealth()` + `<ScoreGauge>` + `<HealthAlerts>` + `<HealthCopilot>` |
| Multi-step flow shell | DASHBOARD_AUDIT.md #22 | Shared for Save/Withdraw/Claim |
| Real "Recent Activity" feed | DASHBOARD_AUDIT.md #32 | Once event log exists |
| Map legend on UgandaMap | DASHBOARD_AUDIT.md #58 | Region colour-coding key |
| Telemetry / analytics events | DASHBOARD_AUDIT.md "Cross-cutting" | Vendor selection + privacy review |
| Subscriber `Settings` reuse vs Branch admin | DASHBOARD_AUDIT.md #75 | Currently shared; should split |

---

## P2 / P3 items

### Branch admin own-branch edit

| Field | Value |
|---|---|
| Closes | AUDIT-4-4 |
| Why deferred | Needs UX design pass (form layout / placement: separate tab vs reuse Edit Branch flow) |
| Recommended next action | UX review meeting; one engineering ticket downstream |

### StubPage routes for Settings/notifications + Settings/security

| Field | Value |
|---|---|
| Closes | AUDIT-4-5 |
| Why deferred | Product call — should these features be removed entirely (no route, no badge) or built? |
| Recommended next action | Product roadmap meeting |

### Test-fixture NIN uniqueness (AUDIT-4-7b)

| Field | Value |
|---|---|
| Closes | The follow-on AML investigation that found the spec was broken-on-rerun (NIN collision) |
| Severity | P3 (test-only) |
| Why deferred | Trivial fix not strictly needed for prod; spec passes on first run after seed reset. |
| Recommended next action | Add unique-NIN generation to `e2e/specs/flows/agent-onboard-subscriber.spec.ts` via `window.__upensions_ocr_force_nin` injection + update `services/kyc.js` OCR mock to honor it. ~30 min. |

### Materialized view for rollups (ADR-001 option B)

| Field | Value |
|---|---|
| Severity | none — speculative |
| Trigger | Subscriber count > 1M (currently 30K — option A is fine) |
| Recommended next action | Revisit ADR-001 at that scale milestone |

### Custom `useReadQuery` tier hook (ADR-003 option B)

| Field | Value |
|---|---|
| Severity | P3 polish |
| Why deferred | Option C (global staleTime + per-key overrides) suffices today |
| Recommended next action | Implement if tech-debt sprint capacity allows |

### Realtime feature consumer (ADR-002 option B)

| Field | Value |
|---|---|
| Severity | none — product feature, not perf bug |
| Trigger | Admin role build with "live settlement run" dashboard |
| Recommended next action | When admin role enters scope; one migration reverses publication drop |

### README.md refresh

| Field | Value |
|---|---|
| Closes | AUDIT-5-8 |
| Severity | P3 docs |
| Why deferred | ~30 min focused work; out of audit scope |
| Recommended next action | Rewrite README to cover: Vite 6 (not 8), all 4 dashboards, env vars (6 keys), project structure including `dashboard/`, `services/`, `hooks/`, `api/`, `supabase/`, `e2e/` |

### CLAUDE.md §3 lint baseline accuracy

| Field | Value |
|---|---|
| Done | ✅ — `CLAUDE.md` now reflects "0 errors, 1 warning" |
| Severity | P3 |
| Notes | Phase 6 (PR-10) cleaned up the duplicate worktree warnings + the stale eslint-disable. Baseline matches reality now. |

---

## Sprint-2 priority order recommendation

For a follow-up sprint:

1. **PR-4b** — ViewSubscribers cursor pagination via new RPC. User-visible (closes the "Showing 0 of 0" e2e failure).
2. **PR-6b** — Full RLS flatten. Backend perf compounding win across all reads.
3. **PR-7b** — Postgrest-js client swap. Bundle / Lighthouse win.
4. **get_entity_metrics_rollup CTE rewrite** — Region/district drill latency.
5. README refresh.
6. AML test fixture fix.
7. Deferred component extractions (EntityListPanel etc.) — capacity permitting.

---

## Files referenced

- `docs/audit/REMEDIATION-REPORT.md` — main close-out report
- `docs/audit/REPORT.md` — original audit synthesis (58 findings)
- `docs/audit/PR-1-validation.md`, `PR-2-3-4-validation.md`, `PR-4-deferred.md` — per-phase artifacts
- `docs/audit/rollback-playbook.md` — recovery procedures
- `docs/audit/before-snapshot.md` — Phase 0 baseline (vs eventual Phase 7 re-snapshot when scheduled)
