import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useToast } from '../../contexts/ToastContext';
import { usePlatformOverview, useEntityMetrics } from '../../hooks/useEntity';
import { getPlatformChatResponse } from '../../services/chat';
import { buildPlatformCopilotContext, PLATFORM_COPILOT_SUGGESTIONS } from './platformCopilotContext';
import { sparkIcon, closeIcon, sendIcon } from '../../employer-dashboard/desktop/icons';
import styles from './DataCopilotPanel.module.css';

// Matches the focusable-elements selector Modal.jsx uses (duplicated locally —
// this panel is a fixed drawer, not a Modal.jsx portal — so the Tab trap below
// is self-contained). Filters out disabled / tabindex="-1" / hidden elements.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('hidden')) return false;
    const style = el.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  });
}

/**
 * DataCopilotPanel — the Ask-AI slide-in copilot drawer for the map-overlay
 * shells: the ADMIN ("Platform Copilot") and DISTRIBUTOR ("Network Copilot").
 * Structurally mirrors BranchCopilotPanel's chat UX (messages / input / thinking
 * dots / suggestion chips / Esc-to-close / focus-the-input-on-open) but presents
 * as a CommissionPanel-style right-hand drawer rather than a docked grid cell.
 *
 * It SELF-FETCHES its figures (TanStack dedupes into the shared caches) and
 * answers via the CLIENT-SIDE getPlatformChatResponse — never the server route,
 * whose stats are stale. The scope split below means the admin-only
 * usePlatformOverview() RPC is never mounted for the distributor (it RAISEs for
 * a non-admin JWT); the distributor reads its agent-tree country rollup instead.
 */
export default function DataCopilotPanel({ open, onClose, scope = 'admin' }) {
  return scope === 'admin'
    ? <AdminCopilot open={open} onClose={onClose} />
    : <DistributorCopilot open={open} onClose={onClose} />;
}

// Admin: platform-wide truth (employer-inclusive totals + distributor/employer/
// channel counts). Falls back to the country rollup until the platform RPC
// resolves so the very first frame still answers with real numbers.
function AdminCopilot({ open, onClose }) {
  const { data: platform } = usePlatformOverview();
  const { data: countryMetrics } = useEntityMetrics('country', 'ug');
  const ctx = useMemo(
    () => buildPlatformCopilotContext({ scope: 'admin', overview: platform ?? countryMetrics ?? {} }),
    [platform, countryMetrics],
  );
  return <CopilotChat open={open} onClose={onClose} scope="admin" title="Platform Copilot" ctx={ctx} />;
}

// Distributor: the agent → branch → subscriber tree IS their network, so the
// country rollup is the source of truth (no admin-only RPC).
function DistributorCopilot({ open, onClose }) {
  const { data: countryMetrics } = useEntityMetrics('country', 'ug');
  const ctx = useMemo(
    () => buildPlatformCopilotContext({ scope: 'distributor', overview: countryMetrics ?? {} }),
    [countryMetrics],
  );
  return <CopilotChat open={open} onClose={onClose} scope="distributor" title="Network Copilot" ctx={ctx} />;
}

function CopilotChat({ open, onClose, scope, title, ctx }) {
  const reduceMotion = useReducedMotion();
  const { addToast } = useToast();

  const [messages, setMessages] = useState([]); // { id, role:'user'|'ai', text, pending? }
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  const inputRef = useRef(null);
  const threadRef = useRef(null);
  const panelRef = useRef(null);
  const aliveRef = useRef(true);
  const timerRef = useRef(null);
  const idRef = useRef(0);
  const nextId = () => { idRef.current += 1; return idRef.current; };

  useEffect(() => () => {
    aliveRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!open) return undefined;
    const node = panelRef.current;
    if (!node) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      // Focus trap (AUDIT A19-005) — this panel declares role="dialog" +
      // aria-modal="true" but had no Tab handler, so focus walked straight
      // into the background map-shell sidebar. Mirrors Modal.jsx's trap:
      // Shift+Tab off the first focusable (or from outside the panel) wraps
      // to the last; Tab off the last (or from outside) wraps to the first.
      if (e.key !== 'Tab') return;
      const focusables = getFocusableElements(node);
      if (focusables.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !node.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function ask(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || thinking) return;
    const pendingId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', text: trimmed },
      { id: pendingId, role: 'ai', text: '', pending: true },
    ]);
    setInput('');
    setThinking(true);
    getPlatformChatResponse(trimmed, ctx)
      .then((reply) => {
        timerRef.current = setTimeout(() => {
          if (!aliveRef.current) return;
          setMessages((prev) =>
            prev.map((msg) => (msg.id === pendingId ? { ...msg, text: reply, pending: false } : msg)),
          );
          setThinking(false);
          requestAnimationFrame(() => inputRef.current?.focus());
        }, 600);
      })
      .catch((err) => {
        if (!aliveRef.current) return;
        setThinking(false);
        setMessages((prev) => prev.filter((msg) => msg.id !== pendingId));
        addToast('error', err?.message || 'Copilot is unavailable — please try again.');
      });
  }

  function handleSubmit(e) {
    e.preventDefault();
    ask(input);
  }

  const empty = messages.length === 0;
  const placeholder = scope === 'admin' ? 'Ask about the platform…' : 'Ask about your network…';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.aside
            ref={panelRef}
            className={styles.panel}
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0, transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%', transition: { duration: 0.45, ease: EASE_OUT_EXPO } }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            aria-hidden={open ? undefined : 'true'}
            inert={!open}
            tabIndex={-1}
          >
            <header className={styles.head}>
              <span className={styles.headTitle}>
                <span className={styles.headIcon}>{sparkIcon(16)}</span>
                {title}
              </span>
              <button type="button" className={styles.close} onClick={onClose} aria-label="Close AI assistant">
                {closeIcon(18)}
              </button>
            </header>

            <div className={styles.thread} ref={threadRef}>
              {empty ? (
                <div className={styles.welcome}>
                  <p className={styles.welcomeTitle}>
                    Hi, I&apos;m your {scope === 'admin' ? 'Platform' : 'Network'} Copilot.
                  </p>
                  <p className={styles.welcomeText}>
                    Ask me about subscribers, active rate, AUM, contributions, agents, branches
                    {scope === 'admin' ? ', distributors, employers,' : ''} and where members are acquired.
                  </p>
                  <ul className={styles.chips}>
                    {PLATFORM_COPILOT_SUGGESTIONS.map((q) => (
                      <li key={q}>
                        <button type="button" className={styles.chip} onClick={() => ask(q)}>
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className={styles.messages}>
                  <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                      <motion.li
                        key={msg.id}
                        className={`${styles.msg} ${msg.role === 'user' ? styles.msgUser : styles.msgAi}`}
                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
                      >
                        {msg.role === 'ai' && <span className={styles.msgLabel}>Copilot</span>}
                        {msg.pending ? (
                          <span className={styles.typing} aria-label="Thinking">
                            <span className={styles.typingDot} />
                            <span className={styles.typingDot} />
                            <span className={styles.typingDot} />
                          </span>
                        ) : (
                          <span className={styles.bubble}>{msg.text}</span>
                        )}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>

            <form className={styles.composer} onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                type="text"
                name="message"
                autoComplete="off"
                className={styles.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={placeholder}
                aria-label={`Ask the ${title}`}
                disabled={thinking}
              />
              <button
                type="submit"
                className={styles.send}
                disabled={!input.trim() || thinking}
                aria-label="Send"
              >
                {sendIcon(14)}
              </button>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Floating "Ask AI" button (bottom-right FAB) for the map-overlay shells. Sits
 * above the map/overlay chrome but below any slide-in panel + the mobile drawer,
 * and is hidden in print. Additive — it never touches the map/overlay.
 *
 * Forwards its ref to the underlying <button> (AUDIT A19-006) so the owning
 * shell can return focus here when the Copilot closes — it never restored
 * focus to the trigger before, unlike the four routed shells' Ask-AI buttons.
 */
export const AskAiFab = forwardRef(function AskAiFab({ onClick, label = 'Ask AI' }, ref) {
  return (
    <button ref={ref} type="button" className={styles.fab} onClick={onClick} aria-label={label}>
      <span className={styles.fabIcon}>{sparkIcon(18)}</span>
      <span className={styles.fabText}>{label}</span>
    </button>
  );
});
