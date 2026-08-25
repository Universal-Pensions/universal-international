> **Agent guide.** The operational runbook for the `uganda-dashboard-api` backend on Render (free tier, Singapore) — deploy triggers, env, cold-start behaviour, and the incident playbook. Read it when deploying or debugging the hosted API (Render is manual-deploy: `npm run deploy:api`), not for application logic. For the code itself see `BACKEND.md`; start from `CLAUDE.md`.
>
> **Verified against the live Singapore DB (`ilkhfnoyxlxwqadebnkp`) on 2026-08-25.**

# Render Operational Notes

Operational runbook for the `uganda-dashboard-api` service on Render (free tier, Singapore region). Authored during Phase 3 of the Render migration. The plan doc and pre-audit findings file this line used to cite (`~/.claude/plans/dynamic-sparking-kite.md`, `~/Desktop/renderaudit-findings.md`) no longer exist on disk (audit A26-013); for current audit records see `docs/audits/2026-08-23/` (`findings.json` plus the long-form `09-infra-deploy.md`, `21-performance.md`, `26-documentation.md`) (B6, B7, B14, B15, B21, G5, G14, G15, G41, G59, G60, G61, G62, G63, G64, N27).

---

## Service Topology

- **Frontend:** Vercel (Vite + React SPA) — `uganda-dashboard-*.vercel.app`.
- **Backend:** Render web service (Node 22, Express 5) — `uganda-dashboard-api.onrender.com` (hostname confirmed after service creation).
- **Database:** Supabase (`ap-southeast-1`, **Singapore** — new project, cutover **2026-06-05**; was `ap-northeast-1` Tokyo before). Render is also in Singapore, so backend and Postgres are now **co-located in the same region** (intra-region RTT, ~1–5ms).
- **Wake:** GHA cron pings `/readyz` every 10 min **as configured** — real-world scheduler jitter widens the *measured* median gap to ~35 min (max observed ~103–114 min); see "Free-tier Resource Caps" below and **open finding A09-007 (unowned)** — + cron-job.org/UptimeRobot (5 min backup) + frontend `useWarmup()` ping.

---

## Manual Deploy Procedure (G63)

Auto-deploy is **off** by design (`autoDeployTrigger: off` on `uganda-dashboard-api`, branch `main`, region Singapore, plan free; mirrors CLAUDE.md §1 guardrail). Every deploy is manual. Two supported paths:

1. **`npm run deploy:api`** (preferred for agents / CI). Wraps `scripts/render-deploy.mjs`, which POSTs the `RENDER_DEPLOY_HOOK` value from `.env.local`. The hook deploys whatever commit is at the tip of the service's tracked branch (`main`). Setup is one-time:
   - Render dashboard → service → **Settings** → **Deploy Hook** → copy the URL.
   - Add to `.env.local` (gitignored): `RENDER_DEPLOY_HOOK=https://api.render.com/deploy/srv-...?key=...`.
   - Treat the URL as a deploy-only secret (it can only kick a deploy of this one service — smallest blast radius). The script validates the URL shape and prints the returned deploy id; track it via Render → Events or the Render MCP `list_deploys`/`get_deploy`.
   - Equivalent raw call if you don't want the script: `curl -X POST "$RENDER_DEPLOY_HOOK"`.
2. **From the Render dashboard:** `uganda-dashboard-api` → **Manual Deploy** → **Deploy latest commit**.

The frontend (Vercel) is the opposite posture — it **auto-deploys** on merge to `main` via the GitHub App; only the Render backend is manual.

### Cutover pre-deploy checklist (`feat/simplify-commissions` → `main`)

Before the first post-cutover manual deploy, confirm:

1. **Render tracks `main` (BL-7).** `render.yaml:19` is now `branch: main` (was `cleanup/post-audit-2026-05-26`). Confirm in the Render dashboard that the service's tracked branch is `main`, otherwise "Deploy latest commit" ships the stale branch. Keep `autoDeployTrigger: off`.
2. **Live DB schema applied first, ledger NOT pushed blindly (BL-6).** Apply schema to live via the Supabase MCP path (`mcp__supabase__apply_migration` / `execute_sql`), **not** `supabase db push`. ⚠️ **The ledger and the files are structurally unjoinable, not just "behind."** The live `schema_migrations` ledger versions rows as TIMESTAMPS (head `20260811100047 → 0108_nominee_claims_seed`, 96 rows as of 2026-08-25) while the migration files are named `0001_*`–`0126_*` (120 files on disk as of the same date) — the two namespaces share **no key**, so a filename-prefix diff against the ledger is meaningless ("missing N migrations" is not a fact this ledger can support; confirm applied state per-migration by introspecting live objects instead). `0003`/`0006`/`0010`/`0025` also contain non-idempotent statements that would error on a blind re-push. See `BACKEND.md §16 → "Migration-ledger drift"`. Take and verify a full backup before touching the live ledger (pairs with the lossy `0029.down.sql` gate).
3. **Sequence:** DB schema apply → verify → Vercel frontend + Render backend deploy (DB contract first).
4. **Re-enable the gated settlement E2E — DONE at cutover, one item still open.** The outer `describe.fixme`/`skip` on `e2e/specs/flows/distributor-apply-settlement.spec.ts` was removed once `0032` went live (2026-06-05); that file is the canonical live E2E coverage for the settlement path (audit A26-013 confirmed this against the current tree 2026-08-23). **Open TODO, not migration-gated:** one `test.fixme` still stands at `distributor-apply-settlement.spec.ts:426` — the nonce-idempotency assertion ("re-submitting the same upload nonce records no second batch") has a placeholder body (`expect(true).toBe(true)`) because the UI replay vehicle isn't wired yet, not because `0032` is missing. Enable it once a real replay path exists (a second confirm against a reopened modal carrying the same nonce, or a service-level replay with the captured nonce), asserting `settlement_batches` gains exactly one row across both submits.

---

## Deploy-time Outage Window (G62)

Render's free tier has **no rolling deploys**. Each deploy follows this sequence:

1. Build runs on Render's builder.
2. New container starts; passes the `/healthz` check.
3. Old container is killed and traffic switches.

Between step 2 and 3 there's a **30–60s window of 502s** as the old container drains and the new one warms up. **Do not deploy during a live sales pitch.** Schedule deploys in off-hours or coordinate with the team.

---

## Free-tier Resource Caps (N27)

- **Instance hours:** 750/month free. The GHA keepalive is **configured** for `*/10 * * * *` (10 min, not 14) — if it fired exactly on schedule that would keep the service continuously warm (~720h/mo, under the cap with headroom). In practice, GitHub Actions cron jitter means the **measured** median gap between runs is ~35 min (max observed ~103–114 min across two audit samples), well past Render's 15-min free-tier spin-down window — yet the service has shown an unbroken memory series with no observed spin-down, so something beyond the GHA cron alone (real demo traffic, the frontend `useWarmup()` ping) appears to be the thing actually keeping it warm. The gap between the configured and measured cadence is tracked as **open finding A09-007 (unowned)** — treat "~720h/mo" as a configured-case estimate, not a verified one.
- **Memory:** 512MB ceiling. The current handler set + Express + Supabase client stays well under this in normal use; sustained spikes above ~400MB RSS suggest a leak (see "Silent-failure modes" below).
- **CPU:** shared (0.1 vCPU). Password hashing uses pure-JS **`bcryptjs`** (cost 10) via the async API in `api/auth/_lib/password.ts` — a native `bcrypt` swap was considered (audit B17) but **not adopted**; the event-loop exposure is mitigated by the async hashing + rate limiters on the credential routes rather than a native binding.

---

## Log Retention (G60)

Render free tier rotates logs after **~7 days**. The Render dashboard log viewer only shows the most recent window. If 7-day retention is unacceptable:

- **Axiom** (free: 500GB/mo, 30-day retention) — configure as a Render log drain.
- **Better Stack** (free: 1GB, 3-day retention) — same.
- Both ingest Render's logs via the **Log Streams** feature in the Render dashboard.

For this demo project, 7-day retention is acceptable; revisit if we move past sales-rep demos.

---

## Failure Alerting (G59)

- **GHA keepalive failures** → GitHub will email the workflow file owner on failure. Verify by triggering `workflow_dispatch` on `keepalive.yml`.
- **cron-job.org / UptimeRobot** → both support free email-on-failure. Configure for the 5-min backup pinger; alert addresses should be the on-call rotation.
- **Deploy notifications** (G61) → wire a Slack webhook from the Render dashboard → Settings → Notifications. Optional but recommended; mute during deploy waves.

---

## Silent-failure Recovery Procedures (G64)

These are the 3 documented failure modes where Render keeps running but the symptom is invisible without monitoring:

### 1. `npm ci` deploy failure

**Symptom:** new commit pushed, but the dashboard shows the previous commit still running.
**What happened:** the build step failed; Render keeps the last successful deploy live. You will get a single email from Render.
**Recovery:**
- Open the failed deploy in the dashboard → **Logs** → **Build logs**.
- Fix the root cause (lock-file drift, missing dep, native module compile error).
- Re-trigger the deploy via the dashboard or deploy hook.

### 2. Event-loop blocked by synchronous bcrypt under attack

**Symptom:** users report sign-in hanging; healthcheck eventually times out; Render auto-restarts the container.
**What happened:** a flood of sign-in attempts (or any synchronous CPU-bound work) starved the event loop on the 0.1 vCPU. The `/healthz` probe couldn't get a tick; Render killed the process.
**Recovery:**
- Confirm via Render logs: look for `SIGTERM` followed by a fresh boot line.
- If Sentry is wired, the surge will show up there too.
- Mitigation in place: **`bcryptjs`** async hashing (cost 10, non-blocking) + rate limiters on the 4 high-risk routes (audit G18). Native `bcrypt` was NOT adopted (see §1). If event-loop blocking recurs, add an `express-slow-down` layer, move hashing to a worker thread, or adopt native `bcrypt`.

### 3. 512MB OOM ceiling

**Symptom:** process crashes mid-request; container restarts; intermittent 502s.
**What happened:** memory grew past 512MB and the OS killed the process. Common causes: large response buffering, leaked Supabase clients, unbounded in-memory caches.
**Recovery:**
- Render dashboard → **Metrics** → check the memory chart for the crash window.
- If RSS climbs monotonically over hours, suspect a leak; capture a heap snapshot locally with `node --inspect dist-server/server/index.js` and reproduce.
- Verify `auth.persistSession: false` on the Supabase admin client (audit G66) — sessions retained in memory across requests are a common leak source under a long-lived process.

---

## ⚠️ The live service has drifted from `render.yaml` (A09-006)

**Verified 2026-08-25 via the Render API.** The blueprint is NOT what is deployed.

| | build command |
|---|---|
| `render.yaml` says | `npm ci **--include=dev** && npm run build:api && npm prune --omit=dev` |
| the live service runs | `npm ci && npm run build:api && npm prune --omit=dev` |

`--include=dev` is missing. That matters because `NODE_ENV: production` IS set on the service, and
npm honours it by skipping devDependencies — which would drop `@types/*`, `@vercel/node` and
`tsx`, all of which `npm run build:api` needs to **compile**. (`npm prune --omit=dev` then removes
them again afterwards, which is the point: needed to build, not to run.)

It builds today, so this is a latent failure rather than a live one. The real cost is the one the
finding names: **a blueprint-driven rebuild would not reproduce the running service**, so the
documented disaster-recovery path rebuilds the wrong thing.

**A human must fix this — the Render API exposes no way to change a build command.**
Dashboard → `uganda-dashboard-api` → Settings → Build Command → set it to match `render.yaml`,
then redeploy and confirm `/readyz` returns 200.

Corrected while verifying: `render.yaml`'s own comment claimed "@sentry/* are devDeps". Only
**@sentry/react** is, and it is a FRONTEND package Vercel builds — not Render. **@sentry/node**,
the one this service uses, is a regular dependency and is unaffected either way.

## Rollback — see `docs/rollback.md` (A09-009)

There was no documented rollback for the frontend, the API, or the database. There is now, and it
lives in one place rather than scattered here: **`docs/rollback.md`**.

Verified rather than assumed, because the details are the part that bites:

- **Vercel** auto-deploys from `main`, so merging *is* shipping. Roll back by promoting a prior
  production deployment from the dashboard — it re-points the alias at an already-built artefact,
  so it cannot fail on a build error. The `vercel` CLI is **not** installed on the maintainer's
  machine, so the dashboard route is primary.
- **Render** does NOT auto-deploy (`autoDeployTrigger: off`). Roll back from the dashboard.
  ⚠️ **`npm run deploy:api` only moves FORWARD** — it builds from the current branch. It is not
  an undo, and reaching for it as one ships whatever is in the tree.
- **Migrations: 22 are forward-only** and cannot be reverted by file. They are numbered
  ≤ 0028; every migration from 0029 up has a `.down.sql`. (The exact list is in
  `docs/rollback.md`. Note that "≤0028" is an upper bound, not a rule — 0016 and 0022–0026 *do*
  have downs.)
- ⚠️ **Four down-migrations are booby-trapped.** `0042`, `0043`, `0072` and `0089` each replace
  `trg_transactions_contribution` with a body hardcoding `v_unit_price := 1000`, silently
  reverting NAV pricing and corrupting every subsequent contribution. Each now carries a guard
  header. Read it before running the file.
- **Data**: the free tier has **no point-in-time recovery**. A `pg_dump` you have actually
  restored is the only safety net. The restore drill is proven and recorded at
  `docs/audits/2026-08-23/a25/restore-drill.md` — 37 tables, 99,265 rows, byte-identical
  manifest. Note it needs an `auth` schema stub or 108 RLS policies silently fail to restore,
  leaving the data present with row-level security quietly missing.

## Provisioning Checklist

Follow this when ready to create the Render service. **Do not run the MCP calls until each step's question is answered.**

1. **Select Render workspace** — assistant will guide via `mcp__render__list_workspaces` then `mcp__render__select_workspace`. Confirm which workspace the service should live in (personal vs team).
2. **Confirm region** — Singapore. **This is IMMUTABLE after service creation.** If Supabase ever moves to a different region, the service must be recreated. (The 2026-06-05 Supabase move from Tokyo → Singapore happened to land in Render's existing region, so no recreation was needed — backend and DB are now co-located.)
3. **Have `SUPABASE_JWT_SECRET` on hand** — copy verbatim from the existing Vercel project's env settings (or from Supabase dashboard → API → JWT Settings). **Do NOT regenerate** during migration (audit B21) — rotating it silently fails-open under `withOptionalAuth`.
4. **Approve `mcp__render__create_web_service`** — the call uses the `render.yaml` blueprint as input; the user confirms before execution.
5. **Inject secrets via `mcp__render__update_environment_variables`** — set the 4 sync-false vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SENTRY_DSN` (SENTRY_DSN may be left empty for the first deploy; wire it in Phase 5).
6. **First manual deploy** — Render dashboard → service → **Manual Deploy** → **Deploy latest commit**, or `npm run deploy:api` (POSTs `RENDER_DEPLOY_HOOK` from `.env.local`; see §Manual Deploy Procedure).

After step 6, confirm:
- Deploy logs show `[boot] env ok: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET` (audit G5).
- `curl https://<host>/healthz` returns 200 within 5s of cold start (audit G16).
- Latency floor test (audit G41): `time curl -X POST https://<host>/api/auth/send-otp ...` returns in <500ms warm.
- Render dashboard confirms the region is **Singapore** before any traffic is promoted.

---

## Verification: authenticated read (B22)

`/healthz` and `POST /api/auth/send-otp` both pass even with a wrong `SUPABASE_JWT_SECRET` — `send-otp` mints no token, and `withOptionalAuth` swallows verification failures silently. The first symptom of a broken secret is the dashboard returning anonymous-fallback data days later, in front of a customer.

Run this **after** the first deploy:

1. `POST /api/auth/verify-otp` with a seeded demo phone (e.g. `+25671 100 0001`, role `subscriber`, any 6-digit OTP). Capture the returned JWT.
2. Decode the JWT (e.g. `jwt.io`); confirm `sub`, `app_role`, `phone`, and the role-scoped ID (`subscriberId`/`agentId`/`branchId`/`distributorId`) are present and non-empty.
3. Call one role-scoped endpoint with the JWT:
   ```sh
   curl -X POST https://uganda-dashboard-api.onrender.com/api/chat \
     -H "authorization: Bearer <jwt>" \
     -H "content-type: application/json" \
     -d '{"message":"my balance"}'
   ```
   The reply should be role-aware (subscriber-flavoured copy, not the anonymous fallback).
4. Cross-check Supabase logs via `mcp__supabase__get_logs` for absence of `PGRST301` — this is the only way to catch a wrong `SUPABASE_JWT_SECRET`; a fail-open mismatch can otherwise stay invisible for days.

If any step fails: confirm the value in the Render dashboard env exactly matches Supabase Dashboard → API → JWT Settings → JWT Secret (no leading/trailing whitespace, no quoting). Restart the Render service after updating.

---

## JWT secret rotation (G42)

`api/_lib/jwt.ts:59-72` caches the secret as `Uint8Array` for the lifetime of the Node process. Render does **not** hot-reload env vars — updating a secret in the dashboard alone has no effect until the process restarts.

Procedure:

1. **Supabase Dashboard** → Project Settings → API → JWT Settings → Rotate.
2. **Render Dashboard** → `uganda-dashboard-api` → Environment → update `SUPABASE_JWT_SECRET` to the new value (paste verbatim).
3. **Trigger a restart** — Manual Deploy → "Deploy latest commit", or `npm run deploy:api` (POSTs `RENDER_DEPLOY_HOOK`). (Saving an env var alone does NOT redeploy the service.)
4. **Accept the user impact** — every existing 24h-TTL token becomes invalid immediately. All sessions are forced to re-login. Plan rotations for off-hours.

The Vercel project no longer holds this secret post-migration; nothing to update there.

---

## Bandwidth & instance-hour budget (N40, N41)

| Metric | Free-tier cap | Actual demo workload | Headroom |
|---|---|---|---|
| Instance hours | 750/month | ~720/mo *configured* (10-min keepalive + 24/7 wake) — measured cadence drifts well past this; see "Free-tier Resource Caps" above and open finding A09-007 | ~30h/mo, **unverified** |
| Bandwidth | 100 GB/month | ~250KB per demo session × ~1000 demos/mo ≈ 250 MB/mo | ~99.7 GB |
| Build minutes | 500/month | ~3 min cold deploy, ~2 min cached (N41) | Routine deploys far under cap |

The keepalive is **configured** to stay just under the 750h cap; its measured cadence drifts well past that design margin (open finding A09-007, unowned — see "Free-tier Resource Caps" above), so the ~30h/mo instance-hour headroom is a configured-case estimate, not a verified one. The bandwidth cap is effectively unbounded for the demo workload. Build cache (keyed by `package-lock.json` hash) cuts routine deploy time from ~5–7 min cold to ~2–3 min cached (N41).

---

## Render outage response — pre-canned customer message (N43)

If `status.render.com` shows an active incident mid-pitch, the demo will surface as a 502, a `network_unreachable` error, or a hang. The free-tier outage history is acceptable for a demo platform, but a customer-facing answer matters.

**Suggested message to read out:**

> "Apologies — our backend hosting provider (Render.com) is currently experiencing an incident affecting all customers in this region. Their status page at status.render.com shows it as a known issue and they're working to resolve it now. Our platform itself is healthy; this is purely a hosting-layer disruption. Would you like to reschedule the demo, or shall I walk you through the slide deck while we wait?"

Internal protocol:

- Screenshot the Render status page for the post-mortem.
- Confirm with the team in Slack that the outage is not project-specific (i.e. all our other services on Render are affected too).
- Resume the demo as soon as `/healthz` returns 200 — and pre-warm via the GHA `keepalive.yml` `workflow_dispatch` if the wake pingers are also affected.

---

## Backend is stateless — recovery = redeploy (N39)

`grep -rn 'fs\.\|writeFile\|sqlite' api/ server/` returns nothing. The Express process holds no disk state, no in-memory accumulators (audit N36), and no module-level mutable caches beyond the JWT key bytes (which are cached per process, not persisted).

**Recovery model:** the canonical source of truth is git. If the Render service is destroyed (manual or otherwise), recovery is:

1. Re-run the Provisioning Checklist (above) — recreate the service from `render.yaml`.
2. Re-paste the 4 sync-false env vars from the team password manager.
3. Manual deploy from the desired commit.

No database backup, no log replay, no warm-start cache. Acceptable for a demo platform; document if the role of this service ever expands.

---

## `/metrics` Prometheus endpoint — explicitly deferred (N42)

This service does **not** expose a `/metrics` endpoint, and we are not planning to. The reasoning:

- The demo workload is < 1 req/s; per-route latency and success-rate visibility from morgan access logs + the Render dashboard's process-level CPU/memory chart is sufficient.
- A Prometheus scrape target needs an authenticated egress path or a public exposure decision; both add operational surface for negligible benefit at this scale.
- Sentry covers exception aggregation (audit G58, G69). morgan covers the access log (audit G68's explicit format token).

If this service ever moves past sales-rep demos, revisit by adding `prom-client` and gating `/metrics` behind a static auth header. For now: documented "no" so the question isn't reopened.
