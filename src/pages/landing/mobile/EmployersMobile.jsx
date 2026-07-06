import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

export default function EmployersMobile() {
  return (
    <div className={styles.screen}>
      <section className={styles.hero}>
        <span className={styles.heroKick} style={{ color: 'var(--green-ink)' }}><i />For employers</span>
        <h1>Grow your team's savings. <span className={styles.accent}>Protect every staff member.</span></h1>
        <p className={styles.sub}><strong>Pension contributions</strong> plus <strong>group Life, Health & Funeral cover</strong> — one workspace, clear reporting.</p>
      </section>

      <div className={cx(styles.card, styles.grad)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span className={styles.eyebrow}>Contribution funding split</span>
          <span className={styles.eyebrow}>Per run</span>
        </div>
        <div className={styles.splitLbl}><span>Employer share</span><span>Employee share</span></div>
        <div className={styles.splitBar}>
          <div className={cx(styles.seg, styles.emp)}><span className={styles.sgl}>Employer</span><span className={styles.sgv}>56%</span></div>
          <div className={cx(styles.seg, styles.you)}><span className={styles.sgl}>Employee</span><span className={styles.sgv}>44%</span></div>
        </div>
        <div className={styles.runKpis}>
          <div className={styles.runKpi}><div className={styles.kl}>Staff enrolled</div><div className={styles.kv}>80</div><div className={styles.ks}>100% participation</div></div>
          <div className={styles.runKpi}><div className={styles.kl}>June run — Settled</div><div className={cx(styles.kv, styles.g)}>UGX 9.6M</div><div className={styles.ks}>Settled in one upload</div></div>
        </div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow} style={{ color: 'var(--green-ink)' }}>Why employers choose us</p>
        <h2 className={styles.sectTitle}>A staff benefit that runs itself.</h2>
        <p className={styles.sectLead}>Enrol, fund and protect your team — no spreadsheets, no chasing.</p>
      </div>
      <div className={styles.card}>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Bulk enrolment & uploads</b><span>Onboard your whole roster from one spreadsheet.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Group Life, Health & Funeral cover</b><span>Company-wide cover, so a hard season doesn't wipe out your people.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Co-contribution splits</b><span>Set what the company funds and what staff add — applied automatically.</span></div></div>
        <div className={styles.featRow}><span className={styles.fpi}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg></span><div><b>Participation & compliance reporting</b><span>See enrolment and participation at a glance.</span></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>For Employers</p>
        <h2 className={styles.sectTitle}>From sign-up to your first run.<br /><span className={styles.accent}>In an afternoon, not a quarter.</span></h2>
        <p className={styles.sectLead}>Four steps, all from one workspace.</p>
      </div>
      <div className={styles.steps}>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-in'])}><span className={styles.sn}>01</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></svg></span><div><h4>Create your company account</h4><p>Register your business and invite your HR or finance team.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Minutes, not days</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-green'])}><span className={styles.sn}>02</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 13h6M9 17h4" /></svg></span><div><h4>Upload your staff roster</h4><p>One spreadsheet enrols everyone — names, IDs, salaries.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Bulk, not one-by-one</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-teal'])}><span className={styles.sn}>03</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 7.5 12 3 3 7.5 12 12l9-4.5Z" /><path d="M3 7.5v9L12 21l9-4.5v-9" /><path d="M12 12v9" /></svg></span><div><h4>Set the co-contribution split</h4><p>Decide what the company funds and what staff add.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>Employer + employee</span></div></div>
        <div className={styles.stepCard}><span className={cx(styles.sIc, styles['t-soft'])}><span className={styles.sn}>04</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg></span><div><h4>Run contributions & cover</h4><p>Settle the run in one upload and switch on cover company-wide.</p><span className={styles.schip}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>One upload · fully covered</span></div></div>
      </div>

      <div className={styles.sect}>
        <p className={styles.eyebrow}>From an employer</p>
        <h2 className={styles.sectTitle}>A benefit your team feels — and you can run.</h2>
      </div>
      <div className={styles.quote} style={{ '--qc': 'var(--green)' }}><div className={styles.qm}>“</div><p>Paying 80 employees used to take days. Now I upload one file and it's done — and the board sees participation at a glance.</p><div className={styles.qby}><span className={styles.qav}>RO</span><div><div className={styles.qn}>Robert Ochieng</div><div className={styles.qr}>HR Manager · Logistics company</div></div></div></div>

      <div className={styles.card}>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-in'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg></span><div><b>URBRA-regulated</b><small>Licensed in Uganda</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-teal'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="13" cy="12" r="3.5" /><path d="M7 8v8" /></svg></span><div><b>Segregated funds</b><small>Held by an independent custodian</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-soft'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span><div><b>PCI DSS</b><small>Bank-grade payment security</small></div></div>
        <div className={styles.stripCard}><span className={cx(styles.sIc, styles['t-green'])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 9h6M9 13h4" /></svg></span><div><b>Clear reporting</b><small>Participation & compliance at a glance</small></div></div>
      </div>
    </div>
  );
}
