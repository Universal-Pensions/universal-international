/**
 * platformCopilotContext.js — derives the Ask-AI answer context for the ADMIN
 * ("Platform Copilot") and DISTRIBUTOR ("Network Copilot") map-overlay shells
 * from their own live figures, so every reply is truthful.
 *
 * Mirrors branchCopilotContext.js. The output of buildPlatformCopilotContext is
 * fed straight to getPlatformChatResponse(message, ctx) (src/services/chat.js).
 *
 * PURE — no hooks, no mockData import. It reads ONE `overview` object and is
 * tolerant of the two shapes the two roles feed it:
 *   - admin      → usePlatformOverview() (get_platform_overview, admin-only):
 *                  { totalSubscribers, activeSubscribers, inactiveSubscribers,
 *                    distributors, employers, branches, agents, aum,
 *                    totalContributions, totalWithdrawals,
 *                    subscribersViaDistributor/ViaEmployer/Direct, byChannel }
 *   - distributor→ useEntityMetrics('country','ug') (agent-tree rollup; the
 *                  admin-only platform RPC RAISEs for a distributor JWT):
 *                  { totalSubscribers, activeRate, totalAgents, totalBranches,
 *                    aum, totalContributions, totalWithdrawals }
 * Fields absent from a given shape (distributors/employers/channel split for the
 * distributor) come back null, and the responder answers those honestly.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Read a value only when it is genuinely present (not undefined/null); returns
// null otherwise so the responder can tell "0" apart from "not applicable".
const opt = (v) => (v == null ? null : num(v));

/**
 * @param {object} args
 * @param {'admin'|'distributor'} args.scope
 * @param {object} args.overview    - usePlatformOverview() (admin) OR
 *                                     useEntityMetrics('country','ug') (distributor)
 * @param {string} [args.entityName] - optional override for the network label
 */
export function buildPlatformCopilotContext({ scope = 'admin', overview = {}, entityName } = {}) {
  const o = overview || {};

  const totalSubscribers = num(o.totalSubscribers);

  // Active / dormant. The platform shape gives explicit counts; the country
  // rollup gives a percentage we resolve against the total (single rounding,
  // dormant as the exact complement — matches OverlayPanel's bar math).
  const rateGiven = o.activeRate == null ? null : num(o.activeRate);
  let activeSubscribers = o.activeSubscribers == null ? null : num(o.activeSubscribers);
  if (activeSubscribers == null) {
    activeSubscribers = rateGiven == null ? 0 : Math.round((totalSubscribers * rateGiven) / 100);
  }
  const dormant = o.inactiveSubscribers == null
    ? Math.max(0, totalSubscribers - activeSubscribers)
    : num(o.inactiveSubscribers);
  const activeRate = totalSubscribers > 0
    ? Math.round((activeSubscribers / totalSubscribers) * 100)
    : (rateGiven == null ? 0 : Math.round(rateGiven));

  // Counts — accept either naming (platform vs country-rollup).
  const agents = num(o.agents ?? o.totalAgents);
  const branches = num(o.branches ?? o.totalBranches);
  const distributors = opt(o.distributors);
  const employers = opt(o.employers);

  // Acquisition channels (admin/platform shape only).
  const viaDistributor = opt(o.subscribersViaDistributor);
  const viaEmployer = opt(o.subscribersViaEmployer);
  const direct = opt(o.subscribersDirect);
  let topChannelLabel = null;
  let topChannelCount = 0;
  const channels = [
    ['distributors', viaDistributor],
    ['employers', viaEmployer],
    ['direct sign-ups', direct],
  ].filter(([, n]) => n != null);
  if (channels.length) {
    const [label, count] = channels.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    topChannelLabel = label;
    topChannelCount = count;
  }

  const networkName = entityName || (scope === 'admin' ? 'the platform' : 'your network');

  return {
    scope,
    networkName,
    totalSubscribers,
    activeSubscribers,
    dormant,
    activeRate,
    agents,
    branches,
    distributors,
    employers,
    aum: num(o.aum),
    totalContributions: num(o.totalContributions),
    totalWithdrawals: num(o.totalWithdrawals),
    viaDistributor,
    viaEmployer,
    direct,
    topChannelLabel,
    topChannelCount,
  };
}

// Starter prompts for the platform/network copilot — each maps to a keyword
// branch in mockPlatformChatResponse (src/services/chat.js) so the demo answers.
export const PLATFORM_COPILOT_SUGGESTIONS = [
  "What's our total AUM?",
  'How many subscribers are dormant?',
  "What's our active rate?",
  'How many agents and branches do we have?',
  'Where do most subscribers come from?',
];
