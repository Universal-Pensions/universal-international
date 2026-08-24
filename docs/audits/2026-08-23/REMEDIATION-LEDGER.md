# Remediation ledger — audit 2026-08-23

Generated 2026-08-25 by `docs/audits/2026-08-23/scripts/gen-ledger.py` from `findings.json`.
Do not hand-edit this file. Change the judgement tables in the generator and re-run:

```
python3 docs/audits/2026-08-23/scripts/gen-ledger.py
```

Every one of the 221 findings has a disposition. There are no blank rows.

## Verification

| check | result |
|---|---|
| rows in ledger | **221** |
| rows in `findings.json` | **221** |
| blank dispositions | **0** |
| duplicate pairs reconciled | **9** (one owner + one DUPLICATE-OF each) |
| e2e baseline failures routed | **30 of 30** |

### Disposition histogram

| disposition | count |
|---|---|
| ACTION | 188 |
| KEEP | 16 |
| DEFER | 10 |
| EXCLUDE | 5 |
| REFUTED | 2 |
| VERIFY | 0 |
| **total (in corpus)** | **221** |
| REFUTED, out of corpus (`A06-007`, in `SPECULATIVE.md`) | 1 |
| **total adjudicated** | **222** |

`VERIFY` is part of the vocabulary but is unused: every row resolved to a
firm disposition, so nothing was parked pending re-measurement.

### ACTION rows by phase

| phase | scope | ACTION rows |
|---|---|---|
| P0 | safety rails | 5 |
| P1 | demo blockers (the Criticals' code half) | 5 |
| P2 | live data repair | 23 |
| P3 | money engine + tenancy/RLS | 33 |
| P4 | dashboard correctness | 32 |
| P5 | mobile / a11y / design system | 28 |
| P6 | performance / dependencies / infra | 24 |
| P7 | tests / CI / docs | 37 |
| P4+P7 | spans dashboard correctness and docs | 1 |
| **total** | | **188** |

### ACTION rows by owner

| owner | remit | rows |
|---|---|---|
| `P0-safety` | P0 — safety rails (destructive-seed guard, keepalive, rollback runbook, cold start) | 5 |
| `P1-demo` | P1 — the Criticals' code half | 5 |
| `P1-webkit` | P1 — WebKit-only e2e triage (new agent; owns no finding, owns 4 baseline failures) | 0 |
| `P2-data` | P2 — live demo-data repair (E2E residue, clock drift, seed staleness) | 23 |
| `P3-rls` | P3 — tenancy, RLS policies and the anon/privilege surface | 11 |
| `P3-money` | P3 — money engine, settlement and migration safety | 22 |
| `P4-dash` | P4 — role dashboard correctness (subscriber / agent / branch / distributor / employer / admin) | 32 |
| `P5-ux` | P5 — mobile, accessibility and design system | 28 |
| `P6-infra` | P6 — infra, deploy, config and performance | 12 |
| `P6-sec` | P6 — frontend security, headers and dependencies | 12 |
| `P7-tests` | P7 — test suite, CI gates, lint and typecheck | 18 |
| `P7-docs` | P7 — documentation accuracy and repo hygiene | 19 |
| `P4-dash + P7-docs` | (composite) | 1 |

`P1-webkit` owns no finding — it exists only to triage the 4 WebKit-only
baseline e2e failures listed in the routing table below.

## Legend

**Disposition** — `ACTION` fix it · `KEEP` accepted, no change · `DEFER` real but after the demo ·
`EXCLUDE` deliberately not doing it · `VERIFY` re-measure before deciding · `REFUTED` not a defect.

**Status** — `OPEN` awaiting its phase · `OPEN · owner of X` this row carries the fix for duplicate X ·
`DUPLICATE-OF X` no separate work, X carries it · `DEFERRED` · `NO-ACTION`.

**demo_visible** — `n/r` means the finding did not record the field (all four A07 rows).

## Ledger — all 221 findings

Sorted by severity, then id.

| id | severity | demo_visible | effort | disposition | phase | owner | status | evidence-ref |
|---|---|---|---|---|---|---|---|---|
| `A05-001` | critical | yes | S | **ACTION** | P1 | P1-demo | OPEN | `05-commission-settlement.md` · apply_settlement has no tenancy check — any distributor can settle another distributor's agents' commissions |
| `A05-002` | critical | yes | S | **ACTION** | P2 | P2-data | OPEN · owner of A11-001 | `05-commission-settlement.md` · Agent demo persona's Commissions page shows Playwright test residue as real payment history, with two contradictory outstanding-balance figures |
| `A06-001` | critical | yes | M | **ACTION** | P2 | P2-data | OPEN · owner of A14-002 | `06-data-integrity.md` · 61% of the default employer persona's roster balance is uncleaned E2E test money |
| `A11-001` | critical | yes | S | **ACTION** | P2 | P2-data | DUPLICATE-OF A05-002 | `11-agent.md` · Agent Commissions shows E2E test residue as real settlement history + two contradictory outstanding figures (verifies + escalates A05-002) |
| `A11-002` | critical | yes | S | **ACTION** | P1 | P1-demo | OPEN | `11-agent.md` · Agent onboarding wizard cannot complete — final create RPC returns 409 (mock OCR's constant NIN collides with a unique index), trapping the rep on a 'Not saved' screen |
| `A14-002` | critical | yes | M | **ACTION** | P2 | P2-data | DUPLICATE-OF A06-001 | `14-employer.md` · E2E test residue displayed as live data across the employer demo dashboard (reproduces A06-001 on the employer surface) |
| `A22-001` | critical | yes | S | **ACTION** | P1 | P1-demo | OPEN | `22-state-errors.md` · Cross-tenant cache bleed: login never clears the React Query cache, so an in-SPA role switch shows the previous role's RLS-scoped money |
| `A24-001` | critical | yes | S | **ACTION** | P1 | P1-demo | OPEN | `24-frontend-security.md` · Insurance policy certificate can never open — window.open(..., 'noopener') always returns null |
| `A02-001` | high | no | S | **ACTION** | P3 | P3-rls | OPEN | `02-rls-matrix.md` · Subscriber JWT can mint arbitrary money by POSTing straight to /rest/v1/transactions |
| `A02-002` | high | no | M | **ACTION** | P3 | P3-rls | OPEN | `02-rls-matrix.md` · Subscriber can rewrite their own insurance cover, premium and status to anything (insurance_policies + subscriber_insurance_products) |
| `A03-001` | high | no | S | **ACTION** | P3 | P3-rls | OPEN | `03-privilege-surface.md` · Anon invite-completion RPC is not bound to the invited phone → cross-tenant subscriber re-tag + compensation overwrite via a shareable token |
| `A04-001` | high | yes | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · make_contribution accepts NaN / Infinity / unbounded amounts; NaN irrecoverably poisons units and every AUM figure on the platform |
| `A04-002` | high | yes | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · request_withdrawal validates only that the split legs SUM to the amount, so a negative leg creates money in the retirement bucket |
| `A04-003` | high | yes | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · A reseed leaves units at the dead 1,000 UGX price and zeroes bucket units; the next NAV publish inflates AUM 57% and zeroes every member's retirement pot |
| `A05-003` | high | yes | S | **ACTION** | P2 | P2-data | OPEN | `05-commission-settlement.md` · settlement_batches.paid_amount / line_count do not equal the lines they flipped — 25,000 UGX and 5 lines of settlement are unbacked in live data |
| `A05-004` | high | yes | S | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · Re-uploading the same settlement file settles another tranche against the same payment reference — the nonce is minted per file-pick |
| `A05-005` | high | yes | S | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · Two rows for the same agent in one settlement upload settle that agent twice in a single call |
| `A06-002` | high | yes | S | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · E2E contribution-run cleanup orphans 1,824 transactions on a premise the schema refutes |
| `A06-003` | high | yes | S | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · Seed's stale MOCK_NOW mirror pushes every contribution schedule 36 days too far out; weekly savers are next due in 8 weeks |
| `A06-004` | high | yes | S | **ACTION** | P3 | P3-money | OPEN · owner of A11-005 | `06-data-integrity.md` · Agent and subscriber surfaces disagree on 1,284 members' policy status (Active vs Expired) |
| `A06-005` | high | yes | S | **ACTION** | P3 | P3-rls | OPEN | `06-data-integrity.md` · create_employer / create_distributor ignore the identity-write failure, so a new tenant's owner signs in to Nile Breweries |
| `A09-001` | high | yes | S | **ACTION** | P0 | P0-safety | OPEN | `09-infra-deploy.md` · Keepalive monitor cannot see or prevent the Supabase auto-pause that takes the demo down |
| `A09-002` | high | no | M | **ACTION** | P7 | P7-tests | OPEN | `09-infra-deploy.md` · Playwright E2E job times out on every push to main, so the §15-M1 db guard has never executed and nothing gates production |
| `A09-003` | high | yes | S | **ACTION** | P0 | P0-safety | OPEN | `09-infra-deploy.md` · `npm run seed` TRUNCATEs the live demo database with no confirmation and no backup |
| `A10-001` | high | yes | S | **ACTION** | P4 | P4-dash | OPEN | `10-subscriber.md` · All Transactions and Annual Tax Statement reports show no data / all zeros in live mode (currentSubscriber never carries transactions) |
| `A11-005` | high | yes | M | **ACTION** | P3 | P3-money | DUPLICATE-OF A06-004 | `11-agent.md` · Agent member detail shows 'Life cover · Active' for members whose own dashboard shows 'Expired' (verifies A06-004 on the agent surface) |
| `A13-001` | high | yes | S | **ACTION** | P4 | P4-dash | OPEN | `13-distributor.md` · Distributor Reports route unreachable on every viewport below 1024px; Menu 'Reports' tile and both routed report screens are dead |
| `A14-001` | high | yes | M | **ACTION** | P4 | P4-dash | OPEN | `14-employer.md` · "Total contributions" computed from two irreconcilable sources; same screen shows figures differing up to 11.6x, and Runs page states a provably false total |
| `A15-001` | high | yes | M | **ACTION** | P4 | P4-dash | OPEN | `15-admin.md` · Mobile subscriber detail shows every member's Balance / Contributions / Withdrawals as "—" though the member holds real money |
| `A25-004` | high | yes | M | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · E2E teardown leaks fixture rows into the LIVE demo DB, incl. 'E2E Branch' rows under d-001 |
| `A26-001` | high | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · Four documents assert that RLS blocks direct client writes; it does not, and the shipped frontend writes directly |
| `A26-002` | high | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · api-contracts.md instructs an agent to apply migration 0092 to live; it is already applied |
| `A26-004` | high | no | M | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · docs/role-permissions.md disagrees with the measured RLS matrix in seven places, twice contradicting itself |
| `A02-003` | medium | no | S | **ACTION** | P3 | P3-rls | OPEN | `02-rls-matrix.md` · contribution_schedules.insurance_funding_mode and the accrual counters are directly writable by the subscriber (spec check 7 violated) |
| `A02-004` | medium | no | S | **ACTION** | P3 | P3-rls | OPEN | `02-rls-matrix.md` · Subscriber can create withdrawals and nominees rows directly, bypassing request_withdrawal and its balance/nonce checks |
| `A02-005` | medium | no | M | **ACTION** | P7 | P7-docs | OPEN | `02-rls-matrix.md` · agent / branch / distributor can create and edit their own hierarchy rows directly, bypassing the creation RPCs (BACKEND.md says this is impossible) |
| `A04-004` | medium | yes | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · request_withdrawal with bucket='emergency' for more than the emergency balance clamps the bucket at 0 but debits the full total, so the two buckets stop summing to the total |
| `A04-005` | medium | yes | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · publish_nav_snapshot's p_unit_price <= 0 guard AND the unit_price > 0 CHECK constraint both pass NaN/Infinity; with confirmMove the entire book goes NaN |
| `A04-006` | medium | no | M | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · Four unrelated down-migrations CREATE OR REPLACE the contribution trigger with the hardcoded 1,000 unit price, silently reverting NAV pricing |
| `A04-007` | medium | yes | M | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · NAV is 16 days stale and the 'Delayed NAV updation' counter cannot see it — it counts only pre-seeded pending rows, so 11 unpriced weekdays are invisible |
| `A04-008` | medium | no | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · v_reconciliation_exceptions checks the shilling split but not the unit ledger, so a broken units invariant is invisible to the admin |
| `A04-009` | medium | yes | M | **ACTION** | P2 | P2-data | OPEN | `04-money-engine.md` · 33 leftover E2E employer contribution runs (1,881 rows, 145.37M UGX) permanently inflate live AUM, growing ~3.7M every full-suite run |
| `A04-010` | medium | yes | S | **ACTION** | P2 | P2-data | OPEN | `04-money-engine.md` · Four leftover E2E subscribers named 'TST tree member' / 'TST retag probe' surface on the admin Needs Attention panel during a live demo |
| `A04-011` | medium | no | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · The idempotency nonce is claimed AFTER the money write with ON CONFLICT DO NOTHING, so two concurrent same-nonce calls both apply the contribution |
| `A05-006` | medium | no | S | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · apply_settlement has no NULL guard on amountPaid — a row with no amount settles the agent's ENTIRE due slice |
| `A05-007` | medium | no | S | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · Over-payment is silently swallowed — the entered amount above the due total is recorded nowhere and produces no skip or warning |
| `A05-008` | medium | yes | S | **ACTION** | P2 | P2-data | OPEN | `05-commission-settlement.md` · Seeded settlement batches are stamped with the wrong branch, so the b-kam-015 demo branch persona is told UGX 45,000 was paid while its own Commissions page shows 0 paid and a 0% settlement rate |
| `A05-009` | medium | no | M | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · 0089's down-migration would silently revert NAV pricing — it re-emits trg_transactions_contribution with the hardcoded 1,000 UGX unit price |
| `A06-006` | medium | yes | S | **ACTION** | P2 | P2-data | OPEN · owner of A15-003 | `06-data-integrity.md` · Four abandoned E2E fixtures are 4 of the 7 rows on the Admin Reconciliation screen |
| `A06-008` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `06-data-integrity.md` · DB invariant #5 is vacuous by 41 days and blind to 21 NULL rows |
| `A06-009` | medium | yes | M | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · A fifth clock, public._demo_now() = 2026-05-18, is live in SQL and 44 days behind the JS anchor |
| `A06-010` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `06-data-integrity.md` · SUBSCRIBER_CHILD_TABLES misses three subscriber-FK tables; two of them have no FK at all |
| `A06-011` | medium | yes | S | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · The only employer created through the live approval path has an empty config, NULL cadence and a district ID in the district-name field |
| `A07-001` | medium | n/r | n/r | **ACTION** | P6 | P6-sec | OPEN | `07-api-auth.md` · Sentry scrubber has no NIN redaction pattern |
| `A09-004` | medium | no | M | **ACTION** | P6 | P6-sec | OPEN | `09-infra-deploy.md` · Enforcing the report-only CSP would break the app's typography three ways and the KYC ID previews; today the policy has no report sink so it collects nothing |
| `A09-005` | medium | no | S | **ACTION** | P6 | P6-infra | OPEN | `09-infra-deploy.md` · Frontend Sentry is not configured in production — @sentry/react is tree-shaken out of the shipped bundle entirely |
| `A09-006` | medium | no | S | **ACTION** | P6 | P6-infra | OPEN | `09-infra-deploy.md` · render.yaml is not the applied configuration — the live build command has drifted from the blueprint |
| `A09-007` | medium | no | S | **ACTION** | P0 | P0-safety | OPEN | `09-infra-deploy.md` · Keepalive fires roughly a third as often as its own stated design rationale requires |
| `A09-008` | medium | no | M | **ACTION** | P6 | P6-sec | OPEN | `09-infra-deploy.md` · Dependabot security alerts are disabled, and 12 version PRs are wedged behind a red lint gate |
| `A09-009` | medium | no | M | **ACTION** | P0 | P0-safety | OPEN | `09-infra-deploy.md` · No documented rollback for the frontend or the API, and 22 migrations cannot be reversed at all |
| `A10-002` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `10-subscriber.md` · Insurance settings shows '0 beneficiaries on file' when a beneficiary exists (currentSubscriber never carries nominees) |
| `A11-003` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `11-agent.md` · Desktop agent home shows scheduled monthly-equivalent (UGX 331K) but labels it 'What members saved this month'; mobile shows actual collected (UGX 291K) |
| `A11-004` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `11-agent.md` · Agent Settings renders a malformed phone with a double country code (+256 256 711 443975) |
| `A11-006` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `11-agent.md` · 'Yet to contribute' flashes the entire roster (11) before the contributions query resolves, then settles to the correct 1 — no loading gate on the dependency |
| `A12-001` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · Branch collections charts drift against the demo clock — wall-clock month labels over MOCK_NOW-anchored data |
| `A12-002` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · Agent-detail gender donut prints percentages as a subscriber count ('100 subscribers') |
| `A12-003` | medium | yes | M | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · District rank computed from a stale stored score, not the 'recomputed daily' gauge (84 live vs 77 stored) |
| `A12-005` | medium | yes | M | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · Per-agent subscriber list is desktop-only — unreachable on mobile |
| `A14-003` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `14-employer.md` · Expired invites labeled "awaiting sign-up" on Overview & roster, contradicting Pending KYC page ("0 awaiting · 4 lapsed") |
| `A15-002` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `15-admin.md` · Admin platform hero has no error/retry state; a failed money read renders "—" / 0 subscribers / "Needs work" silently |
| `A15-003` | medium | yes | S | **ACTION** | P2 | P2-data | DUPLICATE-OF A06-006 | `15-admin.md` · Reconciliation queue shows leftover test-fixture rows ("TST tree member", "TST retag probe") in the live admin drill |
| `A16-001` | medium | yes | S | **ACTION** | P5 | P5-ux | OPEN · owner of A18-004 | `16-public-onboarding.md` · Mobile public pages (FAQ/Contact/About/Request-access) render with no <h1>; About starts at <h3> |
| `A17-001` | medium | yes | M | **ACTION** | P5 | P5-ux | OPEN | `17-design-system.md` · Circular avatars violate the standing "no circular avatars" house rule and are internally inconsistent |
| `A17-002` | medium | yes | L | **DEFER** | — | — | DEFERRED | `17-design-system.md` · Type scale is bypassed: 76 distinct ad-hoc font sizes, 519 of them below the smallest token (sub-12px) |
| `A17-003` | medium | no | M | **ACTION** | P5 | P5-ux | OPEN | `17-design-system.md` · Four dashboard BottomSheets declare aria-modal but implement no focus trap — behavioural divergence from the hardened landing copy |
| `A18-001` | medium | yes | S | **ACTION** | P5 | P5-ux | OPEN | `18-mobile-pwa.md` · iOS Safari zoom-on-focus: dashboard/search/payment inputs render below 16px |
| `A18-002` | medium | yes | M | **ACTION** | P5 | P5-ux | OPEN | `18-mobile-pwa.md` · 769-1023px dead band renders a stretched phone shell (iPad-portrait width) for all 6 roles |
| `A18-003` | medium | yes | S | **ACTION** | P5 | P5-ux | OPEN | `18-mobile-pwa.md` · Bottom sheets and PaySheet do not lock body scroll; page scrolls behind an open sheet on mobile |
| `A19-001` | medium | yes | M | **ACTION** | P5 | P5-ux | OPEN | `19-desktop-shells.md` · Refresh loses the current view on distributor + admin desktop (reverts to overview) |
| `A19-002` | medium | yes | L | **EXCLUDE** | — | — | NO-ACTION | `19-desktop-shells.md` · report says: "suggested_fix: Report-only." |
| `A19-003` | medium | yes | L | **EXCLUDE** | — | — | NO-ACTION | `19-desktop-shells.md` · report says: "suggested_fix: Report-only." |
| `A19-004` | medium | yes | M | **ACTION** | P6 | P6-infra | OPEN | `19-desktop-shells.md` · Distributor + admin Subscribers (~4,602) / Agents (~2,046) lists defeat their virtualizer in dash mode |
| `A19-005` | medium | no | S | **ACTION** | P5 | P5-ux | OPEN | `19-desktop-shells.md` · Distributor + admin Ask-AI Copilot declares aria-modal but does not trap focus |
| `A20-001` | medium | yes | S | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · Public site footer nav links render invisible (1.35:1) on desktop landing pages |
| `A20-002` | medium | yes | M | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · Widespread AA contrast failures incl. status pills and the green money value on Save/Withdraw |
| `A20-003` | medium | no | M | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · aria-modal dialogs without focus trap/restore (incl. PaySheet payment surface) |
| `A20-004` | medium | no | S | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · Closed landing nav drawer keeps focusable children tabbable while aria-hidden |
| `A20-005` | medium | no | S | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · Horizontally/vertically scrollable data tables are not keyboard-accessible |
| `A21-001` | medium | yes | M | **ACTION** | P6 | P6-infra | OPEN | `21-performance.md` · Distributor/admin subscriber list downloads the entire collection client-side (~3.4MB raw / ~6,765 rows into memory) |
| `A22-002` | medium | yes | M | **ACTION** | P4 | P4-dash | OPEN | `22-state-errors.md` · Primary dashboard hero money reads have no error/retry state — a read failure renders 'FUNDS UNDER MANAGEMENT —' / 0 subscribers / 'Health Score 0 Needs work' silently |
| `A22-003` | medium | no | M | **DEFER** | — | — | DEFERRED | `22-state-errors.md` · Mid-session JWT expiry on the direct-Supabase path never re-logs-in; forwardSupabaseAuthError is dead code (0 call sites) |
| `A22-004` | medium | yes | M | **ACTION** | P4 | P4-dash | OPEN | `22-state-errors.md` · Raw technical error strings ('TypeError: Failed to fetch', raw Postgres exception text) leak into user toasts on writes; the friendly fallback never wins |
| `A22-005` | medium | yes | S | **ACTION** | P4 | P4-dash | OPEN | `22-state-errors.md` · Access-request approve/reject does not invalidate adminAttention, so the 'Pending access requests' count stays stale up to 5 minutes |
| `A24-002` | medium | no | S | **ACTION** | P6 | P6-sec | OPEN | `24-frontend-security.md` · CSP is report-only, reports nowhere, and cannot be enforced as written — 58 violations if flipped on |
| `A25-001` | medium | yes | L | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · Baseline Playwright suite ships RED with 30 deterministic failures (28 reproduced), not flake |
| `A25-002` | medium | no | M | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · Mobile E2E coverage is 0-8% for 4 of 6 roles, exactly where the product breaks (mobile runs 7/38 specs but caused 22/30 failures) |
| `A25-003` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · Four 'contract' tests grep migration TEXT and never touch the DB, proving text not deployed behaviour |
| `A25-005` | medium | no | M | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · Money engine's live invariants are essentially unguarded; 2 are violated right now with no test to notice |
| `A25-006` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · api/, server/, e2e/ TypeScript (100 files) is not linted at all |
| `A25-007` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · No typecheck script; tsc checks 32 of 100 .ts files and skips all tests + all e2e |
| `A25-009` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · All 34 jsx-a11y rules forced to 'warn' and lint has no --max-warnings; 311 a11y warnings hide in a green build |
| `A25-011` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · CI section 15-M1 'executed-not-skipped' guard runs only on push-to-main, not on PRs — the surface that gates merges |
| `A25-012` | medium | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · Coverage gate is statements-only at 23% (10 points below actual); branch/function/line ungated |
| `A26-003` | medium | no | S | **ACTION** | P4+P7 | P4-dash + P7-docs | OPEN | `26-documentation.md` · MOCK_NOW documented as 2026-05-26 in four docs; the real value is 2026-07-01, and two code copies drifted 36 days from it |
| `A26-005` | medium | no | M | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · Twelve of CLAUDE.md's thirteen 'binding' rules have no mechanical enforcement; one is already violated |
| `A26-006` | medium | no | M | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · Every schema and architecture census in ARCHITECTURE.md and BACKEND.md is stale by 30-90 percent |
| `A26-007` | medium | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · Migration ledger head documented as 0076 in five places; the ledger's structural unjoinability is documented nowhere and is mis-framed as '6 missing rows' |
| `A26-008` | medium | no | M | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · .claude/skills/qa.md misdescribes the suite it operates: 13 wrong claims, a 'known bug' that is fixed, a runtime off by 12x, and silence on 30 real failures |
| `A26-009` | medium | no | M | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · docs/data-model.md field tables diverge from the live schema, and the Employer section opens by stating the retired model in the present tense |
| `A02-006` | low | no | S | **ACTION** | P3 | P3-rls | OPEN | `02-rls-matrix.md` · subscriber_insurance_products has no SELECT policy for branch, distributor, employer or admin -- 1,473 live rows invisible to four roles |
| `A02-007` | low | no | S | **ACTION** | P7 | P7-docs | OPEN | `02-rls-matrix.md` · distributors is unreadable by subscriber / agent / branch / employer, contradicting docs/role-permissions.md |
| `A02-008` | low | no | S | **ACTION** | P3 | P3-rls | OPEN · owner of A24-003 | `02-rls-matrix.md` · anon reads of 15 tables return HTTP 401 naming an internal helper function instead of an empty result set |
| `A03-002` | low | no | S | **ACTION** | P3 | P3-rls | OPEN | `03-privilege-surface.md` · Anon signup RPC trusts the client for phone canonicalization; a non-canonical phone makes the created account unreachable at login (falls to s-0001 default) |
| `A03-003` | low | no | S | **ACTION** | P3 | P3-rls | OPEN | `03-privilege-surface.md` · No length cap on subscriber text fields; anon signup RPC persists unbounded field values |
| `A04-012` | low | no | S | **ACTION** | P3 | P3-money | OPEN | `04-money-engine.md` · MIN_CONTRIBUTION / MIN_WITHDRAW of 5,000 and the zero-decimal UGX rule are client-only; the RPCs accept 1 UGX and 0.004 UGX |
| `A04-013` | low | no | S | **ACTION** | P3 | P3-money | OPEN · owner of A06-014 | `04-money-engine.md` · request_withdrawal writes a POSITIVE transactions.amount while all 5,402 historical withdrawal rows are negative |
| `A04-014` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `04-money-engine.md` · The admin publish form computes the price move against currentNav while the RPC computes it against the price preceding p_nav_date; for a back-dated publish the two disagree |
| `A04-015` | low | no | S | **ACTION** | P4 | P4-dash | OPEN | `04-money-engine.md` · The NAV publish form's default date uses UTC, so between 00:00 and 03:00 East Africa Time it defaults to yesterday |
| `A05-010` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `05-commission-settlement.md` · The agent's partial-settlement banner shows an internal 34-character batch UUID instead of the human payment reference |
| `A05-011` | low | no | S | **ACTION** | P1 | P1-demo | OPEN | `05-commission-settlement.md` · parseAmount misparses formula and scientific-notation money cells into plausible-looking amounts, and returns 0 in violation of its own contract |
| `A05-012` | low | no | S | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · A commission rate of 0 is accepted and generates UGX 0 commission rows instead of no commission |
| `A05-013` | low | no | M | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · Re-assigning a subscriber to a different agent generates a second commission for the same subscriber |
| `A06-012` | low | yes | S | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · Six of eight employers and distributor d-003 have no sign-in path |
| `A06-013` | low | no | S | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · 39 of 54 users rows carry no entity_id |
| `A06-014` | low | no | S | **ACTION** | P3 | P3-money | DUPLICATE-OF A04-013 | `06-data-integrity.md` · request_withdrawal writes a positive amount against a negative seed convention |
| `A06-015` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `06-data-integrity.md` · 21 employer-member contribution schedules have amount = 0 and a NULL next_due_date |
| `A06-016` | low | no | M | **DEFER** | — | — | DEFERRED | `06-data-integrity.md` · Mass-detach guard passes 50-row batches unjournalled |
| `A06-017` | low | yes | S | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · E2E entity residue across six tables, including a branch invisible to every distributor |
| `A07-002` | low | n/r | n/r | **ACTION** | P6 | P6-sec | OPEN | `07-api-auth.md` · agent-referral unauthenticated service-role INSERT (input-capped) |
| `A07-004` | low | n/r | n/r | **ACTION** | P6 | P6-sec | OPEN | `07-api-auth.md` · Rate limiter IP-spoofable via X-Forwarded-For in no-proxy deployment (local only; prod trust-proxy:1 mitigates) |
| `A09-010` | low | no | S | **ACTION** | P6 | P6-infra | OPEN | `09-infra-deploy.md` · /healthz and /readyz are registered before morgan, so all health and readiness traffic is invisible in the logs |
| `A09-011` | low | no | S | **ACTION** | P6 | P6-infra | OPEN | `09-infra-deploy.md` · CI installs with --legacy-peer-deps while Render installs with plain npm ci; the flag is unnecessary and masks future peer breaks |
| `A09-012` | low | no | S | **ACTION** | P6 | P6-infra | OPEN · owner of A24-005 | `09-infra-deploy.md` · @sentry/react is a devDependency but is imported by code that ships to the browser |
| `A09-013` | low | no | S | **ACTION** | P7 | P7-tests | OPEN | `09-infra-deploy.md` · The repo's only typecheck skips every API test file; there is no root tsconfig and no pre-commit hook |
| `A09-014` | low | no | S | **ACTION** | P6 | P6-infra | OPEN | `09-infra-deploy.md` · SUPABASE_URL is absent from .env.local and local dev survives only on a fallback the code says is marked for removal |
| `A10-004` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `10-subscriber.md` · On mobile, all 5 report sub-views share the same <h1> ('Analytics') |
| `A11-007` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `11-agent.md` · 'This month' resolves to two different calendar months on the same agent dashboard (Contributions=June 2026, Onboarded=August 2026) |
| `A12-004` | low | no | M | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · Mobile 'reports' redirect lands on the overview instead of analytics (desktop is correct) |
| `A12-006` | low | no | M | **EXCLUDE** | — | — | NO-ACTION | `12-branch.md` · report says: "suggested_fix: Either add a bulk-upload entry to CreateAgentMobile or document the desktop-only scope; no correctness impact." |
| `A12-007` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · Branch Settings 'Save changes' and mobile 'Update password' fabricate success without persisting |
| `A12-008` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · Absurd '▲ 14903% over the year' on the branch overview & analytics |
| `A13-002` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN · owner of A15-004 | `13-distributor.md` · Distributor mobile Branches/Agents lists show all-zero metrics (0 subs / 0 agents / 0 funds) for ~2-3s until the separate metrics query resolves |
| `A13-003` | low | no | S | **ACTION** | P7 | P7-tests | OPEN | `13-distributor.md` · CSV export 5,000-row mobile cap is unreachable for distributors (dead safeguard) |
| `A14-004` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `14-employer.md` · Overview "Needs attention" mislabels combined group cover as "Group life cover" |
| `A15-004` | low | yes | S | **ACTION** | P4 | P4-dash | DUPLICATE-OF A13-002 | `15-admin.md` · Mobile Agents list flashes "0 Subscribers · 0 Funds" before per-agent metrics resolve |
| `A16-002` | low | yes | S | **ACTION** | P5 | P5-ux | OPEN | `16-public-onboarding.md` · FAQ/Contact/About have no signup CTA in the 769-920px band; Navbar hamburger drawer is dead code |
| `A17-004` | low | no | M | **DEFER** | — | — | DEFERRED | `17-design-system.md` · 280 hardcoded hex literals re-declare an existing token value (23x the brand indigo) |
| `A17-005` | low | yes | S | **ACTION** | P5 | P5-ux | OPEN | `17-design-system.md` · Cross-role inconsistency: the "Ask AI" affordance is styled two different ways |
| `A17-006` | low | yes | M | **ACTION** | P5 | P5-ux | OPEN | `17-design-system.md` · Cross-role inconsistency: KPI tiles use two different patterns (left accent border vs flat) |
| `A17-007` | low | no | L | **DEFER** | — | — | DEFERRED | `17-design-system.md` · Spacing token coverage is 40% — the --space scale is mixed with ad-hoc px throughout |
| `A17-008` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `17-design-system.md` · Decorative CSS keyframe animations ignore prefers-reduced-motion |
| `A18-004` | low | no | S | **ACTION** | P5 | P5-ux | DUPLICATE-OF A16-001 | `18-mobile-pwa.md` · Public landing pages About/Contact/FAQ render no h1 on mobile (heading-hierarchy a11y gap) |
| `A18-005` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `18-mobile-pwa.md` · Touch targets below 44x44: app-bar back/icon buttons (40px), copilot close (32px) |
| `A18-006` | low | yes | S | **ACTION** | P5 | P5-ux | OPEN | `18-mobile-pwa.md` · Two distinct subscriber report routes share the generic app-bar title 'Analytics' on mobile |
| `A19-006` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `19-desktop-shells.md` · Distributor + admin Copilot does not restore focus to its trigger on close |
| `A19-007` | low | yes | M | **ACTION** | P5 | P5-ux | OPEN | `19-desktop-shells.md` · Two divergent Copilot interaction models across the six roles |
| `A20-006` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · Skip-link target <main id="main"> is not programmatically focusable |
| `A20-007` | low | no | M | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · 310 untracked jsx-a11y warnings dominated by two over-strict rules; real defects ~16 |
| `A20-008` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · All 10 jsx-a11y/aria-role warnings are a React prop-name collision, not invalid ARIA roles |
| `A20-009` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · 6 autoFocus usages can disorient keyboard/screen-reader users |
| `A20-011` | low | no | S | **ACTION** | P5 | P5-ux | OPEN | `20-accessibility.md` · Subscriber balance change is not announced to screen readers |
| `A21-002` | low | no | M | **DEFER** | — | — | DEFERRED | `21-performance.md` · Oversized aggregated CSS chunks (120KB landing sheet, 149KB distributor DashboardShell) |
| `A21-003` | low | no | S | **ACTION** | P6 | P6-infra | OPEN | `21-performance.md` · Employer demo seed data (22KB gzip) ships to the browser on the live-backend path |
| `A21-004` | low | no | S | **DEFER** | — | — | DEFERRED | `21-performance.md` · Redundant/duplicate indexes and minor DB advisor lints |
| `A22-006` | low | yes | S | **ACTION** | P4 | P4-dash | OPEN | `22-state-errors.md` · Support ticket confirms 'sent to your agent' then silently vanishes on refresh (Open 3→2, no error copy) |
| `A24-003` | low | no | S | **ACTION** | P3 | P3-rls | DUPLICATE-OF A02-008 | `24-frontend-security.md` · anon cannot read branches / distributors / notifications at all — the RLS policy chain hard-errors instead of returning an empty set |
| `A24-004` | low | no | S | **ACTION** | P6 | P6-sec | OPEN | `24-frontend-security.md` · react-router 7.17.0 carries 5 advisories incl. a high; the fix (7.18.2) is inside the declared semver range |
| `A24-005` | low | no | S | **ACTION** | P6 | P6-sec | DUPLICATE-OF A09-012 | `24-frontend-security.md` · @sentry/react is a devDependency but is statically imported by production runtime code |
| `A24-006` | low | no | M | **DEFER** | — | — | DEFERRED | `24-frontend-security.md` · Dependabot backlog: 12 open dependency PRs, oldest 76 days; 39 packages behind including 3 that each close a reported advisory |
| `A24-011` | low | no | S | **ACTION** | P6 | P6-sec | OPEN | `24-frontend-security.md` · xlsx resolves from cdn.sheetjs.com, not the npm registry — every build depends on that CDN being reachable |
| `A25-008` | low | no | M | **DEFER** | — | — | DEFERRED | `25-test-coverage.md` · No stylelint, no import-boundary rule, no pre-commit hooks |
| `A25-010` | low | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · ESLint lints 66 untracked/.gitignored files; no-unused-vars is 'error', so a stray scratch file can fail the gate |
| `A26-010` | low | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · '14 API routes' appears in eleven places across four documents and two code comments; there are sixteen, and two public write endpoints are undocumented |
| `A26-011` | low | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · docs/FRONTEND.md file-inventory counts are stale in six places and the document contradicts itself on the unit-test count |
| `A26-012` | low | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · README.md still lists 'hardcoded unit price' as intentional demo scope; migrations 0103-0106 retired it |
| `A26-013` | low | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · render-operational.md states the keepalive cadence wrongly in three places, carries two dead external references, and leaves a completed cutover instruction standing |
| `A26-014` | low | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · Seed-entity counts drifted across CLAUDE.md, SPEC.md, data-model.md and role-permissions.md; the third distributor is documented nowhere |
| `A02-009` | info | no | S | **KEEP** | — | — | NO-ACTION | `02-rls-matrix.md` · report says: "suggested_fix: No code change." |
| `A02-010` | info | no | S | **ACTION** | P2 | P2-data | OPEN | `02-rls-matrix.md` · One branches row has distributor_id IS NULL and is invisible to every distributor |
| `A03-004` | info | no | S | **EXCLUDE** | — | — | NO-ACTION | `03-privilege-surface.md` · report says: "suggested_fix: Optionally REVOKE USAGE, UPDATE ON SEQUENCE public.commission_id_seq, public.subscriber_id_seq FROM anon, authenticated to match the *_log sequences (defense in depth; no functional effect)." |
| `A03-005` | info | no | S | **ACTION** | P7 | P7-docs | OPEN | `03-privilege-surface.md` · Dead commission-run migration 0021_commission_rpcs_app_role.sql retained in repo with no down-migration |
| `A03-006` | info | no | M | **KEEP** | — | — | NO-ACTION | `03-privilege-surface.md` · report says: "suggested_fix: No action required." |
| `A03-007` | info | no | S | **DEFER** | — | — | DEFERRED | `03-privilege-surface.md` · get_employer_invite exposes a token-existence oracle and returns HTTP 500 for not-found tokens |
| `A04-016` | info | no | S | **ACTION** | P2 | P2-data | OPEN | `04-money-engine.md` · The single live unit-bucket invariant break on s-0005 is AUDIT-CAUSED, not a product defect — it belongs in the write ledger |
| `A04-017` | info | no | L | **KEEP** | — | — | NO-ACTION | `04-money-engine.md` · report says: "suggested_fix: No action." |
| `A04-018` | info | no | S | **KEEP** | — | — | NO-ACTION | `04-money-engine.md` · report says: "suggested_fix: No action, other than to NOT drop these two tables until the NAV change is formally accepted." |
| `A05-014` | info | no | S | **ACTION** | P2 | P2-data | OPEN | `05-commission-settlement.md` · settlement_uploads is an unbounded, never-reconciled idempotency ledger claiming 1,530,000 UGX of settlement against 50,000 actually paid |
| `A05-015` | info | no | S | **ACTION** | P3 | P3-money | OPEN | `05-commission-settlement.md` · Migration 0087 documents an ownership guard on get_agent_commission_detail that its body never emits |
| `A06-018` | info | no | S | **KEEP** | — | — | NO-ACTION | `06-data-integrity.md` · report says: "suggested_fix: Otherwise no action." |
| `A06-019` | info | no | S | **KEEP** | — | — | NO-ACTION | `06-data-integrity.md` · report says: "suggested_fix: None required." |
| `A06-020` | info | yes | S | **ACTION** | P2 | P2-data | OPEN | `06-data-integrity.md` · Four stale pending NAV snapshots sit behind a later published price |
| `A07-003` | info | n/r | n/r | **KEEP** | — | — | NO-ACTION | `07-api-auth.md` · report says: "impact: none for this deployment" |
| `A09-015` | info | no | S | **ACTION** | P6 | P6-infra | OPEN | `09-infra-deploy.md` · The retired Tokyo Supabase project is still ACTIVE in the same free organisation as the live one |
| `A09-016` | info | no | S | **KEEP** | — | — | NO-ACTION | `09-infra-deploy.md` · report says: "suggested_fix: No action needed for the demo." |
| `A09-017` | info | no | S | **ACTION** | P6 | P6-sec | OPEN | `09-infra-deploy.md` · Two header-level inconsistencies: content-hashed assets are not served immutable, and the API sets CORP same-origin on a deliberately cross-origin service |
| `A09-018` | info | no | S | **ACTION** | P7 | P7-docs | OPEN | `09-infra-deploy.md` · Environment-documentation gaps and one stale note in docs/BACKEND.md §2 |
| `A10-003` | info | no | S | **ACTION** | P7 | P7-tests | OPEN | `10-subscriber.md` · The 6 baseline mobile subscriber-dashboard Playwright failures are title-divergence (test brittleness), not product defects |
| `A11-008` | info | yes | S | **ACTION** | P4 | P4-dash | OPEN | `11-agent.md` · Agent commissions error card surfaces a raw 'TypeError: Failed to fetch' string |
| `A12-I01` | info | no | S | **ACTION** | P2 | P2-data | OPEN | `12-branch.md` · Two E2E-leftover branches pollute the Kampala district in live data |
| `A12-I02` | info | yes | S | **ACTION** | P4 | P4-dash | OPEN | `12-branch.md` · Manager-name vs persona-name inconsistency across branch surfaces |
| `A13-004` | info | yes | M | **KEEP** | — | — | NO-ACTION | `13-distributor.md` · report says: "suggested_fix: None required (documented intentional architecture)." |
| `A15-005` | info | no | S | **KEEP** | — | — | NO-ACTION | `15-admin.md` · report says: "suggested_fix: No admin-side action; fix belongs to A22-001 (clear React Query cache on login, not only logout)." |
| `A16-003` | info | yes | S | **ACTION** | P2 | P2-data | OPEN | `16-public-onboarding.md` · All seeded employer invites are expired; /invite/:token entry flow is not demoable from seed data |
| `A17-009` | info | yes | S | **ACTION** | P6 | P6-infra | OPEN | `17-design-system.md` · Web fonts load async (FOUT/CLS on cold load) |
| `A18-007` | info | no | S | **KEEP** | — | — | NO-ACTION | `18-mobile-pwa.md` · report says: "suggested_fix: Optionally add shortcuts, screenshots, a maskable-192 and a monochrome icon if richer install UX is wanted." |
| `A18-008` | info | no | L | **KEEP** | — | — | NO-ACTION | `18-mobile-pwa.md` · report says: "suggested_fix: None required for the demo." |
| `A18-009` | info | no | M | **KEEP** | — | — | NO-ACTION | `18-mobile-pwa.md` · report says: "suggested_fix: Optionally surface the existing install affordance inside the mobile dashboards for subscribers." |
| `A19-I1` | info | no | S | **KEEP** | — | — | NO-ACTION | `19-desktop-shells.md` · report says: "suggested_fix: No change needed." |
| `A19-I2` | info | no | S | **REFUTED** | — | — | NO-ACTION | `19-desktop-shells.md` · report says: "suggested_fix: No change needed." |
| `A20-010` | info | no | S | **ACTION** | P6 | P6-infra | OPEN | `20-accessibility.md` · <html lang="en"> while every formatter uses en-UG |
| `A21-005` | info | no | L | **EXCLUDE** | — | — | NO-ACTION | `21-performance.md` · report says: "impact: Deliberate 6-roles-one-table design, not a bug; consolidation into one app_role-gated policy would reduce per-row work." |
| `A21-006` | info | yes | M | **ACTION** | P0 | P0-safety | OPEN | `21-performance.md` · Free-tier cold start compounds first-paint of the first data screen |
| `A21-007` | info | no | S | **KEEP** | — | — | NO-ACTION | `21-performance.md` · report says: "suggested_fix: Optional: add a metric-matched @font-face fallback (size-adjust/ascent-override) or self-host the two faces to remove the third-party critical-path dependency." |
| `A22-007` | info | no | S | **ACTION** | P4 | P4-dash | OPEN | `22-state-errors.md` · No global QueryCache.onError — every read failure is silent unless the consuming component individually guards isError |
| `A24-007` | info | no | S | **ACTION** | P6 | P6-sec | OPEN | `24-frontend-security.md` · The single raw-HTML sink is correctly escaped today — and it writes into a popup that can read the session token |
| `A24-008` | info | no | M | **KEEP** | — | — | NO-ACTION | `24-frontend-security.md` · report says: "suggested_fix: No action required for security." |
| `A24-009` | info | no | S | **ACTION** | P6 | P6-sec | OPEN | `24-frontend-security.md` · Sentry is wired end to end but completely inert in production — the SDK is not even in the bundle |
| `A24-010` | info | no | S | **REFUTED** | — | — | NO-ACTION | `24-frontend-security.md` · report says: "suggested_fix: No action." |
| `A25-013` | info | no | S | **ACTION** | P7 | P7-tests | OPEN | `25-test-coverage.md` · Exactly one genuinely flaky spec in the whole suite; the predicted 'prime flake candidates' are real defects |
| `A26-015` | info | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · No live doc carries a 'verified against live on <date>' line; docs/role-permissions.md has no temporal marker anywhere in 362 lines |
| `A26-016` | info | no | S | **ACTION** | P7 | P7-docs | OPEN | `26-documentation.md` · The anon-EXECUTE surface is documented as 3; it is 13, and the sentence contradicts itself |

## Addendum — refuted, out of corpus

`A06-007` was refuted during verification and moved to `SPECULATIVE.md` *before*
`findings.json` was frozen at 221 rows, so it has no row in the table above.
It is adjudicated here to keep the record complete.

| id | severity | demo_visible | effort | disposition | phase | owner | status | evidence-ref |
|---|---|---|---|---|---|---|---|---|
| `A06-007` | high (as raised) | n/r | n/r | **REFUTED** | — | — | NO-ACTION | `SPECULATIVE.md` · report says: "Not reproducible against the live system from a clean state." |

## Duplicate reconciliation

Nine pairs describe the same defect twice. Each pair has exactly one owner; the
other row is `DUPLICATE-OF` and does no separate work. The duplicate inherits the
owner's phase so both ids route to one team.

| owner (does the work) | duplicate (no work) | phase | why one fix closes both |
|---|---|---|---|
| `A05-002` | `A11-001` | P2 | one E2E settlement-residue cleanup in the live DB |
| `A06-001` | `A14-002` | P2 | one E2E employer-money cleanup in the live DB |
| `A06-004` | `A11-005` | P3 | one policy-status derivation; A11-005 says 'verifies A06-004' |
| `A09-012` | `A24-005` | P6 | one manifest move of @sentry/react out of devDependencies |
| `A06-006` | `A15-003` | P2 | one delete of the same 4 E2E fixtures from the reconciliation queue |
| `A04-013` | `A06-014` | P3 | one sign convention inside request_withdrawal |
| `A02-008` | `A24-003` | P3 | one RLS policy chain that raises instead of filtering for anon |
| `A16-001` | `A18-004` | P5 | one missing <h1> on the same public FAQ/Contact/About pages |
| `A13-002` | `A15-004` | P4 | one loading state in the shared mobile entity-list component |

Not adjudicated as duplicates, but overlapping — fix them together: `A09-005`,
`A24-009` and `A09-012`/`A24-005` are all facets of Sentry being absent from the
production bundle; `A04-010`, `A06-006`/`A15-003` and `A12-I01` are all the same
class of leftover E2E fixture rows in live data.

## E2E baseline failure routing

All 30 failures in the frozen baseline are accounted for. Only one is a flake.

| baseline failure cluster | n | owning finding | phase | owner | verdict |
|---|---|---|---|---|---|
| subscriber-dashboard smoke (6 specs x mobile-chromium + mobile-webkit) | 12 | `A10-003` | P7 | `P7-tests` | Mobile app-bar title divergence — test brittleness, not a product defect. |
| landing smoke FAQ / Contact / About (3 specs x 2 mobile engines) | 6 | `A16-001 + A18-004` | P5 | `P5-ux` | Real defect: public pages render no <h1> on mobile. A16-001 owns, A18-004 is DUPLICATE-OF it. |
| distributor-exports-csv :37 and :141 (x 2 mobile engines) | 4 | `A10-001` | P4 | `P4-dash` | Real defect: reports render empty in live mode, so the export has nothing to write. |
| agent-onboard-subscriber.spec.ts:109 (chromium + webkit) | 2 | `A11-002` | P1 | `P1-demo` | Real demo blocker: final create RPC returns 409 on the mock OCR's constant NIN. |
| modal-escape.spec.ts:224 (chromium + webkit) | 2 | `A25-013` | P7 | `P7-tests` | The ONLY true flake in the whole suite. Stabilise the spec; do not chase a product bug. |
| webkit-only: subscriber-signin:78, subscriber-signup:116, map-drill:250 x2 | 4 | `(new) P1-webkit` | P1 | `P1-webkit` | No finding owns these. New agent P1-webkit triages WebKit-specific failures in Phase 1. |
| **total** | **30** | | | | |

22 of the 30 are mobile-viewport failures and 8 are WebKit — i.e. the baseline is
red exactly where the product is weakest, not where the tests are flaky.

## Frozen baseline allowlist

`a25/baseline-failures.txt` is **FROZEN as of 2026-08-25** and is the machine-checkable
allowlist of pre-existing e2e failures. Format: one Playwright test per line,
`[project] › spec:line:col › describe › test`, LC_ALL=C-sorted, 30 data lines.
Lines beginning with `#` are the frozen header and must be skipped by any parser.

Baseline run: `npx playwright test --workers=1` (all 4 projects) — 326 passed /
30 failed / 14 skipped, exit 1, 24.4 min, logged to `baseline/playwright-full.txt`.
The 30 data lines regenerate from that log (verified byte-identical on 2026-08-25):

```sh
awk '/^  [0-9]+ failed$/{f=1;next} /^  [0-9]+ (skipped|passed|flaky)/{f=0} f' \
  docs/audits/2026-08-23/baseline/playwright-full.txt \
  | sed 's/^    //; s/ *$//' | LC_ALL=C sort \
  > docs/audits/2026-08-23/a25/baseline-failures.txt
```

That command does not reproduce the `#` header — re-add it after regenerating.

A phase may only ever **shorten** that list. A new line appearing in it is a
regression introduced by remediation, not a pre-existing failure.

## Pre-existing dirty files (the user's WIP — not ours)

Snapshot taken from `git status --porcelain` at the start of the ledger phase,
**before any remediation phase had written anything**. Exactly two files were
dirty at that moment, and both are the user's own WIP. No phase may commit,
revert or edit them, and no phase should mistake them for its own change.
Anything *else* that is dirty later belongs to a remediation phase, not to the
user.

| file | change | provenance |
|---|---|---|
| `package.json` | `+ "@axe-core/playwright": "^4.13.0"` in `devDependencies` | user WIP; `00-baseline.md` calls it "the only sanctioned dep change; remove after audit" |
| `package-lock.json` | +18 / −3 lines, the lock entry for the same package | same |

Consequence for `A24-006` (dependency backlog) and `A09-012`/`A24-005` (move
`@sentry/react` out of `devDependencies`): both fixes edit `package.json`, which is
held by this WIP. `A24-006` is DEFERRED for that reason; `A09-012` must coordinate
with the user before touching the manifest.

## Disposition rationale — every non-ACTION row

### KEEP (16)

| id | title | why KEEP |
|---|---|---|
| `A02-009` | Live data drifted materially during the audit window (other agents writing through the app) | Audit-window observation about live drift, not a product defect; the remedy is how future agents cite counts. |
| `A03-006` | 34 anon-readable tables are RLS-only (no table-grant backstop) — a dropped policy fails to deny, not to leak | Architectural note. RLS is enabled AND forced on all 34 tables, so a dropped policy fails closed. |
| `A04-017` | 602 pre-0102 employer rows hold 10,843,200 UGX in the emergency bucket; 0102 documents this as a deliberate non-backfill | Migration 0102 documents the 602-row emergency-bucket residue as a deliberate non-backfill. |
| `A04-018` | 0105's rollback artefacts are intact, so the NAV backfill remains reversible | Positive finding: 0105 stays reversible. The only obligation is to NOT drop the two rollback tables. |
| `A06-018` | The insurance-premium invariant is violated in live data by three deliberate demo fixtures | The three violating rows are deliberate RECON-DEMO fixtures, not real premium data. |
| `A06-019` | The duplicate-NIN invariant covers 22 of 5,064 subscriber rows | Coverage note on an invariant, not a defect; NIN is not part of the demo story. |
| `A07-003` | CORS allows no-Origin requests (by design) | CORS no-Origin acceptance is by design for the current token auth; revisit only if cookie auth arrives. |
| `A09-016` | Planner statistics survived the restore — the audit plan's 'empty stats' premise is wrong and does not affect a cold demo | Correction of an audit-plan premise. Planner stats survived the restore; nothing to change. |
| `A13-004` | Desktop panel state (Commissions/Reports/etc.) is not URL-routed; a hard refresh drops the open panel back to Overview | Documented intentional architecture (panel state deliberately not URL-routed). |
| `A15-005` | Admin hero UGX 2.45B / 321 branches verified correct for admin scope (source figure for A22-001 bleed) | Verification row: the admin hero figure is correct. The defect it feeds is A22-001. |
| `A18-007` | PWA manifest is minimal: no shortcuts/screenshots/share_target/protocol_handlers, single maskable icon | Minimal PWA manifest is adequate for a sales demo; richer install UX is optional polish. |
| `A18-008` | No offline data mode (no navigator.onLine, no write queue); failures surface as toasts, not silent | Offline mode is out of demo scope; failures already surface as toasts rather than silently. |
| `A18-009` | No in-dashboard install affordance for any of the 6 roles (landing-mobile only) | The install affordance already exists on landing-mobile; duplicating it in-dashboard is optional. |
| `A19-I1` | Ultrawide (2560px) shows large but symmetric intentional gutters — no defect (recorded to prevent re-flagging) | Recorded explicitly so ultrawide gutters are not re-flagged as a defect by a later pass. |
| `A21-007` | No metric-matched font fallback (measured CLS negligible) | Measured CLS is negligible; a metric-matched fallback is optional polish. |
| `A24-008` | xlsx security assessment — clean (no advisory, integrity-pinned, formula injection on write NOT reachable), with one bounded main-thread DoS caveat | xlsx assessed clean: no advisory, integrity-pinned, write-side formula injection not reachable. |

### DEFER (10)

| id | title | why DEFER |
|---|---|---|
| `A03-007` | get_employer_invite exposes a token-existence oracle and returns HTTP 500 for not-found tokens | Real API-hygiene gap, but the report itself marks the uniform-404 remedy optional; no demo impact. |
| `A06-016` | Mass-detach guard passes 50-row batches unjournalled | Per-statement guard is working as built; the cumulative-budget upgrade is post-demo hardening. |
| `A17-002` | Type scale is bypassed: 76 distinct ad-hoc font sizes, 519 of them below the smallest token (sub-12px) | L-effort sweep across 76 ad-hoc font sizes; too broad to land safely before the demo. |
| `A17-004` | 280 hardcoded hex literals re-declare an existing token value (23x the brand indigo) | 280 hex literals to swap for tokens; mechanical but wide-blast-radius, no user-visible defect. |
| `A17-007` | Spacing token coverage is 40% — the --space scale is mixed with ad-hoc px throughout | L-effort spacing-token migration plus a new lint rule; post-demo design-system work. |
| `A21-002` | Oversized aggregated CSS chunks (120KB landing sheet, 149KB distributor DashboardShell) | CSS chunk slimming is measurable-but-invisible polish; no demo impact at current sizes. |
| `A21-004` | Redundant/duplicate indexes and minor DB advisor lints | Index changes on the live demo DB carry deploy risk with no measurable benefit at demo volumes. |
| `A22-003` | Mid-session JWT expiry on the direct-Supabase path never re-logs-in; forwardSupabaseAuthError is dead code (0 call sites) | Re-login on mid-session JWT expiry is real auth surgery; demo sessions are far shorter than the token life. |
| `A24-006` | Dependabot backlog: 12 open dependency PRs, oldest 76 days; 39 packages behind including 3 that each close a reported advisory | Blocked: the fix edits package.json / package-lock.json, which currently hold the user's live WIP. |
| `A25-008` | No stylelint, no import-boundary rule, no pre-commit hooks | New tooling (stylelint, import boundaries, pre-commit) needs the existing warning backlog burned down first. |

### EXCLUDE (5)

| id | title | why EXCLUDE |
|---|---|---|
| `A03-004` | commission_id_seq and subscriber_id_seq retain Supabase-default anon/authenticated rwU (nextval/setval) | Sequence grants have no functional effect and no reachable exposure; same rationale as the A03-006 KEEP. |
| `A12-006` | Bulk agent onboarding (Excel/CSV) is desktop-only | Porting bulk Excel/CSV agent onboarding to mobile is feature work, not defect repair. |
| `A19-002` | Distributor + admin panel/rail views are not deep-linkable or shareable (all render at /dashboard) | Same intentional non-routed panel architecture that A13-004 records as KEEP; the report marks it report-only. |
| `A19-003` | Browser Back exits the dashboard instead of undoing a panel switch | Depends entirely on A19-002, which is excluded; the report marks it report-only. |
| `A21-005` | Six stacked permissive RLS SELECT policies add per-row overhead on large list reads | Consolidating the six per-role SELECT policies would churn exactly the RLS matrix Phase 3 is repairing. |

### REFUTED (3)

| id | title | why REFUTED |
|---|---|---|
| `A06-007` | (refuted; see SPECULATIVE.md) | Not reproducible from a clean state; moved to SPECULATIVE.md before the corpus was frozen. |
| `A19-I2` | Historical map onEachFeature empty-name->id race is fixed (refuted) | The historical map onEachFeature empty-name->id race is fixed; the finding refutes itself. |
| `A24-010` | Transient PostgREST 25P02 500s observed mid-audit — hypothesis actively REFUTED, not a product defect | The 25P02 500s were audit-induced; the hypothesis was actively refuted, not merely unproven. |

## Titles for the non-ACTION rows

The ledger's evidence column carries the report's literal no-action quote for
`KEEP` / `EXCLUDE` / `REFUTED` rows instead of a title. Titles are here.

| id | severity | disposition | title |
|---|---|---|---|
| `A02-009` | info | KEEP | Live data drifted materially during the audit window (other agents writing through the app) |
| `A03-004` | info | EXCLUDE | commission_id_seq and subscriber_id_seq retain Supabase-default anon/authenticated rwU (nextval/setval) |
| `A03-006` | info | KEEP | 34 anon-readable tables are RLS-only (no table-grant backstop) — a dropped policy fails to deny, not to leak |
| `A04-017` | info | KEEP | 602 pre-0102 employer rows hold 10,843,200 UGX in the emergency bucket; 0102 documents this as a deliberate non-backfill |
| `A04-018` | info | KEEP | 0105's rollback artefacts are intact, so the NAV backfill remains reversible |
| `A06-018` | info | KEEP | The insurance-premium invariant is violated in live data by three deliberate demo fixtures |
| `A06-019` | info | KEEP | The duplicate-NIN invariant covers 22 of 5,064 subscriber rows |
| `A07-003` | info | KEEP | CORS allows no-Origin requests (by design) |
| `A09-016` | info | KEEP | Planner statistics survived the restore — the audit plan's 'empty stats' premise is wrong and does not affect a cold demo |
| `A12-006` | low | EXCLUDE | Bulk agent onboarding (Excel/CSV) is desktop-only |
| `A13-004` | info | KEEP | Desktop panel state (Commissions/Reports/etc.) is not URL-routed; a hard refresh drops the open panel back to Overview |
| `A15-005` | info | KEEP | Admin hero UGX 2.45B / 321 branches verified correct for admin scope (source figure for A22-001 bleed) |
| `A18-007` | info | KEEP | PWA manifest is minimal: no shortcuts/screenshots/share_target/protocol_handlers, single maskable icon |
| `A18-008` | info | KEEP | No offline data mode (no navigator.onLine, no write queue); failures surface as toasts, not silent |
| `A18-009` | info | KEEP | No in-dashboard install affordance for any of the 6 roles (landing-mobile only) |
| `A19-002` | medium | EXCLUDE | Distributor + admin panel/rail views are not deep-linkable or shareable (all render at /dashboard) |
| `A19-003` | medium | EXCLUDE | Browser Back exits the dashboard instead of undoing a panel switch |
| `A19-I1` | info | KEEP | Ultrawide (2560px) shows large but symmetric intentional gutters — no defect (recorded to prevent re-flagging) |
| `A19-I2` | info | REFUTED | Historical map onEachFeature empty-name->id race is fixed (refuted) |
| `A21-005` | info | EXCLUDE | Six stacked permissive RLS SELECT policies add per-row overhead on large list reads |
| `A21-007` | info | KEEP | No metric-matched font fallback (measured CLS negligible) |
| `A24-008` | info | KEEP | xlsx security assessment — clean (no advisory, integrity-pinned, formula injection on write NOT reachable), with one bounded main-thread DoS caveat |
| `A24-010` | info | REFUTED | Transient PostgREST 25P02 500s observed mid-audit — hypothesis actively REFUTED, not a product defect |


---

# Phase 0 — decision record

Written by the integrator. Dated 2026-08-25.

## Live infrastructure actions taken

| Action | Finding | Result |
|---|---|---|
| Paused Supabase project `zengmiugieqjqzaccbqe` ("Uganda dashboard (inactive)", Tokyo) | A09-015 | **DONE.** Verified `status: PAUSING`. Pinned by ref, not name — the live project is confusingly called "Pension dashbaord" (typo) and asserting `target != ilkhfnoyxlxwqadebnkp` was a required pre-check. Last write to the Tokyo project was 2026-06-03, immediately before the 2026-06-05 Singapore cutover, so it held nothing needed. **Paused, not deleted** — the data is retained and the project is restorable. |

## `P0-e2e-detach` — WON'T DO (user decision, 2026-08-25)

The plan called for a dedicated Supabase project so the E2E suite would stop writing to the live
demo database. **The user decided against creating one**, on the reasoning that E2E is only tests
and is not required for the platform to function.

This is a defensible call, because **the leak was fixed at its source** rather than merely
contained:

- `P0-e2e-teardown` fixed the actual ordering bug (A06-002) — cleanup was deleting the
  `contribution_runs` header before the transactions referencing it, and the FK is
  `ON DELETE SET NULL`, which is precisely how 1,824 rows became unrecoverable.
- 22 fire-and-forget deletes now assert, so a failed cleanup fails the run instead of leaking.
- `P0-e2e-fixtures` adds the `globalTeardown` leak sweep that fails the run on anything the
  suite leaves behind.

**Residual risk, stated plainly:** the suite still reads and writes the live database during a
run. It now cleans up after itself correctly and fails loudly if it does not, but a separate
project would have been the stronger guarantee. Revisit if CI runs ever become frequent.

Consequently NOT done, and deliberately so:
- no new project, no fixture seeding, no CI secrets rotation
- the failure allowlist was **not** re-captured against a new project — it stays frozen against
  the live-backed baseline, which is what `scripts/e2e-delta.mjs` gates on

## Sandbox-blocked

| Item | Status |
|---|---|
| `mcp__supabase__confirm_cost` / `create_project` | Blocked by the environment's classifier on both attempts. Moot given the decision above. |
| Vercel deployment history | Vercel MCP token expired and the `vercel` CLI is not installed, so the plan's "~17 prior production deploys retained" claim could NOT be verified. Recorded as **UNVERIFIED** in `docs/rollback.md` rather than repeated as fact. |

## Corrections to the plan found while executing Phase 0

| Plan said | Reality | Where recorded |
|---|---|---|
| Purge residue by joining `contribution_runs` for CI-window provenance | Matches **57 of 1,881** rows. The other 1,824 have a NULL run link — that is what the leak did to them. Use the frozen 33-ref `txn_ref IN (…)` list. | `a04/phase2-emp-predicate.md` |
| Migrations ≤0028 are forward-only | True as an upper bound, but not of every file in the range — 0016 and 0022–0026 do have downs. 22 files lack one. | `docs/rollback.md` |
| Restore drill into a Postgres 17 container | Docker unavailable. Used a scratch PostgreSQL 18 cluster; 17→18 restore is forward-compatible. **Also found: a `--schema=public` dump has no `auth` schema, so 108 RLS policies silently fail to restore — a half-restore that looks complete.** | `a25/restore-drill.md` |
| ~19 fire-and-forget deletes | 22, across the same 8 files. | commit `8c2ddca` |
| A25-001: treat all 30 e2e failures as product defects | 12 are test brittleness (A10-003) and 1 is a true flake (A25-013). Following it verbatim routes 14 of 30 to the wrong owner. | ledger routing table |
| A24-001: "drop `noopener`" | `noreferrer` implies noopener per the HTML spec, so the Critical would ship unfixed. The third argument must go entirely. | Phase 1 |
| A26-013 fix text in `DOC-CORRECTIONS.md` | Predates the endpoint fix and still says "pings /healthz" — applying it verbatim re-introduces A09-001. | commit `37c9303` |

---

# Phase 1 — status (2026-08-25)

All seven agents complete. Full unit suite after integration: **144 files / 2,066 tests, all
passing.**

| Agent | Findings | Outcome |
|---|---|---|
| `P1-settlement-tenancy` | A05-001, A05-011 | 0109 authored + proven under BEGIN/ROLLBACK. Exploit reproduced live then blocked. Down-migration captured from live and byte-verified. **Not yet applied.** |
| `P1-onboard-nin` | A11-002 | Closed. Verified by two consecutive live onboardings with no DB reset. Closes 1 allowlist row (chromium). |
| `P1-certificate` | A24-001, A24-007 | Closed. Tests proven to fail on the original bugs by temporary revert. |
| `P1-cache-bleed` | A22-001 | Closed. Source-order test added because React 18 batching makes the orderings behaviourally identical. |
| `P1-employer-money` | A14-001 (+ part of A14-003) | Closed. One source across Overview / Runs / Analytics. |
| `P1-agent-commissions` | A05-002/A11-001, A05-010 | Closed by relabelling; rationale recorded. |
| `P1-webkit` | 4 unowned allowlist rows | **Diagnosed, not fixed.** All four are test artefacts, no demo impact. See `a25/webkit-diagnosis.md`. |

## Corrections to the audit found in Phase 1

| Claim | Reality |
|---|---|
| A24-001: "drop `noopener`" | `noreferrer` implies noopener; the Critical would ship unfixed. Third argument removed entirely. |
| A05-001 client half: pre-block rows absent from `pendingMap` | `pendingMap` lists only agents with dues *now*, so this refuses a distributor's own already-settled agents. Uses the union with the caller's scoped roster instead. |
| A14-001: sum `contribution_runs` headers | Header sums do not self-heal after Phase 2 deletes transaction ROWS. Row-level source used instead. |
| A25-013: `modal-escape` is "the ONLY true flake" | `map-drill:250` is flaky too — chromium fails it 2 of 5 runs with the identical error. Phase 7 scope needs updating. |
| A25-004: ~19 fire-and-forget deletes | 22. |
| A05-003: three orphan E2E batches | Five. |
| A05-008: one mis-stamped seed batch | Both are mis-stamped. |

## Migration numbering — amended

The plan allocated no numbers to Phase 0, but `P0-e2e-fixtures` needs one for A04-010's atomic
cleanup RPC. It takes **0113**, so **Phase 3 now starts at 0114** (its range had 13 slots for
~8 migrations, so there is slack).

| Phase | Range |
|---|---|
| 1 | `0109` |
| 2 | `0110`–`0112` |
| 0 (late) | `0113` |
| 3 | `0114`–`0125` |
| 4 | `0126`–`0128` |
| 6 | `0129`–`0130` |

## Phase 2 — authored, dry-run proven, NOT APPLIED

`0110`, `0111`, `0112` plus `supabase/recovery/0110_unpurge.sql`, all verified end-to-end against
a scratch PostgreSQL 18 restored from a live dump. On that restore: 0 residue rows, 0 orphan
batches, reconciliation down to only the 3 intended `t-demo-recon-*` fixtures, 5,059/5,059
balances satisfying all three live invariants, 0 NaN, 0 negative, 1 live employer invite.
Purge→unpurge round trip returns AUM to 2,450,226,487 exactly.
