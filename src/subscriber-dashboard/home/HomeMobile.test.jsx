// RTL test for HomeMobile's balance hero — A20-011.
//
// useCountUp re-renders the visible balance ~60x/sec while it animates up
// from 0, and the <p> carrying it had no aria-live, so a screen-reader user
// was never told the balance changed after a contribution (Toast confirms
// the ACTION, but never the new total). The fix hides the animating digits
// from the a11y tree (aria-hidden) and announces the SETTLED figure once via
// a polite live region, keyed off the `balance` prop rather than the
// animating count-up value.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Reduced motion → useCountUp snaps straight to the resolved balance (no
// rAF timing), keeping the rendered figures deterministic.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => true };
});

// HomeMobile calls this React Query hook directly for the funding card; stub
// it so the unit test needs no QueryClient / network / AuthContext.
vi.mock('../../hooks/useSubscriber', () => ({
  useMyEmployerFunding: () => ({ data: undefined }),
}));

const { default: HomeMobile } = await import('./HomeMobile');

function renderHome(subscriber) {
  return render(
    <MemoryRouter>
      <HomeMobile subscriber={subscriber} />
    </MemoryRouter>,
  );
}

const SUBSCRIBER = {
  name: 'Carol Obua',
  netBalance: 1_376_137,
  retirementBalance: 1_100_000,
  emergencyBalance: 276_137,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('<HomeMobile /> balance hero aria-live (A20-011)', () => {
  it('announces the settled balance once via a polite live region', () => {
    renderHome(SUBSCRIBER);
    const live = screen.getByText('Total balance UGX 1,376,137');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('hides the animating visible figure from the accessibility tree', () => {
    renderHome(SUBSCRIBER);
    const visible = screen.getByText('UGX 1,376,137');
    expect(visible).toHaveAttribute('aria-hidden', 'true');
  });

  it('updates the announced total when the balance itself changes', () => {
    const { rerender } = renderHome(SUBSCRIBER);
    expect(screen.getByText('Total balance UGX 1,376,137')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <HomeMobile subscriber={{ ...SUBSCRIBER, netBalance: 1_500_000 }} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Total balance UGX 1,500,000')).toBeInTheDocument();
    expect(screen.queryByText('Total balance UGX 1,376,137')).not.toBeInTheDocument();
  });
});
