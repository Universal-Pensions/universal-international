> **Agent guide.** Historical audit from 2026-05-31, covering user flows, UX, accessibility and responsive behaviour across the built roles, landing and signup/KYC — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 05 — User Flows, UX, Accessibility & Responsive (Agent E)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31 · **Branch:** `feat/simplify-commissions` (working tree)
**Agent:** E — User Flows, UX, Accessibility & Responsive (Phase 1). READ-ONLY.
**Method:** Rigorous **code-level flow trace** (Chrome extension + dev server not available this run — the plan's stated fallback). E2E specs under `e2e/` read for coverage signal only; no DB-mutating commands run.

This report walks every primary flow for the 4 built roles + landing + the signup/KYC wizard, and owns the new-feature UX items the plan assigned to this workstream (settlement partial-payment mismatch, opaque skip-reason guidance, distributor notification-bell absence, ticket org-chain breakage / null-agent routing, and the subscriber→agent→branch→distributor ticket loop).

Severity is calibrated to a **demo tool** (per the shared preamble). Intentional demo-scope is never reported as a bug.

---

## Cross-reference of already-known items (NOT re-reported as new)

Verified against `docs/DASHBOARD_AUDIT*.md`, `docs/audit/04-user-flows.md`, `FRONTEND.md §16b`, `BACKEND.md §15b`, and `.claude/skills/qa.md`:

- **Subscriber Settings → Notifications / Security are `StubPage` placeholders** — known (FRONTEND.md §16b, audit AUDIT-4-5). Friendly stub, not a dead end. Not re-reported.
- **Branch admin cannot edit own branch info** — known (AUDIT-4-4, DASHBOARD_AUDIT #35). Not re-reported.
- **Agent-onboard AML step hang** — known/uncertain (AUDIT-4-7, qa.md #4). Not re-reported (needs runtime trace, unavailable this run).
- **Nominees sum >100% silently** — known (AUDIT-4-6 / BACKEND.md §15b). Not re-reported (owned by Workstream A/B/D).
- **ViewSubscribers "Showing X of Y" pagination stall** — known (AUDIT-1-7). Not re-reported.
- **`.claude/skills/qa.md` "Known product bugs" stale** — known (AUDIT-4-1). Not re-reported.
- **Signup files dropped on refresh; user re-uploads** — documented intentional (CLAUDE.md §5). The *step-position* reset is a distinct, separately-classified observation (see UX-L1).

---

## Findings by severity

### CRITICAL

#### UX-C1 — Settlement partial-payment mismatch is shown but NOT blocked; backend marks ALL due lines fully paid while recording only the partial amount
- **Classification:** real-bug
- **Severity:** Critical (corrupts demo commission data + the settlement narrative the distributor is presenting)
- **Evidence:**
  - UI shows mismatches but the Confirm button is gated only on `agentCount === 0 || applySettlement.isPending`, NOT on `confirmSummary.mismatches.length` — `src/dashboard/commissions/CommissionPanel.jsx:917-923`.
  - Mismatch detection: `src/dashboard/commissions/CommissionPanel.jsx:353-360`.
  - Backend RPC flips **every** `status='due'` line for the agent to `paid` regardless of the entered amount, but stamps `paid_amount = v_amount_paid` (the entered, possibly-partial figure) onto each line and the batch: `supabase/migrations/0031_notifications.sql` `apply_settlement` UPDATE at lines ~160-166 (`SET status='paid', … paid_amount = v_amount_paid WHERE agent_id = … AND status='due'`).
- **Impact:** A distributor demoing a *partial* payment (e.g. enters UGX 30,000 against UGX 50,000 pending) gets a yellow "amount mismatch" panel but can still click Confirm. The RPC then marks **all** of that agent's due commissions as fully `paid` and zeroes their outstanding balance, while the recorded `paid_amount` (30,000) is less than the true pending (50,000). Result: the agent's "Outstanding" drops to 0 even though they were underpaid; the settlement-history row and the `commission_settled` notification both quote the partial figure. The demo's own "Settled vs Outstanding" summary strip becomes internally inconsistent (sum of `paid_amount` ≠ sum of pending that was cleared). This is reachable in a normal demo and corrupts the commission picture the rep is walking a prospect through.
- **Recommendation:** Either (a) block confirmation when `mismatches.length > 0` (disable Confirm or require a second explicit "settle anyway" acknowledgement), or (b) make the RPC clear only as many lines as the entered amount covers (partial settlement semantics) and leave the remainder `due`. Given the doc says settlement is "pay the full pending then re-upload," option (a) — block/guard mismatches — best matches the intended demo story. At minimum, the confirm modal hint ("Marks the matched due commissions as paid") should state that *all* due lines are cleared regardless of the entered amount.

---

### HIGH

#### UX-H1 — Subscriber → Agent / Tickets page hangs on a perpetual spinner when the subscriber has no resolvable agent
- **Classification:** real-bug
- **Severity:** High (dead-ends a primary subscriber flow; blocks the entire ticket-creation entry point)
- **Evidence:**
  - `src/subscriber-dashboard/pages/AgentPage.jsx:243-246` — the whole body is gated `{!agent ? (<spinner>) : (…)}` with **no** empty/error fallback.
  - `getSubscriberAgent` returns `null` when the subscriber row has no `agent_id` (`src/services/subscriber.js:473-474`) or, in mock mode, when the subscriber id isn't a mockData key (`src/services/subscriber.js:463-465`).
- **Impact:** If the logged-in subscriber has no `agent_id` (a signup-created subscriber before agent assignment, an agentless seed row, or any persona whose id doesn't resolve), the "Your agent" page — which is also the **only** entry point to open a support ticket (`useCreateTicket(subId)` lives here, `AgentPage.jsx:192`) — spins forever. The subscriber can never reach the new-ticket sheet, and there's no "no agent assigned" message. Distinguish from a slow fetch: a genuine `null` (resolved, no agent) is indistinguishable from `isLoading` because the page keys off the data value, not the query state.
- **Recommendation:** Branch on the query's `isLoading` vs `isError` vs resolved-`null`. When the agent resolves to `null`, render an explicit empty state ("No agent assigned yet — contact support") instead of the indefinite spinner, and still surface a ticket entry point (route the ticket to the branch/distributor oversight when no agent exists).

#### UX-H2 — New support tickets route to a `null` agent (dead-letter) when the subscriber isn't in the frozen mockData org chain
- **Classification:** real-bug
- **Severity:** High (subscriber gets a "sent to your agent" success toast for a ticket no agent will ever receive — breaks the headline subscriber↔agent support loop)
- **Evidence:**
  - `resolveRouting` looks the subscriber up in the **frozen mockData `SUBSCRIBERS` proxy** even in live mode (tickets have no Supabase table): `src/services/tickets.js:107-114` — `const agentId = SUBSCRIBERS[subscriberId]?.parentId ?? null;`.
  - On a first-ever ticket with an unrecognised subscriber id, `agentId`/`branchId` fall to `null`; the ticket is created with `agentId: null` (`src/services/tickets.js:362, 374-390`).
  - The agent inbox filters `t.agentId === agentId` (`src/services/tickets.js:162-163`) — a `null`-agent ticket never matches any real agent's inbox.
  - Success toast fires unconditionally: `src/subscriber-dashboard/pages/AgentPage.jsx:218-221` ("Your issue has been sent to your agent.").
- **Impact:** The live DB seeds 30,001 subscribers; the mockData `SUBSCRIBERS` proxy generates a *separate deterministic* set (`s-0001…`, `src/data/mockData.js:242,497-510`). Where the live subscriber id is NOT a generated mockData key (or the live `agent_id` differs from mockData's `parentId`), `resolveRouting` either returns `null` or routes to a **stale/wrong** agent. A null-agent ticket surfaces only in the distributor's unfiltered oversight view (with a blank agent), never in any agent's inbox — yet the subscriber is told it reached their agent. This silently breaks the core subscriber→agent support handoff in exactly the live demo configuration (`VITE_USE_SUPABASE=true`). The demo-stable fallback persona `s-0001` happens to resolve correctly (it exists in both seeds with `parentId: a-001`), so the bug hides behind the most common demo login but bites any other seeded subscriber.
- **Recommendation:** Tickets are in-memory by design (do NOT add a DB table — that's demo scope), but the **routing source** should be the live subscriber's actual `agent_id`/`branch_id` (already available from `getSubscriberAgent` / `useCurrentSubscriber`) rather than the frozen mockData chain. Pass the resolved `agentId`/`branchId` into `createTicket` from the caller, and only fall back to mockData when running mock-backed. When routing genuinely can't resolve an agent, do not show the "sent to your agent" toast — show "we couldn't reach an agent" and route to branch/distributor oversight.

#### UX-H3 — Distributor has no notification surface and no in-app confirmation that their own settlement landed
- **Classification:** quality/tech-debt (the plan asks to "confirm intentional" — it appears intentional per the glossary, but it produces a one-sided UX)
- **Severity:** High (the distributor is the actor who *applies* settlements, yet the feedback loop they trigger is invisible to them beyond a transient toast)
- **Evidence:**
  - No `NotificationBell` / `NotificationCenterCard` anywhere in the distributor shell — grep across `src/dashboard/**` returns zero notification mounts; the only mounts are agent (`AgentHeaderChrome.jsx:47`, `SideNav.jsx:103`, `HomePage.jsx:42`) and branch (`BranchHealthScore.jsx:283`, `BranchOverview.jsx:92`).
  - CLAUDE.md glossary confirms "Surfaced via a `NotificationBell` for agent + branch (**distributor not mounted**)."
  - The distributor's only feedback after applying a settlement is the success toast in `handleConfirmSettlement` (`src/dashboard/commissions/CommissionPanel.jsx:251`), which disappears; the Settlement-history list in the panel does update on invalidation (`useApplySettlement` → `invalidateAll`, `src/hooks/useCommission.js:99-109`).
- **Impact:** The settlement is a distributor-initiated action that fans out `commission_settled` notifications to the agent + branch. The distributor — the person presenting the flow — has no persistent record surface (no bell, no feed) confirming what they just dispatched; if the toast is missed, they must re-open the Commissions panel and scan Settlement history. Asymmetric with agent/branch who get a bell. It also means the "notification" feature is invisible from the role most likely to be driven in a sales demo.
- **Recommendation:** Confirm with product whether this is intentional. If the bell is deliberately agent/branch-only, that's defensible (notifications target those roles), but the distributor should at least get a durable in-panel "Last settlement applied" confirmation (the Settlement-history list partly serves this). If a distributor-facing record of dispatched settlements is desired, mount a read-only `NotificationCenterCard` or a settlement-receipts strip in the distributor commission panel. Document the decision in the glossary either way.

#### UX-H4 — Always-visible NotificationCenterCard never refreshes; it can show a stale feed while the bell badge increments
- **Classification:** real-bug
- **Severity:** High (the agent/branch home shows a notification widget that silently goes stale within a session — the opposite of its "always visible" purpose)
- **Evidence:**
  - `useNotifications` has **no** `refetchInterval` (`src/hooks/useNotifications.js:17-23`); only `useUnreadNotificationCount` polls every 30s (`useNotifications.js:25-32`).
  - `NotificationCenterCard` consumes `useNotifications` (`src/components/notifications/NotificationCenterCard.jsx:33`) and derives its own unread badge from that list (`NotificationCenterCard.jsx:39`).
  - The card is mounted persistently on agent home (`HomePage.jsx:42`) and branch overview (`BranchOverview.jsx:92`).
- **Impact:** When a distributor applies a settlement (in their own tab), the agent/branch are in different sessions — the distributor's cache invalidation cannot reach them. Their **bell badge** will update on the next 30s poll, but the **inline NotificationCenterCard** (list + its own count) will NOT refresh until the agent/branch manually reloads or navigates, because the list query has no polling and `refetchOnWindowFocus` won't fire if the tab stays focused. Result: the bell shows "1 unread" while the inline card directly below it still says "You're all caught up." Visible inconsistency on the primary home surface.
- **Recommendation:** Give `useNotifications` a `refetchInterval` (match the 30s badge cadence, or pass an opt-in interval the `NotificationCenterCard` enables) so the inline feed and the badge stay in lock-step. Cheaply: have `NotificationCenterCard` derive its count from `useUnreadNotificationCount` (which already polls) rather than from the unpolled list, and add polling to the list it renders.

---

### MEDIUM

#### UX-M1 — Settlement skip/mismatch guidance is opaque and offers no remediation path
- **Classification:** quality/tech-debt
- **Severity:** Medium (degraded UX on a money-adjacent flow; the distributor can't tell what to fix)
- **Evidence:**
  - Skip reasons are surfaced as terse labels only: `skippedReasonLabel` maps to "missing Agent ID" / "no Amount Paid" (`src/dashboard/commissions/CommissionPanel.jsx:372-376`), rendered as `<agentId>: <reason>` rows (`CommissionPanel.jsx:887-903`).
  - A third backend-only skip reason exists — `'no_due'` (agent has zero `due` lines) is emitted by the RPC (`supabase/migrations/0031_notifications.sql` ~line 144) but is NOT in the client `skippedReasonLabel` map, so it would render the raw `no_due` token if it ever reached the UI. (It currently can't, because skips are computed client-side pre-RPC, but the post-RPC `result.skipped` is summarised only as a count in the toast — `CommissionPanel.jsx:248-251` — so a server-side `no_due` skip is invisible to the distributor entirely.)
  - The parse-failure toast is generic: "Couldn't read the file — use the downloaded template." (`CommissionPanel.jsx:233`) with no detail on which header/row failed.
- **Impact:** When rows are skipped (renamed/reordered headers, blank Amount Paid, an agent whose dues were already cleared), the distributor sees only a count and a one-word reason with no row number, no "fix and re-upload" guidance, and — for server-side `no_due` skips — nothing at all. On a demo this reads as "the upload half-worked and I don't know why."
- **Recommendation:** Expand the skip panel to include the row's agent name (not just id) and a concrete fix ("Amount Paid was blank — enter a value and re-upload"). Add `'no_due'` to `skippedReasonLabel`. Surface the post-RPC `result.skipped` reasons (not just a count) so server-side skips are explained. Consider echoing the offending header set when `parseSheet` mapping fails.

#### UX-M2 — Settlement upload modal: with mismatches present, the only affirmative action is a primary-styled "Confirm settlement" — no friction proportional to the consequence
- **Classification:** quality/tech-debt
- **Severity:** Medium (ties to UX-C1; even if blocking is rejected, the affordance is wrong)
- **Evidence:** The mismatch block uses `data-action="reject"` styling (`src/dashboard/commissions/CommissionPanel.jsx:870`) signalling danger, yet the confirm button stays the standard primary `modalConfirmBtn` with identical weight whether or not mismatches exist (`CommissionPanel.jsx:917-923`).
- **Impact:** A destructive-leaning action (clear all due lines despite an amount mismatch) is presented with the same one-click affordance as a clean settlement. Users habituated to clicking the primary button will settle through warnings.
- **Recommendation:** When `mismatches.length > 0`, restyle the confirm button to a cautionary variant and relabel it ("Settle despite mismatches") so the affordance matches the risk. Pairs naturally with UX-C1's guard.

#### UX-M3 — Distributor settlement template upload is invisible to keyboard/AT users beyond the trigger button (no progress/feedback region)
- **Classification:** quality/tech-debt
- **Severity:** Medium (accessibility — async file parse has no live-region announcement)
- **Evidence:**
  - The file input is correctly hidden and triggered by a real button (`src/dashboard/commissions/CommissionPanel.jsx:527-544`), and the input is `aria-hidden` + `tabIndex={-1}` — acceptable.
  - But `handleUploadFile` is async (parses the workbook) and the only feedback is a toast on error or the confirm modal on success (`CommissionPanel.jsx:226-242`). There is no `aria-busy` / live-region status while parsing, and toasts are not reliably announced unless the ToastContext renders an `aria-live` region.
- **Impact:** A screen-reader user who picks a large `.xlsx` gets no spoken indication that parsing is underway; if the parse silently yields zero rows, the warning toast ("The file had no rows to settle.") may not be announced. Minor, but it's a money flow.
- **Recommendation:** Add an `aria-live="polite"` status near the upload buttons reflecting parse state ("Reading file…", "Couldn't read file", "12 rows ready to confirm"). Verify the ToastContext container is an `aria-live` region (out of this flow's scope — note for Workstream C).

#### UX-M4 — Notification popover is a `role="dialog"` but does not trap focus or move focus into itself
- **Classification:** quality/tech-debt
- **Severity:** Medium (accessibility — a labelled dialog that keyboard users can tab straight out of)
- **Evidence:**
  - The popover is `role="dialog" aria-label="Notifications"` (`src/components/notifications/NotificationBell.jsx:100-104`) but uses `useOutsideClick` + Escape only via the shared hook; there is **no** focus trap and **no** initial focus move into the popover (unlike the shared `Modal` primitive at `src/components/Modal.jsx:120-188` which does both).
  - Closing does not restore focus to the bell button (no `previousFocusRef` equivalent).
- **Impact:** Opening the bell with the keyboard leaves focus on the bell; Tab walks into the page behind the open dialog rather than through the notification list and "Mark all read"/"Close" controls. A `role="dialog"` that isn't modal and isn't focus-managed is an ARIA contract violation. Affects agent + branch (both mount the bell).
- **Recommendation:** Either downgrade the popover from `role="dialog"` to a non-modal disclosure (`aria-label` on the region, `aria-expanded` already on the trigger) — simplest and honest — OR reuse the `Modal` primitive's focus management (move focus to the first item on open, trap Tab, restore focus to the bell on close). The disclosure route is lighter and fits a popover better.

#### UX-M5 — Subscriber signup wizard step position is not persisted; a mid-flow refresh drops the user back to step 1
- **Classification:** quality/tech-debt
- **Severity:** Medium (degraded UX; the user must click forward through every completed step after a refresh)
- **Evidence:**
  - `stepId` is component-local `useState('id-upload')` (`src/signup/SignupPage.jsx:30`), not written to `SignupContext`/localStorage.
  - `SignupContext` persists data fields (debounced) but the `EPHEMERAL_KEYS` list and persist logic carry no step pointer (`src/signup/SignupContext.jsx:159,188-193`).
- **Impact:** CLAUDE.md §5 documents that *files* are dropped on refresh and the user re-uploads — but it does NOT say the user is thrown back to step 1. After a refresh on, say, the Consent step, the wizard restarts at "Scan your ID." Data fields rehydrate (so re-walking is faster), but ID/selfie files are gone and the user must traverse all 8 steps again. On a sales demo a stray refresh resets visible progress to zero.
- **Recommendation:** Persist `stepId` into `SignupContext` (it's already debounce-persisted) and rehydrate it on mount, clamping to the first step that still needs a re-upload (since file steps can't be skipped without their blobs). This keeps the documented "re-upload files" behaviour while preserving wizard position.

#### UX-M6 — Ticket close/reopen and create produce no terminal-state validation feedback when routing yields a null agent
- **Classification:** quality/tech-debt
- **Severity:** Medium (correctness/UX — the in-memory loop is sound, but the null-agent edge has no guard)
- **Evidence:**
  - `createTicket` accepts a `null` `agentId` without warning (`src/services/tickets.js:352-392`); there is no validation that routing resolved an agent.
  - The branch oversight read keys off `t.branchId` (`src/services/tickets.js:174-178`) — a ticket with `branchId: null` (org chain broke at the agent level) is invisible to every branch too, surfacing only in the distributor's unfiltered list.
- **Impact:** Reinforces UX-H2 at the service layer: a partially- or fully-unresolved org chain produces tickets that are orphaned from agent and branch oversight, with no diagnostic. The subscriber→agent→branch→distributor loop is otherwise correct (close/reopen guards are sound, cross-view invalidation via `invalidateAllTickets` is comprehensive — `src/hooks/useTickets.js:184-188`).
- **Recommendation:** In `createTicket`, when `resolveRouting` returns `agentId === null`, either reject with a clear error the UI can show, or route to a designated branch/distributor queue and reflect that in the toast. Pairs with UX-H2's fix (route from live `agent_id`).

---

### LOW

#### UX-L1 — Signup `done` step is unreachable dead code in the wizard switch
- **Classification:** quality/tech-debt
- **Severity:** Low (dead branch; no user impact today)
- **Evidence:** `STEPS` includes `{ id: 'done', label: 'All set' }` (`src/signup/SignupShell.jsx:17`) and the progress ring renders a completion check for it (`SignupShell.jsx:117-131`), but `renderStep()` has no `case 'done'` — it falls through to `default: return null` (`src/signup/SignupPage.jsx:157-159`). The flow instead navigates to `/signup/contribution` from `ConsentStep.onActivate` (`SignupPage.jsx:149`), so `stepId` is never set to `'done'`.
- **Impact:** None functionally — but the `done` step + its completion-ring UI is dead. A future contributor wiring `goNext()` past consent would land on a blank screen (`null`).
- **Recommendation:** Either remove `'done'` from `STEPS` (and the completion-ring path keyed off `isComplete`), or wire a real terminal step. Document that consent → contribution is the true terminal transition.

#### UX-L2 — Notification badge count is `aria-hidden`, so the unread count is read only via the button's aria-label — but the inline card badge is announced differently
- **Classification:** quality/tech-debt
- **Severity:** Low (minor AT inconsistency)
- **Evidence:**
  - Bell badge span is `aria-hidden="true"` and the count is exposed via the button `aria-label` ("Notifications, N unread") — correct (`src/components/notifications/NotificationBell.jsx:121-130`).
  - But `NotificationCenterCard` exposes its badge via `aria-label={`${unread} unread`}` on the badge span itself (`src/components/notifications/NotificationCenterCard.jsx:55`), a different pattern, and the card's section label is just "Notification centre" without the count.
- **Impact:** Two notification surfaces announce unread counts via different mechanisms; minor cognitive inconsistency for AT users who encounter both on agent home.
- **Recommendation:** Standardise: expose the count in the surrounding region/heading label consistently, and keep the visual badge `aria-hidden`.

#### UX-L3 — Settlement confirm modal hint understates what Confirm does
- **Classification:** quality/tech-debt
- **Severity:** Low (copy)
- **Evidence:** Modal subtitle "Marks the matched due commissions as paid." (`src/dashboard/commissions/CommissionPanel.jsx:857-859`) — but the RPC marks **all** of the agent's due lines paid, not only "matched" ones, and the hint "Agents (and their branches) are notified once the settlement is applied" (`CommissionPanel.jsx:905-907`) doesn't mention the amount-vs-pending semantics.
- **Impact:** Copy implies a selective match when the operation is all-or-nothing per agent. Low, but contributes to UX-C1's confusion.
- **Recommendation:** Reword to "Marks **all** outstanding due commissions for these agents as paid." Align with the UX-C1 fix.

---

## Flow-by-flow trace summary (status)

Legend: OK = wired + states handled · CAVEAT = wired with a noted issue · BROKEN = dead-end/finding

### Landing / Auth
- Landing render, nav, skip-link (`index.html:28` → `#main` in `App.jsx:63`), reduced-motion baseline (`src/index.css:313`) — **OK**.
- Sign-in OTP (any 6-digit, demo scope) + password → role routing via `ProtectedDashboard` → `/coming-soon` for deferred employer/admin (`src/App.jsx:149-164`) — **OK**.

### Subscriber
- Save / schedule / withdraw / claim / projection / reports / nominees / insurance — **OK** (per AUDIT-4 matrix; not re-traced for known items).
- **Agent / Tickets page** — **BROKEN** when agent unresolved (UX-H1); ticket creation routes to null agent (UX-H2).
- Help (tickets list) — depends on the same `subId`; list renders empty-state OK, but creation entry lives on AgentPage.

### Agent
- Home (PortfolioPulse + CoPilot + **NotificationCenterCard**) — **CAVEAT** (UX-H4 stale card).
- Inbox (tickets) — empty/loading/error states handled (`InboxPage.jsx:335-346`) — **OK**.
- **Notification bell** (header chrome + side nav) — mounted, but no focus trap (UX-M4) — **CAVEAT**.
- Commissions / analytics / subscribers / settings — **OK**.

### Branch
- Overview + health score + **NotificationCenterCard** + portaled **NotificationBell** — **CAVEAT** (UX-H4, UX-M4).
- Tickets (view-only oversight) — branchId-keyed; orphaned if org chain broke (UX-M6) — **CAVEAT**.
- Create agent / commission panel (read scope) / reports / settings — **OK**.

### Distributor
- Map drill-down, create branch, view branches/agents — **OK** (subscriber drill known-slow, AUDIT-1-7).
- **Settlement upload → apply** — **BROKEN/CAVEAT**: mismatch not blocked + over-clear (UX-C1), opaque skips (UX-M1), affordance (UX-M2), a11y status (UX-M3), copy (UX-L3).
- **Notifications** — **absent** (UX-H3).
- Tickets oversight, reports, settings — **OK**.

### Signup / KYC (8 numbered steps + contribution)
- Step sequence wired (`SignupPage.jsx:110-160`); agent-fallback + pending-review terminals handled; focus moved to step container on transition (`SignupShell.jsx:47-57`) — **OK**.
- **Refresh mid-flow resets to step 1** (UX-M5); `done` step dead (UX-L1).
- File re-upload on refresh — **intentional demo scope** (CLAUDE.md §5), not a finding.

---

## Accessibility / responsive sweep (hard-rule compliance)

- **`transition: all`** — clean in source (only a comment in `TicketStatusBadge.module.css:30`). **No violation.**
- **`outline:none` without a focus indicator** — every flagged file either pairs with a `:focus`/`:focus-visible` replacement (e.g. `OtpStep.module.css:31-33` swaps to a border) or applies to a non-interactive `tabindex=-1` container (`Modal.module.css:40`), backed by the global `:focus-visible` baseline (`src/index.css:210-218`). **No violation.**
- **Reduced motion** — global `@media (prefers-reduced-motion)` (`src/index.css:313`); the new notification popover (`NotificationBell.jsx:56,105-108`) and Modal (`Modal.jsx:91`) both honour `useReducedMotion`. **OK.**
- **Skip link** — present and targets `#main` rendered on landing + signup shell. **OK.**
- **Indigo-brand contrast** — notification amber badge uses `#5A3D00` text on `#FBBF24` (`Notifications.module.css:71-72`) — sufficient contrast; indigo focus rings use `--color-indigo-soft`. No new contrast regressions spotted in the new feature CSS.
- **Modal primitive** — proper focus trap, scroll-lock, focus restore, Escape with `stopImmediatePropagation`, `aria-modal` (`src/components/Modal.jsx`). Settlement confirm modal correctly reuses it (`CommissionPanel.jsx:844-853`). **OK.** The notification popover is the one dialog that does NOT use it (UX-M4).

---

## Cutover blockers (feat/simplify-commissions → main)

1. **UX-C1** — settlement partial-payment mismatch is not blocked and over-clears all due lines (corrupts demo commission data). **Must fix or explicitly accept before cutover.**
2. **UX-H2** — new tickets dead-letter to a null agent in live mode for any subscriber outside the frozen mockData chain (breaks the headline subscriber↔agent loop the tickets feature shipped to deliver).
3. **UX-H1** — subscriber Agent/Tickets page hangs on a perpetual spinner when no agent resolves (dead-ends the ticket entry point).

UX-H3 and UX-H4 are strongly recommended pre-cutover (visible one-sided/stale notification UX) but are not data-corrupting.
