// RTL tests for the distributor PHONE shell — the <1024px app-bar + five-tab
// bottom-nav PWA that replaces the retired hamburger-drawer mobile experience.
// Every routed page + the copilot are stubbed so no data hooks fire; this proves
// the shell chrome (app bar, bottom tabs) and the nested routing, not page data.

import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../mobile/DistributorHomeMobile', () => ({ default: () => <div data-testid="page-home">Home</div> }));
vi.mock('../mobile/BranchesMobile', () => ({ default: () => <div data-testid="page-branches" /> }));
vi.mock('../mobile/BranchDetailMobile', () => ({ default: () => <div data-testid="page-branch-detail" /> }));
vi.mock('../mobile/AgentsMobile', () => ({ default: () => <div data-testid="page-agents" /> }));
vi.mock('../mobile/AgentDetailMobile', () => ({ default: () => <div data-testid="page-agent-detail" /> }));
vi.mock('../mobile/CommissionsMobile', () => ({ default: () => <div data-testid="page-commissions" /> }));
vi.mock('../mobile/SubscribersMobile', () => ({ default: () => <div data-testid="page-subscribers" /> }));
vi.mock('../mobile/SubscriberDetailMobile', () => ({ default: () => <div data-testid="page-subscriber-detail" /> }));
vi.mock('../mobile/ReportsMobile', () => ({ default: () => <div data-testid="page-reports" /> }));
vi.mock('../mobile/ReportViewMobile', () => ({ default: () => <div data-testid="page-report-view" /> }));
vi.mock('../mobile/SupportMobile', () => ({ default: () => <div data-testid="page-support" /> }));
vi.mock('../mobile/ThreadMobile', () => ({ default: () => <div data-testid="page-thread" /> }));
vi.mock('../mobile/SettingsMobile', () => ({ default: () => <div data-testid="page-settings" /> }));
vi.mock('../mobile/DistributorHubMobile', () => ({ default: () => <div data-testid="page-hub" /> }));
vi.mock('../overlay/DataCopilotPanel', () => ({ default: () => null }));

const { default: DistributorMobileShell } = await import('./DistributorMobileShell');

function renderAt(path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/dashboard/*" element={<DistributorMobileShell />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('<DistributorMobileShell /> (distributor phone shell)', () => {
  it('renders the app bar, five-tab bottom nav, and the Home route by default', () => {
    renderAt('/dashboard');
    expect(document.getElementById('main')).not.toBeNull();
    expect(screen.getByTestId('page-home')).toBeInTheDocument();
    ['Home', 'Branches', 'Agents', 'Commissions', 'Menu'].forEach((label) => {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    });
    // App-bar Ask-AI action + the brand logo on Home (no hamburger anywhere).
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeInTheDocument();
    expect(screen.getByAltText('Universal Pensions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /menu/i })).not.toBeInTheDocument();
  });

  it('resolves a deep tab route (agents) to its page', () => {
    renderAt('/dashboard/agents');
    expect(screen.getByTestId('page-agents')).toBeInTheDocument();
  });

  it('resolves a detail route (agent) to its page with a back button', () => {
    renderAt('/dashboard/agents/a-001');
    expect(screen.getByTestId('page-agent-detail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
