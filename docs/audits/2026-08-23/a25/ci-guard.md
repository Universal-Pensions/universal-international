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
