---
name: qa
description: Run, debug, and extend the Playwright + Supabase E2E QA suite for the Universal Pensions Uganda demo platform.
---

> **Agent guide.** This is the operating manual for `/qa` — the Playwright + Supabase service-role end-to-end harness that drives each role's dashboard in a browser and verifies the DB side-effects of every UI action. Read it in full before you run, debug, or extend the E2E suite under `e2e/` (invoke the work through the `/qa` subcommands below); it carries the coverage map, the auth/DB spec patterns, the failure-triage playbook, and the known-bug list. It is not the unit-test guide (those live in `src/**/__tests__/` and run via `npm test`), and for app internals defer to `CLAUDE.md` plus `docs/FRONTEND.md` / `docs/BACKEND.md`.
>
> **Spec inventory verified against the `e2e/specs/` tree on 2026-08-25; runtime/pass-fail figures are the 2026-08-23 audit measurement** (`docs/audits/2026-08-23/00-baseline.md §10`) — re-run `/qa fix` before trusting the failure list below if time has passed.

# /qa — Automated QA harness

End-to-end browser tests (Playwright) plus a Supabase service-role client for verifying DB side-effects after every UI action. Unit tests live under `src/**/__tests__/` and run via `npm test` (vitest); E2E lives under `e2e/` and runs via the scripts below.

**Current coverage:** the suite is far past its original ~78-test baseline. Measured 2026-08-23 at `--workers=1` across all 4 Playwright projects (chromium, webkit, mobile-chromium, mobile-webkit): **370 cases — 326 passed / 30 failed / 14 skipped, 24.4 min, exit 1** (`docs/audits/2026-08-23/00-baseline.md §10`). The 30 failures are deterministic, not flaky — see "Currently failing" below. Four layers exist under `e2e/specs/`:
- **`smoke/`** (8 files) — every dashboard route × **all 6 roles** (subscriber, agent, branch, distributor, **employer**, **admin**) + landing + a `_health` check. Each route loads, renders its identity element, and shows its primary CTA without crashing.
- **`flows/`** (18 files) — golden-path UI actions with DB verification: subscriber-edit-profile, subscriber-signup-to-contribute (full 9-step wizard + DB), subscriber-signin-with-password, **agent-onboard-subscriber (canonical happy path; the AML-hang is resolved, the test asserts the `create_subscriber_from_agent_onboard` RPC + subscriber/balance rows land)**, agent-dashboard-drill-to-subscriber, branch-dashboard-drill-to-subscriber, distributor-drill-agent-to-subscriber, distributor-drill-branch-to-subscriber, distributor-commission-drill-subscribers, distributor-renders-data, distributor-create-branch (the panel **is now wired** — see bug list below, it is not a `test.fail`), distributor-apply-settlement, distributor-exports-csv, employer-contribution-run, admin-create-employer, kyc-failure-paths, auth-otp-retry-lockout, settings-change-password. (There is no `branch-create-agent` spec — that name never existed under this tree.)
- **`db/`** (4 files) — service-role DB-contract specs with no browser: `invariants.spec.ts` (schema/business invariants), `money-idempotency.spec.ts` (no double-credit on retried writes), `rls-isolation.spec.ts` (cross-tenant RLS isolation), and `deactivate-entities.spec.ts` (entity deactivate/reactivate journalling, `0060`/`0080`).
- **`regression/`** (8 files) — targeted UI regressions: map-drill, modal-escape, empty-states, subscriber-write-failures, subscriber-settings-stubs, subscriber-payment-methods, subscriber-insurance-no-scroll, employer-kyc-nudge. `subscriber-payment-methods.spec.ts` and `employer-kyc-nudge.spec.ts` also run on the **mobile projects** (see `testMatch` in `playwright.config.ts`) because each ships a distinct phone body over shared logic.

Subscriber smoke route notes (Phase 6D mobile-redesign — three assertions rewritten in place, not added): `/dashboard/activity` now renders ActivityPage (h1 "Activity" / "THIS YEAR" eyebrow / All-Incoming-Outgoing filters) instead of redirecting to all-transactions; `/dashboard/settings` now renders the account hub whose h1 is "Profile" (not "Settings"), with a "Sign out" action; and `/dashboard/save`'s h1 is "Save" (not "top up", which moved to the footer CTA).

---

## Subcommands

### `/qa smoke`
```sh
npm run test:e2e:smoke
```
Per-role smoke pass. Every page in every role's dashboard navigates without crashing; identity element renders; primary CTA visible. Covers landing + a `_health` check + all 6 role dashboards: subscriber, agent, branch, distributor, **employer**, and **admin** (one smoke file per role under `e2e/specs/smoke/`). Budget minutes, not seconds — the smoke layer alone was not separately timed in the 2026-08-23 measurement, and the full suite (smoke + flows + regression + db, all 4 projects) took 24.4 min at `--workers=1`.

### `/qa flows`
```sh
npm run test:e2e:flows
```
Golden-path UI flows with DB verification. Each spec under `e2e/specs/flows/` performs a user action, listens for the relevant PATCH/POST 200, then queries Supabase via service-role to confirm the row was written/updated. `afterEach` reverts state for clean reruns.

### `/qa all`
```sh
npm run test:e2e
```
`npm run test:e2e` is bare `playwright test` — it runs the **whole suite** (smoke + flows + regression + db) across all 4 configured projects, not just smoke + flows. Measured 2026-08-23: ~24 min at `--workers=1` (370 cases, 326 passed / 30 failed / 14 skipped, exit 1 — see `docs/audits/2026-08-23/00-baseline.md §10`). Budget accordingly; it is not a ~2-minute check.

### `/qa fix`
```sh
npx playwright test --last-failed --headed --trace on
```
Re-runs only failed specs headed, with traces. Then I (Claude) inspect:
- `test-results/<spec>/trace.zip` → open with `npx playwright show-trace test-results/<spec>/trace.zip`
- `test-results/<spec>/test-failed-*.png` → use `Read` (multimodal) to see what the browser saw
- `playwright-report/index.html` → full HTML report

### `/qa db-check <id>`
After a flow spec runs, query Supabase via the `mcp__supabase__execute_sql` MCP tool to confirm rows are in the expected state. The flow specs themselves do this; this subcommand is for ad-hoc verification when investigating a UI report.

### `/qa explore <role>` — **NOT YET BUILT**
Roadmap (Phase 3 follow-up): headed Chromium + computer-use MCP to drive the browser exploratorily. Captures observations as Claude clicks. Slow + token-expensive; opt-in only.

### `/qa screenshot-review` — **NOT YET BUILT**
Roadmap: walk `test-results/**/*.png` from the last run and use multimodal `Read` to describe each — surfaces visual issues that selectors don't catch.

---

## Architecture quick reference

| File | Purpose |
|---|---|
| `playwright.config.ts` | Config + webServer (`npm run dev:all` → Vite :5173 + Express :3001) + reporter |
| `e2e/global-setup.ts` | Mints HS256 JWTs for all 6 roles (subscriber, agent, branch, distributor, employer, admin) into `e2e/.auth/{role}.json` |
| `e2e/fixtures/auth.ts` | JWT minter, storageState helpers, `PERSONA_FOR` demo persona map |
| `e2e/fixtures/db.ts` | Supabase service-role client + `rowExists`/`countWhere`/`getRow`/`cleanupSubscriberByPhone` |
| `e2e/fixtures/motion.ts` | `disableAnimations(page)` — kills framer-motion flake |
| `e2e/specs/smoke/` | One file per role (+ landing); every route → load assertion |
| `e2e/specs/flows/` | UI flows with DB verification (template: `subscriber-edit-profile.spec.ts`) |

**Auth strategy:** tests bypass the SignInModal. `global-setup` signs JWTs directly via `jose` (matching `api/_lib/jwt.ts`) and writes `localStorage` entries (`upensions_token`, `upensions_auth`) to a Playwright `storageState` file. Specs opt in via:
```ts
test.use({ storageState: storageStatePathFor('subscriber') });
```

**DB strategy:** specs that mutate data:
1. Snapshot the original row in `beforeEach` (via service-role client).
2. Perform the UI action.
3. Wait for the relevant network response (`page.waitForResponse(...)`).
4. Query the DB to confirm the side-effect.
5. Restore the original row in `afterEach`.

The pattern is documented in `e2e/specs/flows/subscriber-edit-profile.spec.ts` — use that as the template for new flow specs.

---

## Adding a new flow spec

1. **Pick a UI action** — e.g. "agent onboards a new subscriber". Find the relevant button/form.
2. **Find the backend write path** — grep `src/services/` for the function the form calls. Note whether it's an RPC, a direct `.from().insert()`, or `.update()`.
3. **Identify the table(s) touched** — for SECURITY DEFINER RPCs that hit multiple tables, list each one.
4. **Write the spec** using the template:
   ```ts
   import { test, expect } from '@playwright/test';
   import { storageStatePathFor } from '../../fixtures/auth';
   import { disableAnimations } from '../../fixtures/motion';
   import { supabaseAdmin, rowExists, cleanupSubscriberByPhone } from '../../fixtures/db';

   test.use({ storageState: storageStatePathFor('agent') });

   test.describe('agent → onboard subscriber (UI + DB)', () => {
     const uniquePhone = `+2567${String(Date.now()).slice(-9)}`;

     test.afterEach(async () => {
       await cleanupSubscriberByPhone(uniquePhone);
     });

     test('onboarding creates subscriber + balance rows', async ({ page }) => {
       await disableAnimations(page);
       const rpcPromise = page.waitForResponse(
         (r) => r.url().includes('/rest/v1/rpc/create_subscriber_from_agent_onboard') && r.status() === 200,
         { timeout: 20_000 },
       );

       await page.goto('/dashboard/onboard');
       // ...fill form, submit...

       await rpcPromise;

       expect(await rowExists('subscribers', { phone: uniquePhone })).toBe(true);
       expect(await rowExists('subscriber_balances', { subscriber_id: /*...*/ })).toBe(true);
     });
   });
   ```
5. **Pick unique test data** — phone numbers via `+2567${Date.now() % 1e9}` avoid collisions across parallel runs.
6. **Always cleanup** — `afterEach` must restore the seed state so reruns are clean.

---

## Debugging playbook

When a spec fails, do NOT immediately blame the product code. Decision tree:

1. **Is it a real product bug?** Open the failing screenshot (`test-results/<spec>/test-failed-*.png` via `Read`). If the UI is visibly wrong (error boundary, missing element, wrong text), it's likely a bug.
2. **Is the selector stale?** The product renamed a button or changed layout. Look at the trace (`npx playwright show-trace ...`) to see what the spec was waiting for. Update the spec.
3. **Is it a timing/flake?** Re-run with `--retries=2 --workers=1`. If sometimes passes, switch from `waitFor` to `await expect(...).toBeVisible()` with explicit timeouts.
4. **Is the DB drifted?** Specs that depend on seeded data (e.g. agent `a-001` exists, branch `b-kam-015` exists) fail if seed has drifted. Use `mcp__supabase__execute_sql` to verify. Re-seed with `npm run seed` if needed.
5. **Is the dev server up?** `lsof -i :5173` (Vite) and `lsof -i :3001` (Express) — if either died, Playwright restarts both next run via `npm run dev:all`; no action needed.
6. **JWT expired?** Storage states live in `e2e/.auth/{role}.json` and JWTs are 24h. `global-setup` re-mints on every run, so this should never happen — but if it does, `rm -rf e2e/.auth && npm run test:e2e` forces a fresh mint.

---

## Known product bugs surfaced by this suite

1. **`src/services/entities.js`** (FIXED 2026-05-18) — `mapAgent`/`mapBranch` originally returned `metrics: null`, causing `ViewAgents.jsx` + `ViewBranches.jsx` to crash on `.metrics.totalSubscribers`. Fix: provide `EMPTY_METRICS` zero-shape default at the mapper level.
2. ~~**`src/dashboard/branch/CreateBranch.jsx`** — UI mock, `handleConfirm()` never invoked `useCreateBranch`~~ — **FIXED** (verified 2026-08-25). `handleConfirm()` (`CreateBranch.jsx:257`, not :253) now calls `createBranch.mutateAsync({…})` (`:260`) against the wired `useCreateBranch()` hook (`:155`). There is no `test.fail()` anywhere under `e2e/specs/` — `distributor-create-branch.spec.ts` runs unmarked (the suite's one `test.fixme` is unrelated, on the settlement nonce-idempotency case — see item 4 below and `distributor-apply-settlement.spec.ts:501`).
3. ~~**`src/subscriber-dashboard/pages/ProfilePage.jsx`** — hydration bug~~ — FIXED (verified Phase 6D, 2026-05-29). ProfilePage now hydrates name/email/phoneDigits from the `useCurrentSubscriber` query via a `useEffect` (`ProfilePage.jsx:63-74`), so the form no longer renders empty until the user retypes. The hydration-barrier waits in `subscriber-edit-profile.spec.ts` (and the Profile-save regression test) now key off this committed effect rather than working around a defect.
4. ~~**Agent onboard AML step hang**~~ — RESOLVED. `agent-onboard-subscriber.spec.ts` is now an **enabled** flow spec (`test('full wizard creates subscriber + balances via RPC', …)`, no `test.fixme`/`test.skip`): it walks the full agent onboard wizard under the agent storageState, waits on the `create_subscriber_from_agent_onboard` RPC 200, and verifies the `subscribers` + `subscriber_balances` rows land. It is the canonical agent happy-path. (The `test.setTimeout(60_000)` budget absorbs the stacked mocked-KYC latencies — see the spec header for the timing breakdown.)
5. **`/dashboard/commissions/due`** (agent dashboard) — `due` isn't in `VALID_VIEWS` (defined at `src/agent-dashboard/pages/commissions/commissionsConfig.jsx:14`; imported into `CommissionsPage.jsx`, not defined there). The component redirects unknown views to `/dashboard/commissions`. Spec smoke-tests the redirect.
6. **Currently failing (measured 2026-08-23) — 30 of 370, deterministic.** Two independent engines failing the identical line numbers is a defect set, not flake/contention. `mobile-chromium` and `mobile-webkit` fail an identical set of 11 (`distributor-exports-csv.spec.ts:37,:141`; `landing.spec.ts:20,27,34`; `subscriber-dashboard.spec.ts:43,54,109,115,124,173`); `chromium` + `webkit` both fail `agent-onboard-subscriber.spec.ts:109` and `modal-escape.spec.ts:224`. Screenshots from that run are on disk under `test-results/`. Full breakdown: `docs/audits/2026-08-23/00-baseline.md §10`. Re-run `/qa fix` to confirm this list is still current before treating any of these as new.
6. **`/dashboard/reports/contributions`** (subscriber dashboard) — `REPORT_VIEWS` map keys the route segment as `contributions-summary` not `contributions`. The legacy URL `/dashboard/reports/contributions` would 404; the spec hits the corrected slug.

When a NEW bug is found, follow the pattern in the entities.js fix: surface clearly, fix at the source if a one-liner, otherwise mark the spec(s) with `test.fail()` + a comment, and document here.

---

## Environment requirements

Same as the rest of the repo:
- `.env.local` with `VITE_SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` set.
- `npx playwright install chromium` (one-time, after `npm install`).
- Node 22 LTS (per `.node-version`).

The harness reads `.env.local` via `dotenv` in `playwright.config.ts` and shares it with the two dev servers (`npm run dev:all` starts Vite :5173 and Express :3001 in parallel; Playwright targets `http://localhost:5173`, and the bundle calls the local Express via `VITE_API_BASE_URL=http://localhost:3001/api`).

---

## Phase roadmap

✅ **Phase 0** — Scaffold (config, fixtures, global-setup, skill skeleton).
✅ **Phase 1** — Smoke specs across all 6 role dashboards + landing + `_health`.
✅ **Phase 2** — Flow template spec with DB verification (subscriber-edit-profile).
✅ **Phase 3** — Finalized skill docs (THIS DOCUMENT). Vision augmentation (`/qa explore`, `/qa screenshot-review`) remains as roadmap below.
✅ **Phase 4** — Regression flow specs (signup→contribute, agent onboard, branch create-agent, distributor create-branch) + mobile-chromium project (restricted to viewport-friendly specs).
✅ **Phase 5** — GitHub Actions CI (`.github/workflows/test.yml`) with lint+unit job and gated e2e job, Playwright report artifact upload, concurrency control.

⏳ **Future** — Vision: `/qa explore <role>` (computer-use exploratory pass) and `/qa screenshot-review` (multimodal Read on captured PNGs). (The `ProfilePage.jsx` hydration fix landed in Phase 6D — see bug-list item #3. The agent-onboard AML-step hang and the UI-mock `CreateBranch` panel are both resolved — see the known-bugs list above; they are not future work.)
