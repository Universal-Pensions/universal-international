/**
 * FundingPanel — the "How your staff's pension is funded" card body (desktop).
 *
 * A solid PIE chart of the staff-vs-you split in soft tints (soft indigo =
 * staff, soft green = you), with the legend in its own boxes beside it and the
 * money summary as a callout. The pie spins + scales in on mount; hovering a
 * wedge dims the others and lifts the corresponding legend box. Honours
 * prefers-reduced-motion. Driven by the company `funding` model (fundingModel in
 * OverviewDesktop), which hands us the two legs as REAL MONEY summed over the
 * active roster — see the note on buildSegments below.
 */

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';
import { sparkIcon } from './icons';
import styles from './FundingPanel.module.css';

// Soft tints for the wedges/swatches + a darker ink per leg for legible text
// (soft green fails contrast as text on white, so % uses the ink).
const C_STAFF = '#5E63A8';
const C_EMP = '#5FA877';
const INK_STAFF = '#3F4490';
const INK_EMP = '#2C7150';

const TAU = Math.PI * 2;
const SIZE = 150;
const CX = SIZE / 2;
const R = CX - 3;

function piePoint(r, frac) {
  const a = frac * TAU - Math.PI / 2; // 0 at 12 o'clock, sweeping clockwise
  return [CX + r * Math.cos(a), CX + r * Math.sin(a)];
}

function wedgePath(f0, f1) {
  const [x0, y0] = piePoint(R, f0);
  const [x1, y1] = piePoint(R, f1);
  const large = f1 - f0 > 0.5 ? 1 : 0;
  return `M${CX},${CX} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

/* Wedges from the two legs' MONEY, never from their rates. The staff leg and the
   employer leg are independent shares of compensation, so the only honest split
   between them is the money each actually funds this period — and with mixed
   bases (a flat UGX leg beside a % of pay leg) a rate ratio does not exist at
   all. A leg funding nothing is dropped rather than drawn as a 0% wedge, and the
   second share is the complement of the first so the legend always adds to 100. */
function buildSegments(funding) {
  const total = funding.staff.money + funding.you.money;
  const staffPct = Math.round((funding.staff.money / total) * 100);
  return [
    {
      key: 'own',
      label: 'Put in by staff',
      money: funding.staff.money,
      pct: staffPct,
      color: C_STAFF,
      ink: INK_STAFF,
      rule: funding.staff.rule,
    },
    {
      key: 'emp',
      label: 'Added by you',
      money: funding.you.money,
      pct: 100 - staffPct,
      color: C_EMP,
      ink: INK_EMP,
      rule: funding.you.rule,
    },
  ].filter((s) => s.money > 0);
}

function Pie({ segments, activeKey, onHover, label }) {
  const draw = segments.filter((s) => s.pct > 0);
  const total = draw.reduce((sum, s) => sum + s.pct, 0) || 1;
  let acc = 0;
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
      {draw.length <= 1 ? (
        <circle cx={CX} cy={CX} r={R} fill={draw[0]?.color || C_STAFF} />
      ) : (
        draw.map((seg) => {
          const f0 = acc / total;
          acc += seg.pct;
          const f1 = acc / total;
          const active = seg.key === activeKey;
          return (
            <motion.path
              key={seg.key}
              d={wedgePath(f0, f1)}
              fill={seg.color}
              stroke="#fff"
              strokeWidth="3"
              strokeLinejoin="round"
              onMouseEnter={() => onHover(seg.key)}
              onMouseLeave={() => onHover(null)}
              animate={{ opacity: activeKey == null || active ? 1 : 0.78 }}
              transition={{ duration: 0.2 }}
              style={{ cursor: 'pointer', filter: active ? 'brightness(1.06)' : 'none' }}
            />
          );
        })
      )}
    </svg>
  );
}

export default function FundingPanel({ funding }) {
  const reduce = useReducedMotion();
  const [hoverKey, setHoverKey] = useState(null);

  // Nothing funded (0/0 config, no active staff, or percent legs against a roster
  // with no pay on file) → the note alone. A pie of two zeroes would be a lie.
  if (!funding.funded) {
    return (
      <div className={styles.foot}>
        <span className={styles.footIc}>{sparkIcon(18)}</span>
        <p>{funding.foot}</p>
      </div>
    );
  }

  const segments = buildSegments(funding);
  const pieLabel = `Funding split — ${segments.map((s) => `${s.label} ${formatUGX(s.money, { compact: false })}, ${s.pct}%`).join('; ')}`;

  return (
    <>
      <div className={styles.body}>
        <motion.div
          className={styles.chartWrap}
          initial={reduce ? false : { opacity: 0, scale: 0.85, rotate: -12 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        >
          <Pie segments={segments} activeKey={hoverKey} onHover={setHoverKey} label={pieLabel} />
        </motion.div>

        <div className={styles.legend}>
          {segments.map((seg) => (
            <div
              key={seg.key}
              className={`${styles.legBox} ${seg.key === hoverKey ? styles.legBoxActive : ''}`}
              style={{ '--seg': seg.color }}
            >
              <div className={styles.legTop}>
                <span className={styles.legSwatch} style={{ background: seg.color }} aria-hidden="true" />
                <span className={styles.legName}>{seg.label}</span>
                <span className={styles.legPct} style={{ color: seg.ink }}>{seg.pct}%</span>
              </div>
              {seg.rule && (
                <p className={styles.legRule}>
                  <b>{seg.rule.strong}</b>&nbsp;{seg.rule.rest}
                </p>
              )}
              {/* The money behind the share — this is what the wedge is sized on. */}
              <p className={styles.legRule}>
                <b>{formatUGX(seg.money, { compact: false })}</b>&nbsp;a month across your active staff
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.foot}>
        <span className={styles.footIc}>{sparkIcon(18)}</span>
        <p>{funding.foot}</p>
      </div>
    </>
  );
}
