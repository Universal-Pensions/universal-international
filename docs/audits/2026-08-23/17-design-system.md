# A17 · Design system & visual consistency

**Captured:** 2026-08-24 · **Repo:** `/Users/shubhang/Desktop/Projects/uganda-dashboard` @ `bd637f6`
**Scope:** REPORT-ONLY. Cites `docs/audits/2026-08-23/00-baseline.md` and `00c-frontend-groundtruth-corrections.md`.
No files created outside `docs/audits/2026-08-23/`. No fixture rows created.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 229 CSS modules + `src/index.css` (87 tokens) + 2 motion constants + 5 BottomSheet copies + 6 report-component files + 333 Phase-3 screenshots |
| Artifacts examined | 229 CSS modules (scripted) + `index.css` + `motion.js`/`motion.jsx` + 5 BottomSheet .jsx/.css + 6 report comps + 14 screenshots judged in depth |
| Coverage | 100% of CSS modules scanned; ~4% of screenshots judged in depth (14/333, selected to cover all 6 roles + profile/overview/list surfaces) |
| Checks defined | 8 (spec) → 18 sub-checks |
| Checks executed | 18 |
| Checks passed / failed / blocked | 8 / 10 / 0 |
| Findings C / H / M / L / I | 0 / 0 / 3 / 5 / 1 |
| Evidence commands run | 21 |
| Excluded as demo-scope | 1 (absence of an i18n library — Info-only per plan; not raised here) |
| Blocked, with reason | none |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Token coverage — **overall** | **67.9%** (10768 var / 5090 literal, across color/space/radius/font/shadow declarations) |
| Token coverage — color | 89.6% (5838 var / 678 literal) |
| Token coverage — spacing | **40.3%** (1856 var / 2745 px·rem literal) — worst category |
| Token coverage — radius | 76.4% |
| Token coverage — font-size | 52.7% |
| Token coverage — box-shadow | 84.7% |
| Hex literals in modules | 631 · rgba() literals | 622 · hsl() | 0 |
| Hex literals **equal to an existing token value** | 280 (incl. 23× brand indigo `#292867`) |
| Distinct literal font-size values | **76** (vs an 11-step `--text-*` scale) |
| Sub-12px font-size declarations | **519** (422 px + 97 rem, below `--text-xs`=12px) |
| Circular-avatar CSS files | 13 |
| Inline framer `ease:[…]` arrays (not via constant) | 0 |
| CSS `@keyframes` files w/o `prefers-reduced-motion` guard | 14 (5 decorative-infinite, ~9 spinners) |
| `--ease-out-expo` CSS var vs `EASE_OUT_EXPO` JS const | **agree** |

---

## Check 8 first (fast PASS) — easing var vs JS constant AGREE
`src/index.css:134` → `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);`
`src/utils/motion.js:20` → `export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1];`
Same four control points. `src/pages/landing/motion.jsx` re-exports the JS const (`export const EASE = EASE_OUT_EXPO`). **PASS.** No drift — unlike the two `LOCALE='en-UG'` copies A00 flagged, the easing is single-sourced in spirit and the two representations match.

## Check 6 — motion discipline: easing GOOD, CSS keyframe reduced-motion INCONSISTENT
- 127 JSX/JS files import `EASE_OUT_EXPO`; **0** inline `ease:[…]` cubic arrays anywhere → easing is well-disciplined. **PASS.**
- Framer reduced-motion is **globally** covered: `src/main.jsx:97` wraps the tree in `<MotionConfig reducedMotion="user">`, so all 142 framer files honour the OS preference even though only 63 call `useReducedMotion()` explicitly. **PASS** (no framer finding).
- **Gap (A17-008):** `MotionConfig` does NOT govern CSS `@keyframes`. 14 modules run CSS keyframe animations without a `prefers-reduced-motion` guard; of these, ~5 are **decorative infinite** loops (Hero `pulse`+`scrollPulse`, CTA `pulse`, UgandaMap `glowPulse`, SavingsCalculator `shimmer`) that should reduce but don't, while 66 other modules DO guard their motion. Inconsistent.

## Check 5 — duplicated components: BottomSheet DIVERGES, report comps are shims
**BottomSheet ×5** — the 4 dashboard copies (`agent`/`branch`/`subscriber`/`employer`) are **byte-identical in code** (diff shows comment-only differences) and their `.module.css` are byte-identical (agent↔subscriber/branch/employer `diff` exit 0). The **landing** copy (`src/pages/landing/shell/BottomSheet.jsx`, 154 lines vs 87) is **behaviourally different**: it adds a full **focus trap** (`FOCUSABLE`/`focusablesIn`, Tab-cycling), sets **`inert`** on `#root`, and **returns focus** to the opening control. The 4 dashboard copies do none of this yet all declare `role="dialog" aria-modal="true"` — a false a11y promise (see A17-003). Landing `.module.css` differs by ONE line (`max-width: 520px` vs `560px`).

**ReportTable / FilterSelect / SearchFilter ×2** — the `src/dashboard/reports/*` copies are **2–3 line re-export shims** to the canonical `src/components/reports/*`. **No behavioural divergence.** **PASS.** (The "×2" in ground truth is real file count but not real duplication.)

---

## Findings

### A17-001 · MEDIUM · Circular avatars violate the standing "no circular avatars" house rule (and are internally inconsistent)
`feedback_uganda_visual_taste` states **"no circular avatars"** as standing taste (treated as a requirement by this check). 13 CSS modules define `border-radius: 50%` / `var(--radius-full)` on `.avatar`/`.avatarInitials`:
`agent-dashboard/pages/{SubscribersPage,InsuredMembersPage,MessageLauncher,OnboardedThisMonthPage,ContributionsThisMonthPage}.module.css`, `subscriber-dashboard/pages/{NomineesPage,SettingsPage,SettingsDesktop}.module.css`, `dashboard/settings/Settings.module.css`, `employer-dashboard/desktop/ui.module.css`, `components/{tickets/TicketListRow,Trust,SkeletonRow}.module.css`.
**Confirmed demo-visible:** `screenshots/subscriber/settings-nominees-d.png` renders circular "RK" / "LN" nominee avatars. Meanwhile OTHER avatars are rounded squares — `dashboard/overview/DistributorOverview.module.css` (`--radius-sm`), `agent-dashboard/pages/SettingsPage.module.css` (`--radius-md`), `subscriber-dashboard/pages/AgentPage.module.css` (`--radius-xl`), and the agent profile header ("DK", `screenshots/agent/profile-1440.png`). So the app both **violates the rule** and is **self-inconsistent**.
- **demo_visible:** true · **fix:** standardise `.avatar` on `var(--radius-md)` (or `--radius-sm`); delete the `50%`/`--radius-full` avatar rules.

### A17-002 · MEDIUM · Type scale is bypassed — 76 distinct ad-hoc font sizes, 519 of them sub-12px
`index.css` defines an 11-step `--text-*` scale, but modules use **1172 literal `font-size` declarations** (vs 1330 tokenised → 52.7% adherence) spanning **76 distinct values**. The literals cluster BELOW the smallest token (`--text-xs`=0.75rem=12px): 164× `11px`, 87× `10px`, 73× `10.5px`, 71× `11.5px`, 27× `9px`, plus 97 sub-`0.75rem` rem values — **519 sub-12px declarations total**. For a low-literacy Ugandan audience (`feedback_plain_language_uganda`) 9–11px body/label text is a legibility risk, and 76 off-scale sizes mean the "scale" is effectively decorative.
- **demo_visible:** true (small text renders on nearly every dense screen) · **fix:** map to `--text-*`; establish a floor (nothing below `--text-xs`); collapse the 76 values to the scale.

### A17-003 · MEDIUM · 4 dashboard BottomSheets promise `aria-modal` but implement no focus trap (behavioural divergence from the landing copy)
`agent`/`branch`/`subscriber`/`employer` `shell/BottomSheet.jsx` render `role="dialog" aria-modal="true"` with only Escape + scrim-click handlers — **no focus trap, no `inert`, no focus-return** (`grep -lE 'inert|FOCUSABLE|focusablesIn'` → none). The landing copy implements all three. So the same primitive exists in 5 copies, one hardened and four not, and the four make a false a11y promise on authenticated **mobile** surfaces (Ask AI / Notifications / Help sheets). A00 confirmed the repo has **no focus-trap utility** (0 files) — these four are the concrete cost.
- **demo_visible:** false (keyboard/SR only; reps rarely tab-navigate) · **co-owned with A20/A25** · **fix:** promote the landing sheet to a single shared primitive; delete the 4 copies.

### A17-004 · LOW · 280 hardcoded hex literals re-declare an existing token value (23× the brand indigo)
Color token coverage is high (89.6%) but 280 module hex literals exactly equal a defined token: **23× `#292867`** (`--color-indigo`), 11× `#2E8B57` (`--color-green`), 6× `#1B1A4A`, 5× `#2F8F9D`, 4× `#5E63A8`, 2× `#2F3550`. Worst file: `employer-dashboard/employees/OnboardStaffPanel.module.css` hardcodes the brand indigo **20 times**. If the brand indigo ever shifts (per §6 it anchors the identity), these 23+ sites silently won't follow.
- **demo_visible:** false · **fix:** replace token-valued literals with `var(--color-*)`.

### A17-005 · LOW · Cross-role inconsistency: the "Ask AI" affordance is styled two different ways
Same concept, two treatments at rest: **solid dark indigo pill** for subscriber, admin, employer, distributor, branch (e.g. `SubscriberDesktopShell.module.css` `.ask… { background: var(--color-indigo-deep) }`) vs **white/lavender outline pill** for agent (`AgentDesktopShell.module.css:79–87` `.askAi { background: var(--color-white); border: 1px solid var(--color-lavender) }`, indigo only when `.askAiActive`). Evidence: `screenshots/{subscriber/index-d, admin/desktop-overview-1440, employer/profile-1440, distributor/home-1440, branch/d-overview-1440}.png` (solid) vs `screenshots/agent/{home-1440,profile-1440,subscribers-1440}.png` (white). *Aside for check 3:* the 5 solid variants put two solid-indigo buttons on one screen (Ask AI + the page's primary CTA, e.g. subscriber "Pay UGX 500,000"), brushing the "≤1 solid CTA per screen" rule; the agent's white treatment is actually the more rule-compliant one.
- **demo_visible:** true · **fix:** pick one treatment (agent's white-at-rest better honours "less solid indigo").

### A17-006 · LOW · Cross-role inconsistency: KPI tiles use two different patterns
The "KPI tile" concept splits 3/3 across roles: **left colored accent-border** tiles (subscriber `index-d`, employer `profile-1440`/overview, branch `d-overview-1440`) vs **flat borderless** tiles (agent `home-1440`, distributor `home-1440`, admin `desktop-overview-1440`). Icon chips, label casing and number weight are otherwise consistent, so this reads as an unfinished convergence rather than intent. (Status pills and the health-score ring, by contrast, ARE consistent across roles — see distributor vs admin "78 Strong" ring — so those sub-checks PASS.)
- **demo_visible:** true (only if two roles shown side by side) · **fix:** converge on one tile treatment.

### A17-007 · LOW · Spacing token coverage is 40% — the `--space` scale is mixed with ad-hoc px throughout
Overall token coverage **67.9%**, dragged down by spacing at **40.3%** (2745 px/rem literals vs 1856 `var(--space-*)`). Worst modules by raw tokenisable-literal count: `pages/landing/landing.module.css` (203 px spacing), `pages/landing/mobile/landingMobile.module.css`, `employer-dashboard/mobile/employerMobile.module.css` (29 px radii + 56 px fonts), `dashboard/mobile/distributorMobile.module.css`, `branch-dashboard/mobile/branchMobile.module.css`, `signup/contribution/ContributionSettings.module.css`, `components/contribution/SubscriberScheduleForm.module.css`. Radius 76.4%, shadow 84.7% are healthier. This is discipline debt, not a visible defect.
- **demo_visible:** false · **fix:** migrate padding/margin/gap to `--space-*`; establish a lint rule.

### A17-008 · LOW · Decorative CSS keyframe animations ignore `prefers-reduced-motion`
`components/Hero.module.css` (`pulse` 2.5s infinite, `scrollPulse` 2s infinite), `components/CTA.module.css` (`pulse`), `dashboard/map/UgandaMap.module.css` (`glowPulse` 5s infinite), `components/SavingsCalculator.module.css` (`shimmer` 5s infinite) run infinite decorative animation with no reduced-motion guard — despite 66 other modules guarding theirs and framer being globally covered. (The remaining ~9 unguarded keyframe files are loading spinners, conventionally exempt.)
- **demo_visible:** false · **co-owned with A25** · **fix:** wrap decorative keyframes in `@media (prefers-reduced-motion: reduce){ animation: none }`.

### A17-009 · INFO · Web fonts load async (FOUT/CLS on cold load)
`index.html:39` loads Google Fonts via `media="print" onload="this.media='all'"` + `display=swap`, with `preconnect` but **no `preload`** of the woff2 files and generic `sans-serif` fallbacks (`--font-display`/`--font-body`) with no `size-adjust`. First paint uses system sans-serif, then swaps to Plus Jakarta Sans / Inter → a brief FOUT and possible CLS on a cold demo (relevant on poor Ugandan connectivity, and the fonts are CDN-dependent). One-time, non-blocking.
- **demo_visible:** true (first load only) · **fix:** `preload` the two woff2 subsets, or accept as demo-scope.

---

## Traceability
Every spec check → exactly one disposition.

| # | Check | Disposition |
|---|---|---|
| 1 | Scan 229 CSS modules for hardcoded hex/rgb/hsl, px spacing, radii, shadows, font-sizes where a token exists; counts per dir + worst 20 | **FINDING A17-004** (280 token-valued hex) + data in Domain metrics & A17-007 worst-files list |
| 2 | Token coverage = tokenised ÷ tokenisable | **FINDING A17-007** (67.9% overall; spacing 40.3%) |
| 3a | House rule: LESS solid indigo / ≤1 solid CTA per screen | **FINDING A17-005** (aside: 5 roles put 2 solid-indigo buttons per screen) |
| 3b | House rule: NO circular avatars | **FINDING A17-001** |
| 3c | House rule: compact / summary-first | **PASS** (overviews are summary-first: hero number → KPI row → attention list; screenshots admin/distributor/branch/subscriber/employer/agent) |
| 3d | House rule: NO metric clusters on Profile screens | **PASS** (`subscriber/settings-profile-d`, `agent/profile-1440` are form/nav hubs with no KPI cluster) |
| 4a | Type scale adherence | **FINDING A17-002** |
| 4b | Async Google Fonts FOUT/CLS | **FINDING A17-009** |
| 5a | Diff 5 BottomSheet copies — behavioural divergence | **FINDING A17-003** (landing hardened; 4 dashboard copies not) |
| 5b | Diff 2× ReportTable/FilterSelect/SearchFilter | **PASS** (dashboard copies are re-export shims, no divergence) |
| 6a | EASE_OUT_EXPO vs inline duration/ease literals | **PASS** (0 inline ease arrays; 127 files import the constant) |
| 6b | prefers-reduced-motion honoured everywhere | **FINDING A17-008** (framer globally covered via MotionConfig; CSS decorative keyframes not) |
| 7a | Cross-role KPI tile consistency | **FINDING A17-006** |
| 7b | Cross-role status pill consistency | **PASS** (dot-pill pattern + health-score ring consistent across roles) |
| 7c | Cross-role empty/error state consistency | **PASS** (shared `EmptyState`/`SkeletonRow` components; error screenshots consistent) |
| 8 | `--ease-out-expo` CSS var and JS constant agree | **PASS** (both `0.16, 1, 0.3, 1`) |

## Notes on demo-scope & overlaps
- **Excluded (demo-scope):** absence of an i18n library — Info-only per the plan; not raised.
- **Co-owned:** A17-003 (BottomSheet focus trap) and A17-008 (reduced motion) are a11y-adjacent and overlap A20/A25; reported here because check 5 and check 6 mandate them, framed as design-system consistency.
- **No fixture rows created; no files written outside `docs/audits/2026-08-23/`.**
