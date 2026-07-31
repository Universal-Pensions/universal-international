import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentSubscribers, useUpdateSubscriberSchedule } from '../../hooks/useAgent';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import ErrorCard from '../../components/feedback/ErrorCard';
import SubscriberScheduleForm from '../../components/contribution/SubscriberScheduleForm';
import SkeletonRow from '../../components/SkeletonRow';
import SubscriberScheduleDesktop from './SubscriberScheduleDesktop';
import EditScheduleConsent from './subscriber/EditScheduleConsent';
import styles from './SubscriberSchedulePage.module.css';

export default function SubscriberSchedulePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { agentId } = useAgentScope();
  const { data: subscribers = [], isLoading, isError, error, refetch } = useAgentSubscribers(agentId);
  const updateSchedule = useUpdateSubscriberSchedule(id, agentId);
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  // Editing an existing schedule requires the subscriber's OTP consent first.
  const [consentGiven, setConsentGiven] = useState(false);

  const isDesktop = useIsDesktop();
  if (isDesktop) return <SubscriberScheduleDesktop />;

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
    // Skeleton instead of a bare "Loading…" header — the schedule form is
    // multi-section and the form data lookup ultimately blocks render here,
    // so showing the form's silhouette keeps the page feeling alive.
    return (
      <div className={styles.page}>
        <div style={{ padding: 'var(--space-4)' }}>
          <SkeletonRow count={4} label="Loading subscriber schedule" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.page}>
        <div style={{ padding: 'var(--space-4)' }}>
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
        <div style={{ padding: 'var(--space-8) var(--space-4)', textAlign: 'center', color: 'var(--color-gray)' }}>
          <p>We couldn&apos;t find that subscriber.</p>
        </div>
      </div>
    );
  }

  const contextLine = (
    <p className={styles.contextLine}>
      For <strong>{subscriber.name}</strong>
    </p>
  );

  // Gate edits to an existing schedule behind subscriber OTP consent.
  if (!isNew && !consentGiven) {
    return (
      <div className={styles.page}>
        {contextLine}
        <EditScheduleConsent
          phone={subscriber.phone}
          subscriberName={subscriber.name}
          onVerified={() => setConsentGiven(true)}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {contextLine}
      {subscriber && (
        <SubscriberScheduleForm
          initial={existing}
          age={subscriber.age}
          // The agent's subscriber rows carry a redacted policy shape
          // ({product, status} only — never cover/premium amounts, see
          // services/agent.js buildAgentPolicies), which the held-cover panel
          // can't read. Moot here: insurance is hidden on this surface.
          heldPolicies={[]}
          showInsurance={false}
          onSave={handleSave}
          onCancel={handleCancel}
          submitting={submitting}
          submitLabel={isNew ? 'Set up schedule' : undefined}
        />
      )}
    </div>
  );
}
