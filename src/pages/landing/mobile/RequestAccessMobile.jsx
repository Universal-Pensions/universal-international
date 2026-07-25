import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { submitAccessRequest } from '../../../services/requestAccess';
import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Lead-capture form for the two roles that are NOT self-provisioned: employers
// and distributors are created by an admin, so the public "get started" path is
// a request-access form, not a signup wizard. The submit persists a pending row
// to `access_requests`; a super-admin then approves (provisioning the account)
// or denies. Fields mirror the admin "Create distributor/employer" forms.
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', org: '', email: '', phone: '', sector: '', district: '' });

  const update = (key) => (e) => {
    if (error) setError('');
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (!form.org.trim()) {
      setError(`Please enter your ${copy.orgLabel.toLowerCase()}.`);
      return;
    }
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      await submitAccessRequest({
        type,
        orgName: form.org,
        contactName: form.name,
        contactEmail: form.email,
        contactPhone: form.phone,
        sector: form.sector,
        district: form.district,
      });
      setSubmitted(true);
    } catch {
      setError('Something went wrong sending your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
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
            Thanks{form.name ? `, ${form.name}` : ''}. An admin will review your request and approve
            your {type} access within 24 hours{form.email ? ` — we’ll email ${form.email}` : ''}.
          </p>
          <button className={cx(styles.btn, styles['btn-sec'])} onClick={() => navigate('/')}>Back to home</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className={styles.card}>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-org">{copy.orgLabel}</label>
              <input className={styles.finput} id="ra-org" value={form.org} onChange={update('org')} placeholder="Organisation" disabled={submitting} />
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-name">Your name</label>
              <input className={styles.finput} id="ra-name" value={form.name} onChange={update('name')} placeholder="Your full name" disabled={submitting} />
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-email">Work email</label>
              <input className={styles.finput} id="ra-email" type="email" value={form.email} onChange={update('email')} placeholder="you@company.com" disabled={submitting} />
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-phone">Phone <em>(optional)</em></label>
              <input className={styles.finput} id="ra-phone" type="tel" inputMode="tel" value={form.phone} onChange={update('phone')} placeholder="+256 …" disabled={submitting} />
            </div>

            {type === 'employer' && (
              <>
                <div className={styles.fgroup}>
                  <label className={styles.flabel} htmlFor="ra-sector">Sector <em>(optional)</em></label>
                  <input className={styles.finput} id="ra-sector" value={form.sector} onChange={update('sector')} placeholder="e.g. Manufacturing" disabled={submitting} />
                </div>
                <div className={styles.fgroup}>
                  <label className={styles.flabel} htmlFor="ra-district">District <em>(optional)</em></label>
                  <input className={styles.finput} id="ra-district" value={form.district} onChange={update('district')} placeholder="e.g. Kampala" disabled={submitting} />
                </div>
              </>
            )}

            <p className={styles.regNote}>Employer and distributor accounts are approved by an admin — you’ll get access within 24 hours.</p>
          </div>
          <button type="submit" className={cx(styles.btn, styles['btn-pri'], styles['btn-block'])} disabled={submitting} aria-busy={submitting || undefined}>
            {submitting ? 'Sending…' : 'Request access'}
          </button>
          {error && <p className={styles.demoNote} role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
