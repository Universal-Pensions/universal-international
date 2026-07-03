import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import {
  useEmployer,
  useEmployerMetrics,
  useEmployees,
  useContributionRuns,
  usePendingInvites,
} from '../../hooks/useEmployer';
import { formatUGX, formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { companyFundingLabel } from '../employees/fundingLabel';
import { deriveEmployerMetrics } from '../overview/employerCopilotContext';
import { groupInsuranceProducts } from '../../utils/groupInsurance';
import ErrorCard from '../../components/feedback/ErrorCard';
import s from './employerMobile.module.css';

const Chevron = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * OverviewMobile — the employer phone Home (the lean, user-trimmed mockup home):
 * funding-status hero + 3-stat strip + Needs-attention list + Roster snapshot.
 * Fresh body against the same hooks the desktop Overview uses (the EmployerOverview
 * panel component self-mounts split-mode chrome, so it isn't reusable on mobile).
 */
export default function OverviewMobile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { employerId } = useEmployerScope();

  const { data: employer, isLoading: empLoading, isError: empErr, error: empError, refetch: refetchEmp } = useEmployer(employerId);
  const { data: metrics = {}, isError: mErr, refetch: refetchM } = useEmployerMetrics(employerId);
  const { data: employees = [], isError: eErr, refetch: refetchE } = useEmployees(employerId);
  const { data: runs = [], isError: rErr, refetch: refetchR } = useContributionRuns(employerId);
  const { data: pendingInvites = [] } = usePendingInvites(employerId);

  const derived = deriveEmployerMetrics(metrics, employees);

  const hasError = empErr || mErr || eErr || rErr || (!employer && !empLoading);
  const isCold = empLoading && !employer;

  if (hasError) {
    return (
      <div className={s.page}>
        <ErrorCard
          title="We couldn't load your dashboard"
          message={empError}
          onRetry={() => { refetchEmp(); refetchM(); refetchE(); refetchR(); }}
        />
      </div>
    );
  }
  if (isCold) {
    return <div className={s.loading}><div className={s.spinner} /></div>;
  }

  const cfg = employer?.defaultContributionConfig;
  // Multi-product group insurance (Life / Health / Funeral), employer-funded —
  // sum cover across all held products so a Health/Funeral-only employer doesn't
  // read "UGX 0 per member" from the legacy life-only groupCoverAmount.
  const insProducts = groupInsuranceProducts(cfg);
  const insEnabled = insProducts.length > 0;
  const groupCoverPerMember = insProducts.reduce((sum, p) => sum + p.cover, 0);
  const totalContributions = metrics.totalContributions || 0;
  const oldestRun = runs.length ? runs[runs.length - 1] : null;
  const sinceLabel = oldestRun ? formatDate(oldestRun.runAt, { variant: 'short-month-year' }) : null;
  const latest = runs[0];
  const runDue =
    !latest ||
    new Date(latest.runAt).getMonth() !== new Date().getMonth() ||
    new Date(latest.runAt).getFullYear() !== new Date().getFullYear();
  const pendingKyc = pendingInvites.length;
  const active = derived.active;
  const suspended = metrics.suspended ?? employees.filter((e) => e.status === 'suspended').length;
  const participation = Math.round(derived.participationRate);
  const contactName = employer?.contactName || user?.name || 'there';
  const firstName = contactName.split(' ')[0];

  return (
    <div className={s.page}>
      {/* Hero — funding status */}
      <div className={`${s.card} ${s.grad}`}>
        <div className={s.greet}><b>Welcome back, {firstName}</b> · {employer?.name || 'Your company'}</div>
        <div className={s.frame}>
          <div className={s.frameLabel}>Total contributions to date · employee + employer</div>
          <div className={s.heroVal}>{formatUGX(totalContributions)}</div>
          <div className={s.frameSub}>
            {runs.length > 0
              ? `across ${formatNumber(runs.length)} run${runs.length === 1 ? '' : 's'}${sinceLabel ? ` since ${sinceLabel}` : ''}`
              : 'No contribution runs yet'}
          </div>
        </div>
        <div className={s.statStrip}>
          <button type="button" className={s.tapCell} onClick={() => navigate('/dashboard/employees')}>
            <b>{formatNumber(active)}<span style={{ color: 'var(--color-gray)', fontWeight: 600, fontSize: 12 }}> / {formatNumber(derived.headcount)}</span></b>
            <small>Active staff</small>
          </button>
          <div><b className={s.good}>{participation}%</b><small>Participation</small></div>
          <button type="button" className={s.tapCell} onClick={() => navigate('/dashboard/runs')}>
            <b>{formatNumber(runs.length)}</b><small>Runs</small>
          </button>
        </div>
      </div>

      {/* Needs attention */}
      <div className={s.card}>
        <div className={s.cardHd}><h3>Needs attention</h3></div>

        <button type="button" className={s.lrow} onClick={() => navigate('/dashboard/runs')}>
          <span className={`${s.lIc} ${runDue ? s.tintAmber : s.tintGreen}`}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <span className={s.lMid}><b>Contribution run</b><small>{latest ? `Last run: ${latest.periodLabel}` : 'No runs yet'}</small></span>
          <span className={`${s.pill} ${runDue ? s.pillWarn : s.pillOk}`}><i />{runDue ? 'Due' : 'On track'}</span>
          <span className={s.chev}>{Chevron}</span>
        </button>

        <button type="button" className={s.lrow} onClick={() => navigate('/dashboard/pending-kyc')}>
          <span className={`${s.lIc} ${pendingKyc > 0 ? s.tintAmber : s.tintGreen}`}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
          </span>
          <span className={s.lMid}><b>Pending KYC</b><small>{pendingKyc > 0 ? 'Awaiting sign-up' : 'All onboarded'}</small></span>
          <span className={`${s.lAmt} ${pendingKyc > 0 ? s.warn : ''}`}>{formatNumber(pendingKyc)}</span>
          <span className={s.chev}>{Chevron}</span>
        </button>

        <button type="button" className={s.lrow} onClick={() => navigate('/dashboard/insurance')}>
          <span className={`${s.lIc} ${s.tintTeal}`}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" strokeLinecap="round" /></svg>
          </span>
          <span className={s.lMid}><b>Group insurance</b><small>{insEnabled ? `On · ${formatUGX(groupCoverPerMember, { compact: true })} per member` : 'Not set up'}</small></span>
          <span className={`${s.pill} ${insEnabled ? s.pillOk : s.pillOff}`}><i />{insEnabled ? 'On' : 'Off'}</span>
          <span className={s.chev}>{Chevron}</span>
        </button>
      </div>

      {/* Roster snapshot */}
      <div className={s.card}>
        <div className={s.cardHd}><h3>Roster snapshot</h3><button type="button" className={s.linkBtn} onClick={() => navigate('/dashboard/employees')}>View staff</button></div>
        <div className={s.statStrip} style={{ marginTop: 0 }}>
          <div><b className={s.good}>{formatNumber(active)}</b><small>Active</small></div>
          <div><b className={s.warn}>{formatNumber(suspended)}</b><small>Inactive</small></div>
          <div><b>{formatNumber(pendingKyc)}</b><small>Pending</small></div>
        </div>
        {cfg && (
          <div className={s.callout} style={{ marginTop: 14 }}>
            <span className={s.calloutIc}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" /></svg>
            </span>
            <div><b>Company funding model</b><p>{companyFundingLabel(cfg)}</p></div>
          </div>
        )}
      </div>
    </div>
  );
}
