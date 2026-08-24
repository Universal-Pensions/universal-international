# A19 · Desktop shells & information density

**Scope:** the six role desktop shells at ≥1024px, their navigation/panel architecture,
map drill, large-list virtualization, CSV export, dialog focus behaviour, Copilot panels,
and long-session posture. Report-only. All evidence below was run this session against the
live dev stack (Vite 5173 / Express 3001) and live Supabase (`ilkhfnoyxlxwqadebnkp`).

Cites `docs/audits/2026-08-23/00-baseline.md`, `00b-preregistered-distributor-reports.md`,
`00c-frontend-groundtruth-corrections.md`.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 30 (6 desktop shells + 4 contexts + 6 copilot components + Modal + EmployerSlidePanel + UgandaMap + VirtualRows + ViewSubscribers + ViewAgents + csv/csvDownload + ReportView + ReportTable + 2 sidebars) |
| Artifacts examined | 30 |
| Coverage | 100% |
| Checks defined | 18 |
| Checks executed | 17 |
| Checks passed / failed / blocked | 8 / 9 / 1 |
| Findings C / H / M / L / I | 0 / 0 / 4 / 3 / 2 |
| Evidence commands run | 14 |
| Excluded as demo-scope | 1 (empty Realtime publication / stale-data-on-idle refetch behaviour — React Query defaults, not a shell defect) |
| Blocked, with reason | 1 — check 7 "leave a dashboard 30 min" not run to completion (time budget); assessed statically + token-exp verified instead |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Desktop shells that are ROUTED | 4 (subscriber, agent, branch, employer) |
| Desktop shells that are UNROUTED (panel booleans) | 2 (distributor, admin) |
| Panel/rail views deep-linkable on the 2 unrouted shells | 0 |
| `.page` max-width caps (routed shells) | 880 / 1240 / 1280 px, all `margin:0 auto` |
| role="dialog" desktop dialogs with a real focus trap | 2 (Modal.jsx, EmployerSlidePanel.jsx) |
| role="dialog" aria-modal desktop dialogs WITHOUT a focus trap | 1 (DataCopilotPanel — used by distributor + admin) |
| Copilot interaction models across 6 roles | 2 (4× non-modal grid-push, 2× modal backdrop drawer) |
| Rows rendered in the distributor "Subscribers" list (dash mode) | 4,602 of 4,602 (virtualizer inert) |

---

## Check 1 — Six shells at 1024/1440/1920/2560 (layout, sidebars, Copilot, overflow, ultrawide)

**Architecture (read):** the four routed shells
(`SubscriberDesktopShell.jsx`, `AgentDesktopShell.jsx`, `BranchDesktopShell.jsx`,
`EmployerDesktopShell.jsx`) share one idiom: a CSS grid `[sidebar][1fr][copilot-col]`
(`grid-template-columns: var(--*-sidebar) 1fr var(--*-copilot-col)`), a collapsible left
rail persisted to `localStorage` (`*NavCollapsed`), a `.viewport { min-width:0; overflow-y:auto }`
scroll column, and a `.page` content wrapper capped and centred:

```
$ grep -n "max-width|margin: 0 auto" src/*/shell/*DesktopShell.module.css
subscriber .page   max-width: 880px  / .pageWide 1240px ; margin: 0 auto
agent .page        max-width: 1280px ; margin: 0 auto
branch .page       max-width: 1280px ; margin: 0 auto
employer .page     max-width: 1280px ; margin: 0 auto
```

The two map-theme shells (`src/dashboard/DashboardShell.jsx`,
`src/admin-dashboard/AdminDashboardShell.jsx`) use a different `[sidebar 1fr]` grid with a
two-mode canvas (`dash` ⇄ `map`); their dash-mode canvas `.dashHost { position:absolute; inset:0; overflow-y:auto }`
has no width cap, but the inner panels (ViewSubscribers etc.) carry their own max-width and
centre, so content is NOT full-bleed.

**Rendered evidence (Playwright screenshots, this session):**
`scratchpad/a19-dist-subs-{1024,1440,1920,2560}.png`, `a19-sub-overview-2560.png`.
At 2560px the content column caps (~1035–1280px wide) and is centred with **symmetric**
gutters (~640px each side on the distributor Subscribers panel; ~640px on the subscriber
overview). Layouts are clean and consistent 1024→2560; no overflow, no broken columns, no
ultrawide breakage. The ultrawide "waste" is the deliberate centred reading-column choice,
applied consistently across all six shells.

**Verdict: PASS.** No layout/overflow/ultrawide defect. (Info note I-1 records the centred-column
intent so it isn't re-flagged.)

---

## Check 2 — Distributor + Admin unrouted consequences (QUANTIFIED — findings A19-001/002/003)

**The architecture (proven by code):** on the distributor and admin desktop shells, *which
rail destination is showing* (Overview / Branches / Agents / Subscribers / Commissions /
Reports / Settings / Support — plus admin's Distributors / Employers / Access-requests /
Nominee-claims / Unit-price / Needs-attention) is held entirely as `useState` booleans in
`DashboardPanelContext.jsx` and `AdminPanelContext.jsx` — **none persisted, none synced to
the URL.** The shell picks the visible page from those booleans
(`DashboardShell.jsx:265` `selectedPage = … viewReportsOpen ? 'reports' : …`;
`AdminDashboardShell.jsx:312`). Only the *map geographic drill* (region/district/branch/agent)
is mirrored to the URL, via `DashboardNavContext.jsx` (`drillDown` → `navigate('/dashboard/regions/:id')`).
`AdminPanelContext.jsx:64` even documents this: *"Desktop admin has no routes, so this is
the only place that state can live."* Whole-shell `mode` (dash⇄map) is local `useState('dash')`
in `DistributorDesktopShell`/`AdminDesktopShell` — also unpersisted.

**Live reproduction (distributor, `scratchpad/a19-repro.mjs`, storageState d-001, 1440px):**
```
STEP1 initial URL: http://localhost:5173/dashboard
STEP1 first heading: "Universal Pensions Uganda — National"      ← Overview
STEP2 URL after clicking Commissions: http://localhost:5173/dashboard   ← URL UNCHANGED
STEP3 URL after reload: http://localhost:5173/dashboard
STEP3 heading after reload: "Universal Pensions Uganda — National"  ← reverted to Overview
STEP4 URL after Reports click: http://localhost:5173/dashboard
STEP4 URL after browser BACK: about:blank (was http://localhost:5173/dashboard)
```
**Live reproduction (admin, `scratchpad/a19-repro3.mjs`, storageState admin-001):**
```
ADMIN url after Distributors panel open: http://localhost:5173/dashboard   ← UNCHANGED
ADMIN distributors panel loaded? true | len 1932
ADMIN url after reload: http://localhost:5173/dashboard
ADMIN overview heading after reload: ["Now viewing National Overview","PLATFORM · NATIONAL OVERVIEW","National Platform"]  ← reverted
```

### A19-001 (Medium, confirmed) — Refresh loses the current view on distributor + admin desktop
A rep viewing any rail destination other than the overview (Commissions, Reports, a
Subscribers/Agents list, Distributors, Unit-price, a Needs-attention drill, etc.) who
reloads (F5, or the OS/browser reloads the tab) is dropped back to the **National / Platform
Overview** — because the URL never left `/dashboard`, so `parsePath()` re-derives
`level:'country', section:'map'` and every panel boolean re-initialises `false`. `mode` also
resets to `'dash'`, so a map-mode district drill (whose id *is* in the URL,
`/dashboard/districts/:id`) reloads as a dash-mode summary panel, not the map. Confirmed for
both roles above.

### A19-002 (Medium, confirmed) — Panel/rail views are not deep-linkable or shareable
Every distributor/admin rail destination renders at the identical URL `/dashboard`
(STEP2/STEP4 above; admin likewise). A rep **cannot** paste a colleague a link to
"the Commissions view" or "the Unit-price page" — the link only ever reopens the overview.
This directly answers the spec's "can a rep share a URL to a specific view?" → **No.** (Only
the map geographic drill is shareable, and even then the dash/map `mode` is lost — see A19-001.)

### A19-003 (Medium, confirmed) — Browser Back exits the dashboard instead of undoing a panel switch
Because panel navigation calls no `navigate()`/`pushState`, the history stack gains no entry
per rail click. Pressing Back after opening a panel therefore does **not** return to the
previous panel — it leaves `/dashboard` entirely, to whatever preceded the SPA entry
(`about:blank` in the harness above; in a real session the pre-dashboard page, i.e. the
login/landing route). A rep who hits Back by muscle memory mid-demo lands on a blank/login
screen — a demo-visible failure. This is the same unrouted root cause behind the
pre-registered distributor-Reports High in `00b`.

---

## Check 3 — Map mode (react-leaflet drill across 136 districts)

**onEachFeature empty-name→id race (the historical bug): REFUTED / fixed.** Click handlers
now resolve name→id and **guard the drill**:
```
src/dashboard/map/UgandaMap.jsx:396  const name = e.target.feature.properties.name;
src/dashboard/map/UgandaMap.jsx:397  const regionId = regionNameToIdRef.current[name];
src/dashboard/map/UgandaMap.jsx:398  if (regionId) drillDown('region', regionId);
```
An empty/unknown feature name resolves to `undefined` → `if (id)` is false → **silent no-op**,
never a drill to a wrong id. District handler identical (`:402-404`). The tooltip is built
with `document.createElement`/`textContent` (`:429-436`) — no HTML-string injection.

**Perf / memory posture:** per-feature style objects are memoised in module-level `WeakMap`
caches (`regionOverlayStyleCache`, `districtStyleCache`, `:53-90`); GeoJSON layers are keyed
and remount on drill (`regionKey`/`districtKey`, `:446-451`); the map is mounted once and
kept via CSS-hide across dash⇄map toggles (`mapMounted` stays true). No evidence of a leak.
**Not measured:** interaction latency and heap growth over many repeated drills (would need a
long profiling session) — recorded as a coverage gap, no finding.

**Verdict: PASS** (race refuted; latency/memory-over-time unmeasured).

---

## Check 4 — Tables: sorting, pagination/virtualisation over 5,000-row lists; CSV export cap

### A19-004 (Medium, confirmed) — Distributor + Admin large-list virtualization is INERT in dash mode
`ViewSubscribers.jsx` and `ViewAgents.jsx` both use `@tanstack/react-virtual`
(`useVirtualizer({ …, getScrollElement: () => bodyRef.current })`,
`ViewSubscribers.jsx:323`, `ViewAgents.jsx:325`). In **dash-mode fullPage** (the default
distributor/admin canvas) the actual scroll viewport is the outer `.dashHost`
(`overflow-y:auto`, 900px tall), while `.body` (which carries `bodyRef`) is laid out
`flex:1` inside a `.panel { overflow:visible }` that is NOT height-constrained — so `.body`
balloons to the full content height and stops being a bounded scroll box. The virtualizer
then sees "everything is visible" and renders **every row**.

Live evidence (`scratchpad/a19-virt.mjs`, `a19-body.mjs`, storageState d-001, 1440px, dash mode):
```
DASH-MODE fullPage Subscribers: {"totalButtons":4606,"dataIndexRows":4602,"virtualListHeight":"450044px"}
$ node a19-body.mjs   # computed layout of the virtualizer's scroll element
 .body  overflowY: auto   clientHeight: 450075  scrollHeight: 450075   ← unbounded (== content height)
 .dashHost overflowY: auto clientHeight: 900     scrollHeight: 450474   ← the REAL scroll viewport
```
`data-index` node count = 4,602 = the full list → the window is the whole list. Each row is a
`<button>` with an avatar div + several spans, so ~4,600 rows ≈ tens of thousands of DOM nodes
mounted at once. `ViewAgents` (2,046 rows) shares the identical `getScrollElement: () => bodyRef.current`
+ unbounded-`.body` pattern, so it degrades the same way. Affects distributor **and** admin
(same components). Degraded mount/scroll performance on a core demo surface, and it worsens
as the live subscriber count (already 5,064) grows. The virtualizer optimisation is present
but silently defeated by the fullPage layout.

*(The map-mode slide-in variant could not be cleanly isolated — the "Map view" control is a
toggle switch, not a named button, and both attempts stayed in dash mode; scoped this finding
to dash mode, which is the default a rep sees.)*

**Sorting: PASS.** The list panels expose a sort control (`SORT_OPTIONS`, `ViewSubscribers.jsx:496`)
and the report table sorts (`components/reports/ReportTable.jsx` `sorted`).

**Report pagination: PASS.** `components/reports/ReportTable.jsx:34-71` paginates
(`pageSize` default 25, `page`/`totalPages`/`slice`) — report tables render 25 rows/page,
not the whole set. Reports are not a render-cost problem.

**CSV export truncation: NOT SILENT — PASS.** `src/utils/csvDownload.js` applies the 5,000-row
cap **only on a mobile UA** (`isMobile && total > MOBILE_ROW_CAP`) and, when it does, fires
`onCapNotice({capped,total})`, which `ReportView.jsx:80-87` turns into a visible toast quoting
the exact kept/total counts. On desktop (`isMobile:false`) rows > 5,000 take the
`toCsvStream` path, which has **no** cap (`csv.js:14`), so the full dataset exports. The
report data itself is fully paginated in `src/services/entities.js` (`getAllAtLevel` loops
`for (from=PAGE_SIZE; from<total; from+=PAGE_SIZE)`, `:500`), so `useAllEntities('subscriber')`
returns all ~5,064 rows, not a capped 1,000. No silent truncation on the desktop export path.
`toCsv`'s hard `CSV_ROW_CAP_EXCEEDED` throw is unreachable in production (nothing calls `toCsv`
directly; `downloadCsv` routes >5,000 to the stream).

---

## Check 5 — Keyboard: tab order, visible focus, Escape, FOCUS TRAP in the role="dialog" set

Ground truth `00c`: no *shared* focus-trap utility exists. That is literally true, but two
dialogs inline their own correct trap, and one desktop dialog declares itself modal without one.

**Correct (PASS):**
- `src/components/Modal.jsx` — full trap: stores previous focus, moves focus in on open,
  Tab/Shift+Tab cycle (`:190-213`), Escape with `preventDefault/stopPropagation`, focus
  restored on close (`:165-169`).
- `src/employer-dashboard/panels/EmployerSlidePanel.jsx` — full trap in modal mode
  (`:126-151`), correctly **disabled** in `splitMode` (non-modal docked region), focus
  restored on close (`:113-120`). Employer desktop Onboard flow is safe.
- The four routed-shell copilots (`SubscriberCopilotPanel`, `AgentCopilotPanel`,
  `BranchCopilotPanel`, `EmployerCopilotPanel`) are **non-modal** (no `role="dialog"`, no
  `aria-modal`; `inert={!open}` + `aria-hidden` when closed; Esc-to-close; focus returned to
  the trigger by the shell's `closeCopilot → askAiRef.current.focus()`). Correct for a
  non-modal panel — a trap would be wrong here.

### A19-005 (Medium, confirmed) — Distributor + Admin Copilot claims aria-modal but does not trap focus
`src/dashboard/overlay/DataCopilotPanel.jsx:157-161` renders `role="dialog"` +
`aria-modal="true"` with a click-to-close backdrop, but has **no Tab handler** and does not
inert/aria-hide the background while open (`inert={!open}` only inerts the panel *when
closed*). Keyboard focus is therefore not contained.

Live evidence (`scratchpad/a19-repro3.mjs`, storageState d-001, 1440px):
```
COPILOT autofocus on open -> tag: INPUT inDialog: true            ← opens focused correctly
COPILOT tab trail: OUT:BODY OUT:A OUT:BUTTON(Collapse menu) OUT:BUTTON(Map view)
  OUT:BUTTON(Overview) OUT:BUTTON(Branches) OUT:BUTTON(Agents) OUT:BUTTON(Subscribers) …
COPILOT escaped-to-background at Tab #: 1
```
The very first Tab leaves the "modal" dialog and walks the entire background sidebar — a
broken `aria-modal` contract for keyboard and screen-reader users. Present on both distributor
and admin desktop (same component, `scope="distributor"|"admin"`).

### A19-006 (Low, confirmed) — Same Copilot does not restore focus to its trigger on close
The distributor/admin shells wire `onClose={() => setCopilotOpen(false)}` with no focus
restoration (contrast the routed shells' `askAiRef.current?.focus()`). After Escape, focus is
left wherever Tab had moved it in the background:
```
COPILOT focus after close -> BUTTON "Subscribers…"   ← left on a background sidebar button, not the Ask-AI trigger
```

**Escape / visible focus (PASS):** every dialog examined closes on Escape (Modal,
EmployerSlidePanel, DataCopilotPanel, the routed copilots, the distributor/admin MobileDrawer
`role="dialog"` at `DashboardShell.jsx:96`/`AdminDashboardShell.jsx:125`). The MobileDrawers
are CSS-hidden at ≥1024px so are not a desktop concern. Visible focus rings come from the
global `:focus-visible` styling; no removed-outline patterns found in the shells.

---

## Check 6 — Copilot panels across roles (consistency, error handling, no visual leak)

### A19-007 (Low/Info, confirmed) — Two divergent Copilot interaction models across the six roles
- Subscriber / Agent / Branch / Employer: **non-modal** right-hand panel that is the shell's
  third grid column; opening it force-collapses the rail and reflows the page beside it; no
  backdrop; not a `dialog`.
- Distributor / Admin: **modal** backdrop drawer (`DataCopilotPanel`, `role="dialog"`
  `aria-modal="true"`, dimming backdrop, slides over the map).

Same feature ("Ask AI"), two behaviours and two a11y contracts — a design-system
inconsistency a rep switching roles in one session would notice, and the source of A19-005/006.

**No visual data leak (PASS):** confirms A07's finding that chat has no DB access. Both models
answer from client-side, already-RLS-scoped context (`DataCopilotPanel` passes
`scope="distributor"|"admin"` + a `ctx` rollup already loaded for the signed-in entity; the
routed copilots use per-role client responders). The welcome/suggestion copy is generic; no
cross-tenant identifiers are surfaced in the panel chrome.

---

## Check 7 — Long-session (30 min): stale data, memory, expired-token handling

**Blocked (not run to completion — time budget).** Assessed statically + by token inspection:
- **Token:** the demo JWT is a 24h HS256 token (verified `exp` = 2026-08-25T13:03Z, i.e.
  ~24h out; no refresh-token flow in this demo). Within any 30-min session it cannot expire,
  so expired-token handling is a non-issue at 30 min; beyond 24h the API would 401, but the
  A09 auto-pause (~7-day idle) and cold-restore bite long before a rep hits 24h in one sitting.
- **Stale data:** React Query with per-hook `staleTime` 5–15 min and default
  `refetchOnWindowFocus`; refocusing after idle refetches. No shell-level staleness defect.
- **Memory:** the map is mounted once (kept via CSS-hide) with WeakMap style caches; the main
  growth risk is A19-004 (leaving the Subscribers/Agents panel open holds ~4,600/2,046 live
  DOM rows), compounded by repeated drills. No standalone finding beyond A19-004.

---

## Findings summary

| id | sev | conf | title |
|---|---|---|---|
| A19-001 | medium | confirmed | Refresh loses the current view on distributor + admin desktop (reverts to overview) |
| A19-002 | medium | confirmed | Distributor + admin panel/rail views are not deep-linkable or shareable (all render at `/dashboard`) |
| A19-003 | medium | confirmed | Browser Back exits the dashboard instead of undoing a panel switch (panel nav pushes no history) |
| A19-004 | medium | confirmed | Distributor + admin Subscribers (~4,602) / Agents (~2,046) lists defeat their virtualizer in dash mode — every row renders to the DOM |
| A19-005 | medium | confirmed | Distributor + admin Ask-AI Copilot declares `aria-modal` but does not trap focus (escapes to background on first Tab) |
| A19-006 | low | confirmed | Same Copilot does not restore focus to its trigger on close |
| A19-007 | low | confirmed | Two divergent Copilot interaction models (4× non-modal grid-push vs 2× modal drawer) across the six roles |
| A19-I1 | info | confirmed | All shells cap+centre content; 2560px shows large but symmetric intentional gutters — recorded so it is not re-flagged |
| A19-I2 | info | confirmed | Historical map `onEachFeature` empty-name→id race is fixed (guarded `if(id) drillDown`) — recorded as refuted |

## Traceability
| Spec check | Disposition |
|---|---|
| 1 · 6 shells at 1024/1440/1920/2560 — 3-col layouts, sidebars | PASS |
| 1 · Copilot panels present per shell | PASS |
| 1 · overflow / broken columns | PASS |
| 1 · ultrawide waste at 2560 | PASS (intentional centred column) — FINDING A19-I1 (info) |
| 2 · refresh loses drill/panel state? | FINDING A19-001 |
| 2 · panel states deep-linkable? | FINDING A19-002 |
| 2 · browser back works? | FINDING A19-003 |
| 2 · can a rep share a URL to a specific view? | FINDING A19-002 |
| 3 · react-leaflet drill across 136 districts | PASS |
| 3 · onEachFeature empty-name→id race | PASS (refuted) — FINDING A19-I2 (info) |
| 3 · interaction latency / memory growth over repeated drills | BLOCKED (not measured over time; static posture reasonable) |
| 4 · sorting | PASS |
| 4 · pagination / virtualisation over 5,000-row lists | FINDING A19-004 |
| 4 · CSV export at the 5,000 cap — silent truncation? | PASS (not silent; desktop streams full) |
| 5 · tab order / visible focus / Escape closes panels | PASS |
| 5 · focus trap in the role="dialog" set + restoration on close | FINDING A19-005 (trap) + A19-006 (restore); Modal + EmployerSlidePanel PASS |
| 6 · Copilot consistency / error handling / no visual leak | FINDING A19-007 (consistency); no-leak PASS |
| 7 · long-session (30 min) stale data / memory / expired token | BLOCKED (not run to completion; assessed statically, token 24h) |

## Notes on method / hygiene
- All reproductions used the pre-existing, gitignored `e2e/.auth/{distributor,admin,subscriber}.json`
  storageState (re-minted earlier today by another agent; token `exp` verified valid, JWT never printed — G2).
- **No database rows were created or modified.** All browser sessions were read-only navigation.
- No repo source was edited (G1). Scripts + screenshots live under the audit scratchpad only.
