> **Agent guide.** Historical audit from 2026-05-31, covering infra, deploy, config, build scripts and the top-level docs — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 07 — Infra, Deploy, Config, Scripts & Docs (Phase 1, Agent G)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (auditing the **working tree**, not committed `main`)
**Agent:** Agent G — Infra, Deploy, Config, Scripts & Docs. READ-ONLY.
**Scope:** `vite.config.js`, `vercel.json`, `render.yaml`, `eslint.config.js`, `.env.local.example`, `.npmrc`, `.node-version`, `.vercelignore`, `package.json`, `server/tsconfig.json`, `api/tsconfig.json`, `scripts/` (incl. `backups/`), `supabase/config.toml`, `.github/workflows/{test,keepalive}.yml`, and all top-level docs (`CLAUDE.md`/`claude.md`, `FRONTEND.md`, `BACKEND.md`, `ARCHITECTURE.md`, `README.md`, `docs/*`).

This report applies the Phase-0 baseline (`00-baseline.md`) seed signals SEED-G1/G2/G3/G4 and the §10a demo-scope guardrail. Demo-scope items (mock OTP/KYC, hardcoded UGX 1000, fixed 24h JWT, demo_personas fallbacks, in-memory tickets/chat, 30s notification polling, per-session stores, no payment processor) are **not** reported as bugs.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 4 |
| **Total** | **11** |

| Classification | Count |
|---|---|
| real-bug | 1 |
| quality/tech-debt | 6 |
| intentional-demo-scope | 0 |
| already-known | 4 |

**Cutover blockers (go/no-go before `feat/simplify-commissions` → `main`):**
1. **G-01** — `render.yaml` `branch: cleanup/post-audit-2026-05-26` must be swapped to `main` (or the Render service re-pointed) before/at cutover, else the manual Render deploy ships the wrong tree.
2. **G-02** — The release is a large **uncommitted + 14-file-untracked** unit (incl. the 3 new migrations) that auto-deploys Vercel on push to `main`; it must be committed as a coherent unit and the DB-vs-frontend ordering verified first.
3. **G-03** — `0029.down.sql` is destructive/irreversible (DB-owned, cross-referenced from `01-database.md` SEED-A1): a verified prod backup must precede the cutover. *(Infra/release-process gate; DB substance owned by Agent A.)*

---

## High

### G-01 — `render.yaml` deploys from `cleanup/post-audit-2026-05-26`, not `main`
- **Classification:** already-known (self-documented in `render.yaml`) — but an **active cutover blocker**
- **Severity:** High
- **Evidence:** `render.yaml:19` — `branch: cleanup/post-audit-2026-05-26 # G14, swap to main after cutover`
- **Impact:** The Render backend service builds and deploys from the `cleanup/post-audit-2026-05-26` branch. The current work is on `feat/simplify-commissions` and the intended destination is `main`. After the cutover, a **manual** Render deploy ("Deploy latest commit") would build the *stale* `cleanup/...` branch — shipping a backend that may not match the new frontend/DB contract (e.g. the `apply_settlement` / `mark_notifications_read` RPC call sites are DB-side, but any server-side contract drift would ship from the wrong tree). Because `autoDeployTrigger: off` (`render.yaml:20`), nothing auto-corrects this; it is a silent footgun on the next manual deploy.
- **Recommendation:** As part of the cutover runbook, swap `render.yaml:19` to `branch: main` (in the same PR that merges to `main`), then confirm in the Render dashboard that the service's tracked branch is `main` before the first post-cutover manual deploy. Keep `autoDeployTrigger: off`. The render.yaml comment block already flags this (G14) — treat it as a checklist item, not a deferred note.

### G-02 — Large uncommitted/untracked release unit auto-deploys Vercel on push to `main`
- **Classification:** quality/tech-debt (release hygiene)
- **Severity:** High
- **Evidence:** `git status --porcelain` — 42 modified (incl. `package.json`, `package-lock.json`, `vite.config.js`, 8 docs, `scripts/seed-supabase.mjs`), 4 deleted (`BranchSettlementBanner.{jsx,module.css}`, `settlementCycle.{js,test.js}`), and **14 untracked source paths** that form the feature: `supabase/migrations/0029_*`, `0030_*`, `0031_*` (+ `.down.sql`), `src/services/notifications.js`, `src/hooks/useNotifications.js`, `src/components/notifications/` (4 files), `src/utils/{settlement,commissionMonths,xlsx}.js`, `src/agent-dashboard/shell/AgentHeaderChrome.{jsx,module.css}`, plus their tests. Only **1 commit** is ahead of `origin/main` (`d189dd6`, a 12-line nav fix) — the entire commission→settlement→notification feature is **not committed**.
- **Impact:** Pushing to `main` auto-deploys the Vercel frontend (CLAUDE.md §1). The release is coherent in *intent* but currently exists only as working-tree state: if any untracked file is missed by `git add` (e.g. the `src/components/notifications/` directory or a `.module.css`), the build either fails or silently ships a half-feature. The new feature also imports `xlsx` lazily and references new utils that, if partially staged, break the distributor settlement flow. There is no single commit that can be reviewed/reverted as a unit.
- **Recommendation:** Before cutover, stage the full set as one coherent commit (verify `git status` is clean afterward and `npm run build` + `npm run build:api` + `npm test` pass on the committed tree, not just the dirty working tree). Confirm no untracked source file is left behind (`git status --porcelain` shows only `docs/audit-2026-05-31/` as untracked). Sequence the DB migration apply and the Vercel deploy explicitly (DB first — see G-03 and `01-database.md`).

---

## Medium

### G-04 — `npm run lint` (`eslint .`) fails (572 errors) on the gitignored `playwright-report/` artifacts
- **Classification:** quality/tech-debt (config) — NEW (distinct from the already-fixed `.claude/worktrees/` item)
- **Severity:** Medium
- **Evidence:** `package.json:17` (`"lint": "eslint ."`); `eslint.config.js:8` — `globalIgnores(['dist', 'dist-server', 'coverage', '.claude/worktrees/**'])` does **not** include `playwright-report/`. `.gitignore:45` *does* gitignore `playwright-report/`, but ESLint does not honor `.gitignore`. Reproduced: `npx eslint .` → `574 problems (572 errors, 2 warnings)`, with errors originating from `playwright-report/trace/*.js` vendor artifacts (confirmed: grep matches `playwright-report` in the error stream). `npx eslint 'src/**/*.{js,jsx}'` → `0 errors, 2 warnings` (clean source).
- **Impact:** Any developer (or local pre-push check) that runs `npm run lint` with a `playwright-report/` directory present (generated by `npm run test:e2e`) gets a **false exit-1 failure** masking the real source state. This contradicts `CLAUDE.md §3` ("0 errors expected"). CI's `lint-and-unit` job (`test.yml:61-62`) currently survives only because it does a fresh `actions/checkout@v4` with no report present at lint time — a fragile insulation: if lint ordering ever changes or an artifact is checked out, CI breaks.
- **Recommendation:** Add `'playwright-report/**'` (and `'test-results/**'`) to `globalIgnores` in `eslint.config.js:8` so the lint script's scope matches `.gitignore`. One-line fix.

### G-05 — Tracked file is `claude.md` (lowercase); no `CLAUDE.md` exists in the git index
- **Classification:** quality/tech-debt — NEW (SEED-G3)
- **Severity:** Medium
- **Evidence:** `git ls-files | grep -i claude.md` → returns only `claude.md` (lowercase). On disk, `ls -lai claude.md CLAUDE.md` shows both names resolving to the **same inode** (`21577157`) because macOS APFS is case-insensitive. `git status` shows ` M claude.md` (the lowercase tracked path) is modified.
- **Impact:** All references in code/docs and in the audit plan say `CLAUDE.md`. On a **case-sensitive** filesystem (Linux: Vercel build, Render build, GitHub Actions runners, and any Linux contributor checkout) the repo contains `claude.md` only — a tool or doc link expecting `CLAUDE.md` would 404. It is also a latent rename hazard: if anyone commits a file genuinely named `CLAUDE.md` from a case-sensitive host, the repo ends up with two distinct files that silently merge/collide on macOS. No build currently consumes `CLAUDE.md` at runtime, so impact is limited to tooling/doc-link correctness and contributor confusion.
- **Recommendation:** Decide on one canonical casing and rename via `git mv claude.md CLAUDE.md` (git tracks the case change explicitly; on macOS use the two-step `git mv claude.md claude.tmp && git mv claude.tmp CLAUDE.md` if the rename is a no-op). The convention everywhere else (and the GitHub special-file convention) is `CLAUDE.md`.

### G-06 — Migration ledger drift: 6 local migrations absent from live `schema_migrations` → `supabase db push` collision risk
- **Classification:** quality/tech-debt — NEW for infra (SEED-A7/G4; DB substance co-owned by `01-database.md`)
- **Severity:** Medium
- **Evidence:** Per `00-baseline.md §5.2`: live `supabase_migrations.schema_migrations` has 25 rows; **0022/0023/0024/0025/0027/0028** are present as local files but **missing** from the live ledger (their *effects* are applied out-of-band). The new trio `0029/0030/0031` **is** recorded in live history. `supabase/config.toml:53-55` sets `[db.migrations] enabled = true`.
- **Impact:** A future `supabase db push` (the documented "push migrations to hosted" path, `BACKEND.md §16`) would attempt to re-run the 6 missing migrations because the ledger doesn't record them. Whether that succeeds depends entirely on each migration's idempotency (known gaps in `0003/0006/0010/0025` per `BACKEND.md §15b` audit D12) — a non-idempotent re-run would error or double-apply. This is an operational deploy hazard, not a runtime defect.
- **Recommendation:** Do **not** run `supabase db push` against live without first reconciling the ledger (insert the missing rows via `supabase migration repair` or document that live is managed by `scripts/seed-supabase.mjs` + direct SQL and that `db push` is not the deploy path). Capture the canonical "how migrations reach live" decision in `BACKEND.md §16`. The audited trio is unaffected (already ledger-tracked).

### G-07 — `supabase/config.toml` references `./seed.sql` that does not exist
- **Classification:** quality/tech-debt — already-known framing (Agent A scope §59), confirmed here
- **Severity:** Medium
- **Evidence:** `supabase/config.toml:63-65` — `[db.seed] enabled = true`, `sql_paths = ["./seed.sql"]`. `ls supabase/seed.sql` → no such file; `ls supabase/seeds/` → no such dir. Seeding actually runs via `scripts/seed-supabase.mjs` (`package.json:27` `"seed": "node scripts/seed-supabase.mjs"`).
- **Impact:** A `supabase db reset` (documented in `BACKEND.md §16` as the local "apply migrations" command) runs seeds after migrations and would fail or warn on the missing `./seed.sql` because `[db.seed].enabled = true`. The real seed path (the `.mjs` script reading `SUPABASE_DB_URL`) is disconnected from the CLI's seed config, so a developer following the config.toml convention is misled. Local-emulator-only — no production impact.
- **Recommendation:** Either set `[db.seed] enabled = false` (since seeding is script-driven, not CLI-driven) or `sql_paths = []`, and add a one-line comment pointing to `scripts/seed-supabase.mjs`. Document the divergence in `BACKEND.md §16`.

### G-08 — Doc drift: `README.md` not updated in lockstep with 0029–0031 (says "28 migrations", "9-step" / stale awareness note in `claude.md`)
- **Classification:** quality/tech-debt (CLAUDE.md §11 doc-maintenance) — NEW
- **Severity:** Medium
- **Evidence:**
  - `README.md` is **clean / unmodified** in the working tree (`git status --porcelain README.md` empty; last touched in commit `4f9614e`, 2026-05-26 — before the 0029–0031 work). It states "**28 migrations**" twice (`README.md:28`, `README.md:90`) while there are **31** forward migration files; and "9-step subscriber onboarding" (`README.md:14`).
  - `claude.md:191` (working-tree, in the §10b awareness list) still reads "**README.md is stale — currently 87 lines … claims 'Vite 8' (actually Vite 6.3)**", but README is now **121 lines** and correctly says "Vite 6.3.5" (`README.md:20`). The awareness note describing README is itself stale.
- **Impact:** Violates CLAUDE.md §11 ("update FRONTEND.md/BACKEND.md in the same commit when you add a migration…"). The *specialist* docs were updated in lockstep (see positive note below), but README and the README-staleness awareness note were not, leaving contradictory migration counts (28 vs 31) and a self-referential stale note. Low functional impact (docs only), but undermines the §11 discipline that the audit treats as a criterion.
- **Recommendation:** Refresh `README.md` migration count (28→31) and onboarding-step language; update or delete the `claude.md:191` awareness bullet (README is no longer 87 lines / "Vite 8"). Fold into the same commit as the feature (G-02).

---

## Low

### G-09 — `keepalive.yml` pings a hardcoded placeholder Render hostname
- **Classification:** quality/tech-debt — already-known (self-documented)
- **Severity:** Low
- **Evidence:** `.github/workflows/keepalive.yml:8-11` (comment: "the hostname below is a placeholder … Update this URL in a follow-up commit once the actual service hostname is confirmed") and `:29` `curl … "https://uganda-dashboard-api.onrender.com/healthz"`.
- **Impact:** If Render appended a hash suffix to the service name (because `uganda-dashboard-api` was taken), the keepalive cron pings a non-existent host, fails every 14 min, emails the workflow owner, and the free-tier backend cold-starts on the first real demo request (30–60s spin-up per `docs/render-operational.md:34`). The cron-job.org/UptimeRobot 5-min backup mitigates. No correctness impact, only warm-start reliability + alert noise.
- **Recommendation:** Confirm the live Render hostname in the dashboard and update `keepalive.yml:29` (the comment already flags this). Low priority for a demo.

### G-10 — `vercel` CLI is an unused devDependency (supply-chain surface; deploys use the GitHub App)
- **Classification:** quality/tech-debt — overlaps `08-deps-observability.md` (SEED-H3); flagged here for the env/config angle
- **Severity:** Low (awareness)
- **Evidence:** `package.json:82` `"vercel": "^54.0.0"`. No invocation in `.github/workflows/*` or `scripts/*` (`grep` for `vercel deploy|build|env|--` → none). `test.yml:15-17` explicitly states frontend auto-deploys are driven by the **Vercel GitHub App**, not GHA/CLI. `@vercel/node` (`package.json:69`) **is** used (api handler types) — keep it.
- **Impact:** Per `00-baseline.md §2.1`, ~25 of the 37 `npm audit` vulns are transitive under the `vercel` CLI tree. The CLI is never invoked in this repo's automation. Removing it would eliminate most of the audit surface with no functional loss. (Note: CLAUDE.md §7 forbids `vercel env pull`, but that does not require the CLI to be a project dependency — it can be run via `npx` if ever needed.)
- **Recommendation:** Evaluate dropping `vercel` from devDependencies (defer the exploitability/decision to `08-deps-observability.md`, which owns supply-chain). Do **not** remove `@vercel/node`.

### G-11 — `SUPABASE_JWT_SECRET` mismatch fails open to anonymous on the one `withOptionalAuth` route
- **Classification:** already-known (documented in `render.yaml` B21 + `render-operational.md`)
- **Severity:** Low (awareness; demo-scoped impact)
- **Evidence:** `render.yaml:9-11,37` warn the secret "MUST be copied verbatim … Rotating it during the migration silently fails-open under withOptionalAuth (audit B21)." `api/_lib/withOptionalAuth.ts:27-30` swallows verify errors (`catch { maybeReq.user = null }`). `api/_lib/jwt.ts:110-119` `verifyJwt` throws on signature/secret mismatch. `server/env.ts:assertServerEnv()` only checks **presence**, not correctness, of `SUPABASE_JWT_SECRET`.
- **Impact:** If the Render `SUPABASE_JWT_SECRET` does not match the value Supabase uses, two things happen: (a) the `/api/chat` route (the only `withOptionalAuth` consumer) silently treats every signed-in user as anonymous (degraded chat personalization, not a security hole — it fails *closed* on data access), and (b) server-minted JWTs are rejected by PostgREST (`PGRST301`), so all RLS-scoped reads/writes fail. `assertServerEnv` cannot catch a *wrong* secret, only a missing one. This is intrinsic to the custom-HS256 design and already documented; for the demo it surfaces as "logins succeed but data is empty / chat is generic."
- **Recommendation:** Treat "copy `SUPABASE_JWT_SECRET` verbatim from Supabase → API → JWT Settings" as a hard checklist line in the cutover runbook (it already is in `render.yaml`). Optionally add a boot-time self-test that signs+verifies a throwaway token in `assertServerEnv()` to catch a malformed (not just missing) secret early. No change to demo scope.

### G-12 — `supabase/config.toml` `jwt_expiry = 3600` / `minimum_password_length = 6` diverge from the app's real auth — confirm intentional (local-emulator-only)
- **Classification:** quality/tech-debt (low; confirm-intentional)
- **Severity:** Low
- **Evidence:** `supabase/config.toml:160` `jwt_expiry = 3600` (1h) vs the app's custom `DEFAULT_EXPIRY_SECONDS = 60*60*24` (24h) in `api/_lib/jwt.ts:55`. `config.toml:177` `minimum_password_length = 6`. `BACKEND.md §16` already notes "config.toml controls the local CLI emulator only (not the hosted project)."
- **Impact:** None in production — the app uses custom HS256 JWTs via `jose`, not Supabase GoTrue, so `config.toml [auth]` settings are inert for the deployed system. The divergence is only confusing to a reader who assumes config.toml governs auth. Documented as emulator-only in BACKEND.md.
- **Recommendation:** No change required; the BACKEND.md §16 note already covers it. Optionally add a one-line comment in `config.toml [auth]` pointing to `api/_lib/jwt.ts` as the real auth path. Listed for completeness.

---

## Positive findings (verified clean — no action)

- **Env-var split is clean (CLAUDE.md §7).** `vercel.json` contains no server secrets; `grep` for `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET` in `vercel.json`/`.vercelignore` → none. `render.yaml:33-40` carries only server keys (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SENTRY_DSN`) all `sync: false` (not committed). No `VITE_*` on Render. `src/` has no references to `SERVICE_ROLE`/`JWT_SECRET`/`SUPABASE_DB_URL` (no server-secret leakage into the client bundle).
- **No committed secrets/dumps.** Repo-wide scan for `eyJ…`/`sbp_…`/`postgresql://postgres`/service-role/JWT-secret patterns across `.mjs/.js/.ts/.json/.sql/.toml/.yml/.md/.txt` (excl. node_modules/dist) → **no matches**. `scripts/backups/pre-cleanup-2026-05-18.counts.txt` is row-count metrics only (no secrets). The two `scripts/cleanup-*.sql` files are guarded one-off ops scripts (dry-run/`ROLLBACK` first) committed for audit trail — not auto-run, no secrets. `seed-supabase.mjs`/`seed-loader.mjs` read `SUPABASE_DB_URL` from env, hardcode nothing.
- **Vercel SPA rewrite + build config are sound.** `vercel.json` `"framework": "vite"` + a single catch-all rewrite to `/index.html` (correct SPA fallback for React Router). `.vercelignore` excludes `api/`, `server/`, `dist-server/`, `*.test.ts`, `e2e/`, `playwright.config.ts` — prevents Vercel from auto-detecting `api/` as serverless functions (B9). `vite.config.js` manual chunking is well-reasoned (vendor-leaflet/charts/motion/tanstack/router/react/xlsx); `chunkSizeWarningLimit: 700`. Production `npm run build` passes with **no chunk-size warnings**; `vendor-xlsx` (429 kB) is confirmed **lazy** (`import('xlsx')` at `src/utils/xlsx.js:38,130`; not preloaded in `dist/index.html`). The `server.proxy` block is dev-only and has no effect on the Vercel build (correctly documented in-file).
- **Specialist docs WERE updated in lockstep (CLAUDE.md §11 compliance, partial).** `claude.md`, `ARCHITECTURE.md`, `BACKEND.md`, `FRONTEND.md`, `docs/{SPEC,api-contracts,data-model,role-permissions}.md` are all modified in the working tree and correctly reflect the simplified `due→paid` flow, `settlement_batches`, `notifications`, `NotificationBell`, the dropped maker-checker/dispute lifecycle, and the new `src/utils/{settlement,commissionMonths,xlsx}.js` + `notifications.js`/`useNotifications.js`. ARCHITECTURE.md:82,659 correctly says "31 migrations". The only doc gaps are README.md and the stale `claude.md:191` awareness note (see G-08), and stale TOC counts in FRONTEND.md (see below).
- **CI pipeline (`test.yml`) is well-gated.** lint+unit → e2e (gated), `--workers=1` for the shared-DB race, `concurrency` cancel-in-progress, `build:api` type-check before Render deploy, Node 22 pinned, full matrix only on push-to-main. CI secrets correctly scoped (public `VITE_*` + server `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET` for fixtures only).
- **tsconfigs are coherent.** `server/tsconfig.json` (NodeNext, emits to `dist-server`, excludes tests) matches the Render `startCommand: node dist-server/server/index.js`. `api/tsconfig.json` is `noEmit` type-check-only. `.node-version`=22 / `package.json engines.node`=`22.x` / render.yaml `NODE_VERSION`=`22` / CI `node-version: '22'` all agree.

### Minor doc nit (folded into G-08, not a separate finding)
- `FRONTEND.md` table-of-contents headers are stale: §5 says "11 files" (actual **13** services), §7 says "8 files" (actual **10** hooks). The §5/§7 *body* content correctly documents `notifications.js`/`useNotifications.js`, but the anchor/heading counts were not bumped. Cosmetic; fix alongside the README refresh.

---

## Cross-reference: already-known items (considered, not re-reported as new defects)

- `render.yaml` branch swap (G14) — surfaced as **G-01** because it is an active cutover blocker, not just a note.
- `SUPABASE_JWT_SECRET` fail-open (B21) — **G-11**, awareness only.
- `.claude/worktrees/` lint noise — **already fixed** (now in `eslint.config.js:8` globalIgnores per prior audit `docs/audit/05-static.md:13`). The `playwright-report/` lint failure (**G-04**) is a *distinct, unfixed* item.
- Idempotency gaps in `0003/0006/0010/0025` (`BACKEND.md §15b` audit D12) — referenced as the risk multiplier for **G-06**, owned by `01-database.md`.
- Lossy `0029.down.sql` (SEED-A1) — referenced as cutover blocker **G-03**; DB substance owned by `01-database.md`.
