// ContributionsDesktop — the desktop body of /dashboard/contributions.
//
// The drill-down behind the Overview's two leg tiles ("Total employee
// contribution" / "Total employer contribution"): every payment the company's
// runs have posted, one row per payment, filtered to one leg by `?leg=`.
//
// The contract that makes it a drill-down rather than just another table: the
// footer total for a leg EQUALS the tile the employer clicked. Both sides count
// the same thing — run-posted pension contributions, insurance premiums
// excluded — see services/employer.js getEmployerContributions.
//
// Rows continue the chain: a payment leads to the member it was paid for, and
// the period column leads back to the run that posted it.

import { useNavigate } from 'react-router-dom';
import { formatUGX, formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import { useContributionHistory, LEGS } from '../contributions/useContributionHistory';
import { PageHead, MetricRow, Tile, StatusBadge } from './ui';
import { coinsIcon, walletIcon, buildingIcon, backIcon } from './icons';
import ui from './ui.module.css';
import styles from './ContributionsDesktop.module.css';

const TITLE = {
  all: 'All contributions',
  employee: 'Staff contributions',
  employer: 'Your contributions',
};

export default function ContributionsDesktop() {
  const navigate = useNavigate();
  const h = useContributionHistory();
  const blurb = LEGS.find((l) => l.key === h.leg)?.blurb ?? '';

  // Says what the money on screen covers, in one sentence: how much, to how many
  // people, over how many periods.
  const subtitle = h.isCold || h.isError
    ? blurb
    : h.visible.length === 0
      ? blurb
      : `${blurb} ${formatUGX(h.totals.amount[h.leg], { compact: false })} across `
        + `${formatNumber(h.coverage.members)} ${h.coverage.members === 1 ? 'person' : 'people'}`
        + `${h.coverage.periods > 0 ? ` and ${formatNumber(h.coverage.periods)} ${h.coverage.periods === 1 ? 'period' : 'periods'}` : ''}.`;

  return (
    <div className={ui.stack}>
      <PageHead eyebrow="Contribution history" title={TITLE[h.leg]} sub={subtitle} />

      <div className={styles.backRow}>
        <button type="button" className={styles.backBtn} onClick={() => navigate('/dashboard')}>
          {backIcon(16)} Back to overview
        </button>
      </div>

      {/* The same two figures the Overview tiles show, side by side — this page
          is where an employer comes to check one against the other. */}
      <MetricRow cols={3}>
        <Tile
          accent="indigo"
          icon={coinsIcon(18)}
          label="All contributions"
          value={formatUGX(h.totals.amount.all)}
          sub={`${formatNumber(h.totals.count.all)} ${h.totals.count.all === 1 ? 'payment' : 'payments'} in all`}
        />
        <Tile
          accent="indigoSoft"
          icon={walletIcon(18)}
          label="Paid by staff"
          value={formatUGX(h.totals.amount.employee)}
          sub="From their own pay"
        />
        <Tile
          accent="green"
          icon={buildingIcon(18)}
          label="Paid by you"
          value={formatUGX(h.totals.amount.employer)}
          sub="Company money on top"
        />
      </MetricRow>

      {/* Leg tabs — the URL filter, as three buttons. Each carries its own total
          so the split is readable without switching. */}
      <div className={styles.tablist} role="tablist" aria-label="Filter contributions by who paid">
        {LEGS.map((l) => (
          <button
            key={l.key}
            type="button"
            role="tab"
            aria-selected={h.leg === l.key}
            className={styles.tab}
            data-active={h.leg === l.key || undefined}
            onClick={() => h.setLeg(l.key)}
          >
            {l.label}
            <span className={styles.tabCount}>{formatUGX(h.totals.amount[l.key])}</span>
          </button>
        ))}
      </div>

      <div className={ui.tableCard}>
        {h.isCold ? (
          <div className={styles.pad}>
            <SkeletonRow count={6} variant="compact" label="Loading contribution history" />
          </div>
        ) : h.isError ? (
          <div className={styles.pad}>
            <ErrorCard title="We couldn't load your contributions" message={h.error} onRetry={h.refetch} />
          </div>
        ) : h.visible.length === 0 ? (
          <div className={styles.pad}>
            <EmptyState
              kind="no-data"
              title={h.hasAny ? 'Nothing under this filter' : 'No contributions yet'}
              body={
                h.hasAny
                  ? 'No payments of this kind yet. Try another tab to see the rest.'
                  : 'Once you run a contribution for your staff, every payment shows up here.'
              }
              cta={{ label: 'Go to contribution runs', onClick: () => navigate('/dashboard/runs') }}
            />
          </div>
        ) : (
          <>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Period</th>
                  <th>Date</th>
                  <th>Paid by</th>
                  <th>How it was paid</th>
                  <th className={ui.num}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {h.visible.map((row) => (
                  <tr
                    key={row.id}
                    className={ui.rowInteractive}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${row.memberName}'s details`}
                    onClick={() => navigate(`/dashboard/employees/${row.subscriberId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/dashboard/employees/${row.subscriberId}`);
                      }
                    }}
                  >
                    <td><span className={ui.tName}>{row.memberName}</span></td>
                    <td>{row.periodLabel ?? <span className={styles.muted}>—</span>}</td>
                    <td>{formatDate(row.date)}</td>
                    <td>
                      {row.leg === 'employer' ? (
                        <StatusBadge tone="done" dot={false}>You</StatusBadge>
                      ) : (
                        <StatusBadge tone="open" dot={false}>Staff</StatusBadge>
                      )}
                    </td>
                    <td><span className={styles.muted}>{row.method || '—'}</span></td>
                    <td className={ui.num}>
                      <strong>{formatUGX(row.amount, { compact: false })}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={ui.tableFoot}>
              <span className={styles.foot}>
                {formatNumber(h.visible.length)} {h.visible.length === 1 ? 'payment' : 'payments'}
                {' · '}
                <strong>{formatUGX(h.totals.amount[h.leg], { compact: false })}</strong> in all
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
