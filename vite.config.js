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
    exclude: ['node_modules', 'dist', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx,ts,tsx}', 'api/**/*.ts'],
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
      thresholds: {
        statements: 38,
        branches: 33,
        functions: 31,
        lines: 40,
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
