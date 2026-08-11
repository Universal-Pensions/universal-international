import { useCallback, useMemo, useState } from 'react';
import { useAdminAttentionRows } from '../../hooks/useAdminAttention';
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

  // `count` is only populated for the agent-grouped dormancy list; every other
  // signal is one row per problem.
  const total = useMemo(
    () => (rows.some((r) => r?.count != null)
      ? rows.reduce((sum, r) => sum + (Number(r.count) || 0), 0)
      : rows.length),
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
  };
}
