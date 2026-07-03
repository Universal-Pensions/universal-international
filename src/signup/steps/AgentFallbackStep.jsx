import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useSignup } from '../SignupContext';
import { referToAgent } from '../../services/kyc';
import styles from './Step.module.css';
import own from './AgentFallbackStep.module.css';

export default function AgentFallbackStep({ onExit }) {
  const { phone, failureReason, failureStage, onboardingSessionId } = useSignup();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    referToAgent({
      phone,
      reason: failureReason || 'Onboarding could not complete automatically',
      stage: failureStage,
      sessionId: onboardingSessionId,
    }).then((res) => {
      if (!cancelled) {
        setTicket(res);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [phone, failureReason, failureStage, onboardingSessionId]);

  return (
    <div className={styles.card}>
      <motion.div
        className={own.icon}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
      >
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" aria-hidden="true">
          <circle cx="12" cy="9" r="3.2" stroke="currentColor" strokeWidth="2" />
          <path d="M5.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </motion.div>

      <h2 className={`${styles.heading} textCenter`}>
        We’ll finish this with an agent
      </h2>
      <p className={`${styles.subtext} textCenter`}>
        {failureReason
          ? failureReason
          : 'NIRA could not verify your identity from the details provided.'} A field agent will contact you shortly to complete verification.
      </p>

      <div className={own.ticket} data-loading={loading || undefined}>
        {loading ? (
          <div className={own.ticketLoading}>
            <span className={own.spinner} aria-hidden="true" />
            <span>Booking an agent for you…</span>
          </div>
        ) : ticket ? (
          <>
            <div className={own.ticketRow}>
              <span className={own.ticketLabel}>Reference</span>
              <span className={own.ticketValue}>{ticket.ticketId}</span>
            </div>
            <div className={own.ticketRow}>
              <span className={own.ticketLabel}>Expected callback</span>
              <span className={own.ticketValue}>{ticket.eta}</span>
            </div>
            <div className={own.ticketRow}>
              <span className={own.ticketLabel}>Contact number</span>
              <span className={own.ticketValue}>+256 {phone || '—'}</span>
            </div>
          </>
        ) : (
          <p className={own.ticketFallback}>
            We couldn’t automatically book an agent. Please call <strong>+256 700 123 456</strong> to finish signing up.
          </p>
        )}
      </div>

      <div className={own.checklist}>
        <span className={own.checklistLabel}>Keep these ready for the agent</span>
        <ul>
          <li>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Your National ID (Ndaga Muntu) — original card, not a photocopy
          </li>
          <li>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Your mobile phone with this number active
          </li>
          <li>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            A letter from your LC1 or employer if available (optional, speeds things up)
          </li>
        </ul>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.submit} onClick={onExit}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to home
        </button>
      </div>
    </div>
  );
}
