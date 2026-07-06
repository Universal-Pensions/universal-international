import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Toggle the viewport per test.
const { state } = vi.hoisted(() => ({ state: { mobile: false } }));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => state.mobile }));
// Stub the shell so this test isolates the GATE, not the whole shell tree.
vi.mock('./LandingMobileShell', () => ({ default: () => <div data-testid="mobile-shell" /> }));

import LandingLayout from './LandingLayout';

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<LandingLayout />}>
          <Route index element={<div data-testid="desktop-home">DESKTOP HOME</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('LandingLayout viewport gate', () => {
  beforeEach(() => {
    state.mobile = false;
  });

  it('renders the phone shell on mobile', () => {
    state.mobile = true;
    renderLanding();
    expect(screen.getByTestId('mobile-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-home')).not.toBeInTheDocument();
  });

  it('is a transparent Outlet on desktop (renders the existing page unchanged)', () => {
    state.mobile = false;
    renderLanding();
    expect(screen.getByTestId('desktop-home')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).not.toBeInTheDocument();
  });
});
