import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import styles from './FAQ.module.css';

const FAQ_ITEMS = [
  {
    q: 'What is Universal Pensions?',
    a: 'Universal Pensions is a digital long-term savings and pension platform designed to make retirement saving accessible, understandable, and meaningful for every Ugandan. We help informal workers, gig workers, farmers, and self-employed individuals build long-term financial security.',
  },
  {
    q: 'Who regulates Universal Pensions?',
    a: 'Universal Pensions is licensed and regulated by the Uganda Retirement Benefits Regulatory Authority (URBRA), ensuring full compliance with national pension laws and regulations.',
  },
  {
    q: 'How do I start contributing?',
    a: 'You can sign up through our platform, via a field agent, or through a participating employer. Once registered, you can make contributions via mobile money, bank transfer, or through your employer\'s payroll.',
  },
  {
    q: 'What is the minimum contribution amount?',
    a: 'We believe in accessibility. You can start contributing with as little as UGX 5,000 per month. Every contribution counts towards building your retirement security.',
  },
  {
    q: 'Can I withdraw my savings early?',
    a: 'Early withdrawals are possible under specific circumstances defined by URBRA regulations. Partial withdrawals may be permitted for qualifying life events. Contact our support team for details.',
  },
  {
    q: 'How are my savings invested?',
    a: 'Your contributions are invested in a diversified portfolio managed by licensed fund managers, in compliance with URBRA investment guidelines. This includes government securities, fixed income, and approved equities.',
  },
  {
    q: 'What happens to my pension if I change jobs?',
    a: 'Your Universal Pensions account stays with you regardless of employment changes. Your savings are portable and continue to grow whether you switch employers or become self-employed.',
  },
  {
    q: 'How do agents help with enrolment?',
    a: 'Our field agents are trained to help you understand pension benefits, complete registration, and set up contribution plans. They are available across all regions of Uganda to provide in-person support.',
  },
  {
    // The single most-asked question at the worst possible moment. It names the
    // split explicitly, because "how do I claim" has two different answers
    // depending on which cover and who is asking.
    q: 'Someone in my family has died. How do we claim?',
    a: 'Life cover and Funeral cover pay out to the people the member named, so the claim is made by them — not by the member. You do not need an account: go to universalpensions.com/claim, tell us who has died and how to reach you, and we will call you within two working days. Hospital cash is different: the member claims that themselves from their own account, for each night they spend in hospital.',
  },
  {
    q: 'Is my data safe?',
    a: 'We use industry-standard encryption and security protocols to protect your personal and financial information. All data is stored securely and handled in compliance with Uganda\'s data protection regulations.',
  },
];

function AccordionItem({ item, isOpen, onToggle }) {
  return (
    <div className={styles.item}>
      <button
        className={styles.question}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span>{item.q}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          width="18"
          height="18"
          className={styles.icon}
          data-open={isOpen}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
            className={styles.answerWrap}
          >
            <p className={styles.answer}>{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQ() {
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className={styles.page}>
        <div className={styles.container}>
          <motion.div
            className={styles.header}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
          >
            <h1 className={styles.title}>Frequently Asked Questions</h1>
            <p className={styles.subtitle}>
              Everything you need to know about Universal Pensions, contributions, and how we help you build long-term financial security.
            </p>
          </motion.div>

          <motion.div
            className={styles.list}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE_OUT_EXPO }}
          >
            {FAQ_ITEMS.map((item, i) => (
              <AccordionItem
                key={i}
                item={item}
                isOpen={openIdx === i}
                onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
              />
            ))}
          </motion.div>

          <motion.div
            className={styles.backLink}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT_EXPO }}
          >
            <Link to="/" className={styles.back}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back to home
            </Link>
          </motion.div>
        </div>
      </main>
      <Footer />
    </>
  );
}
