import { useMemo } from 'react';
import { useCurrentSubscriber, useSubscriberClaims } from '../../../hooks/useSubscriber';
import { formatUGX } from '../../../utils/currency';

import { formatDate } from '../../../utils/date';
import { downloadCSV } from '../../../utils/csv';
import ReportTable from '../../../components/reports/ReportTable';
import ErrorCard from '../../../components/feedback/ErrorCard';
import ExportButton from '../../../components/reports/ExportButton';
import SkeletonRow from '../../../components/SkeletonRow';
import EmptyState from '../../../components/EmptyState';
import frameStyles from './ReportFrame.module.css';

const CLAIM_TYPES = {
  medical: 'Medical',
  accident: 'Accident',
  hospitalization: 'Hospitalisation',
  critical_illness: 'Critical illness',
};

function statusTone(s) {
  if (s === 'paid' || s === 'approved') return 'ok';
  if (s === 'rejected') return 'alert';
  return 'pending';
}

export default function InsuranceStatement() {
  const { data: sub, isLoading, isError, error, refetch } = useCurrentSubscriber();
  const insurance = sub?.insurance || {};
  const { data: claims = [] } = useSubscriberClaims(sub?.id);
  // Both a self-paid annual premium ('premium') and a save-to-cover sweep
  // ('premium_sweep', stored NEGATIVE) count toward premiums paid on this cover.
  const premiumTx = useMemo(
    () => (sub?.transactions || []).filter((t) => t.type === 'premium' || t.type === 'premium_sweep'),
    [sub]
  );

  const totals = useMemo(() => {
    // Math.abs so a negative sweep magnitude ADDS to premiums paid, not subtracts.
    const premiumsPaid = premiumTx.reduce((s, t) => s + Math.abs(t.amount), 0);
    const claimsPaid = claims.filter((c) => c.status === 'paid').reduce((s, c) => s + c.amount, 0);
    return { premiumsPaid, claimsPaid, net: claimsPaid - premiumsPaid };
  }, [premiumTx, claims]);

  const claimColumns = [
    {
      key: 'submittedDate',
      label: 'Filed',
      sortable: true,
      render: (row) => formatDate(row.submittedDate),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      render: (row) => CLAIM_TYPES[row.type] || row.type,
    },
    {
      key: 'incidentDate',
      label: 'Incident',
      sortable: true,
      render: (row) => formatDate(row.incidentDate),
    },
    {
      key: 'amount',
      label: 'Claimed',
      sortable: true,
      align: 'right',
      render: (row) => formatUGX(row.amount, { compact: false }),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => (
        <span className={frameStyles.pill} data-tone={statusTone(row.status)}>
          <span className={frameStyles.pillDot} />
          {row.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </span>
      ),
    },
  ];

  function handleExport() {
    const headers = ['Filed', 'Type', 'Incident', 'Claimed (UGX)', 'Status', 'Description'];
    const rows = claims.map((c) => [
      c.submittedDate,
      CLAIM_TYPES[c.type] || c.type,
      c.incidentDate,
      c.amount,
      c.status,
      c.description || '',
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`insurance-statement-${stamp}.csv`, headers, rows);
  }

  if (isError) {
    return (
      <ErrorCard
        title="We couldn't load your insurance statement"
        message={error}
        onRetry={refetch}
      />
    );
  }

  // Cold-load skeleton — avoids the "Inactive · 0 / mo" flash before
  // policy data hydrates.
  if (isLoading && !sub) {
    return (
      <div className={frameStyles.frame}>
        <div className={frameStyles.headerRow}>
          <div className={frameStyles.headerText}>
            <span className={frameStyles.eyebrow}>Your coverage at a glance</span>
            <span className={frameStyles.headerDesc}>Loading…</span>
          </div>
        </div>
        <SkeletonRow count={5} label="Loading insurance statement" />
      </div>
    );
  }

  return (
    <div className={frameStyles.frame}>
      <div className={frameStyles.headerRow}>
        <div className={frameStyles.headerText}>
          <span className={frameStyles.eyebrow}>Your coverage at a glance</span>
          <span className={frameStyles.headerDesc}>Premiums, claims, and your current policy.</span>
        </div>
        <ExportButton onExport={handleExport} />
      </div>

      <div className={frameStyles.kpiStrip}>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Current cover</span>
          <span className={frameStyles.kpiValue}>{formatUGX(insurance.cover || 0)}</span>
          <span className={frameStyles.kpiSub}>
            {insurance.status === 'active' ? 'Active' : 'Inactive'} · {formatUGX((insurance.premiumMonthly || 0) * 12, { compact: false })} / yr
          </span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Premiums paid</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.premiumsPaid)}</span>
          <span className={frameStyles.kpiSub}>{premiumTx.length} payment{premiumTx.length !== 1 ? 's' : ''}</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Claims paid</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.claimsPaid)}</span>
          <span className={frameStyles.kpiSub}>{claims.length} filed</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Policy start</span>
          <span className={frameStyles.kpiValue}>{formatDate(insurance.policyStart)}</span>
          <span className={frameStyles.kpiSub}>Renews {formatDate(insurance.renewalDate)}</span>
        </div>
      </div>

      <section className={frameStyles.statSection}>
        <div className={frameStyles.statSectionTitle}>Claims history</div>
        {claims.length === 0 ? (
          <EmptyState
            kind="no-data"
            title="No claims filed yet."
            body="Any insurance claims you file will appear here for review."
          />
        ) : (
          <ReportTable
            columns={claimColumns}
            data={claims}
            defaultSort="submittedDate"
            defaultDir="desc"
            rowKey="id"
          />
        )}
      </section>
    </div>
  );
}
