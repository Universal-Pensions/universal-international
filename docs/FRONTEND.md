> **Agent guide.** The deep frontend reference for this codebase (React/Vite/CSS-Modules/Framer/Router/TanStack) — open it when you're touching components, hooks, services, contexts, dashboard shells, or design tokens and need file-level "how it actually works" detail. Read `CLAUDE.md` first for the binding rules; come here for the map of `src/`. Per repo discipline (`CLAUDE.md` §11), update this doc in the same change whenever you add a service, hook, route, context, or dashboard variant.

# FRONTEND.md — Universal Pensions Uganda

Deep frontend reference for the React 19 + Vite 6 + CSS Modules + Framer Motion + React Router 7 + TanStack Query 5 codebase. This is a **demo / sales-presentation tool**, not a production fintech — demo-scope behaviours (mocked OTP, mocked KYC, `VITE_USE_SUPABASE` fallback, per-session mutation stores, `MOCK_NOW`, hardcoded UGX 1,000 unit price, 24h JWT) are intentional.

See `CLAUDE.md` for the slim entry index, `BACKEND.md` for SQL/RPC/RLS detail, and `docs/*` for the role × capability matrix and field-level data model.

---

## Index

- [§1 — Stack, entry points & build](#1-stack-entry-points--build)
- [§2 — Routing rules](#2-routing-rules)
- [§3 — Hard rules (anti-patterns)](#3-hard-rules-anti-patterns)
- [§4 — Three-layer data access + hook → service boundary](#4-three-layer-data-access--hook--service-boundary)
- [§5 — Services inventory](#5-services-inventory-srcservices--11-files)
- [§6 — Contexts inventory](#6-contexts-inventory-8-in-srccontexts-1-in-srcsignup)
- [§7 — Hooks inventory](#7-hooks-inventory-srchooks--9-files)
- [§8 — Canonical optimistic-mutation pattern](#8-canonical-optimistic-mutation-pattern-useentity-template)
- [§9 — Per-role dashboard variants](#9-per-role-dashboard-variants--5-built)
- [§10 — Commission UI patterns](#10-commission-ui-patterns)
- [§11 — Signup / KYC flow](#11-signup--kyc-flow)
- [§12 — Modal & drawer primitives, accessibility](#12-modal--drawer-primitives-accessibility)
- [§13 — CoPilotWidget convention (intentional duplication)](#13-copilotwidget-convention-intentional-duplication)
- [§14 — Performance posture](#14-performance-posture)
- [§15 — Shared utilities, constants & component subdirs](#15-shared-utilities-constants--component-subdirs)
- [§16 — Design tokens, brand palette, animation](#16-design-tokens-brand-palette--animation)
- [§16a — Demo scope (by design — do NOT "fix")](#16a-demo-scope-by-design--do-not-fix)
- [§16b — Real bugs / cleanups (residual)](#16b-real-bugs--cleanups-residual)
- [§17 — Testing layout](#17-testing-layout)
- [§18 — CSV export](#18-csv-export)
- [§19 — Product & brand context](#19-product--brand-context)

---

## 1. Stack, entry points & build

**Stack:** React 19.2 · Vite 6.3 · Framer Motion 12 · React Router 7 · TanStack Query 5 · TanStack Virtual 3 · Leaflet 1.9 / react-leaflet 5 · Recharts 3 · Vitest 4. Node 22 LTS pinned via `.node-version`. npm with `legacy-peer-deps=true`.

**npm scripts** (`package.json`):

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on `:5173` (frontend only, mock fallback if backend off) |
| `npm run dev:api` | Express backend on `:3001` (`tsx watch server/index.ts`). Pair with `npm run dev` in another terminal, or run `npm run dev:all` for both |
| `npm run dev:all` | Both servers in one terminal via `concurrently` |
| `npm run build:api` | `tsc -p server/tsconfig.json` — also runs in CI before Playwright |
| `npm run build` | Production Vite build |
| `npm run preview` | Serve the built bundle |
| `npm run lint` | ESLint 9 flat config |
| `npm test` | Vitest one-shot (1221 tests across 76 files at last sync) |
| `npm run test:watch` | Vitest watch |
| `npm run test:coverage` | Vitest + v8 coverage — requires `npm i -D @vitest/coverage-v8` (currently NOT installed, see §17) |
| `npm run test:e2e` | Playwright suite (`:smoke`, `:flows`, `:headed`, `:ui`) — see `.claude/skills/qa.md` |
| `npm run seed` | Seed Supabase via `scripts/seed-supabase.mjs` (see BACKEND.md §14) |

**`vite.config.js` highlights:**

- Path aliases: `@` → `./src` is the only one used in source. The five additional aliases (`@components`, `@contexts`, `@dashboard`, `@data`, `@utils`) are declared but never imported — known low-priority cruft (§16b).
- **Manual vendor chunks** (see `manualChunks` in `vite.config.js`):
  - `vendor-leaflet` — `/leaflet`, `react-leaflet`, `@react-leaflet/core`
  - `vendor-charts` — `/recharts`, `/d3-`
  - `vendor-motion` — `/framer-motion`, `/motion-utils`, `/motion-dom`
  - `vendor-tanstack` — `@tanstack/*`
  - `vendor-router` — `/react-router`, `/@remix-run`
  - `vendor-react` — `react`, `react-dom`, `scheduler`, `use-sync-external-store`, `object-assign`, `js-tokens`, `loose-envify` (kept together to prevent `forwardRef` undefined errors after hash shifts)
  - `vendor-xlsx` — `xlsx` (SheetJS); only pulled when the settlement template is downloaded/uploaded (lazy-imported by `src/utils/xlsx.js`)
  - Fallthrough `vendor` for everything else
- `chunkSizeWarningLimit: 700` (kB) — headroom for recharts/leaflet routes.
- `build.sourcemap: 'hidden'` (BL-29 / H-5) — emits `.map` files to `dist/assets/` **without** the trailing `//# sourceMappingURL=` comment, so the shipped bundle stays minified to end users (no source leak in devtools) while the maps remain on disk for a future symbolication step. **There is intentionally no `@sentry/vite-plugin` upload wired.** This is a demo platform, so the frontend Sentry init in `src/main.jsx` is **best-effort**: when `VITE_SENTRY_DSN` is set, captured frontend stack frames are **minified** (`index-abc123.js:1:48211`) unless these maps are manually uploaded to the Sentry release. The PII scrubber + `release`/`environment` tags (BL-26) are wired; only symbolication is deferred. The backend `@sentry/node` traces (`server/index.ts`) are unaffected — Node runs the unminified `dist-server/` output.
- Vitest block embedded in the same config: `globals: true`, `environment: 'jsdom'`, `setupFiles: './src/test/setup.js'`, CSS modules use `classNameStrategy: 'non-scoped'`, `exclude: ['node_modules', 'dist', 'e2e/**']`.

**No Tailwind.** All styling is CSS Modules (`.module.css` per component, 118 files). Global design tokens live in `src/index.css`; no component-library imports.

**Boot path.** `src/main.jsx` mounts a React 19 root with this provider order:

| Wrapper | Purpose |
| --- | --- |
| `StrictMode` | Double-invokes effects in dev to surface bugs |
| `BrowserRouter` | URL routing (React Router 7) |
| `QueryClientProvider` | Single TanStack Query client (defaults below) |
| `AuthProvider` | Reads `upensions_auth` from localStorage; listens to `onAuthExpired` |
| `ToastProvider` | Toast queue (max 3 visible, auto-dismiss) |
| `MotionConfig reducedMotion="user"` | Respects `prefers-reduced-motion` |
| `<App />` + `<ToastContainer />` | App tree, toast portal renders as a peer |

`SignInProvider` wraps `<Routes>` **inside** `App` so `SignInModal` overlays any page.

**React Query defaults** (set in `main.jsx`):

| Option | Value |
| --- | --- |
| `staleTime` | 5 min |
| `gcTime` | 10 min |
| `refetchOnWindowFocus` | `false` |
| `retry` | 1 |

**File layout (one screen):**

```
src/
  App.jsx, main.jsx, index.css
  assets/                         Logo PNGs (transparent)
  config/env.js                   API_BASE_URL, IS_DEV/PROD, public URLs
  constants/                      levels.js, savings.js, signup.js
  data/                           mockData (1034 lines), mockBranchDefs, mockGeo
  data/                           …, employerSeed (employer demo seed)
  services/                       api, supabaseClient, auth, entities,
                                  commissions, notifications, subscriber, agent,
                                  employer, kyc, chat, search, contact, tickets
                                  + __tests__/
  hooks/                          incl. useCommission, useNotifications,
                                  useSubscriber, useAgent, useEntity, useTickets,
                                  useEmployer + __tests__/
  contexts/                       10 contexts (incl. EmployerScope/EmployerPanel);
                                  SignupContext lives in src/signup/
  utils/                          finance, currency, date, dashboard, csv,
                                  csvDownload, phone, navigation, motion, xlsx,
                                  settlement, commissionMonths, memberId, policies
                                  + __tests__/ (settlementCycle removed in 0029)
  components/                     Landing + shell-level (Navbar, Hero, Footer,
                                  SignInModal, Modal, Toast, ErrorBoundary,
                                  SkeletonRow, EmptyState, …) +
                                  contribution/, signin/, reports/, feedback/
  pages/                          About, FAQ, Contact (marketing pages)
  signup/                         Subscriber KYC flow: SignupPage, SignupShell,
                                  SignupContext, signupState, steps/, contribution/
  dashboard/                      DISTRIBUTOR ADMIN (DashboardShell)
  branch-dashboard/               BRANCH ADMIN (BranchDashboardShell)
  agent-dashboard/                AGENT (AgentDashboardShell, routed pages)
  subscriber-dashboard/           SUBSCRIBER (SubscriberDashboardShell,
                                  SubscriberPanelContext, routed pages)
  employer-dashboard/             EMPLOYER (EmployerDashboardShell, hero +
                                  panels, desktop-first mirroring branch)
  admin-dashboard/                ADMIN (AdminDashboardShell — reuses the
                                  distributor map/panels + Distributors &
                                  Employers managers; AdminPanelContext)
  test/                           setup.js, supabaseMock.js, jwt-claim-contract.test.js
```

---

## 2. Routing rules

**Top-level routes (`src/App.jsx`):**

| Path | Element | Notes |
| --- | --- | --- |
| `/` | `LandingPage` | Navbar + Hero + HowItWorks + TimeJourney + ForYou + Trust + CTA + Footer + StickyMobileCTA |
| `/about` | `pages/About.jsx` | Marketing |
| `/faq` | `pages/FAQ.jsx` | Marketing |
| `/contact` | `pages/Contact.jsx` | Posts to `services/contact.js` → `/api/contact` |
| `/signup/*` | `signup/SignupPage` (lazy) | KYC flow + contribution sub-flow |
| `/dashboard/*` | `ProtectedDashboard` (lazy) | Dispatches by role |
| `/coming-soon` | `ComingSoon` | Fallback placeholder for any future unbuilt role (all 6 roles now build) |

**`SignInModal`** renders outside `<Routes>` (inside `SignInProvider`) so it can overlay any page.

**`ProtectedDashboard` dispatch:** unauthenticated → `Navigate to="/"`; `hasDashboard(role)` false → `/coming-soon`; otherwise pick a shell:

| Role | Shell file |
| --- | --- |
| `'distributor'` (default branch) | `src/dashboard/DashboardShell.jsx` |
| `'branch'` | `src/branch-dashboard/BranchDashboardShell.jsx` |
| `'agent'` | `src/agent-dashboard/AgentDashboardShell.jsx` |
| `'subscriber'` | `src/subscriber-dashboard/SubscriberDashboardShell.jsx` |
| `'employer'` | `src/employer-dashboard/EmployerDashboardShell.jsx` |
| `'admin'` | `src/admin-dashboard/AdminDashboardShell.jsx` |

Each shell is `React.lazy()`-imported in `App.jsx`, wrapped in `ErrorBoundary` + `Suspense` with a spinner fallback.

### Panel-vs-route rule (CLAUDE.md §4 item 2)

> Top-level navigation uses `react-router-dom` (`useNavigate()`). Modal/panel UI state (slide-ins, drawers) is **state-based** in `DashboardPanelContext` and intentionally NOT routed.

- **Subscriber + Agent** dashboards have routed sub-pages — every destination is a URL.
- **Distributor + Branch + Employer** dashboards use panels — slide-ins are not URL destinations; the panel context holds open/closed booleans. (Distributor/Branch additionally encode the drill level in the URL, e.g. `/dashboard/branches/:id`; Employer has a single `/dashboard` view + slide-in panels via `EmployerPanelContext`, no drill URLs.)

### 2.1 Distributor routes (`src/dashboard/`)

The Distributor shell parses `location.pathname` via `DashboardNavContext.parsePath()` into `{ level, entityId, section, reportId }`. URL drill levels:

| Path | level | section |
| --- | --- | --- |
| `/dashboard` | `country` | `map` |
| `/dashboard/regions/:id` | `region` | `map` |
| `/dashboard/districts/:id` | `district` | `map` |
| `/dashboard/branches/:id` | `branch` | `map` (auto-opens `ViewBranches` panel) |
| `/dashboard/agents/:id` | `agent` | `map` (auto-opens `ViewAgents` panel) |
| `/dashboard/subscribers/:id` | from segment | `map` |
| `/dashboard/reports` and `/dashboard/reports/:reportId` | `country` | `reports` (auto-pops `ViewReports`, then redirects URL back to `/dashboard`) |

Slide-in panels (`ViewBranches`, `ViewAgents`, `ViewSubscribers`, `CommissionPanel`, `ViewReports`, `Settings`, `CreateBranch`, `CreateAgent`) are state-based via `DashboardPanelContext`. Map → panel handoff via `DashboardNavContext.onPanelActionRef`.

Shell file: `src/dashboard/DashboardShell.jsx` — selects `useIsDesktop() ? <DistributorDesktopShell/> : <DistributorMobileShell/>` inside one `DashboardProvider`. Sub-areas: `sidebar/`, `map/`, `overlay/`, `cards/`, `branch/`, `agent/`, `subscriber/`, `commissions/`, `reports/` (+ `views/`), `settings/`, `shared/`, plus **`shell/`** (phone chrome) and **`mobile/`** (phone pages + `distributorMobile.module.css`).

**Mobile PWA shell (<1024px, `src/dashboard/shell/` + `mobile/`).** Below 1024px the desktop map-theme shell is replaced by `DistributorMobileShell` — a fixed `DistributorMobileAppBar` + scrollable routed `<main data-mobile-viewport>` (nested `<Routes>` under `/dashboard`, AnimatePresence page transitions) + a five-tab `DistributorBottomTabBar` (**Home · Branches · Agents · Commissions · Menu** — no hamburger, no map on phone), plus the reused `DataCopilotPanel` as the Ask-AI surface. Dedicated card-based pages in `mobile/` (`DistributorHomeMobile`, Branches/Agents/Subscribers list + detail, `CommissionsMobile`, `ReportsMobile` + `ReportViewMobile`, `SupportMobile` + `ThreadMobile`, `SettingsMobile`, `DistributorHubMobile`) share `distributorMobile.module.css` (cloned from `branchMobile.module.css`) and read the SAME hooks as desktop so figures never drift. Big lists (agents/subscribers/branches) render through `VirtualRows` — TanStack Virtual against the shell's `[data-mobile-viewport]` scroll element with a measured `scrollMargin` — so they are fully browsable, not capped. Subscriber detail fetches by id (`useEntity('subscriber', id)`) with the list's router-state row as an instant-paint fallback. CSS-modules note: nested selectors like `.mCell .lbl` require `className={styles.lbl}` on the child (literal `className="lbl"` only works under vitest's non-scoped strategy).

### 2.2 Branch routes (`src/branch-dashboard/`)

Single main view `BranchOverview` (no drill-down). Side panels reuse Distributor `ViewAgents`, `CommissionPanel`, `ViewReports`, `Settings` plus local `CreateAgent`, rendered with `splitMode` (backdrop suppressed; main reflows). Mobile drawer (`MobileDrawer`) appears below 768px, slides `x: '-100%' → 0` with `EASE_OUT_EXPO` over 320ms, locks body scroll, closes on Escape and route change.

Shell file: `src/branch-dashboard/BranchDashboardShell.jsx`. Sub-areas: `sidebar/`, `overview/`, `agent/`. Wraps in `DashboardProvider` + `BranchScopeProvider(branchId)`.

### 2.3 Agent routes (`src/agent-dashboard/`)

Routed pages under `/dashboard/*`:

| Path | Page |
| --- | --- |
| `/dashboard` | `home/HomePage` |
| `/dashboard/onboard` | `pages/OnboardPage` (lazy) |
| `/dashboard/subscribers` | `pages/SubscribersPage` (lazy) |
| `/dashboard/subscribers/:id` | `pages/SubscriberDetailPage` (lazy) |
| `/dashboard/subscribers/:id/schedule` | `pages/SubscriberSchedulePage` (lazy) |
| `/dashboard/inbox` | `pages/InboxPage` (lazy) |
| `/dashboard/analytics` | `pages/AnalyticsPage` (lazy) |
| `/dashboard/commissions` and `/dashboard/commissions/:view` | `pages/CommissionsPage` (lazy) |
| `/dashboard/contributions` | `pages/ContributionsThisMonthPage` (lazy) |
| `/dashboard/onboarded-this-month` | `pages/OnboardedThisMonthPage` (lazy) |
| `/dashboard/yet-to-contribute` | `pages/YetToContributePage` (lazy) |
| `/dashboard/settings` | `pages/SettingsPage` (lazy) |
| `*` | `Navigate to="/dashboard"` |

Shell file: `src/agent-dashboard/AgentDashboardShell.jsx`. Sub-areas: `shell/` (AgentShell + SideNav + BottomTabBar + PageHeader), `home/` (HomePage + widgets/), `onboarding/`, `pages/`. Wraps in `DashboardProvider` + `AgentScopeProvider(agentId)`.

### 2.4 Subscriber routes (`src/subscriber-dashboard/`)

| Path | Page |
| --- | --- |
| `/dashboard` | `home/HomePage` |
| `/dashboard/save` | `pages/SavePage` (lazy) |
| `/dashboard/save/schedule` | `pages/SchedulePage` (lazy) |
| `/dashboard/withdraw` | `pages/WithdrawalsHubPage` (lazy) |
| `/dashboard/withdraw/savings` | `pages/WithdrawPage` (lazy) |
| `/dashboard/withdraw/claim` | `pages/ClaimPage` (lazy) |
| `/dashboard/claim` | `Navigate to="/dashboard/withdraw/claim"` |
| `/dashboard/activity` | `pages/ActivityPage` (lazy) — first-class Activity tab (Phase 6; no longer a redirect) |
| `/dashboard/reports` and `/dashboard/reports/:reportId` | `pages/ReportsPage` (lazy) |
| `/dashboard/policies` | `pages/PoliciesPage` (lazy) — active/expired insurance policies + renew-by-payment |
| `/dashboard/help` | `pages/HelpPage` (lazy) |
| `/dashboard/agent` | `pages/AgentPage` (lazy) |
| `/dashboard/settings` | `pages/SettingsPage` (lazy) |
| `/dashboard/settings/profile` | `pages/ProfilePage` (lazy) |
| `/dashboard/settings/nominees` | `pages/NomineesPage` (lazy) |
| `/dashboard/settings/insurance` | `pages/InsurancePage` (lazy) |
| `/dashboard/settings/notifications` | `Navigate replace to="/dashboard/settings"` (deliberate redirect — see §16b) |
| `/dashboard/settings/security` | `Navigate replace to="/dashboard/settings"` (deliberate redirect — see §16b) |
| `*` | `Navigate to="/dashboard"` |

Shell file: `src/subscriber-dashboard/SubscriberDashboardShell.jsx`. Sub-areas: `shell/` (SubscriberShell + SideNav + BottomTabBar + PageHeader + `navigation.js` (legacy local helper kept for module-internal use)), `home/` (HomePage + 6 widgets/), `pages/`, `reports/views/`. Wraps `SubscriberPanelProvider` (which composes the generic `DashboardPanelProvider` — see §6) + `DashboardNavProvider`.

### 2.5 Employer routes (`src/employer-dashboard/`)

**Unified routed shell** (since 2026-06-24; like Subscriber/Agent): `EmployerDashboardShell` owns ONE `<Routes>` with `<Route element={<EmployerShell/>}>`. `EmployerShell` gates `useIsDesktop()` → the **desktop** chrome (`DesktopLayout`: white rail + Ask-AI copilot, ≥1024px) vs the **mobile** chrome (persistent app bar + 5-tab bottom nav `Home · Staff · Analytics · Runs · Company`, no FAB, + bottom sheets, <1024px). Each routed page (`pages/*Page.jsx`) gates its own desktop/mobile body. Routes (relative to `/dashboard/*`): index (overview), `employees`, `employees/:id`, `runs`, `insurance`, `analytics`, `support`, `settings`, plus **mobile-only** `onboard` / `pending-kyc` / `profile` (which redirect to their desktop equivalents on desktop). Run detail / new-run and ticket thread / new-ticket are **in-page view-state** (not routes), matching the desktop pages; pages with such sub-views register an app-bar back handler via `employerAppBarContext` so the persistent back steps within the page first.

*(Earlier design, replaced: a desktop-first single `EmployerOverview` + state-based slide-in panels held in `EmployerPanelContext`, with a <768px hamburger drawer. That legacy mobile panel shell is removed from the render path — but **Onboard + Pending-KYC remain as desktop overlays** opened via `EmployerPanelContext`, and the old panel files (`ViewEmployees`, `ContributionRuns`, `InsuranceBenefits`, `EmployerReports`, `EmployerTickets`, `EmployerSettings`, `EmployerSidebar`, `EmployerOverview`) are unused-but-on-disk pending a cleanup.)*

Shell file: `src/employer-dashboard/EmployerDashboardShell.jsx` (owns the `<Routes>`). Route guard: `role !== 'employer'` → `<Navigate to="/coming-soon" replace />`; reads `employerId = user?.employerId` with a `MissingEmployerIdScreen` fallback. Provider nest: `<EmployerDashboardProvider>` (composes `EmployerPanelProvider`) → `<EmployerScopeProvider employerId={employerId}>` → the `<Routes>`. Mobile chrome: `shell/EmployerShell.jsx` + `EmployerMobileAppBar` / `EmployerBottomTabBar` / `EmployerAskAISheet` / `BottomSheet` / `employerAppBarContext`; the desktop `DesktopLayout` is exported from `shell/EmployerDesktopShell.jsx` (still sets the `employer-desktop-shell` body class + mounts the Onboard/Pending-KYC overlays). Mobile bodies (`mobile/*Mobile.jsx`) reuse the genuinely-shared plain bodies — `runViews`, `settingsTabs` (`SettingsBody`), `MemberDetailBody`, `OnboardStaffBody` — and build fresh bodies against the same hooks for the rest (the other panels couple to `EmployerSlidePanel`).

Sub-areas (under `src/employer-dashboard/`):

| Dir | Contents |
| --- | --- |
| `EmployerDashboardShell.jsx` (+ `.module.css`) | Shell: CSS grid (`var(--sidebar-width) 1fr`), mobile header + drawer, route guard, provider nest |
| `sidebar/EmployerSidebar.jsx` | Icon rail (indigo-deep, teal active indicator) + mobile drawer + bottom-tab. `NAV_ITEMS = [overview, employees, runs, insurance, reports (labelled "Analytics"), support]`; `BOTTOM_ITEMS = [settings, logout]`; `MOBILE_NAV = first 3`; the "Employees" entry opens a small menu (rail: right fly-out; drawer: inline accordion) → "View employees" / "Onboard an employee" |
| `overview/` | `EmployerHealthScore.jsx` (hero — see §9), `EmployerOverview.jsx` (hero + notifications + operations, carries the `PANEL_PADDING` split-reflow map), `EmployerOperations.jsx` |
| `employees/` | `ViewEmployees.jsx` (roster; per-row **Remove from company** action — un-links via `useRemoveEmployee` behind a `Modal` confirm), `MemberDetailBody.jsx` (read-only member detail — rendered **inline inside `ViewEmployees.jsx`** in a single-panel replace model; the former standalone `EmployeeDetail.jsx` was deleted in the employer-overhaul and its CSS lives on as `MemberDetailBody.module.css`), `OnboardStaffPanel.jsx` (onboarding — **Single** mints a tokenized invite link via `useCreateInvite`; **Bulk** downloads an Excel template (`downloadSheet`), parses an uploaded file (`parseSheet`), shows a per-row review table, then creates invites for every valid row via `useBulkCreateInvites`. Identity is name + phone + email only — gender / NIN are collected during the member's own KYC signup). **Privacy:** an employee's pension balance is the employee's private info and is NOT shown to the employer anywhere (no balance column / "Total balance" KPI in the roster, no Balances section in the detail, no balance column in the Analytics export) |
| `runs/` | `ContributionRuns.jsx` (history + run detail + new-run wizard). **v2 (0062):** a committed run posts up to TWO transactions per member (`source:'own'` employee leg + `source:'employer'` employer leg), so the run-detail flat line list is **regrouped by member** (`groupLinesByMember`) into one row per member showing employee / employer / total amounts — not one row per transaction. The wizard preview + totals are server-derived from member `compensation`. |
| `insurance/` | `InsuranceBenefits.jsx` (company-wide oversight) |
| `kyc/` | `PendingKyc.jsx` — slide-in list of staff with pending KYC (`kyc_status` ∈ pending/incomplete) + a demo-only per-row "Nudge" (success toast; opened from the hero's Pending KYC tile via `kycOpen`) |
| `reports/` | Employee **Analytics** (sidebar-labelled "Analytics"; panel widened to 820). `EmployerReports.jsx` = KPI strip + Recharts chart grid (gender/status donuts, age & **monthly-compensation** histograms, roles bar, headcount-growth area) over a pure `deriveEmployeeAnalytics.js` + local `chartConfig.jsx` (brand palette + custom tooltip). **v2 (0062):** the "monthly" KPIs (`totalMonthly`/`avgMonthly`) and the histogram now derive from each member's **`compensation`** (the run driver), not the vestigial `monthlyContribution` — the analytics object-key stays `saving` for the stable consumer/test contract, but the labels read "Monthly compensation". The roster export column is `{ key:'compensation', label:'Monthly compensation (UGX)' }`. **Download reports**: employee roster (CSV + Excel), demographics summary (CSV), contribution runs (CSV) via `downloadCsv`/`downloadSheet`. Replaced the former hub + 4 report tables |
| `tickets/` | `EmployerTickets.jsx` (employer↔platform support, list + thread **with a composer** — unlike the view-only branch/distributor variants) |
| `settings/` | `EmployerSettings.jsx` (profile + default contribution config + password) |
| `panels/` | `EmployerSlidePanel.jsx` — the reusable panel chrome every module wraps (see §12); `StubPanel.jsx` |

### 2.6 Admin routes (`src/admin-dashboard/`)

The platform admin (head-office, global rights) **reuses the distributor map-theme** rather than a bespoke shell. Single main view = the National Overview map; no admin sub-routes — everything renders under `/dashboard` and panel state lives in `AdminPanelContext`. **At the country level the admin shows `AdminCountryOverview` instead of the distributor `OverlayPanel`** (`AdminDashboardContent` branches on `level === 'country'`); deeper geographic drill-down (region/district/branch/agent) keeps using the distributor `OverlayPanel`. That shared `OverlayPanel` is **scope-aware for admin** (gated on `useDataScope().employerAware`): the region/district hero AUM + counts re-frame per the data-scope filter (Distributors → Subscribers/Agents/Branches/Coverage · Employers → Employers/Subscribers/Active%/AUM · All → Subscribers/Employers/Branches/Active%), the **commissions block is removed** for admin, and the district Employers-tab rows are clickable → open `ViewEmployerDetail`. The distributor role (no `DataScopeProvider`) renders the panel byte-for-byte as before.

WHY the swap: the distributor `OverlayPanel` country card reads `get_entity_metrics_rollup('country','ug')`, whose subscriber count walks the agent tree (5,000) and excludes the 17 employer-onboarded subscribers, and frames the row around agents/branches. `AdminCountryOverview` instead reads `usePlatformOverview()` (the `get_platform_overview` RPC, 0050) → TRUE total (5,017) + an acquisition-channel breakdown (via-distributor / via-employer / direct), and leads with **Distributors + Employers** counts (the admin's domain) with agents/branches as a secondary "network" row.

Shell file: `src/admin-dashboard/AdminDashboardShell.jsx`. Provider nest: `<DashboardProvider>` (the distributor Nav+Panel contexts) → `<AdminPanelProvider>` → shell. It **imports unchanged** from `src/dashboard/`: `map/UgandaMap`, `cards/MetricsRow`, `overlay/{OverlayPanel,Breadcrumb,TopBar}` (+ the named exports `GlobalSearch`/`TimePeriodCard`/`CollapsibleSection` from `overlay/OverlayPanel.jsx`, reused by `AdminCountryOverview`), and the `branch/CreateBranch`, `branch/ViewBranches`, `agent/ViewAgents`, `subscriber/ViewSubscribers`, `reports/ViewReports`, `commissions/CommissionPanel`, `settings/Settings`, `tickets/ViewTickets` panels (role-blind — RLS scopes the data; admin holds the `*_select_admin` grants). The shell also reuses `dashboard/DashboardShell.module.css` for pixel-identical chrome.

**Mobile PWA shell (<1024px, `src/admin-dashboard/shell/` + `mobile/`).** `AdminDashboardShell` selects `useIsDesktop() ? <AdminDesktopShell/> : <AdminMobileShell/>` inside `DashboardProvider → AdminPanelProvider → DataScopeProvider(defaultScope="all")` (the mobile shell MUST stay inside `DataScopeProvider`, else the role silently flips to distributor-only). `AdminMobileShell` mirrors the distributor phone shell (app bar + scrollable routed canvas + five-tab bottom bar + Ask-AI, no map) with admin tabs **Home · Distributors · Employers · Network · Menu**. It REUSES the distributor mobile CSS + the role-agnostic `Branches/Agents/Subscribers/Reports` pages (and `SupportMobile`/`ThreadMobile`, which ride the distributor ticket hooks' `'d-001'` fallback since admin has no `distributorId`), and adds admin-only pages in `mobile/`: `AdminHomeMobile` (`usePlatformOverview` — platform totals + channel split), `Distributors` + `Employers` list/detail (`useAllEntities('distributor')` / `useAllEmployersMetrics` + `useEmployer`/`useEmployees`; no per-distributor metrics exist so distributor cards show profile + platform KPIs), `AdminNetworkMobile` (hub → branches/agents/subscribers), `AdminHubMobile`, and `AdminSettingsMobile` (password-only — admin has no editable profile). Chrome in `shell/` (`AdminMobileShell`, `AdminMobileAppBar`, `AdminBottomTabBar`, `adminAppBarContext`) reuses the distributor `shell/` CSS modules.

Sub-areas (under `src/admin-dashboard/`):

| Dir | Contents |
| --- | --- |
| `AdminDashboardShell.jsx` | Shell clone of `DashboardShell` — `AdminSidebar` + mobile header/drawer (drawer adds Distributors/Employers); at country level renders `AdminCountryOverview`, else the reused `OverlayPanel`; plus the reused map/panels + admin panels gated by `useAdminPanel()`. Mounts `DataScopeProvider` (default `all`) so the card + the shared `OverlayPanel` read one scope. Passes `onEmployerSelect` into `OverlayPanel` (opens `ViewEmployerDetail` for the clicked employer) and mounts that panel |
| `AdminCountryOverview.jsx` (+ `.module.css`) | Admin country Summary card. `usePlatformOverview()` for TRUE totals + channel breakdown + distributor/employer counts; reuses `OverlayPanel.module.css` chrome + `GlobalSearch`/`TimePeriodCard`/`CollapsibleSection` exports; quick-actions open the Distributors/Employers panels. **Data-scope filter** (`PillChipGroup`: All / Distributors / Employers via `useDataScope`) re-scopes every headline metric from `overview.byChannel` + the per-region counts (merging `useEmployerGeoRollup().byRegion`) |
| `sidebar/AdminSidebar.jsx` | Clone of the distributor `Sidebar` (reuses its `.module.css`); adds **Distributors** + **Employers** rail items that open the admin panels via `useAdminPanel()`; coordinates with `useDashboard().closeAllPanels` so only one slide-in shows. Submenu counts use `usePlatformOverview()` (true subscriber total) |
| `distributors/` | `ViewDistributors.jsx` (slide-in: platform KPI strip via `usePlatformOverview()` [Distributors/Branches/Agents/Subscribers(true)/AUM] + `useAllEntities('distributor')` list, **+ New**), `CreateDistributor.jsx` (form → `useCreateDistributor`) |
| `employers/` | `ViewEmployers.jsx` (slide-in: per-employer rollup via `useAllEmployersMetrics`, **+ New**), `CreateEmployer.jsx` (form → `useCreateEmployer`), `ViewEmployerDetail.jsx` (single-employer detail — opened from the map district drill-down's Employers tab; profile + KPI tiles from `useAllEmployersMetrics` (find by `detailEmployerId`) + member roster from `useEmployees(id)`) |
| `adminPanels.module.css` | Shared slide-in panel + list + form styles for all 4 admin panels (mirrors `ViewReports.module.css` chrome) |

---

## 3. Hard rules (anti-patterns)

These rules are audit-verified — Phase 1E confirmed all four cleanly held across the codebase. **Don't break them.**

| # | Rule | Where it's enforced |
| --- | --- | --- |
| 1 | Components and dashboard files **never** import from `src/data/mockData.js`. Only files under `src/services/` may. | Audit grep: `grep -rn "from '@/data/mockData" src --include='*.jsx'` → 0 hits; `grep -rn "import .* mockData" src/{dashboard,subscriber-dashboard,agent-dashboard,branch-dashboard}` → 0 hits. |
| 2 | Don't hand-roll `fetch()` against `/api/*`. Always go through `services/api.js` (`api.get/post/put/delete`) so the 401 listener (`onAuthExpired`) fires. | Audit grep: `grep -rn "fetch('/api" src --include='*.jsx' --include='*.js'` ignoring `src/services/api.js` → 0 hits. |
| 3 | Never disable focus visibility without a replacement. The global `:focus-visible` baseline is in `src/index.css` (2px `var(--color-indigo-soft)` outline + 2px offset). `outline: none` is permitted only inside `:focus` rules that also set a custom `border-color` / ring — the audit verified each occurrence pairs with an explicit replacement. | `src/index.css` baseline; per-control overrides. |
| 4 | Never write `transition: all`. Always enumerate properties. | Audit grep: `grep -rn "transition: all" src --include='*.module.css'` → 0 hits. |
| 5 | Always pass schedule frequencies through `normalizeFrequency(value)` from `src/utils/finance.js`. Defends against legacy aliases (`half-yearly`, `halfYearly`, `semi-annually`, `semiAnnually`). | Service + hook + UI write paths. |
| 6 | Signup persistence: `SignupContext` writes every patch to `localStorage['uganda-pensions-signup']` (debounced — see §11). **File/Blob fields + `password` are dropped on serialise** via `EPHEMERAL_KEYS`. | `src/signup/SignupContext.jsx`. |
| 7 | No raw SQL from the frontend. Every write goes through a Supabase RPC (typically SECURITY DEFINER) — see BACKEND.md §10. | Service layer. |
| 8 | RLS policies read `auth.jwt() ->> 'app_role'`, **never** `'role'`. `auth.uid()` is `NULL` for our custom HS256 JWTs (BACKEND.md §9). | Verified on the new DB: all ~90 policies correct (count grew with the `0049` admin clones). |

Phase 1E also confirmed **no `dangerouslySetInnerHTML` anywhere** (React's default escaping is preserved) and **no open-redirect vectors** — every `window.location` / `navigate` destination is a hardcoded path.

---

## 4. Three-layer data access + hook → service boundary

```
Components / pages
        │
        ▼
src/hooks/         (React Query useQuery / useMutation; cache + invalidation)
        │
        ▼
src/services/      (Supabase / api.js calls + per-service mock fallback)
        │
        ▼
src/data/mockData.js   (frozen demo seed; only services may import this)
or supabase.from() / .rpc()  (real backend; controlled by IS_SUPABASE_ENABLED)
```

**Rollback flag:** `IS_SUPABASE_ENABLED` (exported from `src/services/api.js`) reads `import.meta.env.VITE_USE_SUPABASE`. Default ON; set the env var to the literal string `'false'` to flip every service into its mock-backed branch.

```js
export async function getEntity(level, id) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getEntity(level, id);
  // ...supabase.from(...).select(...)
}
```

**Per-service overrides over frozen mockData.** Under `IS_SUPABASE_ENABLED=false`, both `entities.js` and `subscriber.js` keep an in-memory `Map` (`_entityOverrides` / `_sessionMutations`) so writes (status flips, contributions, schedule edits, withdrawals) layer on top of the frozen seed for the demo session. Lost on refresh — see §16a.

### 4.1 Cross-role utility extraction (F1, F22 — commit `bd5ea82`)

The previous `agent-dashboard/shell/PageHeader.jsx` imported `goBackOrFallback` from `../../subscriber-dashboard/shell/navigation` — the **only** cross-role import in the codebase. Phase 4B promoted the helper to `src/utils/navigation.js`:

```js
// src/utils/navigation.js
export function goBackOrFallback(navigate, fallback) {
  const idx = window.history.state?.idx;
  if (typeof idx === 'number' && idx > 0) navigate(-1);
  else navigate(fallback);
}
```

Detection: react-router stores its own index on `window.history.state.idx`. Index 0 means the user landed here directly (deep link, refresh, or fresh tab) — there's nothing to pop, so fall back to the route. Both `agent-dashboard/shell/PageHeader.jsx` and `subscriber-dashboard/shell/PageHeader.jsx` now import from `@/utils/navigation`. The legacy `src/subscriber-dashboard/shell/navigation.js` still exists for module-internal use but no longer leaks across roles.

**Audit caveat (X11 / X17).** Every service that branches on `IS_SUPABASE_ENABLED` ships an offline mock branch (per CLAUDE.md §10a rollback safety), and Phase 2 introduced unit tests for the real/mock parity on `entities`, `commissions`, `subscriber`, `agent`, `kyc`, `chat`, `search`, `contact`, `supabaseClient`, `api`, `auth`. The mock-branch coverage is now substantial (see §17) but output-shape drift remains a latent risk to manually verify on any new mock-branch change.

---

## 5. Services inventory (`src/services/` — 12 files)

All public exports below. Every service file follows the `IS_SUPABASE_ENABLED ? supabase : mock` dual-branch pattern.

| File | Owns | Public API (selected) | Consumed by |
| --- | --- | --- | --- |
| `api.js` | Same-origin `/api/*` fetch wrapper; 401 detection; rollback flag | `IS_SUPABASE_ENABLED`, `onAuthExpired(handler) → unsubscribe`, `apiFetch(path, options)`, `api.get/post/put/delete` | `auth.js`, `chat.js`, `kyc.js`, `contact.js`, `AuthContext` |
| `supabaseClient.js` | supabase-js singleton + token helpers | `supabase` (createClient), `getToken()`, `setToken(token)`, `clearToken()` (default export = `supabase`) | All Supabase-backed services |
| `auth.js` | Sign-in flow + AuthError + role gate | `AuthError`, `DASHBOARD_ROLES`, `sendOtp(phone, role)`, `verifyOtp(phone, otp, role, password?)`, `signInWithPassword(phone, password, role)`, `changePassword(currentPassword, newPassword)`, `hasDashboard(role)` | `SignInModal`, `AuthContext`, `App.ProtectedDashboard` |
| `entities.js` | Country/Region/District/Branch/Agent + Distributor CRUD | `getCountry`, `getEntity`, `getChildren`, `getAllAtLevel`, `getEntityPage`, `getAllAtLevelMap`, `getParent`, `getTopPerformingBranch`, `getBreadcrumb`, `getEntitySync`, `getEntityMetricsRollup`, `createBranch`, `createAgent`, `updateBranch`, `setBranchStatus`, `updateDistributor`, `_mockSources` | Distributor + Branch dashboards via `useEntity`-family hooks |
| `commissions.js` | Commission state machine (~30+ exports, 828 lines) | See §5.5 below | `useCommission`-family hooks; CommissionPanel; Branch + Agent commission pages |
| `subscriber.js` | Per-subscriber reads/writes + per-session mutation store | See §5.6 below | `useSubscriber`-family hooks; subscriber dashboard pages |
| `agent.js` | Agent-scoped portfolio reads | `getAgentSubscriberList(agentId)` | `useAgentSubscribers` |
| `employer.js` | Employer-scoped roster / runs / metrics + write RPCs | See §5.12 below | `useEmployer`-family hooks; employer dashboard |
| `kyc.js` | Smile ID v2-shaped mock pipeline (8 stages) | `assessImageQuality`, `extractIdFields`, `verifyNira`, `sendOtp`, `verifyOtp`, `faceMatch`, `screenAml`, `referToAgent` | Signup steps + onboarding |
| `chat.js` | Keyword-matched chat (mocked) | `getChatResponse(message)`, `getAgentReply(message, agent)`, `getSubscriberChatResponse(message)` | Distributor / Branch / Subscriber co-pilot widgets; Agent DM (HelpPage, AgentPage) |
| `search.js` | `search_entities` PG RPC (pg_trgm fuzzy) | `searchEntities(query)` | `useSearch` |
| `contact.js` | Public `/api/contact` POST | `submitContactForm({ name, email, message })` | `pages/Contact.jsx` |

### 5.1 `api.js` — base HTTP client

Same-origin `/api/*` wrapper around `fetch`. Reads `Authorization: Bearer <upensions_token>` from localStorage on every request. On HTTP 401: clears auth keys and notifies all `onAuthExpired` listeners (consumed by `AuthContext`). Thrown errors carry `code`, `status`, and `body`.

`VITE_API_BASE_URL` is the live API base URL. Post-Render migration this points at `https://uganda-dashboard-api.onrender.com/api` in Vercel project env (all three scopes — Production / Preview / Development) and at `http://localhost:3001/api` in local dev. `src/config/env.js` defaults to `/api` only if the env var is missing (e.g. a legacy preview that wasn't redeployed); modern builds bake the absolute URL at Vite build time. Bundle-baked semantics mean changing the value requires a Vercel redeploy, not just an env edit.

### 5.2 `supabaseClient.js` — supabase-js singleton

`createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` with `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }` — we manage our own JWTs. `global.headers` is a **function** that re-reads `localStorage` on every request so token rotation is picked up without recreating the client.

Phase 7A (commit `27b78a3`) added a hard-fail guard in production builds: if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing in `IS_PROD`, the module throws on load. Dev/preview still fall back to `http://localhost:54321` / `'public-anon-key'` so local-without-env still boots.

### 5.3 `auth.js` — sign-in flow

```js
export class AuthError extends Error { code; retryAfterSeconds? }
export const DASHBOARD_ROLES = ['distributor', 'branch', 'subscriber', 'agent']
export async function sendOtp(phone, role)
export async function verifyOtp(phone, otp, role, password?)        // password optional — set on first sign-in
export async function signInWithPassword(phone, password, role)
export async function changePassword(currentPassword, newPassword)
export function hasDashboard(role): boolean
```

`AuthError.code` values that the UI maps to friendly messages via `messageForCode` (`src/services/auth.js`): the OTP/password codes `rate_limited`, `locked`, `invalid_otp`, `password_too_short`, `password_too_weak`, `password_too_long`, `password_required`, `invalid_password`, `password_not_set`, `current_password_required`, `current_password_invalid`, **plus the transport-level cold-start codes** `network_unreachable` ("Couldn't reach the server. Please try again in a moment."), `server_unavailable` ("Demo backend is temporarily unavailable. Retrying…"), and `timeout` ("Request timed out. Please try again.") surfaced by `services/api.js` (G47 — so a waking Render backend reads as a warm-up message, not "Invalid code"). Anything else falls back to "Could not verify the code. Please try again." **Scope note:** this friendly-message normalization covers the auth + transport layer only; the **admin create-form** write path (`create_distributor`/`create_employer`) still `throw`s the raw Supabase `error` rather than mapping `P0001`/`23505` into a `{code}` — a known Low gap (audit §5a / C1 §2a.8), not yet normalized.

Dev-only QA force-overrides via `localStorage['upensions_otp_force']` (`invalid_otp` / `rate_limited` / `locked`). `verifyOtp` returns `{ token, user: { role, phone, name?, subscriberId?, agentId?, branchId?, distributorId?, hasPassword? } }`.

Phase 2A (commit `27e661b`) covers every exported function — `signInWithPassword`, `changePassword`, the extended `messageForCode`, AuthError shape — at the service layer.

### 5.4 `entities.js` — hierarchy CRUD (Distributor + Branch dashboards)

```js
export async function getCountry()
export async function getEntity(level, id)
export async function getChildren(parentLevel, parentId)
export async function getAllAtLevel(level)
export async function getEntityPage(level, opts)            // paginated variant
export async function getAllAtLevelMap(level)
export async function getParent(level, id)
export async function getTopPerformingBranch(level, parentId)
export async function getBreadcrumb(currentLevel, selectedIds)
export function   getEntitySync(level, id)                  // sync — used by DashboardNavContext
export async function getEntityMetricsRollup(level, entityIds)  // RPC get_entity_metrics_rollup
export async function getPlatformOverview()                     // RPC get_platform_overview (admin) — 13 keys + byChannel (0058)
export async function getEmployerGeoRollup()                    // RPC get_employer_geo_rollup (admin, 0058) — byRegion/byDistrict employer aggregates
export async function createBranch(payload)
export async function createAgent(payload)
export async function updateBranch(id, patch)
export async function setBranchStatus(id, status)
export async function updateDistributor(id, patch)
export const _mockSources = { COUNTRY, REGIONS, DISTRICTS, BRANCHES, AGENTS, DISTRIBUTORS }
```

Returns camelCase shape; Supabase rows are mapped via internal `mapRegion / mapDistrict / mapBranch / mapAgent / mapDistributor` helpers. Mock fallback reads from `mockData.js` + the in-memory `_entityOverrides` Map.

`getDistributorMetrics()` was retired — every caller now uses `useEntityMetrics('country', 'ug')`, which routes through `getEntityMetricsRollup` → `get_entity_metrics_rollup` RPC. That RPC returns totalSubscribers/totalAgents/totalBranches/aum as part of its 8-field result, eliminating the 4-call fan-out the old function did.

`getEntitySync` uses an in-memory `_syncCache` for synchronous lookups during URL routing (`DashboardNavContext.parsePath`). First navigation can return `null` until the cache warms — known low-impact behaviour (audit F27).

### 5.5 `commissions.js` — commission settlement service

The 0029–0031 simplification removed all run / dispute / hold / cadence / confirm functions. The service is now read-focused plus the upload-driven settlement path.

**Reads:** `getCommissionRate` · `setCommissionRate(amount)` · `getCommissionSummary(branchId)` · `getEntityCommissionSummary(level, entityId)` · `getAgentCommissionList(statusFocus)` (`statusFocus ∈ 'paid' | 'due' | null`) · `getAgentCommissionDetail(agentId)` · `getCommissionSubscribers(agentId, filter)` · `getPendingDuesByAgent()` · `getPendingDuesByBranch()` · `listSettlements({ limit, branchId, agentId })` (`agentId` scopes the feed to one agent; LIVE relies on RLS, but the agent CommissionsPage passes it so MOCK mode — no RLS — never leaks another agent's batches).

`getEntityCommissionSummary` returns: `{ totalPaid, totalDue, countPaid, countDue, total, countTotal, settlementRate }` (no more disputed buckets).

**Settlement upload (Distributor):**

```js
applySettlementUpload({ rows, nonce })   // → apply_settlement(p_rows, p_nonce) RPC
   // rows are the parsed, normalized settlement-template rows (whole-UGX Amount
   // Paid + payment reference/date per agent). Allocates each agent's Amount Paid
   // FIFO oldest-first across their `due` lines: covered lines flip to `paid`
   // (paid_amount = the line's own amount), uncovered lines stay `due` (partial
   // payments do NOT over-clear — INFORM-NOT-BLOCK). Records a settlement_batches
   // row (paid_amount = allocated total) + emits formatted agent + branch
   // notifications. `nonce` is a per-upload idempotency key (minted in
   // CommissionPanel when the confirm modal opens) — a replay returns the prior
   // result without re-recording.
   // Returns { agentsSettled, linesSettled, totalPaid, skipped: [{ agentId, reason }] }.
   // skip reasons: missing_agent_id | no_due | amount_too_low
```

The settlement RPC transition is documented in BACKEND.md §11. `setCommissionRate` still writes the flat rate-per-subscriber to `commission_config`; commissions continue to auto-generate as `due` at that rate on a subscriber's first contribution.

### 5.5b `notifications.js` — in-app notification feed (new)

Backs the agent + branch notification bell. Exports `listNotifications` · `getUnreadCount` · `markNotificationsRead(ids)` (→ `mark_notifications_read` RPC) · `createCommissionSettledNotifications(...)`. In mock mode `createCommissionSettledNotifications` is the creator; against Supabase the notifications are written server-side inside the `apply_settlement` RPC, so the client only reads + marks-read.

### 5.6 `subscriber.js` — per-session mutation store + Supabase reads/writes

```js
export async function getCurrentSubscriber(phone)
export async function getSubscriberTransactions(id, { type, range, status })
export async function getSubscriberClaims(id)
export async function getSubscriberWithdrawals(id)
export async function getSubscriberNominees(id)
export async function getSubscriberAgent(subscriberId)
export async function makeAdHocContribution(id, { amount, retirementPct, method })
export async function requestWithdrawal(id, ...)
export async function submitClaim(id, payload)
export async function updateContributionSchedule(id, schedule)
export async function updateNominees(id, { pension, insurance })
export async function updateInsuranceCover(id, { cover, premiumMonthly })
export async function renewPolicy(id, { type, method })       // demo premium payment; flips policy active
export async function updateProfile(id, updates)
export async function createFromSignup(payload)              // RPC create_subscriber_from_signup
export async function createFromAgentOnboard(payload, agentId)  // RPC create_subscriber_from_agent_onboard
export function invalidateSubscriber()
```

`_sessionMutations` Map keyed by subscriber ID — folds `{ extraTransactions, extraClaims, extraWithdrawals, scheduleOverride, nomineesOverride, insuranceOverride, profileOverride, policyRenewals, balanceDelta }` into reads. `requestWithdrawal` writes BOTH a transaction (for activity feed) and a withdrawal record (for reports/claims).

**Derived `subscriber.policies`.** `getCurrentSubscriber` runs every read (mock + Supabase) through `attachPolicies()`, which calls `derivePolicies()` (`utils/policies.js`) with `currentTime()` + the session's `policyRenewals`. **Per-product model (migrations `0063`+`0064`):** life cover stays in `insurance_policies` (single row per subscriber); the extra products (`health`/`funeral`) live in the `subscriber_insurance_products` table (`0064` — `0063`'s composite-PK approach was reverted because it broke the signup/employer upsert-by-`subscriber_id` RPCs). The mapper merges both into `sub.insuranceProducts` (life + extras) alongside the legacy `sub.insurance` (the life row); `derivePolicies` builds one entry per active product, computing `active`/`expired` from the renewal date, with a legacy single-life fallback when `insuranceProducts` is empty (signup-only accounts). The old phone-hash-synthesised health policy is **gone** — products are real, persisted rows. `payInsurancePremium(id, {product, cover, premiumMonthly, nonce})` (RPC `pay_insurance_premium`) activates a product row + records a `'premium'` transaction (excluded from balance math) — idempotent on the nonce; `renewPolicy(id, {type})` likewise persists (updates the real row forward + premium txn) and supports `funeral`. `updateInsuranceCover` still drives the life cover slider. **Settle-this-period flow:** after a schedule save, `SchedulePage` diffs the new amount vs `getContributionPaidThisMonth` and the new insurance selection vs held products (`utils/periodSettlement.js`), then opens the shared `components/PaySheet.jsx` to collect the contribution top-up + new-product premiums in one payment. The same `PaySheet` backs the Policies renewal + the InsurancePage cover-upgrade pay.

### 5.7 `agent.js` — agent-scoped portfolio

```js
export async function getAgentSubscriberList(agentId)
```

Joins `subscribers` + `subscriber_balances` + `contribution_schedules` so the agent dashboard's list, detail, analytics, and home widgets ship from a single round-trip. RLS enforces "own portfolio only".

### 5.8 `kyc.js` — Smile ID v2-shaped pipeline (mocked)

```js
assessImageQuality(file) · extractIdFields({ front, back, sessionId })
verifyNira(payload) · sendOtp(payload) · verifyOtp(payload)
faceMatch(payload) · screenAml(payload) · referToAgent(payload)
```

Every call returns a `tracking_id` correlating stages of one onboarding job. **QA force-overrides** via `localStorage['upensions_<stage>_force']` (forwarded as the `X-QA-Force` header). Mock fallback honours the same flags. **Demo scope** — see §16a.

### 5.9 `chat.js` — keyword-matched chat (mocked)

```js
export async function getChatResponse(message)         // distributor/branch
export async function getAgentReply(message, agent)    // subscriber ↔ agent DM
export async function getSubscriberChatResponse(msg)   // subscriber co-pilot
```

POSTs to `/api/chat` (JWT-optional; the route flavours by role). All three return a plain string (the route also returns `suggestions[]` but callers render a single bubble). Phase 1G adds `Cache-Control: no-store` on the route and type-checks `body.message`.

### 5.10 `search.js`

```js
export async function searchEntities(query): Promise<Array<{ id, name, level, label, parentId }>>
```

Wraps the `search_entities` PG RPC (pg_trgm fuzzy). Hardcoded max 8 results. Mock fallback scans `REGIONS/DISTRICTS/BRANCHES/AGENTS`.

### 5.11 `contact.js`

```js
export async function submitContactForm({ name, email, message }): Promise<{ submitted: true, id?, demo? }>
```

POSTs to `/api/contact`. Returns `demo: false` on real persistence, `demo: true` under the rollback flag (or in dev when `/api/*` is unreachable). The frontend **validates** the response shape: a real-path (`demo: false`) response without a non-empty string `id` is treated as a backend contract violation and shows the `SUPPORT_EMAIL` fallback rather than claiming success (`pages/Contact.jsx:49-54`). Audit X13 (formerly open) is resolved.

### 5.12 `employer.js` — employer roster / runs / metrics (dual-path)

Mirrors `entities.js`: every function checks `IS_SUPABASE_ENABLED`. The Supabase branch reads via `supabase.from('employees' | 'employers' | 'contribution_runs' | 'contribution_run_lines').select(...)` (RLS auto-scopes by the JWT `employerId` claim — no manual filter needed beyond `.eq('employer_id', id)`) and writes via the four `0035` SECURITY DEFINER RPCs. The mock branch layers a per-session mutation store over the frozen `src/data/employerSeed.js` rows (1 employer / 16 employees / 3 historical runs) — the only service file that imports `employerSeed.js` (CLAUDE.md §4.1). Snake→camel mappers `mapEmployer` / `mapEmployee` / `mapRun` / `mapRunLine` mirror `entities.js`'s `mapBranch`; JSONB columns (`contribution_config`, `contribution_schedule`, `nominees`) are already camelCase inside and pass through (schedule frequencies run through `normalizeFrequency` per the hard rule).

```js
// Reads
export async function getEmployer(id)                       // ['employer', id]
export async function getEmployees(employerId)              // ['employees', employerId]
export async function getEmployee(employeeId)               // ['employee', employeeId]
export async function getContributionRuns(employerId)       // ['contributionRuns', employerId] — newest-first
export async function getContributionRun(runId)             // ['contributionRun', runId] → { run, lines }
export async function getEmployeeContributions(employeeId)  // ['employeeContributions', employeeId] — run-lines joined to run period/date
export async function getEmployerMetrics()                  // RPC get_employer_metrics() — hero/overview aggregates
export async function getEmployerLeaderboard(employerId)    // ['employerLeaderboard', employerId] — monthly-contributions ranking (hero chip)
// Writes (Supabase RPCs; mock → session store)
export async function submitContributionRun(employerId, { periodLabel, method, nonce })  // RPC submit_employer_contribution_run (two-leg, 0062)
export async function updateMemberCompensation(employerId, subscriberId, compensation)   // RPC update_employer_member_compensation (0062)
export async function updateEmployerProfile(patch)                                       // RPC update_employer_profile (insurance fold, 0056)
export async function applyGroupInsurance(employerId, { cover })                         // RPC apply_group_insurance (0039) — flat roster-wide cover
export async function removeEmployee(employerId, employeeId)                             // RPC remove_employer_member (0048) — un-link
export async function createSubscriberFromEmployerOnboard(employerId, payload, nonce)    // RPC create_subscriber_from_employer_onboard
export const _employerMockSources = { EMPLOYER, MEMBERS, CONTRIBUTION_RUNS, MEMBER_TRANSACTIONS }
```

`getEmployerLeaderboard` additionally imports the `LEADERBOARD_COMPETITORS` seed (frozen array of invented peer employers) from `employerSeed.js`.

**Contribution-run write path (deep dive — CONTRIBUTION MODEL v2, migration 0062).** Members are tagged subscribers; funding is driven by each member's monthly **`compensation`**, not a self-set saving amount. `submitContributionRun(employerId, { periodLabel, method, nonce })` is **NON-optimistic** — the server (`submit_employer_contribution_run`) re-derives every figure and is the truth. For each ACTIVE member it computes **two legs** from `compensation` + the company-wide `default_contribution_config`: `co-contribution` ⇒ `employeeLeg = round(comp*employeePct/100)`, `employerLeg = round(employeeLeg*employerMatchPct/100)` (NO cap); `employer-only` ⇒ `employeeLeg=0`, `percent → round(comp*employerPct/100)` else `round(employerAmount)`. Each non-zero leg posts a `transactions` row — the employee leg as **`source:'own'`**, the employer leg as **`source:'employer'`**, both `agent_id` NULL (**no commission**) — split by the member's `retirementPct` (default 80, rounding ONCE). A member with BOTH legs 0 is skipped (`zero_contribution`); `linesCreated` counts DISTINCT funded members and `grandTotal = employerTotal + employeeTotal`. Idempotent via `nonce`. The **mock branch (`_mockSubmitEmployerRun`) re-implements this byte-for-byte** (session balance-delta store + a nonce→result map), skipping suspended members. `updateMemberCompensation(employerId, subscriberId, compensation)` sets the driver field (RPC `update_employer_member_compensation`, employer-gated, validates `>= 0`); it does NOT post a contribution — it only changes what the NEXT run funds. `fetchMemberBreakdown` buckets a member's contribution transactions by `source` ('own' vs 'employer') for the detail panel's own/employer split.

**Leaderboard + group insurance (funder-redesign).** `getEmployerLeaderboard(employerId)` powers the Overview hero's monthly standing: the employer's OWN "this month" total (the newest contribution run's `grandTotal`, read through `getContributionRuns` so the figure is byte-identical on both branches) is merged with the seeded `LEADERBOARD_COMPETITORS` peers (`employerSeed.js` — calibrated so `emp-001` lands at rank #3), sorted by `monthlyTotal` descending, and assigned a 1-based `rank`. Returns `[{ rank, name, monthlyTotal, isYou, deltaRanks }]` best-first; exactly one row carries `isYou: true` with a static seeded `deltaRanks: 2` (no historical-rank store to diff against — competitors report `0`). The Overview hero now renders this array as a **monthly standing gauge** (shared `ScoreGauge`) showing the employer's peer rank rather than a chip list — the data path is unchanged. `applyGroupInsurance(employerId, { cover })` is the roster-wide analogue of `updateEmployeeInsurance` — on Supabase it calls the `0039` `apply_group_insurance` RPC (flat cover on every owned employee, premium zeroed, status derived from cover); the mock branch updates every owned seed employee in the session store. Both migrations (`0038`/`0039`) are now **applied to the live Singapore DB** (cutover 2026-06-05); the Supabase branch is live, with the mock branch as the `VITE_USE_SUPABASE='false'` fallback.

**CONTRIBUTION MODEL v2 frontend surfaces (migration 0062).**
- **Compensation onboarding fields.** Onboarding (`OnboardStaffPanel` / the employer invite flow) and the member detail collect a member's monthly **compensation** (UGX) — the field that drives the two-leg run. Employer members do NOT self-set a saving amount; their `contribution_schedules.amount` is 0 and `monthlyContribution` is vestigial. An employer edits a member's compensation via `useUpdateMemberCompensation` (RPC `update_employer_member_compensation`).
- **Reworked Pension config tab.** `EmployerSettings` → `PensionContributionTab` saves the new `default_contribution_config` shapes (lifted into the shared `SettingsBody` draft so the Pension + Insurance tabs share one config): co-contribution = `{ mode:'co-contribution', employeePct, employerMatchPct }` (NO `maxContribution`); employer-only = `{ mode:'employer-only', employerBasis:'fixed', employerAmount }` or `{ …, employerBasis:'percent', employerPct }`. It back-compat-reads a legacy `matchPct` into `employerMatchPct` and infers `employerBasis` from a legacy `employerAmount`. The insurance keys (`insuranceEnabled` / `groupCoverAmount`) ride along and fold into the same `update_employer_profile` call (0056).
- **`companyFundingLabel(config)`** (`employees/fundingLabel.js`) renders the one-line model summary, now: co-contribution → `"Co-contribution — <employeePct>% of pay + <employerMatchPct>% employer match"`; employer-only percent → `"Employer-only — <employerPct>% of compensation"`; employer-only fixed → `"Employer-only — <UGX> per member / month"`. Consumed by the roster, member detail, contribution-runs, onboarding, hero, and the employer copilot's `fundingLabel` context (`chat.js`).
- **Compensation-based participation metric.** The Overview hero (`EmployerHealthScore`) defines "participating" as an ACTIVE member with non-zero **compensation** (`contributesSomething(emp) → Number(emp.compensation) > 0`) — since compensation is what funds both legs — measured against the active count (not total headcount). The employer copilot mirrors this ("% of active staff contributing").

---

## 6. Contexts inventory (10 in `src/contexts/`, 1 in `src/signup/`)

| Context | Provider scope | What it holds | Read by |
| --- | --- | --- | --- |
| `AuthContext` | `main.jsx` (whole app) | `{ user, role, isAuthenticated, login, logout, updateUser }` + localStorage persist (`upensions_auth`); subscribes to `onAuthExpired` from `api.js` (see §6.1) | All shells, SignInModal, every page that needs identity |
| `SignInContext` | `App.jsx` (inside Routes) | `{ isOpen, open, close }` for SignInModal — `value` is **memoized** (Phase 4A `e43de1f`) | Navbar, CTA, sign-in trigger buttons |
| `ToastContext` | `main.jsx` | `{ toasts, addToast, removeToast }` (max 3 visible, auto-dismiss) — `value` is **memoized** (Phase 4A `e43de1f`) | Every form/mutation; rendered via `<ToastContainer />` |
| `DashboardContext` | `DashboardShell` / `BranchDashboardShell` / `AgentDashboardShell` / `SubscriberDashboardShell` | **Composes** `DashboardNavProvider` + `DashboardPanelProvider`; exposes merged `useDashboard()` for back-compat | All four dashboard shells |
| `DashboardNavContext` | inside `DashboardContext` | URL-derived drill state `{ level, selectedIds, section, reportId }` + `drillDown / drillUp / goToLevel / reset` + `drillTargetBranchId/AgentId` + `onPanelActionRef`. `goToLevel` reads `pathnameRef.current` (Phase 4D `dbb46e4`) | Sidebar, Map, OverlayPanel, Breadcrumb |
| `DashboardPanelContext` | inside `DashboardContext` | **Strictly generic** after Phase 4C (`1c46f91`): submenu toggles + role-agnostic panel open states (`createBranchOpen`, `viewBranchesOpen`, `createAgentOpen`, `viewAgentsOpen`, `commissionsOpen`, `viewReportsOpen`, `settingsOpen`) + `reportContext` + `closeAllPanels()`. Subscriber-specific keys moved to `SubscriberPanelContext`. | Distributor + Branch panels |
| `SubscriberPanelContext` (`src/subscriber-dashboard/`) | `SubscriberDashboardShell` only | Subscriber-only panel extension that **wraps** `DashboardPanelProvider`. Extension surface (`subscriberMenuOpen`, `viewSubscribersOpen`, plus future subscriber-only state) lives here; `useSubscriberPanel()` returns the merged `{ ...generic, ...subscriberExtension }` object. | Subscriber pages + home widgets |
| `BranchScopeContext` | `BranchDashboardShell` only | `{ branchId }` for descendants — `value` is **memoized** (Phase 4A `e43de1f`) | ViewAgents, ViewReports, CommissionPanel when rendered inside Branch tree |
| `AgentScopeContext` | `AgentDashboardShell` only | `{ agentId }` for descendants — `value` is **memoized** (Phase 4A `e43de1f`) | All agent pages + home widgets + CoPilot |
| `EmployerScopeContext` | `EmployerDashboardShell` only | `{ employerId }` for descendants (verbatim clone of `BranchScopeContext`) — `value` **memoized** | All employer panels / report views / hero |
| `EmployerPanelContext` | `EmployerDashboardShell` only | **Net-new** (the generic `DashboardPanelContext` is hardcoded to branch/agent keys + wired to drill-down refs, so it isn't reused). Per-panel booleans `employeesOpen` / `employeeDetailOpen` (+ `activeEmployeeId` + `openEmployeeDetail`) / `runsOpen` / `insuranceOpen` / `kycOpen` / `reportsOpen` / `supportOpen` / `settingsOpen` / `onboardOpen` + `closeAllPanels()`. `value` **memoized**. `EmployerDashboardProvider` wraps it (analogous to `DashboardProvider`) so the shell nests with one component | All employer modules + sidebar |
| `AdminPanelContext` | `AdminDashboardShell` only | **Net-new** (mirrors `EmployerPanelContext`). Holds the admin-exclusive panels — `viewDistributorsOpen` / `createDistributorOpen` / `viewEmployersOpen` / `createEmployerOpen`, the employer-detail panel (`viewEmployerDetailOpen` + `detailEmployerId`), and `closeAllPanels()`. The admin shell ALSO mounts the generic `DashboardProvider`, so reused distributor panels keep using `DashboardPanelContext`; this context nests inside it. `value` **memoized** | `AdminSidebar` + the admin panels + `ViewEmployerDetail` |
| `DataScopeContext` (`src/contexts/DataScopeContext.jsx`) | `AdminDashboardShell` only | **Net-new.** Admin Platform Overview data scope (`all`/`distributors`/`employers`) — `{ scope, setScope, employerAware }`. **Distributor-isolation guarantee:** `useDataScope()` returns a frozen `{ scope:'distributors', employerAware:false }` default OUTSIDE a provider, so the shared `OverlayPanel` renders byte-for-byte as today for every non-admin role and never fires the admin-only `useEmployerGeoRollup` query (`enabled` gated on `employerAware`). `SCOPES` lives in `constants/scopes.js` (Fast-Refresh). `value` **memoized** | `AdminCountryOverview` + the shared `OverlayPanel` |
| `SignupContext` (`src/signup/SignupContext.jsx`) | `SignupPage` only | `useReducer` + debounced localStorage persist (`uganda-pensions-signup`); File/Blob fields + raw `password` stripped on serialise. Single `patch(payload)` + `reset()`. Mints `onboardingSessionId` (crypto.randomUUID). See §11 for debounce + beforeunload-flush detail | All 11 signup steps + contribution sub-flow + agent OnboardKycFlow |

**Cross-context handoff — `onPanelActionRef` pattern.** `DashboardNavProvider` exposes a ref; `DashboardPanelProvider` writes `{ setViewBranchesOpen, setViewAgentsOpen, setBranchMenuOpen, setAgentMenuOpen, setViewReportsOpen, … }` into it on mount. Map drill-down effects + overlay clicks invoke `onPanelActionRef.current?.setViewBranchesOpen(true)` so nav can drive panel state without a circular import or cyclic provider order.

### 6.1 Ref-based listeners (Phase 4D `dbb46e4`)

Two long-lived listeners on these contexts used to capture stale callbacks because their `useEffect` deps were `[]`. Phase 4D made both ref-based so they read the current callback every fire while subscribing only once on mount:

- **`DashboardNavContext.goToLevel`** — `useCallback` no longer depends on `location.pathname`. Instead, a `pathnameRef` is kept in sync via a separate effect, and `goToLevel` reads `pathnameRef.current` inside `parsePath(...)`. The callback identity is now stable across navigations (was rebuilt on every route change → cascaded re-renders).
- **`AuthContext.onAuthExpired` listener** — `logoutRef` and `navigateRef` are written every render; the subscription effect uses `[]` deps but its handler reads `logoutRef.current()` and `navigateRef.current('/')`. The 401 listener is now subscribed once for the app's lifetime, and always runs the current `logout` + `navigate`.

### 6.2 Role-leakage trap (resolved — was F5)

`DashboardPanelContext` previously carried subscriber-specific menu state (`subscriberMenuOpen`, `viewSubscribersOpen`) inside the same value bag that Branch and Distributor consumed. Phase 4C (`1c46f91`) split the context: the generic provider is now **strictly role-agnostic**, and subscriber-specific extensions land in `SubscriberPanelContext` (`src/subscriber-dashboard/SubscriberPanelContext.jsx`). The wrapper composes the generic provider so generic keys (`settingsOpen`, etc.) continue to flow through `useDashboardPanel()` / `useDashboard()` unchanged; subscriber-only consumers use `useSubscriberPanel()` which merges both layers.

The seam is the canonical pattern for any future role-specific panel state — keep `DashboardPanelContext` generic; build a `<Role>PanelContext` wrapper for role-specific keys.

### 6.3 Memoization status (Phase 4A `e43de1f`)

The audit flagged four context providers as building a new `value` object every render. All are now memoized:

| Context | Status |
| --- | --- |
| `SignInContext` | `value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close])` |
| `ToastContext` | `value = useMemo(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast])` |
| `BranchScopeContext` | `value = useMemo(() => ({ branchId: branchId || null }), [branchId])` |
| `AgentScopeContext` | `value = useMemo(() => ({ agentId: agentId || null }), [agentId])` |

`DashboardPanelContext`, `SubscriberPanelContext`, `AuthContext`, and `SignupContext` already use `useMemo` for `value`. **All provider values across the app are now memoized.**

---

## 7. Hooks inventory (`src/hooks/` — 10 files; the table below omits `useNotifications.js` + `useTickets.js`, documented in §5.5b / the tickets work)

| Hook file | What it returns | Side-effects | Wraps |
| --- | --- | --- | --- |
| `useEntity.js` | 17 named exports (entity reads + metrics rollup + mutations) | Optimistic patches, cache invalidation cascades — see §8 | `services/entities.js` |
| `useCommission.js` | 30+ named exports (reads + 16 mutations) | Coarse `invalidateAll(queryClient)` after every mutation | `services/commissions.js` |
| `useSubscriber.js` | 7 reads + 7 mutations | Mutations call `invalidateSubscriber()` (clears every `['subscriber*', ...]` key) | `services/subscriber.js` |
| `useAgent.js` | `useAgentSubscribers(agentId)` + `useUpdateSubscriberSchedule(subscriberId, agentId)` | Invalidates `['agentSubscribers', agentId]` | `services/agent.js` + `services/subscriber.js` |
| `useEmployer.js` | 8 reads (`useEmployer`, `useEmployees`, `useEmployee`, `useContributionRuns`, `useContributionRun`, `useEmployeeContributions`, `useEmployerMetrics`, `useEmployerLeaderboard`) + mutations (`useUpdateEmployerProfile`, `useRunContribution`, `useUpdateMemberCompensation`, `useApplyGroupInsurance`, `useRemoveEmployee`, invite mutations, admin `useCreateEmployer` / `useSetEmployerStatus`) + `invalidateAllEmployer(queryClient)` | Profile mutation optimistic (`onMutate`/`onError`/`onSettled`); `useRunContribution` is **NON-optimistic** (server re-derives the two legs) — `onSuccess` invalidates roster + employee + runs + metrics; **`useUpdateMemberCompensation(employerId)`** (v2, 0062 — sets the run driver field; `mutationFn: ({ employeeId, compensation }) → updateMemberCompensation`) and `useRemoveEmployee` (un-links a member — `subscribers.employer_id → NULL`, leaving `is_active` untouched; the person keeps an active subscriber account) and `useApplyGroupInsurance` (roster-wide flat cover) are plain invalidate-on-success → roster (`['employees', employerId]`) + metrics (`['employerMetrics', employerId]`) + every cached single employee (`['employee']`) | `services/employer.js` |
| `useIsMobile.js` | `boolean` | `useSyncExternalStore` over `matchMedia('(max-width: 768px)')` | — |
| `useIsDesktop.js` | `boolean` | `useSyncExternalStore` over `matchMedia('(min-width: 1024px)')` — desktop sibling of `useIsMobile`; gates the agent desktop fork | — |
| `useOutsideClick.js` | `void` (effect only) | `mousedown` + `Escape` listeners on `document` | — |
| `useCountUp.js` | `number` (animated target) | `requestAnimationFrame` ease-out-expo curve. Returns 0 when `run` is false (reduced motion) | — |
| `useDebouncedValue.js` | `T` (delayed) | Centralised debounce; `delayMs` defaults to 300; non-finite / negative coerced to 0 | — |

### 7.1 `useEntity.js` — query keys

| Hook | Query key |
| --- | --- |
| `useCountry()` | `['country']` |
| `useEntity(level, id)` | `['entity', level, id]` |
| `useCurrentEntity(level, selectedIds)` | derived (walks `selectedIds`) |
| `useChildren(level, parentId)` | `['children', level, parentId]` |
| `useAllEntities(level)` | `['entities', level]` |
| `useInfiniteEntityList(level, opts)` | `['entity-page', level, opts]` (cursor; `opts` = `{ search, statusFilter, sortKey, pageSize }`) |
| `useAllEntitiesMap(level)` | `['entitiesMap', level]` |
| `useTopBranch(level, parentId)` | `['topBranch', level, parentId]` |
| `useBreadcrumb(currentLevel, selectedIds)` | `['breadcrumb', currentLevel, selectedIds]` — see audit F13 |
| `useSearch(query)` | `['search', query]` (pair with `useDebouncedValue`, §7.8) |
| `useChildrenMetrics(parentLevel, parentId)` | `['childrenMetrics', parentLevel, parentId, ids]` |
| `useEntityMetrics(level, id)` | `['entityMetrics', level, id]` |
| `useAllEntitiesMetrics(level)` | `['allEntitiesMetrics', level, ids]` |
| `usePlatformOverview()` | `['platformOverview']` (admin; 5-min staleTime) |
| `useEmployerGeoRollup(enabled)` | `['employerGeoRollup']` (admin; 5-min staleTime; `enabled` = distributor-isolation guard — false outside the admin shell; invalidated by `useCreateEmployer`) |
| `useCreateBranch / useCreateAgent / useUpdateBranch / useSetBranchStatus / useUpdateDistributor` | mutations — invalidate `['entities', level]` (and `['entitiesMap', level]`) + ancestors |

Audit F13 flags `['breadcrumb', currentLevel, selectedIds]` — the `selectedIds` object identity is unstable across renders, so the cache thrashes. Known issue; see §16b.

### 7.2 `useCommission.js`

The 0029–0031 simplification removed the run / dispute / cadence / confirm hooks and added the settlement-upload + pending-dues hooks.

Read keys: `['commissionSummary', branchId]` · `['agentCommissions', focus]` · `['agentCommissionDetail', agentId]` · `['commissionSubscribers', agentId, filter]` · `['entityCommissionSummary', level, entityId]` · `['pendingDuesByAgent']` · `['pendingDuesByBranch']` · `['settlementsList', branchId, agentId, limit]` · `['commissionRate']`.

Mutations: `useApplySettlement` · `useSetCommissionRate`. (Plus the read hooks `usePendingDuesByAgent`, `usePendingDuesByBranch`, `useSettlementsList`.)

**Invalidation rule:** the settlement / rate mutations call `invalidateAll(queryClient)`, which invalidates the full `ALL_COMMISSION_KEYS` set (now including the pending-dues + settlements keys). Coarse but safe — a settlement ripples through every summary. The memoization layer on `CommissionPanel.jsx` filter pipelines (Phase 4H `b0e54a4`, F28) is preserved.

### 7.2b `useNotifications.js` (new)

Backs the notification bell. Hooks: `useNotifications` (`['notifications']`), `useUnreadNotificationCount` (`['notificationsUnread']`), `useMarkNotificationsRead` (mutation). Scoped via `useAgentScope` / `useBranchScope`.

**Single-source unread count + lockstep polling.** Both `useNotifications` (the feed list) and `useUnreadNotificationCount` (the badge) poll on the same `UNREAD_REFETCH_MS = 30_000` cadence, and the list query sets `refetchOnMount: 'always'` so opening the bell popover always shows the latest feed rather than a stale cached list. The two notification surfaces both read the unread count from the **same** `['notificationsUnread']` cache entry — `NotificationBell` via `useUnreadNotificationCount`, and `NotificationCenterCard` also via `useUnreadNotificationCount` (it does *not* count its own list) — so the header bell badge and the inline card badge can never disagree within a session. Cross-session delivery beyond polling is intentionally out of scope (realtime is off — CLAUDE.md §9 "Realtime publication").

**Mock-clock anchor for relative-time labels (BL-37).** The feed rows show a compact relative date (`formatRelativeTime`). Components never import the mock store (§4.1), so the *service* supplies the clock: in mock mode `listNotifications` stamps each row with `nowAnchor = currentTime().toISOString()` (the mock seed `createdAt`s are anchored to `MOCK_NOW`); in Supabase mode `nowAnchor` is `undefined` because the real `createdAt`s are wall-clock instants and `formatRelativeTime`'s default (wall clock) is correct. Both `NotificationList` and `NotificationCenterCard` pass `formatRelativeTime(n.createdAt, { now: n.nowAnchor })`.

**Bell a11y — non-modal disclosure, not a dialog (BL-21).** `NotificationBell`'s popover is a non-modal disclosure: the trigger `<button>` carries `aria-expanded` + `aria-controls` pointing at the labelled popover region (`role="region"` + `aria-label="Notifications"`, a `useId()`-generated id set only while open). It is **not** `role="dialog"` — that ARIA contract requires focus trap / initial-focus move / focus restore, which a lightweight popover does not implement (use the shared `Modal` primitive when those are needed). Escape + click-outside (shared `useOutsideClick`) close it.

**Unread-count a11y is standardised on the badge (BL-39).** Both the bell and the inline card expose the unread count the same way: the visible count badge carries `aria-label="N unread"`, and the trigger/card heading keep a static accessible name ("Notifications"). The bell button is no longer the count carrier (it previously read `"Notifications, N unread"`).

### 7.3 `useSubscriber.js`

| Hook | Query key |
| --- | --- |
| `useCurrentSubscriber()` | `['currentSubscriber', phone]` |
| `useSubscriberTransactions(id, filters)` | `['subscriberTransactions', id, filters]` |
| `useSubscriberClaims(id)` | `['subscriberClaims', id]` |
| `useSubscriberWithdrawals(id)` | `['subscriberWithdrawals', id]` |
| `useSubscriberNominees(id)` | `['subscriberNominees', id]` |
| `useSubscriberAgent(id)` | `['subscriberAgent', id]` |
| `useMakeContribution(id)` · `useRequestWithdrawal(id)` · `useUpdateSchedule(id)` · `useUpdateNominees(id)` · `useSubmitClaim(id)` · `useUpdateInsuranceCover(id)` · `useRenewPolicy(id)` · `useUpdateProfile(id)` | mutations |

All mutations call `invalidateSubscriber()` (from `services/subscriber.js`) which clears every `['subscriber*', ...]` key.

Audit X12 flags a cache-key inconsistency: `useSubscriber.useSubscriberTransactions` keys `[id, filters]` while `useAgent`'s agent-side equivalent variants drop `filters`. Cross-context cache key drift — see §16b.

### 7.4 `useAgent.js`

```js
useAgentSubscribers(agentId)       // ['agentSubscribers', agentId]
useUpdateSubscriberSchedule(subscriberId, agentId)
   // mutation invalidates ['agentSubscribers', agentId]
```

### 7.5 `useIsMobile.js`

```js
export function useIsMobile(): boolean
```

`useSyncExternalStore` over `matchMedia('(max-width: 768px)')`. Subscribes on mount; no polling.

### 7.5a `useIsDesktop.js`

```js
export function useIsDesktop(): boolean
```

`useSyncExternalStore` over `matchMedia('(min-width: 1024px)')` — the desktop sibling of `useIsMobile`. The 1024px threshold matches the `SideNav` / `BottomTabBar` CSS chrome toggles, so the JS fork and the CSS chrome flip at the same pixel (769–1023px keeps today's mobile behaviour). Drives the agent dashboard's desktop fork: `AgentShell` and every agent `*Page.jsx` call it after their hooks and `return <XDesktop/>` at ≥1024px (the mobile tree is byte-identical below 1024px). It is ALSO the selector for the DISTRIBUTOR (`DashboardShell` → `DistributorDesktopShell` | `DistributorMobileShell`), SUPER-ADMIN (`AdminDashboardShell` → `AdminDesktopShell` | `AdminMobileShell`), and EMPLOYER (§2.5) shells — the map-theme / desktop chrome stays byte-identical, and below 1024px the phone gets a routed app-bar + bottom-tab PWA shell (§2.1 / §2.6). Client-only SPA, so the synchronous first paint has no SSR/flash concern.

### 7.6 `useOutsideClick.js`

```js
export function useOutsideClick(active, onOutside, refs): void
```

Listens on `mousedown` (fires before trigger button's `onClick` — prevents close-then-immediately-reopen race) and `Escape`. `refs` is the "inside" set; click outside all of them triggers the handler.

### 7.7 `useCountUp.js`

```js
export function useCountUp(target, duration = 1100, run = true): number
```

`requestAnimationFrame` ease-out-expo curve. Used by `PulseCard` (subscriber) and `PortfolioPulseCard` (agent). Returns 0 when `run` is false (reduced motion).

### 7.8 `useDebouncedValue.js`

```js
export function useDebouncedValue<T>(value: T, delayMs?: number = 300): T
```

Centralised debounce. Returns `value` `delayMs` after it stops changing; non-finite / negative `delayMs` is coerced to `0` (avoids the `NaN`-silently-treated-as-0 footgun). Use this for search inputs (pair with `useSearch`), filter strings, slider-driven previews — anywhere downstream effects should only fire after the user pauses.

**Phase 2 coverage:** all four stateful hooks (`useEntity`, `useCommission`, `useSubscriber`, `useAgent`) now have unit tests at `src/hooks/__tests__/` — see §17. The earlier T6 gap is closed.

---

## 8. Canonical optimistic-mutation pattern (`useEntity` template)

Phase 4 ratified `useEntity`'s `useUpdateBranch` / `useSetBranchStatus` as the **canonical template** for future role-specific React Query mutations (F14). The pattern is:

```js
useMutation({
  mutationFn: (vars) => entitiesService.updateBranch(vars.id, vars.updates),
  onMutate: async ({ id, updates }) => {
    await queryClient.cancelQueries({ queryKey: ['entity', 'branch', id] });
    const prev = queryClient.getQueryData(['entity', 'branch', id]);
    queryClient.setQueryData(['entity', 'branch', id], (old) => ({ ...old, ...updates }));
    return { prev };                                     // snapshot returned to onError
  },
  onError: (_err, { id }, ctx) => {
    if (ctx?.prev) queryClient.setQueryData(['entity', 'branch', id], ctx.prev);
  },
  onSettled: (_data, _err, { id }) => {
    queryClient.invalidateQueries({ queryKey: ['entity', 'branch', id] });
    queryClient.invalidateQueries({ queryKey: ['allEntities', 'branch'] });
    queryClient.invalidateQueries({ queryKey: ['allEntitiesMap', 'branch'] });
  },
});
```

Four invariants:

1. **`onMutate` returns a snapshot.** `await cancelQueries` first so an in-flight refetch can't race the optimistic patch; then snapshot the relevant query data and apply the patch. The snapshot is the only payload `onError` can use to roll back.
2. **`onError` restores.** Never swallow the snapshot. Restoring before showing the error toast is the contract.
3. **`onSettled` invalidates the affected keys.** The cache is intentionally over-invalidated to cover ancestor lists (`allEntities`, `allEntitiesMap`) — coarse invalidation is safer than per-key reasoning.
4. **Mutation functions receive a single argument.** Pack vars into one object (`{ id, updates }`) so `mutate(...)` / `mutateAsync(...)` calls type cleanly and the args object is what `onMutate` / `onError` / `onSettled` receive.

The test file at `src/hooks/__tests__/useEntity.test.js` exercises every step of the dance — `cancelQueries` was called, the patch is applied synchronously after `mutate`, an error rolls the cache back to the pre-mutation snapshot, and `onSettled` invalidates the expected keys. Use it as the test scaffold for any new role-specific mutation hook.

---

## 9. Per-role dashboard variants — 5 built

### 9.1 Distributor Admin — `src/dashboard/`

| Field | Value |
| --- | --- |
| Shell | `DashboardShell.jsx` |
| Entry guard | `ProtectedDashboard` default branch (`hasDashboard(role)` true and role not in branch/agent/subscriber) |
| Scope context | none (`useBranchScope().branchId === null` → network-wide) |
| Sub-areas | `sidebar/`, `map/`, `overlay/`, `cards/`, `branch/`, `agent/`, `subscriber/`, `commissions/`, `reports/` (+ `views/`), `settings/`, `shared/` |
| Navigation | **Routes** drive drill level; **panels** drive overlays |

Routes are URL-driven drill levels (`/dashboard/regions/:id`, `/dashboard/districts/:id`, `/dashboard/branches/:id`, `/dashboard/agents/:id`, `/dashboard/subscribers/:id`, `/dashboard/reports[/:reportId]`) parsed by `DashboardNavContext.parsePath`. Slide-in panels (`ViewBranches`, `ViewAgents`, `ViewSubscribers`, `CommissionPanel`, `ViewReports`, `Settings`, `CreateBranch`, `CreateAgent`) are state-based via `DashboardPanelContext`. Map → panel handoff via `onPanelActionRef`. `CommissionPanel.jsx` (1097 lines) uses **replace-model** navigation — single panel swaps content with breadcrumb trail.

### 9.2 Branch Admin — `src/branch-dashboard/`

| Field | Value |
| --- | --- |
| Shell | `BranchDashboardShell.jsx` |
| Entry guard | `role === 'branch'` else `Navigate to="/coming-soon"`; `MissingBranchIdScreen` if `branchId` absent |
| Scope context | `BranchScopeProvider(branchId)` + `DashboardProvider` |
| Sub-areas | `sidebar/`, `overview/`, `agent/` |
| Navigation | Single main view; panels for everything else |

Single main view `BranchOverview` (no drill-down). Side panels reuse Distributor `ViewAgents`, `CommissionPanel`, `ViewReports`, `Settings` plus local `CreateAgent`, rendered with `splitMode` (backdrop suppressed; main reflows). `BranchHealthScore.jsx` (579 lines) — score gauge 0–100 from weighted formula (retention 30%, avg/subscriber 25%, agent activity 25%, growth 20%) + insights + contribution chart + embedded AI chat; its header now mounts the `NotificationBell` (branch-scoped). The old `BranchSettlementBanner` was deleted in the 0029 commission simplification (no more settlement runs).

**Mobile drawer (`BranchDashboardShell` + `BranchSidebar`).** On viewports ≤768px the sidebar is hidden and a `MobileHeader` + Framer slide-in `MobileDrawer` take over. The drawer slides in `x: '-100%' → 0` with `EASE_OUT_EXPO` over 320ms, locks body scroll, closes on Escape, and auto-closes on route change (a `useEffect` watching `location.pathname`). `BranchSidebar` accepts `mode='desktop'|'drawer'` + `onNavigate` — drawer mode renders a full-width vertical menu and invokes `onNavigate` after each item click so the drawer dismisses itself.

### 9.3 Agent — `src/agent-dashboard/`

| Field | Value |
| --- | --- |
| Shell | `AgentDashboardShell.jsx` (routed pages, mobile-first) |
| Entry guard | `role === 'agent'` else `Navigate to="/coming-soon"`; `MissingAgentIdScreen` if `agentId` absent |
| Scope context | `AgentScopeProvider(agentId)` + `DashboardProvider` (just for the shared `Settings` panel) |
| Sub-areas | `shell/` (SideNav + BottomTabBar + PageHeader + AgentShell + **AgentDesktopShell + AgentSideNavDesktop + AgentTopBar + agentNav.jsx**), `home/` (HomePage + **HomeDesktop** + widgets/ + **agentHomeSummary.js**), `onboarding/` (+ **OnboardFlow**), `pages/` (mobile pages + **`*Desktop.jsx` variants** + extracted `analytics/`, `commissions/`, `subscriber/`), **`inbox/`** (extracted thread bits) |
| Navigation | **All routed** — no Distributor-style drill panels |
| Responsive | Mobile-first below 1024px; **dedicated desktop tree at ≥1024px** via `useIsDesktop()` (§7.5a) — see the desktop-layout note below |

Home: 2 widgets — `PortfolioPulseCard` (dark indigo hero, count-up) + `CoPilotWidget` (see §13). The `SideNav` mounts the `NotificationBell` (agent-scoped) so settlement notifications surface in-app. KYC rule: every subscriber is KYC-verified by definition (no reminders, no filters).

Agent-side disputes were **removed** in the 0029 commission simplification — the agent no longer files disputes or confirms receipt; commissions simply read as Earned (`paid`) or Owed (`due`). The distributor settles them via the upload flow (BACKEND.md §11) and the agent is notified.

**Desktop layout (≥1024px).** A dedicated desktop tree, gated by `useIsDesktop()` (§7.5a), sits beside the shipped mobile-first one. `AgentShell` and every agent `*Page.jsx` fork *after* their hooks (`if (isDesktop) return <XDesktop/>`), so the mobile tree stays byte-identical below 1024px and no data layer changes (the `*Desktop` variants call the same hooks; React Query dedupes). Desktop chrome: `AgentDesktopShell` (fixed `sidebar | content` grid, `id="main"` scroll area, one shared `Settings` panel) + `AgentSideNavDesktop` (240px labelled indigo rail; icons/metadata shared with `BottomTabBar` via `shell/agentNav.jsx`; surfaces Home/Subscribers/Onboard/Analytics/Commissions + Settings + Inbox-with-unread-badge; one `NotificationBell`) + `AgentTopBar` (context eyebrow, **no `<h1>`** — each page body owns the single heading). Route variants — `HomeDesktop`, `SubscribersDesktop` (sortable `ReportTable`), `SubscriberDetailDesktop`, `SubscriberScheduleDesktop`, `AnalyticsDesktop`, `CommissionsDesktop`, `SettingsDesktop`, `InboxDesktop` (list↔thread split), `OnboardDesktop` — reuse `dashboard/shared/KpiCard` + `components/reports/ReportTable` and shared modules extracted from the mobile pages (`home/agentHomeSummary.js`, `pages/analytics/{deriveAnalytics,chartConfig}`, `pages/commissions/`, `pages/subscriber/SubscriberBadges`, `inbox/ThreadPanel` et al., `onboarding/OnboardFlow`). The old `shell/SideNav.jsx` is superseded by `AgentSideNavDesktop` (left mounted but never shown).

### 9.4 Subscriber — `src/subscriber-dashboard/`

| Field | Value |
| --- | --- |
| Shell | `SubscriberDashboardShell.jsx` (routed pages) |
| Entry guard | `role === 'subscriber'` else `Navigate to="/dashboard"` |
| Scope context | `SubscriberPanelProvider` (wraps `DashboardPanelProvider`) + `DashboardNavProvider` |
| Sub-areas | `shell/` (SideNav + BottomTabBar + PageHeader + navigation helpers + SubscriberShell), `home/` (HomePage + 6 widgets/), `pages/`, `reports/views/` |
| Navigation | **All routed** |

6 home widgets: `PulseCard`, `TopUpWidget`, `CoPilotWidget` (see §13), `PoliciesWidget` (insurance snapshot → `/dashboard/policies`), `ActivityWidget`, `IfYouNeedItWidget` (desktop only). Reports under `reports/views/`: `AllTransactions`, `ContributionsSummary`, `WithdrawalsHistory`, `InsuranceStatement`, `AnnualStatement`. `PoliciesPage` lists active/expired policies (derived — see §5.6) with a renew-by-payment sheet mirroring `SavePage`. All mutations are optimistic via the `_sessionMutations` log in `subscriber.js`.

`/settings/notifications` and `/settings/security` redirect to `/dashboard/settings` (deliberate `<Navigate replace>` — see §16b).

### 9.5 Employer — `src/employer-dashboard/`

| Field | Value |
| --- | --- |
| Shell | `EmployerDashboardShell.jsx` (desktop-first, mirrors Branch admin) |
| Entry guard | `role === 'employer'` else `Navigate to="/coming-soon"`; `MissingEmployerIdScreen` if `employerId` absent |
| Scope context | `EmployerScopeProvider(employerId)` + `EmployerDashboardProvider` (composes `EmployerPanelProvider`) |
| Sub-areas | `sidebar/`, `overview/`, `employees/`, `runs/`, `insurance/`, `reports/`, `tickets/`, `settings/`, `panels/` |
| Navigation | Single main view (`EmployerOverview`); panels for everything else (no drill-down, no sub-routes) |

Single main view `EmployerOverview` + state-based slide-in panels (`EmployerPanelContext`). The shell clones `BranchDashboardShell` (CSS grid, `MobileHeader` + `MobileDrawer` ≤768px with the same `EASE_OUT_EXPO` 320ms slide + body-scroll-lock + Escape + route-change auto-close). Panels mount as **siblings of `<main>`**, each `splitMode`, so the overview reflows beside an open panel (`PANEL_PADDING` map in `EmployerOverview`, same idiom as `BranchOverview`).

**Hero — `EmployerHealthScore.jsx`** (the centerpiece; file name retained, content **redesigned to the funder hero** — an employer is a funder, not a sales line, so the cloned branch scheme-health gauge / participation / employer-share / total-staff-balance KPIs were removed). The indigo dome + ambient glow + Copilot strip (wired to the `chat.js` mock) survive; the hero now **leads with "Total contributions to date"** (the total figure + a run-window sublabel — the old mini bar-trend of recent runs was removed), four funder tiles ("This month's contribution" + signed period-over-period delta, "Staff" headcount, "Avg / Employee", "Run cadence" → next run month), and a **monthly standing gauge** ("Monthly standing") filling the slot the participation gauge vacated — the employer's peer rank rendered in the Branch dashboard's score-gauge language via the shared `components/ScoreGauge.jsx` (the arc fills to the standing percentile, the centre overlays the rank `#N` + "of N", and a badge below shows this-month movement ▲/▼). Eyebrow "Company Overview", `<h1>` = company name, an "Employer" badge with green pulse dot, a `NotificationBell role="employer"`, an alerts row (whose middle tile is now **"Pending KYC"** — was "Without insurance" — opening the `PendingKyc` panel), and a "Today's Snapshot" activity column. Reads via the `useEmployer*` hooks (`useEmployerMetrics` + `useContributionRuns` + `useEmployerLeaderboard`); "this month" keys off the **newest run** (the seed runs predate the real clock, so a calendar-month lookup would read zero), and the standing gauge is pure presentation over the already-ranked `getEmployerLeaderboard` array (the underlying data path is unchanged — only the presentation changed, a gauge instead of a peer list; peer names/amounts are no longer shown). The leaderboard's peers come from the `LEADERBOARD_COMPETITORS` seed (`employerSeed.js`) merged with the employer's own newest-run total — see §5.12.

**Reusable panel chrome — `panels/EmployerSlidePanel.jsx`.** Every employer module (`ViewEmployees`, `ContributionRuns`, `InsuranceBenefits`, `EmployerReports`, `EmployerTickets`, `EmployerSettings`, `OnboardStaffPanel`, `PendingKyc`) wraps this one component instead of the centered shared `Modal` — it follows the branch panel idiom: a right-docked panel sliding from `x:'100%'` with `EASE_OUT_EXPO`, a Framer backdrop **suppressed when `splitMode`** (so the shell docks + reflows main beside it), `data-split-mode` for the flat split chrome, Escape-to-close, a `--panel-width` CSS var kept in sync with `PANEL_PADDING`, and an `eyebrow`/`title`/`headerActions` header.

Modules: **Overview** (hero + notifications + operations), **Employees** (`ViewEmployees` roster with a per-row Remove-from-company action + a read-only member detail rendered inline via `MemberDetailBody` — the standalone `EmployeeDetail.jsx` was removed in the employer-overhaul; employee pension balances are never shown to the employer), **Contribution Runs** (history + run detail + new-run wizard — the core write flow; server re-derives amounts, nonce-idempotent, **no commission side-effects** — see §5.12 + `BACKEND.md §10`), **Insurance/Benefits** (company-wide oversight), **Analytics** (`EmployerReports` — workforce demographic charts (gender / age / status / saving / roles / headcount growth) + downloadable reports via `downloadCsv`/`downloadSheet`; replaced the former 4-report hub), **Support** (`EmployerTickets` — employer↔platform threads **with a composer**; the employer raises + replies, unlike the view-only branch/distributor variants), **Settings** (profile + default contribution config + password). **Onboard members** (`OnboardStaffPanel`, opened from the Employees menu) offers **Single** (one invite-link) and **Bulk** (Excel template download → upload → per-row review → mass invite via `useBulkCreateInvites`) — name/phone/email only; gender + NIN are collected in the member's own KYC. **Pending KYC** (`PendingKyc`, `src/employer-dashboard/kyc/PendingKyc.jsx`) is a slide-in listing staff with pending KYC, each with a demo-only per-row "Nudge" (a success toast + a session-local "Reminded" marker — no real SMS, per demo scope); it is opened from the hero's "Pending KYC" alert tile via `kycOpen`/`setKycOpen` on `EmployerPanelContext` and is mounted in `EmployerDashboardShell.jsx`.

---

## 10. Commission UI patterns

| Surface | File | Pattern |
| --- | --- | --- |
| Distributor `CommissionPanel` | `src/dashboard/commissions/CommissionPanel.jsx` (rewritten, 1097 lines) | Slide-in. Distributor home = rate card + summary (Total / Settled / Outstanding — no Disputed) + pending dues (Branch⇄Agent toggle) + Download template + Upload settlement (with confirm modal) + settlement history. Keeps the agents → agent-detail → subscribers drill-downs. The disputed / dispute-detail / run-detail / run-branch-detail / branch-review / runs-history views were deleted. Accepts `splitMode` prop |
| Branch reuse | imported into `BranchDashboardShell` with `splitMode` | Read-only: own branch's dues + settlement history. Backdrop suppressed; reflows main beside |
| Agent `CommissionsPage` | `src/agent-dashboard/pages/CommissionsPage.jsx` | Routed page. Trimmed to Earned / Owed (Confirm + Disputes removed, dispute modal gone). Earned is grouped by paid month. |

**Settlement upload (distributor).** The distributor pays offline, downloads a per-agent Excel template prefilled with pending dues, fills Amount Paid + payment reference/date, and re-uploads. The frontend parses the sheet (`src/utils/xlsx.js` + `src/utils/settlement.js`), rounds each Amount Paid to whole UGX (canonical `parseAmount`), mints a per-upload idempotency nonce, and calls `applySettlementUpload({ rows, nonce })` → `apply_settlement` RPC, which FIFO-allocates the amount across the agent's `due` lines (covered lines → `paid`, uncovered stay `due`) and notifies the agent + branch. The confirm modal shows per-agent mismatches before applying (informs, does not block — a mismatch switches the confirm button to a cautionary amber "Settle despite mismatches" variant, BL-20); after applying, any server-skipped rows (`no_due`/`amount_too_low`) are held on a result panel that names each agent + a concrete fix rather than a count toast (BL-19). On a short-paid settlement the agent's commissions page raises an "Ask for reason" banner (a prefilled `mailto:` — demo affordance, not a backend integration). No cadence, no maker-checker, no agent confirmation.

**Notifications.** Agent + branch get an in-app `commission_settled` notification when their dues are settled, surfaced via the `NotificationBell` (`src/components/notifications/NotificationBell.jsx` + `NotificationList.jsx`) mounted in the agent `SideNav` and the branch `BranchHealthScore` header. The distributor bell is not mounted.

**Settlement RPC:** see BACKEND.md §11 for the two-state flow (`due → paid` via `apply_settlement`).

---

## 11. Signup / KYC flow

**Route:** `/signup/*`, lazy-loaded from `App.jsx`. State container: `SignupContext` in `src/signup/` (lives outside `src/contexts/` because it's flow-scoped).

**Steps (`SignupShell.STEPS`, in order):**

| # | id | Step | KYC service call |
| --- | --- | --- | --- |
| 1 | `id-upload` | `IdUploadStep` — front + back capture, inline quality check | `assessImageQuality`, `extractIdFields` |
| 2 | `review` | `ReviewStep` — OCR auto-fill + manual override; password chosen here | — |
| 3 | `nira` | `NiraStep` — silent NIRA match | `verifyNira` |
| 4 | `otp` | `OtpStep` — SMS OTP (any 6-digit code in demo) | `kyc.sendOtp` / `kyc.verifyOtp` |
| 5 | `liveness` | `LivenessStep` — selfie + face match, one retry | `faceMatch` |
| 6 | `aml` | `AmlStep` — silent sanctions / compliance | `screenAml` |
| 7 | `beneficiaries` | `BeneficiariesStep` — pension + optional insurance beneficiaries | — |
| 8 | `consent` | `ConsentStep` — plain-English summary + timestamp | — |
| 9 | `done` | `ActivatedStep` — success screen, member ID card | — |

> **Terminal transition (`SignupPage.SignupFlow`).** `consent` is the last step `SignupFlow` renders: activating it does **not** advance `goNext()` into a `case 'done'` here — it `navigate('/signup/contribution')`, and `ContributionRoute` mounts its own `<SignupShell stepId="done">` for the completion ring + `ActivatedStep`. So `STEPS` keeps the trailing `'done'` entry (it is the contribution route's wired terminal **and** the end-of-flow sentinel for the agent `OnboardKycFlow`, which fires `onComplete()` when `next.id === 'done'`), and `SignupFlow.renderStep()` has no `case 'done'` by design — its `default: null` covers only that intentionally-unhandled id.

**Terminal states** (outside the numbered sequence; freeze progress ring at `pausedAt`, hide back button):

| id | Trigger | Component |
| --- | --- | --- |
| `agent` (`AGENT_STEP`) | NIRA or liveness failure | `AgentFallbackStep` |
| `pending-review` (`PENDING_REVIEW_STEP`) | AML flag | `PendingReviewStep` |

### 11.1 SignupContext persistence (`SignupContext.jsx`, Phase 4H `b0e54a4`)

- `useReducer` (`patch` / `reset`) + a **debounced** `useEffect` that writes to `localStorage['uganda-pensions-signup']` 300ms after the last state change (instead of synchronously on every keystroke). Replaces the old "30+ writes during signup" pattern flagged by audit F15.
- A second `useEffect` registers a `beforeunload` listener that **flushes the pending debounce on tab close / refresh** so the final keystroke is never dropped.
- Lazy initialiser reads persisted state; ephemeral fields are re-nulled on rehydrate.
- **`EPHEMERAL_KEYS = ['idFrontFile', 'idBackFile', 'selfieFile', 'idFrontPreviewUrl', 'idBackPreviewUrl', 'password']`** dropped on serialise. User re-uploads images on refresh; OCR result + phone + beneficiaries + consent + KYC outcomes survive. **Raw passwords MUST NOT touch localStorage** — `password` lives in memory only and is re-entered on remount if the user navigates back to `ReviewStep`.
- `onboardingSessionId` minted via `crypto.randomUUID()` (fallback to time+random) — backend uses it to correlate every KYC stage.
- **Wizard position (`stepId`) is persisted** (non-ephemeral string in `SignupContext`, written by `SignupFlow.goTo`) so a mid-flow refresh resumes the user's step instead of dropping to step 1 (BL-22). `SignupFlow` lazily rehydrates via `resolveResumeStep()`, which **clamps** the persisted step back to the first file-gated step (`id-upload`, then `liveness`, in flow order) whose re-uploadable File is now `null` after the refresh — preserving the documented "re-upload files on refresh" behaviour without letting the user land past an empty upload gate. Terminal screens (`agent`/`pending-review`) route via `setStepId` (not `goTo`) and are intentionally **not** persisted, so a refresh on a failure screen resumes the last real step that preceded it.
- `src/signup/signupState.js` now exports only `SIGNUP_STORAGE_KEY` (the canonical `'uganda-pensions-signup'` localStorage key, consumed by `SignupContext`). The old `isSignupComplete()` / `readSignupState()` helpers were removed: `SignInModal.handleVerify` no longer inspects localStorage to choose a destination — it trusts the `verify-otp` response (which resolves or falls back to a real server subscriber row) and routes purely by role (`hasDashboard(user.role) ? '/dashboard' : '/coming-soon'`).

### 11.2 Contribution sub-flow (`/signup/contribution`)

- `ContributionRoute.jsx` — route entry. Renders inside `SignupFlow` when the pathname ends with `/contribution` so step-state is preserved.
- `ContributionSettings.jsx` (569 lines) — frequency (weekly/monthly/quarterly/half-yearly/annually via `FREQUENCY` constants), amount, retirement/emergency split.
- `PaymentStep.jsx` — initial funding step.
- On confirm: patches `contributionSchedule` into `SignupContext` → calls `createFromSignup(payload)` (RPC `create_subscriber_from_signup`, see BACKEND.md §10) which mints the real subscriber row + JWT → `auth.login({ token, user })` → `navigate('/dashboard')`.

---

## 12. Modal & drawer primitives, accessibility

### 12.1 Modal primitive (`src/components/Modal.jsx`)

Single shared dialog used by every confirm / destructive-action surface — `CommissionsPage` dispute modal, `CommissionPanel` dispute-resolution + line-action + run-release modals, `ViewBranches` confirm-status. Always prefer this over a bespoke fixed-position div.

```jsx
<Modal
  open={open}
  onClose={onClose}
  title="Confirm release"            // visible-to-AT (sr-only); render your own heading inside children
  size="md"                          // 'sm' 380px | 'md' 480px (default) | 'lg' 640px
  dismissOnBackdrop                  // default true
  labelledBy="my-heading-id"         // optional override; skips the sr-only h2
  describedBy="my-body-id"           // optional aria-describedby
>
  {/* your content */}
</Modal>
```

Behaviour contract (the audit called this file **exemplary** — match this template if you ever build another modal):

- **Portal.** Renders into `document.body` so it escapes any transformed / overflow-clipped slide-in panel that hosts the trigger. `role="dialog"` + `aria-modal="true"` + auto-generated `aria-labelledby` (use the `title` prop) on the inner surface.
- **Focus.** On open, captures `document.activeElement` and moves focus to the first focusable element inside the dialog (falls back to the dialog container if none). On close, restores focus to the previously focused element. Tab / Shift+Tab cycle inside the dialog (focus trap).
- **Escape.** Calls `onClose` and fires `preventDefault + stopPropagation + nativeEvent.stopImmediatePropagation()` so outer slide-in panels do NOT also close. Verified by E2E spec `e2e/specs/regression/modal-escape.spec.ts`.
- **Backdrop dismiss.** Requires `mousedown` AND `mouseup` both on the backdrop element (`e.target === e.currentTarget`). Prevents drag-out misfires.
- **Body scroll lock.** `document.body.style.overflow = 'hidden'` while open; restores the previous value on close.
- **Z-index.** Backdrop at `1000` — sits above slide-in panels (panel z-index `210`).
- **Animation.** AnimatePresence wraps in / out. Backdrop fades; surface scales `0.96 → 1` + slides `12 → 0`, easing `EASE_OUT_EXPO`, 250ms.
- **Mobile.** Surface goes full-screen with safe-area insets; border-radius collapsed.
- **SSR safety.** Returns `null` when `typeof document === 'undefined'`.

Tests live alongside the component (`Modal.test.jsx`).

### 12.2 Slide-in panels (Distributor + Branch)

- Backdrop: `position: fixed; inset: 0; background: rgba(27,26,74,0.35); z-index: 200`. Hidden in `splitMode`.
- Panel: `position: fixed; top/right/bottom: 16px; width: 460–680px; z-index: 210; border-radius: var(--radius-xl)`.
- Body background: `linear-gradient(180deg, #F8F9FC 0%, #F0F1F8 100%)` (solid; **not** glassmorphism for inner content).
- Framer Motion: `initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}` with `EASE_OUT_EXPO`.
- Mobile (≤768px): full-screen with safe-area insets, no border-radius.
- Escape closes; internal state resets after a 400ms delay.
- `splitMode` prop suppresses backdrop and lets the parent reflow main content beside the panel (used by `BranchOverview`).

### 12.3 Accessibility baseline

The audit confirmed **0 anti-pattern hits** on the two highest-leverage rules — no `outline: none` without a paired focus replacement, and no `transition: all`. ARIA coverage is solid. This is a baseline worth preserving.

- **Focus visibility.** Global `:focus-visible` baseline in `index.css` (2px `var(--color-indigo-soft)` outline + 2px offset). Per-control overrides exist for `button:focus-visible` / `a:focus-visible`. `outline: none` only appears inside `:focus` rules that also set a custom `border-color` ring — never unpaired.
- **Transitions.** Never `transition: all` — always list properties explicitly.
- **Reduced motion.** `<MotionConfig reducedMotion="user">` in `main.jsx`. CSS `prefers-reduced-motion` media query in `index.css` for non-Framer animations.
- **Icon-only buttons.** Must have `aria-label`. `title` alone is not sufficient.
- **Form inputs.** `aria-label` or associated `<label>`; correct `type` / `inputMode` / `autoComplete`; `spellCheck={false}` on OTP / phone.
- **Touch targets.** `touch-action: manipulation` set globally on buttons + links. Minimum 44px height on mobile.
- **Skip link.** `index.html` has a `<a href="#main" class="skip-link">` anchor. `<main id="main">` is on `App.LandingPage`, `BranchDashboardShell`, `SubscriberShell`, and agent `AgentShell`.
- **Typography.** `text-wrap: balance` on headings. `font-variant-numeric: tabular-nums` on number / stat displays. Use the literal `…` character (U+2026), not three dots — JSX text does NOT resolve `\u` escapes.
- **Images.** All `<img>` need explicit `width` and `height`. Below-fold images use `loading="lazy"`.
- **Large lists.** `content-visibility: auto` with `contain-intrinsic-size` (applied in `ViewBranches` / `ViewAgents` / `ViewSubscribers`). Use `useVirtualizer` from `@tanstack/react-virtual` for lists over a few hundred items.
- **Decorative icons.** SVGs that are purely decorative (next to a text label) must have `aria-hidden="true"`.
- **Live regions.** Drill-level changes are announced via an `aria-live="polite"` `NavAnnouncer` in `DashboardShell`. Signup step transitions move focus into the new step container (`mainRef` in `SignupShell`).

---

## 13. CoPilotWidget convention (intentional duplication)

The subscriber and agent dashboards each ship their own `CoPilotWidget.jsx`:

- `src/subscriber-dashboard/home/widgets/CoPilotWidget.jsx`
- `src/agent-dashboard/home/widgets/CoPilotWidget.jsx`

Audit F26 reviewed extracting a shared `CopilotShell`. Phase 4I (commit `f60bed1`) **kept both files separate** and added a JSDoc to each calling out the intentional duplication. The divergences are larger than the shared chrome:

- **CSS modules diverge.** Subscriber uses `.avatar`, `.avatarRing`, `.glowA/B`, `.composerIcon`, `.headText`, `.eyebrowDot`, `.pills/.pill`, `.suggestionsLabel`. Agent uses `.eyebrowSpark`, `.suggestionBtn`, `.suggestionDot`, `.suggestionItem`. Different role-appropriate aesthetics, not stylistic accidents.
- **Header DOM differs.** Subscriber has avatar + glow elements + `.headText` wrapper. Agent has inline eyebrow + simpler structure.
- **Composer differs.** Subscriber has a leading sparkle icon prefix; agent doesn't.
- **Suggestions DOM differs.** Subscriber has a pills-grid. Agent has `ul/li` with dot separators.
- **Reply logic differs in shape.** Subscriber makes an async service call + try/catch + toast errors. Agent runs a sync keyword matcher with no error path.

A shared shell would have to standardise the CSS contract (visual change) or pass classNames / slot content through, adding more glue than it removes. **Keep the two files in lockstep visually only where it makes design sense.** Any change to one must check whether the other should mirror.

---

## 14. Performance posture

- **Manual vendor chunks** (vendor-leaflet / -charts / -motion / -tanstack / -router / -react) keep the landing page bundle small — see §1. `chunkSizeWarningLimit: 700` is intentionally higher than Vite's 500 default for routes that legitimately carry recharts or leaflet.
- **Lazy-loaded dashboard shells.** All four shells (`DashboardShell`, `BranchDashboardShell`, `AgentDashboardShell`, `SubscriberDashboardShell`) are `React.lazy()`-imported from `App.jsx`. `SignupPage` is also lazy. Each sub-page inside the agent + subscriber shells is independently lazy (so e.g. `HomePage` paints without paying for `AnalyticsPage`).
- **Memoization conventions.** Every list page memoizes filters with `useMemo`; mutation hooks return memoized callbacks; map drill state derives from URL via `useMemo`. All four context-value gaps flagged by the audit are now memoized (§6.3).
- **`useEntityMetrics` / `useChildrenMetrics` / `useAllEntitiesMetrics`** are the canonical paths for the 8-field metrics rollup. `getDistributorMetrics` was retired — every caller now uses `useEntityMetrics('country', 'ug')`, which routes through `getEntityMetricsRollup` → `get_entity_metrics_rollup` RPC. One round-trip replaces the old 4-call fan-out.
- **Loading + empty primitives.** `SkeletonRow` (variants: `avatar` / `compact` / `card`) + `EmptyState` (`kind: 'no-data' | 'no-match'`) form a triad with `useQuery` — every list-style view panel exposes loading → empty (zero data) → empty (filter mismatch).
- **Lazy GeoJSON (Phase 4F `c3c28c3`).** `UgandaMap.jsx` now lazy-loads the 180KB `uganda-districts.geojson` (was eager every mount). Per-feature style callbacks use a `WeakMap` cache to avoid re-styling on every drill change (F10, F11 addressed).
- **Stable refs (Phase 4D `dbb46e4`).** `goToLevel` and `onAuthExpired` listeners are now ref-based — identity stable across renders (§6.1).
- **Signup persist debounce (Phase 4H `b0e54a4`).** 300ms debounce + beforeunload-flush replaces the per-keystroke localStorage write (F15 addressed; §11).

---

## 15. Shared utilities, constants & component subdirs

### 15.1 `src/utils/` (15 files)

| File | Key exports |
| --- | --- |
| `finance.js` | `MONTHLY_RATE`, `ANNUAL_RATE`, `FREQUENCY` constants, `FREQUENCY_LABEL`, `normalizeFrequency`, `periodsPerYear`, `monthlyEquivalent`, **`parseAmount`** (the canonical money parser — strips grouping/currency, parses decimals, **rounds to a whole-UGX integer**, returns `null` for blank/non-finite/non-positive; `settlement.js` imports this, no second copy), `calcFV`, `sliderToAmt`, `amtToSlider`. **Re-exports `EASE_OUT_EXPO` from `./motion` for backwards compat** (commit `fccfa7b`). Money *rendering* lives in `currency.js` (`formatUGX` / `formatNumber` / `formatUGXShort`) — `finance.js` no longer re-exports the old `formatUGX` / `formatUGXExact` / `fmtShort` shims. |
| `motion.js` | `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]` — canonical Framer Motion easing curve (Phase 5D promoted from inline). Mirrors `--ease-out-expo` CSS token in `src/index.css`. |
| `navigation.js` | `goBackOrFallback(navigate, fallback)` — extracted in Phase 4B (`bd5ea82`); reads `window.history.state.idx` to detect a poppable in-app entry. See §4.1. |
| `currency.js` | `formatUGX(value, { compact? = true })` (compact `'UGX 1.2M'` / exact `'UGX 50,000'` — non-positive → `'—'` in compact mode, `'UGX 0'` in exact), `formatNumber(value)` (locale-grouped count `'12,345'` — non-finite → `'0'`), `formatUGXShort(value)` (axis-label form `'1.2M'`, no UGX prefix). Single source of truth for money rendering. |
| `date.js` | `formatDate(value, { variant? = 'short' })`. Variants: `short` `'8 Apr 2026'` · `long` `'8 April 2026'` · `time` `'14:32'` · `month-year` `'April 2026'` · `short-month-year` `'Apr 2026'` · `day-month` `'8 Apr'`. Accepts `Date | ISO string | epoch ms`; returns `'—'` for unparseable / null input (UI never shows "Invalid Date"). |
| `dashboard.js` | `getInitials` (defensive), `getTrend`, `perfLevel` |
| `csv.js` | `toCsv(rows, columns)`, `toCsvStream(rows, columns)` (async-iterable), `MAX_ROWS`, `downloadCSV(filename, headers, rows)` legacy. RFC 4180 escape + OWASP formula-injection defence (`= + - @ \t \r` prefixed with `'` and quote-wrapped) + UTF-8 BOM. |
| `csvDownload.js` | `downloadCsv({ rows, columns, filename, isMobile?, onCapNotice? })`, `dateStampedFilename(slug)`, `MOBILE_ROW_CAP = 5000`, `STREAM_THRESHOLD = MAX_ROWS`. Composes `toCsv` / `toCsvStream` with the browser-side Blob + hidden `<a download>` trigger; caps mobile exports at 5,000 rows and fires `onCapNotice({ capped, total })` so callers can surface a toast without coupling the util to a toast context. |
| `phone.js` | `parseUGPhoneLocal`, `isValidUGPhone`, `formatUGPhone`, `toCanonicalUGPhone` (9-digit local, valid prefixes `70/71/74/75/76/77/78`, canonical storage `+256XXXXXXXXX`) |
| `xlsx.js` (new) | `downloadSheet(...)`, `parseSheet(...)`. Client-side Excel I/O; **lazy-imports** the `xlsx` (SheetJS) dependency so it only loads when a template is downloaded/uploaded (split into the `vendor-xlsx` chunk — see §1). `parseSheet` is **hardened before the bytes reach SheetJS** (B-Excel / BL-14 defense-in-depth): rejects files over **5 MB** (`MAX_UPLOAD_BYTES`) on the declared `.size` (never calls `arrayBuffer()` on an oversize file), validates extension (`.xlsx/.xls/.csv`) and a clearly-wrong MIME type (the input `accept` attr is a non-enforced hint), and passes `{ sheetRows: 50_000 }` (`MAX_PARSE_ROWS`) to `XLSX.read` to bound the row walk. Every rejection returns the same `{ rows: [], errors }` shape with a human-readable first error. The `xlsx` dependency is the **SheetJS-maintained CDN build** (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, pinned in `package.json`), which carries the prototype-pollution + ReDoS fixes the abandoned npm `0.18.5` build never received (same API; clears the `npm audit` finding — BL-14). The parse-hardening above remains as defense-in-depth. |
| `settlement.js` (new) | `SETTLEMENT_TEMPLATE_COLUMNS`, `REQUIRED_UPLOAD_COLUMNS` (`Agent ID` + `Amount Paid (UGX)` — the headers a row needs to settle), `buildTemplateRows(...)` (prefill the per-agent template from pending dues), `detectMissingColumns(rawRows)` (order-independent header-mapping check → `{ ok, missing, found }`; the panel surfaces "expected vs found" when a distributor renames/reorders headers, instead of an opaque per-row skip), `normalizeUploadedRows(...)` (parse + validate the re-uploaded sheet into `apply_settlement` rows — money via the canonical `parseAmount`), `formatSettlementNotificationBody(amount, lineCount)` (canonical "UGX 25,000 paid for N commissions." body, mirrored by the RPC), `SETTLEMENT_SKIP_REASONS` + `describeSkippedReason(reason)` (one `{ label, fix }` source of truth for every skip reason — client `missing_agent_id`/`no_amount` and server `no_due`/`amount_too_low` — so the confirm modal and the post-settlement result panel name each skipped agent with a concrete fix; BL-19). |
| `commissionMonths.js` (new) | `groupByPaidMonth(...)` — buckets paid commissions by month for the agent Earned view. |
| `settlementCycle.js` | **Deleted in the 0029 commission simplification** (along with its test) — cadence-based payout cycles no longer exist. |
| `memberId.js` | `formatMemberId(phone)` — renders a subscriber's member ID from their phone (used on certificates / policy surfaces). |
| `policies.js` | `derivePolicies(subscriber, { now, renewalOverrides })`, `derivePolicyStatus`. Pure: builds the subscriber's insurance policy list — **one entry per real `insuranceProducts` row** (life/health/funeral, migration `0063`), with a legacy single-life fallback from `subscriber.insurance` when that array is empty. Computes `active`/`expired` from the renewal date. (The old phone-hash `synthesizeHealthPolicy`/`hashId` were removed.) **Must NOT import mockData (§4.1)** — the service passes `now = currentTime()`. Consumed by `services/subscriber.js` (`attachPolicies`), `PoliciesPage`, and `PoliciesWidget`. Tested in `policies.test.js`. |
| `periodSettlement.js` | `paidThisMonth(txns, now)`, `contributionOwed(amount, paid)`, `newlyAddedProducts(prev, next)`, `buildSettleLineItems({owed, addedProductIds, freqPerYear})`. Pure money-math for the schedule "settle this period" prompt (the demo clock + txn feed are passed in). Distinct from the distributor `settlement.js`. Tested in `periodSettlement.test.js`. |
| `sentryScrub.js` (new) | `scrubEvent`, `scrubBreadcrumb`, `scrubValue`, `scrubString` — the frontend Sentry PII scrubber wired into `src/main.jsx`'s `beforeSend`/`beforeBreadcrumb` (BL-26 / H-4). Redacts Ugandan phone numbers, `role:phone` ids (the JWT `sub`), bearer tokens / JWTs, and password/auth fields from event messages, exception values, breadcrumbs, request data/headers, extra, contexts, and user. Pure (no Sentry import) so it unit-tests cleanly. **Intentionally identical to `server/sentryScrub.ts`** (the `@sentry/node` half) — separate build graphs, keep the two in sync. |

**Frequency normalisation rule:** ALWAYS pass schedules through `normalizeFrequency(value)` — defends against legacy aliases (`half-yearly`, `halfYearly`, `semi-annually`, `semiAnnually`).

### 15.2 `src/constants/` (3 files)

| File | Exports |
| --- | --- |
| `levels.js` | `LEVELS`, `LEVEL_ORDER`, `CHILD_LEVEL`, `PARENT_LEVEL`, `LEVEL_TO_SEGMENT`, `SEGMENT_TO_LEVEL` |
| `savings.js` | `RETIREMENT_AGE` (60), `START_AGE` (25), `MIN_CONTRIBUTION` (5000), `MIN_WITHDRAW` (5000), `INSURANCE_PREMIUM_MONTHLY` (2000), `INSURANCE_COVER` (1000000), **`INSURANCE_PRODUCTS`** (configurable health/funeral/life list — `{id,label,blurb,icon,premiumMonthly,cover}` — drives the contribution-form insurance picker + the settle/derive flows), **`PRESETS_BY_FREQUENCY`** + `presetsForFrequency(freq)` (frequency-tuned quick-pick amounts for the signup + schedule-edit forms; every value ≥ `MIN_CONTRIBUTION`), `MOBILE_QUICK_CONTRIBUTION_AMOUNTS` (subscriber mobile Save top-up presets) |
| `signup.js` | `OCCUPATIONS`, `RELATIONSHIPS`, `GENDERS` (id/label pairs for onboarding selects) |

### 15.3 `src/config/env.js`

`API_BASE_URL`, `IS_DEV`, `IS_PROD`, plus public marketing URLs (`LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `SUPPORT_WHATSAPP_URL`, `SUPPORT_WHATSAPP_DISPLAY`, `SUPPORT_EMAIL`) and `MAP_TILE_URL` (default CartoDB Positron). Phase 7A (`27b78a3`) finished the env-template hardening: `.env.local.example` now lists every consumed `VITE_*` key.

### 15.4 Shared component subdirs under `src/components/`

| Subdir | Files | Purpose |
| --- | --- | --- |
| `contribution/` | `ContributionSettingsForm.jsx` (339 lines) + module CSS | Reusable schedule form (frequency + amount + split + insurance + summary + sticky footer). Used by subscriber `SchedulePage`, agent `SubscriberSchedulePage`, and `OnboardScheduleStep`. Parent must guard render until `initial` is loaded. |
| `signin/` | `RoleSelect`, `DistributorSelect`, `PhoneEntry`, `OtpVerify`, `PasswordEntry` | Sign-in modal sub-steps. `PasswordEntry` is migrated to the global `.input` primitive (composes-from-global) — F16 addressed (Phase 5B `7f2c782`). |
| `reports/` | `ExportButton`, `FilterSelect`, `ReportTable`, `SearchFilter` | Distributor + Subscriber report views share these primitives. |
| `feedback/` | `ErrorCard` | Friendly error rendering used by KYC steps + agent shell. |

### 15.5 Loading + empty primitives (top-level `src/components/`)

- **`SkeletonRow.jsx`** — virtualised-row placeholder. Props: `count = 8`, `variant ∈ { 'avatar' | 'compact' | 'card' }` (default `'avatar'`), `label = 'Loading…'` (accessible busy label for `role="status"`), optional `className`. Each row mirrors a real list item (avatar + two text lines + small numeric block — or a card-shaped stat strip in `'card'` variant). Shimmer reuses the same lavender→white sweep + `EASE_OUT_EXPO` as MetricsRow's skeleton, so every loading state in the dashboard reads as one system; `prefers-reduced-motion` halts the sweep.
- **`EmptyState.jsx`** — list/grid empty-state. Props: `kind ∈ { 'no-data' | 'no-match' }` (mandatory; drives icon + default copy), `title?`, `body?`, `cta?: { label, onClick, icon? }`, `icon?` (override), `className?`. Distinguishes a genuinely empty source (`no-data`) from a non-empty source filtered to zero (`no-match` — "No matches — try adjusting your search or filters"). Pair with `SkeletonRow` so each panel exposes loading → empty (zero data) → empty (filter mismatch).
- **`ScoreGauge.jsx`** — shared 270° radial arc gauge (0–100 fill); used by the Branch health score and the Employer monthly standing. Unique SVG ids via `useId` (multiple gauges can render on one page without their `<defs>` clashing); respects `prefers-reduced-motion` (snaps to the final fill).
- **`MemberCard.jsx`** — the light/clean Universal Pensions membership card (white surface + lavender hairline + indigo→teal top-accent stripe, indigo name, `formatMemberId(phone)` id, green tier pill, Enrolled/DOB/Gender footer). Formats dates internally so callers pass raw Date/ISO values. Props: `fullName`, `memberId`, `enrolled`, `dob`, `gender`, `tier?`, `className?`. Reused on the self-signup completion (`ActivatedStep`), the agent onboarding completion (`OnboardingComplete`, shown once the record saves), and the subscriber `ProfilePage`. Replaced the former oversized indigo-gradient card.

### 15.6 `src/dashboard/shared/` (Distributor + Branch reuse)

`Stars`, `KpiCard`, `Demographics`, `MiniChart`, `TrendArrow`, `Icons`.

### 15.7 Per-session mutation stores (mock fallback)

- `entities._entityOverrides` — `setBranchStatus`, `updateBranch`, `createBranch`, `createAgent` layer over frozen mockData.
- `subscriber._sessionMutations` — contributions, withdrawals, schedule edits, nominees, insurance, profile, claims layer over frozen mockData. Reset on page reload.

---

## 16. Design tokens, brand palette & animation

**CSS Modules architecture.** 118 `.module.css` files (one per component). **No Tailwind anywhere.** Global tokens + base styles live in `src/index.css`; Vite resolves `*.module.css` imports as hashed scoped class objects (`import styles from './X.module.css'`).

### 16.1 Brand & palette

- **Primary colour:** Universal Indigo `#292867`. Anchors key headings, primary buttons, hero emphasis, important icons.
- **Reserve red** for error/destructive/critical only — never as a major brand colour.
- **Typography.** Display: Plus Jakarta Sans (`--font-display`) — headings, hero numbers, buttons. Body: Inter (`--font-body`). Headings `font-weight: 800; letter-spacing: -0.03em; color: var(--color-indigo)`.
- **Visual style.** Bold clean headings · large readable numbers · smooth card surfaces · restrained gradients · subtle depth · consistent iconography · motion tied to meaning. Avoid noisy visuals, decorative complexity, neobank flashiness.
- **Animation philosophy.** Animation is a meaning layer — communicates time passing, money growing steadily, milestones reached, confidence building. Smooth, editorial/studio-grade. Use `EASE_OUT_EXPO` for entrance; staggered children 0.05–0.1s; item reveal `{ opacity: 0, y: 12–24 } → { opacity: 1, y: 0 }`; `AnimatePresence mode="wait"` for step transitions.

### 16.2 Token excerpt (`src/index.css`)

```css
/* Brand */
--color-indigo:        #292867;
--color-indigo-deep:   #1B1A4A;
--color-indigo-soft:   #5E63A8;
--color-lavender:      #D9DCF2;
--color-cloud:         #F6F7FB;
--color-slate:         #2F3550;
--color-gray:          #8A90A6;
--color-green:         #2E8B57;
--color-teal:          #2F8F9D;
--color-white:         #FFFFFF;      /* Phase 5E (56c4839) */
--color-on-indigo-muted: rgba(255,255,255,0.78);  /* Phase 6 — muted caption/eyebrow over the indigo hero dome (≥4.5:1 AA) */

/* Status */
--color-status-good:     #2E8B57;
--color-status-warning:  #E6A817;
--color-status-poor:     #DC3545;

/* KYC status (Phase 5A 1b13e2e — F18) */
--color-kyc-success:      #1f6e44;
--color-kyc-warning:      #8B5A00;
--color-kyc-warning-dark: #876300;
--color-kyc-warning-amber:#c47c00;
--color-kyc-pending:      #B8860B;
--color-kyc-error:        #b22834;
--color-kyc-error-soft:   #FB7185;

/* Health & trend accents (branch + subscriber) */
/* ⚠️ Dome-only accents — see the contrast note below this code block. */
--color-positive:        #4ADE80;
--color-positive-soft:   #818CF8;
--color-accent-mint:     #2DD4BF;
--color-amber:           #FBBF24;
--color-alert:           #F87171;

/* Leaderboard medals */
--color-medal-gold:      #FBBF24;
--color-medal-silver:    #94A3B8;
--color-medal-bronze:    #CD7F32;

/* Breakpoints (Phase 5C ee78074 — F19; documentation tokens) */
--bp-sm: 480px;       /* small mobile */
--bp-md: 768px;       /* large mobile / portrait tablet */
--bp-lg: 1024px;      /* landscape tablet / small desktop */
--bp-xl: 1280px;      /* desktop / wide layouts */

/* Glass / layout */
--glass-bg:              rgba(255, 255, 255, 0.82);
--glass-bg-dark:         rgba(27, 26, 74, 0.85);
--glass-border:          rgba(217, 220, 242, 0.5);
--glass-blur:            16px;
--sidebar-width:         64px;
--map-bg:                #E8EAF0;

/* Easing */
--ease-out-expo:         cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out:           cubic-bezier(0.4, 0, 0.2, 1);

/* Subscriber-mobile redesign (Phase 6) — see also --color-on-indigo-muted in the Brand block */
--radius-capsule:        3rem;                                                        /* elliptical bottom-curve depth of the hero dome */
--gradient-hero:         linear-gradient(180deg, var(--color-indigo-deep), var(--color-indigo));  /* paints the HeroCapsule dome — indigo-deep → brand indigo */
```

Plus full scales for `--text-xs`…`--text-7xl`, `--space-1`…`--space-32`, `--radius-sm/md/lg/xl/full/capsule`, `--shadow-sm/md/lg/xl`. The shared easing curve `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]` is exported from `src/utils/motion.js` (re-exported from `src/utils/finance.js` for backwards compat) and mirrored as `--ease-out-expo`. The three subscriber-mobile tokens (`--color-on-indigo-muted`, `--radius-capsule`, `--gradient-hero`) are documented in §16.9.

> **⚠️ Contrast — these bright accents are dome-only (audit §7c.8, latent).** `--color-status-warning` `#E6A817` (2.10:1 on white), `--color-positive` `#4ADE80` (1.74:1) and `--color-amber` / `--color-medal-gold` `#FBBF24` (1.67:1) **fail WCAG AA badly as small text on a light surface.** In current usage they are safe — they appear only as dots/accent backgrounds, medal fills, or **text on the dark indigo hero dome** (where mint resolves ~7.56:1 and amber ~7.89:1, both PASS). **Rule:** use these accents on the indigo dome or as non-text fills only; for the same semantic on a *light* surface, use the dark variants (e.g. `--color-status-good` `#2E8B57`, the KYC `…-dark`/`…-amber` tokens, or dark text on a light tint as the employer status pills do — `#166534` on mint-18%, `#92400e` on amber-22%). Not a current defect; a guard against future misuse.

### 16.3 Breakpoint scale (Phase 5C `ee78074`)

CSS custom properties cannot be referenced inside `@media (max-width: …)` queries, so `--bp-sm/md/lg/xl` act as **documentation** for the canonical 4-breakpoint scale. Module `@media` blocks use the literal pixel value that matches the token (e.g. `@media (max-width: 768px)` corresponds to `--bp-md`). The audit catalogued 26 distinct breakpoints across the codebase; Phase 5C migrated the top-30 highest-traffic modules to the 4-breakpoint scale. Residual breakpoints (unmigrated modules) are tracked in `scripts/.followup/breakpoints-residual.txt`. When a future preprocessor or `@custom-media` lands, these tokens become the single source of truth.

### 16.4 `.input` primitive (Phase 5B `7f2c782`)

The canonical 48px frosted form input now lives in `src/index.css`:

```css
.input {
  /* 48px height · padding · font-body · radius-md · bg + border tokens */
}
.input:focus-visible { /* 2px var(--color-indigo-soft) outline + 2px offset */ }
.input:focus { /* border-color: var(--color-indigo) */ }
.input::placeholder { color: var(--color-gray); }
```

Component modules adopt it via the **composes-from-global pattern**:

```css
/* CreateAgent.module.css, ViewBranches.module.css, ViewAgents.module.css,
   Settings.module.css, CreateBranch.module.css, PasswordEntry */
.field {
  composes: input from global;
  /* layer module-specific size / spacing / accent without forking the shared shape */
}
```

12 drifting `.input` definitions (audit F20) collapsed to a single primitive. `PasswordEntry` (audit F16 — 56px / `font-display` drift) is among the migrated modules. Future input variants (chat composer, sign-in 56px, signup OTP) stay local but should still source colors and radii from the global tokens.

### 16.5 `EASE_OUT_EXPO` constant (Phase 5D `fccfa7b`)

The shared Framer Motion easing curve lives in `src/utils/motion.js`:

```js
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1];
```

`src/utils/finance.js` re-exports it (`export { EASE_OUT_EXPO } from './motion';`) for backwards compat — old import paths still resolve. Phase 5D migrated 9 ad-hoc `easeInOut` / `easeOut` strings in `LivenessStep`, `BranchDashboardShell`, `CreateAgent`, `IdUploadStep` (audit F21) to import the shared constant.

### 16.6 Indigo migration (Phase 5E `56c4839`)

The audit catalogued **658 hardcoded indigo refs** (`#292867`, `rgba(41,40,103,*)`) that should reference `--color-indigo` / `--shadow-*`. Phase 5E introduced `--color-white` (`#FFFFFF`) — the smallest representative cosmetic drift (F25) — and then migrated all modules with ≥10 indigo refs. Net result: **658 → 223 indigo refs across 16 modules** (~66% reduction). Residual files (modules with <10 indigo refs that weren't touched in Phase 5E) are tracked in `scripts/.followup/indigo-residual.txt` — 71 files at last sync, ordered by ref count for opportunistic future migration when those modules are next touched.

### 16.7 Slide-in panel + glassmorphism conventions

Slide-in panel conventions live in §12.2.

**Glassmorphism recipe (overlays / cards on the map).** Background `linear-gradient(145deg, rgba(255,255,255,0.78) 0%, rgba(246,247,251,0.72) 100%)`; border bright top/left for 3D light direction; `backdrop-filter: blur(24px)`; inset shadow `0 1px 0 rgba(255,255,255,0.5) inset`; hover `translateY(-3px)`.

### 16.8 Iconography, map

**Icon system.** Inline SVG line icons, `stroke="currentColor"`, `strokeWidth="1.75"`, 24×24 viewBox. Containers: `background: rgba(41,40,103,0.06); border: 1px solid var(--color-lavender); border-radius: var(--radius-md)`. Every icon is an inline-SVG React component in the shared set `src/dashboard/shared/Icons.jsx` — there is **no** SVG sprite (`public/icons.svg` was removed) and no `<use href>` references. Never emojis, icon fonts, or icon libraries. Decorative SVGs next to text labels must have `aria-hidden="true"`.

**Map (Distributor).** Full-bleed `react-leaflet` + CartoDB Positron tiles. GeoJSON in `public/uganda-districts.geojson` (clipped to region polygons via `scripts/clip-districts.mjs` using `@turf/turf`) + `public/uganda-regions.geojson`. Region colours: Central `#5E63A8`, Eastern `#2F8F9D`, Northern `#3D3C80`, Western `#7B7FC4`. Soft bokeh glow halos at region centroids. `flyTo`/`fitBounds` on drill-down. Lazy-load + WeakMap style cache applied in Phase 4F (`c3c28c3`) — F10 / F11 addressed.

### 16.9 Subscriber-mobile redesign (Phase 6 — shared primitives + tokens + nav)

The subscriber dashboard below 1024px was redesigned around a curved indigo "dome" header, capsule selection chips, and a 5-tab bottom bar with a centre Save FAB. Three shared primitives and three tokens back it; all are **role-agnostic** and live in `src/components/` / `src/index.css` so the agent shell (or future roles) can adopt them.

**New tokens (`src/index.css`).** Excerpted in §16.2.

| Token | Value | Role |
| --- | --- | --- |
| `--gradient-hero` | `linear-gradient(180deg, var(--color-indigo-deep), var(--color-indigo))` | Background fill of the `HeroCapsule` dome. CTAs/FAB reuse `--shadow-lg` (indigo-tinted) — **no** mint-glow. |
| `--radius-capsule` | `3rem` | Elliptical bottom-curve depth of the dome. |
| `--color-on-indigo-muted` | `rgba(255,255,255,0.78)` | Muted caption / eyebrow / subtitle text over the dome (resolves ~8.5:1 over `--color-indigo`, ~10:1 over `--color-indigo-deep` — clears AA). The big hero amount stays solid `--color-white`. |

**`HeroCapsule` (`src/components/HeroCapsule.jsx` + `.module.css`).** Presentational curved indigo dome header — no router knowledge (pass a resolved `onBack`/`onMenu`). Props:

| Prop | Effect |
| --- | --- |
| `title` | Optically-centred `<h1>` in the 3-column top bar (a spacer reserves width where a button is absent, keeping the title centred). |
| `eyebrow` | Small uppercase caption above the amount (`--color-on-indigo-muted`). |
| `prefix` + `amount` | `prefix` (e.g. `"UGX"`) + the big white display number. The amount line reserves its height so the Plus Jakarta Sans swap doesn't shift layout (no CLS). |
| `subtitle` | Muted supporting line. |
| `statRow` | Arbitrary node (units · invested · growth). |
| `onBack` | Renders a back chevron (≥44px icon button, `aria-label="Back"`). **Omit on tab-root pages** so no chevron renders. |
| `onMenu` | Renders the ⋮ button (`aria-label="More options"`). Omit to hide. |
| `variant` | `'default'` renders the full big-number block; `'compact'` drops it (renders just the top bar + an optional muted subtitle) for dense pages like Reports, so tables keep their vertical budget. |

The dome is painted with `--gradient-hero` + `--radius-capsule`; decorative SVGs carry `aria-hidden="true"`. The entrance is pure CSS (neutralised by the global `prefers-reduced-motion` reset).

**`PillChip` / `PillChipGroup` (`src/components/PillChip.jsx` + `.module.css`).** Capsule selection chips (amount presets, cadence, type/status filters). **Selected** = filled indigo + white; **idle** = lavender-outline + indigo text — brand-only, never mint. Each chip is ≥44pt tall.

- `PillChip` is a `<button role="radio" aria-checked={selected}>` taking `selected`, `onClick`, `children` (+ passthrough props).
- `PillChipGroup` (`label`, `layout='row'|'grid'`, `columns=3`) wraps chips in a single `role="radiogroup"` with `aria-label={label}` — **the label is required** for the group. It manages a **roving tabindex** (exactly one tab stop — the checked chip, or the first when none is checked) via a `useEffect` that runs each render, and `handleKeyDown` moves focus with Arrow keys (Right/Down forward, Left/Up back, wrapping) and activates the chip under focus, matching the native radio pattern. Grid layout passes `--pill-cols` for the column count.

**`PageHeader` `variant="hero"` (`src/components/PageHeader.jsx`).** The shared back-aware header (22 files across subscriber + agent) gained a `variant="hero"` that renders a `HeroCapsule` instead of the flat bar, so any page opts into the dome cheaply. Default variant is unchanged. New passthrough props (`eyebrow`, `prefix`, `amount`, `statRow`, `onMenu`) are forwarded to the capsule and ignored by the default variant; `showBack={false}` suppresses the back chevron on tab-root pages. Back resolution is unchanged (`onBack` → `backTo` → `goBackOrFallback(navigate, fallback)`).

**Subscriber mobile nav / route changes (`<1024px`).**

- **5-tab `BottomTabBar`** (`src/subscriber-dashboard/shell/BottomTabBar.jsx`) — Home · Activity · **[centre Save FAB]** · Withdraw · Goals · Profile, as `NavLink`s with `aria-current` active styling under `<nav aria-label="Quick navigation">`. Tabs are 52px tall; the centre FAB is the indigo Save action (`aria-label="Save"`, ≥44px, indigo — never mint, no mint-glow) with reduced-motion handling on its `transform`/`box-shadow` transitions. The bar is hidden at `min-width: 1024px` (mobile-only; desktop keeps the SideNav).
- **The mobile "More" menu was removed** — there are no `MoreMenu` / `moreOpen` references left in `shell/`. Destinations that used to live there are re-homed (below).
- **`/dashboard/activity` now renders `ActivityPage`** (lazy) instead of redirecting. It is no longer `Navigate to="/dashboard/reports/all-transactions"`; the Activity tab is a first-class page. (Update §2.4: the row now reads `pages/ActivityPage (lazy)`.)
- **Reports / Agent / Help / Security re-homed as `SettingsPage` rows** (`src/subscriber-dashboard/pages/SettingsPage.jsx`). The Profile tab's settings list now also carries: *Reports & statements* → `/dashboard/reports`, *Your agent* → `/dashboard/agent`, *Help* → `/dashboard/help`, and *Password & security* — which opens the shared `<Settings />` slide-in panel via `setSettingsOpen(true)` from `useDashboard()` rather than routing (it's the only surface exposing the password card on this page). *Notifications* is present but `disabled` with a "Soon" badge (the `/settings/notifications` + `/settings/security` routes now redirect to `/dashboard/settings` — §16b).

---

## 16a. Demo scope (by design — do NOT "fix")

These behaviours are intentional limits of a sales-rep demo platform. Do not propose real SMS / payment / KYC / audit / compliance integrations as TODOs — that is explicitly out of scope per CLAUDE.md §10a. The audit re-confirmed every item below.

- **`VITE_USE_SUPABASE` rollback flag.** Read once at module load (`src/services/api.js` → `IS_SUPABASE_ENABLED`). When the env var is the literal string `'false'`, every service falls back to a `mockData`-backed branch (entities, commissions, subscriber, agent, kyc, chat, search, contact). Lets demos run offline / without backend.
- **Per-session mutation stores.** `entities._entityOverrides` (branch status flips, branch/agent creates) and `subscriber._sessionMutations` (contributions, withdrawals, schedule edits, nominees, claims) layer over frozen `mockData.js` for the duration of the tab. Resets on refresh — intentional for the demo's "what-if" flows.
- **`MOCK_NOW = new Date(2026, 4, 26)`** in `src/data/mockData.js` (currently 2026-05-26 — synced with today). Consumed by `commissions.js` and surfaced via `currentTime()`. Anchors every "due in N days" and settlement timestamp so demo data tells a coherent story. Slide it forward when relative dates start looking stale.
- **Mocked chat.** `getChatResponse`, `getAgentReply`, `getSubscriberChatResponse` POST to `/api/chat`; the route returns keyword-matched mock replies. The local fallback (under `VITE_USE_SUPABASE=false`) is identical.
- **Mocked KYC.** All 8 KYC services (`assessImageQuality`, `extractIdFields`, `verifyNira`, `sendOtp`, `verifyOtp`, `faceMatch`, `screenAml`, `referToAgent`) are Smile ID v2-shaped mocks with realistic latency. QA force-overrides via `localStorage['upensions_<stage>_force']` are intentional for demo failure-path walkthroughs.
- **Demo OTP.** `verifyOtp(phone, code, role)` accepts any 6-digit code — see BACKEND.md §15a for the route detail; the frontend service surfaces the response unchanged. No rate limiting, no lockout.
- **`demo_personas` fallback IDs.** Unknown phones resolve to `a-001` / `b-kam-015` / `d-001` so every demo login succeeds even if persona seed drifts.
- **Hardcoded UGX 1,000 unit price.** Lives in `trg_transactions_contribution` (BACKEND.md). No real fund NAV.
- **24h JWT, no refresh.** Fixed TTL is fine for short demo sessions (BACKEND.md §5).

---

## 16b. Real bugs / cleanups (residual)

These are residual issues that survived the Phase 4–5 cleanup. Listed so anyone touching frontend code knows what already-known drift looks like.

**Settings redirect routes.** `/dashboard/settings/notifications` and `/dashboard/settings/security` redirect back to `/dashboard/settings` (`<Navigate replace to="/dashboard/settings" />`). They are deliberate redirects — the old `StubPage` placeholders were removed in the audit-remediation cleanup — so the routes no longer strand demos on dead-end stubs. Pinned by `e2e/specs/regression/subscriber-settings-stubs.spec.ts`.

| ID | Severity | Where | What |
| --- | --- | --- | --- |
| F8 | med | `src/subscriber-dashboard/pages/HelpPage.jsx`, `AgentPage.jsx` | Render-time `setState` seeds initial messages — Phase 4E (`e0f6c22`) moved the seed into a `useEffect` and added an unmount guard for async chat seeds (F8 + F9 addressed; track if any future seed paths regress). |
| F13 | med | `src/hooks/useEntity.js:168` | `queryKey: ['breadcrumb', currentLevel, selectedIds]` — `selectedIds` object identity unstable; cache thrashes. Phase 4G (`0ba0caf`) introduced a stable breadcrumb cache key — addressed; included here so the technique propagates to any new keys built around object identity. |
| F17 | med | repo-wide | **223 residual hardcoded indigo refs** (down from 658). Tracked in `scripts/.followup/indigo-residual.txt`. Migrate file-by-file when touched. |
| F19 | med | repo-wide | Residual `@media` breakpoints outside the 4-breakpoint scale, tracked in `scripts/.followup/breakpoints-residual.txt`. |
| F23 | med | `src/dashboard/DashboardShell.jsx` | Phase 4G (`0ba0caf`) memoized the `onClose` prop captured by the escape-listener `useEffect` — verify any future shells follow the same pattern. |
| F24 | low | `src/dashboard/sidebar/Sidebar.jsx` | Phase 4G (`0ba0caf`) replaced three separate document-click listeners with a single delegated listener — addressed. |
| F27 | low | `src/services/entities.js` `_syncCache` | In-memory sync cache used by `DashboardNavContext` for synchronous lookups during URL routing; first navigation can return `null`. Phase 4I (`f60bed1`) added a JSDoc comment explaining the contract. |

**Cross-cutting bugs / awareness items** (audit X-prefix, manifested on the frontend):

- **X6 (resolved)** — Phase 7A hard-fails on missing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in production builds (see §5.2).
- **X11 / X17 (resolved at unit layer)** — every service mock branch now has Phase 2 unit tests (see §17).
- **X12 (med)** — `useSubscriber.useSubscriberTransactions` keys `[id, filters]`; agent-side variants drop `filters`. Cross-context cache key drift.
- **X13 (resolved)** — `pages/Contact.jsx:49-54` now validates the `/api/contact` response shape; a real-path response missing a non-empty `id` shows the support-email fallback instead of a false success.
- **X15 (resolved)** — `src/services/api.js` now consumes `VITE_API_BASE_URL` from `src/config/env.js`. Post-Render-migration Vercel bakes the absolute URL into the bundle at build time (Production / Preview / Development scopes); local dev uses `http://localhost:3001/api`. See `BACKEND.md §2`.

**Closed in this cleanup pass:**

- **F1 / F22** — cross-role import resolved by promoting `goBackOrFallback` to `src/utils/navigation.js` (Phase 4B `bd5ea82`).
- **F2 / F3 / F4** — `SignInContext`, `ToastContext`, `BranchScopeContext`, `AgentScopeContext` provider values memoized (Phase 4A `e43de1f`).
- **F5** — `DashboardPanelContext` split; subscriber-specific keys moved to `SubscriberPanelContext` (Phase 4C `1c46f91`).
- **F6 / F7** — `goToLevel` and `onAuthExpired` listeners are now ref-based (Phase 4D `dbb46e4`).
- **F10 / F11** — Uganda GeoJSON lazy-loaded + WeakMap style cache (Phase 4F `c3c28c3`).
- **F12 / F15 / F28** — Navbar handlers memoized, signup persist debounced, commission filter pipelines cached (Phase 4H `b0e54a4`).
- **F13 / F23 / F24** — stable breadcrumb cache key + memoized `onClose` + delegated click listener (Phase 4G `0ba0caf`).
- **F14** — optimistic-mutation pattern documented as the canonical template (§8) with the `src/hooks/__tests__/useEntity.test.js` scaffold.
- **F16** — `PasswordEntry` migrated to the global `.input` primitive (Phase 5B `7f2c782`).
- **F18** — 7 new KYC status tokens (Phase 5A `1b13e2e`).
- **F19** — 4-breakpoint scale tokens + top-30 modules migrated (Phase 5C `ee78074`).
- **F20** — `.input` primitive promoted to global; 12 drifting definitions collapsed (Phase 5B `7f2c782`).
- **F21** — 9 ad-hoc easing curves migrated to `EASE_OUT_EXPO` (Phase 5D `fccfa7b`).
- **F25** — `--color-white` token introduced; indigo migration 658 → 223 (Phase 5E `56c4839`).
- **F26** — CoPilotWidget intentional duplication documented (Phase 4I `f60bed1`, §13).
- **X3 (now moot)** — the agent-dispute flow it once tracked was removed wholesale in the 0029 commission simplification; there is no longer a dispute path on either side.

**Largest files** (lines only — candidates for extraction when next touched):

| File | Lines |
| --- | --- |
| `src/dashboard/commissions/CommissionPanel.jsx` | 1097 (rewritten in the 0029 simplification, down from 1682) |
| `src/dashboard/branch/ViewBranches.jsx` | 1041 |
| `src/data/mockData.js` | 1034 |
| `src/dashboard/sidebar/Sidebar.jsx` | 650 |
| `src/dashboard/overlay/OverlayPanel.jsx` | 647 |
| `src/dashboard/settings/Settings.jsx` | 644 |
| `src/branch-dashboard/overview/BranchHealthScore.jsx` | 579 |
| `src/signup/contribution/ContributionSettings.jsx` | 569 |

---

## 17. Testing layout

**Setup.** Vitest 4 + jsdom + Testing Library. Config inside `vite.config.js`. Global setup: `src/test/setup.js` imports `@testing-library/jest-dom`. Supabase mocked via the queue-backed `src/test/supabaseMock.js` (`makeSupabaseMock()` exposes `__queueFrom(table, result)` and `__queueRpc(name, result)` for FIFO seeding).

**Phase 2 added comprehensive service + hook + util coverage:**

| Test file | Subject |
| --- | --- |
| `src/services/__tests__/auth.test.js` | Full coverage of `signInWithPassword`, `changePassword`, OTP flow, `AuthError`, every `messageForCode` code (Phase 2A `27e661b`) |
| `src/services/__tests__/api.test.js` | `apiFetch`, `onAuthExpired` listener fan-out, 401 detection, request/response shape (Phase 2B `93c51f2`) |
| `src/services/__tests__/subscriber.test.js` | Reads + writes + `_sessionMutations` overlay parity between real and mock branches (Phase 2D `9bf8914`) |
| `src/services/__tests__/agent.test.js` | `getAgentSubscriberList` joins + RLS scope (Phase 2D `9bf8914`) |
| `src/services/__tests__/chat.test.js` | `getChatResponse`, `getAgentReply`, `getSubscriberChatResponse`; `Cache-Control: no-store` + body type-checking (Phase 2D `9bf8914`) |
| `src/services/__tests__/kyc.test.js` | All 8 KYC stages incl. phone canonicalization (Phase 2C `91f413e`) |
| `src/services/__tests__/contact.test.js` | `submitContactForm` real + demo branches (Phase 2D `9bf8914`) |
| `src/services/__tests__/search.test.js` | `searchEntities` real + mock (Phase 2D `9bf8914`) |
| `src/services/__tests__/supabaseClient.test.js` | Singleton + token rotation + 401 propagation (Phase 2D `9bf8914`) |
| `src/services/__tests__/commissions.test.js` | Commission service: rate, summary, agent list/detail, pending dues, settlement-upload (`applySettlementUpload`) + settlements list |
| `src/services/__tests__/entities.test.js` | Entity reads + writes, branch/agent create, breadcrumb |
| `src/hooks/__tests__/useEntity.test.js` | React Query wiring + optimistic-rollback semantics (Phase 2E `ec72ffc`); canonical scaffold — see §8 |
| `src/hooks/__tests__/useCommission.test.js` | Read keys (incl. pending dues + settlements) + `useApplySettlement` / `useSetCommissionRate` + `invalidateAll` |
| `src/hooks/__tests__/useSubscriber.test.js` | 7 reads + 7 mutations + `invalidateSubscriber` (Phase 2E `ec72ffc`) |
| `src/hooks/__tests__/useAgent.test.js` | `useAgentSubscribers` + `useUpdateSubscriberSchedule` invalidation (Phase 2E `ec72ffc`) |
| `src/hooks/useDebouncedValue.test.js` | Fake timers; `delayMs` normalization; cancellation |
| `src/utils/__tests__/csvDownload.test.js` | Mobile row cap + cap-notice callback + Blob shape (Phase 2F `021570d`) |
| `src/utils/__tests__/settlement.test.js` | `buildTemplateRows` + `normalizeUploadedRows` (template build / parse). The old `settlementCycle.test.js` was deleted with `settlementCycle.js` in the 0029 simplification. |
| `src/utils/__tests__/phone.test.js` | UG phone parse/format/validate/canonicalise |
| `src/utils/__tests__/sentryScrub.test.js` | Sentry PII scrubber — phone / `role:phone` id / JWT / Bearer / password redaction across event + breadcrumb shapes, cycle + depth guards (BL-26 / H-4) |
| `src/utils/__tests__/dashboard.test.js` | `getInitials`, `getTrend`, `perfLevel` |
| `src/utils/__tests__/finance.test.js` | `parseAmount` (grouping / currency-prefix / decimal-rounds-to-integer-UGX / negative-and-zero → `null`), `normalizeFrequency`, `periodsPerYear`, `monthlyEquivalent`, `calcFV`, `sliderToAmt` / `amtToSlider`. (Currency rendering moved to `currency.test.js`, next row.) |
| `src/utils/__tests__/currency.test.js` | `formatUGX`, `formatNumber`, `formatUGXShort` edge cases |
| `src/utils/__tests__/date.test.js` | All `formatDate` variants + `'—'` fallback |
| `src/utils/csv.test.js` | RFC 4180 + OWASP formula-injection defence |
| `src/components/Modal.test.jsx` | Portal, focus trap, Escape, backdrop dismiss, scroll lock |
| `src/test/jwt-claim-contract.test.js` | JWT claim shape contract |

**48 test files, 871 passing tests at last sync** (`npm test`). The earlier T2 / T5 / T6 gaps are closed at the unit layer. The E2E suite (Playwright) still owns happy-path regression coverage; see `.claude/skills/qa.md`.

**Coverage script.** `npm run test:coverage` is wired in `package.json` (Phase 2G `3002c14`) and reads the coverage config from the embedded Vitest block in `vite.config.js`. **`@vitest/coverage-v8` is currently NOT installed** — run `npm i -D @vitest/coverage-v8` to enable coverage reports. The script will fail with a clear "missing dependency" message until then.

**Conventions for new tests.** Prefer service-level tests (we already mock supabase-js); component tests should mount with `<QueryClientProvider>` + `<MemoryRouter>` + any required scope provider. Use `vi.mock('../supabaseClient', () => ({ supabase: makeSupabaseMock(), ... }))` per file (the mock key must match the import string the source file uses).

**E2E suite.** Specs under `e2e/`, mobile + desktop projects, role-pre-minted JWTs in `e2e/.auth/`, GitHub Actions workflow. Invoke via `npm run test:e2e` or the `/qa` skill. Modal escape-key behaviour is verified by `e2e/specs/regression/modal-escape.spec.ts`. See `.claude/skills/qa.md`.

---

## 18. CSV export

`src/utils/csv.js`:

```js
export function toCsv(rows, columns)
export function toCsvStream(rows, columns)        // async-iterable for >MAX_ROWS
export function downloadCSV(filename, headers, rows)  // legacy
export const MAX_ROWS
```

- RFC 4180 escaping (wraps cells in quotes when they contain commas / quotes / newlines; doubles embedded quotes).
- OWASP formula-injection defence: cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with a single quote and quote-wrapped (Excel/Sheets/LibreOffice).
- UTF-8 BOM (`﻿`) prepended for Excel compatibility.

`src/utils/csvDownload.js` is the higher-level wrapper (Blob + hidden `<a download>` + mobile row cap + cap-notice callback). Filenames include a date stamp (e.g. `all-transactions_2026-05-26.csv`) via `dateStampedFilename(slug)`.

**Callers:**

| File | Purpose |
| --- | --- |
| `src/dashboard/overlay/TopBar.jsx` | Distributor top-right "Download" button — exports the currently visible drill level |
| `src/dashboard/reports/views/*.jsx` (11 reports) | Per-report CSV download with date-stamped filename |
| `src/subscriber-dashboard/reports/views/*.jsx` (5 reports) | Subscriber report CSVs |

---

## 19. Product & brand context

**Mission.** Universal Pensions is a digital long-term savings + pension platform for everyday Ugandans — informal workers, gig workers, farmers, self-employed. The goal is making formal retirement products feel approachable, building trust through clarity, and supporting multiple distribution + contribution models (subscriber direct, employer-managed, agent-led).

**Brand personality.** Dependable · intelligent · modern · stable · human · future-facing.

**Primary colour: `#292867` Universal Indigo.** Anchor for key headings, primary buttons, hero emphasis, important icons.

**Supporting palette.** Deep Night `#1B1A4A` · Soft Indigo `#5E63A8` · Mist Lavender `#D9DCF2` · Cloud `#F6F7FB` · Slate Text `#2F3550` · Cool Gray `#8A90A6` · Success Green `#2E8B57` · Accent Teal `#2F8F9D`.

**Colour rules.** Indigo carries the primary identity. Do not use red as a major brand colour — reserve for error/destructive/critical only. Neutrals + soft tints for spaciousness. Teal/green sparingly for positive states.

**Typography.** Display: Plus Jakarta Sans (headings, hero numbers, buttons). Body: Inter. Avoid stylised / artsy fonts. Headings `font-weight: 800; letter-spacing: -0.03em; color: var(--color-indigo)`.

**Visual style.** Bold clean headings · large readable numbers · smooth card surfaces · restrained gradients · subtle depth · consistent iconography · motion tied to meaning. Avoid noisy visuals, decorative complexity, neobank flashiness.

**Animation philosophy.** Animation is a meaning layer — communicates time passing, money growing steadily, milestones reached, confidence building. Smooth, editorial/studio-grade. Use `EASE_OUT_EXPO` for entrance; staggered children 0.05–0.1s; item reveal `{ opacity: 0, y: 12–24 } → { opacity: 1, y: 0 }`; `AnimatePresence mode="wait"` for step transitions.

**Landing-page scroll storytelling.** Scroll = time. As the user scrolls, the page communicates the journey from today toward long-term financial security: time passing → gradual accumulation → improving confidence → uncertainty to stability. Intentional and cinematic, not gimmicky.

**Copy tone.** Clear, respectful, confidence-building, plain English. Short support text. Benefit-led messaging. Avoid heavy pension jargon, long institutional paragraphs, intimidating language.

**Dashboard direction by role.**

- **Subscriber.** Balance, recent contributions, goal progress, future impact, simple reminders.
- **Employer (shipped).** Participation, contribution management, invite-based onboarding, reporting.
- **Agent.** Assisted actions, pending tasks, subscriber status, fast mobile completion.
- **Branch.** Local performance, agent oversight, subscriber activity, exceptions, progress snapshots.
- **Distributor.** Network-wide growth, branch/agent performance, trends, operational visibility, strategic reporting.
- **Admin (shipped).** Full platform control + all data access (map-theme shell at `src/admin-dashboard/`; platform-wide reads + create-distributor/employer + settlement via `0049`–`0051`).

**Optimisation priorities** for any new product work: trust → clarity → inclusivity → multi-role usability → long-term savings behaviour → elegant scrollytelling → meaningful motion → strong alignment + readability → indigo-led brand consistency.

---

## See also

- [`CLAUDE.md`](../CLAUDE.md) — slim entry index, hard rules, demo personas, glossary
- [`BACKEND.md`](./BACKEND.md) — API routes, RLS, RPCs, migrations, commission state machine
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system architecture: layered patterns, role boundaries, auth model, write/realtime patterns
- [`docs/role-permissions.md`](./role-permissions.md) — role × capability matrix
- [`docs/data-model.md`](./data-model.md) — full entity hierarchy with field definitions
- [`docs/api-contracts.md`](./api-contracts.md) — HTTP shapes + cache keys + invalidation

---

*Codebase size at sync: ~87k LOC across `src/**/*.{js,jsx,css}` (118 CSS modules + JS / JSX). Run `find src -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.css' \) -exec wc -l {} + | tail -1` to recompute.*
