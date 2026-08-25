# A26 doc-census — re-measured 2026-08-25 (P7-docs-census)

Every number below was produced by a command run **today, during this pass** — not copied
from `findings.json` or from any prior doc edit. This programme has kept shipping migrations
and tests while this agent worked; several numbers below drifted a second time *within the
same working session* (noted where it happened). Treat every bare number here as "true at the
timestamp given," not as a permanent fact — that is also the framing pushed into the docs
themselves.

Live Supabase project: `ilkhfnoyxlxwqadebnkp` (`ap-southeast-1`). Repo:
`/Users/shubhang/Desktop/Projects/uganda-dashboard`, branch `remediation/audit-2026-08-23`.

---

## A26-006 — schema/architecture census (`ARCHITECTURE.md`, `BACKEND.md`)

Command (run ~08:50 UTC 2026-08-25):

```sql
SELECT 'tables', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'fn_names', count(DISTINCT proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
UNION ALL SELECT 'definer', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
UNION ALL SELECT 'invoker', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT p.prosecdef
UNION ALL SELECT 'policies', count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'triggers', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
UNION ALL SELECT 'authenticated_executable', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
```

| Metric | Doc claimed (before this pass) | True (measured 2026-08-25, ~08:50 UTC) |
|---|---|---|
| Tables (public, `relkind='r'`) | 37 (ARCHITECTURE.md:83, BACKEND.md:39/46, data-model.md:7) | **47** |
| Distinct function names (public) | 89 | **99** |
| SECURITY DEFINER functions | 70 | **76** |
| INVOKER functions | 19 | **23** |
| RLS policies (public) | 109 | **106** |
| Non-internal triggers (public) | 10 | **14** |
| Functions executable by `authenticated` | not stated as a bare number in the docs | 79 (new datapoint, not previously in either doc) |

Context for the drop in policy count (109→106) despite a rising table count: several
migrations applied *since* the 106-vs-109 baseline consolidate/close grants rather than add
policies (e.g. `0128_revoke_identity_and_trigger_execute`, `0131_purge_e2e_branches`,
`0132_secure_nav_rollback_and_universal_rls_guard` — the last of which found and RLS-secured
one table, `nav_fixture_rollback_0117`, that had **zero policies and RLS disabled**, per that
migration's own header).

**Command volatility observed live, within this one working session:** the live migrations
ledger row count moved 96 → 99 → 100 → 100 (stable) across roughly 25 minutes of this agent's
own measurements, because other remediation agents were applying migrations concurrently
(`0127`, `0128`, `0131`, `0132` all landed live today). The table/function/policy/trigger
counts above are a single consistent snapshot from one query batch; do not assume they are
still current by the time this file is read — re-run the query above.

**File-tree counts** (not live-DB, but equally re-measured):

| Metric | Command | Doc claimed | True (2026-08-25) |
|---|---|---|---|
| Forward migration files on disk | `ls supabase/migrations/*.sql \| grep -v '\.down\.sql' \| wc -l` | 108 (audit) → 120 (last doc pass) | **129** (grew to 129 mid-session when `0132` was authored) |
| Dashboard shell directories | `ls -d src/*dashboard* src/dashboard` | 4 → 6 | **6** (`admin-dashboard`, `agent-dashboard`, `branch-dashboard`, `dashboard` [distributor], `employer-dashboard`, `subscriber-dashboard`) — confirmed unchanged |
| `src/services/*.js` (non-test) | `ls src/services/*.js \| grep -v test \| wc -l` | 20 (already correct in FRONTEND.md body) | **20** — unchanged, confirmed |
| `src/hooks/*.js` (non-test) | `ls src/hooks/*.js \| grep -v test \| wc -l` | 18 (already correct in FRONTEND.md body) | **18** — unchanged, confirmed (19 raw files, 1 is `*.test.js`) |
| `src/utils/*.js` (non-test) | `ls src/utils/*.js \| grep -v test \| wc -l` | — | 22 |
| `src/constants/*.js` (non-test) | `ls src/constants/*.js \| grep -v test \| wc -l` | — | 8 (includes the new `demoClock.js`) |
| `*.module.css` | `find src -name '*.module.css' \| wc -l` | 118 (audit) → 230 (last doc pass) | **230** — unchanged, confirmed accurate |
| `src/contexts/*.jsx` | `ls src/contexts/*.jsx \| wc -l` | 10 documented (body) / 8 (TOC) | 15 raw (13 non-test) — **not re-derived as the doc's authoritative figure this pass** (methodology unclear — the doc's 10 may exclude `createScopeContext.jsx`, a factory, not a context; out of this finding's cited locations). Only the **TOC-vs-heading self-contradiction** is fixed this pass, not the count itself. |

Unit-test suite (`npx vitest run --silent`, run 2026-08-25 as the verification-gate baseline):

```
Test Files  1 failed | 183 passed (184)
     Tests  1 failed | 4455 passed (4456)
```

Doc claimed "2195 tests across 151 files (2192/2195 passing; 2 files/3 tests fail in
`deriveBranchAnalytics.test.js`)" — **true count is 4456 tests / 184 files, 4455 passing.**
The one failing test is now `src/services/__tests__/search.test.js` ("real and mock branches
produce the same field names on a hit") — `deriveBranchAnalytics.test.js` is not failing
today. This is a **pre-existing failure, not caused by this pass** — `search.js` is outside
this agent's write-set. Confirmed identical before/after this agent's edits (see Verification
Gate below).

---

## A26-007 — migration ledger head

⚠️ Per instruction: established via `mcp__supabase__list_migrations` (project
`ilkhfnoyxlxwqadebnkp`), **not** the highest local filename.

Three separate calls during this pass, to capture the drift as it happened:

| Time (approx, UTC) | Ledger row count | Head (by version/timestamp) |
|---|---|---|
| ~08:52 | 99 | `20260825065644 revoke_identity_and_trigger_execute` |
| ~08:56 (direct `count(*)` SQL) | 100 | — |
| ~09:20 (final, this section's source of truth) | **100** | **`20260825084906 secure_nav_rollback_and_universal_rls_guard`** |

The head row's `name` field carries **no numeric prefix** — this is now the norm, not the
exception, for anything applied after `0108`. Matched against local files by content (the
`name` strips or never carried the `00NN_` prefix at push time; the local file was later
renumbered), the true applied head is **`0132_secure_nav_rollback_and_universal_rls_guard`**,
applied **today, 2026-08-25**.

### Applied vs authored-not-applied, `0109`–`0132` (fuzzy-matched live ledger ↔ local filename by content slug, cross-checked against each file's own header where one exists)

| Migration | Applied live? | Evidence |
|---|---|---|
| `0109`–`0121` | **NOT applied** | No matching ledger row (content-slug join); independently corroborated by `ESCALATIONS.md` U1 ("0109–0113 and Phase 3's 0114–0121 are authored and dry-run proven but NOT applied. Three attempts via psql were blocked by the environment's classifier"). `0116`/`0117` each contain a live `RAISE EXCEPTION 'ABORT: 0114/0116 has not been applied'` guard, consistent with the chain never having run. |
| `0122_repair_orphan_login_identity` | **Effect is live; the migration file itself is NOT in the tracked ledger** | No ledger row matches. But `SELECT entity_id, password_hash IS NOT NULL FROM public.users WHERE id='subscriber:+256701231323'` returns `entity_id='s-100117', has_password=true` — exactly the post-repair state the file's own verification block asserts. Applied out-of-band (same established pattern as `0072`/`0074` per `BACKEND.md`'s own §16 history), not through the tracked migration mechanism. |
| `0126_demo_clock` | **NOT applied** | No ledger match. File's own header says "NOT YET APPLIED to the live project — authored + dry-run verified only." Confirmed live: `public._demo_now()` still resolves to `2026-05-18` territory (the pre-0126 value), not `2026-07-01`. |
| `0127_secure_snapshot_tables` | **Applied** | Ledger row `secure_snapshot_tables`, version `20260825064701`. |
| `0128_revoke_identity_and_trigger_execute` | **Applied** | Ledger row exact-name match, version `20260825065644`. |
| `0129_perf_indexes` | **NOT applied — authored only** | No ledger match. |
| `0130_rls_policy_consolidation` | **NOT applied — deliberately withheld** | No ledger match. `ESCALATIONS.md` "Phase 6 remainder" section: disposition **EXCLUDE upheld** — proven safe and 31% faster in testing, but "not worth it: 6-11 ms behind a ~93 ms Singapore round trip, against a cross-tenant PII disclosure if one `CASE` branch is subtly wrong. ... `0130` is authored and reversible so this can be revisited with evidence." Kept in the tree, not recommended for application as-is. |
| `0131_purge_e2e_branches` | **Applied** | Ledger row exact-name match, version `20260825084508` (today). |
| `0132_secure_nav_rollback_and_universal_rls_guard` | **Applied** | Ledger row exact-name match, version `20260825084906` (today, ~4 min after 0131). |

**Structural unjoinability — sharper than the audit found.** The original audit's framing
("timestamp-versioned ledger, shares no key with `0001_*` filenames") is confirmed and is now
demonstrably *worse*: this pass found live-ledger rows whose `name` carries **no numeric
prefix at all** even when a same-content local file has one (e.g. local
`0131_purge_e2e_branches.sql` ↔ live name `purge_e2e_branches`), migrations applied
**out of numeric order** (`0045_retire_employees` applied live *after* `0049`–`0051`, by
timestamp), a local numbering **collision** (two unrelated local files both begin `0066_`:
`0066_run_insurance_leg.sql` and `0066_branch_pending_contributions.sql`, both live, at
different timestamps), and — most consequential for anyone repairing data — **at least one
migration (`0122`) whose live effect exists with no ledger row whatsoever**, confirming that
"no ledger row" does not mean "not applied" and "has a ledger row" is the only thing that
means "applied."

---

## A26-008 — `.claude/skills/qa.md`

The file was already substantially corrected by an earlier pass today (2026-08-25) — its own
header already carries "Spec inventory verified against the `e2e/specs/` tree on 2026-08-25;
runtime/pass-fail figures are the 2026-08-23 audit measurement... re-run `/qa fix` before
trusting the failure list below if time has passed." Re-verified structural claims against the
tree as it stands now:

| Check | Command | qa.md claim (pre-this-pass) | True now |
|---|---|---|---|
| `flows/` count | `ls e2e/specs/flows/*.spec.ts \| wc -l` | 18 | **18** — confirmed, unchanged |
| `db/` count | `ls e2e/specs/db/*.spec.ts \| wc -l` | 4 (`invariants`, `money-idempotency`, `rls-isolation`, `deactivate-entities`) | **5** — `function-deployment-contract.spec.ts` exists on disk, mtime 2026-08-25 12:59, added since the "4" was last verified. Not yet reflected anywhere in qa.md. |
| `regression/` count | `ls e2e/specs/regression/*.spec.ts \| wc -l` | 8 | **8** — confirmed, unchanged |
| `smoke/` count | `ls e2e/specs/smoke/*.spec.ts \| wc -l` | 8 (original), doc text says "one file per role + landing + `_health`" | **11 on disk right now**: the 8 original + `landing-nav-band.spec.ts` (tracked) + `admin-dashboard-mobile.spec.ts` + `branch-dashboard-mobile.spec.ts` (both **untracked**, `git status --porcelain` shows `??` — live WIP from a concurrent mobile-focused agent, may not be finished). Documented with a caveat rather than a hard-committed enumeration, since two of the three new files are not yet committed. |
| `test.fail()` anywhere in `e2e/specs/` | `grep -rn 'test\.fail' e2e/specs/` | "no `test.fail()` exists" | Confirmed — still zero real hits (only a comment string containing "on test failure"). |
| `CreateBranch.jsx` bug #2 | `grep -n 'handleConfirm\|mutateAsync' src/dashboard/branch/CreateBranch.jsx` | FIXED, handleConfirm:257 calls mutateAsync:260 | Confirmed unchanged and correct. |
| `VALID_VIEWS` location (bug #5) | `grep -rn 'VALID_VIEWS =' src/agent-dashboard/` | `commissionsConfig.jsx:14` | Confirmed unchanged and correct. |

Residual defect found and fixed this pass: the "Known product bugs" list in qa.md has **two
items both numbered `6.`** (the "Currently failing... 30 of 370" paragraph, and the
`/dashboard/reports/contributions` `REPORT_VIEWS` item) — a plain numbering bug, mechanical
fix (renumber the second to `7.`).

Runtime/pass-fail figures (`~24 min`, `370 cases`, `326/30/14`): **not independently
re-run this pass.** A full `--workers=1` run takes ~24 minutes and the E2E project is a shared
fixture-ID database that a concurrent `e2e/**`-owning agent may be actively writing to
(`ESCALATIONS.md` E7 documents a prior real collision: "already produced 4 leaked live rows
during verification" from exactly this kind of concurrent run). Since this agent does not own
`e2e/**` and re-running the full suite is outside this finding's requirement to fix
*documentation*, the qa.md text already correctly defers to "re-run `/qa fix` before trusting
the failure list below if time has passed" — that framing is kept and slightly strengthened
rather than replaced with a number this agent did not itself produce by running the suite.

---

## A26-009 — `docs/data-model.md`

This document had already been extensively corrected earlier today (2026-08-25) — every
specific defect the finding cites (Employer section rewritten off the retired standalone-model
present tense at :246, `employers.status` documented at :259, `employer_invites` policy name
corrected at :300, `distributors` RLS corrected at :72, `contribution_runs.insurance_total`
documented at :422, `distributors.registration_no` documented at :56, Contribution Run Line
given a HISTORICAL banner at :437) carries an inline "corrected 2026-08-25" or "undocumented
here until now" marker and was spot-checked against the same live queries used for A26-006/010
above — all confirmed still accurate:

```sql
-- employer_invites / employers / distributors policy names
SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('employers','employer_invites','distributors') ORDER BY 1,2;
```

Result: `employer_invites_select_admin`, `employer_invites_select_employer`,
`employer_self_select`, `employers_select_admin`, `distributors_select_admin`,
`distributors_select_self`, `distributors_update_self` — **matches the doc exactly.**

```sql
SELECT to_regclass('public.employees'), to_regclass('public.contribution_run_lines');
-- both NULL — matches the doc's "dropped by 0045" claim.
```

The only residual staleness: the document's own top-of-file scope disclaimer (line 7) still
says "the live database has 37 tables" — stale by the same table-count drift documented under
A26-006 (37→47 live now). Updated to 47, with the "N tables have no field-level entry" count
adjusted from 21 to 30 (47 total − 17 documented = 30).

---

## A26-010 — "14 API routes"

```sh
$ grep -c '^app\.all' server/index.ts
16
$ find api -name '*.ts' -not -name '*.test.ts' -not -path '*/_lib/*' | wc -l
16
```

Confirmed: **16 routes**, unchanged since the audit. Grepped every occurrence in this agent's
write-set plus the finding's other cited locations:

| Location | In this agent's write-set? | Current state |
|---|---|---|
| `README.md:18,109` | No | Already says "16 routes" — already fixed by an earlier pass |
| `docs/api-contracts.md:1,7,23,57,239` | No | Already says "16 API routes" — already fixed |
| `docs/ARCHITECTURE.md:546` | **Yes** | Already says "all 16 routes" — already fixed, nothing to do |
| `docs/BACKEND.md:105,137,138,291,1046` | **Yes** | Already says "16 routes" throughout — already fixed. `:1046`'s function-surface figure ("89 functions... as of 2026-08-25") is stale per A26-006 and is corrected to 99 as part of the A26-006/007 BACKEND.md edit. |
| `server/index.ts:406` (comment `// ─── 9. 14 route mounts (B5)`) | No (outside write-set; also this is a section-header numbering artifact, not a route-count claim — verified the "14" here is a residual finding-ID digit, not a live route count, since the surrounding routes list (lines 411–426) is 16 long and correctly commented) | Escalated, not edited |

No occurrence of the stale "14" was found in `docs/role-permissions.md` during this pass —
that file is owned by the concurrent `P7-rls-doc-truth` agent and was not opened by this agent
beyond a `grep` for "14 route" (zero hits at the time of this check). Escalating anyway per
instruction, since the finding's location list names it and this agent must not touch it.

**Nothing in this agent's write-set needed a change for A26-010** — it was already closed by
an earlier pass. Recorded here as a verified-closed, not a no-op skip.

---

## A26-011 — `docs/FRONTEND.md` file-inventory counts

| Location | Claim before this pass | True now | Fix |
|---|---|---|---|
| TOC `§5` (line 19) | "Services inventory ... 11 files" | Body (§5 heading, line 389) already says "20 files, verified 2026-08-25" — confirmed accurate (20) | TOC contradicted the body. Root cause: the heading text (which the TOC anchor-link is generated from) was updated without updating the TOC's link fragment, likely **breaking the anchor** too. Fixed by removing the embedded, driftable count from **both** the heading and the TOC entry (count now lives only in body prose, which already carries a "verified <date>, re-measure" stamp) — this also makes the anchor permanently stable. |
| TOC `§6` (line 20) | "Contexts inventory (8 in ..., 1 in ...)" | Body (line 672) says "10 in `src/contexts/`, 1 in `src/signup/`" | Same TOC/heading mismatch, same structural fix (strip the count from both, anchor becomes stable). Count itself not re-derived this pass (see A26-006 table — methodology ambiguous, not one of this finding's originally cited locations). |
| TOC `§7` (line 21) | "Hooks inventory ... 9 files" | Body (line 721) already says "18 files as of 2026-08-25" — confirmed accurate (18 non-test / 19 raw incl. one `*.test.js`) | Same structural fix. |
| `docs/FRONTEND.md:52` (now `:54`) | "2195 tests across 151 files ... 2192/2195 passing ... fail in `deriveBranchAnalytics.test.js`" | **4456 tests / 184 files, 4455 passing.** Failing test is now `search.test.js`, not `deriveBranchAnalytics.test.js`. | Updated to the fresh `npx vitest run` numbers with today's date stamp. |
| `docs/FRONTEND.md:1519` (now `:15xx`, see edit) | "48 test files, 871 passing tests at last sync" | Same true figure as above (4456/184/4455) | Reconciled to the SAME number as the `:54` occurrence — the doc's self-contradiction (two different wrong numbers for the same fact) is the literal defect A26-011 names; both are now the one true figure. |
| `docs/FRONTEND.md` CSS module count (`:74`→`:76`) | 118 (audit) → already corrected to "230 files as of 2026-08-25" | **230** — confirmed unchanged, no edit needed | — |

---

## E22 — comment-only stale clock mentions

| File | Real path | In write-set? | Finding |
|---|---|---|---|
| `adminAttentionDerive.js:11-16` | `src/admin-dashboard/overview/adminAttentionDerive.js` (verified via `find`) | **No — lives inside `src/admin-dashboard/**`, a concurrent agent's exclusive tree.** | **ESCALATED, not edited.** Comment at lines 11-14 reads: "There are three different 'now's in this codebase — `public._demo_now()` (2026-05-18, anchors the seeded charts), JS `MOCK_NOW` (2026-05-26) and the real wall clock." The `(2026-05-26)` is stale — true value is `2026-07-01` (`src/constants/demoClock.js`). Comment-only, no runtime effect, exactly as E22 describes. |
| `employerSeed.js:14` | `src/data/employerSeed.js` (NOT `src/services/employerSeed.js` as guessed in the brief) | Yes — `src/data/**` is not on any concurrent agent's exclusion list | **Fixed.** Was: "Dates anchor to `MOCK_NOW` (2026-05-26) for demo stability." Now states the correct value and its source. |
| `adminAttention.js:19` | `src/services/adminAttention.js` (NOT `src/utils/adminAttention.js` as guessed) | Yes — `src/services/**` is not excluded | **Fixed.** The clock-warning comment's substance (never re-derive "days late" client-side) was fine; its framing ("public._demo_now() ... and JS MOCK_NOW is a third clock again") predates the `demoClock.js` unification and now reads as if MOCK_NOW is still one of several independently-drifting clocks. Reworded to name the single canonical JS anchor and the still-unapplied SQL migration. |

---

## E24 — stale `2026-05-26` demo-clock literal

Migration `0126_demo_clock.sql` (authored) plus the new `src/constants/demoClock.js` unify the
**JS-side** anchor at `MOCK_NOW = new Date(2026, 6, 1)` (**2026-07-01**). Verified directly:

```sh
$ grep -n "MOCK_NOW" scripts/seed-supabase.mjs | head -1
88:const { MOCK_NOW } = await import('../src/constants/demoClock.js');
$ grep -n "MOCK_NOW_ISO_DATE" e2e/specs/db/invariants.spec.ts | head -1
73:import { MOCK_NOW_ISO_DATE } from '../../../src/constants/demoClock.js';
```

Both files **now import the shared anchor** — neither hardcodes `2026-05-26` any more. This
makes the claim common to all four cited locations ("`scripts/seed-supabase.mjs:169` still
hardcodes ... and `e2e/specs/db/invariants.spec.ts:52` documents the same stale anchor")
**false** as written. The **SQL-side** clock (`public._demo_now()`) is a separate, genuinely
still-open item: migration `0126` that would bring it to `2026-07-01` is authored and
dry-run-verified but **NOT applied** (confirmed — no matching live ledger row; see A26-007
above), so `public._demo_now()` still returns its pre-0126 value live.

| Location | Cited line (brief) | Actual current line | Fix |
|---|---|---|---|
| `CLAUDE.md` | :201 | **:205** (drifted +4 lines from other edits) | Rewritten: JS side unified via `demoClock.js`; SQL side still pending `0126`. |
| `docs/BACKEND.md` | :880 | **:888** (drifted +8 lines) | Same rewrite. |
| `docs/FRONTEND.md` | :301 | **:303** — already correctly says "corrected 2026-08-25" for the `MOCK_NOW` value itself | No change needed here (already accurate). |
| `docs/FRONTEND.md` | :1412 | **:1429** — MOCK_NOW value itself already correct, but the **trailing sentence** ("Two other copies have drifted ... both still hardcode the old `2026-05-26` anchor") is the actually-false remainder | Trailing sentence rewritten to reflect the `demoClock.js` unification + the still-pending SQL side. |

---

## E26 — `PolicyChips.jsx` doc comment

Real path: `src/agent-dashboard/pages/subscriber/PolicyChips.jsx` (not under
`src/components/**` as the brief guessed — verified via `find`, and confirmed
`src/agent-dashboard/**` is not on the concurrent-agent exclusion list, so this file is in
scope to edit).

Comment (lines 7-9) claims: "The service (`services/agent.js`) already filters
`subscriber.policies` to active products (life / health / funeral); each entry is
`{ product, status }`." The component's own render logic at line 24
(`{p.status === 'active' ? 'Active' : 'Expired'}`) is a live ternary that only makes sense if
expired entries can reach it — contradicting the comment's claim that only active products
ever arrive. Per E26, the **component logic was always correct**; only the comment's claim
about upstream filtering had drifted. Comment-only fix: removed the false "already filters to
active products" claim and stated that the agent-facing list can include expired entries,
which is exactly why the Active/Expired ternary exists.

---

## Addendum — routed from `P7-rls-doc-truth` (dangerous-direction claims in `CLAUDE.md`)

Two escalations arrived mid-pass from the concurrent `P7-rls-doc-truth` agent (owner of
`docs/role-permissions.md` and `docs/audits/2026-08-23/a26/rls-matrix-remeasured.md` — neither
touched by this agent; full RLS-matrix numbers live there, not restated here). Both were inside
this agent's write-set (`CLAUDE.md`, `docs/ARCHITECTURE.md`) and both were **wrong in the
dangerous direction** — documenting a security hole as open when it had already been closed.
Independently re-verified before editing (not merely trusted secondhand):

```sql
SELECT tablename, cmd, policyname FROM pg_policies
 WHERE schemaname='public' AND cmd IN ('INSERT','UPDATE','DELETE')
 ORDER BY tablename, cmd, policyname;
```

Result: **exactly 10 write policies** in the entire `public` schema — `agents` (insert,
update), `branches` (insert, update), `contribution_schedules` (update), `distributors`
(update), `insurance_policies` (insert, update), `subscriber_insurance_products` (update),
`subscribers` (update). **`transactions`, `withdrawals` and `nominees` have zero write
policies** — confirms `P7-rls-doc-truth`'s claim exactly.

```sh
$ grep -n '\.insert(\|\.update(\|\.upsert(\|\.delete(' src/services/entities.js src/services/subscriber.js
```

Confirms **9** direct-write call sites (`entities.js:1102,1138,1170,1222,1448`;
`subscriber.js:1097,1260,1267,1520`), down from the 11 `CLAUDE.md` previously claimed — matches
exactly.

`CLAUDE.md:109` (anti-pattern §5.6) and `CLAUDE.md:130` (§7.3, a rule marked *binding*) both
previously said migration `0118` was "drafted, NOT yet applied — the hole is open right now."
Both migrations `0118_rls_write_surface` and `0119_table_grants` are **confirmed live**
(consistent with the A26-007 finding above: applied out-of-band, no ledger row). Rewrote both
sections to state the closed state, the exact 10-policy write surface, and the corrected 9
call-site count. `docs/ARCHITECTURE.md:667`'s "`0118` still being drafted" example was removed
from its "not yet applied" list for the same reason. `README.md` carried the identical stale
claim but is outside every P7 agent's write-set and was already fixed directly by
`P7-rls-doc-truth` (commit `cdc66b7`) — not touched here.

## Verification gate

```
$ npx vitest run --silent 2>&1 | tail -5     # BEFORE this agent's edits
 Test Files  1 failed | 183 passed (184)
      Tests  1 failed | 4455 passed (4456)
   Duration  128.71s

$ npm run typecheck                          # BEFORE this agent's edits
(exit 0, no output — server + api + e2e tsconfigs all clean)
```

Note: the task brief's stated baseline was "4,444 passing" — this agent's own measurement
shows 4455 passing / 1 failing (4456 total). Per the programme's own guardrail ("re-measure,
never trust the report's numbers"), this agent's freshly-run number is what is treated as
ground truth, and is what `after_output` is compared against, not the brief's stale figure.
The 1 pre-existing failure (`search.test.js`, real/mock branch parity) is outside this agent's
write-set and is expected to be unchanged after this agent's comment-only + doc-only edits —
see the top-level report for the actual `after_output`.
