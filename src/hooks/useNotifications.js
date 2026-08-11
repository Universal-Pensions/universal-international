// React Query hooks for the notifications feed — components import these, never
// the service directly. Mirrors src/hooks/useCommission.js.
//
// Phase 3 of the commission-flow simplification: the bell/feed UI (Phase 6)
// consumes these. `useApplySettlement` (useCommission.js) already invalidates
// the 'notifications' + 'notificationsUnread' keys so freshly-emitted
// notifications appear after a settlement.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as notifications from '../services/notifications';

// Poll the feed + unread badge modestly so they stay current without hammering
// the API. Both surfaces share this cadence so the badge (bell) and the feed
// list (popover + inline card) can never drift apart within a session — cross-
// session delivery beyond polling is intentionally out of scope (realtime off).
const UNREAD_REFETCH_MS = 30_000;

/* ─── Queries ──────────────────────────────────────────────────────────────── */

export function useNotifications({ role, entityId, unreadOnly = false } = {}) {
  return useQuery({
    queryKey: ['notifications', role, entityId, unreadOnly],
    queryFn: () => notifications.listNotifications({ role, entityId, unreadOnly }),
    enabled: !!role && !!entityId,
    // Poll on the same cadence as the unread badge so the rendered feed rows
    // stay in lockstep with the count; force a refetch on mount so opening the
    // bell popover always shows the latest list rather than a stale cached one.
    refetchInterval: UNREAD_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
  });
}

export function useUnreadNotificationCount({ role, entityId } = {}) {
  return useQuery({
    queryKey: ['notificationsUnread', role, entityId],
    queryFn: () => notifications.getUnreadCount({ role, entityId }),
    enabled: !!role && !!entityId,
    refetchInterval: UNREAD_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
}

/* ─── Mutations ──────────────────────────────────────────────────────────────── */

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, entityId, ids }) =>
      notifications.markNotificationsRead({ role, entityId, ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notificationsUnread'] });
    },
  });
}

/**
 * Send an in-app notification from an admin Needs-attention drill-down
 * (migration 0097 `admin_notify`).
 *
 * Invalidates the feed + unread badge so the admin's own bell reflects an
 * ops-queue escalation immediately. Deliberately does NOT invalidate
 * ['adminAttention']: notifying somebody does not change any signal's count, and
 * refetching the ten aggregates on every send would be pure waste.
 */
export function useSendAdminNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => notifications.sendAdminNotification(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notificationsUnread'] });
    },
  });
}
