# Adversarial self-review, 2026-08-25 — what was fixed, what was left

Three independent reviewers were pointed at this branch and told to break it:
one at the money engine and migrations, one at the frontend, one at tests/CI.
Everything below is theirs unless marked otherwise; every item was re-verified
against live or by running it before being accepted or rejected.

**Headline: the reviews were right far more often than not, and several of the
worst findings were in code this programme had just written to fix something
else.**

---

## Fixed (commits `34d7999` → `640773a`, `0136`, `0137`)

| # | What | Why it mattered |
|---|---|---|
| 1 | **The signup fix didn't fix the bug it claimed to.** `ReviewStep` re-scanned correctly, then `signup.fullName \|\| result.fullName` discarded the result — stale name + NIN, new card number + DOB. A **hybrid identity**, worse than the replay bug it replaced. | The user's original complaint, unfixed. My own test asserted the scan was *called*, never what it did. |
| 2 | **The storage namespacing had a hole.** `beforeunload` flush used the bare key — an agent refreshing mid-onboarding wrote the subscriber's NIN/DOB/phone into the *public* wizard's blob, which `reset()` never cleans. | The identity-reuse bug, reintroduced through the one path of five that wasn't threaded. |
| 3 | **The breakpoint moved the seam into the CSS.** `min-width: 768px` mounted the desktop shell at exactly 768px while 45 CSS modules applied mobile rules — **the nav rail vanished**, taking the only dash/map toggle with it. | iPad portrait, the exact device the change cited as motivation. The contract test compared the hooks only to each other, so it certified the collision. |
| 4 | **`0110_unpurge.sql` was dead.** The only undo for a destructive production purge aborted on `0114`'s bucket-sum CHECK — 19 of 19 members. Plus the trigger re-fired on restore, and **`0134` had deleted a parent run header 57 snapshot rows reference** (found by *running* it). | Free tier, no PITR. Now proven: 1,881 rows restored, 5059/5059, 19/19 byte-match. |
| 5 | **`0133`'s reclaim re-issued spent cards.** It keyed on `subscriber_id`, which nothing writes, so after 24h it freed cards whose NIN was already taken — and handed them out *first*. | **A11-002 verbatim**, the one outcome the pool exists to prevent. |
| 6 | **`0114.down` silently un-shipped `0115`.** Bodies captured pre-`0115`, so reverting deletes the double-spend fix while leaving its indexes in place — nothing errors. | That file's own header warns about this exact failure mode, citing `0095` over `0090`. |
| 7 | **`psql-probe.sh` destroyed 369 function bodies.** Its strip regex ate column-0 `END;` — a PL/pgSQL terminator, not transaction control. `\|\| true` hid psql's exit code; the guard said "(safe)" in **both** arms. | I hit this myself on `0133` and worked around it *by indenting my migration* — fixing the file to suit a broken tool. |
| 8 | **The Sentry scrubber leaked PII**, returning the raw object on any repeated reference. And the **client** copy never redacted NINs at all — the server twin did, under a "these must stay in sync" notice. | Browser error reports carried Ugandan national IDs in the clear. |
| 9 | **`0118` reopened what `0128` closed.** Two trigger functions client-executable; `0128`'s own guard aborts today. Root cause: Supabase's default ACL grants EXECUTE on every new function. | A sweep is permanently temporary — the next trigger function reopens it. |
| 10 | **Four CI gates that couldn't fail.** Allowlist keyed on `:line:col` (12/22 stale → reds CI for pre-existing breakage); staleness indistinguishable from repair; `report.errors` dead code (the live-leak backstop couldn't fail CI); `REQUIRED_DB_TESTS` 17 against 57, and unreachable under `bash -e`. | |
| 11 | **The subscriber list was never sorted** — `foreignTable` sets the *embedded* order, a no-op on a 1:1 embed, so `.range()` paginated an unordered query. The test asserted the argument shape and pinned the bug. | Rows can repeat across pages or vanish. |
| 12 | Six silent tab stops (`aria-label` on role-less divs — browsers discard it); two report views loading forever on a null subscriber; a 17.5s dead card after onboarding succeeded; coverage never evaluated on failure; a live subscriber raced by two parallel tests; `typecheck` never run by CI; admin panel undercounting its own list by 58. | |

---

## Deliberately NOT fixed — and why

These are real. They are left because each needs a decision, a secret, or a
change whose blast radius is larger than the defect.

### Needs a product decision

1. **New signups use the real clock; the seeded world uses the demo clock.**
   `_insert_subscriber_chain` stamps `registered_date = CURRENT_DATE`
   (2026-08-25) while `_demo_now()` is 2026-07-01. Consequences: the agent Home
   "collected this month" tile reads **UGX 0** and flags the whole book as
   yet-to-contribute (anchor = `max(registration, contribution)`, and
   registration always wins and grows); and a payroll run submitted on stage
   lands outside every rollup window.
   *`deriveMonthAnchors`' current behaviour is deliberate and argued in its own
   header (A11-007) — showing an honest zero beats silently borrowing an older
   month. The defect is upstream: which clock new writes get stamped with. That
   is a product call, not a bug fix.*

2. **`renewPolicy` writes a display-only fallback premium into the money table.**
   `buildPolicy` substitutes `FALLBACK_PREMIUM_MONTHLY = 2000` when the stored
   premium is 0 "so the renewal amount is never UGX 0"; `renewPolicy` then sends
   it, `0073` stamps it permanently and charges 12×. A member with a legitimate
   0-premium policy gets a 24,000 UGX transaction invented by the UI.
   *What a 0-premium policy should renew at is a product question.*

3. **`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM anon,
   authenticated`** would permanently close item 9 above. Safe by measurement —
   all 77 client-callable RPCs carry explicit grants, zero rely on the default.
   *But it changes a platform default on a live project: one forgotten grant
   afterwards fails at runtime as a confusing permission error rather than at
   migration time. Recorded in `0137`'s header.*

### Needs something only the user can supply

4. **`SUPABASE_DB_URL` is absent from CI**, so `function-deployment-contract.spec.ts`
   — 35 tests, this branch's answer to "the contract tests prove text, not
   deployment" — **skips 100% of the time on the only surface that gates merges**.
   Adding it means putting a direct Postgres URL in GitHub secrets.

### Real, lower severity, left for a focused pass

5. **`invariants.spec.ts`'s settlement probe asserts nothing.** Its premise about
   `apply_settlement`'s NULL-role gate is wrong (`NULL NOT IN (…)` is NULL, not
   TRUE), so execution falls through, zero assertions run, and it wrote a
   permanent `test-probe` row to `settlement_uploads` — after which the nonce
   ledger short-circuits it forever. It also passes against an unreachable DB.
6. **`hasMore` is gated on `count: 'estimated'`** (`pg_class.reltuples`), whose
   own JSDoc says it backs only the "Showing X of Y" label. Overshoot → the
   virtualizer refetches the same empty page forever; undershoot → rows silently
   unreachable.
7. **`autoFocus` removed from two inline editors with no ref replacement** —
   clicking Edit drops focus to `<body>`. Came in via lint cleanup.
8. **`0135.down` is unguarded and non-idempotent** (shifts −8 days with no check
   the up ran); **`0128.down` over-grants** (every trigger function, to
   anon/authenticated, where the up revoked only those that had a grant).
9. **Coverage excludes `server/**`** entirely, and the thresholds erode as the
   codebase grows.
10. **The A13-003 CSV-cap test self-skips** below 5,000 subscribers. Live is
    5,059 — a 1.2% margin, against a purge programme actively removing rows.
11. **`verify-otp` accepts an arbitrary non-UG phone** into the JWT claim and
    into `users.id`, minting unbounded TEXT primary keys (rate-limited 10/min/IP).

---

## Rejected — the reviewers were wrong

- **"`0134`/`0135` move money."** They move dates only. `nav_for_date` is
  reachable from two places and the pricing trigger is `AFTER INSERT` only, so a
  date `UPDATE` cannot re-price. Both migrations assert AUM and the transaction
  sum against a pre-shift snapshot and abort on drift. Confirmed by the
  money-engine reviewer's own follow-up.
- **"`mintIdentity` repeats names."** Measured over 200k session ids: all 1,200
  combinations appear near-uniformly. My earlier "Frank Frank" claim was a bug in
  my *reproduction script*, not the code — the real generator builds
  `first last` from disjoint pools.
- **"The 768–1023px range overflows."** It does not; every shell carries
  `min-width: 0` + `overflow-x: hidden`. The defect was the one-pixel CSS
  collision at exactly 768, not the range.
