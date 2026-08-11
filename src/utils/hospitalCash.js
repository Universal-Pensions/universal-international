// Hospital-cash claim maths — nights, the policy-year allowance, and the payout.
//
// Hospital cash does NOT reimburse bills. It pays a flat amount for each night
// the member spends in hospital, up to HOSPITAL_CASH_DAYS (20) nights per policy
// year. The product's `cover` figure is the TOTAL across those nights, so the
// number that actually matters to a member — what lands in their hand per night
// — is cover ÷ 20 (`dailyBenefit` in constants/savings.js).
//
// ⚠️ SQL PARITY: migration 0099's `submit_hospital_cash_claim` re-derives every
// number here server-side and is the authority — the client never sends an
// amount. This module exists so the form can show an honest live preview and
// so mock mode (VITE_USE_SUPABASE=false) behaves identically. If you change the
// rules here, change the RPC in the same commit.
//
// Pure: no data access, no clock of its own (`now` is injected, per §4.1).

import { HOSPITAL_CASH_DAYS, dailyBenefit } from '../constants/savings';

const DAY_MS = 86_400_000;

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function minusOneYear(date) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

/**
 * Whole nights between admission and discharge.
 *
 * Counted in UTC days rather than by subtracting timestamps, so a stay that
 * spans a DST boundary isn't off by one. A same-day admission and discharge is
 * 0 nights — hospital cash pays per night, so that is genuinely not claimable
 * rather than a rounding artefact.
 *
 * @returns {number} 0 when either date is missing or discharge precedes admission
 */
export function nightsBetween(admission, discharge) {
  const from = toDate(admission);
  const to = toDate(discharge);
  if (!from || !to) return 0;
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((toUtc - fromUtc) / DAY_MS));
}

/**
 * Start of the policy year a claim falls in.
 *
 * `renewalDate` is the END of the current policy year (utils/policies.js pushes
 * it forward a year on renewal), so the year opened one year before it. The two
 * fallbacks only ever WIDEN the window, and a wider window sums MORE prior
 * nights — so a missing date can never let a member claim beyond their 20.
 *
 * @param {{renewalDate?: string, policyStart?: string}} policy
 * @param {Date} now
 * @returns {Date}
 */
export function policyYearStart(policy, now = new Date()) {
  const renewal = toDate(policy?.renewalDate);
  if (renewal) return minusOneYear(renewal);
  const start = toDate(policy?.policyStart);
  if (start) return start;
  return minusOneYear(now);
}

/**
 * Nights already committed against hospital cash inside the current policy year.
 *
 * Two judgement calls worth knowing:
 *  - Only `rejected` claims are excluded. A claim still under review is
 *    allowance we have committed to look at; treating it as free would let a
 *    member file 20 nights twice while the first one sits pending.
 *  - Keyed on the ADMISSION date, not the submitted date — the benefit is
 *    consumed by the night spent in hospital, so a late filing must not reopen
 *    last year's allowance.
 *
 * The first-claim case needs no special handling: nothing matches, so it's 0.
 *
 * @param {Array} claims — the member's claims (mapClaimRow shape)
 * @param {{yearStart: Date}} opts
 * @returns {number}
 */
export function nightsUsed(claims, { yearStart } = {}) {
  if (!Array.isArray(claims) || !yearStart) return 0;
  return claims.reduce((sum, c) => {
    // Pre-0099 rows carry the product in `type`; after 0099 `product` is the
    // discriminator and `type` mirrors it.
    if ((c?.product ?? c?.type) !== 'health') return sum;
    if (c?.status === 'rejected') return sum;
    const admitted = toDate(c?.incidentDate);
    if (!admitted || admitted < yearStart) return sum;
    return sum + (Number(c?.nights) || 0);
  }, 0);
}

/**
 * Everything the claim form's live preview and the review screen need.
 *
 * @param {object} opts
 * @param {object} opts.policy    — the member's active hospital-cash policy
 * @param {string|Date} opts.admission
 * @param {string|Date} opts.discharge
 * @param {Array} opts.claims     — the member's existing claims
 * @param {Date} [opts.now]
 * @returns {{
 *   yearStart: Date, nights: number, used: number, remaining: number,
 *   payableNights: number, dailyRate: number, payout: number, capped: boolean,
 * }}
 */
export function hospitalCashQuote({ policy, admission, discharge, claims, now = new Date() }) {
  const yearStart = policyYearStart(policy, now);
  const nights = nightsBetween(admission, discharge);
  const used = nightsUsed(claims, { yearStart });
  const remaining = Math.max(0, HOSPITAL_CASH_DAYS - used);
  const payableNights = Math.min(nights, remaining);
  const dailyRate = dailyBenefit('health', policy?.cover) ?? 0;
  return {
    yearStart,
    nights,
    used,
    remaining,
    payableNights,
    dailyRate,
    payout: payableNights * dailyRate,
    // The member asked for more nights than they have left — the form says so
    // rather than quietly paying less than the arithmetic they just did.
    capped: nights > remaining,
  };
}
