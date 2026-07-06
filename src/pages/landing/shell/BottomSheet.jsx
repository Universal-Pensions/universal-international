import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../../utils/motion';
import styles from './BottomSheet.module.css';

const CloseIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

function focusablesIn(container) {
  if (!container) return [];
  return Array.prototype.slice
    .call(container.querySelectorAll(FOCUSABLE))
    .filter((el) => !el.disabled && el.offsetParent !== null);
}

/**
 * BottomSheet — the landing shell's mobile sheet primitive (Menu / Install /
 * Calculator). A standalone copy of the branch shell's sheet so the landing
 * surface stays self-contained, but hardened for a PUBLIC a11y surface: on top
 * of scrim-click + Escape it adds a full focus trap, background `inert`, and
 * focus-return to the opening control. Portals to <body> so it layers above the
 * fixed app/action bars. Honours reduced-motion. Mobile-only.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  icon,
  headerRight,
  height = '78%',
  footer,
  labelledBy,
  children,
}) {
  const reduce = useReducedMotion();
  const sheetRef = useRef(null);
  const triggerRef = useRef(null);

  // Hold onClose in a ref so the trap effect below depends only on `open`.
  // Callers pass a fresh inline `onClose` arrow each render; without this the
  // effect would tear down + re-run on every parent re-render while the sheet
  // is open — flickering `inert` and bouncing focus back to the close button.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    // Remember what opened us so focus can return there on close.
    triggerRef.current = document.activeElement;

    // Inert the app tree behind the portal (the sheet lives in <body>, a sibling
    // of #root, so it stays interactive). Progressive — no-op if unsupported.
    const root = document.getElementById('root');
    if (root) root.setAttribute('inert', '');

    // Move focus into the sheet.
    const id = window.setTimeout(() => {
      const focusables = focusablesIn(sheetRef.current);
      const closeBtn = sheetRef.current?.querySelector(`.${styles.close}`);
      (closeBtn || focusables[0] || sheetRef.current)?.focus();
    }, 60);

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = focusablesIn(sheetRef.current);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!sheetRef.current?.contains(active)) {
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

    document.addEventListener('keydown', onKey, true);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener('keydown', onKey, true);
      if (root) root.removeAttribute('inert');
      const trigger = triggerRef.current;
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={styles.scrim}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            aria-hidden="true"
          />
          <motion.div
            ref={sheetRef}
            className={styles.sheet}
            style={{ height }}
            role="dialog"
            aria-modal="true"
            aria-label={labelledBy ? undefined : title}
            aria-labelledby={labelledBy}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
          >
            <div className={styles.grip} aria-hidden="true" />
            <div className={styles.head}>
              <span className={styles.title}>
                {icon && <span className={styles.titleIcon}>{icon}</span>}
                {title}
              </span>
              <span className={styles.headRight}>
                {headerRight}
                <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                  {CloseIcon}
                </button>
              </span>
            </div>
            <div className={styles.body}>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
