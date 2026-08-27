// Demo scope: no rate limiting, no HIBP check, no email-reset flow.
//
// POST /api/auth/verify-password
//
// Password sign-in companion to `verify-otp`. Accepts `{ phone, role, password }`,
// looks up the `users(phone, role)` row, bcrypt-compares the supplied password
// against `password_hash`, and — on success — resolves the same role-scoped
// entity ID and mints the same JWT shape that `verify-otp` does. The frontend
// treats both responses interchangeably (`AuthContext.login` consumes either
// `{ token, user }` payload).
//
// Error vocabulary (4xx codes mirror the AuthError vocabulary on the
// frontend; UI maps both `password_not_set` cases to a single "use OTP
// instead" fallback so users with no hash never see a "wrong password" toast):
//   - invalid_request    — missing/wrong-type field
//   - password_not_set   — phone+role has no row OR row has NULL password_hash
//   - invalid_password   — row found with hash, but bcrypt compare failed
//   - role_mismatch      — defense-in-depth: row's stored role ≠ requested role

import type { VercelRequest, VercelResponse } from '@vercel/node';
import supabaseAdmin from '../_lib/supabase-admin.js';
import { signJwt, type JwtRole } from '../_lib/jwt.js';
import { toCanonicalUGPhone, MAX_PHONE_INPUT_LEN } from '../_lib/phone.js';
import { checkLen } from '../_lib/assertLen.js';
import { verifyPassword } from './_lib/password.js';
import {
  ROLE_DEFAULTS,
  resolveDemoPersona,
  resolveSubscriber,
} from './_lib/personas.js';
import { buildAuthResponseDto, buildJwtClaims } from './_lib/claims.js';
import {
  isEntityDeactivated,
  ACCOUNT_DEACTIVATED_RESPONSE,
} from './_lib/entity-status.js';

const VALID_ROLES = new Set<JwtRole>([
  'subscriber',
  'agent',
  'branch',
  'distributor',
  'employer',
  'admin',
]);

async function touchLastLogin(phone: string, role: JwtRole): Promise<void> {
  // Best-effort `last_login_at` bump. Failure is non-fatal — the user is
  // already authenticated and we don't want a stray UPDATE error to mask
  // a successful sign-in.
  const { error } = await supabaseAdmin
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('phone', phone)
    .eq('role', role);
  if (error) {
    console.error('[verify-password] last_login_at update failed', error);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // B13: every response path on this auth route must be uncacheable. Set the
  // header BEFORE the method check so even the 405 carries no-store (2a.2);
  // it also covers success + all 4xx/5xx paths (invalid_request,
  // password_not_set, role_mismatch, invalid_password, db_error, and the
  // generic catch).
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed' });
    return;
  }

  const body = (req.body ?? {}) as {
    phone?: unknown;
    role?: unknown;
    password?: unknown;
  };
  const { phone, role, password } = body;

  if (typeof phone !== 'string' || phone.length === 0) {
    res.status(400).json({ code: 'invalid_request' });
    return;
  }
  // Same bound as verify-otp, for the same reason: `toCanonicalUGPhone(phone)
  // || phone` below passes an unnormalisable value through verbatim, and it
  // reaches the JWT `phone` claim on the success path (review 2026-08-26 §1.3).
  // `invalid_request` here, matching THIS route's own error vocabulary.
  if (checkLen(phone, MAX_PHONE_INPUT_LEN, 'invalid_request')) {
    res.status(400).json({ code: 'invalid_request' });
    return;
  }
  if (typeof role !== 'string' || !VALID_ROLES.has(role as JwtRole)) {
    res.status(400).json({ code: 'invalid_request' });
    return;
  }
  if (typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ code: 'invalid_request' });
    return;
  }

  const typedRole = role as JwtRole;
  const canonicalPhone = toCanonicalUGPhone(phone) || phone;

  try {
    // Look up the `users` row to fetch the stored hash. Newest-wins not
    // required here because `users` has UNIQUE(phone, role) — at most one
    // row per pair, unlike `subscribers`.
    const { data: userRow, error: userLookupError } = await supabaseAdmin
      .from('users')
      .select('password_hash, role')
      .eq('phone', canonicalPhone)
      .eq('role', typedRole)
      .maybeSingle();
    if (userLookupError) {
      console.error('[verify-password] users lookup failed', userLookupError);
      // PGRST116 = "no row" from PostgREST. `.maybeSingle()` returns
      // `data: null, error: null` for no-row, so PGRST116 shouldn't fire
      // here — but if it ever does, fall through to the password_not_set
      // UX path. Any other error is a real DB failure: surface it as 500
      // `db_error` so ops can distinguish infrastructure issues from the
      // auth-failure UX code.
      if (userLookupError.code !== 'PGRST116') {
        res.status(500).json({ code: 'db_error' });
        return;
      }
    }
    const storedHash = (userRow?.password_hash as string | null | undefined) ?? null;
    if (!userRow || !storedHash) {
      // Genuine "no row matched" or "row exists but password_hash is null"
      // — these are legitimate auth-failure UX paths the frontend depends
      // on for the OTP-fallback toast. Do NOT promote these to db_error.
      res.status(401).json({ code: 'password_not_set' });
      return;
    }

    // B12 defense-in-depth: the SELECT above already filters by role, so a
    // mismatched role would normally yield `userRow === null`. Re-verify
    // anyway against the row's stored role — guards against future refactors
    // that drop the WHERE clause, mid-flight role rewrites, or any scenario
    // where a phone is enrolled under multiple roles and the wrong row leaks
    // through. Log a single warn so ops can spot probing.
    const storedRole = (userRow as { role?: unknown }).role;
    if (typeof storedRole !== 'string' || storedRole !== typedRole) {
      console.warn('[verify-password] role mismatch');
      res.status(401).json({ code: 'role_mismatch' });
      return;
    }

    const ok = await verifyPassword(password, storedHash);
    if (!ok) {
      res.status(401).json({ code: 'invalid_password' });
      return;
    }

    // Resolve the role-scoped entity ID exactly like verify-otp does — the
    // two routes share `_lib/personas.ts` so the resolution is identical.
    let entityId: string;
    let name: string | undefined;
    if (typedRole === 'subscriber') {
      const resolved = await resolveSubscriber(supabaseAdmin, canonicalPhone);
      if (resolved) {
        entityId = resolved.entityId;
        name = resolved.name;
      } else {
        entityId = ROLE_DEFAULTS.subscriber;
      }
    } else {
      const resolved = await resolveDemoPersona(
        supabaseAdmin,
        canonicalPhone,
        typedRole
      );
      entityId = resolved.entityId;
      name = resolved.name;
    }

    // Enforce deactivation AFTER the bcrypt compare above — a wrong password on
    // a deactivated account still returns 401 invalid_password; only a CORRECT
    // password on a deactivated distributor / branch / agent / employer reaches
    // here and is turned away with 403. Shared with verify-otp via
    // `_lib/entity-status.ts`; non-fatal on lookup error / missing row.
    if (await isEntityDeactivated(supabaseAdmin, typedRole, entityId)) {
      res.status(403).json(ACCOUNT_DEACTIVATED_RESPONSE);
      return;
    }

    await touchLastLogin(canonicalPhone, typedRole);

    // JWT claims + response DTO are built via the shared helpers so this
    // route and `verify-otp.ts` mint byte-identical payloads. `hasPassword`
    // is always `true` here — we just verified a non-null hash.
    const token = await signJwt(
      buildJwtClaims({
        role: typedRole,
        phone: canonicalPhone,
        entityId,
      })
    );

    res.status(200).json(
      buildAuthResponseDto({
        token,
        role: typedRole,
        phone: canonicalPhone,
        entityId,
        hasPassword: true,
        name,
      })
    );
  } catch (err) {
    console.error('[verify-password] unexpected error', err);
    // Match verify-otp's behaviour: unknown failures surface as a generic 500.
    // The status and code must agree, so use `unexpected_error` rather than the
    // 4xx `invalid_request` vocabulary reserved for client-correctable shape
    // failures (BL-39); the frontend's error map falls back to its default
    // message for unknown codes.
    res.status(500).json({ code: 'unexpected_error' });
  }
}
