import { useState, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';
import logo from '../assets/logo.png';
import { submitAccessRequest } from '../services/requestAccess';
import {
  validateAccessRequest, FIELD_ORDER, MAX_LEN, messageForCode,
} from './landing/validateAccessRequest';
import { toCanonicalUGPhone } from '../utils/phone';
import { DISTRICT_NAMES } from '../constants/districts';
import styles from './RequestAccess.module.css';

// Lead-capture form for the two roles that are NOT self-provisioned: employers
// and distributors are created by an admin, so the public "get started" path is
// a request form, not a signup wizard. Submitting persists a pending
// `access_requests` row; a super-admin then approves — which provisions the real
// account and (migration 0090) writes the `demo_personas` row that lets the
// phone captured below sign in as THAT account.
//
// EVERY field is required. The phone especially: it is the sign-in key, and an
// account approved without one is unreachable forever. The three-step strip
// below exists to earn that ask rather than just demanding it.

const STEPS = [
  ['You send this form', 'It takes about a minute.'],
  ['We check it', 'Within 24 hours on a working day.'],
  ['We call you and open your account', 'On the phone number you give here.'],
];

const COPY = {
  employer: {
    eyebrow: 'For employers',
    title: 'Set up pensions for your team',
    lede: 'Staff pensions plus group Life, Health and Funeral cover — set up from one staff list.',
    orgLabel: 'Company name',
    orgPlaceholder: 'e.g. Kampala Steel Ltd',
    regHint: 'As it appears on your URSB certificate.',
    back: '/employers',
    backLabel: 'Back to employers',
  },
  distributor: {
    eyebrow: 'For distributors',
    title: 'Run your network with us',
    lede: 'Branches, field agents and commissions across Uganda — managed from one map.',
    orgLabel: 'Network name',
    orgPlaceholder: 'e.g. Busoga Financial Services',
    regHint: 'Your company registration number — as it appears on your URSB certificate.',
    back: '/distributors',
    backLabel: 'Back to distributors',
  },
};

const EMPTY = { org: '', registrationNo: '', name: '', email: '', phone: '', sector: '', district: '' };

// Module scope, NOT redefined inside the component — a component identity that
// changes every render remounts each input and steals focus on every keystroke.
function Field({ id, label, hint, error, wide, ...input }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ');
  return (
    <div className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && !error && <span className={styles.hint} id={`${id}-hint`}>{hint}</span>}
      {error && <span className={styles.fieldErr} id={`${id}-err`}>{error}</span>}
    </div>
  );
}

export default function RequestAccess() {
  const [params] = useSearchParams();
  // Normalise so `?type=Distributor` isn't silently coerced to an employer.
  const raw = String(params.get('type') ?? '').trim().toLowerCase();
  const type = raw === 'distributor' ? 'distributor' : 'employer';
  const copy = COPY[type];
  const reduce = useReducedMotion();

  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});       // per-field
  const [formError, setFormError] = useState(''); // transport / server level
  const [form, setForm] = useState(EMPTY);
  const doneRef = useRef(null);

  const update = (key) => (e) => {
    const { value } = e.target;
    setFormError('');
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const found = validateAccessRequest(form, type);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = FIELD_ORDER[type].find((k) => found[k]);
      document.getElementById(`ra-${first}`)?.focus();
      return;
    }

    setErrors({});
    setFormError('');
    setSubmitting(true);
    try {
      await submitAccessRequest({
        type,
        orgName: form.org.trim(),
        registrationNo: form.registrationNo.trim(),
        contactName: form.name.trim(),
        contactEmail: form.email.trim(),
        // Store the sign-in key in the canonical form the auth layer computes.
        contactPhone: toCanonicalUGPhone(form.phone),
        sector: form.sector.trim(),
        district: form.district.trim(),
      });
      setSubmitted(true);
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (err) {
      setFormError(messageForCode(err?.code));
      setSubmitting(false);
    }
  }

  const rise = reduce
    ? {}
    : {
      initial: { opacity: 0, y: 14 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, ease: EASE_OUT_EXPO },
    };

  return (
    <div className={styles.page}>
      <main id="main" className={styles.shell}>
        {/* ── Brand rail: the real logo, the pitch, and what happens next ── */}
        <motion.aside className={styles.rail} {...rise}>
          <Link to="/" className={styles.brand} aria-label="Universal Pensions home">
            {/* logo.png is 2670x1080 (2.472:1) — at 34px tall that is 84px wide. */}
            <img src={logo} alt="Universal Pensions" width={84} height={34} />
          </Link>

          <div className={styles.railBody}>
            <span className={styles.eyebrow}>{copy.eyebrow}</span>
            <h1 className={styles.title}>{copy.title}</h1>
            <p className={styles.lede}>{copy.lede}</p>

            <ol className={styles.steps}>
              {STEPS.map(([head, sub], i) => (
                <li key={head}>
                  <span className={styles.stepNum} aria-hidden="true">{i + 1}</span>
                  <span className={styles.stepTx}>
                    <b>{head}</b>
                    <small>{sub}</small>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <Link to={copy.back} className={styles.back}>← {copy.backLabel}</Link>
        </motion.aside>

        {/* ── Form panel ── */}
        <motion.section
          className={styles.panel}
          {...(reduce ? {} : { ...rise, transition: { ...rise.transition, delay: 0.06 } })}
        >
          {submitted ? (
            <div className={styles.done} role="status">
              <span className={styles.check} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
              </span>
              <h2 className={styles.doneTitle} ref={doneRef} tabIndex={-1}>Request received</h2>
              <p className={styles.doneTx}>
                Thank you. We will check your request and call you on{' '}
                <b>{form.phone.trim()}</b> within 24 hours to open your account.
              </p>
              <Link to="/" className={styles.primary}>Back to home</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form} noValidate>
              <p className={styles.allReq}>All fields are required.</p>

              <div className={styles.grid}>
                <Field
                  id="ra-org" label={copy.orgLabel} wide
                  value={form.org} onChange={update('org')} error={errors.org}
                  autoComplete="organization" placeholder={copy.orgPlaceholder}
                  maxLength={MAX_LEN.org[type]}
                />
                {/* Company identity sits with the org name — the admin
                    "+ New Employer" form has always captured it, so a
                    self-signed-up account was otherwise provisioned without it
                    (migration 0095). Required for distributors too: they are
                    registered companies in Uganda as well. */}
                <Field
                  id="ra-registrationNo" label="Company registration number"
                  value={form.registrationNo} onChange={update('registrationNo')}
                  error={errors.registrationNo}
                  autoComplete="off" placeholder="e.g. 80020002345678"
                  maxLength={MAX_LEN.registrationNo}
                  hint={copy.regHint}
                />
                <Field
                  id="ra-name" label="Your name"
                  value={form.name} onChange={update('name')} error={errors.name}
                  autoComplete="name" maxLength={MAX_LEN.name}
                />
                <Field
                  id="ra-email" label="Work email" type="email"
                  value={form.email} onChange={update('email')} error={errors.email}
                  autoComplete="email" maxLength={MAX_LEN.email}
                />
                <Field
                  id="ra-phone" label="Phone number" type="tel" inputMode="tel"
                  value={form.phone} onChange={update('phone')} error={errors.phone}
                  autoComplete="tel" placeholder="0771 234 567" maxLength={MAX_LEN.phone}
                  hint="You will sign in with this number."
                />

                {type === 'employer' && (
                  <>
                    <Field
                      id="ra-sector" label="What your company does"
                      value={form.sector} onChange={update('sector')} error={errors.sector}
                      autoComplete="off" placeholder="e.g. Manufacturing"
                      maxLength={MAX_LEN.sector}
                    />
                    <Field
                      id="ra-district" label="District"
                      value={form.district} onChange={update('district')} error={errors.district}
                      autoComplete="address-level2" placeholder="e.g. Kampala"
                      list="ra-districts" maxLength={MAX_LEN.district}
                    />
                    <datalist id="ra-districts">
                      {DISTRICT_NAMES.map((d) => <option key={d} value={d} />)}
                    </datalist>
                  </>
                )}
              </div>

              {formError && <p className={styles.error} role="alert">{formError}</p>}

              <div className={styles.actions}>
                <button
                  type="submit" className={styles.primary}
                  disabled={submitting} aria-busy={submitting || undefined}
                >
                  {submitting ? 'Sending…' : 'Request access'}
                </button>
                <p className={styles.note}>
                  An admin approves employer and distributor accounts — usually within 24 hours.
                </p>
              </div>
            </form>
          )}
        </motion.section>
      </main>
    </div>
  );
}
