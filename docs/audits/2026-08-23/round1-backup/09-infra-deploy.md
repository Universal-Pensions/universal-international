# A09 · Infra, deploy, observability & secrets

**Captured:** 2026-08-23 · **Repo:** `/Users/shubhang/Desktop/Projects/uganda-dashboard` @ `bd637f6` (main)
**Baseline cited:** `docs/audits/2026-08-23/00-baseline.md` (§1 restore, §3 toolchain, §6 row counts, §10 Playwright)
**Live systems probed:** Supabase `ilkhfnoyxlxwqadebnkp` · Render `srv-d8bc20mgvqtc73afh16g` · Vercel `prj_RseGQ3f8Xdvn4Q46A5G2ALdTYJdg` · GitHub `shubhang1992/uganda-dashboard`

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 24 |
| Artifacts examined | 24 |
| Coverage | 100% |
| Checks defined | 49 |
| Checks executed | 48 |
| Checks passed / failed / blocked | 25 / 23 / 1 |
| Findings C / H / M / L / I | 0 / 3 / 6 / 5 / 4 |
| Evidence commands run | 47 |
| Excluded as demo-scope | 5 (free-tier plan choice itself; no `/metrics` Prometheus endpoint — explicitly documented "no" in `docs/render-operational.md`; no real SMS/payment rails; mocked KYC vendor; in-memory ticket store) |
| Blocked, with reason | 1 — Render env-var **names** unreadable: the Render MCP surface exposes only `update_environment_variables` (a write, forbidden by G1/G5) and `get_service` omits `envVars`. `SENTRY_DSN` presence on Render is therefore unverified. |

### Domain-specific metrics
| Metric | Value |
|---|---|
| Env vars required (app-owned, excl. platform-injected) | **21** |
| Env vars documented (`.env.local.example` ∪ `docs/BACKEND.md` §2) | **20** |
| Env vars undocumented in any template | **1** (`ALLOW_DESTRUCTIVE_E2E`) |
| Env vars required-but-absent in an environment | **3** (local: `SUPABASE_URL`, `VITE_API_BASE_URL` — both survive on fallbacks; Vercel prod: `VITE_SENTRY_DSN` — proven absent) |
| CSP violations by directive (production, measured) | `style-src` **1** · `font-src` **2 observed** (up to 12 faces referenced) · `script-src` **1** (inline `onload=`) · `img-src` **2 call sites** (blob:) · structural **1** (no `report-uri`/`report-to`) — **6 total** |
| Cold-start ms (Render, warm) | `/healthz` **315 ms** TTFB · `/readyz` **512 / 172 / 168 ms** (n=3). Instance continuously up **7+ days** — could not be forced cold without taking prod down. |
| Cold-start (Supabase, real) | **~120 s** end-to-end restore; 6 × `/readyz` 503 before the first 200 (baseline §1) |
| Git-history secret hits | **0** across **4,603 blobs / 8,003 objects / 427 commits**, all refs (target 0 ✅) |
| Rollback paths documented vs missing | **1 of 3 surfaces** documented (DB, and only as a historical `0045–0057` runbook). Frontend (Vercel) **missing**. API (Render) **missing**. Migrations: 86/108 have `.down.sql`; **22 have none**. |
| CI gates present / absent | Guards **written**: 1 (§15-M1). Guards that have ever **executed** on main: **0** (41/41 runs skipped it). **Enforced blocking gates: 0** — `main` unprotected, no rulesets, Vercel auto-deploys on push. |

---

## 1. Headline — the paused-database failure mode (Check 1)

### 1.1 The mechanism, confirmed in both files

`.github/workflows/keepalive.yml:29-31`:
```
          code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
            "https://uganda-dashboard-api.onrender.com/healthz")
```

`server/index.ts:110-116` — the endpoint it pings:
```ts
app.get('/healthz', cors(corsOptions), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
});
```
There is no Supabase client, no `await`, no I/O of any kind — deliberately so, per the comment at `:95-97` ("Must remain I/O-free so a misconfigured Supabase deploy still surfaces as `service up, env wrong` rather than a network outage (G16)"). The only endpoint that touches Postgres is `/readyz` (`server/index.ts:128-146`, one `commission_config` select), and **nothing pings it on a schedule**.

Consequence: the keepalive keeps the *Render* process warm and is structurally incapable of generating the Postgres activity Supabase's free tier counts when deciding to auto-pause after ~7 idle days.

### 1.2 Proof that the monitor stayed green through the whole outage

Last DB write was `2026-08-11`; the project was found `INACTIVE` on `2026-08-23` (baseline §1). Across the tail of that window:

```
$ gh run list --workflow=keepalive.yml --limit 200 --created 2026-08-18..2026-08-23 --json conclusion,createdAt
runs in 2026-08-18..2026-08-23: 200
conclusions: Counter({'success': 200})
```

**200 of 200 keepalive runs succeeded while the demo was unusable.** The monitor reported 100% green for a platform whose data layer was off. This is not a gap in alerting — it is an alert wired to a signal that cannot go red for this failure.

### 1.3 Exposure for a rep opening the demo cold

Measured this session (baseline §1, reproduced): `restore_project` → `INACTIVE` → `COMING_UP` → 6 × `/readyz` 503 `{"ok":false,"code":"not_ready"}` at 15 s intervals → 200 on attempt 7. **~2 minutes**, and only after *someone with Supabase dashboard access notices and clicks restore*. Until then the rep gets a frontend that renders shell chrome and zero data, and every `/api/*` call 503s.

There is no in-product signal that this is what happened: `src/components/WarmupBanner.jsx` pings `/readyz` and shows a warm-up banner, which is correct behaviour for a Render cold start but reads as "wait a moment" for a condition that will never resolve on its own.

### 1.4 Options (report-only — nothing applied)

| Option | Cost | Effect |
|---|---|---|
| **A. Point the existing keepalive at `/readyz`** — one-line change to `keepalive.yml:31` | free | Every ping becomes a real `SELECT` against `commission_config`, so the pinger *both* prevents the pause and goes red when the DB is down. Strictly better than today on both axes. **Recommended.** |
| **B. Add a second GHA cron running `psql "$SUPABASE_DB_URL" -c 'select 1'`** | free; needs `SUPABASE_DB_URL` as a GitHub secret | Same keep-warm effect, but adds a prod credential to GitHub that is currently local-only by design (`docs/BACKEND.md` §2 Notes). Weaker than A. |
| **C. Supabase Pro** ($25/mo) | paid | Removes auto-pause entirely and adds PITR — which also closes A09-003. The only option that fixes the class rather than the instance. |

Option A does not remove the need for the *cadence* fix in A09-007 — a `/readyz` ping every 35 minutes still prevents the pause (the threshold is days, not minutes) but leaves up to 103 minutes of undetected downtime.

---

## 2. Render cold start (Check 2) — PASS, but not measurable as designed

The service has been continuously resident for at least 7 days. `memory_usage` for instance `srv-d8bc20mgvqtc73afh16g-f5vp9` returns an unbroken hourly series from `2026-08-16T10:00Z` to `2026-08-23T10:00Z` with **no gaps** (~67–78 MB throughout) — a spun-down free instance emits no memory samples.

Warm timings, measured directly:
```
$ curl -sS -o /dev/null -w 'code=%{http_code} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' https://uganda-dashboard-api.onrender.com/healthz
code=200 dns=0.042045 connect=0.048475 tls=0.060256 ttfb=0.315095 total=0.315540

$ for i in 1 2 3; do curl ... /readyz; done
readyz try1: code=200 ttfb=0.512447 total=0.513042
readyz try2: code=200 ttfb=0.172227 total=0.172510
readyz try3: code=200 ttfb=0.168488 total=0.169127
```

**Conclusion: Render is not the demo-blocking cold start. Supabase is.** Forcing a genuine Render cold start would require withholding traffic from production for 15+ minutes, which is out of bounds for a report-only audit; the number above is therefore the warm figure with the caveat stated rather than an unmeasured guess.

The live deploy is `bd637f63179d833ecbc3044e432d5162bab5bf9a` (`dep-d9tfvju417fc73eb1igg`, `2026-08-11T10:57:30Z`, `status: live`, `trigger: deploy_hook`) — identical to local `HEAD` and to the Vercel production deployment. **No frontend/backend version skew.**

---

## 3. CSP (Check 3) — what would break if `Report-Only` were enforced

### 3.1 The policy actually served (verbatim, production)

```
$ curl -sS -D - -o /dev/null https://uganda-dashboard.vercel.app/
content-security-policy-report-only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; connect-src 'self' https://ilkhfnoyxlxwqadebnkp.supabase.co https://uganda-dashboard-api.onrender.com https://*.sentry.io; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

**Structural defect first: there is no `report-uri` and no `report-to`.** A `Content-Security-Policy-Report-Only` header with no reporting endpoint is inert — the browser evaluates it and discards the result. Nobody has ever seen a violation from this policy, which is why the three below have survived.

### 3.2 Origins actually fetched, measured in a real browser against production

`/faq` and `/request-access?type=employer`, network log (Chrome, 14 requests each, identical set):

| # | URL | Directive | Verdict |
|---|---|---|---|
| 1–8 | `https://uganda-dashboard.vercel.app/assets/*.js`, `*.css`, `/manifest.webmanifest`, `/icons/icon-192.png` | `script-src` / `style-src` / `default-src` / `img-src` | ✅ `'self'` |
| 9 | `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans…&family=Inter…` | **`style-src`** | ❌ **BLOCKED** — origin absent |
| 11 | `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2` | **`font-src`** | ❌ **BLOCKED** — `font-src 'self'` only |
| 12 | `https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yygg_vb.woff2` | **`font-src`** | ❌ **BLOCKED** |
| 13 | `https://uganda-dashboard-api.onrender.com/readyz` | `connect-src` | ✅ allowed |

### 3.3 The third font failure — an inline event handler

`index.html:41` (and byte-identical in the built `dist/index.html`):
```html
<link href="https://fonts.googleapis.com/css2?family=…&display=swap" rel="stylesheet" media="print" onload="this.media='all'" />
```
`onload="…"` is an inline event-handler attribute. Under `script-src 'self'` (no `'unsafe-inline'`, no `'unsafe-hashes'`) it never fires, so even if the stylesheet were allowed it would stay `media="print"` and never apply. **Enforcing the current policy breaks the app's typography three independent ways.**

### 3.4 `blob:` image previews — the KYC review step

`src/signup/steps/IdUploadStep.jsx:151` mints `const nextUrl = URL.createObjectURL(selected);` and `src/signup/steps/ReviewStep.jsx:303,309` render it:
```jsx
<img src={signup.idFrontPreviewUrl} alt="ID front" width="120" height="76" />
<img src={signup.idBackPreviewUrl}  alt="ID back"  width="120" height="76" />
```
`URL.createObjectURL(File)` always yields a `blob:` URL; `img-src` lists `'self' data:` and two tile hosts but **not `blob:`**. Under enforcement both ID thumbnails on the signup review step render broken. (Marked *plausible* rather than *confirmed* — deterministic from the CSP grammar and the code, but I did not walk the wizard in a browser to observe it.)

### 3.5 What is safe

- **`script-src 'self'` with no `'unsafe-eval'` is viable.** Scanned all 135 built chunks (excluding Finder `" 2.js"` duplicates): **0 occurrences of `new Function(` or `eval(`**, including `vendor-xlsx` (SheetJS), `vendor-charts` (recharts/d3) and `vendor-leaflet`.
- **Map tiles are already allowed.** `src/config/env.js:41-43` defaults `MAP_TILE_URL` to `https://{s}.basemaps.cartocdn.com/light_nolabels/…`, covered by the existing `img-src` entry. OSM is listed too.
- **No WebSocket exposure.** `grep -rn "\.channel(\|realtime\|postgres_changes" src/` returns only two comments (`src/hooks/useNotifications.js:15` "realtime off", `src/services/supabaseClient.js:5`). This matters because CSP scheme-matching does **not** let an `https:` source authorise a `wss:` connection — had Realtime been in use, `connect-src` would have blocked it.
- All inline SVG data-URIs (`src/**/*.module.css`, `src/dashboard/map/UgandaMap.jsx:110`) are `data:` and already allowed.
- `worker-src` / `manifest-src` are unset but fall back to `script-src 'self'` / `default-src 'self'`, which is correct for the PWA service worker and manifest.

### 3.6 The enforceable policy (FINDING A09-004 — do not apply from this document)

Option 1 — keep Google Fonts, widen the policy and drop the inline handler:
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com;
connect-src 'self' https://ilkhfnoyxlxwqadebnkp.supabase.co https://uganda-dashboard-api.onrender.com https://*.sentry.io;
worker-src 'self';
manifest-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
report-uri <endpoint>;
```
plus replacing `<link … media="print" onload="this.media='all'">` with a plain `<link rel="stylesheet">` (or a `<link rel="preload" as="style">` + non-inline swap).

Option 2 — self-host the two families into `public/fonts/`. Then `style-src 'self' 'unsafe-inline'` and `font-src 'self'` need no change at all, the inline handler disappears, and two third-party origins leave the critical path. Only `blob:` on `img-src` and the report sink remain. **Preferred** for a demo shown on Ugandan mobile connections.

Required origins, for the record: **Google Fonts** (`fonts.googleapis.com` stylesheet, `fonts.gstatic.com` woff2) · **map tiles** (`*.basemaps.cartocdn.com`, `*.tile.openstreetmap.org`) · **Supabase** (`ilkhfnoyxlxwqadebnkp.supabase.co`) · **Render API** (`uganda-dashboard-api.onrender.com`) · **Sentry** (`*.sentry.io` — matches `*.ingest.sentry.io`; currently dead weight, see A09-005).

---

## 4. Production headers (Check 4) — PASS

All six `vercel.json` headers are served, on the SPA root, on a rewritten deep link, and on hashed assets:

```
$ curl -sS -D - -o /dev/null https://uganda-dashboard.vercel.app/dashboard
HTTP/2 200
content-security-policy-report-only: default-src 'self'; …
permissions-policy: geolocation=(), camera=(self), microphone=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
```
Same six on `/assets/index-DpSq6jQ9.css`. `X-Frame-Options: DENY` and `frame-ancestors 'none'` agree. Two observations folded into A09-017: assets come back `cache-control: public, max-age=0, must-revalidate` (content-hashed files are not `immutable`), and the Render API sets `cross-origin-resource-policy: same-origin` on a deliberately cross-origin API (harmless — CORP does not apply to CORS-mode `fetch`).

---

## 5. Environment matrix (Check 5)

Consumers enumerated mechanically:
```
$ grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*" server/ api/ scripts/ e2e/ vite.config.js playwright.config.ts | sed 's/process\.env\.//' | sort -u
ALLOW_DESTRUCTIVE_E2E CI NODE_ENV PORT RENDER_DEPLOY_HOOK RENDER_GIT_COMMIT SENTRY_DSN SENTRY_RELEASE
SUPABASE_DB_URL SUPABASE_JWT_SECRET SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_SUPABASE_URL

$ grep -rhoE "import\.meta\.env\.[A-Z_][A-Z0-9_]*" src/ vite.config.js e2e/ | sed 's/import\.meta\.env\.//' | sort -u
DEV MODE PROD VITE_API_BASE_URL VITE_LEGAL_PRIVACY_URL VITE_LEGAL_TERMS_URL VITE_MAP_TILE_URL
VITE_SENTRY_DSN VITE_SENTRY_RELEASE VITE_SUPABASE_ANON_KEY VITE_SUPABASE_URL VITE_SUPPORT_EMAIL
VITE_SUPPORT_WHATSAPP_DISPLAY VITE_SUPPORT_WHATSAPP_URL VITE_USE_SUPABASE
```

Names present locally (`grep -oE '^[A-Za-z_][A-Za-z0-9_]*' .env.local` — **names only, no values read or printed**):
`PORT · RENDER_DEPLOY_HOOK · SUPABASE_DB_URL · SUPABASE_JWT_SECRET · SUPABASE_SERVICE_ROLE_KEY · VITE_SUPABASE_ANON_KEY · VITE_SUPABASE_URL · VITE_USE_SUPABASE`

| Variable | Required by | Local | Render | Vercel | GitHub secret | Documented | Gap |
|---|---|---|---|---|---|---|---|
| `SUPABASE_URL` | `server/env.ts:33` | **absent** | ✔ `render.yaml` | — | — | ✔ | **A09-014** — local boot survives only on the `?? VITE_SUPABASE_URL` fallback that `server/env.ts:16` says is "marked for removal" |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/env.ts`, e2e fixtures | ✔ | ✔ | — | ✔ | ✔ | — |
| `SUPABASE_JWT_SECRET` | `server/env.ts`, `e2e/global-setup.ts` | ✔ | ✔ | — | ✔ | ✔ | — |
| `SENTRY_DSN` | `server/index.ts:27,330,335` | — (opt) | ? | — | — | ✔ | **BLOCKED** — cannot read Render env names |
| `SENTRY_RELEASE` | `server/index.ts:34` | — (opt) | opt | — | — | ✔ | — |
| `PORT` | `server/index.ts` | ✔ | ✔ | — | — | ✔ | — |
| `VITE_SUPABASE_URL` | `src/services/supabaseClient.js` | ✔ | (fallback) | ✔ | ✔ | ✔ | — |
| `VITE_SUPABASE_ANON_KEY` | `src/services/supabaseClient.js` | ✔ | — | ✔ | ✔ | ✔ | — |
| `VITE_USE_SUPABASE` | `src/services/api.js` | ✔ | — | ✔ | ✔ (literal `'true'`) | ✔ | — |
| `VITE_API_BASE_URL` | `src/config/env.js:17` | absent (dev `/api` proxy) | — | ✔ **proven** | ✔ (literal) | ✔ | baked value confirmed in the prod bundle: `https://uganda-dashboard-api.onrender.com/api` |
| `VITE_SENTRY_DSN` | `src/main.jsx:29` | — | — | **absent — proven** | — | ✔ | **A09-005** |
| `VITE_SENTRY_RELEASE` | `src/main.jsx:35` | — | — | absent | — | ✔ | — |
| `VITE_MAP_TILE_URL`, `VITE_LEGAL_*`, `VITE_SUPPORT_*` (5) | `src/config/env.js:31-43` | — | — | — | — | ✔ (defaults) | — |
| `SUPABASE_DB_URL` | `scripts/seed-supabase.mjs`, **`scripts/apply-migration.mjs:20`** | ✔ | — | — | — | partial | doc says "read by `seed-supabase.mjs`" only |
| `RENDER_DEPLOY_HOOK` | `scripts/render-deploy.mjs:18` | ✔ | — | — | — | ✔ (example + `render-operational.md`) | absent from the `docs/BACKEND.md` §2 table |
| `ALLOW_DESTRUCTIVE_E2E` | `e2e/specs/regression/empty-states.spec.ts:70` | — | — | — | — | **✗** | **A09-018** |

`assertServerEnv()` (`server/env.ts:24-49`) checks exactly three keys and aggregates them into one throw before `app.listen` — correct design, and it makes the `docs/BACKEND.md` §2 note "no deploy-time preflight — audit X14" stale (A09-018).

---

## 6. Secret hygiene (Check 6) — PASS, zero hits

Full object-graph scan (all refs, not just `main`), reporting counts only:

```
$ git rev-list --objects --all | wc -l          → 8003
$ git cat-file --batch-check … | awk '$2=="blob"' | wc -l → 4603
$ python3 scan.py     # 9 patterns: JWT eyJ…, sb_secret_/sb_publishable_, postgres://user:pw@,
                      # api.render.com/deploy/srv-…?key=, AKIA…, gh[pousr]_…, sk-…,
                      # -----BEGIN … PRIVATE KEY-----, xox[baprs]-…
NO MATCHES across 4603 blobs
scanned_blobs: 4603
```

Only env-shaped path ever committed is `.env.local.example` (a template). `.env.local` is untracked and ignored:
```
$ git check-ignore -v .env.local
.gitignore:42:.env*.local	.env.local
$ git ls-files --error-unmatch .env.local
error: pathspec '.env.local' did not match any file(s) known to git
```
`.gitignore` covers `.env`, `.env.local`, `.env.*.local`, `.env*.local` and `.vercel`. **Nothing to redact — there was nothing to find.**

---

## 7. Sentry (Check 7) — configuration correct, frontend never activated

| Property | Frontend (`src/main.jsx:29-38`) | Backend (`server/index.ts:27-36`) |
|---|---|---|
| DSN-gated init | ✔ `if (import.meta.env.VITE_SENTRY_DSN)` | ✔ `if (process.env.SENTRY_DSN)` |
| `tracesSampleRate` | ✔ `0.1` | ✔ `0.1` |
| `sendDefaultPii` | ✔ `false` | ✔ `false` |
| `beforeSend` / `beforeBreadcrumb` scrubber | ✔ `src/utils/sentryScrub.js` | ✔ `server/sentryScrub.ts` |
| Error handler wired | ✔ `ErrorBoundary.jsx:20` dynamic `captureException` | ✔ `Sentry.setupExpressErrorHandler(app)` (`:278`) + `uncaughtException`/`unhandledRejection` (`:330,:335`) |

**Scrubber parity verified mechanically, not assumed** — the two copies are in separate build graphs and the comment claims they are "intentionally identical":
```
front keys: 13   back keys: 13
only in front: []   only in back: []
PHONE_RE   front= /(?:\+?256|0)?7\d{8}/g                        | back= same | MATCH
JWT_RE     front= /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g | back= same | MATCH
BEARER_RE  front= /\bBearer\s+[A-Za-z0-9._-]+/gi                | back= same | MATCH
```
**No drift.**

The defect is not the config, it is that the frontend half is switched off in production (A09-005): `@sentry/react` is entirely absent from the shipped bundle because the DSN-guarded branch dead-code-eliminates and the namespace import tree-shakes:
```
$ curl -s https://uganda-dashboard.vercel.app/assets/index-IM_IiCjH.js | grep -c "ingest.sentry.io"   → 0
$ grep -oiE "sentry" prodindex.js | wc -l                                                            → 0
$ for c in vendor-CRnas3xB.js vendor-react-DWMwQj0t.js; do curl -s …/$c | grep -oic sentry; done
vendor-CRnas3xB.js sentry-mentions=0
vendor-react-DWMwQj0t.js sentry-mentions=0
```

---

## 8. Rollback (Check 8)

### 8.1 Frontend (Vercel) — procedure **not documented**
Auto-deploys from `main` via the Vercel GitHub App (`docs/ARCHITECTURE.md:475`). Production deployment is `bd637f63` (`2026-08-11 10:55`, `target=production`, `READY`) with 17 earlier production deployments retained. `vercel rollback <deployment>` / dashboard *Promote to Production* both work on the hobby plan — but the only place this is written down is `docs/audits/2026-04-distributor/rollback-playbook.md:10`, an archived April audit artifact. Neither `CLAUDE.md` nor `docs/render-operational.md` nor `docs/ARCHITECTURE.md` §deploy carries it.

### 8.2 API (Render) — procedure **not documented**, and the scripted path cannot roll back
`autoDeployTrigger: off`; deploys are manual via `npm run deploy:api`. `scripts/render-deploy.mjs:15-16` states the limit plainly:
> "It deploys whatever commit is currently at the tip of the service's branch (main)."

So the supported tool can only ever move **forward**. `docs/render-operational.md:199` documents recovery as "redeploy" and explicitly accepts "No database backup, no log replay, no warm-start cache." Reverting a bad API deploy therefore requires either the Render dashboard's rollback UI (undocumented here) or a `git revert` + push + hook. Render does retain the history (9 prior deploys, all `status: deactivated`).

### 8.3 Database — 22 migrations have no rollback at all
```
$ ls supabase/migrations/*.sql | grep -v '\.down\.sql' | wc -l   → 108
$ ls supabase/migrations/*.down.sql | wc -l                      → 86
```
Forward migrations with **no** `.down.sql` (22): `0001`–`0015`, `0017`–`0021`, `0027`, `0028`. Rollback coverage is contiguous from **`0029` onward** — the audit spec's "floor 0029" is correct, and the gap is the pre-`0029` foundation: initial schema, all RPCs, all RLS policies, the `search_path` pinning and the security-definer trigger conversion. **The schema cannot be reversed below `0029` by any scripted means.**

Down-migration hazards, **parsed only, never executed (G6)**: 14 `.down.sql` files contain `DROP TABLE` and 17 contain `DROP COLUMN`. `docs/BACKEND.md:780-786` documents the one ordering constraint that matters (`0033` → `0032` → `0031` → `0030`, because `0033` adds `notifications.ref_id` → `settlement_batches.id`). `docs/BACKEND.md:424` also records a measured money hazard: reverting `0092` restores `0067`'s reader and **silently zeroes the employee contribution leg** for any config saved while `0092` was live. `docs/migrations-runbook.md` is the only rollback runbook and its own header calls it "a historical record" for `0045`–`0057`.

---

## 9. CI (Check 9) — the guard exists and has never run

### 9.1 The §15-M1 guard is real, and dead

`.github/workflows/test.yml` defines *"Assert db/ specs actually executed (not silently skipped) (§15-M1)"*, which re-runs `e2e/specs/db` with the JSON reporter and fails when `stats.expected < 1`. The skip pattern it defends against is genuine (`e2e/specs/db/{rls-isolation,money-idempotency,deactivate-entities}.spec.ts` all `test.skip(!hasEnv, …)`; `invariants.spec.ts:69` skips on `!hasServiceRole`).

But the step is gated on `github.event_name == 'push' && github.ref == 'refs/heads/main'` and is sequenced **after** the full-matrix step — and the full matrix cannot finish inside the job's `timeout-minutes: 20`. Step-level evidence for the `bd637f6` push:

```
$ gh api repos/shubhang1992/uganda-dashboard/actions/jobs/93757067117
"Install Playwright browsers + system deps"                     success   10:59:48 → 11:00:49
"Run Playwright full matrix (main post-merge …)"                cancelled 11:00:49 → 11:19:39
"Assert db/ specs actually executed … (§15-M1)"                 skipped
"Upload Playwright HTML report"                                 skipped
"Upload Playwright traces + screenshots on failure"             skipped
job conclusion: cancelled (20m16s)
```

Swept across every push-to-main run in the last 60 workflow runs (2026-06-12 → 2026-08-11):
```
$ … | awk '{print $2, $3}' | sort | uniq -c
  41 cancelled m1=skipped
```
**41 of 41. The db-guard assertion has never executed once.** So has the artifact upload — `if: ${{ !cancelled() }}` is false on a timeout, so the HTML report and traces for the very runs that fail are also never uploaded.

The arithmetic is structural, not marginal: the local full matrix takes **24.4 min at `--workers=1`** (baseline §10), and `playwright.config.ts:52` sets `retries: process.env.CI ? 1 : 0`, so CI re-runs every one of the 30 deterministic failures — CI is strictly *slower* than 24.4 min against a 20-minute ceiling.

### 9.2 Nothing gates production either

```
$ gh api repos/shubhang1992/uganda-dashboard/branches/main/protection   → 404 "Branch not protected"
$ gh api repos/shubhang1992/uganda-dashboard/rulesets                   → []
```
`main` has no protection and no rulesets; Vercel auto-deploys on push regardless of CI; the Render hook is manual and ungated. Across the last 60 runs: **41 push runs cancelled, 16 PR runs failed, 3 PR runs cancelled — zero green CI runs of any kind.** The 30 deterministic Playwright failures in baseline §10 reached production precisely because nothing was watching.

### 9.3 `npm ci --legacy-peer-deps` — unnecessary, and divergent from Render

CI installs with `npm ci --legacy-peer-deps` (both jobs). Render installs with plain `npm ci`. Two probes:
- **Empirical:** the `2026-08-11` Render build succeeded with plain `npm ci` (deploy `dep-d9tfvju417fc73eb1igg`, `status: live`).
- **Direct:** strict resolution from the committed `package.json`, from scratch, in a scratchpad copy (the working tree's `package.json`/`package-lock.json` were **not touched**):
  ```
  $ git show HEAD:package.json > $SP/package.json && rm -f $SP/package-lock.json
  $ npm install --package-lock-only --dry-run --strict-peer-deps --no-audit --no-fund
  up to date in 1m      (only warning: EBADENGINE node 22.x required, running v24)
  ```
No peer conflict exists. The flag buys nothing and disables the one check that would catch a future peer break *before* Render's stricter install rejects it.

### 9.4 Typecheck coverage and hooks

`server/tsconfig.json` excludes `../api/**/*.test.ts`, `../api/**/*.spec.ts`, `./**/*.test.ts`. `find api server -name "*.test.ts"` lists 10+ files (`api/chat.test.ts`, `api/contact.test.ts`, `api/kyc/*.test.ts`, …) that are compiled by nothing. There is **no root `tsconfig.json`** (`ls tsconfig*.json` → no matches), so `build:api` is the *only* type gate in the repo. No `.husky` directory and no non-sample hook in `.git/hooks`; no `husky`/`lint-staged`/`prepare` entry in `package.json` — **no pre-commit hook exists** (confirming the spec's expectation).

---

## 10. Dependencies (Check 10)

`.github/dependabot.yml` configures weekly npm + github-actions **version** updates with grouping. It is running — but:

```
$ gh api repos/shubhang1992/uganda-dashboard/dependabot/alerts
{"message":"Dependabot alerts are disabled for this repository.", "status":"403"}
```
**Security updates are off.** None of the 23 advisories below will ever produce a PR.

Meanwhile 12 dependabot version PRs sit open, the oldest from `2026-06-09`, all blocked by a red lint gate — the grouped PR fails on 20 *new* `react-hooks/set-state-in-effect` errors introduced by the bumped `eslint-plugin-react-hooks`, not on anything the bump broke:
```
$ gh run view 32104912210 --log-failed | tail
> 82 |     setAmountStr('');
     |     ^^^^^^^^^^^^ Avoid calling setState() directly within an effect  react-hooks/set-state-in-effect
✖ 345 problems (20 errors, 325 warnings)
```

### Reachability triage — stated plainly

**The 3 criticals never ship.** `shell-quote` reaches the tree only through `concurrently` (a devDependency used by `dev:all`); `tar` only through the `supabase` CLI (devDependency). Neither is in `dependencies`, neither is bundled by Vite, and Render runs `npm prune --omit=dev` after the build. **Not reachable in the browser or on the Render runtime.**

Of the 12 highs, exactly **one package is in `dependencies`** and only two others could touch a running process:

| Package | Where | Reachable? | Why |
|---|---|---|---|
| `react-router` 7.17.0 (via `react-router-dom`) | **browser** | **No, in practice** | 4 of 5 advisories are SSR/RSC-only (`deserializeErrors` hydration, `RSCErrorHandler` XSS, RSC CSRF, server-side route-matching DoS) — this is a client-only `BrowserRouter` SPA. The 5th, open-redirect via backslash in `<Link>`/`useNavigate` (`GHSA-wrjc-x8rr-h8h6`), needs an attacker-controlled navigation target; `grep -rnE "searchParams.get\(['\"](redirect\|next\|returnTo\|from\|to)['\"]\)"` over `src/` returns **nothing**. Still the one worth upgrading (fixed in 7.18.2). |
| `undici` | devDependency only (`@vercel/node`) | **No** | `@vercel/node` is a type-only import in `api/`; pruned from the Render runtime. Node 22's built-in fetch uses its own bundled undici, not this copy. |
| `path-to-regexp`, `js-yaml`, `minimatch`, `brace-expansion` | devDependency (`@vercel/node`, tooling) | **No** | Same path; build/lint-time only. |
| `vite`, `postcss`, `nanoid`, `esbuild`, `@babel/core` | devDependency (build) | **No** | All are dev-server / build-time issues (`server.fs.deny` bypass on Windows, `sourceMappingURL` `.map` disclosure, negative-size loop). Nothing ships. |
| `morgan` 1.10.1 (moderate) | **Render runtime** | **No** | `GHSA-4vj7-5mj6-jm8m` is log forging via the `:remote-user` token. `server/index.ts:197` uses `':method :url :status :response-time ms - :res[content-length]'` — no `:remote-user`. |
| `body-parser` 2.2.2 (low) | **Render runtime** | **No — verified live** | Advisory fires when the `limit` value is *invalid*, silently disabling enforcement. `server/index.ts:156` sets `limit: '200kb'`. Probed production with a 260,016-byte body: `POST /api/chat → status=413 {"code":"payload_too_large"}`. Enforcement works; nothing was written. |

**Net: of 23 advisories, zero are reachable by an attacker against the deployed demo.** The finding is the *process* (alerts off, PRs stuck), not the exposure.

---

## 11. `ALSO REPORT` — planner statistics after the restore

The audit plan's premise is **wrong in the direction that matters**, and this is worth correcting for A21.

Cumulative counters were indeed reset — `pg_stat_user_tables` reads `n_live_tup = 0` and `last_analyze / last_autoanalyze / last_vacuum / last_autovacuum` all `NULL` for every one of the 37 tables, so no autovacuum has run since the restore. **But the query planner does not read those.** It reads `pg_class.reltuples`/`relpages` and `pg_statistic`, and both survived:

```
$ psql -c "SELECT relname, reltuples::bigint, relpages FROM pg_class … ORDER BY reltuples DESC LIMIT 12;"
transactions|28671|558          subscribers|5064|525
nominees|24386|357              subscriber_balances_pre_nav|5060|73
withdrawals|6628|146            subscriber_balances|5060|185
subscribers_unit_value_pre_nav|5064|38   contribution_schedules|5021|68
commissions|5000|69             insurance_policies|2731|33
agents|2043|68                  claims|1907|70

$ psql -c "SELECT count(*) FROM pg_stats WHERE schemaname='public';"
302
```
`reltuples` for `transactions` is 28,671 against a true `count(*)` of 29,027 (−1.2%) and `subscribers` is exact at 5,064. 302 column-level statistics rows (histograms/MCVs) are intact.

**Judgement: this does NOT materially affect a cold demo.** The planner has accurate cardinalities and distributions; a manual `ANALYZE` would change nothing measurable. The only real consequence is the trap already flagged in baseline §6 — never use `n_live_tup` for row counts in this audit — plus the loss of `seq_scan`/`idx_scan` history, which costs A21 its "which indexes are unused" evidence, not the demo its speed. Recorded as **A09-016 (info)**.

---

## 12. Findings

### A09-001 · HIGH · confirmed · The keepalive cannot see, or prevent, the failure that actually takes the demo down
**Location:** `.github/workflows/keepalive.yml:29-31` + `server/index.ts:110-116`
**Evidence:** the two code blocks in §1.1 above, plus
```
$ gh run list --workflow=keepalive.yml --limit 200 --created 2026-08-18..2026-08-23 --json conclusion,createdAt
runs in 2026-08-18..2026-08-23: 200
conclusions: Counter({'success': 200})
```
**Impact:** Supabase free tier auto-paused after ~7 idle days (last activity 2026-08-11, discovered 2026-08-23). The only scheduled monitor pings an endpoint that is deliberately I/O-free, so it stayed green for all 200 runs of the outage window. A rep opening the demo cold gets shell chrome, zero data and 503s on every `/api/*` call, with no in-product explanation, until a human with Supabase dashboard access clicks restore (~2 min).
**Fix:** point `keepalive.yml:31` at `/readyz` instead of `/healthz` — one line; the ping then both generates the Postgres activity that defers the pause and goes red when the DB is unreachable. See §1.4 for the full option table.

### A09-002 · HIGH · confirmed · The e2e job times out on every push to main, so the §15-M1 guard has never executed and nothing gates production
**Location:** `.github/workflows/test.yml` (job `e2e`, `timeout-minutes: 20`; steps "Run Playwright full matrix" and "Assert db/ specs actually executed … (§15-M1)")
**Evidence:**
```
$ gh api …/actions/jobs/93757067117
"Run Playwright full matrix (main post-merge …)"   cancelled  11:00:49 → 11:19:39
"Assert db/ specs actually executed … (§15-M1)"    skipped
"Upload Playwright HTML report"                    skipped
"Upload Playwright traces + screenshots on failure" skipped
$ <sweep of all push-to-main runs, last 60 workflow runs>  →  41 cancelled m1=skipped
$ gh api …/branches/main/protection  → 404 "Branch not protected"
$ gh api …/rulesets                  → []
```
**Impact:** the full matrix needs >24.4 min (baseline §10) *plus* CI retries against a 20-minute ceiling, so the job is cancelled every time. Everything after it is skipped: the guard that exists specifically to catch silently-skipped RLS / money-idempotency / invariant specs has run **zero** times, and the traces that would explain the 30 deterministic failures are never uploaded either. With `main` unprotected and Vercel auto-deploying on push, `bd637f6` shipped to production on a cancelled pipeline — as did all 40 pushes before it.
**Fix:** split e2e into its own job (or raise `timeout-minutes` to ≥45); move the §15-M1 assertion **before** the full matrix, or into its own always-run job; change the artifact uploads from `if: ${{ !cancelled() }}` to `if: always()`.

### A09-003 · HIGH · confirmed · `npm run seed` TRUNCATEs the live demo database with no confirmation and no backup
**Location:** `package.json` (`"seed": "dotenv -e .env.local -- node scripts/seed-supabase.mjs"`) → `scripts/seed-supabase.mjs:335-365`
**Evidence:** (script read only — **not executed**, per G4)
```
//  ⚠️  DESTRUCTIVE RESET — TRUNCATE … RESTART IDENTITY CASCADE  ⚠️
//  ‼️  ONLY SAFE against the fresh, empty demo project this script is run
//      against. … There is no undo.
console.log('• TRUNCATE (destructive reset)…');
await client.query(`TRUNCATE TABLE regions, districts, branches, agents, subscribers,
  subscriber_balances, contribution_schedules, insurance_policies, nominees, transactions,
  claims, withdrawals, commission_config, commissions, …`);
$ grep -nE "confirm|--yes|--force|readline|ALLOW" scripts/seed-supabase.mjs   → (no guard; only argv-free execution)
```
`docs/render-operational.md:199-208`: *"No database backup, no log replay, no warm-start cache."*
**Impact:** the only `SUPABASE_DB_URL` in `.env.local` points at the **live** Singapore project. One `npm run seed` irreversibly destroys 5,064 subscribers / 29,027 transactions / 5,001 commissions with no prompt, no `--yes`, no project-name assertion, and no restore path on the free tier. This has happened before (memory: "change-set audit 2026-06-16 — destructive live reseed"). Every demo fails afterwards.
**Fix:** require an explicit `--yes-destroy <project-ref>` argument that must match the ref parsed out of `SUPABASE_DB_URL`, or gate on `SEED_ALLOW_TRUNCATE=1`. Cheap, and it turns a keystroke into a decision.

### A09-004 · MEDIUM · confirmed (img-src arm: plausible) · Enforcing the report-only CSP as written breaks the app's typography three ways and the KYC ID previews — and today the policy collects nothing
**Location:** `vercel.json:11`; `index.html:41`; `src/signup/steps/ReviewStep.jsx:303,309`
**Evidence:** §3.2 network table (`fonts.googleapis.com` stylesheet vs `style-src 'self' 'unsafe-inline'`; two `fonts.gstatic.com` `.woff2` vs `font-src 'self'`), `index.html:41`'s `onload="this.media='all'"` vs `script-src 'self'`, `URL.createObjectURL` at `IdUploadStep.jsx:151` rendered as `<img src>` vs `img-src` without `blob:`, and the served header itself containing no `report-uri`/`report-to`.
**Impact:** the header is currently decorative — no reporting endpoint means no violation has ever been observed, which is why three real breakages accumulated behind it. Flipping to enforcement today would drop the brand typefaces to system fallbacks and blank both ID thumbnails on the signup review step.
**Fix:** §3.6 gives both the widened policy and the (preferred) self-hosted-fonts variant. Add a report sink before enforcing anything.

### A09-005 · MEDIUM · confirmed · Frontend Sentry is not configured in production; `@sentry/react` is tree-shaken out entirely
**Location:** `src/main.jsx:29`; Vercel project env
**Evidence:**
```
$ curl -s https://uganda-dashboard.vercel.app/assets/index-IM_IiCjH.js | grep -c "ingest.sentry.io"  → 0
$ grep -oiE "sentry" prodindex.js | wc -l                                                           → 0
$ for c in vendor-CRnas3xB.js vendor-react-DWMwQj0t.js; do curl -s …/$c | grep -oic sentry; done     → 0, 0
```
**Impact:** `VITE_SENTRY_DSN` is unset in Vercel, so the DSN-guarded branch is eliminated and the namespace import tree-shakes away. Every browser-side crash — including the ones behind the 30 deterministic Playwright failures — is invisible. `ErrorBoundary.jsx` still renders its fallback, so a rep sees a broken panel and no one is told. The `https://*.sentry.io` entry in the CSP `connect-src` is dead weight today.
**Fix:** set `VITE_SENTRY_DSN` (and ideally `VITE_SENTRY_RELEASE` ← `VERCEL_GIT_COMMIT_SHA`) in the Vercel project, or delete the Sentry code path and the CSP entry so the docs stop describing observability the deployment does not have.

### A09-006 · MEDIUM · confirmed · `render.yaml` is not the applied configuration — the live build command has drifted
**Location:** `render.yaml:25` vs live service `srv-d8bc20mgvqtc73afh16g`
**Evidence:**
```
render.yaml:  buildCommand: npm ci --include=dev && npm run build:api && npm prune --omit=dev
live (get_service): "buildCommand": "npm ci && npm run build:api && npm prune --omit=dev"
```
`render.yaml:25` explains why the flag is supposed to be there: *"`--include=dev` required because NODE_ENV=production would otherwise make `npm ci` skip devDeps (@types/*, @vercel/node, tsx, @sentry/* are devDeps)"*.
**Impact:** the blueprint the repo presents as infrastructure-as-code does not describe the running service, so `docs/render-operational.md`'s recovery procedure ("recreate the service from `render.yaml`") would produce a *different* service from the one in production. Builds currently succeed only because `NPM_CONFIG_PRODUCTION=false` compensates; if that env var is ever dropped the live build loses `tsc` and fails while the blueprint still looks correct. (The comment is also partly wrong: `@sentry/node` is a **prod** dependency, and correctly so — otherwise `npm prune --omit=dev` would delete it from the runtime.)
**Fix:** re-apply the blueprint (or edit the live build command to match), and correct the `@sentry/*` claim in the comment.

### A09-007 · MEDIUM · confirmed · The keepalive fires roughly a third as often as its own design rationale requires
**Location:** `.github/workflows/keepalive.yml:1-11,15`
**Evidence:** the workflow declares `cron: '*/10 * * * *'` and justifies it as *"running every 10 min widens the margin against Render's 15-min spin-down so two jittered fires stay <15 min apart."* Measured over 200 consecutive runs:
```
gaps min=13.8  med=35.0  mean=37.7  max=103.1 minutes  (n=199)
gaps >15min: 197 of 199        gaps <=10min: 0
```
**Impact:** the stated invariant holds for **2 of 199** intervals. Zero fires landed within 10 minutes of each other. The design note is a false reassurance, and the practical monitoring resolution is up to **103 minutes** of undetected downtime — regardless of which endpoint it pings.
**Fix:** either correct the comment to the measured reality, or move the ping to an external scheduler with real cadence (the file already mentions cron-job.org / UptimeRobot as a "5-min backup"; the Render log stream shows no evidence one is currently running against a valid path — see A09-010).

### A09-008 · MEDIUM · confirmed · Dependabot security alerts are disabled, and 12 version PRs are wedged behind a red lint gate
**Location:** repository settings; `.github/dependabot.yml`
**Evidence:**
```
$ gh api repos/shubhang1992/uganda-dashboard/dependabot/alerts
{"message":"Dependabot alerts are disabled for this repository.","status":"403"}
$ gh pr list --state open   → 14 open (12 dependabot; oldest #15/#16/#17/#18/#19/#20/#23 from 2026-06-09)
$ gh run view 32104912210 --log-failed | tail
✖ 345 problems (20 errors, 325 warnings)     ← react-hooks/set-state-in-effect, from the bumped plugin
```
**Impact:** no advisory in the tree (3 critical / 12 high / 5 moderate / 3 low) will ever open a PR, and the version PRs that *are* opened cannot merge because the bumped `eslint-plugin-react-hooks` adds 20 new errors unrelated to the bumps. Dependency maintenance is fully stalled since 2026-06-09. (Exposure itself is nil — see §10 triage — so this is a process finding, deliberately not inflated.)
**Fix:** enable Dependabot alerts; unblock the grouped PR by pinning the eslint plugin or fixing the 20 `set-state-in-effect` errors as a separate change.

### A09-009 · MEDIUM · confirmed · No documented rollback for the frontend or the API, and 22 migrations cannot be reversed at all
**Location:** `docs/render-operational.md`, `docs/ARCHITECTURE.md` §deploy, `scripts/render-deploy.mjs:15-16`, `supabase/migrations/`
**Evidence:** §8 above — `grep -rn -i "rollback" CLAUDE.md docs/*.md` yields DB material only; the sole Vercel rollback mention is in the archived `docs/audits/2026-04-distributor/rollback-playbook.md:10`; `render-deploy.mjs` documents that it deploys tip-of-`main` only; and
```
$ for f in supabase/migrations/*.sql; do … [ -f "$b.down.sql" ] || echo …; done
0001…0015, 0017…0021, 0027, 0028      (22 files, no .down.sql)
```
**Impact:** with `main` unprotected and CI never green, a bad deploy is likely; the recovery procedure for two of the three surfaces exists only as tribal knowledge. The DB floor at `0029` means the initial schema, all RPCs, all RLS policies and the `search_path` pinning are irreversible by script. `docs/BACKEND.md:424` also records that reverting `0092` silently zeroes the employee contribution leg — a money hazard sitting inside the one surface that *does* have downs.
**Fix:** add a short "Rollback" section to `docs/render-operational.md` covering `vercel rollback` / Promote-to-Production and Render's dashboard rollback; treat the pre-`0029` set as forward-only and say so explicitly rather than leaving it implicit.

### A09-010 · LOW · confirmed · `/healthz` and `/readyz` are registered before `morgan`, so health traffic is invisible in the logs
**Location:** `server/index.ts:110` and `:128` (routes) vs `:196-197` (`app.use(morgan(...))`)
**Evidence:**
```
$ list_logs srv-d8bc20mgvqtc73afh16g  2026-08-22T00:00Z → 2026-08-23T10:45Z
1 log:  "GET /api/health 404 0.572 ms - 20"   at 2026-08-23T08:27:26Z    (hasMore: false)
```
One app log line in 34 hours, despite ~60 keepalive pings, my own probes and the browser's `/readyz` calls — none logged, because both routes sit above `morgan`.
**Impact:** you cannot tell from the log stream whether the keepalive is running or whether `/readyz` has been failing — exactly the two signals needed to diagnose A09-001. Separately, that single 404 shows something external is polling `/api/health`, a path that does not exist (the 16 mounted routes are at `server/index.ts:255-270`); whatever monitor that is has been measuring a 404 as "up".
**Fix:** register `morgan` before the health routes (it adds one log line per ping and no meaningful bytes to the response), and repoint whatever monitor is hitting `/api/health` at `/readyz`.

### A09-011 · LOW · confirmed · CI's `--legacy-peer-deps` is unnecessary and diverges from how Render installs
**Location:** `.github/workflows/test.yml` (both jobs: `npm ci --legacy-peer-deps`) vs live Render `npm ci`
**Evidence:** §9.3 — strict from-scratch resolution of the committed manifest succeeds (`npm install --package-lock-only --dry-run --strict-peer-deps` → `up to date in 1m`, no peer error), and the last Render build succeeded with plain `npm ci`.
**Impact:** CI can go green on a dependency tree that Render's stricter install would reject, and the flag suppresses the peer-conflict signal for any future bump. Benign today; it is the class of drift that only surfaces during a deploy.
**Fix:** drop `--legacy-peer-deps` from both CI jobs so CI and Render install identically.

### A09-012 · LOW · confirmed · `@sentry/react` is a devDependency but is imported by code that ships to the browser
**Location:** `package.json` `devDependencies` → `"@sentry/react": "^10.57.0"`; imported at `src/main.jsx:6` and `src/components/ErrorBoundary.jsx:20`
**Evidence:** `python3 -c "…json.load(open('package.json'))…"` places `@sentry/react` in `devDependencies` while `@sentry/node` (correctly) sits in `dependencies`.
**Impact:** latent, not live — Vercel installs all dependencies so the build works. Any build performed with `--omit=dev` (the posture Render's build already uses for the server half) would fail to resolve the import.
**Fix:** move `@sentry/react` to `dependencies`.

### A09-013 · LOW · confirmed · The only typecheck skips every API test file; no root tsconfig; no pre-commit hook
**Location:** `server/tsconfig.json` `exclude`; repo root
**Evidence:**
```
exclude: ["../node_modules/**","../dist/**","../api/**/*.test.ts","../api/**/*.spec.ts","./**/*.test.ts"]
$ find api server -name "*.test.ts" | head   → api/chat.test.ts, api/contact.test.ts, api/kyc/*.test.ts (10+)
$ ls tsconfig*.json                          → no matches
$ ls -a .husky; ls .git/hooks | grep -v sample   → no .husky; no active git hooks
```
**Impact:** `npm run build:api` is the repo's only type gate, and it deliberately skips 10+ TypeScript test files, so type drift in the API tests is caught by nothing. With no pre-commit hook either, the first feedback on any breakage is a CI run that never completes (A09-002).
**Fix:** add a second `tsc --noEmit` pass over the test files, or drop the excludes now that `vitest` type-strips them anyway.

### A09-014 · LOW · confirmed · `SUPABASE_URL` is absent locally and survives only on a fallback marked for removal
**Location:** `.env.local` (names only); `server/env.ts:16,33`
**Evidence:** `.env.local` contains `PORT · RENDER_DEPLOY_HOOK · SUPABASE_DB_URL · SUPABASE_JWT_SECRET · SUPABASE_SERVICE_ROLE_KEY · VITE_SUPABASE_ANON_KEY · VITE_SUPABASE_URL · VITE_USE_SUPABASE` — no `SUPABASE_URL`. `server/env.ts:33`: `const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;` with the comment *"once every deploy has SUPABASE_URL, drop the fallback in a follow-up."* `.env.local.example:41` warns explicitly: *"set SUPABASE_URL so local `npm run dev:api` keeps booting once it's gone."*
**Impact:** the day someone completes the documented cleanup, local `npm run dev:api` stops booting for anyone whose `.env.local` predates it — which is everyone's, today.
**Fix:** add `SUPABASE_URL` to `.env.local` (already in the example template) before the fallback is removed.

### A09-015 · INFO · confirmed · The retired Tokyo Supabase project is still ACTIVE in the same free organisation
**Location:** Supabase org `ugoaezmojpyvcbeeqfbz`
**Evidence:**
```
$ list_projects
{"id":"zengmiugieqjqzaccbqe","name":"Uganda dashboard","region":"ap-northeast-1","status":"ACTIVE_HEALTHY","created_at":"2026-05-14"}
{"id":"ilkhfnoyxlxwqadebnkp","name":"Pension dashbaord","region":"ap-southeast-1","status":"ACTIVE_HEALTHY","created_at":"2026-06-05"}
```
**Impact:** the pre-cutover Tokyo project (the one that ran out of disk, per memory: audit 2026-06-04) is still live alongside the Singapore project, consuming the second free-tier project slot and holding a stale copy of the demo data that a mistyped ref could connect to. (Its name, "Uganda dashboard", is also the more obvious of the two; the live one is "Pension dashbaord", typo included.)

### A09-016 · INFO · confirmed · Planner statistics survived the restore — the "empty stats" premise is wrong
**Location:** live DB
**Evidence:** §11 — `pg_class.reltuples` accurate to within 1.2%, `pg_stats` holds 302 rows for `public`, while `pg_stat_user_tables.n_live_tup` reads 0 and all four `last_*` timestamps are NULL.
**Impact:** none on a cold demo. The planner has real cardinalities and distributions; `ANALYZE` would not measurably change query plans. What *was* lost is the cumulative activity history (`seq_scan`/`idx_scan`), which removes the evidence base for "which indexes are unused" — A21 should note that rather than concluding indexes are dead.

### A09-017 · INFO · confirmed · Two header-level inconsistencies worth recording
**Location:** Vercel edge; `server/index.ts:154` (`app.use(helmet())`)
**Evidence:**
```
/assets/index-DpSq6jQ9.css →  cache-control: public, max-age=0, must-revalidate
POST /api/chat            →  cross-origin-resource-policy: same-origin
                             x-frame-options: SAMEORIGIN, frame-ancestors 'self'
GET  /healthz             →  x-powered-by: Express        (registered before helmet, so unstripped)
```
**Impact:** content-hashed assets are revalidated on every load instead of being served `immutable` — a cheap round-trip to reclaim on a Ugandan mobile connection. `CORP: same-origin` on an API that exists to be called cross-origin is contradictory but inert (CORP does not apply to CORS-mode `fetch`). `x-powered-by` leaks on `/healthz` only, a deliberate consequence of registering it before `helmet` for the ~1 KB response budget.

### A09-018 · INFO · confirmed · Environment documentation gaps and one stale note
**Location:** `docs/BACKEND.md` §2
**Evidence:** `ALLOW_DESTRUCTIVE_E2E` (`e2e/specs/regression/empty-states.spec.ts:70`) appears in no env template — only in `docs/ARCHITECTURE.md:457` prose. `RENDER_DEPLOY_HOOK` is missing from the §2 table (present in `.env.local.example` and `render-operational.md`). `SUPABASE_DB_URL`'s "Read by" column names only `scripts/seed-supabase.mjs`, omitting `scripts/apply-migration.mjs:20`. The four GitHub Actions secret names are documented only inside `test.yml`'s own comment header. And the §2 note *"both hard-fail at first invocation (no deploy-time preflight — audit X14)"* is stale: `server/env.ts`'s `assertServerEnv()` now runs a preflight before `app.listen`.

---

## Traceability

| Spec check | Sub-checks | Disposition |
|---|---|---|
| **1** Paused-DB failure mode | 1.1 keepalive targets `/healthz` | PASS (confirms the mechanism) |
| | 1.2 `/healthz` is I/O-free | **FINDING A09-001** |
| | 1.3 monitor stayed green through the outage | **FINDING A09-001** |
| | 1.4 measured cadence vs declared `*/10` | **FINDING A09-007** |
| | 1.5 quantify cold-open exposure | PASS (~120 s, 6 × 503 first) |
| | 1.6 `/readyz` does touch Postgres | PASS |
| **2** Render cold start | 2.1 `/healthz` TTFB | PASS (315 ms warm) |
| | 2.2 `/readyz` TTFB | PASS (512/172/168 ms) |
| | 2.3 does the instance spin down? | PASS (7-day unbroken memory series; cold start not forceable without taking prod down — stated, not guessed) |
| **3** CSP report-only | 3.1 enumerate origins fetched in prod | PASS |
| | 3.2 map origins against the policy | **FINDING A09-004** |
| | 3.3 inline scripts / event handlers | **FINDING A09-004** |
| | 3.4 `eval` / `new Function` in shipped chunks | PASS (0 of 135 chunks) |
| | 3.5 `blob:` / `data:` image sources | **FINDING A09-004** |
| | 3.6 `wss:` / Realtime exposure | PASS (no Realtime usage) |
| | 3.7 `report-uri` / `report-to` present | **FINDING A09-004** |
| | 3.8 produce the enforceable policy | PASS (§3.6 — reported, not applied) |
| **4** Headers served in production | 4.1 root · 4.2 deep link · 4.3 asset | PASS (all 6 present on all three) |
| | 4.4 Render API headers | **FINDING A09-017** (info) |
| **5** Env matrix | 5.1 `process.env` consumers | PASS |
| | 5.2 `import.meta.env` consumers | PASS |
| | 5.3 compare against `.env.local` names | **FINDING A09-014** |
| | 5.4 compare against example + `docs/BACKEND.md` | **FINDING A09-018** |
| | 5.5 verify Vercel prod carries `VITE_SENTRY_DSN` | **FINDING A09-005** |
| | 5.6 verify Render env var names | **BLOCKED** — Render MCP exposes only `update_environment_variables` (a write, forbidden by G1/G5); `get_service` omits `envVars`. `SENTRY_DSN` on Render unverified. |
| **6** Secret hygiene | 6.1 scan all blobs across all refs | PASS (0 hits / 4,603 blobs) |
| | 6.2 `.env.local` gitignored + untracked | PASS |
| **7** Sentry | 7.1 DSN gating both sides | **FINDING A09-005** (gating correct; frontend DSN never set) |
| | 7.2 `tracesSampleRate: 0.1` both | PASS |
| | 7.3 `sendDefaultPii: false` both | PASS |
| | 7.4 scrubber registered both | PASS |
| | 7.5 scrubber parity (13 keys + 3 regexes) | PASS (no drift) |
| **8** Rollback | 8.1 frontend (Vercel) documented? | **FINDING A09-009** |
| | 8.2 API (Render, manual) documented? | **FINDING A09-009** |
| | 8.3 migrations without `.down.sql` | **FINDING A09-009** (22: `0001`–`0015`, `0017`–`0021`, `0027`, `0028`) |
| | 8.4 down-migration hazards (parse only, G6) | PASS (14 `DROP TABLE`, 17 `DROP COLUMN`; ordering + `0092` money hazard already documented) |
| **9** CI | 9.1 §15-M1 guard exists | PASS (written, and defends a real skip pattern) |
| | 9.2 does it execute? | **FINDING A09-002** (41/41 skipped) |
| | 9.3 `npm ci --legacy-peer-deps` risk | **FINDING A09-011** |
| | 9.4 `build:api` skips `*.test.ts` | **FINDING A09-013** |
| | 9.5 no pre-commit hook | **FINDING A09-013** |
| | 9.6 does e2e gate the pipeline? | **FINDING A09-002** (no protection, no rulesets, Vercel auto-deploys) |
| **10** Dependencies | 10.1 dependabot config + open PRs | **FINDING A09-008** |
| | 10.2 dependabot alerts enabled? | **FINDING A09-008** (disabled) |
| | 10.3 3 criticals are devDependencies | PASS (stated plainly, not inflated) |
| | 10.4 12 highs — runtime reachability | PASS (none reachable; `body-parser` limit verified live with a 413) |
| **ALSO** `pg_stat` reset impact | planner statistics intact? | **FINDING A09-016** (info — the plan's premise corrected) |

---

## Data hygiene statement

**No fixture rows were created and none needed cleanup.** Every database interaction was a read (`SELECT` against `pg_stat_user_tables`, `pg_class`, `pg_stats`). The one production write attempt was deliberate and non-persisting: a 260,016-byte `POST /api/chat` used to verify the `express.json({ limit: '200kb' })` guard, which returned `413 {"code":"payload_too_large"}` from middleware **before** the handler ran — nothing reached the database. No migration was applied and no `.down.sql` was executed (G6). `npm run seed` was **not** run (G4); `vercel env pull` was **not** run (G3); nothing was deployed (G5). Files created: this report only. `package.json` / `package-lock.json` were copied to the scratchpad for the peer-dependency probe and the working-tree copies were left untouched (G7). All temporary artifacts live under `/private/tmp/claude-501/-Users-shubhang/5bbfd26e-9337-4927-acc3-56c74557b08d/scratchpad/`.
