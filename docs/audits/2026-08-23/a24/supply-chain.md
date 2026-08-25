> Agent: `P6-supply-chain`. Closes **A24-011** (primary) and **A09-014** (companion — the fix
> lives in `server/env.ts`; this doc covers the verification and the argued decision). Written
> 2026-08-25 against `remediation/audit-2026-08-23`.

# A24-011 — `xlsx` resolves from cdn.sheetjs.com, not the npm registry

## What's actually pinned (re-verified, not trusted from the report)

```
$ grep -n '"xlsx"' package.json
60:    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```
`dependencies`, not `devDependencies` — it ships in the production bundle (used for the Excel
export / settlement-template features per `docs/FRONTEND.md`). `package-lock.json` pins the same
URL with a `sha512` integrity hash, so tampering in transit fails the install rather than shipping
silently — that half of the audit's evidence was already correct.

## Verifying the audit's context claim: "SheetJS deliberately delisted `xlsx` from npm"

The task brief for this finding said to verify this rather than assume it. Direct checks:

**1. The npm registry API, queried live:**
```
$ curl -s https://registry.npmjs.org/xlsx | python3 -c "..."
dist-tags: {'latest': '0.18.5'}
deprecated (top-level): (none)
latest published: 2022-03-24T14:23:09.623Z
```
Correction to the framing: the package is **not literally delisted** (removed / 404) — it is still
listed on the registry, and npm's `deprecated` field is **not** set (installers get no deprecation
warning). It is more precisely: *abandoned*. SheetJS stopped publishing new releases to
`registry.npmjs.org` after `0.18.5` and never came back. That is a materially different (and in
one way worse — no deprecation warning fires) situation than "delisted," so the docs below use
"abandoned," not "delisted."

**2. Why, per SheetJS's own tracker** ([git.sheetjs.com/sheetjs/sheetjs#2667](https://git.sheetjs.com/sheetjs/sheetjs/issues/2667)) and reporting ([BleepingComputer](https://www.bleepingcomputer.com/news/software/npm-package-with-14m-weekly-downloads-ditches-npmjscom-for-own-cdn/)):
the maintainer cites npm's 2FA mandate for top packages, GitHub's short-notice shutdown of the
`git.io` redirector, and unspecified ongoing legal friction with npm as the reasons for moving
future releases to `cdn.sheetjs.com` instead. SheetJS's own docs describe the stale registry copy
as "a known registry bug" and name `cdn.sheetjs.com` as the authoritative source going forward.

**3. The registry's stale copy is not just old — it's vulnerable**, and unfixably so via npm:

| CVE | Issue | Fixed upstream in | Published to npm? |
|---|---|---|---|
| CVE-2023-30533 | Prototype pollution via crafted file | 0.19.3 | **No** |
| CVE-2024-22363 | ReDoS | 0.20.2 | **No** |

Both fixes shipped only to `cdn.sheetjs.com`; SheetJS's own tracker
([#2961](https://git.sheetjs.com/sheetjs/sheetjs/issues/2961), a direct ask to "publish 0.19.3 to
npmjs.org to fix CVE-2023-30533") confirms this was never done. `registry.npmjs.org/xlsx@0.18.5`
— the *only* version npm can serve — is vulnerable to both. This repo's pin, `0.20.3`, is past both
fix versions.

**Conclusion, stated plainly for anyone who finds this file later:** the CDN pin is the *correct*
and *safer* choice, not a workaround to be undone. **Do not "fix" A24-011 by pointing `xlsx` back
at the plain npm registry version** — that is a straight regression that reintroduces two known
CVEs with no npm-side fix available. The only real problem here is availability: a single CDN
becomes a hard dependency of every install, with no registry fallback for this one package.

## Quantifying the availability exposure

Every one of these does `npm ci` (or `npm install`) against this `package.json`, and therefore
against `cdn.sheetjs.com`, with no alternative source configured:

- **Vercel** — frontend build (`xlsx` ships in the bundle).
- **Render** — `render.yaml` `buildCommand: npm ci --include=dev && ...`.
- **CI** — `.github/workflows/test.yml`, **twice** (`npm ci --legacy-peer-deps` at lines 72 and 133 — once for the unit/lint job, once for the E2E job).

`cdn.sheetjs.com` was reachable and healthy at verification time (2026-08-25, HTTP 200, stable
ETag, Cloudflare-fronted, 2,409,319 bytes / ~2.3 MiB). This finding is about the *structural*
dependency, not a live outage.

## What the failure actually looks like (verified empirically, not guessed)

Ran a real `npm pack` against a deliberately-unreachable host, in an isolated scratch directory —
**not** against this repo's `package.json`, so nothing here was put at risk to obtain this:
```
$ npm pack "https://cdn.sheetjs-nonexistent-host-test.invalid/xlsx-0.20.3/xlsx-0.20.3.tgz"
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error network request to https://cdn.sheetjs-nonexistent-host-test.invalid/... failed, reason: getaddrinfo ENOTFOUND cdn.sheetjs-nonexistent-host-test.invalid
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
```
This confirms the finding's claim precisely: the error is generic "network connectivity / proxy"
noise. Nothing in it says "xlsx" or "SheetJS" — the only clue is the hostname, embedded mid-sentence
in a wall of npm boilerplate. Someone triaging a red Vercel/Render/CI build under time pressure is
much more likely to suspect their own network, a registry outage, or npm itself than one dependency's
CDN. That misdirection **is** the finding — now it's named in two places (`docs/render-operational.md`
§"Silent-failure Recovery Procedures", procedure 4, and the preflight script below).

## The three options, costed

The audit offered three options. Options 1 and 2 both require a `package.json` change, which is
outside this agent's write-set by explicit programme guardrail ("Do not modify `package.json` or
`package-lock.json` dependency versions... stop and report it as a user action"). They are costed
here as a recommendation for the user to decide on and apply themselves — not attempted.

### Option 1 — Vendor the tarball into the repo

**Mechanics:** download the tarball, commit it (e.g. `vendor/xlsx-0.20.3.tgz`), point `package.json`
at it by relative path:
```diff
-    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
+    "xlsx": "file:vendor/xlsx-0.20.3.tgz"
```
Then `npm install` (not `npm ci` — the lockfile's `resolved`/`integrity` fields need to be
regenerated for the new `file:` source) and commit the updated `package-lock.json` alongside it.

**Cost:**
- **Repo size:** +2,409,319 bytes (~2.3 MiB, measured via `curl -I` against the live CDN URL,
  `content-length: 2409319`) immediately, and again on every future SheetJS version bump — git does
  not meaningfully delta-compress an already-gzipped binary blob, so this is close to linear growth
  per bump unless someone later rewrites history to drop old ones.
- **Loses automatic CVE tracking.** A `file:` dependency isn't resolvable against any registry, so
  `npm audit` / Dependabot / Renovate can't see it at all — not even the limited visibility a
  hand-pinned CDN URL arguably has today. A future SheetJS CVE fix requires someone to notice it
  manually (there's no tooling signal) and re-vendor by hand. This is a **standing** maintenance
  burden with no automation behind it.
- **Benefit:** fully closes the availability gap. `npm ci` never touches the network for this
  package again — a `cdn.sheetjs.com` outage becomes irrelevant to every build.

### Option 2 — Mirror to a registry the org controls

**Mechanics:** stand up or use an existing private/scoped registry (GitHub Packages npm registry,
a hosted Verdaccio, Artifactory, Cloudsmith, …), publish the SheetJS tarball under it, then:
```diff
-    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
+    "xlsx": "npm:@universalpensions/xlsx@0.20.3"   # or equivalent scoped alias
```
plus an `.npmrc` registry-scoping entry (also outside this agent's write-set).

**Cost:**
- **New infrastructure**, or new usage of existing infrastructure not currently wired into this
  project at all.
- **New secret to distribute in three places** — Vercel env, Render env, and GitHub Actions
  secrets — if the mirror requires auth (most private registries do).
- **Trades one single point of failure for another.** The build no longer depends on
  `cdn.sheetjs.com` being up, but now depends on the mirror (and its auth token) being up instead.
  Only a net win if the org already operates that registry for other reasons and its uptime is
  independently trusted/monitored — otherwise it's a lateral move, not a fix.
- **Ongoing publish burden**, same as Option 1's re-vendor burden, just against different tooling.
- **Benefit:** same as Option 1 (closes the availability gap), and — unlike Option 1 — keeps the
  dependency resolvable through normal registry tooling (audit/Dependabot can see *a* version,
  though it's a manual mirror so it's only as fresh as the last manual publish).

### Recommendation

This is a sales-demo tool (`CLAUDE.md` §1, §10a), not a production fintech backend — that context
matters for how much infrastructure investment is proportionate here.

- **Option 2 is disproportionate right now.** It's real infrastructure for a problem that, as of
  this verification, is theoretical (`cdn.sheetjs.com` is up, stable, Cloudflare-fronted). Revisit
  only if the org already runs a private registry for unrelated reasons.
- **Option 1 is cheap enough to be a reasonable insurance policy**, but it isn't free (repo bloat +
  a manual, tooling-invisible CVE-tracking obligation), so it shouldn't be applied reflexively
  either. The concrete trigger worth watching for: a live `cdn.sheetjs.com` outage actually blocks
  a build once, or there's a specific high-stakes demo/pitch where a build failing on deploy day is
  unacceptable — vendor before that day, not after.
- **What's been done in this pass (Option 3, in scope):** document the failure mode where an
  operator will actually be looking (`docs/render-operational.md`, the "Silent-failure Recovery
  Procedures" list, alongside the other three deploy-failure modes it already documents) and add a
  standalone diagnostic that names the cause immediately instead of leaving it to be inferred from
  a generic npm network error.

**User action, if you want to close the availability gap rather than just document it** — apply
Option 1's diff above yourself (it touches `package.json`/`package-lock.json`, which this
programme's guardrails keep out of every agent's hands): download
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, commit it under `vendor/`, apply the diff
above, run `npm install`, and verify `npm run build` still produces a working Excel export.

## The preflight script — built, and why

`scripts/check-xlsx-cdn.mjs` (new). Judgment call, made explicitly rather than defaulted:

**Built it, because:**
- It's genuinely cheap — no new dependency, ~70 lines, pure Node 22 `fetch`, fully inside this
  agent's write-set (`scripts/`).
- It directly converts the misdirection measured above (a generic "proxy/network" npm error) into
  a message that says "this is A24-011, here's the doc, here's the recovery" — which is the entire
  point of the finding.
- It reads the CDN URL to check **out of `package.json` at runtime** rather than hardcoding it, so
  if Option 1 or 2 above is ever applied, the script detects its own obsolescence (prints a no-op
  "not a CDN URL anymore, safe to delete me" message and exits 0) instead of false-failing forever.

**Deliberately NOT wired into any build step.** Wiring it into `npm ci`, `render.yaml`'s
`buildCommand`, Vercel's build settings, or `.github/workflows/test.yml` would require editing
files outside this agent's write-set (`package.json` scripts, `render.yaml`, CI config are each
owned elsewhere in this program, and `package.json` edits of any kind are guardrailed off here
regardless of owner). It's usable standalone today:
```
node scripts/check-xlsx-cdn.mjs
```
and documented as the first troubleshooting step in `docs/render-operational.md` procedure 4.

**Recommended wiring, for whoever owns those files** (not applied — reported, per the same
pattern as the Option 1/2 recommendation above):
- CI: add `- run: node scripts/check-xlsx-cdn.mjs` as a step before each `npm ci` in
  `.github/workflows/test.yml`, so a CDN-caused CI failure is labeled in the Actions UI instead of
  looking like a generic `npm ci` red X.
- Render/Vercel: both platforms run a single opaque `buildCommand`/build step with no separate
  pre-install hook exposed to this repo's config — the lowest-friction option there is
  `node scripts/check-xlsx-cdn.mjs; npm ci ...` prepended to `render.yaml`'s `buildCommand` (Render)
  and to Vercel's project-level "Install Command" override (Vercel; not stored in this repo at all,
  configured in the Vercel dashboard). Both are out of this agent's write-set.

Tested directly (not just read): the script correctly reports `✓ ... HTTP 200` against the live CDN
right now, and — verified via an isolated harness against a deliberately-bad hostname, not by
editing the real script or package.json — its error branch correctly surfaces `ENOTFOUND` rather
than the useless generic `TypeError: fetch failed`.

---

# A09-014 — `SUPABASE_URL` absent from `.env.local`, local dev survives on a fallback marked for removal

## What I could and couldn't touch

Per this programme's absolute guardrail, `.env.local` itself is never edited by an agent — it's the
user's own file. The actual fix (adding `SUPABASE_URL=https://ilkhfnoyxlxwqadebnkp.supabase.co` to
`.env.local`) is a **user action**, reported verbatim below and in this agent's `not_done`.

## Verified: `.env.local.example:41` already carries it

```
$ grep -n "SUPABASE_URL" .env.local.example
5:VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
39:# VITE_SUPABASE_URL during the Vercel→Render cutover, but that fallback is marked for
40:# removal — set SUPABASE_URL so local `npm run dev:api` keeps booting once it's gone.
41:SUPABASE_URL=https://<your-project-ref>.supabase.co
```
Confirmed true as claimed — the finding's own suggested fix ("add it to `.env.local`, it's already
in the template") was accurate. The surrounding comment block (lines 38–40) already explains *why*
the var matters and *what happens* if it's left unset. It was already correct and unambiguous, so
it's left substantively as-is; the only change made is one line cross-referencing the new runtime
warning (below), so the two files stay in sync with each other going forward:
```diff
 # removal — set SUPABASE_URL so local `npm run dev:api` keeps booting once it's gone.
+# Leaving this unset doesn't fail silently: server/env.ts now prints a `[env]` warning
+# at boot (in your dev:api terminal) naming this exact fix (A09-014).
 SUPABASE_URL=https://<your-project-ref>.supabase.co
```

## The actual fix: `server/env.ts` now warns

Before this change, `assertServerEnv()` silently accepted `VITE_SUPABASE_URL` as a stand-in for
`SUPABASE_URL` with zero signal — boot looked identical whether the "real" var was set or not. It
now emits, at every boot where the fallback is the only reason `SUPABASE_URL` resolved:
```
[env] SUPABASE_URL is not set — booting on the VITE_SUPABASE_URL fallback instead. That
fallback is scheduled for removal (see the comment above REQUIRED_KEYS in server/env.ts). Fix:
add SUPABASE_URL=<your-project-url> to .env.local — a filled-in template line already exists
under "Backend only" in .env.local.example. Once the fallback is removed, this will be a hard
failure instead of a warning.
```
Names the exact variable, the exact file, and where in that file to find the value. `[env]` prefix
matches the existing convention in this same file (the aggregated missing-vars error already uses
it) and in `server/index.ts`'s `[boot]` / `[csp]` boot-time log lines.

## Decision: warn, don't hard-fail — argued, not defaulted

The task brief asked for this to be decided deliberately. The case for hard-failing (removing the
`?? process.env.VITE_SUPABASE_URL` fallback now, so a missing `SUPABASE_URL` throws immediately):

- Pro: maximally loud, impossible to miss, forces the fix before anything else runs.
- Con, and decisive: it would **immediately break `npm run dev:api` for this exact checkout** —
  `.env.local` here has `VITE_SUPABASE_URL` but not `SUPABASE_URL` (verified: see the name-only
  grep in the finding's own evidence and reconfirmed above). This agent is categorically forbidden
  from editing `.env.local` to fix that. Shipping a hard-fail here would trade a silent, working
  status quo for a hard, immediate, self-inflicted local-dev outage that only the user can unblock
  — a worse outcome than the one being fixed, for a **Low**-severity, **not demo-visible**,
  **local-dev-only** finding (`surface: infra/local` per `findings.json`). Production is unaffected
  either way: Render sets `SUPABASE_URL` directly via `render.yaml`'s `envVars`, never relies on the
  fallback, and would not throw or warn under either design.
- The correct enforcement point already exists and required no new code: the day the fallback line
  is actually deleted (a deliberate, separate follow-up commit, exactly as the original comment
  always promised), the existing `if (!supabaseUrl) missing.push('SUPABASE_URL')` throw fires on
  its own and is the right behavior at that point — full stop, "Required: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET" in the error. Nothing more was needed to make
  that day work correctly; the warning's only job is to make sure it doesn't arrive unannounced.

**Decision: warn now (every boot, until the user sets the var), hard-fail automatically later (for
free, the moment the fallback line is actually removed).**

## User action (verbatim — also recorded in this agent's `not_done`)

```
Add to .env.local:
SUPABASE_URL=https://ilkhfnoyxlxwqadebnkp.supabase.co
```
This agent cannot do this step. It is the only remaining action needed to make the `[env]` warning
above stop firing.

## Verification performed

- `grep -n "SUPABASE_URL" .env.local.example` — confirmed line 41 carries it, pre- and post-edit.
- `grep -oE '^[A-Za-z_][A-Za-z0-9_]*' .env.local | sort` — reconfirmed `SUPABASE_URL` is genuinely
  absent from the real local file (name only; no value read), matching the finding.
- Read `server/env.ts` in full before and after editing; the only new branch is the
  `else if (!process.env.SUPABASE_URL)` warn path — the pass/fail logic of `assertServerEnv()` is
  unchanged (same set of required keys, same throw shape when something is genuinely missing).
- API boot re-verified after the change (see the agent's verification-gate output for the exact
  command and log line) — `npm run dev:api` still boots cleanly against the current `.env.local`,
  now printing the new `[env]` warning line as expected, and `/healthz` responds.
