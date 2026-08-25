// RTL regression tests for two AUDIT 2026-08-23 findings on the branch admin
// PHONE shell (<1024px):
//
//   A12-004 — /dashboard/reports used to oscillate between /dashboard/analytics
//   and /dashboard and settle on the wrong one (/dashboard). The root cause was
//   DashboardNavContext's reports-panel effect wrongly intercepting the branch
//   role on every viewport (it was only ever supposed to gate the distributor
//   DESKTOP panel) and racing BranchMobileShell's own `reports` → `/analytics`
//   route. Fixed in DashboardNavContext.jsx (`usesReportsPanel` is now
//   `role === 'distributor' && isDesktop`) alongside A13-001 — branch has been
//   fully routed on both desktop AND mobile since the map-theme redesign and
//   was never supposed to hit that panel-intercept effect at all.
//
//   A12-005 — a branch admin on a phone had no way to reach a specific agent's
//   subscriber list: no route, no entry point (AgentDetailMobile had only
//   "Call" + "Back to team"). Fixed by adding the agents/:agentId/subscribers
//   route (AgentSubscribersMobile.jsx, mirroring the desktop
//   BranchAgentSubscribers.jsx) + a "View subscribers" link on
//   AgentDetailMobile.
//
// Renders the REAL top-level BranchDashboardShell (DashboardProvider →
// DashboardNavProvider + DashboardPanelProvider, plus BranchScopeProvider and
// the mobile/desktop selector) at mobile width so the REAL DashboardNavContext
// participates — a bare BranchMobileShell render would miss the
// DashboardNavContext half of the A12-004 regression entirely.

import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'branch', user: { role: 'branch', branchId: 'b-kam-015' }, logout: vi.fn() }),
}));

// Routed pages → light stubs (mirrors DistributorMobileShell.test.jsx's own
// convention: every routed page is stubbed so no data hooks fire — this
// proves the shell chrome + the nested routing, not page data).
vi.mock('../mobile/BranchHomeMobile', () => ({ default: () => <div data-testid="page-home" /> }));
vi.mock('../mobile/AttentionAgentsMobile', () => ({ default: () => <div data-testid="page-attention" /> }));
vi.mock('../mobile/AgentsMobile', () => ({ default: () => <div data-testid="page-agents" /> }));
vi.mock('../mobile/AgentDetailMobile', () => ({ default: () => <div data-testid="page-agent-detail" /> }));
vi.mock('../mobile/CreateAgentMobile', () => ({ default: () => <div data-testid="page-agent-new" /> }));
vi.mock('../mobile/CommissionsMobile', () => ({ default: () => <div data-testid="page-commissions" /> }));
vi.mock('../mobile/AnalyticsMobile', () => ({ default: () => <div data-testid="page-analytics" /> }));
vi.mock('../mobile/SupportMobile', () => ({ default: () => <div data-testid="page-support" /> }));
vi.mock('../mobile/ThreadMobile', () => ({ default: () => <div data-testid="page-thread" /> }));
vi.mock('../mobile/BranchHubMobile', () => ({ default: () => <div data-testid="page-hub" /> }));
vi.mock('../mobile/SettingsMobile', () => ({ default: () => <div data-testid="page-settings" /> }));
vi.mock('../../dashboard/settings/Settings', () => ({ default: () => null }));
vi.mock('../overlay/DataCopilotPanel', () => ({ default: () => null, AskAiFab: () => null }));
// AgentSubscribersMobile (new, A12-005) is left REAL — it's the thing under
// test. Stub the heavy shared ViewSubscribers panel it renders so this proves
// routing + prop-forwarding, not ViewSubscribers' own data/virtualizer
// behaviour (owned by a concurrent perf workstream, AUDIT A21-001/A19-004).
vi.mock('../../dashboard/subscriber/ViewSubscribers', () => ({
  default: ({ scope, fullPage }) => (
    <div
      data-testid="agent-subscribers"
      data-agent-id={scope?.agentId ?? ''}
      data-full-page={String(!!fullPage)}
    />
  ),
}));

const { default: BranchDashboardShell } = await import('../BranchDashboardShell');

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderAt(path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <LocationProbe />
        <Routes>
          <Route path="/dashboard/*" element={<BranchDashboardShell />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('<BranchDashboardShell /> phone shell — routing regressions (audit 2026-08-23)', () => {
  it('A12-004: /dashboard/reports resolves to /dashboard/analytics, not the /dashboard catch-all', async () => {
    renderAt('/dashboard/reports');
    expect(await screen.findByTestId('page-analytics')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe').textContent).toBe('/dashboard/analytics');
  });

  it('A12-005: /dashboard/agents/:agentId/subscribers renders the agent-scoped subscriber list', async () => {
    renderAt('/dashboard/agents/a-087/subscribers');
    const panel = await screen.findByTestId('agent-subscribers');
    expect(panel.dataset.agentId).toBe('a-087');
    expect(panel.dataset.fullPage).toBe('true');
    expect(screen.getByTestId('location-probe').textContent).toBe('/dashboard/agents/a-087/subscribers');
  });

  it('still resolves the plain agent-detail route (agents/:agentId) to its own page, not the subscribers route', async () => {
    renderAt('/dashboard/agents/a-087');
    expect(await screen.findByTestId('page-agent-detail')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-subscribers')).toBeNull();
  });
});
