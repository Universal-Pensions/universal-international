// A13-002: the Branches summary strip (Agents / Funds) and each row's
// subscriber/AUM figures are derived from a SEPARATE, later-resolving
// useAllEntitiesMetrics query. Before this fix they defaulted straight to 0
// while that query was pending, so a rep opening the tab saw a confident
// "0 Agents · UGX 0 Funds" that looked like an empty network rather than a
// still-loading one. They must now show a placeholder instead, and the real
// numbers once metrics resolves.
//
// Mock paths are relative to THIS file (co-located with BranchesMobile.jsx,
// matching SubscriberDetailMobile.test.jsx's convention in this directory).

import { createElement } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useEntity', () => ({
  useAllEntities: vi.fn(),
  useAllEntitiesMetrics: vi.fn(),
}));
import { useAllEntities, useAllEntitiesMetrics } from '../../hooks/useEntity';

import BranchesMobile from './BranchesMobile';

const BRANCHES = [{ id: 'b-1', name: 'Buikwe Central', parentId: 'd-kam', status: 'active' }];
const DISTRICTS = [{ id: 'd-kam', name: 'Kampala' }];

function setEntities() {
  useAllEntities.mockImplementation((level) => {
    if (level === 'branch') {
      return { data: BRANCHES, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    if (level === 'district') {
      return { data: DISTRICTS, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      {createElement(BranchesMobile)}
    </MemoryRouter>,
  );
}

describe('<BranchesMobile /> — metrics loading state (A13-002)', () => {
  beforeEach(() => {
    setEntities();
  });

  it('shows a placeholder — never a confident "0" — for Agents/Funds while metrics is still pending', () => {
    useAllEntitiesMetrics.mockReturnValue({ data: {}, isPending: true });
    renderPage();

    // The branch COUNT is not metrics-derived (it comes straight from the
    // already-resolved branch list) — it renders immediately, unaffected.
    expect(screen.getByText('1')).toBeInTheDocument();
    // Agents / Funds ARE metrics-derived and metrics hasn't resolved yet —
    // must never render as a bare "0".
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('UGX 0')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the real numbers once metrics resolves, with no placeholder left standing', () => {
    useAllEntitiesMetrics.mockReturnValue({
      data: { 'b-1': { totalSubscribers: 41, totalAgents: 71, aum: 1950000000, activeRate: 62 } },
      isPending: false,
    });
    renderPage();

    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByText('71')).toBeInTheDocument();
  });
});
