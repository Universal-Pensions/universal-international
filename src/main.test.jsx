// Unit tests for the global QueryCache.onError wiring added to main.jsx
// (A22-007 / A22-002 / A22-003 — docs/audits/2026-08-23/22-state-errors.md).
//
// main.jsx is the app entry point and renders on import — this only works
// because main.jsx guards `createRoot(...).render(...)` behind
// `if (document.getElementById('root'))`, which is false in a bare jsdom
// test document (src/test/setup.js adds no #root), so importing it here
// builds `queryClient` / the exported handler without mounting the app.
//
// Scope: this tests the WIRING (auth-expiry routes to forwardSupabaseAuthError
// and skips the toast; everything else routes through getFriendlyErrorMessage
// to the toast bridge; the bridge is safely absent-tolerant). The message-
// classification logic itself is covered exhaustively in
// src/utils/__tests__/friendlyError.test.js — mocked here so this stays a
// focused test of main.jsx's own new code.

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@sentry/react', () => ({ init: vi.fn() }));
vi.mock('./services/supabaseClient.js', () => ({
  forwardSupabaseAuthError: vi.fn(() => false),
}));
vi.mock('./utils/friendlyError.js', () => ({
  getFriendlyErrorMessage: vi.fn((_err, fallback) => `FRIENDLY(${fallback})`),
}));

const { forwardSupabaseAuthError } = await import('./services/supabaseClient.js');
const { getFriendlyErrorMessage } = await import('./utils/friendlyError.js');
const { handleGlobalQueryError, setToastBridge, GENERIC_READ_FAILURE_MESSAGE } =
  await import('./main.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  setToastBridge(null);
});

describe('handleGlobalQueryError (A22-007 global QueryCache backstop)', () => {
  it('routes an auth-expiry-shaped error to forwardSupabaseAuthError and does NOT toast (A22-003)', () => {
    forwardSupabaseAuthError.mockReturnValue(true);
    const toast = vi.fn();
    setToastBridge(toast);

    const err = { message: 'JWT expired', code: 'PGRST301' };
    handleGlobalQueryError(err);

    expect(forwardSupabaseAuthError).toHaveBeenCalledWith(err);
    expect(getFriendlyErrorMessage).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('toasts a plain-language message (via getFriendlyErrorMessage) for a non-auth read failure', () => {
    forwardSupabaseAuthError.mockReturnValue(false);
    const toast = vi.fn();
    setToastBridge(toast);

    const err = { message: 'TypeError: Failed to fetch', code: '' };
    handleGlobalQueryError(err);

    expect(getFriendlyErrorMessage).toHaveBeenCalledWith(err, GENERIC_READ_FAILURE_MESSAGE);
    expect(toast).toHaveBeenCalledWith('error', `FRIENDLY(${GENERIC_READ_FAILURE_MESSAGE})`);
  });

  it('does not throw when no bridge is registered yet (ToastProvider not mounted)', () => {
    forwardSupabaseAuthError.mockReturnValue(false);
    setToastBridge(null);
    expect(() => handleGlobalQueryError({ message: 'boom' })).not.toThrow();
  });

  it('stops publishing once the bridge is cleared (bridge component unmounted)', () => {
    forwardSupabaseAuthError.mockReturnValue(false);
    const toast = vi.fn();
    setToastBridge(toast);
    setToastBridge(null);

    handleGlobalQueryError({ message: 'boom' });
    expect(toast).not.toHaveBeenCalled();
  });
});
