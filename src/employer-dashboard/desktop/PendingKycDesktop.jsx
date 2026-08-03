// PendingKycDesktop — the desktop body of /dashboard/pending-kyc.
//
// "Pending KYC" means the employer shared a sign-up link but the invitee hasn't
// completed registration yet (members who finish signup are always
// KYC-complete). This is a full ROUTED PAGE on desktop as well as phone — it
// replaced the old kyc/PendingKyc.jsx slide-over, so both form factors run the
// same flow off `usePendingKycNudge`.
//
// Layout: roster table on the left (multi-select + copy-link + cancel), a
// sticky "Send a reminder" composer on the right that owns the channel choice
// and reports exactly who each channel can reach.

import { useId, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '../../utils/currency';
import { formatRelativeTime } from '../../utils/date';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import { usePendingKycNudge, inviteName } from '../kyc/usePendingKycNudge';
import { NUDGE_CHANNEL_BY_ID } from '../../constants/nudge';
import { PageHead, Card, Btn, Avatar, StatusBadge } from './ui';
import { pendingIcon, sendIcon, backIcon } from './icons';
import ui from './ui.module.css';
import s from './PendingKycDesktop.module.css';

const TABS = [
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'expired', label: 'Expired' },
];

export default function PendingKycDesktop() {
  const navigate = useNavigate();
  const k = usePendingKycNudge();

  const subtitle = useMemo(() => {
    if (k.isCold || k.isError) return 'People you’ve invited who haven’t finished signing up.';
    if (k.invites.length === 0) return 'Everyone you’ve invited has completed sign-up.';
    return `${formatNumber(k.awaiting.length)} awaiting sign-up${
      k.expired.length > 0 ? ` · ${formatNumber(k.expired.length)} lapsed` : ''
    }. Pick who to chase and how to reach them.`;
  }, [k.isCold, k.isError, k.invites.length, k.awaiting.length, k.expired.length]);

  return (
    <div className={ui.stack}>
      <PageHead eyebrow="Awaiting sign-up" title="Pending KYC" sub={subtitle} />

      <div className={s.backRow}>
        <button type="button" className={s.backBtn} onClick={() => navigate('/dashboard/employees')}>
          {backIcon(16)} Back to employees
        </button>
      </div>

      {k.isCold ? (
        <SkeletonRow count={5} variant="compact" label="Loading pending KYC" />
      ) : k.isError ? (
        <ErrorCard title="We couldn't load invites" message={k.error} onRetry={k.refetch} />
      ) : k.invites.length === 0 ? (
        <EmptyState
          kind="no-data"
          title="No pending invites"
          body="Everyone you've invited has completed sign-up. Invite staff from Employees → Onboard employee."
        />
      ) : (
        <div className={s.split}>
          {/* LEFT — who's outstanding */}
          <div className={s.listCol}>
            <div className={s.tablist} role="tablist" aria-label="Pending invites">
              {TABS.map((t) => {
                const count = t.key === 'awaiting' ? k.awaiting.length : k.expired.length;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    id={`kyc-tab-${t.key}`}
                    aria-selected={k.tab === t.key}
                    aria-controls="kyc-panel"
                    tabIndex={k.tab === t.key ? 0 : -1}
                    className={s.tab}
                    data-active={k.tab === t.key || undefined}
                    onClick={() => k.switchTab(t.key)}
                  >
                    {t.label}<span className={s.tabCount}>{formatNumber(count)}</span>
                  </button>
                );
              })}
            </div>

            <div role="tabpanel" id="kyc-panel" aria-labelledby={`kyc-tab-${k.tab}`}>
              {k.rows.length === 0 ? (
                <EmptyState
                  kind="no-data"
                  title={k.tab === 'awaiting' ? 'None awaiting' : 'None expired'}
                  body={k.tab === 'awaiting' ? 'No active pending invites right now.' : 'No invites have lapsed.'}
                />
              ) : (
                <div className={ui.tableCard}>
                  <table className={ui.table}>
                    <thead>
                      <tr>
                        <th className={s.checkCell}>
                          <input
                            type="checkbox"
                            checked={k.allSelected}
                            onChange={k.toggleAll}
                            aria-label="Select all"
                          />
                        </th>
                        <th>Member</th>
                        <th>Can be reached on</th>
                        <th>Invited</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {k.rows.map((inv) => {
                        const checked = k.selected.has(inv.token);
                        const name = inviteName(inv);
                        return (
                          <tr key={inv.token} data-selected={checked || undefined}>
                            <td className={s.checkCell}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => k.toggleRow(inv.token)}
                                aria-label={`Select ${name}`}
                              />
                            </td>
                            <td>
                              <div className={ui.member}>
                                <Avatar name={name} />
                                <div>
                                  <div className={ui.tName}>{name}</div>
                                  <div className={s.contact}>
                                    {inv.prefill?.phone || 'No phone'}
                                    {inv.prefill?.email ? ` · ${inv.prefill.email}` : ''}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <ReachTags invite={inv} />
                            </td>
                            <td className={s.muted}>
                              {inv.createdAt ? formatRelativeTime(inv.createdAt) : '—'}
                              {inv.lastNudge && (
                                <div className={s.nudged}>
                                  Reminded {formatRelativeTime(inv.lastNudge.at)}
                                </div>
                              )}
                            </td>
                            <td className={s.rowActions}>
                              <button type="button" className={s.linkBtn} onClick={() => k.copyLink(inv)}>
                                Copy link
                              </button>
                              <button
                                type="button"
                                className={s.cancelBtn}
                                onClick={() => k.cancel(inv)}
                                disabled={k.cancelling}
                              >
                                Cancel
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — the reminder composer */}
          <aside className={s.sendCol}>
            <Card accent="amber" className={s.sendCard}>
              <div className={s.sendHead}>
                <span className={s.sendIc}>{pendingIcon(18)}</span>
                <div>
                  <h2 className={s.sendTitle}>Send a reminder</h2>
                  <p className={s.sendSub}>
                    A nudge with their sign-up link, so they can finish KYC.
                  </p>
                </div>
              </div>

              <NudgeComposer k={k} />
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

/** The channels an invite can actually be reached on, as small tags. */
function ReachTags({ invite }) {
  const hasPhone = Boolean(String(invite?.prefill?.phone ?? '').trim());
  const hasEmail = Boolean(String(invite?.prefill?.email ?? '').trim());
  if (!hasPhone && !hasEmail) {
    return <StatusBadge tone="poor">No contact details</StatusBadge>;
  }
  return (
    <span className={s.reachTags}>
      {hasEmail && <span className={s.reachTag}>Email</span>}
      {hasPhone && <span className={s.reachTag}>SMS</span>}
      {hasPhone && <span className={s.reachTag}>WhatsApp</span>}
    </span>
  );
}

/**
 * Channel picker + reach summary + send button. Shared by the desktop page's
 * right column; the phone body renders its own layout over the same state.
 */
function NudgeComposer({ k }) {
  const count = k.selectedRows.length;
  // Explicit label/input association on top of the nesting, so each channel
  // checkbox is announced with its own name.
  const uid = useId();

  if (count === 0) {
    return (
      <div className={s.composerEmpty}>
        <p>Tick the people you want to chase, then choose how to reach them.</p>
        {k.awaiting.length > 0 && (
          <Btn variant="secondary" onClick={k.selectAllAwaiting}>
            Select all {formatNumber(k.awaiting.length)} awaiting
          </Btn>
        )}
      </div>
    );
  }

  return (
    <>
      <p className={s.selectedLine}>
        <b>{formatNumber(count)}</b> {count === 1 ? 'person' : 'people'} selected
      </p>

      <fieldset className={s.channels}>
        <legend className={s.channelsLegend}>Send via</legend>
        {k.reach.perChannel.map((c) => (
          <label key={c.id} htmlFor={`${uid}-${c.id}`} className={s.channel} data-on={c.selected || undefined}>
            <input
              id={`${uid}-${c.id}`}
              type="checkbox"
              aria-label={`Send via ${c.label}`}
              checked={c.selected}
              onChange={() => k.toggleChannel(c.id)}
            />
            <span className={s.channelMain}>
              <b>{c.label}</b>
              <small>
                {c.reachable === count
                  ? `All ${formatNumber(count)} reachable`
                  : `${formatNumber(c.reachable)} of ${formatNumber(count)} reachable · ${c.reachable === 0 ? 'nobody has' : 'some are missing'} ${c.field === 'email' ? 'an email' : 'a phone'}`}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      {k.channelIds.length === 0 ? (
        <p className={s.warn} role="status">Choose at least one channel.</p>
      ) : k.reach.unreachable.length > 0 ? (
        <p className={s.warn} role="status">
          {k.reach.unreachable.length === count ? (
            <>None of the people selected can be reached this way — they have no matching contact details on file.</>
          ) : (
            <>
              {formatNumber(k.reach.unreachable.length)} of {formatNumber(count)} will be skipped
              ({k.reach.unreachable.map(inviteName).slice(0, 2).join(', ')}
              {k.reach.unreachable.length > 2 ? ` +${formatNumber(k.reach.unreachable.length - 2)} more` : ''})
              — no {k.channelIds.map((id) => NUDGE_CHANNEL_BY_ID[id]?.label).join(' / ')} details on file.
              Copy their invite link instead.
            </>
          )}
        </p>
      ) : null}

      <Btn variant="primary" onClick={k.send} disabled={!k.canSend}>
        {sendIcon(14)}
        {k.sending
          ? 'Sending…'
          : `Send reminder to ${formatNumber(Math.max(k.reach.willReach, 0))} ${k.reach.willReach === 1 ? 'person' : 'people'}`}
      </Btn>
      <p className={s.demoNote}>Demo — no message is actually delivered.</p>
    </>
  );
}
