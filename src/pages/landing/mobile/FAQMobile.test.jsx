import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import FAQMobile from './FAQMobile';

// A16-001 / A18-004 regression guard — see AboutMobile.test.jsx for the full
// defect writeup. This page had a <h2> top heading and no <h1> at all.
describe('FAQMobile', () => {
  it('opens with a level-1 heading naming the page', () => {
    render(<FAQMobile />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Frequently asked questions.');
  });
});
