import { useMemo } from 'react';
import { useCurrentSubscriber, useSubscriberClaims } from '../../../hooks/useSubscriber';
import { formatUGX } from '../../../utils/currency';
import { activeCoverTotal, activePolicies } from '../../../utils/policies';

import { formatDate } from '../../../utils/date';
import { downloadCSV } from '../../../utils/csv';
import ReportTable from '../../../components/reports/ReportTable';
import ErrorCard from '../../../components/feedback/ErrorCard';
import ExportButton from '../../../components/reports/ExportButton';
import SkeletonRow from '../../../components/SkeletonRow';
import EmptyState from '../../../components/EmptyState';
import { claimTypeLabel, claimStatusMeta } from '../../../constants/claims';
import frameStyles from './ReportFrame.module.css';

// Claim labels + status tones come from src/constants/claims.js. This file used
// to hold its own copy of the incident-category map — one of three copies, all
// of which predated the life / hospital-cash / funeral catalogue.

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

  // "Current cover" = total ACTIVE cover + annual premium across ALL products
  // (life + health + funeral), not the legacy life-only `sub.insurance` — a member
  // holding only health/funeral cover must not read "UGX 0 · Inactive" while covered.
  const activeIns = activePolicies(sub);
  const coverTotal = activeCoverTotal(sub);
  const coverPremiumAnnual = activeIns.reduce((s, p) => s + (Number(p.premiumMonthly) || 0), 0) * 12;
  const coverActive = coverTotal > 0;
  // Policy start / renewal from the primary active policy (product-ordered: life
  // first when held), falling back to the legacy life record for pre-0063 reads.
  const primaryPolicy = activeIns[0] ?? null;
  const policyStart = primaryPolicy?.policyStart ?? insurance.policyStart;
  const renewalDate = primaryPolicy?.renewalDate ?? insurance.renewalDate;

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
      render: (row) => claimTypeLabel(row),
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
        <span className={frameStyles.pill} data-tone={claimStatusMeta(row.status).tone}>
          <span className={frameStyles.pillDot} />
          {claimStatusMeta(row.status).label}
        </span>
      ),
    },
  ];

  function handleExport() {
    const headers = ['Filed', 'Type', 'Incident', 'Claimed (UGX)', 'Status', 'Description'];
    const rows = claims.map((c) => [
      c.submittedDate,
      claimTypeLabel(c),
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
          <span className={frameStyles.kpiValue}>{formatUGX(coverTotal)}</span>
          <span className={frameStyles.kpiSub}>
            {coverActive ? 'Active' : 'Inactive'} · {formatUGX(coverPremiumAnnual, { compact: false })} / yr
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
          <span className={frameStyles.kpiValue}>{formatDate(policyStart)}</span>
          <span className={frameStyles.kpiSub}>Renews {formatDate(renewalDate)}</span>
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
