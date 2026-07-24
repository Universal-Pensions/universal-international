// Centralised environment config — all env vars accessed through here.
// When backend is ready, update VITE_API_BASE_URL in .env per environment.

export const IS_DEV = import.meta.env.DEV;
export const IS_PROD = import.meta.env.PROD;

// API base URL. Local dev falls back to '/api' — the Vite dev-server proxy
// relays every /api/* request to the Express backend on :3001. In any non-dev
// build (production / preview) Vercel hosts NO serverless functions, so
// vercel.json's `/(.*)` → index.html rewrite would silently turn an unprefixed
// `/api` request into the SPA's own HTML (every API call "succeeds" with a
// markup body, then fails to parse as JSON deep in a service). Fail LOUD there
// instead — this mirrors supabaseClient.js, which hard-throws on a missing
// VITE_SUPABASE_URL in a non-dev build rather than shipping a broken bundle.
function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured;
  if (!IS_DEV) {
    throw new Error(
      'VITE_API_BASE_URL is not set. Point it at the Render API base '
        + '(e.g. https://uganda-dashboard-api.onrender.com/api) — see .env.local.example.',
    );
  }
  return '/api';
}

export const API_BASE_URL = resolveApiBaseUrl();

/* Public marketing / support URLs. Move to env if they ever vary per region. */
export const LEGAL_TERMS_URL = import.meta.env.VITE_LEGAL_TERMS_URL || 'https://universalpensions.com/legal/terms';
export const LEGAL_PRIVACY_URL = import.meta.env.VITE_LEGAL_PRIVACY_URL || 'https://universalpensions.com/legal/privacy';
export const SUPPORT_WHATSAPP_URL = import.meta.env.VITE_SUPPORT_WHATSAPP_URL || 'https://wa.me/256700123456';
export const SUPPORT_WHATSAPP_DISPLAY = import.meta.env.VITE_SUPPORT_WHATSAPP_DISPLAY || '+256 700 123 456';
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@upensions.ug';

/* Map tile provider — defaults to CartoDB Positron (free, light theme).
   Override via VITE_MAP_TILE_URL if self-hosted tiles or another provider
   is needed for regulatory or branding reasons. The placeholder tokens
   {s}/{z}/{x}/{y}{r} are filled in by Leaflet. */
export const MAP_TILE_URL = import.meta.env.VITE_MAP_TILE_URL
  || 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
