// ReviewStep — a finished attempt must not replay its person into the next one.
//
// THE BUG. The OCR effect was gated on `if (signup.idConfidence != null) return`
// alone, and the apply step only backfills EMPTY fields
// (`fullName: signup.fullName || result.fullName`). Every exit that does not
// call reset() — browser Back, the shell nav rail, a mid-flow refresh — left a
// spent OCR result in localStorage, so the NEXT attempt skipped the scan
// entirely and reused the previous person's name and NIN.
//
// Compounding it, SignupProvider is mounted twice (SignupPage and the agent
// OnboardPage) and both used ONE localStorage blob, so the two wizards
// overwrote each other.
//
// The guard's good half has to survive: a refresh WITHIN one attempt must NOT
// re-scan, or the wizard would swap the person mid-flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SignupProvider } from '../../SignupContext';
import { signupStorageKey, SIGNUP_STORAGE_KEY } from '../../signupState';
import ReviewStep from '../ReviewStep';

vi.mock('../../../hooks/useEntity', () => ({
  useAllEntities: () => ({ data: [{ id: 'd-1', name: 'Kampala' }] }),
}));

const extractIdFields = vi.fn();
vi.mock('../../../services/kyc', () => ({
  extractIdFields: (...args) => extractIdFields(...args),
}));

const OCR_OK = {
  fullName: 'Asha Namuli',
  nin: 'CF1234567890AB',
  cardNumber: 'ABC123456789',
  dob: '1990-01-01',
  gender: 'female',
  barcodeRaw: 'raw',
  confidence: 0.95,
};

function renderStep(flow = 'self') {
  return render(
    <SignupProvider flow={flow}>
      <ReviewStep onNext={() => {}} />
    </SignupProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  extractIdFields.mockReset();
  extractIdFields.mockResolvedValue(OCR_OK);
});

describe('ReviewStep — stale identity replay', () => {
  it('re-scans when the persisted result belongs to a PREVIOUS attempt', async () => {
    // A spent result with no idCapturedSessionId — exactly what every blob
    // written before this fix looks like.
    localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({
      onboardingSessionId: 'session-OLD',
      fullName: 'Someone Previous',
      nin: 'CM9999999999ZZ',
      idConfidence: 0.94,
    }));

    const { unmount } = renderStep();
    await waitFor(() => expect(screen.getByText('Check your details')).toBeTruthy());

    // Without the session comparison this is 0 — the wizard would have shown
    // "Someone Previous" to the next person in the queue.
    expect(extractIdFields).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does NOT re-scan on a refresh WITHIN the same attempt', async () => {
    localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({
      onboardingSessionId: 'session-SAME',
      idCapturedSessionId: 'session-SAME',
      fullName: 'Asha Namuli',
      nin: OCR_OK.nin,
      idConfidence: 0.95,
    }));

    renderStep();
    await waitFor(() => expect(screen.getByText('Check your details')).toBeTruthy());

    // Re-scanning here would mint a DIFFERENT person mid-wizard — the thing the
    // original guard was written to prevent, and which must still hold.
    expect(extractIdFields).not.toHaveBeenCalled();
  });

  it('keeps the two wizards on separate storage keys', () => {
    // One shared blob is why an agent onboarding could clobber a half-finished
    // public signup. `self` deliberately keeps the original key, which
    // CLAUDE.md §4.5 documents by name.
    expect(signupStorageKey('self')).toBe(SIGNUP_STORAGE_KEY);
    expect(signupStorageKey('agent')).toBe(`${SIGNUP_STORAGE_KEY}:agent`);
    expect(signupStorageKey('agent')).not.toBe(signupStorageKey('self'));
  });

  it('an agent wizard does not read the public wizard blob', async () => {
    localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({
      onboardingSessionId: 'session-PUBLIC',
      idCapturedSessionId: 'session-PUBLIC',
      fullName: 'Public Signup Person',
      idConfidence: 0.95,
    }));

    renderStep('agent');
    await waitFor(() => expect(screen.getByText('Check your details')).toBeTruthy());

    // The agent flow starts clean, so it scans rather than inheriting the
    // public wizard's person.
    expect(extractIdFields).toHaveBeenCalledTimes(1);
  });
});
