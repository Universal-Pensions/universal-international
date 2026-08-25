// Subscriber data service — Supabase-backed read/write for the Subscriber
// dashboard. All RLS reads use the user's JWT (injected by supabaseClient.js).
//
// Rollback: when `IS_SUPABASE_ENABLED === false`, every function falls back to
// the legacy in-memory mock-backed implementation that mutates frozen mockData
// through a per-session override Map. This lets us flip the platform back to
// mocks via `VITE_USE_SUPABASE=false` without redeploying.
//
// Field-name mapping (snake_case in DB → camelCase on the frontend):
//   subscribers.kyc_status            → kycStatus
//   subscribers.is_active             → isActive
//   subscribers.registered_date       → registeredDate
//   subscribers.contribution_history  → contributionHistory
//   subscribers.products_held         → productsHeld
//   subscribers.current_unit_value    → currentUnitValue
//   subscribers.unit_value_as_of      → unitValueAsOf
//   subscriber_balances.total_balance → netBalance
//   subscriber_balances.retirement_*  → retirementBalance
//   subscriber_balances.emergency_*   → emergencyBalance
//   subscriber_balances.units         → unitsHeld
// The mappers below preserve the legacy frontend shape so every existing
// caller (hooks, dashboard pages) keeps working.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';
import { normalizeFrequency } from '../utils/finance';
import { derivePolicies } from '../utils/policies';
import { hospitalCashQuote } from '../utils/hospitalCash';
import { HOSPITAL_CASH_DAYS } from '../constants/savings';
import { paidThisMonth } from '../utils/periodSettlement';
import { normalizeContributionConfig } from '../utils/contributionModel';
import { SUBSCRIBERS, AGENTS, BRANCHES, currentTime } from '../data/mockData';
// Employer-sponsored members and the company-wide funding config live in the
// employer seed, so the offline branch of `getMyEmployerFunding` has to read it —
// mockData's generated subscribers are all self-funded savers with no employer tag
// and no `compensation`. Service files are the only layer allowed to import
// `src/data/*` (CLAUDE.md §4.1).
import { EMPLOYER, MEMBERS } from '../data/employerSeed';

// =============================================================================
// Legacy mock fallback (used when IS_SUPABASE_ENABLED === false)
// =============================================================================

/** In-memory mutation store (per session). Keyed by subscriber ID. */
const _sessionMutations = new Map();

function readSession(id) {
  if (!_sessionMutations.has(id)) {
    _sessionMutations.set(id, {
      extraTransactions: [],
      extraClaims: [],
      extraWithdrawals: [],
      scheduleOverride: null,
      nomineesOverride: null,
      insuranceOverride: null,
      // Per-product insurance rows added/paid this session (mock mode only).
      // Each { product, cover, premiumMonthly, policyStart, renewalDate, status }.
      // Live mode reflects new products via the real insurance_policies rows on
      // refetch, so this override is only consulted in the mock branch.
      insuranceProductsOverride: [],
      profileOverride: null,
      // Per-policy renewal overrides (keyed by product: 'life'|'health'|'funeral').
      // Each holds { status, renewalDate, paidRef }; derivePolicies reads
      // renewalDate to flip a renewed policy back to active. Demo-only; resets
      // on refresh.
      policyRenewals: {},
      balanceDelta: { retirement: 0, emergency: 0, total: 0 },
    });
  }
  return _sessionMutations.get(id);
}

function applyMutations(sub) {
  if (!sub) return sub;
  const m = readSession(sub.id);
  const mergedTx = [...m.extraTransactions, ...(sub.transactions || [])];
  mergedTx.sort((a, b) => b.date.localeCompare(a.date));
  // Merge any session-added insurance products over the base set. The base set
  // is the subscriber's `insuranceProducts` array (Supabase reads) or, for the
  // frozen mock subscribers, a single 'life' entry synthesised from `insurance`.
  const insurance = m.insuranceOverride ?? sub.insurance;
  const baseProducts = sub.insuranceProducts ?? (
    insurance && Number(insurance.cover) > 0
      ? [{
          product: 'life',
          cover: insurance.cover,
          premiumMonthly: insurance.premiumMonthly,
          policyStart: insurance.policyStart,
          renewalDate: insurance.renewalDate,
          status: insurance.status,
        }]
      : []
  );
  const overridden = new Set(m.insuranceProductsOverride.map((o) => o.product));
  const insuranceProducts = [
    ...m.insuranceProductsOverride,
    ...baseProducts.filter((p) => !overridden.has(p.product)),
  ];
  return {
    ...sub,
    ...(m.profileOverride ?? null),
    contributionSchedule: m.scheduleOverride ?? sub.contributionSchedule,
    nominees: m.nomineesOverride ?? sub.nominees,
    insurance,
    insuranceProducts,
    claims: [...m.extraClaims, ...(sub.claims || [])],
    withdrawals: [...m.extraWithdrawals, ...(sub.withdrawals || [])],
    transactions: mergedTx,
    netBalance: Math.max(0, (sub.netBalance || 0) + m.balanceDelta.total),
    retirementBalance: Math.max(0, (sub.retirementBalance || 0) + m.balanceDelta.retirement),
    emergencyBalance: Math.max(0, (sub.emergencyBalance || 0) + m.balanceDelta.emergency),
    unitsHeld: Math.max(0, sub.unitsHeld + (m.balanceDelta.total / (sub.currentUnitValue || 1))),
    // Cost basis moves with the session's own money too, or an unsaved
    // contribution would read as instant growth — the exact bug this replaced.
    // Contributions add their full amount; a withdrawal removes the same
    // FRACTION of basis as of value (average-cost), so growth% is unchanged by it.
    invested: (() => {
      const base = Number(sub.invested) || 0;
      const priorTotal = Number(sub.netBalance) || 0;
      const delta = m.balanceDelta.total || 0;
      if (delta >= 0) return base + delta;
      if (priorTotal <= 0) return 0;
      return Math.max(0, base * (1 - Math.min(1, -delta / priorTotal)));
    })(),
    totalContributions:
      (sub.totalContributions || 0) +
      m.extraTransactions
        .filter((t) => t.type === 'contribution')
        .reduce((s, t) => s + t.amount, 0),
  };
}

/**
 * Attach the derived `policies` array (life + synthesised health, with
 * active/expired computed from the demo clock and any session renewals) to a
 * subscriber. Runs for BOTH mock and Supabase reads so every consumer sees the
 * same shape. The pure derivation lives in utils/policies (which may not import
 * the demo clock); reading currentTime() here keeps that rule (§4.1) intact.
 */
function attachPolicies(sub) {
  if (!sub) return sub;
  const { policyRenewals } = readSession(sub.id);
  return {
    ...sub,
    policies: derivePolicies(sub, { now: currentTime(), renewalOverrides: policyRenewals }),
  };
}

/**
 * Set/clear the session life-renewal override so the derived life policy reads
 * as active (with a fresh year-long renewal) or reverts. Used by both
 * updateInsuranceCover (picking cover = activating) and renewPolicy. Works in
 * mock and Supabase modes because the session store is mode-independent.
 */
function setRenewalOverride(id, type, active) {
  const m = readSession(id);
  if (active) {
    m.policyRenewals = {
      ...m.policyRenewals,
      [type]: { status: 'active', renewalDate: renewalIsoFromNow(1) },
    };
  } else {
    const next = { ...m.policyRenewals };
    delete next[type];
    m.policyRenewals = next;
  }
  return m.policyRenewals[type];
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Format a Date as YYYY-MM-DD (local parts), matching mockData's date strings. */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The demo clock + N years, as a YYYY-MM-DD string. */
function renewalIsoFromNow(years = 1) {
  const d = currentTime();
  d.setFullYear(d.getFullYear() + years);
  return isoDate(d);
}

// =============================================================================
// Supabase mappers
// =============================================================================

/**
 * Map a `subscribers` row + (optional) joined `subscriber_balances` /
 * `contribution_schedules` / `insurance_policies` rows into the camelCase
 * shape the frontend expects. Missing joined rows fall back to safe defaults
 * so consumers can always read `sub.netBalance ?? 0` etc.
 */
function mapSubscriberRow(row) {
  if (!row) return null;
  const bal = Array.isArray(row.subscriber_balances)
    ? row.subscriber_balances[0]
    : row.subscriber_balances;
  const sched = Array.isArray(row.contribution_schedules)
    ? row.contribution_schedules[0]
    : row.contribution_schedules;
  // Life cover lives in insurance_policies (single row per subscriber); the extra
  // products (health/funeral) live in subscriber_insurance_products (migration
  // 0064). `insurance` keeps pointing at the life row (cover slider / signup
  // parity); `insuranceProducts` below merges life + the extras for the policies
  // list + the settle flow.
  const ins = Array.isArray(row.insurance_policies)
    ? row.insurance_policies[0]
    : row.insurance_policies;
  const extraInsuranceRows = Array.isArray(row.subscriber_insurance_products)
    ? row.subscriber_insurance_products
    : (row.subscriber_insurance_products ? [row.subscriber_insurance_products] : []);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    gender: row.gender,
    age: row.age,
    dob: row.dob,
    nin: row.nin,
    occupation: row.occupation,
    parentId: row.agent_id,             // legacy field name kept for callers
    agentId: row.agent_id,
    // Set when an employer onboarded them (0043). The employer's NAME is
    // deliberately NOT here: RLS gives a subscriber JWT no SELECT on `employers`
    // (only employer_self_select 0036 + employers_select_admin 0049 exist), so a
    // PostgREST embed of `employers(name)` on this read would come back null on
    // every call, and widening RLS would hand every member the whole employer row
    // (contact name/phone/email, registration no). Consumers that need the name —
    // e.g. the Policies page's "Paid by {employerName}" badge, which is why that
    // badge sat on its "your employer" fallback — read
    // `useMyEmployerFunding().employerName`, backed by the narrow 0092 RPC.
    employerId: row.employer_id ?? null,
    districtId: row.district_id,
    kycStatus: row.kyc_status,
    isActive: row.is_active,
    registeredDate: row.registered_date,
    consentAt: row.consent_at,
    lastContributionDate: row.last_contribution_date,
    contributionHistory: row.contribution_history ?? [],
    productsHeld: row.products_held ?? [],
    currentUnitValue: row.current_unit_value,
    unitValueAsOf: row.unit_value_as_of,
    insuranceSameAsPension: row.insurance_same_as_pension,

    // Balance snapshot (from subscriber_balances).
    // Since migration 0104 `total_balance` is MARKET VALUE — the member's units
    // priced at the fund's current unit price — not a running cash total. It
    // moves whenever the admin publishes a new NAV.
    netBalance: Number(bal?.total_balance ?? 0),
    retirementBalance: Number(bal?.retirement_balance ?? 0),
    emergencyBalance: Number(bal?.emergency_balance ?? 0),
    unitsHeld: Number(bal?.units ?? 0),
    retirementUnits: Number(bal?.retirement_units ?? 0),
    emergencyUnits: Number(bal?.emergency_units ?? 0),
    // Cost basis: what the member actually paid in, reduced proportionally on
    // withdrawal. This is what makes deriveInvestmentGrowth() real rather than
    // invented — see the warning on that function.
    invested: Number(bal?.invested ?? 0),
    // Which valuation day the cached balance figures reflect.
    navAsOf: bal?.nav_as_of ?? null,
    // `totalContributions` now reads the real cost basis. It used to alias
    // total_balance, which was defensible only while the unit price was frozen
    // and balance therefore equalled money contributed. With a floating NAV that
    // alias would report market value as "contributed" and overstate it by the
    // growth. `invested` is the honest answer to "what went in".
    totalContributions: Number(bal?.invested ?? 0),
    totalWithdrawals: 0,

    // Schedule (from contribution_schedules)
    contributionSchedule: sched
      ? {
          frequency: normalizeFrequency(sched.frequency),
          amount: Number(sched.amount),
          retirementPct: Number(sched.retirement_pct ?? 80),
          emergencyPct: Number(sched.emergency_pct ?? 20),
          includeInsurance: !!sched.include_insurance,
          insuranceChoiceMade: !!sched.insurance_choice_made,
          nextDueDate: sched.next_due_date,
          // save-to-cover + indexation (migration 0072)
          insuranceFundingMode: sched.insurance_funding_mode ?? 'pay_now',
          insurancePremiumTarget: Number(sched.insurance_premium_target ?? 0),
          insurancePremiumAccrued: Number(sched.insurance_premium_accrued ?? 0),
          insuranceSavingsPct: Number(sched.insurance_savings_pct ?? 100),
          contributionIndexationPct: Number(sched.contribution_indexation_pct ?? 0),
        }
      : null,

    // Insurance (from insurance_policies); fall back to inactive 0/0 if missing
    insurance: ins
      ? {
          cover: Number(ins.cover ?? 0),
          premiumMonthly: Number(ins.premium_monthly ?? 0),
          policyStart: ins.policy_start,
          renewalDate: ins.renewal_date,
          status: ins.status ?? 'inactive',
        }
      : { cover: 0, premiumMonthly: 0, status: 'inactive' },

    // All held insurance products (life from insurance_policies + the extras from
    // subscriber_insurance_products), one entry per held product with cover>0.
    // derivePolicies builds the policies list from this.
    insuranceProducts: [
      ...(ins && Number(ins.cover ?? 0) > 0
        ? [{
            product: 'life',
            cover: Number(ins.cover ?? 0),
            premiumMonthly: Number(ins.premium_monthly ?? 0),
            policyStart: ins.policy_start,
            renewalDate: ins.renewal_date,
            status: ins.status ?? 'inactive',
            fundedBy: ins.funded_by ?? 'self',
          }]
        : []),
      ...extraInsuranceRows
        .filter((p) => Number(p.cover ?? 0) > 0)
        .map((p) => ({
          product: p.product,
          cover: Number(p.cover ?? 0),
          premiumMonthly: Number(p.premium_monthly ?? 0),
          policyStart: p.policy_start,
          renewalDate: p.renewal_date,
          status: p.status ?? 'inactive',
          fundedBy: p.funded_by ?? 'self',
        })),
    ],
  };
}

function mapTransactionRow(row) {
  if (!row) return null;
  // Withdrawals are stored as positive magnitudes; the legacy mock shape
  // delivered them as negative numbers for display. Preserve that for the UI.
  const amount = row.type === 'withdrawal' ? -Math.abs(Number(row.amount)) : Number(row.amount);
  return {
    id: row.id,
    subscriberId: row.subscriber_id,
    agentId: row.agent_id,
    type: row.type,
    // Which SIDE of the ledger the money sits on (0043): 'own' = the member's own
    // pot contribution, 'employer' = the company's own top-up money. 'own' is NOT
    // evidence the member chose to pay — see contributionRunId below.
    source: row.source ?? 'own',
    amount,
    date: row.date,
    status: row.status,
    method: row.method,
    reference: row.txn_ref,
    bucket: row.bucket,
    splitRetirement: row.split_retirement,
    splitEmergency: row.split_emergency,
    // The employer contribution run that posted this row (0043), null for anything
    // the member did themselves. THE disambiguator for source='own': a run posts
    // the EMPLOYEE leg as source='own' using the EMPLOYER's payment method, and
    // under the unified model (0092) the company sets that leg with no member
    // involvement at all. So 'own' alone cannot tell a payroll deduction apart from
    // a top-up the member actually made, and labelling a run-posted row "You've
    // contributed" / "via Bank transfer" / Source "Own" states something false.
    // Any row carrying a run id came out of the member's PAY — word it
    // "From your pay". Only the source='employer' leg is an "Employer top-up".
    contributionRunId: row.contribution_run_id ?? null,
  };
}

function mapClaimRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    subscriberId: row.subscriber_id,
    // `product` is the discriminator from migration 0099; `type` holds a legacy
    // incident category on older rows and mirrors `product` on newer ones.
    product: row.product ?? null,
    type: row.type,
    status: row.status,
    amount: Number(row.amount),
    // For hospital cash, incident_date is the ADMISSION date.
    incidentDate: row.incident_date,
    dischargeDate: row.discharge_date ?? null,
    nights: row.nights == null ? null : Number(row.nights),
    provider: row.provider ?? null,
    dailyBenefit: row.daily_benefit == null ? null : Number(row.daily_benefit),
    submittedDate: row.submitted_date,
    description: row.description,
  };
}

function mapWithdrawalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    subscriberId: row.subscriber_id,
    amount: Number(row.amount),
    bucket: row.bucket,
    reason: row.reason,
    method: row.method,
    status: row.status,
    date: row.date,
    reference: row.reference,
  };
}

function mapNomineeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    subscriberId: row.subscriber_id,
    type: row.type,
    name: row.name,
    phone: row.phone,
    relationship: row.relationship,
    nin: row.nin,
    share: Number(row.share),
  };
}

function mapAgentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    employeeId: row.employee_id,
    parentId: row.branch_id,        // legacy field name kept for callers
    branchId: row.branch_id,
    branchName: row.branches?.name ?? '—',
    phone: row.phone,
    email: row.email,
    rating: Number(row.rating ?? 0),
    performance: row.performance,
    status: row.status,
    languages: row.languages ?? [],
    specialties: row.specialties ?? [],
    tenureMonths: row.tenure_months,
    joinedDate: row.joined_date,
  };
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// =============================================================================
// Reads
// =============================================================================

/**
 * Returns the current subscriber by phone. Joins `subscriber_balances`,
 * `contribution_schedules`, and `insurance_policies` so the dashboard gets a
 * single record with the legacy flat shape. RLS only exposes the caller's own
 * subscriber row, so the JWT-bearing client sees at most one match.
 *
 * Note: this JOIN approach was chosen over follow-up queries because (a) it's
 * a single round-trip, (b) all four tables are PK-joined by subscriber_id, so
 * the cost is minimal, and (c) the cached query in React Query can serve the
 * whole shape to every consumer without re-fetching.
 */
export async function getCurrentSubscriber(phone) {
  if (!IS_SUPABASE_ENABLED) {
    const list = Object.values(SUBSCRIBERS);
    if (!list.length) return null;
    if (phone) {
      const match = list.find((s) => s.phone?.endsWith(phone) || s.phone === phone);
      if (match) return attachPolicies(applyMutations(match));
    }
    const demo = list.find((s) =>
      typeof s.age === 'number' &&
      s.age >= 28 && s.age <= 42 &&
      s.contributionSchedule?.amount > 0
    );
    return attachPolicies(applyMutations(demo ?? list[0]));
  }

  // RLS (subscribers_select_self) already scopes to the JWT's subscriberId, so
  // the JWT-bearing client sees exactly one row — its own. Filtering by phone
  // on top is redundant AND fragile: if AuthContext.user.phone disagrees
  // byte-for-byte with the DB row's phone (e.g. legacy session stored a
  // pre-normalization value), the filter narrows the RLS-allowed row to zero
  // and the dashboard renders "No account found". The `phone` arg is kept in
  // the signature for the mock branch above.
  const { data, error } = await supabase
    .from('subscribers')
    .select('*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), subscriber_insurance_products(*)')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return attachPolicies(mapSubscriberRow(data));
}

export async function getSubscriberTransactions(id, { type, range, status } = {}) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) return [];
    let tx = applyMutations(sub).transactions || [];
    if (type) tx = tx.filter((t) => t.type === type);
    if (status) tx = tx.filter((t) => t.status === status);
    if (range) {
      const [from, to] = range;
      tx = tx.filter((t) => t.date >= from && t.date <= to);
    }
    return tx;
  }

  if (!id) return [];
  // Narrowed from select('*') to exactly the columns mapTransactionRow reads
  // (the sole consumer of these rows). This is the highest-volume subscriber
  // list path, so trimming the over-fetch matters; keep this column set in sync
  // with mapTransactionRow if a new mapped field is added. `contribution_run_id`
  // is what lets every subscriber surface tell a payroll-deducted employee leg
  // apart from a top-up the member actually made (see mapTransactionRow).
  let q = supabase
    .from('transactions')
    .select(
      'id, subscriber_id, agent_id, type, source, amount, date, status, method, txn_ref, bucket, split_retirement, split_emergency, contribution_run_id',
    )
    .eq('subscriber_id', id)
    .order('date', { ascending: false });
  if (type) q = q.eq('type', type);
  if (status) q = q.eq('status', status);
  if (range) {
    const [from, to] = range;
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
  }
  const rows = unwrap(await q);
  return (rows ?? []).map(mapTransactionRow);
}

/**
 * Sum of the subscriber's OWN contributions in the current (demo-clock) month —
 * the basis for the schedule "pay the difference" settle flow. Lives in the
 * service layer because it needs `currentTime()` (the demo clock), which
 * components/hooks may not import (§4.1). The month-window logic itself is the
 * pure `paidThisMonth` util.
 */
export async function getContributionPaidThisMonth(id) {
  if (!id) return 0;
  const txns = await getSubscriberTransactions(id, { type: 'contribution' });
  return paidThisMonth(txns, currentTime());
}

/**
 * Total / own / employer contribution split for a subscriber (0043), bucketed by
 * the ledger's `source`. Drives the employer-funding view on the subscriber
 * dashboard.
 *
 * "own" = the member's SIDE of the pot — NOT necessarily money they chose to send.
 * An employer contribution run posts the EMPLOYEE leg with source='own', and under
 * the unified model (0092) the company sets that leg with no member involvement,
 * so this bucket mixes self-paid top-ups with payroll deductions. Any surface that
 * has to say WHO made a payment must split on each row's `contributionRunId`
 * instead (see mapTransactionRow), not on `source`. "employer" = the company's own
 * leg (source='employer') — that one is unambiguously the employer's money.
 *
 * Source-based and therefore funding-model-agnostic: it reads what was actually
 * posted, so collapsing the old contribution modes into the two-leg model needed
 * no change here.
 * @param {string} id
 * @returns {Promise<{ own:number, employer:number, total:number }>}
 */
export async function getContributionBreakdown(id) {
  if (!id) return { own: 0, employer: 0, total: 0 };
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    const tx = sub ? (applyMutations(sub).transactions || []) : [];
    let own = 0;
    let employer = 0;
    for (const t of tx) {
      if (t.type !== 'contribution') continue;
      if (t.source === 'employer') employer += Number(t.amount || 0);
      else own += Math.abs(Number(t.amount || 0));
    }
    return { own, employer, total: own + employer };
  }
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, source, type')
    .eq('subscriber_id', id)
    .eq('type', 'contribution');
  if (error) throw error;
  let own = 0;
  let employer = 0;
  for (const t of data ?? []) {
    if (t.source === 'employer') employer += Number(t.amount || 0);
    else own += Number(t.amount || 0);
  }
  return { own, employer, total: own + employer };
}

/**
 * Who funds the caller's pension: the employer's name, the SIX canonical
 * contribution keys, and the member's own monthly compensation. `null` when the
 * member is not employer-sponsored — the overwhelming majority (the
 * agent→subscriber tree self-funds), and a normal state, not an error: callers
 * hide the funding surface rather than rendering zeros.
 *
 * WHY AN RPC AND NOT A JOIN. The only SELECT policies on `employers` are
 * `employer_self_select` (0036) and `employers_select_admin` (0049), so a
 * subscriber JWT cannot read its own employer row — not the config, not even the
 * name. Widening RLS would expose the WHOLE row (contact name/phone/email,
 * registration no) to every member of every employer, so 0092 adds the narrow
 * SECURITY DEFINER `get_my_employer_funding()` that returns only the funding
 * facts. It resolves the member from the VERIFIED `subscriberId` claim (never an
 * argument) and normalises the stored config with the same
 * `_normalize_contribution_config` the run RPC uses, so what the member is told
 * and what the run actually posts can never disagree.
 *
 * The six keys arrive ALREADY normalised (a basis + a pct + an amount per leg), so
 * callers hand them straight to `deriveContributionLegs` / `memberFundingSummary`
 * / `formatLegRateForMember` in utils/contributionModel and every surface words it
 * identically. Either leg may legitimately be 0, and 0/0 is a legal employer
 * config — that is the case `memberFundingSummary` signals by returning null.
 *
 * @param {string} [subscriberId] MOCK BRANCH ONLY, exactly like the `phone` arg on
 *   `getCurrentSubscriber` — the live RPC takes no argument and trusts the JWT, so
 *   passing an id can never widen what a caller sees.
 * @returns {Promise<null | {employerName:string, employeePct:number,
 *   employerPct:number, compensation:number}>}
 */
export async function getMyEmployerFunding(subscriberId) {
  if (!IS_SUPABASE_ENABLED) {
    // Employer-tagged members exist ONLY in the employer seed; mockData's generated
    // subscribers carry neither an employerId nor a `compensation` for a percent leg
    // to bite on, so they correctly resolve to null (self-funded saver). With no id —
    // the live signature takes none — fall back to whoever getCurrentSubscriber
    // resolves so both call styles behave the same offline.
    const member = subscriberId
      ? (MEMBERS.find((m) => m.id === subscriberId) ?? SUBSCRIBERS[subscriberId] ?? null)
      : await getCurrentSubscriber();
    if (!member?.employerId) return null;
    // Normalised for the same reason the RPC normalises: the seed config is already
    // unified, but no caller should ever have to care which shape was stored.
    // Known offline gap: the employer service's per-session `compensationOverride`
    // is private to that module, so a pay change made employer-side in the same demo
    // session is not reflected here — the frozen seed compensation is used.
    return {
      employerName: EMPLOYER.name,
      ...normalizeContributionConfig(EMPLOYER.defaultContributionConfig),
      compensation: Number(member.compensation ?? 0),
    };
  }

  // No argument: the RPC reads the subscriberId claim. Not-sponsored (and an
  // employer row deleted out from under the tag) come back as jsonb `null`, which
  // supabase-js hands us as JS null — `?? null` only guards the undefined case.
  const { data, error } = await supabase.rpc('get_my_employer_funding');
  if (error) throw error;
  return data ?? null;
}

export async function getSubscriberClaims(id) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) return [];
    return applyMutations(sub).claims || [];
  }
  if (!id) return [];
  const rows = unwrap(
    await supabase
      .from('claims')
      .select('*')
      .eq('subscriber_id', id)
      .order('submitted_date', { ascending: false }),
  );
  return (rows ?? []).map(mapClaimRow);
}

export async function getSubscriberWithdrawals(id) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) return [];
    return applyMutations(sub).withdrawals || [];
  }
  if (!id) return [];
  const rows = unwrap(
    await supabase
      .from('withdrawals')
      .select('*')
      .eq('subscriber_id', id)
      .order('date', { ascending: false }),
  );
  return (rows ?? []).map(mapWithdrawalRow);
}

/**
 * Returns nominees split by type — `{ pension: [...], insurance: [...] }` —
 * matching the legacy mock shape so callers don't have to filter inline.
 */
export async function getSubscriberNominees(id) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) return { pension: [], insurance: [] };
    return applyMutations(sub).nominees;
  }
  if (!id) return { pension: [], insurance: [] };
  const rows = unwrap(
    await supabase
      .from('nominees')
      .select('*')
      .eq('subscriber_id', id)
      .order('created_at', { ascending: true }),
  ) ?? [];
  const pension = [];
  const insurance = [];
  for (const r of rows) {
    const mapped = mapNomineeRow(r);
    if (r.type === 'insurance') insurance.push(mapped);
    else pension.push(mapped);
  }
  return { pension, insurance };
}

/**
 * Subscriber → assigned agent + branch name. The subscriber's RLS policy
 * allows reading their own agents row (the platform owner's read policy on
 * `agents` is keyed on `agents.id = subscribers.agent_id` for the caller's
 * subscriber); the branch join hops through `agents.branch_id → branches`.
 */
export async function getSubscriberAgent(subscriberId) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[subscriberId];
    if (!sub) return null;
    const agent = AGENTS[sub.parentId];
    if (!agent) return null;
    const branch = BRANCHES[agent.parentId];
    return {
      ...agent,
      branchName: branch?.name ?? '—',
    };
  }
  if (!subscriberId) return null;
  // Single-query embed: subscribers.agent_id → agents.id is a real FK
  // (0001_initial_schema.sql: `agent_id TEXT REFERENCES agents(id)`), so
  // PostgREST resolves agents as an embedded resource, and agents.branch_id →
  // branches gives the nested branch name. RLS is applied per embedded table
  // exactly as in the prior two-step (the subscriber's policies already allowed
  // reading their own agent + branch rows), so this collapses the round-trips
  // without changing what's visible. A plain (non-inner) embed is used so a
  // null/dangling agent_id still returns the subscriber row; the null-agent
  // guard below preserves the prior "no agent → null" behaviour.
  const row = unwrap(
    await supabase
      .from('subscribers')
      .select('agent_id, agents(*, branches(name))')
      .eq('id', subscriberId)
      .maybeSingle(),
  );
  if (!row?.agent_id) return null;
  // PostgREST returns the embedded agent as an object (or array for some
  // relationship shapes); normalise before mapping.
  const agent = Array.isArray(row.agents) ? row.agents[0] : row.agents;
  if (!agent) return null;
  return mapAgentRow(agent);
}

// =============================================================================
// Writes — Supabase triggers update subscriber_balances / commissions denorms
// =============================================================================

/**
 * Records an ad-hoc contribution. The live path calls the `make_contribution`
 * SECURITY DEFINER RPC (0054), which inserts the `transactions` row inside the
 * function body; the AFTER INSERT trigger updates `subscriber_balances` and (on
 * the first contribution) writes the commission row. The RPC is idempotent on
 * `nonce` — a replay with the same nonce returns the original row WITHOUT
 * double-crediting (audit §4a F-1). Returns the transaction in the legacy mock
 * shape.
 *
 * `nonce` is a stable, per-confirm-sheet idempotency key minted by the page
 * (SavePage) when the confirm sheet opens; it survives a double-tap / manual
 * retry. If a caller omits it, a fresh UUID is minted so the RPC always has a
 * key (no idempotency across separate calls in that case — same as before).
 *
 * @param {string} id - subscriber ID
 * @param {{amount:number, retirementPct?:number, method?:string, nonce?:string}} payload
 */
export async function makeAdHocContribution(
  id,
  { amount, retirementPct = 80, method = 'MTN Mobile Money', nonce } = {},
) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');
    const m = readSession(id);
    const retAmt = Math.round(amount * (retirementPct / 100));
    const emgAmt = amount - retAmt;
    const dateStr = todayIso();
    const tx = {
      id: `tx-${id}-adhoc-${Date.now()}`,
      type: 'contribution',
      amount,
      date: dateStr,
      status: 'settled',
      method,
      reference: `CT-${Math.floor(Math.random() * 900000) + 100000}`,
      // Member-initiated, so never a payroll-run leg. Stated explicitly (rather
      // than left undefined) so the offline rows carry the same field set as
      // mapTransactionRow's — surfaces that word a row by `contributionRunId` must
      // behave identically in demo mode.
      contributionRunId: null,
    };
    m.extraTransactions.unshift(tx);
    m.balanceDelta.retirement += retAmt;
    m.balanceDelta.emergency += emgAmt;
    m.balanceDelta.total += amount;
    return tx;
  }

  if (!id) throw new Error('Subscriber id required');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be positive');
  }
  // Idempotent + atomic write via the 0054 DEFINER RPC. The subscriber is
  // derived server-side from the JWT subscriberId claim — `id` is no longer the
  // authority for WHO is credited (RLS/DEFINER trust the token, not the arg).
  const { data, error } = await supabase.rpc('make_contribution', {
    p_nonce: nonce ?? crypto.randomUUID(),
    p_amount: amount,
    p_retirement_pct: retirementPct,
    p_method: method,
  });
  if (error) throw error;
  // The RPC returns the inserted row already in the camelCase mock shape.
  return data;
}

/**
 * Submits a withdrawal. The live path calls the `request_withdrawal` SECURITY
 * DEFINER RPC (0054), which performs BOTH the `transactions` ledger insert (the
 * balance trigger debits subscriber_balances) AND the `withdrawals` history
 * insert in ONE atomic function body — closing the prior two-unwrapped-inserts
 * gap where a failed second insert left an orphaned debit (audit §4a F-2). The
 * RPC also enforces a server-side "withdraw ≤ available balance" check (F-5) and
 * decrements `units` (F-3), and is idempotent on `nonce` — a replay returns the
 * original withdrawal WITHOUT double-debiting (F-1). Returns the withdrawal
 * record in the legacy mock shape.
 *
 * `nonce` is a stable, per-confirm-sheet idempotency key minted by the page
 * (WithdrawPage) when the confirm sheet opens; it survives a double-tap / manual
 * retry. If a caller omits it, a fresh UUID is minted.
 *
 * Bucket semantics: if `bucket` is provided the RPC routes the whole amount to
 * that bucket; else the withdrawal trigger falls back to "emergency-first, then
 * retirement".
 */
export async function requestWithdrawal(
  id,
  { amount, bucket, reason, method = 'MTN Mobile Money', splitRetirement, splitEmergency, nonce } = {},
) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');
    const m = readSession(id);
    const dateStr = todayIso();
    const ref = `WD-${Math.floor(Math.random() * 900000) + 100000}`;
    const wd = {
      id: `wd-${id}-${Date.now()}`,
      amount,
      bucket,
      reason,
      method,
      status: 'processing',
      date: dateStr,
      reference: ref,
    };
    m.extraWithdrawals.unshift(wd);
    m.extraTransactions.unshift({
      id: `tx-${id}-wd-${Date.now()}`,
      type: 'withdrawal',
      amount: -amount,
      date: dateStr,
      status: 'processing',
      method,
      reference: ref,
      bucket,
      contributionRunId: null,   // member-initiated — never a payroll-run leg
    });
    if (bucket === 'retirement') {
      m.balanceDelta.retirement -= amount;
    } else {
      m.balanceDelta.emergency -= amount;
    }
    m.balanceDelta.total -= amount;
    return wd;
  }

  if (!id) throw new Error('Subscriber id required');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be positive');
  }

  // Idempotent + atomic write via the 0054 DEFINER RPC. The subscriber is
  // derived server-side from the JWT subscriberId claim. Explicit splits, if
  // supplied, are passed through and validated server-side (must sum to amount);
  // else the bucket routes the whole amount; else the trigger falls back.
  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_nonce: nonce ?? crypto.randomUUID(),
    p_amount: amount,
    p_bucket: bucket ?? null,
    p_reason: reason ?? null,
    p_method: method,
    p_split_retirement: splitRetirement ?? null,
    p_split_emergency: splitEmergency ?? null,
  });
  if (error) throw error;
  // The RPC returns the withdrawal row already in the camelCase mock shape.
  return data;
}

/**
 * File a HOSPITAL CASH claim (migration 0099 `submit_hospital_cash_claim`).
 *
 * Hospital cash is the only product a living member can claim — life and
 * funeral pay out after death and are claimed by a nominee through the public
 * intake form (`/claim`), never here.
 *
 * The caller does NOT send an amount. The RPC derives it from the member's own
 * policy (cover ÷ 20 per night) and caps it against the nights they have already
 * used this policy year, then records it. Before 0099 this was a direct client
 * `.insert()` under `claims_insert_self`, which meant a member could POST any
 * figure they liked and the 20-night cap was decorative; that policy is now
 * dropped and the RPC is the only writer. Idempotent on `nonce`.
 *
 * NOTE `payload.files` is still accepted and still goes nowhere — there is no
 * storage bucket and no documents column. The UI says so rather than implying
 * an upload happened. See BACKEND.md §14a.
 *
 * @param {string} id
 * @param {{ admissionDate: string, dischargeDate: string, provider?: string,
 *           description?: string, nonce?: string, files?: File[] }} payload
 */
export async function submitClaim(id, payload = {}) {
  const {
    admissionDate, dischargeDate, provider = '', description = '', nonce,
  } = payload;

  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');

    // Mirror the RPC's guards and maths so mock mode can't disagree with live.
    const merged = attachPolicies(applyMutations(sub));
    const policy = (merged.policies || [])
      .find((p) => p.type === 'health' && p.status === 'active' && p.cover > 0);
    if (!policy) throw new Error('no active hospital cash cover');

    const quote = hospitalCashQuote({
      policy,
      admission: admissionDate,
      discharge: dischargeDate,
      claims: merged.claims || [],
      now: currentTime(),
    });
    if (quote.nights < 1) {
      throw new Error('hospital cash pays per night — discharge must be after admission');
    }
    if (quote.payableNights < 1) {
      throw new Error(`the ${HOSPITAL_CASH_DAYS} covered nights for this policy year are already used up`);
    }

    const m = readSession(id);
    const claim = {
      id: `clm-${id}-${Date.now()}`,
      subscriberId: id,
      type: 'health',
      product: 'health',
      status: 'submitted',
      amount: quote.payout,
      incidentDate: admissionDate,
      dischargeDate,
      nights: quote.payableNights,
      provider: provider.trim() || null,
      dailyBenefit: quote.dailyRate,
      submittedDate: todayIso(),
      description,
    };
    m.extraClaims.unshift(claim);
    return claim;
  }

  if (!id) throw new Error('Subscriber id required');
  const { data, error } = await supabase.rpc('submit_hospital_cash_claim', {
    p_nonce: nonce ?? crypto.randomUUID(),
    p_admission_date: admissionDate,
    p_discharge_date: dischargeDate,
    p_provider: provider,
    p_description: description,
  });
  if (error) throw error;
  // The RPC already returns the camelCase mapClaimRow shape (same contract as
  // request_withdrawal), so there is nothing to re-map.
  return data;
}

/**
 * UPSERT into contribution_schedules. The frontend may send any subset of
 * `{frequency, amount, retirementPct, emergencyPct, includeInsurance,
 *  insuranceChoiceMade, nextDueDate}` — frequency is always normalised first.
 */
export async function updateContributionSchedule(id, schedule = {}) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');
    const m = readSession(id);
    m.scheduleOverride = {
      ...sub.contributionSchedule,
      ...schedule,
      frequency: normalizeFrequency(schedule.frequency ?? sub.contributionSchedule?.frequency),
    };
    return m.scheduleOverride;
  }

  if (!id) throw new Error('Subscriber id required');
  const patch = {};
  if (schedule.frequency !== undefined) {
    patch.frequency = normalizeFrequency(schedule.frequency);
  }
  if (schedule.amount !== undefined) patch.amount = Number(schedule.amount);
  if (schedule.retirementPct !== undefined) patch.retirement_pct = Number(schedule.retirementPct);
  if (schedule.emergencyPct !== undefined) patch.emergency_pct = Number(schedule.emergencyPct);
  if (schedule.includeInsurance !== undefined) patch.include_insurance = !!schedule.includeInsurance;
  if (schedule.insuranceChoiceMade !== undefined) patch.insurance_choice_made = !!schedule.insuranceChoiceMade;
  // `insuranceTypes` (the multi-product selection) has no DB column — the source
  // of truth for held products is the insurance_policies rows. When it's sent we
  // still derive include_insurance + mark the choice made, then echo it back so
  // the caller's settle flow can diff added products.
  if (schedule.insuranceTypes !== undefined) {
    patch.include_insurance = schedule.insuranceTypes.length > 0;
    patch.insurance_choice_made = true;
  }
  if (schedule.nextDueDate !== undefined) patch.next_due_date = schedule.nextDueDate;
  // Yearly step-up (0072). Editable post-signup — intentionally LEFT OUT of the
  // 0072 column REVOKE (unlike the funding-mode/target columns), so a plain PATCH
  // persists it. The contribution trigger reads it to bump the amount annually.
  if (schedule.contributionIndexationPct !== undefined) {
    patch.contribution_indexation_pct = Number(schedule.contributionIndexationPct);
  }
  patch.updated_at = new Date().toISOString();

  const row = unwrap(
    await supabase
      .from('contribution_schedules')
      .update(patch)
      .eq('subscriber_id', id)
      .select()
      .single(),
  );
  return {
    frequency: normalizeFrequency(row.frequency),
    amount: Number(row.amount),
    retirementPct: Number(row.retirement_pct),
    emergencyPct: Number(row.emergency_pct),
    includeInsurance: !!row.include_insurance,
    insuranceChoiceMade: !!row.insurance_choice_made,
    insuranceTypes: schedule.insuranceTypes,
    nextDueDate: row.next_due_date,
    contributionIndexationPct: Number(row.contribution_indexation_pct ?? 0),
  };
}

/**
 * Replaces the subscriber's nominees. Approach: DELETE everything for the
 * subscriber then INSERT the new rows. The nominees table's RLS policy lets
 * a subscriber DELETE/INSERT their own rows. Runs each step sequentially —
 * a failure on INSERT leaves the table empty (caller should handle).
 *
 * Payload: `{ pension: [...], insurance: [...] }`. Each nominee row needs
 * `name`, `relationship`, `share`, optionally `phone`, `nin`.
 */
export async function updateNominees(id, { pension, insurance } = {}) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');
    const m = readSession(id);
    m.nomineesOverride = {
      pension: pension ?? sub.nominees.pension,
      insurance: insurance ?? sub.nominees.insurance,
    };
    return m.nomineesOverride;
  }

  if (!id) throw new Error('Subscriber id required');

  // PR-5 fix (AUDIT-2-3 + AUDIT-4-6): route through SECURITY DEFINER RPC
  // that DELETE+INSERTs in one transaction AND enforces the sum-to-100
  // invariant per category. Previously this was a direct .delete + .insert
  // pair from the client, violating CLAUDE.md §5.6 ("don't write raw SQL from
  // the frontend — every database write goes through a SECURITY DEFINER RPC")
  // and silently allowing nominee shares to drift away from 100%.
  const result = unwrap(
    await supabase.rpc('upsert_nominees', {
      p_subscriber_id: id,
      p_pension: (pension ?? []).map((n) => ({
        id: n.id ?? null,
        name: n.name,
        phone: n.phone ?? null,
        relationship: n.relationship ?? null,
        nin: n.nin ?? null,
        share: Number(n.share ?? 0),
      })),
      p_insurance: (insurance ?? []).map((n) => ({
        id: n.id ?? null,
        name: n.name,
        phone: n.phone ?? null,
        relationship: n.relationship ?? null,
        nin: n.nin ?? null,
        share: Number(n.share ?? 0),
      })),
    }),
  );

  // RPC returns { pension: [...], insurance: [...] } already in the canonical
  // shape the UI consumes. Fall back to re-read if the result is unexpectedly
  // null (shouldn't happen — RPC always returns jsonb).
  if (result && typeof result === 'object' && ('pension' in result || 'insurance' in result)) {
    return result;
  }
  return getSubscriberNominees(id);
}

/** Products a subscriber can hold. Life lives in its own table (see below). */
const INSURANCE_PRODUCT_IDS = ['life', 'health', 'funeral'];

/**
 * Set a subscriber's cover for ONE product, WITHOUT taking a payment.
 *
 * This is the DOWNGRADE path. Lowering cover is free — the reduced premium
 * applies from the next renewal — so it writes directly rather than going
 * through a money RPC. UPGRADES must go through `fundInsuranceProducts`, which
 * actually charges the annual premium.
 *
 * Routing mirrors the storage split introduced by migration 0064:
 *   - life            → `insurance_policies` (subscriber_id PK). UPSERT, because
 *     a member who declined at signup has no row yet.
 *   - health/funeral  → `subscriber_insurance_products` ((subscriber_id, product)
 *     PK). UPDATE only — deliberately not an upsert: a product the member does
 *     not hold cannot be "downgraded", and creating one here would hand out free
 *     cover that no premium was ever charged for.
 *
 * Both are plain client writes gated by the subscriber's own `*_self` RLS
 * (0003/0007 for life, `sip_update_self` in 0064 for the rest) — the same lane
 * `renewPolicy` already uses.
 *
 * @param {string} id
 * @param {{ product?: 'life'|'health'|'funeral', cover: number, premiumMonthly: number }} payload
 */
export async function updateInsuranceCover(id, { product = 'life', cover, premiumMonthly } = {}) {
  if (!INSURANCE_PRODUCT_IDS.includes(product)) {
    throw new Error(`Unknown insurance product: ${product}`);
  }
  const active = Number(cover ?? 0) > 0;
  const status = active ? 'active' : 'inactive';

  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');
    const m = readSession(id);
    if (product === 'life') {
      m.insuranceOverride = {
        ...(m.insuranceOverride ?? sub.insurance),
        cover,
        premiumMonthly,
        status,
      };
    }
    // Mirror EVERY product (life included) into the products override so the
    // derived `policies` array — and everything reading it, like the Policies
    // page and activeCoverTotal — sees the new cover, not just the legacy
    // single-life `insurance` object.
    const prior = m.insuranceProductsOverride.find((o) => o.product === product)
      ?? applyMutations(sub).insuranceProducts.find((p) => p.product === product)
      ?? {};
    m.insuranceProductsOverride = [
      ...m.insuranceProductsOverride.filter((o) => o.product !== product),
      {
        ...prior,
        product,
        cover: Number(cover ?? 0),
        premiumMonthly: Number(premiumMonthly ?? 0),
        status,
        policyStart: prior.policyStart ?? todayIso(),
        renewalDate: active ? renewalIsoFromNow(1) : prior.renewalDate,
      },
    ];
    // Selecting cover (re)activates the policy for a year — the policies page
    // derives active/expired from the renewal date, so push it forward.
    setRenewalOverride(id, product, active);
    return product === 'life'
      ? m.insuranceOverride
      : m.insuranceProductsOverride.find((o) => o.product === product);
  }

  if (!id) throw new Error('Subscriber id required');
  setRenewalOverride(id, product, active);
  const patch = {
    cover: Number(cover ?? 0),
    premium_monthly: Number(premiumMonthly ?? 0),
    status,
    updated_at: new Date().toISOString(),
  };

  const row = product === 'life'
    ? unwrap(
      await supabase
        .from('insurance_policies')
        .upsert({ subscriber_id: id, ...patch }, { onConflict: 'subscriber_id' })
        .select()
        .single(),
    )
    : unwrap(
      await supabase
        .from('subscriber_insurance_products')
        .update(patch)
        .eq('subscriber_id', id)
        .eq('product', product)
        .select()
        .single(),
    );

  return {
    product,
    cover: Number(row.cover),
    premiumMonthly: Number(row.premium_monthly),
    policyStart: row.policy_start,
    renewalDate: row.renewal_date,
    status: row.status,
  };
}

/**
 * Fund one or more insurance products post-signup, on the annual-premium model
 * (migration 0073 `fund_insurance_products`). Two routes, matching onboarding:
 *
 *   • `fundingMode: 'pay_now'`      — activate each product NOW (storing the true
 *     monthly premium) and charge the combined ANNUAL premium as ONE 'premium'
 *     transaction. Leaves the schedule's building state untouched.
 *   • `fundingMode: 'save_to_cover'` — create each product as 'building', put the
 *     schedule into save_to_cover, set the savings split, and let the DB recompute
 *     the target. Charges NOTHING now; the 0072 accrual trigger sweeps it later.
 *
 * `products` carries ONLY the newly-funded products — the caller de-dups cover
 * the subscriber already holds (active or building), so this never re-charges or
 * downgrades a held policy. Idempotent on `nonce`. 'premium' rows never fire the
 * contribution trigger, so balances/AUM are unaffected.
 *
 * @param {string} id
 * @param {{ fundingMode?:'pay_now'|'save_to_cover', products?:Array<{product,cover,premiumMonthly}>, savingsPct?:number, method?:string, nonce?:string }} payload
 */
export async function fundInsuranceProducts(
  id,
  { fundingMode = 'pay_now', products = [], savingsPct = 100, method = 'MTN Mobile Money', nonce } = {},
) {
  if (!id) throw new Error('Subscriber id required');
  if (!['pay_now', 'save_to_cover'].includes(fundingMode)) throw new Error('Unknown funding mode');
  const list = Array.isArray(products) ? products : [];
  for (const p of list) {
    if (!['health', 'funeral', 'life'].includes(p?.product)) throw new Error('Unknown insurance product');
  }
  const annualTotal = list.reduce((s, p) => s + (Number(p.premiumMonthly) || 0) * 12, 0);
  const status = fundingMode === 'save_to_cover' ? 'building' : 'active';

  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');
    const m = readSession(id);
    const entries = list.map((p) => ({
      product: p.product,
      cover: Number(p.cover ?? 0),
      premiumMonthly: Number(p.premiumMonthly ?? 0),
      policyStart: todayIso(),
      renewalDate: renewalIsoFromNow(1),
      status,
    }));
    const newIds = new Set(entries.map((e) => e.product));
    m.insuranceProductsOverride = [
      ...m.insuranceProductsOverride.filter((o) => !newIds.has(o.product)),
      ...entries,
    ];
    if (fundingMode === 'pay_now') {
      list.forEach((p) => setRenewalOverride(id, p.product, true));
      if (annualTotal > 0) {
        m.extraTransactions.unshift({
          id: `tx-${id}-prem-${Date.now()}`,
          type: 'premium',
          amount: annualTotal,
          date: todayIso(),
          status: 'settled',
          method,
          reference: `PR-${Math.floor(Math.random() * 900000) + 100000}`,
          contributionRunId: null,   // member-initiated — never a payroll-run leg
        });
      }
    } else {
      // save_to_cover: recompute the target from ALL non-active self products
      // (the just-added building rows are now in the merged view) + set the
      // schedule funding columns, mirroring the 0073 RPC.
      const merged = applyMutations(sub).insuranceProducts;
      const target = merged
        .filter((p) => p.status !== 'active' && (p.fundedBy ?? 'self') === 'self')
        .reduce((s, p) => s + (Number(p.premiumMonthly) || 0) * 12, 0);
      const base = m.scheduleOverride ?? sub.contributionSchedule ?? {};
      m.scheduleOverride = {
        ...base,
        insuranceFundingMode: 'save_to_cover',
        insurancePremiumTarget: target,
        insuranceSavingsPct: Math.max(0, Math.min(100, Number(savingsPct) || 100)),
      };
    }
    return { fundingMode, annualTotal, charged: fundingMode === 'pay_now' ? annualTotal : 0, status };
  }

  const { data, error } = await supabase.rpc('fund_insurance_products', {
    p_nonce: nonce ?? crypto.randomUUID(),
    p_funding_mode: fundingMode,
    p_products: list.map((p) => ({
      product: p.product,
      cover: Number(p.cover ?? 0),
      premiumMonthly: Number(p.premiumMonthly ?? 0),
    })),
    p_savings_pct: Number(savingsPct ?? 100),
    p_method: method,
  });
  if (error) throw error;
  return data;
}

/**
 * Renew a policy by recording a (demo) premium payment. Demo scope: there is no
 * real processor — paying flips the policy back to active for the session and
 * pushes its renewal date forward a year. The renewal is held as a session
 * override (health has no DB table, and even life renewal is demo-only), so it
 * behaves identically in mock and Supabase modes and resets on refresh.
 *
 * A 'premium'-type transaction is recorded for the activity / Insurance
 * Statement feed. 'premium' is excluded from balance math in applyMutations
 * (only 'contribution' rows count toward balances), so renewals never touch
 * savings balances.
 *
 * LIVE PATH: `fund_insurance_products` (0073), NOT a direct write. This used to
 * PATCH insurance_policies / subscriber_insurance_products and POST the
 * 'premium' row straight to /rest/v1/transactions. Migration 0118 closed that
 * door (finding A02-001: the `transactions_insert_self` policy constrained
 * subscriber_id but not amount, type or status, so any member could mint
 * themselves any balance). The RPC does the same three things the two direct
 * writes did — upsert the policy active, push renewal_date forward a year,
 * insert ONE 'premium' transaction — plus the things they could not: it derives
 * the charge server-side as premium × 12, refuses to touch employer-funded
 * cover, and is idempotent on `nonce` via money_nonces.
 *
 * @param {string} id
 * @param {{ type: 'life'|'health'|'funeral', method?: string, nonce?: string }} payload
 * @returns {Promise<{ policy: object, reference: string }>}
 */
export async function renewPolicy(id, { type, method = 'MTN Mobile Money', nonce } = {}) {
  if (!id) throw new Error('Subscriber id required');
  if (!['life', 'health', 'funeral'].includes(type)) throw new Error('Unknown policy type');

  const reference = `RN-${Math.floor(Math.random() * 900000) + 100000}`;
  // Flip the policy active for a year (read back below to get the amount paid).
  setRenewalOverride(id, type, true);

  // Resolve the renewed policy so we can charge the exact renewal amount.
  let sub;
  if (!IS_SUPABASE_ENABLED) {
    const base = SUBSCRIBERS[id];
    if (!base) throw new Error('Subscriber not found');
    sub = attachPolicies(applyMutations(base));
  } else {
    sub = await getCurrentSubscriber();
  }
  const policy = sub?.policies?.find((p) => p.type === type);
  if (!policy) throw new Error('Policy not found');
  const amount = policy.renewalAmount;

  const tx = {
    id: `tx-${id}-rn-${Date.now()}`,
    type: 'premium',
    amount,
    date: todayIso(),
    status: 'settled',
    method,
    reference,
    contributionRunId: null,   // member-initiated — never a payroll-run leg
  };

  if (!IS_SUPABASE_ENABLED) {
    readSession(id).extraTransactions.unshift(tx);
    return { policy, reference };
  }

  // Supabase: ONE atomic RPC does the whole renewal. `fund_insurance_products`
  // routes by product itself — life to insurance_policies (subscriber_id),
  // health/funeral to subscriber_insurance_products (subscriber_id, product),
  // migration 0064 — upserts it active with renewal_date = now + 1 year, and
  // inserts a single 'premium' transaction for premiumMonthly × 12, which is
  // exactly `policy.renewalAmount`. 'premium' rows never fire the contribution
  // trigger, so balances and AUM are unaffected, same as before.
  //
  // Side effect worth knowing: the RPC also stamps policy_start to today. For a
  // renewal that is right — the new annual term starts now and ends on the
  // renewal date it just set.
  //
  // The result is CHECKED, not swallowed. The two direct writes this replaced
  // sat in try/catch blocks that could never fire (the PostgREST client returns
  // { error }, it does not throw), so a rejected renewal used to look like a
  // success until the member refreshed and found the policy still expired.
  const { data, error } = await supabase.rpc('fund_insurance_products', {
    p_nonce: nonce ?? crypto.randomUUID(),
    p_funding_mode: 'pay_now',
    p_products: [{
      product: type,
      cover: Number(policy.cover ?? 0),
      premiumMonthly: Number(policy.premiumMonthly ?? 0),
    }],
    p_savings_pct: 100,
    p_method: method,
  });
  if (error) {
    // The optimistic session override was set before we knew whether the charge
    // would land. Roll it back so the policy does not read as renewed on a
    // failure, then let the caller surface the error toast.
    setRenewalOverride(id, type, false);
    throw error;
  }

  // Prefer the reference the RPC actually stamped on the transaction row, so the
  // member's receipt matches their activity feed. Falls back to the locally
  // minted RN- reference (the shape the mock path uses).
  return { policy, reference: data?.reference ?? reference };
}

/**
 * Filters the patch to RLS-allowed columns (per 0006 trigger:
 *   name, email, phone, occupation, consent_at)
 * before UPDATEing. Anything else is silently dropped so the trigger never
 * needs to reject the write.
 */
export async function updateProfile(id, updates = {}) {
  if (!IS_SUPABASE_ENABLED) {
    const sub = SUBSCRIBERS[id];
    if (!sub) throw new Error('Subscriber not found');
    const m = readSession(id);
    m.profileOverride = { ...(m.profileOverride ?? {}), ...updates };
    return m.profileOverride;
  }

  if (!id) throw new Error('Subscriber id required');
  const patch = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.email !== undefined) patch.email = updates.email;
  if (updates.phone !== undefined) patch.phone = updates.phone;
  if (updates.occupation !== undefined) patch.occupation = updates.occupation;
  if (updates.consentAt !== undefined) patch.consent_at = updates.consentAt;
  if (Object.keys(patch).length === 0) {
    // Nothing to write — short-circuit to a fresh read so the caller still
    // gets a sensible object back.
    const fresh = unwrap(
      await supabase.from('subscribers').select('*').eq('id', id).maybeSingle(),
    );
    return mapSubscriberRow(fresh);
  }

  const row = unwrap(
    await supabase
      .from('subscribers')
      .update(patch)
      .eq('id', id)
      .select('*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), subscriber_insurance_products(*)')
      .single(),
  );
  return mapSubscriberRow(row);
}

// =============================================================================
// Atomic-write RPCs
// =============================================================================

/**
 * Calls `create_subscriber_from_signup` — the SECURITY DEFINER RPC that
 * validates the payload, inserts the 5-table subscriber chain, and returns
 * the new subscriber ID. Used by the post-signup `/signup/contribution`
 * flow (Agent 13 wires the caller).
 *
 * @param {object} payload - SignupContext snapshot. See plan §"Signup → real
 *   subscriber persistence" for the exact field list.
 * @param {string} [nonce] - Per-attempt idempotency key (0042 `p_nonce`). A
 *   replay with the same nonce returns the original subscriber id instead of
 *   minting a duplicate chain. Stable across retries/reloads of one signup
 *   attempt (see SignupContext.signupNonce).
 * @returns {Promise<{subscriberId: string}>}
 */
export async function createFromSignup(payload, nonce) {
  if (!IS_SUPABASE_ENABLED) {
    // Mock fallback: synthesise a fake subscriber ID so callers can pretend
    // the write succeeded. We don't actually insert anything into the mock.
    const id = `s-mock-${Date.now()}`;
    return { subscriberId: id };
  }
  const { data, error } = await supabase.rpc('create_subscriber_from_signup', {
    payload,
    p_nonce: nonce ?? null,
  });
  if (error) throw error;
  return { subscriberId: data };
}

/**
 * Fetch a pending employer invite by token (anon — the invitee is pre-login).
 * @returns {Promise<{ employerId, employerName, prefill, collectSchedule }>}
 */
export async function getEmployerInvite(token) {
  if (!IS_SUPABASE_ENABLED) {
    return { employerId: 'emp-001', employerName: 'Nile Breweries Demo Ltd', prefill: {}, collectSchedule: false };
  }
  const { data, error } = await supabase.rpc('get_employer_invite', { p_token: token });
  if (error) throw error;
  return data;
}

/**
 * Complete an employer invite after KYC — creates a subscriber tagged to the
 * employer (agent_id NULL ⇒ no commission). The payload's contributionSchedule
 * carries only the retirement/emergency split, never an amount: since 0092 the
 * employer's two-leg config sets BOTH what comes out of the member's pay and what
 * the company adds, so the member has no amount to choose. The RPC writes
 * `contribution_schedules.amount = 0` and makes NO first contribution — the
 * employer's next contribution run is what funds them.
 * @returns {Promise<{ subscriberId: string }>}
 */
export async function createFromEmployerInvite(payload, token, nonce) {
  if (!IS_SUPABASE_ENABLED) {
    return { subscriberId: `s-mock-inv-${Date.now()}` };
  }
  const { data, error } = await supabase.rpc('create_subscriber_from_employer_invite', {
    payload,
    p_token: token,
    p_nonce: nonce ?? null,
  });
  if (error) throw error;
  return { subscriberId: data };
}

/**
 * Calls `create_subscriber_from_agent_onboard` — same shape as
 * `createFromSignup` but validates `calling_agent_id === auth.jwt() ->> 'agentId'`.
 *
 * @param {object} payload - SignupContext snapshot.
 * @param {string} agentId - The agent's authenticated agent_id.
 * @param {string} [nonce] - Per-attempt idempotency key (0042 `p_nonce`); see
 *   createFromSignup. Distinct per onboarded subscriber (reset() mints a fresh
 *   one), stable across retries of the same one.
 * @returns {Promise<{subscriberId: string}>}
 */
export async function createFromAgentOnboard(payload, agentId, nonce) {
  if (!IS_SUPABASE_ENABLED) {
    const id = `s-mock-${Date.now()}`;
    return { subscriberId: id };
  }
  const { data, error } = await supabase.rpc('create_subscriber_from_agent_onboard', {
    payload,
    calling_agent_id: agentId,
    p_nonce: nonce ?? null,
  });
  if (error) throw error;
  return { subscriberId: data };
}

// =============================================================================
// Cache invalidation hook (legacy export)
// =============================================================================

/**
 * @deprecated React Query caches are invalidated by the hooks in
 *   `src/hooks/useSubscriber.js` (`useInvalidateSubscriber`). This export is
 *   retained for API stability — it's now a no-op.
 */
export function invalidateSubscriber() {
  // Intentional no-op. React Query hooks in `src/hooks/useSubscriber.js`
  // (`useInvalidateSubscriber`) now drive every cache invalidation; this
  // export survives only so older callers don't break.
  return undefined;
}
