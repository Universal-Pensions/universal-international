import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

export default function DistributorsMobile() {
  return (
    <div className={styles.screen}>
      <section className={styles.hero}>
        <span className={styles.heroKick} style={{ color: 'var(--teal-ink)' }}><i></i>For distributors</span>
        <h1>Run your whole network <span className={styles.accent}>from one map.</span></h1>
        <p className={styles.sub}>Run branches and field agents from one map — <strong>compare performance</strong>, <strong>manage commissions</strong>, and settle dues fast.</p>
        <p className={styles.sectLead} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'center', marginTop: 12 }}><svg width="16" height="16" style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--green-ink)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Country → region → district → branch → agent, on one map.</p>
      </section>

      <div className={cx(styles.card, styles.grad)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><span className={styles.eyebrow}>Network overview</span><span className={styles.eyebrow}>All regions</span></div>
        <div className={styles.mapMini} role="img" aria-label="Stylised map of Uganda with branch clusters across Central, Western and Northern regions">
          <svg viewBox="0 0 360 188" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <defs><linearGradient id="ugFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5E63A8" stopOpacity=".20" /><stop offset="1" stopColor="#292867" stopOpacity=".10" /></linearGradient></defs>
            <path d="M70 36 L132 26 L176 38 L214 30 L262 46 L296 40 L312 70 L300 104 L312 132 L288 158 L236 166 L196 154 L150 162 L104 150 L74 124 L58 92 L66 62 Z" fill="url(#ugFill)" stroke="#5E63A8" strokeOpacity=".55" strokeWidth="2" strokeLinejoin="round" />
            <path d="M150 162 L160 96 L132 26" fill="none" stroke="#292867" strokeOpacity=".18" strokeWidth="1.4" strokeDasharray="4 4" />
            <path d="M160 96 L300 104" fill="none" stroke="#292867" strokeOpacity=".18" strokeWidth="1.4" strokeDasharray="4 4" />
            <circle cx="138" cy="58" r="9" fill="#1f6e44" fillOpacity=".18" /><circle cx="138" cy="58" r="4" fill="#1f6e44" />
            <circle cx="190" cy="66" r="6" fill="#1f6e44" fillOpacity=".16" /><circle cx="190" cy="66" r="3" fill="#1f6e44" />
            <circle cx="104" cy="118" r="7" fill="#1F6E7A" fillOpacity=".16" /><circle cx="104" cy="118" r="3.4" fill="#1F6E7A" />
            <circle cx="132" cy="138" r="6" fill="#1F6E7A" fillOpacity=".16" /><circle cx="132" cy="138" r="3" fill="#1F6E7A" />
            <circle cx="220" cy="120" r="13" fill="#292867" fillOpacity=".16" /><circle cx="220" cy="120" r="5.5" fill="#292867" />
            <circle cx="252" cy="138" r="7" fill="#292867" fillOpacity=".16" /><circle cx="252" cy="138" r="3.4" fill="#292867" />
            <circle cx="196" cy="138" r="6" fill="#292867" fillOpacity=".16" /><circle cx="196" cy="138" r="3" fill="#292867" />
          </svg>
        </div>
        <div className={styles.runKpis}>
          <div className={styles.runKpi}><div className={styles.kl}>Branches</div><div className={styles.kv}>316</div><div className={styles.ks}>Across 4 regions</div></div>
          <div className={styles.runKpi}><div className={styles.kl}>Active agents</div><div className={cx(styles.kv, styles.g)}>2,049</div><div className={styles.ks}>+124 this quarter</div></div>
        </div>
      </div>

      <div className={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><span className={styles.eyebrow}>Region performance</span><span className={styles.eyebrow}>This month</span></div>
        <div className={styles.rrow}><span className={styles.ri}>C</span><div><div className={styles.rn}>Central</div><div className={styles.rs}>128 branches · 842 agents</div></div><div className={styles.rv}><div className={styles.rvb}>UGX 21B</div><div className={styles.rvc}>+8.2% MoM</div></div></div>
        <div className={styles.rrow}><span className={styles.ri}>W</span><div><div className={styles.rn}>Western</div><div className={styles.rs}>94 branches · 611 agents</div></div><div className={styles.rv}><div className={styles.rvb}>UGX 12B</div><div className={styles.rvc}>+6.1% MoM</div></div></div>
        <div className={styles.rrow}><span className={styles.ri}>N</span><div><div className={styles.rn}>Northern</div><div className={styles.rs}>61 branches · 397 agents</div></div><div className={styles.rv}><div className={styles.rvb}>UGX 9B</div><div className={styles.rvc}>+9.4% MoM</div></div></div>
      </div>

      <div className={styles.card}>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-in'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg></span><div><b>Branch &amp; agent map</b><small>One view of the whole network</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-teal'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg></span><div><b>Live performance</b><small>Compare any two branches</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-green'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></span><div><b>Commission settlement</b><small>Pay dues in a few clicks</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-soft'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 9h6M9 13h4" /></svg></span><div><b>Strategic reports</b><small>Export region &amp; district trends</small></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow} style={{ color: 'var(--teal-ink)' }}>For Distributors &amp; Partners</p>
        <h2 className={styles.sectTitle}>Everything your network needs, in one place.</h2>
        <p className={styles.sectLead}>From the national picture to a single agent — all in one console.</p>
      </div>
      <div className={styles.card}>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Network-wide visibility</b><span>Every branch and agent on one live map — drill from country to district.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Branch &amp; agent comparison</b><span>Rank performers side by side to see where to invest.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Commission management</b><span>Track what's owed and settle dues in a few clicks.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Strategic reporting</b><span>Export region and district trends to plan expansion.</span></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>How the partnership works</p>
        <h2 className={styles.sectTitle}>From handshake to a thriving network.<br /><span className={styles.accent}>In four steps.</span></h2>
        <p className={styles.sectLead}>We bring the platform and products. You bring the local reach.</p>
      </div>
      <div className={styles.steps}>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-in'])}><span className={styles.sn}>01</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg></span><div><h4>Partner with us</h4><p>Request access and we'll set up your account and commission terms.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Onboarding &amp; support</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-green'])}><span className={styles.sn}>02</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5" /></svg></span><div><h4>Onboard branches &amp; agents</h4><p>Add branches and agents, set their districts — they go live on the map.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Map them by district</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-teal'])}><span className={styles.sn}>03</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg></span><div><h4>Grow your member base</h4><p>Your agents sell pensions and insurance while you watch the numbers climb.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Pensions + insurance</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-soft'])}><span className={styles.sn}>04</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg></span><div><h4>Review &amp; settle commissions</h4><p>See what each branch and agent earned, settle in a few clicks.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Settle in a few clicks</span></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Real stories</p>
        <h2 className={styles.sectTitle}>Networks that run on the map.</h2>
      </div>
      <div className={styles.quotesScroll}>
        <div className={styles.quote} style={{ '--qc': 'var(--teal)' }}><div className={styles.qm}>“</div><p>I see my whole region on one map, settle commissions in a few clicks, and my agents get paid on time.</p><div className={styles.qby}><span className={styles.qav}>GA</span><div><div className={styles.qn}>Grace Atim</div><div className={styles.qr}>Network operations · Northern Uganda</div></div></div></div>
        <div className={styles.quote} style={{ '--qc': 'var(--indigo)' }}><div className={styles.qm}>“</div><p>Onboarding a new branch takes minutes, not weeks. Add an agent and they're on the map right away.</p><div className={styles.qby}><span className={styles.qav}>DM</span><div><div className={styles.qn}>David Mugisha</div><div className={styles.qr}>Regional lead · Western Uganda</div></div></div></div>
        <div className={styles.quote} style={{ '--qc': 'var(--green)' }}><div className={styles.qm}>“</div><p>Commission disputes used to eat my week. Now every agent sees a clear statement and I settle the whole district from one screen.</p><div className={styles.qby}><span className={styles.qav}>SN</span><div><div className={styles.qn}>Sarah Nakato</div><div className={styles.qr}>Branch coordinator · Central Uganda</div></div></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Why partners trust us</p>
        <h2 className={styles.sectTitle}>A network you can build on.</h2>
        <p className={styles.sectLead}>Regulated products, clear settlement, nationwide reach.</p>
      </div>
      <div className={styles.trustGrid}>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-in'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg></span><div className={styles.tv}>URBRA</div><div className={styles.tl}>Licensed &amp; regulated in Uganda</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-soft'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg></span><div className={styles.tv}>4 regions</div><div className={styles.tl}>Nationwide branch coverage</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-teal'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg></span><div className={styles.tv}>Transparent</div><div className={styles.tl}>Every commission, fully traceable</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-green'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span><div className={styles.tv}>Same-day</div><div className={styles.tl}>Settle commissions when you choose</div></div>
      </div>
    </div>
  );
}
