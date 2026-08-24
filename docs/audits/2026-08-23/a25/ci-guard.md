### 8.1 The guard's logic is correct

`.github/workflows/test.yml` re-runs `e2e/specs/db` with `--reporter=json` and fails on
`stats.expected < 1`. All four db specs gate on a describe-level
`test.skip(!hasEnv, …)` (`rls-isolation.spec.ts:56`, `deactivate-entities.spec.ts:80`,
`money-idempotency.spec.ts:83`, `invariants.spec.ts:69`), which Playwright reports as
`stats.skipped`, never `stats.expected`. So with a missing secret the guard's
`expected === 0` branch fires and the job exits 1. Verified by execution below.

### 8.2 …but it only runs on `push` to `main`, and the PR job needs it more

```yaml
- name: Run Playwright smoke + flow + db specs (PR — chromium + mobile-chromium)
  if: github.event_name == 'pull_request'
  run: npx playwright test e2e/specs/smoke e2e/specs/flows e2e/specs/db …

- name: Assert db/ specs actually executed (not silently skipped) (§15-M1)
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

The PR step deliberately includes `e2e/specs/db` — its own comment says the point is to
"catch security/money regressions **before merge** rather than only post-merge on main (§15-H1)".
The §15-M1 assertion that those specs actually *ran* is then withheld from exactly that job. A PR
raised from a fork, or run while a secret is rotating/unset, silently loses every cross-tenant RLS
and money-idempotency guard and still shows a green check. The failure the guard was written to
prevent is therefore still fully reachable on the surface that gates merges.

**Remedy:** change the guard step's condition to `if: always()` (or drop the condition entirely) —
it is a re-run of four service-role queries, a few seconds, and it makes the §15-H1 promise real on
PRs. Optionally tighten `expected < 1` to a floor that matches the current suite
(`expected < 13`), so a *partially* skipped db suite is caught too, not only a wholly skipped one.

---

## 9. Remediated (P0-ci-gate, 2026-08-25) — A09-002 + A25-011

### 9.1 A25-011 — `if:` condition

Changed to `if: always()` exactly as §8.2 recommended, in `.github/workflows/test.yml`'s
"Assert db/ specs actually executed (§15-M1)" step. It now runs on every PR and every push to
`main`, not push-to-main only. Caveat worth recording: `always()` survives a *previous step*
failing (including the Playwright run steps' new `continue-on-error: true`, §9.3 below) — it does
**not** survive the whole job being force-cancelled, since GitHub Actions stops scheduling further
steps on a hard cancellation regardless of `if:`. That's exactly the A09-002 failure mode, which is
why raising the timeout (§9.2) is the half of this fix that actually stops the guard from being
skipped by cancellation.

### 9.2 A25-011 — threshold, NOT the suggested `expected < 13`

§8.2's "optionally tighten … to `expected < 13`" was verified against the real tree and found to be
wrong on two counts, so it was not applied as written:

1. **Wrong number.** `grep -c "^\s*test(" e2e/specs/db/*.spec.ts` (cross-checked against a real
   `--list --reporter=json` run of `e2e/specs/db`) counts **17** `test(...)` definitions for a
   single project, not 13: `deactivate-entities.spec.ts` 4, `invariants.spec.ts` 8,
   `money-idempotency.spec.ts` 2, `rls-isolation.spec.ts` 3.
2. **Wrong field.** `stats.expected` only counts tests that ran AND passed as expected. A threshold
   of `expected < N` would also fire on a run where every db/ test executed but one **genuinely
   failed** (`unexpected: 1`) — printing this guard's "all skipped or none discovered / missing
   secret" message for a real, unrelated test failure the full-matrix/PR step above already caught
   and already fails the job for. That is a misleading-message bug, not just an imprecise one.

Fix applied: `executed = expected + unexpected + flaky` (ran to completion, any verdict) compared
against `REQUIRED_DB_TESTS = 17`. This still catches whole-suite skip (`executed === 0`, the
original bug) AND partial skip (`0 < executed < 17`, §8.2's actual goal), while a genuine test
failure with everything else executing no longer trips this specific guard — it's caught by the
delta gate instead (§9.3), with the real failing test named there rather than a "secret is missing"
red herring here. Verified with 4 synthetic `stats` blocks (clean pass, whole-suite skip, one real
failure among 17 executed, partial skip of 7/17) — see the agent's final report for the transcript.

### 9.3 A09-002 — delta gate, not just the timeout

Raising `timeout-minutes` (20 → 50, real headroom math in the comment above `timeout-minutes: 50`
in `test.yml`) stops the job from being killed mid-run, but by itself it does not make CI green:
the suite has 30 deterministically-failing tests (`docs/audits/2026-08-23/00-baseline.md` §10) that
won't all be fixed until Phase 7, so `npx playwright test`'s raw exit code would still fail every
run. Built `scripts/e2e-delta.mjs` as the actual gate — passes iff the set of tests that failed this
run is a SUBSET of the frozen allowlist at `baseline-failures.txt`; fails (naming them) on any test
failing that ISN'T in that allowlist; separately reports (non-gating) which allowlist entries now
pass, as Phase 7 candidates to remove. Both Playwright run steps in `test.yml` got
`continue-on-error: true` + `--reporter=json,github,html` so their own non-zero exit no longer
fails the job; a new "Delta gate" step right after each one runs the script and is what the job's
pass/fail now actually depends on. Full schema-verification notes (JSONReportSuite is one entry per
FILE not per project; `spec.file` is relative to `testDir`, not repo root or absolute; the JSON
reporter must be pointed at a FILE via `PLAYWRIGHT_JSON_OUTPUT_NAME`, never left on stdout, because
dotenv's own "injected env" banner also prints to stdout and corrupts the JSON) live in
`scripts/e2e-delta.mjs`'s header comment.

**Deliberately NOT applied from §A09-002's suggested_fix:** changing the two artifact-upload steps'
conditions to `always()`. Once the timeout has real headroom and the Playwright run steps no longer
fail the job outright, `cancelled()` should only ever be true for a genuine concurrency pre-emption
(a follow-up push superseding this run — `concurrency.cancel-in-progress: true` at the top of this
file, by design) rather than a self-timeout. Uploading artifacts for a run that was deliberately
superseded mid-flight is wasted storage for no read; left "Upload Playwright HTML report" on
`!cancelled()` and "Upload …  traces" on `failure()` unchanged. The trace-upload step's `failure()`
check now means something slightly different than before (it no longer fires on baseline-only
noise, since that no longer fails its step) — it fires only when the Delta gate step or the §15-M1
step genuinely fails, which is arguably a more useful signal, not a worse one.

**Explicitly not done, per the remediation plan:** no branch-protection rule and no "required
check" were added. The plan is clear that a required check against a still-noisy baseline (30
allowlisted failures today) would block every merge; that's Phase-7-or-later work, once the
allowlist has been driven down and is trustworthy.
