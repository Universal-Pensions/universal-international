// KYC service — wraps the `/api/kyc/*` Vercel routes. Provider behind the
// API is Smile ID (https://smileidentity.com) — chosen for Uganda because of
// its direct NIRA integration and regional coverage. Endpoints follow Smile
// ID's v2 contract; payloads include a tracking_id so the backend can
// correlate the OCR result, NIRA verification, OTP check, face-match, and
// AML/PEP screen across a single onboarding job.
//
// QA force-overrides:
//   Each stage reads its `upensions_<stage>_force` flag from `localStorage`
//   (dev-only) and forwards it as an `X-QA-Force` request header. The API
//   routes honour the header without round-tripping the value through the
//   body, which keeps the production payload clean.
//
// Rollback:
//   When `IS_SUPABASE_ENABLED` is false (set `VITE_USE_SUPABASE=false`), every
//   stage short-circuits to the legacy local mock so the prototype demo flow
//   keeps working without the API routes. The mock paths still honour the
//   same force-flags via direct localStorage reads.
//
// All exported function signatures and return shapes are preserved verbatim
// from the legacy mock so callers in `src/signup/steps/` need no changes.

import { api, IS_SUPABASE_ENABLED } from './api';
import { IS_DEV } from '../config/env';

/* ──────────────────────────────────────────────────────────────────────── */
/*  Image quality + OCR                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} QualityReport
 * @property {boolean} blur       — true when image is acceptably sharp
 * @property {boolean} corners    — true when all four card corners are in frame
 * @property {boolean} glare      — true when no blown-out highlights are detected
 * @property {boolean} pass       — true iff all individual checks passed
 * @property {number}  score      — 0–1 composite score for QA logging
 */

/**
 * @endpoint POST /api/kyc/id-quality
 * @param {File|Blob} file
 * @returns {Promise<QualityReport>}
 * @description Client-side guard rail. Real provider runs the same checks
 *   server-side before it commits OCR credits. The API route uses the same
 *   pass/fail logic and respects the `X-QA-Force` header.
 * @scope Public.
 */
export async function assessImageQuality(file) {
  if (!IS_SUPABASE_ENABLED) return mockAssessImageQuality(file);
  // The route can't see the raw blob (we POST a JSON envelope, not multipart),
  // so the legacy <20 KiB file-size heuristic is enforced client-side before
  // we waste a round-trip.
  if (file && file.size && file.size < 20 * 1024) {
    return buildQuality({ blur: false });
  }
  return api.post(
    '/kyc/id-quality',
    { fileSize: file?.size ?? null, mime: file?.type ?? null },
    { headers: qaForceHeader('id_quality') },
  );
}

/**
 * @typedef {Object} IdExtraction
 * @property {string} fullName
 * @property {string} nin            — 14-char Uganda NIN (CM/CF + 12 chars)
 * @property {string} cardNumber     — 9-char card number
 * @property {string} dob            — ISO date YYYY-MM-DD
 * @property {'male'|'female'} gender
 * @property {string} barcodeRaw     — raw 2D-barcode decode from the back
 * @property {number} confidence     — 0–1 composite OCR+barcode confidence
 *
 * Note: district is deliberately NOT on the IdExtraction. Ugandan National
 * IDs don't carry a district — the user picks it manually on ReviewStep.
 */

/**
 * @endpoint POST /api/kyc/id-ocr
 * @param {{ front: File|Blob, back: File|Blob, sessionId?: string }} payload
 * @returns {Promise<IdExtraction>}
 * @description Runs Smile ID Document Verification on BOTH sides. OCR reads
 *   printed fields from the front; barcode decoder reads the PDF417 on the back
 *   and cross-checks the printed fields against the encoded record. Confidence
 *   reflects both OCR and barcode agreement.
 * @scope Public.
 */
export async function extractIdFields(payload) {
  if (!IS_SUPABASE_ENABLED) return mockExtractIdFields(payload);
  if (!payload?.front || !payload?.back) {
    throw new Error('Both sides of the ID are required.');
  }
  // The route accepts an envelope with truthy front/back tokens — replace with
  // a real multipart upload once Smile ID's signed-upload endpoint is wired.
  return api.post(
    '/kyc/id-ocr',
    {
      front: payload.front?.name ?? 'front',
      back: payload.back?.name ?? 'back',
      sessionId: payload.sessionId,
    },
    { headers: qaForceHeader('id_ocr') },
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  NIRA verification                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} NiraResult
 * @property {'match'|'partial'|'no-match'} result
 * @property {string[]} [mismatchedFields]
 * @property {string}   [reason]
 * @property {string}   trackingId
 */

/**
 * @endpoint POST /api/kyc/nira-verify
 * @param {{ nin: string, cardNumber: string, dob: string, fullName: string, sessionId?: string }} payload
 * @returns {Promise<NiraResult>}
 */
export async function verifyNira(payload) {
  if (!IS_SUPABASE_ENABLED) return mockVerifyNira(payload);
  return api.post('/kyc/nira-verify', payload, { headers: qaForceHeader('nira') });
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  SMS OTP                                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * @endpoint POST /api/kyc/otp-send
 * @param {{ phone: string }} payload
 * @returns {Promise<{ success: boolean, expiresIn: number }>}
 * @description Sends a 4-digit OTP via SMS. Cooldown enforced server-side too.
 *   Distinct from /api/auth/send-otp — this is the KYC-stage OTP.
 * @scope Public.
 */
export async function sendOtp(payload) {
  if (!IS_SUPABASE_ENABLED) return mockSendOtp(payload);
  return api.post('/kyc/otp-send', payload, { headers: qaForceHeader('otp_send') });
}

/**
 * @endpoint POST /api/kyc/otp-verify
 * @param {{ phone: string, code: string }} payload
 * @returns {Promise<{ verified: boolean }>}
 */
export async function verifyOtp(payload) {
  if (!IS_SUPABASE_ENABLED) return mockVerifyOtp(payload);
  return api.post('/kyc/otp-verify', payload, { headers: qaForceHeader('otp') });
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Face match + liveness                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} FaceMatchResult
 * @property {boolean} match
 * @property {boolean} liveness
 * @property {number}  matchScore
 * @property {'ok'|'liveness-fail'|'no-match'} outcome
 * @property {string}  trackingId
 */

/**
 * @endpoint POST /api/kyc/face-match
 * @param {{ selfieFile: File|Blob, nin: string, sessionId?: string }} payload
 * @returns {Promise<FaceMatchResult>}
 */
export async function faceMatch(payload) {
  // Defensive client-side check — a missing selfie blob means localStorage
  // rehydration dropped the file. Surface a clear error rather than calling
  // the backend with null, regardless of feature-flag state.
  if (!payload?.selfieFile) {
    throw new Error('Selfie image is missing — please retake.');
  }
  if (!IS_SUPABASE_ENABLED) return mockFaceMatch(payload);
  // We POST a JSON envelope, not multipart — the route checks for a truthy
  // selfie token. Real provider hookup will swap this for a signed multipart
  // upload.
  return api.post(
    '/kyc/face-match',
    {
      selfieFile: payload.selfieFile?.name ?? 'selfie',
      nin: payload.nin,
      sessionId: payload.sessionId,
    },
    { headers: qaForceHeader('face') },
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  AML + PEP screening                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} AmlResult
 * @property {'clear'|'flagged'} outcome
 * @property {string} trackingId
 */

/**
 * @endpoint POST /api/kyc/aml-screen
 * @param {{ fullName: string, dob: string, nin: string, sessionId?: string }} payload
 * @returns {Promise<AmlResult>}
 * @description AML sanction-list + PEP screening via Smile ID's compliance API.
 *   Flagged users are routed to back-office review; they do not see the reason.
 * @scope Public — onboarding only.
 */
export async function screenAml(payload) {
  if (!IS_SUPABASE_ENABLED) return mockScreenAml(payload);
  return api.post('/kyc/aml-screen', payload, { headers: qaForceHeader('aml') });
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Agent fallback                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * @endpoint POST /api/kyc/agent-referral
 * @param {{ phone: string, reason: string, stage?: string, trackingId?: string, sessionId?: string }} payload
 * @returns {Promise<{ ticketId: string, eta: string }>}
 */
export async function referToAgent(payload) {
  if (!IS_SUPABASE_ENABLED) return mockReferToAgent(payload);
  return api.post('/kyc/agent-referral', payload);
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Read the dev-only QA force flag from localStorage and return it as a header
 * envelope suitable for `api.post`'s `{ headers }` option, or `undefined` if
 * the flag isn't set / we're not in dev / there's no `window`.
 *
 * The stage-key suffix maps to the same `upensions_<stage>_force` keys the
 * legacy mock used (e.g. `upensions_nira_force`).
 */
function qaForceHeader(stageKey) {
  if (!IS_DEV) return undefined;
  if (typeof window === 'undefined') return undefined;
  try {
    const v = window.localStorage.getItem(`upensions_${stageKey}_force`);
    return v ? { 'X-QA-Force': v } : undefined;
  } catch {
    return undefined;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockTrackingId() {
  return `smile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Seeded identity mint (duplicated in api/kyc/id-ocr.ts) ─────────────────
 * `mockExtractIdFields` below used to return one fixed identity forever,
 * which collided with the UNIQUE index on subscribers.nin the moment a demo
 * agent onboarded a SECOND subscriber (audit A11-002). This mints a fresh,
 * internally-consistent identity per call, deterministically seeded off the
 * caller's `sessionId` — the same reasoning as the API route, whose header
 * comment (api/kyc/id-ocr.ts) explains the seeding choice in full. Kept as a
 * full duplicate here rather than imported: `.vercelignore` strips `api/`
 * from the Vercel source upload, so an `api/` <-> `src/` import compiles
 * locally and in CI but breaks only at the production deploy — see
 * `api/auth/_lib/password.ts`'s "Never imported from src/" convention and
 * `mockTrackingId` just above, which is the same duplicate-not-shared
 * pattern for a different mock field. Name pools mirror
 * `src/data/mockData.js`'s FIRST_NAMES_M/FIRST_NAMES_F/LAST_NAMES (private
 * to that module, so copied rather than imported).
 */

const OCR_FIRST_NAMES_M = ['James', 'Robert', 'David', 'Joseph', 'Samuel', 'Peter', 'John', 'Moses', 'Isaac', 'Patrick', 'Ronald', 'Brian', 'Denis', 'Frank', 'Henry', 'Richard', 'Charles', 'Emmanuel', 'Gerald', 'Andrew'];
const OCR_FIRST_NAMES_F = ['Grace', 'Sarah', 'Agnes', 'Mary', 'Rose', 'Esther', 'Florence', 'Janet', 'Rebecca', 'Judith', 'Harriet', 'Dorothy', 'Irene', 'Beatrice', 'Prossy', 'Lillian', 'Carol', 'Diana', 'Annet', 'Brenda'];
const OCR_LAST_NAMES = ['Okello', 'Namubiru', 'Mugisha', 'Kabuye', 'Ssempala', 'Atuhaire', 'Owori', 'Nankya', 'Tumusiime', 'Byaruhanga', 'Namutebi', 'Kisakye', 'Obua', 'Drazu', 'Akello', 'Okiror', 'Natukunda', 'Musinguzi', 'Katusiime', 'Babirye', 'Nsubuga', 'Kasozi', 'Lubega', 'Kato', 'Wasswa', 'Nakato', 'Kiiza', 'Asiimwe', 'Mwesigwa', 'Arinaitwe'];
const OCR_NIN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// FNV-1a 32-bit — turns the sessionId string into a numeric seed.
function ocrSeedFromString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — small deterministic PRNG. Same seed -> same output stream
// every time, i.e. "stable across retries" for a given sessionId.
function ocrMulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function ocrRandInt(rand, n) {
  return Math.floor(rand() * n);
}

function ocrPick(rand, arr) {
  return arr[ocrRandInt(rand, arr.length)];
}

function ocrPad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Mint a full {@link IdExtraction}-shaped identity, seeded off `sessionId` so
 * the SAME identity comes back across a same-attempt retry but a DIFFERENT
 * one for every new onboarding session. Only `nin` must be unique per call
 * (ux_subscribers_nin) — the other fields vary too, for realism.
 */
function mintIdExtraction(sessionId) {
  // No sessionId isn't the production path (ReviewStep always sends
  // signup.onboardingSessionId), but stay safe rather than colliding every
  // caller that somehow omits it onto one shared identity.
  const seedInput = typeof sessionId === 'string' && sessionId
    ? sessionId
    : `no-session-${Math.random()}`;
  const rand = ocrMulberry32(ocrSeedFromString(seedInput));

  const gender = rand() < 0.5 ? 'male' : 'female';
  const firstName = ocrPick(rand, gender === 'female' ? OCR_FIRST_NAMES_F : OCR_FIRST_NAMES_M);
  const lastName = ocrPick(rand, OCR_LAST_NAMES);
  // Third name token, used only in the barcode's SURNAME,GIVEN,OTHER slot —
  // Ugandan IDs commonly carry a clan/"other" name distinct from the two
  // printed on the front.
  const otherName = ocrPick(rand, OCR_LAST_NAMES);
  const fullName = `${firstName} ${lastName}`;

  // NIN: 'C' + M/F (MUST track gender — ReviewStep.jsx's NIN_RE requires it;
  // 'other' has no valid prefix and must never be minted) + 12 alphanumeric
  // chars. The only field that MUST be unique per call.
  let ninSuffix = '';
  for (let i = 0; i < 12; i++) ninSuffix += OCR_NIN_CHARS[ocrRandInt(rand, OCR_NIN_CHARS.length)];
  const nin = `C${gender === 'male' ? 'M' : 'F'}${ninSuffix}`;

  // Card number: 'UG' + 7 digits, mirrors the old fixed 'UG7412903' shape.
  let cardDigits = '';
  for (let i = 0; i < 7; i++) cardDigits += String(ocrRandInt(rand, 10));
  const cardNumber = `UG${cardDigits}`;

  // DOB: a birth-YEAR OFFSET against *today*, not a fixed calendar date, so
  // the minted age can never age out of the [18,100] window ReviewStep.jsx
  // and 0002_rpc_functions.sql both enforce.
  const today = new Date();
  const ageYears = 22 + ocrRandInt(rand, 40); // 22..61
  const birthYear = today.getUTCFullYear() - ageYears;
  const birthMonth = 1 + ocrRandInt(rand, 12);
  const birthDay = 1 + ocrRandInt(rand, 28); // avoid month-length edge cases
  const dob = `${birthYear}-${ocrPad2(birthMonth)}-${ocrPad2(birthDay)}`;

  // Real format: NIN|cardNumber|dob|SURNAME,GIVEN,OTHER.
  const barcodeRaw = `${nin}|${cardNumber}|${dob}|${lastName.toUpperCase()},${firstName.toUpperCase()},${otherName.toUpperCase()}`;

  return { fullName, nin, cardNumber, dob, gender, barcodeRaw, confidence: 0.94 };
}

function readForced(key) {
  // QA force-overrides only apply in development. In production these keys are
  // ignored so a user with devtools cannot bypass any KYC stage.
  if (!IS_DEV) return null;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function buildQuality({ blur = true, corners = true, glare = true }) {
  const pass = blur && corners && glare;
  const score = [blur, corners, glare].filter(Boolean).length / 3;
  return { blur, corners, glare, pass, score };
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Rollback mocks (used when IS_SUPABASE_ENABLED === false)                */
/* ──────────────────────────────────────────────────────────────────────── */

async function mockAssessImageQuality(file) {
  await delay(900);
  const forced = readForced('upensions_id_quality_force');
  if (forced === 'fail-blur') return buildQuality({ blur: false });
  if (forced === 'fail-corners') return buildQuality({ corners: false });
  if (forced === 'fail-glare') return buildQuality({ glare: false });
  if (file && file.size && file.size < 20 * 1024) return buildQuality({ blur: false });
  return buildQuality({});
}

async function mockExtractIdFields(payload) {
  await delay(2200);
  if (!payload?.front || !payload?.back) {
    throw new Error('Both sides of the ID are required.');
  }
  return mintIdExtraction(payload?.sessionId);
}

async function mockVerifyNira(payload) {
  void payload;
  await delay(2400);
  const forced = readForced('upensions_nira_force');
  const result = forced || 'match';
  if (result === 'partial') {
    return {
      result: 'partial',
      mismatchedFields: ['dob'],
      reason:
        'DOB differs from NIRA record by a day — flagged for back-office review.',
      trackingId: mockTrackingId(),
    };
  }
  if (result === 'no-match') {
    return {
      result: 'no-match',
      reason:
        'NIRA could not confirm your identity from the card details provided.',
      trackingId: mockTrackingId(),
    };
  }
  return { result: 'match', trackingId: mockTrackingId() };
}

async function mockSendOtp(payload) {
  void payload;
  await delay(600);
  return { success: true, expiresIn: 300 };
}

async function mockVerifyOtp(payload) {
  await delay(900);
  const forced = readForced('upensions_otp_force');
  if (forced === 'fail') return { verified: false };
  if (!payload?.code || payload.code.length !== 4) return { verified: false };
  if (payload.code === '0000') return { verified: false };
  return { verified: true };
}

async function mockFaceMatch(payload) {
  void payload;
  await delay(2200);
  const forced = readForced('upensions_face_force');
  const outcome = forced || 'ok';
  if (outcome === 'liveness-fail') {
    return { match: false, liveness: false, matchScore: 0, outcome, trackingId: mockTrackingId() };
  }
  if (outcome === 'no-match') {
    return { match: false, liveness: true, matchScore: 0.42, outcome, trackingId: mockTrackingId() };
  }
  return { match: true, liveness: true, matchScore: 0.97, outcome: 'ok', trackingId: mockTrackingId() };
}

async function mockScreenAml(payload) {
  void payload;
  await delay(1700);
  const forced = readForced('upensions_aml_force');
  if (forced === 'flagged') {
    return { outcome: 'flagged', trackingId: mockTrackingId() };
  }
  return { outcome: 'clear', trackingId: mockTrackingId() };
}

async function mockReferToAgent(payload) {
  void payload;
  await delay(600);
  return {
    ticketId: `UAG-${Date.now().toString(36).toUpperCase()}`,
    eta: 'within 24 hours',
  };
}
