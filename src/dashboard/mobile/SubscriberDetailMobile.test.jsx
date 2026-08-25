// Data-render test for the fetch-backed subscriber detail. Proves it reads the
// subscriber from useEntity (deep-link path), falls back to the router-state row
// during load (instant paint from the list), and shows a not-found state when
// neither source has the row.
//
// A15-001 regression coverage: the real bug was Balance/Contributions/
// Withdrawals rendering "—" for members who hold real money, because (a)
// getEntity('subscriber', id) never embedded subscriber_balances (fixed in
// services/entities.js — see entities.test.js for that half), and (b)
// totalContributions/totalWithdrawals are never populated by ANY getEntity
// read (they're aggregates over `transactions`), which the component now
// covers via useSubscriberTransactions. Both hooks are mocked here — mocking
// only useEntity would leave useSubscriberTransactions unmocked, which calls
// the real react-query useQuery() and throws with no QueryClient in scope.

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../hooks/useEntity', () => ({ useEntity: vi.fn() }));
vi.mock('../../hooks/useSubscriber', () => ({ useSubscriberTransactions: vi.fn() }));
import { useEntity } from '../../hooks/useEntity';
import { useSubscriberTransactions } from '../../hooks/useSubscriber';

const { default: SubscriberDetailMobile } = await import('./SubscriberDetailMobile');

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/dashboard/subscribers/:subscriberId" element={<SubscriberDetailMobile />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<SubscriberDetailMobile />', () => {
  beforeEach(() => {
    // Most tests below don't care about the lifetime-transactions fetch —
    // default it to "no data yet" so subBalance()'s totalBalance branch (or
    // the explicit per-test mock) is what's under test.
    useSubscriberTransactions.mockReturnValue({ data: undefined });
  });

  it('renders the fetched subscriber (name + derived balance)', () => {
    useEntity.mockReturnValue({
      data: {
        id: 's1', name: 'Jane Doe', phone: '+256700000001', isActive: true,
        kycStatus: 'complete', totalContributions: 500000, totalWithdrawals: 100000,
        registeredDate: '2025-01-05',
      },
      isLoading: false, isError: false,
    });
    renderAt('/dashboard/subscribers/s1');
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // No totalBalance on this row (pre-embed shape) → falls back to
    // 500,000 − 100,000 = 400,000 → compact "UGX 400K".
    expect(screen.getByText('UGX 400K')).toBeInTheDocument();
  });

  it('falls back to the router-state row while the fetch is loading', () => {
    useEntity.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderAt({
      pathname: '/dashboard/subscribers/s2',
      state: { sub: { id: 's2', name: 'Ali Musa', isActive: false, totalContributions: 0, totalWithdrawals: 0 } },
    });
    expect(screen.getByText('Ali Musa')).toBeInTheDocument();
  });

  it('shows a not-found state when neither the fetch nor state has the subscriber', () => {
    useEntity.mockReturnValue({ data: null, isLoading: false, isError: false });
    renderAt('/dashboard/subscribers/missing');
    expect(screen.getByText('Subscriber not found')).toBeInTheDocument();
  });

  // ── A15-001 ────────────────────────────────────────────────────────────
  it('renders the real Balance from totalBalance, not "—", for a member with money and zero legacy fields', () => {
    // Shape mapSubscriber() actually produces post-fix: totalBalance comes
    // from the subscriber_balances embed; totalContributions/totalWithdrawals
    // are still 0 because no getEntity read ever sources them.
    useEntity.mockReturnValue({
      data: {
        id: 'empe-001', name: 'Brian Okello', phone: '+256700000001', isActive: true,
        kycStatus: 'complete', totalBalance: 24786589, totalContributions: 0, totalWithdrawals: 0,
        registeredDate: '2025-01-05',
      },
      isLoading: false, isError: false,
    });
    renderAt('/dashboard/subscribers/empe-001');
    expect(screen.getByText('Brian Okello')).toBeInTheDocument();
    // The regression: this used to render "—" (formatUGX(0)) for a member
    // holding 24.8M because getEntity('subscriber', id) never embedded the
    // balance. Contributions/Withdrawals are still "—" here (transactions
    // haven't loaded in this test) — only Balance is asserted.
    expect(screen.getByText('UGX 24.8M')).toBeInTheDocument();
  });

  it('sums Contributions/Withdrawals from the id-bounded transactions fetch, not the always-zero entity fields', () => {
    useEntity.mockReturnValue({
      data: {
        id: 'empe-001', name: 'Brian Okello', phone: '+256700000001', isActive: true,
        kycStatus: 'complete', totalBalance: 24786589, totalContributions: 0, totalWithdrawals: 0,
        registeredDate: '2025-01-05',
      },
      isLoading: false, isError: false,
    });
    useSubscriberTransactions.mockReturnValue({
      data: [
        { type: 'contribution', amount: 20000000 },
        { type: 'contribution', amount: 5000000 },
        { type: 'withdrawal', amount: -300000 },
      ],
    });
    renderAt('/dashboard/subscribers/empe-001');
    // contributions = 20,000,000 + 5,000,000 = 25,000,000 → "UGX 25.0M"
    expect(screen.getByText('UGX 25.0M')).toBeInTheDocument();
    // withdrawals = |-300,000| = 300,000 → "UGX 300K"
    expect(screen.getByText('UGX 300K')).toBeInTheDocument();
  });
});
