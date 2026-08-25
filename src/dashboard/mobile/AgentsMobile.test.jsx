// A15-004 (same defect as A13-002 — see BranchesMobile.test.jsx): the Agents
// summary strip (Subscribers / Funds) and each row's subscriber count are
// derived from a SEPARATE, later-resolving useAllEntitiesMetrics query.
// Before this fix they defaulted straight to 0 while that query was pending,
// so a rep opening the tab saw a confident "0 Subscribers · UGX 0 Funds"
// that looked like an empty network rather than a still-loading one. They
// must now show a placeholder instead, and the real numbers once metrics
// resolves.
//
// Mock paths are relative to THIS file (co-located with AgentsMobile.jsx,
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

import AgentsMobile from './AgentsMobile';

const AGENTS = [{ id: 'a-1', name: 'Dorothy Kiiza', parentId: 'b-1', status: 'active' }];
const BRANCHES = [{ id: 'b-1', name: 'Buikwe Central' }];

function setEntities() {
  useAllEntities.mockImplementation((level) => {
    if (level === 'agent') {
      return { data: AGENTS, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    if (level === 'branch') {
      return { data: BRANCHES, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      {createElement(AgentsMobile)}
    </MemoryRouter>,
  );
}

describe('<AgentsMobile /> — metrics loading state (A15-004)', () => {
  beforeEach(() => {
    setEntities();
  });

  it('shows a placeholder — never a confident "0" — for Subscribers/Funds while metrics is still pending', () => {
    useAllEntitiesMetrics.mockReturnValue({ data: {}, isPending: true });
    renderPage();

    // The agent COUNT is not metrics-derived — it renders immediately.
    expect(screen.getByText('1')).toBeInTheDocument();
    // Subscribers / Funds ARE metrics-derived and haven't resolved yet.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('UGX 0')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the real numbers once metrics resolves, with no placeholder left standing', () => {
    useAllEntitiesMetrics.mockReturnValue({
      data: { 'a-1': { totalSubscribers: 12, aum: 45000000 } },
      isPending: false,
    });
    renderPage();

    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
