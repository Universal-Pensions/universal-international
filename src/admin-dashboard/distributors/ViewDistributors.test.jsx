// RTL test for the admin ViewDistributors panel — deactivate / reactivate
// confirm flow (audit L6).
//
// ViewDistributors lists platform distributors with a per-row Deactivate /
// Reactivate control. Clicking it opens a confirm Modal; confirming calls the
// set_distributor_status RPC (via useSetDistributorStatus → setDistributorStatus)
// with the TOGGLED status. This pins that contract at the RTL layer (these run in
// `npm test`, unlike the service-role DB regression which is /qa-only):
//   • an ACTIVE row's control reads "Deactivate" and confirms with 'inactive';
//   • an INACTIVE row's control reads "Reactivate" and confirms with 'active'.
//
// Harness modelled on ViewEmployerDetail.test.jsx: ToastProvider +
// AdminPanelProvider + QueryClientProvider, with the entities service mocked so
// no Supabase call is made. The panel renders nothing while viewDistributorsOpen
// is false, so a tiny host opens it on mount.

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ViewDistributors reads useAllEntities('distributor') → getAllAtLevel, and
// usePlatformOverview → getPlatformOverview, and mutates via
// useSetDistributorStatus → setDistributorStatus. Mock exactly those.
vi.mock('../../services/entities', () => ({
  getAllAtLevel: vi.fn(),
  getPlatformOverview: vi.fn(),
  setDistributorStatus: vi.fn(),
  // Per-distributor counts (0088) — each row shows its own reach, not the
  // platform's. Empty map is fine here; the rows fall back to 0.
  getDistributorRollup: vi.fn(() => Promise.resolve({})),
}));

const entities = await import('../../services/entities');
const { AdminPanelProvider, useAdminPanel } = await import('../../contexts/AdminPanelContext');
const { ToastProvider } = await import('../../contexts/ToastContext');
const { default: ViewDistributors } = await import('./ViewDistributors');

// Host that opens the panel on mount (it renders nothing while
// viewDistributorsOpen is false).
function OpenOnMount() {
  const { setViewDistributorsOpen } = useAdminPanel();
  React.useEffect(() => { setViewDistributorsOpen(true); }, [setViewDistributorsOpen]);
  return <ViewDistributors />;
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

const PLATFORM = {
  distributors: 2, branches: 316, agents: 2049, totalSubscribers: 5000, aum: 12_400_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  entities.getPlatformOverview.mockResolvedValue(PLATFORM);
});
afterEach(() => { vi.resetAllMocks(); });

describe('<ViewDistributors /> deactivate / reactivate confirm flow', () => {
  it('deactivates an ACTIVE distributor: confirm calls setDistributorStatus with "inactive"', async () => {
    entities.getAllAtLevel.mockResolvedValue([
      {
        id: 'd-001', name: 'National Distributor', status: 'active',
        managerName: 'Grace Auma', managerPhone: '+256700000021',
        managerEmail: 'ops@upensions.demo', parentId: 'ug', createdAt: '2026-01-10T00:00:00Z',
      },
    ]);
    entities.setDistributorStatus.mockResolvedValue({
      id: 'd-001', status: 'inactive', branchesUpdated: 316, agentsUpdated: 2049, subscribersDetached: 0,
    });
    const user = userEvent.setup();
    renderPanel();

    // Row resolves from the mocked getAllAtLevel.
    expect(await screen.findByText('National Distributor')).toBeInTheDocument();

    // An active distributor's row control reads "Deactivate".
    const rowBtn = await screen.findByRole('button', { name: /^deactivate$/i });
    await user.click(rowBtn);

    // Confirm inside the modal dialog (the dialog confirm button shares the
    // "Deactivate" label with the row button, so scope to the dialog).
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^deactivate$/i }));

    // The RPC is invoked with the TOGGLED status.
    await waitFor(() => expect(entities.setDistributorStatus).toHaveBeenCalledTimes(1));
    expect(entities.setDistributorStatus).toHaveBeenCalledWith('d-001', 'inactive');
  });

  it('reactivates an INACTIVE distributor: control reads "Reactivate" and confirms with "active"', async () => {
    entities.getAllAtLevel.mockResolvedValue([
      {
        id: 'd-002', name: 'Secondary Distributor', status: 'inactive',
        managerName: 'Moses Opio', managerPhone: '+256700000022',
        managerEmail: null, parentId: 'ug', createdAt: '2026-02-14T00:00:00Z',
      },
    ]);
    entities.setDistributorStatus.mockResolvedValue({
      id: 'd-002', status: 'active', branchesUpdated: 0, agentsUpdated: 0, subscribersDetached: 0,
    });
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('Secondary Distributor')).toBeInTheDocument();

    // An inactive distributor's row control reads "Reactivate" (NOT "Deactivate").
    expect(screen.queryByRole('button', { name: /^deactivate$/i })).toBeNull();
    const rowBtn = await screen.findByRole('button', { name: /^reactivate$/i });
    await user.click(rowBtn);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^reactivate$/i }));

    await waitFor(() => expect(entities.setDistributorStatus).toHaveBeenCalledTimes(1));
    expect(entities.setDistributorStatus).toHaveBeenCalledWith('d-002', 'active');
  });
});
