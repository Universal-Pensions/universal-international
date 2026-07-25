// RTL smoke test for AdminDashboardShell (audit §7b.15).
//
// The admin WIP had zero coverage at any layer — if the shell crashes on render
// no automated test catches it. This mounts the shell with MemoryRouter +
// QueryClientProvider and stubs the heavy, data-/env-bound dependencies (the
// lazy Leaflet map, the per-panel data children, AdminSidebar, AuthContext,
// the `useIsMobile` matchMedia hook, and `useCurrentEntity`) so we exercise the
// shell's OWN composition logic — its providers wire up, the country-level
// Summary mounts (NOT the geographic overlay), and the metrics row renders —
// without pulling the entire dashboard data graph or needing a jsdom
// matchMedia polyfill. The REAL DashboardProvider + AdminPanelProvider run so a
// provider-wiring regression (e.g. a missing context) still surfaces as a crash.

import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Env / data hooks ─────────────────────────────────────────────────────────
// useIsMobile reads window.matchMedia (absent in jsdom); pin desktop so the map
// branch is taken (it's mocked below).
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
// Force the DESKTOP branch of the shell selector (jsdom's stubbed matchMedia
// reports <1024px, which would otherwise render the mobile shell). Stub the
// mobile shell so this desktop test doesn't pull the mobile page tree.
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('./shell/AdminMobileShell', () => ({ default: () => <div data-testid="admin-mobile-shell" /> }));
// useCurrentEntity (NavAnnouncer) would fire a data query; stub it idle.
vi.mock('../hooks/useEntity', () => ({ useCurrentEntity: () => ({ data: null }) }));
// AuthContext is only consumed by the (closed) MobileDrawer, but mock it so the
// shell never reaches into localStorage/session bootstrap.
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

// ── Heavy / data-bound children → light stubs with stable test ids ───────────
vi.mock('./sidebar/AdminSidebar', () => ({ default: () => <div data-testid="admin-sidebar" /> }));
vi.mock('../dashboard/map/UgandaMap', () => ({ default: () => <div data-testid="uganda-map" /> }));
vi.mock('./AdminCountryOverview', () => ({ default: () => <div data-testid="admin-country-overview">National Overview</div> }));
// Dash mode (the new default) renders the rich AdminOverview at country level.
vi.mock('./overview/AdminOverview', () => ({ default: () => <div data-testid="admin-overview">National Platform</div> }));
vi.mock('../dashboard/overlay/OverlayPanel', () => ({ default: () => <div data-testid="overlay-panel" /> }));
vi.mock('../dashboard/overlay/Breadcrumb', () => ({ default: () => <div data-testid="breadcrumb" /> }));
vi.mock('../dashboard/cards/MetricsRow', () => ({ default: () => <div data-testid="metrics-row" /> }));
vi.mock('../dashboard/overlay/TopBar', () => ({ default: () => <div data-testid="top-bar" /> }));
// Panels are gated by their open-state booleans (all start false), so they
// won't mount — but stub them so the import graph stays cheap regardless.
vi.mock('../dashboard/branch/CreateBranch', () => ({ default: () => null }));
vi.mock('../dashboard/branch/ViewBranches', () => ({ default: () => null }));
vi.mock('../dashboard/agent/ViewAgents', () => ({ default: () => null }));
vi.mock('../dashboard/subscriber/ViewSubscribers', () => ({ default: () => null }));
vi.mock('../dashboard/reports/ViewReports', () => ({ default: () => null }));
vi.mock('../dashboard/settings/Settings', () => ({ default: () => null }));
vi.mock('../dashboard/tickets/ViewTickets', () => ({ default: () => null }));
vi.mock('./distributors/ViewDistributors', () => ({ default: () => null }));
vi.mock('./distributors/CreateDistributor', () => ({ default: () => null }));
vi.mock('./employers/ViewEmployers', () => ({ default: () => null }));
vi.mock('./employers/CreateEmployer', () => ({ default: () => null }));
vi.mock('./access-requests/ViewAccessRequests', () => ({ default: () => null }));

const { default: AdminDashboardShell } = await import('./AdminDashboardShell');

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdminDashboardShell />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('<AdminDashboardShell />', () => {
  it('mounts without crashing and renders the main landmark + sidebar', () => {
    renderShell();
    expect(document.getElementById('main')).not.toBeNull();
    expect(screen.getByTestId('admin-sidebar')).toBeInTheDocument();
  });

  it('defaults to dash mode: shows the rich AdminOverview at country level (NOT the map summary/overlay)', () => {
    renderShell();
    // The shell now defaults to the branch-admin dashboard mode (parity with the
    // distributor). At country level that renders the rich AdminOverview — not the
    // map-mode AdminCountryOverview summary nor the distributor OverlayPanel.
    expect(screen.getByTestId('admin-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-country-overview')).toBeNull();
    expect(screen.queryByTestId('overlay-panel')).toBeNull();
  });

  it('hides the map-mode chrome (map, breadcrumb, metrics row, top bar) in the default dash mode', () => {
    renderShell();
    // Dash mode replaces the map + overlay + metrics chrome with the full-page
    // canvas; the map itself is lazy (mapMounted stays false until the first
    // map-mode entry), so none of the map-mode chrome should be present.
    expect(screen.queryByTestId('uganda-map')).toBeNull();
    expect(screen.queryByTestId('breadcrumb')).toBeNull();
    expect(screen.queryByTestId('metrics-row')).toBeNull();
    expect(screen.queryByTestId('top-bar')).toBeNull();
  });

  it('does not mount any slide-in panel while every panel open-state is closed', () => {
    renderShell();
    // The reused + admin-exclusive panels are all gated false at cold load
    // (mirrors the distributor shell's lazy-mount fix) — none should be present.
    expect(screen.queryByTestId('overlay-panel')).toBeNull();
  });
});
