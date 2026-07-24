import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import * as Sentry from '@sentry/react';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import ToastContainer from './components/Toast.jsx';
import WarmupBanner from './components/WarmupBanner.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { scrubEvent, scrubBreadcrumb } from './utils/sentryScrub.js';
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

const queryClient = new QueryClient({
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* MED-7 — root error boundary. The per-route boundaries in App.jsx only
        wrap the dashboard/signup subtrees, so an uncaught throw on the public
        landing, the /admin login, or the app-root <SignInModal/> would blank
        the whole screen. This top-level boundary is the backstop: it renders
        the shared "Something went wrong" + refresh fallback (and forwards to
        Sentry) instead. Inner boundaries still catch first for their subtree. */}
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
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

// Register the PWA service worker (prod builds only — no-op in dev/tests).
registerSW();
