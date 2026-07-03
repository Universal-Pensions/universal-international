import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useSignup } from '../SignupContext';
import { useOnboardAudience } from '../OnboardAudienceContext';
import { sendOtp, verifyOtp } from '../../services/kyc';
import styles from './Step.module.css';
import own from './OtpStep.module.css';

const OTP_LENGTH = 4;
const RESEND_COOLDOWN = 30;

export default function OtpStep({ onNext }) {
  const signup = useSignup();
  const isAgent = useOnboardAudience() === 'agent';

  const [digits, setDigits] = useState(() => Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState(RESEND_COOLDOWN);
  const [sending, setSending] = useState(true);
  const inputsRef = useRef([]);

  /* Send OTP once on mount */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await sendOtp({ phone: signup.phone });
      } finally {
        if (!cancelled) setSending(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Resend cooldown countdown */
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  /* Focus first empty input on mount */
  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const handleSubmit = useCallback(async (codeOverride) => {
    const code = codeOverride ?? digits.join('');
    if (code.length < OTP_LENGTH) {
      setError(`Enter the full ${OTP_LENGTH}-digit code`);
      return;
    }
    setError('');
    setVerifying(true);
    try {
      const res = await verifyOtp({ phone: signup.phone, code });
      if (!res.verified) {
        setError('That code isn’t right. Check the SMS and try again.');
        setDigits(Array(OTP_LENGTH).fill(''));
        inputsRef.current[0]?.focus();
        return;
      }
      signup.patch({ otpVerified: true });
      onNext();
    } catch (e) {
      setError(e?.message || 'Something went wrong. Try again in a moment.');
    } finally {
      setVerifying(false);
    }
  }, [digits, signup, onNext]);

  function handleChange(index, value) {
    const digit = value.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (error) setError('');
    if (digit && index < OTP_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
    if (digit && index === OTP_LENGTH - 1) {
      // Auto-submit when the last digit is entered. Delay is long enough
      // that fast typists see the digit land and can correct a mis-tap
      // before verification fires.
      const codeSoFar = digits.slice(0, OTP_LENGTH - 1).join('') + digit;
      if (codeSoFar.length === OTP_LENGTH) {
        setTimeout(() => handleSubmit(codeSoFar), 450);
      }
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
    inputsRef.current[focusIdx]?.focus();
    if (pasted.length === OTP_LENGTH) {
      setTimeout(() => handleSubmit(pasted), 450);
    }
  }

  async function handleResend() {
    setResendTimer(RESEND_COOLDOWN);
    setDigits(Array(OTP_LENGTH).fill(''));
    setError('');
    inputsRef.current[0]?.focus();
    try {
      await sendOtp({ phone: signup.phone });
    } catch {
      // Failure is silent here — user can resend again if nothing arrives
    }
  }

  const maskedPhone = signup.phone
    ? `+256 ${signup.phone.slice(0, 1)}XX XXX ${signup.phone.slice(6)}`
    : '';

  // m:ss for the subscriber re-skin ("…in 0:21"); the agent flow keeps "21s".
  const resendClock = `${Math.floor(resendTimer / 60)}:${String(resendTimer % 60).padStart(2, '0')}`;

  return (
    <div className={styles.card}>
      <span className={`${styles.eyebrow} ${own.topEyebrow}`}>Step 4 · Phone verification</span>
      <h2 className={`${styles.heading} ${own.topHeading}`}>{isAgent ? 'Verify the phone number' : 'Enter the code we sent you'}</h2>
      <p className={`${styles.subtext} ${own.topSub}`}>
        {sending
          ? 'Sending a code to your phone…'
          : <>We sent a {OTP_LENGTH}-digit code to <strong className={own.phone}>{maskedPhone}</strong>.</>}
      </p>

      <div className={own.otpRow} onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputsRef.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            className={own.otpInput}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            data-error={!!error}
            data-filled={!!d}
            aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
            spellCheck={false}
            name={`otp-${i}`}
            {...(i === 0 ? { autoComplete: 'one-time-code' } : {})}
            disabled={verifying}
          />
        ))}
      </div>

      <motion.p
        className={own.error}
        role="alert"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: error ? 1 : 0, y: error ? 0 : -4 }}
        transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
      >
        {error || '\u00A0'}
      </motion.p>

      <div className={own.resendRow}>
        {resendTimer > 0 ? (
          <span className={own.resendWait}>
            {isAgent ? (
              <>Resend code in <strong>{resendTimer}s</strong></>
            ) : (
              <>Didn&rsquo;t arrive? Resend code in <strong>{resendClock}</strong></>
            )}
          </span>
        ) : (
          <button type="button" className={own.resendBtn} onClick={handleResend}>
            Resend code
          </button>
        )}
      </div>

      {/* Agent flows keep the explicit footer button; the subscriber re-skin has
          no footer (auto-submits on the 4th digit) and surfaces an inline
          "Verifying…" status while the check runs. */}
      {isAgent ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.submit}
            onClick={() => handleSubmit()}
            disabled={verifying || digits.join('').length < OTP_LENGTH}
            data-loading={verifying || undefined}
          >
            {verifying ? (
              <>
                <span className={own.btnSpinner} aria-hidden="true" />
                Verifying…
              </>
            ) : (
              'Verify & continue'
            )}
          </button>
        </div>
      ) : (
        <div className={own.statusRow} aria-live="polite">
          {verifying && (
            <span className={own.verifying}>
              <span className={own.statusSpinner} aria-hidden="true" />
              Verifying…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
