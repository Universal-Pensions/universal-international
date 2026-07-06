import { useEffect, useState } from 'react';
import { useInstallPrompt } from './installPrompt';
import styles from '../mobile/landingMobile.module.css';

// Once the page is scrolled past this many px, the banner tucks away so it stops
// covering content while the user navigates. It slides back in at the top. (The
// X button is the permanent dismissal — this is just a temporary get-out-of-the-way.)
const HIDE_AFTER = 60;

/**
 * InstallBanner — a dismissible "Add to Home Screen" prompt pinned above the
 * action bar. Only renders when the install context says it's worth showing
 * (installable or iOS, not already installed/standalone, not dismissed). Tapping
 * Install opens the Install sheet (native prompt on Android, steps on iOS).
 * Auto-hides on scroll (reappears at the top) so it doesn't hinder navigation.
 */
export default function InstallBanner({ onOpenInstall }) {
  const { showBanner, dismissBanner } = useInstallPrompt();
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolledPast(window.scrollY > HIDE_AFTER);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!showBanner) return null;

  return (
    <div
      className={`${styles.installBanner}${scrolledPast ? ` ${styles.installBannerHidden}` : ''}`}
      role="region"
      aria-label="Install app"
      inert={scrolledPast || undefined}
    >
      <span className={styles.ib}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </span>
      <div className={styles.ibT}>
        <b>Add to Home Screen</b>
        <small>Install the app for one-tap access</small>
      </div>
      <button type="button" className={styles.ibAdd} onClick={onOpenInstall}>Install</button>
      <button type="button" className={styles.ibX} aria-label="Dismiss" onClick={dismissBanner}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
