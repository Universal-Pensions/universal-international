import { useState, useMemo, useEffect } from 'react';
import { useCurrentSubscriber, useSubscriberTransactions } from '../../../hooks/useSubscriber';
import { formatUGX } from '../../../utils/currency';
import { isRunPosted } from '../../../utils/periodSettlement';

import { downloadCSV } from '../../../utils/csv';
import ErrorCard from '../../../components/feedback/ErrorCard';
import ExportButton from '../../../components/reports/ExportButton';
import SkeletonRow from '../../../components/SkeletonRow';
import EmptyState from '../../../components/EmptyState';
import { PillChip, PillChipGroup } from '../../../components/PillChip';
import frameStyles from './ReportFrame.module.css';

function txYear(isoDate) {
  return new Date(isoDate).getFullYear();
}

export default function AnnualStatement() {
  const { data: sub, isLoading, isError, error, refetch } = useCurrentSubscriber();
  // `sub.transactions` does not exist — getCurrentSubscriber's single joined
  // query never selects the transactions table, so this ALWAYS read `[]`,
  // reporting UGX 0 contributions (and exporting a zeroed CSV) for a member
  // who had genuinely contributed (A10-001). Read the same dedicated,
  // id-scoped query ActivityPage/WithdrawalsHistory already use instead.
  const { data: transactions = [], isLoading: txLoading } = useSubscriberTransactions(sub?.id);

  /* Build a set of years present in transactions */
  const years = useMemo(() => {
    const s = new Set();
    transactions.forEach((t) => s.add(txYear(t.date)));
    return Array.from(s).sort((a, b) => b - a);
  }, [transactions]);

  const [year, setYear] = useState(years[0] ?? new Date().getFullYear());

  // The default `year` is read once from a possibly-empty `years` (transactions
  // hydrate async). Re-sync onto a populated year once data lands, so the
  // statement never sticks on a wall-clock year with no transactions.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- query result → state sync
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  const yearTx = useMemo(
    () => transactions.filter((t) => txYear(t.date) === year),
    [transactions, year]
  );

  const totals = useMemo(() => {
    // Contributions are attributed three ways, because one merged figure hid who
    // actually funded the year for an employer-sponsored member:
    //   selfPaid    — contributions the member paid themselves.
    //   fromPay     — the employee leg of an employer contribution run: the
    //                 member's own money, but deducted from their pay and remitted
    //                 by the employer (utils/periodSettlement isRunPosted).
    //   fromEmployer— the employer leg, the company's own money.
    let selfPaid = 0, fromPay = 0, fromEmployer = 0;
    let premiums = 0, withdrawals = 0, claimsInflow = 0;
    yearTx.forEach((t) => {
      if (t.type === 'contribution') {
        if (t.source === 'employer') fromEmployer += t.amount;
        else if (isRunPosted(t)) fromPay += t.amount;
        else selfPaid += t.amount;
      }
      // Self-paid annual premium ('premium') and save-to-cover sweeps
      // ('premium_sweep', stored negative) are both the member's own premiums;
      // Math.abs so a negative sweep magnitude ADDS to the total, not subtracts.
      // Employer-funded 'insurance_premium' is deliberately excluded — the
      // member paid nothing toward it.
      else if (t.type === 'premium' || t.type === 'premium_sweep') premiums += Math.abs(t.amount);
      else if (t.type === 'withdrawal') withdrawals += Math.abs(t.amount);
      else if (t.type === 'claim') claimsInflow += t.amount;
    });
    const contributions = selfPaid + fromPay + fromEmployer;
    return {
      contributions,
      selfPaid,
      fromPay,
      fromEmployer,
      premiums,
      withdrawals,
      claimsInflow,
      netInflow: contributions + claimsInflow - withdrawals - premiums,
    };
  }, [yearTx]);

  // Only an employer-sponsored member needs the split spelled out; a member who
  // funds their own pension keeps the single "Total saved" line.
  const hasEmployerFunding = totals.fromPay > 0 || totals.fromEmployer > 0;

  function handleExport() {
    const headers = ['Item', 'Amount (UGX)'];
    const rows = [
      [`Contributions ${year}`, totals.contributions],
      // The split lines only appear once employer money is in the year, so a
      // self-funded member's statement is unchanged.
      ...(hasEmployerFunding
        ? [
            [`— paid by you ${year}`, totals.selfPaid],
            [`— deducted from your pay ${year}`, totals.fromPay],
            [`— paid by your employer ${year}`, totals.fromEmployer],
          ]
        : []),
      [`Insurance premiums ${year}`, totals.premiums],
      [`Withdrawals ${year}`, totals.withdrawals],
      [`Claim payouts ${year}`, totals.claimsInflow],
      ['Net inflow', totals.netInflow],
    ];
    downloadCSV(`annual-statement-${year}.csv`, headers, rows);
  }

  if (isError) {
    return (
      <ErrorCard
        title="We couldn't load your annual statement"
        message={error}
        onRetry={refetch}
      />
    );
  }

  // Cold-load skeleton — without this the report briefly renders a "0 of 0"
  // year summary on a slow connection. Waits on the transactions fetch too
  // (`txLoading`): without it, a still-loading list renders as "No statement
  // yet" or a UGX 0 year summary — indistinguishable from the A10-001 bug
  // this fixes — before the real rows pop in.
  // (isLoading && !sub) || txLoading — NOT `!sub?.id || …`.
  // getCurrentSubscriber uses maybeSingle(), which returns null with NO error
  // when RLS yields no row. With isError false and isLoading false, a
  // `!sub?.id` guard is the only branch that ever matches, so the skeleton
  // renders FOREVER instead of falling through to the terminal empty state
  // below it. Three of these four sibling views were changed together and
  // ended up disagreeing; this is InsuranceStatement's form, which was right.
  if ((isLoading && !sub) || txLoading) {
    return (
      <div className={frameStyles.frame}>
        <div className={frameStyles.headerRow}>
          <div className={frameStyles.headerText}>
            <span className={frameStyles.eyebrow}>Annual tax statement</span>
            <span className={frameStyles.headerDesc}>Loading…</span>
          </div>
        </div>
        <SkeletonRow count={5} label="Loading annual statement" />
      </div>
    );
  }

  return (
    <div className={frameStyles.frame}>
      <div className={frameStyles.headerRow}>
        <div className={frameStyles.headerText}>
          <span className={frameStyles.eyebrow}>Annual tax statement</span>
          <span className={frameStyles.headerDesc}>A year-end summary for your records.</span>
        </div>
        <ExportButton onExport={handleExport} />
      </div>

      {transactions.length === 0 ? (
        // Match the other report views: when there are no transactions at all
        // we show a single empty-state instead of a "0 of 0" year summary.
        <EmptyState
          kind="no-data"
          title="No statement yet."
          body="Once your first transaction settles, a year-end summary will appear here for your records."
        />
      ) : (
        <>
          {/* Year chips */}
          {years.length > 0 && (
            <PillChipGroup label="Statement year" layout="row">
              {years.map((y) => (
                <PillChip
                  key={y}
                  selected={year === y}
                  onClick={() => setYear(y)}
                >
                  {y}
                </PillChip>
              ))}
            </PillChipGroup>
          )}

          <div className={frameStyles.kpiStrip}>
            <div className={frameStyles.kpi}>
              <span className={frameStyles.kpiLabel}>Contributions</span>
              <span className={frameStyles.kpiValue}>{formatUGX(totals.contributions)}</span>
              {/* The headline figure includes the employer's own money, so say how
                  much of it is theirs — the member should not read the whole total
                  as savings they funded (it is a TAX statement). */}
              {totals.fromEmployer > 0 && (
                <span className={frameStyles.kpiSub}>
                  incl. {formatUGX(totals.fromEmployer)} from your employer
                </span>
              )}
            </div>
            <div className={frameStyles.kpi}>
              <span className={frameStyles.kpiLabel}>Premiums</span>
              <span className={frameStyles.kpiValue}>{formatUGX(totals.premiums)}</span>
            </div>
            <div className={frameStyles.kpi}>
              <span className={frameStyles.kpiLabel}>Withdrawals</span>
              <span className={frameStyles.kpiValue}>{formatUGX(totals.withdrawals)}</span>
            </div>
            <div className={frameStyles.kpi}>
              <span className={frameStyles.kpiLabel}>Claim payouts</span>
              <span className={frameStyles.kpiValue}>{formatUGX(totals.claimsInflow)}</span>
            </div>
          </div>

          <section className={frameStyles.statSection}>
            <div className={frameStyles.statSectionTitle}>{year} summary</div>
            <ul className={frameStyles.summaryList}>
              <li className={frameStyles.summaryRow}>
                <span>Total saved ({totals.contributions ? 'gross' : 'none'})</span>
                <strong>{formatUGX(totals.contributions, { compact: false })}</strong>
              </li>
              {/* Who funded that total. Shown only when an employer put money in,
                  and only for the legs that are non-zero — the unified model lets
                  either leg be 0, and a line reading "UGX 0" would just be noise. */}
              {hasEmployerFunding && totals.selfPaid > 0 && (
                <li className={frameStyles.summaryRow}>
                  <span>Of that, paid by you</span>
                  <strong>{formatUGX(totals.selfPaid, { compact: false })}</strong>
                </li>
              )}
              {hasEmployerFunding && totals.fromPay > 0 && (
                <li className={frameStyles.summaryRow}>
                  <span>Of that, taken from your pay</span>
                  <strong>{formatUGX(totals.fromPay, { compact: false })}</strong>
                </li>
              )}
              {hasEmployerFunding && totals.fromEmployer > 0 && (
                <li className={frameStyles.summaryRow}>
                  <span>Of that, added by your employer</span>
                  <strong>{formatUGX(totals.fromEmployer, { compact: false })}</strong>
                </li>
              )}
              <li className={frameStyles.summaryRow}>
                <span>Insurance premiums paid</span>
                <strong>{formatUGX(totals.premiums, { compact: false })}</strong>
              </li>
              <li className={frameStyles.summaryRow}>
                <span>Withdrawals made</span>
                <strong>{formatUGX(totals.withdrawals, { compact: false })}</strong>
              </li>
              <li className={frameStyles.summaryRow}>
                <span>Insurance claim payouts</span>
                <strong>{formatUGX(totals.claimsInflow, { compact: false })}</strong>
              </li>
              <li className={`${frameStyles.summaryRow} ${frameStyles.summaryTotal}`}>
                <span>Net inflow to your account</span>
                <strong>{formatUGX(Math.max(0, totals.netInflow), { compact: false })}</strong>
              </li>
            </ul>
            <p className={frameStyles.summaryNote}>
              This summary is for your personal records. Universal Pensions contributions may be tax-deductible in some cases — check with a qualified tax advisor.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
