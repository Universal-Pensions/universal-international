// POST /api/kyc/agent-referral
//
// Public route. Mirrors `referToAgent` in src/services/kyc.js.
// INSERTs a row into agent_referrals via the service-role Supabase client
// (RLS is bypassed because signup KYC runs before the user has a JWT).
//
// Body: { phone, reason, stage?, trackingId?, sessionId? }
// Returns { ticketId, eta } — the ticketId is surfaced to the user so they
// can quote it when they meet a real agent.
//
// ~600ms simulated latency to match the JS service.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import supabaseAdmin from '../_lib/supabase-admin.js';
import { toCanonicalUGPhone } from '../_lib/phone.js';
import { checkLen } from '../_lib/assertLen.js';

const SIMULATED_LATENCY_MS = 600;
const TICKET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateTicketId(): string {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += TICKET_ALPHABET[Math.floor(Math.random() * TICKET_ALPHABET.length)];
  }
  return `UAG-${suffix}`;
}

function generateRowId(): string {
  // Internal row PK (TEXT). Distinct from the user-facing ticketId so we can
  // collide-recover ticketIds without touching the row PK.
  const random = Math.random().toString(36).slice(2, 8);
  return `ar-${Date.now().toString(36)}-${random}`;
}

type ReferralBody = {
  phone?: string;
  reason?: string;
  stage?: string;
  trackingId?: string;
  sessionId?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ code: 'method_not_allowed' });
  }

  // B13: every response path on this route must be uncacheable. Setting the
  // header once at the top of the handler covers success + all 4xx/5xx paths.
  res.setHeader('Cache-Control', 'no-store');

  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));

  const body = (req.body ?? {}) as ReferralBody;
  // Canonicalise phone to +256XXXXXXXXX before doing anything else with it —
  // the row we INSERT below must store the canonical form so subsequent agent
  // lookups (which always query by canonical phone) actually match this
  // referral. Without this, a user typing "0712 345 678" creates a referral
  // row no agent dashboard can find. (B3/B4.)
  const phone = toCanonicalUGPhone(body.phone);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!phone) {
    return res.status(400).json({ code: 'invalid_phone' });
  }
  if (!reason) {
    return res.status(400).json({ code: 'reason_required' });
  }

  // §2a.5: cap `reason` before the service-role insert — it persists verbatim
  // via the RLS-bypassing admin client on this public, pre-JWT route, so an
  // over-length value is a storage-spam vector. (Verdict envelope unchanged.)
  const tooLong = checkLen(reason, 1000, 'reason_too_long');
  if (tooLong) return res.status(400).json(tooLong);

  // §2a.5 (audit D1): the optional pass-through fields also persist verbatim via
  // the RLS-bypassing service-role client on this public, pre-JWT route, so
  // type-guard (non-string → dropped) and length-cap them before the insert too.
  const stage = typeof body.stage === 'string' ? body.stage : '';
  const trackingId = typeof body.trackingId === 'string' ? body.trackingId : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const optTooLong =
    checkLen(stage, 64, 'stage_too_long') ??
    checkLen(trackingId, 128, 'tracking_id_too_long') ??
    checkLen(sessionId, 128, 'session_id_too_long');
  if (optTooLong) return res.status(400).json(optTooLong);

  const eta = 'within 24 hours';
  const ticketId = generateTicketId();
  const rowId = generateRowId();

  const { error } = await supabaseAdmin.from('agent_referrals').insert({
    id: rowId,
    ticket_id: ticketId,
    phone,
    reason,
    stage: stage || null,
    tracking_id: trackingId || null,
    session_id: sessionId || null,
    status: 'open',
    eta,
  });

  if (error) {
    // Surface a generic error code — the user can still try again or
    // proceed via a different channel. Logged for operator triage.
    // eslint-disable-next-line no-console
    console.error('[agent-referral] insert failed', error);
    return res.status(500).json({ code: 'db_error' });
  }

  return res.status(200).json({ ticketId, eta });
}
