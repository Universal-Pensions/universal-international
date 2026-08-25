import { useState } from 'react';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useEntity, useUpdateBranch } from '../../hooks/useEntity';
import { useToast } from '../../contexts/ToastContext';
import { changePassword } from '../../services/auth';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './branchMobile.module.css';

/**
 * SettingsMobile — the branch admin PHONE settings page. Mirrors the DESKTOP
 * SettingsDesktop's data wiring (useEntity('branch', branchId) prefill,
 * useUpdateBranch() to save) and renders the approved mockup's segmented
 * [Branch profile · Password] layout.
 *
 * Data honesty (A12-007):
 * - Branch ID is DISABLED — it comes straight off the entity (id) and has no
 *   editable write path. District is OMITTED (matching SettingsDesktop): the
 *   branch row stores only the district id (parentId, e.g. d-kam-015) with no
 *   human display-name field, so surfacing it read-only just showed a
 *   meaningless code.
 * - Profile save goes through the real useUpdateBranch() mutation (same one
 *   the distributor's branch-edit panel uses) — the success toast now fires
 *   only when the write actually lands.
 * - "Update password" calls the real POST /auth/change-password endpoint
 *   (services/auth.js changePassword — the same call subscriber, employer and
 *   admin Settings already use). It is JWT-authenticated rather than
 *   table-RLS-gated, so it works for any signed-in role, branch included.
 */
export default function SettingsMobile() {
  const { branchId } = useBranchScope();
  const { data: branch, isLoading, isError, error, refetch } = useEntity('branch', branchId);
  const { addToast } = useToast();
  const updateBranch = useUpdateBranch();

  const [tab, setTab] = useState('profile');

  const [name, setName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  // Prefill from the entity once it loads — adjust state during render (guarded
  // on branch.id so it runs once per branch), the React-recommended alternative
  // to a setState-in-effect. Mirrors SettingsDesktop's `synced` pattern.
  const [synced, setSynced] = useState(null);
  if (branch && synced !== branch.id) {
    setSynced(branch.id);
    setName(branch.name || '');
    setManagerName(branch.managerName || '');
    setManagerPhone(branch.managerPhone || '');
  }

  if (isError || (!branch && !isLoading)) {
    return (
      <ErrorCard
        title="We couldn't load your settings"
        message={error}
        onRetry={refetch}
      />
    );
  }

  if (isLoading && !branch) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    // A12-007: used to fire the success toast unconditionally with no write
    // behind it. Route through the real useUpdateBranch() mutation (same one
    // SettingsDesktop and the distributor's branch-edit panel use) so success
    // is contingent on the write actually succeeding.
    try {
      await updateBranch.mutateAsync({
        id: branchId,
        updates: {
          name: name.trim(),
          managerName: managerName.trim(),
          managerPhone: managerPhone.trim(),
        },
      });
      addToast('success', 'Branch profile saved.');
    } catch (err) {
      addToast('error', err?.message || 'Could not save the branch profile. Please try again.');
    }
  }

  async function handleUpdatePassword(e) {
    e.preventDefault();
    if (!currentPw || !newPw || !confirmPw) {
      addToast('error', 'Fill in all password fields.');
      return;
    }
    if (newPw !== confirmPw) {
      addToast('error', 'New passwords do not match.');
      return;
    }
    // A12-007: this used to toast "Password updated." unconditionally. There
    // IS a real, role-agnostic endpoint for this (POST /auth/change-password,
    // JWT-authenticated rather than table-RLS-gated) — subscriber, employer and
    // admin Settings already call it via services/auth.js changePassword(). Wire
    // the branch admin's password form to the same call instead of faking it.
    setPwBusy(true);
    try {
      await changePassword(currentPw, newPw);
      addToast('success', 'Password updated.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err) {
      addToast('error', err?.message || 'Could not update password. Please try again.');
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <>
      <div className={styles.seg} role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'profile'}
          className={`${styles.segBtn} ${tab === 'profile' ? styles.segBtnOn : ''}`}
          onClick={() => setTab('profile')}
        >
          Branch profile
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'password'}
          className={`${styles.segBtn} ${tab === 'password' ? styles.segBtnOn : ''}`}
          onClick={() => setTab('password')}
        >
          Password
        </button>
      </div>

      {tab === 'profile' && (
        <form onSubmit={handleSaveProfile}>
          <section className={styles.card} aria-label="Branch profile">
            <label className={styles.fl} htmlFor="bs-name">Branch name</label>
            <div className={styles.field}>
              <input
                id="bs-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Branch name"
              />
            </div>

            <label className={styles.fl} htmlFor="bs-id" style={{ marginTop: 16 }}>Branch ID</label>
            <div className={styles.field} style={{ opacity: 0.7 }}>
              <input id="bs-id" value={branch?.id || branchId || ''} disabled />
            </div>
            {/* District is intentionally omitted (matches SettingsDesktop): the
                branch row stores only the district id (e.g. d-kam-015) with no
                human display-name field, so showing it read-only just surfaced a
                meaningless code. */}
          </section>

          <section className={styles.card} aria-label="Branch manager">
            <header className={styles.cardHd}><h3>Branch manager</h3></header>
            <label className={styles.fl} htmlFor="bs-mgr">Manager name</label>
            <div className={styles.field}>
              <input
                id="bs-mgr"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                aria-label="Manager name"
              />
            </div>

            <label className={styles.fl} htmlFor="bs-phone" style={{ marginTop: 16 }}>Manager phone</label>
            <div className={styles.field}>
              <input
                id="bs-phone"
                value={managerPhone}
                onChange={(e) => setManagerPhone(e.target.value)}
                inputMode="tel"
                aria-label="Manager phone"
              />
            </div>
          </section>

          <button
            type="submit"
            className={`${styles.btn} ${styles.btnPri} ${styles.btnBlock}`}
            disabled={updateBranch.isPending}
          >
            {updateBranch.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}

      {tab === 'password' && (
        <form onSubmit={handleUpdatePassword}>
          <section className={styles.card} aria-label="Password">
            <p className={styles.scoreNote} style={{ marginBottom: 14 }}>
              Update the password you use to sign in.
            </p>
            <label className={styles.fl} htmlFor="bs-cur-pw">Current password</label>
            <div className={styles.field}>
              <input
                id="bs-cur-pw"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                aria-label="Current password"
              />
            </div>

            <label className={styles.fl} htmlFor="bs-new-pw" style={{ marginTop: 16 }}>New password</label>
            <div className={styles.field}>
              <input
                id="bs-new-pw"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="8+ chars, a letter and a number"
                autoComplete="new-password"
                aria-label="New password"
              />
            </div>

            <label className={styles.fl} htmlFor="bs-confirm-pw" style={{ marginTop: 16 }}>Confirm new password</label>
            <div className={styles.field}>
              <input
                id="bs-confirm-pw"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                aria-label="Confirm new password"
              />
            </div>
          </section>

          <button
            type="submit"
            className={`${styles.btn} ${styles.btnPri} ${styles.btnBlock}`}
            disabled={pwBusy}
          >
            {pwBusy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}
    </>
  );
}
