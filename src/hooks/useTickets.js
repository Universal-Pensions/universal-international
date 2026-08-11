// React Query hooks for the support-ticketing inbox (subscriber ⇄ agent, with
// branch + distributor oversight). Components consume these; they never import
// the ticket service or mockData directly. They MAY import the frozen enums
// (SENDER_ROLE / TICKET_STATUS / …) from ../data/ticketsSeed.js — those are
// contract constants, not data.
//
// ── Optimistic-update pattern (used by the mutations below) ──
// Mirrors useSubscriber.js / useAgent.js: onMutate cancels affected queries,
// snapshots their caches, and applies an optimistic patch so the UI reflects
// the write immediately; onError restores from the snapshot; onSettled calls
// invalidateAllTickets so the in-memory store's truth wins on the next refetch.
//
// ── Cross-view propagation ──
// A send / close / reopen / read in one role's view must surface in every other
// open view (the subscriber's thread, the agent's inbox, the branch + distributor
// oversight lists, and the per-role metrics). Rather than enumerate every key,
// each mutation invalidates the three shared key prefixes via invalidateAllTickets.
//
// ── Polling ──
// Lists/threads poll on an interval so the demo feels live within a session.
// Every polled read sets refetchIntervalInBackground:false, so a backgrounded
// tab (document.visibilityState === 'hidden') stops polling entirely and resumes
// when it returns to the foreground — refetchOnWindowFocus (default-on) pulls the
// latest state on return, so a hidden tab no longer hammers the store while away.
// Behavior is identical when the tab is visible. The agent list key is kept
// stable so the inbox screen and the nav unread badge share one cache entry
// (they dedupe).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SENDER_ROLE, TICKET_STATUS } from '../data/ticketsSeed.js';
import * as tickets from '../services/tickets';

// Poll cadences (ms). Personal inboxes refresh fastest; oversight lists are
// heavier and less time-critical, so they poll more slowly; the open thread is
// the most live surface of all.
const POLL_INBOX = 8000;
const POLL_OVERSIGHT = 15000;
const POLL_THREAD = 5000;
const POLL_METRICS = 15000;

const PREVIEW_LEN = 80;
/** Mirror the service's preview() so optimistic patches match the eventual truth. */
function preview(body) {
  const trimmed = body.trim();
  return trimmed.length <= PREVIEW_LEN
    ? trimmed
    : `${trimmed.slice(0, PREVIEW_LEN - 1).trimEnd()}…`;
}

// ─── Reads (lists return TicketSummary[]) ────────────────────────────────────

/**
 * Subscriber inbox — tickets owned by one subscriber, newest-updated first.
 * @param {string|null|undefined} subscriberId
 * @param {{ status?: string }} [opts]
 */
export function useSubscriberTickets(subscriberId, { status } = {}) {
  return useQuery({
    queryKey: ['tickets', 'subscriber', subscriberId, status || 'all'],
    queryFn: () => tickets.listTicketsForSubscriber(subscriberId, { status }),
    enabled: !!subscriberId,
    refetchInterval: POLL_INBOX,
    refetchIntervalInBackground: false,
  });
}

/**
 * Agent inbox — tickets assigned to one agent, newest-updated first. ALSO powers
 * the nav unread badge: call with no status and the key stays
 * ['tickets','agent',id,'all'], so the inbox view and the badge share one cache
 * entry and dedupe into a single fetch + poll.
 * @param {string|null|undefined} agentId
 * @param {{ status?: string }} [opts]
 */
export function useAgentTickets(agentId, { status } = {}) {
  return useQuery({
    queryKey: ['tickets', 'agent', agentId, status || 'all'],
    queryFn: () => tickets.listTicketsForAgent(agentId, { status }),
    enabled: !!agentId,
    refetchInterval: POLL_INBOX,
    refetchIntervalInBackground: false,
  });
}

/**
 * The agent's actionable unread-message count for the inbox badge — the sum of
 * the agent's `unread.agent` counter over OPEN tickets only (a closed ticket
 * carries no actionable unread). Reuses useAgentTickets with NO status arg so it
 * shares the ['tickets','agent',id,'all'] cache key with the Inbox page, the
 * BottomTabBar, the Home PulseCard, and the mobile header chrome — they all
 * dedupe into a single fetch + poll.
 * @param {string|null|undefined} agentId
 * @returns {number} total unread (0 when no agentId / no data)
 */
export function useAgentUnreadTicketCount(agentId) {
  const { data: agentTickets } = useAgentTickets(agentId);
  return (agentTickets ?? []).reduce(
    (sum, t) => (t.status === TICKET_STATUS.OPEN ? sum + (t.unread?.agent ?? 0) : sum),
    0,
  );
}

/**
 * Branch oversight (view-only) — every ticket in the branch, optionally narrowed
 * by `filters` ({ status?, agentId? }).
 * @param {string|null|undefined} branchId
 * @param {{ status?: string, agentId?: string }} [filters]
 */
export function useBranchTickets(branchId, filters = {}) {
  return useQuery({
    queryKey: ['tickets', 'branch', branchId, filters],
    queryFn: () => tickets.listTicketsForBranch(branchId, filters),
    enabled: !!branchId,
    refetchInterval: POLL_OVERSIGHT,
    refetchIntervalInBackground: false,
  });
}

/**
 * Distributor oversight (view-only) — all tickets, optionally narrowed by
 * `filters` ({ status?, branchId?, agentId? }).
 * @param {string|null|undefined} distributorId
 * @param {{ status?: string, branchId?: string, agentId?: string }} [filters]
 */
export function useDistributorTickets(distributorId, filters = {}) {
  return useQuery({
    queryKey: ['tickets', 'distributor', distributorId, filters],
    queryFn: () => tickets.listTicketsForDistributor(distributorId, filters),
    enabled: !!distributorId,
    refetchInterval: POLL_OVERSIGHT,
    refetchIntervalInBackground: false,
  });
}

/**
 * Employer support inbox (Phase 7) — employer↔platform tickets owned by one
 * employer, newest-updated first. Scoped by the denormalized employerId; the
 * mirror of useSubscriberTickets for the employer role.
 * @param {string|null|undefined} employerId
 * @param {{ status?: string }} [opts]
 */
export function useEmployerTickets(employerId, { status } = {}) {
  return useQuery({
    queryKey: ['tickets', 'employer', employerId, status || 'all'],
    queryFn: () => tickets.listTicketsForEmployer(employerId, { status }),
    enabled: !!employerId,
    refetchInterval: POLL_INBOX,
    refetchIntervalInBackground: false,
  });
}

/**
 * Full thread for one ticket, messages oldest → newest. The most live surface,
 * so it polls fastest; useSendMessage also patches this cache optimistically.
 * @param {string|null|undefined} ticketId
 */
export function useTicketThread(ticketId) {
  return useQuery({
    queryKey: ['ticketThread', ticketId],
    queryFn: () => tickets.getThread(ticketId),
    enabled: !!ticketId,
    refetchInterval: POLL_THREAD,
    refetchIntervalInBackground: false,
  });
}

// ─── Metrics (oversight) ─────────────────────────────────────────────────────

/**
 * Branch ticket metrics — counts + response/resolution averages + per-agent rows.
 * @param {string|null|undefined} branchId
 */
export function useBranchTicketMetrics(branchId) {
  return useQuery({
    queryKey: ['ticketMetrics', 'branch', branchId],
    queryFn: () => tickets.getBranchTicketMetrics(branchId),
    enabled: !!branchId,
    refetchInterval: POLL_METRICS,
    refetchIntervalInBackground: false,
  });
}

/**
 * Distributor ticket metrics — the same TicketMetrics shape across all tickets,
 * optionally narrowed by `filters` ({ branchId? }).
 * @param {string|null|undefined} distributorId
 * @param {{ branchId?: string }} [filters]
 */
export function useDistributorTicketMetrics(distributorId, filters = {}) {
  return useQuery({
    queryKey: ['ticketMetrics', 'distributor', distributorId, filters],
    queryFn: () => tickets.getDistributorTicketMetrics(distributorId, filters),
    enabled: !!distributorId,
    refetchInterval: POLL_METRICS,
    refetchIntervalInBackground: false,
  });
}

/**
 * Platform-wide ticket metrics for the ADMIN — every ticket in the store, in the
 * shared TicketMetrics shape plus `urgentOpenCount`. Feeds both the admin's
 * Support panel and the "Pending complaints" row on the Needs-attention card.
 *
 * Unlike the sibling metric hooks this takes no id — the admin has no scope
 * claim and the platform total is always well-defined. It takes `enabled`
 * instead, because ViewTickets is mounted by both the admin and the distributor
 * and must call this hook unconditionally while only one of the two role
 * variants actually fetches.
 *
 * @param {boolean} [enabled=true]
 */
export function usePlatformTicketMetrics(enabled = true) {
  return useQuery({
    queryKey: ['ticketMetrics', 'platform'],
    queryFn: tickets.getPlatformTicketMetrics,
    enabled,
    refetchInterval: POLL_METRICS,
    refetchIntervalInBackground: false,
  });
}

/**
 * Platform-wide ticket list for the ADMIN, narrowed by `filters`
 * ({ status?, branchId?, agentId? }). Takes `enabled` for the same reason as
 * usePlatformTicketMetrics.
 * @param {{ status?: string, branchId?: string, agentId?: string }} [filters]
 * @param {boolean} [enabled=true]
 */
export function usePlatformTickets(filters = {}, enabled = true) {
  return useQuery({
    queryKey: ['tickets', 'platform', filters],
    queryFn: () => tickets.listTicketsForPlatform(filters),
    enabled,
    refetchInterval: POLL_OVERSIGHT,
    refetchIntervalInBackground: false,
  });
}

/**
 * Employer support metrics (Phase 7) — open/closed/unanswered counts + response
 * averages for one employer's employer↔platform tickets. Same TicketMetrics
 * shape as the oversight reads; the employer UI consumes only the scalar counts.
 * @param {string|null|undefined} employerId
 */
export function useEmployerTicketMetrics(employerId) {
  return useQuery({
    queryKey: ['ticketMetrics', 'employer', employerId],
    queryFn: () => tickets.getEmployerTicketMetrics(employerId),
    enabled: !!employerId,
    refetchInterval: POLL_METRICS,
    refetchIntervalInBackground: false,
  });
}

// ─── Shared invalidation ─────────────────────────────────────────────────────

/**
 * Invalidate every ticket-related cache prefix so a send / close / reopen / read
 * in one role's view propagates to every other open view. TanStack Query's
 * default partial-key match means the two-element prefixes below cover every
 * cached scope/filter/status variant.
 *
 *   ['tickets']        → subscriber + agent inboxes, branch + distributor lists
 *   ['ticketThread']   → every open thread
 *   ['ticketMetrics']  → branch + distributor oversight metrics
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export function invalidateAllTickets(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['tickets'] });
  queryClient.invalidateQueries({ queryKey: ['ticketThread'] });
  queryClient.invalidateQueries({ queryKey: ['ticketMetrics'] });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Open a new ticket on behalf of a subscriber. Not optimistically patched: the
 * service mints the tk-<seq> id and resolves the subscriber's agent/branch, so
 * there is no stable id to splice into the inbox cache ahead of the response —
 * we let the onSettled invalidation pull the real ticket in.
 *
 * Pass `routing` ({ agentId, branchId }) — the subscriber's LIVE agent assignment
 * (e.g. from `useSubscriberAgent` → `getSubscriberAgent`) — so the ticket reaches
 * the real agent's inbox in Supabase mode, where the frozen mockData chain does
 * not mirror the live seed. The created ticket's `agentId` is `null` when neither
 * routing nor the mock chain resolves an agent; the caller should reflect that in
 * its success copy.
 * @param {string} subscriberId
 * @param {{ agentId?: string|null, branchId?: string|null }} [routing]
 */
export function useCreateTicket(subscriberId, routing) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => tickets.createTicket(subscriberId, payload, routing),
    onSettled: () => invalidateAllTickets(queryClient),
  });
}

/**
 * Agent "nudge" — open a new agent→subscriber reminder thread (see
 * tickets.createAgentMessage). Not optimistically patched: the service mints the
 * id + resolves routing, so the onSettled invalidation pulls the thread into the
 * agent inbox. Pass the nudging agent's id so the thread is scoped to them.
 * Mutate with `{ subscriberId, body, subject?, category? }`.
 * @param {string} agentId
 */
export function useSendAgentNudge(agentId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ subscriberId, body, subject, category }) =>
      tickets.createAgentMessage(subscriberId, { body, subject, category }, { agentId }),
    onSettled: () => invalidateAllTickets(queryClient),
  });
}

/**
 * Open a new employer↔platform support ticket (Phase 7). Like useCreateTicket it
 * is not optimistically patched — the service mints the tk-emp-<seq> id, so there
 * is no stable id to splice into the inbox ahead of the response; the onSettled
 * invalidation pulls the real ticket in. No routing arg: employer threads bypass
 * resolveRouting (no servicing agent).
 * @param {string} employerId
 */
export function useCreateEmployerTicket(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => tickets.createEmployerTicket(employerId, payload),
    onSettled: () => invalidateAllTickets(queryClient),
  });
}

/**
 * Append a message to a thread. Optimistically pushes the message onto the
 * ['ticketThread', ticketId] cache (and bumps updatedAt + lastMessagePreview +
 * the recipient's unread counter, mirroring the service) so it appears instantly;
 * rolls back on error. The caller passes { sender, body }.
 * @param {string} ticketId
 */
export function useSendMessage(ticketId) {
  const queryClient = useQueryClient();
  const key = ['ticketThread', ticketId];
  return useMutation({
    mutationFn: (payload) => tickets.sendMessage(ticketId, payload),
    onMutate: async ({ sender, body }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      const at = new Date().toISOString();
      queryClient.setQueryData(key, (old) => {
        if (!old) return old;
        const messages = [
          ...old.messages,
          {
            // Optimistic id — replaced by the service's canonical id on settle.
            id: `msg-${old.id}-${old.messages.length + 1}`,
            ticketId: old.id,
            sender,
            body,
            at,
          },
        ];
        const unread = { ...old.unread };
        // Mirror the service's appendMessage arithmetic so the optimistic patch
        // matches the eventual truth. Employer's own messages bump no counter
        // (no platform inbox); a SYSTEM reply on an employer thread → employer++.
        if (sender === SENDER_ROLE.SUBSCRIBER) unread.agent += 1;
        else if (sender === SENDER_ROLE.AGENT) unread.subscriber += 1;
        else if (sender === SENDER_ROLE.SYSTEM && old.employerId) {
          unread.employer = (unread.employer ?? 0) + 1;
        }
        return {
          ...old,
          messages,
          unread,
          updatedAt: at,
          lastMessagePreview: preview(body),
        };
      });
      return { previous };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => invalidateAllTickets(queryClient),
  });
}

/**
 * Close a ticket. Optimistically flips status → closed (and stamps closedAt /
 * closedBy) on the cached thread; rolls back on error. The caller passes
 * { by } — the SenderRole that closed it.
 * @param {string} ticketId
 */
export function useCloseTicket(ticketId) {
  const queryClient = useQueryClient();
  const key = ['ticketThread', ticketId];
  return useMutation({
    mutationFn: (payload) => tickets.closeTicket(ticketId, payload),
    onMutate: async ({ by }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old) =>
        old && old.status === TICKET_STATUS.OPEN
          ? { ...old, status: TICKET_STATUS.CLOSED, closedAt: new Date().toISOString(), closedBy: by }
          : old,
      );
      return { previous };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => invalidateAllTickets(queryClient),
  });
}

/**
 * Reopen a ticket. Optimistically flips status → open and clears closedAt /
 * closedBy on the cached thread; rolls back on error. The service also appends a
 * SYSTEM "reopened by …" message — that arrives on the onSettled refetch rather
 * than being faked here. The caller passes { by } — the SenderRole that reopened it.
 * @param {string} ticketId
 */
export function useReopenTicket(ticketId) {
  const queryClient = useQueryClient();
  const key = ['ticketThread', ticketId];
  return useMutation({
    mutationFn: (payload) => tickets.reopenTicket(ticketId, payload),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old) =>
        old && old.status === TICKET_STATUS.CLOSED
          ? { ...old, status: TICKET_STATUS.OPEN, closedAt: null, closedBy: null }
          : old,
      );
      return { previous };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => invalidateAllTickets(queryClient),
  });
}

/**
 * Mark a thread read for one viewer — zero that viewer's unread counter.
 * Optimistically patches the cached thread so the badge clears immediately;
 * rolls back on error. The caller passes
 * { viewer: 'subscriber' | 'agent' | 'employer' }.
 * @param {string} ticketId
 */
export function useMarkTicketRead(ticketId) {
  const queryClient = useQueryClient();
  const key = ['ticketThread', ticketId];
  return useMutation({
    mutationFn: (payload) => tickets.markRead(ticketId, payload),
    onMutate: async ({ viewer }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old) => {
        if (!old) return old;
        const unread = { ...old.unread };
        if (viewer === SENDER_ROLE.SUBSCRIBER) unread.subscriber = 0;
        else if (viewer === SENDER_ROLE.AGENT) unread.agent = 0;
        else if (viewer === SENDER_ROLE.EMPLOYER) unread.employer = 0;
        return { ...old, unread };
      });
      return { previous };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => invalidateAllTickets(queryClient),
  });
}
