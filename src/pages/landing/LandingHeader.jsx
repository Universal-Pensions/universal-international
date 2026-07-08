import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignIn } from '../../contexts/SignInContext';
import logo from '../../assets/logo.png';
import styles from './landing.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);

// Shared marketing-site header (nav + mobile drawer), used by every landing
// audience page. `active` drives the aria-current tab; the logo is the real
// brand lockup (assets/logo.png) — mirrors how Footer renders logo-white.png.
const AUDIENCES = [
  { to: '/', key: 'subscribers', label: 'For Subscribers' },
  { to: '/employers', key: 'employers', label: 'For Employers' },
  { to: '/distributors', key: 'distributors', label: 'For Distributors' },
];

export default function LandingHeader({ active = 'subscribers', ctaLabel = 'Start saving' }) {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const [drawer, setDrawer] = useState(false);

  const startSaving = () => navigate('/signup');

  // Body scroll-lock + Escape-to-close while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    if (!drawer) return () => { document.body.style.overflow = ''; };
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  }, [drawer]);

  return (
    <>
      <header className={styles.nav}>
        <div className={cx(styles.wrap, styles.navIn)}>
          <Link className={styles.brand} to="/" aria-label="Universal Pensions home">
            <img src={logo} alt="Universal Pensions" className={styles.logoImg} width={112} height={45} />
          </Link>
          <nav className={styles.navLinks} aria-label="Platform audiences">
            {AUDIENCES.map(a => (
              <Link key={a.key} to={a.to} aria-current={active === a.key ? 'page' : undefined}>{a.label}</Link>
            ))}
          </nav>
          <div className={styles.navActions}>
            <button type="button" className={styles.navSignin} onClick={() => signIn.open()}>Sign in</button>
            <button type="button" className={cx(styles.btn, styles.btnPrimary, styles.btnSm)} onClick={startSaving}>{ctaLabel} <Arrow /></button>
            <button className={styles.hamburger} aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* mobile drawer */}
      <button type="button" aria-label="Close menu" tabIndex={drawer ? 0 : -1} className={cx(styles.drawerScrim, drawer && styles.open)} onClick={() => setDrawer(false)} />
      <aside className={cx(styles.drawer, drawer && styles.open)} role="dialog" aria-modal="true" aria-label="Mobile navigation" aria-hidden={!drawer}>
        <div className={styles.drawerTop}>
          <Link className={styles.brand} to="/" onClick={() => setDrawer(false)} aria-label="Universal Pensions home">
            <img src={logo} alt="Universal Pensions" className={styles.logoImg} width={112} height={45} />
          </Link>
          <button className={styles.xBtn} aria-label="Close menu" onClick={() => setDrawer(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {AUDIENCES.map(a => (
          <Link key={a.key} className={styles.dlink} to={a.to} aria-current={active === a.key ? 'page' : undefined} onClick={() => setDrawer(false)}>{a.label}</Link>
        ))}
        <div className={styles.drawerCta}>
          <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={() => { setDrawer(false); signIn.open(); }}>Sign in</button>
          <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={() => { setDrawer(false); startSaving(); }}>{ctaLabel}</button>
        </div>
      </aside>
    </>
  );
}
