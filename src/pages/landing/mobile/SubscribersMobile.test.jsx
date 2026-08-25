import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SubscribersMobile from './SubscribersMobile';

// A20-005 regression guard: axe's scrollable-region-focusable (serious) flagged
// the horizontally-scrolling "Real stories" quotes strip — it scrolls but was
// never in the tab order and had no accessible name, so keyboard/SR users
// couldn't reach the clipped content.
describe('SubscribersMobile', () => {
  it('makes the horizontally-scrolling quotes strip keyboard-focusable and named', () => {
    const { container } = render(
      <MemoryRouter>
        <SubscribersMobile openCalc={() => {}} />
      </MemoryRouter>,
    );
    const strip = container.querySelector('[aria-label="Customer stories, scroll for more"]');
    expect(strip).not.toBeNull();
    expect(strip).toHaveAttribute('tabindex', '0');
  });
});
