# TRACEABILITY — every defined check → disposition

Assembled from each agent's own `## Traceability` section. Dispositions: PASS · FINDING <id> · 
BLOCKED <reason> · EXCLUDED-DEMO-SCOPE. This table is the completeness proof for Phases 1,2,5.
Phase 3/4 browser checks are tracked in the Coverage section of REPORT.md (not yet executed).


## 01-schema-migrations.md  (0 findings: none)

| # | Check | Disposition |
|---|---|---|
| 1 | Every table, column, type, default, NOT NULL, CHECK, FK, UNIQUE in the forward migrations exists live with the same definition — both directions | **PASS** — 38 relations, 382 columns, 94 constraints, 85 indexes reconciled in both directions; 0 unexplained differences. In-files-not-live = 4 tables + 3 indexes + 1 CHECK, all on tables explicitly dropped by `0029`/`0045`. Live-not-in-files = 15 columns on the two `CREATE TABLE AS` snapshots from `0105`, plus 0 tables, 0 indexes, 0 FKs, 0 CHECKs. Verified no DDL hides inside `DO` blocks. |
| 2 | Diff the latest migration body against live `pg_proc.prosrc` for every multi-defined function | **PASS** — 89/89 bodies diffed. 63 byte-identical, 25 token-identical (whitespace/comments only), 1 semantic difference (`apply_settlement`) fully explained by the dynamic `pg_get_functiondef` patch in `0051`. **0 unexplained divergences — the `0095`-clobbers-`0090` failure class does not recur.** Attributes (signature, RETURNS, language, volatility, SECURITY, `search_path`) reconciled separately; all differences trace to a later bare `ALTER FUNCTION`. |
| 3 | Enumerate `pg_proc` grouped by `proname` with >1 OID | **PASS** — 89 OIDs / 89 names, zero overloads. `create_distributor` (oid 29390, 6-arg) and `update_employer_profile` (oid 24885, 3-arg) each have exactly one OID. No finding manufactured. |
| 4 | Every DEFINER function has a pinned `search_path` in `proconfig` | **PASS** — 70 DEFINER, 70 with a pinned `search_path`, 0 violations. |
| 5 | Down-migration coverage: confirm the 22 pre-`0029` gaps; parse (never execute) the newest 10 downs and flag any that would not cleanly reverse | **FINDING A01-008** — 22 gaps confirmed (`0001`–`0015`, `0017`–`0021`, `0027`, `0028`), 0 orphan downs. The newest 10 downs are mechanically clean on all four hazards tested: 11/11 `DROP FUNCTION` signatures resolve live, 0 columns dropped that the forward never added, 0 tables dropped that the forward never created, 0 stale-body restores. `0101.down` and `0103.down` already carry explicit ⚠️ headers about their real risks. |
| 6 | The 8 policies stranded on dropped tables — confirm absent live and harmless | **PASS** — all 8 named (2 × `contribution_run_lines`, 1 × `employees`, 2 × `settlement_run_branch_reviews`, 3 × `settlement_runs`), all absent live because their tables are absent. 109 live policies, 0 live-not-in-files, 0 using `auth.uid()`, 0 using `->> 'role'`. |
| 7 | `entity_detach_log` / `entity_status_log`: determine EMPIRICALLY whether any path can read or write them as `authenticated` | **PASS** — proved by execution, not by config: `SET LOCAL ROLE authenticated; SELECT … ` → `ERROR: permission denied for table entity_detach_log` (and `entity_status_log`), same for `anon`. They are the only 2 of 35 base tables with no grant to either role. Missing `FORCE` is inert — the only beneficiary would be the owner `postgres`, which already carries `rolbypassrls`. |
| 8 | `nav_snapshots` created twice (`0096`, `0103`) — confirm identical shapes and a true no-op | **PASS** — the two `CREATE TABLE IF NOT EXISTS` blocks are identical apart from one trailing comment; the surrounding indexes, RLS `ENABLE`/`FORCE`, policy and grant are identical too, all `IF NOT EXISTS`/`DROP … IF EXISTS`-guarded. `0103.down` correctly refuses to drop the table. |
| 9 | Index health: unused, missing FK covering indexes, duplicates — structural analysis | **FINDING A01-005** (exact-duplicate unique index on `demo_personas`), **A01-006** (2 redundant prefix indexes), **A01-007** (3 FKs with no covering index). Explicitly declined to call any index "unused": `idx_scan` has been accumulating since the restore (max 107,674; 31/85 at zero), so a zero reading is not evidence. |
| 10 | The Postgres 11+ `ADD COLUMN … DEFAULT` stamping trap: find every pair and verify the data actually landed | **FINDING A01-002** — 22 candidates found (19 `ADD COLUMN … DEFAULT` + 3 `IS NULL`-keyed backfills), **0 confirmed no-ops**: `0096` documents the trap by name and keys on the stamped value; `0099` and `0060` add the column without a default. Live verification (`withdrawals` 4937/4937, `claims` 1907/1907, `claims.product` 1907 × `health`) confirms each landed. Extending the mandate to the other 16 top-level backfills found one that did **not** survive — `agents.coverage_rate`, 0 across all 2046 rows (A01-002) — and surfaced A01-001, A01-003 and A01-004 in the same live-data sweep. |
---

## 02-rls-matrix.md  (10 findings: A02-001, A02-002, A02-003, A02-004, A02-005, A02-006, A02-007, A02-008, A02-009, A02-010)

| # | Check (from spec) | Disposition |
|---|---|---|
| 1 | Build the full 925-cell matrix (6 roles × 37 tables × 4 ops + 37 anon SELECT); expected vs actual vs verdict; write to `baseline/rls-matrix.csv`; scripted | **PASS** — 1,036 cells written (925 required + 111 extra anon write cells); 1,011 PASS / 13 FAIL / 7 GAP / 5 N-A. The 13 FAILs are A02-001…A02-005; the 7 GAPs are A02-006 and A02-007. |
| 2 | Cross-tenant probes (d-001↔d-002, emp-001↔emp-002, a-001↔a-042, b-kam-015↔b-mba-290, s-0001↔s-0002) must each return zero rows, using real live IDs | **PASS** — 32 psql probes + 6 HTTP probes, all 0 rows; 6 positive controls non-zero, proving the harness. **0 leaks.** |
| 3 | Live `pg_policies` contains zero `auth.uid()` and zero `->> 'role'` | **PASS** — 0 and 0 of 109 policies, verified live. |
| 4 | Every table ENABLE + FORCE except the two known; confirm no third has appeared | **PASS** — 37/37 ENABLE, 35/37 FORCE; exactly `entity_detach_log` + `entity_status_log`, both with no `anon`/`authenticated` grant at all. |
| 5 | Direct-table INSERT/UPDATE probes as each role on every table; all should fail; roll back every probe | **FINDING A02-001, A02-002, A02-003, A02-004, A02-005** — 13 of 666 write cells succeed (all same-tenant; 0 cross-tenant). Every probe rolled back; 0 rows persisted. |
| 6 | The 8 RPC-internal ledgers unreachable as anon AND authenticated | **PASS** — 6 default-deny to `[]` (0 policies), 2 hard `permission denied` (no grant); all 7 principals, all 4 ops. |
| 7 | Column-level grants: `subscribers.{agent_id,employer_id,compensation,kyc_status,is_active,nin}` and `contribution_schedules.insurance_funding_mode` all rejected | **FINDING A02-003** — `subscribers` PASSES all 6 (column grant limited to `consent_at,email,name,occupation,phone`; rejected over psql *and* HTTP 403). `contribution_schedules.insurance_funding_mode` **is granted and succeeds**, together with `insurance_premium_accrued` / `insurance_premium_target` / `retirement_pct` / `emergency_pct`. |

## 03-privilege-surface.md  (7 findings: A03-001, A03-002, A03-003, A03-004, A03-005, A03-006, A03-007)

| Check | Disposition |
|---|---|
| 1. Evaluate anon EXECUTE for all 89; verify 13 = 3 grants + 10 triggers; report extras | **PASS** — exactly 13, zero extras; `0021` family absent |
| 2. Call all 13 as anon; prove 10 triggers raise "…only be called as triggers"; any anon work = CRITICAL | **PASS** — 10/10 raise; 3 grants work by design; unexpected anon work = 0 |
| 3. Confirm commission run-model unreachable; record dead 0021 text | **PASS** + **Info A03-005** (dead `0021_commission_rpcs_app_role.sql`, no `.down.sql`) |
| 4. Abuse the 3 intentional grants hard | **FINDING A03-001** (invite not phone-bound → cross-tenant re-tag + compensation overwrite) + **A03-002** (no phone canonicalization → login misroute) + **A03-003** (unbounded field size); **Info A03-007** (get_employer_invite existence oracle + 500-on-not-found) |
| 5. Sequence grants beyond the two explicit revokes | **PASS** + **Info A03-004** (2 ID seqs retain Supabase-default anon `rwU`; blast radius nil) |
| 6. `v_reconciliation_exceptions` unreachable by anon + authenticated | **PASS** — privileges + live 401 |
| 7. Bundle secret scan (dist/ + dist-server/), counts only | **PASS** — 0 service-role/JWT-secret values; only the public anon key + a scrub regex |
| 8. No blanket REVOKE SELECT FROM anon; RLS blast radius | **PASS** + **Info A03-006** (34 tables RLS-only; dropped-policy = deny, not leak) |

## 04-money-engine.md  (18 findings: A04-001, A04-002, A04-003, A04-004, A04-005, A04-006, A04-007, A04-008, A04-009, A04-010, A04-011, A04-012, A04-013, A04-014, A04-015, A04-016, A04-017, A04-018)

_(no explicit Traceability block parsed — see 04-money-engine.md in full)_

## 05-commission-settlement.md  (15 findings: A05-001, A05-002, A05-003, A05-004, A05-005, A05-006, A05-007, A05-008, A05-009, A05-010, A05-011, A05-012, A05-013, A05-014, A05-015)

_(no explicit Traceability block parsed — see 05-commission-settlement.md in full)_

## 06-data-integrity.md  (19 findings: A06-001, A06-002, A06-003, A06-004, A06-005, A06-006, A06-008, A06-009, A06-010, A06-011, A06-012, A06-013, A06-014, A06-015, A06-016, A06-017, A06-018, A06-019, A06-020)

_(no explicit Traceability block parsed — see 06-data-integrity.md in full)_

## 07-api-auth.md  (4 findings: A07-001, A07-002, A07-004, A07-003)

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

## 08-contract-conformance.md  (0 findings: none)

Every numbered check in the A08 spec, decomposed, with exactly one disposition.
| # | Check | Disposition |
|---|---|---|
| **1a** | Every `.rpc()` name exists among the 89 live | **PASS** (55/55) |
| **1b** | No call site references any of the 19 dropped `0021`-family names | **PASS** (0 hits outside one comment) |
| **1c** | Argument NAMES match `pg_get_function_identity_arguments` | **PASS** (0 unknown keys) |
| **1d** | Every non-defaulted parameter is supplied | **PASS** |
| **1e** | EXECUTE-able by the DB role that calls it (`anon` / `authenticated`) | **PASS** (3 pre-login sites ↔ the 3 intentional anon grants) |
| **1f** | PostgREST schema cache resolves each name (live probe, not just `pg_proc`) | **PASS** (55/55 PGRST202-resolved) |
| **1g** | In-function `app_role` gate matches the dashboard(s) that mount the hook | **PASS** (26 read RPCs executed as caller → all 200; write gates matched by source, matrix in §6) |
| **2a** | Every column in an inline `.select()` literal exists on that table | **PASS** (106 verified, 0 invalid) |
| **2b** | Constant-indirected selects resolved (`LEVEL_LIST_COLUMNS`, `MEMBER_SELECT`) | **PASS** |
| **2c** | Live HTTP probe of every resolvable select returns 200, not 400 | **PASS** (30/30 + 19 indirected) |
| **3a** | Every embed resolves to a real table via a real FK | **PASS** (18/18) |
| **3b** | `subscriber_balances` embeds name only its 6 real columns | **PASS** |
| **3c** | No embed ambiguity (no table with 2 FKs to one target) | **PASS** (30 FKs enumerated) |
| **4a** | `.eq/.in/.is/.not/.or` filter columns exist | **PASS** (56/56) |
| **4b** | `.order()` columns exist (live-probed) | **PASS** (14/14) |
| **4c** | Ordering on large tables is index-covered / cost-measured | **PASS** — `transactions` covered; `subscribers.registered_date`/`name` unindexed but only on the dead `getEntityPage` path (836 ms measured, < 8 s timeout) |
| **4d** | `.range()` / unbounded reads vs PostgREST `db-max-rows` | **FINDING A08-007** (info) **+ A08-009** (low) |
| **5a** | `docs/api-contracts.md` route count vs the real 16 | **FINDING A08-002** |
| **5b** | `server/index.ts:61` / `:250` "14" comments | **FINDING A08-003** |
| **5c** | Every frontend `/api/*` path maps to a mounted route | **PASS** (16/16) |
| **5d** | `docs/api-contracts.md` RPC coverage + signatures | **FINDING A08-002** |
| **5e** | `docs/api-contracts.md §4` "no direct PostgREST writes" claim | **FINDING A08-004** |
| **6a** | Read-RPC-backed services: live-measured shape ↔ mapper ↔ mock, field for field | **PASS** (26/26 — incl. `search_entities` `entity_id`→`id`, `get_branch_pending_contributions` snake→camel, `get_top_entities` `m:{}` block, `get_employer_metrics` 10/10 keys, `get_all_employers_metrics` 13/13 keys) |
| **6b** | Subscriber list path: mock money fields vs live | **FINDING A08-001** |
| **6c** | `createEmployer` mock vs live parameter set | **FINDING A08-005** |
| **7a** | Only `src/services/**` imports `src/data/mockData.js` | **PASS** (9 importers, 0 violations) |
| **7b** | A lint rule enforces the boundary | **FINDING A08-008** (info — prose only) |
**Excluded as demo-scope (2):**
1. `VITE_USE_SUPABASE=false` being a break-glass rollback rather than a demo default — prior audits
   (`docs/audits/2026-05-31/AUDIT_REPORT.md:377`) established this, and `.env.local.example:9` ships
   `true`. Mock-vs-live gaps are therefore reported only where the **live** side is wrong (A08-001)
   or where the divergence is a live functional gap (A08-005).
2. Mocked KYC / OTP / chat request-response shapes (`api/kyc/_lib/mocks.ts`) — deliberate per the
   audit brief; their client↔handler field contracts were still checked and match.
**Blocked: none.**
---

## 09-infra-deploy.md  (18 findings: A09-001, A09-002, A09-003, A09-004, A09-005, A09-006, A09-007, A09-008, A09-009, A09-010, A09-011, A09-012, A09-013, A09-014, A09-015, A09-016, A09-017, A09-018)

| Spec check | Sub-checks | Disposition |
|---|---|---|
| **1** Paused-DB failure mode | 1.1 keepalive targets `/healthz` | PASS (confirms the mechanism) |
| | 1.2 `/healthz` is I/O-free | **FINDING A09-001** |
| | 1.3 monitor stayed green through the outage | **FINDING A09-001** |
| | 1.4 measured cadence vs declared `*/10` | **FINDING A09-007** |
| | 1.5 quantify cold-open exposure | PASS (~120 s, 6 × 503 first) |
| | 1.6 `/readyz` does touch Postgres | PASS |
| **2** Render cold start | 2.1 `/healthz` TTFB | PASS (315 ms warm) |
| | 2.2 `/readyz` TTFB | PASS (512/172/168 ms) |
| | 2.3 does the instance spin down? | PASS (7-day unbroken memory series; cold start not forceable without taking prod down — stated, not guessed) |
| **3** CSP report-only | 3.1 enumerate origins fetched in prod | PASS |
| | 3.2 map origins against the policy | **FINDING A09-004** |
| | 3.3 inline scripts / event handlers | **FINDING A09-004** |
| | 3.4 `eval` / `new Function` in shipped chunks | PASS (0 of 135 chunks) |
| | 3.5 `blob:` / `data:` image sources | **FINDING A09-004** |
| | 3.6 `wss:` / Realtime exposure | PASS (no Realtime usage) |
| | 3.7 `report-uri` / `report-to` present | **FINDING A09-004** |
| | 3.8 produce the enforceable policy | PASS (§3.6 — reported, not applied) |
| **4** Headers served in production | 4.1 root · 4.2 deep link · 4.3 asset | PASS (all 6 present on all three) |
| | 4.4 Render API headers | **FINDING A09-017** (info) |
| **5** Env matrix | 5.1 `process.env` consumers | PASS |
| | 5.2 `import.meta.env` consumers | PASS |
| | 5.3 compare against `.env.local` names | **FINDING A09-014** |
| | 5.4 compare against example + `docs/BACKEND.md` | **FINDING A09-018** |
| | 5.5 verify Vercel prod carries `VITE_SENTRY_DSN` | **FINDING A09-005** |
| | 5.6 verify Render env var names | **BLOCKED** — Render MCP exposes only `update_environment_variables` (a write, forbidden by G1/G5); `get_service` omits `envVars`. `SENTRY_DSN` on Render unverified. |
| **6** Secret hygiene | 6.1 scan all blobs across all refs | PASS (0 hits / 4,603 blobs) |
| | 6.2 `.env.local` gitignored + untracked | PASS |
| **7** Sentry | 7.1 DSN gating both sides | **FINDING A09-005** (gating correct; frontend DSN never set) |
| | 7.2 `tracesSampleRate: 0.1` both | PASS |
| | 7.3 `sendDefaultPii: false` both | PASS |
| | 7.4 scrubber registered both | PASS |
| | 7.5 scrubber parity (13 keys + 3 regexes) | PASS (no drift) |
| **8** Rollback | 8.1 frontend (Vercel) documented? | **FINDING A09-009** |
| | 8.2 API (Render, manual) documented? | **FINDING A09-009** |
| | 8.3 migrations without `.down.sql` | **FINDING A09-009** (22: `0001`–`0015`, `0017`–`0021`, `0027`, `0028`) |
| | 8.4 down-migration hazards (parse only, G6) | PASS (14 `DROP TABLE`, 17 `DROP COLUMN`; ordering + `0092` money hazard already documented) |
| **9** CI | 9.1 §15-M1 guard exists | PASS (written, and defends a real skip pattern) |
| | 9.2 does it execute? | **FINDING A09-002** (41/41 skipped) |
| | 9.3 `npm ci --legacy-peer-deps` risk | **FINDING A09-011** |
| | 9.4 `build:api` skips `*.test.ts` | **FINDING A09-013** |
| | 9.5 no pre-commit hook | **FINDING A09-013** |
| | 9.6 does e2e gate the pipeline? | **FINDING A09-002** (no protection, no rulesets, Vercel auto-deploys) |
| **10** Dependencies | 10.1 dependabot config + open PRs | **FINDING A09-008** |
| | 10.2 dependabot alerts enabled? | **FINDING A09-008** (disabled) |
| | 10.3 3 criticals are devDependencies | PASS (stated plainly, not inflated) |
| | 10.4 12 highs — runtime reachability | PASS (none reachable; `body-parser` limit verified live with a 413) |
| **ALSO** `pg_stat` reset impact | planner statistics intact? | **FINDING A09-016** (info — the plan's premise corrected) |
---

## 22-state-errors.md  (7 findings: A22-001, A22-002, A22-003, A22-004, A22-005, A22-006, A22-007)

| Check | Disposition |
|---|---|
| 1 — Catalogue every query key; per-mutation DIRTIES vs INVALIDATES; every gap a finding | **FINDING A22-005** (matrix delivered above; 1 confirmed gap, rest PASS) |
| 2 — Optimistic rollback in useEntity/useSubscriber/useAgent restores state AND surfaces error | **PASS** (2 runtime-confirmed + 3 code-identical; error surfaced — leak noted as A22-004) |
| 3 — Cross-role cache bleed; AuthContext resets cache on logout — prove it | **FINDING A22-001** (logout PASSES; login does NOT → CRITICAL bleed) |
| 4 — Auth expiry: onAuthExpired / 401 / isJwtExpired → clean re-login not blank screen | **FINDING A22-003** (4a/4c PASS; 4b Supabase path FAILS) |
| 5 — Every write: force 500 / network / validation; silent failure on money write = CRITICAL | **PASS** (0 silent money-write failures; raw-string leak → A22-004) |
| 6 — ErrorBoundary/ErrorCard/Toast coverage; routes with no boundary | **FINDING A22-002** (boundaries PASS; read-error states FAIL on the hero) |
| 7 — 13 contexts: re-render fan-out / provider ordering / read outside provider | **PASS** |
| 8 — tickets.js in-memory: does a mid-demo refresh lose a just-created ticket | **FINDING A22-006** (reset is EXCLUDED-DEMO-SCOPE; visible loss reported) |
---

## 23-copy-language.md  (0 findings: none)

Every numbered check in the A23 spec, decomposed, each mapped to exactly one disposition.
| # | Check | Disposition |
|---|---|---|
| 1a | Extract every user-visible string from the JSX | **PASS** — 7,851 strings from 490 files, `docs/audits/2026-08-23/a23-extract-strings.mjs` + the broader second pass |
| 1b | Flag financial jargon | **FINDING A23-007** |
| 1c | Flag English idiom | **FINDING A23-012** |
| 1d | Flag acronyms | **FINDING A23-007** (KYC); "NIN" **EXCLUDED-DEMO-SCOPE** (standard Ugandan civil-ID term, not jargon) |
| 1e | Flag paragraphs where a number/picture would do | **FINDING A23-007** (§1 rows P1–P6) |
| 1f | Give a plain replacement for each | **PASS** — 62 replacements written in §1 |
| 1g | Prioritise money screens and error text | **FINDING A23-001** (money screens), **A23-004** (error text) |
| 2a | `'UGX '` hardcoded as a string instead of `Intl.NumberFormat` — list EVERY site | **FINDING A23-010** — full list in §2.1; `Intl.NumberFormat` is used **nowhere** |
| 2b | Inconsistent thousands separators | **PASS** — every path resolves to the same `,` grouping; verified in Chromium + WebKit |
| 2c | Inconsistent decimal handling | **FINDING A23-006** — 0 dp / 1 dp / 2 dp coexist; proven on screen |
| 3a | Verify the real `en-GB` count (spec predicted ~5) | **PASS** — exactly **5** non-test sites, all in `src/admin-dashboard/` |
| 3b | Verify the real `en-US` count (spec predicted ~2) | **FINDING A23-010** — **4**, not 2; the spec undercounted |
| 3c | Verify the real direct-`en-UG` bypass count (spec predicted ~7) | **FINDING A23-010** — **9**, not 7 |
| 3d | Show a rendered example of the divergence | **PASS** — §3.2, rendered in Node, Chromium and WebKit. **The divergence is zero today**; this corrects the spec's premise |
| 4a | Confirm no timezone constant exists | **PASS** — `Africa/Kampala` appears in **0** files |
| 4b | Find every date that could render a day off for a Kampala user | **FINDING A23-005** — 22 sites; §4 |
| 4c | Focus on date-only rendering of `timestamptz` | **FINDING A23-005** — proven end-to-end in a browser |
| 5a | Are raw codes ever shown to a user — prove it either way | **FINDING A23-002 / A23-003** — proven **YES**, twice, rendered |
| 5b | Grep the error-rendering path | **FINDING A23-004** — `src/services/api.js:229` + 85 `err?.message \|\|` sites + `ErrorCard.jsx:24` |
| 5c | `unexpected_error` / `not_ready` / `db_error` reachability | **PASS** — all 5xx codes are masked by `api.js` as "Server unavailable"; they never reach a user |
| 5d | DB-layer raw codes | **FINDING A23-004 / A23-009** — 17 bare snake_case `RAISE EXCEPTION` texts live |
| 6a | member / subscriber / saver | **FINDING A23-008** |
| 6b | agent / field agent · branch / branch admin · distributor | **PASS** — consistent enough; 4 "Field agent" vs 7 "field agent" is casing only, folded into A23-008 as a note |
| 6c | nominee / beneficiary (not in the spec list; found while checking 6a) | **FINDING A23-008** |
| 7 | Empty-state and loading copy — reassuring and specific, or generic? | **FINDING A23-011** |
| 8 | Absence of an i18n library | **EXCLUDED-DEMO-SCOPE** — recorded as INFO in §8, not raised as a defect, per the spec |
---

## 24-frontend-security.md  (11 findings: A24-001, A24-002, A24-003, A24-004, A24-005, A24-006, A24-011, A24-007, A24-008, A24-009, A24-010)

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

## 25-test-coverage.md  (13 findings: A25-004, A25-001, A25-002, A25-003, A25-005, A25-006, A25-007, A25-009, A25-011, A25-012, A25-008, A25-010, A25-013)

| Check | Description | Disposition |
|---|---|---|
| 1 | `test:coverage` actual % overall + per dir; rank untested modules; judge the 23%-statements-only threshold | FINDING A25-012 (coverage measured 32.94/28.95/27.49/34.26; threshold theater) |
| 2 | E2E route coverage matrix per role × viewport; % per role; zero-coverage routes | FINDING A25-002 (deliverable `a25/route-matrix.md`; admin mobile 0%, NAV panel 0%, subscriber `policies` 0%) |
| 3a | api/server/e2e `.ts` not linted | FINDING A25-006 |
| 3b | no typecheck script; tsc excludes `*.test.ts` | FINDING A25-007 |
| 3c | no stylelint / import-boundary / pre-commit | FINDING A25-008 |
| 3d | jsx-a11y forced to warn; no `--max-warnings` | FINDING A25-009 (+ A25-010 eslint scope leak) |
| 4 | Flake/determinism: reproduce vs baseline, classify real vs flaky | FINDING A25-001 (28/30 reproduced = deterministic) + A25-013 (1 true flake named) |
| 5 | Contract tests: which prove text not behaviour | FINDING A25-003 (4 tests, 25 assertions grep text) |
| 6 | Propose missing money invariant tests | FINDING A25-005 (M1–M12; M1/M2 violated live) |
| 7 | Mobile projects run only 7/38; note the 22/30 irony | FINDING A25-002 (confirmed `playwright.config.ts`) |
| 8 | CI §15-M1 guard catches all-skipped db specs | PASS (guard logic correct) + FINDING A25-011 (withheld from PRs) |
| Extra | Live fixture-leak discovered while probing M1 (not in spec checklist) | FINDING A25-004 |
**Checks passed (6):** measurement/deliverable checks that executed cleanly — coverage measurement
(1), untested-module ranking (part of 1), route-matrix deliverable (2), flake classification
executed & confirmed (4), money-invariant proposals produced (6), CI guard core-logic verified
correct (8). **Checks failed (10):** every check that surfaced a defect finding
(threshold, mobile coverage, 4 lint/type gaps, the red baseline, contract false-confidence, the
7/38 mobile gap, the PR guard gap). **Blocked: 0.**

## 26-documentation.md  (16 findings: A26-001, A26-002, A26-004, A26-003, A26-005, A26-006, A26-007, A26-008, A26-009, A26-010, A26-011, A26-012, A26-013, A26-014, A26-015, A26-016)

| Check | Disposition |
|---|---|
| 1 — verify every factual claim in the 12 live docs against `00-baseline.md`, incl. the 6 pre-flagged stale items and the 4 new baseline facts | **FINDING A26-001, A26-002, A26-003, A26-006, A26-007, A26-010, A26-011, A26-012, A26-014, A26-016** (all 6 pre-flagged items re-verified and confirmed; all 4 new facts located and corrected) |
| 2 — CLAUDE.md §4 hard rules and §5 anti-patterns versus enforcement reality; flag every rule with no mechanical enforcement | **FINDING A26-005** (12 of 13 unenforced, 1 half-enforced, 1 actively violated) |
| 3 — `docs/role-permissions.md` versus A02's measured matrix (`02-rls-matrix.md`) | **FINDING A26-004** (7 disagreements, 2 of them self-contradictions) |
| 4 — `docs/data-model.md` versus the live schema, field by field, using `baseline/columns.csv` | **FINDING A26-009** (9 field/entity divergences + a 21-table coverage gap) |
| 5 — which live docs need a snapshot date; which archived audit docs are superseded and should be marked historical | **FINDING A26-015** (dates) + **FINDING A26-013** (dead external refs). Archive half **PASS** — all 29 archived audit docs already carry a correct historical banner; no action needed |
| 6 — verify `.claude/skills/qa.md` is substantially outdated and list exactly what changed | **FINDING A26-008** (13 enumerated wrong claims) |
| 7 — produce `docs/audits/2026-08-23/DOC-CORRECTIONS.md` | **PASS** — 107 corrections drafted, not applied |
---

## 07-api-auth.md  (4 findings: A07-001..004) — run in-session, live probes executed

1 route input matrix → PASS (source) + live method/malformed/oversized PASS
2 rate limits + XFF spoof → FINDING A07-004 (live-proven local; prod mitigated)
3 JWT model → PASS (8/8 forgeries rejected live)
4 enumeration → PASS (not enumerable)
5 change-password gating → PASS
6 agent-referral unauth write → FINDING A07-002
7 stored-XSS source → handed to A24; 8 chat leak → PASS (no DB access)
9 Sentry scrub → FINDING A07-001 (NIN gap); 10 helmet/CORS → FINDING A07-003 (Info)
11 health endpoints → PASS
---
## Phase 3 — role walkthroughs (A10–A16)
Each role: signed in via real UI, visited every route in its table, reconciled on-screen numbers vs
direct SQL, forced empty/error states, screenshotted at 375/1440px. All 7 reports present
(10-subscriber … 16-public-onboarding). Findings dispositioned in FINDINGS.md.
- A10 subscriber → A24-001(C), A10-001(H), A06-004, A22-004, A10-002 + more
- A11 agent → A11-001(C), A11-002(C onboarding-blocked), A11-005(H) + more
- A12 branch → clock-drift, gender-donut count, route-parity gaps
- A13 distributor → A13-001(H) confirms the pre-registered reports Critical at runtime
- A14 employer → A14-002(C), A14-001(H two irreconcilable totals)
- A15 admin → A15-001(H mobile detail shows —), A22-001 source figure, reconciliation junk
- A16 public → landing FAQ/Contact/About mobile heading gaps; invite-binding (A03-001)

## Phase 4 — frontend quality (A17–A21)
- A17 design system → circular avatars, 519 sub-12px sizes, 5×BottomSheet, cross-role inconsistency
- A18 mobile/PWA → manifest gaps, no offline queue, touch-targets, 769–1023 band
- A19 desktop shells → unrouted distributor/admin state, focus-trap absence in 19 dialogs
- A20 accessibility → axe sweep (spec written+deleted), jsx-a11y backlog by rule, contrast
- A21 performance → bundle weights (xlsx 500KB), lazy boundaries, query staleness
All Phase 4 findings are Medium/Low/Info (0 C/H).
