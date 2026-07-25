// POST /api/access-request
//
// Public route. Validates the employer/distributor "request access" lead form
// and INSERTs it into access_requests via the service-role Supabase client (RLS
// is bypassed because the form is open to unauthenticated visitors — mirrors
// /api/contact, so there is no anon RPC / anon INSERT policy). A super-admin
// later triages the row (list/approve/deny) via the 0079 admin RPCs.
//
// Body: { type: 'employer' | 'distributor', orgName, contactName?, contactEmail?,
//         contactPhone?, sector?, district?, message? }
// Returns: { submitted: true, id }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import supabaseAdmin from './_lib/supabase-admin.js';
import { checkLen } from './_lib/assertLen.js';

// Same regex the frontend uses for client-side validation.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type AccessRequestBody = {
  type?: string;
  orgName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  sector?: string;
  district?: string;
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
  const kind = body.type === 'distributor' ? 'distributor' : 'employer';
  const orgName = str(body.orgName);
  const contactName = str(body.contactName);
  const contactEmail = str(body.contactEmail);
  const contactPhone = str(body.contactPhone);
  const sector = str(body.sector);
  const district = str(body.district);
  const message = str(body.message);

  if (!orgName) return res.status(400).json({ code: 'invalid_org_name' });
  if (contactEmail && !EMAIL_RE.test(contactEmail)) {
    return res.status(400).json({ code: 'invalid_email' });
  }

  // Explicit per-field length caps before the RLS-bypassing insert — these fields
  // persist verbatim on a public unauthenticated form (storage-spam vector).
  // Caps mirror the create_distributor / create_employer validators so an
  // accepted submission always provisions cleanly on approve.
  const tooLong =
    checkLen(orgName, 160, 'org_name_too_long') ??
    checkLen(contactName, 120, 'contact_name_too_long') ??
    checkLen(contactEmail, 254, 'contact_email_too_long') ??
    checkLen(contactPhone, 32, 'contact_phone_too_long') ??
    checkLen(sector, 80, 'sector_too_long') ??
    checkLen(district, 120, 'district_too_long') ??
    checkLen(message, 2000, 'message_too_long');
  if (tooLong) return res.status(400).json(tooLong);

  const id = generateId();

  const { error } = await supabaseAdmin.from('access_requests').insert({
    id,
    kind,
    org_name: orgName,
    contact_name: contactName || null,
    contact_email: contactEmail || null,
    contact_phone: contactPhone || null,
    sector: kind === 'employer' ? (sector || null) : null,
    district: kind === 'employer' ? (district || null) : null,
    message: message || null,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[access-request] insert failed', error);
    return res.status(500).json({ code: 'db_error' });
  }

  return res.status(200).json({ submitted: true, id });
}
