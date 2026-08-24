# A25 — Adversarial Verification

Verifier ran against the LIVE system (Supabase `ilkhfnoyxlxwqadebnkp`) and reproduced
each critical/high from a clean state; spot-checked 4 mediums. No writes committed.

## High findings

### A25-001 — Baseline Playwright ships RED with 30 deterministic failures → **SEVERITY-ADJUST (high → medium)**
- **Confirmed part:** the committed baseline is genuinely RED. A00's full run (326/30/14, exit 1)
  and A25's rerun agree on a 28-strong reproduced set. I re-ran two read-only clusters myself:
  `landing.spec.ts --project=mobile-chromium` → **3 failed** (FAQ, Contact, About) deterministically;
  `subscriber-dashboard.spec.ts:43,:173 --project=mobile-chromium` → **2 failed**. CI **does** run
  `mobile-chromium` on PRs (`.github/workflows/test.yml:125-136`: `... e2e/specs/smoke e2e/specs/flows
  e2e/specs/db --project=chromium --project=mobile-chromium`), so these land on the merge-gating surface.
  The "not flake" claim is correct.
- **Refuted part (drives the downgrade):** the finding's IMPACT — *"subscriber dashboard sub-routes and
  public landing pages **do not render on a phone** … These are **real product defects**"* — is FALSE.
  Every page I inspected renders fully and functionally on mobile; the Playwright DOM snapshots prove it:
  - About (mobile): full mission/values/vision content present; title is `heading "About Universal
    Pensions" [level=3]`. Desktop `About.jsx:73` uses `<h1>`; mobile `AboutMobile.jsx:9` uses `<h3>`.
    Test wants `heading level=1 name=/about/i` → not found. Page is fine.
  - Profile (mobile): complete edit form (Full name "Carol Obua", phone, email, identity, member card).
    h1 reads **"Edit profile"**; test wants exact `^profile$` → mismatch.
  - Schedule (mobile): complete contribution form (frequency radios, amount, presets). h1 reads
    **"Contribution settings"**; "Tune your schedule" is a `<p>`, not the h1; test wants it as h1 → mismatch.
  These are brittle heading selectors + a minor mobile heading-hierarchy a11y inconsistency (pages open
  at h3 / different h1 text), **not** broken or unreachable routes. High requires "a whole feature/route
  unreachable or broken on a supported viewport" — not met. A red CI baseline plus a heading a11y gap is
  **medium**. severityShouldBe = medium.

### A25-004 — E2E teardown leaks fixture rows into the LIVE demo DB → **CONFIRMED (high)**
- Direct live query reproduced every row the finding names:
  - `branches`: `tst-branch-msc7w8vm` (TST throwaway), `b-new-1785700420016` / `b-new-1785753024670`
    both named "E2E Branch …" and attached to **d-001** (the primary demo distributor), dated 2026-08-02/03
    (pre-dating this audit — genuine pre-existing leaks, not audit residue).
  - `subscribers`: 5 test rows (`tst-sub-tree/emp/retag-msc7vzsc`, `tst-sub-tree-msd3855c`,
    `s-e2e-emp-foreign-1785752999757`); 4 have **no `subscriber_balances` row**.
- This is exactly the 4-row `subscribers`(5064) vs `subscriber_balances`(5060) gap A00 handed to A06 —
  a live invariant violation (M1: every subscriber has one balance). "A data invariant is violated in
  LIVE data" = high per the rubric. Mechanism (fire-and-forget teardown deletes, error unchecked) is
  corroborated: the rerun3 log itself shows `E2E Branch 1787560214725` being inserted, and my `b-new-%`
  probe returns only the two 2026-08 rows (the newer one was cleaned) — consistent with intermittent
  teardown. Demo-visibility of the E2E branches in d-001's UI is plausible but unproven (0-agent branches
  may not surface in the ranked "top branches" panel); severity does not depend on it. **No rows purged**
  (report-only). CONFIRMED at high.

## Mediums spot-checked (all CONFIRMED)

- **A25-005** (money invariants unguarded, 2 violated live): `subscribers_without_balance = 4`;
  s-0005 `units 203.986` vs `retirement 185.405 + emergency 24.945 = 210.350`, delta **-6.3638**;
  exactly **1** balance row has `units <> retirement+emergency`. Data facts match. CONFIRMED.
- **A25-011** (CI executed-not-skipped guard is push-main only): `.github/workflows/test.yml:149`
  guard step `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, while the PR job runs
  the db specs with no such guard. CONFIRMED.
- **A25-006** (api/server/e2e TS unlinted): `eslint.config.js` globs are only `src/**/*.jsx` and
  `**/*.{js,jsx}`; `npx eslint . --format json` lints **zero .ts** files (cjs:3, mjs:112, js:180, jsx:433).
  CONFIRMED. (Aside: mjs count is higher than the finding's 68 because docs/ now holds audit scratch .mjs —
  which corroborates A25-010's "lints untracked/docs files".)
- **A25-012** (coverage gate statements-only at 23): `vite.config.js` `thresholds: { statements: 23 }`
  only; no branch/function/line thresholds; no `vitest.config.*`. CONFIRMED.

## Notes
- No writes were committed. Read-only Playwright reruns (landing, subscriber-dashboard) only navigate.
- A25-001 and the A00-owned mobile cluster (A10/A16/A18) describe the same underlying failures; A25's
  test-health framing is legitimate but its product-breakage impact is inverted (a test/a11y problem
  presented as broken routes).
