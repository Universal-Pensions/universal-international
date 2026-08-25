// RTL test for ContributionsSummary's data-anchored month axis (audit §02-M1).
//
// The month labels used to be built from `new Date()` while the demo seed is
// MOCK_NOW-anchored (2026), so labels drifted as the wall clock advanced. The
// fix derives the base month from the latest dated transaction. This mounts the
// view with a mocked useCurrentSubscriber whose transactions are anchored to a
// fixed past month (Mar 2026) and asserts the newest month card reads "Mar 2026"
// regardless of the current wall clock.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useSubscriberTransactions: vi.fn(),
}));

const { useCurrentSubscriber, useSubscriberTransactions } = await import('../../../hooks/useSubscriber');
const { default: ContributionsSummary } = await import('./ContributionsSummary');

// Latest dated contribution is Mar 2026; earlier ones are older.
const TXNS = [
  { id: 't1', type: 'contribution', amount: 30000, date: '2026-03-12' },
  { id: 't2', type: 'contribution', amount: 20000, date: '2026-02-10' },
  { id: 't3', type: 'contribution', amount: 10000, date: '2026-01-08' },
];

// NOTE: transactions deliberately do NOT live on the subscriber object.
// They used to in this fixture, which is why these tests passed while the
// component was reading `sub.transactions` — a field mapSubscriberRow never
// populates in production. The fixture was asserting against data the real
// code could never receive. They now come from useSubscriberTransactions,
// the query the component actually uses.
function sub(overrides = {}) {
  return {
    id: 's-0001',
    contributionHistory: [10000, 20000, 30000],
    contributionSchedule: { retirementPct: 80, emergencyPct: 20 },
    ...overrides,
  };
}

beforeEach(() => {
  useCurrentSubscriber.mockReturnValue({ data: sub(), isLoading: false, isError: false });
  useSubscriberTransactions.mockReturnValue({ data: TXNS, isLoading: false });
});
afterEach(() => { vi.resetAllMocks(); });

describe('<ContributionsSummary /> month axis', () => {
  it('labels the newest month from the latest transaction date, not the wall clock', () => {
    render(<ContributionsSummary />);
    // Newest card (history reversed) is the most recent contribution month.
    expect(screen.getByText('Mar 2026')).toBeInTheDocument();
    // And the trailing months count back from that data anchor.
    expect(screen.getByText('Feb 2026')).toBeInTheDocument();
    expect(screen.getByText('Jan 2026')).toBeInTheDocument();
  });

  it('falls back to the wall clock when there are no dated transactions', () => {
    useCurrentSubscriber.mockReturnValue({
      data: sub({ contributionHistory: [5000] }),
      isLoading: false,
      isError: false,
    });
    useSubscriberTransactions.mockReturnValue({ data: [], isLoading: false });
    render(<ContributionsSummary />);
    const now = new Date();
    const label = now.toLocaleDateString('en-UG', { month: 'short', year: 'numeric' });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
