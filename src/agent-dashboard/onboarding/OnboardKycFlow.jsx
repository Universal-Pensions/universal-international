import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useSignup } from '../../signup/SignupContext';
import { STEPS, AGENT_STEP, PENDING_REVIEW_STEP, getStepIndex } from '../../signup/SignupShell';

import IdUploadStep from '../../signup/steps/IdUploadStep';
import ReviewStep from '../../signup/steps/ReviewStep';
import NiraStep from '../../signup/steps/NiraStep';
import OtpStep from '../../signup/steps/OtpStep';
import LivenessStep from '../../signup/steps/LivenessStep';
import AmlStep from '../../signup/steps/AmlStep';
import BeneficiariesStep from '../../signup/steps/BeneficiariesStep';
import ConsentStep from '../../signup/steps/ConsentStep';

import styles from './OnboardKycFlow.module.css';

const NO_BACK_STEPS = new Set(['id-upload', 'done', AGENT_STEP, PENDING_REVIEW_STEP]);

/**
 * OnboardKycFlow — runs the existing 9-step subscriber KYC inside the agent
 * onboarding panel. Reuses the step components verbatim so the agent path stays
 * in lockstep with the self-serve subscriber path.
 *
 * Differences from /signup:
 *  - No SignupShell chrome (header logo, exit link). The panel header replaces it.
 *  - Terminal states (`agent`, `pending-review`) get inline panels rather than
 *    full-page screens, since the agent is operating inside their dashboard.
 *  - "Done" hands off to the parent onComplete instead of /signup/contribution.
 */
export default function OnboardKycFlow({ onComplete, onBackToAwareness, onExit }) {
  const signup = useSignup();
  const [stepId, setStepId] = useState('id-upload');
  const [pausedAt, setPausedAt] = useState(null);
  const [direction, setDirection] = useState(1);

  function goTo(nextId) {
    const currIdx = getStepIndex(stepId);
    const nextIdx = getStepIndex(nextId);
    setDirection(nextIdx >= currIdx ? 1 : -1);
    setStepId(nextId);
  }

  function goNext() {
    const idx = getStepIndex(stepId);
    const next = STEPS[idx + 1];
    if (next) {
      // The original SignupFlow shows a `done` step for the subscriber. In the
      // agent context we don't need the member-card celebration — once consent
      // is captured, the subscriber is enrolled and we hand off to the panel's
      // OnboardingComplete screen.
      if (next.id === 'done') {
        onComplete();
        return;
      }
      goTo(next.id);
    }
  }

  function goBack() {
    const idx = getStepIndex(stepId);
    // Both the NIRA "Identity verified" beat (on a match) and the AML "check
    // passed" beat (on a clear result) auto-advance with no manual control;
    // stepping back onto either would bounce forward again (a ~1s flicker). Skip
    // over any run of them to the previous real step.
    let prevIdx = idx - 1;
    while (
      prevIdx >= 0 &&
      ((STEPS[prevIdx].id === 'nira' && signup.niraResult === 'match') ||
        (STEPS[prevIdx].id === 'aml' && signup.amlResult === 'clear'))
    ) {
      prevIdx -= 1;
    }
    const prev = STEPS[prevIdx];
    if (prev) {
      goTo(prev.id);
    } else {
      // Already at the first KYC step — hop back to the awareness check.
      onBackToAwareness();
    }
  }

  function routeToAgent(reason, stageId) {
    signup.patch({ failureReason: reason, failureStage: stageId });
    setPausedAt(stageId || stepId);
    setStepId(AGENT_STEP);
  }

  function routeToPendingReview() {
    setPausedAt('aml');
    setStepId(PENDING_REVIEW_STEP);
  }

  const isTerminal = stepId === AGENT_STEP || stepId === PENDING_REVIEW_STEP;
  const showBack = !NO_BACK_STEPS.has(stepId);
  const stepIdx = getStepIndex(pausedAt || stepId);
  const visibleStepIdx = stepIdx === -1 ? 0 : stepIdx;
  // We omit the trailing 'done' step from the count because the agent path
  // skips it — consent is the final stop before handoff.
  const totalSteps = STEPS.length - 1;

  const stepNode = useMemo(() => renderStep(), [stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.kyc} data-step={stepId}>
      <div className={styles.metaBar}>
        {showBack ? (
          <button type="button" className={styles.backBtn} onClick={goBack}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
        ) : stepId === 'id-upload' ? (
          <button type="button" className={styles.backBtn} onClick={onBackToAwareness}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Awareness check
          </button>
        ) : <span aria-hidden="true" />}

        {!isTerminal && (
          <span className={styles.stepCount} aria-live="polite">
            Step {visibleStepIdx + 1} of {totalSteps} · {STEPS[visibleStepIdx]?.label}
          </span>
        )}
      </div>

      <div className={styles.stepHost}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={stepId}
            custom={direction}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              opacity: { duration: 0.3, ease: EASE_OUT_EXPO },
              y: { duration: 0.45, ease: EASE_OUT_EXPO },
            }}
            className={styles.stepInner}
          >
            {stepNode}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );

  function renderStep() {
    switch (stepId) {
      case 'id-upload':
        return <IdUploadStep onNext={goNext} />;
      case 'review':
        return <ReviewStep onNext={goNext} />;
      case 'nira':
        return (
          <NiraStep
            onNext={goNext}
            onEdit={() => goTo('review')}
            onAgentFallback={() =>
              routeToAgent('NIRA could not verify the subscriber from the details provided.', 'nira')
            }
          />
        );
      case 'otp':
        return <OtpStep onNext={goNext} />;
      case 'liveness':
        return (
          <LivenessStep
            onNext={goNext}
            onAgentFallback={() =>
              routeToAgent('Biometric verification could not be completed.', 'liveness')
            }
          />
        );
      case 'aml':
        return <AmlStep onNext={goNext} onFlagged={routeToPendingReview} />;
      case 'beneficiaries':
        return <BeneficiariesStep onNext={goNext} />;
      case 'consent':
        return <ConsentStep onActivate={async () => goNext()} />;
      case AGENT_STEP:
        return <ManualReviewCard onComplete={onExit} title="Manual review needed" reason={signup.failureReason} />;
      case PENDING_REVIEW_STEP:
        return <ManualReviewCard onComplete={onExit} title="Flagged for compliance review" reason="The subscriber matched a watchlist entry. The compliance team will review and follow up." />;
      default:
        return null;
    }
  }
}

/**
 * Inline replacement for the AgentFallbackStep / PendingReviewStep terminal
 * screens. Those screens are designed for a subscriber who hit a dead end and
 * needs to reach a human; in the agent context the agent IS the human, so we
 * render a compact card that captures the situation. This is a hard stop: KYC
 * never cleared, so onComplete here exits the flow back to the dashboard
 * WITHOUT creating a subscriber (no schedule step, no OnboardingComplete) — a
 * failed/flagged applicant must not be written as an active, KYC-complete member.
 */
function ManualReviewCard({ title, reason, onComplete }) {
  return (
    <div className={styles.terminal}>
      <div className={styles.terminalIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 7v5M12 16v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className={styles.terminalTitle}>{title}</h3>
      <p className={styles.terminalText}>{reason || 'Onboarding could not be completed automatically.'}</p>
      <p className={styles.terminalSub}>
        We&apos;ve logged the case for follow-up. The subscriber will be contacted within 1–2 business days. You can close this onboarding session.
      </p>
      <button type="button" className={styles.terminalBtn} onClick={onComplete}>
        End onboarding
      </button>
    </div>
  );
}
