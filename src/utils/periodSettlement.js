// Settle-this-period helpers for the contribution-schedule "pay the difference"
// flow. Pure: the demo clock (`now`) and the transactions feed are passed in by
// the caller, so this util never imports mockData / the clock (CLAUDE.md §4.1).
//
// When a subscriber edits their schedule (or adds insurance), we settle the
// CURRENT period: the contribution top-up they still owe this month plus the
// premiums for any newly-added insurance products. (Distinct from the
// distributor commission flow in utils/settlement.js.)

import { INSURANCE_PRODUCTS } from '../constants/savings';

/**
 * True when a transaction was posted BY an employer contribution run rather than
 * by the member themselves.
 *
 * Why this exists: a run posts the EMPLOYEE leg with `source: 'own'` — it IS the
 * member's money — but the member never chose to pay it and never handled it.
 * The employer deducts it from their pay and remits it with the run, using the
 * EMPLOYER's payment method. `source` alone therefore cannot tell a payroll
 * deduction from a self-paid top-up; `contributionRunId`
 * (transactions.contribution_run_id) is the only reliable marker.
 *
 * Exported so every member-facing attribution surface (activity feed, the
 * notification bell, the reports + statement exports) keys off ONE predicate
 * instead of re-deriving it and drifting.
 *
 * @param {{contributionRunId?: string|null}} tx
 */
export function isRunPosted(tx) {
  return !!tx && tx.contributionRunId != null;
}

/**
 * Sum of the member's OWN contributions this (calendar) month, using the injected
 * `now` (the demo clock) — i.e. what they have already paid toward the schedule
 * they set for themselves.
 *
 * Two kinds of row are excluded, because neither is money the member chose to pay:
 *   - `source: 'employer'` — the employer leg, which is the company's own money.
 *   - anything carrying a `contributionRunId` — the employee leg of an employer
 *     contribution run. It is stamped `source: 'own'` (the money IS the member's,
 *     deducted from their pay), but the employer remitted it on payroll. Without
 *     this exclusion an employer-sponsored member who set their own schedule saw
 *     it silently "already paid" the moment payroll ran, so the settle sheet
 *     asked for nothing.
 *
 * @param {Array<{type, source?, amount, date, contributionRunId?}>} transactions
 * @param {Date} now
 */
export function paidThisMonth(transactions, now) {
  if (!Array.isArray(transactions) || !now) return 0;
  const year = now.getFullYear();
  const month = now.getMonth();
  return transactions
    .filter((t) => t && t.type === 'contribution' && t.source !== 'employer' && !isRunPosted(t))
    .filter((t) => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month;
    })
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

/**
 * What's still owed on this period's scheduled contribution: the new scheduled
 * amount minus what's already been paid this month, floored at 0. If the old
 * 5,000 is already paid and the schedule rises to 10,000 → owe 5,000; if nothing
 * is paid yet → owe the full 10,000.
 */
export function contributionOwed(scheduleAmount, paid) {
  return Math.max(0, Math.round((Number(scheduleAmount) || 0) - (Number(paid) || 0)));
}

/** Product ids present in `next` but not already held in `prev`. */
export function newlyAddedProducts(prev, next) {
  const held = new Set(prev ?? []);
  return (next ?? []).filter((id) => !held.has(id));
}

/**
 * Settle line items for the ANNUAL-premium insurance model (migrations 0072/0073),
 * used by the subscriber schedule editor. Route A "pay now" charges the combined
 * ANNUAL premium up front (one line per newly-added product, priced yearly);
 * Route B "save up for it" charges NOTHING now (the premium accrues from the
 * emergency slice), so only the owed contribution appears.
 *
 * @param {{ owed?: number, addedProducts?: Array<{id?:string, product?:string, label?:string, premiumMonthly?:number}>, payNow?: boolean }} opts
 * @returns {{ lineItems: Array, total: number, insuranceTotal: number }}
 */
export function buildAnnualSettleLineItems({ owed = 0, addedProducts = [], payNow = true } = {}) {
  const lineItems = [];
  if (owed > 0) {
    lineItems.push({ id: 'contribution', kind: 'contribution', label: 'This month’s contribution', amount: owed });
  }
  let insuranceTotal = 0;
  if (payNow) {
    for (const p of addedProducts) {
      const pid = p.id ?? p.product;
      // Resolve the human product name (the caller passes {product, cover,
      // premiumMonthly} with no label) so the settle sheet reads "Life insurance
      // · one year", not the raw enum id.
      const label = p.label ?? INSURANCE_PRODUCTS.find((x) => x.id === pid)?.label ?? pid;
      const annual = Math.round((Number(p.premiumMonthly) || 0) * 12);
      insuranceTotal += annual;
      lineItems.push({
        id: `insurance-${pid}`,
        kind: 'insurance',
        product: pid,
        label: `${label} · one year`,
        amount: annual,
      });
    }
  }
  const total = lineItems.reduce((sum, li) => sum + li.amount, 0);
  return { lineItems, total, insuranceTotal };
}
