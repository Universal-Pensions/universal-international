// Express server entry — bootstraps the Render-hosted backend.
//
// Registration order is LOAD-BEARING (G70). Each block below is numbered so
// reviewers can confirm the invariant against the audit's middleware-order
// spec at a glance. Reordering blocks will silently break:
//   - Sentry capture (must initialise before any module that may throw)
//   - rate-limit IP detection (needs trust-proxy first)
//   - access logging (must wrap routes, not be wrapped by them — including the
//     health routes, which is why morgan is at block 3b and not after them;
//     A09-010)
//   - healthcheck reachability (must be reachable BEFORE route mounts so a
//     misconfigured deploy can still report status via /healthz)
//
// Do NOT add the 15th /api/auth/logout route (G51 — logout is intentionally
// client-only; the demo's 24h HS256 token has no refresh + no revocation).

// ─── 0. Sentry side-effect init (must precede any express() / handler import)
//
// PII hardening (BL-26 / H-4): `beforeSend`/`beforeBreadcrumb` run the shared
// scrubber (`server/sentryScrub.ts`, kept in sync with `src/utils/sentryScrub.js`)
// which redacts Ugandan phone numbers, `role:phone` ids (the JWT `sub` /
// `users.id`), bearer tokens / JWTs, and password fields from forwarded errors
// (e.g. Supabase error detail). `sendDefaultPii` stays explicitly false.
// `release` reads Render's auto-injected RENDER_GIT_COMMIT (or SENTRY_RELEASE)
// when present; `environment` mirrors NODE_ENV. Init stays strictly DSN-gated —
// a no-op when SENTRY_DSN is absent (local dev, PR previews).
import * as Sentry from '@sentry/node';
import { normaliseCspReports } from './cspReport.js';
import { scrubEvent, scrubBreadcrumb } from './sentryScrub.js';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    environment: process.env.NODE_ENV,
    release: process.env.RENDER_GIT_COMMIT || process.env.SENTRY_RELEASE || undefined,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

// ─── 1. Env preflight (B1) — fail loudly before app.listen
import { assertServerEnv } from './env.js';
assertServerEnv();

// ─── 2. Imports
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { corsOptions } from './cors.js';
import { toExpress } from './adapter.js';
// Server-side admin client (service-role, RLS-bypassing singleton). Imported
// the same way the route handlers do — NEVER re-create a client or re-read the
// service-role key here. Used solely by the /readyz readiness probe below.
import supabaseAdmin from '../api/_lib/supabase-admin.js';

// 14 handler imports — every handler exports a Vercel-shaped default. NodeNext
// requires the `.js` extension on relative imports even when the source is
// `.ts` (B2 pattern).
import sendOtp from '../api/auth/send-otp.js';
import verifyOtp from '../api/auth/verify-otp.js';
import verifyPassword from '../api/auth/verify-password.js';
import changePassword from '../api/auth/change-password.js';
import kycOtpSend from '../api/kyc/otp-send.js';
import kycOtpVerify from '../api/kyc/otp-verify.js';
import idOcr from '../api/kyc/id-ocr.js';
import idQuality from '../api/kyc/id-quality.js';
import faceMatch from '../api/kyc/face-match.js';
import amlScreen from '../api/kyc/aml-screen.js';
import niraVerify from '../api/kyc/nira-verify.js';
import agentReferral from '../api/kyc/agent-referral.js';
import contact from '../api/contact.js';
import accessRequest from '../api/access-request.js';
import nomineeClaim from '../api/nominee-claim.js';
import chat from '../api/chat.js';

// ─── 2b. Proxy topology (A07-004) — how many hops in front of this process are
// trusted to have written X-Forwarded-For.
//
// THE BUG THIS ENCODES A FIX FOR. `trust proxy: 1` tells Express the rightmost
// XFF entry was appended by a proxy it trusts. On Render that is true: the edge
// proxy appends the real client IP, so `req.ip` is a value the client cannot
// forge. Run the SAME code with nothing in front of it — `npm run dev:api`, or
// any bare `node dist-server/server/index.js` — and the setting is a lie:
// there is no proxy, so the rightmost XFF entry is whatever the caller typed.
// Proven locally during the audit: 12 POSTs with a rotating X-Forwarded-For all
// returned 200 and never tripped the 5/min writeLimiter, because each forged
// header minted a fresh rate-limit bucket.
//
// WHY THIS IS DERIVED AND NOT HARDCODED. The hop count is a property of the
// deployment, not of the code, so it is read from the deployment.
//
// THE DEFAULT FAILS TOWARDS PRODUCTION ON PURPOSE, AND THAT DIRECTION IS THE
// WHOLE DESIGN. If the detection is ever wrong it must be wrong harmlessly.
//   Guessing 1 hop when there is none  → a local-dev rate-limit bypass. A
//     nuisance, on a machine the developer already controls. This is the
//     behaviour that shipped for months.
//   Guessing 0 hops when there IS one  → every request keys on Render's edge
//     proxy IP, collapsing the entire internet into one bucket and 429-ing real
//     users off the auth routes mid-demo. Unacceptable.
// So "assume a proxy" is the fallback, and three independent signals are OR-ed
// rather than trusting any one of them:
//   NODE_ENV=production   — set explicitly in render.yaml.
//   RENDER / RENDER_SERVICE_ID — injected by the platform on every Render
//     service. These cannot be forgotten in a dashboard edit the way a
//     user-configured var can, which matters here: render.yaml has already
//     drifted from the live service once (A09-006). `RENDER_GIT_COMMIT` is
//     relied on the same way for the Sentry release at block 0.
// Only when ALL of them are absent do we conclude nothing is in front of us.
//
// `TRUSTED_PROXY_HOPS` overrides the lot, for the day a CDN is put in front of
// Render and the count becomes 2. Assert it rather than coercing NaN silently —
// `Number('')` is 0, which is precisely the dangerous value.
const TRUSTED_PROXY_HOPS = (() => {
  const override = process.env.TRUSTED_PROXY_HOPS;
  if (override !== undefined && override !== '') {
    const n = Number(override);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `[env] TRUSTED_PROXY_HOPS must be a non-negative integer, got ${JSON.stringify(override)}`
      );
    }
    return n;
  }
  const looksDeployed =
    process.env.NODE_ENV === 'production' ||
    !!process.env.RENDER ||
    !!process.env.RENDER_SERVICE_ID;
  return looksDeployed ? 1 : 0;
})();

const app = express();

// A09-017 — `x-powered-by: Express` leaked on /healthz and /readyz. Helmet
// strips it, but helmet is registered at block 6 and those two routes are
// deliberately registered before it to protect the ~1 KB uptime-monitor
// response budget (see block 4). Disabling the header at the app level costs
// zero response bytes and covers every route regardless of where it sits in
// the middleware order — which is what the health routes needed.
app.disable('x-powered-by');

// ─── 3. Trust proxy (G1) — required for express-rate-limit to read req.ip
// correctly behind Render's edge proxy. Render forwards via X-Forwarded-For;
// without trust-proxy, every request appears to come from 127.0.0.1 and the
// rate limiter would either treat the whole world as one client or get
// confused into 502s.
app.set('trust proxy', TRUSTED_PROXY_HOPS);

// ─── 3b. Access log (G17, G68) — MOVED HERE FROM BLOCK 7 (A09-010).
//
// It used to sit after the route mounts' preamble at block 7, which put it
// AFTER /healthz (block 4), /readyz (block 4b) and /api/csp-report (block 4c).
// Express middleware only wraps what is registered after it, so those three
// routes answered without ever reaching morgan and produced no log line at all:
// over a 34-hour window the Render log stream contained exactly ONE app line
// despite ~60 keepalive pings plus every browser warmup call. That made the two
// signals needed to diagnose a cold-start incident — "is the keepalive running"
// and "has /readyz been failing" — both invisible.
//
// Registering it here, immediately after trust-proxy and before any route,
// makes it wrap everything. Order relative to trust-proxy is kept because the
// format may grow an `:remote-addr` token later, and that token reads req.ip.
//
// THIS DOES NOT CHANGE ANY RESPONSE. morgan is a logger: it calls next()
// immediately and writes to stdout on the response's 'finished' event. It adds
// no header and no body byte, so the ~1 KB budget block 4 protects is intact
// and /readyz — now the keepalive target — behaves exactly as before. It costs
// one stdout line per ping, which is the entire point.
//
// Format choice: human-readable, includes :response-time (cold-start
// regressions become visible in the access log without chasing Render's
// metrics page). Render captures stdout, so no extra wiring is needed.
app.use(
  morgan(':method :url :status :response-time ms - :res[content-length]')
);

// ─── 4. /healthz — registered EARLY (before helmet) so the total response
// stays small. Free-tier uptime monitors (cron-job.org) cap response size
// near 1 KB; helmet's CSP + cross-origin headers add ~700 bytes that are
// meaningless for a JSON-only healthcheck (no scripts to gate, not embeddable).
// Render's own healthcheck has no size limit; this affects external pingers.
// Must remain I/O-free so a misconfigured Supabase deploy still surfaces as
// `service up, env wrong` rather than a network outage (G16). Stays BEFORE
// any route mounts so a future catch-all can't shadow it (G70).
//
// `cors(corsOptions)` is applied at the ROUTE level here, NOT inherited from
// the global `app.use(cors(...))` in block 6 — that one is registered later,
// so a `GET /healthz` would otherwise respond before reaching it and carry no
// `Access-Control-Allow-Origin` header. The browser-side warmup ping
// (`src/components/WarmupBanner.jsx`) is a cross-origin simple GET; without
// this header it fails CORS and logs a console error on every page load.
// Route-level cors keeps helmet off the response (preserving the ~1 KB budget)
// while adding only the ~80-byte allow-origin/Vary pair for browser callers.
// No-Origin pings (curl, Render's pinger, the GHA cron) get no extra header at
// all — the `cors` package omits it when the request has no Origin — so the
// uptime-monitor response stays as tiny as before.
app.get('/healthz', cors(corsOptions), (_req, res) => {
  // 2a.7 — no-store so a naive uptime pinger can't be served a conditional 304
  // off the default ETag (Express auto-emits a weak ETag on the JSON body).
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
});

// ─── 4b. /readyz — READINESS probe (distinct from /healthz liveness). Where
// /healthz must stay I/O-free (process up, even if Supabase is misconfigured),
// /readyz performs ONE cheap read against the single-row `commission_config`
// table to confirm the DB is actually reachable. The browser warmup ping
// (`src/components/WarmupBanner.jsx`) targets THIS route — it wants to know the
// backend can serve real data after a cold start, not merely that the process
// answered. Uses the shared service-role admin client (block 2 import); does
// NOT instantiate a client or read keys here. Same route-level cors(corsOptions)
// pattern as /healthz so the cross-origin GET carries Access-Control-Allow-Origin
// and registered BEFORE route mounts so a catch-all can't shadow it. 200 on a
// successful read; 503 with a tiny JSON body when the read errors.
app.get('/readyz', cors(corsOptions), async (_req, res) => {
  // 2a.7 — no-store: a readiness verdict must never be cached (it reflects
  // live DB reachability, which changes minute to minute on a cold backend).
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { error } = await supabaseAdmin
      .from('commission_config')
      .select('id')
      .limit(1);
    if (error) {
      res.status(503).json({ ok: false, code: 'not_ready' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, code: 'not_ready' });
  }
});

// ─── 4c. CSP violation sink (A24-002 / A09-004) ──────────────────────────────
// vercel.json's Content-Security-Policy names this URL in `report-uri` and
// `Reporting-Endpoints`. Without a route here those headers point at nothing, and
// the policy would be inert in BOTH directions — blocking nothing (report-only)
// AND reporting nowhere — which is precisely the defect A24-002 describes. The
// header existing is not the fix; somewhere for it to report is.
//
// Registered BEFORE the global express.json() so it can accept the two content
// types browsers actually send, neither of which is application/json:
//   application/csp-report          (the older report-uri format)
//   application/reports+json        (the newer Reporting API / report-to format)
// A body parser that only accepts application/json silently drops every report.
//
// Always 204. A violation report is telemetry from an untrusted page — it must
// never be able to make the endpoint fail, retry, or leak anything back.
app.post(
  '/api/csp-report',
  cors(corsOptions),
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '64kb' }),
  (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      for (const rep of normaliseCspReports(req.body)) {
        // Log only the fields needed to act on a violation. Deliberately NOT the
        // whole body: `script-sample` can carry page content, and this service
        // handles Ugandan member data.
        console.warn('[csp]', JSON.stringify(rep));
      }
    } catch {
      // Never surface a parse failure to the reporting browser.
    }
    res.status(204).end();
  },
);

// ─── 5. Sentry request instrumentation — in @sentry/node v8 this is set up
// automatically by the auto-instrumented Express integration when Sentry.init
// runs before `express()`. The legacy `Sentry.Handlers.requestHandler()`
// middleware was removed in v8; no per-request middleware is needed here.
// The error handler is still installed manually below, after route mounts.

// ─── 6. Security + parsing middleware (G17, G3, G2, G1)
//
// `crossOriginResourcePolicy: 'cross-origin'` (A09-017) — helmet defaults CORP
// to `same-origin`, which on this service is a header that contradicts its own
// reason for existing: the API is deployed on a different origin from the
// frontend precisely so it can be called cross-origin. The contradiction was
// inert (CORP is not consulted for CORS-mode fetch, which is how every call
// from the app is made, and all of them succeed today), so this changes no
// behaviour — it stops the response asserting the opposite of what the service
// is for, which would mislead the next person reading the headers. The
// genuinely load-bearing cross-origin gate here is `corsOptions` on the next
// line, and it is untouched.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '200kb' })); // G2 — 25× smaller than the plan's draft 5mb; no handler needs more
app.use(compression());

// ─── 6b. Body-parser error handler (2a.3) — `express.json()` throws BEFORE any
// route handler runs: a malformed JSON body yields a `SyntaxError` whose
// `.type` is `entity.parse.failed` (`status: 400`), and a body over the 200kb
// cap yields a `PayloadTooLargeError` whose `.type` is `entity.too.large`
// (`status: 413`). Without this, both bubble to the final catch-all and surface
// as `500 {code:'unexpected_error'}` — a client error mis-reported as a server
// failure, which `apiFetch` then treats as `server_unavailable` and auto-retries
// (the cold-start "Retrying…" message for a self-inflicted payload). Map them to
// the correct 4xx code with `Cache-Control: no-store`; anything else (no body
// error or already-sent) is forwarded to the central error handler unchanged.
// Registered here — after parsing, before route mounts — so it sits ahead of
// the Sentry/final handlers in the error chain and intercepts parser throws.
app.use(
  (err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err?.type === 'entity.parse.failed' || err?.status === 400) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ code: 'invalid_json' });
      return;
    }
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(413).json({ code: 'payload_too_large' });
      return;
    }
    next(err);
  }
);

// ─── 7. Access log — MOVED UP to block 3b (A09-010). It has to be registered
// before the health routes to log them, and those are at blocks 4/4b. Nothing
// remains here; the numbering is kept so the block comments still line up with
// the audit's middleware-order spec.

// ─── 8. Rate limiters (G18) — applied per-route below, NOT globally. Only the
// credential / side-effect routes need protection (the three /api/auth/verify*
// + change-password CPU/credential paths via authLimiter, and the two DB-insert
// routes via writeLimiter); limiting the whole API would hurt legitimate signup
// flows where a single session fires 4-5 sequential KYC calls in <10s. Note
// change-password is authenticated, but a holder of one valid 24h token can
// still hammer the bcrypt + DB write path (BL-17), so it shares authLimiter.
// Returns the same `{ code: 'rate_limited' }` shape `verify-otp` already
// produces (api/auth/verify-otp.ts:20), so the frontend's existing
// error-vocab handling needs no changes.
// `skip: req.method !== 'POST'` (2a.4) — the per-handler 405 check runs INSIDE
// the handler, after the limiter. Without this skip, cheap non-POST 405 probes
// (GET/HEAD/…) that never touch bcrypt/DB would still consume the per-IP budget
// — a minor DoS-amplification. Counting only POSTs makes the documented limits
// mean "per write attempt", not "per request incl. rejected non-POSTs".
const skipNonPost = (req: Request) => req.method !== 'POST';

// `limiterKey` (A07-004) — pin every limiter's bucket to a source the caller
// cannot choose. This is the second half of the A07-004 fix; block 2b is the
// first. It is deliberately belt-and-braces: with TRUSTED_PROXY_HOPS === 0,
// `req.ip` already equals the socket peer, so this returns the same value the
// library's default would. It exists so that the guarantee survives someone
// later editing `app.set('trust proxy', …)` to something permissive — the
// limiter would keep keying on the socket, which no header can move.
//
// When there IS a trusted proxy, the socket peer is that proxy (one bucket for
// the whole world), so `req.ip` — the address the trusted hop appended — is the
// correct and only usable source.
//
// The `'unknown'` fallback is a single shared bucket, which is the strict
// reading: an unidentifiable caller is rate-limited harder, never exempted.
const limiterKey = (req: Request): string =>
  (TRUSTED_PROXY_HOPS > 0 ? req.ip : req.socket.remoteAddress) ?? 'unknown';

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'rate_limited' },
  skip: skipNonPost,
  keyGenerator: limiterKey,
});

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'rate_limited' },
  skip: skipNonPost,
  keyGenerator: limiterKey,
});

// chatLimiter (2b.5) — /api/chat is unauthenticated and runs a `.toLowerCase()/
// .includes()` keyword chain on a 200kb-bounded body. Cheap today, but a
// cost/DoS vector the moment it is wired to a real LLM (the route's own TODO
// anticipates it). 20/60s is generous for the demo's canned replies while
// capping abuse; same `{ code: 'rate_limited' }` shape + POST-only skip as the
// other limiters so the frontend's error-vocab handling needs no changes.
const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'rate_limited' },
  skip: skipNonPost,
  keyGenerator: limiterKey,
});

// ─── 9. 14 route mounts (B5) — `app.all` is REQUIRED. Every handler
// performs its own method check + emits `{ code: 'method_not_allowed' }`
// with `Allow: POST` for non-POST traffic. `app.post` would silently
// route non-POSTs to Express's default 404 HTML page, breaking the
// documented 405 JSON envelope the e2e suite asserts against.
app.all('/api/auth/send-otp', toExpress(sendOtp));
app.all('/api/auth/verify-otp', authLimiter, toExpress(verifyOtp)); // G18 — write + JWT mint
app.all('/api/auth/verify-password', authLimiter, toExpress(verifyPassword)); // G18 — bcrypt CPU + credential-stuffing vector
app.all('/api/auth/change-password', authLimiter, toExpress(changePassword)); // G18 / BL-17 — bcrypt CPU + current-password brute-force surface for an already-authenticated caller
app.all('/api/kyc/otp-send', toExpress(kycOtpSend));
app.all('/api/kyc/otp-verify', toExpress(kycOtpVerify));
app.all('/api/kyc/id-ocr', toExpress(idOcr));
app.all('/api/kyc/id-quality', toExpress(idQuality));
app.all('/api/kyc/face-match', toExpress(faceMatch));
app.all('/api/kyc/aml-screen', toExpress(amlScreen));
app.all('/api/kyc/nira-verify', toExpress(niraVerify));
app.all('/api/kyc/agent-referral', writeLimiter, toExpress(agentReferral)); // G18 — DB insert (spam to agent_referrals)
app.all('/api/contact', writeLimiter, toExpress(contact)); // G18 — DB insert (spam to contact_submissions)
app.all('/api/access-request', writeLimiter, toExpress(accessRequest)); // DB insert (public employer/distributor lead form — spam vector)
app.all('/api/nominee-claim', writeLimiter, toExpress(nomineeClaim));   // DB insert (public bereavement claim form — spam vector)
app.all('/api/chat', chatLimiter, toExpress(chat)); // G18 / 2b.5 — unauthenticated keyword chain; cost/DoS vector once wired to a real LLM

// ─── 10. Sentry error handler — MUST come after routes, before custom error
// handlers. Captures any error that bubbled through `next(err)` from the
// adapter. In @sentry/node v8 the API moved from `Sentry.Handlers.errorHandler()`
// to `Sentry.setupExpressErrorHandler(app)` (it internally registers the
// error middleware).
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ─── 11. Final 404 — catches anything that didn't match a route mount.
app.use((_req, res) => {
  res.status(404).json({ code: 'not_found' });
});

// ─── 12. Final error handler — last line of defense. Logs to stdout (Render
// captures it) and emits the same `{ code: 'unexpected_error' }` shape the
// frontend already maps. Guarded against double-send (Sentry's handler may
// have already responded).
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    if (!res.headersSent) {
      res.status(500).json({ code: 'unexpected_error' });
    }
  }
);

// ─── 13. Boot
const PORT = Number(process.env.PORT ?? 3001);
const server = app.listen(PORT, () => {
  // Boot log per G5 — operators grep `[boot] env ok` to confirm a deploy
  // got past the preflight check. Listing the var names (not values) makes
  // the line useful without leaking secrets.
  console.log(
    `[boot] env ok: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET; listening on :${PORT}`
  );
});

// ─── 14. Graceful shutdown (G16, G45) — 25s grace covers worst-case in-flight
// handler: id-ocr's ~2.2s simulated latency plus an awaited Supabase insert
// in agent-referral. SIGINT is for Ctrl-C parity in local dev; SIGTERM is
// what Render sends on deploy / autoscale events.
const shutdown = (signal: string) => {
  console.log(`[shutdown] received ${signal}, closing server`);
  server.close(() => process.exit(0));
  // .unref() so the timer doesn't keep the event loop alive when
  // server.close() has already finished cleanly.
  setTimeout(() => process.exit(1), 25_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── 15. Crash recovery (G64) — log via Sentry then exit non-zero so Render
// restarts cleanly. Without these, a bug in a handler can leave the process
// in a half-dead state where /healthz still returns 200 but every other
// route 500s — Render won't restart and ops see ghost traffic.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  if (process.env.SENTRY_DSN) Sentry.captureException(reason);
  process.exit(1);
});
