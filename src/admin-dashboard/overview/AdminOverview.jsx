import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDashboard } from '../../contexts/DashboardContext';
import { useAdminPanel } from '../../contexts/AdminPanelContext';
import {
  usePlatformOverview,
  useEntityMetrics,
  useChildren,
  useChildrenMetrics,
  useTopEntities,
  useEmployerGeoRollup,
} from '../../hooks/useEntity';
import { useAdminAttention } from '../../hooks/useAdminAttention';
import { usePlatformTicketMetrics } from '../../hooks/useTickets';
import { formatUGX, formatNumber } from '../../utils/currency';
import { EASE_OUT_EXPO as EASE } from '../../utils/motion';
import MiniChart from '../../dashboard/shared/MiniChart';
import MetricHero from '../../components/MetricHero/MetricHero';
import ErrorCard from '../../components/feedback/ErrorCard';
import NeedsAttentionCard, { NeedsAttentionPill } from './NeedsAttentionCard';
import {
  computeAdminAttention,
  countToAction,
  attentionPanelDesktop,
  REUSES_EXISTING_PANEL,
} from './adminAttentionDerive';
// Reuse the distributor overview's flat white/indigo aesthetic verbatim — the
// styling is role-blind (tiles / split / cards / gauge / tables); only the data
// framing below is re-scoped to the platform-wide admin picture.
import styles from '../../dashboard/overview/DistributorOverview.module.css';
// The Needs-attention card's own module carries the one admin-only class the
// shared overview module must not gain — see the note above .cardAccent there.
import attn from './NeedsAttentionCard.module.css';

/* ── Inline icons (a small kit beyond shared/Icons.jsx) ───────────────────── */
const svg = (d, o = {}) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width={o.w || 20} height={o.w || 20}>
    {d}
  </svg>
);
const IC = {
  wallet: svg(<>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
    <path d="M16 12h2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M2.5 9h19" stroke="currentColor" strokeWidth="1.75" />
  </>),
  coins: svg(<>
    <ellipse cx="8" cy="7" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M2.5 7v5c0 1.4 2.46 2.5 5.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <ellipse cx="16" cy="15" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10.5 15v2c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>),
  person: svg(<>
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
    <path d="M5 21v-1a7 7 0 0114 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  employees: svg(<>
    <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.75" />
    <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <circle cx="18" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.75" />
    <path d="M21 21v-1.5a3 3 0 00-3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  building: svg(<>
    <path d="M3 21h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M5 21V7l7-4 7 4v14" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <rect x="9" y="13" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.75" />
  </>),
  network: svg(<>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    <circle cx="12" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="20.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="3.5" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="20.5" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M12 5v4M12 15v4M5 12h4M15 12h4" stroke="currentColor" strokeWidth="1.5" />
  </>),
  company: svg(<>
    <rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
    <path d="M3 10h18" stroke="currentColor" strokeWidth="1.75" />
    <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.75" />
  </>),
  analytics: svg(<>
    <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 14l4-4 4 4 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  alert: svg(<>
    <path d="M12 3l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  chevron: (w = 14) => svg(<path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />, { w }),
  up: (w = 12) => svg(<path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />, { w }),
  down: (w = 12) => svg(<path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />, { w }),
};

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function scoreQuality(s) {
  if (s >= 75) return 'Strong';
  if (s >= 60) return 'Good';
  if (s >= 45) return 'Fair';
  return 'Needs work';
}

function Tile({ tone, icon, label, value, sub, subTone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={styles.tile} data-tone={tone} data-clickable={onClick ? 'true' : undefined} onClick={onClick}>
      <span className={styles.tileIcon}>{icon}</span>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {sub != null && <span className={styles.tileSub} data-tone={subTone}>{sub}</span>}
    </Tag>
  );
}

/**
 * Rich national dashboard landing for the ADMIN in dash mode (country level).
 * Mirrors DistributorOverview's layout, but leads with the platform-wide picture
 * the admin owns: TRUE subscriber totals (distributor + employer + direct), the
 * Distributors / Employers channels, and platform money. Region/district drill in
 * dash mode still falls back to the shared OverlayPanel (via the shell).
 */
export default function AdminOverview() {
  const { drillDown, setViewSubscribersOpen, setViewAgentsOpen, setViewBranchesOpen, setDrillTargetBranchId, setDrillTargetAgentId, setViewTicketsOpen } = useDashboard();
  const { setViewDistributorsOpen, setViewEmployersOpen, setViewAccessRequestsOpen, setAttentionType } = useAdminPanel();

  // A22-002 / A15-002: this is the ONLY query behind both the 4-tile hero AND
  // the health-score gauge below (aum/subs/agents/branches/health all read
  // off `platform`) — so its isLoading/isError/refetch guard both widgets. A
  // failed read used to fall straight through to `platform ?? {}` and every
  // field `?? 0`, rendering a confident "FUNDS UNDER MANAGEMENT —, 0
  // subscribers, Health Score 0 Needs work" with no error and no retry.
  const {
    data: platform,
    isLoading: isPlatformLoading,
    isError: isPlatformError,
    error: platformQueryError,
    refetch: refetchPlatform,
  } = usePlatformOverview();
  // ErrorCard would crash if handed the raw Supabase/PostgREST error (a plain
  // {message,code,details,hint} object, NOT an Error instance — verified
  // against node_modules/@supabase/postgrest-js's response handling) — it
  // renders `message` as a bare ReactNode child. Always extract the string.
  const platformErrorMessage = platformQueryError?.message || 'Something went wrong.';
  const { data: country } = useEntityMetrics('country', 'ug');
  const { data: regions = [] } = useChildren('country', 'ug');
  const { data: regionMetrics = {} } = useChildrenMetrics('country', 'ug');
  // Bounded server-side top-N (0077) — replaces the old whole agent + branch
  // collection pull + client-side sort just to render the table.
  const { data: topBranches = [] } = useTopEntities('branch', 'aum', 6);
  // Ten Needs-attention counts in one round-trip (0097), plus the ticket counts
  // that RPC cannot supply (ticketing has no Supabase tables — see
  // services/tickets.js getPlatformTicketMetrics).
  const { data: attention } = useAdminAttention();
  const { data: ticketMetrics } = usePlatformTicketMetrics();

  const p = platform ?? {};
  const c = country ?? {};

  // TRUE platform totals (incl. employer-onboarded subs), not the agent-tree
  // country rollup that undercounts them.
  const subs = p.totalSubscribers || 0;
  const active = p.activeSubscribers || 0;
  const activeRate = subs > 0 ? Math.round((active / subs) * 100) : 0;
  const aum = p.aum || 0;
  const contributions = p.totalContributions || 0;
  const agentCount = p.agents || 0;
  const branchCount = p.branches || 0;
  const distributorCount = p.distributors || 0;
  const employerCount = p.employers || 0;
  // The acquisition-channel split (viaDistributor / viaEmployer / direct) is no
  // longer read here — it only ever fed the deleted "Today's snapshot" card. It
  // remains on the get_platform_overview payload for the map-mode country card.

  const monthly = Array.isArray(c.monthlyContributions) ? c.monthlyContributions : [];
  const monthlyHasData = monthly.some((v) => v > 0);
  const thisMonth = monthly.length ? monthly[monthly.length - 1] : 0;
  const lastMonth = monthly.length > 1 ? monthly[monthly.length - 2] : 0;
  const monthChange = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

  // Network health = the platform active-contribution rate — the always-populated
  // health signal (the per-branch score mean is dragged down by zero-member
  // branches, and coverageRate isn't rolled up at country level).
  const health = activeRate;

  // `regionMetrics` counts ONLY the distributor channel (it walks the agent
  // tree). Employer-onboarded members have no agent, so a region served purely
  // by employers looked empty — the admin was reporting "Northern & Western
  // have no members" while the employer rollup showed 11 and 7 there. This is
  // the platform view, so a region is empty only when BOTH channels are zero.
  const { data: employerGeo } = useEmployerGeoRollup();
  const emptyRegions = useMemo(
    () => regions.filter((r) => (
      (regionMetrics[r.id]?.totalSubscribers ?? 0)
      + (employerGeo?.byRegion?.[r.id]?.subscribers ?? 0)
    ) === 0),
    [regions, regionMetrics, employerGeo],
  );
  // Inactive-branch count now rides along on get_admin_attention rather than
  // pulling the whole 316-row branch collection just to length a filter.
  const inactiveBranches = attention?.inactiveBranches ?? 0;

  const attentionItems = useMemo(
    () => computeAdminAttention(attention, {
      openComplaints: ticketMetrics?.openCount ?? 0,
      urgentComplaints: ticketMetrics?.urgentOpenCount ?? 0,
    }),
    [attention, ticketMetrics],
  );
  const toAction = countToAction(attentionItems);

  const openBranchList = () => { setDrillTargetBranchId(null); setViewBranchesOpen(true); };
  const openAgentList = () => { setDrillTargetAgentId(null); setViewAgentsOpen(true); };

  /* Desktop admin has no routes — the shell derives its page from boolean panel
     flags — so a Needs-attention row sets panel state rather than navigating.
     Two signals hand off to the purpose-built panel they already own (approve /
     deny, ticket threads) instead of the generic drill-down. */
  const openAttention = (item) => {
    const target = attentionPanelDesktop(item.type);
    if (target.panel === REUSES_EXISTING_PANEL.pendingAccessRequests) { setViewAccessRequestsOpen(true); return; }
    if (target.panel === REUSES_EXISTING_PANEL.pendingComplaints) { setViewTicketsOpen(true); return; }
    setAttentionType(target.attentionType);
  };

  const dash = health / 100;
  const CIRC = 2 * Math.PI * 54;

  return (
    <motion.div
      className={styles.root}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {/* ── Header ── */}
      <div className={styles.header}>
        <p className={styles.eyebrow}>Platform · National overview</p>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>National Platform</h1>
          <span className={styles.roleBadge}><span className={styles.roleDot} />Platform Admin</span>
        </div>
        <p className={styles.sub}>
          Universal Pensions — Uganda · {formatNumber(distributorCount)} {distributorCount === 1 ? 'distributor' : 'distributors'} · {formatNumber(employerCount)} {employerCount === 1 ? 'employer' : 'employers'} · {formatNumber(branchCount)} branches
        </p>
      </div>

      {/* ── KPI tiles ── */}
      <MetricHero
        isLoading={isPlatformLoading}
        isError={isPlatformError}
        error={platformErrorMessage}
        onRetry={refetchPlatform}
        errorTitle="We couldn't load the platform overview"
        loadingLabel="Loading platform overview…"
      >
        <Tile tone="indigo" icon={IC.wallet} label="Funds under management" value={formatUGX(aum)}
          sub={`${formatNumber(distributorCount)} ${distributorCount === 1 ? 'distributor' : 'distributors'} · ${formatNumber(employerCount)} ${employerCount === 1 ? 'employer' : 'employers'}`} />
        <Tile tone="green" icon={IC.coins} label="Contributions" value={formatUGX(contributions)}
          sub={monthChange != null
            ? <span className={styles.chg} data-dir={monthChange >= 0 ? 'up' : 'down'}>{monthChange >= 0 ? IC.up(11) : IC.down(11)}{Math.abs(monthChange)}% this month</span>
            : 'Platform-wide'} />
        <Tile tone="teal" icon={IC.person} label="Subscribers" value={formatNumber(subs)}
          sub={`${formatNumber(active)} active · ${activeRate}%`} onClick={() => setViewSubscribersOpen(true)} />
        <Tile tone="indigoSoft" icon={IC.employees} label="Agents" value={formatNumber(agentCount)}
          sub={`Across ${formatNumber(branchCount)} branches`} onClick={openAgentList} />
      </MetricHero>

      {/* ── Split ── */}
      <div className={styles.split}>
        <div className={styles.col}>
          {/* Health score */}
          <section className={styles.card}>
            <div className={styles.cardHead}><span className={styles.cardIc}>{IC.alert}</span>Platform Health Score</div>
            {/* A22-002 / A15-002: the gauge is a circular widget, not a
                label/value tile, so it doesn't fit MetricHero.Tile — it gets
                its own guard here, reusing the same ErrorCard MetricHero uses
                internally. Same query as the hero above, so isError/isLoading
                are already in scope. Evidence for this exact widget: "Health
                Score 0 Needs work" rendered with no message and no retry. */}
            {isPlatformError ? (
              <ErrorCard
                title="We couldn't load the health score"
                message={platformErrorMessage}
                onRetry={refetchPlatform}
              />
            ) : isPlatformLoading ? (
              <p className={styles.scoreText} role="status">Loading platform health…</p>
            ) : (
              <div className={styles.scoreRow}>
                <div className={styles.gauge}>
                  <svg width="128" height="128" viewBox="0 0 128 128">
                    <circle cx="64" cy="64" r="54" fill="none" stroke="var(--color-lavender)" strokeWidth="12" />
                    <circle cx="64" cy="64" r="54" fill="none" stroke="url(#aoGauge)" strokeWidth="12" strokeLinecap="round"
                      strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - dash)} transform="rotate(-90 64 64)" />
                    <defs>
                      <linearGradient id="aoGauge" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#5E63A8" /><stop offset="1" stopColor="#292867" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className={styles.gaugeMid}>
                    <div className={styles.gaugeNum}>{health}</div>
                    <div className={styles.gaugeQ}>{scoreQuality(health)}</div>
                  </div>
                </div>
                <div className={styles.scoreMeta}>
                  <div className={styles.scoreLabel}>Platform score · out of 100</div>
                  <div className={styles.scoreChips}>
                    <span className={styles.sChip} data-tone="active">{formatNumber(active)} active members</span>
                    <span className={styles.sChip}>{formatNumber(branchCount)} branches</span>
                  </div>
                  <p className={styles.scoreText}>
                    Driven by a {activeRate}% active-contribution rate across {formatNumber(subs)} members platform-wide.
                    {emptyRegions.length > 0
                      ? ` Biggest lever: coverage — ${emptyRegions.length} ${emptyRegions.length === 1 ? 'region has' : 'regions have'} branches and agents in place but no members yet.`
                      : ' Coverage spans every region.'}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Platform network — the admin's domain shortcuts. Sits under the
              health score rather than in the right column so that column can
              open with Needs attention, level with the score. */}
          <section className={styles.card}>
            <div className={styles.cardHead}><span className={styles.cardIc}>{IC.network}</span>Platform network</div>
            <div className={styles.attn}>
              <button className={styles.attnRow} onClick={() => setViewDistributorsOpen(true)}>
                <span className={styles.attnIc} data-tone="indigo">{IC.network}</span>
                <span className={styles.attnVal}>{formatNumber(distributorCount)}</span>
                <span className={styles.attnTx}><span className={styles.attnL}>{distributorCount === 1 ? 'Distributor' : 'Distributors'}</span><span className={styles.attnS}>Network operators across the platform</span></span>
                <span className={styles.attnGo}>Manage {IC.chevron()}</span>
              </button>
              <button className={styles.attnRow} onClick={() => setViewEmployersOpen(true)}>
                <span className={styles.attnIc} data-tone="indigo">{IC.company}</span>
                <span className={styles.attnVal}>{formatNumber(employerCount)}</span>
                <span className={styles.attnTx}><span className={styles.attnL}>{employerCount === 1 ? 'Employer' : 'Employers'}</span><span className={styles.attnS}>Companies funding staff pensions</span></span>
                <span className={styles.attnGo}>Manage {IC.chevron()}</span>
              </button>
              <button className={styles.attnRow} onClick={openBranchList}>
                <span className={styles.attnIc} data-tone="indigo">{IC.building}</span>
                <span className={styles.attnVal}>{formatNumber(branchCount)}</span>
                <span className={styles.attnTx}><span className={styles.attnL}>Branches</span><span className={styles.attnS}>
                  {formatNumber(agentCount)} agents in the field
                  {inactiveBranches > 0 ? ` · ${formatNumber(inactiveBranches)} inactive` : ''}
                </span></span>
                <span className={styles.attnGo}>View {IC.chevron()}</span>
              </button>
            </div>
          </section>

          {/* Contributions trend */}
          {monthlyHasData && (
            <section className={styles.card}>
              <div className={styles.cardHead}><span className={styles.cardIc} data-tone="teal">{IC.analytics}</span>Contributions — last 12 months</div>
              <div className={styles.trendTop}>
                <b className={styles.trendVal}>{formatUGX(thisMonth)}</b>
                {monthChange != null && (
                  <span className={styles.chg} data-dir={monthChange >= 0 ? 'up' : 'down'}>
                    {monthChange >= 0 ? IC.up() : IC.down()}{Math.abs(monthChange)}% vs last month
                  </span>
                )}
              </div>
              <MiniChart data={monthly} />
            </section>
          )}

          {/* Top branches */}
          <section className={styles.tableCard}>
            <div className={styles.tableHead}>
              <div className={styles.tableTitle}><span className={styles.cardIc}>{IC.building}</span>Top branches</div>
              <button className={styles.tableLink} onClick={openBranchList}>View all {formatNumber(branchCount)} →</button>
            </div>
            <div role="region" className={styles.tableScroll} tabIndex={0} aria-label="Top branches, scroll sideways to see more">
              <table className={styles.tbl}>
                <thead>
                  <tr><th>Branch</th><th>District</th><th className={styles.num}>Subscribers</th><th>Active rate</th><th className={styles.num}>FUM</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {topBranches.map((b) => {
                    const bm = b.m || {};
                    const ar = Math.round(bm.activeRate || 0);
                    const isActive = b.status !== 'inactive';
                    return (
                      <tr key={b.id} className={styles.rowAct} onClick={() => drillDown('branch', b.id)} aria-label={`View ${b.name}`}>
                        <td>
                          <span className={styles.member}>
                            <span className={styles.avatar}>{initials(b.name)}</span>
                            <span className={styles.memberText}>
                              <span className={styles.mName}>{b.name}</span>
                              <span className={styles.mSub}>{b.managerName || '—'}</span>
                            </span>
                          </span>
                        </td>
                        <td>{b.parentName || '—'}</td>
                        <td className={styles.num}>{formatNumber(bm.totalSubscribers || 0)}</td>
                        <td><span className={styles.miniBar}><i style={{ width: `${ar}%` }} /></span>{ar}%</td>
                        <td className={styles.num}>{formatUGX(bm.aum || 0)}</td>
                        <td><span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className={styles.col}>
          {/* Needs attention — ten platform signals, always all ten (a clear
              signal shows a green "Clear" pill rather than disappearing) so the
              card reads as a fixed checklist the admin can scan by position.

              It opens the right column, level with the health score, and carries
              an accent rail: this is the only card on the page that asks the
              admin to DO something, and it was reading as a footnote below the
              network shortcuts. The rail is conditional — an amber edge on a
              card reading "All clear" would be a warning about nothing. */}
          <section className={`${styles.card} ${toAction > 0 ? attn.cardAccent : ''}`.trim()}>
            <div className={styles.cardHead} id="admin-attn-head">
              <span className={styles.cardIc}>{IC.alert}</span>
              Needs attention
              <NeedsAttentionPill items={attentionItems} align />
            </div>
            <NeedsAttentionCard
              items={attentionItems}
              onSelect={openAttention}
              headerId="admin-attn-head"
            />
          </section>
        </div>
      </div>
    </motion.div>
  );
}
