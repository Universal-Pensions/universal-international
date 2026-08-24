# A20 · Accessibility Audit

**Agent:** A20 · **Date:** 2026-08-24 · **Scope:** report-only (G1–G10 honoured)
**Baseline cited:** `docs/audits/2026-08-23/00-baseline.md`, `00c-frontend-groundtruth-corrections.md`
**Method:** live axe-core sweep (108 scans) + palette contrast math + runtime focus/skip probes + lint histogram.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 108 axe scans (54 role×route combos × 2 viewports) + 87 CSS tokens + 310 jsx-a11y warnings + 40 dialog surfaces + skip-link/landmark/lang |
| Artifacts examined | 108 axe scans + all of the above |
| Coverage | 100% of the representative static route set per role (caveat: `:param` detail routes and modal-/wizard-gated forms were not force-opened during the axe scan) |
| Checks defined | 9 |
| Checks executed | 9 |
| Checks passed / failed / blocked | 2 / 7 / 0 |
| Findings C / H / M / L / I | 0 / 0 / 5 / 5 / 1 |
| Evidence commands run | 34 |
| Excluded as demo-scope | 1 (absence of an i18n library — Info-level only per spec; `@axe-core/playwright` itself is flagged for removal, not a defect) |
| Blocked, with reason | none |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Routes swept (distinct role×route) | 54 (public 10, subscriber 11, agent 6, branch 6, distributor 6, employer 6, admin 9) |
| Total axe scans (× desktop+mobile) | 108 — **all 108 completed, 0 scan errors** |
| Scans with ≥1 violation | 47 / 108 |
| Total violation instances | 67 — **all impact = serious** (0 critical, 0 moderate, 0 minor) |
| Distinct axe rules failing | 3 (`color-contrast`, `scrollable-region-focusable`, `aria-hidden-focus`) |
| axe label/name violations | **0** across all 108 scans (contradicts the 284 label lint warnings) |
| jsx-a11y lint warnings | 310 (9 rules); 96% of the 323 total lint warnings |
| `role="dialog"` / `aria-modal` in source | 19 / 21 |
| Dialog surfaces WITH focus trap+restore | 4 patterns (Modal.jsx + landing BottomSheet + SignInModal + EmployerSlidePanel) — copy-pasted, no shared util |
| Dialog surfaces MISSING focus trap/restore | 5 (subscriber/branch/employer/agent BottomSheet + PaySheet) |
| Palette color tokens tested vs AA-on-white | 18; **7 fail even at large text**, 5 pass large-only, 6 pass normal |
| text-on-indigo contrast | **13.18:1 — PASS** (white) / 8.63:1 muted — PASS |

---

## Check-by-check findings

### Check 1 — axe sweep (the sanctioned throwaway spec)
Wrote `e2e/specs/a11y/axe-sweep.spec.ts` (now **DELETED**, see Cleanup), ran it over 54 role×route
combos on desktop (chromium 1440×900) and mobile (iPhone SE 375×667 via a throwaway config in the
audit dir), tagged `wcag2a/2aa/21a/21aa`. Raw per-scan JSON retained under
`docs/audits/2026-08-23/a20/axe-results/` (108 files).

```
$ npx playwright test e2e/specs/a11y/axe-sweep.spec.ts --project=chromium
  54 passed (39.5s)
$ npx playwright test --config=docs/audits/2026-08-23/a20/mobile-axe.config.ts
  54 passed (36.7s)
$ node aggregate  # over 108 result files
scans: 108 scansWithViolations: 47 totalViolationInstances: 67
--- by impact --- 67 serious
--- by rule --- 46 color-contrast | 17 scrollable-region-focusable | 4 aria-hidden-focus
```
**No `critical`, `moderate`, or `minor` violations, and no `label`/`aria-input-field-name` violations
anywhere.** The rendered-DOM a11y problem is narrow (3 rules), not the sprawling 300+ the lint implies.
→ FINDINGS **A20-002** (contrast), **A20-004** (aria-hidden-focus), **A20-005** (scrollable-region).

### Check 2 — jsx-a11y lint by rule + effort to ratchet
Authoritative histogram (baseline `lint.txt`, re-verified). **310 jsx-a11y warnings** (not 311):

| Count | Rule | Genuine rendered defect? | Effort to ratchet to `error` |
|---|---|---|---|
| 139 | `control-has-associated-label` | Mostly NO (axe found 0 name violations) | **L** — many icon-only buttons already have `aria-label`; rule is over-eager |
| 137 | `label-has-for` | NO — deprecated, over-strict (wants nesting+id) | **S** — replace rule with `label-has-associated-control`, most clear |
| 10 | `aria-role` | **NO — all 10 are the `NotificationBell role=` prop collision** | **S** — rename prop (A20-008) |
| 8 | `label-has-associated-control` | Partly | **M** |
| 6 | `no-autofocus` | Yes (minor) | **S** — 6 sites (A20-009) |
| 4 | `anchor-is-valid` | Yes | **S** — `SubscribersMobile.jsx`, `LandingMenuSheet.jsx` |
| 3 | `no-noninteractive-element-to-interactive-role` | Yes | **S** — `LivenessStep.jsx`, `ReviewStep.jsx` |
| 2 | `interactive-supports-focus` | Yes | **S** — `ReportTable.jsx`, `PhoneEntry.jsx` |
| 1 | `no-static-element-interactions` | Yes | **S** — `BranchDesktopShell.jsx` |

→ FINDING **A20-007** (untracked backlog; the two 130+ buckets are largely noise).

### Check 3 — the 10 `jsx-a11y/aria-role` warnings: genuine invalid roles only
Read all 10 sites. **All 10 are `<NotificationBell role="..." />`** — a React prop, never a DOM ARIA
attribute (00c ground truth, now confirmed across all 6 roles, not just the 3 agent sites the plan
cited):
```
admin-dashboard/AdminDashboardShell.jsx:411   role="admin"
admin-dashboard/shell/AdminMobileAppBar.jsx:95 role="admin"
agent-dashboard/shell/AgentDesktopShell.jsx:134 role="agent"
agent-dashboard/shell/AgentMobileAppBar.jsx:115 role="agent"
agent-dashboard/shell/SideNav.jsx:103         role="agent"
branch-dashboard/shell/BranchDesktopShell.jsx:132 role="branch"
dashboard/shell/DistributorMobileAppBar.jsx:88 role="distributor"
dashboard/sidebar/Sidebar.jsx:680             role="distributor"
employer-dashboard/shell/EmployerDesktopShell.jsx:120 role="employer"
employer-dashboard/shell/EmployerMobileAppBar.jsx:110 role="employer"
```
`NotificationBell`'s only rendered DOM role is `role="region"` (valid). **Genuine invalid ARIA roles:
0.** → **Check PASSES** (no invalid roles); documented as lint-noise finding **A20-008**.

### Check 4 — `<html lang="en">` vs `en-UG` formatters
`index.html:2` `<html lang="en">`; every formatter uses `en-UG` (`src/utils/currency.js:16`,
`src/utils/date.js:11` `LOCALE='en-UG'`; 18 direct `en-UG` call sites; `og:locale` = `en_UG`). Content
is English, so the mismatch is cosmetic for screen-reader pronunciation (en vs en-UG are both English) —
no material user-visible effect. → FINDING **A20-010** (Info).

### Check 5 — focus management (no focus-trap utility; 21 aria-modal / 19 role=dialog)
Confirmed absent: no shared focus-trap utility. The shared `src/components/Modal.jsx` is
**exemplary** — initial focus (with mount-retry), Tab/Shift+Tab trap, focus restore on close, Escape,
`aria-modal`, `aria-labelledby`, `tabIndex=-1` container. 16 files import it.

But the trap logic is **copy-pasted, not shared**, and 5 hand-rolled dialog surfaces drifted:

| Surface | role/aria-modal | Escape | Focus trap | Initial focus | Restore |
|---|---|---|---|---|---|
| subscriber `shell/BottomSheet.jsx` | ✅ | ✅ | ❌ | ❌ | ❌ |
| branch `shell/BottomSheet.jsx` | ✅ | ✅ | ❌ | ❌ | ❌ |
| employer `shell/BottomSheet.jsx` | ✅ | ✅ | ❌ | ❌ | ❌ |
| agent `shell/BottomSheet.jsx` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **`components/PaySheet.jsx` (payment)** | ✅ | **❌** | ❌ | ❌ | ❌ |
| landing `shell/BottomSheet.jsx` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `SignInModal.jsx`, `EmployerSlidePanel.jsx` | ✅ | ✅ | ✅ | ✅ | ✅ |

An `aria-modal="true"` dialog that doesn't trap focus violates the modal contract: the SR is told the
rest of the page is inert while the keyboard tab-ring still walks into it, and on close focus is lost
to `<body>`. → FINDING **A20-003**.

### Check 6 — colour contrast (87-token palette + real screenshots + text-on-indigo)
Computed WCAG ratios for the palette (AA normal ≥4.5, large ≥3.0):

| Token | on white | verdict |
|---|---|---|
| `--color-status-warning #E6A817` | 2.10 | **FAIL** |
| `--color-amber #FBBF24` | 1.67 | **FAIL** |
| `--color-positive #4ADE80` | 1.74 | **FAIL** |
| `--color-accent-mint #2DD4BF` | 1.86 | **FAIL** |
| `--color-alert #F87171` | 2.77 | **FAIL** |
| `--color-medal-silver #94A3B8` | 2.56 | **FAIL** |
| `--color-green / status-good #2E8B57` | 4.25 | large-only |
| `--color-teal #2F8F9D` | 3.79 | large-only |
| `--color-kyc-warning-amber #c47c00` | 3.37 | large-only |
| `--color-gray #646A80` | 5.36 | PASS |
| `--color-slate #2F3550` | 12.03 | PASS |

**text-on-indigo is fine:** white on `#292867` = **13.18:1**; `on-indigo-muted` (78% white) = 8.63:1.
Rendered (axe, actual fg/bg): green "active" status pills = `#2e8b57` on `#e2efe7` tint = **3.58:1**
(10px bold, needs 4.5) on every agent/branch/admin table; the green **positive money value** on the
subscriber Save & Withdraw screens = `#2e8b57` on white = **4.24:1** (14px bold, needs 4.5). Public
footer failures below.
→ FINDINGS **A20-001** (footer), **A20-002** (pills/chips/money value).

### Check 7 — forms (labels, aria-invalid 31, aria-describedby 17 vs input count)
Counts (excluding tests): 206 `<input>` + 16 `<select>` + 16 `<textarea>` = 238 controls; 159
`<label>` (117 with `htmlFor`); `aria-invalid` 31 sites; `aria-describedby` 17; only 2 inputs carry
`aria-label`. **Despite 284 label lint warnings, axe found ZERO rendered label/name violations** on the
108 scanned routes — including the public `/request-access` and `/claim` forms and subscriber
`/dashboard/settings/profile` (all `violations: NONE`). So the fields that render at page load have
accessible names (nested label text / wrapping). **Check PASSES at render.** Caveat: modal- and
wizard-gated forms (KYC signup steps, admin Create* modals) were not force-opened, so their labelling
is not fully cleared. Folded into A20-007.

### Check 8 — screen-reader walkthrough of the 3 money screens
- **Subscriber Save** (`SavePage.jsx`): amount error is `role="alert"` with `id="save-amount-error"`;
  success/confirmation via `Toast.jsx` (`aria-live="polite"`). ✅
- **Subscriber Withdraw** (`WithdrawPage.jsx`): amount slider has
  `aria-valuetext="{amount} of {max}"` (announces the money value as it changes) and
  `aria-label`; errors/confirmations via Toast (`aria-live`). ✅
- **Admin NAV publish** (`AdminNavDesktop.jsx` / `AdminNavMobile.jsx`): form error `role="alert"`;
  success ("Price saved… now show at X per unit") via `addToast('success', …)` → Toast
  `aria-live="polite"`. ✅
- **Balance announcement:** the subscriber Total balance uses `useCountUp` over 1100ms
  (`HomeDesktop.jsx:164`) rendered as plain text with **no `aria-live` and not `aria-hidden`** — the
  final value is readable but a balance *change* is not proactively announced, and the count-up
  mutates silently. → FINDING **A20-011** (Low; the action itself is confirmed via Toast).

### Check 9 — skip link works and lands on `<main id="main">`
Runtime probe on `/`:
- First `Tab` focuses `<a class="skip-link" href="#main">Skip to main content</a>` (first in tab
  order). ✅
- On focus it animates into view (`top:0`, `visibility:visible`, matches `:focus-visible`). ✅
  (an initial reading of `top:-37` was a mid-transition artifact; re-measured after 400ms = `top:0`.)
- `id="main"` is present on **every** top-level surface (landing pages, login, signup, all 6
  dashboards). ✅
- **BUT** activating the link sets `location.hash="#main"` while `document.activeElement` stays
  `<body>` and `<main id="main">` has **no `tabindex="-1"`** → keyboard focus is not moved into main;
  it relies on Chrome's sequential-focus-start heuristic, which is inconsistent across browsers/SRs.
  Two surfaces also use `<div id="main">` instead of a `<main>` landmark (`App.jsx:71` ComingSoon,
  `AdminLogin.jsx:33`). → FINDING **A20-006** (Low). Skip-link mechanics otherwise **PASS**.

---

## Findings

### A20-001 · Medium · confirmed — Public footer nav links are invisible (1.35:1) on desktop
**Location:** `src/components/Footer.module.css` `.link` (interacts with `src/index.css:189` `a{color:inherit}`)
**Evidence:**
```
$ node (playwright, viewport 1440) getComputedStyle of footer link "Subscribers"
{ "text":"Subscribers","href":"/","color":"rgb(47, 53, 80)","bg":"rgb(27, 26, 74)","cls":"_link_1tlk9_42" }
$ axe on / (chromium)  color-contrast (serious):
  ._link_1tlk9_42[href="/"]        fg=#2f3550 bg=#1b1a4a ratio=1.35  expected=4.5
  ._regulatory_1tlk9_35            fg=#5d5e85 bg=#1b1a4a ratio=2.63  expected=4.5
  ._groupLabel_1tlk9_48 ...        fg=#7a7b9e bg=#1b1a4a ratio=3.98  expected=4.5
```
The intended `.link` colour is lavender (`rgba(217,220,242,0.55)`), but the routed `<Link>` anchors
render at the inherited body slate (`--color-slate #2F3550`) on the deep-indigo footer — 1.35:1,
effectively unreadable. On the prospect-facing marketing site (`/`, `/employers`, `/distributors`,
`/admin`, `/faq`, `/contact`, `/about`).
**Impact:** the entire footer link nav appears blank/broken to any viewer during a demo; total a11y
failure for low-vision users.
**Suggested fix (do not apply):** set an explicit light colour on `.footer a` / `.link` (e.g.
`color: var(--color-lavender)` or the existing rgba) with enough specificity to beat `a{color:inherit}`.

### A20-002 · Medium · confirmed — Widespread AA contrast failures incl. status pills & the green money value
**Location:** shared status-pill/chip styles (`_statusPill`, `_chg`, `_rankChip`, `_headBadge`) + `SavePage.jsx`/`WithdrawPage.jsx` `_sumValPos`; palette tokens in `src/index.css`
**Evidence:**
```
axe color-contrast (serious): 46 / 108 scans, 38 distinct role×route surfaces incl. public /,/about,/faq
 agent /dashboard/subscribers  _statusPill[data-tone=active]  fg=#2e8b57 bg=#e2efe7 ratio=3.58 (10px bold, need 4.5)
 subscriber /dashboard/save     _sumValPos                     fg=#2e8b57 bg=#ffffff ratio=4.24 (14px bold, need 4.5)
 subscriber /dashboard/withdraw _sumValPos                     fg=#2e8b57 bg=#ffffff ratio=4.24
palette on white: status-warning 2.10, amber 1.67, positive 1.74, accent-mint 1.86, medal-silver 2.56 (all FAIL)
```
**Impact:** status semantics (active/full/pending), trend chips, and a **money figure** on the two
subscriber money screens are below AA. The pills recur on every agent/branch/admin table. text-on-indigo
is unaffected (13.18:1).
**Suggested fix (do not apply):** darken the green to ≥`#1f6e44` (already a token, 6.23:1) for pill/value
text, or enlarge/bolden; re-tone amber/mint/silver used as text.

### A20-003 · Medium · confirmed — aria-modal dialogs without focus trap/restore (incl. PaySheet)
**Location:** `src/subscriber-dashboard/shell/BottomSheet.jsx`, `src/branch-dashboard/shell/BottomSheet.jsx`, `src/employer-dashboard/shell/BottomSheet.jsx`, `src/agent-dashboard/shell/BottomSheet.jsx`, `src/components/PaySheet.jsx`
**Evidence:**
```
$ focus audit (grep role/aria-modal, Escape, focus trap, restore, .focus())
subscriber BottomSheet  dialog:✅ esc:✅ trap:❌ restore:❌ focus():❌
branch/employer/agent   dialog:✅ esc:✅ trap:❌ restore:❌ focus():❌
PaySheet                dialog:✅ esc:❌ trap:❌ restore:❌ focus():❌   (role="dialog" aria-modal="true", createPortal)
```
Contrast with `Modal.jsx` (full trap+restore) and landing BottomSheet/SignInModal/EmployerSlidePanel
(also full) — the logic is copy-pasted, and these 5 drifted.
**Impact:** keyboard/SR users tab out of the "modal" into the inert page behind it; on close, focus is
dropped to `<body>`; PaySheet (a payment surface) can't even be dismissed with Escape.
**Suggested fix (do not apply):** extract Modal.jsx's focus-trap into a shared `useFocusTrap` hook and
apply it to every `aria-modal` surface; add an Escape handler to PaySheet.

### A20-004 · Medium · confirmed — Closed landing nav drawer keeps focusable children tabbable while aria-hidden
**Location:** `src/pages/landing/shell/LandingMobileShell.jsx` (drawer `_drawer_oo5s9_110`)
**Evidence:**
```
axe aria-hidden-focus (serious) on /, /admin, /distributors, /employers (chromium)
$ DOM probe: aria-hidden="true" aside "_drawer" -> focusables:7  ["BUTTON:Close menu","A:Subscribers","A:Employers"]
```
**Impact:** keyboard users tab into an off-screen, invisible menu (7 controls) that the drawer marks
`aria-hidden` — focus disappears with no visible target.
**Suggested fix (do not apply):** render the drawer's contents only when open, or add `inert` /
`tabindex="-1"` to its focusables while closed.

### A20-005 · Medium · confirmed — Scrollable data tables not keyboard-accessible
**Location:** shared table shell `_tableScroll` (admin & distributor desktop dashboards); `_quotesScroll` (landing mobile); agent onboard `<ol>` (mobile)
**Evidence:**
```
axe scrollable-region-focusable (serious): 17 scans
 admin /dashboard,/distributors,/employers,/nav,/network,/nominee-claims,/subscribers,... _tableScroll (chromium)
 distributor /dashboard,/agents,/branches,/commissions,/settings                          _tableScroll (chromium)
 public / , /distributors  _quotesScroll (mobile) ; agent /dashboard/onboard  ol (mobile)
```
**Impact:** horizontally/vertically clipped table content is unreachable for keyboard-only users (the
container scrolls but is not focusable). Low impact for a mouse-using rep; a real blocker for keyboard/SR.
**Suggested fix (do not apply):** add `tabindex="0"` + an `aria-label` to the scroll containers (axe's
canonical fix).

### A20-006 · Low · confirmed — Skip-link target `<main id="main">` is not focusable
**Location:** all shell `<main id="main">` (e.g. `SubscriberDesktopShell.jsx:121`); `App.jsx:71` & `AdminLogin.jsx:33` use `<div id="main">`
**Evidence:**
```
$ runtime: Tab -> skip-link focused & visible (top:0) ✅ ; Enter -> hash="#main", activeElement=BODY,
  main tabindex=null, focusMovedToMain=false
```
**Impact:** activating the skip link scrolls but does not reliably move keyboard/SR focus into main
(works in Chrome via sequential-focus-start; inconsistent elsewhere).
**Suggested fix (do not apply):** add `tabIndex={-1}` to each `<main id="main">`; use `<main>` (not
`<div>`) at the two div sites.

### A20-007 · Low · confirmed — 310 untracked jsx-a11y warnings, dominated by two noisy rules
**Location:** repo-wide (`eslint`, all rules forced to `warn`)
**Evidence:** histogram in Check 2; axe found **0** rendered label/name violations across 108 scans,
so the 139 `control-has-associated-label` + 137 `label-has-for` + 8 `label-has-associated-control` are
overwhelmingly over-strict lint, not real defects.
**Impact:** a large warn-only backlog masks the ~16 genuine warnings (autofocus, anchor-is-valid,
static-element-interactions, etc.). No user-visible effect today.
**Suggested fix (do not apply):** drop the deprecated `label-has-for`, keep
`label-has-associated-control`; ratchet the ~16 genuine warnings to `error` (mostly S effort).

### A20-008 · Low · confirmed — All 10 `aria-role` warnings are a prop-name collision, not invalid roles
**Location:** `src/components/notifications/NotificationBell.jsx` `role` prop + its 10 call sites (Check 3)
**Evidence:** all 10 warning sites are `<NotificationBell role="admin|agent|branch|distributor|employer" …/>`;
the component's only DOM role is `role="region"` (valid).
**Impact:** none functionally; the noise can hide a future genuine invalid role in this rule bucket.
**Suggested fix (do not apply):** rename the prop `recipientRole` (per 00c).

### A20-009 · Low · confirmed — 6 `autoFocus` usages
**Location:** `admin-dashboard/employers/CreateEmployer.jsx:153`, `admin-dashboard/distributors/CreateDistributor.jsx:145`, `employer-dashboard/employees/MemberDetailBody.jsx:140`, `dashboard/commissions/CommissionPanel.jsx:619`, `dashboard/overlay/OverlayPanel.jsx:174`, `components/signin/PhoneEntry.jsx:148`
**Evidence:** `jsx-a11y/no-autofocus` ×6 (baseline lint).
**Impact:** autofocus can move SR/keyboard users unexpectedly and jump the viewport on open.
**Suggested fix (do not apply):** manage focus imperatively on open instead of `autoFocus` (PhoneEntry's
sign-in focus is the most defensible; the two admin Create* modals are the weakest).

### A20-010 · Info · confirmed — `<html lang="en">` vs `en-UG` formatters
**Location:** `index.html:2`; `src/utils/currency.js:16`, `src/utils/date.js:11`
**Evidence:** `<html lang="en">`; `LOCALE='en-UG'` ×2 + 18 direct `en-UG` sites; `og:locale=en_UG`.
**Impact:** cosmetic SR pronunciation mismatch; both are English — no material effect.
**Suggested fix (do not apply):** set `<html lang="en-UG">` for consistency.

### A20-011 · Low · confirmed — Subscriber balance change is not announced
**Location:** `src/subscriber-dashboard/home/HomeDesktop.jsx:163-166,362-363` (+ `HomeMobile.jsx`)
**Evidence:** `useCountUp(net,1100,…)` rendered as plain `heroValue` text — no `aria-live`, not
`aria-hidden`.
**Impact:** after a contribution the balance re-counts silently; SR users aren't told it changed
(the action itself is confirmed via Toast `aria-live`, so this is minor).
**Suggested fix (do not apply):** wrap the final balance in an `aria-live="polite"` container and
`aria-hidden` the intermediate count-up frames.

---

## Traceability
| Check | Disposition |
|---|---|
| 1 · axe sweep, every route × 6 roles × mobile+desktop, by impact & rule | FINDING A20-002, A20-004, A20-005 (108 scans; 67 serious violations, 3 rules) |
| 2 · lint jsx-a11y by rule + effort to ratchet | FINDING A20-007 (310 warnings, per-rule effort tabled) |
| 3 · the 10 aria-role warnings — genuine invalid roles only | PASS (0 genuine invalid roles) — documented as FINDING A20-008 (lint noise) |
| 4 · `<html lang="en">` vs en-UG formatters | FINDING A20-010 |
| 5 · focus mgmt: focus-trap util, 21 aria-modal / 19 dialog, escape+restore | FINDING A20-003 |
| 6 · colour contrast of 87-token palette + screenshots incl. text-on-indigo | FINDING A20-001, A20-002 (text-on-indigo PASSES at 13.18:1) |
| 7 · forms: label association, aria-invalid/aria-describedby vs input count | PASS (0 rendered axe label violations); caveat + lint noise folded into A20-007 |
| 8 · SR walkthrough of 3 money screens; is a balance change announced? | FINDING A20-011 (announce paths otherwise PASS via Toast/aria-valuetext/role=alert) |
| 9 · skip link works and lands on `<main id="main">` | FINDING A20-006 (skip-link mechanics PASS; target not focusable) |

## Cleanup (report-only compliance)
- **DELETED** `e2e/specs/a11y/axe-sweep.spec.ts` (the sanctioned throwaway spec) and its now-empty
  `e2e/specs/a11y/` directory. Verified gone.
- Retained (evidence, all under `docs/audits/2026-08-23/a20/`): 108 axe result JSONs in `axe-results/`,
  and the throwaway `mobile-axe.config.ts` used to reach the phone viewport without editing the
  product `playwright.config.ts`.
- No source/config/DB files were modified (`git status` shows only `package.json`/`package-lock.json`,
  which are A00's sanctioned `@axe-core/playwright` install — not touched by A20).
- **No database fixture rows were created** by this agent.
- `@axe-core/playwright` is flagged for removal after the audit (per the A00 baseline).
