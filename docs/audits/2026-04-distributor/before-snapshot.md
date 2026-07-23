> **Agent guide.** Historical report from 2026-05-22 capturing the pre-remediation performance baseline metrics for the distributor audit — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Performance baseline snapshot (BEFORE remediation)

**Date:** 2026-05-22 19:00 local · **Phase:** Phase 0 (A0.2)
**Purpose:** Capture the production-side perf metrics today, so Phase 7's after-state comparison has a numeric ground truth.

## Methodology

1. `pg_stat_statements` captured via `mcp__supabase__execute_sql` (zengmiugieqjqzaccbqe). NOT reset — audit-era history (8 days 5h uptime) preserved as continuous baseline.
2. Playwright trace via `npx playwright test e2e/specs/flows/distributor-renders-data.spec.ts --trace=on --workers=1 --reporter=list --timeout=120000 --output=docs/audits/2026-04-distributor/baseline-traces`.
3. Lighthouse mobile + desktop against `https://uganda-dashboard.vercel.app` (the prod URL — landing page; dashboard requires phone-based login).
4. Bundle visualizer: re-used Phase 3 audit artifact `docs/audits/2026-04-distributor/_bundle-stats.html` (902 KB; vite config UNTOUCHED in Phase 0).

---

## 1. `pg_stat_statements` top-25 by total time

Server uptime: 8 days 6 hours. 1,632 distinct statements tracked. Top by `total_exec_time`:

| Rank | Calls | Mean (ms) | Max (ms) | Total (s) | Min (ms) | Statement (truncated) |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 196 | **5272.54** | **7964.54** | 1033.42 | 19.78 | `get_top_branch(p_level, p_parent_id)` |
| 2 | 253 | 1573.51 | 7321.02 | 398.10 | 4.18 | `get_entity_metrics_rollup(country)` |
| 3 | 100 | 3571.76 | **7993.31** | 357.18 | 28.19 | `get_entity_metrics_rollup(region 4-id)` |
| 4 | 528 | 210.21 | 4131.92 | 110.99 | 0.66 | `get_entity_commission_summary(p_level, p_entity_id)` |
| 5 | 489 | 217.31 | 3585.07 | 106.27 | 0.69 | `get_run_branch_breakdown(p_branch_id)` |
| 6 | 491 | 201.60 | 3828.70 | 98.99 | 11.51 | `commissions WHERE status = ? LIMIT/OFFSET` |
| 7 | 208 | **459.17** | 4896.63 | 95.51 | 14.94 | `subscribers LIMIT/OFFSET` + `count: 'exact'` |
| 8 | 657 | 100.96 | 1059.42 | 66.33 | 12.08 | `subscribers LIMIT/OFFSET` (no count header) |
| 9 | 490 | 68.71 | 1383.02 | 33.67 | 5.67 | `commissions LIMIT/OFFSET` (smaller column subset) |
| 10 | 893 | 36.95 | 3219.36 | 33.00 | 0.22 | subscribers + balances + schedules JOIN (subscriber dash) |
| 11 | 346 | 88.22 | 2239.20 | 30.52 | 4.74 | `get_run_branch_breakdown(p_run_id)` variant |
| 12 | 524 | 44.16 | 108.14 | 23.14 | 2.31 | seed-script bulk INSERT (not user-facing) |
| 13 | 368 | 58.44 | 1357.52 | 21.50 | 8.76 | agents LIMIT/OFFSET |
| 14 | 169 | 100.72 | 1400.44 | 17.02 | 1.45 | agents LIMIT/OFFSET variant |
| 15 | 912 | 17.79 | 902.27 | 16.22 | 2.13 | agents column subset LIMIT/OFFSET (drill-down) |
| 16 | 422 | 35.45 | 1010.71 | 14.96 | 2.42 | commissions WHERE branch_id LIMIT/OFFSET |
| 17 | 1 | 10800.91 | 10800.91 | 10.80 | 10800.91 | Phase 1 audit EXPLAIN ANALYZE (one-off) |
| 18 | 1 | 9936.16 | 9936.16 | 9.94 | 9936.16 | Phase 1 audit inlined CTE (one-off) |
| 19 | 1 | 9803.33 | 9803.33 | 9.80 | 9803.33 | Phase 1 audit EXPLAIN ANALYZE (one-off) |
| 20 | 32 | 292.87 | 1063.91 | 9.37 | 48.15 | `get_entity_metrics_rollup` distinct param shape |
| 21 | 2 | 4362.04 | 8686.54 | 8.72 | 37.55 | `CREATE INDEX IF NOT EXISTS idx_transactions_date` (historical migration) |
| 22 | 499 | 17.45 | 1052.22 | 8.71 | 2.16 | branches LIMIT/OFFSET |
| 23 | 1 | **8597.32** | 8597.32 | 8.60 | 8597.32 | `count(*) FROM transactions` (Phase 2 audit probe) |
| 24 | 32 | 266.85 | 1076.06 | 8.54 | 0.54 | `get_entity_commission_summary` branch_id variant |
| 25 | 1 | 7688.81 | 7688.81 | 7.69 | 7688.81 | Phase 1 audit EXPLAIN ANALYZE region (one-off) |

### Targets after remediation

| Query | Mean today | Target after PR-1 / PR-6 | Method |
|---|---|---|---|
| `get_top_branch` | 5272 ms | **< 500 ms** | PR-1: SECURITY DEFINER + `(type, date)` index |
| `get_entity_metrics_rollup` country | 1573 ms | **< 300 ms** | PR-1: index + CTE rewrite |
| `get_entity_metrics_rollup` region | 3571 ms | **< 1000 ms** | PR-1: monthly_arr_per_entity rewrite |
| `subscribers LIMIT/OFFSET` + count: exact | 459 ms | **< 200 ms** | PR-1/PR-6: RLS flatten + (?) cursor pagination |
| `commissions WHERE status` LIMIT/OFFSET | 201 ms | **< 100 ms** | PR-1: `commissions(status)` partial index |

---

## 2. Playwright trace baseline

Run: `npx playwright test e2e/specs/flows/distributor-renders-data.spec.ts --trace=on --workers=1 --timeout=120000`. Output: `docs/audits/2026-04-distributor/baseline-traces/`.

### Results

- **6 tests** (3 × chromium + 3 × webkit) — **2 passed, 4 failed**.
- Total run time: 50.6 s.

| Test | Browser | Result | Notes |
|---|---|---|---|
| Chrome renders within 5s + tiles > 0 | chromium | **PASS** | within 5 s upper bound; 3 s SLA still missed |
| OverlayPanel subscriber tile > 29,000 | chromium | **FAIL** | "Showing X of Y" never visible within 20 s (the well-known AUDIT-1-7 symptom) |
| Drill via URL | chromium | **PASS** | Routes render |
| (Same three) | webkit | **FAIL × 3** | `webkit-2287` browser binary not installed locally — not a regression, just a missing install. Run `npx playwright install` if webkit coverage is wanted in Phase 7. |

### Trace artifacts

- `docs/audits/2026-04-distributor/baseline-traces/flows-distributor-renders--31d17-in-5s-with-non-zero-metrics-chromium/trace.zip` — Chrome paint test (PASS)
- `docs/audits/2026-04-distributor/baseline-traces/flows-distributor-renders--9596f-eports-a-count-above-29-000-chromium/trace.zip` — ViewSubscribers failure (FAIL — the user-visible symptom)
- `docs/audits/2026-04-distributor/baseline-traces/flows-distributor-renders--310be--agent-→-subscriber-via-URL-chromium/trace.zip` — Drill (PASS)
- `docs/audits/2026-04-distributor/baseline-traces/playwright-stdout.log` — full reporter output

### Acceptance targets for Phase 7 comparison

| Metric | Today | Phase 7 target |
|---|---|---|
| Chrome paint | < 5 s upper bound (test passes) | **< 2 s** (tightened SLA in PR-3) |
| Subscriber tile > 29,000 (chromium) | FAIL | **PASS** within 5 s (PR-4 closes) |
| First-paint Supabase requests | **24** (per Phase 1 audit network analysis) | **≤ 6** |
| Total Supabase calls in cold "open ViewSubscribers" flow | **63** (Phase 1 audit) | **≤ 15** |

---

## 3. Lighthouse — `https://uganda-dashboard.vercel.app` landing page

(Dashboard pages require phone-based login; Lighthouse runs against the public landing page.)

### Mobile (simulated 4G, throttling = simulate, Moto G Power emulation)

| Metric | Value |
|---|---|
| **Performance score** | **76** |
| First Contentful Paint | 3.34 s |
| Largest Contentful Paint | 4.45 s |
| Total Blocking Time | 20 ms |
| Cumulative Layout Shift | 0 |
| Speed Index | 4.48 s |
| Time to Interactive | 4.45 s |

### Desktop

| Metric | Value |
|---|---|
| **Performance score** | **97** |
| First Contentful Paint | 0.89 s |
| Largest Contentful Paint | 1.06 s |
| Total Blocking Time | 0 ms |
| Cumulative Layout Shift | 0 |
| Speed Index | 0.95 s |
| Time to Interactive | 1.06 s |

### Targets after PR-7

| Profile | Today | Target |
|---|---|---|
| Mobile | 76 | **≥ 86** (+10 points) per ADR-004 Option A expected outcome |
| Desktop | 97 | maintain ≥ 95 |
| Mobile LCP | 4.45 s | < 3.0 s |
| Mobile SI | 4.48 s | < 3.0 s |

### Raw artifacts

- `docs/audits/2026-04-distributor/baseline-traces/lighthouse-mobile.json` (307 KB)
- `docs/audits/2026-04-distributor/baseline-traces/lighthouse-desktop.json` (269 KB)

---

## 4. Bundle baseline (re-used Phase 3 audit artifact)

`docs/audits/2026-04-distributor/_bundle-stats.html` (902 KB visualizer report).

Key numbers from Phase 3 audit (`03-frontend-perf.md`):

| Chunk | gzip | brotli |
|---|---|---|
| `vendor-charts` | 274 KB | 235 KB |
| `vendor-BoVtWV09` (supabase-js bundle) | **230 KB** | 193 KB |
| `vendor-motion` (framer) | 143 KB | 120 KB |
| `vendor-leaflet` | 114 KB | 92 KB |
| `vendor-react` | 110 KB | 90 KB |
| `index` (entry — landing) | 54 KB | 46 KB |
| `DashboardShell` (distributor) | 47 KB | 41 KB |
| `Settings` chunk (panels packed together) | 44 KB | 38 KB |

**Distributor home cold-load JS:** ~849 KB gzip.
**Landing page modulepreload:** Leaflet + supabase + framer + everything = ~745 KB gzip on a page that doesn't use them.

### Targets after PR-7

| Bundle | Today | Target |
|---|---|---|
| `vendor-BoVtWV09` (supabase) | 230 KB gzip | **< 50 KB gzip** (after postgrest-js swap per ADR-004 A) |
| Distributor home cold load | 849 KB gzip | **< 600 KB gzip** |
| Landing page initial JS | ~750 KB gzip (modulepreloaded) | **< 450 KB gzip** (after Leaflet code-split) |

---

## 5. Server state — uptime + statement count

| Field | Value |
|---|---|
| Postgres version | 17.6.1.121 |
| Region | `ap-northeast-1` (Tokyo) |
| Server uptime (at snapshot) | 8 days 6 hours |
| Distinct statements tracked | 1,632 |
| Statements consuming > 10 s total | 21 |
| Most-expensive statement total time | 1,033 s (`get_top_branch`) — 17 % of all tracked time |

---

## 6. Known broken e2e tests (acceptance criterion)

These tests FAIL today; Phase 7 must show them PASSING:

1. `e2e/specs/flows/distributor-renders-data.spec.ts:94` — "OverlayPanel subscriber tile reports a count above 29 000" — fails because the assertion `Showing X of Y subscribers` never renders within 20 s.
2. webkit failures are not regressions; tooling gap. Optional to fix in Phase 7.

These tests PASS today; Phase 7 must show them still passing:
- All smoke specs across 4 roles.
- `agent-onboard-subscriber.spec.ts` — currently `test.fixme()`'d due to AML hang per `qa.md` (see A0.4 resolution).
- `subscriber-edit-profile.spec.ts`, `subscriber-signup-to-contribute.spec.ts`, `distributor-drill-*.spec.ts`, `branch-create-agent.spec.ts`, etc.

---

## 7. What Phase 0 captured but did NOT modify

- `vite.config.js` — untouched (Phase 0 doesn't re-run the visualizer; we re-use Phase 3's existing artifact).
- No DB writes; only reads via `mcp__supabase__execute_sql`.
- No source-file changes.

Verify with `git status`:
- `docs/audits/2026-04-distributor/baseline-traces/` (new, untracked).
- `docs/audits/2026-04-distributor/before-snapshot.md` + `ADR-decisions.md` + `rollback-playbook.md` + `branch-rehearsal-procedure.md` (new, untracked).
- `test-results/` — generated by Playwright auto-cleanup at run end (should be gitignored already; verified in Phase 5 audit).

---

## 8. Acceptance — Phase 0 A0.2 exit

- [x] pg_stat_statements top-25 captured
- [x] Playwright trace captured for distributor home + drill + ViewSubscribers regression
- [x] Lighthouse mobile + desktop scores recorded
- [x] Bundle baseline confirmed (re-used Phase 3 artifact)
- [x] Acceptance targets for Phase 7 documented per metric
- [x] No source-file modifications

---

## Next

→ A0.4 — AML runtime resolver (un-fixme spec, run, revert; verdict on AUDIT-4-7).
→ Phase 0 close-out: confirm ADR decisions landed in `ADR-decisions.md`, then Phase 1 starts.
