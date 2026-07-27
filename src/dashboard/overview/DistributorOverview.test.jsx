// Data-render test for DistributorOverview — the rich dash-mode country landing.
// The shell test mocks this component out, so its data wiring was untested: a hook
// return-shape change (useEntity.js) or a mis-read field would ship silently. This
// renders the REAL component with fixture hooks and asserts the KPI tiles show the
// country-rollup totals.

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
    setCommissionsOpen: vi.fn(),
  }),
}));
vi.mock('../../hooks/useEntity', () => ({
  useEntityMetrics: () => ({
    data: {
      totalSubscribers: 4820,
      activeRate: 76,
      totalContributions: 1_889_000_000,
      aum: 1_889_000_000,
      totalAgents: 2049,
      totalBranches: 316,
      coverageRate: 80,
      monthlyContributions: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map((n) => n * 1_000_000),
      newSubscribersToday: 12,
      dailyContributions: 3_400_000,
      newSubscribersThisWeek: 60,
      newSubscribersThisMonth: 240,
    },
  }),
  useAllEntities: () => ({ data: [] }),
  useAllEntitiesMap: () => ({ data: {} }),
  useChildren: () => ({ data: [] }),
  useChildrenMetrics: () => ({ data: {} }),
  // The header now shows the operator's OWN name (a regional distributor is not
  // "National Network"). Undefined here exercises the fallback.
  useEntity: () => ({ data: undefined }),
  // Bounded server-side top-N (0077). Rows are display-ready incl. parentName.
  useTopEntities: (level) => ({
    data: level === 'branch'
      ? [{ id: 'b1', name: 'Top Branch', parentId: 'd1', parentName: 'Kampala', managerName: 'Jane Doe', status: 'active', m: { totalSubscribers: 55, activeRate: 90, aum: 22_000_000, totalContributions: 20_000_000 } }]
      : [{ id: 'a1', name: 'Top Agent', parentId: 'b1', parentName: 'Jinja Road', managerName: null, status: 'active', m: { totalSubscribers: 8, activeRate: 100, aum: 4_000_000, totalContributions: 4_200_000 } }],
  }),
}));
vi.mock('../../hooks/useCommission', () => ({ useEntityCommissionSummary: () => ({ data: null }) }));
// The component reads `user.distributorId` to resolve its own name/footprint.
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { distributorId: 'd-001' } }) }));
vi.mock('../shared/MiniChart', () => ({ default: () => <div data-testid="mini-chart" /> }));

const { default: DistributorOverview } = await import('./DistributorOverview');

describe('<DistributorOverview />', () => {
  it('renders the distributor country-rollup totals in the header + KPI tiles', () => {
    render(<DistributorOverview />);
    expect(screen.getByText('National Network')).toBeInTheDocument();
    expect(screen.getByText('Distributor Admin')).toBeInTheDocument();
    // Agents tile value reads totalAgents (unique on the page).
    expect(screen.getByText(formatNumber(2049))).toBeInTheDocument();
    // Subscribers count reads totalSubscribers (tile value + score sentence).
    expect(screen.getAllByText(formatNumber(4820)).length).toBeGreaterThan(0);
    // Top-N table renders the RPC's display-ready rows incl. parentName.
    expect(screen.getByText('Top Branch')).toBeInTheDocument();
    expect(screen.getByText('Kampala')).toBeInTheDocument();
    expect(screen.getByText('Top Agent')).toBeInTheDocument();
    expect(screen.getByText('Jinja Road')).toBeInTheDocument();
  });
});
