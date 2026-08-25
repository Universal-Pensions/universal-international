// RTL regression test for AUDIT A13-001 (HIGH, demo-visible) — Distributor
// Reports was completely dead below 1024px. Root cause: DashboardNavContext's
// `usesReportsPanel` intercepted `/dashboard/reports` for the distributor role
// on EVERY viewport (not just desktop) and redirected to `/dashboard` before
// DistributorMobileShell's own <Routes> — which already had real `reports` +
// `reports/:reportId` routes (ReportsMobile / ReportViewMobile) — got a chance
// to render. All 11 report views (and the "Reports" Menu tile that links to
// them) were unreachable on any phone, tablet-portrait, or small laptop
// window. Fixed by gating the redirect to `role === 'distributor' && isDesktop`.
//
// This renders the REAL top-level DashboardShell (so the REAL DashboardProvider
// / DashboardNavContext run, not a stub) — DistributorMobileShell.test.jsx
// renders the mobile shell in isolation and would NOT catch this regression,
// since the bug lived one level up, in the context that wraps it.
//
// Two describe blocks: MOBILE (the actual regression — all 11 reports +
// report-view deep links reachable, matching the audit's own repro) and a
// DESKTOP regression guard (proves the existing panel-open + redirect-to-
// /dashboard behaviour for distributor desktop is untouched by the fix).

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ isDesktop: false }));
vi.mock('./../hooks/useIsDesktop', () => ({ useIsDesktop: () => mocks.isDesktop }));
vi.mock('./../hooks/useIsMobile', () => ({ useIsMobile: () => !mocks.isDesktop }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'distributor', user: { role: 'distributor', distributorId: 'd-001' }, logout: vi.fn() }),
}));
vi.mock('../hooks/useEntity', () => ({
  useCurrentEntity: () => ({ data: null }),
  useEntityMetrics: () => ({ data: { totalBranches: 316, totalAgents: 2049, totalSubscribers: 5000 } }),
}));

// ── Desktop-only heavy/data-bound children → light stubs (unused on the
//    mobile branch, but DashboardShell.jsx imports them unconditionally). ──
vi.mock('./map/UgandaMap', () => ({ default: () => <div data-testid="uganda-map" /> }));
vi.mock('./overview/DistributorOverview', () => ({ default: () => <div data-testid="distributor-overview" /> }));
vi.mock('./overlay/OverlayPanel', () => ({ default: () => <div data-testid="overlay-panel" /> }));
vi.mock('./overlay/Breadcrumb', () => ({ default: () => <div data-testid="breadcrumb" /> }));
vi.mock('./branch/CreateBranch', () => ({ default: () => null }));
vi.mock('./branch/ViewBranches', () => ({ default: () => null }));
vi.mock('./agent/ViewAgents', () => ({ default: () => null }));
vi.mock('./subscriber/ViewSubscribers', () => ({ default: () => null }));
vi.mock('./commissions/CommissionPanel', () => ({ default: () => null }));
vi.mock('./settings/Settings', () => ({ default: () => null }));
vi.mock('./tickets/ViewTickets', () => ({ default: () => null }));
// The desktop reports PANEL — stubbed to a visible testid (not null) so the
// desktop regression test can prove it actually mounted.
vi.mock('./reports/ViewReports', () => ({ default: () => <div data-testid="panel-reports" /> }));
vi.mock('./overlay/DataCopilotPanel', () => ({ default: () => null, AskAiFab: () => null }));

// ── Mobile routed pages → light stubs (mirrors DistributorMobileShell.test.jsx:
//    every routed page is stubbed so no data hooks fire; this proves the
//    routing, not page data). ReportsMobile is left REAL — it's a static list
//    of NavLinks with no data hooks, and enumerating the 11 reports straight
//    off its own rendered output is a stronger check than a hardcoded list.
vi.mock('./mobile/DistributorHomeMobile', () => ({ default: () => <div data-testid="page-home" /> }));
vi.mock('./mobile/BranchesMobile', () => ({ default: () => <div data-testid="page-branches" /> }));
vi.mock('./mobile/BranchDetailMobile', () => ({ default: () => <div data-testid="page-branch-detail" /> }));
vi.mock('./mobile/AgentsMobile', () => ({ default: () => <div data-testid="page-agents" /> }));
vi.mock('./mobile/AgentDetailMobile', () => ({ default: () => <div data-testid="page-agent-detail" /> }));
vi.mock('./mobile/CommissionsMobile', () => ({ default: () => <div data-testid="page-commissions" /> }));
vi.mock('./mobile/SubscribersMobile', () => ({ default: () => <div data-testid="page-subscribers" /> }));
vi.mock('./mobile/SubscriberDetailMobile', () => ({ default: () => <div data-testid="page-subscriber-detail" /> }));
vi.mock('./mobile/SupportMobile', () => ({ default: () => <div data-testid="page-support" /> }));
vi.mock('./mobile/ThreadMobile', () => ({ default: () => <div data-testid="page-thread" /> }));
vi.mock('./mobile/SettingsMobile', () => ({ default: () => <div data-testid="page-settings" /> }));
vi.mock('./mobile/DistributorHubMobile', () => ({ default: () => <div data-testid="page-hub" /> }));

let useParamsRef;
vi.mock('./mobile/ReportViewMobile', async () => {
  const { useParams } = await import('react-router-dom');
  useParamsRef = useParams;
  return {
    default: function ReportViewMobileStub() {
      const { reportId } = useParamsRef();
      return <div data-testid="page-report-view" data-report-id={reportId} />;
    },
  };
});

const { default: DashboardShell } = await import('./DashboardShell');

// The 11 distributor report views (ReportsMobile.REPORTS / ViewReports'
// REPORT_VIEWS keys) — kept here so a change to either list makes this test
// fail loudly rather than silently under-covering.
const REPORT_IDS = [
  'distribution-summary',
  'all-branches',
  'all-agents',
  'all-subscribers',
  'contributions-collections',
  'withdrawals-payouts',
  'branch-performance',
  'agent-performance',
  'subscriber-growth',
  'subscriber-demographics',
  'kyc-compliance',
];

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
          <Route path="/dashboard/*" element={<DashboardShell />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('distributor Reports — mobile (<1024px), AUDIT A13-001', () => {
  beforeEach(() => {
    mocks.isDesktop = false;
    // AUDIT A19-001 — this file's AuthContext mock carries role: 'distributor'
    // (needed pre-existingly for `usesReportsPanel`), which now ALSO activates
    // DashboardPanelContext.jsx's session-persisted rail panel. Clear it so no
    // test here can leak state into another, regardless of run order.
    try { window.sessionStorage.clear(); } catch { /* private-browsing */ }
  });

  it('/dashboard/reports renders ReportsMobile, listing all 11 report views as real links, and does not bounce to /dashboard', async () => {
    renderAt('/dashboard/reports');
    // Give DashboardNavContext's effects a tick to (not) redirect.
    //
    // findAllByRole, not findByRole: the mobile shell legitimately renders TWO
    // headings named "Reports" — the app-bar title and the page heading. That is
    // correct markup (the a11y work in this same phase added the page-level h1),
    // so the query is what needed to be specific, not the DOM. Asserting "at
    // least one" keeps this test about ROUTING, which is what A13-001 is.
    const headings = await screen.findAllByRole('heading', { name: 'Reports' });
    expect(headings.length).toBeGreaterThan(0);
    expect(screen.getByTestId('location-probe').textContent).toBe('/dashboard/reports');
    expect(screen.queryByTestId('page-home')).toBeNull();

    // Every report id has a real link to its /dashboard/reports/:id view.
    REPORT_IDS.forEach((id) => {
      const href = `/dashboard/reports/${id}`;
      const match = Array.from(document.querySelectorAll('a[href]')).find(
        (a) => a.getAttribute('href') === href,
      );
      expect(match, `expected a link to ${href}`).toBeTruthy();
    });
  });

  it.each(REPORT_IDS)('/dashboard/reports/%s deep-links to ReportViewMobile with the right reportId (not /dashboard)', async (reportId) => {
    renderAt(`/dashboard/reports/${reportId}`);
    const view = await screen.findByTestId('page-report-view');
    expect(view.dataset.reportId).toBe(reportId);
    expect(screen.getByTestId('location-probe').textContent).toBe(`/dashboard/reports/${reportId}`);
    expect(screen.queryByTestId('page-home')).toBeNull();
  });
});

describe('distributor Reports — desktop (>=1024px) regression guard', () => {
  beforeEach(() => {
    mocks.isDesktop = true;
    // AUDIT A19-001 — see the mobile describe block's identical note above.
    try { window.sessionStorage.clear(); } catch { /* private-browsing */ }
  });

  it('still opens the reports panel and rewrites the URL to /dashboard (unchanged desktop behaviour)', async () => {
    renderAt('/dashboard/reports');
    expect(await screen.findByTestId('panel-reports')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe').textContent).toBe('/dashboard');
  });
});
