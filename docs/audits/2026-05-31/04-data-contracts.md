> **Agent guide.** Historical audit from 2026-05-31, covering end-to-end data contracts and state integrity along the service → `/api` → Supabase RPC chain — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 04 — End-to-End Data Contracts & State Integrity (Agent D, Phase 1)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (working tree, not committed `main`)
**Workstream:** Agent D — service → `src/services/api.js` → `/api` → Supabase RPC/table chain; TanStack Query keys/`staleTime`/invalidation; snake_case↔camelCase mapping; mock-fallback parity; the commission→settlement→notification flow.
**Mode:** READ-ONLY. No source edits, no DB writes. Pure code trace + read-only cross-reference of the baseline Supabase signal in `00-baseline.md`.

This file is scoped to **data-contract / state-integrity** concerns. DB-internal concerns (FK/rounding/idempotency at the SQL layer) are owned by Agent A/B; I reference them only where the contract surfaces them to the client and cross-reference the baseline seed tags. Tickets + chat in-memory permission boundaries are classified **client-only by design** per the shared preamble.

---

## Scope coverage map

| Chain segment | Files traced |
|---|---|
| Commission reads | `services/commissions.js` → `hooks/useCommission.js` → `get_commission_summary`/`get_entity_commission_summary`/`get_agent_commission_detail` (`0029`), direct SELECTs on `commissions`/`agents`/`branches`/`subscribers` |
| Settlement write | `CommissionPanel.jsx` → `utils/settlement.js` + `utils/xlsx.js` → `applySettlementUpload` → `apply_settlement` RPC (`0031`) → `settlement_batches` (`0030`) + `notifications` (`0031`) |
| Notifications | `services/notifications.js` → `hooks/useNotifications.js` → `NotificationBell`/`NotificationCenterCard`/`NotificationList`; `notifications` table + `mark_notifications_read` RPC (`0031`) |
| Mock fallback | `IS_SUPABASE_ENABLED` branch in `commissions.js` / `notifications.js`; `supabaseClient.js`; `data/mockData.js` `NOTIFICATIONS`/`SETTLEMENT_BATCHES` seeds |
| Tickets/chat | `services/tickets.js` + `hooks/useTickets.js` (in-memory by design) |
| Cache config | `src/main.jsx` QueryClient defaults |

**Shape-parity verdict (good news first):** The three slimmed read RPCs in `0029` (`get_commission_summary`, `get_entity_commission_summary`, `get_agent_commission_detail`) return camelCase JSON objects whose keys match the service mappers and the `_legacy_mock_*` shapes field-for-field (verified `0029:177-184`, `248-256`, `350-366` against `commissions.js:115-122`, `137-145`, `235-241` and the legacy mocks). The `_rowToCommission` and `_rowToNotification` snake→camel mappers (`commissions.js:47-63`, `notifications.js:48-62`) align with the DB column names in `0030`/`0031` and with the mock seed shapes in `mockData.js` (`recipientRole`/`recipientId`/`refId`/`isRead`/`createdAt`). No leftover dispute/run/maker-checker fields survive in the simplified service/hook layer. Most of the contract is internally consistent; the findings below are the residual gaps.

---

## Critical

_None._ No data-contract defect breaks a core demo flow outright or corrupts demo data in a way reachable in the single-session demo. (The cross-session staleness items below degrade the multi-laptop demo but do not corrupt data.)

---

## High

### D-H1 — Cross-session notification delivery is invisible until a 30s poll on the badge only; the feed list never auto-refreshes
**Classification:** quality/tech-debt (multi-session demo correctness)
**Severity:** High
**Evidence:**
- `hooks/useNotifications.js:17-23` — `useNotifications` (the feed list, consumed by `NotificationList` + `NotificationCenterCard`) has **no `refetchInterval`**.
- `hooks/useNotifications.js:25-32` — only `useUnreadNotificationCount` (the bell badge) polls (`refetchInterval: UNREAD_REFETCH_MS = 30_000`).
- `src/main.jsx:28-31` — global `staleTime: 5 * 60 * 1000`, `refetchOnWindowFocus: false`.
- `NotificationList.jsx:18` / `NotificationCenterCard.jsx:33` — both render `useNotifications(...)` with no override.
- `hooks/useCommission.js:99-110` — `useApplySettlement.onSuccess` invalidates `['notifications']`/`['notificationsUnread']` **only in the distributor's own QueryClient** (the actor who uploaded). The agent and branch are different sessions/tabs.

**Impact:** The intended demo beat is "distributor uploads settlement → agent/branch see a notification land." In a real two-laptop demo (distributor on one, agent on another) the agent's bell **badge** will tick up to "1" within ≤30s (good), but when the agent **opens the popover**, `useNotifications` is still within its 5-minute `staleTime` and `refetchOnWindowFocus` is off, so the list can render **without the new row** — a badge says "1 unread" while the list shows "You're all caught up" or the old contents. The inline `NotificationCenterCard` on the agent home has the same gap (no polling at all). This is a visible badge-vs-list inconsistency in the headline feature of this release.
**Recommendation:** Give `useNotifications` a `refetchInterval` (reuse `UNREAD_REFETCH_MS`, or a slightly slower cadence) and/or set `refetchOnMount: 'always'` so opening the bell forces a refetch. Cheapest fix: add `refetchInterval: 30_000` to the list query so the badge and list stay in lockstep. (Per-laptop `invalidateAll` cannot reach other sessions — polling is the only cross-session channel given realtime is off, see `api-contracts.md §5`.)

### D-H2 — Agent's "Earned" / "Total commissions" totals report nominal commission `amount`, not the distributor-recorded `paidAmount` — partial settlements are silently misreported to the agent
**Classification:** real-bug
**Severity:** High
**Evidence:**
- Partial payment is explicitly allowed: `CommissionPanel.jsx:342-370` computes mismatches (entered Amount Paid ≠ pending total) and **displays but does not block** them; `handleConfirmSettlement` (`:244-256`) proceeds regardless.
- `apply_settlement` stamps **all** the agent's `due` lines `paid` and writes the single client-entered `v_amount_paid` into **every** line's `paid_amount` (`0031:157-163`) — the per-line `amount` (the nominal rate) is untouched.
- The agent detail RPC's totals are `SUM(amount)`, not `SUM(paid_amount)`: `0029:305` `COALESCE(SUM(amount) FILTER (WHERE status='paid'), 0)` → `totalPaid`.
- Agent UI renders `amount`, never `paidAmount`: `CommissionsPage.jsx:172-173` (`totalPaid = detail.totalPaid`), the paid-row render `formatUGX(line.amount)` (`CommissionsPage.jsx:76-77` via `CommissionRow`), and `groupByPaidMonth` sums `line.amount` (`commissionMonths.js:33`). `paidTransactions[].paidAmount` IS carried in the contract (`0029:319`, `commissions.js:529`) but **no consumer reads it**.

**Impact:** If a distributor pays an agent less (or more) than the pending total — the panel actively supports this — the agent's dashboard "Earned" headline, the per-month history totals, and the settled% all show the **nominal rate sum**, not what was actually paid. For a flat-rate demo where Amount Paid == pending these coincide, so it is invisible in the happy path; but the moment a rep demos a partial payment (a plausible "what if we only paid half" beat) the agent view and the distributor's `settlement_batches.paid_amount` diverge with no on-screen reconciliation. The data carries the right number (`paidAmount`); the UI just ignores it.
**Recommendation:** Decide the product intent. If partial payments are a real demo beat, surface `paidAmount` on paid rows and total `SUM(paidAmount)` for the "Earned" figure (keep `amount` as "face value"). If partial payment is NOT intended, block confirm when `mismatches.length > 0` (Agent E owns the "mismatch shown but not blocked" UX call — coordinate). Minimal contract-side fix: change the agent "Earned" total to sum `paidAmount` for paid lines.

---

## Medium

### D-M1 — Agent home mounts the notification feed twice under different query subscriptions; `markNotificationsRead` invalidation order makes the inline card briefly disagree with the bell
**Classification:** quality/tech-debt
**Severity:** Medium
**Evidence:**
- Agent shell mounts a `NotificationBell` (`AgentHeaderChrome.jsx:47` and/or `SideNav.jsx:103`) **and** the home mounts a `NotificationCenterCard` (`HomePage.jsx:42`) simultaneously.
- The bell reads `useUnreadNotificationCount` (`['notificationsUnread', role, entityId]`, polled). The card reads `useNotifications` (`['notifications', role, entityId, false]`, not polled) and derives its own unread count from the list (`NotificationCenterCard.jsx:39` `list.filter(n => !n.isRead)`).
- "Mark all read" exists on **both** the card (`NotificationCenterCard.jsx:43-46`) and the popover list (`NotificationList.jsx:24-27`); `useMarkNotificationsRead.onSuccess` invalidates both keys (`useNotifications.js:41-44`).

**Impact:** Two surfaces compute "unread" from two different cache entries that refresh on different schedules (one polls, one doesn't). Right after a settlement, the badge (polled) can show "1" while the inline card's derived count still shows "0" (stale list within `staleTime`), or vice-versa after "Mark all read" on one surface before the other's invalidation settles. Same root cause as D-H1; flagged separately because it is a within-single-session inconsistency (one agent, one tab) and is the more demo-likely path.
**Recommendation:** Drive both the badge and the inline-card count from a single source — either have `NotificationCenterCard` show the badge via `useUnreadNotificationCount` (not by counting the list), or have the bell badge derive from the same list query the card uses. Combined with the D-H1 `refetchInterval` fix, both surfaces would then converge on the same poll.

### D-M2 — `listSettlements` does an N+1-style JS join over agents/branches and re-displays denormalized `agentName`/`branchName` that can go stale vs. the names in the batch's own creation context
**Classification:** quality/tech-debt
**Severity:** Medium
**Evidence:**
- `commissions.js:394-436` — `listSettlements` first selects `settlement_batches`, then issues two **follow-up** `.in('id', agentIds)` / `.in('id', branchIds)` queries on `agents`/`branches` to resolve display names (3 round-trips per panel render; the same agent/branch fetch pattern is repeated independently by `getAgentCommissionList` `:162-169`, `getPendingDuesByAgent` `:289-297`, `getPendingDuesByBranch` `:336-339`).
- `settlement_batches` stores NO denormalized name (`0030:18-28`) — unlike `commissions.subscriber_name` — so names are always join-resolved at read time; a `null` join falls back to `'Unknown'` (`commissions.js:426-428`).

**Impact:** Functionally correct and bounded (the panel caps at `limit: 20`, `CommissionPanel.jsx:118`), so this is not a hot-path scale risk in the demo. But the panel fires up to 3+3+2 separate Supabase round-trips for one open (settlements + dues-by-agent + dues-by-branch + agent-list each re-resolve the same agents/branches). It is the contract-layer counterpart of the N+1 the baseline flagged (`SEED-A8`/perf advisors). The `'Unknown'` fallback also means a renamed/deleted agent silently shows "Unknown" in settlement history with no signal.
**Recommendation:** Acceptable for the demo as-is; if touched, fold the agent→branch name resolution into a single shared cached query (or a small read RPC `get_settlements(p_branch_id, p_limit)` that joins server-side, mirroring how the other read RPCs already join). Low effort, removes the repeated client joins, and makes the name source authoritative.

### D-M3 — `getEntityCommissionSummary` mock-fallback scopes district/region differently than the live RPC (mock-fidelity drift, same shape)
**Classification:** quality/tech-debt
**Severity:** Medium
**Evidence:**
- Live RPC scopes `district` via `branches.district_id = p_entity_id` and `region` via `branches JOIN districts ON district_id ... WHERE region_id` (`0029:223-231`).
- Mock fallback scopes `district` via `BRANCHES[...].parentId === entityId` and `region` via `DISTRICTS[...].parentId` (`commissions.js:735-749`). These rely on the mock `parentId` convention rather than the DB `district_id`/`region_id` columns.

**Impact:** The **shape** is identical (both return the `_legacyAggregateRecords`/`jsonb_build_object` 7-field object), so there is no client-side contract break — `useEntityCommissionSummary` consumers work in both modes. The risk is purely fidelity: under `VITE_USE_SUPABASE=false` the district/region rollups depend on the mock org-chain being consistent with the live FK chain. The baseline already notes `mockData.DISTRIBUTORS` knows only `d-001` while seed has `d-001`+`d-002` (`BACKEND.md §15b`, audit D15) — same class of mock-vs-live drift. Low blast radius because the rollback flag is a break-glass, not a demo default.
**Recommendation:** Note in `FRONTEND.md` that the mock entity rollups are `parentId`-based and may diverge from live FK scoping; no fix needed unless the rollback path becomes a demo path.

### D-M4 — `apply_settlement` has no idempotency key; a double-confirm double-pays and double-notifies (contract-layer view of SEED-B2/D1)
**Classification:** real-bug
**Severity:** Medium (demo-calibrated; production-money concern is awareness)
**Evidence:**
- `apply_settlement` (`0031:93-217`) selects `status='due'` and stamps `paid` with no nonce/"already-settled" guard (confirmed `SEED-B2/D1` in `00-baseline.md`).
- Client side, the confirm button IS disabled while pending (`CommissionPanel.jsx:920` `disabled={... || applySettlement.isPending}`) and the modal blocks backdrop dismiss while pending (`:852`), so the **single-session** double-click is mitigated at the UI.
- BUT `handleConfirmSettlement` does not clear/guard `pendingUpload` against a re-open of the same parsed file, and there is no server-side idempotency: re-uploading the **same** file a second time after the first completes will find the (new) `due` lines for any agents who have since accrued more dues and settle them again under the same `txnRef`, creating a second `settlement_batches` row + second notification.

**Impact:** In the demo, the UI guard makes the literal double-click hard to hit, so this is Medium not High here. The contract gap is that the **only** idempotency protection lives in transient client UI state — there is no `txnRef`-uniqueness or batch-dedupe at the RPC. A rep who re-uploads the same template "to show it again" produces duplicate settlement-history rows and duplicate notifications, which reads as a bug on screen.
**Recommendation:** Owned jointly with Agent B. Contract-side: have the panel disable the upload action (or warn) once a settlement with the same `txnRef` is already in `settlements` for the session; ideally add a server-side guard (`txn_ref` partial-unique or an "already settled this ref" skip-reason) so the response carries a clear `skipped` entry instead of silently duplicating.

### D-M5 — `notifications.ref_id` and `body` carry an unformatted raw amount string; the agent/branch notification text shows `UGX 5000` (no thousands separator) and a non-clickable batch id, diverging from the app-wide `formatUGX` convention
**Classification:** quality/tech-debt
**Severity:** Medium
**Evidence:**
- Server builds the body by raw concatenation: `'UGX ' || v_amount_paid || ' paid for ' || v_line_count || ' commissions.'` (`0031:184`, `:199`). For 5000 this renders literally `UGX 5000`.
- The mock path mirrors this exactly: ``body = `UGX ${amount} paid for ${lineCount} commissions.` `` (`notifications.js:184`).
- Everywhere else the app formats currency via `formatUGX` (e.g. `CommissionPanel.jsx:251`, `CommissionsPage.jsx`). `NotificationList`/`NotificationCenterCard` render `n.body` verbatim (`NotificationList.jsx:74`).
- `ref_id` (`0031:32`) is a `sb-…` batch id surfaced into the contract as `refId` but is never linked/rendered (no consumer reads `n.refId` in the list components) — it is dead in the UI.

**Impact:** The flagship notification of this release reads `UGX 5000 paid for 1 commissions.` — unformatted number, and the `1 commissions` pluralization bug. Cosmetic but it is the single most-seen string in the feature and is inconsistent with the polished `formatUGX` usage two panels away. `refId` being carried but unused is harmless contract cruft.
**Recommendation:** Format the amount with thousands separators and fix pluralization when building the body. Since the body is built in two places (RPC + mock) the cleanest contract fix is to build the display string **client-side** from the structured `amount`/`type` fields (which are already in the row) rather than persisting a pre-rendered English sentence — then `formatUGX` and pluralization live in one place and the stored `body` becomes optional. At minimum fix the `commissions`/`commission` pluralization.

---

## Low

### D-L1 — `createCommissionSettledNotifications` in Supabase mode is a no-op that returns `[]`, but the mock-mode batch-id contract (`sb-…`) differs from the RPC's (`sb-` + hex uuid) — refId shape is mode-dependent
**Classification:** quality/tech-debt
**Severity:** Low
**Evidence:**
- Mock batch id: `sb-${year}-${base36}-${agentId}` (`commissions.js:653`), passed as `refId` into `createCommissionSettledNotifications`.
- RPC batch id: `'sb-' || replace(gen_random_uuid()::text,'-','')` (`0031:166`), used as both `settlement_batches.id` and the notification `ref_id`.

**Impact:** Both are `sb-`-prefixed opaque strings and nothing parses them, so there is no functional break. The notifications test even asserts only `/^sb-/` (`notifications.test.js:213`). Pure inconsistency; flagged for completeness since the workstream brief asks for mock↔live parity.
**Recommendation:** None required. If `refId` ever becomes clickable (deep-link to a batch), reconcile the two id schemes first.

### D-L2 — `getCommissionSubscribers` returns hardcoded placeholder `lastContribution: 0` / `lastContributionDate: ''` in the live path while the mock path fabricates a value — a contract field that is meaningfully populated in one mode and inert in the other
**Classification:** quality/tech-debt
**Severity:** Low
**Evidence:**
- Live: `lastContribution: 0` and `lastContributionDate: ''` with the inline comment "not surfaced by current schema; left at 0 for backwards-compat" (`commissions.js:267-268`).
- Mock: computes a fabricated `lastContribution` from `contributionHistory` and a synthesized `lastContributionDate` (`commissions.js:568-571`).
- Consumer: the CommissionPanel subscribers view renders `Last: {formatDate(sub.lastContributionDate)}` (`CommissionPanel.jsx:827`), which under live mode formats `''`.

**Impact:** In live mode the "Last: …" line in the per-agent subscribers drill-down renders an empty/`Invalid Date`-style value (depending on `formatDate`'s empty handling), whereas mock mode shows a plausible date. Minor visual drift in a deep drill-down; not on the main settlement path.
**Recommendation:** Either populate `lastContributionDate` from a real read in the live path or have the UI hide the "Last:" line when the value is empty. Confirm `formatDate('')` degrades gracefully (Agent C owns `utils/date.js`).

### D-L3 — `useNotifications` `unreadOnly` is part of the query key but is always `false` in practice; the cache carries an unused dimension
**Classification:** quality/tech-debt
**Severity:** Low
**Evidence:** `hooks/useNotifications.js:19` keys `['notifications', role, entityId, unreadOnly]`; every consumer (`NotificationList.jsx:18`, `NotificationCenterCard.jsx:33`) calls it with the default `unreadOnly: false`. The `unreadOnly: true` path exists in the service (`notifications.js:78`) and is unit-tested but never invoked by a component.
**Impact:** None functional; a vestigial cache dimension. Noted only because invalidation (`useNotifications.js:42` invalidates the `['notifications']` prefix) correctly covers it via partial-key match, so it does not cause a stale-cache miss.
**Recommendation:** Leave as-is (harmless, keeps the service flexible) or drop the unused param.

---

## Tickets + chat — classified client-only by design (not findings)

Per the shared preamble, the in-memory ticket store and its permission boundaries are **intentional demo scope**, not bugs:
- `services/tickets.js` is a module-level `Map` seeded from `ticketsSeed.js`; there is no Supabase table (`tickets.js:1-33`, header comment).
- `resolveRouting` (`tickets.js:107-114`) derives a new ticket's `agentId`/`branchId` from the mock org chain (`SUBSCRIBERS[id].parentId` → `AGENTS[id].parentId`) — entirely client-side. If a subscriber's `parentId` is missing it routes to a `null` agent (Agent E owns the "org-chain breakage → null agent" UX flag).
- Branch/distributor reads (`listTicketsForBranch`/`listTicketsForDistributor`, `tickets.js:174-200`) are **view-only oversight** filters over the same store — the intended permission model.
- `hooks/useTickets.js` invalidation is sound: every mutation calls `invalidateAllTickets` (the three prefixes `['tickets']`/`['ticketThread']`/`['ticketMetrics']`, `useTickets.js:184-188`) so a send/close/reopen/read propagates across all role views within a session, and optimistic patches mirror the service's `preview()`/unread logic. No contract drift here.

These are noted to show they were considered, not re-reported as defects.

---

## Cross-references checked (not re-reported)

- `SEED-A2` (no FK on `notifications.ref_id`), `SEED-A4/B1` (no rounding on `paid_amount`), `SEED-B2/D1` (no idempotency nonce) — DB-layer ownership is Agent A/B. I reference the **contract surface** of B2/D1 in D-M4 and the `paid_amount` divergence in D-H2 but do not duplicate the SQL-internal findings.
- `BACKEND.md §15b` / `FRONTEND.md §16b` — confirmed the items below are **already-known** and excluded: dispute/maker-checker removal (moot per §15b, X3), `X12` cross-context cache-key drift on `useSubscriberTransactions`, `F13` breadcrumb key (resolved), `X13` contact-response shape. D-H1/D-H2/D-M1 are **new** (the notification feed + settlement flow are post-0029 and not covered by §16b).
- `api-contracts.md §5` confirms realtime is off for `settlement_batches`/`notifications` by design — so polling/invalidation (D-H1) is the only cross-session channel, which is why I classify the staleness as quality/tech-debt, not a missing-realtime bug.

---

## Cutover go/no-go (data-contracts view)

- **No data-contract finding is a hard cutover blocker.** The shape parity across service↔RPC↔mock is sound; the simplified model has no leftover dispute/run code in this layer.
- **Recommend fixing before/with cutover (low effort, high demo visibility):** D-H1 (notification list polling) and D-M5 (unformatted `UGX 5000` / `1 commissions` body) — both are in the headline feature and visible in a normal demo.
- **Decide product intent before cutover:** D-H2 (partial-payment `amount` vs `paidAmount`) — coordinate with Agent E on whether partial payment is a supported beat; the answer determines whether to block the mismatch or surface `paidAmount`.
