import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { periodsPerYear } from '../../utils/finance';
import { INSURANCE_PRODUCTS } from '../../constants/savings';

import { formatMemberId } from '../../utils/memberId';
import { useSignup } from '../SignupContext';
import { openPolicyCertificate } from '../contribution/insurancePolicyCertificate';
import logoWhite from '../../assets/logo-white.png';
import styles from './Step.module.css';
import own from './ActivatedStep.module.css';

const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other' };

function addYears(date, n) {
  const r = new Date(date);
  r.setFullYear(r.getFullYear() + n);
  return r;
}

export default function ActivatedStep({ onFinish, snapshot }) {
  const ctx = useSignup();
  const data = snapshot ?? ctx;
  const { fullName, phone, dob, gender, contributionSchedule } = data;

  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const memberId = formatMemberId(phone);
  const enrolmentDate = new Date();

  // Multi-product: one certificate per selected insurance product. Legacy
  // single-toggle schedules (no insuranceTypes) fall back to life-only.
  const freqPerYear = periodsPerYear(contributionSchedule?.frequency);
  const selectedTypes = Array.isArray(contributionSchedule?.insuranceTypes)
    ? contributionSchedule.insuranceTypes
    : (contributionSchedule?.includeInsurance ? ['life'] : []);
  const policies = INSURANCE_PRODUCTS
    .filter((p) => selectedTypes.includes(p.id))
    .map((p) => ({
      id: p.id,
      // "Life insurance" → "Life" for the certificate title.
      productLabel: p.label.replace(/\s*insurance$/i, ''),
      barLabel: p.label,
      cover: p.cover,
      premiumPerPeriod: Math.round((p.premiumMonthly * 12) / freqPerYear),
      // Health is a personal cover with no beneficiary payout; life/funeral pay
      // out to beneficiaries.
      showBeneficiaries: p.id !== 'health',
    }));

  function handleDownloadPolicy(policy) {
    const ok = openPolicyCertificate({
      holderName: fullName,
      memberId,
      dob,
      cover: policy.cover,
      premiumPerPeriod: policy.premiumPerPeriod,
      frequency: contributionSchedule.frequency,
      policyStart: enrolmentDate,
      renewalDate: addYears(enrolmentDate, 1),
      beneficiaries: data.insuranceBeneficiaries ?? [],
      productLabel: policy.productLabel,
      showBeneficiaries: policy.showBeneficiaries,
    });
    if (!ok) {
      // Pop-up blocked. Demo-level fallback — no toast context here.
      window.alert('Please allow pop-ups for this site and try again to download your certificate.');
    }
  }

  return (
    <div className={styles.card}>
      <motion.div
        className={own.successIcon}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
      >
        <svg viewBox="0 0 48 48" width="32" height="32" fill="none" aria-hidden="true">
          <motion.circle
            cx="24" cy="24" r="22"
            stroke="currentColor" strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
            fill="none"
          />
          <motion.path
            d="M15 24.5l6.5 6.5L33 17.5"
            stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.6 }}
          />
        </svg>
      </motion.div>

      <motion.h2
        className={`${styles.heading} textCenter`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5, ease: EASE_OUT_EXPO }}
      >
        You’re all set, {firstName}
      </motion.h2>
      <motion.p
        className={`${styles.subtext} textCenter`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.65, ease: EASE_OUT_EXPO }}
      >
        Here’s your Universal Pensions member card. Keep it handy — you’ll need the Member&nbsp;ID when contacting support or topping up through agents.
      </motion.p>

      {/* ── Member card ────────────────────────────────────────────────── */}
      <motion.section
        className={own.memberCard}
        aria-label="Your Universal Pensions member card"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.85, ease: EASE_OUT_EXPO }}
      >
        {/* Ambient mesh — one soft indigo glow + one teal glow for depth */}
        <span className={own.cardMesh} aria-hidden="true" />
        <span className={own.cardGrain} aria-hidden="true" />

        <header className={own.cardHeader}>
          <img src={logoWhite} alt="Universal Pensions" width={132} height={28} className={own.cardLogo} />
          <span className={own.cardTierBadge}>Tier 1 · Active</span>
        </header>

        <div className={own.cardBody}>
          <h3 className={own.cardName}>{fullName || 'New Member'}</h3>
          <p className={own.cardMemberId} translate="no">{memberId}</p>
        </div>

        <footer className={own.cardFooter}>
          <div className={own.cardFooterCol}>
            <span className={own.cardFootLabel}>Enrolled</span>
            <span className={own.cardFootValue}>{formatDate(enrolmentDate)}</span>
          </div>
          <div className={own.cardFooterCol}>
            <span className={own.cardFootLabel}>Date of birth</span>
            <span className={own.cardFootValue}>{formatDate(dob)}</span>
          </div>
          <div className={own.cardFooterCol}>
            <span className={own.cardFootLabel}>Gender</span>
            <span className={own.cardFootValue}>{GENDER_LABEL[gender] || '—'}</span>
          </div>
        </footer>
      </motion.section>

      {/* ── Insurance policies: one compact download row per product ─────── */}
      {policies.map((policy, idx) => (
        <motion.button
          key={policy.id}
          type="button"
          className={own.policyBar}
          onClick={() => handleDownloadPolicy(policy)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 + idx * 0.06, ease: EASE_OUT_EXPO }}
        >
          <span className={own.policyShield} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
              <path d="M12 4v10M8 11l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span className={own.policyText}>
            <span className={own.policyTitle}>
              {policy.barLabel} · {formatUGX(policy.cover, { compact: false })} cover
            </span>
            <span className={own.policySub}>Policy certificate ready</span>
          </span>
          <span className={own.policyAction}>Download</span>
        </motion.button>
      ))}

      <motion.div
        className={styles.actions}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 1.2 }}
      >
        <button type="button" className={styles.submit} onClick={onFinish}>
          Go to my dashboard
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </motion.div>
    </div>
  );
}
