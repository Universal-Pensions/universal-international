> **Agent guide.** Historical validation from 2026-05-22, covering the frontend metric-layer retire, lazy-mount, and cursor-pagination changes from PR-2/PR-3/PR-4 — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# PR-2 + PR-3 + PR-4 — frontend validation report

**Date:** 2026-05-22 19:30 local · **Phase:** Phase 2 + Phase 3
**Scope:** Frontend metric layer retire + lazy-mount + cursor pagination.

## Applied changes

| Change | File(s) | Status |
|---|---|---|
| Remove `useDistributorMetrics` from MetricsRow + OverlayPanel | `src/dashboard/cards/MetricsRow.jsx`, `src/dashboard/overlay/OverlayPanel.jsx` | ✅ |
| Delete `useDistributorMetrics` hook | `src/hooks/useEntity.js` | ✅ |
| Delete `getDistributorMetrics` service | `src/services/entities.js` | ✅ |
| Sidebar count fix — use `useEntityMetrics('country','ug')` for totalBranches/Agents/Subscribers | `src/dashboard/sidebar/Sidebar.jsx` | ✅ |
| Lazy-mount 7 panels in `DashboardShell` | `src/dashboard/DashboardShell.jsx` | ✅ |
| New `getEntityPage(level, opts)` server-side filter+sort+page | `src/services/entities.js` | ✅ |
| Extended `mapSubscriber` to include `totalContributions/totalWithdrawals/totalBalance` from embedded JOIN | `src/services/entities.js` | ✅ |
| New `useInfiniteEntityList` hook | `src/hooks/useEntity.js` | ✅ |
| ViewSubscribers refactor — server-side filter+sort+pagination via virtualizer onEndReached | `src/dashboard/subscriber/ViewSubscribers.jsx` | ✅ |
| QueryClient `staleTime: 5*60*1000` already present | `src/main.jsx:12` | ✅ pre-existing per ADR-003 option C |

## Side effects

- `useAllEntities('subscriber')` is no longer called by ViewSubscribers; other callers (UgandaMap, ViewBranches, etc.) still use it. Subscriber list is no longer pre-fetched for the home view at all.
- The summary strip totals (active / total contributions / total balance) now show **network-wide** values from the country-level rollup, not filter-aware. A search for "John" filters the list but keeps the summary at network totals. Trade-off documented in code comment.
- Search debounce extended 150ms → 300ms to absorb network round-trip.
- Server-side sort uses `SUBSCRIBER_SORT_ORDER` mapping in `entities.js`. Balance + Contributions sort via embedded `subscriber_balances` resource (PostgREST `foreignTable` option).

## Acceptance criteria

| Criterion | Status |
|---|---|
| `useDistributorMetrics` retired (zero callers) | ✅ confirmed via grep |
| Sidebar counts come from rollup RPC (not 30-page fetch) | ✅ |
| 7 panels in DashboardShell wrapped in `{open && <Panel />}` | ✅ |
| Distributor home first-paint Supabase requests ≤ 8 (was 24) | ⏳ Phase 7 to measure |
| `npm run lint` clean | ✅ 0 errors, 8 warnings (3 in worktrees + 4 TanStack Virtual + 1 stale eslint-disable; identical to pre-Phase-2 baseline) |
| `npm run build` clean | ✅ 2.65s |
| `e2e/specs/flows/distributor-renders-data.spec.ts` test 2 passes | ⏳ Run in progress |
| ViewSubscribers shows "Showing X of Y subscribers" within 5 s | ⏳ |

## Bundle delta (informational; before/after with no PR-7 yet)

- `DashboardShell.jsx`: 125 KB / 30 KB gzip (unchanged in chunk size — lazy mount defers data-hook firing, not chunk download)
- `Settings` chunk (containing CommissionPanel + ViewBranches/Agents/Subscribers/Reports/Settings): 121 KB / 29 KB gzip (unchanged — these are still statically imported in DashboardShell.jsx so they live in the same chunk)

**True bundle size reduction comes in PR-7** (postgrest-js swap + Leaflet code-split).

## Rollback recipe

If the panel doesn't open cleanly:
1. `git revert <PR-3-merge-sha>` → restores ViewSubscribers full-fetch + DashboardShell eager-mount.

If the cursor pagination misbehaves:
1. `git revert <ViewSubscribers-refactor-sha>` → restores in-memory filter/sort over `useAllEntities('subscriber')`.

If `useDistributorMetrics` callers were missed:
1. `git revert` the entire PR-2 commit → restores the hook + service function.

## Next

→ Phase 4 (PR-5) — nominees RPC for the sum-to-100 invariant + direct-mutation security fix.
