import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import styles from './RoleSelect.module.css';

const ROLES = [
  {
    id: 'subscriber', label: 'Subscriber', desc: 'Individual saver',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M5 21v-1a7 7 0 0114 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'employer', label: 'Employer', desc: 'Manage employee contributions',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
        <rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M3 10h18" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.75"/>
      </svg>
    ),
  },
  {
    id: 'distributor', label: 'Distributor', desc: 'Distribution network',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
        <circle cx="12" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="12" cy="21" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="3" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="21" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 4.5v4.5M12 15v4.5M4.5 12H9M15 12h4.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  // Admin is intentionally omitted — super-admin signs in only from the
  // dedicated /admin portal, not the generic role picker.
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT_EXPO } },
};

export default function RoleSelect({ onSelect }) {
  return (
    <div className={styles.wrapper}>
      <h2 className={styles.heading}>Welcome back</h2>
      <p className={styles.subtext}>Select your role to sign in.</p>

      <motion.div
        className={styles.grid}
        variants={container}
        initial="hidden"
        animate="show"
      >
        {ROLES.map((role) => (
          <motion.button
            key={role.id}
            className={styles.card}
            variants={item}
            onClick={() => onSelect(role.id)}
            whileTap={{ scale: 0.97 }}
          >
            <span className={styles.icon}>{role.icon}</span>
            <span className={styles.label}>{role.label}</span>
            <span className={styles.desc}>{role.desc}</span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
