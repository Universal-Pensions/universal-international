# A07 live-probe results (executed by lead auditor, quiet-server window 2026-08-24 16:2x IST)

All traffic to http://localhost:3001. Fixture rows created were deleted; users table restored to
baseline 48 (see 00d-live-write-ledger.md addendum).

## JWT forgery matrix — target /api/auth/change-password (the hard-gated route). 8/8 REJECTED.
| Token variant | HTTP | body |
|---|---|---|
| valid (correct HS256) | **404** `user_not_found` | token ACCEPTED — only the DB lookup failed → proves the gate passes a good token |
| wrong secret | **401** unauthorized | |
| expired (exp in past) | **401** | |
| future nbf | **401** | |
| wrong iss ('evil') | **401** | |
| wrong aud ('anon') | **401** | |
| **alg:none** (unsigned) | **401** | jose alg-allowlist rejects |
| **tampered** subscriber→admin (payload flipped, sig not re-signed) | **401** | HMAC mismatch |
| no Authorization header | **401** | |

Verdict: **PASS, confirmed.** Privilege escalation via token forgery is not possible. jose's
`jwtVerify(token, key, {algorithms:['HS256'], issuer, audience})` enforces every dimension.

## Method matrix — 405 + `Allow: POST` on all sampled routes (send-otp, contact, chat, agent-referral,
nominee-claim, access-request × GET/PUT/DELETE = 18/18 correct).

## Body handling — PASS
- malformed JSON → **400** `{"code":"invalid_json"}`
- >200kb body (230k) → **413** `{"code":"payload_too_large"}`

## Rate limiting — PASS with one nuance
- authLimiter fires 429 once the 10/min POST budget is spent. Confirmed the limiter is a **single
  shared per-IP bucket across ALL authLimiter routes** (verify-otp / verify-password / change-password
  share one counter) — hammering change-password consumes the verify-otp budget for that IP. Minor;
  worth a note (a burst of failed logins on one route locks the others for that IP for 60s).

## FINDING A07-004 · Rate limiter is IP-spoofable via X-Forwarded-For in a no-proxy deployment — Low
**Local proof:** 12 POSTs to /api/auth/verify-otp each with a distinct `X-Forwarded-For: 10.9.8.<i>`
ALL returned 200 — never 429. Rotating the client-supplied XFF gives each fake IP its own bucket,
fully bypassing authLimiter.
```
1(ip10.9.8.1):200 2:200 3:200 ... 12:200   # zero 429s
vs the same 12 with NO spoof: 1:200 2:429 3:429 ...  # limiter fires
```
**Why this is Low, not High:** `app.set('trust proxy', 1)` (server/index.ts:88) is *correct for the
production topology*. On Render there is exactly one proxy hop that **appends** the real client IP to
XFF, so `trust proxy:1` reads that appended real IP and the attacker's injected left-most value is
ignored — **not spoofable in production**. The bypass reproduces only locally, where nothing sits in
front of Express so the XFF header is 100% attacker-controlled.
**The real risk is fragility:** the safety depends entirely on Render being exactly 1 hop that appends
(not overwrites) XFF. If the deployment ever moves behind 0 proxies (spoofable) or 2+ proxies (either
spoofable or the limiter keys on the wrong IP and rate-limits shared-NAT users together), this breaks
silently. **Not confirmed against the live Render deployment** — doing so requires tripping the prod
limiter, which writes a throwaway users row to the shared demo DB; deliberately skipped per the
report-only mandate. **suggested_fix:** pin the limiter key to a trusted source explicitly (e.g.
`keyGenerator` reading the Render-guaranteed `req.ip` under a documented hop count), and add a comment
asserting the required proxy-hop count so a future topology change is caught in review. Effort: S.

## PASS (from source, re-confirmed): /healthz I/O-free, /readyz 503s correctly, chat no DB access
(canned copy — anon cannot extract tenant data), change-password deactivation gate (403), verify-otp
not enumerable (ROLE_DEFAULTS fallback).

## Still owed (source-analysed, not live-executed): the full 16-route × malformed-field matrix
(assertLen on every field) and the stored-XSS plant→render handoff to A24. A24 already covers the
render side; the plant is low-value now that agent-referral's field caps are confirmed from source.
