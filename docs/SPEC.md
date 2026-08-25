> **Agent guide.** This is the product spec — personas, workflows, and business rules — written so a backend developer can grasp the whole system without reading frontend code. An AI agent should read it for product intent and business-rule context, but must verify each "Current state" note against the code, since several flows labelled here as mock or planned have since shipped. For code-level detail start at `CLAUDE.md`, then `docs/FRONTEND.md` and `docs/BACKEND.md`; do not treat this file as the sole source of truth on what is or isn't built.
>
> **Verified against the live Singapore DB (`ilkhfnoyxlxwqadebnkp`) on 2026-08-25.** Seed-entity counts decay fast — re-measure before relying on them.

# Universal Pensions Uganda — Platform Specification

> This document provides a complete product specification for the Universal Pensions Uganda platform.
> It is written for backend developers who need to understand the full system without reading frontend code.
> Distinctions are made between **built** features, **planned** features, and **mock approximations** that need real business logic.

---

## 1. Product Overview

Universal Pensions is a digital long-term savings and pension platform designed to make retirement saving accessible for everyday people in Uganda. It targets informal workers, gig workers, farmers, and self-employed individuals who lack access to traditional employer-sponsored pension schemes.

### What the Platform Does
- Enables individuals (**subscribers**) to make regular pension contributions
- Provides a field distribution network (**agents** organized into **branches**) for in-person enrollment and collection
- Offers **employers** a way to manage employee pension contributions
- Gives **distributor admins** and **branch admins** visibility into network performance
- Tracks **commissions** paid to agents for subscriber onboarding
- Provides reporting, analytics, and AI-assisted insights across the network

### Business Model
- Subscribers contribute monthly amounts (5,000–50,000 UGX typical range)
- Contributions are invested, generating returns (AUM = contributions + investment growth)
- Agents earn a flat commission (currently 5,000 UGX) for each subscriber's first contribution
- The distributor network (branches + agents) handles field operations: enrollment, KYC, collection

### Currency
- All monetary values are in **Ugandan Shillings (UGX)**
- UGX is integer-only (no decimals)
- Display format: `UGX 1.2M`, `UGX 450K`, `UGX 5,000`

### Geography
- Single-country deployment: Uganda
- 4 regions: Central, Eastern, Northern, Western
- 136 districts (real GADM boundaries, GeoJSON in `/public/`)
- ~316 branches distributed across districts
- Map coordinates: longitude, latitude pairs

---

## 2. User Roles & Personas

### Subscriber
- **Real-world role:** Individual saver — informal worker, farmer, gig worker, self-employed
- **Why they use the platform:** Track savings, view contributions, monitor pension growth
- **Key needs:** Balance visibility, contribution history, progress tracking, simple UX
- **Status:** **Built** — mobile-first dashboard with home widgets (Pulse, TopUp, Projection, Activity, CoPilot), routed pages for Save / Withdraw / Claim / Schedule / Reports / Settings, and 9-step KYC signup flow.

### Employer
- **Real-world role:** Organization managing employee pension contributions
- **Why they use the platform:** Bulk contribution uploads, employee enrollment, compliance reporting
- **Key needs:** Employee management, CSV upload, clean reporting
- **Status:** **Built / shipped to production** (2026-06-03) — desktop-first dashboard with a staff roster (unified into `subscribers` by `0043`–`0045`; still outside the agent→subscriber commission tree), contribution runs, group insurance, and a monthly-contributions leaderboard. **Funding is ONE unified two-leg model** (`0092`): the employer sets what staff put in and what the company adds, each independently either a share of the member's pay or a flat monthly amount in shillings. Either can be nothing — including both, which is a legal setup that simply funds no pension. There is no cap, no minimum, and one company-wide setup with no per-employee override; the funding "modes" (and the idea of the company *matching* a share of the staff amount) are gone. DB stack = migrations `0034`–`0039` + `0043`–`0047` + `0062`/`0066`/`0067` + `0092`. Employee **onboarding** is no longer a placeholder — it shipped as the invite-based KYC flow.

### Distributor Admin
- **Real-world role:** Network-level operations manager overseeing all branches and agents
- **Why they use the platform:** Monitor network health, track performance, manage commissions, generate reports
- **Key needs:** Network-wide visibility, branch/agent comparison, strategic reporting
- **Status:** **Fully built** — interactive map dashboard with drill-down, panels, reports (desktop). On phones (<1024px, selected via `useIsDesktop()`) it now renders a mobile PWA shell — fixed app bar + scrollable routed canvas + five-tab bottom nav, no hamburger and no map — with the agents/branches/subscribers lists virtualized and fully browsable, matching the shipped branch and employer mobile pattern.

### Branch Admin
- **Real-world role:** Local operations manager supervising agents within a single branch
- **Why they use the platform:** Monitor branch performance, manage agents, settle commissions
- **Key needs:** Agent oversight, subscriber activity, commission management, local KPIs
- **Status:** **Fully built** — branch overview dashboard with health score, copilot, agent management

### Agent
- **Real-world role:** Field worker who enrolls subscribers and collects contributions
- **Why they use the platform:** Register subscribers, record collections, track commissions
- **Key needs:** Guided workflows, fast mobile actions, commission visibility
- **Status:** **Built** — routed mobile-first dashboard with PortfolioPulseCard, CoPilot, 4-stage Onboard flow, Subscribers list + detail + schedule edit, Recharts Analytics, a Commissions view that lists `due`/`paid` lines (with a NotificationBell for settlement notifications), and Settings.

### Platform Admin
- **Real-world role:** System administrator at head office
- **Why they use the platform:** Manage users, configure system, oversee everything
- **Key needs:** Full platform control, audit trail, user management
- **Status:** A head-office **Admin** dashboard has since **shipped** (2026-06-08 — map-theme shell at `src/admin-dashboard/`, `0049`–`0051` RPCs: platform-wide reads + Distributors/Employers managers (list/metrics/create) + commission settlement; see §6 "Admin (shipped)"). On phones (<1024px via `useIsDesktop()`) it now renders a mobile PWA shell (fixed app bar + scrollable routed canvas + five-tab bottom nav, no hamburger, no map), matching the branch/employer/distributor mobile pattern. Broader system-configuration / user-management / audit-trail tooling remains planned.

---

## 3. Entity Hierarchy

```
Country (Uganda)
└── Distributor (3) — ownership edge only (branches.distributor_id), NOT a geographic level
    └── Region (4) — Central, Eastern, Northern, Western
        └── District (136) — real GADM administrative districts
            └── Branch (~321) — physical branch offices
                └── Agent (~2,046) — field workers
                    └── Subscriber (~5,000) — individual savers
```

### How the Hierarchy Works
- Each entity has a `parentId` linking to its parent
- Metrics aggregate bottom-up: subscriber data rolls up to agent → branch → district → region → country
- The distributor dashboard allows drill-down navigation through all levels
- The branch dashboard is fixed to a single branch (no hierarchy navigation)
- GeoJSON boundaries exist for districts and regions (used for map visualization)
- **Distributor is an ownership edge, not a geographic containment edge**: `branches.distributor_id → agents.branch_id → subscribers.agent_id`. A distributor's branches can span multiple regions/districts. One branch currently has `distributor_id IS NULL` and belongs to no distributor.

### Real-World Mapping
| Level | Real World | Count | Notes |
|-------|-----------|-------|-------|
| Country | Uganda | 1 | Root entity |
| Distributor | Network operator | 3 | Ownership edge (`branches.distributor_id`), not geographic — `d-001` (national), `d-002` (Busoga), `d-003` (Karamoja Pilot Network) |
| Region | Statistical region | 4 | Aligned to Uganda Bureau of Statistics regions |
| District | Administrative district | 136 | Real GADM names, used for GeoJSON map |
| Branch | Physical branch office | ~321 | 2-8 per district, more in urban areas |
| Agent | Field enrollment worker | ~2,046 | 5-8 per branch |
| Subscriber | Individual pension saver | ~5,000 | ~2-3 per agent (reseeded smaller on the new DB; was ~30,000 / ~60 per agent) |

---

## 4. Core Workflows

### 4.1 Subscriber Enrollment

**Current state:** Mock data generates subscribers; no enrollment UI for agents yet.

**Intended flow:**
1. Agent meets potential subscriber in the field
2. Agent opens enrollment form on mobile device
3. Agent enters: name, phone (+256), email, gender, age, products to enroll in
4. System sends OTP to subscriber's phone for verification
5. Subscriber provides KYC documents (National ID, etc.)
6. KYC status starts as `pending`, moves to `complete` after verification or `incomplete` if docs are insufficient
7. Subscriber record is created under the agent's ID
8. Subscriber makes first contribution → triggers commission for the agent

**KYC Statuses:**
- `complete` — all documents verified (~70% in mock)
- `pending` — documents submitted, awaiting review (~20% in mock)
- `incomplete` — documents missing or rejected (~10% in mock)

### 4.2 Contribution Collection

**Current state:** Mock data generates contribution histories; no collection UI yet.

**Intended flow:**
1. Subscriber makes a monthly contribution (5,000–50,000 UGX typical)
2. Collection can happen via:
   - Agent in-person collection (agent records it in the app)
   - Mobile money transfer
   - Employer bulk upload (for employed subscribers)
3. Contribution is recorded in the subscriber's `contributionHistory` array (12-month rolling)
4. `totalContributions` = lifetime sum of all contributions
5. Metrics cascade upward through the hierarchy

**Contribution History Shape:**
- Array of 12 numbers representing monthly contribution amounts
- Index 0 = oldest month, index 11 = most recent month
- Active subscribers show ~2% monthly growth; inactive show ~5% decline (mock approximation)

**AUM Calculation:**
- MOCK APPROXIMATION: `AUM = totalContributions * (1.35 + random * 0.2)` — simulates 35-55% investment returns
- In production: AUM should come from the fund management / investment system
- AUM represents the total value of the subscriber's pension pot including investment returns

### 4.3 Commission Lifecycle

**Current state:** Built — a flat two-state `due → paid` flow. The earlier maker-checker design (settlement runs, branch review, holds, agent confirmation, disputes, cadence) was removed in the 0029–0031 simplification and no longer exists.

**Complete flow:**

```
1. Subscriber registers with an agent
2. Subscriber makes first contribution
   └── Commission auto-created: status = "due"
       amount = the distributor's flat rate-per-subscriber (e.g. 5,000 UGX)
3. Distributor pays the agent OFFLINE (outside the platform)
4. Distributor downloads a per-agent Excel template
   (prefilled with that agent's pending "due" lines)
5. Distributor fills in Amount Paid + payment reference + payment date,
   then re-uploads the template
6. apply_settlement(p_rows jsonb) RPC:
   ├── flips that agent's "due" commissions → "paid" (records paid_amount)
   ├── records a settlement_batches row (one per agent:
   │   pending total, amount paid, txn ref, paid date, line count)
   └── emits in-app notifications (type = commission_settled)
       to the affected agent + branch (surfaced via NotificationBell)
```

There are only two statuses: `due` and `paid` (the `commission_status` ENUM is now `('due','paid')`). There is no `disputed`, `rejected`, `held`, or run/review state.

**Commission Rate:**
- Flat fee per subscriber, set by the distributor (e.g. 5,000 UGX)
- Distributor sets/changes the flat rate-per-subscriber; commissions auto-generate as `due` at the configured rate when a subscriber makes their first contribution
- UNCLEAR — confirm: Should rate changes apply retroactively to existing "due" commissions?

**Settlement mechanics:**
- Settlement is driven by the per-agent Excel download → offline pay → re-upload loop
- `apply_settlement` is keyed per agent: it flips that agent's outstanding `due` lines to `paid` in one transaction
- `mark_notifications_read` flips the read flag on settlement notifications
- No individual/bulk approve, reject, or dispute operations remain

### 4.4 Withdrawal / Payout

**Current state:** Mock data generates withdrawal amounts; no withdrawal request UI exists.

**What the mock data shows:**
- `totalWithdrawals` = 0–15% of `totalContributions` (random)
- `monthlyWithdrawals`, `weeklyWithdrawals`, `dailyWithdrawals` metrics exist at all hierarchy levels
- Reports include: Withdrawals & Payouts report with withdrawal-to-contribution ratio

**Intended flow (inferred):**
1. Subscriber requests withdrawal via their dashboard (planned)
2. Request may require approval (by branch admin or platform admin — TBD)
3. Withdrawal is processed and `totalWithdrawals` is updated
4. Withdrawal reduces AUM

**UNCLEAR — confirm with product team:**
- What are the withdrawal eligibility rules? (age-based, term-based, emergency?)
- Is there a penalty for early withdrawal?
- Who approves withdrawals?
- What is the disbursement method?

### 4.5 Branch & Agent Onboarding

**Current state:** Both CreateBranch (distributor) and CreateAgent (branch admin) forms are built.

**Create Branch flow (Distributor Admin):**
1. Branch Details step: name, district (searchable), city/town (searchable with custom option), address, landmark (optional), P.O. Box (optional)
2. Admin Details step: admin name, phone (+256, 9 digits), email (optional)
3. Review step: summary of all fields
4. On confirm: branch created, SMS credentials sent to admin
5. Branch starts with `status: 'active'`, `metrics: null`

**Create Agent flow (Branch Admin):**
1. Agent Details step: full name, phone (+256, 9 digits), email (optional), gender (male/female), national ID number (optional)
2. Review step: summary of all fields
3. On confirm: agent created, SMS credentials sent to agent
4. Agent starts with `status: 'active'`, `metrics: null`

**Required fields for branch:** name, district, city/town, address, admin name, admin phone
**Required fields for agent:** full name, phone, gender

### 4.6 KYC Verification

**Current state:** KYC status exists as a field on subscribers; no verification UI is built.

**Statuses:**
| Status | Description | Distribution (mock) |
|--------|-------------|-------------------|
| complete | All documents verified and approved | ~70% |
| pending | Documents submitted, awaiting review | ~20% |
| incomplete | Documents missing or rejected | ~10% |

**Valid transitions:**
```
(new subscriber) → pending → complete
                 → pending → incomplete → pending (resubmit)
                 → incomplete (never submitted)
```

**What exists in the UI:**
- KYC status displayed in subscriber detail views
- KYC & Compliance report aggregates kycPending and kycIncomplete counts
- Alert badges show KYC issues in branch overview

**UNCLEAR — confirm:**
- What documents are required for KYC?
- Who performs verification? (Branch admin? Platform admin? Third-party service?)
- Is there a deadline for KYC completion?
- Can a subscriber contribute before KYC is complete?

### 4.7 Reporting

**Current state:** 11 reports are fully built with client-side sorting, pagination, and filtering.

**Report Catalog:**

| # | Report | Description | Scope |
|---|--------|-------------|-------|
| 1 | Distribution Summary | Network overview by region | Distributor only |
| 2 | All Branches | Directory of all branches with metrics | Distributor only |
| 3 | All Agents | Directory of all agents with performance | Both (branch-scoped) |
| 4 | All Subscribers | Directory of all subscribers | Both (branch-scoped) |
| 5 | Contributions & Collections | Contribution data by district/agent | Both |
| 6 | Withdrawals & Payouts | Withdrawal data with W/C ratios | Both |
| 7 | Branch Performance | Branch ranking and comparison | Distributor only |
| 8 | Agent Performance | Agent ranking with ratings | Both (branch-scoped) |
| 9 | Subscriber Growth | New subscriber trends | Both |
| 10 | Subscriber Demographics | Gender and age distribution | Both |
| 11 | KYC & Compliance | KYC completion rates | Both |

**Filtering capabilities:**
- Search (text): branches, agents, subscribers by name
- Region dropdown: filter by region
- Status: active/inactive
- KYC status: complete/pending/incomplete
- Gender: male/female/other

**Sorting:** All reports support column-based sorting (client-side). ReportTable component handles ascending/descending toggle.

**Pagination:** Client-side with page sizes 25, 50, 100. For subscribers (~5K on the new DB; ~30K on the old prod), server-side pagination is required at production scale.

**Export:** CSV export is **wired client-side** via `src/utils/csv.js` (`downloadCSV(filename, headers, rows)` — RFC 4180 escaping + formula-injection defence + UTF-8 BOM for Excel). Distributor TopBar exports the current entity's children (filter-aware filename); each subscriber report view exports its own filtered rows. Backend may still need to provide server-side CSV generation for very large datasets (e.g. all subscribers at production scale), but the client-side pipeline already covers every active report.

---

## 5. Business Rules

### Commission Rate
- **Type:** Flat fee per subscriber's first contribution
- **Default:** 5,000 UGX
- **Configurable:** Yes, by distributor admin via inline UI control
- **Scope:** Global — same rate for all agents
- UNCLEAR: Should different branches/agents have different rates?

### Branch Health Score
- **Classification:** MOCK APPROXIMATION — confirm if this formula should be the production algorithm
- **Formula:**
  ```
  score = retentionRate * 0.30
        + avgContribScore * 0.25
        + agentActivity * 0.25
        + growthScore * 0.20
  ```
- **Components:**
  - `retentionRate` = (activeSubscribers / totalSubscribers) * 100
  - `avgContribScore` = min(100, (avgContributionPerSubscriber / 500,000) * 100)
  - `agentActivity` = (activeAgents / totalAgents) * 100
  - `growthScore` = normalized average month-over-month contribution growth
- **Range:** 0–100
- **Labels:** Excellent (85+), Good (70-84), Fair (50-69), Needs Attention (0-49)

### Agent Performance Score
- **Classification:** MOCK APPROXIMATION
- **Formula:** `min(100, activeRate * 0.4 + min(totalSubs/20, 1) * 30 + randInt(15,30))`
- The random component means this is NOT a deterministic business rule — production should define clear criteria

### Agent Rating
- **Classification:** MOCK APPROXIMATION
- **Formula:** Derived from performance with random variance (3.0–5.0 scale)
- In production: could be manager-assigned or calculated from KPIs

### AUM (Assets Under Management)
- **Classification:** MOCK APPROXIMATION
- **Current:** `totalContributions * (1.35 + random * 0.2)` — simulates 35-55% returns
- In production: should come from the fund/investment management system

### Active Rate
- **Formula:** `round((activeSubscribers / totalSubscribers) * 100)`
- **"Active" definition (mock):** Random 60-95% probability per subscriber
- UNCLEAR: In production, what defines "active"? Contributing in last N months?

### Coverage Rate
- **Classification:** MOCK APPROXIMATION
- **Formula (agent level):** `min(95, activeRate * 0.75 + randInt(5, 20))`
- Aggregated as weighted average across hierarchy
- UNCLEAR: What does "coverage" mean in the real business? Geographic coverage? Product penetration?

### Growth Calculations
- **Month-over-month:** `((monthlyContributions[11] - monthlyContributions[10]) / monthlyContributions[10]) * 100`
- Used in: Branch health score, report trend indicators, period cards

---

## 6. Data Scoping Rules

### By Role
| Role | Can See | Can Modify |
|------|---------|------------|
| Distributor Admin | All entities at all levels | Create branches, set the flat commission rate, settle commissions via the per-agent Excel upload (`apply_settlement`), own profile |
| Branch Admin | Own branch, own agents, own subscribers | Create agents, view own branch's commissions, receive settlement notifications, own profile |
| Agent | Own record, own subscribers, own commissions | Register subscribers, record collections, view own `due`/`paid` commissions, receive settlement notifications |
| Subscriber | Own record only | Own profile, top-up (Save), withdrawal requests |
| Employer | Own organization's tagged-subscriber roster | Invite-based member onboarding (KYC), company-wide contribution runs + group insurance, remove-from-company |
| Admin (shipped) | Everything (platform-wide reads via `*_select_admin` RLS) | Create distributors + employers, apply commission settlements, view platform overview — via the `0049`–`0051` SECURITY DEFINER RPCs. (No general "system configuration / user management" UI today — the scope is view + create-distributor/employer + settle.) |

### Backend Enforcement
The frontend applies scoping via:
1. Role-based component rendering (different dashboard shells)
2. `branchId` prop passed to data hooks
3. `BranchScopeContext` providing scope to nested components
4. Report views checking `useBranchScope()` to filter data

**Critical:** The backend MUST enforce identical scoping. Frontend scoping is for UX, not security. Every API request should verify the authenticated user's role and scope against the requested resource.

---

## 7. Frontend Features Requiring Backend Support

| Feature | Current State | Backend Requirement |
|---------|--------------|-------------------|
| OTP Authentication | Mock (`services/auth.js` returns any 6-digit code; throws structured `AuthError` for QA force-flags) | Real SMS OTP service + JWT token issuance. Errors must use the same `{ code, retryAfterSeconds? }` shape consumed by `OtpVerify`. |
| Entity CRUD | Mock (in-memory) | REST API for all entity operations |
| Commission Settlement | **Built** — `due → paid` via offline pay + per-agent Excel download/re-upload → `apply_settlement` RPC (records a `settlement_batches` row + notifies agent + branch). React Query invalidation in place. | Real payment integration (the actual payout is offline today) |
| AI Chat Assistant | Mock (keyword matching) — six chat surfaces: distributor copilot, branch copilot, agent copilot, subscriber copilot, subscriber Help, subscriber↔agent DM | LLM integration (e.g., Claude API) with DB access, scoped to user's data visibility |
| Search | Mock (client-side filter) | Server-side full-text search (Elasticsearch or PostgreSQL tsvector) |
| Report Export (CSV) | **Wired** — `utils/csv.js` produces RFC 4180 + formula-injection-safe CSVs. Distributor TopBar + subscriber report views all export. | Server-side CSV generation needed for very large datasets (all subscribers at production scale) but client pipeline is complete. |
| Filter Dropdowns | Client-side filtering | Server-side filtering for reports with >500 rows |
| Subscriber Pagination | All ~5K loaded in memory (was ~30K pre-cutover) | Server-side pagination (page, pageSize, sort, filter params) |
| Map GeoJSON | Static files in /public/ | Could remain static or be served from API |
| Profile Update | **Wired** to `services/subscriber.js#updateProfile` and `AuthContext.updateUser`; React Query optimistic-update with rollback. | `PUT /api/subscribers/:id/profile` |
| Password Change | Stubbed UI (Settings/distributor + agent SettingsPage); shows "activates with backend" toast | `PUT /api/profile/password` |
| Real-time Activity Feed | Mock (renamed "Today's Snapshot" — derived from current metrics, not a real-time feed) | WebSocket or polling for live events |
| Agent GPS Location | Mock (jittered from branch) | Real GPS from agent mobile app, or omit |
| Withdrawal Flow | **Built** UI — `WithdrawalsHubPage` → `WithdrawPage` (savings) / `ClaimPage` (insurance). ClaimPage now passes `File[]` blobs through to mutation. | Full workflow: request → approve → disburse + multipart upload (or presigned URLs) for claim documents |
| KYC Verification | **Built** — 9-step Smile-ID-shaped pipeline (id-upload → review → nira → otp → liveness → aml → beneficiaries → consent → done) with `onboardingSessionId` correlation across stages. | Real Smile ID v2 endpoints + agent referral ticket creation. Force-override `localStorage` keys are gated to `IS_DEV` only. |
| Notification/SMS | Mentioned in UI ("credentials sent via SMS"); subscriber Notifications/Security routes are placeholders | SMS gateway integration (e.g., Africa's Talking, Twilio) |
| Contact form | Demo-mode stub at `services/contact.js` — logs to console, returns success | `POST /api/contact` (or external provider like Formspree) |

---

## 8. Technical Constraints

### Currency
- **UGX** — Ugandan Shillings, integer-only (no decimals)
- Store as integers in the database
- Frontend formatting: `formatUGX()` and `formatUGXShort()` in `src/utils/currency.js`

### Phone Numbers
- Format: `+256` followed by 9 digits
- Valid carrier prefixes: 70, 71, 74, 75, 76, 77, 78
- Frontend stores 9-digit number without prefix; displays with +256
- Input: `inputMode="numeric"`, validated for 9-digit length

### Date Format
- ISO 8601: `YYYY-MM-DD` (e.g., `2026-04-08`)
- Mock reference date: April 8, 2026 (used for commission status determination)
- Display: `toLocaleDateString('en-UG', { weekday, day, month, year })`

### GeoJSON
- District boundaries: `/public/uganda-districts.geojson` (136 districts, GADM source)
- Region boundaries: `/public/uganda-regions.geojson` (4 regions)
- Coordinates: longitude, latitude pairs
- Used for: Leaflet map rendering, choropleth coloring

### Authentication
- OTP-based login (6-digit codes)
- JWT token stored in `localStorage` as `upensions_token`
- User session stored in `localStorage` as `upensions_auth`
- Token sent as `Authorization: Bearer <token>` header
- 401 response triggers automatic logout + redirect to landing page (via `onAuthExpired` listener registered by `AuthContext`)
- API base URL configured via `API_BASE_URL` environment variable
- **Errors:** `services/auth.js` throws `AuthError` instances with `code` (`invalid_otp` | `rate_limited` | `locked`) and optional `retryAfterSeconds`. `OtpVerify` consumes this shape — backend rejection messages must follow the same contract. Max 5 verify attempts per session before the form locks; resend resets the counter.
- **User shape:** `verifyOtp` MUST return `{ token, user: { phone, role, name, branchId?, agentId?, distributorId? } }`. The client no longer injects scoping IDs — they come from the backend.

### Frontend Stack
- React 19 + Vite 6
- React Router (URL-based navigation)
- TanStack React Query (caching, deduplication, stale-while-revalidate)
- Framer Motion (animations)
- CSS Modules (component-scoped styles)
- Leaflet (map)
- No Tailwind, no component library

### Data Access Pattern
```
Component → React Query Hook → Service Function → (currently mockData, future: API)
```
Only service files import from mockData. When the backend is ready, only service files change — hooks and components remain untouched.

---

## 9. Open Questions

These are things that could not be determined from the frontend code alone. The backend developer should confirm with the product team.

### Business Logic
1. **What defines an "active" subscriber?** Mock uses random probability. Production likely needs "contributed in last N months" or similar rule.
2. **What is "coverage rate"?** Mock derives it from active rate with random variance. Is it geographic coverage? Product penetration? Something else?
3. **Should commission rate changes apply retroactively?** The `setCommissionRate` function changes the global rate. Should existing "due" commissions use the old or new rate?
4. **Is the Branch Health Score formula the real one?** It's implemented in both mockData.js and BranchHealthScore.jsx with specific weights. Was this designed by product, or is it a prototype approximation?
5. **What are the withdrawal eligibility rules?** No withdrawal UI exists. Need: eligibility criteria, approval flow, disbursement method, penalties.
6. **Can subscribers contribute before KYC is complete?** Mock data doesn't enforce this. What's the policy?
7. **Is `paid` a terminal state for commissions?** The flow is now flat `due → paid` (no dispute/reject path). Once `apply_settlement` flips a line to `paid`, is there any correction/reversal path, or is `paid` final?

### Scoping & Multi-tenancy
8. **Should distributor admin be scoped to a specific distributor?** Currently sees the entire network. If multiple distributors exist, each should only see their own.
9. **Can an agent work across multiple branches?** Current model assumes 1 agent → 1 branch. Is cross-branch assignment possible?
10. **Are regions and districts editable?** Currently static data. Can admins create new districts or reassign branches between districts?

### Technical
11. **What SMS gateway should be used?** The UI mentions "credentials sent via SMS" for branch/agent creation. Options: Africa's Talking, Twilio, etc.
12. **What fund/investment system provides AUM data?** Currently mocked. Need integration point for real AUM calculations.
13. **Should the AI chat use Claude API?** Mock uses keyword matching. Production needs LLM + DB integration for real-time data analysis.
14. **What's the export format?** Download button is a placeholder. Need: CSV format specification, column definitions per report, streaming for large datasets.
15. **Real-time requirements?** The activity feed and "Live" indicator suggest real-time updates. Need: WebSocket vs polling decision, event types, latency requirements.
