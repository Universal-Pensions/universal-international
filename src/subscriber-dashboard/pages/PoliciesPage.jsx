import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatUGX } from '../../utils/currency';

import { formatDate } from '../../utils/date';
import { formatMemberId } from '../../utils/memberId';
import { buildingProgress } from '../../utils/policies';
import {
  useCurrentSubscriber,
  useSubscriberNominees,
  useRenewPolicy,
  useMyEmployerFunding,
} from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { openPolicyCertificate } from '../../signup/contribution/insurancePolicyCertificate';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import PaySheet from '../../components/PaySheet';
import InlinePayPanel from '../../components/InlinePayPanel';
import { PAYMENT_METHODS } from '../../constants/payment';
import styles from './PoliciesPage.module.css';
import flow from './desktopFlow.module.css';

function PolicyIcon({ type }) {
  if (type === 'health') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <path d="M12 20s-7-4.35-7-9.5A3.5 3.5 0 0112 7.5 3.5 3.5 0 0119 10.5c0 5.15-7 9.5-7 9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M12 11.2v3.2M10.4 12.8h3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'funeral') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="12" cy="7" rx="2.4" ry="3.2" />
        <ellipse cx="12" cy="17" rx="2.4" ry="3.2" />
        <ellipse cx="7" cy="12" rx="3.2" ry="2.4" />
        <ellipse cx="17" cy="12" rx="3.2" ry="2.4" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STATUS_LABEL = { active: 'Active', building: 'Building', expired: 'Expired' };

function StatusPill({ status }) {
  return (
    <span className={styles.statusPill} data-tone={status}>
      <span className={styles.statusDot} aria-hidden="true" />
      {STATUS_LABEL[status] ?? 'Active'}
    </span>
  );
}

function PolicyCard({ policy, onRenew, onCertificate, employerName }) {
  const expired = policy.status === 'expired';
  const building = policy.status === 'building';
  const employerPaid = policy.fundedBy === 'employer';
  return (
    <article className={styles.policyCard} data-status={policy.status}>
      <div className={styles.policyTop}>
        <span className={styles.policyIcon} data-type={policy.type}>
          <PolicyIcon type={policy.type} />
        </span>
        <div className={styles.policyHead}>
          <h3 className={styles.policyName}>{policy.name}</h3>
          <span className={styles.policyCover}>{formatUGX(policy.cover, { compact: false })} cover</span>
        </div>
        <StatusPill status={policy.status} />
      </div>

      {employerPaid && (
        <span className={styles.employerBadge}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
            <path d="M4 20V7l7-3 7 3v13M3 20h18M8 11h.01M11 11h.01M14 11h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Paid by {employerName || 'your employer'}
        </span>
      )}

      <dl className={styles.policyMeta}>
        <div>
          <dt>Premium</dt>
          <dd>{employerPaid ? 'Employer-funded' : `${formatUGX((Number(policy.premiumMonthly) || 0) * 12, { compact: false })} / yr`}</dd>
        </div>
        <div>
          <dt>{employerPaid ? 'Status' : building ? 'Cover starts' : expired ? 'Expired' : 'Renews'}</dt>
          <dd>{employerPaid
            ? 'Managed by employer'
            : building
              ? 'Once your premium is saved'
              : formatDate(policy.renewalDate)}</dd>
        </div>
      </dl>

      {employerPaid ? (
        <button type="button" className={styles.ghostBtn} onClick={() => onCertificate(policy)}>
          Download certificate
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none">
            <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : building ? (
        // Save-to-cover: not in force yet — no certificate to download. The card
        // just states the policy is being funded (progress bar lives above).
        <div className={styles.buildingNote}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
            <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M12 8v4l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Saving toward this cover — the certificate unlocks once it&apos;s active.
        </div>
      ) : expired ? (
        <button type="button" className={styles.renewBtn} onClick={() => onRenew(policy)}>
          Renew · {formatUGX(policy.renewalAmount, { compact: false })}
        </button>
      ) : (
        <button type="button" className={styles.ghostBtn} onClick={() => onCertificate(policy)}>
          Download certificate
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none">
            <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </article>
  );
}

export default function PoliciesPage() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { data: sub, isLoading } = useCurrentSubscriber();
  const { data: nominees } = useSubscriberNominees(sub?.id);
  const { addToast } = useToast();
  const renew = useRenewPolicy(sub?.id);
  // The employer's NAME for the "Paid by …" badge on employer-funded cover. The
  // subscriber mapper only ever sets `employerId` (a subscriber JWT cannot read the
  // employers table at all — there is no employer-facing SELECT policy for it), so
  // the old `sub.employerName` was permanently undefined and every badge fell back
  // to "your employer". The narrow get_my_employer_funding RPC is the only path
  // that can resolve it. Everything ELSE on this page is insurance-side (policy
  // `fundedBy`) and is untouched by the contribution model.
  // (`sub?.id` is honoured by the mock branch only — the live RPC trusts the JWT —
  // so the badge names the employer of the member whose policies are on screen.)
  const { data: funding } = useMyEmployerFunding(sub?.id);
  const employerName = funding?.employerName || null;

  const policies = sub?.policies || [];
  const active = policies.filter((p) => p.status === 'active');
  const building = policies.filter((p) => p.status === 'building');
  const expired = policies.filter((p) => p.status === 'expired');
  const hasAny = policies.length > 0;
  const onlyExpired = active.length === 0 && building.length === 0 && expired.length > 0;
  // Save-to-cover (0072): combined savings progress toward the annual premium.
  const progress = buildingProgress(sub);
  // Headline figure for the mobile flat summary card (replaces the removed hero):
  // total benefit across the subscriber's active cover.
  const totalActiveCover = active.reduce((sum, p) => sum + (p.cover || 0), 0);
  const totalBuildingCover = building.reduce((sum, p) => sum + (p.cover || 0), 0);
  // When there's no active cover yet but cover is building, the summary headline
  // flips to the cover being saved toward.
  const summaryIsBuilding = active.length === 0 && building.length > 0;
  const summaryCoverLabel = summaryIsBuilding ? 'Cover you’re building' : 'Total active cover';
  const summaryCoverAmount = summaryIsBuilding ? totalBuildingCover : totalActiveCover;
  // Earliest upcoming renewal across active policies — shown in the desktop
  // cover-summary strip. ISO date strings sort lexicographically.
  const nextRenewal = active.map((p) => p.renewalDate).filter(Boolean).sort()[0] || null;
  const nextRenewalName = nextRenewal
    ? (active.find((p) => p.renewalDate === nextRenewal)?.name ?? null)
    : null;

  // Renewal sheet (the shared PaySheet owns the method picker).
  const [renewing, setRenewing] = useState(null);
  const [view, setView] = useState('confirm'); // confirm | success
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { reference, renewalDate }

  function openRenew(policy) {
    // Guard against re-entry while a renewal is in flight — on desktop the left
    // column's other Renew buttons stay mounted (no backdrop), so a second click
    // must not repoint `renewing` and bind the resolving mutation to the wrong
    // policy. (The left column is also made inert during a renewal below.)
    if (submitting) return;
    setRenewing(policy);
    setView('confirm');
    setResult(null);
  }

  function closeSheet() {
    if (submitting) return;
    setRenewing(null);
  }

  async function handlePay(methodFull) {
    if (!renewing || !sub) return;
    setSubmitting(true);
    try {
      const { reference, policy } = await renew.mutateAsync({
        type: renewing.type,
        method: methodFull,
      });
      setResult({ reference, renewalDate: policy?.renewalDate });
      setView('success');
      addToast('success', `${renewing.name} renewed — ${formatUGX(renewing.renewalAmount, { compact: false })} paid.`);
    } catch (err) {
      addToast('error', err?.message || 'Could not complete the renewal.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCertificate(policy) {
    // Life + funeral pay out to named beneficiaries; health does not.
    const hasBeneficiaries = policy.type === 'life' || policy.type === 'funeral';
    const PRODUCT_LABEL = { life: 'Life', health: 'Health', funeral: 'Funeral' };
    const ok = openPolicyCertificate({
      holderName: sub?.name,
      memberId: formatMemberId(sub?.phone),
      dob: sub?.dob,
      cover: policy.cover,
      // Self-paid cover is charged as ONE annual premium (rate × 12); label it
      // annually with no per-period cadence, matching the signup certificate.
      premiumPerPeriod: (Number(policy.premiumMonthly) || 0) * 12,
      premiumLabel: 'Annual premium',
      policyStart: policy.policyStart,
      renewalDate: policy.renewalDate,
      productLabel: PRODUCT_LABEL[policy.type] ?? 'Life',
      showBeneficiaries: hasBeneficiaries,
      beneficiaries: hasBeneficiaries ? (nominees?.insurance ?? []) : [],
    });
    if (!ok) {
      addToast('error', 'Please allow pop-ups for this site, then try again to open your certificate.');
    }
  }

  const subtitle = isLoading
    ? undefined
    : hasAny
      ? [
          active.length > 0 ? `${active.length} active` : null,
          building.length > 0 ? `${building.length} building` : null,
          expired.length > 0 ? `${expired.length} expired` : null,
        ].filter(Boolean).join(' · ') || `${active.length} active`
      : 'Protect what matters most';

  // ── Shared blocks ───────────────────────────────────────────────────────────
  const emptyState = (
    <EmptyState
      kind="no-data"
      title="No policies yet"
      body="You don't have any insurance cover yet. Add a policy to protect your family."
      cta={{ label: 'Add policy', onClick: () => navigate('/dashboard/settings/insurance') }}
    />
  );

  // The policy lists (banner + active + expired) — single-sourced across the
  // mobile stack and the desktop left column.
  const listContent = (
    <>
      {onlyExpired && (
        <div className={styles.banner} role="status">
          <span className={styles.bannerIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M12 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="16.5" r="1.1" fill="currentColor" />
              <path d="M12 3l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </span>
          <p>You have no active policies. Renew below to restore your cover.</p>
        </div>
      )}

      {active.length > 0 && (
        <section className={styles.section} aria-labelledby="policies-active">
          <h2 id="policies-active" className={styles.sectionTitle}>Active</h2>
          <div className={styles.cards}>
            {active.map((p) => (
              <PolicyCard key={p.id} policy={p} onRenew={openRenew} onCertificate={handleCertificate} employerName={employerName} />
            ))}
          </div>
        </section>
      )}

      {building.length > 0 && (
        <section className={styles.section} aria-labelledby="policies-building">
          <h2 id="policies-building" className={styles.sectionTitle}>Building</h2>
          {progress.target > 0 && (
            <div className={styles.buildProgress} role="status">
              <div className={styles.buildProgressTop}>
                <span className={styles.buildProgressLabel}>Saving toward your annual premium</span>
                <b className={styles.buildProgressPct}>{progress.pct}%</b>
              </div>
              <div className={styles.buildBar} aria-hidden="true">
                <span className={styles.buildBarFill} style={{ width: `${progress.pct}%` }} />
              </div>
              <p className={styles.buildProgressSub}>
                {formatUGX(progress.accrued, { compact: false })} of {formatUGX(progress.target, { compact: false })} saved · your cover activates automatically once it&apos;s fully funded.
              </p>
            </div>
          )}
          <div className={styles.cards}>
            {building.map((p) => (
              <PolicyCard key={p.id} policy={p} onRenew={openRenew} onCertificate={handleCertificate} employerName={employerName} />
            ))}
          </div>
        </section>
      )}

      {expired.length > 0 && (
        <section className={styles.section} aria-labelledby="policies-expired">
          <h2 id="policies-expired" className={styles.sectionTitle}>Expired</h2>
          <div className={styles.cards}>
            {expired.map((p) => (
              <PolicyCard key={p.id} policy={p} onRenew={openRenew} onCertificate={handleCertificate} employerName={employerName} />
            ))}
          </div>
        </section>
      )}
    </>
  );

  // Desktop right column — a sticky "Your cover" summary that flips IN PLACE to
  // the inline renewal pay panel (no bottom sheet on desktop).
  const coverSummaryCard = (
    <div className={flow.card}>
      <p className={flow.sumEyebrow}>{summaryCoverLabel}</p>
      <div className={flow.sumBig}>{formatUGX(summaryCoverAmount, { compact: false })}</div>
      <ul className={flow.sumList}>
        <li className={flow.sumRow}>
          <span>Active</span>
          <span className={flow.sumVal}>{active.length} {active.length === 1 ? 'policy' : 'policies'}</span>
        </li>
        {building.length > 0 && (
          <li className={flow.sumRow}>
            <span>Building</span>
            <span className={flow.sumVal}>{building.length} {building.length === 1 ? 'policy' : 'policies'}</span>
          </li>
        )}
        {summaryIsBuilding && progress.target > 0 && (
          <li className={flow.sumRow}>
            <span>Premium saved</span>
            <span className={flow.sumVal}>{progress.pct}%</span>
          </li>
        )}
        <li className={flow.sumRow}>
          <span>Expired</span>
          <span className={flow.sumVal}>{expired.length}</span>
        </li>
        {!summaryIsBuilding && (
          <li className={flow.sumRow}>
            <span>Next renewal</span>
            <span className={flow.sumVal}>{nextRenewal ? formatDate(nextRenewal) : '—'}</span>
          </li>
        )}
      </ul>
      <p className={flow.note}>
        {summaryIsBuilding
          ? 'Your cover activates automatically once your savings fund the annual premium.'
          : (nextRenewalName ? <>Next up: <b>{nextRenewalName}</b>.</> : 'No upcoming renewals.')}
      </p>
    </div>
  );

  const renewPanel = renewing ? (
    <InlinePayPanel
      view={view === 'success' ? 'success' : 'confirm'}
      ariaLabel={view === 'confirm' ? `Renew ${renewing.name}` : 'Renewal complete'}
      eyebrow="You’re paying to renew"
      total={renewing.renewalAmount}
      subtitle={`One year of ${renewing.name.toLowerCase()} · ${formatUGX(renewing.cover, { compact: false })} benefit`}
      lineItems={[
        { label: 'Policy', value: renewing.name },
        { label: 'Cover', value: formatUGX(renewing.cover, { compact: false }) },
        { label: 'Annual premium', value: `${formatUGX(renewing.renewalAmount, { compact: false })} / yr` },
      ]}
      methods={PAYMENT_METHODS}
      submitting={submitting}
      primaryLabel={`Pay ${formatUGX(renewing.renewalAmount, { compact: false })}`}
      cancelLabel="Cancel"
      onPay={handlePay}
      onCancel={closeSheet}
      success={{
        title: 'Policy renewed',
        subtitle: `${renewing.name} is active again.${result?.renewalDate ? ` Renews ${formatDate(result.renewalDate)}.` : ''}`,
        reference: result?.reference,
      }}
      successPrimary={{ label: 'Done', onClick: closeSheet }}
    />
  ) : null;

  // Desktop (>=1024px): a 2-column split — the policy lists on the left, a sticky
  // "Your cover" summary on the right that flips in place to the inline renewal
  // pay panel. When there's no cover at all, the empty state spans full width.
  if (isDesktop) {
    return (
      <div className={styles.page}>
        <PageHeader title="Your policies" subtitle={subtitle} fallback="/dashboard" />
        <div className={styles.body}>
          {!isLoading && !hasAny ? (
            emptyState
          ) : (
            <div className={flow.splitHost}>
              <div className={flow.split}>
                {/* Left list locks (inert) while a renewal owns the right column,
                    so no other policy's Renew button can be triggered mid-flight. */}
                <div className={`${flow.col} ${renewing ? flow.colLocked : ''}`} inert={!!renewing}>{listContent}</div>
                <aside className={flow.summaryCol}>
                  {/* Nudge the sticky summary down by one section-heading block so
                      its card top lines up with the first policy card (the left
                      column opens with the "Active" heading; the right has none). */}
                  <div className={styles.summaryAlign}>
                    {renewing ? renewPanel : (hasAny ? coverSummaryCard : null)}
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Mobile: unchanged single-column stack + the shared PaySheet bottom sheet.
  return (
    <div className={styles.page}>
      <div className={styles.body}>
        {/* Mobile flat summary card — eyebrow + big indigo total-cover figure +
            a sub-line. Only shown when cover exists. */}
        {!isLoading && hasAny && (
          <section className={styles.summary} aria-labelledby="policies-cover-label">
            <span className={styles.summaryEyebrow} id="policies-cover-label">{summaryCoverLabel}</span>
            <div className={styles.summaryFigure}>{formatUGX(summaryCoverAmount, { compact: false })}</div>
            <span className={styles.summarySub}>{subtitle}</span>
          </section>
        )}

        {!isLoading && !hasAny && emptyState}

        {listContent}
      </div>

      {/* Renewal sheet — the shared PaySheet (portaled to <body>). */}
      <PaySheet
        open={!!renewing}
        view={view}
        ariaLabel={renewing ? (view === 'confirm' ? `Renew ${renewing.name}` : 'Renewal complete') : undefined}
        eyebrow="You're paying to renew"
        total={renewing?.renewalAmount ?? 0}
        subtitle={renewing
          ? `One year of ${renewing.name.toLowerCase()} · ${formatUGX(renewing.cover, { compact: false })} benefit`
          : undefined}
        lineItems={renewing ? [
          { label: 'Policy', value: renewing.name },
          { label: 'Cover', value: formatUGX(renewing.cover, { compact: false }) },
          { label: 'Annual premium', value: `${formatUGX(renewing.renewalAmount, { compact: false })} / yr` },
        ] : []}
        submitting={submitting}
        success={{
          title: 'Policy renewed',
          subtitle: renewing
            ? `${renewing.name} is active again.${result?.renewalDate ? ` Renews ${formatDate(result.renewalDate)}.` : ''}`
            : undefined,
          reference: result?.reference,
        }}
        onPay={handlePay}
        onClose={closeSheet}
      />
    </div>
  );
}
