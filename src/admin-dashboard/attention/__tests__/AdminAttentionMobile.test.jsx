// Phone drill-down for the admin Needs-attention detail page.
//
// This file exists mainly as a parity guard. Admin panel features in this repo
// have shipped desktop-only and been unreachable on a phone more than once
// (nominee claims had no phone route at all; employer contribution history was
// routed, built and undiscoverable). The Resolve action added in 0162 is exactly
// the shape that keeps happening — a second button in a drill-down — so the
// mobile surface gets its own assertions rather than trusting the shared hook.

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const addToast = vi.fn();
const mutate = vi.fn();
const resolveMutate = vi.fn();

let rowsResult = { data: [], isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../../hooks/useAdminAttention', () => ({
  useAdminAttentionRows: () => rowsResult,
  useResolveAttentionRow: () => ({ mutate: resolveMutate, isPending: false }),
}));
vi.mock('../../../hooks/useNotifications', () => ({
  useSendAdminNotification: () => ({ mutate, isPending: false }),
}));

const { default: AdminAttentionMobile } = await import('../AdminAttentionMobile');

const navRow = (over = {}) => ({
  id: 'nav-unpriced-20260902',
  primary: '02 Sep 2026',
  secondary: 'UPU-BAL · no price received',
  amount: null,
  date: '2026-09-02',
  dueBy: '2026-09-02',
  daysLate: 1,
  status: 'unpriced',
  resolved: false,
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  recipientRole: 'admin',
  recipientId: 'ops-fund-admin',
  recipientName: 'Fund Administration',
  href: null,
  ...over,
});

const renderAt = (type = 'delayedNav') => render(
  <MemoryRouter initialEntries={[`/dashboard/attention/${type}`]}>
    <Routes>
      <Route path="/dashboard/attention/:type" element={<AdminAttentionMobile />} />
      <Route path="/dashboard" element={<p>home</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  rowsResult = { data: [navRow()], isLoading: false, isError: false, refetch: vi.fn() };
});

describe('<AdminAttentionMobile />', () => {
  it('offers Resolve on a phone, not just on desktop', () => {
    renderAt();
    expect(screen.getByRole('button', { name: /Escalate Fund Administration/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resolve 02 Sep 2026/i })).toBeInTheDocument();
  });

  it('resolves from the phone sheet with the ISO date', async () => {
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: /Resolve 02 Sep 2026/i }));

    await screen.findByLabelText(/Why is this resolved/i);
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(resolveMutate).toHaveBeenCalledTimes(1));
    expect(resolveMutate.mock.calls[0][0].row.date).toBe('2026-09-02');
  });

  it('keeps a resolved day listed as a record, with no actions left', () => {
    rowsResult = {
      data: [navRow({ resolved: true, resolvedBy: 'admin', resolvedAt: '2026-09-03T09:00:00+00:00' })],
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    renderAt();
    expect(screen.getByText('02 Sep 2026')).toBeInTheDocument();
    expect(screen.getByText(/Resolved by admin/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resolve/i })).not.toBeInTheDocument();
  });

  it('never offers Resolve on a signal that has not opted in', () => {
    rowsResult = {
      data: [navRow({
        id: 'wd-1', primary: 'Grace Nakato', recipientId: 'ops-treasury',
        recipientName: 'Treasury Operations', resolved: false,
      })],
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    renderAt('delayedWithdrawals');
    expect(screen.queryByRole('button', { name: /^Resolve/i })).not.toBeInTheDocument();
  });

  it('sends an unknown signal home instead of rendering an empty shell', () => {
    renderAt('notASignal');
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
