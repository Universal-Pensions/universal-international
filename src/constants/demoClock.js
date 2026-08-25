// ─── The demo clock — ONE anchor for every "now" in this codebase ──────────
//
// Audit 2026-08-23 (A06-003 / A06-008 / A06-009 / A12-001 / A11-007 / A26-003)
// found FIVE independently-drifting copies of "now", up to 44 days apart,
// because every consumer hardcoded its own literal instead of reading one
// shared value:
//   1. src/data/mockData.js            MOCK_NOW = 2026-07-01  (correct — the
//      most recently rolled-forward value; ADR-006 / CLAUDE.md §10b)
//   2. scripts/seed-supabase.mjs       MOCK_NOW = 2026-05-26  (a hand-kept
//      mirror of #1 whose own comment insisted it "MUST mirror" mockData.js
//      — it had silently drifted 36 days behind anyway, over-shifting every
//      re-anchored seed date, e.g. a WEEKLY saver's next_due_date landed 57
//      days out)
//   3. e2e/specs/db/invariants.spec.ts MOCK_NOW_ISO = 2026-05-26 (the same
//      stale value, hand-copied a second time)
//   4. public._demo_now() (Postgres)   2026-05-18 23:59:59+00 — the only
//      clock in SQL, 44 days behind #1, read by get_employer_activity_rollup,
//      get_entity_metrics_rollup, get_top_branch, submit_hospital_cash_claim
//   5. src/utils/periodSettlement.test.js / src/utils/policies.test.js each
//      pin a THIRD independent 2026-05-26 literal as an injected NOW (unit
//      tests only, not wired to this file — outside this fix's write-set;
//      see docs/audits/2026-08-23/06-data-integrity.md §3.5 / A06-017)
//
// THE FIX: this file is the one literal `Date` the rest of the JS codebase
// reads. src/data/mockData.js imports it and re-exports MOCK_NOW unchanged
// (same name, same shape) so every existing `import { MOCK_NOW } from
// '.../data/mockData'` call site — services/commissions.js,
// services/subscriber.js, services/notifications.js, utils/settlementCycle.js,
// agentHomeSummary.js, adminAttentionDerive.js, and others — keeps working
// with NO changes. scripts/seed-supabase.mjs now imports it directly instead
// of hand-mirroring a second literal.
//
// Deliberately a LEAF module with ZERO imports (no mockGeo / mockBranchDefs).
// That is what lets e2e/specs/db/invariants.spec.ts — a Node-side Playwright
// spec that has always deliberately avoided importing mockData.js, to keep
// the ~314-branch/135-district mock graph out of the test runner — import
// this file directly instead of hand-copying the value a third time.
//
// Postgres cannot import a JS constant, so clock #4 above (public._demo_now())
// is a SECOND, independent literal by necessity — supabase/migrations/
// 0126_demo_clock.sql brings it into agreement with MOCK_NOW below, and
// e2e/specs/db/invariants.spec.ts asserts the two stay in agreement so a
// future roll-forward that updates only one side fails loudly instead of
// drifting silently again.
//
// NOT subject to CLAUDE.md §4 rule 1 ("components/dashboard files never
// import mockData.js directly") — that rule is about the ~314-branch mock
// generation graph living in mockData.js, not about this tiny anchor. A
// presentation-layer file may import MOCK_NOW / MOCK_NOW_ISO_DATE from here
// directly when it needs "now" and has no other service dependency (e.g. a
// chart's month-label helper) — this is intentionally where that anchor
// lives so such files do not need to gain a mockData.js dependency just to
// stop reading `new Date()`.
//
// TO ROLL THE CLOCK FORWARD: change ONLY the MOCK_NOW literal below, then
// author a migration that CREATE OR REPLACEs public._demo_now() to match
// (see 0126_demo_clock.sql) — two files, always together.
//
// Replace with `new Date()` once real backend timestamps replace mock data
// (see src/data/mockData.js `currentTime()`, which is the one place that
// swap needs to happen).

/**
 * The frozen "now" every mock/demo date is generated or evaluated relative
 * to, so "due in N days" means the same thing on every screen and stays
 * stable as a demo session runs (vs `new Date()`, which would drift mid-demo).
 */
export const MOCK_NOW = new Date(2026, 6, 1); // 2026-07-01

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * MOCK_NOW as a YYYY-MM-DD string, read off MOCK_NOW's own LOCAL calendar
 * components (getFullYear/getMonth/getDate) — deliberately not
 * `.toISOString()`, which reads UTC components and can report the wrong
 * calendar day for a local midnight Date depending on the host's offset.
 * Computed FROM MOCK_NOW rather than typed as a second literal, so this
 * cannot itself become a 6th drifting copy of the anchor.
 */
export const MOCK_NOW_ISO_DATE = `${MOCK_NOW.getFullYear()}-${pad2(MOCK_NOW.getMonth() + 1)}-${pad2(MOCK_NOW.getDate())}`;
