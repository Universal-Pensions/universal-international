import { formatDate } from '../utils/date';
import logo from '../assets/logo.png';
import styles from './MemberCard.module.css';

const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other' };

/**
 * Universal Pensions membership card — the light/clean card issued to a member
 * on completion. Reusable across the platform (self-signup completion, agent
 * onboarding, subscriber profile). Dates are formatted here so callers can pass
 * raw Date / ISO values; `gender` accepts the raw key or a ready label.
 *
 * @param {Object} props
 * @param {string} props.fullName
 * @param {string} props.memberId       - formatted member id (e.g. "UPU 2026 · 0123 3211")
 * @param {Date|string} props.enrolled  - enrolment date
 * @param {Date|string} props.dob       - date of birth
 * @param {string} props.gender         - 'male' | 'female' | 'other' (or a label)
 * @param {string} [props.tier]         - tier/status badge text
 * @param {string} [props.className]
 */
export default function MemberCard({
  fullName,
  memberId,
  enrolled,
  dob,
  gender,
  tier = 'Tier 1 · Active',
  className = '',
}) {
  return (
    <section
      className={`${styles.card} ${className}`.trim()}
      aria-label="Your Universal Pensions member card"
    >
      <header className={styles.header}>
        <img src={logo} alt="Universal Pensions" width={128} height={26} className={styles.logo} />
        <span className={styles.tier}>{tier}</span>
      </header>

      <div className={styles.body}>
        <h3 className={styles.name}>{fullName || 'New Member'}</h3>
        <p className={styles.memberId} translate="no">{memberId}</p>
      </div>

      <footer className={styles.footer}>
        <div className={styles.col}>
          <span className={styles.label}>Enrolled</span>
          <span className={styles.value}>{enrolled ? formatDate(enrolled) : '—'}</span>
        </div>
        <div className={styles.col}>
          <span className={styles.label}>Date of birth</span>
          <span className={styles.value}>{dob ? formatDate(dob) : '—'}</span>
        </div>
        <div className={styles.col}>
          <span className={styles.label}>Gender</span>
          <span className={styles.value}>{GENDER_LABEL[gender] || gender || '—'}</span>
        </div>
      </footer>
    </section>
  );
}
