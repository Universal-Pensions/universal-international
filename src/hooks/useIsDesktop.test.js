// Unit tests for `useIsDesktop`. A18-002 (2026-08-25) lowered this hook's
// threshold from 1024px to 768px to close the 769-1023px "dead band" where
// every role shell rendered its phone UI in a tablet-width window — see
// docs/audits/2026-08-23/a18/breakpoint-decision.md for the measurement that
// justified the move. These tests lock in the new threshold (768px) and the
// hook's reactivity so a future edit to the query string is a visible,
// deliberate diff here, not a silent change.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsDesktop } from './useIsDesktop';

// A controllable matchMedia stub: `matches` is derived from a mutable
// `width`, and `setWidth` replays `change` to every live listener — enough
// to drive useSyncExternalStore's subscribe/getSnapshot pair like a real
// resize would.
function installMatchMediaStub(initialWidth) {
  let width = initialWidth;
  const subscribers = [];

  function evaluate(query) {
    const min = query.match(/min-width:\s*(\d+)px/);
    const max = query.match(/max-width:\s*(\d+)px/);
    if (min && width < Number(min[1])) return false;
    if (max && width > Number(max[1])) return false;
    return true;
  }

  window.matchMedia = vi.fn((query) => {
    const cbs = new Set();
    subscribers.push(cbs);
    return {
      get matches() {
        return evaluate(query);
      },
      media: query,
      addEventListener: (type, cb) => {
        if (type === 'change') cbs.add(cb);
      },
      removeEventListener: (type, cb) => {
        if (type === 'change') cbs.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  });

  return {
    setWidth(next) {
      width = next;
      for (const cbs of subscribers) for (const cb of cbs) cb();
    },
  };
}

describe('useIsDesktop()', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('queries exactly "(min-width: 768px)" — locks in the A18-002 threshold', () => {
    installMatchMediaStub(1280);
    renderHook(() => useIsDesktop());
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
  });

  it('returns false below 768px', () => {
    installMatchMediaStub(767);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });

  it('returns true at exactly 768px', () => {
    installMatchMediaStub(768);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it('returns true in the former 769-1023px dead band (A18-002)', () => {
    installMatchMediaStub(820);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it('returns true above 1024px', () => {
    installMatchMediaStub(1440);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it('reacts to a live viewport change crossing the threshold', () => {
    const stub = installMatchMediaStub(600);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);

    act(() => {
      stub.setWidth(900);
    });
    expect(result.current).toBe(true);

    act(() => {
      stub.setWidth(500);
    });
    expect(result.current).toBe(false);
  });
});
