/**
 * NeedsAttention — the employer desktop Overview "Needs attention" card body.
 *
 * Desktop-native rework of the phone list: each operational item is a tile with
 * a status-coloured left rail + tinted icon, a unified status pill on the right,
 * and a header count chip ("2 to action" / "All clear"). Tiles stagger-fade in
 * on mount (honours prefers-reduced-motion). The actual destinations are wired
 * by the parent (run/insurance navigate; KYC opens the desktop slide-over).
 */

import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX, formatNumber } from '../../utils/currency';
import { SectionHead } from './ui';
import { runsIcon, employeesIcon, shieldIcon, bellIcon } from './icons';
import s from './NeedsAttention.module.css';

const chevron = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const TONE = {
  warn: { tint: s.tintAmber, rail: s.railWarn, pill: s.pillWarn },
  ok: { tint: s.tintGreen, rail: s.railOk, pill: s.pillOk },
  teal: { tint: s.tintTeal, rail: s.railTeal, pill: s.pillTeal },
  off: { tint: s.tintGray, rail: s.railOff, pill: s.pillOff },
};

export default function NeedsAttention({
  runDue,
  latestLabel,
  pendingKyc,
  insuranceOn,
  cover,
  // A14-004 — `cover` is the group policy's TOTAL per-member amount (life +
  // health combined on the seed: 15.0M + 5.0M = 20.0M), not a life-only
  // figure, so the row title must not claim "life" specifically. Optional
  // and defaulted (not required) so the existing caller — OverviewDesktop.jsx,
  // which does not pass this prop today — keeps working unchanged; a caller
  // that knows its enabled products (e.g. "Life + health cover") can override it.
  label = 'Group cover',
  onRun,
  onKyc,
  onInsurance,
}) {
  const reduce = useReducedMotion();

  const items = [
    {
      key: 'run',
      icon: runsIcon(20),
      title: 'Contribution run',
      sub: latestLabel ? `Last run · ${latestLabel}` : 'No runs yet',
      tone: runDue ? 'warn' : 'ok',
      status: runDue ? 'Due' : 'On track',
      onClick: onRun,
    },
    {
      key: 'kyc',
      icon: employeesIcon(20),
      title: 'Pending KYC',
      sub: pendingKyc > 0 ? `${formatNumber(pendingKyc)} invited · awaiting sign-up` : 'Everyone onboarded',
      tone: pendingKyc > 0 ? 'warn' : 'ok',
      status: pendingKyc > 0 ? `${formatNumber(pendingKyc)} pending` : 'Cleared',
      onClick: onKyc,
    },
    {
      key: 'ins',
      icon: shieldIcon(20),
      title: label,
      sub: insuranceOn ? `${formatUGX(cover, { compact: true })} per member` : 'Not set up',
      tone: insuranceOn ? 'teal' : 'off',
      status: insuranceOn ? 'On' : 'Off',
      onClick: onInsurance,
    },
  ];

  const attentionCount = items.filter((it) => it.tone === 'warn').length;

  return (
    <>
      <SectionHead
        icon={bellIcon(18)}
        title="Needs attention"
        action={
          <span className={`${s.count} ${attentionCount > 0 ? s.countWarn : s.countOk}`}>
            {attentionCount > 0 ? `${attentionCount} to action` : 'All clear'}
          </span>
        }
      />
      <div className={s.list}>
        {items.map((it, i) => {
          const t = TONE[it.tone];
          return (
            <motion.button
              key={it.key}
              type="button"
              onClick={it.onClick}
              className={`${s.row} ${t.rail}`}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.07, ease: EASE_OUT_EXPO }}
            >
              <span className={`${s.ic} ${t.tint}`}>{it.icon}</span>
              <span className={s.mid}>
                <b>{it.title}</b>
                <small>{it.sub}</small>
              </span>
              <span className={`${s.pill} ${t.pill}`}><i />{it.status}</span>
              <span className={s.chev}>{chevron}</span>
            </motion.button>
          );
        })}
      </div>
    </>
  );
}
