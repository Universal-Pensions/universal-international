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
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Env / data hooks ─────────────────────────────────────────────────────────
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
// Force the DESKTOP branch of the shell selector (jsdom's stubbed matchMedia
// reports <1024px, which would otherwise render the mobile shell). The mobile
// shell is stubbed so this desktop test doesn't pull the whole mobile page tree.
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('./shell/DistributorMobileShell', () => ({ default: () => <div data-testid="distributor-mobile-shell" /> }));
// NavAnnouncer (useCurrentEntity) + the real Sidebar's count labels (useEntityMetrics).
vi.mock('../hooks/useEntity', () => ({
  useCurrentEntity: () => ({ data: null }),
  useEntityMetrics: () => ({ data: { totalBranches: 316, totalAgents: 2049, totalSubscribers: 5000 } }),
}));
// role: 'distributor' — needed so DashboardPanelContext.jsx's AUDIT A19-001
// sessionStorage persistence (role-gated to distributor/admin) actually
// activates in this suite's tests below. Adding it is additive (no existing
// mock field removed); DashboardNavContext's role-gated
// `usesReportsPanel` effect only fires for pathname === '/dashboard/reports'
// and every test here renders at the default '/', so this does not change
// any existing test's behaviour.
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'distributor', logout: vi.fn() }) }));

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
  // AUDIT A19-001 tests below read/write real sessionStorage (the mechanism
  // this fix uses instead of the URL — see DashboardPanelContext.jsx's header
  // comment). Clear it before every test so persistence from one test can
  // never leak into the next, regardless of run order.
  beforeEach(() => {
    try { window.sessionStorage.clear(); } catch { /* private-browsing */ }
  });

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

  describe('AUDIT A19-001 — refresh no longer reverts map mode to dash', () => {
    it('restores map mode on a fresh mount after the tab was left in map mode', async () => {
      const { unmount } = renderShell();
      const toggle = screen.getByRole('switch', { name: 'Map view' });
      fireEvent.click(toggle); // dash -> map
      await screen.findByTestId('uganda-map');
      unmount(); // simulates the tab closing; sessionStorage survives a reload, unlike component state

      renderShell();
      // Restored on the VERY FIRST render (lazy useState init, not a post-mount
      // effect) — no Overview flash, and the map is mounted (not just requested)
      // so it isn't a blank canvas.
      expect(screen.queryByTestId('distributor-overview')).toBeNull();
      const map = await screen.findByTestId('uganda-map');
      expect(map.getAttribute('data-visible')).toBe('true');
    });

    it('does not resurrect a stale map visit once the user has returned to dash mode', async () => {
      const { unmount } = renderShell();
      const toggle = screen.getByRole('switch', { name: 'Map view' });
      fireEvent.click(toggle); // dash -> map
      await screen.findByTestId('uganda-map');
      fireEvent.click(toggle); // map -> dash
      unmount();

      renderShell();
      // The LATEST mode (dash) wins, not "was map ever visited this session".
      expect(screen.getByTestId('distributor-overview')).toBeInTheDocument();
    });
  });
});
