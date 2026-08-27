import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Local dev only — proxy /api to the local Express backend (`npm run dev:api`
  // on :3001) so the browser talks to it same-origin (no CORS). The backend's
  // CORS allowlist (server/cors.ts) only permits the Vercel origins but allows
  // no-Origin (server-to-server) requests, so we strip the browser Origin on
  // the proxied call. `server.proxy` has NO effect on `vite build` / the Vercel
  // deployment — production points the frontend at the Render API via
  // VITE_API_BASE_URL. Safe to commit.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
          // When the local Express backend (`npm run dev:api`, :3001) isn't
          // running, http-proxy emits ECONNREFUSED and Vite would otherwise
          // return a bare, bodyless 500 for every `/api/*` call — which the
          // login UI surfaces as an opaque "Server unavailable" and hides the
          // real cause (a recurring dev trap: `npm run dev` starts Vite only).
          // Answer with an explicit, actionable 503 + a red terminal line so the
          // failure is self-diagnosing. Dev-only: this `configure` callback never
          // runs during `vite build` / on Vercel.
          proxy.on('error', (err, _req, res) => {
            const backendDown = err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET');
            if (res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(backendDown ? 503 : 502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                code: 'backend_down',
                message: 'API server not running — start it with `npm run dev:all` (or `npm run dev:api` in a second terminal).',
              }));
            }
            console.error(`\x1b[31m[vite proxy] /api → localhost:3001 unreachable (${(err && err.code) || err}). Run \`npm run dev:all\`.\x1b[0m`);
          });
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: { modules: { classNameStrategy: 'non-scoped' } },
    // The `e2e/` directory holds Playwright specs that import @playwright/test
    // — they share the `.spec.ts` extension but are not vitest tests.
    // 'dist-server' is listed SEPARATELY because 'dist' does not match it
    // (review 2026-08-26 §1.2). `npm run build:api` compiles server/*.ts into
    // dist-server/server/*.js — including the two test files — so a built
    // checkout collected server/cspReport.test.ts AND its compiled twin
    // dist-server/server/cspReport.test.js, same for sentryScrub. Two
    // consequences, neither of them "an extra test passed": the suite's
    // composition depended on whether the machine had run a server build (193
    // files fresh-cloned, 195 built), and the compiled copy exercises whatever
    // was last COMPILED — so a source edit without a rebuild runs stale
    // assertions under a passing name. sentryScrub is the module that was
    // leaking Ugandan NINs into browser error reports until 2026-08-25; it is
    // the last one you want tested from a copy that can silently go stale.
    // Every entry is an explicit `/**` glob. The bare directory names this list
    // used to carry ('node_modules', 'dist') match a TOP-LEVEL directory only —
    // and that silent non-match has now bitten twice. First `dist-server` (see
    // above). Then `node_modules`, where the bare form let a NESTED one through:
    //   .vercel/builders/node_modules/json-schema-traverse/spec/index.spec.js
    // — a third-party package's own spec suite, 10 tests, collected and run as
    // part of this repo's. `.vercel/` is gitignored (.gitignore:37), so it never
    // reached CI; it just meant a developer who had run the Vercel CLI measured
    // a different suite (193 files / 4,592 tests) than CI did (192 / 4,582), and
    // neither number was wrong-looking enough to notice. `.vercel/**` is listed
    // as well because it is a 116MB build cache that has no business being
    // walked at all, whatever a future `vercel build` drops in it.
    exclude: ['**/node_modules/**', 'dist/**', 'dist-server/**', '.vercel/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // `server/**/*.ts` added 2026-08-27 (review §1.4). It was absent, and the
      // list read COMPLETE rather than partial — which is how the gap survived a
      // coverage-focused remediation pass: an exclusion you can see gets argued
      // with, an omission does not. The server tests RAN the whole time
      // (`npx vitest run server/` -> 2 files, 20 tests); they were simply never
      // MEASURED, so the four-axis ratchet below could not see 910 lines of the
      // transport tier — 496 of them server/index.ts, whose own header warns
      // that reordering its middleware "will silently break: Sentry capture,
      // rate-limit IP detection, access logging, healthcheck reachability".
      // That file plus the rate-limiter key generator and the proxy-hop
      // derivation are the most security-load-bearing code outside SQL.
      include: ['src/**/*.{js,jsx,ts,tsx}', 'api/**/*.ts', 'server/**/*.ts'],
      // '**/* [0-9].*' (audit A25-012, 2026-08-25): this checkout is actively
      // syncing through a tool that materialises "conflicted copy"-style
      // duplicates — e.g. `periodSettlement.test 2.js`, `policies.test 2.js`,
      // byte-identical siblings of real files, appearing and reappearing on
      // disk without ever being `git add`ed. They fail to match `**/*.test.*`
      // (the space before the digit breaks the `.test.` substring), so v8's
      // `include: src/**/*.js` swept them in as phantom 0%-covered files and
      // measurably deflated every metric below — confirmed by deleting the 5
      // found at measurement time and re-running: statements alone moved
      // several points. Untracked and harmless individually, but a coverage
      // *gate* that a filesystem sync race can silently push down over time
      // isn't a trustworthy ratchet, so they're excluded defensively rather
      // than relying on remembering to delete them before every measurement.
      exclude: ['**/*.test.*', '**/__tests__/**', 'src/test/**', 'src/data/**', 'node_modules/**', 'dist/**', 'coverage/**', '**/* [0-9].*'],
      // CI-enforced floor (audit A25-012, 2026-08-25 — supersedes the original
      // §7b.16 pin). MEASURED coverage today (`npx vitest run --coverage`,
      // after clearing the sync-duplicate contamination above): statements
      // 38.97%, branches 33.56%, functions 31.96%, lines 40.71%. The 2026-06-09
      // baseline (§7b.16) pinned statements ONLY at 23 — 10 points below even
      // its own contemporaneous measured actual (~32.94%) — and left
      // branches/functions/lines completely ungated, so coverage could regress
      // freely on three of the four axes and even statements had 10 points of
      // slack to give back before the gate noticed. All four are pinned here,
      // each FLOORED to the integer below its measured value (never above —
      // that would red-line CI on the next run) so the gate is a genuine
      // RATCHET on every axis: it locks in today's floor and fails CI on any
      // regression below it. Raise these as RTL/unit coverage grows; the bulk
      // of `src/**` is UI components whose only coverage is the browser-level
      // Playwright E2E suite, not Vitest, so 100% here was never the goal.
      // Vitest defaults this to FALSE, which quietly makes the whole ratchet
      // conditional: on ANY failing test the coverage report is not produced and
      // the thresholds below are never evaluated. So a change that both breaks a
      // test AND tanks coverage reports only the first, and the coverage gate
      // silently does not run on precisely the runs that most need checking.
      reportOnFailure: true,
      // Re-floored 2026-08-27 after `server/**` joined `include` above and the
      // exclude globs were made explicit (review §1.4). All four RISE from
      // 38/33/31/40 — bringing 910 previously-unmeasured server lines into the
      // denominator cost less than adding two well-tested modules to the
      // numerator gained, and branches actually improved.
      //
      // MEASURED IN A CLEAN WORKTREE AT HEAD, not in the dev working tree, and
      // that distinction is the whole reason this commit is separate. CI checks
      // out the branch; it does not see uncommitted work. The working tree here
      // carries an uncommitted admin-map change that DELETES two 0%-covered
      // components, and measuring there read 40.21/34.47/33.10/41.98 — flooring
      // to those would have pinned statements at 40 and functions at 33 against
      // a CI actual of 39.91 and 32.84, red-lining the build on the very next
      // run. Measure the tree CI checks out:
      //
      //   statements 39.91  branches 34.21  functions 32.84  lines 41.67
      //
      // Each floored to the integer BELOW its measured value — never above,
      // which would red-line immediately. Raise them as coverage grows; the bulk
      // of src/** is UI whose only real coverage is the Playwright E2E suite.
      thresholds: {
        statements: 39,
        branches: 34,
        functions: 32,
        lines: 41,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Slightly higher than the default 500kB so we don't get warnings on
    // routes that legitimately carry a chart library (recharts) or map.
    chunkSizeWarningLimit: 700,
    // No source maps. 'hidden' still WRITES .map files to dist/assets/, and
    // Vercel runs this build itself + serves the whole dist/ — so the maps were
    // publicly fetchable at /assets/*.js.map (full source recoverable) even
    // though the devtools hint was stripped. .vercelignore can't help: it
    // filters the source upload, not Vercel's regenerated build output. There is
    // intentionally no `@sentry/vite-plugin` upload wired (BL-29 / H-5), so the
    // maps had no consumer — pure liability. `false` stops emitting them
    // entirely. If symbolication is ever wanted, switch back to 'hidden' AND add
    // the Sentry plugin to upload-then-delete the maps before they ship.
    // (Audit S4.) See FRONTEND.md §11 / BACKEND.md §2 observability note.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split heavy third-party deps out of the entry chunk so the marketing
        // landing page doesn't have to download recharts/leaflet/etc.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Match leaflet, react-leaflet, AND @react-leaflet/core. The earlier
          // regex `id.includes('/react-leaflet')` missed `/@react-leaflet/core`
          // (the `@` prefix has no preceding slash), which produced a circular
          // `vendor-leaflet -> vendor -> vendor-leaflet` warning under PR-7's
          // React.lazy split.
          if (id.includes('/leaflet') || id.includes('react-leaflet')) return 'vendor-leaflet';
          if (id.includes('/recharts') || id.includes('/d3-')) return 'vendor-charts';
          // xlsx (SheetJS) is ~400KB+ and only used by the distributor
          // settlement template download/parse path. It's pulled in via a
          // dynamic `import('xlsx')` in `src/utils/xlsx.js` (so it's normally a
          // standalone async chunk anyway); this manual chunk is a safety net
          // to keep it out of the entry/`vendor` chunk if anything ever
          // references it statically.
          if (id.includes('/xlsx')) return 'vendor-xlsx';
          if (id.includes('/framer-motion') || id.includes('/motion-utils') || id.includes('/motion-dom')) return 'vendor-motion';
          if (id.includes('/@tanstack/')) return 'vendor-tanstack';
          if (id.includes('/react-router') || id.includes('/@remix-run')) return 'vendor-router';
          // Keep React core + its tightly coupled runtime deps together so a
          // generic `vendor` chunk can't circular-reference back into them
          // (which surfaced as `Cannot read properties of undefined (reading
          // 'forwardRef')` in production after chunk hashes shifted).
          if (/\/(react|react-dom|scheduler|use-sync-external-store|object-assign|js-tokens|loose-envify)\//.test(id)) {
            return 'vendor-react';
          }
          return 'vendor';
        },
      },
    },
  },
})
