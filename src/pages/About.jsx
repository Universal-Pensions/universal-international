import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import styles from './About.module.css';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1];

const VALUES = [
  {
    title: 'Accessibility',
    text: 'We believe every Ugandan deserves access to formal retirement savings, regardless of employment type or income level.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: 'Transparency',
    text: 'Clear communication about fees, returns, and fund performance. No hidden charges, no complexity barriers.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
      </svg>
    ),
  },
  {
    title: 'Trust',
    text: 'Licensed by URBRA and built on rigorous security standards to protect every shilling entrusted to us.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    title: 'Inclusion',
    text: 'Designed for informal workers, gig workers, farmers, and self-employed individuals who are traditionally underserved.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT_EXPO } },
};

export default function About() {
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
            <h1 className={styles.title}>About Universal Pensions</h1>
            <p className={styles.subtitle}>
              Making long-term savings simple, accessible, and meaningful for every Ugandan.
            </p>
          </motion.div>

          <motion.section
            className={styles.section}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE_OUT_EXPO }}
          >
            <h2 className={styles.sectionTitle}>Our Mission</h2>
            <p className={styles.sectionText}>
              Universal Pensions exists to transform how Ugandans think about and build long-term financial security. We believe that retirement saving should not be a privilege reserved for formal-sector employees. Our platform brings structured, regulated pension savings to everyone, from boda-boda riders and market vendors to farmers and freelancers.
            </p>
            <p className={styles.sectionText}>
              By combining accessible technology, a nationwide agent network, and institutional-grade fund management, we are building a bridge between today's income and tomorrow's security.
            </p>
          </motion.section>

          <motion.section
            className={styles.section}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: EASE_OUT_EXPO }}
          >
            <h2 className={styles.sectionTitle}>How It Works</h2>
            <div className={styles.steps}>
              <div className={styles.step}>
                <span className={styles.stepNum}>01</span>
                <h3 className={styles.stepTitle}>Register</h3>
                <p className={styles.stepText}>Sign up through our app, website, or via a field agent in your community. All you need is a phone number and national ID.</p>
              </div>
              <div className={styles.step}>
                <span className={styles.stepNum}>02</span>
                <h3 className={styles.stepTitle}>Contribute</h3>
                <p className={styles.stepText}>Make contributions at your own pace via mobile money, bank transfer, or through your employer. Start from as little as UGX 5,000.</p>
              </div>
              <div className={styles.step}>
                <span className={styles.stepNum}>03</span>
                <h3 className={styles.stepTitle}>Grow</h3>
                <p className={styles.stepText}>Your savings are professionally managed and invested in diversified portfolios, growing steadily over time through the power of compound returns.</p>
              </div>
            </div>
          </motion.section>

          <motion.section
            className={styles.section}
            variants={stagger}
            initial="initial"
            animate="animate"
          >
            <h2 className={styles.sectionTitle}>Our Values</h2>
            <div className={styles.values}>
              {VALUES.map((v) => (
                <motion.div key={v.title} className={styles.valueCard} variants={fadeUp}>
                  <div className={styles.valueIcon}>{v.icon}</div>
                  <h3 className={styles.valueTitle}>{v.title}</h3>
                  <p className={styles.valueText}>{v.text}</p>
                </motion.div>
              ))}
            </div>
          </motion.section>

          <motion.section
            className={styles.section}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25, ease: EASE_OUT_EXPO }}
          >
            <h2 className={styles.sectionTitle}>Our Vision</h2>
            <p className={styles.sectionText}>
              We envision a Uganda where every working person, regardless of their occupation, has a clear path to financial dignity in retirement. Through technology and community-based distribution, we aim to bring millions of currently unserved Ugandans into the formal savings ecosystem.
            </p>
            <p className={styles.sectionText}>
              Our team brings together expertise in financial services, technology, and community development. We are committed to building a platform that is not just a product, but a movement towards universal financial inclusion.
            </p>
          </motion.section>

          <motion.div
            className={styles.backLinkWrap}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3, ease: EASE_OUT_EXPO }}
          >
            <Link to="/" className={styles.backLink}>
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
