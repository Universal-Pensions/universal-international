import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { submitAccessRequest } from '../../../services/requestAccess';
import { validateAccessRequest, FIELD_ORDER, MAX_LEN, messageForCode } from '../validateAccessRequest';
import { toCanonicalUGPhone } from '../../../utils/phone';
import { DISTRICT_NAMES } from '../../../constants/districts';
import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');

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
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({ name: '', org: '', registrationNo: '', email: '', phone: '', sector: '', district: '' });

  const update = (key) => (e) => {
    if (error) setError('');
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    // Shared with the desktop variant so a field can never be required on one
    // surface and optional on the other — which is exactly how the phone (the
    // sign-in key) ended up optional here.
    const found = validateAccessRequest(form, type);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = FIELD_ORDER[type].find((k) => found[k]);
      document.getElementById(`ra-${first}`)?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await submitAccessRequest({
        type,
        orgName: form.org.trim(),
        registrationNo: form.registrationNo.trim(),
        contactName: form.name.trim(),
        contactEmail: form.email.trim(),
        contactPhone: toCanonicalUGPhone(form.phone),
        sector: form.sector.trim(),
        district: form.district.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      setError(messageForCode(err?.code));
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
          {/* Promise the call, not an email — there is no mail provider wired
              up anywhere in this repo, so "we'll email you" was a promise the
              platform could not keep. The phone is now always present. */}
          <p>
            Thank you. We will check your request and call you on{' '}
            <b>{form.phone.trim()}</b> within 24 hours to open your account.
          </p>
          <button className={cx(styles.btn, styles['btn-sec'])} onClick={() => navigate('/')}>Back to home</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className={styles.card}>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-org">{copy.orgLabel}</label>
              <input className={styles.finput} id="ra-org" value={form.org} onChange={update('org')} placeholder="Organisation" maxLength={MAX_LEN.org[type]} disabled={submitting}
                aria-invalid={errors.org ? true : undefined}
                aria-describedby={errors.org ? 'ra-org-err' : undefined} />
              {errors.org && <span className={styles.ferr} id="ra-org-err">{errors.org}</span>}
            </div>
            <div className={styles.fgroup}>
              {/* Company registration number — parity with the admin
                  "+ New Employer" form, and required for distributors too
                  (they are registered companies in Uganda as well). 0095. */}
              <label className={styles.flabel} htmlFor="ra-registrationNo">Company registration number</label>
              <input className={styles.finput} id="ra-registrationNo" value={form.registrationNo}
                onChange={update('registrationNo')} placeholder="e.g. 80020002345678"
                maxLength={MAX_LEN.registrationNo} disabled={submitting}
                aria-invalid={errors.registrationNo ? true : undefined}
                aria-describedby={errors.registrationNo ? 'ra-registrationNo-err' : undefined} />
              {errors.registrationNo && <span className={styles.ferr} id="ra-registrationNo-err">{errors.registrationNo}</span>}
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-name">Your name</label>
              <input className={styles.finput} id="ra-name" value={form.name} onChange={update('name')} placeholder="Your full name" maxLength={MAX_LEN.name} disabled={submitting}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'ra-name-err' : undefined} />
              {errors.name && <span className={styles.ferr} id="ra-name-err">{errors.name}</span>}
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-email">Work email</label>
              <input className={styles.finput} id="ra-email" type="email" value={form.email} onChange={update('email')} placeholder="you@company.com" maxLength={MAX_LEN.email} disabled={submitting}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'ra-email-err' : undefined} />
              {errors.email && <span className={styles.ferr} id="ra-email-err">{errors.email}</span>}
            </div>
            <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-phone">Phone number</label>
              <input className={styles.finput} id="ra-phone" type="tel" inputMode="tel" value={form.phone} onChange={update('phone')} placeholder="0771 234 567" maxLength={MAX_LEN.phone} disabled={submitting}
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? 'ra-phone-err' : 'ra-phone-hint'} />
              <span className={styles.fhint} id="ra-phone-hint">You will sign in with this number.</span>
              {errors.phone && <span className={styles.ferr} id="ra-phone-err">{errors.phone}</span>}
            </div>

            {type === 'employer' && (
              <>
                <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-sector">What your company does</label>
              <input className={styles.finput} id="ra-sector" value={form.sector} onChange={update('sector')} placeholder="e.g. Manufacturing" maxLength={MAX_LEN.sector} disabled={submitting}
                aria-invalid={errors.sector ? true : undefined}
                aria-describedby={errors.sector ? 'ra-sector-err' : undefined} />
              {errors.sector && <span className={styles.ferr} id="ra-sector-err">{errors.sector}</span>}
            </div>
                <div className={styles.fgroup}>
              <label className={styles.flabel} htmlFor="ra-district">District</label>
              <input className={styles.finput} id="ra-district" value={form.district} onChange={update('district')} placeholder="e.g. Kampala" list="ra-districts-m" maxLength={MAX_LEN.district} disabled={submitting}
                aria-invalid={errors.district ? true : undefined}
                aria-describedby={errors.district ? 'ra-district-err' : undefined} />
              {errors.district && <span className={styles.ferr} id="ra-district-err">{errors.district}</span>}
            </div>
                <datalist id="ra-districts-m">{DISTRICT_NAMES.map((d) => <option key={d} value={d} />)}</datalist>
              </>
            )}

            <p className={styles.regNote}>All fields are required. An admin approves employer and distributor accounts — usually within 24 hours.</p>
          </div>
          {/* Above the button, and in the error colour — this used to render
              BELOW the CTA styled as `demoNote`, the amber "this is a demo"
              chip, so a failure read as an advisory. */}
          {error && <p className={styles.ferr} role="alert" style={{ margin: '0 0 10px' }}>{error}</p>}
          <button type="submit" className={cx(styles.btn, styles['btn-pri'], styles['btn-block'])} disabled={submitting} aria-busy={submitting || undefined}>
            {submitting ? 'Sending…' : 'Request access'}
          </button>
        </form>
      )}
    </div>
  );
}
