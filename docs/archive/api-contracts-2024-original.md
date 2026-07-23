> **Agent guide.** Historical report from 2026-05-26, covering the original archived API-contract spec (a ~30-route REST design that was never built that way) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# API Contracts — Original (Archived 2026-05-26)

ARCHIVED — this document describes a ~30-route REST API that was never built that way. The actual surface is 14 Vercel-style serverless routes + Supabase RPCs + PostgREST policies. See `docs/api-contracts.md` for the current surface, or `BACKEND.md` for the runtime details.

Preserved here for historical context only.

---

# Universal Pensions Uganda — API Contracts

> This document maps every frontend service function to its intended REST API endpoint.
> It describes request parameters, response shapes, callers, cache keys, and invalidation rules.
> The frontend uses React Query for caching. Endpoint paths are inferred from service function comments and usage patterns.

---

## 1. Authentication

### POST /api/auth/send-otp
- **Service Function:** `sendOtp(phone, role)`
- **Request Body:** `{ "phone": "7XXXXXXXX", "role": "subscriber|employer|distributor|branch|agent|admin" }`
- **Response:** `{ "success": true }`
- **Called By:** `SignInModal → PhoneEntry` component directly
- **Cache Key:** None (not cached)
- **Notes:** Phone should be validated as a 9-digit Ugandan number. Role is needed to determine OTP delivery method or scoping.

### POST /api/auth/verify-otp
- **Service Function:** `verifyOtp(phone, otp, role)`
- **Request Body:** `{ "phone": "7XXXXXXXX", "otp": "123456", "role": "branch" }`
- **Response:** `{ "token": "jwt-string", "user": { "phone": "...", "role": "...", "name": "...", "branchId?": "...", "agentId?": "..." } }`
- **Called By:** `SignInModal → OtpVerify` component directly
- **Cache Key:** None
- **Notes:**
  - For `branch` role: response MUST include `branchId`
  - For `agent` role: response should include `agentId`
  - For `distributor` role: may include `distributorId` if multi-distributor
  - Token stored in localStorage as `upensions_token`
  - User object stored in localStorage as `upensions_auth`

### hasDashboard(role) — Client-side only
- **Not an API endpoint** — client-side guard checking if role is in `['distributor', 'branch', 'subscriber', 'agent']`
- Backend should enforce equivalent authorization on protected endpoints

### Auth error shape
- `verifyOtp` (and any auth-related endpoint) must reject with the canonical `AuthError` shape: `{ code: 'invalid_otp' | 'rate_limited' | 'locked', message?: string, retryAfterSeconds?: number }`.
- The client (`OtpVerify`) maps each `code` to a specific user-facing message. Rate-limit / locked responses freeze the form until the resend cooldown elapses.

---

## 2. Entities

### GET /api/country
- **Service Function:** `getCountry()`
- **Response:** `{ "id": "ug", "name": "Uganda", "center": [32.3, 1.4], "metrics": { ...Metrics } }`
- **Called By:** `OverlayPanel → useCountry()`, `DistributionSummary` report
- **Cache Key:** `['country']`
- **Invalidated By:** None (country data is relatively static; metrics update on data changes)

### GET /api/entities/:level/:id
- **Service Function:** `getEntity(level, id)`
- **Path Params:** `level` = region|district|branch|agent|subscriber, `id` = entity ID
- **Response:** Entity object (shape varies by level — see data-model.md)
- **Called By:** `OverlayPanel → useEntity()`, `BranchOverview → useEntity()`, various detail views
- **Cache Key:** `['entity', level, id]`
- **Invalidated By:** Entity mutations (createBranch, etc.)
- **Notes:** Should return 404 if entity not found. Enabled only when `id` and `level` exist and `level !== 'country'`.

### GET /api/entities/:level/:parentId/children
- **Service Function:** `getChildren(level, parentId)`
- **Path Params:** `level` = parent's level, `parentId` = parent's ID
- **Response:** `Array<Entity>` — all direct children at next hierarchy level
- **Called By:** `OverlayPanel → useChildren()`, `BranchOverview → useChildren()`, `ContributionsCollections`, `WithdrawalsPayouts`, `SubscriberGrowth`, `SubscriberDemographics`, `KycCompliance` (when branch-scoped — fetches agents under branch)
- **Cache Key:** `['children', level, parentId]`
- **Invalidated By:** `createBranch` mutation
- **Notes:** Enabled only when `parentId` exists.

### GET /api/entities/:level
- **Service Function:** `getAllAtLevel(level)`
- **Path Params:** `level` = region|district|branch|agent|subscriber
- **Response:** `Array<Entity>` — all entities at that level
- **Called By:** Report views: `AllBranches → useAllEntities('branch')`, `AllAgents → useAllEntities('agent')`, `AllSubscribers → useAllEntities('subscriber')`, `DistributionSummary → useAllEntities('region')`, and multiple reports using `useAllEntitiesMap()`
- **Cache Key:** `['entities', level]`
- **Invalidated By:** `createBranch` mutation (for branch level)
- **Pagination Notes:**
  - `region` (4 items) — no pagination needed
  - `district` (135 items) — no pagination needed
  - `branch` (~314 items) — client-side OK
  - `agent` (~500+ items) — client-side OK for now, server-side recommended at scale
  - `subscriber` (~30,000 items) — **MUST have server-side pagination** in production. Current client loads all into memory.

### GET /api/entities/:level (as map)
- **Service Function:** `getAllAtLevelMap(level)`
- **Response:** Same data as `getAllAtLevel` but restructured as `{ [id]: Entity }` on the client
- **Called By:** Report views for parent name resolution (e.g., agent → branch name lookup)
- **Cache Key:** `['entitiesMap', level]`
- **Notes:** This is a client-side reshaping of `getAllAtLevel`. Backend returns the same array; the hook converts it to a map. Could be replaced by embedding parent names in entity responses.

### GET /api/entities/:level/:id/parent
- **Service Function:** `getParent(level, id)`
- **Response:** Parent entity object or `null`
- **Called By:** Not directly cached — used internally
- **Notes:** In production, consider embedding parent info in the entity response to eliminate this call.

### GET /api/entities/:level/:parentId/top-branch
- **Service Function:** `getTopPerformingBranch(level, parentId)`
- **Path Params:** `level` = country|region|district, `parentId` = entity ID
- **Response:** `{ "name": "Branch Name", "contribution": 1234567 }` or `null`
- **Called By:** `OverlayPanel → useTopBranch()` — "Top Branch" metric card
- **Cache Key:** `['topBranch', level, parentId]`
- **Notes:** Returns the branch with the highest `monthlyContributions[11]` (latest month) within scope. Enabled when both `level` and `parentId` exist.

### GET /api/breadcrumb
- **Service Function:** `getBreadcrumb(currentLevel, selectedIds)`
- **Query Params:** `level` = current level, `ids` = JSON-encoded `{ level: id }` map
- **Response:** `Array<{ level: string, id: string, name: string }>` — path from country to current
- **Called By:** `Breadcrumb → useBreadcrumb()` in distributor dashboard
- **Cache Key:** `['breadcrumb', currentLevel, selectedIds]`
- **Notes:** Disabled at country level. In production, could be derived from entity ancestor chain.

### POST /api/branches
- **Service Function:** `createBranch(data)`
- **Request Body:** `{ "name": "Branch Name", "districtId": "d-xxx", "cityTown": "Town", "address": "...", "landmark?": "...", "poBox?": "...", "adminName": "...", "adminPhone": "7XXXXXXXX", "adminEmail?": "..." }`
- **Response:** `{ "id": "b-new-xxx", "status": "active", "metrics": null, ...data }`
- **Called By:** `CreateBranch → useCreateBranch()` mutation
- **Cache Key:** Invalidates: `['entities', 'branch']`, `['children']`
- **Notes:** Should also create a user account for the admin (role: 'branch') and send SMS credentials.

### POST /api/agents
- **Service Function:** Not yet in services (CreateAgent component exists in branch dashboard)
- **Request Body (inferred from UI):** `{ "fullName": "...", "phone": "7XXXXXXXX", "email?": "...", "gender": "male|female", "idNumber?": "...", "branchId": "b-xxx" }`
- **Response:** `{ "id": "a-new-xxx", "status": "active", "metrics": null, ...data }`
- **Notes:** Inferred from `CreateAgent.jsx`. Should create agent entity + user account (role: 'agent') and send SMS credentials. Branch Admin and Distributor Admin can perform this action.

### GET /api/search?q=:query
- **Service Function:** `searchEntities(query)`
- **Query Params:** `q` = search string (min 2 chars)
- **Response:** `Array<{ id: string, name: string, level: string, label: string, parentId: string }>` — max 8 results
- **Called By:** `TopBar search → useSearch()` (distributor dashboard)
- **Cache Key:** `['search', query]`
- **Notes:** Searches regions, districts, branches, agents by name. Does NOT search subscribers. In production: implement full-text search with relevance scoring. Consider Elasticsearch or PostgreSQL `tsvector`.

### getEntitySync(level, id) — Client-side only
- **Not an API endpoint** — synchronous lookup used by `DashboardContext` for URL → state derivation
- In production: embed ancestor IDs in entity responses, or encode full path in URL

---

## 3. Commissions

### GET /api/commissions/rate
- **Service Function:** `getCommissionRate()`
- **Response:** `5000` (number — UGX per subscriber)
- **Called By:** `CommissionPanel → useCommissionRate()`
- **Cache Key:** `['commissionRate']`

### PUT /api/commissions/rate
- **Service Function:** `setCommissionRate(amount)`
- **Request Body:** `{ "amount": 6000 }`
- **Response:** `6000` (the updated rate)
- **Called By:** `CommissionPanel → useSetCommissionRate()` mutation
- **Cache Key:** Invalidates: `['commissionRate']`
- **Scope:** Distributor only

### GET /api/commissions/summary
- **Service Function:** `getCommissionSummary(branchId)`
- **Query Params:** `branchId` (optional)
- **Response:** `{ "totalCommissions": number, "totalPaid": number, "totalDue": number, "totalDisputed": number, "totalRequested": number, "countTotal": number, "countPaid": number, "countDue": number, "countDisputed": number, "countRequested": number }`
- **Called By:** `CommissionPanel → useCommissionSummary()`
- **Cache Key:** `['commissionSummary', branchId || 'all']`
- **Invalidated By:** All settlement and dispute mutations

### GET /api/commissions/agents
- **Service Function:** `getAgentCommissionList(statusFocus)`
- **Query Params:** `status` (optional: paid|due|disputed)
- **Response:** `Array<{ agentId, agentName, branchId, branchName, totalCommissions, totalPaid, totalDue, subscribersOnboarded, activeSubscribers, filteredAmount, filteredCount }>`
- **Called By:** `CommissionPanel → useAgentCommissionList()`
- **Cache Key:** `['agentCommissions', statusFocus || 'all']`
- **Invalidated By:** All commission mutations
- **Pagination:** ~500 agents — consider server-side pagination at scale

### GET /api/commissions/agents/:agentId
- **Service Function:** `getAgentCommissionDetail(agentId)`
- **Response:** `{ agentId, agentName, agentPhone, branchId, branchName, rating, totalCommissions, totalPaid, totalDue, subscribersOnboarded, activeSubscribers, dormantSubscribers, paidTransactions: Array<{id, transactionDate, amount, agentConfirmed, subscriberId, subscriberName}>, dueTransactions: Array<{id, dueDate, daysToDate, amount, branchId, branchName, subscriberId, subscriberName}>, commissions: Array<Commission> }`
- **Called By:** `CommissionPanel → useAgentCommissionDetail()`
- **Cache Key:** `['agentCommissionDetail', agentId]`
- **Invalidated By:** All commission mutations
- **Notes:** `daysToDate` = days until due date (negative if overdue). Enabled when `agentId` exists.

### GET /api/commissions/agents/:agentId/subscribers
- **Service Function:** `getCommissionSubscribers(agentId, filter)`
- **Query Params:** `filter` = active|dormant (optional)
- **Response:** `Array<{ subscriberId, subscriberName, registeredDate, lastContribution, lastContributionDate, totalContributions, isActive }>`
- **Called By:** `CommissionPanel → useCommissionSubscribers()`
- **Cache Key:** `['commissionSubscribers', agentId, filter || 'all']`
- **Notes:** Enabled when `agentId` exists.

### GET /api/commissions/disputed
- **Service Function:** `getDisputedAgentList()`
- **Response:** `Array<{ agentId, agentName, branchId, branchName, disputedCount, disputedAmount, disputes: Array<{id, subscriberId, subscriberName, amount, dueDate, reason}> }>`
- **Called By:** `CommissionPanel → useDisputedAgentList()`
- **Cache Key:** `['disputedAgents']`
- **Invalidated By:** Approve/reject mutations

### GET /api/commissions/settlement-requests
- **Service Function:** `getSettlementRequestList()`
- **Response:** `Array<{ agentId, agentName, branchId, branchName, requestedCount, requestedAmount, requests: Array<{id, subscriberId, subscriberName, amount, dueDate}> }>`
- **Called By:** `CommissionPanel → useSettlementRequestList()`
- **Cache Key:** `['settlementRequests']`
- **Invalidated By:** Settlement mutations

### POST /api/commissions/:commissionId/approve
- **Service Function:** `approveCommission(commissionId)`
- **Response:** Updated commission object (status → 'due', disputeReason → null)
- **Called By:** `CommissionPanel → useApproveCommission()` mutation
- **Cache Key:** Invalidates: ALL_COMMISSION_KEYS (`commissionSummary`, `agentCommissions`, `agentCommissionDetail`, `disputedAgents`, `settlementRequests`, `entityCommissionSummary`)

### POST /api/commissions/:commissionId/reject
- **Service Function:** `rejectCommission(commissionId)`
- **Response:** Updated commission object (status → 'rejected')
- **Called By:** `CommissionPanel → useRejectCommission()` mutation
- **Cache Key:** Invalidates: ALL_COMMISSION_KEYS

### POST /api/commissions/bulk-approve
- **Service Function:** `bulkApproveCommissions(commissionIds)`
- **Request Body:** `{ "commissionIds": ["c-00001", "c-00002"] }`
- **Response:** `Array<Commission>` — updated commissions
- **Called By:** `CommissionPanel → useBulkApproveCommissions()` mutation
- **Cache Key:** Invalidates: ALL_COMMISSION_KEYS

### POST /api/commissions/bulk-reject
- **Service Function:** `bulkRejectCommissions(commissionIds)`
- **Request Body:** `{ "commissionIds": ["c-00001", "c-00002"] }`
- **Response:** `Array<Commission>` — updated commissions
- **Called By:** `CommissionPanel → useBulkRejectCommissions()` mutation
- **Cache Key:** Invalidates: ALL_COMMISSION_KEYS

### POST /api/commissions/settle
- **Service Function:** `settleCommissions(commissionIds)`
- **Request Body:** `{ "commissionIds": ["c-00001", "c-00002"] }`
- **Response:** `{ "settled": 2, "paidDate": "2026-04-08" }`
- **Called By:** `CommissionPanel → useSettleCommissions()` mutation
- **Cache Key:** Invalidates: `['commissionSummary']`, `['agentCommissions']`, `['agentCommissionDetail']`

### POST /api/commissions/agents/:agentId/settle
- **Service Function:** `settleAgentCommissions(agentId)`
- **Response:** `{ "settled": number, "paidDate": "2026-04-08" }`
- **Called By:** `CommissionPanel → useSettleAgentCommissions()` mutation
- **Cache Key:** Invalidates: `['commissionSummary']`, `['agentCommissions']`, `['agentCommissionDetail']`

### POST /api/commissions/settle-all
- **Service Function:** `settleAllCommissions(branchId)`
- **Query Params:** `branchId` (optional)
- **Response:** `{ "settled": number, "paidDate": "2026-04-08" }`
- **Called By:** `CommissionPanel → useSettleAllCommissions()` mutation
- **Cache Key:** Invalidates: `['commissionSummary']`, `['agentCommissions']`, `['agentCommissionDetail']`

### GET /api/commissions/entity-summary/:level/:entityId
- **Service Function:** `getEntityCommissionSummary(level, entityId)`
- **Response:** `{ "totalPaid": number, "totalDue": number, "totalDisputed": number, "countPaid": number, "countDue": number, "countDisputed": number, "total": number, "countTotal": number, "settlementRate": number }`
- **Called By:** `OverlayPanel → useEntityCommissionSummary()`, `BranchOverview → useEntityCommissionSummary()`, `ViewBranches` detail, `ViewAgents` detail
- **Cache Key:** `['entityCommissionSummary', level, entityId]`
- **Invalidated By:** All commission mutations (via ALL_COMMISSION_KEYS)
- **Notes:** Enabled when `entityId` exists OR `level === 'country'`. Server should aggregate commission records for the entity's scope.

---

## 4. Chat (AI Assistant)

### POST /api/chat
- **Service Function:** `getChatResponse(message)`
- **Request Body:** `{ "message": "How are my agents performing?" }`
- **Response:** `"Top 3 agents by performance: ..."` (plain text string)
- **Called By:** `MetricsRow → DataAssistant` (distributor), `BranchHealthScore → BranchCopilot` (branch)
- **Cache Key:** Not cached (each message is unique)
- **Notes:**
  - Currently mock: keyword-matching returns pre-built responses about agents, coverage, subscribers, gender
  - In production: integrate with LLM (e.g., Claude API) connected to the database
  - Should be scoped to user's data visibility (distributor sees all, branch sees own branch)
  - Suggested prompts in UI: "Top agents?", "Gender split?", "Monthly trend?", "Active subscribers?", "Show monthly trend"

---

## 5. Profile / Settings

These endpoints are inferred from `Settings.jsx` — no service functions exist yet.

### PUT /api/profile
- **Request Body:** `{ "name": "New Name", "email": "new@email.com", "phone": "7XXXXXXXX" }`
- **Response:** `{ "success": true, "user": { ...updatedFields } }`
- **Called By:** `Settings` panel save button
- **Notes:** Name and phone are required. Email is optional. Phone uses +256 prefix. Validation: name non-empty, phone 9 digits.

### PUT /api/profile/password
- **Request Body:** `{ "currentPassword": "...", "newPassword": "..." }`
- **Response:** `{ "success": true }`
- **Called By:** `Settings` panel password section
- **Notes:** Validation: min 8 chars for new password. Strength meter levels: Weak (<8), Fair (8+), Good (12+ or has special chars), Strong (12+ and mixed case and special chars).

---

## 6. Reports

Reports are client-side views that compose data from entity and commission hooks. They don't have dedicated API endpoints — they reuse the entity endpoints above. However, at scale, some reports will need dedicated server-side endpoints.

### Report Data Sources

| Report | Data Hooks | Filter Parameters | Pagination Needed |
|--------|-----------|-------------------|-------------------|
| Distribution Summary | `useCountry()`, `useAllEntities('region')` | None | No (4 regions) |
| All Branches | `useAllEntities('branch')`, `useAllEntitiesMap('district')`, `useAllEntitiesMap('region')` | search, region, status | No (~314 branches) |
| All Agents | `useAllEntities('agent')`, `useAllEntitiesMap('branch')`, `useAllEntitiesMap('district')`, `useAllEntitiesMap('region')` | search, region, status | Recommended (~500+ agents) |
| All Subscribers | `useAllEntities('subscriber')`, `useAllEntitiesMap('agent')`, `useAllEntitiesMap('branch')` | search, kycStatus, activeStatus, gender | **YES** (~30K subscribers) |
| Contributions & Collections | `useAllEntities('district')` OR `useChildren('branch', branchId)`, `useAllEntitiesMap('region')` | region | No (135 districts / ~8 agents) |
| Withdrawals & Payouts | Same as Contributions | region | No |
| Branch Performance | `useAllEntities('branch')`, `useAllEntitiesMap('district')`, `useAllEntitiesMap('region')` | search, region | No (~314) |
| Agent Performance | `useAllEntities('agent')`, `useAllEntitiesMap('branch')`, maps | search, region | Recommended (~500+) |
| Subscriber Growth | `useAllEntities('district')` OR `useChildren('branch', branchId)`, map | region | No |
| Subscriber Demographics | Same as Growth | None | No |
| KYC & Compliance | `useAllEntities('subscriber')` OR `useChildren('branch', branchId)`, maps | region | **YES** for distributor (aggregates 30K subscribers) |

### Report Column Definitions

Each report has specific sortable columns. The `ReportTable` component handles client-side sorting and pagination (page sizes: 25, 50, 100). In production, reports with >500 rows should support server-side sorting and pagination.

**Key report-specific calculations (should be server-side in production):**
- Branch Performance: `rank` (by totalContributions), `growth` (MoM % from monthlyContributions[10] vs [11]), `subsPerAgent` (totalSubscribers / totalAgents)
- Agent Performance: `rank` (by totalContributions)
- Contributions: `monthlyTrend` (MoM % change), `avgContribution` (total / subscribers)
- Withdrawals: `withdrawalRatio` (totalWithdrawals / totalContributions * 100)
- KYC Compliance: `completePct`, `pendingPct`, `incompletePct` (derived from kycPending, kycIncomplete, totalSubscribers)
- Subscriber Demographics: `youthPct` (sum of 18-25 + 26-35 / total * 100)

### Branch-Scoped Reports
When `branchId` is provided (Branch Admin), reports:
- Show agents instead of districts as rows
- Hide region filter
- Exclude 3 reports: Distribution Summary, All Branches, Branch Performance (defined in `BRANCH_EXCLUDED_REPORTS`)
- Use `useChildren('branch', branchId)` instead of `useAllEntities('district')`

---

## 7. Subscriber endpoints

The Subscriber dashboard consumes these via `src/hooks/useSubscriber.js`. All require an authenticated subscriber token; the backend MUST scope every response by the authenticated subscriber's ID — never accept a `subscriberId` query param from the client for "self" reads.

### GET /api/subscribers/me
- **Service Function:** `getCurrentSubscriber(phone)` (resolves to the authenticated subscriber)
- **Response:** Full subscriber object (see `data-model.md`) with embedded `transactions[]`, `claims[]`, `withdrawals[]`, `nominees`, `insurance`, `contributionSchedule`, `agent`.
- **Cache Key:** `['currentSubscriber', phone]`
- **Notes:** First-load read for the entire subscriber dashboard. Embedding sub-collections keeps initial load to a single round-trip; pagination becomes important once a subscriber has thousands of transactions.

### GET /api/subscribers/me/transactions
- **Service Function:** `getSubscriberTransactions(id, filters)`
- **Query Params:** `type`, `status`, `from`, `to`, `page`, `pageSize`
- **Response:** `{ transactions: Transaction[], total: number }`
- **Cache Key:** `['subscriberTransactions', id, filters]`

### GET /api/subscribers/me/claims
- **Service Function:** `getSubscriberClaims(id)`
- **Response:** `Claim[]`
- **Cache Key:** `['subscriberClaims', id]`

### GET /api/subscribers/me/nominees
- **Service Function:** `getSubscriberNominees(id)`
- **Response:** `{ pension: Nominee[], insurance: Nominee[] }`
- **Cache Key:** `['subscriberNominees', id]`

### GET /api/subscribers/me/agent
- **Service Function:** `getSubscriberAgent(id)`
- **Response:** `{ id, name, phone, branchId, branchName, ... }` — the assigned agent enriched with branch info
- **Cache Key:** `['subscriberAgent', id]`

### POST /api/subscribers/me/contribute
- **Service Function:** `makeAdHocContribution(id, payload)`
- **Request Body:** `{ amount: number, method: 'mtn' | 'airtel' | 'card' | ..., reference?: string }`
- **Response:** Updated `Transaction`
- **Hook:** `useMakeContribution` — invalidates `currentSubscriber`, `subscriberTransactions`.

### POST /api/subscribers/me/withdraw
- **Service Function:** `requestWithdrawal(id, payload)`
- **Request Body:** `{ amount: number, bucket: 'retirement' | 'emergency', reason: string, method: string }`
- **Response:** New `Withdrawal` record with status: `'pending'`.
- **Hook:** `useRequestWithdrawal`

### POST /api/subscribers/me/claims
- **Service Function:** `submitClaim(id, payload)`
- **Request Body (multipart/form-data):**
  - `type` — `medical | accident | hospitalization | critical_illness`
  - `incidentDate` — ISO date
  - `amount` — UGX integer
  - `description` — string
  - `files[]` — actual `File` blobs (the client now passes real files, not just metadata)
- **Response:** New `Claim` record with status: `'submitted'`.
- **Hook:** `useSubmitClaim`. Alternative implementation: presigned URL upload first, then send URL refs in JSON body.

### PUT /api/subscribers/me/schedule
- **Service Function:** `updateContributionSchedule(id, schedule)`
- **Request Body:** `{ frequency: 'weekly'|'monthly'|'quarterly'|'half-yearly'|'annually', amount: number, retirementPct: number, emergencyPct: number }`
- **Response:** Updated `subscriber.contributionSchedule`
- **Hook:** `useUpdateSchedule` (subscriber-side) and `useUpdateSubscriberSchedule(subscriberId, agentId)` (agent-side; same endpoint, just additionally invalidates the agent's portfolio cache).

### PUT /api/subscribers/me/nominees
- **Service Function:** `updateNominees(id, payload)`
- **Request Body:** `{ pension?: Nominee[], insurance?: Nominee[] }` (only the tab being edited is sent)
- **Response:** Updated `nominees`
- **Hook:** `useUpdateNominees` — uses optimistic update + rollback (see Phase B-7 in the audit's backend-readiness checklist).

### PUT /api/subscribers/me/insurance
- **Service Function:** `updateInsuranceCover(id, payload)`
- **Request Body:** `{ cover: number, premiumMonthly: number }` — works for both upgrade and downgrade.
- **Response:** Updated `insurance`
- **Hook:** `useUpdateInsuranceCover`

### PUT /api/subscribers/me/profile
- **Service Function:** `updateProfile(id, updates)`
- **Request Body:** Partial of `{ name, email, phone }`. Phone is canonical 9-digit Uganda local digits (validated via `utils/phone.js#isValidUGPhone`).
- **Response:** Updated subscriber-shaped fields
- **Hook:** `useUpdateProfile` — uses optimistic update + rollback.

---

## 8. Agent endpoints

Agent dashboard consumes these via `src/hooks/useAgent.js`. Every response must be scoped to the authenticated agent's ID — never trust client-supplied `agentId` for "self" reads.

### GET /api/agents/me/subscribers
- **Service Function:** `getAgentSubscriberList(agentId)`
- **Response:** `Array<{ id, name, phone, gender, age, district, registeredDate, totalContributions, netBalance, isActive, contributionSchedule, products[] }>`
- **Cache Key:** `['agentSubscribers', agentId]`
- **Notes:** Used by SubscribersPage list, SubscriberDetailPage, AnalyticsPage demographics derivation. At 60 subscribers/agent average, no pagination needed for this endpoint specifically.

### GET /api/agents/me/commissions/detail
- Same shape as `/api/commissions/agents/:agentId` (Section 3) but always scoped to the authenticated agent.
- **Cache Key:** `['agentCommissionDetail', agentId]`

### GET /api/agents/me/cadence
- **Service Function:** `getNetworkCadence()` (currently shared client-side; agents may have per-account cadence in production)
- **Response:** `{ cadence: 'WEEKLY_FRIDAY' | 'BIWEEKLY_FRIDAY' | 'MONTHLY_FIRST' }`
- **Cache Key:** `['networkCadence']`

### POST /api/commissions/:commissionId/agent-confirm
- **Service Function:** `agentConfirmCommission(commissionId)`
- **Response:** Updated commission (`agentConfirmed: true`)
- **Hook:** `useAgentConfirmCommission`. Maker-checker counterpart to admin `settleCommissions`.

### POST /api/commissions/:commissionId/dispute
- **Service Function:** `disputeCommission(commissionId, reason)`
- **Request Body:** `{ reason: string }`
- **Response:** Updated commission (`status: 'disputed'`, `disputeReason` set)
- **Hook:** `useDisputeCommission`

### POST /api/commissions/:commissionId/withdraw-dispute
- **Service Function:** `withdrawDispute(commissionId)`
- **Response:** Updated commission (status reverts to `'due'`)

### POST /api/agents/me/onboard-subscriber
- **Inferred** from `OnboardPage` flow (4-stage: awareness → KYC → schedule → done).
- **Request Body (multipart/form-data):** Full subscriber payload + KYC documents collected during the 9-step KYC sub-flow. The agent's `onboardingSessionId` correlates the KYC stages.
- **Response:** New subscriber record + commission record (status `'due'`) for the agent.

---

## 9. KYC endpoints

The signup flow at `/signup/*` (also embedded in agent's `/dashboard/onboard`) consumes these via `src/services/kyc.js`. Each request includes a client-generated `onboardingSessionId` (UUID, persisted in `SignupContext`) so the backend can correlate every stage of one onboarding job.

The backend integration target is **Smile ID v2** — endpoint shapes match Smile ID's request/response contract. Each endpoint accepts `{ ...payload, sessionId, prevTrackingIds? }` and returns a `trackingId` the next stage can pass back as a correlation key.

### POST /api/kyc/id-quality
- **Service Function:** `assessImageQuality(file)`
- **Request Body (multipart/form-data):** `image` (File), `sessionId`
- **Response:** `{ blur: boolean, corners: boolean, glare: boolean, pass: boolean, score: number }`
- **Notes:** Client-side guard rail. Real provider runs the same checks server-side before committing OCR credits.

### POST /api/kyc/id-ocr
- **Service Function:** `extractIdFields({ front, back, sessionId })`
- **Request Body (multipart/form-data):** `front`, `back` (Files), `sessionId`
- **Response:** `IdExtraction` — `{ fullName, nin, cardNumber, dob, districtId, gender, barcodeRaw, confidence, trackingId }`
- **Notes:** OCR + barcode cross-check. Confidence is a 0-1 composite reflecting both OCR and barcode agreement; the client renders this as a high/mid/low badge on ReviewStep.

### POST /api/kyc/nira-verify
- **Service Function:** `verifyNira({ nin, cardNumber, dob, fullName, sessionId })`
- **Response:** `{ result: 'match' | 'partial' | 'no-match', mismatchedFields?: string[], reason?: string, trackingId }`
- **Notes:** On `'partial'`, the client shows the mismatched fields and gives the user a "Fix and re-verify" or "Continue (flagged)" choice rather than auto-advancing.

### POST /api/kyc/otp-send / POST /api/kyc/otp-verify
- **Service Functions:** `sendOtp({ phone, sessionId })`, `verifyOtp({ phone, code, sessionId })`
- **Response:** `{ success, expiresIn }` / `{ verified }`
- **Notes:** Distinct from the SignInModal OTP flow. This is the signup OTP that confirms the phone is reachable before binding it to the new account.

### POST /api/kyc/face-match
- **Service Function:** `faceMatch({ selfieFile, nin, sessionId })`
- **Request Body (multipart/form-data):** `selfie` (File), `nin`, `sessionId`
- **Response:** `{ match, liveness, matchScore, outcome: 'ok' | 'liveness-fail' | 'no-match', trackingId }`
- **Notes:** The client defensively rejects null `selfieFile` before calling — a missing blob (after localStorage rehydration drops it) shouldn't reach the backend.

### POST /api/kyc/aml-screen
- **Service Function:** `screenAml({ fullName, dob, nin, sessionId, niraTrackingId })`
- **Response:** `{ outcome: 'clear' | 'flagged', trackingId }`
- **Notes:** AML sanction-list + PEP screening. Flagged users are routed to back-office review; the user does not see the reason.

### POST /api/kyc/agent-referral
- **Service Function:** `referToAgent({ phone, reason, stage?, trackingId?, sessionId })`
- **Response:** `{ ticketId, eta }`
- **Notes:** Called by `AgentFallbackStep` when KYC cannot complete automatically (NIRA / liveness failure).

---

## 10. Contact form

### POST /api/contact
- **Service Function:** `submitContactForm({ name, email, message })` (in `services/contact.js`)
- **Currently:** Demo mode — logs to dev console, returns `{ ok: true, demo: true }` after a 600ms simulated delay; the success screen surfaces the demo state and points users to `support@upensions.ug`.
- **Backend target:** `POST /api/contact` writes to a support inbox or forwards to a transactional email service (Formspree / SendGrid). Honour `name`, `email`, `message` validation already done client-side.

---

## 11. Export / Download

CSV export is **fully wired client-side** via `src/utils/csv.js#downloadCSV(filename, headers, rows)` (RFC 4180 escaping + formula-injection defence + UTF-8 BOM for Excel). Both the distributor `TopBar` and every subscriber report view export the current filtered rows.

Server-side CSV is **not strictly required for current report sizes**, but should be added for:
- `/api/entities/subscriber` exports (~30K rows) — stream from server.
- Multi-year activity exports — once subscriber transaction history grows.

### GET /api/export/:reportType (future)
- **Intended behavior:** Server-side CSV generation for very large or multi-year reports.
- **Query Params:** Same filters as the report view (search, region, status, etc.)

---

## Server-Side Requirements Summary

### Must-Have Server-Side Pagination
- `GET /api/entities/subscriber` — 30,000+ records
- `GET /api/commissions/agents` — when agent count grows

### Should-Have Server-Side Sorting
- All report endpoints that return >100 items
- Subscriber list endpoints

### Should-Have Server-Side Filtering
- Reports with filter dropdowns (region, status, KYC, gender)
- Commission lists (by status, by branch)

### Cache Strategy
React Query default settings are used. Recommended server-side:
- Entity data: Cache with 5-minute stale time
- Commission summaries: Cache with 1-minute stale time (more volatile)
- Search: Cache with 30-second stale time
- Commission rate: Cache until invalidated

### Authentication
- All endpoints except `/api/auth/*` require `Authorization: Bearer <token>` header
- 401 response triggers client-side logout (clears localStorage, redirects to `/`)
- Backend base URL configured via `API_BASE_URL` environment variable (see `src/config/env.js`)
- Fetch wrapper in `src/services/api.js` handles token injection and 401 handling
