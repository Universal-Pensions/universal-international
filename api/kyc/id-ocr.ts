// POST /api/kyc/id-ocr
//
// Public route. Mirrors `extractIdFields` in src/services/kyc.js.
// Stateless mock — no database, no auth header. Returns an IdExtraction.
//
// Real flow (Smile ID Document Verification): OCR reads printed fields from
// the front of the Uganda National ID; the barcode decoder reads the PDF417
// on the back and cross-checks both. Confidence reflects OCR + barcode
// agreement.
//
// This stub MINTS a fresh identity per call (see IDENTITY MINTING below) —
// it used to return one fixed sample subscriber forever, which collided with
// the UNIQUE index on subscribers.nin the moment a demo agent onboarded a
// SECOND subscriber (audit A11-002): the create RPC 409'd, permanently,
// because the "winning" row already existed on the agent's own book.
// ~2200ms simulated latency.
//
// IDENTITY MINTING
//   Every field (name, NIN, card number, DOB, gender, barcode) is derived
//   from a tiny seeded PRNG keyed on the request's `sessionId` — SignupContext
//   mints a fresh id per onboarding attempt and rotates it on reset (see
//   src/signup/SignupContext.jsx). Seeding off sessionId, and NOT off
//   Date.now()/Math.random(), buys two things:
//     1. The SAME identity comes back every time this stage retries within
//        one attempt — "Try again" replays the identical sessionId, and must
//        NOT mint a second person out from under the rest of the wizard.
//     2. It's immune to a frozen/mocked clock (id-ocr.test.ts runs under
//        vi.useFakeTimers()) since nothing here reads the clock for
//        randomness — only `nin` needs to be unique per call
//        (ux_subscribers_nin is the only relevant constraint;
//        _insert_subscriber_chain always stamps is_demo_signup = TRUE, so
//        the phone partial-unique index never fires from this path). The
//        other fields vary too, for realism, but nothing downstream
//        requires that.
//
// DUPLICATED, NOT SHARED: `src/services/kyc.js`'s `mockExtractIdFields` mints
// identities with the same logic. `.vercelignore` strips `api/` from the
// Vercel source upload, so an `api/` <-> `src/` import would pass
// `npm run build` and CI but break only at the production Vercel deploy —
// same reasoning documented at `api/auth/_lib/password.ts` ("Never imported
// from src/") and why `api/kyc/_lib/mocks.ts`'s `mockTrackingId` is
// duplicated verbatim in kyc.js rather than imported. Keep the two identity
// mints behaviourally identical.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SIMULATED_LATENCY_MS = 2200;

/* ── Seeded identity mint (duplicated in src/services/kyc.js) ───────────────
 * Name pools mirror src/data/mockData.js's FIRST_NAMES_M/FIRST_NAMES_F/
 * LAST_NAMES (module-private there, so copied rather than imported — see the
 * duplication note above). */

const FIRST_NAMES_M = ['James', 'Robert', 'David', 'Joseph', 'Samuel', 'Peter', 'John', 'Moses', 'Isaac', 'Patrick', 'Ronald', 'Brian', 'Denis', 'Frank', 'Henry', 'Richard', 'Charles', 'Emmanuel', 'Gerald', 'Andrew'];
const FIRST_NAMES_F = ['Grace', 'Sarah', 'Agnes', 'Mary', 'Rose', 'Esther', 'Florence', 'Janet', 'Rebecca', 'Judith', 'Harriet', 'Dorothy', 'Irene', 'Beatrice', 'Prossy', 'Lillian', 'Carol', 'Diana', 'Annet', 'Brenda'];
const LAST_NAMES = ['Okello', 'Namubiru', 'Mugisha', 'Kabuye', 'Ssempala', 'Atuhaire', 'Owori', 'Nankya', 'Tumusiime', 'Byaruhanga', 'Namutebi', 'Kisakye', 'Obua', 'Drazu', 'Akello', 'Okiror', 'Natukunda', 'Musinguzi', 'Katusiime', 'Babirye', 'Nsubuga', 'Kasozi', 'Lubega', 'Kato', 'Wasswa', 'Nakato', 'Kiiza', 'Asiimwe', 'Mwesigwa', 'Arinaitwe'];
const NIN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// FNV-1a 32-bit — turns the sessionId string into a numeric seed.
function seedFromString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — small deterministic PRNG. Same seed -> same output stream
// every time, which is exactly "stable across retries" for a given sessionId.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, n: number): number {
  return Math.floor(rand() * n);
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[randInt(rand, arr.length)];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

type IdExtraction = {
  fullName: string;
  nin: string;
  cardNumber: string;
  dob: string;
  gender: 'male' | 'female';
  barcodeRaw: string;
  confidence: number;
};

function mintIdentity(sessionId: unknown): IdExtraction {
  // No sessionId isn't the production path (ReviewStep always sends
  // signup.onboardingSessionId), but stay safe rather than colliding every
  // caller that somehow omits it onto one shared identity.
  const seedInput = typeof sessionId === 'string' && sessionId
    ? sessionId
    : `no-session-${Math.random()}`;
  const rand = mulberry32(seedFromString(seedInput));

  const gender: 'male' | 'female' = rand() < 0.5 ? 'male' : 'female';
  const firstName = pick(rand, gender === 'female' ? FIRST_NAMES_F : FIRST_NAMES_M);
  const lastName = pick(rand, LAST_NAMES);
  // Third name token, used only in the barcode's SURNAME,GIVEN,OTHER slot —
  // Ugandan IDs commonly carry a clan/"other" name distinct from the two
  // printed on the front.
  const otherName = pick(rand, LAST_NAMES);
  const fullName = `${firstName} ${lastName}`;

  // NIN: 'C' + M/F (MUST track gender — ReviewStep.jsx's NIN_RE requires it,
  // and 'other' has no prefix so gender is never minted as 'other') + 12
  // alphanumeric chars. The only field that MUST be unique per call
  // (ux_subscribers_nin) — 36^12 possibilities keyed off a UUID sessionId
  // makes a same-session collision practically impossible.
  let ninSuffix = '';
  for (let i = 0; i < 12; i++) ninSuffix += NIN_CHARS[randInt(rand, NIN_CHARS.length)];
  const nin = `C${gender === 'male' ? 'M' : 'F'}${ninSuffix}`;

  // Card number: 'UG' + 7 digits, mirrors the old fixed 'UG7412903' shape
  // (9 chars — comfortably clears the >=7 gate at ReviewStep.jsx:174).
  let cardDigits = '';
  for (let i = 0; i < 7; i++) cardDigits += String(randInt(rand, 10));
  const cardNumber = `UG${cardDigits}`;

  // DOB: a birth-YEAR OFFSET against *today*, not a fixed calendar date, so
  // the minted age can never "age out" of the [18,100] window ReviewStep.jsx
  // and 0002_rpc_functions.sql both enforce — it's always computed relative
  // to whenever this handler actually runs. 22..61 sits comfortably inside
  // that window with margin on both sides.
  const today = new Date();
  const ageYears = 22 + randInt(rand, 40); // 22..61
  const birthYear = today.getUTCFullYear() - ageYears;
  const birthMonth = 1 + randInt(rand, 12);
  const birthDay = 1 + randInt(rand, 28); // avoid month-length edge cases
  const dob = `${birthYear}-${pad2(birthMonth)}-${pad2(birthDay)}`;

  // Real format: NIN|cardNumber|dob|SURNAME,GIVEN,OTHER — cross-checkable
  // against the printed fields, same as the JSDoc above describes.
  const barcodeRaw = `${nin}|${cardNumber}|${dob}|${lastName.toUpperCase()},${firstName.toUpperCase()},${otherName.toUpperCase()}`;

  return { fullName, nin, cardNumber, dob, gender, barcodeRaw, confidence: 0.94 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set once at the top so every response path (success + 4xx + 405) is
  // uncacheable. This route returns identity PII (name, NIN, DOB) and must
  // never be cached — same contract as agent-referral.ts (B13).
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: 'method_not_allowed' });
  }

  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));

  // The body envelope is { front: <token>, back: <token>, sessionId?: string }.
  // In the real provider, `front` and `back` would be multipart uploads; here
  // we accept any truthy values as proof that both sides were captured.
  const body = (req.body ?? {}) as { front?: unknown; back?: unknown; sessionId?: unknown };

  if (!body.front || !body.back) {
    return res
      .status(400)
      .json({ code: 'id_sides_required' });
  }

  // Note: Ugandan National IDs don't carry a district. The user always picks
  // it manually on ReviewStep, so we deliberately omit it from the OCR
  // response — otherwise the "Auto-filled" badge would appear on a value the
  // ID never actually contained.
  return res.status(200).json(mintIdentity(body.sessionId));
}
