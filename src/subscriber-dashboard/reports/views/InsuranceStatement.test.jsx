// RTL test for InsuranceStatement — the subscriber's premiums/claims summary.
//
// Same bug family as A10-001/A10-002 (AnnualStatement/AllTransactions/
// InsurancePage), not itself named in a finding: getCurrentSubscriber's single
// joined query never selects the transactions table (mapSubscriberRow has no
// `transactions` key — see src/services/subscriber.js), so
// `(sub?.transactions || [])` always read `[]`. The premiums-paid section
// (both the KPI value and its "N payments" sub-label) silently rendered UGX 0
// / "0 payments" for a member who had genuinely paid premiums. The claims
// list uses its own dedicated `useSubscriberClaims` hook, which is why claims
// rendered correctly and this half of the page was missed. The fix reads the
// same dedicated, id-scoped `useSubscriberTransactions(id)` query
// AnnualStatement/AllTransactions already use. The mocked subscriber below
// deliberately carries no `.transactions` field, so this test fails against
// the pre-fix component (which read `sub.transactions`).

import { vi, describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('../../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useSubscriberClaims: vi.fn(),
  useSubscriberTransactions: vi.fn(),
}));
vi.mock('../../../utils/csv', () => ({
  downloadCSV: vi.fn(),
}));

const { useCurrentSubscriber, useSubscriberClaims, useSubscriberTransactions } =
  await import('../../../hooks/useSubscriber');
const { default: InsuranceStatement } = await import('./InsuranceStatement');

// `sub` deliberately carries no `.transactions` field — matches the real
// getCurrentSubscriber shape (mapSubscriberRow never populates it).
const SUBSCRIBER = { id: 'sub-1', insurance: {}, insuranceProducts: [] };

const PREMIUM_TRANSACTIONS = [
  { id: 't1', type: 'premium', amount: 24000, date: '2026-01-15', status: 'paid' },
  { id: 't2', type: 'premium_sweep', amount: -6000, date: '2026-02-01', status: 'settled' },
  { id: 't3', type: 'contribution', amount: 500000, date: '2026-03-12', status: 'settled' },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe('<InsuranceStatement /> premiums paid (same bug family as A10-001/A10-002)', () => {
  it('reports the real premiums-paid total from useSubscriberTransactions, not sub.transactions', () => {
    useCurrentSubscriber.mockReturnValue({ data: SUBSCRIBER, isLoading: false, isError: false });
    useSubscriberClaims.mockReturnValue({ data: [] });
    useSubscriberTransactions.mockReturnValue({ data: PREMIUM_TRANSACTIONS, isLoading: false });

    render(<InsuranceStatement />);

    // 24,000 + |-6,000| = 30,000 — not the compact "—" a zero/undefined
    // total renders as (formatUGX(0, {compact: true}) => '—').
    const premiumsBox = screen.getByText('Premiums paid').closest('div');
    expect(within(premiumsBox).getByText('UGX 30K')).toBeInTheDocument();
    expect(within(premiumsBox).getByText('2 payments')).toBeInTheDocument();
  });

  it('shows "0 payments" only when the member genuinely has none, not because the field was never read', () => {
    useCurrentSubscriber.mockReturnValue({ data: SUBSCRIBER, isLoading: false, isError: false });
    useSubscriberClaims.mockReturnValue({ data: [] });
    useSubscriberTransactions.mockReturnValue({ data: [], isLoading: false });

    render(<InsuranceStatement />);

    // formatUGX's compact form renders a zero/absent total as '—', not
    // literal "UGX 0" — the important assertion is the payment COUNT: 0 here
    // must mean "genuinely zero premium transactions", not "the field was
    // never read" (which would also render 0, indistinguishably, without
    // this regression test pinning it to a deliberately-empty mock).
    const premiumsBox = screen.getByText('Premiums paid').closest('div');
    expect(within(premiumsBox).getByText('—')).toBeInTheDocument();
    expect(within(premiumsBox).getByText('0 payments')).toBeInTheDocument();
  });

  it('renders the cold-load skeleton while the transactions query is still in flight, instead of flashing "0 payments"', () => {
    useCurrentSubscriber.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    useSubscriberClaims.mockReturnValue({ data: [] });
    useSubscriberTransactions.mockReturnValue({ data: [], isLoading: true });

    render(<InsuranceStatement />);
    expect(screen.queryByText(/payments?$/)).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('still shows the skeleton if the subscriber has resolved but transactions have not (txLoading guard)', () => {
    // Guards the `|| txLoading` addition specifically — without it, a
    // resolved `sub` with still-loading transactions would fall through to
    // the real content and briefly render "0 payments".
    useCurrentSubscriber.mockReturnValue({ data: SUBSCRIBER, isLoading: false, isError: false });
    useSubscriberClaims.mockReturnValue({ data: [] });
    useSubscriberTransactions.mockReturnValue({ data: [], isLoading: true });

    render(<InsuranceStatement />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
