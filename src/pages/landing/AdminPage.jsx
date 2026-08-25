import { Fragment, useRef } from 'react';
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
const ArrowLink = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const Check = ({ w = '2.6' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
);
const Shield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg>
);
const NetworkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="3.5" r="1.5" /><circle cx="12" cy="20.5" r="1.5" /><circle cx="3.5" cy="12" r="1.5" /><circle cx="20.5" cy="12" r="1.5" /><path d="M12 5v4M12 15v4M5 12h4M15 12h4" /></svg>
);
const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
const ChartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg>
);
const InboxIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13h4l2 3h6l2-3h4" /><path d="M5 13V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /></svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

// Feature rows for the "Everything on the platform, in one place" value section.
const FEATURES = [
  ['Platform-wide visibility', 'Every distributor, branch, agent, employer and member in one console — drill from the country map down to a single district.'],
  ['Distributor & employer management', 'Create a new network partner or company account, read their numbers, and switch an account off the moment you need to.'],
  ['Access requests & new accounts', 'Partners and companies ask for access from the website — you approve or decline, and their account is created for them.'],
  ['Platform reporting', 'Savings under management, contributions and active members for the whole country, from one place.'],
];

// Platform roster rows (illustrative demo figures, shared with the sibling pages).
const ROSTER = [
  // Two since the d-002 (Busoga) split — and the 316 branches below are its
  // sum: 289 (d-001) + 27 (d-002). Keep these two rows consistent.
  ['D', 'Distributors', 'Network operators nationwide', '2', 'All active'],
  ['E', 'Employers', 'Companies funding staff pensions', '7', '+2 this quarter'],
  ['B', 'Branches', 'Across all four regions', '316', 'Every region live'],
  ['A', 'Field agents', 'Onboarding members every day', '2,049', '+124 this quarter'],
];

// What head office does, as a strip of capabilities.
const STRIP = [
  ['var(--indigo-soft)', '94,99,168', <NetworkIcon key="i" />, 'Whole-platform view', 'Every role, every region'],
  ['var(--green-ink)', '46,139,87', <InboxIcon key="i" />, 'Approve & open accounts', 'Accounts created in a few clicks'],
  ['var(--teal-ink)', '47,143,157', <PinIcon key="i" />, 'Live country map', 'Drill to any district or branch'],
  ['var(--indigo)', '41,40,103', <ChartIcon key="i" />, 'Platform reporting', 'Savings, contributions, members'],
];

// Head-office steps.
const STEPS = [
  ['01', 'var(--indigo-soft)', '94,99,168', <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>, 'We set up your team', 'Talk to us and we create head-office logins for the people who need them — there is no self-signup.', 'Set up by us'],
  ['02', 'var(--green-ink)', '46,139,87', <><path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z" /><path d="M9 3v16M15 5v16" /></>, 'See the whole platform', 'Follow the country map through region, district, branch and agent to see exactly where growth is coming from.', 'Country → agent'],
  ['03', 'var(--teal-ink)', '47,143,157', <><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5" /></>, 'Open distributors & employers', 'Create a network partner or a company account and their teams can start work the same day.', 'Live the same day'],
  ['04', 'var(--indigo)', '41,40,103', <><path d="M3 13h4l2 3h6l2-3h4" /><path d="M5 13V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><path d="m9.5 9 1.6 1.6L14.5 7" /></>, 'Approve who joins', 'Review who is asking for access, approve or decline, and keep every account under head-office control.', 'You stay in control'],
];

// Trust-band credibility signals.
const TRUST = [
  ['var(--indigo)', '41,40,103', <Shield key="i" />, 'URBRA', 'Licensed & regulated in Uganda'],
  ['var(--indigo-soft)', '94,99,168', <LockIcon key="i" />, 'Right access', 'Every login sees only what it should'],
  ['var(--teal-ink)', '47,143,157', <NetworkIcon key="i" />, 'Consistent', 'Every role reads the same numbers'],
  ['var(--green-ink)', '46,139,87', <ChartIcon key="i" />, 'Live figures', 'Totals move as members save'],
];

export default function AdminPage() {
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
      <LandingNav active="admin" onSignIn={scrollToLogin} ctaLabel="Contact us" ctaTo="/contact" />

      <main id="main" tabIndex={-1}>
        {/* hero — head-office copy + platform stats, console login card on the right */}
        <section ref={heroRef} className={styles.hero} aria-labelledby="hero-title">
          <motion.div className={cx(styles.wrap, styles.heroGrid)} style={parallax ? { y: heroY, opacity: heroOpacity } : undefined}>
            <div>
              <h1 className={styles.heroReveal} id="hero-title">Every account on the platform.<br /><span className={styles.accent}>In one console.</span></h1>
              <p className={cx(styles.sub, styles.heroReveal)}>The platform team&rsquo;s workspace — <strong>set up distributors and employers</strong>, <strong>approve access requests</strong>, and watch the whole country on one live map.</p>
              <div className={cx(styles.heroCta, styles.heroReveal)}>
                <Link className={cx(styles.btn, styles.btnPrimary)} to="/contact">Contact us <Arrow /></Link>
                <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={scrollToLogin}>Sign in to the console</button>
              </div>
              <p className={cx(styles.heroMeta, styles.heroReveal)}>
                <Check w="2.4" />
                The only login that can see, and open, every account on the platform.
              </p>
              <div className={cx(styles.heroStats, styles.tabNums, styles.heroReveal)} role="list" aria-label="Platform proof points">
                <div className={styles.st} role="listitem"><div className={styles.sv}>~5,000</div><div className={styles.sl}>Members on the platform</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>2,049</div><div className={styles.sl}>Field agents nationwide</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>UGX 42B</div><div className={styles.sl}>Savings under management</div></div>
              </div>
            </div>

            {/* head-office login card (hero right) — real phone + OTP/password auth */}
            <LandingLoginCard audience="admin" footerPrompt="Need an account?" footerLabel="Talk to the platform team" footerHref="/contact" />
          </motion.div>
        </section>

        {/* value props — capability rows + platform roster / totals */}
        <section className={styles.aud} id="value" aria-labelledby="value-title">
          <div className={cx(styles.wrap, styles.audGrid)}>
            <div className={styles.audCopy}>
              <span className={styles.audTag} style={{ '--ac': 'var(--indigo-soft)', '--tint': '94,99,168' }}>
                <NetworkIcon />
                For the platform team
              </span>
              <h2 id="value-title">Everything on the platform, in one place.</h2>
              <p className={styles.ad}>From the national picture down to a single member — partners, companies, branches, agents and money, all under one login.</p>
              <ul className={styles.feat} style={{ '--ac': 'var(--indigo-soft)', '--tint': '94,99,168' }}>
                {FEATURES.map(([b, s], i) => (
                  <Reveal as="li" key={b} delay={i * 0.06}>
                    <span className={styles.tick} aria-hidden="true"><Check /></span>
                    <span className={styles.ft}><b>{b}</b><span>{s}</span></span>
                  </Reveal>
                ))}
              </ul>
              <div className={styles.audActions}>
                <Link className={cx(styles.btn, styles.btnPrimary)} to="/contact">Contact us <Arrow /></Link>
                <a className={styles.txtlink} href="#how">See how head office works <ArrowLink /></a>
              </div>
            </div>

            {/* visual: platform roster + platform totals */}
            <div className={styles.audVis}>
              <Reveal className={styles.vcard} scale={0.97} delay={0}>
                <div className={styles.vcardHead}>
                  <span className={styles.chip} style={{ '--ac': 'var(--indigo-soft)', '--tint': '94,99,168' }} aria-hidden="true"><NetworkIcon /></span>
                  <span className={styles.vt}>Platform network</span>
                  <span className={styles.vmeta}>All regions</span>
                </div>

                {/* stylised Uganda map */}
                <div className={styles.mapMini} role="img" aria-label="Stylised map of Uganda with branch clusters across Central, Western and Northern regions">
                  <svg viewBox="0 0 360 188" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                    <defs>
                      <linearGradient id="ugFill" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#5E63A8" stopOpacity=".20" />
                        <stop offset="1" stopColor="#292867" stopOpacity=".10" />
                      </linearGradient>
                    </defs>
                    {/* stylised national outline */}
                    <path d="M70 36 L132 26 L176 38 L214 30 L262 46 L296 40 L312 70 L300 104 L312 132 L288 158 L236 166 L196 154 L150 162 L104 150 L74 124 L58 92 L66 62 Z"
                      fill="url(#ugFill)" stroke="#5E63A8" strokeOpacity=".55" strokeWidth="2" strokeLinejoin="round" />
                    {/* region hairline divisions */}
                    <path d="M150 162 L160 96 L132 26" fill="none" stroke="#292867" strokeOpacity=".18" strokeWidth="1.4" strokeDasharray="4 4" />
                    <path d="M160 96 L300 104" fill="none" stroke="#292867" strokeOpacity=".18" strokeWidth="1.4" strokeDasharray="4 4" />
                    {/* branch clusters: Northern */}
                    <circle cx="138" cy="58" r="9" fill="#1f6e44" fillOpacity=".18" /><circle cx="138" cy="58" r="4" fill="#1f6e44" />
                    <circle cx="190" cy="66" r="6" fill="#1f6e44" fillOpacity=".16" /><circle cx="190" cy="66" r="3" fill="#1f6e44" />
                    {/* Western */}
                    <circle cx="104" cy="118" r="7" fill="#1F6E7A" fillOpacity=".16" /><circle cx="104" cy="118" r="3.4" fill="#1F6E7A" />
                    <circle cx="132" cy="138" r="6" fill="#1F6E7A" fillOpacity=".16" /><circle cx="132" cy="138" r="3" fill="#1F6E7A" />
                    {/* Central (largest) */}
                    <circle cx="220" cy="120" r="13" fill="#292867" fillOpacity=".16" /><circle cx="220" cy="120" r="5.5" fill="#292867" />
                    <circle cx="252" cy="138" r="7" fill="#292867" fillOpacity=".16" /><circle cx="252" cy="138" r="3.4" fill="#292867" />
                    <circle cx="196" cy="138" r="6" fill="#292867" fillOpacity=".16" /><circle cx="196" cy="138" r="3" fill="#292867" />
                  </svg>
                </div>

                <div className={cx(styles.rows, styles.tabNums)}>
                  {ROSTER.map(([ri, rn, rs, rvb, rvc]) => (
                    <div key={rn} className={styles.rrow}>
                      <span className={styles.ri} aria-hidden="true">{ri}</span>
                      <div className={styles.rmain}><div className={styles.rn}>{rn}</div><div className={styles.rs}>{rs}</div></div>
                      <div className={styles.rv}><div className={styles.rvb}>{rvb}</div><div className={styles.rvc}>{rvc}</div></div>
                    </div>
                  ))}
                </div>
              </Reveal>
              <Reveal className={styles.vcard} scale={0.97} delay={0.1}>
                <div className={styles.vcardHead}>
                  <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><ChartIcon /></span>
                  <span className={styles.vt}>Platform totals</span>
                  <span className={styles.vmeta}>Live</span>
                </div>
                <div className={cx(styles.kpis, styles.tabNums)}>
                  <div className={styles.kpi}>
                    <div className={styles.kl}>Savings managed</div>
                    <div className={styles.kv}>UGX 42B</div>
                    <div className={styles.ks}>Across every partner</div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kl}>Members served</div>
                    <div className={cx(styles.kv, styles.g)}>~5,000</div>
                    <div className={styles.ks}>Saving across 4 regions</div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* capability strip */}
        <div className={styles.strip} aria-label="What head office can do">
          <div className={cx(styles.wrap, styles.stripIn)}>
            {STRIP.map(([ac, tint, icon, bt, bs], i) => (
              <Fragment key={bt}>
                {i > 0 && <div className={styles.sep} aria-hidden="true" />}
                <div className={styles.badge}>
                  <span className={styles.chip} style={{ '--ac': ac, '--tint': tint }} aria-hidden="true">{icon}</span>
                  <div><div className={styles.bt}>{bt}</div><div className={styles.bs}>{bs}</div></div>
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {/* how head office works */}
        <section className={styles.how} id="how" aria-labelledby="how-title">
          <div className={styles.wrap}>
            <Reveal className={styles.howHead}>
              <p className={styles.eyebrow}>How head office works</p>
              <h2 className={styles.h2} id="how-title">From one login to the whole country.<br /><span style={{ color: 'var(--indigo-soft)' }}>In four steps.</span></h2>
              <p className={styles.lead}>No spreadsheets and no phone calls to the field — it all runs from one console.</p>
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

        {/* trust band */}
        <section className={styles.tband} aria-labelledby="trust-title">
          <div className={styles.wrap}>
            <Reveal className={styles.tbandHead}>
              <p className={styles.eyebrow}>Why head office trusts it</p>
              <h2 className={styles.h2} id="trust-title">Control you can trust.</h2>
              <p className={styles.lead}>Licensed products, the right access for every login, and one set of platform numbers — the foundations behind every account we open.</p>
            </Reveal>
            <Reveal className={cx(styles.tstats, styles.tabNums)} role="list" aria-label="Credibility signals">
              {TRUST.map(([ac, tint, icon, tv, tl]) => (
                <div key={tv} className={styles.ts} role="listitem" style={{ '--ac': ac, '--tint': tint }}>
                  <span className={styles.tchip} aria-hidden="true">{icon}</span>
                  <div className={styles.tv}>{tv}</div><div className={styles.tl}>{tl}</div>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* final CTA band (shared light ctaCard) */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.wrap}>
            <Reveal className={styles.ctaCard} scale={0.98}>
              <div className={styles.ctaGrid}>
                <div>
                  <p className={styles.eyebrow}>Head-office access · Set up by the platform team</p>
                  <h2 id="cta-title">See the whole country.<br /><span className={styles.accent}>From one login.</span></h2>
                  <p>Tell us who needs head-office access. We create the account, walk your team through the console, and hand you the whole platform in one view.</p>
                  <div className={styles.ctaActions}>
                    <Link className={cx(styles.btn, styles.btnPrimary)} to="/contact">Contact us <Arrow /></Link>
                    <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={scrollToLogin}>Sign in to the console</button>
                  </div>
                </div>
                <div className={cx(styles.proj, styles.tabNums)} aria-label="Illustrative platform snapshot">
                  <div className={styles.pl}>Savings under management</div>
                  <div className={styles.pv}>UGX 42B</div>
                  <div className={styles.pmeta}><span className={styles.badge}>Live</span><span className={styles.pn}>316 branches · 2,049 agents</span></div>
                  <div className={styles.pcover}><Shield /><span>Role-based access — every login sees only what it should</span></div>
                  <p className={styles.pcaveat}>Illustrative figures for demonstration; your console shows the platform&rsquo;s real totals.</p>
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
