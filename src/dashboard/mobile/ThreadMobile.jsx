import { useParams } from 'react-router-dom';
import { useTicketThread } from '../../hooks/useTickets';
import { formatRelativeTime } from '../../utils/date';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './distributorMobile.module.css';

const LockIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

function roleLabel(sender = '') {
  return sender.charAt(0).toUpperCase() + sender.slice(1);
}

/**
 * ThreadMobile — a read-only support transcript (route
 * /dashboard/support/:ticketId). The distributor is an oversight role and cannot
 * reply, so there is no composer — just the conversation. Same useTicketThread
 * hook as the desktop ViewTickets.
 */
export default function ThreadMobile() {
  const { ticketId } = useParams();
  const { data: thread, isLoading, isError, error, refetch } = useTicketThread(ticketId);

  if (isError || (!thread && !isLoading)) {
    return <ErrorCard title="We couldn't load this conversation" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !thread) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const isOpen = thread.status === 'open';
  const messages = Array.isArray(thread.messages) ? thread.messages : [];

  return (
    <>
      <section className={styles.card} aria-label="Ticket">
        <header className={styles.cardHd} style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 15 }}>{thread.subject}</h3>
          <span className={`${styles.pill} ${isOpen ? styles.warn : styles.off}`}><i />{isOpen ? 'Open' : 'Closed'}</span>
        </header>
        <div className={styles.roNote}>
          {LockIcon}
          Read-only conversation — oversight view. You can&apos;t reply from here.
        </div>
      </section>

      <section className={styles.card} aria-label="Messages">
        {messages.map((msg) => {
          if (msg.sender === 'system') {
            return (
              <p key={msg.id} className={styles.scoreNote} style={{ textAlign: 'center', margin: '6px 0' }}>
                {msg.body}
              </p>
            );
          }
          return (
            <div key={msg.id} className={`${styles.msg} ${styles.msgThem}`}>
              <div className={styles.msgWho}>{roleLabel(msg.sender)}{msg.at ? ` · ${formatRelativeTime(msg.at)}` : ''}</div>
              {msg.body}
            </div>
          );
        })}
        {messages.length === 0 && <p className={styles.scoreNote}>No messages in this ticket.</p>}
      </section>
    </>
  );
}
