# A10 · Subscriber (the saver) — Phase 3 browser walkthrough

**Persona driven:** `s-0001` Carol Obua (`+256711000001` → fallback `s-0001`), plus `s-0003`
Patrick Nsubuga (`+256701945855`) for A06-004. **Auth: real UI sign-in, any 6-digit OTP — no
token injected** (`scratch/a10-login.mjs`). Dev servers up (Vite 5173 / API 3001 `/readyz` ok).
Cites `docs/audits/2026-08-23/00-baseline.md`.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 20 subscriber routes (incl. 5 report views + 3 redirects) × 4 viewports |
| Artifacts examined | 20 routes × {375,1440} fully; {768,1024} on 6 key routes; 70 screenshots |
| Coverage | 100% of the route list at 375+1440; shell-band spot-checked at 768+1024 |
| Checks defined | 23 |
| Checks executed | 23 |
| Checks passed / failed / blocked | 17 / 6 / 0 |
| Findings C / H / M / L / I | 1 / 2 / 2 / 1 / 1 |
| Evidence commands run | 22 |
| Excluded as demo-scope | 3 (nominee-share >100% invariant not present live; in-memory claim/ticket stores; cosmetic payment pickers) |
| Blocked, with reason | none |

**Domain metrics:** routes rendered w/o ErrorBoundary: **20/20 at 1440, 20/20 at 375**. Console
errors across the sweep: **0**. Balance delta (UI vs DB `total_balance`): **0** at every viewport.
New findings by me: **A10-001..004**. Confirmed findings re-verified live on-screen: **A24-001,
A22-004, A06-004** (3/3 reproduced).

**No DB writes were committed.** The A22-004 test aborted `make_contribution` at the network layer
(route.abort); I verified via psql that s-0001 has **no transaction dated 2026-08-24** and the only
amount=5,000 row is from 2026-08-07 — so nothing I did landed. No fixture rows created.

---

## 1. Login experience (real UI, no token)

`/` → nav **Sign in** opens `SignInModal` on the phone step (role=subscriber preset) → phone
`aria-label="Phone number"` → **Send verification code** → 6× `Digit N of 6` inputs → **Verify &
sign in** → `/dashboard`. Any 6-digit code accepted (demo scope). Any unrecognised phone resolves to
`ROLE_DEFAULTS.subscriber = s-0001` (`api/auth/_lib/personas.ts:33`), so a rep always lands on Carol
Obua. `localStorage.upensions_auth` = `{"role":"subscriber",...,"subscriberId":"s-0001"}`. Clean.

## 2. Balance & money correctness (PASS)

```
$ psql "$SUPABASE_DB_URL" -c "select units,total_balance,retirement_balance,emergency_balance from subscriber_balances where subscriber_id='s-0001'"
 897.9839115963516446 | 1411092 | 1128874 | 282218
$ psql ... "select nav_date,unit_price from nav_snapshots order by nav_date desc limit 1" → 2026-08-08 | 1571.4
```
- **Total balance** UI settles to **UGX 1,411,092** = `897.9839 × 1571.40` — delta **0** (A04's
  reconciliation renders correctly). The 1,405,117 seen at 1.5 s is a mid-count-up frame; sampled
  8× over 5.6 s it holds at 1,411,092. Correct at 375/768/1024/1440.
- **80/20 split:** retirement 1,128,874 (80.0%) / emergency 282,218 (20.0%); schedule
  `retirement_pct=80, emergency_pct=20`. Home "Next payment · Pay UGX 500,000" = schedule amount.
- **Withdraw available** = **UGX 282,218** = emergency balance (retirement locked). Matches DB.
- **Units** 897.98 = retirement 718.39 + emergency 179.60. ✓
- **Nominee allocation sums to 100:** pension 50+50, insurance 100; page shows "TOTAL SHARE 100% ·
  BALANCED". Platform-wide `sum(share) <> 100` per (subscriber,type) = **0 rows** — the BACKEND.md
  §14b ">100%" bug is **not present in live data** (excluded).
- **Insurance tier picker** (`/settings/insurance`) Life ladder shows **1.0M / 2.0M / 3.0M / 5.0M**
  = `PRODUCT_TIERS.life`. Current cover UGX 6,000,000 (life 1M + health 3M + funeral 2M); annual
  premium UGX 102,000 = (2,000+5,000+1,500)×12. ✓

## 3. Confirmed findings — re-verified live on-screen (3/3)

### A24-001 · CRITICAL · certificate "Download" opens a blank tab (owner A24) — REPRODUCED
```
$ node scratch/a10-cert.mjs
Download certificate buttons: 3
New tabs/popups opened: 1
  popup url: about:blank | body chars: 0
Toast on policies page: "Please allow pop-ups for this site, then try again to open your certificate."
```
`/dashboard/policies` has 3 "Download certificate" buttons (life/health/funeral, all active for
s-0001). Clicking one opens **one `about:blank` tab (0 chars — certificate never renders)** and shows
the misleading toast telling the user to allow pop-ups *that are already allowed*. Root cause is
`window.open('', '_blank', 'noopener,noreferrer')` returning `null` per spec
(`src/signup/contribution/insurancePolicyCertificate.js:436`). Screens:
`screenshots/subscriber/a10-cert-toast.png`, `a10-cert-blank-tab.png`. **The single most important
on-screen confirmation for this role — a rep clicking Download during a demo gets a blank tab.**

### A22-004 · MEDIUM · raw error string in Top-up toast (owner A22) — REPRODUCED
```
$ node scratch/a10-a22-toast.mjs   # aborts **/rpc/make_contribution only — no DB write
make_contribution aborted count: 1
ERROR TOAST LINE: "TypeError: Failed to fetch"
```
Save → 5K preset → Top up → **Confirm & pay** with the contribution RPC dropped surfaces a bare
**`TypeError: Failed to fetch`** toast on a money action (`SavePage.jsx:204`
`addToast('error', err?.message || …)`). Screenshot `a10-a22-topup-neterror.png`.

### A06-004 · HIGH · member "Expired" vs stored "active" (owner A06) — REPRODUCED
```
$ psql ... "select cover,status,renewal_date from insurance_policies where subscriber_id='s-0003'"
 1000000 | active | 2026-04-16
$ node scratch/a10-a06-policy.mjs   (logged in as s-0003 via real UI)
Life cover: "... UGX 1,000,000 cover | Expired | ... EXPIRED | 16 Apr 2026 | Renew · UGX 24,000"
summary: "2 active · 1 expired"
```
s-0003's own Policies page renders **"Life cover · Expired"** (renewal 16 Apr 2026 < MOCK_NOW
2026-07-01) while the stored `status='active'` — which is exactly what the agent's page reads
(`buildAgentPolicies`). Screenshot `a10-a06-s0003-life-expired.png`.

## 4. NEW findings

### A10-001 · HIGH · confirmed · "All Transactions" and "Annual Tax Statement" reports show **no data / zeros** in live mode
**Location:** `src/subscriber-dashboard/reports/views/AllTransactions.jsx:81` &
`AnnualStatement.jsx:20` (both read `sub?.transactions`); root cause
`src/services/subscriber.js:488` (`getCurrentSubscriber` select omits `transactions`) + `mapSubscriberRow`
(lines 197–362) has no `transactions` key.

`useCurrentSubscriber()` never carries a `transactions` array in the Supabase path — the query
selects only `subscriber_balances / contribution_schedules / insurance_policies /
subscriber_insurance_products`, and the row mapper defines no `transactions` field. Two report views
read `sub.transactions`; both are therefore permanently empty. The `ActivityPage` (control) uses the
dedicated `useSubscriberTransactions()` query and shows the data correctly, proving the rows are
reachable — only these two report surfaces are wired to the wrong source.
```
$ psql ... "select type,count(*),sum(amount) from transactions where subscriber_id='s-0001' group by type"
 contribution | 9 | 1400137 |   premium | 1 | 24000 |   withdrawal | 1 | -20126     (11 rows total)

$ node scratch/a10-tx-empty.mjs
ALL-TX screen:  "EVERY MOVEMENT IN YOUR ACCOUNT | 0 of 0 transactions | MONEY IN — | MONEY OUT — | NET —"
ANNUAL screen:  "ANNUAL TAX STATEMENT | No statement yet. Once your first transaction settles, a year-end summary will appear…"
ACTIVITY screen (control, useSubscriberTransactions): "THIS YEAR UGX 1,376,137 | ↑ UGX 1.4M in | ↓ UGX 24K out"   (3 tx-type rows)

$ cat scratch/a10-annual-statement.csv
 Contributions 2026,0 | Insurance premiums 2026,0 | Withdrawals 2026,0 | Claim payouts 2026,0 | Net inflow,0
$ (AllTransactions CSV) → header only, 0 data rows
```
Not a load race: on-screen state persists past 12 s and the code has no `transactions` key to fill.
Contrast the Claim page, which reads `insuranceProducts` (a key that *is* mapped) and settles
correctly. **Impact:** a rep drilling into 2 of the 5 named reports shows an empty transaction
history and a **tax statement that reports UGX 0 contributions for a member who contributed UGX
1.4M** (the CSV literally exports `Contributions 2026,0`). Demo-visible; systematic across every live
subscriber. Screens `a10-alltx-empty-d.png`, `a10-annual-zeros-d.png`. **Borderline critical** on the
wrong-money CSV; rated HIGH because on screen it presents as an empty-state, not a deceptive figure.
**Fix:** point both views at `useSubscriberTransactions(sub.id)` (as Activity/Withdrawals do), or add
`transactions` to `getCurrentSubscriber`.

### A10-002 · MEDIUM · confirmed · Insurance settings shows **"0 beneficiaries on file"** when one exists
**Location:** `src/subscriber-dashboard/pages/InsurancePage.jsx:65,443` (`sub?.nominees?.insurance ||
[]`); same root family as A10-001 — `currentSubscriber` never carries `nominees`.
```
$ psql ... "select type,name,share from nominees where subscriber_id='s-0001'"
 pension|Robert Kasozi|50 | pension|Lillian Namutebi|50 | insurance|Samuel Babirye|100
$ node scratch/a10-benef-discrepancy.mjs
NOMINEES page — Insurance count: 1          (settings/nominees, uses getNominees query)
INSURANCE page — beneficiaries "on file": 0 (settings/insurance, reads sub.nominees.insurance)
```
The Insurance card reads `sub.nominees.insurance`, but `mapSubscriberRow` sets no `nominees` field,
so it is always `undefined → []`. The card renders **"Insurance beneficiaries · 0 on file"** under the
copy *"These people receive your life insurance benefit"* — implying nobody is named — while the
Nominees tab (separate query) and the DB both show 1 (Samuel Babirye). Two subscriber settings screens
disagree on who receives the death benefit. Screens `a10-insurance-settings-d.png`,
`a10-nominees-d.png`. **Fix:** read `useSubscriberNominees(sub.id)` in InsurancePage, or map `nominees`
onto currentSubscriber.

### A10-003 · INFO · confirmed · The 6 baseline "mobile subscriber-dashboard" Playwright failures are title-divergence, not product defects (for A25)
The baseline's deterministic mobile failures (`subscriber-dashboard.spec.ts:43,54,109,115,124,173`)
all fail on `getByRole('heading',{level:1,name:/<desktop title>/})` because the **mobile shell renders
a different, shorter `<h1>`** than the desktop shell. Every one of those routes renders correctly on
mobile (0 ErrorBoundary, content present, 0 console errors). Mapping (mobile h1 vs asserted desktop
title): Schedule `"Contribution settings"` vs `/tune your schedule/`; Withdraw hub `"Withdraw"` vs
`/withdrawals/`; All Transactions/Contributions `"Analytics"` vs the report name; Help `"Help"` vs
`/how can we help/`; Profile edit `"Edit profile"` vs `/^profile$/`. These are **test-selector
brittleness**, not bugs a rep would see — the pages work at 375. A25 should relax the assertions to
match the mobile app-bar titles.

### A10-004 · LOW · confirmed · On mobile, all 5 report sub-views share the same `<h1>` ("Analytics")
At ≤768 the app-bar `<h1>` is `"Analytics"` for `/dashboard/reports/*` regardless of which of the 5
report views is open (the report name is only an eyebrow). Distinct pages sharing one h1 is a minor
screen-reader/navigation wrinkle. Desktop is fine (each view has its own h1: "All Transactions",
"Annual Tax Statement", etc.). Low / non-blocking.

## 5. State coverage (loading / empty / error)

- **Loading:** report views show `"Loading transactions…"` / spinners before settle; Claim briefly
  shows "No active cover" at 2.2 s then settles to "ACTIVE COVER UGX 6,000,000" by 5 s (load race in a
  fast sweep, **not** a defect — verified both viewports, `a10-claim-settled-{m,d}.png`).
- **Empty:** genuine empty-states present — Claim "No active cover" (no policy), Annual "No statement
  yet". (The Annual empty-state is wrongly shown for s-0001 → that's A10-001, not a healthy empty.)
- **Error:** read pages guard `isError` with `ErrorCard` ("We couldn't load your account", onRetry) —
  `HomePage.jsx:19`, `SavePage.jsx:210`, every report view. Forcing `**/rest/v1/subscribers**`
  abort keeps the page on a spinner for several seconds (React Query default `retry:3` backoff) before
  the ErrorCard resolves — graceful, if slow. No ErrorBoundary crash. `a10-home-errorstate-d.png`.

## 6. Shell / navigation / responsive

- **Desktop (≥1024):** 3-col SideNav shell + Copilot ("Ask AI") panel. All 7 side-nav items route
  correctly, 0 crashes; browser **Back** from Help → Policies works.
- **Mobile (≤768):** HeroCapsule ("Hi Carol, here's your total balance UGX 1,411,092") + PillChip
  filters + bottom "Ask AI". Balance correct.
- **Shell boundary is 1024** (`useIsDesktop`): 768 = mobile shell, 1024 = desktop shell — both render
  cleanly, no 769–1023 breakage. `{index,save,withdraw,policies,reports,settings}-{768,1024}.png`.
- **Redirects:** `/dashboard/claim → /dashboard/withdraw/claim`, `/settings/notifications → /settings`,
  `/settings/security → /settings`, catch-all `* → /dashboard` — all verified at both viewports.

## 7. Reports & exports

5 report views render at both viewports; 5 CSV exports wired via `downloadCSV` (Blob + anchor).
Working: Contributions Summary (12 data rows), Withdrawals History, Insurance Statement, and Annual
*structure* (but zeros — A10-001). **Broken by A10-001:** All Transactions CSV = header only (0 rows);
Annual CSV = all zeros. `downloadCSV` itself fires a real `download` event correctly.

---

## Traceability (23 checks + route×viewport grid)

| # | Check | Disposition |
|---|---|---|
| 1 | Sign in through real UI (no token) as subscriber | PASS |
| 2 | All 20 routes render w/o ErrorBoundary @1440 | PASS (20/20) |
| 3 | All 20 routes render w/o ErrorBoundary @375 | PASS (20/20) |
| 4 | Redirects: claim / notifications / security / catch-all | PASS |
| 5 | Total balance renders = DB 1,411,092 (delta 0) all viewports | PASS |
| 6 | 80/20 split UI matches DB (1,128,874 / 282,218) | PASS |
| 7 | Withdraw-available = emergency balance (282,218) | PASS |
| 8 | Nominee allocation sums to 100 (UI + platform-wide) | PASS |
| 9 | Insurance Life tier picker = PRODUCT_TIERS.life [1/2/3/5M] | PASS |
| 10 | A24-001 certificate Download → blank tab + toast | FINDING A24-001 (verified) |
| 11 | A22-004 raw error string in Top-up toast | FINDING A22-004 (verified) |
| 12 | A06-004 member Expired vs stored active (s-0003) | FINDING A06-004 (verified) |
| 13 | 5 report views render + CSV exports | FINDING A10-001 (2 of 5 empty/zero) |
| 14 | Insurance beneficiary count on settings/insurance | FINDING A10-002 |
| 15 | Loading states present | PASS |
| 16 | Empty states present (forced) | PASS |
| 17 | Error states handled (forced API abort) | PASS (ErrorCard, slow via retry) |
| 18 | Console errors across sweep | PASS (0) |
| 19 | 768 / 1024 shell-band renders cleanly | PASS |
| 20 | Nav links + browser back | PASS |
| 21 | Baseline Playwright mobile-failure reconciliation | FINDING A10-003 (title divergence) |
| 22 | Mobile report-view h1 uniqueness | FINDING A10-004 |
| 23 | No committed DB writes / cleanup verified via psql | PASS |

### Route × viewport grid (rendered w/o ErrorBoundary; ✓ = clean)
| Route | 375 | 768 | 1024 | 1440 |
|---|---|---|---|---|
| /dashboard (index) | ✓ | ✓ | ✓ | ✓ |
| /dashboard/save | ✓ | ✓ | ✓ | ✓ |
| /dashboard/save/schedule | ✓ | – | – | ✓ |
| /dashboard/withdraw | ✓ | ✓ | ✓ | ✓ |
| /dashboard/withdraw/savings | ✓ | – | – | ✓ |
| /dashboard/withdraw/claim | ✓ | – | – | ✓ |
| /dashboard/claim → redirect | ✓ | – | – | ✓ |
| /dashboard/activity | ✓ | – | – | ✓ |
| /dashboard/reports | ✓ | ✓ | ✓ | ✓ |
| /dashboard/reports/all-transactions | ✓* | – | – | ✓* |
| /dashboard/reports/contributions-summary | ✓ | – | – | ✓ |
| /dashboard/reports/withdrawals-history | ✓ | – | – | ✓ |
| /dashboard/reports/insurance-statement | ✓ | – | – | ✓ |
| /dashboard/reports/annual-statement | ✓* | – | – | ✓* |
| /dashboard/policies | ✓ | ✓ | ✓ | ✓ |
| /dashboard/help | ✓ | – | – | ✓ |
| /dashboard/agent | ✓ | – | – | ✓ |
| /dashboard/settings | ✓ | ✓ | ✓ | ✓ |
| /dashboard/settings/profile | ✓ | – | – | ✓ |
| /dashboard/settings/nominees | ✓ | – | – | ✓ |
| /dashboard/settings/insurance | ✓† | – | – | ✓† |
| /settings/notifications → redirect | ✓ | – | – | ✓ |
| /settings/security → redirect | ✓ | – | – | ✓ |

`* renders but shows no transaction data (A10-001). † renders but shows "0 beneficiaries" (A10-002).`
`–` = not separately captured at that band (route not shell-boundary-sensitive).

## Scratch artifacts
Scripts under `docs/audits/2026-08-23/scratch/a10-*.mjs`; 70 screenshots under
`docs/audits/2026-08-23/screenshots/subscriber/`. No repo source touched; no DB rows written.
