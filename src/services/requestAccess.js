// Employer/distributor "request access" lead-form service — backed by
// `POST /api/access-request`.
//
// Employers and distributors are provisioned by an admin (not self-signed-up),
// so the public "get started" path is a lead form. This persists the request to
// `access_requests` (via the service-role route, mirroring the contact form) for
// a super-admin to approve/deny. Contract mirrors submitContactForm:
//   - Real path      → { ok: true, demo: false, id }
//   - Mock fallback  → { ok: true, demo: true }   (rollback flag only)

import { api, IS_SUPABASE_ENABLED } from './api';

/**
 * @endpoint POST /api/access-request
 * @param {{
 *   type: 'employer' | 'distributor',
 *   orgName: string,
 *   registrationNo?: string,
 *   contactName?: string,
 *   contactEmail?: string,
 *   contactPhone?: string,
 *   sector?: string,           // employer only
 *   district?: string,         // BOTH kinds since 0140
 *   physicalAddress?: string,  // distributor only
 * }} payload
 * @returns {Promise<{ ok: true, demo: boolean, id?: string }>}
 */
export async function submitAccessRequest(payload) {
  if (!IS_SUPABASE_ENABLED) {
    return mockSubmit();
  }
  try {
    const res = await api.post('/access-request', {
      type: payload.type === 'distributor' ? 'distributor' : 'employer',
      orgName: payload.orgName,
      registrationNo: payload.registrationNo,
      contactName: payload.contactName,
      contactEmail: payload.contactEmail,
      contactPhone: payload.contactPhone,
      sector: payload.sector,
      district: payload.district,
      physicalAddress: payload.physicalAddress,
    });
    // Backend contract: { submitted: true, id }
    return { ok: true, demo: false, id: res?.id };
  } catch (err) {
    // Only fall back to the mock under the explicit rollback flag (mirrors
    // submitContactForm) — otherwise a real backend error surfaces to the
    // caller instead of being masked as a silent "demo" success.
    if (String(import.meta.env.VITE_USE_SUPABASE ?? 'true').toLowerCase() === 'false') {
      return mockSubmit();
    }
    throw err;
  }
}

async function mockSubmit() {
  // Demo mode — the form still confirms so the flow is demoable without a backend.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { ok: true, demo: true };
}
