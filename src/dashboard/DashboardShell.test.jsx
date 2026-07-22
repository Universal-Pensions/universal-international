// RTL tests for the distributor DashboardShell — the source-of-truth for the
// two-mode (dash⇄map) toggle, the lazy `mapMounted` guard, and the expandable
// rail that the admin shell later mirrors. AdminDashboardShell had a smoke test
// but this origin logic had none (audit tests-build dimension).
//
// Unlike the admin smoke test, this renders the REAL Sidebar so the "Map view"
// switch and the rail collapse control are reachable and the toggle behavior can
// actually be driven. The heavy/data-bound leaves (Leaflet map, DistributorOverview,
// overlay chrome, the view panels) are stubbed; the REAL DashboardProvider runs so
// a provider-wiring regression still surfaces.

import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Env / data hooks ─────────────────────────────────────────────────────────
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
// NavAnnouncer (useCurrentEntity) + the real Sidebar's count labels (useEntityMetrics).
vi.mock('../hooks/useEntity', () => ({
  useCurrentEntity: () => ({ data: null }),
  useEntityMetrics: () => ({ data: { totalBranches: 316, totalAgents: 2049, totalSubscribers: 5000 } }),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

// ── Heavy / data-bound children → light stubs ────────────────────────────────
// The lazy map records its `visible` prop so the toggle test can assert the
// mount-once-and-hide contract across a dash→map→dash cycle.
vi.mock('./map/UgandaMap', () => ({
  default: ({ visible }) => <div data-testid="uganda-map" data-visible={String(visible)} />,
}));
vi.mock('./overview/DistributorOverview', () => ({ default: () => <div data-testid="distributor-overview">National Network</div> }));
vi.mock('./overlay/OverlayPanel', () => ({ default: () => <div data-testid="overlay-panel" /> }));
vi.mock('./overlay/Breadcrumb', () => ({ default: () => <div data-testid="breadcrumb" /> }));
vi.mock('./overlay/DataCopilotPanel', () => ({ default: () => null, AskAiFab: () => null }));
vi.mock('./branch/CreateBranch', () => ({ default: () => null }));
vi.mock('./branch/ViewBranches', () => ({ default: () => null }));
vi.mock('./agent/ViewAgents', () => ({ default: () => null }));
vi.mock('./subscriber/ViewSubscribers', () => ({ default: () => null }));
vi.mock('./reports/ViewReports', () => ({ default: () => null }));
vi.mock('./commissions/CommissionPanel', () => ({ default: () => null }));
vi.mock('./settings/Settings', () => ({ default: () => null }));
vi.mock('./tickets/ViewTickets', () => ({ default: () => null }));

const { default: DashboardShell } = await import('./DashboardShell');

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DashboardShell />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('<DashboardShell /> (distributor two-mode shell)', () => {
  it('mounts and defaults to dash mode: the rich DistributorOverview at country level, no map', () => {
    renderShell();
    expect(document.getElementById('main')).not.toBeNull();
    expect(screen.getByTestId('distributor-overview')).toBeInTheDocument();
    // Lazy map is not mounted until the first map-mode entry.
    expect(screen.queryByTestId('uganda-map')).toBeNull();
    // Map-mode chrome is hidden in dash mode.
    expect(screen.queryByTestId('breadcrumb')).toBeNull();
    expect(screen.queryByTestId('overlay-panel')).toBeNull();
  });

  it('defaults the rail to expanded', () => {
    renderShell();
    expect(document.querySelector('[data-rail]')?.getAttribute('data-rail')).toBe('expanded');
  });

  it('Map view toggle mounts the map once, then keeps it mounted (hidden) across dash⇄map', async () => {
    renderShell();
    const toggle = screen.getByRole('switch', { name: 'Map view' });

    // dash → map: the lazy map mounts and receives visible=true; the overview goes away.
    fireEvent.click(toggle);
    const map = await screen.findByTestId('uganda-map');
    expect(map.getAttribute('data-visible')).toBe('true');
    expect(screen.queryByTestId('distributor-overview')).toBeNull();

    // map → dash: the map is KEPT mounted (Leaflet instance + drill state survive)
    // but hidden (visible=false); the overview returns.
    fireEvent.click(toggle);
    expect(screen.getByTestId('uganda-map').getAttribute('data-visible')).toBe('false');
    expect(screen.getByTestId('distributor-overview')).toBeInTheDocument();
  });

  it('collapsing the rail flips the shell data-rail attribute', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
    expect(document.querySelector('[data-rail]')?.getAttribute('data-rail')).toBe('collapsed');
    // And the expand control is now available to re-open it.
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
  });
});
