import { NavLink } from 'react-router-dom';
import { usePlatformOverview } from '../../hooks/useEntity';
import { formatNumber } from '../../utils/currency';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

const ChevIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const BranchesIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" /><path d="M15 9h3a2 2 0 0 1 2 2v10M2 21h20M8 7h2M8 11h2M8 15h2" />
  </svg>
);
const AgentsIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const SubscribersIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" />
  </svg>
);

/**
 * AdminNetworkMobile — the "Network" bottom-tab hub (route /dashboard/network).
 * Drills into the shared distributor network surfaces (Branches / Agents /
 * Subscribers) which show everything under admin RLS.
 */
export default function AdminNetworkMobile() {
  const { data: p = {} } = usePlatformOverview();

  const rows = [
    { to: '/dashboard/branches', label: 'Branches', sub: 'Sub-distributor entities', count: p.branches, icon: BranchesIcon, tint: styles.tintIndigo },
    { to: '/dashboard/agents', label: 'Agents', sub: 'Field onboarding staff', count: p.agents, icon: AgentsIcon, tint: styles.tintTeal },
    { to: '/dashboard/subscribers', label: 'Subscribers', sub: 'Members & balances', count: p.totalSubscribers, icon: SubscribersIcon, tint: styles.tintSoft },
  ];

  return (
    <section className={styles.card} aria-label="Network">
      <header className={styles.cardHd}><h3>Network</h3><span className={styles.tag}>Platform-wide</span></header>
      {rows.map((r) => (
        <NavLink to={r.to} key={r.to} className={styles.lrow}>
          <span className={`${styles.lIc} ${r.tint}`} aria-hidden="true">{r.icon}</span>
          <span className={styles.lMid}><b>{r.label}</b><small>{r.sub}</small></span>
          <span className={styles.attnNum}>{formatNumber(r.count || 0)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </NavLink>
      ))}
    </section>
  );
}
