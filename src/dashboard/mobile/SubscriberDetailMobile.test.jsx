// Data-render test for the fetch-backed subscriber detail. Proves it reads the
// subscriber from useEntity (deep-link path), falls back to the router-state row
// during load (instant paint from the list), and shows a not-found state when
// neither source has the row.

import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../hooks/useEntity', () => ({ useEntity: vi.fn() }));
import { useEntity } from '../../hooks/useEntity';

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
    // balance = 500,000 − 100,000 = 400,000 → compact "UGX 400K"
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
});
