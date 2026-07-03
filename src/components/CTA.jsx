import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../utils/motion';

import { SUPPORT_WHATSAPP_URL } from '../config/env';
import styles from './CTA.module.css';

export default function CTA() {
  const navigate = useNavigate();

  return (
    <section className={styles.section} id="start">
      <div className="container">
        <motion.div
          className={styles.card}
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: EASE_OUT_EXPO }}
        >
          <div className={styles.bg} aria-hidden="true">
            <div className={styles.orb1} />
            <div className={styles.orb2} />
          </div>

          <div className={styles.content}>
            <div className={styles.badge}>
              <span className={styles.dot} />
              From UGX 5,000/month. Start anytime.
            </div>
            <h2 className={styles.heading}>
              The best time to start saving
              <br />
              <span className={styles.accent}>was yesterday. Today is second best.</span>
            </h2>
            <p className={styles.subtext}>
              Open your Universal Pensions account in minutes.
              No paperwork, no branch visit. Start from just UGX 5,000 a month.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => navigate('/signup')}
              >
                Open your account
              </button>
              <a
                href={SUPPORT_WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className={styles.secondaryBtn}
              >
                Talk to an agent
              </a>
            </div>
          </div>

          <div className={styles.visual} aria-hidden="true">
            <div className={styles.card1}>
              <div className={styles.cardMini}>
                <div className={styles.miniLabel}>Projected balance at 65</div>
                <div className={styles.miniValue}>UGX 32M</div>
                <div className={styles.miniBadge}>
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 8l2.5-3 2 2 3.5-5" stroke="#2E8B57" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Starting today
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
