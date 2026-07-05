import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignIn } from '../../contexts/SignInContext';
import Footer from '../../components/Footer';
import styles from './landing.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

// Shared finance model (matches the mockup + SavingsCalculator: 10%/yr, monthly).
const MONTHLY_RATE = 0.10 / 12;
const CIRC = 2 * Math.PI * 32; // ring circumference ≈ 201.06
const calcFV = (pmt, years) => {
  const n = years * 12;
  return n > 0 ? pmt * ((Math.pow(1 + MONTHLY_RATE, n) - 1) / MONTHLY_RATE) : 0;
};
const formatUGX = (n) => 'UGX ' + Math.round(n).toLocaleString('en-US');

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
  const signIn = useSignIn();
  const [drawer, setDrawer] = useState(false);
  const [pmt, setPmt] = useState(5000);
  const [years, setYears] = useState(20);
  const rootRef = useRef(null);

  const fv = calcFV(pmt, years);
  const contributed = pmt * years * 12;
  const returnAmt = fv - contributed;
  const returnPct = fv > 0 ? Math.round((returnAmt / fv) * 100) : 0;
  const sliderPct = ((pmt - 5000) / 15000) * 100;

  const startSaving = () => navigate('/signup');

  // Entrance reveals — reveal off-screen elements as they scroll in (JS-gated,
  // reduced-motion respected via the .reveal media query).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = Array.from(root.querySelectorAll(`.${styles.reveal}`));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add(styles.in); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return; // already visible
      el.classList.add(styles.reveal);
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  // Body scroll-lock + Escape-to-close while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    if (!drawer) return () => { document.body.style.overflow = ''; };
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  }, [drawer]);

  return (
    <div className={styles.page} ref={rootRef}>
      {/* nav */}
      <header className={styles.nav}>
        <div className={cx(styles.wrap, styles.navIn)}>
          <Link className={styles.brand} to="/" aria-label="Universal Pensions home">
            <span className={styles.mark} aria-hidden="true"><Shield /></span>
            <span>Universal Pensions<small>Pensions &amp; insurance · Uganda</small></span>
          </Link>
          <nav className={styles.navLinks} aria-label="Platform audiences">
            <Link to="/" aria-current="page">For Subscribers</Link>
            <Link to="/employers">For Employers</Link>
            <Link to="/distributors">For Distributors</Link>
          </nav>
          <div className={styles.navActions}>
            <button type="button" className={styles.navSignin} onClick={() => signIn.open()}>Sign in</button>
            <button type="button" className={cx(styles.btn, styles.btnPrimary, styles.btnSm)} onClick={startSaving}>Start saving <Arrow /></button>
            <button className={styles.hamburger} aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* mobile drawer */}
      <button type="button" aria-label="Close menu" tabIndex={drawer ? 0 : -1} className={cx(styles.drawerScrim, drawer && styles.open)} onClick={() => setDrawer(false)} />
      <aside className={cx(styles.drawer, drawer && styles.open)} role="dialog" aria-modal="true" aria-label="Mobile navigation" aria-hidden={!drawer}>
        <div className={styles.drawerTop}>
          <span className={styles.brand}><span className={styles.mark} aria-hidden="true"><Shield /></span>Universal Pensions</span>
          <button className={styles.xBtn} aria-label="Close menu" onClick={() => setDrawer(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <Link className={styles.dlink} to="/" aria-current="page" onClick={() => setDrawer(false)}>For Subscribers</Link>
        <Link className={styles.dlink} to="/employers" onClick={() => setDrawer(false)}>For Employers</Link>
        <Link className={styles.dlink} to="/distributors" onClick={() => setDrawer(false)}>For Distributors</Link>
        <div className={styles.drawerCta}>
          <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={() => { setDrawer(false); signIn.open(); }}>Sign in</button>
          <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={() => { setDrawer(false); startSaving(); }}>Start saving</button>
        </div>
      </aside>

      <main id="main">
        {/* hero */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={cx(styles.wrap, styles.heroGrid)}>
            <div>
              <h1 id="hero-title">The best time to start saving was yesterday.<br /><span className={styles.accent}>Today is second best.</span></h1>
              <p className={styles.sub}><strong>Retirement savings</strong> and <strong>Life, Health &amp; Funeral cover</strong> in one account — from UGX 5,000 a month.</p>
              <div className={styles.heroCta}>
                <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={startSaving}>Start saving today <Arrow /></button>
                <a className={cx(styles.btn, styles.btnSecondary)} href="#how">See how it works</a>
              </div>
              <p className={styles.heroMeta}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
                From UGX 5,000 / month · No paperwork, no branch visit
              </p>
              <div className={cx(styles.heroStats, styles.tabNums)} role="list" aria-label="Platform proof points">
                <div className={styles.st} role="listitem"><div className={styles.sv}>120K+</div><div className={styles.sl}>Active savers</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>UGX 48B</div><div className={styles.sl}>Savings managed</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>~10%</div><div className={styles.sl}>Illustrative return / yr</div></div>
              </div>
            </div>

            {/* interactive savings calculator */}
            <div className={styles.calc} aria-labelledby="calc-title">
              <div className={styles.calcHead}>
                <span className={styles.calcEyebrow} id="calc-title">Pension projection</span>
                <div className={styles.segCtrl} role="group" aria-label="Saving term in years">
                  {[10, 20, 30, 40].map((y) => (
                    <button key={y} type="button" aria-pressed={years === y} onClick={() => setYears(y)}>{y === 40 ? '40 yr' : y}</button>
                  ))}
                </div>
              </div>
              <div className={styles.calcProj}>
                <div className={styles.cpl}>Projected savings at retirement</div>
                <div className={cx(styles.cpv, styles.tabNums)}>{formatUGX(fv)}</div>
                <div className={styles.cpc}>Illustrative, at ~10% a year</div>
              </div>
              <div className={styles.calcRingRow}>
                <div className={styles.calcRing} role="img" aria-label={`${returnPct}% of the projected balance comes from investment returns`}>
                  <svg viewBox="0 0 80 80" aria-hidden="true">
                    <defs>
                      <linearGradient id="calcRingGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#2E8B57" /><stop offset="1" stopColor="#2F8F9D" />
                      </linearGradient>
                    </defs>
                    <circle cx="40" cy="40" r="32" fill="none" stroke="var(--lavender)" strokeWidth="8" />
                    <circle cx="40" cy="40" r="32" fill="none" stroke="url(#calcRingGrad)" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={CIRC.toFixed(2)} strokeDashoffset={(CIRC * (1 - returnPct / 100)).toFixed(2)} transform="rotate(-90 40 40)" />
                  </svg>
                  <div className={styles.ringC}><span className={cx(styles.ringPct, styles.tabNums)}>{returnPct}%</span><span className={styles.ringL}>returns</span></div>
                </div>
                <div className={styles.calcBreak}>
                  <div className={styles.brk}>
                    <span className={cx(styles.bdot, styles.i)} aria-hidden="true" />
                    <div className={styles.binfo}><div className={styles.bl}>You contribute</div><div className={cx(styles.bv, styles.tabNums)}>{formatUGX(contributed)}</div></div>
                  </div>
                  <div className={styles.brk}>
                    <span className={cx(styles.bdot, styles.g)} aria-hidden="true" />
                    <div className={styles.binfo}><div className={styles.bl}>Investment returns</div><div className={cx(styles.bv, styles.g, styles.tabNums)}>{formatUGX(returnAmt)}</div></div>
                  </div>
                </div>
              </div>
              <div className={styles.calcSlider}>
                <div className={styles.slTop}>
                  <span className={styles.slLab}>Monthly contribution</span>
                  <span className={cx(styles.slAmt, styles.tabNums)}>{formatUGX(pmt)}</span>
                </div>
                <input className={styles.rng} type="range" min="5000" max="20000" step="1000" value={pmt}
                  onChange={(e) => setPmt(parseInt(e.target.value, 10))}
                  aria-label="Monthly contribution in Ugandan shillings" aria-valuetext={`${formatUGX(pmt)} a month`}
                  style={{ '--pct': `${sliderPct}%` }} />
                <div className={styles.slLimits}><span>UGX 5K</span><span>UGX 20K</span></div>
              </div>
              <div className={styles.calcCta}>
                <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={startSaving}>Start saving today <Arrow /></button>
              </div>
            </div>
          </div>
        </section>

        {/* trusted-by */}
        <div className={styles.trusted} aria-label="Employers who offer Universal Pensions">
          <div className={cx(styles.wrap, styles.trustedIn)}>
            <span className={styles.tlabel}>Offered by employers across Uganda</span>
            <div className={styles.tlogos}>
              <span className={styles.tlogo}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6" /></svg>Nile Agro</span>
              <span className={styles.tlogo}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="1" y="6" width="13" height="10" rx="1.5" /><path d="M14 9h4l3 3v4h-7z" /><circle cx="5" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /></svg>Kampala Logistics</span>
              <span className={styles.tlogo}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 8h1a3 3 0 0 1 0 6h-1" /><path d="M3 8h14v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" /><path d="M6 2v2M10 2v2M14 2v2" /></svg>Victoria Foods</span>
              <span className={styles.tlogo}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V10l6 4V10l6 4v7" /><path d="M9 21v-4h2v4" /></svg>Pearl Manufacturing</span>
              <span className={styles.tlogo}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>Savanna Health</span>
            </div>
          </div>
        </div>

        {/* dual offer */}
        <section className={styles.dual} aria-labelledby="dual-title">
          <h2 id="dual-title" className={styles.srOnly}>What Universal Pensions offers</h2>
          <div className={cx(styles.wrap, styles.dualGrid)}>
            <div className={cx(styles.dualCell, styles.reveal)}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6" /></svg>
              </span>
              <div>
                <h3>How your pension works</h3>
                <p>Save small amounts by mobile money. We pool and invest them professionally — around 10% a year. At retirement, take a monthly income or a lump sum.</p>
              </div>
            </div>
            <div className={cx(styles.dualCell, styles.reveal)}>
              <span className={styles.chip} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }} aria-hidden="true"><Shield /></span>
              <div>
                <h3>Insurance, built in</h3>
                <p>Add Life, Health and Funeral cover to the same account. A small monthly premium keeps illness, accidents or loss from wiping out your savings.</p>
              </div>
            </div>
          </div>
        </section>

        {/* mobile-money strip */}
        <div className={styles.strip} aria-label="Ways to pay and reach">
          <div className={cx(styles.wrap, styles.stripIn)}>
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></svg></span>
              <div><div className={styles.bt}>MTN &amp; Airtel</div><div className={styles.bs}>Pay by mobile money</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="m9 11 2 2 4-4" /></svg></span>
              <div><div className={styles.bt}>All from your phone</div><div className={styles.bs}>No branch visit, no paperwork</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo-soft)', '--tint': '94,99,168' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 9h6M9 13h4" /></svg></span>
              <div><div className={styles.bt}>Instant receipts</div><div className={styles.bs}>A confirmation every time you pay</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }} aria-hidden="true"><Check w="1.7" /></span>
              <div><div className={styles.bt}>3-minute sign-up</div><div className={styles.bs}>Phone &amp; National ID</div></div>
            </div>
          </div>
        </div>

        {/* how it works */}
        <section className={styles.how} id="how" aria-labelledby="how-title">
          <div className={styles.wrap}>
            <div className={styles.howHead}>
              <p className={styles.eyebrow}>Built for Uganda</p>
              <h2 className={styles.h2} id="how-title">Save and stay covered.<br /><span style={{ color: 'var(--indigo-soft)' }}>As easy as mobile money.</span></h2>
              <p className={styles.lead}>Four steps, all from your phone.</p>
            </div>
            <div className={styles.steps}>
              {[
                ['01', 'var(--indigo)', '41,40,103', <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>, 'Register in 3 minutes', 'Phone number and National ID. No branch visit, no paperwork.', 'Any network · any phone'],
                ['02', 'var(--green-ink)', '46,139,87', <><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M11 18h2" /></>, 'Contribute by mobile money', 'MTN MoMo or Airtel Money — weekly, monthly, or whenever you can.', 'From UGX 5,000 / month'],
                ['03', 'var(--teal-ink)', '47,143,157', <><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></>, 'Grow and stay protected', 'Your savings grow while Life, Health & Funeral cover protects your family.', 'Savings + insurance, together'],
                ['04', 'var(--indigo-soft)', '94,99,168', <><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5" /></>, 'Retire on your terms', 'Monthly pension income or a lump sum. Fully transparent, fully yours.', 'Income or lump sum'],
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

        {/* built for everyone */}
        <section className={styles.everyone} aria-labelledby="everyone-title">
          <div className={styles.wrap}>
            <div className={styles.everyoneHead}>
              <p className={styles.eyebrow}>Built for everyone</p>
              <h2 className={styles.h2} id="everyone-title">One platform. Every Ugandan.</h2>
              <p className={styles.lead}>Save for yourself, run payroll for a team, or build a network — one platform for each.</p>
            </div>
            <div className={styles.evGrid}>
              <article className={cx(styles.evCard, styles.reveal)} style={{ '--ac': 'var(--indigo)' }}>
                <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></span>
                <div className={styles.evKick}>For Subscribers</div>
                <h3>Individuals</h3>
                <p>Personal retirement savings plus Life, Health &amp; Funeral cover, tracked from your phone.</p>
                <span className={styles.txtlink}>You&rsquo;re here <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              </article>
              <article className={cx(styles.evCard, styles.reveal)} style={{ '--ac': 'var(--green-ink)' }}>
                <span className={styles.chip} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8h14v13M9 21v-6h6v6M9 12h6" /></svg></span>
                <div className={styles.evKick}>For Employers</div>
                <h3>Employers</h3>
                <p>Enrol staff, fund contributions in bulk, and add group cover — with clear reporting.</p>
                <Link className={styles.txtlink} to="/employers">Explore the employer platform <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link>
              </article>
              <article className={cx(styles.evCard, styles.reveal)} style={{ '--ac': 'var(--teal-ink)' }}>
                <span className={styles.chip} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg></span>
                <div className={styles.evKick}>For Distributors</div>
                <h3>Distributors</h3>
                <p>Run branches and agents nationwide, manage commissions and grow your network from one map.</p>
                <Link className={styles.txtlink} to="/distributors">Explore the distributor platform <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link>
              </article>
            </div>
          </div>
        </section>

        {/* stories */}
        <section className={styles.stories} aria-labelledby="stories-title">
          <div className={styles.wrap}>
            <div className={styles.storiesHead}>
              <p className={styles.eyebrow}>Real stories</p>
              <h2 className={styles.h2} id="stories-title">People saving — and protecting — their future.</h2>
            </div>
            <div className={styles.quotes}>
              {[
                ['41,40,103', 'I never thought I could save for retirement — I work for myself. Universal Pensions made it simple. I contribute what I can, when I can, and my family is covered too.', 'AN', 'Aisha Namukasa', 'Tailoring business · Kampala'],
                ['46,139,87', 'Managing contributions for 80 employees used to take days. Now I upload a file and it’s done. The reporting is clear and our staff value the savings and the cover.', 'RO', 'Robert Ochieng', 'HR Manager · Logistics company'],
                ['47,143,157', 'The distributor map shows my whole region at a glance. I compare branches, settle commissions in a few clicks, and know exactly where to push next.', 'GA', 'Grace Atim', 'Network operations · Northern Uganda'],
              ].map(([tint, q, av, nm, role]) => (
                <div key={nm} className={cx(styles.quote, styles.reveal)} style={{ '--ac': `var(--indigo)`, '--tint': tint }}>
                  <div className={styles.qm} aria-hidden="true">&ldquo;</div>
                  <p>{q}</p>
                  <div className={styles.qby}><span className={styles.qav} aria-hidden="true">{av}</span><div><div className={styles.qn}>{nm}</div><div className={styles.qr}>{role}</div></div></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* trust band */}
        <section className={styles.tband} aria-labelledby="trust-title">
          <div className={styles.wrap}>
            <div className={styles.tbandHead}>
              <p className={styles.eyebrow}>Why Ugandans trust us</p>
              <h2 className={styles.h2} id="trust-title">Built to be relied on.</h2>
              <p className={styles.lead}>Regulated, secured, and built for the phone in your pocket.</p>
            </div>
            <div className={cx(styles.tstats, styles.tabNums)} role="list" aria-label="Credibility signals">
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
            </div>
          </div>
        </section>

        {/* fees */}
        <section className={styles.fees} aria-labelledby="fees-title">
          <div className={styles.wrap}>
            <div className={styles.feesHead}>
              <p className={styles.eyebrow}>Simple, honest fees</p>
              <h2 className={styles.h2} id="fees-title">One small fee. Nothing hidden.</h2>
              <p className={styles.lead}>You always know exactly what you pay — and what you don&rsquo;t.</p>
            </div>
            <div className={styles.feesGrid}>
              <div className={cx(styles.feesHero, styles.reveal)}>
                <div className={styles.fl}>Annual management fee</div>
                <div className={cx(styles.fv, styles.tabNums)}>1.5<span>% a year</span></div>
                <p className={styles.fdesc}>A single fee on your balance covers professional investment and administration. That&rsquo;s it — the rest of your money keeps working for you.</p>
                <p className={styles.fcaveat}>Illustrative rate shown for design; your published rate applies.</p>
              </div>
              <div className={styles.feePoints}>
                {[
                  ['No fee to join', 'Opening your account is completely free.'],
                  ['No fee to withdraw', 'Take your pension or make a claim without exit charges.'],
                  ['No hidden charges', 'No setup, statement or transaction fees — ever.'],
                ].map(([b, s]) => (
                  <div key={b} className={cx(styles.feePoint, styles.reveal)}>
                    <span className={styles.fpi} aria-hidden="true"><Check /></span>
                    <div className={styles.fpt}><b>{b}</b><span>{s}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className={styles.faq} aria-labelledby="faq-title">
          <div className={styles.wrap}>
            <div className={styles.faqHead}>
              <p className={styles.eyebrow}>Good questions</p>
              <h2 className={styles.h2} id="faq-title">Everything you might be wondering.</h2>
            </div>
            <div className={styles.faqList}>
              {FAQS.map(([q, a]) => (
                <details key={q} className={cx(styles.faqItem, styles.reveal)}>
                  <summary><span>{q}</span><span className={styles.fqi} aria-hidden="true"><Plus /></span></summary>
                  <div className={styles.faqA}>{a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* dark CTA */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.wrap}>
            <div className={cx(styles.ctaCard, styles.reveal)}>
              <div className={styles.ctaGrid}>
                <div>
                  <p className={styles.eyebrow}>Open your account · From UGX 5,000/month</p>
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
                  <div className={styles.pmeta}><span className={styles.badge}>Starting today</span><span className={styles.pn}>UGX 5,000 / month · 40 years</span></div>
                  <div className={styles.pcover}><Shield /><span>Plus Life · Health · Funeral cover along the way</span></div>
                  <p className={styles.pcaveat}>Illustrative only; past returns don&rsquo;t guarantee future performance.</p>
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
