> **Agent guide.** Historical audit from 2026-05-31, covering frontend architecture and code quality across `src/` (money-math, hooks, services, dashboards) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# 03 — Frontend Architecture & Code Quality (Agent C, Phase 1)

**Audit:** Deep Platform Audit — Universal Pensions Uganda
**Date:** 2026-05-31
**Branch:** `feat/simplify-commissions` (working tree)
**Agent:** Agent C — Frontend Architecture & Code Quality. READ-ONLY.
**Scope (per plan):** `src/` — `App.jsx`, `contexts/`, `services/`, `hooks/`, the four dashboard trees, `signup/`, `components/`, **and the previously-unscoped `utils/` (16 files), `constants/`, `config/env.js`, `data/`, `pages/`.** Highest value: `src/utils/` money-math/rounding/frequency correctness.

Severity is calibrated to a **demo tool** (see plan preamble). Every finding is classified `real-bug` | `quality/tech-debt` | `intentional-demo-scope` | `already-known`. Intentional-demo-scope items are NOT reported as bugs.

---

## Headline

The frontend is in good shape on the hard rules. The codebase is **clean** on the two CSS anti-patterns (`transition: all` has zero source occurrences; every `outline: none` is paired with a visible `box-shadow`/`border-color` replacement or is a programmatic-focus container), the mockData import boundary is respected (only `services/*` import `data/*`; the two grep hits in `utils/policies.js` + `hooks/useSubscriber.js` are comments, not imports), `normalizeFrequency` is applied on every schedule read/write in `subscriber.js`/`agent.js`, and there is no hand-rolled `fetch` against `/api/*` (the three `fetch()` call sites hit static GeoJSON assets and the `/healthz` warmup ping, not data routes). The 0029 commission simplification left **no** leftover dispute/run/maker-checker/cadence logic on the frontend.

The findings below are dominated by one genuine correctness issue (fractional-UGX money math in the settlement upload path, the frontend half of baseline SEED-A4/B1), plus a cluster of doc-drift and minor quality items.

**Counts:** 0 Critical · 1 High · 4 Medium · 6 Low = **11 findings.**

---

## HIGH

### H-C1 — Settlement upload accepts and forwards fractional UGX (no client-side rounding)
- **Classification:** real-bug
- **Severity:** High
- **Evidence:**
  - `src/utils/settlement.js:104` — `const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');` keeps the decimal point, so `parseAmount("1,200.5")` → `1200.5`.
  - `src/utils/settlement.js:81` — `normalizeUploadedRows` keeps any row where `Number.isFinite(amountPaid) && amountPaid > 0` — a fractional value passes.
  - `src/services/commissions.js:636` — `const amountPaid = Number(row.amountPaid ?? 0);` with no `Math.round`; written through at `:648` (`c.paidAmount = amountPaid`), `:659`, `:672`, and summed at `:679` (`totalPaid += amountPaid`).
  - This is the frontend half of baseline **SEED-A4 / SEED-B1**: the `apply_settlement` RPC (`0031:161`) also writes `paid_amount` into an unconstrained `NUMERIC` with no `round()`. Nothing in the FE→RPC chain rounds.
- **Impact:** A distributor who types `45000.50` (or whose Excel cell carries a float) settles commissions with fractional shillings. UGX has no sub-unit; the value persists to `commissions.paid_amount` / `settlement_batches.paid_amount`, then renders back through `formatUGXShort`/`formatUGX` (which `Math.round` on display, hiding the drift) — so the stored ledger and the displayed total silently diverge. Corrupts demo settlement data in a way that is invisible until someone reconciles raw rows.
- **Recommendation:** Round at the FE boundary — `Math.round` (or `Math.trunc`) the parsed amount in `normalizeUploadedRows`/`applySettlementUpload` so only integer UGX is ever sent. (Pair with the DB-side `round()` recommendation in `01-database.md`/`02-backend.md` for defence in depth.) Also reject fractional input in the parser rather than silently coercing.

---

## MEDIUM

### M-C1 — Two divergent `parseAmount` implementations with incompatible decimal handling
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:**
  - `src/utils/finance.js:96-101` — `parseAmount` does `.replace(/[^\d]/g, '')` → **strips the decimal point entirely**, so `"12,500.50"` → `1250050` (off by 100×), and returns a `parseInt` integer or `null`.
  - `src/utils/settlement.js:102-107` — a private `parseAmount` does `.replace(/[^0-9.-]/g, '')` → **preserves** decimals and sign, returns a `Number` (can be `NaN`/float/negative).
  - Both are named `parseAmount`, both parse "UGX amount" strings, but one floors-to-int and one keeps floats — and the settlement path is the one feeding money to the DB (see H-C1).
- **Impact:** Confusing and dangerous: a reviewer reasonably assumes `parseAmount` floors to an integer (as the public finance util does), but the settlement copy does not. The finance-util variant's decimal-stripping is itself a latent footgun for any subscriber form where a user types a decimal (it multiplies by 10/100). Maintenance risk; root cause of H-C1.
- **Recommendation:** Consolidate on one canonical `parseAmount` in `finance.js` that (a) strips grouping/currency, (b) parses to a number, (c) rounds to integer UGX, (d) returns `null` for non-positive/non-finite. Have `settlement.js` import it. Add unit tests for the decimal/negative/`"UGX "`-prefixed cases (currently untested — see M-C3).

### M-C2 — Documentation drift: CLAUDE.md, FRONTEND.md, and the X13 known-bug entry are stale vs the working tree
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:**
  - `CLAUDE.md:190` (§10b) states `MOCK_NOW = new Date(2026, 3, 8)`, but the actual value is `src/data/mockData.js:25` → `new Date(2026, 4, 26)` (2026-05-26). FRONTEND.md §16a has the correct value, so CLAUDE.md is the stale copy.
  - `FRONTEND.md §16b` lists **X13** ("`pages/Contact.jsx` doesn't validate `{ submitted, id }` response shape") as an open low bug — but `src/pages/Contact.jsx:42-50` now explicitly validates the response shape (`isDemo`, `hasValidId`). X13 is resolved; the doc still lists it as open.
  - `FRONTEND.md:1224` claims "**40 test files, 707 passing tests**"; the Phase-0 baseline reports **44 test files, 717 passing** (and `find` shows 43 `*.test.*` under `src`+`api`). The §17 table also claims `src/utils/__tests__/finance.test.js` covers "Frequency normalisation, `parseAmount`, `calcFV`, slider helpers" — it does not (see M-C3).
- **Impact:** Violates CLAUDE.md §11 doc-maintenance discipline (docs must move in lockstep with the working tree). Stale `MOCK_NOW`/test-count/known-bug entries mislead the next contributor and undermine the "already-known" cross-reference this very audit depends on.
- **Recommendation:** Sync `CLAUDE.md:190` `MOCK_NOW` to `(2026, 4, 26)`; remove X13 from §16b open list (mark resolved); update the §17 test-count and the `finance.test.js` coverage description to match reality. Fold into the same commit that ships 0029–0031 per §11.

### M-C3 — `finance.js` core money/frequency helpers are effectively untested
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:**
  - `src/utils/__tests__/finance.test.js` imports and tests **only** `formatUGX` and `fmtShort` (deprecated shims that forward to `currency.js`). It does **not** test `parseAmount`, `normalizeFrequency`, `periodsPerYear`, `monthlyEquivalent`, `calcFV`, `sliderToAmt`, or `amtToSlider` — the actual money/frequency logic.
  - `parseAmount` (used in `SavePage.jsx:83`, `WithdrawPage.jsx:64`, `ClaimPage.jsx:54`, `ContributionSettings.jsx:93`, `ContributionSettingsForm.jsx:72`) and `normalizeFrequency` (a CLAUDE.md §4.6 hard-rule helper) carry real correctness weight yet have zero direct coverage here.
- **Impact:** The most safety-critical pure functions on the frontend (amount parsing, frequency normalization, future-value projection) ship untested; the decimal-stripping footgun in M-C1/H-C1 would have been caught by a single `parseAmount("1.5")` assertion.
- **Recommendation:** Add `finance.test.js` cases for `parseAmount` (grouping, currency prefix, decimal, negative, empty → `null`), `normalizeFrequency` (every alias incl. `halfYearly`/`semi-annually`/`yearly` + unknown fallback), `periodsPerYear`, `monthlyEquivalent` (zero/negative amount), and `calcFV` (0 years).

### M-C4 — `useOutsideClick` re-subscribes its document listeners on every render (NotificationBell)
- **Classification:** quality/tech-debt
- **Severity:** Medium
- **Evidence:**
  - `src/hooks/useOutsideClick.js:30` — the effect depends on `[active, onOutside, refs]`.
  - `src/components/notifications/NotificationBell.jsx:62` passes a **fresh array literal** each render: `useOutsideClick(open, close, portal ? [wrapRef, popoverRef] : [wrapRef])`. `close` is memoized (`:59`) but the `refs` array is not, so its identity changes every render → the effect tears down + re-adds the `mousedown`/`keydown` listeners on every render while the popover is open.
- **Impact:** Listener churn (add/remove on each re-render, e.g. while the 30s unread poll updates state) — wasteful and a latent source of the exact close-then-reopen race the hook's own docstring says it prevents. Same class of issue as the previously-fixed F23/F24 memoization findings, so the pattern is known-bad in this codebase.
- **Recommendation:** Memoize the refs array (`const refs = useMemo(() => (portal ? [wrapRef, popoverRef] : [wrapRef]), [portal])`) before passing it, or have `useOutsideClick` accept refs via a ref/stable container. Apply the same fix anywhere else the hook is called with an inline array.

---

## LOW

### L-C1 — Stale `eslint-disable react-hooks/refs` directive in AuthContext (baseline SEED-C1)
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `src/contexts/AuthContext.jsx:121` — `npx eslint 'src/**/*.{js,jsx}'` reports `warning Unused eslint-disable directive (no problems were reported from 'react-hooks/refs')`. CLAUDE.md §3 states this directive should already have been cleared in the audit Phase 6 cleanup; it is still present.
- **Impact:** The one residual source-lint warning (the other is the expected-normal TanStack Virtual one). Cosmetic; contradicts the "0 errors / 1 informational warning" claim in CLAUDE.md §3.
- **Recommendation:** Remove the unused `eslint-disable` line.

### L-C2 — Mock-mode notification body renders unformatted/raw amount
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:**
  - `src/services/notifications.js:184` — `const body = `UGX ${amount} paid for ${lineCount} commissions.`;` interpolates the raw number with no thousands separators (and would show a fractional amount verbatim if H-C1 feeds one in).
  - `src/data/mockData.js:894,906,918` — seed bodies hardcode the same unformatted form (`"UGX 25000 paid for 5 commissions."`).
- **Impact:** In `VITE_USE_SUPABASE=false` demo mode the notification feed shows "UGX 25000" instead of the app-standard "UGX 25,000". Minor brand/consistency blemish in a sales-demo surface. (Note: the live `apply_settlement` RPC builds the body server-side, so live mode is unaffected — mock-only.)
- **Recommendation:** Use `formatUGX(amount, { compact: false })` from `currency.js` when building the mock body; restamp the three seed rows in `mockData.js` to match.

### L-C3 — `formatUGXShort` returns misleading "0K"/"1K" for sub-1,000 values
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `src/utils/currency.js:65-70` — `formatUGXShort` always does `${(n / 1e3).toFixed(0)}K` for `0 < n < 1e6`, so `formatUGXShort(500)` → `"1K"` and `formatUGXShort(400)` → `"0K"`. The sibling `formatUGX` (compact) explicitly guards this case (`currency.js:35-37`, `n < 1e3` → exact). `currency.test.js:97-116` only asserts ≥1000 inputs, so the sub-1000 rounding is untested.
- **Impact:** Latent. Current callers (e.g. `SavePage.jsx:172` hero amount, `WithdrawalsHubPage.jsx:71`, `OperationsSection.jsx:37`) floor at 5,000 contributions so the edge isn't hit in normal demo flows, but any future sub-1,000 value renders misleadingly.
- **Recommendation:** Mirror the `formatUGX` guard — for `n < 1e3` return the exact rounded number instead of `"{0|1}K"`. Add a `currency.test.js` case for 0 < n < 1000.

### L-C4 — `toCsvStream` argument-validation relies on `&&`/`||` precedence with no parens
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `src/utils/csv.js:106` — `if (rows == null || typeof rows[Symbol.asyncIterator] !== 'function' && typeof rows[Symbol.iterator] !== 'function')`. The intent (reject if `null`, or if neither iterator exists) is correct only because `&&` binds tighter than `||`, but the expression is unparenthesized and hard to verify at a glance.
- **Impact:** Readability/maintenance risk; a future edit that swaps an operator silently changes the guard. No live bug today.
- **Recommendation:** Parenthesize: `if (rows == null || (typeof rows[Symbol.asyncIterator] !== 'function' && typeof rows[Symbol.iterator] !== 'function'))`.

### L-C5 — `formatRelativeTime` called without a `now` anchor in the notification feed
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence:** `src/components/notifications/NotificationList.jsx:72` — `formatRelativeTime(n.createdAt)` is called with no `{ now }` option, so `date.js:75` defaults the reference to the real wall clock (`new Date()`). Mock-seed notifications are anchored to the `MOCK_NOW` era (`mockData.js:898` `createdAt: '2026-04-05…'`), not the wall clock.
- **Impact:** In mock mode the relative-time labels ("3w", "Apr 5") are computed against today's wall clock rather than `MOCK_NOW`, so they can drift from the rest of the MOCK_NOW-anchored demo copy as the calendar advances. `date.js` documents that callers rendering MOCK_NOW data should pass `now`; this one doesn't. Cosmetic; live notifications use real `createdAt` so live mode is fine.
- **Recommendation:** Thread the demo clock (`currentTime()`) through the bell/list as a `now` prop in mock mode, or accept the drift as intentional demo scope and note it.

### L-C6 — Large files flagged for decomposition (informational)
- **Classification:** quality/tech-debt
- **Severity:** Low
- **Evidence (current line counts):** `src/services/subscriber.js` (1067), `src/dashboard/branch/ViewBranches.jsx` (1035), `src/data/mockData.js` (1034), `src/dashboard/commissions/CommissionPanel.jsx` (930), `src/services/entities.js` (859), `src/services/commissions.js` (751), `src/dashboard/sidebar/Sidebar.jsx` (650), `src/dashboard/overlay/OverlayPanel.jsx` (647). FRONTEND.md §16b already tracks most of these as "extraction candidates when next touched" — so this overlaps **already-known**, but the counts have grown (e.g. FRONTEND.md lists CommissionPanel at "~930", ViewBranches at "979" vs actual 1035).
- **Impact:** No defect; maintainability/readability only. These files are the natural blast radius for future regressions.
- **Recommendation:** Continue the "extract when next touched" policy; refresh the FRONTEND.md §16b "Largest files" table counts (ties into M-C2 doc drift).

---

## Hard-rule compliance — verified CLEAN (no findings)

Recorded so the synthesis agent knows these were checked exhaustively, not skipped:

- **`transition: all`** — zero source occurrences (`grep` across `src/**` `.css`/`.jsx`/`.js`; the only hit is a comment in `TicketStatusBadge.module.css:30`). Compliant with CLAUDE.md §5.4.
- **`outline: none` always paired** — all input/select `:focus` rules provide a visible `box-shadow` + `border-color` replacement (`Contact.module.css:143-148`, `FilterSelect.module.css:32-36/69-73`, `ReportTable.module.css:210-214`, `OtpStep.module.css:31-35`, `BeneficiariesStep.module.css:94-98`); the container cases (`Modal.module.css:40` dialog, `SignupShell.module.css:154` programmatic-focus body) intentionally suppress the ring on a focus-trap/SR-position target. Global `:focus-visible` baseline lives in `index.css:210-216`. Compliant with CLAUDE.md §5.3.
- **mockData import boundary** — only `services/*` import `data/*`. The two grep matches outside that boundary (`utils/policies.js:14`, `hooks/useSubscriber.js:2`) are doc comments explaining the rule, not imports. Compliant with CLAUDE.md §4.1.
- **No hand-rolled `fetch` against `/api/*`** — `UgandaMap.jsx:35,45` fetch static `.geojson` assets; `WarmupBanner.jsx:33` pings `/healthz` (root, not `/api`); `services/api.js:123` is the sanctioned wrapper. Compliant with CLAUDE.md §5.2.
- **`normalizeFrequency` on schedule reads/writes** — applied at `subscriber.js:200,743,751,770` and `agent.js:50` (every read mapping + every write patch). Compliant with CLAUDE.md §4.6.
- **`config/env.js`** — exposes only `VITE_*`-sourced values (`VITE_API_BASE_URL`, public legal/support URLs, map tile URL) plus `import.meta.env.DEV/PROD`. **No server secret or non-`VITE_` var** is read in the client bundle. Compliant with CLAUDE.md §4.4 / §7.
- **`ProtectedDashboard` role-gating** — `App.jsx:149-164` gates on `isAuthenticated` then `hasDashboard(role)` → `/coming-soon` for deferred employer/admin. Correct.
- **0029 commission simplification** — no leftover dispute/run/maker-checker/cadence logic on the frontend; all "cadence"/"dispute" string hits are contribution-frequency UI copy, CSS class names, or comments documenting the removal.
- **Console logging** — all `console.*` in source are dev-guarded (`UgandaMap.jsx:180,202` behind `IS_DEV`), in services as legitimate diagnostics (`entities.js:659`, `chat.js:73`, `supabaseClient.js:83,94`), or in `ErrorBoundary.jsx:24-25`. No JWT/secret leakage (CLAUDE.md §7).

---

## Items considered and classified as intentional-demo-scope / already-known (NOT reported as bugs)

- **`MOCK_NOW` anchoring**, per-session mutation stores, mock chat, `VITE_USE_SUPABASE=false` fallback branch — intentional-demo-scope (CLAUDE.md §10a, FRONTEND.md §16a). The notifications service mock store (`notifications.js:29`) and in-memory ticket/chat stores follow the same documented pattern.
- **Notifications via 30s polling** (`useNotifications.js:13,30` `refetchInterval`), no realtime — intentional-demo-scope per plan preamble. (Cross-tab read-state race + request cost are Agent D's workstream.)
- **`xlsx.js` parse hardening** (no size cap / MIME check) and the **`xlsx@0.18.5` CVEs** — owned by Agents B (file-parse) and H (supply-chain); not double-reported here.
- **Subscriber Settings `StubPage` placeholders** (`/dashboard/settings/notifications`, `/dashboard/settings/security`) — already-known (FRONTEND.md §16b).
- **F13/F17/F19/F23/F24/F27, X12** — already-known residuals tracked in FRONTEND.md §16b; not re-reported. (M-C4 is a *new* instance of the same memoization class, not a re-report of F23/F24.)
- **`useApplySettlement` has no client-side double-submit guard** (`useCommission.js:105-111`, no `disabled`-while-pending wiring shown at the hook layer) — the idempotency concern is owned by baseline SEED-B2/D1 (Agents B/D, the RPC-level nonce). Noted here only as the FE surface of that DB finding; the panel-level button-disable belongs to Agent E's UX flow review.

---

## Cutover blockers (frontend)

- **H-C1** (fractional-UGX settlement money math) should be fixed alongside the DB-side rounding (`01`/`02`) before `feat/simplify-commissions` → `main`, since it corrupts settlement ledger data in the core new flow. Everything else (M/L) is non-blocking quality/doc cleanup.
