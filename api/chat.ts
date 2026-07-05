// POST /api/chat
//
// JWT-optional. If a valid token is present, `req.user.app_role` decides the
// flavor of the reply (agent vs subscriber vs distributor/branch). If not,
// we fall back to the request body's `context` flag, then to the
// 'subscriber' default.
//
// Body: { message: string, context?: 'admin' | 'agent' | 'subscriber' }
// Returns: { reply: string, suggestions?: string[] }
//
// IMPORTANT: the role flavor is derived from the JWT (req.user.app_role) first
// — NOT `req.user.role`, which is always the literal Postgres role
// `"authenticated"` (see api/_lib/jwt.ts). `context` from the body is only
// honored when the caller is unauthenticated — body-supplied roles must never
// override JWT-verified ones.
//
// Port of src/services/chat.js — keyword matching, no LLM. The
// distributor/admin/branch flavor reuses the same data-aware sentences as
// `getChatResponse`, but with hard-coded numbers in place of mockData
// lookups so this route doesn't pull the entire frontend data graph into
// the serverless bundle.

import type { VercelResponse } from '@vercel/node';
import { withOptionalAuth, type MaybeAuthedRequest } from './_lib/withOptionalAuth.js';
import { checkLen } from './_lib/assertLen.js';

type ChatContext = 'admin' | 'agent' | 'subscriber';
type ChatBody = { message?: unknown; context?: unknown };
type ChatResponse = { reply: string; suggestions?: string[] };

// ─── Distributor / branch / admin flavor ────────────────────────────────────
//
// In the JS service `getChatResponse` builds these strings from mockData at
// runtime. Server-side we don't have mockData (and shouldn't bundle it), so
// we use the same wording with a placeholder for the live numbers. Agent 12
// will switch the frontend to call this route; once the backend has real
// aggregates it can swap these strings for genuine queries.
const adminResponses: Record<string, string> = {
  default:
    'I can help you analyse your pension network data. Ask about subscribers, agents, coverage, or contributions!',
  agent:
    'Top agents by performance lead the network at ~95%. The network average sits around 78%.',
  coverage:
    'Coverage varies by region: Central leads, followed by Western, Eastern, and Northern. National average is around 64%.',
  subscriber:
    'You have roughly 30k subscribers across 314 branches, with an active rate of ~82%. Central region leads on volume.',
  gender:
    'Network-wide gender split sits around 52% male, 47% female, 1% other. Central region has the most balanced split.',
};

const adminSuggestions = [
  'Top agents this week',
  'Coverage by region',
  'Active subscribers',
  'Gender split',
];

function adminReply(message: string): ChatResponse {
  const l = message.toLowerCase();
  if (l.includes('agent') || l.includes('top')) {
    return { reply: adminResponses.agent, suggestions: adminSuggestions };
  }
  if (l.includes('coverage') || l.includes('region')) {
    return { reply: adminResponses.coverage, suggestions: adminSuggestions };
  }
  if (l.includes('subscriber') || l.includes('active')) {
    return { reply: adminResponses.subscriber, suggestions: adminSuggestions };
  }
  if (l.includes('gender') || l.includes('split')) {
    return { reply: adminResponses.gender, suggestions: adminSuggestions };
  }
  return { reply: adminResponses.default, suggestions: adminSuggestions };
}

// ─── Agent flavor ───────────────────────────────────────────────────────────
//
// Mirrors `getAgentReply` (subscriber → agent DM responses). Without a
// signed-in agent name we use 'your agent' as the fallback firstName.
function agentReply(message: string, firstName = 'your agent'): ChatResponse {
  const l = (message || '').toLowerCase();
  if (l.includes('contribute') || l.includes('top up') || l.includes('top-up')) {
    return {
      reply:
        "Sure — easiest is to use the Top up button on your dashboard. If you'd prefer Mobile Money via me, send the amount and I'll send a payment prompt to your phone.",
    };
  }
  if (l.includes('withdraw')) {
    return {
      reply:
        'Got it. Emergency bucket withdrawals are usually 1–2 working days. I can walk you through the form, or process it on your behalf if you share the amount and reason.',
    };
  }
  if (l.includes('nominee') || l.includes('beneficiary')) {
    return {
      reply:
        "Happy to help update your nominees. We'll need each person's full name, NIN, and the share %. Shares must total 100%.",
    };
  }
  if (l.includes('schedule') || l.includes('frequency') || l.includes('split')) {
    return {
      reply:
        "Your contribution schedule can be changed any time. Want me to suggest a split based on your goals? Tell me how soon you'd want to retire or what you're saving for.",
    };
  }
  if (l.includes('insurance') || l.includes('claim')) {
    return {
      reply:
        "For insurance and claims I'll need a few details: type of claim, incident date, and any documents. I'll guide you through the rest.",
    };
  }
  if (
    l.includes('meet') ||
    l.includes('visit') ||
    l.includes('branch') ||
    l.includes('appointment')
  ) {
    return {
      reply:
        '— I can meet you at the branch or come to your area. What day this week works for you?',
    };
  }
  if (l.includes('thanks') || l.includes('thank you')) {
    return {
      reply:
        'Always happy to help. Reach out any time on this thread or call my number on the profile.',
    };
  }
  if (l.includes('hi') || l.includes('hello') || l.includes('hey')) {
    return { reply: `Hi! ${firstName} here. How can I help you today?` };
  }
  return {
    reply:
      "Thanks for the message — I'll get back to you shortly. If it's urgent, you can also call me on the number above.",
  };
}

// ─── Subscriber flavor ──────────────────────────────────────────────────────
//
// Mirrors `getSubscriberChatResponse` (subscriber-facing co-pilot).
const subscriberResponses: Record<string, string> = {
  default:
    'I can help with your savings, contributions, withdrawals, insurance, and nominees. Try asking how to withdraw or change your split.',
  withdraw:
    'You can withdraw from your Emergency bucket any time. Retirement funds unlock at age 60. Tap the Withdraw button on your dashboard to begin.',
  contribute:
    "To add money, tap 'Make a Contribution' — you can use the default split (80/20) or customise just this top-up.",
  schedule:
    'Your schedule controls how often and how much you save. Head to Settings → Contribution schedule to change frequency, amount, or the retirement/emergency split.',
  nominee:
    'Nominees receive your savings or insurance benefit. You can change them any time under "Update nominees". Shares must total 100%.',
  claim:
    "To file an insurance claim, open Insurance → Claims → 'File a new claim'. Have the incident date and any supporting documents ready.",
  retirement:
    'Your retirement bucket compounds monthly. Increase your schedule or retirement % to grow your projected income.',
  emergency:
    "Your Emergency bucket is designed for hardship situations — medical, education, housing, or business. It's withdrawable any time.",
  insurance:
    'Your baseline cover is UGX 1,000,000 for an annual premium of UGX 24,000 — you pay it once a year, or build it automatically from the emergency slice of your savings. Upgrade options are available under Insurance → Coverage.',
  split:
    'A balanced split is 80% retirement / 20% emergency. Adjust any time — the donut on your dashboard updates immediately.',
  balance:
    'Your total balance reflects contributions minus withdrawals, translated to units at the latest unit value.',
  help:
    'Our help desk is open 8am–8pm. You can call, message us on WhatsApp, or email support@upensions.ug.',
};

const subscriberSuggestions = [
  'How do I withdraw?',
  'Change my schedule',
  'Update nominees',
  'Insurance cover',
];

function subscriberReply(message: string): ChatResponse {
  const l = (message || '').toLowerCase();
  if (l.includes('withdraw') || l.includes('take out')) {
    return { reply: subscriberResponses.withdraw, suggestions: subscriberSuggestions };
  }
  if (l.includes('contribute') || l.includes('top up') || l.includes('top-up')) {
    return { reply: subscriberResponses.contribute, suggestions: subscriberSuggestions };
  }
  if (l.includes('schedule') || l.includes('frequency') || l.includes('change my')) {
    return { reply: subscriberResponses.schedule, suggestions: subscriberSuggestions };
  }
  if (l.includes('nominee') || l.includes('beneficiary')) {
    return { reply: subscriberResponses.nominee, suggestions: subscriberSuggestions };
  }
  if (l.includes('claim')) {
    return { reply: subscriberResponses.claim, suggestions: subscriberSuggestions };
  }
  if (l.includes('retire') || l.includes('pension')) {
    return { reply: subscriberResponses.retirement, suggestions: subscriberSuggestions };
  }
  if (l.includes('emergency')) {
    return { reply: subscriberResponses.emergency, suggestions: subscriberSuggestions };
  }
  if (l.includes('insurance') || l.includes('cover')) {
    return { reply: subscriberResponses.insurance, suggestions: subscriberSuggestions };
  }
  if (l.includes('split') || l.includes('allocation')) {
    return { reply: subscriberResponses.split, suggestions: subscriberSuggestions };
  }
  if (l.includes('balance')) {
    return { reply: subscriberResponses.balance, suggestions: subscriberSuggestions };
  }
  if (l.includes('help') || l.includes('support')) {
    return { reply: subscriberResponses.help, suggestions: subscriberSuggestions };
  }
  return { reply: subscriberResponses.default, suggestions: subscriberSuggestions };
}

// ─── Role → flavor mapping ──────────────────────────────────────────────────
//
// distributor + branch + admin all use the "admin" data-aware flavor.
// agent uses the agent DM flavor. subscriber (and unknown) uses the
// subscriber co-pilot flavor.
function flavorForRole(role: string | undefined): ChatContext {
  if (!role) return 'subscriber';
  if (role === 'distributor' || role === 'branch' || role === 'admin') return 'admin';
  if (role === 'agent') return 'agent';
  return 'subscriber';
}

// B14 demo-scope policy (DO NOT TIGHTEN without consulting demo-flow owners):
//
// This route accepts a body-supplied `context` field that overrides the
// default flavor when the caller is unauthenticated. The asymmetry —
// authenticated callers get the JWT-derived role, unauthenticated callers
// get the body-supplied one — is intentional: the public landing-page demo
// widgets (e.g. the "ask the data assistant" hero chip) need to demo the
// admin/agent flavors of this endpoint without minting a real session for
// the sales rep walking a prospect through. Tightening this to "JWT or
// 401" would break the landing-page demo flows; the audit (finding B14)
// explicitly recommends documenting the policy rather than changing
// semantics. If you need to revisit this, sync with the demo-flow owners
// first and check the landing-page chat embeds before shipping.
function resolveFlavor(req: MaybeAuthedRequest, bodyContext: unknown): ChatContext {
  // JWT-verified application role takes precedence — never trust body for an
  // authenticated caller. Read `app_role` (the application role), NOT `role`:
  // the JWT `role` claim is hardcoded to the Postgres role `"authenticated"`
  // (api/_lib/jwt.ts), so gating on it always falls through to 'subscriber'.
  if (req.user?.app_role) return flavorForRole(req.user.app_role);
  if (bodyContext === 'admin' || bodyContext === 'agent' || bodyContext === 'subscriber') {
    return bodyContext;
  }
  return 'subscriber';
}

async function chatHandler(req: MaybeAuthedRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ code: 'method_not_allowed' });
    return;
  }

  // B13: every response path on this route must be uncacheable. Setting the
  // header once at the top of the handler covers success + all 4xx paths.
  res.setHeader('Cache-Control', 'no-store');

  const body = (req.body ?? {}) as ChatBody;
  // B15: explicit typeof guard before .trim() so a non-string `message`
  // (e.g. `null`, an object, a number) fails fast with `invalid_message`
  // instead of TypeError-ing into a 500. Matches the file's existing error
  // pattern: `{ code: '<reason>' }` for shape errors.
  if (typeof body.message !== 'string') {
    res.status(400).json({ code: 'invalid_message' });
    return;
  }
  const message = body.message;
  if (!message.trim()) {
    res.status(400).json({ code: 'invalid_message' });
    return;
  }

  // §2a.5: explicit length caps on the public body fields before doing any
  // work. `message` is the free-text spam vector; `context` is also bounded
  // defensively (only the three literal flavors are ever honored downstream,
  // but reject an over-length body value up front rather than ignoring it).
  const messageTooLong = checkLen(message, 4000, 'message_too_long');
  if (messageTooLong) {
    res.status(400).json(messageTooLong);
    return;
  }
  if (typeof body.context === 'string') {
    const contextTooLong = checkLen(body.context, 32, 'context_too_long');
    if (contextTooLong) {
      res.status(400).json(contextTooLong);
      return;
    }
  }

  const flavor = resolveFlavor(req, body.context);

  let result: ChatResponse;
  if (flavor === 'admin') result = adminReply(message);
  else if (flavor === 'agent') result = agentReply(message);
  else result = subscriberReply(message);

  res.status(200).json(result);
}

export default withOptionalAuth(chatHandler);
