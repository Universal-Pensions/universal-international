> **Agent guide.** Historical audit from 2026-04-30, covering the subscriber, branch-admin, and distributor-admin dashboards (`src/subscriber-dashboard/`, `src/branch-dashboard/`, `src/dashboard/`) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Dashboard Audit — Subscriber, Branch Admin, Distributor Admin

**Date:** 2026-04-30
**Scope:** `src/subscriber-dashboard/`, `src/branch-dashboard/`, `src/dashboard/` (Distributor Admin) + cross-cutting `hooks/`, `services/`, `utils/`, `contexts/`.

This is a deep-level audit of the three live dashboards. Findings are grouped by severity and dashboard, with file:line citations and recommended fixes. Issues marked **P0** are bugs or correctness problems; **P1** are real UX/architecture problems users or future engineers will hit; **P2** are cleanups that pay back over time.

---

## Top 10 things to fix first

1. **P0 — Direct state mutation in `ViewBranches.handleSaveEdit`** (`src/dashboard/branch/ViewBranches.jsx:517-520`). `Object.assign(selectedBranch, updates)` mutates the existing object reference; React doesn't re-render and the underlying mockData is silently mutated. Fix with a proper mutation hook + immutable update.
2. **P0 — Frequency-key drift** across signup → schedule → home widgets. Four different keys (`'half-yearly'`, `'halfYearly'`, `'semi-annually'`, `'semiAnnually'`) coexist, with each consumer handling a different subset. A subscriber whose schedule was saved under one key will show wrong projections in another widget. Normalise to one canonical key + helper in `utils/finance.js`.
3. **P0 — Distributor TopBar filter is non-functional** (`src/dashboard/overlay/TopBar.jsx:67-129`). The filter dropdown sets `filterValue` but no consumer reads it; selecting "Central" does nothing. Either wire it through to `useChildren`/CSV export, or hide until ready.
4. **P0 — Distributor `<main>` is missing `id="main"`** (`src/dashboard/DashboardShell.jsx:211`). The `index.html` skip-to-content link targets `#main`, which lives on the landing page (`App.jsx:61`), Branch (`BranchDashboardShell.jsx:146`), and Subscriber (`SubscriberShell.jsx:13`) — but **not** the Distributor dashboard. Skip link is broken there.
5. **P0 — Profile save is a fake** (`src/subscriber-dashboard/pages/ProfilePage.jsx:38-51`). The button awaits a 600 ms `setTimeout`, then shows "Profile updated" — no service call. Either wire `useUpdateProfile` or downgrade to a "saved locally" message; the current copy lies to the user.
6. **P0 — `MetricsRow` placeholder escape sequence won't render** (`src/dashboard/cards/MetricsRow.jsx:89`). `placeholder="Ask about your data…"` outputs the literal seven characters `…` because JSX attribute strings don't resolve `\u` escapes (this is documented in CLAUDE.md). Use the literal `…` character.
7. **P0 — `HelpPage` claims a human agent will reply but routes to the AI bot** (`src/subscriber-dashboard/pages/HelpPage.jsx:128-130`). Subtitle reads "An agent will reply within ~2 minutes · 8am–8pm" but the chat calls `getSubscriberChatResponse` (AI). Either re-label or implement the human handoff.
8. **P0 — Branch admin seeing all data when `branchId` is missing**. `BranchScopeProvider` accepts `undefined` and downstream components (`useEntityCommissionSummary`, ViewAgents, `BranchHealthScore`) silently fall back to network-wide queries. Add an explicit guard in `BranchDashboardShell` that errors out if `user?.branchId` is missing.
9. **P0 — `window.confirm` for branch (de)activation** (`src/dashboard/branch/ViewBranches.jsx:524`). Native dialog breaks the design language and is non-customisable; activation/deactivation also mutates the entity in place (line 525-526). Replace with a custom confirm modal + a real mutation hook.
10. **P1 — Hardcoded sidebar counts** (`src/dashboard/sidebar/Sidebar.jsx:400, 443, 486`). The submenu shows "310 branches", "2,036 agents", "30,000 subscribers" as static strings. They drift from the real data the rest of the dashboard uses.

---

## Subscriber Dashboard

### Bugs (P0)

1. **`setState`-during-render in seeding logic** — `AgentPage.jsx:57-74`, `HelpPage.jsx:79-88`. Both call `setSeedKey`/`setSeeded` and `setMessages` in the render body. React 19 tolerates this, but in StrictMode it runs twice and produces double messages on first mount. Move into a `useLayoutEffect` keyed by `subId`.
2. **Profile mutation never reaches the service** — `ProfilePage.jsx:42-46` (see top-10 #5).
3. **Frequency mismatch across widgets** — `PulseCard.jsx:37-51`, `ProjectionWidget.jsx:22-36`, `ProjectionPage.jsx:20-34`, `TopUpWidget.jsx:6-15`. Different switch cases for the same concept; if signup writes `'half-yearly'` and a widget only knows `'halfYearly'`, monthly equivalent silently falls back to default `amount`.
4. **`ClaimPage` files never get uploaded** — `ClaimPage.jsx:62-66, 81`. `claimFiles` only stores `{ name, size }` on the client; the actual `File` blobs are dropped on render. The submit hook receives only file names. Either persist the blob or explicitly mark this as documents-deferred-to-OCR.
5. **Help chat in-flight reply continues after navigation away** — `CoPilotWidget.jsx:22-34`, `HelpPage.jsx:98-110`, `AgentPage.jsx:84-96`. Three chat surfaces use `setTimeout` + Promise without an AbortController. Quickly nav-and-return loses the typing indicator state and double-fires `setMessages` on unmounted components in dev.

### UX gaps (P1)

6. **Bottom-tab "More" duplicates "Settings"** — `BottomTabBar.jsx:42-48` and `SideNav.jsx:80-92`. On mobile, Settings is reachable both by Side rail (tablet sizes) and bottom-bar More. The `aside aria-label="Primary"` (line 104) and `nav aria-label="Primary"` (line 81) collide as two "Primary" landmarks announced by screen readers.
7. **`StubPage` for Notifications/Security but Settings sends users there** — `SubscriberDashboardShell.jsx:46-47`, `SettingsPage.jsx:62-84`. The Settings page lists Notifications and Security as first-class items, then both are dead-ends. Either remove from the menu until built or add a "Coming soon" pill on the Settings row itself rather than landing on a stub.
8. **Activity page has no date range, no export, no search** — `ActivityPage.jsx:40-167`. The user can filter by type but cannot scope by month, search by reference, or export the list. The Reports → AllTransactions report has all of this; the duplication makes the activity page feel weak. Consider deleting `ActivityPage` and routing the home widget's "View all" to `/dashboard/reports/all-transactions` instead.
9. **`ProjectionPage` doesn't show a timeline** — `ProjectionPage.jsx`. Compares projected balance at 60 to a goal but never shows the trajectory. A small Recharts area chart over `years` would communicate progress dramatically better.
10. **Goals are hardcoded in UGX** — `ProjectionPage.jsx:12-18` (e.g. UGX 250M for "buy a house"). Hardcoded targets feel arbitrary across regions. Surface them as configurable, or derive from district medians.
11. **`HelpPage` "Talk to an agent" vs "Got an assigned agent? Message them"** — `HelpPage.jsx:163-178, 266-275`. Two CTAs labelled "agent" mean different things. Rename the live-chat to "Live support chat" and reserve "agent" for the assigned human.
12. **Nominees phone validation is inconsistent with Profile** — `NomineesPage.jsx:175` (>= 11 digits including `+256` prefix → ≥ 8 local digits) vs `ProfilePage.jsx:34` (>= 9 local digits). One number could pass profile and fail nominees. Pick one rule.
13. **Insurance cover is upgrade-only** — `InsurancePage.jsx:46`. `tierIsUpgrade` blocks downgrades but offers no path to cancel cover, no "talk to support" affordance. Either allow downgrade-with-confirm or surface a "Cancel cover" link.
14. **No subscriber notifications/reminders surface** — there is no inbox, no missed-contribution alert, no upcoming-due banner. Subscriber's home shows the next contribution in the Top-Up widget but doesn't surface "you missed last month".

### Code duplication (P1/P2)

15. **`monthlyEquivalent` duplicated four times** — `PulseCard.jsx:37-51`, `ProjectionWidget.jsx:22-36`, `ProjectionPage.jsx:20-34`, plus the inverse computation in `SchedulePage.jsx`. Move into `utils/finance.js` alongside a normalised `Frequency` constant set.
16. **`parseAmount` duplicated three times** — `SavePage.jsx:18-22`, `SchedulePage.jsx:25-29`, `WithdrawPage.jsx:26-30`, plus an inline copy in `ClaimPage.jsx:53`. Single `utils/finance.js` export.
17. **`RETIREMENT_AGE = 60` repeated** in PulseCard, ProjectionWidget, ProjectionPage, SchedulePage. One constants file.
18. **`MIN_CONTRIBUTION = 5000` repeated** in SavePage and SchedulePage. Same.
19. **`TX_META` icon-data map duplicated** — `home/widgets/ActivityWidget.jsx:5-10` and `pages/ActivityPage.jsx:8-13`. Same constant copied. Move to `subscriber-dashboard/constants.js` or similar.
20. **Subscriber initials computed inline** — `NomineesPage.jsx:31` and `InsurancePage.jsx:175` duplicate the avatar initial logic. Use `getInitials` from `utils/dashboard.js` (which is already used elsewhere in the same dashboard).
21. **`formatDate(iso)` defined six+ times** with subtle variants (some include year, some don't). One shared util with options.
22. **3 nearly-identical multi-step flows** — SavePage, WithdrawPage, ClaimPage each have form → confirm → success. Extract a `<MultiStepFlow>` shell.

### Accessibility (P1)

23. **`aria-live="polite"` on chat lists with typing indicator inside** — `AgentPage.jsx:196`, `MetricsRow.jsx:61`, `BranchHealthScore.jsx:448`. Each typing-state toggle re-announces the entire list. Wrap typing indicator outside the live region or use `aria-live` on a sibling.
24. **`aria-labelledby` pointing to a heading on a textarea** — `ClaimPage.jsx:270, 278`. Works, but a real `<label>` with a `for` is more compatible.
25. **Animated pulse ring around chat field** — `BranchHealthScore.jsx:480-509`. Decorative motion that loops infinitely until first focus. CLAUDE.md says "Avoid: random decorative animations". Tone down or remove.
26. **PulseCard `aria-live="polite"` on the count-up balance** — `PulseCard.jsx:146`. Every animation frame fires a re-render; some screen readers will announce intermediate values. Mark `aria-atomic="true"` and only update when the count completes, or make the live region static.

### Architecture (P1)

27. **`SubscriberDashboardShell` wraps in `<DashboardProvider>` it never uses** — `SubscriberDashboardShell.jsx:26`. The provider exposes drill-down nav + 8+ panel toggles for distributor/branch admin; subscriber doesn't need any of it. Wraps but doesn't consume → wasted re-renders.
28. **Subscriber Reports import distributor's `ReportTable` and `FilterSelect`** — `reports/views/AllTransactions.jsx:5-6`. Cross-dashboard import is convenient short-term but binds subscriber UX to whatever the distributor's report styling does. Move shared report primitives to `src/components/reports/` and have both dashboards import from there.
29. **AnnualStatement uses inline styles** — `AnnualStatement.jsx:82-99, 122-145, 152-162`. All other report views use CSS modules. Inconsistent.

---

## Branch Admin Dashboard

### Bugs (P0)

30. **Branch admin guard happens after data fetch** — `BranchDashboardShell.jsx:158-162`. `useState` and `useAuth` run, then `if (role !== 'branch') return Navigate(...)`. That's fine for hooks-after-conditional-return rules (the conditional is after hooks), but `BranchScopeProvider(branchId)` will receive `undefined` if `branchId` was never set on a branch user. Hard-fail with an error rather than silently widen scope.
31. **Defensive role check duplicates routing logic** — App.jsx:152-153 already routes branch role to `BranchDashboardShell`. The shell's `Navigate` to `/dashboard` if `role !== 'branch'` is fine, but if it ever fires it creates a loop because `App.jsx` will route back. Make the redirect target `/coming-soon` or `/` instead.
32. **`generateActivity` randomises timestamps every render** — `BranchHealthScore.jsx:132-142`. Memoised on `agents`, but on any agent metric change all "recent" timestamps shuffle. The "Live" badge sells this as real-time; it's not. Either feed real activity or label the section "Today's snapshot".
33. **`computeAlerts` renders a "Declining" count from a dubious formula** — `BranchHealthScore.jsx:166-169`: `((mc[10]-mc[11])/(mc[10]||1))*totalSubs*0.3`. Rounds to a count of "subscribers" with no real grounding. Replace with a real metric or remove the alert.

### UX gaps (P1)

34. **Two mobile menus exist** — `BranchDashboardShell.jsx:30-141` (top-right hamburger drawer) **and** `BranchSidebar.jsx:312-401` (bottom tab bar with "More"). User has two entry points to the same panels and two sets of labels. Pick one (the bottom bar is more discoverable).
35. **No real "branch info" surface** — Branch admin can edit *their own* profile via Settings (which is the distributor's Settings panel). They cannot edit branch hours, address, primary contact, or operating status. The Edit Branch flow lives in `ViewBranches` and is for distributors editing other branches; a branch admin viewing their *own* branch detail should be able to update branch contact info.
36. **No agent action items** — leaderboard shows ranks but offers no "remind agent", "reassign subscribers", "send broadcast SMS". Operations live entirely in CommissionPanel.
37. **`UG flag` emoji** — `agent/CreateAgent.jsx:308`, `Settings.jsx:323`. CLAUDE.md explicitly forbids emojis. Replace with an SVG flag from `Icons.jsx` or just the country code.
38. **Single-step "Agent" submenu on desktop sidebar** — `BranchSidebar.jsx:246-280`. The popover offers "Create New Agent" / "View Existing Agents". Two items wrapped in a popover is friction; make Agents a direct click that opens ViewAgents, with a "+" button inside that opens CreateAgent.
39. **`BranchHealthScore.jsx` is 522 lines** doing six concerns at once: derive metrics, compute score, compute alerts, generate activity, generate insights, render gauge + chat. Decompose into `useBranchHealth()` hook + `<ScoreGauge>`, `<HealthAlerts>`, `<HealthCopilot>` files.

### Architecture (P1)

40. **`PANEL_PADDING` magic numbers** — `BranchOverview.jsx:14-20`. The overview reflows by hardcoding each panel's width + 48 px gap. If panel widths change, the overview re-paints awkwardly. Have panels publish their width via context or CSS variable.
41. **`useEffect(() => setCopilotOpen(split), [split])`** — `BranchHealthScore.jsx:232-234`. Auto-opens the chat any time the split state changes; if user explicitly closed it, it forces back open. Track `userToggledCopilot` and respect their choice.
42. **Sidebar's outside-click handler races** — `BranchSidebar.jsx:144-150`. `document.addEventListener('click', closeMore)` triggers on every click, including the trigger button itself. The grace period dance in `Sidebar.jsx:222-241` is the same pattern more developed. Use `mousedown` and `event.stopPropagation()` consistently.

### Visual consistency (P2)

43. **`OperationsSection` doesn't reuse `Demographics.jsx`** — re-implements gender bars + age bars inline (`OperationsSection.jsx:259-298`). CLAUDE.md tells you to reuse the shared component.
44. **Inline `MEDAL_COLORS`/`AGE_COLORS` arrays** — `OperationsSection.jsx:14-16`. Tokens already exist in `index.css` (`--color-medal-gold`, etc.). Use CSS data attributes (`data-rank="1"`) for the rank colour instead of inline `style={{ background }}`.

---

## Distributor Admin Dashboard

### Bugs (P0)

45. **TopBar filter is non-functional** (top-10 #3) — `TopBar.jsx:67-128`.
46. **Skip-link target missing on `<main>`** (top-10 #4) — `DashboardShell.jsx:207-218`. Also note: the wrapping element is a `<div>`, not a `<main>` — semantic regression.
47. **Hardcoded counts in submenus** (top-10 #10) — `Sidebar.jsx:400, 443, 486`.
48. **Direct entity mutation on save / status toggle** (top-10 #1) — `ViewBranches.jsx:517-527`.
49. **`window.confirm` for deactivation** (top-10 #9) — `ViewBranches.jsx:524`.
50. **`MetricsRow` chat placeholder Unicode escape bug** (top-10 #6) — `MetricsRow.jsx:89`.
51. **`OverlayPanel` animates the `left` CSS property** — `OverlayPanel.jsx:382-389`. `left` is not GPU-accelerated and will repaint on each frame. The map in the background is heavy. Use `transform: translateX(...)` via Framer's `x` only and let CSS handle layout.
52. **`UgandaMap` partial-load bug** — `UgandaMap.jsx:88-97`. Two `fetch` calls run independently; the error fallback only renders when *both* fail and *neither* loaded. If districts loads but regions fails (or vice versa), the map renders broken with no error UI.
53. **`UgandaMap` interactive without aria-label or keyboard nav** — `UgandaMap.jsx:332-345`. Map is the primary navigation device but unreachable for keyboard/screen-reader users; OverlayPanel does have a search, but the map itself has no aria description. Add `role="application" aria-label="Uganda regions map. Use search to navigate."` to the container.

### UX gaps (P1)

54. **Single-item Subscriber submenu** — `Sidebar.jsx:182-194` (`SUBSCRIBER_SUB`). One option ("View Existing Subscribers") wrapped in a popover. Same critique as Branch sidebar: just open the panel directly.
55. **No way to download subscribers/transactions across the network** — `TopBar.jsx` only exports children of the current entity. To get all subscribers, the user must drill into reports. Add a top-level "Export" entry that uses the same code path as ReportsHub.
56. **Reports panel and main reports flow are duplicated** — every overlay metric tile opens the slide-in `ViewReports`, but `ReportsHub` re-implements the index card grid that the overlay's clickable rows already approximate. Choose one navigation model.
57. **`OperationsSection` (used by Branch) and `MetricsRow` (used by Distributor) both implement an AI chat** — different copy, different shape, slightly different SUGGESTIONS list. Three chats in `BranchHealthScore.jsx`, `MetricsRow.jsx`, `CoPilotWidget.jsx`, `AgentPage.jsx`, `HelpPage.jsx`. Five separate chat implementations. Extract `<ChatThread service={...} suggestions={...} />`.
58. **Map has no legend** — region colours are the visual differentiator but never named. New users guessing what "indigo vs teal" means.
59. **No "back to overview" button on map after drilling deep** — only the breadcrumb supports it. A persistent home-shaped icon overlay would help.

### Code duplication (P1)

60. **`ViewBranches.jsx` (908 LoC) and `ViewAgents.jsx` (593 LoC)** are 80 % structural duplicates: header, search input, region filter dropdown, sort dropdown, status chips, summary strip, virtualised list, detail view, escape-to-close, outside-click handlers. Extract a generic `<EntityListPanel entityType="branch|agent" />`.
61. **Per-panel `Icons` constants** — `CommissionPanel.jsx:27-78` defines its own `Icons` even though `src/dashboard/shared/Icons.jsx` exists. Same for inline SVGs in BranchSidebar/Sidebar/SubscriberShell SideNav.
62. **`useState(new Set())` and `useState(() => new Set())` mixed** — `CommissionPanel.jsx:109` creates a fresh Set on every render before useState's lazy init kicks in (works once, then ignored). Use the lazy form everywhere: `useState(() => new Set())`.
63. **CSV export buttons re-implemented per report view** — every subscriber report view inlines its own export icon + handler (`AllTransactions.jsx:120-148`, `ContributionsSummary.jsx:43-64`, etc.). The distributor's `TopBar` already does CSV export. Build a single `<ExportButton onExport={fn} />`.
64. **Region/district name lookup helpers duplicated** — `ViewBranches.jsx:23-30` and `ViewAgents.jsx:19-33`. Same logic.

### Architecture (P1)

65. **Outside-click handlers everywhere** — every dropdown, popover, submenu has its own document-level click listener (12+ in this dashboard alone). Extract a `useOutsideClick(ref, handler)` hook.
66. **`setState`-during-render pattern** — `OverlayPanel.jsx:367-372`, `TopBar.jsx:74-80`, `Settings.jsx:103-116`, `Sidebar.jsx:228-241`. Comment notes it's intentional, but it's a brittle workaround for "reset state when prop X changes". A `useSyncExternalStore` or keyed `<Component key={navKey}>` is cleaner.
67. **`Sidebar.jsx` has 20-field `useDashboard` destructure on one line** — line 201. Hard to read, hard to refactor. Pull the panel-toggle calls into a local helper.

### Accessibility (P1)

68. **`Breadcrumb` uses `aria-live="polite"`** — `Breadcrumb.jsx:12`. Each drill-down announces every crumb. Replace with `aria-current="page"` on the last crumb only.
69. **Map tooltips inject HTML** — `UgandaMap.jsx:281-289`. Hardcoded but if a future field comes from data and contains `<script>`, this is XSS. Sanitise or use Leaflet's text-only tooltip.
70. **`role="status"` paired with `aria-live="assertive"`** — `DashboardShell.jsx:188-189`. `role="status"` already implies polite; assertive overrides too aggressively. Use plain `aria-live="polite"`.

---

## Cross-cutting (all three dashboards)

### Architecture-level

71. **Three sidebar components, three header components, three drawer components** — `dashboard/sidebar/Sidebar.jsx`, `branch-dashboard/sidebar/BranchSidebar.jsx`, `subscriber-dashboard/shell/{SideNav,BottomTabBar,PageHeader}.jsx`. They share the same icon set, hover-tooltip pattern, mobile bottom-bar, and "More" popover. Extract a `<RoleSidebar items={...} />` driven by config.
72. **Five distinct chat implementations** — see #57. Build `<ChatThread />` and parameterise the service.
73. **Three "Recent activity" surfaces** — Subscriber `ActivityWidget`, Branch `BranchHealthScore` activity feed, Distributor's "live" mock data. None share code. Pick one component, parameterise.
74. **`getInitials` is shared but inline copies appear in NomineesPage, InsurancePage, OperationsSection** — see subscriber #20.
75. **Settings vs SettingsPage vs ProfilePage** — Distributor & Branch share the slide-in `Settings.jsx`; Subscriber has its own routed `SettingsPage.jsx` + `ProfilePage.jsx`. Same form fields, three implementations. Pick one.

### Constants & utilities

76. **Frequency normalisation** — see top-10 #2. Add to `utils/finance.js`:
    ```js
    export const FREQUENCY = {
      WEEKLY: 'weekly', MONTHLY: 'monthly', QUARTERLY: 'quarterly',
      HALF_YEARLY: 'half-yearly', ANNUALLY: 'annually',
    };
    export function monthlyEquivalent(schedule) { /* one source */ }
    export function periodsPerYear(frequency) { /* one source */ }
    ```
77. **`RETIREMENT_AGE`, `START_AGE`, `MIN_CONTRIBUTION`, `MIN_WITHDRAW`, `INSURANCE_PREMIUM_MONTHLY`, `INSURANCE_COVER`** — all hard-coded across files. Move to `constants/` or environment config.

### Design system drift

78. **Inline styles** in: `AnnualStatement.jsx`, `UgandaMap.jsx` error fallback, `ViewSubscribers.jsx` detail (capitalisation, tabular nums, color), `ViewAgents.jsx` commission rows. CLAUDE.md mandates CSS modules.
79. **Emojis in production UI** — UG flag in CreateAgent (line 308) and Settings (line 323). CLAUDE.md: "Never emojis".
80. **`tabular-nums` repeatedly inlined** instead of being a `.tabular` utility class.
81. **`React` imported explicitly** for `<React.Fragment>` in CreateBranch, CreateAgent — could just use `<>`.

### State management

82. **`setState`-during-render pattern repeated 5+ times** — see #66, plus `AgentPage.jsx`, `HelpPage.jsx`. Pattern works in React 19 but is brittle in StrictMode and confuses static analysis. Replace with `useSyncExternalStore` for derived state from props/URL, or keyed components.
83. **No React Query mutation for many writes** — Profile (subscriber), Settings (distributor), branch deactivation all skip the data layer. CLAUDE.md says only services may import mockData; these write paths bypass that rule.

### Performance

84. **Five unique `useEffect` outside-click patterns** — across Sidebar, BranchSidebar, BottomTabBar, OverlayPanel's GlobalSearch, ViewBranches/ViewAgents/CommissionPanel filter dropdowns, TopBar. All listen on `document` and run on every click. Extract a `useOutsideClick` hook *and* unify them via the polyfill from React Aria's `useInteractOutside` if the team is open to a small dep.
85. **Heavy framer animations on background-mounted panels** — when ViewBranches is closed, it still mounts (`viewBranchesOpen && <motion.div />` inside `<AnimatePresence>` is fine) but holds the entire 30k-subscriber filter pipeline in memory because the `useAllEntities('subscriber')` hooks above run regardless. Consider `viewBranchesOpen ? <ViewBranches/> : null` so the data hooks only mount when needed.
86. **`MetricsRow.jsx` chat is mounted on every overview** — even when not used, it makes the chat ref + 50+ KB of motion config live. Lazy-render on first open.

---

## Recommended next steps (in order)

1. **Fix the 10 P0 bugs** above. None require redesigns; all are localised.
2. **Normalise frequency keys & extract `monthlyEquivalent`** — single biggest correctness fix; touches 4 files.
3. **Extract `<EntityListPanel>`** — collapses ViewBranches + ViewAgents from ~1500 LoC to ~600 LoC and the future ViewSubscribers/ViewEmployers panels become trivial.
4. **Extract `<ChatThread>`** — collapses 5 chat implementations.
5. **Build a `useOutsideClick` and a `<RoleSidebar>` config-driven component** — solves consistency across the three sidebars and removes ~12 useEffect outside-click duplicates.
6. **Wire profile/settings mutations** through real React Query hooks; stop the fake-success toasts.
7. **Subscriber dashboard cleanup** — drop `<DashboardProvider>` from `SubscriberDashboardShell`, build a thin `<SubscriberStateProvider>` if needed, decide ActivityPage vs Reports.
8. **Branch dashboard decomposition** — split `BranchHealthScore.jsx` into a hook + 4 child components; remove the duplicate mobile menu.

---

## Out of scope but worth noting

- **CSV exports leak raw IDs** in some reports (`r.metrics.totalSubscribers || 0`) — fine for distributor admin, but if the same shape is reused for branch admin exports, branchScope filtering needs to apply to the CSV too.
- **Mock data is mutated in place** by ViewBranches deactivation. Future React Query refetches won't see the mutation; client and server will silently desync once a backend lands.
- **No telemetry / analytics events** — every dashboard is rich with click handlers but nothing is reported. Wire `track(eventName, payload)` into a thin wrapper from the start so backend integration doesn't require a sweep.
