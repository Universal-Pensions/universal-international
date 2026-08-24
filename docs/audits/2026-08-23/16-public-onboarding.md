# A16 · Public & Onboarding Surface — Phase 3 Browser Walkthrough

**Agent:** A16 · **Date:** 2026-08-24 · **Method:** Playwright headless chromium against
local dev (Vite `http://localhost:5173`, Express `http://localhost:3001` `/readyz` 200)
driving the REAL UI, cross-checked against live Supabase `ilkhfnoyxlxwqadebnkp` via `psql`.
Baseline cited: `docs/audits/2026-08-23/00-baseline.md`.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 30 (16 public/onboarding routes + 9 wizard steps + 2 KYC terminals + 3 invite-token states) |
| Artifacts examined | 30 |
| Coverage | 93% (2 checks blocked by live-data state — see Blocked) |
| Checks defined | 38 |
| Checks executed | 36 |
| Checks passed / failed / blocked | 33 / 3 / 2 |
| Findings C / H / M / L / I | 0 / 0 / 1 / 2 / 1 |
| Evidence commands run | 14 |
| Excluded as demo-scope | 3 (OTP always-accepts, KYC vendor mocks, cosmetic mobile-money pickers) |
| Blocked, with reason | (1) valid-invite happy-path walk — all 4 live `employer_invites` are expired; (2) invite "already-used" repro — no `status='completed'` invite exists live. Both verified from RPC `prosrc` instead. |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Public routes rendered w/o error boundary or console error (375/920/1440) | 13 / 13 / 13 |
| Signup wizard steps reached & rendered (id-upload→consent, 375 & 1440) | 8 / 8 both viewports |
| KYC failure terminals rendered (agent-fallback, pending-review) | 2 / 2 |
| Public writes exercised, verified in DB, then deleted with proof | 2 / 2 (access_requests, nominee_claims) |
| Committed rows left behind | 0 (all proven deleted) |
| Mobile public routes missing `<h1>` | 5 of 8 (faq, contact, about, request-access ×2) |

**Fixture rows created and cleaned up (G-compliance):** I submitted exactly one
`access_requests` row (org `A16AUDIT DELETEME Ltd`, id `ar-1787573642968-jrhb`) and one
`nominee_claims` row (ref `NC-54F64285`, id `nc-951bb119…`) through the real UI to verify
the write→triage path, then `DELETE`d both via `psql` and proved 0 rows remain on every
tag (org/phone/email) with table totals restored (access_requests 5, nominee_claims 9).
No other live writes were committed — the signup wizard walk was **stopped before "Pay"**,
so `create_subscriber_from_signup` never fired (proven: `SELECT … WHERE phone LIKE
'%719900%' OR name='Test Nominee'` returns 0 rows).

---

## Findings

### A16-001 · MEDIUM · Mobile public pages ship no `<h1>`; About starts at `<h3>` (confirmed)
**Location:** `src/pages/landing/mobile/FAQMobile.jsx:26`, `ContactMobile.jsx:70`,
`AboutMobile.jsx:9`, `RequestAccessMobile.jsx:87` (via `LandingMobileShell` at ≤768px).

On the 375 px phone shell — the primary viewport a sales rep demos on — five of the eight
public routes render with **no level-1 heading**, and About jumps straight to `<h3>`:

```
[MOBILE-375]  /faq             h1=NO  firstHead=h2:"Frequently asked questions."
              /contact         h1=NO  firstHead=h2:"Contact us."
              /about           h1=NO  firstHead=h3:"About Universal Pensions"   (then h4s)
              /request-access  h1=NO  firstHead=h2:"Set up Universal Pensions for your team"
              /request-access?type=distributor  h1=NO  firstHead=h2:"Become a Universal Pensions partner"
[DESKTOP-1440] /faq h1=YES "Frequently Asked Questions" · /contact h1=YES "Contact Us" · /about h1=YES "About Universal Pensions"
```
(evidence: `docs/audits/2026-08-23/scratch/a16/walk.mjs`, verbatim run output.)

The desktop pages (`FAQ.jsx:108`, `Contact.jsx:76`, `About.jsx:73`, `RequestAccess.jsx`)
all carry a correct `<h1>`; only the phone-shell twins regress. `/claim` keeps its `<h1>`
at every viewport because `NomineeClaim` is one responsive component, not a mobile-shell
screen — which is exactly the pattern the others should follow.

**This is the root cause of the 6 deterministic baseline Playwright failures** the plan
handed A16 (`smoke/landing.spec.ts:20,27,34` failing on BOTH `mobile-chromium` and
`mobile-webkit`): each asserts `getByRole('heading',{level:1,…})` and the phone shell has
no level-1 heading to match. The pages themselves **render and are usable** (0 console
errors, 0 error-boundary, forms and accordions work), so this is an a11y / semantic-outline
defect (WCAG 2.4.6 + 1.3.1: missing page heading, skipped heading level h1→h3 on About),
not a broken page. Impact: screen-reader users get no page title landmark on the entire
public support surface on mobile, and the automated a11y/heading gate stays red.

Lower-impact siblings (all viewports, utility screens): `/admin/login` and `/coming-soon`
also render with no `<h1>` (top heading is `<h2>`).

**Suggested fix:** promote the top heading of each `*Mobile` screen to `<h1>` (About:
h3→h1, then demote its sub-sections one level), and give `AdminLogin`/`ComingSoon` an `<h1>`.

---

### A16-002 · LOW · FAQ/Contact/About have no signup CTA in the 769–920 px band; Navbar drawer is dead code (confirmed)
**Location:** `src/components/Navbar.module.css:220` (`@media (max-width:920px){.cta{display:none}}`)
+ `:236` (`.burger{display:flex}` only inside `@media (max-width:768px)`); `Navbar.jsx`
imported only by `FAQ.jsx`, `Contact.jsx`, `About.jsx`.

The legacy `Navbar` hides the "Start saving" CTA at ≤920 px, promising in-code that it
"stays reachable from the drawer and the page body". Neither is true on these routes:

```
width=1440  startSaving.visible=true   signIn=true  burger=false
width=950   startSaving.visible=true   signIn=true  burger=false
width=900   startSaving.visible=false  signIn=true  burger=false
width=800   startSaving.visible=false  signIn=true  burger=false
width=769   startSaving.visible=false  signIn=true  burger=false
```
(evidence: `docs/audits/2026-08-23/scratch/a16/nav-band.mjs`, verbatim.)

The hamburger drawer only renders at ≤768 px — but at ≤768 px `LandingLayout` swaps the
entire `Navbar` for `LandingMobileShell`, so **the Navbar's mobile drawer never renders on
any real viewport** (dead code). That leaves a 769–920 px band — which covers real
iPad-portrait widths (iPad Air 820, iPad Pro 11" 834) — where FAQ/Contact/About show
**neither the "Start saving" CTA nor a menu button**, and these pages carry no signup CTA
in their body. "Sign in" stays visible and the audience nav-links still route to home
(which has its own CTAs), so signup is not a dead end — hence LOW, degraded-conversion
polish. A rep demoing on an iPad in portrait on a support page will find no primary CTA.

**Suggested fix:** either keep the CTA visible below 920 (it already fits — measured note
in the CSS is stale) or lift the burger breakpoint to 920 so the drawer covers the gap.

---

### A16-003 · INFO · All seeded employer invites are expired; the /invite/:token entry flow can't be demoed from seed data (confirmed)
**Location:** live table `employer_invites` (4 rows).

```
psql> SELECT status, count(*), max(expires_at) FROM employer_invites GROUP BY status;
pending | 4 | 2026-08-14 12:09:42+00      (today is 2026-08-24)
```
All four seeded invites are `status='pending'` but past `expires_at`, so `get_employer_invite`
raises `invite expired` and `/invite/<token>` lands on the "Invite unavailable" screen
(reproduced below). No UI surfaces these seed tokens, so a rep would normally mint a fresh
invite (7-day window) from the employer dashboard, which works — hence INFO, data staleness,
not a code defect. Flagged so whoever refreshes demo data re-seeds a live invite before an
invite-onboarding demo.

---

## Verification of the pre-registered CONFIRMED finding

### A03-001 (HIGH, A03-owned) — invite completion not bound to the invited phone — VERIFIED BY CODE
I independently read the live RPC and confirm A03's claim at the DB layer; I did **not**
reproduce a commit (all live invites are currently expired, so the completion RPC's own
`expires_at<=now()` guard blocks exploitation this instant, and G1/write-safety forbids
committing the `UPDATE`). Verbatim `prosrc` of `create_subscriber_from_employer_invite`:

- It normalises `payload->>'phone'` (caller-controlled) and looks up the existing
  subscriber by **that** phone — the invited phone in `v_inv.prefill` is never compared:
  `v_phone_norm := right(regexp_replace(COALESCE(payload ->> 'phone',''),'[^0-9]','','g'),9);`
- Re-tag branch: `UPDATE public.subscribers SET employer_id = v_inv.employer_id WHERE id = v_existing_id;`
- Then, unconditionally on every branch:
  `UPDATE public.subscribers SET compensation = COALESCE(NULLIF(v_inv.prefill ->> 'compensation','')::numeric,0) WHERE id = v_new_id;`

So a holder of any one valid token can supply an arbitrary phone to re-home / overwrite the
compensation of an unaffiliated live subscriber. This remains **A03's finding**; I report it
here as on-screen/at-DB corroboration, not as a new A16 id. The client (`SignupPage.jsx`
`/invite/:token` effect + `ContributionRoute` `createFromEmployerInvite`) faithfully forwards
whatever phone the KYC review step captured, adding no binding of its own.

---

## What PASSED (evidence highlights)

- **Full 9-step signup wizard** (id-upload → review → nira → otp → liveness → aml →
  beneficiaries → consent) renders cleanly at **375 and 1440**, 0 console errors, 0 error
  boundary; consent navigates to `/signup/contribution` which renders the "Finish setting
  up" `<h1>`. Walk stopped before "Pay" (no live write). Evidence:
  `scratch/a16/wizard.mjs`.
- **KYC failure terminals** both reachable and correct (forced via the documented
  `x-qa-force` header): NIRA `no-match` → inline "We couldn't verify you" block with retry
  + "Get help from an agent" → **agent-fallback** terminal ("We'll finish this with an
  agent"); AML `flagged` → **pending-review** terminal ("Your account is under review").
  Evidence: `scratch/a16/kyc-fail.mjs`, `kyc-fail2.mjs`.
- **Invite error paths** render a graceful "Invite unavailable" screen with a "Go to home"
  link: malformed token → body "invite not found" (RPC 500), expired real token → body
  "invite expired" (RPC 400). "Already used" verified from `prosrc`
  (`IF v_inv.status <> 'pending' THEN RAISE 'invite already used'`) — no `completed` invite
  exists live to reproduce. Evidence: `scratch/a16/invite.mjs`.
- **request-access write→triage:** POST returned `200 {"submitted":true,"id":"ar-…"}`, the
  "Request received" screen showed, the row landed in `access_requests` (status `pending`,
  `kind='employer'`) alongside the 4 existing pending demo rows; distributor variant
  correctly omits sector/district (`FIELD_ORDER.distributor` = 5 fields) and validates. Row
  deleted, 0 remain on all tags, total restored to 5. Evidence: `scratch/a16/reqaccess-write.mjs`.
- **nominee-claim write→triage:** POST returned `200 {"submitted":true,"id":"nc-…","reference":"NC-54F64285"}`,
  the "We have your claim" screen showed the reference; row landed in `nominee_claims`
  (status `pending`) among the 9 existing rows across all 4 triage statuses. Row deleted,
  0 remain, total restored to 9. The "reference-missing = hard error" guard is present in
  the service. Evidence: `scratch/a16/claim-write.mjs`.
- **Install banner + persistence** (iOS UA, 375): banner shows, tapping the X dismisses it,
  `localStorage['up-landing-install-dismissed']='1'`, and the banner stays hidden after a
  hard reload. Evidence: `scratch/a16/install.mjs`.
- **/admin vs /admin/login split:** `/admin` renders the Administrator landing page with an
  inline `LandingLoginCard` (real phone+OTP/password auth), `/admin/login` renders the bare
  super-admin portal; nothing in the app links to `/admin/login` (URL-only, by design).
- **catch-all** `/nonexistent-xyz` → `Navigate to="/"` (renders home). `/coming-soon`
  renders. `/claim` is reachable from the Footer ("Claim for a loved one") and the mobile
  menu sheet.

## Screenshots
All under `docs/audits/2026-08-23/screenshots/public/` — every public route at
`-375/-920/-1440`, the 8 wizard steps at `-375/-1440`, both KYC terminals, invite
malformed/expired, request-access filled+success, claim success, install banner, and the
nav-band probe at 769/800/900/950/1440.

---

## Traceability
| # | Check | Disposition |
|---|---|---|
| 1 | `/` renders + h1 (375/920/1440) | PASS |
| 2 | `/employers` renders + h1 | PASS |
| 3 | `/distributors` renders + h1 | PASS |
| 4 | `/admin` landing renders + inline login card + h1 | PASS |
| 5 | `/faq` renders; desktop h1 vs mobile no-h1 | FINDING A16-001 |
| 6 | `/contact` renders; desktop h1 vs mobile no-h1 | FINDING A16-001 |
| 7 | `/about` renders; desktop h1 vs mobile h3-start | FINDING A16-001 |
| 8 | `/request-access` (employer) renders; mobile no-h1 | FINDING A16-001 |
| 9 | request-access: every field mandatory (validation) | PASS |
| 10 | `/request-access?type=distributor` 5-field variant validates | PASS |
| 11 | request-access WRITE → access_requests → admin triage | PASS (tested+cleaned) |
| 12 | `/claim` renders + h1 all viewports + UI-reachable | PASS |
| 13 | nominee-claim WRITE → nominee_claims → triage + reference | PASS (tested+cleaned) |
| 14 | `/admin/login` super-admin portal renders | PASS (no h1 — folded into A16-001) |
| 15 | `/admin` vs `/admin/login` split; nothing links to portal | PASS |
| 16 | `/coming-soon` renders | PASS (no h1 — folded into A16-001) |
| 17 | catch-all `*` → `/` | PASS |
| 18 | wizard step1 id-upload renders (375/1440) | PASS |
| 19 | wizard step2 review renders + validation | PASS |
| 20 | wizard step3 nira auto-advance | PASS |
| 21 | wizard step4 otp renders | PASS |
| 22 | wizard step5 liveness renders | PASS |
| 23 | wizard step6 aml auto-advance | PASS |
| 24 | wizard step7 beneficiaries renders | PASS |
| 25 | wizard step8 consent renders | PASS |
| 26 | wizard step9 done/contribution-setup renders (pre-Pay) | PASS |
| 27 | agent-fallback terminal (NIRA no-match) | PASS |
| 28 | pending-review terminal (AML flagged) | PASS |
| 29 | NIRA no-match inline retry + agent CTA | PASS |
| 30 | invite malformed token → error screen | PASS |
| 31 | invite expired token → error screen | PASS |
| 32 | invite already-used → error | BLOCKED (no completed invite live; verified via prosrc) |
| 33 | invite valid-token happy-path walk | BLOCKED (all live invites expired; verified via prosrc) |
| 34 | A03-001 invite phone-binding | VERIFIED-BY-CODE (A03-owned; see above) |
| 35 | install banner shows (iOS) + dismissal persists across reload | PASS |
| 36 | nav CTA collapse ≤920 + 769–920 band gap | FINDING A16-002 |
| 37 | console errors on all public routes (375/920/1440) | PASS (0) |
| 38 | error boundary on all public routes | PASS (0) |
| — | seeded invites expired (data staleness) | FINDING A16-003 |
| — | OTP always-accepts / KYC vendor mocks / cosmetic MoMo pickers | EXCLUDED-DEMO-SCOPE |
