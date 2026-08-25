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

// ── A20-004 ────────────────────────────────────────────────────────────────
// The mobile drawer stays MOUNTED when closed — only a CSS class changes — so
// `aria-hidden` alone left its children tabbable while announcing them hidden.
// A keyboard user tabbing the landing page fell into an invisible menu; axe
// reports aria-hidden-focus (serious) on /, /admin, /distributors, /employers.
//
// Two deliberate choices in how this is asserted:
//
//  1. Queried by DOM, not by role. Once the drawer is correctly inert it is no
//     longer in the accessibility tree at all, so getByRole cannot find it even
//     with { hidden: true }. That is the fix working, not a broken query.
//
//  2. Asserted on the ATTRIBUTE, not the `.inert` DOM property. jsdom does not
//     implement inert — verified: `'inert' in HTMLElement.prototype` is false and
//     the property reads `undefined` — while React 19 does emit `inert=""`
//     correctly. So the attribute is the strongest signal available here. The
//     real focusability behaviour it triggers is a BROWSER behaviour and needs an
//     axe run in a real engine to confirm end to end (Phase 5's screenshot/axe
//     sweep). Recorded honestly rather than claimed.
describe('LandingNav mobile drawer — closed means inert (A20-004)', () => {
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const drawerOf = (container) =>
    container.querySelector('aside[aria-label="Mobile navigation"]');

  it('marks the closed drawer inert, so none of its children are reachable by Tab', () => {
    const { container } = renderNav();
    const drawer = drawerOf(container);
    expect(drawer).not.toBeNull();

    // Guard the test itself: if the drawer ever unmounts when closed, the inert
    // assertion below would pass vacuously. The audit counted 7 focusables here —
    // close button, 4 audience links, Sign in, CTA.
    expect(drawer.querySelectorAll(FOCUSABLE).length).toBeGreaterThanOrEqual(7);

    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
  });

  it('clears inert when the drawer opens, so the menu is usable', () => {
    const { container } = renderNav();
    fireEvent.click(screen.getByLabelText('Open menu'));

    const drawer = drawerOf(container);
    expect(drawer.hasAttribute('inert')).toBe(false);
    expect(drawer.getAttribute('aria-hidden')).not.toBe('true');
    expect(drawer.querySelectorAll(FOCUSABLE).length).toBeGreaterThanOrEqual(7);
  });
});
