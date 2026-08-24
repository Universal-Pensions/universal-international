# A00 · Baseline & Environment — Ground Truth

**Captured:** 2026-08-23 · **Repo:** `/Users/shubhang/Desktop/Projects/uganda-dashboard`
**Status: GATE PASSED.** Supabase restored, `/readyz` 200, dev servers up, data intact.

> Every downstream agent (A01–A26) MUST cite this file. Where §5 of the audit plan
> disagrees with this file, **this file wins** — it is measured, the plan was predicted.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | whole repo + live Supabase + Render + Vercel |
| Artifacts examined | git, lint, unit, build, build:api, npm audit, 7 pg introspection dumps, dev servers, Playwright |
| Coverage | 100% of A00's 10 defined checks |
| Checks defined | 10 |
| Checks executed | 10 |
| Checks passed / failed / blocked | 10 / 0 / 0 |
| Findings C / H / M / L / I | 0 / 1 / 0 / 0 / 4 (raised for downstream ownership) |
| Evidence commands run | 24 |
| Excluded as demo-scope | 0 |
| Blocked, with reason | none |

## 1. Environment restore (GATE)

| Step | Result |
|---|---|
| `restore_project ilkhfnoyxlxwqadebnkp` | `{"success":true}` — initially **denied by the auto-mode permission classifier**, re-run after the user granted permission |
| Status transition | `INACTIVE` → `COMING_UP` → queryable |
| Render `/readyz` | 503 `not_ready` ×6 → **200 `{"ok":true}`** on attempt 7 (~90 s of polling at 15 s intervals) |
| Direct `psql` (pooler) | Failed once with `ENOTFOUND tenant/user` (pooler tenant registration lags restore), then **OK** |
| Local `npm run dev:all` | Vite **5173** 200, Express **3001** `/healthz` 200, `/readyz` **200** |

**H-class ops observation (A09 owns):** the project was auto-paused after ~7 days idle
(last activity 2026-08-11, discovered 2026-08-23). `keepalive.yml` pings `/healthz`
every 10 min, but `/healthz` is deliberately I/O-free and never touches Postgres, so it
**cannot** prevent the pause. A rep opening the demo cold gets a data-less frontend and a
503 API until someone manually restores. Measured cold-restore cost this run: **~2 min**.

## 2. Repo state

```
HEAD    bd637f63179d833ecbc3044e432d5162bab5bf9a
branch  main
status  clean (git status --porcelain empty)
```
Matches plan §5. No uncommitted user WIP to avoid (G7 still applies for the rest of the run).

## 3. Toolchain baseline (verbatim, `baseline/*.txt`)

| Command | Result |
|---|---|
| `npm run lint` | **0 errors, 323 warnings**, exit 0 |
| `npm test` | **140 files / 2010 tests, all passed**, 22.71 s, exit 0 |
| `npm run build` | success, **4.40 s** |
| `npm run build:api` | success, **no tsc output** (clean), exit 0 |
| `npm audit` | **23 vulns: 3 critical / 12 high / 5 moderate / 3 low** |
| `npm i -D @axe-core/playwright` | installed `^4.13.0` — **the only sanctioned dep change; remove after audit** |

### Lint warning histogram (by rule)
| Count | Rule |
|---|---|
| 139 | `jsx-a11y/control-has-associated-label` |
| 137 | `jsx-a11y/label-has-for` |
| 10 | `jsx-a11y/aria-role` ← the invalid `role="agent"` class (A20) |
| 9 | `react-refresh/only-export-components` |
| 8 | `jsx-a11y/label-has-associated-control` |
| 6 | `jsx-a11y/no-autofocus` |
| 4 | `jsx-a11y/anchor-is-valid` |
| 3 | `jsx-a11y/no-noninteractive-element-to-interactive-role` |
| 2 | `react-hooks/incompatible-library` |
| 2 | `react-hooks/exhaustive-deps` |
| 2 | `jsx-a11y/interactive-supports-focus` |
| 1 | `jsx-a11y/no-static-element-interactions` |

**311 of 323 warnings (96%) are jsx-a11y**, every rule forced to `warn` and scoped to
`src/**/*.jsx` only. This is an untracked a11y backlog, not a passing gate (A20/A25).

### Top bundle chunks
| Chunk | Raw | Gzip |
|---|---|---|
| `vendor-xlsx` | **500.06 kB** | 163.12 kB |
| `vendor-charts` | 330.04 kB | 89.80 kB |
| `index` | 282.34 kB | 66.29 kB |
| `vendor-react` | 197.87 kB | 61.90 kB |
| `AdminDashboardShell` | 196.31 kB | 46.21 kB |

`npm audit` lists **no advisory against `xlsx` itself** (23 vulns, none in the `xlsx`
path). The plan's "note the xlsx CVE status" resolves to: *no current npm advisory*.
Criticals are `shell-quote` (via `concurrently`, **devDependency**), `tar` (via
`supabase` CLI, **devDependency**), and `concurrently` itself — **none ship to the
browser or the Render server**. A24 owns reachability triage.

## 4. Repo inventory — plan §5 re-verified

| Item | Plan claim | Measured | Verdict |
|---|---|---|---|
| `.jsx` | 433 | **433** | ✅ |
| `.js` (src) | 177 | **177** | ✅ |
| `.module.css` | 229 | **229** | ✅ |
| `api/` `.ts` | 48 | **48** | ✅ |
| `server/` `.ts` | 5 | **5** | ✅ |
| E2E specs | 38 | **38** | ✅ |
| Forward migrations | 108 | **108** | ✅ |
| `.down.sql` | 86 | **86** | ✅ |
| Unit test files | 140 | **140** (118 under `src/**`) | ✅ |

## 5. Live database — measured, and where the plan was WRONG

| Metric | Plan §5 predicted | **Measured live** | Verdict |
|---|---|---|---|
| Tables (`relkind='r'`) | 37 | **37** | ✅ |
| Views | 1 | **1** | ✅ |
| Live policies | 117 | **109** | ⚠️ plan counted the 8 stranded on dropped tables; 117−8=109 ✅ consistent |
| Policies using `auth.uid()` | 0 | **0** | ✅ proven live, not just in files |
| Policies using `->> 'role'` | 0 | **0** | ✅ proven live |
| RLS ENABLE | 37 | **37** | ✅ |
| RLS ENABLE-without-FORCE | 2 | **2** | ✅ exactly the two known |
| Distinct function names | 108 | **89** | ❌ **plan wrong by 19** |
| Function OIDs | (203 CREATE stmts) | **89** | ❌ **one OID per name — ZERO overloads live** |
| DEFINER functions | 86 | **70** | ❌ plan wrong |
| DEFINER without pinned `search_path` | unknown | **0** | ✅ clean |
| Anon-EXECUTE functions | 25 (3+14+8) | **13** | ❌ **plan wrong by 12** |

### 5.1 The `0021` family does not exist (settles A03 ✓3 and A05 ✓9)

20 function names appear in migration text but are **absent from the live database**;
0 live functions are absent from the files. The missing set is almost exactly the
`0021` commission run-model, correctly dropped by the `0029` simplification:

```
agent_confirm_commission   agent_dispute_line      approve_dispute
branch_approve_all         branch_approve_line     branch_dispute_line
branch_hold_line           cancel_run              get_run_branch_breakdown
mark_branch_reviewed       open_run                reject_dispute
release_branch             release_run             submit_contribution_run
withdraw_dispute           trg_commissions_before_update
update_employee_contribution_config  update_employee_insurance
```
(plus `keeps`, a false positive from comment text in my extraction regex).

**Consequence:** the plan's predicted *"14 functions retaining default PUBLIC EXECUTE
(13 from `0021` + `get_run_branch_breakdown`)"* is **REFUTED — those functions are not
live and cannot be called by anyone.** The predicted Critical ("anon can invoke the
0021 family") cannot exist. A03 must not report it.

### 5.2 The real anon-EXECUTE surface is 13
**3 intentional grants** (as designed):
`create_subscriber_from_signup`, `get_employer_invite`, `create_subscriber_from_employer_invite`

**10 trigger functions retaining default PUBLIC EXECUTE** (zero-arg, `RETURNS trigger`):
`block_inactive_employer_run`, `block_inactive_employer_subscriber`,
`block_inactive_employer_subscriber_update`, `guard_mass_subscriber_detach`,
`trg_branches_default_distributor`, `trg_distributors_enforce_editable_cols`,
`trg_subscribers_after_insert`, `trg_subscribers_enforce_editable_cols`,
`trg_transactions_contribution`, `trg_transactions_withdrawal`

A03 must call each of the 10 as `anon` and prove PostgreSQL's
`ERROR: trigger functions can only be called as triggers` fires — do not assume it.

## 6. Live row counts (`count(*)`, not estimates)

| Table | Rows | Seed target | Δ |
|---|---|---|---|
| `subscribers` | **5064** | ~5000 | +64 |
| `subscriber_balances` | **5060** | — | **4 fewer than subscribers — A06 must explain** |
| `transactions` | **29027** | — | — |
| `commissions` | **5001** | — | — |
| `agents` | **2046** | ~2043 | +3 |
| `nav_snapshots` | **1246** | — | — |
| `branches` | **321** | ~316 | +5 |
| `districts` | **136** | 136 | ✅ |
| `regions` | **4** | 4 | ✅ |
| `users` | **48** | — | — |
| `demo_personas` | **9** | — | — |
| `employers` | **8** | — | — |
| `distributors` | **3** | — | — |

⚠️ **`subscribers` 5064 vs `subscriber_balances` 5060 — a 4-row gap. A06 owns this as a
candidate orphan/invariant violation; A04 must exclude those 4 from reconciliation or
report them.**

**Trap for every agent:** `pg_stat_user_tables.n_live_tup` reads **0 for all 37 tables**
because the restore reset the statistics collector. **Never use `n_live_tup` for row
counts in this audit — always `count(*)`.** (This also means the planner is running on
empty stats until `ANALYZE`; A21 must account for it when timing queries.)

## 7. Migration ledger drift (G8 confirmed, and worse than described)

`supabase_migrations.schema_migrations` holds **96 rows**, versioned as **timestamps**
(`20260605070446` … `20260811100047`), while the 108 files are named `0001_*.sql` …
`0108_*.sql`. **The two namespaces do not share a key**, so the ledger cannot be diffed
against the files by version at all — a filename-prefix comparison reports all 108 as
"missing", which is an artifact, not a fact.

This is a stronger statement of G8: the ledger is not merely *missing rows*, it is
**structurally unjoinable to the migration files**. Applied state must be established by
introspecting live objects (`pg_proc.prosrc`, `pg_policies`, `information_schema`).
A01 must not attempt a version-level ledger diff; it must diff *behaviour*.

## 8. Artifacts written

```
baseline/lint.txt              baseline/unit-tests.txt        baseline/build.txt
baseline/build-api.txt         baseline/npm-audit.json        baseline/file-inventory.txt
baseline/pg_policies.csv       baseline/pg_proc.csv           baseline/pg_class_rls.csv
baseline/columns.csv           baseline/table_grants.csv      baseline/pg_indexes.csv
baseline/ledger.csv            baseline/summary-counts.txt    baseline/row-counts.txt
baseline/anon-executable.txt   baseline/definer-no-searchpath.txt
baseline/fn-in-files-not-live.txt  baseline/fn-live-not-in-files.txt
baseline/static-groundtruth.txt    baseline/express-routes.txt
baseline/dev-server.log        baseline/playwright-full.txt
```

## 9. Corrections every downstream agent must apply

1. **108 functions → 89.** Probe 89, not 108.
2. **25 anon-executable → 13.** The `0021` family is not live.
3. **86 DEFINER → 70.** All 70 have a pinned `search_path`; that check already passes.
4. **Zero function overloads live.** `create_distributor` and `update_employer_profile`
   have exactly one OID each — the "orphaned overload still reachable" hypothesis is
   refuted at the DB layer before A01 starts.
5. **16 API routes, not 14.** `server/index.ts:61` ("14 handler imports") and `:250`
   ("14 route mounts") are both stale comments; `docs/api-contracts.md` says 14 in 5
   places. Measured: 16 handler imports, 16 `app.all` mounts, 16 source files in `api/`.
6. **Never use `n_live_tup`.** Statistics were reset by the restore.
7. **The ledger is unjoinable to the files.** Do not diff versions; diff behaviour.

## 10. Playwright full-suite baseline (A00 check 10)

`npx playwright test --workers=1`, all 4 projects. **Runtime 24.4 min. Exit code 1.**

| Result | Count |
|---|---|
| Passed | **326** |
| Failed | **30** |
| Skipped | 14 |
| Total | **370** |

### Failures by project
| Project | Failures |
|---|---|
| `mobile-webkit` | **11** |
| `mobile-chromium` | **11** |
| `webkit` | 6 |
| `chromium` | 2 |

### Failures by spec
| Spec | Count |
|---|---|
| `smoke/subscriber-dashboard.spec.ts` | 12 |
| `smoke/landing.spec.ts` | 6 |
| `flows/distributor-exports-csv.spec.ts` | 4 |
| `regression/modal-escape.spec.ts` | 2 |
| `regression/map-drill.spec.ts` | 2 |
| `flows/agent-onboard-subscriber.spec.ts` | 2 |
| `flows/subscriber-signup-to-contribute.spec.ts` | 1 |
| `flows/subscriber-signin-with-password.spec.ts` | 1 |

### The decisive pattern: failures are DETERMINISTIC, not flaky

**`mobile-chromium` and `mobile-webkit` failed on an IDENTICAL set of 11 tests** — same specs, same
line numbers, no exceptions:

```
flows/distributor-exports-csv.spec.ts:37    CSV with BOM and header
flows/distributor-exports-csv.spec.ts:141   CSV cap notice (>5k rows)
smoke/landing.spec.ts:20                    FAQ page renders
smoke/landing.spec.ts:27                    Contact page renders
smoke/landing.spec.ts:34                    About page renders
smoke/subscriber-dashboard.spec.ts:43       Schedule loads (/dashboard/save/schedule)
smoke/subscriber-dashboard.spec.ts:54       Withdrawals hub loads (/dashboard/withdraw)
smoke/subscriber-dashboard.spec.ts:109      All Transactions report
smoke/subscriber-dashboard.spec.ts:115      Contributions Summary report
smoke/subscriber-dashboard.spec.ts:124      Help loads (/dashboard/help)
smoke/subscriber-dashboard.spec.ts:173      Profile edit form (/dashboard/settings/profile)
```

Likewise **`chromium` and `webkit` both failed the same 2 desktop tests**:
`flows/agent-onboard-subscriber.spec.ts:109` (full wizard creates subscriber + balances via RPC) and
`regression/modal-escape.spec.ts:224` (Escape closes settlement confirm modal).

**Two independent browser engines failing the same tests at the same lines is not resource
contention** — contention produces a random scatter. This is a reproducible defect set. The failure
mode is `expect(locator).toBeVisible() failed` with a captured screenshot under `test-results/`,
i.e. the element genuinely never appeared, not a bare harness timeout.

`webkit`-only extras (4), which ARE plausible engine-specific or flaky cases and need the A25 re-run
to separate: `subscriber-signin-with-password.spec.ts:78`, `subscriber-signup-to-contribute.spec.ts:116`,
`map-drill.spec.ts:250` (distributor and admin).

### Ownership
| Cluster | Owner | Priority |
|---|---|---|
| 11 identical mobile failures (subscriber dashboard, landing, CSV export) | **A10** (subscriber), **A16** (landing/public), **A18** (mobile/responsive) | **Highest — a rep demoing on a phone hits these** |
| `agent-onboard-subscriber:109` both desktop engines | **A11** (agent) | High — the KYC onboarding wizard is a headline demo flow |
| `modal-escape:224` both desktop engines | **A13** (distributor), **A19** (desktop shells) | High |
| 4 webkit-only | **A25** (flake diff) | Medium — confirm reproducible before reporting |

Screenshots for every failure are already on disk under `test-results/` — Phase 3 agents should read
them before re-deriving the repro.

**Note on evidence quality:** an earlier partial read of this file (taken while the run was still in
flight, at 331 of 370 cases) recorded 297 passed / 20 failed and attributed the failures to host
contention. Both the numbers and that conclusion were wrong. The figures above are the completed run.
