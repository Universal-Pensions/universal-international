// Insurance claim vocabulary — products, statuses, and how to label a claim row.
//
// This file exists because the same four-item list used to be copy-pasted in
// THREE places (the claim page, the insurance statement report, and the mock
// seed). Those copies were an incident taxonomy — medical / accident /
// hospitalization / critical_illness — chosen before the life / hospital-cash /
// funeral catalogue existed, so the claim form offered options that mapped to
// nothing a member actually held.
//
// WHO CAN CLAIM WHAT is the rule that matters:
//   * hospital cash  — the member, in-app, while alive (see ClaimPage).
//   * life, funeral  — the NOMINEE, after the member's death, via the public
//                      intake form at /claim. A nominee has no account, so
//                      those never appear in the signed-in claim flow.

import { productName } from '../utils/policies';

/** Every claimable product, and who is entitled to make the claim. */
export const CLAIM_PRODUCTS = [
  { id: 'health', label: 'Hospital cash', claimant: 'member' },
  { id: 'life', label: 'Life cover', claimant: 'nominee' },
  { id: 'funeral', label: 'Funeral cover', claimant: 'nominee' },
];

/** Products a signed-in member may claim for themselves. */
export const MEMBER_CLAIMABLE_PRODUCTS = CLAIM_PRODUCTS
  .filter((p) => p.claimant === 'member').map((p) => p.id);

/** Products only a nominee may claim — they pay out after the member has died. */
export const NOMINEE_CLAIMABLE_PRODUCTS = CLAIM_PRODUCTS
  .filter((p) => p.claimant === 'nominee').map((p) => p.id);

/**
 * Incident categories on PRE-0099 rows, where `claims.type` held a category
 * rather than a product. Kept so historical claims still render a human label
 * instead of a raw enum — do NOT offer these as choices anywhere.
 */
export const LEGACY_CLAIM_TYPE_LABEL = {
  medical: 'Medical',
  accident: 'Accident',
  hospitalization: 'Hospitalisation',
  critical_illness: 'Critical illness',
};

/**
 * Human label for a claim row, spanning both vocabularies.
 * Rows written after 0099 carry `product`; older ones only have a legacy `type`.
 *
 * @param {{product?: string, type?: string}} row
 * @returns {string}
 */
export function claimTypeLabel(row) {
  const product = row?.product;
  if (product && CLAIM_PRODUCTS.some((p) => p.id === product)) return productName(product);
  const legacy = LEGACY_CLAIM_TYPE_LABEL[row?.type];
  if (legacy) return legacy;
  // A post-0099 row mirrors product into `type`, so this also covers 'health'.
  if (row?.type && CLAIM_PRODUCTS.some((p) => p.id === row.type)) return productName(row.type);
  return row?.type || 'Claim';
}

/** The `claims.status` domain (CHECK constraint added by migration 0027). */
export const CLAIM_STATUSES = ['submitted', 'under_review', 'approved', 'paid', 'rejected'];

const STATUS_META = {
  submitted: { label: 'Submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'pending' },
  approved: { label: 'Approved', tone: 'ok' },
  paid: { label: 'Paid', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'alert' },
};

/**
 * Label + tone for a claim status. One source for the claim list, the statement
 * report and anything else that renders a status pill.
 * @returns {{ label: string, tone: 'ok'|'info'|'pending'|'alert' }}
 */
export function claimStatusMeta(status) {
  return STATUS_META[status] ?? { label: status || 'Unknown', tone: 'info' };
}
