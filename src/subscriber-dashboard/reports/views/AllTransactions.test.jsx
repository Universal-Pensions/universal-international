// RTL test for AllTransactions — the subscriber's full transaction ledger +
// CSV export (audit A10-001).
//
// getCurrentSubscriber's single joined query never selects the transactions
// table (mapSubscriberRow has no `transactions` key — see
// src/services/subscriber.js), so this view used to read `sub?.transactions`,
// which was always `undefined` in live mode. The report silently rendered
// "0 of 0 transactions" and its CSV export emitted a header row with zero data
// rows for every subscriber, including members who had genuinely contributed.
// The fix reads the same dedicated, id-scoped `useSubscriberTransactions(id)`
// query ActivityPage/WithdrawalsHistory already use. The mocked subscriber
// below deliberately carries no `.transactions` field, so this test fails
// against the pre-fix component (which read `sub.transactions`).

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

vi.mock('../../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useSubscriberTransactions: vi.fn(),
}));
vi.mock('../../../utils/csv', () => ({
  downloadCSV: vi.fn(),
}));

const { useCurrentSubscriber, useSubscriberTransactions } = await import('../../../hooks/useSubscriber');
const { downloadCSV } = await import('../../../utils/csv');
const { default: AllTransactions } = await import('./AllTransactions');

// Mirrors the live seeded subscriber s-0001 (Carol Obua), verified 2026-08-25:
// 9 contributions summing to 1,400,137 UGX, 1 premium of 24,000, 1 withdrawal.
const TRANSACTIONS = [
  { id: 't1', type: 'contribution', source: 'own', amount: 500000, date: '2026-03-12', status: 'settled', method: 'MTN Mobile Money', reference: 'TXN-001' },
  { id: 't2', type: 'contribution', source: 'own', amount: 900137, date: '2026-02-08', status: 'settled', method: 'Airtel Money', reference: 'TXN-002' },
  { id: 't3', type: 'premium', source: 'own', amount: 24000, date: '2026-01-15', status: 'paid', method: 'Card', reference: 'TXN-003' },
  { id: 't4', type: 'withdrawal', source: 'own', amount: -20126, date: '2026-01-05', status: 'settled', method: 'Bank transfer', reference: 'TXN-004' },
];

beforeEach(() => {
  useCurrentSubscriber.mockReturnValue({ data: { id: 'sub-1' }, isLoading: false, isError: false });
  useSubscriberTransactions.mockReturnValue({ data: TRANSACTIONS, isLoading: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<AllTransactions />', () => {
  it('renders the real transactions from useSubscriberTransactions, not sub.transactions', () => {
    // `sub` deliberately carries no `.transactions` field (matches the real
    // getCurrentSubscriber shape) — if the component still read
    // `sub.transactions` this would render "0 of 0 transactions".
    render(<AllTransactions />);
    expect(screen.getByText('4 of 4 transactions')).toBeInTheDocument();
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument();
  });

  it('totals money in from the real contribution rows, not zero', () => {
    render(<AllTransactions />);
    // 500,000 + 900,137 contributions = 1,400,137 in. Scoped to the "Money in"
    // KPI box specifically — Net happens to round to the same compact
    // "UGX 1.4M" string, which would otherwise make this an ambiguous query.
    const moneyIn = screen.getByText('Money in').closest('div');
    expect(within(moneyIn).getByText('UGX 1.4M')).toBeInTheDocument();
  });

  it('exports the real rows to CSV instead of a header-only file', () => {
    render(<AllTransactions />);

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const [, headers, rows] = downloadCSV.mock.calls[0];
    expect(headers).toEqual(['Date', 'Type', 'Paid by', 'Amount (UGX)', 'Method', 'Reference', 'Status']);
    expect(rows).toHaveLength(4);
    // The two contribution rows carry their real amounts, not zero.
    const contributionAmounts = rows.filter((r) => r[1] === 'contribution').map((r) => r[3]);
    expect(contributionAmounts).toEqual(expect.arrayContaining([500000, 900137]));
  });

  it('shows the genuine empty state — not the data-loss bug — when a member truly has no transactions', () => {
    useSubscriberTransactions.mockReturnValue({ data: [], isLoading: false });
    render(<AllTransactions />);
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
  });

  it('renders the cold-load skeleton while the transactions query is still in flight, instead of flashing "0 of 0"', () => {
    useSubscriberTransactions.mockReturnValue({ data: [], isLoading: true });
    render(<AllTransactions />);
    expect(screen.queryByText(/of \d+ transactions/)).not.toBeInTheDocument();
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument();
    expect(screen.getByText('Loading transactions…')).toBeInTheDocument();
  });
});
