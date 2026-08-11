import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';
import logo from '../assets/logo.png';
import { submitNomineeClaim } from '../services/nomineeClaim';
import {
  validateNomineeClaim, FIELD_ORDER, MAX_LEN, messageForCode, fieldForCode,
} from './landing/validateNomineeClaim';
import { toCanonicalUGPhone } from '../utils/phone';
import styles from './NomineeClaim.module.css';

// Public claim intake for a NOMINEE — the person a member named to receive their
// life or funeral benefit. Those covers pay out because the member has died, so
// the claimant is never the account holder and has no login. Hospital cash is
// the opposite case: the member claims it themselves, in-app, while alive.
//
// WHY THIS IS A FORM AND NOT A LOOKUP
// It would be friendlier to ask for a phone number and tell the family "yes,
// she was covered". It would also be a member-enumeration oracle for anyone who
// wanted to probe whether a given person holds a policy. So this form only ever
// ACCEPTS information; it never confirms or denies cover. A person reviews it
// and calls back. See api/nominee-claim.ts and migration 0100.
//
// TONE
// Everything here is read by someone who has just been bereaved, quite possibly
// on a phone, quite possibly within days. Short sentences, no jargon, no
// "policy holder", and no field we can manage without.

const STEPS = [
  ['You tell us what happened', 'It takes a few minutes.'],
  ['We check our records', 'Within two working days.'],
  ['We call you', 'And explain exactly what we need next.'],
];

const PRODUCTS = [
  {
    id: 'life',
    label: 'Life cover',
    blurb: 'A lump sum for the people they named.',
  },
  {
    id: 'funeral',
    label: 'Funeral cover',
    blurb: 'Help with funeral and burial costs.',
  },
];

const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other relative', 'Friend'];

const EMPTY = {
  product: '',
  deceasedName: '', deceasedNin: '', deceasedPhone: '', dateOfDeath: '',
  claimantName: '', claimantNin: '', claimantPhone: '', claimantEmail: '',
  relationship: '', district: '', notes: '',
};

// Module scope, NOT redefined inside the component — a component identity that
// changes every render remounts each input and steals focus on every keystroke.
function Field({ id, label, hint, error, wide, children, ...input }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ');
  return (
    <div className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      {children ?? (
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...input}
        />
      )}
      {hint && !error && <span className={styles.hint} id={`${id}-hint`}>{hint}</span>}
      {error && <span className={styles.fieldErr} id={`${id}-err`}>{error}</span>}
    </div>
  );
}

export default function NomineeClaim() {
  const reduce = useReducedMotion();

  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const doneRef = useRef(null);

  const update = (key) => (e) => {
    const { value } = e.target;
    setFormError('');
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    setForm((f) => ({ ...f, [key]: value }));
  };

  function pickProduct(id) {
    setFormError('');
    setErrors((prev) => (prev.product ? { ...prev, product: undefined } : prev));
    setForm((f) => ({ ...f, product: id }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const found = validateNomineeClaim(form);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = FIELD_ORDER.find((k) => found[k]);
      document.getElementById(`nc-${first}`)?.focus();
      return;
    }

    setErrors({});
    setFormError('');
    setSubmitting(true);
    try {
      const res = await submitNomineeClaim({
        product: form.product,
        deceasedName: form.deceasedName.trim(),
        deceasedNin: form.deceasedNin.trim(),
        // Canonicalised so it matches how every other phone in the system is
        // stored, which is what makes the admin's match-to-member step possible.
        deceasedPhone: form.deceasedPhone.trim() ? toCanonicalUGPhone(form.deceasedPhone) : '',
        dateOfDeath: form.dateOfDeath,
        claimantName: form.claimantName.trim(),
        claimantNin: form.claimantNin.trim(),
        claimantPhone: toCanonicalUGPhone(form.claimantPhone),
        claimantEmail: form.claimantEmail.trim(),
        relationship: form.relationship.trim(),
        district: form.district.trim(),
        notes: form.notes.trim(),
      });
      setReference(res.reference);
      setSubmitted(true);
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (err) {
      // Map a typed server code back onto its field where we can, so the fix is
      // where the problem is rather than in a banner at the top.
      const field = fieldForCode(err?.code);
      if (field) {
        setErrors({ [field]: messageForCode(err.code) });
        document.getElementById(`nc-${field}`)?.focus();
      } else {
        setFormError(
          messageForCode(err?.code)
          || err?.message
          || 'We could not send that. Please try again, or call us and we will take it over the phone.',
        );
      }
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
        <motion.aside className={styles.rail} {...rise}>
          <Link to="/" className={styles.brand} aria-label="Universal Pensions home">
            <img src={logo} alt="Universal Pensions" />
          </Link>
          <p className={styles.eyebrow}>Claim for a loved one</p>
          <h1 className={styles.railTitle}>We are sorry for your loss</h1>
          <p className={styles.lede}>
            If someone in your family saved with us and has passed away, you can start
            their claim here. You do not need an account.
          </p>
          <ol className={styles.steps}>
            {STEPS.map(([head, sub], i) => (
              <li key={head}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span className={styles.stepText}>
                  <b>{head}</b>
                  <span>{sub}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className={styles.railNote}>
            Claiming on your own hospital stay instead?{' '}
            <Link to="/">Sign in</Link> and file it from your account.
          </p>
        </motion.aside>

        <motion.section
          className={styles.panel}
          {...(reduce ? {} : { ...rise, transition: { ...rise.transition, delay: 0.06 } })}
        >
          {submitted ? (
            <div className={styles.done} tabIndex={-1} ref={doneRef}>
              <div className={styles.doneIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2>We have your claim</h2>
              <p>
                Someone will call you on <b>{form.claimantPhone}</b> within two working
                days. You do not need to do anything else for now.
              </p>
              <div className={styles.reference}>
                <span>Your reference</span>
                <b>{reference}</b>
              </div>
              <p className={styles.doneNote}>
                Please write this down. Quote it if you call us before we reach you.
              </p>
              <Link to="/" className={styles.doneLink}>Back to home</Link>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <fieldset className={styles.group}>
                <legend>What are you claiming?</legend>
                <div className={styles.products} role="radiogroup" aria-label="What are you claiming" id="nc-product">
                  {PRODUCTS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={form.product === p.id}
                      className={styles.product}
                      data-active={form.product === p.id}
                      onClick={() => pickProduct(p.id)}
                    >
                      <b>{p.label}</b>
                      <span>{p.blurb}</span>
                    </button>
                  ))}
                </div>
                {errors.product && <span className={styles.fieldErr}>{errors.product}</span>}
              </fieldset>

              <fieldset className={styles.group}>
                <legend>About the person who died</legend>
                <div className={styles.grid}>
                  <Field
                    id="nc-deceasedName" label="Their full name" wide
                    value={form.deceasedName} onChange={update('deceasedName')}
                    maxLength={MAX_LEN.deceasedName} error={errors.deceasedName}
                    autoComplete="off"
                  />
                  <Field
                    id="nc-deceasedNin" label="Their National ID number"
                    hint="Either this or their phone number — whichever you have."
                    value={form.deceasedNin} onChange={update('deceasedNin')}
                    maxLength={MAX_LEN.deceasedNin} error={errors.deceasedNin}
                    autoComplete="off"
                  />
                  <Field
                    id="nc-deceasedPhone" label="Their phone number"
                    hint="Optional"
                    type="tel" inputMode="tel"
                    value={form.deceasedPhone} onChange={update('deceasedPhone')}
                    placeholder="0771 234 567" error={errors.deceasedPhone}
                    autoComplete="off"
                  />
                  <Field
                    id="nc-dateOfDeath" label="Date they passed away"
                    type="date" max={new Date().toISOString().slice(0, 10)}
                    value={form.dateOfDeath} onChange={update('dateOfDeath')}
                    error={errors.dateOfDeath}
                  />
                </div>
              </fieldset>

              <fieldset className={styles.group}>
                <legend>About you</legend>
                <div className={styles.grid}>
                  <Field
                    id="nc-claimantName" label="Your full name"
                    value={form.claimantName} onChange={update('claimantName')}
                    maxLength={MAX_LEN.claimantName} error={errors.claimantName}
                    autoComplete="name"
                  />
                  <Field
                    id="nc-relationship" label="How were you related?"
                    error={errors.relationship}
                  >
                    <select
                      id="nc-relationship"
                      value={form.relationship}
                      onChange={update('relationship')}
                      aria-invalid={errors.relationship ? true : undefined}
                    >
                      <option value="">Choose one</option>
                      {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Field>
                  <Field
                    id="nc-claimantPhone" label="Your phone number"
                    hint="We will call you on this number."
                    type="tel" inputMode="tel"
                    value={form.claimantPhone} onChange={update('claimantPhone')}
                    placeholder="0771 234 567" error={errors.claimantPhone}
                    autoComplete="tel"
                  />
                  <Field
                    id="nc-claimantEmail" label="Your email"
                    hint="Optional"
                    type="email"
                    value={form.claimantEmail} onChange={update('claimantEmail')}
                    maxLength={MAX_LEN.claimantEmail} error={errors.claimantEmail}
                    autoComplete="email"
                  />
                  <Field
                    id="nc-claimantNin" label="Your National ID number"
                    hint="Optional — it helps us confirm who you are."
                    value={form.claimantNin} onChange={update('claimantNin')}
                    maxLength={MAX_LEN.claimantNin} error={errors.claimantNin}
                    autoComplete="off"
                  />
                  <Field
                    id="nc-district" label="Your district"
                    hint="Optional"
                    value={form.district} onChange={update('district')}
                    maxLength={MAX_LEN.district} error={errors.district}
                    autoComplete="off"
                  />
                  <Field id="nc-notes" label="Anything else we should know?" wide error={errors.notes}>
                    <textarea
                      id="nc-notes"
                      rows={3}
                      value={form.notes}
                      onChange={update('notes')}
                      maxLength={MAX_LEN.notes}
                      placeholder="Optional. For example, where the death certificate was issued."
                      aria-invalid={errors.notes ? true : undefined}
                    />
                  </Field>
                </div>
              </fieldset>

              {formError && <p className={styles.formErr} role="alert">{formError}</p>}

              <button type="submit" className={styles.submit} disabled={submitting}>
                {submitting ? 'Sending…' : 'Start the claim'}
              </button>
              <p className={styles.legal}>
                We only use these details to find the record and contact you about
                this claim.
              </p>
            </form>
          )}
        </motion.section>
      </main>
    </div>
  );
}
