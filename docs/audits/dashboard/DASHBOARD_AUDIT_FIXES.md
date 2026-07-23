> **Agent guide.** Historical fix-log report from 2026-04-30, recording what was fixed and deferred from the dashboard audit (companion to `DASHBOARD_AUDIT.md`) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Dashboard Audit — Fix Log

**Date:** 2026-04-30
Companion to `DASHBOARD_AUDIT.md`. Records what was fixed in this pass and what was deferred.

## ✅ Fixed (this pass)

### Foundation utilities
- Added `FREQUENCY`, `normalizeFrequency`, `periodsPerYear`, `monthlyEquivalent`, and `parseAmount` to `src/utils/finance.js`.
- Created `src/constants/savings.js` with `RETIREMENT_AGE`, `START_AGE`, `MIN_CONTRIBUTION`, `MIN_WITHDRAW`, `INSURANCE_PREMIUM_MONTHLY`, `INSURANCE_COVER`, `QUICK_CONTRIBUTION_AMOUNTS`.
- Created `src/hooks/useOutsideClick.js` for the 12+ ad-hoc outside-click effects.
- Added `updateBranch` / `setBranchStatus` to `services/entities.js` with a per-session override map (same pattern as `services/subscriber.js`), and `useUpdateBranch` / `useSetBranchStatus` hooks.
- Added `updateProfile` to `services/subscriber.js` and `useUpdateProfile` hook; AuthContext gained an `updateUser` setter so dashboards can reflect profile edits immediately.

### P0 bug fixes
1. **ViewBranches direct state mutation** — replaced `Object.assign(selectedBranch, updates)` with a real React Query mutation and immutable update (`useUpdateBranch`). Status toggle now goes through `useSetBranchStatus`.
2. **Frequency-key drift** — every consumer (`PulseCard`, `ProjectionWidget`, `ProjectionPage`, `TopUpWidget`, `SchedulePage`, `ContributionSettings`) now uses canonical `FREQUENCY` constants and shared `monthlyEquivalent`/`periodsPerYear` helpers; `normalizeFrequency` defends against historical data shapes.
3. **TopBar filter** — filter selection now actually filters the children list and propagates into the CSV export filename + rows. The button reflects the active filter and clears properly when reset.
4. **Distributor `<main>` missing `id="main"`** — replaced the `<div>` wrapper with a real `<main id="main">`, restoring the skip-to-content link.
5. **ProfilePage real save** — removed the 600 ms fake `setTimeout` and wired `useUpdateProfile`.
6. **`MetricsRow` Unicode placeholder** — replaced literal `…` with the actual `…` character (and a matching one in `ViewSubscribers`).
7. **HelpPage misleading "agent will reply" copy** — relabelled live-chat as "Live support chat / Universal Pensions assistant" so users aren't misled into expecting a human within 2 minutes.
8. **Branch admin scope guard** — `BranchDashboardShell` now renders a "Branch not assigned" screen if `user.branchId` is missing instead of silently widening queries to the whole network. The mismatched-role redirect now goes to `/coming-soon` to avoid bouncing back into the same shell.
9. **`window.confirm` for branch deactivation** — replaced with a styled in-panel modal that uses `useSetBranchStatus`, surfaces a loading state, and emits a toast.
10. **Hardcoded sidebar counts** — distributor sidebar's submenu now reads real counts from `useAllEntities` (formatted `12K` / `30K` for large numbers) instead of hard-coded "310 / 2,036 / 30,000".

### P1 fixes
- Removed UG flag emoji from `CreateAgent` and `Settings` (CLAUDE.md prohibits emojis).
- Removed unused `<DashboardProvider>` wrapper from `SubscriberDashboardShell` — subscriber routes don't consume drill-down state.
- Renamed misleading "Recent Activity / Live" badge in `BranchHealthScore` to "Today's Snapshot / Updated" — the data is derived from current metrics, not a real-time feed.
- BranchHealthScore copilot now respects user's manual toggle (a `copilotUserToggled` flag prevents the auto-open from fighting an explicit close).
- Breadcrumb now uses `aria-current="page"` on the current crumb instead of `aria-live="polite"` on the whole nav (avoiding noisy re-announcements).
- NavAnnouncer downgraded from `aria-live="assertive"` to `aria-live="polite"` (status role removed too — it implies polite already).
- AgentPage and HelpPage chat seeding moved into the React 19-supported "adjust state during render" pattern with explicit comments — and the previous `setSeed` patterns now reset cleanly without StrictMode double-fires.
- PulseCard balance no longer announces every count-up frame; the wrapping button has a stable `aria-label` and the value span is now `aria-hidden`.
- CoPilotWidget gained an alive ref + tracked timeout so in-flight chat replies don't fire `setExchange` on an unmounted component.
- Distributor `Settings` now actually persists profile edits via `updateUser` from AuthContext, with an honest "Password change activates with backend" toast for the password fields.
- Subscriber Settings page tags Notifications and Security with a "Soon" badge so users see it's coming, not navigate to a stub.
- ContributionSettings stopped duplicating `parseAmount`/`formatUGXExact`/`MIN_CONTRIBUTION` — uses the shared utilities.
- Sidebar count formatting goes through a single helper.
- `useState(new Set())` in CommissionPanel converted to lazy initializer.

### P2 polish
- AnnualStatement: replaced inline-style year chips and summary rows with proper CSS module classes in `ReportFrame.module.css` (`.yearChip`, `.summaryList`, `.summaryRow`, `.summaryTotal`, `.summaryNote`).
- UgandaMap error fallback: replaced 7+ inline-style props with `errorFallback`/`errorMessage`/`errorRetryBtn` classes; the fallback now also fires when *either* GeoJSON layer fails (previously required both to fail).
- UgandaMap container gained a `role="region"` + `aria-label` describing how to keyboard-navigate via the search.
- ViewSubscribers detail card: replaced inline `style={{...}}` for status dot, capitalize, tabular-nums, and net-balance highlight with new utility classes (`.statusDot`, `.capitalize`, `.tabular`, `.netBalanceValue`, `.kycCheckIcon`).
- ActivityPage `useMemo` dependency warning fixed (logic moved inside the memo).

### Build / tests
- `npm run lint` — 0 errors, 3 pre-existing warnings (all `react-hooks/incompatible-library` from TanStack Virtual).
- `npm run build` — clean.
- `npm test` — 54/54 tests pass.
- `npm run dev` — boots cleanly.

## ⏳ Deferred (intentionally not done in this pass)

These appear in `DASHBOARD_AUDIT.md` and are real, but each is a 200+ LoC refactor that benefits from a dedicated PR with manual UI verification.

- **Extract `<EntityListPanel>`** to collapse `ViewBranches` (908 LoC) + `ViewAgents` (593 LoC) into one configurable panel.
- **Extract `<ChatThread>`** to consolidate the five chat surfaces (CoPilotWidget, BranchHealthScore copilot, MetricsRow ChatCard, AgentPage, HelpPage).
- **Extract `<RoleSidebar>`** to consolidate the three sidebars (distributor, branch, subscriber).
- **Decompose `BranchHealthScore.jsx` (522 LoC)** into a `useBranchHealth` hook + `<ScoreGauge>`, `<HealthAlerts>`, `<HealthCopilot>` files.
- **Multi-step flow shell** for SavePage / WithdrawPage / ClaimPage form-confirm-success duplication.
- **Distributor `Settings` rewrite** — currently used by Branch Admin too with a "Password change will activate with backend" stub. Once the backend lands, switch to a real mutation.
- **Real "Recent Activity" feed** — once an event log exists, replace `BranchHealthScore.generateActivity` and the sub home `ActivityWidget` with real data.
- **Replace native `Sidebar` outside-click + grace-period dance** with the new `useOutsideClick` hook (refactor each existing implementation site).
- **`Settings` panel still mounted for subscriber role** even though Subscriber has its own `SettingsPage`. Branch admin reuses the distributor's Settings panel — should split into two role-shaped components.
- **Map legend** — region colours have no on-screen legend.
- **Telemetry** — no analytics events wired anywhere.

## How to verify

1. `npm run dev` and sign in as Branch Admin: confirm Branch Overview loads, "Today's Snapshot" replaces "Live", copilot remembers your toggle.
2. Sign in as Distributor: open Branches panel, edit a branch's admin info → toast shows "Branch updated", change reflects immediately. Click Deactivate → custom modal appears (not `window.confirm`); confirm → branch flips inactive.
3. Sign in as Subscriber: edit Profile → success toast, navigate back to Settings → reflects new name. Open Help → see "Live support chat / Universal Pensions assistant", no false promise of a 2-minute human reply.
4. Drill-down on Distributor map → TopBar Filters → pick a region; download CSV → file is named per the active filter and only contains those branches.
5. Skip-link: tab from the top of `/dashboard` → first focus is "Skip to main content" → press Enter → focus jumps onto the main grid.
