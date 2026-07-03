// NiraStep — state-machine init + auto-advance on persisted result.
//
// Regression cover for the v2 onboarding redesign: NiraStep used to init BOTH
// 'match' and 'no-match' to 'done', which fell through to the "couldn't verify"
// screen — so re-entering NIRA with a persisted match showed the wrong (error)
// state. The fix inits 'match'→'verified' / 'no-match'→'nomatch' and moves the
// auto-advance into a state-keyed effect (so a re-entered match still advances,
// and the OTP back-skip relies on this not bouncing). These tests pin all three
// persisted branches.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SIGNUP_STORAGE_KEY } from '../../signupState';
import { SignupProvider } from '../../SignupContext';
import NiraStep from '../NiraStep';

// verifyNira only runs when there is NO persisted result; mock it so a seeded
// result never touches the network and an accidental call is observable.
const verifyNira = vi.fn();
vi.mock('../../../services/kyc', () => ({
  verifyNira: (...args) => verifyNira(...args),
}));

function seed(state) {
  localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(state));
}

function renderNira(onNext = () => {}) {
  return render(
    <SignupProvider>
      <NiraStep onNext={onNext} onEdit={() => {}} onAgentFallback={() => {}} />
    </SignupProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  verifyNira.mockReset();
});

describe('NiraStep — persisted-result state machine', () => {
  it('persisted match shows the verified beat and auto-advances with no manual control', () => {
    vi.useFakeTimers();
    try {
      seed({ niraResult: 'match' });
      const onNext = vi.fn();
      renderNira(onNext);

      expect(screen.getByText('Identity verified')).toBeTruthy();
      // The verified beat has no Continue/footer — it auto-advances.
      expect(screen.queryByRole('button')).toBeNull();
      expect(onNext).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(1600); });

      expect(onNext).toHaveBeenCalledTimes(1);
      // A persisted result must NOT trigger a fresh network verify.
      expect(verifyNira).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('persisted no-match shows the failure screen (not a silent fall-through)', () => {
    seed({ niraResult: 'no-match' });
    renderNira();
    expect(screen.getByText(/couldn’t verify you/i)).toBeTruthy();
  });

  it('persisted partial shows the mismatch screen with manual choices', () => {
    seed({ niraResult: 'partial', niraMismatchedFields: ['dob'] });
    renderNira();
    expect(screen.getByText(/double-check one thing/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /fix and re-verify/i })).toBeTruthy();
  });
});
