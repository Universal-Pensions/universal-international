> **Agent guide.** The role × capability matrix — what each role (subscriber, agent, branch, distributor, employer, admin) may see and do. Read it before any access-related change so a UI capability and its RLS/RPC gate stay in agreement. All six roles are now built (desktop + mobile), so any "Planned" markers below are historical — verify against `CLAUDE.md` and the RLS in `BACKEND.md` / `supabase/migrations/*.sql`.
>
> **Verified against the live Singapore DB (`ilkhfnoyxlxwqadebnkp`) and live `pg_policies` on 2026-08-25.** This is the document `docs/audits/2026-08-23/02-rls-matrix.md` derived its `expected` column from — several claims below previously disagreed with the measured matrix (some self-contradicting other lines in this same file); those are now corrected inline. Re-verify policy names and counts before relying on them; they decay fast.

# Universal Pensions Uganda — Role-Permission Matrix

> This document defines what each user role can see and do on the platform.
> Roles marked **Built** have working dashboard implementations. Roles marked **Planned** have inferred capabilities based on the data model and existing patterns — the frontend does not yet render their dashboards.

---

## Role Overview

| Role | Sign-In Category | Dashboard | Status |
|------|-----------------|-----------|--------|
| subscriber | Subscriber | SubscriberDashboardShell | **Built** |
| employer | Employer | EmployerDashboardShell | **Built** |
| distributor | Distributor → Distributor Admin | DashboardShell | **Built** |
| branch | Distributor → Branch Admin | BranchDashboardShell | **Built** |
| agent | Distributor → Agent | AgentDashboardShell | **Built** |
| admin | Admin | AdminDashboardShell | **Built** |

Sign-in flow: Role Select → (Distributor Sub-select if applicable) → Phone Entry → OTP Verify

---

## Role 1: Distributor Admin (`distributor`) — BUILT

### Dashboard Access
- **Has dashboard:** Yes
- **Dashboard shell:** `DashboardShell`
- **Sidebar items:** Overview, Branches (Create/View), Agents (View), Subscribers (View), Commissions, Reports, Settings

### Pages/Views Accessible
| View | Access | Notes |
|------|--------|-------|
| Map Overview | Full | Interactive Leaflet map with drill-down |
| Overlay Panel | Full | KPIs, entity lists, commission summary at every hierarchy level |
| Breadcrumb Navigation | Full | Country → Region → District → Branch → Agent |
| View Branches | Full | All ~321 branches, list + detail slide-in |
| Create Branch | Full | Multi-step form: Branch Details → Admin Details → Review |
| View Agents | Full | All ~2,046 agents, list + detail slide-in |
| View Subscribers | Full | All ~5,000 subscribers, list + detail slide-in |
| Commission Panel | Full | Home (rate card + Total/Settled/Outstanding summary + pending dues with Branch⇄Agent toggle + Download template + Upload settlement + settlement history), agents list, agent detail, subscribers |
| Reports Panel | Full | All 11 reports |
| Settings Panel | Full | Profile + password |
| AI Data Assistant | Full | Bottom card row chat widget |
| Top Bar | Full | Search, Filters (placeholder), Download (placeholder) |

### Data Scope
- **Visibility (since `0081`): its OWN network only.** The ownership edge is
  `branches.distributor_id` → `agents.branch_id` → `subscribers.agent_id`. A subscriber with
  `agent_id IS NULL` — employer-onboarded, or a direct signup — belongs to **no** distributor and is
  visible only to its employer, itself, and the super-admin.
  Enforced in RLS via three `SECURITY DEFINER` helpers (`distributor_branch_ids()`,
  `distributor_agent_ids()`, `distributor_subscriber_ids()`) across 12 tables, and in the
  `SECURITY DEFINER` rollup RPC by `0082` (RLS cannot reach a DEFINER function).
  Fails **closed**: a JWT without a `distributorId` claim matches nothing.
  > Before `0081` every `*_select_distributor` policy was a bare `app_role = 'distributor'` with no
  > ownership predicate, so any distributor could read the whole platform. That is why the Subscribers
  > page showed 5,062 while the Overview KPI (which always walked the agent tree) showed 5,004.
  **Closed by `0084` + `0094`** (verified live 2026-08-25): the blanket `*_select_authenticated`
  policy on `agents` / `branches` is gone. Each table now carries one policy per role
  (admin/distributor/branch/agent/subscriber; employer has none) plus a RESTRICTIVE
  `*_scope_distributor` overlay as a second gate.
- **Drill-down:** Country → Distributor → Region → District → Branch → Agent → Subscriber
- **Commission scope:** commissions whose `branch_id` is in the distributor's own branches
- **Distributor row.** `distributors` was readable by every authenticated role via
  `distributors_select`; `0081` split that into `distributors_select_admin` (full catalog, for the
  admin's ViewDistributors) and `distributors_select_self` (own row only), which is all Settings reads.
  `distributors_update_self USING (auth.jwt() ->> 'distributorId' = id)` is unchanged. See
  `BACKEND.md §8` and `docs/data-model.md`.

### Actions (CRUD)
| Action | Permission | Scope |
|--------|-----------|-------|
| View entities at any level | Read | All |
| Drill down through hierarchy | Read | All |
| Create branch | Create | Any district |
| Create agent | Create | Any branch (via branch dashboard pattern, but accessible from distributor too) |
| View agent commissions | Read | All agents |
| Set commission rate | Update | Global (flat rate-per-subscriber) |
| Apply settlement (template upload) | Update | Any agent's due commissions (`apply_settlement` → flips `due → paid`, records a settlement batch, notifies agent + branch) |
| Update own profile | Update | Own user |
| Change own password | Update | Own user |
| Search entities | Read | All entities (regions, districts, branches, agents) |

### Reports Available (11 of 11)
1. Distribution Summary
2. All Branches
3. All Agents
4. All Subscribers
5. Contributions & Collections
6. Withdrawals & Payouts
7. Branch Performance
8. Agent Performance
9. Subscriber Growth
10. Subscriber Demographics
11. KYC & Compliance

---

## Role 2: Branch Admin (`branch`) — BUILT

### Dashboard Access
- **Has dashboard:** Yes
- **Dashboard shell:** `BranchDashboardShell`
- **Sidebar items:** Overview, Agents (Create/View), Commissions, Reports, Settings
- **Scope provider:** `BranchScopeProvider` wraps dashboard with `branchId` from user session

### Pages/Views Accessible
| View | Access | Notes |
|------|--------|-------|
| Branch Overview | Full | Health score gauge, metrics, activity feed, alerts, copilot |
| Operations Section | Full | Agent leaderboard, commissions summary, demographics |
| Create Agent | Full | Multi-step form: Agent Details → Review |
| View Agents | Scoped | Only agents belonging to own branch |
| Commission Panel | Scoped | Only commissions for own branch's agents |
| Reports Panel | Partial | 8 of 11 reports (3 excluded) |
| Settings Panel | Full | Profile + password |
| Branch Copilot | Full | AI chat with branch-specific insights |

### Data Scope
- **Visibility:** Own branch entity, own branch's agents, own branch's subscribers
- **No drill-down:** Fixed to single-branch view (no map, no hierarchy navigation)
- **Commission scope:** Only commissions linked to own branch's agents
- **Branch ID source:** `user.branchId` from auth session (set at login)

### Actions (CRUD)
| Action | Permission | Scope |
|--------|-----------|-------|
| View own branch metrics | Read | Own branch |
| View own agents | Read | Own branch's agents |
| View own subscribers (via agents) | Read | Own branch's subscribers |
| Create agent | Create | Own branch |
| View own commissions + settlement history | Read | Own branch (read-only — branch no longer reviews/holds/settles; settlement is distributor-only via the upload flow) |
| View notifications | Read | Own branch's `commission_settled` notifications (notification bell) |
| Update own profile | Update | Own user |
| Change own password | Update | Own user |

### Reports Available (8 of 11)
1. ~~Distribution Summary~~ — EXCLUDED (network-level)
2. ~~All Branches~~ — EXCLUDED (multi-branch view)
3. All Agents (scoped to own branch)
4. All Subscribers (scoped to own branch)
5. Contributions & Collections (shows agents, not districts)
6. Withdrawals & Payouts (shows agents, not districts)
7. ~~Branch Performance~~ — EXCLUDED (network comparison)
8. Agent Performance (scoped to own branch)
9. Subscriber Growth (shows agents, not districts)
10. Subscriber Demographics (shows agents, not districts)
11. KYC & Compliance (shows agents, not districts)

### Excluded Reports (defined in `BRANCH_EXCLUDED_REPORTS`)
- `distribution-summary` — requires network-wide region data
- `all-branches` — shows all branches across network
- `branch-performance` — compares branches across network

### Split Mode
All slide-in panels use `splitMode={true}`:
- No backdrop overlay (content remains visible behind panel)
- Overview reflows with right padding to accommodate panel width
- On mobile: panels go full-screen regardless of splitMode

---

## Role 3: Subscriber (`subscriber`) — BUILT

### Dashboard Access
- **Has dashboard:** Yes
- **Dashboard shell:** `SubscriberDashboardShell` (mobile-first, routed pages with `<AnimatePresence>` page transitions)
- **Sidebar items (desktop SideNav):** Home, Save, Withdraw, Activity (redirects to AllTransactions report), Reports, Help, Agent, Settings
- **Mobile shell:** Bottom tab bar with 3 core tabs + "More" popover
- **Post-sign-in routing:** `SignInModal#handleVerify` routes purely by role — `hasDashboard(user.role)` sends a subscriber to `/dashboard`. There is no KYC/localStorage gate back to `/signup` (the former `isSignupComplete()` detour was removed).

### Pages/Views Accessible
| View | Access | Notes |
|------|--------|-------|
| Home (6 widgets) | Full | PulseCard balance, TopUp, Projection, IfYouNeedIt (desktop only), Activity (last 3), CoPilot |
| Save (multi-step) | Full | Pay-now contribution: amount + retirement split + method → confirm → success |
| Schedule | Full | Frequency + amount + split + yearly step-up + insurance tab via shared `SubscriberScheduleForm` (also used, with `showInsurance={false}`, by the agent schedule-edit pages) |
| Withdraw hub | Full | Choose savings withdrawal vs insurance claim |
| Withdraw → savings | Full | Bucket + amount + reason |
| Withdraw → claim | Full | Type + date + amount + description + **real File blob upload** (multipart-ready) |
| Projection | Full | 5 preset goals + Recharts trajectory chart from age-now to retirement |
| Reports hub + 5 reports | Full | All Transactions, Contributions Summary, Withdrawals History, Insurance Statement, Annual Statement — all with CSV export |
| Help | Full | FAQ + contact + chat with capped persistence |
| Agent (DM) | Full | Chat with assigned agent; capped at 100 persisted messages |
| Settings | Full | Profile, Nominees (pension + insurance), Insurance cover (with downgrade path) |
| Notifications, Security | Disabled | Show "Soon" badge; rows are non-interactive until built |

### Data Scope
- **Visibility:** Own subscriber record only (resolved server-side from authenticated phone/token)
- **No access to:** Other subscribers, agents, branches, commissions, or network data

### Actions (CRUD)
| Action | Permission | Scope |
|--------|-----------|-------|
| View own balance & contributions | Read | Own record |
| Make ad-hoc contribution | Create | Own record (`useMakeContribution`) |
| Update contribution schedule | Update | Own record (`useUpdateSchedule`) |
| Request withdrawal | Create | Own record (`useRequestWithdrawal`) |
| Submit insurance claim (with files) | Create | Own record (`useSubmitClaim`) |
| Update profile | Update | Own user (`useUpdateProfile` — optimistic + rollback) |
| Update nominees | Update | Own record (`useUpdateNominees` — optimistic + rollback) |
| Update insurance cover | Update | Own record (`useUpdateInsuranceCover`) — upgrade or downgrade-with-confirm |
| Message assigned agent | Create | Own record |
| View own statements / export CSV | Read | Own record (5 report views with `downloadCSV`) |

---

## Role 4: Employer (`employer`) — BUILT

> A B2B account managing a staff roster. **UNIFIED MODEL (migrations `0043`–`0045`):** an employer's staff ARE `subscribers` — real subscriber rows tagged via `subscribers.employer_id` (they get a subscriber identity + dashboard login). The standalone `employees` and `contribution_run_lines` tables that the original `0034` design used were **DROPPED by migration `0045`**; employer money now rides the normal `transactions` ledger (`transactions.source = 'employer'` + `transactions.contribution_run_id`, `agent_id` NULL ⇒ **NO agent commission**). Onboarding **shipped** as the invite-based KYC flow (`0046`/`0047`) — it is **no longer a "deferred placeholder."** The employer funds staff pension via **contribution runs** under the **compensation-driven two-leg model** (`0062`): the company-wide `employers.default_contribution_config` is applied to every tagged member, each leg derived from the member's `compensation`. Backend: migrations `0043`/`0044` (unification + RPCs), `0045` (retire `employees`), `0046`/`0047` (invite-based onboarding), `0048` (remove member), `0062` (contribution model v2); scoped by the `employerId` JWT claim.

### Dashboard Access
- **Has dashboard:** Yes
- **Dashboard shell:** `EmployerDashboardShell` (desktop-first, mirrors the Branch admin shell — indigo hero + icon-rail sidebar + slide-in panels; NOT the mobile-first routed Subscriber/Agent pattern)
- **Sidebar items:** Overview, Employees, Contribution Runs, Insurance, Reports, Support; footer Settings + Log out; plus an "Onboard staff" entry (SHIPPED — invite-based KYC flow, `0046`/`0047`)
- **Scope provider:** `EmployerScopeProvider` injects `employerId` (from `user.employerId`); `MissingEmployerIdScreen` if absent

### Pages/Views Accessible
| View | Access | Notes |
|------|--------|-------|
| Overview | Full | `EmployerHealthScore` hero (scheme-health/participation gauge, KPIs, activity, alerts, copilot) + notifications + operations |
| Employees (roster) | Scoped | Own staff only; search + status filter. Row → detail panel with balances, schedule, contribution history, insurance, nominees + a contribution-config editor + insurance editor |
| Contribution Runs | Scoped | History list → run detail (per-member employer/employee/total legs) + new-run wizard (period + method + live preview → confirm). The run applies the **company-wide** `default_contribution_config` (two-leg, compensation-driven; `0062`) to every active tagged member — posts to the normal `transactions` ledger (`source='employer'`/`'own'`, `agent_id` NULL). **No commission side-effects.** |
| Insurance / Benefits | Scoped | Company-wide oversight: covered count · total premium · per-member cover/status. Insurance is a **company-wide all-or-nothing** config (`insuranceEnabled`/`groupCoverAmount` on `default_contribution_config`); per-member `insuranceCover`/`insuranceStatus` are vestigial fields driven by the group config |
| Reports | Scoped | 4 reports — staff roster · contribution-runs summary · employer-vs-employee funding breakdown · staff balance growth (CSV/print) |
| Support | Scoped | Employer↔platform tickets — the employer **raises and replies** (composer); per-employee↔agent threading deferred |
| Settings | Full | Company profile + company-level default contribution config + password |
| Onboard staff | Full | Invite-based KYC flow (single + Excel bulk) — `create_employer_invite` (`0047`) mints a pending invite; the invitee completes KYC via `create_subscriber_from_employer_invite`, becoming a tagged subscriber |

### Data Scope
- **Visibility:** Own employer record + own staff roster + own contribution runs + own support tickets
- **No access to:** Other employers' staff, subscribers, agents, branches, commissions, or network data
- **Employer ID source:** `user.employerId` from the auth session (the `employerId` JWT claim); RLS auto-scopes every read

### Actions (CRUD)
| Action | Permission | Scope |
|--------|-----------|-------|
| View own roster + run history + metrics | Read | Own employer — reads over **tagged subscribers** (`employer_id` = caller's `employerId`) + own `contribution_runs` (`useEmployees` / `useContributionRuns` / `useEmployerMetrics`) |
| Submit a contribution run | Create | Own active tagged members (`useRunContribution` → **`submit_employer_contribution_run`**, `0062`; server derives both legs from each member's `compensation` via the company-wide config, nonce-idempotent, posts to the normal `transactions` ledger with `source='employer'`/`'own'`, `agent_id` NULL ⇒ no commission) |
| Edit a member's compensation | Update | Own tagged members (`update_employer_member_compensation`, `0062` — the driver field for the two-leg run) |
| Update company profile + company-wide default config (incl. group insurance) | Update | Own employer (`update_employer_profile`; `0056` folded group-cover application into the same atomic write) |
| Onboard staff | Create | Own employer — invite-based KYC (`create_employer_invite` `0047`; completed via `create_subscriber_from_employer_invite`, minting a tagged subscriber with `agent_id` NULL ⇒ no commission) |
| Remove a member from the company | Update | Own tagged members (`remove_employer_member`, `0048` — un-tags `employer_id → NULL`; `is_active` untouched, the person continues as an individual saver) |
| Change own password | Update | Own user |
| Raise / reply to support tickets | Create | Own employer↔platform threads |
| View commissions | — | **None** — employer-funded contributions carry `agent_id` NULL ⇒ generate no commissions |

### Scoping Implementation
`EmployerScopeProvider` injects `employerId` into context; reads route through `useEmployer*` hooks → `src/services/employer.js`. Under the unified model the roster lives in `subscribers` (tagged `employer_id`), so employer reads are scoped by the **`subscribers`/`transactions` RLS** plus the employer-family SELECT policies (`employers`, `contribution_runs`, `employer_invites`) keyed on `auth.jwt() ->> 'employerId'` — a read only ever returns the caller's own members + runs. **Writes go through the employer SECURITY DEFINER RPCs** (`0044`/`0048`/`0056`/`0062`; no client write policies), each re-checking ownership against the `employerId` claim. ⚠️ Measured 2026-08-23, re-confirmed 2026-08-25: "no client write policies" describes intent platform-wide, not the enforced state — RLS does not block direct client writes on every table. 13 direct-write successes were measured live on other tables (`transactions`, `insurance_policies`, `contribution_schedules`, `withdrawals`, `nominees`, `agents`, `branches`, `distributors`); see `docs/audits/2026-08-23/02-rls-matrix.md §5` and `CLAUDE.md §7`. Whether the employer-family tables themselves (`employers`, `contribution_runs`, `employer_invites`) also permit a direct client write has not been independently re-verified here. **`submit_employer_contribution_run`** (`0062`) derives both legs from each member's `compensation` and posts to the normal `transactions` ledger (`source='employer'`/`'own'`, `agent_id` NULL) — the balance trigger does the math; it writes no commissions. See `BACKEND.md §8`/§10.1 + `docs/data-model.md`.

---

## Role 5: Agent (`agent`) — BUILT

### Dashboard Access
- **Has dashboard:** Yes
- **Dashboard shell:** `AgentDashboardShell` (routed pages, mobile-first, modeled on Subscriber dashboard rather than slide-in panels)
- **Sidebar items (desktop SideNav):** Home, Subscribers, Commissions, featured "Onboard subscriber" indigo button, Settings, Logout
- **Mobile shell:** Bottom tab bar with Home / Subscribers / centered Onboard FAB / Commissions / "More" popover
- **Scope provider:** `AgentScopeProvider` wraps dashboard with `agentId` from auth session; `MissingAgentIdScreen` shown if missing.

### Pages/Views Accessible
| View | Access | Notes |
|------|--------|-------|
| Home | Full | `PortfolioPulseCard` + `CoPilotWidget` |
| Onboard (4-stage flow) | Full | Awareness check → KYC (reuses signup STEPS) → Schedule → Done |
| Subscribers list | Scoped | Own subscribers only; search + sort + active/dormant filter |
| Subscriber detail | Scoped | KYC pill + KPIs + schedule + **active insurance policies as product+status chips (Life/Health/Funeral · Active)**. Agents see WHICH policies are active but **NOT the cover amount or premium** (`0065` adds agent `SELECT` RLS on `subscriber_insurance_products`; `services/agent.js` builds `subscriber.policies` = product+status only) |
| Subscriber schedule edit | Scoped | Reuses the subscriber's own `SubscriberScheduleForm` with `showInsurance={false}` — the Insurance tab, its switches and the purchased-cover panel are all hidden, and the save payload omits every insurance key so the subscriber's flag is untouched (an agent can't authorise a premium for someone else — `fund_insurance_products` is subscriber-gated; insurance is the subscriber's own post-signup decision). Behind an `EditScheduleConsent` OTP gate for an existing schedule. The yearly step-up IS editable here (`contribution_indexation_pct` is PATCH-writable, unlike the RPC-locked funding-mode/target columns) |
| Analytics | Scoped | Recharts demographics + saving habits + onboarding velocity from agent's portfolio |
| Commissions home | Scoped | Earned (`paid`, grouped by paid month) + Owed (`due`) cards |
| Commissions sub-views | Scoped | `/commissions/:view` ∈ `{earned, owed}` (confirm + disputes removed) |
| Settings | Full | Profile + password (password change activates with backend) |

### Data Scope
- **Visibility:** Own agent record + own subscribers + own commissions
- **No access to:** Other agents, branch-level data, or network data
- **Insurance:** sees which active policies a subscriber holds (Life/Health/Funeral product + status) but **never the cover amount or premium**. Insured-vs-uninsured counts (Home) treat a subscriber as **insured if they hold ANY active policy — life, health OR funeral** (`isInsured` in `src/agent-dashboard/home/agentHomeSummary.js` returns true when the agent-facing `policies` list has any active product), so a health-only or funeral-only subscriber now counts as **insured** on Home (matching the product+status chips on their detail page). Null/absent policies (e.g. RLS-filtered on live) count as uninsured.

### Actions (CRUD)
| Action | Permission | Scope |
|--------|-----------|-------|
| View own subscribers | Read | Own subscribers (`useAgentSubscribers`) |
| Onboard new subscriber | Create | Under own agent ID (full 9-step KYC + schedule capture, incl. **multi-product insurance selection** — Life → `insurance_policies`, Health/Funeral → `subscriber_insurance_products`, persisted by the `0065` signup-chain re-emit) |
| Update subscriber's schedule | Update | Own subscribers (`useUpdateSubscriberSchedule` — optimistic + rollback over the agent's portfolio array) |
| View own commissions | Read | `useAgentCommissionDetail` (Earned / Owed only) |
| View notifications | Read | Own `commission_settled` notifications (notification bell) |
| Mark notifications read | Update | Own notifications (`useMarkNotificationsRead` → `mark_notifications_read`) |
| Update own profile | Update | Own user |
| Run analytics over portfolio | Read | Own subscribers (client-side derivation, no separate endpoint) |

### Commission Interaction
The agent is now a pure observer of commissions. Lines auto-generate as `due` on a subscriber's first contribution and flip to `paid` when the distributor applies a settlement upload. There is no confirm-receipt step and no dispute flow (both removed in `0029_commission_simplify.sql`); the agent is simply notified via the bell when their dues are settled.

---

## Role 6: Platform Admin (`admin`) — BUILT

> Head-office platform admin with global rights. Reuses the distributor's map-theme so the admin sees the whole network, and adds platform-wide Distributors & Employers managers. Demo login: Role Select → **Admin** → any phone → any 6-digit code (fallback persona `admin-001`).

### Dashboard Access
- **Dashboard shell:** `AdminDashboardShell` (`src/admin-dashboard/`) — clones the distributor map shell (Leaflet drill-down + overlay chrome) with `AdminSidebar`, wrapped in `DashboardProvider` → `AdminPanelProvider`.
- **Reused verbatim from `src/dashboard/`:** `UgandaMap`, `MetricsRow`, `OverlayPanel`/`Breadcrumb`/`TopBar`, and the `ViewBranches` / `ViewAgents` / `ViewSubscribers` / `ViewReports` / `CommissionPanel` / `Settings` / `ViewTickets` / `CreateBranch` panels — they are role-blind (RLS scopes data) and admin holds the SELECT grants.

### Pages/Views Accessible
| View | Access | Notes |
|------|--------|-------|
| National Overview (map) | Full | Country→region→district→branch→agent drill-down + platform KPIs (AUM, subscribers, agents, branches). **Platform scope filter (All / Distributors / Employers)** partitions the overview card + the activity strip by channel (`get_platform_overview`'s `byChannel` split, `0058`; `get_employer_activity_rollup`, `0059`); the district drill-down bifurcates into `[Branches \| Employers]` tabs, with employers placed on the map via `get_employer_geo_rollup` (`0058`) |
| Distributors | Full | Slide-in list of all distributors + platform KPI strip; **+ New Distributor** create form (`ViewDistributors` / `CreateDistributor`) |
| Employers | Full | Slide-in list of all employers with per-employer rollup (members/active/AUM/contributed/insured); **+ New Employer** create form (`ViewEmployers` / `CreateEmployer`) |
| Branches / Agents / Subscribers / Reports / Commissions / Support / Settings | Full | Reused distributor panels, unscoped (platform-wide) |

### Data Scope
- **Visibility:** All data across the entire platform — `*_select_admin` RLS policies (migration `0049`) clone the distributor "see-everything" grants (`USING (auth.jwt() ->> 'app_role' = 'admin')`) on the subscriber/commission tables, plus admin SELECT on the employer family (`employers`, `contribution_runs`, `employer_invites` — NOT `contribution_run_lines`, which was dropped by `0045` and does not exist live). Reference tables (`regions`/`districts`/`branches`/`agents`) are authenticated-readable; `distributors` is readable only by admin (`distributors_select_admin`) and the owning distributor (`distributors_select_self`) — see "Data Scoping Rules Summary" below.
- **No scope claim:** there is no `adminId` filter in any read policy — admin sees all rows.

### Actions (CRUD)
| Action | Permission | Scope |
|--------|-----------|-------|
| View all platform data | Read | Everything (map, branches, agents, subscribers, commissions, reports) |
| Create distributor | Create | `create_distributor` RPC (admin-gated SECURITY DEFINER, `0049`) |
| Create employer | Create | `create_employer` RPC (admin-gated SECURITY DEFINER, `0049`) |
| View all-employers rollup | Read | `get_all_employers_metrics` RPC (admin-gated, `0049`; re-emitted by `0060` to add each employer's `status`) |
| Set the commission rate | Update | `set_commission_rate` RPC. **Per-distributor since `0089`** — a distributor upserts its OWN `commission_config` row (`distributor_id`); the admin edits the platform fallback (`id='default'`), used by any distributor without a row. The direct-UPDATE RLS grant is dropped, so no operator can change another's rate. Never retroactive: the amount is stamped onto the `commissions` row when it is generated on first contribution |
| Deactivate / reactivate a distributor | Update | `set_distributor_status` RPC (admin-gated SECURITY DEFINER, `0060`; made reversible by `0080`) — flips the distributor + its branches + its agents between `active`/`inactive`; on deactivate also detaches every subscriber under the distributor's agent tree (`agent_id → NULL`; `is_active` untouched). **Reversible since `0080`:** the detach and the prior branch/agent statuses are journalled, and reactivate replays them |
| Deactivate / reactivate an employer | Update | `set_employer_status` RPC (admin-gated SECURITY DEFINER, `0060`; made reversible by `0080`) — flips `employers.status`; on deactivate detaches every member (`employer_id → NULL`), journalled so reactivate restores the roster |
| Filter platform overview by channel | Read | All / Distributors / Employers scope filter (`get_platform_overview` `byChannel`, `0058`; `get_employer_activity_rollup`, `0059`; `get_employer_geo_rollup`, `0058`) |
| Reused distributor actions (create branch, settle commissions, etc.) | As distributor | Inherited from the reused panels |

> **Enforcement of deactivation:** a deactivated agent/branch/distributor/employer cannot obtain a JWT (login gate in `verify-otp`/`verify-password` via `_lib/entity-status.ts` → `403 account_deactivated`), and a deactivated employer cannot admit new members or submit contribution runs (BEFORE-INSERT/UPDATE triggers, `0060`/`0061`).
> **Demo scope:** no audit-log / compliance / KYC-queue / user-management features (intentional — see `CLAUDE.md §10a`). Admin is **view + create + deactivate/reactivate** for distributors/employers.

---

## Data Scoping Rules Summary

| Role | Entity Visibility | Commission Visibility | Report Scope |
|------|------------------|----------------------|--------------|
| distributor | Its OWN network only since `0081` (`branches.distributor_id → agents.branch_id → subscribers.agent_id`); a subscriber with `agent_id IS NULL` belongs to no distributor | Own-network commissions (set rate + apply settlement uploads) | All 11 reports, network-scoped |
| branch | Own branch + own agents + own subscribers | Own branch's commissions (read-only) | 8 reports, branch-scoped |
| agent | Own record + own subscribers | Own commissions (read-only — Earned / Owed) | Client-side analytics over own portfolio |
| subscriber | Own record only | None | 5 own-account reports (transactions, contributions, withdrawals, insurance, annual) |
| employer | Own employer + own tagged-subscriber roster (`subscribers.employer_id`) + own contribution runs (no access to other employers' members, agents, or branches) | None (employer-funded contributions carry `agent_id` NULL ⇒ no commissions) | 4 own-org reports (staff roster, runs summary, funding breakdown, balance growth) |
| admin | All entities, all levels (incl. all distributors + all employers) | All commissions | All reports, all scopes |

⚠️ **No role except admin and the owning distributor can read `distributors`** (verified live 2026-08-25 — see the corrected rows above and "Scoping Implementation" below). Any "Operated by …" attribution surface for branch / agent / subscriber / employer renders empty (A02-007). The rows above previously claimed a read-only singleton-`distributors` fallback for branch/agent/subscriber; that was measured false (0 rows returned for all three) and has been removed.

### Scoping Implementation
- **Distributor:** Scoped to its own network by three `SECURITY DEFINER` helpers (`distributor_branch_ids()`, `distributor_agent_ids()`, `distributor_subscriber_ids()`) across 12 tables (`0081`–`0089`), plus RESTRICTIVE `*_scope_distributor` overlays on `agents`/`branches` (`0084`). Fails closed on a missing `distributorId` claim. `distributors_update_self` separately restricts UPDATE on the `distributors` table itself to `auth.jwt() ->> 'distributorId' = id` — each of the three seeded distributors (`d-001`/`d-002`/`d-003`) edits only its own row.
- **Only admin and the owning distributor read `distributors`:** `distributors_select_admin` + `distributors_select_self` (`0081`). There is no blanket `USING (true)` policy on this table.
- **Branch:** `BranchScopeProvider` injects `branchId` into context. Report views check `useBranchScope()` and filter data accordingly. Commission endpoints receive `branchId` parameter.
- **Agent:** `AgentScopeProvider` injects `agentId`. `useAgentSubscribers(agentId)` and commission hooks scope automatically. The auth `user.agentId` comes from the backend's `verifyOtp` response — the client no longer injects it.
- **Subscriber:** `useCurrentSubscriber()` resolves from authenticated phone (server-side); subscriber is the implicit "self" in every endpoint under `/api/subscribers/me/*`.
- **Employer:** `EmployerScopeProvider` injects `employerId` from the auth session (the `employerId` JWT claim). Under the unified model (`0043`–`0045`) the roster lives in `subscribers` (tagged `employer_id`); reads auto-scope via the `subscribers`/`transactions` RLS + the employer-family SELECT policies keyed on `auth.jwt() ->> 'employerId'`; writes go through the employer SECURITY DEFINER RPCs (`0044`/`0048`/`0056`/`0062`), which re-check ownership.
- **Admin:** No scoping — `*_select_admin` RLS policies (migration `0049`) mirror the distributor "see-everything" grants plus admin SELECT on the employer family. Writes (create distributor/employer) go through admin-gated SECURITY DEFINER RPCs. No scope provider — the admin shell reuses the distributor map/panels directly.

### Backend Enforcement
The frontend applies scoping via:
1. Conditional component rendering (role-based shell selection)
2. Prop passing (branchId to panels and reports)
3. Query filtering in hooks (enabled flags)

**The backend MUST enforce the same scoping rules server-side.** The frontend scoping is a UX convenience, not a security boundary. Every API endpoint should verify that the authenticated user has permission to access the requested data based on their role and scope.
