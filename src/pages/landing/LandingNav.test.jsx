import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import LandingNav from './LandingNav';

// The four audience tabs, in header order: [active key, label, destination].
// Labels carry NO "For " prefix, and Administrator points at the /admin landing
// page (the bare portal moved to /admin/login).
const TABS = [
  ['subscriber', 'Subscribers', '/'],
  ['employer', 'Employers', '/employers'],
  ['distributor', 'Distributors', '/distributors'],
  ['admin', 'Administrator', '/admin'],
];

function renderNav(props = {}) {
  return render(
    <MemoryRouter>
      <LandingNav onSignIn={() => {}} {...props} />
    </MemoryRouter>,
  );
}

const tabBar = () => screen.getByRole('navigation', { name: 'Platform audiences' });

// The drawer is aria-hidden while closed, so its links stay out of role queries
// until the hamburger opens it.
function openDrawer() {
  fireEvent.click(screen.getByLabelText('Open menu'));
  return screen.getByRole('dialog', { name: 'Mobile navigation' });
}

describe('LandingNav audience tabs', () => {
  it('renders the four audience tabs, in order, with no "For " prefix', () => {
    renderNav();
    const labels = within(tabBar()).getAllByRole('link').map((l) => l.textContent);
    expect(labels).toEqual(TABS.map(([, label]) => label));
  });

  it('points every tab at its landing route', () => {
    renderNav();
    TABS.forEach(([, label, to]) => {
      expect(within(tabBar()).getByRole('link', { name: label })).toHaveAttribute('href', to);
    });
  });

  it('marks only the active audience with aria-current', () => {
    TABS.forEach(([activeKey, activeLabel]) => {
      const { unmount } = renderNav({ active: activeKey });
      TABS.forEach(([, label]) => {
        const link = within(tabBar()).getByRole('link', { name: label });
        expect(link.getAttribute('aria-current')).toBe(label === activeLabel ? 'page' : null);
      });
      unmount();
    });
  });

  it('defaults to the subscriber tab when no active audience is given', () => {
    renderNav();
    expect(within(tabBar()).getByRole('link', { name: 'Subscribers' })).toHaveAttribute('aria-current', 'page');
  });

  it('repeats the same four tabs in the mobile drawer', () => {
    renderNav({ active: 'admin' });
    const drawer = openDrawer();
    TABS.forEach(([, label, to]) => {
      expect(within(drawer).getByRole('link', { name: label })).toHaveAttribute('href', to);
    });
    expect(within(drawer).getByRole('link', { name: 'Administrator' })).toHaveAttribute('aria-current', 'page');
  });
});
