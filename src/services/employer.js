// Employer data service — Supabase-backed read/write for the Employer
// dashboard.
//
// UNIFIED MODEL (0043–0045): an employer's "staff" are REAL subscribers tagged
// with `subscribers.employer_id`. This service reads `subscribers` (+ their
// balances / schedule / insurance / nominees) scoped to the caller's employer
// via the `employerId` JWT claim + the 0043 employer RLS, and funds them via
// `submit_employer_contribution_run` (employer-source `transactions`). The old
// standalone `employees` / `contribution_run_lines` machinery is retired.
//
// Dual-path: every function checks `IS_SUPABASE_ENABLED`. When false
// (`VITE_USE_SUPABASE=false`) it falls back to the frozen `employerSeed.js`
// MEMBERS (subscriber-shaped) layered with a per-session mutation store. Only
// THIS service file imports `employerSeed.js` (CLAUDE.md §4.1).
//
// Member shape (camelCase) reused across the roster/detail components:
//   { id, name, phone, email, gender, age, nin, employerId, status, isActive,
//     joinedDate, monthlyContribution, contributionSchedule, retirementBalance,
//     emergencyBalance, netBalance, unitsHeld, ownContributions,
//     employerContributions, totalContributions, insuranceCover,
//     insurancePremiumMonthly, insuranceStatus, insuranceRenewalDate, nominees }

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';
import { normalizeFrequency } from '../utils/finance';
import { groupInsurancePremiumPerMember } from '../utils/groupInsurance';
import { deriveContributionLegs, splitEmployerLeg } from '../utils/contributionModel';
import { NUDGE_LATENCY_MS, reachableChannels } from '../constants/nudge';
import { currentTime } from '../data/mockData';
import {
  EMPLOYER,
  MEMBERS,
  CONTRIBUTION_RUNS,
  MEMBER_TRANSACTIONS,
  EMPLOYER_UNIT_PRICE,
  LEADERBOARD_COMPETITORS,
} from '../data/employerSeed';

/** PostgREST embeds a to-one relation as an object, but can surface a single-
 *  element array depending on FK detection — normalise to the row (or null). */
function oneOf(rel) {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

// =============================================================================
// Mappers (snake_case DB row → camelCase frontend shape)
// =============================================================================

/** Map an `employers` row (unchanged). */
export function mapEmployer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    sector: row.sector,
    registrationNo: row.registration_no,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    district: row.district,
    status: row.status ?? 'active',
    payrollCadence: row.payroll_cadence,
    defaultContributionConfig: row.default_contribution_config ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a tagged `subscribers` row (+ embedded balances / schedule / insurance /
 * nominees) to the employer-dashboard "member" shape. Funding is NOT carried
 * per-member: both contribution legs come from the company-wide employer config
 * applied to the member's `compensation` (there is no per-employee override).
 * Only the member's own monthly saving + schedule split are per-member.
 */
export function mapMember(row) {
  if (!row) return null;
  const bal = oneOf(row.subscriber_balances);
  const sched = oneOf(row.contribution_schedules);
  const ins = oneOf(row.insurance_policies);
  return {
    id: row.id,
    employerId: row.employer_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    age: row.age,
    nin: row.nin,
    occupation: row.occupation ?? null,
    // KYC completion is tracked per subscriber (subscribers.kyc_status). Missing
    // / null is treated as complete so legacy rows don't read as "pending".
    kycStatus: row.kyc_status ?? 'complete',
    isActive: row.is_active !== false,
    status: row.is_active === false ? 'suspended' : 'active',
    joinedDate: row.registered_date ?? row.created_at ?? null,
    compensation: Number(row.compensation ?? 0),
    monthlyContribution: Number(sched?.amount ?? 0),
    contributionSchedule: sched
      ? {
          frequency: sched.frequency ? normalizeFrequency(sched.frequency) : 'monthly',
          amount: Number(sched.amount ?? 0),
          retirementPct: Number(sched.retirement_pct ?? 80),
          emergencyPct: Number(sched.emergency_pct ?? 20),
        }
      : null,
    retirementBalance: Number(bal?.retirement_balance ?? 0),
    emergencyBalance: Number(bal?.emergency_balance ?? 0),
    netBalance: Number(bal?.total_balance ?? 0),
    unitsHeld: Number(bal?.units ?? 0),
    insuranceCover: Number(ins?.cover ?? 0),
    insurancePremiumMonthly: Number(ins?.premium_monthly ?? 0),
    insuranceStatus: ins?.status ?? 'inactive',
    insuranceRenewalDate: ins?.renewal_date ?? null,
    nominees: Array.isArray(row.nominees) ? row.nominees : [],
  };
}

/** Map a `contribution_runs` header row (employer run history — kept). */
export function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    employerId: row.employer_id,
    periodLabel: row.period_label,
    status: row.status,
    employerTotal: Number(row.employer_total ?? 0),
    employeeTotal: Number(row.employee_total ?? 0),
    insuranceTotal: Number(row.insurance_total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    runAt: row.run_at,
    createdAt: row.created_at,
  };
}

/** Map a contribution `transactions` row to the dashboard's line shape. */
export function mapTxn(row) {
  if (!row) return null;
  return {
    id: row.id,
    subscriberId: row.subscriber_id,
    type: row.type,
    source: row.source ?? 'own',
    amount: Number(row.amount ?? 0),
    date: row.date,
    method: row.method,
    retirementAmount: Number(row.split_retirement ?? 0),
    emergencyAmount: Number(row.split_emergency ?? 0),
    contributionRunId: row.contribution_run_id ?? null,
  };
}

// =============================================================================
// Mock fallback — per-session mutation store layered over employerSeed MEMBERS
// =============================================================================

const _mockMemberMutations = new Map();
let _mockRuns = [];
let _mockTxns = []; // appended employer-source transactions (session)
const _mockNonceResults = new Map();
let _mockEmployerOverride = null;
const _mockLinked = []; // members onboarded this session
const _mockInvites = []; // employer invites created this session
const _mockRemovedIds = new Set(); // members un-linked from the employer this session

function readMemberSession(id) {
  if (!_mockMemberMutations.has(id)) {
    _mockMemberMutations.set(id, {
      balanceDelta: { retirement: 0, emergency: 0, net: 0, units: 0 },
      ownDelta: 0,
      employerDelta: 0,
      insuranceOverride: null,
      compensationOverride: null,
    });
  }
  return _mockMemberMutations.get(id);
}

function applyMemberMutations(m) {
  if (!m) return m;
  const s = readMemberSession(m.id);
  const ins = s.insuranceOverride ?? {
    cover: m.insuranceCover,
    premium: m.insurancePremiumMonthly,
    status: m.insuranceStatus,
    renewalDate: m.insuranceRenewalDate,
  };
  return {
    ...m,
    compensation: s.compensationOverride != null ? s.compensationOverride : (m.compensation ?? 0),
    retirementBalance: Math.max(0, (m.retirementBalance || 0) + s.balanceDelta.retirement),
    emergencyBalance: Math.max(0, (m.emergencyBalance || 0) + s.balanceDelta.emergency),
    netBalance: Math.max(0, (m.netBalance || 0) + s.balanceDelta.net),
    unitsHeld: Math.max(0, (m.unitsHeld || 0) + s.balanceDelta.units),
    ownContributions: Math.max(0, (m.ownContributions || 0) + s.ownDelta),
    employerContributions: Math.max(0, (m.employerContributions || 0) + s.employerDelta),
    insuranceCover: ins.cover,
    insurancePremiumMonthly: ins.premium,
    insuranceStatus: ins.status,
    insuranceRenewalDate: ins.renewalDate,
  };
}

function mockMembers() {
  return [...MEMBERS, ..._mockLinked]
    .filter((m) => !_mockRemovedIds.has(m.id))
    .map(applyMemberMutations);
}

function mockRuns() {
  const seedRuns = [...CONTRIBUTION_RUNS].sort((a, b) =>
    String(b.runAt ?? '').localeCompare(String(a.runAt ?? '')),
  );
  return [..._mockRuns, ...seedRuns];
}

/**
 * Mock employer run — the offline (`VITE_USE_SUPABASE=false`) twin of
 * `submit_employer_contribution_run` (migration 0093). For each ACTIVE member it
 * derives the two INDEPENDENT legs from the member's `compensation` and the
 * company-wide config via the shared `deriveContributionLegs`, which the RPC
 * mirrors in PL/pgSQL:
 *   employeeLeg = round(comp × employeePct / 100)
 *   employerLeg = round(comp × employerPct / 100)
 * The employer leg is a share of COMPENSATION and is never a function of the
 * employee leg; either leg may be 0. The derivation is NOT re-implemented here —
 * a local copy is exactly how the mock, the seed and the RPC drifted apart before.
 * Each leg > 0 posts a transaction (employee leg source:'own', employer leg
 * source:'employer'), allocated wholly to RETIREMENT via `splitEmployerLeg` —
 * the member's own `retirementPct` is deliberately NOT read here, because it
 * governs only money they add themselves (see EMPLOYER_FUNDED_SPLIT).
 * A member with both legs 0 AND no insurance premium is skipped
 * (`zero_contribution`). `linesCreated` counts DISTINCT funded members;
 * `grandTotal` = employerTotal + employeeTotal + insuranceTotal.
 */
function _mockSubmitEmployerRun(employerId, { periodLabel, method, nonce } = {}) {
  if (nonce && _mockNonceResults.has(nonce)) return _mockNonceResults.get(nonce);
  const cfg = { ...EMPLOYER.defaultContributionConfig, ...(_mockEmployerOverride?.defaultContributionConfig ?? {}) };
  // Total employer-funded group insurance premium per covered member = Σ products
  // (parity with submit_employer_contribution_run / group_insurance_premium_per_member, 0067).
  const insuranceLeg = groupInsurancePremiumPerMember(cfg);
  const runId = `run-mock-${nonce ?? mockRuns().length + 1}`;
  let employerTotal = 0;
  let employeeTotal = 0;
  let insuranceTotal = 0;
  let lines = 0; // DISTINCT members funded
  let txnSeq = 0; // transaction-row counter (for unique mock ids)
  const skipped = [];

  for (const m of mockMembers()) {
    if (m.status !== 'active') { continue; } // excluded — parity with SQL `WHERE is_active`; not reported in skipped[]
    const comp = Number(m.compensation ?? 0);
    const { employeeLeg, employerLeg } = deriveContributionLegs(cfg, comp);
    // Funded when ANY leg is positive — insurance is all-or-nothing, so an active
    // member with zero pension still gets the premium leg (parity with the RPC).
    if (employeeLeg <= 0 && employerLeg <= 0 && insuranceLeg <= 0) {
      skipped.push({ subscriberId: m.id, reason: 'zero_contribution' });
      continue;
    }

    const s = readMemberSession(m.id);

    if (employeeLeg > 0) {
      const { retirement, emergency } = splitEmployerLeg(employeeLeg);
      s.balanceDelta.retirement += retirement;
      s.balanceDelta.emergency += emergency;
      s.balanceDelta.net += employeeLeg;
      s.balanceDelta.units += employeeLeg / EMPLOYER_UNIT_PRICE;
      s.ownDelta += employeeLeg;
      _mockTxns.unshift({
        id: `t-mock-${runId}-${++txnSeq}`,
        subscriberId: m.id,
        type: 'contribution',
        source: 'own',
        amount: employeeLeg,
        date: currentTime().toISOString(),
        // 'Payroll deduction', never the employer's chosen `method` — this leg is
        // deducted from the member's pay and remitted, so labelling it 'MTN Mobile
        // Money' makes the member's own activity feed read as if they paid it.
        // Parity with 0092's RPC + employerSeed.js. The employer + insurance legs
        // below keep `method`: those really are the employer's transfer.
        method: 'Payroll deduction',
        retirementAmount: retirement,
        emergencyAmount: emergency,
        contributionRunId: runId,
      });
      employeeTotal += employeeLeg;
    }

    if (employerLeg > 0) {
      const { retirement, emergency } = splitEmployerLeg(employerLeg);
      s.balanceDelta.retirement += retirement;
      s.balanceDelta.emergency += emergency;
      s.balanceDelta.net += employerLeg;
      s.balanceDelta.units += employerLeg / EMPLOYER_UNIT_PRICE;
      s.employerDelta += employerLeg;
      _mockTxns.unshift({
        id: `t-mock-${runId}-${++txnSeq}`,
        subscriberId: m.id,
        type: 'contribution',
        source: 'employer',
        amount: employerLeg,
        date: currentTime().toISOString(),
        method: method ?? null,
        retirementAmount: retirement,
        emergencyAmount: emergency,
        contributionRunId: runId,
      });
      employerTotal += employerLeg;
    }

    // Insurance premium leg (type='insurance_premium', source='employer'). Fully
    // employer-funded; NOT split and NOT a 'contribution', so it never touches the
    // member's balance/units — it is a cost, not savings (parity with the RPC).
    if (insuranceLeg > 0) {
      _mockTxns.unshift({
        id: `t-mock-${runId}-${++txnSeq}`,
        subscriberId: m.id,
        type: 'insurance_premium',
        source: 'employer',
        amount: insuranceLeg,
        date: currentTime().toISOString(),
        method: method ?? null,
        retirementAmount: 0,
        emergencyAmount: 0,
        contributionRunId: runId,
      });
      insuranceTotal += insuranceLeg;
    }

    lines += 1; // this member was funded (at least one leg posted)
  }

  let finalRunId = runId;
  if (lines > 0) {
    _mockRuns = [
      { id: runId, employerId, periodLabel: periodLabel ?? null, status: 'completed',
        employerTotal, employeeTotal, insuranceTotal,
        grandTotal: employerTotal + employeeTotal + insuranceTotal, runAt: currentTime().toISOString() },
      ..._mockRuns,
    ];
  } else {
    finalRunId = null;
  }
  const result = {
    runId: finalRunId,
    linesCreated: lines,
    employerTotal,
    employeeTotal,
    insuranceTotal,
    grandTotal: employerTotal + employeeTotal + insuranceTotal,
    skipped,
  };
  if (nonce) _mockNonceResults.set(nonce, result);
  return result;
}

// =============================================================================
// Reads
// =============================================================================

const MEMBER_SELECT =
  '*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), nominees(*)';

/**
 * @endpoint SELECT * FROM employers WHERE id = $1 (RLS auto-scopes to self).
 * @cache ['employer', id]
 */
export async function getEmployer(id) {
  if (!IS_SUPABASE_ENABLED) {
    if (id && EMPLOYER.id !== id) return null;
    return { ...EMPLOYER, ...(_mockEmployerOverride ?? {}) };
  }
  const { data, error } = await supabase.from('employers').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return mapEmployer(data);
}

/**
 * Roster: the employer's tagged subscribers (members).
 * @endpoint SELECT subscribers (+ balances/schedule/insurance/nominees)
 *   WHERE employer_id = $1 (RLS auto-scopes).
 * @cache ['employees', employerId]   (key kept for hook/component stability)
 */
export async function getEmployees(employerId) {
  if (!IS_SUPABASE_ENABLED) {
    if (!employerId) return mockMembers();
    return mockMembers().filter((m) => m.employerId === employerId);
  }
  if (!employerId) return [];
  const { data, error } = await supabase
    .from('subscribers')
    .select(MEMBER_SELECT)
    .eq('employer_id', employerId);
  if (error) throw error;
  return (data ?? []).map(mapMember);
}

/** Sum a member's own/employer contribution totals from their transactions. */
async function fetchMemberBreakdown(subscriberId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, source, type')
    .eq('subscriber_id', subscriberId)
    .eq('type', 'contribution');
  if (error) throw error;
  let own = 0;
  let employer = 0;
  for (const t of data ?? []) {
    if (t.source === 'employer') employer += Number(t.amount ?? 0);
    else own += Number(t.amount ?? 0);
  }
  return { ownContributions: own, employerContributions: employer, totalContributions: own + employer };
}

/**
 * One member (tagged subscriber) + their own/employer contribution breakdown.
 * @cache ['employee', employeeId]
 */
export async function getEmployee(employeeId) {
  if (!IS_SUPABASE_ENABLED) {
    if (!employeeId) return null;
    const m = mockMembers().find((x) => x.id === employeeId);
    return m ?? null;
  }
  if (!employeeId) return null;
  const { data, error } = await supabase
    .from('subscribers')
    .select(MEMBER_SELECT)
    .eq('id', employeeId)
    .maybeSingle();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  if (!data) return null;
  const member = mapMember(data);
  const breakdown = await fetchMemberBreakdown(employeeId);
  return { ...member, ...breakdown };
}

/**
 * @endpoint SELECT * FROM contribution_runs WHERE employer_id = $1, newest-first.
 * @cache ['contributionRuns', employerId]
 */
export async function getContributionRuns(employerId) {
  if (!IS_SUPABASE_ENABLED) {
    if (!employerId) return mockRuns();
    return mockRuns().filter((r) => r.employerId === employerId);
  }
  if (!employerId) return [];
  const { data, error } = await supabase
    .from('contribution_runs')
    .select('*')
    .eq('employer_id', employerId)
    .order('run_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRun);
}

/**
 * A run header + its per-member lines (now the employer-source `transactions`
 * carrying contribution_run_id). RLS auto-scopes via the employer policies.
 * @cache ['contributionRun', runId]
 */
export async function getContributionRun(runId) {
  if (!IS_SUPABASE_ENABLED) {
    if (!runId) return null;
    const run = mockRuns().find((r) => r.id === runId);
    if (!run) return null;
    const lines = _mockTxns.filter((t) => t.contributionRunId === runId);
    return { run, lines };
  }
  if (!runId) return null;
  const { data: runRow, error: runErr } = await supabase
    .from('contribution_runs').select('*').eq('id', runId).maybeSingle();
  if (runErr) {
    if (runErr.code === 'PGRST116') return null;
    throw runErr;
  }
  if (!runRow) return null;
  const { data: txRows, error: txErr } = await supabase
    .from('transactions')
    .select('*, subscribers(name)')
    .eq('contribution_run_id', runId);
  if (txErr) throw txErr;
  return {
    run: mapRun(runRow),
    lines: (txRows ?? []).map((t) => ({ ...mapTxn(t), memberName: t.subscribers?.name ?? null })),
  };
}

/**
 * One member's contribution history (own + employer transactions), newest-first.
 * @cache ['employeeContributions', employeeId]
 */
export async function getEmployeeContributions(employeeId) {
  if (!IS_SUPABASE_ENABLED) {
    if (!employeeId) return [];
    // Exclude insurance_premium so a member's history shows their pension flows
    // only — parity with the Supabase path, which filters type='contribution'.
    const notInsurance = (t) => (t.type ?? 'contribution') !== 'insurance_premium';
    const seed = MEMBER_TRANSACTIONS.filter((t) => t.subscriberId === employeeId && notInsurance(t));
    const session = _mockTxns.filter((t) => t.subscriberId === employeeId && notInsurance(t));
    return [...session, ...seed].sort((a, b) =>
      String(b.date ?? '').localeCompare(String(a.date ?? '')));
  }
  if (!employeeId) return [];
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('subscriber_id', employeeId)
    .eq('type', 'contribution')
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapTxn);
}

/**
 * The company's whole pension-contribution history — every payment a run has
 * posted, across all members and all periods, newest-first. This is the
 * transaction-level backing of the Overview's two leg tiles: `source:'own'` is
 * the employee leg, `source:'employer'` the employer leg.
 *
 * Deliberately narrow, so the total on screen RECONCILES with those tiles:
 *   - `type='contribution'` — insurance premiums are a separate run leg and are
 *     excluded from the contribution totals everywhere else too.
 *   - `contribution_run_id NOT NULL` — a member's own private top-ups are their
 *     money, outside the employer's runs, and never counted in a run total. The
 *     employer can already see them per-member on the member detail page.
 * Sums over this list therefore equal Σ runs.employeeTotal / Σ runs.employerTotal.
 *
 * RLS (`transactions_select_employer`, 0043) scopes the read to this employer's
 * tagged members, so no employer filter is needed in the query itself.
 * @param {string} employerId
 * @returns {Promise<Object[]>} mapTxn shape + `memberName`
 * @cache ['employerContributions', employerId]
 */
export async function getEmployerContributions(employerId) {
  const newestFirst = (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''));
  if (!IS_SUPABASE_ENABLED) {
    if (!employerId) return [];
    const names = new Map(mockMembers().map((m) => [m.id, m.name]));
    const isRunContribution = (t) =>
      (t.type ?? 'contribution') === 'contribution' && t.contributionRunId;
    return [..._mockTxns, ...MEMBER_TRANSACTIONS]
      .filter(isRunContribution)
      // Session runs post for the CURRENT roster, so an unknown id here means a
      // member who has since been removed — keep the money, name it plainly.
      .map((t) => ({ ...t, memberName: names.get(t.subscriberId) ?? 'Former member' }))
      .sort(newestFirst);
  }
  if (!employerId) return [];
  const { data, error } = await supabase
    .from('transactions')
    .select('*, subscribers(name)')
    .eq('type', 'contribution')
    .not('contribution_run_id', 'is', null)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t) => ({
    ...mapTxn(t),
    memberName: t.subscribers?.name ?? 'Former member',
  }));
}

/**
 * @endpoint RPC get_employer_metrics() — aggregates over tagged subscribers.
 * @cache ['employerMetrics', employerId]
 */
export async function getEmployerMetrics() {
  if (!IS_SUPABASE_ENABLED) {
    const members = mockMembers();
    const headcount = members.length;
    const active = members.filter((m) => m.status === 'active').length;
    const suspended = headcount - active;
    const totalBalance = members.reduce((s, m) => s + (m.netBalance || 0), 0);
    const ownContributions = members.reduce((s, m) => s + (m.ownContributions || 0), 0);
    const employerContributions = members.reduce((s, m) => s + (m.employerContributions || 0), 0);
    const insuredCount = members.filter((m) => m.insuranceStatus === 'active').length;
    // No funding-shape field is returned: with one unified two-leg model there is
    // nothing to split the roster by, and every member is funded from the SAME
    // company config. `get_employer_metrics` (0092) drops the old `modeSplit` too.
    return {
      headcount, active, suspended, totalBalance,
      totalContributions: ownContributions + employerContributions,
      ownContributions, employerContributions,
      insuredCount,
      employerYtd: employerContributions,
      employeeYtd: ownContributions,
    };
  }
  const { data, error } = await supabase.rpc('get_employer_metrics');
  if (error) throw error;
  return data ?? {};
}

/**
 * Create a new employer (admin only). Wraps the create_employer SECURITY
 * DEFINER RPC (0049), which RAISEs for any app_role other than 'admin'.
 * @param {{name: string, sector?: string, registrationNo?: string,
 *   contactName?: string, contactPhone?: string, contactEmail?: string,
 *   district?: string}} payload
 * @returns {Promise<Object>} the newly-inserted, mapped employer row
 */
export async function createEmployer(payload) {
  if (!IS_SUPABASE_ENABLED) {
    // Emergency mock fallback — shaped row, not persisted.
    const id = payload.id ?? `emp-new-${Date.now()}`;
    return mapEmployer({
      id,
      name: payload.name,
      sector: payload.sector ?? null,
      registration_no: payload.registrationNo ?? null,
      contact_name: payload.contactName ?? null,
      contact_phone: payload.contactPhone ?? null,
      contact_email: payload.contactEmail ?? null,
      district: payload.district ?? null,
      payroll_cadence: payload.payrollCadence ?? null,
      default_contribution_config: payload.defaultContributionConfig ?? {},
      created_at: currentTime().toISOString(),
    });
  }
  const { data, error } = await supabase.rpc('create_employer', {
    p_name: payload.name,
    p_sector: payload.sector ?? null,
    p_registration_no: payload.registrationNo ?? null,
    p_contact_name: payload.contactName ?? null,
    p_contact_phone: payload.contactPhone ?? null,
    p_contact_email: payload.contactEmail ?? null,
    p_district: payload.district ?? null,
  });
  if (error) throw error;
  return mapEmployer(data);
}

/**
 * Admin roster rollup across ALL employers (one row per employer with member
 * count + balances + contributions). Wraps the get_all_employers_metrics RPC
 * (0049, admin-gated). Returns an array of camelCase metric objects.
 * @returns {Promise<Array<Object>>}
 */
export async function getAllEmployersMetrics() {
  if (!IS_SUPABASE_ENABLED) {
    // Emergency mock: the single seeded employer with rolled-up mock metrics.
    const m = await getEmployerMetrics();
    return [{
      id: EMPLOYER.id,
      name: EMPLOYER.name,
      sector: EMPLOYER.sector ?? null,
      district: EMPLOYER.district ?? null,
      status: EMPLOYER.status ?? 'active',
      payrollCadence: EMPLOYER.payrollCadence ?? null,
      createdAt: null,
      headcount: m.headcount ?? 0,
      activeCount: m.active ?? 0,
      totalBalance: m.totalBalance ?? 0,
      totalContributions: m.totalContributions ?? 0,
      employerContributions: m.employerContributions ?? 0,
      insuredCount: m.insuredCount ?? 0,
    }];
  }
  const { data, error } = await supabase.rpc('get_all_employers_metrics');
  if (error) throw error;
  return data ?? [];
}

/** Monthly-contributions leaderboard for the Overview hero (unchanged shape). */
export async function getEmployerLeaderboard(employerId) {
  if (!employerId) return [];
  const runs = await getContributionRuns(employerId);
  // Compare PENSION funding (employee + employer); insurance premiums are a
  // separate leg and don't belong in the contributions leaderboard.
  const myMonthly = runs[0] ? (runs[0].employeeTotal || 0) + (runs[0].employerTotal || 0) : 0;
  const me = await getEmployer(employerId);
  const myName = me?.name || 'Your company';
  const entries = [
    { name: myName, monthlyTotal: myMonthly, isYou: true, deltaRanks: 2 },
    ...LEADERBOARD_COMPETITORS.map((c) => ({ name: c.name, monthlyTotal: c.monthlyTotal, isYou: false, deltaRanks: 0 })),
  ];
  return entries.sort((a, b) => b.monthlyTotal - a.monthlyTotal).map((e, i) => ({ ...e, rank: i + 1 }));
}

// =============================================================================
// Writes — Supabase via 0044 SECURITY DEFINER RPCs; mock via session store.
// =============================================================================

/**
 * Onboard an employee = create a real subscriber tagged to this employer (or
 * link an existing untagged subscriber with the same phone). agent_id is NULL,
 * so NO agent commission fires.
 * @param {string} employerId
 * @param {Object} payload - signup-shaped (phone, fullName, dob, gender, nin,
 *   districtId, consent, contributionSchedule, nominees, …)
 * @param {string} [nonce]
 * @returns {Promise<{ subscriberId: string }>}
 */
export async function createSubscriberFromEmployerOnboard(employerId, payload, nonce) {
  if (!IS_SUPABASE_ENABLED) {
    // Mock: synthesize a 0-balance member (identity only — they set their own
    // saving later), append to the session roster.
    const id = `s-mock-${nonce ?? _mockLinked.length + 1}`;
    _mockLinked.push({
      id,
      employerId,
      name: payload?.fullName ?? 'New member',
      phone: payload?.phone ?? null,
      email: payload?.email ?? null,
      gender: payload?.gender ?? null,
      age: null,
      nin: payload?.nin ?? null,
      isActive: true,
      status: 'active',
      joinedDate: currentTime().toISOString().slice(0, 10),
      compensation: Number(payload?.compensation) || 0,
      monthlyContribution: 0,
      contributionSchedule: null,
      retirementBalance: 0,
      emergencyBalance: 0,
      netBalance: 0,
      unitsHeld: 0,
      ownContributions: 0,
      employerContributions: 0,
      totalContributions: 0,
      insuranceCover: 0,
      insurancePremiumMonthly: 0,
      insuranceStatus: 'inactive',
      insuranceRenewalDate: null,
      nominees: [],
    });
    return { subscriberId: id };
  }
  const { data, error } = await supabase.rpc('create_subscriber_from_employer_onboard', {
    payload,
    calling_employer_id: employerId,
    p_nonce: nonce ?? null,
  });
  if (error) throw error;
  return { subscriberId: data };
}

/**
 * Submits an employer contribution run (funds all active tagged subscribers per
 * the company-wide config). NON-optimistic — the RPC is the truth. Idempotent
 * via `nonce`.
 * @param {string} employerId
 * @param {{ periodLabel?:string, method?:string, nonce?:string }} payload
 */
export async function submitContributionRun(employerId, { periodLabel, method, nonce } = {}) {
  if (!IS_SUPABASE_ENABLED) {
    return _mockSubmitEmployerRun(employerId, { periodLabel, method, nonce });
  }
  const { data, error } = await supabase.rpc('submit_employer_contribution_run', {
    p_period_label: periodLabel ?? null,
    p_method: method ?? null,
    p_nonce: nonce ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * Activates a FLAT group life cover across the caller's tagged subscribers.
 * @param {string} employerId
 * @param {{ cover:number }} payload
 * @returns {Promise<{ updated:number, cover:number }>}
 */
export async function applyGroupInsurance(employerId, { cover } = {}) {
  const coverNum = Number(cover ?? 0);
  if (!IS_SUPABASE_ENABLED) {
    const active = coverNum > 0;
    const owned = mockMembers().filter((m) => !employerId || m.employerId === employerId);
    for (const m of owned) {
      readMemberSession(m.id).insuranceOverride = {
        cover: coverNum, premium: 0,
        status: active ? 'active' : 'inactive',
        renewalDate: m.insuranceRenewalDate,
      };
    }
    return { updated: owned.length, cover: coverNum };
  }
  const { data, error } = await supabase.rpc('apply_group_insurance', { p_cover: coverNum });
  if (error) throw error;
  return data;
}

/**
 * Remove a member from the employer's company. This UN-LINKS the subscriber
 * from the employer (`employer_id → NULL`) so they drop off the roster — it does
 * NOT suspend or deactivate them. Their pension account stays active and they
 * continue as an individual subscriber. Scoped to the caller's own roster (the
 * RPC enforces the `employerId` claim; the mock keys by id).
 * @param {string} employerId
 * @param {string} employeeId  the member's subscriber id
 * @returns {Promise<{ id:string, removed:boolean }>}
 */
export async function removeEmployee(employerId, employeeId) {
  if (!employeeId) throw new Error('Missing employee id');
  if (!IS_SUPABASE_ENABLED) {
    _mockRemovedIds.add(employeeId);
    return { id: employeeId, removed: true };
  }
  const { data, error } = await supabase.rpc('remove_employer_member', {
    p_subscriber_id: employeeId,
  });
  if (error) throw error;
  return data;
}

/**
 * Update a member's monthly compensation (UGX) — the driver field for the
 * two-leg contribution run (migration 0062). Employer-gated SECURITY DEFINER
 * RPC (`update_employer_member_compensation`); validates `>= 0`. Scoped to the
 * caller's own roster (the RPC enforces the `employerId` claim; the mock keys
 * by id). Setting compensation does NOT post a contribution — it only changes
 * what the NEXT run will fund.
 * @param {string} employerId
 * @param {string} subscriberId  the member's subscriber id
 * @param {number} compensation  monthly compensation in UGX (>= 0)
 * @returns {Promise<{ id:string, compensation:number, updated:number }>}
 */
export async function updateMemberCompensation(employerId, subscriberId, compensation) {
  if (!subscriberId) throw new Error('Missing subscriber id');
  const comp = Number(compensation);
  if (!IS_SUPABASE_ENABLED) {
    readMemberSession(subscriberId).compensationOverride = Math.max(0, comp || 0);
    return { id: subscriberId, compensation: Math.max(0, comp || 0), updated: 1 };
  }
  const { data, error } = await supabase.rpc('update_employer_member_compensation', {
    p_subscriber_id: subscriberId,
    p_compensation: comp,
  });
  if (error) throw error;
  return data;
}

/**
 * @endpoint RPC set_employer_status(p_employer_id, p_status) — admin-only
 *   SECURITY DEFINER (0060). Flips employers.status; on 'inactive' detaches all
 *   members (employer_id -> NULL, is_active untouched → self-onboarded).
 *   Since 0080 the detach is JOURNALLED and reactivate REPLAYS it — every
 *   detached member returns to the roster (rows re-tagged meanwhile are kept).
 * @param {string} id
 * @param {'active'|'inactive'} status
 * @returns {Promise<{id:string,status:string,membersDetached:number}>}
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function setEmployerStatus(id, status) {
  if (!IS_SUPABASE_ENABLED) return { id, status, membersDetached: 0 };
  const { data, error } = await supabase.rpc('set_employer_status', {
    p_employer_id: id,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

/**
 * Patches the caller's own employer profile row (incl. the company config).
 *
 * ATOMIC group-insurance fold (audit §7d-3, migration 0056): when the patch
 * carries the company-wide insurance toggle (`insuranceEnabled` present), the
 * group cover is applied in the SAME `update_employer_profile` transaction —
 * `p_group_cover` + `p_insurance_enabled` are forwarded and stripped out of
 * `p_patch` (which keeps only the profile/config columns the RPC reads). When
 * the patch omits `insuranceEnabled` (the profile-tab save), the call is
 * IDENTICAL to before — a single `{ p_patch }` arg, no insurance leg — so
 * existing callers/tests are unaffected. Folding insurance in here lets the save
 * be one atomic call instead of the old non-atomic updateProfile→applyGroupInsurance
 * chain. (`applyGroupInsurance` below is retained for any other caller.)
 *
 * @param {object} patch - camelCase profile/config keys, optionally plus
 *   `insuranceEnabled` (boolean) and `groupCover` (number|null) to fold the
 *   roster-wide cover into the same transaction.
 */
export async function updateEmployerProfile(patch) {
  const { insuranceEnabled, groupCover, ...profilePatch } = patch ?? {};
  const foldInsurance = insuranceEnabled !== undefined;
  const coverNum = groupCover == null ? null : Number(groupCover);

  if (!IS_SUPABASE_ENABLED) {
    _mockEmployerOverride = { ...(_mockEmployerOverride ?? {}), ...profilePatch };
    if (foldInsurance) {
      // Mirror the SQL leg in the mock so the demo roster stays consistent with
      // the saved config: enabled → flat cover for everyone, disabled → cleared.
      const active = !!insuranceEnabled && Number(coverNum) > 0;
      const cover = active ? Number(coverNum) : 0;
      for (const m of mockMembers()) {
        readMemberSession(m.id).insuranceOverride = {
          cover, premium: 0,
          status: active ? 'active' : 'inactive',
          renewalDate: m.insuranceRenewalDate,
        };
      }
    }
    return { ...EMPLOYER, ..._mockEmployerOverride };
  }
  const args = { p_patch: profilePatch ?? {} };
  if (foldInsurance) {
    args.p_insurance_enabled = !!insuranceEnabled;
    args.p_group_cover = coverNum;
  }
  const { data, error } = await supabase.rpc('update_employer_profile', args);
  if (error) throw error;
  return mapEmployer(data);
}

// =============================================================================
// Employer invites (KYC onboarding) — 0047 RPCs.
// =============================================================================

/** Map an employer_invites row → camelCase. */
function mapInvite(row) {
  if (!row) return null;
  return {
    token: row.token,
    employerId: row.employer_id,
    prefill: row.prefill ?? {},
    collectSchedule: row.collect_schedule ?? false,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Create an employer invite. Returns { token, collectSchedule }.
 *
 * `collectSchedule` is a SIGNUP-DEPTH flag, NOT a funding flag. It decides which
 * screen the invited MEMBER gets: true = the full wizard (frequency + amount +
 * insurance + "Pay {total}"), false = the compact split-only completion. Neither
 * branch lets the member choose a saving amount that survives — both force
 * schedule amount 0 and skip the signup deposit, because the employer's
 * contribution run is what funds them. So no field in the company config can
 * legitimately derive it, and since 0092 `create_employer_invite` hardcodes it
 * FALSE: a sponsored member has no amount to pick (the employer sets both legs)
 * and must not be offered insurance their employer already funds — 0068 rejects
 * that re-buy server-side. This mock mirrors the RPC.
 * @param {{ fullName, phone, email?, nin?, gender? }} prefill
 */
export async function createEmployerInvite(prefill) {
  if (!IS_SUPABASE_ENABLED) {
    const token = `inv-mock-${_mockInvites.length + 1}`;
    // Constant — parity with the RPC. Never derive this from the config.
    const collectSchedule = false;
    _mockInvites.push({
      token, employer_id: EMPLOYER.id, prefill, collect_schedule: collectSchedule,
      status: 'pending', created_at: currentTime().toISOString(),
      expires_at: new Date(currentTime().getTime() + 7 * 86400000).toISOString(),
    });
    return { token, collectSchedule };
  }
  const { data, error } = await supabase.rpc('create_employer_invite', { p_prefill: prefill });
  if (error) throw error;
  return data;
}

/**
 * Bulk onboarding — create an invite for each prefill (Excel mass-upload). Each
 * is an independent `createEmployerInvite` call; one failure doesn't abort the
 * rest. Returns a summary { created, failed, total }.
 * @param {object[]} prefills
 */
export async function bulkCreateEmployerInvites(prefills = []) {
  const results = await Promise.allSettled(prefills.map((p) => createEmployerInvite(p)));
  const created = results.filter((r) => r.status === 'fulfilled').length;
  return { created, failed: prefills.length - created, total: prefills.length };
}

/**
 * List the employer's PENDING invites (the roster's pending-KYC rows).
 *
 * Each row is decorated with `lastNudge` from the session nudge log
 * (`{ at, channels }`, or null) so the pending-KYC page can show who has
 * already been reminded without a schema change — see `_nudgeLog` below.
 */
export async function listPendingInvites(employerId) {
  if (!IS_SUPABASE_ENABLED) {
    return _mockInvites
      .filter((i) => i.employer_id === employerId && i.status === 'pending')
      .map(mapInvite)
      .map(withNudge);
  }
  if (!employerId) return [];
  const { data, error } = await supabase
    .from('employer_invites')
    .select('*')
    .eq('employer_id', employerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapInvite).map(withNudge);
}

/** Attach the session nudge record (if any) to a mapped invite. */
function withNudge(invite) {
  return { ...invite, lastNudge: _nudgeLog.get(invite.token) ?? null };
}

/**
 * Session-scoped record of which invites have been nudged and when, keyed by
 * token → { at: ISO string, channels: string[] }. Deliberately in-memory:
 * persisting it would need a column on `employer_invites`, and the send itself
 * is a demo mock (no provider), so a per-session log is the honest scope — it
 * mirrors the `_sessionMutations` / `_entityOverrides` stores elsewhere and
 * resets on refresh. See CLAUDE.md §10a.
 */
const _nudgeLog = new Map();

/** Nudge history for the invites currently on screen. Never throws. */
export function getInviteNudgeLog() {
  return Object.fromEntries(_nudgeLog);
}

/**
 * Send a "finish your sign-up" reminder to pending invitees.
 *
 * DEMO SCOPE (CLAUDE.md §10a): no email / SMS / WhatsApp provider is wired up.
 * This resolves after a realistic pause and records the attempt in the session
 * nudge log so the UI can show "reminded 2 minutes ago". Nothing is delivered.
 *
 * Reachability is enforced per recipient, not globally: a channel only counts
 * for someone who has the contact detail it needs (`constants/nudge.js`). An
 * invite that none of the chosen channels can reach is reported back in
 * `unreachable` so the caller can say so rather than silently dropping them.
 *
 * @param {{ invites: Array<{token:string, prefill?:object}>, channels: string[] }} payload
 * @returns {Promise<{ sent:number, unreachable:Array<{token:string,name:string}>,
 *   perChannel: Record<string, number> }>}
 */
export async function sendInviteNudges({ invites = [], channels = [] } = {}) {
  await new Promise((resolve) => setTimeout(resolve, NUDGE_LATENCY_MS));

  const perChannel = Object.fromEntries(channels.map((c) => [c, 0]));
  const unreachable = [];
  let sent = 0;

  for (const inv of invites) {
    const reachable = reachableChannels(inv, channels);
    if (reachable.length === 0) {
      unreachable.push({ token: inv.token, name: inv.prefill?.fullName || 'Invited member' });
      continue;
    }
    for (const channelId of reachable) perChannel[channelId] += 1;
    sent += 1;
    // REAL clock, deliberately not `currentTime()`. This records something the
    // user just did in this session, and it is rendered with
    // `formatRelativeTime`, which compares against the real `new Date()`.
    // Stamping it with MOCK_NOW (2026-07-01) made a just-sent reminder read as
    // "Reminded 1 Jul". MOCK_NOW is for seeded demo data, not live actions.
    _nudgeLog.set(inv.token, { at: new Date().toISOString(), channels: reachable });
  }

  return { sent, unreachable, perChannel };
}

/** Cancel (expire) a pending invite. */
export async function cancelEmployerInvite(token) {
  if (!IS_SUPABASE_ENABLED) {
    const inv = _mockInvites.find((i) => i.token === token);
    if (inv) inv.status = 'expired';
    return;
  }
  const { error } = await supabase.rpc('cancel_employer_invite', { p_token: token });
  if (error) throw error;
}

// Re-export the data sources the mock fallback touches (drift detection).
export const _employerMockSources = {
  EMPLOYER,
  MEMBERS,
  CONTRIBUTION_RUNS,
  MEMBER_TRANSACTIONS,
};
