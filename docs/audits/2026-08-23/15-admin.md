# A15 · Admin — Phase 3 Browser Walkthrough

**Role:** Platform Admin (`admin-001`, head office) · **Signed in via the REAL UI** at `/admin/login`
(phone `+256700000041` → any 6-digit OTP `123456`; no token injected).
**Viewports:** 375 (mobile shell), 1440 (desktop shell), plus the 768/900/1023/1024 band.
**Dev servers:** Vite `:5173`, Express `:3001` (`/readyz` `{"ok":true}`), shared LIVE Supabase
`ilkhfnoyxlxwqadebnkp`. All figures reconciled against direct `psql`.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 35 (22 mobile routes @375 + 13 desktop surfaces @1440) |
| Artifacts examined | 35 |
| Coverage | 100% |
| Checks defined | 26 |
| Checks executed | 26 |
| Checks passed / failed / blocked | 22 / 4 / 0 |
| Findings C / H / M / L / I | 0 / 1 / 2 / 1 / 1 |
| Evidence commands run | 24 |
| Excluded as demo-scope | 3 (support tickets in-memory store; mock OTP accepted; cosmetic mobile-money — none reported) |
| Blocked, with reason | none |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Desktop panels walked (Overview, Distributors, Employers, Subscribers, Access requests, Nominee claims, Unit price, Support, Reports, Settings, Reconciliation drill) | 11 / 11 |
| Mobile routes walked @375 | 22 / 22 |
| Routes rendering with a console error | 0 |
| Route×viewport cells with a horizontal-overflow break | 0 |
| Hero / panel numbers reconciled to SQL | 8 (AUM, subscribers, active, agents, branches, distributors, employers, contributions) — all MATCH |
| Highest-stakes write viewed but NOT executed | NAV publish (projection verified, no snapshot published); Create Distributor + Create Employer modals (viewed, not submitted); access-request approve/deny (viewed, not clicked) |
| Committed writes left behind | 0 (no writes performed) |

**No fixture rows were created and nothing was written to the live DB during this walkthrough.**
Every write surface (NAV publish, Create Distributor/Employer, access-request approve, reconciliation
"Escalate", ticket reply) was VIEWED only; the projected-AUM math was verified by typing a price into
the form (a client-side calc) and reading the projection line — the "Publish price" button was never
clicked.

---

## 1. Sign-in (real UI)

`/admin/login` → `PhoneEntry` (phone `+256700000041`, stripped to `700000041`) → `Send verification
code` → `OtpVerify` (any 6 digits) → `Verify & sign in` → lands on `/dashboard` in ~2 s. Clean, no
console errors. (`scratch/a15-01-login-hero.mjs`.) Deep-links after login survive a hard refresh —
every mobile route below was reached by direct `page.goto`, which is equivalent to a cold refresh, and
all restored their screen.

## 2. Desktop hero — numbers reconciled to SQL  (source of A22-001, verified CORRECT for admin)

Screenshot: `screenshots/admin/index-1440.png`.

Hero renders: **FUNDS UNDER MANAGEMENT UGX 2.45B · CONTRIBUTIONS UGX 2.00B 87% · SUBSCRIBERS 5,064
(3,968 active · 78%) · AGENTS 2,046 Across 321 branches · Platform Health Score 78 Strong · 3
distributors · 8 employers.**

```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT (SELECT count(*) FROM subscribers),
  (SELECT count(*) FILTER (WHERE is_active) FROM subscribers), (SELECT count(*) FROM distributors),
  (SELECT count(*) FROM employers), (SELECT count(*) FROM branches), (SELECT count(*) FROM agents),
  (SELECT COALESCE(sum(b.total_balance),0) FROM subscriber_balances b JOIN subscribers s ON s.id=b.subscriber_id);"
5064|3968|3|8|321|2046|2450226487        # AUM = 2.4502B ≈ 2.45B ✓
# contributions: 2.0038B ≈ 2.00B ✓
```

**Every headline figure matches the live DB.** Per the task brief this is the *source* figure that
A22-001 shows bleeding into distributor d-002's cache — but on the ADMIN surface it is correct.
Recorded here as **A15-005 (info)** so the source screenshot is traceable; no admin-side defect.

## 3. Desktop panels — all render, all counts reconciled

| Panel | On-screen | SQL check | Verdict |
|---|---|---|---|
| Distributor Network | 3 distributors · Branches 321 · Agents 2,046 | 3 / 321 / 2046 | ✓ |
| Employers | 8 employers · 58 members · 287.9M contributed | 8 / 58 | ✓ |
| Subscribers | 5,064 subscribers | 5064 | ✓ |
| Access requests | 4 awaiting | `access_requests` pending = 4 | ✓ |
| Nominee claims | 6 Awaiting review | `nominee_claims` pending = 6 | ✓ |
| Support | 15 tickets · OPEN 9 · CLOSED 6 | (in-memory demo store) | ✓ |
| Reports | Distribution Summary / rosters / contributions | renders | ✓ |
| Settings | Platform Admin · change-password form | renders | ✓ |

Screens: `screenshots/admin/desktop-{distributors,employers,subscribers,access-requests,nominee-claims,support,reports,settings}-1440.png`. Zero console errors on every panel.

## 4. NAV "Unit price" — highest-stakes admin action (viewed, not published)

Screens: `desktop-nav-1440.png`, `desktop-nav-projection-1440.png`. Typed a test price `1500` to
exercise the projection; **did not publish**.

- UNIT TODAY **UGX 1,571.40** (as at 8 Aug 2026) = `aum / unitsInIssue` = 2450226487 / 1559263.4 = 1571.4 ✓
- MONEY IN THE FUND **UGX 2.45B** ✓ · UNITS IN ISSUE **1,559,263** ✓
- Typing 1500 → *"That's down 4.54% from UGX 1,571.40 … The fund would move to **UGX 2.34B**."*
  ```
  $ psql ... -c "SELECT round((get_nav_overview()->>'unitsInIssue')::numeric * 1500);"
  2338895093        # 2.34B ✓  — projection math is correct
  ```
The projected-AUM math is exact and the form is a deliberate, non-optimistic money surface (explicit
confirm modal on large moves). PASS.

> Side-note (already owned by NAV/A06): the NAV page reads *"Held by 5,060 members"* / *"Across 5,059
> members"* against a platform of 5,064 subscribers — the 5064-vs-5060 balances gap surfacing. Not
> re-raised here; see A06.

## 5. Needs Attention — the 10-signal card + reconciliation drill  → FINDING A15-003

Screens: `desktop-overview-attention-1440.png`, `desktop-reconciliation-drill-1440.png`,
`m-attention-reconciliation-375.png`.

The card renders **"10 TO ACTION"** with all ten signals, each reconciled to `get_admin_attention()`:
Dormant 1,096 · Delayed employer transfers 4 · Delayed NAV 4 · Pending complaints 9 · Pending access
4 · Underperforming distributors 1 · Delayed insurance payouts 12 · Delayed withdrawals 15 · Delayed
custody transfers 4 · **Reconciliation 7 (4 member · 3 transaction)**.

Drilling into Reconciliation shows **OPEN EXCEPTIONS 7** — and the queue is polluted (A15-003, below).

## 6. Create Distributor / Create Employer (viewed, not submitted) · Scope filter · Map view

- Create-Distributor and Create-Employer modals open cleanly (`desktop-create-distributor-1440.png`,
  `desktop-create-employer-1440.png`); closed via Escape without submitting.
- Platform scope filter — the country Summary card's pills **All data / Distributors / Employers**
  (rendered in Map view) re-scope the metrics. Channel AUMs verified: distributor **2.125B**, employer
  **325.2M**, direct **0** (`desktop-mapscope-*.png`, `desktop-mapview-1440.png`). PASS.

## 7. Mobile route sweep @375 — 22/22 render, 0 console errors

`scratch/a15-06-mobile-sweep.mjs` deep-linked every route (cold-refresh equivalent). All 22 rendered
and restored on refresh; `menu`, `network`, `attention/:type`, and all `:id` detail routes work:

```
index, distributors, distributors/d-001, employers, employers/emp-001, access-requests, nav,
nominee-claims, attention/reconciliation, network, branches, branches/b-kam-015, agents, agents/a-001,
subscribers, subscribers/s-0001, reports, reports/distribution-summary, support, support/tk-emp-002,
settings, menu  →  all "ok", 0 console errors
```

Detail-route money reconciled: agent a-001 (SUBS 11 / CONTRIB 5.0M / FUM 5.2M ✓), branch b-kam-015
(FUM 13.6M ✓), employer emp-001 (MEMBERS 21 / FUM 197.5M / CONTRIB 182.7M ✓), distributor d-001
("network figures are platform-wide" — by design). **Only the SUBSCRIBER detail is broken (A15-001).**

---

## FINDINGS

### A15-001 · HIGH · confirmed — Mobile subscriber detail shows every member's Balance / Contributions / Withdrawals as "—" (real money hidden)

- **location:** `src/dashboard/mobile/SubscriberDetailMobile.jsx:11-12,73-75` (`subBalance()` + KPI row) — root cause co-located in `src/services/entities.js` `getEntity()` (:377 `SELECT '*'`, no balance embed) and `mapSubscriber()` (`totalContributions`/`totalWithdrawals` have no source column → always 0). Route `/dashboard/subscribers/:subscriberId` on the **mobile shell** (<1024px), shared by **admin, distributor, branch**.
- **evidence:**
  ```
  # DB — this member has real money
  $ psql ... -c "SELECT id,name,total_balance FROM subscribers s JOIN subscriber_balances b ON b.subscriber_id=s.id WHERE id IN ('empe-001','s-0001');"
  empe-001|Brian Okello|24471589        # 24.5M
  s-0001|Carol Obua|1411092             # 1.41M

  # UI — list-click path (a15-08) AND cold deep-link (a15-07), both @375:
  DETAIL @0.8s (router state): BALANCE — CONTRIBUTIONS — WITHDRAWALS —
  DETAIL @5s  (after refetch): BALANCE — CONTRIBUTIONS — WITHDRAWALS —     (URL .../subscribers/empe-001)
  subscriber-detail s-0001 @5s: BALANCE — CONTRIBUTIONS — WITHDRAWALS —
  ```
  The mobile list itself is correct (`5,064 · 3,968 Active · 2.45B`; "Brian Okello … 24.5M"), and the
  **desktop** detail is correct (`a15-09`: *"BALANCE UGX 24.5M TOTAL CONTRIBUTIONS UGX 22.4M"*) — it
  uses `totalBalance || (contrib − withdraw)` plus a per-subscriber lifetime fetch (`ViewSubscribers.jsx:43,85`).
  The mobile detail uses only `subBalance() = totalContributions − totalWithdrawals`, and those two
  aggregates are never populated on any read path (no column on `subscribers`/`subscriber_balances`);
  `formatUGX(0)` returns `"—"` (`utils/currency.js:32`). Screenshots
  `screenshots/admin/m-subscriber-detail-375.png`, `m-subscriber-detail-fromlist-375.png`.
- **impact:** WRONG / MISSING MONEY on a supported viewport. A sales rep on a phone tapping *any*
  member to "show their savings" gets **Balance —, Contributions —, Withdrawals —** for members who
  hold millions — on the admin, distributor, and branch dashboards alike. The list says 24.5M; the
  detail says nothing. Borders critical for a live phone demo; rated HIGH because it is an absence
  ("—"), not a fabricated positive figure, and desktop is unaffected.
- **repro:** @375 sign in as admin → Subscribers → tap "Brian Okello" (or open `/dashboard/subscribers/empe-001`) → the Balance/Contributions/Withdrawals row shows "—".
- **suggested_fix:** in `SubscriberDetailMobile` render `formatUGX(sub.totalBalance)` for Balance and add the same id-bounded lifetime fetch the desktop `ViewSubscribers` already does for contributions/withdrawals; and/or have `getEntity('subscriber', id)` embed `subscriber_balances(total_balance)` so a cold deep-link is populated too.

### A15-002 · MEDIUM · confirmed — Admin platform hero has no error/retry state; a failed money read renders "—" / 0 / "Needs work" silently (admin manifestation of A22-002)

- **location:** shared dashboard hero + `AdminOverview`/`AdminCountryOverview`; reads `get_platform_overview` (`src/services/entities.js:1279`) and `get_entity_metrics_rollup`; no `QueryCache.onError` (`src/main.jsx`).
- **evidence:** `scratch/a15-05-hero-fail.mjs` — logged in with the read working, then `page.route('**/rpc/get_platform_overview*', abort)` + reload:
  ```
  HERO on failed read: FUNDS UNDER MANAGEMENT — · 0 distributors · 0 employers · CONTRIBUTIONS — ·
                       SUBSCRIBERS 0 · 0 active · 0% · AGENTS 0 Across 0 branches · Health Score 0 Needs work
  has "unavailable": false   has "retry": false   role=status/alert count: 0
  ```
  Screenshot `screenshots/admin/desktop-hero-read-fail-1440.png`.
- **impact:** if the admin's platform overview read fails (or during the cold-restore window the
  baseline documents), the hero silently reports a UGX 0 / 0-subscriber / "Needs work" platform with
  no message and no retry — indistinguishable from a genuinely empty platform. The one `role=status`
  "Metrics unavailable" badge exists only on the secondary Summary card in Map view, not on the
  mounted hero. Cross-ref A22-002 (which owns the shared-hero fix); reported here as the confirmed
  admin-surface reproduction.
- **repro:** admin `/dashboard`, block `get_platform_overview`, reload → hero shows "—"/0 with no error affordance.
- **suggested_fix:** give the shared hero an `isError` branch (message + Retry→`refetch()`); add a global `QueryCache.onError` toast.

### A15-003 · MEDIUM · confirmed — Reconciliation queue shows leftover test-fixture rows ("TST tree member", etc.) in the live admin drill (admin surface of A06)

- **location:** `v_reconciliation_exceptions` → `get_admin_attention` reconciliation drill (`AdminAttentionDesktop` / `attention/reconciliation`).
- **evidence:**
  ```
  $ psql ... -c "SELECT * FROM v_reconciliation_exceptions;"
  user|missing_balance|Member has no balance record|tst-sub-tree-msc7vzsc|TST tree member|...
  user|missing_balance|Member has no balance record|tst-sub-emp-msc7vzsc|TST employer member|...
  user|missing_balance|Member has no balance record|tst-sub-retag-msc7vzsc|TST retag probe|...
  user|missing_balance|Member has no balance record|tst-sub-tree-msd3855c|TST tree member|...
  transaction|agent_mismatch|...|t-demo-recon-1|Denis Byaruhanga|s-0701|45000|2026-07-25
  transaction|agent_mismatch|...|t-demo-recon-2|Grace Asiimwe|s-0702|62000|2026-07-21
  transaction|agent_mismatch|...|t-demo-recon-3|Denis Byaruhanga|s-0703|38000|2026-07-17
  ```
  On screen (`screenshots/admin/desktop-reconciliation-drill-1440.png`): **OPEN EXCEPTIONS 7**, rows
  literally named *"TST employer member — Member has no balance record"*, *"TST tree member"*, *"TST
  retag probe"* alongside the 3 intended demo rows. These 4 `tst-*` orphans are exactly the
  subscribers 5064 vs balances 5060 gap from the baseline.
- **impact:** an admin drilling into Reconciliation during a demo sees test-harness debris ("TST … probe")
  in a finance-facing exception queue — a credibility hit and a data-hygiene leak into live demo data.
  Cross-ref A06 (which owns the 4-row orphan cleanup); reported here as the confirmed admin-surface view.
- **repro:** admin → Needs attention → Reconciliation issues → 7 rows, 4 named "TST …".
- **suggested_fix:** delete the 4 `tst-sub-*` subscribers (and any orphaned rows) left by prior test runs; they should never have been committed to the shared live DB.

### A15-004 · LOW · confirmed — Mobile Agents list flashes "0 Subscribers · 0 Funds" before per-agent metrics resolve

- **location:** `src/dashboard/mobile/AgentsMobile.jsx:71-75` (totals reduce over `a.metrics?.totalSubscribers`/`aum`); the `isLoading && agentsRaw.length===0` guard (:80) doesn't cover the window where agent rows have loaded but their metrics have not.
- **evidence:** `scratch/a15-06` (@1.6s) vs `a15-07` (@5s), @375:
  ```
  @1.6s: "2,046 Agents  0 Subscribers  0 Funds" … "Dorothy Kiiza … 0 subs"
  @5s:   "2,046 Agents  5,001 Subscribers  2.12B Funds" … "Beatrice Mugisha … 12 subs"
  ```
  (SQL: subs-via-agent = 5,001; agent-channel AUM = 2.125B.) `screenshots/admin/m-agents-375.png` vs `m-agents-deep-375.png`.
- **impact:** transient, self-correcting (~1-3 s on the shared remote DB) but shows a "0 Funds" money
  figure on first paint of the Agents tab — a brief wrong-zero a rep could hit mid-demo.
- **repro:** @375 admin → Agents; header reads "0 Subscribers 0 Funds" for ~1-3 s, then corrects.
- **suggested_fix:** show a skeleton/placeholder (e.g. "—") for the totals strip and per-row subs until `metrics` is present, rather than defaulting to `0`.

### A15-005 · INFO · confirmed — Admin hero UGX 2.45B / 321 branches is correct (source figure for A22-001)

- **location:** admin `/dashboard` hero.
- **evidence:** §2 above — every figure matches SQL. Screenshot `screenshots/admin/index-1440.png`.
- **impact:** none on the admin surface; recorded so the A22-001 source screenshot is traceable. The
  cross-tenant bleed into distributor d-002 is A22-001's finding, not an admin-side defect.

---

## Responsive band 769–1023 (task-flagged)

`useIsDesktop` = `min-width:1024px`; `useIsMobile` = `max-width:768px`. The shell picks
`isDesktop ? AdminDesktopShell : AdminMobileShell`, so 769–1023 renders the **mobile shell** while
`useIsMobile` is false internally. Tested 768 / 900 / 1023 / 1024 (`a15-13`, `screenshots/admin/band-index-*.png`):

| Width | Shell | Horizontal overflow | Console errors | Hero |
|---|---|---|---|---|
| 768 | mobile | none | 0 | UGX 2.45B |
| 900 | mobile | none | 0 | UGX 2.45B |
| 1023 | mobile | none | 0 | UGX 2.45B |
| 1024 | desktop (sidebar) | none | 0 | full rail |

The mobile shell scales cleanly to 1023 and hands off to the desktop rail at 1024 — **no band defect
for admin.** PASS.

---

## Traceability (checks → disposition)

| # | Check | Disposition |
|---|---|---|
| 1 | Admin sign-in via real UI (`/admin/login`, phone+OTP) | PASS |
| 2 | Desktop index hero numbers vs SQL (AUM/subs/active/agents/branches/dist/emp/contrib) | PASS (A15-005 info) |
| 3 | Desktop Distributor Network panel + counts (3/321/2046) | PASS |
| 4 | Desktop Employers panel (8/58) | PASS |
| 5 | Desktop Subscribers panel (5064) | PASS |
| 6 | Desktop Access requests (4 pending) | PASS |
| 7 | Desktop Nominee claims (6 pending) | PASS |
| 8 | Desktop NAV publish form + projection math (view-only) | PASS |
| 9 | Desktop Support panel (15/9/6) | PASS |
| 10 | Desktop Reports panel | PASS |
| 11 | Desktop Settings panel | PASS |
| 12 | Needs Attention 10-signal card counts vs `get_admin_attention` | PASS |
| 13 | Reconciliation drill contents | FINDING A15-003 |
| 14 | Create Distributor modal opens (view-only) | PASS |
| 15 | Create Employer modal opens (view-only) | PASS |
| 16 | Scope filter All/Distributors/Employers re-scopes (channel AUMs) | PASS |
| 17 | Map view renders | PASS |
| 18 | Hero error state on read failure (route-abort) | FINDING A15-002 |
| 19 | Mobile 22-route sweep renders, 0 console errors | PASS |
| 20 | Mobile subscriber detail money correctness | FINDING A15-001 |
| 21 | Mobile agent/branch/employer/distributor detail money correctness | PASS |
| 22 | Mobile reports/:reportId + support/:ticketId render | PASS |
| 23 | Deep-link / hard-refresh restores mobile screen | PASS |
| 24 | Responsive band 769–1023 (768/900/1023/1024): overflow/errors/shell | PASS |
| 25 | Mobile Agents list totals loading state | FINDING A15-004 |
| 26 | A22-001 source figure (admin hero) verified correct for admin scope | PASS (A15-005 info) |

### Route × viewport cells
| Surface | 375 | 1440 | band 768–1024 |
|---|---|---|---|
| index / overview / hero | ✓ | ✓ (A15-005) | ✓ |
| distributors + distributors/:id | ✓ | ✓ | — |
| employers + employers/:id | ✓ | ✓ | — |
| subscribers | ✓ | ✓ | — |
| subscribers/:id | **A15-001** | ✓ (correct) | — |
| access-requests | ✓ | ✓ | — |
| nav (Unit price) | ✓ | ✓ | — |
| nominee-claims | ✓ | ✓ | — |
| attention/:type + reconciliation drill | ✓ | **A15-003** | — |
| network | ✓ | (map) | — |
| branches + branches/:id | ✓ | ✓ | — |
| agents | **A15-004** | ✓ | — |
| agents/:id | ✓ | ✓ | — |
| reports + reports/:reportId | ✓ | ✓ | — |
| support + support/:ticketId | ✓ | ✓ | — |
| settings · menu | ✓ | ✓ | — |
| hero read-failure | — | **A15-002** | — |

## Excluded as demo-scope (not reported)
- Support tickets in a per-session in-memory store (`src/services/tickets.js`) — no vanishing-ticket
  demo break observed on the admin oversight view.
- Any 6-digit OTP accepted / no real SMS — used it to sign in; by design.
- Cosmetic mobile-money pickers — none on admin surfaces.

## Cleanup
No fixture rows created; no writes committed. Throwaway scripts under
`docs/audits/2026-08-23/scratch/a15-*.mjs`; screenshots under
`docs/audits/2026-08-23/screenshots/admin/`. The A15 harness (`a15-lib.mjs`) injects no token and
performs no writes.
