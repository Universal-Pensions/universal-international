import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import styles from './BottomSheet.module.css';

const CloseIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/**
 * BottomSheet — the shared mobile sheet primitive for the branch app-bar surfaces
 * (Ask AI + Notifications). Portals to <body> so it layers above the fixed bottom
 * tab bar, dims with a scrim, slides up from the bottom, and closes on
 * scrim-click or Escape. Honours reduced-motion. Mobile-only — the app bar that
 * opens it never renders on desktop (>=1024px uses BranchDesktopShell's chrome).
 * Also reused directly by the admin mobile shell (AdminAttentionMobile /
 * AdminNavMobile import this file rather than keeping their own copy). Focus
 * trap + body-scroll-lock come from the shared useFocusTrap / useBodyScrollLock
 * hooks (src/hooks/), so aria-modal="true" here is a kept promise: Tab cannot
 * escape the sheet and the page behind it can't scroll while it's open.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  icon,
  headerRight,
  height = '78%',
  footer,
  children,
}) {
  const reduce = useReducedMotion();
  const sheetRef = useRef(null);

  useFocusTrap(open, sheetRef, { onClose });
  useBodyScrollLock(open);

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
            aria-label={title}
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
