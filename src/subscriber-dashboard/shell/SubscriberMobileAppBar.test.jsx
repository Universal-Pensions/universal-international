// Regression coverage for A10-004 / A18-006: on mobile, all 5 report
// sub-views shared the same <h1> ("Analytics") because SECONDARY had an
// entry for the reports HUB ('/dashboard/reports') but none for any
// '/dashboard/reports/<subroute>', so every deep report route fell through
// to the generic `pathname.startsWith('/dashboard/reports/')` fallback.
// Each report view's own header is deliberately suppressed on mobile
// (ReportsPage.jsx's ReportsHeader returns null below 1024px), so that
// shared "Analytics" fallback was the ONLY heading on screen for all five
// routes — a screen-reader / heading-navigation wayfinding bug across
// distinct pages.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SubscriberMobileAppBar from './SubscriberMobileAppBar';

function renderAt(pathname) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <SubscriberMobileAppBar />
    </MemoryRouter>
  );
}

describe('<SubscriberMobileAppBar /> report sub-route titles (A10-004 / A18-006)', () => {
  it('titles the reports hub "Analytics"', () => {
    renderAt('/dashboard/reports');
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
  });

  it.each([
    ['/dashboard/reports/all-transactions', 'All Transactions'],
    ['/dashboard/reports/contributions-summary', 'Contributions Summary'],
    ['/dashboard/reports/withdrawals-history', 'Withdrawals'],
    ['/dashboard/reports/insurance-statement', 'Insurance Statement'],
    ['/dashboard/reports/annual-statement', 'Annual Tax Statement'],
  ])('gives %s its own distinct <h1> ("%s"), not the generic "Analytics"', (pathname, title) => {
    renderAt(pathname);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Analytics' })).not.toBeInTheDocument();
  });

  it('falls back to the generic "Analytics" title for an unrecognised report sub-route', () => {
    // Guards the fallback branch itself (resolve()'s `if (!title && ...)`) —
    // a route this map doesn't know about yet must still render a heading,
    // not a blank title.
    renderAt('/dashboard/reports/some-future-report');
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
  });

  it('each of the 5 report routes renders a UNIQUE title (no two share one)', () => {
    const routes = [
      '/dashboard/reports/all-transactions',
      '/dashboard/reports/contributions-summary',
      '/dashboard/reports/withdrawals-history',
      '/dashboard/reports/insurance-statement',
      '/dashboard/reports/annual-statement',
    ];
    const titles = routes.map((pathname) => {
      const { unmount } = renderAt(pathname);
      const text = screen.getByRole('heading', { level: 1 }).textContent;
      unmount();
      return text;
    });
    expect(new Set(titles).size).toBe(routes.length);
  });
});
