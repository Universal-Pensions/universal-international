import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { changePassword } from '../../services/auth';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

const InfoIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'A';
}

/**
 * AdminSettingsMobile — the super-admin's Settings (route /dashboard/settings).
 * The admin has no editable profile entity (managed centrally, per the desktop
 * Settings admin branch); the only action is a password change.
 */
export default function AdminSettingsMobile() {
  const { user } = useAuth();
  const name = user?.name || 'Platform Admin';

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function savePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (!current || !next) { setPwMsg({ ok: false, text: 'Enter your current and new password.' }); return; }
    if (next.length < 6) { setPwMsg({ ok: false, text: 'New password must be at least 6 characters.' }); return; }
    if (next !== confirm) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return; }
    setPwBusy(true);
    try {
      await changePassword(current, next);
      setPwMsg({ ok: true, text: 'Password changed.' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setPwMsg({ ok: false, text: err?.message || 'Could not change password.' });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <>
      {/* Read-only identity */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Account">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.acctNm}>{name}</div>
            <div className={styles.acctMt}>Platform Admin</div>
          </div>
        </div>
        <div className={styles.callout} style={{ marginTop: 14 }}>
          <span className={styles.calloutIc} aria-hidden="true">{InfoIcon}</span>
          <div>
            <b>Head-office account</b>
            <p>Your profile is managed centrally. You can change your sign-in password below.</p>
          </div>
        </div>
      </section>

      {/* Password */}
      <form className={styles.card} onSubmit={savePassword} aria-label="Change password">
        <header className={styles.cardHd}><h3>Change password</h3></header>
        <label className={styles.fieldGroup} htmlFor="admin-cur">
          <span className={styles.fl}>Current password</span>
          <span className={styles.field}>
            <input id="admin-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" aria-label="Current password" />
          </span>
        </label>
        <label className={styles.fieldGroup} htmlFor="admin-new">
          <span className={styles.fl}>New password</span>
          <span className={styles.field}>
            <input id="admin-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-label="New password" />
          </span>
        </label>
        <label className={styles.fieldGroup} htmlFor="admin-confirm">
          <span className={styles.fl}>Confirm new password</span>
          <span className={styles.field}>
            <input id="admin-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-label="Confirm new password" />
          </span>
        </label>
        {pwMsg && <p className={pwMsg.ok ? styles.formOk : styles.formErr}>{pwMsg.text}</p>}
        <button type="submit" className={`${styles.btn} ${styles.btnSec} ${styles.btnBlock}`} style={{ marginTop: 14 }} disabled={pwBusy}>
          {pwBusy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </>
  );
}
