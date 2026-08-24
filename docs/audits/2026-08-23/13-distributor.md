# A13 · Distributor — Phase 3 browser walkthrough

**Agent:** A13 (distributor). **Method:** real-UI sign-in (no token injection), headless Chromium
(Playwright 1.60), viewports 375 / 768 / 1024 / 1440. Live dev servers (Vite :5173, API :3001),
shared live Supabase `ilkhfnoyxlxwqadebnkp`. Every on-screen number cross-checked against direct
`psql` on `$SUPABASE_DB_URL`. Report-only.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 20 (14 distributor mobile routes + desktop shell: map/overview/reports-panel/commissions-panel/settings/geo-drill) |
| Artifacts examined | 18 |
| Coverage | 90% |
| Checks defined | 26 |
| Checks executed | 24 |
| Checks passed / failed / blocked | 20 / 3 / 1 |
| Findings C / H / M / L / I | 0 / 1 / 0 / 2 / 2 (own) + 4 on-screen verifications of prior findings |
| Evidence commands run | 22 |
| Excluded as demo-scope | 1 (settlement UPLOAD write — would commit to shared live DB; A05-004/005 replay bugs already proven by A05 via BEGIN…ROLLBACK) |
| Blocked, with reason | 1 (A05-004/005 on-screen write-repro — cannot commit writes; verified via code + A05's rolled-back proofs) |

**Domain metrics:** routes walked = 14/14 (mobile) + desktop panels; viewports = 375/768/1024/1440;
report views enumerated = 11/11; CSV exports triggered = 2 (both downloaded); settlement template
downloads = 1 (valid XLSX); committed live writes = **0** (see cleanup).

## Live-write disclosure & cleanup
- My UI OTP logins upserted **one** `users` row (`admin:+256700000041`, created today by the A22-001
  admin login). **Deleted** it: `users` 50→49. Verified gone.
- One other today-dated row (`subscriber:+256701945855`, 12:13:23) is a **concurrent agent's**
  fixture, not mine — left for its owner (baseline was 48; residual +1 is not A13's).
- No settlement upload, no contribution, no other write was committed. CSV/XLSX downloads are
  read-only. `git status`: only `docs/audits/2026-08-23/` + the sanctioned `@axe-core/playwright`
  devDependency. No product code / SQL / config touched.

---

## Ground truth (psql, for reconciliation)
| Scope | AUM | branches | agents | subscribers |
|---|---|---|---|---|
| Platform (all) | 2,450,226,487 | 321 | 2,046 | 5,064 (balances 5,060) |
| **d-001** (National, RLS-scoped) | 1,954,892,232 | 291 | 1,872 | 4,602 |
| **d-002** (Secondary/Busoga) | 170,104,155 | 27 | 171 | 399 |
| Central region under d-001 | 712,312,004 | 69 | 437 | 1,701 |

Every on-screen figure below **matched** these. RLS scoping is correct at the RPC layer
(`get_entity_metrics_rollup` returns 170.1M/27 for d-002 and 1.95B/291 for d-001 when queried fresh).

---

## FINDINGS

### A13-001 · HIGH · confirmed — Distributor **Reports** route is unreachable on every viewport below 1024px; the Menu "Reports" tile and both routed report screens are dead
**This is the pre-registered CRITICAL (`00b-preregistered-distributor-reports.md`), now reproduced at runtime.**

- **Location:** `src/contexts/DashboardNavContext.jsx:92` (missing `!isDesktop` guard on the
  distributor arm) → redirect effect at `:110-116`. Orphans `src/dashboard/mobile/ReportsMobile.jsx`,
  `ReportViewMobile.jsx`, the routes `DistributorMobileShell.jsx:55-56`, and the Menu tile
  `DistributorHubMobile.jsx:96`.
- **Runtime evidence (375px), real UI sign-in as d-001:**
  - Menu shows a **"Reports · Download data"** tile (screenshot `menu-375.png`).
  - TAP it → URL settles at `http://localhost:5173/dashboard`; screen is the **Home** dashboard
    ("Welcome back… UGX 1.95B"), Home tab active (`reports-tile-tap-375.png`). The tile does nothing.
  - Deep-link `/dashboard/reports` → settles `…/dashboard`. Deep-link
    `/dashboard/reports/contributions` → settles `…/dashboard`. (`a13-01-dist-mobile.mjs` log.)
- **Scope is wider than "mobile":** the boundary is `useIsDesktop` = `min-width:1024px`. Confirmed
  via `a13-09-viewband.mjs`:
  ```
  W=768 : bottomTabBar=1 mapRail=0 -> shell=MOBILE   | /dashboard/reports settles=/dashboard
  W=1024: bottomTabBar=0 mapRail=1 -> shell=DESKTOP  | /dashboard/reports settles=/dashboard (panel opens)
  ```
  So the **entire 375–1023px band** (phone AND small-laptop/tablet-portrait) gets the mobile shell
  with the dead Reports route. At ≥1024 the desktop **panel** renders Reports fine (the same URL
  bounce is by-design there).
- **Impact:** On any sub-1024 viewport a distributor taps "Reports / Download data" and nothing
  happens; `ReportsMobile` + `ReportViewMobile` + all 11 report views are unreachable there. A whole
  feature is dead on a supported viewport.
- **Severity:** **HIGH** per rubric ("a whole feature/route unreachable on a supported viewport").
  Promote-to-critical is the severity council's call — reps normally demo the distributor on desktop
  (map rail), where Reports works.
- **Suggested fix (NOT applied):** `const usesReportsPanel = (role === 'distributor' || role === 'branch') && !isDesktop;`
  Add a 375px E2E asserting `/dashboard/reports` renders `ReportsMobile`.

### A13-002 · LOW · confirmed — Distributor mobile Branches/Agents lists show all-zero metrics (0 subs / 0 agents / 0 funds) for ~2–3s until the separate metrics query resolves
- **Location:** `src/dashboard/mobile/BranchesMobile.jsx:41-77` (list via `useAllEntities('branch')`,
  metrics via a **separate** `useAllEntitiesMetrics('branch')`); same shape in `AgentsMobile`.
- **Evidence:** the loading spinner guard (`isLoading && branchesRaw.length===0`, `:80`) covers only
  the LIST read. Once the list arrives but the metrics map is still empty, every row falls back to
  `{}` and renders "0 subs · 0% active" while the summary strip reads "0 Agents / 0 Funds". Captured
  at ~3.5 s (`branches-375.png` early frame: "291 Branches / 0 Agents / 0 Funds", Buikwe branches
  "0 subs"). By ~3 s the metrics land and it re-sorts to the true values (291 / 1,872 / 1.95B; top
  row "Bukedea Central / 41 subs / 71%") — `a13-branches-load.mjs`:
  ```
  @3000ms summary=291/1,872/1.95B | firstRow=Bukedea Central/41/71
  ```
- **Impact:** A rep who scrolls the Branches/Agents list in the first ~2–3 s sees a network that
  looks empty (all zeros). Self-corrects; misleading only transiently. (Subscribers list has the
  same two-phase load but its own spinner covers it — it resolves to 4,602/3,606/1.95B by ~4 s, no
  zero flash.)
- **Suggested fix (NOT applied):** gate the metric fields on `useAllEntitiesMetrics` `isLoading`
  (skeleton the count columns) rather than defaulting to 0, or block the list render until both
  queries resolve.

### A13-003 · LOW · confirmed — the CSV 5,000-row mobile cap is unreachable for distributors (dead safeguard)
- **Location:** `src/utils/csvDownload.js:33` (`MOBILE_ROW_CAP = 5_000`, applied only when
  `isMobile` true) consumed by `src/dashboard/reports/ReportView.jsx:72-88`.
- **Evidence:** the cap fires only on a mobile UA reaching a report export — but the distributor
  reports route bounces on every sub-1024 viewport (A13-001), and d-001's largest export
  (All Subscribers) is 4,602 rows < 5,000. Desktop export verified working with **no** cap:
  `a13-03-csv-map.mjs` → `CSV DOWNLOAD file= all-subscribers-2026-08-24.csv dataRows= 4602`.
- **Impact:** the "cap at 5,000 + toast" safeguard can never trigger for this role. Nuance of
  A13-001; recorded so it isn't mistaken for tested behaviour. (The platform total 5,064 > 5,000
  would cap, but only the **admin** All-Subscribers export can reach that count — out of A13 scope.)

### A13-004 · INFO · confirmed — desktop panel state is not URL-routed; a hard refresh drops the open panel back to Overview
- **Location:** `DashboardPanelContext` (panels are state-based by CLAUDE.md §4 hard rule 2).
- **Evidence:** open Commissions panel → URL stays `/dashboard`; hard refresh → renders Overview,
  not Commissions (`a13-08-panel-drill-error.mjs`; `panel-refresh-1440.png`). By-design, but a rep
  who refreshes mid-demo on Commissions/Reports lands on Overview. No deep-link/back-button support
  for panels (geo drill, by contrast, DOES route: `/dashboard/regions/r-central`).

### A13-005 · INFO — `/distributors` public landing tiles show stale hardcoded marketing counts
- BRANCHES **316** (live 321), ACTIVE AGENTS **2,049** (live 2,046). Public landing page, likely
  intentional marketing placeholders; landing-page owner's domain (A23). No login-side effect.

---

## ON-SCREEN VERIFICATIONS of prior confirmed findings (A13's assigned corroboration)

### A22-001 (CRITICAL) — cross-tenant cache bleed — **VERIFIED on-screen for distributor**
Reproduced the exact SPA condition the finding requires (`a13-05-a22-spa-bleed.mjs`):
sign in as **admin** at `/admin` (FUM 2.45B), then WITHOUT logout SPA-navigate (browser-back →
click "Distributors" link — **0** full page loads) and sign in as **d-002**:
```
A) admin AUM sample: FUNDS UNDER MANAGEMENT UGX 2.45B
B) after goBack url: …/admin  docLoads:1
B) after Distributor link url: …/distributors  docLoads:1
B) d-002 stored: {"role":"distributor",…,"distributorId":"d-002"}
B) d-002 dashboard shows: 2.45B / 321 branches
B) TOTAL docLoads:1 | rollup network calls phase B: 0
```
Screenshot `a22-B-d002-SPA-1440.png`: header correctly reads **"Universal Pensions Uganda —
Secondary"** (d-002's identity) yet the tiles show **FUM UGX 2.45B / 321 branches / 5,001 subs /
2,046 agents** — the platform totals, i.e. **another tenant's money in a live demo**. d-002's true
figures are 170.1M / 27 / 399 / 171 (proved by the full-reload control `a22-B-d002-bleed-1440.png`,
which correctly shows 170.1M/27/399/171 because a reload clears the cache). Confirms A22-001;
the RLS layer is NOT at fault — it is the React Query cache not clearing on login.

### A05-003 (HIGH) — settlement_batches don't reconcile with the lines they flipped — **VERIFIED live + on-screen**
Live reconciliation (`psql`, current state — grown by E2E residue since A05):
```
settlement_batches claim:   20 lines / UGX 100,000
paid commissions actual:    10 lines / UGX  50,000   → 10 lines / 50,000 UNBACKED
5 of 7 batches (all E2E-PARTIAL/E2E-FULL) have ZERO backing paid commissions.
```
On screen (desktop Commissions, `commissions-1440.png`): **SETTLED 50K / 10 paid**, OUTSTANDING
23.0M / 4,592, TOTAL 23.0M / 4,602 — the distributor sees the paid-commission total (50K/10), while
the settlement-batch ledger (what an agent's history reads) claims 100K/20. The two surfaces
disagree by 50K/10 lines (40K/8 of it pure orphan E2E batches with no backing commission).

### A05-004 / A05-005 (HIGH) — settlement replay / duplicate-agent double-pay — **EXCLUDED from on-screen write-repro**
These require COMMITTING settlement uploads to the shared live DB. Report-only forbids it; A05 already
proved both under `BEGIN…ROLLBACK`. A13 confirmed only the reachable, non-destructive parts: the
**"Upload settlement"** button + **"Download template"** exist in the distributor Commissions panel
(`commissions-1440.png`), and the template downloads as a valid 279,886-byte XLSX (PK-zip magic
`504b0304`) prefilled from pending dues (`a13-07-settlement-dl.mjs`). No upload was submitted.

### A22-002 (MEDIUM) — hero money reads have no error/retry state — **VERIFIED on-screen for distributor**
Aborted `get_entity_metrics_rollup` via Playwright route-abort and reloaded the distributor
Overview (`a13-08-panel-drill-error.mjs`; `error-state-1440.png`): NO error card / retry. The hero
degrades to **FUM "—" / SUBSCRIBERS 0 / AGENTS 0 / 0 branches / Network score 0 "Needs work"** with
fabricated narrative ("4 regions have branches and agents in place but no members yet") — while the
**Top-branches table directly below still shows real data** (Rubaga 57 subs, UGX 21.7M; from
`get_top_entities`, which wasn't aborted). Self-contradictory wrong-money screen on any rollup hiccup.
Corroborates A22-002 (whose evidence already cites this distributor case).

---

## What PASSED (reconciled, no defect)
- **d-001 home** (375 & 1440): FUM 1.95B / 4,602 subs / 3,606 active / 1,872 agents / 291 branches — exact match.
- **d-002** (full reload): 170.1M / 27 / 399 / 171 — exact match; RLS scoping correct.
- **dash⇄map toggle** (1440): map renders with Summary overlay (1.95B / 4,602 / 1,872 / 291; regions Central 1,701 + Eastern 851 + Northern 850 + Western 1,200 = 4,602). `map-1440.png`.
- **Reports hub** (1440): all **11** views present in sections OVERVIEW/DIRECTORY(3)/FINANCIAL(2)/PERFORMANCE(2)/… ; Distribution Summary regional AUM Central 712.3M + Eastern 360.7M + Northern 356.6M + Western 525.3M = 1,954.9M = 1.95B. `reports-panel-1440.png`.
- **CSV export** (All Subscribers): downloaded `all-subscribers-2026-08-24.csv`, 4,602 data rows, date-stamped filename.
- **Geo drill** country→region: `/dashboard/regions/r-central`, REGION Central 712.3M / 1,701 / 437 agents / 69 branches — exact match to DB; districts list (26) renders. `drill-region-1440.png`.
- **Subscribers list** (375): resolves to 4,602 / 3,606 active / 1.95B by ~4 s (paginated reads 200/206/200…). No wrong data.
- **Support / Settings / Commissions / Branches / Agents / Menu** routes render without console errors at 375; **0 pageerrors / 0 console errors** across the mobile walk.
- **Catch-all** route (`*` → `Navigate to="/dashboard"`) — no 404s reachable.

---

## Traceability (every defined check → disposition)
| # | Check | Disposition |
|---|---|---|
| 1 | Reports tile TAP bounces to /dashboard at 375 | **FINDING A13-001** |
| 2 | /dashboard/reports deep-link bounces at 375 | **FINDING A13-001** |
| 3 | /dashboard/reports/:id deep-link bounces at 375 | **FINDING A13-001** |
| 4 | Reports bounce also at 768 / 1024 / 1440 (band) | **FINDING A13-001** (mobile <1024; desktop ≥1024 panel opens) |
| 5 | ReportsMobile / ReportViewMobile orphaned as dead code | **FINDING A13-001** |
| 6 | dash⇄map toggle works (1440) | PASS |
| 7 | All 11 report views reachable (desktop) | PASS |
| 8 | CSV export produces correct rows (desktop) | PASS (4,602 rows) |
| 9 | CSV 5,000-row cap reachable for distributor | **FINDING A13-003** (unreachable) |
| 10 | Settlement template download | PASS (valid XLSX) |
| 11 | Settlement upload write-effect | EXCLUDED-DEMO-SCOPE (would commit; A05-004/005 own it) |
| 12 | Geo drill country→region routes + reconciles | PASS |
| 13 | Geo drill region→district→branch panel lists present | PASS |
| 14 | Desktop refresh on unrouted panel state | **FINDING A13-004** (info; by-design) |
| 15 | d-001 home numbers match DB (375 & 1440) | PASS |
| 16 | d-002 scoped numbers match DB (fresh reload) | PASS |
| 17 | Commissions panel numbers match DB | PASS |
| 18 | A22-001 cross-tenant bleed on-screen | VERIFIED (A22-001 confirmed) |
| 19 | A05-003 settlement mismatch live + on-screen | VERIFIED (A05-003 confirmed) |
| 20 | A05-004/005 replay on-screen write-repro | BLOCKED (report-only; verified via A05 rollback proofs) |
| 21 | Error state (force rollup abort) | VERIFIED (corroborates A22-002) |
| 22 | Loading state (subscribers/branches) | **FINDING A13-002** (mobile list zero-flash) |
| 23 | Empty state forced (filters) | PASS (Inactive filter renders empty gracefully — no crash) |
| 24 | Router route unreachable from UI | **FINDING A13-001** (mobile reports); no others |
| 25 | UI link to a 404 route | PASS (none; catch-all redirects) |
| 26 | Console/page errors across mobile walk | PASS (0 errors) |

## Scratch artifacts (throwaway, under docs/audits/2026-08-23/scratch/, safe to delete)
`a13-01-dist-mobile.mjs`, `a13-02-dist-desktop.mjs`, `a13-03-csv-map.mjs`, `a13-04-a22-bleed.mjs`,
`a13-05-a22-spa-bleed.mjs`, `a13-06-commissions.mjs`, `a13-07-settlement-dl.mjs`,
`a13-08-panel-drill-error.mjs`, `a13-09-viewband.mjs`, `a13-branches-load.mjs`, `a13-subs-load.mjs`,
+ probes. Screenshots under `screenshots/distributor/`.
