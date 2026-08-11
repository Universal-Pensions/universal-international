import { formatUGX } from '../../utils/currency';
import {
  annualPremium,
  coverTiers,
  coverTierAt,
  tierForCover,
} from '../../constants/savings';
import styles from './CoverTierPicker.module.css';

/**
 * Pick a cover AMOUNT for one insurance product from that product's ladder.
 *
 * ONE picker, THREE surfaces: the signup / agent-onboard cover step
 * (`signup/contribution/ContributionSettings.jsx`), the subscriber's schedule
 * editor (`components/contribution/SubscriberScheduleForm.jsx`), and the
 * settings cover page (`subscriber-dashboard/pages/InsurancePage.jsx`). Those
 * three used to hold three unrelated ideas of what cover costs — this component
 * plus `constants/savings.js` is what stops them drifting again.
 *
 * Fully controlled and purely presentational: no data access, no product
 * catalogue of its own, no state. The caller owns the selected cover.
 *
 * ACCESSIBILITY: the whole control is a `role="group"` named by `label`, which
 * is what lets three pickers coexist on one screen (the signup step renders one
 * per selected product) and stay individually addressable to a screen reader and
 * in tests. Each tier mark carries an explicit `aria-label` naming the exact
 * cover AND its annual premium, so the choice is never "UGX 5.0M" with no price
 * attached. The range input mirrors that via `aria-valuetext`.
 *
 * @param {object} props
 * @param {'life'|'health'|'funeral'} props.productId
 * @param {number} props.value — selected cover in UGX. An off-ladder amount
 *   (employer-set, hand-edited, left behind by a repricing) snaps DOWN to the
 *   nearest tier via `tierForCover` rather than collapsing to the entry tier.
 * @param {(cover: number, tier: {cover:number, premiumMonthly:number, index:number}) => void} props.onChange
 * @param {'card'|'panel'} [props.variant='panel']
 *   'card'  — compact, sits inside a product card in a multi-select grid
 *   'panel' — full width, one product at a time (settings page)
 * @param {string} props.label — accessible name, e.g. "Life cover amount"
 * @param {boolean} [props.showReadout=true] — render the "Pays … · … / year" line
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.className]
 */
export default function CoverTierPicker({
  productId,
  value,
  onChange,
  variant = 'panel',
  label,
  showReadout = true,
  disabled = false,
  className = '',
}) {
  const tiers = coverTiers(productId);
  // An unknown product has no ladder — render nothing rather than a broken
  // zero-stop slider.
  if (!tiers.length) return null;

  const active = tierForCover(productId, value);
  const annual = annualPremium(active);
  const maxIndex = tiers.length - 1;
  const valueText = `${formatUGX(active.cover)} cover, ${formatUGX(annual, { compact: false })} per year`;
  // The compact variant sits inside a ~200px product card in a 3-up grid, where
  // four "UGX 5.0M" labels overflow and clip. The currency is already stated
  // directly above each card, so drop the repeated prefix and show "5.0M" —
  // the accessible name below still carries the full unambiguous figure.
  const markLabel = (cover) => (
    variant === 'card'
      ? formatUGX(cover).replace(/^UGX\s*/, '')
      : formatUGX(cover)
  );

  function pick(tier) {
    if (disabled) return;
    onChange?.(tier.cover, tier);
  }

  return (
    <div
      className={`${styles.root} ${className}`}
      data-variant={variant}
      role="group"
      aria-label={label}
    >
      <input
        type="range"
        min={0}
        max={maxIndex}
        step={1}
        value={active.index}
        disabled={disabled}
        onChange={(e) => pick(coverTierAt(productId, Number.parseInt(e.target.value, 10)))}
        className={styles.slider}
        // Drives the two-tone track gradient — filled up to the thumb.
        style={{ '--pct': `${(active.index / maxIndex) * 100}%` }}
        aria-label={label}
        aria-valuetext={valueText}
      />

      <div className={styles.marks}>
        {tiers.map((tier, i) => (
          <button
            key={tier.cover}
            type="button"
            className={styles.mark}
            data-active={i === active.index}
            disabled={disabled}
            // The visible text is compact ("UGX 5.0M"); the accessible name
            // carries the exact figure and its price so the tier is selectable
            // and assertable without depending on the compact formatting.
            aria-label={`${formatUGX(tier.cover, { compact: false })} cover, ${formatUGX(annualPremium(tier), { compact: false })} per year`}
            onClick={() => pick({ ...tier, index: i })}
          >
            {markLabel(tier.cover)}
          </button>
        ))}
      </div>

      {showReadout && (
        <p className={styles.readout}>
          Pays <b>{formatUGX(active.cover, { compact: false })}</b>
          {' · '}
          {formatUGX(annual, { compact: false })} / year
        </p>
      )}
    </div>
  );
}
