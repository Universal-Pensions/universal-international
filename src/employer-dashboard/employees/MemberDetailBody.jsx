// Member detail body — the read-only sections for a single staff member
// (identity, company-wide funding, contribution history, company group cover,
// nominees). Extracted from the former standalone EmployeeDetail panel so the
// roster (ViewEmployees) renders it INLINE via a list↔detail replace model — no
// second slide-in panel overlapping the roster. The panel chrome (title = the
// member's name, status badge, Back, Remove) is owned by ViewEmployees; this
// component is just the body. All data via hooks; never imports `employerSeed`.

import { useState } from 'react';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import {
  useEmployee,
  useEmployeeContributions,
  useEmployer,
  useUpdateMemberCompensation,
} from '../../hooks/useEmployer';
import { useToast } from '../../contexts/ToastContext';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { groupInsuranceProducts } from '../../utils/groupInsurance';
import { deriveContributionLegs, contributionFundingLabel } from '../../utils/contributionModel';
import SkeletonRow from '../../components/SkeletonRow';
import ErrorCard from '../../components/feedback/ErrorCard';
import EmptyState from '../../components/EmptyState';
import styles from './MemberDetailBody.module.css';

export default function MemberDetailBody({ employeeId }) {
  const { employerId } = useEmployerScope();

  const { data: employee, isLoading, isError, error, refetch } = useEmployee(employeeId);
  const {
    data: contributions = [],
    isLoading: txLoading,
    isError: txError,
    error: txErrorObj,
    refetch: refetchTx,
  } = useEmployeeContributions(employeeId);
  const { data: employer } = useEmployer(employerId);
  const updateCompensation = useUpdateMemberCompensation(employerId);
  const { addToast } = useToast();

  // Inline compensation edit (mirrors ViewEmployees' remove-member wiring: a
  // local edit state + a non-optimistic mutate that toasts + invalidates).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const isCold = isLoading && !employee;

  // Insurance is company-wide (all-or-nothing, one flat cover) — read it from the
  // employer config, never per-member fields (which don't exist under this model).
  const insCfg = employer?.defaultContributionConfig ?? {};
  // Multi-product (Life / Health / Funeral): total per-member cover across ALL
  // enabled products, not just the legacy life-only groupCoverAmount.
  const insProducts = groupInsuranceProducts(insCfg);
  const insEnabled = insProducts.length > 0;
  const insCover = insProducts.reduce((s, p) => s + p.cover, 0);

  if (isCold) return <SkeletonRow count={6} label="Loading member" />;
  if (isError) return <ErrorCard title="We couldn't load this member" message={error} onRetry={refetch} />;
  if (!employee) return <EmptyState kind="no-data" title="Member not found" body="This record may have been removed." />;

  // Compensation drives the run; members never self-set a saving amount
  // (`monthlyContribution` is vestigial). The two monthly legs come from
  // `deriveContributionLegs` — THE canonical math that migration 0092's run RPC
  // mirrors — so what the employer reads here is what a run will actually post
  // for this member. Both legs are shares of COMPENSATION and independent of
  // each other; either may be zero.
  const compensation = Number(employee.compensation) || 0;
  const { employeeLeg, employerLeg } = deriveContributionLegs(
    employer?.defaultContributionConfig,
    compensation,
  );

  function startEdit() {
    setDraft(String(compensation));
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft('');
  }
  function saveEdit() {
    if (updateCompensation.isPending) return;
    const next = Number(draft);
    if (draft === '' || !Number.isFinite(next) || next < 0) {
      addToast('error', 'Enter a monthly compensation of 0 or more (UGX).');
      return;
    }
    updateCompensation.mutate(
      { employeeId: employee.id, compensation: next },
      {
        onSuccess: () => {
          addToast('success', `Updated ${employee.name.split(' ')[0]}'s monthly compensation.`);
          setEditing(false);
          setDraft('');
        },
        onError: (err) => addToast('error', err?.message || 'Could not update compensation.'),
      },
    );
  }

  return (
    <div className={styles.sections}>
      {/* Identity meta */}
      <p className={styles.identity}>
        {employee.phone}
        {employee.email ? ` · ${employee.email}` : ''}
        {employee.joinedDate ? ` · Joined ${formatDate(employee.joinedDate, { variant: 'long' })}` : ''}
      </p>
      {employee.status === 'suspended' && (
        <p className={styles.suspendNote}>
          This member is inactive — contribution runs skip them.
        </p>
      )}

      {/* The employee's pension balance (retirement / emergency / net pot) is
          their private financial information and is deliberately NOT shown to
          the employer. The employer sees only the funding relationship below:
          the contribution plan + the contribution history (their own runs). */}

      {/* ── Funding (company-wide; Issue 2) ────────────────────────────── */}
      <section className={styles.section} aria-labelledby="sched-h">
        <h3 id="sched-h" className={styles.sectionTitle}>Contribution plan</h3>
        <dl className={styles.defs}>
          {/* Monthly compensation — the run driver (0062), with inline edit. */}
          <div className={styles.def}>
            <dt className={styles.defLabel}>Monthly compensation</dt>
            <dd className={styles.defValue}>
              {editing ? (
                <span className={styles.compEdit}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1000"
                    className={styles.compInput}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label="Monthly compensation in UGX"
                    autoFocus
                    disabled={updateCompensation.isPending}
                  />
                  <button
                    type="button"
                    className={styles.compSave}
                    onClick={saveEdit}
                    disabled={updateCompensation.isPending}
                  >
                    {updateCompensation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className={styles.compCancel}
                    onClick={cancelEdit}
                    disabled={updateCompensation.isPending}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span className={styles.compEdit}>
                  {formatUGX(compensation, { compact: false })}
                  <button type="button" className={styles.compEditBtn} onClick={startEdit}>
                    Edit
                  </button>
                </span>
              )}
            </dd>
          </div>
          {/* The two legs in the same words the funding line uses: what the member
              puts in from their own pay, and what the company adds on top. */}
          <Def label="They put in / mo" value={formatUGX(employeeLeg, { compact: false })} />
          <Def label="You add / mo" value={formatUGX(employerLeg, { compact: false })} />
          <Def label="Company funding" value={contributionFundingLabel(employer?.defaultContributionConfig)} />
          <Def
            label="Retirement / Emergency"
            value={`${Number(employee.contributionSchedule?.retirementPct ?? 80)}% / ${Number(employee.contributionSchedule?.emergencyPct ?? 20)}%`}
          />
        </dl>
      </section>

      {/* ── Contribution history (own + employer) ──────────────────────── */}
      <section className={styles.section} aria-labelledby="hist-h">
        <h3 id="hist-h" className={styles.sectionTitle}>Contribution history</h3>
        {txLoading && contributions.length === 0 ? (
          <SkeletonRow count={3} variant="compact" label="Loading contributions" />
        ) : txError ? (
          <ErrorCard title="We couldn't load contributions" message={txErrorObj} onRetry={refetchTx} variant="inline" />
        ) : contributions.length === 0 ? (
          <EmptyState kind="no-data" title="No contributions yet" body="Own savings and employer contributions appear here." />
        ) : (
          <ul className={styles.txList}>
            {contributions.map((c) => (
              <li key={c.id} className={styles.txRow}>
                <div className={styles.txMain}>
                  <span className={styles.txPeriod}>
                    {c.source === 'employer' ? 'Employer contribution' : 'Own contribution'}
                  </span>
                  <span className={styles.txMeta}>
                    {c.date ? formatDate(c.date, { variant: 'short' }) : '—'}
                    {c.method ? ` · ${c.method}` : ''}
                  </span>
                </div>
                <div className={styles.txAmounts}>
                  <span className={styles.txTotal}>{formatUGX(c.amount, { compact: false })}</span>
                  <span className={styles.txHalves} data-source={c.source}>
                    {c.source === 'employer' ? 'Employer' : 'You'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Insurance (company-wide group cover; read-only here) ───────── */}
      <section className={styles.section} aria-labelledby="ins-h">
        <h3 id="ins-h" className={styles.sectionTitle}>Insurance</h3>
        <dl className={styles.defs}>
          <Def
            label="Group cover"
            value={insEnabled && insCover > 0 ? formatUGX(insCover, { compact: false }) : 'No group cover'}
          />
        </dl>
        <p className={styles.insHint}>
          Group life cover is company-wide — the same flat amount for every staff member, managed from Insurance &amp; benefits.
        </p>
      </section>

      {/* ── Nominees ──────────────────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="nom-h">
        <h3 id="nom-h" className={styles.sectionTitle}>Nominees</h3>
        {employee.nominees && employee.nominees.length > 0 ? (
          <ul className={styles.nomineeList}>
            {employee.nominees.map((n, i) => (
              <li key={n.id || n.nin || `${n.name}-${i}`} className={styles.nomineeRow}>
                <div className={styles.nomineeMain}>
                  <span className={styles.nomineeName}>{n.name}</span>
                  {n.relationship && <span className={styles.nomineeRel}>{n.relationship}</span>}
                </div>
                {n.share != null && <span className={styles.nomineeShare}>{Number(n.share)}%</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyInline}>No nominees on file.</p>
        )}
      </section>
    </div>
  );
}

function Def({ label, value }) {
  return (
    <div className={styles.def}>
      <dt className={styles.defLabel}>{label}</dt>
      <dd className={styles.defValue}>{value}</dd>
    </div>
  );
}
