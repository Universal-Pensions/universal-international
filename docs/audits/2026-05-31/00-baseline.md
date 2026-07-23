> **Agent guide.** Historical audit from 2026-05-31, covering the Phase-0 build/test/lint baseline and ground-truth seed signals for the Deep Platform Audit — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 00 — Baseline & Ground Truth (Phase 0)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (auditing the **working tree**, not committed `main`)
**Agent:** Agent 0 — Baseline. READ-ONLY. No source edits, no commits, no DB writes.
**Live DB:** Supabase project ref `zengmiugieqjqzaccbqe`

This file is the seed signal for the 8 Phase-1 workstream agents (A–H). Every flagged item is tagged with the owning workstream. Raw command outputs are summarized here; large outputs were captured and parsed.

---

## 1. Build / test / lint matrix

| Command | Result | Notes |
|---|---|---|
| `npm run lint` | **FAIL (exit 1)** | 572 errors, 2 warnings — **but all 572 errors come from `playwright-report/` build artifacts**, NOT source. See SEED-G1. |
| `npm test` (vitest) | **PASS** | 44 test files, **717 tests passed**, ~39s. |
| `npm run build` (Vite) | **PASS** | Built in ~3s. Largest chunk `vendor-xlsx` = 429.53 kB (gzip 143.08 kB). See SEED-H2. |
| `npm run build:api` (tsc on `server/`) | **PASS** | Clean `tsc -p server/tsconfig.json`, no errors. |

### 1.1 Lint detail (SEED-G1 — Workstream G; also touches Phase-0 expectations)

`npm run lint` runs bare `eslint .`. `eslint.config.js:8` only ignores `['dist', 'dist-server', 'coverage', '.claude/worktrees/**']` — it does **NOT** ignore `playwright-report/`. That directory **is** gitignored (`.gitignore:45 playwright-report/`) and untracked, but ESLint still lints the bundled `playwright-report/trace/*.js` artifacts, producing **572 errors** (`no-cond-assign`, `no-fallthrough`, `no-undef Buffer`, `react-hooks/rules-of-hooks`, etc.) entirely from minified vendor code.

- **Reproduced clean source lint:** `npx eslint 'src/**/*.{js,jsx}'` → **0 errors, 2 warnings**:
  1. `src/dashboard/subscriber/ViewSubscribers.jsx:272` — `react-hooks/incompatible-library` (TanStack Virtual `useVirtualizer`) — **expected-normal** per `CLAUDE.md §3`.
  2. `src/contexts/AuthContext.jsx:121` — `warning Unused eslint-disable directive (no problems were reported from 'react-hooks/refs')` — a **stale eslint-disable** that `CLAUDE.md §3` says should already be cleared ("drops to 1 after Phase 6 … removed … the stale eslint-disable directive"). Still present in the working tree.
- **Note:** `.ts` files (`server/*.ts`, `api/**/*.ts`) are intentionally **not linted** — the flat config only matches `**/*.{js,jsx}` (`eslint.config.js:10`). Running eslint against `.ts` yields "Parsing error" because no TS parser is configured. By design; not a finding on its own (covered by `build:api` tsc gate).
- **Impact:** Any developer or CI step that runs `npm run lint` with a local `playwright-report/` present gets a **false failure** (exit 1) that masks the real source state. CLAUDE.md §3 claims "0 errors expected." CI may be insulated only because it has no report artifact at lint time — Workstream F/G to confirm.
- **Tag:** SEED-G1 (config) + SEED-C1 (the stale `AuthContext.jsx:121` directive — Workstream C / quality).

---

## 2. `npm audit --json` — dependency vulnerability summary (SEED → Workstream H)

**Totals:** `info: 0 · low: 1 · moderate: 14 · high: 22 · critical: 0` → **37 total**.

### 2.1 The big picture
The **overwhelming majority** of vulns are transitive dependencies of the **`vercel` CLI** dependency tree (`@vercel/*`, `path-to-regexp`, `undici`, `minimatch`, `smol-toml`, `ajv`, `srvx`, `tar` via `@vercel/fun`, etc.). These are dev/CLI tooling, not shipped to the browser bundle or the Render server runtime. Fixing them requires the **semver-major** `vercel@50.41.0`. Workstream H to assess whether `vercel` is even still needed as a dependency post Vercel-frontend migration (the GitHub App does deploys; CLI may be removable → eliminates ~25 of the 37).

### 2.2 Fixes available WITHOUT semver-major (low-risk bumps)
| Package | Severity | Issue | fixAvailable |
|---|---|---|---|
| `vite` | high | Path traversal in optimized-deps `.map`; arbitrary file read via dev-server WS (`GHSA-4w7w-66w2-5vf9`, `GHSA-p9ff-h696-f583`) | true (≤6.4.1 affected; dev-server only) |
| `tar` | high | Multiple path-traversal / symlink CVEs (`<=7.5.10`) | true (transitive via `@mapbox/node-pre-gyp` / `@vercel/fun`) |
| `d3-color` / `d3-interpolate` | high | ReDoS (`GHSA-36jr-mh4h-2g58`) | true (transitive via recharts) |
| `postcss` | moderate | XSS via unescaped `</style>` in stringify (`<8.5.10`) | true |
| `brace-expansion` | moderate | Zero-step sequence DoS | true |
| `@mapbox/node-pre-gyp` | high | via `tar` | true |

### 2.3 The standout finding — `xlsx` (SEED-H1, the plan's flagged real-bug)
```
xlsx | severity=high | range=* | fixAvailable=FALSE
  via=Prototype Pollution in sheetJS  [CWE-1321]  GHSA-4r6h-8v6p-xvw6  (CVE-2023-30533)
  via=SheetJS Regular Expression Denial of Service (ReDoS) [CWE-1333]  GHSA-5pgg-2g8v-p4x9  (CVE-2024-22363)
```
- `xlsx@0.18.5` is frozen on the npm registry; **no npm fix exists** (SheetJS ships patches only via their CDN build). Parsing runs on **distributor-uploaded settlement Excel files** (`src/utils/xlsx.js`). **Classify `real-bug`/security — NOT demo-scope.** Workstream H owns the exploitability assessment + remediation (CDN build / safer parser / constrained parse). Workstream B owns the file-parse hardening (no size cap / MIME check). The 429 kB `vendor-xlsx` chunk (§1) is the same dependency.

Raw audit JSON saved to `/tmp/npm-audit.json` during this run (ephemeral).

---

## 3. Git state

- **Branch:** `feat/simplify-commissions`
- **Ahead of `origin/main` by 1 commit:** `d189dd6 fix(agent): restore Commissions link in side nav + bottom-bar More menu`
- **`git diff --stat origin/main...HEAD`** (the committed delta) is tiny — only 2 files, 12 insertions:
  - `src/agent-dashboard/shell/BottomTabBar.jsx` (+1)
  - `src/agent-dashboard/shell/SideNav.jsx` (+11)
- **The real change set is the UNCOMMITTED working tree** (matches the plan's framing). Counts:

### 3.1 Modified (tracked) — 41 files
Docs: `ARCHITECTURE.md`, `BACKEND.md`, `FRONTEND.md`, `claude.md`, `docs/SPEC.md`, `docs/api-contracts.md`, `docs/data-model.md`, `docs/role-permissions.md`.
Config/seed: `package.json`, `package-lock.json`, `scripts/seed-supabase.mjs`, `vite.config.js`.
Agent dashboard: `home/HomePage.{jsx,module.css}`, `home/widgets/CommissionsSnapshotCard.jsx`, `home/widgets/PulseCard.jsx`, `pages/AnalyticsPage.jsx`, `pages/CommissionsPage.{jsx,module.css}`, `pages/InboxPage.jsx`, `pages/SettingsPage.jsx`, `pages/SubscribersPage.jsx`, `shell/BottomTabBar.jsx`, `shell/SideNav.{jsx,module.css}`.
Branch dashboard: `overview/BranchHealthScore.{jsx,module.css}`, `overview/BranchOverview.{jsx,module.css}`, `overview/OperationsSection.{jsx,module.css}`.
Distributor/shared: `dashboard/commissions/CommissionPanel.{jsx,module.css}`, `components/HeroCapsule.jsx`, `components/PageHeader.jsx`, `data/mockData.js`.
Hooks/services/tests: `hooks/__tests__/useCommission.test.js`, `hooks/useCommission.js`, `hooks/useTickets.js`, `services/__tests__/commissions.test.js`, `services/commissions.js`.

> **NOTE on `claude.md` casing (SEED-G3):** `git status` shows a tracked file literally named **`claude.md`** (lowercase) being modified, while the file we read for audit criteria is `CLAUDE.md`. On case-insensitive macOS APFS these resolve to the same inode, but on case-sensitive Linux (CI/Render/Vercel build) they are **two different files**. Workstream G to verify whether there is a casing collision / which one ships.

### 3.2 Deleted (tracked) — 4 files
- `src/branch-dashboard/overview/BranchSettlementBanner.{jsx,module.css}` (settlement banner retired in the simplification)
- `src/utils/settlementCycle.js` + `src/utils/__tests__/settlementCycle.test.js` (settlement-cycle logic retired with the run/cadence model)

### 3.3 Untracked (new) — 18 paths
- **Migrations (heart of the change):** `supabase/migrations/0029_commission_simplify.{sql,down.sql}`, `0030_settlement_batches.{sql,down.sql}`, `0031_notifications.{sql,down.sql}`
- New agent shell: `src/agent-dashboard/shell/AgentHeaderChrome.{jsx,module.css}`
- Notifications feature (frontend): `src/components/notifications/` (dir), `src/hooks/useNotifications.js`, `src/hooks/__tests__/useNotifications.test.js`, `src/services/notifications.js`, `src/services/__tests__/notifications.test.js`
- New utils: `src/utils/settlement.js`, `src/utils/commissionMonths.js`, `src/utils/xlsx.js` + tests `src/utils/__tests__/settlement.test.js`, `src/utils/__tests__/xlsx.test.js`

**Release-hygiene seed (SEED-G2 → Workstream G):** This is a large, coherent-looking but uncommitted/untracked unit (docs + DB + frontend + tests for the commission→settlement→notification simplification). Pushing `feat/simplify-commissions` → `main` auto-deploys Vercel (frontend). The DB migrations are **already applied to live** (see §5) but are **not in the git-tracked migration history yet** and **not in the Supabase `schema_migrations` history table** (see §5.2). Confirm it forms a shippable unit and assess auto-deploy risk before cutover.

---

## 4. New-migration substance (0029 / 0030 / 0031) + revertibility

(These are untracked, so `git diff` shows nothing — content read directly.)

### 4.1 `0029_commission_simplify.sql` (384 lines) + `.down.sql` (86 lines)
Collapses `commission_status` 7→2 (`due`/`paid`); remaps released/confirmed→paid, everything else→due; drops the run/dispute/hold/confirm RPCs (from 0004/0014/0021), the `commissions_before_update` dispute trigger + fn (0002), the `settlement_runs` + `settlement_run_branch_reviews` tables (CASCADE) and their two enums; drops dispute/hold/confirm + `run_id` columns; **adds `commissions.paid_amount`**; re-emits the 3 read RPCs without the retired buckets.

- **SEED-A1 (lossy rollback — Workstream A):** `0029.down.sql:1-23` self-documents as **DESTRUCTIVE / fundamentally IRREVERSIBLE** — the enum collapse + dropped columns/tables lose data; the down file only re-creates **empty structural shells** and explicitly states it must NOT be added to `schema_migrations`. **Recommend: "back up prod before cutover" go/no-go gate.** Matches the plan's seed.

### 4.2 `0030_settlement_batches.sql` (72 lines) + `.down.sql` (19 lines)
Creates `settlement_batches` (TEXT PK, `agent_id` FK→agents NOT NULL, `branch_id` FK→branches nullable, `pending_total`/`paid_amount` NUMERIC **no precision/scale**, `txn_ref`, `paid_date`, `line_count`, `created_at`). 3 indexes (branch/agent/created_at). ENABLE + FORCE RLS; 3 SELECT policies all correctly read `(SELECT auth.jwt()) ->> 'app_role'` / `'branchId'` / `'agentId'`. No INSERT/UPDATE/DELETE policies (writes via RPC). `GRANT SELECT … TO authenticated`.

### 4.3 `0031_notifications.sql` (280 lines) + `.down.sql` (22 lines)
Creates `notifications` (TEXT PK, `recipient_role`/`recipient_id`, `type`, `title`, `body`, `amount` NUMERIC, **`ref_id` TEXT — no FK**, `is_read`, `created_at`). 2 indexes. ENABLE+FORCE RLS; 3 SELECT policies all read `app_role`/`agentId`/`branchId` correctly. **Defines BOTH `apply_settlement(jsonb)` and `mark_notifications_read(text[])`** RPCs here (not in 0030).

### 4.4 Cross-migration / correctness seeds (→ Workstream A / B / D)
- **SEED-A2 (no FK on `notifications.ref_id`):** `0031_notifications.sql:32` — `ref_id TEXT` references `settlement_batches.id` only by convention. Deleting a batch orphans notifications. Recommend `ON DELETE SET NULL` FK or document the denorm. (Plan seed confirmed.)
- **SEED-A3 (cross-migration RPC coupling):** `apply_settlement` is created in **0031** (`0031:93`), but `0030.down.sql` does not drop it and `0031.down.sql:13` does. If 0031 is rolled back but 0030 kept, `apply_settlement` is dropped while `settlement_batches` survives — internally consistent but the `apply_settlement` ownership living in the "notifications" migration is surprising. Workstream A to confirm intentional.
- **SEED-B1 / A4 (no rounding on `paid_amount`):** `0031:161` writes client-supplied `v_amount_paid` (`(v_row ->> 'amountPaid')::numeric`) straight into the unconstrained NUMERIC `commissions.paid_amount` / `settlement_batches.paid_amount` — fractional UGX possible. No `round()`. (Plan seed confirmed.)
- **SEED-B2 / D1 (no idempotency nonce):** `apply_settlement` (`0031:93-217`) selects `status='due'` and stamps `paid` with no idempotency key. A double-submit between the SELECT and the next call double-pays / double-notifies. Recommend a client nonce or "already paid" guard. (Plan seed confirmed.)
- **SEED-A5 (RPC role check is correct):** `apply_settlement` (`0031:115`) gates on `app_role = 'distributor'` and `mark_notifications_read` (`0031:246-271`) re-checks ownership inside the SECURITY DEFINER body — both correctly read `app_role`, not `role`. `search_path` pinned to `public, pg_temp` on both. Good — no §5.7 trap here. RPCs are `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated` (`0031:219-220, 275-276`).

---

## 5. Supabase live signal & DRIFT CHECK

### 5.1 `list_tables` (public schema) — 21 base tables, 0 views
RLS is **enabled on all 21**. Row counts: regions 4, districts 136, branches 317, agents 2049, subscribers 30001, subscriber_balances 30001, contribution_schedules 30001, insurance_policies 16434, nominees 145172, transactions 522134, claims 11426, withdrawals 29785, commission_config 1, commissions 30001, agent_referrals 0, contact_submissions 0, users 26, demo_personas 7, distributors 1, **settlement_batches 0**, **notifications 3**.

- **SEED-A6 (table-count discrepancy — Workstream A):** Live has **21** public base tables; the plan/Agent-A scope says "all 23 tables." Verified via `information_schema`: `base_tables=21, views=0`. The delta is explained by 0029 dropping `settlement_runs` + `settlement_run_branch_reviews` (−2) and 0030/0031 adding `settlement_batches` + `notifications` (+2) → net unchanged at 21, so the "23" figure is stale (likely counted the now-dropped run tables alongside the new ones). Agent A should treat **21** as ground truth.
- `settlement_batches` is empty (0 rows) and `notifications` has 3 rows — consistent with the new flow having been exercised lightly in live.

### 5.2 `list_migrations` vs local files — **DRIFT DETECTED** (SEED-A7 / SEED-G4)
- **Local forward migration files:** 31 (`0001`–`0031`). Only **9** `.down.sql` files exist (the 0029/0030/0031 trio = 6 of them; the rest are older).
- **Live `supabase_migrations.schema_migrations`:** **25** rows. The new trio IS recorded: `20260531130807 commission_simplify`, `20260531130827 settlement_batches`, `20260531130909 notifications` → **0029/0030/0031 are applied and tracked in live history.**
- **6 local migration files are MISSING from the live `schema_migrations` history table:**
  `0022_audit_perf`, `0023_rls_initplan_fixes`, `0024_upsert_nominees`, `0025_drop_realtime_publication`, `0027_post_audit_polish`, `0028_replay_safety_guards`.
  (Local `0015` maps to live name `0015_signup_insurance_and_premium_tx` — a naming quirk, but present.)
- **HOWEVER, the EFFECTS of those "missing" migrations ARE applied in live** (verified by object presence):
  - `upsert_nominees` RPC exists (count=1) → 0024 effect present.
  - `users.password_hash` column exists → 0026 present (and IS in history as `users_password_hash`).
  - No public table is a member of `supabase_realtime` (`public_tables_in_realtime=0`) → 0025 effect present.
  - 10 SECURITY DEFINER functions in `public` (matches the post-simplification inventory) → search_path/app_role migrations applied.
- **Interpretation:** The 0022–0025/0027/0028 migrations were applied to live **out-of-band** (direct SQL / `scripts/`) without inserting rows into `schema_migrations`, OR the live history was truncated/rebuilt at some point. The schema state matches the files, but the **migration ledger is out of sync** — a future `supabase db push` could try to re-run these 6 and collide (idempotency-dependent). Workstream A (idempotency/replay safety) + Workstream G (release hygiene) co-own this.
- **Bottom line on the audited trio:** **0029/0030/0031 are NOT drifted** — they are applied and ledger-tracked in live, and the live schema matches the files (settlement_batches, notifications, apply_settlement, mark_notifications_read, commissions.status, commissions.paid_amount all present and shaped as in the files).

### 5.3 `get_advisors` type=security — 22 WARN, 0 ERROR (SEED-B3 — mostly by-design)
All 22 are the **same 2 lint families across 11 functions**:
- `anon_security_definer_function_executable` (×11) + `authenticated_security_definer_function_executable` (×11).
- The 11 functions: `apply_settlement`, `create_subscriber_from_agent_onboard`, `create_subscriber_from_signup`, `get_entity_metrics_rollup`, `get_top_branch`, `mark_notifications_read`, `trg_subscribers_after_insert`, `trg_transactions_contribution`, `trg_transactions_withdrawal`, `upsert_nominees`.
- **Assessment:** This is **largely by-design** — the platform's architecture (`CLAUDE.md §7.3`) routes ALL writes through SECURITY DEFINER RPCs that perform their own internal `app_role` checks (verified for `apply_settlement`/`mark_notifications_read` in §4.5). The advisor flags any SECURITY DEFINER fn callable by `anon`/`authenticated`; that is the intended call path. **Two nuances for Workstream A/B:**
  1. The three **trigger functions** (`trg_*`) being directly callable via `/rest/v1/rpc/` is the only mildly surprising case — trigger fns generally shouldn't be RPC-invokable; confirm they no-op or error safely when called outside a trigger context.
  2. `get_entity_metrics_rollup` / `get_top_branch` are SECURITY DEFINER **read** RPCs callable by `anon` — confirm they enforce claim scoping internally (the §5.7 trap historically bit `0018`/`0019` here).
- **No `ERROR`-level security advisors** (no missing-RLS, no exposed auth, no SECURITY DEFINER view issues).

### 5.4 `get_advisors` type=performance — 63 total (56 WARN, 7 INFO) (SEED-A8 — Workstream A, perf/tech-debt)
- **`auth_rls_initplan` ×1 (WARN):** `public.distributors` policy `distributors_update_self` re-evaluates `auth.<fn>()` per-row. The rest of the schema was already wrapped in `(SELECT auth.jwt())` (per 0008/0023); this one policy was missed. Low impact (distributors table = 1 row) but a real inconsistency.
- **`multiple_permissive_policies` ×55 (WARN):** Every per-role SELECT policy set (e.g. `{x_select_agent, x_select_branch, x_select_distributor, x_select_self}`) counts as "multiple permissive policies" across the 5 Postgres roles (anon/authenticated/authenticator/dashboard_user/supabase_privileged_role) on 11 tables incl. the **new `settlement_batches` + `notifications`**. This is the **standard role-scoped RLS pattern** for this app (one SELECT policy per app-role). It is a known perf-vs-clarity tradeoff, not a correctness bug. Awareness/tech-debt; the new tables simply inherit the existing pattern.
- **`unused_index` ×7 (INFO):** `settlement_batches_{branch_id,agent_id,created_at}_idx` (table is empty — expected, will be used once settlements run), `notifications_created_at_idx`, `idx_subscribers_gender`, `commissions_branch_id_status_idx`, `idx_commissions_status`. The 3 settlement_batches + 1 notifications indexes are **new and unused only because the feature is fresh** — not removal candidates yet. `idx_subscribers_gender` / the 2 commissions indexes are genuine unused-index candidates for Workstream A.

### 5.5 `list_extensions` (sanity)
Installed in `public`-relevant schemas: `pgcrypto` (extensions), `pg_trgm` (extensions — moved there by 0012), `pg_stat_statements` (extensions), `uuid-ossp` (extensions), `plpgsql` (pg_catalog), plus Supabase-managed `pgsodium`/`supabase_vault`. No extensions installed in the `public` schema (good — 0012 moved `pg_trgm` out). `0031` uses `gen_random_uuid()` which is a pg_catalog built-in (no extension dependency) — correct per its header comment.

---

## 6. Seed-findings index (tag → workstream)

| Tag | Severity (prelim) | Title | Owner |
|---|---|---|---|
| SEED-G1 | Medium | `npm run lint` fails on gitignored `playwright-report/` artifacts (not in eslint `globalIgnores`); contradicts "0 errors expected" | G |
| SEED-C1 | Low | Stale `eslint-disable react-hooks/refs` directive at `AuthContext.jsx:121` (CLAUDE.md §3 says it should be gone) | C |
| SEED-H1 | High | `xlsx@0.18.5` — 2 high CVEs (prototype pollution CVE-2023-30533 + ReDoS CVE-2024-22363), **no npm fix**, used on uploaded files | H |
| SEED-H2 | Low/Awareness | `vendor-xlsx` chunk = 429 kB (143 kB gz); xlsx is also the bundle-size driver | H |
| SEED-H3 | Awareness | 35/37 npm-audit vulns are transitive under the `vercel` CLI; only fixable via semver-major `vercel@50.41.0` (or removing the dep) | H |
| SEED-H4 | Medium | Fixable-without-major bumps available: `vite`, `tar`, `d3-color`, `postcss`, `brace-expansion` | H |
| SEED-A1 | High/Awareness | `0029.down.sql` is lossy/irreversible (enum collapse + dropped tables) → "back up prod before cutover" gate | A |
| SEED-A2 | Medium | `notifications.ref_id` → `settlement_batches.id` has no FK (batch delete orphans notifications) | A |
| SEED-A3 | Low | `apply_settlement` defined in 0031 but `0030.down` doesn't drop it (cross-migration coupling) | A |
| SEED-A4 / B1 | Medium | `paid_amount` written with no rounding → fractional UGX possible (`0031:161`) | A / B |
| SEED-B2 / D1 | High | `apply_settlement` has no idempotency nonce → double-submit double-pays/double-notifies | B / D |
| SEED-A5 | (positive) | New RPCs correctly read `app_role`, pin `search_path`, REVOKE PUBLIC — no §5.7 trap | A |
| SEED-A6 | Low | Live has 21 public tables (not "23"); plan figure stale post-0029 drop/0030-31 add | A |
| SEED-A7 / G4 | Medium | Migration-ledger DRIFT: 6 local migrations (0022/0023/0024/0025/0027/0028) absent from live `schema_migrations`, though their effects are applied → `db push` collision risk | A / G |
| SEED-B3 | Medium/Awareness | 22 security advisors = 11 SECURITY DEFINER fns executable by anon/authenticated (mostly by-design); verify `trg_*` fns + read RPCs are safe when RPC-invoked | B / A |
| SEED-A8 | Low/tech-debt | Perf advisors: 1 `auth_rls_initplan` on `distributors_update_self` (un-wrapped); 55 `multiple_permissive_policies` (standard pattern); 7 `unused_index` (4 are new-feature, 3 genuine) | A |
| SEED-G2 | High/Awareness | Large uncommitted/untracked release unit; pushing to `main` auto-deploys Vercel; assess shippability/cutover risk | G |
| SEED-G3 | Medium | `git status` shows tracked `claude.md` (lowercase) modified vs `CLAUDE.md` — potential case-collision on case-sensitive CI/Linux | G |

---

## 7. Verification of Phase-0 completeness

- [x] `npm run lint` — captured (FAIL, but artifact-only; clean source confirmed separately).
- [x] `npm test` — captured (PASS, 717/717).
- [x] `npm run build` — captured (PASS).
- [x] `npm run build:api` — captured (PASS).
- [x] `npm audit --json` — captured + summarized by severity (0/1/14/22/0).
- [x] `git status` / `git diff --stat origin/main...HEAD` / new-migration content + revert files — captured.
- [x] Supabase `get_advisors` (security + performance), `list_tables`, `list_migrations`, `list_extensions` — captured via read-only MCP.
- [x] Drift check vs migration files — performed; 0029/0030/0031 NOT drifted; 6 older migrations missing from live ledger (effects applied) flagged.
- [x] Seed findings flagged and tagged to workstreams A–H.

**Phase 0 complete. Phase 1 (Agents A–H) may launch.**
