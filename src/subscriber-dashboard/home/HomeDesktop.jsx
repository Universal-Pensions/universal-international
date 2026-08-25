import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { deriveInvestmentGrowth, deriveEmployerSplit, periodsPerYear, txDisplayAmount } from '../../utils/finance';
import {
  deriveContributionLegs,
  formatLegRateForMember,
  isLegZero,
  memberFundingSummary,
} from '../../utils/contributionModel';
import { activeCoverTotal, activePolicies, buildingCoverTotal, buildingProgress } from '../../utils/policies';
import { useCountUp } from '../../hooks/useCountUp';
import { useContributionBreakdown, useMyEmployerFunding, useSubscriberTransactions } from '../../hooks/useSubscriber';
import styles from './HomeDesktop.module.css';

const stagger = {
  initial: {},
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const item = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT_EXPO } },
};

// v5 icon set — stroke-only line glyphs, aria-hidden (the visible label carries
// the meaning). Authored as size-parameterised factories so the same glyph can
// render at the hero (26), tile chip (18), card chip (20) sizes.
const glyph = {
  wallet: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 13h2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
  pay: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M2.5 10h19" stroke="currentColor" strokeWidth="1.75" />
      <path d="M6 15h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
  topup: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
  employer: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20V7l7-3 7 3v13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 20h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 11h.01M11 11h.01M14 11h.01M8 14h.01M11 14h.01M14 14h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  retire: (s) => (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 17V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 8c0-2 1.5-3.5 3.5-3.5C13.5 6.5 12 8 10 8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 10c0-2-1.5-3.5-3.5-3.5C6.5 8.5 8 10 10 10z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  emergency: (s) => (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3a6 6 0 016 6H4a6 6 0 016-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 9v6a2 2 0 01-4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  shield: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  growth: (s) => (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 14l4-4 3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 6h-4M16 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  month: (s) => (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 12l1.3 1.3L13 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  activity: (s) => (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 10h3l2-5 4 10 2-5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrow: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h13M12 6l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// Per-transaction-type label + timeline-dot colour for the inline activity feed.
// NOTE: `contribution` is the SELF-PAID label only. Rows posted by an employer's
// payroll run are relabelled at render time (see the feed) — the employer's own leg
// as "Employer top-up", and the leg deducted from the member's pay as "From your
// pay". Never let a run-posted row fall through to this generic label.
const TX_META = {
  contribution: { label: 'Contribution', dot: 'var(--color-green)' },
  withdrawal: { label: 'Withdrawal', dot: 'var(--color-teal)' },
  // Self-paid cover — one ANNUAL premium (or save-to-cover), not monthly.
  premium: { label: 'Insurance premium', dot: 'var(--color-amber)' },
  // Employer-funded group premium (monthly) — distinct type + label so it doesn't
  // fall back to the contribution meta (green "+"); it's an outflow, not money
  // received, and it's the employer paying, not the member.
  insurance_premium: { label: 'Employer cover premium', dot: 'var(--color-amber)' },
  // Save-to-cover sweep (0072) — savings swept to pay the annual premium; add a
  // real entry so it never falls back to the green "Contribution" meta.
  premium_sweep: { label: 'Premium from savings', dot: 'var(--color-amber)' },
  claim: { label: 'Claim payout', dot: 'var(--color-indigo)' },
};

/**
 * HomeDesktop — the >=1024px subscriber Home tab-root (v5 redesign).
 *
 * Rebuilt to the approved v5 mockup: a content-top header (eyebrow + greeting +
 * employer chip), a units-only balance HERO with horizontal Pay / Top-up CTAs, a
 * 3-up KPI row (Amount invested / Investment growth / Saved this month), a
 * "How your pension is funded" block (only when the member's employer actually
 * funds a leg), a "Your savings & cover" 3-column card, and a recent-activity
 * feed. Every figure derives from the SAME subscriber record + finance helpers the
 * mobile Home reads, so the two viewports never disagree.
 *
 * Employer funding comes from `useMyEmployerFunding()` — the narrow
 * SECURITY DEFINER RPC (migration 0092) that hands a member the two legs their
 * employer configured plus their own compensation. Before it existed this page
 * reverse-engineered every employer figure out of the transactions feed and, for
 * the monthly figure, out of the member's OWN leg — which encoded the deleted
 * employer-match basis. Both legs are now read from the config and multiplied by
 * compensation through `deriveContributionLegs`, the one canonical run math.
 *
 * The Ask-AI assistant is no longer an embedded card here — on desktop it lives
 * in the on-demand right-side panel (SubscriberCopilotPanel) opened from the
 * "Ask AI" control in SubscriberDesktopShell. The mobile Home keeps its inline
 * CoPilotWidget.
 *
 * The caller (HomePage) passes the resolved subscriber, so this component never
 * re-fetches or re-handles loading / error states.
 */
export default function HomeDesktop({ subscriber }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const itemVariants = reduceMotion ? undefined : item;

  const sub = subscriber || {};
  const net = sub.netBalance || 0;
  const units = sub.unitsHeld || 0;
  const isEmployer = Boolean(sub.employerId);
  const firstName = (sub.name || '').trim().split(' ')[0];

  // Balance count-up — mirrors the mobile PulseCard selectors exactly. useCountUp
  // returns 0 under reduced motion (run=false), so we snap to the resolved
  // balance in that case.
  const counted = useCountUp(net, 1100, !reduceMotion);
  const balanceDisplay = formatUGX(reduceMotion ? net : counted, { compact: false });
  // A20-011 (desktop half — mirrors the fix already applied to HomeMobile).
  // The count-up re-renders ~60x/sec while animating and the visible figure
  // carries no aria-live, so a screen-reader user is never told the balance
  // changed after a contribution. Announce the SETTLED figure — keyed off `net`,
  // not the animating `counted` — once via a polite live region, and hide the
  // animating digits from the a11y tree so they are not read frame by frame.
  const settledBalanceLabel = formatUGX(net > 0 ? net : 0, { compact: false });

  // Invested principal + growth (demo-derived, deterministic per id; shared with
  // the mobile PulseCard so the two never disagree).
  const { invested, growth, growthPct } = deriveInvestmentGrowth(sub);

  // Retirement / Emergency are the two pots that sum to net balance. Round
  // retirement directly, then derive emergency as its COMPLEMENT so the two
  // shares always sum to exactly 100 (rounding each independently can yield 101).
  const retirement = sub.retirementBalance || 0;
  const emergency = sub.emergencyBalance || 0;
  const retPct = net > 0 ? Math.round((retirement / net) * 100) : 0;
  const emerPct = net > 0 ? 100 - retPct : 0;

  // Insurance cover — total ACTIVE cover + premium across ALL products
  // (life + health + funeral), not the legacy life-only row, so desktop agrees
  // with mobile Home / Analytics / the Withdrawals hub.
  const cover = activeCoverTotal(sub);
  const hasCover = cover > 0;
  const premium = activePolicies(sub).reduce((s, p) => s + (Number(p.premiumMonthly) || 0), 0);
  // Save-to-cover (0072): cover still being saved for. When there is no active
  // cover but a building one, the tile shows the target cover + savings progress
  // toward the annual premium instead of "Not active".
  const building = buildingProgress(sub);
  const buildingCover = buildingCoverTotal(sub);
  const hasBuilding = !hasCover && building.isBuilding;
  const displayCover = hasCover ? cover : buildingCover;
  const showCover = hasCover || hasBuilding;
  const coverContext = hasCover
    // Self-paid cover is ONE annual premium — show the annual figure (monthly ×
    // 12) as "/yr", never "/mo". Employer-funded policies carry a 0 member
    // premium, so they contribute nothing to this sum.
    ? (premium > 0 ? `Active · ${formatUGX(premium * 12, { compact: false })}/yr premium` : 'Active cover')
    : (hasBuilding
        ? (building.target > 0 ? `Building · ${building.pct}% of premium saved` : 'Building your cover')
        : 'Not active');

  // Contribution schedule → hero "Next payment" + Pay button.
  const schedule = sub.contributionSchedule;
  const scheduleAmt = schedule?.amount || 0;
  const hasSchedule = scheduleAmt > 0;
  const nextDue = schedule?.nextDueDate;

  // ── How the pension is funded ──────────────────────────────────────────────
  // The employer's two legs, straight from their saved configuration. Each leg is
  // either a % of this member's monthly compensation or a flat UGX amount, and the
  // two are INDEPENDENT — the employer leg is never a multiple of the member's.
  //   payLeg   — deducted from the member's pay by the employer and remitted for
  //              them (posted source='own', which is why it needs its own wording).
  //   topUpLeg — the employer's own money on top (posted source='employer').
  // `funding` is null for a member with no employer, so a self-signup member never
  // renders any of this.
  const { data: funding } = useMyEmployerFunding();
  const employerName = funding?.employerName || '';
  const who = employerName || 'your employer';
  const { employeeLeg: payLeg, employerLeg: topUpLeg } = funding
    ? deriveContributionLegs(funding, funding.compensation)
    : { employeeLeg: 0, employerLeg: 0 };
  // Zero-ness is judged on the configured RATE, not on the shilling result, so a
  // member whose compensation hasn't been recorded yet still gets the right state.
  const payZero = !funding || isLegZero(funding.employeePct);
  const topUpZero = !funding || isLegZero(funding.employerPct);
  // 0/0 is a legal employer configuration (it funds no pension) and so is "no
  // employer at all" — in both cases there is nothing true to say, so the whole
  // funding surface is hidden rather than showing "UGX 0 on top of your savings".
  const showFunding = Boolean(funding) && !(payZero && topUpZero);
  const fundedMonthly = payLeg + topUpLeg;
  const fundingSummary = funding ? memberFundingSummary(funding, employerName) : null;
  // The rate under each tile's shilling figure.
  const payRate = `${formatLegRateForMember(funding?.employeePct)} — every month`;
  const topUpRate = `${formatLegRateForMember(funding?.employerPct)} — every month`;

  // HISTORY, not configuration: how much of the pension built so far arrived from
  // the member's pay vs from the employer. The breakdown supplies only the real
  // own:employer RATIO; deriveEmployerSplit re-scales it onto the derived principal
  // so own + employer ties out to "invested". It reports `unknown` when the feed
  // has no contribution rows — there is no default ratio to fall back on, so the
  // history bar simply doesn't render.
  const { data: breakdown } = useContributionBreakdown(sub.id);
  const split = deriveEmployerSplit(sub, breakdown);
  const { own: ownContrib, employer: employerContrib } = split;
  const splitTotal = ownContrib + employerContrib;
  const ownPct = splitTotal > 0 ? Math.round((ownContrib / splitTotal) * 100) : 0;
  const empPct = splitTotal > 0 ? 100 - ownPct : 0;
  // Only meaningful when BOTH sides of the history are non-zero; a one-sided bar
  // says nothing the tiles don't already say.
  const showSplit = !split.unknown && ownContrib > 0 && employerContrib > 0;

  // "Saved this month" — the member's own monthly-equivalent schedule PLUS whatever
  // their employer's configured legs add each payroll cycle. No per-month-saved
  // field exists, so this is a derived demo figure (CLAUDE.md §10a).
  //
  // The employer figure used to be `ownMonthly × (employerContrib / ownContrib)` —
  // the deleted employer-match basis (the employer leg as a multiple of the
  // member's leg) hardcoded into the subscriber dashboard. Both legs now come from
  // the employer's configuration, so an employer-funded member with no schedule of
  // their own shows real money instead of "Set up a schedule to start saving".
  const ownMonthly = hasSchedule
    ? Math.round((scheduleAmt * periodsPerYear(schedule.frequency)) / 12)
    : 0;
  const savedThisMonth = ownMonthly + fundedMonthly;

  let savedValue;
  let savedExplain;
  if (savedThisMonth <= 0) {
    savedValue = '—';
    savedExplain = 'Set up a schedule to start saving.';
  } else {
    savedValue = `+${formatUGX(savedThisMonth, { compact: false })}`;
    if (!showFunding) {
      savedExplain = `Your ${formatUGX(ownMonthly, { compact: false })} monthly contribution.`;
    } else {
      // One clause per real source of money, so the member can see where each
      // shilling came from instead of one lumped "employer" figure.
      const parts = [];
      if (ownMonthly > 0) parts.push(`${formatUGX(ownMonthly, { compact: false })} you save yourself`);
      if (payLeg > 0) parts.push(`${formatUGX(payLeg, { compact: false })} from your pay`);
      if (topUpLeg > 0) parts.push(`${formatUGX(topUpLeg, { compact: false })} from ${who}`);
      savedExplain = `${parts.join(' + ')}.`;
    }
  }

  // "Amount invested" is the WHOLE derived principal — it includes the employer's
  // leg and the leg deducted from the member's pay, neither of which the member
  // chose to put in. "The money you've put in so far" is only true for a member
  // with no employer funding.
  let investedExplain = 'The money you’ve put in so far.';
  if (showFunding) {
    if (payZero) investedExplain = `Everything ${who} has paid into your pension so far.`;
    else if (topUpZero) investedExplain = 'Everything sent to your pension from your pay so far.';
    else investedExplain = `Everything paid in so far — from your pay and from ${who}.`;
  }

  // Recent activity (real transactions; up to 4 rows).
  const { data: txns = [] } = useSubscriberTransactions(sub.id);
  const recentTx = txns.slice(0, 4);

  // Pay / Top-up navigation — mirrors TopUpWidget's targets so the desktop hero
  // and the mobile contribution row drive the same flows.
  function handlePay() {
    if (!hasSchedule) {
      navigate('/dashboard/save/schedule');
      return;
    }
    navigate('/dashboard/save', { state: { prefillAmount: scheduleAmt, scheduled: true } });
  }
  function handleTopUp() {
    navigate('/dashboard/save');
  }

  // An employer-funded member with no schedule of their own has NOTHING to set up:
  // both legs are configured by their employer and posted by the payroll run. They
  // used to be told "Start saving" / "Set a schedule" while money landed in their
  // pension every cycle. Show them the funded figure and offer only the optional
  // extra top-up.
  const fundedOnly = showFunding && !hasSchedule && fundedMonthly > 0;

  let payCaption;
  if (hasSchedule) {
    payCaption = nextDue
      ? <>Next payment · <b>due {formatDate(nextDue, { variant: 'day-month' })}</b></>
      : 'Next payment';
  } else if (fundedOnly) {
    payCaption = <>Your pension gets <b>{formatUGX(fundedMonthly, { compact: false })}</b> each month</>;
  } else {
    payCaption = 'Start saving';
  }

  return (
    <motion.div
      className={styles.page}
      variants={reduceMotion ? undefined : stagger}
      initial={reduceMotion ? false : 'initial'}
      animate={reduceMotion ? false : 'animate'}
    >
      {/* Content-top: eyebrow + greeting + employer chip (the Ask-AI pill lives
          in the shell's top-right, not here). */}
      <motion.header variants={itemVariants} className={styles.contentTop}>
        <div>
          <p className={styles.eyebrow}>Your savings</p>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{firstName ? `Hi, ${firstName}` : 'Home'}</h1>
            {isEmployer && (
              <span className={styles.srcChip}>
                {glyph.employer(13)}
                Employer-sponsored
              </span>
            )}
          </div>
        </div>
      </motion.header>

      {/* Hero — units-only balance + horizontal Pay / Top-up. */}
      <motion.div variants={itemVariants} className={styles.heroCard}>
        <div className={styles.heroMain}>
          <div className={styles.heroChip}>{glyph.wallet(26)}</div>
          <div>
            <p className={styles.heroEyebrow}>Total balance</p>
            <div className={styles.heroValue} aria-hidden="true">{net > 0 ? balanceDisplay : 'UGX 0'}</div>
            <span className="sr-only" aria-live="polite">Total balance {settledBalanceLabel}</span>
            <p className={styles.heroUnits}>
              <span className={styles.uChip}>Units</span>
              <strong>{units.toLocaleString('en-UG', { maximumFractionDigits: 2 })}</strong> units
            </p>
          </div>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.payCaption}>{payCaption}</span>
          <div className={styles.heroBtnRow}>
            {!fundedOnly && (
              <button type="button" className={`${styles.heroBtn} ${styles.heroBtnPrimary}`} onClick={handlePay}>
                {glyph.pay(18)}
                {hasSchedule ? `Pay ${formatUGX(scheduleAmt, { compact: false })}` : 'Set a schedule'}
              </button>
            )}
            <button
              type="button"
              className={`${styles.heroBtn} ${fundedOnly ? styles.heroBtnPrimary : styles.heroBtnSecondary}`}
              onClick={handleTopUp}
            >
              {glyph.topup(18)}
              Top up extra
            </button>
          </div>
        </div>
      </motion.div>

      {/* KPI performance row. */}
      <motion.div variants={itemVariants} className={styles.kpis}>
        <div className={styles.kpi} style={{ '--ac': 'var(--color-indigo)', '--tint': '41,40,103' }}>
          <div className={styles.kpiChip}>{glyph.growth(18)}</div>
          <div className={styles.kpiLabel}>Amount invested</div>
          <div className={styles.kpiValue}>{net > 0 ? formatUGX(invested) : '—'}</div>
          <div className={styles.kpiExplain}>{investedExplain}</div>
        </div>

        <div className={styles.kpi} style={{ '--ac': 'var(--color-green)', '--tint': '46,139,87' }}>
          <div className={styles.kpiChip}>{glyph.growth(18)}</div>
          <div className={styles.kpiLabel}>Investment growth</div>
          <div
            className={`${styles.kpiValue} ${growth < 0 ? styles.kpiValueLoss : styles.kpiValueGrow}`}
          >
            {/* Growth can be negative — the unit price falls as well as rises —
                so the sign is derived, never hardcoded to "+". */}
            {net > 0
              ? `${growth < 0 ? '−' : '+'}${Math.abs(growthPct).toFixed(1)}%`
              : '—'}
          </div>
          <div className={styles.kpiExplain}>
            {/* "more than you saved" is wrong for a member whose pension is partly
                (or wholly) employer-funded — they didn't save all of the principal. */}
            {net <= 0
              ? 'Start saving to see your growth.'
              : growth > 0
                ? `≈ ${formatUGX(growth)} more than ${showFunding ? 'was paid in' : 'you saved'}.`
                : growth < 0
                  // Plain language: say what happened and that it can recover,
                  // without jargon. Losses are real and must not be hidden.
                  ? `≈ ${formatUGX(Math.abs(growth))} less than ${showFunding ? 'was paid in' : 'you saved'}. Unit prices go up and down.`
                  : `Same as ${showFunding ? 'was paid in' : 'you saved'} so far.`}
          </div>
        </div>

        <div className={styles.kpi} style={{ '--ac': 'var(--color-indigo-soft)', '--tint': '94,99,168' }}>
          <div className={styles.kpiChip}>{glyph.month(18)}</div>
          <div className={styles.kpiLabel}>Saved this month</div>
          <div className={styles.kpiValue}>{savedValue}</div>
          <div className={styles.kpiExplain}>{savedExplain}</div>
        </div>
      </motion.div>

      {/* How your pension is funded — only when the employer actually funds a leg.
          Gating this on `sub.employerId` alone (as it used to) rendered "Your
          employer tops up your pension" above "UGX 0 · 0%" for any employer whose
          configuration funds nothing, which 0/0 now legally permits. One tile per
          non-zero leg: the leg taken from the member's pay, and the employer's own
          money on top. */}
      {showFunding && (
        <motion.div variants={itemVariants} className={styles.emp}>
          <div className={styles.blockHead}>
            <span className={styles.blockTitle}>
              <span className={`${styles.blockIc} ${styles.empIc}`}>{glyph.employer(18)}</span>
              How your pension is funded
            </span>
            <span className={styles.tag}>Employer-sponsored</span>
          </div>
          <div className={styles.empSplit}>
            {!payZero && (
              <div className={`${styles.empTile} ${styles.empTilePay}`}>
                <span className={styles.empTileK}><span className={styles.sw} aria-hidden="true" />From your pay</span>
                <span className={styles.empTileV}>{formatUGX(payLeg, { compact: false })}</span>
                <span className={styles.empTilePct}>{payRate}</span>
              </div>
            )}
            {!payZero && !topUpZero && <div className={styles.empPlus} aria-hidden="true">+</div>}
            {!topUpZero && (
              <div className={`${styles.empTile} ${styles.empTileTopUp}`}>
                <span className={styles.empTileK}><span className={styles.sw} aria-hidden="true" />From {who}</span>
                <span className={styles.empTileV}>{formatUGX(topUpLeg, { compact: false })}</span>
                <span className={styles.empTilePct}>{topUpRate}</span>
              </div>
            )}
          </div>
          {/* History bar — how the pension built so far actually split. Hidden when
              the transactions feed has nothing to measure (deriveEmployerSplit
              reports `unknown`) or when one side is empty. */}
          {showSplit && (
            <div
              className={styles.empBar}
              role="img"
              aria-label={`${ownPct}% from your pay, ${empPct}% from ${who}`}
            >
              <span className={styles.segPay} style={{ width: `${ownPct}%` }} />
              <span className={styles.segTopUp} />
            </div>
          )}
          {fundingSummary && <p className={styles.empFoot}>{fundingSummary}.</p>}
          {showSplit && (
            <p className={styles.empFoot}>
              So far <strong>{formatUGX(ownContrib, { compact: false })}</strong> has come from your pay
              and <strong className={styles.figTopUp}>{formatUGX(employerContrib, { compact: false })}</strong> from {who}.
            </p>
          )}
        </motion.div>
      )}

      {/* Your savings & cover — Retirement / Emergency / Insurance. */}
      <motion.div variants={itemVariants} className={styles.swc}>
        <div className={styles.blockHead}>
          <span className={styles.blockTitle}>
            <span className={`${styles.blockIc} ${styles.swcIc}`}>{glyph.wallet(20)}</span>
            Your savings &amp; cover
          </span>
          {hasCover && (
            <span className={styles.pill}><span className={styles.dotg} aria-hidden="true" />All active</span>
          )}
        </div>
        <div className={styles.swcGrid}>
          <div className={styles.swcItem} style={{ '--ac': 'var(--color-indigo)', '--tint': '41,40,103' }}>
            <div className={styles.swcChip}>{glyph.retire(20)}</div>
            <span className={styles.swcK}>Retirement fund</span>
            <span className={styles.swcV}>{formatUGX(retirement, { compact: false })}</span>
            <span className={styles.swcSub}>{retPct}% · growing for your future</span>
          </div>
          <div className={styles.swcItem} style={{ '--ac': 'var(--color-indigo-soft)', '--tint': '94,99,168' }}>
            <div className={styles.swcChip}>{glyph.emergency(20)}</div>
            <span className={styles.swcK}>Emergency fund</span>
            <span className={styles.swcV}>{formatUGX(emergency, { compact: false })}</span>
            <span className={styles.swcSub}>{emerPct}% · withdraw when you need it</span>
          </div>
          <button
            type="button"
            className={`${styles.swcItem} ${styles.swcItemBtn}`}
            style={{ '--ac': 'var(--color-teal)', '--tint': '47,143,157' }}
            onClick={() => navigate(showCover ? '/dashboard/policies' : '/dashboard/settings/insurance')}
            aria-label={hasCover
              ? 'View your insurance cover and download your certificate'
              : hasBuilding
                ? 'View your insurance cover you are saving toward'
                : 'Add insurance cover'}
          >
            <div className={styles.swcChip}>{glyph.shield(20)}</div>
            <span className={styles.swcK}>Insurance cover</span>
            <span className={styles.swcV}>{showCover ? formatUGX(displayCover, { compact: false }) : 'Not set'}</span>
            <span className={styles.swcSub}>{coverContext}</span>
            {hasBuilding && building.target > 0 && (
              <span className={styles.swcProgress} aria-hidden="true">
                <span className={styles.swcProgressFill} style={{ width: `${building.pct}%` }} />
              </span>
            )}
            <span className={styles.swcCta}>
              {hasCover ? 'View & download' : hasBuilding ? 'View progress' : 'Add cover'}{glyph.arrow(13)}
            </span>
          </button>
        </div>
      </motion.div>

      {/* Recent activity. */}
      <motion.div variants={itemVariants} className={styles.card}>
        <div className={styles.blockHead}>
          <span className={styles.blockTitle}>
            <span className={styles.blockIc} style={{ background: 'color-mix(in srgb, var(--color-indigo) 8%, transparent)', color: 'var(--color-indigo)' }}>
              {glyph.activity(18)}
            </span>
            Recent activity
          </span>
          <button type="button" className={styles.blockLink} onClick={() => navigate('/dashboard/activity')}>
            View all{glyph.arrow(14)}
          </button>
        </div>
        {recentTx.length === 0 ? (
          <p className={styles.empty}>No activity yet.</p>
        ) : (
          recentTx.map((tx) => {
            const meta = TX_META[tx.type] || TX_META.contribution;
            // THREE kinds of contribution row, and they are not the same money:
            //   source='employer'      → the employer's own leg. "Employer top-up".
            //   posted by a payroll run → the member's leg, which the employer
            //     DEDUCTED FROM THEIR PAY and remitted. It carries source='own'
            //     because it lands in the member's own pot, but the member never
            //     chose it, so labelling it "Contribution" — identical to a
            //     self-paid Save-flow top-up — claims a payment they never made.
            //   anything else          → genuinely self-paid. "Contribution".
            const isContribTx = tx.type === 'contribution';
            const isEmpTx = isContribTx && tx.source === 'employer';
            const isFromPayTx = isContribTx && !isEmpTx && Boolean(tx.contributionRunId);
            const name = isEmpTx ? 'Employer top-up' : isFromPayTx ? 'From your pay' : meta.label;
            const dot = isEmpTx
              ? 'var(--color-indigo-soft)'
              : isFromPayTx ? 'var(--color-indigo)' : meta.dot;
            const signed = txDisplayAmount(tx);
            const negative = signed < 0;
            return (
              <div key={tx.id} className={styles.row}>
                <span className={styles.tdot} style={{ '--tc': dot }} aria-hidden="true" />
                <span>
                  <span className={styles.rowName}>{name}</span>
                  <span className={styles.rowSub}>
                    {formatDate(tx.date, { variant: 'day-month' })}{tx.method ? ` · ${tx.method}` : ''}
                  </span>
                </span>
                <span className={`${styles.rowAmt} ${negative ? styles.rowAmtNeg : styles.rowAmtPos}`}>
                  {negative ? '−' : '+'}{formatUGX(Math.abs(signed), { compact: false })}
                </span>
              </div>
            );
          })
        )}
      </motion.div>
    </motion.div>
  );
}
