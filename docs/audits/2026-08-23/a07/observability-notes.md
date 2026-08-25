# Why Sentry is invisible in production — root cause, proven

**Measured 2026-08-25.** A09-005 / A24-009.

## The finding

Sentry is tree-shaken out of the production bundle entirely. Every production browser crash is
invisible — and `sentryScrub.ts`, the PII scrubber written specifically so Ugandan member data
never leaves the country, **has never once executed**. The second half matters as much as the
first: the scrubber is currently a promise the product does not keep.

## Root cause — it is NOT a code defect

`src/main.jsx:29` gates initialisation:

```js
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ ... });
}
```

Vite **statically replaces** `import.meta.env.VITE_SENTRY_DSN` at build time. With the variable
unset the expression becomes the literal `undefined`, `if (undefined)` is statically false, and
Rollup eliminates the whole block — **including the `import * as Sentry` at the top**. Nothing
warns; the bundle is simply smaller.

Proven both ways against this tree:

```
$ VITE_SENTRY_DSN="https://…" npx vite build
  → "sentry" found in dist/assets/index-*.js and dist/assets/vendor-*.js

$ npx vite build          # no DSN — the current Vercel state
  → "sentry" found in NO dist/assets/*.js
```

**So the code is correct and the fix is an environment variable.** No amount of source editing
closes this; `VITE_SENTRY_DSN` has to be present in Vercel's **build** environment (not just at
runtime — a runtime-only value is too late, the code is already gone).

## What a human must do

| # | Action | Where |
|---|---|---|
| 1 | Set `VITE_SENTRY_DSN` to the project's real DSN, scoped to the **Production** (and ideally Preview) build environment | Vercel → Project → Settings → Environment Variables |
| 2 | Optionally set `VITE_SENTRY_RELEASE` so crashes attribute to a build (`main.jsx:35` already reads it) | same |
| 3 | Redeploy — env changes do not retroactively affect an existing build | Vercel |
| 4 | Verify by throwing a deliberate test error and confirming it arrives **with phone/NIN redacted** | production |

## A second hazard, not yet fixed

`@sentry/react` is declared in **`devDependencies`**, not `dependencies` — this is audit finding
A09-012 / A24-005. It builds today because Vercel installs devDependencies during a build. But a
build run with `NODE_ENV=production` or `npm ci --omit=dev` would fail to resolve the import
*only at deploy time*, which is the worst place to find out.

Moving it to `dependencies` is a `package.json` change, and `package.json` currently holds the
user's own uncommitted work, so it is **left for `P6-deps`** rather than absorbed here. See
`docs/audits/2026-08-23/a24/DEPS-READY.md`.

## What IS fixed here

`server/sentryScrub.ts` gains explicit NIN redaction (A07-001) alongside its existing phone
handling, and ships `server/sentryScrub.test.ts` — 13 tests that feed it a realistic KYC-error
event carrying a phone, two NINs, a name and an Authorization header, and assert each is gone
from the message, the exception value, the breadcrumbs and the request body.

One assertion is deliberately a property check rather than exact equality. `user.id` is
`subscriber:+256701234567` — a role prefix plus a phone. The scrubber redacts the phone substring
and keeps the prefix, giving `subscriber:[redacted]`. That is better than blanket redaction: the
role is not PII and is genuinely useful when triaging, while the phone is gone. The test asserts
no phone survives, rather than demanding the string equal `[redacted]` exactly — which would
over-specify an implementation detail and forbid a strictly more useful result.

## Still open

The scrubber is proven to redact **in unit tests**. It has never run against a real Sentry
transport, because there is no DSN to send to. Confirming end to end requires step 4 above. That
is stated rather than claimed.
