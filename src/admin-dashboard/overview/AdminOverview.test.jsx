// Data-render test for AdminOverview — the rich admin dash-mode national landing.
// The shell test stubs this component out, so the audit flagged that no test proves
// it reads the PLATFORM-WIDE totals (usePlatformOverview: subscribers incl. the
// employer channel) rather than the agent-tree country rollup. This renders the REAL
// component with fixtures where ONLY usePlatformOverview carries the subscriber/agent
// counts, so the assertions prove the platform hook is the source.

import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatNumber } from '../../utils/currency';

vi.mock('../../contexts/DashboardContext', () => ({
  useDashboard: () => ({
    drillDown: vi.fn(),
    setViewSubscribersOpen: vi.fn(),
    setViewAgentsOpen: vi.fn(),
    setViewBranchesOpen: vi.fn(),
    setDrillTargetBranchId: vi.fn(),
    setDrillTargetAgentId: vi.fn(),
  }),
}));
vi.mock('../../contexts/AdminPanelContext', () => ({
  useAdminPanel: () => ({ setViewDistributorsOpen: vi.fn(), setViewEmployersOpen: vi.fn() }),
}));
vi.mock('../../hooks/useEntity', () => ({
  // Platform totals — the only source of subscriber/agent/channel counts.
  usePlatformOverview: () => ({
    data: {
      totalSubscribers: 5060,
      activeSubscribers: 3959,
      inactiveSubscribers: 1101,
      aum: 1_889_000_000,
      totalContributions: 1_889_000_000,
      agents: 2043,
      branches: 318,
      distributors: 3,
      employers: 7,
      subscribersViaDistributor: 4500,
      subscribersViaEmployer: 500,
      subscribersDirect: 60,
    },
  }),
  // Country rollup — only the time-series fields are read from here.
  useEntityMetrics: () => ({
    data: {
      monthlyContributions: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map((n) => n * 1_000_000),
      newSubscribersToday: 9,
      dailyContributions: 2_100_000,
    },
  }),
  useAllEntities: () => ({ data: [] }),
  useChildren: () => ({ data: [] }),
  useChildrenMetrics: () => ({ data: {} }),
  // Bounded server-side top-N (0077). Rows are display-ready incl. parentName.
  useTopEntities: (level) => ({
    data: level === 'branch'
      ? [{ id: 'b1', name: 'Top Branch', parentId: 'd1', parentName: 'Kampala', managerName: 'Jane Doe', status: 'active', m: { totalSubscribers: 55, activeRate: 90, aum: 22_000_000, totalContributions: 20_000_000 } }]
      : [{ id: 'a1', name: 'Top Agent', parentId: 'b1', parentName: 'Jinja Road', managerName: null, status: 'active', m: { totalSubscribers: 8, activeRate: 100, aum: 4_000_000, totalContributions: 4_200_000 } }],
  }),
}));
vi.mock('../../dashboard/shared/MiniChart', () => ({ default: () => <div data-testid="mini-chart" /> }));

const { default: AdminOverview } = await import('./AdminOverview');

describe('<AdminOverview />', () => {
  it('renders platform-wide totals (from usePlatformOverview), not the agent-tree rollup', () => {
    render(<AdminOverview />);
    expect(screen.getByText('National Platform')).toBeInTheDocument();
    expect(screen.getByText('Platform Admin')).toBeInTheDocument();
    expect(screen.getByText('Platform network')).toBeInTheDocument();
    // Agents tile reads platform.agents (unique on the page).
    expect(screen.getByText(formatNumber(2043))).toBeInTheDocument();
    // Subscribers count reads platform.totalSubscribers (5,060 exists ONLY in the
    // platform mock, so this proves the platform hook is the source, not the country rollup).
    expect(screen.getAllByText(formatNumber(5060)).length).toBeGreaterThan(0);
    // Top-N table renders the RPC's display-ready rows incl. parentName.
    expect(screen.getByText('Top Branch')).toBeInTheDocument();
    expect(screen.getByText('Kampala')).toBeInTheDocument();
    expect(screen.getByText('Top Agent')).toBeInTheDocument();
    expect(screen.getByText('Jinja Road')).toBeInTheDocument();
  });
});
