import { useSignup } from '../../signup/SignupContext';
import ContributionSettingsForm from '../../components/contribution/ContributionSettingsForm';

/**
 * Captures the new subscriber's contribution schedule during agent onboarding.
 * Sits between the KYC flow's consent step and the OnboardingComplete screen.
 *
 * Persists the captured schedule into SignupContext so the eventual backend
 * POST (see docs/api-contracts.md) can include it alongside the KYC payload.
 */
export default function OnboardScheduleStep({ onContinue, onCancel }) {
  const signup = useSignup();

  function handleSave(schedule) {
    signup.patch({ contributionSchedule: schedule });
    onContinue?.(schedule);
  }

  return (
    <ContributionSettingsForm
      initial={signup.contributionSchedule || null}
      dob={signup.dob}
      layout="split"
      enableSaveToCover
      onSave={handleSave}
      onCancel={onCancel}
      submitLabel="Save & continue"
      cancelLabel="Back to KYC"
    />
  );
}
