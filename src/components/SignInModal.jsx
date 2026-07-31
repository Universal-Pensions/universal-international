import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useSignIn } from '../contexts/SignInContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasDashboard, sendOtp, verifyOtp, signInWithPassword, AuthError } from '../services/auth';
import RoleSelect from './signin/RoleSelect';
import DistributorSelect from './signin/DistributorSelect';
import PhoneEntry from './signin/PhoneEntry';
import OtpVerify from './signin/OtpVerify';
import PasswordEntry from './signin/PasswordEntry';
import logo from '../assets/logo-white.png';
import { EASE_OUT_EXPO as EASE } from '../utils/motion';

import styles from './SignInModal.module.css';

export default function SignInModal() {
  const { isOpen, initialRole, close } = useSignIn();
  const { login } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState('role');
  const [role, setRole] = useState(null);
  const [phone, setPhone] = useState('');
  // Sign-in method: 'code' (OTP, default) | 'password'. Toggled from PhoneEntry's
  // chip row. The phone-submit handler branches on this to either dispatch an
  // OTP and goto 'otp', or skip the dispatch and goto 'password'.
  const [method, setMethod] = useState('code');
  // Inline error string surfaced inside PasswordEntry (invalid_password and
  // other non-`password_not_set` codes). Cleared on every fresh password
  // submission attempt.
  const [passwordError, setPasswordError] = useState('');
  // When the backend returns `password_not_set`, flip this on to render the
  // prominent "Use a code instead" CTA panel inside PasswordEntry.
  const [showSwitchCta, setShowSwitchCta] = useState(false);
  // Tracks the open/closed transition so the preset-role logic below can run
  // during render instead of in an effect.
  const [prevOpen, setPrevOpen] = useState(false);
  // The step this modal session opened on. Preset-role opens (the landing
  // "Sign in"/"Log in" CTAs call open('employer') etc.) start past the picker,
  // so the picker is not a step the user can meaningfully go "back" to.
  const [entryStep, setEntryStep] = useState('role');
  const prevStep = useRef('role');

  const modalRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleEsc(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, close]);

  // Focus trap: save previous focus, trap Tab inside modal, restore on close
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement;

    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function handleKeyDown(e) {
      if (e.key !== 'Tab') return;
      const modal = modalRef.current;
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll(selector)).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    // Focus the first focusable element inside the modal
    requestAnimationFrame(() => {
      const modal = modalRef.current;
      if (modal) {
        const first = modal.querySelector(selector);
        if (first) first.focus();
      }
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Only restore focus if the previously-focused element still exists in the
      // DOM. Route changes can detach it; calling .focus() on a detached node
      // throws on some browsers and is a silent no-op on others.
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function' && document.body.contains(prev)) {
        prev.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStep('role');
        setEntryStep('role');
        setRole(null);
        setPhone('');
        setMethod('code');
        setPasswordError('');
        setShowSwitchCta(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // When opened with an explicit role (e.g. a landing "Log in as branch/agent"
  // CTA calls signIn.open('branch')), skip the role picker. We adjust state
  // during render on the open transition — React's supported alternative to a
  // setState-in-an-effect (avoids the cascading-render warning and a RoleSelect
  // flash). open() with no role leaves initialRole null, so the flow starts at
  // the role step exactly as before.
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      const opensOn = !initialRole ? 'role' : initialRole === 'distributor' ? 'distributor' : 'phone';
      if (initialRole) {
        setRole(initialRole === 'distributor' ? null : initialRole);
        setStep(opensOn);
      }
      setEntryStep(opensOn);
    }
  }

  function goTo(nextStep) {
    prevStep.current = step;
    setStep(nextStep);
  }

  function handleRoleSelect(selectedRole) {
    if (selectedRole === 'distributor') {
      goTo('distributor');
    } else {
      setRole(selectedRole);
      goTo('phone');
    }
  }

  function handleDistributorSelect(subRole) {
    setRole(subRole);
    goTo('phone');
  }

  async function handlePhoneSubmit(phoneNum) {
    setPhone(phoneNum);
    // Reset password-step state — each new phone entry starts fresh.
    setPasswordError('');
    setShowSwitchCta(false);
    if (method === 'password') {
      // Skip OTP dispatch — jump straight to the password step.
      goTo('password');
      return;
    }
    // B19 — Await the OTP dispatch so a cold backend doesn't drop us on the
    // OTP step before the send has actually fired. PhoneEntry's submit
    // button is bound to its own `loading` flag (driven by us awaiting
    // here), so the spinner stays visible until either the send resolves
    // (advance to OTP) or rejects (surface a toast, stay on phone step).
    try {
      await sendOtp(phoneNum, role);
      goTo('otp');
    } catch (err) {
      // Surface a toast rather than silently advancing — cold-start failures
      // and network errors should not leave the user typing a code that was
      // never sent. The toast text honours messageForCode mappings (G47).
      const message = err?.message || 'Could not send verification code. Please try again.';
      addToast('error', message);
      throw err;
    }
  }

  async function handleResend() {
    await sendOtp(phone, role);
  }

  /**
   * Verify the OTP. Throws an AuthError on failure so OtpVerify can render
   * a per-code message (invalid_otp, rate_limited, locked). The backend owns
   * the user shape — branchId/agentId/distributorId come from `verifyOtp`,
   * not the client.
   */
  async function handleVerify(code) {
    const { token, user } = await verifyOtp(phone, code, role);
    await login({ token, user });
    close();
    // Trust the API response: verify-otp resolves (or falls back to) a real
    // server subscriber row and returns `user.subscriberId`. Routing to /signup
    // based on localStorage made every fresh-browser sign-in detour through
    // signup even for users whose row already existed.
    navigate(hasDashboard(user.role) ? '/dashboard' : '/coming-soon');
  }

  /**
   * Verify the password. On success, same AuthContext.login + navigate flow
   * as `handleVerify`. On error, AuthError codes route to different UI:
   *   - password_not_set → flip showSwitchCta so PasswordEntry renders the
   *     prominent "Use a code instead" CTA panel (the user has no hash).
   *   - invalid_password → surface as inline error.
   *   - anything else (network, rate_limited, etc.) → surface as inline error
   *     (no global toast scaffolding in the modal; keep it self-contained).
   */
  async function handlePasswordVerify(password) {
    setPasswordError('');
    setShowSwitchCta(false);
    try {
      const { token, user } = await signInWithPassword(phone, password, role);
      await login({ token, user });
      close();
      navigate(hasDashboard(user.role) ? '/dashboard' : '/coming-soon');
    } catch (err) {
      const code = err instanceof AuthError ? err.code : 'network';
      if (code === 'password_not_set') {
        setShowSwitchCta(true);
        setPasswordError('');
        return;
      }
      if (code === 'invalid_password') {
        setPasswordError('Incorrect password.');
        return;
      }
      setPasswordError(err?.message || 'Could not sign you in. Please try again.');
    }
  }

  /**
   * Flip from the password path back to the OTP path. Phone is preserved
   * (set by PhoneEntry, lives in modal state), so we re-issue sendOtp and
   * advance to the OTP step. Triggered either by the tertiary link below the
   * password submit OR by the prominent CTA panel when `password_not_set`.
   */
  async function handleSwitchToCode() {
    setMethod('code');
    setPasswordError('');
    setShowSwitchCta(false);
    // B19 — Await so a failed dispatch surfaces as a toast rather than
    // silently advancing to a step where the OTP never arrives.
    try {
      await sendOtp(phone, role);
      goTo('otp');
    } catch (err) {
      const message = err?.message || 'Could not send verification code. Please try again.';
      addToast('error', message);
    }
  }

  /**
   * Back from whichever step the modal opened on means "leave sign-in", so it
   * closes and drops the user back on the page they came from. Only walk to an
   * earlier step when the user actually passed through it — a preset-role open
   * (`open('employer')`) never showed the role picker, and surfacing it on Back
   * offered every role to someone who had already picked one.
   */
  function backFrom(earlierStep) {
    if (step === entryStep) {
      close();
      return;
    }
    goTo(earlierStep);
  }

  function handlePhoneBack() {
    const distributorFamily = role === 'distributor' || role === 'branch' || role === 'agent';
    backFrom(distributorFamily ? 'distributor' : 'role');
  }

  // Progress: 0 = role, 1 = distributor/phone, 2 = otp/password
  function getProgress() {
    if (step === 'role') return 0;
    if (step === 'distributor') return 1;
    if (step === 'phone') return 1;
    // otp & password both occupy index 2 — equivalent terminal sign-in step.
    return 2;
  }

  const slideVariants = {
    enter: { opacity: 0 },
    center: { opacity: 1 },
    exit: { opacity: 0, position: 'absolute', top: 0, left: 0, right: 0 },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />

          <div className={styles.modalWrap}>
          <motion.div
            ref={modalRef}
            className={styles.modal}
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.45, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-modal-title"
            data-testid="signin-surface"
          >
            {/* Stable, screen-reader-only heading so the dialog has a single
                announced name regardless of which step is active. */}
            <h2 id="signin-modal-title" className={styles.srOnly}>
              Sign in to Universal Pensions
            </h2>
            {/* Branded header */}
            <div className={styles.header}>
              <div className={styles.headerBg} aria-hidden="true">
                <div className={styles.headerOrb1} />
                <div className={styles.headerOrb2} />
              </div>
              <img src={logo} alt="Universal Pensions" className={styles.logo} width={100} height={28} />

              {/* Step indicator */}
              <div className={styles.steps}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={styles.stepDot}
                    data-active={getProgress() >= i}
                  />
                ))}
              </div>

              <button className={styles.close} onClick={() => close()} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Content area */}
            <div className={styles.body}>
              <AnimatePresence mode="popLayout">
                {step === 'role' && (
                  <motion.div
                    key="role"
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    <RoleSelect onSelect={handleRoleSelect} />
                  </motion.div>
                )}

                {step === 'distributor' && (
                  <motion.div
                    key="distributor"
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    <DistributorSelect
                      onSelect={handleDistributorSelect}
                      onBack={() => backFrom('role')}
                    />
                  </motion.div>
                )}

                {step === 'phone' && (
                  <motion.div
                    key="phone"
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    {role === 'subscriber' ? (
                      <>
                        <div className={styles.authTabs}>
                          <button
                            type="button"
                            className={styles.authTab}
                            data-active="true"
                            aria-current="page"
                          >
                            Sign in
                          </button>
                          <button
                            type="button"
                            className={styles.authTab}
                            onClick={() => { close(); navigate('/signup'); }}
                          >
                            Create account
                          </button>
                        </div>
                        <PhoneEntry
                          role={role}
                          onSubmit={handlePhoneSubmit}
                          hideBadge
                          hideVisual
                          method={method}
                          onMethodChange={setMethod}
                        />
                        <button
                          type="button"
                          className={styles.altRole}
                          onClick={() => goTo('role')}
                        >
                          Not a subscriber? Choose a different role
                        </button>
                      </>
                    ) : (
                      <PhoneEntry
                        role={role}
                        onSubmit={handlePhoneSubmit}
                        onBack={handlePhoneBack}
                        method={method}
                        onMethodChange={setMethod}
                      />
                    )}
                  </motion.div>
                )}

                {step === 'otp' && (
                  <motion.div
                    key="otp"
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    <OtpVerify
                      phone={phone}
                      onVerify={handleVerify}
                      onResend={handleResend}
                      onBack={() => goTo('phone')}
                    />
                  </motion.div>
                )}

                {step === 'password' && (
                  <motion.div
                    key="password"
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    <PasswordEntry
                      phone={phone}
                      role={role}
                      onSubmit={handlePasswordVerify}
                      onSwitchToCode={handleSwitchToCode}
                      onBack={() => goTo('phone')}
                      error={passwordError}
                      showSwitchToCodeCta={showSwitchCta}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
