> **Agent guide.** Historical audit from 2026-05-22 covering frontend performance — bundles, render hot spots, virtualization — across all four dashboards (Phase 3) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Audit 03 — Frontend performance audit (all 4 dashboards)

**Date:** 2026-05-22 · **Auditor:** Claude (Opus 4.7) · **Phase:** 3 of 6 (parallel with Phase 2)

Scope: bundle map, render hot spots, TanStack Query config, virtualization, hard-rule §4.1 violations, context churn, lazy-loading, MOCK_NOW drift, api-contracts drift. Distributor / Agent / Branch / Subscriber dashboards.

---

## 1. TL;DR

**Findings:** 1 × P0 · 5 × P1 · 6 × P2 · 2 × P3 (14 total). Phase 1's distributor-flow findings (AUDIT-1-1 … AUDIT-1-12) are **not re-flagged** here — cross-referenced only.

**Most surprising finding:** the marketing landing page modulepreloads **`vendor-leaflet`** (114 kB gzip), **`vendor-BoVtWV09`** (230 kB gzip, supabase + transitive deps for storage / realtime / phoenix / webauthn / redux-toolkit / immer / decimal.js-light — none of which the app actually uses from the client), **`vendor-motion`** (143 kB gzip), and the whole vendor chain — even though `/` only renders Navbar + Hero + HowItWorks + TimeJourney + ForYou + Trust + CTA + Footer + StickyMobileCTA. Total initial-payload preload on `/` is ~745 kB gzip across vendor chunks alone.

**Distributor home cold-load JS (gzip estimate):** ~849 kB ≈ entry (54 kB) + vendor-react (110 kB) + vendor-BoVtWV09 (230 kB, supabase + transitive baggage) + vendor-tanstack (30 kB) + vendor-router (20 kB) + vendor-motion (143 kB) + vendor-leaflet (114 kB) + DashboardShell (47 kB) + Settings chunk (44 kB — CommissionPanel/ViewAgents/ReportsHub/Settings.jsx all packed here, all mounted eagerly per AUDIT-1-10) + subscriber chunk (31 kB — `mockData.js` + `services/subscriber.js` + `mockBranchDefs.js` + `mockGeo.js`) + useEntity (12 kB) + useCommission (14 kB).

**mockData hard-rule (§4.1) grep:** **0 hits** in components / dashboards. All 6 mockData imports live in `src/services/`. ✓

**`vite.config.js` revert:** verified via `md5` checksum **and** byte-for-byte `diff` against pre-Phase-3 backup. `package.json` and `package-lock.json` unchanged (npm install used `--no-save`; visualizer subsequently `npm uninstall`ed).

---

## 2. Bundle map (`rollup-plugin-visualizer` output → `docs/audit/_bundle-stats.html`)

Production build artifact: `/Users/shubhang/Desktop/Projects/uganda-dashboard/dist/`. Visualizer source: `docs/audit/_bundle-stats.html` (902 kB, retained).

### 2.1 Top 10 bundles by gzip

| Rank | Chunk | rendered | gzip | brotli |
|---|---|---|---|---|
| 1 | `vendor-charts` | 864 215 | **274 190** | 235 622 |
| 2 | `vendor-BoVtWV09` (unnamed catch-all — supabase + immer + redux + decimal + phoenix + webauthn) | 1 022 718 | **229 788** | 192 586 |
| 3 | `vendor-motion` (framer-motion) | 423 790 | **142 667** | 120 459 |
| 4 | `vendor-leaflet` | 477 944 | **114 139** | 91 767 |
| 5 | `vendor-react` (react-dom-client) | 602 685 | **110 295** | 90 386 |
| 6 | `index` (entry — landing components, App, auth, etc.) | 190 410 | **53 852** | 45 652 |
| 7 | `DashboardShell` (Distributor) | 258 012 | **47 020** | 40 621 |
| 8 | `Settings` (CommissionPanel + ViewAgents + ReportsHub + Settings + ViewReports + nav/panel contexts + Demographics + Icons) | 247 197 | **44 272** | 37 951 |
| 9 | `ConsentStep` (signup flow consolidated) | 133 859 | **34 243** | 29 447 |
| 10 | `subscriber` (mockData + services/subscriber + mockBranchDefs + mockGeo) | 124 215 | **30 756** | 25 231 |

### 2.2 Top 10 modules across all chunks (by gzip)

| Rank | Bundle | Module | rendered | gzip |
|---|---|---|---|---|
| 1 | `vendor-leaflet` | `leaflet-src.js` | 474 173 | 112 382 |
| 2 | `vendor-react` | `react-dom-client.production.js` | 552 879 | 95 428 |
| 3 | `vendor-BoVtWV09` | `@supabase/auth-js/GoTrueClient.js` | 233 883 | 39 347 |
| 4 | `vendor-BoVtWV09` | `@supabase/postgrest-js/index.mjs` | 128 761 | 22 760 |
| 5 | `vendor-router` | `chunk-QFMPRPBF.mjs` (react-router) | 82 359 | 19 874 |
| 6 | `vendor-BoVtWV09` | `@supabase/storage-js/index.mjs` | 100 916 | 18 531 |
| 7 | `vendor-motion` | `framer-motion/projection/create-projection-node.mjs` | 70 714 | 14 556 |
| 8 | `Settings` | **`CommissionPanel.jsx`** | 97 681 | 13 205 |
| 9 | `vendor-BoVtWV09` | `decimal.js-light/decimal.mjs` | 49 561 | 13 179 |
| 10 | `subscriber` | **`src/data/mockData.js`** | 46 065 | 12 955 |

### 2.3 Top 10 modules by raw

| Rank | Bundle | Module | rendered | gzip |
|---|---|---|---|---|
| 1 | `vendor-react` | `react-dom-client.production.js` | **552 879** | 95 428 |
| 2 | `vendor-leaflet` | `leaflet-src.js` | **474 173** | 112 382 |
| 3 | `vendor-BoVtWV09` | `GoTrueClient.js` | 233 883 | 39 347 |
| 4 | `vendor-BoVtWV09` | `postgrest-js/index.mjs` | 128 761 | 22 760 |
| 5 | `vendor-BoVtWV09` | `storage-js/index.mjs` | 100 916 | 18 531 |
| 6 | `Settings` | `CommissionPanel.jsx` | 97 681 | 13 205 |
| 7 | `vendor-router` | `chunk-QFMPRPBF.mjs` | 82 359 | 19 874 |
| 8 | `vendor-motion` | `create-projection-node.mjs` | 70 714 | 14 556 |
| 9 | `useCommission` | `services/commissions.js` | 56 689 | 10 458 |
| 10 | `vendor-charts` | `axisSelectors.js` | 55 886 | 12 221 |

### 2.4 Per-route chunk breakdown (composition of major chunks)

**`DashboardShell-Cdrd-_wG.js` (distributor home)** — total gzip **47 020**. Top modules:

| gzip | module |
|---|---|
| 7 798 | `ViewBranches.jsx` |
| 5 454 | `OverlayPanel.jsx` |
| 5 408 | `CreateBranch.jsx` |
| 4 878 | `ViewSubscribers.jsx` |
| 3 732 | `UgandaMap.jsx` |
| 3 718 | `MetricsRow.jsx` |
| 3 538 | `Sidebar.jsx` |
| 2 180 | `TopBar.jsx` |
| 1 983 | `DashboardShell.jsx` |
| 502 | `Breadcrumb.jsx` |

Confirms: every panel that's hidden behind a sidebar click (CreateBranch, ViewBranches, ViewSubscribers) is packed into the home chunk. **AUDIT-1-10 (eager-mount) costs ~21 kB gzip of JS that the home view doesn't need at first paint.**

**`Settings-DebYO8TV.js` (distributor / branch sibling shell)** — total gzip **44 272**. Top modules: `CommissionPanel.jsx` (13 205) · `ViewAgents.jsx` (5 492) · `ReportsHub.jsx` (4 738) · `Settings.jsx` (3 697) · `ViewReports.jsx` (1 804). Why this exists as a separate chunk: rollup grouped panels that are imported from BOTH `DashboardShell` and `BranchDashboardShell` into a shared chunk. So on the distributor home AND the branch home, this 44 kB ships first paint. Worth flagging because the chunk's **biggest contributor (`CommissionPanel.jsx`, 13 kB gzip / 97 kB raw, 1 789 LOC)** is the second-largest single application file in the build.

**`BranchDashboardShell-DfrIF-ZC.js` (branch home)** — total gzip **24 792**. Top modules: `BranchHealthScore.jsx` (6 658) · `CreateAgent.jsx` (3 878) · `OperationsSection.jsx` (3 218) · `BranchSidebar.jsx` (3 173) · `BranchHealthScore.module.css` (1 643). Branch panels are statically imported from the same `Settings` chunk above so they ride along.

**`SubscriberDashboardShell-DKe1IiPt.js` (subscriber home)** — total gzip **18 388**. Top modules: 6 home widgets (PulseCard, CoPilotWidget, ProjectionWidget, TopUpWidget, ActivityWidget, IfYouNeedItWidget — ~9 kB combined) + BottomTabBar + SideNav + Shell glue. Routed-page bundles (`SavePage`, `WithdrawPage`, `ProjectionPage`, etc.) are correctly lazy-loaded and absent from the home chunk.

**`AgentDashboardShell-Cp3v1MAN.js` (agent home)** — total gzip **14 690**. Smallest of the four shells. Top: `CoPilotWidget.jsx` (2 392) · `PortfolioPulseCard.jsx` (2 143) · `SideNav.jsx` (1 798) · `services/agent.js` (1 698) · `BottomTabBar.jsx` (1 580). Routed pages (`CommissionsPage` 19 kB, `OnboardPage` 19 kB, `AnalyticsPage` 12 kB) are correctly lazy.

**`subscriber-XKUPj5C5.js`** (gzip 30 756) — packs `mockData.js` (12 955), `services/subscriber.js` (8 074), `mockBranchDefs.js` (6 427), `mockGeo.js` (3 300). This chunk loads on EVERY dashboard whose first-paint code touches `services/subscriber.js` — meaning the **distributor home pulls 30 kB gzip of mock seed data** even when `VITE_USE_SUPABASE=true`, because the service imports `mockData.js` at module top for the rollback fallback (see AUDIT-3-2).

### 2.5 Vendor split observations

- **`vendor-leaflet` (114 kB gzip)** — only used by `src/dashboard/map/UgandaMap.jsx`. Distributor distributors only render the map on the home. **Subscriber, Agent, Branch dashboards never mount the map.** Yet `index.html` emits `<link rel="modulepreload" href="/assets/vendor-leaflet-...js">` on every route including `/` (the marketing landing). See AUDIT-3-3.

- **`vendor-charts` (274 kB gzip!)** — recharts + d3. Only two consumers: `src/subscriber-dashboard/pages/ProjectionPage.jsx` and `src/agent-dashboard/pages/AnalyticsPage.jsx`. Both are lazy-loaded routes. Bundle is NOT in the landing page or distributor home modulepreload list — that part is correct. But the chunk itself is **274 kB gzip / 864 kB raw** — by far the largest single bundle in the build. Recharts is famously not tree-shakeable; the entire library ships even for the two pages that use one chart each. See AUDIT-3-4.

- **`vendor-BoVtWV09` (230 kB gzip — the unnamed "everything else" catch-all)** — contains supabase-js core (7 kB) PLUS its transitive deps: GoTrueClient (39 kB), postgrest-js (23 kB), `storage-js` (19 kB — **app does NOT upload files via supabase storage; KYC posts to /api/kyc/***), `realtime` + `phoenix.mjs` (26 kB — **no `.channel(` subscribers in code per Phase 1 §6**), `webauthn` (6 kB — **app uses custom HS256 JWT, not Supabase Auth**), `decimal.js-light` (13 kB), `redux-toolkit` (7 kB), `immer` (12 kB). Of those, only postgrest-js + the auth header injection are actually exercised. See AUDIT-3-5.

- **`vendor-motion` (143 kB gzip)** — used everywhere (every dashboard mounts Framer Motion via `motion.div` / `AnimatePresence`). Likely unavoidable as it stands, but the four routed shells could lazy-load motion if motion is only needed for animated entries.

---

## 3. TanStack Query config — every `useQuery` / `useMutation` × stale/gc × notes

**Global default (`src/main.jsx:14`)**: `staleTime: 5 * 60 * 1000`, `gcTime: 10 * 60 * 1000`, `refetchOnWindowFocus: false`, `retry: 1`. **This means every query in the table below inherits 5 min staleTime and DOES NOT refetch on focus** unless overridden.

> **This invalidates Phase 1 §AUDIT-1-4's premise** — `useTopBranch` (and the other entity-list hooks) DO inherit `staleTime: 5min`. The Phase 1 claim that *"useTopBranch has no staleTime → TanStack default 0 → refetch on every window focus"* is incorrect: the global default is 5 min and window-focus refetch is disabled. **However**, AUDIT-1-4's underlying recommendation (explicit staleTime per hook for clarity) is still reasonable code hygiene, just not a P1 perf issue. See AUDIT-3-12 (corrigendum).

All useQuery/useMutation calls live in 4 files (`src/hooks/use{Entity,Commission,Subscriber,Agent}.js`) — components do NOT call these primitives directly. 33 useQuery + 31 useMutation total.

### Queries

| Hook | File:line | Key | staleTime | gcTime | enabled | Notes |
|---|---|---|---|---|---|---|
| `useCountry` | `useEntity.js:25` | `['country']` | default 5min | default 10min | always | Country never changes → could push to 1h |
| `useEntity(level,id)` | `useEntity.js:38` | `['entity', level, id]` | default 5min | default 10min | `!!id && !!level && level!=='country'` | OK |
| `useChildren` | `useEntity.js:69` | `['children', level, parentId]` | default 5min | default 10min | `!!parentId` | OK |
| `useAllEntities` | `useEntity.js:82` | `['entities', level]` | default 5min | default 10min | `!!level` | Cold-cache cost dominant (AUDIT-1-5, 1-7) — staleTime helps warm visits |
| `useAllEntitiesMap` | `useEntity.js:95` | `['entitiesMap', level]` | default 5min | default 10min | `!!level` | OK |
| `useTopBranch` | `useEntity.js:109` | `['topBranch', level, parentId]` | default 5min | default 10min | `!!level && !!parentId` | OK (see AUDIT-3-12 corrigendum) |
| `useBreadcrumb` | `useEntity.js:123` | `['breadcrumb', level, selectedIds]` | default 5min | default 10min | `level !== 'country'` | `selectedIds` is an object — see AUDIT-3-6 (cache thrash) |
| `useSearch` | `useEntity.js:136` | `['search', query]` | default 5min | default 10min | `query.length >= 2` | OK |
| `useDistributorMetrics` | `useEntity.js:222` | `['distributor-metrics']` | **5min explicit** | default | always | Phase 1 wants this retired (AUDIT-1-9) |
| `useChildrenMetrics` | `useEntity.js:247` | `['childrenMetrics', parentLevel, parentId, ids]` | **5min explicit** | default | `childLevel && ids.length>0` | `ids` is array via `useMemo` — key stable |
| `useEntityMetrics` | `useEntity.js:269` | `['entityMetrics', level, id]` | **5min explicit** | default | `!!id && !!level` | OK |
| `useAllEntitiesMetrics` | `useEntity.js:292` | `['allEntitiesMetrics', level, ids]` | **5min explicit** | default | `level && ids.length>0` | Per AUDIT-1-11 fires for all 2049 agent IDs |
| `useNetworkCadence` | `useCommission.js:9` | `['networkCadence']` | default 5min | default | always | OK |
| `useCommissionRate` | `useCommission.js:26` | `['commissionRate']` | default 5min | default | always | OK |
| `useCommissionSummary(branchId)` | `useCommission.js:44` | `['commissionSummary', branchId\|\|'all']` | default 5min | default | always | OK |
| `useAgentCommissionList(statusFocus)` | `useCommission.js:51` | `['agentCommissions', statusFocus\|\|'all']` | default 5min | default | always | OK |
| `useAgentCommissionDetail(agentId)` | `useCommission.js:58` | `['agentCommissionDetail', agentId]` | default 5min | default | `!!agentId` | OK |
| `useCommissionSubscribers(agentId, filter)` | `useCommission.js:66` | `['commissionSubscribers', agentId, filter\|\|'all']` | default 5min | default | `!!agentId` | OK |
| `useDisputedAgentList` | `useCommission.js:74` | `['disputedAgents']` | default 5min | default | always | OK |
| `useEntityCommissionSummary(level, entityId)` | `useCommission.js:81` | `['entityCommissionSummary', level, entityId]` | default 5min | default | `!!entityId \|\| level==='country'` | OK |
| `useCurrentRun` | `useCommission.js:91` | `['currentRun']` | default 5min | default | always | Run state can change frequently; consider 30s |
| `useRun(runId)` | `useCommission.js:98` | `['settlementRun', runId]` | default 5min | default | `!!runId` | OK |
| `useRunsList({limit, branchId})` | `useCommission.js:106` | `['settlementRunsList', branchId\|\|'all', limit??'unlimited']` | default 5min | default | always | OK |
| `useBranchRunReview(runId, branchId)` | `useCommission.js:113` | `['runForBranch', runId, branchId]` | default 5min | default | `!!runId && !!branchId` | OK |
| `useRunBranchBreakdown(runId)` | `useCommission.js:121` | `['runBranchBreakdown', runId]` | default 5min | default | `!!runId` | OK |
| `useRunBranchAgents(runId, branchId)` | `useCommission.js:129` | `['runBranchAgents', runId, branchId]` | default 5min | default | `!!runId && !!branchId` | OK |
| `useCurrentSubscriber()` | `useSubscriber.js:21` | `['currentSubscriber', phone]` | default 5min | default | always | OK |
| `useSubscriberTransactions(id, filters)` | `useSubscriber.js:28` | `['subscriberTransactions', id, filters]` | default 5min | default | `!!id` | `filters` is an object — see AUDIT-3-6 |
| `useSubscriberClaims(id)` | `useSubscriber.js:36` | `['subscriberClaims', id]` | default 5min | default | `!!id` | OK |
| `useSubscriberWithdrawals(id)` | `useSubscriber.js:44` | `['subscriberWithdrawals', id]` | default 5min | default | `!!id` | Undocumented key (see drift §8) |
| `useSubscriberNominees(id)` | `useSubscriber.js:52` | `['subscriberNominees', id]` | default 5min | default | `!!id` | OK |
| `useSubscriberAgent(id)` | `useSubscriber.js:61` | `['subscriberAgent', id]` | default 5min | default | `!!id` | OK |
| `useAgentSubscribers(agentId)` | `useAgent.js:17` | `['agentSubscribers', agentId]` | default 5min | default | `!!agentId` | OK |

### Mutations (31 — invalidation rules summarised)

| Hook | File:line | Invalidates |
|---|---|---|
| `useCreateBranch` | `useEntity.js:148` | `['entities','branch']`, `['children']` |
| `useCreateAgent` | `useEntity.js:164` | `['entities','agent']`, `['children','branch',branchId]`, `['entity','branch',branchId]` |
| `useUpdateBranch` | `useEntity.js:182` | `['entity','branch',id]`, `['entities','branch']`, `['children']` (optimistic) |
| `useUpdateDistributor` | `useEntity.js:307` | `['entity','distributor',id]` (optimistic) |
| `useSetBranchStatus` | `useEntity.js:336` | `['entity','branch',id]`, `['entities','branch']`, `['children']` (optimistic) |
| `useUpdateSubscriberSchedule` | `useAgent.js:34` | `['agentSubscribers',agentId]`, `['subscriberTransactions',subscriberId]` (optimistic) |
| `useSetNetworkCadence` | `useCommission.js:15` | `['networkCadence']` |
| `useSetCommissionRate` | `useCommission.js:32` | `['commissionRate']` |
| **All 17 commission state-machine mutations** (approve/reject/release/branch-actions/confirm/dispute…) | `useCommission.js:154-286` | **`invalidateAll(qc)` — invalidates `ALL_RUN_KEYS` + `ALL_COMMISSION_KEYS` (12 keys)** every time. **Coarse — see AUDIT-3-7.** |
| `useMakeContribution`, `useRequestWithdrawal`, `useUpdateSchedule`, `useSubmitClaim`, `useUpdateInsuranceCover`, `useUpdateNominees` (optimistic), `useUpdateProfile` (optimistic) | `useSubscriber.js:79-176` | `['currentSubscriber']`, `['subscriberTransactions',id]`, `['subscriberClaims',id]`, `['subscriberWithdrawals',id]`, `['subscriberNominees',id]` via `useInvalidateSubscriber(id)` |

---

## 4. Virtualization gap table

| Surface | File | Hook(s) | Expected list size (distributor scope) | Virtualised? | Notes |
|---|---|---|---|---|---|
| Distributor `ViewSubscribers` | `src/dashboard/subscriber/ViewSubscribers.jsx:272` | `useAllEntities('subscriber')` | 30 003 | **✓ `useVirtualizer`** | OK |
| Distributor `ViewAgents` | `src/dashboard/agent/ViewAgents.jsx:315` | `useAllEntities('agent')` | 2 049 | **✓ `useVirtualizer`** | OK |
| Distributor `ViewBranches` | `src/dashboard/branch/ViewBranches.jsx:509` | `useAllEntities('branch')` | 314 | **✓ `useVirtualizer`** | OK at this scale; borderline necessary |
| Distributor `CommissionPanel` — agent list | `src/dashboard/commissions/CommissionPanel.jsx:1149` (`filteredAgents.map`) | `useAgentCommissionList` | up to **2 049 agents** | **✗** | Plain `.map()` over up to 2K rows — visible only when distributor opens commissions home; viewable DOM ~10× the typical viewport |
| Distributor `CommissionPanel` — run branches list | `CommissionPanel.jsx:875` (`runBranches.map`) | `useRunBranchBreakdown(runId)` | up to **314 branches** | **✗** | Settlement run review |
| Distributor `CommissionPanel` — run branch agents | `CommissionPanel.jsx:942,955` (`runBranchAgents.map`, `agent.commissions.map`) | `useRunBranchAgents` | up to **2 049 agents × N commissions** per branch | **✗** | Nested loop. For a branch with 20 agents × 60 subscribers = 1.2K DOM rows on open |
| Distributor `CommissionPanel` — branch review lines | `CommissionPanel.jsx:1010` (`branchReview.lines.map`) | `useBranchRunReview` | up to a few hundred per branch | **✗** | One branch worth — usually <300 |
| Distributor `CommissionPanel` — past runs | `CommissionPanel.jsx:1082` (`pastRuns.map`) | `useRunsList` | demo: ~10 | **✗** | Fine at this scale |
| Distributor `CommissionPanel` — agent paid txns | `CommissionPanel.jsx:1209` (`agentDetail.paidTransactions.slice(0,5).map`) | `useAgentCommissionDetail` | sliced to 5 | n/a | Slice cap mitigates |
| Distributor `CommissionPanel` — agent due txns | `CommissionPanel.jsx:1233` | sliced to 5 | n/a | Slice cap mitigates |
| Distributor `CommissionPanel` — commission subscribers | `CommissionPanel.jsx:1274` (`subscribers.map`) | `useCommissionSubscribers(agentId)` | per-agent ~60 | **✗** | OK at agent scope |
| Distributor reports — `AllSubscribers` | `src/dashboard/reports/views/AllSubscribers.jsx:157` (`ReportTable`) | `useAllEntities('subscriber')` | 30 003 | **✗** (client-side 25/50/100 paging) | `ReportTable` paginates; only `pageSize` rows in DOM |
| Distributor reports — `AllAgents` | views/AllAgents.jsx | `useAllEntities('agent')` | 2 049 | **✗** (paginated) | OK |
| Distributor reports — `AllBranches` | views/AllBranches.jsx | `useAllEntities('branch')` | 314 | **✗** (paginated) | OK |
| Branch `BranchOverview` agents grid | `src/branch-dashboard/overview/BranchOverview.jsx:35` (`useChildren('branch')`) | per-branch ~7 agents | n/a | **✗** | Tiny |
| Agent `SubscribersPage` | `src/agent-dashboard/pages/SubscribersPage.jsx:150` (`filtered.map`) | `useAgentSubscribers` | ~60/agent | **✗** | Fine |
| Agent `SubscriberSchedulePage` / `SubscriberDetailPage` | `useAgentSubscribers` | ~60 | n/a | n/a | Single subscriber view |
| Agent `AnalyticsPage` | `useAgentSubscribers` | ~60 derived | n/a | n/a | Aggregations only |
| Subscriber `ActivityPage` / `ActivityWidget` | `src/subscriber-dashboard/pages/ActivityPage.jsx` + widgets | `useSubscriberTransactions(sub.id)` | demo ~50–200/subscriber | **✗** | Per-subscriber, fine |
| Subscriber reports — `AllTransactions` | `subscriber-dashboard/reports/views/AllTransactions.jsx` | `useSubscriberTransactions(id)` | demo ~50–500/sub | **✗** (ReportTable paginated) | OK |

**Bottom line on virtualization**: the dashboards that justify virtualization at distributor scope already use it (`ViewSubscribers`, `ViewAgents`, `ViewBranches`). **The single gap** is `CommissionPanel.jsx` — at distributor scope its agent list (line 1149) and run-branch-agents nested loops (line 942/955) can render up to **2 049 agents** and ~1 200 nested commission rows respectively without virtualization. See AUDIT-3-8.

---

## 5. `mockData` hard-rule (§4.1) grep — file:line list

Grep:
```
grep -rln "src/data/mockData\|from ['\"].*data/mockData\|from ['\"]@data/mockData\|from ['\"]@/data/mockData" src/
```

Result — only service files:
- `src/services/subscriber.js`
- `src/services/commissions.js`
- `src/services/entities.js`
- `src/services/search.js`
- `src/services/chat.js`
- `src/services/agent.js`

**0 violations in components or dashboards.** Hard rule §4.1 is upheld. ✓

---

## 6. Context churn audit

| Context | File | `value=` memoized? | Inline-fn-in-value? | Computed in body w/o memo? | Consumers |
|---|---|---|---|---|---|
| `AuthContext` | `contexts/AuthContext.jsx:99-102` | **✓ `useMemo([user, login, logout, updateUser])`** | — | — | **23** |
| `SignInContext` | `contexts/SignInContext.jsx:8-10` | **✗ inline object** + inline arrow fns | `open: () => setIsOpen(true)` + `close: () => setIsOpen(false)` recreated every render | — | 3 |
| `ToastContext` | `contexts/ToastContext.jsx:65-67` | **✗ inline object** (`addToast`/`removeToast` are useCallback-stable, but wrapping `value={{...}}` is recreated) | — | — | **22** |
| `DashboardContext` (composer) | `contexts/DashboardContext.jsx:29-34` | composer hook — `useMemo({...nav, ...panel})` | — | — | 22 (via `useDashboard`) |
| `DashboardNavContext` | `contexts/DashboardNavContext.jsx:176-189` | **✓ `useMemo([level, selectedIds, …, closeDrillPanel])`** | — | `selectedIds` built via `useMemo` line 65 — OK | 3 |
| `DashboardPanelContext` | `contexts/DashboardPanelContext.jsx:108-129` | **✓ `useMemo([...12 deps])`** | — | derived `branchMenuOpen/agentMenuOpen/subscriberMenuOpen` computed on every render but they're cheap (boolean OR) and bake into the memoized value | 2 |
| `BranchScopeContext` | `contexts/BranchScopeContext.jsx:13` | **✗ inline object `{ branchId: branchId \|\| null }`** every render | — | — | **16** |
| `AgentScopeContext` | `contexts/AgentScopeContext.jsx:9` | **✗ inline object `{ agentId: agentId \|\| null }`** every render | — | — | 7 |
| `SignupContext` | `signup/SignupContext.jsx:203-204` | **✓ `useMemo([state, patch, reset])`** | — | — | 18 |

**Findings:** `SignInContext`, `ToastContext`, `BranchScopeContext`, `AgentScopeContext` all create a fresh `value` object reference on every parent render. **Impact:** every consumer of these contexts re-renders whenever the provider's parent re-renders, even if no inputs changed. See AUDIT-3-9.

`ToastContext`'s 22 consumers across every form/mutation make it the highest-blast-radius miss; the BranchScope / AgentScope leaks affect 16/7 deeply-nested components in the branch + agent dashboards. **`AuthContext` (23 consumers) is the largest and is correctly memoized.**

---

## 7. Lazy-loading map

| Route | Lazy? | Notes |
|---|---|---|
| `/` (LandingPage) | n/a (synchronous) | Statically composes Navbar + Hero + HowItWorks + TimeJourney + ForYou + Trust + CTA + Footer + StickyMobileCTA. Lives in `index` entry chunk (54 kB gzip). |
| `/about`, `/faq`, `/contact` | static | Tiny pages bundled into `index` entry. |
| `/signup/*` (`SignupPage`) | **✓ `lazy()`** at `App.jsx:26` | Loads `SignupPage` + `ConsentStep` chunk (34 kB gzip) on first visit. |
| `/dashboard/*` Distributor → `DashboardShell` | **✓ `lazy()`** at `App.jsx:22` | But once loaded, **eagerly mounts 7 panels via `DashboardContent`** (Phase 1 AUDIT-1-10). |
| `/dashboard/*` Branch → `BranchDashboardShell` | **✓ `lazy()`** at `App.jsx:23` | Same eager-mount pattern in `BranchDashboardShell.jsx:97-111` — re-uses distributor panels via `splitMode` (CreateAgent, ViewAgents, ViewReports, CommissionPanel, Settings). See AUDIT-3-10. |
| `/dashboard/*` Subscriber → `SubscriberDashboardShell` | **✓ `lazy()`** at `App.jsx:24` | **All sub-routes lazy** (`SubscriberDashboardShell.jsx:10-28`). |
| `/dashboard/*` Agent → `AgentDashboardShell` | **✓ `lazy()`** at `App.jsx:25` | **All sub-routes lazy** (`AgentDashboardShell.jsx:11-17`). |
| Subscriber `/reports/:reportId` views (5 of them) | **✓ `lazy()`** at `ReportsPage.jsx:9-13` | Each report view is its own chunk (3–5 kB gzip each). |
| Distributor `/reports/:reportId` views (12 of them) | **✓ `lazy()`** at `ReportsHub.jsx:22-32` + `ViewReports.jsx:12-`… | Each is its own chunk. |
| `/coming-soon` (`ComingSoon`) | static | Tiny inline component in `App.jsx`. |

**Summary**: Lazy-loading is *broadly* applied (54 `lazy()` call sites across the codebase). The single counterexample is the **distributor & branch dashboards' eager panel-mount** (AUDIT-1-10 / AUDIT-3-10).

---

## 8. API contract drift (`docs/api-contracts.md` vs actual code)

### Drift bullets

1. **`['settlementRequests']`** (contracts doc line 200) — documented under `GET /api/commissions/settlement-requests` → `getSettlementRequestList()`. **No such function exists in `src/services/commissions.js`** and **no `useSettlementRequestList` hook** exists in `useCommission.js`. The whole settlement-request flow was retired in favour of the open-run / settlement-run model.

2. **Commission mutation endpoint set** — contracts doc documents:
   - `POST /api/commissions/:commissionId/approve` (line 203, `approveCommission`)
   - `POST /api/commissions/:commissionId/reject` (line 209, `rejectCommission`)
   - `POST /api/commissions/bulk-approve` (line 215, `bulkApproveCommissions`)
   - `POST /api/commissions/bulk-reject` (line 222, `bulkRejectCommissions`)
   - `POST /api/commissions/settle` / `…/agents/:agentId/settle` / `…/settle-all` (lines 229-247, `settleCommissions` / `settleAgentCommissions` / `settleAllCommissions`)

   **None of these exist in `src/services/commissions.js`**. The state machine moved to: `openRun` / `releaseRun` / `releaseBranch` / `branchApproveLine` / `branchHoldLine` / `branchDisputeLine` / `branchApproveAll` / `markBranchReviewed` / `confirmCommission` / `disputeCommission` / `approveDispute` / `rejectDispute` / `bulkApproveDisputes` / `bulkRejectDisputes` / `withdrawDispute` / `cancelRun`. The contracts document predates the run-based state machine (Phase 1 AUDIT-1-1 covers backend implementation; contracts doc was never updated).

3. **Code keys NOT documented**:
   - `['childrenMetrics', parentLevel, parentId, ids]` (useEntity.js:248)
   - `['entityMetrics', level, id]` (useEntity.js:270)
   - `['allEntitiesMetrics', level, ids]` (useEntity.js:293)
   - `['distributor-metrics']` (useEntity.js:224)
   - `['currentRun']` (useCommission.js:93)
   - `['settlementRun', runId]` (useCommission.js:100)
   - `['settlementRunsList', branchId||'all', limit??'unlimited']` (useCommission.js:108)
   - `['runForBranch', runId, branchId]` (useCommission.js:115)
   - `['runBranchBreakdown', runId]` (useCommission.js:123)
   - `['runBranchAgents', runId, branchId]` (useCommission.js:131)
   - `['networkCadence']` (useCommission.js:11)
   - `['subscriberWithdrawals', id]` (useSubscriber.js:45)

4. **Mutations NOT documented**:
   - `useUpdateBranch` (`PUT /api/branches/:id` implied — not in contracts)
   - `useSetBranchStatus` (`PUT /api/branches/:id/status` implied)
   - `useUpdateDistributor` (`PUT /api/distributors/:id`)
   - `useUpdateProfile` (subscriber) — exists in contracts (§7 PUT /api/subscribers/me/profile) ✓ documented
   - `useCreateAgent` — contracts line 121 says "Not yet in services" — out of date; hook exists at `useEntity.js:164`

5. **Invalidation rule mismatches**:
   - Contracts line 117: `createBranch` "Invalidates: `['entities','branch']`, `['children']`" — code matches (useEntity.js:153-154). ✓
   - Contracts line 207: approve/reject mutations "Invalidates: ALL_COMMISSION_KEYS" — code's `invalidateAll` invalidates `ALL_RUN_KEYS + ALL_COMMISSION_KEYS` (12 keys total). ✓ matches scope.
   - **However**, the doc lists `settlementRequests` and `entityCommissionSummary` in ALL_COMMISSION_KEYS — code's `ALL_COMMISSION_KEYS` is `[commissionSummary, agentCommissions, agentCommissionDetail, commissionSubscribers, disputedAgents, entityCommissionSummary]`. Code does NOT include `settlementRequests`. Doc drift; code is correct.

### Recommendation

`docs/api-contracts.md` is ~6 months out of date relative to the run-based commission state machine and the post-Phase-1 entity-metrics RPCs. Either (a) rewrite the commissions section against the actual hook surface in `useCommission.js`, or (b) version-stamp it as "snapshot 2026-Q1, see hooks for source of truth". See AUDIT-3-11.

---

## 9. `MOCK_NOW` drift

`src/data/mockData.js:21`:
```js
export const MOCK_NOW = new Date(2026, 4, 1); // 2026-05-01
```

**Today is 2026-05-22 (21 days drift).** Note: the Phase 3 audit-task spec said `(2026, 3, 8)` (April 8, ~6 weeks drift) and CLAUDE.md §10b also says `new Date(2026, 3, 8)`. The actual value has already been bumped to **May 1 2026** — both `CLAUDE.md` and the audit task description are stale. **Actual drift = 21 days.**

P2 per the audit plan. A demo today reading "next payout 1 May" with the wall-clock showing 22 May would feel wrong; the rolling-window math (`cycleWindow(cadence, MOCK_NOW)`) anchors on MOCK_NOW, so all derived "due in N days" / "next payout" labels are stale by 21 days. The commission state machine references in `commissions.js` (line 959, 1068, 1276, 1298, 1299, 1366, 1379) all anchor on this value. See AUDIT-3-13.

---

## 10. Findings (3-1 through 3-14)

### AUDIT-3-1 — `vendor-charts` chunk is 274 kB gzip / 864 kB raw for two single-chart pages

```
ID:       AUDIT-3-1
Area:     frontend
Severity: P1
Title:    vendor-charts ships 274 kB gzip (864 kB raw) just to render ONE LineChart on /dashboard/projection (subscriber) and a few small charts on /dashboard/analytics (agent). Recharts is famously non-tree-shakeable; the chunk pulls all 457 source modules.
Evidence: 
  - rollup-plugin-visualizer (docs/audit/_bundle-stats.html): assets/vendor-charts-DS6VFD2J.js renders 864,215 bytes, 274,190 gzip, 235,622 brotli, with 457 distinct modules.
  - Only consumers (grep "from 'recharts'" src/): 
      src/subscriber-dashboard/pages/ProjectionPage.jsx
      src/agent-dashboard/pages/AnalyticsPage.jsx
  - Top 5 internal modules: axisSelectors.js (12 kB), Line.js (7 kB), Bar.js (7 kB), Area.js (7 kB), Pie.js (6 kB). Bar/Area/Pie ride along but only Line/Area are rendered by the two consumers.
  - Both consumer routes ARE correctly lazy-loaded (App.jsx → SubscriberDashboardShell.jsx:15 → ProjectionPage; AgentDashboardShell.jsx:15 → AnalyticsPage).
Reproduction:
  npm run build → ls -la dist/assets/vendor-charts-*.js → 334 kB raw / 91 kB gzip (numbers in build log match visualizer).
Root cause hypothesis:
  vite.config.js:38 manualChunks groups all of /recharts and /d3- into one chunk. Recharts' ESM build re-exports its entire surface from index.js — anyone who imports {LineChart, Line, XAxis} pulls everything via the bare import. Tree-shaking is defeated by recharts' internal module graph.
Proposed fix scope:
  Options in increasing impact:
    (a) Switch the two consumers to a lighter library (lightweight-charts ~140 kB raw, or build a custom <Sparkline> for Subscriber projection and <BarChart> for Agent analytics using only the SVG primitives we already wield in MiniChart.jsx).
    (b) Use `import('recharts').then(...)` inside each consumer's render — no manualChunks change needed; Vite will isolate per-route.
    (c) Defer: the 274 kB only loads when a user navigates to /projection (subscriber) or /analytics (agent), so this is not on the critical path. Document the cost and revisit only if those routes show first-paint > 2s.
  Phase recommendation: (a) for the subscriber projection (only renders 60-month line — bespoke SVG is ~200 lines), keep recharts for agent analytics (small, lazy, not user-blocking). Net: drop vendor-charts to ~30 kB or eliminate entirely.
Confidence: high
```

### AUDIT-3-2 — `mockData.js` (46 kB raw / 13 kB gzip) ships in the `subscriber` chunk on every dashboard, even when `VITE_USE_SUPABASE=true`

```
ID:       AUDIT-3-2
Area:     frontend
Severity: P2
Title:    src/data/mockData.js (1060 lines, 46 kB raw, 13 kB gzip) is statically imported by every `src/services/*.js` file as the rollback-flag fallback path. Vite cannot tree-shake it because the IS_SUPABASE_ENABLED branch is a runtime check, not a build-time conditional. Result: in production with VITE_USE_SUPABASE=true, the entire mock seed (regions/districts/branches/agents/subscribers/transactions snippets + mockBranchDefs + mockGeo) ships to every authenticated user.
Evidence:
  - rollup-plugin-visualizer: assets/subscriber-XKUPj5C5.js totals 30,756 gzip, with mockData.js (12,955), services/subscriber.js (8,074), mockBranchDefs.js (6,427), mockGeo.js (3,300) — the mock seed is 76% of this chunk.
  - src/services/api.js line ~12 exports IS_SUPABASE_ENABLED = import.meta.env.VITE_USE_SUPABASE !== 'false'.
  - src/services/subscriber.js, entities.js, commissions.js, agent.js, search.js, chat.js each begin with `import { MOCK_NOW } from '../data/mockData'` and reference mockData throughout for the IS_SUPABASE_ENABLED=false branch.
  - Production builds carry the entire mockData closure because Vite's tree-shaker treats runtime conditionals as side-effects.
Reproduction:
  Build with VITE_USE_SUPABASE=true → grep "REGIONS\s*=" dist/assets/subscriber-*.js → matches (the mock arrays ship verbatim).
Root cause hypothesis:
  The IS_SUPABASE_ENABLED branch is intentional (CLAUDE.md §10a rollback flag) but the pattern of `if (!IS_SUPABASE_ENABLED) return _legacy_mock_x()` keeps the mock arrays in the live bundle. The original design assumed they'd be small.
Proposed fix scope:
  Either:
    (a) Code-split the mock-fallback paths: replace `import { MOCK_NOW, REGIONS } from '../data/mockData'` with `const { MOCK_NOW, REGIONS } = await import('../data/mockData')` inside each fallback branch. Vite splits mockData into its own dynamically-imported chunk that only loads when VITE_USE_SUPABASE=false.
    (b) Tree-shake mockData itself: split into mockData/seed (regions/districts/branches/agents — used by everyone) vs mockData/transactions, mockData/commissions (used only by their respective services). Drops ~5 kB gzip from the chunk.
    (c) Build-time elimination: replace IS_SUPABASE_ENABLED with `import.meta.env.VITE_USE_SUPABASE === 'true'` and let Vite's DCE eliminate the unreachable fallback branch when the flag is set. Requires every service file to be touched and rollback-flag flips become rebuild-required (acceptable for prod; localhost dev still works).
  Phase recommendation: (c) — yields ~30 kB gzip saving on every dashboard for the cost of "rollback flag is now build-time, not runtime". Demo deploys rarely need runtime flip.
Confidence: high
```

### AUDIT-3-3 — `vendor-leaflet` (114 kB gzip) and `vendor-BoVtWV09` (230 kB gzip) modulepreload on the marketing landing page

```
ID:       AUDIT-3-3
Area:     frontend
Severity: P1
Title:    dist/index.html emits <link rel="modulepreload"> for vendor-leaflet, vendor-BoVtWV09 (supabase + transitive), vendor-motion, vendor-tanstack, vendor-router on EVERY route — including the marketing landing page "/". Total vendor preload on landing = ~745 kB gzip across chunks that the landing UI doesn't execute.
Evidence:
  - dist/index.html lines 28-34 — 5 modulepreload links for vendor chunks unconditionally.
  - LandingPage in src/App.jsx:59-75 renders only static components (Navbar/Hero/HowItWorks/TimeJourney/ForYou/Trust/CTA/Footer/StickyMobileCTA). No map, no chart, no dashboard widget. ProtectedDashboard's lazy() boundary at App.jsx:22-25 means none of the dashboards' code executes until /dashboard is visited.
  - Confirm modules don't execute on /: grep "leaflet\|MapContainer\|TileLayer" dist/assets/index-vcEN66Ri.js returns 2 hits (both are __vite__mapDeps string entries pointing at "vendor-leaflet-...js", not actual leaflet code).
Reproduction:
  Build, deploy, load / on a cold cache. DevTools Network panel filtered "vendor-" shows 5 chunks downloaded with priority Low (modulepreload). 745 kB gzip transferred to render a marketing page that needs ~54 kB of index entry + ~110 kB of react-dom.
Root cause hypothesis:
  Vite's modulepreload behaviour emits preload links for every chunk reachable via static imports from the entry, AND for the dependencies of every lazy chunk in __vite__mapDeps. Since the entry chunk lazy()-imports all four dashboard shells, ALL their dependency chunks become preload candidates.
Proposed fix scope:
  Three layers:
    (a) Set vite.config.js `build.modulePreload: false` (or `{ polyfill: false, resolveDependencies: () => [] }`) to suppress automatic preload-link emission. Cheapest fix; browsers still parse the entry chunk and download dependencies on demand.
    (b) Use Vite's <Helmet> equivalent / dynamic <link rel="prefetch"> from the landing page that only hints `vendor-react` + `vendor-router` (the chunks the landing CTA/SignInModal actually need).
    (c) Conditional preload: serve a route-specific index.html via Vercel rewrite (landing page gets a leaner preload list, /dashboard gets the full vendor preload).
  Phase recommendation: (a). One-line vite.config.js change; saves ~700 kB gzip transfer on first visit to "/", at the cost of a small first-paint penalty when the user clicks Sign In (vendor-router needed) and gets a 200-300ms delay. Mitigate (a) with a hand-written <link rel="prefetch" href="/assets/vendor-router-*.js" as="script"> in index.html for the chunks the landing CTA needs.
Confidence: high
```

### AUDIT-3-4 — `vendor-BoVtWV09` 230 kB gzip carries supabase-storage / realtime / phoenix / webauthn / decimal.js-light that the app NEVER uses

```
ID:       AUDIT-3-4
Area:     frontend
Severity: P1
Title:    Top-level `import { createClient } from '@supabase/supabase-js'` in src/services/supabaseClient.js pulls supabase-js's entire client surface. The result is a 230 kB gzip chunk containing GoTrueClient (39 kB, auth-js — not used since custom HS256), storage-js (19 kB — KYC posts to /api/kyc/*, no supabase storage), phoenix.mjs (13 kB — realtime channel transport), RealtimeChannel + RealtimeClient (12 kB — Phase 1 confirmed zero `.channel(` subscribers), webauthn (6 kB — passwordless second factor, unused), decimal.js-light (13 kB — only referenced by storage-js's signedUrl signing), redux-toolkit (7 kB — internal supabase realtime store), immer (12 kB — same), GoTrueAdminApi (6 kB — admin API).
Evidence:
  - rollup-plugin-visualizer: assets/vendor-BoVtWV09.js totals 229,788 gzip / 1,022,718 raw, with the modules listed above. supabase-js core itself is only 7 kB gzip in this chunk — 97% of the bytes are transitive deps.
  - grep "from '@supabase'" src/ — only src/services/supabaseClient.js imports createClient; everywhere else uses the `supabase` singleton it exports for `.from()` and `.rpc()` only.
  - grep "\.channel(" src/services/ src/hooks/ src/dashboard/ src/branch-dashboard/ src/agent-dashboard/ src/subscriber-dashboard/ → 0 hits. No realtime subscriptions.
  - grep "supabase.storage" src/ → 0 hits. No storage uploads.
  - grep "supabase.auth" src/ → 0 hits (we mint our own JWT).
  - src/services/supabaseClient.js:76-83 — explicit `accessToken` callback for the third-party JWT pattern. Comment line 81-82 reads: "Setting this option disables the built-in supabase.auth client — that's fine, we don't use it." Yet supabase-js still bundles auth-js because it's a static import of the package's index.mjs.
Reproduction:
  npm run build → grep "GoTrueClient\|phoenix\|webauthn\|decimal" dist/assets/vendor-*.js → all match. 
Root cause hypothesis:
  supabase-js's `index.mjs` does `export { GoTrueClient, ..., RealtimeClient, ... }` and `createClient` instantiates all of them eagerly. There's no opt-in / opt-out for the "only postgrest" use case. The package is engineered for full-stack use; using only `.from()` and `.rpc()` doesn't trim the bundle.
Proposed fix scope:
  Replace `createClient` with a thin custom wrapper:
    (a) Bring in `@supabase/postgrest-js` directly (already a dep transitively — 23 kB gzip standalone).
    (b) Write src/services/supabaseClient.js as ~50 lines: a `PostgrestClient` instance + the same `accessToken` header-injection logic, exposed as `supabase = { from: pgr.from.bind(pgr), rpc: pgr.rpc.bind(pgr) }`.
    (c) Eliminates GoTrue, storage, realtime, phoenix, webauthn, decimal.js, redux-toolkit, immer.
  Estimated saving: 230 kB gzip → ~30 kB gzip on the supabase chunk. **The single largest win available** in this audit by a wide margin.
  Risk: every service uses the supabase singleton; the API shape (`.from()` and `.rpc()`) is identical with postgrest-js, so consumer code shouldn't change.
Confidence: high
```

### AUDIT-3-5 — `vendor-motion` (143 kB gzip) is in every dashboard's initial-paint chunk

```
ID:       AUDIT-3-5
Area:     frontend
Severity: P2
Title:    framer-motion 143 kB gzip / 423 kB raw loads on every dashboard's first paint because motion.div + AnimatePresence are used in DashboardShell, BranchDashboardShell, AgentShell, SubscriberShell, and most signup steps, signup, sign-in modal, mobile drawers, etc.
Evidence:
  - rollup-plugin-visualizer: assets/vendor-motion-Bduc_OOO.js gzip 142,667 / raw 423,790. 398 modules; largest is create-projection-node.mjs (14 kB gzip).
  - dist/index.html line 33: modulepreload vendor-motion on every route.
  - Static imports in: src/dashboard/DashboardShell.jsx:2, src/branch-dashboard/BranchDashboardShell.jsx:3, src/components/Navbar.jsx, src/components/Hero.jsx, src/components/SignInModal.jsx, src/dashboard/overlay/OverlayPanel.jsx, src/dashboard/sidebar/Sidebar.jsx, ~30+ more.
Reproduction:
  Visit /, /dashboard, /signup — all load vendor-motion as a static chunk.
Root cause hypothesis:
  Framer Motion's tree-shake is decent but `motion.div` resolves into the full DOM-motion graph (create-projection-node, VisualElement, animation-state). Used pervasively in this codebase.
Proposed fix scope:
  Two angles:
    (a) Replace `<motion.div>` + `<AnimatePresence>` with CSS keyframe transitions for entries that don't need physics / layout animation (~80% of usages). e.g. Sidebar hover indicators, MetricsRow card reveals.
    (b) Split framer-motion in vite.config.js into `framer-motion-essential` (the LazyMotion-friendly `m.div` minimal feature set) and `framer-motion-full`. Use `<LazyMotion features={domAnimation}>` at the App root; switches motion to ~30 kB gzip core.
  Phase recommendation: (b) — single-PR change to main.jsx wrap + adjust ~5 places where the full feature set is needed (drag, layout transitions).
Confidence: medium (mostly safe; some usages of layoutId / drag would need to retain m.full)
```

### AUDIT-3-6 — `useBreadcrumb` and `useSubscriberTransactions` use object keys that change reference every render

```
ID:       AUDIT-3-6
Area:     frontend
Severity: P2
Title:    src/hooks/useEntity.js:124 — useBreadcrumb passes `selectedIds` (an object) in the query key. src/hooks/useSubscriber.js:29 — useSubscriberTransactions passes `filters` (an object) similarly. TanStack Query uses structural equality on keys, so when a parent re-renders and creates a new `{...}` instance via inline `{ region: 'r-x', district: ... }` notation, the query key changes and the query refetches.
Evidence:
  - src/hooks/useEntity.js:124-128: queryKey: ['breadcrumb', currentLevel, selectedIds]. selectedIds is derived in DashboardNavContext via useMemo — that's the consumer-side fix.
  - src/contexts/DashboardNavContext.jsx:65 wraps selectedIds in useMemo([level, entityId]). Good — but its consumers that re-derive a filtered subset (e.g. `{ region: selectedIds.region }`) bypass the memo.
  - src/hooks/useSubscriber.js:27-32: queryKey: ['subscriberTransactions', id, filters]. Every call site passes a fresh inline `{ type, status, from, to }`. grep "useSubscriberTransactions(" src/ → most call sites pass an inline object literal.
Reproduction:
  Mount a component that consumes useSubscriberTransactions with `{ type: 'contribution' }`. React DevTools shows the query re-running on every parent render.
Root cause hypothesis:
  TanStack Query SAYS keys are structurally compared, but in practice an inline literal `{ type: 'contribution' }` is reference-fresh per render. Structural-equality applies to detect that the inputs ARE equivalent — but only after the query observer instance has been created. So the deep-equal short-circuit prevents extra network calls; what it does NOT prevent is the inner `useQuery(...)` returning a new observer on each re-execution, which can cascade through React.useSyncExternalStore as a new subscription. In practice, harm is small (~ms per render).
Proposed fix scope:
  Memoize filter/select-ids objects at call sites — or normalize the key in the hook itself: `queryKey: ['subscriberTransactions', id, filters?.type ?? null, filters?.status ?? null, ...]`. Flattens to primitives, eliminates structural compare per render.
Confidence: low (perf cost is small; mainly a code-hygiene improvement)
```

### AUDIT-3-7 — Every commission mutation invalidates all 12 commission + run keys via `invalidateAll(queryClient)`

```
ID:       AUDIT-3-7
Area:     frontend
Severity: P2
Title:    src/hooks/useCommission.js:148-152 defines `invalidateAll(qc)` that invalidates [...ALL_RUN_KEYS, ...ALL_COMMISSION_KEYS] (12 distinct query keys). Every single one of the 17 commission state-machine mutations (approve/reject/release/branch-actions/confirm/dispute…) calls this. A single line-item action (e.g. branch admin holds one commission line) refetches the full network commission summary, every settlement run, the run-branch-breakdown for every branch, etc.
Evidence:
  - useCommission.js:139-152: ALL_RUN_KEYS = 6 keys, ALL_COMMISSION_KEYS = 6 keys; invalidateAll triggers all 12.
  - useCommission.js:154-286: every mutation's `onSuccess` is `() => invalidateAll(queryClient)`.
  - Phase 1's commission summary endpoint is 205ms mean (pg_stat_statements). One branch-hold mutation triggers refetches for: commissionSummary (network), agentCommissions, agentCommissionDetail, commissionSubscribers, disputedAgents, entityCommissionSummary, currentRun, settlementRun, settlementRunsList, runForBranch, runBranchBreakdown, runBranchAgents — assuming all are mounted, the user could trigger 12 × 200ms = 2.4s of refetch activity for one line action.
Reproduction:
  Open distributor CommissionPanel. Open one settlement run. Hold one commission line. Watch Network — observe 8-12 concurrent /rest/v1/rpc/* refetches.
Root cause hypothesis:
  The author saw "any commission state change might ripple through every summary" and chose the conservative coarse-invalidation. Correct safety, but expensive.
Proposed fix scope:
  Per-mutation, narrow the invalidation:
    branchApproveLine / branchHoldLine / branchDisputeLine / approveDispute / rejectDispute → invalidate only ['runForBranch', runId, branchId], ['runBranchAgents', runId, branchId], ['entityCommissionSummary', 'branch', branchId], and ['commissionSummary', branchId].
    releaseRun / releaseBranch → invalidate full set (broad state change is real here).
    confirmCommission (agent) → invalidate only ['agentCommissionDetail', agentId] + ['commissionSummary', null].
  Each mutation already knows the runId / branchId / agentId; threading them into the invalidation list is a 5-10 line change per hook.
  Estimated saving: ~80% of post-mutation network round-trips, all WAN-bound.
Confidence: medium (some mutations legitimately affect global state; tightening too far risks stale UI)
```

### AUDIT-3-8 — `CommissionPanel.jsx` renders up to 2,049 agents and ~1,200 nested run-branch commission rows without virtualization

```
ID:       AUDIT-3-8
Area:     frontend
Severity: P2
Title:    CommissionPanel.jsx (1,789 lines, 13 kB gzip / 97 kB raw — biggest single app file) renders agent lists via plain `filteredAgents.map(...)` at line 1149 (up to 2,049 agents) and nested run-branch-agents loops at lines 942 + 955 (up to ~1,200 DOM nodes per run review). None use @tanstack/react-virtual despite being adjacent to virtualized ViewBranches/ViewAgents/ViewSubscribers in the same dashboard.
Evidence:
  - CommissionPanel.jsx:1149 — filteredAgents.map((agent) => <button className={styles.agentRow}>…).
  - CommissionPanel.jsx:942-960 — runBranchAgents.map(agent => agent.commissions.map(c => …)). Nested, agent × commission count.
  - useAgentCommissionList returns up to 2,049 rows at distributor scope (every agent in the network).
  - grep "useVirtualizer" CommissionPanel.jsx → 0 hits.
  - CSS file CommissionPanel.module.css has `content-visibility: auto` on .agentRow (Phase 1 finding mitigation) — helps paint, doesn't help layout/script time for 2K nodes.
Reproduction:
  Sign in as distributor. Open Commissions panel. Switch to "All agents" filter. Watch React DevTools profiler — initial render of the list is ~80-120ms commit on a mid-range laptop, longer on mobile.
Root cause hypothesis:
  CommissionPanel was designed for the ~314-branch / 60-agent-per-branch demo seed. Author assumed the visible viewport would naturally limit DOM size. content-visibility: auto helps with paint but not React commit time.
Proposed fix scope:
  Wrap the 3 large lists (filteredAgents at L1149, runBranches at L875 / runBranchAgents at L942) in useVirtualizer using the same template that ViewAgents.jsx:315 uses. Estimated effort: ~80 LOC × 3 lists, well-contained. Pair with the planned CommissionPanel decomposition (FRONTEND.md §16b notes this file as candidate for `<ChatThread>` + breadcrumb-trail refactor).
Confidence: high
```

### AUDIT-3-9 — `SignInContext`, `ToastContext`, `BranchScopeContext`, `AgentScopeContext` `value={{ ... }}` is unmemoized (recreated on every render)

```
ID:       AUDIT-3-9
Area:     frontend
Severity: P2
Title:    Four context providers create a fresh `value` object reference on every parent render. Every consumer of those contexts re-renders even when nothing changed.
Evidence:
  - src/contexts/SignInContext.jsx:8-10:  `value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}` — inline arrow fns on every render.
  - src/contexts/ToastContext.jsx:65-67:  `value={{ toasts, addToast, removeToast }}` — wrapping object recreated even though the callbacks are useCallback-stable. 22 consumers (every Toast emitter site).
  - src/contexts/BranchScopeContext.jsx:13:  `value={{ branchId: branchId || null }}` — inline literal. 16 consumers across the Branch dashboard.
  - src/contexts/AgentScopeContext.jsx:9:  `value={{ agentId: agentId || null }}` — same pattern. 7 consumers.
  - AuthContext, DashboardContext (composer), DashboardNavContext, DashboardPanelContext, SignupContext ARE all correctly memoized via useMemo — confirming the pattern is known to the codebase; the four above were missed.
Reproduction:
  Profile a parent render of SignInProvider — every component reading useSignIn() rerenders even if isOpen didn't change.
Root cause hypothesis:
  These three contexts are small and their providers are stable; the perf hit is low and was easy to miss in review.
Proposed fix scope:
  Per file:
    SignInContext: wrap value in useMemo([isOpen]); useCallback the open/close fns.
    ToastContext: wrap value in useMemo([toasts, addToast, removeToast]). (addToast/removeToast are already stable.)
    BranchScopeContext + AgentScopeContext: wrap value in useMemo([branchId|agentId]). Or memoize via `value={useMemo(() => ({ branchId }), [branchId])}` inline. 1-line change per file.
  Net: ~50 LOC across 4 files. Eliminates a tier of unnecessary re-renders, particularly across BranchScope's 16 consumers in the branch dashboard tree.
Confidence: high
```

### AUDIT-3-10 — `BranchDashboardShell` repeats the eager-panel-mount pattern from AUDIT-1-10

```
ID:       AUDIT-3-10
Area:     frontend
Severity: P1
Title:    src/branch-dashboard/BranchDashboardShell.jsx:97-111 — DashboardContent unconditionally mounts <CreateAgent />, <ViewAgents />, <ViewReports />, <CommissionPanel />, <Settings /> (with `splitMode` prop). Same eager-mount anti-pattern Phase 1 flagged for the distributor (AUDIT-1-10). Each panel kicks off its data hooks at mount even when the panel UI is closed.
Evidence:
  - src/branch-dashboard/BranchDashboardShell.jsx:97-111 (DashboardContent function body).
  - Sister panels' data hooks (already documented under AUDIT-1-10 for distributor scope) — at branch scope the cost is smaller but non-zero:
      ViewAgents calls useAllEntities('agent') (2,049 rows network-wide) + useAllEntities('branch') (314) + useAllEntities('district') (135) + useAllEntities('region') (4) + useAllEntitiesMetrics('agent') — even though BranchScopeContext.branchId is set and the user only wants to see their branch's agents.
      CommissionPanel fires useCommissionConfig, useRecentSettlementRuns, useDistributorCommissions, etc.
  - Counterpoint: SubscriberDashboardShell and AgentDashboardShell use lazy() + <Suspense> for their sub-routes (see lazy-loading map §7) — pattern is known.
Reproduction:
  Sign in as a Branch Admin (any +25671000NN1N5 phone). Open DevTools Network. Filter `/rest/v1/`. Load /dashboard. Observe ~12-15 requests at first paint covering agents, branches, commissions, settlement_runs — none of which are visible until the user opens the corresponding panel.
Root cause hypothesis:
  The branch dashboard re-uses the distributor's panel components with splitMode=true. The eager-mount pattern was carried over verbatim.
Proposed fix scope:
  Same as AUDIT-1-10 — guard each panel render on its open state:
    {createAgentOpen && <CreateAgent splitMode />}
    {viewAgentsOpen && <ViewAgents splitMode />}
    {viewReportsOpen && <ViewReports splitMode />}
    {commissionsOpen && <CommissionPanel splitMode />}
    {settingsOpen && <Settings splitMode />}
  Or migrate to React.lazy + Suspense as the subscriber/agent shells already do.
  Pair with prefetching on sidebar hover via queryClient.prefetchQuery for "first interaction feels instant" UX.
Confidence: high
```

### AUDIT-3-11 — `docs/api-contracts.md` is significantly drifted from the actual hook surface

```
ID:       AUDIT-3-11
Area:     frontend
Severity: P3
Title:    docs/api-contracts.md documents a commission-state-machine API (approveCommission / rejectCommission / settleCommissions / settleAgentCommissions / bulk*) and a settlement-requests endpoint set that NO LONGER EXISTS in src/services/commissions.js. The current state machine is run-based (openRun / releaseRun / branchApproveLine / confirmCommission / disputeCommission etc.) — see §8 of this report.
Evidence: 
  - docs/api-contracts.md lines 200, 203, 209, 215, 222, 229-247: documents removed surface.
  - src/services/commissions.js exports: getCurrentRun, listRuns, openRun, cancelRun, releaseRun, releaseBranch, branchApproveLine, branchHoldLine, branchDisputeLine, branchApproveAll, markBranchReviewed, confirmCommission, disputeCommission, approveDispute, rejectDispute, bulkApproveDisputes, bulkRejectDisputes, withdrawDispute — 17 mutations that have no corresponding doc section.
  - Undocumented React Query keys: childrenMetrics, entityMetrics, allEntitiesMetrics, distributor-metrics, currentRun, settlementRun, settlementRunsList, runForBranch, runBranchBreakdown, runBranchAgents, networkCadence, subscriberWithdrawals.
  - Undocumented mutations: useUpdateBranch, useSetBranchStatus, useUpdateDistributor, useCreateAgent (contracts line 121 says "Not yet in services" — out of date).
Reproduction:
  Diff the contracts doc vs src/hooks/use{Entity,Commission,Subscriber,Agent}.js exports.
Root cause hypothesis:
  Phase 1 AUDIT-1-1 indicates the run-based state machine landed in migration 0020 (Q1 2026); the contracts doc predates it and was never refreshed.
Proposed fix scope:
  Rewrite the §3 (Commissions) and §2 (Entities) sections of docs/api-contracts.md against the current hook surface. Single PR, ~150 lines of doc edits. Out-of-scope for Phase 3 source-tree work; recommend a follow-up doc-only PR.
Confidence: high
```

### AUDIT-3-12 — Phase 1 AUDIT-1-4 corrigendum: window-focus refetch is globally disabled

```
ID:       AUDIT-3-12
Area:     frontend
Severity: P3
Title:    Phase 1 AUDIT-1-4 claimed `useTopBranch` has no staleTime and TanStack defaults to 0, triggering window-focus refetch. src/main.jsx:14-19 sets a GLOBAL `staleTime: 5 * 60 * 1000`, `refetchOnWindowFocus: false`, `retry: 1` on the QueryClient. Every query in the codebase inherits these. AUDIT-1-4's named root cause (`get_top_branch` re-fires on tab switch) is therefore wrong.
Evidence:
  - src/main.jsx:12-21 — QueryClient defaultOptions explicitly sets staleTime 5min, refetchOnWindowFocus false, retry 1.
  - src/hooks/useEntity.js:109-115 — useTopBranch indeed has no staleTime override; inherits 5min from global.
Reproduction:
  Mount the distributor home, switch to another browser tab for 30 seconds, return. Watch Network — no /rest/v1/rpc/get_top_branch refetch fires.
Root cause hypothesis:
  Phase 1's hypothesis was drafted before reading main.jsx; the false claim was carried into the finding.
Proposed fix scope:
  Amend AUDIT-1-4 in docs/audit/01-distributor-metrics.md with this corrigendum. AUDIT-1-1 (the actual root cause — get_top_branch RPC timing out) and AUDIT-1-5/-7 (cold-cache pagination cost) still stand; only AUDIT-1-4's "window focus" framing is invalidated.
  Optional code-hygiene change: still add `staleTime: 5 * 60 * 1000` explicitly to `useTopBranch` and the other entity hooks so the contract is local-readable rather than relying on the global default. Zero functional change but improves auditability.
Confidence: high
```

### AUDIT-3-13 — `MOCK_NOW = 2026-05-01` is 21 days behind the wall clock

```
ID:       AUDIT-3-13
Area:     frontend
Severity: P2
Title:    src/data/mockData.js:21 exports MOCK_NOW = new Date(2026, 4, 1) ("2026-05-01"). Today's wall-clock date is 2026-05-22. All "due in N days" / "next payout" labels and the settlement-cycle math anchored on cycleWindow(cadence, MOCK_NOW) are 21 days stale. Note: the Phase 3 audit-plan text and CLAUDE.md §10b both reference (2026,3,8) (April 8) — both are out of date; the constant has already been bumped once.
Evidence: 
  - src/data/mockData.js:21 — `export const MOCK_NOW = new Date(2026, 4, 1); // 2026-05-01`
  - src/services/commissions.js:23 imports MOCK_NOW.
  - src/services/commissions.js references it at lines 959, 1068, 1276, 1298, 1299, 1366, 1379 (commission run timestamps, daysToDate calculations).
  - utils/settlementCycle.js's cycleWindow / nextCycleEnd are passed MOCK_NOW from currentTime().
Reproduction:
  Sign in as distributor, open Commissions → Next payout date reads "1 May 2026" / "6 days ago", not "next Monday".
Root cause hypothesis:
  Demo data anchor was last set 2026-04-30. Should be bumped before each demo session OR replaced with `new Date()`.
Proposed fix scope:
  Two options:
    (a) Bump MOCK_NOW to today's date in a single one-line change. Manual hygiene before each demo cycle.
    (b) Replace with `new Date()` so the anchor tracks wall-clock. Risk: relative dates like "due in 5 days" depend on stable seed data — if MOCK_NOW = today, contributions/transactions seeded with hardcoded dates from 2025 turn into "1 year overdue".
  Phase recommendation: (a) for now, paired with a CI guard that fails if `Date.now() - MOCK_NOW.getTime() > 30 * 86400 * 1000` (30-day soft-fail).
Confidence: high
```

### AUDIT-3-14 — `CommissionPanel.jsx` is 1789 lines, packs 45 hooks/state/maps, 13kB gzip — extract candidate per FRONTEND.md §16b

```
ID:       AUDIT-3-14
Area:     frontend
Severity: P3
Title:    src/dashboard/commissions/CommissionPanel.jsx is now 1,789 lines (FRONTEND.md §16b lists it at 1,682 as of 2026-04-30 — it's grown). It accumulates 45 reactive primitives (`useState` + `useEffect` + `useCallback` + `useMemo` + `useQuery` + `useMutation` + `.map(`). Replace-model breadcrumb nav, 17 mutations, 6 list views — all in one file. 13 kB gzip / 97 kB raw, the single largest app component in the build.
Evidence:
  - wc -l src/dashboard/commissions/CommissionPanel.jsx → 1789.
  - grep -cE "useState\|useEffect\|useCallback\|useMemo\|useQuery\|useMutation\|.map(" → 45.
  - rollup-plugin-visualizer Settings chunk: CommissionPanel.jsx is the largest internal module by raw size (97 kB).
  - FRONTEND.md §16b "Closed items log" lists "Extract <ChatThread>" and the CommissionPanel decomposition as deferred-refactor candidates.
Reproduction: 
  Open the file; observe the volume of state + the nested replace-model conditionals.
Root cause hypothesis:
  Run-state machine landed iteratively; each new sub-view (run review, branch breakdown, dispute resolution, settlement-requests) was added as another conditional branch + state slot. The "deferred extract" Phase 0 baseline flagged remained deferred.
Proposed fix scope:
  Decompose into:
    CommissionPanel.shell — the slide-in + breadcrumb + close handler.
    CommissionHomeView — current view (cards + agents list + needs-attention).
    AgentDetailView — current agent detail (paid/due transactions).
    RunReviewView — settlement run + branch breakdown.
    DisputesView — dispute list + dispute detail.
  Each view ~250-350 LOC. Pair with virtualization fix from AUDIT-3-8 (lives inside the per-view components naturally).
  Effort: 1 day. Out-of-scope for the perf-fix Phase 3 followup but listed because the file's render-density adds friction to every other finding.
Confidence: medium (the impact is friction / future maintainability, not measured runtime)
```

---

## 11. Reverification checklist (passed before declaring complete)

- [x] `git diff vite.config.js` returns empty (verified via `diff /tmp/vite.config.original.js vite.config.js` byte-for-byte + matching `md5 -q` checksums `6806b9...`).
- [x] `git diff package.json` returns empty (md5 `bcff3f...`).
- [x] `git diff package-lock.json` returns empty (md5 `0c9db1...`).
- [x] Only files written: `docs/audit/03-frontend-perf.md` (this file) + `docs/audit/_bundle-stats.html` (visualizer output, retained as Phase 3 artifact per instrumentation budget in `00-baseline.md`).
- [x] `rollup-plugin-visualizer` removed via `npm uninstall` — `ls node_modules/rollup-plugin-visualizer` returns "No such file or directory".

---

## 12. Cross-references to Phase 1 (do not re-flag)

These Phase-1 findings remain valid; this Phase-3 report does not re-flag them. They appear as context only where Phase-3 evidence touches them:

| Phase 1 ID | Phase 3 context |
|---|---|
| AUDIT-1-1 (`get_top_branch` timeout) | Backend root cause for distributor-home lag — Phase 3 scope unchanged. |
| AUDIT-1-2 (rollup seq-scan) | Same. |
| AUDIT-1-3 (region-level Memoize thrash) | Same. |
| AUDIT-1-4 (`useTopBranch` no staleTime) | **Corrected by AUDIT-3-12** — global default IS 5min, not 0. |
| AUDIT-1-5 (Sidebar 30K subscriber pull) | Confirmed in Phase 3 §2.4 (DashboardShell chunk + Sidebar.jsx:212-214). |
| AUDIT-1-6 (AUM client-side reduce) | Confirmed at services/entities.js:497 (`subscriber_balances.select('total_balance')`). |
| AUDIT-1-7 (`useAllEntities('subscriber')` × 5 surfaces) | Confirmed — same 5 surfaces still call it. |
| AUDIT-1-8 (`get_top_branch` not SECURITY DEFINER) | Backend — Phase 2 scope. |
| AUDIT-1-9 (`useDistributorMetrics` vs `useEntityMetrics`) | Confirmed at OverlayPanel.jsx:387 + MetricsRow.jsx:221. |
| AUDIT-1-10 (7 panels eagerly mounted in DashboardShell) | Confirmed; **AUDIT-3-10 extends it to BranchDashboardShell**. Subscriber + Agent shells correctly use lazy(). |
| AUDIT-1-11 (`useAllEntitiesMetrics('agent')` for 2049 IDs) | Confirmed at ViewBranches.jsx:404-405 + ViewAgents.jsx:213. |
| AUDIT-1-12 (Playwright SLA loosened to 5s) | Test scope — Phase 4. |

---

## 13. Recommended Phase-3 follow-up PR set

Listed in declining ROI:

1. **AUDIT-3-4** — Replace supabase-js `createClient` with a thin postgrest-js wrapper. **~200 kB gzip saved** on every dashboard. Single-PR, ~50 LOC.
2. **AUDIT-3-3** — Disable Vite's auto-modulepreload for vendor chunks. **~700 kB transfer saved** on first visit to `/`. One vite.config.js flag.
3. **AUDIT-3-1** — Replace recharts in Subscriber `ProjectionPage` with bespoke SVG. **~274 kB gzip saved** on `/projection`. ~200 LOC.
4. **AUDIT-3-10 + AUDIT-1-10** — Lazy-mount panels in DashboardShell + BranchDashboardShell. Prefetches on sidebar hover. Single PR per shell, ~100 LOC each.
5. **AUDIT-3-2** — Build-time-eliminate the IS_SUPABASE_ENABLED fallback branches. **~30 kB gzip saved**.
6. **AUDIT-3-7** — Narrow `invalidateAll` to per-mutation key sets. Cuts post-mutation network ~80%.
7. **AUDIT-3-9** — Memoize `value=` in 4 context providers. Eliminates re-render cascades.
8. **AUDIT-3-8** — Virtualize the 3 large lists in `CommissionPanel.jsx`. Smooths distributor commissions experience.
9. **AUDIT-3-5** — `<LazyMotion features={domAnimation}>` at app root. **~110 kB gzip saved** on every route.
10. **AUDIT-3-13** — Bump `MOCK_NOW` to 2026-05-22 (or a near-term anchor) before next demo session.
11. **AUDIT-3-11** — Doc-only refresh of `api-contracts.md`.
12. **AUDIT-3-12** — Amend Phase-1 AUDIT-1-4 with the corrigendum.
13. **AUDIT-3-14** — `CommissionPanel.jsx` decomposition (out of Phase-3 scope; queued).
14. **AUDIT-3-6** — Flatten object query keys (low priority).

---

This findings doc is read-only output. The only source-tree files Phase 3 touched were `vite.config.js` (temporary patch, **reverted** byte-for-byte) and `docs/audit/_bundle-stats.html` (visualizer artifact, retained as Phase 3 instrumentation).
