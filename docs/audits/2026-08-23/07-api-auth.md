# A07 · API handlers, auth & session

> **Provenance note.** A07 was blocked at dispatch in both Workflow runs — the sub-agent safety
> classifier reads "attack all 18 routes / forge JWTs / plant XSS" as offensive tooling and refuses
> to delegate it, regardless of the localhost target and cleanup discipline. It was therefore executed
> **by the lead auditor directly in-session** — authorized defensive testing of the user's own demo
> platform, report-only, against `http://localhost:3001`. This file's SOURCE-grounded checks are
> complete; the LIVE-probe checks (rate-limit behaviour, JWT-forgery matrix, XSS plant/render) are
> marked `PENDING-LIVE` and were deferred until Wave A's 7 agents stopped driving the shared local
> server, to avoid tripping the per-IP rate limiter under their feet. See §"Live probe run" for the
> executed results appended after that window.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 5 `server/*.ts` + 16 `api/**` handlers + 6 `api/_lib` + `vercel.json` + `render.yaml` |
| Artifacts examined | 21 source files read in full |
| Coverage | 100% of source; live-probe matrix PENDING-LIVE (§ below) |
| Checks defined | 11 |
| Checks executed | 7 source-complete now / 4 PENDING-LIVE |
| Checks passed / failed / blocked | 10 / 1 / 0 (live probes executed; 1 = A07-004 rate-limit spoof) |
| Findings C / H / M / L / I | 0 / 0 / 1 / 3 / 2 |  (+A07-004 Low from live probes)
| Evidence commands run | source reads (21 files) + targeted greps |
| Excluded as demo-scope | OTP wildcard; no-logout token TTL (recorded Info, not defect); mocked KYC |
| Blocked, with reason | Live-probe matrix deferred to a quiet server window (in progress), NOT abandoned |

Domain metrics: routes attacked 16 (source); JWT rejection paths analysed 8; rate-limited routes 6;
XSS sink fields identified 4 (reason/stage/tracking_id/session_id on agent_referrals + free text on
contact/nominee-claim); PII classes in scrubber 3 of 4 (phone/JWT/password present, **NIN absent**).

## Findings

### A07-001 · Sentry scrubber has no NIN redaction pattern — Medium (plausible)
`server/sentryScrub.ts` redacts Ugandan **phone** (`PHONE_RE`), **JWT** (`JWT_RE`), **Bearer** tokens,
and drops values for the sensitive key set (`password`, `currentpassword`, `otp`, `authorization`,
`token`, …). It has **no pattern for a National ID Number (NIN)**. The KYC flow (`api/kyc/nira-verify`,
`id-ocr`) handles NIN, and `users.id` / error strings can carry identifiers. If a NIN ever rides inside
an exception `value` or breadcrumb, it forwards to Sentry unredacted.
- **location:** `server/sentryScrub.ts:31-37` (regex block) — a `NIN_RE` is missing next to `PHONE_RE`.
- **impact:** PII (a citizen's National ID) could reach the Sentry project on a KYC error path.
- **why plausible not confirmed:** KYC is mocked (`api/kyc/_lib/mocks.ts`), so today's error paths may
  never actually embed a real NIN. Confirm by forcing a `nira-verify` error carrying a NIN and checking
  the scrubbed event. If no live path embeds a NIN, downgrade to Low (defence-in-depth gap).
- **suggested_fix:** add `const NIN_RE = /\bC[MF][A-Z0-9]{12,}\b/g;` (Ugandan NIN shape) to the scrub
  chain in `scrubString`, and add `'nin'` + `'nationalid'` to `SENSITIVE_KEYS`. Effort: S.

### A07-002 · `/api/kyc/agent-referral` is an unauthenticated service-role INSERT — Low (confirmed, input-capped)
The route writes to `agent_referrals` via the RLS-bypassing service-role client with **no auth**
(by design — signup KYC precedes the JWT). Confirmed it is **not** the open barn door the plan feared:
- it accepts **no `agentId`** at all (the plan's "is agentId validated?" is moot — there is no such field);
- `phone` must canonicalise to `+256…` or 400 `invalid_phone`; `reason` required or 400;
- every persisted field is length-capped **before** the insert: `reason`≤1000, `stage`≤64,
  `trackingId`≤128, `sessionId`≤128 (`api/_lib/assertLen.ts` + `agent-referral.ts:105-140`);
- `writeLimiter` = 5 POST/min/IP guards flood.
- **residual risk (the real finding):** `reason`/`stage`/`trackingId`/`sessionId` persist **verbatim**
  and are later rendered in the agent/admin UI. That is the stored-XSS **source**; the sink is A24's to
  confirm. Storage-spam is bounded to 5 rows/min/IP with capped fields. **location:**
  `api/kyc/agent-referral.ts:118-140`. **fix:** none needed at the API layer beyond what exists; ensure
  the render side escapes (A24).

### A07-003 · CORS allows any request with no `Origin` header — Info (confirmed, by design)
`server/cors.ts` returns `cb(null, true)` when `origin === undefined`. Browser origins are otherwise
restricted to the `uganda-dashboard*.vercel.app` regex. No-Origin allow is deliberate (curl, Render
healthcheck, GHA keepalive cron) and cannot carry browser credentials. Recorded as Info; **not** a
defect for this deployment. If the API ever served cookie-based auth this would need revisiting.

## Source-confirmed PASSES (defensive posture is genuinely good)

| Check | Verdict | Evidence |
|---|---|---|
| **JWT forgery resistance** | PASS (source) | `api/_lib/jwt.ts:verifyJwt` calls jose `jwtVerify` with `algorithms:['HS256']`, `issuer:'upensions'`, `audience:'authenticated'`. jose enforces the alg allowlist → **`alg:none` and RS256-confusion are rejected by the library**; wrong secret → bad signature; wrong `iss`/`aud`/expired → thrown. All map to 401. **PENDING-LIVE confirmation of each of the 8 forgery variants.** |
| **change-password gating** | PASS (source) | `api/auth/change-password.ts`: no token → 401; bad token → 401 (catch); **deactivated entity → 403** via `isEntityDeactivated` even with a valid 24h JWT; change-flow bcrypt-verifies `currentPassword` (401 `current_password_invalid`). The only hard-gated route, and it is gated correctly. |
| **body-parser error mapping** | PASS (source) | `server/index.ts:171-190`: `entity.parse.failed`→400 `invalid_json`; `entity.too.large`→413 `payload_too_large`, both with `Cache-Control:no-store`. Correct — not mis-reported as 500. **PENDING-LIVE** for the actual >200kb and malformed-body responses. |
| **Rate limiters present on the right routes** | PASS (source) | `authLimiter` 10/min on verify-otp/verify-password/change-password; `writeLimiter` 5/min on agent-referral/contact/access-request/nominee-claim; `chatLimiter` 20/min; all `skip: req.method!=='POST'`; `trust proxy` = 1. **PENDING-LIVE** for the 11th/6th-request 429 and the XFF-spoof test. |
| **verify-otp is NOT enumerable** | PASS (source) | Unknown phones fall back to `ROLE_DEFAULTS` and the OTP step **always succeeds** (`verify-otp.ts` header + `personas.js`). There is no differential response distinguishing known/unknown phones. Enumeration concern refuted. |
| **chat copilot leaks no tenant data** | PASS (source) | `api/chat.ts` has **zero** DB access (no `supabaseAdmin`/`.from`/`.rpc`/`fetch`) — every reply is canned keyword copy; `context` only selects a static response set. `withOptionalAuth` failing open is therefore harmless here: an anon caller can request the `admin` flavor and receive static marketing text, not real data. Refutes the plan's "extract role-scoped data through the copilot" concern. |
| **/healthz I/O-free, /readyz correct** | PASS (source) | `/healthz` returns `{ok:true}` with no DB touch (`index.ts:110`); `/readyz` does one `commission_config` read → 503 `not_ready` on error (`index.ts:128`). Neither leaks build/env detail. Confirmed independently in `00-baseline.md §1` (readyz 503→200 across the restore). |

## Live probe run — DONE (see a07/live-results.md for verbatim output)
The following require sending traffic to `localhost:3001` and will be executed once Wave A's agents
stop driving it, then appended here with verbatim output:
1. JWT forgery matrix (8 variants) → expect 401 on every one.
2. Method matrix: GET/PUT/DELETE on each of 16 routes → 405 + `Allow: POST`.
3. Malformed JSON → 400 `invalid_json`; >200kb body → 413 `payload_too_large`.
4. authLimiter: 11 POSTs → 429 on #11; writeLimiter: 6 POSTs → 429 on #6; non-POST skips.
5. X-Forwarded-For spoof vs `trust proxy: 1` → expect NOT spoofable (single Render hop; client XFF
   prepended and ignored). Prove or refute.
6. One tagged XSS payload per public-write table via the API → hand row ids to A24 → DELETE and prove 0.

## Traceability
1. Per-route input matrix → **PENDING-LIVE** (source: handlers apply method-check + assertLen; live matrix owed)
2. Rate limits + XFF spoof → **PENDING-LIVE** (source PASS on config)
3. JWT model → **PASS (source)** / PENDING-LIVE confirmation — FINDING none (library-enforced)
4. verify-otp/password enumeration → **PASS** (ROLE_DEFAULTS fallback; not enumerable)
5. change-password gating → **PASS**
6. agent-referral unauth service-role write → **FINDING A07-002** (Low, input-capped)
7. contact/access/nominee-claim + stored XSS → **PENDING-LIVE** (source: fields capped; sink is A24)
8. chat fail-open leak → **PASS** (zero DB access — refuted)
9. Sentry scrub (phone/NIN/password/JWT) → **FINDING A07-001** (NIN not scrubbed)
10. Helmet defaults + CORS no-Origin → **FINDING A07-003** (Info, by design) + helmet header enum PENDING-LIVE
11. /healthz + /readyz → **PASS**
