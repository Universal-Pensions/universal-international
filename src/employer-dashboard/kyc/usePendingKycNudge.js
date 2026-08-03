import { useCallback, useMemo, useState } from 'react';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useToast } from '../../contexts/ToastContext';
import {
  usePendingInvites,
  useCancelInvite,
  useSendInviteNudges,
} from '../../hooks/useEmployer';
import { formatNumber } from '../../utils/currency';
import {
  NUDGE_CHANNELS,
  NUDGE_CHANNEL_BY_ID,
  DEFAULT_NUDGE_CHANNELS,
  isReachableBy,
  reachableChannels,
} from '../../constants/nudge';

// Every bit of pending-KYC logic — the invite split, row selection, channel
// selection, reachability and the send itself — lives here so the desktop and
// phone bodies render the SAME behaviour and can't drift. The bodies own layout
// only. (This replaced the old kyc/PendingKyc.jsx slide-over, which duplicated
// all of it against a third copy in mobile/PendingKycMobile.jsx.)

export const inviteName = (inv) => inv?.prefill?.fullName || 'Invited member';
export const firstNameOf = (name) => String(name || '').trim().split(/\s+/)[0] || 'this person';
export const inviteLink = (token) => `${window.location.origin}/invite/${token}`;

/** Split pending invites into still-active vs lapsed (past `expiresAt`). Kept a
 *  module function so the clock read isn't an impure call inside a memo. */
function splitInvitesByExpiry(invites) {
  const now = Date.now();
  const awaiting = [];
  const expired = [];
  for (const inv of invites) {
    const exp = inv.expiresAt ? new Date(inv.expiresAt).getTime() : Infinity;
    (Number.isFinite(exp) && exp <= now ? expired : awaiting).push(inv);
  }
  return { awaiting, expired };
}

function peopleLabel(n) {
  return `${formatNumber(n)} ${n === 1 ? 'person' : 'people'}`;
}

/** Human list: "Email and WhatsApp", "Email, SMS and WhatsApp". */
function channelSentence(ids) {
  const labels = ids.map((id) => NUDGE_CHANNEL_BY_ID[id]?.label ?? id);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function usePendingKycNudge() {
  const { employerId } = useEmployerScope();
  const { addToast } = useToast();

  const { data: invites = [], isLoading, isError, error, refetch } = usePendingInvites(employerId);
  const cancelInvite = useCancelInvite(employerId);
  const sendNudges = useSendInviteNudges(employerId);

  const [tab, setTab] = useState('awaiting');
  const [selected, setSelected] = useState(() => new Set());
  const [channels, setChannels] = useState(() => new Set(DEFAULT_NUDGE_CHANNELS));

  const { awaiting, expired } = useMemo(() => splitInvitesByExpiry(invites), [invites]);
  const rows = tab === 'awaiting' ? awaiting : expired;

  const selectedRows = useMemo(() => rows.filter((i) => selected.has(i.token)), [rows, selected]);
  const allSelected = rows.length > 0 && rows.every((i) => selected.has(i.token));
  const channelIds = useMemo(
    // Keep the canonical NUDGE_CHANNELS order regardless of click order, so the
    // summary copy reads the same every time.
    () => NUDGE_CHANNELS.filter((c) => channels.has(c.id)).map((c) => c.id),
    [channels],
  );

  /**
   * Per-channel reach across the current selection, plus the people no chosen
   * channel can reach. Drives the "3 of 4 reachable" counts and the warning.
   */
  const reach = useMemo(() => {
    const perChannel = NUDGE_CHANNELS.map((c) => ({
      ...c,
      selected: channels.has(c.id),
      reachable: selectedRows.filter((inv) => isReachableBy(inv, c.id)).length,
    }));
    const unreachable = channelIds.length === 0
      ? []
      : selectedRows.filter((inv) => reachableChannels(inv, channelIds).length === 0);
    return { perChannel, unreachable, willReach: selectedRows.length - unreachable.length };
  }, [selectedRows, channels, channelIds]);

  const canSend = selectedRows.length > 0 && channelIds.length > 0
    && reach.willReach > 0 && !sendNudges.isPending;

  const toggleRow = useCallback((token) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token); else next.add(token);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(rows.map((i) => i.token)));
  }, [allSelected, rows]);

  const toggleChannel = useCallback((id) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const switchTab = useCallback((next) => {
    setTab(next);
    setSelected(new Set());
  }, []);

  const selectAllAwaiting = useCallback(() => {
    setTab('awaiting');
    setSelected(new Set(awaiting.map((i) => i.token)));
  }, [awaiting]);

  const copyLink = useCallback(async (inv) => {
    try {
      await navigator.clipboard.writeText(inviteLink(inv.token));
      addToast('success', `Invite link for ${firstNameOf(inviteName(inv))} copied — share it to remind them.`);
    } catch {
      addToast('error', 'Could not copy the link.');
    }
  }, [addToast]);

  const cancel = useCallback((inv) => {
    if (cancelInvite.isPending) return;
    cancelInvite.mutate(inv.token, {
      onSuccess: () => addToast('success', `Invite for ${firstNameOf(inviteName(inv))} cancelled.`),
      onError: (e) => addToast('error', e?.message || 'Could not cancel the invite.'),
    });
  }, [cancelInvite, addToast]);

  /** Send the reminder to everyone ticked, over every channel ticked. */
  const send = useCallback(async () => {
    if (!canSend) return;
    try {
      const result = await sendNudges.mutateAsync({ invites: selectedRows, channels: channelIds });
      const via = channelSentence(channelIds);
      addToast('success', `Reminder sent to ${peopleLabel(result.sent)} via ${via}.`);
      if (result.unreachable.length > 0) {
        // Never silent: say who got nothing and why, so the employer can fix
        // the missing contact detail or copy their link instead.
        addToast(
          'error',
          `${peopleLabel(result.unreachable.length)} couldn't be reached on ${via} — no contact details on file.`,
        );
      }
      setSelected(new Set());
    } catch (e) {
      addToast('error', e?.message || 'Could not send the reminder.');
    }
  }, [canSend, sendNudges, selectedRows, channelIds, addToast]);

  return {
    // data
    invites, awaiting, expired, rows,
    isLoading, isCold: isLoading && invites.length === 0, isError, error, refetch,
    // tabs + selection
    tab, switchTab, selected, selectedRows, allSelected, toggleRow, toggleAll, selectAllAwaiting,
    // channels + reach
    channels, channelIds, toggleChannel, reach,
    // actions
    canSend, send, sending: sendNudges.isPending, copyLink, cancel,
    cancelling: cancelInvite.isPending,
  };
}
