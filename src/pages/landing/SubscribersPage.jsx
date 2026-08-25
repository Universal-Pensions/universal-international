import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import Footer from '../../components/Footer';
import LandingNav from './LandingNav';
import LandingLoginCard from './LandingLoginCard';
import { Reveal, EASE } from './motion';
import { useIsMobile } from '../../hooks/useIsMobile';
import styles from './landing.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

// Count-up number that animates from 0 → `value` the first time it scrolls into
// view. Reduced-motion / no-IO → renders the final value immediately (via the
// lazy initial state, so no setState is needed in that branch).
function noAnim() {
  return typeof window === 'undefined'
    || !('IntersectionObserver' in window)
    || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
function CountUp({ value, prefix = '', suffix = '', duration = 1100 }) {
  const ref = useRef(null);
  const [n, setN] = useState(() => (noAnim() ? value : 0));
  const started = useRef(false);
  useEffect(() => {
    if (noAnim()) return; // final value already rendered from initial state
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting || started.current) return;
        started.current = true;
        const t0 = performance.now();
        const tick = (t) => {
          const p = Math.min((t - t0) / duration, 1);
          setN(value * (1 - Math.pow(1 - p, 3))); // setState inside rAF callback — allowed
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        io.unobserve(e.target);
      });
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);
  return <span ref={ref}>{prefix}{Math.round(n)}{suffix}</span>;
}

// Shared finance model (matches the mockup + SavingsCalculator: 10%/yr, monthly).
const MONTHLY_RATE = 0.10 / 12;
const calcFV = (pmt, years) => {
  const n = years * 12;
  return n > 0 ? pmt * ((Math.pow(1 + MONTHLY_RATE, n) - 1) / MONTHLY_RATE) : 0;
};
const formatUGX = (n) => 'UGX ' + Math.round(n).toLocaleString('en-US');
const AMOUNTS = [5000, 10000, 20000, 50000]; // monthly contribution presets (UGX)

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);
const Shield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg>
);
const Check = ({ w = '2.6' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
);
const Plus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
);

const FAQS = [
  ['Is my money safe?', 'Universal Pensions is licensed and regulated by URBRA. Your contributions are ring-fenced and held by an independent custodian — separate from the company — and invested professionally.'],
  ['Can I withdraw before retirement?', 'Your pension savings are built for the long term, with defined access rules at retirement. Your Life, Health and Funeral cover, meanwhile, pays out whenever a valid claim arises.'],
  ['What if I can’t contribute for a while?', 'Nothing is lost. Pause any time and pick up again when you’re able — there’s no penalty for stopping, and your existing balance keeps growing.'],
  ['How do I pay in?', 'By mobile money — MTN MoMo or Airtel Money — weekly, monthly, or whenever you can, from UGX 5,000. No branch visit and no paperwork.'],
  ['What do I get at retirement?', 'A monthly pension income or a lump sum — your choice. Fully transparent, and always yours.'],
];

export default function SubscribersPage() {
  const navigate = useNavigate();
  const [pmt, setPmt] = useState(10000);
  const [years, setYears] = useState(25);
  const [heroTab, setHeroTab] = useState('calc');
  const calcRef = useRef(null);
  const reduce = useReducedMotion();

  // Scroll parallax — hero content drifts down + fades as the next section rises over it.
  const heroRef = useRef(null);
  const isMobile = useIsMobile();
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', '30%']);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.72], [1, 0]);
  const parallax = !reduce && !isMobile;

  const fv = calcFV(pmt, years);
  const contributed = pmt * years * 12;
  const returnAmt = fv - contributed;
  const returnPct = fv > 0 ? Math.round((returnAmt / fv) * 100) : 0;
  const yearsPct = ((years - 5) / 35) * 100;

  const startSaving = () => navigate('/signup');
  const openSignIn = () => {
    setHeroTab('signin');
    requestAnimationFrame(() => calcRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  return (
    <div className={styles.page}>
      <LandingNav active="subscriber" onSignIn={openSignIn} ctaLabel="Start saving" ctaTo="/signup" />

      <main id="main" tabIndex={-1}>
        {/* hero */}
        <section ref={heroRef} className={styles.hero} aria-labelledby="hero-title">
          <motion.div className={cx(styles.wrap, styles.heroGrid)} style={parallax ? { y: heroY, opacity: heroOpacity } : undefined}>
            <div>
              <h1 className={styles.heroReveal} id="hero-title">The best time to start saving was yesterday.<br />Today is second best.</h1>
              <p className={cx(styles.sub, styles.heroReveal)}><strong>Retirement savings</strong>, <strong>liquid savings</strong> and <strong>insurance</strong> — all in one account.</p>
              <div className={cx(styles.heroStats, styles.tabNums, styles.heroReveal)} role="list" aria-label="Platform proof points">
                <div className={styles.st} role="listitem"><div className={styles.sv}><CountUp value={120} suffix="K+" /></div><div className={styles.sl}>Active savers</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}><CountUp value={48} prefix="UGX " suffix="B" /></div><div className={styles.sl}>Savings managed</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}><CountUp value={10} prefix="~" suffix="%" /></div><div className={styles.sl}>Illustrative return / yr</div></div>
              </div>
            </div>

            {/* compact savings calculator + inline sign-in (tabbed) */}
            <div className={cx(styles.calc, styles.heroReveal)} ref={calcRef} aria-label="Savings projection and sign in">
              <div className={styles.heroTabs} role="tablist" aria-label="Calculator or sign in">
                <button type="button" role="tab" aria-selected={heroTab === 'calc'} className={styles.heroTab} onClick={() => setHeroTab('calc')}>See your growth</button>
                <button type="button" role="tab" aria-selected={heroTab === 'signin'} className={styles.heroTab} onClick={() => setHeroTab('signin')}>Sign in</button>
              </div>
              {heroTab === 'calc' ? (
                <>
                  <div className={styles.calcField}>
                    <span className={styles.calcLabel} id="calc-amt">I save each month</span>
                    <div className={styles.amtChips} role="group" aria-labelledby="calc-amt">
                      {AMOUNTS.map((a) => (
                        <button key={a} type="button" aria-pressed={pmt === a} className={styles.amtChip} onClick={() => setPmt(a)}>{a / 1000}K</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.calcField}>
                    <div className={styles.calcLabelRow}>
                      <span className={styles.calcLabel}>For how long</span>
                      <span className={cx(styles.calcYears, styles.tabNums)}>{years} years</span>
                    </div>
                    <input className={styles.rng} type="range" min="5" max="40" step="1" value={years}
                      onChange={(e) => setYears(parseInt(e.target.value, 10))}
                      aria-label="Saving term in years" aria-valuetext={`${years} years`}
                      style={{ '--pct': `${yearsPct}%` }} />
                    <div className={styles.slLimits}><span>5 yrs</span><span>40 yrs</span></div>
                  </div>
                  <div className={styles.calcResult}>
                    <span className={styles.cpl}>Projected at retirement</span>
                    <motion.div key={Math.round(fv)} className={cx(styles.cpv, styles.tabNums)}
                      initial={reduce ? false : { scale: 0.94 }} animate={{ scale: 1 }}
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 22 }}>{formatUGX(fv)}</motion.div>
                    <div className={styles.calcBar} role="img" aria-label={`${returnPct}% of the balance comes from investment growth`}>
                      <motion.span className={styles.calcBarFill} initial={false}
                        animate={{ width: `${Math.max(100 - returnPct, 4)}%` }}
                        transition={reduce ? { duration: 0 } : { duration: 0.6, ease: EASE }} />
                    </div>
                    <div className={cx(styles.calcLegend, styles.tabNums)}>
                      <span><i className={cx(styles.ldot, styles.i)} aria-hidden="true" />You put in <b>{formatUGX(contributed)}</b></span>
                      <span><i className={cx(styles.ldot, styles.g)} aria-hidden="true" />Growth <b>{formatUGX(returnAmt)}</b></span>
                    </div>
                  </div>
                  <button type="button" className={cx(styles.btn, styles.btnPrimary, styles.calcBtn)} onClick={startSaving}>Start saving today <Arrow /></button>
                  <p className={styles.calcNote}>Illustrative, at ~10% a year.</p>
                </>
              ) : (
                <LandingLoginCard audience="subscriber" embedded footerPrompt="New here?" footerLabel="Create an account" footerHref="/signup" />
              )}
            </div>
          </motion.div>
        </section>

        {/* how it works */}
        <section className={styles.how} id="how" aria-labelledby="how-title">
          <div className={styles.wrap}>
            <Reveal className={styles.howHead}>
              <p className={styles.eyebrow}>Built for Uganda</p>
              <h2 className={styles.h2} id="how-title">Save and stay covered.<br /><span style={{ color: 'var(--indigo-soft)' }}>As easy as mobile money.</span></h2>
              <p className={styles.lead}>Retirement savings, liquid savings and insurance — all from your phone.</p>
            </Reveal>
            <div className={styles.steps}>
              {[
                ['01', 'var(--indigo)', '41,40,103', <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>, 'Register in 3 minutes', 'Just your phone number and National ID — no branch visit, no paperwork.', 'Any network · any phone'],
                ['02', 'var(--green-ink)', '46,139,87', <><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M11 18h2" /></>, 'Save what you can', 'Top up by MTN or Airtel money anytime — keep some as liquid savings you can withdraw, and grow the rest for retirement.', 'Save or withdraw anytime'],
                ['03', 'var(--teal-ink)', '47,143,157', <><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></>, 'Insurance, built in', 'Protect your family with Life, Health and Funeral cover on the same account.', 'Life · Health · Funeral'],
                ['04', 'var(--indigo-soft)', '94,99,168', <><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></>, 'We grow it for you', 'Your retirement pot is invested professionally — around 10% a year — for a monthly income or lump sum later.', '~10% a year'],
              ].map(([n, ac, tint, icon, h, p, chip], i) => (
                <Reveal as="article" key={n} className={styles.step} scale={0.97} delay={i * 0.08}>
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

        {/* built for everyone */}
        <section className={styles.everyone} aria-labelledby="everyone-title">
          <div className={styles.wrap}>
            <Reveal className={styles.everyoneHead}>
              <p className={styles.eyebrow}>Built for everyone</p>
              <h2 className={styles.h2} id="everyone-title">One platform. Every Ugandan.</h2>
              <p className={styles.lead}>Save for yourself, run payroll for a team, or build a network — one platform for each.</p>
            </Reveal>
            <div className={styles.evGrid}>
              <Reveal as="article" className={styles.evCard} scale={0.97} delay={0} style={{ '--ac': 'var(--indigo)' }}>
                <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></span>
                <div className={styles.evKick}>For Subscribers</div>
                <h3>Individuals</h3>
                <p>Personal retirement savings plus Life, Health &amp; Funeral cover, tracked from your phone.</p>
                <span className={styles.txtlink}>You&rsquo;re here <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              </Reveal>
              <Reveal as="article" className={styles.evCard} scale={0.97} delay={0.08} style={{ '--ac': 'var(--green-ink)' }}>
                <span className={styles.chip} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></svg></span>
                <div className={styles.evKick}>For Employers</div>
                <h3>Employers</h3>
                <p>Enrol staff, fund contributions in bulk, and add group cover — with clear reporting.</p>
                <Link className={styles.txtlink} to="/employers">Explore the employer platform <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link>
              </Reveal>
              <Reveal as="article" className={styles.evCard} scale={0.97} delay={0.16} style={{ '--ac': 'var(--teal-ink)' }}>
                <span className={styles.chip} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg></span>
                <div className={styles.evKick}>For Distributors</div>
                <h3>Distributors</h3>
                <p>Run branches and agents nationwide, manage commissions and grow your network from one map.</p>
                <Link className={styles.txtlink} to="/distributors">Explore the distributor platform <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link>
              </Reveal>
            </div>
          </div>
        </section>

        {/* stories */}
        <section className={styles.stories} aria-labelledby="stories-title">
          <div className={styles.wrap}>
            <Reveal className={styles.storiesHead}>
              <p className={styles.eyebrow}>Real stories</p>
              <h2 className={styles.h2} id="stories-title">People saving — and protecting — their future.</h2>
            </Reveal>
            <div className={styles.quotes}>
              {[
                ['41,40,103', 'I never thought I could save for retirement — I work for myself. Universal Pensions made it simple. I contribute what I can, when I can, and my family is covered too.', 'AN', 'Aisha Namukasa', 'Tailoring business · Kampala'],
                ['46,139,87', 'Managing contributions for 80 employees used to take days. Now I upload a file and it’s done. The reporting is clear and our staff value the savings and the cover.', 'RO', 'Robert Ochieng', 'HR Manager · Logistics company'],
                ['47,143,157', 'The distributor map shows my whole region at a glance. I compare branches, settle commissions in a few clicks, and know exactly where to push next.', 'GA', 'Grace Atim', 'Network operations · Northern Uganda'],
              ].map(([tint, q, av, nm, role], i) => (
                <Reveal key={nm} className={styles.quote} scale={0.97} delay={i * 0.08} style={{ '--ac': `var(--indigo)`, '--tint': tint }}>
                  <div className={styles.qm} aria-hidden="true">&ldquo;</div>
                  <p>{q}</p>
                  <div className={styles.qby}><span className={styles.qav} aria-hidden="true">{av}</span><div><div className={styles.qn}>{nm}</div><div className={styles.qr}>{role}</div></div></div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* trust band */}
        <section className={styles.tband} aria-labelledby="trust-title">
          <div className={styles.wrap}>
            <Reveal className={styles.tbandHead}>
              <p className={styles.eyebrow}>Why Ugandans trust us</p>
              <h2 className={styles.h2} id="trust-title">Built to be relied on.</h2>
              <p className={styles.lead}>Regulated, secured, and built for the phone in your pocket.</p>
            </Reveal>
            <Reveal className={cx(styles.tstats, styles.tabNums)} role="list" aria-label="Credibility signals">
              {[
                ['var(--indigo)', '41,40,103', <Shield />, 'URBRA', 'Licensed & regulated in Uganda'],
                ['var(--indigo-soft)', '94,99,168', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>, 'PCI DSS', 'Bank-grade payment security'],
                ['var(--teal-ink)', '47,143,157', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="13" cy="12" r="3.5" /><path d="M7 8v8" /></svg>, 'Ring-fenced', 'Member funds held by an independent custodian'],
                ['var(--green-ink)', '46,139,87', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>, '83%', 'On-time contribution rate'],
              ].map(([ac, tint, icon, tv, tl]) => (
                <div key={tv} className={styles.ts} role="listitem" style={{ '--ac': ac, '--tint': tint }}>
                  <span className={styles.tchip} aria-hidden="true">{icon}</span>
                  <div className={styles.tv}>{tv}</div><div className={styles.tl}>{tl}</div>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* fees */}
        <section className={styles.fees} aria-labelledby="fees-title">
          <div className={styles.wrap}>
            <Reveal className={styles.feesHead}>
              <p className={styles.eyebrow}>Free for savers</p>
              <h2 className={styles.h2} id="fees-title">Saving costs you nothing.</h2>
              <p className={styles.lead}>Opening an account, saving and withdrawing are all free — we never take a fee from you.</p>
            </Reveal>
            <div className={styles.feesGrid}>
              <Reveal className={styles.feesHero} scale={0.97}>
                <div className={styles.fl}>What you pay us</div>
                <div className={cx(styles.fv, styles.tabNums)}>UGX 0</div>
                <p className={styles.fdesc}>Every shilling you save stays working for you. There are no charges taken from your account — not to open it, not to save, not to withdraw.</p>
              </Reveal>
              <div className={styles.feePoints}>
                {[
                  ['Free to open', 'Setting up your account costs nothing.'],
                  ['Free to save & withdraw', 'Add money or take it out with no charges.'],
                  ['No hidden fees', 'No setup, statement or transaction fees, ever.'],
                ].map(([b, s], i) => (
                  <Reveal key={b} className={styles.feePoint} delay={i * 0.08}>
                    <span className={styles.fpi} aria-hidden="true"><Check /></span>
                    <div className={styles.fpt}><b>{b}</b><span>{s}</span></div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className={styles.faq} aria-labelledby="faq-title">
          <div className={styles.wrap}>
            <Reveal className={styles.faqHead}>
              <p className={styles.eyebrow}>Good questions</p>
              <h2 className={styles.h2} id="faq-title">Everything you might be wondering.</h2>
            </Reveal>
            <div className={styles.faqList}>
              {FAQS.map(([q, a], i) => (
                <Reveal as="details" key={q} className={styles.faqItem} delay={i * 0.06}>
                  <summary><span>{q}</span><span className={styles.fqi} aria-hidden="true"><Plus /></span></summary>
                  <div className={styles.faqA}>{a}</div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* final CTA */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.wrap}>
            <Reveal className={styles.ctaCard} scale={0.98}>
              <div className={styles.ctaGrid}>
                <div>
                  <p className={styles.eyebrow}>Open your account · Free to start</p>
                  <h2 id="cta-title">Your future is worth ten minutes.<br /><span className={styles.accent}>Start today.</span></h2>
                  <p>Savings and Life, Health &amp; Funeral cover in one place. Open your account in minutes — no paperwork, no branch visit.</p>
                  <div className={styles.ctaActions}>
                    <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={startSaving}>Open your account <Arrow /></button>
                    <Link className={cx(styles.btn, styles.btnSecondary)} to="/contact">Talk to an agent</Link>
                  </div>
                </div>
                <div className={cx(styles.proj, styles.tabNums)} aria-label="Illustrative projection">
                  <div className={styles.pl}>Illustrative balance after 40 years</div>
                  <div className={styles.pv}>UGX 32M</div>
                  <div className={styles.pmeta}><span className={styles.badge}>Starting today</span><span className={styles.pn}>Over 40 years</span></div>
                  <div className={styles.pcover}><Shield /><span>Plus Life · Health · Funeral cover along the way</span></div>
                  <p className={styles.pcaveat}>Illustrative only; past returns don&rsquo;t guarantee future performance.</p>
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
