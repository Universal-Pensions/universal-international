// Per-signal copy and column config for the admin Needs-attention drill-downs.
//
// One table renders all eight drillable signals (get_admin_attention_rows returns
// a uniform row shape), so everything that differs between them lives here —
// titles, lead copy, which columns to show, and the notification draft. Mirrors
// the META map in src/branch-dashboard/desktop/AttentionAgentsDesktop.jsx:16-35,
// widened for admin.
//
// The two signals that keep their existing purpose-built panel — access requests
// and complaints — are deliberately absent: they never reach this page.

import { ATTENTION_TYPES } from '../overview/adminAttentionDerive';

/** Column ids the generic table knows how to render. */
export const COLUMN = Object.freeze({
  PRIMARY: 'primary',      // who / what — always shown, always first
  AMOUNT: 'amount',
  DATE: 'date',
  DUE_BY: 'dueBy',
  DAYS_LATE: 'daysLate',
  COUNT: 'count',
  STATUS: 'status',
});

/**
 * @typedef {Object} AttentionMeta
 * @property {string} title      Page heading.
 * @property {string} lead       One sentence: what this is and what to do.
 * @property {string} tileLabel  Label on the headline metric tile.
 * @property {string} tileSub    Sub-label on the headline metric tile.
 * @property {string} primaryHead Column heading for the `primary` field.
 * @property {string[]} columns  Which optional columns to render, in order.
 * @property {string} empty      Copy for the all-clear state.
 * @property {string} notifyVerb Button label — "Nudge" for a person, "Escalate"
 *                               for an internal queue.
 * @property {(row: Object) => string} draft  Prefilled notification body.
 * @property {(row: Object) => string} subject Notification title.
 * @property {boolean} [resolvable] Opt in to the Resolve action. Absent on every
 *   signal that can only be cleared by doing the real work — which is all of
 *   them but NAV. A signal opting in must also join the RESOLVERS registry in
 *   hooks/useAdminAttention.js; without both it cannot be resolved.
 * @property {string} [resolveVerb] Button label for the resolve action.
 * @property {(row: Object) => string} [resolveTitle] Confirm-dialog heading.
 * @property {(row: Object) => string} [resolveBody]  Confirm-dialog explanation.
 *   Must say plainly what resolving does NOT do, so nobody reads it as a fix.
 */

const days = (row) => {
  const n = Number(row?.daysLate);
  if (!Number.isFinite(n) || n <= 0) return 'now due';
  return `${n} day${n === 1 ? '' : 's'} past due`;
};

const money = (row) => {
  const n = Number(row?.amount);
  return Number.isFinite(n) ? `UGX ${n.toLocaleString('en-UG')}` : 'the amount';
};

/** @type {Object<string, AttentionMeta>} */
export const ATTENTION_META = Object.freeze({
  [ATTENTION_TYPES.DORMANT]: {
    title: 'Dormant subscribers',
    lead: 'Members who are enrolled but not currently contributing, grouped by the agent who owns them. Nudge an agent to re-engage their book.',
    tileLabel: 'Dormant members',
    tileSub: 'Enrolled but not contributing',
    primaryHead: 'Agent',
    columns: [COLUMN.COUNT, COLUMN.STATUS],
    empty: 'All clear — every agent’s book is contributing.',
    notifyVerb: 'Nudge',
    subject: () => 'Dormant members on your book',
    draft: (row) => `Hi ${String(row.primary || '').split(' ')[0]}, ${row.count} member${row.count === 1 ? '' : 's'} on your book ${row.count === 1 ? 'is' : 'are'} no longer contributing. Please reach out this week and help ${row.count === 1 ? 'them' : 'them'} restart.`,
  },

  [ATTENTION_TYPES.EMPLOYER_TRANSFERS]: {
    title: 'Delayed employer transfers',
    lead: 'Employers that have not posted a contribution run within their payroll cadence. Notify the payroll contact to submit the outstanding run.',
    tileLabel: 'Employers overdue',
    tileSub: 'Past their payroll cadence',
    primaryHead: 'Employer',
    columns: [COLUMN.DATE, COLUMN.DUE_BY, COLUMN.DAYS_LATE],
    empty: 'All clear — every employer is current on its payroll cadence.',
    notifyVerb: 'Notify',
    subject: () => 'Contribution run overdue',
    draft: (row) => `Your latest staff contribution run is ${days(row)}. Please submit it so your team's pension balances stay up to date.`,
  },

  [ATTENTION_TYPES.NAV]: {
    title: 'Delayed NAV updation',
    lead: 'Valuation days with no signed-off unit price. Escalate to fund administration so the register can be brought current.',
    tileLabel: 'Unsigned valuation days',
    tileSub: 'No published NAV',
    primaryHead: 'Valuation date',
    columns: [COLUMN.AMOUNT, COLUMN.DAYS_LATE, COLUMN.STATUS],
    empty: 'All clear — every valuation day is signed off.',
    notifyVerb: 'Escalate',
    resolvable: true,
    resolveVerb: 'Resolve',
    resolveTitle: (row) => `Mark ${row.primary} as resolved?`,
    resolveBody: (row) => `This stops ${row.primary} showing under Needs attention. It does not set a price — the day stays unpriced on the Unit price page. The date and who resolved it are kept, and this cannot be undone.`,
    subject: () => 'NAV not published',
    draft: (row) => `The unit price for ${row.primary} has not been published — ${days(row)}. Please confirm the fund administrator feed and sign off the valuation.`,
  },

  [ATTENTION_TYPES.DISTRIBUTORS]: {
    title: 'Underperforming distributors',
    lead: 'Distributors below the platform’s active-member threshold, holding branches with no members, or deactivated. Notify the network manager.',
    tileLabel: 'Distributors flagged',
    tileSub: 'Below threshold or deactivated',
    primaryHead: 'Distributor',
    columns: [COLUMN.AMOUNT, COLUMN.STATUS],
    empty: 'All clear — every distributor is above the performance threshold.',
    notifyVerb: 'Notify',
    subject: () => 'Network performance review',
    draft: (row) => `Your network is flagged for review: ${row.secondary}. Please share a plan for activating members in the next cycle.`,
  },

  [ATTENTION_TYPES.INSURANCE_PAYOUTS]: {
    title: 'Delayed insurance payouts',
    lead: 'Claims past their decision SLA and not yet paid or rejected. Escalate to the claims desk to clear the backlog.',
    tileLabel: 'Claims past SLA',
    tileSub: 'Awaiting a decision or payment',
    primaryHead: 'Claimant',
    columns: [COLUMN.AMOUNT, COLUMN.DATE, COLUMN.DUE_BY, COLUMN.DAYS_LATE, COLUMN.STATUS],
    empty: 'All clear — no claim is past its decision SLA.',
    notifyVerb: 'Escalate',
    subject: () => 'Claim past decision SLA',
    draft: (row) => `${row.primary}'s claim for ${money(row)} is ${days(row)} (${row.secondary}). Please adjudicate or release payment.`,
  },

  [ATTENTION_TYPES.WITHDRAWALS]: {
    title: 'Delayed withdrawal payouts',
    lead: 'Withdrawal requests still processing past their payout SLA, across both buckets. Escalate to treasury to release the payments.',
    tileLabel: 'Payouts past SLA',
    tileSub: 'Still processing',
    primaryHead: 'Member',
    columns: [COLUMN.AMOUNT, COLUMN.DATE, COLUMN.DUE_BY, COLUMN.DAYS_LATE],
    empty: 'All clear — every withdrawal is within its payout SLA.',
    notifyVerb: 'Escalate',
    subject: () => 'Withdrawal payout past SLA',
    draft: (row) => `${row.primary}'s ${money(row)} withdrawal is ${days(row)} (${row.secondary}). Please release the payment.`,
  },

  /* No per-bucket entries. Retirement and emergency payouts are not separate
     signals — the withdrawals table above names each row's bucket in `secondary`,
     which is the same answer a bucket-filtered page would give one click later.
     get_admin_attention_rows (0097) still accepts the two bucket p_types, so
     re-adding a filtered view here needs no server change. */

  [ATTENTION_TYPES.CUSTODY]: {
    title: 'Delayed transfers to custody bank',
    lead: 'Collected contributions not yet settled to the custodian, or returned by the bank. Escalate to treasury to complete the transfer.',
    tileLabel: 'Batches outstanding',
    tileSub: 'Past their settlement date',
    primaryHead: 'Batch',
    columns: [COLUMN.AMOUNT, COLUMN.DUE_BY, COLUMN.DAYS_LATE, COLUMN.STATUS],
    empty: 'All clear — every collection batch has settled to the custodian.',
    notifyVerb: 'Escalate',
    subject: () => 'Custody transfer outstanding',
    draft: (row) => `${row.primary} (${money(row)}) has not settled to the custodian — ${days(row)}. ${row.secondary}. Please action the transfer.`,
  },

  [ATTENTION_TYPES.RECONCILIATION]: {
    title: 'Reconciliation issues',
    lead: 'Member and transaction records that no longer agree with each other. Escalate to finance to investigate and correct.',
    tileLabel: 'Open exceptions',
    tileSub: 'Member and transaction records',
    primaryHead: 'Record',
    columns: [COLUMN.AMOUNT, COLUMN.DATE, COLUMN.STATUS],
    empty: 'All clear — no reconciliation exceptions outstanding.',
    notifyVerb: 'Escalate',
    subject: () => 'Reconciliation exception',
    draft: (row) => `A reconciliation exception is open against ${row.primary}: ${row.secondary}. Please investigate and correct the record.`,
  },
});

/** @param {string} type @returns {AttentionMeta|undefined} */
export const metaFor = (type) => ATTENTION_META[type];
