import { Link } from 'react-router-dom';
import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { formatNumber, formatUGX } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import Modal from '../../components/Modal';
import { PageHead, MetricRow, Tile, Card, SectionHead, Avatar, Btn, StatusBadge } from '../../employer-dashboard/desktop/ui';
import ui from '../../employer-dashboard/desktop/ui.module.css';
import { COLUMN } from './attentionMeta';
import { useAttentionDrill } from './useAttentionDrill';
import NotifyComposer from './NotifyComposer';
import styles from './AdminAttentionDesktop.module.css';

const alertIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
  </svg>
);
const peopleIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 00-3-3.87" />
  </svg>
);

const HEADINGS = {
  [COLUMN.AMOUNT]: 'Amount',
  [COLUMN.DATE]: 'Raised',
  [COLUMN.DUE_BY]: 'Due by',
  [COLUMN.DAYS_LATE]: 'Days late',
  [COLUMN.COUNT]: 'Members',
  [COLUMN.STATUS]: 'Status',
};

const NUMERIC = new Set([COLUMN.AMOUNT, COLUMN.DAYS_LATE, COLUMN.COUNT]);

/** Dates arrive as ISO `YYYY-MM-DD` from the RPC. */
function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function cellFor(column, row) {
  switch (column) {
    case COLUMN.AMOUNT:
      return row.amount == null ? '—' : formatUGX(row.amount);
    case COLUMN.DATE:
      return formatDate(row.date);
    case COLUMN.DUE_BY:
      return formatDate(row.dueBy);
    case COLUMN.DAYS_LATE: {
      // daysLate is null for rows with no due date (e.g. an employer that has
      // never posted a run at all) — "—" is honest, "0" would not be.
      // The null check must come BEFORE Number(): Number(null) is 0, not NaN, so
      // a Number.isFinite guard alone silently renders a fabricated "0".
      if (row.daysLate == null) return '—';
      const n = Number(row.daysLate);
      if (!Number.isFinite(n)) return '—';
      return n > 0 ? formatNumber(n) : '0';
    }
    case COLUMN.COUNT:
      return formatNumber(row.count ?? 0);
    case COLUMN.STATUS:
      return (
        <StatusBadge tone={row.status === 'active' || row.status === 'transferred' ? 'active' : 'inactive'}>
          {String(row.status || '—').replace(/_/g, ' ')}
        </StatusBadge>
      );
    default:
      return '—';
  }
}

/**
 * Desktop drill-down for one Needs-attention signal, routed by panel state
 * (`attentionType` on AdminPanelContext) because the admin desktop shell has no
 * react-router routes.
 *
 * One generic table serves all nine drillable signals — get_admin_attention_rows
 * (0097) returns a uniform row shape and attentionMeta supplies the per-signal
 * copy and column set. The two signals that already own a purpose-built panel
 * (access requests, complaints) never reach here.
 */
export default function AdminAttentionDesktop() {
  const { attentionType, setAttentionType } = useAdminPanel();
  const {
    meta, rows, total, isLoading, isError, refetch,
    target, openNotify, closeNotify, send, sending,
  } = useAttentionDrill(attentionType);

  if (!meta) {
    return (
      <div className={ui.stack}>
        <ErrorCard
          title="Unknown attention type"
          message={`No drill-down is defined for "${attentionType}".`}
          onRetry={() => setAttentionType(null)}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={ui.stack}>
        <ErrorCard title="We couldn't load this list" onRetry={refetch} />
      </div>
    );
  }

  const notifiable = rows.some((r) => r.recipientRole);

  return (
    <div className={ui.stack}>
      <PageHead eyebrow="Needs attention" title={meta.title} sub={meta.lead} />

      <MetricRow cols={2}>
        <Tile accent="amber" icon={alertIcon} label={meta.tileLabel}
          value={formatNumber(total)} sub={meta.tileSub} />
        <Tile accent="indigo" icon={peopleIcon} label="Records to action"
          value={formatNumber(rows.length)}
          sub={rows.length ? 'Ranked most overdue first' : 'Nothing outstanding'} />
      </MetricRow>

      <Card>
        <SectionHead title={meta.title} />
        {isLoading && rows.length === 0 ? (
          <p className={styles.empty}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={styles.empty}>{meta.empty}</p>
        ) : (
          <div className={ui.tableCard}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>{meta.primaryHead}</th>
                  {meta.columns.map((c) => (
                    <th key={c} className={NUMERIC.has(c) ? ui.num : undefined}>{HEADINGS[c]}</th>
                  ))}
                  {notifiable && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={ui.rowInteractive}>
                    <td>
                      {row.href ? (
                        <Link to={row.href} className={`${styles.who} ${styles.rowLink}`}>
                          <Avatar name={row.primary} />
                          <span>
                            <span className={styles.whoName}>{row.primary}</span>
                            <span className={styles.whoMeta}>{row.secondary}</span>
                          </span>
                        </Link>
                      ) : (
                        <span className={styles.who}>
                          <Avatar name={row.primary} />
                          <span>
                            <span className={styles.whoName}>{row.primary}</span>
                            <span className={styles.whoMeta}>{row.secondary}</span>
                          </span>
                        </span>
                      )}
                    </td>
                    {meta.columns.map((c) => (
                      <td key={c} className={NUMERIC.has(c) ? ui.num : undefined}>{cellFor(c, row)}</td>
                    ))}
                    {notifiable && (
                      <td className={styles.actionCell}>
                        {row.recipientRole && (
                          <Btn variant="secondary" size="sm" onClick={() => openNotify(row)}
                            aria-label={`${meta.notifyVerb} ${row.recipientName || row.primary}`}>
                            {meta.notifyVerb}
                          </Btn>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!target}
        onClose={closeNotify}
        title={target ? `${meta.notifyVerb} ${target.recipientName || target.recipientId}` : meta.notifyVerb}
        size="sm"
      >
        <NotifyComposer key={target?.id} row={target} meta={meta} sending={sending} onSend={send} onCancel={closeNotify} />
      </Modal>
    </div>
  );
}
