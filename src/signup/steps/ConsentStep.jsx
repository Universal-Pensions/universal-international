import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useSignup } from '../SignupContext';
import { useOnboardAudience } from '../OnboardAudienceContext';
import { LEGAL_TERMS_URL, LEGAL_PRIVACY_URL } from '../../config/env';
import styles from './Step.module.css';
import own from './ConsentStep.module.css';

/**
 * Spec: plain-language summary of
 *   1. what data is collected
 *   2. why it is processed
 *   3. who it may be shared with
 * Then a consent checkbox; on check, log UTC timestamp + phone.
 */

const DATA_COLLECTED = [
  { id: 'name',         label: 'Name' },
  { id: 'nin',          label: 'NIN (National ID number)' },
  { id: 'dob',          label: 'Date of birth' },
  { id: 'phone',        label: 'Phone number' },
  { id: 'biometric',    label: 'Biometric data (ID photo + selfie)' },
  { id: 'beneficiary',  label: 'Beneficiary details' },
];

const PURPOSES = [
  { id: 'admin',      label: 'Pension account administration' },
  { id: 'compliance', label: 'Regulatory compliance' },
];

const RECIPIENTS = [
  { id: 'urbra',    label: 'URBRA' },
  { id: 'fund',     label: 'The pension fund manager' },
  { id: 'kyc',      label: 'KYC verification providers' },
];

export default function ConsentStep({ onActivate }) {
  const signup = useSignup();
  const isAgent = useOnboardAudience() === 'agent';
  const [submitting, setSubmitting] = useState(false);

  function handleToggle(checked) {
    signup.patch({
      consent: checked,
      // Log the moment of consent in UTC ISO, with phone as the identifier.
      // The phone acts as the primary account id until backend issues a UUID.
      consentTimestamp: checked ? new Date().toISOString() : null,
    });
  }

  async function handleActivate() {
    if (!signup.consent || !signup.consentTimestamp) return;
    setSubmitting(true);
    await onActivate();
  }

  return (
    <div className={`${styles.card} ${own.consentCard}`}>
      {/* No "Step N · Consent" eyebrow — the subscriber topbar sub-label and the
          agent metaBar step counter already show the step position; an in-card
          copy just duplicated it. */}
      <h2 className={styles.heading}>{isAgent ? 'Consent & data use' : 'One last thing before payment'}</h2>
      <p className={styles.subtext}>
        {isAgent
          ? 'The subscriber consents to data processing under Uganda’s Data Protection and Privacy Act, 2019.'
          : 'Please read this and give your consent. This is required under Uganda’s Data Protection and Privacy Act, 2019.'}
      </p>

      {/* Three panels are DIRECT children of the card (no wrapper) so the mobile
          DOM + card child-reveal stagger are unchanged. On agent desktop the card
          itself becomes a grid (own.consentCard, container query) and these panels
          flow into a 3-column row while the other children span full width. */}
      <div className={own.panel}>
        <span className={own.panelLabel}>What we collected</span>
        <ul className={own.list}>
          {DATA_COLLECTED.map((d) => (
            <li key={d.id} className={own.listItem}>
              <BulletCheck />
              <span>{d.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={own.panel}>
        <span className={own.panelLabel}>Why we process it</span>
        <ul className={own.list}>
          {PURPOSES.map((p) => (
            <li key={p.id} className={own.listItem}>
              <BulletCheck />
              <span>{p.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={own.panel}>
        <span className={own.panelLabel}>Who may receive it</span>
        <ul className={own.list}>
          {RECIPIENTS.map((r) => (
            <li key={r.id} className={own.listItem}>
              <BulletCheck />
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Full-width footnote: a non-panel child, so it spans 1 / -1 below the
          3-column panel grid in both container layouts (signupcanvas + onboardcanvas). */}
      <p className={own.footnote}>
        We do not sell your data. You can request access, correction, or deletion at any time — contact our data protection officer at <strong>privacy@universalpensions.com</strong>.
      </p>

      {/* The whole box is the clickable label. The native checkbox is visually
          hidden (still focusable) and drives the custom indigo .ck box; consent
          gating + timestamp logging are unchanged. */}
      <label className={own.consentBox} data-checked={signup.consent || undefined}>
        <input
          type="checkbox"
          className={own.checkbox}
          checked={signup.consent}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span className={own.ck} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12l5 5L20 6" />
          </svg>
        </span>
        <div className={own.consentBody}>
          <span className={own.consentText}>
            I consent to Universal Pensions processing my personal data for the purposes above, and sharing it with the recipients listed, under Uganda’s <strong>Data Protection and Privacy Act, 2019</strong>. I have read the{' '}
            <a
              href={LEGAL_TERMS_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={own.policyLink}
              onClick={(e) => e.stopPropagation()}
            >
              Terms of Service
            </a>
            {' '}and{' '}
            <a
              href={LEGAL_PRIVACY_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={own.policyLink}
              onClick={(e) => e.stopPropagation()}
            >
              Privacy Policy
            </a>.
          </span>

          <AnimatePresence>
            {signup.consent && signup.consentTimestamp && (
              <motion.span
                key="ts"
                className={own.timestamp}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
              >
                Consent logged {formatLogged(signup.consentTimestamp)} · ID: <strong>{signup.phone ? `+256 ${signup.phone}` : 'pending'}</strong>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </label>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.submit}
          onClick={handleActivate}
          disabled={!signup.consent || submitting}
          data-loading={submitting || undefined}
        >
          {submitting ? (
            <>
              <span className={own.btnSpinner} aria-hidden="true" />
              Continuing…
            </>
          ) : (
            'I consent — continue'
          )}
        </button>
      </div>
    </div>
  );
}

function BulletCheck() {
  return (
    <span className={own.bullet} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12l5 5L20 6" />
      </svg>
    </span>
  );
}

function formatLogged(iso) {
  try {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm} UTC`;
  } catch {
    return iso;
  }
}
