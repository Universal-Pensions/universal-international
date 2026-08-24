# A22 · State, data layer & error handling

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 16 data hooks + AuthContext + queryClient + 14 services + 13 contexts + App/route boundaries |
| Artifacts examined | all of the above (16/16 hooks, AuthContext, main.jsx queryClient, api.js, supabaseClient.js, entities/adminAttention/subscriber/tickets services, App.jsx, 13 contexts) |
| Coverage | 100% of the named A22 surface |
| Checks defined | 8 (spec §CHECKS 1–8) |
| Checks executed | 8 |
| Checks passed / failed / blocked | 3 / 5 / 0 |
| Findings C / H / M / L / I | 1 / 1 / 3 / 1 / 1 |
| Evidence commands run | 14 runtime Playwright probes (re-run this session) + ~20 source reads/greps |
| Excluded as demo-scope | 1 (in-memory ticket store *reset* itself — src/services/tickets.js; only the visible mid-demo loss is reported) |
| Blocked, with reason | none |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Query-key call sites (useQuery) | 68 |
| Distinct top-level query keys | 60 |
| Mutation call sites (useMutation) | 44 |
| Invalidation gaps found | 1 confirmed user-visible (access-request approve → adminAttention), 2 by-design non-gaps documented |
| Optimistic rollbacks tested / passed | 2 runtime-confirmed (useSubscriber.useUpdateProfile, useEntity.useSetDistributorStatus) + 3 code-verified identical pattern; all restore prior state |
| Cross-role bleed instances (target 0) | **1 CRITICAL** (in-SPA role switch without logout); 0 on the sanctioned Log out path; 0 cross-tab |
| Write error paths tested | 4 money writes × 3 failure modes (500 / network-drop / 400) |
| Silent failures on a money WRITE | 0 (all surface a toast) |
| Silent failures on a money READ | confirmed on the shared hero (renders `—`/0 with no error state) |
| Routes without an error boundary above them | 0 (root ErrorBoundary in main.jsx is the backstop) |

---

## Summary of findings
| id | sev | conf | title |
|---|---|---|---|
| A22-001 | critical | confirmed | Cross-tenant cache bleed: `login` never clears the React Query cache, so an in-SPA role switch shows the previous role's RLS-scoped money |
| A22-002 | high | confirmed | Primary dashboard hero money reads have no error/retry state — a read failure renders `FUNDS UNDER MANAGEMENT —` / 0 subscribers / "Health Score 0 Needs work" silently |
| A22-003 | medium | confirmed | Mid-session JWT expiry on the direct-Supabase path never re-logs-in; `forwardSupabaseAuthError` is dead code (0 call sites), dashboard silently downgrades to anon and shows zeros |
| A22-004 | medium | confirmed | Raw technical error strings ("TypeError: Failed to fetch", raw Postgres exception text) leak into user toasts on money writes; the friendly fallback never wins |
| A22-005 | medium | confirmed | `useApproveAccessRequest`/`useRejectAccessRequest` do not invalidate `adminAttention`, so the "Pending access requests" count stays stale up to 5 min after a decision |
| A22-006 | low | confirmed | A support ticket confirms "sent to your agent" then silently vanishes on refresh (Open 3→2, no error copy) |
| A22-007 | info | confirmed | No global `QueryCache.onError` — every read failure is silent unless the consuming component individually guards `isError` (systemic root of A22-002/003) |

---

## CHECK 1 — Query-key catalogue & mutation invalidation matrix (DELIVERABLE)

68 `useQuery` sites resolve to **60 distinct top-level query keys** across the 16 hooks. 44 `useMutation` sites. Below is the DIRTIES-vs-INVALIDATES matrix for every mutation that moves server state. "Dirties" = server tables/derived reads the write actually changes; "Invalidates" = query keys the mutation's `onSuccess`/`onSettled` refetches. A row is a gap only when a dirtied, currently-mounted read is not invalidated.

### Subscriber (`useSubscriber.js`) — shared `useInvalidateSubscriber(id)` invalidates: `currentSubscriber`, `subscriberTransactions·id`, `contributionBreakdown·id`, `subscriberClaims·id`, `subscriberWithdrawals·id`, `subscriberNominees·id`, `contributionPaidThisMonth·id`
| Mutation | Dirties | Invalidates | Gap? |
|---|---|---|---|
| useMakeContribution (money in) | balance, transactions, breakdown, paid-this-month | full subscriber set | none (balance rides on `currentSubscriber`) |
| useRequestWithdrawal (money out) | balance, withdrawals, transactions | full subscriber set | none |
| useUpdateSchedule | schedule on `currentSubscriber` | full subscriber set | none |
| useUpdateNominees (optimistic) | nominees | `subscriberNominees`+`currentSubscriber` patched, then full set | none |
| useSubmitClaim | claims | full set | none |
| useUpdateInsuranceCover / useFundInsuranceProducts / useRenewPolicy | policies, transactions, balance (premium) | full set | none |
| useUpdateProfile (optimistic) | profile fields | `currentSubscriber` patched + full set | none |

`subscriber·employerFunding·id` and `subscriberAgent·id` are intentionally NOT invalidated by subscriber writes (they only change from the employer/agent side) — documented at `useSubscriber.js:72-74`. **Not a gap.**

### Entity / distributor / branch / agent (`useEntity.js`)
| Mutation | Invalidates | Gap? |
|---|---|---|
| useCreateBranch | `entities·branch`, `children` | none |
| useCreateAgent | `entities·agent`, `children·branch·id`, `entity·branch·id` | none |
| useUpdateBranch (opt) | `entity·branch·id`, `entities·branch`, `children` | none |
| useSetAgentStatus | `entity·agent·id`, `entities·agent`, `children·branch·branchId`, `childrenMetrics·branch·branchId` | none |
| useSetBranchStatus | `entity·branch·id`, `entities·branch`, `children` | none |
| useSetDistributorStatus (opt) + useCreateDistributor (opt) | broad: `entity·distributor·id`, `entities·{distributor,branch,agent}`, `platformOverview`, `children`, `childrenMetrics`, `entityMetrics`, `allEntitiesMetrics`, `entity-page`, `topEntities`, `entitiesMap` | none (mirrors publishNav breadth) |

### Employer (`useEmployer.js`)
| Mutation | Invalidates | Gap? |
|---|---|---|
| useRunContribution (money, real) | `employees·id`, `employee`, `employeeContributions`, `employerContributions·id`, `contributionRuns·id`, `employerMetrics·id`, `employerLeaderboard·id` | none (hero reads `employerMetrics`) |
| useUpdateEmployerProfile (opt) | `employer·id`, `employerMetrics·id`, `employees·id`, `employee` | none |
| invite create/cancel/resend | `pendingInvites·id` (+ employees on complete) | none |
| updateEmployee / removeEmployee | `employees·id`, `employerMetrics·id`, `employee` | none |
| useCreateEmployer (opt, admin) | `allEmployersMetrics`, `platformOverview`, `employerGeoRollup`, `employerActivityRollup`, `employer/employees/employerMetrics·id` | none |

### Access requests (`useAccessRequests.js`) — **GAP**
| Mutation | Invalidates | Gap? |
|---|---|---|
| useApproveAccessRequest | `accessRequests`, `platformOverview`, `entities·distributor`, `entitiesMap·distributor`, `allEmployersMetrics` | **YES → `adminAttention`/`adminAttentionRows` NOT invalidated** (A22-005) |
| useRejectAccessRequest | `accessRequests` only | **YES → same** |

`get_admin_attention` includes `pendingAccessRequests` (`src/services/adminAttention.js:35`), so approving/denying a request must invalidate it. `usePublishNav` correctly does; these two do not.

### NAV (`useNav.js`) — model of correct breadth
`usePublishNav.onSuccess` invalidates 18 keys incl. `adminAttention`, every AUM surface, `currentSubscriber`. No gap.

### Tickets / Commission / Notifications / Nominee-claims / Agent
- `useTickets`: 4 optimistic mutations (send/close/reopen/read) snapshot→patch→rollback→invalidate `tickets`/`ticketThread`/`ticketMetrics` prefixes. No gap.
- `useCommission.useSetCommissionRate`: invalidates `commissionRate`. No gap (rate is the only cached surface it moves in-session).
- `useNotifications` markRead/markAllRead: invalidate `notifications`+`notificationsUnread`. No gap.
- `useReviewNomineeClaim`: invalidates all `nomineeClaims` buckets. Nominee claims are NOT an `adminAttention` signal (not in the 10-signal shape), so no adminAttention gap here.
- `useAgent.useUpdateSubscriberSchedule` (opt) / `recordContribution`: invalidate `agentSubscribers`, `agentContributions`, `subscriberTransactions·id`. No gap.

**Net: 1 confirmed user-visible invalidation gap (A22-005). Every money write invalidates the balance/derived reads it moves.**

---

## CHECK 2 — Optimistic rollback (useEntity / useSubscriber / useAgent)

All optimistic mutations use one shape: `onMutate` snapshots `previous` + `cancelQueries`, `setQueryData` patch, `onError` restores `previous`, `onSettled` invalidates. Runtime-forced failures:

**useSubscriber.useUpdateProfile** — `node …/a22b-16-rollback-subscriber.mjs 500`:
```
before  : Carol Obua
save btn: Save changes
  t+~300ms head=Carol Obua alerts=["injected server error"] toast=injected server error
t+7.2s  : Carol Obua | intercepted: 1
input   : Carol Obua          ← optimistic "ZZ AUDIT PROBE" ROLLED BACK
```
**useEntity.useSetDistributorStatus** — `node …/14-rollback-distributor-status.mjs`:
```
Karamoja status BEFORE: ACTIVE
  >> BLOCKED set_distributor_status … body={"p_distributor_id":"d-003","p_status":"inactive"}
status DURING flight: ACTIVE
status AFTER failure: ACTIVE        ← not stuck INACTIVE
alerts: ["injected failure (audit A22)"]
```
Both restore prior state AND surface an error → **PASS**. `useAgent.useUpdateSubscriberSchedule` and `useSubscriber.useUpdateNominees` are code-identical (verified) — same guarantee. (Note: the surfaced text is the RAW server string — see A22-004.)

---

## CHECK 3 — Cross-role cache bleed → **A22-001 CRITICAL**

**Sanctioned Log out path is clean** — `node …/a22-01-bleed.mjs` (distributor → Log out → admin, same tab):
```
distributor: FUNDS UNDER MANAGEMENT UGX 1.95B … SUBSCRIBERS 4,602
--- logging out via UI ---   token after logout: null   auth after logout: null
admin: FUNDS UNDER MANAGEMENT UGX 2.45B … SUBSCRIBERS 5,064
admin rollup rpc calls in session 2: 2   (fresh fetch, all RPCs re-requested)
```
`AuthContext.logout` calls `queryClient.clear()` (AuthContext.jsx:91) → no bleed.

**In-SPA role switch WITHOUT logout BLEEDS** — `node …/a22b-13-admin-to-dist-bleed.mjs` (admin → back → sign in as distributor d-002, no hard reload):
```
A) ADMIN  : … UGX 2.45B … 321 branches … 5,064
B) DISTRIBUTOR d-002 after switch: 1 region · 321 branches · updated today
   || UGX 2.45B Across 1 region · 321 branches || UGX 2.00B 87% this month || 5,001
   stored session: {"role":"distributor",…,"distributorId":"d-002"}
   rollup(country,[ug]) reqs phase B: 0 | doc loads total: 1
```
d-002 (Busoga; its own scope is ~27 branches / ~0.2B) renders the **platform total UGX 2.45B across 321 branches** — another tenant's money — because `AuthContext.login` (AuthContext.jsx:56-66) sets the token/user but **never clears the query cache** (only `logout` does). `rollup(country,[ug]) reqs = 0` proves the distributor read the admin's cached rollup; `doc loads = 1` proves no hard reload wiped the JS heap. Confirmed both directions (`a22b-12` shows d-002→admin the same way). Screenshot: `scratch/a22b-admin-to-dist-bleed.png`.

Cross-TAB is safe: each tab/document has its own in-memory QueryClient; the `storage` event only syncs logout. The bleed is strictly the same-document login-without-logout sequence.

---

## CHECK 4 — Auth expiry

`node …/a22-05-auth-expiry.mjs`:
- **4a startup gate — PASS**: expired token + stored session on boot → `url = http://localhost:5173/`, `localStorage keys = []` (cleared), landing shown. The `isJwtExpired` gate (AuthContext.jsx MED-6) works.
- **4b mid-session expiry — FAIL → A22-003**: token swapped for an expired one, navigate to Agents → `responses: ["200 districts","200 regions","401 agents"]`, screen shows `0 agents · 0 SUBSCRIBERS · 0 AUM`, `token = STILL PRESENT`. No re-login. `isJwtExpired` downgrades the expired token to the anon key, so reads return empty/401 and the dashboard silently zeroes out.
- **4c /api 401 path — PASS (code)**: `apiFetch` → `notifyAuthExpired()` → `onAuthExpired` listeners → `logout()+navigate('/')` (api.js:211-223, AuthContext.jsx). The `/api/*` channel and cross-tab `storage` sync are wired; only the primary direct-Supabase path is not (A22-003).

---

## CHECK 5 — Write error surfaces (500 / network-drop / 400)

`node …/a22-14-money-writes.mjs` (subscriber `make_contribution`):
```
=== 500-server-error ===  toast "unexpected error while executing make_contribution"  → error SEEN
=== network-drop ===      toast "TypeError: Failed to fetch"                            → error SEEN
=== 400-validation ===    toast "amount must be greater than zero"                      → error SEEN
```
All three surface a toast; balance unchanged (non-optimistic, `onSuccess`-only). Employer run (`runViews.jsx:361`), withdrawal (`WithdrawPage.jsx:142`), NAV publish (`AdminNavDesktop.jsx:165`) all have `onError`/`catch` → `addToast('error', …)`. **No silent failure on any money WRITE.**

BUT the money-READ side IS silent — see CHECK 6 / A22-002. And every toast shows the RAW error string instead of the friendly fallback — A22-004.

---

## CHECK 6 — ErrorBoundary / ErrorCard / Toast coverage

- **Boundaries — PASS**: root `ErrorBoundary` in `main.jsx` wraps the whole tree (MED-7 backstop); `/dashboard/*`, `/signup/*`, `/invite/:token/*` add scoped ones (App.jsx). **No route lacks a boundary above it.** Public landing / `/claim` / `/admin/login` / the root `SignInModal` rely on the root boundary only (a throw there blanks to the shared fallback rather than a scoped recovery — info-level).
- **Read-error states — FAIL → A22-002 / A22-007**: `main.jsx` QueryClient has **no `QueryCache.onError`** — read failures are silent unless a component checks `isError`. `node …/a22-19-error-badge-check.mjs`:
```
== admin / get_platform_overview 500 ==   FUM shown: "— "   "Metrics unavailable" present: false   retry button: false   role=status/alert: []
== distributor / get_entity_metrics_rollup 500 ==   FUM shown: "— "   "Metrics unavailable" present: false   retry button: false
```
`getPlatformOverview`/`getEntityMetricsRollup` throw on error (entities.js:1316, :877), yet the shared "FUNDS UNDER MANAGEMENT" hero renders `—`/0/"Needs work" with no message and no retry. The one `isError` "Metrics unavailable" badge (`AdminCountryOverview.jsx:115`) is on a *secondary* "Assets Under Management" Summary card and never surfaced in the mounted overview.

---

## CHECK 7 — The 13 contexts — PASS

Provider order (main.jsx → App.jsx): `ErrorBoundary → BrowserRouter → QueryClientProvider → AuthProvider → ToastProvider → MotionConfig → App(SignInProvider)`.
- **Ordering**: `AuthProvider` needs `useQueryClient` (QueryClientProvider is above ✓) and `useNavigate` (BrowserRouter above ✓). `ToastProvider` is below `AuthProvider`; `AuthContext` does not consume Toast, so no inversion. No context is read above its provider.
- **Read-outside-provider**: the scope contexts (`Agent/Branch/EmployerScopeContext`) are built by `createScopeContext`, which seeds a default `{ [key]: null }` and returns it via `useContext` outside a provider — graceful `null` fallback, no throw. `useAuth` throws by design but AuthProvider is always at the root.
- **Re-render fan-out**: every context value is `useMemo`'d (the three 0-useMemo scope modules delegate to the memoized factory — `createScopeContext.jsx:20`). No unstable value objects found.

---

## CHECK 8 — In-memory ticket store (demo scope) → A22-006

`node …/18-ticket-refresh-loss.mjs`:
```
BEFORE: {"open":"2","hasProbe":false}
AFTER CREATE: {"open":"3","hasProbe":true}
confirmation shown: ["Your issue has been sent to your agent."]
AFTER RELOAD: {"open":"2","hasProbe":false}
any "missing"/error copy after reload: false
```
The module-level `Map` in `src/services/tickets.js` re-seeds on reload (by design — demo scope, EXCLUDED). The *reportable* slice: the rep sees a success toast implying delivery ("sent to your agent"), then on any refresh the ticket silently disappears (count reverts 3→2) with no explanation. A rep who refreshes mid-demo visibly loses the ticket they just created.

---

## Findings (detail)

### A22-001 · CRITICAL · confirmed — Cross-tenant cache bleed on login-without-logout
- **location**: `src/contexts/AuthContext.jsx:56-66` (`login` — no `queryClient.clear()`; contrast `logout` at :91)
- **evidence**: `a22b-13-admin-to-dist-bleed.mjs` output above — distributor d-002 renders `UGX 2.45B Across 1 region · 321 branches` (the admin platform total), `rollup(country,[ug]) reqs = 0`, `doc loads = 1`. Screenshot `scratch/a22b-admin-to-dist-bleed.png`.
- **impact**: WRONG MONEY and another tenant's data displayed. If a rep demos multiple roles in one tab and signs into the next role from the landing without clicking Log out (no hard reload), that role sees the prior role's RLS-scoped figures for up to the 5-min staleTime. A prospect distributor seeing "321 branches / 2.45B" instead of their own scope destroys credibility; worse, it is a real tenant-isolation breach in the client cache.
- **repro**: sign in as admin at `/admin`; browser-back to a landing; open Distributor landing; sign in as d-002 — all without Log out and without a full reload → distributor hero shows platform totals.
- **suggested_fix**: call `queryClient.clear()` (or `removeQueries()`) inside `login` as well as `logout`, i.e. clear on any identity change. Cheap and total.

### A22-002 · HIGH · confirmed — No error/retry state on the primary hero money reads
- **location**: shared dashboard hero (renders "FUNDS UNDER MANAGEMENT", used by admin/distributor/branch) + `src/main.jsx:69` (no `QueryCache.onError`)
- **evidence**: `a22-19-error-badge-check.mjs` and `a22-06-silent-read-failure.mjs` — on a 500 for `get_platform_overview` / `get_entity_metrics_rollup` the hero shows `FUNDS UNDER MANAGEMENT —`, `SUBSCRIBERS 0`, `Health Score 0 Needs work`, no "unavailable" text, no retry, no `role=status`.
- **impact**: a single failed overview read (network blip on demo wifi, RPC error, cold path) turns the admin/distributor home into a fully-zeroed "Needs work" screen showing `—` for AUM, with no indication anything failed and no way to recover but a manual page reload. Reads as wrong money during a live demo.
- **suggested_fix**: give the shared hero an `isError` branch (message + Retry that calls `refetch()`); add a global `QueryCache.onError` toast so no read can fail entirely silently.

### A22-003 · MEDIUM · confirmed — Mid-session expiry on the Supabase path never re-logs-in (dead `forwardSupabaseAuthError`)
- **location**: `src/services/supabaseClient.js` (`forwardSupabaseAuthError` / `isSupabaseAuthError` exported) — **0 call sites** across the 14 services
- **evidence**: `grep -rn "forwardSupabaseAuthError|isSupabaseAuthError" src/services src/hooks` returns only test files; `a22-05` 4b: `token = STILL PRESENT`, screen `0 agents · 0 SUBSCRIBERS · 0 AUM`, no logout.
- **impact**: once the 24h JWT lapses mid-session, every direct-PostgREST read (all dashboards) silently downgrades to the anon key and shows zeros; the user stays "logged in" with a dead session and no re-login prompt. Not a live-demo trigger (needs a day-old session), hence medium — but the wiring the code documents at length is entirely unhooked.
- **suggested_fix**: have each service (or a shared `.rpc/.from` wrapper) call `forwardSupabaseAuthError(error)` on every result, or centralise it in `supabaseClient`'s `fetchWithAuth` by inspecting the response status.

### A22-004 · MEDIUM · confirmed — Raw technical error strings leak into user toasts
- **location**: write pages, e.g. `SavePage.jsx:204`, `WithdrawPage.jsx:142`, `runViews.jsx:361`, `ProfilePage.jsx:102` — pattern `addToast('error', err?.message || 'Could not …')`; `err.message` is populated by `createApiError`/supabase, so the fallback never runs.
- **evidence**: `a22-14` toasts: `"TypeError: Failed to fetch"`, `"unexpected error while executing make_contribution"`; `a22b-16`/`14`: `"injected server error"`, `"injected failure (audit A22)"`.
- **impact**: on a flaky demo network a prospect sees `TypeError: Failed to fetch` (or a raw Postgres exception) on a money action — looks broken/unprofessional. The friendly copy authors clearly intended is dead.
- **suggested_fix**: map known `err.code`s to friendly copy and default to the fallback for anything unrecognised; never render a bare `err.message` in a toast.

### A22-005 · MEDIUM · confirmed — Access-request decision leaves the "Pending access requests" attention count stale
- **location**: `src/hooks/useAccessRequests.js:22-41` (approve/reject omit `adminAttention`/`adminAttentionRows`)
- **evidence**: `15-invalidation-probe.mjs` — after `approve_access_request`, refetched = `[list_access_requests, get_platform_overview]`; returning to Overview refetched `[]`; `get_admin_attention refetched? false`. `get_admin_attention` counts `pendingAccessRequests` (`adminAttention.js:35`).
- **impact**: admin approves/denies a request, the Needs-attention "Pending access requests" chip on the home keeps the old count for up to 5 min — visibly stale during a demo. Inconsistent with `usePublishNav`, which invalidates `adminAttention`.
- **suggested_fix**: add `queryClient.invalidateQueries({ queryKey: ['adminAttention'] })` and `['adminAttentionRows']` to both mutations.

### A22-006 · LOW · confirmed — Ticket confirmed then silently lost on refresh
- **location**: `src/services/tickets.js` (module-level `Map`, re-seeded on load)
- **evidence**: `18-ticket-refresh-loss.mjs` output above.
- **impact**: rep creates a support ticket (toast "sent to your agent"), refreshes, ticket is gone and the Open count drops with no message. The in-memory reset is by-design demo scope; the visible mid-demo loss plus a delivery-implying confirmation is the reportable part.
- **suggested_fix**: (demo-scope) either persist to `sessionStorage`, or soften the confirmation copy so it doesn't promise delivery.

### A22-007 · INFO · confirmed — No global read-failure surface
- **location**: `src/main.jsx:69` QueryClient (no `QueryCache`/`MutationCache` `onError`)
- **evidence**: `grep -n "QueryCache|onError|MutationCache" src/main.jsx` → none.
- **impact**: architectural root of A22-002/A22-003 — a read that no component guards fails invisibly. Recorded for context; the fix is folded into A22-002.

---

## Traceability
| Check | Disposition |
|---|---|
| 1 — Catalogue every query key; per-mutation DIRTIES vs INVALIDATES; every gap a finding | **FINDING A22-005** (matrix delivered above; 1 confirmed gap, rest PASS) |
| 2 — Optimistic rollback in useEntity/useSubscriber/useAgent restores state AND surfaces error | **PASS** (2 runtime-confirmed + 3 code-identical; error surfaced — leak noted as A22-004) |
| 3 — Cross-role cache bleed; AuthContext resets cache on logout — prove it | **FINDING A22-001** (logout PASSES; login does NOT → CRITICAL bleed) |
| 4 — Auth expiry: onAuthExpired / 401 / isJwtExpired → clean re-login not blank screen | **FINDING A22-003** (4a/4c PASS; 4b Supabase path FAILS) |
| 5 — Every write: force 500 / network / validation; silent failure on money write = CRITICAL | **PASS** (0 silent money-write failures; raw-string leak → A22-004) |
| 6 — ErrorBoundary/ErrorCard/Toast coverage; routes with no boundary | **FINDING A22-002** (boundaries PASS; read-error states FAIL on the hero) |
| 7 — 13 contexts: re-render fan-out / provider ordering / read outside provider | **PASS** |
| 8 — tickets.js in-memory: does a mid-demo refresh lose a just-created ticket | **FINDING A22-006** (reset is EXCLUDED-DEMO-SCOPE; visible loss reported) |

---

## Scratch files added this session (for removal)
- `docs/audits/2026-08-23/scratch/a22-19-error-badge-check.mjs` (new) — precise hero error-affordance probe.
All other `a22*`, numbered, and `.png` scratch files under `docs/audits/2026-08-23/scratch/` are prior-run throwaways and may be removed with this file's evidence captured here. **No fixture rows were written** — every write/RPC in the money and rollback probes was Playwright-route-intercepted and failed before reaching the DB (e.g. `approve_access_request`, `set_distributor_status`, `make_contribution`, `subscribers` PATCH were all faked/aborted client-side); the ticket probe used the in-memory store only. No live data was mutated.
