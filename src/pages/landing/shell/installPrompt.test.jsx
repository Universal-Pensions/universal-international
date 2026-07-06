import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { InstallPromptProvider, useInstallPrompt } from './installPrompt';

function Consumer() {
  const { canInstall, installed, showBanner, dismissed, promptInstall, dismissBanner } = useInstallPrompt();
  return (
    <div>
      <span data-testid="canInstall">{String(canInstall)}</span>
      <span data-testid="installed">{String(installed)}</span>
      <span data-testid="showBanner">{String(showBanner)}</span>
      <span data-testid="dismissed">{String(dismissed)}</span>
      <button type="button" onClick={() => promptInstall()}>prompt</button>
      <button type="button" onClick={dismissBanner}>dismiss</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <InstallPromptProvider>
      <Consumer />
    </InstallPromptProvider>,
  );
}

function fireBeforeInstallPrompt(outcome = 'accepted') {
  const e = new Event('beforeinstallprompt');
  const preventDefault = vi.spyOn(e, 'preventDefault');
  e.prompt = vi.fn();
  e.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(e);
  });
  return { e, preventDefault };
}

describe('useInstallPrompt', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts non-installable and hides the banner (no event, jsdom = non-iOS)', () => {
    renderProvider();
    expect(screen.getByTestId('canInstall').textContent).toBe('false');
    expect(screen.getByTestId('showBanner').textContent).toBe('false');
    expect(screen.getByTestId('installed').textContent).toBe('false');
  });

  it('captures beforeinstallprompt: prevents default, becomes installable, shows banner', () => {
    renderProvider();
    const { preventDefault } = fireBeforeInstallPrompt();
    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByTestId('canInstall').textContent).toBe('true');
    expect(screen.getByTestId('showBanner').textContent).toBe('true');
  });

  it('promptInstall fires the native prompt and marks installed on accept', async () => {
    renderProvider();
    const { e } = fireBeforeInstallPrompt('accepted');
    await act(async () => {
      fireEvent.click(screen.getByText('prompt'));
    });
    expect(e.prompt).toHaveBeenCalled();
    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('canInstall').textContent).toBe('false');
  });

  it('does not mark installed when the user dismisses the native prompt', async () => {
    renderProvider();
    fireBeforeInstallPrompt('dismissed');
    await act(async () => {
      fireEvent.click(screen.getByText('prompt'));
    });
    expect(screen.getByTestId('installed').textContent).toBe('false');
  });

  it('appinstalled clears installability', () => {
    renderProvider();
    fireBeforeInstallPrompt();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('canInstall').textContent).toBe('false');
  });

  it('persists a banner dismissal in localStorage across mounts', () => {
    const first = renderProvider();
    fireBeforeInstallPrompt();
    expect(screen.getByTestId('showBanner').textContent).toBe('true');
    act(() => {
      fireEvent.click(screen.getByText('dismiss'));
    });
    expect(screen.getByTestId('dismissed').textContent).toBe('true');
    expect(window.localStorage.getItem('up-landing-install-dismissed')).toBe('1');
    first.unmount();

    // A fresh provider reads the persisted dismissal.
    renderProvider();
    expect(screen.getByTestId('dismissed').textContent).toBe('true');
  });
});
