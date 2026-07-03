import { useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';

import styles from './ForYou.module.css';

const SubscriberIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
    <path d="M4 21v-1a8 8 0 0116 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const EmployerIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
    <rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
    <path d="M9 8h2M13 8h2M9 12h2M13 12h2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M10 21v-3h4v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AgentIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
    <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.75" />
    <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <circle cx="18" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.75" />
    <path d="M21 21v-1.5a3 3 0 00-3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const ROLES = [
  {
    id: 'subscriber',
    label: 'Individuals',
    icon: SubscriberIcon,
    headline: 'Save for yourself.',
    desc: 'Whether you are a gig worker, farmer, or self-employed — Universal Pensions is built for you. Start small, stay consistent, and build long-term security.',
    features: [
      'Personal savings dashboard',
      'Flexible contribution amounts',
      'Progress tracking and projections',
      'Mobile and web access',
      'Instant contribution confirmation',
    ],
    cta: 'Open your account',
    bg: 'var(--color-cloud)',
    accent: 'var(--color-indigo)',
  },
  {
    id: 'employer',
    label: 'Employers',
    icon: EmployerIcon,
    headline: 'Invest in your team.',
    desc: 'Enrol your employees, manage bulk contributions, and track participation — all in one clean, low-friction workspace.',
    features: [
      'Employee enrolment management',
      'Bulk contribution uploads',
      'Participation and compliance reporting',
      'Payroll integration support',
      'Dedicated employer dashboard',
    ],
    cta: 'Set up for your company',
    bg: '#EEF0FA',
    accent: 'var(--color-indigo)',
  },
  {
    id: 'agent',
    label: 'Agents',
    icon: AgentIcon,
    headline: 'Help others secure their future.',
    desc: 'Guide subscribers through registration, contributions, and basic servicing. Fast, mobile-ready tools built for the field.',
    features: [
      'Guided onboarding workflows',
      'Mobile-optimised interface',
      'Subscriber status tracking',
      'Task and action queue',
      'Offline-capable key flows',
    ],
    cta: 'Become an agent',
    bg: '#EBF6F2',
    accent: '#2E8B57',
  },
];

export default function ForYou() {
  // Deep-link the audience tab via ?aud= (the footer's "For employers" / "For
  // agents" links), falling back to Individuals. Read once for the initial tab;
  // clicking the tabs afterwards just updates local state.
  const [searchParams] = useSearchParams();
  const [active, setActive] = useState(() => {
    const aud = searchParams.get('aud');
    return ROLES.some((r) => r.id === aud) ? aud : 'subscriber';
  });
  const role = ROLES.find((r) => r.id === active);
  const tabRefs = useRef([]);

  const handleTabKeyDown = useCallback((e, index) => {
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = (index + 1) % ROLES.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = (index - 1 + ROLES.length) % ROLES.length;
    } else {
      return;
    }
    setActive(ROLES[next].id);
    tabRefs.current[next]?.focus();
  }, []);

  return (
    <section className={styles.section} id="for-you">
      <div className="container">
        <motion.div
          className={styles.header}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
        >
          <div className={styles.sectionTag}>Built for everyone</div>
          <h2 className={styles.heading}>
            Universal Pensions
            <br />
            <span className={styles.headingAccent}>is built for you.</span>
          </h2>
          <p className={styles.subtext}>
            Whether you are saving for yourself, managing a team, or helping others —
            each role has its own tailored experience.
          </p>
        </motion.div>

        <div className={styles.tabs} role="tablist" aria-label="User roles">
          {ROLES.map((r, index) => (
            <button
              key={r.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              id={`tab-${r.id}`}
              role="tab"
              aria-selected={active === r.id}
              aria-controls="foryou-tabpanel"
              tabIndex={active === r.id ? 0 : -1}
              className={styles.tab}
              data-active={active === r.id}
              onClick={() => setActive(r.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
            >
              <span className={styles.tabIcon}>{r.icon}</span>
              {r.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className={styles.panel}
            style={{ '--panel-bg': role.bg, '--panel-accent': role.accent }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
            id="foryou-tabpanel"
            role="tabpanel"
            aria-labelledby={`tab-${active}`}
          >
            <div className={styles.panelLeft}>
              <h3 className={styles.panelHeadline}>{role.headline}</h3>
              <p className={styles.panelDesc}>{role.desc}</p>
              <a href={`#${role.id}`} className={styles.panelCta}>{role.cta}</a>
            </div>
            <div className={styles.panelRight}>
              <ul className={styles.featureList} aria-label={`${role.label} features`}>
                {role.features.map((f, i) => (
                  <motion.li
                    key={f}
                    className={styles.featureItem}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07, duration: 0.5, ease: EASE_OUT_EXPO }}
                  >
                    <span className={styles.featureCheck} aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    {f}
                  </motion.li>
                ))}
              </ul>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
