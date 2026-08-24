# A21 · Performance & Bundle

**Captured:** 2026-08-24 · **Repo:** `/Users/shubhang/Desktop/Projects/uganda-dashboard` @ `bd637f6`
**Cites:** `docs/audits/2026-08-23/00-baseline.md` (ground truth; overrides plan §5).
**Method:** direct build + PostgREST/psql measurement with a real distributor JWT + Playwright-on-preview
web-vitals (Lighthouse unavailable — see check 2). Report-only; no `src/`/`api/`/`supabase/` edits.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | build output (84 JS + 84 CSS chunks), 5 target routes, TanStack Query layer, 2 drill data paths, live DB (indexes/advisors/logs) |
| Artifacts examined | all of the above |
| Coverage | 100% of the 8 defined checks attempted; 2 partially blocked (see below) |
| Checks defined | 8 |
| Checks executed | 8 |
| Checks passed / failed / blocked | 3 / 3 / 2 |
| Findings C / H / M / L / I | 0 / 0 / 1 / 3 / 3 |
| Evidence commands run | 21 |
| Excluded as demo-scope | 0 (but 9 `unused_index` advisor lints excluded as UNRELIABLE — pg_stat reset by the restore) |
| Blocked, with reason | (check 2) per-route Lighthouse LCP/TBT for the 4 authenticated data screens — no Lighthouse binary, and the preview build points `VITE_API_BASE_URL` at the prod Render API so headless auth was not driven; substituted network-layer measurement. (check 6) postgres statement durations not logged (`log_min_duration_statement` unset) and edge-log nested-field extraction returned ClickHouse backend errors; substituted `EXPLAIN ANALYZE` + PostgREST RPC timings. |

### Domain metrics
| Metric | Value |
|---|---|
| Landing critical-path JS (gzip) | **~230 KB** (6 chunks: index 66 + vendor-react 62 + vendor 31 + vendor-motion 45 + vendor-tanstack 17 + vendor-router 14) |
| Landing critical-path JS (raw parsed, measured) | **805,998 bytes** (matches chunk sum) |
| Landing critical-path CSS (gzip) | 20 KB (`index-*.css` 120 KB raw) |
| Heaviest lazy vendor chunks (raw / gzip) | vendor-xlsx 500 / 163 · vendor-charts 330 / 90 · vendor-leaflet 154 / 45 — all correctly OFF the landing path |
| Landing LCP / FCP / CLS (desktop, measured) | **312 ms / 40 ms / 0.0001** |
| Landing LCP / FCP / CLS (Slow-4G + 4× CPU, measured) | **80 ms / 80 ms / 0** |
| Distributor subscriber-list screen | **~10 PostgREST requests, ~3.4 MB raw / ~630 KB gzip, ~6,765 rows into memory** (measured) |
| Hot-path RPC latency (PostgREST, dist JWT, warm) | rollup(region) 0.39 s · rollup(branch×290) 0.55 s · top_entities 0.19 s · breadcrumb 0.14 s · distributor_rollup 0.14 s |
| Base RTT this host → Singapore | ~0.13–0.14 s (a Ugandan 4G client is 3–5× this — multiply every figure) |

---

## Check 1 — Build, chunk sizes, largest deps, lazy boundaries  → **FINDING (A21-002/003/004)**

`npm run build` reproduces the baseline (§3) exactly: xlsx 500 KB, charts 330 KB, index 282 KB,
vendor-react 198 KB, AdminDashboardShell 196 KB (raw). Build clean, 4.4 s.

**Lazy boundaries are thorough and correct.** All 6 role shells are `React.lazy` (`App.jsx:21-28`); every
dashboard sub-page and every report view is lazy; `xlsx` is a dynamic `import('xlsx')`
(`src/utils/xlsx.js`) and lands in its own 500 KB chunk that the landing never touches; Leaflet and
Recharts are manual-chunked and pulled only by dashboards. **The landing modulepreload set proves the
heavy libs are off the critical path** — `dist/index.html` preloads only vendor-react / -tanstack /
-vendor / -router / -motion + the entry:

```
$ grep -oE 'modulepreload[^>]*href="[^"]+"' dist/index.html
vendor-react vendor-tanstack vendor vendor-router vendor-motion   (+ index-*.css)
```

Residual weight worth noting (findings A21-002/003/004): oversized aggregated CSS chunks, demo seed
data shipped to the browser, and redundant indexes. Framer Motion (`vendor-motion`, 45 KB gzip) and
TanStack Query (`vendor-tanstack`, 17 KB gzip) are on the **public-marketing** critical path; motion is
used by the landing animations (justified), TanStack is only needed by dashboards (17 KB — minor).

## Check 2 — Lighthouse / route vitals  → **PARTIAL (landing PASS; data-route Lighthouse BLOCKED)**

No Lighthouse binary is installed (`which lighthouse` → not found; not in `node_modules/.bin`). Used a
Playwright(chromium)-on-`vite preview` proxy with `PerformanceObserver` (`layout-shift`,
`largest-contentful-paint`) + navigation timing, desktop and Slow-4G+4×CPU throttled via CDP.

**Landing (public marketing), measured:**
- Desktop: **LCP 312 ms, FCP 40 ms, CLS 0.0001** — healthy.
- Slow-4G + 4× CPU: **LCP 80 ms, FCP 80 ms, CLS 0** (localhost origin + preconnected fonts flatter the
  throttle; treat as "no layout instability" rather than a field LCP).

> First preview run blanked (`rootChildren:0`) because the production build **hard-throws
> `VITE_API_BASE_URL is not set`** at module init (`config/env.js`) before React mounts. That var lives
> in Vercel env, not `.env.local` (CLAUDE.md §7), so this is a **local-env artifact, not a defect** —
> rebuilt with the var set inline and the app booted. Flagged here only so a later agent running preview
> locally isn't surprised by the white screen.

The 4 **authenticated data routes** (subscriber home, distributor desktop dash, distributor map mode,
admin home) could not be Lighthouse-scored: no Lighthouse, and the preview build's `VITE_API_BASE_URL`
points at the **prod** Render API (driving a headless login would hit live prod). Substituted
**network-layer measurement** of the exact PostgREST reads those screens fire (checks 3–5). TBT/TTI for
data screens is dominated by the data fetch, not JS parse — see A21-001.

## Check 3 — Render hot paths (5,000-row list + map drill)  → **PASS**

`ViewSubscribers.jsx` is well-optimised on the **render** axis:
- Virtualised: `useVirtualizer({ count: filtered.length, estimateSize: ()=>72, overscan: 10 })`
  (`ViewSubscribers.jsx:322-327`) — only ~20 rows in the DOM regardless of 4,600+ data rows.
- Memoised: `filtered` (`:304`), `totals` (`:289`), `AGENTS_MAP`/`BRANCHES_MAP`
  (`:270-271`) are `useMemo`; `estimateSize` is `useCallback`; search is debounced
  (`useDebouncedValue`, `:3`). No obvious wasted re-render of the row set on keystroke.
- **VirtualRows coverage is broad:** `useVirtualizer` in `ViewSubscribers`, `ViewAgents`,
  `ViewBranches`, and the mobile `SubscribersMobile`/`AgentsMobile`/`BranchesMobile` (+ shared
  `VirtualRows.jsx`). Every large list is virtualised.

The map **drill** metrics are batched, not per-child — see check 5. The render axis is healthy; the
cost is entirely on the **data-transfer** axis (A21-001).

## Check 4 — TanStack Query cache / over-fetch / waterfalls / duplicate in-flight  → **FINDING (A21-001)**

Config is sound (`src/main.jsx:69-82`): global `staleTime 5 min`, `gcTime 10 min`,
`refetchOnWindowFocus:false`, `retry:1`, **`mutations.retry:0`** (prevents double-apply). The #1 hot
rollups (`useChildrenMetrics`, `useEntityMetrics`, `useAllEntitiesMetrics`, `useTopEntities`) override
to **15 min** staleTime; employer/NAV reads use a shared `READ_STALE_TIME`. Shared query keys +
React-Query request-dedup mean concurrent identical reads (e.g. `useAllEntities('agent')` on both the
map and the subscriber list) collapse to one in-flight — **no duplicate in-flight**.

**Waterfall (inherent, acceptable):** `useChildrenMetrics` depends on `useChildren` (it needs the child
ids), so each drill step is a 2-step fetch (list → batched metrics); documented and unavoidable.

**Over-fetch (the finding):** `useAllEntities('subscriber')` with no scope pulls the **entire**
subscriber collection client-side and does all search/filter/sort in JS. Measured for distributor d-001
(national): see A21-001.

## Check 5 — PostgREST N+1 across drill paths  → **PASS (no N+1; bounded fan-out only)**

The drill does **not** N+1. Per drill step (`TopBar` / `OverlayPanel`): `useChildren` (1 list read) +
`useChildrenMetrics` → `getEntityMetricsRollup(childLevel, ids)` — a **single** RPC that batches all
children's metrics (`entities.js:868`, `useEntity.js:324-338`) + `useBreadcrumb` (1 RPC). Measured the
worst case (a distributor's 290 branches in one rollup): **1 request, 0.55 s, 271 KB** — not 290
requests.

```
$ curl -s -X POST .../rpc/get_entity_metrics_rollup -d '{"p_level":"branch","p_entity_ids":[<290 ids>]}'
  get_entity_metrics_rollup: http=200 time=0.549s size=271167b     (single call)
```

The collection list read (`getAllAtLevel`) is a **bounded concurrent fan-out**, not N+1: page 0 serial →
`count=exact` HEAD → pages 1..N via `Promise.all` (`entities.js:475-517`). For d-001's subscribers that
is 6 requests for 4,602 rows, not 4,602 requests. Correct pattern; the issue is that it fetches *all*
pages (A21-001), not that it N+1s.

## Check 6 — Slowest SQL from logs  → **BLOCKED (durations not logged); substituted EXPLAIN/RPC timing**

`postgres_logs` carry no `duration_ms` (`log_min_duration_statement` is unset — only checkpoints and
errors are logged), and `edge_logs` nested-field extraction (`m.request`/`m.response` unnest) returned
`Backend error!` from the ClickHouse endpoint twice. So there is no server-side slow-query ranking to
report. Substituted direct measurement:

- **Paginated list read** `EXPLAIN (ANALYZE, BUFFERS)` of the subscribers+balances join at OFFSET 4000:
  `Execution Time: 297.7 ms`, all index scans (`subscribers_pkey`, `subscriber_balances_pkey`), 576
  shared buffers hit. `Planning Time 9.4 ms`.
- **Hot RPCs (PostgREST, warm):** rollup(region) 0.39 s · rollup(branch×290) 0.55 s · top_entities
  0.19 s · breadcrumb 0.14 s · distributor_rollup 0.14 s. DB compute is small; **network RTT dominates**
  — `distributor_rollup`/`breadcrumb` are ~equal to bare RTT (0.14 s), so on a Ugandan 4G client (RTT
  0.4–0.6 s) each becomes 0.5–1 s.

> **Planner note (baseline §5 trap):** `pg_class.reltuples` IS populated correctly (subscribers 5064,
> agents 2043, …), so the planner has row-count estimates and picks index scans — it is **not** blind.
> But `last_analyze`/`last_autoanalyze` are both NULL, so **column-level histograms are absent**;
> selectivity of `WHERE` filters is guessed. Fine for the full-scan list reads measured here; a
> `VACUUM ANALYZE` before any demo is still advisable.

## Check 7 — Render cold start + first paint of a data screen  → **FINDING (A21-006, cross-ref A09)**

`render.yaml`: `plan: free`, `region: singapore`. Free tier spins down after ~15 min idle;
`WarmupBanner.jsx:16` confirms "**Render free-tier instances cold-start in 30–60 s**". Mitigation is in
place: `main.jsx` mounts `<WarmupBanner/>`, which fires `warmupBackend()` on app boot (from the landing)
and shows a "waking" banner, so the backend often warms while the rep reads the landing and logs in.
**Compounded** by the Supabase auto-pause the baseline documented (H-class, ~2 min cold restore).
Landing itself paints fast (LCP 312 ms) — the cold-start cost lands entirely on the **first data
screen**. Owned by A09; reported here for the first-paint-of-data framing only, not double-counted.

## Check 8 — Async Google Fonts CLS  → **PASS (measured CLS ≈ 0; A21-007 info note)**

`index.html` loads fonts non-render-blocking (`media="print" onload="this.media='all'"`) with
`display=swap` and `preconnect` to both `fonts.googleapis.com` and `fonts.gstatic.com`. This is the
**correct** async pattern. Measured CLS on the landing is **0.0001 (desktop) / 0 (throttled)** — the
font swap produces no measurable layout shift (block heights are pinned by explicit line-heights, and
the generic `sans-serif` fallback is metrically close enough). The only gap (A21-007, info): there is
**no metric-matched `@font-face` fallback** (`size-adjust`/`ascent-override`) anywhere in `src/**.css` —
purely generic `--font-display:'Plus Jakarta Sans',sans-serif` / `--font-body:'Inter',sans-serif`. On a
pathologically slow gstatic fetch a shift *could* appear; measured, it does not. Defense-in-depth only.

---

## Findings

### A21-001 · Distributor/admin subscriber list downloads the entire collection client-side — MEDIUM (confirmed)
**Location:** `src/dashboard/subscriber/ViewSubscribers.jsx:251-263`, `src/services/entities.js:447-517`
`ViewSubscribers` fires three unscoped full-collection reads on one screen — `useAllEntities('subscriber')`,
`useAllEntities('agent')`, `useAllEntities('branch')` — each of which pages the whole level and holds
every mapped row in browser memory; search/filter/sort run in JS over the full array. Measured for
distributor d-001 (national scope) with a real distributor JWT against live PostgREST:

```
subscribers  content-range 0-999/4602  → 6 requests (page0 + count HEAD + pages 1-4)
             page0: 206, 580,383 B raw / 101,615 B gzip, 0.53 s   → full set ~2.67 MB raw / ~467 KB gzip
agents       content-range 0-999/1872  → 3 requests, ~147 KB gzip
branches     content-range 0-290/291   → 1 request, 13.4 KB gzip
TOTAL        ~10 PostgREST requests, ~3.4 MB raw / ~630 KB gzip, ~6,765 rows into memory
```
The correct server-side path (`getEntityPage` / `useInfiniteEntityList`) **exists but is dead code** —
its own docstring says "CURRENTLY UNUSED … its only caller `useInfiniteEntityList` has no consumers"
(`entities.js:546-574`). The DOM is virtualised so it renders fine; the cost is the transfer + memory.
On a rep's Ugandan 4G link to Singapore (RTT 0.4–0.6 s, ~2–5 Mbps) this is a multi-second stall on a
headline distributor/admin screen. **demo_visible: yes.**
**Fix:** wire the list to the already-built `getEntityPage` server-side paginate+filter+sort path (or
scope the list to the drilled entity), instead of pulling all 4,600 rows for a virtualised viewport.

### A21-002 · Oversized aggregated CSS chunks — LOW (confirmed)
**Location:** `dist/assets/index-*.css`, `DashboardShell-*.css`, `ConsentStep-*.css`, `EmployerDashboardShell-*.css`
Measured raw / gzip: landing `index` CSS **120 KB / 20 KB** (critical path); distributor
`DashboardShell` CSS **149 KB / 20 KB**; `ConsentStep` **93 KB**; `EmployerDashboardShell` **82 KB**.
Gzip keeps these ~20 KB so impact is bounded, but they are large for CSS-Modules and the 120 KB landing
sheet is render-blocking. **Fix:** audit for dead/duplicated selectors; the aggregate suggests shared
tokens/utilities are being re-emitted per shell.

### A21-003 · Employer demo seed data ships to the browser on the live-backend path — LOW (confirmed)
**Location:** `src/services/subscriber.js:38`, `src/services/employer.js:37` → `src/data/employerSeed.js`
`employerSeed.js` (322 lines) is statically imported by two service modules, so Rollup emits it as a
**78 KB raw / 22 KB gzip** chunk (`employerSeed-*.js`) that loads on the subscriber and employer
dashboards. It is only the **mock fallback** used when `VITE_USE_SUPABASE=false`; in the Supabase-backed
demo (the default) it is dead weight that still downloads because a static import can't be tree-shaken
out of a reachable branch. (Imports are service-only, so CLAUDE.md §4.1 is *not* violated — the
`MemberDetailBody`/`useEmployer` grep hits were comments asserting the rule.) **Fix:** load the seed via
dynamic `import()` inside the `!IS_SUPABASE_ENABLED` branch.

### A21-004 · Redundant/duplicate indexes + minor advisor lints — LOW (confirmed)
**Location:** `subscribers`, `demo_personas`, `money_nonces`, `*_pre_nav` tables
`pg_indexes` shows `subscribers` carries **both** `idx_subscribers_agent_id` (single-col) and
`subscribers_agent_id_id_idx` (`agent_id, id` composite) — the composite already serves `agent_id`
lookups, so the single-col index is redundant write/storage overhead. Supabase performance advisor
corroborates and adds: `demo_personas` `duplicate_index` (two identical unique indexes),
`money_nonces.subscriber_id` FK **unindexed**, and `no_primary_key` on the `subscribers_unit_value_pre_nav`
/ `subscriber_balances_pre_nav` NAV-migration **backup tables** (which arguably shouldn't be live). All
negligible at demo scale. **Excluded:** the advisor's 9 `unused_index` lints — unreliable because the
restore reset `pg_stat_user_indexes.idx_scan` (baseline §6 trap); "unused" here just means "unused since
restore."

### A21-005 · Six stacked permissive RLS policies add per-row overhead on the big list reads — INFO (confirmed, cross-ref A02)
**Location:** `public.subscribers` (and 17 other tables), SELECT policies
Performance advisor: **90 `multiple_permissive_policies`** warnings; `subscribers` SELECT has 6 permissive
policies (`_select_admin/_agent/_branch/_distributor/_employer/_self`) that Postgres OR-evaluates **per
row**, each reading `auth.jwt()` claims. This is the per-row cost behind the ~300 ms server execution of
the 4,600-row list read. It is a deliberate 6-roles-share-one-table design, not a bug; consolidating into
one policy gated on `app_role` would cut per-row RLS work. RLS design is A02's domain — noted here for the
perf linkage only.

### A21-006 · Cold-start compounds first-paint of the first data screen — INFO (confirmed, cross-ref A09)
**Location:** `render.yaml` (`plan: free`), `src/components/WarmupBanner.jsx`
Render free tier cold-starts 30–60 s; Supabase auto-pauses (~2 min restore, baseline H-class). The
landing paints fast (LCP 312 ms) but the **first data screen** waits on both. `WarmupBanner` mitigates
the Render half by pinging on app boot. Owned by A09; reported for the first-paint-of-data framing.

### A21-007 · No metric-matched font fallback (measured CLS negligible) — INFO (confirmed)
**Location:** `src/index.css:31-32`, `index.html` font link
Async Google Fonts are correctly non-render-blocking (print-media swap + preconnect); measured landing
CLS 0.0001/0. No `size-adjust`/`ascent-override` `@font-face` fallback exists, so a shift is *possible*
on a pathologically slow gstatic fetch but did not materialise. Defense-in-depth only; effectively a
PASS.

---

## Traceability
| # | Check | Disposition |
|---|---|---|
| 1 | build → chunks / largest deps / lazy boundaries | **FINDING A21-002, A21-003, A21-004** (lazy boundaries themselves PASS — all shells/pages/xlsx lazy, heavies off landing) |
| 2 | Lighthouse (mobile+desktop) on landing/subscriber/distributor dash/map/admin | **PARTIAL** — landing PASS (measured LCP 312/FCP 40/CLS 0.0001; throttled CLS 0); 4 authenticated data-route Lighthouse **BLOCKED** (no Lighthouse binary; preview→prod API; substituted network-layer measurement) |
| 3 | render hot paths: 5,000-row list + map drill, re-renders / memoisation / VirtualRows | **PASS** (virtualised overscan 10, filtered/totals/maps memoised, debounced search; VirtualRows across all large lists) |
| 4 | TanStack Query staleTime/gcTime / over-fetch / waterfalls / duplicate in-flight | **FINDING A21-001** (config sound & dedup works, but full-collection over-fetch) |
| 5 | PostgREST N+1 across drill paths | **PASS** (metrics batched in one rollup RPC; list is bounded concurrent fan-out, not N+1) |
| 6 | slowest 10 SQL from Supabase logs | **BLOCKED** (durations not logged; edge-log ClickHouse backend errors) — substituted EXPLAIN ANALYZE + RPC timings |
| 7 | Render cold start + first-paint of data screen | **FINDING A21-006** (cross-ref A09) |
| 8 | async Google Fonts CLS contribution | **PASS** (measured CLS ≈ 0; A21-007 info note on missing metric fallback) |

## Cleanup / hygiene statement
- **No fixture rows created.** The distributor login used the seeded phone `+256700000021` (d-001);
  `verify-otp`'s upsert is idempotent on `(phone, role)` — confirmed still exactly 1 `users` row.
- **No tracked files modified by A21.** `git status` shows only `M package.json`,
  `M package-lock.json`, `?? e2e/specs/a11y/` — all from the A00 baseline's sanctioned
  `@axe-core/playwright` install, not this agent. `dist/` is gitignored; the two `npm run build`
  invocations and `vite preview` touched nothing tracked. Preview server killed.
- **JWT / secrets:** the distributor token was captured to a scratchpad file and never printed (G2).
- All temp scripts/artifacts live under the session scratchpad, not the repo.
