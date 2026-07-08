import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGPhone } from '../../utils/phone';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentSubscribers } from '../../hooks/useAgent';
import { isInsured } from '../home/agentHomeSummary';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import AgentMobileHero from '../shell/AgentMobileHero';
import PageHeader from '../../components/PageHeader';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import NudgeSheet from './NudgeSheet';
import styles from './UninsuredMembersPage.module.css';

const CheckIcon = (
  <svg aria-hidden="true" viewBox="0 0 14 14" width="11" height="11" fill="none">
    <path d="M2.5 7.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

/** Insurance-pitch draft for the nudge composer (vs the contribution reminder). */
function insuranceMessage(recipients) {
  const lead = recipients.length === 1 ? `Hi ${firstName(recipients[0].name)}, ` : 'Hi, ';
  return `${lead}adding life insurance to your pension is quick and affordable — cover for your family is just UGX 24,000/year (about UGX 2,000/month) — paid once a year, or built gradually from savings. I can set it up for you in minutes; reply here or call me anytime. Thank you!`;
}

/**
 * Drill-down for the Home insurance card "Uninsured members" stat — the agent's
 * subscribers without active life cover (the inverse of `isInsured`, so the
 * count matches the card). The agent can nudge a subscriber to buy insurance
 * (WhatsApp / SMS / platform message) or multi-select and bulk-nudge — reusing
 * the same NudgeSheet as the contribution reminder, with an insurance draft.
 */
export default function UninsuredMembersPage() {
  const reduce = useReducedMotion();
  const { agentId } = useAgentScope();
  const { data: subscribers = [], isLoading, isError, error, refetch } = useAgentSubscribers(agentId);
  const isDesktop = useIsDesktop();

  const uninsured = useMemo(
    () =>
      subscribers
        .filter((s) => !isInsured(s))
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [subscribers],
  );

  const [selected, setSelected] = useState(() => new Set());
  const [nudgeRecipients, setNudgeRecipients] = useState(null);

  const loading = isLoading && subscribers.length === 0;
  const allSelected = uninsured.length > 0 && selected.size === uninsured.length;
  const selectedSubs = uninsured.filter((s) => selected.has(s.id));
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
    setSelected(allSelected ? new Set() : new Set(uninsured.map((s) => s.id)));
  }

  return (
    <div className={styles.page}>
      {isDesktop && (
        <PageHeader title="Uninsured members" subtitle="No active cover — invite them to add insurance" />
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
              eyebrow="Uninsured members"
              value={loading ? '—' : `${uninsured.length} member${uninsured.length === 1 ? '' : 's'}`}
            >
              No active cover — invite them to add insurance
            </AgentMobileHero>
          )}

          {!loading && !isError && uninsured.length > 0 && (
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
                <span className={styles.toolbarCount}>{uninsured.length}</span>
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
            {!loading && !isError && uninsured.length === 0 && (
              <EmptyState
                kind="no-data"
                title="Everyone's covered"
                body="All your subscribers have active insurance — nothing to chase."
              />
            )}
            {!loading &&
              !isError &&
              uninsured.map((sub) => {
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
                        <span className={styles.rowMeta}>{formatUGPhone(sub.phone)}</span>
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
          composeDefault={insuranceMessage}
        />
      )}
    </div>
  );
}
