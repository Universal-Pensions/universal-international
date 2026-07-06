import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomSheet from './BottomSheet';
import { AMOUNTS, computeProjection, formatUGX } from '../mobile/calc';
import styles from '../mobile/landingMobile.module.css';

const ChartIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" />
  </svg>
);

const AMT_LABELS = { 5000: '5K', 10000: '10K', 20000: '20K', 50000: '50K' };

/**
 * CalculatorSheet — the "See your growth" savings projector, opened from the
 * Individuals home. Owns its own contribution/term state and computes with the
 * shared finance model (calc.js), so the figure matches the desktop calculator.
 */
export default function CalculatorSheet({ open, onClose }) {
  const navigate = useNavigate();
  const [pmt, setPmt] = useState(10000);
  const [years, setYears] = useState(25);
  const { fv, contributed, growth, contributedPct } = computeProjection(pmt, years);

  function startSaving() {
    onClose?.();
    navigate('/signup');
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="See your growth" icon={ChartIcon}>
      <div className={styles.sheetVars}>
        <span className={styles.flabel}>I save each month</span>
        <div className={styles.chipRow}>
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              className={styles.amtChip}
              aria-pressed={pmt === a}
              onClick={() => setPmt(a)}
            >
              {AMT_LABELS[a]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '16px 0 0' }}>
          <span className={styles.flabel} style={{ margin: 0 }}>For how long</span>
          <span style={{ fontFamily: 'var(--fd)', fontWeight: 800, fontSize: 14, color: 'var(--indigo)' }}>
            {years} years
          </span>
        </div>
        <input
          className={styles.slider}
          type="range"
          min="5"
          max="40"
          step="1"
          value={years}
          aria-label="Saving term in years"
          aria-valuetext={`${years} years`}
          onChange={(e) => setYears(Number(e.target.value))}
        />
        <div className={styles.slLimits}>
          <span>5 yrs</span>
          <span>40 yrs</span>
        </div>

        <div className={styles.calcResult}>
          <div className={styles.crl}>Projected at retirement</div>
          <div className={styles.crv}>{formatUGX(fv)}</div>
          <div className={styles.calcBar}>
            <span style={{ width: `${contributedPct}%` }} />
          </div>
          <div className={styles.calcLegend}>
            <span><i className={styles.ld} />You put in <b>{formatUGX(contributed)}</b></span>
            <span><i className={styles.lg} />Growth <b>{formatUGX(growth)}</b></span>
          </div>
        </div>

        <button
          type="button"
          className={`${styles.btn} ${styles['btn-pri']} ${styles['btn-block']}`}
          style={{ marginTop: 16 }}
          onClick={startSaving}
        >
          Start saving today
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
        <p className={styles.calcNote}>Example only, at about 10% a year.</p>
      </div>
    </BottomSheet>
  );
}
