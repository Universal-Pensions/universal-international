import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Install-prompt plumbing for the mobile landing "Add to Home Screen" affordances
 * (banner + Install sheet + Menu row). Greenfield — the app had no
 * `beforeinstallprompt` handling.
 *
 * Behaviour:
 *  - Captures + defers the Chromium `beforeinstallprompt` event so we can fire the
 *    native prompt on our own button (`promptInstall()`), exposing `canInstall`.
 *  - iOS/Safari never fires the event → `platform === 'ios'` drives the manual
 *    Share-sheet instructions instead.
 *  - Suppresses everything once installed (`appinstalled`) or already running
 *    standalone (`display-mode: standalone` / iOS `navigator.standalone`).
 *  - Remembers a banner dismissal in localStorage so it doesn't re-nag every load.
 *
 * NOTE: `beforeinstallprompt` only fires in an installable context (HTTPS + a
 * registered SW + manifest). `registerSW` is prod-only, so in dev/preview the
 * Android native path won't appear — only the iOS manual instructions do.
 */

const DISMISS_KEY = 'up-landing-install-dismissed';

const InstallPromptContext = createContext({
  platform: 'other',
  canInstall: false,
  isStandalone: false,
  installed: false,
  dismissed: false,
  showBanner: false,
  promptInstall: async () => null,
  dismissBanner: () => {},
});

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari's non-standard flag
    window.navigator?.standalone === true
  );
}

function readDismissed() {
  try {
    return window.localStorage?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallPromptProvider({ children }) {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [platform] = useState(detectPlatform);
  const [isStandalone] = useState(detectStandalone);

  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      setDeferred(e);
    }
    function onAppInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return null;
    deferred.prompt();
    let outcome = null;
    try {
      const choice = await deferred.userChoice;
      outcome = choice?.outcome ?? null;
    } catch {
      outcome = null;
    }
    setDeferred(null);
    if (outcome === 'accepted') setInstalled(true);
    return outcome;
  }, [deferred]);

  const dismissBanner = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage?.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode / storage disabled — dismissal just won't persist */
    }
  }, []);

  const canInstall = deferred != null;
  const showBanner =
    !installed && !isStandalone && !dismissed && (canInstall || platform === 'ios');

  const value = useMemo(
    () => ({
      platform,
      canInstall,
      isStandalone,
      installed,
      dismissed,
      showBanner,
      promptInstall,
      dismissBanner,
    }),
    [platform, canInstall, isStandalone, installed, dismissed, showBanner, promptInstall, dismissBanner],
  );

  return <InstallPromptContext value={value}>{children}</InstallPromptContext>;
}

export function useInstallPrompt() {
  return useContext(InstallPromptContext);
}
