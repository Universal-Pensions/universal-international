import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useSignup } from '../SignupContext';
import { useOnboardAudience } from '../OnboardAudienceContext';
import { screenAml } from '../../services/kyc';
import EducationalLoader from '../EducationalLoader';
import styles from './Step.module.css';
import own from './AmlStep.module.css';

export default function AmlStep({ onNext, onFlagged }) {
  const signup = useSignup();
  const isAgent = useOnboardAudience() === 'agent';
  const [state, setState] = useState('running');

  useEffect(() => {
    if (signup.amlResult === 'clear') {
      setState('cleared');
      const t = setTimeout(onNext, 1100);
      return () => clearTimeout(t);
    }
    if (signup.amlResult === 'flagged') {
      onFlagged();
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await screenAml({
          fullName: signup.fullName,
          dob: signup.dob,
          nin: signup.nin,
          sessionId: signup.onboardingSessionId,
          niraTrackingId: signup.niraTrackingId,
        });
        if (cancelled) return;
        signup.patch({
          amlResult: res.outcome,
          amlTrackingId: res.trackingId,
        });
        if (res.outcome === 'clear') {
          setState('cleared');
          setTimeout(() => { if (!cancelled) onNext(); }, 1100);
        } else {
          setTimeout(() => { if (!cancelled) onFlagged(); }, 500);
        }
      } catch {
        // Fail-safe: treat an unknown result as flagged so we don't auto-approve anyone
        if (cancelled) return;
        signup.patch({ amlResult: 'flagged' });
        setTimeout(() => { if (!cancelled) onFlagged(); }, 500);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'cleared') {
    return (
      <div className={styles.card}>
        <motion.div
          className={own.resultIcon}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
        >
          <svg viewBox="0 0 56 56" width="56" height="56" fill="none" aria-hidden="true">
            <circle className={own.iconRing} cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2.5"/>
            <motion.path
              d="M17 28l7 7 15-16"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.45, delay: 0.15, ease: EASE_OUT_EXPO }}
            />
          </svg>
        </motion.div>
        <h2 className={`${styles.heading} textCenter`}>Background check passed</h2>
        <p className={`${styles.subtext} textCenter`} role="status">
          {isAgent ? 'Cleared. Moving on to beneficiaries…' : "You're cleared. Moving on to beneficiaries…"}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {/* 42px ring spinner (subscriber re-skin; hidden in the agent flows). */}
      <span className={own.spin} aria-hidden="true" />
      <h2 className={`${styles.heading} ${own.runningHead}`}>
        {isAgent ? 'Screening compliance lists' : 'Running a quick compliance check'}
      </h2>
      <p className={`${styles.subtext} ${own.runningSub}`}>
        This usually takes a few seconds. Here&rsquo;s why this step matters.
      </p>
      <EducationalLoader />
      {/* Informational help — flagging is routed automatically (onFlagged), so
          this is a reassurance affordance, not a navigation link. */}
      <details className={own.helpLine}>
        <summary>What if I&rsquo;m flagged for review?</summary>
        <p>
          If anything needs a closer look, our compliance team reviews it
          manually — usually within a few business days. You&rsquo;ll be
          contacted by SMS, and there&rsquo;s nothing you need to do right now.
        </p>
      </details>
    </div>
  );
}
