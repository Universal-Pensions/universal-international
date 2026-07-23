import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEntity } from '../../hooks/useEntity';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './distributorMobile.module.css';

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
function subBalance(s) {
  return (s.totalContributions || 0) - (s.totalWithdrawals || 0);
}

/**
 * SubscriberDetailMobile — one subscriber (route
 * /dashboard/subscribers/:subscriberId). Fetches the subscriber by id
 * (useEntity → the RLS-scoped `subscribers` read with balances), so deep links
 * and refreshes work. The list hands the row over via router state for an
 * instant first paint while the fetch refreshes underneath.
 */
export default function SubscriberDetailMobile() {
  const { subscriberId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useEntity('subscriber', subscriberId);
  const sub = data ?? state?.sub ?? null;

  if (isError && !sub) {
    return <ErrorCard title="We couldn't load this subscriber" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !sub) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }
  if (!sub) {
    return (
      <div className={styles.empty}>
        <b>Subscriber not found</b>
        <p>They may be outside your network, or the link is out of date.</p>
        <button type="button" className={`${styles.btn} ${styles.btnSec}`} style={{ marginTop: 14 }} onClick={() => navigate('/dashboard/subscribers')}>
          Go to subscribers
        </button>
      </div>
    );
  }

  const isActive = !!sub.isActive;
  const kyc = sub.kycStatus || 'complete';
  const products = Array.isArray(sub.productsHeld) ? sub.productsHeld : [];

  return (
    <>
      {/* Profile */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Subscriber">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(sub.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.acctNm}>{sub.name}</div>
            <div className={styles.acctMt}>{sub.phone || '—'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
          <span className={`${styles.pill} ${kyc === 'complete' ? styles.ok : kyc === 'pending' ? styles.warn : styles.bad}`}>
            <i />KYC {kyc}
          </span>
        </div>
      </section>

      {/* KPI grid */}
      <div className={styles.mGrid}>
        <div className={styles.mCell}><div className={styles.lbl}>Balance</div><div className={styles.v}>{formatUGX(subBalance(sub))}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Contributions</div><div className={styles.v}>{formatUGX(sub.totalContributions || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Withdrawals</div><div className={styles.v}>{formatUGX(sub.totalWithdrawals || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Registered</div><div className={styles.v} style={{ fontSize: 14 }}>{sub.registeredDate ? formatDate(sub.registeredDate) : '—'}</div></div>
      </div>

      {/* Personal info */}
      <section className={styles.card} aria-label="Personal information">
        <header className={styles.cardHd}><h3>Personal information</h3></header>
        {sub.gender && <div className={styles.kv}><span className={styles.kvK}>Gender</span><span className={styles.kvV}>{sub.gender}</span></div>}
        {sub.age != null && <div className={styles.kv}><span className={styles.kvK}>Age</span><span className={styles.kvV}>{sub.age}</span></div>}
        {sub.occupation && <div className={styles.kv}><span className={styles.kvK}>Occupation</span><span className={styles.kvV}>{sub.occupation}</span></div>}
        {sub.email && <div className={styles.kv}><span className={styles.kvK}>Email</span><span className={styles.kvV}>{sub.email}</span></div>}
      </section>

      {/* Products */}
      {products.length > 0 && (
        <section className={styles.card} aria-label="Products held">
          <header className={styles.cardHd}><h3>Products held</h3></header>
          <div className={styles.actHead}>
            {products.map((p) => (
              <span key={typeof p === 'string' ? p : p.name || p.id} className={styles.tag}>
                {typeof p === 'string' ? p : (p.name || p.type || 'Product')}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
