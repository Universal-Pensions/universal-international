import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { submitContactForm } from '../../../services/contact';
import { SUPPORT_EMAIL } from '../../../config/env';
import styles from './landingMobile.module.css';

const cx = (...c) => c.filter(Boolean).join(' ');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ContactMobile() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [demo, setDemo] = useState(false);
  // Honest, per-error message string (mirrors the desktop Contact form) — NOT a
  // blanket "this is a demo" note. Empty when there is nothing to report.
  const [error, setError] = useState('');

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (error) setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    // Client-side validation, mirroring the desktop Contact form.
    if (!form.name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!EMAIL_PATTERN.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!form.message.trim()) {
      setError('Please write a short message.');
      return;
    }
    setLoading(true);
    try {
      const res = await submitContactForm(form);
      // Response-contract check (matches desktop Contact): the real (non-demo)
      // path must return a non-empty id, else we can't confirm the message
      // landed — show the email fallback rather than a false success. Demo mode
      // legitimately returns { demo: true } with no id (no DB write).
      const isDemo = !!res?.demo;
      const hasValidId = typeof res?.id === 'string' && res.id.length > 0;
      if (!isDemo && !hasValidId) {
        setError(`We couldn't confirm your message was received. Please email ${SUPPORT_EMAIL} instead.`);
        return;
      }
      setDemo(isDemo);
      setSubmitted(true);
    } catch (err) {
      // Honest failure copy — a real 500 / network error / backend 400 is NOT a
      // demo. Only the genuine demo path (res.demo, handled above + the success
      // banner) says the message "wasn't actually sent".
      setError(err?.message || `Couldn't send. Please email ${SUPPORT_EMAIL} instead.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.sect} style={{ marginTop: '2px' }}>
        <p className={styles.eyebrow}>Talk to us</p>
        <h2 className={styles.sectTitle}>Contact us.</h2>
        <p className={styles.sectLead}>Have a question? Reach us any way below.</p>
      </div>

      <div className={styles.card}>
        <div className={styles.chan}>
          <span className={styles.cIc}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </span>
          <div>
            <div className={styles.cl}>Office</div>
            <div className={styles.ct}>Plot 37, Kampala Road<br />P.O. Box 7185, Kampala, Uganda</div>
          </div>
        </div>
        <div className={styles.chan}>
          <span className={styles.cIc}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          </span>
          <div>
            <div className={styles.cl}>Phone</div>
            <div className={styles.ct}>+256 (0) 312 000 000</div>
          </div>
        </div>
        <div className={styles.chan}>
          <span className={styles.cIc}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </span>
          <div>
            <div className={styles.cl}>Email</div>
            <div className={styles.ct}>support@universalpensions.com</div>
          </div>
        </div>
      </div>

      <div className={styles.regNote}>Licensed and regulated by the Uganda Retirement Benefits Regulatory Authority (URBRA).</div>

      {submitted ? (
        <div className={styles.doneWrap}>
          <span className={styles.tick}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <h3>Message received</h3>
          <p>Thanks — we'll get back to you shortly.</p>
          {demo && (
            <p className={styles.demoNote}>
              This is a demo, so your message wasn't actually sent. Please email {SUPPORT_EMAIL} directly.
            </p>
          )}
          <button className={cx(styles.btn, styles['btn-sec'])} onClick={() => navigate('/')}>Back to home</button>
        </div>
      ) : (
        <form className={styles.card} onSubmit={handleSubmit} noValidate>
          <div className={styles.fgroup}>
            <label className={styles.flabel} htmlFor="ct-name">Name</label>
            <input
              className={styles.finput}
              id="ct-name"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Your full name"
              disabled={loading}
            />
          </div>
          <div className={styles.fgroup}>
            <label className={styles.flabel} htmlFor="ct-email">Email</label>
            <input
              className={styles.finput}
              id="ct-email"
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              disabled={loading}
            />
          </div>
          <div className={styles.fgroup}>
            <label className={styles.flabel} htmlFor="ct-msg">Message</label>
            <textarea
              className={styles.ftext}
              id="ct-msg"
              name="message"
              value={form.message}
              onChange={handleChange}
              placeholder="How can we help?"
              disabled={loading}
            />
          </div>
          <button type="submit" className={cx(styles.btn, styles['btn-pri'], styles['btn-block'])} disabled={loading}>
            {loading ? 'Sending…' : 'Send message'}
          </button>
          {error && (
            <p className={styles.demoNote} role="alert">{error}</p>
          )}
        </form>
      )}
    </div>
  );
}
