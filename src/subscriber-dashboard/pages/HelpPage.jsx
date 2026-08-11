import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { getInitials } from '../../utils/dashboard';
import { useCurrentSubscriber, useSubscriberAgent } from '../../hooks/useSubscriber';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useSubscriberTickets } from '../../hooks/useTickets';
import { TICKET_STATUS } from '../../data/ticketsSeed';
import {
  SUPPORT_WHATSAPP_URL,
  SUPPORT_WHATSAPP_DISPLAY,
  SUPPORT_EMAIL,
} from '../../config/env';
import styles from './HelpPage.module.css';

const FAQS = [
  {
    id: 'withdraw',
    q: 'How do I withdraw from my Emergency bucket?',
    a: 'Open Withdraw on your home screen, choose the Emergency bucket, enter the amount, and pick a reason. Funds arrive within 24 hours.',
  },
  {
    id: 'retirement',
    q: 'When can I access my retirement savings?',
    a: 'Retirement savings unlock at age 60. Before then, use your Emergency bucket for hardship withdrawals.',
  },
  {
    id: 'change-split',
    q: 'Can I change my retirement/emergency split?',
    a: 'Yes — go to Save → Set up schedule (or the calendar icon on the contribution card). Changes apply to future contributions only.',
  },
  {
    id: 'nominees',
    q: 'How do I update my nominees?',
    a: 'Open Settings → Nominees, add or edit entries, then save. Shares must total 100%.',
  },
  {
    id: 'insurance-claim',
    q: 'How long does an insurance claim take?',
    a: 'A case officer reviews each claim within 3 business days. You’ll receive an SMS + email update at each stage.',
  },
  {
    id: 'agent',
    q: 'Who is my assigned agent?',
    a: 'Tap “Message your agent” at the top of this page. You’ll see who your agent is, raise a new issue, or pick up an existing conversation — they reply right here in the app.',
  },
];

export default function HelpPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub } = useCurrentSubscriber();
  const subId = sub?.id;
  const { data: agent } = useSubscriberAgent(subId);
  const { data: tickets = [] } = useSubscriberTickets(subId);

  const [openFaq, setOpenFaq] = useState(null);
  const [query, setQuery] = useState('');

  const openCount = useMemo(
    () => tickets.filter((t) => t.status === TICKET_STATUS.OPEN).length,
    [tickets],
  );

  const filteredFaqs = useMemo(() => {
    if (!query) return FAQS;
    const q = query.toLowerCase();
    return FAQS.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  }, [query]);

  // The agent card's secondary line prefers a live signal (open conversations),
  // falling back to the agent's branch, then a generic prompt.
  const agentMeta = openCount > 0
    ? `${openCount} open conversation${openCount === 1 ? '' : 's'}`
    : agent?.branchName
      ? `${agent.branchName} branch`
      : 'Raise an issue or continue a chat';

  return (
    <div className={styles.page}>
      {isDesktop && (
        // Desktop (>=1024px): flat v5 header (eyebrow + title + subtitle), no
        // indigo hero dome. Tab-root page — no back affordance, matching the
        // mobile hero's role here.
        <header className={styles.deskHead}>
          <p className={styles.deskEyebrow}>Support</p>
          <h1 className={styles.deskTitle}>How can we help?</h1>
          <p className={styles.deskSubtitle}>Message your agent, find answers, or contact support</p>
        </header>
      )}
      {/* Mobile (<1024px): the persistent shell app bar renders this page's
          title + back arrow, so the in-page hero is removed and the body
          starts at the top. */}

      <div className={styles.body}>
        <motion.div
          className={styles.step}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.28, ease: EASE_OUT_EXPO }}
        >
          {/* Primary support path: connect to your assigned human agent. */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Your agent</h2>
            <button
              type="button"
              className={styles.agentCard}
              onClick={() => navigate('/dashboard/agent')}
            >
              <span className={styles.agentAvatar} aria-hidden="true">
                {agent?.name ? getInitials(agent.name) : (
                  <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                    <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.75" />
                    <path d="M5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <span className={styles.agentText}>
                <span className={styles.agentName}>{agent?.name || 'Your assigned agent'}</span>
                <span className={styles.agentMeta}>{agentMeta}</span>
              </span>
              <span className={styles.agentCta}>
                Message
                <svg aria-hidden="true" viewBox="0 0 12 12" width="11" height="11" fill="none">
                  <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            <p className={styles.agentHint}>
              Your agent handles your account personally — raise an issue and they’ll reply right here in the app.
            </p>
          </section>

          {/* Alternate contact channels. */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Other ways to reach us</h2>
            <div className={styles.contactGrid}>
              <a className={styles.contactCard} href="tel:0800100200">
                <span className={styles.contactIcon} data-tone="green">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M5 4h4l2 5-3 2a12 12 0 006 6l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className={styles.contactText}>
                  <span className={styles.contactLabel}>Call us</span>
                  <span className={styles.contactHelper}>0800-100-200 · toll free</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" className={styles.contactArrow}>
                  <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </a>

              <a className={styles.contactCard} href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer">
                <span className={styles.contactIcon} data-tone="teal">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M3 21l2-6a9 9 0 113 3l-5 3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
                    <path d="M8 12c0 2.2 1.8 4 4 4h1l1.5-2H14a2 2 0 01-2-2v-.5l-2-1.5H9a1 1 0 00-1 1v1z" fill="currentColor"/>
                  </svg>
                </span>
                <span className={styles.contactText}>
                  <span className={styles.contactLabel}>WhatsApp</span>
                  <span className={styles.contactHelper}>{SUPPORT_WHATSAPP_DISPLAY}</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" className={styles.contactArrow}>
                  <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </a>

              <a className={styles.contactCard} href={`mailto:${SUPPORT_EMAIL}`}>
                <span className={styles.contactIcon} data-tone="amber">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75"/>
                    <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className={styles.contactText}>
                  <span className={styles.contactLabel}>Email us</span>
                  <span className={styles.contactHelper}>{SUPPORT_EMAIL}</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" className={styles.contactArrow}>
                  <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </a>
            </div>
          </section>

          {/* Self-serve answers. */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Popular questions</h2>
            <div className={styles.searchWrap}>
              <svg aria-hidden="true" className={styles.searchIcon} viewBox="0 0 24 24" fill="none" width="18" height="18">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75"/>
                <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search help, e.g. 'how to withdraw'"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search help"
              />
            </div>
            <ul className={styles.faqList}>
              {filteredFaqs.map((f) => (
                <li key={f.id} className={styles.faqRow} data-open={openFaq === f.id || undefined}>
                  <button
                    type="button"
                    className={styles.faqHead}
                    onClick={() => setOpenFaq(openFaq === f.id ? null : f.id)}
                    aria-expanded={openFaq === f.id}
                  >
                    <span className={styles.faqQ}>{f.q}</span>
                    <svg aria-hidden="true" className={styles.faqChev} data-open={openFaq === f.id} viewBox="0 0 12 12" width="12" height="12" fill="none">
                      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <AnimatePresence initial={false}>
                    {openFaq === f.id && (
                      <motion.div
                        className={styles.faqBody}
                        initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                        animate={reducedMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.25, ease: EASE_OUT_EXPO }}
                      >
                        <p className={styles.faqA}>{f.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              ))}
              {filteredFaqs.length === 0 && (
                <li className={styles.faqEmpty}>No matching help topics.</li>
              )}
            </ul>
          </section>
        </motion.div>
      </div>
    </div>
  );
}
