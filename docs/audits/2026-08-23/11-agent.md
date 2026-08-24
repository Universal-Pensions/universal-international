# A11 · Agent (field worker) — Phase 3 browser walkthrough

**Persona:** `a-001` Dorothy Kiiza (branch `b-bui-001`, 11 subscribers). Signed in through the REAL UI
(`/distributors` → Agent tab → phone `700000001` → 6-digit OTP `123456`) — no token injection.
Viewports 375 and 1440; onboardcanvas fork checked at 1023/1024/768. Local dev (Vite 5173 / API 3001)
against the shared LIVE Supabase `ilkhfnoyxlxwqadebnkp`.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 18 agent routes × 2 viewports + KYC wizard end-to-end |
| Artifacts examined | 18/18 routes both viewports; wizard walked to the final RPC on chromium |
| Coverage | 100% of routes; 100% of the 5 pre-registered focus items |
| Checks defined | 34 |
| Checks executed | 33 |
| Checks passed / failed / blocked | 24 / 8 / 1 |
| Findings C / H / M / L / I | 2 / 1 / 3 / 2 / 1 |
| Evidence commands run | 21 |
| Excluded as demo-scope | 1 (mocked KYC OCR/NIRA/liveness/AML latency itself — but see A11-002, its *consequence* is in scope) |
| Blocked, with reason | 1 — exact raw 409 message string (authenticated-RPC probe denied by the auto-mode classifier; not load-bearing, 409 already proven by Playwright) |

### Domain metrics (agent role)
| Metric | Value |
|---|---|
| Routes rendering without console error | 18/18 both viewports |
| On-screen figures reconciled to SQL | home (5 tiles), commissions (earned 7/35K, owed 4/20K), insured 7, onboarded 1 — all MATCH |
| KYC wizard UI completes (awareness→8-step KYC→schedule→pay) | YES, both form factors |
| KYC wizard PERSISTS the subscriber | **NO — final RPC 409s (A11-002)** |
| Settlement batches for a-001 | 6 live; **5 are E2E test residue** (A11-001) |
| Members where agent "Active" ≠ subscriber "Expired" | 3 on a-001 (1 284 platform-wide, A06-004) |

---

## Findings

### A11-001 · CRITICAL · confirmed · verifies + escalates A05-002 — wrong money on the agent's headline surface
**The agent Commissions page presents Playwright test residue as real settlement history and shows two
contradictory "outstanding" figures in one frame. Since A05 captured it the residue has GROWN from 4 to
6 batches (two new rows dated today, 2026-08-24).**

Location: live `public.settlement_batches` · rendered by `src/agent-dashboard/pages/CommissionsPage.jsx:124`
(`SettlementMismatchBanner`, `partialBatch` = newest partial by `created_at`) and the settlement-history
table (`CommissionsDesktop.jsx` / `CommissionsPage.jsx`).

Evidence — signed in through the UI as `a-001`, `http://localhost:5173/dashboard/commissions`, 1440×1000
(`screenshots/agent/commissions-1440.png`; mobile `commissions-375.png` identical banner):
```
Your last settlement was partial
UGX 5K paid against UGX 20K due — UGX 15K is still outstanding (ref sb-8598ef1286bd4f89b628e4aed9238f6f).
EARNED UGX 35K   OWED UGX 20K   SETTLED 64%
Owed  4 awaiting payout  20K
Settlement history
1  24 Aug 2026  E2E-PARTIAL-1787558955623  1  UGX 20K  UGX 5K   PARTIAL
2  24 Aug 2026  E2E-FULL-1787558947624     4  UGX 20K  UGX 20K  FULL
3   3 Aug 2026  E2E-PARTIAL-1785752804482  1  UGX 15K  UGX 5K   PARTIAL
4   2 Aug 2026  E2E-PARTIAL-1785700815516  1  UGX 10K  UGX 5K   PARTIAL
5   2 Aug 2026  E2E-PARTIAL-1785700183410  1  UGX 5K   UGX 5K   FULL
6  16 Jul 2026  MM-SEED-0001               9  UGX 45K  UGX 45K  FULL
```
DB corroboration:
```
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select id, txn_ref, line_count, pending_total, paid_amount, to_char(paid_date,'YYYY-MM-DD') from settlement_batches where agent_id='a-001' order by created_at;"
sb-seed-0001|MM-SEED-0001|9|45000|45000|2026-07-16
sb-aaa8...|E2E-PARTIAL-1785700183410|1|5000|5000|2026-08-02
sb-3da8...|E2E-PARTIAL-1785700815516|1|10000|5000|2026-08-02
sb-0925...|E2E-PARTIAL-1785752804482|1|15000|5000|2026-08-03
sb-f7c0...|E2E-FULL-1787558947624|4|20000|20000|2026-08-24
sb-8598...|E2E-PARTIAL-1787558955623|1|20000|5000|2026-08-24
```
Three wrongnesses, all above the fold: (1) the banner ("UGX 15K still outstanding") contradicts the tile
directly beneath it ("OWED · UGX 20K · 4 awaiting"); (2) rows 1–5 are `E2E-*` artifacts from
`distributor-apply-settlement.spec.ts` (the two 2026-08-24 rows are fresh — the residue accretes on every
CI/Playwright run, since the spec registers cleanup ids *after* its assertions); (3) `MM-SEED-0001` claims
9 lines/45K while the EARNED tile says 7/35K. A rep opening the agent's Commissions tab lands on this.
This is A05-002 re-verified on the agent surface; ownership of the DB fix stays with A05. Impact worsened.

---

### A11-002 · CRITICAL · confirmed · the flagship onboarding wizard cannot complete
**An agent can walk the entire onboarding wizard — awareness → 8-step KYC → schedule → pay — and the
final `create_subscriber_from_agent_onboard` write returns HTTP 409, trapping the rep on a "Couldn't
save … / Not saved" screen with both action buttons disabled. The mocked ID-OCR always returns the same
NIN `CF92018AB3CD45`, a UNIQUE column already held by a live member on this very agent's roster.**

Location: `api/kyc/id-ocr.ts:46` (constant `nin: 'CF92018AB3CD45'`, name "Namukasa Sarah Kintu") →
`public.create_subscriber_from_agent_onboard` insert → unique index `ux_subscribers_nin` → 409, surfaced
by `src/agent-dashboard/onboarding/OnboardingComplete.jsx` (status `error`, buttons `disabled` while
`status !== 'success'`).

Evidence — re-ran the baseline's failing spec against the running dev servers (chromium):
```
$ npx playwright test flows/agent-onboard-subscriber.spec.ts --project=chromium --reporter=line
  1) …agent → onboard new subscriber › full wizard creates subscriber + balances via RPC
     Error: create_subscriber_from_agent_onboard RPC must succeed
     Expected: 200   Received: 409
```
Root cause (SQL):
```
$ psql … -c "select id,name,agent_id,nin,to_char(created_at,'YYYY-MM-DD') from subscribers where nin='CF92018AB3CD45';"
s-100117|Namukasa Sarah Kintu|a-001|CF92018AB3CD45|2026-08-07
$ psql … -c "select indexdef from pg_indexes where indexname='ux_subscribers_nin';"
CREATE UNIQUE INDEX ux_subscribers_nin ON public.subscribers USING btree (nin) WHERE (nin IS NOT NULL)
```
What the rep sees (`OnboardingComplete.jsx`, screenshot `screenshots/agent/onboard-wizard-409-failure.png`):
title flips to **"Couldn't save Namukasa's record"**, Record row shows **"Not saved"**, an alert box
renders the raw DB error, the **"Try again"** button re-issues the identical 409, and **both "Onboard
another" and "Close" are `disabled`** — the only exit is the shell nav. The wizard renders and steps on
both form factors (`onboard-kyc-idupload-1440.png` / `-375.png`, both show "Step 1 of 8 · Scan your ID");
it is only the finale that fails.

Why this is not "mocked-KYC is fine" demo-scope: the mock returning fixed data is by design, but its
interaction with a UNIQUE constraint means the wizard can succeed **at most once ever** — and the
required winning row already exists permanently on the demo agent's own book (created 2026-08-07). This
is precisely the class the audit brief says to report: *"anything that makes a live sales demo visibly
fail."* Reconciles the baseline `agent-onboard-subscriber:109` failure on both desktop engines (the
mobile projects exclude this spec via `testMatch`, which is why the baseline showed it only on
chromium+webkit). No subscriber was created by my testing — the 409 rolls back, and I verified
`count(*) where nin='CF92018AB3CD45'` stayed at 1 and 0 rows were created in the last 30 min.

**Fix (demo):** delete/rotate the fixed OCR identity, or have the RPC upsert-by-NIN in the demo flow, or
seed the mock OCR to mint a fresh NIN per call. Any of these restores a repeatable demo.

---

### A11-003 · MEDIUM · confirmed · desktop and mobile agent home disagree on "this month", and the desktop label is wrong
**The desktop agent home tile reads "Monthly contributions · UGX 331K · What members saved this month",
but 331K is the sum of members' *scheduled* monthly-equivalents, not what they saved. The mobile home,
and the Contributions page, show the *actual* collected figure — UGX 291K — for the same period.**

Location: `src/agent-dashboard/home/HomeDesktop.jsx:183-185` (`value: formatUGX(summary.monthly)`,
`context: 'What members saved this month'`) where `summary.monthly` = Σ `monthlyEquivalent(schedule)`
(`agentHomeSummary.js:18`); vs `HomeMobile.jsx:82-83,144` (`collected` = Σ actual contribution amounts).

Evidence:
```
desktop home  → "MONTHLY CONTRIBUTIONS  UGX 331K  What members saved this month"   (home-1440.png)
mobile home   → "This month  UGX 291K  Collected · 10 payments"                     (home-375.png)
contributions → "TOTAL RECEIVED  UGX 290,855  10 payments · June 2026"              (contributions-1440.png)

$ psql … -c "select count(*),sum(amount)::bigint from transactions t join subscribers s on s.id=t.subscriber_id where s.agent_id='a-001' and t.type='contribution' and t.date>=date '2026-06-01' and t.date<date '2026-07-01';"
10|290855                          ← actual saved this month (mobile is right)
Σ monthlyEquivalent(schedules) ≈ 331,333   ← the desktop number, i.e. the SCHEDULED expectation
```
A rep flipping between the phone and the laptop shows two different "this month" totals (UGX 40K apart)
and the desktop caption misstates a projection as realised savings.

---

### A11-004 · MEDIUM · confirmed · agent Settings renders a malformed phone (double country code)
**The agent Settings header shows the phone as `+256 256 711 443975` — a literal `+256` prefix is
concatenated with a `formatPhone` that never strips the stored country code. Both viewports.**

Location: `src/agent-dashboard/pages/SettingsDesktop.jsx:14-20` + `:120` and the mobile twin
`SettingsPage.jsx:15` + `:101`. The local `formatPhone` groups a 12-digit `256711443975` as
`256 711 443975`, then the JSX prepends `+256 `. The correct helper `formatUGPhone` (utils/phone.js)
already parses the local part but is not used here.

Evidence (`screenshots/agent/settings-1440.png`, `settings-375.png`):
```
Settings header:  DK  Dorothy Kiiza  +256 256 711 443975
Profile page:     DK  Dorothy Kiiza  +256711443975          (correct — profile-1440.png)
```
Before the `agents` query resolves the same tile falls back to the login phone and renders
`+256 256 700 000001` — wrong either way. Not misleading about money, but a broken-looking value on a
page a rep visits during onboarding/handover walkthroughs.

---

### A11-005 · HIGH · confirmed · verifies A06-004 on the agent surface — "Life cover · Active" for expired members
**On the agent's member-detail page, `s-0003` (Patrick Nsubuga, on a-001's roster) shows Life cover /
Hospital cash / Funeral cover all "ACTIVE", while the member's own subscriber dashboard derives
"Expired" from the same row (renewal_date 2026-04-16 < MOCK_NOW 2026-07-01).**

Location: agent side reads the stored flag — `src/services/agent.js:26-35` (`status === 'active'`);
subscriber side recomputes from the clock — `src/utils/policies.js:56-60`. Same divergence catalogued in
A06-004 (1 284 members platform-wide); here it is proven on-screen for the agent role.

Evidence (`screenshots/agent/subscriber-detail-s0003-full-1440.png`):
```
member detail s-0003 → "INSURANCE  Life cover ACTIVE  Hospital cash ACTIVE  Funeral cover ACTIVE"
$ psql … -c "select ip.subscriber_id,s.name,ip.status,to_char(ip.renewal_date,'YYYY-MM-DD') from insurance_policies ip join subscribers s on s.id=ip.subscriber_id where s.agent_id='a-001' and ip.status='active' and ip.renewal_date<date '2026-07-01' order by ip.renewal_date;"
s-0009|Florence Namubiru|active|2025-01-17
s-0010|Joseph Kato|active|2025-09-19
s-0003|Patrick Nsubuga|active|2026-04-16      ← 3 divergent members on a-001 alone
```
DB fix ownership stays with A06-004; this entry is the agent-surface confirmation the brief requested.

---

### A11-006 · MEDIUM · confirmed · "Yet to contribute" flashes the whole roster before the contributions query resolves
**`YetToContributePage` gates its skeleton only on the *subscribers* query, not the *contributions*
query it needs to compute the predicate. In the window before contributions load it renders every
subscriber as "yet to contribute" — I saw it show "11 members" (contradicting the home tile's "1")
before settling to "1 member". No spinner distinguishes the wrong intermediate from the final answer.**

Location: `src/agent-dashboard/pages/YetToContributePage.jsx:33-52` — `loading = isLoading &&
subscribers.length === 0` ignores `useAgentContributions`; `pendingContributors(subscribers, [])`
returns all subscribers until the contributions array arrives.

Evidence (mobile 375, first navigation, cold query — `yet-to-contribute-375.png` captured mid-flash):
```
+2200ms: "YET TO CONTRIBUTE  11 members … Select all 11" (all 11 listed)
settled:  "YET TO CONTRIBUTE  1 member … Select all 1"   (yet-to-contribute-375-settled.png)
```
Timed probe confirmed it settles to 1 by ~800ms on a warm query but shows the full roster before that;
the baseline documents genuine cold-start latency where the flash is longer. `onboarded-this-month`
shares the pattern (briefly "—/Loading"). Same shared component on both form factors.

---

### A11-007 · LOW · confirmed · "this month" is two different calendar months on one dashboard
**On the same agent home/nav, "Contributions this month" is anchored to **June 2026** (the month of the
latest seeded data, via `deriveMonthAnchors`) while "Onboarded this month" is anchored to the real clock
**August 2026** (via `created_at`).** A rep sees "Payments logged · June 2026" and "New subscribers ·
August 2026" side by side. Cross-references the A06 multi-clock findings. Evidence:
`contributions-1440.png` ("June 2026") vs `onboarded-this-month-1440.png` ("August 2026").

---

### A11-008 · INFO · confirmed · commissions error card leaks a raw exception string
Forcing the commission fetch to fail (Playwright route-abort) renders the ErrorCard with the message
**"TypeError: Failed to fetch"** verbatim (`screenshots/agent/commissions-error-1440.png`). The error
STATE is handled (title "We couldn't load your commissions", a "Try again" retry) — only the raw
technical string surfaced to a field agent is off. `subscribers/:id` for a missing id shows a clean
"Subscriber not found" state (`subscriber-detail-missing-1440.png`). Low-noise polish item.

---

## What reconciled cleanly (no finding)
- Home tiles: Total contributions UGX 5,219,237 = `Σ subscriber_balances` 5219237; 11 subscribers; 91%
  active (10/11 `is_active`); TO BE PAID UGX 20K / 4 pending = `commissions status='due'` 4/20000.
- Commissions EARNED 7/UGX 35K and OWED 4/UGX 20K match `commissions` by status exactly.
- Insured 7, Onboarded-this-month 1 (Aug 2026) match SQL.
- Every one of the 18 routes rendered without a console error at 375 and 1440; nav links resolve; the
  `*` route redirects to `/dashboard`; browser back and deep-link refresh restore the same screen.
- Multi-product insurance attach (life+health+funeral) drives through the wizard's ContributionSettings
  step and the split reaches the payload — the UI stage completes; only the terminal RPC 409s (A11-002).
- onboardcanvas fork verified at the boundary: 1024px+ renders the desktop chrome ("Onboard a new
  subscriber"), 1023/768px render the mobile app-shell ("Onboard a member").

## Cleanup / write safety
No committed DB writes. The re-run onboard spec 409'd (rolls back) and its `afterEach` scrubs by phone;
my authenticated-RPC message probe was denied by the classifier and never ran. Verified post-hoc:
`count(*) where nin='CF92018AB3CD45'` = 1 (unchanged), 0 subscribers created in the trailing 30 minutes.
Throwaway scripts live under `docs/audits/2026-08-23/scratch/a11-*.mjs`; screenshots under
`docs/audits/2026-08-23/screenshots/agent/`.

---

## Traceability (route × viewport, and the 5 focus items)

| # | Check | Disposition |
|---|---|---|
| 1 | `/dashboard` (home) renders 375+1440 | PASS |
| 2 | `/dashboard/onboard` renders 375+1440 | PASS |
| 3 | `/dashboard/subscribers` renders 375+1440 | PASS |
| 4 | `/dashboard/subscribers/:id` renders 375+1440 | PASS |
| 5 | `/dashboard/subscribers/:id/schedule` renders 375+1440 | PASS |
| 6 | `/dashboard/inbox` renders 375+1440 | PASS |
| 7 | `/dashboard/analytics` renders 375+1440 | PASS |
| 8 | `/dashboard/commissions` renders 375+1440 | PASS (content defect → A11-001) |
| 9 | `/dashboard/commissions/earned` renders 375+1440 | PASS |
| 10 | `/dashboard/commissions/owed` renders 375+1440 | PASS |
| 11 | `/dashboard/contributions` renders 375+1440 | PASS |
| 12 | `/dashboard/onboarded-this-month` renders 375+1440 | PASS (loading flash → A11-006) |
| 13 | `/dashboard/yet-to-contribute` renders 375+1440 | FINDING A11-006 |
| 14 | `/dashboard/insured` renders 375+1440 | PASS |
| 15 | `/dashboard/uninsured` renders 375+1440 | PASS |
| 16 | `/dashboard/settings` renders 375+1440 | FINDING A11-004 |
| 17 | `/dashboard/profile` renders 375+1440 | PASS |
| 18 | `/dashboard/help` renders 375+1440 | PASS |
| 19 | Home tile figures reconcile to SQL | PASS |
| 20 | Commissions earned/owed tiles reconcile to SQL | PASS |
| 21 | Commissions settlement history + banner integrity (A05-002) | FINDING A11-001 |
| 22 | Onboarding wizard completes end-to-end (persists) | FINDING A11-002 |
| 23 | Onboarding wizard UI walks awareness→KYC→schedule→pay | PASS |
| 24 | Multi-product insurance attach reaches payload | PASS |
| 25 | KYC renders on both form factors (onboardcanvas fork) | PASS |
| 26 | onboardcanvas fork boundary at 1023/1024/768 | PASS |
| 27 | Agent member-detail policy status vs subscriber (A06-004) | FINDING A11-005 |
| 28 | Desktop vs mobile "monthly contributions" consistency | FINDING A11-003 |
| 29 | "this month" anchor consistency across tiles | FINDING A11-007 |
| 30 | Error state (force API abort) on commissions | PASS (raw string → A11-008) |
| 31 | Empty/not-found state on subscribers/:id | PASS |
| 32 | Nav links resolve / `*` redirects to /dashboard / no dead links | PASS |
| 33 | Browser back + deep-link hard-refresh restore screen | PASS |
| 34 | Exact raw 409 error string captured | BLOCKED (classifier denied authenticated-RPC probe; 409 already proven) |
