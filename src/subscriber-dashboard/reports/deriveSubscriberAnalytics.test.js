import { describe, it, expect } from 'vitest';
import {
  deriveSubscriberAnalytics,
  buildTransactionsExport,
  buildContributionsExport,
  titleCase,
} from './deriveSubscriberAnalytics';

// A subscriber summary in the shape useCurrentSubscriber() delivers (camelCase,
// flat). netBalance is the authoritative snapshot the balance series anchors to.
const SUB = {
  netBalance: 250000,
  retirementBalance: 200000,
  emergencyBalance: 50000,
  unitsHeld: 250,
  currentUnitValue: 1000,
  insurance: { cover: 5000000, status: 'active', premiumMonthly: 12000 },
  // Analytics now sums cover/premium across the derived ACTIVE policies list
  // (all products), not the legacy life-only `insurance` row.
  policies: [
    { type: 'life', cover: 5000000, status: 'active', premiumMonthly: 12000 },
  ],
};

// Dated feed in the shape useSubscriberTransactions() delivers. Withdrawals come
// through NEGATIVE (the service maps magnitudes to -abs). Premiums must NOT
// affect the savings balance. Three months of activity (Jan, Feb, Mar 2026):
//   Jan: +100000 contribution
//   Feb: +120000 contribution, premium 12000 (no balance impact)
//   Mar: +50000 contribution, -20000 withdrawal
// Σ contributions = 270000 ; Σ signed delta = 100000 + 120000 + 50000 - 20000 = 250000
// → opening = netBalance(250000) - totalDelta(250000) = 0, closings = 100k/220k/250k.
const FEED = [
  { id: 't1', type: 'contribution', source: 'own', amount: 100000, date: '2026-01-10', method: 'MTN', reference: 'CT-1', status: 'settled' },
  { id: 't2', type: 'contribution', source: 'employer', amount: 120000, date: '2026-02-08', method: 'Bank', reference: 'CT-2', status: 'settled' },
  { id: 't3', type: 'premium', source: 'own', amount: 12000, date: '2026-02-20', method: 'MTN', reference: 'RN-1', status: 'settled' },
  { id: 't4', type: 'contribution', source: 'own', amount: 50000, date: '2026-03-05', method: 'MTN', reference: 'CT-3', status: 'settled' },
  { id: 't5', type: 'withdrawal', source: 'own', amount: -20000, date: '2026-03-22', method: 'MTN', reference: 'WD-1', status: 'processing' },
];

describe('deriveSubscriberAnalytics', () => {
  const a = deriveSubscriberAnalytics(SUB, FEED);

  it('computes headline KPIs from the summary + feed', () => {
    expect(a.kpis.netBalance).toBe(250000);
    expect(a.kpis.unitsHeld).toBe(250);
    expect(a.kpis.cover).toBe(5000000);
    expect(a.kpis.insuranceStatus).toBe('active');
    expect(a.kpis.premiumMonthly).toBe(12000);
    expect(a.kpis.txnCount).toBe(5);
  });

  it('totals contributed from contribution rows only (premium/withdrawal excluded)', () => {
    expect(a.kpis.totalContributed).toBe(270000); // 100000 + 120000 + 50000
  });

  it('buckets contributions by month, anchored to the data', () => {
    expect(a.contributionSeries).toHaveLength(3);
    expect(a.contributionSeries[0]).toMatchObject({ key: '2026-01', label: 'Jan 26', value: 100000 });
    expect(a.contributionSeries[1]).toMatchObject({ key: '2026-02', label: 'Feb 26', value: 120000 });
    expect(a.contributionSeries[2]).toMatchObject({ key: '2026-03', label: 'Mar 26', value: 50000 });
  });

  it('builds a cumulative closing-balance series ending at the current net balance', () => {
    expect(a.balanceSeries.map((b) => b.value)).toEqual([100000, 220000, 250000]);
    // The last point reconciles to the authoritative snapshot.
    expect(a.balanceSeries.at(-1).value).toBe(a.kpis.netBalance);
  });

  it('does not let premiums move the savings balance', () => {
    // Feb closing is 100000 (Jan) + 120000 (Feb contribution) = 220000, NOT
    // 220000 - 12000; the premium is ignored for balance math.
    expect(a.balanceSeries[1].value).toBe(220000);
  });

  it('fills month gaps so the axis is contiguous', () => {
    const sparse = deriveSubscriberAnalytics(
      { netBalance: 30000 },
      [
        { type: 'contribution', amount: 10000, date: '2026-01-15' },
        { type: 'contribution', amount: 20000, date: '2026-04-15' },
      ],
    );
    // Jan, Feb, Mar, Apr — Feb/Mar are zero-contribution but present.
    expect(sparse.contributionSeries.map((c) => c.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(sparse.contributionSeries.map((c) => c.value)).toEqual([10000, 0, 0, 20000]);
    expect(sparse.balanceSeries.map((b) => b.value)).toEqual([10000, 10000, 10000, 30000]);
  });

  it('clamps a derived opening balance to zero (never renders a negative point)', () => {
    // netBalance smaller than the summed deltas would push opening negative; the
    // series floors at 0 rather than charting a negative balance.
    const a2 = deriveSubscriberAnalytics(
      { netBalance: 5000 },
      [{ type: 'contribution', amount: 100000, date: '2026-02-01' }],
    );
    expect(a2.balanceSeries.every((b) => b.value >= 0)).toBe(true);
  });

  it('handles a subscriber with no dated transactions without throwing', () => {
    const e = deriveSubscriberAnalytics(SUB, []);
    expect(e.isEmpty).toBe(true);
    expect(e.balanceSeries).toEqual([]);
    expect(e.contributionSeries).toEqual([]);
    expect(e.kpis.totalContributed).toBe(0);
    // Snapshot KPIs still surface even with no feed.
    expect(e.kpis.netBalance).toBe(250000);
  });

  it('is defensive about null subscriber / non-array feed', () => {
    const e = deriveSubscriberAnalytics(null, null);
    expect(e.isEmpty).toBe(true);
    expect(e.kpis.netBalance).toBe(0);
    expect(e.kpis.cover).toBe(0);
  });
});

describe('export builders', () => {
  it('buildTransactionsExport maps every txn to labelled columns', () => {
    const { rows, columns } = buildTransactionsExport(FEED);
    expect(columns.map((c) => c.key)).toEqual(['date', 'type', 'source', 'amount', 'method', 'reference', 'status']);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ date: '2026-01-10', type: 'Contribution', source: 'Own', amount: 100000, status: 'Settled' });
    expect(rows[4]).toMatchObject({ type: 'Withdrawal', amount: -20000, status: 'Processing' });
  });

  it('keys every transaction row by each column.key so the Excel export is non-empty (xlsx contract)', () => {
    // buildWorkbookBuffer looks up each cell by column.key — EVERY column key
    // must resolve to a defined cell on every row, or the .xlsx export goes blank.
    const { rows, columns } = buildTransactionsExport(FEED);
    for (const col of columns) {
      expect(Object.prototype.hasOwnProperty.call(rows[0], col.key)).toBe(true);
      expect(rows[0][col.key]).not.toBeUndefined();
    }
  });

  it('buildContributionsExport pairs each month with contributions + closing balance', () => {
    const a = deriveSubscriberAnalytics(SUB, FEED);
    const { rows, columns } = buildContributionsExport(a);
    expect(columns.map((c) => c.key)).toEqual(['month', 'contributions', 'closingBalance']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ month: 'Jan 26', contributions: 100000, closingBalance: 100000 });
    expect(rows[2]).toMatchObject({ month: 'Mar 26', contributions: 50000, closingBalance: 250000 });
    for (const col of columns) {
      expect(rows[0][col.key]).not.toBeUndefined();
    }
  });

  it('builders tolerate empty / missing inputs', () => {
    expect(buildTransactionsExport([]).rows).toEqual([]);
    expect(buildTransactionsExport(undefined).rows).toEqual([]);
    expect(buildContributionsExport({}).rows).toEqual([]);
    expect(buildContributionsExport(undefined).rows).toEqual([]);
  });
});

describe('titleCase', () => {
  it('capitalises and guards empties', () => {
    expect(titleCase('contribution')).toBe('Contribution');
    expect(titleCase('')).toBe('—');
    expect(titleCase(null)).toBe('—');
  });
});
