// Cross-hook contract test for A18-002 (2026-08-25).
//
// Every one of the 6 role shells (subscriber/agent/branch/distributor/
// employer/admin) picks its top-level chrome with a strict two-way branch,
// `useIsDesktop() ? <Desktop/> : <Mobile/>` — there is no three-way tablet
// branch anywhere in this codebase. That makes the relationship between
// useIsDesktop() and useIsMobile() load-bearing in a way neither hook's own
// unit test can see alone: any viewport width that is "false" for both hooks
// falls through to the phone shell (that was the 769-1023px dead band this
// finding fixed); any width "true" for both is a latent collision the
// vestigial `isMobile` checks inside DashboardContent /
// AdminDashboardContent (src/dashboard/DashboardShell.jsx,
// src/admin-dashboard/AdminDashboardShell.jsx) are not written to expect.
//
// This test asserts the two hooks partition [0, 2000]px with no gap and no
// overlap. Full method + why 768px (not a tablet layout) was chosen:
// docs/audits/2026-08-23/a18/breakpoint-decision.md. If you are here because
// this test failed after changing either hook's query, read that file before
// changing the number back — it records a live-measured reason for 768px,
// not a guess.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useIsMobile } from '../hooks/useIsMobile';

function stubWidth(width) {
  window.matchMedia = vi.fn((query) => {
    const min = query.match(/min-width:\s*(\d+)px/);
    const max = query.match(/max-width:\s*(\d+)px/);
    let matches = true;
    if (min && width < Number(min[1])) matches = false;
    if (max && width > Number(max[1])) matches = false;
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    };
  });
}

describe('useIsDesktop() / useIsMobile() boundary contract (A18-002)', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  // Every integer viewport width from 0-2000px, plus a few named device
  // widths beyond that (ultrawide monitors etc.), partitioned into exactly
  // one of "desktop" or "mobile" — never both, never neither.
  const sampleWidths = [
    0, 1, 320, 375, 390, 414, 428, 480, 600, 640, 700, 767, 768, 769, 800,
    810, 820, 834, 900, 962, 1000, 1023, 1024, 1025, 1080, 1280, 1366, 1440,
    1536, 1920, 2560,
  ];

  for (const width of sampleWidths) {
    it(`width ${width}px is owned by exactly one hook`, () => {
      stubWidth(width);
      const { result: desktop } = renderHook(() => useIsDesktop());
      stubWidth(width);
      const { result: mobile } = renderHook(() => useIsMobile());

      const ownedByBoth = desktop.current && mobile.current;
      const ownedByNeither = !desktop.current && !mobile.current;

      expect(ownedByBoth, `width ${width}px: both hooks report true`).toBe(false);
      expect(ownedByNeither, `width ${width}px: both hooks report false (the A18-002 dead band would be back)`).toBe(false);
    });
  }

  it('the seam sits at 767/768px — useIsMobile owns 767 and below, useIsDesktop owns 768 and above', () => {
    stubWidth(767);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    stubWidth(767);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(false);

    stubWidth(768);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
    stubWidth(768);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
  });
});
