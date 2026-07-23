import { useCommissionSummary, useCommissionRate, usePendingDuesByAgent, useSettlementsList } from '../../hooks/useCommission';
import { formatNumber, formatUGX, formatUGXShort } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import styles from './distributorMobile.module.css';

const InfoIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

const MAX_DUES = 15;
const MAX_HISTORY = 8;

/**
 * CommissionsMobile — the distributor's Commissions tab (route
 * /dashboard/commissions). Network-wide settlement summary, the flat rate,
 * pending dues by agent, and recent settlement history. The settlement
 * upload/download workflow stays on the desktop (file I/O); the phone is the
 * oversight surface. Same hooks as the desktop CommissionPanel.
 */
export default function CommissionsMobile() {
  const { data: summary } = useCommissionSummary();
  const { data: rate } = useCommissionRate();
  const { data: duesByAgent = [] } = usePendingDuesByAgent();
  const { data: settlements = [] } = useSettlementsList({ limit: MAX_HISTORY });

  if (!summary) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const s = summary;
  const settlementRate = s.totalCommissions > 0 ? Math.round((s.totalPaid / s.totalCommissions) * 100) : 0;
  const dues = duesByAgent.slice(0, MAX_DUES);

  return (
    <>
      {/* Summary */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Commission summary">
        <header className={styles.cardHd} style={{ marginBottom: 8 }}>
          <h3>Commissions</h3>
          <span className={styles.tag}>{settlementRate}% settled</span>
        </header>
        <div className={styles.totchips}>
          <div className={styles.totchip}><small>Settled · {formatNumber(s.countPaid || 0)}</small><b>{formatUGXShort(s.totalPaid || 0)}</b></div>
          <div className={styles.totchip}><small>Outstanding · {formatNumber(s.countDue || 0)}</small><b>{formatUGXShort(s.totalDue || 0)}</b></div>
          <div className={`${styles.totchip} ${styles.totchipGrand}`}><small>Total · {formatNumber(s.countTotal || 0)}</small><b>{formatUGXShort(s.totalCommissions || 0)}</b></div>
        </div>
        {rate != null && (
          <p className={styles.scoreNote} style={{ marginTop: 12 }}>
            Flat rate of <b style={{ color: 'var(--color-indigo)' }}>{formatUGX(rate)}</b> per subscriber onboarded.
          </p>
        )}
      </section>

      {/* Settle-on-desktop note */}
      <div className={styles.callout}>
        <span className={styles.calloutIc} aria-hidden="true">{InfoIcon}</span>
        <div>
          <b>Settle on the desktop dashboard</b>
          <p>Download the per-agent template, record payments, and re-upload to settle dues. This phone view is for oversight.</p>
        </div>
      </div>

      {/* Pending dues by agent */}
      <section className={styles.card} aria-label="Pending dues by agent">
        <header className={styles.cardHd}><h3>Pending dues by agent</h3><span className={styles.tag}>{formatNumber(duesByAgent.length)}</span></header>
        {dues.map((d) => (
          <div key={d.agentId} className={styles.lrow} style={{ cursor: 'default' }}>
            <span className={styles.av} data-tone="teal" aria-hidden="true">{initials(d.agentName)}</span>
            <span className={styles.lMid}>
              <b>{d.agentName}</b>
              <small>{d.branchName || '—'} · {formatNumber(d.pendingCount || 0)} due</small>
            </span>
            <span className={styles.lAmt} style={{ fontSize: 14 }}>{formatUGXShort(d.pendingAmount || 0)}</span>
          </div>
        ))}
        {duesByAgent.length === 0 && <p className={styles.scoreNote}>No pending dues — every commission is settled.</p>}
        {duesByAgent.length > MAX_DUES && (
          <p className={styles.ver} style={{ marginTop: 10 }}>Showing top {MAX_DUES} of {formatNumber(duesByAgent.length)}</p>
        )}
      </section>

      {/* Settlement history */}
      {settlements.length > 0 && (
        <section className={styles.card} aria-label="Recent settlements">
          <header className={styles.cardHd}><h3>Recent settlements</h3></header>
          {settlements.map((st) => (
            <div key={st.id} className={styles.lrow} style={{ cursor: 'default' }}>
              <span className={styles.lMid}>
                <b>{st.agentName}</b>
                <small>{st.branchName || '—'} · {formatNumber(st.lineCount || 0)} lines{st.paidDate ? ` · ${formatDate(st.paidDate)}` : ''}</small>
              </span>
              <span className={`${styles.lAmt} ${styles.lAmtPos}`} style={{ fontSize: 14 }}>{formatUGXShort(st.paidAmount || 0)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
