# A14 · Employer role — Phase 3 browser walkthrough

**Persona:** `emp-001` (Nile Breweries Demo Ltd) · sign-in `/employers` · phone `+256700000031`, any 6-digit OTP (signed in through the REAL UI, no token injection — per Phase-3 method).
**Viewports:** 375 + 1440 for all 12 routes; 768 + 1024 added for the Overview/Employees band (shell threshold `useIsDesktop()` = 1024px).
**Baseline cited:** `docs/audits/2026-08-23/00-baseline.md`. **Cross-ref:** `06-data-integrity.md` (A06-001 / A06-002).

> **No committed writes.** Every write I exercised (`submit_employer_contribution_run`,
> `update_employer_member_compensation`) was run inside `BEGIN … ROLLBACK` with the employer JWT
> claims set via `set_config('request.jwt.claims', …, true)`, and I proved the rollback (0 leftover
> rows). I generated no invites, submitted no runs, and edited no compensation on the live DB. The
> only E2E residue that grew during the window came from OTHER agents / the baseline Playwright suite
> (171 `EMP-%` rows stamped 2026-08-24), not from me.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 12 employer routes + 4 focus workstreams (two-leg config, run engine/0102, group insurance, invite→completion) |
| Artifacts examined | 12 / 12 routes; all 4 workstreams |
| Coverage | 100% |
| Checks defined | 31 |
| Checks executed | 31 |
| Checks passed / failed / blocked | 25 / 6 / 0 |
| Findings C / H / M / L / I | 1 / 1 / 1 / 1 / 0 |
| Evidence commands run | 24 |
| Excluded as demo-scope | 3 (mocked support-ticket store persistence; mocked payment-method picker on the run wizard; mocked KYC on invite completion) |
| Blocked, with reason | none |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Routes reachable from UI | 12 / 12 (onboard→employees & profile→overview are documented desktop redirects) |
| Router routes 404-ing from a UI link | 0 |
| On-screen money figures reconciled to SQL | Overview leg tiles ✅, Contributions total ✅, Runs table ✅, Analytics KPIs ✅, member-detail legs ✅ — **Overview/Runs/Analytics "total contributions" ❌ (A14-001)** |
| Horizontal overflow (375/768/1024/1440) | none on Overview/Employees |
| Write paths verified read-only (rolled back) | 2 (contribution run, compensation edit) |
| emp-001 roster E2E residue | 120,292,000 UGX of 197,491,903 = **60.9%** (headline, A14-002 / A06-001) |

---

## Findings

### A14-001 · HIGH · confirmed — "Total contributions" is computed from two irreconcilable sources; the same screen shows figures that differ by up to 11.6×
**Surface:** Employer Overview (`/dashboard`), Runs (`/dashboard/runs`), Analytics (`/dashboard/analytics`).
**Location:** `src/services/employer.js` `getEmployerContributions()` (run-linked, `contribution_run_id IS NOT NULL`) vs `get_employer_metrics` RPC (`type='contribution'`, no run filter); consumed together in `src/employer-dashboard/desktop/OverviewDesktop.jsx:159` (Hero) vs `:184/:192` (leg tiles), `RunsDesktop`, `AnalyticsDesktop`.

The employer Overview shows, top-to-bottom, on ONE screen:

```
TOTAL CONTRIBUTIONS TO DATE · EMPLOYEE + EMPLOYER   UGX 182,689,000     ← get_employer_metrics
TOTAL EMPLOYEE CONTRIBUTION                         UGX 9.8M            ← getEmployerContributions (run-linked)
TOTAL EMPLOYER CONTRIBUTION                         UGX 5.9M            ← getEmployerContributions (run-linked)
```

The Hero eyebrow literally reads **"employee + employer"**, so its value should equal the two leg
tiles. It does not: `9.8M + 5.9M = 15.7M`, but the Hero says `182.7M` — an **11.6× gap on one screen**.
The Runs page is worse — it states a **provably false** fact:

```
FUNDED TO DATE  UGX 182.7M          … but the run-history table lists 6 runs:
  E2E Run 1785753040826   4,704,000
  May 2026 latest         2,918,000
  May 2026 mid-cycle      2,918,000
  May 2026 payroll        2,918,000
  April 2026 payroll      2,918,000
  March 2026 payroll      2,918,000
footer: "6 runs · UGX 182,689,000 pension funded"   ← 6 runs actually total 19,294,000
```

**Root cause.** `get_employer_metrics` sums *every* `type='contribution'` row for the employer's
tagged members — including each member's own personal pension history from **before/outside** employer
sponsorship (`contribution_run_id IS NULL`) — and the E2E residue (A14-002). The run/contribution
views count only `contribution_run_id IS NOT NULL`. The two definitions never reconcile.

**Systemic, not just emp-001's residue.** Even after removing all E2E residue, emp-001 is 62.4M
(metrics) vs 11.8M (runs). And every other employer is affected:

```
$ psql … -c "with m as (select s.employer_id,
    sum(t.amount) filter (where t.type='contribution')::bigint as metrics_total,
    sum(t.amount) filter (where t.type='contribution' and t.contribution_run_id is not null)::bigint as runlinked
  from transactions t join subscribers s on s.id=t.subscriber_id
  where s.employer_id is not null group by 1) select * from m order by 1;"
emp-001|182689000|15734000
emp-002| 21300000|            ← NULL: Hero shows 21.3M, tiles/Runs/Contributions show 0
emp-003| 15300000|
emp-004| 27555000|
emp-005| 12240000|
emp-006| 15292500|
emp-007| 13560000|
```

**Confirmation via forced error.** Aborting the `get_employer_metrics` request makes the Hero fall
back to **UGX 15,734,000** — which then reconciles with the leg tiles. So `15.7M` is the coherent
number and the `182.7M` metrics value is the anomaly.
```
(Playwright) page.route('**/rpc/get_employer_metrics', abort) → Hero reads "UGX 15,734,000"
```

**Impact (demo credibility + wrong money).** On the primary employer dashboard and the Runs page, the
headline funding figure contradicts its own breakdown, and "6 runs · UGX 182,689,000 pension funded"
is a statement any prospect can falsify by adding up the six rows shown directly above it.
**Screenshots:** `screenshots/employer/index-1440.png`, `runs-1440.png`, `analytics-1440.png`, `overview-error-1440.png`.

**Suggested fix.** Feed the Overview Hero, the Runs "funded to date", and the Analytics "total
contributions" from the same run-linked source the leg tiles/Contributions page use (Σ
`contribution_runs`), OR relabel and split the metric so member personal top-ups are not counted as
employer run funding. Whichever source wins, all four surfaces must read from it.

---

### A14-002 · CRITICAL · confirmed — E2E test residue is displayed as live data across the employer demo dashboard (reproduces A06-001 on the employer surface)
**Surface:** every emp-001 money surface. **Location:** live data — `public.transactions` / `subscriber_balances` / `contribution_runs` (mechanism owned by A06-002). emp-001 is the `ROLE_DEFAULTS.employer` fallback every unrecognised employer login lands on — i.e. the employer a rep demos.

**(a) Inflated balances.** emp-001 roster total balance **197,491,903 UGX, of which 120,292,000 (60.9%) is `EMP-%` E2E residue**; per-member, `empe-001` (Brian Okello) holds **24,471,589** with **12,810,000 (52%)** E2E contribution residue. 19 of the 21 members each carry exactly 99 residue rows (33 runs × 3 legs).
```
$ psql … -c "select count(*) filter (where txn_ref like 'EMP-%'), sum(amount) filter (where txn_ref like 'EMP-%')::bigint
             from transactions where subscriber_id='empe-001' and type='contribution';"
 99 | 12810000
$ psql … -c "select sum(b.total_balance)::bigint from subscribers s join subscriber_balances b on b.subscriber_id=s.id where s.employer_id='emp-001';"
 197491903
```

**(b) "E2E Run 1785753040826" shown as the last real run.** It is the top row of the Runs history
table, the Overview "Needs attention" card ("Last run · E2E Run 1785753040826"), and the answer the
copilot prompt "Show our last contribution run" would surface. Only 1 of emp-001's 6 "runs" is a real
payroll period label vs an E2E test label — and it is the newest.

**(c) Duplicate test transactions dated today.** The `empe-001` member-detail contribution history
shows identical `UGX 210,000 / UGX 105,000` payroll pairs repeated across **"23 Aug 2026" and "24 Aug
2026"** (real `now()` wall-clock, standing out among the Mar–May 2026 seed dates). The residue is
still growing: **171 `EMP-%` rows stamped 2026-08-24**, newest 08:10 today.

**(d) Forecast + charts polluted.** Overview "NEXT CONTRIBUTION UGX 3.9M" is derived from the latest
run's totals — the E2E run (1,972,000 + 1,972,000 = 3,944,000) — not the real config projection
(986,000 + 1,972,000 = 2,958,000). The Analytics contributions chart carries an "Aug 26" spike.

**Impact.** A rep demoing emp-001 shows a prospect fake balances, a contribution run literally named
"E2E Run 1785753040826", a "next contribution" figure that is wrong, and duplicate transactions dated
today. **Screenshots:** `HEADLINE-employees-roster-1440.png`, `HEADLINE-member-empe-001-1440.png`, `runs-1440.png`, `index-1440.png`.
**Suggested fix (A06-002 owns mechanism):** purge `txn_ref LIKE 'EMP-%'` residue + the E2E `contribution_runs` row from live demo data, and make the E2E suite target a throwaway employer or clean up its own transactions (not just the run header — the child txns are orphaned with `contribution_run_id` nulled).

---

### A14-003 · MEDIUM · confirmed — Expired invites are labeled "awaiting sign-up" on the Overview & roster, contradicting the Pending KYC page ("0 awaiting · 4 lapsed")
**Surface:** Overview `/dashboard`, Employees `/dashboard/employees`, Pending KYC `/dashboard/pending-kyc`.
**Location:** `src/employer-dashboard/desktop/OverviewDesktop.jsx` "Pending KYC" tile + NeedsAttention; `EmployeesDesktop.jsx:170` note; vs `PendingKycDesktop.jsx` classification.

All 4 of emp-001's pending invites expired on 2026-08-09 / 08-14 (today is 08-24):
```
$ psql … -c "select token, status, expires_at::date from employer_invites where employer_id='emp-001' order by created_at desc;"
inv-097aadbd… | pending | 2026-08-14
inv-7762a032… | pending | 2026-08-09
inv-78bdee14… | pending | 2026-08-09
inv-fcad3aa6… | pending | 2026-08-09
```
- Overview tile: **"PENDING KYC 4 · Invited · awaiting sign-up"**; NeedsAttention **"4 invited · awaiting sign-up"**; roster note **"4 people invited and awaiting sign-up."**
- Pending KYC page (correct): **"0 awaiting sign-up · 4 lapsed"**, "Awaiting 0 / Expired 4", **"None awaiting · No active pending invites right now."**

The public `/invite/:token` route itself handles the expiry gracefully — loading an expired token
renders **"Invite unavailable / invite expired / Go to home"** with no console error (verified,
`invite-token-375.png`).

**Impact.** A demo call-to-action ("4 awaiting sign-up — chase them") dead-ends on a page stating
there is nothing to chase. **Screenshots:** `pending-kyc-1440.png`, `index-1440.png`, `invite-token-375.png`.
**Suggested fix.** Compute the Overview/roster "pending" figure with the same `expires_at` split the
Pending KYC page uses, or relabel the tile to "invited (incl. lapsed)".

---

### A14-004 · LOW · confirmed — Overview "Needs attention" mislabels combined group cover as "Group life cover"
**Surface:** Overview `/dashboard` → Needs attention. **Location:** `src/employer-dashboard/desktop/NeedsAttention.jsx`.
Shows **"Group life cover UGX 20.0M per member"**, but 20.0M is life (15.0M) + health (5.0M) combined; the Insurance page correctly splits them (Life 15.0M / Health 5.0M). The word "life" is wrong — it is total cover.
**Impact:** minor copy inaccuracy on the dashboard. **Screenshot:** `index-1440.png`. **Fix:** "Group cover UGX 20.0M per member" (or sum the enabled products' label).

---

## Focus-workstream verification (all PASS)

**Unified two-leg percent-only config (0092/0093).** Settings → Pension contribution shows exactly the
unified model: "Who contributes? Staff only / Staff and company / Company only", two inputs each
"Share of each person's pay (%)", and a live preview "For someone paid UGX 1,000,000 a month · Staff
put in 50,000 · You add 100,000". No "match", no "co-contribution", no flat-UGX basis anywhere.
emp-001 config `{employeePct:5, employerPct:10, …}` renders correctly on member detail
("They put in /mo 105,000 · You add /mo 210,000" for comp 2,100,000). `screenshots/employer/settings-pension-1440.png`.

**Employer money 100% to retirement (0102) — proven on screen + in the DB.** Member detail shows
"Where it goes: Retirement savings" (no emergency split). Verified read-only against the live RPC:
```
BEGIN; set request.jwt.claims = {app_role:employer, employerId:emp-001};
BEFORE_ret_sum 154,594,432
submit_employer_contribution_run('A14-AUDIT-ROLLBACK','Bank transfer', nonce) →
   {linesCreated:19, employeeTotal:986000, employerTotal:1972000, insuranceTotal:760000, grandTotal:3718000}
AFTER_ret_sum  157,552,432   (Δ = 2,958,000 = employeeTotal + employerTotal — ALL to retirement)
AFTER_emg_sum  34,951,110    (emergency unchanged)
ROLLBACK;  → 0 leftover runs / 0 leftover nonce / 0 leftover EMP-% txns  ✅
```
linesCreated 19 = active members; 986,000 = 5%·Σactive-comp (19,720,000); 1,972,000 = 10%·Σactive-comp;
760,000 = 19×40,000 insurance. Run math and 0102 allocation both confirmed.

**Group insurance.** Insurance page = employer-funded, all-or-nothing, flat per-member: 21 covered,
Life 15.0M + Health 5.0M, premium 40K/staff, total 840K/mo, 420.0M cover in force — matches config
`groupInsuranceProducts` and `group_insurance_premium_per_member`. `insurance-1440.png`.

**Compensation edit write path** verified read-only: `update_employer_member_compensation('empe-013',
1234567)` returned `{updated:1}` inside a transaction; post-rollback `empe-013.compensation` still
550,000. ✅

**Contribution-run wizard** payment-method picker (MTN/Airtel/Bank/Card) is the shared cosmetic mock
(demo scope — excluded). I did NOT submit a live run through the UI.

---

## Traceability (route × viewport + focus checks)

| # | Check | Disposition |
|---|---|---|
| C1 | Overview `/dashboard` renders (1440/375/1024/768), no console errors | PASS |
| C2 | Employees `/dashboard/employees` renders (1440/375/1024/768) | PASS |
| C3 | Member detail `/dashboard/employees/:id` renders (1440) | PASS |
| C4 | Runs `/dashboard/runs` renders (1440/375) | PASS |
| C5 | Contributions `/dashboard/contributions` renders (1440/375), `?leg=` filters | PASS |
| C6 | Insurance `/dashboard/insurance` renders (1440/375) | PASS |
| C7 | Analytics `/dashboard/analytics` renders (1440/375) | PASS |
| C8 | Support `/dashboard/support` renders (1440/375) | PASS |
| C9 | Settings `/dashboard/settings` renders + Pension/Insurance/Password tabs (1440/375) | PASS |
| C10 | Onboard `/dashboard/onboard` renders on mobile; desktop redirects → employees | PASS (redirect by design, OnboardPage.jsx) |
| C11 | Pending KYC `/dashboard/pending-kyc` renders (1440/375) | PASS |
| C12 | Profile `/dashboard/profile` renders on mobile; desktop redirects → overview | PASS (redirect by design, ProfilePage.jsx) |
| C13 | Overview Hero "total contributions" reconciles with its own leg tiles | **FINDING A14-001** |
| C14 | Overview leg tiles (9.8M/5.9M) match run-linked SQL | PASS |
| C15 | Overview funding split (33/67, 986K/1972K) matches config+comp | PASS |
| C16 | Roster counts (21/19/2/4) match SQL | PASS |
| C17 | Member-detail legs match config (5%/10%) + 0102 "Retirement savings" | PASS |
| C18 | Runs page "funded to date / 6 runs · 182.7M" matches run table | **FINDING A14-001** |
| C19 | Contributions page total (15,734,000) = Σ contribution_runs | PASS |
| C20 | Analytics KPIs (headcount 21, active 19, avg comp 994K, insured 21) match SQL | PASS |
| C21 | Settings pension config = unified two-leg percent-only (no match/flat) | PASS |
| C22 | Insurance page = employer-funded group; premium matches config | PASS |
| C23 | Run submit → DB → retirement balances (0102), read-only rollback | PASS |
| C24 | Compensation edit write path, read-only rollback | PASS |
| C25 | Invite generation surface + `/invite/:token` expired-token handling | PASS |
| C26 | Pending-KYC classification vs Overview/roster labels | **FINDING A14-003** |
| C27 | Loading/empty/error states (forced `get_employer_metrics` abort) | PASS (graceful; silent fallback to 15.7M — supports A14-001) |
| C28 | Responsive band 768/1024 — no horizontal overflow (Overview/Employees) | PASS |
| C29 | Tenant isolation — only emp-001's 21 members shown in UI | PASS |
| C30 | A06-001 reproduction on the employer surface (headline) | **FINDING A14-002** |
| C31 | Overview NeedsAttention insurance label accuracy | **FINDING A14-004** |

**Excluded as demo-scope:** support-ticket in-memory persistence (no visible flow break observed — 2 open / 1 resolved rendered fine); run-wizard payment-method picker (cosmetic mock); invite-completion KYC (mocked). **Blocked:** none.
