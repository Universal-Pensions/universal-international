> **Agent guide.** This is the HTTP request/response contract reference for the platform's real backend surface — the 14 `api/` routes, the Supabase RPCs called via `supabase.rpc()`, and the RLS-governed PostgREST reads, together with their cache-key and invalidation conventions. Read it when you are wiring or debugging a concrete request/response shape, error `code`, or RPC signature; for the wider auth flow, schema, and RLS narrative open `docs/BACKEND.md`, and for role × capability questions open `docs/role-permissions.md`. Do NOT read it as the aspirational ~30-route REST design in `docs/archive/api-contracts-2024-original.md` (that shape was never built), and note the intentional demo mocks (OTP / KYC / `chat`) documented below are current behavior, not TODOs.

# Universal Pensions Uganda — API Contracts

Current request/response contract for the platform's backend surface. The old `~30-route REST` design has been archived in `docs/archive/api-contracts-2024-original.md` — it described an aspirational shape that was never built. The real surface is much smaller:

1. **14 API routes** under `api/` (Vercel-shape TypeScript handlers, now mounted by `server/index.ts` on **Render Express** at `https://uganda-dashboard-api.onrender.com`. The Vercel-style request/response signature is preserved via the `toExpress(handler)` adapter in `server/adapter.ts`).
2. **Supabase RPCs** (PostgreSQL `SECURITY DEFINER` functions) called via `supabase.rpc(name, args)` from the frontend with the user's HS256-signed JWT.
3. **PostgREST direct table reads** governed by row-level security policies (no writes — writes always go through RPCs).

Cross-references:
- `BACKEND.md §3-§5` — full route inventory, error vocabulary, auth flow.
- `BACKEND.md §8` — RLS policies and the `auth.jwt() ->> 'app_role'` rule.
- `BACKEND.md §9-§10` — RPC catalogue + commission state machine.
- `ARCHITECTURE.md` — high-level write/read patterns, auth model.

---

## 1. Conventions

### 1.1 Error envelope

All 14 API routes return errors as JSON in the form:

```json
{ "code": "snake_case_reason", "message": "optional human string" }
```

`code` is always present and machine-stable. `message` is optional and only set when the body carries a useful customer-facing or operator string (e.g. the `403 account_deactivated` body). **Note:** `db_error` is now a **bare `{ code: 'db_error' }`** with no `message` — the Supabase-`error.code`-in-`message` detail it used to attach was removed in commit `1a5c370` (the Supabase error is logged server-side instead). The frontend's `services/api.js` fetch wrapper raises an `Error` with `.code` and `.status` set so callers can branch on `err.code === 'invalid_otp'` etc. See `BACKEND.md §3` for the full vocabulary.

### 1.2 Auth header

Every route except the auth-related ones (`send-otp`, `verify-otp`, `verify-password`) and the public ones (`contact`, all `kyc/*` during signup) accepts:

```
Authorization: Bearer <jwt>
```

JWT is HS256, custom-signed (not Supabase Auth — see `BACKEND.md §6`). Claims include `phone`, `app_role`, plus the role-scoped ID (`subscriberId` / `agentId` / `branchId` / `distributorId`). 401 on the server triggers `onAuthExpired` on the client, clearing `localStorage` and redirecting home.

### 1.3 Cache headers

Every auth handler and the chat/contact handlers set `Cache-Control: no-store` on **every** response path (B13 in the audit). This now holds for the **405 method-not-allowed path too** — the 2026-06-08 audit (§2a.2) found the four auth handlers (`send-otp`, `verify-otp`, `verify-password`, `change-password`) had `return`ed the 405 *before* their `res.setHeader('Cache-Control','no-store')` line, leaving auth-family 405s cacheable; the campaign **lifted the header above the method check** in all four, so a GET-against-auth 405 now carries `Cache-Control: no-store` like every other family. (Verify by reading the first lines of each `api/auth/*.ts` handler — the `setHeader` precedes the method gate.) KYC routes still don't set this; they hit no DB so caching by accident is harmless, but the convention is to add it on any route that touches user-scoped state.

**Malformed / oversized request bodies** are now mapped explicitly (audit §2a.3): a body-parser-aware error handler in `server/index.ts` turns a `SyntaxError` (`entity.parse.failed`) into `400 { code: 'invalid_json' }` and a `>200kb` body (`entity.too.large`) into `413 { code: 'payload_too_large' }`, both with `Cache-Control: no-store` — previously both surfaced as `500 { code: 'unexpected_error' }`, which `apiFetch` mis-read as a server outage and auto-retried.

### 1.4 Demo scope (do not propose fixes)

CLAUDE.md §10a is the canonical list. Relevant to this doc:
- `verify-otp` accepts any 6-digit code.
- KYC routes are stateless Smile-ID-v2-shaped mocks with simulated latency. Pass `x-qa-force` headers to force failure paths.
- `chat` is a keyword-matching mock; no LLM.
- `contact` writes to `contact_submissions` but no email is dispatched.

---

## 2. API routes (14 total)

All routes live under `api/` and are served by Express on Render — `server/index.ts` mounts each handler via `app.all('/api/...', toExpress(<handler>))`. (`app.all` instead of `app.post` preserves the per-handler manual 405 contract.) All return JSON. All accept only `POST` unless noted; non-POST returns 405 `{ code: 'method_not_allowed' }` with an `Allow: POST` header. Frontend points at `VITE_API_BASE_URL` (`http://localhost:3001/api` in local dev, absolute Render URL in prod).

### 2.1 Auth (4 routes — `api/auth/`)

#### `POST /api/auth/send-otp`
Dev-bypass stub — no SMS provider. Validates phone shape + role enum and returns success so the OTP entry step proceeds.

- **Body:** `{ phone: string, role: 'subscriber'|'agent'|'branch'|'distributor' }`
- **Response 200:** `{ success: true }`
- **Errors:** `400 invalid_request`, `405 method_not_allowed`
- **Source:** `api/auth/send-otp.ts`

#### `POST /api/auth/verify-otp`
Validates OTP shape, resolves role-scoped entity ID via `demo_personas` (falling back to seeded defaults — see CLAUDE.md §8), upserts `users(phone, role)` row, and mints a JWT. Accepts an optional `password` to stamp a bcrypt hash on first login.

- **Body:** `{ phone: string, otp: string (6 digits), role: JwtRole, password?: string }`
- **Response 200:** `{ token: string, user: { id, phone, role, name?, hasPassword: boolean, subscriberId?|agentId?|branchId?|distributorId? } }`
- **Errors:** `400 invalid_otp | password_required | password_too_short | password_too_long | password_too_weak`, `403 account_deactivated` (resolved agent/branch/distributor/employer has `status='inactive'` — migration `0060`; gate added commit `b73e577`, shared helper `api/auth/_lib/entity-status.ts`; subscribers + admin never gated), `500 db_error` (bare `{ code }`)
- **Source:** `api/auth/verify-otp.ts`

#### `POST /api/auth/verify-password`
Password sign-in companion to `verify-otp`. Looks up the `users(phone, role)` row and bcrypt-verifies `password` against `password_hash`. On success, mints a JWT with the same shape `verify-otp` does.

- **Body:** `{ phone: string, role: JwtRole, password: string }`
- **Response 200:** same shape as `verify-otp`, with `hasPassword: true`.
- **Errors:** `400 invalid_request`, `401 password_not_set | invalid_password | role_mismatch`, `403 account_deactivated` (correct password on a deactivated agent/branch/distributor/employer — `status='inactive'`, migration `0060`; checked AFTER the bcrypt compare so a wrong password still returns `401 invalid_password`), `500 db_error` (bare `{ code }`)
- **Source:** `api/auth/verify-password.ts`

#### `POST /api/auth/change-password`
Authenticated. Sets or rotates the user's password. Initial-set flow (no existing hash) skips `currentPassword`; change flow requires it.

- **Header:** `Authorization: Bearer <jwt>`
- **Body:** `{ currentPassword?: string, newPassword: string }`
- **Response 200:** `{ ok: true, hasPassword: true }`
- **Errors:** `400 password_required | password_too_short | password_too_long | password_too_weak | current_password_required`, `401 unauthorized | current_password_invalid`, `404 user_not_found`, `500 db_error | unexpected_error`
- **Source:** `api/auth/change-password.ts`

### 2.2 KYC (8 routes — `api/kyc/`)

All KYC routes are stateless Smile-ID-v2-shaped mocks with simulated latency. They take a client-generated `sessionId` for correlation across stages and (where applicable) `prevTrackingIds` to chain. None require a JWT (signup runs pre-auth). QA can pass `x-qa-force: <reason>` headers to force failure outcomes — each route documents its accepted values inline.

| Route | Body (multipart unless noted) | Response | Latency | Force values |
| --- | --- | --- | --- | --- |
| `POST /api/kyc/otp-send` | `{ phone, sessionId? }` (JSON) | `{ success: true, expiresIn: 300 }` | ~600ms | — |
| `POST /api/kyc/otp-verify` | `{ phone, code, sessionId? }` (JSON) | `{ verified: boolean }` | ~700ms | `fail` |
| `POST /api/kyc/id-quality` | `image: File, sessionId?` | `{ blur, corners, glare, pass, score }` | ~900ms | `fail-blur`, `fail-corners`, `fail-glare` |
| `POST /api/kyc/id-ocr` | `front: File, back: File, sessionId?` | `IdExtraction { fullName, nin, cardNumber, dob, districtId, gender, barcodeRaw, confidence, trackingId }` | ~2200ms | — |
| `POST /api/kyc/nira-verify` | `{ nin, cardNumber, dob, fullName, sessionId? }` (JSON) | `{ result: 'match'\|'partial'\|'no-match', mismatchedFields?, reason?, trackingId }` | ~1800ms | `partial`, `no-match` |
| `POST /api/kyc/face-match` | `selfie: File, nin, sessionId?` | `{ match, liveness, matchScore, outcome: 'ok'\|'liveness-fail'\|'no-match', trackingId }` | ~1500ms | `liveness-fail`, `no-match` |
| `POST /api/kyc/aml-screen` | `{ fullName, dob, nin, sessionId?, niraTrackingId? }` (JSON) | `{ outcome: 'clear'\|'flagged', trackingId }` | ~1200ms | `flagged` |
| `POST /api/kyc/agent-referral` | `{ phone, reason, stage?, trackingId?, sessionId? }` (JSON) | `{ ticketId, eta }` | ~600ms | — |

Sources: `api/kyc/*.ts`. Each route also returns `400 invalid_request` for missing/malformed fields and `405 method_not_allowed` for non-POST.

#### KYC verdict-envelope matrix — 4xx vs 200 (intentional demo behavior)

A KYC step **failing its check is a business verdict, not an HTTP error** — these routes return **HTTP 200 with the verdict in the body** (`{ verified:false }`, `{ result:'no-match' }`, `{ outcome:'flagged' }`, …), and reserve the **4xx envelope** strictly for *shape*/transport faults (missing field, wrong method). This is by design (audit §2a, C1's 4xx-vs-200 matrix): a "no-match" NIRA result is a normal signup branch the client renders into a retry/agent-referral flow, so it must not look like a network failure. Forcing a verdict via the `x-qa-force` header still returns 200 — the header only changes the *verdict in the body*, never the status. The deliberate split:

| Outcome class | HTTP | Body | Example |
| --- | --- | --- | --- |
| **Success / positive verdict** | **200** | route success shape | `{ verified: true }`, `{ result: 'match' }`, `{ outcome: 'clear', trackingId }` |
| **Negative / "failed-check" verdict** (incl. `x-qa-force`-forced) | **200** | same success shape, verdict field flipped | `{ verified: false }`, `{ result: 'no-match', mismatchedFields, reason }`, `{ outcome: 'flagged' }`, `{ outcome: 'liveness-fail' }` |
| **Bad request shape** (missing/malformed field, bad file) | **400** | `{ code: 'invalid_request' }` | `nira-verify` with no `nin` |
| **Wrong method** (GET/PUT/…) | **405** | `{ code: 'method_not_allowed' }` + `Allow: POST` | `GET /api/kyc/aml-screen` |

Consequence for the client: KYC service callers branch on the **body verdict** (`result`/`outcome`/`verified`), and only treat a thrown `err.code` (the 4xx/`apiFetch` path) as a true error. Do not "fix" the 200-on-failed-verdict by promoting it to a 4xx — it would break the signup branch logic and is explicitly out of scope (demo behavior, CLAUDE.md §10a).

### 2.3 Misc (2 routes)

#### `POST /api/contact`
Public. Validates the landing-page contact form and inserts into `contact_submissions` via the service-role Supabase client (RLS bypassed because the form is open to unauthenticated visitors).

- **Body:** `{ name: string, email: string, message: string }`
- **Response 200:** `{ submitted: true, id: string }`
- **Errors:** `400 invalid_name | invalid_email | invalid_message`, `500 db_error`
- **Source:** `api/contact.ts`

#### `POST /api/chat`
JWT-optional. When a token is present, `req.user.role` selects the flavour (admin vs agent vs subscriber). When absent, the body's `context` field is honoured (intentional demo-scope policy — see B14 in the audit). Keyword-matching mock; no LLM.

- **Header (optional):** `Authorization: Bearer <jwt>`
- **Body:** `{ message: string, context?: 'admin'|'agent'|'subscriber' }`
- **Response 200:** `{ reply: string, suggestions?: string[] }`
- **Errors:** `400 invalid_message`
- **Source:** `api/chat.ts`

---

## 3. Supabase RPCs

The frontend authenticates to Supabase as `authenticated` and calls `SECURITY DEFINER` PL/pgSQL functions via `supabase.rpc(name, args)`. RPCs read JWT claims via `auth.jwt() ->> 'app_role'` etc. (never `auth.uid()` — see CLAUDE.md §5 anti-pattern 7).

### 3.1 Entity / read RPCs

| RPC | Args | Returns | Intent |
| --- | --- | --- | --- |
| `get_entity_metrics_rollup` | `p_level text, p_entity_id text` | `jsonb` (totals + 12-month series + drill-down counts) | One-shot aggregate for distributor/branch overview cards. Replaces N PostgREST queries. |
| `get_top_branch` | `p_level text, p_entity_id text` | `{ name, contribution } \| null` | Highest-contribution branch under the given scope. |
| `get_breadcrumb` | `p_level text, p_ids jsonb` | `Array<{ level, id, name }>` | Path from country down to the currently-selected entity. |
| `search_entities` | `p_q text` | `Array<{ id, name, level, label, parentId }>` (max 8) | Top-bar entity search across regions/districts/branches/agents. |
| `get_commission_summary` | `p_branch_id text \| null` | `{ totalCommissions, totalPaid, totalDue, countTotal, countPaid, countDue }` | Commission KPI cards. |
| `get_entity_commission_summary` | `p_level text, p_entity_id text` | `{ totalPaid, totalDue, countPaid, countDue, total, countTotal, settlementRate }` | Per-entity commission breakdown (drill-down overlays). |
| `get_agent_commission_detail` | `p_agent_id text` | Agent-level detail object (`{ …, totalPaid, totalDue, paidTransactions[], dueTransactions[] }`; paid lines expose `paidAmount`) | Agent drawer in commission panel. |
| `get_agent_commission_list` *(0041)* | `p_status_focus text \| null` | `TABLE(agent_id, agent_name, employee_id, branch_id, branch_name, total_commissions, total_paid, total_due, subscribers_onboarded, active_subscribers, filtered_amount, filtered_count)` | Per-agent commission roll-up for the distributor list (STABLE). |
| `get_pending_dues_by_agent` *(0041)* | _(none)_ | `TABLE(agent_id, agent_name, employee_id, branch_id, branch_name, pending_amount, pending_count)` | Settlement-template prefill (pending dues per agent). |
| `get_pending_dues_by_branch` *(0041)* | _(none)_ | `TABLE(branch_id, branch_name, pending_amount, pending_count, agent_count)` | Pending dues rolled up per branch. |
| `get_platform_overview` *(0050; `byChannel` added 0058)* | _(none)_ | `{ totalSubscribers, subscribersViaDistributor, subscribersViaEmployer, subscribersDirect, activeSubscribers, inactiveSubscribers, distributors, employers, branches, agents, aum, totalContributions, totalWithdrawals, byChannel:{ distributor, employer, direct } }` (each `byChannel` slice = `{ subscribers, active, inactive, aum, contributions, withdrawals }`) | Admin-only (`app_role='admin'`) TRUE platform totals + per-channel split for the Platform Overview scope filter. Channels sum exactly to the un-split totals. |
| `get_employer_geo_rollup` *(0058)* | _(none)_ | `{ byRegion:{ [region_id]:{ subscribers, active, aum, employers } }, byDistrict:{ [district_id]:{ subscribers, active, aum, employers, list:[{ id, name, subscribers, active, aum }] } } }` | Admin-only. Employer-channel subscribers placed on the map by resolving `employers.district = districts.name` → region; powers the Employers/All scope counts + the district drill-down Employers tab. Unmatched district text → `'unmapped'` key. |

> The first three commission read RPCs were re-emitted in `0029_commission_simplify.sql` in slimmed paid/due-only form (disputed/run buckets dropped). The last three were added in `0041_commission_aggregate_rpcs.sql` — they move what were client-side JS folds into Postgres so the aggregate isn't truncated at PostgREST's 1000-row page cap.

### 3.2 Write RPCs (settlement + notifications)

The maker-checker commission state machine was removed in `0029`. There is one transition (`due → paid`) and it goes through `apply_settlement`. See `BACKEND.md §11` for the flow.

| RPC | Args | Effect |
| --- | --- | --- |
| `apply_settlement` | `p_rows jsonb, p_nonce text` | Distributor-only (signature changed in **0032**). Allocates each agent's whole-UGX-rounded `amountPaid` FIFO oldest-first across that agent's `due` lines: covered lines flip to `paid` (`paid_amount = own amount`/`paid_date`/`txn_ref`), uncovered lines stay `due` (INFORM-NOT-BLOCK partial). Records a `settlement_batches` row (`paid_amount` = allocated total), emits agent + branch `commission_settled` notifications (formatted body). `p_nonce` is a per-upload idempotency key — a replay returns the prior result (`settlement_uploads` ledger) without re-recording. Skip reasons: `missing_agent_id`, `no_due`, `amount_too_low`. Returns `{ agentsSettled, linesSettled, totalPaid, skipped: [{ agentId, reason }] }`. |
| `mark_notifications_read` | `p_ids text[]` | Owner-scoped (agent / branch). Sets `is_read = TRUE` on the caller's own notification rows. |

The dropped RPCs (`open_run`, `cancel_run`, `release_run`, `release_branch`, `branch_approve_all`, `mark_branch_reviewed`, `branch_approve_line`, `branch_hold_line`, `branch_dispute_line`, `agent_dispute_line`, `approve_dispute`, `reject_dispute`, `withdraw_dispute`, `agent_confirm_commission`, `get_run_branch_breakdown`) no longer exist.

### 3.3 Other write RPCs

| RPC | Args | Effect |
| --- | --- | --- |
| `create_subscriber_from_signup` | `payload jsonb` | Atomic subscriber creation from the public `/signup/*` flow — creates subscriber + balances + schedule + insurance + nominees + first-contribution commission in a single transaction. |
| `create_subscriber_from_agent_onboard` | (named args) | Same shape as above but invoked from the agent's onboard flow; differs in audit trail. |
| `upsert_nominees` | `(p_subscriber_id text, p_pension jsonb, p_insurance jsonb)` | Replaces pension / insurance nominee lists; atomically validates share-sum invariants. |

Both signup RPCs gained an optional trailing `p_nonce text` parameter in `0042_signup_writeflow_hardening.sql` — a replayed submit with the same nonce returns the prior subscriber id (via the `subscriber_signup_uploads` ledger) instead of minting a duplicate chain.

See `supabase/migrations/0002_rpc_functions.sql`, `0024_upsert_nominees.sql`, `0029_commission_simplify.sql` (slimmed commission reads), `0031_notifications.sql` (`apply_settlement`, `mark_notifications_read`), `0041_commission_aggregate_rpcs.sql`, and `0042_signup_writeflow_hardening.sql` for the canonical PL/pgSQL.

### 3.4 Employer RPCs (`0035` + `apply_group_insurance` from `0039`)

All `SECURITY DEFINER`, gated on `app_role = 'employer'`, scoped to the `employerId` JWT claim. Called from `src/services/employer.js`. See `BACKEND.md §10.1` for full semantics.

| RPC | Args | Effect |
| --- | --- | --- |
| `submit_contribution_run` | `p_rows jsonb, p_period_label text, p_method text, p_nonce text` | The core write. Re-derives every amount server-side (client amounts are advisory), splits the gross by each employee's schedule, writes `contribution_run_lines`, bumps `employees` balances inline (UGX 1,000/unit), nonce-idempotent. The `co-contribution` branch uses the `0038` match model (employer matches `matchPct`% of the employee's `monthly_contribution`, capped). **Never writes `transactions`/`subscriber_balances`/`commissions`.** |
| `update_employee_contribution_config` | `p_employee_id text, p_config jsonb` | Ownership-checked replace of one employee's `contribution_config`. |
| `update_employee_insurance` | `p_employee_id text, p_cover numeric, p_premium numeric` | Ownership-checked per-employee insurance cover + premium. |
| `update_employer_profile` | `p_patch jsonb` | Patches the caller's own `employers` row (profile/config keys only). |
| `get_employer_metrics` | _(none)_ | STABLE hero/overview aggregates scoped to the caller's employer. |
| `apply_group_insurance` *(0039)* | `p_cover numeric` | Roster-wide flat group life cover on every owned employee (premium zeroed, status derived from cover). Returns `{ updated, cover }`. |

---

## 4. PostgREST reads (RLS-governed)

Reads of tables like `subscribers`, `subscriber_balances`, `transactions`, `claims`, `withdrawals`, `nominees`, `insurance_policies`, `subscriber_insurance_products`, `commissions`, `settlement_batches`, `notifications`, `agent_referrals`, `entities`, etc. happen directly via the `supabase-js` query builder (`supabase.from('subscribers').select(...)`). (`settlement_runs` / `settlement_run_branch_reviews` were dropped in `0029`.)

The agent subscriber list (`getAgentSubscriberList`, cache key `['agentSubscribers', agentId]`) embeds `insurance_policies(cover, premium_monthly, status)` **and** `subscriber_insurance_products(product, status)` (the latter readable via the `sip_select_agent` RLS policy, `0065`). The service builds a `subscriber.policies` array of `{ product, status }` for ACTIVE policies only — **product + status, never cover/premium** (agents must not see cover). Cache key and invalidation are unchanged by the added embed.

Every table has RLS enabled. Policies read `auth.jwt() ->> 'app_role'` (the application role) plus `auth.jwt() ->> '<role>Id'` to scope rows. Defer to:

- `supabase/migrations/0003_rls_policies.sql` — initial policy bodies.
- `supabase/migrations/0007_rls_use_app_role.sql` — switch from `'role'` to `'app_role'` (canonical fix for the silent-failure trap).
- `supabase/migrations/0008_rls_wrap_auth_jwt_initplan.sql` + `0023_rls_initplan_fixes.sql` — initplan caching tightenings.
- `ARCHITECTURE.md` and `BACKEND.md §8` — narrative of the RLS model.

Writes are NEVER permitted directly through PostgREST — all writes flow through SECURITY DEFINER RPCs (CLAUDE.md §7).

---

## 5. Realtime channels

Supabase realtime is **off for all `public.*` tables**. `0025_drop_realtime_publication.sql` removed the original `commissions` / `settlement_runs` / `settlement_run_branch_reviews` publication (zero `.channel()` subscribers), and the new `settlement_batches` + `notifications` tables (0030/0031) are not published either — the notification bell polls via React Query. Cross-laptop demo sync relies on React Query staleTime + manual invalidation.

---

## 6. Quick index

| Surface | Count | Where defined |
| --- | --- | --- |
| API routes | 14 | `api/**/*.ts` (excl. `_lib/`, `*.test.ts`) |
| Migrations | 0001–0078 | `supabase/migrations/*.sql` (all applied to the Singapore DB, cutover 2026-06-05; range extended past 0042 as the platform matured — see `docs/migrations-runbook.md`. NB: the read RPC `get_top_entities` (0077/0078) backs the distributor/admin bounded top-N landing) |
| RPCs (read) | 10 | `0002`, `0020_entity_metrics_rollup_v3.sql`, slimmed commission reads in `0029`, + 3 commission aggregates in `0041` |
| RPCs (settlement / notification) | 2 | `0031_notifications.sql` (`apply_settlement`, `mark_notifications_read`) — replaced the 14 commission state-machine RPCs dropped in `0029` |
| RPCs (other write) | 3 | `0002_rpc_functions.sql`, `0024_upsert_nominees.sql` |
| RPCs (employer) | 6 | `0035_employer_rpcs.sql` (5) + `apply_group_insurance` (`0039`) |
| Tables | 28 | core + settlement stack + 5 employer tables + idempotency ledgers (incl. `subscriber_signup_uploads`, `0042`) |
| Tables with realtime | 0 | publication empty post-`0025`; `settlement_batches` / `notifications` not published |

For runtime detail (env vars, auth flow, JWT shape, trigger logic, the `app_role` vs `role` trap), open `BACKEND.md`. For role × capability questions, open `docs/role-permissions.md`. For the legacy aspirational REST design, open `docs/archive/api-contracts-2024-original.md`.
