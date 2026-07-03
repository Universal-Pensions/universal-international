import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatUGXShort, formatNumber } from '../../utils/currency';
import { useAuth } from '../../contexts/AuthContext';
import { useEntity } from '../../hooks/useEntity';
import { useAgentSubscribers, useAgentContributions } from '../../hooks/useAgent';
import { useAgentCommissionDetail } from '../../hooks/useCommission';
import {
  computeAgentHomeSummary,
  deriveMonthAnchors,
  isOnboardedSince,
  pendingContributors,
  isInsured,
  monthRangeIso,
} from './agentHomeSummary';
import styles from './HomeMobile.module.css';

const ChevIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const WalletIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M16 12h.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const ClockIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PeopleIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ShieldIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * HomeMobile — the agent PHONE home (<1024px). Three sparse cards in the approved
 * mockup's framed-metric language: a hero (greeting + boxed "Total contributions
 * collected" + Subscribers/Active strip), a "This month" card (Collected / New
 * members centred strip + a "To be paid to you" commissions row), and a "Your
 * book" list (Yet to contribute · Active · Insured), each drilling into a focused
 * page. All figures reuse the SAME hooks + derivations as the old PulseCard /
 * MonthlyDataCard so the numbers match the desktop and the drill-down lists.
 */
export default function HomeMobile({ agentId }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: agent } = useEntity('agent', agentId);
  const { data: subscribers = [] } = useAgentSubscribers(agentId);
  const { data: detail } = useAgentCommissionDetail(agentId);

  // "This month" window from the book's latest dates (CLAUDE.md §4 — no demo
  // clock import); used to fetch this month's contributions so "Collected" and
  // "Yet to contribute" match the drill-down pages exactly.
  const { onboardStart, contribStart } = useMemo(() => deriveMonthAnchors(subscribers), [subscribers]);
  const range = useMemo(() => monthRangeIso(contribStart), [contribStart]);
  const { data: contributions = [] } = useAgentContributions(
    agentId,
    subscribers.length ? range : {},
  );

  const m = useMemo(() => {
    const { active, total, activePct } = computeAgentHomeSummary(subscribers, null);
    let lifetime = 0;
    for (const s of subscribers) lifetime += s.totalContributions || 0;
    const onboardedThisMonth = subscribers.filter((s) => isOnboardedSince(s, onboardStart)).length;
    const pending = pendingContributors(subscribers, contributions).length;
    const insured = subscribers.filter(isInsured).length;
    let collected = 0;
    for (const c of contributions) collected += c.amount || 0;
    return {
      active,
      total,
      activePct,
      lifetime,
      onboardedThisMonth,
      pending,
      insured,
      dormant: total - active,
      uninsured: total - insured,
      collected,
      payments: contributions.length,
    };
  }, [subscribers, contributions, onboardStart]);

  // Mirror MonthlyDataCard's fallback verbatim so the owed figure here, the
  // desktop "Owed" KPI tile, and the Commissions page never disagree.
  const totalDue = useMemo(() => {
    const due = detail?.dueTransactions || [];
    return detail?.totalDue ?? due.reduce((sum, c) => sum + (c.amount || 0), 0);
  }, [detail]);

  const firstName = (user?.name || agent?.name || 'there').split(' ')[0];
  const hasLifetime = Number.isFinite(m.lifetime) && m.lifetime > 0;

  return (
    <div className={styles.page}>
      {/* HERO — framed metric */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Portfolio overview">
        <p className={styles.greet}>
          <b>Hi {firstName}</b>, here&apos;s your book
        </p>
        <div className={styles.frame}>
          <div className={styles.frameLabel}>Total contributions collected</div>
          <div className={styles.heroVal}>{hasLifetime ? `UGX ${formatUGXShort(m.lifetime)}` : '—'}</div>
        </div>
        <div className={styles.strip} style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div>
            <b>{formatNumber(m.total)}</b>
            <small>Subscriber{m.total === 1 ? '' : 's'}</small>
          </div>
          <div>
            <b className={styles.green}>{m.activePct}%</b>
            <small>Active</small>
          </div>
        </div>
      </section>

      {/* THIS MONTH */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="This month">
        <header className={styles.cardHd}>
          <h3>This month</h3>
        </header>
        <div className={styles.strip} style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 0 }}>
          <button
            type="button"
            className={styles.tapStat}
            onClick={() => navigate('/dashboard/contributions')}
            aria-label="View contributions this month"
          >
            <b className={styles.green}>UGX {formatUGXShort(m.collected)}</b>
            <small>Collected{m.payments ? ` · ${m.payments} payment${m.payments === 1 ? '' : 's'}` : ''}</small>
          </button>
          <button
            type="button"
            className={styles.tapStat}
            onClick={() => navigate('/dashboard/onboarded-this-month')}
            aria-label="View members onboarded this month"
          >
            <b>{formatNumber(m.onboardedThisMonth)}</b>
            <small>New member{m.onboardedThisMonth === 1 ? '' : 's'}</small>
          </button>
        </div>
        <button
          type="button"
          className={styles.payRow}
          onClick={() => navigate('/dashboard/commissions')}
          aria-label="View commissions to be paid to you"
        >
          <span className={styles.payIc}>{WalletIcon}</span>
          <span className={styles.payText}>
            <b>To be paid to you</b>
            <small>Commissions due · next payout</small>
          </span>
          <span className={styles.payEnd}>
            <span className={styles.payAmt}>UGX {formatUGXShort(totalDue)}</span>
            <span className={styles.chev}>{ChevIcon}</span>
          </span>
        </button>
      </section>

      {/* YOUR BOOK */}
      <section className={styles.card} aria-label="Your book">
        <header className={styles.cardHd}>
          <h3>Your book</h3>
          <button type="button" className={styles.seeAll} onClick={() => navigate('/dashboard/subscribers')}>
            See all
          </button>
        </header>
        <button type="button" className={styles.listRow} onClick={() => navigate('/dashboard/yet-to-contribute')}>
          <span className={`${styles.rowIc} ${styles.tintAmber}`}>{ClockIcon}</span>
          <span className={styles.rowMid}>
            <b>Yet to contribute</b>
            <small>No payment this month</small>
          </span>
          <span className={`${styles.rowVal} ${styles.warn}`}>{formatNumber(m.pending)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </button>
        <button type="button" className={styles.listRow} onClick={() => navigate('/dashboard/subscribers?filter=active')}>
          <span className={`${styles.rowIc} ${styles.tintIndigo}`}>{PeopleIcon}</span>
          <span className={styles.rowMid}>
            <b>Active subscribers</b>
            <small>{formatNumber(m.dormant)} dormant · need a nudge</small>
          </span>
          <span className={styles.rowVal}>{formatNumber(m.active)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </button>
        <button type="button" className={styles.listRow} onClick={() => navigate('/dashboard/insured')}>
          <span className={`${styles.rowIc} ${styles.tintTeal}`}>{ShieldIcon}</span>
          <span className={styles.rowMid}>
            <b>Insured members</b>
            <small>{formatNumber(m.uninsured)} without cover</small>
          </span>
          <span className={styles.rowVal}>{formatNumber(m.insured)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </button>
      </section>
    </div>
  );
}
