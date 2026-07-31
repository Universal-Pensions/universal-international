// Shared test-data constants for the subscriber signup walkthrough.
// Extracted from `e2e/helpers/signup.ts` (Cleanup Phase 3, T8) so the fixture
// values are named, documented, and discoverable in one place — and so that a
// future schema/regex tweak (NIN format, OTP length, occupation enum) lands as
// a one-line constant change rather than a grep across the helper body.
//
// CONVENTION
// ==========
// • Every value here is hand-tuned to satisfy a specific client-side validator
//   or DB constraint. Each constant carries a comment naming the source.
// • Only the signup helper imports from this module. Spec files that need
//   bespoke test data continue to inline it — these constants encode the
//   *happy-path* walkthrough only.
// • Keep this file pure data — no Playwright `Page` / `Locator` references,
//   no buffer construction. Buffer factories belong in `signup.ts`.

/**
 * 4-digit OTP accepted by the signup wizard's mocked verify-otp route
 * (`api/kyc/otp-verify.ts:29`). Note the signup wizard uses 4-digit codes
 * whereas the sign-in flow uses 6-digit codes — this constant is the
 * signup-wizard variant only. `'0000'` is deliberately rejected to mimic a
 * typo, so we use `'1234'` for the happy path.
 */
export const SIGNUP_OTP_CODE = '1234';

/**
 * Uganda mobile-number carrier prefix prepended to the 9-digit local phone
 * built by the flow specs. `'71'` is one of the valid carrier prefixes per
 * `src/utils/phone.js` VALID_PREFIXES, and matches the seeded
 * `+25671XXXXXXX` demo range — the generated phones use a Date.now() suffix
 * + worker-index modulo so reruns and parallel workers never collide with
 * the seed range or each other. Unified across both flow specs so the
 * phone-pool calculus is single-sourced.
 */
export const PHONE_PREFIX = '71';

/**
 * NIN prefix used to build a per-run unique National ID Number. The full
 * format is `^C[MF][A-Z0-9]{12}$` (14 chars total — see ReviewStep.jsx:10).
 * The helper composes `{PREFIX}{phoneDigits}{SUFFIX}` so parallel runs don't
 * collide on the partial unique index `ux_subscribers_nin` (migration 0017).
 */
export const NIN_PREFIX = 'CF';

/**
 * NIN suffix appended after the prefix + 9-digit phone to land at the 14-char
 * total length required by the format regex above. With prefix `'CF'` (2) +
 * 9-digit phone + `'ABC'` (3) = 14 chars.
 */
export const NIN_SUFFIX = 'ABC';

/**
 * District selected during ReviewStep. `'Kampala'` is sourced from
 * `mockGeo.js` (id `'d-kampala'`) and is also seeded in the `districts`
 * table so the RPC's FK lookup at `create_subscriber_from_signup` time
 * passes for the demo seed.
 */
export const SIGNUP_DISTRICT = 'Kampala';

/**
 * Occupation enum value selected during ReviewStep. `'farmer'` matches one of
 * the demo-seed enums on the `subscribers.occupation` column and renders
 * without requiring any "Other (specify)" follow-up input.
 */
export const SIGNUP_OCCUPATION = 'farmer';

/**
 * Beneficiary full name typed into the BeneficiariesStep. Intentionally
 * generic ("Test Nominee") so DB cleanups can't accidentally match a real
 * seeded subscriber, and so the value is obviously test-generated when
 * reading server logs.
 */
export const BENEFICIARY_NAME = 'Test Nominee';

/**
 * Beneficiary 9-digit local phone. Distinct from the test subscriber's own
 * phone (which is generated per-run from `Date.now()`) so the nominees row
 * carries a different phone column even on parallel runs.
 */
export const BENEFICIARY_PHONE = '700111222';

/**
 * Beneficiary relationship enum value. `'spouse'` is one of the
 * `nominees.relationship` enum values accepted by
 * `create_subscriber_from_signup`.
 */
export const BENEFICIARY_RELATIONSHIP = 'spouse';

/**
 * Filename used when uploading both sides of the ID document. The actual
 * bytes are a stub buffer constructed in the helper — only the filename and
 * mime type travel via this constant.
 */
export const ID_UPLOAD_FILENAME = 'id.jpg';

/**
 * MIME type sent with the ID upload. Must be `image/jpeg` (or another
 * accepted image MIME) so the `IdUploadStep` client-side type filter passes.
 */
export const ID_UPLOAD_MIMETYPE = 'image/jpeg';

/**
 * ID upload payload size in bytes. Must exceed the 20 KiB client-side
 * minimum enforced by `services/kyc.js:53`'s `mockAssessImageQuality`;
 * 32 KiB is comfortably above the floor.
 */
export const ID_UPLOAD_BYTES = 32 * 1024;

/**
 * Contribution onboarding "quick amount" chip label tapped on page 1 of the
 * Plan & pay wizard. The amount lands as a `transactions.amount` row of 20,000
 * UGX (20 units at the hardcoded 1,000 UGX/unit demo price).
 *
 * MUST be a preset of the wizard's DEFAULT frequency (monthly). The quick amounts
 * are frequency-tuned via `PRESETS_BY_FREQUENCY` / `presetsForFrequency`
 * (src/constants/savings.js) and monthly starts at 20,000 — the previous value
 * here, 'UGX 10,000', is a WEEKLY/DAILY preset and rendered no chip at all.
 */
export const QUICK_CONTRIBUTION_LABEL = 'UGX 20,000';
/** The numeric value of QUICK_CONTRIBUTION_LABEL, for DB assertions. */
export const QUICK_CONTRIBUTION_AMOUNT = 20_000;
