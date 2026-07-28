import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import Footer from './Footer';

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
}

describe('Footer', () => {
  it('no longer carries the discreet Admin link (it moved to the header)', () => {
    const { container } = renderFooter();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('a[href="/admin"]')).toHaveLength(0);
  });

  it('names the audiences exactly as the header tabs do', () => {
    renderFooter();
    ['Subscribers', 'Employers', 'Distributors'].forEach((label) => {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    });
    // Administrator is deliberately header-only — the footer link moved up there.
    expect(screen.queryByRole('link', { name: 'Administrator' })).not.toBeInTheDocument();
  });

  it('keeps the legal bottom links untouched', () => {
    renderFooter();
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms' })).toBeInTheDocument();
    // 'Cookies' is a pending placeholder, not a link.
    expect(screen.getByText('Cookies')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('link', { name: 'Cookies' })).not.toBeInTheDocument();
  });
});
