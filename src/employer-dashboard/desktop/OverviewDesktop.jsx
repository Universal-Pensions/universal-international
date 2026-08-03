import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import {
  useEmployer,
  useEmployerMetrics,
  useEmployees,
  useContributionRuns,
  usePendingInvites,
} from '../../hooks/useEmployer';
import { formatUGX, formatNumber } from '../../utils/currency';
import { groupInsuranceProducts, groupInsurancePremiumPerMember } from '../../utils/groupInsurance';
import {
  normalizeContributionConfig,
  deriveContributionLegs,
  isLegZero,
  formatLegRate,
} from '../../utils/contributionModel';
import { PageHead, Hero, MetricRow, Tile, Card, SectionHead, StatusBadge } from './ui';
import { coinsIcon, walletIcon, buildingIcon, pendingIcon, shieldIcon } from './icons';
import FundingPanel from './FundingPanel';
import NeedsAttention from './NeedsAttention';
import ui from './ui.module.css';
import styles from './OverviewDesktop.module.css';

/* Funding split for the "How your staff's pension is funded" card, derived from
   REAL MONEY rather than a ratio between the two rates.

   Why money: the two legs are INDEPENDENT shares of each member's compensation
   (the staff leg is never the base for the employer leg), so there is no
   compensation-free ratio between them — and when the legs use different bases
   (one flat UGX, one % of pay) a ratio cannot exist at all without a
   compensation base. The old `100 / (100 + matchPct)` split was a pure artifact
   of the deleted employer-leg-as-%-of-staff-leg basis and is gone.

   So we sum `deriveContributionLegs` across the ACTIVE roster — exactly what a
   run would post this period, and rounding-identical to it — and split on those
   two totals. `funded: false` (both totals zero) makes the card render a plain
   "nothing is funded yet" note instead of a meaningless 0/0 pie: that happens
   when the config is 0/0, when there are no active staff, or when percent legs
   meet a roster with no monthly pay on file. */
function fundingModel(cfg, activeRoster) {
  const c = normalizeContributionConfig(cfg);
  const staffZero = isLegZero(c.employeePct);
  const youZero = isLegZero(c.employerPct);
  const staffRate = formatLegRate(c.employeePct);
  const youRate = formatLegRate(c.employerPct);

  let staffMoney = 0;
  let youMoney = 0;
  for (const emp of activeRoster) {
    const { employeeLeg, employerLeg } = deriveContributionLegs(cfg, emp.compensation);
    staffMoney += employeeLeg;
    youMoney += employerLeg;
  }
  const total = staffMoney + youMoney;
  const money = (n) => formatUGX(n, { compact: false });

  let foot;
  if (staffZero && youZero) {
    foot = 'No contributions are set up yet. In Settings, set what your staff put in and what you add — either one can be nothing.';
  } else if (total === 0) {
    foot = activeRoster.length === 0
      ? 'Nothing is funded yet — you have no active staff. Onboard staff and every run will fund them.'
      : 'Nothing is funded yet — your active staff have no monthly pay on file, so a share of pay works out to nothing. Add their pay on the staff page.';
  } else if (staffZero) {
    foot = `You pay the whole pension — ${money(youMoney)} a month across your active staff, at no cost to them.`;
  } else if (youZero) {
    foot = `Your staff put in ${money(staffMoney)} a month from their own pay. You add nothing on top.`;
  } else {
    foot = `Each month your staff put in ${money(staffMoney)} and you add ${money(youMoney)} — ${money(total)} in all toward their pensions.`;
  }

  return {
    // Short chip beside the card title — the two concrete figures live in the
    // legend and the note, so the tag only says WHO funds.
    tag: staffZero && youZero ? 'Not set up' : staffZero ? 'You only' : youZero ? 'Staff only' : 'Staff + you',
    funded: total > 0,
    staff: {
      money: staffMoney,
      rule: staffZero ? null : { strong: `Staff put in ${staffRate}`, rest: 'each month, taken from their pay' },
    },
    you: {
      money: youMoney,
      rule: youZero ? null : { strong: `You add ${youRate}`, rest: 'each month, from company money' },
    },
    foot,
  };
}

export default function OverviewDesktop() {
  const { user } = useAuth();
  const { employerId } = useEmployerScope();
  const navigate = useNavigate();

  const { data: employer } = useEmployer(employerId);
  const { data: metrics = {} } = useEmployerMetrics(employerId);
  const { data: employees = [] } = useEmployees(employerId);
  const { data: runs = [] } = useContributionRuns(employerId);
  const { data: pendingInvites = [] } = usePendingInvites(employerId);

  // The active roster is the money base for the funding split below (a run funds
  // active staff only), so derive it once and reuse it for the headline count.
  const activeRoster = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);

  const headcount = metrics.headcount || employees.length || 0;
  const active = metrics.active || activeRoster.length || 0;
  // "Total contributions" is PENSION (employee + employer). Insurance premiums
  // are a separate leg in the run and are excluded here — the metrics RPC counts
  // type='contribution' only, so the fallback sums the two pension legs (NOT
  // grandTotal, which now includes the insurance premium).
  const totalContributions = metrics.totalContributions
    || runs.reduce((s, r) => s + ((r.employeeTotal || 0) + (r.employerTotal || 0)), 0);

  // Employee vs employer leg totals across all runs (the two-leg split the hero
  // tiles surface). Falls back to 0 cleanly for a company with no runs yet.
  const employeeTotal = runs.reduce((s, r) => s + (r.employeeTotal || 0), 0);
  const employerTotal = runs.reduce((s, r) => s + (r.employerTotal || 0), 0);

  const latest = runs[0];
  // Next contribution forecast = pension only (employee + employer), consistent
  // with the "contributions" framing; insurance shows on its own card/run leg.
  const nextAmount = latest ? (latest.employeeTotal || 0) + (latest.employerTotal || 0) : 0;
  const runDue = !latest
    || new Date(latest.runAt).getMonth() !== new Date().getMonth()
    || new Date(latest.runAt).getFullYear() !== new Date().getFullYear();

  const cfg = employer?.defaultContributionConfig;
  // Loops the active roster — memoize so the pie doesn't re-sum on every unrelated
  // re-render (panel opens, toasts).
  const funding = useMemo(() => fundingModel(cfg, activeRoster), [cfg, activeRoster]);
  // Multi-product group insurance (Life / Health / Funeral), employer-funded.
  const insProducts = groupInsuranceProducts(cfg);
  const insuranceOn = insProducts.length > 0;
  const premiumPerStaff = groupInsurancePremiumPerMember(cfg); // Σ products / mo
  const totalPremiumMonthly = premiumPerStaff * headcount;
  const totalCover = insProducts.reduce((s, p) => s + p.cover, 0);

  const pendingKyc = pendingInvites.length;
  const companyName = employer?.name || 'Your company';
  const contactName = employer?.contactName || user?.name || 'there';

  // Per-leg tile captions. Each leg states its OWN rate ("10% of pay") — there is
  // no combined mode to branch on, and a leg set to zero says so plainly instead
  // of hiding behind a generic caption.
  const legs = normalizeContributionConfig(cfg);
  const employeeRateLabel = isLegZero(legs.employeePct)
    ? 'Saved by staff · nothing set yet'
    : `Saved by staff · ${formatLegRate(legs.employeePct)}`;
  const employerRateLabel = isLegZero(legs.employerPct)
    ? 'Funded by you · nothing set yet'
    : `Funded by you · ${formatLegRate(legs.employerPct)}`;

  return (
    <div className={ui.stack}>
      <PageHead eyebrow={`Welcome back, ${contactName}`} title={companyName} />

      <Hero
        icon={coinsIcon(24)}
        eyebrow="Total contributions to date · employee + employer"
        value={formatUGX(totalContributions, { compact: false })}
      >
        <span className={ui.pos}>
          <strong>{formatNumber(active)}</strong> of {formatNumber(headcount)} staff active
        </span>
      </Hero>

      <MetricRow cols={4}>
        <Tile
          accent="indigoSoft"
          icon={walletIcon(18)}
          label="Next contribution"
          value={formatUGX(nextAmount)}
          sub={runDue ? 'Due now · funds all active staff' : 'Monthly cadence · all active staff'}
        />
        <Tile
          accent="indigo"
          icon={coinsIcon(18)}
          label="Total employee contribution"
          value={formatUGX(employeeTotal)}
          sub={employeeRateLabel}
        />
        <Tile
          accent="green"
          icon={buildingIcon(18)}
          label="Total employer contribution"
          value={formatUGX(employerTotal)}
          sub={employerRateLabel}
        />
        <Tile
          accent="teal"
          icon={pendingIcon(18)}
          label="Pending KYC"
          value={formatNumber(pendingKyc)}
          sub={pendingKyc > 0 ? 'Invited · awaiting sign-up' : 'No pending invites'}
        />
      </MetricRow>

      {/* Funding split (pie) + Needs attention — two-column row. The card always
          renders: with nothing funded it shows the plain "what to do next" note
          FundingPanel falls back to, which is more useful than hiding the card. */}
      <div className={styles.splitRow}>
        <Card>
          <SectionHead icon={coinsIcon(18)} title="How your staff’s pension is funded" tag={funding.tag} />
          <FundingPanel funding={funding} />
        </Card>

        {/* Needs attention — desktop status tiles (extracted) */}
        <Card>
          <NeedsAttention
            runDue={runDue}
            latestLabel={latest?.periodLabel}
            pendingKyc={pendingKyc}
            insuranceOn={insuranceOn}
            cover={totalCover}
            onRun={() => navigate('/dashboard/runs')}
            onKyc={() => navigate('/dashboard/pending-kyc')}
            onInsurance={() => navigate('/dashboard/insurance')}
          />
        </Card>
      </div>

      {/* Group insurance */}
      <Card accent="teal">
        <SectionHead
          icon={shieldIcon(20)}
          iconTone="teal"
          title="Group insurance"
          action={
            insuranceOn
              ? <StatusBadge tone="active">Active</StatusBadge>
              : <StatusBadge tone="inactive" dot={false}>Off</StatusBadge>
          }
        />
        {insuranceOn ? (
          <>
            <div className={styles.insStats}>
              <div className={styles.insStat}>
                <span className={styles.insK}>Covered staff</span>
                <span className={styles.insV}>{formatNumber(headcount)}</span>
                <span className={styles.insSub}>every staff member</span>
              </div>
              <div className={styles.insStat}>
                <span className={styles.insK}>Products</span>
                <span className={styles.insV}>{formatNumber(insProducts.length)}</span>
                <span className={styles.insSub}>{insProducts.map((p) => p.product).join(' · ')}</span>
              </div>
              <div className={styles.insStat}>
                <span className={styles.insK}>Premium / staff</span>
                <span className={styles.insV}>{formatUGX(premiumPerStaff)}</span>
                <span className={styles.insSub}>per month · employer-funded</span>
              </div>
              <div className={styles.insStat}>
                <span className={styles.insK}>Total premium</span>
                <span className={styles.insV}>{formatUGX(totalPremiumMonthly)}</span>
                <span className={styles.insSub}>per month · company-wide</span>
              </div>
            </div>
            <div className={styles.insProducts}>
              {insProducts.map((p) => (
                <div className={styles.insProduct} key={p.product}>
                  <span className={styles.insProductName}>{p.product}</span>
                  <span className={styles.insProductCover}>{formatUGX(p.cover)} cover</span>
                  <span className={styles.insProductPrem}>{formatUGX(p.premiumMonthly)}/mo</span>
                </div>
              ))}
            </div>
            <div className={styles.insBar}><div className={styles.insBarFill} /></div>
            <div className={styles.insCap}>
              <span><span className={styles.insPct}>100%</span> of staff covered — staff pay nothing</span>
              <span>{formatUGX(totalCover * headcount)} total cover in force</span>
            </div>
          </>
        ) : (
          <p className={styles.insEmpty}>
            No group cover set up yet. Turn on company-wide group life cover from Settings — it
            applies to every staff member at the same flat amount.
          </p>
        )}
      </Card>
    </div>
  );
}
