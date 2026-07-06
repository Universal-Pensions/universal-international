import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Toggle whether the install context wants the banner shown at all.
const { state } = vi.hoisted(() => ({ state: { showBanner: true } }));
vi.mock('./installPrompt', () => ({
  useInstallPrompt: () => ({ showBanner: state.showBanner, dismissBanner: vi.fn() }),
}));

import InstallBanner from './InstallBanner';

function setScroll(y) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  fireEvent.scroll(window);
}

describe('InstallBanner scroll-hide', () => {
  beforeEach(() => {
    state.showBanner = true;
    setScroll(0);
  });

  it('renders nothing when the install context says not to show it', () => {
    state.showBanner = false;
    render(<InstallBanner onOpenInstall={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Install app' })).not.toBeInTheDocument();
  });

  it('is interactive at the top and tucks away (inert) once scrolled past the threshold', () => {
    render(<InstallBanner onOpenInstall={() => {}} />);
    const banner = screen.getByRole('region', { name: 'Install app' });
    // At the top: fully present, focusable.
    expect(banner).not.toHaveAttribute('inert');

    // Scrolled down: tucked out of the way (inert removes it from pointer + a11y).
    setScroll(200);
    expect(banner).toHaveAttribute('inert');

    // Back at the top: it slides back in.
    setScroll(0);
    expect(banner).not.toHaveAttribute('inert');
  });
});
