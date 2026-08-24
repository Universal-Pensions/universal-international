# A09 — Adversarial Verification (infra / CI / deploy / ops)

**Verifier stance:** refute-first. Every critical/high reproduced against the LIVE system from a
clean state; ≥3 mediums spot-checked. No writes performed (all repro read-only; G4 honoured — the
seed script was READ, never executed).

**Result:** 3/3 highs CONFIRMED, 4 mediums spot-checked and all CONFIRMED. Zero refutations, zero
demo-scope exclusions, zero severity adjustments.

---

## HIGH findings

### A09-001 — Keepalive pings an I/O-free endpoint, so it cannot prevent/detect the Supabase auto-pause — **CONFIRMED (high)**
- `keepalive.yml:21-22` pings `https://uganda-dashboard-api.onrender.com/healthz`.
- `server/index.ts:110-116` `/healthz` returns `{ok:true}` with **zero** Postgres I/O (comment at
  :95-97 states it "must remain I/O-free"). The DB-touching probe (`/readyz`, reads
  `commission_config`) exists but is **not** the one the cron hits.
- Consequence is sound: a 10-min `/healthz` ping generates no DB activity, so it can neither defer
  Supabase's 7-day-idle free-tier pause nor detect it (it 200s regardless of DB state). Baseline §1
  independently records the project auto-paused (last activity 2026-08-11, discovered paused
  2026-08-23) and assigns this observation to A09.
- Not demo-scope (auto-pause / monitoring is absent from the OUT-OF-SCOPE list; a cold demo visibly
  fails with data-less UI + 503 on every `/api/*` until a human restores). A case exists to call
  this **critical** (full demo outage on a cold open the rep cannot self-recover), but high is
  defensible given the pause is intermittent and restore is ~2 min. Left as **high**.

### A09-002 — Playwright E2E job times out at the 20-min ceiling on every push to main; the §15-M1 DB guard has never run; main is unprotected — **CONFIRMED (high)**
- `test.yml` job `e2e` sets `timeout-minutes: 20`; the push path runs `npx playwright test
  --workers=1` (full matrix); `playwright.config.ts:51` `retries: CI?1:0`. Baseline §10 clocks the
  full run at 24.4 min → strictly over the ceiling.
- **The HEAD commit itself proves it:** run 31484332571 (headSha `bd637f6`) — Playwright E2E job
  `cancelled`; "Run Playwright full matrix" step ran 11:00:49→11:19:39 then **cancelled** (job total
  20m16s ⇒ the 20-min timeout, not a superseding push — `bd637f6` is HEAD); "Assert db/ specs
  actually executed (§15-M1)" **skipped**; "Upload Playwright HTML report" **skipped** (`if:
  !cancelled()` is false on a timeout).
- `gh api .../branches/main/protection` → **404 Branch not protected**; `.../rulesets` → **[]**.
- Last 60 `test.yml` runs: push events **41 cancelled / 0 success**; PRs 16 failure / 3 cancelled.
  Zero green runs. Vercel auto-deploys on push regardless, so `bd637f6` shipped on a cancelled
  pipeline — as did the 40 pushes before it. This is why baseline §10's 30 deterministic Playwright
  failures reached production unnoticed. Not demo-scope.

### A09-003 — `npm run seed` TRUNCATEs the live DB with no confirmation and no backup — **CONFIRMED (high)**
- `package.json` `seed` → `dotenv -e .env.local -- node scripts/seed-supabase.mjs`.
- `scripts/seed-supabase.mjs:359-393` executes `TRUNCATE TABLE regions, districts, branches,
  agents, subscribers, subscriber_balances, transactions, … RESTART IDENTITY CASCADE`.
- No technical guard anywhere in the file: grep for `process.argv|readline|--yes|--force|--confirm|
  project-ref|assert|localhost|NODE_ENV|ilkhfnoyxlxwqadebnkp` matched only an unrelated MOCK_NOW
  comment (line 161). The loud "HUMAN-RUN ONLY / no undo" comments are documentation, not a gate.
- `.env.local`'s `SUPABASE_DB_URL` targets the **live** project `ilkhfnoyxlxwqadebnkp` (verified
  host-class only, secret not printed). Free tier has no restore path.
- Not demo-scope: G4 forbidding the command confirms the auditors *know* it's live-destructive; the
  finding is the missing technical guard, and per project memory this footgun has already caused one
  live wipe. Manual-only trigger + loud docs argue medium, but total irreversibility + prior incident
  keep high defensible. **high** stands. (Script was read only; never executed — G4.)

---

## MEDIUM spot-checks (4 checked, all CONFIRMED)

### A09-004 — Report-only CSP has no report sink and would break fonts + KYC previews if enforced — **CONFIRMED**
Live header on `uganda-dashboard.vercel.app` is `content-security-policy-report-only` with **no**
`report-uri`/`report-to`. `style-src 'self' 'unsafe-inline'` (no `fonts.googleapis.com`), `font-src
'self'` (no `fonts.gstatic.com`), `script-src 'self'` (the `index.html:39` inline `onload=` handler
would be blocked), `img-src 'self' data: <tiles>` (no `blob:`, so `ReviewStep.jsx:303,309` ID
previews built from `URL.createObjectURL` would blank). Decorative today; correctly medium.

### A09-005 — Frontend Sentry tree-shaken out of the shipped bundle — **CONFIRMED**
Live entry + every vendor chunk (`index-IM_IiCjH.js`, `vendor-CRnas3xB.js`, `vendor-react-…`,
`vendor-motion-…`, `vendor-router-…`, `vendor-tanstack-…`) return **0** case-insensitive "sentry"
matches. `src/main.jsx:5` gates `Sentry.init` on `VITE_SENTRY_DSN`; unset in Vercel ⇒ dead-code
eliminated ⇒ namespace import removed. Browser crashes are unreported in prod. Medium apt.

### A09-006 — render.yaml has drifted from the live service — **CONFIRMED**
`mcp__render__get_service srv-d8bc20mgvqtc73afh16g` → `buildCommand: "npm ci && npm run build:api &&
npm prune --omit=dev"` (live) vs `render.yaml:23` `npm ci --include=dev && …` (blueprint drops
`--include=dev`); live `buildPlan: "starter"` and `cache.profile: "no-cache"` are undeclared in
render.yaml. Disaster-recovery doc ("recreate from render.yaml") would produce a different service.
Medium apt.

### A09-007 — Keepalive fires ~⅓ as often as its stated rationale — **CONFIRMED**
Last 200 keepalive runs: all `success`; inter-run gaps min 13.8 / median 33.9 / mean 37.1 / max
114.2 min; **0** gaps ≤10 min, only 5 of 199 <15 min. The workflow's claim that "two jittered fires
stay <15 min apart" holds for ~2.5% of intervals. Monitoring resolution is capped at up to ~114 min;
correctly medium (does not currently cause Render spin-down).

---

## Verdict table
| id | severity | verdict |
|---|---|---|
| A09-001 | high | CONFIRMED |
| A09-002 | high | CONFIRMED |
| A09-003 | high | CONFIRMED |
| A09-004 | medium | CONFIRMED (spot-check) |
| A09-005 | medium | CONFIRMED (spot-check) |
| A09-006 | medium | CONFIRMED (spot-check) |
| A09-007 | medium | CONFIRMED (spot-check) |

No writes were made to any DB. No fixtures created. Seed script read only (G4).
