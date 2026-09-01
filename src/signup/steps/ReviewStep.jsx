import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAllEntities } from '../../hooks/useEntity';
import { useSignup } from '../SignupContext';
import { useOnboardAudience } from '../OnboardAudienceContext';
import { extractIdFields } from '../../services/kyc';
import { parseUGPhoneLocal } from '../../utils/phone';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import styles from './Step.module.css';
import own from './ReviewStep.module.css';
import DealingDateNote from '../../components/contribution/DealingDateNote';
import { useDealingDate } from '../../hooks/useDealingDate';

const NIN_RE = /^C[MF][A-Z0-9]{12}$/;

const GENDERS = [
  { id: 'male',   label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other',  label: 'Other' },
];

const OCCUPATIONS = [
  { id: 'farmer',         label: 'Farmer' },
  { id: 'trader',         label: 'Trader / shopkeeper' },
  { id: 'boda-boda',      label: 'Boda-boda rider' },
  { id: 'artisan',        label: 'Artisan / craftsperson' },
  { id: 'market-vendor',  label: 'Market vendor' },
  { id: 'other',          label: 'Other' },
];

export default function ReviewStep({ onNext }) {
  const signup = useSignup();
  const isAgent = useOnboardAudience() === 'agent';
  const { dealingDate } = useDealingDate();
  const { data: districts = [] } = useAllEntities('district');

  // "OCR already ran" is signalled by idConfidence (set only by the OCR patch
  // below), NOT by fullName — an employer invite pre-fills fullName before OCR,
  // so gating on it would skip OCR and leave the OCR-only fields (card number,
  // DOB) blank, which is exactly the invite auto-fill bug we're fixing here.
  // Must use the SAME predicate as the effect below. Gating on idConfidence
  // alone rendered the form as 'done' while a re-scan was still running, so the
  // PREVIOUS person's name sat on screen wearing an "Auto-filled" chip — the UI
  // actively asserting their details had been read off this ID card.
  const capturedThisAttempt = (
    signup.idConfidence != null
    && signup.idCapturedSessionId === signup.onboardingSessionId
  );
  const [ocrState, setOcrState] = useState(capturedThisAttempt ? 'done' : 'running');
  const [ocrError, setOcrError] = useState('');
  // Bumping ocrRunId re-triggers the OCR effect — that's how the error-screen
  // "Try again" button re-invokes extractIdFields rather than hanging on a
  // 'running' state that nothing ever resolves.
  const [ocrRunId, setOcrRunId] = useState(0);

  /* Run OCR silently on mount (and on each retry — see ocrRunId in deps),
   * unless it already ran FOR THIS ATTEMPT. Gating on idConfidence — not
   * fullName — means an employer-invite flow (which pre-fills name/nin/gender)
   * STILL runs OCR, so card number + DOB auto-fill.
   *
   * The session comparison is the important half. Gating on idConfidence ALONE
   * meant any exit that skips reset() — browser Back, the shell nav rail, a
   * mid-flow refresh — left a spent OCR result in localStorage, and the next
   * attempt reused the previous person's name and NIN instead of scanning
   * again. Comparing against the session the result was captured under keeps
   * the good half (a refresh WITHIN one attempt must not re-scan and swap the
   * person mid-wizard) while dropping a result that belongs to a finished one. */
  useEffect(() => {
    if (capturedThisAttempt) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await extractIdFields({
          front: signup.idFrontFile,
          back: signup.idBackFile,
          sessionId: signup.onboardingSessionId,
        });
        if (cancelled) return;
        // Fill only fields that are still empty: an employer invite pre-fills
        // name/nin/gender deliberately, so OCR tops up the gaps (card number,
        // DOB) without clobbering the employer's entries. For a normal signup
        // every field is empty, so this fills them all exactly as before.
        // districtId is intentionally NOT on the OCR result — Ugandan IDs don't
        // carry a district; the user picks it manually so it's never auto-filled.
        // Backfill-empties is RIGHT for an employer invite (it pre-fills
        // name/nin/gender on purpose, and OCR should only top up card number +
        // DOB). It is WRONG when the persisted fields belong to a FINISHED
        // attempt: `signup.fullName || result.fullName` keeps the previous
        // person's name and NIN while taking this card's number and DOB, which
        // is a hybrid of two identities — worse than the stale-replay bug it
        // was meant to fix, because at least that kept one person intact.
        //
        // A stale capture is exactly "idConfidence is set, but under a DIFFERENT
        // session". An invite prefill has no idConfidence at all, so it still
        // takes the backfill path untouched.
        const staleCapture = (
          signup.idConfidence != null
          && signup.idCapturedSessionId !== signup.onboardingSessionId
        );
        const applied = staleCapture
          ? {
            fullName: result.fullName,
            nin: result.nin,
            cardNumber: result.cardNumber,
            dob: result.dob,
            gender: result.gender,
          }
          : {
            fullName: signup.fullName || result.fullName,
            nin: signup.nin || result.nin,
            cardNumber: signup.cardNumber || result.cardNumber,
            dob: signup.dob || result.dob,
            gender: signup.gender || result.gender,
          };
        signup.patch({
          ...applied,
          barcodeRaw: result.barcodeRaw,
          idConfidence: result.confidence,
          idCapturedSessionId: signup.onboardingSessionId,
        });
        setInitialValues((prev) => ({ ...prev, ...applied }));
        setOcrState('done');
      } catch (e) {
        if (cancelled) return;
        setOcrError(e?.message || 'We couldn’t read your card. Please try again.');
        setOcrState('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrRunId]);

  /* Snapshot of OCR-derived values — used to decide which fields still show
   * "Auto-filled". `districtId` is omitted: it isn't on a Ugandan National ID
   * and is never returned by the OCR, so the field must never be flagged as
   * auto-filled even if a stale session restored signup.districtId. */
  const [initialValues, setInitialValues] = useState(() => ({
    fullName: signup.fullName,
    nin: signup.nin,
    cardNumber: signup.cardNumber,
    dob: signup.dob,
    gender: signup.gender,
  }));
  const [edited, setEdited] = useState(() => new Set());
  const [districtQuery, setDistrictQuery] = useState('');
  const [districtOpen, setDistrictOpen] = useState(false);
  const [errors, setErrors] = useState({});

  /* Password fields are intentionally NOT pre-filled from context on mount —
   * raw passwords must never round-trip through the DOM via a back/forward
   * navigation. If the user navigates back to Review, they re-enter the
   * password. (The context still holds it in memory; we just don't surface it
   * back into the input value.) */
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const districtMap = useMemo(
    () => new Map(districts.map((d) => [d.id, d])),
    [districts]
  );
  const selectedDistrict = signup.districtId ? districtMap.get(signup.districtId) : null;

  const filteredDistricts = useMemo(() => {
    if (!districtQuery.trim()) return districts.slice(0, 12);
    const q = districtQuery.toLowerCase();
    return districts.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 20);
  }, [districts, districtQuery]);

  // Live password-strength readout for the Review form's "Strength" field
  // (mirrors the redesign mockup's strength bar + label).
  const pwStrength = useMemo(() => {
    if (!password) return null;
    let s = 0;
    if (password.length >= 8) s += 1;
    if (password.length >= 12) s += 1;
    if (/[A-Za-z]/.test(password) && /\d/.test(password)) s += 1;
    if (/[^A-Za-z0-9]/.test(password)) s += 1;
    if (s <= 1) return { pct: 30, label: 'Weak', tone: 'low' };
    if (s === 2) return { pct: 60, label: 'Fair', tone: 'mid' };
    if (s === 3) return { pct: 82, label: 'Good', tone: 'high' };
    return { pct: 100, label: 'Strong', tone: 'high' };
  }, [password]);

  function markEdited(field) {
    setEdited((prev) => {
      if (prev.has(field)) return prev;
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }

  function isAutoFilled(field) {
    return !edited.has(field) && !!initialValues[field];
  }

  function handlePhone(e) {
    const val = parseUGPhoneLocal(e.target.value);
    signup.patch({ phone: val });
    if (errors.phone) setErrors((p) => ({ ...p, phone: '' }));
  }

  function validate() {
    const e = {};
    const name = signup.fullName.trim();
    const nin = signup.nin.trim().toUpperCase();
    const card = signup.cardNumber.trim().toUpperCase();

    if (!name || name.length < 3) e.fullName = 'Enter your full name';
    if (!NIN_RE.test(nin)) e.nin = 'NIN must be 14 characters — CM or CF followed by 12 letters/numbers';
    if (!card || card.length < 7) e.cardNumber = 'Enter the card number';
    if (!signup.dob) e.dob = 'Enter your date of birth';
    else {
      const age = (Date.now() - new Date(signup.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18) e.dob = 'You must be 18 or older to register';
      if (age > 100) e.dob = 'Please check your date of birth';
    }
    if (!signup.districtId) e.districtId = 'Select your district';
    if (!signup.gender) e.gender = 'Select your gender';
    if (signup.phone.length < 9) e.phone = 'Enter a valid 9-digit phone number';
    if (!signup.occupation) e.occupation = 'Select your occupation';
    // Email is optional — only validate if the user typed something.
    if (signup.email.trim()) {
      const email = signup.email.trim();
      // Pragmatic email check — rejects obvious garbage without fighting edge cases.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        e.email = 'Enter a valid email or leave this blank';
      }
    }

    // Password: required, ≥8 chars, must contain a letter AND a digit. Confirm
    // must match exactly. Mirrors the server-side validatePasswordShape so the
    // user sees the error inline rather than after a round-trip.
    if (!password) {
      e.password = 'Please enter a password';
    } else if (password.length < 8) {
      e.password = 'Password must be at least 8 characters';
    } else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      e.password = 'Password must include a letter and a number';
    }
    if (!confirmPassword) {
      e.confirmPassword = 'Confirm your password';
    } else if (confirmPassword !== password) {
      e.confirmPassword = 'Passwords don’t match';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev) {
    ev.preventDefault();
    signup.patch({
      fullName: signup.fullName.trim(),
      nin: signup.nin.trim().toUpperCase(),
      cardNumber: signup.cardNumber.trim().toUpperCase(),
      // Password lives in context only until the auth verify-otp call ships
      // it to the server. EPHEMERAL_KEYS keeps it out of localStorage.
      password,
      // Clear previous NIRA verdict so the next step re-runs with edited data
      niraResult: null,
      niraMismatchedFields: [],
    });
    if (!validate()) return;
    onNext();
  }

  /* ── Loading state while OCR is running ─────────────────────────────── */
  if (ocrState === 'running') {
    return (
      <div className={styles.card}>
        <span className={styles.eyebrow}>Step 2 · Review</span>
        <h2 className={styles.heading}>{isAgent ? 'Reading the ID' : 'Reading your card'}</h2>
        <p className={styles.subtext}>
          {isAgent
            ? 'Pulling details from the uploaded photos. This takes a few seconds.'
            : 'We’re pulling your details from the photos you uploaded. This takes a few seconds.'}
        </p>
        <div className={own.ocrLoading}>
          <span className={own.ocrSpinner} aria-hidden="true" />
          <span>Extracting details…</span>
        </div>
      </div>
    );
  }

  /* ── OCR error state ────────────────────────────────────────────────── */
  if (ocrState === 'error') {
    return (
      <div className={styles.card}>
        <span className={styles.eyebrow}>Step 2 · Review</span>
        <h2 className={styles.heading}>{isAgent ? 'Couldn’t read the ID' : 'We couldn’t read your card'}</h2>
        <p className={styles.subtext}>{ocrError}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.submit}
            onClick={() => {
              // Reset OCR state and bump the runId so the effect re-invokes
              // extractIdFields. idConfidence is cleared too so the effect's
              // early-return guard can't short-circuit the retry.
              signup.patch({ idConfidence: null });
              setOcrError('');
              setOcrState('running');
              setOcrRunId((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  /* ── Review form ────────────────────────────────────────────────────── */
  // Confidence band: green ≥ 0.9, amber 0.7–0.9, red < 0.7. Bands tell the user
  // whether to slow down and double-check fields the OCR was less sure about.
  const confidence = signup.idConfidence;
  const confidencePct = confidence != null ? Math.round(confidence * 100) : null;
  const confidenceTone =
    confidence == null ? null
      : confidence >= 0.9 ? 'high'
      : confidence >= 0.7 ? 'mid'
      : 'low';

  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Step 2 · Review</span>
      <h2 className={styles.heading}>{isAgent ? "Check the subscriber's details" : 'Check your details'}</h2>
      <p className={styles.subtext}>
        {isAgent
          ? 'Read from their ID — confirm or correct, then add the district, phone and occupation below.'
          : 'We read these from your ID. Fix anything we got wrong, then fill in your district, phone number and occupation below.'}
      </p>

      {/* Source thumbnails + inline auto-fill confidence pill */}
      <div className={own.thumbs}>
        {signup.idFrontPreviewUrl && (
          <div className={own.thumb}>
            <img src={signup.idFrontPreviewUrl} alt="ID front" width="120" height="76" />
            <span className={own.thumbLabel}>Front</span>
          </div>
        )}
        {signup.idBackPreviewUrl && (
          <div className={own.thumb}>
            <img src={signup.idBackPreviewUrl} alt="ID back" width="120" height="76" />
            <span className={own.thumbLabel}>Back</span>
          </div>
        )}
        {confidencePct != null && (
          <span className={own.confidencePill} data-tone={confidenceTone}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="12" height="12" fill="none">
              <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Auto-fill confidence {confidencePct}%
          </span>
        )}
      </div>
      {confidenceTone && confidenceTone !== 'high' && (
        <p className={own.confidenceNote} role="status">Please double-check the fields below.</p>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={own.manualHeader}>
          <span className={own.manualEyebrow}>{isAgent ? 'From their ID' : 'From your ID'}</span>
        </div>

        <ReviewField id="full-name" label="Full name" autoFilled={isAutoFilled('fullName')} error={errors.fullName}>
          <input
            id="full-name"
            className={`${styles.input} ${own.ocrInput}`}
            value={signup.fullName}
            onChange={(e) => { signup.patch({ fullName: e.target.value }); markEdited('fullName'); }}
            autoComplete="name"
            data-error={!!errors.fullName}
          />
        </ReviewField>

        <ReviewField id="nin" label="NIN" autoFilled={isAutoFilled('nin')} error={errors.nin}>
          <input
            id="nin"
            className={`${styles.input} ${own.ocrInput}`}
            value={signup.nin}
            onChange={(e) => { signup.patch({ nin: e.target.value.toUpperCase().slice(0, 14) }); markEdited('nin'); }}
            maxLength={14}
            autoComplete="off"
            spellCheck={false}
            style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}
            data-error={!!errors.nin}
          />
        </ReviewField>

        <ReviewField id="card-number" label="Card number" autoFilled={isAutoFilled('cardNumber')} error={errors.cardNumber}>
          <input
            id="card-number"
            className={`${styles.input} ${own.ocrInput}`}
            value={signup.cardNumber}
            onChange={(e) => { signup.patch({ cardNumber: e.target.value.toUpperCase().slice(0, 12) }); markEdited('cardNumber'); }}
            autoComplete="off"
            spellCheck={false}
            style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}
            data-error={!!errors.cardNumber}
          />
        </ReviewField>

        <ReviewField id="dob" label="Date of birth" autoFilled={isAutoFilled('dob')} error={errors.dob}>
          <input
            id="dob"
            type="date"
            className={`${styles.input} ${own.ocrInput}`}
            value={signup.dob}
            onChange={(e) => { signup.patch({ dob: e.target.value }); markEdited('dob'); }}
            data-error={!!errors.dob}
          />
        </ReviewField>

        <ReviewField id="gender" label="Gender" className={own.spanTwo} autoFilled={isAutoFilled('gender')} error={errors.gender}>
          <PillChipGroup label="Gender" layout="grid" columns={3}>
            {GENDERS.map((g) => (
              <PillChip
                key={g.id}
                selected={signup.gender === g.id}
                onClick={() => { signup.patch({ gender: g.id }); markEdited('gender'); }}
              >
                {g.label}
              </PillChip>
            ))}
          </PillChipGroup>
        </ReviewField>

        {/* Divider between OCR and manual fields */}
        <div className={own.manualHeader}>
          <span className={own.manualEyebrow}>Not on your ID</span>
          <span className={own.manualHint}>{isAgent ? 'We need a couple more details about them.' : 'We need a couple more details from you.'}</span>
        </div>

        <ReviewField id="district" label="District" error={errors.districtId}>
          <div className={own.comboWrap}>
            <input
              id="district"
              role="combobox"
              className={styles.input}
              value={districtOpen ? districtQuery : (selectedDistrict?.name || '')}
              onChange={(e) => { setDistrictQuery(e.target.value); setDistrictOpen(true); markEdited('districtId'); }}
              onFocus={() => { setDistrictQuery(''); setDistrictOpen(true); }}
              onBlur={() => setTimeout(() => setDistrictOpen(false), 150)}
              placeholder="Search your district…"
              autoComplete="off"
              aria-expanded={districtOpen}
              aria-autocomplete="list"
              aria-controls="district-listbox"
              data-error={!!errors.districtId}
            />
            <svg className={own.comboChevron} aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {districtOpen && filteredDistricts.length > 0 && (
              <ul id="district-listbox" className={own.comboList} role="listbox">
                {filteredDistricts.map((d) => (
                  <li key={d.id} role="option" aria-selected={signup.districtId === d.id}>
                    <button
                      type="button"
                      className={own.comboItem}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        signup.patch({ districtId: d.id });
                        markEdited('districtId');
                        setDistrictQuery('');
                        setDistrictOpen(false);
                      }}
                    >
                      {d.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {districtOpen && filteredDistricts.length === 0 && districtQuery.trim() && (
              <div className={own.comboEmpty} role="status">
                No districts match “{districtQuery.trim()}”. Check the spelling and try again.
              </div>
            )}
            {districts.length === 0 && !errors.districtId && (
              <div className={own.comboEmpty} role="alert">
                Couldn't load district list. Please refresh the page or contact support if this persists.
              </div>
            )}
          </div>
        </ReviewField>

        <ReviewField id="phone" label="Phone number" error={errors.phone}>
          <div className={styles.phoneGroup} data-error={!!errors.phone}>
            <div className={styles.phonePrefix}>
              <span>&#x1F1FA;&#x1F1EC;</span>
              <span>+256</span>
            </div>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              className={styles.phoneInput}
              value={signup.phone}
              onChange={handlePhone}
              placeholder="7XX XXX XXX"
              name="phone"
              autoComplete="tel"
              spellCheck={false}
            />
          </div>
        </ReviewField>

        <ReviewField id="occupation" label="Occupation" error={errors.occupation}>
          <select
            id="occupation"
            className={styles.select}
            value={signup.occupation}
            onChange={(e) => signup.patch({ occupation: e.target.value })}
            data-error={!!errors.occupation}
          >
            <option value="">Select your occupation</option>
            {OCCUPATIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </ReviewField>

        <ReviewField
          id="email"
          label="Email"
          labelHint="· optional"
          hint="We'll send statements here if you add one."
          error={errors.email}
          className={own.spanFull}
        >
          <input
            id="email"
            type="email"
            inputMode="email"
            className={styles.input}
            style={{ maxWidth: '360px' }}
            value={signup.email}
            onChange={(e) => {
              signup.patch({ email: e.target.value });
              if (errors.email) setErrors((p) => ({ ...p, email: '' }));
            }}
            placeholder="you@example.com"
            autoComplete="email"
            spellCheck={false}
            data-error={!!errors.email}
          />
        </ReviewField>

        {/* Divider before the password section — same visual language as the
            OCR → manual divider above. */}
        <div className={own.manualHeader}>
          <span className={own.manualEyebrow}>{isAgent ? 'Create their password' : 'Create your password'}</span>
          <span className={own.manualHint}>{isAgent ? 'They’ll use this to sign in alongside their phone.' : 'You’ll use this to sign in alongside your phone.'}</span>
        </div>

        <ReviewField id="password" label="Password" error={errors.password}>
          <div className={styles.passwordWrap}>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              className={styles.input}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((p) => ({ ...p, password: '' }));
              }}
              autoComplete="new-password"
              spellCheck={false}
              data-error={!!errors.password}
              style={{ paddingRight: '2.75rem' }}
            />
            <button
              type="button"
              className={styles.toggleBtn}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              tabIndex={0}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <span className={styles.strengthHint}>
            8+ characters with at least one letter and one number.
          </span>
        </ReviewField>

        <ReviewField id="confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <div className={styles.passwordWrap}>
            <input
              id="confirm-password"
              type={showConfirm ? 'text' : 'password'}
              className={styles.input}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword) setErrors((p) => ({ ...p, confirmPassword: '' }));
              }}
              autoComplete="new-password"
              spellCheck={false}
              data-error={!!errors.confirmPassword}
              style={{ paddingRight: '2.75rem' }}
            />
            <button
              type="button"
              className={styles.toggleBtn}
              onClick={() => setShowConfirm((v) => !v)}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
              aria-pressed={showConfirm}
              tabIndex={0}
            >
              {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </ReviewField>

        <ReviewField id="pw-strength" label="Strength" optional>
          <div className={own.strength}>
            <div className={own.strengthBar}>
              <i style={{ width: `${pwStrength ? pwStrength.pct : 0}%` }} data-tone={pwStrength?.tone || 'none'} />
            </div>
            <span className={own.strengthPill} data-tone={pwStrength?.tone || 'none'}>
              {pwStrength ? pwStrength.label : '—'}
            </span>
          </div>
        </ReviewField>

        {/* Phase 5 (unitization) — the point of sale. An agent collecting cash
            at 3pm on a Friday needs to be able to say, before the member hands
            it over, that the money starts working on Monday. Setting that
            expectation at the counter is worth more than any amount of
            explanation afterwards, and it is the same sentence the member will
            later read in their own history (DealingDateNote is shared so the
            two cannot drift). Renders nothing when there is no date to show. */}
        <DealingDateNote className={own.dealingNote} dealingDate={dealingDate} direction="in" />

        <div className={styles.actions}>
          <button type="submit" className={styles.submit}>Continue</button>
        </div>
      </form>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none">
      <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none">
      <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.2 5.2A8.8 8.8 0 0 1 10 5c5 0 8 5 8 5a14.2 14.2 0 0 1-2.4 2.9M5.7 6.7C3.4 8.3 2 10 2 10s3 5 8 5a8.8 8.8 0 0 0 3.3-.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.6 8.6a2 2 0 0 0 2.8 2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Field wrapper that shows label + optional "Auto-filled" chip that disappears on edit.
 */
function ReviewField({ id, label, hint, labelHint, optional, autoFilled, error, className, children }) {
  return (
    <div className={className ? `${styles.field} ${className}` : styles.field}>
      <label className={`${styles.label} ${own.fieldLabel}`} htmlFor={id} id={`${id}-label`}>
        {label}
        <AnimatePresence>
          {autoFilled && (
            <motion.span
              className={own.autoFilled}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              title="Read from your ID — edit if wrong"
            >
              <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none">
                <path d="M3 6l2 2 4-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Auto-filled
            </motion.span>
          )}
        </AnimatePresence>
        {labelHint && <span className={own.optionalChip}>{labelHint}</span>}
        {hint && <span className={styles.labelHint}>{hint}</span>}
        {!optional && !labelHint && <span className={styles.required}> *</span>}
      </label>
      {children}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
