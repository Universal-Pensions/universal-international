import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatUGXShort, formatUGX } from '../../utils/currency';
import { activeCoverTotal } from '../../utils/policies';
import { useCurrentSubscriber } from '../../hooks/useSubscriber';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import ErrorCard from '../../components/feedback/ErrorCard';
import { RETIREMENT_AGE } from '../../constants/savings';
import styles from './WithdrawalsHubPage.module.css';
import flow from './desktopFlow.module.css';

const OPTIONS = [
  {
    id: 'savings',
    to: '/dashboard/withdraw/savings',
    title: 'Withdraw savings',
    description: 'Pull funds from your emergency or retirement bucket.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M12 3v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <path d="M7 8l5-5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'claim',
    to: '/dashboard/withdraw/claim',
    title: 'File an insurance claim',
    description: 'Medical, accident, hospitalisation or critical illness.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
        <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

export default function WithdrawalsHubPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();

  // WITHDRAWABLE, not the displayed pot totals. Since 0146 emergencyBalance and
  // retirementBalance include money received but not yet invested, and money
  // already sold and on its way out — neither of which can be taken out again —
  // and neither subtracts a withdrawal already requested and waiting for its
  // dealing date. This screen puts a number under the words "Available to
  // withdraw", so it is the same safety-critical distinction WithdrawPage makes
  // and it was missed here. The fallback covers pre-0146 shapes, where the two
  // are equal by definition.
  const emergency = sub?.withdrawableEmergency ?? sub?.emergencyBalance ?? 0;
  const retirement = sub?.withdrawableRetirement ?? sub?.retirementBalance ?? 0;
  const available = emergency + retirement;
  // Total ACTIVE cover across all products (life + health + funeral), so the
  // claim hint matches the Policies page / Home rather than the life-only row.
  const cover = activeCoverTotal(sub);

  // Desktop summary reframes "available" honestly: retirement is locked until
  // age 60, so only the emergency pot (plus retirement once eligible) is actually
  // withdrawable now. The mobile hero keeps the shipped `available` figure.
  const retirementEligible = typeof sub?.age === 'number' && sub.age >= RETIREMENT_AGE;
  const availableNow = emergency + (retirementEligible ? retirement : 0);
  const lockedRet = retirementEligible ? 0 : retirement;
  const lockedPct = available > 0 ? Math.round((lockedRet / available) * 100) : 0;

  const HINTS = {
    savings: `${formatUGX(emergency)} ready · ${formatUGX(retirement)} retirement`,
    claim: cover > 0
      ? `${formatUGX(cover)} cover active`
      : 'No active cover',
  };

  // E3 — a subscriber-query failure would otherwise render a "0 available / No
  // active cover" hub that looks like real (empty) data. Show the retry card.
  if (isError) {
    return (
      <div className={styles.page}>
        <ErrorCard title="We couldn't load your withdrawals" message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {isDesktop ? (
        /* Desktop (>=1024px): genuine 2-column flow — the two actions as rich
           chooser cards beside a sticky "available now" breakdown (emergency
           withdrawable vs retirement locked). Mobile keeps the shipped hero +
           card grid EXACTLY as-is in the fragment below. */
        <div className={flow.canvas}>
          <header className={flow.head}>
            <div className={flow.headText}>
              <p className={flow.eyebrow}>Available to withdraw</p>
              <h1 className={flow.title}>Withdrawals</h1>
              <p className={flow.subtitle}>
                UGX {formatUGXShort(availableNow)} available · take money out of your emergency savings, or file an insurance claim.
              </p>
            </div>
          </header>

          <div className={flow.split}>
            {/* LEFT — choose an action */}
            <div className={flow.col}>
              {OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={flow.hubCard}
                  onClick={() => navigate(opt.to)}
                >
                  <span className={`${flow.hubIc} ${opt.id === 'savings' ? flow.hubIcSave : flow.hubIcClaim}`}>
                    {opt.icon}
                  </span>
                  <span className={flow.hubMain}>
                    <span className={flow.hubTitle}>{opt.title}</span>
                    <span className={flow.hubDesc}>{opt.description}</span>
                    <span className={flow.hubHint}>{HINTS[opt.id]}</span>
                  </span>
                  <span className={flow.hubArrow}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
                      <path d="M5 12h13M12 6l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>

            {/* RIGHT — sticky available breakdown */}
            <aside className={flow.summaryCol}>
              <div className={flow.card}>
                <p className={flow.sumEyebrow}>Available now</p>
                <div className={flow.sumBig}>{formatUGX(availableNow, { compact: false })}</div>
                <div
                  className={flow.availBar}
                  role="img"
                  aria-label={`${lockedPct}% locked in retirement`}
                >
                  <span className={flow.availLocked} style={{ flexBasis: `${lockedPct}%` }} />
                  <span className={flow.availOpen} />
                </div>
                <ul className={`${flow.sumList} ${flow.sumListTight}`}>
                  <li className={flow.sumRow}>
                    <span className={flow.sumRowLabel}>
                      <span className={flow.sumDot} style={{ background: 'var(--color-green)' }} />
                      Emergency · available
                    </span>
                    <span className={`${flow.sumVal} ${flow.sumValPos}`}>{formatUGX(emergency, { compact: false })}</span>
                  </li>
                  <li className={flow.sumRow}>
                    <span className={flow.sumRowLabel}>
                      <span className={flow.sumDot} style={{ background: 'var(--color-indigo)' }} />
                      Retirement · {retirementEligible ? 'available' : `locked to ${RETIREMENT_AGE}`}
                    </span>
                    <span className={flow.sumVal}>{formatUGX(retirement, { compact: false })}</span>
                  </li>
                  {cover > 0 && (
                    <li className={flow.sumRow}>
                      <span>Insurance cover</span>
                      <span className={flow.sumVal}>{formatUGX(cover, { compact: false })}</span>
                    </li>
                  )}
                </ul>
                <p className={flow.note}>
                  {retirementEligible
                    ? 'Both your funds are available to withdraw.'
                    : `Only your emergency fund can be withdrawn before retirement. Retirement savings unlock at age ${RETIREMENT_AGE}.`}
                </p>
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <>
      <div className={styles.body}>
        {/* Flat summary card replaces the hero dome — the app bar provides the
            "Withdrawals" title + back. Eyebrow + big indigo "available now"
            figure + a sub-line noting retirement stays locked until 60. */}
        <section className={styles.summary} aria-labelledby="wd-summary-label">
          <span className={styles.summaryEyebrow} id="wd-summary-label">
            Available to withdraw now
          </span>
          <div className={styles.summaryBig}>{formatUGX(availableNow, { compact: false })}</div>
          <p className={styles.summarySub}>
            {retirementEligible
              ? 'Both your funds are available to withdraw.'
              : `Emergency pot · retirement locked to ${RETIREMENT_AGE}`}
          </p>
        </section>

        <div className={styles.grid}>
          {OPTIONS.map((opt, i) => (
            <motion.button
              key={opt.id}
              type="button"
              className={styles.card}
              onClick={() => navigate(opt.to)}
              initial={reducedMotion ? false : { opacity: 0, y: 12 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 + i * 0.05, ease: EASE_OUT_EXPO }}
              whileHover={reducedMotion ? undefined : { y: -2 }}
            >
              <span className={styles.cardIcon}>{opt.icon}</span>
              <div className={styles.cardText}>
                <span className={styles.cardTitle}>{opt.title}</span>
                <span className={styles.cardDesc}>{opt.description}</span>
                <span className={styles.cardHint}>{HINTS[opt.id]}</span>
              </div>
              <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" className={styles.cardArrow}>
                <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </motion.button>
          ))}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
