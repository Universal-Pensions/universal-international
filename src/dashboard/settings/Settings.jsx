import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { isValidUGPhone, parseUGPhoneLocal } from '../../utils/phone';
import { getInitials } from '../../utils/dashboard';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import { useCurrentSubscriber } from '../../hooks/useSubscriber';
import { useEntity, useUpdateDistributor } from '../../hooks/useEntity';
import { changePassword, AuthError } from '../../services/auth';
import styles from './Settings.module.css';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Settings panel                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function Settings({ splitMode = false, fullPage = false }) {
  const {
    settingsOpen,
    setSettingsOpen,
    setNomineesOpen,
    setNomineesTab,
  } = useDashboard();
  const { user, updateUser } = useAuth();
  const { addToast } = useToast();
  const isSubscriber = user?.role === 'subscriber';
  const isBranch = user?.role === 'branch';
  const isDistributor = user?.role === 'distributor';
  // Admin has no profile entity / no editable profile row — the shared panel
  // only persists to subscriber/branch/distributor backings. For admin we hide
  // the profile-edit card entirely (§7d-4) and keep just the password card so
  // there's no fake "Profile updated." toast against a row that doesn't exist.
  const isAdmin = user?.role === 'admin';
  const { data: branch } = useEntity('branch', isBranch ? user?.branchId : null);
  const distributorId = isDistributor ? (user?.distributorId ?? 'd-001') : null;
  const { data: distributor } = useEntity('distributor', distributorId);
  const updateDistributor = useUpdateDistributor();
  const { data: subscriber } = useCurrentSubscriber();
  const pensionCount = subscriber?.nominees?.pension?.length ?? 0;
  const insuranceCount = subscriber?.nominees?.insurance?.length ?? 0;

  function openNominees(tab) {
    setSettingsOpen(false);
    if (setNomineesTab) setNomineesTab(tab);
    if (setNomineesOpen) setNomineesOpen(true);
  }

  /* ── Profile form state ─────────────────────────────────────────────────── */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [errors, setErrors] = useState({});

  const identity = useMemo(() => {
    if (isBranch && branch) {
      return {
        name: branch.managerName || branch.name || user?.name || '',
        phone: branch.managerPhone || user?.phone || '',
        email: branch.managerEmail || '',
        title: branch.name || 'Branch admin',
      };
    }
    if (isDistributor) {
      return {
        name: distributor?.managerName || user?.name || '',
        phone: distributor?.managerPhone || user?.phone || '',
        email: distributor?.managerEmail || '',
        title: 'Distributor Admin',
      };
    }
    if (isAdmin) {
      return {
        name: user?.name || '',
        phone: user?.phone || '',
        email: user?.email || '',
        title: 'Platform Admin',
      };
    }
    return {
      name: user?.name || '',
      phone: user?.phone || '',
      email: user?.email || '',
      title: '',
    };
  }, [isBranch, isDistributor, isAdmin, branch, distributor, user?.name, user?.phone, user?.email]);

  useEffect(() => {
    setName(identity.name);
    setEmail(identity.email);
    setPhone(identity.phone);
  }, [identity]);

  /* Reset error state whenever the panel re-opens. */
  const [lastOpenedFor, setLastOpenedFor] = useState(null);
  if (settingsOpen && user && lastOpenedFor !== user) {
    setLastOpenedFor(user);
    setErrors({});
  } else if (!settingsOpen && lastOpenedFor !== null) {
    setLastOpenedFor(null);
  }

  /* Escape key to close */
  useEffect(() => {
    if (!settingsOpen) return;
    function handleEsc(e) {
      if (e.key === 'Escape' && !fullPage) setSettingsOpen(false);
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [settingsOpen, setSettingsOpen, fullPage]);

  /* ── Validation ─────────────────────────────────────────────────────────── */
  const validate = useCallback(() => {
    const e = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!isValidUGPhone(phone)) e.phone = 'Enter a valid Ugandan mobile number';

    setErrors(e);
    return Object.keys(e).length === 0;
  }, [name, phone]);

  /* ── Dirty check (enable save only if something changed) ────────────────── */
  const hasProfileChanges =
    name !== identity.name ||
    email !== identity.email ||
    phone !== identity.phone;
  const isDirty = hasProfileChanges;

  /* ── Submit ─────────────────────────────────────────────────────────────── */
  async function handleSave(e) {
    e.preventDefault();
    // Admin has no editable profile entity — the profile card is hidden, so
    // there's nothing to save (and no "Profile updated." toast that wouldn't
    // persist anywhere). Bail before validating the hidden fields.
    if (isAdmin) return;
    if (!validate()) return;

    // Profile changes flow through updateUser so the avatar / phone shown in
    // header chips updates immediately. Distributor profile additionally
    // persists to the `distributors` table via the RLS-gated update RPC.
    if (!hasProfileChanges) {
      addToast('success', 'Profile updated.');
      return;
    }
    if (isDistributor && distributorId) {
      try {
        await updateDistributor.mutateAsync({
          id: distributorId,
          updates: { managerName: name.trim(), managerPhone: phone, managerEmail: email.trim() },
        });
      } catch (err) {
        addToast('error', err?.message || 'Could not update profile.');
        return;
      }
    }
    updateUser({ name: name.trim(), email: email.trim(), phone });
    addToast('success', 'Profile updated.');
  }

  /* ── Password form state ───────────────────────────────────────────────────
     Separate from the profile form above so the Save Changes footer button
     stays tied to profile dirtiness; the password card has its own Save below. */
  const hasPassword = user?.hasPassword === true;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwErrors, setPwErrors] = useState({});
  const [pwSubmitting, setPwSubmitting] = useState(false);

  /* Reset password fields & errors whenever the panel re-opens / user changes. */
  useEffect(() => {
    if (!settingsOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
      setPwErrors({});
    }
  }, [settingsOpen]);

  function clearPwError(field) {
    if (pwErrors[field]) setPwErrors((prev) => ({ ...prev, [field]: '' }));
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    if (pwSubmitting) return;

    // Client-side shape check on newPassword (≥8 chars, ≥1 letter, ≥1 digit).
    // The server is still authoritative — this is just a faster failure path.
    const next = {};
    if (newPassword.length < 8) {
      next.newPassword = 'Password must be at least 8 characters.';
    } else if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      next.newPassword = 'Password must include a letter and a number.';
    }
    if (newPassword !== confirmPassword) {
      next.confirmPassword = 'Passwords do not match.';
    }
    if (Object.keys(next).length > 0) {
      setPwErrors(next);
      return;
    }

    setPwErrors({});
    setPwSubmitting(true);
    try {
      await changePassword(hasPassword ? currentPassword : '', newPassword);
      // Reflect the new state in AuthContext so the card re-renders into the
      // "Change password" variant immediately after an initial set.
      if (!hasPassword) {
        updateUser({ hasPassword: true });
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      addToast('success', hasPassword ? 'Password updated.' : 'Password set.');
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === 'current_password_invalid' || err.code === 'current_password_required') {
          setPwErrors({ currentPassword: err.message });
        } else if (
          err.code === 'password_too_short' ||
          err.code === 'password_too_weak' ||
          err.code === 'password_too_long' ||
          err.code === 'password_required'
        ) {
          setPwErrors({ newPassword: err.message });
        } else {
          addToast('error', err.message || 'Could not update password.');
        }
      } else {
        addToast('error', err?.message || 'Could not update password.');
      }
    } finally {
      setPwSubmitting(false);
    }
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function clearFieldError(field) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  }

  function formatPhone(raw) {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  return (
    <AnimatePresence>
      {(settingsOpen || fullPage) && (
        <>
          {/* Backdrop — hidden in split mode and in full-page (dash) mode */}
          {!splitMode && !fullPage && (
            <motion.div
              className={styles.backdrop}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setSettingsOpen(false)}
            />
          )}

          {/* Panel */}
          <motion.div
            className={styles.panel}
            data-split-mode={splitMode || undefined}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
            initial={fullPage ? false : { x: '100%', opacity: 0.6 }}
            animate={fullPage ? { opacity: 1 } : {
              x: 0,
              opacity: 1,
              transition: { duration: 0.55, ease: EASE_OUT_EXPO },
            }}
            exit={fullPage ? { opacity: 0 } : {
              x: '100%',
              opacity: 0.6,
              transition: { duration: 0.55, ease: EASE_OUT_EXPO },
            }}
            /* Slide-in → dialog; routed full page → a labelled region. It must NOT
               stay roleless in full-page mode: the aria-label below is then
               attached to a plain generic, so the panel's name is dropped from the
               a11y tree entirely (and nothing can address it). `region` is the
               correct role for a titled top-level section of a page. */
            role={fullPage ? 'region' : 'dialog'}
            aria-modal={fullPage ? undefined : 'true'}
            aria-label="Settings"
          >
            <form className={styles.form} onSubmit={handleSave} noValidate>
              {/* Header */}
              <div className={styles.header}>
                {!fullPage && (
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                  </svg>
                </button>
                )}
                <h2 className={styles.title}>Settings</h2>
                <p className={styles.subtitle}>Manage your profile and security</p>
              </div>

              {/* Scrollable body */}
              <div className={styles.body}>
                {/* Admin has no profile entity — show an honest, non-editable
                    note in place of the fake editable profile (§7d-4). The
                    password card below uses the role-agnostic route and works
                    for admin exactly as for the other roles. */}
                {isAdmin && (
                  <motion.div
                    className={styles.profileCard}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
                  >
                    <div className={styles.avatar}>
                      <span className={styles.avatarInitials}>{getInitials(user?.name || 'Admin')}</span>
                    </div>
                    <div className={styles.profileInfo}>
                      <span className={styles.profileName}>{user?.name || 'Platform Admin'}</span>
                      <span className={styles.profilePhone}>
                        Head-office account — profile managed centrally.
                      </span>
                      <span className={styles.roleBadge}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="12" height="12">
                          <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                          <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Platform Admin
                      </span>
                    </div>
                  </motion.div>
                )}

                {/* ── Profile card (non-admin: editable profile entity) ─── */}
                {!isAdmin && (
                <>
                <motion.div
                  className={styles.profileCard}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
                >
                  <div className={styles.avatar}>
                    <span className={styles.avatarInitials}>{getInitials(name || identity.name)}</span>
                  </div>
                  <div className={styles.profileInfo}>
                    <span className={styles.profileName}>{name || identity.name || (isDistributor ? 'Distributor' : 'Branch admin')}</span>
                    <span className={styles.profilePhone}>+256 {formatPhone(phone || identity.phone)}</span>
                    <span className={styles.roleBadge}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="12" height="12">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                        <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {identity.title || user?.role || 'Distributor Admin'}
                    </span>
                  </div>
                </motion.div>

                {/* ── Personal information ──────────────────────────────── */}
                <motion.div
                  className={styles.section}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.06, ease: EASE_OUT_EXPO }}
                >
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionIcon}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="16" height="16">
                        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75"/>
                        <path d="M5 21v-1a7 7 0 0114 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                      </svg>
                    </span>
                    <h3 className={styles.sectionTitle}>Personal Information</h3>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="settings-name">
                      Full Name <span className={styles.req}>*</span>
                    </label>
                    <input
                      id="settings-name"
                      className={styles.input}
                      type="text"
                      value={name}
                      onChange={(e) => { setName(e.target.value); clearFieldError('name'); }}
                      placeholder="Enter your full name"
                      data-error={!!errors.name}
                      autoComplete="name"
                    />
                    {errors.name && <p className={styles.error} role="alert">{errors.name}</p>}
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="settings-email">
                      Email Address
                    </label>
                    <input
                      id="settings-email"
                      className={styles.input}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="settings-phone">
                      Phone Number <span className={styles.req}>*</span>
                    </label>
                    <div className={styles.phoneGroup}>
                      <div className={styles.phonePrefix}>
                        <span className={styles.phoneCode}>+256</span>
                      </div>
                      <input
                        id="settings-phone"
                        className={styles.phoneInput}
                        type="tel"
                        inputMode="numeric"
                        value={phone}
                        onChange={(e) => {
                          const val = parseUGPhoneLocal(e.target.value);
                          setPhone(val);
                          clearFieldError('phone');
                        }}
                        placeholder="7XX XXX XXX"
                        autoComplete="tel"
                        spellCheck={false}
                      />
                    </div>
                    {errors.phone && <p className={styles.error} role="alert">{errors.phone}</p>}
                  </div>
                </motion.div>

                <div className={styles.sectionDivider} />
                </>
                )}

                {/* ── Change / Set password ─────────────────────────────────
                   Conditional title + field set based on whether the user
                   already has a `password_hash` on file (AuthContext.user.
                   hasPassword, threaded through verify-otp / verify-password).
                   Nested <form> would break the outer profile form, so the
                   submit is wired via the Save button's onClick. */}
                <motion.div
                  className={styles.section}
                  aria-labelledby="settings-password-heading"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.12, ease: EASE_OUT_EXPO }}
                >
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionIcon}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="16" height="16">
                        <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.75"/>
                        <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                        <circle cx="12" cy="16.5" r="1.5" fill="currentColor"/>
                      </svg>
                    </span>
                    <h3 id="settings-password-heading" className={styles.sectionTitle}>
                      {hasPassword ? 'Change password' : 'Set password'}
                    </h3>
                  </div>

                  {hasPassword && (
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="settings-current-pw">
                        Current password
                      </label>
                      <div className={styles.passwordWrap}>
                        <input
                          id="settings-current-pw"
                          className={styles.input}
                          type={showCurrent ? 'text' : 'password'}
                          value={currentPassword}
                          onChange={(e) => { setCurrentPassword(e.target.value); clearPwError('currentPassword'); }}
                          autoComplete="current-password"
                          spellCheck={false}
                          data-error={!!pwErrors.currentPassword}
                        />
                        <button
                          type="button"
                          className={styles.toggleBtn}
                          onClick={() => setShowCurrent((v) => !v)}
                          aria-label={showCurrent ? 'Hide password' : 'Show password'}
                          aria-pressed={showCurrent}
                          tabIndex={0}
                        >
                          {showCurrent ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>
                      {pwErrors.currentPassword && (
                        <p className={styles.error} role="alert">{pwErrors.currentPassword}</p>
                      )}
                    </div>
                  )}

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="settings-new-pw">
                      New password
                    </label>
                    <div className={styles.passwordWrap}>
                      <input
                        id="settings-new-pw"
                        className={styles.input}
                        type={showNew ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => { setNewPassword(e.target.value); clearPwError('newPassword'); }}
                        autoComplete="new-password"
                        spellCheck={false}
                        data-error={!!pwErrors.newPassword}
                      />
                      <button
                        type="button"
                        className={styles.toggleBtn}
                        onClick={() => setShowNew((v) => !v)}
                        aria-label={showNew ? 'Hide password' : 'Show password'}
                        aria-pressed={showNew}
                        tabIndex={0}
                      >
                        {showNew ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <span className={styles.strengthLabel}>
                      8+ characters with at least one letter and one number.
                    </span>
                    {pwErrors.newPassword && (
                      <p className={styles.error} role="alert">{pwErrors.newPassword}</p>
                    )}
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="settings-confirm-pw">
                      Confirm new password
                    </label>
                    <div className={styles.passwordWrap}>
                      <input
                        id="settings-confirm-pw"
                        className={styles.input}
                        type={showConfirm ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); clearPwError('confirmPassword'); }}
                        autoComplete="new-password"
                        spellCheck={false}
                        data-error={!!pwErrors.confirmPassword}
                      />
                      <button
                        type="button"
                        className={styles.toggleBtn}
                        onClick={() => setShowConfirm((v) => !v)}
                        aria-label={showConfirm ? 'Hide password' : 'Show password'}
                        aria-pressed={showConfirm}
                        tabIndex={0}
                      >
                        {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    {pwErrors.confirmPassword && (
                      <p className={styles.error} role="alert">{pwErrors.confirmPassword}</p>
                    )}
                  </div>

                  <div className={styles.passwordActions}>
                    <button
                      type="button"
                      className={styles.saveBtn}
                      onClick={handlePasswordSubmit}
                      disabled={pwSubmitting}
                    >
                      {pwSubmitting ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </motion.div>

                {/* ── Nominees & beneficiaries (subscriber only) ────────── */}
                {isSubscriber && (
                  <>
                    <div className={styles.sectionDivider} />
                    <motion.div
                      className={styles.section}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: 0.18, ease: EASE_OUT_EXPO }}
                    >
                      <div className={styles.sectionHeader}>
                        <span className={styles.sectionIcon}>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="16" height="16">
                            <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.75"/>
                            <path d="M3 20v-1a5 5 0 0110 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                            <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.75"/>
                            <path d="M21 20v-1a3.5 3.5 0 00-3.5-3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                          </svg>
                        </span>
                        <h3 className={styles.sectionTitle}>Nominees & Beneficiaries</h3>
                      </div>

                      <p className={styles.nomineesHelp}>
                        Nominees receive your savings or insurance benefit. Shares must total 100%.
                      </p>

                      <div className={styles.nomineesGrid}>
                        <button
                          type="button"
                          className={styles.nomineeTile}
                          onClick={() => openNominees('pension')}
                        >
                          <span className={styles.nomineeTileHead}>
                            <span className={styles.nomineeTileLabel}>Pension nominees</span>
                            <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" className={styles.nomineeTileArrow}>
                              <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                            </svg>
                          </span>
                          <span className={styles.nomineeTileCount}>
                            {pensionCount} on file
                          </span>
                        </button>
                        <button
                          type="button"
                          className={styles.nomineeTile}
                          onClick={() => openNominees('insurance')}
                        >
                          <span className={styles.nomineeTileHead}>
                            <span className={styles.nomineeTileLabel}>Insurance nominees</span>
                            <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" className={styles.nomineeTileArrow}>
                              <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                            </svg>
                          </span>
                          <span className={styles.nomineeTileCount}>
                            {insuranceCount} on file
                          </span>
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </button>
                <span className={styles.footerSpacer} />
                {/* No editable profile entity for admin — the password card
                    has its own Save, so the profile submit is omitted (§7d-4). */}
                {!isAdmin && (
                  <button
                    type="submit"
                    className={styles.saveBtn}
                    disabled={!isDirty}
                  >
                    Save Changes
                  </button>
                )}
              </div>
            </form>
          </motion.div>

        </>
      )}
    </AnimatePresence>
  );
}

/* Eye icons for password show/hide toggles — same shapes as the signup
   ReviewStep so the visual language stays consistent across surfaces. */
function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none">
      <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none">
      <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.2 5.2A8.8 8.8 0 0 1 10 5c5 0 8 5 8 5a14.2 14.2 0 0 1-2.4 2.9M5.7 6.7C3.4 8.3 2 10 2 10s3 5 8 5a8.8 8.8 0 0 0 3.3-.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.6 8.6a2 2 0 0 0 2.8 2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
