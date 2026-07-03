// OnboardFlow — terminal manual-review path must NOT create a subscriber (H1).
//
// Regression guard for the audit H1 finding: a failed/flagged KYC applicant
// (NIRA no-match / liveness fail / AML watchlist hit) hit the ManualReviewCard
// whose "End onboarding" button advanced the stage machine to schedule → done →
// OnboardingComplete, which fires createFromAgentOnboard on mount. That RPC
// hardcodes kyc_status='complete' / is_active=TRUE, so an unverifiable applicant
// was written as a clean ACTIVE member. The fix routes the terminal action back
// to /dashboard WITHOUT creating a subscriber; the happy path (consent →
// OnboardingComplete) must still create one exactly as before.
//
// We stub the heavy KYC step components so we can deterministically trigger the
// NIRA agent-fallback (and, for the happy-path guard, the consent activate)
// without the real mocked-KYC latency/timers.

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SignupProvider } from '../../signup/SignupContext';

// ── Service under guard: this must NEVER be called on the terminal path. ──────
const createFromAgentOnboard = vi.fn().mockResolvedValue('sub-test');
vi.mock('../../services/subscriber', () => ({
  createFromAgentOnboard: (...args) => createFromAgentOnboard(...args),
}));

// ── Auth: supply an agentId so the (happy-path only) persist effect is armed. ─
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { agentId: 'a-001' } }),
}));

// ── Navigation: capture /dashboard exit without a real router history. ────────
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

// ── Heavy step components → light stubs exposing the handlers we drive. ───────
vi.mock('../../signup/steps/IdUploadStep', () => ({
  default: ({ onNext }) => <button type="button" onClick={onNext}>id-next</button>,
}));
vi.mock('../../signup/steps/ReviewStep', () => ({
  default: ({ onNext }) => <button type="button" onClick={onNext}>review-next</button>,
}));
vi.mock('../../signup/steps/NiraStep', () => ({
  default: ({ onNext, onAgentFallback }) => (
    <>
      <button type="button" onClick={onNext}>nira-next</button>
      <button type="button" onClick={onAgentFallback}>nira-fallback</button>
    </>
  ),
}));
vi.mock('../../signup/steps/OtpStep', () => ({
  default: ({ onNext }) => <button type="button" onClick={onNext}>otp-next</button>,
}));
vi.mock('../../signup/steps/LivenessStep', () => ({
  default: ({ onNext }) => <button type="button" onClick={onNext}>liveness-next</button>,
}));
vi.mock('../../signup/steps/AmlStep', () => ({
  default: ({ onNext }) => <button type="button" onClick={onNext}>aml-next</button>,
}));
vi.mock('../../signup/steps/BeneficiariesStep', () => ({
  default: ({ onNext }) => <button type="button" onClick={onNext}>beneficiaries-next</button>,
}));
vi.mock('../../signup/steps/ConsentStep', () => ({
  default: ({ onActivate }) => <button type="button" onClick={onActivate}>consent-activate</button>,
}));
// AwarenessCheck gates entry into KYC; stub its continue.
vi.mock('./AwarenessCheck', () => ({
  default: ({ onContinue }) => <button type="button" onClick={onContinue}>awareness-continue</button>,
}));
// ScheduleStep only appears on the happy path; stub its continue.
vi.mock('./OnboardScheduleStep', () => ({
  default: ({ onContinue }) => <button type="button" onClick={onContinue}>schedule-continue</button>,
}));

import OnboardFlow from './OnboardFlow';

function renderFlow() {
  // OnboardingComplete invalidates the agent's subscriber list on success, so it
  // needs a QueryClient in context.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SignupProvider>
          <OnboardFlow />
        </SignupProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  createFromAgentOnboard.mockClear();
  navigate.mockClear();
});

describe('OnboardFlow — terminal manual-review path', () => {
  // Stage/step transitions animate via AnimatePresence mode="wait" (the outgoing
  // node lingers during exit), so each next control is awaited with findByText.
  async function clickWhenReady(user, text) {
    await user.click(await screen.findByText(text));
  }

  it('does NOT create a subscriber and exits to /dashboard when KYC routes to manual review', async () => {
    const user = userEvent.setup();
    renderFlow();

    await clickWhenReady(user, 'awareness-continue');
    await clickWhenReady(user, 'id-next');
    await clickWhenReady(user, 'review-next');
    await clickWhenReady(user, 'nira-fallback');

    // Terminal card: preserved "logged for follow-up" copy, single exit action.
    expect(await screen.findByText(/Manual review needed/i)).toBeInTheDocument();
    expect(screen.getByText(/logged the case for follow-up/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /End onboarding/i }));

    // The whole point of the fix: no subscriber row, just a clean exit.
    expect(createFromAgentOnboard).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('still creates the subscriber on the happy path (consent → OnboardingComplete)', async () => {
    const user = userEvent.setup();
    renderFlow();

    await clickWhenReady(user, 'awareness-continue');
    await clickWhenReady(user, 'id-next');
    await clickWhenReady(user, 'review-next');
    await clickWhenReady(user, 'nira-next');
    await clickWhenReady(user, 'otp-next');
    await clickWhenReady(user, 'liveness-next');
    await clickWhenReady(user, 'aml-next');
    await clickWhenReady(user, 'beneficiaries-next');
    await clickWhenReady(user, 'consent-activate');
    await clickWhenReady(user, 'schedule-continue');

    await waitFor(() => expect(createFromAgentOnboard).toHaveBeenCalledTimes(1));
  });
});
