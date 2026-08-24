### 2.1 Public / unauthenticated (13 routes, `src/App.jsx`)

| # | Route | Desktop (chromium + webkit) | Mobile (mobile-chromium + mobile-webkit) | Covering spec |
|---|---|---|---|---|
| 1 | `/` (SubscribersPage) | ✅ | ✅ | `smoke/landing.spec.ts:12`, `smoke/_health.spec.ts:18`, `flows/auth-otp-retry-lockout.spec.ts` |
| 2 | `/employers` | ❌ | ❌ | — |
| 3 | `/distributors` | ✅ | ❌ | `flows/settings-change-password.spec.ts` |
| 4 | `/admin` (landing) | ❌ | ❌ | — |
| 5 | `/faq` | ✅ | ✅ | `smoke/landing.spec.ts:20` |
| 6 | `/contact` | ✅ | ✅ | `smoke/landing.spec.ts:27` |
| 7 | `/about` | ✅ | ✅ | `smoke/landing.spec.ts:34` |
| 8 | `/request-access` | ❌ | ❌ | — |
| 9 | `/claim` (NomineeClaim) | ❌ | ❌ | — |
| 10 | `/coming-soon` | ❌ | ❌ | — |
| 11 | `/admin/login` | ❌ | ❌ | — |
| 12 | `/signup/*` | ✅ | ❌ | `flows/subscriber-signup-to-contribute.spec.ts`, `flows/kyc-failure-paths.spec.ts` |
| 13 | `/invite/:token/*` | ❌ | ❌ | — |

**Desktop 6/13 = 46.2 % · Mobile 4/13 = 30.8 %**

### 2.2 Subscriber (19 routes, `SubscriberDashboardShell.jsx`)

| # | Route | Desktop | Mobile | Covering spec |
|---|---|---|---|---|
| 1 | `/dashboard` | ✅ | ✅ | `smoke/subscriber-dashboard.spec.ts` |
| 2 | `save` | ✅ | ✅ | `smoke/subscriber-dashboard`, `regression/subscriber-payment-methods` |
| 3 | `save/schedule` | ✅ | ✅ | `smoke/subscriber-dashboard:43`, `regression/subscriber-write-failures` |
| 4 | `withdraw` | ✅ | ✅ | `smoke/subscriber-dashboard:54` |
| 5 | `withdraw/savings` | ✅ | ✅ | `smoke/subscriber-dashboard`, `subscriber-write-failures` |
| 6 | `withdraw/claim` | ✅ | ✅ | `smoke/subscriber-dashboard`, `subscriber-write-failures` |
| 7 | `claim` | ✅ | ✅ | `smoke/subscriber-dashboard` |
| 8 | `activity` | ✅ | ✅ | `smoke/subscriber-dashboard` |
| 9 | `reports` | ✅ | ✅ | `smoke/subscriber-dashboard` |
| 10 | `reports/:reportId` | ✅ | ✅ | `smoke/subscriber-dashboard:109,:115`, `flows/distributor-exports-csv:37` |
| 11 | `policies` | ❌ | ❌ | — **zero coverage at any viewport** |
| 12 | `help` | ✅ | ✅ | `smoke/subscriber-dashboard:124` |
| 13 | `agent` | ✅ | ✅ | `smoke/subscriber-dashboard` |
| 14 | `settings` | ✅ | ✅ | `smoke/subscriber-dashboard`, `flows/subscriber-signin-with-password` |
| 15 | `settings/profile` | ✅ | ✅ | `smoke/subscriber-dashboard:173`, `flows/subscriber-edit-profile` |
| 16 | `settings/nominees` | ✅ | ❌ | `regression/subscriber-settings-stubs`, `subscriber-write-failures` |
| 17 | `settings/insurance` | ✅ | ❌ | `regression/subscriber-insurance-no-scroll`, `subscriber-write-failures` |
| 18 | `settings/notifications` | ✅ | ❌ | `regression/subscriber-settings-stubs:40` |
| 19 | `settings/security` | ✅ | ❌ | `regression/subscriber-settings-stubs:41` |

**Desktop 18/19 = 94.7 % · Mobile 14/19 = 73.7 %**

### 2.3 Agent (17 routes, `AgentDashboardShell.jsx`)

| # | Route | Desktop | Mobile | Covering spec |
|---|---|---|---|---|
| 1 | `/dashboard` | ✅ | ✅ | `smoke/agent-dashboard:41` |
| 2 | `onboard` | ✅ | ✅ | `smoke/agent-dashboard:52`, `flows/agent-onboard-subscriber` |
| 3 | `subscribers` | ✅ | ✅ | `smoke/agent-dashboard:63` |
| 4 | `subscribers/:id` | ✅ | ✅ | `smoke/agent-dashboard:74` |
| 5 | `subscribers/:id/schedule` | ✅ | ❌ | `flows/agent-dashboard-drill-to-subscriber` (desktop-only spec) |
| 6 | `inbox` | ✅ | ✅ | `smoke/agent-dashboard:85` |
| 7 | `analytics` | ✅ | ✅ | `smoke/agent-dashboard:98` |
| 8 | `commissions` | ✅ | ✅ | `smoke/agent-dashboard:107` |
| 9 | `commissions/:view` | ✅ | ✅ | `smoke/agent-dashboard:116` |
| 10 | `contributions` | ❌ | ❌ | — |
| 11 | `onboarded-this-month` | ❌ | ❌ | — |
| 12 | `yet-to-contribute` | ❌ | ❌ | — |
| 13 | `insured` | ❌ | ❌ | — |
| 14 | `uninsured` | ❌ | ❌ | — |
| 15 | `settings` | ✅ | ✅ | `smoke/agent-dashboard:128` |
| 16 | `profile` | ❌ | ❌ | — |
| 17 | `help` | ❌ | ❌ | — |

**Desktop 10/17 = 58.8 % · Mobile 9/17 = 52.9 %** — the five KPI drill-downs
(`onboarded-this-month`, `yet-to-contribute`, `insured`, `uninsured`, `contributions`) are the
agent home tiles a rep clicks first and **none of them is covered at any viewport**.

### 2.4 Branch admin — desktop 10 routes (`BranchDesktopShell.jsx`), mobile 12 (`BranchMobileShell.jsx`)

| # | Desktop route | Covered | # | Mobile route | Covered |
|---|---|---|---|---|---|
| 1 | `/dashboard` | ✅ `smoke/branch-dashboard:39` | 1 | `/dashboard` | ⚠️ shell-only |
| 2 | `attention/:type` | ❌ | 2 | `attention/:type` | ❌ |
| 3 | `agents` | ✅ `:55,:80,:95` | 3 | `agents` | ❌ |
| 4 | `agents/:agentId` | ✅ `:95`, `flows/branch-…-drill:106` | 4 | `agents/new` | ❌ |
| 5 | `agents/:agentId/subscribers` | ❌ (CTA asserted visible, never clicked) | 5 | `agents/:agentId` | ❌ |
| 6 | `commissions` | ✅ `:55,:120` | 6 | `commissions` | ❌ |
| 7 | `analytics` | ✅ `:55,:120` | 7 | `analytics` | ❌ |
| 8 | `reports` | ❌ | 8 | `reports` | ❌ |
| 9 | `support` | ✅ `:55,:109` | 9 | `support` | ❌ |
| 10 | `settings` | ✅ `:55` | 10 | `support/:ticketId` | ❌ |
| | | | 11 | `menu` | ❌ |
| | | | 12 | `settings` | ❌ |

**Desktop 7/10 = 70.0 % · Mobile 1/12 = 8.3 %** — and that single mobile hit is
`smoke/branch-dashboard.spec.ts:144`, a `test.use({viewport})` override **inside the chromium
project**. On the two real mobile projects (real iPhone SE / iPhone 12 device descriptors, real
mobile UA, real WebKit) branch admin has **0/12 = 0 %**.

### 2.5 Employer (12 routes, `EmployerDashboardShell.jsx`)

| # | Route | Desktop | Mobile | Covering spec |
|---|---|---|---|---|
| 1 | `/dashboard` | ✅ | ❌ | `smoke/employer-dashboard:38` |
| 2 | `employees` | ✅ | ❌ | `smoke/employer-dashboard:55` |
| 3 | `employees/:id` | ❌ | ❌ | — |
| 4 | `runs` | ✅ | ❌ | `smoke/employer-dashboard:61`, `flows/employer-contribution-run` |
| 5 | `contributions` | ❌ | ❌ | — |
| 6 | `insurance` | ✅ | ❌ | `smoke/employer-dashboard:67` |
| 7 | `analytics` | ✅ | ❌ | `smoke/employer-dashboard:73` |
| 8 | `support` | ✅ | ❌ | `smoke/employer-dashboard:79` |
| 9 | `settings` | ✅ | ❌ | `smoke/employer-dashboard:85` |
| 10 | `onboard` | ❌ | ❌ | — |
| 11 | `pending-kyc` | ✅ | ✅ | `regression/employer-kyc-nudge` |
| 12 | `profile` | ❌ | ❌ | — |

**Desktop 8/12 = 66.7 % · Mobile 1/12 = 8.3 %**

### 2.6 Distributor — desktop is PANELS (no routes), mobile is 14 routes

`DistributorDesktopShell` is panel-state driven (`DRAWER_ITEMS` + `DashboardContext` setters); it
has **zero `<Route>` elements**. Deep-link URLs (`/dashboard/regions/:id`, `/districts/:id`,
`/branches/:id`, `/agents/:id`, `…/subscribers`) are pushed by `DashboardNavContext.jsx:163-198`
and read back by the shell — they are URL surfaces without a route definition.

| Desktop panel | Covered | Mobile route | Covered |
|---|---|---|---|
| overview | ✅ `smoke/distributor-dashboard:39` | `/dashboard` | ✅ `flows/distributor-exports-csv:92` |
| Create branch | ✅ `:55`, `flows/distributor-create-branch` | `branches` | ❌ |
| View branches | ✅ `:73` | `branches/:branchId` | ❌ |
| View agents | ✅ `:85` | `agents` | ❌ |
| Subscribers | ✅ `:97` | `agents/:agentId` | ❌ |
| Reports | ✅ `:114`, `flows/distributor-exports-csv` | `commissions` | ❌ |
| Commissions | ✅ `:123`, `flows/distributor-commission-drill-subscribers` | `subscribers` | ❌ |
| Settings | ✅ `:133`, `flows/settings-change-password` | `subscribers/:subscriberId` | ❌ |
| **Support / tickets** | ❌ | `reports` | ❌ |
| | | `reports/:reportId` | ❌ |
| | | `support` | ❌ |
| | | `support/:ticketId` | ❌ |
| | | `settings` | ❌ |
| | | `menu` | ❌ |

**Desktop panels 8/9 = 88.9 % · Mobile routes 1/14 = 7.1 %**

### 2.7 Admin — desktop is PANELS, mobile is 22 routes (`AdminMobileShell.jsx`)

| Desktop panel | Covered | | Mobile route | Covered |
|---|---|---|---|---|
| overview | ✅ `smoke/admin-dashboard:75` | | all 22 (`distributors`, `distributors/:id`, `employers`, `employers/:id`, `access-requests`, `nav`, `nominee-claims`, `attention/:type`, `network`, `branches`, `branches/:id`, `agents`, `agents/:id`, `subscribers`, `subscribers/:id`, `reports`, `reports/:id`, `support`, `support/:ticketId`, `settings`, `menu`, index) | ❌ **0/22** |
| distributors | ✅ `:97` | | | |
| createDistributor | ❌ | | | |
| employers | ✅ `:108` | | | |
| createEmployer | ✅ `flows/admin-create-employer` | | | |
| employerDetail | ❌ | | | |
| access-requests | ❌ | | | |
| nominee-claims | ❌ | | | |
| nav (NAV publishing) | ❌ | | | |
| branches | ✅ `:117` | | | |
| agents | ✅ `:128` | | | |
| subscribers | ✅ `:136` | | | |
| tickets / support | ❌ | | | |
| reports | ❌ | | | |
| settings | ✅ `:148` | | | |

**Desktop panels 8/15 = 53.3 % · Mobile routes 0/22 = 0.0 %**

The **NAV publishing panel has zero E2E coverage** — it is the admin surface that sets the unit
price for every subscriber's balance (`publish_nav_snapshot`), and the only thing guarding it is a
migration-**text** contract test (§5).
