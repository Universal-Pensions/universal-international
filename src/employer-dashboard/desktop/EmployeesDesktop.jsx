// EmployeesDesktop — the staff roster page for the employer DESKTOP dashboard.
// Mirrors OverviewDesktop's structure (ui.stack → PageHead → MetricRow → cards)
// and ViewEmployees' search/filter logic. The roster shows counts / compensation
// / funding / status ONLY — per-member pension balances are private and never
// surfaced to the employer. Each row links to the member detail at
// /dashboard/employees/{id}. Onboard reuses the shipped slide-in flow via
// useEmployerPanel (mounted at the shell root); Pending-KYC is a routed page.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useEmployerPanel } from '../../contexts/EmployerPanelContext';
import { useEmployer, useEmployerMetrics, useEmployees, usePendingInvites } from '../../hooks/useEmployer';
import { formatUGX, formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { contributionParticipants } from '../../utils/contributionModel';
import { PageHead, MetricRow, Tile, Avatar, StatusBadge, Btn, Tag } from './ui';
import {
  employeesIcon,
  checkIcon,
  pendingIcon,
  mailIcon,
  handAddIcon,
  searchIcon,
} from './icons';
import ui from './ui.module.css';
import styles from './EmployeesDesktop.module.css';

/**
 * True when an invite is still worth chasing (A14-003). Duplicated (not
 * imported) from desktop/OverviewDesktop.jsx's `isInviteAwaiting`, which
 * itself duplicates kyc/usePendingKycNudge.js's module-private
 * `splitInvitesByExpiry` — same rule, a third time, for the same reason that
 * comment gives: no `expiresAt` means the invite never expires (still
 * awaiting); an `expiresAt` at or before `now` means it has lapsed, and a
 * lapsed invite can't be completed (the public `/invite/:token` route itself
 * refuses an expired token). Before this fix, `pendingInvites.length` counted
 * expired invites as "awaiting sign-up" here, while the Pending KYC page
 * (which already applied this split) correctly said "0 awaiting · 4 lapsed"
 * for the same data — a demo dead-end ("chase them" pointing at a page with
 * nothing to chase).
 */
export function isInviteAwaiting(invite, now = Date.now()) {
  const exp = invite?.expiresAt ? new Date(invite.expiresAt).getTime() : Infinity;
  return !(Number.isFinite(exp) && exp <= now);
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Inactive' },
];

// Short funding chip for a member row: WHO puts money in. The funding setup is
// company-wide (Issue 2), so it comes from the employer's contribution config —
// two independent legs, either of which may be nothing. The chip has room for
// who, not for how much; the two concrete figures live on the Overview funding
// card and on each member's detail page. Same wording as the Overview card tag.
const FUNDING_TAG = {
  none: 'Not set up',
  company: 'You only',
  staff: 'Staff only',
  both: 'Staff + you',
};

function fundingTag(cfg) {
  return FUNDING_TAG[contributionParticipants(cfg)];
}

export default function EmployeesDesktop() {
  const { employerId } = useEmployerScope();
  const navigate = useNavigate();
  const { setOnboardOpen } = useEmployerPanel();

  const { data: employer } = useEmployer(employerId);
  const { data: metrics = {} } = useEmployerMetrics(employerId);
  const { data: employees = [], isLoading } = useEmployees(employerId);
  const { data: pendingInvites = [] } = usePendingInvites(employerId);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const headcount = metrics.headcount || employees.length || 0;
  const active = metrics.active
    || employees.filter((e) => e.status === 'active').length
    || 0;
  const inactive = metrics.suspended != null
    ? metrics.suspended
    : employees.filter((e) => e.status === 'suspended').length;
  const pendingKyc = pendingInvites.filter((inv) => isInviteAwaiting(inv)).length;

  // Inline filter (search by name/phone + status pill) — mirrors ViewEmployees.
  const q = search.trim().toLowerCase();
  const filtered = employees.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (!q) return true;
    return (
      (e.name || '').toLowerCase().includes(q)
      || (e.phone || '').toLowerCase().includes(q)
    );
  });

  // Single company-wide funding setup (Issue 2) — its short chip label is shared
  // by every active row (there is no per-employee override in this model).
  const companyFundingTag = fundingTag(employer?.defaultContributionConfig);

  const isCold = isLoading && employees.length === 0;

  return (
    <div className={ui.stack}>
      <PageHead
        eyebrow="Workforce"
        title="Employees"
        sub="Your staff roster — everyone enrolled in the company pension."
      />

      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={employeesIcon(18)}
          label="Headcount"
          value={formatNumber(headcount)}
          sub="Everyone on the roster"
        />
        <Tile
          accent="green"
          icon={checkIcon(18)}
          label="Active"
          value={formatNumber(active)}
          sub="Saving every payroll"
        />
        <Tile
          accent="indigoSoft"
          icon={pendingIcon(18)}
          label="Inactive"
          value={formatNumber(inactive)}
          sub="Paused · not on runs"
        />
        <Tile
          accent="amber"
          icon={mailIcon(18)}
          label="Pending invites"
          value={formatNumber(pendingKyc)}
          sub={pendingKyc > 0 ? 'Invited · awaiting sign-up' : 'No pending invites'}
        />
      </MetricRow>

      {/* Toolbar: search + status pills + onboard */}
      <div className={ui.toolrow}>
        <div className={ui.search}>
          <span className={ui.searchIcon}>{searchIcon(18)}</span>
          <input
            type="search"
            className={ui.searchInput}
            placeholder="Search staff by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search staff by name or phone"
          />
        </div>
        <div className={ui.filters} role="group" aria-label="Filter staff by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`${ui.filter} ${statusFilter === f.value ? ui.filterActive : ''}`}
              aria-pressed={statusFilter === f.value}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className={styles.grow} />
        <Btn variant="primary" onClick={() => setOnboardOpen(true)}>
          {handAddIcon(16)}
          Onboard employee
        </Btn>
      </div>

      {/* Pending-invite context note → the routed Pending KYC page */}
      {pendingKyc > 0 && (
        <div className={ui.note}>
          <span className={ui.noteIcon}>{pendingIcon(16)}</span>
          <span>
            {formatNumber(pendingKyc)} {pendingKyc === 1 ? 'person' : 'people'} invited
            and awaiting sign-up.
          </span>
          <button type="button" className={styles.noteCta} onClick={() => navigate('/dashboard/pending-kyc')}>
            Review in Pending KYC →
          </button>
        </div>
      )}

      {/* Roster table — counts / compensation / funding / status; NO balances. */}
      <div className={ui.tableCard}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Member</th>
              <th className={ui.num}>Compensation / mo</th>
              <th>Funding</th>
              <th>Joined</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isCold ? (
              <tr>
                <td colSpan={5} className={styles.stateCell}>Loading your staff…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.stateCell}>
                  {employees.length === 0
                    ? 'No staff on your roster yet — onboard an employee to get started.'
                    : 'No staff match your search or filter.'}
                </td>
              </tr>
            ) : (
              filtered.map((emp) => {
                const isActive = emp.status === 'active';
                return (
                  <tr key={emp.id} className={ui.rowInteractive}>
                    <td>
                      <Link to={`/dashboard/employees/${emp.id}`} className={styles.memberLink}>
                        <span className={ui.member}>
                          <Avatar name={emp.name} />
                          <span>
                            <span className={ui.tName}>{emp.name}</span>
                            <small className={styles.memberSub}>{emp.phone}</small>
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className={ui.num}>{formatUGX(emp.compensation, { compact: false })}</td>
                    <td>
                      {isActive ? <Tag>{companyFundingTag}</Tag> : <Tag>Paused</Tag>}
                    </td>
                    <td>{emp.joinedDate ? formatDate(emp.joinedDate) : '—'}</td>
                    <td>
                      <StatusBadge tone={isActive ? 'active' : 'inactive'}>
                        {isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {!isCold && filtered.length > 0 && (
          <div className={ui.tableFoot}>
            <span>
              Showing {formatNumber(filtered.length)} of {formatNumber(employees.length)} staff
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
