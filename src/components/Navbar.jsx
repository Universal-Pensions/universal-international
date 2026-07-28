import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';

import { useSignIn } from '../contexts/SignInContext';
import logo from '../assets/logo.png';
import styles from './Navbar.module.css';

// This legacy header renders on the support pages (Contact / FAQ / About). Its
// original links pointed at #how-it-works / #for-you / … section anchors and
// the CTA at #start — but those sections live only in the retired old-landing
// components (unmounted since the React landing shipped), so on these routes
// they resolved to nothing. Repoint at the live audience routes + /signup —
// the same destinations the current LandingNav uses — as real router links.
// The fourth tab, Administrator, is the head-office console's landing page; it
// used to sit as a discreet "Admin" link in the footer and now rides here with
// the other audiences (the bare sign-in portal moved to /admin/login).
const NAV_LINKS = [
  { to: '/',             label: 'Subscribers' },
  { to: '/employers',    label: 'Employers' },
  { to: '/distributors', label: 'Distributors' },
  { to: '/admin',        label: 'Administrator' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { scrollY } = useScroll();
  const signIn = useSignIn();

  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 40);
  });

  // Stable callbacks — the JSX below passes these to multiple children
  // (the overlay, every drawer link, the drawer Sign in/CTA), so allocating
  // fresh arrows each render would force every consumer to re-attach its
  // listener. Wrapping in `useCallback` keeps the identity stable across
  // renders so React can skip those updates.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((open) => !open);
  }, []);

  const handleSignIn = useCallback(() => {
    signIn.open();
  }, [signIn]);

  const handleDrawerSignIn = useCallback(() => {
    closeMenu();
    signIn.open();
  }, [closeMenu, signIn]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleEsc(e) {
      if (e.key === 'Escape') closeMenu();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [menuOpen, closeMenu]);

  return (
    <>
      <motion.nav
        className={styles.nav}
        data-scrolled={scrolled}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
      >
        <div className={styles.inner}>
          <a href="/" className={styles.logo} aria-label="Universal Pensions home">
            <img src={logo} alt="Universal Pensions" className={styles.logoImg} width={120} height={36} />
          </a>

          {/* Desktop links */}
          <nav className={styles.links} aria-label="Main navigation">
            {NAV_LINKS.map(l => (
              <Link key={l.to} to={l.to} className={styles.link}>{l.label}</Link>
            ))}
          </nav>

          <div className={styles.actions}>
            <button className={styles.signIn} onClick={handleSignIn}>Sign in</button>
            <Link to="/signup" className={styles.cta}>Start saving</Link>
          </div>

          {/* Hamburger button — mobile only */}
          <button
            className={styles.burger}
            onClick={toggleMenu}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <span className={styles.burgerLine} data-open={menuOpen} />
            <span className={styles.burgerLine} data-open={menuOpen} />
            <span className={styles.burgerLine} data-open={menuOpen} />
          </button>
        </div>
      </motion.nav>

      {/* Mobile drawer */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              className={styles.overlay}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={closeMenu}
              aria-hidden="true"
            />
            <motion.div
              className={styles.drawer}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            >
              <nav className={styles.drawerNav} aria-label="Mobile navigation">
                {NAV_LINKS.map(l => (
                  <Link key={l.to} to={l.to} className={styles.drawerLink} onClick={closeMenu}>
                    {l.label}
                  </Link>
                ))}
              </nav>
              <div className={styles.drawerActions}>
                <button className={styles.drawerSignIn} onClick={handleDrawerSignIn}>Sign in</button>
                <Link to="/signup" className={styles.drawerCta} onClick={closeMenu}>Start saving</Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
