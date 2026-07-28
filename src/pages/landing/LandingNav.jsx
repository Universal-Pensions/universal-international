import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useScroll, useMotionValueEvent } from 'framer-motion';
import logo from '../../assets/logo.png';
import styles from './landing.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);

const AUDIENCES = [
  { key: 'subscriber', to: '/', label: 'Subscribers' },
  { key: 'employer', to: '/employers', label: 'Employers' },
  { key: 'distributor', to: '/distributors', label: 'Distributors' },
  { key: 'admin', to: '/admin', label: 'Administrator' },
];

/**
 * Shared landing/marketing header + mobile drawer. Renders the real Universal
 * Pensions logo, the four audience tabs (with `active` driving aria-current),
 * a role-scoped "Sign in" action, and a primary CTA.
 *
 * @param {object} props
 * @param {'subscriber'|'employer'|'distributor'|'admin'} [props.active]
 * @param {() => void} props.onSignIn   what "Sign in" does on this page
 *   (subscriber: focus the hero Sign-in tab; B2B: scroll to the login card;
 *   marketing: open the sign-in modal).
 * @param {string} [props.ctaLabel]
 * @param {string} [props.ctaTo]
 */
export default function LandingNav({ active = 'subscriber', onSignIn, ctaLabel = 'Start saving', ctaTo = '/signup' }) {
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Merge the bar into the page at the top; frost it into a sticky bar on scroll.
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 24));

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    if (!drawer) return () => { document.body.style.overflow = ''; };
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  }, [drawer]);

  const handleSignIn = () => { setDrawer(false); onSignIn?.(); };

  return (
    <>
      <header className={styles.nav} data-scrolled={scrolled}>
        <div className={cx(styles.wrap, styles.navIn)}>
          <Link className={styles.brand} to="/" aria-label="Universal Pensions home">
            <img src={logo} alt="Universal Pensions" className={styles.brandLogo} width={120} height={36} />
          </Link>
          <nav className={styles.navLinks} aria-label="Platform audiences">
            {AUDIENCES.map((a) => (
              <Link key={a.key} to={a.to} aria-current={active === a.key ? 'page' : undefined}>{a.label}</Link>
            ))}
          </nav>
          <div className={styles.navActions}>
            <button type="button" className={styles.navSignin} onClick={onSignIn}>Sign in</button>
            <Link className={cx(styles.btn, styles.btnPrimary, styles.btnSm)} to={ctaTo}>{ctaLabel} <Arrow /></Link>
            <button className={styles.hamburger} aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </header>

      <button type="button" aria-label="Close menu" tabIndex={drawer ? 0 : -1} className={cx(styles.drawerScrim, drawer && styles.open)} onClick={() => setDrawer(false)} />
      <aside className={cx(styles.drawer, drawer && styles.open)} role="dialog" aria-modal="true" aria-label="Mobile navigation" aria-hidden={!drawer}>
        <div className={styles.drawerTop}>
          <img src={logo} alt="Universal Pensions" className={styles.brandLogo} width={110} height={33} />
          <button className={styles.xBtn} aria-label="Close menu" onClick={() => setDrawer(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {AUDIENCES.map((a) => (
          <Link key={a.key} className={styles.dlink} to={a.to} aria-current={active === a.key ? 'page' : undefined} onClick={() => setDrawer(false)}>{a.label}</Link>
        ))}
        <div className={styles.drawerCta}>
          <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={handleSignIn}>Sign in</button>
          <Link className={cx(styles.btn, styles.btnPrimary)} to={ctaTo} onClick={() => setDrawer(false)}>{ctaLabel}</Link>
        </div>
      </aside>
    </>
  );
}
