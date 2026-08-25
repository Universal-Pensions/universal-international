import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { isValidUGPhone, formatUGPhone } from '../../utils/phone';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useEntity } from '../../hooks/useEntity';
import { useToast } from '../../contexts/ToastContext';
import { getInitials } from '../../utils/dashboard';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import SettingsDesktop from './SettingsDesktop';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const { setSettingsOpen } = useDashboard();
  const { data: agent } = useEntity('agent', user?.agentId);
  const { addToast } = useToast();
  const hasPassword = user?.hasPassword === true;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState({});

  // Hydrate form once the agents row arrives from the query — equivalent to
  // useCurrentSubscriber's pattern on the subscriber dashboard. The cascading-
  // renders lint rule is overzealous for this one-shot population case.
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
        // Promise.resolve makes the try/catch correct in either case.
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

  const isDesktop = useIsDesktop();
  if (isDesktop) return <SettingsDesktop />;

  return (
    <div className={styles.page}>
      <form className={styles.form} onSubmit={handleSave} noValidate>
        <motion.div
          className={styles.profileCard}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
        >
          <span className={styles.avatar} aria-hidden="true">
            {getInitials(name || agent?.name || user?.name) || 'UP'}
          </span>
          <div className={styles.profileInfo}>
            <span className={styles.profileName}>{name || agent?.name || user?.name || 'Agent'}</span>
            <span className={styles.profilePhone}>{formatUGPhone(phone || agent?.phone || user?.phone)}</span>
            <span className={styles.roleBadge}>Agent</span>
          </div>
        </motion.div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Personal information</h2>
          <label className={styles.field}>
            <span className={styles.label}>Full name</span>
            <input
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => { setName(e.target.value); clearFieldError('name'); }}
              autoComplete="name"
              data-error={errors.name || undefined}
            />
            {errors.name && <span className={styles.errorLine}>{errors.name}</span>}
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Email <em>optional</em></span>
            <input
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              spellCheck={false}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Phone</span>
            <div className={styles.phoneField} data-error={errors.phone || undefined}>
              <span className={styles.phonePrefix}>+256</span>
              <input
                type="tel"
                className={styles.phoneInput}
                value={formatUGPhone(phone).replace(/^\+256 /, '')}
                onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '')); clearFieldError('phone'); }}
                autoComplete="tel"
                inputMode="numeric"
                spellCheck={false}
              />
            </div>
            {errors.phone && <span className={styles.errorLine}>{errors.phone}</span>}
          </label>
        </section>

        <section className={styles.section} aria-labelledby="agent-password-heading">
          <div className={styles.sectionHead}>
            <h2 id="agent-password-heading" className={styles.sectionTitle}>
              {hasPassword ? 'Change password' : 'Set password'}
            </h2>
          </div>
          <p className={styles.comingSoonHelp}>
            {hasPassword
              ? 'Rotate your password from the slide-in panel.'
              : 'Add a password to your account so you can sign in without a one-time code.'}
          </p>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setSettingsOpen(true)}
          >
            {hasPassword ? 'Change password' : 'Set password'}
          </button>
        </section>

        <footer className={styles.footer}>
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={!isDirty}
          >
            Save profile
          </button>
        </footer>
      </form>
    </div>
  );
}
