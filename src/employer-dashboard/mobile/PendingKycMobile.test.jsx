// RTL tests for the PHONE body of /dashboard/pending-kyc.
//
// The desktop body was verified in a real browser; this pins the phone one,
// which shares all of its logic through `kyc/usePendingKycNudge` but has its own
// layout. What matters here is that the phone surface offers the SAME nudge
// contract: pick people, pick channels, and the send carries both.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sendMutateAsync = vi.fn(async () => ({ sent: 2, unreachable: [], perChannel: {} }));
const addToast = vi.fn();

vi.mock('../../hooks/useEmployer', () => ({
  usePendingInvites: vi.fn(),
  useCancelInvite: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useSendInviteNudges: vi.fn(() => ({ mutateAsync: sendMutateAsync, isPending: false })),
}));
vi.mock('../../contexts/EmployerScopeContext', () => ({
  useEmployerScope: () => ({ employerId: 'emp-001' }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast }),
}));

const { usePendingInvites } = await import('../../hooks/useEmployer');
const { default: PendingKycMobile } = await import('./PendingKycMobile');

// Far-future expiry so nothing lands in the "Expired" tab.
const EXPIRES = '2030-01-01T00:00:00.000Z';
const INVITES = [
  { token: 't-1', expiresAt: EXPIRES, createdAt: EXPIRES, prefill: { fullName: 'Aisha Nabirye', phone: '+256700100092', email: 'a@example.com' } },
  { token: 't-2', expiresAt: EXPIRES, createdAt: EXPIRES, prefill: { fullName: 'Yasin Kizza', phone: '+256700100091' } },
];

function renderMobile(invites = INVITES) {
  usePendingInvites.mockReturnValue({ data: invites, isLoading: false, isError: false, refetch: vi.fn() });
  return render(<PendingKycMobile />);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('<PendingKycMobile />', () => {
  it('lists pending invites with the channels each can be reached on', () => {
    renderMobile();

    expect(screen.getByText('Aisha Nabirye')).toBeInTheDocument();
    expect(screen.getByText('Yasin Kizza')).toBeInTheDocument();

    // Aisha has phone + email → all three; Yasin has no email → SMS/WhatsApp.
    const aisha = screen.getByRole('checkbox', { name: /Aisha Nabirye/ });
    expect(within(aisha).getByText('Email')).toBeInTheDocument();
    const yasin = screen.getByRole('checkbox', { name: /Yasin Kizza/ });
    expect(within(yasin).queryByText('Email')).not.toBeInTheDocument();
    expect(within(yasin).getByText('SMS')).toBeInTheDocument();
  });

  it('keeps the composer hidden until someone is selected', async () => {
    renderMobile();
    expect(screen.queryByRole('group', { name: /send via/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Aisha Nabirye/ }));

    expect(screen.getByRole('checkbox', { name: 'Send via Email' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Send via SMS' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Send via WhatsApp' })).toBeInTheDocument();
  });

  it('sends the selected people over the selected channels', async () => {
    renderMobile();

    await userEvent.click(screen.getByRole('checkbox', { name: /Aisha Nabirye/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Yasin Kizza/ }));
    // Defaults are SMS + Email; add WhatsApp so all three ride along.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send via WhatsApp' }));
    await userEvent.click(screen.getByRole('button', { name: /Send reminder to/ }));

    expect(sendMutateAsync).toHaveBeenCalledTimes(1);
    const payload = sendMutateAsync.mock.calls[0][0];
    expect(payload.invites.map((i) => i.token)).toEqual(['t-1', 't-2']);
    // Canonical channel order, regardless of the order they were ticked.
    expect(payload.channels).toEqual(['email', 'sms', 'whatsapp']);
  });

  it('blocks the send when every channel is unticked', async () => {
    renderMobile();

    await userEvent.click(screen.getByRole('checkbox', { name: /Aisha Nabirye/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send via Email' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send via SMS' }));

    expect(screen.getByText(/choose at least one channel/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send reminder to/ })).toBeDisabled();
    expect(sendMutateAsync).not.toHaveBeenCalled();
  });

  it('warns, and refuses to send, when no chosen channel can reach anyone selected', async () => {
    renderMobile();

    // Yasin has no email; email-only leaves nobody reachable.
    await userEvent.click(screen.getByRole('checkbox', { name: /Yasin Kizza/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send via SMS' }));

    expect(screen.getByText(/nobody selected can be reached this way/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send reminder to/ })).toBeDisabled();
  });

  it('shows the empty state when nothing is pending', () => {
    renderMobile([]);
    expect(screen.getByText('No pending invites')).toBeInTheDocument();
  });
});
