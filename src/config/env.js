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

/* Map basemap tiles — OFF by default; the map renders from GeoJSON alone.
   The old default was CartoDB Positron's KEYLESS endpoint
   (https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png).
   CARTO now stamps "API KEY REQUIRED · carto.com/basemaps/apikey" into those
   tiles server-side, so the watermark shipped to production — it cannot be
   hidden with CSS because it is baked into the PNG.
   Dropping the layer costs nothing: the tiles rendered at 0.08–0.2 opacity
   UNDERNEATH an opaque GeoJSON Uganda fill, so all they ever contributed was a
   faint grey wash outside the border (A/B'd on 2026-08-27 — the map reads
   cleaner without). They also carried a CARTO/OSM attribution requirement that
   `attributionControl={false}` in UgandaMap was suppressing.
   Set VITE_MAP_TILE_URL to bring a basemap back — a KEYED CARTO url, self-hosted
   tiles, or another provider. If you do, add the provider's required
   attribution: UgandaMap currently renders none. Leaflet fills {s}/{z}/{x}/{y}{r}. */
export const MAP_TILE_URL = import.meta.env.VITE_MAP_TILE_URL || '';
