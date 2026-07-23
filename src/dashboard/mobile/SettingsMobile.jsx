import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useEntity, useUpdateDistributor } from '../../hooks/useEntity';
import { changePassword } from '../../services/auth';
import styles from './distributorMobile.module.css';

/**
 * SettingsMobile — the distributor's Settings (route /dashboard/settings, from
 * the Menu hub). Profile (name / email / phone → useUpdateDistributor, mirroring
 * the desktop Settings distributor branch) and a password change
 * (changePassword). Dedicated mobile form, same save paths as desktop.
 */
export default function SettingsMobile() {
  const { user, updateUser } = useAuth();
  const distributorId = user?.distributorId ?? 'd-001';
  const { data: distributor } = useEntity('distributor', distributorId);
  const updateDistributor = useUpdateDistributor();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [profileMsg, setProfileMsg] = useState(null); // { ok, text }

  // Prefill from the distributor row, falling back to the auth user.
  useEffect(() => {
    setName(distributor?.managerName ?? user?.name ?? '');
    setEmail(distributor?.managerEmail ?? user?.email ?? '');
    setPhone(distributor?.managerPhone ?? user?.phone ?? '');
  }, [distributor?.managerName, distributor?.managerEmail, distributor?.managerPhone, user?.name, user?.email, user?.phone]);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setProfileMsg(null);
    if (!name.trim()) {
      setProfileMsg({ ok: false, text: 'Please enter your name.' });
      return;
    }
    try {
      await updateDistributor.mutateAsync({
        id: distributorId,
        updates: { managerName: name.trim(), managerPhone: phone.trim(), managerEmail: email.trim() },
      });
      updateUser?.({ name: name.trim(), email: email.trim(), phone: phone.trim() });
      setProfileMsg({ ok: true, text: 'Profile saved.' });
    } catch (err) {
      setProfileMsg({ ok: false, text: err?.message || 'Could not save. Try again.' });
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (!current || !next) {
      setPwMsg({ ok: false, text: 'Enter your current and new password.' });
      return;
    }
    if (next.length < 6) {
      setPwMsg({ ok: false, text: 'New password must be at least 6 characters.' });
      return;
    }
    if (next !== confirm) {
      setPwMsg({ ok: false, text: 'New passwords do not match.' });
      return;
    }
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
      {/* Profile */}
      <form className={styles.card} onSubmit={saveProfile} aria-label="Profile">
        <header className={styles.cardHd}><h3>Profile</h3></header>
        <label className={styles.fieldGroup} htmlFor="set-name">
          <span className={styles.fl}>Full name <span className={styles.req}>*</span></span>
          <span className={styles.field}>
            <input id="set-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Full name" />
          </span>
        </label>
        <label className={styles.fieldGroup} htmlFor="set-email">
          <span className={styles.fl}>Email address</span>
          <span className={styles.field}>
            <input id="set-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" aria-label="Email address" />
          </span>
        </label>
        <label className={styles.fieldGroup} htmlFor="set-phone">
          <span className={styles.fl}>Phone number</span>
          <span className={styles.field}>
            <input id="set-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+256 700 000 000" autoComplete="tel" aria-label="Phone number" />
          </span>
        </label>
        {profileMsg && <p className={profileMsg.ok ? styles.formOk : styles.formErr}>{profileMsg.text}</p>}
        <button type="submit" className={`${styles.btn} ${styles.btnPri} ${styles.btnBlock}`} style={{ marginTop: 14 }} disabled={updateDistributor.isPending}>
          {updateDistributor.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      {/* Password */}
      <form className={styles.card} onSubmit={savePassword} aria-label="Change password">
        <header className={styles.cardHd}><h3>Change password</h3></header>
        <label className={styles.fieldGroup} htmlFor="set-cur">
          <span className={styles.fl}>Current password</span>
          <span className={styles.field}>
            <input id="set-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" aria-label="Current password" />
          </span>
        </label>
        <label className={styles.fieldGroup} htmlFor="set-new">
          <span className={styles.fl}>New password</span>
          <span className={styles.field}>
            <input id="set-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-label="New password" />
          </span>
        </label>
        <label className={styles.fieldGroup} htmlFor="set-confirm">
          <span className={styles.fl}>Confirm new password</span>
          <span className={styles.field}>
            <input id="set-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-label="Confirm new password" />
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
