import { productName } from '../../../utils/policies';
import styles from './PolicyChips.module.css';

/**
 * PolicyChips — agent-facing list of a subscriber's insurance policies as light
 * chips ("Life cover · Active"). PRODUCT + STATUS ONLY: agents must never see a
 * subscriber's cover amount or premium, so this renders neither. The agent-facing
 * `subscriber.policies` list can include EXPIRED entries — the service does NOT
 * filter to active products only (corrected 2026-08-25; this comment previously
 * claimed it did) — each entry is `{ product, status }`, and the Active/Expired
 * ternary below is what actually distinguishes them.
 *
 * Shared by the mobile + desktop subscriber-detail forks so they can't drift.
 * Default export only (no helper exports) to keep react-refresh happy.
 */
export default function PolicyChips({ policies = [], emptyText = 'No active cover' }) {
  if (!policies.length) {
    return <p className={styles.empty}>{emptyText}</p>;
  }
  return (
    <ul className={styles.chips}>
      {policies.map((p) => (
        <li key={p.product} className={styles.chip} data-status={p.status}>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>{productName(p.product)}</span>
          <span className={styles.status}>{p.status === 'active' ? 'Active' : 'Expired'}</span>
        </li>
      ))}
    </ul>
  );
}
