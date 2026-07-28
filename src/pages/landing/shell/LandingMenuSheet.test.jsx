import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import LandingMenuSheet from './LandingMenuSheet';

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

const onClose = vi.fn();

function renderSheet(audience = 'sub') {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LandingMenuSheet open onClose={onClose} audience={audience} onOpenInstall={() => {}} />
      <Probe />
    </MemoryRouter>,
  );
}

// The sheet portals to <body>, so `screen` (not the render container) finds it.
const sheet = () => screen.getByRole('dialog', { name: 'Menu' });

describe('LandingMenuSheet', () => {
  beforeEach(() => onClose.mockClear());

  it('offers four audience tiles, Administrator included', () => {
    renderSheet();
    ['Subscribers', 'Employers', 'Distributors', 'Administrator'].forEach((label) => {
      expect(within(sheet()).getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('no longer carries the discreet "Admin portal" row', () => {
    renderSheet();
    expect(screen.queryByText('Admin portal')).not.toBeInTheDocument();
  });

  it('routes the Administrator tile to the /admin landing page', () => {
    renderSheet();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Administrator' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/admin');
  });

  it('marks the current audience with aria-current', () => {
    renderSheet('admin');
    const tile = within(sheet()).getByRole('button', { name: 'Administrator' });
    expect(tile).toHaveAttribute('aria-current', 'page');
    expect(within(sheet()).getByRole('button', { name: 'Subscribers' })).not.toHaveAttribute('aria-current');
  });
});
