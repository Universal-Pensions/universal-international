> **Agent guide.** Historical audit from 2026-05-31, covering dependencies, supply-chain risk and observability (Sentry, `npm audit`, `xlsx` CVEs) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 08 — Dependencies, Supply-Chain & Observability (Agent H, Phase 1)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (working tree, not committed `main`)
**Agent:** Agent H — Dependencies, Supply-Chain & Observability. READ-ONLY.
**Scope:** `package.json`, `package-lock.json`, `.npmrc`; Sentry usage (`src/main.jsx`, `src/components/ErrorBoundary.jsx`, `server/index.ts`, `server/adapter.ts`); Phase 0 `npm audit` output.

This file consumes the Phase-0 baseline (`00-baseline.md` §2) and owns the exploitability assessment + remediation for the dependency / supply-chain / observability surface. Findings are grouped by severity (Critical → Low). Every finding carries: title, classification, severity, evidence (`file:line`), impact, recommendation.

**Demo-scope reminder honored:** none of the intentional-demo-scope items (mocked OTP/KYC, hardcoded UGX, fixed JWT, in-memory tickets/chat, 30s polling, per-session stores, no payment processor) are reported here. The Sentry config is gated/optional by design; xlsx is a genuine security finding and is **not** demo-scope (per plan).

---

## Summary

| # | Severity | Classification | Title |
|---|---|---|---|
| H-1 | High | real-bug | `xlsx@0.18.5` (SheetJS): prototype-pollution + ReDoS CVEs, no npm fix, runs on distributor-uploaded files |
| H-2 | Medium | quality/tech-debt | `vercel` CLI dev-dependency drags in ~25 of 37 audit vulns and is referenced by nothing |
| H-3 | Medium | quality/tech-debt | Fixable-without-major bumps left unpinned: `vite`, `tar`, `d3-color`/`d3-interpolate`, `postcss`, `brace-expansion` |
| H-4 | Medium | quality/tech-debt | No Sentry `beforeSend`/scope scrubber + no `release` tag — PII-leak surface (phone in `users.id`/JWT sub) and unattributable events |
| H-5 | Medium | quality/tech-debt | No source-map upload pipeline for frontend Sentry — captured stack traces are minified/useless |
| H-6 | Low/Awareness | quality/tech-debt | `legacy-peer-deps=true` masks peer-dependency conflicts repo-wide |
| H-7 | Low/Awareness | already-known | `vendor-xlsx` chunk = 429 kB (143 kB gz); xlsx is the bundle-size driver |
| H-8 | Low/Awareness | quality/tech-debt | Sentry version drift (`^8.50.0` declared, `8.55.2` resolved) + Sentry v8 is one major behind v9/v10 |
| H-9 | Low | quality/tech-debt | `keepalive.yml` pings a self-documented *placeholder/unconfirmed* Render hostname |

**Counts** — by severity: Critical 0 · High 1 · Medium 4 · Low 4. By classification: real-bug 1 · quality/tech-debt 7 · intentional-demo-scope 0 · already-known 1.

---

## HIGH

### H-1 — `xlsx@0.18.5` (SheetJS): prototype-pollution (CVE-2023-30533) + ReDoS (CVE-2024-22363), no npm fix, parses distributor-uploaded files

- **Classification:** real-bug (security) — explicitly NOT demo-scope (per plan + Phase-0 SEED-H1).
- **Severity:** High.
- **Evidence:**
  - `package.json:51` — `"xlsx": "^0.18.5"`; lockfile resolves `node_modules/xlsx` → `0.18.5` from `registry.npmjs.org` (the frozen, vulnerable npm build).
  - `npm audit`: `xlsx | severity=high | range=* | fixAvailable=false`; advisories `GHSA-4r6h-8v6p-xvw6` (CVE-2023-30533, Prototype Pollution, CWE-1321) + `GHSA-5pgg-2g8v-p4x9` (CVE-2024-22363, ReDoS, CWE-1333). Re-confirmed this run: `{severity:"high", range:"*", fixAvailable:false}`.
  - Parse entry point: `src/utils/xlsx.js:115-152` (`parseSheet` → `XLSX.read(buffer, { type: 'array' })` then `XLSX.utils.sheet_to_json`).
  - Reached from the distributor settlement upload: `src/dashboard/commissions/CommissionPanel.jsx:13` (import), `:231` (`const { rows, errors } = await parseSheet(file)`), file input at `:536-539` (`type="file" accept=".xlsx,.xls"`).
- **Impact:** Parsing happens **client-side, in the distributor's own browser tab**, on a file the distributor themselves selected. CVE-2023-30533 (prototype pollution) requires a maliciously crafted workbook reaching `XLSX.read`; CVE-2024-22363 (ReDoS) can hang the tab on a crafted string. Because the attacker and victim are the same trusted distributor session here (the file is locally chosen, never server-parsed — `src/utils/xlsx.js:5-7` confirms "no server route"), the *practical* exploit surface in this demo is **low**: there is no untrusted-upload ingress, no server-side parse, and a prototype-pollution gadget would only corrupt the distributor's own ephemeral page. However, this remains a genuine flagged vulnerability with **no fix path on npm**, the dependency is shipped in the production bundle, and the threat model degrades the moment any non-template / third-party file is opened (e.g. a distributor opens a vendor-supplied "settlement" spreadsheet that was tampered with in transit). It must not be silently accepted.
- **Recommendation (do not classify as demo-scope, do not propose a payment/KYC integration):**
  1. **Switch to the SheetJS-maintained build**, which carries the fixes the npm registry version never received: pin `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz"` in `package.json` (their documented, supported distribution channel for the patched line). This removes the audit finding and keeps the existing API (`XLSX.read`/`utils.sheet_to_json`) unchanged. Verify `npm run build` + `src/utils/__tests__/xlsx.test.js` still pass.
  2. **Or** replace SheetJS with a narrower parser for this single round-trip use case (the app only needs header-keyed row objects from the first sheet + AOA write) — e.g. `exceljs` or a CSV-only path — eliminating the heavyweight, frozen dependency entirely.
  3. **Defense-in-depth at the parse boundary** (overlaps Workstream B): in `src/utils/xlsx.js:124` add a byte-size cap before `file.arrayBuffer()` (e.g. reject > 5 MB to bound ReDoS/DoS), and constrain parsing (the code already reads only the first sheet; add `{ sheetRows: <cap> }` to `XLSX.read` and reject workbooks with implausible row counts). This bounds the ReDoS blast radius even if the dependency itself stays.

---

## MEDIUM

### H-2 — `vercel` CLI dev-dependency drags in ~25 of 37 audit vulns and is referenced by nothing

- **Classification:** quality/tech-debt (supply-chain hygiene). Confirms/refines Phase-0 SEED-H3.
- **Severity:** Medium (it inflates the audit surface but ships nothing to the browser bundle or the Render runtime).
- **Evidence:**
  - `package.json:82` — `"vercel": "^54.0.0"` (devDependency).
  - `npm audit` roots: the `@vercel/*` constellation (`@vercel/backends`, `@vercel/build-utils`, `@vercel/cervel`, `@vercel/express`, `@vercel/fun`, `@vercel/hono`, `@vercel/node`-canary range, `@vercel/python*`, `@vercel/remix-builder`, `@vercel/static-*`, `@vercel/elysia/fastify/h3/hydrogen/koa/nestjs/redwood/rust`) plus their transitives (`path-to-regexp`, `undici`, `minimatch`, `smol-toml`, `ajv`, `srvx`, `tar`, `@tootallnate/once`) — roughly **25 of the 37** flagged packages trace to the `vercel` CLI tree, all `fixAvailable` only via semver-major `vercel`.
  - **Not referenced anywhere:** `grep` for `vercel` across `package.json` scripts, `.github/workflows/*`, and `vercel.json` found no CLI invocation. CLAUDE.md §1 states deploys are done by the **GitHub App integration** (frontend) and **manual Render** deploys — the CLI is not in the deploy path.
  - **Distinct from `@vercel/node`:** `package.json:69` `"@vercel/node": "^5.8.1"` IS used — for the `VercelRequest`/`VercelResponse` types in `server/adapter.ts:19` and all 14 `api/**` handlers. That dep stays. (Note: `@vercel/node` is itself an audit root via `path-to-regexp`; see recommendation.)
- **Impact:** 25 high/moderate audit lines that are pure dev-CLI tooling never shipped to a client or server runtime. They obscure the two findings that *do* matter (`xlsx`, and the directly-fixable bumps in H-3), make `npm audit` noisy at every CI run, and create a standing "do we ship a vulnerable thing?" question that costs reviewer time at every cutover.
- **Recommendation:** Remove `vercel` from `devDependencies` (it is dead weight — deploys go through the GitHub App). Re-run `npm install` + `npm audit`; this should drop the count from 37 to roughly a dozen. Keep `@vercel/node` (it is load-bearing for the handler types); its transitive `path-to-regexp` finding is then the only `@vercel/*` line left and can be tracked separately. Verify `npm run build`, `npm run build:api`, and the E2E suite still pass after removal.

### H-3 — Fixable-without-major bumps left unpinned (`vite`, `tar`, `d3-color`/`d3-interpolate`, `postcss`, `brace-expansion`)

- **Classification:** quality/tech-debt. Confirms Phase-0 SEED-H4.
- **Severity:** Medium (all dev/transitive; `vite` is dev-server-only, `d3-*` ship in the charts bundle).
- **Evidence (from `npm audit`, all `fixAvailable=true`):**
  - `vite | high | <=6.4.1` — path traversal in optimized-deps `.map`, arbitrary file read via dev-server WS (`GHSA-4w7w-66w2-5vf9`, `GHSA-p9ff-h696-f583`). Declared `package.json:83` `"vite": "^6.3.5"`. **Dev-server only** — not a production-runtime risk, but the dev server is reachable on the LAN during demos.
  - `tar | high | <=7.5.10` — arbitrary file create/overwrite; transitive via `@mapbox/node-pre-gyp` → `@vercel/fun` (goes away with H-2).
  - `d3-color | high | <3.1.0` + `d3-interpolate` — ReDoS (`GHSA-36jr-mh4h-2g58`); transitive via `recharts` → ships in `vendor-charts`. **This one is in the production bundle.**
  - `postcss | moderate | <8.5.10` — XSS via unescaped `</style>` in stringify; build-time tooling.
  - `brace-expansion | moderate | <1.1.13` — zero-step sequence DoS; build/glob tooling.
- **Impact:** The `d3-color` ReDoS actually ships to the browser (charts), and `vite`'s dev-server path-traversal is reachable while `npm run dev:all` is up on a shared network during a sales demo. The rest are build/test-time. All are one-bump-away fixes with no semver-major churn.
- **Recommendation:** Run a targeted, minor/patch-only update: bump `vite` to the latest 6.x with the fix, and let `npm audit fix` (without `--force`) apply the transitive `d3-color`/`d3-interpolate`/`postcss`/`brace-expansion`/`tar` fixes (or add `overrides` in `package.json` for the transitives that the resolver won't lift on its own). Re-run `npm run build` + `npm test` to confirm no chart/render regressions. Do this *after* H-2 (removing `vercel` collapses several of these transitive roots first).

### H-4 — No Sentry `beforeSend`/scope scrubber and no `release` tag; phone numbers live in `users.id` and the JWT `sub`

- **Classification:** quality/tech-debt (observability + §7 PII hygiene). Sentry is env-gated/optional, so this is not a live leak today, but it is a latent §7 violation the moment a DSN is set.
- **Severity:** Medium.
- **Evidence:**
  - Frontend init: `src/main.jsx:18-23` — `Sentry.init({ dsn, tracesSampleRate: 0.1 })`. No `beforeSend`, no `integrations`, no `sendDefaultPii`, no `release`/`environment`.
  - Frontend capture: `src/components/ErrorBoundary.jsx:20-22` — `Sentry.captureException(error, { contexts: { react: errorInfo } })` (component stack only — safe).
  - Backend init: `server/index.ts:17-19` — `Sentry.init({ dsn, tracesSampleRate: 0.1 })`. No `beforeSend`. v8 auto-instruments Express via `setupExpressErrorHandler` (`server/index.ts:147-149`); the adapter forwards raw handler errors with `next(err)` (`server/adapter.ts:36`).
  - **PII vectors:** `users.id` is built as `` `${role}:${phone}` `` (`api/auth/verify-otp.ts:80-81`) and that becomes the JWT `sub`; phone is also a thrown-error parameter in the verify path (`verify-otp.ts:62`). Supabase `error` objects forwarded to Sentry can embed the offending row/query context (e.g. `console.error('[verify-otp] db error', err)` at `:231`, then re-thrown errors reach the central handler).
  - **Mitigating fact (verified):** `@sentry/node`/`@sentry/react@8.55.2` default `sendDefaultPii=false`; the v8 `requestDataIntegration` strips `Authorization` headers and cookies and does **not** attach request bodies unless PII is enabled. So the **default config does NOT auto-capture the bearer JWT or the request body** — §7's "never log JWTs" is satisfied by the default, *not* by an explicit guard. `morgan` logs only `:method :url :status` (`server/index.ts:96`) and no token/phone ever appears in a URL query string (verified — all handlers read `req.body`, not `req.query`).
- **Impact:** Today (no DSN, or default v8 behavior) there is no active leak. The risk is fragility: (a) any future maintainer who adds `sendDefaultPii: true`, a Replay integration, or a custom `beforeBreadcrumb` that captures form state would start shipping subscriber phone numbers / JWT subjects to Sentry with no scrubber to catch it; (b) Supabase error messages forwarded to Sentry can carry phone-bearing `users.id` strings in their detail text. There is also no `release`/`environment` tag, so events can't be tied to a deploy or separated prod/preview.
- **Recommendation:** Add a `beforeSend`/`beforeSendTransaction` hook (and `beforeBreadcrumb`) to **both** init calls that (1) redacts `+25671…`-shaped phone substrings and any `role:phone` `id` from `event.exception` messages, breadcrumbs, and `request.data`, and (2) asserts `event.request.headers.authorization` / cookies are stripped (belt-and-braces against a future v9 default change). Add `release` (wire to the build SHA) and `environment` to both inits. Keep `sendDefaultPii` explicitly `false`. This is observability hardening, not a real integration — squarely in scope.

### H-5 — No source-map upload pipeline for frontend Sentry; captured stack traces are minified and unactionable

- **Classification:** quality/tech-debt (observability).
- **Severity:** Medium (degrades the one observability tool the app has).
- **Evidence:**
  - `vite.config.js` has **no `build.sourcemap`** setting (grep found none) — Vite defaults to `sourcemap: false`, so the production build emits no `.map` files.
  - Frontend Sentry captures unhandled errors (`src/main.jsx:18-23`) and ErrorBoundary exceptions (`src/components/ErrorBoundary.jsx:20-22`), but with no maps and no `@sentry/vite-plugin` in the build, every captured frontend stack frame points at minified `vendor-*.js` / `index-*.js` line/column positions.
  - No `release` is set (see H-4), which Sentry also needs to associate uploaded maps with events.
- **Impact:** If a DSN is ever enabled in production, frontend error reports will be effectively useless — a wall of `index-abc123.js:1:48211` frames with no symbolication, defeating the purpose of running Sentry at all. (Backend `@sentry/node` traces are fine — `tsc` output is readable and Node maps line up.)
- **Recommendation:** Either (a) accept frontend Sentry as backend-only-useful and document that the frontend init is best-effort/minified (cheapest, honest for a demo); or (b) if frontend symbolication is wanted, add `@sentry/vite-plugin` with auth-token-gated source-map upload + a `release` tag, and set `build.sourcemap: 'hidden'` in `vite.config.js` so maps are generated and uploaded but not served to the public bundle. Given the demo posture, (a) + a doc note is sufficient; do not over-build.

---

## LOW / AWARENESS

### H-6 — `legacy-peer-deps=true` masks peer-dependency conflicts repo-wide

- **Classification:** quality/tech-debt. (Listed in prior audit `docs/audit/05-static.md` as context for AUDIT-5-4 but not itself a finding — treating as low/awareness, not re-reporting a fixed item.)
- **Severity:** Low/Awareness.
- **Evidence:** `.npmrc:1` — `legacy-peer-deps=true`; CLAUDE.md §3 documents it as intentional (`npm install # legacy-peer-deps=true per .npmrc`). Render build uses `npm ci --include=dev` (`render.yaml:22`), which honors `.npmrc`.
- **Impact:** `legacy-peer-deps` silences npm 7+ peer-dependency conflict errors, so an incompatible peer (e.g. a React-19 vs an older `@types/react`, or a charting lib expecting a different `d3`) installs silently instead of failing loudly. With React 19 + a large dep tree this is a standing source of subtle runtime/type drift. It is almost certainly needed today (React 19 ecosystem peer ranges lag), so this is awareness, not a fix demand.
- **Recommendation:** Keep it (it is load-bearing for the React-19 tree) but periodically run `npm install --no-legacy-peer-deps --dry-run` to surface what conflicts are being suppressed, and document in `BACKEND.md`/`CLAUDE.md §3` *which* peer conflict requires it (currently undocumented — a maintainer can't tell if it's still needed). No action required for cutover.

### H-7 — `vendor-xlsx` chunk = 429 kB (143 kB gz); xlsx is the bundle-size driver

- **Classification:** already-known (Phase-0 SEED-H2; documented in `FRONTEND.md` build-chunk notes line 66 and `src/utils/xlsx.js:9-14`).
- **Severity:** Low/Awareness.
- **Evidence:** Phase-0 `npm run build` reported `vendor-xlsx = 429.53 kB (gzip 143.08 kB)`; `vite.config.js:65-71` carves the `vendor-xlsx` manual chunk; `src/utils/xlsx.js:38,130` use **dynamic** `import('xlsx')` inside each function so the chunk is lazy-loaded only when a distributor downloads/uploads a settlement file.
- **Impact:** Negligible for cold load — the lazy import keeps xlsx out of the entry bundle; it only downloads when the settlement flow is opened. Already mitigated by design. Noting because the H-1 remediation (SheetJS CDN build or a lighter parser) would *also* shrink this chunk.
- **Recommendation:** No standalone action. If H-1 is remediated by swapping to a lighter parser, this chunk shrinks as a free side effect. Already-known; do not re-prioritize.

### H-8 — Sentry version drift (`^8.50.0` declared, `8.55.2` resolved) and one major behind current

- **Classification:** quality/tech-debt (dependency freshness).
- **Severity:** Low/Awareness.
- **Evidence:** `package.json:30` `"@sentry/node": "^8.50.0"`, `:56` `"@sentry/react": "^8.50.0"`; both resolve to `8.55.2` (verified via installed `package.json`s). Both are env-gated and documented in `BACKEND.md §2` lines 59-60 and `.env.local.example:39`. The Sentry v8 line is stable but superseded (v9/v10 exist as of this cutoff); `@sentry/node` v8's auto-Express-instrumentation API (`setupExpressErrorHandler`) is the one this code is written against — a major bump would change that surface.
- **Impact:** None today; v8 is functional and the code's comments (`server/index.ts:78-82,144-145`) are written specifically for the v8 API. A future major bump (v9/v10) would require revisiting the auto-instrumentation/`setupExpressErrorHandler` wiring and could change `sendDefaultPii`/request-data defaults (ties to H-4). Not urgent for a demo.
- **Recommendation:** Stay on v8 for now (it works, code is calibrated to it). When/if upgrading to v9/v10, re-verify the request-data integration's PII defaults and the Express error-handler API, and add the `beforeSend` scrubber from H-4 first so a defaults change can't regress §7. Awareness only.

### H-9 — `keepalive.yml` pings a self-documented placeholder/unconfirmed Render hostname

- **Classification:** quality/tech-debt (observability/ops). Overlaps Workstream F/G but called out here as it is the only external uptime probe.
- **Severity:** Low.
- **Evidence:** `.github/workflows/keepalive.yml` — the file's own header comment states *"the hostname below is a placeholder derived from `name:` in render.yaml … Update this URL in a follow-up commit once the actual service hostname is confirmed in the Render dashboard"*, then pings `https://uganda-dashboard-api.onrender.com/healthz` every 14 min. CLAUDE.md §1 cites the backend as `uganda-dashboard-api.onrender.com`, so the URL is *probably* right, but the workflow self-declares it unverified and has no failure notification wired (the comment notes cron-job.org/UptimeRobot "should be set to email the team" — aspirational).
- **Impact:** If the real Render hostname carries a hash suffix (as the comment warns Render may append), the keepalive silently fails its `exit 1` on every run and the only thing keeping the free-tier backend warm during a demo is the unconfirmed external pinger — risking a cold-start 502 mid-demo. Low because the URL is likely correct and Render's own healthcheck is independent.
- **Recommendation:** Confirm the live Render hostname against the dashboard and either update or annotate `keepalive.yml` as verified (drop the placeholder caveat). Ensure GitHub Actions notifies on the workflow's failed runs (it currently just `exit 1`s into the Actions log). Read-only here; no change made.

---

## Cross-references checked (not re-reported)

- `docs/DASHBOARD_AUDIT_FIXES.md`, `docs/audit/*` (`REPORT.md`, `05-static.md`, `ADR-decisions.md`), `docs/archive/*` — searched for `xlsx`/`SheetJS`/`Sentry`/`CVE`/`legacy-peer-deps`/dependency findings. The only prior hits are: `AUDIT-5-4` (dotenv-not-unused doc fix — resolved per `BACKEND.md §15b`), `AUDIT-5-1` (`react-is` keep-as-transitive — resolved), and `05-static.md:269` merely *noting* `legacy-peer-deps=true` as context. **No prior audit assessed the `xlsx` CVEs, the Sentry PII/source-map posture, or the `vercel`-CLI vuln tree** — H-1 through H-5/H-8 are new.
- `CLAUDE.md §10b` "NPM deps inventory (verified 2026-05-22)": every direct dep is used. Confirmed `vercel` is the lone *unused-in-scripts* exception not covered there (it's a CLI, not an imported module) — H-2 stands.
- `FRONTEND.md §16b` / `BACKEND.md §15b`: no dependency/observability items overlap these findings.

---

## Cutover go/no-go (for the synthesis agent)

- **Not a hard blocker for `feat/simplify-commissions` → `main`:** H-1 (xlsx) is a real vulnerability but its *exploit surface in this client-only, distributor-self-upload demo is low* — it does not corrupt demo data or break a flow, and there is no untrusted ingress. It should be remediated but does not gate the cutover by itself. H-2–H-9 are hygiene/observability and do not block.
- **Recommended pre/post-cutover backlog (not gates):** (1) swap `xlsx` to the SheetJS CDN build or a lighter parser + add a parse-size cap [H-1, with Workstream B]; (2) drop the `vercel` CLI dep to collapse ~25 audit lines [H-2]; (3) apply the no-major audit-fix bumps, prioritizing the bundled `d3-color` ReDoS [H-3]; (4) add a Sentry `beforeSend` PII scrubber + `release` tag before any production DSN is enabled [H-4]; (5) confirm the keepalive hostname [H-9].
