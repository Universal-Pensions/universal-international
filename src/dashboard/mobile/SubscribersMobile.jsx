import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAllEntities } from '../../hooks/useEntity';
import { formatNumber, formatUGXShort } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import VirtualRows from './VirtualRows';
import styles from './distributorMobile.module.css';

const SearchIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
  </svg>
);
const ChevIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
// Prefer the real `total_balance` (embedded on the list read); the
// contributions-minus-withdrawals form only ever yielded 0 here, because those
// aggregates live in `transactions` and no list query selects them.
function subBalance(s) {
  return s.totalBalance || ((s.totalContributions || 0) - (s.totalWithdrawals || 0));
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
];

/**
 * SubscribersMobile — the distributor's Subscribers surface (route
 * /dashboard/subscribers, reached from the Menu hub / Home). Same data as the
 * desktop ViewSubscribers (full collection, client filter; balance =
 * contributions − withdrawals; status = isActive). Search + status filter, a
 * summary strip, capped rows sorted by balance.
 */
export default function SubscribersMobile() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: subsRaw = [], isLoading, isError, error, refetch } = useAllEntities('subscriber');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subsRaw
      .filter((s) => {
        const status = s.isActive ? 'active' : 'inactive';
        if (statusFilter !== 'all' && status !== statusFilter) return false;
        if (!q) return true;
        return (s.name || '').toLowerCase().includes(q) || (s.phone || '').toLowerCase().includes(q);
      })
      .sort((a, b) => subBalance(b) - subBalance(a));
  }, [subsRaw, search, statusFilter]);

  const totals = useMemo(() => filtered.reduce((acc, s) => {
    if (s.isActive) acc.active += 1;
    acc.balance += subBalance(s);
    return acc;
  }, { active: 0, balance: 0 }), [filtered]);

  if (isError) {
    return <ErrorCard title="We couldn't load subscribers" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && subsRaw.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      {/* Summary strip */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Subscribers summary">
        <div className={styles.statStrip}>
          <div>
            <b>{formatNumber(filtered.length)}</b>
            <small>Subscribers</small>
          </div>
          <div>
            <b className={styles.g}>{formatNumber(totals.active)}</b>
            <small>Active</small>
          </div>
          <div>
            <b>{formatUGXShort(totals.balance)}</b>
            <small>Balance</small>
          </div>
        </div>
      </section>

      {/* Search + filter */}
      <div className={styles.search}>
        {SearchIcon}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone"
          aria-label="Search subscribers"
        />
      </div>
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

      {/* List — fully browsable + virtualized */}
      <section className={styles.card} aria-label="Subscriber list">
        {filtered.length > 0 ? (
          <VirtualRows items={filtered} getKey={(s) => s.id}>
            {(s) => {
              const isActive = !!s.isActive;
              return (
                <NavLink to={`/dashboard/subscribers/${s.id}`} state={{ sub: s }} className={styles.lrow}>
                  <span className={styles.av} aria-hidden="true">{initials(s.name)}</span>
                  <span className={styles.lMid}>
                    <b>{s.name}</b>
                    <small>{s.phone || '—'}</small>
                  </span>
                  <span className={styles.lEnd}>
                    <span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(subBalance(s))}</span>
                    <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
                  </span>
                  <span className={styles.chev}>{ChevIcon}</span>
                </NavLink>
              );
            }}
          </VirtualRows>
        ) : (
          <div className={styles.empty}>
            <b>No subscribers found</b>
            <p>Try a different search or filter.</p>
          </div>
        )}
      </section>
      {filtered.length > 0 && (
        <p className={styles.ver}>{formatNumber(filtered.length)} subscriber{filtered.length === 1 ? '' : 's'}</p>
      )}
    </>
  );
}
