import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import AboutMobile from './AboutMobile';

// A16-001 / A18-004 regression guard. The mobile About screen used to open at
// <h3> with no <h1> anywhere on the page — a WCAG 2.4.6/1.3.1 defect (no page
// title landmark for screen readers) and the root cause of the mobile-only
// Playwright smoke failure (landing.spec.ts:34, mobile-chromium + mobile-webkit).
describe('AboutMobile', () => {
  it('opens with a level-1 heading naming the page', () => {
    render(<AboutMobile />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('About Universal Pensions');
  });

  it('keeps a clean heading order — no skip from h1 straight to h4', () => {
    render(<AboutMobile />);
    // The three "How it works" steps used to be <h4> directly under the <h3>
    // hero (a valid, if low, h3->h4 step). Promoting only the hero to <h1>
    // without touching these would have skipped two levels (h1->h4) — a NEW
    // axe heading-order violation this page didn't have before. They're <h2> now,
    // so the page has a clean h1 -> h2 outline and no h3/h4 at all.
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Register' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Contribute' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Grow' })).toBeInTheDocument();
  });
});
