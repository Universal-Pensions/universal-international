// resolveResumeStep — where a refresh rehydrates the signup wizard.
//
// Persists wizard position (BL-22) but clamps back to the first resume gate
// (id-upload / review-password / liveness) whose ephemeral result didn't survive
// the refresh, so the user can't resume past a gate they never actually cleared.
// A gate whose outcome persisted (idConfidence / password / faceMatchOutcome)
// isn't re-walked. Unknown/terminal stepId restarts at id-upload.

import { describe, it, expect } from 'vitest';
import { resolveResumeStep } from '../SignupPage';

// A fully-cleared late-stage snapshot: both file outcomes + the password survived.
const cleared = (stepId) => ({ stepId, idConfidence: 0.9, faceMatchOutcome: 'ok', password: 'Secret123' });

describe('resolveResumeStep', () => {
  it('restarts at id-upload for an unknown / terminal stepId', () => {
    expect(resolveResumeStep({ stepId: 'agent' })).toBe('id-upload');
    expect(resolveResumeStep({ stepId: undefined })).toBe('id-upload');
    expect(resolveResumeStep({})).toBe('id-upload');
  });

  it('clamps to id-upload when its OCR outcome did not survive', () => {
    expect(resolveResumeStep({ stepId: 'review' })).toBe('id-upload');
    expect(resolveResumeStep({ stepId: 'nira' })).toBe('id-upload');
  });

  it('resumes at review once the id-upload OCR outcome persisted (still needs the password)', () => {
    expect(resolveResumeStep({ stepId: 'review', idConfidence: 0.9 })).toBe('review');
  });

  it('clamps to liveness when its face-match outcome did not survive', () => {
    // id + password cleared, past liveness, but no faceMatchOutcome → re-walk liveness.
    expect(resolveResumeStep({ stepId: 'aml', idConfidence: 0.9, password: 'p' })).toBe('liveness');
  });

  it('resumes at a late step once ALL gates cleared', () => {
    expect(resolveResumeStep(cleared('beneficiaries'))).toBe('beneficiaries');
    expect(resolveResumeStep(cleared('consent'))).toBe('consent');
  });

  // ── Password resume-gate (the audit-remediation fix) ──────────────────────
  it('clamps a past-Review step back to Review when the ephemeral password was lost', () => {
    // File outcomes survived a refresh but the in-memory password did not.
    expect(resolveResumeStep({ stepId: 'consent', idConfidence: 0.9, faceMatchOutcome: 'ok' })).toBe('review');
    expect(resolveResumeStep({ stepId: 'beneficiaries', idConfidence: 0.9, faceMatchOutcome: 'ok' })).toBe('review');
    expect(resolveResumeStep({ stepId: 'otp', idConfidence: 0.9 })).toBe('review');
  });

  it('prefers the EARLIER unsatisfied gate (id-upload before the password gate)', () => {
    // Neither id-upload nor the password survived → re-do id-upload first.
    expect(resolveResumeStep({ stepId: 'consent' })).toBe('id-upload');
  });

  it('does not clamp for the password when the target sits before Review', () => {
    // On id-upload with nothing cleared → its own gate returns id-upload (the
    // password gate at Review sits AFTER the target, so it never triggers here).
    expect(resolveResumeStep({ stepId: 'id-upload' })).toBe('id-upload');
  });
});
