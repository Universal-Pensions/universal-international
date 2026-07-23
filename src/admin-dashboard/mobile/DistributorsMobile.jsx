import { NavLink } from 'react-router-dom';
import { useAllEntities, usePlatformOverview } from '../../hooks/useEntity';
import { formatNumber, formatUGXShort } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

const ChevIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

/**
 * DistributorsMobile — the admin's Distributors tab (route
 * /dashboard/distributors). Lists the platform's distributor operators (there
 * are no per-distributor metrics in the schema, so the KPI strip is platform-wide
 * from usePlatformOverview). Rows open a profile detail.
 */
export default function DistributorsMobile() {
  const { data: distributors = [], isLoading, isError, error, refetch } = useAllEntities('distributor');
  const { data: platform = {} } = usePlatformOverview();

  if (isError) {
    return <ErrorCard title="We couldn't load distributors" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && distributors.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      {/* Platform strip (no per-distributor metrics exist) */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Platform summary">
        <div className={styles.statStrip}>
          <div><b>{formatNumber(platform.distributors || distributors.length)}</b><small>Distributors</small></div>
          <div><b>{formatNumber(platform.branches || 0)}</b><small>Branches</small></div>
          <div><b>{formatUGXShort(platform.aum || 0)}</b><small>Funds</small></div>
        </div>
      </section>

      <section className={styles.card} aria-label="Distributor list">
        {distributors.map((d) => {
          const isActive = (d.status || 'active') !== 'inactive';
          return (
            <NavLink to={`/dashboard/distributors/${d.id}`} key={d.id} className={styles.lrow}>
              <span className={styles.av} aria-hidden="true">{initials(d.name)}</span>
              <span className={styles.lMid}>
                <b>{d.name}</b>
                <small>{d.managerName || '—'}{d.managerPhone ? ` · ${d.managerPhone}` : ''}</small>
              </span>
              <span className={styles.lEnd}>
                <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
              </span>
              <span className={styles.chev}>{ChevIcon}</span>
            </NavLink>
          );
        })}
        {distributors.length === 0 && (
          <div className={styles.empty}><b>No distributors</b><p>No distributor operators on the platform yet.</p></div>
        )}
      </section>
    </>
  );
}
