import { useEffect, useRef, useState } from 'react';
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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg>
);
const Network = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
);
const Pin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
const Chart = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg>
);

const ROLES = {
  distributor: { label: 'Distributor', title: 'Log in to your distributor account', idLabel: 'Distributor ID or email', ph: 'e.g. dist-central or you@network.co.ug' },
  branch: { label: 'Branch', title: 'Log in to your branch account', idLabel: 'Branch ID or email', ph: 'e.g. branch-kampala or you@network.co.ug' },
  agent: { label: 'Agent', title: 'Log in to your agent account', idLabel: 'Agent ID or email', ph: 'e.g. agent-0421 or you@network.co.ug' },
};

export default function DistributorsPage() {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const rootRef = useRef(null);
  const [role, setRole] = useState('distributor');

  const goSignup = () => navigate('/signup');
  const goRequestAccess = () => navigate('/request-access');
  const openSignIn = () => signIn.open();
  const onLogin = (e) => { e.preventDefault(); signIn.open(); };
  const r = ROLES[role];

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
      <LandingHeader active="distributors" ctaLabel="Get started" />

      <main id="main">
        {/* hero — distributor-catered */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={cx(styles.wrap, styles.heroGrid)}>
            <div>
              <h1 id="hero-title">Run your whole network<br /><span className={styles.accent}>from one map.</span></h1>
              <p className={styles.sub}>Run your branches and field agents from one map — <strong>compare performance</strong>, <strong>manage commissions</strong>, and settle dues in a few clicks.</p>
              <div className={styles.heroCta}>
                <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={goSignup}>Become a partner <Arrow /></button>
                <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={openSignIn}>Log in to your account</button>
              </div>
              <p className={styles.heroMeta}>
                <Check w="2.4" />
                Country → region → district → branch → agent, on one map.
              </p>
              <div className={cx(styles.heroStats, styles.tabNums)} role="list" aria-label="Network proof points">
                <div className={styles.st} role="listitem"><div className={styles.sv}>316</div><div className={styles.sl}>Branches nationwide</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>2,049</div><div className={styles.sl}>Active field agents</div></div>
                <div className={styles.st} role="listitem"><div className={styles.sv}>UGX 42B</div><div className={styles.sl}>Network savings managed</div></div>
              </div>
            </div>

            {/* distributor login card with role tabs */}
            <div className={styles.loginCard} role="region" aria-labelledby="login-title">
              <p className={styles.loginEyebrow}>Partner portal</p>
              <div className={styles.roleTabs} role="group" aria-label="Choose your account type">
                {Object.keys(ROLES).map((key) => (
                  <button key={key} type="button" aria-pressed={role === key} onClick={() => setRole(key)}>{ROLES[key].label}</button>
                ))}
              </div>
              <h2 className={styles.loginTitle} id="login-title">{r.title}</h2>
              <form onSubmit={onLogin} noValidate>
                <div className={styles.field}>
                  <label htmlFor="dist-login-id">{r.idLabel}</label>
                  <input type="text" id="dist-login-id" name="login-id" autoComplete="username" placeholder={r.ph} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="dist-login-pass">Password</label>
                  <input type="password" id="dist-login-pass" name="login-pass" autoComplete="current-password" placeholder="Your password" />
                </div>
                <div className={styles.loginCta}>
                  <button type="submit" className={cx(styles.btn, styles.btnPrimary)}>Log in <Arrow /></button>
                </div>
                <button type="button" className={styles.loginForgot} onClick={openSignIn}>Forgot password?</button>
                <div className={styles.loginDiv} aria-hidden="true">New here?</div>
                <button type="button" className={cx(styles.btn, styles.btnSecondary, styles.loginNew)} onClick={goRequestAccess}>Request access</button>
              </form>
            </div>
          </div>
        </section>

        {/* dual promise */}
        <section className={styles.dual} aria-label="What the distributor platform offers">
          <div className={cx(styles.wrap, styles.dualGrid)}>
            <div className={cx(styles.dualCell, styles.reveal)} style={{ '--ac': 'var(--indigo)' }}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><Pin /></span>
              <div>
                <h3>Network-wide visibility</h3>
                <p>See your entire operation on one live map — country to region to district to branch to agent. Drill into any level to find what&rsquo;s working and what needs attention, without spreadsheets or calls.</p>
              </div>
            </div>
            <div className={cx(styles.dualCell, styles.reveal)} style={{ '--ac': 'var(--green-ink)' }}>
              <span className={styles.chip} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }} aria-hidden="true"><Chart /></span>
              <div>
                <h3>Commission management</h3>
                <p>Track what every branch and agent has earned, review the breakdown, and settle dues in a few clicks. Transparent statements mean fewer disputes and faster pay-outs across the network.</p>
              </div>
            </div>
          </div>
        </section>

        {/* network reach strip */}
        <div className={styles.strip} aria-label="How distributors operate">
          <div className={cx(styles.wrap, styles.stripIn)}>
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><Network /></span>
              <div><div className={styles.bt}>Branch &amp; agent map</div><div className={styles.bs}>One view of the whole network</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--green-ink)', '--tint': '46,139,87' }} aria-hidden="true"><Chart /></span>
              <div><div className={styles.bt}>Live performance</div><div className={styles.bs}>Compare any two branches</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg></span>
              <div><div className={styles.bt}>Commission settlement</div><div className={styles.bs}>Pay dues in a few clicks</div></div>
            </div>
            <div className={styles.sep} aria-hidden="true" />
            <div className={styles.badge}>
              <span className={styles.chip} style={{ '--ac': 'var(--indigo-soft)', '--tint': '94,99,168' }} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 9h6M9 13h4" /></svg></span>
              <div><div className={styles.bt}>Strategic reports</div><div className={styles.bs}>Export region &amp; district trends</div></div>
            </div>
          </div>
        </div>

        {/* platform detail — feature rows + network visual */}
        <section className={styles.aud} id="platform" aria-labelledby="aud-title">
          <div className={cx(styles.wrap, styles.audGrid)}>
            <div className={styles.audCopy}>
              <span className={styles.audTag} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }}>
                <Network />
                For Distributors &amp; Partners
              </span>
              <h2 id="aud-title">Everything your network needs, in one place.</h2>
              <p className={styles.ad}>From the national picture down to a single agent — performance, commissions and growth in one console.</p>
              <ul className={styles.feat} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }}>
                {[
                  ['Network-wide visibility', 'Watch every branch and agent on a single live map — drill from country down to district and beyond.'],
                  ['Branch & agent comparison', 'Rank performers side by side on contributions, active members and growth to see where to invest.'],
                  ['Commission management', 'Track what’s owed, review the breakdown and settle dues in a few clicks — with transparent statements.'],
                  ['Strategic reporting', 'Export region and district trends to plan expansion and brief your field teams with confidence.'],
                ].map(([b, s]) => (
                  <li key={b}>
                    <span className={styles.tick} aria-hidden="true"><Check /></span>
                    <span className={styles.ft}><b>{b}</b><span>{s}</span></span>
                  </li>
                ))}
              </ul>
              <div className={styles.audActions}>
                <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={goSignup}>Become a partner <Arrow /></button>
                <button type="button" className={styles.txtlink} onClick={openSignIn}>Log in to your account <ArrowLink /></button>
              </div>
            </div>

            {/* visual: stylised Uganda map + network KPIs + region roster */}
            <div className={styles.audVis}>
              <div className={cx(styles.vcard, styles.reveal)}>
                <div className={styles.vcardHead}>
                  <span className={styles.chip} style={{ '--ac': 'var(--indigo)', '--tint': '41,40,103' }} aria-hidden="true"><Pin /></span>
                  <span className={styles.vt}>Network overview</span>
                  <span className={styles.vmeta}>All regions</span>
                </div>
                <div className={styles.mapMini} role="img" aria-label="Stylised map of Uganda with branch clusters across Central, Western and Northern regions">
                  <svg viewBox="0 0 360 188" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                    <defs>
                      <linearGradient id="ugFill" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#5E63A8" stopOpacity=".20" /><stop offset="1" stopColor="#292867" stopOpacity=".10" />
                      </linearGradient>
                    </defs>
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
                <div className={cx(styles.kpis, styles.tabNums)}>
                  <div className={styles.kpi}>
                    <div className={styles.kl}>Branches</div>
                    <div className={styles.kv}>316</div>
                    <div className={styles.ks}>Across 4 regions</div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kl}>Active agents</div>
                    <div className={cx(styles.kv, styles.g)}>2,049</div>
                    <div className={styles.ks}>+124 this quarter</div>
                  </div>
                </div>
              </div>

              <div className={cx(styles.vcard, styles.reveal)}>
                <div className={styles.vcardHead}>
                  <span className={styles.chip} style={{ '--ac': 'var(--teal-ink)', '--tint': '47,143,157' }} aria-hidden="true"><Chart /></span>
                  <span className={styles.vt}>Region performance</span>
                  <span className={styles.vmeta}>This month</span>
                </div>
                <div className={cx(styles.rows, styles.tabNums)}>
                  {[
                    ['C', 'Central', '128 branches · 842 agents', 'UGX 21B', '+8.2% MoM'],
                    ['W', 'Western', '94 branches · 611 agents', 'UGX 12B', '+6.1% MoM'],
                    ['N', 'Northern', '61 branches · 397 agents', 'UGX 9B', '+9.4% MoM'],
                  ].map(([ri, rn, rs, rvb, rvc]) => (
                    <div key={rn} className={styles.rrow}>
                      <span className={styles.ri} aria-hidden="true">{ri}</span>
                      <div className={styles.rmain}><div className={styles.rn}>{rn}</div><div className={styles.rs}>{rs}</div></div>
                      <div className={styles.rv}><div className={styles.rvb}>{rvb}</div><div className={styles.rvc}>{rvc}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* how the partnership works */}
        <section className={styles.how} id="how" aria-labelledby="how-title">
          <div className={styles.wrap}>
            <div className={styles.howHead}>
              <p className={styles.eyebrow}>How the partnership works</p>
              <h2 className={styles.h2} id="how-title">From handshake to a thriving network.<br /><span style={{ color: 'var(--indigo-soft)' }}>In four steps.</span></h2>
              <p className={styles.lead}>We give you the platform, the products and the support — you bring the local reach.</p>
            </div>
            <div className={styles.steps}>
              {[
                ['01', 'var(--indigo)', '41,40,103', <><path key="a" d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle key="b" cx="9.5" cy="7" r="4" /><path key="c" d="M19 8v6M22 11h-6" /></>, 'Partner with us', 'Request access and we’ll set up your distributor account, products and commission terms.', 'Onboarding & support'],
                ['02', 'var(--green-ink)', '46,139,87', <path key="a" d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5" />, 'Onboard branches & agents', 'Add your branches and field agents, set their districts, and they’re live on the network map.', 'Map them by district'],
                ['03', 'var(--teal-ink)', '47,143,157', <><path key="a" d="M9 18V5l12-2v13" /><circle key="b" cx="6" cy="18" r="3" /><circle key="c" cx="18" cy="16" r="3" /></>, 'Grow your member base', 'Your agents sell pensions and insurance to their communities while you watch the numbers climb.', 'Pensions + insurance'],
                ['04', 'var(--indigo-soft)', '94,99,168', <><rect key="a" x="3" y="5" width="18" height="14" rx="2" /><path key="b" d="M3 10h18M7 15h4" /></>, 'Review & settle commissions', 'See what each branch and agent has earned and settle dues in a few clicks — fully transparent.', 'Settle in a few clicks'],
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

        {/* distributor testimonials */}
        <section className={styles.stories} aria-labelledby="stories-title">
          <div className={styles.wrap}>
            <div className={styles.storiesHead}>
              <p className={styles.eyebrow}>Real stories</p>
              <h2 className={styles.h2} id="stories-title">Networks that run on the map.</h2>
            </div>
            <div className={styles.quotes}>
              {[
                ['47,143,157', 'The distributor map shows my whole region at a glance. I compare branches, settle commissions in a few clicks, and know exactly where to push next. My agents get paid on time and our members are growing fast.', 'GA', 'Grace Atim', 'Network operations · Northern Uganda'],
                ['41,40,103', 'Onboarding new branches takes minutes, not weeks. The moment an agent is added they show up on the map and start contributing to the regional numbers I report on.', 'DM', 'David Mugisha', 'Regional lead · Western Uganda'],
                ['46,139,87', 'Commission disputes used to eat my week. Now every agent sees a transparent statement, and I settle the whole district from one screen. It has made my network far easier to trust.', 'SN', 'Sarah Nakato', 'Branch coordinator · Central Uganda'],
              ].map(([tint, q, av, nm, roleLabel]) => (
                <div key={nm} className={cx(styles.quote, styles.reveal)} style={{ '--ac': 'var(--indigo)', '--tint': tint }}>
                  <div className={styles.qm} aria-hidden="true">&ldquo;</div>
                  <p>{q}</p>
                  <div className={styles.qby}><span className={styles.qav} aria-hidden="true">{av}</span><div><div className={styles.qn}>{nm}</div><div className={styles.qr}>{roleLabel}</div></div></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* trust band */}
        <section className={styles.tband} aria-labelledby="trust-title">
          <div className={styles.wrap}>
            <div className={styles.tbandHead}>
              <p className={styles.eyebrow}>Why partners trust us</p>
              <h2 className={styles.h2} id="trust-title">A network you can build on.</h2>
              <p className={styles.lead}>Regulated products, transparent settlement and nationwide reach — the foundations behind every partnership.</p>
            </div>
            <div className={cx(styles.tstats, styles.tabNums)} role="list" aria-label="Credibility signals">
              {[
                ['var(--indigo)', '41,40,103', <Shield />, 'URBRA', 'Licensed & regulated in Uganda'],
                ['var(--indigo-soft)', '94,99,168', <Network />, '4 regions', 'Nationwide branch coverage'],
                ['var(--teal-ink)', '47,143,157', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>, 'Transparent', 'Every commission, fully traceable'],
                ['var(--green-ink)', '46,139,87', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>, 'Same-day', 'Settle commissions when you choose'],
              ].map(([ac, tint, icon, tv, tl]) => (
                <div key={tv} className={styles.ts} role="listitem" style={{ '--ac': ac, '--tint': tint }}>
                  <span className={styles.tchip} aria-hidden="true">{icon}</span>
                  <div className={styles.tv}>{tv}</div><div className={styles.tl}>{tl}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* final CTA */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.wrap}>
            <div className={cx(styles.ctaCard, styles.reveal)}>
              <div className={styles.ctaGrid}>
                <div>
                  <p className={styles.eyebrow}>Become a partner · Nationwide reach</p>
                  <h2 id="cta-title">Bring formal pensions<br /><span className={styles.accent}>to your community.</span></h2>
                  <p>Run branches and agents across Uganda — manage commissions, grow your member base, and lead the whole network from one map.</p>
                  <div className={styles.ctaActions}>
                    <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={goSignup}>Become a partner <Arrow /></button>
                    <button type="button" className={cx(styles.btn, styles.btnSecondary)} onClick={openSignIn}>Log in to your account</button>
                  </div>
                </div>
                <div className={cx(styles.proj, styles.tabNums)} aria-label="Illustrative network snapshot">
                  <div className={styles.pl}>Network savings managed</div>
                  <div className={styles.pv}>UGX 42B</div>
                  <div className={styles.pmeta}><span className={styles.badge}>Growing</span><span className={styles.pn}>316 branches · 2,049 agents</span></div>
                  <div className={styles.pcover}><Network /><span>4 regions · Central, Western, Northern &amp; Eastern</span></div>
                  <p className={styles.pcaveat}>Illustrative network figures shown for design; live numbers reflect your own branches and agents.</p>
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
