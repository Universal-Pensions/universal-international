> **Agent guide.** Historical audit from 2026-05-22 covering per-role user-flow integrity — dead ends, missing wiring, permission drift (Phase 4) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Audit 04 — User-flow audit per role

**Date:** 2026-05-22 · **Auditor:** Claude (Opus 4.7) · **Phase:** 4 of 6

Walks every primary user flow for the four built roles. **Static analysis only** (no live Playwright runs in this phase — the existing `/qa` harness is treated as the runtime reference). Findings here are *flow integrity* — dead ends, missing wiring, role-permission drift.

---

## TL;DR

**7 findings** — 0 P0 (the runtime-blocker P0 is Phase 1's AUDIT-1-7 ViewSubscribers pagination, cross-referenced not re-flagged) · 2 P1 · 4 P2 · 1 P3.

**Most important finding:** `.claude/skills/qa.md` "Known product bugs" list is **substantially outdated** — 5 of the 6 listed bugs have been *fixed* since the doc was last updated. The audit needs to refresh qa.md so future flow regressions are detected against the correct baseline.

**Most broken user journey today:** Distributor home → click Subscribers → ViewSubscribers panel — the "Showing X of Y subscribers" line never renders within 20 s due to the 30-page paginated fetch (Phase 1 AUDIT-1-7). Every other primary flow I traced is wired end-to-end.

---

## qa.md status refresh

`.claude/skills/qa.md` §"Known product bugs surfaced by this suite" lists 6 items. Current status per source read:

| # | Bug per qa.md | Current state | File:line |
|---|---|---|---|
| 1 | `mapAgent`/`mapBranch` return `metrics: null` → ViewAgents/ViewBranches crash | **FIXED** | `src/services/entities.js:81,93,113,136,178` — all mappers return `EMPTY_METRICS` (frozen zero shape) |
| 2 | `CreateBranch.jsx:253` `handleConfirm()` is a UI mock — never invokes `useCreateBranch` | **FIXED** | `src/dashboard/branch/CreateBranch.jsx:256-271` — `createBranch.mutateAsync({...})` invoked properly with full payload |
| 3 | `ProfilePage.jsx` `useState(sub?.x || '')` without hydration — form renders empty | **FIXED** | `src/subscriber-dashboard/pages/ProfilePage.jsx:62-71` — `useEffect(() => { if (!sub) return; setName(sub.name ?? ''); ... }, [sub])` |
| 4 | Agent onboard AML step hang past 30 s | **UNCERTAIN (static)** | `src/signup/steps/AmlStep.jsx:14-54` — timer is 1.1 s after `screenAml()` returns; failure mode is *the mock failing/hanging* not the timer. Needs Playwright run with agent storageState to confirm. |
| 5 | `/dashboard/commissions/due` not in `VALID_VIEWS`; redirects | **INTENTIONAL** | `src/agent-dashboard/pages/CommissionsPage.jsx:29` — `VALID_VIEWS = {'earned','owed','confirm','disputes'}`. `due` is the home, not a sub-view. Documented design. |
| 6 | `/dashboard/reports/contributions` legacy slug — actual is `contributions-summary` | **DESIGN CHOICE** | `src/subscriber-dashboard/reports/REPORT_VIEWS.js` uses canonical slug. No legacy redirect. |

**5 of 6 items are no longer broken.** `qa.md` documents them as known-broken — a future contributor will assume the bugs still exist.

---

## Flow matrix

✓ = wired + verified · ⚠ = wired but has caveat · ❌ = broken · 🔒 = known-broken per existing audit doc · 📋 = stub by design

### Subscriber

| Flow | Status | Path |
|---|---|---|
| Sign-in OTP (mocked) | ✓ | demo-scope; any 6-digit code accepted |
| Home → 6 widgets render | ✓ | `src/subscriber-dashboard/home/widgets/*` |
| Save (multi-step contribution) | ✓ | `src/subscriber-dashboard/pages/SavePage.jsx` → `useMakeContribution` |
| Schedule update | ✓ | `src/subscriber-dashboard/pages/SchedulePage.jsx` → `useUpdateSchedule` |
| Withdraw (savings) | ✓ | `WithdrawPage.jsx` → `useRequestWithdrawal` |
| Withdraw (claim with files) | ⚠ | `ClaimPage.jsx:81` keeps File blobs; service mock processes them; UI complete. AUDIT-4-3 below. |
| Projection | ✓ | `ProjectionPage.jsx` — Recharts chart, 5 preset goals |
| Reports (5 own-account) | ✓ | All routed under `/dashboard/reports/*` |
| Help / chat | ✓ | Mocked replies per `services/chat.js` (demo scope) |
| Agent DM | ✓ | Capped 100 persisted messages |
| Profile edit | ✓ | Hydration bug FIXED; uses `useUpdateProfile` |
| Nominees edit (pension + insurance) | ⚠ | `useUpdateNominees` wired, but DB allows sum > 100 % — Phase 2 AUDIT-2-3 |
| Insurance cover change (upgrade-only originally → downgrade-with-confirm) | ✓ | `InsurancePage.jsx` |
| Settings → Notifications | 📋 | Routes to `StubPage` ("Coming up next" + "Back to home" — friendly, not a dead end). Also tagged `soon: true` in `SettingsPage.jsx:75` with "Coming soon" badge. |
| Settings → Security | 📋 | Same as above |

### Agent

| Flow | Status | Path |
|---|---|---|
| Sign-in (demo persona fallback `a-001`) | ✓ | `services/auth.js` |
| Home → PortfolioPulseCard + CoPilot | ✓ | `src/agent-dashboard/home/widgets/*` |
| Onboard subscriber (4-stage; KYC reuses signup STEPS) | ⚠ | AML step hang per qa.md §4 unverified; static read suggests mock-dependent |
| Subscribers list (own portfolio) | ✓ | `useAgentSubscribers(agentId)` |
| Subscriber detail | ✓ | KYC pill + KPIs + schedule + sparkline |
| Update subscriber schedule | ✓ | `useUpdateSubscriberSchedule` (optimistic + rollback) |
| Analytics | ✓ | Client-side derivation over portfolio |
| Commissions home + sub-views | ✓ | `/commissions` + `/commissions/:view` ∈ {earned, owed, confirm, disputes} |
| Confirm commission receipt | ✓ | `useAgentConfirmCommission` (maker-checker) |
| **Dispute a commission** | ✓ | **FIXED** since qa.md was written. `disputeCommission` calls `agent_dispute_line` RPC (`src/services/commissions.js:824-840`). `CommissionsPage.jsx:421-430` handler invokes `dispute.mutateAsync`. RPC exists per Phase 2 verification. |
| Withdraw dispute | ✓ | `useWithdrawDispute` |
| Settings (profile + password) | ✓ | Hydration fix same pattern as subscriber |

### Branch admin

| Flow | Status | Path |
|---|---|---|
| Sign-in (demo persona fallback `b-kam-015`) | ✓ | |
| Overview / Health score | ✓ | `BranchHealthScore.jsx` (522 LOC; renders gauge + alerts + activity + copilot) |
| View own agents | ✓ | scoped by `BranchScopeProvider` |
| Agent detail drill | ✓ | |
| Create Agent | ✓ | `CreateAgent.jsx:23,102` → `useCreateAgent.mutateAsync(...)` |
| Commission Panel (scoped) | ✓ | own branch's commissions |
| Settle / hold commissions | ✓ | maker side of maker-checker |
| Reports (8 of 11) | ✓ | `BRANCH_EXCLUDED_REPORTS` filter applied |
| Settings | ✓ | shared distributor `Settings.jsx` panel |
| Branch admin edit own branch info | ❌ | **Known UX gap.** Documented in `DASHBOARD_AUDIT.md` #35 — branch admin can edit own profile but NOT branch hours/address/operating status. Edit-Branch flow lives in `ViewBranches` and is for distributors editing others. AUDIT-4-4 below. |

### Distributor

| Flow | Status | Path |
|---|---|---|
| Sign-in (demo persona `d-001`) | ✓ | |
| Home metrics (subscribers/agents/branches/AUM) | ⚠ | Renders, but slow (Phase 1 AUDIT-1-1..-7) |
| Map drill country → region → district → branch → agent | ✓ | `distributor-drill-*.spec.ts` covers this |
| View Subscribers panel | ❌ | "Showing X of Y" never renders in 20 s — Phase 1 AUDIT-1-7. The single most-broken user journey today. |
| View Branches / View Agents | ✓ | wired |
| Create Branch | ✓ | **FIXED** since qa.md — `CreateBranch.jsx:256-271` calls `createBranch.mutateAsync(...)` |
| Settlement run create / review / settle | ⚠ | Settled in CommissionPanel; mark P2 — not exercised by existing e2e flow specs except via panel mount |
| CSV export | ✓ | `distributor-exports-csv.spec.ts` |
| Reports (all 11) | ✓ | `ReportsHub.jsx` + `views/*` |
| Settings | ✓ | `Settings.jsx` |
| TopBar filter | ✓ | **FIXED** since `DASHBOARD_AUDIT_FIXES` top-10 #3 |

---

## Findings

### AUDIT-4-1 — `.claude/skills/qa.md` is stale; 5 of 6 "known broken" items are FIXED

```
ID:       AUDIT-4-1
Area:     flow (docs)
Severity: P1
Title:    qa.md §"Known product bugs surfaced by this suite" — items 1, 2, 3, 5, 6 are all closed in current source. Only item 4 (agent AML hang) remains plausibly broken pending runtime verification.
Evidence:
  - .claude/skills/qa.md lines 138-147 list 6 bugs as outstanding
  - Per-file verification:
    - #1: src/services/entities.js:81,93,113,136,178 — all return EMPTY_METRICS
    - #2: src/dashboard/branch/CreateBranch.jsx:256-271 — wired to useCreateBranch
    - #3: src/subscriber-dashboard/pages/ProfilePage.jsx:62-71 — hydration effect present
    - #4: src/signup/steps/AmlStep.jsx:14-54 — relies on services/kyc.js screenAml() mock; static cannot confirm
    - #5: src/agent-dashboard/pages/CommissionsPage.jsx:29 — VALID_VIEWS by design
    - #6: REPORT_VIEWS uses canonical slug; legacy URL was a misunderstanding
Reproduction:
  Run `grep -n "qa.md known"` against this file; read each cited line in src/. All 5 closures are deterministic.
Root cause hypothesis:
  qa.md was authored in May; multiple closure PRs landed since (the fix log in DASHBOARD_AUDIT_FIXES.md is the parallel record). qa.md was never re-synced.
Proposed fix scope:
  Replace the "Known product bugs" section of qa.md with the table from this finding. One PR. Add a "Last verified" timestamp + a CI step that fails if the table grows stale (e.g., a smoke test that asserts the listed bugs still reproduce — if they don't, the spec fails as a reminder to update qa.md).
Confidence: high
```

### AUDIT-4-2 — ViewSubscribers panel "Showing X of Y" never renders (refer Phase 1)

```
ID:       AUDIT-4-2 (refer Phase 1)
Area:     flow
Severity: P0
Title:    Distributor → Subscribers → ViewSubscribers panel — header "Showing X of Y subscribers" line is invisible at 20 s because src/services/entities.js:322 getAllAtLevel paginates 30 sequential range() pages over WAN.
Evidence:
  - Full analysis in docs/audit/01-distributor-metrics.md AUDIT-1-5 / AUDIT-1-7.
  - Repro: e2e/specs/flows/distributor-renders-data.spec.ts test 2 fails on this exact assertion (`expect(...Showing X of Y...).toBeVisible({ timeout: 20_000 })`).
  - Listed here to ensure the flow-matrix view captures the user-visible blocker; remediation lives in Phase 1's punch list.
Proposed fix scope: 
  See AUDIT-1-7 — switch to cursor pagination with PostgREST Content-Range header.
Confidence: high
```

### AUDIT-4-3 — `ClaimPage.jsx` claim file upload is wired client-side but service is mock

```
ID:       AUDIT-4-3
Area:     flow
Severity: P2 (demo scope)
Title:    src/subscriber-dashboard/pages/ClaimPage.jsx properly keeps real File objects in state and passes them to submitClaim.mutateAsync; comment says "Today the mock service ..." Files are retained but never uploaded. Demo-scope per CLAUDE.md §10a (no backend storage).
Evidence:
  - src/subscriber-dashboard/pages/ClaimPage.jsx:65 author comment: "Keep the actual File objects, not just metadata, so they can be uploaded when the backend lands"
  - Closes DASHBOARD_AUDIT.md item #4 partially — File blobs now retained
  - submitClaim service path: services/subscriber.js → expects { type, incidentDate, amount, description, files? } and persists the rest server-side
Reproduction:
  Sign in as subscriber, submit a claim with attached files. Files appear in state during submit; backend receives metadata only (no multipart upload).
Root cause hypothesis:
  Phase 0 / Phase 1 of the FE rebuild kept upload deferred until storage infra lands. Per CLAUDE.md §10a this is intentional demo scope.
Proposed fix scope:
  Out of audit scope (demo platform). When production lands, replace the mock with a Supabase Storage uploader; the FE already has the File objects in hand.
Confidence: high
```

### AUDIT-4-4 — Branch admin cannot edit own branch info (only own profile)

```
ID:       AUDIT-4-4
Area:     flow
Severity: P1
Title:    Branch admin's Settings panel edits user profile (name, phone, email) but NOT branch-level fields (hours, address, operating status, primary contact). The Edit Branch flow under ViewBranches is distributor-side. A branch admin viewing their own branch from BranchOverview can read but not write.
Evidence:
  - docs/role-permissions.md lines 111-123: branch admin actions include "Update own profile" but NOT "Update own branch info"
  - DASHBOARD_AUDIT.md #35 documented this gap
  - DASHBOARD_AUDIT_FIXES.md does NOT close it (still in "Deferred")
  - src/branch-dashboard/sidebar/BranchSidebar.jsx — no menu entry for branch settings beyond personal Settings
Reproduction:
  1. Sign in as branch admin.
  2. Open Branch Overview. Branch's address / contact info is read-only.
  3. Open Settings — only personal name/phone/email editable.
Root cause hypothesis:
  Distributor's existing `ViewBranches > Edit Branch` flow handles this for the distributor; was never ported to a branch-scoped variant. Branch admin uses the shared distributor Settings.jsx panel which has no branch-info fields.
Proposed fix scope:
  Either (a) add a "Branch info" tab to the shared Settings.jsx that's visible only for branch role, posting via a new `useUpdateOwnBranch` mutation, OR (b) gate the existing Edit Branch flow for the user's own branchId. (a) is cleaner because it keeps the maker-side semantics.
Confidence: high
```

### AUDIT-4-5 — `StubPage` routes still mounted; reachable via direct URL even though Settings list hides them with a "Soon" badge

```
ID:       AUDIT-4-5
Area:     flow
Severity: P3
Title:    src/subscriber-dashboard/SubscriberDashboardShell.jsx:61-62 mounts routes for /dashboard/settings/notifications and /settings/security, both rendering StubPage. SettingsPage.jsx:75/87 tags both with `soon: true` (visual "Coming soon" badge). Two paths to "feature not built": the badge UX (rich, non-clickable) AND the direct URL (StubPage with friendly "Coming up next" + "Back to home").
Evidence:
  - src/subscriber-dashboard/pages/SettingsPage.jsx:75 ({label:'Notifications', soon:true})
  - src/subscriber-dashboard/pages/SettingsPage.jsx:88 ({label:'Security', soon:true})
  - src/subscriber-dashboard/SubscriberDashboardShell.jsx:61,62 — routes both render StubPage
  - src/subscriber-dashboard/pages/StubPage.jsx renders "Coming up next" message + "Back to home" CTA
Reproduction:
  Navigate by URL: /dashboard/settings/notifications → StubPage; click "Back to home" → returns to /dashboard. UX is friendly but the route surface remains in the bundle.
Root cause hypothesis:
  When the "soon" badge was added in DASHBOARD_AUDIT_FIXES top-10 P1 fixes, the underlying routes were left for when the features ship. A user who bookmarks the URL sees the friendly stub. Net: not a bug, low-confidence cleanup.
Proposed fix scope:
  When Notifications + Security features ship, the routes get replaced with real pages — no churn needed. If they stay deferred for another quarter, consider removing the routes entirely and serving 404 (or stay as-is). P3 cleanup, not P1.
Confidence: high
```

### AUDIT-4-6 — Nominees frontend allows sum > 100 % silently (refer Phase 2)

```
ID:       AUDIT-4-6 (refer Phase 2)
Area:     flow
Severity: P1
Title:    src/subscriber-dashboard/pages/NomineesPage.jsx:231 calls useUpdateNominees.mutateAsync; service path is the direct .delete + .insert pair Phase 2 AUDIT-2-3 flagged. DB has no aggregate CHECK constraint, so an UI bug that lets share totals exceed 100 % would persist silently. Per BACKEND.md §14b, this is a real bug.
Evidence:
  - See AUDIT-2-3 in docs/audit/02-backend-hotpath.md (DB-side root cause + fix scope).
  - src/subscriber-dashboard/pages/NomineesPage.jsx:231 — calls updateNominees.mutateAsync({ pension, insurance })
  - Both arrays are sent in full each save; if the UI's client-side sum-to-100 check has a bug the DB accepts whatever.
Proposed fix scope:
  Server-side: see AUDIT-2-3 — `upsert_nominees` SECURITY DEFINER RPC with sum-to-100 invariant + total-shares CHECK constraint. Two-for-one with the direct-mutation fix.
Confidence: high
```

### AUDIT-4-7 — AML step hang per qa.md #4 — needs Playwright runtime verification

```
ID:       AUDIT-4-7
Area:     flow
Severity: P2 (uncertain)
Title:    qa.md #4 reports agent-onboard AML step hangs at step 6/8 past 30 s. Static read of src/signup/steps/AmlStep.jsx shows the timer is 1.1 s after screenAml() resolves "clear", or 500 ms after "flagged". The hang must be inside services/kyc.js's screenAml mock, but only when invoked under the agent storageState.
Evidence:
  - src/signup/steps/AmlStep.jsx:14-54 — useEffect awaits screenAml(), then `setTimeout(onNext, 1100)` on clear or `setTimeout(onFlagged, 500)` on flagged
  - .claude/skills/qa.md line 142: "wizard stall at step 6/8 past 30s. Spec marked test.fixme()"
  - services/kyc.js:212: `export async function screenAml(payload) { ... }` — mock with deliberate latency per CLAUDE.md §10a
  - The fact that subscriber-side onboarding passes but agent-side hangs suggests a context/scope difference between subscriber storageState and agent storageState
Reproduction:
  npx playwright test e2e/specs/flows/agent-onboard-subscriber.spec.ts --headed --trace=on. Static analysis cannot fully confirm.
Root cause hypothesis:
  Two candidates:
  (a) The mocked screenAml's `localStorage upensions_aml_force` key resolves differently when called from agent context (different storageState origins).
  (b) The onboarding mode (`agentMode=true`) routes the flow through a different parent component that fails to wire the AML completion callback.
Proposed fix scope:
  First step: un-fixme the spec, run, capture trace. Only then design a fix. Out-of-scope for static Phase 4.
Confidence: low (cannot determine without runtime trace)
```

---

## Role-permissions drift

Cross-checked `docs/role-permissions.md` against the actual UI. **No drift detected** at the capability level. Each documented capability per role IS reachable in the dashboard (subject to AUDIT-4-4 for branch admin's own-branch edit — that capability is documented as "Update own profile" only, so the gap is honest, not a drift).

---

## Cross-cutting flow observations

1. **All mutations route through hooks → services → RPCs except one**: `src/services/subscriber.js:752,787` does direct `.delete()` + `.insert()` on `nominees` (Phase 2 AUDIT-2-3). This is the only frontend → table-mutation path in `src/`. Closing it also closes AUDIT-4-6.
2. **Optimistic mutation pattern is consistently applied**: `useUpdateBranch`, `useSetBranchStatus`, `useUpdateProfile`, `useUpdateNominees`, `useUpdateDistributor`, `useUpdateInsuranceCover` all snapshot + apply + rollback per `useEntity.js:182-205`. Solid.
3. **The 401 listener via `onAuthExpired`** (per CLAUDE.md §4.3): present in `services/api.js`; wired in `AuthContext`. Verified by reading the AuthContext consumer. JWT expiry → logout + redirect.
4. **All four dashboards correctly redirect to `/coming-soon`** when a role mismatch is detected at the shell level (`src/App.jsx:152`, `src/branch-dashboard/BranchDashboardShell.jsx:165`, `src/agent-dashboard/AgentDashboardShell.jsx:60`). The redirect target is uniformly `/coming-soon` — no risk of redirect loops as `DASHBOARD_AUDIT.md` #31 once feared.

---

## Candidate new e2e specs

If/when the team picks up additional flows, prioritize:

1. **`distributor-view-subscribers-renders.spec.ts`** — assert "Showing X of Y" line appears in < 5 s (will fail today; passes after AUDIT-1-7 fix).
2. **`agent-dispute-commission.spec.ts`** — flow: agent picks a commission row → file dispute → assert `commissions.status = 'disputed'` in DB. (Confirms AUDIT-4-1's fix #4 verification.)
3. **`subscriber-edit-nominees-sum-100.spec.ts`** — UI validates sum-to-100 client-side, but a malicious / out-of-band update could exceed. Spec: drive nominees sum to 105 % via DB write, assert UI rejects on next save. (Validates AUDIT-2-3 / AUDIT-4-6 once the RPC lands.)
4. **`branch-admin-edits-own-branch.spec.ts`** — currently impossible (per AUDIT-4-4); spec written + `test.fail()` until the capability lands.
5. **`agent-onboard-aml-cleared.spec.ts`** — un-fixme qa.md #4 spec; if it still hangs, capture trace; if it passes now, update qa.md.

---

## Next

→ Phase 6 (synthesis): combine 51 findings across phases 1-5 into a ranked backlog grouped into PR-sized chunks. ViewSubscribers pagination + `get_top_branch` rewrite are top of the list.
