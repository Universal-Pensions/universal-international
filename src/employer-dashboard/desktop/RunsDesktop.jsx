// RunsDesktop — the desktop Contribution Runs page. Replays the SAME
// history↔detail↔wizard flow as the mobile EmployerSlidePanel
// (runs/ContributionRuns.jsx), but IN-PAGE (no panel): a local view/activeRunId
// state machine swaps the page body between the history table, a single run's
// detail, and the new-run wizard. The detail + wizard views themselves are the
// shared runViews components — so the two surfaces stay byte-identical.
//
// Figures come from the real hooks (useContributionRuns + useEmployerMetrics);
// the mockup's hardcoded numbers are illustrative only.

import { useState } from 'react';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useToast } from '../../contexts/ToastContext';
import { useContributionRuns, useEmployerMetrics } from '../../hooks/useEmployer';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import { PageHead, MetricRow, Tile, Card, SectionHead, StatusBadge, Btn } from './ui';
import { coinsIcon, checkIcon, pendingIcon, runsIcon, plusIcon, backIcon } from './icons';
import { RunDetailView, NewRunWizard } from '../runs/runViews';
import ui from './ui.module.css';
import styles from './RunsDesktop.module.css';

export default function RunsDesktop() {
  const { employerId } = useEmployerScope();
  const { addToast } = useToast();

  const [view, setView] = useState('history'); // 'history' | 'detail' | 'wizard'
  const [activeRunId, setActiveRunId] = useState(null);

  const { data: runs = [], isLoading, isError, error, refetch } = useContributionRuns(employerId);
  const { data: metrics = {} } = useEmployerMetrics(employerId);

  const isCold = isLoading && runs.length === 0;

  // KPI figures — real hooks only. "Funded to date" is PENSION (employee +
  // employer); insurance premiums are a separate leg and are excluded here (the
  // RPC's metrics.totalContributions counts type='contribution' only, so the
  // fallback must sum the two pension legs, NOT grandTotal which includes insurance).
  const fundedToDate = metrics.totalContributions
    || runs.reduce((s, r) => s + ((r.employeeTotal || 0) + (r.employerTotal || 0)), 0);
  // Insurance premiums are a separate run leg, excluded from "Funded to date"
  // (pension) but INCLUDED in each row's Total column — track the running total
  // so the footer can reconcile the two figures on screen.
  const insuranceToDate = runs.reduce((s, r) => s + (r.insuranceTotal || 0), 0);
  const completed = runs.filter((r) => r.status === 'completed').length;

  // "Next run" cadence — due now once the latest run isn't in the current month.
  const latest = runs[0];
  const now = new Date();
  const runDue = !latest
    || new Date(latest.runAt).getMonth() !== now.getMonth()
    || new Date(latest.runAt).getFullYear() !== now.getFullYear();

  function openDetail(runId) {
    setActiveRunId(runId);
    setView('detail');
  }
  function backToHistory() {
    setView('history');
    setActiveRunId(null);
  }

  return (
    <div className={ui.stack}>
      <PageHead
        eyebrow="Funding"
        title="Contribution Runs"
        sub="Fund your staff's pensions each period — the employee and employer legs in one run."
      />

      {view === 'history' && (
        <>
          {/* Action row */}
          <div className={styles.actionRow}>
            <Btn variant="primary" onClick={() => setView('wizard')}>
              {plusIcon(16)} New contribution run
            </Btn>
          </div>

          {/* KPI row */}
          <MetricRow cols={3}>
            <Tile
              accent="indigo"
              icon={coinsIcon(18)}
              label="Funded to date"
              value={formatUGX(fundedToDate)}
              sub="Employee + employer legs combined"
            />
            <Tile
              accent="green"
              icon={checkIcon(18)}
              label="Runs completed"
              value={completed}
              sub={completed > 0 ? 'Every run paid in full' : 'No runs yet'}
            />
            <Tile
              accent="amber"
              icon={pendingIcon(18)}
              label="Next run"
              value={runDue ? 'Due now' : 'Scheduled'}
              sub="Monthly cadence"
            />
          </MetricRow>

          {/* How a run works */}
          <Card>
            <SectionHead icon={runsIcon(18)} title="How a run works" />
            <p className={styles.howText}>
              Each run posts up to two payments per active member — the employee leg and your
              employer top-up — computed server-side from the company funding model. Inactive
              staff are skipped automatically.
            </p>
          </Card>

          {/* Run history */}
          <div className={ui.tableCard}>
            <div style={{ padding: 'var(--space-5) var(--space-5) 0' }}>
              <SectionHead icon={coinsIcon(18)} title="Run history" tag="Newest first" />
            </div>
            {isCold ? (
              <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
                <SkeletonRow count={5} variant="compact" label="Loading contribution runs" />
              </div>
            ) : isError ? (
              <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
                <ErrorCard title="We couldn't load run history" message={error} onRetry={refetch} />
              </div>
            ) : runs.length === 0 ? (
              <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
                <EmptyState
                  kind="no-data"
                  title="No contribution runs yet"
                  body="Start your first run to fund your members for the current period."
                  cta={{ label: 'New contribution run', onClick: () => setView('wizard') }}
                />
              </div>
            ) : (
              <>
                <table className={ui.table}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Date</th>
                      <th className={ui.num}>Employee leg</th>
                      <th className={ui.num}>Employer leg</th>
                      <th className={ui.num}>Insurance leg</th>
                      <th className={ui.num}>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        key={run.id}
                        className={ui.rowInteractive}
                        onClick={() => openDetail(run.id)}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open ${run.periodLabel || 'run'} details`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openDetail(run.id);
                          }
                        }}
                      >
                        <td><span className={ui.tName}>{run.periodLabel || 'Untitled run'}</span></td>
                        <td>{formatDate(run.runAt)}</td>
                        <td className={ui.num}>{formatUGX(run.employeeTotal, { compact: false })}</td>
                        <td className={ui.num}>{formatUGX(run.employerTotal, { compact: false })}</td>
                        <td className={ui.num}>
                          {run.insuranceTotal > 0 ? formatUGX(run.insuranceTotal, { compact: false }) : '—'}
                        </td>
                        <td className={ui.num}>
                          <strong>{formatUGX(run.grandTotal, { compact: false })}</strong>
                        </td>
                        <td>
                          {run.status === 'completed' ? (
                            <StatusBadge tone="done">Completed</StatusBadge>
                          ) : (
                            <StatusBadge tone="open">Draft</StatusBadge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={ui.tableFoot}>
                  <span className={styles.foot}>
                    {runs.length} {runs.length === 1 ? 'run' : 'runs'} · {formatUGX(fundedToDate, { compact: false })} pension funded
                    {insuranceToDate > 0 && ` · ${formatUGX(insuranceToDate, { compact: false })} premiums`}
                  </span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {view === 'detail' && (
        <div className={styles.flowCard}>
          <div className={styles.backRow}>
            <button type="button" className={styles.backBtn} onClick={backToHistory}>
              {backIcon(16)} Back to history
            </button>
          </div>
          <RunDetailView runId={activeRunId} />
        </div>
      )}

      {view === 'wizard' && (
        <div className={styles.flowCard}>
          <div className={styles.backRow}>
            <button type="button" className={styles.backBtn} onClick={backToHistory}>
              {backIcon(16)} Back to history
            </button>
          </div>
          <NewRunWizard
            employerId={employerId}
            addToast={addToast}
            onDone={backToHistory}
            onCancel={backToHistory}
          />
        </div>
      )}
    </div>
  );
}
