import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

// Lead-capture form for the two roles that are NOT self-provisioned: employers
// and distributors are created by an admin, so the public "get started" path is
// a request-access form, not a signup wizard. Demo scope: the submit is mocked
// (no backend) — it just shows a confirmation state.
const COPY = {
  employer: {
    eyebrow: 'For employers',
    title: 'Set up Universal Pensions for your team',
    lede: "Tell us about your company and our team will get your employer workspace ready — staff pensions plus group Life, Health & Funeral cover, onboarded from one spreadsheet.",
    orgLabel: 'Company name',
  },
  distributor: {
    eyebrow: 'For distributors',
    title: 'Become a Universal Pensions partner',
    lede: "Tell us about your network and our team will set up your distributor account — run branches and agents across Uganda, manage commissions, and grow from one map.",
    orgLabel: 'Network / organisation name',
  },
};

export default function RequestAccessMobile() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
    <div className={cx(styles.screen, styles.screenNoBar)}>
      <div className={styles.sect} style={{ marginTop: '2px' }}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h2 className={styles.sectTitle}>{copy.title}</h2>
        <p className={styles.sectLead}>{copy.lede}</p>
      </div>

      {submitted ? (
        <div className={styles.doneWrap}>
          <span className={styles.tick}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
          </span>
          <h3>Request received</h3>
          <p>
            Thanks{form.name ? `, ${form.name}` : ''}. Our team will reach out{form.email ? ` to ${form.email}` : ''} shortly to set up your {type} account.
          </p>
          <button className={cx(styles.btn, styles['btn-sec'])} onClick={() => navigate('/')}>Back to home</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className={styles.card}>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-name">Your name</label>
              <input className={styles.finput} id="ra-name" value={form.name} onChange={update('name')} placeholder="Your full name" />
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-org">{copy.orgLabel}</label>
              <input className={styles.finput} id="ra-org" value={form.org} onChange={update('org')} placeholder="Organisation" />
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-email">Work email</label>
              <input className={styles.finput} id="ra-email" type="email" value={form.email} onChange={update('email')} placeholder="you@company.com" />
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-phone">Phone <em>(optional)</em></label>
              <input className={styles.finput} id="ra-phone" type="tel" inputMode="tel" value={form.phone} onChange={update('phone')} placeholder="+256 …" />
            </div>
            <p className={styles.regNote}>Employer and distributor accounts are set up by our team. We'll be in touch.</p>
          </div>
          <button type="submit" className={cx(styles.btn, styles['btn-pri'], styles['btn-block'])}>Request access</button>
        </form>
      )}
    </div>
  );
}
