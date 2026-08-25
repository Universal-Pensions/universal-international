import { useEffect, useRef } from 'react';

import SignupTopbar from './SignupTopbar';
import styles from './SignupShell.module.css';

export const STEPS = [
  { id: 'id-upload',     label: 'Scan your ID' },
  { id: 'review',        label: 'Review details' },
  { id: 'nira',          label: 'NIRA check' },
  { id: 'otp',           label: 'Verify phone' },
  { id: 'liveness',      label: 'Selfie' },
  { id: 'aml',           label: 'Background check' },
  { id: 'beneficiaries', label: 'Beneficiaries' },
  { id: 'consent',       label: 'Consent' },
  { id: 'done',          label: 'All set' },
];

// Terminal states sit outside the numbered flow — the topbar stepper freezes
// (amber) on the "Verify identity" stage that the terminal interrupted.
export const AGENT_STEP = 'agent';
export const PENDING_REVIEW_STEP = 'pending-review';

export function getStepIndex(stepId) {
  return STEPS.findIndex((s) => s.id === stepId);
}

// Per-step panel width tiers (mirrors the redesign mockup's TIER map). Wide
// steps (Review/Beneficiaries/Consent) get room for their multi-column layouts
// while the narrow centered steps (NIRA/OTP/AML) stay focused. Applied as the
// `--canvas-max` CSS var on the signupcanvas container; the matching
// @container rules in the step modules switch layout at these widths.
const STEP_WIDTHS = {
  'id-upload': 640,
  review: 980,
  nira: 460,
  otp: 460,
  liveness: 640,
  aml: 460,
  beneficiaries: 980,
  consent: 760,
  done: 640,
};

export default function SignupShell({ stepId, onBack, canBack = true, pinnedStageId, children }) {
  const isPaused = stepId === AGENT_STEP || stepId === PENDING_REVIEW_STEP;
  const canvasMax = isPaused ? 640 : (STEP_WIDTHS[stepId] ?? 560);
  const isComplete = stepId === 'done';
  // Coarse 3-stage mapping: every KYC step (and the terminals) is "Verify
  // identity"; the activated screen is "Done". The "Plan & pay" stage lights up
  // on the contribution page, which renders its own <SignupTopbar stageKey="plan" />.
  const stageKey = isComplete ? 'done' : 'verify';

  // a11y label for the focus target (uses the fine-grained step, not the stage).
  const displayStepId = isPaused && pinnedStageId ? pinnedStageId : stepId;
  const idx = Math.max(0, getStepIndex(displayStepId));
  const terminalLabel =
    stepId === AGENT_STEP ? 'Needs assistance'
    : stepId === PENDING_REVIEW_STEP ? 'Under review'
    : null;
  const label = terminalLabel || STEPS[idx]?.label;

  // Fine-grained current step, surfaced under the topbar's 3-stage stepper so
  // the user can see the real journey step they're on (e.g. "Step 1 of 8 ·
  // Scan your ID"). Terminals show their status; the activated "done" screen
  // relies on the "Done" stage label alone.
  const KYC_COUNT = STEPS.length - 1; // excludes the trailing 'done' step
  const inFineFlow = !isPaused && !isComplete;
  const subProgress = inFineFlow ? `Step ${idx + 1} of ${KYC_COUNT}` : null;
  // Numeric form of the fine step, so the topbar can render a determinate
  // per-step progress bar on phones (where the coarse 3-stage labels are hidden
  // and the naked stage numbers would otherwise sit frozen through all 8 steps).
  const subStep = inFineFlow ? idx + 1 : null;
  const subLabel = isComplete ? null : label;

  const mainRef = useRef(null);

  useEffect(() => {
    // Move focus to the step container on each transition so screen-reader
    // users land on the new content instead of a stale button that unmounted.
    // The element is programmatically focusable (tabIndex={-1}) so it doesn't
    // become part of the normal tab order. Also reset the scroll position — the
    // scroll container is the parent <main> (.body), not bodyInner itself.
    const el = mainRef.current;
    if (el) {
      el.parentElement?.scrollTo?.({ top: 0 });
      const frame = requestAnimationFrame(() => el.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [stepId]);

  return (
    <div className={styles.page}>
      <SignupTopbar
        stageKey={stageKey}
        paused={isPaused}
        subLabel={subLabel}
        subProgress={subProgress}
        subStep={subStep}
        subTotal={KYC_COUNT}
      />

      <main id="main" tabIndex={-1} className={styles.body}>
        <div
          ref={mainRef}
          tabIndex={-1}
          className={styles.bodyInner}
          style={{ '--canvas-max': `${canvasMax}px` }}
          aria-label={
            terminalLabel ? terminalLabel
            : isComplete ? label
            : `Step ${idx + 1} of ${KYC_COUNT}: ${label}`
          }
        >
          {canBack && onBack && (
            <button type="button" onClick={onBack} className={styles.back}>
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="14" height="14">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
          )}
          {children}
        </div>

        <footer className={styles.footer}>
          <span>Protected under Uganda’s Data Protection and Privacy Act, 2019.</span>
        </footer>
      </main>
    </div>
  );
}
