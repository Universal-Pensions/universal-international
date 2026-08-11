import { Link, useParams, Navigate } from 'react-router-dom';
import { formatNumber, formatUGX } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import BottomSheet from '../../branch-dashboard/shell/BottomSheet';
import { useAttentionDrill } from './useAttentionDrill';
import NotifyComposer from './NotifyComposer';
import styles from '../../dashboard/mobile/distributorMobile.module.css';
import own from './AdminAttentionMobile.module.css';

const chevIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** Dates arrive as ISO `YYYY-MM-DD` from the RPC. Short form for a phone. */
function formatDate(value) {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The one line of hard numbers under each row's title. Built from whatever the
 * signal actually has — amount, due date, lateness — so a row never shows an
 * empty metric slot just because its signal does not carry that field.
 */
function metaLine(row) {
  const parts = [];
  if (row.amount != null) parts.push(formatUGX(row.amount));
  if (row.count != null) parts.push(`${formatNumber(row.count)} members`);
  const due = formatDate(row.dueBy);
  if (due) parts.push(`due ${due}`);
  const late = Number(row.daysLate);
  if (Number.isFinite(late) && late > 0) parts.push(`${late}d late`);
  return parts.join(' · ');
}

/**
 * Mobile drill-down for one Needs-attention signal, routed at
 * /dashboard/attention/:type — unlike the desktop admin shell, the mobile shell
 * is genuinely routed, so this is a real URL.
 *
 * Shares useAttentionDrill with AdminAttentionDesktop, so the data, the notify
 * flow and the toast copy are identical; only the chrome differs (list rows and
 * a BottomSheet instead of a table and a Modal).
 */
export default function AdminAttentionMobile() {
  const { type } = useParams();
  const {
    meta, rows, total, isLoading, isError, refetch,
    target, openNotify, closeNotify, send, sending,
  } = useAttentionDrill(type);

  // An unknown :type is a bad URL, not an error state — send them home, exactly
  // as the branch attention page does.
  if (!meta) return <Navigate to="/dashboard" replace />;

  if (isError) {
    return (
      <div className={styles.page}>
        <ErrorCard title="We couldn't load this list" onRetry={refetch} />
      </div>
    );
  }

  return (
    <>
      <header className={own.head}>
        <p className={styles.eyebrow}>Needs attention</p>
        <h1 className={own.title}>{meta.title}</h1>
        <p className={own.lead}>{meta.lead}</p>
      </header>

      <section className={own.tiles} aria-label="Summary">
        <div className={own.tile} data-tone="amber">
          <span className={own.tileVal}>{formatNumber(total)}</span>
          <span className={own.tileLbl}>{meta.tileLabel}</span>
        </div>
        <div className={own.tile}>
          <span className={own.tileVal}>{formatNumber(rows.length)}</span>
          <span className={own.tileLbl}>Records to action</span>
        </div>
      </section>

      <section className={styles.card} aria-label={meta.title}>
        <header className={styles.cardHd}><h3>{meta.title}</h3></header>

        {isLoading && rows.length === 0 ? (
          <p className={own.msg}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={own.msg}>{meta.empty}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className={own.row}>
              {row.href ? (
                <Link to={row.href} className={own.rowMain} aria-label={`View ${row.primary}`}>
                  <span className={own.rowText}>
                    <b>{row.primary}</b>
                    <small>{row.secondary}</small>
                    <em className={own.metaLine}>{metaLine(row)}</em>
                  </span>
                  <span className={styles.chev}>{chevIcon}</span>
                </Link>
              ) : (
                <div className={own.rowMain}>
                  <span className={own.rowText}>
                    <b>{row.primary}</b>
                    <small>{row.secondary}</small>
                    <em className={own.metaLine}>{metaLine(row)}</em>
                  </span>
                </div>
              )}
              {row.recipientRole && (
                <button
                  type="button"
                  className={own.notify}
                  onClick={() => openNotify(row)}
                  aria-label={`${meta.notifyVerb} ${row.recipientName || row.primary}`}
                >
                  {meta.notifyVerb}
                </button>
              )}
            </div>
          ))
        )}
      </section>

      {/* Imported straight from the branch shell, as AttentionAgentsMobile does.
          Five near-identical BottomSheet copies exist across the role shells;
          promoting one to src/components/ would touch all five and is out of
          scope for this change. */}
      <BottomSheet
        open={!!target}
        onClose={closeNotify}
        title={target ? `${meta.notifyVerb} ${target.recipientName || target.recipientId}` : meta.notifyVerb}
        height="72%"
      >
        <NotifyComposer key={target?.id} row={target} meta={meta} sending={sending} onSend={send} onCancel={closeNotify} />
      </BottomSheet>
    </>
  );
}
