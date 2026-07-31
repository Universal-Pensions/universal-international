import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import Footer from '../../components/Footer';
import LandingNav from './LandingNav';
import LandingLoginCard from './LandingLoginCard';
import { Reveal } from './motion';
import { useIsMobile } from '../../hooks/useIsMobile';
import styles from './landing.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);
const Check = ({ w = '2.6' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
);
const Shield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /></svg>
);

// Feature rows for the "A staff benefit that runs itself" value section.
const FEATURES = [
  ['Bulk enrolment & uploads', 'Onboard your entire roster from a single spreadsheet — no one-by-one forms, no branch visits.'],
  ['Group Life, Health & Funeral cover', 'Extend company-wide protection so a hard season never wipes out what your people have built.'],
  ['Staff and company contributions', 'Set what comes out of staff pay and what the company adds — a share of pay or a flat amount, and either can be nothing.'],
  ['Participation & compliance reporting', 'See enrolment, participation and contribution health at a glance — reporting your board will actually read.'],
];

// Employer onboarding steps.
const STEPS = [
  ['01', 'var(--indigo)', '41,40,103', <><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></>, 'Create your company account', 'Register your business, add your details and invite your HR or finance team.', 'Minutes, not days'],
  ['02', 'var(--green-ink)', '46,139,87', <><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 13h6M9 17h4" /></>, 'Upload your staff roster', 'One spreadsheet enrols everyone — names, IDs and salaries in a single import.', 'Bulk, not one-by-one'],
  ['03', 'var(--teal-ink)', '47,143,157', <><path d="M21 7.5 12 3 3 7.5 12 12l9-4.5Z" /><path d="M3 7.5v9L12 21l9-4.5v-9" /><path d="M12 12v9" /></>, 'Set the two contribution amounts', 'Decide what comes out of staff pay and what the company adds — a share of pay or a flat amount, applied automatically.', 'Employer + employee'],
  ['04', 'var(--indigo-soft)', '94,99,168', <><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></>, 'Run contributions & cover', 'Settle the whole run in one upload and switch on Life · Health · Funeral cover company-wide.', 'One upload · fully covered'],
];

// Trust strip badges.
const TRUST = [
  ['var(--indigo)', '41,40,103', <><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></>, 'URBRA-regulated', 'Licensed in Uganda'],
  ['var(--teal-ink)', '47,143,157', <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="13" cy="12" r="3.5" /><path d="M7 8v8" /></>, 'Segregated funds', 'Held by an independent custodian'],
  ['var(--indigo-soft)', '94,99,168', <><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, 'PCI DSS', 'Bank-grade payment security'],
  ['var(--green-ink)', '46,139,87', <><path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 9h6M9 13h4" /></>, 'Clear reporting', 'Participation & compliance at a glance'],
];

export default function EmployersPage() {
  const heroRef = useRef(null);
  const reduce = useReducedMotion();
  const isMobile = useIsMobile();
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', '30%']);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.72], [1, 0]);
  const parallax = !reduce && !isMobile;

  const scrollToLogin = () =>
    document.getElementById('login')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div className={styles.page}>
      <LandingNav active="employer" onSignIn={scrollToLogin} ctaLabel="Get started" ctaTo="/request-access?type=employer" />

      <main id="main">
        {/* hero — employer copy + hero stats, login card on the right */}
        <section ref={heroRef} className={styles.hero} aria-labelledby="hero-title">
          <motion.div className={cx(styles.wrap, styles.heroGrid)} style={parallax ? { y: heroY, opacity: heroOpacity } : undefined}>
            <div>
              <h1 className={styles.heroReveal} id="hero-title">Grow your team&rsquo;s savings.<br /><span className={styles.accent}>Protect every staff member.</span></h1>
              <p className={cx(styles.sub, styles.heroReveal)}><strong>Pension contributions</strong> plus <strong>group Life, Health &amp; Funeral cover</strong> — one workspace, reporting your board will actually read.</p>
              <div className={cx(styles.heroCta, styles.heroReveal)}>
                <Link className={cx(styles.btn, styles.btnPrimary)} to="/request-access?type=employer">Set up your company <Arrow /></Link>
                <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={scrollToLogin}>Log in to your account</button>
              </div>
              <p className={cx(styles.heroMeta, styles.heroReveal)}>
                <Check w="2.4" />
                Onboard your whole roster from one spreadsheet.
              </p>
              <div className={cx(styles.heroStats, styles.tabNums, styles.heroReveal)} role="list" aria-label="Employer platform proof points">
                <div className={styles.st} role="listitem"><div className={styles.sv}>1 upload</div><div className={styles.sl}>Whole roster onboarded</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>100%</div><div className={styles.sl}>Participation visibility</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>Life·Health·Funeral</div><div className={styles.sl}>Group cover, company-wide</div></div>
              </div>
            </div>

            {/* employer login card (hero right) — real phone + OTP/password auth */}
            <LandingLoginCard audience="employer" footerPrompt="New here?" footerLabel="Request a demo" footerHref="/request-access?type=employer" />
          </motion.div>
        </section>

        {/* value props — feature rows + funding-split visual */}
        <section className={styles.aud} id="value" aria-labelledby="value-title">
          <div className={cx(styles.wrap, styles.audGrid)}>
            <div className={styles.audCopy}>
              <span className={styles.audTag} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></svg>
                Why employers choose us
              </span>
              <h2 id="value-title">A staff benefit that runs itself.</h2>
              <p className={styles.ad}>Enrol, fund, and protect your whole team — without the spreadsheets, the chasing, or the paperwork.</p>
              <ul className={styles.feat} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }}>
                {FEATURES.map(([b, s], i) => (
                  <Reveal as="li" key={b} delay={i * 0.06}>
                    <span className={styles.tick} aria-hidden="true"><Check /></span>
                    <span className={styles.ft}><b>{b}</b><span>{s}</span></span>
                  </Reveal>
                ))}
              </ul>
              <div className={styles.audActions}>
                <Link className={cx(styles.btn, styles.btnPrimary)} to="/request-access?type=employer">Set up your company <Arrow /></Link>
                <a className={styles.txtlink} href="#how">See how onboarding works
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </a>
              </div>
            </div>

            {/* visual: funding split + June run mini */}
            <div className={styles.audVis}>
              <Reveal className={styles.vcard} scale={0.97} delay={0}>
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
              </Reveal>
              <Reveal className={styles.vcard} scale={0.97} delay={0.1}>
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
              </Reveal>
            </div>
          </div>
        </section>

        {/* how employer onboarding works */}
        <section className={styles.how} id="how" aria-labelledby="how-title">
          <div className={styles.wrap}>
            <Reveal className={styles.howHead}>
              <p className={styles.eyebrow}>For Employers</p>
              <h2 className={styles.h2} id="how-title">From sign-up to your first run.<br /><span style={{ color: 'var(--indigo-soft)' }}>In an afternoon, not a quarter.</span></h2>
              <p className={styles.lead}>Four steps, all from one workspace.</p>
            </Reveal>
            <div className={styles.steps}>
              {STEPS.map(([n, ac, tint, icon, h, p, chip], i) => (
                <Reveal as="article" key={n} className={styles.step} scale={0.97} delay={i * 0.08} style={{ '--ac': ac }}>
                  <div className={styles.sn}>{n}</div>
                  <span className={styles.chip} style={{ '--ac': ac, '--tint': tint }} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
                  </span>
                  <h3>{h}</h3>
                  <p>{p}</p>
                  <span className={styles.schip}><Check /> {chip}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* employer testimonial (single, full-width) */}
        <section className={styles.stories} aria-labelledby="stories-title">
          <div className={styles.wrap}>
            <Reveal className={styles.storiesHead}>
              <p className={styles.eyebrow}>From an employer</p>
              <h2 className={styles.h2} id="stories-title">A benefit your team feels — and you can run.</h2>
            </Reveal>
            <div className={styles.quotes} style={{ gridTemplateColumns: '1fr' }}>
              <Reveal className={styles.quote} scale={0.97} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }}>
                <div className={styles.qm} aria-hidden="true">&ldquo;</div>
                <p>Managing contributions for 80 employees used to take days. Now I upload a file and it&rsquo;s done. The reporting is clear, our staff value the savings and the cover, and the board finally sees participation at a glance.</p>
                <div className={styles.qby}><span className={styles.qav} aria-hidden="true">RO</span><div><div className={styles.qn}>Robert Ochieng</div><div className={styles.qr}>HR Manager · Logistics company</div></div></div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* trust strip */}
        <div className={styles.strip} aria-label="Why employers trust Universal Pensions">
          <div className={cx(styles.wrap, styles.stripIn)}>
            {TRUST.map(([ac, tint, icon, bt, bs], i) => (
              <div key={bt} style={{ display: 'contents' }}>
                {i > 0 && <div className={styles.sep} aria-hidden="true" />}
                <div className={styles.badge}>
                  <span className={styles.chip} style={{ '--ac': ac, '--tint': tint }} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
                  </span>
                  <div><div className={styles.bt}>{bt}</div><div className={styles.bs}>{bs}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* final CTA band (shared light ctaCard) */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.wrap}>
            <Reveal className={styles.ctaCard} scale={0.98}>
              <div className={styles.ctaGrid}>
                <div>
                  <p className={styles.eyebrow}>Set up your company · Onboard from one spreadsheet</p>
                  <h2 id="cta-title">Set your team up in an afternoon.<br /><span className={styles.accent}>Run the first contribution today.</span></h2>
                  <p>Create your company account, upload your roster, set what staff and the company each put in, and switch on group Life · Health · Funeral cover — all in one workspace.</p>
                  <div className={styles.ctaActions}>
                    <Link className={cx(styles.btn, styles.btnPrimary)} to="/request-access?type=employer">Set up your company <Arrow /></Link>
                    <Link className={cx(styles.btn, styles.btnSecondary)} to="/contact">Talk to our team</Link>
                  </div>
                </div>
                <div className={cx(styles.proj, styles.tabNums)} aria-label="Illustrative contribution run">
                  <div className={styles.pl}>June contribution run</div>
                  <div className={styles.pv}>UGX 9.6M</div>
                  <div className={styles.pmeta}><span className={styles.badge}>Settled</span><span className={styles.pn}>80 staff · 100% participation</span></div>
                  <div className={styles.pcover}><Shield /><span>Group Life · Health · Funeral cover, company-wide</span></div>
                  <p className={styles.pcaveat}>Illustrative figures for a sample roster; actual runs reflect your own staff and the amounts you set.</p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
