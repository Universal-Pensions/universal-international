import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';
import { formatUGX } from '../utils/currency';
import { PAYMENT_METHODS } from '../constants/payment';
import PaymentMethodPicker from './payment/PaymentMethodPicker';
import { usePaymentMethod, gatewayPause } from './payment/usePaymentMethod';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import styles from './PaySheet.module.css';

// Mobile money + card + bank transfer, matching the Save / Policies flows.
// Single-sourced in constants/payment so the desktop <InlinePayPanel> offers
// the SAME picker.
const DEFAULT_METHODS = PAYMENT_METHODS;

/**
 * Shared demo pay sheet — a portaled bottom sheet with a confirm view (eyebrow +
 * big total + detail rows + method picker + actions) and a success view. Used by
 * the Policies renewal flow, the InsurancePage cover upgrade, and the schedule
 * "settle this period" prompt, so every pay surface looks the same.
 *
 * The sheet owns the method selection AND its gateway (card entry / bank
 * details). `onPay` receives the string to record as the payment method — the
 * method's full name for mobile money and bank transfer, or a brand + last-4
 * label for a card ('Visa •••• 4242') — so callers pass it straight to their
 * RPC. The mocked gateway hop runs here, before `onPay` fires, so callers get
 * the authorising step for free.
 *
 * Focus trap + body-scroll-lock come from the shared useFocusTrap /
 * useBodyScrollLock hooks (src/hooks/) — the same primitives every BottomSheet
 * copy uses. Escape and the Tab trap both route through `handleClose`, so — like
 * the Cancel button and scrim click — they no-op while a payment is in flight
 * (`busy`) instead of letting the sheet close mid-payment.
 *
 * @param {{
 *   open: boolean,
 *   view?: 'confirm'|'success',
 *   eyebrow?: string,
 *   total: number,
 *   subtitle?: string,
 *   lineItems?: Array<{ label: string, value: string }>,
 *   note?: string,
 *   methods?: Array<{ id, label, full, helper }>,
 *   payLabel?: string,
 *   cancelLabel?: string,
 *   submitting?: boolean,
 *   ariaLabel?: string,
 *   success?: { title: string, subtitle?: string, reference?: string },
 *   successCtaLabel?: string,
 *   onPay: (methodFull: string) => void,
 *   onClose: () => void,
 * }} props
 */
export default function PaySheet({
  open,
  view = 'confirm',
  eyebrow,
  total = 0,
  subtitle,
  lineItems = [],
  note,
  methods = DEFAULT_METHODS,
  payLabel,
  cancelLabel = 'Cancel',
  submitting = false,
  ariaLabel,
  success,
  successCtaLabel = 'Done',
  onPay,
  onClose,
}) {
  const reduceMotion = useReducedMotion();
  const pay = usePaymentMethod(methods);
  const sheetRef = useRef(null);

  // The mocked gateway hop is owned here, so `busy` covers both it and the
  // caller's own in-flight write. Everything that could interrupt a payment —
  // the close affordances and the pay button — gates on `busy`, not `submitting`.
  const [authorising, setAuthorising] = useState(false);
  const busy = submitting || authorising;

  function handleClose() {
    if (busy) return;
    onClose?.();
  }

  useFocusTrap(open, sheetRef, { onClose: handleClose });
  useBodyScrollLock(open);

  async function handlePay() {
    if (busy || !pay.ready) return;
    setAuthorising(true);
    try {
      await gatewayPause(pay.kind);
      await onPay?.(pay.record);
    } finally {
      setAuthorising(false);
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.sheetScrim}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          onClick={handleClose}
        >
          <motion.div
            ref={sheetRef}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel ?? (view === 'success' ? 'Payment complete' : 'Confirm payment')}
            initial={reduceMotion ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            transition={{ duration: reduceMotion ? 0 : 0.34, ease: EASE_OUT_EXPO }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={styles.sheetGrip} aria-hidden="true" />

            {view === 'confirm' && (
              <div className={styles.sheetBody}>
                {eyebrow && <span className={styles.confirmEyebrow}>{eyebrow}</span>}
                <div className={styles.confirmBig}>{formatUGX(total, { compact: false })}</div>
                {subtitle && <p className={styles.confirmSub}>{subtitle}</p>}

                {lineItems.length > 0 && (
                  <ul className={styles.confirmList}>
                    {lineItems.map((item) => (
                      <li className={styles.confirmRow} key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </li>
                    ))}
                  </ul>
                )}

                <PaymentMethodPicker
                  state={pay}
                  variant="chips"
                  submitting={busy}
                  className={styles.methodBlock}
                />

                {/* The selected method supplies its own note (SMS prompt vs card
                    authorisation vs transfer clearing), so a caller-passed
                    `note` is only the fallback for a method-less sheet. */}
                {(pay.note ?? note) && <p className={styles.confirmNote}>{pay.note ?? note}</p>}

                <div className={styles.sheetActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={handleClose} disabled={busy}>
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handlePay}
                    disabled={busy || !pay.ready}
                  >
                    {busy
                      ? pay.submittingLabel
                      : (payLabel ?? `Pay ${formatUGX(total, { compact: false })}`)}
                  </button>
                </div>
              </div>
            )}

            {view === 'success' && (
              <div className={styles.sheetBody} data-center="true">
                <div className={styles.successCheck} aria-hidden="true">
                  <svg viewBox="0 0 48 48" width="40" height="40" fill="none">
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
                <button type="button" className={styles.primaryBtn} onClick={handleClose}>
                  {successCtaLabel}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
