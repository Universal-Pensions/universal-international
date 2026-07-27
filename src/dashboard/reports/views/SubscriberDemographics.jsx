import { useMemo } from 'react';
import {
  useAllEntities, useAllEntitiesMap, useChildren,
  useAllEntitiesMetrics, useChildrenMetrics,
} from '../../../hooks/useEntity';
import { useBranchScope } from '../../../contexts/BranchScopeContext';
import { formatNumber } from '../../../utils/currency';
import ReportView from '../ReportView';
import ReportTable from '../ReportTable';

export default function SubscriberDemographics({ onBack }) {
  const { branchId } = useBranchScope();
  const isBranch = !!branchId;
  const { data: districts = [], isLoading: loadingDistricts } = useAllEntities('district');
  const { data: branchAgents = [], isLoading: loadingAgents } = useChildren('branch', branchId);
  const { data: regionsMap = {} } = useAllEntitiesMap('region');

  // Identity rows carry EMPTY_METRICS; the aggregates come from the rollup.
  // Without this merge every gender/age/KYC column rendered 0 (see the twin fix
  // in SubscriberGrowth.jsx).
  const { data: districtMetricsMap = {} } = useAllEntitiesMetrics('district');
  const { data: agentMetricsMap = {} } = useChildrenMetrics('branch', branchId);
  const rows = useMemo(() => {
    const src = isBranch ? branchAgents : districts;
    const metricsMap = isBranch ? agentMetricsMap : districtMetricsMap;
    return src.map((r) => ({ ...r, metrics: metricsMap[r.id] ?? r.metrics }));
  }, [isBranch, branchAgents, districts, agentMetricsMap, districtMetricsMap]);

  const enriched = useMemo(() => rows.map((row) => {
    const region = isBranch ? null : regionsMap[row.parentId];
    const m = row.metrics || {};
    const totalAge = Object.values(m.ageDistribution || {}).reduce((s, v) => s + v, 0) || 1;
    const youthPct = Math.round(((m.ageDistribution?.['18-25'] || 0) + (m.ageDistribution?.['26-35'] || 0)) / totalAge * 100);
    return {
      ...row,
      regionName: region?.name || '',
      malePct: m.genderRatio?.male || 0,
      femalePct: m.genderRatio?.female || 0,
      otherPct: m.genderRatio?.other || 0,
      youthPct,
      age1825: m.ageDistribution?.['18-25'] || 0,
      age2635: m.ageDistribution?.['26-35'] || 0,
      age3645: m.ageDistribution?.['36-45'] || 0,
      age4655: m.ageDistribution?.['46-55'] || 0,
      age56plus: m.ageDistribution?.['56+'] || 0,
    };
  }), [rows, regionsMap, isBranch]);

  // CSV serialiser walks `row[col.key]` flatly. `totalSubscribers` lives in
  // `metrics.*` so project it up. The `gender` column has no row-level value
  // (renderer uses malePct/femalePct) — synthesise an "M/F" string for export.
  const exportRows = useMemo(() => enriched.map((r) => ({
    ...r,
    totalSubscribers: r.metrics?.totalSubscribers ?? 0,
    gender: `${r.malePct}/${r.femalePct}`,
  })), [enriched]);

  function GenderBar({ male, female }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ display: 'flex', width: 60, height: 6, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${male}%`, background: 'var(--color-indigo)' }} />
          <div style={{ width: `${female}%`, background: 'var(--color-teal)' }} />
          <div style={{ flex: 1, background: 'var(--color-lavender)' }} />
        </div>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-gray)', fontVariantNumeric: 'tabular-nums' }}>
          {male}/{female}
        </span>
      </div>
    );
  }

  const columns = [
    { key: 'name', label: isBranch ? 'Agent' : 'District', sortable: true, width: '160px' },
    !isBranch && { key: 'regionName', label: 'Region', sortable: true },
    {
      key: 'totalSubscribers',
      label: 'Subscribers',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.metrics?.totalSubscribers || 0,
      render: (row) => formatNumber(row.metrics?.totalSubscribers || 0),
    },
    {
      key: 'gender',
      label: 'Gender (M/F)',
      sortable: true,
      sortValue: (row) => row.malePct,
      render: (row) => <GenderBar male={row.malePct} female={row.femalePct} />,
    },
    {
      key: 'youthPct',
      label: 'Youth (18-35)',
      align: 'right',
      sortable: true,
      render: (row) => `${row.youthPct}%`,
    },
    {
      key: 'age1825',
      label: '18-25',
      align: 'right',
      sortable: true,
      render: (row) => formatNumber(row.age1825),
    },
    {
      key: 'age2635',
      label: '26-35',
      align: 'right',
      sortable: true,
      render: (row) => formatNumber(row.age2635),
    },
    {
      key: 'age3645',
      label: '36-45',
      align: 'right',
      sortable: true,
      render: (row) => formatNumber(row.age3645),
    },
    {
      key: 'age4655',
      label: '46-55',
      align: 'right',
      sortable: true,
      render: (row) => formatNumber(row.age4655),
    },
    {
      key: 'age56plus',
      label: '56+',
      align: 'right',
      sortable: true,
      render: (row) => formatNumber(row.age56plus),
    },
  ].filter(Boolean);

  return (
    <ReportView
      onBack={onBack}
      title="Subscriber Demographics"
      description={isBranch
        ? 'Age distribution and gender breakdown by agent'
        : 'Age distribution and gender breakdown by district'}
      exportRows={exportRows}
      exportColumns={columns}
      exportFilename="subscriber-demographics"
    >
      <ReportTable columns={columns} data={enriched} defaultSort="totalSubscribers" loading={isBranch ? loadingAgents : loadingDistricts} />
    </ReportView>
  );
}
