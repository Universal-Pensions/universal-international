// E2E auth fixtures — mint HS256 JWTs and dump Playwright storageState files.
//
// We bypass the SignInModal in tests by writing the same two localStorage keys
// that AuthContext + supabaseClient use after a successful login:
//   • upensions_token → raw JWT string (services/supabaseClient.js:28 TOKEN_KEY)
//   • upensions_auth  → JSON.stringify(user) (contexts/AuthContext.jsx:32 AUTH_KEY)
//
// JWT shape matches api/_lib/jwt.ts exactly (HS256, iss=upensions, aud=authenticated,
// role='authenticated', plus app_role + role-scoped *Id claim). Secret is read
// from SUPABASE_JWT_SECRET (.env.local), same as the live API.
//
// Demo personas come from scripts/seed-supabase.mjs lines 838-844.

import { SignJWT } from 'jose';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export type Role = 'subscriber' | 'agent' | 'branch' | 'distributor' | 'employer' | 'admin';

type Persona = {
  entityId: string;
  phone: string;
  name: string;
};

// One stable persona per role. These match the fallback IDs in
// api/auth/_lib/personas.ts ROLE_DEFAULTS so a JWT minted here resolves to the
// same dashboard a sales rep would see by logging in with the demo phone.
// (audit §7b.8/§7b.9 / F2-08: employer + admin were missing — they ARE prod /
// prod-facing roles, so the harness mints all six now.)
const PERSONAS: Record<Role, Persona> = {
  subscriber: {
    entityId: 's-0001',
    phone: '+256711000001',
    name: 'Brian Okello',
  },
  agent: {
    entityId: 'a-001',
    phone: '+256700000001',
    name: 'Default agent (Kampala)',
  },
  branch: {
    entityId: 'b-kam-015',
    phone: '+256700000011',
    name: 'Default branch (Kampala Central)',
  },
  distributor: {
    entityId: 'd-001',
    phone: '+256700000021',
    name: 'Default distributor',
  },
  // Employer demo persona — EMPLOYER_DEMO_PHONE (src/data/employerSeed.js:85)
  // resolves to emp-001 via demo_personas; ROLE_DEFAULTS.employer is the same
  // fallback so the minted JWT lands on the live employer dashboard.
  employer: {
    entityId: 'emp-001',
    phone: '+256700000031',
    name: 'Default employer (Nile Breweries Demo)',
  },
  // Admin demo persona — no seeded phone (any phone + any 6-digit code logs in);
  // ROLE_DEFAULTS.admin is admin-001 (head-office, global rights).
  admin: {
    entityId: 'admin-001',
    phone: '+256700000041',
    name: 'Default admin (head office)',
  },
};

const ROLE_ID_FIELD: Record<Role, string> = {
  subscriber: 'subscriberId',
  agent: 'agentId',
  branch: 'branchId',
  distributor: 'distributorId',
  employer: 'employerId',
  admin: 'adminId',
};

const ROLES: Role[] = ['subscriber', 'agent', 'branch', 'distributor', 'employer', 'admin'];

const TWENTY_FOUR_HOURS = 60 * 60 * 24;

function getSecretBytes(): Uint8Array {
  const raw = process.env.SUPABASE_JWT_SECRET;
  if (!raw) {
    throw new Error(
      'SUPABASE_JWT_SECRET is required to mint test JWTs. Check .env.local — ' +
      'the same secret api/_lib/jwt.ts uses must be available to Playwright.'
    );
  }
  return new TextEncoder().encode(raw);
}

/**
 * Mint a raw HS256 JWT for an ARBITRARY role + entity id. The shape matches
 * api/_lib/jwt.ts exactly (iss=upensions, aud=authenticated, role='authenticated'
 * + app_role + the role-scoped *Id claim), so PostgREST `SET ROLE authenticated`
 * + the RLS policies (which read `auth.jwt() ->> 'app_role'/'<role>Id'`) treat it
 * as a genuine login for that tenant.
 *
 * Exposed for the DB specs (db/rls-isolation, db/money-idempotency) that stamp a
 * role-scoped anon client with a token for a SPECIFIC tenant — e.g. agent a-001
 * vs a-042 — to prove cross-tenant RLS isolation. The smoke/flow specs keep
 * using the storageState files; this is the lower-level primitive they share.
 */
export async function mintRoleJwt(
  role: Role,
  entityId: string,
  phone = '+256700000000',
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    sub: entityId,
    role: 'authenticated',
    app_role: role,
    phone,
    [ROLE_ID_FIELD[role]]: entityId,
  };
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('upensions')
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + TWENTY_FOUR_HOURS)
    .sign(getSecretBytes());
}

async function mintJwt(role: Role, persona: Persona): Promise<string> {
  return mintRoleJwt(role, persona.entityId, persona.phone);
}

function buildUserObject(role: Role, persona: Persona) {
  return {
    role,
    phone: persona.phone,
    name: persona.name,
    [ROLE_ID_FIELD[role]]: persona.entityId,
  };
}

function authDir(): string {
  return path.resolve(process.cwd(), 'e2e/.auth');
}

export function storageStatePathFor(role: Role): string {
  return path.join(authDir(), `${role}.json`);
}

/**
 * Mint a Playwright storageState file for `role` and write it to
 * e2e/.auth/{role}.json. Caller is responsible for ensuring the directory
 * exists (global-setup does this once up front).
 */
export async function mintStorageStateFor(role: Role, baseUrl = 'http://localhost:5173'): Promise<string> {
  const persona = PERSONAS[role];
  const token = await mintJwt(role, persona);
  const userObj = buildUserObject(role, persona);

  const storageState = {
    cookies: [] as unknown[],
    origins: [
      {
        origin: baseUrl,
        localStorage: [
          { name: 'upensions_token', value: token },
          { name: 'upensions_auth', value: JSON.stringify(userObj) },
        ],
      },
    ],
  };

  const dest = storageStatePathFor(role);
  await writeFile(dest, JSON.stringify(storageState, null, 2));
  return dest;
}

export async function mintAllStorageStates(baseUrl = 'http://localhost:5173') {
  await mkdir(authDir(), { recursive: true });
  for (const role of ROLES) {
    await mintStorageStateFor(role, baseUrl);
  }
}

export const PERSONA_FOR = PERSONAS;
