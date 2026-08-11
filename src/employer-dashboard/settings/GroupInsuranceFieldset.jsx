// Group-insurance fieldset — MULTI-PRODUCT (Life / Health / Funeral) company-wide
// group cover, employer-funded. Extracted from EmployerSettings so it can render
// on BOTH the Pension contribution tab and the Insurance tab bound to the SAME
// state (the `groupInsuranceProducts` slice of the config draft).
//
// Each product is all-or-nothing across the roster; the employer sets a cover
// amount per product and the premium is derived at 0.2%/mo of cover (the same
// rate as the individual life product). Staff pay nothing — the employer funds
// every premium (charged in the contribution run).
//
// Props:
//   • products  — { life:{enabled,cover}, health:{enabled,cover}, funeral:{enabled,cover} }
//                 (cover is the raw input string | number; '' = unset)
//   • onProductChange(id, patch) — merge {enabled?, cover?} into one product
import styles from './EmployerSettings.module.css';
import { groupPremiumPerMember } from '../../utils/groupInsurance';
import { formatUGX } from '../../utils/currency';

const PRODUCTS = [
  { id: 'life', label: 'Life insurance', blurb: 'Lump sum for beneficiaries' },
  // id stays 'health' — the stored product enum; 'Hospital cash' is its name.
  { id: 'health', label: 'Hospital cash', blurb: 'Hospital & clinic cover' },
  { id: 'funeral', label: 'Funeral insurance', blurb: 'Eases funeral & burial costs' },
];

export default function GroupInsuranceFieldset({ products = {}, onProductChange }) {
  const total = PRODUCTS.reduce((sum, p) => {
    const d = products[p.id] || {};
    const cover = Number(d.cover) || 0;
    return sum + (d.enabled && cover > 0 ? groupPremiumPerMember(cover) : 0);
  }, 0);

  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Group insurance</legend>
      <p className={styles.coverNote}>
        Provide cover to all staff — fully employer-funded. Each product is
        all-or-nothing (every member covered at the same amount). The premium is
        0.2%/mo of cover; staff pay nothing.
      </p>

      {PRODUCTS.map((p) => {
        const d = products[p.id] || { enabled: false, cover: '' };
        const cover = Number(d.cover) || 0;
        const premium = d.enabled && cover > 0 ? groupPremiumPerMember(cover) : 0;
        return (
          <div key={p.id} className={styles.prodRow}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                role="switch"
                className={styles.switchInput}
                checked={!!d.enabled}
                onChange={(e) => onProductChange(p.id, { enabled: e.target.checked })}
              />
              <span className={styles.switchTrack} aria-hidden="true"><span className={styles.switchThumb} /></span>
              <span className={styles.switchLabel}>{p.label} <em className={styles.prodBlurb}>· {p.blurb}</em></span>
            </label>

            {d.enabled && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`emp-cover-${p.id}`}>
                  Cover per member (UGX)
                </label>
                <input
                  id={`emp-cover-${p.id}`}
                  className={styles.input}
                  type="number"
                  min="0"
                  step="1000"
                  value={d.cover}
                  placeholder="e.g. 5000000"
                  onChange={(e) => onProductChange(p.id, { cover: e.target.value })}
                />
                <span className={styles.coverNote}>
                  Employer pays {formatUGX(premium)} / mo per staff member for {p.label.toLowerCase()}.
                </span>
              </div>
            )}
          </div>
        );
      })}

      {total > 0 && (
        <div className={styles.prodTotal}>
          Total employer premium: <strong>{formatUGX(total)} / mo per staff</strong>
        </div>
      )}
    </fieldset>
  );
}
