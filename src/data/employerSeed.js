// Employer-role demo seed — UNIFIED MODEL (0043–0045).
//
// An employer's staff are now REAL subscribers tagged with `employer_id`. This
// module is the SINGLE SOURCE OF TRUTH for the employer demo data, consumed two
// ways so the Supabase path and the offline mock path agree:
//   * `scripts/seed-supabase.mjs` seeds the `employers` row + the 21 members as
//     tagged `subscribers` (+ balances / schedules / insurance / transactions)
//     and the employer `contribution_runs` history.
//   * The `src/services/employer.js` mock branch (VITE_USE_SUPABASE=false)
//     layers a session-mutation store over the frozen MEMBERS.
//
// Like every other `src/data` module this is mock data — reached only through a
// service, NEVER imported by a component (CLAUDE.md §4.1). Dates anchor to
// `MOCK_NOW` (2026-07-01, src/constants/demoClock.js — corrected 2026-08-25;
// this comment previously read the stale 2026-05-26) for demo stability.
//
// Issue 2: the funding setup is a SINGLE company-wide value on the employer
// (`defaultContributionConfig`) — applied to every member, never per-member.

import { MOCK_NOW } from './mockData';
import { groupInsurancePremiumPerMember } from '../utils/groupInsurance';
import { deriveContributionLegs } from '../utils/contributionModel';

const DAY_MS = 86400000;
const UNIT_PRICE = 1000; // UGX/unit — matches the contribution trigger.
const round = (n) => Math.round(n);

function dateDaysAgo(days) {
  const d = new Date(MOCK_NOW.getTime() - days * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** YYYY-MM-DD birth date for a given age (demo-stable, mid-year). */
function dobForAge(age) {
  return `${MOCK_NOW.getFullYear() - age}-06-15`;
}

// ─── Employer (B2B account) ──────────────────────────────────────────────────
// ONE company-wide contribution setup (Issue 2), applied to every member. UNIFIED
// TWO-LEG MODEL (migration 0092): funding is driven by each member's monthly
// `compensation`, NOT a saving amount, and the two legs are INDEPENDENT — each is
// either a percentage of compensation or a flat UGX amount. The employer leg is a
// share of PAY, never a share of the employee leg. See src/utils/contributionModel.js
// for the canonical math. The insurance keys (insuranceEnabled / groupCoverAmount /
// groupInsuranceProducts) ride along unchanged — they are independent of the legs.
export const EMPLOYER = Object.freeze({
  id: 'emp-001',
  name: 'Nile Breweries Demo Ltd',
  sector: 'Manufacturing',
  registrationNo: 'UG-REG-2019-04412',
  contactName: 'Patience Namaganda',
  contactPhone: '+256700000031',
  contactEmail: 'hr@nilebreweries.demo',
  district: 'Kampala',
  districtId: 'd-kampala',
  payrollCadence: 'monthly',
  // Two independent legs: staff put in 10% of pay, the company adds 5% of pay.
  // Each leg is a share of the member's OWN compensation — the employer leg is
  // never a function of the employee leg. Money-identical to every earlier shape
  // of this config (the pre-0092 "10% + a 50% match of that leg" == 5% of pay,
  // and the 0092 six-key form) with ZERO rounding divergence across all 21
  // members, so a reseed leaves every balance, run header and transaction row
  // untouched. Plus multi-product group insurance (all-or-nothing per product,
  // employer-funded): Life 15M + Health 5M here. groupCoverAmount /
  // insuranceEnabled are kept for back-compat with any legacy reader (the life
  // product mirrors them).
  defaultContributionConfig: {
    employeePct: 10,
    employerPct: 5,
    insuranceEnabled: true, groupCoverAmount: 15000000,
    groupInsuranceProducts: {
      life: { enabled: true, cover: 15000000 },
      health: { enabled: true, cover: 5000000 },
      funeral: { enabled: false, cover: 0 },
    },
  },
});

// Flat group LIFE cover applied uniformly to EVERY member (all-or-nothing — there
// is no per-member insurance). Premium is employer-included (0). Read OFF the
// company config rather than restated, so the member rows and the `employers` row
// can never disagree about the cover — the seed script prices the run's insurance
// leg from the config, so a divergence here would leave the ledger unreconcilable.
const GROUP_COVER = EMPLOYER.defaultContributionConfig.groupInsuranceProducts.life.cover;

// Demo employer login phone — resolves to emp-001 via demo_personas.
export const EMPLOYER_DEMO_PHONE = '+256700000031';

const COMPANY = EMPLOYER.defaultContributionConfig;

// ─── TWO-LEG run math (UNIFIED MODEL, migration 0092) ─────────────────────────
// Both legs come from `deriveContributionLegs` — the ONE implementation of the
// math, shared with the employer-service mock, the run-wizard preview and (mirrored
// in PL/pgSQL) `submit_employer_contribution_run`. This module must never
// re-implement it: a local copy is exactly how the old employer-leg basis
// (a % of the EMPLOYEE leg) survived in the seed after the rest of the app moved on.
/** Per-run contribution legs for one member under a config (defaults to COMPANY). */
function memberLegs(comp, cfg = COMPANY) {
  return deriveContributionLegs(cfg, comp);
}

// ─── Members (tagged subscribers) ────────────────────────────────────────────
// 21 staff onboarded by the employer = real subscribers (agent_id NULL). Each
// member's balances are internally consistent with the two-leg model run for
// `monthsActive` periods:
//   ownContributions      = employeeLeg(comp) × monthsActive
//   employerContributions = employerLeg(comp) × monthsActive
//   netBalance            = own + employer  (split per retirementPct, default 80)
// Employer members do NOT self-set a saving amount — `contributionSchedule.amount`
// is 0; `compensation` drives everything (monthlyContribution is vestigial).
const DEFAULT_SPLIT = { retirementPct: 80, emergencyPct: 20, frequency: 'monthly' };

function makeMember(p) {
  const comp = p.compensation ?? 0;
  const months = p.monthsActive ?? 12;
  const retPct = DEFAULT_SPLIT.retirementPct;
  const { employeeLeg, employerLeg } = memberLegs(comp);
  const own = round(employeeLeg * months);
  const employer = round(employerLeg * months);
  const net = own + employer;
  const retirement = round(net * retPct / 100);
  const emergency = net - retirement;
  return {
    employerId: EMPLOYER.id,
    gender: 'male',
    status: 'active',
    // Real sign-up always completes KYC, so members are all 'complete'
    // ("pending KYC" is tracked via pending invites, not members).
    kycStatus: 'complete',
    districtId: EMPLOYER.districtId,
    nominees: [],
    ...p,
    // Company-wide group cover, uniform across ALL staff — set AFTER ...p so a
    // per-member value can never diverge (insurance is all-or-nothing).
    insuranceCover: GROUP_COVER,
    insurancePremiumMonthly: 0,
    insuranceStatus: 'active',
    insuranceRenewalDate: dateDaysAgo(-180),
    dob: p.dob ?? dobForAge(p.age ?? 30),
    // Compensation drives funding; the saving amount is 0 for employer members.
    contributionSchedule: { ...DEFAULT_SPLIT, amount: 0 },
    ownContributions: own,
    employerContributions: employer,
    totalContributions: net,
    retirementBalance: retirement,
    emergencyBalance: emergency,
    netBalance: net,
    unitsHeld: net / UNIT_PRICE,
  };
}

export const MEMBERS = Object.freeze([
  makeMember({ id: 'empe-001', name: 'Brian Okello', phone: '+256700100001', email: 'brian.okello@nilebreweries.demo', gender: 'male', age: 38, nin: 'CM38010012345A', occupation: 'Plant Manager', compensation: 2100000, monthsActive: 30, joinedDate: dateDaysAgo(900) }),
  makeMember({ id: 'empe-002', name: 'Grace Nakato', phone: '+256700100002', email: 'grace.nakato@nilebreweries.demo', gender: 'female', age: 31, nin: 'CF31050067890B', occupation: 'Accountant', compensation: 1400000, monthsActive: 21, joinedDate: dateDaysAgo(640) }),
  makeMember({ id: 'empe-003', name: 'Samuel Otim', phone: '+256700100003', email: 'samuel.otim@nilebreweries.demo', gender: 'male', age: 45, nin: 'CM45030011223C', occupation: 'Logistics Lead', compensation: 1000000, monthsActive: 36, joinedDate: dateDaysAgo(1100) }),
  makeMember({ id: 'empe-004', name: 'Esther Aciro', phone: '+256700100004', email: 'esther.aciro@nilebreweries.demo', gender: 'female', age: 27, nin: 'CF27110033445D', occupation: 'QA Technician', compensation: 800000, monthsActive: 14, joinedDate: dateDaysAgo(420) }),
  makeMember({ id: 'empe-005', name: 'Joseph Mukasa', phone: '+256700100005', email: 'joseph.mukasa@nilebreweries.demo', gender: 'male', age: 52, nin: 'CM52070055667E', occupation: 'Maintenance Supervisor', compensation: 1200000, monthsActive: 36, joinedDate: dateDaysAgo(1500) }),
  makeMember({ id: 'empe-006', name: 'Florence Atim', phone: '+256700100006', email: 'florence.atim@nilebreweries.demo', gender: 'female', age: 34, nin: 'CF34020077889F', occupation: 'HR Officer', compensation: 1320000, monthsActive: 24, joinedDate: dateDaysAgo(720) }),
  makeMember({ id: 'empe-007', name: 'David Wanyama', phone: '+256700100007', email: 'david.wanyama@nilebreweries.demo', gender: 'male', age: 29, nin: 'CM29090099001G', occupation: 'Sales Rep', compensation: 950000, monthsActive: 12, joinedDate: dateDaysAgo(360) }),
  makeMember({ id: 'empe-008', name: 'Rebecca Namusoke', phone: '+256700100008', email: 'rebecca.namusoke@nilebreweries.demo', gender: 'female', age: 41, nin: 'CF41040022334H', occupation: 'Procurement Officer', compensation: 1600000, monthsActive: 32, joinedDate: dateDaysAgo(980) }),
  makeMember({ id: 'empe-009', name: 'Isaac Tumusiime', phone: '+256700100009', email: 'isaac.tumusiime@nilebreweries.demo', gender: 'male', age: 36, nin: 'CM36060044556I', occupation: 'IT Support', compensation: 1050000, monthsActive: 18, joinedDate: dateDaysAgo(560) }),
  makeMember({ id: 'empe-010', name: 'Mary Auma', phone: '+256700100010', email: 'mary.auma@nilebreweries.demo', gender: 'female', age: 24, nin: 'CF24120066778J', occupation: 'Admin Assistant', compensation: 650000, monthsActive: 6, joinedDate: dateDaysAgo(180) }),
  makeMember({ id: 'empe-011', name: 'Peter Sserwadda', phone: '+256700100011', email: 'peter.sserwadda@nilebreweries.demo', gender: 'male', age: 48, nin: 'CM48080088990K', occupation: 'Security Lead', compensation: 900000, monthsActive: 36, joinedDate: dateDaysAgo(1320) }),
  makeMember({ id: 'empe-012', name: 'Sarah Kobusingye', phone: '+256700100012', email: 'sarah.kobusingye@nilebreweries.demo', gender: 'female', age: 33, nin: 'CF33100011002L', occupation: 'Marketing Coordinator', compensation: 1150000, monthsActive: 22, joinedDate: dateDaysAgo(660) }),
  // Suspended (skipped by runs).
  makeMember({ id: 'empe-013', name: 'Henry Kato', phone: '+256700100013', email: 'henry.kato@nilebreweries.demo', gender: 'male', age: 39, nin: 'CM39050033445M', occupation: 'Driver', compensation: 550000, monthsActive: 28, status: 'suspended', joinedDate: dateDaysAgo(840) }),
  makeMember({ id: 'empe-014', name: 'Diana Nabirye', phone: '+256700100014', email: 'diana.nabirye@nilebreweries.demo', gender: 'female', age: 28, nin: 'CF28030055667N', occupation: 'Lab Analyst', compensation: 900000, monthsActive: 10, joinedDate: dateDaysAgo(300) }),
  makeMember({ id: 'empe-015', name: 'Robert Ssempala', phone: '+256700100015', email: 'robert.ssempala@nilebreweries.demo', gender: 'male', age: 55, nin: 'CM55020077889O', occupation: 'Warehouse Hand', compensation: 600000, monthsActive: 36, status: 'suspended', joinedDate: dateDaysAgo(1700) }),
  makeMember({ id: 'empe-016', name: 'Juliet Akello', phone: '+256700100016', email: 'juliet.akello@nilebreweries.demo', gender: 'female', age: 30, nin: 'CF30070099001P', occupation: 'Customer Service', compensation: 700000, monthsActive: 8, joinedDate: dateDaysAgo(240) }),
  // Recent hires (`recentHire`) — drive the admin Employers-scope "New Members"
  // today/week/month trend. monthsActive:1 → a small starting balance. EXCLUDED
  // from the back-dated contribution history (ACTIVE_MEMBERS filter) so they
  // have no transactions pre-dating their join.
  //
  // ⚠️ THESE OFFSETS WERE 8, 12, 21, 41 AND EVERY TILE READ ZERO.
  // The old comment recorded the calibration they depended on: "Anchored to
  // _demo_now() (2026-05-18) via days-ago-from-MOCK_NOW (MOCK_NOW = _demo_now
  // + 8d): day 8 = today/this-week". Migration 0126 set _demo_now() EQUAL to
  // MOCK_NOW to close audit A06-009, which deleted that 8-day gap — so "8 days
  // before MOCK_NOW" stopped meaning "today" and every hire landed exactly one
  // bucket too early. Each offset is now 8 lower, which is the same 8 the old
  // comment named. Live was repaired by 0135.
  // See docs/audits/2026-08-23/a06/REGRESSION-0126-employer-trends.md.
  //
  // Buckets on a demo clock of MOCK_NOW: 0 = today/this-week/this-month,
  // 4 = this week, 13 = last week or earlier, 33 = last month.
  makeMember({ id: 'empe-017', name: 'Aisha Nakimuli', phone: '+256700100017', email: 'aisha.nakimuli@nilebreweries.demo', gender: 'female', age: 26, nin: 'CF26010044556Q', occupation: 'Junior Accountant', compensation: 750000, monthsActive: 1, recentHire: true, joinedDate: dateDaysAgo(0) }),
  makeMember({ id: 'empe-018', name: 'Tom Bwambale', phone: '+256700100018', email: 'tom.bwambale@nilebreweries.demo', gender: 'male', age: 23, nin: 'CM23050066778R', occupation: 'Machine Operator', compensation: 600000, monthsActive: 1, recentHire: true, joinedDate: dateDaysAgo(0) }),
  makeMember({ id: 'empe-019', name: 'Grace Apio', phone: '+256700100019', email: 'grace.apio@nilebreweries.demo', gender: 'female', age: 29, nin: 'CF29080011223S', occupation: 'Quality Inspector', compensation: 850000, monthsActive: 1, recentHire: true, joinedDate: dateDaysAgo(4) }),
  makeMember({ id: 'empe-020', name: 'Daniel Okot', phone: '+256700100020', email: 'daniel.okot@nilebreweries.demo', gender: 'male', age: 34, nin: 'CM34030099001T', occupation: 'Shift Supervisor', compensation: 1100000, monthsActive: 1, recentHire: true, joinedDate: dateDaysAgo(13) }),
  makeMember({ id: 'empe-021', name: 'Lydia Nansubuga', phone: '+256700100021', email: 'lydia.nansubuga@nilebreweries.demo', gender: 'female', age: 27, nin: 'CF27110033445U', occupation: 'Logistics Clerk', compensation: 700000, monthsActive: 1, recentHire: true, joinedDate: dateDaysAgo(33) }),
]);

// Recent hires are excluded from the back-dated contribution history below — they
// have no transactions pre-dating their join (their balance is the monthsActive:1
// starting amount). They still count toward headcount / active / AUM / New Members.
const ACTIVE_MEMBERS = MEMBERS.filter((m) => m.status === 'active' && !m.recentHire);

// ─── Member contribution history + run headers (linked) ──────────────────────
// UNIFIED TWO-LEG MODEL (migration 0092): each payroll date is recorded as one
// contribution RUN that posts BOTH legs — the employee leg (source:'own') + the
// employer leg (source:'employer'), each derived INDEPENDENTLY from the member's
// `compensation` via `memberLegs` — to every active member, split by retirementPct
// (default 80, rounding ONCE). Every leg carries its run's `contributionRunId`,
// and each run header's totals are the Σ of its own legs, so the run drill-down
// reconciles to its members (audit 2026-06-16: previously the legs were untagged
// → run detail showed "0 members"). A member with BOTH legs 0 contributes no rows.
//
// The five dates double as the Employers-scope trend windows (today / this week /
// last week / this month / last month), so they MUST track the demo clock.
//
// ⚠️ THEY USED TO BE ABSOLUTE LITERALS ('2026-03-15' … '2026-05-18'), anchored to
// the then-frozen public._demo_now() of 2026-05-18. Migration 0126 moved that
// clock to 2026-07-01 to close audit A06-009 (five "now"s up to 44 days apart) —
// and these dates did not follow. Every current-period tile on the admin
// "Employers" scope silently went to zero while the previous-period tiles kept
// their data, which reads as "all employer activity stopped". Live was repaired
// by 0134; deriving them here is what stops the next reseed regenerating it.
// See docs/audits/2026-08-23/a06/REGRESSION-0126-employer-trends.md.
//
// ⚠️ DERIVED IN UTC, ON PURPOSE. The original comment recorded why these were
// absolute: "a MOCK_NOW + local-tz basis dropped the 'today' sample to 05-17 on
// a UTC+5:30 host". So the offsets below are applied with UTC getters and kept
// at midday UTC (see atMidday), which preserves timezone-stability for
// date_trunc('day') while still following the clock. Do NOT rewrite this using
// local-time getters.
//
// Offsets are days BEFORE MOCK_NOW, preserving the original relative spacing
// (run-005 lands ON the clock, so the "today" tile is non-zero). run-001 oldest
// … run-005 newest, so ORDER BY run_at DESC lists the newest first (the
// leaderboard reads runs[0]).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** YYYY-MM-DD, `days` before MOCK_NOW, computed entirely in UTC. */
function runDateUTC(days) {
  const d = new Date(Date.UTC(
    MOCK_NOW.getFullYear(), MOCK_NOW.getMonth(), MOCK_NOW.getDate(),
  ));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** "June 2026 mid-cycle" — derived so a label can never contradict its own date. */
function runLabel(iso, qualifier) {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y} ${qualifier}`;
}

const RUN_OFFSETS = [
  { id: 'run-001', daysBefore: 64, qualifier: 'payroll' },
  { id: 'run-002', daysBefore: 33, qualifier: 'payroll' },
  { id: 'run-003', daysBefore: 13, qualifier: 'payroll' },
  { id: 'run-004', daysBefore: 4,  qualifier: 'mid-cycle' },
  { id: 'run-005', daysBefore: 0,  qualifier: 'latest' },
];

const RUN_DATES = RUN_OFFSETS.map(({ id, daysBefore, qualifier }) => {
  const date = runDateUTC(daysBefore);
  return { id, date, periodLabel: runLabel(date, qualifier) };
});
const atMidday = (d) => `${d}T12:00:00.000Z`;

// Build the tagged legs and their run headers in one pass so each run's
// employer/employee/grand totals are exactly the Σ of its own posted legs.
function buildContributionHistory() {
  const txns = [];
  const runs = [];
  // Total employer-funded group insurance premium per covered member = Σ over
  // the enabled products (Life + Health here) at 0.2%/mo of cover — mirrors
  // src/utils/groupInsurance.js groupInsurancePremiumPerMember + the run RPC (0067).
  const groupPremium = groupInsurancePremiumPerMember(COMPANY);
  RUN_DATES.forEach(({ id: runId, date, periodLabel }, i) => {
    let employeeTotal = 0;
    let employerTotal = 0;
    let insuranceTotal = 0;
    ACTIVE_MEMBERS.forEach((m) => {
      const retPct = Number(m.contributionSchedule?.retirementPct ?? 80);
      const { employeeLeg, employerLeg } = memberLegs(m.compensation);
      if (employeeLeg > 0) {
        const ret = round(employeeLeg * retPct / 100);
        txns.push({
          id: `t-own-${m.id}-${i + 1}`, subscriberId: m.id, type: 'contribution', source: 'own',
          // The employee leg is the member's OWN money (source:'own') but it never
          // passes through their hands — the employer deducts it from pay and remits
          // it with the run. Stamping it 'MTN Mobile Money' made it read in the
          // member's activity feed and notifications ("added to your savings via MTN
          // Mobile Money") as a top-up they chose to make, which is a different story
          // from a payroll deduction and the wrong one to tell in a demo. The label
          // says what actually happened; the employer leg below is the company's own
          // money and is remitted the same way.
          amount: employeeLeg, date: atMidday(date), method: 'Payroll deduction',
          retirementAmount: ret, emergencyAmount: employeeLeg - ret, contributionRunId: runId,
        });
        employeeTotal += employeeLeg;
      }
      if (employerLeg > 0) {
        const ret = round(employerLeg * retPct / 100);
        txns.push({
          id: `t-emp-${m.id}-${i + 1}`, subscriberId: m.id, type: 'contribution', source: 'employer',
          amount: employerLeg, date: atMidday(date), method: 'Bank transfer',
          retirementAmount: ret, emergencyAmount: employerLeg - ret, contributionRunId: runId,
        });
        employerTotal += employerLeg;
      }
      // Group-life premium leg — employer-funded, all-or-nothing, NO ret/emg
      // split and NOT a 'contribution' (never inflates the member's pension pot).
      if (groupPremium > 0) {
        txns.push({
          id: `t-ins-${m.id}-${i + 1}`, subscriberId: m.id, type: 'insurance_premium', source: 'employer',
          amount: groupPremium, date: atMidday(date), method: 'Bank transfer',
          retirementAmount: null, emergencyAmount: null, contributionRunId: runId,
        });
        insuranceTotal += groupPremium;
      }
    });
    runs.push({
      id: runId, employerId: EMPLOYER.id, periodLabel, status: 'completed',
      employerTotal, employeeTotal, insuranceTotal,
      grandTotal: employeeTotal + employerTotal + insuranceTotal, runAt: atMidday(date),
    });
  });
  return { txns, runs };
}
const _history = buildContributionHistory();

// ─── Member withdrawals ──────────────────────────────────────────────────────
// A handful of withdrawals (negative amount, source 'own') on high-balance members
// so the Employers-scope Withdrawals trend is non-zero with finite deltas. Days
// chosen for: today/this-week (8), last week (12 → prev-week delta), this month
// (21), last month (41 → prev-month delta). Each is ≪ the member's balance, and —
// matching the platform's stock/flow model (AUM is the authored balance snapshot;
// withdrawals are an independent flow, exactly like the 5k-subscriber seed) — these
// do NOT mutate subscriber_balances.
function buildMemberWithdrawals() {
  const wd = (id, subscriberId, amount, dateStr, method) => ({
    id, subscriberId, type: 'withdrawal', source: 'own', amount: -Math.abs(amount),
    date: atMidday(dateStr), method,
    retirementAmount: -round(Math.abs(amount) * 0.8),
    emergencyAmount: -(Math.abs(amount) - round(Math.abs(amount) * 0.8)),
    contributionRunId: null,
  });
  return [
    wd('t-wd-empe-001-1', 'empe-001', 150000, '2026-05-18', 'MTN Mobile Money'), // today + this week
    wd('t-wd-empe-008-1', 'empe-008', 60000,  '2026-05-14', 'MTN Mobile Money'), // last week  (prev-week delta)
    wd('t-wd-empe-005-1', 'empe-005', 120000, '2026-05-05', 'Bank transfer'),    // this month
    wd('t-wd-empe-003-1', 'empe-003', 90000,  '2026-04-15', 'MTN Mobile Money'), // last month (prev-month delta)
  ];
}

export const MEMBER_TRANSACTIONS = Object.freeze([
  ..._history.txns,
  ...buildMemberWithdrawals(),
]);

// ─── Employer contribution runs (history headers, linked to the legs above) ──
// Built in buildContributionHistory() so each header's employer/employee/grand
// totals equal the Σ of its own tagged legs — mirroring submit_employer_
// contribution_run's two-leg math, and letting the run drill-down resolve members.
export const CONTRIBUTION_RUNS = Object.freeze(_history.runs.map((r) => Object.freeze(r)));

// ─── Leaderboard competitors (demo-only) ─────────────────────────────────────
// Invented peer employers; "you" = the newest run's grandTotal is spliced in by
// getEmployerLeaderboard. Calibrated so the demo employer lands mid-field.
export const LEADERBOARD_COMPETITORS = Object.freeze([
  Object.freeze({ name: 'MTN Uganda', monthlyTotal: 4180000 }),
  Object.freeze({ name: 'Centenary Bank', monthlyTotal: 3240000 }),
  Object.freeze({ name: 'Roofings Group', monthlyTotal: 1180000 }),
  Object.freeze({ name: 'Quality Chemicals', monthlyTotal: 990000 }),
  Object.freeze({ name: 'Café Javas', monthlyTotal: 825000 }),
  Object.freeze({ name: 'Movit Products', monthlyTotal: 560000 }),
  Object.freeze({ name: 'Mukwano Industries', monthlyTotal: 340000 }),
]);

export { UNIT_PRICE as EMPLOYER_UNIT_PRICE };
