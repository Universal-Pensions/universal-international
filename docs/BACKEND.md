> **Agent guide.** The deep backend reference — the Express + TypeScript routes under `api/**` (hosted on Render), the Supabase Postgres schema / RPCs / RLS in `supabase/migrations/*.sql`, the seed + utility scripts, and the hosted + local runbook. Read it whenever you touch an API route, a migration, an RPC, an RLS policy, or the auth/JWT flow; pair it with `CLAUDE.md` (the binding rules) and `FRONTEND.md` (the React side). Per repo discipline (`CLAUDE.md` §11), update this doc in the same change whenever you add a route, table, RPC, or migration.

# BACKEND.md — Universal Pensions Uganda

Deep backend reference. Pair with `CLAUDE.md` (slim index) and `FRONTEND.md` (deep frontend reference).

Covers the Express + TypeScript routes under `api/**` (mounted by `server/index.ts` and hosted on **Render** — Singapore region, Node 22, free tier), the Supabase Postgres schema + RPCs + RLS in `supabase/migrations/*.sql`, the seed and utility scripts under `scripts/`, and the operational runbook for local + hosted environments. The frontend ships from **Vercel** (Vite preset, no functions); see `docs/render-operational.md` for the post-migration runbook and `renderplan.md` for the migration plan.

> **Scope note.** This platform is a sales-rep **demo**, not a production fintech. Many behaviours (any-6-digit OTP, hardcoded UGX 1,000 unit price, fixed 24h JWT TTL, no refresh, `demo_personas` fallback IDs, mocked KYC, mocked chat, per-session mutation stores) are intentional. See §14a — never reframe them as production-prep TODOs.

---

## §1. Architecture overview

```
                  ┌────────────────────────────────────────────────┐
                  │            Browser (React 19 SPA)              │
                  │   src/services/* → fetch(/api/...) +  JWT       │
                  │   src/services/supabaseClient.js → PostgREST    │
                  └────────────┬─────────────────────┬─────────────┘
                               │                     │
                  Authorization: Bearer <jwt>        │  apikey: anon_key
                               │                     │  Authorization: Bearer <jwt>
                               ▼                     ▼
              ┌────────────────────────┐   ┌─────────────────────────┐
              │   Render Web Service   │   │   Supabase PostgREST    │
              │   Express 5 / Node 22  │   │   (rest/v1, realtime)   │
              │   server/index.ts +    │   │                         │
              │   api/**/*.ts (Sing.)  │   │                         │
              └───────────┬────────────┘   └────────────┬────────────┘
                          │  supabase-admin             │  enforces RLS
                          │  (service-role key,         │  via auth.jwt()
                          │   bypasses RLS)             │  claims
                          ▼                             ▼
                  ┌─────────────────────────────────────────────────┐
                  │           Supabase Postgres (single DB)         │
                  │  29 tables · 2 ENUMs · pg_trgm · 8 triggers     │
                  │  53 functions (SECURITY DEFINER + INVOKER)      │
                  │  99 RLS policies (zero auth.uid() calls)        │
                  │  supabase_realtime publication: empty (0025)    │
                  └─────────────────────────────────────────────────┘
```

> The box reflects the **full live state of the Singapore DB** (`ilkhfnoyxlxwqadebnkp`, `ap-southeast-1`, cutover **2026-06-05**), with every migration `0001`–`0076` applied — so the counts already include the employer family + the `employer_invites` invite table (`0047`), the settlement/notification tables (`0030`/`0031`), the idempotency ledgers (`settlement_uploads` `0032`, `contribution_run_uploads` `0034`, `subscriber_signup_uploads` `0042`, `money_nonces` `0054`), the `0041` commission-aggregate RPCs, the **admin** role's RLS clones + create/overview/settlement RPCs (`0049`–`0051`), the `0052`–`0057` audit-remediation RPCs, the platform-scope + employer-activity rollups (`0058`/`0059`), the deactivate/reactivate stack (`0060`/`0061`), the contribution-model-v2 RPCs (`0062`), the **multi-product + save-to-cover insurance** stack (`0063`–`0068`, `0072`–`0074`; the sole new table since `0062` is `subscriber_insurance_products` from `0064` — see §10), the branch scope-guard + force-RLS hardening (`0069`/`0070`/`0071`), and the **2026-07-08 privilege-lockdown** fixes (`0075`/`0076`). **Live census (verified 2026-07-08): 29 tables · 2 ENUMs · 8 triggers · 53 functions · 99 RLS policies** (zero `auth.uid()` calls). ⚠️ **Ledger note:** migrations `0072` and `0074` were applied to live **out-of-band** (their effects were live, but no `supabase_migrations` ledger row existed); the 2026-07-08 audit re-applied `0075`+`0076` **with** ledger rows and reconciled the head — the live ledger head is now **`0076_subscribers_column_scoped_update`**. See §16 (BL-6).

**RLS-first.** Every direct write from a normal authenticated client must pass an explicit policy or go through a `SECURITY DEFINER` RPC. Tables with no INSERT/UPDATE/DELETE policy reject all client writes by default; the service-role key (server-only) bypasses RLS for seeding + the JWT-mint path.

---

## §2. Environment variables

The canonical template is `.env.local.example`. Three keys are public (`VITE_*` prefix, exposed to the browser at build time), three are server-only (never prefix with `VITE_`).

| Variable | Scope | Read by | Purpose | In `.env.local.example` |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Public (Vercel frontend) | `src/services/supabaseClient.js` | Supabase project URL (`https://<ref>.supabase.co`) | Yes |
| `SUPABASE_URL` | **Server-only (Render)** | `api/_lib/supabase-admin.ts` | Supabase project URL — server-side rename of `VITE_SUPABASE_URL` (G19). For backwards compat the admin client reads `SUPABASE_URL ?? VITE_SUPABASE_URL`. | Yes |
| `VITE_SUPABASE_ANON_KEY` | Public (Vercel frontend) | `src/services/supabaseClient.js` | PostgREST anon-tier key (default RLS-restricted) | Yes |
| `VITE_USE_SUPABASE` | Public (Vercel frontend) | `src/config/env.js` + every service file | Rollback flag — when `'false'`, services fall back to mockData (FRONTEND.md §4) | Yes |
| `VITE_API_BASE_URL` | Public (Vercel frontend, all 3 scopes) | `src/config/env.js` → `src/services/api.js` | Absolute backend URL baked into the bundle at Vite build time. Local: `http://localhost:3001/api`. Prod: `https://uganda-dashboard-api.onrender.com/api`. | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only (Render)** | `api/_lib/supabase-admin.ts` | Admin client used by all Express routes (bypasses RLS) | Yes |
| `SUPABASE_JWT_SECRET` | **Server-only (Render)** | `api/_lib/jwt.ts` | HS256 signing secret; same secret PostgREST uses to verify JWTs. **Copy verbatim from Supabase Dashboard → API → JWT Settings.** Do NOT regenerate during the Render migration (B21) — `withOptionalAuth` swallows verification errors and fails open. | Yes |
| `SENTRY_DSN` | **Server-only (Render)** | `server/index.ts` | Optional. Sentry error aggregation (free 5k events/mo). Init is DSN-gated and runs a PII scrubber (`server/sentryScrub.ts`) via `beforeSend`/`beforeBreadcrumb`; `sendDefaultPii: false`. | Yes (commented placeholder) |
| `VITE_SENTRY_DSN` | Public (Vercel frontend, optional) | `src/main.jsx` | Same Sentry project, frontend-side capture. Init runs the parallel scrubber (`src/utils/sentryScrub.js`); `sendDefaultPii: false`. | Yes (commented placeholder) |
| `SENTRY_RELEASE` | Server-only (Render, optional) | `server/index.ts` | Optional Sentry `release` tag. Falls back to Render's auto-injected `RENDER_GIT_COMMIT`; unset → no `release`. | No |
| `VITE_SENTRY_RELEASE` | Public (Vercel frontend, optional) | `src/main.jsx` | Optional Sentry `release` tag for the frontend (e.g. wired to a commit SHA at build). Vite only exposes `VITE_*` to `import.meta.env`, so a platform SHA must be re-exported under this name to reach the bundle; unset → no `release`. | No |
| `SUPABASE_DB_URL` | **Local-only** | `scripts/seed-supabase.mjs` | Postgres pooler URL (port 6543) for `npm run seed` | Yes |
| `PORT` | **Server-only (Render + local dev)** | `server/index.ts` | Express listen port. Render injects this automatically; local dev defaults to `3001`. | Yes |

### Frontend-only keys consumed by `src/config/env.js`

These keys are read by the frontend but **missing from `.env.local.example`** (audit X5). Defaults are baked into `src/config/env.js`, so the demo runs without them — list and add as needed:

| Variable | Default fallback |
|---|---|
| `VITE_API_BASE_URL` | `/api` only as a legacy fallback. Post-Render-migration the live value is set in Vercel project env (all 3 scopes) to the absolute Render URL (e.g. `https://uganda-dashboard-api.onrender.com/api`); local dev uses `http://localhost:3001/api`. Vite bakes the value at build time — changing it requires a Vercel redeploy. |
| `VITE_LEGAL_TERMS_URL` | `https://universalpensions.com/legal/terms` |
| `VITE_LEGAL_PRIVACY_URL` | `https://universalpensions.com/legal/privacy` |
| `VITE_SUPPORT_WHATSAPP_URL` | `https://wa.me/256700123456` |
| `VITE_SUPPORT_WHATSAPP_DISPLAY` | `+256 700 123 456` |
| `VITE_SUPPORT_EMAIL` | `support@upensions.ug` |

### Notes

- **Never run `vercel env pull`** — it overwrites `.env.local` and wipes `SUPABASE_DB_URL`, which is local-only by design and not stored in Vercel.
- `VITE_*` keys are inlined into the client bundle at build time. Don't put a service-role key behind a `VITE_` prefix even by accident — it would ship to every browser.
- `api/_lib/jwt.ts` treats `SUPABASE_JWT_SECRET` as **raw UTF-8** (`new TextEncoder().encode(raw)`). PostgREST / GoTrue verify HS256 with the same UTF-8 byte interpretation; base64-decoding would mint tokens PostgREST rejects (`PGRST301`).
- `api/_lib/supabase-admin.ts` and `api/_lib/jwt.ts` both hard-fail at first invocation if their env vars are missing (no deploy-time preflight — audit X14). Cold-boot 500s with a "X is not set" message are diagnostic.
- `src/services/supabaseClient.js` falls back silently to `http://localhost:54321` / `'public-anon-key'` if the `VITE_*` keys are absent (audit X6); a misconfigured Vercel preview ships a broken-but-running app.
- **Sentry PII scrubber (BL-26 / H-4).** Both Sentry inits (`server/index.ts` §0, `src/main.jsx`) run a `beforeSend`/`beforeBreadcrumb` scrubber that redacts Ugandan phone numbers, `role:phone` ids (the JWT `sub` / `users.id`), bearer tokens / JWTs, and password/auth fields from event messages, exception values, breadcrumbs, request data/headers, extra, contexts, and user. `sendDefaultPii` is explicitly `false`. The two scrubber modules (`server/sentryScrub.ts` for `@sentry/node`, `src/utils/sentryScrub.js` for `@sentry/react`) are **intentionally identical** and must be kept in sync — they live in separate build graphs (tsc NodeNext `rootDir: ..` can't reach `src/`, and Vite bundles the frontend copy). Frontend coverage is unit-tested in `src/utils/__tests__/sentryScrub.test.js`.
- **Frontend source maps (BL-29 / H-5).** `vite.config.js` sets `build.sourcemap: 'hidden'` — `.map` files are emitted to `dist/assets/` but the bundle carries no `//# sourceMappingURL=` comment, so it stays minified to end users while maps remain on disk for a future symbolication step. There is intentionally **no `@sentry/vite-plugin`** upload (demo posture — don't over-build). Consequence: the frontend Sentry init (`src/main.jsx`) is **best-effort**; when `VITE_SENTRY_DSN` is set, captured frontend stack frames are minified unless the emitted maps are manually uploaded to the matching Sentry `release`. Backend `@sentry/node` traces are unaffected (Node runs unminified `dist-server/`).

---

## §3. API route inventory

**14 routes** live under `api/`. They were originally written as Vercel serverless functions; post-Render-migration `server/index.ts` mounts each one via a thin `toExpress(handler)` adapter (`server/adapter.ts`) using `app.all('/api/.../<route>', toExpress(<handler>))`. `app.all` (not `app.post`) preserves the per-handler manual 405 contract (B5). All routes accept only `POST`; non-POST returns 405 `{ code: 'method_not_allowed' }` with `Allow: POST`. Breakdown:

- **4 auth routes** — `send-otp`, `verify-otp`, `verify-password`, `change-password`
- **8 KYC routes** — `otp-send`, `otp-verify`, `id-ocr`, `id-quality`, `face-match`, `aml-screen`, `nira-verify`, `agent-referral`
- **2 misc routes** — `contact`, `chat`

The count went from 12 → 14 with the Phase 1 password rollout (`verify-password` + `change-password` shipped as part of the `0026_users_password_hash.sql` work).

| # | Method | Path | Auth | Body | 2xx response | Handler file |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/auth/send-otp` | Public | `{ phone, role }` | `{ success: true }` | `api/auth/send-otp.ts` |
| 2 | POST | `/api/auth/verify-otp` | Public | `{ phone, otp, role, password? }` | `{ token, user }` | `api/auth/verify-otp.ts` |
| 3 | POST | `/api/auth/verify-password` | Public | `{ phone, role, password }` | `{ token, user }` | `api/auth/verify-password.ts` |
| 4 | POST | `/api/auth/change-password` | Bearer JWT (inline) | `{ currentPassword?, newPassword }` | `{ ok: true, hasPassword: true }` | `api/auth/change-password.ts` |
| 5 | POST | `/api/kyc/id-quality` | Public | `{ front?, back? }` | `QualityReport` (blur/corners/glare/pass/score) | `api/kyc/id-quality.ts` |
| 6 | POST | `/api/kyc/id-ocr` | Public | `{ front, back, sessionId? }` | `IdExtraction` (fullName, nin, dob, …, confidence) | `api/kyc/id-ocr.ts` |
| 7 | POST | `/api/kyc/nira-verify` | Public | `{ payload, sessionId? }` | `NiraResult` (`match`/`partial`/`no-match`) | `api/kyc/nira-verify.ts` |
| 8 | POST | `/api/kyc/otp-send` | Public | `{ phone }` | `{ success: true, expiresIn: 300 }` | `api/kyc/otp-send.ts` |
| 9 | POST | `/api/kyc/otp-verify` | Public | `{ phone, code }` (4-digit) | `{ verified: boolean }` | `api/kyc/otp-verify.ts` |
| 10 | POST | `/api/kyc/face-match` | Public | `{ selfieFile, nin, sessionId? }` | `FaceMatchResult` (match + liveness + score) | `api/kyc/face-match.ts` |
| 11 | POST | `/api/kyc/aml-screen` | Public | `{ payload, sessionId? }` | `{ outcome: 'clear' \| 'flagged', trackingId }` | `api/kyc/aml-screen.ts` |
| 12 | POST | `/api/kyc/agent-referral` | Public | `{ phone, reason, stage?, trackingId?, sessionId? }` | `{ ticketId, eta }` | `api/kyc/agent-referral.ts` |
| 13 | POST | `/api/chat` | `withOptionalAuth` | `{ message, context? }` | `{ reply, suggestions? }` | `api/chat.ts` |
| 14 | POST | `/api/contact` | Public | `{ name, email, message }` | `{ submitted: true, id }` | `api/contact.ts` |
| 15 | POST | `/api/access-request` | Public | `{ type: 'employer'\|'distributor', orgName, contactName?, contactEmail?, contactPhone?, sector?, district? }` | `{ submitted: true, id }` | `api/access-request.ts` |

### Cross-cutting notes

- `agent-referral.ts` and `contact.ts` write through `supabaseAdmin` (service-role) because the caller has no JWT — RLS would otherwise block the INSERT.
- All KYC stubs simulate realistic latencies (600–2200 ms) so the live demo's animated checks remain visible.
- Force-overrides via `x-qa-force` header are documented inline at each KYC file (e.g. `fail-blur`, `partial`, `flagged`, `liveness-fail`).
- All 14 routes set `Cache-Control: no-store` at the top of the handler, so every response path (success + 4xx + 405) is uncacheable (Phase 1G `1f0e2e1`; the 7 KYC mock routes had it added in BL-16 — they previously omitted it). Auth tokens, KYC verification state / identity PII (`id-ocr`), and contact-form IDs must never be cached.
- All 14 routes use a unified error envelope `{ code: '<snake>', message?: '<ops-detail>' }`. Full vocabulary in §5.

### KYC phone canonicalization (Phase 1E `d0b805d`)

The 3 phone-accepting KYC routes (`otp-send`, `otp-verify`, `agent-referral`) now call `toCanonicalUGPhone()` on the body's `phone` field before any downstream use — same contract as the auth routes. `agent-referral` additionally persists the canonical `+256XXXXXXXXX` form into `agent_referrals.phone`, so support staff can cross-match referrals against the rest of the codebase's canonical phones. The other 5 KYC routes (`id-quality`, `id-ocr`, `nira-verify`, `face-match`, `aml-screen`) don't accept `phone` in their body.

### KYC verification refusals stay 200 (demo scope)

The 3 verifier routes — `nira-verify`, `aml-screen`, `face-match` — return HTTP 200 with a body-field refusal (`result: 'partial' | 'no-match'`, `outcome: 'flagged'`, `match: false`) rather than 4xx. Each carries an inline `// B16 demo-scope intentional: …` comment confirming the intent. Clients inspect body fields, not status (Phase 1D `43f67e5`).

---

## §4. `api/_lib/` and per-domain `_lib/` helpers

Server-only. Three layers: top-level `api/_lib/` for cross-domain helpers, `api/auth/_lib/` for auth-only helpers, `api/kyc/_lib/` for KYC-only helpers.

### `api/_lib/` (6 files)

| File | Purpose | Exports |
|---|---|---|
| `api/_lib/jwt.ts` | HS256 sign/verify via `jose`. UTF-8 secret interpretation (PGRST301-correct). | `signJwt(claims) → Promise<string>`, `verifyJwt(token) → Promise<JwtClaims>`, types |
| `api/_lib/supabase-admin.ts` | Singleton service-role client (RLS-bypassing). Proxy-deferred init. | default `supabaseAdmin` |
| `api/_lib/bearer.ts` | `Bearer <token>` header extractor; canonical parse for the three callers below. Phase 1A `aab34e9`. | `extractBearer(req: VercelRequest) → string \| null` (default + named) |
| `api/_lib/phone.ts` | UG-phone canonicalization to `+256XXXXXXXXX`. `parseUGPhoneLocal` and `isValidUGPhone` were removed in Phase 1H `b91f6eb` (dead exports). | `toCanonicalUGPhone(raw) → string` |
| `api/_lib/withAuth.ts` | Bearer-JWT middleware; 401 `{ error: 'unauthorized' }` on missing/invalid. Reserved for future Employer/Admin role rollouts (commented inline at the export site, Phase 1H `b91f6eb`). | `withAuth(handler) → VercelHandler`, types `AuthedRequest` / `AuthedHandler` |
| `api/_lib/withOptionalAuth.ts` | Bearer-JWT middleware; attaches `req.user: null` on miss. Used by `/api/chat`. | `withOptionalAuth(handler) → VercelHandler`, types `MaybeAuthedRequest` / `MaybeAuthedHandler` |

Both middlewares delegate header parsing to `extractBearer` from `bearer.ts` — no inline duplication remains.

### `api/auth/_lib/` (3 modules)

Auth-only helpers, owned by `verify-otp` / `verify-password` / `change-password`.

| File | Purpose | Exports |
|---|---|---|
| `api/auth/_lib/password.ts` | Sole consumer of `bcryptjs`. Pre-existing (untouched by Phase 1). | `validatePasswordShape`, `hashPassword`, `verifyPassword` |
| `api/auth/_lib/personas.ts` | Persona resolution shared between `verify-otp` and `verify-password`. Phase 1C `c3b54a3`. | `ROLE_DEFAULTS`, `resolveSubscriber`, `resolveDemoPersona`, `ResolvedIdentity` type |
| `api/auth/_lib/claims.ts` | JWT-claim + response-DTO assembly. Phase 1C `c3b54a3`. | `buildJwtClaims`, `buildAuthResponseUser`, `buildAuthResponseDto`, `AuthResponse` / `AuthResponseUser` types |

**`password.ts` API (unchanged from pre-Phase-1):**

- `validatePasswordShape(plain)` — synchronous; returns `null` on pass, or one of: `password_required`, `password_too_short`, `password_too_long` (72-**byte** cap — bcrypt's hard limit), `password_too_weak` (must contain letter + digit).
- `hashPassword(plain)` — bcrypt `COST = 10` (~80ms).
- `verifyPassword(plain, hash)` — returns `false` (never throws) for any failure mode: missing hash, malformed hash, mismatch.

**`personas.ts` API:**

- `ROLE_DEFAULTS: Record<JwtRole, string>` — the demo-stable fallback entity IDs (`subscriber → 's-0001'`, `agent → 'a-001'`, `branch → 'b-kam-015'`, `distributor → 'd-001'`, `employer → 'emp-001'`). Mirrors the seed personas; sync is manual (audit D18).
- `resolveSubscriber(supabaseAdmin, phone)` — newest-wins lookup on `subscribers (phone)`. Returns `null` when no match OR the lookup errored (the caller falls back to `ROLE_DEFAULTS.subscriber`). DB errors are logged with the `[auth/personas]` tag and treated as non-fatal at the helper layer; the route catches them via `DbError` for the upsert path only.
- `resolveDemoPersona(supabaseAdmin, phone, role)` — `(phone, role)` lookup on `demo_personas`; always returns an identity (falls back to `ROLE_DEFAULTS[role]` when no row matches). Used for the 3 non-subscriber roles.

**`claims.ts` API:**

- `buildJwtClaims({ role, phone, entityId }) → JwtSignInput` — assembles `sub`, `role: 'authenticated'`, `app_role`, `phone`, and the role-scoped `subscriberId` / `agentId` / `branchId` / `distributorId` / `employerId` claim (the `employer` branch emits `employerId`).
- `buildAuthResponseUser({ role, phone, entityId, hasPassword, name? }) → AuthResponseUser` — assembles the `user` half of the response body.
- `buildAuthResponseDto({ token, role, phone, entityId, hasPassword, name? }) → { token, user }` — convenience wrapper. Both `verify-otp` and `verify-password` call this exactly before `res.status(200).json(...)`, so the two routes mint byte-identical payloads.

Phase 1C lifted these from verbatim duplicates inside `verify-otp.ts` and `verify-password.ts`. The OTP-vs-password parity (`AuthContext.login` consumes either) is now enforced by a shared module rather than by hand-syncing two files.

### `api/kyc/_lib/` (1 module)

| File | Purpose | Exports |
|---|---|---|
| `api/kyc/_lib/mocks.ts` | Smile ID v2 tracking-id shape generator. Phase 1B `92cada2`. | `mockTrackingId(prefix?: string) → string` (defaults to `'smile'`) |

Returns `${prefix}_${ts36}_${rand36}` (e.g. `smile_lwxa3y2k_4f9q2z`). Consumed by `face-match.ts`, `aml-screen.ts`, `nira-verify.ts`. The separator (`_`, not `-`) and prefix default are deliberate — QA fixtures hard-code the shape. Keep stable.

### JWT claim shape (single source of truth)

```ts
type JwtRole = 'subscriber' | 'agent' | 'branch' | 'distributor' | 'employer';

type JwtClaims = {
  iss: 'upensions';                    // hardcoded
  sub: string;                         // entity ID (subscriber/agent/branch/distributor/employer row id)
  role: 'authenticated';               // Postgres role for PostgREST SET ROLE — NEVER the app role
  app_role: JwtRole;                   // application role; RLS reads this
  phone: string;                       // canonical +256...
  subscriberId?: string;               // when app_role === 'subscriber'
  agentId?: string;                    // when app_role === 'agent'
  branchId?: string;                   // when app_role === 'branch'
  distributorId?: string;              // when app_role === 'distributor'
  employerId?: string;                 // when app_role === 'employer' (camelCase claim; RLS reads auth.jwt() ->> 'employerId')
  aud: 'authenticated';                // required by PostgREST RLS
  iat: number;
  exp: number;                         // iat + 24h (DEFAULT_EXPIRY_SECONDS)
};
```

- `signJwt` defaults `iss/aud/iat/exp/role` when omitted and signs via `new SignJWT(...).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })`.
- `verifyJwt` validates signature + audience + issuer + expiry. Any failure throws — callers map to 401.
- TTL: `DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24` (24h, single source — audit B20). No refresh path.
- Secret bytes are cached on first decode (`getSecretKey()`).

### Supabase admin client

`supabase-admin.ts` returns a Proxy that lazy-instantiates the client on first property access, so unit tests + type-check passes don't throw when env vars are missing. The real client is built with `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }` — critical under the **long-lived Render Express process** (G66). The previous Vercel topology rebuilt the client per invocation, masking any session-related drift; under a singleton, leaving these flags unset would leak token-refresh timers across requests. If any future code path imports the admin client with different `auth` options, an internal refresh timer could fire on a stale token and break authenticated reads silently.

**Role claim is frozen at JWT mint time (G57).** `api/auth/_lib/claims.ts:50-66` encodes `app_role` when the token is minted. If the underlying `users.role` row changes in the database (e.g. admin manually re-roles a user), the change does NOT propagate until the user re-logs in. There is no refresh path. Doc-only awareness item; no code change.

### `withAuth` vs `withOptionalAuth`

- `withAuth` rejects with `401 { error: 'unauthorized' }` if Bearer is missing or invalid. **Currently wraps no routes** — reserved for future Employer/Admin endpoints (commented inline at the export site, Phase 1H `b91f6eb`). `change-password.ts` still does inline `extractBearer` + `verifyJwt` because its 401 payload uses `{ code: 'unauthorized' }` (the rest of the route's vocabulary) and the unified error envelope post-Phase-1D would diverge from `withAuth`'s `{ error }` literal.
- `withOptionalAuth` swallows invalid tokens and attaches `req.user = null`. Used by `/api/chat` so the landing-page chat works for unauthenticated visitors while signed-in users get role-aware replies.
- Both middlewares delegate header parsing to `extractBearer` from `api/_lib/bearer.ts` — Phase 1A removed the previous 3× inline duplication.

---

## §5. Auth flow end-to-end

### OTP path (legacy / fallback)

1. **`POST /api/auth/send-otp`** — Validates `phone` and `role` shape, then canonicalises the phone via `toCanonicalUGPhone`. No SMS provider is wired in (demo scope). Returns `{ success: true }` on a well-formed body.
2. **User enters any 6-digit code** (demo OTP — see §15a).
3. **`POST /api/auth/verify-otp`** — Validates `phone` + `otp` (`^\d{6}$`) + `role`; canonicalises phone; optionally validates a `password` shape if the caller is signing up with a fresh credential. Then:
    - If `role === 'subscriber'`, calls `resolveSubscriber` (newest-wins query on `subscribers (phone)` — see `api/auth/_lib/personas.ts`). If no match → falls back to `ROLE_DEFAULTS.subscriber = 's-0001'` (every demo login succeeds; CLAUDE.md §8).
    - For other roles, calls `resolveDemoPersona`, which looks up `demo_personas` by `(phone, role)` and falls back to `ROLE_DEFAULTS[role]` (`agent → 'a-001'`, `branch → 'b-kam-015'`, `distributor → 'd-001'`, `employer → 'emp-001'`). The seed lands a `demo_personas` row for `EMPLOYER_DEMO_PHONE` (`+256700000031` → `emp-001`); any other phone on the `employer` role still succeeds via the `emp-001` fallback.
    - Hashes the supplied password (if any) **after** the role lookup so a malformed phone/role short-circuits before the ~80ms bcrypt cost.
    - **Deactivation gate (commit `b73e577`).** After resolving the role-scoped entity ID, calls `isEntityDeactivated` (shared helper `api/auth/_lib/entity-status.ts`). A deactivated agent / branch / distributor / employer (entity-table `status = 'inactive'`, migration `0060`) is turned away with `403 { code: 'account_deactivated', message: '…' }` and never receives a JWT. Subscribers + admin are NEVER gated (absent from the helper's `STATUS_TABLE`, so the lookup short-circuits to `false`); the lookup is also NON-FATAL on any Supabase error / missing demo-fallback row (returns `false` so the `demo_personas` fallback IDs still log in).
    - Upserts `users(phone, role, last_login_at, password_hash?)` with deterministic PK `id = '<role>:<phone>'`, on-conflict target `(phone, role)`. A Supabase `error` on the upsert path is wrapped in a local `DbError` and surfaced as `500 { code: 'db_error' }` (a bare code — the `message` field was removed in commit `1a5c370`). PGRST116 ("no row") is treated as non-fatal — the upsert reports `hasPassword: Boolean(passwordHash)` and login still succeeds.
    - Builds the JWT claims via `buildJwtClaims` and the response body via `buildAuthResponseDto` (both from `api/auth/_lib/claims.ts`), signs the token with `signJwt`.
4. **Response:** `{ token, user }` where `user = { role, phone, hasPassword, name?, subscriberId|agentId|branchId|distributorId|employerId }`. `AuthContext.login` writes the token to `localStorage.upensions_token` and the user payload to `localStorage.upensions_auth`.

### Password path (`/api/auth/verify-password`)

Companion to `verify-otp` shipped with `0026_users_password_hash.sql`. Same response DTO — `AuthContext.login` consumes either.

1. Looks up `users` by `(phone, role)` (UNIQUE) to fetch `password_hash`. Real DB lookup error → `500 { code: 'db_error' }` (a bare code — the `message` field was removed in commit `1a5c370`) — distinct from the `password_not_set` auth-failure UX path.
2. NULL hash or no row → `401 { code: 'password_not_set' }` (UI maps this to "use OTP instead").
3. Defense-in-depth role re-check against the row's stored role → `401 { code: 'role_mismatch' }` if the stored role disagrees with the requested role (the SELECT already filters by role, so this is a belt-and-braces guard against future refactors / mid-flight role rewrites).
4. `bcrypt.compare` against `password_hash`. Mismatch → `401 { code: 'invalid_password' }`.
5. Resolves the role-scoped entity ID using the same shared `resolveSubscriber` / `resolveDemoPersona` helpers as `verify-otp` (Phase 1C `c3b54a3`).
6. **Deactivation gate (commit `b73e577`).** After the bcrypt compare AND entity-ID resolution, calls the same `isEntityDeactivated` helper (`api/auth/_lib/entity-status.ts`) as `verify-otp`. A CORRECT password on a deactivated agent / branch / distributor / employer is still turned away with `403 { code: 'account_deactivated', message: '…' }` (a WRONG password already returned `401 invalid_password` at step 4, so a deactivated account never reveals its status via this code). Subscribers + admin are never gated; the lookup is non-fatal on error / missing row.
7. Best-effort `last_login_at` UPDATE (non-fatal on failure).
8. Mints the JWT and response body via the same `buildJwtClaims` / `buildAuthResponseDto` helpers as `verify-otp` — payloads are byte-identical (`hasPassword` is always `true` on this path).

### `change-password` flow

Authenticated. Body: `{ currentPassword?, newPassword }`. Reads JWT inline via `extractBearer` (from `api/_lib/bearer.ts`, Phase 1A `aab34e9`) + `verifyJwt`. Two flows:

- **Initial set** — row has `password_hash IS NULL`. Skip the currentPassword check; just stamp the new hash.
- **Change** — row already has a hash. Require + bcrypt-verify `currentPassword` before update.

Error vocabulary: `unauthorized`, `current_password_required`, `current_password_invalid`, `password_required` / `password_too_short` / `password_too_long` / `password_too_weak`, `user_not_found`, `db_error` (for lookup or update failures — now a bare `{ code: 'db_error' }`; the Supabase-`error.code`-in-`message` detail was removed in commit `1a5c370`), `unexpected_error`.

### Subsequent requests

Frontend uses the JWT in `Authorization: Bearer <token>` and `apikey: <anon_key>` headers when hitting PostgREST. RLS predicates read `auth.jwt() ->> '<claim>'` — **NOT** `auth.uid()`, which is `NULL` for custom HS256 tokens.

### Expiry

24h fixed TTL, no refresh. On 401 from any service call, `services/api.js` dispatches an `onAuthExpired` event; `AuthContext` consumes it to logout + redirect (FRONTEND.md §5).

### Unified error envelope across all 14 routes

Every route returns `{ code: '<snake>', message?: '<ops-detail>' }` for non-200 responses (Phase 1D `43f67e5`). The vocabulary partitions cleanly into two classes:

**Auth-failure codes (stable client UX).** Surface domain-level outcomes that the frontend branches on:

- `invalid_otp` — bad OTP shape or unknown phone (verify-otp).
- `invalid_password` — bcrypt compare failed (verify-password).
- `password_not_set` — no `users` row OR `password_hash IS NULL` (verify-password). UI maps to "use OTP instead".
- `wrong_old_password` / `current_password_invalid` — supplied `currentPassword` failed verify (change-password).
- `current_password_required` — row has hash but body omitted `currentPassword` (change-password).
- `role_mismatch` — defense-in-depth (verify-password).
- `account_deactivated` — `403` from BOTH `verify-otp` and `verify-password` when the resolved agent / branch / distributor / employer entity has `status = 'inactive'` (admin deactivation, migration `0060`; gate added in commit `b73e577` via the shared helper `api/auth/_lib/entity-status.ts`). The body carries a customer-facing `message` ("This account has been deactivated. Please contact support to reactivate it."); `src/services/auth.js:messageForCode` maps the code to that string. Subscribers + admin are never gated.
- `unauthorized` — missing / invalid / expired JWT (change-password).
- `user_not_found` — JWT claims point at a `(phone, role)` pair with no row (change-password).

**`db_error` (real DB failures, distinct from auth fails).** `500 { code: 'db_error' }` — a **bare code, no `message` field** (the Supabase-`error.code`-in-`message` detail was removed in commit `1a5c370`; verify-otp, verify-password, and change-password all now return just `{ code: 'db_error' }`, and the route tests assert exactly that). Ops can still grep `db_error` in logs (the Supabase error is logged via `console.error` on the server) to triage actual Supabase failures without it being masked by the demo's `invalid_otp` / `password_not_set` UX codes.

**`unexpected_error` (generic 500).** `500 { code: 'unexpected_error' }` — the generic-catch path for `verify-otp` / `verify-password` when an unanticipated error (e.g. `signJwt` failure) bubbles up that isn't a typed `DbError` (BL-39). Status and code agree: the 4xx UX vocabulary (`invalid_otp` / `invalid_request`) is reserved for client-correctable shape failures and is never returned with a 500. The frontend's `mapAuthErrorMessage` has no explicit branch for `unexpected_error`, so it degrades to the default error message. Matches the server's final error-handler shape (`server/index.ts §12`).

**405 envelope.** Every route returns `{ code: 'method_not_allowed' }` with an `Allow: POST` response header (Phase 1D `43f67e5`).

**`Cache-Control: no-store`** — set unconditionally at the top of every handler, so every response path (success + 4xx + 405) is uncacheable (Phase 1G `1f0e2e1`; extended to the 7 KYC mock routes — `otp-send`, `otp-verify`, `id-ocr`, `id-quality`, `face-match`, `aml-screen`, `nira-verify` — in BL-16, which previously lacked it). Auth tokens, KYC verification state / identity PII (`id-ocr`), and contact-form IDs must never be cached.

---

## §6. Custom HS256 JWT model — why NOT Supabase Auth

Supabase Auth ships email/password + magic-link plus a `sub = auth.users.id` claim. The platform needs role-scoped entity IDs (`subscriberId` / `agentId` / `branchId` / `distributorId`) directly on the token so RLS predicates like `agent_id = auth.jwt() ->> 'agentId'` resolve in a single column read. The custom JWT keeps the same `aud: 'authenticated'` audience PostgREST expects, signed with `SUPABASE_JWT_SECRET`, so all of PostgREST + RLS + the Realtime channel accept it natively.

### `auth.uid() = NULL` consequence

Because we never go through Supabase Auth (no `auth.users` row, no `sub` = a Supabase user UUID), `auth.uid()` returns `NULL` for every request. Any RLS policy or RPC that reads `auth.uid()` silently fails — every policy in this repo reads claims via `auth.jwt() ->> '<key>'` instead.

### The `auth.jwt() ->> 'app_role'` vs `'role'` trap (canonical citation)

Hard anti-pattern: **never read `auth.jwt() ->> 'role'` and compare against application role values** (`'distributor'`, `'agent'`, `'branch'`, `'subscriber'`).

- PostgREST requires the JWT to carry `role: 'authenticated'` (the Postgres role) so it can issue `SET ROLE authenticated`. With JWTs minted by `signJwt`, **every** `auth.jwt() ->> 'role'` returns the literal string `'authenticated'`.
- The application role lives in a separate `app_role` claim. RLS + RPCs MUST read `auth.jwt() ->> 'app_role'`.

Historical incidents this exact mistake produced:

- **0018 rollup-zero regression.** `get_entity_metrics_rollup` read `'role'` for its role gate; every drill-down rendered `0` subscribers / `—` AUM. Fixed in 0020 (after an abandoned 0019 raw-psql hotfix and a remote-only `fix_metrics_rollup_app_role` migration — see §7).
- **0004 commission-RPC silent failures.** The 13 state-machine RPCs read `'role'`; every branch/agent action raised `role_not_permitted`. Fixed by 0007 (DO block + `pg_get_functiondef` literal-string swap) and again by 0021 (re-emitted bodies as canonical).

Contract-enforced by `src/tests/jwt-claim-contract.test.js`. The audit (D1, re-confirmed 2026-06-08) confirmed the discipline holds; on the live new DB all **~90 policies + every user-facing RPC** read `app_role` correctly (zero `auth.uid()`).

---

## §7. Migration discipline

Forward-only. Never edit a shipped migration. For schema fixes, add a new `00NN_*.sql`.

### Numbering

Files are zero-padded, monotonically increasing. **0019 was historically absent** — it was a remote-only raw-psql hotfix for the metrics-rollup `app_role` bug, never committed at the time (the canonical body fix landed as 0020). It has since been **backfilled as `0019_fix_metrics_rollup_app_role.sql`** (a defensive, idempotent ACL-only migration capturing the original hotfix), so the tree now holds a contiguous `0001`–`0076`. The live Singapore DB records it in the ledger as `0019`. See `0020_entity_metrics_rollup_v3.sql:3–5` for the supersession history.

### `.down.sql` partners

Newer migrations ship a `.down.sql` partner alongside the forward file (`0016`, `0022`–`0026`, and every migration `0029`–`0076`). Older migrations (`0001`–`0015`, plus the backfilled `0019`) do not have downs.

### Idempotency

Re-running migrations should be safe. The audit (D12) flagged **four** migrations as **missing idempotency guards** on at least one statement:

- `0003_rls_policies.sql` — `CREATE POLICY` statements without `DROP POLICY IF EXISTS` (re-run would error on existing policy names).
- `0006_trigger_security_definer.sql` — `ALTER FUNCTION ... SECURITY DEFINER` statements (re-run is idempotent in pg, but no guards exist; not strictly broken).
- `0010_function_search_path.sql` — bare `ALTER FUNCTION ... SET search_path` (same as 0006 — pg-safe to re-run, but no guards).
- `0025_drop_realtime_publication.sql` — `ALTER PUBLICATION ... DROP TABLE` does **not** accept `IF EXISTS`; sequential drops would fail loudly if the publication state has drifted (the file comment explicitly documents this).

The remaining migrations use `IF NOT EXISTS` / `IF EXISTS` / `CREATE OR REPLACE` / `DROP ... IF EXISTS` guards consistently. **`0028_replay_safety_guards.sql` re-asserts the end-state of these four in a forward-only, idempotent way** (it does NOT edit the historical files) — each block is a no-op if the prior migration already succeeded, so a replay against a fresh DB converges. This is why the new Singapore DB (built by replaying `0001`–`0042` in order) applied cleanly.

### Migration inventory

> **Applied state (live DB).** All migrations `0001`–`0076` are applied on the live Singapore project (`ilkhfnoyxlxwqadebnkp`, `ap-southeast-1`, cutover **2026-06-05**); the ledger head is **`0076_subscribers_column_scoped_update`** (verified 2026-07-08). Per-row "applied to live 2026-06-03" tags below are **historical** — they record when a migration first reached the *old* Tokyo prod; on the live DB they are simply part of the applied chain. The `0037`/`0038`/`0039` rows that previously read "NOT YET APPLIED TO LIVE — gated cutover step" are **now applied** (the cutover happened). The `0043`–`0062` batch (subscriber⇄employer unification, invite-based onboarding, the **admin** role, the 2026-06-08 audit-remediation RPCs, the platform-scope + employer-activity rollups, the deactivate/reactivate stack, and contribution-model-v2) is applied as well. **The inventory table below is catalogued through `0062`;** the `0063`–`0076` migrations (multi-product + save-to-cover insurance, branch scope-guard/force-RLS, and the 2026-07-08 privilege-lockdown) are documented in **§10** and §16. ⚠️ **Ledger note:** `0072` and `0074` reached live **out-of-band** (effects live, no ledger row); the 2026-07-08 audit applied `0075`+`0076` **with** ledger rows and reconciled the head — see §16 (BL-6).

| File | Lines | Scope |
|---|---|---|
| `0001_initial_schema.sql` | 494 | 21 tables · 4 ENUMs · 8 indexes · `pg_trgm` extension |
| `0002_rpc_functions.sql` | 1,290 | 4 trigger fns · 7 read RPCs · 2 atomic-write RPCs · 2 private helpers |
| `0003_rls_policies.sql` | 896 | 65 policies · ENABLE + FORCE RLS on all 20 tables · realtime tuning (later dropped by 0025) |
| `0004_commission_run_rpcs.sql` | 1,055 | 13 SECURITY DEFINER state-machine RPCs |
| `0005_subscriber_update_fix.sql` | 72 | Drops correlated-subquery WITH CHECK; adds `trg_subscribers_enforce_editable_cols` |
| `0006_trigger_security_definer.sql` | 28 | Promotes 3 trigger fns to `SECURITY DEFINER` + pinned search_path |
| `0007_rls_use_app_role.sql` | 715 | Swaps every `'role'` → `'app_role'` across policies + RPC + trigger bodies |
| `0008_rls_wrap_auth_jwt_initplan.sql` | 638 | Wraps `auth.jwt()` in `(SELECT auth.jwt())` for InitPlan hoisting |
| `0009_fk_covering_indexes.sql` | 33 | FK covering indexes |
| `0010_function_search_path.sql` | 48 | Pins `search_path = public, pg_temp` on 11 INVOKER functions |
| `0011_drop_unused_indexes.sql` | 28 | Drops unused indexes |
| `0012_pg_trgm_into_extensions_schema.sql` | 35 | Moves `pg_trgm` to `extensions` schema |
| `0013_fk_covering_indexes_followup.sql` | 33 | More FK indexes |
| `0014_signup_phone_and_agent_dispute.sql` | 437 | `_canonical_ug_phone` · `_insert_subscriber_chain` rewrite · **`agent_dispute_line`** RPC |
| `0015_signup_insurance_and_premium_tx.sql` | 312 | `_insert_subscriber_chain` insurance toggle + premium tx fix |
| `0016_distributors_table.sql` (+ `.down.sql`) | 69 | `distributors` table + policies; seeds `d-001` |
| `0017_unique_constraints.sql` | 53 | `ux_agents_email`, `ux_subscribers_nin`, `ux_commissions_agent_subscriber` |
| `0018_entity_metrics_rollup.sql` | 532 | **Superseded by 0020** — left in tree (audit D4) |
| `0019_fix_metrics_rollup_app_role.sql` | 53 | **Backfilled hotfix** (was remote-only — audit D5). Defensive, idempotent ACL-only capture of the original `fix_metrics_rollup_app_role` remote hotfix that patched the 0018 `'role'`→`'app_role'` gate between 0018 and 0020. Body fix proper lives in 0020; this file exists so the tree is contiguous and the new-DB ledger records a `0019`. |
| `0020_entity_metrics_rollup_v3.sql` | 1,536 | Canonical metrics rollup. Reads `app_role` correctly. `_demo_now() = '2026-05-18'` |
| `0021_commission_rpcs_app_role.sql` | 1,055 | Re-emits all 13 commission RPCs reading `app_role` directly (canonical) |
| `0022_audit_perf.sql` (+ `.down.sql`) | 150 | `idx_transactions_type_date`, `idx_commissions_status`, `get_top_branch` rewrite |
| `0023_rls_initplan_fixes.sql` (+ `.down.sql`) | 52 | Duplicate-index drop, `distributors_update_self` InitPlan wrap, `_demo_now` search_path lock |
| `0024_upsert_nominees.sql` (+ `.down.sql`) | 147 | `nominees_share_range_chk` (`NOT VALID`) + `upsert_nominees` RPC |
| `0025_drop_realtime_publication.sql` (+ `.down.sql`) | 18 | Drops 3 tables from `supabase_realtime` (zero subscribers — Phase 1+2 confirmed) |
| `0026_users_password_hash.sql` (+ `.down.sql`) | 22 | Adds nullable `users.password_hash TEXT` for bcrypt digests |
| `0027_post_audit_polish.sql` | 212 | **Post-audit polish (ACL + CHECK + UNIQUE).** Closes 3 audit findings: D3 — adds the missing `REVOKE EXECUTE … FROM PUBLIC` preamble to `upsert_nominees`'s grant. D8 — adds defensive `CHECK` constraints on free-text status columns (`subscribers.kyc_status`, `withdrawals.status`, `claims.status`, …). D9 — a UNIQUE index on `nominees` to block duplicate-NIN within a `(subscriber_id, type)` bucket. **Note:** the D8 `commissions_status_chk` it added was a stale 7-value enum that did **not** include `'paid'` — later dropped by `0040` because it blocked `apply_settlement` from flipping lines to `paid`. |
| `0028_replay_safety_guards.sql` | 254 | **Replay-safety guards (audit D12).** Forward-only, idempotent re-assertion of the end-state of the four non-idempotent legacy migrations (`0003` `CREATE POLICY` → `DROP POLICY IF EXISTS`+recreate; `0006`/`0010` `ALTER FUNCTION` re-assert; `0025` publication drop guard). Does NOT edit the historical files — each block no-ops if already applied. This is what lets a fresh DB replay `0001`–`0042` cleanly. |
| `0029_commission_simplify.sql` (+ `.down.sql`) | 380 | **Commission simplification.** Drops the 14 state-machine + dispute RPCs, `get_run_branch_breakdown`, the `commissions_before_update` trigger/function, and the `settlement_runs` / `settlement_run_branch_reviews` tables (+ their enum types). Collapses `commission_status` to `('due','paid')`. Drops `commissions.{run_id, agent_confirmed, previous_status, dispute_reason, disputed_at, disputed_by, resolved_at, resolved_by, outcome_reason, hold_reason}`; adds `paid_amount NUMERIC`. Re-emits the 3 read RPCs (`get_commission_summary`, `get_entity_commission_summary`, `get_agent_commission_detail`) in slimmed paid/due-only form. |
| `0030_settlement_batches.sql` (+ `.down.sql`) | 72 | NEW `settlement_batches` table (one row per agent-settlement; SELECT-only RLS — distributor all, branch/agent own). |
| `0031_notifications.sql` (+ `.down.sql`) | 280 | NEW `notifications` table (`recipient_role` ∈ `agent`/`branch`; SELECT-only RLS) + the `apply_settlement(p_rows jsonb)` and `mark_notifications_read(p_ids text[])` RPCs. |
| `0032_fix_settlement_apply.sql` (+ `.down.sql`) | ~290 | **Settlement-apply correctness + idempotency.** `CREATE OR REPLACE`s `apply_settlement` as `(p_rows jsonb, p_nonce text DEFAULT NULL)` — FIFO per-line allocation (BL-1/BL-2), whole-UGX `round()` (BL-8), formatted notification bodies (BL-18). Settled lines now stamp each line's **own** `paid_amount` (not the whole batch total). Adds the `settlement_uploads` idempotency ledger (PK `nonce`, RPC-internal, RLS-forced, no grants) and `settlement_batches.client_nonce` (BL-13). Drops the 0031 single-arg `apply_settlement(jsonb)`. **Applied to live 2026-06-03.** |
| `0033_post_audit_hardening.sql` (+ `.down.sql`) | ~115 | **Post-audit DB hardening (pure DDL, no RPC change).** Adds `notifications.ref_id` FK → `settlement_batches(id) ON DELETE SET NULL` + a covering index (BL-15 — `ref_id` is provably only ever a batch id). Aligns the `settlement_batches` FK `ON DELETE` actions to the commissions convention: `agent_id` → `agents(id) ON DELETE CASCADE`, `branch_id` → `branches(id) ON DELETE SET NULL` (F-12). `ALTER TABLE distributors FORCE ROW LEVEL SECURITY` — the last RLS-enabled-but-not-FORCE'd table (BL-24). Fully guarded/idempotent. **Applied to live 2026-06-03** (after 0032 + a verified backup). |
| `0034_employer_schema_and_rls.sql` (+ `.down.sql`) | ~235 | **Employer schema + RLS (Phase 0).** 5 new tables — `employers`, `employees` (standalone roster, NOT subscribers; balances live here, not `subscriber_balances`), `contribution_runs`, `contribution_run_lines` (per-employee ledger; employees are NOT in `transactions`), `contribution_run_uploads` (idempotency ledger, parallel to `settlement_uploads`). TEXT PKs (`emp-001`, `empe-NNN`, `run-NNN`); ENABLE + FORCE RLS on all 5; indexes on `employees(employer_id)`, `contribution_runs(employer_id)`, `contribution_run_lines(run_id, employee_id)`. One SELECT policy per table scoped by the camelCase `employerId` claim (run_lines via an EXISTS join to the parent run); `contribution_run_uploads` has **no policy/grant** (RPC-internal). No client write policies — writes go through the 0035 RPCs. **Applied to live 2026-06-03.** |
| `0035_employer_rpcs.sql` (+ `.down.sql`) | ~520 | **Employer RPCs (Phase 0).** 5 SECURITY DEFINER functions, each gated on `app_role = 'employer'` + scoped to the `employerId` claim, `SET search_path = public, pg_temp`, house grant pattern (REVOKE PUBLIC / GRANT authenticated). `submit_contribution_run(p_rows, p_period_label, p_method, p_nonce)` — re-derives every amount server-side from `employees.salary` + `contribution_config`, splits gross by the employee's schedule, writes `contribution_run_lines` + bumps `employees` balances **inline** (UGX 1,000/unit), nonce-idempotent via `contribution_run_uploads`, skips suspended/not-owned/not-found/zero rows; **MUST NOT write `transactions`/`subscriber_balances`/`commissions`** (no commission code path is reachable). `update_employee_contribution_config`, `update_employee_insurance`, `update_employer_profile` (ownership-checked patches), `get_employer_metrics()` (STABLE — hero/overview aggregates). Structural template = `apply_settlement` (0032). **Applied to live 2026-06-03.** |
| `0036_anon_revoke_and_rls_initplan.sql` (+ `.down.sql`) | ~90 | **Anon-EXECUTE lockdown + employer RLS InitPlan fix** (commit `c6c0386`). REVOKEs EXECUTE FROM PUBLIC, anon and GRANTs to authenticated, service_role on the post-auth WRITE/admin RPCs: `apply_settlement`, `submit_contribution_run`, `update_employee_contribution_config`, `update_employee_insurance`, `update_employer_profile`, `create_subscriber_from_agent_onboard`, `mark_notifications_read`. **Deliberately KEEPS anon EXECUTE on `create_subscriber_from_signup`** (signup runs pre-JWT). Also wraps `auth.jwt()` in `(SELECT auth.jwt())` for the four 0034 employer SELECT policies (`employer_self_select`, `employees_by_employer_select`, `contribution_runs_by_employer_select`, `contribution_run_lines_by_employer_select`) to fix the `auth_rls_initplan` per-row re-eval. **Applied to live 2026-06-03.** |
| `0037_employee_monthly_contribution.sql` (+ `.down.sql`) | ~35 | **Funder-redesign data foundation (Phase 4).** Purely additive: `ALTER TABLE employees ADD COLUMN monthly_contribution NUMERIC NOT NULL DEFAULT 0` — the employee's OWN monthly saving (UGX), the base the new co-contribution employer match is computed against (see `0038`). snake_case, same shape/default as the sibling money columns; service layer maps to camelCase `monthlyContribution`. No backfill needed (seed sets per-row values; existing live rows default to `0`, which does not drive run-line derivation, so prior run totals stay identical). No RPC/policy/grant change. **Applied to the live Singapore DB at the 2026-06-05 cutover.** |
| `0038_co_contribution_match.sql` (+ `.down.sql`) | ~280 | **Co-contribution match model (Phase 5).** `CREATE OR REPLACE`s `submit_contribution_run` (same signature → keeps the existing REVOKE/GRANT) to switch ONLY the co-contribution branch to the **match model**: the employer matches `matchPct`% of each employee's own `monthly_contribution`, capped by an optional UGX maximum on the employer top-up. `co (matchPct present)`: `employee_half = round(monthly_contribution)`; `employer_half = round(employee_half * matchPct/100)`, then `LEAST(employer_half, round(maxContribution))` when set. **Dual-read legacy fallback** — a co row with `employeePct` and NO `matchPct` falls back to the OLD salary-based math (`employer_half = employerAmount ?? round(salary*employerPct/100)`, `employee_half = employeeAmount ?? round(salary*employeePct/100)`) so an un-migrated live row never zeroes out during cutover. `employer-only` branch unchanged. The 80/20 split, `employerId` gate, nonce idempotency, totals accumulation, and inline balance/units bump are byte-identical to `0035`; the full ⚠️ HARD CONSTRAINT (NEVER writes `transactions`/`subscriber_balances`/`commissions`) still holds. **Applied to the live Singapore DB at the 2026-06-05 cutover.** |
| `0039_apply_group_insurance.sql` (+ `.down.sql`) | ~90 | **Roster-wide group life insurance (Phase 7).** Adds ONE SECURITY DEFINER RPC, `apply_group_insurance(p_cover numeric) → jsonb` — the roster-wide analogue of `update_employee_insurance`. Gated on `app_role = 'employer'` + scoped to the `employerId` claim; sets a FLAT group cover on EVERY owned employee (`insurance_cover = round(p_cover)`, `insurance_status` derived from cover `>0 → active`, `insurance_premium_monthly = 0` — employer-included). Returns `{ updated, cover }`. `REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role` (post-auth mutation, matching the `0036` write-RPC restriction). Called by the settings tab when an employer saves an employer-only default with a group cover amount. **Applied to the live Singapore DB at the 2026-06-05 cutover.** |
| `0040_post_restore_cleanup.sql` (+ `.down.sql`) | 74 | **Post-restore cleanup (cutover step, after 0039 + a verified backup).** Forward-only, drop-only. (1) **CRITICAL** — drops the stale `commissions_status_chk` (the 7-value CHECK introduced in `0027` that did NOT include `'paid'`, blocking `apply_settlement` from flipping lines to `paid` and breaking live settlements); the simplified two-state flow needs no CHECK, and the `.down.sql` deliberately does NOT recreate it. (2) Drops 6 unused indexes (`idx_transactions_subscriber_id`, `demo_personas_phone_role_idx`, `commissions_agent_id_idx`, `idx_subscribers_registered`/`_gender`/`_kyc`) no longer backing any query path after the rollup/RLS simplifications. (3) Drops 2 dead columns. Every statement `IF EXISTS`-guarded. **Applied to the live Singapore DB at the 2026-06-05 cutover.** |
| `0041_commission_aggregate_rpcs.sql` (+ `.down.sql`) | 264 | **Commission aggregate read RPCs (perf/correctness).** Moves the 3 commission read-folds that lived in JS (`src/services/commissions.js`) server-side as STABLE SECURITY DEFINER functions: `get_agent_commission_list`, `get_pending_dues_by_agent`, `get_pending_dues_by_branch`. WHY: the JS folds did an unbounded `from('commissions').select(...)` then grouped in the browser — PostgREST's default 1000-row cap silently dropped commissions past row 1000, under-reporting on the full dataset. Folding in Postgres removes the cap (one rowset crosses the wire, not thousands). Same shapes the JS folds emitted (P4 maps snake→camel). **SCOPE caveat:** SECURITY DEFINER bypasses RLS, so these fold whatever rows are *visible* and must not widen beyond the equivalent RLS-scoped SELECT — distributor is the sole consumer of the list. **Applied to the live Singapore DB at the 2026-06-05 cutover.** |
| `0042_signup_writeflow_hardening.sql` (+ `.down.sql`) | 948 | **Signup / write-flow hardening (5 independent sections).** (3.1) New `subscriber_signup_uploads` idempotency ledger (mirrors `settlement_uploads`) + optional `p_nonce` on BOTH signup-entry RPCs (`create_subscriber_from_signup`, `create_subscriber_from_agent_onboard`) — a replayed re-submit/reload/second-tab returns the stored prior subscriber id instead of minting a duplicate chain. (3.2) Nominee sum-to-100 enforcement in `_insert_subscriber_chain` (copies the `0024` invariant: tolerance 0.01, empty exempt, ERRCODE `P0005`). (3.3) `NULLIF((v_config->>'maxContribution'),'')` cast fix in `submit_contribution_run` (an empty string threw `22P02`). (3.4) `distributors_update_self` hardened — adds the house `app_role='distributor'` gate + a BEFORE UPDATE trigger (`distributors_enforce_editable_cols`) freezing `id`/`parent_id`. (3.5) Commission dedup grain re-emit of `trg_transactions_contribution` to key the `NOT EXISTS` guard on `(agent_id, subscriber_id)` (matching `ux_commissions_agent_subscriber`, 0017). **The 3.5 `CREATE OR REPLACE` re-emit transiently dropped the `0006` `SECURITY DEFINER` + pinned `search_path` from `trg_transactions_contribution` — but `0043 §5` re-emitted that function WITH both clauses (live `prosecdef=true`, `search_path=public, pg_temp`) and `0052` re-asserts them defensively, so this trigger is healthy on live. The only surviving `0042` casualty was `_insert_subscriber_chain`'s lost `search_path` pin, repaired by `0052` — see §12.** **Applied to the live Singapore DB at the 2026-06-05 cutover.** |
| `0043_subscriber_employer_link.sql` (+ `.down.sql`) | ~270 | **Subscriber⇄employer unification (additive — no drops).** Folds the employer roster into the subscriber model: an employer-onboarded "employee" is now a REAL `subscribers` row tagged via `subscribers.employer_id`, so they get a subscriber identity + dashboard login. Adds `transactions.source` (`'own'` \| `'employer'`) + `transactions.contribution_run_id` to distinguish employer money from the subscriber's own. **§5 re-emits `trg_transactions_contribution` WITH `SECURITY DEFINER` + `SET search_path = public, pg_temp`** — this is what re-hardened the trigger after the transient `0042` §3.5 drop (live `prosecdef=true`; see §12). **Applied to the live Singapore DB.** |
| `0044_employer_subscriber_rpcs.sql` (+ `.down.sql`) | ~360 | **Unified-model employer RPCs (partner to 0043).** An employer now onboards a real subscriber and funds tagged subscribers via a contribution run that posts to the normal `transactions` ledger (`source='employer'`); reads roll up over tagged subscribers. The funding model is the SINGLE company-wide `employers.default_contribution_config` applied to everyone (never per-member). Reuses `_insert_subscriber_chain` / `_validate_signup_payload` + the `subscriber_signup_uploads` nonce ledger; `SECURITY DEFINER + SET search_path`, role-gated `app_role='employer'`. **Applied to the live Singapore DB.** |
| `0045_retire_employees.sql` (+ `.down.sql`) | ~120 | **Retire the standalone `employees` machinery.** With the roster unified into subscribers (0043/0044), the standalone `employees` / `contribution_run_lines` tables + the employee-scoped RPCs are dead — DROP them. `contribution_runs` is KEPT (re-pointed to the employer-source ledger); `contribution_run_uploads` is KEPT (run idempotency). Runs AFTER 0044 (replacements exist before the drops). Reversible via the `.down.sql` (restores tables + RLS + the `0034`/`0035`/`0037`/`0038` RPC bodies). **Applied to the live Singapore DB.** |
| `0046_employer_onboard_no_schedule.sql` (+ `.down.sql`) | ~70 | **Employer onboard = identity only.** Re-emits `create_subscriber_from_employer_onboard` to enrol IDENTITY + CONSENT only — no schedule, no first contribution, starts at a 0 balance (the member sets their own saving from the subscriber dashboard; employer money is added separately via the contribution run). Fixes the phantom starting-balance the `_insert_subscriber_chain` reuse produced. **Applied to the live Singapore DB.** |
| `0047_employer_invites.sql` (+ `.down.sql`) | ~210 | **Invite-based employer onboarding (KYC).** Replaces the instant onboard with an invite + KYC flow gated on the employer's `default_contribution_config.mode` (`employer-only` → KYC + split only; `co-contribution` → + schedule & first payment). **NEW TABLE `employer_invites`** (`token` PK; `employer_id` FK CASCADE; `prefill` JSONB `{name,phone,email,nin,gender}`; `collect_schedule` bool; `status` CHECK `pending`\|`completed`\|`expired`; `subscriber_id` FK SET NULL; `created_at`/`expires_at` default now()+7d/`completed_at`; index on `employer_id`). RPCs: `create_employer_invite(p_prefill) → {token,collectSchedule}` (mints token + pending row, dedupes against roster + pending invites), `get_employer_invite(p_token)` (**anon** — pre-login invitee read), `create_subscriber_from_employer_invite` (creates a REAL tagged subscriber with `agent_id NULL` ⇒ NO commission, flips the invite to `completed`). RLS: `employer_invites_self_select` (`app_role='employer'` AND `employer_id = jwt.employerId`). Invite lifecycle: `pending → completed` (KYC done) or `pending → expired` (7-day TTL). **`employer_invites.subscriber_id` FK has no covering index** (the sole `unindexed_foreign_keys` advisor hit — see §16). **Applied to the live Singapore DB.** |
| `0048_remove_employer_member.sql` (+ `.down.sql`) | ~60 | **Employer "Remove from company" RPC.** Adds ONE SECURITY DEFINER RPC, `remove_employer_member(p_subscriber_id text) → jsonb`, gated on `app_role = 'employer'` + scoped to the `employerId` claim (the WHERE also pins `employer_id` so one employer can't un-link another's member). UN-LINKS a member by setting `subscribers.employer_id = NULL` — it deliberately does NOT touch `is_active`, so the person's subscriber account stays active and they continue as an individual saver. House grant pattern (`REVOKE … PUBLIC, anon; GRANT … authenticated, service_role`). The mock path keys an in-session removed-id set instead. **Applied to the live Singapore DB.** |
| `0049_admin_role.sql` (+ `.down.sql`) | ~290 | **Admin role — platform-wide RLS + create RPCs.** Backs the 6th/final role (`admin`, head-office, global rights). (1) Adds 18 `*_select_admin` SELECT policies: 14 clone the distributor "see-everything" grant (`USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin')`) on `subscribers`, `subscriber_balances`, `contribution_schedules`, `insurance_policies`, `nominees`, `transactions`, `claims`, `withdrawals`, `commissions`, `settlement_batches`, `notifications`, `users`, `agent_referrals`, `contact_submissions`; 4 add admin SELECT to the employer family (`employers`, `contribution_runs`, `contribution_run_lines`, `employer_invites`). (Reference tables + `distributors` were already authenticated/public-readable; the deprecated `employees` table is intentionally skipped.) (2) Three SECURITY DEFINER RPCs gated on `app_role='admin'` (house grant `REVOKE … PUBLIC; GRANT … authenticated`): `create_distributor(p_name, p_manager_name, p_manager_phone, p_manager_email, p_parent_id) → jsonb` and `create_employer(p_name, p_sector, p_registration_no, p_contact_name, p_contact_phone, p_contact_email, p_district, p_payroll_cadence, p_default_contribution_config) → jsonb` (both INSERT + return `to_jsonb(row)` for the service mappers), and `get_all_employers_metrics() → jsonb` (per-employer rollup over tagged subscribers — members/active/balance/contributions/insured — the unscoped analogue of `get_employer_metrics`). SECURITY DEFINER bypasses RLS so no admin INSERT policy is needed. **Applied to the live Singapore DB 2026-06-08.** |
| `0050_platform_overview.sql` (+ `.down.sql`) | ~75 | **Admin true-platform-overview RPC.** Adds ONE admin-gated SECURITY DEFINER RPC `get_platform_overview() → jsonb` for the admin country Summary card. WHY: the admin originally reused `get_entity_metrics_rollup('country','ug')`, whose `per_agent` CTE counts subscribers by walking the agent tree (`agents LEFT JOIN subscribers ON s.agent_id=a.id`) → 5,000, **structurally excluding the 17 employer-onboarded subscribers** (`employer_id NOT NULL, agent_id NULL`), even though its AUM/contributions CTEs sum ALL rows — i.e. platform money but tree-only headcount. This RPC computes every metric directly over the base tables (no tree walk): `totalSubscribers` (ALL = 5,017), `subscribersViaDistributor` (agent_id NOT NULL = 5,000), `subscribersViaEmployer` (employer_id NOT NULL = 17), `subscribersDirect` (both NULL = 0), `activeSubscribers`/`inactiveSubscribers`, `distributors`/`employers`/`branches`/`agents` counts, `aum`/`totalContributions`/`totalWithdrawals`. The three channel counts partition `subscribers` exactly (verified 5000+17+0=5017, zero rows with both ids). Per-distributor rollups are deliberately absent (branches have no `distributor_id`; distributors are a flat catalog off `'ug'`). Does NOT touch `get_entity_metrics_rollup` — the geographic map drill-down keeps using that. House grant (`REVOKE … PUBLIC; GRANT … authenticated`). **Applied to the live Singapore DB 2026-06-08.** |
| `0051_admin_apply_settlement.sql` (+ `.down.sql`) | ~30 | **Admin can apply commission settlements.** The admin dashboard reuses the distributor `CommissionPanel`, whose settlement "Upload" calls `apply_settlement(jsonb, text)` — which (`0032`) gated on `v_role IS DISTINCT FROM 'distributor'` and RAISEd `role admin cannot apply a settlement`. Body-faithful re-emit (mirrors the `0007` pattern: pull the CURRENT definition via `pg_get_functiondef`, swap ONLY the role-gate predicate to `(distributor, admin)`, leaving the settlement logic byte-identical). `CREATE OR REPLACE` preserves the `0036` GRANTs. Idempotent. **Applied to the live Singapore DB 2026-06-08.** |
| `0052_repin_insert_chain.sql` (+ `.down.sql`) | ~40 | **Re-pin `_insert_subscriber_chain`'s `search_path` (audit §1b.8, verified-live).** The sole surviving `0042` casualty: `0042` §3.2 re-emitted `_insert_subscriber_chain(jsonb, text)` via `CREATE OR REPLACE` WITHOUT a `SET search_path` and never re-issued the `0010`/`0014`/`0015`/`0028` `ALTER`, so the pin was dropped (live `proconfig=NULL` — the only `function_search_path_mutable` advisor hit). Fix via a bare `ALTER FUNCTION … SET search_path = public, pg_temp` (NO body re-emit, the proven `0006`/`0010` pattern). Then **defensively re-asserts** `trg_subscribers_after_insert` / `trg_transactions_contribution` / `trg_transactions_withdrawal` as `SECURITY DEFINER` + pinned (idempotent — converges even on a DB where `0043` never ran). Does NOT touch the contribution trigger's body (already healthy since `0043`). **Applied to the live Singapore DB 2026-06-08.** |
| `0053_schema_hygiene.sql` (+ `.down.sql`) | ~200 | **Schema-hygiene sweep** — one coherent migration collecting the LOW-severity schema/RPC items the 2026-06-08 audit catalogued (§1a.6/.7/.8/.9/.11, §1b.1/.5, §2a.8, §4a D-2, §4b.10). Each block is independently idempotent. Includes the `employer_invites.subscriber_id` covering index, the missing `notifications` employer policy, the `subscribers.employer_id` self-edit lock, `create_employer`/`create_distributor` parent/district validation, and the bare-`search_path=public`→`public, pg_temp` re-pins on the 5 drift RPCs. **Deliberate departure (§1a.7):** `agents.coverage_rate` is KEPT — the audit's "orphan, drop it" verdict only grepped the JS layer; the live `get_entity_metrics_rollup` (0020) reads it. **Applied to the live Singapore DB 2026-06-08.** |
| `0054_subscriber_money_rpcs.sql` (+ `.down.sql`) | ~150 | **Subscriber money RPCs — idempotent + atomic** (audit §4a F-1/F-2/F-3/F-5). The subscriber Save (top-up) and Withdraw flows previously wrote `transactions` (and, for withdrawal, a second `withdrawals` row) DIRECTLY from the client — no nonce, two unwrapped inserts. New DEFINER RPCs gate `app_role='subscriber'`, derive the subscriber from the JWT `subscriberId` (never a client id), de-dup on a client nonce via a new `money_nonces` ledger (F-1), fold the withdrawal's two writes into one atomic body (F-2), RAISE when a withdrawal exceeds the available balance (F-5), and decrement `units` on withdrawal (F-3 — the withdrawal trigger never did). The existing AFTER INSERT triggers still do the balance math. **Applied to the live Singapore DB 2026-06-08.** |
| `0055_set_commission_rate.sql` (+ `.down.sql`) | ~50 | **`set_commission_rate` DEFINER RPC** (audit §4a F-7). `commission_config.rate` was settable via an unvalidated direct client UPDATE (negative/zero/absurd all passed) — the multiplier the contribution trigger stamps onto every future first-contribution commission. Routes that write through a DEFINER RPC gated `app_role='distributor'`, range-checked (`0 ≤ rate ≤ upper bound`), updating the single `commission_config` row (`id='default'`) + `last_updated_by`/`updated_at`, returning the persisted NUMERIC rate (frontend contract unchanged). **Applied to the live Singapore DB 2026-06-08.** |
| `0056_atomic_employer_config.sql` (+ `.down.sql`) | ~90 | **Atomic employer config + group insurance** (audit §7d-3). The employer Settings "Pension"/"Insurance" save was a NON-atomic two-RPC write (`update_employer_profile` then a separate `apply_group_insurance`); a partial failure left the config claiming cover at amount X while `insurance_policies` (and the hero `insuredCount`) were never updated. Folds the group-cover application INTO `update_employer_profile` so the config patch + the `insurance_policies` UPSERT/clear commit in the SAME transaction. Backward-compatible: two OPTIONAL defaulted params; when NULL the function behaves exactly as the `0035`/`0044` definition (existing single-`p_patch` callers unaffected). **Applied to the live Singapore DB 2026-06-08.** |
| `0057_perf_rpcs.sql` (+ `.down.sql`) | ~120 | **Backend perf RPCs** (audit §5b.1/.2/.3) — three read-only rollups rewritten for fewer buffers, with **BYTE-FOR-BYTE identical** output contracts (same signature/keys/ordering) so every consumer + mocked test stays green. `get_platform_overview()` collapses 6 subscriber COUNT subqueries + 2 transaction SUMs into one scan each via `FILTER` (13,401 → ~2 buffers). `get_all_employers_metrics()` rewritten SET-BASED (per-`employer_id` CTEs LEFT JOINed once, no O(employers) fan-out). `get_entity_metrics_rollup()` re-emitted body-unchanged, only pinning `search_path = public, pg_temp` (was bare `public`). **Applied to the live Singapore DB 2026-06-08.** |
| `0058_platform_scope.sql` (+ `.down.sql`) | ~190 | **Platform data-scope (admin Overview filter).** Backs the admin "Platform Overview" All / Distributors / Employers filter + the district drill-down employer bifurcation. (1) `get_platform_overview()` extended (`CREATE OR REPLACE`) — all 13 keys byte-for-byte preserved, ADDS a `byChannel` object splitting `subscribers`/`active`/`inactive`/`aum`/`contributions`/`withdrawals` across `distributor` (agent_id) / `employer` (employer_id) / `direct` (neither); the `bal`/`txn` CTEs now JOIN subscribers 1:1 (PK / NOT NULL FK) so the un-split totals stay identical, and the three channels sum exactly to them via `FILTER`. (2) NEW admin-only `get_employer_geo_rollup() → jsonb` — resolves `employers.district = districts.name` (case-insensitive) → `region_id`, returns `byRegion` / `byDistrict` employer-subscriber aggregates keyed by the SAME `region_id`/`district.id` the entity tree uses, plus a per-district employer leaf `list` (for the Employers tab). Unmatched district text buckets under `'unmapped'`. Both admin-gated (`app_role='admin'`), house grant. Does NOT touch `get_entity_metrics_rollup` (the distributor map drill-down keeps using it). **Applied to the live Singapore DB.** |
| `0059_employer_activity.sql` (+ `.down.sql`) | ~165 | **Employer-channel activity rollup (admin).** Adds ONE admin-only STABLE SECURITY DEFINER RPC `get_employer_activity_rollup() → jsonb` powering the admin Platform Overview "Employers" scope Today/Week/Month activity strip (New Members / Contributions / Withdrawals / Top Employer). A SEPARATE RPC (not a `p_scope` param on `get_entity_metrics_rollup`) because employers are OUTSIDE the agent→branch→district→region tree, so the country rollup structurally excludes them — same rationale as `get_employer_geo_rollup` (`0058`). Returns the SAME trend keys the country branch of `get_entity_metrics_rollup` emits (so the frontend `TimePeriodCard` consumes it unchanged) filtered to `subscribers.employer_id IS NOT NULL`, PLUS `topEmployer {name, contribution}` (highest CURRENT-MONTH employer-channel contribution total; mirrors `get_top_branch`'s window + shape, `0022`). Every window anchored on `public._demo_now()` (= `'2026-05-18'`), identical to `get_entity_metrics_rollup`. Admin-gated (`app_role='admin'`, RAISE P0001 otherwise); `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`. **Applied to the live Singapore DB.** |
| `0060_deactivate_entities.sql` (+ `.down.sql`) | ~320 | **Deactivate / reactivate distributors + employers (admin).** Makes the formerly-cosmetic `status` column an enforced login + write gate. (1) SCHEMA PREP — `branches` gains `distributor_id text REFERENCES distributors(id) ON DELETE SET NULL` (the agent tree was implicitly under singleton `d-001`; backfill ALL → `'d-001'`, d-002 owns nothing) + a covering index; `employers` gains `status text NOT NULL DEFAULT 'active'`; `get_all_employers_metrics` re-emitted (0057 body, every key byte-for-byte) appending `e.status`. (2) `set_distributor_status(p_distributor_id, p_status)` — admin-gated SECURITY DEFINER, flips the distributor + its branches + its agents between `'active'`/`'inactive'`; on `'inactive'` ALSO detaches every subscriber under the distributor's agent tree (`agent_id → NULL` → they continue as self-onboarded savers; `is_active` is NEVER touched). ⚠️ **Superseded by `0080_reversible_entity_detach.sql`:** as shipped here the detach was ONE-WAY (reactivate was a pure status flip that never re-tagged), which on 2026-07-27 destroyed 5,003 subscriber→agent links from a single admin click and blanket-flipped the seed's 391 inactive agents / 31 inactive branches to `active`. `0080` journals both before mutating and replays them on reactivate, and adds a statement-level trigger that aborts any unjournalled bulk detach. (3) `set_employer_status(p_employer_id, p_status)` — admin-gated SECURITY DEFINER, flips `employers.status`; on `'inactive'` detaches every member (`employer_id → NULL`). (4) WRITE-PATH ENFORCEMENT — two BEFORE-INSERT triggers (`trg_block_inactive_employer_subscriber` on `subscribers`, `trg_block_inactive_employer_run` on `contribution_runs`, both via SECURITY DEFINER trigger fns) so a deactivated employer cannot admit new members or submit new contribution runs. Login enforcement lives in the auth routes via `_lib/entity-status.ts` (a deactivated agent/branch/distributor/employer can't obtain a JWT). Triggers are OFF during the seed (`session_replication_role='replica'`). All admin gates `(SELECT auth.jwt()) ->> 'app_role' = 'admin'` (RAISE P0001); house grant. **Applied to the live Singapore DB.** |
| `0061_block_inactive_employer_retag.sql` (+ `.down.sql`) | ~60 | **Block re-tagging a subscriber to an INACTIVE employer on UPDATE** (closes the `0060` BEFORE-INSERT-only gap). `0060`'s INSERT trigger stops a deactivated employer admitting a brand-new member, but the employer invite-completion + onboard RPCs attach an EXISTING subscriber by UPDATE (`create_subscriber_from_employer_invite` existing-sub + collect_schedule branches; `create_subscriber_from_employer_onboard` existing-sub branch), and the only existing UPDATE trigger (`subscribers_enforce_editable_cols`) doesn't look at employer status — so all three paths bypassed the `0060` guarantee. FIX (additive, mirrors `0060`'s trigger approach — no RPC bodies touched): a BEFORE UPDATE trigger `trg_block_inactive_employer_subscriber_update` (SECURITY DEFINER fn `block_inactive_employer_subscriber_update`) that blocks ONLY a re-tag of `employer_id` to an inactive employer — scoped `NEW.employer_id IS NOT NULL AND NEW.employer_id IS DISTINCT FROM OLD.employer_id`, so it never interferes with detach (`employer_id → NULL`), any other column update, or a re-tag to an ACTIVE employer. Off during the seed (replica mode). `REVOKE ALL FROM PUBLIC`. **Applied to the live Singapore DB.** |
| `0062_contribution_model_v2.sql` (+ `.down.sql`) | ~600 | **Contribution model v2 — compensation-driven, employer-processed, TWO-LEG.** Decouples employer funding from on-platform employee activity: the employer owns the model, and BOTH legs are computed from each member's monthly **`compensation`** regardless of whether the member ever touches the app. **(a) NEW COLUMN `subscribers.compensation NUMERIC NOT NULL DEFAULT 0`** — the driver field. **(b) `_insert_subscriber_chain` rewritten** — `DROP`+`CREATE` to a 4-arg signature `(p_payload jsonb, p_calling_agent_id text, p_amount_override numeric DEFAULT NULL, p_skip_deposit boolean DEFAULT false)`; `p_amount_override` forces the schedule amount (0 for co-contribution members who don't self-save), `p_skip_deposit` suppresses the signup first-contribution while STILL collecting full-KYC beneficiaries/insurance. The three 2-arg call sites (`create_subscriber_from_signup` / `_from_agent_onboard` / `_from_employer_invite`) late-bind to the defaults ⇒ byte-identical for the agent + self-signup paths; stays `SECURITY INVOKER`, `REVOKE ALL FROM PUBLIC`, `search_path = public, pg_temp`. **(c) `submit_employer_contribution_run(p_period_label, p_method, p_nonce)` rewritten to the two-leg model** — per ACTIVE member: `co-contribution` ⇒ `employee_leg = round(comp*employeePct/100)`, `employer_leg = round(employee_leg*employerMatchPct/100)` (NO cap); `employer-only` ⇒ `employee_leg=0`, `percent → round(comp*employerPct/100)` else `round(employerAmount)`. Each non-zero leg INSERTs a `transactions` row (employee leg `source='own'`, employer leg `source='employer'`, BOTH `agent_id=NULL` ⇒ no commission), split by the member's `retirement_pct` (rounding ONCE). A member with both legs 0 is skipped (`zero_contribution`). Writes `contribution_runs.employee_total` (was always 0); `linesCreated` = DISTINCT funded members; `grandTotal = employer_total + employee_total`. Nonce-idempotent via `contribution_run_uploads`. The `trg_transactions_contribution` balance trigger ignores `source`, so two inserts grow the member balance by both legs. **(d) Both completion RPCs thread `compensation`** onto the new subscriber — `create_subscriber_from_employer_invite` from `employer_invites.prefill->>'compensation'` (its co-contribution branch now seeds amount=0 + skips the deposit via the chain), `create_subscriber_from_employer_onboard` from `payload->>'compensation'`. **(e) NEW RPC `update_employer_member_compensation(p_subscriber_id text, p_compensation numeric) → jsonb`** — employer-gated `SECURITY DEFINER` (mirrors `remove_employer_member`, 0048): gates `app_role='employer'` + `employerId` claim, validates `>= 0`, scopes the UPDATE to the caller's roster, RAISEs if no row matched, returns `{ id, compensation, updated }`; `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`. **(f) Demo-data reshape** — MERGE existing `default_contribution_config`s to the new shapes preserving insurance keys: co-contribution drops `matchPct`/`maxContribution` and adds `employeePct` (demo 10) + `employerMatchPct` (carried from the old `matchPct`, default 50); employer-only fixed configs gain `employerBasis='fixed'`; member `compensation` backfilled (demo-realistic) for all tagged subscribers. **New config shapes:** `{mode:'employer-only',employerBasis:'fixed',employerAmount:50000}` · `{mode:'employer-only',employerBasis:'percent',employerPct:10}` · `{mode:'co-contribution',employeePct:10,employerMatchPct:50}` (insurance keys `insuranceEnabled`/`groupCoverAmount` ride along unchanged). **`create_employer` is UNCHANGED — still accepts `p_payroll_cadence` + `p_default_contribution_config` (defaulting NULL/`'{}'`); the admin UI simply STOPS sending them.** **Applied + verified on the live Singapore DB (`0062` is the FINAL contribution-model-v2 migration; later migrations `0063`+ address insurance — see §10, live ledger head `0076`).** ⚠️ **Its mode-switched config shapes and its `employer_leg = employee_leg × employerMatchPct/100` math are SUPERSEDED by `0092`** — see the last row of this table. |
| `0092_unified_contribution_config.sql` (+ `.down.sql`) | 802 / 463 | **ONE unified two-leg contribution model — deletes the modes.** Collapses `co-contribution` / `employer-only` into a single model in which the employee leg and the employer leg are **INDEPENDENT** shares of the member's monthly `compensation`, each `percent`-or-`fixed`. **The bug it kills:** under `0062` the employer leg was `round(employee_leg * employerMatchPct/100)`, so an employer who meant "staff put in 10%, we add 5%" stored `employerMatchPct = 5` and funded `comp × 10% × 5%` = **0.5% of pay, a tenth of what they meant**. `mode`, `employerMatchPct` and `matchPct` are deleted outright; either leg may be 0 and **0/0 is legal** (funds nothing, no cap, no minimum, company-wide only). **(1) NEW `public._normalize_contribution_config(jsonb) → jsonb`** — internal IMMUTABLE SQL twin of `normalizeContributionConfig` (`src/utils/contributionModel.js`); canonicalises the new shape, the legacy `mode` shapes (money-preservingly: `employeePct 10` + `employerMatchPct 50` → `employerPct 5`) and `'{}'` (→ all zeros) into the six pension keys. Granted to **nobody** — its SECURITY DEFINER callers run it as owner. **(2) `submit_employer_contribution_run` rewritten off the `0067` body** — `v_mode` + `v_match_pct` deleted, **both bases now default to `'percent'` (was `'fixed'`)**, each leg derived independently from `compensation`; the nonce guard, `FOR UPDATE`, `retirement_pct` split, three INSERTs, the `0066` insurance leg, `members_funded`, `grand_total` and every returned key are preserved. **(3) `create_employer_invite`** — `collect_schedule` becomes a **constant `FALSE`** (it is SIGNUP DEPTH, not funding: a sponsored member has no amount to pick, so the full wizard would ask for an amount + deposit the server discards, and would offer insurance that `0068` rejects as a re-buy) + a `COMMENT ON COLUMN` replacing `0047`'s misleading inline note. **(4) `get_employer_metrics`** — the meaningless `modeSplit` key is DROPPED (every other key byte-identical). **(5) NEW `get_my_employer_funding() → jsonb`** — subscriber-scoped DEFINER read returning `employerName` + the six normalised keys + the member's `compensation`, so a member can see who funds their pension without widening RLS on `public.employers`; returns jsonb `null` when not sponsored. **(6) `create_employer`** — basis/percentage shape validation (`'{}'` still legal). ⚠️ **NOT YET APPLIED to the live Singapore DB** — apply out of band (Supabase SQL editor / `apply_migration`), NOT via `supabase db push`: the tracked ledger stops at `0084` while `0085`–`0091` were applied directly. ⚠️ **No data backfill** — existing configs keep their legacy shape and are converted at read time by (1) + the JS helper. ⚠️ **Rollback caveat (measured, in the `.down.sql` header):** reverting restores `0067`'s reader, which keeps reading `employerPct`/`employerAmount` — so the employer leg survives but the **employee leg silently drops to zero** for any config saved while `0092` was live. |

> ⚠️ **Inventory gap.** Rows for `0063`–`0091` were never added to this table: `0063`–`0076` are narrated as prose in **§10** below, and `0077`–`0091` (bounded top-N reads, reversible entity detach, distributor scoping, access-request identity) are **not documented in this file at all**. `0092` is appended above because it rewrites the employer contribution contract this file documents.

### Supersession history: 0018 → 0019 (backfilled) → 0020

- `0018_entity_metrics_rollup.sql` shipped the first body but the role gate read `auth.jwt() ->> 'role'`, raising `role_not_permitted` on every call (every drill-down rendered zeros).
- A raw-psql v2 hotfix (`fix_metrics_rollup_app_role`) was applied to the old Tokyo remote between 0018 and 0020 (timestamp `20260519165115`, audit D5) — it patched the role-gate string but originally **never landed in git**.
- That hotfix is now **backfilled as `0019_fix_metrics_rollup_app_role.sql`** (defensive, idempotent ACL-only), so the tree is contiguous and the new Singapore DB records a `0019` in its ledger. The body fix proper still lives in 0020.
- `0020_entity_metrics_rollup_v3.sql` is the canonical superseder — same `(p_level TEXT, p_entity_ids TEXT[]) → jsonb` signature, output keys are a superset of 0018, time-bucket fields + demographics + KYC counts all live here. **Apply only via the new file; 0018 is operationally stale.**

### Applying migrations

- **Local**: `supabase db reset` (re-runs every `00NN_*.sql` from scratch).
- **Hosted (canonical = manual apply):** migrations are applied **manually**, NOT via `supabase db push`. This repo's migration FILES use `00XX_name.sql` naming while the live `supabase_migrations.schema_migrations` ledger stores timestamp versions, so `db push` is not the deploy path (it would re-attempt files the ledger doesn't recognise — see §16 BL-6). The canonical path is `psql -f <file>` against `SUPABASE_DB_URL` (the method used to apply `0032`–`0036` on 2026-06-03), with the ledger reconciled separately. The Supabase MCP tool `mcp__supabase__apply_migration` / `execute_sql` is an alternative; note the MCP path wraps DDL in a transaction by default — `0022`'s `CREATE INDEX CONCURRENTLY` statements cannot run inside a transaction, so the file documents splitting them into `execute_sql` calls outside the transaction.

---

## §8. Schema overview

**29 tables** total on the live Singapore DB (`0001`–`0076` all applied — census verified live 2026-07-08) — the original core schema + `distributors` (`0016`) + the settlement/notification stack (`settlement_batches` `0030`, `notifications` `0031`, `settlement_uploads` `0032`) + the employer family (`0034`) + the **`subscriber_signup_uploads`** idempotency ledger (`0042`) + the **`employer_invites`** invite table (`0047`) + the **`money_nonces`** subscriber-money idempotency ledger (`0054`) + the **`subscriber_insurance_products`** per-product (health/funeral) insurance table (`0064` — the only table added after `0062`; `0065`–`0076` added none). The `0043`–`0045` unification folded the employer roster into `subscribers` (tagged via `subscribers.employer_id`, with `transactions.source`/`contribution_run_id`) and **`0045` dropped the standalone `employees` + `contribution_run_lines` tables** (`contribution_runs` + `contribution_run_uploads` are KEPT, re-pointed to the employer-source ledger). **2 ENUMs** (`commission_status`, `nominee_type` — the other 2 were dropped with the commission state machine in `0029`), `pg_trgm` extension. All primary keys are `TEXT` for deterministic seed IDs (`a-001`, `b-kam-015`, `c-00001`, `d-001`, `s-XXXXXX`, `emp-001`). Field-level definitions live in `docs/data-model.md` — only domain grouping + one-line purpose is captured here.

### Domain: Geo (2 tables)

| Table | Purpose |
|---|---|
| `regions` | 4 static rows (Central/Eastern/Northern/Western). `parent_id` always `'ug'`. |
| `districts` | 136 static rows from the GADM list; FK → `regions(id)`. |

### Domain: Network (3 tables)

| Table | Purpose |
|---|---|
| `distributors` | National-singleton network operator. Seeded with `d-001`; seed script also inserts `d-002` (audit D15: `mockData.js` only knows `d-001`). Columns: `id TEXT PK`, `name`, `parent_id` (default `'ug'`), `manager_name`, `manager_phone`, `manager_email`, `status`, `created_at`, `updated_at`. Defined in `0016`. |
| `branches` | ~316 rows; FK → `districts(id)`. Carries denorm `score`, `rank`, `district_rank`, `district_branch_count` (seeded once, never refreshed). |
| `agents` | ~2,049 rows; FK → `branches(id)`. `languages` / `specialties` are JSONB arrays. `coverage_rate INT` added in 0018, backfilled from active proxy. |

### Domain: Subscribers + per-subscriber (8 tables)

| Table | Purpose |
|---|---|
| `subscribers` | ~5,000 rows (reseeded smaller on the new Singapore DB — was ~30k on old Tokyo prod); FK → `agents(id)` + `districts(id)` (+ `employers(id)` via `employer_id` when employer-tagged). Partial `UNIQUE(phone) WHERE NOT is_demo_signup` lets demo signups collide-and-overwrite. **`compensation NUMERIC NOT NULL DEFAULT 0` (0062)** = the member's total monthly compensation (UGX) — the driver field for the two-leg employer contribution run. For employer members it is the source of truth (their `contribution_schedules.amount` is 0 — `monthlyContribution` is vestigial); untagged subscribers stay at 0. |
| `subscriber_balances` | One row per subscriber; maintained by trigger (§11). |
| `contribution_schedules` | One row per subscriber; UPSERTed at signup. `retirement_pct + emergency_pct = 100`. **Six save-to-cover / indexation columns (`0072`):** `insurance_funding_mode` (`'pay_now' \| 'save_to_cover'`), `insurance_premium_target` (combined **ANNUAL** premium of building self policies), `insurance_premium_accrued` (progress toward it), `insurance_savings_pct` (% of each emergency slice that builds cover), `contribution_indexation_pct` (0..15 yearly step-up), `last_indexed_at`. The four money columns move ONLY via the DEFINER trigger / `fund_insurance_products` (client `UPDATE` REVOKE'd — `0072` §1f, re-applied `0075`); `contribution_indexation_pct` stays client-editable. See §10. |
| `insurance_policies` | One **life** row per subscriber (`subscriber_id` PK); nullable. `status` ∈ `'active' \| 'inactive' \| 'building'` (TEXT — see D8; `'building'` = save-to-cover, `0072`). **`funded_by` ∈ `'self' \| 'employer'` (`0067`, DEFAULT `'self'`).** The extra products (health/funeral) live in **`subscriber_insurance_products`** (`0064`) — see below. (`0063` briefly made this table per-`(subscriber, product)`, but that broke the signup/employer upsert-by-subscriber_id RPCs; `0064` reverted it to the single-life-row contract and moved the new products out.) |
| `subscriber_insurance_products` | **NEW (`0064`)** — the non-life insurance products a subscriber holds. PK `(subscriber_id, product)`; `product` ∈ `'health' \| 'funeral'`; same `cover / premium_monthly / policy_start / renewal_date / status` columns as `insurance_policies` (incl. `'building'` status + `funded_by`, `0067`). RLS: subscriber self `SELECT`/`INSERT`/`UPDATE`, **plus agent `SELECT` (`sip_select_agent`, `0065`)** scoped to the agent's own subscribers (mirrors `insurance_policies_select_agent`) so the agent dashboard can list a subscriber's active policies; FORCE RLS (`0070`). Written by **`fund_insurance_products` (`0073`, subscriber-paid post-signup)** + the subscriber's own `update_self` RLS (renewals) + the signup chain (`0065`, when onboarded with health/funeral) + the employer group-insurance fan-out (`0067`). The legacy `pay_insurance_premium` writer was **EXECUTE-revoked by `0074`**. |
| `nominees` | Pension + insurance beneficiaries; per-row `CHECK (share BETWEEN 0 AND 100)`. **Partial UNIQUE `(subscriber_id, type, nin) WHERE nin IS NOT NULL`** (`nominees_subscriber_id_type_unique`, added by `0027` — audit D9) blocks duplicate-NIN within a `(subscriber, type)` bucket; rows with NULL `nin` or genuinely distinct nominees are still allowed (multiple per type is legitimate). Sum-to-100 is enforced in `upsert_nominees` (0024) **and** the signup chain `_insert_subscriber_chain` (0042 §3.2). |
| `transactions` | Append-only ledger; triggers update balances + first-contribution commission. `type` ∈ `'contribution' \| 'withdrawal' \| 'premium'` (subscriber-paid ANNUAL self-pay premium, `source='own'`) `\| 'insurance_premium'` (employer-funded group premium, `source='employer'`, `0066`) `\| 'premium_sweep'` (internal save-to-cover sweep marker — NEGATIVE `amount`, `source='own'`, `0072`) `\| …`. Only `type='contribution'` fires the balance/commission trigger; `type='withdrawal'` fires the withdrawal trigger; `premium`/`insurance_premium`/`premium_sweep` fire NEITHER (ledger-safe by construction). |
| `claims` | Insurance claims; per-subscriber. |
| `withdrawals` | Withdrawal records; per-subscriber. |

### Domain: Commissions + notifications (3 tables)

| Table | Purpose |
|---|---|
| `commission_config` | Singleton row (`CHECK id = 'default'`); `rate` is the flat amount-per-subscriber. The legacy `cadence` / `next_run_date` columns remain on the row but are no longer read (settlement is upload-driven, not scheduled). |
| `commissions` | Two-state row (`due → paid`, see §11). Columns: `id, agent_id, branch_id, subscriber_id, subscriber_name, amount, status, first_contribution_date, due_date, paid_date, txn_ref, paid_amount, created_at`. Denormalises `branch_id` + `subscriber_name` for cheap RLS + listings. The `0029` simplification dropped the old run/dispute/hold columns. |
| `settlement_batches` (0030, +`client_nonce` in 0032) | One row per agent-settlement recorded by `apply_settlement`: `id, agent_id, branch_id, pending_total, paid_amount` (the actually-allocated total), `txn_ref, paid_date, line_count, created_at, client_nonce`. SELECT-only RLS (distributor all; branch/agent own). FKs (`ON DELETE` actions added in 0033, matching commissions): `agent_id` → `agents(id) ON DELETE CASCADE`, `branch_id` → `branches(id) ON DELETE SET NULL`. |
| `notifications` (0031) | In-app feed: `id, recipient_role` (`'agent'`/`'branch'`)`, recipient_id, type` (`'commission_settled'`)`, title, body, amount, ref_id, is_read, created_at`. SELECT-only RLS (agent/branch own; distributor all); writes via `apply_settlement` / reads cleared via `mark_notifications_read`. `ref_id` is a real FK → `settlement_batches(id) ON DELETE SET NULL` (0033, BL-15) — it is only ever a batch id; SET NULL keeps the append-only feed row if a batch is deleted/re-seeded. |
| `settlement_uploads` (0032) | Per-upload idempotency ledger (BL-13): `nonce` (PK), `result` (the JSONB the RPC returned), `created_at`. RPC-internal — RLS-forced with **no policies and no grants**; only the `apply_settlement` SECURITY DEFINER RPC reads/writes it (short-circuits a replayed `p_nonce`). |

### Domain: KYC / Auth / Signup (5 tables)

| Table | Purpose |
|---|---|
| `users` | Auth identities. `UNIQUE(phone, role)` lets one phone attach to multiple roles. `password_hash TEXT` (0026) nullable; NULL = OTP-only. |
| `demo_personas` | `(phone, role) → entity_id` lookup for non-subscriber roles. 8 seeded rows: 3 agents, 2 branches, 2 distributors, 1 employer (`+256700000031` → `emp-001`). |
| `agent_referrals` | KYC fallback referrals (from `/api/kyc/agent-referral`). |
| `contact_submissions` | Landing-page contact form submissions (from `/api/contact`). |
| `access_requests` (0079) | Public employer/distributor "request access" leads (from `/api/access-request`, service-role insert — no anon policy). Admin triages via `list_access_requests` / `approve_access_request` (provisions the real account via `create_distributor`/`create_employer`, resolving the free-text district name → `districts.id`) / `deny_access_request`; all three admin-gated SECURITY DEFINER, `REVOKE … anon`. |
| `subscriber_signup_uploads` (0042) | Signup idempotency ledger (mirrors `settlement_uploads`): `nonce` PK + stored `result`. RPC-internal — RLS-forced with **no policies and no grants**; only the signup-entry RPCs (`create_subscriber_from_signup` / `create_subscriber_from_agent_onboard`) read/write it. A replayed signup with the same `p_nonce` returns the prior subscriber id instead of minting a duplicate chain. |

### Domain: Employer (`0034`, **unified into subscribers by `0043`–`0047`**)

> **⚠️ Model change (`0043`–`0045`, applied to live).** The original `0034` design gave the Employer a **standalone** roster — `employees` separate from `subscribers`, balances on the `employees` row, a per-employee `contribution_run_lines` ledger. **That model is retired.** `0043`/`0044` unified it: an employer's staff are now **real `subscribers`** tagged via `subscribers.employer_id` (so they get a subscriber identity + dashboard login + the normal `transactions` ledger, with employer money distinguished by `transactions.source='employer'` + `transactions.contribution_run_id`); they have `agent_id NULL` ⇒ **NO agent commission**. **`0045` then DROPPED `employees` + `contribution_run_lines`.** What survives: `employers`, `contribution_runs` (re-pointed to the employer-source ledger), `contribution_run_uploads` (run idempotency), and the NEW **`employer_invites`** invite table (`0047`). All TEXT-PK, ENABLE + FORCE RLS, scoped by the `employerId` claim; writes go through the `0044`/`0047`/`0048`/`0056` RPCs only.

| Table | Purpose |
|---|---|
| `employers` | One row per B2B account (`emp-001`). `name`, `sector`, `registration_no`, `contact_*`, `district`, `payroll_cadence`, `default_contribution_config JSONB` — the single company-wide funding template applied to every tagged member (**company-wide only — there is no per-member override**). **UNIFIED TWO-LEG MODEL (`0092`):** the config always carries all six pension keys — `{ employeeBasis:'percent'\|'fixed', employeePct, employeeAmount, employerBasis:'percent'\|'fixed', employerPct, employerAmount }` — two INDEPENDENT legs, each a percentage of the member's `compensation` or a flat UGX amount; the employer leg is a share of PAY and never a function of the employee leg. Either leg may be 0 and **0/0 is a legal, saveable config** (no cap, no minimum). The insurance keys `insuranceEnabled` / `groupCoverAmount` / `groupInsuranceProducts` (`0067`) ride along unchanged. `mode`, `employerMatchPct` and `matchPct` (and the older `maxContribution`) are **deleted** — legacy rows are converted money-preservingly at READ time by `_normalize_contribution_config` (`0092`) / `normalizeContributionConfig` (`src/utils/contributionModel.js`); no backfill was run, so pre-`0092` rows still physically carry `mode`. Shape + math: `docs/data-model.md` → "Contribution Config shape". |
| `contribution_runs` | One row per funding batch (`run-NNN`); FK → `employers(id)`. `period_label`, `status ∈ draft|completed`, `employer_total`/`employee_total`/`grand_total`, `run_at`. Index on `employer_id`. Each run posts to the normal `transactions` ledger (`source='employer'`, `contribution_run_id = run id`) for the employer's tagged subscribers — the standalone `contribution_run_lines` ledger was dropped with `0045`. |
| `contribution_run_uploads` | RPC-internal idempotency ledger (`nonce` PK, `result JSONB`) — parallel to `settlement_uploads`. No policy, no grant; only the employer contribution-run RPC reads/writes it. |
| `employer_invites` (`0047`) | Invite-based onboarding (KYC). Columns: **`token` TEXT PK** (`inv-<uuid>`); `employer_id` TEXT NOT NULL FK → `employers(id) ON DELETE CASCADE`; `prefill JSONB` (`{ name, phone, email, nin, gender }`); `collect_schedule BOOLEAN` (**SIGNUP DEPTH, not funding — a constant `FALSE` since `0092`, which also stamps a `COMMENT ON COLUMN` saying so**: `false` = the compact split-only completion (pension nominees + the retirement/emergency split, no amount, no deposit, no insurance purchase), `true` = the full wizard; NEITHER branch asks the invitee for an amount — both write `contribution_schedules.amount = 0` and skip the signup deposit, because the employer's config sets both legs); **`status` TEXT** `CHECK (status IN ('pending','completed','expired'))` default `'pending'`; `subscriber_id` TEXT FK → `subscribers(id) ON DELETE SET NULL` (the created subscriber, once KYC completes); `created_at` / `expires_at` (default `now() + interval '7 days'`) / `completed_at`. **Index on `employer_id`** (the `subscriber_id` FK is the sole `unindexed_foreign_keys` advisor hit — covering index added by `0053`). **RLS:** `employer_invites_self_select` (`app_role='employer'` AND `employer_id = jwt.employerId`) — an employer reads only its own invites. **Lifecycle:** employer enters identity → `create_employer_invite(p_prefill)` mints a token + `pending` row (dedupes against roster + existing pending invites); the invitee opens `/invite/:token`, `get_employer_invite` (**anon**, pre-login) reads the prefill; on KYC completion `create_subscriber_from_employer_invite` creates a REAL tagged subscriber and flips the invite `pending → completed`; un-completed invites age out `pending → expired` after the 7-day TTL. |

### ENUMs

| ENUM | Values |
|---|---|
| `commission_status` | `due, paid` (collapsed from 7 states in `0029`) |
| `nominee_type` | `pension, insurance` |

`settlement_run_state` and `settlement_run_branch_review_state` were dropped in `0029` along with their tables.

### Status columns are TEXT with implicit enums (audit D8)

Six status columns are `TEXT` (not ENUM). **`0027` added `CHECK` constraints (audit D8) to three** — `subscribers_kyc_status_chk` (`complete`/`pending`/`incomplete`), `withdrawals_status_chk` (`paid`/`processing`), `claims_status_chk` (`submitted`/`under_review`/`approved`/`paid`/`rejected`). The remaining three — `insurance_policies.status`, `agent_referrals.status`, `distributors.status` — are still `TEXT` with no `CHECK` (discipline lives in client code + the BEFORE-UPDATE trigger for `subscribers`). Note: `0027` also added a `commissions_status_chk`, but it was a stale 7-value list missing `'paid'` and was **dropped by `0040`** (it blocked settlements). The two surviving enums (`commission_status`, `nominee_type`) are properly enforced at the type level.

### Indexes

From `0001` (8): `subscribers (agent_id)`, partial `subscribers (phone) WHERE NOT is_demo_signup`, `transactions (subscriber_id, date DESC)`, `commissions (agent_id, status)`, `commissions (branch_id, status)`, plus `users (phone)` + `demo_personas (phone, role)`. (The original `commissions (run_id)` and `settlement_run_branch_reviews (branch_id)` indexes were dropped with the `run_id` column + the `settlement_run_branch_reviews` table in `0029`.)

Added in `0017_unique_constraints.sql` (3 partial / full unique): `ux_agents_email`, `ux_subscribers_nin`, `ux_commissions_agent_subscriber` (closes the first-contribution race — see §11).

Added in `0009`, `0013`, `0018`, `0020`, `0022`: FK covering indexes, `idx_transactions_date`, `idx_transactions_subscriber_id`, `idx_subscribers_registered`, `idx_subscribers_agent_id`, `idx_subscribers_gender`, `idx_subscribers_kyc`, `idx_transactions_type_date` (partial, `WHERE type IN ('contribution','withdrawal')`), `idx_commissions_status`.

Dropped in `0011`, `0023`: unused indexes and the duplicate `subscribers_agent_id_idx` (728 KB → kept the smaller `idx_subscribers_agent_id` at 264 KB).

Dropped in `0040_post_restore_cleanup.sql` (6, at the new-DB cutover — no longer backing any query path after the rollup/RLS simplifications): `idx_transactions_subscriber_id` (superseded by the composite `transactions (subscriber_id, date DESC)`), `demo_personas_phone_role_idx` (superseded by the UNIQUE `(phone, role)`), `commissions_agent_id_idx`, `idx_subscribers_registered`, `idx_subscribers_gender`, `idx_subscribers_kyc`.

### Denormalized columns seeded but never re-written (audit D11)

Columns the seed populates but no API code path updates (some are read-only metric displays; some are entirely unused):

- `agents.coverage_rate`, `agents.tenure_months`, `agents.performance`, `agents.rating`
- `branches.score`, `branches.rank`, `branches.district_rank`, `branches.district_branch_count`
- `subscribers.products_held`, `subscribers.contribution_history`, `subscribers.current_unit_value`, `subscribers.occupation`, `subscribers.unit_value_as_of`
- `transactions.status`, `transactions.method`, `transactions.split_retirement`, `transactions.split_emergency`
- `commissions.subscriber_name` (denorm at insert; never updated when `subscribers.name` changes — audit D10)

---

## §9. RLS policies

### Discipline summary

- Every JWT signed by `signJwt` carries `role: 'authenticated'` (Postgres role) + `app_role: <JwtRole>` (application role).
- **Every active RLS policy reads `auth.jwt() ->> 'app_role'`** — never `'role'`. The live Singapore DB now has **~90 policies** (was 65 at the original audit D1; the deltas are the employer table family from `0034`, the `0042` `distributors_update_self` re-emit, the `0047` `employer_invites_self_select`, the `0053` `notifications` employer policy, and — the big jump — the **`0049` admin role's 18 `*_select_admin` clones**, one stacked onto each readable table); all read `app_role` correctly.
- **0 policies use `auth.uid()`** — would return `NULL` for our custom JWTs.
- Every table is both `ENABLE` and `FORCE` ROW LEVEL SECURITY — table owners are not exempt. `distributors` was `ENABLE`-only until `0033_post_audit_hardening.sql` added the missing `ALTER TABLE distributors FORCE ROW LEVEL SECURITY` (it was never FORCE'd by `0016`, BL-24); since 0033 every table — all 28 on the new DB, including the employer family and the RPC-internal idempotency ledgers — is FORCE'd. (Practical exposure was minimal regardless — all writes flow through service-role/DEFINER paths.)
- The `commissions`, `settlement_batches`, and `notifications` tables have **no direct INSERT/UPDATE/DELETE policies** (all three are SELECT-only). Commission `due → paid` transitions, `settlement_batches` rows, and `notifications` rows are all written by the `apply_settlement` SECURITY DEFINER RPC (0031, re-emitted in 0032); `mark_notifications_read` (0031) is the only other writer (it updates `is_read` on the owner's own rows). The three idempotency ledgers — `settlement_uploads` (0032), `contribution_run_uploads` (0034), and `subscriber_signup_uploads` (0042) — are all RPC-internal: RLS-forced with **no policies and no grants at all** (not even SELECT to `authenticated`), so each is reachable only from inside its DEFINER RPC.
- Most predicates are wrapped in `(SELECT auth.jwt())` (per `0008`) so PostgREST hoists the call into an InitPlan node instead of re-evaluating per row.

### Per-role permission grid

| Table | subscriber | agent | branch | distributor |
|---|---|---|---|---|
| `regions` | R | R | R | R |
| `districts` | R | R | R | R |
| `distributors` | R | R | R | R + U (own row, `auth.jwt() ->> 'distributorId' = id`) |
| `branches` | R | R | R | R + IU |
| `agents` | R | R | R + IU (own branch) | R |
| `commission_config` | R | R | R | R + U |
| `demo_personas` | R | R | R | R |
| `subscribers` | R + U (self, editable cols only) | R + I (own) | R (via agent.branch_id) | R |
| `subscriber_balances` | R (self) | R (own subscribers) | R (own branch's subscribers) | R |
| `contribution_schedules` | R + U (self) | R (own subscribers) | R (own branch's subscribers) | R |
| `insurance_policies` | R + IU (self) | R (own subscribers) | R (own branch's subscribers) | R |
| `nominees` | R + IUD (self) | R (own subscribers) | R (own branch's subscribers) | R |
| `transactions` | R + I (self) | R (own subscribers) | R (own branch's subscribers) | R |
| `claims` | R + I (self) | R (own subscribers) | R (own branch's subscribers) | R |
| `withdrawals` | R + I (self) | R (own subscribers) | R (own branch's subscribers) | R |
| `commissions` | — | R (`agent_id = agentId`) | R (`branch_id = branchId`) | R |
| `settlement_batches` | — | R (`agent_id = agentId`) | R (`branch_id = branchId`) | R |
| `notifications` | — | R (`recipient_role='agent'` + `recipient_id = agentId`) | R (`recipient_role='branch'` + `recipient_id = branchId`) | R |
| `users` | — | — | — | R |
| `agent_referrals` | — | — | — | R |
| `contact_submissions` | — | — | — | R |

Legend: R = SELECT, I = INSERT, U = UPDATE, D = DELETE. The grid covers the core 21 tables and the 4 network/subscriber/commission roles. The **employer** role has its own table family (below); the **admin** role (shipped — `0049`) reads everything via 18 `*_select_admin` SELECT-only clones (`USING ((SELECT auth.jwt()) ->> 'app_role' = 'admin')`) layered on top of the per-role grid below — 14 cloning the distributor "see-everything" grant + 4 adding admin SELECT to the employer family. Admin writes go through the `0049`/`0051` SECURITY DEFINER create/settlement RPCs (which bypass RLS), so admin needs no INSERT/UPDATE/DELETE policy.

### Employer RLS (5 tables, `0034` — applied to live 2026-06-03)

The employer role doesn't appear in the grid above because it scopes a separate table family by the camelCase `employerId` claim (parallel to `branchId` / `distributorId`). **One SELECT policy per table, no client write policies** — every write goes through a `0035` SECURITY DEFINER RPC. The four named policies below have their `auth.jwt()` call wrapped in `(SELECT auth.jwt())` (`0036`, to fix the `auth_rls_initplan` per-row re-eval — matching the `0008` InitPlan-hoisting convention for the core policies).

| Table | employer (SELECT) |
|---|---|
| `employers` | `employer_self_select`: `app_role='employer' AND id = (SELECT auth.jwt()) ->> 'employerId'` |
| `employees` | `employees_by_employer_select`: `app_role='employer' AND employer_id = (SELECT auth.jwt()) ->> 'employerId'` |
| `contribution_runs` | `contribution_runs_by_employer_select`: `app_role='employer' AND employer_id = (SELECT auth.jwt()) ->> 'employerId'` |
| `contribution_run_lines` | `contribution_run_lines_by_employer_select`: `app_role='employer'` AND `EXISTS (run with id = run_id AND employer_id = employerId)` (no `employer_id` column on lines — scoped via the parent run, mirroring `settlement_runs_select_agent`'s EXISTS join) |
| `contribution_run_uploads` | **none** — RPC-internal idempotency ledger, no policy + no grant (mirrors `settlement_uploads`); reachable only inside `submit_contribution_run`. |

All 5 tables are ENABLE + FORCE RLS; service-role (seed + `supabase-admin.ts`) bypasses RLS. The other roles (subscriber/agent/branch/distributor) have no policy on these tables, so no rows satisfy any USING clause.

### Notable policy details

- `subscribers_update_self` (after 0005 / 0007) is ownership-only; column immutability is enforced by `trg_subscribers_enforce_editable_cols` (BEFORE UPDATE). Editable: `name, email, phone, occupation, consent_at`.
- Reference-table SELECT policies gate on `auth.jwt() ->> 'app_role' IS NOT NULL` — any authenticated app role passes.
- Subscribers + balances + transactions etc. share the same 4-policy pattern: self / agent (via `subscribers.agent_id`) / branch (via `agents.branch_id`) / distributor (unrestricted).
- `distributors_select USING (true)` (0016) — every authenticated role can read the singleton row. Lets distributor metrics widgets render across roles.
- `distributors_update_self USING ((SELECT auth.jwt() ->> 'distributorId') = id)` (0016 + 0023 InitPlan wrap) — distributor can update its own row only.

---

## §10. RPC inventory

On the live Singapore DB (all `0001`–`0076` applied) `pg_proc` holds **53 functions in `public`** (verified live 2026-07-08) — spanning the user-facing RPCs, the private `_`-prefixed helpers, and the trigger functions. This is up from the **40** counted at the 2026-06 audit (§1b.2): `0058`–`0062` added the geo/activity rollups + deactivation + compensation RPCs, and `0063`–`0076` added the multi-product/save-to-cover insurance RPCs (`pay_insurance_premium` `0063`/`0064`/`0068` — now EXECUTE-revoked by `0074`; `fund_insurance_products` `0073`) plus the `0075` privilege-lockdown re-emits. Almost all read `auth.jwt() ->> 'app_role'` (never `'role'`), use zero `auth.uid()`, and pin `SET search_path` (audit D2). **The `0042` trigger regression is resolved** — `trg_transactions_contribution` is DEFINER + pinned on live (`0043 §5` + `0052`, see §12); the sole remaining `function_search_path_mutable` advisor was `_insert_subscriber_chain`, re-pinned by `0052`. The `0029` simplification dropped the 14 commission state-machine + dispute RPCs, `get_run_branch_breakdown`, and the `commissions_before_update` trigger function. The base list below is the `0001`–`0042` set; **`0043`–`0062` add the unified-model employer RPCs (`0044`), invite RPCs (`0047`: `create_employer_invite`, `get_employer_invite` [anon], `create_subscriber_from_employer_invite`), `remove_employer_member` (`0048`), the admin create/overview/settlement RPCs (`0049`–`0051`: `create_distributor`, `create_employer`, `get_all_employers_metrics`, `get_platform_overview`), the audit-remediation RPCs (`0054` subscriber money RPCs, `0055` `set_commission_rate`, `0056` atomic employer config), the platform-scope additions (`0058`: `get_platform_overview` extended with a `byChannel` split + new `get_employer_geo_rollup`), the employer-channel activity rollup (`0059`: `get_employer_activity_rollup`), the deactivate/reactivate RPCs + write-path gate triggers (`0060`: `set_distributor_status`, `set_employer_status`, `block_inactive_employer_subscriber`, `block_inactive_employer_run`; `0061`: `block_inactive_employer_subscriber_update`), and the contribution-model-v2 RPCs (`0062`: `submit_employer_contribution_run` rewritten two-leg + new `update_employer_member_compensation`) — each catalogued per-migration in §12's inventory table.**

**`0063_insurance_products` + `0064_insurance_products_table`** (both applied live 2026-06-20) add multi-product insurance + the **`pay_insurance_premium(p_nonce, p_product, p_cover, p_premium, p_method)`** RPC — a subscriber-gated SECURITY DEFINER function that activates the product's policy row AND inserts a `type='premium'` transaction, idempotent on the `money_nonces` ledger (kind `'premium'`). **`0063` first made `insurance_policies` per-`(subscriber, product)`, but that broke every legacy RPC that upserts it by `subscriber_id` (signup chain, `apply_group_insurance`, `update_employer_profile`, JS cover slider). `0064` reverts `insurance_policies` to its single-life-row contract and isolates health/funeral in the new `subscriber_insurance_products` table** — so the pay RPC now routes life → `insurance_policies` (`ON CONFLICT subscriber_id`), health/funeral → `subscriber_insurance_products` (`ON CONFLICT subscriber_id,product`), and zero employer/signup RPCs needed changing. **Ledger-safe by construction:** `type='premium'` rows never fire `trg_transactions_contribution`, so premiums leave `subscriber_balances` / AUM untouched — verified live (AUM `1,979,974,523` unchanged before/after test premiums on both branches). Drives the subscriber "settle this period" + insurance-upgrade pay flows.

**`0065_agent_insurance_products`** extends multi-product insurance to the AGENT dashboard. Two changes: (1) **`sip_select_agent`** — an agent `SELECT` RLS policy on `subscriber_insurance_products` (mirrors `insurance_policies_select_agent`, `0008`: `app_role='agent'` + `EXISTS subscribers.agent_id = jwt.agentId`) so the agent can read which active policies a subscriber holds; without it the PostgREST embed silently returns `[]`. (2) **`_insert_subscriber_chain` re-emit** (from the `0062` body, same 4-arg signature → `CREATE OR REPLACE`) — after the life `insurance_policies` INSERT it loops `payload.insuranceProducts` and INSERTs each `health`/`funeral` row into `subscriber_insurance_products` (`ON CONFLICT (subscriber_id, product) DO NOTHING`, `status` from `cover>0`). **Policy rows only — no `transactions` row**, so the balance trigger never fires (premium payment stays the subscriber's own later `pay_insurance_premium`). The chain is SECURITY INVOKER but runs inside the SECURITY DEFINER signup RPCs (owned by `postgres`/BYPASSRLS), so the INSERT bypasses RLS exactly as the existing life INSERT does. The agent-onboard frontend (`onboardPayload.js`) emits `insurancePolicy` (life) + `insuranceProducts` (health/funeral) from the `insuranceTypes` selection; agents do **not** see cover/premium amounts (product+status chips only). Agent schedule-EDIT for existing subscribers hides insurance (`showInsurance={false}` on `SubscriberScheduleForm`) — an agent can't authorise `pay_insurance_premium` (subscriber-gated). **Both** signup paths emit `insuranceTypes` and now render the SAME component: agent onboarding switched from the retired `ContributionSettingsForm` to the self-signup `signup/contribution/ContributionSettings` wizard (`embedded` mode — FRONTEND.md §11.2), so `contributionPayload.js` / `onboardPayload.js` receive identical schedule shapes. That also means `paymentMethod`, `insuranceSavingsPct`, `insuranceFundingMode` and `insurancePremiumTarget` finally arrive populated on the agent path — the old form emitted none of them, so `0072`'s `_insert_subscriber_chain` had nothing to stamp on the first-contribution `transactions.method` and never posted the Route-A `type='premium'` row for agent-onboarded members.

**`0066_run_insurance_leg`** (applied live 2026-06-24) makes the employer **pay** for group life as part of the contribution run. Adds `contribution_runs.insurance_total numeric NOT NULL DEFAULT 0` and `CREATE OR REPLACE`s **`submit_employer_contribution_run`** (from the `0062` two-leg body) to post a **third per-active-member leg**: `type='insurance_premium'`, `source='employer'`, `amount = round(groupCoverAmount * 0.002)` (0.2%/mo, the individual-life rate — mirrors `src/utils/groupInsurance.js::groupPremiumPerMember`), **NO retirement/emergency split** (`split_* = NULL`). Because the balance/units trigger fires only `WHEN type='contribution'`, the premium is **ledger-safe by construction** — it never touches `subscriber_balances`/AUM (it is a cost, not savings). The run header now tracks `grand_total = employee + employer + insurance` and the RPC result returns `insuranceTotal`. **"Total contributions" stays PENSION** (it sums `type='contribution'` only — unchanged); frontend readers that summed `grandTotal` as a contributions/funding figure were repointed to `employee+employer` (Overview, Runs "funded to date", Analytics trends, leaderboard). Parity: `src/services/employer.js::_mockSubmitEmployerRun` computes the leg identically; the run views surface it as a distinct Employee/Employer/**Insurance**/Grand breakdown. Live data backfilled so all 5 emp-001 runs carry the insurance leg (14 members × 30,000 = 420,000/run; AUM `61,977,000` for emp-001 members verified unchanged). The seed (`employerSeed.buildContributionHistory` + `seed-supabase.mjs`) emits the leg + `insurance_total` for future reseeds; the opening-balance reconciliation excludes `insurance_premium`. **New `transactions.type` value: `'insurance_premium'`** (employer-funded group premium; distinct from the subscriber-paid `'premium'`).

**`0067_employer_multiproduct_insurance`** (applied live 2026-06-24) extends employer group insurance from a single flat **group life** cover to the same **multi-product** model as subscribers — Life / Health / Funeral. Config (`employers.default_contribution_config`) now carries `groupInsuranceProducts: { life:{enabled,cover}, health:{…}, funeral:{…} }` (legacy `{ insuranceEnabled, groupCoverAmount }` still normalises to a single life product — see `src/utils/groupInsurance.js`). Changes: (a) adds **`funded_by` ('self' | 'employer')** to `insurance_policies` + `subscriber_insurance_products` — a sponsored subscriber's policies are marked employer-paid (the Policies page shows "Paid by [employer]" and the member can't re-buy / can't be charged: `buildPolicy` zeroes the premium for employer-funded, `InsurancePage`/`PoliciesPage` gate the pay flow). (b) adds **`group_insurance_premium_per_member(config)`** = Σ enabled products at 0.2%/mo of cover (mirrors `groupInsurancePremiumPerMember`). (c) **`update_employer_profile` fans the saved config out to EVERY sponsored subscriber** — life → `insurance_policies`, health/funeral → `subscriber_insurance_products`, `funded_by='employer'`, premium 0, active; a disabled product deactivates only the EMPLOYER-funded rows (self-bought policies untouched). (d) the **run insurance leg now charges the multi-product sum** (`submit_employer_contribution_run` calls the helper). Demo `emp-001` config + live data backfilled to Life 15M + Health 5M (premium 40,000/member; runs reconcile; AUM unchanged). `seed-supabase.mjs` fans the employer config out to its members (life `funded_by='employer'` + health product) so a full reseed keeps the multi-product cover. **`0068_pay_premium_employer_guard`** (applied live) re-emits `pay_insurance_premium` (0064 body) with a server-side **no-double-buy guard**: a subscriber can't pay for a product their employer already funds (`funded_by='employer'`, active) — the authoritative backstop to the UI gating.

**`0069`–`0071` (bridge — branch/RLS hygiene, applied live).** `0069_branch_pending_contributions` adds a branch pending-contributions scope-guard RPC; `0070_insurance_products_force_rls` sets `FORCE ROW LEVEL SECURITY` on `subscriber_insurance_products`; `0071_group_premium_search_path` pins `SET search_path` on the group-premium helper. No subscriber-facing model change.

**`0072_insurance_save_to_cover`** (applied live) introduces the subscriber **annual-premium "save-to-cover"** model + optional contribution **indexation**. **Six additive `contribution_schedules` columns** (all defaulted, 1:1 with subscriber): `insurance_funding_mode TEXT NOT NULL DEFAULT 'pay_now'` (`'pay_now'` | `'save_to_cover'`), `insurance_premium_target NUMERIC` (the combined **ANNUAL** premium — `Σ premium_monthly × 12` — of the member's non-active self-funded policies), `insurance_premium_accrued NUMERIC` (progress toward that target), `insurance_savings_pct NUMERIC DEFAULT 100` (% of each own-money contribution's **emergency slice** redirected to build cover; the rest stays liquid/withdrawable), `contribution_indexation_pct NUMERIC DEFAULT 0` (optional 0..15 yearly step-up), and `last_indexed_at TIMESTAMPTZ` (indexation anniversary marker; NULL = never bumped). **Two funding routes** at onboarding (via the re-emitted `_insert_subscriber_chain`, still SECURITY **INVOKER** + inline `search_path` — must NOT become DEFINER, the exact 0042→0052 regression): **Route A `pay_now`** activates the policies immediately and charges the combined annual premium as a single `type='premium'`, `source='own'` ledger row; **Route B `save_to_cover`** creates the policies as **`status='building'`** and charges nothing now. The re-emitted **`trg_transactions_contribution`** (kept SECURITY **DEFINER** + pinned) gains a save-to-cover block that runs only for `source='own'` legs: it accrues `insurance_savings_pct` × the emergency slice toward the target (capped at target; any excess stays in `emergency_balance`), and when accrued ≥ target **AND** the emergency bucket actually holds ≥ target (the `[H3]` sweep guard) it **sweeps** — debits buckets/units by the annual target, writes an internal **`type='premium_sweep'`** marker row (**NEGATIVE** `amount = -target`, `source='own'`; a NEW `transactions.type` that fires NEITHER balance trigger, so no recursion and the sign-bucketing feeds read it as an outflow), flips the building policies to `active`, and resets `target`/`accrued` to 0. The same block also does **lazy renewal** (an active self policy past `renewal_date` flips back to `building` to re-accrue — no `pg_cron`) and **lazy indexation** (bumps `contribution_schedules.amount` once per anniversary). `request_withdrawal` gains a matching **accrued clawback** (clamps `insurance_premium_accrued` to what remains in emergency after a withdrawal, so a withdrawal can't strand accrued ≥ target). All scoping is `funded_by='self'` — the employer-funded branch is never touched. The money columns (`insurance_funding_mode` / `insurance_premium_target` / `insurance_premium_accrued` / `last_indexed_at`) are `REVOKE UPDATE`'d from `authenticated`/`anon` (`contribution_indexation_pct` stays client-editable — a user choice). ⚠️ That column-REVOKE was a **no-op on live** until re-applied by `0075` — and it only actually bites once `contribution_schedules` gets the table-REVOKE + column-GRANT treatment `0076` applied to `subscribers` (still deferred for the schedule table; the sweep's independent `v_emg_bal ≥ v_target` guard blocks abuse meanwhile).

**`0073_fund_insurance_products`** (applied live) adds the **`fund_insurance_products(p_nonce, p_funding_mode, p_products, p_savings_pct, p_method)`** SECURITY DEFINER RPC — the **post-signup** counterpart to the 0072 onboarding chain, called by the subscriber schedule/insurance editor to fund newly-chosen cover in either route (the 0072 column-REVOKEs mean the client can't set the schedule's funding state directly, and the legacy monthly `pay_insurance_premium` couldn't create a building/annual policy). **Route A `pay_now`** upserts each product to `active` (storing the TRUE `premium_monthly`) and charges the combined **ANNUAL** premium (`Σ premium_monthly × 12`) as one `type='premium'` row. **Route B `save_to_cover`** upserts each product to `status='building'`, puts the schedule into `save_to_cover` + the savings split, and recomputes `insurance_premium_target` from all non-active self policies — **byte-identical** to the 0072 trigger's recompute, so the next contribution reads the same target (no drift). Subscriber-gated (`app_role='subscriber'` + `subscriberId` claim), idempotent on `money_nonces` (kind `'insurance_funding'`), `funded_by='self'` on every write, and guarded so it never overwrites employer-paid group cover. `type='premium'` rows fire no balance trigger → cover charges never touch balances/units/AUM.

**`0074_retire_pay_insurance_premium`** (applied live) **retires the legacy `pay_insurance_premium` RPC** — `REVOKE EXECUTE ... FROM authenticated, anon, PUBLIC` (the function body is left in place; only the grant is removed). It was the last surviving path that recorded a **self-paid** insurance premium at **MONTHLY** magnitude (`type='premium'`, `source='own'`, `amount = p_premium` monthly), contradicting the invariant that a `funded_by='self'` member pays insurance ONLY as a single **ANNUAL** premium (`pay_now` → `premium_monthly × 12`) or via `save_to_cover` accrual — never a monthly out-of-pocket stream. Monthly premiums remain legitimate **only** when the EMPLOYER funds them (`type='insurance_premium'`, `source='employer'`, 0066). The subscriber activate/upgrade flow now routes exclusively through `fund_insurance_products` (0073).

**`0075_lock_privilege_surface` + `0076_subscribers_column_scoped_update`** (applied live **2026-07-08, with ledger rows**) are the deep-audit **privilege-lockdown** fixes. `0075`: a hard `app_role='agent'` gate + fail-closed ownership on `create_subscriber_from_agent_onboard` (HIGH-1); caller-scoping + `REVOKE anon` on the three `0041` commission rollups (`get_agent_commission_list` / `get_pending_dues_by_agent` / `get_pending_dues_by_branch`, HIGH-2); `REVOKE anon` on `fund_insurance_products`; column `REVOKE UPDATE` on the sensitive `subscribers` columns (`agent_id` / `employer_id` / `compensation` / `kyc_status` / `is_active` / `nin`) + the `contribution_schedules` insurance-money columns (re-asserting 0072 §1f, which never took effect live — audit A2); and re-scoping `distributors_select` off `USING(true)` to any authenticated role (B5, closes an anon PII read). `0076`: because a column-level `REVOKE UPDATE` does **NOT** override a role's **table-wide** `UPDATE` grant (Postgres unions table- and column-level privileges — the true root cause of the 0072 §1f no-op), it `REVOKE`s the table-wide `UPDATE` on `subscribers` then `GRANT`s back only the columns `updateProfile` legitimately writes (`name` / `email` / `phone` / `occupation` / `consent_at`), closing the cross-tenant employer-injection vector (B3/MED-1). The equivalent table-REVOKE + column-GRANT for the `contribution_schedules` insurance columns is noted **deferred** in `0076`.

**`0092_unified_contribution_config`** (⚠️ **written, NOT yet applied live** — apply out of band) collapses the employer's two contribution MODES into **one** model with two INDEPENDENT legs, each a `percent`-or-`fixed` share of the member's monthly `compensation`. It touches five functions and adds two: **NEW `_normalize_contribution_config(jsonb)`** (internal, IMMUTABLE, granted to nobody — the SQL twin of `normalizeContributionConfig` in `src/utils/contributionModel.js`, called by BOTH the run RPC and the new member read so they cannot drift); **`submit_employer_contribution_run`** re-emitted off the `0067` body with each leg derived independently from compensation (both bases now default to `'percent'`, was `'fixed'` — the old default silently funded 0/0 for a config that named `employerPct` without a basis); **`create_employer_invite`** with `collect_schedule` a constant `FALSE` + a `COMMENT ON COLUMN` recording that it means SIGNUP depth, not funding; **`get_employer_metrics`** minus the deleted `modeSplit` key; **NEW `get_my_employer_funding()`** (subscriber-gated — the only way a member can read their employer's name + funding rates, since no RLS policy on `public.employers` admits a subscriber JWT and widening one would expose the whole contact/registration row); and **`create_employer`** with light config shape validation. ⚠️ **Three-way parity obligation:** `deriveContributionLegs` (JS) + `_normalize_contribution_config` + the leg block inside `submit_employer_contribution_run` must change in the SAME commit, or the offline mock path (`VITE_USE_SUPABASE='false'`), the seeded ledger, the run-wizard preview and the live RPC diverge. No data backfill — legacy configs convert at read time.

Breakdown:

- **5 trigger functions** — `trg_subscribers_after_insert` (0002, DEFINER via 0006), `trg_transactions_contribution` (0002, DEFINER + pinned — re-hardened by 0043, re-asserted by 0052; see §12), `trg_transactions_withdrawal` (0002, DEFINER via 0006), `trg_subscribers_enforce_editable_cols` (0005), **`trg_distributors_enforce_editable_cols` (0042 — NEW**, freezes `id`/`parent_id`). (`commissions_before_update` dropped in 0029.)
- **4 private helpers** — `_validate_signup_payload`, `_insert_subscriber_chain` (0002, rewritten 0014/0015), `_canonical_ug_phone` (0014), `_demo_now()` (0020/0023; IMMUTABLE, pinned search_path)
- **5 INVOKER read RPCs** — `get_commission_summary`, `get_entity_commission_summary`, `get_agent_commission_detail` (re-emitted slim in 0029), `get_breadcrumb`, `search_entities`
- **16 SECURITY DEFINER RPCs:**
  - 2 metric reads — `get_entity_metrics_rollup` (0018→0020), `get_top_branch` (0022)
  - **3 commission-aggregate reads (0041 — NEW)** — `get_agent_commission_list`, `get_pending_dues_by_agent`, `get_pending_dues_by_branch` (STABLE; moved from JS folds to dodge PostgREST's 1000-row cap)
  - 2 atomic-write (0002, `p_nonce` added 0042) — `create_subscriber_from_signup`, `create_subscriber_from_agent_onboard`
  - 1 nominees upsert (0024) — `upsert_nominees`
  - 2 settlement / notification (0031, `apply_settlement` re-emitted `(p_rows, p_nonce)` in 0032) — `apply_settlement`, `mark_notifications_read`
  - **6 employer RPCs** — `submit_contribution_run`, `update_employee_contribution_config`, `update_employee_insurance`, `update_employer_profile`, `get_employer_metrics` (0035) + `apply_group_insurance` (0039) (see §10.1)

### Read RPCs (6)

All `LANGUAGE plpgsql STABLE`. Most are SECURITY DEFINER + role-gated; `search_entities` and `get_breadcrumb` are reference-data reads. `GRANT EXECUTE ... TO authenticated`. The 3 commission read RPCs were re-emitted in `0029` in slimmed paid/due-only form (dispute/run fields removed).

| RPC | Signature | Returns | Caller |
|---|---|---|---|
| `get_entity_commission_summary` | `(p_level TEXT, p_entity_id TEXT)` | `jsonb { totalPaid, totalDue, countPaid, countDue, total, countTotal, settlementRate }` (0029 — dropped `totalDisputed`/`countDisputed`) | `src/services/commissions.js#getEntityCommissionSummary` |
| `get_top_branch` | `(p_level TEXT, p_parent_id TEXT)` | `jsonb { name, contribution }` or `NULL` | `entities.js#getTopPerformingBranch`. SECURITY DEFINER (0022) + aggregate-first body using `idx_transactions_type_date`. |
| `get_breadcrumb` | `(p_level TEXT, p_ids jsonb)` | `jsonb[]` of `{ level, id, name }` | `entities.js#getBreadcrumb` |
| `search_entities` | `(p_q TEXT)` | `TABLE(entity_id, entity_name, level, label, parent_id, score)`, hardcoded `LIMIT 8` | `search.js#searchEntities`. Uses `pg_trgm`'s `%` operator + `similarity()` for fuzzy matching. |
| `get_agent_commission_detail` | `(p_agent_id TEXT)` | `jsonb { …, totalPaid, totalDue, paidTransactions[], dueTransactions[] }` (0029 — no disputed/run fields; paid lines expose `paidAmount`) | `commissions.js#getAgentCommissionDetail` |
| `get_commission_summary` | `(p_branch_id TEXT DEFAULT NULL)` | `jsonb { totalCommissions, totalPaid, totalDue, countTotal, countPaid, countDue }` (0029) | `commissions.js#getCommissionSummary` |
| `get_entity_metrics_rollup` | `(p_level TEXT, p_entity_ids TEXT[])` | `jsonb` keyed by entity id; 8 base counts + time-period buckets (`daily/weekly/monthlyContributions[12]/Withdrawals` + `prev*`), `newSubscribers*`, `genderRatio`, `ageDistribution`, `kycPending/Incomplete` | `entities.js#getEntityMetricsRollup`. **Canonical body in 0020** (supersedes 0018 + the remote `fix_metrics_rollup_app_role`). Time buckets anchor on `_demo_now()` = `'2026-05-18 23:59:59+00'`. |

### Commission-aggregate read RPCs (3, `0041` — NEW)

`STABLE SECURITY DEFINER SET search_path = public, pg_temp`. These move the three commission read-folds that used to run in the browser (`src/services/commissions.js`) into Postgres, so they aggregate over **every** visible row instead of being silently truncated at PostgREST's 1000-row default page cap. They do **not** branch on `app_role` — RLS on `commissions` already scopes the row set per JWT claim (distributor: all; branch: own; agent: own) — but because they are DEFINER they bypass RLS, so they must not widen visibility beyond the equivalent RLS-scoped SELECT (**SCOPE caveat**: distributor is the sole consumer of the list today).

| RPC | Signature | Returns | Caller |
|---|---|---|---|
| `get_agent_commission_list` | `(p_status_focus text DEFAULT NULL)` | `TABLE(agent_id, agent_name, employee_id, branch_id, branch_name, total_commissions, total_paid, total_due, subscribers_onboarded, active_subscribers, filtered_amount, filtered_count)` | `commissions.js#getAgentCommissionList` |
| `get_pending_dues_by_agent` | `()` | `TABLE(agent_id, agent_name, employee_id, branch_id, branch_name, pending_amount, pending_count)` | `commissions.js#getPendingDuesByAgent` (settlement template prefill) |
| `get_pending_dues_by_branch` | `()` | `TABLE(branch_id, branch_name, pending_amount, pending_count, agent_count)` | `commissions.js#getPendingDuesByBranch` |

### Atomic-write RPCs (2)

Both `SECURITY DEFINER SET search_path = public`. Wrap multi-table inserts so signup is one transactional unit. Both gained an optional `p_nonce` parameter in `0042` (idempotent replay via the `subscriber_signup_uploads` ledger).

```
create_subscriber_from_signup(payload jsonb) RETURNS TEXT
create_subscriber_from_agent_onboard(payload jsonb, calling_agent_id TEXT) RETURNS TEXT
```

Shared work (`_insert_subscriber_chain`, rewritten in 0014 then 0015):

- Validates payload (`_validate_signup_payload`).
- Inserts subscriber row (idempotent on phone via the partial unique index).
- Triggers `trg_subscribers_after_insert` (seeds `subscriber_balances`).
- Inserts `contribution_schedules` (frequency, amount, 80/20 default unless overridden) — **incl. the `0072` save-to-cover/indexation columns** (`insurance_funding_mode`, `insurance_premium_target`, `insurance_savings_pct`, `contribution_indexation_pct`, `last_indexed_at`; `insurance_premium_accrued` starts at 0).
- Inserts `insurance_policies` (life) when insurance is chosen (0015 fix) **+ `subscriber_insurance_products` (health/funeral) rows (`0065`)**. When `insurance_funding_mode='save_to_cover'` the policy/product rows are created **`status='building'`** (activated later by the sweep); otherwise `active`/`inactive` from `cover>0` (`0072`).
- Inserts `nominees` (pension + insurance).
- Inserts the first `transactions` row (`type='contribution'`) — triggers `trg_transactions_contribution` → balance update + first-contribution commission row at `commission_config.rate`.
- After 0015: emits a second `transactions` row (`type='premium'`) when insurance is set on the **`pay_now`** route — the combined **ANNUAL** premium (`Σ premium_monthly × 12`, `0072`); **`save_to_cover` posts NO premium here** (the trigger sweeps it later from savings). The contribution + withdrawal triggers are guarded with `WHEN (NEW.type = 'contribution'|'withdrawal')` so the premium / `premium_sweep` rows do not double-fire balance writes.

`create_subscriber_from_signup` is granted to `anon, authenticated` so the signup flow works without a JWT yet — `0036` **deliberately keeps** its anon EXECUTE (signup runs pre-JWT). `create_subscriber_from_agent_onboard` is post-auth: `0036` REVOKEs its EXECUTE from PUBLIC + anon and GRANTs `authenticated, service_role`; it also cross-checks `calling_agent_id` against `auth.jwt() ->> 'agentId'`. **`0075` hardened this RPC** (audit HIGH-1): added a hard `app_role='agent'` gate and made the `agentId`↔`calling_agent_id` ownership check **fail-closed** (it was previously skipped when the JWT `agentId` claim was NULL).

### Settlement + notification RPCs (2, added in 0031)

The old 14 commission state-machine + dispute RPCs (`open_run`, `cancel_run`, `release_run`, `release_branch`, `branch_approve_all`, `mark_branch_reviewed`, `branch_approve_line`, `branch_hold_line`, `branch_dispute_line`, `agent_dispute_line`, `approve_dispute`, `reject_dispute`, `withdraw_dispute`, `agent_confirm_commission`) and `get_run_branch_breakdown` were **all dropped in `0029`**. Settlement is now a single upload-driven RPC plus a notification-read RPC, both `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, each reading `auth.jwt() ->> 'app_role'`.

| RPC | Allowed role | What it does |
|---|---|---|
| `apply_settlement(p_rows jsonb, p_nonce text DEFAULT NULL)` | distributor | Processes the re-uploaded settlement template. For each agent's rows: allocates the (whole-UGX-rounded) `amountPaid` **FIFO** across that agent's `due` lines oldest-first — a line flips to `paid` (with `paid_amount = its own amount`, `paid_date`, `txn_ref`) only while the remaining budget covers it in full; uncovered lines stay genuinely `due` (INFORM-NOT-BLOCK partial semantics — see §11). Records one `settlement_batches` row (`paid_amount` = the actually-allocated total, reconciles with `SUM(paid_amount)`), and inserts `commission_settled` notifications (formatted body, BL-18) for the affected agent + branch. `p_nonce` is a per-upload idempotency key: a replay returns the prior result via the `settlement_uploads` ledger without re-recording. Skip reasons: `missing_agent_id`, `no_due`, `amount_too_low`. Returns `{ agentsSettled, linesSettled, totalPaid, skipped: [{ agentId, reason }] }`. **Signature changed in 0032** (added `p_nonce`; the 0031 single-arg overload is dropped). |
| `mark_notifications_read(p_ids text[])` | agent / branch | Owner-scoped — sets `is_read = TRUE` on the caller's own `notifications` rows whose ids are in `p_ids`. |

Both follow the house grant pattern (`REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated`). `0036` re-asserts this lockdown on both — REVOKEing anon EXECUTE and GRANTing `authenticated, service_role` (they are post-auth RPCs).

### `upsert_nominees` (0024)

`upsert_nominees(p_subscriber_id TEXT, p_pension JSONB, p_insurance JSONB) RETURNS JSONB`. SECURITY DEFINER, role-gated to `subscriber` (own row) or `admin`. Validates `SUM(share)` per type rounds to 100 or empty array. DELETE + INSERT in one transaction. Returns the canonical `{ pension, insurance }` shape that `getSubscriberNominees` consumes.

**Grant pattern gap (audit D3) — CLOSED by `0027`.** The `0024` grant revoked only from `anon` and left the default `PUBLIC` EXECUTE grant in place, diverging from the house `REVOKE ALL … FROM PUBLIC;` then `GRANT … TO authenticated` pattern. `0027_post_audit_polish.sql` added the missing `REVOKE EXECUTE … FROM PUBLIC`. **Verified on the new DB:** `upsert_nominees`'s ACL is `authenticated` + `service_role` only — `PUBLIC` can no longer EXECUTE it. The discipline is now uniform across the RPC surface.

### §10.1 Employer RPCs (6 from `0035`/`0039` — the pre-`0045` employee-era surface, applied live — plus the 3 unified-model rows from `0044`/`0092` appended below)

All `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`, gated on `auth.jwt() ->> 'app_role' = 'employer'`, scoped to the caller's `auth.jwt() ->> 'employerId'`, with the house grant pattern (`REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated`). `0036` re-asserts this lockdown on the four WRITE/admin RPCs (`submit_contribution_run`, `update_employee_contribution_config`, `update_employee_insurance`, `update_employer_profile`) — explicitly REVOKEing anon EXECUTE and GRANTing authenticated, service_role. Structural template = `apply_settlement` (0032). Called by `src/services/employer.js` via `supabase.rpc(...)` (the mock branch re-implements the same math offline). **The funder-redesign follow-ons in this family — `0038` (re-emits `submit_contribution_run` with the co-contribution match model) and `0039` (new `apply_group_insurance` RPC) — are now applied to the live Singapore DB (cutover 2026-06-05).**

> ⚠️ **Four of the six rows below are the PRE-`0045` employee-era surface, kept for provenance:** `submit_contribution_run`, `update_employee_contribution_config` and `update_employee_insurance` were dropped with the standalone `employees` table (`0045`), and `apply_group_insurance`'s roster fan-out was folded into `update_employer_profile` (`0056`). **Their `mode` / `matchPct` / per-employee-config vocabulary is retired** — funding is now company-wide only, on two independent legs, with no cap (see `docs/data-model.md` → "Contribution Config shape"). The LIVE employer surface is `update_employer_profile`, `get_employer_metrics`, and the three rows appended at the bottom of the table.

| RPC | Signature | What it does |
|---|---|---|
| `submit_contribution_run` | `(p_rows jsonb, p_period_label text, p_method text, p_nonce text) → jsonb` | The core write. `p_rows = [{ employeeId }]`; any client amounts are **advisory and ignored**. Nonce short-circuits against `contribution_run_uploads` (idempotent replay). For each row: locks the employee `FOR UPDATE`; verifies it belongs to the caller's employer (else skip `not_owned`); skips `not_found`/`suspended`/`zero_contribution`. **Re-derives amounts server-side** from the employee's config + figures, splits the gross by the employee's `contribution_schedule` (default 80/20, `emergency = gross − retirement` to avoid penny drift), INSERTs the `contribution_run_lines` row, and bumps the `employees` balance columns **inline** (`net_balance`/`units_held` @ UGX 1,000/unit). After the loop INSERTs one `contribution_runs` header (only if ≥1 line) + writes the nonce ledger. Returns `{ runId, linesCreated, employerTotal, employeeTotal, grandTotal, skipped: [{ employeeId, reason }] }`. **⚠️ MUST NOT write `transactions`, `subscriber_balances`, or `commissions`** — employees aren't subscribers, so a `transactions` insert would FK-fail AND fire `trg_transactions_contribution` (which mutates `subscriber_balances` + creates an agent commission). No commission code path is reachable from this RPC; employer balances live on `employees` and are the RPC's own inline write (there is no employee trigger). **Match math (`0038` — HISTORICAL, this whole basis was deleted by `0092`):** the `co-contribution` branch matched `matchPct`% of the employee's own `monthly_contribution` — `employee_half = round(monthly_contribution)`; `employer_half = round(employee_half * matchPct/100)`, then `LEAST(employer_half, round(maxContribution))` when the cap is set. A **dual-read legacy fallback** keeps a co row with `employeePct` and NO `matchPct` on the OLD salary-based math (`employer_half = employerAmount ?? round(salary*employerPct/100)`, `employee_half = employeeAmount ?? round(salary*employeePct/100)`) so an un-migrated live row never zeroes out during cutover. `employer-only` (`employer_half = employerAmount ?? round(salary*employerPct/100)`, `employee_half = 0`) is unchanged. |
| `update_employee_contribution_config` | `(p_employee_id text, p_config jsonb) → jsonb` | Ownership-checked. Replaces `contribution_config`, returns the updated row as `to_jsonb`. |
| `update_employee_insurance` | `(p_employee_id text, p_cover numeric, p_premium numeric) → jsonb` | Ownership-checked. Sets cover + monthly premium; `insurance_status` derives from cover (`>0 → active`). Returns the updated row. |
| `update_employer_profile` | `(p_patch jsonb) → jsonb` | Patches the caller's own `employers` row (editable profile/config keys only — `id`/timestamps never patched). Returns the updated row. |
| `get_employer_metrics` | `() → jsonb` (**STABLE**) | Hero/overview aggregates scoped to the caller's employer: `{ headcount, active, suspended, totalBalance, totalContributions, insuredCount, employerYtd, employeeYtd }`. "YTD" = sum over `contribution_runs` in the current calendar year. Mirrors `get_entity_commission_summary`'s STABLE shape. ⚠️ **`0092` DROPPED the former `modeSplit: { coContribution, employerOnly }` key** — the unified model has no modes, so the split was meaningless. `src/services/employer.js`'s mock no longer returns it either; there is deliberately no replacement "funding shape" field (the two legs are one company-wide config, read off the employer row). |
| `apply_group_insurance` *(`0039` — applied to live)* | `(p_cover numeric) → jsonb` | Roster-wide analogue of `update_employee_insurance`. Sets a FLAT group cover on EVERY employee owned by the caller (no ownership arg — the `WHERE employer_id = <claim>` is the gate): `insurance_cover = round(p_cover)`, `insurance_status` derived from cover (`>0 → active`, else `inactive` — a `0` cover acts as a "switch group cover off" toggle), `insurance_premium_monthly = 0` (employer-included group benefit). Returns `{ updated, cover }` (`updated` = roster row count). Grant: `REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role`. Called by the settings tab when an employer saved a group cover amount — group cover is now applied inside `update_employer_profile` (`0056`) instead, in the same transaction as the config patch. |
| `submit_employer_contribution_run` *(`0044` → `0062` → `0066`/`0067` → **`0092`**)* | `(p_period_label text, p_method text, p_nonce text) → jsonb` | **The live employer write.** All figures are re-derived server-side; the client sends no amounts. Per ACTIVE tagged member, from `compensation` + the company-wide `default_contribution_config` (normalised by `_normalize_contribution_config`): `employee_leg = employeeBasis='percent' ? round(comp*employeePct/100) : round(employeeAmount)` and `employer_leg = employerBasis='percent' ? round(comp*employerPct/100) : round(employerAmount)` — **two INDEPENDENT legs; the employer leg is never a function of the employee leg.** Each non-zero leg INSERTs one `transactions` row (employee leg `source='own'`, employer leg `source='employer'`, BOTH `agent_id=NULL` ⇒ no commission), split by the member's `retirement_pct` (rounding ONCE). The `0066` group-insurance leg (`group_insurance_premium_per_member`, `0067`/`0071`) posts alongside. A member is skipped `zero_contribution` only when BOTH pension legs AND the insurance leg are 0 — so a **0/0 config is a legal no-op run**, not an error. Nonce-idempotent via `contribution_run_uploads` (a replay returns the prior result without double-posting). Header totals: `employer_total` / `employee_total` / `insurance_total`, `grand_total` = all three. |
| `get_my_employer_funding` *(**`0092`** — NEW)* | `() → jsonb \| null` (**STABLE**) | **Subscriber-scoped, not employer-scoped** — gated `app_role='subscriber'` (RAISEs `P0001` for any other role, so it must NEVER be called from an agent/employer/admin surface) and derives the member from the verified `subscriberId` claim, never an argument. Returns `{ employerName, employeeBasis, employeePct, employeeAmount, employerBasis, employerPct, employerAmount, compensation }` — the six keys already normalised, ready to pass straight into `deriveContributionLegs` / `memberFundingSummary`. Returns jsonb `null` (JS `data === null`) when the member is not employer-sponsored, or when the employer row vanished under the tag: that is the normal **"hide the funding surface"** state, NOT an error. **Why an RPC and not RLS:** the only SELECT policies on `public.employers` are `employer_self_select` (`0036`) and `employers_select_admin` (`0049`), so a subscriber JWT cannot read even the employer's NAME (this is why the subscriber Policies "Paid by {employerName}" badge always fell back to "your employer"); a member-facing policy would expose the whole row (contact name/phone/email, registration no, district) to every member of every employer. |
| `_normalize_contribution_config` *(**`0092`** — NEW, internal)* | `(p_config jsonb) → jsonb` (**IMMUTABLE**) | Not an app RPC — a private helper **granted to nobody** (`REVOKE ALL … FROM PUBLIC, anon`); its SECURITY DEFINER callers execute it as owner. The SQL twin of `normalizeContributionConfig` in `src/utils/contributionModel.js`: canonicalises the unified shape, the legacy `mode` shapes (money-preservingly — `employeePct 10` + `employerMatchPct 50` → `employerPct 5`) and `'{}'` (→ all zeros) into the six pension keys, bases guaranteed `'percent'\|'fixed'`, amounts non-NULL. Group-insurance keys are NOT returned — they are read straight off the raw config by `group_insurance_premium_per_member`. Shared by `submit_employer_contribution_run` and `get_my_employer_funding` so what a member is TOLD and what a run actually POSTS can never disagree. **Verified against the JS helper on 17 config shapes.** |

---

## §11. Commission settlement flow

`commission_status` is now a two-value ENUM (`due`, `paid`). The old maker-checker state machine — settlement runs, branch review, holds, the full dispute lifecycle, agent confirmation, and the settlement cadence — was removed in `0029`. There is only one transition (`due → paid`) and it happens through the `apply_settlement` RPC.

### State diagram

```
              insert (trigger)         apply_settlement (distributor)
   ┌──────────┐                 ┌──────────┐
 → │   due    │ ──────────────▶ │   paid   │  (paid_amount / paid_date / txn_ref set)
   └──────────┘                 └──────────┘
```

### How it works

1. **Generation.** A subscriber's first contribution fires `trg_transactions_contribution`, which inserts a `due` commission at `commission_config.rate` (unchanged by 0029).
2. **Offline payment + upload.** The distributor pays the agent offline, then in the UI downloads a per-agent Excel template prefilled with that agent's pending dues, fills in **Amount Paid** + payment reference/date, and re-uploads it. The frontend parses the sheet, **rounds each Amount Paid to whole UGX** (canonical `parseAmount`, `src/utils/finance.js`), mints a per-upload idempotency nonce, and calls `apply_settlement(p_rows, p_nonce)`.
3. **Apply (FIFO partial, INFORM-NOT-BLOCK).** `apply_settlement` (distributor-only, migration **0032**) allocates each agent's (rounded) Amount Paid across that agent's `due` lines **oldest-first**: a line flips to `paid` (with `paid_amount = its OWN amount`, `paid_date`, `txn_ref`) only while the remaining budget covers it in full. When the entered amount is **less** than the agent's due total, the uncovered lines stay genuinely `due` — a partial payment never clears unpaid lines. It records one `settlement_batches` row per agent (`paid_amount` = the actually-allocated total, so `SUM(commissions.paid_amount)` reconciles with the batch), emits `commission_settled` notifications (formatted body) to the affected agent + branch, and returns `{ agentsSettled, linesSettled, totalPaid, skipped: [{ agentId, reason }] }`.

   - **Mismatch surfacing.** The distributor's confirm modal shows per-agent mismatches before applying (it does **not** block). On the agent side, the most recent short-paid settlement raises an amber banner on the commissions page with an "Ask for reason" client-side `mailto:` (prefilled with the batch ref, due total, and paid total) — a demo affordance, not a backend integration.
   - **Idempotency (BL-13).** `p_nonce` is a per-upload UUID minted when the confirm modal opens. A re-submit / reload / second-tab / network-retry replay with the same nonce short-circuits via the `settlement_uploads` ledger (PK on `nonce`) and returns the original result without recording a duplicate batch or duplicate notifications.
   - **Product redirect point.** The FIFO partial behaviour is a deliberate product choice. To switch to "any payment clears ALL of an agent's due lines" (all-or-nothing per agent), the change is localised to the FIFO loop in `0032_fix_settlement_apply.sql` and the mirrored mock in `src/services/commissions.js`. Both files carry a marked `>>> PRODUCT-OWNER REDIRECT POINT <<<` comment.

### Rollback ordering across 0030 / 0031 / 0032 (BL-23)

The settlement stack is split across three migrations with a cross-file ownership coupling, so the `.down.sql` files **must be run in reverse-dependency order**, not just reverse-numeric:

- **`settlement_batches` table is created in `0030`**, but its only writer — the `apply_settlement` RPC — is defined in **`0031`** (and re-emitted in `0032`). `0030_settlement_batches.down.sql` deliberately does **not** drop the RPC; `0031_notifications.down.sql:13` does. **Rolling back only `0030` while keeping `0031` would leave `apply_settlement` referencing a dropped table.** Therefore `0030` and `0031` roll back **as a pair, `0031`-then-`0030`** (drop the RPC + `notifications` first, then the `settlement_batches` table).
- **`0032`** only `CREATE OR REPLACE`s the RPC and adds the `settlement_uploads` ledger + `settlement_batches.client_nonce`; its down restores the 0031 single-arg RPC and is self-contained. **`0033`** adds the `notifications.ref_id` FK (→ `settlement_batches`), the `settlement_batches` FK `ON DELETE` actions, and `distributors FORCE` RLS; its down is likewise self-contained.
- **Full-stack rollback order is therefore:** `0033` → `0032` → (`0031`-then-`0030`). Because `0033` adds a FK from `notifications.ref_id` **to** `settlement_batches.id`, it must be undone **before** `0030` drops `settlement_batches` (otherwise the `DROP TABLE` would fail or cascade). The `0033.down.sql` header records this ordering. All `.down.sql` files are emergency-use only and not part of the forward-only chain.

### Transition table

| From | To | Actor | RPC / trigger | Role check | Side effects |
|---|---|---|---|---|---|
| (insert) | `due` | trigger | `trg_transactions_contribution` | n/a (DEFINER) | First-contribution commission row at `commission_config.rate` |
| `due` | `paid` | distributor | `apply_settlement(p_rows, p_nonce)` | `app_role = 'distributor'` | FIFO-allocates Amount Paid oldest-first; settled lines get `paid_amount = own amount` + `paid_date`/`txn_ref`; uncovered lines stay `due`. Inserts a `settlement_batches` row (per-agent, `paid_amount` = allocated total) + agent & branch `commission_settled` notifications. Idempotent on `p_nonce` |

---

## §12. Triggers

**Five triggers** on the live DB (the `commissions_before_update` dispute-snapshot trigger was dropped in `0029`; `0042` added the `distributors_enforce_editable_cols` freeze). `trg_subscribers_after_insert`, `trg_transactions_contribution`, and `trg_transactions_withdrawal` are all SECURITY DEFINER + `search_path` pinned on live; the two enforce-editable-cols triggers are INVOKER by design. (The transient `0042` §3.5 drop of the contribution trigger's DEFINER + pin was **repaired by `0043 §5`** and re-asserted by `0052` — see the callout below.)

| Trigger | Table | Timing | Function | Security |
|---|---|---|---|---|
| `subscribers_after_insert` | `subscribers` | AFTER INSERT | `trg_subscribers_after_insert()` | DEFINER (0006), `search_path` pinned — seeds `subscriber_balances`, `ON CONFLICT DO NOTHING` |
| `transactions_after_insert_contribution` | `transactions` WHEN `type='contribution'` | AFTER INSERT | `trg_transactions_contribution()` | **DEFINER, `search_path=public, pg_temp` pinned** on live (re-hardened by `0043 §5`, re-asserted by `0052`; the transient `0042` re-emit drop is gone — live `prosecdef=true`). Bumps balances, applies 80/20 default or explicit split, creates the first-contribution commission (dedup grain now `(agent_id, subscriber_id)` per `0042` §3.5) at **hardcoded `v_unit_price NUMERIC := 1000`** |
| `transactions_after_insert_withdrawal` | `transactions` WHEN `type='withdrawal'` | AFTER INSERT | `trg_transactions_withdrawal()` | DEFINER (0006), `search_path` pinned — decrements balances; emergency-first fallback when split is missing |
| `subscribers_enforce_editable_cols` | `subscribers` | BEFORE UPDATE | `trg_subscribers_enforce_editable_cols()` (0005) | INVOKER (`search_path` pinned by 0010, role-claim rewritten by 0007). Rejects any change outside `name/email/phone/occupation/consent_at` from `app_role='subscriber'` callers. |
| `distributors_enforce_editable_cols` *(0042 — NEW)* | `distributors` | BEFORE UPDATE | `trg_distributors_enforce_editable_cols()` | INVOKER (`search_path=public`). Freezes `id`/`parent_id` for `app_role='distributor'` callers (pairs with the `0042` `distributors_update_self` app_role-gate hardening). |

> ✅ **Resolved — the `0042` `trg_transactions_contribution` regression is fixed on live.** Background: `0006` had hardened this function via a standalone `ALTER FUNCTION … SECURITY DEFINER` + `SET search_path = public, pg_temp` (the `0002` body was a plain INVOKER function); `0042` §3.5 re-emitted it with `CREATE OR REPLACE` to change only the dedup grain, and since `CREATE OR REPLACE` resets any attribute the new statement doesn't restate, the re-emit transiently reverted it to INVOKER/unpinned. **`0043 §5` re-emitted the function WITH `SECURITY DEFINER` + `SET search_path = public, pg_temp`** (live `pg_proc.prosecdef=true`, `proconfig={search_path=public, pg_temp}` — verified 2026-06-08), and **`0052` defensively re-asserts** that pin on this trigger plus the other two balance triggers, so a future stray `CREATE OR REPLACE` can't silently regress them. The contribution trigger is **healthy on live**; no further action is needed here. The only function that actually carried the `0042` drop into the 2026-06-08 audit was **`_insert_subscriber_chain`** (its `search_path` pin, §1b.8) — repaired by **`0052`** (the correct next migration number; `0043` was already taken by the subscriber⇄employer link). The two enforce-editable-cols triggers remain INVOKER by design.

**Why 0006 exists.** The three cross-table trigger functions in 0002 originally ran as the caller's invoker context. When a subscriber-role direct INSERT into `transactions` fired the contribution trigger, the trigger tried to write to `subscriber_balances` + `commissions` — but the subscriber JWT has no INSERT policy on those tables, so RLS rejected and the whole INSERT aborted. 0006 promotes the three functions to `SECURITY DEFINER` + pins `search_path = public, pg_temp`.

**Why 0005 exists.** The original `subscribers_update_self` WITH CHECK clause pinned non-editable columns via correlated subqueries against `subscribers` itself — Postgres treats that as another row-level check on the same table, producing infinite recursion. 0005 simplifies the policy to ownership-only and enforces immutability via the BEFORE UPDATE trigger (triggers don't re-evaluate RLS).

---

## §13. Realtime publication

`0003_rls_policies.sql` originally added `commissions`, `settlement_runs`, `settlement_run_branch_reviews` to `supabase_realtime`. `0025_drop_realtime_publication.sql` dropped all three — Phase 1 + 2 audits confirmed **zero `.channel()` subscribers** across `src/` and `api/`, so the WAL replication overhead bought nothing. (`settlement_runs` + `settlement_run_branch_reviews` were themselves later dropped entirely in `0029`.)

**Current state:** `supabase_realtime` membership for `public.*` is empty (audit D19 confirmed this matches intent, modulo the supersession by 0025 itself). High-write tables (`transactions`, `subscribers`, `subscriber_balances`) were never added to begin with, and the new `settlement_batches` + `notifications` tables (0030/0031) are not published either — the notification bell polls via React Query. React Query's 5-minute staleTime + manual invalidation handles cross-laptop demo sync at sufficient resolution.

If a future feature wires `.channel()` subscribers, the 0025 down migration restores the original `commissions`-only publication.

---

## §14. Seeding & utility scripts

Three scripts in `scripts/`.

### `scripts/seed-supabase.mjs` (~895 lines)

Run via `npm run seed`. Materialises the full `src/data/mockData.js` hierarchy into the Supabase Postgres DB.

**Mechanics:**

- Reads `SUPABASE_DB_URL` from `.env.local` (pooler URL, port 6543). Direct `pg.Client` connection (NOT through Supabase JS).
- Wraps everything in `BEGIN … COMMIT`.
- Runs `SET session_replication_role = 'replica'` at line 189 for the duration of the seed so the seeded contribution transactions (~27k on the 5k-subscriber dataset) don't double-insert via `trg_transactions_contribution`. Restored to `'origin'` before `COMMIT` (and inside the `catch` for safety).
- Bulk insert via `INSERT … FROM unnest($1::type[], $2::type[], …) ON CONFLICT (pk) DO UPDATE` — one round-trip per 2,000-row chunk. Idempotent on re-run.
- **Phone dedup:** subscribers with duplicate phones get reassigned to a synthetic `+25671XXXXXXX` range so the partial unique index `subscribers(phone) WHERE NOT is_demo_signup` stays satisfied. Per-run state (a `Set`); if live subscribers exist when seed re-runs, dupes silently reassign to different `+25671XXXXXXX` numbers (audit D14).
- `demo_personas` seeded with 8 rows: agents `a-001/a-042/a-118` at phones `+2567000000{1,2,3}`, branches `b-kam-015/b-mba-290` at `+2567000000{11,12}`, distributors `d-001/d-002` at `+2567000000{21,22}`, and the employer `emp-001` at `EMPLOYER_DEMO_PHONE` (`+256700000031`).
- Both `distributors` rows (`d-001`, `d-002`) are inserted by the seed; the `0016` migration also seeds `d-001` on-conflict-do-nothing.
- **Commissions are `due`/`paid` only** (post-0029 simplification — no `settlement_runs`); `paid` rows carry `paid_amount`. The seed also inserts a few `settlement_batches` rows + matching `commission_settled` notifications so the settlement history + notification bell have demo data.
- **Employer seed (post-`0045` unified model):** imports `src/data/employerSeed.js` (the single source of truth shared with the offline mock path) and inserts 1 `employers` row (`emp-001`, "Nile Breweries Demo Ltd") plus its 21 members as **tagged `subscribers`** (the standalone `employees` table died with `0045`) and 5 historical `contribution_runs` with their `transactions` legs. `emp-001`'s `default_contribution_config` is the **unified two-leg shape** (`employeeBasis:'percent'/employeePct:10` + `employerBasis:'percent'/employerPct:5`, plus employer-funded Life 15M / Health 5M group cover) — money-identical to the legacy `10% + 50% match` config it replaces, so a reseed leaves every balance, run header and transaction row untouched. `src/data/employerGeoSeed.js`'s 6 login-less extra employers share one module-level config for the same reason. **The seed does not re-implement the leg math** — it calls `deriveContributionLegs` from `src/utils/contributionModel.js`, the same function the mock run path, the run-wizard preview and (mirrored in PL/pgSQL) `submit_employer_contribution_run` use, so the seeded ledger reconciles with the live RPC. Service-role bypasses the employer RLS so these direct inserts succeed despite FORCE. The employee leg is stamped `'Payroll deduction'` (it is deducted by the employer, not paid by the member from their phone). Dates anchored to `MOCK_NOW`.

**Approximate row volumes after seed:**

Generation is driven by `TARGET_SUBS = 5000` in `src/data/mockData.js:220` (was 30,000 on the old Tokyo prod — the new Singapore DB was reseeded smaller). Verified counts on the live new DB:

| Table | Rows |
|---|---|
| regions | 4 |
| districts | 136 |
| branches | ~316 |
| agents | ~2,049 |
| subscribers | ~5,000 |
| subscriber_balances / contribution_schedules | ~5,000 each (1:1 with subscribers) |
| insurance_policies | ~2,786 (nullable — only insured subscribers) |
| nominees | ~24,188 |
| transactions | ~27,310 (contribution ledger) |
| claims | ~1,879 |
| withdrawals | ~5,065 |
| commissions | ~5,000 (mix of `due` + `paid`; paid rows carry `paid_amount`) |
| settlement_batches | 2 (0030) |
| notifications | 4 (0031, `commission_settled`) |
| distributors | 2 |
| demo_personas | 8 |
| employers | 1 (0034 — `emp-001`) |
| employees | 16 (0034) |
| contribution_runs | 3–4 (0034) |
| contribution_run_lines | ~56 (0034) |

The three idempotency ledgers (`settlement_uploads`, `contribution_run_uploads`, `subscriber_signup_uploads`) and the `users` / `agent_referrals` / `contact_submissions` tables are **empty after a fresh seed** — they fill only from live runtime activity.

**`users` table is NOT populated by the seed** (audit D13). `password_hash` (added in 0026) and `last_login_at` are stamped only on live signups via `/api/auth/verify-otp`. Demo subscribers/agents/branches/distributors have no `users` row by default; the JWT-mint path upserts on first OTP verify.

**`mockData.js` `DISTRIBUTORS` drift** (audit D15). `src/data/mockData.js:92–103` exports a `DISTRIBUTORS` dictionary containing only `d-001`. The seed inserts `d-001` AND `d-002`. Mock-backed mode (`VITE_USE_SUPABASE='false'`) will miss `d-002`.

**`MOCK_NOW`** = `new Date(2026, 4, 26)` (= `2026-05-26`) at `src/data/mockData.js:25`. The wall-clock date is now past this (`2026-06-05`); slide `MOCK_NOW` forward (or flip to `new Date()`) when relative-date demos start showing stale/negative-day signals.

### `scripts/seed-loader.mjs`

ESM resolution hook registered before `import('../src/data/mockData.js')`. Auto-appends `.js` to extension-less relative specifiers so the seed can read `mockData.js` unchanged.

### `scripts/clip-districts.mjs`

Boundary-clipping utility using `@turf/turf`. Reads `public/uganda-districts.geojson` + `public/uganda-regions.geojson`, intersects each district with its parent region, writes clipped output back. Backs up the original to `public/uganda-districts-original.geojson` on first run. Idempotent. Run manually: `node scripts/clip-districts.mjs`.

---

## §15. Backend findings

### §15a. Demo scope (by design — do not "fix")

Every item below is intentional for a sales-rep demo. Never frame as a production-prep TODO.

- **Any 6-digit OTP accepted** at `/api/auth/verify-otp` (regex `^\d{6}$` is the only check). No SMS provider, no rate limiting, no lockout. Same for KYC OTP at `/api/kyc/otp-verify` (4 digits, rejects `'0000'` only).
- **All 8 KYC routes are mocks** (`id-quality`, `id-ocr`, `nira-verify`, `otp-send`, `otp-verify`, `face-match`, `aml-screen`, `agent-referral`). Realistic latencies preserved so the live demo's animated checks land cleanly. Force-overrides via `x-qa-force` header (`fail-blur`, `partial`, `flagged`, `liveness-fail`, …) mirror the frontend's `localStorage upensions_*_force` keys.
- **Unit price hardcoded to 1,000 UGX/unit** at `supabase/migrations/0002_rpc_functions.sql:113` (`v_unit_price NUMERIC := 1000` inside `trg_transactions_contribution`). No fund NAV table.
- **JWT fixed 24h TTL, no refresh** (`DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24`). On 401 the frontend logs out gracefully.
- **`demo_personas` fallback IDs** (`ROLE_DEFAULTS` in both `verify-otp.ts` and `verify-password.ts`): `subscriber → 's-0001'`, `agent → 'a-001'`, `branch → 'b-kam-015'`, `distributor → 'd-001'`. Keeps every login successful for a sales demo even if the persona seed drifted.
- **Mocked chat** — `/api/chat` returns keyword-matched canned strings with hardcoded numbers (no LLM, no DB aggregates). Three flavours: admin (distributor/branch/admin), agent DM, subscriber co-pilot.
- **Per-session mutation stores** — frontend service files keep in-memory write overlays on top of frozen `mockData.js`. Resets on refresh (CLAUDE.md §10a).
- **`district_rank` / `rank` / `district_branch_count`** on `branches` computed once at seed time. No daily ranking job.
- **`commission_config` is a singleton** (`CHECK id = 'default'`); no UPDATE history table, no versioning.
- **`contribution_history`** is a JSONB sparkline denormalized from `transactions`; no consistency trigger keeps it in sync with the ledger.
- **`search_entities` hardcoded `LIMIT 8`.** Plenty for a demo's autocomplete UX.
- **No CSRF / origin checks** on the public POST routes. Acceptable because the demo runs from a single allowed origin.
- **No application-level security headers (CSP, HSTS, X-Frame-Options) configured by the platform.** Vercel hosts the frontend with default headers; Render's Express layer applies `helmet()` (the post-migration default) which sets sane defaults including X-Content-Type-Options and a baseline CSP. Tightening CSP for an SPA + cross-origin Render API is explicitly out of scope for the demo.

### §15b. Real bugs / awareness items

These affect the demo experience or future sessions — track but do NOT bundle with §15a, and do NOT propose production-hardening solutions.

**Closed in Phase 1 of the post-audit cleanup (2026-05-26).** Audit findings B1–B9, X2, X3 — API helper duplication, error-envelope drift, KYC phone normalization, DB-error swallowing, dead phone exports, the unused `withAuth` middleware classification, the route-count discrepancy, and the stale `disputeCommission` documentation drift — are all resolved. See §3, §4, §5 (and the Phase 1 commit SHAs cited there). The remaining items below are open or by-design.

**Auth-route subtleties (open / by-design):**

- `chat.ts` body `context` overrides role for unauthenticated callers; intentional but inconsistent with the strict role discipline elsewhere (audit B14). Documented at the call-site.
- `chat.ts` `resolveFlavor` reads the JWT **`app_role`** claim (not `role`) for authenticated callers — fixing audit BL-12/H1, where reading `role` (always the literal Postgres role `"authenticated"`) made every signed-in distributor/branch/agent fall through to the subscriber chat flavor. The §5.7 `'role'` vs `'app_role'` trap. Covered by `api/chat.test.ts` (each app_role → correct flavor; body context only honoured when unauthenticated).
- `chat.ts` type-checks `body.message` before `.trim()` (Phase 1G `1f0e2e1` — non-string bodies short-circuit to `invalid_message` instead of crashing).
- `change-password` now mounts behind `authLimiter` (`server/index.ts §9`, BL-17) — consistent with `verify-otp` / `verify-password`. It verifies a JWT then runs bcrypt + a DB write, so an already-authenticated token holder could otherwise hammer that CPU/DB path. This is a per-route throttle only; a real lockout/HIBP flow is out of demo scope (CLAUDE.md §10a).
- `verify-otp` / `verify-password` generic-catch 500 now returns `{ code: 'unexpected_error' }` (BL-39), not the 4xx `invalid_otp` / `invalid_request` vocabulary that previously rode a 500 status. See the error-envelope section above.

**Database invariants:**

- ~~`upsert_nominees` `GRANT` missing the `REVOKE ALL … FROM PUBLIC` preamble (audit D3)~~ — **CLOSED by `0027`**; verified on the new DB (ACL is `authenticated`/`service_role` only, no PUBLIC). The discipline is now uniform.
- ~~`nominees` has no per-bucket `UNIQUE` (audit D9)~~ — **CLOSED by `0027`**: partial UNIQUE `(subscriber_id, type, nin) WHERE nin IS NOT NULL` blocks duplicate-NIN. Sum-to-100 is enforced in `upsert_nominees` (0024) **and** the signup chain (0042 §3.2).
- Status columns — `0027` added `CHECK`s to `subscribers.kyc_status` / `withdrawals.status` / `claims.status` (audit D8); `insurance_policies.status` / `agent_referrals.status` / `distributors.status` remain `TEXT`-with-implicit-enum, no `CHECK`. (`0027`'s `commissions_status_chk` was later dropped by `0040` — it was missing `'paid'` and blocked settlements.)
- 4 legacy migrations lack idempotency guards on at least one statement: `0003`, `0006`, `0010`, `0025` (audit D12) — **`0028_replay_safety_guards` re-asserts their end-state idempotently** (forward-only), which is why the clean `0001`–`0042` replay onto the new DB succeeded.
- **First-contribution race — mitigated.** `commissions` now carries `ux_commissions_agent_subscriber UNIQUE(agent_id, subscriber_id)` (0017). The trigger's `NOT EXISTS` pre-check is preserved as a fast path; the unique index is the authoritative guard (CLAUDE.md §10b reference).
- **0018 superseded by 0020** but left in tree (audit D4). Operationally stale; do not apply.
- **`fix_metrics_rollup_app_role`** (audit D5) was remote-only on old Tokyo prod — now **backfilled as `0019_fix_metrics_rollup_app_role.sql`** in the tree, and the new DB's ledger records it as `0019`. `0020` still supersedes its body fix.

**Seed-data drift:**

- Seed does NOT populate `users` (audit D13) — `password_hash` is only stamped via live signups.
- Phone dedup is per-run, not idempotent against pre-existing live data (audit D14).
- `mockData.js#DISTRIBUTORS` knows only `d-001`; seed inserts `d-001` + `d-002` (audit D15). Mock-backed mode misses `d-002`.

**Existing awareness items (already in CLAUDE.md §10b):**

- Employer role is now **built** (`0034` schema + RLS, `0035` RPCs, desktop-first shell; demo persona `emp-001`). Both employer migrations — plus the `0032`/`0033` settlement-stack fixes and the `0036` anon-revoke / RLS-InitPlan migration — were **applied to live 2026-06-03** (manual `psql -f` apply + ledger reconcile; see §16 BL-6). The employer roster was later **unified into subscribers** (`0043`–`0047`): staff are tagged `subscribers` (no standalone `employees` table after `0045`), onboarded via the `employer_invites` KYC flow (`0047`). The **admin** role is now **shipped** too (`0049`–`0051`: 18 `*_select_admin` RLS clones + `create_distributor`/`create_employer`/`get_all_employers_metrics`/`get_platform_overview`/admin-settlement RPCs; map-theme shell at `src/admin-dashboard/`; demo persona `admin-001`; applied to live 2026-06-08) — **all 6 of 6 roles are built**.
- `agent_referrals` row PK `ar-<epoch>-<rand>` and public `UAG-XXXX` ticket ID (~1.7M space) — collision-tolerant but not cryptographic.
- No retry / idempotency keys on `/api/contact` or `/api/kyc/agent-referral`. A resubmit creates a second row.

**Commission dispute flow removed.** The entire maker-checker + dispute lifecycle (`agent_dispute_line`, `branch_dispute_line`, `approve/reject/withdraw_dispute`, `agent_confirm_commission`, settlement runs, holds) was dropped in `0029_commission_simplify.sql`, along with the `commissions.dispute_reason` and related columns. Settlement is now the single upload-driven `apply_settlement` RPC (§11). The historical migration `0014_signup_phone_and_agent_dispute.sql` (which once added `agent_dispute_line`) remains in the tree as forward-only history.

### §15c. Test coverage

12 backend `.test.ts` files now cover every route under `api/auth/` and `api/kyc/` (Phase 2B `93c51f2` shipped the 4 auth route tests; Phase 2C `91f413e` shipped the 8 KYC route tests). Combined the two phases added ~138 backend tests on top of the pre-Phase-2 vitest baseline:

| Layer | Files | Notes |
|---|---|---|
| `api/auth/*.test.ts` | 4 (`send-otp`, `verify-otp`, `verify-password`, `change-password`) | Phase 2B `93c51f2`. ~81 tests. Cover OTP-shape errors, password-shape errors, role enum, phone canonicalisation, password set vs change flows, JWT round-trip, DB-error → `db_error` envelope (Phase 1F). |
| `api/kyc/*.test.ts` | 8 (one per route) | Phase 2C `91f413e`. ~57 tests. Cover phone canonicalisation on the 3 phone-accepting routes, every `x-qa-force` branch, `Allow: POST` headers, the demo-scope 200-with-refusal contract on the 3 verifier routes. `Cache-Control: no-store` is now asserted on every route (success + 405, plus the 400 path on `id-ocr`/`face-match`): `agent-referral` since Phase 2C, the 7 mock routes added in BL-16 (the §15c claim previously held only for `agent-referral`). |
| `api/auth/_lib/password.test.ts` | 1 | Pre-existing. Shape validation + bcrypt hash/verify round-trip. |

`npm test` runs all vitest files (`api/**/*.test.ts` + `src/tests/**/*.test.{js,ts}`). For backend-only iteration: `npm test -- api/auth api/kyc`.

---

## §16. Operational runbook

### Local development

`supabase/config.toml` controls the local CLI emulator only (not the hosted project). Key ports:

| Service | Port | Notes |
|---|---|---|
| API gateway | 54321 | `[api]` block |
| Postgres | 54322 | `[db]` block |
| Studio | 54323 | `[studio]` block |
| Inbucket (email) | 54324 | dev mail catcher |
| Shadow DB | 54329 | for `supabase db diff` |

`project_id = "uganda-dashboard"`.

### Common operations

| Task | Command / SQL |
|---|---|
| Start local Supabase | `supabase start` |
| Apply migrations locally | `supabase db reset` (re-runs every `00NN_*.sql`) |
| Apply migrations to hosted project | Manual apply only — `psql -f supabase/migrations/00NN_name.sql "$SUPABASE_DB_URL"` (canonical; how `0032`–`0036` reached live 2026-06-03), then reconcile the ledger. **`supabase db push` is NOT the live deploy path — do NOT run against live without first reconciling the ledger. See "Migration-ledger drift" below (BL-6).** |
| Apply a single migration via MCP | `mcp__supabase__apply_migration` (note: wraps DDL in a transaction; split `CREATE INDEX CONCURRENTLY` out via `execute_sql` — see 0022 header) |
| Deploy the backend (Render) | **Manual only** — `render.yaml` sets `autoDeployTrigger: off` (CLAUDE.md §1 guardrail). Run `npm run deploy:api` (helper `scripts/render-deploy.mjs`, which POSTs the `RENDER_DEPLOY_HOOK` stored in `.env.local`) **or** Render dashboard → `uganda-dashboard-api` → Manual Deploy. Service: `uganda-dashboard-api` (`srv-d8bc20mgvqtc73afh16g`), branch `main`, region Singapore. |
| Deploy the frontend (Vercel) | **Auto** — Vercel deploys on push/merge to `main` via the GitHub App integration. No manual step. |
| Tail backend (Render) logs | Render dashboard → `uganda-dashboard-api` → Logs (live tail; ~7-day retention per `docs/render-operational.md` §Log Retention). Or via MCP: `mcp__render__list_logs`. |
| Tail frontend (Vercel) build/runtime logs | `vercel logs <deployment-url>` — note: post-migration there are no functions, so runtime logs are SPA build/serve only. |
| Reseed Postgres | `npm run seed` (reads `SUPABASE_DB_URL` from `.env.local`) |
| Clip GeoJSON | `node scripts/clip-districts.mjs` |
| Test a read RPC from psql | `SELECT public.get_entity_commission_summary('region', 'r-central');` |
| Impersonate a role in psql | `SET LOCAL request.jwt.claims = '{"role":"authenticated","app_role":"agent","agentId":"a-001","aud":"authenticated"}'; SELECT count(*) FROM subscribers;` |
| Rotate JWT secret | **4-step procedure (G42).** `api/_lib/jwt.ts:59-72` caches the secret as `Uint8Array` for the lifetime of the process; Render does NOT hot-reload env vars. (1) Supabase Dashboard → Project Settings → API → JWT Settings → rotate. (2) Update `SUPABASE_JWT_SECRET` in the Render dashboard env. (3) Trigger a Render restart — `npm run deploy:api` (POSTs the `RENDER_DEPLOY_HOOK` from `.env.local` via `scripts/render-deploy.mjs`), or Render dashboard → service → Manual Deploy → "Deploy latest commit". (4) Accept that all users get logged out: the 24h-TTL tokens become invalid immediately. (Vercel no longer holds this secret post-migration.) |
| Inspect realtime publication | `SELECT pubname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';` (expected: empty for `public.*` after 0025) |
| Confirm app_role discipline | `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND (qual LIKE '%''role''%' OR with_check LIKE '%''role''%');` (expected: 0) |

### `.env.local` workflow

- Start from `.env.local.example`; copy + fill in.
- **Do NOT run `vercel env pull`.** It overwrites `.env.local` and wipes the local-only `SUPABASE_DB_URL` (the seed script's only path to Postgres).
- The 6 `VITE_*` frontend keys with defaults (see §2) can be added when you need to override the hardcoded fallbacks in `src/config/env.js`.

### Smoke checks after deploy

- `POST /api/contact` with a dummy body → verify row in `contact_submissions`.
- `POST /api/auth/send-otp` then `verify-otp` with a known demo persona phone (`+256700000001` → agent `a-001`) → verify `users` row upserts and JWT round-trips.
- Open `/dashboard` as that agent → verify agent-scoped queries return rows (RLS predicate `agent_id = auth.jwt() ->> 'agentId'` matches).
- From the distributor account, call `apply_settlement(p_rows, p_nonce)` with a small payload of one agent's pending dues; verify the matching `commissions` lines flip to `paid`, a `settlement_batches` row appears, and agent + branch `notifications` rows are emitted. (Realtime no longer propagates — 0025 dropped the publication; React Query manual invalidation handles refresh.)

### Migration ledger — live head `0076`, one out-of-band episode (since reconciled) (BL-6)

**The Singapore DB (`ilkhfnoyxlxwqadebnkp`, `ap-southeast-1`, cutover 2026-06-05) was rebuilt clean by replaying every migration `0001`–`0042` in order at the cutover** (via the Supabase MCP `apply_migration`); the `0043`–`0076` migrations were then applied incrementally on top (per-file, the routine path). Its `supabase_migrations.schema_migrations` ledger head is now **`0076_subscribers_column_scoped_update`** (verified 2026-07-08), and it records the backfilled `0019_fix_metrics_rollup_app_role`. This is a clean break from the retired Tokyo project, whose ledger had accumulated drift (kept below for history).

> ⚠️ **One drift episode, since reconciled (2026-07-08).** Migrations **`0072`** (insurance save-to-cover) and **`0074`** (retire `pay_insurance_premium`) reached live **out-of-band** — their DDL/effects were live, but no `supabase_migrations` ledger row was recorded, so the ledger briefly lagged the files. The 2026-07-08 deep-audit privilege-lockdown fixes **`0075`** (`0075_lock_privilege_surface`) and **`0076`** (`0076_subscribers_column_scoped_update`) were applied **with** ledger rows and the head reconciled to `0076`. Note `0075` also **re-applies `0072` §1f** (the `contribution_schedules` money-column `REVOKE`), which never took effect live (audit A2) — see §10.

- **Live ledger head = `0076`.** Files `0001`–`0076` are all applied. The **routine** path is explicit per-file apply (`mcp__supabase__apply_migration` / `psql -f <file>` against `SUPABASE_DB_URL`) + `scripts/seed-supabase.mjs` — and `supabase db reset` remains **local-only** (it drops + reseeds; never run it against live). ⚠️ The `0072`/`0074` episode above is the lesson: apply each file **with** its ledger row so the head never silently lags the schema.
- **Historical (retired Tokyo prod) — for context only.** That ledger was missing **6 local migrations** (`0022`/`0023`/`0024`/`0025`/`0027`/`0028`) whose *effects* had been applied out-of-band, plus a remote-only `20260519165115 fix_metrics_rollup_app_role`. `0032`–`0036` were applied manually via `psql -f` on **2026-06-03** and the ledger reconciled then. The new-DB rebuild resolved all of it; no `migration repair` is needed on the new project.
- **Still true regardless of DB:** `0003`/`0006`/`0010`/`0025` contain non-idempotent statements (§15b audit D12). `0028_replay_safety_guards` re-asserts their end-state idempotently — which is exactly why the clean `0001`–`0042` replay onto the new DB succeeded without manual intervention. Always take + verify a full backup before any destructive ledger or schema operation against live (pairs with the lossy-`0029.down.sql` backup gate, BL-9). This subsection is the canonical record of "how migrations reach live."

### Migration discipline (forward-only)

- Never edit a shipped migration file. The Supabase migration system records each file's hash; editing a shipped file breaks `db push`.
- For schema fixes, add a new `00NN_*.sql`. New migrations should ship a `.down.sql` partner (see 0016/0022/0023/0024/0025/0026).
- For RPC body changes, `CREATE OR REPLACE FUNCTION` in a new migration. The grants in `0002` follow each function definition; new migrations inherit those unless the signature changes.
- New SECURITY DEFINER functions MUST set `search_path = public` (or `public, pg_temp`) and read `auth.jwt() ->> 'app_role'` — never `'role'`. The contract test in `src/tests/jwt-claim-contract.test.js` guards the claim names.

---

## §17. See also

- `CLAUDE.md` — slim index, hard rules, glossary, demo credentials, awareness items.
- `FRONTEND.md` — service/hook/context inventory, dashboard variants, design tokens, React Query keys + invalidation, frontend-side demo behaviours.
- `docs/api-contracts.md` — current request/response + RPC catalogue (the old aspirational ~30-route REST surface was archived to `docs/archive/api-contracts-2024-original.md`; audit X1 reconciled). Covers the 14 routes, the 21 RPCs (incl. 0041 aggregates + employer family), and PostgREST reads.
- `docs/data-model.md` — field-level entity definitions, metric-aggregation rules, branch-health-score formula, KYC/withdrawal/AUM open questions.
- `docs/role-permissions.md` — role × capability matrix.
- `docs/SPEC.md` — product spec: personas, workflows, business rules.
