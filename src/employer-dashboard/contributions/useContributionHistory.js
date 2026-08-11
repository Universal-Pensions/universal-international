import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useEmployerContributions, useContributionRuns } from '../../hooks/useEmployer';

// Every bit of contribution-history logic — which leg is on screen, the run
// period each payment belongs to, the filtering and the totals — lives here so
// the desktop and phone bodies render the SAME numbers and can't drift. The
// bodies own layout only. Mirrors kyc/usePendingKycNudge.
//
// The leg lives in the URL (`?leg=employee`), not in component state: the
// Overview tiles link straight to a filtered view, so the filter has to survive
// a page load, a refresh and a shared link.

/** A run posts up to two payments per member. `source` says whose money it is. */
export const LEG_SOURCE = { employee: 'own', employer: 'employer' };

export const LEGS = [
  // `label` names the leg; `blurb` says whose money it is, in the plainest words
  // available — this page is read by employers, not accountants.
  { key: 'all', label: 'All', blurb: 'Every payment made into your staff pensions.' },
  { key: 'employee', label: 'Staff', blurb: 'Money your staff put in from their own pay.' },
  { key: 'employer', label: 'You', blurb: 'Money your company put in on top.' },
];

const LEG_KEYS = new Set(LEGS.map((l) => l.key));

/** Anything unrecognised in the URL falls back to the unfiltered view. */
export function normalizeLeg(raw) {
  return LEG_KEYS.has(raw) ? raw : 'all';
}

export function useContributionHistory() {
  const { employerId } = useEmployerScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const leg = normalizeLeg(searchParams.get('leg'));

  const {
    data: payments = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useEmployerContributions(employerId);
  // Already cached by the Overview and Runs pages — reused here purely to name
  // each payment's period ("May 2026") rather than to re-fetch anything.
  const { data: runs = [] } = useContributionRuns(employerId);

  const runById = useMemo(() => {
    const map = new Map();
    for (const run of runs) map.set(run.id, run);
    return map;
  }, [runs]);

  // One row per payment, stamped with its period + leg. A payment whose run has
  // been filtered out of the runs list still shows — the money is real either
  // way, it just can't name its period.
  const rows = useMemo(
    () =>
      payments.map((p) => {
        const run = runById.get(p.contributionRunId);
        return {
          ...p,
          periodLabel: run?.periodLabel ?? null,
          leg: p.source === 'employer' ? 'employer' : 'employee',
        };
      }),
    [payments, runById],
  );

  const visible = useMemo(
    () => (leg === 'all' ? rows : rows.filter((r) => r.leg === leg)),
    [rows, leg],
  );

  // Totals for ALL legs, not just the visible one, so the tabs can carry their
  // own figures and the footer can reconcile against the Overview tiles.
  const totals = useMemo(() => {
    const t = { all: 0, employee: 0, employer: 0 };
    const counts = { all: 0, employee: 0, employer: 0 };
    for (const r of rows) {
      const amount = Number(r.amount ?? 0);
      t.all += amount;
      t[r.leg] += amount;
      counts.all += 1;
      counts[r.leg] += 1;
    }
    return { amount: t, count: counts };
  }, [rows]);

  // How many people and periods the visible money covers — the two facts an
  // employer asks next ("who, and over how long?").
  const coverage = useMemo(() => {
    const members = new Set();
    const periods = new Set();
    for (const r of visible) {
      members.add(r.subscriberId);
      if (r.periodLabel) periods.add(r.periodLabel);
    }
    return { members: members.size, periods: periods.size };
  }, [visible]);

  /** Switch legs in place — replace, so the tabs don't stack up in history. */
  function setLeg(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('leg');
    else params.set('leg', next);
    setSearchParams(params, { replace: true });
  }

  return {
    leg,
    setLeg,
    rows,
    visible,
    totals,
    coverage,
    isCold: isLoading && payments.length === 0,
    isError,
    error,
    refetch,
    hasAny: rows.length > 0,
  };
}
