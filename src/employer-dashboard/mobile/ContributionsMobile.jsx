// ContributionsMobile — the phone body of /dashboard/contributions.
//
// Same data and same leg filter as ContributionsDesktop (both run off
// contributions/useContributionHistory, so the totals can't drift), laid out as
// a list: the two leg totals up top, the All/Staff/You segment, then one tappable
// row per payment leading to the member it was paid for.

import { useNavigate } from 'react-router-dom';
import { formatUGX, formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import { useContributionHistory, LEGS } from '../contributions/useContributionHistory';
import s from './employerMobile.module.css';

const Chevron = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export default function ContributionsMobile() {
  const navigate = useNavigate();
  const h = useContributionHistory();
  const blurb = LEGS.find((l) => l.key === h.leg)?.blurb ?? '';

  return (
    <div className={s.page}>
      <p className={s.intro}>{blurb}</p>

      {/* Both leg totals, always — the split is the point of the page. */}
      <div className={s.kpi2}>
        <div className={s.kpiC}>
          <div className={s.kpiLbl}>Paid by staff</div>
          <div className={s.kpiV}>{formatUGX(h.totals.amount.employee)}</div>
        </div>
        <div className={s.kpiC}>
          <div className={s.kpiLbl}>Paid by you</div>
          <div className={s.kpiV}>{formatUGX(h.totals.amount.employer)}</div>
        </div>
      </div>

      <div className={s.seg} role="tablist" aria-label="Filter contributions by who paid">
        {LEGS.map((l) => (
          <button
            key={l.key}
            type="button"
            role="tab"
            aria-selected={h.leg === l.key}
            className={s.segBtn}
            data-active={h.leg === l.key || undefined}
            onClick={() => h.setLeg(l.key)}
          >
            {l.label}
          </button>
        ))}
      </div>

      {h.isCold ? (
        <SkeletonRow count={5} variant="compact" label="Loading contribution history" />
      ) : h.isError ? (
        <ErrorCard title="We couldn't load your contributions" message={h.error} onRetry={h.refetch} />
      ) : h.visible.length === 0 ? (
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
      ) : (
        <div className={s.card}>
          <div className={s.cardHd}>
            <h3>
              {formatNumber(h.visible.length)} {h.visible.length === 1 ? 'payment' : 'payments'}
              {' · '}
              {formatUGX(h.totals.amount[h.leg])}
            </h3>
          </div>
          {h.visible.map((row) => (
            <button
              key={row.id}
              type="button"
              className={s.lrow}
              onClick={() => navigate(`/dashboard/employees/${row.subscriberId}`)}
            >
              <span className={`${s.lIc} ${row.leg === 'employer' ? s.tintGreen : s.tintSoft}`}>
                {row.leg === 'employer' ? (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21V7l8-4 8 4v14" /><path d="M9 21v-6h6v6" /></svg>
                ) : (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M5 21v-1a7 7 0 0114 0v1" /></svg>
                )}
              </span>
              <span className={s.lMid}>
                <b>{row.memberName}</b>
                <small>
                  {row.periodLabel ? `${row.periodLabel} · ` : ''}{formatDate(row.date)}
                  {' · '}{row.leg === 'employer' ? 'You paid' : 'Staff paid'}
                </small>
              </span>
              <span className={s.lAmt}>{formatUGX(row.amount)}</span>
              <span className={s.chev}>{Chevron}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
