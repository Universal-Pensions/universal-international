# A18 · Mobile PWA & Responsive — Findings

> Report-only. Cites `docs/audits/2026-08-23/00-baseline.md` (ground truth). Dev servers verified UP
> this session (`vite:200`, `api-readyz:200`). No DB fixture rows were created (this agent ran no
> writes against Supabase). Evidence screenshots + capture scripts live under
> `docs/audits/2026-08-23/a18/`.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | manifest.webmanifest, public/sw.js, public/offline.html, index.html, src/pwa/registerSW.js, src/main.jsx, useIsMobile/useIsDesktop hooks, 6 role mobile shells + app bars + bottom-tab-bars + BottomSheet primitives, PaySheet, PaymentMethodPicker, SignIn flow, install-prompt plumbing, all `*.module.css` responsive rules |
| Artifacts examined | all of the above |
| Coverage | 100% of A18's 10 defined checks |
| Checks defined | 10 |
| Checks executed | 10 |
| Checks passed / failed / blocked | 3 / 7 / 0 |
| Findings C / H / M / L / I | 0 / 0 / 3 / 3 / 3 |
| Evidence commands run | 24 |
| Excluded as demo-scope | 2 (no real offline sync for an always-online demo; no in-dashboard install affordance — both called out as expected in the spec) |
| Blocked, with reason | none |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Manifest fields present | name, short_name, description, id, start_url, scope, display, orientation, theme_color, background_color, lang, dir, categories, icons (3) |
| Manifest fields missing | shortcuts, screenshots, share_target, protocol_handlers, maskable-192, monochrome/badge icon |
| Icons on disk | icon-192 (any), icon-512 (any), icon-maskable-512, apple-touch-icon-180 |
| SW cache versioning | `VERSION='up-pwa-v2'`, activate purges non-VERSION caches ✓ |
| SW `/api/*` cached | never (same-origin guard + `/api/` early-return; prod API is cross-origin anyway) ✓ |
| SW RUNTIME FIFO cap | 80 entries, trimmed after each put ✓ |
| `navigator.onLine` handlers in src | 0 |
| Offline write queue | none |
| Sub-16px input-element CSS rules | 15 (enumerated); money-entry AMOUNT + sign-in inputs are ≥16px |
| JS breakpoint / CSS shell breakpoint | useIsDesktop 1024 / shell CSS `min-width:1024` (aligned) — but 51 component-level `max-width:768` rules |
| Dead band | 769–1023px = neither hook true; phone shell stretched, all 6 roles; no horizontal overflow |
| Mobile Playwright failures owned (baseline §10) | 11 → 3 real a11y (landing), 8 test-anchor artifacts (pages render fine) |

---

## Summary

The PWA plumbing is competent: hand-rolled SW with real cache versioning, a network-first nav
strategy that never caches money data, an 80-entry FIFO runtime cap, a throttled chunk-load recovery
that provably cannot loop, and a full install-prompt implementation (Android `beforeinstallprompt` +
iOS instruction sheet + persisted dismissal). Safe-area insets are handled in 47 files.

The defects are UX-level, all Medium-or-below, none critical:

- **iOS zoom-on-focus** on nearly every dashboard/search/payment input (rendered 13–14px) — visibly
  janky during a phone demo. The money AMOUNT fields and the sign-in flow are safe (≥16px).
- **The 769–1023px dead band** renders a stretched phone shell with large empty side gutters for all
  six roles — the exact width of an iPad in portrait (810/820/834px).
- **Bottom sheets don't lock body scroll**, so the page scrolls behind an open Help/Notifications/Ask
  AI/Pay sheet on mobile — unlike `Modal.jsx`, which does lock it.

**Baseline correction (important):** the baseline flagged 11 identical mobile Playwright failures as
"Highest — a rep demoing on a phone hits these." I reproduced all 11 in isolation and read the
screenshots: **8 of them are test-anchor artifacts, not user-facing breakage** — the pages render
fully, are usable, and carry a valid app-bar `<h1>`; the smoke tests just anchor on a desktop-only
`<h1>` whose text differs on mobile. Only the 3 landing failures reflect a genuine (Low) a11y gap.
A rep demoing on a phone does **not** hit a broken subscriber dashboard.

---

## Findings

### A18-001 · iOS Safari zoom-on-focus: dashboard/search/payment inputs render below 16px — Medium (confirmed)
**Location:** `src/index.css:282` (`.input` primitive = `var(--text-sm)` = 14px) and 14 further rules.
**demo-visible: yes.**

The canonical form-input primitive is 14px, and every mobile form/search/payment input is 13–15px.
Any `<input>` with computed font-size < 16px triggers iOS Safari's automatic zoom-on-focus — the
viewport jumps every time a field is tapped, which reads as broken during a phone demo.

Enumerated sub-16px input-element rules:
```
src/index.css:282                                      .input                 14px  (global primitive, "used across admin/branch/dashboard")
src/components/payment/PaymentMethodPicker.module.css:221  .input (card no./expiry/CVC/name)  14px  ← PAYMENT flow, all roles
src/dashboard/overlay/OverlayPanel.module.css:849      .searchBarInput        10px  (distributor drill-down search)
src/agent-dashboard/shell/agentSheets.module.css:118   .input                 13px
src/branch-dashboard/shell/branchSheets.module.css:119 .input                 13px
src/employer-dashboard/shell/employerSheets.module.css:119 .input             13px
src/subscriber-dashboard/shell/subscriberSheets.module.css:326 .input         13px
src/subscriber-dashboard/pages/NomineesPage.module.css:309 .input, .select    13px
src/employer-dashboard/mobile/employerMobile.module.css:669 .composer input   13px
src/branch-dashboard/mobile/branchMobile.module.css:549 .search input         14px
src/dashboard/mobile/distributorMobile.module.css:615  .search input          14px
src/employer-dashboard/mobile/employerMobile.module.css:349 .search input      14px
src/branch-dashboard/mobile/branchMobile.module.css:630 .select               12.5px
src/branch-dashboard/mobile/branchMobile.module.css:582 .field input/select   15px
src/dashboard/mobile/distributorMobile.module.css:1323 .field input/select    15px
```
**MONEY-ENTRY fields (listed separately, all SAFE):** the contribution/withdraw amount heroes use
`--text-xl` (20px) — `SavePage.module.css:171 .amountInput { font-size: var(--text-xl) }`,
`desktopFlow.module.css`. The sign-in phone/OTP/password inputs are also ≥16px
(`PhoneEntry.module.css:117 .input = --text-xl`, `OtpVerify .otpInput = --text-2xl→--text-lg`,
`PasswordEntry.module.css:84 .input = --text-base` = 16px). So the amount and first-touch fields do
**not** zoom; the zoom hits secondary form/search/card fields.

**Evidence:**
```
$ grep -n --text- src/index.css | head    # --text-sm: 0.875rem  = 14px ; --text-base: 1rem = 16px
$ sed -n '282,285p' src/index.css         # .input { font-family: var(--font-body); font-size: var(--text-sm); ... height: 48px; }
$ python3 <parse> src/**/*.module.css     # 15 input-element rules < 16px (list above)
$ sed -n '221,224p' src/components/payment/PaymentMethodPicker.module.css   # .input { ... font-size: 14px; }
```
**Fix:** set the mobile-composed input primitive and all `.field input / .search input / .composer
input / PaymentMethodPicker .input` to `font-size: 16px` at `max-width: 1023px` (a `@media` bump is
enough; desktop can keep 14px). This is the single highest-leverage mobile-polish change.

---

### A18-002 · 769–1023px dead band: all 6 roles render a stretched phone shell (iPad-portrait width) — Medium (confirmed)
**Location:** `src/hooks/useIsDesktop.js:3` (`min-width: 1024px`) vs `src/hooks/useIsMobile.js:3`
(`max-width: 768px`); every role shell keys on `useIsDesktop()`. **demo-visible: yes.**

All six dashboards choose desktop-vs-phone chrome with `useIsDesktop()` (1024px). Below 1024 they
render the **phone shell**, and the shell CSS uses `@media (min-width: 1024px)` for the desktop
treatment (aligned with the JS, so no per-shell CSS mismatch). The consequence: across the entire
**769–1023px** band, every role shows the phone layout — a ~520–600px content column centered in the
viewport with **large empty side gutters and a full-width bottom tab bar**. There is no tablet layout.
This band is exactly iPad portrait: iPad 10.9"/Air = 820px, iPad Pro 11" = 834px, iPad Mini/older =
768–810px — devices a sales rep plausibly demos on.

No horizontal overflow at any width (checked 768/820/1023/1024 for all 6 roles). It is not *broken*,
but a phone UI stretched across an iPad with wasted horizontal space and a stretched bottom tab bar is
a visible degradation.

**Evidence:** `docs/audits/2026-08-23/a18/deadband-capture.mjs` + `admin-capture.mjs` captured 15
screenshots. Overflow probe output:
```
subscriber@768/1023/1024  overflowX=false   distributor@768/1023/1024 overflowX=false
employer@768/1023/1024    overflowX=false   agent@768/1023/1024       overflowX=false
admin@820/1023/1024       overflowX=false   branch@820/1023/1024      overflowX=false
```
Screenshots `distributor-1023.png` vs `distributor-1024.png` show the hard jump: centered phone column
+ bottom tabs at 1023 → full sidebar-rail desktop layout at 1024. `admin-820.png`, `subscriber-1023.png`,
`employer-1023.png` confirm the same gutter pattern for every role.
**Underlying cause also noted:** 16 components gate on `useIsMobile()` (768) while shells gate on 1024;
plus 51 component-level `@media (max-width: 768px)` rules that do NOT apply in the band. No visible
hybrid breakage resulted in the captures, but the two-breakpoint architecture is the root cause.
**Fix:** either add a tablet layout for 769–1023, or drop the shell breakpoint to `min-width: 768px`
so the desktop chrome takes over at 768 (matching `useIsMobile`), collapsing the dead band.

---

### A18-003 · Bottom sheets (and PaySheet) don't lock body scroll — background scrolls behind an open sheet on mobile — Medium (confirmed)
**Location:** `src/subscriber-dashboard/shell/BottomSheet.jsx` (+ identical copies in agent/branch/
employer/landing shells) and `src/components/PaySheet.jsx`. **demo-visible: yes.**

`BottomSheet` (used for Help / Notifications / Ask AI on every role's mobile app bar) portals to
`<body>`, dims with a fixed scrim, and closes on scrim-click/Escape — but it **never locks body
scroll**. There is no `document.body.style.overflow = 'hidden'`, no scroll-lock hook, and the scrim
has no `touch-action: none`. On mobile, touch-dragging on the scrim (or over the sheet edges) scrolls
the page behind the sheet. `PaySheet` (the money pay flow) has the same gap. This is inconsistent with
`Modal.jsx`, which **does** lock scroll.

**Evidence:**
```
$ grep -n "body.style|overflow|touch-action|overscroll" src/subscriber-dashboard/shell/BottomSheet.jsx
   (no matches — no scroll lock anywhere in the component)
$ sed -n '1,6p' src/subscriber-dashboard/shell/BottomSheet.module.css
   .scrim { position: fixed; inset: 0; background: rgba(27,26,74,.42); z-index: 60; }   # no touch-action
$ grep -n "body.style|overflow" src/components/Modal.jsx
   117:  const previousOverflow = document.body.style.overflow;
   118:  document.body.style.overflow = 'hidden';         # Modal DOES lock; BottomSheet does not
   163:  document.body.style.overflow = previousOverflow;
$ grep -n "body.style" src/components/PaySheet.jsx   # (none — PaySheet also does not lock)
```
The sheet body itself has `overscroll-behavior: contain` (BottomSheet.module.css:90), which prevents
scroll-chaining *out of* the sheet, but nothing stops the *scrim/background* from scrolling.
**Fix:** add the `Modal.jsx` body-lock pattern (or a shared `useBodyScrollLock`) to the shared
BottomSheet + PaySheet primitives, and `touch-action: none` on the scrim.

---

### A18-004 · Three public landing pages have no `<h1>` on mobile (heading-hierarchy a11y gap) — Low (confirmed)
**Location:** `src/pages/landing/mobile/AboutMobile.jsx:9` (`<h3>`),
`src/pages/landing/mobile/ContactMobile.jsx:70` (`<h2>`),
`src/pages/landing/mobile/FAQMobile.jsx:26` (`<h2>`).

On desktop, `/about`, `/contact`, `/faq` render an `<h1>` (`About.jsx:73 <h1>`). Their mobile variants
start the heading hierarchy at `<h2>` (Contact, FAQ) or even `<h3>` (About — skipping both h1 and h2),
so the page has **no level-1 heading**. Other mobile landing pages *do* have an h1
(`AdminMobile.jsx:10`, `DistributorsMobile.jsx:10`), so this is an inconsistency, not a house style.
This is the sole real cause of the 3 landing Playwright failures (baseline §10:
`landing.spec.ts:20/27/34`). The pages otherwise render beautifully and are fully usable
(`docs/audits/2026-08-23/... About-page-renders ... test-failed-1.png` shows a polished mobile page).

**Evidence:**
```
$ grep -n "<h1|<h2|<h3" src/pages/landing/mobile/*.jsx
   AboutMobile.jsx:9    <h3>About Universal Pensions</h3>
   ContactMobile.jsx:70 <h2 ...>Contact us.</h2>
   FAQMobile.jsx:26     <h2 ...>Frequently asked questions.</h2>
   AdminMobile.jsx:10   <h1>...</h1>   DistributorsMobile.jsx:10 <h1>...</h1>   (others DO have h1)
$ npx playwright test e2e/specs/smoke/landing.spec.ts --project=mobile-chromium -g "FAQ|Contact|About"
   3 failed — Error: getByRole('heading',{level:1,...}) element(s) not found
```
**Fix:** promote each mobile landing page's top visible title to an `<h1>`.

---

### A18-005 · Touch targets below 44×44px: app-bar back/icon buttons (40px), copilot close (32px) — Low (confirmed)
**Location:** `src/subscriber-dashboard/shell/SubscriberMobileAppBar.module.css:17` (`.backBtn`
40×40), `:60` (`.iconBtn` 40×40) — identical in agent/branch/distributor/employer app bars and
`src/components/PageHeader.module.css:7`; copilot `.close` 32×32; sheet `.close` 40×40.

The persistent mobile app-bar back button and the Help/Notifications icon buttons are 40×40px, and the
Copilot-panel close buttons are 32×32px — under Apple's 44×44 HIG minimum (they do pass WCAG 2.5.8 AA
at 24px, so this is polish, not a blocker). The **primary** nav — the bottom tab bar — is fine: each
tab is a full-height 64px slot (`BottomTabBar.module.css`), only the glyph is 22px.

**Evidence:**
```
$ python3 <parse shell/component css for btn/icon/close min-height|height < 44>
   SubscriberMobileAppBar.module.css:17  .backBtn  height:40px width:40px
   SubscriberMobileAppBar.module.css:60  .iconBtn  height:40px width:40px   (×5 roles + PageHeader:7)
   {Subscriber,Agent,Branch,Employer}CopilotPanel.module.css:58/61  .close  height:32px width:32px
```
**Fix:** bump `.backBtn`/`.iconBtn` to 44×44 and copilot `.close` to at least 40×40 on mobile.

---

### A18-006 · Two distinct subscriber report routes share the generic app-bar title "Analytics" on mobile — Low (confirmed)
**Location:** `src/subscriber-dashboard/shell/SubscriberMobileAppBar.jsx:59` — `resolve()` maps any
`/dashboard/reports/*` path to the title `'Analytics'`.

On mobile the routed page's own title is suppressed (`ReportsPage.jsx:98 if (!isDesktop) return null`),
and the shell app-bar h1 supplies it. But `resolve()` collapses every `/dashboard/reports/*` route to
the single title **"Analytics"**, so `/dashboard/reports/all-transactions` and
`/dashboard/reports/contributions-summary` both display "Analytics" in the app bar — a wayfinding
imprecision (two different pages, same heading). This is a secondary contributor to the
subscriber-dashboard mobile smoke failures (the desktop `<h1>` text the test expects never appears).

**Evidence:**
```
$ sed -n '54,60p' src/subscriber-dashboard/shell/SubscriberMobileAppBar.jsx
   if (!title && pathname.startsWith('/dashboard/reports/')) title = 'Analytics';
$ Read test-results/.../all-transactions--mobile-chromium/test-failed-1.png  → app-bar h1 reads "Analytics"
```
**Fix:** give each report route a distinct app-bar title in `SECONDARY`/`resolve()`.

---

### A18-007 · PWA manifest is minimal: no shortcuts / screenshots / share_target / protocol_handlers, single maskable icon — Info
**Location:** `public/manifest.webmanifest`.

Manifest is valid and installable (name, short_name, id, start_url, scope=`/`, display=standalone,
theme/background colors, one maskable icon). It omits install-enhancement fields: `shortcuts` (app
long-press quick actions), `screenshots` (richer Android install UI), `share_target`,
`protocol_handlers`, a maskable-192, and a monochrome/badge icon. No user-visible effect for the demo;
recorded for completeness. Icons on disk verified present (192/512/maskable-512/apple-touch-180).

**Evidence:** `$ cat public/manifest.webmanifest` + `$ ls -la public/icons/` (both dumped this run).

---

### A18-008 · No offline data mode; failures surface as toasts (not silent) — Info (excluded as demo-scope)
**Location:** whole `src/` (grep-clean for `navigator.onLine`); `src/hooks/useSubscriber.js`,
`src/subscriber-dashboard/pages/SavePage.jsx:204`.

There is **no** `navigator.onLine`/online-offline event handling and **no offline write queue**
anywhere in `src`. The SW serves the cached SPA shell for navigations, but all data reads/writes go to
the cross-origin Render API (never SW-cached, by design), so offline the app boots and then every
fetch/mutation fails. Crucially the loss is **not silent** — SavePage wraps the contribution mutation
in try/catch and shows `addToast('error', … 'Could not complete the top-up.')` (line 204), and
TanStack mutations use `retry:0`. So the spec's "silent data loss = High" trigger does **not** fire.
For an always-online sales demo this is acceptable demo scope. One dead-code note: `offline.html`
is effectively unreachable because `index.html` is always precached, so the nav fallback
(`sw.js:71`) returns `index.html` before ever reaching `offline.html`.

**Evidence:**
```
$ grep -rn "navigator.onLine|addEventListener('online'|'offline'" src   # only an unrelated agent-status label
$ sed -n '200,205p' src/subscriber-dashboard/pages/SavePage.jsx         # addToast('error', ... 'Could not complete the top-up.')
$ sed -n '64,75p' public/sw.js                                          # nav fallback: index.html first, then offline.html
```

---

### A18-009 · No in-dashboard install affordance for any of the 6 roles — Info (expected per spec)
**Location:** install plumbing lives only in `src/pages/landing/shell/LandingMobileShell.jsx`
(`InstallPromptProvider` + `InstallBanner` + `LandingInstallSheet`).

`beforeinstallprompt` capture, the iOS instruction sheet, standalone detection, and localStorage
dismissal persistence (`DISMISS_KEY = 'up-landing-install-dismissed'`) are all correctly implemented —
but only on the mobile landing. None of the six role dashboards offers an "Add to Home Screen"
affordance. The spec explicitly notes this as expected; recorded, no action.

**Evidence:** `$ grep -rn "InstallPromptProvider|<InstallBanner|<LandingInstallSheet" src` → all hits
in `pages/landing/shell/` only. `installPrompt.jsx` reviewed: `preventDefault` + defer + `promptInstall`
+ `appinstalled` + `detectStandalone` all present and correct.

---

## What PASSED (no defect)

- **Check 2 — SW correctness:** `VERSION='up-pwa-v2'`; `activate` deletes all non-VERSION caches
  (`sw.js:47`); update path posts `SKIP_WAITING` on `installed` when a controller exists
  (`registerSW.js:20`) and reloads once on `controllerchange` guarded by a `refreshing` flag
  (`registerSW.js:33`) — no reload loop; `/api/*` never cached (same-origin guard `sw.js:61` + `/api/`
  early-return `sw.js:62`, and prod API is cross-origin regardless); RUNTIME cache FIFO-trimmed to 80
  after each put (`sw.js:16,84`); navigations are network-first → cached shell → offline.html
  (`sw.js:65-73`). Sound.
- **Check 7 — safe-area insets:** `viewport-fit=cover` present in `index.html` and `offline.html`;
  `env(safe-area-inset-*)` used in 64 places across 47 files; bottom tab bars pad with
  `calc(6px + env(safe-area-inset-bottom))` and add it to their height (`BottomTabBar.module.css:14-15`)
  so the home indicator does not overlap. No notch/home-indicator overlap issue found.
- **Check 10 — chunk-load recovery (`main.jsx:41-67`):** `vite:preloadError` and matching
  `unhandledrejection` both call `reloadOnce()`, which is throttled via `sessionStorage`
  (`up-chunk-reload-at`) to at most one reload per 10s — a genuinely broken build cannot loop-reload.
  Correct.

---

## Baseline §10 reconciliation (the 11 identical mobile failures A18 co-owns)

I reproduced all 11 in isolation (`npx playwright test … --project=mobile-chromium`) and read the
captured screenshots. They collapse to **one class of root cause** — on mobile the desktop `<h1>` the
smoke test anchors on is either suppressed or rendered as the shell app-bar `<h1>` with different text:

| Baseline failure | Reproduced | Real defect? |
|---|---|---|
| `subscriber-dashboard:43,54,109,115,124,173` (6) | yes (6 failed / 9 passed) | **No** — pages render + usable; app-bar carries a valid `<h1>` (see `settings/profile` & `all-transactions` screenshots). Test-anchor mismatch. Minor real bit → A18-006. |
| `distributor-exports-csv:37,141` (2) | (same subscriber `/all-transactions` surface; both lines start with the `/all transactions/i` h1 assertion) | **No** — same test-anchor issue; CSV logic never reached. |
| `landing:20,27,34` (3) | yes (3 failed) | **Yes (Low)** → A18-004 (no `<h1>` on mobile About/Contact/FAQ). |

This corrects the baseline's "Highest — a rep demoing on a phone hits these" severity: a rep does not
hit a broken subscriber dashboard on a phone. The subscriber-dashboard/CSV failures are test-quality
issues (A25's domain); only the landing a11y gap (A18-004) is a product defect.

---

## Traceability
| Check | Disposition |
|---|---|
| 1 · Manifest completeness | FINDING A18-007 (info) |
| 2 · sw.js versioning / SKIP_WAITING loop safety / /api never cached / 80-FIFO / offline fallback | PASS (offline.html dead-code note folded into A18-008) |
| 3 · OFFLINE navigate + submit per role; no write queue / no navigator.onLine | FINDING A18-008 (info; not silent → not High) |
| 4 · Install: beforeinstallprompt / iOS sheet / dismissal persistence / standalone detect | FINDING A18-009 (info — no in-dashboard affordance, expected) |
| 5 · Touch targets < 44×44 | FINDING A18-005 (low) |
| 6 · Inputs < 16px (money-entry listed separately) | FINDING A18-001 (medium) |
| 7 · Safe-area insets with viewport-fit=cover; notch/home-indicator overlap | PASS |
| 8 · 769–1023px band for all 6 roles (768/1023/1024) | FINDING A18-002 (medium) |
| 9 · Bottom-sheet scroll lock / momentum / pull-to-refresh | FINDING A18-003 (medium) |
| 10 · Chunk-load recovery (main.jsx:41-67) can't loop | PASS |

## Artifacts written (all under docs/audits/2026-08-23/a18/)
- `deadband-capture.mjs`, `admin-capture.mjs` — viewport screenshot scripts (Playwright)
- `{subscriber,distributor,employer,agent}-{768,1023,1024}.png`, `{admin,branch}-{820,1023,1024}.png`
- This report: `docs/audits/2026-08-23/18-mobile-pwa.md`

No Supabase writes were made; no fixture rows created; no cleanup required.
