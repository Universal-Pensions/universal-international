// Admin "Unit price" page (desktop).
//
// The fund's unit price is the platform's pricing authority: contributions buy
// units at it, withdrawals redeem at it, and publishing a new price revalues
// every member in one server transaction. So this page is a money surface, not a
// settings screen — hence the explicit before/after confirmation, the plain
// language, and the deliberate absence of any optimistic update.
//
// Copy rule (CLAUDE.md / plain-language): "NAV" appears once, parenthesised, in
// the history card. Everywhere else it is "unit price" / "price of one unit".

import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useNavOverview, useNavSnapshots, usePublishNav } from '../../hooks/useNav';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber, formatUGX } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import Modal from '../../components/Modal';
import {
  PageHead, Hero, MetricRow, Tile, Card, SectionHead, Btn, StatusBadge,
} from '../../employer-dashboard/desktop/ui';
import ui from '../../employer-dashboard/desktop/ui.module.css';
import { PALETTE, axisTick, chartTooltip } from '../../employer-dashboard/reports/chartConfig';
import styles from './AdminNavDesktop.module.css';
import { kampalaToday } from '../../utils/date';

const priceIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 17l6-6 4 4 7-7" /><path d="M14 8h6v6" />
  </svg>
);
const fundIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);
const unitsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" />
  </svg>
);
const clockIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

const RANGES = [
  { id: '1M', label: '1 month', days: 31 },
  { id: '6M', label: '6 months', days: 186 },
  { id: '1Y', label: '1 year', days: 372 },
  { id: 'ALL', label: 'All', days: Infinity },
];

/** ISO `YYYY-MM-DD` → "7 August 2026". Dates arrive as ISO from the RPC. */
function longDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
/** Prices carry 2dp and are read alongside each other — never abbreviate them. */
function price(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `UGX ${Number(n).toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}%`;
}

/**
 * Map an RPC failure to something an administrator can act on.
 * Mirrors friendlyCreateError in ../distributors/CreateDistributor.jsx.
 */
function friendlyNavError(err) {
  const code = err?.code;
  // P0001 = the RPC's own RAISEs (role gate, future date, non-positive price,
  // unconfirmed large move). Those messages are already written for a human.
  if (code === 'P0001') return err?.message || 'Could not save that price.';
  if (code === '23505') return 'A price is already recorded for that day.';
  if (code === '23514') return 'That price is not valid. It must be more than zero.';
  return err?.message || 'We could not save that price. Please try again.';
}

export default function AdminNavDesktop({ fullPage = false }) {
  const { addToast } = useToast();
  const [rangeId, setRangeId] = useState('1Y');
  const [statusFilter, setStatusFilter] = useState(null);
  const [form, setForm] = useState(null);          // { navDate, unitPrice } once seeded
  const [confirm, setConfirm] = useState(null);    // pending publish awaiting confirmation
  const [formError, setFormError] = useState(null);

  const overview = useNavOverview();
  const history = useNavSnapshots({ limit: 60, status: statusFilter });
  const publish = usePublishNav();

  const d = overview.data;
  // A04-015 (client half): the fund's calendar is Kampala, not the browser's
  // UTC. Between 00:00 and 03:00 local, toISOString() still reads yesterday,
  // so this offered the admin the wrong day and the server's future-date
  // guard then rejected a legitimate same-day publish. Mirrors kampala_today().
  const todayIso = kampalaToday();

  // Seed the form from the current price so the admin edits from the last value
  // rather than an empty box — the single most common cause of a fat-finger move.
  const formState = form ?? {
    navDate: todayIso,
    // Seeded to 2dp: this is a price, and `1571.4` next to a register that reads
    // "UGX 1,571.40" looks like a different number.
    unitPrice: d?.currentNav != null ? Number(d.currentNav).toFixed(2) : '',
  };
  const setField = (k, v) => { setFormError(null); setForm({ ...formState, [k]: v }); };

  const typedPrice = Number(formState.unitPrice);
  const priceIsUsable = Number.isFinite(typedPrice) && typedPrice > 0;
  // Two multiplications on every keystroke. Deliberately not memoised: the
  // inputs derive from `formState`, which is rebuilt each render, so a useMemo
  // could not be preserved anyway and would only obscure the arithmetic.
  const movePct = priceIsUsable && d?.currentNav
    ? ((typedPrice - d.currentNav) / d.currentNav) * 100
    : null;
  const projectedAum = priceIsUsable && d?.unitsInIssue
    ? Math.round(d.unitsInIssue * typedPrice)
    : null;

  // A date already in the register means publishing REPLACES it. Detected against
  // the rows already loaded — no extra round-trip just to warn about it.
  const duplicateRow = useMemo(
    () => (history.data?.rows ?? []).find((r) => r.navDate === formState.navDate) ?? null,
    [history.data, formState.navDate],
  );

  // Anchored on the series' OWN last valuation day, not the wall clock: the
  // range then means "the last N days of pricing", which is what the register
  // actually shows, and the memo stays pure (Date.now() here would make the
  // chart re-slice unpredictably on any incidental re-render).
  const series = useMemo(() => {
    const all = d?.series ?? [];
    const days = RANGES.find((r) => r.id === rangeId)?.days ?? Infinity;
    if (!Number.isFinite(days) || all.length === 0) return all;
    const last = new Date(`${all[all.length - 1].date}T00:00:00`).getTime();
    const cutoff = last - days * 86400000;
    return all.filter((p) => new Date(`${p.date}T00:00:00`).getTime() >= cutoff);
  }, [d?.series, rangeId]);

  async function doPublish(confirmMove) {
    setFormError(null);
    try {
      const res = await publish.mutateAsync({
        navDate: formState.navDate,
        unitPrice: typedPrice,
        confirmMove,
      });
      setConfirm(null);
      setForm(null);   // re-seed from the new current price
      addToast(
        'success',
        res?.revalued
          ? `Price saved. Every member's savings now show at ${price(res.unitPrice)} per unit.`
          : `Price saved for ${longDate(res?.navDate)}. Today's prices are unchanged because a newer price is already published.`,
      );
    } catch (err) {
      setConfirm(null);
      setFormError(friendlyNavError(err));
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!priceIsUsable) {
      setFormError('Enter a price greater than zero.'); return;
    }
    if (formState.navDate > todayIso) {
      setFormError('You cannot set a price for a day that has not happened yet.'); return;
    }
    // Large moves require an explicit look at the before/after. The server
    // enforces the same rule independently — this dialog is a courtesy.
    if (movePct != null && Math.abs(movePct) > 10) { setConfirm({ movePct }); return; }
    doPublish(false);
  }

  if (overview.isError) {
    return (
      <div className={ui.stack}>
        <ErrorCard
          title="Could not load the unit price"
          message={overview.error?.message}
          onRetry={overview.refetch}
        />
      </div>
    );
  }

  const busy = publish.isPending;
  const changeUp = (d?.changePct ?? 0) >= 0;

  return (
    <div className={`${ui.stack} ${fullPage ? '' : styles.drawer}`}>
      <PageHead
        eyebrow="Fund"
        title="Unit price"
        sub="Set the price of one unit. Every member's savings are worth their units × this price."
      />

      <Hero
        icon={priceIcon}
        eyebrow="Price of one unit today"
        value={overview.isLoading ? '—' : price(d?.currentNav)}
      >
        {d?.currentNavDate && (
          <span className={styles.heroSub}>
            As at {longDate(d.currentNavDate)}
            {d.previousNav != null && (
              <>
                {' · '}
                <b className={changeUp ? styles.up : styles.down}>
                  {changeUp ? 'Up' : 'Down'} {price(Math.abs(d.changeAbs ?? 0))} ({pct(d.changePct)})
                </b>
                {' from '}{longDate(d.previousNavDate)}
              </>
            )}
          </span>
        )}
      </Hero>

      <MetricRow cols={4}>
        <Tile
          accent="indigo" icon={fundIcon} label="Money in the fund"
          value={overview.isLoading ? '—' : formatUGX(d?.aum ?? 0)}
          sub="All members' savings at today's price"
        />
        <Tile
          accent="indigoSoft" icon={unitsIcon} label="Units in issue"
          value={overview.isLoading ? '—' : formatNumber(Math.round(d?.unitsInIssue ?? 0))}
          sub={`Held by ${formatNumber(d?.membersPriced ?? 0)} members`}
        />
        {/* The AVERAGE of each member's own growth, not the pooled
            total-growth-over-total-basis figure. Pooled is money-weighted, so a
            few large long-tenured balances pull it away from what a typical
            member sees on their own dashboard. Both are shown — the tile answers
            "how are members doing", the sub answers "how is the fund doing". */}
        <Tile
          accent="green" icon={priceIcon} label="Average growth per member"
          value={overview.isLoading ? '—' : pct(d?.avgGrowthPct)}
          sub={overview.isLoading
            ? 'Across all members'
            : `Across ${formatNumber(d?.membersWithBasis ?? 0)} members · whole fund ${pct(d?.growthPct)}`}
        />
        <Tile
          accent="amber" icon={clockIcon} label="Days not priced"
          value={overview.isLoading ? '—' : formatNumber(d?.pendingDays ?? 0)}
          sub={(d?.pendingDays ?? 0) > 0 ? 'Tap to see which days' : 'Everything is up to date'}
          onClick={(d?.pendingDays ?? 0) > 0 ? () => setStatusFilter('pending') : undefined}
        />
      </MetricRow>

      <Card>
        <SectionHead icon={priceIcon} title="Set today's price" />
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={ui.fieldGrid}>
            <div className={ui.field}>
              {/* Input nested inside its label AND wired by id — the repo's a11y
                  lint wants both. .fLabel stacks them, which a bare label won't. */}
              <label className={styles.fLabel} htmlFor="nav-date">
                Day
                <input
                  id="nav-date" aria-label="Valuation day"
                  className={ui.fieldInput} type="date" max={todayIso}
                  value={formState.navDate} disabled={busy}
                  onChange={(e) => setField('navDate', e.target.value)}
                />
              </label>
            </div>
            <div className={ui.field}>
              <label className={styles.fLabel} htmlFor="nav-price">
                Price of one unit
                <span className={ui.inputGroup}>
                  <span className={ui.addon}>UGX</span>
                  <input
                    id="nav-price" aria-label="Price of one unit in shillings"
                    className={ui.fieldInput} type="number" step="0.01" min="0.01"
                    inputMode="decimal" value={formState.unitPrice} disabled={busy}
                    onChange={(e) => setField('unitPrice', e.target.value)}
                  />
                </span>
              </label>
            </div>
          </div>

          {movePct != null && priceIsUsable && (
            <p className={ui.fieldHint}>
              {Math.abs(movePct) < 0.005
                ? 'Same as the price now.'
                : <>That&apos;s <b className={movePct >= 0 ? styles.up : styles.down}>
                    {movePct >= 0 ? 'up' : 'down'} {Math.abs(movePct).toFixed(2)}%
                  </b> from {price(d?.currentNav)} on {longDate(d?.currentNavDate)}.
                  {projectedAum != null && <> The fund would move to <b>{formatUGX(projectedAum)}</b>.</>}
                </>}
            </p>
          )}

          {duplicateRow && (
            <p className={styles.notice}>
              A price of {price(duplicateRow.unitPrice)} is already recorded for this
              day. Saving will replace it.
            </p>
          )}

          {formError && <div className={styles.errorBox} role="alert">{formError}</div>}

          <div className={styles.actions}>
            <Btn variant="primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Publish price'}
            </Btn>
          </div>
        </form>
      </Card>

      <Card>
        <SectionHead
          icon={priceIcon}
          title="How the price has moved"
          action={
            <div className={ui.filters}>
              {RANGES.map((r) => (
                <button
                  key={r.id} type="button"
                  className={`${ui.filter} ${rangeId === r.id ? ui.filterActive : ''}`}
                  onClick={() => setRangeId(r.id)} aria-label={r.label}
                >
                  {r.id}
                </button>
              ))}
            </div>
          }
        />
        <div className={styles.chartWrap}>
          {series.length === 0 ? (
            <p className={styles.empty}>No prices recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE.indigo} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={PALETTE.indigo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={false}
                  tickFormatter={shortDate} minTickGap={40} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={62}
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => Number(v).toLocaleString('en-UG', { maximumFractionDigits: 0 })} />
                <Tooltip
                  content={(p) => chartTooltip({ ...p, valueFormatter: (v) => price(v) })}
                  labelFormatter={longDate}
                />
                <Area type="monotone" dataKey="unitPrice" name="Price of one unit"
                  stroke={PALETTE.indigo} strokeWidth={2} fill="url(#navFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card>
        <SectionHead
          icon={clockIcon}
          title="Price history"
          tag="NAV register"
          action={
            <div className={ui.filters}>
              {[
                { id: null, label: 'All' },
                { id: 'published', label: 'Priced' },
                { id: 'pending', label: 'Not priced' },
              ].map((f) => (
                <button
                  key={f.label} type="button"
                  className={`${ui.filter} ${statusFilter === f.id ? ui.filterActive : ''}`}
                  onClick={() => setStatusFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        />
        <div className={ui.tableCard}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className={ui.num}>Price of one unit</th>
                <th scope="col" className={ui.num}>Change</th>
                <th scope="col" className={ui.num}>Money in fund</th>
                <th scope="col">Status</th>
                <th scope="col">Set on</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {(history.data?.rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{longDate(r.navDate)}</td>
                  <td className={ui.num}>{r.status === 'pending' ? '—' : price(r.unitPrice)}</td>
                  <td className={`${ui.num} ${r.changePct == null ? '' : r.changePct < 0 ? styles.down : styles.up}`}>
                    {r.status === 'pending' ? '—' : pct(r.changePct)}
                  </td>
                  {/* Backfilled rows carry no fund size — show "—" rather than invent one. */}
                  <td className={ui.num}>{r.aum == null ? '—' : formatUGX(r.aum)}</td>
                  <td>
                    <StatusBadge tone={r.status === 'published' ? 'active' : 'open'}>
                      {r.status === 'published' ? 'Priced' : 'Not priced'}
                    </StatusBadge>
                  </td>
                  <td>{r.publishedAt ? longDate(String(r.publishedAt).slice(0, 10)) : '—'}</td>
                  <td>{r.publishedBy || r.source || '—'}</td>
                </tr>
              ))}
              {!history.isLoading && (history.data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.empty}>
                    No prices yet. Set the first one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="This is a big change"
        size="sm"
        dismissOnBackdrop={!busy}
      >
        <p className={styles.confirmBody}>
          You are changing the price of one unit from <b>{price(d?.currentNav)}</b> to{' '}
          <b>{price(typedPrice)}</b> — {confirm?.movePct != null && (
            <b className={confirm.movePct >= 0 ? styles.up : styles.down}>
              {confirm.movePct >= 0 ? 'up' : 'down'} {Math.abs(confirm.movePct).toFixed(1)}%
            </b>
          )}.
        </p>
        <p className={styles.confirmBody}>
          Every member&apos;s savings change with it. The fund would move from{' '}
          <b>{formatUGX(d?.aum ?? 0)}</b> to <b>{formatUGX(projectedAum ?? 0)}</b>.
        </p>
        <div className={styles.actions}>
          <Btn variant="secondary" type="button" onClick={() => setConfirm(null)} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="primary" type="button" onClick={() => doPublish(true)} disabled={busy}>
            {busy ? 'Saving…' : 'Yes, publish it'}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
