import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAllEntities, useAllEntitiesMetrics } from '../../hooks/useEntity';
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

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
];

/**
 * BranchesMobile — the distributor's Branches tab (route /dashboard/branches).
 * Search + status filter over the full branch collection (metrics overlaid from
 * useAllEntitiesMetrics so counts/FUM aren't zero), a network summary strip, and
 * tappable rows into the branch detail. Rows are capped + sorted by subscribers
 * so the biggest branches surface first; refine via search.
 */
export default function BranchesMobile() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: branchesRaw = [], isLoading, isError, error, refetch } = useAllEntities('branch');
  const { data: branchMetrics = {} } = useAllEntitiesMetrics('branch');
  const { data: districts = [] } = useAllEntities('district');

  const districtsMap = useMemo(() => {
    const map = {};
    districts.forEach((d) => { map[d.id] = d.name; });
    return map;
  }, [districts]);

  const branches = useMemo(
    () => branchesRaw.map((b) => ({ ...b, metrics: branchMetrics[b.id] ?? b.metrics ?? {} })),
    [branchesRaw, branchMetrics],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return branches
      .filter((b) => {
        if (statusFilter !== 'all' && (b.status || 'active') !== statusFilter) return false;
        if (!q) return true;
        const district = districtsMap[b.parentId] || '';
        return (
          (b.name || '').toLowerCase().includes(q)
          || (b.managerName || '').toLowerCase().includes(q)
          || district.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.metrics?.totalSubscribers || 0) - (a.metrics?.totalSubscribers || 0));
  }, [branches, districtsMap, search, statusFilter]);

  const totals = useMemo(() => filtered.reduce((acc, b) => {
    acc.subs += b.metrics?.totalSubscribers || 0;
    acc.agents += b.metrics?.totalAgents || 0;
    acc.aum += b.metrics?.aum || 0;
    return acc;
  }, { subs: 0, agents: 0, aum: 0 }), [filtered]);

  if (isError) {
    return <ErrorCard title="We couldn't load branches" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && branchesRaw.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      {/* Summary strip */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Branches summary">
        <div className={styles.statStrip}>
          <div>
            <b>{formatNumber(filtered.length)}</b>
            <small>Branches</small>
          </div>
          <div>
            <b>{formatNumber(totals.agents)}</b>
            <small>Agents</small>
          </div>
          <div>
            <b>{formatUGXShort(totals.aum)}</b>
            <small>Funds</small>
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
          placeholder="Search branch, district, manager"
          aria-label="Search branches"
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
      <section className={styles.card} aria-label="Branch list">
        {filtered.length > 0 ? (
          <VirtualRows items={filtered} getKey={(b) => b.id}>
            {(b) => {
              const m = b.metrics || {};
              const rate = Math.round(m.activeRate || 0);
              const district = districtsMap[b.parentId] || '—';
              const isActive = (b.status || 'active') !== 'inactive';
              return (
                <NavLink to={`/dashboard/branches/${b.id}`} className={styles.lrow}>
                  <span className={styles.av} aria-hidden="true">{initials(b.name)}</span>
                  <span className={styles.lMid}>
                    <b>{b.name}</b>
                    <small>{district} · {formatNumber(m.totalSubscribers || 0)} subs · {rate}% active</small>
                  </span>
                  <span className={styles.lEnd}>
                    <span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(m.aum || 0)}</span>
                    <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
                  </span>
                  <span className={styles.chev}>{ChevIcon}</span>
                </NavLink>
              );
            }}
          </VirtualRows>
        ) : (
          <div className={styles.empty}>
            <b>No branches found</b>
            <p>Try a different search or filter.</p>
          </div>
        )}
      </section>
      {filtered.length > 0 && (
        <p className={styles.ver}>{formatNumber(filtered.length)} branch{filtered.length === 1 ? '' : 'es'}</p>
      )}
    </>
  );
}
