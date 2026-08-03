import { useCallback, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';
import { formatUGX } from '../utils/currency';
import PaymentMethodPicker from './payment/PaymentMethodPicker';
import { usePaymentMethod, gatewayPause } from './payment/usePaymentMethod';
import styles from './InlinePayPanel.module.css';

/**
 * InlinePayPanel — the DESKTOP (>=1024px) inline confirm → success surface for
 * the subscriber money-flows. It is the on-page replacement for the phone-style
 * <PaySheet> bottom sheet: an ordinary card that a page drops into its right
 * "summary" column so the confirm/pay step happens in place, without a portaled
 * overlay sliding up from the bottom.
 *
 * The data contract mirrors <PaySheet> on purpose, so the three sheet-driven
 * pages (Schedule-settle, Insurance upgrade, Policy renewal) are a near
 * drop-in: pass `methods` and the panel owns the picker — including the card /
 * bank gateway and the mocked authorising hop — then calls `onPay(record)`,
 * where `record` is the string to store as the payment method ('MTN Mobile
 * Money', 'Bank transfer', or 'Visa •••• 4242'). Save / Withdraw choose their
 * method on the left form, so they omit `methods`; the panel then calls
 * `onPay()` with no argument, surfaces the chosen method as a normal line item,
 * and leaves the gateway hop to the caller.
 *
 * Bespoke confirm content (Save's retirement/emergency split, Withdraw's
 * retirement-impact warning) goes through `lineItems` + the `extra` slot. The
 * success footer renders a primary button (`successPrimary`, default "Done")
 * plus an optional text link (`successLink`, e.g. "View your activity"), both
 * styled by the panel so every success surface stays consistent.
 *
 * @param {{
 *   view: 'confirm'|'success',
 *   eyebrow?: string,
 *   total?: number,
 *   subtitle?: string,
 *   lineItems?: Array<{ label: string, value: string, dot?: string, positive?: boolean, highlight?: boolean }>,
 *   extra?: React.ReactNode,
 *   methods?: Array<{ id: string, label: string, full: string, helper?: string }>,
 *   note?: React.ReactNode,
 *   submitting?: boolean,
 *   canPay?: boolean,
 *   primaryLabel?: string,
 *   submittingLabel?: string,
 *   primaryTone?: 'indigo'|'danger',
 *   cancelLabel?: string,
 *   ariaLabel?: string,
 *   success?: { title: string, subtitle?: string, reference?: string },
 *   successPrimary?: { label: string, onClick: () => void },
 *   successLink?: { label: string, onClick: () => void },
 *   onPay: (methodFull?: string) => void,
 *   onCancel: () => void,
 *   onDone?: () => void,
 * }} props
 */
export default function InlinePayPanel({
  view = 'confirm',
  eyebrow,
  total = 0,
  subtitle,
  lineItems = [],
  extra,
  methods,
  note,
  submitting = false,
  canPay = true,
  primaryLabel,
  submittingLabel = 'Processing…',
  primaryTone = 'indigo',
  cancelLabel = 'Back',
  ariaLabel,
  success,
  successPrimary,
  successLink,
  onPay,
  onCancel,
  onDone,
}) {
  const reduceMotion = useReducedMotion();
  const hasMethods = Array.isArray(methods) && methods.length > 0;
  const pay = usePaymentMethod(hasMethods ? methods : []);

  // When the panel owns the picker it also owns the mocked gateway hop, so
  // `busy` covers that as well as the caller's in-flight write. When it does
  // not (Save / Withdraw), everything below falls back to the caller's props
  // and the panel behaves exactly as it did before.
  const [authorising, setAuthorising] = useState(false);
  const busy = submitting || authorising;
  const activeNote = hasMethods ? (pay.note ?? note) : note;
  const activeSubmittingLabel = hasMethods ? pay.submittingLabel : submittingLabel;
  const canSubmit = canPay && (!hasMethods || pay.ready);

  const primaryClass = primaryTone === 'danger' ? styles.btnDanger : styles.btnPrimary;

  async function handlePay() {
    if (busy || !canSubmit) return;
    if (!hasMethods) {
      onPay?.();
      return;
    }
    setAuthorising(true);
    try {
      await gatewayPause(pay.kind);
      await onPay?.(pay.record);
    } finally {
      setAuthorising(false);
    }
  }

  // Focus moves into the panel when it appears (the triggering CTA on the left
  // unmounts/hides, so focus would otherwise fall to <body>), and into the
  // success block when the payment completes — restoring the focus/announce
  // parity the portaled PaySheet got from role="dialog".
  const focusOnMount = useCallback((node) => {
    if (node) node.focus({ preventScroll: true });
  }, []);

  return (
    <section
      ref={focusOnMount}
      tabIndex={-1}
      className={styles.panel}
      data-center={view === 'success' ? 'true' : undefined}
      role="group"
      aria-label={ariaLabel ?? (view === 'success' ? 'Payment complete' : 'Confirm payment')}
    >
      <AnimatePresence mode="wait" initial={false}>
        {view === 'confirm' ? (
          <motion.div
            key="confirm"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: EASE_OUT_EXPO }}
          >
            <span className={styles.accent} aria-hidden="true" />
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            <div className={styles.big}>{formatUGX(total, { compact: false })}</div>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}

            {lineItems.length > 0 && (
              <ul className={styles.list}>
                {lineItems.map((item) => (
                  <li
                    className={`${styles.row} ${item.highlight ? styles.rowHighlight : ''}`}
                    key={item.label}
                  >
                    <span className={styles.rowLabel}>
                      {item.dot && <span className={styles.dot} style={{ background: item.dot }} />}
                      {item.label}
                    </span>
                    <span className={`${styles.val} ${item.positive ? styles.valPos : ''}`}>
                      {item.value}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {extra}

            {hasMethods && (
              <PaymentMethodPicker
                state={pay}
                variant="chips"
                submitting={busy}
                className={styles.methodBlock}
              />
            )}

            {activeNote && <p className={styles.note}>{activeNote}</p>}

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={onCancel}
                disabled={busy}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${primaryClass}`}
                onClick={handlePay}
                disabled={busy || !canSubmit}
              >
                {busy
                  ? activeSubmittingLabel
                  : (primaryLabel ?? `Pay ${formatUGX(total, { compact: false })}`)}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="success"
            ref={focusOnMount}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className={styles.successInner}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE_OUT_EXPO }}
          >
            <div className={styles.successCheck} aria-hidden="true">
              <svg viewBox="0 0 48 48" width="36" height="36" fill="none">
                <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
                <path d="M14 24l7 7 14-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className={styles.successTitle}>{success?.title ?? 'Payment complete'}</h2>
            {success?.subtitle && <p className={styles.successSubtitle}>{success.subtitle}</p>}
            {success?.reference && (
              <div className={styles.successRef}>
                Reference <strong>{success.reference}</strong>
              </div>
            )}
            <div className={styles.successActions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={successPrimary?.onClick ?? onDone}
              >
                {successPrimary?.label ?? 'Done'}
              </button>
              {successLink && (
                <button type="button" className={styles.successLink} onClick={successLink.onClick}>
                  {successLink.label}
                  <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none">
                    <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
