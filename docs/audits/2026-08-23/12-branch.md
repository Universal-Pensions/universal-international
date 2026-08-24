# A12 · Branch Supervisor — Phase 3 Browser Walkthrough

**Scope:** the branch-admin dashboard (`src/branch-dashboard/`), signed in as persona
`b-kam-015` (Kampala Central, phone `+256700000011`, via the `/distributors` portal → **Branch**
role tab). Branch has **two entirely separate route tables** (desktop `BranchDesktopShell.jsx`,
mobile `BranchMobileShell.jsx`); both were audited and compared for capability parity.
Cites `docs/audits/2026-08-23/00-baseline.md` (ground truth) throughout.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 22 branch routes (10 desktop + 12 mobile) · 2 derive engines (`branchOverviewDerive.js`, `deriveBranchAnalytics.js`) · SPEC §5 formulas |
| Artifacts examined | 22/22 routes · both derive engines · both shells · both settings pages · SPEC health + agent-performance formulas |
| Coverage | 100% of routes at primary viewport; shell boundary spot-checked at 1024/768 |
| Checks defined | 26 |
| Checks executed | 26 |
| Checks passed / failed / blocked | 15 / 11 / 0 |
| Findings C / H / M / L / I | 0 / 0 / 4 / 4 / 2 |
| Evidence commands run | 14 (6 psql + 8 Playwright/browser scripts) |
| Excluded as demo-scope | 2 (create-agent writes live — not exercised; support tickets in-memory) |
| Blocked, with reason | none |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Desktop routes reachable & rendering | 10/10 |
| Mobile routes reachable & rendering | 11/12 (mobile `agents/:agentId/subscribers` **absent** — bounces to /dashboard) |
| Route×viewport cells captured | 24 desktop (1440) + 14 mobile (375) + 2 boundary (1024/768) screenshots |
| Overview numbers matching direct SQL | 8/8 (FUM, contributions, subs, active%, agents, commissions due, agent detail) |
| Health-score formula vs SPEC §5 | weights MATCH (0.30/0.25/0.25/0.20) |
| Capability parity gaps (desktop⇄mobile) | 3 (per-agent subscriber list, bulk-onboard: desktop-only; reports redirect broken on mobile) |

---

## 1. Sign-in & shell selection (PASS, with a trap)

Branch admins sign in via the **`/distributors`** landing (`DistributorsPage.jsx:127`,
`LandingLoginCard roles={['distributor','branch','agent']}`). You **must click the "Branch"
role tab** before entering the phone — the role is a request-body field (`api/auth/verify-otp.ts:132`),
not derived from the phone. **Trap confirmed:** signing in with `+256700000011` from the
subscriber portal (`/`) or without selecting the Branch tab resolves the phone as a *subscriber*
(lands on "Carol Obua / YOUR SAVINGS"), because `resolveDemoPersona` keys on `(phone, role)` and
falls back to `ROLE_DEFAULTS.subscriber` when the role hint is subscriber. Not a defect (the role
tab is the intended path), but a rep who forgets the tab gets the wrong dashboard.

Shell boundary (`useIsDesktop.js`, `min-width:1024px`) verified:
```
[1024px] firstline: ... Overview Agents Commissions Analytics Support 5 Settings Log out BRAN   ← DESKTOP shell
[768px]  firstline: ... Welcome back, Default · Kampala Central Funds under manageme            ← MOBILE shell
```
No 769–1023 dead band: 768 → mobile, 1024 → desktop, cleanly. **PASS.**

## 2. Branch overview numbers vs direct SQL (PASS — all 8 match)

Ground-truth SQL for `b-kam-015`:
```
$ psql "$SUPABASE_DB_URL" -Atc "... branch b-kam-015 ..."
agents_total|5           agents_active|4 (1 inactive)
subs_total|31            subs_active|28            active_rate_pct|90
aum_total_balance|13564967
contrib_total|10609421   withdraw_total|2215315
subs_without_balance|0
per-agent due: Brenda 60000 · Beatrice 55000 · Annet 25000 · Frank 15000 · Lillian 0  → 155000 total; paid 0
```
Rendered overview (desktop, screenshot `screenshots/branch/d-overview-1440.png`):
```
FUNDS UNDER MANAGEMENT 13.6M · SUBSCRIBERS 31 · 28 actively contributing · 90%
AGENTS 5 · 4 active · 1 inactive · Branch Health Score 84 GOOD
```
Analytics (`d-analytics-1440.png`): FUM UGX 13.6M · TOTAL CONTRIBUTIONS UGX 10.6M · ACTIVE 28 (90%)
· AGENTS 4/5. Commissions (`d-commissions-1440.png`): DUE 155K · SETTLED 0 · rate 0%, per-agent
60K/55K/25K/15K. Agent detail a-087 (`d-agentdetail-1440.png`): SUBSCRIBERS 11, 91% active, DUE 55K.
Agent-subscribers list (`d-agentsubs-1440.png`): 11 subscribers, 10 active, 5.3M balance.
**Every on-screen number reconciles to SQL. PASS.**

## 3. Health-score formula vs SPEC §5 (PASS)

`branchOverviewDerive.calcScore()` = `retentionRate*0.30 + avgContribScore*0.25 +
agentActivity*0.25 + growthScore*0.20` — **weights identical to SPEC §5** (`docs/SPEC.md:313-316`).
Recomputed by hand from live data: retention 90.3, avgContribScore min(100, 342239/500000·100)=68.4,
agentActivity 4/5=80, growthScore clamp((54/5)·50+50)=100 → `round(90.3·.30+68.4·.25+80·.25+100·.20)`
= **84** = rendered gauge. `scoreLabel(84)`="Good" per SPEC labels. **PASS.**
SPEC's random **Agent Performance Score** (`min(100, activeRate·0.4 + … + randInt(15,30))`) is
**not** used by the branch dashboard — the Analytics leaderboard sorts deterministically by
contributions (`deriveBranchAnalytics.js`), and `grep Math.random src/branch-dashboard` returns
**none**. Good: no per-render jitter in a demo.

## 4. Route parity — the two route tables side by side

| Capability | Desktop | Mobile | Verdict |
|---|---|---|---|
| index / overview | ✅ OverviewDesktop | ✅ BranchHomeMobile | parity |
| attention/:type (dormant, overdue) | ✅ | ✅ | parity |
| agents (roster) | ✅ | ✅ | parity |
| agents/:agentId (detail) | ✅ | ✅ | parity |
| **agents/:agentId/subscribers** | ✅ BranchAgentSubscribers | ❌ **no route → bounces to /dashboard** | **A12-005 (M)** |
| **create agent — single** | ✅ in-page mode | ✅ /agents/new | parity (task hypothesis "mobile-only" REFUTED) |
| **create agent — BULK (Excel/CSV)** | ✅ BulkOnboardAgents | ❌ single-only | **A12-006 (L)** |
| commissions | ✅ | ✅ | parity |
| analytics | ✅ | ✅ | parity |
| **reports → redirect** | ✅ → /dashboard/analytics | ❌ **→ /dashboard (overview)** | **A12-004 (L)** |
| support (list) | ✅ | ✅ | parity |
| support thread | ✅ in-page (`selected` state) | ✅ /support/:ticketId | parity |
| menu (hub) | — (side rail) | ✅ BranchHubMobile | mobile nav pattern (not a gap) |
| settings | ✅ | ✅ (+ Password tab) | parity |
| catch-all `*` → /dashboard | ✅ | ✅ | parity |

Create-agent exists on **both** shells — desktop as an in-page mode on the Agents page
(`AgentsDesktop.jsx:51,107` "Add agent" → `mode='create'`), mobile as the `/agents/new` route.
The plan's "confirm create-agent is absent on desktop" is **refuted**: it is present on desktop.

---

## Findings

### A12-001 · MEDIUM · confirmed · Branch charts drift against the demo clock (wall-clock month labels vs MOCK_NOW-anchored data)
The branch **Contributions — last 12 months** chart labels its x-axis from the **real wall clock**,
while the underlying 12-month series comes from the metrics RPC anchored to **`_demo_now()` =
2026-05-18**. The two clocks are 3 months apart today, so every bar is mislabelled and the
"Contributions this month" tile shows a stale month's number.

Location: `src/branch-dashboard/desktop/OverviewDesktop.jsx:64-72` (labels `const now = new Date()`)
and `src/branch-dashboard/analytics/deriveBranchAnalytics.js:47` (`trendFromSeries(series, now = new Date())`).

The codebase **documents three clocks** and sibling dashboards anchor to `MOCK_NOW`; branch does not:
```
$ grep -rn "MOCK_NOW\|_demo_now" src | grep -iv test
src/admin-dashboard/overview/adminAttentionDerive.js:12-13:
   // ... public._demo_now() (2026-05-18, anchors the seeded charts),
   //     JS MOCK_NOW (2026-05-26) and the real wall clock ...
src/subscriber-dashboard/reports/views/ContributionsSummary.jsx:25:
   // ... labels use [MOCK_NOW] ... rather than the wall clock
```
Evidence — live RPC series window vs rendered labels:
```
$ psql "$SUPABASE_DB_URL" -Atc "SELECT public._demo_now();"   →  2026-05-18 23:59:59+00
$ psql ... branch 12-month contribution buckets  →  Jun'25:7904 … Apr'26:632799  May'26:1185832
Rendered overview (24 Aug 2026): x-axis "Sep Oct Nov Dec Jan Feb Mar Apr May Jun Jul Aug"
   → the bar labelled "Aug" is really May'26 (1,185,832); "Contributions this month 1.2M" is May's.
Rendered mobile analytics: x-axis "S O N D J F M A M J J A" (same wall-clock end)
```
**Impact:** on any real demo date (always after the frozen MOCK_NOW), the branch collections chart
mislabels months by (wall-now − MOCK_NOW), and the headline "this month" figure is a past month's.
This is the "drift between MOCK_NOW copies" the audit explicitly flags.
**Fix:** pass `MOCK_NOW` (from `src/data/mockData.js`) as the `now` argument to the label helpers,
exactly as `ContributionsSummary.jsx` / `ActivityPage.jsx` already do.

### A12-002 · MEDIUM · confirmed · Agent-detail gender donut prints percentages as a subscriber count ("100 subscribers")
On the desktop agent-detail page the "Subscriber gender" card header shows a subscriber **count**
that is actually the **sum of the two gender percentages (~100)** — contradicting the "Subscribers"
tile on the same screen.

Location: `src/branch-dashboard/desktop/AgentDetailDesktop.jsx:48-52`
```js
const gr = metrics.genderRatio || {};          // gr.male / gr.female are PERCENTAGES (0–100)
return { data:[{Male,value:male},{Female,value:female}], total: male + female };  // ← 64+36 = 100
// :220  <SectionHead title="Subscriber gender" tag={`${formatNumber(gender.total)} subscribers`} />
```
Evidence — agent a-087 has 11 subscribers, yet the card says "100 subscribers":
```
$ psql ... "SELECT gender,count(*) FROM subscribers WHERE agent_id='a-087' GROUP BY gender"
female|4   male|7   (total 11)   → genderRatio male 64 / female 36 → sum 100
Rendered (d-agentdetail-1440.png): "SUBSCRIBERS 11 91% active" … "Subscriber gender 100 SUBSCRIBERS Male 64% Female 36%"
```
**Impact:** a branch admin drilling into *any* agent sees a gender card claiming ~100 subscribers
regardless of the real count, visibly contradicting the correct "Subscribers N" tile above it. The
donut proportions are correct; only the count label is wrong. (AgentDetailMobile omits the gender
card entirely, so it is desktop-only.)
**Fix:** use `metrics.totalSubscribers` for the count tag, not the percentage sum.

### A12-003 · MEDIUM · confirmed · District rank is computed from a stale stored score, not the "recomputed daily" gauge
The overview gauge labels itself **"RECOMPUTED DAILY"** and shows a live-computed **84**, but the
**"#3 of 8 in district"** rank next to it is derived from `branches.score` = **77**, a stored value
that is never recomputed. The rank therefore does not reflect the score being displayed.

Location: gauge `src/branch-dashboard/overview/branchOverviewDerive.js:calcScore` (live) vs rank
`src/branch-dashboard/desktop/OverviewDesktop.jsx:236` (`branch.districtRank` ← `branches.district_rank`).
```
$ psql ... "SELECT id,score,rank,district_rank,district_branch_count FROM branches WHERE id='b-kam-015'"
b-kam-015 | score 77 | rank 61 | district_rank 3 | district_branch_count 8
$ psql ... district peers ordered by district_rank:
Kawempe 81 (#1) · Makindye 78 (#2) · Kampala Central 77 (#3) · Ntinda 76 (#4) · …
Rendered gauge: "84 GOOD" ; rank chip: "#3 of 8 in district"
```
**Impact:** the branch's own live health score (84) would out-rank peers stored at 78/81, but the
frozen rank still shows #3. Cross-surface, the distributor's branch list (`ViewBranches.jsx:175`,
`entities.js:113`) shows this same branch as **77** while its own overview says **84** — two scores
for one branch. The "RECOMPUTED DAILY" claim is misleading (recomputed per-render, never daily; the
ranking score is never recomputed at all).
**Fix:** rank branches on the same live score the gauge shows, or drop the "recomputed daily" claim
and stop presenting a rank derived from a stale column.

### A12-004 · LOW · confirmed · Mobile `reports` redirect lands on the overview, not analytics (desktop is correct)
Both route tables define `reports` → `<Navigate to="/dashboard/analytics" replace/>`. Desktop honours
it; **mobile oscillates and settles on `/dashboard` (overview).**
```
$ node a12-reports.mjs
[desktop] direct /dashboard/reports FINAL URL: .../dashboard/analytics   ← correct
[mobile]  direct /dashboard/reports FINAL URL: .../dashboard             ← wrong
$ node a12-reports-trace.mjs   (mobile URL hops)
["/dashboard/reports","/dashboard/reports","/dashboard/analytics","/dashboard",
 "/dashboard/analytics","/dashboard"]   FINAL: /dashboard
```
Root cause: the mobile shell renders `<Routes location={location}>` inside
`<AnimatePresence mode="wait">` (`BranchMobileShell.jsx:37-63`). The animation-lagged explicit
`location` prop races the `reports→analytics` Navigate against the `*`→`/dashboard` catch-all, and
the catch-all wins.
**Impact:** low — no in-app nav links to `/dashboard/reports` (neither the desktop side rail nor the
mobile tab/hub), so only a stale external deep link reaches it, and it lands on a valid page (the
overview) rather than analytics. Still a confirmed desktop/mobile parity defect and a latent
routing fragility for any future in-route redirect on mobile.
**Fix:** don't pass an animation-lagged `location` to a `<Routes>` that contains `<Navigate>`
redirects; or replace the `reports` route element with a direct `<Navigate>` outside the animated
subtree.

### A12-005 · MEDIUM · confirmed · Per-agent subscriber list is desktop-only (unreachable on mobile)
Desktop lets a branch admin drill from an agent into that agent's subscribers
(`AgentDetailDesktop.jsx:159` "View subscribers" → `/dashboard/agents/:agentId/subscribers` →
`BranchAgentSubscribers`, rendering the 11-row list). **Mobile has no such route and no such CTA.**
```
Desktop  /dashboard/agents/a-087/subscribers → renders "Subscribers 11 · 10 ACTIVE · 5.3M BALANCE" (list)
Mobile   /dashboard/agents/a-087/subscribers → FINAL URL /dashboard  (bounced to overview; d/m route tables differ)
AgentDetailMobile has only "Call" + "Back to team" — no subscriber drill (grep: no NavLink to /subscribers)
```
**Impact:** a branch supervisor working on a phone (375, a supported viewport) cannot open a specific
agent's subscriber list — a capability present on desktop. (The agent's subscriber *count* is still
visible on AgentDetailMobile, so it is a degraded capability, not a total loss — hence Medium, though
by the letter of the rubric "a whole route unreachable on a supported viewport" argues High.)
**Fix:** add the `agents/:agentId/subscribers` route (and a "View subscribers" affordance) to
`BranchMobileShell`, mirroring desktop.

### A12-006 · LOW · confirmed · Bulk agent onboarding (Excel/CSV) is desktop-only
Desktop create-agent offers **single + bulk** tabs (`AgentsDesktop.jsx:10-11,62-78`,
`CreateAgentForm` + `BulkOnboardAgents`). Mobile `/agents/new` (`CreateAgentMobile.jsx`) is
**single-agent only** (`grep -i "bulk\|csv\|excel\|upload" CreateAgentMobile.jsx` → none).
**Impact:** low — a branch admin can bulk-onboard agents from a spreadsheet only on desktop.
Reasonable omission for a phone, but a genuine capability asymmetry between the two route tables.

### A12-007 · LOW · confirmed · Branch Settings "Save changes" (and mobile "Update password") fabricate success without persisting
```
src/branch-dashboard/desktop/SettingsDesktop.jsx:35  function handleSave(e){ e.preventDefault(); addToast('success','Branch profile saved.'); }
src/branch-dashboard/mobile/SettingsMobile.jsx:65     handleSaveProfile → addToast('success','Branch profile saved.')
src/branch-dashboard/mobile/SettingsMobile.jsx:83     handleUpdatePassword → addToast('success','Password updated.')
```
No mutation/RPC is wired; edits are discarded on reload. **Impact:** low — branch profile editing is
not a headline demo flow, and this matches the demo's broader mock-write pattern, but the toast
explicitly claims a save that did not happen (a rep who edits the manager name and reloads finds it
reverted). **Fix:** either wire a real `update_branch` mutation or change copy to "Preview only".

### A12-008 · LOW · confirmed · Absurd "▲ 14903% over the year" on the branch overview & analytics
`monthlyContribStat.yoyPct` (`branchOverviewDerive.js:87-91`) = `(current − firstNonZero)/firstNonZero`
where `firstNonZero` is the seed's ramp-up first month (**7,904 UGX**, Jun 2025), so the YoY badge
reads **14,903%**.
```
Overview (d-overview-1440.png):  "Contributions — last 12 months UGX 1.2M ▲ 14903% over the year"
Mobile analytics (m-analytics-375.png): "Contributions 12 MO UGX 1.2M ▲ 14903% over the year"
$ psql ... branch buckets: first non-zero = 7904 (Jun'25); current = 1,185,832 (May'26) → 14903%
```
**Impact:** low — technically the true ratio, but a "▲14903%" badge reads as broken in a live demo.
**Fix:** clamp/guard YoY when the base month is negligible, or compute YoY against a same-month-last-year
value rather than the first non-zero bucket.

### A12-I01 · INFO · Two E2E-leftover branches pollute the Kampala district (A06 owns)
```
$ psql ... branches in district d-kampala: 10 rows; 8 have scores/ranks, 2 are:
b-new-1785700420016 "E2E Branch 1785700415857" (score NULL, district_rank NULL)
b-new-1785753024670 "E2E Branch 1785753020590" (score NULL, district_rank NULL)
```
`district_branch_count`=8 excludes them, so the "#3 of 8" chip is internally consistent, but the two
test branches are stale writes left in **live** demo data. Data-hygiene; flagged for A06.

### A12-I02 · INFO · Manager-name vs persona-name inconsistency across surfaces
Desktop overview greets "Welcome back, **Default branch (Kampala Central)**" (JWT persona name),
while the mobile hub header (`m-menu-375.png`, `BranchHubMobile`) shows manager "**Isaac Asiimwe** ·
Branch Admin" (`branches.manager_name`). Two different names for the same signed-in user; cosmetic.

---

## Cross-reference (not re-counted — owned by A05)

**A05-008 confirmed still live for this branch.** The branch notification bell says money was paid
that the Commissions page (correctly) shows as unpaid:
```
$ psql ... "SELECT recipient_role,recipient_id,body,amount,ref_id FROM notifications
            WHERE recipient_role='branch' AND recipient_id='b-kam-015' AND ref_id LIKE 'sb-seed%'"
branch|b-kam-015|UGX 45000 paid for 9 commissions.|45000|sb-seed-0001
```
…while `/dashboard/commissions` shows **SETTLED 0 · rate 0%** (verified: all 4 agents `paid_amount`=0,
155K due). The seeded `settlement_batches` row `sb-seed-0001` is stamped to `b-kam-015` but belongs
to agent `a-001` (whose real branch is `b-bui-001`). Branch-visible contradiction; disposition and
fix are in `05-commission-settlement.md`.

---

## Report-only compliance

I performed **no committed writes.** All browser sessions were read-only navigations. I did **not**
submit the create-agent form (it calls the real `create_agent` RPC via `useCreateAgent` and would
insert a live agent — exactly the kind of stale write A12-I01 already documents) and I did **not**
submit either Settings form (they are no-ops anyway, A12-007). No fixture rows were created, so none
needed cleanup. All DB access was `SELECT`-only over `psql`.

---

## Traceability

| # | Check | Disposition |
|---|---|---|
| 1 | Branch sign-in through real UI (role tab) | PASS (§1) |
| 2 | Shell selects desktop ≥1024 / mobile <1024, no dead band | PASS (§1, 1024/768) |
| 3 | Desktop `index` overview renders + numbers vs SQL | PASS (§2) |
| 4 | Desktop `attention/:type` (dormant, overdue) | PASS |
| 5 | Desktop `agents` roster vs SQL | PASS (§2) |
| 6 | Desktop `agents/:agentId` detail vs SQL | PASS (§2) — but see #22 (gender) |
| 7 | Desktop `agents/:agentId/subscribers` list | PASS (renders 11) |
| 8 | Desktop `commissions` vs SQL | PASS (155K due / 0 paid) |
| 9 | Desktop `analytics` vs SQL | PASS |
| 10 | Desktop `reports` → analytics redirect | PASS |
| 11 | Desktop `support` (list + in-page thread) | PASS |
| 12 | Desktop `settings` renders | PASS — but see #24 (fake save) |
| 13 | Desktop catch-all `*` → /dashboard | PASS |
| 14 | Mobile `index`/`attention`/`agents`/`detail`/`commissions`/`analytics`/`support`/`thread`/`menu`/`settings` render | PASS |
| 15 | Mobile `agents/new` create-agent renders | PASS |
| 16 | Mobile `agents/:agentId/subscribers` reachable | **FINDING A12-005** (bounces to /dashboard) |
| 17 | Mobile `reports` → analytics redirect | **FINDING A12-004** (lands on overview) |
| 18 | Create-agent present on desktop (plan hypothesis) | PASS — refuted "mobile-only"; present in-page |
| 19 | Bulk-onboard parity desktop⇄mobile | **FINDING A12-006** (desktop-only) |
| 20 | Health-score formula vs SPEC §5 | PASS (§3) |
| 21 | Agent-performance formula vs SPEC (random) | PASS — deterministic leaderboard used instead; no Math.random |
| 22 | Agent-detail gender card count correctness | **FINDING A12-002** ("100 subscribers") |
| 23 | Branch health score / district-rank consistency | **FINDING A12-003** (84 live vs 77 stored/rank) |
| 24 | Settings write persists | **FINDING A12-007** (no-op fabricated success) |
| 25 | Chart month labels anchored to demo clock | **FINDING A12-001** (wall-clock drift) + **A12-008** (YoY) |
| 26 | Deep-link / hard-refresh restores same screen | PASS for all rendering routes; **FINDING A12-004/A12-005** for the two mobile bounces |

**Excluded as demo-scope:** create-agent live write (not exercised per G3/report-only); support
tickets in-memory store (A05/tickets owner; no vanishing-ticket demo break observed here).
**Blocked:** none.
