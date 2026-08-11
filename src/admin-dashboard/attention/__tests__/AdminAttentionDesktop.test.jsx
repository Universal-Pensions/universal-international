// Drill-down + notify test for the admin Needs-attention detail page.
//
// Covers the two things most likely to break silently: the notification is
// addressed from the row's SERVER-RESOLVED recipient (not guessed in the UI),
// and an unrecognised signal degrades to an error card instead of crashing the
// admin shell.

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const setAttentionType = vi.fn();
const addToast = vi.fn();
const mutate = vi.fn();

let attentionType = 'delayedWithdrawals';
let rowsResult = { data: [], isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('../../../contexts/AdminPanelContext', () => ({
  useAdminPanel: () => ({ attentionType, setAttentionType }),
}));
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../../hooks/useAdminAttention', () => ({
  useAdminAttentionRows: () => rowsResult,
}));
vi.mock('../../../hooks/useNotifications', () => ({
  useSendAdminNotification: () => ({ mutate, isPending: false }),
}));

const { default: AdminAttentionDesktop } = await import('../AdminAttentionDesktop');

const withdrawalRow = {
  id: 'wd-demo-06',
  primary: 'Grace Nakato',
  secondary: 'Emergency payout · MTN MoMo',
  amount: 180000,
  date: '2026-07-24',
  dueBy: '2026-07-29',
  daysLate: 9,
  status: 'processing',
  recipientRole: 'admin',
  recipientId: 'ops-treasury',
  recipientName: 'Treasury Operations',
  href: '/dashboard/subscribers/s-0287',
};

const renderPage = () => render(<MemoryRouter><AdminAttentionDesktop /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  attentionType = 'delayedWithdrawals';
  rowsResult = { data: [withdrawalRow], isLoading: false, isError: false, refetch: vi.fn() };
});

describe('<AdminAttentionDesktop />', () => {
  it('renders the signal’s title, lead and rows', () => {
    renderPage();
    // Title appears twice — the page head and the card's section head.
    expect(screen.getAllByText('Delayed withdrawal payouts')).toHaveLength(2);
    expect(screen.getByText(/Escalate to treasury to release the payments/i)).toBeInTheDocument();
    expect(screen.getByText('Grace Nakato')).toBeInTheDocument();
    expect(screen.getByText('Emergency payout · MTN MoMo')).toBeInTheDocument();
    // daysLate straight off the row — the client never computes it.
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('links the identity cell to the member when the row carries an href', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /Grace Nakato/ }))
      .toHaveAttribute('href', '/dashboard/subscribers/s-0287');
  });

  it('shows an unknown attention type as an error card instead of crashing', () => {
    attentionType = 'notASignal';
    renderPage();
    expect(screen.getByText('Unknown attention type')).toBeInTheDocument();
    expect(screen.queryByText('Grace Nakato')).not.toBeInTheDocument();
  });

  it('shows the signal’s all-clear copy when there is nothing to action', () => {
    rowsResult = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(/every withdrawal is within its payout SLA/i)).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', () => {
    const refetch = vi.fn();
    rowsResult = { data: [], isLoading: false, isError: true, refetch };
    renderPage();
    expect(screen.getByText(/We couldn't load this list/i)).toBeInTheDocument();
  });

  it('opens the composer prefilled from the row', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Escalate Treasury Operations/i }));

    const textarea = await screen.findByLabelText('Message');
    expect(textarea.value).toContain('Grace Nakato');
    expect(textarea.value).toContain('9 days past due');
    // Recipient chip shows who it actually goes to.
    expect(screen.getAllByText('Treasury Operations').length).toBeGreaterThan(0);
    expect(screen.getByText('internal queue')).toBeInTheDocument();
  });

  it('sends to the row’s server-resolved recipient, not a UI guess', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Escalate Treasury Operations/i }));
    await screen.findByLabelText('Message');
    await userEvent.click(screen.getByRole('button', { name: 'Escalate' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const [payload] = mutate.mock.calls[0];
    expect(payload).toMatchObject({
      recipientRole: 'admin',
      recipientId: 'ops-treasury',
      type: 'delayedWithdrawals',
      refId: 'wd-demo-06',
      amount: 180000,
    });
    expect(payload.body).toContain('Grace Nakato');
    expect(payload.title).toBe('Withdrawal payout past SLA');
  });

  it('addresses an entity signal to that entity rather than an ops queue', async () => {
    attentionType = 'delayedEmployerTransfers';
    rowsResult = {
      data: [{
        id: 'emp-003', primary: 'Kigo Tea Estates', secondary: 'Monthly payroll · no run recorded',
        amount: null, date: null, dueBy: null, daysLate: null, status: 'active',
        recipientRole: 'employer', recipientId: 'emp-003', recipientName: 'Kigo Tea Estates', href: null,
      }],
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Notify Kigo Tea Estates/i }));
    await screen.findByLabelText('Message');
    await userEvent.click(screen.getByRole('button', { name: 'Notify' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      recipientRole: 'employer',
      recipientId: 'emp-003',
      type: 'delayedEmployerTransfers',
    });
  });

  it('renders an em dash, not a zero, when a row has no due date', () => {
    attentionType = 'delayedEmployerTransfers';
    rowsResult = {
      data: [{
        id: 'emp-003', primary: 'Kigo Tea Estates', secondary: 'Monthly payroll · no run recorded',
        amount: null, date: null, dueBy: null, daysLate: null, status: 'active',
        recipientRole: 'employer', recipientId: 'emp-003', recipientName: 'Kigo Tea Estates', href: null,
      }],
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    renderPage();
    // An employer that has NEVER posted a run has no due date; "0 days late"
    // would be a lie.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
