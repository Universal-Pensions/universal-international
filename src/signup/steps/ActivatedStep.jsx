import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';
import { INSURANCE_PRODUCTS } from '../../constants/savings';
import { resolveScheduleTier } from '../../utils/insuranceSelection';

import { formatMemberId } from '../../utils/memberId';
import { useSignup } from '../SignupContext';
import { useToast } from '../../contexts/ToastContext';
import { openPolicyCertificate } from '../contribution/insurancePolicyCertificate';
import MemberCard from '../../components/MemberCard';
import styles from './Step.module.css';
import own from './ActivatedStep.module.css';

function addYears(date, n) {
  const r = new Date(date);
  r.setFullYear(r.getFullYear() + n);
  return r;
}

export default function ActivatedStep({ onFinish, snapshot }) {
  const ctx = useSignup();
  const { addToast } = useToast();
  const data = snapshot ?? ctx;
  const { fullName, phone, dob, gender, contributionSchedule } = data;

  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const memberId = formatMemberId(phone);
  const enrolmentDate = new Date();
  // First contribution paid at checkout — surfaced in the payment-success banner.
  const firstAmount = Number(contributionSchedule?.amount) || 0;

  // Route B ("save to cover") activates each policy lazily once savings reach
  // the target, so its cover is still *building* at the done step — there is no
  // active certificate to download yet. Route A ("pay now") charges the premium
  // today, so the policy is active and its certificate is ready.
  const fundingMode = contributionSchedule?.insuranceFundingMode ?? 'pay_now';

  // Multi-product: one certificate per selected insurance product. Legacy
  // single-toggle schedules (no insuranceTypes) fall back to life-only.
  const selectedTypes = Array.isArray(contributionSchedule?.insuranceTypes)
    ? contributionSchedule.insuranceTypes
    : (contributionSchedule?.includeInsurance ? ['life'] : []);
  const policies = INSURANCE_PRODUCTS
    .filter((p) => selectedTypes.includes(p.id))
    .map((p) => {
      // Cover is chosen per product on the cover step, so the certificate must
      // print the tier the member actually bought — reading p.cover straight off
      // the catalogue would issue everyone an entry-tier document. Falls back to
      // the entry tier for schedules written before per-product cover existed.
      const tier = resolveScheduleTier(p.id, contributionSchedule) ?? p;
      return {
        id: p.id,
        // "Life insurance" → "Life" for the certificate title.
        productLabel: p.label.replace(/\s*insurance$/i, ''),
        barLabel: p.label,
        cover: tier.cover,
        // Premiums are now charged as a single yearly amount (annual model).
        premiumAnnual: tier.premiumMonthly * 12,
        // Health is a personal cover with no beneficiary payout; life/funeral pay
        // out to beneficiaries.
        showBeneficiaries: p.id !== 'health',
      };
    });

  function handleDownloadPolicy(policy) {
    const ok = openPolicyCertificate({
      holderName: fullName,
      memberId,
      dob,
      cover: policy.cover,
      // Annual premium (charged as one yearly amount), labelled accordingly —
      // no per-period cadence suffix.
      premiumPerPeriod: policy.premiumAnnual,
      premiumLabel: 'Annual premium',
      policyStart: enrolmentDate,
      renewalDate: addYears(enrolmentDate, 1),
      beneficiaries: data.insuranceBeneficiaries ?? [],
      productLabel: policy.productLabel,
      showBeneficiaries: policy.showBeneficiaries,
    });
    if (!ok) {
      // Pop-up blocked — surface it the same way the subscriber dashboard's
      // Policies page does (PoliciesPage.jsx handleCertificate), via the
      // app's own toast, not a blocking window.alert(). ToastProvider wraps
      // the whole app from main.jsx, so it's available here exactly like it
      // is at every other call site in the signup flow (e.g.
      // ContributionRoute.jsx) — there was never a reason this needed a
      // different, blocking mechanism.
      addToast('error', 'Please allow pop-ups for this site and try again to download your certificate.');
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

      {/* Payment confirmation — the first thing to reassure the member their
          money went through, before the card / policies. */}
      <motion.div
        className={own.paidBanner}
        role="status"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6, ease: EASE_OUT_EXPO }}
      >
        <span className={own.paidIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
            <path d="M5 12.5l4 4 10-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className={own.paidText}>
          <span className={own.paidTitle}>Payment successful</span>
          <span className={own.paidSub}>
            {firstAmount > 0
              ? <>Your first contribution of <strong>{formatUGX(firstAmount, { compact: false })}</strong> has been received.</>
              : 'Your first contribution has been received.'}
          </span>
        </span>
      </motion.div>

      <motion.p
        className={`${styles.subtext} textCenter`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.72, ease: EASE_OUT_EXPO }}
      >
        Here’s your Universal Pensions member card. Keep it handy — you’ll need the Member&nbsp;ID when contacting support or topping up through agents.
      </motion.p>

      {/* ── Member card (shared light/clean component) ───────────────────── */}
      <motion.div
        className={own.cardWrap}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.85, ease: EASE_OUT_EXPO }}
      >
        <MemberCard
          fullName={fullName}
          memberId={memberId}
          enrolled={enrolmentDate}
          dob={dob}
          gender={gender}
        />
      </motion.div>

      {/* ── Insurance policies: one compact row per product ──────────────────
          Route A ("pay now") → cover is active, certificate ready to download.
          Route B ("save to cover") → cover is still building, so we relabel the
          row and suppress the (invalid) "Active" certificate download. */}
      {policies.map((policy, idx) => {
        const anim = {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay: 0.1 + idx * 0.06, ease: EASE_OUT_EXPO },
        };
        const shield = (
          <span className={own.policyShield} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
              <path d="M12 4v10M8 11l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        );
        const title = (
          <span className={own.policyTitle}>
            {policy.barLabel} · {formatUGX(policy.cover, { compact: false })} cover
          </span>
        );

        if (fundingMode === 'save_to_cover') {
          return (
            <motion.div key={policy.id} className={own.policyBar} style={{ cursor: 'default' }} {...anim}>
              {shield}
              <span className={own.policyText}>
                {title}
                <span className={own.policySub}>Cover starts when your savings reach the target</span>
              </span>
              <span className={own.policyAction}>Building</span>
            </motion.div>
          );
        }

        return (
          <motion.button
            key={policy.id}
            type="button"
            className={own.policyBar}
            onClick={() => handleDownloadPolicy(policy)}
            {...anim}
          >
            {shield}
            <span className={own.policyText}>
              {title}
              <span className={own.policySub}>Policy certificate ready</span>
            </span>
            <span className={own.policyAction}>Download</span>
          </motion.button>
        );
      })}

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
