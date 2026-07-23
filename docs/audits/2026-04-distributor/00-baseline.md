> **Agent guide.** Historical audit from 2026-05-22 covering the baseline instrumentation captured before the six-phase distributor performance audit began — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Audit 00 — Baseline & instrumentation

**Date:** 2026-05-22 · **Auditor:** Claude (Opus 4.7) · **Phase:** 0 of 6

Records what's already in place before audit phases 1–5 begin, so they don't redo finished work.

---

## Supabase project

| Field | Value |
|---|---|
| Project name | Uganda dashboard |
| Project ref | `zengmiugieqjqzaccbqe` |
| Region | `ap-northeast-1` (Tokyo) |
| Postgres | `17.6.1.121` (engine 17, GA channel) |
| Status | `ACTIVE_HEALTHY` |
| Created | 2026-05-14 |

**Region note:** Project lives in Tokyo. Latency from a Kampala/Uganda demo client is unavoidably 200–400 ms RTT. This is a likely contributor to "metrics feel slow" — any per-row round-trip pays the WAN penalty per call. Phase 1 must distinguish *WAN latency* from *query time* in EXPLAIN ANALYZE output (the latter is server-side only).

## Extension inventory (relevant only)

| Extension | Installed | Schema | Use |
|---|---|---|---|
| `pg_stat_statements` | **1.11 (yes)** | `extensions` | Phase 2 query budget |
| `pg_trgm` | 1.6 (yes) | `extensions` | Search service |
| `pgcrypto` | 1.3 (yes) | `extensions` | UUID/hash |
| `uuid-ossp` | 1.1 (yes) | `extensions` | UUIDs |
| `supabase_vault` | 0.3.1 (yes) | `vault` | Secrets |
| `index_advisor` | available (off) | — | Optional: install in Phase 2 if missing-index analysis needs more than `get_advisors` |
| `hypopg` | available (off) | — | Optional: hypothetical-index testing in Phase 2 |
| `plpgsql_check` | available (off) | — | Optional: function correctness in Phase 2 |
| `pg_stat_monitor` | available (off) | — | Richer than pg_stat_statements; do NOT enable mid-audit |

**Critical: pg_stat_statements already accumulating** — 1,562 distinct statements tracked, max 15,001 calls on one query, ~42 minutes of accumulated execution time. Phase 2 has rich data to mine immediately. No prep migration needed.

## MCP tool access verified

| Tool | Verified | Use |
|---|---|---|
| `mcp__supabase__list_projects` | ✓ | Project lookup |
| `mcp__supabase__list_extensions` | ✓ | This doc |
| `mcp__supabase__execute_sql` | ✓ | EXPLAIN ANALYZE, query inspection |
| `mcp__supabase__get_logs` | pending | Phase 1 — query logs during slow distributor load |
| `mcp__supabase__get_advisors` | pending | Phase 2 — performance + security advisors |
| `mcp__supabase__list_migrations` | pending | Phase 2 — confirm 21 migrations applied |
| `mcp__supabase__list_tables` | pending | Phase 1/2 — schema confirmation |

## Existing audit state (do NOT re-flag)

### Prior audit (`docs/DASHBOARD_AUDIT.md`, 2026-04-30)

86 findings across subscriber, branch, distributor dashboards. Severity-graded P0/P1/P2.

### Companion fix log (`docs/DASHBOARD_AUDIT_FIXES.md`)

**Closed (do not re-flag):** All 10 top-priority P0s. Specifically:

| # | Was | Fixed via |
|---|---|---|
| 1 | `ViewBranches` direct state mutation (`Object.assign`) | `useUpdateBranch` mutation hook |
| 2 | Frequency-key drift (4 variants) | `FREQUENCY` constants + `normalizeFrequency` in `utils/finance.js` |
| 3 | TopBar filter non-functional | Wired to children list + CSV export |
| 4 | Distributor `<main id="main">` missing → broken skip link | Real `<main id="main">` |
| 5 | ProfilePage fake save (600ms setTimeout) | `useUpdateProfile` |
| 6 | `MetricsRow` Unicode `…` escape | Literal `…` char |
| 7 | HelpPage "agent reply in 2 min" misleading copy | Relabelled "Live support chat" |
| 8 | Branch admin scope guard silently widens to network on missing `branchId` | Hard-fail screen + `/coming-soon` fallback |
| 9 | `window.confirm` for branch deactivation | Styled in-panel modal |
| 10 | Hardcoded sidebar counts ("310 branches" etc) | Read from `useAllEntities` (formatted `12K` / `30K`) |

Plus ~25 P1s also fixed (UG-flag emoji removal, copilot toggle persistence, breadcrumb `aria-current`, NavAnnouncer downgrade, etc.).

### Deferred refactors still open

These are documented in `DASHBOARD_AUDIT_FIXES.md`'s "Deferred" section as out-of-scope-for-this-pass — they appear as legitimate findings if the audit reproves the impact:

- Extract `<EntityListPanel>` (collapses `ViewBranches` 1035L + `ViewAgents` 639L)
- Extract `<ChatThread>` (5 chat implementations: CoPilotWidget, BranchHealthScore copilot, MetricsRow ChatCard, AgentPage, HelpPage)
- Extract `<RoleSidebar>` (3 sidebars)
- Decompose `BranchHealthScore.jsx` (522L) into hook + 4 child components
- Multi-step flow shell for Save/Withdraw/Claim
- Real "Recent Activity" feed once event log exists
- Map legend on UgandaMap
- Telemetry / analytics events
- Subscriber `Settings` reuse vs branch admin

### Known product bugs surfaced by /qa harness

`.claude/skills/qa.md` documents these as "known broken, suite covers":

1. **`CreateBranch.jsx`** distributor-side Create Branch is a UI mock — `handleConfirm()` only sets local success state, never calls `useCreateBranch`. Spec marked `test.fail()`.
2. **`ProfilePage.jsx`** hydration bug — `useState(sub?.x || '')` for form fields without hydration effect; renders empty until user retypes.
3. **Agent onboard AML step hang** — wizard stalls at step 6/8 past 30 s; spec `test.fixme()`.
4. **`/dashboard/commissions/due`** — not in VALID_VIEWS; redirects to base route (probably intended).
5. **`/dashboard/reports/contributions`** — legacy slug; actual is `contributions-summary`.

## E2E harness inventory

`/qa` skill — 78 tests across desktop + mobile projects.

| Directory | Count | Purpose |
|---|---|---|
| `e2e/specs/smoke/` | 6 files | Landing + 4 role dashboards + `_health` |
| `e2e/specs/flows/` | 10 files | UI + DB-verified flows |
| `e2e/specs/regression/` | 4 files | Write failures, modal escape, mobile drawer, empty states |
| `e2e/specs/db/` | 1 file (`invariants.spec.ts`) | DB-level invariants |

**Most relevant for Phase 1:** `e2e/specs/flows/distributor-renders-data.spec.ts` already enforces a 5 s chrome SLA and asserts OverlayPanel subscriber/agent/branch tiles > 0 (subscribers > 29,000). The current passing spec means the *tile rendering* path is wired; the user's lag complaint may live elsewhere (map mount, MetricsRow chat, route transitions, or the drill-down `useChildren` waterfall — the latter has no `staleTime` set, see below).

## Critical reference docs (read by future phases)

| File | Lines | Phase needs |
|---|---|---|
| `CLAUDE.md` | 209 | All phases — anti-patterns, demo scope, hard rules |
| `FRONTEND.md` | 819 | Phase 3 — services, hooks, contexts, design tokens, accessibility |
| `BACKEND.md` | 631 | Phase 2 — env, API, schema, RLS, RPCs, commission state machine, triggers, seeding |
| `docs/api-contracts.md` | 549 | Phase 3 (TanStack cache keys), Phase 5 (drift) |
| `docs/role-permissions.md` | 345 | Phase 4 (capability matrix per role) |
| `docs/data-model.md` | 488 | Phase 1/2 (rollup rules + entity model) |
| `docs/SPEC.md` | 484 | Phase 4 (primary user flows) |
| `.claude/skills/qa.md` | 172 | Phase 4 (test harness extension) |
| `docs/DASHBOARD_AUDIT.md` | 210 | All phases (what was already audited) |
| `docs/DASHBOARD_AUDIT_FIXES.md` | 79 | All phases (what was closed) |

## Initial perf hypothesis (informs Phase 1)

Reading `src/hooks/useEntity.js` reveals four hooks with `staleTime: 5 * 60 * 1000` (5 min) — the *metric* hooks. But the underlying entity hooks (`useCountry`, `useEntity`, `useChildren`, `useAllEntities`, `useAllEntitiesMap`, `useTopBranch`, `useBreadcrumb`, `useSearch`) have **no explicit `staleTime`** — TanStack's default is `0`, meaning refetch on window focus.

**Hypothesis A** (priors): The user perceives lag because:
1. Cold-start: vendor chunks (Leaflet + Recharts + Framer Motion + TanStack) ship together on initial dashboard route.
2. Window-focus refetches: returning to a dashboard tab triggers `useChildren` / `useAllEntities` to re-run despite the metric layer being cached — and the entity list + per-row metric queries form a waterfall (`useChildrenMetrics` is gated on `useChildren` resolving first).
3. The map is heavy and mounts synchronously with the shell.
4. WAN RTT: Tokyo project → Kampala demo client is 200–400 ms per round-trip; any sequential pattern multiplies.

Phase 1 will refute or confirm with traces + EXPLAIN.

## Instrumentation status

- **`pg_stat_statements`** — ✅ already populated; Phase 2 can pull top-N immediately.
- **`rollup-plugin-visualizer`** — ⬜ to be added to a temporary `vite.config.js` patch in Phase 3 (NOT Phase 0 — visualizer is only needed when bundle-mapping happens; less drift if added then reverted in the same phase).
- **Playwright traces** — `npm run test:e2e -- --trace=on` produces trace.zip artifacts per spec into `test-results/`. Phase 1 will use this for the distributor flow.
- **Chrome DevTools Performance / React DevTools Profiler** — manual capture per dashboard; Phase 3 attaches profile JSON.

## What Phase 0 did NOT do

- Did not modify any source file.
- Did not install or enable any extension.
- Did not create the visualizer plugin yet (Phase 3 owns this).
- Did not run any actual EXPLAIN / Playwright capture (Phase 1 onward owns this).

## Next

- **Phase 1** — Distributor metrics load profile. Single agent.
- **Phase 2 / 3** can parallelize after Phase 1 reports out.
