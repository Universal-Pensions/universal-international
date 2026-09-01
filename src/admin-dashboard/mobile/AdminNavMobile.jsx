import { useState } from 'react';
import {
  useNavOverview,
  useNavSnapshots,
  usePublishNav,
  usePendingPricingSummary,
} from '../../hooks/useNav';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber, formatUGX } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import BottomSheet from '../../branch-dashboard/shell/BottomSheet';
import PendingPricingNote from '../../components/nav/PendingPricingNote';
import styles from '../../dashboard/mobile/distributorMobile.module.css';
import { kampalaToday } from '../../utils/date';

// Matches the clock the desktop page uses on its own queue copy.
const clockIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * AdminNavMobile — the phone view of the fund's unit price (route /dashboard/nav).
 *
 * Same hooks and the same server guard-rails as the desktop AdminNavDesktop
 * panel: publishing revalues every member's savings, and a move over ±10% needs
 * an explicit confirmation the RPC enforces independently.
 *
 * No recharts here — every other admin mobile page draws its trend with the
 * shared CSS sparkline (.spark / .sparkCol), and a phone does not have room for
 * an axis-bearing chart.
 */
function price(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `UGX ${Number(n).toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}%`;
}
function longDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminNavMobile() {
  const overview = useNavOverview();
  const history = useNavSnapshots({ limit: 30 });
  const publish = usePublishNav();
  const pending = usePendingPricingSummary();
  const { addToast } = useToast();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const d = overview.data;
  // A04-015 (client half): the fund's calendar is Kampala, not the browser's
  // UTC. Between 00:00 and 03:00 local, toISOString() still reads yesterday,
  // so this offered the admin the wrong day and the server's future-date
  // guard then rejected a legitimate same-day publish. Mirrors kampala_today().
  const todayIso = kampalaToday();
  const formState = form ?? {
    navDate: todayIso,
    unitPrice: d?.currentNav != null ? String(d.currentNav) : '',
  };
  const typedPrice = Number(formState.unitPrice);
  const priceIsUsable = Number.isFinite(typedPrice) && typedPrice > 0;
  const movePct = priceIsUsable && d?.currentNav
    ? ((typedPrice - d.currentNav) / d.currentNav) * 100
    : null;
  const busy = publish.isPending;

  // Last 30 published points, normalised to 0..1 for the CSS sparkline.
  const spark = (d?.series ?? []).slice(-30).map((p) => Number(p.unitPrice));
  const sparkMin = spark.length ? Math.min(...spark) : 0;
  const sparkMax = spark.length ? Math.max(...spark) : 1;
  const sparkRange = sparkMax - sparkMin || 1;

  function closeSheet() {
    setSheetOpen(false); setConfirming(false); setFormError(null);
  }

  async function doPublish(confirmMove) {
    setFormError(null);
    try {
      const res = await publish.mutateAsync({
        navDate: formState.navDate, unitPrice: typedPrice, confirmMove,
      });
      closeSheet();
      setForm(null);
      addToast('success', res?.revalued
        ? `Price saved. Members' savings now show at ${price(res.unitPrice)} per unit.`
        : `Price saved for ${longDate(res?.navDate)}.`);
    } catch (err) {
      setConfirming(false);
      setFormError(err?.code === 'P0001'
        ? (err?.message || 'Could not save that price.')
        : 'We could not save that price. Please try again.');
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!priceIsUsable) { setFormError('Enter a price greater than zero.'); return; }
    if (formState.navDate > todayIso) {
      setFormError('You cannot set a price for a day that has not happened yet.'); return;
    }
    if (movePct != null && Math.abs(movePct) > 10) { setConfirming(true); return; }
    doPublish(false);
  }

  if (overview.isError) {
    return (
      <div className={styles.page}>
        <ErrorCard
          title="Could not load the unit price"
          message={overview.error?.message}
          onRetry={overview.refetch}
        />
      </div>
    );
  }

  const up = (d?.changePct ?? 0) >= 0;

  return (
    <div className={styles.page}>
      <section className={`${styles.card} ${styles.cardGrad}`}>
        <p className={styles.eyebrow}>Price of one unit today</p>
        <p className={styles.heroVal}>{overview.isLoading ? '—' : price(d?.currentNav)}</p>
        {d?.currentNavDate && (
          <p className={styles.frameSub}>
            As at {longDate(d.currentNavDate)}
            {d.previousNav != null && (
              <> · <span className={up ? styles.up : styles.down}>
                {up ? '↑' : '↓'} {pct(d.changePct)}
              </span></>
            )}
          </p>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.statStrip}>
          <div>
            <b>{formatUGX(d?.aum ?? 0)}</b>
            <small>In the fund</small>
          </div>
          <div>
            <b>{formatNumber(Math.round(d?.unitsInIssue ?? 0))}</b>
            <small>Units</small>
          </div>
          <div>
            <b className={(d?.totalGrowth ?? 0) < 0 ? styles.down : styles.up}>
              {pct(d?.growthPct)}
            </b>
            <small>Growth</small>
          </div>
        </div>
      </section>

      {spark.length > 1 && (
        <section className={styles.card}>
          <p className={styles.eyebrow}>How the price has moved</p>
          <div className={styles.spark} aria-hidden="true">
            {/* The BAR is the inner <i> — `.sparkCol` is only the full-height
                column it sits at the bottom of, and carries no paint of its own.
                Height therefore belongs on the <i>: put it on the column and the
                whole chart renders invisible. */}
            {spark.map((v, i) => (
              <span key={`${v}-${i}`} className={styles.sparkCol}>
                <i style={{ height: `${8 + ((v - sparkMin) / sparkRange) * 92}%` }} />
              </span>
            ))}
          </div>
        </section>
      )}

      {/* How much MEMBER money this button is holding up. Deliberately on the
          page rather than inside the sheet: it is the fact that tells an admin
          whether they need to publish at all, and a fact you only see after
          tapping is one you act without. Desktop shows the same sentence at its
          own moment of decision, immediately above Publish. */}
      {(pending.data?.pendingContributions > 0 || pending.data?.pendingRedemptions > 0) && (
        <div className={styles.callout} style={{ marginBottom: 12 }}>
          <span className={styles.calloutIc} aria-hidden="true">{clockIcon}</span>
          <div>
            <b>Money waiting on a price</b>
            <PendingPricingNote summary={pending.data} />
          </div>
        </div>
      )}

      {/* The page's primary action, so it takes the primary button — NOT
          `.signout`, whose red is reserved for destructive actions (CLAUDE.md
          §6). Publishing the day's price is routine work, not a warning. */}
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPri}`}
        style={{ width: '100%' }}
        onClick={() => setSheetOpen(true)}
      >
        Set today&apos;s price
      </button>

      <section className={styles.card}>
        <p className={styles.eyebrow}>
          Price history
          {(d?.pendingDays ?? 0) > 0 && (
            <span className={`${styles.pill} ${styles.warn}`}>
              {d.pendingDays} not priced
            </span>
          )}
        </p>
        {(history.data?.rows ?? []).map((r) => (
          <div key={r.id} className={styles.lrow}>
            <div className={styles.lMid}>
              <b>{longDate(r.navDate)}</b>
              <small>{r.status === 'published' ? (r.publishedBy || r.source || 'Priced') : 'Not priced yet'}</small>
            </div>
            <div className={styles.lAmt}>
              <b>{r.status === 'pending' ? '—' : price(r.unitPrice)}</b>
              {r.status !== 'pending' && r.changePct != null && (
                <small className={r.changePct < 0 ? styles.down : styles.up}>{pct(r.changePct)}</small>
              )}
            </div>
          </div>
        ))}
        {!history.isLoading && (history.data?.rows ?? []).length === 0 && (
          <p className={styles.frameSub}>No prices yet. Set the first one above.</p>
        )}
      </section>

      <BottomSheet
        open={sheetOpen}
        onClose={busy ? () => {} : closeSheet}
        title={confirming ? 'This is a big change' : "Set today's price"}
        height="62%"
      >
        {confirming ? (
          <div className={styles.card}>
            <p>
              You are changing the price of one unit from <b>{price(d?.currentNav)}</b> to{' '}
              <b>{price(typedPrice)}</b> — <b className={movePct >= 0 ? styles.up : styles.down}>
                {movePct >= 0 ? 'up' : 'down'} {Math.abs(movePct ?? 0).toFixed(1)}%
              </b>. Every member&apos;s savings change with it.
            </p>
            <button type="button" className={styles.signout} disabled={busy}
              onClick={() => doPublish(true)}>
              {busy ? 'Saving…' : 'Yes, publish it'}
            </button>
            <button type="button" className={styles.setRow} disabled={busy}
              onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <label className={styles.setRow} htmlFor="nav-m-date">
              Day
              <input
                id="nav-m-date" type="date" max={todayIso} value={formState.navDate}
                disabled={busy} aria-label="Valuation day"
                onChange={(e) => { setFormError(null); setForm({ ...formState, navDate: e.target.value }); }}
              />
            </label>
            <label className={styles.setRow} htmlFor="nav-m-price">
              Price of one unit (UGX)
              <input
                id="nav-m-price" type="number" step="0.01" min="0.01" inputMode="decimal"
                value={formState.unitPrice} disabled={busy}
                aria-label="Price of one unit in shillings"
                onChange={(e) => { setFormError(null); setForm({ ...formState, unitPrice: e.target.value }); }}
              />
            </label>
            {movePct != null && priceIsUsable && (
              <p className={styles.frameSub}>
                {Math.abs(movePct) < 0.005
                  ? 'Same as the price now.'
                  : `That's ${movePct >= 0 ? 'up' : 'down'} ${Math.abs(movePct).toFixed(2)}% from ${price(d?.currentNav)}.`}
              </p>
            )}
            {formError && <p className={styles.frameSub} role="alert">{formError}</p>}
            <button type="submit" className={styles.signout} disabled={busy}>
              {busy ? 'Saving…' : 'Publish price'}
            </button>
          </form>
        )}
      </BottomSheet>
    </div>
  );
}
