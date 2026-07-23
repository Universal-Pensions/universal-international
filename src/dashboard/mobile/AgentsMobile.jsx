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
 * AgentsMobile — the distributor's Agents tab (route /dashboard/agents). Search +
 * status filter over the full agent collection (metrics overlaid), a summary
 * strip, and tappable rows into agent detail. Rows are capped + sorted by
 * subscribers; refine with search.
 */
export default function AgentsMobile() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: agentsRaw = [], isLoading, isError, error, refetch } = useAllEntities('agent');
  const { data: agentMetrics = {} } = useAllEntitiesMetrics('agent');
  const { data: branches = [] } = useAllEntities('branch');

  const branchesMap = useMemo(() => {
    const map = {};
    branches.forEach((b) => { map[b.id] = b.name; });
    return map;
  }, [branches]);

  const agents = useMemo(
    () => agentsRaw.map((a) => ({ ...a, metrics: agentMetrics[a.id] ?? a.metrics ?? {} })),
    [agentsRaw, agentMetrics],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents
      .filter((a) => {
        if (statusFilter !== 'all' && (a.status || 'active') !== statusFilter) return false;
        if (!q) return true;
        const branch = branchesMap[a.parentId] || '';
        return (
          (a.name || '').toLowerCase().includes(q)
          || branch.toLowerCase().includes(q)
          || (a.employeeId || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.metrics?.totalSubscribers || 0) - (a.metrics?.totalSubscribers || 0));
  }, [agents, branchesMap, search, statusFilter]);

  const totals = useMemo(() => filtered.reduce((acc, a) => {
    acc.subs += a.metrics?.totalSubscribers || 0;
    acc.aum += a.metrics?.aum || 0;
    return acc;
  }, { subs: 0, aum: 0 }), [filtered]);

  if (isError) {
    return <ErrorCard title="We couldn't load agents" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && agentsRaw.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      {/* Summary strip */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Agents summary">
        <div className={styles.statStrip}>
          <div>
            <b>{formatNumber(filtered.length)}</b>
            <small>Agents</small>
          </div>
          <div>
            <b>{formatNumber(totals.subs)}</b>
            <small>Subscribers</small>
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
          placeholder="Search agent, branch, ID"
          aria-label="Search agents"
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
      <section className={styles.card} aria-label="Agent list">
        {filtered.length > 0 ? (
          <VirtualRows items={filtered} getKey={(a) => a.id}>
            {(a) => {
              const m = a.metrics || {};
              const branch = branchesMap[a.parentId] || '—';
              const isActive = (a.status || 'active') !== 'inactive';
              return (
                <NavLink to={`/dashboard/agents/${a.id}`} className={styles.lrow}>
                  <span className={styles.av} data-tone="teal" aria-hidden="true">{initials(a.name)}</span>
                  <span className={styles.lMid}>
                    <b>{a.name}</b>
                    <small>{branch} · {formatNumber(m.totalSubscribers || 0)} subs</small>
                  </span>
                  <span className={styles.lEnd}>
                    {a.performance != null && <span className={styles.lAmt} style={{ fontSize: 13 }}>{a.performance}%</span>}
                    <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
                  </span>
                  <span className={styles.chev}>{ChevIcon}</span>
                </NavLink>
              );
            }}
          </VirtualRows>
        ) : (
          <div className={styles.empty}>
            <b>No agents found</b>
            <p>Try a different search or filter.</p>
          </div>
        )}
      </section>
      {filtered.length > 0 && (
        <p className={styles.ver}>{formatNumber(filtered.length)} agent{filtered.length === 1 ? '' : 's'}</p>
      )}
    </>
  );
}
