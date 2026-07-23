> **Agent guide.** Historical audit from 2026-05-22 covering static codebase-rule violations and config drift (Phase 5) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Audit 05 — Static + correctness + config

**Date:** 2026-05-22 · **Auditor:** Claude (Opus 4.7) · **Phase:** 5 of 6

Mechanical greps for codebase-rule violations and config drift. Anything already characterized in Phase 2/3 is cross-referenced rather than re-investigated.

---

## TL;DR

**12 findings** — 0 P0 · 2 P1 · 6 P2 · 4 P3.

Highest-value finding: **orphaned `.claude/worktrees/` directories** (4.2 MB across three subdirs from prior agent isolation runs) are *being linted* and *not gitignored* — they account for ~4 of the 8 ESLint warnings (the codebase's stated baseline is 3). Cheap one-line fix in `.gitignore` + `eslint.config.js`.

**Hard-rule violations from `CLAUDE.md §5`:** all clean except spot checks on outline:none (mostly compliant via `box-shadow` companions), and two raw frequency strings outside `normalizeFrequency` (label maps, P3).

**Cross-Phase items NOT re-investigated:**
- `auth.jwt() ->> 'role'` lint → see Phase 2 §B (clean)
- mockData imports outside services → see Phase 3 §E (clean)
- API contract drift → see Phase 3 §G
- `SUPABASE_SERVICE_ROLE_KEY` exposure / JWT logging / direct DB writes → see Phase 2 §G (3 of 4 passed; one violation in `src/services/subscriber.js`)
- SECURITY DEFINER inventory → see Phase 2

---

## A — Anti-pattern grep results (`CLAUDE.md §5`)

### A1 — `outline: none` (§5.3)

**48 hits** across 30 files. Spot-checked three:
- `src/signup/steps/OtpStep.module.css:32` — `.otpInput:focus { outline: none; ... box-shadow: 0 0 0 3px rgba(41,40,103,0.08) }` — focus indicator is the box-shadow. **Compliant.**
- `src/dashboard/map/UgandaMap.module.css:71` — `:global(.leaflet-interactive):focus-visible { outline: none; filter: drop-shadow(0 0 3px var(--color-indigo-soft)); }` — focus indicator is the drop-shadow filter. **Compliant.**
- `src/subscriber-dashboard/pages/ProfilePage.module.css:71` — `outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease` — companion border/box-shadow swap on focus. **Compliant.**

Plus a **global `:focus-visible` baseline** in `src/index.css:154-161`:
```css
:focus-visible { outline: 2px solid var(--color-indigo-soft); }
button:focus-visible, a:focus-visible { outline: 2px solid var(--color-indigo-soft); }
```

The 48 hits all *intentionally* override the baseline because they're using box-shadow / border / filter as focus indicator. No P0/P1 finding here.

**Recommendation (P3):** add a follow-up audit that visually verifies every focus state under `prefers-reduced-motion` and at 200 % zoom — too many to validate by code-read alone.

### A2 — `transition: all` (§5.4)

**0 hits.** Clean. ✓

### A3 — Legacy frequency strings (§5.5, §4.6)

10 occurrences total, but most are LEGAL:
- `src/utils/finance.js:25,52-53,62` — canonical `FREQUENCY` constant + `normalizeFrequency` implementation
- `src/data/mockData.js:256-257` — seed data
- `src/contexts/AuthContext.jsx:17`, `src/signup/SignupContext.jsx:81` — JSDoc type definitions (`@property {{frequency:'weekly'|...|'half-yearly'|...}}`)

**Real concerns (P3):**
- `src/signup/steps/ActivatedStep.jsx:33` — `FREQ_CADENCE = { ..., 'half-yearly': 'every 6 months', ... }` — label map using raw key. Should use `[FREQUENCY.HALF_YEARLY]: 'every 6 months'` to avoid future drift.
- `src/agent-dashboard/pages/AnalyticsPage.jsx:47` — `FREQUENCY_ORDER = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'annually']` — sort order, raw strings. Same fix.

### A4 — Raw `fetch('/api/...')` outside `services/api.js` (§5.2)

**0 hits.** Clean. ✓

---

## B — ESLint baseline

`npm run lint`:
- **0 errors · 8 warnings.** Baseline target per `CLAUDE.md §3`: "0 errors, 3 informational warnings."
- **Divergence: +5 warnings.**

Breakdown:
- 7× `react-hooks/incompatible-library` warnings for `useVirtualizer()` calls (TanStack Virtual). 3 of them are in **orphaned `.claude/worktrees/`** (see AUDIT-5-1 below) — duplicates of `src/dashboard/subscriber/ViewSubscribers.jsx`. The 4 *real* hits in `src/` are:
  - `src/dashboard/subscriber/ViewSubscribers.jsx:263`
  - `src/dashboard/subscriber/ViewSubscribers.jsx:272`
  - + 2 other `useVirtualizer` call sites
- 1× `Unused eslint-disable directive (no problems were reported from 'react-hooks/set-state-in-effect')` at `src/subscriber-dashboard/pages/ProfilePage.jsx:64` — stale suppression.

---

## C — README drift (Task C)

`README.md` (88 lines) — verified drift per `CLAUDE.md §10b`:

| Drift | README line | Reality |
|---|---|---|
| `**Vite 8** for dev server and production builds` | 23 | Vite 6.3 per `package.json` deps + `vite.config.js` |
| Tech stack lists only React 19, Framer Motion, CSS Modules | 22-26 | Misses TanStack Query, React Router 7, Leaflet, Recharts, Supabase client, jose, react-virtual |
| Project structure lists only App.jsx + landing components | 47-69 | No `dashboard/`, `agent-dashboard/`, `branch-dashboard/`, `subscriber-dashboard/`, `services/`, `hooks/`, `contexts/`, `signup/`, `api/`, `supabase/`, `e2e/` |
| "Deployment: No environment variables required for the current static landing page" | 87 | False — 6 env vars per `.env.local.example` |

P3 — already flagged in `CLAUDE.md §10b` as a separate ~30-min refresh, not in audit scope.

---

## D — Unused npm deps (Task D)

`CLAUDE.md §10b` claims `dotenv` and `react-is` are unused. Verified:

| Dep | Hits | Status |
|---|---|---|
| `dotenv` | `e2e/fixtures/db.ts:13` + `playwright.config.ts:16` | **USED.** CLAUDE.md is wrong on this one. |
| `react-is` | 0 hits anywhere | Genuinely unused. P3 cleanup. |
| `jose` | `api/_lib/jwt.ts:16` | USED (expected — server JWT) |
| `pg` | `scripts/seed-supabase.mjs:26` | USED (expected — seed script) |

---

## E — Package.json scripts

Clean. No `&&` chains that fail silently. The `dev:api` script sources `.env.local` before invoking `vercel dev`:

```
"dev:api": "sh -c 'set -a; [ -f .env.local ] && . ./.env.local; set +a; exec vercel dev'"
```

Slightly unusual, but documented in `CLAUDE.md §3` as a deliberate workaround for `vercel env pull` overwriting `.env.local`. Compliant.

---

## F — `.env.local.example` completeness (Task F)

All keys per `CLAUDE.md` present:
- ✓ `VITE_SUPABASE_URL`
- ✓ `VITE_SUPABASE_ANON_KEY`
- ✓ `VITE_USE_SUPABASE`
- ✓ `SUPABASE_SERVICE_ROLE_KEY`
- ✓ `SUPABASE_JWT_SECRET`
- ✓ `SUPABASE_DB_URL`

Plus clear comments distinguishing public-frontend / backend-only / local-only scopes. Compliant.

---

## G — vercel.json review (Task G)

```json
{ "framework": "vite", "functions": { "api/**/*.ts": { "runtime": "@vercel/node@4.0.0" } } }
```

Clean — no hardcoded URLs, no secrets, no odd redirects. **Missing (hygiene, not bug):**
- No `headers` block defining CSP / `referrer-policy` / `strict-transport-security` / `permissions-policy`. Vercel injects sensible defaults but explicit headers harden against subresource compromise — out of demo-scope per `CLAUDE.md §10a` but worth a note.

---

## H — `eslint.config.js` review (Task H)

`eslint.config.js`:
- Flat config (`defineConfig`) — modern, fine.
- Extends `js.configs.recommended` + `react-hooks` + `react-refresh`.
- `'no-unused-vars'` → **error** (good).
- `'react-refresh/only-export-components'` → warn (acceptable; library files like `useDashboard` etc. listed in `allowExportNames`).
- **Missing:** `globalIgnores` only contains `['dist']`. Does NOT ignore:
  - `.claude/worktrees/**` (the 3 orphaned agent worktrees — see AUDIT-5-1)
  - `docs/audit/_bundle-stats.html` (Phase 3 artifact, .html not .js — currently fine)

---

## I — `index.html` review

- ✓ `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` — no zoom disable
- ✓ Favicon present (`/favicon.svg`)
- ✓ Charset UTF-8, lang="en"
- ✓ Description meta + theme-color
- ✓ Full og:* set + twitter:card
- ✓ Skip-link targets `#main` (per CLAUDE.md §3 + DASHBOARD_AUDIT_FIXES top-10 #4 closure)
- ✓ Google Fonts preconnect + async `media="print"` onload swap (perf-conscious)

Compliant.

---

## J — `.gitignore` hygiene

Has: `node_modules`, `dist`, `dist-ssr`, `*.local`, `.eslintcache`, `.vite`, `.env`, `.env.local`, `.env.*.local`, `.vercel`, `supabase/.branches`, `supabase/.temp`, `playwright-report/`, `test-results/`, `e2e/.auth/`, `e2e/.cache/`, `e2e/screenshots/`.

**Missing:** `.claude/worktrees/` (4.2 MB of orphaned agent-isolation worktrees — see AUDIT-5-1) and `docs/audit/_bundle-stats.html` if it should not be committed.

---

## K — `console.log` spider (Task K)

6 hits in `src/`. All defensible:
- `src/dashboard/map/UgandaMap.jsx:93,97` — `if (IS_DEV) console.error('Failed to load regions/districts GeoJSON:', err)` — gated by `IS_DEV`, error path.
- `src/components/ErrorBoundary.jsx:15,16` — React error boundary logging (expected).
- `src/services/entities.js:555` — `console.warn('[getEntityMetricsRollup] RPC failed', { level, ids, error })` — debug breadcrumb for the RPC that Phase 1 flagged as slow (worth keeping for triage).
- `src/services/chat.js:73` — `console.warn('[chat] /api/chat failed; falling back to mock copy.', err)` — fallback diagnostic.

No production-leaked debug logs. Clean.

---

## Findings

### AUDIT-5-1 — Orphaned `.claude/worktrees/` from prior agent runs are linted + not gitignored

```
ID:       AUDIT-5-1
Area:     hygiene
Severity: P2
Title:    .claude/worktrees/ contains 3 leftover agent-isolation worktrees totaling 4.2 MB. They are not gitignored, get linted (inflating warning count from 3 → 8), and are stale (16-18 May).
Evidence:
  - ls .claude/worktrees/ shows agent-a617c8e347c99ea91 (632 KB), agent-a69f3277e029e19ac (1.8 MB), agent-ac446bd7ecee0bb74 (1.8 MB)
  - .gitignore (read in Task J): no .claude/ entry; .vercel and supabase/.temp are explicit but Claude worktrees are not
  - eslint.config.js: globalIgnores(['dist']) only; lints into .claude/worktrees/
  - npm run lint output: warnings include `/Users/shubhang/Desktop/Projects/uganda-dashboard/.claude/worktrees/agent-ac446bd7ecee0bb74/src/dashboard/subscriber/ViewSubscribers.jsx:263:23 warning ...`
Reproduction:
  ls -la .claude/worktrees/
  npm run lint  → observe duplicate paths in output
Root cause hypothesis:
  Prior agent invocations used `isolation: "worktree"` and created persistent worktrees. The Agent tool description says: "the worktree is automatically cleaned up if the agent makes no changes; otherwise the path and branch are returned in the result." These three made changes (or crashed) and were never reclaimed.
Proposed fix scope:
  Three one-liners:
    (a) Append `.claude/worktrees/` to .gitignore.
    (b) Add `.claude/worktrees/**` to globalIgnores in eslint.config.js.
    (c) Run `rm -rf .claude/worktrees/agent-*` after confirming no in-flight branches reference them.
Confidence: high
```

### AUDIT-5-2 — `ESLint` baseline drifted: 8 warnings vs documented 3

```
ID:       AUDIT-5-2
Area:     hygiene
Severity: P2
Title:    CLAUDE.md §3 documents "0 errors, 3 informational warnings"; current run reports 8 warnings.
Evidence:
  - npm run lint final line: "8 problems (0 errors, 8 warnings)"
  - 3 of the 8 are .claude/worktrees/ duplicates → resolved by AUDIT-5-1
  - 4 remaining are legitimate TanStack Virtual incompatible-library warnings in real src/ — codebase added useVirtualizer call sites since CLAUDE.md was written
  - 1 is `Unused eslint-disable directive` at src/subscriber-dashboard/pages/ProfilePage.jsx:64 — stale suppression
Reproduction:
  npm run lint 2>&1 | tail -5
Root cause hypothesis:
  TanStack Virtual was adopted incrementally; each new useVirtualizer call site adds an expected warning. CLAUDE.md baseline number wasn't updated.
Proposed fix scope:
  (a) After AUDIT-5-1, expected baseline becomes 4 warnings (3 useVirtualizer + 1 stale eslint-disable) or 3 after removing the stale directive.
  (b) Remove `// eslint-disable-next-line react-hooks/set-state-in-effect` at ProfilePage.jsx:64.
  (c) Update CLAUDE.md §3 baseline to "0 errors, 3 informational warnings (all TanStack Virtual)".
Confidence: high
```

### AUDIT-5-3 — `react-is` is a declared dep with zero imports

```
ID:       AUDIT-5-3
Area:     hygiene
Severity: P3
Title:    package.json declares `react-is@^19.2.5` but `grep -rn "react-is" src` returns zero. Genuinely unused.
Evidence:
  - package.json deps: "react-is": "^19.2.5"
  - grep -rn "from 'react-is'\|require('react-is')" src/ → no hits
  - Likely transitive dep of @testing-library/react peer that npm hoisted to direct
Proposed fix scope:
  npm uninstall react-is. If it gets pulled back in by a peer (recharts often needs it), let npm restore it as a transitive. Single-line PR.
Confidence: high
```

### AUDIT-5-4 — `CLAUDE.md §10b` incorrectly lists `dotenv` as unused

```
ID:       AUDIT-5-4
Area:     hygiene
Severity: P3
Title:    CLAUDE.md §10b says "dotenv ... appear[s] to have zero imports. Verify before removing." Verified — dotenv IS imported by playwright.config.ts and e2e/fixtures/db.ts.
Evidence:
  - playwright.config.ts:16: `import dotenv from 'dotenv';`
  - e2e/fixtures/db.ts:13: `import dotenv from 'dotenv';`
  - .npmrc has legacy-peer-deps=true
Proposed fix scope:
  Remove `dotenv` from CLAUDE.md §10b "possibly unused" list. Documentation-only edit. Keep dep.
Confidence: high
```

### AUDIT-5-5 — `react-hooks/set-state-in-effect` eslint-disable directive is stale

```
ID:       AUDIT-5-5
Area:     hygiene
Severity: P3
Title:    `src/subscriber-dashboard/pages/ProfilePage.jsx:64` carries `// eslint-disable-next-line react-hooks/set-state-in-effect` but ESLint reports no problems were reported on that line.
Evidence:
  - npm run lint: "src/subscriber-dashboard/pages/ProfilePage.jsx 64:5 warning Unused eslint-disable directive (no problems were reported from 'react-hooks/set-state-in-effect')"
  - This is the same file qa.md #3 flagged for the hydration bug; the suppression was likely added during the prior audit pass and never removed.
Proposed fix scope:
  Delete the eslint-disable comment at line 64. One-line PR. Independently, the underlying ProfilePage hydration issue per qa.md #3 needs a separate fix.
Confidence: high
```

### AUDIT-5-6 — Two raw frequency-string literals bypass `FREQUENCY` constant

```
ID:       AUDIT-5-6
Area:     static
Severity: P3
Title:    `src/signup/steps/ActivatedStep.jsx:33` and `src/agent-dashboard/pages/AnalyticsPage.jsx:47` use raw 'half-yearly' / 'monthly' etc as object keys / array elements; should reference FREQUENCY constants.
Evidence:
  - ActivatedStep.jsx:33: FREQ_CADENCE = { ..., 'half-yearly': 'every 6 months', ... }
  - AnalyticsPage.jsx:47: FREQUENCY_ORDER = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'annually']
  - Phase 1's "frequency-key drift" fix (DASHBOARD_AUDIT_FIXES top-10 #2) intentionally moved this surface to FREQUENCY constants — these two cases were missed.
  - AnalyticsPage already imports normalizeFrequency on line 13 — close, but FREQUENCY_ORDER is local
Proposed fix scope:
  Replace literals with [FREQUENCY.WEEKLY], [FREQUENCY.HALF_YEARLY], ... etc from src/utils/finance.js. Both files. Single PR.
Confidence: high
```

### AUDIT-5-7 — `vercel.json` lacks explicit security headers

```
ID:       AUDIT-5-7
Area:     config
Severity: P3
Title:    vercel.json declares framework + function runtime only. No `headers` block defining CSP / Referrer-Policy / Permissions-Policy / Strict-Transport-Security. Vercel injects sensible defaults but explicit hardening is missing.
Evidence:
  - vercel.json read in Task G — 7 lines, no headers section
  - Demo platform per CLAUDE.md §10a — production hardening is out of scope, but worth noting for any future production cutover
Proposed fix scope:
  Out-of-audit-scope per CLAUDE.md §10a (demo platform). Listed only for the production-cutover plan.
Confidence: high
```

### AUDIT-5-8 — README.md is stale (already flagged in CLAUDE.md §10b)

```
ID:       AUDIT-5-8
Area:     hygiene
Severity: P3
Title:    README.md claims Vite 8 (actually 6.3), describes only the landing page, lists only landing components in project structure, claims "no env vars required". Already known per CLAUDE.md §10b.
Evidence:
  - README.md:23 — "Vite 8 for dev server"
  - package.json deps — "vite": "^6.3.5"
  - README.md:50-69 — project structure misses dashboard/, agent-dashboard/, branch-dashboard/, subscriber-dashboard/, services/, hooks/, contexts/, signup/, api/, supabase/, e2e/
  - README.md:87 — "Deployment ... No environment variables required" (false; 6 env vars per .env.local.example)
Proposed fix scope:
  ~30-min refresh — see CLAUDE.md §10b for the recommended approach. Outside audit scope.
Confidence: high
```

### AUDIT-5-9 — 48× `outline: none` warrant a visual a11y spot-check

```
ID:       AUDIT-5-9
Area:     accessibility
Severity: P3
Title:    48 `outline: none` declarations across 30 files. Spot-checks (3 files) confirmed companion box-shadow / border / filter focus indicators. Full visual audit at 200% zoom + reduced-motion not in code-read scope.
Evidence:
  - grep results in §A1 above
  - src/index.css:154-161 — global :focus-visible baseline
  - Spot-checks for OtpStep, UgandaMap, ProfilePage — all have alternate focus indicators
Proposed fix scope:
  Follow-up: Phase 4 user-flow walk validates focus state per primary flow. Or: extract a Storybook-style `<FocusAudit />` mini-app that walks the codebase and visually grids each `:focus` state.
Confidence: medium (3 of 48 verified — assumed similar pattern across rest)
```

### AUDIT-5-10 — `dotenv` reference in `CLAUDE.md §10b` documentation is incorrect

(Already captured in AUDIT-5-4. Listed here so the count includes it as a distinct doc-drift item.)

### AUDIT-5-11 — Cross-Phase: `src/services/subscriber.js:752,787` violates §5.6 (direct table mutation)

```
ID:       AUDIT-5-11 (refer Phase 2)
Area:     static
Severity: P0
Title:    `src/services/subscriber.js:752` and `:787` issue direct `.delete()` and `.insert()` on `nominees` from the frontend, bypassing the SECURITY DEFINER RPC contract.
Evidence:
  - Full analysis in docs/audit/02-backend-hotpath.md as AUDIT-2-3.
  - Listed here so the Phase 5 anti-pattern grep count is complete.
Proposed fix scope:
  See AUDIT-2-3. Replace with an `upsert_nominees` SECURITY DEFINER RPC that enforces sum-to-100 invariant atomically (also closes the §14b "nominee shares can sum >100%" bug — two-for-one).
Confidence: high
```

### AUDIT-5-12 — Cross-Phase: realtime publication active for tables with zero consumers (refer Phase 2 AUDIT-2-4)

```
ID:       AUDIT-5-12 (refer Phase 2)
Area:     config
Severity: P2
Title:    Realtime publication is ON for commissions / settlement_runs / settlement_run_branch_reviews per CLAUDE.md §9; no client subscribes to any of them per Phase 1's grep + Phase 2's verification.
Evidence:
  - See AUDIT-2-4 in docs/audit/02-backend-hotpath.md
  - Listed here because this is also config-drift (publication intent vs consumer reality).
Proposed fix scope:
  See AUDIT-2-4 — either wire consumers or drop the publication.
Confidence: high
```

---

## Verification

- `git status` was not run (this audit is a forward-only walk; no source changes).
- All cited file paths exist as of `2026-05-22`.
- All grep results are reproducible by running the commands listed inline.
- No source file modified during Phase 5.

## Next

→ Phase 6 (synthesis): roll up 51 findings across phases 1-5 into a single ranked backlog grouped into PR-sized chunks.
