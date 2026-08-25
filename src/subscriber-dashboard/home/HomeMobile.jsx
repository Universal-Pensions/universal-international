import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { deriveInvestmentGrowth } from '../../utils/finance';
import {
  deriveContributionLegs,
  formatLegRateForMember,
  isLegZero,
  memberFundingSummary,
} from '../../utils/contributionModel';
import { activeCoverTotal, activeCoverProductsLabel, buildingCoverTotal, buildingProgress } from '../../utils/policies';
import { useMyEmployerFunding } from '../../hooks/useSubscriber';
import { useCountUp } from '../../hooks/useCountUp';
import styles from './HomeMobile.module.css';

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } };
const item = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT_EXPO } },
};

const CalendarIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2.5" /><path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const WalletIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h.5" strokeLinecap="round" />
  </svg>
);
const BuildingIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" /><path d="M15 10h4a1 1 0 0 1 1 1v10" /><path d="M8 8h.5M11 8h.5M8 12h.5M11 12h.5M8 16h3" strokeLinecap="round" />
  </svg>
);
const RetireIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);
const EmergencyIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
  </svg>
);
const ShieldIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" strokeLinecap="round" />
  </svg>
);
const Chevron = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * HomeMobile — the redesigned subscriber PHONE home (<1024px). Adopts the desktop
 * dashboard's design language (flat white→cloud cards, indigo-text balance,
 * lavender hairlines) rather than the old indigo HeroCapsule dome. Every figure
 * comes from the same hooks + helpers HomeDesktop uses — including
 * `useMyEmployerFunding()` for the funding card — so the two viewports can never
 * tell a member a different story about who pays for their pension. Desktop
 * renders HomeDesktop (gated upstream in HomePage), so this never mounts >=1024px.
 */
export default function HomeMobile({ subscriber: sub }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  const balance = sub?.netBalance || 0;
  const counted = useCountUp(balance, 1100, !reduce);
  const amountLabel = Math.round(reduce ? balance : counted).toLocaleString('en-UG');
  // A20-011: the count-up re-renders ~60x/sec while animating, and the visible
  // <p> carries no aria-live, so a screen-reader user is never told the
  // balance changed after a contribution. Announce the SETTLED figure (keyed
  // off `balance`, not the animating `counted`) once via a polite live
  // region, and hide the animating digits from the a11y tree so they aren't
  // read frame-by-frame.
  const settledLabel = Math.round(balance).toLocaleString('en-UG');
  const { invested, growth, growthPct } = deriveInvestmentGrowth(sub);
  const units = sub?.unitsHeld || 0;

  const firstName = (sub?.name || '').trim().split(' ')[0];
  const schedule = sub?.contributionSchedule;
  const hasSchedule = Boolean(schedule?.amount);

  // ── How the pension is funded ──────────────────────────────────────────────
  // Same source and same four states as HomeDesktop: the employer's TWO
  // INDEPENDENT legs read from their saved configuration (migration 0092 RPC) and
  // turned into shillings by the one canonical run math. This card used to be
  // gated on `sub.employerId` alone and to show feed-derived totals labelled "You
  // contribute" / "Employer adds", which invented an employer figure for employers
  // funding nothing and credited the member with a leg deducted from their pay.
  //   payLeg   — taken from the member's pay by the employer and remitted for them.
  //   topUpLeg — the employer's own money on top.
  const { data: funding } = useMyEmployerFunding();
  const employerName = funding?.employerName || '';
  const who = employerName || 'your employer';
  const { employeeLeg: payLeg, employerLeg: topUpLeg } = funding
    ? deriveContributionLegs(funding, funding.compensation)
    : { employeeLeg: 0, employerLeg: 0 };
  // Judged on the configured RATE, not the shilling result, so a member whose
  // compensation isn't recorded yet still lands in the right state.
  const payZero = !funding || isLegZero(funding.employeePct);
  const topUpZero = !funding || isLegZero(funding.employerPct);
  // Nothing funded (0/0 is legal) or no employer at all → hide the card entirely
  // rather than print "UGX 0 · On top of your savings".
  const showFunding = Boolean(funding) && !(payZero && topUpZero);
  const fundedMonthly = payLeg + topUpLeg;
  const fundingSummary = funding ? memberFundingSummary(funding, employerName) : null;
  // The rate under each cell's shilling figure.
  const payRate = `${formatLegRateForMember(funding?.employeePct)} · every month`;
  const topUpRate = `${formatLegRateForMember(funding?.employerPct)} · every month`;
  // An employer-funded member with no schedule of their own has nothing to set up —
  // their employer's legs post every payroll cycle. Offer the optional extra
  // top-up instead of "Set up a schedule".
  const fundedOnly = showFunding && !hasSchedule && fundedMonthly > 0;

  const retirement = sub?.retirementBalance || 0;
  const emergency = sub?.emergencyBalance || 0;
  const activeCover = activeCoverTotal(sub);
  const coverProducts = activeCoverProductsLabel(sub);
  // Save-to-cover (0072): show the cover being saved toward + premium progress
  // when there's no active cover yet but a building one.
  const building = buildingProgress(sub);
  const buildingCover = buildingCoverTotal(sub);
  const hasBuilding = activeCover === 0 && building.isBuilding;
  const showCover = activeCover > 0 || hasBuilding;

  const itemV = reduce ? undefined : item;

  return (
    <motion.div
      className={styles.home}
      variants={reduce ? undefined : stagger}
      initial={reduce ? false : 'initial'}
      animate={reduce ? false : 'animate'}
    >
      {/* Balance hero */}
      <motion.section variants={itemV} className={`${styles.card} ${styles.grad}`} aria-label="Your balance">
        <p className={styles.greet}>
          {firstName ? <><b>Hi {firstName}</b>, here&apos;s your total balance</> : "Here's your total balance"}
        </p>
        <p className={styles.heroVal} aria-hidden="true">UGX {amountLabel}</p>
        <span className="sr-only" aria-live="polite">Total balance UGX {settledLabel}</span>
        <div className={styles.statStrip}>
          <div>
            <b>{formatUGX(invested)}</b>
            <small>Invested</small>
          </div>
          <div>
            <b className={growth < 0 ? styles.statLoss : styles.statGrow}>
              {growth >= 0 ? '↑' : '↓'} {Math.abs(growthPct).toFixed(1)}%
            </b>
            <small>Growth</small>
          </div>
          <div>
            <b>{units.toLocaleString('en-UG', { maximumFractionDigits: 0 })}</b>
            <small>Units</small>
          </div>
        </div>
      </motion.section>

      {/* Next payment — or, for a member funded entirely by their employer, the
          optional extra top-up (they have no schedule to set up). */}
      <motion.button
        variants={itemV}
        type="button"
        className={styles.paycard}
        onClick={() => {
          if (hasSchedule) {
            navigate('/dashboard/save', { state: { prefillAmount: schedule.amount, scheduled: true } });
            return;
          }
          navigate(fundedOnly ? '/dashboard/save' : '/dashboard/save/schedule');
        }}
      >
        {/* Wallet, not calendar, for the funded-only member — there is no due date
            to keep; the card is a voluntary extra. */}
        <span className={styles.payIc}>{fundedOnly ? WalletIcon : CalendarIcon}</span>
        <span className={styles.payText}>
          {hasSchedule ? (
            <>
              <b>Next payment · {formatUGX(schedule.amount, { compact: false })}</b>
              <small>{schedule.nextDueDate ? `Due ${formatDate(schedule.nextDueDate, { variant: 'day-month' })}` : 'Tap to pay'}</small>
            </>
          ) : fundedOnly ? (
            <>
              <b>Top up extra</b>
              <small>{formatUGX(fundedMonthly, { compact: false })} already goes in each month</small>
            </>
          ) : (
            <>
              <b>Set up a schedule</b>
              <small>Save automatically each month</small>
            </>
          )}
        </span>
        <span className={styles.payPill}>{hasSchedule ? 'Pay' : fundedOnly ? 'Top up' : 'Set up'}</span>
      </motion.button>

      {/* How your pension is funded — one cell per non-zero leg, plus the plain
          summary sentence. Hidden when nothing is funded (see showFunding). */}
      {showFunding && (
        <motion.section variants={itemV} className={`${styles.card} ${styles.grad}`} aria-labelledby="funding-title">
          <div className={styles.cardHd}>
            <h3 id="funding-title">How your pension is funded</h3>
          </div>
          <div className={`${styles.fundGrid} ${payZero || topUpZero ? styles.fundGridSolo : ''}`}>
            {!payZero && (
              <div className={styles.fundCell}>
                <span className={`${styles.fundIc} ${styles.tintIndigo}`}>{WalletIcon}</span>
                <span className={styles.fundK}>From your pay</span>
                <span className={styles.fundV} style={{ color: 'var(--color-indigo)' }}>{formatUGX(payLeg, { compact: false })}</span>
                <span className={styles.fundP}>{payRate}</span>
              </div>
            )}
            {!topUpZero && (
              <div className={styles.fundCell}>
                <span className={`${styles.fundIc} ${styles.tintGreen}`}>{BuildingIcon}</span>
                <span className={styles.fundK}>From {who}</span>
                <span className={styles.fundV} style={{ color: 'var(--color-green-ink, #1f6e44)' }}>{formatUGX(topUpLeg, { compact: false })}</span>
                <span className={styles.fundP}>{topUpRate}</span>
              </div>
            )}
          </div>
          {fundingSummary && <p className={styles.fundNote}>{fundingSummary}.</p>}
        </motion.section>
      )}

      {/* Savings & cover */}
      <motion.section variants={itemV} className={styles.card} aria-labelledby="cover-title">
        <div className={styles.cardHd}>
          <h3 id="cover-title">Savings &amp; cover</h3>
          {activeCover > 0 && <span className={styles.pillOk}><i />All active</span>}
        </div>
        <button type="button" className={styles.lrow} onClick={() => navigate('/dashboard/reports')}>
          <span className={`${styles.lIc} ${styles.tintIndigo}`}>{RetireIcon}</span>
          <span className={styles.lMid}><b>Retirement</b><small>Locked to age 60</small></span>
          <span className={styles.lAmt}>{formatUGX(retirement)}</span>
          <span className={styles.chev}>{Chevron}</span>
        </button>
        <button type="button" className={styles.lrow} onClick={() => navigate('/dashboard/withdraw')}>
          <span className={`${styles.lIc} ${styles.tintSoft}`}>{EmergencyIcon}</span>
          <span className={styles.lMid}><b>Emergency</b><small>Available anytime</small></span>
          <span className={styles.lAmt}>{formatUGX(emergency)}</span>
          <span className={styles.chev}>{Chevron}</span>
        </button>
        <button
          type="button"
          className={styles.lrow}
          onClick={() => navigate(showCover ? '/dashboard/policies' : '/dashboard/settings/insurance')}
        >
          <span className={`${styles.lIc} ${styles.tintTeal}`}>{ShieldIcon}</span>
          <span className={styles.lMid}>
            <b>Insurance cover</b>
            <small>
              {activeCover > 0
                ? coverProducts
                : hasBuilding
                  ? (building.target > 0 ? `Building · ${building.pct}% of premium saved` : 'Building your cover')
                  : 'Add cover from UGX 24,000/yr'}
            </small>
          </span>
          <span className={styles.lAmt}>{showCover ? formatUGX(activeCover > 0 ? activeCover : buildingCover) : '—'}</span>
          <span className={styles.chev}>{Chevron}</span>
        </button>
      </motion.section>
    </motion.div>
  );
}
