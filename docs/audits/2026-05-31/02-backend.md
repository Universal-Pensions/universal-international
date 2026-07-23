> **Agent guide.** Historical audit from 2026-05-31, covering the backend API handlers, auth, security and the file-parse upload path — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 02 — Backend API, Auth, Security & File-Parse (Agent B, Phase 1)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (working tree)
**Agent:** Agent B — Backend API, Auth, Security & File-Parse. READ-ONLY.
**Scope covered:** `server/{index,adapter,env,cors}.ts`; all 14 `api/` handlers (`api/auth/*` ×4, `api/kyc/*` ×8, `api/contact.ts`, `api/chat.ts`); `api/_lib/*` (`jwt.ts`, `supabase-admin.ts`, `bearer.ts`, `withAuth.ts`, `withOptionalAuth.ts`, `phone.ts`); `api/auth/_lib/*` (`personas.ts`, `claims.ts`, `password.ts`); `api/kyc/_lib/mocks.ts`; and the upload data path `src/utils/xlsx.js` + `src/utils/settlement.js` (+ `src/utils/commissionMonths.js`).

Cross-referenced against `BACKEND.md §15a/§15b/§15c`, `CLAUDE.md §4–5/§7/§10a`, `docs/DASHBOARD_AUDIT*.md`, `docs/audit/*`, `docs/archive/*`, and the Phase-0 seed findings in `00-baseline.md`.

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
| real-bug | 2 |
| quality/tech-debt | 6 |
| intentional-demo-scope | 1 |
| already-known | 2 |

**Overall posture is strong.** Auth enforcement, JWT signing/verification (HS256 pinned, no alg-confusion), service-role-key isolation, the env preflight, crash-recovery handlers, bcrypt cost, password shape rules, and `app_role` discipline in the new RPCs are all correct. No JWT/password/secret leakage in any log (CLAUDE.md §7 clean). The two genuine bugs are (1) the new server-side `/api/chat` route reads the wrong JWT claim so every signed-in user gets the subscriber chat flavor, and (2) the `apply_settlement` upload path has no idempotency guard against a re-submitted batch.

---

## High

### H1. `/api/chat` reads `req.user.role` (always `"authenticated"`) instead of `app_role` — every signed-in user gets the subscriber chat flavor
- **Classification:** real-bug
- **Severity:** High
- **Evidence:** `api/chat.ts:237` (`if (req.user?.role) return flavorForRole(req.user.role);`), `flavorForRole` at `api/chat.ts:214-219`, JWT claim shape at `api/_lib/jwt.ts:30,86` (`role: 'authenticated'` is hardcoded; the application role lives in `app_role`).
- **Impact:** The JWT `role` claim is always the literal Postgres role `"authenticated"` (by design — see `jwt.ts` header and `claims.ts:13`). `flavorForRole('authenticated')` falls through every branch and returns `'subscriber'`. Because the JWT branch wins over the body `context` for authenticated callers (`resolveFlavor`, `api/chat.ts:234-242`), a signed-in **distributor / branch / agent** using the in-dashboard chat assistant always receives the **subscriber co-pilot** replies — even though `src/services/chat.js:88-90` correctly passes `context: 'admin'` for the distributor data assistant and `context: 'agent'` for the agent DM. The body context is silently ignored for exactly the authenticated callers it was meant to serve. This is a visible breakage of a primary-role demo surface (the distributor/branch "data assistant" and the agent DM both degrade to generic saver answers). The file header comment at `api/chat.ts:3,11` asserts the JWT-role path works, masking the bug. This is the §5.7 / Anti-pattern-#7 `role`-vs-`app_role` trap reappearing in the new server-side chat route (the route is new in this changeset; chat was client-only before).
- **Not already-known:** `BACKEND.md §15b` records B14 only for the *unauthenticated* body-context override — it does not cover this authenticated-claim misread. No `chat.test.ts` exists to catch it.
- **Recommendation:** Read the application role from `req.user?.app_role` (not `.role`) in `resolveFlavor`, e.g. `if (req.user?.app_role) return flavorForRole(req.user.app_role);`. Add a `chat.test.ts` asserting an authenticated distributor/agent JWT yields the admin/agent flavor.

### H2. `apply_settlement` has no idempotency / nonce guard — a re-submitted upload double-records batches + double-notifies
- **Classification:** real-bug (seed SEED-B2 / D1)
- **Severity:** High
- **Evidence:** RPC body `supabase/migrations/0031_notifications.sql:93-217` (selects `status='due'` per agent, no idempotency key); service call `src/services/commissions.js:381-385` (`supabase.rpc('apply_settlement', { p_rows: rows })`); mutation `src/hooks/useCommission.js:105-111`; UI confirm `src/dashboard/commissions/CommissionPanel.jsx:244-256`.
- **Impact:** The only guard against a double-submit is the client-side `disabled={applySettlement.isPending}` on the confirm button (`CommissionPanel.jsx:913,920`). That protects a rapid double-tap within one mount, but not: (a) two browser tabs / a page reload mid-flight, (b) a network retry, or (c) re-uploading the same workbook after new `due` lines were auto-generated by a subscriber's first contribution between submissions. The RPC stamps *all* current `due` lines paid and unconditionally INSERTs a fresh `settlement_batches` row + agent/branch `notifications` per call. A second run over the same agent finds no `due` lines and skips (`no_due`) — so it is *partly* self-idempotent — but any newly-due line is swept into the second batch with the old `amountPaid`, producing a duplicate batch row and duplicate "Commission settled" notifications. Note `settlement_batches.id` is server-generated (`'sb-' || gen_random_uuid()`), so there is no natural dedupe key.
- **Recommendation:** Add a client-supplied idempotency nonce (e.g. a per-upload UUID generated when the confirm modal opens) carried in `p_rows`/an out-of-band arg, persisted on `settlement_batches`, and checked with a `UNIQUE` constraint or an `INSERT ... ON CONFLICT DO NOTHING` early-return before any UPDATE/INSERT. (Backend ownership shared with Agent A for the SQL side.)

---

## Medium

### M1. All 8 KYC mock routes omit `Cache-Control: no-store` — contradicts BACKEND.md §15c and leaves PII responses cacheable
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:** No `Cache-Control` set in `api/kyc/otp-send.ts`, `api/kyc/otp-verify.ts`, `api/kyc/id-ocr.ts`, `api/kyc/id-quality.ts`, `api/kyc/face-match.ts`, `api/kyc/aml-screen.ts`, `api/kyc/nira-verify.ts` (verified `grep -c Cache-Control` = 0 on each). Contrast: all 4 `api/auth/*` routes, `api/contact.ts:30,36`, `api/chat.ts:247,254`, and `api/kyc/agent-referral.ts:46,52` *do* set `no-store`.
- **Impact:** The plan's check explicitly requires "`Cache-Control: no-store` on all routes." `id-ocr` returns identity PII (`fullName`, `nin`, `cardNumber`, `dob`, `gender` at `api/kyc/id-ocr.ts:40-48`) and `nira-verify`/`aml-screen` return verification outcomes — all currently cacheable by intermediaries/browser. More concretely, this is a **documentation-drift defect**: `BACKEND.md §15c` claims the Phase-2C KYC tests "Cover ... `Cache-Control: no-store` + `Allow: POST` headers," but only `api/kyc/agent-referral.test.ts:106,142,224` actually asserts `no-store` — and that is the one route that already sets it. The 7 mock verifier routes have neither the header nor a test asserting it.
- **Recommendation:** Add `res.setHeader('Cache-Control', 'no-store')` at the top of each of the 7 KYC mock handlers (mirroring the auth-route pattern), and add the missing header assertion to their `.test.ts` files. Then the §15c documentation becomes accurate.

### M2. `apply_settlement` writes a non-prorated, unrounded `paid_amount` onto every due line regardless of partial-payment mismatch
- **Classification:** quality/tech-debt (seed SEED-A4 / B1; partial-payment angle is new)
- **Severity:** Medium
- **Evidence:** `supabase/migrations/0031_notifications.sql:157-163` (`UPDATE commissions SET ... paid_amount = v_amount_paid WHERE agent_id = ... AND status='due'`) and `:127` (`v_amount_paid := (v_row ->> 'amountPaid')::numeric` — no `round()`); the partial mismatch is *detected* in the UI (`src/dashboard/commissions/CommissionPanel.jsx:347-364`, `confirmSummary.mismatches`) but not blocked.
- **Impact:** Two coupled data-integrity nuances on the new settlement write: (1) the distributor can enter an `Amount Paid` that differs from the agent's pending total; the RPC still flips **all** the agent's `due` lines to `paid` and stamps the (possibly partial) `amountPaid` onto **each** individual line as `paid_amount` — the per-line `paid_amount` is therefore not the per-line value and not prorated, while the same scalar is also written to the batch's `paid_amount`. Reading per-line `paid_amount` later would over- or under-count. (2) `parseAmount` (`src/utils/settlement.js:102-107`) accepts decimals (`"1,200.5"` → `1200.5`), and the RPC writes that straight into the unconstrained `NUMERIC` columns — fractional UGX is possible (no fund deals in sub-shilling amounts). Demo-safe today (the panel shows the mismatch, and integer amounts are typical), but the stored data is internally inconsistent.
- **Recommendation:** Decide the partial-payment contract explicitly. Either (a) reject mismatched rows in the RPC (`RAISE` / skip with a `mismatch` reason) so all-or-nothing holds, or (b) if partials are intended, store `paid_amount` only on the batch (not per line) and document the denorm. Independently, `round()` the incoming amount to whole UGX in the RPC and/or `Math.round` in `normalizeUploadedRows`. (SQL side shared with Agent A.)

### M3. `src/utils/xlsx.js` `parseSheet` has no file-size cap and no MIME/extension validation on uploaded workbooks
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:** `src/utils/xlsx.js:115-152` — `parseSheet` calls `file.arrayBuffer()` (`:124`) on a file of any size with no `byteLength` ceiling before `XLSX.read` (`:131`), and never inspects `file.type` or the name extension. The only upstream guard is the file input's `accept=".xlsx,.xls"` (`src/dashboard/commissions/CommissionPanel.jsx:539`), which browsers do not enforce (a user can pick "All files").
- **Impact:** A distributor selecting a very large or malformed file pulls the whole buffer into memory and hands it to SheetJS synchronously on the main thread — a large/crafted workbook can hang the tab or trigger the ReDoS path that ties into the `xlsx@0.18.5` CVEs (Agent H owns the dependency-CVE assessment; this is the host-side hardening Agent B owns). Parsing is client-side only (confirmed: no server route reads uploads — `grep` for `arrayBuffer`/`multer`/`busboy` in `api/`+`server/` finds none), so blast radius is the uploader's own tab, but it is still a real robustness gap on a primary distributor flow.
- **Recommendation:** Before `file.arrayBuffer()`, reject when `file.size` exceeds a sane cap (e.g. a few MB — a per-agent settlement template is tiny) and when `file.type` / the lowercased name doesn't match the spreadsheet MIME/extension, returning the same `{ rows: [], errors }` shape `parseSheet` already uses. Consider parsing in a Web Worker. Coordinate the SheetJS version remediation with Agent H (SEED-H1).

### M4. `change-password` does bcrypt + DB writes with no rate limiter
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:** Route mount `server/index.ts:130` (`app.all('/api/auth/change-password', toExpress(changePassword))` — no limiter), handler `api/auth/change-password.ts` (verifies JWT then runs `verifyPassword` bcrypt at `:122` and an UPDATE at `:131-135`). Contrast `verify-otp`/`verify-password` which carry `authLimiter` (`server/index.ts:128-129`).
- **Impact:** `change-password` is JWT-gated (good — `api/auth/change-password.ts:52-64`), but a holder of one valid 24h token can hammer the endpoint: each call pays the ~80ms bcrypt `compare` (change flow) plus a DB round-trip. With no `authLimiter`, this is an unmetered CPU/DB cost path and a current-password brute-force surface for an attacker who already has a session token. Low real risk for a single-origin demo, but it is the one auth route with a credential-verification cost and no limiter, which is an inconsistency in the otherwise deliberate `authLimiter`/`writeLimiter` placement (`server/index.ts:99-120`).
- **Recommendation:** Attach `authLimiter` to the `change-password` mount for parity with the other credential-handling routes. Note this is the *server-side* gap; do not propose a real lockout/HIBP flow (out of demo scope per §10a).

### M5. `verify-otp` generic catch returns HTTP 500 with a 4xx-vocabulary `code: 'invalid_otp'`
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:** `api/auth/verify-otp.ts:238-239` — the non-`DbError` catch branch responds `res.status(500).json({ code: 'invalid_otp' })`.
- **Impact:** An unexpected server error (status 500) is reported with the auth-failure UX code `invalid_otp`, which the frontend treats as a bad-OTP user error. A genuine infra hiccup during login would surface to the user (and to ops triage) as "Invalid code" rather than a server error — masking real failures and conflating a 5xx with a 4xx vocabulary. (`verify-password.ts:192` has the same pattern with `invalid_request`.) Contrast the well-handled `DbError` branch (`:230-237`) which correctly emits `db_error`.
- **Recommendation:** Return a distinct 500 code (e.g. `unexpected_error`, matching `change-password.ts:152`) from the generic catch so 5xx and 4xx vocabularies don't overlap; keep `invalid_otp` reserved for the genuine shape-validation 4xx paths above.

---

## Low

### L1. `parseAmount` silently coerces multi-separator / malformed strings rather than rejecting them
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `src/utils/settlement.js:102-107` — strips everything except `[0-9.-]` then `Number(...)`. Inputs like `"1.2.3"` → `Number("1.2.3")` = `NaN` (correctly skipped), but `"1-2"` → `Number("1-2")` = `NaN`, while `"--5"`/`"5-"` also yield `NaN`. A trailing/embedded minus or stray dot is opaque to the user (the row is skipped with the generic `no_amount` reason at `:80-84`).
- **Impact:** Minor. The `amountPaid > 0` finite check (`src/utils/settlement.js:81`) safely rejects the bad values, so no corrupt amount reaches the RPC. The only downside is an opaque skip with no per-cell explanation. Demo-acceptable.
- **Recommendation:** Optionally tighten `parseAmount` to a single-decimal numeric regex and surface a more specific skip reason (`unparseable_amount`) so the distributor sees *why* a row dropped. Not blocking.

### L2. `personas.ts` carries a stray top-of-file `eslint-disable` comment with no following statement
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `api/auth/_lib/personas.ts:25` (`// eslint-disable-next-line @typescript-eslint/no-explicit-any`) sits immediately before the `import type { JwtRole }` line (`:26`), which contains no `any`. The actual `any` usages it was meant to cover are the inline disables at `:50` and the `SupabaseAdminLike` type. `.ts` files are not linted by `npm run lint` (flat config matches only `**/*.{js,jsx}` — see `00-baseline.md §1.1`), so this never fires, but it is a misplaced/dead directive.
- **Impact:** Cosmetic. No runtime effect; not surfaced by CI lint. Mild confusion for readers.
- **Recommendation:** Remove the orphaned `:25` directive (the targeted inline disable at `:50` is the one that matters).

### L3. `verify-otp` deterministic `users.id` (`${role}:${phone}`) diverges from `agent-referral`/`contact` random-PK style
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `api/auth/verify-otp.ts:79-89` derives `id: \`${role}:${phone}\`` for the upsert; `api/contact.ts:22-25` and `api/kyc/agent-referral.ts:28-33` use random `cs-`/`ar-` PKs.
- **Impact:** The deterministic id is actually *correct and intentional* here (idempotent upsert keyed on the `UNIQUE(phone, role)` constraint — see the well-reasoned comment at `verify-otp.ts:69-78`). Flagged only because it embeds the raw phone number into a primary-key string, so the PII appears in the `users.id` column and any FK/log that references it. For the demo's synthetic `+25671XXXXXXX` range this is harmless.
- **Recommendation:** None required for the demo. If ever productionised, hash or opaque-ify the id. Documented here so it isn't re-flagged as a "PII in PK" surprise.

### L4. No-Origin requests bypass CORS (documented) and `change-password`/KYC/chat have no rate limiting (by design)
- **Classification:** intentional-demo-scope
- **Severity:** Low
- **Evidence:** `server/cors.ts:35-45` lets `origin === undefined` through (G3, documented `:16-18`); rate limiters applied to only 4 routes (`server/index.ts:99-140`); §15a explicitly lists "No CSRF / origin checks on the public POST routes" and the demo OTP/KYC having no rate limiting/lockout.
- **Impact:** None for the demo — server-to-server pingers (Render healthcheck, GHA keepalive cron) legitimately send no `Origin`, and CORS is not a security boundary for non-credentialed server callers. The CORS regex `^https:\/\/uganda-dashboard(-[\w-]+)?\.vercel\.app$` (`cors.ts:32`) does match `uganda-dashboard-anything.vercel.app`, but Vercel reserves the `uganda-dashboard*` namespace to the owning team (N15, documented), so subdomain squatting isn't possible. Listed for completeness so these are not re-reported as bugs.
- **Recommendation:** None. By design per §10a / §15a. (M4 above narrows the one rate-limiter gap that *is* worth closing — `change-password` — as a quality item, not a demo-scope change.)

---

## Already-known (verified, NOT re-reported as new)

- **`apply_settlement` no rounding / fractional UGX** — seeded as SEED-A4/B1 in `00-baseline.md`. Folded into **M2** with the additional partial-payment-mismatch correctness angle.
- **`apply_settlement` no idempotency nonce** — seeded as SEED-B2/D1. Re-stated as **H2** (owned by this workstream per the plan).
- **`chat.ts` body-context override for unauthenticated callers** — `BACKEND.md §15b` (B14), documented at `api/chat.ts:221-242`. By-design; **not** re-reported. (H1 is a *different*, undocumented bug in the authenticated branch.)
- **No retry/idempotency on `/api/contact` + `/api/kyc/agent-referral`** — `BACKEND.md §15b`. Confirmed (`contact.ts`/`agent-referral.ts` random PKs, no dedupe) and **not** re-reported.
- **`upsert_nominees` missing `REVOKE ... FROM PUBLIC`; nominees no `UNIQUE`; TEXT status columns no CHECK; migration idempotency gaps (0003/0006/0010/0025)** — `BACKEND.md §15b`. DB-layer, owned by Agent A; **not** re-reported here.

## Confirmed-good (no finding — verified during the sweep)

- **JWT:** `verifyJwt` pins `algorithms: ['HS256']` + issuer + audience (`api/_lib/jwt.ts:110-118`) — no alg-confusion / `none` bypass. Secret read as raw UTF-8, cached as `Uint8Array` (`:59-72`).
- **Service-role isolation:** `supabase-admin.ts` is server-only, `persistSession:false` (`api/_lib/supabase-admin.ts:42-50`); never imported from `src/`.
- **Env preflight:** `assertServerEnv()` aggregates all missing keys and runs once at boot before any handler import (`server/env.ts`, `server/index.ts:21-23`).
- **Crash recovery:** `uncaughtException`/`unhandledRejection` log + `process.exit(1)` so Render restarts cleanly (`server/index.ts:198-207`); graceful SIGTERM/SIGINT shutdown (`:184-192`). This addresses the known `tsx watch` dev-crash fragility at the *prod* layer (dev fragility remains a local-only DX note, not a prod bug).
- **405 + `Allow: POST`:** every one of the 14 handlers emits `Allow: POST` + `{ code: 'method_not_allowed' }`; `app.all` mounts preserve this (`server/index.ts:122-140`).
- **`app_role` discipline in new RPCs:** `apply_settlement` gates on `app_role='distributor'` (`0031:100,115`); `mark_notifications_read` re-checks ownership inside the DEFINER body; both pin `search_path` and `REVOKE ... FROM PUBLIC` (confirmed in `00-baseline.md §4.5`). No §5.7 trap in the RPCs.
- **No JWT/password/secret logging (§7):** all 20 `console.*` calls in `api/`+`server/` log only Supabase error objects (code/message) or generic markers; the boot log lists var *names* not values (`server/index.ts:175-177`); `morgan` logs method/url/status only (no body/headers). Clean.
- **Adapter:** `toExpress` forwards thrown errors to Express's error middleware via `next(err)` (`server/adapter.ts:32-40`) rather than swallowing — preserves Sentry capture.

---

## Cutover blockers (`feat/simplify-commissions` → `main`)

None of this workstream's findings are hard blockers, but the following should be addressed (or explicitly accepted) before cutover because they affect new-feature primary flows:

1. **H1 — `/api/chat` `role` vs `app_role`.** Visible degradation of the distributor/branch data-assistant and agent DM for every signed-in user. One-line fix; ship before cutover.
2. **H2 — `apply_settlement` idempotency.** A re-submit/retry can duplicate `settlement_batches` rows + notifications. Add a nonce or accept the documented partial-idempotency before the settlement flow is demoed against live data.
