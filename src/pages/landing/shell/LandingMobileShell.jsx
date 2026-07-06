import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../../utils/motion';
import { useSignIn } from '../../../contexts/SignInContext';
import logo from '../../../assets/logo.png';

import { InstallPromptProvider } from './installPrompt';
import LandingMenuSheet from './LandingMenuSheet';
import LandingInstallSheet from './LandingInstallSheet';
import CalculatorSheet from './CalculatorSheet';
import InstallBanner from './InstallBanner';

import SubscribersMobile from '../mobile/SubscribersMobile';
import EmployersMobile from '../mobile/EmployersMobile';
import DistributorsMobile from '../mobile/DistributorsMobile';
import AboutMobile from '../mobile/AboutMobile';
import FAQMobile from '../mobile/FAQMobile';
import ContactMobile from '../mobile/ContactMobile';
import RequestAccessMobile from '../mobile/RequestAccessMobile';

import styles from '../mobile/landingMobile.module.css';

// The 7 landing paths → their phone screen. Picked by pathname (no nested
// <Routes>, so there's no base-path ambiguity under the pathless layout route).
const SCREENS = {
  '/': SubscribersMobile,
  '/employers': EmployersMobile,
  '/distributors': DistributorsMobile,
  '/about': AboutMobile,
  '/faq': FAQMobile,
  '/contact': ContactMobile,
  '/request-access': RequestAccessMobile,
};

// Which paths are audience "homes" (drive the app-bar logo + action-bar CTAs).
const HOME_AUD = { '/': 'sub', '/employers': 'emp', '/distributors': 'dist' };
const AUD_HOME = { sub: '/', emp: '/employers', dist: '/distributors' };
const TITLES = {
  '/about': 'About',
  '/faq': 'FAQ',
  '/contact': 'Contact',
  '/request-access': 'Request access',
};

// Action-bar copy + destinations per audience (mirrors the mockup's AUD_CTA).
const AUD_CTA = {
  sub: { pri: 'Start saving', priTo: '/signup', sec: 'Sign in', role: 'subscriber' },
  emp: { pri: 'Set up your company', priTo: '/request-access?type=employer', sec: 'Log in', role: 'employer' },
  dist: { pri: 'Become a partner', priTo: '/request-access?type=distributor', sec: 'Log in', role: 'distributor' },
};

const BackIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const MenuIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

function ShellInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const path = location.pathname;

  const [audience, setAudience] = useState(HOME_AUD[path] || 'sub');
  const [seenPath, setSeenPath] = useState(path);
  const [menuOpen, setMenuOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [frost, setFrost] = useState(false);

  // Audience follows the home routes; support pages inherit the last one. Derived
  // at render time (not in an effect) via the "info from previous renders" pattern.
  if (path !== seenPath) {
    setSeenPath(path);
    if (HOME_AUD[path]) setAudience(HOME_AUD[path]);
  }

  // Frost the app bar once the page scrolls (normal document scroll).
  useEffect(() => {
    const onScroll = () => setFrost(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const openCalc = useCallback(() => setCalcOpen(true), []);
  const openInstall = useCallback(() => setInstallOpen(true), []);

  const isHome = path in HOME_AUD;
  const cta = AUD_CTA[audience];
  const showActionBar = path !== '/request-access';

  const Screen = SCREENS[path] || SubscribersMobile;

  const appBarLeft = useMemo(() => {
    if (isHome) {
      return <img className={styles.logoImg} src={logo} alt="Universal Pensions" />;
    }
    return (
      <>
        <button
          type="button"
          className={styles.backBtn}
          aria-label="Back"
          onClick={() => navigate(AUD_HOME[audience])}
        >
          {BackIcon}
        </button>
        <span className={styles.abTitle}>{TITLES[path] || ''}</span>
      </>
    );
  }, [isHome, path, audience, navigate]);

  return (
    <div className={styles.shell}>
      <header className={`${styles.appbar}${frost ? ` ${styles.frost}` : ''}`} data-testid="landing-appbar">
        <div className={styles.appbarInner}>
          <div className={styles.abLeft}>{appBarLeft}</div>
          <button type="button" className={styles.iconBtn} aria-label="Menu" onClick={() => setMenuOpen(true)}>
            {MenuIcon}
          </button>
        </div>
      </header>

      <motion.div
        key={path}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
      >
        <Screen openCalc={openCalc} />
      </motion.div>

      {showActionBar && (
        <div className={styles.footcta} data-testid="landing-actionbar">
          <div className={styles.footctaInner}>
            <button
              type="button"
              className={`${styles.btn} ${styles['btn-sec']}`}
              onClick={() => signIn?.open(cta.role)}
            >
              {cta.sec}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles['btn-pri']}`}
              onClick={() => navigate(cta.priTo)}
            >
              {cta.pri}
            </button>
          </div>
        </div>
      )}

      <InstallBanner onOpenInstall={openInstall} />

      <LandingMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        audience={audience}
        onOpenInstall={openInstall}
      />
      <LandingInstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      <CalculatorSheet open={calcOpen} onClose={() => setCalcOpen(false)} />
    </div>
  );
}

/**
 * LandingMobileShell — the phone-native public-site app shell (<=768px). A fixed
 * frosting app bar + normal document-scroll body (routed by pathname to a
 * *Mobile screen) + an audience-aware fixed action bar, with Menu / Install /
 * Calculator bottom sheets and a dismissible install banner. Sign-in reuses the
 * global SignInModal. Desktop (>768px) never renders this — LandingLayout falls
 * back to <Outlet/> and the existing pages render unchanged.
 */
export default function LandingMobileShell() {
  return (
    <InstallPromptProvider>
      <ShellInner />
    </InstallPromptProvider>
  );
}
