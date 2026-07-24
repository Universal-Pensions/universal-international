import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatDate } from '../../utils/date';
import { formatMemberId } from '../../utils/memberId';
import { isValidUGPhone, parseUGPhoneLocal } from '../../utils/phone';
import { useCurrentSubscriber, useUpdateProfile } from '../../hooks/useSubscriber';
import { useAllEntities } from '../../hooks/useEntity';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useToast } from '../../contexts/ToastContext';
import PageHeader from '../../components/PageHeader';
import MemberCard from '../../components/MemberCard';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './ProfilePage.module.css';

const UG_PREFIX = '+256';

const OCCUPATION_LABEL = {
  farmer: 'Farmer',
  trader: 'Trader / shopkeeper',
  'boda-boda': 'Boda-boda rider',
  artisan: 'Artisan / craftsperson',
  'market-vendor': 'Market vendor',
  other: 'Other',
};

function formatDob(dob) {
  return formatDate(dob, { variant: 'short' });
}

function titleCase(s) {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();
  const { data: districts = [] } = useAllEntities('district');
  const { addToast } = useToast();
  const updateProfile = useUpdateProfile(sub?.id);

  const districtName = useMemo(() => {
    if (!sub?.districtId) return null;
    return districts.find((d) => d.id === sub.districtId)?.name ?? null;
  }, [sub?.districtId, districts]);

  const occupationLabel = sub?.occupation
    ? OCCUPATION_LABEL[sub.occupation] ?? titleCase(sub.occupation)
    : '—';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Hydrate the form once `sub` arrives from React Query — useState's
  // initializer runs once on first render when `sub` is undefined, so without
  // this effect the form stays blank for the user. Same pattern as the agent
  // SettingsPage hydration fix.
  useEffect(() => {
    if (!sub) return;
    // Hydrate form from query result. The earlier `eslint-disable
    // react-hooks/set-state-in-effect` block was removed in Phase 6 (PR-10)
    // — that rule no longer flags this pattern, so the suppression was a
    // dead directive.
    setName(sub.name ?? '');
    setEmail(sub.email ?? '');
    setPhoneDigits(
      sub.phone ? sub.phone.replace(/^\+256/, '').replace(/\D/g, '') : ''
    );
  }, [sub]);

  const dirty =
    name !== (sub?.name || '') ||
    email !== (sub?.email || '') ||
    phoneDigits !== (sub?.phone ? sub.phone.replace(/^\+256/, '').replace(/\D/g, '') : '');

  const validName = name.trim().length >= 2;
  const validPhone = isValidUGPhone(phoneDigits);
  const validEmail = !email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const showEmailError = emailTouched && email && !validEmail;
  const canSave = dirty && validName && validPhone && validEmail;

  async function handleSave() {
    if (!canSave || !sub) return;
    setSubmitting(true);
    try {
      await updateProfile.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        phone: phoneDigits ? `+256${phoneDigits}` : '',
      });
      addToast('success', 'Profile updated.');
      navigate(-1);
    } catch (err) {
      addToast('error', err?.message || 'Could not update profile.');
    } finally {
      setSubmitting(false);
    }
  }

  // E3 — surface the standard retry card on a subscriber-query failure rather
  // than silently rendering an empty/broken profile form (mirrors HomePage).
  if (isError) {
    return (
      <div className={styles.page}>
        <ErrorCard title="We couldn't load your profile" message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Desktop (>=1024px) keeps the shipped PageHeader hero exactly. Mobile
          drops it — the persistent shell app bar already shows the "Profile"
          title and a back arrow, so the form body starts at the top instead. */}
      {isDesktop && (
        <PageHeader variant="hero" title="Profile" subtitle="Edit your personal details" fallback="/dashboard/settings" />
      )}

      <div className={styles.body}>
        <motion.div
          className={styles.step}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          {sub && (
            <div className={styles.cardWrap}>
              <MemberCard
                fullName={sub.name}
                memberId={formatMemberId(sub.phone)}
                enrolled={sub.registeredDate}
                dob={sub.dob}
                gender={sub.gender}
              />
            </div>
          )}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Personal information</h2>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Full name</span>
              <input
                type="text"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                autoComplete="name"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Phone</span>
              <div className={styles.phoneInput}>
                <span className={styles.phonePrefix}>{UG_PREFIX}</span>
                <input
                  type="tel"
                  inputMode="tel"
                  className={`${styles.input} ${styles.phoneFlex}`}
                  value={phoneDigits}
                  onChange={(e) => setPhoneDigits(parseUGPhoneLocal(e.target.value))}
                  placeholder="7X XXX XXXX"
                  autoComplete="tel-national"
                />
              </div>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email (optional)</span>
              <input
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                placeholder="you@example.com"
                autoComplete="email"
                spellCheck={false}
                data-error={showEmailError ? 'true' : undefined}
              />
              {showEmailError && <span className={styles.errorLine} role="alert">Looks like that email address isn&apos;t valid.</span>}
            </label>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Identity</h2>
            <ul className={styles.readonlyList}>
              <li>
                <span className={styles.readonlyLabel}>NIN</span>
                <span className={styles.readonlyValue}>{sub?.nin || '—'}</span>
              </li>
              <li>
                <span className={styles.readonlyLabel}>Date of birth</span>
                <span className={styles.readonlyValue}>{formatDob(sub?.dob)}</span>
              </li>
              <li>
                <span className={styles.readonlyLabel}>Gender</span>
                <span className={styles.readonlyValue}>{titleCase(sub?.gender)}</span>
              </li>
              <li>
                <span className={styles.readonlyLabel}>Occupation</span>
                <span className={styles.readonlyValue}>{occupationLabel}</span>
              </li>
              <li>
                <span className={styles.readonlyLabel}>District</span>
                <span className={styles.readonlyValue}>{districtName || '—'}</span>
              </li>
            </ul>
            <p className={styles.helperLine}>
              These details came from your KYC. To change them, contact support.
            </p>
          </section>
        </motion.div>
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!canSave || submitting}
          onClick={handleSave}
        >
          {submitting ? 'Saving…' : dirty ? 'Save changes' : 'No changes to save'}
        </button>
      </footer>
    </div>
  );
}
