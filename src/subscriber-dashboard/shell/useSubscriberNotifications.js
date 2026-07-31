import { useCallback, useMemo, useState } from 'react';
import { useSubscriberTransactions } from '../../hooks/useSubscriber';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { isRunPosted } from '../../utils/periodSettlement';

/**
 * useSubscriberNotifications — a CLIENT-DERIVED notification feed for the
 * subscriber desktop bell.
 *
 * The platform has no subscriber notification backend (the `notifications` table
 * + service + RLS are agent/branch only — CLAUDE.md §9), so rather than touch
 * shared RLS/service code for a demo, this hook synthesises a newest-first feed
 * from data the dashboard already loads: the member's recent transactions
 * (self-paid contributions, pay deductions remitted by an employer run, employer
 * top-ups, premium debits, withdrawals, claim payouts) plus a standing "payment
 * due" reminder from their contribution schedule. It
 * imports NO mockData (CLAUDE.md §4) — everything derives from the live `sub`
 * record + its transactions.
 *
 * Read-state is ephemeral: a single timestamp in localStorage
 * (`subscriberNotifsReadAt`). Items dated after it are unread — consistent with
 * the platform's per-session demo-mutation pattern (resets are fine).
 */
const READ_KEY = 'subscriberNotifsReadAt';
const MAX_ITEMS = 8;

function readStamp() {
  try {
    return localStorage.getItem(READ_KEY) || '';
  } catch {
    return '';
  }
}

export function useSubscriberNotifications(sub) {
  const { data: txns = [] } = useSubscriberTransactions(sub?.id);
  const [readAt, setReadAt] = useState(readStamp);

  const items = useMemo(() => {
    const list = [];

    // Standing "payment due" reminder, derived from the schedule. Anchored to
    // "now" so it sorts to the top and clears on mark-read (it resurfaces next
    // session — a standing reminder, by design).
    //
    // It fires ONLY on the member's own schedule amount. An employer-sponsored
    // member has no self-set amount (the employer's config drives their legs, so
    // `contribution_schedules.amount` stays 0) — so they never see this, which is
    // the correct outcome: nothing is due FROM them. If such a member does set
    // their own schedule on top of payroll, the reminder is then genuinely theirs
    // to pay, and `paidThisMonth` no longer counts the payroll-remitted employee
    // leg as settling it (utils/periodSettlement.js).
    const schedule = sub?.contributionSchedule;
    if (schedule?.amount && schedule?.nextDueDate) {
      list.push({
        id: 'due',
        title: 'Payment due soon',
        body: `Your ${formatUGX(schedule.amount, { compact: false })} contribution is due ${formatDate(schedule.nextDueDate, { variant: 'day-month' })}.`,
        date: new Date().toISOString(),
      });
    }

    // Activity-derived notifications (the transactions feed is already
    // newest-first). Capped so the popover stays tidy.
    for (const tx of txns.slice(0, MAX_ITEMS)) {
      const amt = formatUGX(Math.abs(tx.amount || 0), { compact: false });
      let title;
      let body;
      if (tx.type === 'contribution' && tx.source === 'employer') {
        // The employer leg — the company's own money, on top of the member's pay.
        title = 'Employer top-up';
        body = `${amt} added to your pension by your employer.`;
      } else if (tx.type === 'contribution' && isRunPosted(tx)) {
        // The EMPLOYEE leg of an employer contribution run. It is the member's own
        // money, but the employer deducted it from their pay and remitted it — the
        // member made no payment. Saying "Contribution received … via MTN Mobile
        // Money" (the run's method is the EMPLOYER's channel) told them they had
        // paid it themselves. Name the deduction instead, and never quote a payment
        // method that isn't theirs.
        title = 'From your pay';
        body = `${amt} of your pay was added to your pension.`;
      } else if (tx.type === 'contribution') {
        title = 'Contribution received';
        body = `${amt} added to your savings${tx.method ? ` via ${tx.method}` : ''}.`;
      } else if (tx.type === 'premium') {
        title = 'Insurance premium paid';
        body = `${amt} debited for your life cover.`;
      } else if (tx.type === 'withdrawal') {
        title = 'Withdrawal processed';
        body = `${amt} withdrawn from your savings.`;
      } else if (tx.type === 'claim') {
        title = 'Claim paid out';
        body = `${amt} paid to you.`;
      } else {
        continue;
      }
      list.push({ id: `tx-${tx.id}`, title, body, date: tx.date });
    }

    return list;
  }, [sub, txns]);

  const isUnread = useCallback(
    (item) => !readAt || (item.date && item.date > readAt),
    [readAt],
  );

  const unread = useMemo(() => items.filter(isUnread).length, [items, isUnread]);

  const markAllRead = useCallback(() => {
    const stamp = new Date().toISOString();
    try {
      localStorage.setItem(READ_KEY, stamp);
    } catch {
      /* ignore persistence failures (private mode, etc.) */
    }
    setReadAt(stamp);
  }, []);

  return { items, unread, isUnread, markAllRead };
}
