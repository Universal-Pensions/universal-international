// A19-004 regression guard — see the JSDoc on `findScrollParent` in
// ViewSubscribers.jsx for the full root-cause writeup.
//
// The virtualizer was wired to `getScrollElement: () => bodyRef.current`
// (i.e. `.body`), which is only the REAL bounded scroll container in the
// slide-in panel. In `fullPage` (dash-mode) layout, `.panel` is overridden to
// `height:'auto'; overflow:'visible'` so it can size to its routed-page
// content, which means `.body`'s `flex:1; overflow-y:auto` has nothing bounded
// to clip against — `.body.scrollHeight === .body.clientHeight` (confirmed
// live: both ~450,044px) — so the virtualizer thought the whole list was
// visible and rendered all ~4,602 rows. The actual scrolling happens two
// ancestors up, on the dash-mode shell's page canvas (`.dashHost`).
//
// `findScrollParent` fixes this by asking the DOM, at call time, which
// ancestor (including the node itself) is ACTUALLY bounded-and-clipping right
// now, instead of assuming it's always the directly-ref'd `.body`. These
// tests build the two real layout shapes (fullPage / dash-mode vs. the
// slide-in panel) directly with jsdom nodes — `scrollHeight`/`clientHeight`
// aren't computed by jsdom's layout (it has none), so each scenario stubs
// them to the exact relationship the bug/fix cares about: does this element
// currently clip its content or not.

import { describe, it, expect } from 'vitest';
import { findScrollParent } from '../ViewSubscribers';

/** jsdom never lays out scrollHeight/clientHeight — stub them directly. */
function setScrollMetrics(el, { scrollHeight, clientHeight }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('findScrollParent() (A19-004)', () => {
  it('walks past an unbounded `.body` to find the bounded dash-mode `.dashHost` ancestor', () => {
    // Reproduces the exact fullPage/dash-mode shape: dashHost > panel > body.
    const dashHost = document.createElement('div');
    dashHost.style.overflowY = 'auto';
    setScrollMetrics(dashHost, { scrollHeight: 450474, clientHeight: 900 }); // bounded + overflowing — the REAL scroller

    const panel = document.createElement('div');
    panel.style.overflow = 'visible'; // fullPage inline-style override strips the bounded box
    setScrollMetrics(panel, { scrollHeight: 450044, clientHeight: 450044 });

    const body = document.createElement('div');
    body.style.overflowY = 'auto'; // CSS says auto, but...
    setScrollMetrics(body, { scrollHeight: 450044, clientHeight: 450044 }); // ...not actually clipping (root cause)

    dashHost.appendChild(panel);
    panel.appendChild(body);
    document.body.appendChild(dashHost);

    expect(findScrollParent(body)).toBe(dashHost);

    document.body.removeChild(dashHost);
  });

  it('returns the node itself when it IS the bounded scroller (non-fullPage slide-in panel)', () => {
    // Slide-in panel: `.panel` keeps its fixed-position bounded box, so
    // `.body`'s own flex:1/overflow-y:auto genuinely clips — unchanged
    // behaviour from before this fix.
    const panel = document.createElement('div');
    const body = document.createElement('div');
    body.style.overflowY = 'auto';
    setScrollMetrics(body, { scrollHeight: 2000, clientHeight: 500 });
    panel.appendChild(body);
    document.body.appendChild(panel);

    expect(findScrollParent(body)).toBe(body);

    document.body.removeChild(panel);
  });

  it('falls back to the original node when nothing up the tree is a bounded scroller', () => {
    // Never worse than the pre-fix behaviour: if no ancestor qualifies (e.g.
    // content hasn't overflowed yet on first mount), return what was passed
    // in rather than throwing or returning null.
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    setScrollMetrics(outer, { scrollHeight: 100, clientHeight: 100 });
    setScrollMetrics(inner, { scrollHeight: 100, clientHeight: 100 });
    outer.appendChild(inner);
    document.body.appendChild(outer);

    expect(findScrollParent(inner)).toBe(inner);

    document.body.removeChild(outer);
  });

  it('returns null/scrollingElement gracefully when passed a null node (ref not yet attached)', () => {
    const result = findScrollParent(null);
    expect(result === null || result === document.scrollingElement || result === document.documentElement).toBe(true);
  });
});
