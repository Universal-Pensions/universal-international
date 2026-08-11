// RTL tests for the shared employer DESKTOP atoms in `ui.jsx`.
//
// Scope is deliberately narrow: the `Tile` link branch, which the Overview's
// "Pending KYC" tile is the first caller of. A metric tile that leads somewhere
// must render a real anchor (cmd-click / open-in-new-tab), not a div with a
// click handler — that's the whole point of routing it.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Tile } from './ui';

function renderTile(props) {
  return render(
    <MemoryRouter>
      <Tile label="Pending KYC" value="3" sub="Invited · awaiting sign-up" {...props} />
    </MemoryRouter>,
  );
}

describe('Tile', () => {
  it('renders a plain, non-interactive tile with no destination', () => {
    renderTile();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Pending KYC')).toBeInTheDocument();
  });

  it('renders a real link when given a destination', () => {
    renderTile({ to: '/dashboard/pending-kyc' });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/dashboard/pending-kyc');
    // The whole card is the target — label, value and caption all sit inside it.
    expect(link).toHaveTextContent('Pending KYC');
    expect(link).toHaveTextContent('3');
    expect(link).toHaveTextContent('Invited · awaiting sign-up');
  });
});
