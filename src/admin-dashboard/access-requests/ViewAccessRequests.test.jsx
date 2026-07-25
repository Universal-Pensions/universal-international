// RTL test for the admin ViewAccessRequests panel — approve / deny confirm flow.
//
// ViewAccessRequests lists PENDING employer/distributor access requests (from the
// public request-access form) with per-row Approve / Deny controls. Clicking one
// opens a confirm Modal; confirming calls approveAccessRequest(id) (which
// provisions the account) or denyAccessRequest(id). This pins that contract:
//   • Approve → confirm calls approveAccessRequest with the row id;
//   • Deny    → confirm calls denyAccessRequest with the row id.
//
// Harness modelled on ViewDistributors.test.jsx: ToastProvider +
// AdminPanelProvider + QueryClientProvider, with the accessRequests service
// mocked so no Supabase call is made. A tiny host opens the panel on mount.

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/accessRequests', () => ({
  listAccessRequests: vi.fn(),
  approveAccessRequest: vi.fn(),
  denyAccessRequest: vi.fn(),
}));

const accessRequests = await import('../../services/accessRequests');
const { AdminPanelProvider, useAdminPanel } = await import('../../contexts/AdminPanelContext');
const { ToastProvider } = await import('../../contexts/ToastContext');
const { default: ViewAccessRequests } = await import('./ViewAccessRequests');

function OpenOnMount() {
  const { setViewAccessRequestsOpen } = useAdminPanel();
  React.useEffect(() => { setViewAccessRequestsOpen(true); }, [setViewAccessRequestsOpen]);
  return <ViewAccessRequests />;
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

const EMPLOYER_REQ = {
  id: 'ar-1', kind: 'employer', orgName: 'Kampala Foods Ltd',
  contactName: 'Sarah Namukasa', contactEmail: 'hr@kfoods.demo', contactPhone: '+256700000123',
  sector: 'Manufacturing', district: 'Kampala', status: 'pending', createdAt: '2026-07-24T00:00:00Z',
};
const DISTRIBUTOR_REQ = {
  id: 'ar-2', kind: 'distributor', orgName: 'Western Networks',
  contactName: 'Moses Opio', contactEmail: 'moses@westnet.demo', contactPhone: '+256700000456',
  status: 'pending', createdAt: '2026-07-24T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => { vi.resetAllMocks(); });

describe('<ViewAccessRequests /> approve / deny confirm flow', () => {
  it('approves a request: confirm calls approveAccessRequest with the row id', async () => {
    accessRequests.listAccessRequests.mockResolvedValue([EMPLOYER_REQ]);
    accessRequests.approveAccessRequest.mockResolvedValue({ id: 'ar-1', status: 'approved', provisionedId: 'emp-x' });
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('Kampala Foods Ltd')).toBeInTheDocument();

    const rowBtn = await screen.findByRole('button', { name: /^approve$/i });
    await user.click(rowBtn);

    // Confirm inside the dialog (its confirm button reads "Approve & create").
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /approve & create/i }));

    await waitFor(() => expect(accessRequests.approveAccessRequest).toHaveBeenCalledTimes(1));
    expect(accessRequests.approveAccessRequest).toHaveBeenCalledWith('ar-1');
    expect(accessRequests.denyAccessRequest).not.toHaveBeenCalled();
  });

  it('denies a request: confirm calls denyAccessRequest with the row id', async () => {
    accessRequests.listAccessRequests.mockResolvedValue([DISTRIBUTOR_REQ]);
    accessRequests.denyAccessRequest.mockResolvedValue({ id: 'ar-2', status: 'denied' });
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('Western Networks')).toBeInTheDocument();

    const rowBtn = await screen.findByRole('button', { name: /^deny$/i });
    await user.click(rowBtn);

    // The dialog's confirm button also reads "Deny" — scope to the dialog.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^deny$/i }));

    await waitFor(() => expect(accessRequests.denyAccessRequest).toHaveBeenCalledTimes(1));
    expect(accessRequests.denyAccessRequest).toHaveBeenCalledWith('ar-2');
    expect(accessRequests.approveAccessRequest).not.toHaveBeenCalled();
  });
});
