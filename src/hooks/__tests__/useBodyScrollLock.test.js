// Tests for the shared useBodyScrollLock primitive
// (src/hooks/useBodyScrollLock.js).
//
// docs/audits/2026-08-23 finding A18-003: none of the four dashboard
// BottomSheet copies, nor PaySheet, locked body scroll — a touch-drag on the
// scrim scrolled the live page behind an open sheet. The fix is a lock while
// any sheet is open, but the task that motivated this hook is explicit that a
// NAIVE per-instance lock (save `body.style.overflow`, restore it on close)
// is worse than the original bug once two overlays can be open at once (e.g.
// a PaySheet opened from inside a BottomSheet): whichever one closes FIRST
// restores overflow to whatever it captured before IT opened, even if a
// sibling overlay is still open, unlocking the page while something is still
// on screen — with no further UI action able to fix it. These tests pin the
// reference-counted fix: the body only unlocks once every active lock has
// released, in ANY open/close order.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBodyScrollLock } from '../useBodyScrollLock';

beforeEach(() => {
  document.body.style.overflow = '';
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('useBodyScrollLock', () => {
  it('does nothing while inactive', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.overflow).toBe('');
    unmount();
  });

  it('locks body scroll while active', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
  });

  it('restores scroll on unmount', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the PRE-EXISTING overflow value, not blindly to empty string', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('locks and unlocks as `active` toggles across rerenders', () => {
    const { rerender, unmount } = renderHook(({ active }) => useBodyScrollLock(active), {
      initialProps: { active: false },
    });
    expect(document.body.style.overflow).toBe('');

    rerender({ active: true });
    expect(document.body.style.overflow).toBe('hidden');

    rerender({ active: false });
    expect(document.body.style.overflow).toBe('');

    unmount();
  });

  describe('overlapping locks (two sheets open in sequence)', () => {
    it('stays locked while ANY overlay is still open, and only unlocks once the LAST one releases — closing in the SAME order they opened', () => {
      const a = renderHook(() => useBodyScrollLock(true)); // sheet A opens
      expect(document.body.style.overflow).toBe('hidden');

      const b = renderHook(() => useBodyScrollLock(true)); // sheet B opens while A is still open
      expect(document.body.style.overflow).toBe('hidden');

      a.unmount(); // A closes first
      expect(document.body.style.overflow).toBe('hidden'); // B is still open — must NOT unlock

      b.unmount(); // B closes last
      expect(document.body.style.overflow).toBe('');
    });

    it('stays locked while ANY overlay is still open, and only unlocks once the LAST one releases — closing in REVERSE order (the unbalanced-lock case)', () => {
      const a = renderHook(() => useBodyScrollLock(true)); // sheet A opens
      const b = renderHook(() => useBodyScrollLock(true)); // sheet B opens while A is still open
      expect(document.body.style.overflow).toBe('hidden');

      // A naive per-instance "save overflow before I opened, restore it when
      // I close" implementation unlocks HERE, even though B is still open —
      // this is the exact regression this hook exists to prevent.
      b.unmount(); // B closes FIRST (reverse of open order)
      expect(document.body.style.overflow).toBe('hidden'); // A is still open — must NOT unlock

      a.unmount(); // A closes last
      expect(document.body.style.overflow).toBe('');
    });

    it('never leaves the page permanently unscrollable: three overlapping locks, released in a scrambled order, always end unlocked', () => {
      const a = renderHook(() => useBodyScrollLock(true));
      const b = renderHook(() => useBodyScrollLock(true));
      const c = renderHook(() => useBodyScrollLock(true));
      expect(document.body.style.overflow).toBe('hidden');

      b.unmount();
      expect(document.body.style.overflow).toBe('hidden');
      a.unmount();
      expect(document.body.style.overflow).toBe('hidden');
      c.unmount();
      expect(document.body.style.overflow).toBe('');
    });
  });
});
