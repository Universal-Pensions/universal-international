import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

export default function AdminMobile() {
  return (
    <div className={styles.screen}>
      <section className={styles.hero}>
        <span className={styles.heroKick}><i></i>For administrators</span>
        <h1>Every account on the platform. <span className={styles.accent}>In one console.</span></h1>
        <p className={styles.sub}>The platform team&rsquo;s workspace — <strong>set up distributors and employers</strong>, <strong>approve access requests</strong>, and watch the whole country on one live map.</p>
        <p className={styles.sectLead} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'center', marginTop: 12 }}><svg width="16" height="16" style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--green-ink)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Country → region → district → branch → agent, plus every employer.</p>
      </section>

      <div className={cx(styles.card, styles.grad)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><span className={styles.eyebrow}>Platform overview</span><span className={styles.eyebrow}>All channels</span></div>
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
          <div className={styles.runKpi}><div className={styles.kl}>Members</div><div className={styles.kv}>~5,000</div><div className={styles.ks}>Across every channel</div></div>
          <div className={styles.runKpi}><div className={styles.kl}>Network savings</div><div className={cx(styles.kv, styles.g)}>UGX 42B</div><div className={styles.ks}>Held on the platform</div></div>
          <div className={styles.runKpi}><div className={styles.kl}>Branches</div><div className={styles.kv}>316</div><div className={styles.ks}>Across 4 regions</div></div>
          <div className={styles.runKpi}><div className={styles.kl}>Field agents</div><div className={styles.kv}>2,049</div><div className={styles.ks}>Onboarding countrywide</div></div>
        </div>
        <p className={styles.calcNote}>Illustrative figures for demonstration; your platform&rsquo;s totals will vary.</p>
      </div>

      <div className={styles.card}>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-soft'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3.5 9h17M3.5 15h17" /><path d="M12 3c2.6 3 2.6 15 0 18M12 3c-2.6 3-2.6 15 0 18" /></svg></span><div><b>Whole-platform view</b><small>Every role, every region</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-in'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="m9 14 2 2 4-4" /></svg></span><div><b>Approve &amp; open accounts</b><small>Accounts created in a few clicks</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-teal'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg></span><div><b>Live country map</b><small>Drill to any district or branch</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-green'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg></span><div><b>Platform reporting</b><small>Savings, contributions, members</small></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>For the platform team</p>
        <h2 className={styles.sectTitle}>Everything on the platform, in one place.</h2>
        <p className={styles.sectLead}>From the national picture to a single member — all in one place.</p>
      </div>
      <div className={styles.card}>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Platform-wide visibility</b><span>Every distributor, branch, agent, employer and member in one view.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Distributor &amp; employer management</b><span>Create a partner network or a company account, or switch one off.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Access requests &amp; new accounts</b><span>Approve an application and the real account is created there and then.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Platform reporting</b><span>Savings, contributions and growth for the whole country.</span></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>How head office works</p>
        <h2 className={styles.sectTitle}>From one login to the whole country.<br /><span className={styles.accent}>In four steps.</span></h2>
        <p className={styles.sectLead}>No spreadsheets, no calls to the field — it all runs from one console.</p>
      </div>
      <div className={styles.steps}>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-soft'])}><span className={styles.sn}>01</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg></span><div><h4>We set up your team</h4><p>Talk to us and we set up head-office logins for the people who need them.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Set up by us</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-green'])}><span className={styles.sn}>02</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z" /><path d="M9 3v16M15 5v16" /></svg></span><div><h4>See the whole platform</h4><p>Open the map and drill from the country down to a single agent or member.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Country to agent</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-teal'])}><span className={styles.sn}>03</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></svg></span><div><h4>Open distributors &amp; employers</h4><p>Add a partner network or a company and it goes live straight away.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Live straight away</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-in'])}><span className={styles.sn}>04</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 13h4l2 3h6l2-3h4" /><path d="M5 13V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><path d="m9.5 9 1.6 1.6L14.5 7" /></svg></span><div><h4>Approve who joins</h4><p>New partners and companies apply online — approve or decline in one tap.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Approve or decline</span></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>Why head office trusts it</p>
        <h2 className={styles.sectTitle}>Control you can trust.</h2>
        <p className={styles.sectLead}>Licensed products, the right access, and one set of platform numbers.</p>
      </div>
      <div className={styles.trustGrid}>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-in'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg></span><div className={styles.tv}>URBRA</div><div className={styles.tl}>Licensed &amp; regulated in Uganda</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-soft'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span><div className={styles.tv}>Right access</div><div className={styles.tl}>Every login sees only what it should</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-teal'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="3.5" r="1.5" /><circle cx="12" cy="20.5" r="1.5" /><circle cx="3.5" cy="12" r="1.5" /><circle cx="20.5" cy="12" r="1.5" /><path d="M12 5v4M12 15v4M5 12h4M15 12h4" /></svg></span><div className={styles.tv}>Consistent</div><div className={styles.tl}>Every role reads the same numbers</div></div>
        <div className={styles.trustCell}><span className={cx(styles.tIc, styles['t-green'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg></span><div className={styles.tv}>Live figures</div><div className={styles.tl}>Totals move as members save</div></div>
      </div>
    </div>
  );
}
