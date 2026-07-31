import { useSignup } from '../../signup/SignupContext';
import ContributionSettings from '../../signup/contribution/ContributionSettings';

/**
 * Stage 3 of agent onboarding — the new subscriber's savings plan, family cover
 * and first payment. Sits between the KYC flow's consent step and
 * OnboardingComplete.
 *
 * Renders the SAME `ContributionSettings` the subscriber sees at
 * /signup/contribution, in `embedded` mode so OnboardFlow keeps ownership of the
 * page chrome and the scrollport. The agent path used to render a separate,
 * older form (`ContributionSettingsForm`), which is why the two journeys had
 * drifted apart — different layout, different insurance presentation, and no
 * payment step at all. Sharing the component is the same pattern OnboardKycFlow
 * already uses for the eight KYC steps: shared body, host-supplied chrome,
 * third-person copy via OnboardAudienceContext.
 *
 * `phone` is passed through as the 9 local digits SignupContext holds — NOT
 * canonicalised — because the MoMo field is a 10-char digits-only input that
 * would truncate a `+256…` number.
 *
 * The confirmed schedule lands in SignupContext; the actual write happens one
 * stage later in OnboardingComplete, which owns the retry surface a field agent
 * needs on a flaky connection. `onboardPayload.buildPayload` reads
 * `paymentMethod` and `insuranceSavingsPct` off this object — values the old form
 * never emitted, so they were silently dropped on every agent-onboarded member.
 */
export default function OnboardScheduleStep({ onContinue, onCancel }) {
  const signup = useSignup();

  function handleConfirm(schedule) {
    signup.patch({ contributionSchedule: schedule });
    onContinue?.(schedule);
  }

  return (
    <ContributionSettings
      initial={signup.contributionSchedule}
      dob={signup.dob}
      phone={signup.phone}
      embedded
      onClose={onCancel}
      onConfirm={handleConfirm}
    />
  );
}
