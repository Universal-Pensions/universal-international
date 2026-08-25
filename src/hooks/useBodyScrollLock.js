// Shared body-scroll-lock primitive for portal-rendered overlays (BottomSheet,
// PaySheet). See docs/audits/2026-08-23 finding A18-003: none of the four
// dashboard BottomSheet copies or PaySheet locked body scroll, so a
// touch-drag on the scrim/sheet edge scrolled the live page behind an open
// sheet. Modal.jsx already had a lock (`document.body.style.overflow =
// 'hidden'`, restored on close) — this hook is that pattern, generalised.
//
// Reference-counted at module scope, rather than each caller saving +
// restoring its own snapshot of `body.style.overflow` independently: two
// overlays can be open at once — a PaySheet opened from inside a BottomSheet,
// or the next sheet opening before the previous one's exit animation has
// finished unmounting — and they don't necessarily CLOSE in reverse order.
// With a per-instance snapshot, whichever one closes FIRST restores overflow
// to whatever it was before *it* opened, even if a sibling overlay is still
// open — unlocking the page while something is still on screen. That is
// worse than the bug this fixes: the page is stuck exactly as broken, just
// silently. Reference-counting only writes 'hidden' on the 0->1 transition
// and only restores on the 1->0 transition, so it stays correct no matter
// what order overlapping locks open and close in.
import { useEffect } from 'react';

let lockCount = 0;
let previousOverflow = '';

function acquireLock() {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function releaseLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
  }
}

/**
 * Lock `document.body` scrolling while `active` is true. Safe to call from
 * multiple overlays mounted at once — the body only unlocks once every active
 * lock has released.
 *
 * @param {boolean} active
 */
export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    if (typeof document === 'undefined') return undefined;
    acquireLock();
    return () => {
      releaseLock();
    };
  }, [active]);
}
