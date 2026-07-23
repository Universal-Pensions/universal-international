import { useParams } from 'react-router-dom';
import { useAllEntities } from '../../hooks/useEntity';
import { formatDate } from '../../utils/date';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

const PhoneIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
const InfoIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

/**
 * DistributorDetailMobile — one distributor (route
 * /dashboard/distributors/:distributorId). Profile only — the schema doesn't
 * partition network figures by distributor, and deactivation (a cascading action)
 * stays on the desktop. Read-only.
 */
export default function DistributorDetailMobile() {
  const { distributorId } = useParams();
  const { data: distributors = [], isLoading, isError, error, refetch } = useAllEntities('distributor');
  const distributor = distributors.find((d) => d.id === distributorId);

  if (isError) {
    return <ErrorCard title="We couldn't load this distributor" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !distributor) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }
  if (!distributor) {
    return <div className={styles.empty}><b>Distributor not found</b><p>It may have been removed.</p></div>;
  }

  const isActive = (distributor.status || 'active') !== 'inactive';

  return (
    <>
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Distributor">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(distributor.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.acctNm}>{distributor.name}</div>
            <div className={styles.acctMt}>Distributor · network operator</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
          {distributor.createdAt && <span className={styles.tag}>Since {formatDate(distributor.createdAt)}</span>}
        </div>
      </section>

      {distributor.managerName && (
        <section className={styles.card} aria-label="Administrator">
          <header className={styles.cardHd}><h3>Administrator</h3></header>
          <div className={styles.acct}>
            <div className={styles.acctAv} aria-hidden="true">{initials(distributor.managerName)}</div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.acctNm} style={{ fontSize: 16 }}>{distributor.managerName}</div>
              {distributor.managerPhone && (
                <div className={styles.acctMt} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{PhoneIcon} {distributor.managerPhone}</div>
              )}
              {distributor.managerEmail && <div className={styles.acctMt}>{distributor.managerEmail}</div>}
            </div>
          </div>
        </section>
      )}

      <div className={styles.callout}>
        <span className={styles.calloutIc} aria-hidden="true">{InfoIcon}</span>
        <div>
          <b>Network figures are platform-wide</b>
          <p>The platform isn&apos;t partitioned by distributor, so per-operator totals aren&apos;t available. Deactivate a distributor from the desktop dashboard.</p>
        </div>
      </div>
    </>
  );
}
