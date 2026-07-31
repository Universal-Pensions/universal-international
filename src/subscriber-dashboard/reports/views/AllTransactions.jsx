import { useState, useMemo } from 'react';
import { useCurrentSubscriber } from '../../../hooks/useSubscriber';
import { formatUGX } from '../../../utils/currency';
import { txDisplayAmount } from '../../../utils/finance';
import { isRunPosted } from '../../../utils/periodSettlement';
import { paidByLabel } from '../deriveSubscriberAnalytics';

import { formatDate } from '../../../utils/date';
import { downloadCSV } from '../../../utils/csv';
import ReportTable from '../../../components/reports/ReportTable';
import FilterSelect from '../../../components/reports/FilterSelect';
import SearchFilter from '../../../components/reports/SearchFilter';
import ErrorCard from '../../../components/feedback/ErrorCard';
import ExportButton from '../../../components/reports/ExportButton';
import SkeletonRow from '../../../components/SkeletonRow';
import EmptyState from '../../../components/EmptyState';
import frameStyles from './ReportFrame.module.css';

// Human labels per transaction type. Self-paid cover is ONE annual premium
// ('premium'); employer-funded group cover is monthly ('insurance_premium');
// save-to-cover sweeps savings into the annual premium ('premium_sweep'). These
// distinctions must show consistently in both the badge column and the filter.
const TYPE_LABELS = {
  contribution: 'Contribution',
  withdrawal: 'Withdrawal',
  premium: 'Insurance premium',
  insurance_premium: 'Employer cover premium',
  premium_sweep: 'Premium from savings',
  claim: 'Claim',
};

// The filter narrows rows by exact `type` value, so every real type gets an
// option (otherwise those rows are unreachable through the dropdown). The
// contribution badge splits three ways below (see `rowTypeLabel`) while the
// filter option stays the single `contribution` type, which still selects all
// three variants.
const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));

/**
 * The type badge, with contributions attributed to whoever actually paid. One
 * flat "Contribution" for every row hid the two-leg story completely:
 *   • source 'employer' → the employer leg, the company's own money.
 *   • run-posted 'own'  → the member's money, but deducted from their pay and
 *                         remitted by the employer's contribution run
 *                         (utils/periodSettlement isRunPosted) — the member made
 *                         no payment, so an unqualified "Contribution" next to a
 *                         "+" amount and the employer's payment method read as a
 *                         top-up they chose to make.
 *   • anything else     → a contribution the member paid themselves.
 */
function rowTypeLabel(row) {
  if (row.type === 'contribution') {
    if (row.source === 'employer') return 'Employer top-up';
    if (isRunPosted(row)) return 'From your pay';
    // Self-paid — keep the bare word so the badge still matches the "Contribution"
    // option in the Type filter that selects it.
    return TYPE_LABELS.contribution;
  }
  return TYPE_LABELS[row.type]
    || `${row.type.charAt(0).toUpperCase()}${row.type.slice(1).replace(/_/g, ' ')}`;
}

const STATUS_OPTIONS = [
  { value: 'settled', label: 'Settled' },
  { value: 'paid', label: 'Paid' },
  { value: 'processing', label: 'Processing' },
];

function pillTone(status) {
  if (status === 'paid' || status === 'settled') return 'ok';
  if (status === 'processing' || status === 'submitted' || status === 'under_review') return 'pending';
  return 'ok';
}

export default function AllTransactions() {
  const { data: sub, isLoading, isError, error, refetch } = useCurrentSubscriber();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const transactions = useMemo(() => sub?.transactions || [], [sub?.transactions]);

  const filtered = useMemo(() => {
    let rows = transactions;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((t) =>
        (t.reference || '').toLowerCase().includes(q) ||
        (t.method || '').toLowerCase().includes(q) ||
        (t.type || '').toLowerCase().includes(q)
      );
    }
    if (typeFilter) rows = rows.filter((t) => t.type === typeFilter);
    if (statusFilter) rows = rows.filter((t) => t.status === statusFilter);
    return rows;
  }, [transactions, search, typeFilter, statusFilter]);

  const totals = useMemo(() => {
    let inflow = 0, outflow = 0;
    filtered.forEach((t) => {
      // Sign from txDisplayAmount so premiums (stored positive) count as outflow.
      const signed = txDisplayAmount(t);
      if (signed > 0) inflow += signed;
      else outflow += Math.abs(signed);
    });
    return { inflow, outflow, net: inflow - outflow };
  }, [filtered]);

  const columns = [
    {
      key: 'date',
      label: 'Date',
      sortable: true,
      width: '110px',
      render: (row) => formatDate(row.date),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      // data-type stays the raw type so the badge keeps its per-type colour in
      // ReportFrame.module.css; only the wording is attributed.
      render: (row) => (
        <span className={frameStyles.typeBadge} data-type={row.type}>
          {rowTypeLabel(row)}
        </span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      sortable: true,
      sortValue: (row) => txDisplayAmount(row),
      render: (row) => {
        const signed = txDisplayAmount(row);
        return (
          <span className={signed >= 0 ? frameStyles.amountPositive : frameStyles.amountNegative}>
            {signed >= 0 ? '+' : '−'}{formatUGX(Math.abs(signed), { compact: false })}
          </span>
        );
      },
    },
    {
      key: 'method',
      label: 'Method',
      sortable: true,
      render: (row) => row.method || '—',
    },
    {
      key: 'reference',
      label: 'Reference',
      sortable: false,
      render: (row) => row.reference || '—',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => (
        <span className={frameStyles.pill} data-tone={pillTone(row.status)}>
          <span className={frameStyles.pillDot} />
          {row.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </span>
      ),
    },
  ];

  function handleExport() {
    // "Paid by" carries the same attribution as the on-screen badge, so a member
    // who downloads the report can still tell their own payments from the pay
    // deductions and top-ups their employer remitted. It shares `paidByLabel` with
    // the analytics export so both downloads word it identically. The Type column
    // keeps the raw machine value (it is what the filter matches on).
    const headers = ['Date', 'Type', 'Paid by', 'Amount (UGX)', 'Method', 'Reference', 'Status'];
    const rows = filtered.map((t) => [
      t.date,
      t.type,
      paidByLabel(t),
      t.amount,
      t.method || '',
      t.reference || '',
      t.status,
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`transactions-${stamp}.csv`, headers, rows);
  }

  if (isError) {
    return (
      <ErrorCard
        title="We couldn't load your transactions"
        message={error}
        onRetry={refetch}
      />
    );
  }

  // Cold-load skeleton — shows the frame chrome with placeholder rows
  // instead of a blank report that would otherwise read as "no data".
  if (isLoading && !sub) {
    return (
      <div className={frameStyles.frame}>
        <div className={frameStyles.headerRow}>
          <div className={frameStyles.headerText}>
            <span className={frameStyles.eyebrow}>Every movement in your account</span>
            <span className={frameStyles.headerDesc}>Loading transactions…</span>
          </div>
        </div>
        <SkeletonRow count={8} label="Loading transactions" />
      </div>
    );
  }

  return (
    <div className={frameStyles.frame}>
      <div className={frameStyles.headerRow}>
        <div className={frameStyles.headerText}>
          <span className={frameStyles.eyebrow}>Every movement in your account</span>
          <span className={frameStyles.headerDesc}>{filtered.length} of {transactions.length} transactions</span>
        </div>
        <ExportButton onExport={handleExport} />
      </div>

      <div className={frameStyles.kpiStrip}>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Money in</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.inflow)}</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Money out</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.outflow)}</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Net</span>
          <span className={frameStyles.kpiValue}>{formatUGX(Math.max(0, totals.net))}</span>
        </div>
      </div>

      <div className={frameStyles.filters}>
        <SearchFilter value={search} onChange={setSearch} placeholder="Search by type or method…" />
        <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter} options={TYPE_OPTIONS} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
      </div>

      {filtered.length === 0 ? (
        // Differentiate "you have no transactions yet" from "you filtered too
        // hard". Either way we keep the filters visible above this card so the
        // user can adjust without scrolling.
        transactions.length === 0 ? (
          <EmptyState
            kind="no-data"
            title="No transactions yet."
            body="Once your first contribution clears, it'll show up here."
          />
        ) : (
          <EmptyState
            kind="no-match"
            title="No transactions match"
            body="Try adjusting your search or filters."
          />
        )
      ) : (
        <ReportTable
          columns={columns}
          data={filtered}
          defaultSort="date"
          defaultDir="desc"
          rowKey="id"
        />
      )}
    </div>
  );
}
