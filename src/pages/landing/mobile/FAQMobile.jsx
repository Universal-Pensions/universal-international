import { useState } from 'react';
import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

const FULL_FAQS = [
  ['What is Universal Pensions?', 'A digital savings and pension platform for every Ugandan — informal workers, farmers and the self-employed included.'],
  ['Who regulates Universal Pensions?', 'We’re licensed and regulated by URBRA, the Uganda Retirement Benefits Regulatory Authority.'],
  ['How do I start contributing?', 'Sign up on our platform, with an agent, or through your employer. Then pay in by mobile money, bank transfer or payroll.'],
  ['What is the minimum contribution amount?', 'Just UGX 5,000 a month. Every contribution counts.'],
  ['Can I withdraw my savings early?', 'Early withdrawals are possible in specific cases under URBRA rules. Contact support for details.'],
  ['How are my savings invested?', 'Licensed experts invest it carefully under URBRA rules. They spread it across safe options, like government bonds, to protect your money.'],
  ['What happens to my pension if I change jobs?', 'Your account stays with you. Your savings are portable and keep growing, whatever job you do.'],
  ['Someone in my family has died. How do we claim?', 'Life and Funeral cover pay out to the people the member named, so they make the claim — not the member. No account needed: tap “Claim for a loved one” in the menu, tell us who has died and how to reach you, and we will call within two working days. Hospital cash is different — the member claims that themselves.'],
  ['How do agents help with enrolment?', 'Agents help you register and set up a plan, in person, across every region of Uganda.'],
  ['Is my data safe?', 'Yes. We use strong encryption and follow Uganda’s data protection rules.'],
];

export default function FAQMobile() {
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <div className={styles.screen}>
      <div className={styles.sect} style={{ marginTop: 2 }}>
        <p className={styles.eyebrow}>Good questions</p>
        <h1 className={styles.sectTitle}>Frequently asked questions.</h1>
        <p className={styles.sectLead}>Contributions, safety, and how we help you save.</p>
      </div>
      <div className={styles.card}>
        {FULL_FAQS.map(([q, a], i) => {
          const open = openIdx === i;
          const id = `faq-a${i}`;
          return (
            <div key={i} className={cx(styles.faqItem, open && styles.open)}>
              <button
                type="button"
                className={styles.faqQ}
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpenIdx(open ? -1 : i)}
              >
                {q}
                <span className={styles.fqi}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </button>
              <div className={styles.faqA} id={id} role="region">
                <p>{a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
