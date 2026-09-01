import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';
import { txDisplayAmount } from '../../utils/finance';
import { isRunPosted } from '../../utils/periodSettlement';

import { formatDate } from '../../utils/date';
import { useCurrentSubscriber, useSubscriberTransactions } from '../../hooks/useSubscriber';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import PageHeader from '../../components/PageHeader';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import SkeletonRow from '../../components/SkeletonRow';
import { goBackOrFallback } from '../shell/navigation';
import styles from './ActivityPage.module.css';

// Client-side sign filters. Incoming = money received; Outgoing = money sent.
// Sign is taken from txDisplayAmount so insurance premiums (stored positive but
// actually outflows) classify as Outgoing. No backend round-trip — the full
// transaction list is already cached.
const FILTERS = [
  { id: 'all',      label: 'All',      test: () => true },
  { id: 'incoming', label: 'Incoming', test: (t) => txDisplayAmount(t) > 0 },
  { id: 'outgoing', label: 'Outgoing', test: (t) => txDisplayAmount(t) < 0 },
];

// Map a transaction onto a human label for the row.
//
// Money that came from an employer is NAMED, because by sign alone the employer
// leg, the member's payroll deduction and a top-up the member chose to pay were
// three identical "Received" rows:
//   • source 'employer'  → the company's own money on top of the member's pay.
//   • run-posted 'own'   → the member's money, but deducted from their pay and
//                          remitted by the employer's run (see isRunPosted) —
//                          they made no payment, so "Received" overstated it.
//   • 'insurance_premium' → the employer's group-cover premium. It shows as an
//                          outflow (utils/finance TX_OUTFLOW_TYPES), so without a
//                          label it read as the member spending their own money.
// Everything else keeps the plain sign wording: inflows "Received", outflows "Sent".
function rowLabel(tx) {
  if (tx.type === 'contribution') {
    if (tx.source === 'employer') return 'Employer top-up';
    if (isRunPosted(tx)) return 'From your pay';
  }
  if (tx.type === 'insurance_premium' && tx.source === 'employer') return 'Cover paid by your employer';
  return txDisplayAmount(tx) > 0 ? 'Received' : 'Sent';
}

// The payment method to show under the label. A run-posted row carries the
// EMPLOYER's remittance channel ('Bank transfer', 'MTN Mobile Money'), which in a
// member's own feed reads as a payment they made from their own account. Hide it
// — the label already says where the money came from — and keep the reference.
function rowMethod(tx) {
  return isRunPosted(tx) ? null : tx.method;
}

function txYear(tx) {
  if (!tx.date) return null;
  const d = new Date(tx.date);
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}

export default function ActivityPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { data: sub } = useCurrentSubscriber();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState('all');
  const { data: allTx = [], isLoading: txLoading } = useSubscriberTransactions(sub?.id);

  // True while the subscriber id is still resolving or the transactions query
  // is in flight. Render skeletons + muted hero placeholders during this window
  // so the page doesn't flash "UGX 0 / 0 in / 0 out" + an empty state and then
  // pop content in (layout shift / CLS).
  const loading = !sub?.id || txLoading;

  // Anchor "this year" to the most recent transaction year in the feed (the
  // demo seed is anchored to MOCK_NOW = 2026), falling back to the wall clock
  // when there is no data. Components must not import mockData (CLAUDE.md §4),
  // so we derive the anchor from the data the hook already gave us.
  const thisYear = useMemo(() => {
    let max = null;
    allTx.forEach((t) => {
      const y = txYear(t);
      if (y != null && (max == null || y > max)) max = y;
    });
    return max ?? new Date().getFullYear();
  }, [allTx]);

  // Hero figure: net (incoming − outgoing) for that year only. This stays
  // anchored to the year regardless of the sign filter below, matching the
  // mockup where the dome always shows the year's net movement.
  const yearSummary = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    allTx.forEach((t) => {
      // 0147: a REJECTED redemption never happened — the engine released the
      // hold and the member kept the money — so it must not read as money out.
      // 'reversed' is deliberately NOT skipped here: reverse_transaction writes
      // a compensating type='reversal' row that this same reducer counts as an
      // inflow, so the pair already nets to zero and skipping the original
      // would break Net in the other direction.
      if (t.pricingStatus === 'rejected') return;

      if (txYear(t) !== thisYear) return;
      const signed = txDisplayAmount(t);
      if (signed > 0) inflow += signed;
      else outflow += Math.abs(signed);
    });
    return { inflow, outflow, net: inflow - outflow };
  }, [allTx, thisYear]);

  // Displayed list: this-year transactions narrowed by the sign filter.
  const visible = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true);
    return allTx.filter((t) => txYear(t) === thisYear && test(t));
  }, [allTx, filter, thisYear]);

  return (
    <div className={styles.page}>
      {/* Desktop (>=1024px) keeps the shipped PageHeader hero exactly. Mobile
          drops it (the app-bar provides the title) for the flat summary below. */}
      {isDesktop && (
        <PageHeader
          variant="hero"
          title="Activity"
          eyebrow="THIS YEAR"
          prefix="UGX"
          amount={loading
            ? '—'
            : `${yearSummary.net < 0 ? '−' : ''}${formatUGX(Math.abs(yearSummary.net), { compact: false }).replace('UGX ', '')}`}
          statRow={loading ? (
            <span style={{ opacity: 0.6 }}>Loading your activity…</span>
          ) : (
            <>
              <span style={{ color: 'var(--color-green)' }}>
                ↑ <strong style={{ color: 'var(--color-green)' }}>{formatUGX(yearSummary.inflow)}</strong> in
              </span>
              <span>↓ <strong>{formatUGX(yearSummary.outflow)}</strong> out</span>
            </>
          )}
          onBack={() => goBackOrFallback(navigate, '/dashboard')}
        />
      )}
      <div className={styles.body}>
        <motion.div
          className={styles.stack}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          {/* Mobile flat summary card — replaces the removed HeroCapsule "year
              net" dome with an eyebrow + big indigo net figure + an in/out row.
              Desktop renders the PageHeader hero above instead. */}
          {!isDesktop && (
            <section className={styles.summary} aria-labelledby="activity-net-label">
              <span className={styles.summaryEyebrow} id="activity-net-label">Net this year</span>
              {loading ? (
                <span className={styles.summaryLoading}>Loading your activity…</span>
              ) : (
                <>
                  <div className={styles.summaryFigure}>
                    {yearSummary.net < 0 ? '−' : ''}
                    {formatUGX(Math.abs(yearSummary.net), { compact: false })}
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryIn}>
                      ↑ <strong>{formatUGX(yearSummary.inflow)}</strong> in
                    </span>
                    <span className={styles.summaryOut}>
                      ↓ <strong>{formatUGX(yearSummary.outflow)}</strong> out
                    </span>
                  </div>
                </>
              )}
            </section>
          )}

          <PillChipGroup label="Filter activity" layout="row" className={styles.filters}>
            {FILTERS.map((f) => (
              <PillChip
                key={f.id}
                className={styles.filterChip}
                selected={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </PillChip>
            ))}
          </PillChipGroup>

          {loading ? (
            <SkeletonRow count={6} variant="compact" label="Loading your activity" />
          ) : visible.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                  <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3 9h18M8 13h8M8 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              <span className={styles.emptyTitle}>
                {filter === 'all' ? 'No activity this year' : `No ${filter} activity`}
              </span>
              <span className={styles.emptyText}>
                Your transactions will show up here as they happen.
              </span>
            </div>
          ) : (
            <ul className={styles.list}>
              {visible.map((tx, i) => {
                const signed = txDisplayAmount(tx);
                const incoming = signed > 0;
                const method = rowMethod(tx);
                return (
                  <li key={tx.id} className={styles.row} data-zebra={i % 2 === 1 || undefined}>
                    <div className={styles.main}>
                      <span className={styles.label} data-tone={incoming ? 'in' : 'out'}>
                        {rowLabel(tx)}
                      </span>
                      <span className={styles.meta}>
                        {method}
                        {method && tx.reference && (
                          <span className={styles.dot} aria-hidden="true">·</span>
                        )}
                        {tx.reference}
                      </span>
                    </div>
                    <div className={styles.figures}>
                      <span className={styles.amount} data-tone={incoming ? 'in' : 'out'}>
                        {incoming ? '+ ' : '− '}
                        {formatUGX(Math.abs(signed), { compact: false })}
                      </span>
                      <span className={styles.date}>
                        {formatDate(tx.date, { variant: 'short' })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            className={styles.reportsLink}
            onClick={() => navigate('/dashboard/reports/all-transactions')}
          >
            View detailed reports
            <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
              <path d="M4 10h11M11 6l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
