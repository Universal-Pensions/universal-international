import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import logo from '../assets/logo.png';
import styles from './SignupTopbar.module.css';

// Coarse 3-stage progress shown in the signup topbar. The fine-grained step
// (e.g. "Step 3 · Verification") lives in each step's own eyebrow; this is the
// high-level "where am I in the journey" indicator.
const STAGES = [
  { key: 'verify', label: 'Verify identity' },
  { key: 'plan',   label: 'Plan & pay' },
  { key: 'done',   label: 'Done' },
];

function getStageIndex(stageKey) {
  const i = STAGES.findIndex((s) => s.key === stageKey);
  return i < 0 ? 0 : i;
}

/**
 * Standalone signup chrome: brand · 3-stage stepper · exit. Rendered by both
 * SignupShell (KYC steps + the activated "done" screen) and the contribution
 * page, so the stepper is continuous across the whole self-signup journey.
 *
 * @param {string}  stageKey    active stage: 'verify' | 'plan' | 'done'
 * @param {boolean} paused      terminal (agent / pending review) — tints the
 *                              active stage amber instead of indigo
 * @param {string}  subLabel    friendly name of the current fine-grained step
 *                              (e.g. "Scan your ID") shown under the stepper
 * @param {string}  subProgress optional "Step N of M" prefix for subLabel
 */
export default function SignupTopbar({ stageKey = 'verify', paused = false, subLabel = null, subProgress = null }) {
  const activeIndex = getStageIndex(stageKey);

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link to="/" className={styles.brand} aria-label="Universal Pensions home">
          <img src={logo} alt="" width={132} height={36} />
        </Link>

        <div className={styles.center}>
          <ol
            className={styles.stepper}
            aria-label={`Signup progress — ${paused ? 'paused at ' : ''}${STAGES[activeIndex].label}`}
          >
            {STAGES.map((stage, i) => {
              const state =
                paused && i === activeIndex ? 'paused'
                : i < activeIndex ? 'done'
                : i === activeIndex ? 'active'
                : 'upcoming';
              return (
                <Fragment key={stage.key}>
                  {i > 0 && (
                    <li
                      className={styles.bar}
                      data-filled={i <= activeIndex || undefined}
                      aria-hidden="true"
                    />
                  )}
                  <li className={styles.stage} data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
                    <span className={styles.node} aria-hidden="true">
                      {state === 'done' ? (
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
                          <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className={styles.stageLabel}>{stage.label}</span>
                  </li>
                </Fragment>
              );
            })}
          </ol>

          {subLabel && (
            <p className={styles.subLabel}>
              {subProgress && <span className={styles.subProgress}>{subProgress}</span>}
              {subProgress && <span aria-hidden="true"> · </span>}
              {subLabel}
            </p>
          )}
        </div>

        <Link to="/" className={styles.exit} aria-label="Exit signup">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
