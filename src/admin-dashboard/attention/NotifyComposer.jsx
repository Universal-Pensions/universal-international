import { useState } from 'react';
import styles from './NotifyComposer.module.css';

/**
 * The body of the "notify the responsible stakeholder" composer, shared by the
 * desktop drill-down (wrapped in <Modal>) and the mobile one (wrapped in
 * <BottomSheet>). Pure form — the wrapper owns presentation, this owns the draft.
 *
 * The draft is prefilled from ATTENTION_META[type].draft(row) and stays editable;
 * the admin is the one who knows the context, so the generated text is a starting
 * point rather than a template to send blind.
 *
 * @param {Object} props
 * @param {Object} props.row The drill-down row being escalated. Carries the
 *   server-resolved `recipientRole` / `recipientId` / `recipientName`.
 * @param {import('./attentionMeta').AttentionMeta} props.meta
 * @param {boolean} props.sending
 * @param {(body: string) => void} props.onSend
 * @param {() => void} props.onCancel
 */
export default function NotifyComposer({ row, meta, sending = false, onSend, onCancel }) {
  // Lazy init only. Callers mount this with `key={row.id}` so a different target
  // row remounts the composer with a fresh draft — carrying the previous row's
  // text into a new escalation would be a real hazard. Deriving the draft in an
  // effect instead would mean an extra render and a lint violation
  // (react-hooks/set-state-in-effect).
  const [draft, setDraft] = useState(() => (row ? meta.draft(row) : ''));

  if (!row) return null;

  const isQueue = row.recipientRole === 'admin';
  const trimmed = draft.trim();

  return (
    <form
      className={styles.form}
      onSubmit={(e) => { e.preventDefault(); if (trimmed) onSend(trimmed); }}
    >
      <div className={styles.to}>
        <span className={styles.toLabel}>To</span>
        <span className={styles.chip}>
          {row.recipientName || row.recipientId}
          <span className={styles.chipRole}>{isQueue ? 'internal queue' : row.recipientRole}</span>
        </span>
      </div>

      <div className={styles.re}>{row.primary}{row.secondary ? ` · ${row.secondary}` : ''}</div>

      <label className={styles.label} htmlFor="notify-body">Message</label>
      <textarea
        id="notify-body"
        className={styles.textarea}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        maxLength={1000}
      />

      <p className={styles.note}>
        Sends an in-app notification to {isQueue ? 'the ' : ''}
        {row.recipientName || 'the recipient'}. Demo only — no SMS or email is sent.
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.ghost} onClick={onCancel} disabled={sending}>
          Cancel
        </button>
        <button type="submit" className={styles.primary} disabled={sending || !trimmed}>
          {sending ? 'Sending…' : meta.notifyVerb}
        </button>
      </div>
    </form>
  );
}
