// POST /api/access-request
//
// Public route. Validates the employer/distributor "request access" lead form
// and INSERTs it into access_requests via the service-role Supabase client (RLS
// is bypassed because the form is open to unauthenticated visitors — mirrors
// /api/contact, so there is no anon RPC / anon INSERT policy). A super-admin
// later triages the row (list/approve/deny) via the 0079 admin RPCs.
//
// Body: { type: 'employer' | 'distributor', orgName, registrationNo, contactName?,
//         contactEmail?, contactPhone?, sector?, district?, physicalAddress?,
//         message? }
// Returns: { submitted: true, id }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import supabaseAdmin from './_lib/supabase-admin.js';
import { checkLen } from './_lib/assertLen.js';
import { toCanonicalUGPhone } from './_lib/phone.js';

// Same regex the frontend uses for client-side validation.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// `toCanonicalUGPhone` only checks that 9 digits remain — it does NOT check the
// carrier prefix. Both the client (`isValidUGPhone` in src/utils/phone.js) and
// the DB (`canonical_ug_phone()` in migration 0090) do. Without this check the
// server would accept e.g. 0721234567, store it, and the request would then be
// permanently UN-APPROVABLE because 0090 refuses to provision from it.
// Keep this list in sync with those two.
const UG_MOBILE_RE = /^\+256(70|71|74|75|76|77|78)\d{7}$/;

type AccessRequestBody = {
  type?: string;
  orgName?: string;
  registrationNo?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  sector?: string;
  district?: string;
  physicalAddress?: string;
  message?: string;
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function generateId(): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `ar-${Date.now()}-${suffix}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ code: 'method_not_allowed' });
  }

  // Every response path on this public route must be uncacheable.
  res.setHeader('Cache-Control', 'no-store');

  const body = (req.body ?? {}) as AccessRequestBody;
  // Normalise rather than silently coerce: `?type=Distributor` used to fall
  // through to 'employer', quietly filing the wrong kind of request.
  const rawType = String(body.type ?? '').trim().toLowerCase();
  if (rawType && rawType !== 'employer' && rawType !== 'distributor') {
    return res.status(400).json({ code: 'invalid_type' });
  }
  const kind = rawType === 'distributor' ? 'distributor' : 'employer';
  const orgName = str(body.orgName);
  const registrationNo = str(body.registrationNo);
  const contactName = str(body.contactName);
  const contactEmail = str(body.contactEmail);
  const contactPhone = str(body.contactPhone);
  const sector = str(body.sector);
  const district = str(body.district);
  const physicalAddress = str(body.physicalAddress);
  const message = str(body.message);

  // EVERY field is required, and the server enforces it independently of the
  // form. The phone matters most: it is the sign-in key that migration 0090
  // writes into `demo_personas` at approval, so a request without a usable one
  // provisions an account nobody can ever sign in to. Canonicalise it here so
  // what we store is byte-identical to what `verify-otp` computes at login.
  const canonicalPhone = toCanonicalUGPhone(contactPhone);
  if (!orgName) return res.status(400).json({ code: 'invalid_org_name' });
  // Required for BOTH kinds. An employer or a distributor is a registered
  // company in Uganda, and an admin creating either by hand is asked for it —
  // capturing it here is what stops a self-signed-up account provisioning
  // without the number its admin-created twin always has (migration 0095).
  if (!registrationNo) return res.status(400).json({ code: 'invalid_registration_no' });
  if (!contactName) return res.status(400).json({ code: 'invalid_contact_name' });
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
    return res.status(400).json({ code: 'invalid_email' });
  }
  if (!canonicalPhone || !UG_MOBILE_RE.test(canonicalPhone)) {
    return res.status(400).json({ code: 'invalid_phone' });
  }
  // District is required for BOTH kinds since 0140. A distributor owns
  // branches and agents across the country, and without a district its row
  // cannot be placed on the national map or grouped in the admin list — the
  // same gap this route already refused to leave an employer in.
  if (!district) return res.status(400).json({ code: 'invalid_district' });
  if (kind === 'employer') {
    if (!sector) return res.status(400).json({ code: 'invalid_sector' });
  } else if (!physicalAddress) {
    return res.status(400).json({ code: 'invalid_physical_address' });
  }

  // Explicit per-field length caps before the RLS-bypassing insert — these fields
  // persist verbatim on a public unauthenticated form (storage-spam vector).
  // Caps mirror the create_distributor / create_employer validators so an
  // accepted submission always provisions cleanly on approve.
  // Org cap is per-kind: create_distributor truncates at 120, create_employer 160.
  const tooLong =
    checkLen(orgName, kind === 'distributor' ? 120 : 160, 'org_name_too_long') ??
    checkLen(registrationNo, 64, 'registration_no_too_long') ??
    checkLen(contactName, 120, 'contact_name_too_long') ??
    checkLen(contactEmail, 254, 'contact_email_too_long') ??
    checkLen(contactPhone, 32, 'contact_phone_too_long') ??
    checkLen(sector, 80, 'sector_too_long') ??
    checkLen(district, 120, 'district_too_long') ??
    checkLen(physicalAddress, 200, 'physical_address_too_long') ??
    checkLen(message, 2000, 'message_too_long');
  if (tooLong) return res.status(400).json(tooLong);

  // Idempotency: a requester who hits a validation error and resubmits used to
  // create a second pending row. After 0090 the second approval would collide
  // on the demo_personas phone+role uniqueness, so collapse it here instead.
  const { data: existing } = await supabaseAdmin
    .from('access_requests')
    .select('id')
    .eq('status', 'pending')
    .eq('kind', kind)
    .eq('contact_phone', canonicalPhone)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return res.status(200).json({ submitted: true, id: existing.id });

  const id = generateId();

  const { error } = await supabaseAdmin.from('access_requests').insert({
    id,
    kind,
    org_name: orgName,
    registration_no: registrationNo || null,
    contact_name: contactName || null,
    contact_email: contactEmail || null,
    contact_phone: canonicalPhone,   // the sign-in key, canonical +256XXXXXXXXX
    sector: kind === 'employer' ? (sector || null) : null,
    district: district || null,
    physical_address: kind === 'distributor' ? (physicalAddress || null) : null,
    message: message || null,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[access-request] insert failed', error);
    return res.status(500).json({ code: 'db_error' });
  }

  return res.status(200).json({ submitted: true, id });
}
