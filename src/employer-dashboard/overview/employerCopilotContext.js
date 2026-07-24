/**
 * employerCopilotContext.js — shared funder-metric derivation + copilot-context
 * builder for the employer dashboard.
 *
 * Extracted verbatim from EmployerHealthScore.jsx so BOTH surfaces that talk to
 * the employer copilot use identical logic with zero drift:
 *   - the mobile Overview hero (EmployerHealthScore)
 *   - the desktop Ask-AI panel (EmployerCopilotPanel)
 *
 * The output of buildEmployerCopilotContext is fed straight to
 * getEmployerChatResponse(message, ctx) (src/services/chat.js) — its `ctx` JSDoc
 * documents this exact shape.
 */

import { formatUGX } from '../../utils/currency';
import { groupInsuranceProducts } from '../../utils/groupInsurance';
import { companyFundingLabel } from '../employees/fundingLabel';

/** A member "contributes" if they have a non-zero monthly compensation — the v2
 *  run driver. Compensation > 0 means a run will fund them (employee and/or
 *  employer leg), so they count toward participation. */
function contributesSomething(emp) {
  return Number(emp?.compensation ?? 0) > 0;
}

/**
 * Funder-lens derived metrics. `participationRate` is measured against the
 * ACTIVE staff base (not total headcount) so an inactive roster doesn't read as
 * low participation. Guarded against divide-by-zero.
 *
 * @param {object} metrics  - useEmployerMetrics() result
 * @param {Array}  employees - useEmployees() result
 * @returns {{ headcount:number, active:number, avgContribution:number, participationRate:number }}
 */
export function deriveEmployerMetrics(metrics = {}, employees = []) {
  const headcount = metrics.headcount || employees.length || 0;
  const active = metrics.active || 0;
  const totalContributions = metrics.totalContributions || 0;
  const avgContribution = headcount > 0 ? totalContributions / headcount : 0;

  const contributing = employees.filter(
    (e) => e.status === 'active' && contributesSomething(e),
  ).length;
  const participationRate = active > 0 ? (contributing / active) * 100 : 0;

  return { headcount, active, avgContribution, participationRate };
}

/**
 * Build the copilot answer context — the employer's OWN figures, so every reply
 * is truthful (no distributor-network noise; "Who is pending KYC?" resolves
 * against the real pending-invite list).
 *
 * @param {object} args
 * @param {object} args.employer       - useEmployer() result
 * @param {object} args.derived        - deriveEmployerMetrics() result
 * @param {object} args.metrics        - useEmployerMetrics() result
 * @param {number} args.pendingKyc     - pendingInvites.length
 * @param {Array}  args.pendingInvites - usePendingInvites() result
 * @param {Array}  args.runs           - useContributionRuns() result (newest-first)
 */
export function buildEmployerCopilotContext({
  employer,
  derived,
  metrics = {},
  pendingKyc = 0,
  pendingInvites = [],
  runs = [],
}) {
  const cfg = employer?.defaultContributionConfig;
  // Multi-product group cover (Life / Health / Funeral): total per-member cover
  // across ALL enabled products, not just the legacy life-only groupCoverAmount,
  // so the copilot's "Do we have group insurance?" answer is truthful.
  const coverSum = groupInsuranceProducts(cfg).reduce((s, p) => s + p.cover, 0);
  return {
    headcount: derived.headcount,
    active: derived.active,
    inactive: metrics.suspended || 0,
    participationPct: Math.round(derived.participationRate),
    pendingKyc,
    pendingNames: pendingInvites.map((inv) => inv.prefill?.fullName).filter(Boolean),
    fundingLabel: companyFundingLabel(cfg),
    coverLabel: coverSum > 0 ? formatUGX(coverSum, { compact: false }) : 'no group cover',
    totalContributions: metrics.totalContributions || 0,
    lastRunLabel: runs[0]?.periodLabel || null,
  };
}

// Suggestion chips for the desktop Ask-AI panel — each maps to a keyword branch
// in mockEmployerChatResponse (src/services/chat.js) so the demo always answers.
export const EMPLOYER_COPILOT_SUGGESTIONS = [
  'Who is pending KYC?',
  "What's our funding split?",
  'How many staff are contributing?',
  'Show our last contribution run',
  'Do we have group insurance?',
];
