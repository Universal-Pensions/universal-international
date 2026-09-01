import { formatUGX } from '../../utils/currency';

// What the Publish button is about to do to MEMBERS' money, not just to the
// register.
//
// Publishing releases the pricing queue for the day being published:
// contributions buy units at this price and redemptions sell them. The admin
// pressing it should know how much member money that is before they press it —
// especially when the answer is "none of it, because these payments belong to a
// day that still has no price".
//
// SHARED because it was not. The desktop publish form carried this sentence
// inline and the phone carried nothing, so an admin publishing from a phone
// could not see the queue at all — and the two surfaces would have drifted the
// moment either was reworded. Desktop and mobile have no CSS in common here
// (one is AdminNavDesktop.module.css, the other distributorMobile.module.css),
// so the caller passes `className` and this owns only the words.
//
// Renders NOTHING when the queue is empty, so a caller can drop it in
// unconditionally without guarding.

/**
 * @param {{
 *   summary?: object|null,  // getPendingPricingSummary payload (EMPTY_PENDING_PRICING shape)
 *   className?: string,
 * }} props
 */
export default function PendingPricingNote({ summary, className }) {
  const inCount = Number(summary?.pendingContributions ?? 0);
  const outCount = Number(summary?.pendingRedemptions ?? 0);
  if (!(inCount > 0 || outCount > 0)) return null;

  const releasable = Number(summary?.releasableNow ?? 0);
  const oldest = Number(summary?.oldestPendingBusinessDays ?? 0);
  const maxDays = Number(summary?.maxPendingDays ?? 0);
  const money = (n) => formatUGX(n, { compact: false });
  const s = (n) => (n === 1 ? '' : 's');

  return (
    <p className={className}>
      Waiting on a price:{' '}
      {inCount > 0 && (
        <>
          <strong>{inCount}</strong> payment{s(inCount)} in worth{' '}
          <strong>{money(summary.pendingContributionValue)}</strong>
        </>
      )}
      {inCount > 0 && outCount > 0 && ', and '}
      {outCount > 0 && (
        <>
          <strong>{outCount}</strong> payment{s(outCount)} out worth{' '}
          <strong>{money(summary.pendingRedemptionValue)}</strong>
        </>
      )}
      .{' '}
      {releasable > 0
        ? `${releasable} of them can be settled now.`
        : 'None of them can be settled until their own day has a price.'}
      {/* Only once it is genuinely overdue by the fund's own rule — otherwise
          this line would cry wolf on every ordinary overnight queue. */}
      {maxDays > 0 && oldest > maxDays && (
        <> The oldest has been waiting {oldest} working days.</>
      )}
    </p>
  );
}
