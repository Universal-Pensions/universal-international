import { useId, useState } from 'react';
import { BANK_TRANSFER_ACCOUNT } from '../../constants/payment';
import { PillChip, PillChipGroup } from '../PillChip';
import {
  cvcLengthFor,
  detectCardBrand,
  formatCardNumber,
  formatExpiry,
  isExpiryValid,
  maskedCardNumber,
} from '../../utils/card';
import styles from './PaymentMethodPicker.module.css';

// The state hook (`usePaymentMethod`) and the mocked gateway hop
// (`gatewayPause`) live in ./usePaymentMethod — import them from there. They
// are deliberately NOT re-exported here so this file exports components only
// (react-refresh/only-export-components).

function MethodGlyph({ id }) {
  if (id === 'mtn' || id === 'airtel') {
    return <span className={styles.glyphText}>{id === 'mtn' ? 'MTN' : 'Airtel'}</span>;
  }
  if (id === 'bank') {
    return (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5 12 4l9 5.5" />
        <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
        <path d="M3 20h18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h3.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The in-flight gateway strip — a spinner over the masked card. Rendered by
 * <CardGateway> while a card payment is authorising, and exported so a page
 * that keeps its picker OUTSIDE the confirm surface (Save) can show the same
 * step where the member is actually looking. Renders nothing for the methods
 * that have no gateway hop.
 */
export function GatewayAuthorising({ state }) {
  if (state?.kind !== 'card') return null;
  return (
    <div className={styles.authorising} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.authorisingText}>
        <b>Authorising with your bank</b>
        <small>
          {maskedCardNumber(state.card) || detectCardBrand(state.card?.number).label}
          {' · do not close this window'}
        </small>
      </span>
    </div>
  );
}

/**
 * The card-entry gateway. Shown only while the card method is selected. Swaps
 * to an "authorising" strip while the payment is in flight so the demo shows a
 * real gateway hop rather than a button that just says "Processing…".
 */
function CardGateway({ state, submitting }) {
  const { card, setCardField, fillDemoCard } = state;
  const brand = detectCardBrand(card.number);
  const cvcLen = cvcLengthFor(card.number);

  // Number and CVC are capped at the brand's length as you type, so "too long"
  // is impossible and "too short" is indistinguishable from mid-typing. Both
  // therefore only flag on blur; expiry can be judged the moment it's 4 digits.
  const [touched, setTouched] = useState({});
  const markTouched = (field) => setTouched((prev) => ({ ...prev, [field]: true }));

  // Explicit label/input association (htmlFor + id) on top of the nesting, so
  // the fields are announced correctly and the error line is linked to the
  // field it describes. `useId` keeps the ids unique if two pay surfaces ever
  // mount at once.
  const uid = useId();
  const fieldId = (name) => `${uid}-${name}`;
  const errorId = `${uid}-error`;

  const numberDigits = card.number.replace(/\D/g, '');
  const numberError = Boolean(touched.number) && numberDigits.length > 0 && numberDigits.length !== brand.length;
  const expiryError = card.expiry.replace(/\D/g, '').length === 4 && !isExpiryValid(card.expiry);
  const cvcError = Boolean(touched.cvc) && card.cvc.length > 0 && card.cvc.length !== cvcLen;
  const hasError = numberError || expiryError || cvcError;

  if (submitting) return <GatewayAuthorising state={state} />;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardHeadTitle}>Card details</span>
        <button type="button" className={styles.demoFill} onClick={fillDemoCard}>
          Use a demo card
        </button>
      </div>

      <label className={styles.field} htmlFor={fieldId('number')}>
        <span className={styles.fieldLabel}>Card number</span>
        <span className={styles.inputWrap} data-error={numberError || undefined}>
          <input
            id={fieldId('number')}
            aria-label="Card number"
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            spellCheck={false}
            className={styles.input}
            placeholder="0000 0000 0000 0000"
            value={card.number}
            onChange={(e) => setCardField('number', formatCardNumber(e.target.value))}
            onBlur={() => markTouched('number')}
            aria-invalid={numberError || undefined}
            aria-describedby={numberError ? errorId : undefined}
          />
          <span className={styles.brandTag} data-brand={brand.id}>{brand.label}</span>
        </span>
      </label>

      <div className={styles.fieldRow}>
        <label className={styles.field} htmlFor={fieldId('expiry')}>
          <span className={styles.fieldLabel}>Expiry</span>
          <span className={styles.inputWrap} data-error={expiryError || undefined}>
            <input
              id={fieldId('expiry')}
              aria-label="Expiry date"
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp"
              spellCheck={false}
              className={styles.input}
              placeholder="MM / YY"
              value={card.expiry}
              onChange={(e) => setCardField('expiry', formatExpiry(e.target.value))}
              aria-invalid={expiryError || undefined}
              aria-describedby={expiryError ? errorId : undefined}
            />
          </span>
        </label>
        <label className={styles.field} htmlFor={fieldId('cvc')}>
          <span className={styles.fieldLabel}>CVC</span>
          <span className={styles.inputWrap} data-error={cvcError || undefined}>
            <input
              id={fieldId('cvc')}
              aria-label="Security code"
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              spellCheck={false}
              className={styles.input}
              placeholder={'0'.repeat(cvcLen)}
              value={card.cvc}
              onChange={(e) => setCardField('cvc', e.target.value.replace(/\D/g, '').slice(0, cvcLen))}
              onBlur={() => markTouched('cvc')}
              aria-invalid={cvcError || undefined}
              aria-describedby={cvcError ? errorId : undefined}
            />
          </span>
        </label>
      </div>

      <label className={styles.field} htmlFor={fieldId('name')}>
        <span className={styles.fieldLabel}>Name on card</span>
        <span className={styles.inputWrap}>
          <input
            id={fieldId('name')}
            aria-label="Name on card"
            type="text"
            autoComplete="cc-name"
            className={styles.input}
            placeholder="As printed on the card"
            value={card.name}
            onChange={(e) => setCardField('name', e.target.value)}
          />
        </span>
      </label>

      {hasError && (
        <p className={styles.errorLine} id={errorId} role="alert">
          {numberError
            ? `A ${brand.label} number has ${brand.length} digits.`
            : expiryError
              ? 'That expiry date has already passed.'
              : `The security code is ${cvcLen} digits.`}
        </p>
      )}

      <p className={styles.secureLine}>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none">
          <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.25" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Encrypted end to end. We never store your full card number.
      </p>
    </div>
  );
}

/** Account details + reference for the bank-transfer method. */
function BankGateway({ state }) {
  const rows = [
    { label: 'Account name', value: BANK_TRANSFER_ACCOUNT.accountName },
    { label: 'Account number', value: BANK_TRANSFER_ACCOUNT.accountNumber },
    { label: 'Bank', value: BANK_TRANSFER_ACCOUNT.bank },
    { label: 'Branch', value: BANK_TRANSFER_ACCOUNT.branch },
    { label: 'SWIFT', value: BANK_TRANSFER_ACCOUNT.swift },
  ];

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardHeadTitle}>Transfer to</span>
      </div>
      <ul className={styles.bankList}>
        {rows.map((row) => (
          <li className={styles.bankRow} key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </li>
        ))}
      </ul>
      <div className={styles.bankRef}>
        <span className={styles.bankRefLabel}>Quote this reference</span>
        <strong className={styles.bankRefValue}>{state.bankReference}</strong>
      </div>
      <p className={styles.secureLine}>
        Transfers usually clear within 1–2 working days. Your savings update as soon as we
        match the reference.
      </p>
    </div>
  );
}

/**
 * PaymentMethodPicker — the method chooser plus whatever gateway the chosen
 * method needs, driven by a `usePaymentMethod()` state object.
 *
 * `variant="chips"` renders the compact pill row used inside confirm panels and
 * on desktop; `variant="rows"` renders the full-width tappable radio rows the
 * subscriber mobile Save page uses.
 */
export default function PaymentMethodPicker({
  state,
  variant = 'chips',
  label = 'Pay with',
  hideLabel = false,
  submitting = false,
  className = '',
}) {
  const { methods, method, methodId, setMethodId, kind } = state;
  if (!methods?.length) return null;

  return (
    <div className={`${styles.block} ${className}`}>
      {!hideLabel && <span className={styles.blockLabel}>{label}</span>}

      {variant === 'rows' ? (
        <div className={styles.rows} role="radiogroup" aria-label={label}>
          {methods.map((m) => (
            <button
              type="button"
              key={m.id}
              role="radio"
              aria-checked={methodId === m.id}
              className={`${styles.row} ${methodId === m.id ? styles.rowOn : ''}`}
              onClick={() => setMethodId(m.id)}
              disabled={submitting}
            >
              <span className={styles.glyph} data-id={m.id} aria-hidden="true">
                <MethodGlyph id={m.id} />
              </span>
              <span className={styles.rowInfo}>
                <b>{m.full}</b>
                <small>{m.helper}</small>
              </span>
              <span className={styles.radio} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <>
          {/* "wrap", not "row": four methods with labels as long as "Bank
              transfer" overflow a confirm panel's narrow column on one line. */}
          <PillChipGroup label={label} layout="wrap">
            {methods.map((m) => (
              <PillChip
                key={m.id}
                selected={methodId === m.id}
                onClick={() => setMethodId(m.id)}
                disabled={submitting}
              >
                {m.label}
              </PillChip>
            ))}
          </PillChipGroup>
          {method?.helper && kind !== 'card' && kind !== 'bank' && (
            <p className={styles.helper}>{method.helper}</p>
          )}
        </>
      )}

      {kind === 'card' && <CardGateway state={state} submitting={submitting} />}
      {kind === 'bank' && !submitting && <BankGateway state={state} />}
    </div>
  );
}
