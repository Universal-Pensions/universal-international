import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { useInstallPrompt } from './installPrompt';
import styles from '../mobile/landingMobile.module.css';

const InstallIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M5 12l7 7 7-7" />
  </svg>
);

const STEPS = {
  ios: [
    ['1', 'Tap the Share button', 'In Safari, tap the Share icon in the toolbar.'],
    ['2', 'Choose "Add to Home Screen"', 'Scroll the share sheet and tap the option.'],
    ['3', 'Tap Add', 'Universal Pensions appears on your home screen.'],
  ],
  android: [
    ['1', 'Open the browser menu', 'Tap the three-dot menu in Chrome.'],
    ['2', 'Tap "Install app"', 'Or "Add to Home screen" on some devices.'],
    ['3', 'Confirm', 'Universal Pensions installs like a native app.'],
  ],
};

/**
 * LandingInstallSheet — "Add to Home Screen". When the Chromium native prompt is
 * available (`canInstall`), offers a one-tap Install button that fires it;
 * otherwise shows platform-specific manual instructions (the only path on iOS).
 */
export default function LandingInstallSheet({ open, onClose }) {
  const { platform, canInstall, promptInstall } = useInstallPrompt();
  const [os, setOs] = useState(platform === 'android' ? 'android' : 'ios');
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset the platform tab when the sheet (re)opens — derived at render time.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setOs(platform === 'android' ? 'android' : 'ios');
  }

  async function install() {
    await promptInstall();
    onClose?.();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add to Home Screen" icon={InstallIcon}>
      <div className={styles.sheetVars}>
        <p className={styles.siSub}>Install for one-tap access and faster loads.</p>

        {canInstall && (
          <button
            type="button"
            className={`${styles.btn} ${styles['btn-pri']} ${styles['btn-block']}`}
            style={{ marginBottom: 16 }}
            onClick={install}
          >
            {InstallIcon}
            Install app
          </button>
        )}

        <div className={styles.instTabs} role="group" aria-label="Device platform">
          <button type="button" className={`${styles.instTab}${os === 'ios' ? ` ${styles.on}` : ''}`} aria-pressed={os === 'ios'} onClick={() => setOs('ios')}>iPhone</button>
          <button type="button" className={`${styles.instTab}${os === 'android' ? ` ${styles.on}` : ''}`} aria-pressed={os === 'android'} onClick={() => setOs('android')}>Android</button>
        </div>

        <div>
          {STEPS[os].map((s) => (
            <div key={s[0]} className={styles.instStep}>
              <span className={styles.isn}>{s[0]}</span>
              <div>
                <b>{s[1]}</b>
                <p>{s[2]}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className={`${styles.btn} ${styles['btn-sec']} ${styles['btn-block']}`}
          style={{ marginTop: 16 }}
          onClick={onClose}
        >
          Maybe later
        </button>
      </div>
    </BottomSheet>
  );
}
