// Public nominee claim service — backed by `POST /api/nominee-claim`.
//
// Life and funeral cover pay out after the member has died, so the claim is made
// by the person they named, who has no account. This persists the claim to
// `nominee_claims` via the service-role route (mirroring the contact and
// request-access forms) for a super-admin to triage. Contract:
//   - Real path      → { ok: true, demo: false, id, reference }
//   - Mock fallback  → { ok: true, demo: true, reference }   (rollback flag only)

import { api, IS_SUPABASE_ENABLED } from './api';

/**
 * @endpoint POST /api/nominee-claim
 * @param {{
 *   product: 'life' | 'funeral',
 *   deceasedName: string, deceasedNin?: string, deceasedPhone?: string,
 *   dateOfDeath: string,
 *   claimantName: string, claimantNin?: string,
 *   claimantPhone: string, claimantEmail?: string,
 *   relationship: string, district?: string, notes?: string,
 * }} payload
 * @returns {Promise<{ ok: true, demo: boolean, id?: string, reference: string }>}
 */
export async function submitNomineeClaim(payload) {
  if (!IS_SUPABASE_ENABLED) {
    return mockSubmit();
  }
  try {
    const res = await api.post('/nominee-claim', {
      product: payload.product,
      deceasedName: payload.deceasedName,
      deceasedNin: payload.deceasedNin,
      deceasedPhone: payload.deceasedPhone,
      dateOfDeath: payload.dateOfDeath,
      claimantName: payload.claimantName,
      claimantNin: payload.claimantNin,
      claimantPhone: payload.claimantPhone,
      claimantEmail: payload.claimantEmail,
      relationship: payload.relationship,
      district: payload.district,
      notes: payload.notes,
    });
    // Backend contract: { submitted: true, id, reference }. A 200 with no
    // reference is a contract violation, not a success — telling a bereaved
    // family their claim is filed when it isn't is the worst failure this form
    // has (mirrors the same guard in Contact.jsx).
    if (!res?.reference) {
      throw new Error('The claim did not save. Please call us and we will take it over the phone.');
    }
    return { ok: true, demo: false, id: res.id, reference: res.reference };
  } catch (err) {
    // Only fall back to the mock under the explicit rollback flag (G53) —
    // otherwise a real backend error surfaces to the caller instead of being
    // masked as a silent "demo" success.
    if (String(import.meta.env.VITE_USE_SUPABASE ?? 'true').toLowerCase() === 'false') {
      return mockSubmit();
    }
    throw err;
  }
}

async function mockSubmit() {
  // Demo mode — the form still confirms so the flow is demoable without a backend.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return { ok: true, demo: true, reference: `NC-DEMO${suffix}` };
}
