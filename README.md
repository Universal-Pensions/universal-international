> **Agent guide.** This is the repository README — a high-level orientation map (what the platform is, tech stack, quick start, npm scripts, database, deployment topology) for the Universal Pensions Uganda codebase. An AI agent can skim it first for the lay of the land, but should treat `CLAUDE.md` as the binding source for hard rules, anti-patterns, and demo scope, and the specialist docs under `docs/` (`docs/FRONTEND.md`, `docs/BACKEND.md`, `docs/ARCHITECTURE.md`) for file-level depth. Do not treat this README as the authoritative rulebook or the schema/API reference — it is orientation only, and specific counts here (migrations, routes) can lag the code.
>
> **Verified against the live Singapore DB (`ilkhfnoyxlxwqadebnkp`) on 2026-08-25.** Migration/route/table counts decay fast — re-measure before relying on them.

# Universal Pensions Uganda

A digital pension platform making long-term retirement savings simple, accessible, and meaningful for every Ugandan. Licensed and regulated by the Uganda Retirement Benefits Regulatory Authority (URBRA).

**Live:** [uganda-dashboard.vercel.app](https://uganda-dashboard.vercel.app)

> This repo is a **demo / sales-presentation tool** that sales reps walk prospects through — it is NOT a production fintech. Mocked OTP, mocked KYC, and a 24-hour fixed JWT are intentional demo scope (see `CLAUDE.md §10a`). The unit price is **not** demo scope — it is a real admin-published fund NAV since migrations `0103`–`0106` (verify live: `select public.latest_nav();`).

## Overview

The codebase covers four surfaces:

1. **Public landing page** (`/`) — scrollytelling marketing site that demos 40 years of compounded savings via scroll-linked animation.
2. **Signup / KYC flow** (`/signup/*`) — 9-step subscriber onboarding (phone OTP, NIRA ID OCR, NIRA verify, face match, AML screen, agent fallback).
3. **Role dashboards** (`/dashboard/...`) — all 6 roles built: Subscriber, Agent, Branch, Distributor, Employer, and Admin (the Employer role shipped to production 2026-06-03; Admin shipped 2026-06-08 with its map-theme shell at `src/admin-dashboard/` and `0049` RLS policies).
4. **Express backend on Render** (`server/index.ts` mounts `api/*.ts`) — 16 routes covering auth, KYC mocks, contact, chat, public access-requests, and public nominee claims. Singapore region, Node 22, free tier. Database is Supabase (Postgres + RLS + custom HS256 JWT via `jose`) — a **new Singapore `ap-southeast-1` project, cutover 2026-06-05** (replaced the old Tokyo `ap-northeast-1` project; reseeded to ~5,000 subscribers).

## Tech stack

- **React 19** (JSX, no TypeScript on the frontend)
- **Vite 6.3.5** dev server + production builder
- **React Router 7** for top-level navigation
- **TanStack Query 5** for server state; **TanStack Virtual 3** for long lists
- **Framer Motion 12** for scroll-linked + entrance animation
- **CSS Modules** (no Tailwind, no component library) — design tokens in `src/index.css`
- **Leaflet 1.9** + **Recharts 3** for the distributor map and charts
- **Express 5** TypeScript handlers in `api/` mounted by `server/index.ts`; hosted on **Render** (Singapore, free tier, Node 22). Frontend hosted on **Vercel** (Vite preset, no functions).
- **Supabase** (Postgres + RLS + PostgREST). 120 forward migration files on disk as of 2026-08-25 (`0001`–`0126`, with a few numbering gaps — this moves fast, re-count with `ls supabase/migrations/*.sql | grep -v .down.sql | wc -l` before relying on it). The live `supabase_migrations` ledger versions rows as TIMESTAMPS, not `0001_*` prefixes, so it cannot be diffed against these filenames — see `docs/BACKEND.md §16`.
- **jose** for custom HS256 JWT signing/verification
- **Playwright 1.60** for E2E (browser-driven full-app suite under `e2e/`)
- **Vitest 4** for unit tests
- **ESLint 9** flat config

## Quick start

```sh
# 1. Install (legacy-peer-deps is set in .npmrc)
npm install --legacy-peer-deps

# 2. Copy the env template and fill in the keys
cp .env.local.example .env.local
# Required: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
#           SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET,
#           SUPABASE_DB_URL (for the seed script — do NOT run `vercel env pull`,
#           it overwrites this file. See BACKEND.md §2).

# 3. Frontend-only dev (uses mock data if VITE_USE_SUPABASE=false)
npm run dev   # Vite on :5173

# 4. Full local stack — TWO TERMINALS, or use dev:all for one
npm run dev          # terminal A: Vite frontend on :5173
npm run dev:api      # terminal B: Express backend on :3001 (tsx watch server/index.ts)

# OR, single terminal via concurrently:
npm run dev:all      # spawns both servers, colour-prefixed output
```

> **Local dev = two terminals** (`npm run dev` + `npm run dev:api`) or `npm run dev:all`. **Production = Vercel (frontend) + Render (backend).** See `docs/render-operational.md` for the Render runbook.

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 (frontend only) |
| `npm run dev:api` | Express backend on http://localhost:3001 (`tsx watch server/index.ts`) |
| `npm run dev:all` | Both servers in one terminal via `concurrently` |
| `npm run build:api` | `tsc -p server/tsconfig.json` — used by Render's build command and CI |
| `npm run build` | Production Vite build |
| `npm run preview` | Serve the built bundle |
| `npm run lint` | ESLint flat-config (0 errors expected) |
| `npm test` | Vitest one-shot |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Coverage report (install `@vitest/coverage-v8` first — not in `package.json` by default) |
| `npm run test:e2e` | Playwright full E2E suite |
| `npm run test:e2e:smoke` | Smoke specs only (`e2e/specs/smoke`) |
| `npm run test:e2e:flows` | Flow specs only (`e2e/specs/flows`) |
| `npm run test:e2e:headed` | Headed Playwright run |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run seed` | Seed Supabase via `scripts/seed-supabase.mjs` (~5K subscribers, ~316 branches, ~2K agents; `TARGET_SUBS` in `src/data/mockData.js`) |

Playwright additionally:

```sh
# One-off, fast iteration
npx playwright test path/to/spec.ts --project chromium
```

## Database

Schema lives in `supabase/migrations/*.sql` (120 numbered migration files as of 2026-08-25, `0001`–`0126` with gaps — re-count before relying on this number). State-machine writes are *supposed* to flow through `SECURITY DEFINER` RPCs invoked with `supabase.rpc(name, args)`. ⚠️ **Direct table writes are NOT reliably blocked by RLS** — as of 2026-08-25 several tables still accept them (a fix is drafted in migration `0118` but not yet applied); see `CLAUDE.md §7` and `docs/audits/2026-08-23/02-rls-matrix.md §5`. RLS policies read `auth.jwt() ->> 'app_role'` (NOT `'role'`, which is the Postgres `authenticated` role — see CLAUDE.md §5 anti-pattern 7).

Apply migrations with the Supabase CLI:

```sh
supabase db push    # forward apply
supabase db reset   # local-only, drops + reapplies all migrations
```

Seed demo data with `npm run seed`. Phone numbers use the synthetic `+25671XXXXXXX` range; login at the sign-in modal with any 6-digit OTP.

## Documentation map

- **`CLAUDE.md`** — slim entry index. Hard rules, anti-patterns, demo scope, brand colours.
- **`FRONTEND.md`** — services, hooks, contexts, dashboard variants, signup flow, design tokens.
- **`BACKEND.md`** — env vars, API route inventory, auth flow, schema, RPCs, RLS, commission state machine, seeding.
- **`ARCHITECTURE.md`** — layered patterns, role boundaries, auth model, realtime + write patterns.
- **`docs/api-contracts.md`** — HTTP request/response shapes for the 16 API routes + RPC catalogue.
- **`docs/data-model.md`** — field-level entity model + aggregation rules.
- **`docs/role-permissions.md`** — role × capability matrix.
- **`docs/SPEC.md`** — product spec, personas, workflows.
- **`docs/archive/`** — historical/superseded docs.

## Deployment

The deployment topology splits along the frontend/backend boundary:

- **Frontend (Vercel)** — Vite preset, no functions. Auto-deploys on push to `main` via the GitHub App. Preview URL per PR. Env vars (all `VITE_*`) live in the Vercel dashboard across Production / Preview / Development scopes. Do NOT run `vercel env pull` — it overwrites `.env.local` and wipes the local-only `SUPABASE_DB_URL` needed by the seed script.
- **Backend (Render)** — Express 5 on Node 22, Singapore region, free tier. Blueprint at `render.yaml`; **manual deploys only** (`autoDeployTrigger: off`). Env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SENTRY_DSN`) live in the Render dashboard. See `docs/render-operational.md` for the full runbook — manual deploy procedure, log retention, deploy outage window, silent-failure recovery.
- **CI (GitHub Actions)** — `.github/workflows/test.yml` runs lint + Vitest + `npm run build:api` (tsc gate) + Playwright (dual-server). `.github/workflows/keepalive.yml` pings `/readyz` (a real DB read, not the I/O-free `/healthz`) every 10 min as configured to keep the Render free-tier service warm and actually detect a Supabase outage; real-world GHA cron jitter widens the measured median gap to ~35 min — see `docs/render-operational.md` and open finding A09-007.

Do not push to `main` without explicit approval — production shares the same Supabase project as local dev (the new Singapore project as of the 2026-06-05 cutover).
