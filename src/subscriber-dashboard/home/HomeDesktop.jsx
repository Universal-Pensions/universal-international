import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { deriveInvestmentGrowth, deriveEmployerSplit, periodsPerYear, txDisplayAmount } from '../../utils/finance';
import { activeCoverTotal, activePolicies, buildingCoverTotal, buildingProgress } from '../../utils/policies';
import { useCountUp } from '../../hooks/useCountUp';
import { useContributionBreakdown, useSubscriberTransactions } from '../../hooks/useSubscriber';
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
 * 3-up KPI row (Amount invested / Investment growth / Saved this month), an
 * employer-match block (employer-onboarded members only), a "Your savings &
 * cover" 3-column card, and a recent-activity feed. Every figure derives from the
 * SAME subscriber record + finance helpers the mobile Home reads, so the two
 * viewports never disagree.
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

  // Employer match split (own vs employer). The breakdown supplies only the
  // member's real own:employer RATIO; deriveEmployerSplit re-scales it to the
  // derived principal so own + employer ties out to "invested".
  const { data: breakdown } = useContributionBreakdown(sub.id);
  const { own: ownContrib, employer: employerContrib } = deriveEmployerSplit(sub, breakdown);
  const splitTotal = ownContrib + employerContrib;
  const ownPct = splitTotal > 0 ? Math.round((ownContrib / splitTotal) * 100) : 0;
  const empPct = splitTotal > 0 ? 100 - ownPct : 0;

  // "Saved this month" — the member's monthly-equivalent own contribution, plus
  // (for employer-onboarded members) the employer's proportional monthly top-up
  // derived from the same own:employer ratio. No per-month-saved field exists, so
  // this is a derived demo figure (CLAUDE.md §10a).
  const ownMonthly = hasSchedule
    ? Math.round((scheduleAmt * periodsPerYear(schedule.frequency)) / 12)
    : 0;
  const employerMonthly = isEmployer && ownContrib > 0
    ? Math.round(ownMonthly * (employerContrib / ownContrib))
    : 0;
  const savedThisMonth = ownMonthly + employerMonthly;

  let savedValue;
  let savedExplain;
  if (!hasSchedule) {
    savedValue = '—';
    savedExplain = 'Set up a schedule to start saving.';
  } else if (isEmployer && employerMonthly > 0) {
    savedValue = `+${formatUGX(savedThisMonth, { compact: false })}`;
    savedExplain = `Your ${formatUGX(ownMonthly, { compact: false })} + ${formatUGX(employerMonthly, { compact: false })} from your employer.`;
  } else {
    savedValue = `+${formatUGX(ownMonthly, { compact: false })}`;
    savedExplain = `Your ${formatUGX(ownMonthly, { compact: false })} monthly contribution.`;
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

  const payCaption = hasSchedule
    ? (nextDue ? <>Next payment · <b>due {formatDate(nextDue, { variant: 'day-month' })}</b></> : 'Next payment')
    : 'Start saving';

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
            <div className={styles.heroValue}>{net > 0 ? balanceDisplay : 'UGX 0'}</div>
            <p className={styles.heroUnits}>
              <span className={styles.uChip}>Units</span>
              <strong>{units.toLocaleString('en-UG', { maximumFractionDigits: 2 })}</strong> units
            </p>
          </div>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.payCaption}>{payCaption}</span>
          <div className={styles.heroBtnRow}>
            <button type="button" className={`${styles.heroBtn} ${styles.heroBtnPrimary}`} onClick={handlePay}>
              {glyph.pay(18)}
              {hasSchedule ? `Pay ${formatUGX(scheduleAmt, { compact: false })}` : 'Set a schedule'}
            </button>
            <button type="button" className={`${styles.heroBtn} ${styles.heroBtnSecondary}`} onClick={handleTopUp}>
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
          <div className={styles.kpiExplain}>The money you&rsquo;ve put in so far.</div>
        </div>

        <div className={styles.kpi} style={{ '--ac': 'var(--color-green)', '--tint': '46,139,87' }}>
          <div className={styles.kpiChip}>{glyph.growth(18)}</div>
          <div className={styles.kpiLabel}>Investment growth</div>
          <div className={`${styles.kpiValue} ${styles.kpiValueGrow}`}>
            {net > 0 ? `+${growthPct.toFixed(1)}%` : '—'}
          </div>
          <div className={styles.kpiExplain}>
            {net > 0 ? `≈ ${formatUGX(growth)} more than you saved.` : 'Start saving to see your growth.'}
          </div>
        </div>

        <div className={styles.kpi} style={{ '--ac': 'var(--color-indigo-soft)', '--tint': '94,99,168' }}>
          <div className={styles.kpiChip}>{glyph.month(18)}</div>
          <div className={styles.kpiLabel}>Saved this month</div>
          <div className={styles.kpiValue}>{savedValue}</div>
          <div className={styles.kpiExplain}>{savedExplain}</div>
        </div>
      </motion.div>

      {/* Employer-match block — employer-onboarded members only. */}
      {isEmployer && (
        <motion.div variants={itemVariants} className={styles.emp}>
          <div className={styles.blockHead}>
            <span className={styles.blockTitle}>
              <span className={`${styles.blockIc} ${styles.empIc}`}>{glyph.employer(18)}</span>
              Your employer tops up your pension
            </span>
            <span className={styles.tag}>Employer-sponsored</span>
          </div>
          <div className={styles.empSplit}>
            <div className={`${styles.empTile} ${styles.empTileOwn}`}>
              <span className={styles.empTileK}><span className={styles.sw} aria-hidden="true" />You&rsquo;ve contributed</span>
              <span className={styles.empTileV}>{formatUGX(ownContrib, { compact: false })}</span>
              <span className={styles.empTilePct}>{ownPct}% of your pension</span>
            </div>
            <div className={styles.empPlus} aria-hidden="true">+</div>
            <div className={`${styles.empTile} ${styles.empTileAdded}`}>
              <span className={styles.empTileK}><span className={styles.sw} aria-hidden="true" />Your employer added</span>
              <span className={styles.empTileV}>{formatUGX(employerContrib, { compact: false })}</span>
              <span className={styles.empTilePct}>{empPct}% — on top of your savings</span>
            </div>
          </div>
          <div
            className={styles.empBar}
            role="img"
            aria-label={`You ${ownPct}%, employer ${empPct}%`}
          >
            <span className={styles.segOwn} style={{ width: `${ownPct}%` }} />
            <span className={styles.segEmp} />
          </div>
          <p className={styles.empFoot}>
            Your employer has added <strong>{formatUGX(employerContrib, { compact: false })}</strong> to your
            pension so far — real money on top of what you save yourself.
          </p>
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
            const isEmpTx = tx.type === 'contribution' && tx.source === 'employer';
            const name = isEmpTx ? 'Employer top-up' : meta.label;
            const dot = isEmpTx ? 'var(--color-indigo-soft)' : meta.dot;
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
