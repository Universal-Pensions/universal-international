import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PhoneEntry from '../components/signin/PhoneEntry';
import OtpVerify from '../components/signin/OtpVerify';
import PasswordEntry from '../components/signin/PasswordEntry';
import { useLoginFlow } from '../components/signin/useLoginFlow';
import logo from '../assets/logo-white.png';
import styles from './AdminLogin.module.css';

// Dedicated super-admin login portal at /admin/login (the /admin route is the
// Administrator landing page, which signs admins in from its own inline login
// card). Reuses the shared sign-in sub-components (phone → OTP | password) with
// the role fixed to 'admin', and the shared `useLoginFlow` orchestration
// (AuthContext.login + navigate).
const ROLE = 'admin';

export default function AdminLogin() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const {
    step, phone, method, setMethod, passwordError, showSwitchCta,
    handlePhoneSubmit, handleVerify, handleResend, handlePasswordVerify, handleSwitchToCode, setStep,
  } = useLoginFlow({ role: ROLE, initialStep: 'phone' });

  // An already-signed-in visitor hitting this portal goes straight to their dashboard.
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className={styles.page}>
      <main id="main" tabIndex={-1} className={styles.inner}>
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
      </main>
    </div>
  );
}
