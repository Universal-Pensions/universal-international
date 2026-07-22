import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAllEntities, useCreateBranch } from '../../hooks/useEntity';
import { useToast } from '../../contexts/ToastContext';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { isValidUGPhone, parseUGPhoneLocal } from '../../utils/phone';
import { useDashboard } from '../../contexts/DashboardContext';
import styles from './CreateBranch.module.css';

/* ─── Step definitions ─────────────────────────────────────────────────────── */
const STEPS = [
  { id: 'details', label: 'Branch Details' },
  { id: 'admin', label: 'Branch Admin' },
  { id: 'review', label: 'Review' },
];

/* ─── District options built inside component via hooks ────────────────────── */

/* ─── Major Uganda towns for city/town searchable field ────────────────────── */
const TOWNS = [
  'Adjumani','Apac','Arua','Busia','Entebbe','Fort Portal','Gulu','Hoima',
  'Iganga','Jinja','Kabale','Kampala','Kamuli','Kanungu','Kapchorwa','Kasese',
  'Katakwi','Kayunga','Kiboga','Kisoro','Kitgum','Koboko','Kumi','Kyenjojo',
  'Lira','Luwero','Lyantonde','Masaka','Masindi','Mbale','Mbarara','Mityana',
  'Moroto','Moyo','Mpigi','Mubende','Mukono','Nakasongola','Nebbi','Ntoroko',
  'Ntungamo','Pader','Pallisa','Rakai','Rukungiri','Sheema','Soroti','Tororo',
  'Wakiso','Yumbe','Zombo',
];
const townOptions = TOWNS.map((t) => ({
  id: t.toLowerCase().replace(/\s+/g, '-'),
  name: t,
}));

/* ─── Region name lookup ───────────────────────────────────────────────────── */
/* regionName is now a function inside the component */

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  SearchableSelect — type-to-filter dropdown with optional free text       */
/* ═══════════════════════════════════════════════════════════════════════════ */
function SearchableSelect({ options, value, onChange, placeholder, allowCustom, id, ariaLabel }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return options.slice(0, 60);
    const q = query.toLowerCase().trim();
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 60);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        if (allowCustom && query.trim() && query.trim() !== (value?.name || '')) {
          onChange({ id: `custom-${Date.now()}`, name: query.trim() });
        }
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open, allowCustom, query, value, onChange]);

  function handleFocus() {
    setOpen(true);
    setQuery(value?.name || '');
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function handleSelect(opt) {
    onChange(opt);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length === 1) {
        handleSelect(filtered[0]);
      } else if (allowCustom && query.trim()) {
        handleSelect({ id: `custom-${Date.now()}`, name: query.trim() });
      }
    }
  }

  return (
    <div className={styles.selectWrap} ref={wrapRef}>
      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        className={styles.selectInput}
        value={open ? query : value?.name || ''}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      <span className={styles.selectChevron} data-open={open}>
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.selectDropdown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
          >
            {filtered.length > 0
              ? filtered.map((opt) => (
                  <button
                    key={opt.id}
                    className={styles.selectOption}
                    data-selected={value?.id === opt.id}
                    onClick={() => handleSelect(opt)}
                    type="button"
                  >
                    {opt.name}
                  </button>
                ))
              : allowCustom && query.trim()
                ? (
                    <button
                      className={styles.selectOption}
                      onClick={() => handleSelect({ id: `custom-${Date.now()}`, name: query.trim() })}
                      type="button"
                    >
                      Use &ldquo;{query.trim()}&rdquo;
                    </button>
                  )
                : <div className={styles.selectEmpty}>No results found</div>
            }
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CreateBranch — multi-step slide-in panel                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function CreateBranch({ fullPage = false }) {
  const { createBranchOpen, setCreateBranchOpen } = useDashboard();
  const createBranch = useCreateBranch();
  const { addToast } = useToast();

  // Entity data via hooks
  const { data: allDistrictsRaw = [] } = useAllEntities('district');
  const { data: allRegionsRaw = [] } = useAllEntities('region');
  const districtOptions = useMemo(() =>
    allDistrictsRaw
      .map((d) => ({ id: d.id, name: d.name, regionId: d.parentId, center: d.center }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allDistrictsRaw],
  );
  const REGIONS_MAP = useMemo(() => Object.fromEntries(allRegionsRaw.map((r) => [r.id, r])), [allRegionsRaw]);
  const regionName = (regionId) => REGIONS_MAP[regionId]?.name || '';

  const [step, setStep] = useState(0);
  const [success, setSuccess] = useState(false);
  const bodyRef = useRef(null);

  /* Step 1 — Branch details */
  const [branchName, setBranchName] = useState('');
  const [district, setDistrict] = useState(null);
  const [cityTown, setCityTown] = useState(null);
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [poBox, setPoBox] = useState('');

  /* Step 2 — Admin details */
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');

  /* Validation errors */
  const [errors, setErrors] = useState({});

  const region = district ? regionName(district.regionId) : '';

  /* ── Scroll body to top on step change ───────────────────────────────────── */
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [step]);

  /* ── Escape key to close panel ────────────────────────────────────────────── */
  useEffect(() => {
    if (!createBranchOpen) return;
    function onKey(e) { if (e.key === 'Escape' && !fullPage) setCreateBranchOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [createBranchOpen, setCreateBranchOpen, fullPage]);

  /* ── Reset form when panel closes ────────────────────────────────────────── */
  useEffect(() => {
    if (createBranchOpen) return;
    const t = setTimeout(() => {
      setStep(0);
      setSuccess(false);
      setBranchName('');
      setDistrict(null);
      setCityTown(null);
      setAddress('');
      setLandmark('');
      setPoBox('');
      setAdminName('');
      setAdminPhone('');
      setAdminEmail('');
      setErrors({});
    }, 400);
    return () => clearTimeout(t);
  }, [createBranchOpen]);

  /* ── Validation ──────────────────────────────────────────────────────────── */
  function validateStep1() {
    const e = {};
    if (!branchName.trim()) e.branchName = 'Branch name is required';
    if (!district) e.district = 'Select a district';
    if (!cityTown?.name?.trim()) e.cityTown = 'City / Town is required';
    if (!address.trim()) e.address = 'Address is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2() {
    const e = {};
    if (!adminName.trim()) e.adminName = 'Full name is required';
    if (!isValidUGPhone(adminPhone)) e.adminPhone = 'Enter a valid Ugandan mobile number';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /* ── Navigation ──────────────────────────────────────────────────────────── */
  function handleNext() {
    if (step === 0 && !validateStep1()) return;
    if (step === 1 && !validateStep2()) return;
    setErrors({});
    setStep((s) => s + 1);
  }

  function handleBack() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleConfirm() {
    if (createBranch.isPending) return;
    try {
      await createBranch.mutateAsync({
        name: branchName.trim(),
        districtId: district?.id,
        adminName: adminName.trim(),
        adminPhone: adminPhone ? `+256${adminPhone}` : null,
        adminEmail: adminEmail.trim() || null,
        status: 'active',
      });
      setSuccess(true);
    } catch (err) {
      addToast('error', err?.message || 'Could not create branch.');
    }
  }

  function handlePhoneChange(e) {
    const val = parseUGPhoneLocal(e.target.value);
    setAdminPhone(val);
    if (errors.adminPhone) setErrors((p) => ({ ...p, adminPhone: '' }));
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <>
      <AnimatePresence>
        {createBranchOpen && !fullPage && (
          <motion.div
            key="cb-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setCreateBranchOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(createBranchOpen || fullPage) && (
          <motion.div
            key="cb-panel"
            className={styles.panel}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : { x: 0 }}
            exit={fullPage ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
          >
            {success ? (
              /* ── Success state ──────────────────────────────────────── */
              <motion.div
                className={styles.successWrap}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  className={styles.successCheck}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 14, delay: 0.1 }}
                >
                  <svg viewBox="0 0 56 56" fill="none" width="56" height="56">
                    <motion.circle
                      cx="28" cy="28" r="26"
                      stroke="var(--color-green)" strokeWidth="2"
                      fill="none"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
                    />
                    <motion.path
                      d="M17 28l7 7 15-16"
                      stroke="var(--color-green)" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                      fill="none"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.35, delay: 0.7 }}
                    />
                  </svg>
                </motion.div>

                <motion.h3
                  className={styles.successTitle}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: 0.4 }}
                >
                  Branch Created
                </motion.h3>

                <motion.div
                  className={styles.successCard}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: 0.55 }}
                >
                  <div className={styles.successRow}>
                    <span className={styles.successRowIcon}>
                      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                        <path d="M3 21h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                        <path d="M5 21V7l7-4 7 4v14" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className={styles.successRowText}>{branchName}</span>
                  </div>
                  <div className={styles.successRow}>
                    <span className={styles.successRowIcon}>
                      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                        <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.75" />
                      </svg>
                    </span>
                    <span className={styles.successRowText}>
                      {[cityTown?.name, district?.name, region].filter(Boolean).join(', ')}
                    </span>
                  </div>
                  <div className={styles.successRow}>
                    <span className={styles.successRowIcon}>
                      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
                        <path d="M5 21v-1a7 7 0 0114 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className={styles.successRowText}>{adminName} &middot; +256 {adminPhone}</span>
                  </div>
                </motion.div>

                <motion.p
                  className={styles.successHint}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.7 }}
                >
                  Access credentials will be sent via SMS
                </motion.p>

                <motion.button
                  className={styles.successDoneBtn}
                  onClick={() => setCreateBranchOpen(false)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: 0.85 }}
                >
                  Done
                </motion.button>
              </motion.div>
            ) : (
              <>
                {/* ── Header ──────────────────────────────────────────── */}
                <div className={styles.header}>
                  {!fullPage && (
                    <button className={styles.closeBtn} onClick={() => setCreateBranchOpen(false)} aria-label="Close">
                      <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                  <h2 className={styles.title}>Create New Branch</h2>
                  <p className={styles.subtitle}>Set up a new branch and assign an admin</p>
                </div>

                {/* ── Progress bar ────────────────────────────────────── */}
                <div className={styles.progressBar}>
                  {STEPS.map((s, i) => (
                    <React.Fragment key={s.id}>
                      <div className={styles.progressStep} data-active={i === step} data-done={i < step}>
                        <div className={styles.progressDot}>
                          {i < step ? (
                            <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                              <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <span>{i + 1}</span>
                          )}
                        </div>
                        <span className={styles.progressLabel}>{s.label}</span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={styles.progressLine} data-done={i < step} />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {/* ── Step content ────────────────────────────────────── */}
                <div className={styles.body} ref={bodyRef}>
                  <AnimatePresence mode="wait">
                    {/* Step 1: Branch Details */}
                    {step === 0 && (
                      <motion.div
                        key="s-details"
                        className={styles.stepContent}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                      >
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-branchName">Branch Name <span className={styles.req}>*</span></label>
                          <input
                            id="cb-branchName"
                            className={styles.input}
                            value={branchName}
                            onChange={(e) => setBranchName(e.target.value)}
                            placeholder="e.g. Gulu Main Branch…"
                            data-error={!!errors.branchName}
                            name="branchName"
                            autoComplete="off"
                          />
                          {errors.branchName && <span className={styles.error}>{errors.branchName}</span>}
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-district">District <span className={styles.req}>*</span></label>
                          <SearchableSelect
                            id="cb-district"
                            options={districtOptions}
                            value={district}
                            onChange={setDistrict}
                            placeholder="Search district…"
                          />
                          {errors.district && <span className={styles.error}>{errors.district}</span>}
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-region">Region</label>
                          <input
                            id="cb-region"
                            className={styles.input}
                            value={region}
                            readOnly
                            placeholder="Auto-filled from district"
                            data-readonly="true"
                          />
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-cityTown">City / Town <span className={styles.req}>*</span></label>
                          <SearchableSelect
                            id="cb-cityTown"
                            options={townOptions}
                            value={cityTown}
                            onChange={setCityTown}
                            placeholder="Search or type city / town…"
                            allowCustom
                          />
                          {errors.cityTown && <span className={styles.error}>{errors.cityTown}</span>}
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-address">Address <span className={styles.req}>*</span></label>
                          <textarea
                            id="cb-address"
                            className={styles.textarea}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Plot number, street / road name, building…"
                            rows={2}
                            data-error={!!errors.address}
                            name="address"
                            autoComplete="street-address"
                          />
                          {errors.address && <span className={styles.error}>{errors.address}</span>}
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label}>Landmark / Directions</label>
                          <input
                            className={styles.input}
                            value={landmark}
                            onChange={(e) => setLandmark(e.target.value)}
                            placeholder="e.g. Next to Total petrol station…"
                            name="landmark"
                            autoComplete="off"
                          />
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label}>P.O. Box</label>
                          <input
                            className={styles.input}
                            value={poBox}
                            onChange={(e) => setPoBox(e.target.value)}
                            placeholder="e.g. P.O. Box 12345, Gulu…"
                            name="poBox"
                            autoComplete="off"
                          />
                        </div>
                      </motion.div>
                    )}

                    {/* Step 2: Admin Details */}
                    {step === 1 && (
                      <motion.div
                        key="s-admin"
                        className={styles.stepContent}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                      >
                        <p className={styles.hint}>
                          Assign an admin to manage this branch. They&rsquo;ll receive access credentials via SMS.
                        </p>

                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-adminName">Full Name <span className={styles.req}>*</span></label>
                          <input
                            id="cb-adminName"
                            className={styles.input}
                            value={adminName}
                            onChange={(e) => setAdminName(e.target.value)}
                            placeholder="e.g. James Okello…"
                            data-error={!!errors.adminName}
                            name="adminName"
                            autoComplete="name"
                          />
                          {errors.adminName && <span className={styles.error}>{errors.adminName}</span>}
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-adminPhone">Phone Number <span className={styles.req}>*</span></label>
                          <div className={styles.phoneGroup} data-error={!!errors.adminPhone}>
                            <div className={styles.phonePrefix}>
                              <span className={styles.flag}>🇺🇬</span>
                              <span className={styles.phoneCode}>+256</span>
                            </div>
                            <input
                              id="cb-adminPhone"
                              type="tel"
                              inputMode="numeric"
                              className={styles.phoneInput}
                              value={adminPhone}
                              onChange={handlePhoneChange}
                              placeholder="7XX XXX XXX"
                              name="phone"
                              autoComplete="tel"
                            />
                          </div>
                          {errors.adminPhone && <span className={styles.error}>{errors.adminPhone}</span>}
                        </div>

                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="cb-adminEmail">Email Address</label>
                          <input
                            id="cb-adminEmail"
                            type="email"
                            className={styles.input}
                            value={adminEmail}
                            onChange={(e) => setAdminEmail(e.target.value)}
                            placeholder="e.g. james@example.com…"
                            name="email"
                            autoComplete="email"
                          />
                        </div>
                      </motion.div>
                    )}

                    {/* Step 3: Review */}
                    {step === 2 && (
                      <motion.div
                        key="s-review"
                        className={styles.stepContent}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                      >
                        <div className={styles.reviewCard}>
                          <h4 className={styles.reviewHeading}>Branch Details</h4>
                          <div className={styles.reviewGrid}>
                            <ReviewRow label="Name" value={branchName} />
                            <ReviewRow label="District" value={district?.name} />
                            <ReviewRow label="Region" value={region} />
                            <ReviewRow label="City / Town" value={cityTown?.name} />
                            <ReviewRow label="Address" value={address} />
                            {landmark && <ReviewRow label="Landmark" value={landmark} />}
                            {poBox && <ReviewRow label="P.O. Box" value={poBox} />}
                          </div>
                        </div>

                        <div className={styles.reviewCard}>
                          <h4 className={styles.reviewHeading}>Branch Admin</h4>
                          <div className={styles.reviewGrid}>
                            <ReviewRow label="Name" value={adminName} />
                            <ReviewRow label="Phone" value={`+256 ${adminPhone}`} />
                            {adminEmail && <ReviewRow label="Email" value={adminEmail} />}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── Footer ──────────────────────────────────────────── */}
                <div className={styles.footer}>
                  {step > 0 && (
                    <button className={styles.backBtn} onClick={handleBack} type="button">
                      Back
                    </button>
                  )}
                  <div className={styles.footerSpacer} />
                  {step < STEPS.length - 1 ? (
                    <button className={styles.nextBtn} onClick={handleNext} type="button">
                      Continue
                    </button>
                  ) : (
                    <button
                      className={styles.confirmBtn}
                      onClick={handleConfirm}
                      type="button"
                      disabled={createBranch.isPending}
                    >
                      {createBranch.isPending ? 'Creating…' : 'Create Branch'}
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─── Review row helper ────────────────────────────────────────────────────── */
function ReviewRow({ label, value }) {
  return (
    <div className={styles.reviewRow}>
      <span className={styles.reviewLabel}>{label}</span>
      <span className={styles.reviewValue}>{value || '—'}</span>
    </div>
  );
}
