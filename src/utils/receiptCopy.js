// What a member is told the moment their money moves — in ONE place.
//
// Every page that takes money has two success surfaces: a mobile sheet and a
// desktop InlinePayPanel, and the desktop one takes a plain
// `success={{ title, subtitle }}` object rather than children. Phase 5 of the
// unitization redesign made only the MOBILE branches lifecycle-aware, so above
// the desktop breakpoint (769px — see useIsDesktop, lowered from 1024 by
// A18-002, so this includes tablets in portrait) members still read:
//
//     "UGX 500,000 is now working for you"        — not on a Saturday it isn't
//     "will arrive via MTN Mobile Money within 24 hours"
//                                                 — not for a Friday request
//
// Both sentences become false the moment forward dealing is switched on, and
// they are word-for-word the two the Phase 5 commit claimed to have removed.
//
// So the copy lives here, once, and every surface asks for it. The alternative —
// six hand-written conditionals — is precisely the drift DealingDateNote was
// created to prevent.

import { formatUGX } from './currency';
import { formatDate } from './date';

/**
 * THE sentence, as a string. Exported because the same words have to appear in
 * places that cannot render a component — the `success={{ subtitle }}` object
 * the desktop InlinePayPanel and the mobile PaySheet both take. Six hand-written
 * copies of this sentence is exactly the drift this component was created to
 * prevent, so there is one builder and everything else calls it.
 *
 * @param {{ dealingDate?: string|null, direction?: 'in'|'out', received?: boolean }} o
 * @returns {string|null} null when there is no date to speak about
 */
export function dealingSentence({ dealingDate, direction = 'in', received = false } = {}) {
  if (!dealingDate) return null;

  // "Monday 7 September" — a weekday name is what makes it concrete. A member
  // reading "07/09" has to work out whether that is soon.
  const when = formatDate(dealingDate, { variant: 'long-with-weekday' });
  if (!when || when === '—') return null;

  return direction === 'out'
    ? received
      ? `We are working out your payment. The amount is set on ${when}.`
      : `We work out your payment on ${when}.`
    : received
      ? `We have your money. It goes into your savings on ${when}.`
      : `Money paid in now goes into your savings on ${when}.`;
}

/**
 * Receipt copy for money paid IN.
 *
 * @param {{ result?: object|null, amount: number, newBalance: number }} o
 *   `result` is the make_contribution payload (carries pricingStatus + dealingDate)
 * @returns {{ title: string, subtitle: string }}
 */
export function contributionReceipt({ result, amount, newBalance }) {
  const pending = result?.pricingStatus === 'pending';
  const when = pending
    ? dealingSentence({ dealingDate: result?.dealingDate, direction: 'in', received: true })
    : null;

  // `when` can be null even while pending — a missing dealing date must never
  // leave the member with a bare title and no explanation, so fall back to a
  // sentence that is still true without naming a day.
  if (pending) {
    return {
      title: 'Money received',
      subtitle: `${when ?? 'We have your money. It goes into your savings on the next working day.'} `
        + `Your balance is now ${formatUGX(newBalance, { compact: false })}.`,
    };
  }
  return {
    title: 'Contribution added',
    subtitle: `${formatUGX(amount, { compact: false })} is now working for you. `
      + `Your new balance is ${formatUGX(newBalance, { compact: false })}.`,
  };
}

/**
 * Receipt copy for money taken OUT.
 *
 * @param {{ result?: object|null, amount: number, methodLabel: string }} o
 *   `result` is the request_withdrawal payload (carries pricingStatus + dealingDate)
 * @returns {{ title: string, subtitle: string }}
 */
export function withdrawalReceipt({ result, amount, methodLabel }) {
  const pending = result?.pricingStatus === 'pending';
  const when = pending
    ? dealingSentence({ dealingDate: result?.dealingDate, direction: 'out', received: true })
    : null;

  if (pending) {
    return {
      title: 'Withdrawal requested',
      subtitle: `${when ?? 'We are working out your payment.'} It is then paid to you via ${methodLabel}.`,
    };
  }
  return {
    title: 'Withdrawal requested',
    subtitle: `${formatUGX(amount, { compact: false })} will arrive via ${methodLabel} within 24 hours.`,
  };
}

/**
 * How long the member should expect to wait, for a surface shown BEFORE they
 * confirm — where there is no result yet, only the dealing date for money taken
 * right now.
 *
 * @param {string|null|undefined} dealingDate
 * @returns {string} a phrase, never empty
 */
export function payoutEtaPhrase(dealingDate) {
  const when = dealingSentence({ dealingDate, direction: 'out', received: false });
  // With forward dealing off (or no calendar reachable) the old promise holds.
  return when ?? 'Within 24 hours';
}
