import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useDistributorTickets, useDistributorTicketMetrics } from '../../hooks/useTickets';
import { useAllEntities } from '../../hooks/useEntity';
import { formatNumber } from '../../utils/currency';
import { formatRelativeTime } from '../../utils/date';
import styles from './distributorMobile.module.css';

const ChatIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

/**
 * SupportMobile — the distributor's Support surface (route /dashboard/support).
 * Read-only oversight of the ticket queue (distributor cannot reply). Status
 * filter, an open/closed/total strip, and rows into a read-only thread. Same
 * hooks as the desktop ViewTickets.
 */
export default function SupportMobile() {
  const { user } = useAuth();
  const distributorId = user?.distributorId ?? 'd-001';
  const [statusFilter, setStatusFilter] = useState('all');

  const filters = statusFilter === 'all' ? {} : { status: statusFilter };
  const { data: tickets = [], isLoading } = useDistributorTickets(distributorId, filters);
  const { data: metrics } = useDistributorTicketMetrics(distributorId);
  const { data: branches = [] } = useAllEntities('branch');

  const branchesMap = useMemo(() => {
    const map = {};
    branches.forEach((b) => { map[b.id] = b.name; });
    return map;
  }, [branches]);

  return (
    <>
      {/* Strip */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Support summary">
        <div className={styles.statStrip}>
          <div><b>{formatNumber(metrics?.openCount || 0)}</b><small>Open</small></div>
          <div><b>{formatNumber(metrics?.closedCount || 0)}</b><small>Closed</small></div>
          <div><b>{formatNumber(metrics?.totalCount || 0)}</b><small>Total</small></div>
        </div>
      </section>

      {/* Filter */}
      <div className={styles.actHead}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`${styles.fpill} ${statusFilter === f.key ? styles.fpillOn : ''}`}
            onClick={() => setStatusFilter(f.key)}
            aria-pressed={statusFilter === f.key}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <section className={styles.card} aria-label="Support tickets">
        {isLoading && tickets.length === 0 ? (
          <div className={styles.loading}><div className={styles.spinner} /></div>
        ) : (
          <>
            {tickets.map((t) => {
              const isOpen = t.status === 'open';
              return (
                <NavLink to={`/dashboard/support/${t.id}`} key={t.id} className={styles.lrow}>
                  <span className={`${styles.lIc} ${styles.tintSoft}`} aria-hidden="true">{ChatIcon}</span>
                  <span className={styles.lMid}>
                    <b>{t.subject}</b>
                    <small>{branchesMap[t.branchId] || '—'} · {t.lastMessagePreview || ''}</small>
                  </span>
                  <span className={styles.lEnd}>
                    <span className={`${styles.pill} ${isOpen ? styles.warn : styles.off}`} style={{ fontSize: 9, padding: '3px 8px' }}><i />{isOpen ? 'Open' : 'Closed'}</span>
                    <small style={{ fontSize: 10.5, color: 'var(--color-gray)' }}>{formatRelativeTime(t.updatedAt)}</small>
                  </span>
                </NavLink>
              );
            })}
            {tickets.length === 0 && (
              <div className={styles.empty}>
                <b>No tickets</b>
                <p>There are no {statusFilter === 'all' ? '' : `${statusFilter} `}tickets in your network right now.</p>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
