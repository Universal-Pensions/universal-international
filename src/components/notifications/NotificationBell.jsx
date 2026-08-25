import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useUnreadNotificationCount } from '../../hooks/useNotifications';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import NotificationList from './NotificationList';
import styles from './Notifications.module.css';

const BellIcon = (
  <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true">
    <path
      d="M6 9a6 6 0 0112 0c0 4.5 1.2 6 1.8 6.6a.6.6 0 01-.42 1.02H4.62a.6.6 0 01-.42-1.02C4.8 15 6 13.5 6 9z"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M10 19.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

/**
 * NotificationBell — a bell-icon button with an unread-count badge that toggles
 * an in-app notification popover. Self-contained + reusable for both the agent
 * (recipientRole="agent") and branch (recipientRole="branch") shells; the only
 * inputs are the recipient `recipientRole` + `entityId`.
 *
 * The prop is `recipientRole`, NOT `role` (A20-008). On a JSX element `role` is
 * the ARIA attribute, so the previous spelling — role="agent" — made
 * jsx-a11y/aria-role fire at all 10 call sites, because "agent" is not a valid
 * ARIA role. The 10 warnings were never about broken ARIA; they were a
 * prop-name collision. Renaming removes the collision at source rather than
 * silencing the rule, so the lint stays useful for real ARIA mistakes.
 *
 * The badge reads useUnreadNotificationCount (polls every 30s); it's hidden at
 * 0 and clamps to "9+" above nine. The popover renders NotificationList.
 * Accessibility: a non-modal disclosure (not role="dialog", which would require
 * focus trap/move/restore the popover doesn't implement — BL-21). The trigger
 * carries aria-expanded + aria-controls pointing at the labelled popover region;
 * Escape + click-outside close it (shared useOutsideClick).
 *
 * Placement props:
 * - `align`: 'right' (default) anchors the popover to the bell's right edge
 *   (opens leftward — for bells near the viewport's right edge). 'left' anchors
 *   to the bell's left edge so it opens rightward — for bells near the LEFT edge
 *   (agent sidebar, agent mobile dome) that would otherwise clip off-screen.
 * - `portal`: render the popover in a body-level portal with fixed positioning
 *   so it escapes an ancestor `overflow:hidden` (the branch hero clips it
 *   otherwise). Position is measured from the bell and tracked on resize/scroll.
 * - `tone`: 'onIndigo' restyles the button (translucent white) so it reads on
 *   the indigo dome instead of a light surface.
 */
export default function NotificationBell({
  recipientRole,
  entityId,
  align = 'right',
  portal = false,
  tone = 'default',
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const popoverId = useId();
  const wrapRef = useRef(null);
  const popoverRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const { data: unread = 0 } = useUnreadNotificationCount({ role: recipientRole, entityId });

  const close = useCallback(() => setOpen(false), []);
  // When portaled, the popover leaves `.wrap`, so a click inside it would count
  // as "outside" and self-close — guard by treating the popover node as inside.
  // Memoise so useOutsideClick doesn't tear down + re-add its document listeners
  // on every render (e.g. each 30s poll repaint) — only when `portal` flips.
  const outsideRefs = useMemo(
    () => (portal ? [wrapRef, popoverRef] : [wrapRef]),
    [portal],
  );
  useOutsideClick(open, close, outsideRefs);

  const alignLeft = align === 'left';

  // For the portaled popover, pin it with fixed positioning measured from the
  // bell so it renders above/outside any clipping ancestor. Recompute while open
  // so it stays anchored through resize + scroll.
  useLayoutEffect(() => {
    if (!portal || !open) return undefined;
    function measure() {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords(
        alignLeft
          ? { top: r.bottom + 10, left: r.left }
          : { top: r.bottom + 10, right: window.innerWidth - r.right },
      );
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [portal, open, alignLeft]);

  if (!recipientRole || !entityId) return null;

  const badgeLabel = unread > 9 ? '9+' : String(unread);

  // AnimatePresence sits INSIDE the portal (when portaled) so exit animations
  // still run; the same tree renders in-place for the non-portal path.
  const popoverTree = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={popoverRef}
          id={popoverId}
          className={`${styles.popover} ${alignLeft ? styles.popoverLeft : ''} ${portal ? styles.popoverFixed : ''}`}
          style={portal && coords ? coords : undefined}
          role="region"
          aria-label="Notifications"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: EASE_OUT_EXPO }}
        >
          <NotificationList role={recipientRole} entityId={entityId} onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.bell} ${tone === 'onIndigo' ? styles.bellOnIndigo : ''}`}
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.bellIcon}>{BellIcon}</span>
        {/* Standardised with NotificationCenterCard: the visible count badge
            carries the unread count via aria-label (BL-39); the button name
            stays the static "Notifications". */}
        {unread > 0 && (
          <span className={styles.badge} aria-label={`${unread} unread`}>
            {badgeLabel}
          </span>
        )}
      </button>

      {portal ? createPortal(popoverTree, document.body) : popoverTree}
    </div>
  );
}
