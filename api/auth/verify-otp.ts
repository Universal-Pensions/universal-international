// POST /api/auth/verify-otp
//
// Validates `{ phone, otp, role, password? }`, resolves the role-scoped entity
// ID, and returns a signed JWT + the user payload that `AuthContext.login`
// consumes on the frontend.
//
// `users(phone, role)` write (E18 / A06-013 — see `upsertOrTouchUser` below):
// only touched when there is something worth persisting. A supplied
// `password` upserts the row (bcrypt `password_hash` stamped, the row
// created if this (phone, role) has never authenticated before — the
// signup-completion flow depends on that). Otherwise the write is
// UPDATE-only: `last_login_at` is bumped on a row that already exists (a
// seeded demo account, or one that previously set a password); no row is
// created for a phone/role this table has never seen. That is what stops the
// route planting a fresh `entity_id`-less, `password_hash`-less breadcrumb on
// every OTP sign-in — the defect that made A06-013 recurring even after
// migration `0121` pruned the rows that had already piled up.
//
// Error vocabulary preserved from src/services/auth.js `AuthError`:
//   - invalid_otp           — bad request shape (4xx). Unknown phones fall
//                             back to ROLE_DEFAULTS so the demo OTP step
//                             always succeeds.
//   - password_required /
//     password_too_short /
//     password_too_long /
//     password_too_weak     — shape errors surfaced from
//                             `validatePasswordShape` when an optional
//                             `password` is supplied. The OTP itself is
//                             still validated first; password is only
//                             checked once the rest of the request is sane.
//   - rate_limited          — out of scope for the demo
//   - locked                — out of scope for the demo

import type { VercelRequest, VercelResponse } from '@vercel/node';
import supabaseAdmin from '../_lib/supabase-admin.js';
import { signJwt, type JwtRole } from '../_lib/jwt.js';
import { toCanonicalUGPhone, MAX_PHONE_INPUT_LEN } from '../_lib/phone.js';
import { checkLen } from '../_lib/assertLen.js';
import {
  hashPassword,
  validatePasswordShape,
} from './_lib/password.js';
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

const OTP_REGEX = /^\d{6}$/;
const VALID_ROLES = new Set<JwtRole>([
  'subscriber',
  'agent',
  'branch',
  'distributor',
  'employer',
  'admin',
]);

// Sentinel thrown by `upsertOrTouchUser` when a `users` query itself fails
// (as opposed to a "no row" result). The handler catches it and returns a
// 500 `db_error` so ops can distinguish actual DB failures from the demo's
// happy-path `invalid_otp` UX code.
class DbError extends Error {
  readonly code: string | undefined;
  readonly dbMessage: string;
  constructor(supabaseError: { code?: string | null; message: string }) {
    super(supabaseError.message);
    this.name = 'DbError';
    this.code = supabaseError.code ?? undefined;
    this.dbMessage = supabaseError.message;
  }
}

/**
 * E18 / A06-013 (recurring). `users` has UNIQUE(phone, role) — one row per
 * pair — and is read by `verify-password.ts` / `change-password.ts` for
 * `password_hash`. Nothing anywhere reads `users.entity_id`: neither
 * subscriber logins (resolved via `subscribers`) nor non-subscriber logins
 * (resolved via `demo_personas`, see `_lib/personas.ts`) ever consult it —
 * migration `0121`'s own investigation reached the same conclusion when it
 * pruned the 32 entity_id-less rows that had already accumulated. Re-measured
 * live 2026-08-25: back down to 2 (both created THIS session by ordinary demo
 * OTP logins) — proof the old unconditional upsert kept refilling the table
 * exactly as the escalation describes.
 *
 * The old code called `.upsert()` unconditionally, so EVERY OTP sign-in on a
 * phone/role this table had never seen — the common case, since CLAUDE.md
 * §10a's "any 6-digit code, any phone" wildcard is the point of the demo OTP
 * route — planted a permanent, useless row (no entity_id, ever; no
 * password_hash, when none was supplied).
 *
 * Fix: only INSERT when there is something worth persisting.
 *   - A password WAS supplied → upsert as before. This must still be able to
 *     create the row (the signup-completion flow in `ContributionRoute.jsx`
 *     calls this route with the subscriber's chosen password on their very
 *     first OTP verification, before any `users` row for them exists).
 *   - No password → UPDATE-only. Bumps `last_login_at` on a row that already
 *     exists (a seeded demo account carrying CLAUDE.md §8's `Demo1234` hash,
 *     or one that previously set a password) and reads back its stored hash
 *     unchanged, so `hasPassword` and the password-login path are completely
 *     unaffected. A phone/role never seen before matches zero rows — UPDATE
 *     is a silent no-op, not an error — and no breadcrumb is left.
 */
async function upsertOrTouchUser(
  phone: string,
  role: JwtRole,
  passwordHash: string | null
): Promise<{ hasPassword: boolean }> {
  if (!passwordHash) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('phone', phone)
      .eq('role', role)
      .select('password_hash')
      .maybeSingle();
    if (error) {
      console.error('[verify-otp] users last_login_at update failed', error);
      // PGRST116 = "no row" — .maybeSingle() should return null data / null
      // error for zero matched rows rather than raise, but treat it as
      // non-fatal defensively (no row means no stored hash to report).
      if (error.code === 'PGRST116') {
        return { hasPassword: false };
      }
      throw new DbError(error);
    }
    const storedHash = (data?.password_hash as string | null | undefined) ?? null;
    return { hasPassword: Boolean(storedHash) };
  }

  // A credential IS being set — this row must exist afterwards. `id` is a
  // non-null TEXT PRIMARY KEY with no default, so the INSERT half of the
  // upsert needs us to supply one. Deriving it deterministically from (role,
  // phone) keeps the upsert idempotent across replays: the same JWT claims
  // always identify the same row. The conflict target is the (phone, role)
  // unique constraint, so an existing row's id is preserved on the UPDATE
  // half.
  const patch: Record<string, unknown> = {
    id: `${role}:${phone}`,
    phone,
    role,
    last_login_at: new Date().toISOString(),
    password_hash: passwordHash,
  };

  const { data, error } = await supabaseAdmin
    .from('users')
    .upsert(patch, { onConflict: 'phone,role' })
    .select('password_hash')
    .maybeSingle();
  if (error) {
    console.error('[verify-otp] users upsert failed', error);
    // Surface as a true DB error so ops can distinguish this from the
    // demo's auth-failure UX codes. PGRST116 = "no row" — we use
    // .maybeSingle() so it shouldn't fire here, but treat it as non-fatal
    // if it ever does (no row written means no stored hash to report).
    if (error.code === 'PGRST116') {
      return { hasPassword: Boolean(passwordHash) };
    }
    throw new DbError(error);
  }
  const storedHash = (data?.password_hash as string | null | undefined) ?? null;
  return { hasPassword: Boolean(storedHash) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // B13: every response path on this auth route must be uncacheable. Set the
  // header BEFORE the method check so even the 405 carries no-store (2a.2);
  // it also covers success + all 4xx/5xx paths (including the DbError +
  // generic-error branches in the catch).
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed' });
    return;
  }

  const body = (req.body ?? {}) as {
    phone?: unknown;
    otp?: unknown;
    role?: unknown;
    password?: unknown;
  };
  const { phone, otp, role, password } = body;

  if (typeof phone !== 'string' || phone.length === 0) {
    res.status(400).json({ code: 'invalid_otp' });
    return;
  }
  // Bound the phone BEFORE the `|| phone` fallback at the bottom of this
  // handler can pass an unnormalisable value through verbatim (review
  // 2026-08-26 §1.3). Same `checkLen` the five public write routes use.
  // Reported as `invalid_otp`, not a new code: this route's documented contract
  // is that EVERY request-shape failure surfaces `invalid_otp`, and the
  // frontend (src/services/auth.js) both maps that code to "Invalid code" and
  // defaults unknown codes to it — a new code would change the login
  // vocabulary for no gain. Placed above the otp/role guards so an oversized
  // field is rejected before any further work, and well before the Supabase
  // lookup.
  if (checkLen(phone, MAX_PHONE_INPUT_LEN, 'invalid_otp')) {
    res.status(400).json({ code: 'invalid_otp' });
    return;
  }
  if (typeof otp !== 'string' || !OTP_REGEX.test(otp)) {
    res.status(400).json({ code: 'invalid_otp' });
    return;
  }
  if (
    typeof role !== 'string' ||
    !VALID_ROLES.has(role as JwtRole)
  ) {
    res.status(400).json({ code: 'invalid_otp' });
    return;
  }
  const typedRole = role as JwtRole;

  // Optional password: only validated when the caller actually supplies one
  // (so the legacy OTP-only happy path stays untouched). Empty string is
  // treated as "not provided" — the SignUpModal can wire a single field that
  // submits `password: ''` when the user opts out of setting one.
  const passwordProvided =
    typeof password === 'string' && password.length > 0;
  if (passwordProvided) {
    const shapeError = validatePasswordShape(password);
    if (shapeError) {
      res.status(400).json({ code: shapeError });
      return;
    }
  }

  // Callers (SignInModal, signup, future surfaces) may pass the 9-digit local
  // form ('777247884'), the human-typed form ('0777 247 884'), or canonical
  // ('+256777247884'). The DB stores canonical (+256-prefixed, no spaces), so
  // any other form fails .eq() — surfaces as a misleading "Invalid code".
  // Normalize once here; an empty result means the input wasn't a valid UG
  // mobile and we treat that the same as a missing subscriber row.
  const canonicalPhone = toCanonicalUGPhone(phone) || phone;

  // Resolve the role-scoped identity. Wrapped in a local async fn so it can
  // be kicked off concurrently with bcrypt below — the two are independent
  // (the lookup hits Supabase; the hash is CPU-bound), so running them in
  // parallel hides the ~80ms bcrypt cost behind the network round-trip.
  const lookupIdentity = async (): Promise<{
    entityId: string;
    name?: string;
  }> => {
    if (typedRole === 'subscriber') {
      const resolved = await resolveSubscriber(supabaseAdmin, canonicalPhone);
      if (resolved) {
        return { entityId: resolved.entityId, name: resolved.name };
      }
      // Per CLAUDE.md §8: every demo login succeeds. Fall back to the
      // seeded `s-0001` row so a sales rep using any phone still lands on
      // a working subscriber dashboard. Same intent as the agent/branch/
      // distributor fallback below.
      return { entityId: ROLE_DEFAULTS.subscriber };
    }
    const resolved = await resolveDemoPersona(
      supabaseAdmin,
      canonicalPhone,
      typedRole
    );
    return { entityId: resolved.entityId, name: resolved.name };
  };

  try {
    // Run the identity lookup and the (optional) password hash concurrently.
    // The bcrypt cost is only paid when `passwordProvided` is true — the
    // request-shape + shape-validation guards above already short-circuited
    // every other path before reaching here, so a password-less login never
    // starts bcrypt (it resolves to `null` instead). Errors from either arm
    // reject the Promise.all and land in the catch below, exactly as the
    // previous sequential `await`s did.
    const [{ entityId, name }, passwordHash] = await Promise.all([
      lookupIdentity(),
      passwordProvided ? hashPassword(password as string) : Promise.resolve(null),
    ]);

    // Enforce deactivation: a deactivated distributor / branch / agent / employer
    // cannot authenticate (admin deactivation, migration 0060). Subscribers + admin
    // are NEVER gated. Shared with verify-password via `_lib/entity-status.ts`;
    // the lookup is non-fatal (a missing demo-fallback row must not block login).
    if (await isEntityDeactivated(supabaseAdmin, typedRole, entityId)) {
      res.status(403).json(ACCOUNT_DEACTIVATED_RESPONSE);
      return;
    }

    const { hasPassword } = await upsertOrTouchUser(
      canonicalPhone,
      typedRole,
      passwordHash
    );

    // JWT claims + response DTO are built via the shared helpers so this
    // route and `verify-password.ts` mint byte-identical payloads. See
    // `_lib/claims.ts` for the claim/role rationale.
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
        hasPassword,
        name,
      })
    );
  } catch (err) {
    // Distinguish true DB failures (Supabase non-null `error` from a query)
    // from generic unexpected errors. Ops can grep `db_error` in logs to find
    // real infrastructure issues; the demo's auth-failure UX code stays
    // reserved for shape-validation failures earlier in the handler.
    if (err instanceof DbError) {
      console.error('[verify-otp] db error', err);
      res.status(500).json({ code: 'db_error' });
      return;
    }
    console.error('[verify-otp] unexpected error', err);
    // A 500 must not borrow the 4xx `invalid_otp` vocabulary — that code is
    // reserved for client-correctable shape failures. Use a distinct
    // `unexpected_error` so the status and code agree (BL-39); the frontend's
    // error map falls back to its default message for unknown codes.
    res.status(500).json({ code: 'unexpected_error' });
  }
}
