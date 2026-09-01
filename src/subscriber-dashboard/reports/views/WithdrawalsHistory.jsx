import { useMemo, useState } from 'react';
import { useCurrentSubscriber, useSubscriberWithdrawals } from '../../../hooks/useSubscriber';
import { formatUGX } from '../../../utils/currency';

import { formatDate } from '../../../utils/date';
import { downloadCSV } from '../../../utils/csv';
import ReportTable from '../../../components/reports/ReportTable';
import FilterSelect from '../../../components/reports/FilterSelect';
import ErrorCard from '../../../components/feedback/ErrorCard';
import ExportButton from '../../../components/reports/ExportButton';
import SkeletonRow from '../../../components/SkeletonRow';
import EmptyState from '../../../components/EmptyState';
import frameStyles from './ReportFrame.module.css';

const BUCKET_OPTIONS = [
  { value: 'emergency', label: 'Emergency' },
  { value: 'retirement', label: 'Retirement' },
];

// 0147: two states a withdrawal can now end in. Without them a rejected
// redemption sits in the member's history reading "Processing" forever.
const STATUS_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'processing', label: 'Processing' },
  { value: 'rejected', label: 'Not completed' },
  { value: 'reversed', label: 'Reversed' },
];

const STATUS_LABELS = {
  paid: 'Paid',
  processing: 'Processing',
  // Plain language: a member should not have to work out what "rejected"
  // means about their own money. It was not completed, and they can ask again.
  rejected: 'Not completed',
  reversed: 'Reversed',
};

function statusLabel(status) {
  return STATUS_LABELS[status]
    || String(status ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function pillTone(status) {
  if (status === 'paid') return 'ok';
  // 'alert' is the tone ReportFrame.module.css actually defines; 'warn' is not
  // one of them and renders an unstyled pill.
  if (status === 'rejected' || status === 'reversed') return 'alert';
  return 'pending';
}

export default function WithdrawalsHistory() {
  const { data: sub, isLoading, isError, error, refetch } = useCurrentSubscriber();
  const { data: withdrawals = [] } = useSubscriberWithdrawals(sub?.id);

  const [bucketFilter, setBucketFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = useMemo(() => {
    let rows = withdrawals;
    if (bucketFilter) rows = rows.filter((w) => w.bucket === bucketFilter);
    if (statusFilter) rows = rows.filter((w) => w.status === statusFilter);
    return rows;
  }, [withdrawals, bucketFilter, statusFilter]);

  const totals = useMemo(() => {
    let total = 0, retirement = 0, emergency = 0;
    filtered.forEach((w) => {
      // A rejected or reversed withdrawal is money the member still has. Unlike
      // the transactions ledger there is NO compensating row in this table to
      // net it off, so both states must come out of the totals — while the rows
      // themselves stay visible in the table and in the status filter. Without
      // this the KPI counts money out on the same screen where that row's own
      // pill reads "Not completed".
      if (w.status === 'rejected' || w.status === 'reversed') return;
      total += w.amount;
      if (w.bucket === 'retirement') retirement += w.amount;
      else emergency += w.amount;
    });
    return { total, retirement, emergency };
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
      key: 'amount',
      label: 'Amount',
      sortable: true,
      align: 'right',
      render: (row) => formatUGX(row.amount, { compact: false }),
    },
    {
      key: 'bucket',
      label: 'Bucket',
      sortable: true,
      render: (row) => row.bucket.charAt(0).toUpperCase() + row.bucket.slice(1),
    },
    { key: 'reason', label: 'Reason', sortable: true },
    { key: 'method', label: 'Method', sortable: true },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => (
        <span className={frameStyles.pill} data-tone={pillTone(row.status)}>
          <span className={frameStyles.pillDot} />
          {statusLabel(row.status)}
        </span>
      ),
    },
  ];

  function handleExport() {
    const headers = ['Date', 'Amount (UGX)', 'Bucket', 'Reason', 'Method', 'Status'];
    const rows = filtered.map((w) => [w.date, w.amount, w.bucket, w.reason, w.method, w.status]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`withdrawals-${stamp}.csv`, headers, rows);
  }

  if (isError) {
    return (
      <ErrorCard
        title="We couldn't load your withdrawals"
        message={error}
        onRetry={refetch}
      />
    );
  }

  // Cold-load skeleton — keep the report frame anchored while data hydrates.
  if (isLoading && !sub) {
    return (
      <div className={frameStyles.frame}>
        <div className={frameStyles.headerRow}>
          <div className={frameStyles.headerText}>
            <span className={frameStyles.eyebrow}>Your withdrawals</span>
            <span className={frameStyles.headerDesc}>Loading…</span>
          </div>
        </div>
        <SkeletonRow count={6} label="Loading withdrawals" />
      </div>
    );
  }

  return (
    <div className={frameStyles.frame}>
      <div className={frameStyles.headerRow}>
        <div className={frameStyles.headerText}>
          <span className={frameStyles.eyebrow}>Your withdrawals</span>
          <span className={frameStyles.headerDesc}>{filtered.length} of {withdrawals.length} entries</span>
        </div>
        <ExportButton onExport={handleExport} />
      </div>

      <div className={frameStyles.kpiStrip}>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Total withdrawn</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.total)}</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>From emergency</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.emergency)}</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>From retirement</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.retirement)}</span>
        </div>
      </div>

      <div className={frameStyles.filters}>
        <FilterSelect label="Bucket" value={bucketFilter} onChange={setBucketFilter} options={BUCKET_OPTIONS} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
      </div>

      {filtered.length === 0 ? (
        // No withdrawals at all vs filtered down to zero — different prompts.
        withdrawals.length === 0 ? (
          <EmptyState
            kind="no-data"
            title="No withdrawals yet."
            body="Any withdrawals you make will be tracked here."
          />
        ) : (
          <EmptyState
            kind="no-match"
            title="No withdrawals match"
            body="Try adjusting your bucket or status filter."
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
