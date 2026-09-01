> **Agent guide.** This is the root orientation index for the Universal Pensions Uganda codebase — read it FIRST; it carries the routing table plus the hard rules, anti-patterns, brand/security constraints, and demo-scope boundaries every change must respect. When you need file-level depth it points you (via §2) to the specialist docs under `docs/` (`FRONTEND.md`, `BACKEND.md`, `ARCHITECTURE.md`, …). Treat its Hard rules (§4) and Anti-patterns (§5) as binding, not advisory.
>
> **Verified against the live Singapore DB (`ilkhfnoyxlxwqadebnkp`) on 2026-08-25.** Counts (tables, functions, policies, migrations, routes, seed entities) decay fast — re-measure before relying on any number in this file rather than trusting the date on this line.

# CLAUDE.md — Universal Pensions Uganda

Slim entry index for this repo. Two deep specialist docs live under `docs/`: **`docs/FRONTEND.md`** (React/Vite/CSS Modules) and **`docs/BACKEND.md`** (Express on Render + Supabase + RLS). Detail lives in those two files and the rest of `docs/`; this file (at the repo root) is for orientation only.

---

## 1. Project at a glance

**Universal Pensions Uganda** is a digital long-term savings + pension platform aimed at everyday Ugandans (informal workers, gig workers, farmers, self-employed). The app in this repo is a **demo / sales-presentation tool** that sales reps walk prospects through — it is **NOT** a production fintech. Mocked OTP, mocked KYC, `demo_personas` fallback IDs, and a 24-hour fixed JWT are **intentional demo scope** and must not be treated as production-prep TODOs.

- **Live URL:** `uganda-dashboard.vercel.app` (auto-deploy on push to `main` — do not push without explicit approval). **Applies to both:** Vercel (frontend, automatic via the GitHub App integration) and Render (backend at `uganda-dashboard-api.onrender.com`, **manual** deploys only — `autoDeployTrigger: off` in `render.yaml`).
- **Stack:** React 19 · Vite 6 · CSS Modules (no Tailwind) · Framer Motion 12 · React Router 7 · TanStack Query 5 / Virtual 3 · Leaflet 1.9 · Recharts 3 · Express 5 on Render (Node 22, Singapore region) · Supabase Postgres (Singapore `ap-southeast-1` — **new project, cutover 2026-06-05**; replaced the old Tokyo `ap-northeast-1` project) · custom HS256 JWT via `jose`.
- **⚠️ WHICH SUPABASE PROJECT — identify by REF, never by name.**

  | | Project ref (authoritative) | Name in the Supabase console | Region | State |
  |---|---|---|---|---|
  | **LIVE — the only one** | `ilkhfnoyxlxwqadebnkp` | `Uganda dashbaord 1` *(sic — "dashbaord")* | Singapore `ap-southeast-1` | active |
  | Dead, being deleted | `zengmiugieqjqzaccbqe` | `Uganda dashboard (inactive)` | Tokyo `ap-northeast-1` | INACTIVE, emptied 2026-09-01 |

  **The ref is the identifier. The name is decoration and has already changed twice.**
  Every connection string, every `.env`, and every doc in this repo names the ref;
  the console shows you the name. That mismatch cost three months: until
  2026-09-01 the *dead Tokyo project* was the one called "Uganda dashboard" —
  matching this repo — while live was called "Pension dashbaord", misspelled and
  not obviously this product. Anyone searching the console for the Uganda
  dashboard found the wrong database, and CI's four secrets pointed at it from
  2026-05-27 onward. The E2E suite therefore ran against a schema frozen at
  3 June for roughly three months, failing on columns that exist in live, and the
  failures were absorbed as "known baseline" rather than investigated.

  Before pointing anything at a Supabase project, check the **ref**, not the name.
  `SUPABASE_DB_URL` carries it (`postgres.<ref>@…pooler…` or `db.<ref>.supabase.co`),
  and `scripts/seed-guard.mjs` parses and enforces it for destructive runs.

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
`npm run lint` | ESLint 9 flat config (`@eslint/js` + react-hooks + react-refresh + jsx-a11y). **0 errors is the gate.** ~200 warnings is normal, not a broken build: 141 are `jsx-a11y/*`, surfaced (not introduced) when this branch grew a11y coverage from 4 to 17 rule references. The ~24 `react-hooks/*` are the ones with teeth (16 x `set-state-in-effect`). The ceiling is `--max-warnings` in `package.json` — **read it there**; it is deliberately not restated here, because it only ever moves up and a number quoted in prose goes stale (this row said “1 warning” for months). Known backlog: split the gate so `react-hooks/*` must be zero while `jsx-a11y/*` carries the ceiling — needs a hooks refactor across 16 files first.
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
6. Don't write raw SQL from the frontend. Every *money* write is supposed to go through a SECURITY DEFINER RPC (`BACKEND.md §9`). **Migrations `0118` + `0119` (applied to live 2026-08-25) closed the money-table gap this rule used to be breached by**: `transactions`, `withdrawals` and `nominees` are now SELECT-only through PostgREST — verified live, zero INSERT/UPDATE/DELETE policies remain on any of the three. `src/services/subscriber.js` and `src/services/entities.js` still `.insert()`/`.update()`/`.upsert()` tables directly through PostgREST (9 call sites, down from 11 — 5 in `entities.js`, 4 in `subscriber.js`; **line numbers deliberately omitted** — the ones that used to be here drifted +17 within a fortnight. `src/test/money-write-rpc-contract.test.js` is the citation that cannot drift: it ratchets exactly those two counts and fails on a tenth), but every one of those 9 now lands on a non-money, ownership-scoped table (see §7.3). Exactly 10 write policies remain anywhere in `public`.
7. Don't trust `auth.uid()` inside RLS policies — it's `NULL` for our custom HS256 JWTs. Read `auth.jwt() ->> 'app_role'/'subscriberId'/'agentId'/'branchId'/'distributorId'` instead (`BACKEND.md §8`). **Trap**: `auth.jwt() ->> 'role'` returns `'authenticated'` (the Postgres role for PostgREST `SET ROLE`), not the application role. Reading `'role'` and gating on app values (`'distributor'`, `'agent'`, …) silently fails — this exact mistake produced both the 0018 rollup regression (zeros across every drill-down) and the 0004 commission-RPC silent failures. Always read `'app_role'`.

> **Enforcement reality (re-measured 2026-08-27).** Of the 13 rules above (§4.1–4.6, §5.1–5.7), **eleven are mechanically enforced and fail the build** — 2 as ESLint *errors*, 9 as grep-based contract tests under `src/test/`. This note used to say the opposite (“PROSE ONLY”, “`eslint.config.js` carries no `no-restricted-imports`/`no-restricted-syntax` rule”). That described the world before `1f8985b`, which added both rules 1h46m *earlier* the same day; the paragraph was left stale for two days. Don’t trust a remembered version of this note — the files below are the specification.
>
> Rule | Enforced by
> --- | ---
> §4.1/§5.1 `mockData` outside services · §5.2 hand-rolled `fetch('/api/…')` | `eslint.config.js` — `no-restricted-imports` / `no-restricted-syntax`, both **error**
> §4.3 auth storage keys · §4.5 signup storage key | `src/test/claude-md-storage-keys-contract.test.js`
> §4.4 hardcoded API host/port | `src/test/claude-md-hardcoded-endpoint-contract.test.js`
> §5.3 `outline:none` (**ratchet**, 3 known) · §5.4 `transition: all` (zero) | `src/test/claude-md-css-contract.test.js`
> §5.6 money writes via RPC (**ratchet**, 9 sites) | `src/test/money-write-rpc-contract.test.js`
> §5.7 read `app_role` not `role` · §5.7 never read `auth.uid()` | `src/test/jwt-claim-contract.test.js` · `src/test/auth-uid-contract.test.js`
> §4.2 routing-vs-panel · §4.6/§5.5 `normalizeFrequency` | **nothing, deliberately** — §4.2 is architectural intent (is this screen a destination or a panel?), not a syntactic pattern; §4.6 is a data-flow question (was it normalised *upstream*?) that grep answers with noise. A bad rule is worse than a documented gap.
>
> **The two ratchets grandfather today’s violations and fail only on growth** — §5.3 allows its 3 documented `outline:none` sites, §5.6 allows exactly 9 direct-write call sites. A green suite does **not** mean zero violations for those two. Still absent by design: stylelint, and any pre-commit hook (git’s `hooksPath` is not pointed at `.husky`, so such a file would be inert — a dead file that looks like enforcement is worse than no file).

---

## 6. Brand & visual identity

- **Primary colour:** Universal Indigo `#292867`. Anchors key headings, primary buttons, hero emphasis, important icons.
- **Reserve red** for error/destructive/critical only — never as a major brand colour.
- **Typography:** Plus Jakarta Sans (display, `--font-display`) + Inter (body, `--font-body`). Headings `font-weight: 800; letter-spacing: -0.03em`.
- **Styling:** CSS Modules only (no Tailwind, no component library). Design tokens are CSS custom properties in `src/index.css`. Animation uses Framer Motion with shared `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]`.
- **Full token list, palette, panel/glass recipes, icon system, brand strategy:** `FRONTEND.md §16` (tokens + UI conventions) and `FRONTEND.md §19` (product & brand context).

---

## 7. Security do/don'ts

1. **Never log JWTs** or include them in error reports — they are bearer tokens for the entire session.
2. **Never expose `SUPABASE_SERVICE_ROLE_KEY`** to the frontend. It bypasses RLS. Server-only, used by `api/_lib/supabase-admin.ts`.
3. **Writes are *supposed* to flow through SECURITY DEFINER RPCs** (`create_subscriber_from_signup`, `apply_settlement`, etc.) — never write directly to a table from the client. **Migrations `0118` + `0119` (applied live 2026-08-25) closed the hole this section used to document as open.** It used to be reproducible under `BEGIN…ROLLBACK` that a subscriber JWT could `INSERT` straight into `/rest/v1/transactions` — no RPC — and fabricate balance, because `transactions_insert_self` constrained only `subscriber_id`, not `amount`/`type`/`status`. That policy no longer exists. Re-verified live 2026-08-25: `transactions`, `withdrawals` and `nominees` carry **zero** INSERT/UPDATE/DELETE policies — SELECT-only, RPC-or-nothing. Exactly 10 write policies remain anywhere in `public`, all on non-money entity tables (`agents`, `branches`, `contribution_schedules`, `distributors`, `insurance_policies`, `subscriber_insurance_products`, `subscribers` — self-service profile edits, not balance-moving writes). "RLS blocks direct money writes" is now a true security argument for this platform; it was not before `0118`/`0119` shipped.
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
Agent | Any `agent` role login; `demo_personas` falls back to `a-001` if no phone match | ~2,046
Branch | Any `branch` role login; fallback to `b-kam-015` (Kampala branch) | ~321
Distributor | `+25670 000 0021` → `d-001` (national), `+25670 000 0022` → `d-002` (Busoga). Any other `distributor` login falls back to `d-001` | 3 (each sees only its own network) — a third, `d-003` (Karamoja Pilot Network), exists with no dedicated demo phone; see §9 Glossary
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
Distributor | Top-of-tree network operator. **Three in the demo seed:** `d-001` (national — 291 branches), `d-002` (Busoga sub-region — 27 branches) and `d-003` (Karamoja Pilot Network — 2 branches), split by `branches.distributor_id`. One branch still has `distributor_id IS NULL` and belongs to no distributor. That column is the ownership edge every distributor-scoped read resolves through (`branches.distributor_id → agents.branch_id → subscribers.agent_id`, migrations `0081`/`0084`); a distributor sees only its own network, and commission rates are per-distributor (`0089`).
Employer | B2B account managing a **standalone** staff roster (`employees`, outside the agent→subscriber tree — no agent commissions). Funds staff pension via "contribution runs"; desktop-first dashboard mirroring branch admin. Scoped by the `employerId` JWT claim. See `BACKEND.md §8`/§12 + `docs/data-model.md`.
Admin | Head-office platform admin with global rights. Map-theme dashboard (`src/admin-dashboard/`) reusing the distributor map/panels (platform-wide reads via `*_select_admin` RLS) plus Distributors & Employers managers (list/metrics/create via `0049` RPCs). No scope claim — sees everything.
Commission settlement | Two-state flow `due → paid`. Commissions auto-generate as `due` at the configured flat rate-per-subscriber on a subscriber's first contribution. The distributor pays offline, then downloads a per-agent Excel template (prefilled with pending dues), fills Amount Paid + payment reference/date, and re-uploads; the matching agent's `due` lines flip to `paid` via the `apply_settlement` RPC, which also records a `settlement_batches` row and notifies the agent + branch. No maker-checker, runs, branch review, holds, disputes, or cadence. See `BACKEND.md §11`.
RPC | Remote procedure call — a Postgres function (typically `SECURITY DEFINER`) invoked via `supabase.rpc('name', args)`. Atomic writes only.
RLS | Row-Level Security — Postgres policies that scope SELECT/INSERT/UPDATE/DELETE per JWT claim.
`splitMode` | Prop on slide-in panels that suppresses the backdrop so the parent reflows main content beside the panel (Branch overview uses this).
Drill-down | Map/overlay navigation through `country → region → district → branch → agent → subscriber`. Distributor-only.
Settlement batch | A `settlement_batches` row recorded each time the distributor's settlement upload flips an agent's `due` lines to `paid` (one row per agent: pending total, amount paid, txn ref, paid date, line count). SELECT-only — written by the `apply_settlement` RPC.
Notification | In-app `notifications` row. `recipient_role` ∈ `agent`/`branch`/`distributor`/`employer`/`admin` (CHECK-pinned in `0096`; `subscriber` is in the domain but nothing writes it — the subscriber dashboard reads a different feed). Two writers: `apply_settlement` emits `commission_settled` to the affected agent + branch, and `admin_notify` (`0097`) emits one of the twelve Needs-attention signal types from an admin drill-down — to a real entity, or to a fixed internal ops queue (`ops-treasury` / `ops-claims` / `ops-finance` / `ops-fund-admin` / `ops-support`) under `recipient_role='admin'`. `NotificationBell` is mounted for agent, branch, employer, distributor and admin; the admin + ops queues are read with `entityId="*"` (RLS scopes it).
Nominee claim | A claim on a DEATH benefit (life or funeral), filed at the public `/claim` form by the person the member named. They have no account — the member has died — so it lands in `nominee_claims` (`0100`) via a service-role API route, not in `claims`, and an admin triages it. Distinct from the member's own **hospital cash** claim, which they file in-app and which `submit_hospital_cash_claim` (`0099`) prices server-side at cover ÷ 20 per night, capped at 20 nights a policy year.
Scope context | `BranchScopeContext` / `AgentScopeContext` / `EmployerScopeContext` — provide `branchId` / `agentId` / `employerId` to descendants when the tree is rendered for a single-entity role.
Atomic-write RPC | A SECURITY DEFINER function that mutates multiple tables in one transaction (e.g. `create_subscriber_from_signup` creates subscriber + balances + schedule + insurance + nominees + first-contribution commission). See `BACKEND.md §9`.
Unit price (NAV) | The price of one unit of the fund, published by the admin at `/dashboard` → **Unit price** (migrations `0103`–`0106`). Since `0104` it is the platform's **pricing authority**: a contribution buys `amount / NAV` units at its own date's price, a withdrawal redeems at today's, and `subscriber_balances.total_balance` is MARKET VALUE (`units × NAV`) — so publishing a price revalues all ~5,060 members in one transaction and moves every AUM figure at once. `invested` is the member's cost basis, reduced by the same FRACTION of units redeemed on a withdrawal (average-cost), which makes growth% invariant to withdrawals. Growth can be NEGATIVE. Weekday register in `nav_snapshots`; the 4 deliberately-unpublished recent days drive the "Delayed NAV updation" signal.
Realtime publication | Supabase realtime channel. Empty for `public.*` — `0025_drop_realtime_publication.sql` removed the original `commissions` publication (zero `.channel()` subscribers); React Query staleTime + manual invalidation handles cross-laptop demo sync. The `settlement_batches` + `notifications` tables (added in 0030/0031) are SELECT-only and not published either.

---

## 10. Demo scope & awareness items

### 10a. Demo scope (by design — NOT bugs)

These are intentional limits of a demo platform built for sales reps. Do not propose "fixing" them with real SMS / payment / KYC / audit / compliance integrations — that is explicitly out of scope.

- **OTP** — any 6-digit code is accepted at `/api/auth/verify-otp`. No SMS provider, no rate limiting, no lockout. Sales reps demo without phones in hand.
- **KYC** — all 8 routes under `/api/kyc/*` are Smile ID-v2-shaped mocks with realistic latency. Force failures via `localStorage upensions_<stage>_force` keys to demo failure paths.
- **Insurance pricing** is a hardcoded client-side ladder — four cover tiers per product in `src/constants/savings.js`, with no underwriting, no risk rating and no server-side catalogue (the RPCs validate only `>= 0` and the product enum). Don't propose an actuarial engine; do keep `src/constants/__tests__/savings-cover-tiers.test.js` green, since it stands in for the CHECK constraints the DB doesn't have.
- **JWT** — fixed 24h TTL, no refresh, custom HS256 (not Supabase Auth). Fine for short demo sessions.
- **`demo_personas` fallback IDs** (`a-001` / `b-kam-015` / `d-001`) keep every login successful even if the persona seed drifted.
- **No payment processor.** "Pay now" buttons demonstrate flow only. Every subscriber pay surface offers **MTN MoMo · Airtel Money · Card · Bank transfer** via the shared `PaymentMethodPicker`; the card form and its "Authorising with your bank" step are a **mocked gateway** (no processor, no Luhn check, card details never leave component state), and the bank-transfer account details are placeholders. See `FRONTEND.md §11`/§16a.
- **Mocked chat.** `src/services/chat.js` returns keyword-matched mock replies for the data assistant, agent DM, and subscriber co-pilot.
- **Per-session mutation stores** (`entities._entityOverrides`, `subscriber._sessionMutations`) layer demo writes over frozen `mockData.js` and reset on refresh — intentional for the "what-if" demo flows.

See `FRONTEND.md §16a` and `BACKEND.md §14a` for the role-specific demo-scope inventories.

### 10b. Awareness items (worth knowing, not urgent)

- **`MOCK_NOW = new Date(2026, 6, 1)`** (2026-07-01) now lives in **`src/constants/demoClock.js`** — the single JS anchor every consumer reads. `src/data/mockData.js` re-exports it unchanged, and (corrected 2026-08-25) `scripts/seed-supabase.mjs` and `e2e/specs/db/invariants.spec.ts` **no longer hand-copy a second literal** — both now import `MOCK_NOW`/`MOCK_NOW_ISO_DATE` directly from `demoClock.js`, closing the drift this bullet used to describe. One clock remains genuinely independent: Postgres can't import a JS constant, so `public._demo_now()` is a second, necessarily-separate literal. Migration `0126_demo_clock.sql` brought it to `2026-07-01` to match and **is applied to live** (verified 2026-08-25: `SELECT public._demo_now()` returns `2026-07-01 23:59:59+00`, and `e2e/specs/db/invariants.spec.ts`'s same-calendar-date assertion passes against the real DB). ⚠️ Moving this clock has a consequence `0126` did not cover: seeded **employer** data is anchored to absolute literals, not to the clock, so the admin "Employers" trends strip now reads zero — see `docs/audits/2026-08-23/a06/REGRESSION-0126-employer-trends.md` before rolling the clock again. To roll the clock forward: change `demoClock.js`'s `MOCK_NOW` and author/apply a matching `0126`-style migration — always both together.
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
