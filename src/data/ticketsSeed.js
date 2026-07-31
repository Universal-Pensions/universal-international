// Support-ticketing seed — Phase 0 of the subscriber ⇄ agent support inbox.
//
// This module owns the FROZEN ticketing contract: the four status / role /
// category / priority enums and the seed-data generator. Everything else in
// the feature (services, hooks, components) imports the enums from here rather
// than inlining string literals, so the vocabulary has exactly one source of
// truth. The enums are contract constants — components MAY import them. The
// seed data itself is mock data and, like the rest of `src/data`, is only ever
// reached through a service.
//
// Like the other `src/data` modules this file is a demo seed: the "backend" is
// an in-memory session store, so there are no real messaging / notification
// integrations here — just internally-consistent sample threads that make the
// four demo personas (the real `s-0001 ⇄ a-001 ⇄ b-bui-001` chain plus a
// couple of Kampala-Central agents) light up across every UI state the inbox
// needs to demonstrate.
//
// Dates are anchored to `MOCK_NOW` (see `mockData.js`) — never `new Date()` —
// so "replied 3 days ago" copy stays demo-stable across a session and lines up
// with the relative dates used everywhere else in the mock store.

import { MOCK_NOW, AGENTS, SUBSCRIBERS } from './mockData';

// ─── Frozen contract ─────────────────────────────────────────────────────────
// Two-state lifecycle: a closed ticket reopens straight back to `open` and the
// thread records a SYSTEM message marking the reopen.
export const TICKET_STATUS = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
});

export const SENDER_ROLE = Object.freeze({
  SUBSCRIBER: 'subscriber',
  AGENT: 'agent',
  // Employer↔platform support (Phase 7): the employer raises + replies; the
  // "platform support" side speaks through SYSTEM messages (a canned demo
  // reply). There is no separate "support" sender — SYSTEM doubles as it.
  EMPLOYER: 'employer',
  SYSTEM: 'system',
});

export const TICKET_CATEGORY = Object.freeze({
  CONTRIBUTIONS: 'contributions',
  WITHDRAWALS: 'withdrawals',
  CLAIMS: 'claims',
  NOMINEES: 'nominees',
  SCHEDULE: 'schedule',
  ACCOUNT: 'account',
  OTHER: 'other',
});

export const TICKET_PRIORITY = Object.freeze({
  NORMAL: 'normal',
  URGENT: 'urgent',
});

// ─── Time helpers ──────────────────────────────────────────────────────────
// Build ISO timestamps as offsets BEFORE MOCK_NOW so the whole seed sits in a
// stable ~30-day window. `daysAgo` accepts fractional days; `hours` nudges the
// minute so successive messages in a thread don't collide on the same instant.
const MOCK_NOW_MS = MOCK_NOW.getTime();
const DAY_MS = 86400000;

function isoDaysAgo(days, hours = 0) {
  return new Date(MOCK_NOW_MS - days * DAY_MS - hours * 3600000).toISOString();
}

const PREVIEW_LEN = 80;
function preview(body) {
  const trimmed = body.trim();
  return trimmed.length <= PREVIEW_LEN ? trimmed : `${trimmed.slice(0, PREVIEW_LEN - 1).trimEnd()}…`;
}

// ─── Ticket builder ──────────────────────────────────────────────────────────
// Takes a thin ticket spec + an ordered message list (oldest → newest) and
// derives every computed field so the seed can never drift out of sync:
//   - ids: tk-<seq> for the ticket, msg-<tk>-<n> for each message
//   - updatedAt   = last message's `at`
//   - lastMessagePreview = last message body, trimmed
//   - closedAt    >= last message time when closed (caller supplies an offset)
// Unread counters are passed in explicitly because they encode demo intent
// (who has un-seen messages) rather than something mechanically derivable, but
// the builder asserts nothing here — the per-ticket specs below keep them
// consistent with the thread (e.g. an unanswered subscriber-only thread leaves
// `unread.agent` >= 1 and `unread.subscriber` 0).
let _seq = 0;
function buildTicket({
  subscriberId = null,
  agentId,
  branchId,
  // Denormalized employer owner for employer↔platform threads (Phase 7), the
  // mirror of `branchId` for branch oversight. Null for subscriber↔agent seeds.
  employerId = null,
  subject,
  category,
  status,
  priority,
  messages,
  unread,
  closedBy = null,
  closedDaysAgo = null,
  // Id prefix — defaults to the historical `tk-` so subscriber↔agent seeds keep
  // their `tk-NNN` ids unchanged. Employer threads pass `tk-emp-` so their ids
  // (e.g. `tk-emp-001`) can never collide with an employee id (`empe-NNN`).
  idPrefix = 'tk-',
}) {
  _seq += 1;
  const ticketId = `${idPrefix}${String(_seq).padStart(3, '0')}`;

  const builtMessages = messages.map((m, i) => ({
    id: `msg-${ticketId}-${i + 1}`,
    ticketId,
    sender: m.sender,
    body: m.body,
    at: isoDaysAgo(m.daysAgo, m.hours ?? 0),
  }));

  const first = builtMessages[0];
  const last = builtMessages[builtMessages.length - 1];

  const isClosed = status === TICKET_STATUS.CLOSED;
  // closedAt sits at/after the final message — caller passes how many days
  // before MOCK_NOW the ticket was closed; default to the last message instant.
  const closedAt = isClosed
    ? isoDaysAgo(closedDaysAgo ?? messages[messages.length - 1].daysAgo)
    : null;

  return {
    id: ticketId,
    subscriberId,
    agentId,
    branchId, // denormalized for branch/distributor oversight without a join
    employerId, // denormalized for employer↔platform scoping (Phase 7)
    subject,
    category,
    status,
    priority,
    createdAt: first.at,
    updatedAt: last.at,
    closedAt,
    closedBy: isClosed ? closedBy : null,
    lastMessagePreview: preview(last.body),
    // The `employer` slot rides alongside the existing two so every ticket has a
    // full counter set; subscriber↔agent seeds leave it 0 (unread.employer ?? 0).
    unread: {
      subscriber: unread.subscriber,
      agent: unread.agent,
      employer: unread.employer ?? 0,
    },
    messages: builtMessages,
  };
}

// ─── Seed generator ────────────────────────────────────────────────────────
// Cached so repeated calls during a session return the same object identities
// (mirrors the lazy-cache pattern used elsewhere in `src/data`). Returns the
// list sorted by `updatedAt` desc — the order an inbox renders in. Thread
// `messages[]` stay oldest → newest as built.
let _ticketsCache = null;

export function seedTickets() {
  if (_ticketsCache) return _ticketsCache;

  _seq = 0;
  const tickets = [];

  // ── (A) The real demo chain: s-0001 ⇄ a-001 ⇄ b-bui-001 ──────────────────
  // Hierarchy verified against mockData at build time: a-001.parentId is
  // 'b-bui-001' and s-0001.parentId is 'a-001'. These are stable, well-known
  // demo personas (CLAUDE.md §8), so the chain is referenced by id directly.
  const REAL_SUB = 's-0001';
  const REAL_AGENT = 'a-001';
  const REAL_BRANCH = 'b-bui-001';

  // (A.1) OPEN, answered withdrawals thread — BOTH sides have unread messages.
  // The agent answered, the subscriber replied with a follow-up question, and
  // the agent followed up again; neither side has caught up, so both unread
  // counters are positive.
  tickets.push(
    buildTicket({
      subscriberId: REAL_SUB,
      agentId: REAL_AGENT,
      branchId: REAL_BRANCH,
      subject: 'When can I withdraw from my emergency savings?',
      category: TICKET_CATEGORY.WITHDRAWALS,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.NORMAL,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Hello, I need to access part of my savings for a family emergency. How soon can I withdraw from the emergency bucket?',
          daysAgo: 6,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Hi, sorry to hear that. Your emergency bucket is available any time — withdrawals usually reflect within 1–2 working days once you confirm the amount. How much were you hoping to take out?',
          daysAgo: 5,
          hours: 3,
        },
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Thank you. Around half of the emergency balance. Will taking it out affect my retirement bucket at all?',
          daysAgo: 4,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Not at all — the emergency and retirement buckets are kept separate, so your retirement savings stay untouched. I can walk you through confirming the request whenever you are ready.',
          daysAgo: 3,
          hours: 2,
        },
      ],
      // Agent's latest reply is unseen by the subscriber; the subscriber's
      // earlier follow-up is still flagged unseen for the agent.
      unread: { subscriber: 1, agent: 1 },
    }),
  );

  // (A.2) CLOSED nominees thread — resolved and closed by the agent.
  tickets.push(
    buildTicket({
      subscriberId: REAL_SUB,
      agentId: REAL_AGENT,
      branchId: REAL_BRANCH,
      subject: 'Update my nominee details',
      category: TICKET_CATEGORY.NOMINEES,
      status: TICKET_STATUS.CLOSED,
      priority: TICKET_PRIORITY.NORMAL,
      closedBy: SENDER_ROLE.AGENT,
      closedDaysAgo: 18,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'I would like to add my daughter as a nominee and adjust the shares between my beneficiaries.',
          daysAgo: 22,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Happy to help. Could you share your daughter’s full name and her relationship, and tell me the share split you would like across all nominees?',
          daysAgo: 21,
          hours: 4,
        },
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Please set it to 50% for my spouse and 25% each for my two children. My daughter’s name is on the form I filled in at the branch.',
          daysAgo: 20,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'All done — your nominees now show 50/25/25 and your daughter has been added. You can review them any time under Nominees. I’ll close this off, but feel free to reopen if anything looks off.',
          daysAgo: 18,
          hours: 1,
        },
      ],
      // Resolved conversation, both sides caught up before it was closed.
      unread: { subscriber: 0, agent: 0 },
    }),
  );

  // (A.3) OPEN, URGENT, UNANSWERED claims thread — subscriber-only message,
  // no agent reply yet. Drives the agent's "unanswered" count and urgent flag.
  tickets.push(
    buildTicket({
      subscriberId: REAL_SUB,
      agentId: REAL_AGENT,
      branchId: REAL_BRANCH,
      subject: 'Urgent: status of my hospital claim',
      category: TICKET_CATEGORY.CLAIMS,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.URGENT,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'I submitted a hospitalisation claim over two weeks ago and have not heard back. The hospital is asking me to settle the bill. Please can someone check the status urgently?',
          daysAgo: 1,
          hours: 5,
        },
      ],
      // Unanswered: agent has one unseen message, subscriber is waiting.
      unread: { subscriber: 0, agent: 1 },
    }),
  );

  // (A.4) Schedule thread reopened once, then closed again. The reopen lives in
  // the message history as a SYSTEM line so the lifecycle is visible; the
  // ticket is currently CLOSED (closed a second time after the reopen).
  tickets.push(
    buildTicket({
      subscriberId: REAL_SUB,
      agentId: REAL_AGENT,
      branchId: REAL_BRANCH,
      subject: 'Change my contribution schedule to monthly',
      category: TICKET_CATEGORY.SCHEDULE,
      status: TICKET_STATUS.CLOSED,
      priority: TICKET_PRIORITY.NORMAL,
      closedBy: SENDER_ROLE.AGENT,
      closedDaysAgo: 7,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Can you switch my contributions from weekly to monthly? Weekly is hard to keep up with.',
          daysAgo: 15,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Done — your schedule is now monthly, with the next due date moved accordingly. Closing this for now.',
          daysAgo: 14,
          hours: 2,
        },
        {
          sender: SENDER_ROLE.SYSTEM,
          body: 'Ticket reopened by subscriber',
          daysAgo: 10,
        },
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Sorry, one more thing — could you also reduce the monthly amount slightly? Things are a bit tight this quarter.',
          daysAgo: 10,
          hours: -1,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'No problem — I’ve lowered the monthly amount as requested and the change takes effect from your next contribution. Closing this again, but reopen any time.',
          daysAgo: 7,
          hours: 3,
        },
      ],
      // Closed and caught up after the reopen cycle.
      unread: { subscriber: 0, agent: 0 },
    }),
  );

  // ── (B) Kampala Central (b-kam-015) — resolved dynamically ────────────────
  // Pick the first agents that actually belong to b-kam-015 in the generated
  // AGENTS map, then a real subscriber under each. Never hardcode a-001 here:
  // the seeded RNG owns which agent ids land in this branch, so we discover
  // them at runtime to stay robust if the generator shifts.
  const KAM_BRANCH = 'b-kam-015';
  const kamAgents = Object.values(AGENTS)
    .filter((a) => a.parentId === KAM_BRANCH)
    .slice(0, 3);
  const allSubs = Object.values(SUBSCRIBERS);
  const subFor = (agentId) => allSubs.find((s) => s.parentId === agentId) || null;

  // Spread these eight Kampala tickets across the resolved agents in a fixed
  // round-robin so each agent owns a believable mix. Every entry names the
  // subscriber dynamically (first saver under the chosen agent), so the chain
  // subscriber ⇄ agent ⇄ branch is always real.
  const kamSpecs = [
    {
      subject: 'My contribution did not reflect on my statement',
      category: TICKET_CATEGORY.CONTRIBUTIONS,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.NORMAL,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'I paid my contribution via mobile money three days ago but it is not showing on my statement yet. Can you check?',
          daysAgo: 9,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Thanks for flagging this. Contributions can take a short while to settle — could you share the mobile money reference so I can trace it for you?',
          daysAgo: 8,
          hours: 2,
        },
      ],
      unread: { subscriber: 1, agent: 0 },
    },
    {
      subject: 'I cannot log in to my account',
      category: TICKET_CATEGORY.ACCOUNT,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.URGENT,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'I keep getting an error when I try to sign in and the code is not arriving on my phone. I need to check my balance today.',
          daysAgo: 2,
          hours: 6,
        },
      ],
      unread: { subscriber: 0, agent: 1 },
    },
    {
      subject: 'Confirming my withdrawal was paid out',
      category: TICKET_CATEGORY.WITHDRAWALS,
      status: TICKET_STATUS.CLOSED,
      priority: TICKET_PRIORITY.NORMAL,
      closedBy: SENDER_ROLE.SUBSCRIBER,
      closedDaysAgo: 12,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Has my emergency withdrawal been sent? I have not seen it on my mobile money yet.',
          daysAgo: 16,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Yes — it was paid out to your registered mobile money number. It should appear shortly; let me know if it does not arrive by tomorrow.',
          daysAgo: 15,
          hours: 3,
        },
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Received it, thank you very much. You can close this.',
          daysAgo: 12,
          hours: 1,
        },
      ],
      unread: { subscriber: 0, agent: 0 },
    },
    {
      subject: 'How do I increase my monthly savings?',
      category: TICKET_CATEGORY.SCHEDULE,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.NORMAL,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'I got a pay rise and would like to save a bit more each month. What is the easiest way to do that?',
          daysAgo: 11,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Congratulations! You can raise your scheduled amount any time from your contribution schedule. Tell me the new amount you have in mind and I can set it up for you.',
          daysAgo: 10,
          hours: 5,
        },
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Let us try a bit higher than my current amount. I will confirm the exact figure tomorrow.',
          daysAgo: 9,
          hours: 2,
        },
      ],
      unread: { subscriber: 0, agent: 1 },
    },
    {
      subject: 'Question about my insurance claim documents',
      category: TICKET_CATEGORY.CLAIMS,
      status: TICKET_STATUS.CLOSED,
      priority: TICKET_PRIORITY.NORMAL,
      closedBy: SENDER_ROLE.AGENT,
      closedDaysAgo: 20,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'What documents do I need to submit for an outpatient claim?',
          daysAgo: 25,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'For an outpatient claim you will need your treatment receipt and a copy of the medical report. Once you have those, upload them and I will review the claim for you.',
          daysAgo: 24,
          hours: 3,
        },
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'Perfect, that is clear. Thank you.',
          daysAgo: 21,
        },
      ],
      unread: { subscriber: 0, agent: 0 },
    },
    {
      subject: 'Urgent: wrong nominee share on my account',
      category: TICKET_CATEGORY.NOMINEES,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.URGENT,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'My nominee shares are showing the wrong split — my spouse should be the main beneficiary. Please correct this as soon as possible.',
          daysAgo: 3,
          hours: 4,
        },
      ],
      unread: { subscriber: 0, agent: 1 },
    },
    {
      subject: 'Updating my phone number',
      category: TICKET_CATEGORY.ACCOUNT,
      status: TICKET_STATUS.CLOSED,
      priority: TICKET_PRIORITY.NORMAL,
      closedBy: SENDER_ROLE.AGENT,
      closedDaysAgo: 5,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'I have a new phone number. How do I update it so I keep receiving my codes?',
          daysAgo: 8,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'I have updated your contact number on the account. Your sign-in codes will now go to the new number. Closing this off.',
          daysAgo: 5,
          hours: 2,
        },
      ],
      unread: { subscriber: 1, agent: 0 },
    },
    {
      subject: 'General question about how my savings grow',
      category: TICKET_CATEGORY.OTHER,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.NORMAL,
      messages: [
        {
          sender: SENDER_ROLE.SUBSCRIBER,
          body: 'I am new to this — could you explain in simple terms how my savings grow over time?',
          daysAgo: 13,
        },
        {
          sender: SENDER_ROLE.AGENT,
          body: 'Of course! Your contributions buy units, and as the fund grows the value of those units rises, so your balance grows over time alongside what you keep adding. I’m always here if you want me to break down a specific part.',
          daysAgo: 12,
          hours: 4,
        },
      ],
      unread: { subscriber: 1, agent: 0 },
    },
  ];

  kamSpecs.forEach((spec, i) => {
    const agent = kamAgents[i % kamAgents.length];
    if (!agent) return; // defensive: skip if the branch somehow has no agents
    const sub = subFor(agent.id);
    if (!sub) return; // defensive: skip if the agent has no subscribers
    tickets.push(
      buildTicket({
        subscriberId: sub.id,
        agentId: agent.id,
        branchId: KAM_BRANCH,
        subject: spec.subject,
        category: spec.category,
        status: spec.status,
        priority: spec.priority,
        messages: spec.messages,
        unread: spec.unread,
        closedBy: spec.closedBy,
        closedDaysAgo: spec.closedDaysAgo,
      }),
    );
  });

  // ── (C) Employer ⇄ platform support (Phase 7) ─────────────────────────────
  // Standalone employees have no servicing agent, so these threads bypass the
  // subscriber↔agent routing entirely: `subscriberId/agentId/branchId` are null
  // and `employerId` carries the owner. The employer raises + replies; the
  // "platform support" side answers as a SYSTEM message (the canned demo reply).
  // Ids use the `tk-emp-` prefix (reset _seq so they read tk-emp-001..003) — they
  // can never collide with an employee id (`empe-NNN`).
  const EMPLOYER_ID = 'emp-001';
  _seq = 0;

  // (C.1) OPEN contributions thread — employer asked, support replied, employer
  // followed up. The employer has support's latest reply un-seen.
  tickets.push(
    buildTicket({
      employerId: EMPLOYER_ID,
      agentId: null,
      branchId: null,
      subject: 'Why did this month’s contribution run total more than last month?',
      category: TICKET_CATEGORY.CONTRIBUTIONS,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.NORMAL,
      idPrefix: 'tk-emp-',
      messages: [
        {
          sender: SENDER_ROLE.EMPLOYER,
          body: 'Our May contribution run came out noticeably higher than April even though our headcount is the same. Could you help us understand the difference?',
          daysAgo: 5,
        },
        {
          sender: SENDER_ROLE.SYSTEM,
          // Rendered verbatim in the ticket thread for BOTH the employer and the
          // admin, so the explanation has to be true under the unified model:
          // both amounts are a share of PAY, so the only same-headcount reason a
          // run grows is that pay grew. The 10% / 5% figures match the seeded
          // employer config in `employerSeed.js`, and 15% of UGX 400,000 is the
          // UGX 60,000 quoted — keep the arithmetic consistent if either moves.
          body: 'Thanks for reaching out. Your headcount is the same, but three staff had pay rises in May that added UGX 400,000 to your monthly payroll. Both amounts follow pay — staff put in 10% of pay and your company adds 5% of pay — so the run went up by UGX 60,000. We can send a per-employee breakdown if that would help.',
          daysAgo: 4,
          hours: 2,
        },
        {
          sender: SENDER_ROLE.EMPLOYER,
          body: 'That makes sense — yes please, a per-employee breakdown for the May run would be useful for our finance team.',
          daysAgo: 3,
        },
      ],
      // Employer's follow-up is awaiting support; the support reply above is
      // already seen, so only the platform side is owed a response.
      unread: { subscriber: 0, agent: 0, employer: 0 },
    }),
  );

  // (C.2) OPEN, URGENT, unanswered billing thread — employer only, no reply yet.
  // Drives the "unanswered" demo state and the employer's own unread is 0.
  tickets.push(
    buildTicket({
      employerId: EMPLOYER_ID,
      agentId: null,
      branchId: null,
      subject: 'Urgent: invoice for the April run hasn’t arrived',
      category: TICKET_CATEGORY.ACCOUNT,
      status: TICKET_STATUS.OPEN,
      priority: TICKET_PRIORITY.URGENT,
      idPrefix: 'tk-emp-',
      messages: [
        {
          sender: SENDER_ROLE.EMPLOYER,
          body: 'We still haven’t received the billing statement for the April contribution run and our payment deadline is this week. Can someone send it across urgently?',
          daysAgo: 1,
          hours: 4,
        },
      ],
      unread: { subscriber: 0, agent: 0, employer: 0 },
    }),
  );

  // (C.3) CLOSED enrolment thread — resolved and closed by the platform support
  // side. Both sides caught up; the employer has one SYSTEM reply un-seen to
  // demonstrate a closed thread can still carry an unread badge.
  tickets.push(
    buildTicket({
      employerId: EMPLOYER_ID,
      agentId: null,
      branchId: null,
      subject: 'How do we enrol a new batch of staff onto the scheme?',
      category: TICKET_CATEGORY.OTHER,
      status: TICKET_STATUS.CLOSED,
      priority: TICKET_PRIORITY.NORMAL,
      closedBy: SENDER_ROLE.SYSTEM,
      closedDaysAgo: 8,
      idPrefix: 'tk-emp-',
      messages: [
        {
          sender: SENDER_ROLE.EMPLOYER,
          body: 'We’re onboarding twelve new employees next month. What’s the process to add them to the pension scheme and set their contribution split?',
          daysAgo: 12,
        },
        {
          sender: SENDER_ROLE.SYSTEM,
          body: 'Great to hear you’re growing. You’ll be able to add staff in bulk from the Employees section once batch onboarding goes live; in the meantime our team can pre-load the roster for you. Share the list and your default split and we’ll set it up.',
          daysAgo: 11,
          hours: 3,
        },
        {
          sender: SENDER_ROLE.EMPLOYER,
          body: 'Perfect — we’ll use our standard 10% / 5% split. Sending the list over now. Thank you.',
          daysAgo: 9,
        },
        {
          sender: SENDER_ROLE.SYSTEM,
          body: 'Received and loaded — all twelve are on the roster at 10% / 5%. Closing this off, but reopen any time if you need changes.',
          daysAgo: 8,
          hours: 1,
        },
      ],
      // One platform reply still flagged unseen for the employer, to light up a
      // closed-thread unread badge in the demo.
      unread: { subscriber: 0, agent: 0, employer: 1 },
    }),
  );

  // Inbox order: most recently updated first. Thread messages stay oldest →
  // newest as built above.
  tickets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  _ticketsCache = tickets;
  return _ticketsCache;
}
