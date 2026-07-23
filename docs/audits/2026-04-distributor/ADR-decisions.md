> **Agent guide.** Historical report from 2026-05-22 capturing the architecture-decision sign-off gate for the distributor-audit remediation sprint — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# ADR Decisions — sprint gate

**Date prepared:** 2026-05-22 · **Phase:** Phase 0 (A0.1)
**Status:** Awaiting decisions from engineering lead. Each ADR has a recommended option from `REPORT.md §4`; this doc lets you accept or override before the sprint touches code.

For full ADR context (Context / Options / Tradeoffs), see `docs/audit/REPORT.md §4`. This file is the decision capture.

---

## How to use

For each ADR below, fill in the **Decision** cell with one of: `Accept (A)`, `Override → B`, `Override → C`, or `Defer`. If overridden, name the impact on the sprint plan.

Once all five are decided, sprint can proceed to Phase 1.

---

## ADR-001 — Rollup metrics strategy

| Field | Value |
|---|---|
| Surfaced by | AUDIT-1-1, AUDIT-1-2, AUDIT-1-3 |
| Recommended | **A — Index + RPC rewrite** (one migration; `(type, date)` partial index + `get_top_branch` SECURITY DEFINER + `monthly_arr_per_entity` CTE rewrite) |
| Alternative B | Materialized view (`mv_entity_metrics REFRESH ON COMMIT/SCHEDULE`) — sub-100 ms reads but adds operational complexity (refresh failures, write amplification on `transactions`) |
| Alternative C | Denormalized rollup table updated by triggers — best read latency, highest write cost, fragile |
| Sprint impact if A | Phase 1 as planned (~2 days) |
| Sprint impact if B | Phase 1 reshapes to add MV + refresh trigger + scheduled job; +2 days; revisit ADR-002 since refresh + realtime interact |
| Sprint impact if C | Phase 1 grows to ~4 days; PR-1 splits into 3 PRs; commission state-machine triggers must be updated too |
| Decision deadline | Before Phase 1 starts |
| **Decision** | _Awaiting sign-off_ |
| **Decided by** | Engineering lead |
| **Decided at** | _yyyy-mm-dd_ |

**Notes for decider:** Seed has 30 K subscribers — option A's expected mean is 50-200 ms after index. Option B is overkill at this scale; revisit at 1M+ subscribers. Option C is brittle without strong write-path test coverage.

---

## ADR-002 — Realtime channel scope

| Field | Value |
|---|---|
| Surfaced by | AUDIT-2-4 |
| Recommended | **A — Drop the publication** (commissions / settlement_runs / settlement_run_branch_reviews). Phase 1 + 2 audits confirmed zero `.channel()` subscribers across `src/`, `api/` |
| Alternative B | Keep publication + wire a consumer (commission state machine has the strongest realtime case) |
| Alternative C | Keep publication, drop only the busiest tables (subscribers + transactions are already OFF) |
| Sprint impact if A | Phase 6 PR-8 as planned (migration `0025_drop_realtime_publication.sql`); ~1 hour |
| Sprint impact if B | New feature ticket; NOT in this sprint; ADR-002 stays "Status quo" |
| Sprint impact if C | Same as A but only drops `settlement_run_branch_reviews` |
| Decision deadline | Before Phase 6 starts |
| **Decision** | _Awaiting sign-off_ |
| **Decided by** | Product + Engineering |
| **Decided at** | _yyyy-mm-dd_ |

**Notes for decider:** Demo platform. If admin role ever ships with a "live settlement run" dashboard, A reverts trivially (one migration).

---

## ADR-003 — TanStack Query caching policy

| Field | Value |
|---|---|
| Surfaced by | AUDIT-1-4 + AUDIT-3 TanStack table |
| Recommended | **C — Global `staleTime: 5*60*1000` on the QueryClient + per-key overrides** for mutation-invalidated queries |
| Alternative A | Per-key explicit `staleTime` everywhere — maximum clarity, maintenance overhead |
| Alternative B | Tiered defaults via custom `useReadQuery({ tier: 'fresh'|'standard'|'static' })` hook |
| Sprint impact if A | Phase 2 (A2.3) edits each `useQuery` call site; +0.5 day for the audit pass |
| Sprint impact if B | Phase 2 (A2.3) writes the wrapper + migrates; +1 day; defers payoff because the wrapper itself has to land first |
| Sprint impact if C | Phase 2 (A2.3) as planned (~half a day) |
| Decision deadline | Before Phase 2 starts |
| **Decision** | _Awaiting sign-off_ |
| **Decided by** | Engineering lead |
| **Decided at** | _yyyy-mm-dd_ |

**Notes for decider:** Mutation-driven freshness (settlement runs after settle action) is preserved via `invalidateQueries` regardless of which option. Stale-time of 5 min only affects window-focus refetch, not user-action triggers.

---

## ADR-004 — Frontend Supabase client surface

| Field | Value |
|---|---|
| Surfaced by | AUDIT-3-4 |
| Recommended | **A — Replace `createClient` with direct `postgrest-js`** + thin wrapper preserving `.from()`/`.rpc()` ergonomics. ~30 KB gzip vs 230 KB |
| Alternative B | Stay on supabase-js + audit rollup config to tree-shake unused subcomponents — less invasive but historically supabase-js subcomponents aren't tree-shakable |
| Alternative C | Use supabase-js for `api/` server-side only, write FE against fetch + tiny PostgREST helper |
| Sprint impact if A | Phase 5 (PR-7) as planned (~2 days); ~200 KB gzip saving per dashboard route |
| Sprint impact if B | Phase 5 becomes a rollup-config audit; ~30 KB gzip saving if any; same day duration |
| Sprint impact if C | Phase 5 splits FE/server; ~0.5 day longer; FE saves 200 KB, server keeps the convenience client |
| Decision deadline | Before Phase 5 starts (can be deferred until then) |
| **Decision** | _Awaiting sign-off_ |
| **Decided by** | Engineering lead |
| **Decided at** | _yyyy-mm-dd_ |

**Notes for decider:** The app uses only `.from()` and `.rpc()`. Phase 5 (A5.1) pre-check verifies this; if any other surface is used (auth, storage, realtime, functions), Phase 5 STOPs and re-scopes — option B becomes the de-facto fallback.

---

## ADR-005 — Post-sprint observability (new — gap G7/G8)

| Field | Value |
|---|---|
| Surfaced by | Gap in REPORT.md; remediation-plan §"Gaps" G7 + G8 |
| Recommended | **A — `pg_stat_statements`-based regression spec in CI + monthly `get_advisors` sweep procedure** |
| Alternative B | Stand up dedicated APM (e.g., Sentry Performance, Grafana Cloud) — heavier, slower payoff |
| Alternative C | No long-term observability beyond what exists today — accept regression risk |
| Sprint impact if A | Phase 7 (A7.5) writes `e2e/specs/regression/pg-perf-budget.spec.ts` + documents monthly sweep + adds CI gate. ~0.5 day |
| Sprint impact if B | Out of sprint scope (vendor selection, contract, integration) |
| Sprint impact if C | Phase 7 (A7.5) becomes docs-only; saves 0.5 day; accepts risk |
| Decision deadline | Before Phase 7 starts (can defer) |
| **Decision** | _Awaiting sign-off_ |
| **Decided by** | Engineering lead |
| **Decided at** | _yyyy-mm-dd_ |

**Notes for decider:** Option A is cheap and immediate. APM (option B) is the right answer if the team is willing to invest in observability beyond this sprint.

---

## ADR-006 — MOCK_NOW refresh policy (related to G9)

| Field | Value |
|---|---|
| Surfaced by | CLAUDE.md §10b + Phase 5 audit (frequency drift confirmed: anchor is 2026-04-08, today is 2026-05-22) |
| Recommended | **A — Roll forward to current date manually as part of each demo session** (`new Date(2026, 4, 22)` for now). Avoid `new Date()` because it makes "due in N days" demos drift mid-session |
| Alternative B | `new Date()` — always current; simpler |
| Alternative C | Compute from `process.env.MOCK_NOW || new Date()` so demo reps can override |
| Sprint impact | Phase 6 (A6.3) lands the value chosen here |
| **Decision** | _Awaiting sign-off_ |
| **Decided by** | Engineering lead |
| **Decided at** | _yyyy-mm-dd_ |

---

## Decision matrix summary

| ADR | Recommended | Decision | Sprint days if overridden |
|---|---|---|---|
| ADR-001 | A — Index + rewrite | _pending_ | B = +2; C = +2 |
| ADR-002 | A — Drop publication | _pending_ | B = out of sprint; C = same |
| ADR-003 | C — Global staleTime | _pending_ | A = +0.5; B = +1 |
| ADR-004 | A — postgrest-js swap | _pending_ | B = same; C = +0.5 |
| ADR-005 | A — pg_stat regression spec | _pending_ | B = out of sprint; C = -0.5 |
| ADR-006 | A — Manual roll-forward | _pending_ | B/C trivial |

**Once all decisions land, sprint baseline is locked.** Phases proceed in dependency order per remediation plan §"Dependency graph".

---

## Sign-off

| Role | Name | Signed at |
|---|---|---|
| Engineering lead | | |
| Product (ADR-002 only) | | |

After both signatures land (or for solo decisions, just engineering lead), Phase 0 advances to A0.2 baseline capture.
