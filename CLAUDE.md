> **Agent guide.** This is the root orientation index for the Universal Pensions Uganda codebase — read it FIRST; it carries the routing table plus the hard rules, anti-patterns, brand/security constraints, and demo-scope boundaries every change must respect. When you need file-level depth it points you (via §2) to the specialist docs under `docs/` (`FRONTEND.md`, `BACKEND.md`, `ARCHITECTURE.md`, …). Treat its Hard rules (§4) and Anti-patterns (§5) as binding, not advisory.

# CLAUDE.md — Universal Pensions Uganda

Slim entry index for this repo. Two deep specialist docs live under `docs/`: **`docs/FRONTEND.md`** (React/Vite/CSS Modules) and **`docs/BACKEND.md`** (Express on Render + Supabase + RLS). Detail lives in those two files and the rest of `docs/`; this file (at the repo root) is for orientation only.

---

## 1. Project at a glance

**Universal Pensions Uganda** is a digital long-term savings + pension platform aimed at everyday Ugandans (informal workers, gig workers, farmers, self-employed). The app in this repo is a **demo / sales-presentation tool** that sales reps walk prospects through — it is **NOT** a production fintech. Mocked OTP, mocked KYC, `demo_personas` fallback IDs, a hardcoded UGX 1,000 unit price, and a 24-hour fixed JWT are **intentional demo scope** and must not be treated as production-prep TODOs.

- **Live URL:** `uganda-dashboard.vercel.app` (auto-deploy on push to `main` — do not push without explicit approval). **Applies to both:** Vercel (frontend, automatic via the GitHub App integration) and Render (backend at `uganda-dashboard-api.onrender.com`, **manual** deploys only — `autoDeployTrigger: off` in `render.yaml`).
- **Stack:** React 19 · Vite 6 · CSS Modules (no Tailwind) · Framer Motion 12 · React Router 7 · TanStack Query 5 / Virtual 3 · Leaflet 1.9 · Recharts 3 · Express 5 on Render (Node 22, Singapore region) · Supabase Postgres (Singapore `ap-southeast-1` — **new project, cutover 2026-06-05**; replaced the old Tokyo `ap-northeast-1` project) · custom HS256 JWT via `jose`.
- **Role build status (6 of 6 built):** subscriber, agent, branch, distributor, employer, and admin are live. **Admin** (central head-office role with global rights) ships a map-theme shell at `src/admin-dashboard/` that reuses the distributor map/overlay/view panels and adds platform-wide **Distributors** and **Employers** managers (list + metrics + create). Its backend is migration `0049_admin_role` (admin `*_select_admin` RLS clones of the distributor grants + employer-family SELECT; `create_distributor` / `create_employer` / `get_all_employers_metrics` SECURITY DEFINER RPCs) — applied to the Singapore DB 2026-06-08. Admin demo login: pick **Admin** → any phone → any 6-digit code (fallback persona `admin-001`). Employer **shipped to production 2026-06-03** (merged to `main` via PR #8; Vercel frontend + Render backend deployed; desktop-first shell mirroring branch admin — see `docs/FRONTEND.md` + `docs/BACKEND.md §8`); its DB stack (migrations `0032`–`0036`) is part of the full chain on the new Singapore DB.

---

## 2. Where to read next

If you're working on… | Open this
--- | ---
A React component, hook, service, dashboard variant, signup step, commission UI, design token, accessibility rule | `docs/FRONTEND.md`
An API route, SQL schema, RLS policy, RPC, migration, trigger, seed script, JWT/auth flow, commission settlement flow | `docs/BACKEND.md`
System architecture, layered patterns, role boundaries, auth model, write/realtime patterns | `docs/ARCHITECTURE.md`
Role × capability matrix (who can see/do what) | `docs/role-permissions.md`
Field-level entity model / aggregation rules / health-score formula | `docs/data-model.md`
HTTP request/response shapes + cache keys / invalidation table | `docs/api-contracts.md`
Product spec, personas, workflows, business rules | `docs/SPEC.md`
QA audit findings & fix log; prior full audits | `docs/audits/` (e.g. `dashboard/DASHBOARD_AUDIT.md` + `…_FIXES.md`, `2026-05-31/`, `2026-04-distributor/`)
Browser-level E2E suite (`/qa`) + Playwright config | `.claude/skills/qa.md`
Design artifacts (Figma exports etc.) | `docs/design/`

---

## 3. Quick start

```sh
cp .env.local.example .env.local   # fill in Supabase keys
npm install                         # legacy-peer-deps=true per .npmrc
npm run dev:all                     # ⭐ canonical: Vite (:5173) + Express API (:3001) together
# npm run dev                       # frontend ONLY — /api has no backend, so sign-in (and every
#                                   #   /api/* call) 500s via the proxy. Use only for pure-UI work.
```

> **Sign-in returns 500 / "Server unavailable" in local dev?** The Express API on `:3001` isn't running — you started `npm run dev` (Vite only) instead of `npm run dev:all`, or `tsx watch` crashed and didn't restart. The Vite proxy relays the dead upstream as a 500 for *every* `/api/*` route (all roles, OTP + password). Fix: `npm run dev:all` (or `npm run dev:api` in a second terminal). Confirm with `nc -z localhost 3001`.

**npm scripts** (`package.json`):

Script | Purpose
--- | ---
`npm run dev` | Vite dev server (frontend on `:5173`)
`npm run dev:api` | Express backend on `:3001` (`dotenv -e .env.local -- tsx watch server/index.ts`); pair with `npm run dev` in a second terminal
`npm run dev:all` | Both servers in one terminal (`concurrently` — Vite + Express)
`npm run build` | Production Vite build
`npm run build:api` | `tsc -p server/tsconfig.json` — Render build gate, also runs in CI
`npm run preview` | Serve the built bundle
`npm run lint` | ESLint 9 flat config (0 errors expected; 1 TanStack Virtual informational warning is normal — drops to 1 after Phase 6 of audit remediation cleared the orphaned-worktree duplicates + the stale eslint-disable directive)
`npm test` | Vitest one-shot
`npm run test:watch` | Vitest watch
`npm run test:e2e` | Playwright E2E suite (full). Subcommands: `:smoke`, `:flows`, `:headed`, `:ui`. See `.claude/skills/qa.md`.
`npm run seed` | Seed Supabase via `scripts/seed-supabase.mjs` (see `docs/BACKEND.md §12`)
`npm run deploy:api` | Trigger a manual Render backend deploy via the deploy hook (`scripts/render-deploy.mjs`; POSTs `RENDER_DEPLOY_HOOK` from `.env.local`). Render is `autoDeployTrigger: off` — see `docs/render-operational.md`

**Env vars** (full table in `BACKEND.md §2`; template in `.env.local.example`):

Key | Scope
--- | ---
`VITE_SUPABASE_URL` | Public (frontend)
`VITE_SUPABASE_ANON_KEY` | Public (frontend)
`VITE_USE_SUPABASE` | Public — rollback flag; `'false'` flips every service into mock-backed branch
`SUPABASE_SERVICE_ROLE_KEY` | Server-only (never expose to frontend)
`SUPABASE_JWT_SECRET` | Server-only (HS256 signing secret)
`SUPABASE_DB_URL` | Local-only (seed script) — do **NOT** run `vercel env pull`, it wipes this

**Root config files:**

File | What it does
--- | ---
`vite.config.js` | Path alias (`@` → `./src` — the only alias defined); manual vendor chunks (`vendor-leaflet`/`-charts`/`-motion`/`-tanstack`/`-router`/`-react`); `chunkSizeWarningLimit: 700`; embedded Vitest config
`eslint.config.js` | ESLint 9 flat config (`@eslint/js` + react-hooks + react-refresh)
`.env.local.example` | Canonical env-var template (copy to `.env.local` — gitignored)
`.npmrc` | `legacy-peer-deps=true`
`.node-version` | Node 22 LTS pinned
`index.html` | Vite entry HTML; carries the skip-to-content link targeting `#main`

---

## 4. Hard rules — MUST FOLLOW

1. **Data access.** Components and dashboard files NEVER import from `src/data/mockData.js`. Use hooks from `src/hooks/` → services in `src/services/`. Only service files may import `mockData`. (`FRONTEND.md §4`.)
2. **Routing.** Top-level navigation uses `react-router-dom` (`useNavigate()`). Modal/panel UI state (slide-ins, drawers) is **state-based** in `DashboardPanelContext` and intentionally NOT routed. Subscriber + Agent dashboards have routed sub-pages because each destination is a URL; Distributor + Branch use panels. (`FRONTEND.md §3`.)
3. **Auth.** Use `useAuth()` from `AuthContext`. Session persists under `localStorage` keys `upensions_auth` + `upensions_token`. `services/api.js` raises a 401 event via `onAuthExpired(handler)` — `AuthContext` consumes it to log out + redirect. (`FRONTEND.md §5`, `BACKEND.md §5`.)
4. **Environment.** No hardcoded API endpoints. Read config via `src/config/env.js` (`API_BASE_URL`, `IS_DEV`, `IS_PROD`, public URLs). (`FRONTEND.md §1`.)
5. **Signup persistence.** `SignupContext` (in `src/signup/`, not `src/contexts/`) writes every patch to `localStorage` (`uganda-pensions-signup`). File/Blob fields are dropped on serialise; user re-uploads on refresh, but OCR results, phone, beneficiaries, consent all survive. (`FRONTEND.md §9`.)
6. **Frequency normalisation.** Always pass schedule frequencies through `normalizeFrequency(value)` from `src/utils/finance.js` before reading or writing — legacy formats (`half-yearly`, `halfYearly`, `semi-annually`, …) drift across the codebase. Canonical constants live in `FREQUENCY`. (`FRONTEND.md §12`.)

---

## 5. Anti-patterns — MUST NOT DO

1. Don't import `src/data/mockData.js` from components or dashboard files (services only).
2. Don't hand-roll `fetch()` against `/api/*` — use `services/api.js` (`api.get/post/put/delete`) so the 401 listener fires.
3. Don't write `outline: none` without a `:focus-visible` replacement (or a wrapping `:focus-within` indicator). Global `:focus-visible` baseline lives in `src/index.css`.
4. Don't write `transition: all` — always enumerate the properties.
5. Don't bypass `normalizeFrequency` when reading/writing contribution schedules.
6. Don't write raw SQL from the frontend — every database write goes through a SECURITY DEFINER RPC (`BACKEND.md §9`).
7. Don't trust `auth.uid()` inside RLS policies — it's `NULL` for our custom HS256 JWTs. Read `auth.jwt() ->> 'app_role'/'subscriberId'/'agentId'/'branchId'/'distributorId'` instead (`BACKEND.md §8`). **Trap**: `auth.jwt() ->> 'role'` returns `'authenticated'` (the Postgres role for PostgREST `SET ROLE`), not the application role. Reading `'role'` and gating on app values (`'distributor'`, `'agent'`, …) silently fails — this exact mistake produced both the 0018 rollup regression (zeros across every drill-down) and the 0004 commission-RPC silent failures. Always read `'app_role'`.

---

## 6. Brand & visual identity

- **Primary colour:** Universal Indigo `#292867`. Anchors key headings, primary buttons, hero emphasis, important icons.
- **Reserve red** for error/destructive/critical only — never as a major brand colour.
- **Typography:** Plus Jakarta Sans (display, `--font-display`) + Inter (body, `--font-body`). Headings `font-weight: 800; letter-spacing: -0.03em`.
- **Styling:** CSS Modules only (no Tailwind, no component library). Design tokens are CSS custom properties in `src/index.css`. Animation uses Framer Motion with shared `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]`.
- **Full token list, palette, panel/glass recipes, icon system, brand strategy:** `FRONTEND.md §11` (tokens + UI conventions) and `FRONTEND.md §17` (product & brand context).

---

## 7. Security do/don'ts

1. **Never log JWTs** or include them in error reports — they are bearer tokens for the entire session.
2. **Never expose `SUPABASE_SERVICE_ROLE_KEY`** to the frontend. It bypasses RLS. Server-only, used by `api/_lib/supabase-admin.ts`.
3. **All writes flow through SECURITY DEFINER RPCs** (`create_subscriber_from_signup`, `apply_settlement`, etc.) — never write directly to a table from the client. RLS would block it, and the RPCs enforce business invariants atomically.
4. **RLS policies read JWT claims, not `auth.uid()`** — `auth.uid()` is `NULL` for our custom HS256 tokens. See `BACKEND.md §8`.
5. **The demo OTP route accepts any 6-digit code.** It is **not** production-grade and must never ship as-is to a real customer — it's intentional demo scope (see §10a).

Also — env-var sourcing under the new Vercel-frontend / Render-backend split:

- **Vercel env (frontend only).** Contains the public `VITE_*` keys (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_USE_SUPABASE`, `VITE_API_BASE_URL`) across Production / Preview / Development scopes. Server-only keys (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`) are **no longer stored in Vercel** post-migration — Vercel hosts no functions, so it has no use for them. **Do NOT run `vercel env pull`** — it still overwrites `.env.local` and wipes the local-only `SUPABASE_DB_URL` needed by the seed script. `vercel env add` is safe for adding new `VITE_*` keys.
- **Render env (server only).** Contains `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL` (server-side rename of `VITE_SUPABASE_URL`), and `SENTRY_DSN`. Managed in the Render dashboard → service → Environment. **Never** add `VITE_*` keys here — Render doesn't run a build that consumes them, and they cause confusion.
- **GitHub Actions env (CI only).** Mirrors enough of both to run the E2E suite — public `VITE_*` plus server `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` for test fixtures. Listed in `.github/workflows/test.yml`.

---

## 8. Demo credentials & personas

The seeded demo data is generated via `npm run seed` (`scripts/seed-supabase.mjs`, mechanics in `BACKEND.md §12`). Phone numbers use the synthetic `+25671XXXXXXX` range. Every demo login supports **OTP or password, the user's choice**: OTP accepts **any 6-digit code**; password is the shared demo secret **`Demo1234`** (seeded onto every `users` row, hashed with bcrypt cost 10). Sign in per-audience from the landing pages (subscriber `/`, employer `/employers`, distributor/branch/agent `/distributors`) or admin from the Administrator landing page `/admin` (the bare portal is `/admin/login`).

Role | Quick login | Seeded count
--- | --- | ---
Subscriber | 5 seeded phones, e.g. `+25671 100 0001`, `…0002`, `…0003`, `…0004`, `…0005` | ~5,000
Agent | Any `agent` role login; `demo_personas` falls back to `a-001` if no phone match | ~2,049
Branch | Any `branch` role login; fallback to `b-kam-015` (Kampala branch) | ~316
Distributor | `+25670 000 0021` → `d-001` (national), `+25670 000 0022` → `d-002` (Busoga). Any other `distributor` login falls back to `d-001` | 2 (each sees only its own network)
Employer | `EMPLOYER_DEMO_PHONE` = `+25670 000 0031` (`src/data/employerSeed.js`); `demo_personas` falls back to `emp-001` if no phone match | 1 employer / 16 employees
Admin | Any `admin` role login; `demo_personas` falls back to `admin-001`. **Password login uses the pinned admin phone `+25670 000 0099`** (only seeded admin `users` row) | 1 (head-office, global)

**Fallback rule.** `demo_personas` maps a phone → role-scoped ID. When no row matches, `verifyOtp` returns the hardcoded fallback IDs above so every demo login succeeds. Intentional. See `BACKEND.md §5` for the lookup chain and `BACKEND.md §12` for seed mechanics.

**Password login scope.** OTP accepts any typed phone (fallback IDs keep it working); **password `Demo1234` works only for the explicitly-seeded demo phones** (the 5 subscribers, 3 agents, 2 branches, 2 distributors, the employer, and the pinned admin `+256700000099`) because `verify-password` needs a real `users(phone, role)` row. Arbitrary-phone password login is intentionally not built.

---

## 9. Glossary

Term | Meaning
--- | ---
Subscriber | Individual saver — a member with a balance and contribution schedule.
Agent | Field agent who onboards and supports subscribers (mobile-first, routed dashboard).
Branch | Sub-distributor entity that supervises agents in a district.
Distributor | Top-of-tree network operator. **Two in the demo seed:** `d-001` (national — 289 branches) and `d-002` (Busoga sub-region — 27 branches), split by `branches.distributor_id`. That column is the ownership edge every distributor-scoped read resolves through (`branches.distributor_id → agents.branch_id → subscribers.agent_id`, migrations `0081`/`0084`); a distributor sees only its own network, and commission rates are per-distributor (`0089`).
Employer | B2B account managing a **standalone** staff roster (`employees`, outside the agent→subscriber tree — no agent commissions). Funds staff pension via "contribution runs"; desktop-first dashboard mirroring branch admin. Scoped by the `employerId` JWT claim. See `BACKEND.md §8`/§12 + `docs/data-model.md`.
Admin | Head-office platform admin with global rights. Map-theme dashboard (`src/admin-dashboard/`) reusing the distributor map/panels (platform-wide reads via `*_select_admin` RLS) plus Distributors & Employers managers (list/metrics/create via `0049` RPCs). No scope claim — sees everything.
Commission settlement | Two-state flow `due → paid`. Commissions auto-generate as `due` at the configured flat rate-per-subscriber on a subscriber's first contribution. The distributor pays offline, then downloads a per-agent Excel template (prefilled with pending dues), fills Amount Paid + payment reference/date, and re-uploads; the matching agent's `due` lines flip to `paid` via the `apply_settlement` RPC, which also records a `settlement_batches` row and notifies the agent + branch. No maker-checker, runs, branch review, holds, disputes, or cadence. See `BACKEND.md §11`.
RPC | Remote procedure call — a Postgres function (typically `SECURITY DEFINER`) invoked via `supabase.rpc('name', args)`. Atomic writes only.
RLS | Row-Level Security — Postgres policies that scope SELECT/INSERT/UPDATE/DELETE per JWT claim.
`splitMode` | Prop on slide-in panels that suppresses the backdrop so the parent reflows main content beside the panel (Branch overview uses this).
Drill-down | Map/overlay navigation through `country → region → district → branch → agent → subscriber`. Distributor-only.
Settlement batch | A `settlement_batches` row recorded each time the distributor's settlement upload flips an agent's `due` lines to `paid` (one row per agent: pending total, amount paid, txn ref, paid date, line count). SELECT-only — written by the `apply_settlement` RPC.
Notification | In-app `notifications` row (`recipient_role` ∈ `agent`/`branch`). The only `type` today is `commission_settled`, emitted to the affected agent + branch when a settlement is applied. Surfaced via a `NotificationBell` for agent + branch (distributor not mounted).
Scope context | `BranchScopeContext` / `AgentScopeContext` / `EmployerScopeContext` — provide `branchId` / `agentId` / `employerId` to descendants when the tree is rendered for a single-entity role.
Atomic-write RPC | A SECURITY DEFINER function that mutates multiple tables in one transaction (e.g. `create_subscriber_from_signup` creates subscriber + balances + schedule + insurance + nominees + first-contribution commission). See `BACKEND.md §9`.
Realtime publication | Supabase realtime channel. Empty for `public.*` — `0025_drop_realtime_publication.sql` removed the original `commissions` publication (zero `.channel()` subscribers); React Query staleTime + manual invalidation handles cross-laptop demo sync. The `settlement_batches` + `notifications` tables (added in 0030/0031) are SELECT-only and not published either.

---

## 10. Demo scope & awareness items

### 10a. Demo scope (by design — NOT bugs)

These are intentional limits of a demo platform built for sales reps. Do not propose "fixing" them with real SMS / payment / KYC / audit / compliance integrations — that is explicitly out of scope.

- **OTP** — any 6-digit code is accepted at `/api/auth/verify-otp`. No SMS provider, no rate limiting, no lockout. Sales reps demo without phones in hand.
- **KYC** — all 8 routes under `/api/kyc/*` are Smile ID-v2-shaped mocks with realistic latency. Force failures via `localStorage upensions_<stage>_force` keys to demo failure paths.
- **Unit price** is hardcoded at **1,000 UGX/unit** in `trg_transactions_contribution`. No real fund NAV.
- **JWT** — fixed 24h TTL, no refresh, custom HS256 (not Supabase Auth). Fine for short demo sessions.
- **`demo_personas` fallback IDs** (`a-001` / `b-kam-015` / `d-001`) keep every login successful even if the persona seed drifted.
- **No payment processor.** "Pay now" buttons demonstrate flow only. Every subscriber pay surface offers **MTN MoMo · Airtel Money · Card · Bank transfer** via the shared `PaymentMethodPicker`; the card form and its "Authorising with your bank" step are a **mocked gateway** (no processor, no Luhn check, card details never leave component state), and the bank-transfer account details are placeholders. See `FRONTEND.md §11`/§16a.
- **Mocked chat.** `src/services/chat.js` returns keyword-matched mock replies for the data assistant, agent DM, and subscriber co-pilot.
- **Per-session mutation stores** (`entities._entityOverrides`, `subscriber._sessionMutations`) layer demo writes over frozen `mockData.js` and reset on refresh — intentional for the "what-if" demo flows.

See `FRONTEND.md §16a` and `BACKEND.md §14a` for the role-specific demo-scope inventories.

### 10b. Awareness items (worth knowing, not urgent)

- **`MOCK_NOW = new Date(2026, 4, 26)`** (2026-05-26) in `src/data/mockData.js` anchors "due in N days" demos. Slide it forward (or flip to `new Date()`) when the demo's relative dates start looking stale.
- **NPM deps inventory (verified 2026-05-22 in audit Phase 6):** every direct dep in `package.json` is actually used. `dotenv` is used by `e2e/fixtures/db.ts:13` + `playwright.config.ts:16` (NOT unused). `react-is` is required transitively by `recharts` (build fails without it). `jose` is used in `api/_lib/jwt.ts`; `pg` is used in `scripts/seed-supabase.mjs`. None should be removed.
- **Real bugs in the demo experience** (not demo-scope) are catalogued in `docs/FRONTEND.md §16b` (subscriber Settings/notifications + Settings/security now redirect to `/dashboard/settings` — the `StubPage` component was removed in the audit-remediation cleanup) and `docs/BACKEND.md §14b` (nominee shares can sum >100%). The employer role is **shipped to production** (migrations `0032`–`0036`, part of the full chain now on the new Singapore DB). Employee **onboarding** is no longer a deferred placeholder — it shipped as the invite-based KYC flow (migrations `0043`–`0047`). The commission dispute/maker-checker flow was removed in the 0029–0031 simplification, so the old `agent_dispute_line` / `disputeCommission` items no longer apply.

---

## 11. Doc maintenance discipline

**When you add a service, hook, table, RPC, migration, route, or context, update `FRONTEND.md` or `BACKEND.md` in the same commit.** These docs are reference material — they decay fast if treated as one-time deliverables. Keep `CLAUDE.md` itself slim: bump it only when the routing table, hard rules, glossary, anti-patterns, or demo scope shift. Schema detail, signatures, and design-token values belong in the specialist docs, not here.

---

## See also

- [`FRONTEND.md`](./docs/FRONTEND.md) — services, hooks, contexts, dashboard variants, signup flow, design tokens, accessibility, frontend findings
- [`BACKEND.md`](./docs/BACKEND.md) — env vars, API routes, `_lib/` helpers, auth flow, schema, migrations, RLS, RPCs, commission settlement flow, triggers, seeding, runbook
- [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system architecture: layered patterns, role boundaries, auth model, write/realtime patterns
- [`docs/role-permissions.md`](./docs/role-permissions.md) — role × capability matrix
- [`docs/data-model.md`](./docs/data-model.md) — field-level entity model + aggregation rules
- [`docs/api-contracts.md`](./docs/api-contracts.md) — HTTP shapes + cache keys + invalidation
- [`docs/SPEC.md`](./docs/SPEC.md) — product spec, personas, workflows
- [`docs/design/`](./docs/design/) — QA audit artifacts + design exports
