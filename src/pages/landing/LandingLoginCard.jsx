import { Link } from 'react-router-dom';
import PhoneEntry from '../../components/signin/PhoneEntry';
import OtpVerify from '../../components/signin/OtpVerify';
import PasswordEntry from '../../components/signin/PasswordEntry';
import { useLoginFlow } from '../../components/signin/useLoginFlow';
import styles from './landing.module.css';

// Real per-page login, wired to the shared auth flow. Reuses the app's actual
// sign-in step components (phone → OTP | password) rather than the mockup's
// static email/password fields — the platform authenticates by phone + OTP or
// password, so this is the correct real-auth surface.
//
// Props:
//   - audience:    single role (e.g. 'employer') — renders a role kicker.
//                  (Named `audience`, not `role`, so jsx-a11y doesn't mistake it
//                  for the DOM aria `role` attribute.)
//   - roles:       role family (e.g. ['distributor','branch','agent']) — renders
//                  selectable tabs; the active tab sets the role passed to auth.
//   - embedded:    when true, drops the outer card frame + kicker (the parent
//                  supplies framing, e.g. the subscriber hero's Sign-in tab).
//   - footerPrompt/footerLabel/footerHref: the "New here? → …" line under the form.

const ROLE_TAB_LABELS = { distributor: 'Distributor', branch: 'Branch', agent: 'Agent', employer: 'Employer', subscriber: 'Subscriber', admin: 'Administrator' };
const ROLE_KICKERS = {
  distributor: 'Distributor sign-in',
  branch: 'Branch sign-in',
  agent: 'Agent sign-in',
  employer: 'Employer sign-in',
  subscriber: 'Subscriber sign-in',
  admin: 'Administrator sign-in',
};

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function LandingLoginCard({
  audience: singleRole,
  roles,
  embedded = false,
  footerPrompt = 'New here?',
  footerLabel = 'Request access',
  footerHref = '/request-access',
}) {
  const tabRoles = roles && roles.length ? roles : null;
  const initial = tabRoles ? tabRoles[0] : singleRole;
  const flow = useLoginFlow({ role: initial, initialStep: 'phone' });

  const body = (
    <>
      {tabRoles && flow.step === 'phone' && (
        <div className={styles.roleTabs} role="tablist" aria-label="Account type">
          {tabRoles.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={flow.role === r}
              className={styles.roleTab}
              onClick={() => flow.setRole(r)}
            >
              {ROLE_TAB_LABELS[r]}
            </button>
          ))}
        </div>
      )}
      {!embedded && !tabRoles && (
        <span className={styles.loginKicker}>{ROLE_KICKERS[flow.role] || 'Sign in'}</span>
      )}

      <div className={styles.loginBody}>
        {flow.step === 'phone' && (
          <PhoneEntry
            role={flow.role}
            onSubmit={flow.handlePhoneSubmit}
            method={flow.method}
            onMethodChange={flow.setMethod}
            hideBadge
            hideVisual
          />
        )}
        {flow.step === 'otp' && (
          <OtpVerify
            phone={flow.phone}
            onVerify={flow.handleVerify}
            onResend={flow.handleResend}
            onBack={() => flow.setStep('phone')}
          />
        )}
        {flow.step === 'password' && (
          <PasswordEntry
            phone={flow.phone}
            role={flow.role}
            onSubmit={flow.handlePasswordVerify}
            onSwitchToCode={flow.handleSwitchToCode}
            onBack={() => flow.setStep('phone')}
            error={flow.passwordError}
            showSwitchToCodeCta={flow.showSwitchCta}
          />
        )}
      </div>

      <div className={styles.loginDiv}><span>{footerPrompt}</span></div>
      <Link className={styles.loginRequest} to={footerHref}>{footerLabel}</Link>
      <p className={styles.loginNote}>
        <LockIcon />
        Bank-grade security · your data stays private.
      </p>
    </>
  );

  if (embedded) return <div className={styles.loginEmbedded}>{body}</div>;
  return <div className={styles.loginCard} id="login">{body}</div>;
}
