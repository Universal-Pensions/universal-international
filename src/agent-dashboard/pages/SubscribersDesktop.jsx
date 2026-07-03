import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentSubscribers } from '../../hooks/useAgent';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import ReportTable from '../../components/reports/ReportTable';
import SearchFilter from '../../components/reports/SearchFilter';
import FilterSelect from '../../components/reports/FilterSelect';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import EmptyState from '../../components/EmptyState';
import SkeletonRow from '../../components/SkeletonRow';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './SubscribersDesktop.module.css';

// Status filter chips. The empty id ('all') maps to "no filter" so the chip
// group + the data branch agree on what an unfiltered view means.
const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'dormant', label: 'Dormant' },
];

function StatusPill({ active }) {
  return (
    <span className={styles.statusPill} data-tone={active ? 'active' : 'dormant'}>
      <span className={styles.statusDot} aria-hidden="true" />
      {active ? 'Active' : 'Dormant'}
    </span>
  );
}

/**
 * SubscribersDesktop — the ≥1024px agent "My subscribers" tab-root.
 *
 * Tab-root, so the page body owns a PLAIN <h1> (no back chevron, no hero dome —
 * those belong to PageHeader on sub-pages). The desktop top bar renders no <h1>.
 *
 * The shipped mobile list (card rows + hero capsule) is left untouched; this is
 * a denser table-first surface that suits a wide viewport: a search field + a
 * status chip group above a sortable ReportTable.
 *
 * ReportTable owns its own loading spinner + "No data available" empty state,
 * neither of which is customisable. To keep the shared SkeletonRow / EmptyState
 * look, we branch OUTSIDE the table on the query: SkeletonRow while loading,
 * EmptyState when the (post-filter) list is empty, else the table.
 */
export default function SubscribersDesktop() {
  const navigate = useNavigate();
  const { agentId } = useAgentScope();
  const { data: subscribers = [], isLoading, isError, error, refetch } =
    useAgentSubscribers(agentId);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  const counts = useMemo(() => {
    const active = subscribers.filter((s) => s.isActive).length;
    return {
      all: subscribers.length,
      active,
      dormant: subscribers.length - active,
    };
  }, [subscribers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subscribers.filter((s) => {
      if (status === 'active' && !s.isActive) return false;
      if (status === 'dormant' && s.isActive) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.id.toLowerCase().includes(q) &&
        !(s.phone || '').includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [subscribers, status, search]);

  // Columns. `name` deliberately has NO custom render so the cell renders as
  // plain text and getByText(name) resolves in tests. Numeric columns carry a
  // sortValue so ReportTable sorts on the raw number, not the formatted string.
  const columns = useMemo(
    () => [
      { key: 'name', label: 'Name', sortable: true, width: '200px' },
      { key: 'phone', label: 'Phone', sortable: true },
      {
        key: 'isActive',
        label: 'Status',
        sortable: true,
        sortValue: (row) => (row.isActive ? 1 : 0),
        render: (row) => <StatusPill active={row.isActive} />,
      },
      {
        key: 'totalContributions',
        label: 'Total contributions',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.totalContributions || 0,
        render: (row) => formatUGX(row.totalContributions || 0),
      },
      // NB: no Balance (netBalance) column — the agent must NOT see a
      // subscriber's current balance / net wealth (invariant in
      // SubscriberDetailPage.jsx). Lifetime contributions is an engagement
      // figure the mobile list also surfaces, so it stays.
      {
        key: 'registeredDate',
        label: 'Registered',
        align: 'right',
        sortable: true,
        render: (row) => formatDate(row.registeredDate),
      },
    ],
    [],
  );

  const loading = isLoading && subscribers.length === 0;
  // Active % — surfaced in the subtitle to match the mobile hero stat row.
  const activePct = counts.all ? Math.round((counts.active / counts.all) * 100) : 0;
  const isEmpty = !loading && !isError && filtered.length === 0;
  // Distinguish a genuinely empty portfolio from a filtered-to-zero view so the
  // copy is honest (mirrors the mobile page's no-data vs no-match split).
  const isUnfiltered = search.trim() === '' && status === 'all';

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>YOUR PORTFOLIO</p>
        <h1 className={styles.title}>My subscribers</h1>
        <p className={styles.subtitle}>
          {loading
            ? 'Loading your portfolio…'
            : `${counts.all} subscribers · ${counts.active} active · ${counts.dormant} dormant · ${activePct}% active`}
        </p>
      </header>

      <div className={styles.toolbar}>
        <SearchFilter
          value={search}
          onChange={setSearch}
          placeholder="Search by name, ID or phone…"
        />
        <PillChipGroup
          label="Filter subscribers"
          layout="row"
          className={styles.statusFilters}
        >
          {STATUS_FILTERS.map((f) => (
            <PillChip
              key={f.id}
              selected={status === f.id}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
              <span className={styles.filterCount}>{counts[f.id]}</span>
            </PillChip>
          ))}
        </PillChipGroup>
      </div>

      <div className={styles.tableArea}>
        {loading && (
          <SkeletonRow count={8} label="Loading your subscribers" />
        )}
        {isError && !isLoading && (
          <ErrorCard
            title="We couldn't load your subscribers"
            message={error}
            onRetry={refetch}
          />
        )}
        {isEmpty && (
          isUnfiltered ? (
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
        {!loading && !isError && filtered.length > 0 && (
          <ReportTable
            columns={columns}
            data={filtered}
            defaultSort="totalContributions"
            defaultDir="desc"
            onRowClick={(row) => navigate(`/dashboard/subscribers/${row.id}`)}
          />
        )}
      </div>
    </div>
  );
}
