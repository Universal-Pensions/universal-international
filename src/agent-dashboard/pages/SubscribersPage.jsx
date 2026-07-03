import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';

import { getInitials } from '../../utils/dashboard';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentSubscribers } from '../../hooks/useAgent';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import SubscribersDesktop from './SubscribersDesktop';
import ErrorCard from '../../components/feedback/ErrorCard';
import AgentMobileHero from '../shell/AgentMobileHero';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import styles from './SubscribersPage.module.css';

// NB: no 'balance' (netBalance) sort — ranking subscribers by current balance
// would expose their net wealth, which the agent must NOT see (invariant in
// SubscriberDetailPage.jsx). Lifetime 'contributions' is an engagement figure
// the list already surfaces, so it stays.
const SORT_OPTIONS = [
  { key: 'contributions', label: 'Contributions', fn: (a, b) => b.totalContributions - a.totalContributions },
  { key: 'registration', label: 'Registration', fn: (a, b) => (b.registeredDate || '').localeCompare(a.registeredDate || '') },
  { key: 'name', label: 'Name', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
];

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'dormant', label: 'Dormant' },
];

function StatusPill({ status }) {
  return (
    <span className={styles.statusPill} data-tone={status}>
      <span className={styles.statusDot} />
      {status === 'active' ? 'Active' : 'Dormant'}
    </span>
  );
}

export default function SubscribersPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { agentId } = useAgentScope();
  const { data: subscribers = [], isLoading, isError, error, refetch } = useAgentSubscribers(agentId);

  const [search, setSearch] = useState('');
  // Honour a `?filter=active|dormant` deep link (e.g. the Home "Active
  // subscribers" row) so it lands on the matching filtered view, not All.
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState(() => {
    const f = searchParams.get('filter');
    return f === 'active' || f === 'dormant' ? f : 'all';
  });
  const [sortKey, setSortKey] = useState('contributions');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sortFn = SORT_OPTIONS.find((o) => o.key === sortKey)?.fn;
    const out = subscribers.filter((s) => {
      if (filter === 'active' && !s.isActive) return false;
      if (filter === 'dormant' && s.isActive) return false;
      if (q && !(s.name || '').toLowerCase().includes(q) && !s.id.toLowerCase().includes(q) && !(s.phone || '').includes(q)) {
        return false;
      }
      return true;
    });
    return sortFn ? out.sort(sortFn) : out;
  }, [subscribers, filter, search, sortKey]);

  const counts = useMemo(() => {
    const active = subscribers.filter((s) => s.isActive).length;
    return {
      all: subscribers.length,
      active,
      dormant: subscribers.length - active,
    };
  }, [subscribers]);

  const isDesktop = useIsDesktop();
  if (isDesktop) return <SubscribersDesktop />;

  const loading = isLoading && subscribers.length === 0;
  const activePct = counts.all ? Math.round((counts.active / counts.all) * 100) : 0;

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <motion.div
          className={styles.stack}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          <AgentMobileHero
            eyebrow="Your portfolio"
            value={loading ? '—' : `${counts.all} subscriber${counts.all === 1 ? '' : 's'}`}
          >
            {!loading && (
              <>
                <span>
                  <strong style={{ color: 'var(--color-green-ink, #1f6e44)', fontWeight: 700 }}>{counts.active}</strong> active
                </span>
                <span style={{ color: 'var(--color-gray)' }}>{counts.dormant} dormant</span>
                <span><strong>{activePct}%</strong> active</span>
              </>
            )}
          </AgentMobileHero>

          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <svg className={styles.searchIcon} aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                className={styles.search}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, ID or phone…"
                aria-label="Search subscribers"
                spellCheck={false}
              />
              <select
                className={styles.sortSelect}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                aria-label="Sort by"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <PillChipGroup label="Filter subscribers" layout="row" className={styles.filters}>
              {FILTERS.map((f) => (
                <PillChip
                  key={f.id}
                  selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  <span className={styles.filterCount}>{counts[f.id]}</span>
                </PillChip>
              ))}
            </PillChipGroup>
          </div>

          <div className={styles.list}>
            {loading && (
              // Cold-load skeleton — keeps the list area feeling responsive
              // instead of a bare spinner that doesn't hint at row geometry.
              <SkeletonRow count={6} label="Loading your subscribers" />
            )}
            {isError && !isLoading && (
              <ErrorCard
                title="We couldn't load your subscribers"
                message={error}
                onRetry={refetch}
              />
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              // Differentiate: clean state ("no subscribers onboarded yet") vs
              // filter mismatch ("widen your filter"). The agent has no list-only
              // way to add subscribers from here; onboarding is its own flow.
              search.trim() === '' && filter === 'all' ? (
                <EmptyState
                  kind="no-data"
                  title="No subscribers yet."
                  body="Once you onboard your first subscriber, they'll appear here."
                />
              ) : (
                <EmptyState
                  kind="no-match"
                  title="No subscribers match"
                  body="Try clearing the search or switching the filter."
                />
              )
            )}
            {filtered.map((sub) => (
              <button
                key={sub.id}
                type="button"
                className={styles.row}
                onClick={() => navigate(`/dashboard/subscribers/${sub.id}`)}
              >
                <span className={styles.avatar} data-gender={sub.gender} aria-hidden="true">{getInitials(sub.name)}</span>
                <div className={styles.rowBody}>
                  <div className={styles.rowName}>
                    <span>{sub.name}</span>
                  </div>
                  <div className={styles.rowMeta}>
                    <span>{sub.phone}</span>
                    <span aria-hidden="true">·</span>
                    <StatusPill status={sub.isActive ? 'active' : 'dormant'} />
                  </div>
                </div>
                <div className={styles.rowAmount}>
                  <span className={styles.rowAmountValue}>{formatUGX(sub.totalContributions)}</span>
                  <span className={styles.rowAmountLabel}>contributed</span>
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
