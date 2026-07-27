import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { useAllEmployersMetrics, useEmployees, useEmployer, useSetEmployerStatus } from '../../hooks/useEmployer';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber, formatUGX, formatUGXShort } from '../../utils/currency';
import { getInitials } from '../../utils/dashboard';
import { Icons } from '../../dashboard/shared/Icons';
import KpiCard from '../../dashboard/shared/KpiCard';
import Modal from '../../components/Modal';
import styles from '../adminPanels.module.css';
import detail from './ViewEmployerDetail.module.css';

/**
 * Admin: single-employer DETAIL panel — opened by clicking an employer in the map
 * district drill-down's Employers tab. Adopts the branch detail's design language
 * (ViewBranches.jsx): a status pill, a 2×2 glass icon-KPI grid (Members / Active
 * Rate / AUM / Contributed), a glass contact card (HR/admin from the employers
 * row), a "Scheme Summary" glass card (Insured / Employer- vs Employee-funded /
 * payroll cadence), and a polished member roster (tagged subscribers). Sections
 * the employer has no honest data for — health score/rank, monthly-contribution
 * chart, activity, commissions — are intentionally omitted (employers are funders,
 * not savers). Geo-spread employers (emp-002..007) have balances but no
 * contribution history, so Contributed / Insured read 0 — rendered gracefully.
 */
export default function ViewEmployerDetail() {
  const { viewEmployerDetailOpen, setViewEmployerDetailOpen, detailEmployerId } = useAdminPanel();
  const { data: employers = [] } = useAllEmployersMetrics();
  const { data: members = [], isLoading } = useEmployees(detailEmployerId);
  // Contact info lives on the `employers` row (not the metrics rollup); the admin
  // reads it under the employer-family SELECT RLS (0049). Resolves independently.
  const { data: profile } = useEmployer(detailEmployerId);
  const setStatus = useSetEmployerStatus();
  const { addToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const emp = employers.find((e) => e.id === detailEmployerId) || null;
  const isInactive = (emp?.status ?? profile?.status) === 'inactive';

  // Derived KPI + scheme figures (guard divide-by-zero / negative drift).
  const headcount = emp?.headcount ?? 0;
  const activeCount = emp?.activeCount ?? 0;
  const activeRate = headcount > 0 ? Math.round((activeCount / headcount) * 100) : 0;
  const totalContrib = emp?.totalContributions ?? 0;
  const employerFunded = emp?.employerContributions ?? 0;
  const employeeFunded = Math.max(0, totalContrib - employerFunded);
  const cadence = emp?.payrollCadence
    ? emp.payrollCadence.charAt(0).toUpperCase() + emp.payrollCadence.slice(1)
    : '—';
  const hasContact = Boolean(
    profile && (profile.contactName || profile.contactPhone || profile.contactEmail),
  );

  useEffect(() => {
    if (!viewEmployerDetailOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setViewEmployerDetailOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewEmployerDetailOpen, setViewEmployerDetailOpen]);

  const close = () => setViewEmployerDetailOpen(false);

  async function handleConfirm() {
    if (!emp) return;
    const next = isInactive ? 'active' : 'inactive';
    try {
      await setStatus.mutateAsync({ id: emp.id, status: next });
      addToast('success', next === 'active' ? 'Employer reactivated.' : 'Employer deactivated.');
      setConfirmOpen(false);
    } catch (err) {
      addToast('error', err?.message || 'Could not update status.');
    }
  }

  return (
    <>
      <AnimatePresence>
        {viewEmployerDetailOpen && (
          <motion.div
            key="ved-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0, pointerEvents: 'auto' }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            onClick={close}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewEmployerDetailOpen && (
          <motion.div
            key="ved-panel"
            className={styles.panel}
            initial={{ x: '100%' }}
            animate={{ x: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            exit={{ x: '100%', transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <button className={styles.backBtn} onClick={close} aria-label="Back">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>{emp?.name || 'Employer'}</h2>
                  <p className={styles.subtitle}>
                    {[emp?.sector, emp?.district].filter(Boolean).join(' · ') || 'No sector set'}
                  </p>
                </div>
                <button className={styles.closeBtn} onClick={close} aria-label="Close">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={styles.body}>
              <div className={detail.detailContent}>
                {/* Status + admin deactivate/reactivate. Deactivating resets every
                    member to self-onboarded (they stay active). */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span className={detail.statusBadge} data-status={isInactive ? 'inactive' : 'active'}>
                    <span className={detail.statusDot} data-status={isInactive ? 'poor' : 'good'} />
                    {isInactive ? 'Deactivated' : 'Active'}
                  </span>
                  {emp && (
                    <button
                      type="button"
                      className={isInactive ? styles.activateBtn : styles.deactivateBtn}
                      onClick={() => setConfirmOpen(true)}
                    >
                      {isInactive ? 'Reactivate employer' : 'Deactivate employer'}
                    </button>
                  )}
                </div>

                {/* KPI tiles (2×2) — glass icon cards, mirroring the branch card. */}
                <div className={detail.kpiRow}>
                  <KpiCard icon={Icons.subscribers} label="Members" value={formatNumber(headcount)} />
                  <KpiCard icon={Icons.activeRate} label="Active Rate" value={activeRate} suffix="%" />
                  <KpiCard icon={Icons.aum} label="AUM" value={formatUGX(emp?.totalBalance ?? 0)} />
                  <KpiCard icon={Icons.contributions} label="Contributed" value={formatUGX(totalContrib)} />
                </div>

                {/* Employer contact (HR / admin) — from the employers row. */}
                <div className={detail.section}>
                  <div className={detail.sectionHeader}>
                    <span className={detail.sectionTitle}>Employer Contact</span>
                  </div>
                  <div className={detail.adminCard}>
                    <div className={detail.adminAvatar}>
                      {getInitials(hasContact ? profile.contactName : emp?.name)}
                    </div>
                    <div className={detail.adminDetails}>
                      <div className={detail.adminName}>
                        {hasContact ? (profile.contactName || 'Contact') : 'No contact on file'}
                      </div>
                      {hasContact && profile.contactPhone && (
                        <div className={detail.adminRow}>
                          <span className={detail.adminRowIcon}>{Icons.phone}</span>
                          <span className={detail.adminRowText}>{profile.contactPhone}</span>
                        </div>
                      )}
                      {hasContact && profile.contactEmail && (
                        <div className={detail.adminRow}>
                          <span className={detail.adminRowIcon}>{Icons.email}</span>
                          <span className={detail.adminRowText}>{profile.contactEmail}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Scheme summary — honest employer figures (no commissions/score). */}
                <div className={detail.section}>
                  <div className={detail.sectionHeader}>
                    <span className={detail.sectionTitle}>Scheme Summary</span>
                  </div>
                  <div className={detail.infoCard}>
                    <div className={detail.infoRow}>
                      <span className={detail.infoLabel}>Insured</span>
                      <span className={detail.infoValue}>{formatNumber(emp?.insuredCount ?? 0)} members</span>
                    </div>
                    <div className={detail.infoRow}>
                      <span className={detail.infoLabel}>Employer-funded</span>
                      <span className={detail.infoValue}>{formatUGX(employerFunded)}</span>
                    </div>
                    <div className={detail.infoRow}>
                      <span className={detail.infoLabel}>Employee-funded</span>
                      <span className={detail.infoValue}>{formatUGX(employeeFunded)}</span>
                    </div>
                    <div className={detail.infoRow}>
                      <span className={detail.infoLabel}>Payroll cadence</span>
                      <span className={detail.infoValue}>{cadence}</span>
                    </div>
                  </div>
                </div>

                {/* Member roster */}
                <div className={detail.section}>
                  <div className={detail.sectionHeader}>
                    <span className={detail.sectionTitle}>Members ({formatNumber(members.length)})</span>
                  </div>
                  {isLoading ? (
                    <div className={styles.loading}><div className={styles.spinner} /></div>
                  ) : members.length === 0 ? (
                    <div className={styles.empty}>
                      <p className={styles.emptyText}>No members on this employer&rsquo;s roster yet.</p>
                    </div>
                  ) : (
                    <div className={detail.memberList}>
                      {members.map((m) => (
                        <div className={detail.memberItem} key={m.id}>
                          <div className={detail.memberAvatar}>{getInitials(m.name)}</div>
                          <div className={detail.memberInfo}>
                            <div className={detail.memberName}>{m.name}</div>
                            <div className={detail.memberMeta}>
                              <span className={detail.memberStatus} data-status={m.isActive ? 'active' : 'inactive'} />
                              <span>{m.isActive ? 'Active' : 'Inactive'}</span>
                              {m.occupation && (<><span>&middot;</span><span>{m.occupation}</span></>)}
                            </div>
                          </div>
                          <span className={detail.memberValue}>{formatUGXShort(m.netBalance ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {emp && (
        <Modal
          open={confirmOpen}
          onClose={() => { if (!setStatus.isPending) setConfirmOpen(false); }}
          title={isInactive ? `Reactivate ${emp.name}?` : `Deactivate ${emp.name}?`}
          size="sm"
          dismissOnBackdrop={!setStatus.isPending}
        >
          <div className={styles.confirmDialog}>
            <h3 className={styles.confirmTitle}>{isInactive ? `Reactivate ${emp.name}?` : `Deactivate ${emp.name}?`}</h3>
            <p className={styles.confirmBody}>
              {isInactive
                ? 'This reactivates the employer and puts every member that was reset to self-onboarded back on its roster.'
                : `This resets ${formatNumber(headcount)} member${headcount === 1 ? '' : 's'} to self-onboarded — they stay active and keep their pension, but leave this employer's roster. The employer can't log in or invite new members until reactivated.`}
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setConfirmOpen(false)} disabled={setStatus.isPending}>
                Cancel
              </button>
              <button
                type="button"
                className={isInactive ? styles.activateBtn : styles.deactivateBtn}
                onClick={handleConfirm}
                disabled={setStatus.isPending}
              >
                {setStatus.isPending ? 'Working…' : isInactive ? 'Reactivate' : 'Deactivate'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
