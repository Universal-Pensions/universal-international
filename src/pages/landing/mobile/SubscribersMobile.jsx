import { useNavigate } from 'react-router-dom';
import { calcFV, formatUGX } from './calc';
import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

export default function SubscribersMobile({ openCalc }) {
  const navigate = useNavigate();

  return (
    <div className={styles.screen}>
      <section className={styles.hero}>
        <span className={styles.heroKick}><i></i>For individuals</span>
        <h1>The best time to start saving was yesterday. Today is second best.</h1>
        <p className={styles.sub}><strong>Save for retirement</strong>, <strong>save for today</strong> and <strong>stay insured</strong> — all in one account.</p>
      </section>

      <button type="button" className={cx(styles.card, styles.grad, styles.calcPrev)} aria-label="Open the savings calculator" onClick={openCalc}>
        <div className={styles.cpTop}>
          <span className={styles.cpIc}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg></span>
          <div className={styles.cpTx}><b>See your growth</b><small>Tap to open the savings calculator</small></div>
          <span className={styles.cpArrow}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg></span>
        </div>
        <div className={styles.cpVal}>{formatUGX(calcFV(10000, 25))}</div>
        <div className={styles.cpValL}>Projected at retirement · UGX 10,000/mo for 25 years</div>
      </button>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Built for Uganda</p>
        <h2 className={styles.sectTitle}>Save and stay covered.<br /><span className={styles.accent}>As easy as mobile money.</span></h2>
        <p className={styles.sectLead}>Save, stay covered, and grow — all from your phone.</p>
      </div>
      <div className={styles.steps}>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-in'])}><span className={styles.sn}>01</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg></span><div><h4>Register in 3 minutes</h4><p>Just your phone number and National ID. No branch, no paperwork.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Any network · any phone</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-green'])}><span className={styles.sn}>02</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M11 18h2" /></svg></span><div><h4>Save what you can</h4><p>Top up by MTN or Airtel money anytime. Keep some to withdraw, grow the rest for retirement.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Save or withdraw anytime</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-teal'])}><span className={styles.sn}>03</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg></span><div><h4>Insurance, built in</h4><p>Life, Health and Funeral cover on the same account.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Life · Health · Funeral</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-soft'])}><span className={styles.sn}>04</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg></span><div><h4>We grow it for you</h4><p>We invest your retirement pot — around 10% a year — for income or a lump sum later.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>~10% a year</span></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Built for everyone</p>
        <h2 className={styles.sectTitle}>One platform. Every Ugandan.</h2>
        <p className={styles.sectLead}>Save for yourself, run payroll for a team, or build a network — one platform for each.</p>
      </div>
      <button type="button" className={cx(styles.evCard, styles.here)}><span className={cx(styles.evIc, styles['t-in'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></span><div><div className={styles.evKick}>For Subscribers</div><h4>Individuals</h4><p>Retirement savings plus Life, Health & Funeral cover, from your phone.</p><span className={styles.evLink}>You're here</span></div></button>
      <button type="button" className={styles.evCard} onClick={() => navigate('/employers')}><span className={cx(styles.evIc, styles['t-green'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></svg></span><div><div className={styles.evKick}>For Employers</div><h4>Employers</h4><p>Enrol staff, fund in bulk, and add group cover.</p><span className={styles.evLink}>Explore the employer platform <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></div><span className={styles.evChev}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg></span></button>
      <button type="button" className={styles.evCard} onClick={() => navigate('/distributors')}><span className={cx(styles.evIc, styles['t-teal'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg></span><div><div className={styles.evKick}>For Distributors</div><h4>Distributors</h4><p>Run branches and agents, manage commissions — from one map.</p><span className={styles.evLink}>Explore the distributor platform <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></div><span className={styles.evChev}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg></span></button>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Real stories</p>
        <h2 className={styles.sectTitle}>People saving — and protecting — their future.</h2>
      </div>
      <div className={styles.quotesScroll}>
        <div className={styles.quote} style={{ '--qc': 'var(--indigo)' }}><div className={styles.qm}>“</div><p>I work for myself. Now I save what I can — and my family is covered too.</p><div className={styles.qby}><span className={styles.qav}>AN</span><div><div className={styles.qn}>Aisha Namukasa</div><div className={styles.qr}>Tailoring business · Kampala</div></div></div></div>
        <div className={styles.quote} style={{ '--qc': 'var(--green)' }}><div className={styles.qm}>“</div><p>Paying 80 staff used to take days. Now I upload one file and it's done.</p><div className={styles.qby}><span className={styles.qav}>RO</span><div><div className={styles.qn}>Robert Ochieng</div><div className={styles.qr}>HR Manager · Logistics company</div></div></div></div>
        <div className={styles.quote} style={{ '--qc': 'var(--teal)' }}><div className={styles.qm}>“</div><p>I see my whole region on one map, compare branches, and settle commissions in a few clicks.</p><div className={styles.qby}><span className={styles.qav}>GA</span><div><div className={styles.qn}>Grace Atim</div><div className={styles.qr}>Network operations · Northern Uganda</div></div></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Why Ugandans trust us</p>
        <h2 className={styles.sectTitle}>Built to be relied on.</h2>
        <p className={styles.sectLead}>Regulated, secured, and built for the phone in your pocket.</p>
      </div>
      <div className={styles.trustGrid}>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-in'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg></span><div className={styles.tv}>URBRA</div><div className={styles.tl}>Licensed & regulated in Uganda</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-soft'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span><div className={styles.tv}>PCI DSS</div><div className={styles.tl}>Bank-grade payment security</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-teal'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="13" cy="12" r="3.5" /><path d="M7 8v8" /></svg></span><div className={styles.tv}>Ring-fenced</div><div className={styles.tl}>Funds held by an independent custodian</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-green'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span><div className={styles.tv}>83%</div><div className={styles.tl}>On-time contribution rate</div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Free for savers</p>
        <h2 className={styles.sectTitle}>Saving costs you nothing.</h2>
        <p className={styles.sectLead}>Open, save, withdraw — all free. We never take a fee.</p>
      </div>
      <div className={cx(styles.card, styles.feeHero, styles.grad)}><div className={styles.fl}>What you pay us</div><div className={styles.fv}>UGX 0</div><p>Every shilling you save stays yours. No charge to open, to save, or to withdraw.</p></div>
      <div className={styles.card}>
        <div className={styles.feePoint}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Free to open</b><span>Setting up your account costs nothing.</span></div></div>
        <div className={styles.feePoint}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Free to save & withdraw</b><span>Add money or take it out, no charges.</span></div></div>
        <div className={styles.feePoint}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>No hidden fees</b><span>No setup, statement or transaction fees, ever.</span></div></div>
      </div>
    </div>
  );
}
