// Pure employee-analytics derivation for the employer Analytics view. Takes the
// roster (from `useEmployees`) + the pre-aggregated `useEmployerMetrics`, and
// returns KPIs + chart-ready distributions (gender, age, status, monthly
// compensation, occupation, headcount growth, coverage). Also builds the rows/columns for the
// CSV / Excel downloads. No React, no data imports — unit-testable in isolation.

import { groupInsuranceProducts } from '../../utils/groupInsurance';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const AGE_BUCKETS = [
  { key: '18–24', min: 18, max: 24 },
  { key: '25–34', min: 25, max: 34 },
  { key: '35–44', min: 35, max: 44 },
  { key: '45–54', min: 45, max: 54 },
  { key: '55+', min: 55, max: Infinity },
];

const SAVING_BUCKETS = [
  { key: '<50k', min: 0, max: 49999 },
  { key: '50–100k', min: 50000, max: 99999 },
  { key: '100–150k', min: 100000, max: 149999 },
  { key: '150–200k', min: 150000, max: 199999 },
  { key: '200k+', min: 200000, max: Infinity },
];

export function titleCase(s) {
  if (!s) return '—';
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

function monthLabel(year, monthIndex0) {
  return `${MONTHS[monthIndex0]} ${String(year).slice(2)}`;
}

/**
 * @param {object[]} employees roster from useEmployees(employerId)
 */
export function deriveEmployeeAnalytics(employees = [], insConfig = {}) {
  const roster = Array.isArray(employees) ? employees : [];
  const total = roster.length;
  const active = roster.filter((e) => e.status === 'active').length;
  const suspended = roster.filter((e) => e.status === 'suspended').length;

  // Insurance is company-wide (all-or-nothing), never per-member — derive the
  // group cover from the employer config, not from a per-member `insuranceStatus`.
  // Multi-product (Life / Health / Funeral): sum the per-member cover across ALL
  // enabled products, not just the legacy life-only groupCoverAmount.
  const insProducts = groupInsuranceProducts(insConfig);
  const insuranceEnabled = insProducts.length > 0;
  const groupCover = insProducts.reduce((s, p) => s + p.cover, 0);

  const ages = roster.map((e) => Number(e.age)).filter((a) => Number.isFinite(a) && a > 0);
  const avgAge = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0;

  // v2: members no longer self-set a saving amount — `compensation` is the
  // driver field (it powers contribution runs), so the "monthly" KPIs/bucket
  // now reflect monthly compensation, not the vestigial monthlyContribution.
  const totalMonthly = roster.reduce((s, e) => s + (Number(e.compensation) || 0), 0);
  const avgMonthly = total ? Math.round(totalMonthly / total) : 0;

  // Gender — largest slice first.
  const genderMap = new Map();
  for (const e of roster) {
    const g = (e.gender || 'unknown').toLowerCase();
    genderMap.set(g, (genderMap.get(g) || 0) + 1);
  }
  const gender = [...genderMap.entries()]
    .map(([key, value]) => ({ key, name: titleCase(key), value }))
    .sort((a, b) => b.value - a.value);

  // Age — fixed buckets (always present so the axis is stable).
  const age = AGE_BUCKETS.map((b) => ({
    key: b.key,
    value: ages.filter((a) => a >= b.min && a <= b.max).length,
  }));

  // Status — keep both rows for a legible legend even at zero.
  const status = [
    { key: 'active', name: 'Active', value: active },
    { key: 'suspended', name: 'Inactive', value: suspended },
  ];

  // Monthly compensation — fixed UGX buckets (v2: compensation drives runs).
  // The returned key stays `saving` so consumers (EmployerReports, tests) keep
  // their stable object-key contract; only the underlying value source and the
  // UI-facing labels move from monthlyContribution → compensation.
  const saving = SAVING_BUCKETS.map((b) => ({
    key: b.key,
    value: roster.filter((e) => {
      const m = Number(e.compensation) || 0;
      return m >= b.min && m <= b.max;
    }).length,
  }));

  // Occupation — top roles (horizontal bar). "—" for missing.
  const occMap = new Map();
  for (const e of roster) {
    const o = e.occupation ? String(e.occupation) : '—';
    occMap.set(o, (occMap.get(o) || 0) + 1);
  }
  const occupation = [...occMap.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Headcount growth — cumulative by join month.
  const byMonth = new Map();
  for (const e of roster) {
    if (!e.joinedDate) continue;
    const d = new Date(e.joinedDate);
    if (Number.isNaN(d.getTime())) continue;
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(ym, (byMonth.get(ym) || 0) + 1);
  }
  let cum = 0;
  const growth = [...byMonth.keys()].sort().map((ym) => {
    const joined = byMonth.get(ym);
    cum += joined;
    const [y, m] = ym.split('-');
    return { key: ym, label: monthLabel(Number(y), Number(m) - 1), joined, total: cum };
  });

  const activePct = total ? Math.round((active / total) * 100) : 0;

  return {
    isEmpty: total === 0,
    kpis: {
      total, active, suspended, avgAge,
      avgMonthly, totalMonthly,
      activePct,
    },
    gender,
    age,
    status,
    saving,
    occupation,
    growth,
    // Company-wide group insurance (not a per-member rate).
    coverage: { enabled: insuranceEnabled, cover: groupCover },
  };
}

// ── Download builders ────────────────────────────────────────────────────────
// All return { rows, columns } in the shape downloadCsv / downloadSheet expect
// (columns: [{ key, label }], rows: [{ [key]: value }]).

export function buildRosterExport(employees = []) {
  // Per-member insurance columns are intentionally omitted: insurance is a
  // company-wide all-or-nothing benefit (see buildSummaryExport's group-cover
  // block), so a per-row cover/status would misrepresent the model. The
  // own/employer/total contribution columns are likewise dropped — they're
  // mock-only fields that `mapMember` never populates from live Supabase.
  // v2: `compensation` is a real Supabase column (NOT NULL DEFAULT 0) and the
  // driver field for contribution runs, so it replaces the vestigial
  // monthlyContribution as the "Monthly compensation" column.
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'gender', label: 'Gender' },
    { key: 'age', label: 'Age' },
    { key: 'occupation', label: 'Occupation' },
    { key: 'status', label: 'Status' },
    { key: 'kyc', label: 'KYC' },
    { key: 'compensation', label: 'Monthly compensation (UGX)' },
    { key: 'joinedDate', label: 'Joined' },
  ];
  const rows = employees.map((e) => ({
    name: e.name ?? '',
    phone: e.phone ?? '',
    email: e.email ?? '',
    gender: titleCase(e.gender),
    age: e.age ?? '',
    occupation: e.occupation ?? '',
    status: titleCase(e.status),
    kyc: titleCase(e.kycStatus),
    compensation: Number(e.compensation) || 0,
    joinedDate: e.joinedDate ? String(e.joinedDate).slice(0, 10) : '',
  }));
  return { rows, columns };
}

/** A flat "metric · category · count · percent" table of every distribution. */
export function buildSummaryExport(analytics) {
  const columns = [
    { key: 'metric', label: 'Metric' },
    { key: 'category', label: 'Category' },
    { key: 'count', label: 'Count' },
    { key: 'percent', label: 'Percent' },
  ];
  const total = analytics.kpis.total || 0;
  const pct = (n) => (total ? `${Math.round((n / total) * 100)}%` : '0%');
  const rows = [];
  const push = (metric, items, labelKey = 'name') => {
    for (const it of items) {
      rows.push({ metric, category: it[labelKey] ?? it.key, count: it.value, percent: pct(it.value) });
    }
  };
  push('Gender', analytics.gender);
  push('Age', analytics.age, 'key');
  push('Status', analytics.status);
  push('Monthly compensation', analytics.saving, 'key');
  push('Occupation', analytics.occupation, 'label');

  // Company-wide group insurance — a single summary block, never per-member.
  const cov = analytics.coverage || {};
  if (cov.enabled && cov.cover > 0) {
    rows.push({ metric: 'Group cover', category: 'Covered (all staff)', count: total, percent: '100%' });
    rows.push({ metric: 'Group cover', category: 'Cover per member (UGX)', count: cov.cover, percent: '' });
  } else {
    rows.push({ metric: 'Group cover', category: 'Not set up', count: 0, percent: '0%' });
  }

  return { rows, columns };
}

export function buildRunsExport(runs = []) {
  const columns = [
    { key: 'period', label: 'Period' },
    { key: 'date', label: 'Run date' },
    { key: 'employee', label: 'Employee total (UGX)' },
    { key: 'employer', label: 'Employer total (UGX)' },
    { key: 'insurance', label: 'Insurance premium (UGX)' },
    { key: 'grand', label: 'Grand total (UGX)' },
  ];
  const rows = runs.map((r) => ({
    period: r.periodLabel ?? '',
    date: r.runAt ? String(r.runAt).slice(0, 10) : '',
    employee: Number(r.employeeTotal ?? r.employee_total ?? 0) || 0,
    employer: Number(r.employerTotal ?? r.employer_total ?? 0) || 0,
    insurance: Number(r.insuranceTotal ?? r.insurance_total ?? 0) || 0,
    grand: Number(r.grandTotal ?? r.grand_total ?? 0) || 0,
  }));
  return { rows, columns };
}
