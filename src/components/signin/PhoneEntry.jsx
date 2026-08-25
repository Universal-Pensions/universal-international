import { useState, useEffect, useRef } from 'react';
import { isValidUGPhone, parseUGPhoneLocal } from '../../utils/phone';
import styles from './PhoneEntry.module.css';
import modalStyles from '../SignInModal.module.css';

const ROLE_LABELS = {
  subscriber: 'Subscriber',
  employer: 'Employer',
  distributor: 'Distributor Admin',
  branch: 'Branch Admin',
  agent: 'Agent',
  admin: 'Admin',
};

export default function PhoneEntry({ role, onSubmit, onBack, hideBadge = false, hideVisual = false, method = 'code', onMethodChange, focusOnMount = false}) {
  // A20-009: this component is used in TWO contexts — SignInModal (a dialog the
  // user just opened, where moving focus IN is correct) and AdminLogin (a PAGE,
  // where stealing focus on load jumps the viewport and disorients a screen-reader
  // user). A bare `autoFocus` cannot tell them apart, so the caller decides.
  const inputRef = useRef(null);
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);

  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const toggleRef = useRef(null);

  // Roving tabindex: keep exactly one radio in the tab order (the checked one)
  // so the method toggle is a single tab stop, mirroring PillChipGroup.
  useEffect(() => {
    const el = toggleRef.current;
    if (!el) return;
    const radios = Array.from(el.querySelectorAll('[role="radio"]'));
    if (!radios.length) return;
    const checked = radios.find((r) => r.getAttribute('aria-checked') === 'true');
    radios.forEach((r) => { r.tabIndex = -1; });
    (checked || radios[0]).tabIndex = 0;
  }, [method]);

  function handleToggleKeyDown(e) {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    const el = toggleRef.current;
    if (!el) return;
    const radios = Array.from(el.querySelectorAll('[role="radio"]')).filter((r) => !r.disabled);
    if (!radios.length) return;
    const current = el.querySelector('[role="radio"]:focus') || radios[0];
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next = radios[(radios.indexOf(current) + (forward ? 1 : -1) + radios.length) % radios.length];
    e.preventDefault();
    next.focus();
    next.click();
  }

  function handleChange(e) {
    // parseUGPhoneLocal strips a pasted country code ('+256'/'256') or national
    // '0' prefix before taking the 9-digit local part — so pasting a full
    // '+256 700 100 002' yields '700100002', not '256700100'. Fires on paste too
    // (paste triggers onChange).
    const val = parseUGPhoneLocal(e.target.value);
    setPhone(val);
    if (error) setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValidUGPhone(phone)) {
      setError('Enter a valid Ugandan mobile number (e.g. 70X XXX XXX)');
      return;
    }
    setLoading(true);
    try {
      await onSubmit(phone);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      {onBack && (
        <button className={styles.back} onClick={onBack} type="button">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
      )}

      {/* Visual icon */}
      {!hideVisual && (
        <div className={styles.visual}>
          <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" width="48" height="48">
            <rect x="12" y="4" width="24" height="40" rx="4" stroke="currentColor" strokeWidth="2"/>
            <circle cx="24" cy="38" r="2" fill="currentColor"/>
            <path d="M20 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
      )}

      {!hideBadge && <span className={styles.badge}>{ROLE_LABELS[role]}</span>}

      <h2 className={styles.heading}>Enter your phone number</h2>
      <p className={styles.subtext}>
        {method === 'password'
          ? "We'll sign you in with your password."
          : "We'll send you a one-time verification code."}
      </p>

      {/* Method toggle — visible for all roles. Tapping a chip flips parent
          state; the phone submit handler branches on `method` to either
          dispatch an OTP (sendOtp → goTo('otp')) or jump straight to the
          password step (goTo('password')). */}
      {onMethodChange && (
        <div
          ref={toggleRef}
          className={modalStyles.methodToggle}
          role="radiogroup"
          aria-label="Sign-in method"
          onKeyDown={handleToggleKeyDown}
        >
          <button
            type="button"
            role="radio"
            aria-checked={method === 'code'}
            className={modalStyles.methodChip}
            onClick={() => onMethodChange('code')}
          >
            One-time code
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={method === 'password'}
            className={modalStyles.methodChip}
            onClick={() => onMethodChange('password')}
          >
            Password
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.inputGroup} data-error={!!error}>
          <div className={styles.prefix}>
            <span className={styles.flag}>🇺🇬</span>
            <span className={styles.code}>+256</span>
          </div>
          <input
            type="tel"
            inputMode="numeric"
            className={styles.input}
            value={phone}
            onChange={handleChange}
            placeholder="7XX XXX XXX…"
            ref={inputRef}
            aria-label="Phone number"
            name="phone"
            autoComplete="tel"
            spellCheck={false}
          />
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? (
            <span className={styles.spinnerWrap}>
              <span className={styles.spinner} />
            </span>
          ) : (
            method === 'password' ? 'Continue' : 'Send verification code'
          )}
        </button>
      </form>
    </div>
  );
}
