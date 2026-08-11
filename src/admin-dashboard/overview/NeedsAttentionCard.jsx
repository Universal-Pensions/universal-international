import { Link } from 'react-router-dom';
import { formatNumber } from '../../utils/currency';
import { SEVERITY, countToAction } from './adminAttentionDerive';
import styles from './NeedsAttentionCard.module.css';

/* Icons are inline rather than imported: the two surfaces that mount this card
   pull from different icon modules (the desktop overview's local IC map, the
   mobile home's own set), and this component needs to render identically on
   both. Two glyphs is not worth a shared module. */
const alertIcon = (size) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
  </svg>
);

const checkIcon = (size) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const chevIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const toneOf = (severity) =>
  (severity === SEVERITY.ALERT ? 'Alert' : severity === SEVERITY.OK ? 'Ok' : 'Warn');

/**
 * One row. Renders as a <Link> when `href` resolves to a URL and as a <button>
 * otherwise — which is not a stylistic choice: the mobile admin shell is routed,
 * while the desktop admin shell derives its page from boolean panel flags in
 * AdminPanelContext and has no URL to link to.
 */
function AttentionTile({ item, href, onSelect }) {
  const tone = toneOf(item.severity);
  const isClear = item.severity === SEVERITY.OK;

  const body = (
    <>
      <span className={`${styles.icon} ${styles[`tint${tone}`]}`}>
        {isClear ? checkIcon(20) : alertIcon(20)}
      </span>
      <span className={styles.mid}>
        <span className={styles.label}>{item.label}</span>
        <span className={styles.sub}>{item.sub}</span>
      </span>
      <span className={`${styles.pill} ${styles[`pill${tone}`]}`}>
        {isClear ? 'Clear' : formatNumber(item.value)}
      </span>
      <span className={styles.chev}>{chevIcon}</span>
    </>
  );

  const className = `${styles.tile} ${styles[`rail${tone}`]}`;
  const label = `${item.label}: ${isClear ? 'clear' : formatNumber(item.value)} — review`;

  if (href) {
    return <Link to={href} className={className} aria-label={label}>{body}</Link>;
  }
  return (
    <button type="button" className={className} aria-label={label} onClick={() => onSelect?.(item)}>
      {body}
    </button>
  );
}

/**
 * The admin's Needs-attention list, in the branch-admin card language.
 *
 * Renders the header pill and the rows only — each surface supplies its own card
 * chrome (<Card>/<SectionHead> on desktop, a plain <section> on mobile), because
 * the two design systems wrap cards differently and forcing one on both would
 * make this component the odd one out on whichever surface lost.
 *
 * All ten signals always render. A zero-valued signal shows a green "Clear" pill
 * rather than disappearing, so the card reads as a fixed checklist the admin can
 * scan by position — the same contract the branch card has with its three rows.
 *
 * The list is FLAT: every row is one signal at one level. The withdrawals row
 * used to nest a retirement and an emergency child, which put two rows on this
 * card asking a question the drill-down's own table already answers per row.
 *
 * @param {Object} props
 * @param {Array<Object>} props.items Output of computeAdminAttention — ten items.
 * @param {(item: Object) => void} [props.onSelect] Called when a row without an
 *   href is activated. Receives the whole item, so the caller can branch on type.
 * @param {(item: Object) => (string|null|undefined)} [props.hrefFor] Returns a
 *   URL to render the row as a link, or a falsy value to render a button.
 * @param {string} [props.headerId] id of the heading this list is labelled by.
 */
export default function NeedsAttentionCard({ items = [], onSelect, hrefFor, headerId }) {
  return (
    /* No list/listitem roles: every row is already a link or a button carrying
       its own aria-label, and wrapping each in a listitem would need a
       `display: contents` element between the flex container and its children —
       which some assistive tech still drops from the accessibility tree. A
       labelled group conveys the same structure without that risk. */
    <div className={styles.list} role="group" aria-labelledby={headerId}>
      {items.map((item) => (
        <AttentionTile key={item.type} item={item} href={hrefFor?.(item)} onSelect={onSelect} />
      ))}
    </div>
  );
}

/**
 * The "N TO ACTION" / "All clear" header pill. Exported separately because each
 * surface slots it into a different header component — SectionHead's `action`
 * prop on desktop, the mobile card's own <header>.
 *
 * @param {Object} props
 * @param {Array<Object>} props.items
 */
export function NeedsAttentionPill({ items = [], align = false }) {
  const n = countToAction(items);
  const pill = (
    <span className={`${styles.count} ${n > 0 ? styles.countWarn : styles.countOk}`}>
      {n > 0 ? `${n} to action` : 'All clear'}
    </span>
  );
  // `align` pushes the pill to the right of a flex card heading. The desktop
  // card head needs it; the mobile header lays its own row out.
  return align ? <span className={styles.headAction}>{pill}</span> : pill;
}
