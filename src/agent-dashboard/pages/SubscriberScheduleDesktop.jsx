import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentSubscribers, useUpdateSubscriberSchedule } from '../../hooks/useAgent';
import { useToast } from '../../contexts/ToastContext';
import ErrorCard from '../../components/feedback/ErrorCard';
import PageHeader from '../../components/PageHeader';
import SubscriberScheduleForm from '../../components/contribution/SubscriberScheduleForm';
import SkeletonRow from '../../components/SkeletonRow';
import EditScheduleConsent from './subscriber/EditScheduleConsent';
import styles from './SubscriberScheduleDesktop.module.css';

/**
 * SubscriberScheduleDesktop — desktop (>=1024px) layout for the agent's
 * subscriber contribution-schedule sub-page. Forked from SubscriberSchedulePage
 * via the useIsDesktop() gate; the mobile page is never mounted at this width,
 * so this component owns its own hooks (rules-of-hooks safe).
 *
 * It is a SUB-page (a routed detail destination), so it uses the default
 * PageHeader variant (back chevron + h1). The body is a width-capped, centred
 * wrapper around the SAME SubscriberScheduleForm the mobile page renders, with
 * the SAME useUpdateSubscriberSchedule(subscriberId, agentId) mutation and the
 * SAME save / toast / back behaviour. React Query dedupes the shared data hooks.
 *
 * That form is the subscriber's own schedule editor, shared here so the agent
 * sees what the member sees for the same task — with `showInsurance={false}`,
 * because an agent cannot authorise a premium on someone else's behalf
 * (fund_insurance_products requires app_role='subscriber'). Agent ONBOARDING is a
 * different task and uses the signup wizard instead; see OnboardScheduleStep.
 * The frame caps at 960px, comfortably past the form's 860px container threshold,
 * so the two-column split layout still fires.
 */
export default function SubscriberScheduleDesktop() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { agentId } = useAgentScope();
  const { data: subscribers = [], isLoading, isError, error, refetch } = useAgentSubscribers(agentId);
  const updateSchedule = useUpdateSubscriberSchedule(id, agentId);
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  // Editing an existing schedule requires the subscriber's OTP consent first.
  const [consentGiven, setConsentGiven] = useState(false);

  const subscriber = subscribers.find((s) => s.id === id);
  const existing = subscriber?.contributionSchedule;
  const isNew = !existing;

  async function handleSave(schedule) {
    if (!subscriber) return;
    setSubmitting(true);
    try {
      await updateSchedule.mutateAsync(schedule);
      addToast(
        'success',
        isNew
          ? `Schedule set up for ${subscriber.name.split(' ')[0]}.`
          : `${subscriber.name.split(' ')[0]}'s schedule updated.`,
      );
      navigate(`/dashboard/subscribers/${id}`);
    } catch {
      addToast('error', 'Could not save schedule. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    navigate(`/dashboard/subscribers/${id}`);
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Loading schedule…"
          fallback={`/dashboard/subscribers/${id}`}
        />
        <div className={styles.frame}>
          <SkeletonRow count={4} label="Loading subscriber schedule" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.page}>
        <PageHeader title="Schedule" fallback={`/dashboard/subscribers/${id}`} />
        <div className={styles.frame}>
          <ErrorCard
            title="We couldn't load this subscriber"
            message={error}
            onRetry={refetch}
          />
        </div>
      </div>
    );
  }

  if (!subscriber) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Subscriber not found"
          fallback="/dashboard/subscribers"
        />
      </div>
    );
  }

  // Gate edits to an existing schedule behind subscriber OTP consent.
  if (!isNew && !consentGiven) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Edit contribution schedule"
          subtitle={`for ${subscriber.name}`}
          fallback={`/dashboard/subscribers/${id}`}
        />
        <div className={styles.frame}>
          <EditScheduleConsent
            phone={subscriber.phone}
            subscriberName={subscriber.name}
            onVerified={() => setConsentGiven(true)}
            onCancel={handleCancel}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={isNew ? 'Set up contribution schedule' : 'Edit contribution schedule'}
        subtitle={`for ${subscriber.name}`}
        fallback={`/dashboard/subscribers/${id}`}
      />
      <div className={styles.frame}>
        <SubscriberScheduleForm
          initial={existing}
          age={subscriber.age}
          // Redacted for agents — see the note on the mobile page. Unused while
          // insurance is hidden.
          heldPolicies={[]}
          showInsurance={false}
          layout="split"
          onSave={handleSave}
          onCancel={handleCancel}
          submitting={submitting}
          submitLabel={isNew ? 'Set up schedule' : undefined}
        />
      </div>
    </div>
  );
}
