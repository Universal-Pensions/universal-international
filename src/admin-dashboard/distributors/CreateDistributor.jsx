import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { DISTRICT_NAMES, isKnownDistrict } from '../../constants/districts';
import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { useCreateDistributor } from '../../hooks/useEntity';
import { useToast } from '../../contexts/ToastContext';
import styles from '../adminPanels.module.css';

const EMPTY = {
  name: '', registrationNo: '', managerName: '', managerPhone: '', managerEmail: '',
  district: '', physicalAddress: '',
};

/**
 * Map a raw Supabase/Postgres error to a friendly local message. Mirrors the
 * HTTP routes' error vocabulary for the admin write path (audit §5a / §2a.8):
 *   • P0001 (RAISE) → surface the raised message (the RPC's own validation text)
 *   • 23505 (unique_violation) → friendly "already exists" message
 */
function friendlyCreateError(err) {
  const code = err?.code;
  if (code === 'P0001') return err?.message || 'Could not create distributor.';
  if (code === '23505') return 'A distributor with these details already exists.';
  return err?.message || 'Could not create distributor.';
}

/**
 * Admin: create-distributor form. Docks above the Distributors list. Submits
 * via the create_distributor RPC (admin-gated); on success the list refreshes
 * through the mutation's query invalidation.
 */
export default function CreateDistributor() {
  const { createDistributorOpen, setCreateDistributorOpen } = useAdminPanel();
  const { addToast } = useToast();
  const createDistributor = useCreateDistributor();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  // Reset the form a beat after the panel closes (lets the exit anim finish).
  useEffect(() => {
    if (createDistributorOpen) return;
    const t = setTimeout(() => { setForm(EMPTY); setError(''); }, 400);
    return () => clearTimeout(t);
  }, [createDistributorOpen]);

  useEffect(() => {
    if (!createDistributorOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setCreateDistributorOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [createDistributorOpen, setCreateDistributorOpen]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      // Surface the validation error both inline and via the Toast live region
      // (§7c.4 — validation errors were previously silent to assistive tech).
      const msg = 'Distributor name is required.';
      setError(msg);
      addToast('error', msg);
      return;
    }
    // District is required here for the same reason the public request-access
    // form requires it (0140): a distributor with no district cannot be placed
    // on the national map. Validated against the SAME name list the public form
    // uses, so neither door can create a row the other could not.
    if (!isKnownDistrict(form.district)) {
      const msg = form.district.trim()
        ? 'Pick a Uganda district from the list.'
        : 'District is required.';
      setError(msg);
      addToast('error', msg);
      return;
    }
    if (!form.physicalAddress.trim()) {
      const msg = 'Office address is required.';
      setError(msg);
      addToast('error', msg);
      return;
    }
    try {
      await createDistributor.mutateAsync({
        name: form.name.trim(),
        registrationNo: form.registrationNo.trim() || null,
        managerName: form.managerName.trim() || null,
        managerPhone: form.managerPhone.trim() || null,
        managerEmail: form.managerEmail.trim() || null,
        district: form.district.trim(),
        physicalAddress: form.physicalAddress.trim(),
      });
      addToast('success', `Distributor "${form.name.trim()}" created.`);
      setCreateDistributorOpen(false);
    } catch (err) {
      const msg = friendlyCreateError(err);
      setError(msg);
      addToast('error', msg);
    }
  }

  const submitting = createDistributor.isPending;

  return (
    <>
      <AnimatePresence>
        {createDistributorOpen && (
          <motion.div
            key="cd-backdrop"
            className={`${styles.backdrop} ${styles.backdropTop}`}
            initial={{ opacity: 0, pointerEvents: 'auto' }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            onClick={() => !submitting && setCreateDistributorOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {createDistributorOpen && (
          <motion.div
            key="cd-panel"
            className={`${styles.panel} ${styles.panelTop}`}
            initial={{ x: '100%' }}
            animate={{ x: 0, transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
            exit={{ x: '100%', transition: { duration: 0.45, ease: EASE_OUT_EXPO } }}
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <button className={styles.backBtn} onClick={() => setCreateDistributorOpen(false)} aria-label="Back">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>New Distributor</h2>
                  <p className={styles.subtitle}>Add a network operator to the platform</p>
                </div>
                <button className={styles.closeBtn} onClick={() => setCreateDistributorOpen(false)} aria-label="Close">
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
                  <label className={styles.label} htmlFor="cd-name">
                    Distributor name<span className={styles.req}>*</span>
                  </label>
                  <input
                    id="cd-name"
                    className={styles.input}
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    placeholder="e.g. Western Region Distributor"
                  />
                </div>

                {/* A distributor is a registered company in Uganda, same as an
                    employer — the public request-access form now captures this,
                    so the admin form asks for it too rather than reintroducing
                    the admin-vs-self-signup deviation in reverse (0095). */}
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cd-reg">Registration no.</label>
                  <input
                    id="cd-reg"
                    className={styles.input}
                    value={form.registrationNo}
                    onChange={(e) => update('registrationNo', e.target.value)}
                    placeholder="Company reg. number"
                    maxLength={64}
                  />
                </div>

                {/* Geography (0140). The public request-access form asks a
                    distributor for both of these, so the admin door asks too —
                    the admin-vs-self-signup deviation 0095 closed for the
                    registration number, closed again for the address. */}
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cd-district">
                    District<span className={styles.req}>*</span>
                  </label>
                  <input
                    id="cd-district"
                    className={styles.input}
                    value={form.district}
                    onChange={(e) => update('district', e.target.value)}
                    placeholder="e.g. Kampala"
                    list="cd-districts"
                    maxLength={80}
                    autoComplete="address-level2"
                  />
                  <datalist id="cd-districts">
                    {DISTRICT_NAMES.map((d) => <option key={d} value={d} />)}
                  </datalist>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cd-address">
                    Office address<span className={styles.req}>*</span>
                  </label>
                  <input
                    id="cd-address"
                    className={styles.input}
                    value={form.physicalAddress}
                    onChange={(e) => update('physicalAddress', e.target.value)}
                    placeholder="e.g. Plot 14, Kampala Road"
                    maxLength={200}
                    autoComplete="street-address"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cd-mgr">Manager name</label>
                  <input
                    id="cd-mgr"
                    className={styles.input}
                    value={form.managerName}
                    onChange={(e) => update('managerName', e.target.value)}
                    placeholder="Full name"
                  />
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="cd-phone">Manager phone</label>
                    <input
                      id="cd-phone"
                      className={styles.input}
                      value={form.managerPhone}
                      onChange={(e) => update('managerPhone', e.target.value)}
                      placeholder="+256…"
                      inputMode="tel"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="cd-email">Manager email</label>
                    <input
                      id="cd-email"
                      className={styles.input}
                      type="email"
                      value={form.managerEmail}
                      onChange={(e) => update('managerEmail', e.target.value)}
                      placeholder="name@example.com"
                    />
                  </div>
                </div>

                <div className={styles.formActions}>
                  <button type="button" className={styles.cancelBtn} onClick={() => setCreateDistributorOpen(false)} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className={styles.submitBtn} disabled={submitting}>
                    {submitting ? <span className={styles.btnSpinner} /> : 'Create distributor'}
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
