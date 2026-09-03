import { useCallback, useMemo, useState } from 'react';
import { useAdminAttentionRows, useResolveAttentionRow } from '../../hooks/useAdminAttention';
import { useSendAdminNotification } from '../../hooks/useNotifications';
import { useToast } from '../../contexts/ToastContext';
import { metaFor } from './attentionMeta';

/**
 * Everything the two attention drill-down surfaces do that is not layout:
 * resolve the meta, fetch the rows, and run the notify flow.
 *
 * Extracted so AdminAttentionDesktop and AdminAttentionMobile share one
 * implementation — the same reason branchOverviewDerive exists for the branch
 * card. The surfaces differ only in chrome (Modal vs BottomSheet, table vs list).
 *
 * @param {string|null|undefined} type Attention signal id.
 * @returns {{
 *   meta: Object|undefined, rows: Array<Object>, total: number,
 *   isLoading: boolean, isError: boolean, refetch: Function,
 *   target: Object|null, openNotify: (row: Object) => void, closeNotify: () => void,
 *   send: (body: string) => void, sending: boolean,
 *   resolvable: boolean, resolveTarget: Object|null,
 *   openResolve: (row: Object) => void, closeResolve: () => void,
 *   confirmResolve: (note: string) => void, resolving: boolean,
 * }}
 */
export function useAttentionDrill(type) {
  const meta = metaFor(type);
  const { addToast } = useToast();

  // Query stays disabled for an unknown type, so a bad route param costs nothing.
  const {
    data: rows = [], isLoading, isError, refetch,
  } = useAdminAttentionRows(meta ? type : null);

  const [target, setTarget] = useState(null);
  const notify = useSendAdminNotification();

  const openNotify = useCallback((row) => setTarget(row), []);
  const closeNotify = useCallback(() => setTarget(null), []);

  const send = useCallback((body) => {
    if (!target || !meta) return;
    notify.mutate(
      {
        recipientRole: target.recipientRole,
        recipientId: target.recipientId,
        type,
        title: meta.subject(target),
        body,
        refId: target.id,
        amount: target.amount ?? null,
      },
      {
        onSuccess: () => {
          addToast('success', `Notification sent to ${target.recipientName || target.recipientId}`);
          setTarget(null);
        },
        // Keep the composer open on failure so the typed message is not lost.
        onError: (err) => addToast('error', err?.message || 'Could not send the notification'),
      },
    );
  }, [target, meta, type, notify, addToast]);

  // Resolve — close a row out without fixing the underlying data (0162).
  // Only signals whose meta sets `resolvable` offer this; see the RESOLVERS
  // registry in hooks/useAdminAttention.js.
  const [resolveTarget, setResolveTarget] = useState(null);
  const resolveRow = useResolveAttentionRow(type);

  const openResolve = useCallback((row) => setResolveTarget(row), []);
  const closeResolve = useCallback(() => setResolveTarget(null), []);

  const confirmResolve = useCallback((note) => {
    if (!resolveTarget) return;
    resolveRow.mutate(
      { row: resolveTarget, note: note?.trim() ? note.trim() : null },
      {
        onSuccess: () => {
          addToast('success', `${resolveTarget.primary} marked as resolved`);
          setResolveTarget(null);
        },
        // Keep the dialog open on failure — the RPC refuses a day that already
        // has a price waiting for sign-off, and that message is the whole point.
        onError: (err) => addToast('error', err?.message || 'Could not resolve this day'),
      },
    );
  }, [resolveTarget, resolveRow, addToast]);

  // `count` is only populated for the agent-grouped dormancy list; every other
  // signal is one row per problem.
  //
  // Resolved rows stay in `rows` on purpose (0162) — the record of which day was
  // missed is the point — but they must NOT reach this tile. get_admin_attention
  // already skips them in the badge, so counting them here would put a different
  // number on the tile than on the card that opened it: exactly the badge-vs-list
  // drift finding A04-007 raised and 0116 was written to end. A no-op for every
  // signal that cannot be resolved, where `resolved` is always undefined.
  const total = useMemo(
    () => (rows.some((r) => r?.count != null)
      ? rows.reduce((sum, r) => sum + (Number(r.count) || 0), 0)
      : rows.filter((r) => !r?.resolved).length),
    [rows],
  );

  return {
    meta,
    rows,
    total,
    isLoading,
    isError,
    refetch,
    target,
    openNotify,
    closeNotify,
    send,
    sending: notify.isPending,
    resolvable: Boolean(meta?.resolvable),
    resolveTarget,
    openResolve,
    closeResolve,
    confirmResolve,
    resolving: resolveRow.isPending,
  };
}
