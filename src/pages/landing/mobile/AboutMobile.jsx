import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

export default function AboutMobile() {
  return (
    <div className={styles.screen}>
      <div className={styles.aboutHero}>
        <h3>About Universal Pensions</h3>
        <p>Making long-term savings simple, accessible, and meaningful for every Ugandan.</p>
      </div>

      <div className={styles.sect}><p className={styles.eyebrow}>Our mission</p></div>
      <div className={styles.card}>
        <p className={styles.prose}>Retirement saving shouldn’t be only for office workers. We bring regulated pension savings to everyone — boda riders, market vendors, farmers and freelancers.</p>
        <p className={styles.prose}>Easy to use on your phone, with agents near you — so saving fits your life.</p>
      </div>

      <div className={styles.sect}><p className={styles.eyebrow}>How it works</p></div>
      <div className={styles.steps}>
        <div className={styles.stepCard}>
          <span className={cx(styles.sIc, styles['t-in'])}>
            <span className={styles.sn}>01</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/></svg>
          </span>
          <div>
            <h4>Register</h4>
            <p>Sign up on the app or with an agent. Just a phone number and National ID.</p>
          </div>
        </div>
        <div className={styles.stepCard}>
          <span className={cx(styles.sIc, styles['t-green'])}>
            <span className={styles.sn}>02</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M11 18h2"/></svg>
          </span>
          <div>
            <h4>Contribute</h4>
            <p>Pay in by mobile money, bank transfer or your employer — from UGX 5,000.</p>
          </div>
        </div>
        <div className={styles.stepCard}>
          <span className={cx(styles.sIc, styles['t-teal'])}>
            <span className={styles.sn}>03</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 14 3-3 3 3 5-6"/></svg>
          </span>
          <div>
            <h4>Grow</h4>
            <p>We invest your savings professionally so they grow steadily over time.</p>
          </div>
        </div>
      </div>

      <div className={styles.sect}><p className={styles.eyebrow}>Our values</p></div>
      <div className={styles.valGrid}>
        <div className={styles.valCard}>
          <span className={styles.vIc}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg></span>
          <b>Accessibility</b>
          <p>Retirement savings for every Ugandan, whatever your job or income.</p>
        </div>
        <div className={styles.valCard}>
          <span className={styles.vIc}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>
          <b>Transparency</b>
          <p>Clear on fees and returns. No hidden charges.</p>
        </div>
        <div className={styles.valCard}>
          <span className={styles.vIc}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
          <b>Trust</b>
          <p>Licensed by URBRA, built to protect every shilling.</p>
        </div>
        <div className={styles.valCard}>
          <span className={styles.vIc}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/></svg></span>
          <b>Inclusion</b>
          <p>Built for informal workers, farmers and the self-employed.</p>
        </div>
      </div>

      <div className={styles.sect}><p className={styles.eyebrow}>Our vision</p></div>
      <div className={styles.card}>
        <p className={styles.prose}>A Uganda where every worker has a clear path to dignity in retirement. We want to bring millions of unserved Ugandans into formal savings.</p>
        <p className={styles.prose}>Not just a product — a movement towards financial inclusion for all.</p>
      </div>
    </div>
  );
}
