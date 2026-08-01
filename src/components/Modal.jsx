// Shared Modal primitive.
//
// Behaviours:
// - Renders into a portal at `document.body` (so the modal escapes any
//   transformed / overflow-clipped slide-in panel that may host the trigger).
// - On open: stores the previously focused element, locks body scroll, and
//   moves focus to the first focusable element inside the dialog. On close:
//   restores body scroll and returns focus to the original element.
// - Tab / Shift+Tab cycle within the dialog (focus trap).
// - Escape calls onClose with preventDefault + stopPropagation so the modal
//   closes but the outer slide-in panel does not.
// - Backdrop click requires `mousedown` AND `mouseup` both on the backdrop
//   itself — prevents accidental dismissal when a drag (e.g. text selection
//   in a textarea) releases over the backdrop.
// - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to the title.
//
// Animation: wraps in a Framer AnimatePresence so consumers just pass
// `open` and don't need to wire their own enter/exit transitions.

import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';

import styles from './Modal.module.css';

// Matches the focusable-elements selector recommended by WAI-ARIA author
// practice. Filters out elements with `disabled` / `tabindex="-1"` / hidden.
const FOCUSABLE_SELECTOR = [
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

function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    // Skip elements explicitly hidden from assistive tech or by inline style.
    // Note: we intentionally don't use `offsetParent === null` (jsdom always
    // reports null because it has no layout engine). Production browsers
    // still hide display:none / visibility:hidden because focus() is a no-op
    // there — and our wrappers never set those on focusable controls.
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('hidden')) return false;
    const style = el.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return false;
    }
    return true;
  });
}

const SIZE_CLASS = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
};

/**
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {() => void} props.onClose
 * @param {string}   props.title           — visible title text, also used for aria-labelledby
 * @param {React.ReactNode} props.children
 * @param {'sm'|'md'|'lg'} [props.size]    — default 'md'
 * @param {boolean}  [props.dismissOnBackdrop] — default true
 * @param {string}   [props.labelledBy]    — override aria-labelledby (skips the rendered title heading)
 * @param {string}   [props.describedBy]   — optional aria-describedby
 * @param {string}   [props.className]     — extra class on the dialog surface
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  dismissOnBackdrop = true,
  labelledBy,
  describedBy,
  className,
}) {
  // Respect the OS "reduce motion" setting: snap to opacity-only transitions
  // (no scale/translate, zero duration) when enabled. Visuals are unchanged
  // for users without the setting.
  const reduce = useReducedMotion();

  // Stable, render-safe id for the auto-rendered title.
  const generatedId = useId();
  const titleId = labelledBy || (title ? `modal-title-${generatedId}` : undefined);

  const dialogRef = useRef(null);
  // mousedown target tracker for safe backdrop dismissal.
  const backdropMouseDownRef = useRef(false);
  // Remembers the previously focused element so we can restore it on close.
  const previousFocusRef = useRef(null);

  // Keep `onClose` reference stable inside the effect-bound listeners.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // -- Body scroll lock + focus management ----------------------------------
  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current =
      typeof document !== 'undefined' ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Defer until after the portal mounts — and RETRY until it actually has.
    //
    // This used to be a single `setTimeout(…, 0)` that bailed on
    // `if (!root) return;`. AnimatePresence inserts the dialog asynchronously,
    // so on the first tick after `open` flips, `dialogRef.current` is often
    // still null — and the one-shot timer then gave up SILENTLY, leaving focus
    // on whatever triggered the modal.
    //
    // That was not a cosmetic focus nit. `handleKeyDown` is bound to the
    // BACKDROP (see the render below), so it only ever sees an Escape that
    // originates inside the portal. With focus left outside, Escape reached the
    // trigger button instead and the modal could not be dismissed by keyboard
    // AT ALL — measured on the distributor ViewBranches confirm dialog, where
    // `document.activeElement` stayed on the "Deactivate branch" button and the
    // dialog survived Escape. The focus trap and the aria-modal contract were
    // equally dead, since neither can work from outside the dialog.
    let attempts = 0;
    let focusTimer = 0;
    const tryFocus = () => {
      const root = dialogRef.current;
      if (!root) {
        // ~20 × 16ms ≈ one third of a second: comfortably longer than the
        // portal + AnimatePresence mount, and bounded so a modal that never
        // mounts cannot spin forever.
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
        // Some non-HTMLElements (or jsdom edge cases) don't accept options.
        target.focus?.();
      }
    };
    focusTimer = window.setTimeout(tryFocus, 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function') {
        try {
          prev.focus({ preventScroll: true });
        } catch {
          prev.focus();
        }
      }
      previousFocusRef.current = null;
    };
  }, [open]);

  // -- Escape + Tab trap ----------------------------------------------------
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      // Stop the outer panel's Escape handler from also firing.
      // React's stopPropagation also halts native bubbling. We additionally
      // call stopImmediatePropagation on the native event so co-located
      // listeners on the same DOM node (rare, but possible) cannot fire.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent?.stopImmediatePropagation?.();
      onCloseRef.current?.();
      return;
    }

    if (e.key !== 'Tab') return;

    const root = dialogRef.current;
    if (!root) return;
    const focusables = getFocusableElements(root);
    if (focusables.length === 0) {
      // Nothing focusable inside — trap focus on the dialog container itself.
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  // -- Backdrop dismissal (mousedown + mouseup both on backdrop) ------------
  const handleBackdropMouseDown = (e) => {
    if (!dismissOnBackdrop) return;
    backdropMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropMouseUp = (e) => {
    if (!dismissOnBackdrop) return;
    const startedOnBackdrop = backdropMouseDownRef.current;
    backdropMouseDownRef.current = false;
    if (startedOnBackdrop && e.target === e.currentTarget) {
      onCloseRef.current?.();
    }
  };

  // jsdom safety — if we're SSR/no document, render nothing.
  if (typeof document === 'undefined') return null;

  const sizeClass = SIZE_CLASS[size] || SIZE_CLASS.md;
  const dialogClassName = [styles.dialog, sizeClass, className].filter(Boolean).join(' ');

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          onMouseDown={handleBackdropMouseDown}
          onMouseUp={handleBackdropMouseUp}
          // Capture keydown at the backdrop so we get tab/escape regardless
          // of which child is focused.
          onKeyDown={handleKeyDown}
        >
          <motion.div
            ref={dialogRef}
            className={dialogClassName}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={describedBy}
            // tabIndex -1 so the container itself can receive focus when no
            // focusable child is present.
            tabIndex={-1}
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: 12 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: EASE_OUT_EXPO }}
          >
            {title ? (
              // Accessibility-only label. Consumers render their own visible
              // title heading inside `children` with their own styling; this
              // hidden node exists solely to satisfy aria-labelledby without
              // forcing consumers to wire up an id every time. Consumers can
              // bypass it by passing `labelledBy` explicitly.
              <h2
                id={titleId}
                data-modal-sr-title
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }}
              >
                {title}
              </h2>
            ) : null}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
