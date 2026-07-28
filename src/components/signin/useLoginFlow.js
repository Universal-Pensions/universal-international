import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { hasDashboard, sendOtp, verifyOtp, signInWithPassword, AuthError } from '../../services/auth';

/**
 * Shared sign-in orchestration — the phone → (OTP | password) state machine that
 * used to live inline in `SignInModal`. Extracted so every login surface drives
 * the exact same flow and error handling:
 *   - `SignInModal`      (role picker → distributor sub-select → phone → …)
 *   - `AdminLogin` (/admin/login, role fixed to 'admin')
 *   - the landing inline login cards (`LandingLoginCard`, subscriber hero tab)
 *
 * The caller owns *how* a role is chosen (a fixed role, the modal's picker, or
 * the distributor page's role tabs) and passes the current `role`; the hook owns
 * dispatching the code, verifying OTP/password, and — on success —
 * `AuthContext.login` + navigate to the dashboard, then the optional
 * `onSuccess()` (the modal uses it to close before navigating).
 *
 * Steps: 'role' | 'distributor' | 'phone' | 'otp' | 'password'. The 'role' and
 * 'distributor' steps are only used by the modal; fixed-role callers start at
 * 'phone'.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.role]          initial role (fixed-role callers pass e.g. 'employer')
 * @param {string}   [opts.initialStep]   defaults to 'role' when no role, else 'phone'
 * @param {() => void}         [opts.onSuccess]      run after login, before navigate (e.g. modal close)
 * @param {(err: Error) => void} [opts.onOtpSendError] surfaced when the OTP dispatch fails (e.g. a toast)
 */
export function useLoginFlow({ role: initialRole = null, initialStep, onSuccess, onOtpSendError } = {}) {
  const { login } = useAuth();
  const navigate = useNavigate();

  const firstStep = initialStep ?? (initialRole ? 'phone' : 'role');
  const [step, setStep] = useState(firstStep);
  const [role, setRole] = useState(initialRole);
  const [phone, setPhone] = useState('');
  // 'code' (OTP, default) | 'password'. Toggled from PhoneEntry's chip row.
  const [method, setMethod] = useState('code');
  // Inline error surfaced inside PasswordEntry (invalid_password + other
  // non-`password_not_set` codes). Cleared on every fresh password attempt.
  const [passwordError, setPasswordError] = useState('');
  // When the backend returns `password_not_set`, render PasswordEntry's
  // prominent "Use a code instead" CTA panel.
  const [showSwitchCta, setShowSwitchCta] = useState(false);

  const finishAuth = useCallback(
    async ({ token, user }) => {
      await login({ token, user });
      onSuccess?.();
      navigate(hasDashboard(user.role) ? '/dashboard' : '/coming-soon');
    },
    [login, navigate, onSuccess],
  );

  // Modal-only: role picker → distributor sub-select or straight to phone.
  const handleRoleSelect = useCallback((selected) => {
    if (selected === 'distributor') {
      setStep('distributor');
    } else {
      setRole(selected);
      setStep('phone');
    }
  }, []);

  // Modal-only: distributor/branch/agent sub-role chosen.
  const handleDistributorSelect = useCallback((subRole) => {
    setRole(subRole);
    setStep('phone');
  }, []);

  const handlePhoneSubmit = useCallback(
    async (phoneNum) => {
      setPhone(phoneNum);
      setPasswordError('');
      setShowSwitchCta(false);
      if (method === 'password') {
        // Skip the OTP dispatch — go straight to the password step.
        setStep('password');
        return;
      }
      // Await the dispatch so a cold backend can't drop us on the OTP step
      // before the send actually fired. Re-throw so PhoneEntry resets its
      // spinner; onOtpSendError lets a caller surface a toast/inline message.
      try {
        await sendOtp(phoneNum, role);
        setStep('otp');
      } catch (err) {
        onOtpSendError?.(err);
        throw err;
      }
    },
    [method, role, onOtpSendError],
  );

  // Throws on failure so OtpVerify renders the per-code message.
  const handleVerify = useCallback(
    async (code) => {
      const { token, user } = await verifyOtp(phone, code, role);
      await finishAuth({ token, user });
    },
    [phone, role, finishAuth],
  );

  const handleResend = useCallback(async () => {
    await sendOtp(phone, role);
  }, [phone, role]);

  const handlePasswordVerify = useCallback(
    async (password) => {
      setPasswordError('');
      setShowSwitchCta(false);
      try {
        const { token, user } = await signInWithPassword(phone, password, role);
        await finishAuth({ token, user });
      } catch (err) {
        const code = err instanceof AuthError ? err.code : 'network';
        if (code === 'password_not_set') {
          setShowSwitchCta(true);
          return;
        }
        if (code === 'invalid_password') {
          setPasswordError('Incorrect password.');
          return;
        }
        setPasswordError(err?.message || 'Could not sign you in. Please try again.');
      }
    },
    [phone, role, finishAuth],
  );

  // Flip from the password path back to OTP: re-issue the code, go to 'otp'.
  const handleSwitchToCode = useCallback(async () => {
    setMethod('code');
    setPasswordError('');
    setShowSwitchCta(false);
    try {
      await sendOtp(phone, role);
      setStep('otp');
    } catch (err) {
      onOtpSendError?.(err);
    }
  }, [phone, role, onOtpSendError]);

  // Back from the phone step: return distributor-family roles to the sub-select,
  // everyone else to the role picker (modal). Fixed-role callers can ignore this.
  const handlePhoneBack = useCallback(() => {
    setStep(role === 'distributor' || role === 'branch' || role === 'agent' ? 'distributor' : 'role');
  }, [role]);

  const reset = useCallback(() => {
    setStep(firstStep);
    setRole(initialRole);
    setPhone('');
    setMethod('code');
    setPasswordError('');
    setShowSwitchCta(false);
  }, [firstStep, initialRole]);

  return {
    // state
    step,
    role,
    phone,
    method,
    passwordError,
    showSwitchCta,
    // setters (for the modal's preset/close transitions + the distributor tabs)
    setStep,
    setRole,
    setMethod,
    // handlers
    handleRoleSelect,
    handleDistributorSelect,
    handlePhoneSubmit,
    handleVerify,
    handleResend,
    handlePasswordVerify,
    handleSwitchToCode,
    handlePhoneBack,
    reset,
  };
}
