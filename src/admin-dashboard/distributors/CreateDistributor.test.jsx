// RTL smoke test for the admin CreateDistributor form (audit §7b.15).
//
// The new admin WIP had zero coverage at any layer. This mounts the component
// with its real providers (AdminPanelProvider for the open/close state,
// ToastProvider for the live-region toasts, QueryClientProvider for the
// useCreateDistributor mutation) and a mocked entities service so no Supabase
// call is made. It asserts: the panel renders a stable heading + the name field
// when open; a blank-name submit is blocked (inline + toast, no RPC); a valid
// submit calls createDistributor with the trimmed payload (managerName etc. as
// the documented null defaults).

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the service so the mutation never reaches Supabase.
vi.mock('../../services/entities', () => ({
  createDistributor: vi.fn(),
}));

const entities = await import('../../services/entities');
const { AdminPanelProvider, useAdminPanel } = await import('../../contexts/AdminPanelContext');
const { ToastProvider } = await import('../../contexts/ToastContext');
const { default: CreateDistributor } = await import('./CreateDistributor');

// Tiny host that opens the panel on mount (the panel renders nothing while
// createDistributorOpen is false).
function OpenOnMount() {
  const { setCreateDistributorOpen } = useAdminPanel();
  React.useEffect(() => { setCreateDistributorOpen(true); }, [setCreateDistributorOpen]);
  return <CreateDistributor />;
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

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.resetAllMocks(); });

describe('<CreateDistributor />', () => {
  it('renders the heading and the required name field when open (no crash)', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: /new distributor/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/distributor name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create distributor/i })).toBeInTheDocument();
  });

  it('blocks a blank-name submit (inline error + no RPC call)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('heading', { name: /new distributor/i });

    await user.click(screen.getByRole('button', { name: /create distributor/i }));

    // The validation message surfaces in the inline alert region.
    expect(await screen.findByRole('alert')).toHaveTextContent(/distributor name is required/i);
    expect(entities.createDistributor).not.toHaveBeenCalled();
  });

  it('submits a valid form via the createDistributor mutation with trimmed args', async () => {
    entities.createDistributor.mockResolvedValue({ id: 'd-new-1', name: 'Western Region Distributor' });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('heading', { name: /new distributor/i });

    await user.type(screen.getByLabelText(/distributor name/i), '  Western Region Distributor  ');
    await user.type(screen.getByLabelText(/registration no/i), '  80020002345678  ');
    await user.type(screen.getByLabelText(/^district/i), '  Mbarara  ');
    await user.type(screen.getByLabelText(/office address/i), '  Plot 14, High Street  ');
    await user.type(screen.getByLabelText(/manager name/i), '  Jane Mgr  ');
    await user.click(screen.getByRole('button', { name: /create distributor/i }));

    await waitFor(() => expect(entities.createDistributor).toHaveBeenCalledTimes(1));
    expect(entities.createDistributor.mock.calls[0][0]).toEqual({
      name: 'Western Region Distributor',
      // 0095 — parity with the public request-access form, which requires it.
      registrationNo: '80020002345678',
      // 0140 — same parity argument, for geography.
      district: 'Mbarara',
      physicalAddress: 'Plot 14, High Street',
      managerName: 'Jane Mgr',
      // Empty optional fields collapse to the documented null defaults.
      managerPhone: null,
      managerEmail: null,
    });
  });

  // The drift guard for 0140: the admin door must not be able to create a
  // distributor the public request-access form could not, and vice versa.
  it('refuses to submit without a district, and without a real one', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('heading', { name: /new distributor/i });

    await user.type(screen.getByLabelText(/distributor name/i), 'No Geography Ltd');
    await user.type(screen.getByLabelText(/office address/i), 'Plot 14, High Street');
    await user.click(screen.getByRole('button', { name: /create distributor/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/district is required/i);
    expect(entities.createDistributor).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^district/i), 'Atlantis');
    await user.click(screen.getByRole('button', { name: /create distributor/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/pick a uganda district/i);
    expect(entities.createDistributor).not.toHaveBeenCalled();
  });

  it('refuses to submit without an office address', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('heading', { name: /new distributor/i });

    await user.type(screen.getByLabelText(/distributor name/i), 'No Address Ltd');
    await user.type(screen.getByLabelText(/^district/i), 'Mbarara');
    await user.click(screen.getByRole('button', { name: /create distributor/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/office address is required/i);
    expect(entities.createDistributor).not.toHaveBeenCalled();
  });
});
