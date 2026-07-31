// runViews.jsx — the three in-flow views that drive Contribution Runs, plus the
// pure helpers they share. EXTRACTED VERBATIM from ContributionRuns.jsx so BOTH
// surfaces can mount them:
//
//   • the MOBILE EmployerSlidePanel (ContributionRuns.jsx — history↔detail↔wizard
//     inside one 680-wide panel), and
//   • the DESKTOP page (desktop/RunsDesktop.jsx — the same flow in-page, no panel).
//
// Reuses the SAME stylesheet (./ContributionRuns.module.css) so the two surfaces
// render identically. NewRunWizard's useRunContribution + nonceRef/submittingRef
// dedup is kept byte-identical — the nonce minted once per wizard mount is an
// audited correctness fix (§4a F-4); never lift that state out of this component.

import { useState, useMemo, useRef } from 'react';
import {
  useContributionRuns,
  useContributionRun,
  useEmployees,
  useEmployer,
  useRunContribution,
} from '../../hooks/useEmployer';
import { formatUGX, formatNumber } from '../../utils/currency';
import { groupInsurancePremiumPerMember } from '../../utils/groupInsurance';
import { deriveContributionLegs, contributionFundingLabel } from '../../utils/contributionModel';
import { formatDate } from '../../utils/date';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './ContributionRuns.module.css';

export const mintNonce = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const METHOD_OPTIONS = ['Bank transfer', 'MTN Mobile Money', 'Airtel Money'];
export const WIZARD_STEPS = [
  { key: 'period', label: 'Period & method' },
  { key: 'confirm', label: 'Confirm' },
];

/**
 * Client mirror of the server's per-member run legs — DISPLAY ONLY, and the
 * shared preview seam for BOTH wizard steps (the step-1 estimate panel and the
 * confirm summary read the same numbers).
 *
 * The two PENSION legs are delegated to `deriveContributionLegs` — THE canonical
 * two-leg math (`utils/contributionModel.js`), which reads the COMPANY config
 * (Issue 2) against the member's `compensation`. Delegating instead of
 * re-deriving here is what keeps this preview rounding-identical to the run the
 * server commits: migration 0092's `submit_employer_contribution_run` (and
 * `_mockSubmitEmployerRun` on the offline path) mirror that same function, one
 * Math.round per leg. Never inline the arithmetic back into this file: a local
 * copy silently drifts from the ledger the moment the model moves, and the
 * employer then confirms a total the run does not post.
 *
 * Plus the company-wide INSURANCE leg (employer-funded group insurance premium,
 * summed across ALL enabled products — Life / Health / Funeral — the same for
 * every covered member). Returns all three legs so the wizard can surface
 * employee / employer / insurance / grand.
 */
export function previewMemberLegs(member, cfg) {
  const { employeeLeg, employerLeg } = deriveContributionLegs(cfg, member?.compensation);
  // Σ enabled products (Life / Health / Funeral), NOT the legacy life-only field,
  // so the preview equals what the run actually posts (services/employer.js
  // insuranceLeg / the 0067 RPC — group_insurance_premium_per_member).
  const insuranceLeg = groupInsurancePremiumPerMember(cfg);
  return { employeeLeg, employerLeg, insuranceLeg };
}

export function defaultPeriodLabel() {
  return formatDate(new Date(), { variant: 'month-year' });
}

// =============================================================================
// View 1 — history list
// =============================================================================

export function HistoryView({ employerId, onOpenRun, onNewRun }) {
  const { data: runs = [], isLoading, isError, error, refetch } = useContributionRuns(employerId);
  const isCold = isLoading && runs.length === 0;

  return (
    <>
      <div className={styles.historyHead}>
        <p className={styles.intro}>
          A run posts the employer contribution to every active member for a period.
          Each figure is computed server-side from the company funding model.
        </p>
        <button type="button" className={styles.primaryBtn} onClick={onNewRun}>
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          New contribution run
        </button>
      </div>

      {isCold ? (
        <SkeletonRow count={5} variant="compact" label="Loading contribution runs" />
      ) : isError ? (
        <ErrorCard title="We couldn't load run history" message={error} onRetry={refetch} />
      ) : runs.length === 0 ? (
        <EmptyState
          kind="no-data"
          title="No contribution runs yet"
          body="Start your first run to fund your members for the current period."
          cta={{ label: 'New contribution run', onClick: onNewRun }}
        />
      ) : (
        <ul className={styles.runList}>
          {runs.map((run) => (
            <li key={run.id} className={styles.runItem}>
              <button
                type="button"
                className={styles.runCard}
                onClick={() => onOpenRun(run.id)}
                aria-label={`Open ${run.periodLabel || 'run'} details`}
              >
                <div className={styles.runCardTop}>
                  <span className={styles.runPeriod}>{run.periodLabel || 'Untitled run'}</span>
                  <span className={styles.runStatus} data-status={run.status}>
                    {run.status === 'completed' ? 'Completed' : 'Draft'}
                  </span>
                </div>
                <div className={styles.runCardMeta}>
                  <span>{formatDate(run.runAt)}</span>
                </div>
                <RunTotals run={run} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Employee + employer (+ insurance) + grand totals shown on each history card +
    the detail header. Grand = employee + employer + insurance. The insurance chip
    is shown only when the run actually funded a premium (older pension-only runs
    omit it). */
export function RunTotals({ run }) {
  const insurance = Number(run.insuranceTotal ?? 0);
  return (
    <span className={styles.runTotals}>
      <span className={styles.totalChip}>
        <span className={styles.totalChipLabel}>Employee</span>
        <span className={styles.totalChipValue}>{formatUGX(run.employeeTotal)}</span>
      </span>
      <span className={styles.totalChip}>
        <span className={styles.totalChipLabel}>Employer</span>
        <span className={styles.totalChipValue}>{formatUGX(run.employerTotal)}</span>
      </span>
      {insurance > 0 && (
        <span className={styles.totalChip}>
          <span className={styles.totalChipLabel}>Insurance</span>
          <span className={styles.totalChipValue}>{formatUGX(insurance)}</span>
        </span>
      )}
      <span className={styles.totalChip} data-grand="true">
        <span className={styles.totalChipLabel}>Grand total</span>
        <span className={styles.totalChipValue}>{formatUGX(run.grandTotal)}</span>
      </span>
    </span>
  );
}

// =============================================================================
// View 2 — run detail (header totals + per-member employer-source lines)
// =============================================================================

export function RunDetailView({ runId }) {
  const { data, isLoading, isError, error, refetch } = useContributionRun(runId);
  const isCold = isLoading && !data;

  if (isCold) return <SkeletonRow count={6} variant="compact" label="Loading run detail" />;
  if (isError) return <ErrorCard title="We couldn't load this run" message={error} onRetry={refetch} />;
  if (!data || !data.run) {
    return <EmptyState kind="no-data" title="Run not found" body="This run is no longer available." />;
  }

  const { run, lines = [] } = data;

  // A committed v2 run posts up to TWO transactions per member (source 'own' =>
  // employee leg, source 'employer' => employer leg). Group the flat line list
  // by member IN THE COMPONENT (the service stays a thin map) so each member is
  // ONE row with separate Employee / Employer columns, and the header counts
  // DISTINCT members (lines.length would double-count two-leg members). Derived
  // inline (after the loading/error early-returns) — keep it out of a hook so we
  // don't violate the rules-of-hooks ordering against those guards.
  const memberRows = groupLinesByMember(lines);

  return (
    <>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderTop}>
          <span className={styles.detailPeriod}>{run.periodLabel || 'Untitled run'}</span>
          <span className={styles.runStatus} data-status={run.status}>
            {run.status === 'completed' ? 'Completed' : 'Draft'}
          </span>
        </div>
        <p className={styles.detailSub}>
          {formatDate(run.runAt)} · {formatNumber(memberRows.length)} {memberRows.length === 1 ? 'member' : 'members'}
        </p>
        <RunTotals run={run} />
      </div>

      {memberRows.length === 0 ? (
        <EmptyState kind="no-data" title="No line items" body="This run funded no members." />
      ) : (
        <div className={styles.lineTable} role="table" aria-label="Run line items">
          <div className={styles.lineHead} role="row">
            <span role="columnheader" className={styles.colEmp}>Member</span>
            <span role="columnheader" className={styles.colNum}>Employee</span>
            <span role="columnheader" className={styles.colNum}>Employer</span>
            <span role="columnheader" className={styles.colNum}>Insurance</span>
            <span role="columnheader" className={styles.colSplit}>Ret / Emg</span>
            <span role="columnheader" className={styles.colMethod}>Method</span>
          </div>
          <ul className={styles.lineBody}>
            {memberRows.map((row) => (
              <li key={row.subscriberId} role="row" className={styles.lineRow}>
                <span role="cell" className={styles.colEmp}>{row.memberName || row.subscriberId}</span>
                <span role="cell" className={styles.colNum}>
                  {formatUGX(row.employeeAmount, { compact: false })}
                </span>
                <span role="cell" className={styles.colNum} data-strong="true">
                  {formatUGX(row.employerAmount, { compact: false })}
                </span>
                <span role="cell" className={styles.colNum}>
                  {row.insuranceAmount > 0 ? formatUGX(row.insuranceAmount, { compact: false }) : '—'}
                </span>
                <span role="cell" className={styles.colSplit}>
                  {formatUGX(row.retirementAmount, { compact: false })} / {formatUGX(row.emergencyAmount, { compact: false })}
                </span>
                <span role="cell" className={styles.colMethod}>{row.method || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * Collapse a run's flat line list (up to two source rows per member) into one
 * row per DISTINCT member, summing the legs by source and the ret/emg split.
 * Preserves first-seen order. Pure — no service change.
 */
export function groupLinesByMember(lines) {
  const byMember = new Map();
  for (const line of lines) {
    const key = line.subscriberId;
    let row = byMember.get(key);
    if (!row) {
      row = {
        subscriberId: key,
        memberName: line.memberName ?? null,
        employeeAmount: 0,
        employerAmount: 0,
        insuranceAmount: 0,
        retirementAmount: 0,
        emergencyAmount: 0,
        method: line.method ?? null,
      };
      byMember.set(key, row);
    }
    // Key insurance off TYPE (it carries source='employer' too, so a source-only
    // test would wrongly fold the premium into the employer pension leg).
    if (line.type === 'insurance_premium') {
      row.insuranceAmount += Number(line.amount ?? 0);
    } else if (line.source === 'employer') {
      row.employerAmount += Number(line.amount ?? 0);
    } else {
      row.employeeAmount += Number(line.amount ?? 0);
    }
    row.retirementAmount += Number(line.retirementAmount ?? 0);
    row.emergencyAmount += Number(line.emergencyAmount ?? 0);
    if (!row.memberName && line.memberName) row.memberName = line.memberName;
    if (!row.method && line.method) row.method = line.method;
  }
  return [...byMember.values()];
}

// =============================================================================
// View 3 — new-run wizard (period + method → confirm)
// =============================================================================

export function NewRunWizard({ employerId, addToast, onDone, onCancel }) {
  const { data: employees = [], isLoading, isError, error, refetch } = useEmployees(employerId);
  const { data: employer } = useEmployer(employerId);
  const runContribution = useRunContribution(employerId);

  const [stepIndex, setStepIndex] = useState(0);
  const [periodLabel, setPeriodLabel] = useState(defaultPeriodLabel);
  const [method, setMethod] = useState(METHOD_OPTIONS[0]);
  const submittingRef = useRef(false);
  // Nonce minted ONCE per wizard session (this component mounts only while
  // view==='wizard'). Reusing the same nonce across confirm retries lets the
  // server-side ledger dedupe a committed-but-timed-out run instead of the
  // operator's "try again" double-funding every member (audit §4a F-4).
  const nonceRef = useRef(null);
  if (nonceRef.current === null) nonceRef.current = mintNonce();

  const config = employer?.defaultContributionConfig ?? null;
  const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
  const suspendedCount = employees.length - activeEmployees.length;

  // Live preview totals (client mirror of the server TWO-LEG math — DISPLAY
  // ONLY). A member is "funded" when EITHER leg is non-zero; grand = sum of both.
  const preview = useMemo(() => {
    let employerTotal = 0;
    let employeeTotal = 0;
    let insuranceTotal = 0;
    let funded = 0;
    for (const emp of activeEmployees) {
      const { employeeLeg, employerLeg, insuranceLeg } = previewMemberLegs(emp, config);
      if (employeeLeg > 0 || employerLeg > 0 || insuranceLeg > 0) {
        employeeTotal += employeeLeg;
        employerTotal += employerLeg;
        insuranceTotal += insuranceLeg;
        funded += 1;
      }
    }
    return {
      employerTotal,
      employeeTotal,
      insuranceTotal,
      grandTotal: employerTotal + employeeTotal + insuranceTotal,
      funded,
    };
  }, [activeEmployees, config]);

  const isPending = runContribution.isPending;

  function next() {
    setStepIndex((i) => Math.min(i + 1, WIZARD_STEPS.length - 1));
  }
  function back() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function handleConfirm() {
    if (submittingRef.current || isPending) return;
    submittingRef.current = true;
    // Reuse the session nonce so a manual retry after a committed-but-timed-out
    // run replays the SAME nonce and the server ledger dedupes it (no double-fund).
    const nonce = nonceRef.current;
    try {
      const result = await runContribution.mutateAsync({ periodLabel, method, nonce });
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      const skippedNote = skippedCount > 0 ? ` · ${formatNumber(skippedCount)} skipped` : '';
      addToast(
        'success',
        `Run recorded — ${formatNumber(result?.linesCreated ?? 0)} funded · ${formatUGX(result?.grandTotal ?? 0)} total${skippedNote}`,
      );
      // Successful completion: retire this nonce so a future run mints a fresh one.
      nonceRef.current = mintNonce();
      onDone();
    } catch (err) {
      addToast('error', err?.message || 'Could not record the contribution run.');
    } finally {
      submittingRef.current = false;
    }
  }

  if (isLoading && employees.length === 0) {
    return <SkeletonRow count={6} variant="compact" label="Loading members" />;
  }
  if (isError) {
    return <ErrorCard title="We couldn't load the roster" message={error} onRetry={refetch} />;
  }

  return (
    <div className={styles.wizard}>
      <ol className={styles.stepper} aria-label="New run steps">
        {WIZARD_STEPS.map((step, i) => (
          <li
            key={step.key}
            className={styles.step}
            data-state={i === stepIndex ? 'current' : i < stepIndex ? 'done' : 'upcoming'}
            aria-current={i === stepIndex ? 'step' : undefined}
          >
            <span className={styles.stepDot}>{i < stepIndex ? '✓' : i + 1}</span>
            <span className={styles.stepLabel}>{step.label}</span>
          </li>
        ))}
      </ol>

      {/* Step 1 — period + method */}
      {stepIndex === 0 && (
        <div className={styles.stepBody}>
          <p className={styles.intro}>
            <strong>Company funding:</strong> {contributionFundingLabel(config)}
          </p>
          <div className={styles.field}>
            <label htmlFor="run-period" className={styles.fieldLabel}>Period label</label>
            <input
              id="run-period"
              type="text"
              className={styles.textInput}
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="e.g. May 2026"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="run-method" className={styles.fieldLabel}>Payment method</label>
            <select id="run-method" className={styles.select} value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className={styles.previewPanel} aria-live="polite">
            <p className={styles.previewTitle}>
              Estimated contribution for {formatNumber(preview.funded)} active {preview.funded === 1 ? 'member' : 'members'}
            </p>
            <p className={styles.previewNote}>Advisory preview — the server re-derives final figures on submit.</p>
            <div className={styles.previewGrid}>
              <div className={styles.previewCell}>
                <span className={styles.previewCellLabel}>Employee total</span>
                <span className={styles.previewCellValue}>{formatUGX(preview.employeeTotal, { compact: false })}</span>
              </div>
              <div className={styles.previewCell}>
                <span className={styles.previewCellLabel}>Employer total</span>
                <span className={styles.previewCellValue}>{formatUGX(preview.employerTotal, { compact: false })}</span>
              </div>
              {preview.insuranceTotal > 0 && (
                <div className={styles.previewCell}>
                  <span className={styles.previewCellLabel}>Insurance total</span>
                  <span className={styles.previewCellValue}>{formatUGX(preview.insuranceTotal, { compact: false })}</span>
                </div>
              )}
              <div className={styles.previewCell} data-grand="true">
                <span className={styles.previewCellLabel}>Grand total</span>
                <span className={styles.previewCellValue}>{formatUGX(preview.grandTotal, { compact: false })}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — confirm */}
      {stepIndex === 1 && (
        <div className={styles.stepBody}>
          <div className={styles.summaryCard}>
            <dl className={styles.summaryList}>
              <div className={styles.summaryItem}>
                <dt>Members funded</dt>
                <dd>{formatNumber(preview.funded)} active</dd>
              </div>
              <div className={styles.summaryItem}>
                <dt>Period</dt>
                <dd>{periodLabel || '—'}</dd>
              </div>
              <div className={styles.summaryItem}>
                <dt>Method</dt>
                <dd>{method}</dd>
              </div>
              <div className={styles.summaryItem}>
                <dt>Employee total</dt>
                <dd>{formatUGX(preview.employeeTotal, { compact: false })}</dd>
              </div>
              <div className={styles.summaryItem}>
                <dt>Employer total</dt>
                <dd>{formatUGX(preview.employerTotal, { compact: false })}</dd>
              </div>
              {preview.insuranceTotal > 0 && (
                <div className={styles.summaryItem}>
                  <dt>Insurance total</dt>
                  <dd>{formatUGX(preview.insuranceTotal, { compact: false })}</dd>
                </div>
              )}
              <div className={styles.summaryItem} data-grand="true">
                <dt>Grand total</dt>
                <dd>{formatUGX(preview.grandTotal, { compact: false })}</dd>
              </div>
            </dl>
            <p className={styles.confirmNote}>
              Final amounts are computed server-side from the company funding model.
              {suspendedCount > 0 ? ` ${formatNumber(suspendedCount)} inactive member(s) are skipped automatically.` : ''}
            </p>
          </div>
        </div>
      )}

      <div className={styles.wizardFooter}>
        {stepIndex === 0 ? (
          <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={isPending}>Cancel</button>
        ) : (
          <button type="button" className={styles.ghostBtn} onClick={back} disabled={isPending}>Back</button>
        )}

        {stepIndex < WIZARD_STEPS.length - 1 ? (
          <button type="button" className={styles.primaryBtn} onClick={next} disabled={preview.funded === 0}>
            Continue
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleConfirm}
            disabled={isPending || preview.funded === 0}
            aria-busy={isPending || undefined}
          >
            {isPending ? 'Recording…' : `Confirm & record (${formatNumber(preview.funded)})`}
          </button>
        )}
      </div>
    </div>
  );
}
