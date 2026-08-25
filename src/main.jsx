import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryCache, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import * as Sentry from '@sentry/react';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ToastProvider, useToast } from './contexts/ToastContext.jsx';
import ToastContainer from './components/Toast.jsx';
import WarmupBanner from './components/WarmupBanner.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { scrubEvent, scrubBreadcrumb } from './utils/sentryScrub.js';
import { forwardSupabaseAuthError } from './services/supabaseClient.js';
import { getFriendlyErrorMessage } from './utils/friendlyError.js';
import { registerSW } from './pwa/registerSW.js';
import './index.css';
import App from './App.jsx';

// Frontend Sentry. Gated on VITE_SENTRY_DSN so the absence of the env var
// leaves the bundle inert (no side effects, no network). When the DSN is
// present we report unhandled errors + a small trace sample. The
// ErrorBoundary's componentDidCatch also forwards into this when configured.
//
// PII hardening (BL-26 / H-4): `beforeSend`/`beforeBreadcrumb` run the shared
// scrubber (`src/utils/sentryScrub.js`) which redacts Ugandan phone numbers,
// `role:phone` ids (the JWT `sub`), bearer tokens / JWTs, and password fields.
// `sendDefaultPii` stays explicitly false. `release`/`environment` tag events
// to a build + scope. `release` is optional: it reads VITE_SENTRY_RELEASE if a
// build wires it (e.g. to the commit SHA) — Vite only exposes VITE_*-prefixed
// vars to `import.meta.env`, so platform SHAs aren't auto-available here.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

// Recover from stale lazy-chunk loads. After a redeploy an open tab still holds
// the old index.html, which references content-hashed chunk filenames that may now
// 404 (or a stale service-worker cache serves a mismatched chunk) — surfacing as
// a "load error" on the next lazy route (signup, dashboard, …). Vite fires
// `vite:preloadError` on a failed modulepreload/dynamic import; a full reload
// fetches the fresh index.html + chunks (navigations are network-first). Throttled
// via sessionStorage so a genuinely-broken build can't loop-reload.
if (typeof window !== 'undefined') {
  const CHUNK_RELOAD_KEY = 'up-chunk-reload-at';
  const reloadOnce = () => {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }
  };
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault?.();
    reloadOnce();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e?.reason?.message || e?.reason || '');
    if (/dynamically imported module|ChunkLoadError|module script failed/i.test(msg)) {
      reloadOnce();
    }
  });
}

// A22-007 / A22-002 / A22-003 — global read-failure backstop (P4 remediation,
// docs/audits/2026-08-23/22-state-errors.md). Per-component isError guards
// (MetricHero, and the page-level ErrorCard guards already on most surfaces)
// are the PRIMARY fix; this QueryCache is the safety net so a query nobody
// explicitly guards still tells the user something failed instead of quietly
// resolving to an empty/zeroed screen.
//
// Auth-expiry is routed to logout, not toasted: forwardSupabaseAuthError
// (services/supabaseClient.js) already does the full "clear the session +
// drive AuthContext's logout" dance for a PostgREST-expired/invalid JWT — it
// was exported for exactly this but had ZERO call sites anywhere in the app
// (A22-003). Wiring it in here, for every direct-Supabase read, closes that
// gap without touching supabaseClient.js.
//
// The handler runs outside React (QueryCache is constructed before the tree
// mounts, and stays a plain object for the app's lifetime), so it can't call
// useToast() directly. It publishes through a tiny bridge — the same pattern
// services/api.js already uses for onAuthExpired/notifyAuthExpired: the
// subscribe side lives with the consumer (QueryErrorToastBridge, mounted
// inside ToastProvider below), the publish side lives here. Both the handler
// and the bridge setter are exported so tests can drive this wiring directly
// without mounting the whole app (this file also renders on import — see the
// `rootEl` guard below).
let toastBridge = null;
export function setToastBridge(fn) {
  toastBridge = fn;
}

export const GENERIC_READ_FAILURE_MESSAGE = 'Some information on this page could not be loaded.';

export function handleGlobalQueryError(error) {
  if (forwardSupabaseAuthError(error)) return;
  toastBridge?.('error', getFriendlyErrorMessage(error, GENERIC_READ_FAILURE_MESSAGE));
}

/** Registers the toast bridge for as long as ToastProvider is mounted (the
 * app's whole lifetime) — renders nothing. */
function QueryErrorToastBridge() {
  const { addToast } = useToast();
  useEffect(() => {
    setToastBridge(addToast);
    return () => setToastBridge(null);
  }, [addToast]);
  return null;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalQueryError }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    // Mutations (writes) must never auto-replay — a retried POST/PUT/DELETE can
    // double-apply a server-side write. Errors surface to the caller instead.
    // Pairs with the idempotent-only retry gate in services/api.js.
    mutations: { retry: 0 },
  },
});

// Guarded (rather than a bare `createRoot(document.getElementById('root'))`)
// so importing this module from a test — to reach handleGlobalQueryError /
// setToastBridge above — builds queryClient without also trying to mount the
// whole app into a #root that doesn't exist in a bare jsdom document.
// Production is unaffected: index.html always has `<div id="root">`.
const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      {/* MED-7 — root error boundary. The per-route boundaries in App.jsx only
          wrap the dashboard/signup subtrees, so an uncaught throw on the public
          landing, the /admin/login portal, or the app-root <SignInModal/> would blank
          the whole screen. This top-level boundary is the backstop: it renders
          the shared "Something went wrong" + refresh fallback (and forwards to
          Sentry) instead. Inner boundaries still catch first for their subtree. */}
      <ErrorBoundary>
        <BrowserRouter>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <ToastProvider>
                {/* Renders nothing — registers the bridge handleGlobalQueryError
                    (wired into the QueryCache above) publishes through. */}
                <QueryErrorToastBridge />
                <MotionConfig reducedMotion="user">
                  <WarmupBanner />
                  <App />
                  <ToastContainer />
                </MotionConfig>
              </ToastProvider>
            </AuthProvider>
          </QueryClientProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}

// Register the PWA service worker (prod builds only — no-op in dev/tests).
registerSW();
