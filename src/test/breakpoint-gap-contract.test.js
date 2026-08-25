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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

  // 768/769, NOT 767/768. The seam has to land where the STYLESHEETS put it:
  // 45 CSS modules use `max-width: 768px` for the mobile tree and the
  // distributor/admin rail is gated on `min-width: 769px`. A JS seam at 767/768
  // mounted the desktop shell at exactly 768px while the mobile CSS still
  // applied — the nav rail disappeared, taking the only dash/map toggle with it.
  // This assertion passed throughout that bug, because it only ever compared the
  // two hooks to each other. See the CSS contract at the foot of this file.
  it('the seam sits at 768/769px — useIsMobile owns 768 and below, useIsDesktop owns 769 and above', () => {
    stubWidth(768);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    stubWidth(768);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(false);

    stubWidth(769);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
    stubWidth(769);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The JS seam must sit where the CSS seam already sits.
//
// WHY THIS EXISTS. The contract above compares the two HOOKS to each other and
// never opens a stylesheet — so it happily certified a seam of 767/768 as
// "MECE, no gap, no overlap" while the CSS put the boundary at 768/769. At
// exactly 768px `useIsDesktop()` returned true and mounted the desktop shell,
// while `Sidebar.module.css`'s `@media (max-width: 768px) { .sidebar { display:
// none } }` still applied and `DashboardShell.module.css`'s `min-width: 769px`
// rail rules did not. The entire nav rail vanished — and since the dash/map
// toggle lives only in that rail, a persisted 'map' mode had no way out.
//
// A gap test that only knows about itself cannot catch that. This one reads the
// stylesheets.
// ---------------------------------------------------------------------------
describe('the JS breakpoint agrees with the CSS breakpoint', () => {
  const SRC = resolve(__dirname, '..');

  function cssFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') || / \d+\./.test(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) cssFiles(full, out);
      else if (entry.endsWith('.css')) out.push(full);
    }
    return out;
  }

  const files = cssFiles(SRC);

  it('no stylesheet uses a mobile max-width that straddles the JS seam', () => {
    // useIsMobile is `max-width: 768px`, so a stylesheet using 767px would
    // leave 768px owned by neither tree — the mirror image of the bug above.
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/max-width:\s*(\d+)px/g)) {
        const px = Number(m[1]);
        if (px === 767 || px === 769) {
          offenders.push(`${f.replace(SRC, 'src')} → max-width: ${px}px`);
        }
      }
    }
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it('the desktop rail is gated at the width useIsDesktop() switches on', () => {
    // useIsDesktop is `min-width: 769px`. The rail rules must use the same
    // number, or the shell mounts without its own navigation.
    const shell = readFileSync(resolve(SRC, 'dashboard/DashboardShell.module.css'), 'utf8');
    expect(shell).toMatch(/@media \(min-width:\s*769px\)/);
    expect(shell).not.toMatch(/@media \(min-width:\s*768px\)/);
  });
});
