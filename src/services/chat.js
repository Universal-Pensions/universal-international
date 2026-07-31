// Chat service — wraps the `/api/chat` Vercel route. The route is
// JWT-optional: when a JWT is present the server flavors the reply by the
// claim role (admin/distributor/branch → admin flavor, agent → agent DM
// flavor, subscriber → subscriber co-pilot). When unauthenticated the server
// falls back to the `context` field on the body, which is what the
// subscriber co-pilot uses pre-sign-in.
//
// All three exported functions return a plain string (the reply). The route
// also returns a `suggestions` array, but every existing caller
// (`BranchHealthScore`, `MetricsRow`, `CoPilotWidget`, `AgentPage`,
// `HelpPage`) renders the response as a single chat bubble — they don't
// consume `.suggestions`. So we unwrap `.reply` at the boundary and keep the
// legacy string contract. If a caller ever needs the suggestions, expose a
// second function rather than widening this return type.
//
// Rollback:
//   When `IS_SUPABASE_ENABLED` is false (set `VITE_USE_SUPABASE=false`), each
//   function short-circuits to the legacy localStorage / keyword-matched
//   implementation so the rollback drill works without the API route.

import { api, IS_SUPABASE_ENABLED } from './api';
import { COUNTRY, REGIONS, AGENTS, BRANCHES } from '../data/mockData';
import { formatNumber, formatUGX } from '../utils/currency';

let _responses = null;

function buildResponses() {
  if (_responses) return _responses;

  const cm = COUNTRY.metrics;
  const branchCount = Object.keys(BRANCHES).length;

  const topAgents = Object.values(AGENTS)
    .sort((a, b) => b.performance - a.performance)
    .slice(0, 3);
  const avgPerf = Math.round(
    Object.values(AGENTS).reduce((s, a) => s + a.performance, 0) / Object.keys(AGENTS).length,
  );

  const regionsBySubscribers = Object.values(REGIONS)
    .map((r) => ({ name: r.name, coverage: r.metrics.coverageRate, subs: r.metrics.totalSubscribers }))
    .sort((a, b) => b.subs - a.subs);

  const mostBalanced = Object.values(REGIONS)
    .map((r) => ({ name: r.name, gap: Math.abs(r.metrics.genderRatio.male - r.metrics.genderRatio.female) }))
    .sort((a, b) => a.gap - b.gap)[0];

  _responses = {
    default:
      "I can help you analyse your pension network data. Ask about subscribers, agents, coverage, or contributions!",
    agent: `Top 3 agents by performance: ${topAgents.map((a) => `${a.name} (${a.performance}%)`).join(', ')}. Network average: ${avgPerf}%.`,
    coverage: `Coverage: ${Object.values(REGIONS).map((r) => `${r.name} ${r.metrics.coverageRate}%`).join(', ')}. National average: ${cm.coverageRate}%.`,
    subscriber: `${formatNumber(cm.totalSubscribers)} subscribers across ${branchCount} branches. ${cm.activeRate}% active. ${regionsBySubscribers[0].name} region leads with ~${formatNumber(regionsBySubscribers[0].subs)}.`,
    gender: `Gender: ${cm.genderRatio.male}% male, ${cm.genderRatio.female}% female, ${cm.genderRatio.other}% other. ${mostBalanced.name} region has the most balanced split.`,
  };

  return _responses;
}

/**
 * Post a message to `/api/chat` with the given context flag. Returns the
 * reply string; swallows + logs route failures so the chat UI shows a calm
 * fallback message instead of breaking. Used by all three public functions
 * below as a single integration point.
 */
async function postChat(message, context, fallback) {
  try {
    const res = await api.post('/chat', { message, context });
    if (res && typeof res.reply === 'string') return res.reply;
    return fallback;
  } catch (err) {
    if (typeof window !== 'undefined' && window?.console) {
      console.warn('[chat] /api/chat failed; falling back to mock copy.', err);
    }
    return fallback;
  }
}

/**
 * @endpoint POST /api/chat
 * @param {string} message - User's chat message
 * @returns {Promise<string>} AI-generated response text
 * @description Distributor/Branch/Admin "data assistant" flavor. The API
 *   route uses the JWT role to decide the flavor; we pass `context: 'admin'`
 *   so unauthenticated calls still get the admin flavor.
 * @scope Distributor and Branch Admin (scoped to their data visibility).
 */
export async function getChatResponse(message) {
  if (!IS_SUPABASE_ENABLED) return mockChatResponse(message);
  return postChat(message, 'admin', mockChatResponse(message));
}

/**
 * Employer "copilot" — keyword-matched answers grounded in the EMPLOYER's own
 * figures (passed in `ctx`), not the distributor network. A mock (CLAUDE.md
 * §10a), but truthful: it answers from real, RLS-scoped data the hero already
 * holds, so "Who is pending KYC?" returns the real pending-invite list rather
 * than the generic admin/network reply the shared `/api/chat` route gives. No
 * round-trip — the data is already client-side, and the route has no
 * employer-invite query to answer these questions anyway.
 *
 * @param {string} message
 * @param {object} ctx - { headcount, active, inactive, participationPct,
 *   pendingKyc, pendingNames[], fundingLabel, coverLabel, totalContributions,
 *   lastRunLabel } — all derived in EmployerHealthScore from live hooks.
 *   `fundingLabel` is contributionFundingLabel(default_contribution_config) from
 *   `utils/contributionModel` — the two payroll figures in plain words. This file
 *   only interpolates it; never re-derive contribution wording here.
 * @returns {Promise<string>}
 */
export async function getEmployerChatResponse(message, ctx = {}) {
  return mockEmployerChatResponse(message, ctx);
}

/**
 * @endpoint POST /api/chat (branch copilot — client-side mock)
 * @param {string} message
 * @param {object} ctx - the branch's OWN figures from buildBranchCopilotContext
 *   (live, RLS-scoped). Distinct from getChatResponse('admin'), which answers
 *   over the whole network — this stays scoped to the single branch the desktop
 *   Branch Copilot speaks to, so every reply is truthful for that branch.
 * @returns {Promise<string>}
 */
export async function getBranchChatResponse(message, ctx = {}) {
  return mockBranchChatResponse(message, ctx);
}

/**
 * @endpoint POST /api/chat (platform copilot — client-side mock)
 * @param {string} message
 * @param {object} ctx - the platform/network figures from
 *   buildPlatformCopilotContext (live hooks). Powers the Ask-AI copilot on the
 *   ADMIN ("the platform") and DISTRIBUTOR ("your network") map-overlay shells.
 *
 *   MUST stay client-side. The shared getChatResponse('admin') posts to the
 *   server, whose api/chat.ts still carries STALE hardcoded stats (~30k
 *   subscribers, 82% active) that contradict the live ~5k seed — so it would
 *   answer with fiction. This responder instead derives every figure from the
 *   real, live-hook `ctx`, exactly like getBranchChatResponse. Do NOT swap it
 *   for getChatResponse/postChat.
 * @returns {Promise<string>}
 */
export async function getPlatformChatResponse(message, ctx = {}) {
  return mockPlatformChatResponse(message, ctx);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Subscriber-facing copilot                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

const subscriberChatResponses = {
  default:
    "I can help with your savings, contributions, withdrawals, insurance, and nominees. Try asking how to withdraw or change your split.",
  withdraw:
    "You can withdraw from your Emergency bucket any time. Retirement funds unlock at age 60. Tap the Withdraw button on your dashboard to begin.",
  contribute:
    "To add money, tap ‘Make a Contribution’ — you can use the default split (80/20) or customise just this top-up.",
  schedule:
    "Your schedule controls how often and how much you save with your own money. Open the Schedule tab to change frequency, amount, or the retirement/emergency split. If you joined through your job, the amounts your employer sends are set by them and are separate from this.",
  // Employer-sponsored members. Without this arm, "how much does my employer put
  // in?" fell through to `schedule`, which told them THEY control the amount —
  // false for a payroll member: the company config sets both amounts and the
  // member states neither. Plain words, no percentages, because this string is
  // shared by every member (and can be served before sign-in), so it must never
  // claim a figure it hasn't read.
  employer:
    "If you joined through your job, your employer sets two amounts each month — a part taken from your pay, and a part the company adds from its own money. Both go into your pension automatically, so there is nothing for you to pay. You can still save your own money on top any time, and any cover your company pays for shows under Insurance.",
  nominee:
    "Nominees receive your savings or insurance benefit. You can change them any time under ‘Update nominees’. Shares must total 100%.",
  claim:
    "To file an insurance claim, open Withdrawals → ‘File an insurance claim’ → ‘File a new claim’. Have the incident date and any supporting documents ready.",
  retirement:
    "Your retirement bucket compounds monthly. Increase your schedule or retirement % to grow your projected income.",
  emergency:
    "Your Emergency bucket is designed for hardship situations — medical, education, housing, or business. It’s withdrawable any time.",
  insurance:
    "Your baseline cover is UGX 1,000,000 for an annual premium of UGX 24,000 — you pay it once a year, or build it automatically from the emergency slice of your savings. Upgrade options are available under Insurance → Coverage.",
  split:
    "A balanced split is 80% retirement / 20% emergency. Adjust it any time from the Schedule tab.",
  balance:
    "Your total balance reflects contributions minus withdrawals, translated to units at the latest unit value.",
  help:
    "Our help desk is open 8am–8pm. You can call, message us on WhatsApp, or email support@upensions.ug.",
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Agent-side mock responses (for subscriber → agent direct messaging)        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @endpoint POST /api/chat (context: 'agent')
 * @param {string} message
 * @param {{ name?: string }} [agent] - Used as a friendly first-name fallback
 *   when the API isn't yet personalised.
 * @returns {Promise<string>} Reply text.
 * @description Subscriber → agent DM. The real product will route messages
 *   into a person-to-person inbox; today the server returns a keyword-matched
 *   stock reply.
 */
export async function getAgentReply(message, agent) {
  const firstName = (agent?.name || 'your agent').split(' ')[0];
  if (!IS_SUPABASE_ENABLED) return mockAgentReply(message, firstName);
  return postChat(message, 'agent', mockAgentReply(message, firstName));
}

/**
 * @endpoint POST /api/chat (context: 'subscriber')
 * @param {string} message
 * @returns {Promise<string>}
 * @description Subscriber-facing co-pilot. Often called before sign-in, so we
 *   rely on the route's unauthenticated body-context fallback.
 */
export async function getSubscriberChatResponse(message) {
  if (!IS_SUPABASE_ENABLED) return mockSubscriberChatResponse(message);
  return postChat(message, 'subscriber', mockSubscriberChatResponse(message));
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Rollback mocks (used when IS_SUPABASE_ENABLED === false)                */
/* ──────────────────────────────────────────────────────────────────────── */

function mockChatResponse(message) {
  const responses = buildResponses();
  const l = (message || '').toLowerCase();
  if (l.includes('agent') || l.includes('top')) return responses.agent;
  if (l.includes('coverage') || l.includes('region')) return responses.coverage;
  if (l.includes('subscriber') || l.includes('active')) return responses.subscriber;
  if (l.includes('gender') || l.includes('split')) return responses.gender;
  return responses.default;
}

function mockEmployerChatResponse(message, ctx = {}) {
  const l = (message || '').toLowerCase();
  const {
    headcount = 0,
    active = 0,
    inactive = 0,
    participationPct = 0,
    pendingKyc = 0,
    pendingNames = [],
    // Mirrors contributionFundingLabel()'s zero-state string, so a ctx that
    // hasn't loaded yet reads exactly like an employer who has set nothing up
    // rather than inventing a second vocabulary for "unknown".
    fundingLabel = 'No contributions set up yet',
    coverLabel = 'no group cover',
    totalContributions = 0,
    lastRunLabel = null,
  } = ctx;

  // Pending KYC = people invited who haven't completed sign-up (the real,
  // RLS-scoped invite list — not a member status).
  if (l.includes('kyc') || l.includes('pending') || l.includes('invite') || l.includes('sign-up') || l.includes('sign up')) {
    if (pendingKyc === 0) return 'Everyone you’ve invited has completed sign-up — no pending KYC right now.';
    const shown = pendingNames.slice(0, 5).join(', ');
    const more = pendingNames.length > 5 ? `, +${formatNumber(pendingNames.length - 5)} more` : '';
    const who = shown ? `: ${shown}${more}` : '';
    return `${formatNumber(pendingKyc)} ${pendingKyc === 1 ? 'person hasn’t' : 'people haven’t'} finished signing up${who}. Open Pending KYC to resend their invite links.`;
  }

  // Individual staff balances are private by design — decline honestly.
  if (l.includes('balance') || l.includes('savings') || l.includes('how much has')) {
    return 'Individual staff balances are private — you fund contributions, but each member’s personal savings aren’t visible to the employer.';
  }

  // Contribution runs / total funded.
  if (l.includes('run') || l.includes('total') || l.includes('funded') || l.includes('paid')) {
    return `You’ve funded ${formatUGX(totalContributions)} to date${lastRunLabel ? ` — your last run was ${lastRunLabel}` : ' (no runs yet)'}.`;
  }

  // Inactive staff.
  if (l.includes('inactive') || l.includes('suspend')) {
    return inactive > 0
      ? `${formatNumber(inactive)} of ${formatNumber(headcount)} staff are inactive — contribution runs skip them.`
      : `All ${formatNumber(headcount)} staff are active.`;
  }

  // Participation / contributing — measured against ACTIVE staff (matches the
  // hero's "% of active staff contributing" insight), so an inactive roster
  // doesn't read as low participation.
  if (l.includes('contribut') || l.includes('participat')) {
    return `${participationPct}% of your ${formatNumber(active)} active staff are contributing.`;
  }

  // Company funding — the two payroll amounts.
  //
  // `match` is deliberately KEPT as a routing keyword. Employers still ask "do
  // you match staff contributions?", and dropping the keyword would drop them to
  // the generic fallback. Only the ANSWER changed: `fundingLabel` is now
  // contributionFundingLabel(config), which states the two concrete figures
  // ("Staff put in 10% of pay · You add 5% of pay") instead of naming a mode.
  // There is no match basis any more — the company's share is a share of pay (or
  // a flat amount) in its own right, never a percentage of what staff put in.
  //
  // The second sentence stays true under the unified model and reads correctly
  // next to all four label states (including "No contributions set up yet"):
  // voluntary member saving is separate money the member chooses themselves, and
  // it is never touched by a contribution run.
  if (l.includes('funding') || l.includes('split') || l.includes('match')) {
    return `${fundingLabel}. Separately, each member can save their own money any time — that part is their choice, not payroll.`;
  }

  // Group insurance (company-wide, all-or-nothing).
  if (l.includes('insurance') || l.includes('cover')) {
    return `Group life cover: ${coverLabel}. It’s company-wide — the same for every staff member, with no per-member opt-out.`;
  }

  // Headcount.
  if (l.includes('staff') || l.includes('employee') || l.includes('headcount') || l.includes('how many') || l.includes('people')) {
    return `You have ${formatNumber(headcount)} staff — ${formatNumber(active)} active${inactive > 0 ? `, ${formatNumber(inactive)} inactive` : ''}.`;
  }

  return 'I can answer about your staff, contribution runs, company funding, group insurance, and who’s pending KYC. Try “Who is pending KYC?” or “What’s our funding split?”.';
}

function mockBranchChatResponse(message, ctx = {}) {
  const l = (message || '').toLowerCase();
  const {
    branchName = 'your branch',
    score = 0,
    label = '',
    totalSubscribers = 0,
    activeSubscribers = 0,
    dormant = 0,
    totalAgents = 0,
    activeAgents = 0,
    topAgentName = null,
    topAgentMultiple = 0,
    aum = 0,
    contributionsThisMonth = 0,
    contribChangePct = 0,
    settlementRate = 0,
    genderRatio = {},
  } = ctx;

  // Top / best agent.
  if (l.includes('top') || l.includes('best') || (l.includes('agent') && (l.includes('lead') || l.includes('perform') || l.includes('who')))) {
    if (!topAgentName) return `You have ${formatNumber(totalAgents)} agents at ${branchName}, but none have recorded contributions yet.`;
    const mult = topAgentMultiple >= 1.1 ? ` — about ${topAgentMultiple.toFixed(1)}x the branch average` : '';
    return `${topAgentName} is leading on contributions${mult}. Open Agents to see the full roster.`;
  }

  // Dormant / reactivation.
  if (l.includes('dormant') || l.includes('reactivat') || l.includes('not contributing') || l.includes('inactive subscriber')) {
    return dormant > 0
      ? `${formatNumber(dormant)} of ${formatNumber(totalSubscribers)} subscribers are dormant (not contributing recently). Reactivating them is your biggest lever — open Reports → All subscribers to target them.`
      : `Great news — every subscriber at ${branchName} is currently active.`;
  }

  // Overdue / pending contributions.
  if (l.includes('overdue') || l.includes('pending') || (l.includes('contribut') && (l.includes('late') || l.includes('miss') || l.includes('behind')))) {
    return 'Members past their scheduled contribution date show up on your Home under Needs attention → Overdue contributions. Tap in to see which agents to nudge to follow up.';
  }

  // Commissions / settlement.
  if (l.includes('commission') || l.includes('settle') || l.includes('due') || l.includes('payout')) {
    return `Your agents are at a ${Math.round(settlementRate)}% commission settlement rate this cycle. Open Commissions for the per-agent paid-vs-due breakdown.`;
  }

  // Gender split.
  if (l.includes('gender') || l.includes('male') || l.includes('female')) {
    const male = genderRatio.male || 0;
    const female = genderRatio.female || 0;
    const tot = male + female;
    if (tot === 0) return 'I don’t have a gender breakdown for this branch yet.';
    return `Your subscribers are ${Math.round((male / tot) * 100)}% male and ${Math.round((female / tot) * 100)}% female. See Reports for the full demographic split.`;
  }

  // Contributions this month.
  if (l.includes('contribut') || l.includes('collect') || l.includes('this month') || l.includes('trend')) {
    const dir = contribChangePct >= 0 ? 'up' : 'down';
    return `${branchName} collected ${formatUGX(contributionsThisMonth)} this month — ${dir} ${Math.abs(contribChangePct)}% on last month.`;
  }

  // AUM / savings.
  if (l.includes('aum') || l.includes('savings') || l.includes('funds') || l.includes('under management')) {
    return `${branchName} holds ${formatUGX(aum)} in subscriber savings under management.`;
  }

  // Subscribers / active.
  if (l.includes('subscriber') || l.includes('member') || l.includes('active') || l.includes('how many')) {
    return `${branchName} has ${formatNumber(totalSubscribers)} subscribers — ${formatNumber(activeSubscribers)} actively contributing.`;
  }

  // Agents count.
  if (l.includes('agent') || l.includes('team') || l.includes('staff')) {
    return `You have ${formatNumber(totalAgents)} agents at ${branchName}${activeAgents !== totalAgents ? `, ${formatNumber(activeAgents)} active` : ' (all active)'}.`;
  }

  // Health score.
  if (l.includes('score') || l.includes('health') || l.includes('how are we')) {
    return `${branchName} is at a health score of ${score}/100 (${label}). Reactivating dormant subscribers is the quickest way to lift it.`;
  }

  return `I can answer about your agents, subscribers, contributions, commissions, KYC, and branch health for ${branchName}. Try “Who are my top agents?” or “How many dormant subscribers can I reactivate?”.`;
}

/**
 * Platform / network copilot — keyword-matched answers grounded in the figures
 * the ADMIN (whole platform) or DISTRIBUTOR (their network) already sees on
 * their map-overlay dashboard, passed in `ctx` from buildPlatformCopilotContext.
 * A mock (CLAUDE.md §10a), but truthful: every number comes from the live
 * usePlatformOverview / country-rollup hooks, never the server's stale stats.
 *
 * @param {string} message
 * @param {object} ctx - { scope:'admin'|'distributor', networkName,
 *   totalSubscribers, activeSubscribers, dormant, activeRate, agents, branches,
 *   distributors, employers, aum, totalContributions, totalWithdrawals,
 *   viaDistributor, viaEmployer, direct, topChannelLabel, topChannelCount }.
 *   distributors/employers/channel figures are null for the distributor scope
 *   (a single-network, agent-tree view has no such concept) — answered honestly.
 * @returns {string}
 */
function mockPlatformChatResponse(message, ctx = {}) {
  const l = (message || '').toLowerCase();
  const {
    scope = 'admin',
    networkName = 'the platform',
    totalSubscribers = 0,
    activeSubscribers = 0,
    dormant = 0,
    activeRate = 0,
    agents = 0,
    branches = 0,
    distributors = null,
    employers = null,
    aum = 0,
    totalContributions = 0,
    totalWithdrawals = 0,
    viaDistributor = null,
    viaEmployer = null,
    direct = null,
    topChannelLabel = null,
    topChannelCount = 0,
  } = ctx;

  const isAdmin = scope === 'admin';
  // Capitalise the network label for sentence-start use ("the platform" →
  // "The platform"; a distributor's proper name is left untouched).
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  // AUM / assets under management.
  if (l.includes('aum') || l.includes('asset') || l.includes('under management') || l.includes('managed')) {
    return `${cap(networkName)} holds ${formatUGX(aum)} in assets under management across ${formatNumber(totalSubscribers)} subscribers.`;
  }

  // Contributions collected.
  if (l.includes('contribut') || l.includes('collect') || l.includes('inflow') || l.includes('deposit')) {
    return `${cap(networkName)} has collected ${formatUGX(totalContributions)} in contributions to date.`;
  }

  // Withdrawals / outflows.
  if (l.includes('withdraw') || l.includes('outflow') || l.includes('payout')) {
    return `${formatUGX(totalWithdrawals)} has been withdrawn across ${networkName} to date — against ${formatUGX(aum)} still under management.`;
  }

  // Dormant / inactive / reactivation.
  if (l.includes('dormant') || l.includes('reactivat') || l.includes('not contributing') || l.includes('lapsed') || l.includes('inactive')) {
    return dormant > 0
      ? `${formatNumber(dormant)} of ${formatNumber(totalSubscribers)} subscribers are dormant (not contributing recently) — about ${Math.max(0, 100 - activeRate)}% of the base. Reactivating them is the single biggest lever on ${networkName}.`
      : `Every subscriber on ${networkName} is currently active.`;
  }

  // Active rate / participation / engagement / health.
  if (l.includes('active rate') || l.includes('participation') || l.includes('engagement') || l.includes('% active') || l.includes('health') || l.includes('how are we')) {
    return `${activeRate}% of ${networkName}'s ${formatNumber(totalSubscribers)} subscribers are actively contributing — ${formatNumber(activeSubscribers)} active, ${formatNumber(dormant)} dormant.`;
  }

  // Agents.
  if (l.includes('agent')) {
    return `${cap(networkName)} has ${formatNumber(agents)} field agents${branches ? ` across ${formatNumber(branches)} branches` : ''}.`;
  }

  // Branches.
  if (l.includes('branch')) {
    return `There ${branches === 1 ? 'is' : 'are'} ${formatNumber(branches)} branch${branches === 1 ? '' : 'es'} on ${networkName}, supervising ${formatNumber(agents)} agents.`;
  }

  // Distributors (a head-office / admin concept).
  if (l.includes('distributor')) {
    return distributors == null
      ? `You're viewing a single distributor network here — it covers ${formatNumber(branches)} branches and ${formatNumber(agents)} agents.`
      : `There ${distributors === 1 ? 'is' : 'are'} ${formatNumber(distributors)} distributor network${distributors === 1 ? '' : 's'} on the platform. Open Distributors to manage them.`;
  }

  // Employers (a head-office / admin concept).
  if (l.includes('employer') || l.includes('company') || l.includes('companies') || l.includes('b2b')) {
    return employers == null
      ? `Employer accounts are managed by head office — your network is the agent → subscriber tree, with no employer channel.`
      : `There ${employers === 1 ? 'is' : 'are'} ${formatNumber(employers)} employer account${employers === 1 ? '' : 's'} on the platform. Open Employers to manage them.`;
  }

  // Acquisition channel / where members come from / top source / region breakdown.
  if (l.includes('channel') || l.includes('where') || l.includes('come from') || l.includes('source') || l.includes('acquisition') || l.includes('region') || l.includes('top')) {
    if (topChannelLabel) {
      const parts = [];
      if (viaDistributor != null) parts.push(`${formatNumber(viaDistributor)} via distributors`);
      if (viaEmployer != null) parts.push(`${formatNumber(viaEmployer)} via employers`);
      if (direct != null && direct > 0) parts.push(`${formatNumber(direct)} direct`);
      return `Most subscribers join through ${topChannelLabel} (${formatNumber(topChannelCount)}). Full split: ${parts.join(', ')}. For a region-by-region view, drill into the map.`;
    }
    return `For a region-by-region breakdown, drill into the map — each region opens its districts, branches, and agents.`;
  }

  // Subscribers / members / how many / total.
  if (l.includes('subscriber') || l.includes('member') || l.includes('saver') || l.includes('active') || l.includes('how many') || l.includes('how big') || l.includes('total') || l.includes('people')) {
    return `${cap(networkName)} has ${formatNumber(totalSubscribers)} subscribers — ${formatNumber(activeSubscribers)} actively contributing (${activeRate}%) and ${formatNumber(dormant)} dormant.`;
  }

  // Overview / summary / snapshot.
  if (l.includes('overview') || l.includes('summary') || l.includes('snapshot') || l.includes('glance')) {
    const bits = [
      `${formatNumber(totalSubscribers)} subscribers (${activeRate}% active)`,
      `${formatUGX(aum)} AUM`,
      `${formatNumber(agents)} agents`,
    ];
    if (isAdmin && employers != null) bits.push(`${formatNumber(employers)} employers`);
    return `${cap(networkName)} at a glance — ${bits.join(' · ')}.`;
  }

  return `I can answer about ${networkName}'s subscribers, active rate, AUM, contributions, withdrawals, agents, branches${isAdmin ? ', distributors, employers' : ''}, and where members are acquired. Try "What's our AUM?" or "How many subscribers are dormant?".`;
}

function mockAgentReply(message, firstName) {
  const l = (message || '').toLowerCase();
  if (l.includes('contribute') || l.includes('top up') || l.includes('top-up')) {
    return `Sure — easiest is to use the Top up button on your dashboard. If you'd prefer Mobile Money via me, send the amount and I'll send a payment prompt to your phone.`;
  }
  if (l.includes('withdraw')) {
    return `Got it. Emergency bucket withdrawals are usually 1–2 working days. I can walk you through the form, or process it on your behalf if you share the amount and reason.`;
  }
  if (l.includes('nominee') || l.includes('beneficiary')) {
    return `Happy to help update your nominees. We'll need each person's full name, NIN, and the share %. Shares must total 100%.`;
  }
  if (l.includes('schedule') || l.includes('frequency') || l.includes('split')) {
    return `Your contribution schedule can be changed any time. Want me to suggest a split based on your goals? Tell me how soon you'd want to retire or what you're saving for.`;
  }
  if (l.includes('insurance') || l.includes('claim')) {
    return `For insurance and claims I'll need a few details: type of claim, incident date, and any documents. I'll guide you through the rest.`;
  }
  if (l.includes('meet') || l.includes('visit') || l.includes('branch') || l.includes('appointment')) {
    return `Of course — I can meet you at the branch or come to your area. What day this week works for you?`;
  }
  if (l.includes('thanks') || l.includes('thank you')) {
    return `Always happy to help. Reach out any time on this thread or call my number on the profile.`;
  }
  if (l.includes('hi') || l.includes('hello') || l.includes('hey')) {
    return `Hi! ${firstName} here. How can I help you today?`;
  }
  return `Thanks for the message — I'll get back to you shortly. If it's urgent, you can also call me on the number above.`;
}

function mockSubscriberChatResponse(message) {
  const l = (message || '').toLowerCase();
  // FIRST, on purpose. An employer-sponsored member's question almost always
  // also carries a general keyword ("what does my employer contribute?" has
  // 'contribute'; "does my company set my schedule?" has 'schedule'), so any
  // later position loses the question to a generic answer that is wrong for
  // them. The employer string closes over the one real collision ('company' +
  // cover) by pointing group cover at the Insurance tab.
  if (l.includes('employer') || l.includes('company') || l.includes('salary') || l.includes('payroll')) return subscriberChatResponses.employer;
  if (l.includes('withdraw') || l.includes('take out')) return subscriberChatResponses.withdraw;
  if (l.includes('contribute') || l.includes('top up') || l.includes('top-up')) return subscriberChatResponses.contribute;
  if (l.includes('schedule') || l.includes('frequency') || l.includes('change my')) return subscriberChatResponses.schedule;
  if (l.includes('nominee') || l.includes('beneficiary')) return subscriberChatResponses.nominee;
  if (l.includes('claim')) return subscriberChatResponses.claim;
  if (l.includes('retire') || l.includes('pension')) return subscriberChatResponses.retirement;
  if (l.includes('emergency')) return subscriberChatResponses.emergency;
  if (l.includes('insurance') || l.includes('cover')) return subscriberChatResponses.insurance;
  if (l.includes('split') || l.includes('allocation')) return subscriberChatResponses.split;
  if (l.includes('balance')) return subscriberChatResponses.balance;
  if (l.includes('help') || l.includes('support')) return subscriberChatResponses.help;
  return subscriberChatResponses.default;
}
