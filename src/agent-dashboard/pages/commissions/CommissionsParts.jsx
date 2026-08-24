import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../../utils/motion';

import { formatUGX } from '../../../utils/currency';
import { formatDate } from '../../../utils/date';
import { SUPPORT_EMAIL } from '../../../config/env';
import { Icons } from './commissionsConfig';
import styles from '../CommissionsPage.module.css';

export function StatusBadge({ status }) {
  if (status === 'paid') {
    return <span className={styles.badge} data-tone="confirmed">Paid</span>;
  }
  return <span className={styles.badge} data-tone="due">Due</span>;
}

/**
 * CommissionRow — one paid or due line. Paid lines (from `paidTransactions`)
 * read "Paid {date} · Ref {txnRef}"; due lines (from `dueTransactions`) read
 * "Due {date}". No confirm / dispute / withdraw actions survive the flat
 * `due → paid` flow.
 */
export function CommissionRow({ line }) {
  const isPaid = line.status === 'paid';
  const dateLabel = isPaid
    ? `Paid ${formatDate(line.transactionDate)}`
    : `Due ${formatDate(line.dueDate)}`;

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowHeader}>
          <span className={styles.rowName}>{line.subscriberName}</span>
          <StatusBadge status={line.status} />
        </div>
        <div className={styles.rowMeta}>
          <span>{dateLabel}</span>
          <span className={styles.rowAmount}>{formatUGX(line.amount)}</span>
        </div>
        {isPaid && line.txnRef && (
          <div className={styles.refNote}>Ref: {line.txnRef}</div>
        )}
      </div>
    </div>
  );
}

/**
 * EarnedMonths — paid transactions grouped by the calendar month they were paid
 * in (newest month first), each a collapsible section. Replaces the old
 * cadence-driven "past cycles" grouping.
 */
export function EarnedMonths({ months }) {
  const [openKey, setOpenKey] = useState(months[0]?.key || null);

  if (months.length === 0) return null;

  return (
    <section className={styles.cyclesSection} aria-labelledby="earned-months-title">
      <header className={styles.cyclesHead}>
        <span className={styles.cyclesEyebrow}>History</span>
        <h2 id="earned-months-title" className={styles.cyclesTitle}>Paid by month</h2>
      </header>
      <ul className={styles.cyclesList}>
        {months.map((group) => {
          const open = openKey === group.key;
          return (
            <li key={group.key} className={styles.cycleItem}>
              <button
                type="button"
                className={styles.cycleHead}
                aria-expanded={open}
                aria-controls={`month-${group.key}`}
                onClick={() => setOpenKey(open ? null : group.key)}
              >
                <span className={styles.cycleLabelStack}>
                  <span className={styles.cycleLabel}>{group.label}</span>
                  <span className={styles.cycleSub}>
                    {group.lines.length} commission{group.lines.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className={styles.cycleAmount}>{formatUGX(group.total)}</span>
                <span className={styles.cycleChev} data-open={open}>{Icons.chevDown}</span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="rows"
                    id={`month-${group.key}`}
                    className={styles.cycleBody}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
                  >
                    <div className={styles.cycleRows}>
                      {group.lines.map((line) => (
                        <CommissionRow key={line.id} line={line} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * SettlementMismatchBanner — INFORM-NOT-BLOCK surfacing of a short-paid
 * settlement (BL-1). When the distributor's most recent settlement for this
 * agent paid less than the pending total it was raised against, the FIFO
 * apply leaves some lines genuinely `due`; this banner tells the agent what
 * happened and offers an "Ask for reason" mailto prefilled with the batch
 * reference, the due total, and the paid total. A client-side mailto is a demo
 * affordance (no backend integration); the recipient is the distributor/back-
 * office support mailbox (`SUPPORT_EMAIL`).
 *
 * TIME, not arithmetic (A05-002 / A11-001): `shortfall` below is frozen at
 * the moment this batch was settled — it is "what was left over from THAT
 * payout". The Owed/Outstanding tile rendered right after this banner reads
 * live `due` commissions queried NOW, which can include lines that didn't
 * exist yet when this batch was raised. Both numbers are correct; they just
 * answer different questions. Rather than collapsing them into one figure
 * (which would either hide the agent's true live balance, or break the
 * "paid against due — shortfall" arithmetic inside this banner's own
 * sentence), both stay and are labelled by time so a non-technical reader
 * doesn't have to reconcile them: this banner is explicitly "from that
 * settlement"; the tile below is explicitly "right now".
 */
export function SettlementMismatchBanner({ batch }) {
  if (!batch) return null;
  const shortfall = Math.max(0, (batch.pendingTotal || 0) - (batch.paidAmount || 0));
  // A05-010: show the human payment reference (what a mobile-money payer or
  // back-office staffer would recognise), never the internal batch UUID.
  // apply_settlement always sets txn_ref, but the column is nullable, so fall
  // back to the id only if it's ever missing.
  const reference = batch.txnRef || batch.id;
  const subject = `Commission settlement query — ${reference}`;
  const bodyLines = [
    `Hello,`,
    ``,
    `I have a question about a recent commission settlement.`,
    ``,
    `Settlement reference: ${reference}`,
    `Due at the time: ${formatUGX(batch.pendingTotal)}`,
    `Amount paid: ${formatUGX(batch.paidAmount)}`,
    `Still unpaid from this settlement: ${formatUGX(shortfall)}`,
    ``,
    `Could you let me know the reason for the difference?`,
    ``,
    `Thank you.`,
  ];
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;

  return (
    <section className={styles.mismatchBanner} role="status" aria-live="polite">
      <div className={styles.mismatchText}>
        <span className={styles.mismatchTitle}>Your last settlement was partial</span>
        <span className={styles.mismatchBody}>
          {formatUGX(batch.paidAmount)} paid against {formatUGX(batch.pendingTotal)} due at the time
          {' '}— {formatUGX(shortfall)} from that settlement is still unpaid (ref {reference}).
          {' '}That's separate from what's owed to you right now, shown below.
        </span>
      </div>
      <a className={styles.mismatchCta} href={mailto}>Ask for reason</a>
    </section>
  );
}
