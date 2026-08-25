// RTL test for AnnualStatement's year re-sync effect (audit §02-L1).
//
// The selected `year` was read once from a possibly-empty `years` (transactions
// hydrate async), so on a slow load it stuck on the wall-clock year and never
// landed on a populated year. The fix adds an effect that snaps `year` onto the
// newest populated year once data arrives. This mounts with empty transactions,
// then rerenders with hydrated data and asserts the populated year chip is
// selected — and that the summary header reflects it.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useSubscriberTransactions: vi.fn(),
}));
vi.mock('../../../utils/csv', () => ({
  downloadCSV: vi.fn(),
}));

const { useCurrentSubscriber, useSubscriberTransactions } = await import('../../../hooks/useSubscriber');
const { downloadCSV } = await import('../../../utils/csv');
const { default: AnnualStatement } = await import('./AnnualStatement');

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.resetAllMocks(); });

describe('<AnnualStatement /> year re-sync', () => {
  it('snaps the selected year onto a populated year once transactions hydrate', async () => {
    // Cold load: sub has resolved but the transactions query hasn't (years is
    // empty) — mirrors a real navigation straight to this route.
    useCurrentSubscriber.mockReturnValue({ data: { id: 'sub-1' }, isLoading: false, isError: false });
    useSubscriberTransactions.mockReturnValue({ data: [], isLoading: true });
    const { rerender } = render(<AnnualStatement />);

    // Transactions land — newest tx year is 2026.
    useSubscriberTransactions.mockReturnValue({
      data: [
        { id: 'a', type: 'contribution', amount: 30000, date: '2026-03-12' },
        { id: 'b', type: 'contribution', amount: 20000, date: '2025-08-04' },
      ],
      isLoading: false,
    });
    rerender(<AnnualStatement />);

    await waitFor(() => {
      // The summary header reflects the re-synced, populated year.
      expect(screen.getByText('2026 summary')).toBeInTheDocument();
    });
  });
});

// Regression coverage for A10-001: the Annual TAX Statement used to read
// `sub.transactions`, a field getCurrentSubscriber never populates, so it
// reported UGX 0 contributions (and exported that zero to CSV) for a member
// who had genuinely contributed. This asserts the statement — and its CSV
// export — reflect the real per-id transaction feed instead.
describe('<AnnualStatement /> real contribution data (A10-001)', () => {
  const TRANSACTIONS = [
    { id: 't1', type: 'contribution', source: 'own', amount: 500000, date: '2026-03-12', status: 'settled' },
    { id: 't2', type: 'contribution', source: 'own', amount: 900137, date: '2026-02-08', status: 'settled' },
    { id: 't3', type: 'premium', source: 'own', amount: 24000, date: '2026-01-15', status: 'paid' },
    { id: 't4', type: 'withdrawal', source: 'own', amount: -20126, date: '2026-01-05', status: 'settled' },
  ];

  beforeEach(() => {
    useCurrentSubscriber.mockReturnValue({ data: { id: 'sub-1' }, isLoading: false, isError: false });
    useSubscriberTransactions.mockReturnValue({ data: TRANSACTIONS, isLoading: false });
  });

  it('reports the real contribution total instead of UGX 0', () => {
    render(<AnnualStatement />);
    // 500,000 + 900,137 = 1,400,137 — not the "No statement yet" empty state
    // and not a zeroed summary.
    expect(screen.queryByText('No statement yet.')).not.toBeInTheDocument();
    expect(screen.getByText('UGX 1,400,137')).toBeInTheDocument();
  });

  it('exports the real total to CSV instead of "Contributions 2026,0"', () => {
    render(<AnnualStatement />);

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const [, , rows] = downloadCSV.mock.calls[0];
    const contributionsRow = rows.find((r) => String(r[0]).startsWith('Contributions'));
    expect(contributionsRow[1]).toBe(1400137);
  });
});
