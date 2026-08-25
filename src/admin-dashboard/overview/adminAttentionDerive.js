// Pure derivation for the admin "Needs attention" card.
//
// Plays the same role for admin that branchOverviewDerive.computeAttention plays
// for branch: one module, imported by BOTH the desktop overview and the mobile
// home, so the two surfaces can never drift on what a row says or how severe it
// is. No React, no services, no imports beyond this file's own constants —
// everything arrives as arguments so the whole thing is trivially testable.
//
// TWO HARD RULES, both learned from measuring the live database:
//
//   1. NO DATE MATHS HERE. The server owns the clock. There used to be three
//      different "now"s in this codebase — public._demo_now() at 2026-05-18,
//      JS MOCK_NOW at 2026-05-26, and the real wall clock the live ledger
//      actually uses. Migration 0126 collapsed the first two: both now read
//      2026-07-01 (verified live 2026-08-25 — _demo_now() returns
//      2026-07-01 23:59:59+00, and src/constants/demoClock.js is the single JS
//      literal every consumer imports). So there are TWO now: the unified demo
//      clock and the wall clock. The rule is unchanged and still the point —
//      every "days late" number and every SLA in a sub-label comes from the RPC
//      payload (`thresholds`, `asOf`), never from arithmetic done here.
//
//   2. ALWAYS TEN ROWS. Zero-valued signals render as a green "Clear" pill
//      rather than disappearing, so the card is a fixed checklist the admin can
//      scan by position. Mirrors branch's always-three behaviour.

/** Signal ids. These double as the RPC's `p_type` and the mobile route param. */
export const ATTENTION_TYPES = Object.freeze({
  DORMANT: 'dormantSubscribers',
  EMPLOYER_TRANSFERS: 'delayedEmployerTransfers',
  NAV: 'delayedNav',
  COMPLAINTS: 'pendingComplaints',
  ACCESS_REQUESTS: 'pendingAccessRequests',
  DISTRIBUTORS: 'underperformingDistributors',
  INSURANCE_PAYOUTS: 'delayedInsurancePayouts',
  WITHDRAWALS: 'delayedWithdrawals',
  CUSTODY: 'delayedCustodyTransfers',
  RECONCILIATION: 'reconciliation',
});

export const SEVERITY = Object.freeze({ OK: 'ok', WARNING: 'warning', ALERT: 'alert' });

/**
 * Two of the ten do not use the generic drill-down page — they already have a
 * purpose-built surface with real actions behind it (approve/deny, ticket
 * threads), and rebuilding those as a read-only table would be a downgrade.
 */
export const REUSES_EXISTING_PANEL = Object.freeze({
  [ATTENTION_TYPES.ACCESS_REQUESTS]: 'access-requests',
  [ATTENTION_TYPES.COMPLAINTS]: 'tickets',
});

/** `alert` thresholds. Below these (but above zero) a signal is `warning`. */
const ALERT_AT = Object.freeze({
  [ATTENTION_TYPES.EMPLOYER_TRANSFERS]: 3,
  [ATTENTION_TYPES.NAV]: 3,
  [ATTENTION_TYPES.COMPLAINTS]: 8,
  [ATTENTION_TYPES.ACCESS_REQUESTS]: 5,
  [ATTENTION_TYPES.DISTRIBUTORS]: 2,
  [ATTENTION_TYPES.INSURANCE_PAYOUTS]: 10,
  [ATTENTION_TYPES.WITHDRAWALS]: 10,
  [ATTENTION_TYPES.CUSTODY]: 3,
  [ATTENTION_TYPES.RECONCILIATION]: 10,
});

/** Dormancy is a share of the book, not an absolute — 1,096 of 5,063 is normal. */
const DORMANT_ALERT_SHARE = 0.15;

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** ok at zero; alert past the type's threshold; warning otherwise. */
function severityFor(type, value) {
  const v = n(value);
  if (v <= 0) return SEVERITY.OK;
  const at = ALERT_AT[type];
  return at != null && v >= at ? SEVERITY.ALERT : SEVERITY.WARNING;
}

/**
 * Build the ten Needs-attention rows.
 *
 * @param {Object} [attention] `get_admin_attention()` payload (see
 *   services/adminAttention.js EMPTY_ATTENTION for the shape). Missing or
 *   partial input degrades to ten all-clear rows rather than throwing — the card
 *   renders during the first load and under the VITE_USE_SUPABASE=false rollback.
 * @param {Object} [complaints] Ticket counts, merged in separately because
 *   ticketing has no Supabase tables (in-memory store in services/tickets.js).
 * @param {number} [complaints.openComplaints]
 * @param {number} [complaints.urgentComplaints]
 * @returns {Array<{type:string,value:number,label:string,sub:string,severity:string,
 *   stakeholder:?string}>} Exactly ten items — one flat row per signal, no
 *   nesting — in the order the product spec lists them.
 */
export function computeAdminAttention(attention = {}, complaints = {}) {
  const a = attention ?? {};
  const th = a.thresholds ?? {};
  const wd = a.delayedWithdrawals ?? {};
  const rec = a.reconciliation ?? {};

  const openComplaints = n(complaints.openComplaints);
  const urgentComplaints = n(complaints.urgentComplaints);

  const dormant = n(a.dormantSubscribers);
  const totalSubs = n(a.totalSubscribers);
  // Share-based alert, with an absolute floor for the case where the total is
  // unknown (the RPC does not return it today, so this is the usual path).
  const dormantSeverity = dormant <= 0
    ? SEVERITY.OK
    : (totalSubs > 0 && dormant / totalSubs >= DORMANT_ALERT_SHARE) || dormant >= 500
      ? SEVERITY.ALERT
      : SEVERITY.WARNING;

  // Complaints escalate on urgency, not just volume — one urgent thread left
  // unanswered matters more than eight routine ones.
  const complaintsSeverity = openComplaints <= 0
    ? SEVERITY.OK
    : urgentComplaints > 0 || openComplaints >= ALERT_AT[ATTENTION_TYPES.COMPLAINTS]
      ? SEVERITY.ALERT
      : SEVERITY.WARNING;

  const wdTotal = n(wd.total);
  const wdSla = n(th.withdrawalSlaDays);

  return [
    {
      type: ATTENTION_TYPES.DORMANT,
      value: dormant,
      label: 'Dormant subscribers',
      sub: 'Enrolled but not currently contributing',
      severity: dormantSeverity,
      stakeholder: 'agent',
    },
    {
      type: ATTENTION_TYPES.EMPLOYER_TRANSFERS,
      value: n(a.delayedEmployerTransfers),
      label: 'Delayed employer transfers',
      sub: 'Past their payroll cadence',
      severity: severityFor(ATTENTION_TYPES.EMPLOYER_TRANSFERS, a.delayedEmployerTransfers),
      stakeholder: 'employer',
    },
    {
      type: ATTENTION_TYPES.NAV,
      value: n(a.delayedNav),
      label: 'Delayed NAV updation',
      sub: 'Valuation days not signed off',
      severity: severityFor(ATTENTION_TYPES.NAV, a.delayedNav),
      stakeholder: 'ops-fund-admin',
    },
    {
      type: ATTENTION_TYPES.COMPLAINTS,
      value: openComplaints,
      // Not an SLA claim: ticketing has no server-side timestamps to measure
      // against, so this counts open threads and says exactly that.
      label: 'Pending complaints',
      sub: urgentComplaints > 0
        ? `Open support threads · ${urgentComplaints} urgent`
        : 'Open support threads',
      severity: complaintsSeverity,
      stakeholder: 'agent',
    },
    {
      type: ATTENTION_TYPES.ACCESS_REQUESTS,
      value: n(a.pendingAccessRequests),
      label: 'Pending access requests',
      sub: 'Employers and distributors awaiting approval',
      severity: severityFor(ATTENTION_TYPES.ACCESS_REQUESTS, a.pendingAccessRequests),
      stakeholder: null,
    },
    {
      type: ATTENTION_TYPES.DISTRIBUTORS,
      value: n(a.underperformingDistributors),
      label: 'Underperforming distributors',
      sub: th.underperformActiveRatePct
        ? `Below ${th.underperformActiveRatePct}% active members, or deactivated`
        : 'Below the active-member threshold, or deactivated',
      severity: severityFor(ATTENTION_TYPES.DISTRIBUTORS, a.underperformingDistributors),
      stakeholder: 'distributor',
    },
    {
      type: ATTENTION_TYPES.INSURANCE_PAYOUTS,
      value: n(a.delayedInsurancePayouts),
      label: 'Delayed insurance payouts',
      sub: th.claimSlaDays
        ? `Claims past the ${th.claimSlaDays}-day decision SLA`
        : 'Claims past their decision SLA',
      severity: severityFor(ATTENTION_TYPES.INSURANCE_PAYOUTS, a.delayedInsurancePayouts),
      stakeholder: 'ops-claims',
    },
    {
      type: ATTENTION_TYPES.WITHDRAWALS,
      value: wdTotal,
      label: 'Delayed withdrawal payouts',
      sub: wdSla ? `Past the ${wdSla}-day payout SLA` : 'Past their payout SLA',
      severity: severityFor(ATTENTION_TYPES.WITHDRAWALS, wdTotal),
      stakeholder: 'ops-treasury',
      // ONE row, not a parent with retirement/emergency children. The split was
      // removed deliberately: the drill-down already names each payout's bucket
      // in its `secondary` field, so the child rows re-asked a question the very
      // next screen answers, and re-entered the same table filtered. `wd` still
      // carries `retirement`/`emergency` and get_admin_attention_rows (0097)
      // still accepts the two bucket p_types, so a per-bucket view is a filter
      // away if it is ever wanted — it just is not a top-level signal.
    },
    {
      type: ATTENTION_TYPES.CUSTODY,
      value: n(a.delayedCustodyTransfers),
      label: 'Delayed transfers to custody bank',
      sub: 'Batches past their settlement date',
      severity: severityFor(ATTENTION_TYPES.CUSTODY, a.delayedCustodyTransfers),
      stakeholder: 'ops-treasury',
    },
    {
      type: ATTENTION_TYPES.RECONCILIATION,
      value: n(rec.total),
      label: 'Reconciliation issues',
      sub: `${n(rec.userWise)} member · ${n(rec.transactionWise)} transaction`,
      severity: severityFor(ATTENTION_TYPES.RECONCILIATION, rec.total),
      stakeholder: 'ops-finance',
    },
  ];
}

/**
 * Header pill count — the non-clear signals. The list is flat, so this is a
 * straight filter; there is no nesting that could double-count a problem.
 * @param {Array<Object>} items
 * @returns {number}
 */
export function countToAction(items = []) {
  return items.filter((i) => i && i.severity !== SEVERITY.OK).length;
}

/**
 * Mobile drill target. The two signals with a purpose-built surface route there
 * instead of to the generic attention page.
 * @param {string} type
 * @returns {string}
 */
export function attentionRouteMobile(type) {
  if (type === ATTENTION_TYPES.ACCESS_REQUESTS) return '/dashboard/access-requests';
  if (type === ATTENTION_TYPES.COMPLAINTS) return '/dashboard/support';
  return `/dashboard/attention/${type}`;
}

/**
 * Desktop drill target. Desktop admin has no routes — the shell derives its page
 * from boolean panel flags — so this returns an intent for the caller to apply
 * against AdminPanelContext rather than a URL.
 * @param {string} type
 * @returns {{panel:string}|{attentionType:string}}
 */
export function attentionPanelDesktop(type) {
  const panel = REUSES_EXISTING_PANEL[type];
  return panel ? { panel } : { attentionType: type };
}
