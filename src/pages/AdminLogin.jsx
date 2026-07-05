import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasDashboard, sendOtp, verifyOtp, signInWithPassword, AuthError } from '../services/auth';
import PhoneEntry from '../components/signin/PhoneEntry';
import OtpVerify from '../components/signin/OtpVerify';
import PasswordEntry from '../components/signin/PasswordEntry';
import logo from '../assets/logo-white.png';
import styles from './AdminLogin.module.css';

// Dedicated super-admin login portal at /admin. Reuses the shared sign-in
// sub-components (phone → OTP | password) with the role fixed to 'admin', then
// runs the same AuthContext.login + navigate('/dashboard') flow as SignInModal.
const ROLE = 'admin';

export default function AdminLogin() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState('code');
  const [passwordError, setPasswordError] = useState('');
  const [showSwitchCta, setShowSwitchCta] = useState(false);

  // An already-signed-in visitor hitting /admin goes straight to their dashboard.
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  async function handlePhoneSubmit(phoneNum) {
    setPhone(phoneNum);
    setPasswordError('');
    setShowSwitchCta(false);
    if (method === 'password') {
      setStep('password');
      return;
    }
    await sendOtp(phoneNum, ROLE);
    setStep('otp');
  }

  async function handleVerify(code) {
    const { token, user } = await verifyOtp(phone, code, ROLE);
    await login({ token, user });
    navigate(hasDashboard(user.role) ? '/dashboard' : '/coming-soon');
  }

  async function handleResend() {
    await sendOtp(phone, ROLE);
  }

  async function handlePasswordVerify(password) {
    setPasswordError('');
    setShowSwitchCta(false);
    try {
      const { token, user } = await signInWithPassword(phone, password, ROLE);
      await login({ token, user });
      navigate(hasDashboard(user.role) ? '/dashboard' : '/coming-soon');
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
  }

  async function handleSwitchToCode() {
    setMethod('code');
    setPasswordError('');
    setShowSwitchCta(false);
    await sendOtp(phone, ROLE);
    setStep('otp');
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <img src={logo} alt="Universal Pensions" className={styles.logo} width={140} height={40} />
        <div className={styles.card}>
          <span className={styles.badge}>Admin portal · super-admin</span>
          <div className={styles.body}>
            {step === 'phone' && (
              <PhoneEntry
                role={ROLE}
                onSubmit={handlePhoneSubmit}
                method={method}
                onMethodChange={setMethod}
                hideBadge
              />
            )}
            {step === 'otp' && (
              <OtpVerify
                phone={phone}
                onVerify={handleVerify}
                onResend={handleResend}
                onBack={() => setStep('phone')}
              />
            )}
            {step === 'password' && (
              <PasswordEntry
                phone={phone}
                role={ROLE}
                onSubmit={handlePasswordVerify}
                onSwitchToCode={handleSwitchToCode}
                onBack={() => setStep('phone')}
                error={passwordError}
                showSwitchToCodeCta={showSwitchCta}
              />
            )}
          </div>
        </div>
        <Link to="/" className={styles.backHome}>← Back to the main site</Link>
      </div>
    </div>
  );
}
