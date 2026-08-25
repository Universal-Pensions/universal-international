import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { useCreateEmployer } from '../../hooks/useEmployer';
import { useToast } from '../../contexts/ToastContext';
import { DISTRICT_NAMES } from '../../constants/districts';
import styles from '../adminPanels.module.css';

const EMPTY = {
  name: '', sector: '', registrationNo: '', district: '',
  contactName: '', contactPhone: '', contactEmail: '',
};

/**
 * Map a raw Supabase/Postgres error to a friendly local message. Mirrors the
 * HTTP routes' error vocabulary for the admin write path (audit §5a / §2a.8):
 *   • P0001 (RAISE) → surface the raised message (the RPC's own validation text)
 *   • 23505 (unique_violation) → friendly "already exists" message
 */
function friendlyCreateError(err) {
  const code = err?.code;
  if (code === 'P0001') return err?.message || 'Could not create employer.';
  if (code === '23505') return 'An employer with these details already exists.';
  return err?.message || 'Could not create employer.';
}

/**
 * Admin: create-employer form. Docks above the Employers list. Submits via the
 * create_employer RPC (admin-gated); on success the list refreshes through the
 * mutation's query invalidation.
 */
export default function CreateEmployer() {
  const { createEmployerOpen, setCreateEmployerOpen } = useAdminPanel();
  const { addToast } = useToast();
  const createEmployer = useCreateEmployer();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  useEffect(() => {
    if (createEmployerOpen) return;
    const t = setTimeout(() => { setForm(EMPTY); setError(''); }, 400);
    return () => clearTimeout(t);
  }, [createEmployerOpen]);

  useEffect(() => {
    if (!createEmployerOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setCreateEmployerOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [createEmployerOpen, setCreateEmployerOpen]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Surface a client-side validation error both inline (errorBox) and via the
  // Toast live region (§7c.4 — validation errors were previously silent to AT).
  function fail(msg) {
    setError(msg);
    addToast('error', msg);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      fail('Employer name is required.');
      return;
    }

    try {
      await createEmployer.mutateAsync({
        name: form.name.trim(),
        sector: form.sector.trim() || null,
        registrationNo: form.registrationNo.trim() || null,
        district: form.district.trim() || null,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
      });
      addToast('success', `Employer "${form.name.trim()}" created.`);
      setCreateEmployerOpen(false);
    } catch (err) {
      const msg = friendlyCreateError(err);
      setError(msg);
      addToast('error', msg);
    }
  }

  const submitting = createEmployer.isPending;

  return (
    <>
      <AnimatePresence>
        {createEmployerOpen && (
          <motion.div
            key="ce-backdrop"
            className={`${styles.backdrop} ${styles.backdropTop}`}
            initial={{ opacity: 0, pointerEvents: 'auto' }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            onClick={() => !submitting && setCreateEmployerOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {createEmployerOpen && (
          <motion.div
            key="ce-panel"
            className={`${styles.panel} ${styles.panelTop}`}
            initial={{ x: '100%' }}
            animate={{ x: 0, transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
            exit={{ x: '100%', transition: { duration: 0.45, ease: EASE_OUT_EXPO } }}
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <button className={styles.backBtn} onClick={() => setCreateEmployerOpen(false)} aria-label="Back">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>New Employer</h2>
                  <p className={styles.subtitle}>Onboard a company to the platform</p>
                </div>
                <button className={styles.closeBtn} onClick={() => setCreateEmployerOpen(false)} aria-label="Close">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={styles.body}>
              <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorBox} role="alert">{error}</div>}

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ce-name">
                    Company name<span className={styles.req}>*</span>
                  </label>
                  <input
                    id="ce-name"
                    className={styles.input}
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    placeholder="e.g. Kampala Textiles Ltd"
                  />
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="ce-sector">Sector</label>
                    <input
                      id="ce-sector"
                      className={styles.input}
                      value={form.sector}
                      onChange={(e) => update('sector', e.target.value)}
                      placeholder="e.g. Manufacturing"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="ce-district">District</label>
                    <input
                      id="ce-district"
                      className={styles.input}
                      value={form.district}
                      onChange={(e) => update('district', e.target.value)}
                      placeholder="e.g. Kampala"
                      autoComplete="address-level2"
                      list="ce-districts"
                    />
                  </div>
                </div>
                {/* E19: a real picker — mirrors src/pages/RequestAccess.jsx's
                    `ra-districts` datalist so the admin form and the public
                    request-access form constrain district the same way. Still
                    free text underneath (the create_employer RPC — 0121 —
                    accepts either a districts.id or a districts.name), so a
                    value outside this list still submits; the datalist only
                    steers typing toward a name the RPC is guaranteed to
                    resolve, instead of an arbitrary string. */}
                <datalist id="ce-districts">
                  {DISTRICT_NAMES.map((d) => <option key={d} value={d} />)}
                </datalist>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ce-reg">Registration no.</label>
                  <input
                    id="ce-reg"
                    className={styles.input}
                    value={form.registrationNo}
                    onChange={(e) => update('registrationNo', e.target.value)}
                    placeholder="Company reg. number"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ce-contact">Contact name</label>
                  <input
                    id="ce-contact"
                    className={styles.input}
                    value={form.contactName}
                    onChange={(e) => update('contactName', e.target.value)}
                    placeholder="HR / payroll contact"
                  />
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="ce-phone">Contact phone</label>
                    <input
                      id="ce-phone"
                      className={styles.input}
                      value={form.contactPhone}
                      onChange={(e) => update('contactPhone', e.target.value)}
                      placeholder="+256…"
                      inputMode="tel"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="ce-email">Contact email</label>
                    <input
                      id="ce-email"
                      className={styles.input}
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) => update('contactEmail', e.target.value)}
                      placeholder="name@example.com"
                    />
                  </div>
                </div>

                <div className={styles.formActions}>
                  <button type="button" className={styles.cancelBtn} onClick={() => setCreateEmployerOpen(false)} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className={styles.submitBtn} disabled={submitting}>
                    {submitting ? <span className={styles.btnSpinner} /> : 'Create employer'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
