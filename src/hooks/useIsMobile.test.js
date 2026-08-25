// Unit tests for `useIsMobile`. A18-002 (2026-08-25) narrowed this hook's
// threshold from `max-width: 768px` to `max-width: 767px` when
// useIsDesktop.js's threshold dropped to `min-width: 768px`, so the two
// hooks stay MECE-adjacent (no width owned by both, none owned by neither).
// See docs/audits/2026-08-23/a18/breakpoint-decision.md. These tests lock in
// the new threshold so a future edit is a visible, deliberate diff.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

// See useIsDesktop.test.js for the rationale of this stub shape.
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

describe('useIsMobile()', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('queries exactly "(max-width: 767px)" — locks in the A18-002 threshold', () => {
    installMatchMediaStub(375);
    renderHook(() => useIsMobile());
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
  });

  it('returns true at exactly 767px', () => {
    installMatchMediaStub(767);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false at exactly 768px — no overlap with useIsDesktop()', () => {
    installMatchMediaStub(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns false in the former 769-1023px dead band (A18-002)', () => {
    installMatchMediaStub(900);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('reacts to a live viewport change crossing the threshold', () => {
    const stub = installMatchMediaStub(400);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    act(() => {
      stub.setWidth(1000);
    });
    expect(result.current).toBe(false);

    act(() => {
      stub.setWidth(320);
    });
    expect(result.current).toBe(true);
  });
});
