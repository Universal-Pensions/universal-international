import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAllEmployersMetrics } from '../../hooks/useEmployer';
import { formatNumber, formatUGXShort } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

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

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
];

/**
 * EmployersMobile — the admin's Employers tab (route /dashboard/employers). The
 * B2B pension accounts with their own staff rosters. Search + status filter,
 * summary strip, rows into the employer detail. Data from useAllEmployersMetrics
 * (the admin-gated get_all_employers_metrics RPC).
 */
export default function EmployersMobile() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: employers = [], isLoading, isError, error, refetch } = useAllEmployersMetrics();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employers.filter((e) => {
      if (statusFilter !== 'all' && (e.status || 'active') !== statusFilter) return false;
      if (!q) return true;
      return (
        (e.name || '').toLowerCase().includes(q)
        || (e.sector || '').toLowerCase().includes(q)
        || (e.district || '').toLowerCase().includes(q)
      );
    });
  }, [employers, search, statusFilter]);

  const totals = useMemo(() => filtered.reduce((acc, e) => {
    acc.members += e.headcount || 0;
    acc.contrib += e.totalContributions || 0;
    return acc;
  }, { members: 0, contrib: 0 }), [filtered]);

  if (isError) {
    return <ErrorCard title="We couldn't load employers" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && employers.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Employers summary">
        <div className={styles.statStrip}>
          <div><b>{formatNumber(filtered.length)}</b><small>Employers</small></div>
          <div><b>{formatNumber(totals.members)}</b><small>Members</small></div>
          <div><b>{formatUGXShort(totals.contrib)}</b><small>Contributed</small></div>
        </div>
      </section>

      <div className={styles.search}>
        {SearchIcon}
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, sector, district" aria-label="Search employers" />
      </div>
      <div className={styles.actHead}>
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`${styles.fpill} ${statusFilter === f.key ? styles.fpillOn : ''}`} onClick={() => setStatusFilter(f.key)} aria-pressed={statusFilter === f.key}>
            {f.label}
          </button>
        ))}
      </div>

      <section className={styles.card} aria-label="Employer list">
        {filtered.map((e) => {
          const isActive = (e.status || 'active') !== 'inactive';
          return (
            <NavLink to={`/dashboard/employers/${e.id}`} key={e.id} className={styles.lrow}>
              <span className={styles.av} aria-hidden="true">{initials(e.name)}</span>
              <span className={styles.lMid}>
                <b>{e.name}</b>
                <small>{[e.sector, e.district].filter(Boolean).join(' · ') || '—'} · {formatNumber(e.headcount || 0)} staff</small>
              </span>
              <span className={styles.lEnd}>
                <span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(e.totalContributions || 0)}</span>
                <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
              </span>
              <span className={styles.chev}>{ChevIcon}</span>
            </NavLink>
          );
        })}
        {filtered.length === 0 && (
          <div className={styles.empty}><b>No employers found</b><p>Try a different search or filter.</p></div>
        )}
      </section>
    </>
  );
}
