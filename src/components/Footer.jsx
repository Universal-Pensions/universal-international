import { Link } from 'react-router-dom';
import logo from '../assets/logo-white.png';
import { LEGAL_TERMS_URL, LEGAL_PRIVACY_URL } from '../config/env';
import styles from './Footer.module.css';

/**
 * Footer link metadata. Each item is one of:
 *   - { type: 'route', to } — internal route (react-router Link)
 *   - { type: 'hash', to }  — internal route + hash anchor (Link to "/#section")
 *   - { type: 'external', href } — external URL (opens in new tab)
 *   - { type: 'pending' } — destination not yet built; rendered as a disabled
 *     "Coming soon" item rather than a dead anchor.
 */
const LINKS = {
  Platform: [
    { label: 'For subscribers', type: 'route', to: '/' },
    { label: 'For employers', type: 'route', to: '/employers' },
    { label: 'For distributors', type: 'route', to: '/distributors' },
    { label: 'How it works', type: 'hash', to: '/#how' },
  ],
  Company: [
    { label: 'About us', type: 'route', to: '/about' },
    { label: 'Our mission', type: 'pending' },
    { label: 'Careers', type: 'pending' },
    { label: 'Press', type: 'pending' },
  ],
  Legal: [
    { label: 'Terms of service', type: 'external', href: LEGAL_TERMS_URL },
    { label: 'Privacy policy', type: 'external', href: LEGAL_PRIVACY_URL },
    { label: 'Regulatory notice', type: 'pending' },
    { label: 'NSSF compliance', type: 'pending' },
  ],
  Support: [
    { label: 'Help center', type: 'route', to: '/faq' },
    { label: 'Contact us', type: 'route', to: '/contact' },
    { label: 'Find an agent', type: 'pending' },
    { label: 'Branch locator', type: 'pending' },
  ],
};

const BOTTOM_LINKS = [
  { label: 'Privacy', type: 'external', href: LEGAL_PRIVACY_URL },
  { label: 'Terms', type: 'external', href: LEGAL_TERMS_URL },
  { label: 'Cookies', type: 'pending' },
  // Discreet super-admin entry point.
  { label: 'Admin', type: 'route', to: '/admin' },
];

function FooterItem({ item, className }) {
  if (item.type === 'route' || item.type === 'hash') {
    return (
      <Link to={item.to} className={className}>
        {item.label}
      </Link>
    );
  }
  if (item.type === 'external') {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={className}>
        {item.label}
      </a>
    );
  }
  // pending — non-interactive placeholder so users don't navigate to a dead anchor.
  return (
    <span
      className={`${className} ${styles.pending}`}
      aria-disabled="true"
      title="Coming soon"
    >
      {item.label}
    </span>
  );
}

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.top}>
          <div className={styles.brand}>
            <img src={logo} alt="Universal Pensions" className={styles.logo} width={140} height={40} loading="lazy" />
            <p className={styles.tagline}>
              Making long-term savings simple, accessible, and meaningful for every Ugandan.
            </p>
            <div className={styles.regulatory}>
              Licensed and regulated by the Uganda Retirement Benefits Regulatory Authority (URBRA).
            </div>
          </div>

          <nav className={styles.linksGrid} aria-label="Footer navigation">
            {Object.entries(LINKS).map(([group, items]) => (
              <div key={group} className={styles.linkGroup}>
                <h3 className={styles.groupLabel}>{group}</h3>
                <ul className={styles.linkList}>
                  {items.map((item) => (
                    <li key={item.label}>
                      <FooterItem item={item} className={styles.link} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className={styles.bottom}>
          <div className={styles.copyright}>
            © {new Date().getFullYear()} Universal Pensions Limited. All rights reserved.
          </div>
          <div className={styles.bottomLinks}>
            {BOTTOM_LINKS.map((item) => (
              <FooterItem key={item.label} item={item} className={styles.bottomLink} />
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
