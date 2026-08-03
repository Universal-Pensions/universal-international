// PendingKycMobile — the phone body of /dashboard/pending-kyc.
//
// Same flow as PendingKycDesktop (both run off `usePendingKycNudge`, so the
// selection / channel / reachability rules can't drift), laid out for one
// thumb: tap a row to tick it, choose channels in a sheet-style block at the
// bottom, then send. The bulk "remind everyone" shortcut is one tap away.

import { useId } from 'react';
import { formatNumber } from '../../utils/currency';
import { formatRelativeTime } from '../../utils/date';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import { usePendingKycNudge, inviteName } from '../kyc/usePendingKycNudge';
import s from './employerMobile.module.css';
import kyc from './PendingKycMobile.module.css';

function initials(name) {
  return (
    (name || '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

const SendIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
);
const CopyIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" />
  </svg>
);

export default function PendingKycMobile() {
  const k = usePendingKycNudge();
  const count = k.selectedRows.length;
  // Explicit label/input association on top of the nesting (see the desktop
  // composer) so each channel checkbox is announced with its own name.
  const uid = useId();

  return (
    <div className={s.page}>
      <p className={s.intro}>
        People you&apos;ve invited who haven&apos;t finished signing up. Tick anyone
        you want to chase and send them a reminder, or copy their link to share again.
      </p>

      {k.isCold ? (
        <SkeletonRow count={4} variant="compact" label="Loading pending KYC" />
      ) : k.isError ? (
        <ErrorCard title="We couldn't load invites" message={k.error} onRetry={k.refetch} />
      ) : k.invites.length === 0 ? (
        <EmptyState
          kind="no-data"
          title="No pending invites"
          body="Everyone you've invited has completed sign-up. Invite staff from the Staff tab."
        />
      ) : (
        <>
          <div className={s.seg} role="tablist" aria-label="Pending invites">
            <button
              type="button"
              role="tab"
              aria-selected={k.tab === 'awaiting'}
              className={s.segBtn}
              data-active={k.tab === 'awaiting' || undefined}
              onClick={() => k.switchTab('awaiting')}
            >
              Awaiting · {formatNumber(k.awaiting.length)}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={k.tab === 'expired'}
              className={s.segBtn}
              data-active={k.tab === 'expired' || undefined}
              onClick={() => k.switchTab('expired')}
            >
              Expired · {formatNumber(k.expired.length)}
            </button>
          </div>

          {k.rows.length === 0 ? (
            <EmptyState
              kind="no-data"
              title={k.tab === 'awaiting' ? 'None awaiting' : 'None expired'}
              body={k.tab === 'awaiting' ? 'No active pending invites right now.' : 'No invites have lapsed.'}
            />
          ) : (
            <>
              <div className={kyc.listHead}>
                <button type="button" className={kyc.selectAll} onClick={k.toggleAll}>
                  {k.allSelected ? 'Clear selection' : 'Select all'}
                </button>
                <span className={kyc.listCount}>
                  {count > 0 ? `${formatNumber(count)} selected` : `${formatNumber(k.rows.length)} ${k.rows.length === 1 ? 'invite' : 'invites'}`}
                </span>
              </div>

              <div className={s.card} style={{ paddingTop: 6, paddingBottom: 6 }}>
                {k.rows.map((inv) => {
                  const checked = k.selected.has(inv.token);
                  const name = inviteName(inv);
                  return (
                    <div key={inv.token}>
                      {/* The whole row is the checkbox target — a 44pt one-thumb
                          hit area rather than a tiny native box. */}
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        className={`${s.lrow} ${kyc.pickRow}`}
                        onClick={() => k.toggleRow(inv.token)}
                      >
                        <span className={s.av}>{initials(name)}</span>
                        <span className={s.lMid}>
                          <b>{name}</b>
                          <small>
                            {inv.prefill?.phone || 'No phone'}
                            {inv.createdAt ? ` · invited ${formatRelativeTime(inv.createdAt)}` : ''}
                          </small>
                          <span className={kyc.reachRow}>
                            {inv.prefill?.email && <span className={kyc.reachTag}>Email</span>}
                            {inv.prefill?.phone && <span className={kyc.reachTag}>SMS</span>}
                            {inv.prefill?.phone && <span className={kyc.reachTag}>WhatsApp</span>}
                            {!inv.prefill?.email && !inv.prefill?.phone && (
                              <span className={kyc.reachNone}>No contact details</span>
                            )}
                            {inv.lastNudge && (
                              <span className={kyc.nudged}>Reminded {formatRelativeTime(inv.lastNudge.at)}</span>
                            )}
                          </span>
                        </span>
                        <span className={kyc.box} data-on={checked || undefined} aria-hidden="true" />
                      </button>
                      <div className={s.btnRow} style={{ padding: '0 0 12px' }}>
                        <button type="button" className={`${s.btn} ${s.btnSec}`} style={{ padding: 9 }} onClick={() => k.copyLink(inv)}>
                          {CopyIcon}Copy link
                        </button>
                        <button
                          type="button"
                          className={s.btn}
                          style={{ padding: 9, color: 'var(--color-status-poor)', background: 'none', border: 'none' }}
                          onClick={() => k.cancel(inv)}
                          disabled={k.cancelling}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Reminder composer — only once someone is ticked, so the page stays
              a plain list until there's something to send. */}
          {count > 0 ? (
            <div className={kyc.composer}>
              <p className={kyc.composerHead}>
                Remind <b>{formatNumber(count)}</b> {count === 1 ? 'person' : 'people'}
              </p>

              <fieldset className={kyc.channels}>
                <legend className={kyc.channelsLegend}>Send via</legend>
                {k.reach.perChannel.map((c) => (
                  <label key={c.id} htmlFor={`${uid}-${c.id}`} className={kyc.channel} data-on={c.selected || undefined}>
                    <input
                      id={`${uid}-${c.id}`}
                      type="checkbox"
                      aria-label={`Send via ${c.label}`}
                      checked={c.selected}
                      onChange={() => k.toggleChannel(c.id)}
                    />
                    <span className={kyc.channelMain}>
                      <b>{c.label}</b>
                      <small>
                        {c.reachable === count
                          ? `All ${formatNumber(count)} reachable`
                          : `${formatNumber(c.reachable)} of ${formatNumber(count)} reachable`}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>

              {k.channelIds.length === 0 ? (
                <p className={kyc.warn} role="status">Choose at least one channel.</p>
              ) : k.reach.unreachable.length > 0 ? (
                <p className={kyc.warn} role="status">
                  {k.reach.unreachable.length === count
                    ? 'Nobody selected can be reached this way — no matching contact details on file. Copy their invite link instead.'
                    : `${formatNumber(k.reach.unreachable.length)} of ${formatNumber(count)} will be skipped — no matching contact details on file.`}
                </p>
              ) : null}

              <button
                type="button"
                className={`${s.btn} ${s.btnPri} ${s.btnBlock}`}
                onClick={k.send}
                disabled={!k.canSend}
              >
                {SendIcon}
                {k.sending
                  ? 'Sending…'
                  : `Send reminder to ${formatNumber(Math.max(k.reach.willReach, 0))}`}
              </button>
              <p className={kyc.demoNote}>Demo — no message is actually delivered.</p>
            </div>
          ) : k.awaiting.length > 0 && (
            <button type="button" className={`${s.btn} ${s.btnSec} ${s.btnBlock}`} onClick={k.selectAllAwaiting}>
              {SendIcon}Remind everyone awaiting ({formatNumber(k.awaiting.length)})
            </button>
          )}
        </>
      )}
    </div>
  );
}
