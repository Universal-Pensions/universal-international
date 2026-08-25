# A18-002 — breakpoint decision (`P5-responsive-band`)

**Date:** 2026-08-25
**Finding:** 769-1023px dead band renders a stretched phone shell (iPad-portrait width) for all 6 roles.
**Write-set:** `src/hooks/useIsDesktop.js`, `src/hooks/useIsMobile.js`, their co-located tests, `src/test/breakpoint-gap-contract.test.js`, this file. No shell or page file was edited.
**Decision: SHIP.** `useIsDesktop()` lowered `1024px -> 768px`; `useIsMobile()` narrowed `768px -> 767px`. The two hooks now partition `[0, ∞)` with no gap and no overlap.

This finding's own brief offered two directions and explicitly ruled out the first ("building a whole tablet layout for six roles is out of scope for this phase"). The second — drop `useIsDesktop()` to `768px` — was a hypothesis, not a given: the risk named up front was that a 3-column desktop shell forced into a narrow viewport could produce a *worse* defect (a horizontally-scrolling desktop shell) than the one being fixed. This document is the measurement that hypothesis was checked against, including a false alarm I raised against myself, ran down, and disproved before shipping.

---

## 1. What actually renders in the band today

`grep -rn "useIsDesktop\|useIsMobile" src/` turns up 80 files importing `useIsDesktop` and 23 importing `useIsMobile`; only 6 files import both (`DashboardShell.jsx` + its 2 tests, `AdminDashboardShell.jsx` + its test, `BranchMobileShell.test.jsx`).

Reading all 6 role-entry shells (`src/dashboard/DashboardShell.jsx`, `src/admin-dashboard/AdminDashboardShell.jsx`, `src/branch-dashboard/BranchDashboardShell.jsx`, `src/agent-dashboard/shell/AgentShell.jsx`, `src/employer-dashboard/shell/EmployerShell.jsx`, `src/subscriber-dashboard/shell/SubscriberShell.jsx`) shows every one of them makes the **same strict two-way branch**, and only that branch:

```js
const isDesktop = useIsDesktop();
return isDesktop ? <XDesktopShell /> : <XMobileShell />;
```

There is no three-way (desktop / tablet / mobile) branch anywhere in the shell layer. `useIsMobile()` is consumed inside `DashboardContent` (distributor) and `AdminDashboardContent` (admin) to compute `dashMode = mode === 'dash' && !isMobile` — but both components only mount *inside* `DistributorDesktopShell` / `AdminDesktopShell`, which themselves only render when `isDesktop` is already `true`. Under the old thresholds (`1024` / `768`) that made `isMobile` **dead code** in that position — it can never observe `true` there, because the tree that reads it is unreachable below 1024px.

Net effect confirmed by this reading, before touching anything: in the 769-1023px band, `useIsDesktop()` was `false` and the two-way branch rendered the **phone shell**, stretched across a tablet-width viewport. That is the finding, and the read-through matches it exactly.

## 2. Why 1024 wasn't an accident

Comments across independently-built shells consistently name `1024px` as the deliberate boundary — not a rounding accident from one file copy-pasted everywhere:

- `AdminMobileShell.jsx:90` — "the super-admin PHONE shell (**<1024px**)"
- `AdminBottomTabBar.jsx:50,53` — "**<1024px**... **>=1024px** where the desktop rail takes over"
- `BranchMobileShell.jsx:74` — "the branch admin PHONE shell (**<1024px**)"
- `EmployerShell.jsx` docblock — "desktop (**>=1024px**): the shipped desktop chrome"
- `DashboardShell.jsx` / `AdminDashboardShell.jsx` docblocks — "Selects the phone shell... below 1024px and the desktop... rail shell at/above it"

This repo does use container queries elsewhere for a genuinely analogous "available width, not viewport width" problem: `@container onboardcanvas` / `@container signupcanvas` in `src/signup/steps/*.module.css` adapt the onboarding wizard's *own* layout to the width of whichever parent embeds it (agent-assisted vs. self-serve signup). That precedent doesn't transfer here: it solves "how does this one component adapt inside a slot of varying width," not "which entire component tree — different navigation paradigm, different routes — should mount." The shell decision is necessarily a JS-level fork, so a JS media-query hook (not a CSS container query) is the right tool; `1024` being copy-consistent across roles built at different times is evidence it was a considered choice, not that the *number itself* was re-verified against every page's minimum width when each new role shipped. That gap between "deliberate" and "still correct" is exactly what needed measuring.

## 3. Method: check the shells' CSS before moving the number

Per this task's brief, the failure mode to rule out was concrete: dropping `useIsDesktop()` puts a 3-column desktop grid (rail + content + AI copilot panel) into a viewport as narrow as 768px. If that grid can't shrink, the result is a horizontally-scrolling desktop shell — worse than today's stretched-but-functional phone shell.

**Static proof (all 6 shells).** Every desktop shell's CSS module was read in full:

- `src/dashboard/DashboardShell.module.css` (shared by distributor + admin): `.main { overflow: hidden }`, and inside the mobile block `.mobileHeaderLeft`/`.mobileHeaderLogo` carry `min-width: 0`.
- `src/agent-dashboard/shell/AgentDesktopShell.module.css`, `src/branch-dashboard/shell/BranchDesktopShell.module.css`, `src/employer-dashboard/shell/EmployerDesktopShell.module.css`, `src/subscriber-dashboard/shell/SubscriberDesktopShell.module.css`: all four declare, byte-for-byte the same pattern, on the shell's scrollable content column:

  ```css
  .viewport {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    ...
  }
  ```

  and the third grid column — the AI "Copilot" panel (`AgentCopilotPanel.module.css` etc.) — is itself `.panel { min-width: 0; overflow: hidden; }`, with the visible chat UI absolutely positioned *inside* it at a fixed width. That means even when `--*-copilot-col` is driven open to `360-380px`, the panel's own box can't force the grid wider — it's structurally clipped.

`min-width: 0` is what lets a CSS Grid/Flex track shrink below its content's intrinsic width instead of forcing the track (and the page) wider; `overflow-x: hidden` on the same element is the backstop that clips anything that still doesn't fit. Together, on the exact element that would otherwise blow out the layout, in **all 6 shells**, a page-level horizontal scrollbar is structurally impossible regardless of viewport width. This isn't a per-role coincidence — the four non-distributor/admin shells' comments cross-reference each other ("Mirrors AgentDesktopShell.module.css") confirming one deliberate, shared convention.

**Live proof (all 6 roles, real auth, real data).** `resize_window` on the automation browser did not affect the actual rendering viewport in this environment (`window.innerWidth` stayed pinned at 1470 across multiple resize attempts to very different sizes) — DevTools-style responsive testing wasn't available. Instead: same-origin `<iframe width="…">` embeds get a genuinely independent CSS viewport (own `matchMedia`, own layout), and — critically — share `localStorage` with the parent tab on the same origin, so a real login session (real JWT, real seeded data) carried straight through. Method per role:

1. Sign in for real (OTP flow) as each of the 6 roles.
2. Temporarily set `useIsDesktop()`'s query to `(min-width: 768px)` (this file's own write-set — safe to experiment with before committing).
3. For each width in `{767, 768, 800, 820, 900, 1000, 1023}` (plus `1024` as a known-good control), create a fresh same-origin iframe at that width against `/dashboard`, wait for full mount, and read `document.documentElement.scrollWidth - clientWidth` (page-level overflow) and `#main`'s `scrollWidth` vs `clientWidth` (content-column-level clipping).

Results, page-level `overflow` (want: `0` everywhere) — confirmed **zero in every measurement**:

| Role | Widths tested | Modes | Page-level overflow |
|---|---|---|---|
| Distributor | 767, 768, 800, 820, 900, 1000, 1023, 1024 | dash **and** map | 0 at every width, every mode |
| Admin | 768, 800, 820, 900, 1000, 1023 | dash | 0 at every width |
| Agent | 768, 800, 820, 900, 1000, 1023 | default, + Ask-AI Copilot opened | 0 at every width/state |
| Branch | 767, 768, 800, 820, 900 | default | 0 at every width |
| Employer | 767, 768, 800, 820, 900, 1000, 1023 | default | 0 at every width |
| Subscriber | 767, 768, 800, 820, 900, 1000, 1023 | default | 0 at every width |

A screenshot of the distributor dash-mode overview rendered inside an 820px-wide, real-authenticated iframe (sidebar rail, 2-column KPI grid, Needs-attention panel, no horizontal scrollbar) is saved alongside this file's evidence trail (not committed to the repo — this write-set is scoped to the two hook files, their tests, and this document).

## 4. A false alarm, and how it was run down

Mid-investigation, `#main`'s `scrollWidth` briefly read **larger** than its `clientWidth` on the branch Overview page at 768-900px (e.g. `724` vs `580` at 768px), with a specific element (`OverviewDesktop`'s "Needs attention" card) measuring a bounding-box right edge ~150px past the iframe's own width. That looked like exactly the failure mode this check exists to catch, and very nearly became this document's headline finding.

It didn't survive a second look. `src/branch-dashboard/desktop/OverviewDesktop.module.css:105` already collapses that card's parent `.grid2` to a single column below **1100px viewport width** — more conservative than any threshold under test — so the two-column layout the "overflow" was measured against shouldn't have been rendering at 820px at all. Re-running the identical measurement with a longer post-mount settle (2.2s instead of 1.8s, plus a pause between tearing down one iframe and creating the next) made the discrepancy disappear completely and reproducibly: `mainScrollW === mainClientW` at every width, confirmed across three independent re-runs, and confirmed again by directly reading the "Needs attention" card's own `getBoundingClientRect()` (right edge well inside the viewport, single-column, correctly stacked).

Conclusion: the first reading caught an **in-flight layout** (Framer Motion entrance animation and/or a data-load reflow not yet settled) mid-transition, not a real defect. Recorded here because (a) it is the actual reason every live measurement above used a 2.2s settle + inter-iframe pause, and (b) it's a trap worth knowing about for the next agent who reaches for this same same-origin-iframe technique: **rapid iframe creation/teardown in this app under-settles Framer Motion + React Query mounts; don't trust a single fast read, re-verify with a longer wait before concluding "overflow."**

## 5. What was *not* exhaustively checked

The structural CSS guarantee (§3) covers every page, because it clips at the shell boundary regardless of what's inside. The live measurements (§3-4) sampled each role's landing page (Overview/Home) plus, for distributor, its map-mode drill-down — on the theory that a shell-wide layout defect would show up on the highest-traffic page first, which is also where a rep is most likely to be looking during a demo. They did **not** exhaustively walk all ~80-100 page components across 6 roles (e.g. every desktop table, form, and chart view). That audit is out of this write-set's scope (hooks only, no shell or page edits) and would be a large, cross-cutting effort colliding with every concurrent agent editing `src/*-dashboard/**`.

The realistic worst case if some untested page *does* have a wider minimum content width than the rest: that one page's content gets visually cramped or partially clipped **within its own column** at the narrow end of the (now-live) 768-1023px range — not a page-level horizontal scrollbar (§3 forecloses that structurally), not data loss, not a crash. That is a new, narrowly-scoped, easy-to-spot-and-fix medium-severity issue if it exists anywhere, not the broad "horizontally-scrolling desktop shell" failure mode this decision was gated on ruling out — and it replaces a defect (the phone-shell stretch) that was already confirmed non-breaking by the original A18-002 evidence capture (`overflowX=false` at every sampled width). If it surfaces, the fix is page-local CSS, not a hook revert.

## 6. A latent hook-boundary issue found along the way (not shipped as a fix, folded into this change instead)

Under the *old* thresholds (`min-width:1024` / `max-width:768`), 769-1023px was owned by neither hook — the dead band this finding is about. Under a naive fix of just lowering `useIsDesktop()` to `768` **without** also touching `useIsMobile()`, the single width `768px` — the classic non-Pro iPad's portrait CSS width, not an edge case — would satisfy *both* `min-width: 768px` and `max-width: 768px` simultaneously. That specific pixel is harmless today only because nothing currently reads both hooks in a genuinely reachable three-way branch; it is a trap for the next consumer that does. Rather than ship that seam, `useIsMobile()`'s query moved to `max-width: 767px` in the same change, so the two hooks are now MECE-adjacent: `useIsMobile()` owns `[0, 767px]`, `useIsDesktop()` owns `[768px, ∞)`. `src/test/breakpoint-gap-contract.test.js` asserts this partition holds (no width owned by both, none owned by neither) across 32 sampled widths plus the exact seam.

## 7. Verification gate

```
npx vitest run --silent   # before: ~4502-4508 passed, 1 pre-existing flaky file
                           #   (AdminDashboardShell.test.jsx — unrelated to this
                           #   write-set, not touched here)
                           # after:  194 files / 4578 tests, 0 failed (2 clean runs)
npm run typecheck          # exit 0, both before and after (unaffected — JS-only change)
npm run build              # exit 0, both before and after
```

Full command output is recorded in this agent's Output Contract (`before_output` / `after_output`), not duplicated here.

## 8. Rollback

If a page-content regression surfaces in the 768-1023px band after this ships, the fix is almost certainly page-local CSS (a missing `minmax()`/responsive rule on that page, per §5) — not reverting this change. If a full revert is ever needed anyway: restore `useIsDesktop.js`'s query to `(min-width: 1024px)` and `useIsMobile.js`'s to `(max-width: 768px)`; both are one-line changes, no migration, no data involved. `src/test/breakpoint-gap-contract.test.js` and the two hooks' own tests would need their asserted thresholds reverted alongside it, or they will (correctly) fail and point back to this file.
