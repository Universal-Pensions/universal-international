// Pure subscriber-analytics derivation for the Reports analytics dashboard.
// Takes the current subscriber summary (from `useCurrentSubscriber`) plus the
// dated transactions feed (from `useSubscriberTransactions`) and returns KPIs +
// chart-ready series (cumulative balance growth, contributions by month). Also
// builds the rows/columns for the CSV / Excel downloads. No React, no data
// imports — unit-testable in isolation. Mirrors
// employer-dashboard/reports/deriveEmployeeAnalytics.js.
//
// Money math notes:
//   - Contributions are positive amounts; withdrawals arrive as NEGATIVE
//     numbers (the service maps withdrawal magnitudes to -abs for display).
//   - Premiums ('premium' type) are insurance payments and do NOT touch the
//     savings balance (mirrors the balance trigger / applyMutations), so they
//     are excluded from the balance series and the "total contributed" KPI.
//   - The balance series is the CUMULATIVE closing balance at each month end,
//     anchored to the LATEST dated transaction (the seed is MOCK_NOW-anchored,
//     so building the axis from `new Date()` would drift away from the data).

import { activeCoverTotal, activePolicies } from '../../utils/policies';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Apr 26" — a compact month/year axis label. */
function monthLabel(year, monthIndex0) {
  return `${MONTHS[monthIndex0]} ${String(year).slice(2)}`;
}

/** Parse a transaction's date to a Date, or null when missing/invalid. */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `YYYY-MM` key for month bucketing. */
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Title-case a single token, guarding empties. */
export function titleCase(s) {
  if (!s) return '—';
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

/**
 * Build a contiguous list of `YYYY-MM` keys from the earliest to the latest
 * dated transaction (inclusive), so the month axis has no gaps even when a
 * month had zero activity. Anchored to the data, never the wall clock.
 *
 * @param {Date} from earliest dated transaction
 * @param {Date} to latest dated transaction (the anchor)
 */
function monthRange(from, to) {
  const keys = [];
  let y = from.getFullYear();
  let m = from.getMonth();
  const endY = to.getFullYear();
  const endM = to.getMonth();
  // Guard against a pathological (reversed) range — at most ~10 years of months.
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 240) {
    keys.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    guard += 1;
  }
  return keys;
}

/**
 * @param {object} subscriber summary from useCurrentSubscriber()
 * @param {object[]} transactions dated feed from useSubscriberTransactions(id)
 */
export function deriveSubscriberAnalytics(subscriber, transactions = []) {
  const sub = subscriber || {};
  const feed = Array.isArray(transactions) ? transactions : [];

  // ── KPI inputs ──────────────────────────────────────────────────────────
  const netBalance = Number(sub.netBalance) || 0;
  const retirementBalance = Number(sub.retirementBalance) || 0;
  const emergencyBalance = Number(sub.emergencyBalance) || 0;
  const unitsHeld = Number(sub.unitsHeld) || 0;
  const currentUnitValue = Number(sub.currentUnitValue) || 0;
  // Cover / premium / status across ALL active products (life + health +
  // funeral), summed from the derived policies, so Analytics agrees with the
  // Policies page and Home rather than showing the life-only row.
  const cover = activeCoverTotal(sub);
  const activeIns = activePolicies(sub);
  const insuranceStatus = activeIns.length > 0 ? 'active' : 'inactive';
  const premiumMonthly = activeIns.reduce((s, p) => s + (Number(p.premiumMonthly) || 0), 0);

  // ── Month bucketing over the dated feed ─────────────────────────────────
  // contributions: positive 'contribution' rows; net signed delta: every row
  // that moves the savings balance ('contribution' +, 'withdrawal' -). Premiums
  // are excluded from both (they pay insurance, not the savings pot).
  const contribByMonth = new Map(); // ym → summed contribution amount
  const deltaByMonth = new Map(); // ym → summed signed savings delta
  let earliest = null;
  let latest = null;
  let totalContributed = 0;

  for (const t of feed) {
    const d = parseDate(t.date);
    if (!d) continue;
    if (earliest == null || d < earliest) earliest = d;
    if (latest == null || d > latest) latest = d;
    const ym = monthKey(d);
    const amount = Number(t.amount) || 0;

    if (t.type === 'contribution') {
      const c = Math.abs(amount);
      contribByMonth.set(ym, (contribByMonth.get(ym) || 0) + c);
      deltaByMonth.set(ym, (deltaByMonth.get(ym) || 0) + c);
      totalContributed += c;
    } else if (t.type === 'withdrawal') {
      // Already negative in the feed; treat defensively either way.
      const delta = amount > 0 ? -amount : amount;
      deltaByMonth.set(ym, (deltaByMonth.get(ym) || 0) + delta);
    }
    // 'premium' / 'claim' / anything else → no balance impact.
  }

  const hasDatedFeed = earliest != null && latest != null;
  const months = hasDatedFeed ? monthRange(earliest, latest) : [];

  // Contributions-by-month bar series (one bar per month in the range).
  const contributionSeries = months.map((ym) => {
    const [y, m] = ym.split('-');
    return {
      key: ym,
      label: monthLabel(Number(y), Number(m) - 1),
      value: Math.round(contribByMonth.get(ym) || 0),
    };
  });

  // Cumulative balance-growth series. We know the CURRENT net balance (the
  // authoritative snapshot) and the per-month signed deltas, so we walk the
  // months forward from a derived opening balance such that the final month's
  // closing balance equals `netBalance`. opening = netBalance − Σ(all deltas).
  const totalDelta = [...deltaByMonth.values()].reduce((s, v) => s + v, 0);
  let running = netBalance - totalDelta;
  const balanceSeries = months.map((ym) => {
    const [y, m] = ym.split('-');
    running += deltaByMonth.get(ym) || 0;
    return {
      key: ym,
      label: monthLabel(Number(y), Number(m) - 1),
      value: Math.max(0, Math.round(running)),
    };
  });

  const isEmpty = months.length === 0;

  return {
    isEmpty,
    kpis: {
      netBalance,
      retirementBalance,
      emergencyBalance,
      unitsHeld,
      currentUnitValue,
      totalContributed: Math.round(totalContributed),
      cover,
      insuranceStatus,
      premiumMonthly,
      txnCount: feed.length,
      monthsTracked: months.length,
    },
    balanceSeries,
    contributionSeries,
  };
}

// ── Download builders ────────────────────────────────────────────────────────
// All return { rows, columns } in the shape downloadCsv / downloadSheet expect
// (columns: [{ key, label }], rows: [{ [key]: value }]). Every column.key MUST
// resolve to a defined cell on every row, or the .xlsx export goes blank (the
// {key,label}-vs-string [object Object] trap — see utils/xlsx.js).

/** A flat per-transaction table (date · type · source · amount · method · ref · status). */
export function buildTransactionsExport(transactions = []) {
  const feed = Array.isArray(transactions) ? transactions : [];
  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type' },
    { key: 'source', label: 'Source' },
    { key: 'amount', label: 'Amount (UGX)' },
    { key: 'method', label: 'Method' },
    { key: 'reference', label: 'Reference' },
    { key: 'status', label: 'Status' },
  ];
  const rows = feed.map((t) => ({
    date: t.date ? String(t.date).slice(0, 10) : '',
    type: titleCase(t.type),
    source: titleCase(t.source || 'own'),
    amount: Number(t.amount) || 0,
    method: t.method ?? '',
    reference: t.reference ?? '',
    status: titleCase(t.status),
  }));
  return { rows, columns };
}

/** A month-by-month contributions summary (month · contributions · closing balance). */
export function buildContributionsExport(analytics) {
  const a = analytics || {};
  const contrib = Array.isArray(a.contributionSeries) ? a.contributionSeries : [];
  const balance = Array.isArray(a.balanceSeries) ? a.balanceSeries : [];
  const balanceByKey = new Map(balance.map((b) => [b.key, b.value]));
  const columns = [
    { key: 'month', label: 'Month' },
    { key: 'contributions', label: 'Contributions (UGX)' },
    { key: 'closingBalance', label: 'Closing balance (UGX)' },
  ];
  const rows = contrib.map((c) => ({
    month: c.label,
    contributions: Number(c.value) || 0,
    closingBalance: Number(balanceByKey.get(c.key)) || 0,
  }));
  return { rows, columns };
}
