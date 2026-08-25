import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { isValidUGPhone, formatUGPhone } from '../../utils/phone';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useEntity } from '../../hooks/useEntity';
import { useToast } from '../../contexts/ToastContext';
import { getInitials } from '../../utils/dashboard';
import formStyles from './SettingsPage.module.css';
import styles from './SettingsDesktop.module.css';

/**
 * SettingsDesktop — desktop (>=1024px) layout for the agent Settings page.
 *
 * Rendered in place of SettingsPage's mobile body when useIsDesktop() is true
 * (the fork lives in SettingsPage.jsx). The mobile experience is untouched.
 *
 * TAB-ROOT desktop page: owns a PLAIN <h1> "Settings" (no back, no hero dome —
 * the desktop top bar renders no <h1>). A static "Agent" role badge sits beside
 * the title. Profile data is read via useEntity('agent', agentId) and saved
 * through useAuth().updateUser — a SESSION-only merge (there is no
 * useUpdateAgent mutation; agent profile persistence is session-only, matching
 * the branch role). The Change/Set-password action opens the SHARED slide-in
 * Settings.jsx via useDashboard().setSettingsOpen(true) — the desktop shell
 * already mounts exactly one Settings inside the DashboardProvider.
 */
export default function SettingsDesktop() {
  const { user, updateUser } = useAuth();
  const { setSettingsOpen } = useDashboard();
  const { data: agent } = useEntity('agent', user?.agentId);
  const { addToast } = useToast();
  const hasPassword = user?.hasPassword === true;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState({});

  // Hydrate the form once the agents row arrives — mirrors SettingsPage. The
  // cascading-renders lint rule is overzealous for this one-shot population.
  useEffect(() => {
    if (!agent) return;
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate form from query result */
    setName(agent.name ?? user?.name ?? '');
    setEmail(agent.email ?? '');
    setPhone(agent.phone ?? user?.phone ?? '');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [agent, user?.name, user?.phone]);

  const hasProfileChanges =
    name !== (agent?.name || user?.name || '') ||
    email !== (agent?.email || '') ||
    phone !== (agent?.phone || user?.phone || '');
  const isDirty = hasProfileChanges;

  const validate = useCallback(() => {
    const e = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!isValidUGPhone(phone)) e.phone = 'Enter a valid Ugandan mobile number';

    setErrors(e);
    return Object.keys(e).length === 0;
  }, [name, phone]);

  async function handleSave(e) {
    e.preventDefault();
    if (!validate()) return;

    try {
      if (hasProfileChanges) {
        // updateUser() is sync today but may become async with a real backend.
        // Promise.resolve makes the try/catch correct in either case. Session
        // merge only — there is no agent persistence mutation.
        await Promise.resolve(
          updateUser({ name: name.trim(), email: email.trim(), phone })
        );
      }
      addToast('success', 'Profile updated.');
    } catch (err) {
      addToast('error', err?.message || 'Could not update profile.');
    }
  }

  function clearFieldError(field) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <h1 className={styles.title}>Settings</h1>
          <span className={styles.headBadge}>Agent</span>
        </div>
        <p className={styles.subtitle}>Manage your profile and security</p>
      </header>

      <form className={styles.form} onSubmit={handleSave} noValidate>
        <motion.div
          className={formStyles.profileCard}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
        >
          <span className={formStyles.avatar} aria-hidden="true">
            {getInitials(name || agent?.name || user?.name) || 'UP'}
          </span>
          <div className={formStyles.profileInfo}>
            <span className={formStyles.profileName}>{name || agent?.name || user?.name || 'Agent'}</span>
            <span className={formStyles.profilePhone}>{formatUGPhone(phone || agent?.phone || user?.phone)}</span>
            {/* The static "Agent" role badge lives in the page header on desktop
                (styles.headBadge). The profile card omits its own role badge so
                there is exactly one exact-text "Agent" node on the page — the
                Settings smoke test asserts getByText('Agent', { exact: true })
                without .first(), so a second match would be a strict-mode fail. */}
          </div>
        </motion.div>

        <section className={formStyles.section}>
          <h2 className={formStyles.sectionTitle}>Personal information</h2>
          <label className={formStyles.field}>
            <span className={formStyles.label}>Full name</span>
            <input
              type="text"
              className={formStyles.input}
              value={name}
              onChange={(e) => { setName(e.target.value); clearFieldError('name'); }}
              autoComplete="name"
              data-error={errors.name || undefined}
            />
            {errors.name && <span className={formStyles.errorLine}>{errors.name}</span>}
          </label>

          <label className={formStyles.field}>
            <span className={formStyles.label}>Email <em>optional</em></span>
            <input
              type="email"
              className={formStyles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              spellCheck={false}
            />
          </label>

          <label className={formStyles.field}>
            <span className={formStyles.label}>Phone</span>
            <div className={formStyles.phoneField} data-error={errors.phone || undefined}>
              <span className={formStyles.phonePrefix}>+256</span>
              <input
                type="tel"
                className={formStyles.phoneInput}
                value={formatUGPhone(phone).replace(/^\+256 /, '')}
                onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '')); clearFieldError('phone'); }}
                autoComplete="tel"
                inputMode="numeric"
                spellCheck={false}
              />
            </div>
            {errors.phone && <span className={formStyles.errorLine}>{errors.phone}</span>}
          </label>
        </section>

        <section className={formStyles.section} aria-labelledby="agent-password-heading">
          <div className={formStyles.sectionHead}>
            <h2 id="agent-password-heading" className={formStyles.sectionTitle}>
              {hasPassword ? 'Change password' : 'Set password'}
            </h2>
          </div>
          <p className={formStyles.comingSoonHelp}>
            {hasPassword
              ? 'Rotate your password from the slide-in panel.'
              : 'Add a password to your account so you can sign in without a one-time code.'}
          </p>

          <button
            type="button"
            className={formStyles.primaryBtn}
            onClick={() => setSettingsOpen(true)}
          >
            {hasPassword ? 'Change password' : 'Set password'}
          </button>
        </section>

        <footer className={formStyles.footer}>
          <button
            type="submit"
            className={formStyles.primaryBtn}
            disabled={!isDirty}
          >
            Save profile
          </button>
        </footer>
      </form>
    </div>
  );
}
