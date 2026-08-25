// Server-side environment preflight.
//
// Replaces the two top-level `throw`s in `api/_lib/supabase-admin.ts` and
// `api/_lib/jwt.ts` (B1). Those throws would crash the entire Express
// process on module load if a single env var was missing — including
// `/healthz`, which would push Render into a redeploy loop with no
// recoverable signal. Centralising the check here, after Sentry.init but
// before `app.listen`, lets boot failures surface as a single readable
// error in Render's log stream listing ALL missing keys at once (G5).
//
// `SUPABASE_URL` is the new server-side name (G19). During the Vercel
// → Render cutover we still accept `VITE_SUPABASE_URL` as a fallback —
// once every deploy has the renamed var, the fallback can drop in a
// follow-up commit.
//
// A09-014 — that fallback is silent today: a `.env.local` that predates the
// rename boots cleanly with no signal that it's one `git rm` away from
// breaking. `assertServerEnv()` now warns (not throws) whenever the fallback
// is the only reason boot succeeded — see the `console.warn` below for why
// this is deliberately a warning and not a hard failure.

const REQUIRED_KEYS = [
  // Listed first so an aggregated error message reads naturally.
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
] as const;

export function assertServerEnv(): void {
  const missing: string[] = [];

  // G19 — fall back to `VITE_SUPABASE_URL` during the cutover. Once Render +
  // every deploy carries `SUPABASE_URL`, drop the fallback in a follow-up.
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    missing.push('SUPABASE_URL');
  } else if (!process.env.SUPABASE_URL) {
    // A09-014 — warn, don't throw. Render always sets SUPABASE_URL directly
    // (render.yaml envVars), so in practice this only fires against a local
    // `.env.local` that still only has VITE_SUPABASE_URL. Hard-failing here
    // would break `npm run dev:api` for every such checkout the moment this
    // ships, and this programme cannot fix that for you: `.env.local` is
    // gitignored, machine-local, and explicitly out of bounds for an agent to
    // edit. So the fix has to be a loud nag, not a wall. The real enforcement
    // point is the day the `?? process.env.VITE_SUPABASE_URL` fallback above
    // is actually deleted — at that point `supabaseUrl` goes empty and the
    // `missing.push('SUPABASE_URL')` branch starts throwing on its own, which
    // is correct and intentional. This warning exists purely so that day
    // isn't a surprise.
    console.warn(
      '[env] SUPABASE_URL is not set — booting on the VITE_SUPABASE_URL ' +
        'fallback instead. That fallback is scheduled for removal (see the ' +
        'comment above REQUIRED_KEYS in server/env.ts). Fix: add ' +
        'SUPABASE_URL=<your-project-url> to .env.local — a filled-in ' +
        'template line already exists under "Backend only" in ' +
        '.env.local.example. Once the fallback is removed, this will be a ' +
        'hard failure instead of a warning.'
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!process.env.SUPABASE_JWT_SECRET) {
    missing.push('SUPABASE_JWT_SECRET');
  }

  if (missing.length > 0) {
    // Single throw listing every missing key — operators fix all of them in
    // one redeploy instead of chasing them one at a time.
    throw new Error(
      `[env] missing required server env vars: ${missing.join(', ')}. ` +
        `Required: ${REQUIRED_KEYS.join(', ')}.`
    );
  }
}
