# A24 — Adversarial Verification

**Verifier pass over `docs/audits/2026-08-23/verify/byagent/A24.json` (11 findings: 1C / 1M / 6L / 3I).**
Verified the sole critical in full; spot-checked the sole medium plus 3 lows. All CONFIRMED. No refutations.
No writes committed — the one UI repro is navigate-and-click only (no DB mutation).

## Critical / High (all verified)

### A24-001 — Insurance certificate never opens (`window.open(...,'noopener')` → null) · **CONFIRMED (critical)**
Root cause verified in source: `src/signup/contribution/insurancePolicyCertificate.js:436`
`const win = window.open('', '_blank', 'noopener,noreferrer'); if (!win) return false;`.
Per the HTML spec, a `noopener` feature string makes `window.open()` return `null`, so the function
always returns `false` and never writes the certificate HTML.

Independently re-ran the browser probe from a clean state:
```
$ node docs/audits/2026-08-23/a24-winopen-probe.mjs
chromium {"withNoopener":"NULL","withoutFeatures":"window",...}
webkit   {"withNoopener":"NULL","withoutFeatures":"window",...}
```
`noopener` → NULL on both engines; the same call without features returns a real window — exact root cause.

Independently re-ran the end-to-end UI repro as subscriber s-0001 on `/dashboard/policies`:
```
$ node docs/audits/2026-08-23/a24-cert-e2e.mjs
certificate buttons found: 3
popups opened: 1
toast present: true -> Please allow pop-ups for this site, then try again to open your certificate.
```
A blank tab opens AND a false "allow pop-ups" error fires (pop-ups are not blocked — a tab just opened).
Confirmed both callers gate on the return value: `PoliciesPage.jsx:225` (toast) and
`ActivatedStep.jsx:65` (`window.alert`). Both reach the failure path unconditionally.

- **Reproduce:** ✅ reproduced from clean state on chromium + webkit, and end-to-end in the real UI.
- **Demo-scope:** ✅ NOT demo-scope. The certificate is a real client-generated HTML document
  (`buildPolicyCertificateHtml`), not a listed mock. The OUT-OF-SCOPE list covers claim uploads /
  OTP / SMS / payments, not insurance certificates. The brief explicitly says to report anything that
  "makes a live sales demo visibly fail" — this qualifies.
- **Already-guarded:** ❌ not guarded. Both entry points (subscriber Policies page + signup activation)
  are on live, demo-reachable routes for the standard s-0001 persona.
- **Severity:** critical stands. A prominent "Download certificate" button on a headline feature yields
  a blank tab + a misleading error, deterministically, on every viewport, broken since 2026-05-25.

## Medium (spot-checked)

### A24-002 — CSP is report-only, reports nowhere, contradicts the app's own font origins · **CONFIRMED (facts); severity generous**
All three technical claims verified against `vercel.json:11` and `index.html:38`:
1. Header key is `Content-Security-Policy-Report-Only` — blocks nothing. ✅
2. No `report-uri` / `report-to` directive present — collects nothing. ✅
3. `style-src 'self' 'unsafe-inline'` + `font-src 'self'` + `script-src 'self'` (no `'unsafe-hashes'`)
   contradict the `index.html` `<link href="https://fonts.googleapis.com/css2?..." onload="this.media='all'">`
   (Google Fonts stylesheet, gstatic font files, and an inline event-handler attribute). ✅
Facts fully CONFIRMED. Severity note: as a report-only header it has **zero current user-visible effect**
(the author says as much: "immediate risk is nil"); the harm only materialises if someone flips it to
enforcing. That reads closer to low than medium, but it is a defensible latent-trap medium and is not a
critical/high, so no adjustment is pressed — recorded here as an observation only.

## Lows (spot-checked — all CONFIRMED)

### A24-003 — anon RLS chain hard-errors on branches/distributors/notifications · **CONFIRMED (low)**
```
authenticated|t   anon|f   service_role|t     # EXECUTE on current_distributor_id()
branches|t  distributors|t  notifications|t    # anon table-level SELECT granted
```
Reproduced the live hard-error (BEGIN…ROLLBACK, no commit):
```
SET LOCAL ROLE anon; SELECT count(*) FROM branches;
ERROR:  permission denied for function current_distributor_id
SET LOCAL ROLE anon; SELECT count(*) FROM districts;  -> 136
```
anon hard-errors on branches but reads districts fine. Correctly rated low (logged-out app makes zero
Supabase calls today; latent trap only).

### A24-011 — xlsx resolves from cdn.sheetjs.com, not npm · **CONFIRMED (low)**
`package.json:59` `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`; lock pins
`resolved` to the same CDN URL with a sha512 `integrity`. Availability (not tampering) concern — accurate.

### A24-005 — @sentry/react is a devDependency but statically imported by prod code · **CONFIRMED (low)**
`@sentry/react ^10.57.0` sits in `devDependencies` (absent from `dependencies`), yet
`src/main.jsx:6` does `import * as Sentry from '@sentry/react'` (static, prod runtime). Real
dependency-classification defect. Correctly rated low.

## Verdict summary
| id | claimed sev | verdict | note |
|---|---|---|---|
| A24-001 | critical | CONFIRMED | reproduced clean + end-to-end; not demo-scope; not guarded |
| A24-002 | medium | CONFIRMED | facts all verified; severity generous (no current user-visible effect) |
| A24-003 | low | CONFIRMED | live hard-error reproduced |
| A24-011 | low | CONFIRMED | lock verified |
| A24-005 | low | CONFIRMED | package.json + import verified |

Not separately re-verified (info/low, no critical/high bar): A24-004, A24-006, A24-007, A24-008,
A24-009, A24-010. No writes were committed during verification.
