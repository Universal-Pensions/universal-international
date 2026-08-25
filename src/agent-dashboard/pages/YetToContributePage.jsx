import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { monthlyEquivalent } from '../../utils/finance';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';
import { formatUGPhone } from '../../utils/phone';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentSubscribers, useAgentContributions } from '../../hooks/useAgent';
import { deriveMonthAnchors, pendingContributors, monthRangeIso } from '../home/agentHomeSummary';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import AgentMobileHero from '../shell/AgentMobileHero';
import PageHeader from '../../components/PageHeader';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import NudgeSheet from './NudgeSheet';
import styles from './YetToContributePage.module.css';

const CheckIcon = (
  <svg aria-hidden="true" viewBox="0 0 14 14" width="11" height="11" fill="none">
    <path d="M2.5 7.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Drill-down for the Home "Yet to contribute" tile — the agent's subscribers
 * who haven't contributed this month (same predicate as the tile, so the count
 * matches). The agent can nudge a subscriber (WhatsApp / SMS / platform message)
 * or multi-select and bulk-nudge via platform message.
 */
export default function YetToContributePage() {
  const reduce = useReducedMotion();
  const { agentId } = useAgentScope();
  const { data: subscribers = [], isLoading, isError, error, refetch } = useAgentSubscribers(agentId);
  const isDesktop = useIsDesktop();

  const { contribStart } = useMemo(() => deriveMonthAnchors(subscribers), [subscribers]);
  const range = useMemo(() => monthRangeIso(contribStart), [contribStart]);
  const hasSubscribers = subscribers.length > 0;
  const { data: contributions = [], isPending: contributionsPending } = useAgentContributions(
    agentId,
    hasSubscribers ? range : {},
  );

  const pending = useMemo(
    () => pendingContributors(subscribers, contributions).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [subscribers, contributions],
  );

  const [selected, setSelected] = useState(() => new Set());
  const [nudgeRecipients, setNudgeRecipients] = useState(null);

  // A11-006: subscribers resolving is not the only thing this page waits on —
  // once subscribers arrive, contributions is still in flight for a beat, and
  // pendingContributors(subscribers, []) reads an empty contributions array as
  // "nobody has paid", flashing the WHOLE roster as pending before it settles
  // to the real count. Gate on both queries so the list only ever renders once
  // it can compute the true pending set.
  const loading = (isLoading && subscribers.length === 0) || (hasSubscribers && contributionsPending);
  const allSelected = pending.length > 0 && selected.size === pending.length;
  const selectedSubs = pending.filter((s) => selected.has(s.id));
  const nudgeKey = nudgeRecipients ? nudgeRecipients.map((r) => r.id).join(',') : '';

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(pending.map((s) => s.id)));
  }

  return (
    <div className={styles.page}>
      {isDesktop && (
        <PageHeader title="Yet to contribute" subtitle="No contribution logged this month" />
      )}
      <div className={styles.body}>
        <motion.div
          className={styles.stack}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          {!isDesktop && (
            <AgentMobileHero
              eyebrow="Yet to contribute"
              value={loading ? '—' : `${pending.length} member${pending.length === 1 ? '' : 's'}`}
            >
              No payment logged this month
            </AgentMobileHero>
          )}

          {!loading && !isError && pending.length > 0 && (
            <div className={styles.toolbar}>
              <button
                type="button"
                className={styles.selectAll}
                onClick={toggleAll}
                aria-pressed={allSelected}
              >
                <span className={styles.checkbox} data-checked={allSelected} aria-hidden="true">
                  {allSelected && CheckIcon}
                </span>
                {allSelected ? 'Clear all' : 'Select all'}
                <span className={styles.toolbarCount}>{pending.length}</span>
              </button>
              <button
                type="button"
                className={styles.bulkNudge}
                disabled={selected.size === 0}
                onClick={() => setNudgeRecipients(selectedSubs)}
              >
                Nudge{selected.size > 0 ? ` ${selected.size}` : ''}
              </button>
            </div>
          )}

          <div className={styles.list}>
            {loading && <SkeletonRow count={5} label="Loading subscribers" />}
            {isError && !isLoading && (
              <ErrorCard title="We couldn't load subscribers" message={error} onRetry={refetch} />
            )}
            {!loading && !isError && pending.length === 0 && (
              <EmptyState
                kind="no-data"
                title="Everyone's contributed this month"
                body="All your subscribers have a contribution logged this month — nothing to chase."
              />
            )}
            {!loading &&
              !isError &&
              pending.map((sub) => {
                const checked = selected.has(sub.id);
                return (
                  <div key={sub.id} className={styles.row} data-selected={checked}>
                    <label className={styles.rowSelect}>
                      <input
                        type="checkbox"
                        className={styles.srOnly}
                        checked={checked}
                        onChange={() => toggle(sub.id)}
                      />
                      <span className={styles.checkbox} data-checked={checked} aria-hidden="true">
                        {checked && CheckIcon}
                      </span>
                      <span className={styles.rowBody}>
                        <span className={styles.rowName}>{sub.name}</span>
                        <span className={styles.rowMeta}>
                          {formatUGPhone(sub.phone)} · {formatUGX(monthlyEquivalent(sub.contributionSchedule))}/mo
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      className={styles.nudgeBtn}
                      onClick={() => setNudgeRecipients([sub])}
                    >
                      Nudge
                    </button>
                  </div>
                );
              })}
          </div>
        </motion.div>
      </div>

      {nudgeRecipients && (
        <NudgeSheet
          key={nudgeKey}
          open
          onClose={() => setNudgeRecipients(null)}
          recipients={nudgeRecipients}
          agentId={agentId}
        />
      )}
    </div>
  );
}
