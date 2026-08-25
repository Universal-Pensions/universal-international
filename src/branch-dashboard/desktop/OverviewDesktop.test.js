// Unit test for monthLabelsEndingAt — the pure month-label builder
// OverviewDesktop.jsx's contributions chart uses (A12-001).
//
// Regression this guards: the chart built its 12 x-axis labels from
// `new Date()` (the real wall clock) while the underlying series
// (metrics.monthlyContributions, from the get_entity_metrics_rollup RPC) is
// bucketed relative to the SQL demo clock (public._demo_now()). Any real demo
// date after the demo clock (which is always, once the demo clock is frozen)
// mislabelled every bar — e.g. the bar actually holding May 2026's total was
// labelled "Aug" because that's what the wall clock said. Labels must be
// built from the same anchor (MOCK_NOW / demoClock.js) the series' own dates
// are relative to, not from wherever the machine happens to be when it renders.

import { describe, it, expect } from 'vitest';
import { monthLabelsEndingAt } from './OverviewDesktop';

describe('monthLabelsEndingAt', () => {
  it('ends at `now`s own month, not the real wall-clock month', () => {
    // MOCK_NOW-shaped anchor (Jul 2026) — the demo clock, independent of
    // whatever the real wall-clock date is when this test runs.
    const now = new Date(2026, 6, 1); // Jul 2026
    expect(monthLabelsEndingAt(3, now)).toEqual(['May', 'Jun', 'Jul']);
  });

  it('produces exactly `count` labels, oldest first, for a full 12-month window', () => {
    const now = new Date(2026, 4, 18); // May 2026 (the live _demo_now() month
    // this bug was verified against — see A12-001's evidence)
    const labels = monthLabelsEndingAt(12, now);
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe('Jun'); // 11 months before May 2026
    expect(labels[labels.length - 1]).toBe('May'); // ends at `now`s month
  });

  it('handles a year rollover (Jan `now` reaches back into the prior year)', () => {
    const now = new Date(2026, 0, 10); // Jan 2026
    expect(monthLabelsEndingAt(2, now)).toEqual(['Dec', 'Jan']);
  });
});
