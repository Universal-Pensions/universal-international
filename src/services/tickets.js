// Support-ticketing service — Phase 0 of the subscriber ⇄ agent support inbox.
//
// The "backend" is an in-memory session store (mirroring subscriber.js): a
// module-level Map, lazy-seeded from seedTickets() on first access, that layers
// demo writes over the seed and resets on refresh. Every mutation clones the
// target ticket and writes a NEW object reference back into the store, so React
// Query's identity-based change detection re-renders consumers (the seed objects
// themselves are never mutated in place).
//
// IS_SUPABASE_ENABLED is imported for parity with the sibling services
// (subscriber.js / commissions.js, which branch on it). Ticketing has no
// Supabase tables in this phase, so there is no real-backend branch to fork —
// the import simply marks this as the in-memory store and leaves a clean seam
// for a future migration. ESLint's flat config does not flag it as unused.
//
// Enums are the FROZEN contract owned by ../data/ticketsSeed.js — never inline a
// status / role / category / priority string literal; import the enum instead.
// Services MAY import mockData; AGENTS is used only to resolve an agent's display
// name for the oversight metrics.

import { IS_SUPABASE_ENABLED } from './api';
import { AGENTS, SUBSCRIBERS } from '../data/mockData';
import {
  TICKET_STATUS,
  TICKET_PRIORITY,
  SENDER_ROLE,
  seedTickets,
} from '../data/ticketsSeed.js';

// ─── In-memory session store ─────────────────────────────────────────────────
// Keyed by ticket id. Lazy-seeded on first access from a DEEP clone of the seed
// so the frozen seed objects are never touched and every value in the store is
// independently mutable.
let _store = null;

function cloneMessage(m) {
  return { ...m };
}

function cloneTicket(t) {
  return {
    ...t,
    unread: { ...t.unread },
    messages: t.messages.map(cloneMessage),
  };
}

function store() {
  if (!_store) {
    _store = new Map();
    // `seedTickets()` already returns the demo threads sorted by updatedAt; we
    // deep-clone each so the frozen seed objects are never mutated and the store
    // holds independently-writable values.
    for (const t of seedTickets()) {
      _store.set(t.id, cloneTicket(t));
    }
  }
  return _store;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const PREVIEW_LEN = 80;
function preview(body) {
  const trimmed = body.trim();
  return trimmed.length <= PREVIEW_LEN ? trimmed : `${trimmed.slice(0, PREVIEW_LEN - 1).trimEnd()}…`;
}

function isBlank(value) {
  return typeof value !== 'string' || value.trim().length === 0;
}

/** Strip the messages[] array — a TicketSummary keeps every scalar + unread. */
function toSummary(ticket) {
  const { messages, ...summary } = ticket; // eslint-disable-line no-unused-vars
  return { ...summary, unread: { ...summary.unread } };
}

/** Newest-updated first — the order an inbox renders in. */
function byUpdatedDesc(a, b) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Build a sorted TicketSummary[] from the store given a predicate. */
function summaries(predicate) {
  return Array.from(store().values())
    .filter(predicate)
    .sort(byUpdatedDesc)
    .map(toSummary);
}

/** Apply the optional status filter on top of a scope predicate. */
function matchesStatus(ticket, status) {
  return status == null || ticket.status === status;
}

function resolveAgentName(agentId) {
  return AGENTS[agentId]?.name ?? 'Unknown';
}

/**
 * Resolve the agent + (denormalized) branch a new ticket should route to.
 * Preference order:
 *   (1) the subscriber's most recent existing ticket — keeps a saver's threads
 *       with the same agent;
 *   (2) a caller-supplied `routing` ({ agentId, branchId }) — the subscriber's
 *       LIVE assignment, resolved from `getSubscriberAgent` (which reads the real
 *       `subscribers.agent_id → agents` chain in Supabase mode). This is the
 *       authoritative source in live mode, where the in-memory mockData chain
 *       does NOT mirror the live seed (the live DB and mockData generate separate
 *       deterministic subscriber/agent sets);
 *   (3) the mockData org chain (subscriber.parentId → agentId, agent.parentId →
 *       branchId) — the fallback for the mock-backed demo, where the caller has
 *       no live assignment to pass.
 * Returns { agentId: null, branchId: null } when nothing resolves; the caller is
 * responsible for surfacing an honest "couldn't reach an agent" state rather than
 * a false success (see createTicket).
 */
function resolveRouting(subscriberId, existing, routing) {
  if (existing?.agentId) {
    return { agentId: existing.agentId, branchId: existing.branchId ?? null };
  }
  if (routing?.agentId) {
    return { agentId: routing.agentId, branchId: routing.branchId ?? null };
  }
  const agentId = SUBSCRIBERS[subscriberId]?.parentId ?? null;
  const branchId = agentId ? (AGENTS[agentId]?.parentId ?? null) : null;
  return { agentId, branchId };
}

/** Next msg-<tk>-<n> id for a ticket's thread. */
function nextMessageId(ticket) {
  return `msg-${ticket.id}-${ticket.messages.length + 1}`;
}

/**
 * Clone a ticket, append a message, and refresh the derived fields
 * (updatedAt, lastMessagePreview) plus the relevant unread counter. Returns the
 * fresh clone WITHOUT writing it to the store — callers decide when to persist.
 */
function appendMessage(ticket, { sender, body, at }) {
  const next = cloneTicket(ticket);
  const message = {
    id: nextMessageId(next),
    ticketId: next.id,
    sender,
    body,
    at,
  };
  next.messages.push(message);
  next.updatedAt = at;
  next.lastMessagePreview = preview(body);
  // Each message bumps the OTHER party's unread counter; the sender's own stays
  // put. For employer↔platform threads the "platform" side is the SYSTEM sender
  // (the canned demo support reply), so a SYSTEM message on an employer thread
  // bumps the employer's unread. A plain SYSTEM line on a subscriber↔agent
  // thread (lifecycle markers like "reopened") still belongs to neither party.
  if (sender === SENDER_ROLE.SUBSCRIBER) next.unread.agent += 1;
  else if (sender === SENDER_ROLE.AGENT) next.unread.subscriber += 1;
  else if (sender === SENDER_ROLE.EMPLOYER) {
    // Employer raised/replied — the platform support side now owes a response.
    // There is no separate platform inbox in the demo, so nothing on the
    // ticket's own counters needs bumping (the employer's own counter is theirs).
  } else if (sender === SENDER_ROLE.SYSTEM && next.employerId) {
    // Canned platform-support reply on an employer thread → employer unread++.
    next.unread.employer = (next.unread.employer ?? 0) + 1;
  }
  return next;
}

// ─── Reads (lists return TicketSummary[]) ────────────────────────────────────

/**
 * Subscriber inbox — tickets owned by one subscriber, newest-updated first.
 * @param {string} subscriberId
 * @param {{ status?: string }} [opts]
 * @returns {Promise<object[]>} TicketSummary[]
 */
export async function listTicketsForSubscriber(subscriberId, { status } = {}) {
  return summaries((t) => t.subscriberId === subscriberId && matchesStatus(t, status));
}

/**
 * Agent inbox — tickets assigned to one agent, newest-updated first.
 * @param {string} agentId
 * @param {{ status?: string }} [opts]
 * @returns {Promise<object[]>} TicketSummary[]
 */
export async function listTicketsForAgent(agentId, { status } = {}) {
  return summaries((t) => t.agentId === agentId && matchesStatus(t, status));
}

/**
 * Branch oversight (view-only) — every ticket whose denormalized branchId
 * matches, optionally narrowed to a single agent. No join: branchId rides on
 * each ticket so a branch can read its whole inbox without resolving agents.
 * @param {string} branchId
 * @param {{ status?: string, agentId?: string }} [opts]
 * @returns {Promise<object[]>} TicketSummary[]
 */
export async function listTicketsForBranch(branchId, { status, agentId } = {}) {
  return summaries(
    (t) =>
      t.branchId === branchId &&
      (agentId == null || t.agentId === agentId) &&
      matchesStatus(t, status),
  );
}

/**
 * Distributor oversight (view-only) — the distributor sits at the top of the
 * tree and sees ALL tickets, optionally narrowed by branch and/or agent. The
 * distributorId is accepted for signature symmetry with the branch/agent reads
 * (there is one distributor in the demo network) but does not filter — there is
 * no per-distributor partition of tickets to scope to.
 * @param {string} distributorId
 * @param {{ status?: string, branchId?: string, agentId?: string }} [opts]
 * @returns {Promise<object[]>} TicketSummary[]
 */
export async function listTicketsForDistributor(distributorId, { status, branchId, agentId } = {}) {
  return summaries(
    (t) =>
      (branchId == null || t.branchId === branchId) &&
      (agentId == null || t.agentId === agentId) &&
      matchesStatus(t, status),
  );
}

/**
 * Employer support inbox (Phase 7) — employer↔platform tickets owned by one
 * employer, newest-updated first. Scoped purely by the denormalized
 * `employerId` (these threads have no agent/branch/subscriber), so this read is
 * the mirror of `listTicketsForSubscriber` for the employer role.
 * @param {string} employerId
 * @param {{ status?: string }} [opts]
 * @returns {Promise<object[]>} TicketSummary[]
 */
export async function listTicketsForEmployer(employerId, { status } = {}) {
  return summaries((t) => t.employerId === employerId && matchesStatus(t, status));
}

/**
 * Platform-wide inbox for the ADMIN — every ticket from every channel
 * (subscriber↔agent and employer↔platform), optionally narrowed.
 *
 * Distinct from `listTicketsForDistributor` only in intent, not in result: that
 * function also returns everything, because there is no per-distributor
 * partition of tickets to scope to. It exists separately because the admin has
 * no `distributorId` claim, so calling the distributor read forced a `?? 'd-001'`
 * fallback at the call site — code that reads as "the admin is looking at
 * d-001's inbox" when it is really looking at all of them.
 *
 * @param {{ status?: string, branchId?: string, agentId?: string }} [opts]
 * @returns {Promise<object[]>} TicketSummary[]
 */
export async function listTicketsForPlatform({ status, branchId, agentId } = {}) {
  return summaries(
    (t) =>
      (branchId == null || t.branchId === branchId) &&
      (agentId == null || t.agentId === agentId) &&
      matchesStatus(t, status),
  );
}

/**
 * Full thread for one ticket, with messages[] oldest → newest. Returns a fresh
 * clone (never the stored reference) or null if the ticket doesn't exist.
 * @param {string} ticketId
 * @returns {Promise<object|null>} Ticket | null
 */
export async function getThread(ticketId) {
  const ticket = store().get(ticketId);
  return ticket ? cloneTicket(ticket) : null;
}

// ─── Metrics (oversight) ─────────────────────────────────────────────────────

const MS_PER_HOUR = 3600000;

/** Round to one decimal place — enough precision for an hours figure. */
function roundHours(value) {
  return Math.round(value * 10) / 10;
}

/**
 * First support-reply timestamp in a thread, or null if support never replied.
 * The "support" side is the AGENT for subscriber↔agent threads and the SYSTEM
 * sender (canned platform reply) for employer↔platform threads — keyed off the
 * denormalized `employerId` so the existing roles' math is unchanged.
 */
function firstAgentMessageAt(ticket) {
  const replySender = ticket.employerId ? SENDER_ROLE.SYSTEM : SENDER_ROLE.AGENT;
  const reply = ticket.messages.find((m) => m.sender === replySender);
  return reply ? reply.at : null;
}

/**
 * True when the latest message in an OPEN thread is from the requester (the
 * subscriber for subscriber↔agent threads, the employer for employer↔platform
 * threads) — i.e. the support side still owes a reply.
 */
function isUnanswered(ticket) {
  if (ticket.status !== TICKET_STATUS.OPEN) return false;
  const last = ticket.messages[ticket.messages.length - 1];
  if (!last) return false;
  const requesterSender = ticket.employerId ? SENDER_ROLE.EMPLOYER : SENDER_ROLE.SUBSCRIBER;
  return last.sender === requesterSender;
}

/**
 * Fold a set of tickets into the TicketMetrics shape. Shared by the branch and
 * distributor metric reads — they differ only in which tickets they pass in.
 */
function computeMetrics(tickets) {
  let openCount = 0;
  let closedCount = 0;
  let unansweredCount = 0;
  // Urgent-and-still-open. Drives the admin Needs-attention card's severity: one
  // unanswered urgent complaint outranks eight routine ones, so volume alone is
  // the wrong escalation signal. Additive — existing consumers ignore it.
  let urgentOpenCount = 0;

  const firstResponseHours = [];
  const resolutionHours = [];

  // Per-agent tallies, keyed by agentId in first-seen order.
  const agentRows = new Map();
  const ensureAgentRow = (agentId) => {
    if (!agentRows.has(agentId)) {
      agentRows.set(agentId, {
        agentId,
        name: resolveAgentName(agentId),
        openCount: 0,
        closedCount: 0,
        unansweredCount: 0,
      });
    }
    return agentRows.get(agentId);
  };

  for (const t of tickets) {
    const open = t.status === TICKET_STATUS.OPEN;
    const closed = t.status === TICKET_STATUS.CLOSED;
    if (open) openCount += 1;
    if (closed) closedCount += 1;
    if (open && t.priority === TICKET_PRIORITY.URGENT) urgentOpenCount += 1;

    const unanswered = isUnanswered(t);
    if (unanswered) unansweredCount += 1;

    const firstReplyAt = firstAgentMessageAt(t);
    if (firstReplyAt) {
      firstResponseHours.push(
        (new Date(firstReplyAt).getTime() - new Date(t.createdAt).getTime()) / MS_PER_HOUR,
      );
    }
    if (closed && t.closedAt) {
      resolutionHours.push(
        (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / MS_PER_HOUR,
      );
    }

    const row = ensureAgentRow(t.agentId);
    if (open) row.openCount += 1;
    if (closed) row.closedCount += 1;
    if (unanswered) row.unansweredCount += 1;
  }

  const mean = (arr) => (arr.length ? roundHours(arr.reduce((s, n) => s + n, 0) / arr.length) : 0);

  return {
    openCount,
    closedCount,
    totalCount: tickets.length,
    avgFirstResponseHours: mean(firstResponseHours),
    avgResolutionHours: mean(resolutionHours),
    unansweredCount,
    urgentOpenCount,
    byAgent: Array.from(agentRows.values()),
  };
}

/**
 * Platform-wide ticket metrics for the ADMIN — same TicketMetrics shape as the
 * other oversight reads, folded over every ticket in the store.
 *
 * NOTE ON HONESTY: ticketing has no Supabase tables. This folds the in-memory
 * session store (seeded from src/data/ticketsSeed.js), so the count is
 * session-local and identical for every viewer, and resets on refresh. That is
 * why the admin Needs-attention card labels this row "Open support threads"
 * rather than making an SLA claim about it. The ACTION on the row is still real:
 * notifying the assignee writes an actual `notifications` row (0097) keyed to a
 * real agent or branch.
 *
 * @returns {Promise<object>} TicketMetrics (incl. urgentOpenCount)
 */
export async function getPlatformTicketMetrics() {
  return computeMetrics(Array.from(store().values()));
}

/**
 * Branch ticket metrics — folds every ticket in the branch into counts +
 * response/resolution averages + a per-agent breakdown.
 * @param {string} branchId
 * @returns {Promise<object>} TicketMetrics
 */
export async function getBranchTicketMetrics(branchId) {
  const tickets = Array.from(store().values()).filter((t) => t.branchId === branchId);
  return computeMetrics(tickets);
}

/**
 * Distributor ticket metrics — folds ALL tickets (optionally narrowed to one
 * branch) into the same TicketMetrics shape.
 * @param {string} distributorId
 * @param {{ branchId?: string }} [opts]
 * @returns {Promise<object>} TicketMetrics
 */
export async function getDistributorTicketMetrics(distributorId, { branchId } = {}) {
  const tickets = Array.from(store().values()).filter(
    (t) => branchId == null || t.branchId === branchId,
  );
  return computeMetrics(tickets);
}

/**
 * Employer support metrics (Phase 7) — folds one employer's employer↔platform
 * tickets into the shared TicketMetrics shape (open/closed/unanswered counts +
 * response/resolution averages). Reuses `computeMetrics`; the `byAgent`
 * breakdown it returns is not meaningful for employer↔platform threads (they
 * carry no agent) and is ignored by the employer UI, which reads only the
 * scalar counts.
 * @param {string} employerId
 * @returns {Promise<object>} TicketMetrics
 */
export async function getEmployerTicketMetrics(employerId) {
  const tickets = Array.from(store().values()).filter((t) => t.employerId === employerId);
  return computeMetrics(tickets);
}

// ─── Mutations (every write returns a fresh cloned Ticket) ───────────────────

let _createSeq = 0;
/** Mint a tk-<n> id that won't collide with the seeded ids already in the store. */
function nextTicketId() {
  let id;
  do {
    _createSeq += 1;
    id = `tk-${String(seedTickets().length + _createSeq).padStart(3, '0')}`;
  } while (store().has(id));
  return id;
}

let _createEmployerSeq = 0;
/**
 * Mint a tk-emp-<n> id for a newly-raised employer ticket that won't collide
 * with the seeded `tk-emp-NNN` ids already in the store. Kept distinct from the
 * subscriber `tk-NNN` namespace AND from any `empe-NNN` employee id.
 */
function nextEmployerTicketId() {
  let id;
  do {
    _createEmployerSeq += 1;
    id = `tk-emp-${String(100 + _createEmployerSeq).padStart(3, '0')}`;
  } while (store().has(id));
  return id;
}

/**
 * Open a new ticket on behalf of a subscriber. The new ticket's agent + branch
 * are resolved by resolveRouting (existing thread → caller-supplied live routing
 * → mockData org chain). The first message is the subscriber's body;
 * unread.agent starts at 1 (the agent has it un-seen).
 *
 * Callers in live mode SHOULD pass `routing` (the subscriber's live
 * `agent_id`/`branch_id`, e.g. from `getSubscriberAgent`) so the ticket reaches
 * the real assigned agent's inbox — the frozen mockData chain does NOT mirror
 * the live seed. When routing resolves to `null` (no agent assigned), the ticket
 * is still created (so it surfaces in branch/distributor oversight rather than
 * being lost) but `agentId` is `null`; the caller is responsible for not showing
 * a false "sent to your agent" success in that case.
 *
 * @param {string} subscriberId
 * @param {{ subject: string, category: string, priority: string, body: string }} payload
 * @param {{ agentId?: string|null, branchId?: string|null }} [routing] - the
 *   subscriber's live agent/branch assignment, used when there is no prior thread
 * @returns {Promise<object>} the newly created Ticket (agentId may be null)
 * @throws if subject or body is empty/whitespace
 */
export async function createTicket(subscriberId, { subject, category, priority, body } = {}, routing) {
  if (isBlank(subject)) throw new Error('Ticket subject is required');
  if (isBlank(body)) throw new Error('Ticket message is required');

  // Resolve the subscriber's agent + branch so the new ticket carries the same
  // denormalized routing the oversight views rely on. Prefer an existing thread's
  // assignment; else the caller's live routing; else the mockData org chain.
  const existing = Array.from(store().values())
    .filter((t) => t.subscriberId === subscriberId)
    .sort(byUpdatedDesc)[0];
  const { agentId, branchId } = resolveRouting(subscriberId, existing, routing);

  const now = new Date().toISOString();
  const id = nextTicketId();
  const trimmedSubject = subject.trim();
  const message = {
    id: `msg-${id}-1`,
    ticketId: id,
    sender: SENDER_ROLE.SUBSCRIBER,
    body,
    at: now,
  };
  const ticket = {
    id,
    subscriberId,
    agentId,
    branchId,
    subject: trimmedSubject,
    category,
    status: TICKET_STATUS.OPEN,
    priority,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    closedBy: null,
    lastMessagePreview: preview(body),
    unread: { subscriber: 0, agent: 1 },
    messages: [message],
  };
  store().set(id, ticket);
  return cloneTicket(ticket);
}

/**
 * Open a new ticket as the AGENT messaging a subscriber — the inverse of
 * createTicket (which models a subscriber-initiated thread). Powers the "nudge"
 * feature: the first message is from the agent, so the SUBSCRIBER has it unseen
 * (`unread.subscriber = 1`). Routing is resolved the same way (existing thread →
 * caller routing → mock org chain); pass `routing={ agentId }` (the nudging
 * agent) so the thread also lands in that agent's inbox.
 *
 * @param {string} subscriberId
 * @param {{ body: string, subject?: string, category?: string }} payload
 * @param {{ agentId?: string|null, branchId?: string|null }} [routing]
 * @returns {Promise<object>} the newly created Ticket
 * @throws if body is empty/whitespace
 */
export async function createAgentMessage(subscriberId, { body, subject, category } = {}, routing) {
  if (isBlank(body)) throw new Error('Message is required');

  const existing = Array.from(store().values())
    .filter((t) => t.subscriberId === subscriberId)
    .sort(byUpdatedDesc)[0];
  const { agentId, branchId } = resolveRouting(subscriberId, existing, routing);

  const now = new Date().toISOString();
  const id = nextTicketId();
  const message = {
    id: `msg-${id}-1`,
    ticketId: id,
    sender: SENDER_ROLE.AGENT,
    body,
    at: now,
  };
  const ticket = {
    id,
    subscriberId,
    agentId,
    branchId,
    subject: (subject && subject.trim()) || 'Contribution reminder',
    category: category || 'contributions',
    status: TICKET_STATUS.OPEN,
    priority: 'normal',
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    closedBy: null,
    lastMessagePreview: preview(body),
    unread: { subscriber: 1, agent: 0 },
    messages: [message],
  };
  store().set(id, ticket);
  return cloneTicket(ticket);
}

/**
 * Open a new employer↔platform support ticket (Phase 7). Standalone employees
 * have no servicing agent, so this BYPASSES `resolveRouting` entirely:
 * `subscriberId`/`agentId`/`branchId` are all null and the denormalized
 * `employerId` carries the owner. The first message is the employer's body and
 * the thread opens OPEN. Unlike the subscriber path there is no platform inbox
 * counter to seed, so all three unread slots start at 0.
 *
 * @param {string} employerId
 * @param {{ subject: string, category: string, priority: string, body: string }} payload
 * @returns {Promise<object>} the newly created Ticket
 * @throws if subject or body is empty/whitespace
 */
export async function createEmployerTicket(employerId, { subject, category, priority, body } = {}) {
  if (isBlank(subject)) throw new Error('Ticket subject is required');
  if (isBlank(body)) throw new Error('Ticket message is required');

  const now = new Date().toISOString();
  const id = nextEmployerTicketId();
  const trimmedSubject = subject.trim();
  const message = {
    id: `msg-${id}-1`,
    ticketId: id,
    sender: SENDER_ROLE.EMPLOYER,
    body,
    at: now,
  };
  const ticket = {
    id,
    subscriberId: null,
    agentId: null,
    branchId: null,
    employerId,
    subject: trimmedSubject,
    category,
    status: TICKET_STATUS.OPEN,
    priority,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    closedBy: null,
    lastMessagePreview: preview(body),
    unread: { subscriber: 0, agent: 0, employer: 0 },
    messages: [message],
  };
  store().set(id, ticket);
  return cloneTicket(ticket);
}

/**
 * Append a message to a thread, bump updatedAt + lastMessagePreview, and
 * increment the recipient's unread counter. Returns the full updated ticket.
 *
 * @param {string} ticketId
 * @param {{ sender: string, body: string }} payload
 * @returns {Promise<object|null>} the updated Ticket, or null if not found
 * @throws if body is empty/whitespace
 */
export async function sendMessage(ticketId, { sender, body } = {}) {
  if (isBlank(body)) throw new Error('Message body is required');
  const ticket = store().get(ticketId);
  if (!ticket) return null;

  const next = appendMessage(ticket, { sender, body, at: new Date().toISOString() });
  store().set(ticketId, next);
  return cloneTicket(next);
}

/**
 * Close a ticket. GUARD: only an OPEN ticket can be closed — otherwise the
 * ticket is returned unchanged (mirrors commissions.js invalid-transition idiom).
 *
 * @param {string} ticketId
 * @param {{ by: string }} payload - SenderRole that closed it
 * @returns {Promise<object|null>} the updated Ticket, or null if not found
 */
export async function closeTicket(ticketId, { by } = {}) {
  const ticket = store().get(ticketId);
  if (!ticket) return null;
  if (ticket.status !== TICKET_STATUS.OPEN) return cloneTicket(ticket);

  const next = cloneTicket(ticket);
  next.status = TICKET_STATUS.CLOSED;
  next.closedAt = new Date().toISOString();
  next.closedBy = by;
  store().set(ticketId, next);
  return cloneTicket(next);
}

/**
 * Reopen a ticket. GUARD: only a CLOSED ticket can be reopened — otherwise the
 * ticket is returned unchanged. Reopening flips the status back to open, clears
 * closedAt/closedBy, AND appends a SYSTEM message marking the reopen (which
 * bumps updatedAt + lastMessagePreview). A system message belongs to neither
 * party's unread count.
 *
 * @param {string} ticketId
 * @param {{ by: string }} payload - SenderRole that reopened it
 * @returns {Promise<object|null>} the updated Ticket, or null if not found
 */
export async function reopenTicket(ticketId, { by } = {}) {
  const ticket = store().get(ticketId);
  if (!ticket) return null;
  if (ticket.status !== TICKET_STATUS.CLOSED) return cloneTicket(ticket);

  const reopened = appendMessage(ticket, {
    sender: SENDER_ROLE.SYSTEM,
    body: `Ticket reopened by ${by}`,
    at: new Date().toISOString(),
  });
  reopened.status = TICKET_STATUS.OPEN;
  reopened.closedAt = null;
  reopened.closedBy = null;
  store().set(ticketId, reopened);
  return cloneTicket(reopened);
}

/**
 * Mark a thread read for one viewer — zero that viewer's unread counter.
 * @param {string} ticketId
 * @param {{ viewer: 'subscriber'|'agent'|'employer' }} payload
 * @returns {Promise<object|null>} the updated Ticket, or null if not found
 */
export async function markRead(ticketId, { viewer } = {}) {
  const ticket = store().get(ticketId);
  if (!ticket) return null;

  const next = cloneTicket(ticket);
  if (viewer === SENDER_ROLE.SUBSCRIBER) next.unread.subscriber = 0;
  else if (viewer === SENDER_ROLE.AGENT) next.unread.agent = 0;
  else if (viewer === SENDER_ROLE.EMPLOYER) next.unread.employer = 0;
  store().set(ticketId, next);
  return cloneTicket(next);
}
