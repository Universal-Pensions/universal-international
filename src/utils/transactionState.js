// How a transaction's PRICING lifecycle is worded for a member.
//
// Added by Phase 5 of the unitization redesign. A transaction now has two
// independent states and conflating them is misleading in both directions:
//
//   `status`         — the PAYMENT: settled, processing, paid.
//                      "Did the money move?"
//   `pricingStatus`  — the INVESTMENT: pending, priced, rejected, reversed.
//                      "Has it bought or sold savings yet?"
//
// A contribution can be `settled` (we have the cash) and `pending` (it buys
// savings on Monday) at the same time, and until Phase 6 flips the kill switch
// EVERY live row is `priced` the instant it exists — so this collapses to
// today's wording and nothing on screen moves.
//
// LANGUAGE. Members read this. No "unitized", no "NAV", no "dealing date", no
// "allocation" — the words are money words, and dates are spelled out by the
// caller. A member who pays in on Saturday should read a sentence that tells
// them plainly when their money starts working, not a term of art.

/**
 * The member-facing state of a transaction, preferring the pricing lifecycle
 * when it says something the payment status does not.
 *
 * @param {{status?:string, type?:string, pricingStatus?:string}} row
 * @returns {{ label:string, tone:'ok'|'pending'|'warn' }}
 */
export function transactionState(row) {
  const pricing = row?.pricingStatus;
  const isOut = row?.type === 'withdrawal' || row?.type === 'premium_sweep';

  if (pricing === 'pending') {
    return isOut
      ? { label: 'Working out your payment', tone: 'pending' }
      : { label: 'Being put into savings', tone: 'pending' };
  }
  if (pricing === 'rejected') {
    return { label: 'Not completed', tone: 'warn' };
  }
  if (pricing === 'reversed') {
    return { label: 'Reversed', tone: 'warn' };
  }

  // `priced`, `not_applicable`, or a row from before the lifecycle existed:
  // the payment status is the whole story, worded exactly as it was before.
  const status = String(row?.status ?? '');
  const tone =
    status === 'paid' || status === 'settled'
      ? 'ok'
      : status === 'processing' || status === 'submitted' || status === 'under_review'
        ? 'pending'
        : 'ok';
  return {
    label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    tone,
  };
}

/** True when this row is waiting for a price and has no units or price yet. */
export function isAwaitingPricing(row) {
  return row?.pricingStatus === 'pending';
}
