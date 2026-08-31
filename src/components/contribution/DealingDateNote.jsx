import { formatDate } from '../../utils/date';

// The ONE sentence that explains, in plain language, when money starts working.
//
// Shared deliberately: the member sees it on the pay-in screen, on the take-out
// confirm sheet, in their transaction history, and an agent sees it at the
// point of sale BEFORE they take a member's cash. Four copies of this sentence
// would drift, and the version an agent says out loud at 3pm on a Friday is the
// one that sets a member's expectations.
//
// LANGUAGE BAR (feedback: plain language for Uganda). No "unit", no "NAV", no
// "dealing date", no "allocation", no "T+1". Shillings, days of the week,
// short sentences. A member with low literacy should be able to read this once
// and know when their money starts earning.
//
// It renders NOTHING when there is no date to show, so a caller can drop it in
// unconditionally without guarding.

/**
 * @param {{
 *   dealingDate?: string|null,      // YYYY-MM-DD
 *   direction?: 'in'|'out',         // paying in (default) or taking out
 *   received?: boolean,             // true once the money has actually arrived
 *   className?: string,
 * }} props
 */
export default function DealingDateNote({
  dealingDate,
  direction = 'in',
  received = false,
  className,
}) {
  if (!dealingDate) return null;

  // "Monday 7 September" — a weekday name is what makes it concrete. A member
  // reading "07/09" has to work out whether that is soon.
  const when = formatDate(dealingDate, { variant: 'long-with-weekday' });
  if (!when || when === '—') return null;

  const text =
    direction === 'out'
      ? received
        ? `We are working out your payment. The amount is set on ${when}.`
        : `We work out your payment on ${when}.`
      : received
        ? `We have your money. It goes into your savings on ${when}.`
        : `Money paid in now goes into your savings on ${when}.`;

  return <p className={className}>{text}</p>;
}
