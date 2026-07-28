import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import AdminMobile from './AdminMobile';

// The shell spec stubs every phone screen, so this is the only render of the
// admin screen itself — a smoke test that it mounts and carries the head-office
// framing (no sign-in form: the shell owns the fixed action bar).
describe('AdminMobile', () => {
  it('renders the head-office hero and platform figures', () => {
    render(<AdminMobile />);
    // Mirrors the desktop AdminPage h1 verbatim, as every sibling pair does.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('In one console.');
    expect(screen.getByText('For administrators')).toBeInTheDocument();
    expect(screen.getByText('UGX 42B')).toBeInTheDocument();
  });

  it('keeps the illustrative-figures caveat', () => {
    render(<AdminMobile />);
    expect(screen.getByText(/Illustrative figures/i)).toBeInTheDocument();
  });
});
