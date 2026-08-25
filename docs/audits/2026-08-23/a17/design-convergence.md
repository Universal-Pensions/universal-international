# A17-005 / A17-006 — design-system convergence evidence

Agent: `P5-design-tokens` · Phase 5 · 2026-08-25
Write-set: `**/*.module.css` for the six role shells + overview/KPI surfaces; this file.
Guardrail honoured: no `.jsx`/`.js` touched; `src/dashboard/overlay/DataCopilotPanel.module.css`
(owned by `P5-copilot-shells`) not touched.

House rules applied as the tie-breaker (per dispatch, not the audit's own suggested_fix alone):
less solid indigo (light tints, at most one solid indigo CTA per screen at rest), no circular
avatars (not implicated here), compact/summary-first.

---

## A17-005 — "Ask AI" affordance, six-role inventory

| Role | File:line (pre-edit) | Rest treatment | In my write-set? |
|---|---|---|---|
| Agent (reference) | `src/agent-dashboard/shell/AgentDesktopShell.module.css:79-121` | White bg, `1px solid var(--color-lavender)` border, indigo text, `radius-full`, amber-ink icon. No box-shadow, no hover lift. | Yes — already compliant, **not edited**. |
| Subscriber | `src/subscriber-dashboard/shell/SubscriberDesktopShell.module.css:87-130` (+ separate rule at `:72-79`) | Solid `var(--color-indigo)` bg, white text, `radius-md`, `box-shadow`, hover lift + darken to indigo-deep. A **separate** rule, `.topBar > div > button { box-shadow: … }` (lines 72-79), boosted the notification bell's shadow "to match `.askAi`'s resting shadow." | Yes — **converged**. |
| Employer | `src/employer-dashboard/shell/EmployerDesktopShell.module.css:65-103` | Solid `var(--color-indigo)` bg, `1px solid var(--color-indigo)` border, white text/icon, `radius-md`, `box-shadow`, hover lift. Byte-identical recipe to Branch. | Yes — **converged**. |
| Branch | `src/branch-dashboard/shell/BranchDesktopShell.module.css:63-101` | Same recipe as Employer (same comment, same properties, independently duplicated). | Yes — **converged**. |
| Distributor | `src/dashboard/overlay/DataCopilotPanel.module.css:305-331`, class `.fab`, exported as `AskAiFab`, consumed by `src/dashboard/DashboardShell.jsx` | Solid `var(--color-indigo)` bg, white text/icon, `radius-md`, heavy box-shadow (`0 12px 28px …, 0 2px 6px …`), hover lift + darken; desktop media query at `:359-372` docks it top-right at 40px height. | **No** — `DataCopilotPanel.module.css` is explicitly excluded (owned by `P5-copilot-shells`). |
| Admin | Same `.fab` in the same file — `src/admin-dashboard/AdminDashboardShell.jsx` imports the same `DataCopilotPanel` component; `src/admin-dashboard/adminChrome.module.css:1-20` only positions the shared FAB, it doesn't restyle it. | Identical to Distributor's — same component instance, not a separate implementation. | **No** — same excluded file. |

**Count:** pre-edit, 5 of 6 roles rendered a solid-indigo pill at rest (matches the finding's own
evidence text) and only Agent was white-at-rest. Distributor and Admin are literally the *same*
component instance (`AskAiFab`), not two independent implementations, so there are really only
**five distinct CSS recipes** behind the six roles: Agent (white), Subscriber (own), Employer/Branch
(shared, identical), Distributor+Admin (shared `.fab`).

### Decision: converge to white-at-rest (Agent's recipe)

Applied verbatim to Subscriber, Employer, Branch:
- `background: var(--color-white)`, `border: 1px solid var(--color-lavender)`, `color: var(--color-indigo)`, `border-radius: var(--radius-full)`.
- Dropped the box-shadow and hover `translateY` lift — those were calibrated for a filled CTA; keeping a heavy indigo glow under a light outline pill would look like an unfinished hybrid, and Agent's reference carries neither.
- Icon (`.askAiIcon`) recoloured from white to `var(--color-amber-ink)` at rest (see contrast below) — leaving it white on white would have made the sparkle glyph invisible. `.askAiActive .askAiIcon` added/kept as white so it stays legible on the filled active state.
- Active/open state (`.askAiActive`) kept as a solid fill (`var(--color-indigo)`, white text) — matches Agent's own reference exactly. This is a deliberate exception to "light tints": only one instance of this control can ever be in the open state at a time, so it never stacks with another solid-indigo element the way a permanently-filled *resting* button would.
- Subscriber-only: removed the separate `.topBar > div > button` bell-shadow-boost rule (was lines 72-79). Its own comment said it existed to "match `.askAi`'s resting shadow" — once Ask AI has no resting shadow, keeping the bell shadowed would have created a *new* bell-vs-button inconsistency inside the same topbar. Agent's shell (the reference) has no equivalent rule; Employer/Branch never had one. Removing it, rather than leaving a stale comment describing a shadow that no longer exists, is the correct convergence, not scope creep.

**Border-radius was included in the convergence** even though the finding's evidence quotes only
`background`. Reasoning: `--radius-full` is already an established pill token in all three files
being changed (verified via grep — Subscriber's own HomeDesktop.module.css alone uses it 5+ times;
Employer and Branch both use it repeatedly elsewhere in their own desktop CSS), so adopting it for
Ask AI introduces no foreign shape. Each of the three shells also has a local `--radius-md: 0.5rem`
override (same pattern Agent's shell uses), so at rest they were rendering a 40px-tall rounded
*rectangle*, not a capsule — a real, visible shape difference on top of the color difference. Fixing
only the fill and leaving the shape mismatched would still "read as two different buttons," which is
the finding's literal complaint.

### Contrast (WCAG AA), computed against the actual resulting backgrounds

| Foreground | Background | Ratio | Threshold | Pass? |
|---|---|---|---|---|
| `--color-indigo` `#292867` text | `--color-white` `#FFFFFF` (rest) | **~13.2:1** | 4.5:1 (AA normal text) | Yes — exceeds even AAA (7:1) |
| `--color-amber-ink` `#B45309` icon | `--color-white` `#FFFFFF` (rest) | **~5.02:1** | 4.5:1 (AA); icon is `aria-hidden`, text label "Ask AI" carries the accessible name, so even the lower 3:1 non-text bar would clear it | Yes (token's own comment in `src/index.css:123` independently states 5.02:1 — recomputed and confirmed here) |
| `--color-white` text/icon | `--color-indigo` `#292867` (active) | **~13.2:1** (contrast is symmetric) | 4.5:1 | Yes — unchanged from what Subscriber/Employer/Branch already shipped for their active state |
| `--color-indigo` text | `color-mix(indigo 6%, transparent)` over white (hover) | still **>12:1** (a ~6%-indigo tint barely moves off pure white) | 4.5:1 | Yes |
| `--color-lavender` `#D9DCF2` border | `--color-white` (rest) | ~1.36:1 | N/A — decorative card/button hairline, not the sole means of identifying the control (visible "Ask AI" text label + cursor/hover/focus affordance carry that); this is the *same* pre-existing pattern already shipped in Agent's reference and used for card borders throughout the app (`--card-bd` is similarly low-contrast against white) | Not a new risk — pre-existing, repo-wide pattern, not introduced by this change |

No contrast regression. The two properties WCAG actually gates for this control (button text, and
the icon since it happens to carry a documented ratio) both improved or held at very high contrast;
nothing dropped below AA.

### Escalation — not closed for all six roles

Distributor and Admin's Ask AI (`AskAiFab` / `.fab` in `src/dashboard/overlay/DataCopilotPanel.module.css:305-331`)
still rests solid-indigo. That file is explicitly owned by `P5-copilot-shells` per this agent's
guardrails ("do not edit that one file"), so it is out of reach here. **Filed as an escalation**,
not silently dropped — see `escalations` in the output contract. The remaining work is small and
mechanical: apply the same five property changes (`background`, `border`, `color`, and add
`.fab:hover`/icon-color rules mirroring what this file already does for `.fab` states) to bring the
FAB's rest state in line with the other four. Until that lands, A17-005 is **4/6 roles converged**,
not fully closed.

---

## A17-006 — KPI tile row, six-role inventory

| Role | Component / File:line (pre-edit) | Rest treatment | Tiles on the Overview/Home row | In my write-set? |
|---|---|---|---|---|
| Subscriber | inline `.kpi` divs, `src/subscriber-dashboard/home/HomeDesktop.module.css:305-336` | Left accent rail: `.kpi::before`, 4px, `background: var(--ac)`, widens to 6px on hover. `--ac`/`--tint` set inline per tile (indigo / green / indigo-soft). | 3 (Amount invested / Investment growth / Saved this month) | Yes — **converged**. |
| Employer | `<Tile>` from `src/employer-dashboard/desktop/ui.jsx`, styled in `src/employer-dashboard/desktop/ui.module.css:146-165` | Left accent rail: `.tile::before`, 3px, `background: var(--ac, var(--color-indigo))`. `accent` prop maps to a fixed category colour per tile. | 4 (Next contribution / Employee total / Employer total / Pending KYC) | Yes — **converged** (shared file, see below). |
| Branch | Same `<Tile>` component, imported from `employer-dashboard/desktop/ui.jsx` into `src/branch-dashboard/desktop/OverviewDesktop.jsx` | Identical — same CSS module as Employer. | 4 (Funds under management / Contributions this month / Subscribers / Agents) | Yes — same file as Employer. |
| Agent | `<MetricTile variant="secondary">`, `src/dashboard/shared/MetricTile.jsx` + `src/dashboard/shared/MetricTile.module.css:6-53` | **Flat** — no `::before`; only the icon chip (`.iconChip`) is tinted via `--tile-accent`/`--tile-tint`. | 4 (Monthly contributions / To be paid / Onboarded / Yet to contribute) | Already compliant — **not edited**. |
| Distributor | local `Tile` fn in `src/dashboard/overview/DistributorOverview.jsx:95-117`, styled in `src/dashboard/overview/DistributorOverview.module.css:54-102` | **Flat** — no `::before`; icon chip tinted via `[data-tone]`. | 4 (Funds under management / Contributions / Subscribers / Agents) | Already compliant — **not edited**. |
| Admin | `src/admin-dashboard/overview/AdminOverview.jsx:30` imports `styles` directly from `'../../dashboard/overview/DistributorOverview.module.css'` — not a copy, the *same* file. | Identical to Distributor's — same CSS module, same class names. | 4 | Already compliant — **not edited** (same file as Distributor, confirmed via `grep` that only these two files import it). |

**Count — by role (the finding's own framing):** exactly 3 vs 3, as the finding states ("splits 3/3
across the six roles"). This does not by itself favour either direction.

**Count — by rendered surface (the tie-breaker requested):** because Employer and Branch share one
CSS module (`ui.module.css`) and Distributor/Admin share another (`DistributorOverview.module.css`),
there are really only **3 accent-bordered CSS recipes vs. 3 flat CSS recipes** at the *file* level —
also a wash. But the **blast radius** differs sharply: `<Tile>` from `ui.module.css` is used at ~70
call sites across 14 employer+branch desktop pages (Overview, Runs, Analytics, Insurance, Employees,
Pending KYC, Support, Contributions, Agents, Commissions, AgentDetail, AttentionAgents — verified by
`grep -rl "<Tile" src/employer-dashboard/desktop src/branch-dashboard/desktop`), while the flat
recipe's blast radius is just the 3 Overview/Home pages themselves (Agent Home, Distributor Overview,
Admin Overview — `DistributorOverview.module.css` is provably imported nowhere else). Converging
*to* flat therefore changes far more screens than converging *to* accent would have. This is flagged
here deliberately rather than hidden, because it cuts against the direction chosen below on a naive
"smaller diff" reading — the decision was made on other grounds, not because it touched fewer things.

**Is the accent colour load-bearing for any state?** Checked every `accent`/`tone` prop value passed
at each Overview call site (Subscriber's 3, Employer's 4, Branch's 4, Distributor's 4). All are
**fixed per tile identity** (e.g. Distributor's "Contributions" tile is always `tone="green"`,
never conditionally red/amber for a bad month) — none vary with live data. The one place colour
*does* encode live state is the **value text** and a separate `sub`/`tileSub` line (e.g. Subscriber's
`.kpiValueGrow`/`.kpiValueLoss`, Distributor's `.tileSub[data-tone='up'/'down']`) — those are
untouched by this change; only the decorative rail/icon-chip tint was in scope, and none of that is
status-bearing. **Flattening does not destroy any information.**

### Decision: converge to flat

The decisive evidence is `src/components/MetricHero/MetricHero.jsx` + `.module.css` — a primitive
built in this same remediation programme's Phase 4 (`P4-hero-primitive`), explicitly documented as
**"the shared primitive behind every money hero strip on the platform."** Its own header comment
(`MetricHero.module.css:1-10`) states it reconciles *exactly* the two recipes found here —
"the two drifted-but-converged Tile recipes already in the codebase (`DistributorOverview.module.css`
… and `employer-dashboard/desktop/ui.module.css`)" — into one flat visual language ("white card, ~12%
tinted icon chip, never a solid-fill tile — house rule: light tints over solid indigo"), and its
`.tile` class (`MetricHero.module.css:40-138`) has no `::before` rail. `DistributorOverview.jsx`
already imports and renders inside `<MetricHero>` today (its own local `Tile` still does the visual
work, per that file's doc comment noting adoption is a later wave — but the loading/error wrapper is
already live).

That is a previous phase's deliberate, already-built architectural decision, not a stylistic
preference invented here. Converging Subscriber/Employer/Branch to flat now means they land where
the codebase is already headed; converging Agent/Distributor/Admin *to* accent would create a fresh
divergence from `MetricHero.Tile` that a later wave would have to undo. Flat also reads as more
compact/summary-first (one fewer decorative element per tile), consistent with the house rule, though
that alone was not treated as decisive — the Phase-4 precedent was.

Mechanically, this required no JSX changes: every tile's colour-driving hook (`--ac`/`--tint` custom
properties, or `[data-tone]` attributes) is already present in the DOM/inline styles regardless of
whether a rail is painted, because the same values already drive the icon-chip tint. Removing the
`::before` rule was sufficient in both edited files.

### Files changed for A17-006
- `src/subscriber-dashboard/home/HomeDesktop.module.css` — removed `.kpi::before` and `.kpi:hover::before`.
- `src/employer-dashboard/desktop/ui.module.css` — removed `.tile::before`. (Shared by Employer and Branch — flattens `<Tile>` everywhere it's used in both apps, not just the two Overview screens; there is no way to scope this to only the Overview row via CSS alone, since the same class is reused by design and adding a variant modifier would require a JSX prop change, which is outside this agent's write-set.)

No escalation needed for A17-006 — all six roles are now flat, and the two already-flat files
(Agent's `MetricTile.module.css`, the shared `DistributorOverview.module.css`) were left untouched
since they required no change and touching them would only have added unnecessary diff surface in a
file six concurrent agents are working around.

---

## Scope notes

- **Desktop only.** Both findings' evidence is 1440px-viewport screenshots exclusively ("surface:
  top-bar Ask AI button" / "overview/home KPI tile row"). Grepped for `askAi`/`kpi` classes in every
  role's *mobile* shell CSS (`AgentShell`, `SubscriberShell`, `EmployerShell`, `BranchMobileShell`,
  `DistributorMobileShell`, `AdminMobileShell`) — none exist; mobile uses a bottom tab / sheet pattern
  (`*AskAISheet.jsx`) that isn't the "top-bar button" or "KPI tile row" these findings describe, so it
  was left out of scope rather than folded in.
- **`Card`'s `cardAccent` variant** (also in `ui.jsx`/`ui.module.css`) is a different component from
  `Tile` and not part of either finding's location — left untouched.
- **`MetricTile.module.css`'s** header comment still says "subscriber + agent Home only," but
  Subscriber's actual Home no longer imports it (it has its own local `.kpi`, independently
  evolved). That comment is now stale, but fixing stale comments in a file with no functional change
  needed is outside these two findings — noted here for whoever next touches that file.

## Verification gate

Commands run exactly as specified, from a pre-flight-clean working tree (`git status --porcelain`
was empty for every file in this agent's write-set before any edit).

**Before** (`npx vitest run --silent`, captured before any edit in this session):
```
Test Files  1 failed | 185 passed (186)
     Tests  2 failed | 4470 passed (4472)
  Duration  288.75s
```
The 1 failing file/2 failing tests were `src/services/__tests__/tickets.test.js` — an unrelated
`sessionStorage` test that timed out at 5000ms (A22-006 area, nothing to do with CSS/Ask AI/KPI
tiles, not in this agent's write-set).

**After** (same command, post-edit):
```
Test Files  186 passed (186)
     Tests  4472 passed (4472)
  Duration  27.73s
```
Zero new failures. The previously-timing-out test passed this run too (duration dropped from 289s to
28s between runs — consistent with the earlier failure being a load-dependent flake, not something
this change touched).

**Build** (`npm run build`, post-edit): exited 0, `✓ built in 4.56s`, no errors or warnings.
A pre-edit build was not re-run via stash (the tree is a live, concurrently-edited checkout shared by
six other agents right now; a scoped stash/pop was judged a needless coordination risk for a change
this contained). In its place: `git diff` was inspected line-by-line for every edited file and
confirmed **no CSS class name or selector was renamed** — every `+`/`-` line is either a still-existing
selector (`.askAi`, `.askAiIcon`, `.kpi`, `.tile`, …) or the deletion of a pseudo-element/compound
selector (`.tile::before`, `.kpi::before`, `.kpi:hover::before`, `.topBar > div > button`) that no
`styles.xxx` JSX reference ever pointed at — which is the specific failure mode the build gate warns
about ("CSS module class renames break the build loudly"). Brace balance was also checked
mechanically across all five edited files (`{` count == `}` count in each) before running anything.
