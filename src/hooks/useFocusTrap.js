// Shared focus-trap primitive for portal-rendered `role="dialog"
// aria-modal="true"` surfaces (BottomSheet, PaySheet, and any future
// Modal-shaped dialog). Consolidates the two hardened implementations that
// already existed independently in this codebase — the landing shell's
// BottomSheet (inert #root + Tab-cycle + focus-return) and the shared Modal
// (mount-retry focus + the same trap contract) — into one hook, so every
// aria-modal surface gets identical behaviour instead of a fresh hand-rolled
// copy. See docs/audits/2026-08-23 findings A17-003 / A20-003: four dashboard
// BottomSheet copies declared `aria-modal="true"` with no trap at all — a
// false a11y promise (keyboard/SR focus could escape into the live app behind
// a supposedly-modal sheet).
//
// While `open`:
//   - remembers the previously focused element,
//   - `inert`s the background (`inertSelector`, default `#root`) — safe
//     because the dialog itself portals to <body>, a sibling of #root, so it
//     stays interactive while the app behind it does not,
//   - moves focus into the dialog (first focusable descendant, or the
//     container itself if none),
//   - Tab / Shift+Tab cycle within the dialog so focus can never escape it,
//   - Escape calls `onClose`.
// On close (open -> false, or unmount while open):
//   - removes the `inert` flag it set,
//   - returns focus to whatever opened the dialog.
//
// Independently of `open`, the container's OWN `inert` state is kept in sync
// with it. This is a no-op for the conditionally-rendered dialogs above
// (there's no DOM node to inert while closed — it isn't mounted), but it's
// exactly the primitive an always-mounted show/hide panel (e.g. a nav drawer
// that toggles a CSS class + `aria-hidden` instead of unmounting, so it can
// animate) needs to stop being tabbable while visually hidden. See finding
// A20-004: a closed drawer had 7 focusables still in the tab order because
// `aria-hidden="true"` alone does not remove elements from it.
//
// The focusable-element filter intentionally does NOT use `offsetParent`
// (the landing BottomSheet's original `focusablesIn` did) — jsdom has no
// layout engine and always reports `offsetParent === null`, which would make
// the filter return an empty list — and any Tab-trap test — unconditionally,
// under Vitest. It filters on `aria-hidden` / `hidden` / inline
// `display:none` / `visibility:hidden` / an `inert` ancestor instead
// (Modal.jsx's approach), which is correct in both real browsers and jsdom.
import { useEffect, useRef } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

/**
 * Focusable descendants of `root`, filtered to elements assistive tech and
 * Tab would actually reach (skips `aria-hidden`, `hidden`, inline
 * `display:none` / `visibility:hidden`, and anything inside an `inert`
 * ancestor — including `root` itself being inert).
 *
 * @param {Element|null} root
 * @returns {HTMLElement[]}
 */
export function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('hidden')) return false;
    if (el.closest('[inert]')) return false;
    const style = el.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  });
}

/**
 * @param {boolean} open
 * @param {React.RefObject<HTMLElement>} containerRef - ref to the dialog's
 *   root DOM node (the `role="dialog"` element). Focusable descendants are
 *   searched within this node.
 * @param {object} [options]
 * @param {() => void} [options.onClose] - called when Escape is pressed while open.
 * @param {string|null} [options.inertSelector='#root'] - selector for the
 *   background element to `inert` while open. Pass `null` to skip inerting
 *   the background (e.g. the container isn't portaled outside it).
 */
export function useFocusTrap(open, containerRef, { onClose, inertSelector = '#root' } = {}) {
  const triggerRef = useRef(null);

  // Hold onClose in a ref so the effect below depends only on `open`. Callers
  // routinely pass a fresh inline `onClose` arrow every render; without this
  // the effect would tear down + re-run on every parent re-render while the
  // dialog is open — flickering `inert` and bouncing focus back to the first
  // focusable element.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Keep the container's own `inert` state in sync with `open`, independent
  // of everything else below. See the file-level comment: a no-op for
  // conditionally-rendered dialogs, essential for always-mounted panels.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    if (open) {
      el.removeAttribute('inert');
      return undefined;
    }
    el.setAttribute('inert', '');
    return () => {
      el.removeAttribute('inert');
    };
  }, [open, containerRef]);

  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;

    triggerRef.current = document.activeElement;

    const inertTarget = inertSelector ? document.querySelector(inertSelector) : null;
    // Don't clobber (or later clear) an `inert` flag some OUTER trap already
    // set — e.g. a PaySheet opened from inside another dialog.
    const weSetInert = !!inertTarget && !inertTarget.hasAttribute('inert');
    if (weSetInert) inertTarget.setAttribute('inert', '');

    // Defer focus until after the portal mounts, RETRYING until it actually
    // has. AnimatePresence inserts the dialog asynchronously, so on the first
    // tick after `open` flips, `containerRef.current` is often still null —
    // a single one-shot timer would then silently give up, leaving focus (and
    // therefore the Tab trap and Escape handling, both of which key off
    // `document.activeElement` / `containerRef.current`) outside the dialog.
    // Modal.jsx documents the production incident this guards against: a
    // confirm dialog whose Escape handler never fired because focus was
    // never moved in.
    let attempts = 0;
    let focusTimer = 0;
    const tryFocus = () => {
      const root = containerRef.current;
      if (!root) {
        // ~20 x 16ms — comfortably longer than a portal + AnimatePresence
        // mount, bounded so a dialog that never mounts can't spin forever.
        if (attempts < 20) {
          attempts += 1;
          focusTimer = window.setTimeout(tryFocus, 16);
        }
        return;
      }
      const focusables = getFocusableElements(root);
      const target = focusables[0] || root;
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus?.();
      }
    };
    focusTimer = window.setTimeout(tryFocus, 0);

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const focusables = getFocusableElements(root);
      if (!focusables.length) {
        // Nothing focusable inside — trap focus on the dialog container.
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      if (weSetInert) inertTarget.removeAttribute('inert');
      const trigger = triggerRef.current;
      if (trigger && typeof trigger.focus === 'function') {
        try {
          trigger.focus({ preventScroll: true });
        } catch {
          trigger.focus();
        }
      }
      triggerRef.current = null;
    };
  }, [open, containerRef, inertSelector]);
}
