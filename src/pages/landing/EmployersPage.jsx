import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSignIn } from '../../contexts/SignInContext';
import Footer from '../../components/Footer';
import LandingHeader from './LandingHeader';
import styles from './landing.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);
const ArrowLink = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const Check = ({ w = '2.6' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
);
const Shield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /></svg>
);
const Building = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></svg>
);

export default function EmployersPage() {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const rootRef = useRef(null);

  const goSignup = () => navigate('/signup');
  const goContact = () => navigate('/contact');
  const openSignIn = () => signIn.open();
  const onLogin = (e) => { e.preventDefault(); signIn.open(); };

  // Entrance reveals — same JS-gated pattern as SubscribersPage.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add(styles.in); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    Array.from(root.querySelectorAll(`.${styles.reveal}`)).forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <div className={styles.page} ref={rootRef}>
      <LandingHeader active="employers" ctaLabel="Get started" />

      <main id="main">
        {/* hero — employer-catered */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={cx(styles.wrap, styles.heroGrid)}>
            <div>
              <h1 id="hero-title">Grow your team&rsquo;s savings.<br /><span className={styles.accent}>Protect every staff member.</span></h1>
              <p className={styles.sub}><strong>Pension contributions</strong> plus <strong>group Life, Health &amp; Funeral cover</strong> — one workspace, reporting your board will actually read.</p>
              <div className={styles.heroCta}>
                <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={goSignup}>Set up your company <Arrow /></button>
                <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={openSignIn}>Log in to your account</button>
              </div>
              <p className={styles.heroMeta}>
                <Check w="2.4" />
                Onboard your whole roster from one spreadsheet.
              </p>
              <div className={cx(styles.heroStats, styles.tabNums)} role="list" aria-label="Employer platform proof points">
                <div className={styles.st} role="listitem"><div className={styles.sv}>1 upload</div><div className={styles.sl}>Whole roster onboarded</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>100%</div><div className={styles.sl}>Participation visibility</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>Life·Health·Funeral</div><div className={styles.sl}>Group cover, company-wide</div></div>
              </div>
            </div>

            {/* employer login card (mirrors subscriber calculator slot) */}
            <div className={styles.loginCard} role="region" aria-labelledby="login-title">
              <div className={styles.loginHead}>
                <div className={styles.loginEyebrow}>Employer access</div>
                <h2 className={styles.loginTitle} id="login-title">Log in to your employer account</h2>
                <p className={styles.loginSub}>Manage your roster, contribution runs and group cover from one workspace.</p>
              </div>
              <form onSubmit={onLogin} noValidate>
                <div className={styles.field}>
                  <label htmlFor="emp-login-id">Account email or company ID</label>
                  <input type="text" id="emp-login-id" name="account" autoComplete="username" inputMode="email" placeholder="hr@yourcompany.co.ug" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="emp-login-password">Password</label>
                  <input type="password" id="emp-login-password" name="password" autoComplete="current-password" placeholder="Enter your password" />
                </div>
                <div className={styles.loginCta}>
                  <button type="submit" className={cx(styles.btn, styles.btnPrimary)}>Log in <Arrow /></button>
                </div>
              </form>
              <button type="button" className={styles.loginForgot} onClick={openSignIn}>Forgot password?</button>
              <div className={styles.loginDiv} aria-hidden="true">New here?</div>
              <button type="button" className={cx(styles.btn, styles.btnSecondary, styles.loginNew)} onClick={goContact}>Request a demo <Arrow /></button>
              <p className={styles.loginNote}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                Bank-grade security · your staff and contribution data stay private.
              </p>
            </div>
          </div>
        </section>

        {/* value props — feature rows + funding-split visual */}
        <section className={styles.aud} id="value" aria-labelledby="value-title">
          <div className={cx(styles.wrap, styles.audGrid)}>
            <div className={styles.audCopy}>
              <span className={styles.audTag} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }}>
                <Building />
                Why employers choose us
              </span>
              <h2 id="value-title">A staff benefit that runs itself.</h2>
              <p className={styles.ad}>Enrol, fund, and protect your whole team — without the spreadsheets, the chasing, or the paperwork.</p>
              <ul className={styles.feat} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }}>
                {[
                  ['Bulk enrolment & uploads', 'Onboard your entire roster from a single spreadsheet — no one-by-one forms, no branch visits.'],
                  ['Group Life, Health & Funeral cover', 'Extend company-wide protection so a hard season never wipes out what your people have built.'],
                  ['Co-contribution splits', 'Set how much the company funds and how much each employee adds — applied automatically every run.'],
                  ['Participation & compliance reporting', 'See enrolment, participation and contribution health at a glance — reporting your board will actually read.'],
                ].map(([b, s]) => (
                  <li key={b}>
                    <span className={styles.tick} aria-hidden="true"><Check /></span>
                    <span className={styles.ft}><b>{b}</b><span>{s}</span></span>
                  </li>
                ))}
              </ul>
              <div className={styles.audActions}>
                <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={goSignup}>Set up your company <Arrow /></button>
                <a className={styles.txtlink} href="#how">See how onboarding works <ArrowLink /></a>
              </div>
            </div>

            {/* visual: funding split + June run */}
            <div className={styles.audVis}>
              <div className={cx(styles.vcard, styles.reveal)}>
                <div className={styles.vcardHead}>
                  <span className={styles.chip} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></span>
                  <span className={styles.vt}>Contribution funding split</span>
                  <span className={styles.vmeta}>Per run</span>
                </div>
                <div className={styles.splitL}><span>Employer share</span><span>Employee share</span></div>
                <div className={cx(styles.split, styles.tabNums)} role="img" aria-label="Funding split: employer 56 percent, employee 44 percent">
                  <div className={cx(styles.seg, styles.emp)}><span className={styles.sgl}>Employer</span><span className={styles.sgv}>56%</span></div>
                  <div className={cx(styles.seg, styles.you)}><span className={styles.sgl}>Employee</span><span className={styles.sgv}>44%</span></div>
                </div>
              </div>
              <div className={cx(styles.vcard, styles.reveal)}>
                <div className={styles.vcardHead}>
                  <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg></span>
                  <span className={styles.vt}>June contribution run</span>
                  <span className={styles.vmeta}>Settled</span>
                </div>
                <div className={cx(styles.kpis, styles.tabNums)}>
                  <div className={styles.kpi}>
                    <div className={styles.kl}>Staff enrolled</div>
                    <div className={styles.kv}>80</div>
                    <div className={styles.ks}>100% participation</div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kl}>Run total</div>
                    <div className={cx(styles.kv, styles.g)}>UGX 9.6M</div>
                    <div className={styles.ks}>Settled in one upload</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* how employer onboarding works */}
        <section className={styles.how} id="how" aria-labelledby="how-title">
          <div className={styles.wrap}>
            <div className={styles.howHead}>
              <p className={styles.eyebrow}>For Employers</p>
              <h2 className={styles.h2} id="how-title">From sign-up to your first run.<br /><span style={{ color: 'var(--indigo-soft)' }}>In an afternoon, not a quarter.</span></h2>
              <p className={styles.lead}>Four steps, all from one workspace.</p>
            </div>
            <div className={styles.steps}>
              {[
                ['01', 'var(--indigo)', '41,40,103', <path key="i" d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" />, 'Create your company account', 'Register your business, add your details and invite your HR or finance team.', 'Minutes, not days'],
                ['02', 'var(--green-ink)', '46,139,87', <><path key="a" d="M14 3v4a1 1 0 0 0 1 1h4" /><path key="b" d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path key="c" d="M9 13h6M9 17h4" /></>, 'Upload your staff roster', 'One spreadsheet enrols everyone — names, IDs and salaries in a single import.', 'Bulk, not one-by-one'],
                ['03', 'var(--teal-ink)', '47,143,157', <><path key="a" d="M21 7.5 12 3 3 7.5 12 12l9-4.5Z" /><path key="b" d="M3 7.5v9L12 21l9-4.5v-9" /><path key="c" d="M12 12v9" /></>, 'Set the co-contribution split', 'Decide what the company funds and what each employee adds — applied automatically.', 'Employer + employee'],
                ['04', 'var(--indigo-soft)', '94,99,168', <><path key="a" d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path key="b" d="m9 12 2 2 4-4" /></>, 'Run contributions & cover', 'Settle the whole run in one upload and switch on Life · Health · Funeral cover company-wide.', 'One upload · fully covered'],
              ].map(([n, ac, tint, icon, h, p, chip]) => (
                <article key={n} className={cx(styles.step, styles.reveal)}>
                  <div className={styles.sn}>{n}</div>
                  <span className={styles.chip} style={{ '--ac': ac, '--tint': tint }} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
                  </span>
                  <h3>{h}</h3>
                  <p>{p}</p>
                  <span className={styles.schip}><Check /> {chip}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* employer testimonial */}
        <section className={styles.stories} aria-labelledby="stories-title">
          <div className={styles.wrap}>
            <div className={styles.storiesHead}>
              <p className={styles.eyebrow}>From an employer</p>
              <h2 className={styles.h2} id="stories-title">A benefit your team feels — and you can run.</h2>
            </div>
            <div className={styles.quotes} style={{ gridTemplateColumns: '1fr' }}>
              <div className={cx(styles.quote, styles.reveal)} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }}>
                <div className={styles.qm} aria-hidden="true">&ldquo;</div>
                <p>Managing contributions for 80 employees used to take days. Now I upload a file and it&rsquo;s done. The reporting is clear, our staff value the savings and the cover, and the board finally sees participation at a glance.</p>
                <div className={styles.qby}><span className={styles.qav} aria-hidden="true">RO</span><div><div className={styles.qn}>Robert Ochieng</div><div className={styles.qr}>HR Manager · Logistics company</div></div></div>
              </div>
            </div>
          </div>
        </section>

        {/* trust strip */}
        <div className={styles.strip} aria-label="Why employers trust Universal Pensions">
          <div className={cx(styles.wrap, styles.stripIn)}>
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><Shield /></span>
              <div><div className={styles.bt}>URBRA-regulated</div><div className={styles.bs}>Licensed in Uganda</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="13" cy="12" r="3.5" /><path d="M7 8v8" /></svg></span>
              <div><div className={styles.bt}>Segregated funds</div><div className={styles.bs}>Held by an independent custodian</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo-soft)', '--tint': '94,99,168' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>
              <div><div className={styles.bt}>PCI DSS</div><div className={styles.bs}>Bank-grade payment security</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 9h6M9 13h4" /></svg></span>
              <div><div className={styles.bt}>Clear reporting</div><div className={styles.bs}>Participation &amp; compliance at a glance</div></div>
            </div>
          </div>
        </div>

        {/* final CTA */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.wrap}>
            <div className={cx(styles.ctaCard, styles.reveal)}>
              <div className={styles.ctaGrid}>
                <div>
                  <p className={styles.eyebrow}>Set up your company · Onboard from one spreadsheet</p>
                  <h2 id="cta-title">Set your team up in an afternoon.<br /><span className={styles.accent}>Run the first contribution today.</span></h2>
                  <p>Create your company account, upload your roster, set the split, and switch on group Life · Health · Funeral cover — all in one workspace.</p>
                  <div className={styles.ctaActions}>
                    <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={goSignup}>Set up your company <Arrow /></button>
                    <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={goContact}>Talk to our team</button>
                  </div>
                </div>
                <div className={cx(styles.proj, styles.tabNums)} aria-label="Illustrative contribution run">
                  <div className={styles.pl}>June contribution run</div>
                  <div className={styles.pv}>UGX 9.6M</div>
                  <div className={styles.pmeta}><span className={styles.badge}>Settled</span><span className={styles.pn}>80 staff · 100% participation</span></div>
                  <div className={styles.pcover}><Shield /><span>Group Life · Health · Funeral cover, company-wide</span></div>
                  <p className={styles.pcaveat}>Illustrative figures for a sample roster; actual runs reflect your own staff and splits.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
