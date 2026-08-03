import { Children, useEffect, useRef } from 'react';
import styles from './PillChip.module.css';

/**
 * PillChip / PillChipGroup — capsule selection chips for the subscriber mobile
 * redesign (amount presets, cadence, type/status filters).
 *
 * Selected = filled indigo + white; idle = lavender-outline + indigo text.
 * Brand-only: never mint. Each chip is ≥44pt tall for one-thumb use.
 *
 * Accessibility: wrap chips in <PillChipGroup> so they form a single ARIA
 * radiogroup. The group manages a roving tabindex (one tab stop — the selected
 * chip, or the first when none is selected) and Arrow keys move focus and
 * activate the chip under it, matching the native radio pattern.
 *
 *   <PillChipGroup label="Top-up amount" layout="grid" columns={3}>
 *     {AMOUNTS.map(a => (
 *       <PillChip key={a} selected={amount === a} onClick={() => setAmount(a)}>
 *         {formatUGX(a)}
 *       </PillChip>
 *     ))}
 *   </PillChipGroup>
 */
export function PillChip({ selected = false, children, onClick, className = '', ...rest }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`${styles.chip} ${selected ? styles.selected : ''} ${className}`}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * layout:
 *   'row'  — one line, chips stretched evenly and shrinking to fit (default)
 *   'wrap' — chips sized to their content, wrapping onto further lines. Use
 *            when the chip count or label length can outgrow a narrow column
 *            (e.g. the payment-method picker inside a confirm panel).
 *   'grid' — fixed `columns` grid
 */
export function PillChipGroup({ label, layout = 'row', columns = 3, className = '', children }) {
  const ref = useRef(null);
  const isGrid = layout === 'grid';
  const layoutClass = isGrid ? styles.grid : layout === 'wrap' ? styles.wrap : styles.row;

  // Signature of which chip is selected (and how many there are) so the roving
  // tabindex effect below re-runs only when selection or the child set changes,
  // not on every render.
  const checkedSig = Children.toArray(children)
    .map((child) => (child?.props?.selected ? '1' : '0'))
    .join('');

  // Roving tabindex: keep exactly one radio in the tab order (the checked one,
  // or the first when none is checked) so the group is a single tab stop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const radios = Array.from(el.querySelectorAll('[role="radio"]'));
    if (!radios.length) return;
    const checked = radios.find((r) => r.getAttribute('aria-checked') === 'true');
    radios.forEach((r) => { r.tabIndex = -1; });
    (checked || radios[0]).tabIndex = 0;
  }, [checkedSig]);

  function handleKeyDown(e) {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    const el = ref.current;
    if (!el) return;
    const radios = Array.from(el.querySelectorAll('[role="radio"]')).filter((r) => !r.disabled);
    if (!radios.length) return;
    const current = el.querySelector('[role="radio"]:focus') || radios[0];
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next = radios[(radios.indexOf(current) + (forward ? 1 : -1) + radios.length) % radios.length];
    e.preventDefault();
    next.focus();
    next.click();
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={`${styles.group} ${layoutClass} ${className}`}
      style={isGrid ? { '--pill-cols': columns } : undefined}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

export default PillChip;
