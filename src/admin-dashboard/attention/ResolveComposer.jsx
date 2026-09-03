import { useState } from 'react';
import styles from './NotifyComposer.module.css';

/**
 * The body of the "close this row out" confirm, shared by the desktop drill-down
 * (wrapped in <Modal>) and the mobile one (wrapped in <BottomSheet>). Sibling of
 * NotifyComposer, and deliberately borrows its stylesheet: same form, same two
 * buttons, same place in the same dialogs. A second stylesheet saying the same
 * thing would only be one edit away from disagreeing with the first.
 *
 * WHY THIS IS A DIALOG AND NOT A ONE-CLICK BUTTON: resolving is final — there is
 * no reopen — so this confirm is the only thing standing between a mis-click and
 * a permanently silenced day. Do not "simplify" it into an inline action.
 *
 * The note is OPTIONAL by product decision: an admin closing an obviously
 * non-dealing day should not have to narrate it. Submit therefore stays enabled
 * with an empty box, which is the opposite of NotifyComposer (where an empty
 * message would send a blank notification).
 *
 * @param {Object} props
 * @param {Object} props.row The drill-down row being resolved.
 * @param {import('./attentionMeta').AttentionMeta} props.meta
 * @param {boolean} props.sending
 * @param {(note: string) => void} props.onResolve
 * @param {() => void} props.onCancel
 */
export default function ResolveComposer({ row, meta, sending = false, onResolve, onCancel }) {
  // Mounted with `key={row.id}` by both callers, so a different row remounts
  // this with an empty box rather than carrying the previous row's reason over.
  const [note, setNote] = useState('');

  if (!row) return null;

  return (
    <form
      className={styles.form}
      onSubmit={(e) => { e.preventDefault(); if (!sending) onResolve(note); }}
    >
      <div className={styles.re}>{row.primary}{row.secondary ? ` · ${row.secondary}` : ''}</div>

      <label className={styles.label} htmlFor="resolve-note">
        Why is this resolved? (optional)
      </label>
      {/* aria-label duplicates the visible <label> above deliberately: the
          htmlFor/id pair already associates them, but jsx-a11y cannot see that
          through this component boundary and flags the control. Matching text
          means assistive tech reads the same thing either way, and this file
          does not add to the lint ceiling. */}
      <textarea
        id="resolve-note"
        aria-label="Why is this resolved? (optional)"
        className={styles.textarea}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        maxLength={500}
        placeholder="For example: fund administration confirmed there was no dealing on this day."
      />

      <p className={styles.note}>
        {meta.resolveBody ? meta.resolveBody(row) : 'This stops the row showing under Needs attention.'}
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.ghost} onClick={onCancel} disabled={sending}>
          Cancel
        </button>
        <button type="submit" className={styles.primary} disabled={sending}>
          {sending ? 'Saving…' : (meta.resolveVerb || 'Resolve')}
        </button>
      </div>
    </form>
  );
}
