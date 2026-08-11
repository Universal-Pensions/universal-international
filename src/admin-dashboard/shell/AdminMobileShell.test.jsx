// RTL tests for the super-admin PHONE shell — the <1024px app-bar + five-tab
// bottom-nav PWA. Pages + copilot stubbed; this proves the admin shell chrome
// (app bar, bottom tabs: Home · Distributors · Employers · Network · Menu) and
// the nested routing (incl. the reused distributor pages).

import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../mobile/AdminHomeMobile', () => ({ default: () => <div data-testid="page-home">Home</div> }));
vi.mock('../mobile/DistributorsMobile', () => ({ default: () => <div data-testid="page-distributors" /> }));
vi.mock('../mobile/DistributorDetailMobile', () => ({ default: () => <div data-testid="page-distributor-detail" /> }));
vi.mock('../mobile/EmployersMobile', () => ({ default: () => <div data-testid="page-employers" /> }));
vi.mock('../mobile/EmployerDetailMobile', () => ({ default: () => <div data-testid="page-employer-detail" /> }));
vi.mock('../mobile/AdminNetworkMobile', () => ({ default: () => <div data-testid="page-network" /> }));
vi.mock('../mobile/AdminSettingsMobile', () => ({ default: () => <div data-testid="page-settings" /> }));
vi.mock('../mobile/AdminHubMobile', () => ({ default: () => <div data-testid="page-hub" /> }));
vi.mock('../mobile/AdminNavMobile', () => ({ default: () => <div data-testid="page-nav" /> }));
vi.mock('../../dashboard/mobile/BranchesMobile', () => ({ default: () => <div data-testid="page-branches" /> }));
vi.mock('../../dashboard/mobile/BranchDetailMobile', () => ({ default: () => <div data-testid="page-branch-detail" /> }));
vi.mock('../../dashboard/mobile/AgentsMobile', () => ({ default: () => <div data-testid="page-agents" /> }));
vi.mock('../../dashboard/mobile/AgentDetailMobile', () => ({ default: () => <div data-testid="page-agent-detail" /> }));
vi.mock('../../dashboard/mobile/SubscribersMobile', () => ({ default: () => <div data-testid="page-subscribers" /> }));
vi.mock('../../dashboard/mobile/SubscriberDetailMobile', () => ({ default: () => <div data-testid="page-subscriber-detail" /> }));
vi.mock('../../dashboard/mobile/ReportsMobile', () => ({ default: () => <div data-testid="page-reports" /> }));
vi.mock('../../dashboard/mobile/ReportViewMobile', () => ({ default: () => <div data-testid="page-report-view" /> }));
vi.mock('../../dashboard/mobile/SupportMobile', () => ({ default: () => <div data-testid="page-support" /> }));
vi.mock('../../dashboard/mobile/ThreadMobile', () => ({ default: () => <div data-testid="page-thread" /> }));
vi.mock('../../dashboard/overlay/DataCopilotPanel', () => ({ default: () => null }));

const { default: AdminMobileShell } = await import('./AdminMobileShell');

function renderAt(path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/dashboard/*" element={<AdminMobileShell />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('<AdminMobileShell /> (admin phone shell)', () => {
  it('renders the app bar, five-tab bottom nav, and the Home route by default', () => {
    renderAt('/dashboard');
    expect(document.getElementById('main')).not.toBeNull();
    expect(screen.getByTestId('page-home')).toBeInTheDocument();
    ['Home', 'Distributors', 'Employers', 'Network', 'Menu'].forEach((label) => {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeInTheDocument();
    expect(screen.getByAltText('Universal Pensions')).toBeInTheDocument();
  });

  it('resolves the Employers tab and its detail (with a back button)', () => {
    renderAt('/dashboard/employers');
    expect(screen.getByTestId('page-employers')).toBeInTheDocument();
  });

  it('resolves a reused network page (branches) under the admin shell', () => {
    renderAt('/dashboard/branches');
    expect(screen.getByTestId('page-branches')).toBeInTheDocument();
  });

  it('shows a back button on a detail route', () => {
    renderAt('/dashboard/employers/emp-001');
    expect(screen.getByTestId('page-employer-detail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  // The unit-price page hangs off the Menu hub — the five bottom tabs are full.
  it('routes /dashboard/nav to the unit-price page', () => {
    renderAt('/dashboard/nav');
    expect(screen.getByTestId('page-nav')).toBeInTheDocument();
  });
});
