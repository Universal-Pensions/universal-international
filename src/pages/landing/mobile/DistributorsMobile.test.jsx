import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import DistributorsMobile from './DistributorsMobile';

// A20-005 regression guard — see SubscribersMobile.test.jsx for the full
// defect writeup. Same unnamed, unfocusable horizontally-scrolling quotes
// strip on this screen.
describe('DistributorsMobile', () => {
  it('makes the horizontally-scrolling quotes strip keyboard-focusable and named', () => {
    const { container } = render(<DistributorsMobile />);
    const strip = container.querySelector('[aria-label="Customer stories, scroll for more"]');
    expect(strip).not.toBeNull();
    expect(strip).toHaveAttribute('tabindex', '0');
  });
});
