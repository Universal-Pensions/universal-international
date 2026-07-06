import { useNavigate } from 'react-router-dom';
import BottomSheet from './BottomSheet';
import styles from '../mobile/landingMobile.module.css';

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const Chevron = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const AUDIENCES = [
  {
    key: 'sub', path: '/', label: 'Individuals', tint: styles['t-in'],
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  },
  {
    key: 'emp', path: '/employers', label: 'Employers', tint: styles['t-green'],
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6" /></svg>,
  },
  {
    key: 'dist', path: '/distributors', label: 'Distributors', tint: styles['t-teal'],
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>,
  },
];

const LINKS = [
  {
    path: '/about', label: 'About us',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>,
  },
  {
    path: '/faq', label: 'FAQ',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></svg>,
  },
  {
    path: '/contact', label: 'Contact',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
  },
];

const AdminIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

const InstallIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
);

/**
 * LandingMenuSheet — the "More" sheet: switch audience (routes to a home),
 * jump to About/FAQ/Contact, add-to-home-screen, the discreet admin portal,
 * and legal links. All navigation closes the sheet.
 */
export default function LandingMenuSheet({ open, onClose, audience, onOpenInstall }) {
  const navigate = useNavigate();
  const go = (path) => {
    onClose?.();
    navigate(path);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Menu" icon={MenuIcon}>
      <div className={styles.sheetVars}>
        <span className={styles.flabel}>Choose your platform</span>
        <div className={styles.menuAud}>
          {AUDIENCES.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`${styles.menuAudBtn}${audience === a.key ? ` ${styles.on}` : ''}`}
              aria-current={audience === a.key ? 'page' : undefined}
              onClick={() => go(a.path)}
            >
              <span className={`${styles.ma} ${a.tint}`}>{a.icon}</span>
              <b>{a.label}</b>
            </button>
          ))}
        </div>

        {LINKS.map((l) => (
          <button key={l.path} type="button" className={styles.menuRow} onClick={() => go(l.path)}>
            <span className={styles.mIc}>{l.icon}</span>
            <b>{l.label}</b>
            <span className={styles.mChev}>{Chevron}</span>
          </button>
        ))}

        <button
          type="button"
          className={styles.menuRow}
          onClick={() => {
            onClose?.();
            onOpenInstall?.();
          }}
        >
          <span className={styles.mIc}>{InstallIcon}</span>
          <b>Add to Home Screen</b>
          <span className={styles.mChev}>{Chevron}</span>
        </button>

        <button type="button" className={styles.menuRow} onClick={() => go('/admin')}>
          <span className={styles.mIc}>{AdminIcon}</span>
          <b>Admin portal</b>
          <span className={styles.mChev}>{Chevron}</span>
        </button>

        <div className={styles.menuLegal}>
          <a href="#" onClick={(e) => e.preventDefault()}>Terms</a>
          <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a>
          <a href="#" onClick={(e) => e.preventDefault()}>Legal</a>
          <a href="#" onClick={(e) => e.preventDefault()}>URBRA licence</a>
        </div>
      </div>
    </BottomSheet>
  );
}
