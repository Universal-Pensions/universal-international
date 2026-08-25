// Canonical localStorage key for persisted signup state. Imported by
// `SignupContext` (which owns all reads/writes of the persisted blob) so the
// key lives in exactly one place.

export const SIGNUP_STORAGE_KEY = 'uganda-pensions-signup';

/**
 * Storage key for one signup FLOW.
 *
 * Both flows used to share the single key above, because `SignupProvider` is
 * mounted twice — `SignupPage.jsx` (self-signup) and
 * `agent-dashboard/pages/OnboardPage.jsx` (agent onboarding) — over the same
 * blob. An agent onboarding therefore overwrote a half-finished self-signup and
 * vice versa, and a wizard left by any route that does not call `reset()`
 * (browser Back, the shell nav rail, a mid-flow refresh) came back holding the
 * previous person's name and NIN. That is what made the demo appear to reuse
 * the same identity.
 *
 * `self` deliberately keeps the original key so existing persisted state — and
 * CLAUDE.md §4.5, which documents that key by name — stay correct.
 */
export function signupStorageKey(flow = 'self') {
  return flow === 'self' ? SIGNUP_STORAGE_KEY : `${SIGNUP_STORAGE_KEY}:${flow}`;
}
