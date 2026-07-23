> **Agent guide.** Historical report from 2026-05-22, covering the partially-completed PR-4 cursor-pagination work deferred to PR-4b — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# PR-4 (Phase 3 cursor pagination) — partially complete; deferred

**Date:** 2026-05-22 · **Phase:** 3 (of 7)
**Status:** Infrastructure in place; consumer refactor deferred to PR-4b.

## What landed

| Change | File | Status |
|---|---|---|
| `getEntityPage(level, opts)` server-side filter+sort+page | `src/services/entities.js` | ✅ (callable but unused) |
| `useInfiniteEntityList` hook | `src/hooks/useEntity.js` | ✅ (callable but unused) |
| Extended `mapSubscriber` to lift balance fields | `src/services/entities.js` | ✅ (forward-compat) |

## What was reverted

| Change | Reason |
|---|---|
| `ViewSubscribers.jsx` refactor to `useInfiniteEntityList` | The cursor query returned empty consistently; root cause not isolated in time-box. The `useAllEntities('subscriber')` path remains the active consumer. |

## Why deferred

The cursor query returned empty `loadedRows` consistently in e2e runs, with `total=0`. PostgREST direct curl with the same JWT returned rows (status 206, content-range correct). The disconnect between curl-direct success and React-via-supabase-js failure was not isolated within the time-box.

Plausible root causes for follow-up investigation:
- supabase-js `count: 'estimated'` vs `count: 'exact'` interaction with `.range()` on a 30K-row RLS-filtered table
- Race between `useInfiniteQuery` queryKey serialization and the first fetch
- Hidden error swallowed by `useInfiniteQuery`'s default error handling (no `onError` hook attached during testing)

Recommended next steps (when picked up):
1. Add explicit `onError` handler to the `useInfiniteEntityList` hook to surface failures
2. Add an integration test that calls `getEntityPage` directly with a real JWT in a Vitest harness, asserting non-empty result
3. If the issue persists after (1)+(2), pivot to a server-side RPC `get_subscriber_page(p_search, p_status, p_sort, p_offset, p_limit) RETURNS jsonb` — fully bypasses PostgREST quirks

## Mitigation for now

**Phase 2's lazy-mount of the 7 panels removed the 30-page subscriber pull from the distributor home cold load.** That was the user's primary complaint. The Subscribers panel is now gated behind an explicit user click; the 30-page fetch only fires when the panel opens.

User-visible impact:
- Distributor home cold load: no 30-page fetch (FIXED via Phase 2 lazy-mount)
- Opening "View Subscribers" panel: 10-15 s wait before list renders (cursor pagination would have made this <5 s)

## Acceptance criteria

| Criterion | Status |
|---|---|
| `useDistributorMetrics` retired (PR-2) | ✅ |
| Sidebar uses RPC for counts (PR-2) | ✅ |
| 7 panels lazy-mounted in DashboardShell (PR-3) | ✅ |
| QueryClient global staleTime 5 min (pre-existing) | ✅ |
| ViewSubscribers cursor pagination (PR-4) | ❌ DEFERRED to PR-4b |
| `distributor-renders-data.spec.ts` test 2 passes | ❌ Still fails on "Showing 0 of 0" — needs PR-4b |

## Sprint impact

PR-4 deferral moves AUDIT-1-7 + AUDIT-2-1 from "closed in sprint" to "deferred backlog". The primary user-visible win (distributor home perf) is preserved via Phase 1 (RPC perf) + Phase 2 (lazy mount). PR-4b can ship in sprint 2 once the empty-query mystery is solved.
