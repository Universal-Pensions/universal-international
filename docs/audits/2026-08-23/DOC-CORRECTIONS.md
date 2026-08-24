# DOC-CORRECTIONS — 2026-08-23 audit (A26)

**Status: DRAFTED, NOT APPLIED.** Every row below is a proposed edit. No documentation
file was modified by this audit (guardrail G1 — the only writable path was
`docs/audits/2026-08-23/`).

**Ground truth** is `docs/audits/2026-08-23/00-baseline.md` plus the live introspection
re-run in this agent's session (see `26-documentation.md` §Evidence for the verbatim
commands). Live measurements used throughout:

| Fact | Measured value |
|---|---|
| Tables (`relkind='r'`, schema `public`) | **37** (+1 view) |
| Distinct function names / OIDs in `public` | **89 / 89** (zero overloads) |
| `SECURITY DEFINER` functions | **70** (all with pinned `search_path`) |
| Functions EXECUTE-able by `anon` | **13** (3 intentional + 10 trigger fns) |
| Functions EXECUTE-able by `authenticated` | **87** |
| RLS policies | **109** |
| Non-internal triggers | **10** |
| ENUMs | **2** (`commission_status`, `nominee_type`) |
| Forward migrations | **108** (`0001`–`0108`); **86** `.down.sql` |
| `supabase_migrations.schema_migrations` | **96 rows**, TIMESTAMP-versioned; head `20260811100047 → 0108_nominee_claims_seed` |
| Express API routes | **16** handler imports / **16** `app.all` mounts / **16** route source files |
| `src/services` / `src/hooks` / `src/utils` / `src/constants` (non-test) | **20 / 17 / 21 / 7** |
| `*.module.css` | **229** |
| Vitest | **140 files / 2010 tests**, all pass |
| Playwright | **370 cases — 326 pass / 30 fail / 14 skip**, 24.4 min, exit 1 |
| Live rows | subscribers 5064 · agents 2046 · branches 321 · **distributors 3** · employers 8 |
| `MOCK_NOW` (`src/data/mockData.js:25`) | **`new Date(2026, 6, 1)` = 2026-07-01** |
| `public._demo_now()` | **2026-05-18 23:59:59+00** |

Legend for **Severity**: `H` = would mislead an agent into a wrong or destructive action ·
`M` = materially wrong count/claim · `L` = drift, imprecision, dead reference.

---

## 1. `README.md`

| Line | Claim (verbatim fragment) | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 9 | "Mocked OTP, mocked KYC, **hardcoded unit price**, and a 24-hour fixed JWT are intentional demo scope" | Superseded by `0103`–`0106`. Unit price is a real admin-published NAV in `nav_snapshots`. `BACKEND.md:900` and `FRONTEND.md:1419` both already mark it RESOLVED — README is the last holdout. | `Mocked OTP, mocked KYC, and a 24-hour fixed JWT are intentional demo scope (see `CLAUDE.md §10a`). The unit price is **not** demo scope — it is a real admin-published fund NAV since migrations `0103`–`0106`.` | M |
| 18 | "**14 routes** covering auth, KYC mocks, contact, chat" | 16 (`+ access-request`, `+ nominee-claim`) | `16 routes covering auth, KYC mocks, contact, chat, public access-requests and public nominee claims.` | M |
| 30 | "**78 migrations** under `supabase/migrations/` (`0001`–`0078`)" | 108 files, `0001`–`0108` | `108 migrations under `supabase/migrations/` (`0001`–`0108`).` | M |
| 92 | "Schema lives in `supabase/migrations/*.sql` (**78 numbered migrations, `0001`–`0078`**)" | 108, `0001`–`0108` | `Schema lives in `supabase/migrations/*.sql` (108 numbered migrations, `0001`–`0108`).` | M |
| 109 | "HTTP request/response shapes for **the 14 API routes**" | 16 | `HTTP request/response shapes for the 16 API routes + RPC catalogue.` | M |
| 121 | "`keepalive.yml` pings `/healthz` **every 14 min**" | `.github/workflows/keepalive.yml:12` is `cron: '*/10 * * * *'` | `…pings `/healthz` every 10 min (GitHub cron jitter is 5–15 min, so 10 keeps successive pings under the 15-min sleep threshold).` | L |

---

## 2. `CLAUDE.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 58 | "`npm run lint` … 0 errors expected; **1 TanStack Virtual informational warning is normal**" | 0 errors, **323 warnings** (311 jsx-a11y, 2 `react-hooks/incompatible-library`) | `ESLint 9 flat config. 0 errors expected; ~323 warnings are the current baseline — 311 of them jsx-a11y, deliberately forced to `warn` in `eslint.config.js` so the a11y backlog does not fail the gate. Warnings are an untracked backlog, not a pass.` | M |
| 107 | Anti-pattern 6: "Don't write raw SQL from the frontend — **every database write goes through a SECURITY DEFINER RPC**" | Violated by shipped code: `src/services/subscriber.js:1411` `supabase.from('transactions').insert(…)`; also `:1049 :1212 :1219 :1399 :1403 :1463`, `src/services/entities.js:1065 :1101 :1133 :1185 :1411` | `Don't write raw SQL from the frontend. Every *money* write goes through a SECURITY DEFINER RPC. ⚠️ This rule is currently BREACHED: `src/services/subscriber.js` and `src/services/entities.js` still PATCH/POST tables directly through PostgREST, and RLS permits it (A02 measured 13 direct-write successes). Treat the rule as the target state, not a description of the code.` | **H** |
| 126 | §7.3 "All writes flow through SECURITY DEFINER RPCs … never write directly to a table from the client. **RLS would block it**, and the RPCs enforce business invariants atomically." | RLS does **not** block it. A02 reproduced 13 successful direct client writes, including a subscriber minting arbitrary money by POSTing `/rest/v1/transactions` (A02-001) and rewriting their own insurance cover (A02-002). | `Writes are *supposed* to flow through SECURITY DEFINER RPCs. ⚠️ As of 2026-08-23 RLS does NOT block direct client writes on every table — see `docs/audits/2026-08-23/02-rls-matrix.md` §5 (13 direct-write successes). Do not rely on "RLS would block it" as a security argument.` | **H** |
| 145 | Agent seeded count "**~2,049**" | 2046 | `~2,046` | L |
| 146 | Branch seeded count "**~316**" | 321 | `~321` | L |
| 147 | Distributor seeded count "**2** (each sees only its own network)" | **3**: `d-001`, `d-002`, `d-003 Karamoja Pilot Network` | `3 (each sees only its own network)` | M |
| 164 | Glossary: "**Two in the demo seed:** `d-001` (national — **289 branches**) and `d-002` (Busoga sub-region — 27 branches)" | 3 distributors. Branch ownership: `d-001` 291, `d-002` 27, `d-003` 2, **1 branch with `distributor_id IS NULL`** (invisible to every distributor — A02-010) | `Three in the demo seed: `d-001` (national — 291 branches), `d-002` (Busoga sub-region — 27 branches) and `d-003` (Karamoja Pilot Network — 2 branches). One branch still has `distributor_id IS NULL` and belongs to no distributor.` | M |
| 201 | "**`MOCK_NOW = new Date(2026, 4, 26)`** (2026-05-26) in `src/data/mockData.js`" | `src/data/mockData.js:25` is **`new Date(2026, 6, 1)` = 2026-07-01** | `**`MOCK_NOW = new Date(2026, 6, 1)`** (2026-07-01) in `src/data/mockData.js:25` anchors "due in N days" demos. ⚠️ Two copies have NOT been rolled forward with it: `scripts/seed-supabase.mjs:169` still hardcodes `new Date(2026, 4, 26)` under a comment asserting it MUST mirror `mockData.js`, and `e2e/specs/db/invariants.spec.ts:52` documents the same stale anchor. There is also a third, independent frozen clock — `public._demo_now()` = 2026-05-18.` | **H** |
| §4 / §5 (89–108) | 13 numbered rules presented as "**binding, not advisory**" (line 1) | 12 of 13 have **no mechanical enforcement whatsoever**; one (§5.7) is half-enforced. See `26-documentation.md` §2 for the rule-by-rule table. | Add after line 108: `> **Enforcement reality.** Only anti-pattern 7's `->> 'role'` half is mechanically enforced (`src/test/jwt-claim-contract.test.js`, which greps `supabase/migrations/*.sql`). The other twelve rules are PROSE ONLY: `eslint.config.js` carries no `no-restricted-imports`, there is no stylelint config, and there are no pre-commit hooks. A violation of §4.1, §5.2, §5.3, §5.4 or §5.6 will pass `npm run lint`, `npm test`, `npm run build` and CI.` | **M** |

---

## 3. `docs/ARCHITECTURE.md`

> This doc already self-declares (line 1 + line 9) that it is pinned to a May-2026
> snapshot and that counts must be verified. That disclaimer is honest and should be
> KEPT — but the numbers below are now wrong by 30–90 % and are quoted downstream.

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 23 | ASCII box: "**4 role-scoped dashboard shells** (subscriber, agent, branch, distributor)" | 6 shells — `src/{subscriber,agent,branch,employer,admin}-dashboard/` + `src/dashboard/` | `6 role-scoped dashboard shells (subscriber, agent, branch, employer, admin) under src/{…}-dashboard/ + src/dashboard/ for the distributor` | M |
| 32 | "services (`src/services/`, **11 files**)" | 20 non-test files | `services (`src/services/`, 20 files)` | M |
| 52–58 | Route box: `api/auth/* — 4`, `api/kyc/* — 8`, `api/chat.ts`, `api/contact.ts` = 14 | 16 — add `api/access-request.ts` and `api/nominee-claim.ts` | Add two lines to the box: `• api/access-request.ts` and `• api/nominee-claim.ts`; total 16. | M |
| 79 | "**28 tables** · 2 ENUMs · pg_trgm · **5 triggers**" | 37 tables · 2 ENUMs · pg_trgm · **10 triggers** | `37 tables · 2 ENUMs · pg_trgm · 10 triggers` | M |
| 80 | "**40 functions** (29 SECURITY DEFINER + 11 INVOKER)" | 89 functions (70 DEFINER + 19 INVOKER), 89 OIDs for 89 names ⇒ zero overloads | `89 functions (70 SECURITY DEFINER + 19 INVOKER; zero overloads)` | M |
| 81 | "**~90 RLS policies**" | 109 | `109 RLS policies (zero `auth.uid()` calls — all read app_role)` | M |
| 84–86 | "**57 migrations** on the new DB … `0001 → 0057` inclusive … **no ledger drift**" | 108 migrations, `0001 → 0108`. Ledger is 96 TIMESTAMP-versioned rows, **structurally unjoinable** to the `0001_*` filenames (A00 §7) | `108 migrations on the new DB (cutover 2026-06-05): 0001 → 0108 inclusive (0019 backfilled). ⚠️ The supabase_migrations ledger versions rows as TIMESTAMPS, so it cannot be diffed against the 0001_* filenames — establish applied state by introspecting pg_proc / pg_policies, never by version diff.` | **H** |
| 387 + 393 | "### 7.1 Unit layer — **1221 tests across 76 files**" / "` Test Files  76 passed (76)` / ` Tests  1221 passed (1221)`" | 140 files / 2010 tests | `### 7.1 Unit layer — 2010 tests across 140 files` + refresh the fenced block to `Test Files 140 passed (140)` / `Tests 2010 passed (2010)` | M |
| 450–463 (§7.3) | Suite status table: `test.fail()` **0**, one unconditional `test.skip()` | `test.fail()` is still 0 ✅. But the table predates the current suite: the measured Playwright baseline is **370 cases — 326 pass / 30 fail / 14 skip, exit 1**, with 30 *deterministic* failures. | Add a row: `| Hard failures (measured 2026-08-23, `--workers=1`, all 4 projects) | **30 of 370** | Deterministic, not flaky — mobile-chromium and mobile-webkit fail an identical set of 11; chromium + webkit both fail agent-onboard-subscriber:109 and modal-escape:224. See `docs/audits/2026-08-23/00-baseline.md` §10. |` | **H** |
| 540 | "unified the error envelope across **all 14 routes**" | 16 | `across all 16 routes` | L |
| 661 | "The full list today runs `0001` → `0057` (**57 migrations**…)" | `0001` → `0108` (108) | `The full list today runs `0001` → `0108` (**108 migrations**, with `0019` backfilled…). `0058`–`0108` are narrated in `BACKEND.md §10`/§16 and in the 2026-08-23 audit set.` | M |

---

## 4. `docs/BACKEND.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 37 | ASCII box "**29 tables** · 2 ENUMs · pg_trgm · **8 triggers**" | 37 tables · 10 triggers | `37 tables · 2 ENUMs · pg_trgm · 10 triggers` | M |
| 38 | "**53 functions** (SECURITY DEFINER + INVOKER)" | 89 (70 DEFINER + 19 INVOKER) | `89 functions (70 SECURITY DEFINER + 19 INVOKER)` | M |
| 39 | "**99 RLS policies** (zero auth.uid() calls)" | 109 (zero `auth.uid()` — still true) | `109 RLS policies (zero auth.uid() calls)` | M |
| 44 | "every migration **`0001`–`0076`** applied … **Live census (verified 2026-07-08): 29 tables · 2 ENUMs · 8 triggers · 53 functions · 99 RLS policies** … the live ledger head is now **`0076_subscribers_column_scoped_update`**" | `0001`–`0108` applied. Census 2026-08-23: 37 tables · 2 ENUMs · 10 triggers · 89 functions · 109 policies. Ledger head `20260811100047 → 0108_nominee_claims_seed`. | Replace the census sentence with: `**Live census (verified 2026-08-23): 37 tables · 1 view · 2 ENUMs · 10 triggers · 89 functions (70 DEFINER, all search_path-pinned) · 109 RLS policies** (zero `auth.uid()`, zero `->> 'role'`). Every migration `0001`–`0108` is applied; the ledger head is `0108_nominee_claims_seed`.` | **H** |
| 329 | "on the live new DB all **~90 policies** + every user-facing RPC read `app_role` correctly" | 109 policies; the `app_role`/zero-`auth.uid()` property still holds (verified live) | `all 109 policies + every user-facing RPC read `app_role` correctly (zero `auth.uid()`, zero `->> 'role'` — re-verified live 2026-08-23)` | L |
| 343 | "Newer migrations ship a `.down.sql` partner (`0016`, `0022`–`0026`, and every migration **`0029`–`0076`**). Older migrations (**`0001`–`0015`, plus the backfilled `0019`**) do not have downs." | 86 downs of 108. The **22** files with no down are `0001`–`0015`, `0017`, `0018`, `0019`, `0020`, `0021`, `0027`, `0028` — the claim omits six (`0017`, `0018`, `0020`, `0021`, `0027`, `0028`) and stops the range at `0076`. | `Newer migrations ship a `.down.sql` partner (`0016`, `0022`–`0026`, and every migration `0029`–`0108`) — 86 downs for 108 forwards. The 22 without downs are `0001`–`0015`, `0017`, `0018`, `0019`, `0020`, `0021`, `0027` and `0028`.` | M |
| 358 | "All migrations **`0001`–`0076`** are applied … the ledger head is **`0076_…`** (verified 2026-07-08). **The inventory table below is catalogued through `0062`**" | `0001`–`0108`; head `0108_nominee_claims_seed` | `All migrations `0001`–`0108` are applied on the live Singapore project; the ledger head is `0108_nominee_claims_seed` (verified 2026-08-23). The inventory table below is still catalogued only through `0062` (+ an appended `0092` row).` | **H** |
| 428 | "**all 46 app RPCs** still executable by `authenticated`" | **87** functions carry `authenticated` EXECUTE | `all 87 functions reachable by `authenticated` still executable` | L |
| 428, 657 | "**only the 3 intended pre-login RPCs still anon-executable**" (with a parenthetical "plus every trigger function") | 13 functions are anon-EXECUTE: the 3 intended (`create_subscriber_from_signup`, `create_subscriber_from_employer_invite`, `get_employer_invite`) **+ 10 trigger functions** retaining the default PUBLIC grant. The parenthetical and the headline contradict each other. | `13 functions remain anon-EXECUTE: the 3 intended pre-login RPCs plus the 10 zero-arg `RETURNS trigger` functions that keep their default PUBLIC grant (`block_inactive_employer_*` ×3, `guard_mass_subscriber_detach`, `trg_branches_default_distributor`, `trg_distributors_enforce_editable_cols`, `trg_subscribers_after_insert`, `trg_subscribers_enforce_editable_cols`, `trg_transactions_contribution`, `trg_transactions_withdrawal`). Postgres refuses to call a trigger function directly, so the 10 are not an exploitable surface — but the number is 13, not 3.` | M |
| 441 | "⚠️ **Inventory gap.** Rows for **`0063`–`0091`** were never added to this table" | The gap now runs **`0063`–`0108`** (46 migrations), minus the appended `0092` row | `⚠️ **Inventory gap.** Rows for `0063`–`0108` were never added to this table (46 migrations; `0092` is appended above out of order). `0063`–`0076` are narrated as prose in §10; `0077`–`0091` and `0093`–`0108` are not documented in this file at all.` | M |
| 459 | "**29 tables** total on the live Singapore DB (`0001`–`0076` all applied — census verified 2026-07-08)" | 37 tables (`0001`–`0108`) | `37 tables total on the live Singapore DB (`0001`–`0108` all applied — census verified 2026-08-23)`. Add the 8 undocumented tables: `access_requests`, `custody_transfers`, `nav_snapshots`, `nominee_claims`, `entity_detach_log`, `entity_status_log`, `subscriber_balances_pre_nav`, `subscribers_unit_value_pre_nav`. | M |
| 565 | "The live Singapore DB now has **~90 policies**" | 109 | `The live Singapore DB now has 109 policies` | L |
| 625 | "`pg_proc` holds **53 functions in `public`** (verified live 2026-07-08)" | 89 distinct names / 89 OIDs — **zero overloads live** | `pg_proc holds 89 functions in public (verified live 2026-08-23) — 89 OIDs for 89 distinct names, i.e. **zero overloads**. 70 are SECURITY DEFINER and all 70 pin `search_path`. 20 names that appear in migration text (the `0021` commission run-model, dropped by `0029`) are NOT live and cannot be invoked by anyone.` | **H** |
| 653 | "`0075` … **re-scoping `distributors_select` off `USING(true)`** to any authenticated role (B5, closes an anon PII read)" | No policy named `distributors_select` exists. `0081` replaced it with `distributors_select_admin` (`app_role='admin'`) + `distributors_select_self` (`app_role='distributor' AND id = current_distributor_id()`). | `…re-scoping `distributors_select` off `USING(true)` (B5). ⚠️ Superseded: `0081` then dropped `distributors_select` entirely, splitting it into `distributors_select_admin` and `distributors_select_self`. No role other than admin and the owning distributor can read `distributors` today.` | M |
| 880 | "**`MOCK_NOW`** = `new Date(2026, 4, 26)` (= `2026-05-26`) at `src/data/mockData.js:25`. The wall-clock date is now past this (`2026-06-05`)" | `mockData.js:25` = `new Date(2026, 6, 1)` = 2026-07-01. Wall clock at audit time: 2026-08-24. | `**`MOCK_NOW`** = `new Date(2026, 6, 1)` (= `2026-07-01`) at `src/data/mockData.js:25`. The wall clock is past this again (2026-08-24). ⚠️ `scripts/seed-supabase.mjs:169` still hardcodes the previous anchor `new Date(2026, 4, 26)` despite a comment asserting it must mirror `mockData.js` — a 36-day drift that a reseed would bake into the ledger.` | **H** |
| 1013, 1015, 1019 | "Migration ledger — **live head `0076`**" (×3) | Head is `0108_nominee_claims_seed`; the ledger holds 96 TIMESTAMP-versioned rows and cannot be joined to the `0001_*` filenames | `Migration ledger — live head `0108_nominee_claims_seed` (version `20260811100047`), 96 rows. ⚠️ The ledger versions rows as timestamps while the files are named `0001_*`–`0108_*`; **the two namespaces share no key**, so a filename-prefix diff reports all 108 as "missing". Establish applied state by introspecting live objects, not by diffing versions.` | **H** |
| 1036 | "Covers **the 14 routes, the 21 RPCs**" | 16 routes; 89 live functions | `Covers the 16 routes, the live RPC surface (89 functions in `public`), and PostgREST reads.` | M |

---

## 5. `docs/FRONTEND.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 52 | "`npm test` \| Vitest one-shot (**1221 tests across 76 files** at last sync)" | 2010 tests / 140 files | `Vitest one-shot (2010 tests across 140 files, verified 2026-08-23)` | M |
| 74 | "All styling is CSS Modules (`.module.css` per component, **118 files**)" | 229 | `…(.module.css per component, 229 files)` | M |
| 301 | "three different "now"s … `_demo_now()` 2026-05-18, **JS `MOCK_NOW` 2026-05-26**, and the wall clock" | `MOCK_NOW` is 2026-07-01 | `…`_demo_now()` 2026-05-18, JS `MOCK_NOW` 2026-07-01, and the wall clock…` | M |
| 335 | "Verified on the new DB: **all ~90 policies** correct" | 109 | `Verified live 2026-08-23: all 109 policies correct (0 use `auth.uid()`, 0 read `->> 'role'`).` | L |
| 387 | "## 5. Services inventory (`src/services/` — **14 files**)" | 20 non-test files. Undocumented if the table lists 14: `accessRequests.js`, `adminAttention.js`, `nav.js`, `nomineeClaim.js`, `nomineeClaims.js`, `requestAccess.js` | `## 5. Services inventory (`src/services/` — 20 files)` and add rows for the six missing services. | M |
| 641 | "`MOCK_NOW` made a just-sent reminder read **"Reminded 1 Jul"**" | Consistent with the real 2026-07-01 anchor — and therefore **contradicts** :301 and :1412 in the same file | KEEP as-is; it is the only MOCK_NOW reference in this file that is correct. Fix :301 and :1412 to match it. | L |
| 717 | "## 7. Hooks inventory (`src/hooks/` — **10 files**; the table omits `useNotifications.js` + `useTickets.js`)" | 17 files | `## 7. Hooks inventory (`src/hooks/` — 17 files)` and add rows for `useAccessRequests`, `useAdminAttention`, `useNav`, `useNomineeClaims`, `useIsDesktop`, `useIsMobile`, `useCountUp`, `useDebouncedValue`, `useOutsideClick`. | M |
| 1138 | "### 15.1 `src/utils/` (**18 files**)" | 21 non-test files | `### 15.1 `src/utils/` (21 files)` | L |
| 1165 | "### 15.2 `src/constants/` (**3 files**)" | 7 non-test files (`claims`, `districts`, `levels`, `nudge`, `payment`, `savings`, `scopes`) | `### 15.2 `src/constants/` (7 files)` | M |
| 1412 | "**`MOCK_NOW = new Date(2026, 4, 26)`** … (**currently 2026-05-26 — synced with today**)" | 2026-07-01; and "synced with today" is false (today 2026-08-24) | `**`MOCK_NOW = new Date(2026, 6, 1)`** in `src/data/mockData.js:25` (2026-07-01 — NOT synced with the wall clock, which is 2026-08-24). Consumed by `commissions.js` and surfaced via `currentTime()`.` | **H** |
| 1519 | "**48 test files, 871 passing tests** at last sync" | 140 files / 2010 tests — and this **contradicts line 52 of the same document** (1221/76) | `140 test files, 2010 passing tests (verified 2026-08-23).` Then reconcile with line 52 so the file states one number. | M |

---

## 6. `docs/api-contracts.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 1 | Agent guide: "the **14** `api/` routes" | 16 | `the 16 api/ routes` | M |
| 7 | "**14 API routes** under `api/`" | 16 | `16 API routes under api/` | M |
| 9 | "PostgREST direct table reads governed by RLS (**no writes — writes always go through RPCs**)" | False. A02 reproduced **13 successful direct client writes** through PostgREST, incl. subscriber-authored `transactions` inserts. | `PostgREST direct table reads governed by row-level security policies. ⚠️ Writes are *intended* to go through RPCs only, but as of 2026-08-23 several tables still accept direct client writes — see `docs/audits/2026-08-23/02-rls-matrix.md` §5.` | **H** |
| 23 | "**All 14 API routes** return errors as JSON" | 16 | `All 16 API routes…` | M |
| 57 | "## 2. API routes (**14 total**)" | 16 | `## 2. API routes (16 total)` and add §2.3 entries for `POST /api/access-request` and `POST /api/nominee-claim` | M |
| 239 | Surface-inventory table: "API routes \| **14**" | 16 | `API routes | 16` | M |
| 240 | "Migrations \| **0001–0092** … **Applied state:** `0001`–`0091` are live (the tracked `supabase_migrations` ledger **stops at `0084`**; `0085`–`0091` were applied directly). ⚠️ **`0092_unified_contribution_config` is written but NOT yet applied — apply it out of band**" | **All three sub-claims are false and the ⚠️ is actively dangerous.** 108 files (`0001`–`0108`); all applied; ledger head is `0108_nominee_claims_seed`. `0092` IS live — `_normalize_contribution_config` and `get_my_employer_funding` both exist in `pg_proc`, and **0 of 8 `employers` rows carry a `mode` key** (0093 backfilled it out). Acting on the ⚠️ would re-run a migration against live demo data. | `Migrations \| 0001–0108 \| `supabase/migrations/*.sql`. **Applied state:** all 108 are live on the Singapore DB; the ledger head is `0108_nominee_claims_seed`. ⚠️ The ledger versions rows as TIMESTAMPS, not `0001_*` prefixes — do not attempt a version-level diff, and never run `supabase db push` against live.` | **H** |

---

## 7. `docs/data-model.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 5 | "This document **describes every entity in the system**" | 17 entity sections vs **37 live tables**. Twenty-one tables have no field-level entry: `subscriber_balances`, `transactions`, `withdrawals`, `claims`, `nominees`, `insurance_policies`, `subscriber_insurance_products`, `contribution_schedules`, `nav_snapshots`, `nominee_claims`, `custody_transfers`, `access_requests`, `agent_referrals`, `contact_submissions`, `demo_personas`, `money_nonces`, `entity_detach_log`, `entity_status_log`, `subscriber_signup_uploads`, `contribution_run_uploads`, `users`. | `This document describes the entities the dashboards render, their fields, relationships and business rules. ⚠️ It is NOT a complete table census — 21 of the 37 live tables have no field-level section here. For the authoritative column list use `information_schema.columns` or `docs/audits/2026-08-23/baseline/columns.csv`.` | M |
| 48–58 | Distributor field table | Omits the live column **`registration_no`** | Add: `| registrationNo | string | Stored | Company registration number (`registration_no`); populated by `approve_access_request` (`0095`) |` | L |
| 67 | "**Two distributors seeded** (was a singleton). The seed now ships **two** rows: `d-001` … and `d-002`" | Three: `d-001`, `d-002`, **`d-003` "Karamoja Pilot Network"** (all `status='active'`) | `Three distributors live (was a singleton). `d-001` "…— National", `d-002` "…— Secondary", and `d-003` "Karamoja Pilot Network" (created through the admin `create_distributor` RPC / access-request approval path).` | M |
| 69 | "**RLS.** Read-across-levels via **`distributors_select USING (true)`** (every authenticated role can read all distributor rows…)" | No such policy. Live: `distributors_select_admin` (admin) + `distributors_select_self` (owning distributor only) + `distributors_update_self`. A02-007 measured **0 rows** for subscriber / agent / branch / employer. | `**RLS.** `distributors_select_admin` (admin sees all) + `distributors_select_self` (`app_role='distributor' AND id = current_distributor_id()`). ⚠️ No subscriber / agent / branch / employer can read `distributors` at all — the "Operated by …" attribution surfaces this policy once served now resolve to nothing for those roles (A02-007).` | **H** |
| 190–208 | Subscriber field table lists `parentId`, `totalContributions`, `totalWithdrawals`, `registeredDate`, `productsHeld`, `contributionHistory` as the entity's fields | This is the **mock object shape**, not the table. Live `subscribers` has 25 columns; `parentId` and `totalWithdrawals` are not among them (the FK is `agent_id`), and the doc never mentions `dob`, `nin`, `occupation`, `district_id`, `is_demo_signup`, `insurance_same_as_pension`, `consent_at`, `last_contribution_date`, `current_unit_value`, `unit_value_as_of`, `created_at`. | Split the table into two columns of provenance — "DB column" vs "mock-object field" — and add the 11 missing DB columns. Re-label `parentId` as **Mock-only** (DB column is `agent_id`) and `totalWithdrawals` as **Derived / Mock-only**. | M |
| 241 | Employer section intro: "The Employer owns a **standalone** staff roster (`employees`) that sits **outside** the agent→subscriber hierarchy — employees are **NOT subscribers**, are not in `transactions`/`subscriber_balances`" | The retired pre-`0045` model, stated in the present tense at the top of the section and **contradicted by the doc's own banner 26 lines later (line 267)**. `employees` does not exist (`to_regclass` → NULL). | `> A B2B account (migration `0034`, unified by `0043`–`0045`). An employer's staff **ARE** subscribers — real `subscribers` rows tagged via `subscribers.employer_id`, riding the normal `transactions` ledger with `agent_id` NULL (no agent commission). The standalone `employees` table was dropped by `0045`. Scoped by the `employerId` JWT claim.` | **H** |
| 243–254 | Employer field table | Omits the live column **`status`** (added by `0060`; drives deactivate/reactivate) | Add: `| status | string | Stored | `'active'` \| `'inactive'` — flipped by `set_employer_status` (`0060`, reversible since `0080`). A deactivated employer cannot obtain a JWT, admit members, or submit runs. |` | M |
| 294 | "**RLS.** `employer_invites_self_select USING (…)`" | Live policy name is **`employer_invites_select_employer`** (plus `employer_invites_select_admin`) | `**RLS.** `employer_invites_select_employer USING (app_role='employer' AND employer_id = auth.jwt() ->> 'employerId')`, alongside `employer_invites_select_admin`.` | L |
| 406–417 | Contribution Run field table | Omits the live column **`insurance_total`** | Add: `| insuranceTotal | number | Stored | `insurance_total` — the group-insurance leg posted alongside the two pension legs (`0066`) |` | L |
| 428–447 | "## Contribution Run Line … The per-employee line inside a run (`contribution_run_lines`, migration `0034`). **Doubles as the employee's contribution ledger**" — present tense, **no HISTORICAL banner of its own** (unlike the Employee section at line 298) | Table dropped by `0045`; `to_regclass('public.contribution_run_lines')` → NULL | Prefix the section with the same banner the Employee section carries: `> **HISTORICAL (pre-`0045`).** `contribution_run_lines` was dropped by `0045`. Retained for provenance only — employer money now rides `transactions` (`source='employer'` + `contribution_run_id`).` | M |

---

## 8. `docs/role-permissions.md`

> This doc is the `expected` column A02 derived its 1,036-cell RLS matrix from. Five of
> its claims disagree with the measured live matrix, and two of those contradict other
> lines in the same document.

| Line | Claim | Reality (measured, `02-rls-matrix.md`) | Suggested replacement text | Sev |
|---|---|---|---|---|
| 38 | "All **~316** branches" | 321 | `All ~321 branches` | L |
| 40 | "All **~2,049** agents" | 2046 | `All ~2,046 agents` | L |
| 60–62 | "**Still platform-wide, pending `0084`:** `agents` / `branches` (single shared `*_select_authenticated` policy)" | `0084` **and** `0094` both shipped. No `agents_select_authenticated` / `branches_select_authenticated` policy exists. Live: one policy per role on each table + a RESTRICTIVE `*_scope_distributor` overlay. Measured reads: subscriber 1/1, agent 1/1, branch 5/1, d-001 1872/291, admin 2046/321, employer 0/0. | `**Closed by `0084` + `0094`.** The blanket `*_select_authenticated` policies are gone; `agents` and `branches` now carry one policy per role (admin / distributor / branch / agent / subscriber; employer has none), plus a RESTRICTIVE `*_scope_distributor` overlay as a second gate.` | M |
| 250 | "Writes go through the employer SECURITY DEFINER RPCs … **no client write policies**" | A02 measured **13 direct-write successes** across `transactions`, `insurance_policies`, `contribution_schedules`, `withdrawals`, `nominees`, `agents`, `branches`, `distributors` (A02-001 … A02-005) | Append: `⚠️ Measured 2026-08-23: this is the intent, not the enforced state. Thirteen direct client writes succeed against live RLS — see `docs/audits/2026-08-23/02-rls-matrix.md` §5.` | **H** |
| 315 | Admin "SELECT on the employer family (`employers`, `contribution_runs`, **`contribution_run_lines`**, `employer_invites`)" | `contribution_run_lines` was dropped by `0045` — as the *same document* states at line 211 | `…admin SELECT on the employer family (`employers`, `contribution_runs`, `employer_invites`).` | M |
| 340 | Scoping summary: "distributor \| **All entities, all levels**" | Own network only since `0081`. Contradicts line 49 of the same doc ("Visibility (since `0081`): its OWN network only"). Measured: d-001 sees 4605 of 5064 subscribers, 1872 of 2046 agents, 291 of 321 branches. | `distributor | Its OWN network only (`branches.distributor_id → agents.branch_id → subscribers.agent_id`); a subscriber with `agent_id IS NULL` belongs to no distributor | Own-network commissions | All 11 reports, network-scoped |` | **H** |
| 341–343 | branch / agent / subscriber each "(+ read-only of **the singleton `distributors` row**)" | Measured **0 rows** for all three (A02-007). `distributors` is readable only by admin and the owning distributor. | Delete the parentheticals and add a note: `⚠️ No role except admin and the owning distributor can read `distributors`. Any "Operated by …" attribution surface for branch / agent / subscriber / employer renders empty (A02-007).` | **H** |
| 348 | "**Distributor:** No scoping applied — all data visible." | Directly contradicted by line 49 of the same document and by the live policies | `**Distributor:** scoped to its own network by three SECURITY DEFINER helpers (`distributor_branch_ids()`, `distributor_agent_ids()`, `distributor_subscriber_ids()`) across 12 tables (`0081`–`0089`), plus RESTRICTIVE `*_scope_distributor` overlays on `agents`/`branches` (`0084`). Fails closed on a missing `distributorId` claim.` | **H** |
| 349 | "**All authenticated roles read `distributors`:** `distributors_select USING (true)`" | No such policy — see §7 row for `data-model.md:69` | `**Only admin and the owning distributor read `distributors`:** `distributors_select_admin` + `distributors_select_self` (`0081`).` | **H** |
| — | Document header has **no snapshot / verified-on date** — the only live doc with none | — | Add to the agent-guide block: `> Verified against the live Singapore DB on 2026-08-23. Re-verify counts and policy names before relying on them.` | L |

---

## 9. `docs/SPEC.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 84–91 | Hierarchy diagram `Country → Region → District → Branch → Agent → Subscriber` | Omits the **Distributor** level entirely. Ownership resolves `distributors → branches.distributor_id → agents.branch_id → subscribers.agent_id`; `CLAUDE.md §9` and `data-model.md` both place Distributor directly under Country. | Insert a `└── Distributor (3)` level between Country and Region, with a note that the distributor edge is an ownership edge (`branches.distributor_id`), not a geographic one. | M |
| 89, 107 | "Branch (**~316**)" | 321 | `Branch (~321)` | L |
| 90, 108 | "Agent (**~2,049**)" | 2046 | `Agent (~2,046)` | L |
| 91, 109 | "Subscriber (**~5,000**)" | 5064 — within the stated tolerance | KEEP | — |

---

## 10. `docs/render-operational.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 5 | Points at `/Users/shubhang/.claude/plans/dynamic-sparking-kite.md` and `/Users/shubhang/Desktop/renderaudit-findings.md` "for the full plan" / "the underlying audit findings" | **Both files are gone** (`ls` → No such file or directory). Two dead external references in the runbook's first paragraph. | Drop both paths, or replace with `see the 2026-08-23 audit set under `docs/audits/2026-08-23/` (A09 owns infra/deploy).` | L |
| 14 | "**Wake:** GHA cron (**14 min**) + cron-job.org/UptimeRobot (5 min backup)" | `keepalive.yml:12` is `*/10 * * * *` — every 10 min. The workflow's own header explains the 10-min choice. | `**Wake:** GHA cron (10 min) + cron-job.org/UptimeRobot (5 min backup) + frontend `useWarmup()` ping.` | L |
| 36 | "the live `schema_migrations` ledger is **missing 6 local migrations** (`0022`/`0023`/`0024`/`0025`/`0027`/`0028`)" | The ledger holds **96 TIMESTAMP-versioned rows** and shares **no key** with the `0001_*` filenames — it cannot be diffed by version at all, so "missing 6" is not a meaningful statement of the current state. | `⚠️ The live `schema_migrations` ledger versions rows as TIMESTAMPS (`20260605070446` … `20260811100047`) while the files are `0001_*`–`0108_*`. The two namespaces share no key, so the ledger cannot be diffed against the files by version. Apply schema via the Supabase MCP / `psql -f` path and never `supabase db push`.` | M |
| 38 | "**Re-enable the gated settlement E2E.** After applying `0032`, remove the `describe.fixme`/`skip` on `e2e/specs/flows/distributor-apply-settlement.spec.ts`" | `0032` has been live for months, but a `test.fixme` still stands at `e2e/specs/flows/distributor-apply-settlement.spec.ts:426` (the nonce-idempotency case). The instruction was never carried out. | `**Gated settlement E2E — still gated.** `0032` is applied, but `e2e/specs/flows/distributor-apply-settlement.spec.ts:426` still carries a `test.fixme` on the nonce-idempotency case. Either enable it or record why it stays disabled.` | M |
| 56, 175 | "The **14-min** GHA keepalive keeps the service warm for ~720 h/mo" | Cadence is 10 min; the 750 h/mo headroom arithmetic is derived from the wrong number | Recompute at 10 min and restate the headroom. | L |

---

## 11. `docs/migrations-runbook.md`

| Line | Claim | Reality | Suggested action | Sev |
|---|---|---|---|---|
| 1 | Agent guide already says: "Treat it as a **historical record**, not the current schema state (many later migrations have since shipped)" | Accurate and correctly scoped to the `0045`–`0057` cutover | **KEEP — no correction needed.** This is the model the other docs should copy. | — |

---

## 12. `.claude/skills/qa.md`

| Line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| 12 | "the suite has grown well past its original **~78-test baseline**" | **370 cases** across 4 Playwright projects: 326 pass / **30 fail** / 14 skip, 24.4 min, exit 1 (A00 §10) | `The suite is 370 cases across 4 projects (chromium, webkit, mobile-chromium, mobile-webkit). Measured 2026-08-23 at `--workers=1`: **326 passed / 30 failed / 14 skipped in 24.4 min, exit 1.** The 30 failures are deterministic, not flaky — see the known-bugs list below.` | **H** |
| 14 | flows list includes "**branch-create-agent** (live insert + cleanup)" | **No such spec exists.** `e2e/specs/flows/` holds 18 files and `branch-create-agent.spec.ts` is not among them. | Remove it. | M |
| 14, 149 | "**distributor-create-branch** (marked `test.fail`, see bug list)" / bug #2 "`handleConfirm()` (**line 253**) just calls `setSuccess(true)`; it **never invokes `useCreateBranch`**" | **Fixed.** `src/dashboard/branch/CreateBranch.jsx:155` calls `useCreateBranch()` and `:260` awaits `createBranch.mutateAsync({…})`; `handleConfirm` is at **:257**, not 253. There is **no `test.fail` anywhere** under `e2e/specs/` (only one `test.fixme`, at `distributor-apply-settlement.spec.ts:426`). | Delete bug #2 and the `test.fail` annotation; replace with `~~`CreateBranch` is a UI mock~~ — **FIXED.** `CreateBranch.jsx` now calls `useCreateBranch().mutateAsync` (`:155`, `:260`). The spec runs unmarked.` | **H** |
| 14 | flows list | Omits four live specs: `distributor-commission-drill-subscribers`, `distributor-renders-data`, `distributor-drill-agent-to-subscriber`, `distributor-drill-branch-to-subscriber` (18 total) | Add the four; state "18 flow specs". | M |
| 15 | "**`db/`** — … `invariants.spec.ts`, `money-idempotency.spec.ts`, and `rls-isolation.spec.ts`" (3) | 4 — `deactivate-entities.spec.ts` is undocumented | Add `deactivate-entities.spec.ts` (entity deactivate/reactivate journalling, `0060`/`0080`). | M |
| 16 | "`regression/` — … map-drill, modal-escape, **mobile drawer**, empty states, subscriber write-failures, settings stubs, subscriber payment methods, employer pending-KYC nudges" | No "mobile drawer" spec exists; the 8th file is `subscriber-insurance-no-scroll.spec.ts`, undocumented | Replace "mobile drawer" with `subscriber-insurance-no-scroll`. | M |
| 28 | "`/qa smoke` … **~45-60s**" | Not separately measured this run; the full suite is 24.4 min at `--workers=1` and the smoke layer alone spans 6 role dashboards × 4 projects | `Per-role smoke pass across all 6 role dashboards + landing + `_health`, on all 4 Playwright projects. Budget minutes, not seconds — the full suite is 24.4 min at `--workers=1`.` | M |
| 40 | "`/qa all` … Runs smoke + flows together (**~2 min total**)" | 24.4 min measured (`npx playwright test --workers=1`, all 4 projects) | `Runs the whole suite — smoke + flows + regression + db, on all 4 projects. ~24 min at `--workers=1`.` | **H** |
| 146–155 | Known-bugs list | Does **not** mention the 30 deterministic Playwright failures. `mobile-chromium` and `mobile-webkit` fail an identical set of 11 (`distributor-exports-csv:37,:141`; `landing:20,27,34`; `subscriber-dashboard:43,54,109,115,124,173`); `chromium` + `webkit` both fail `agent-onboard-subscriber:109` and `modal-escape:224`. | Add a section: `### Currently failing (measured 2026-08-23) — 30 of 370, deterministic. Two independent engines failing identical line numbers is a defect set, not contention. Screenshots are already on disk under `test-results/`. Full breakdown: `docs/audits/2026-08-23/00-baseline.md` §10.` | **H** |
| 152 | bug #5: "`due` isn't in `VALID_VIEWS` (**`src/agent-dashboard/pages/CommissionsPage.jsx:26`**)" | The claim holds (`VALID_VIEWS = new Set(['earned', 'owed'])`) but the location is wrong — `CommissionsPage.jsx:17` *imports* it; the definition is at **`src/agent-dashboard/pages/commissions/commissionsConfig.jsx:14`** | Update the path to `src/agent-dashboard/pages/commissions/commissionsConfig.jsx:14`. | L |
| 173 | "✅ **Phase 1** — Smoke specs (**44 tests across all 4 dashboards** + landing)" | 6 role dashboards (subscriber, agent, branch, distributor, employer, admin) + landing + `_health` | `✅ **Phase 1** — Smoke specs across all 6 role dashboards + landing + `_health`.` | M |
| 179 | Roadmap still lists "**Fixing the agent-onboard AML-step hang**" and "**Wiring the UI-mock `CreateBranch` panel** to `useCreateBranch`" as future work | Both resolved — the AML hang by the doc's own bug #4, and `CreateBranch` per the row above | Delete both from the roadmap; keep only `/qa explore` and `/qa screenshot-review`. | L |

---

## 13. In-code documentation comments (not `.md`, but load-bearing)

| File:line | Claim | Reality | Suggested replacement text | Sev |
|---|---|---|---|---|
| `server/index.ts:61` | "// **14 handler imports** — every handler exports a Vercel-shaped default." | 16 | `// 16 handler imports — …` | M |
| `server/index.ts:250` | "// ─── 9. **14 route mounts** (B5) — `app.all` is REQUIRED." | 16 | `// ─── 9. 16 route mounts (B5) — …` | M |
| `scripts/seed-supabase.mjs:166-169` | "// MOCK_NOW MUST mirror `src/data/mockData.js` (`new Date(2026, 4, 26)` = 2026-05-26)." + `const MOCK_NOW = new Date(2026, 4, 26)` | `mockData.js:25` is `new Date(2026, 6, 1)` = **2026-07-01**. The assertion in the comment is false and the constant has drifted 36 days. | Re-sync the constant to `new Date(2026, 6, 1)` and keep the comment, **or** import `MOCK_NOW` from `src/data/mockData.js` so the two cannot drift again. (Owner: seed/data agent — this is a code change, out of A26's remit.) | **H** |
| `e2e/specs/db/invariants.spec.ts:52` | "// Seed anchor — mirrors `MOCK_NOW = new Date(2026, 4, 26)` (2026-05-26)" | Stale mirror of the same constant | `// Seed anchor — mirrors MOCK_NOW = new Date(2026, 6, 1) (2026-07-01) in src/data/mockData.js` | M |

---

## 14. Cross-cutting: snapshot dates

Every live doc should carry one dated line under its agent-guide block. Today:

| Doc | Date marker present? |
|---|---|
| `docs/migrations-runbook.md` | ✅ self-marks historical, scoped to the `0045`–`0057` cutover — **the model to copy** |
| `docs/ARCHITECTURE.md` | ⚠️ partial — "pinned to a May 2026 post-cleanup snapshot" (honest, but the counts are quoted downstream anyway) |
| `docs/BACKEND.md` | ⚠️ inline only ("verified 2026-07-08"), no doc-level header date |
| `docs/FRONTEND.md` | ⚠️ inline only ("at last sync"), no date |
| `README.md` | ⚠️ warns counts "can lag the code" but gives no date |
| `CLAUDE.md`, `docs/SPEC.md`, `docs/data-model.md`, `docs/api-contracts.md`, `docs/render-operational.md`, `.claude/skills/qa.md` | ❌ none |
| `docs/role-permissions.md` | ❌ **none anywhere in the file** |

**Suggested one-liner for all twelve:**

```
> **Verified against the live Singapore DB (`ilkhfnoyxlxwqadebnkp`) on YYYY-MM-DD.**
> Counts (tables, functions, policies, migrations, routes, file inventories) decay fast —
> re-measure before relying on any number here.
```

## 15. Cross-cutting: archived audit docs

All 29 archived audit files under `docs/audits/{2026-04-distributor,2026-05-31,dashboard}/`
**already** carry a correct historical banner ("Historical audit from …, a point-in-time
snapshot, **not** current state"). **No action needed.** The gap is the other direction:
the new `docs/audits/2026-08-23/` set carries no such banner and will need one once it is
superseded. `docs/archive/api-contracts-2024-original.md` is correctly referenced as
archived from `api-contracts.md:1` and `:5`.
