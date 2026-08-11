// POST /api/nominee-claim
//
// Public route. A NOMINEE reports the death of a member and claims their life
// or funeral benefit. INSERTs into `nominee_claims` via the service-role
// Supabase client (RLS is bypassed because the claimant has no account and
// never will) — mirrors /api/contact and /api/access-request. A super-admin
// later triages the row via the 0100 admin RPCs.
//
// WHY THIS IS NOT AN ANON RPC
// Migration 0094 fixed the pre-login RPC registry at exactly three functions and
// documents that list as the closed set of anon surfaces. Beyond convention,
// any phone- or NIN-keyed anon lookup against `nominees` would be a
// member-enumeration oracle: submit a number, learn whether that person holds a
// policy. So this route accepts a claim and tells the claimant we will call
// them — it never confirms or denies that the deceased was a member.
//
// Body:    { product: 'life' | 'funeral', deceasedName, deceasedNin?,
//            deceasedPhone?, dateOfDeath, claimantName, claimantNin?,
//            claimantPhone, claimantEmail?, relationship, district?, notes? }
// Returns: { submitted: true, id, reference }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import supabaseAdmin from './_lib/supabase-admin.js';
import { checkLen } from './_lib/assertLen.js';
import { toCanonicalUGPhone } from './_lib/phone.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `toCanonicalUGPhone` only checks that 9 digits remain — it does NOT check the
// carrier prefix. Keep this list in sync with `isValidUGPhone` (src/utils/phone.js),
// `canonical_ug_phone()` (migration 0090) and /api/access-request.
const UG_MOBILE_RE = /^\+256(70|71|74|75|76|77|78)\d{7}$/;

// A death certificate can take a while to obtain, so the window is generous —
// this only rejects dates that are obviously wrong (the future, or last century).
const MAX_YEARS_AGO = 10;

type NomineeClaimBody = {
  product?: string;
  deceasedName?: string;
  deceasedNin?: string;
  deceasedPhone?: string;
  dateOfDeath?: string;
  claimantName?: string;
  claimantNin?: string;
  claimantPhone?: string;
  claimantEmail?: string;
  relationship?: string;
  district?: string;
  notes?: string;
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ code: 'method_not_allowed' });
  }

  // Every response path on this public route must be uncacheable. Set once, at
  // the top, so it also covers the 4xx/5xx returns below.
  res.setHeader('Cache-Control', 'no-store');

  const body = (req.body ?? {}) as NomineeClaimBody;

  // Hospital cash is claimed by the MEMBER in-app (migration 0099); only death
  // benefits reach this form. Reject rather than coerce — filing a hospital-cash
  // claim as a death claim would be a very bad silent default.
  const product = String(body.product ?? '').trim().toLowerCase();
  if (product !== 'life' && product !== 'funeral') {
    return res.status(400).json({ code: 'invalid_product' });
  }

  const deceasedName = str(body.deceasedName);
  const deceasedNin = str(body.deceasedNin);
  const deceasedPhone = str(body.deceasedPhone);
  const dateOfDeath = str(body.dateOfDeath);
  const claimantName = str(body.claimantName);
  const claimantNin = str(body.claimantNin);
  const claimantPhone = str(body.claimantPhone);
  const claimantEmail = str(body.claimantEmail);
  const relationship = str(body.relationship);
  const district = str(body.district);
  const notes = str(body.notes);

  if (!deceasedName) return res.status(400).json({ code: 'invalid_deceased_name' });

  if (!ISO_DATE_RE.test(dateOfDeath)) {
    return res.status(400).json({ code: 'invalid_date_of_death' });
  }
  const dod = new Date(`${dateOfDeath}T00:00:00Z`);
  const today = new Date();
  const earliest = new Date();
  earliest.setFullYear(earliest.getFullYear() - MAX_YEARS_AGO);
  if (Number.isNaN(dod.getTime()) || dod > today || dod < earliest) {
    return res.status(400).json({ code: 'invalid_date_of_death' });
  }

  // The deceased's phone is canonicalised but NOT prefix-checked: it may be an
  // old or mis-remembered number, and we would rather capture what the family
  // has than reject the claim over it. Matching is a human step at triage.
  const canonicalDeceasedPhone = deceasedPhone ? toCanonicalUGPhone(deceasedPhone) : '';
  // A widow may not know which number was the platform login, but the NIN is on
  // the death paperwork. Require one identifier, ask for both.
  if (!canonicalDeceasedPhone && !deceasedNin) {
    return res.status(400).json({ code: 'invalid_deceased_identifier' });
  }

  if (!claimantName) return res.status(400).json({ code: 'invalid_claimant_name' });
  if (!relationship) return res.status(400).json({ code: 'invalid_relationship' });

  // The claimant's phone IS prefix-checked — it is the only channel we have for
  // calling them back, so an unreachable number makes the claim undeliverable.
  const canonicalClaimantPhone = toCanonicalUGPhone(claimantPhone);
  if (!canonicalClaimantPhone || !UG_MOBILE_RE.test(canonicalClaimantPhone)) {
    return res.status(400).json({ code: 'invalid_phone' });
  }

  // Email is OPTIONAL here, unlike /api/access-request. That form is a B2B lead
  // where email is the reply channel; this one is filled in by a bereaved
  // relative in Uganda who often has no email address.
  if (claimantEmail && !EMAIL_RE.test(claimantEmail)) {
    return res.status(400).json({ code: 'invalid_email' });
  }

  // Explicit per-field caps before the RLS-bypassing insert — these persist
  // verbatim from a public unauthenticated form (storage-spam vector).
  const tooLong =
    checkLen(deceasedName, 160, 'deceased_name_too_long')
    ?? checkLen(deceasedNin, 32, 'deceased_nin_too_long')
    ?? checkLen(claimantName, 120, 'claimant_name_too_long')
    ?? checkLen(claimantNin, 32, 'claimant_nin_too_long')
    ?? checkLen(claimantEmail, 254, 'claimant_email_too_long')
    ?? checkLen(relationship, 60, 'relationship_too_long')
    ?? checkLen(district, 120, 'district_too_long')
    ?? checkLen(notes, 2000, 'notes_too_long');
  if (tooLong) return res.status(400).json(tooLong);

  // Idempotency. A grieving claimant who trips a validation error and resubmits
  // must not open two cases for the same person — and support must not have to
  // reconcile duplicates. Keyed on the pending (claimant phone, deceased name)
  // pair, the same shape /api/access-request uses.
  const { data: existing } = await supabaseAdmin
    .from('nominee_claims')
    .select('id, reference')
    .eq('status', 'pending')
    .eq('claimant_phone', canonicalClaimantPhone)
    .eq('deceased_name', deceasedName)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return res.status(200).json({ submitted: true, id: existing.id, reference: existing.reference });
  }

  // id and reference are generated by the table's DEFAULTs (migration 0100), so
  // the human-quotable reference is minted in exactly one place.
  const { data, error } = await supabaseAdmin
    .from('nominee_claims')
    .insert({
      product,
      deceased_name: deceasedName,
      deceased_nin: deceasedNin || null,
      deceased_phone: canonicalDeceasedPhone || null,
      date_of_death: dateOfDeath,
      claimant_name: claimantName,
      claimant_nin: claimantNin || null,
      claimant_phone: canonicalClaimantPhone,
      claimant_email: claimantEmail || null,
      relationship,
      district: district || null,
      notes: notes || null,
    })
    .select('id, reference')
    .single();

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[nominee-claim] insert failed', error);
    return res.status(500).json({ code: 'db_error' });
  }

  return res.status(200).json({ submitted: true, id: data.id, reference: data.reference });
}
