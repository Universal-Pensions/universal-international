import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import styles from './RequestAccess.module.css';

// Lead-capture form for the two roles that are NOT self-provisioned: employers
// and distributors are created by an admin, so the public "get started" path is
// a request-access form, not a signup wizard. Demo scope: the submit is mocked
// (no backend) — it just shows a confirmation state.
const COPY = {
  employer: {
    eyebrow: 'For employers',
    title: "Set up Universal Pensions for your team",
    lede: "Tell us about your company and our team will get your employer workspace ready — staff pensions plus group Life, Health & Funeral cover, onboarded from one spreadsheet.",
    orgLabel: 'Company name',
    back: '/employers',
  },
  distributor: {
    eyebrow: 'For distributors',
    title: 'Become a Universal Pensions partner',
    lede: "Tell us about your network and our team will set up your distributor account — run branches and agents across Uganda, manage commissions, and grow from one map.",
    orgLabel: 'Network / organisation name',
    back: '/distributors',
  },
};

export default function RequestAccess() {
  const [params] = useSearchParams();
  const type = params.get('type') === 'distributor' ? 'distributor' : 'employer';
  const copy = COPY[type];
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: '', org: '', email: '', phone: '' });

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    // Demo: no backend — employer/distributor accounts are provisioned by an admin.
    setSubmitted(true);
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link to="/" className={styles.brand} aria-label="Universal Pensions home">
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></svg>
          </span>
          Universal Pensions
        </Link>
        <Link to={copy.back} className={styles.back}>← Back</Link>
      </header>

      <main id="main" className={styles.main}>
        {submitted ? (
          <div className={styles.done} role="status">
            <span className={styles.check} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
            </span>
            <h1 className={styles.title}>Request received</h1>
            <p className={styles.lede}>
              Thanks{form.name ? `, ${form.name}` : ''}. Our team will reach out{form.email ? ` to ${form.email}` : ''} shortly
              to set up your {type} account.
            </p>
            <Link to="/" className={styles.primary}>Back to home</Link>
          </div>
        ) : (
          <div className={styles.card}>
            <span className={styles.eyebrow}>{copy.eyebrow}</span>
            <h1 className={styles.title}>{copy.title}</h1>
            <p className={styles.lede}>{copy.lede}</p>
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.field} htmlFor="ra-name">
                <span>Your name</span>
                <input id="ra-name" aria-label="Your name" value={form.name} onChange={update('name')} required autoComplete="name" />
              </label>
              <label className={styles.field} htmlFor="ra-org">
                <span>{copy.orgLabel}</span>
                <input id="ra-org" aria-label={copy.orgLabel} value={form.org} onChange={update('org')} required autoComplete="organization" />
              </label>
              <label className={styles.field} htmlFor="ra-email">
                <span>Work email</span>
                <input id="ra-email" aria-label="Work email" type="email" value={form.email} onChange={update('email')} required autoComplete="email" />
              </label>
              <label className={styles.field} htmlFor="ra-phone">
                <span>Phone <em>(optional)</em></span>
                <input id="ra-phone" aria-label="Phone (optional)" type="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" inputMode="tel" />
              </label>
              <button type="submit" className={styles.primary}>Request access</button>
              <p className={styles.note}>
                Employer and distributor accounts are set up by our team — we will be in touch to get you started.
              </p>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
