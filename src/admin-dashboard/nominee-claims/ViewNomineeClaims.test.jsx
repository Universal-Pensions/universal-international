// RTL test for the admin ViewNomineeClaims panel — the triage flow.
//
// This panel is the ONLY place a death-benefit claim becomes real. The public
// form at /claim can't verify anything (confirming cover to an anonymous caller
// would be a member-enumeration oracle — see migration 0100), so everything that
// matters happens here: a human reads the row, finds the member, and records a
// decision. These tests pin that contract:
//   • the row leads with the DECEASED, because that is who the admin must find;
//   • the three actions each call reviewNomineeClaim with the right status;
//   • the manual member match and the note ride along with the decision.
//
// Harness mirrors ViewAccessRequests.test.jsx.

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/nomineeClaims', () => ({
  listNomineeClaims: vi.fn(),
  reviewNomineeClaim: vi.fn(),
}));

const nomineeClaims = await import('../../services/nomineeClaims');
const { AdminPanelProvider, useAdminPanel } = await import('../../contexts/AdminPanelContext');
const { ToastProvider } = await import('../../contexts/ToastContext');
const { default: ViewNomineeClaims } = await import('./ViewNomineeClaims');

function OpenOnMount() {
  const { setViewNomineeClaimsOpen } = useAdminPanel();
  React.useEffect(() => { setViewNomineeClaimsOpen(true); }, [setViewNomineeClaimsOpen]);
  return <ViewNomineeClaims />;
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AdminPanelProvider>
          <OpenOnMount />
        </AdminPanelProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const LIFE_CLAIM = {
  id: 'nc-1', reference: 'NC-B14263E1', product: 'life', status: 'pending',
  deceasedName: 'Grace Nakato', deceasedNin: 'CF89012345678X', deceasedPhone: '+256700000111',
  dateOfDeath: '2026-07-02',
  claimantName: 'Samuel Nakato', claimantPhone: '+256771234567', relationship: 'Spouse',
  district: 'Kampala', notes: 'Death certificate issued at Mulago.',
  createdAt: '2026-08-07T00:00:00Z',
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.resetAllMocks(); });

describe('<ViewNomineeClaims /> triage flow', () => {
  it('leads the row with the deceased and their identifiers', async () => {
    nomineeClaims.listNomineeClaims.mockResolvedValue([LIFE_CLAIM]);
    renderPanel();

    // The admin's first job is finding this person in the member records.
    expect(await screen.findByText('Grace Nakato')).toBeInTheDocument();
    expect(screen.getByText(/CF89012345678X/)).toBeInTheDocument();
    expect(screen.getByText('NC-B14263E1')).toBeInTheDocument();
    // And the number to call back on.
    expect(screen.getByText('+256771234567')).toBeInTheDocument();
    expect(screen.getByText('Samuel Nakato')).toBeInTheDocument();
  });

  it('approves with the manual member match and the note attached', async () => {
    nomineeClaims.listNomineeClaims.mockResolvedValue([LIFE_CLAIM]);
    nomineeClaims.reviewNomineeClaim.mockResolvedValue({ id: 'nc-1', status: 'approved' });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /^approve$/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('e.g. s-0001'), 's-0001');
    await user.type(within(dialog).getByPlaceholderText(/what you checked/i), 'Certificate seen.');
    await user.click(within(dialog).getByRole('button', { name: /approve claim/i }));

    await waitFor(() => expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalledTimes(1));
    expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalledWith({
      id: 'nc-1',
      status: 'approved',
      note: 'Certificate seen.',
      subscriberId: 's-0001',
    });
  });

  it('rejects with the rejected status', async () => {
    nomineeClaims.listNomineeClaims.mockResolvedValue([LIFE_CLAIM]);
    nomineeClaims.reviewNomineeClaim.mockResolvedValue({ id: 'nc-1', status: 'rejected' });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /reject claim/i }));

    await waitFor(() => expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalledTimes(1));
    expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nc-1', status: 'rejected' }),
    );
  });

  it('offers a non-committal "start review" — finding the member can take days', async () => {
    nomineeClaims.listNomineeClaims.mockResolvedValue([LIFE_CLAIM]);
    nomineeClaims.reviewNomineeClaim.mockResolvedValue({ id: 'nc-1', status: 'in_review' });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /^start review$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^start review$/i }));

    await waitFor(() => expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalledTimes(1));
    expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nc-1', status: 'in_review' }),
    );
  });

  it('omits empty optional fields rather than sending blank strings', async () => {
    nomineeClaims.listNomineeClaims.mockResolvedValue([LIFE_CLAIM]);
    nomineeClaims.reviewNomineeClaim.mockResolvedValue({ id: 'nc-1', status: 'in_review' });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /^start review$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^start review$/i }));

    await waitFor(() => expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalled());
    // The RPC COALESCEs nulls onto the existing values; '' would blank them.
    expect(nomineeClaims.reviewNomineeClaim).toHaveBeenCalledWith({
      id: 'nc-1', status: 'in_review', note: undefined, subscriberId: undefined,
    });
  });

  it('shows an empty state when nothing is awaiting review', async () => {
    nomineeClaims.listNomineeClaims.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/No claims awaiting review/i)).toBeInTheDocument();
  });
});
