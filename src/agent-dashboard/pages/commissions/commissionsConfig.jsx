/**
 * commissionsConfig.jsx — non-component exports for the agent Commissions
 * surface (the route-param allow-list, the view labels, and the shared inline
 * SVG icon nodes).
 *
 * Split out of CommissionsParts.jsx so that file can export ONLY React
 * components — react-refresh ("fast refresh only works when a file only exports
 * components") flags any module that mixes component and non-component exports.
 * `Icons` holds JSX, hence the .jsx extension.
 *
 * Consumed by CommissionsParts.jsx, CommissionsPage.jsx, and CommissionsDesktop.jsx.
 */

export const VALID_VIEWS = new Set(['earned', 'owed']);

export const VIEW_LABELS = {
  earned: 'Earned',
  owed: 'Owed',
};

export const Icons = {
  chevDown: (
    <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 20 20" fill="none" width="20" height="20" aria-hidden="true">
      <path d="M5 10l3 3 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 20 20" fill="none" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.75" />
      <path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 20 20" fill="none" width="18" height="18" aria-hidden="true">
      <rect x="2.5" y="5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="13.5" cy="12" r="1.1" fill="currentColor" />
    </svg>
  ),
};

/**
 * commissionsErrorMessage — turn whatever the commissions query threw into one
 * plain sentence a field agent can act on (A11-008).
 *
 * THE BUG. Both commission screens pass the raw error straight to
 * `<ErrorCard message={error} />`, and ErrorCard renders `error.message`. When
 * the network drops, `src/services/commissions.js:_rpcError` copies the message
 * supabase-js produced for a failed fetch — which is the literal string
 * `"TypeError: Failed to fetch"`. So an agent demoing on a Ugandan mobile
 * connection, at the exact moment the connection is worst, is shown a
 * JavaScript exception name. It tells them nothing, and it looks broken.
 *
 * THE RULE THIS ENCODES: never render an exception string to a user. Every
 * branch below returns copy written for someone with low literacy and no
 * technical vocabulary, and the fallback is a fixed sentence — the raw text is
 * not passed through even when nothing matches, because "unrecognised" is
 * exactly the case most likely to contain a stack trace.
 *
 * The three outcomes are chosen by what the agent should DO, not by what went
 * wrong internally: check the connection, sign in again, or wait and retry.
 * The retry button that sits beside the message stays useful in all three.
 *
 * @param {unknown} error — an Error (usually carrying `.code` from
 *   `_rpcError` or `services/api.js`), a bare string, or anything at all.
 * @returns {string} one sentence, safe to render.
 */
export function commissionsErrorMessage(error) {
  const isString = typeof error === 'string';
  const raw = isString ? error : String(error?.message ?? '');
  const code = isString ? '' : String(error?.code ?? '');
  const status = isString ? undefined : error?.status;

  // Signed-out / expired token. `services/api.js` codes this explicitly;
  // PostgREST answers a stale JWT with 401.
  if (code === 'session_expired' || status === 401) {
    return 'Your sign-in has ended. Please sign in again.';
  }

  // Anything that means "the request never reached a working server".
  // The codes come from `services/api.js`; the text match catches the
  // supabase-js path, which produces a message but no useful code — this is
  // the branch that actually fires for "TypeError: Failed to fetch".
  const networkCodes = ['network_unreachable', 'timeout', 'backend_down', 'server_unavailable'];
  const looksLikeNetwork = /failed to fetch|networkerror|network error|load failed|timed? ?out|fetch failed/i;
  if (networkCodes.includes(code) || looksLikeNetwork.test(raw)) {
    return 'We could not reach the server. Check your internet connection and try again.';
  }

  // Everything else, including anything unrecognised. Deliberately does NOT
  // fall through to `raw`.
  return 'Something went wrong on our side. Please try again in a moment.';
}
