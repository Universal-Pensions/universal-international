import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAllEmployersMetrics, useEmployer, useEmployees } from '../../hooks/useEmployer';
import { formatNumber, formatUGX, formatUGXShort } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

const PhoneIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
function titleCase(s = '') {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

/**
 * EmployerDetailMobile — one employer (route /dashboard/employers/:employerId).
 * KPI grid + contact + scheme summary + staff roster. Same three hooks the
 * desktop ViewEmployerDetail uses (useAllEmployersMetrics for KPIs, useEmployer
 * for contact, useEmployees for the roster).
 */
export default function EmployerDetailMobile() {
  const { employerId } = useParams();
  const { data: employers = [], isLoading, isError, error, refetch } = useAllEmployersMetrics();
  const { data: profile } = useEmployer(employerId);
  const { data: employees = [] } = useEmployees(employerId);

  const emp = useMemo(() => employers.find((e) => e.id === employerId), [employers, employerId]);
  const roster = useMemo(
    () => [...employees].sort((a, b) => (b.netBalance || 0) - (a.netBalance || 0)),
    [employees],
  );

  if (isError) {
    return <ErrorCard title="We couldn't load this employer" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !emp) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }
  if (!emp) {
    return <div className={styles.empty}><b>Employer not found</b><p>It may have been removed.</p></div>;
  }

  const isActive = (emp.status || 'active') !== 'inactive';
  const activeRate = emp.headcount > 0 ? Math.round((emp.activeCount / emp.headcount) * 100) : 0;
  const employeeFunded = Math.max(0, (emp.totalContributions || 0) - (emp.employerContributions || 0));

  return (
    <>
      {/* Identity */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Employer">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(emp.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.acctNm}>{emp.name}</div>
            <div className={styles.acctMt}>{[emp.sector, emp.district].filter(Boolean).join(' · ') || 'Employer'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
          {emp.payrollCadence && <span className={styles.tag}>{titleCase(emp.payrollCadence)} payroll</span>}
        </div>
      </section>

      {/* KPIs */}
      <div className={styles.mGrid}>
        <div className={styles.mCell}><div className={styles.lbl}>Members</div><div className={styles.v}>{formatNumber(emp.headcount || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Active rate</div><div className={styles.v}>{activeRate}%</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Funds under mgmt</div><div className={styles.v}>{formatUGX(emp.totalBalance || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Contributions</div><div className={styles.v}>{formatUGX(emp.totalContributions || 0)}</div></div>
      </div>

      {/* Contact */}
      {profile && (profile.contactName || profile.contactPhone || profile.contactEmail) && (
        <section className={styles.card} aria-label="Contact">
          <header className={styles.cardHd}><h3>Contact</h3></header>
          {profile.contactName && <div className={styles.kv}><span className={styles.kvK}>Name</span><span className={styles.kvV}>{profile.contactName}</span></div>}
          {profile.contactPhone && (
            <div className={styles.kv}><span className={styles.kvK}>Phone</span><span className={styles.kvV} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{PhoneIcon}{profile.contactPhone}</span></div>
          )}
          {profile.contactEmail && <div className={styles.kv}><span className={styles.kvK}>Email</span><span className={styles.kvV}>{profile.contactEmail}</span></div>}
          {profile.registrationNo && <div className={styles.kv}><span className={styles.kvK}>Reg. no.</span><span className={styles.kvV}>{profile.registrationNo}</span></div>}
        </section>
      )}

      {/* Scheme summary */}
      <section className={styles.card} aria-label="Scheme summary">
        <header className={styles.cardHd}><h3>Scheme summary</h3></header>
        <div className={styles.kv}><span className={styles.kvK}>Insured members</span><span className={styles.kvV}>{formatNumber(emp.insuredCount || 0)}</span></div>
        <div className={styles.kv}><span className={styles.kvK}>Employer-funded</span><span className={styles.kvV}>{formatUGX(emp.employerContributions || 0)}</span></div>
        <div className={styles.kv}><span className={styles.kvK}>Employee-funded</span><span className={styles.kvV}>{formatUGX(employeeFunded)}</span></div>
      </section>

      {/* Roster */}
      <section className={styles.card} aria-label="Staff roster">
        <header className={styles.cardHd}><h3>Staff</h3><span className={styles.tag}>{formatNumber(roster.length)}</span></header>
        {roster.slice(0, 40).map((e) => {
          const active = !!e.isActive;
          return (
            <div key={e.id} className={styles.lrow} style={{ cursor: 'default' }}>
              <span className={styles.av} aria-hidden="true">{initials(e.name)}</span>
              <span className={styles.lMid}>
                <b>{e.name}</b>
                <small>{e.occupation || '—'}</small>
              </span>
              <span className={styles.lEnd}>
                <span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(e.netBalance || 0)}</span>
                <span className={styles.stBadge} data-status={active ? 'active' : 'inactive'}>{active ? 'Active' : 'Inactive'}</span>
              </span>
            </div>
          );
        })}
        {roster.length === 0 && <p className={styles.scoreNote}>No staff on file.</p>}
        {roster.length > 40 && <p className={styles.ver} style={{ marginTop: 10 }}>Showing 40 of {formatNumber(roster.length)}</p>}
      </section>
    </>
  );
}
