// Policy derivation for the subscriber "Your policies" surfaces.
//
// Insurance is stored per-(subscriber, product) in `subscriber.insuranceProducts`
// (migration 0063): one row per held product — life / health / funeral. This
// module normalises those rows into the `policies` list the UI renders,
// computing active vs expired from each row's renewal date so the policies page
// can show real states and drive a renew-by-payment flow. A legacy single-life
// fallback (from `subscriber.insurance`) keeps any pre-0063 / signup-only read
// working.
//
// IMPORTANT (CLAUDE.md §4.1): this is a util, NOT a service, so it must NOT
// import from `src/data/mockData.js`. The demo clock is read by the service
// layer (`services/subscriber.js`) via `currentTime()` and passed in as `now`.

import { INSURANCE_PRODUCTS } from '../constants/savings';

// Fallback premium for a held policy whose record is missing a premium, so the
// renewal amount is never UGX 0 (the cover slider's lowest tier is 2,000/mo).
const FALLBACK_PREMIUM_MONTHLY = 2_000;

// Display name + stable ordering per product. Falls back to the
// INSURANCE_PRODUCTS label, then a generic title.
const PRODUCT_LABEL = {
  life: 'Life cover',
  health: 'Health insurance',
  funeral: 'Funeral cover',
};
const PRODUCT_ORDER = ['life', 'health', 'funeral'];

// Compact product labels for one-line cover summaries ("Life & Health").
const PRODUCT_SHORT = { life: 'Life', health: 'Health', funeral: 'Funeral' };

// Exported so agent-side surfaces (PolicyChips) reuse the SAME product→label map
// the subscriber policies page uses — no third copy to drift.
export function productName(product) {
  if (PRODUCT_LABEL[product]) return PRODUCT_LABEL[product];
  const cfg = INSURANCE_PRODUCTS.find((p) => p.id === product);
  return cfg?.label ?? 'Insurance cover';
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A held policy (cover > 0) is `active` while its renewal date is still in the
 * future and `expired` once it has passed. The date is the dominant signal: a
 * renewal pushes the date forward a year → active; a long-lapsed policy reads
 * as expired regardless of a stale stored flag.
 */
export function derivePolicyStatus({ renewalDate }, now) {
  const renew = toDate(renewalDate);
  if (!renew) return 'active';
  return renew.getTime() >= now.getTime() ? 'active' : 'expired';
}

function buildPolicy(base, override, now) {
  // A renewal override pushes the renewal date forward and reactivates.
  const renewalDate = override?.renewalDate ?? base.renewalDate;
  const employerPaid = base.fundedBy === 'employer';
  // Employer-funded group cover: the member pays nothing (premium 0, no renewal
  // amount). Self-funded falls back to the entry premium so renewal is never 0.
  const premiumMonthly = employerPaid
    ? 0
    : (Number(base.premiumMonthly) > 0 ? Number(base.premiumMonthly) : FALLBACK_PREMIUM_MONTHLY);
  // A 'building' policy (save-to-cover: the annual premium is still being saved
  // up — migration 0072) is NOT yet in force. It keeps its 'building' status even
  // though its placeholder renewal_date sits in the future, so the date-based
  // derivation below must not read it as 'active'. The DB sweep flips it to
  // 'active' once the accrual funds the premium. All other rows derive by date.
  const status = base.status === 'building'
    ? 'building'
    : derivePolicyStatus({ renewalDate }, now);
  return {
    id: base.id,
    type: base.type,
    name: base.name,
    cover: Number(base.cover) || 0,
    premiumMonthly,
    policyStart: base.policyStart ?? null,
    renewalDate: renewalDate ?? null,
    status,
    renewalAmount: employerPaid ? 0 : premiumMonthly * 12,
    // 'employer' = the subscriber's employer pays this group premium (the member
    // pays nothing and can't re-buy it); 'self' = the subscriber funds it.
    fundedBy: base.fundedBy ?? 'self',
  };
}

/**
 * Build the subscriber's normalised policy list — one entry per held insurance
 * product. Pure: `now` and any `renewalOverrides` (keyed by product id) are
 * supplied by the service layer.
 *
 * @param {object} subscriber — expects `insuranceProducts` (per-product rows);
 *   falls back to the single `insurance` (life) record when that's absent/empty.
 * @param {{ now: Date, renewalOverrides?: Record<string, {renewalDate:string}> }} opts
 * @returns {Array<object>}
 */
export function derivePolicies(subscriber, { now, renewalOverrides = {} } = {}) {
  if (!subscriber || !now) return [];

  // Source rows = the per-product insurance set. Legacy fallback: if the array
  // is absent/empty but the single life record has cover, synthesise one life
  // row so older reads + signup-only accounts still render their policy.
  let rows = (Array.isArray(subscriber.insuranceProducts) ? subscriber.insuranceProducts : [])
    .filter((r) => Number(r.cover) > 0);
  if (rows.length === 0) {
    const ins = subscriber.insurance;
    if (ins && Number(ins.cover) > 0) {
      rows = [{
        product: 'life',
        cover: ins.cover,
        premiumMonthly: ins.premiumMonthly,
        policyStart: ins.policyStart,
        renewalDate: ins.renewalDate,
        status: ins.status,
        fundedBy: ins.fundedBy,
      }];
    }
  }

  return rows
    .slice()
    .sort((a, b) => PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product))
    .map((r) => buildPolicy(
      {
        id: `${subscriber.id}-${r.product}`,
        type: r.product,
        name: productName(r.product),
        cover: r.cover,
        premiumMonthly: r.premiumMonthly,
        policyStart: r.policyStart,
        renewalDate: r.renewalDate,
        status: r.status,
        fundedBy: r.fundedBy,
      },
      renewalOverrides[r.product],
      now,
    ));
}

/**
 * The subscriber's ACTIVE policies (cover > 0, renewal not lapsed), from the
 * already-derived `policies` list. Product-ordered.
 * @param {object} subscriber — expects the derived `policies` array.
 * @returns {Array}
 */
export function activePolicies(subscriber) {
  return (subscriber?.policies || []).filter((p) => p.status === 'active');
}

/**
 * Total ACTIVE insurance cover across ALL held products (life + health +
 * funeral). This is the single figure every subscriber surface should show —
 * reading the legacy life-only `sub.insurance.cover` makes a multi-product
 * member's cover disagree between screens (desktop vs mobile home, analytics,
 * withdrawals hub). Sum the derived policies instead.
 * @param {object} subscriber — expects the derived `policies` array.
 * @returns {number}
 */
export function activeCoverTotal(subscriber) {
  return activePolicies(subscriber).reduce((s, p) => s + (Number(p.cover) || 0), 0);
}

/**
 * The subscriber's BUILDING policies — save-to-cover cover whose annual premium
 * is still being saved up (not yet in force). Product-ordered.
 * @param {object} subscriber — expects the derived `policies` array.
 * @returns {Array}
 */
export function buildingPolicies(subscriber) {
  return (subscriber?.policies || []).filter((p) => p.status === 'building');
}

/**
 * Total cover the subscriber is BUILDING toward (sum of building policies'
 * cover). This is what they'll be insured for once their savings fund the
 * combined annual premium — distinct from `activeCoverTotal` (cover in force now).
 * @param {object} subscriber — expects the derived `policies` array.
 * @returns {number}
 */
export function buildingCoverTotal(subscriber) {
  return buildingPolicies(subscriber).reduce((s, p) => s + (Number(p.cover) || 0), 0);
}

/**
 * Progress of a save-to-cover subscriber toward funding their combined annual
 * premium, read from the contribution schedule (migration 0072). `target` is the
 * combined annual premium of the building products; `accrued` is how much of each
 * contribution's assigned slice has been saved toward it so far.
 * @param {object} subscriber — expects `contributionSchedule` + derived `policies`.
 * @returns {{ target:number, accrued:number, remaining:number, pct:number, isBuilding:boolean }}
 */
export function buildingProgress(subscriber) {
  const sched = subscriber?.contributionSchedule;
  const target = Math.max(0, Number(sched?.insurancePremiumTarget) || 0);
  const accrued = Math.max(0, Math.min(target, Number(sched?.insurancePremiumAccrued) || 0));
  const remaining = Math.max(0, target - accrued);
  const pct = target > 0 ? Math.min(100, Math.round((accrued / target) * 100)) : 0;
  return {
    target,
    accrued,
    remaining,
    pct,
    isBuilding: buildingPolicies(subscriber).length > 0,
  };
}

/**
 * Human one-line summary of the products a subscriber is actively covered for,
 * e.g. "Life", "Life & Health", "Life, Health & Funeral". Empty string when no
 * policy is active. Use for compact cover subtitles instead of a hardcoded
 * product string.
 * @param {object} subscriber — expects the derived `policies` array.
 * @returns {string}
 */
export function activeCoverProductsLabel(subscriber) {
  const names = activePolicies(subscriber).map((p) => PRODUCT_SHORT[p.type] || productName(p.type));
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}
