import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useSignup } from '../../signup/SignupContext';
import { OnboardAudienceProvider } from '../../signup/OnboardAudienceContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import PageHeader from '../../components/PageHeader';
import AwarenessCheck from './AwarenessCheck';
import OnboardKycFlow from './OnboardKycFlow';
import OnboardScheduleStep from './OnboardScheduleStep';
import OnboardingComplete from './OnboardingComplete';
import styles from '../pages/OnboardPage.module.css';

const STAGES = [
  { id: 'awareness', label: 'Awareness' },
  { id: 'kyc', label: 'KYC' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'done', label: 'Complete' },
];

function getStageIndex(id) {
  return STAGES.findIndex((s) => s.id === id);
}

export default function OnboardFlow() {
  const navigate = useNavigate();
  const signup = useSignup();
  // The desktop chrome (OnboardDesktop) relies on this flow's own PageHeader for
  // the page <h1>. On mobile the persistent app bar owns the title, so the header
  // is hidden there (the stepper below still conveys progress).
  const isDesktop = useIsDesktop();
  const [stage, setStage] = useState('awareness');
  const [awareness, setAwareness] = useState({
    answers: { q1: null, q2: null, q3: null, q4: null, q5: null },
  });

  const stageIdx = getStageIndex(stage);
  const subscriberName = (signup.fullName || '').trim();

  function startAnother() {
    signup.reset();
    setStage('awareness');
    setAwareness({
      answers: { q1: null, q2: null, q3: null, q4: null, q5: null },
    });
  }

  function handleClose() {
    // A11-002: nin/idConfidence are NOT in SignupContext's EPHEMERAL_KEYS, so
    // without a reset they'd survive in localStorage — and ReviewStep skips
    // OCR entirely whenever idConfidence is already set. Without this line,
    // Close (on success OR on a manual-review/error terminal) would leave the
    // JUST-USED identity sitting there for the next visit to /dashboard/onboard
    // to silently replay, 409-ing on the same NIN all over again. reset()
    // mints a fresh onboardingSessionId + signupNonce too, exactly like
    // startAnother() below — Close is just the "abandon this attempt" exit,
    // so it gets the identical clean slate.
    signup.reset();
    navigate('/dashboard');
  }

  return (
    <OnboardAudienceProvider value="agent">
    <div className={styles.page} data-stage={stage}>
      {isDesktop && (
        // Plain title only (matches the v3 mockup). The 4-stage stepper below
        // already conveys position, and the KYC meta-bar owns "Step N of 8" +
        // step-back — so the header's own back chevron + "N of 4" subtitle would
        // just be redundant navigation. Hidden here to avoid the double back.
        <PageHeader title="Onboard a new subscriber" showBack={false} />
      )}

      <ol className={styles.stepper} aria-label="Onboarding progress">
        {STAGES.map((s, i) => {
          const state = i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'pending';
          return (
            <li key={s.id} className={styles.stepperItem} data-state={state}>
              <span className={styles.stepperDot} aria-hidden="true">
                {state === 'done' ? (
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
                    <path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={styles.stepperLabel}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div className={styles.body}>
        <AnimatePresence mode="wait">
          {stage === 'awareness' && (
            <motion.div
              key="awareness"
              className={styles.stageWrap}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            >
              <AwarenessCheck
                state={awareness}
                onChange={setAwareness}
                onContinue={() => setStage('kyc')}
              />
            </motion.div>
          )}

          {stage === 'kyc' && (
            <motion.div
              key="kyc"
              className={styles.stageWrap}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            >
              <OnboardKycFlow
                onComplete={() => setStage('schedule')}
                onBackToAwareness={() => setStage('awareness')}
                onExit={handleClose}
              />
            </motion.div>
          )}

          {stage === 'schedule' && (
            <motion.div
              key="schedule"
              className={styles.stageWrap}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            >
              <OnboardScheduleStep
                onContinue={() => setStage('done')}
                onCancel={() => setStage('kyc')}
              />
            </motion.div>
          )}

          {stage === 'done' && (
            <motion.div
              key="done"
              className={styles.stageWrap}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            >
              <OnboardingComplete
                subscriberName={subscriberName || 'New Subscriber'}
                awareness={awareness}
                schedule={signup.contributionSchedule}
                onAnother={startAnother}
                onClose={handleClose}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </OnboardAudienceProvider>
  );
}
