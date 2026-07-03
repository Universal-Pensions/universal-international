import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useSignup } from '../SignupContext';
import styles from './Step.module.css';
import own from './PendingReviewStep.module.css';

export default function PendingReviewStep({ onExit }) {
  const { phone } = useSignup();
  const maskedPhone = phone
    ? `+256 ${phone.slice(0, 1)}XX XXX ${phone.slice(6)}`
    : null;

  return (
    <div className={styles.card}>
      <motion.div
        className={own.icon}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
      >
        <svg viewBox="0 0 72 72" width="30" height="30" fill="none" aria-hidden="true">
          <circle cx="36" cy="36" r="34" stroke="currentColor" strokeWidth="3"/>
          <path d="M36 20v18l12 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </motion.div>

      <h2 className={`${styles.heading} textCenter`}>Your account is under review</h2>
      <p className={`${styles.subtext} textCenter`}>
        Thank you for completing the signup. Your application needs a quick manual review before your account can be activated. We’ll be in touch shortly — no action is required from you right now.
      </p>

      <div className={own.meta}>
        {maskedPhone && (
          <div className={own.metaRow}>
            <span className={own.metaLabel}>We’ll contact you at</span>
            <span className={own.metaValue}>{maskedPhone}</span>
          </div>
        )}
        <div className={own.metaRow}>
          <span className={own.metaLabel}>Typical turnaround</span>
          <span className={own.metaValue}>Within 3 business days</span>
        </div>
      </div>

      <div className={own.supportBox}>
        <span className={own.supportLabel}>Need to speak to someone?</span>
        <div className={own.supportRow}>
          <a className={own.supportLink} href="tel:+256700123456">
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M14.5 11.3v2a1.3 1.3 0 01-1.4 1.3A13.2 13.2 0 011.4 2.9 1.3 1.3 0 012.7 1.5h2a1.3 1.3 0 011.3 1.2c.1.6.2 1.2.5 1.8a1.3 1.3 0 01-.3 1.4L5.2 7c1.1 2 2.7 3.6 4.7 4.7l1-1a1.3 1.3 0 011.4-.3c.6.2 1.2.4 1.8.5a1.3 1.3 0 011.2 1.3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            +256 700 123 456
          </a>
          <a className={own.supportLink} href="mailto:support@universalpensions.com">
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M14 4.5l-6 4.5-6-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            support@universalpensions.com
          </a>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.submit} onClick={onExit}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to home
        </button>
      </div>
    </div>
  );
}
