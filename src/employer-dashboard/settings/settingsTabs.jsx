// settingsTabs.jsx — the employer Settings tab bodies, rendered by BOTH surfaces:
//   • the MOBILE SettingsMobile page, and
//   • the DESKTOP routed SettingsDesktop page.
// (Both mount `SettingsBody` directly; the old EmployerSettings.jsx slide-in
// wrapper is gone — only its CSS module survives, which is why the styles below
// are still imported from EmployerSettings.module.css.)
//
// `SettingsBody` owns the SHARED `default_contribution_config` draft (so the
// Pension and Insurance tabs are a single source of truth) and exposes the one
// atomic `saveConfig` seam (the `update_employer_profile` RPC that persists the
// config AND applies the group cover to every staff member in ONE transaction —
// audit §7d-3 / migration 0056). The individual tabs (ProfileTab,
// PensionContributionTab, InsuranceTab, PasswordTab) are presentational over
// their slice of state with the REAL save paths intact:
//   • ProfileTab  → useUpdateEmployerProfile(employerId).mutate(patch)
//   • Pension/Insurance → saveConfig (atomic update_employer_profile RPC)
//   • PasswordTab → changePassword(current, next) from src/services/auth
//
// GroupInsuranceFieldset stays in its own file and is imported as today. Styling
// reuses EmployerSettings.module.css so the tabs look identical on both surfaces.

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  useEmployees,
  useUpdateEmployerProfile,
} from '../../hooks/useEmployer';
import { changePassword, AuthError } from '../../services/auth';
import { formatUGX, formatNumber } from '../../utils/currency';
import {
  normalizeContributionConfig,
  deriveContributionLegs,
  contributionParticipants,
  isLegZero,
} from '../../utils/contributionModel';
import { groupInsuranceProducts, groupInsurancePremiumPerMember } from '../../utils/groupInsurance';
import GroupInsuranceFieldset from './GroupInsuranceFieldset';
import styles from './EmployerSettings.module.css';

const SECTOR_OPTIONS = [
  'Agriculture',
  'Construction',
  'Education',
  'Financial Services',
  'Healthcare',
  'Hospitality',
  'Manufacturing',
  'Mining',
  'Retail',
  'Technology',
  'Telecommunications',
  'Transport & Logistics',
  'Other',
];

const CADENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// =============================================================================
// Settings body — owns the SHARED contribution-config draft so the Pension and
// Insurance tabs are a single source of truth, and exposes the one `saveConfig`
// seam (insurance-tab + pension-tab config save) — the single atomic RPC.
//
// `render` is a render-prop: SettingsBody computes the shared draft + saveConfig
// seam + the per-tab elements, and hands them to the host (mobile panel /
// desktop page) which decides the tabpanel chrome + which tab is visible. This
// keeps the shared draft (and therefore the Pension↔Insurance sync) owned in ONE
// place regardless of which surface renders it.
// =============================================================================

export function SettingsBody({ tab, settingsOpen, employer, employerId, addToast, render }) {
  const updateProfile = useUpdateEmployerProfile(employerId);

  // Contribution seed (migration 0093). ONE model: two INDEPENDENT legs — what
  // staff put in, and what the company adds — each a percentage of that member's
  // own monthly compensation. There is no funding mode and no flat-amount basis,
  // and the company leg is never a function of the staff leg.
  //
  // `normalizeContributionConfig` is the whole pension seed: it reads the two
  // percentages when they are there, converts a legacy mode-switched config
  // money-identically (10% staff + a 50% employer match becomes employerPct 5),
  // and turns an empty `{}` — how `create_employer` and `approve_access_request`
  // provision a brand-new employer — into 0/0, a legal "nothing funded yet"
  // state the employer can save as-is.
  //
  // `who` is DERIVED from the two percentages, never stored (see
  // contributionParticipants). A stored discriminator is exactly what the old
  // `mode` key was, and it brought a stale-key hazard with it. A brand-new
  // employer normalises to 'none', which we seed as 'both' so the form opens on
  // the common case with two empty-ish fields rather than on a state the
  // employer has to click out of.
  //
  // `insuranceEnabled` / `groupCoverAmount` / `groupInsuranceProducts` ride
  // along on this single draft so the Pension and Insurance tabs edit the SAME
  // state and commit through the one atomic saveConfig.
  const initial = useMemo(() => {
    const cfg = employer?.defaultContributionConfig ?? {};
    // Per-product group insurance draft (Life / Health / Funeral). Back-compat:
    // a legacy config (insuranceEnabled + groupCoverAmount) seeds the life product
    // and leaves health/funeral off.
    const gip = cfg.groupInsuranceProducts;
    const prodDraft = (id) => {
      const p = gip?.[id];
      if (p) return { enabled: p.enabled ?? (Number(p.cover) > 0), cover: p.cover != null && p.cover !== '' ? String(p.cover) : '' };
      if (id === 'life') {
        const lc = cfg.groupCoverAmount;
        return { enabled: cfg.insuranceEnabled ?? (Number(lc) > 0), cover: lc != null && lc !== '' ? String(lc) : '' };
      }
      return { enabled: false, cover: '' };
    };
    // The two pension percentages, straight off the shared model. Numbers here;
    // the inputs write back strings as the employer types (both shapes are read
    // through Number()/deriveContributionLegs, so the mix is harmless and matches
    // how every other numeric field on these tabs behaves).
    const legs = normalizeContributionConfig(cfg);
    const who = contributionParticipants(cfg);
    return {
      who: who === 'none' ? 'both' : who,
      employeePct: legs.employeePct,
      employerPct: legs.employerPct,
      groupInsuranceProducts: {
        life: prodDraft('life'),
        health: prodDraft('health'),
        funeral: prodDraft('funeral'),
      },
    };
  }, [employer]);

  const [draft, setDraft] = useState(initial);
  const [err, setErr] = useState('');

  // Re-seed when the cached config changes identity (post-save refetch). Same
  // render-time adjustment pattern as the profile tab — no setState-in-effect.
  const [seededFrom, setSeededFrom] = useState(initial);
  if (seededFrom !== initial) {
    setSeededFrom(initial);
    setDraft(initial);
    setErr('');
  }

  // === saveConfig — THE config-save seam ===================================
  // ATOMIC (audit §7d-3, migration 0056): persists `default_contribution_config`
  // (incl. the insurance keys) AND applies the group cover to every staff member
  // in ONE `update_employer_profile` transaction — the insurance fields ride
  // along on the same mutate call (no separate `applyGroupInsurance` step, so a
  // partial failure can no longer desync the config from `insurance_policies`).
  // Shared by the Pension AND Insurance tabs (NOT the profile-tab handleSave) so
  // both save the same draft.
  function saveConfig(e) {
    e.preventDefault();
    if (updateProfile.isPending) return;

    // Per-product group insurance (Life / Health / Funeral), employer-funded and
    // all-or-nothing per product. Validate each enabled product has a cover.
    const gipDraft = draft.groupInsuranceProducts || {};
    const groupInsuranceProducts = {};
    let anyInsuranceOn = false;
    for (const id of ['life', 'health', 'funeral']) {
      const d = gipDraft[id] || {};
      const on = !!d.enabled;
      const c = d.cover === '' || d.cover == null ? 0 : Number(d.cover);
      if (on && !(c > 0)) {
        setErr(`Enter a cover amount greater than 0 for ${id} insurance, or turn it off.`);
        return;
      }
      groupInsuranceProducts[id] = { enabled: on, cover: on ? c : 0 };
      if (on) anyInsuranceOn = true;
    }
    // Legacy life-derived keys, kept so any back-compat reader still works.
    const insuranceEnabled = anyInsuranceOn;
    const cover = groupInsuranceProducts.life.enabled && groupInsuranceProducts.life.cover > 0
      ? groupInsuranceProducts.life.cover
      : null;

    // === The two pension legs — validated INDEPENDENTLY ======================
    // Migration 0093: each leg is a % of the member's own monthly compensation,
    // and the company leg is never derived from the staff leg. No cap, no
    // minimum; 0 is valid on either side (see the 0/0 note below).
    //
    // A blank input reads as 0 rather than an error. That keeps this seam safe
    // for the Insurance tab, which submits the SAME saveConfig with the SAME
    // shared draft and the SAME single `err` line: an employer editing only
    // insurance must never be blocked by the pension slice.
    const readPct = (raw, msg) => {
      const pct = raw === '' || raw == null ? 0 : Number(raw);
      if (!(Number.isFinite(pct) && pct >= 0 && pct <= 100)) return { error: msg };
      return { pct };
    };

    // A side that is not participating is written as 0 REGARDLESS of what is
    // sitting in the draft. The draft deliberately keeps the hidden side's typed
    // figure so toggling "Who contributes?" back and forth doesn't lose the
    // employer's number — but persisting it would make `contributionParticipants`
    // derive the wrong answer on the next load, since who-contributes is read
    // back off the two percentages.
    const staffPays = draft.who !== 'company';
    const companyPays = draft.who !== 'staff';

    const staffLeg = staffPays
      ? readPct(draft.employeePct, 'The share of pay staff put in must be a number from 0 to 100.')
      : { pct: 0 };
    if (staffLeg.error) { setErr(staffLeg.error); return; }

    const companyLeg = companyPays
      ? readPct(draft.employerPct, 'The share of pay you add must be a number from 0 to 100.')
      : { pct: 0 };
    if (companyLeg.error) { setErr(companyLeg.error); return; }

    // Both pension keys are always written — one flat shape, no `mode`, no
    // `employerMatchPct` and no basis/amount keys, per the migration 0093 DB
    // contract. The three group-insurance keys ride along unchanged so the
    // company-wide cover is persisted by the same save.
    const defaultContributionConfig = {
      employeePct: staffLeg.pct,
      employerPct: companyLeg.pct,
      insuranceEnabled,
      groupCoverAmount: cover,
      groupInsuranceProducts,
    };
    setErr('');

    // 0/0 is a LEGAL configuration — it simply funds no pension — so it saves.
    // The employer is told, not stopped: a warning toast after the save, plus the
    // standing note in the tab's preview. Never a block, never a confirm dialog.
    const fundsNothing = isLegZero(staffLeg.pct) && isLegZero(companyLeg.pct);

    // ONE atomic call: the config patch + the roster-wide group cover commit in
    // the same `update_employer_profile` transaction. `insuranceEnabled` +
    // `groupCover` ride along on the patch; the service forwards them as
    // p_insurance_enabled / p_group_cover. enabled → flat cover for everyone,
    // disabled → cleared (cover null/0). No second RPC, so no config↔policy desync.
    updateProfile.mutate(
      { defaultContributionConfig, insuranceEnabled, groupCover: cover },
      {
        onSuccess: () => {
          addToast(
            'success',
            insuranceEnabled
              ? 'Settings saved — group cover applied to all staff.'
              : 'Settings saved — group cover removed for all staff.',
          );
          if (fundsNothing) {
            addToast(
              'warning',
              'Saved, but nothing is going into pensions yet — both amounts are zero.',
            );
          }
        },
        onError: (e2) => addToast('error', e2?.message || 'Could not save settings.'),
      },
    );
  }

  const saving = updateProfile.isPending;

  // Insurance is configured only on the Insurance tab; this lifted handler drives
  // its <GroupInsuranceFieldset>, editing the same shared draft so the products
  // ride along on the one atomic saveConfig.
  const onProductChange = (id, patch) => {
    setDraft((d) => ({
      ...d,
      groupInsuranceProducts: {
        ...d.groupInsuranceProducts,
        [id]: { ...d.groupInsuranceProducts[id], ...patch },
      },
    }));
    if (err) setErr('');
  };

  // The four tab bodies, pre-wired to the shared draft + saveConfig seam. The
  // host renders only the active one inside its own tabpanel chrome.
  const tabs = {
    profile: (
      <ProfileTab
        employer={employer}
        employerId={employerId}
        addToast={addToast}
      />
    ),
    pension: (
      <PensionContributionTab
        draft={draft}
        setDraft={setDraft}
        err={err}
        setErr={setErr}
        saving={saving}
        saveConfig={saveConfig}
      />
    ),
    insurance: (
      <InsuranceTab
        employerId={employerId}
        draft={draft}
        err={err}
        saving={saving}
        saveConfig={saveConfig}
        onProductChange={onProductChange}
      />
    ),
    password: <PasswordTab open={settingsOpen} addToast={addToast} />,
  };

  return render({ tab, tabs });
}

// =============================================================================
// Tab 1 — Company profile
// =============================================================================

export function ProfileTab({ employer, employerId, addToast }) {
  const updateProfile = useUpdateEmployerProfile(employerId);

  // Draft mirrors the editable profile fields. Seeded once from the loaded
  // employer; re-syncs whenever the cached record changes (e.g. after a save
  // invalidates + refetches).
  const initial = useMemo(
    () => ({
      name: employer?.name ?? '',
      sector: employer?.sector ?? '',
      registrationNo: employer?.registrationNo ?? '',
      contactName: employer?.contactName ?? '',
      contactPhone: employer?.contactPhone ?? '',
      contactEmail: employer?.contactEmail ?? '',
      district: employer?.district ?? '',
      payrollCadence: employer?.payrollCadence ?? 'monthly',
    }),
    [employer],
  );

  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState({});

  // Re-seed the draft when the underlying record changes identity (e.g. after a
  // save invalidates + refetches). React-recommended "adjust state during
  // render" pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // — avoids the cascading-render lint rule that bans setState in an effect.
  const [seededFrom, setSeededFrom] = useState(initial);
  if (seededFrom !== initial) {
    setSeededFrom(initial);
    setDraft(initial);
    setErrors({});
  }

  function setField(field, value) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  }

  function handleSave(e) {
    e.preventDefault();
    if (updateProfile.isPending) return;

    const next = {};
    if (!draft.name.trim()) next.name = 'Company name is required.';
    if (draft.contactEmail.trim() && !EMAIL_RE.test(draft.contactEmail.trim())) {
      next.contactEmail = 'Enter a valid email address.';
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});

    // Send exactly the camelCase profile keys the 0035 `update_employer_profile`
    // RPC reads. Strings are trimmed; the config tab owns defaultContributionConfig.
    const patch = {
      name: draft.name.trim(),
      sector: draft.sector,
      registrationNo: draft.registrationNo.trim(),
      contactName: draft.contactName.trim(),
      contactPhone: draft.contactPhone.trim(),
      contactEmail: draft.contactEmail.trim(),
      district: draft.district.trim(),
      payrollCadence: draft.payrollCadence,
    };

    updateProfile.mutate(patch, {
      onSuccess: () => addToast('success', 'Company profile updated.'),
      onError: (err) => addToast('error', err?.message || 'Could not update profile.'),
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSave} noValidate>
      <p className={styles.intro}>
        Your company details. These appear on reports and identify your account.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-name">
          Company name <span className={styles.req}>*</span>
        </label>
        <input
          id="emp-name"
          className={styles.input}
          type="text"
          value={draft.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder="e.g. Nile Breweries Ltd"
          data-error={!!errors.name || undefined}
          autoComplete="organization"
        />
        {errors.name && <p className={styles.error} role="alert">{errors.name}</p>}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-sector">Sector</label>
        <select
          id="emp-sector"
          className={styles.select}
          value={draft.sector}
          onChange={(e) => setField('sector', e.target.value)}
        >
          <option value="">Select a sector…</option>
          {SECTOR_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-reg">Registration number</label>
        <input
          id="emp-reg"
          className={styles.input}
          type="text"
          value={draft.registrationNo}
          onChange={(e) => setField('registrationNo', e.target.value)}
          placeholder="e.g. UG-REG-2019-04412"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-district">District</label>
        <input
          id="emp-district"
          className={styles.input}
          type="text"
          value={draft.district}
          onChange={(e) => setField('district', e.target.value)}
          placeholder="e.g. Kampala"
          autoComplete="address-level2"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-cadence">Payroll cadence</label>
        <select
          id="emp-cadence"
          className={styles.select}
          value={draft.payrollCadence}
          onChange={(e) => setField('payrollCadence', e.target.value)}
        >
          {CADENCE_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.divider} />

      <h3 className={styles.sectionTitle}>Primary contact</h3>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-contact-name">Contact name</label>
        <input
          id="emp-contact-name"
          className={styles.input}
          type="text"
          value={draft.contactName}
          onChange={(e) => setField('contactName', e.target.value)}
          placeholder="e.g. Patience Namaganda"
          autoComplete="name"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-contact-phone">Contact phone</label>
        <input
          id="emp-contact-phone"
          className={styles.input}
          type="tel"
          value={draft.contactPhone}
          onChange={(e) => setField('contactPhone', e.target.value)}
          placeholder="+256 7XX XXX XXX"
          autoComplete="tel"
          spellCheck={false}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-contact-email">Contact email</label>
        <input
          id="emp-contact-email"
          className={styles.input}
          type="email"
          value={draft.contactEmail}
          onChange={(e) => setField('contactEmail', e.target.value)}
          placeholder="hr@company.com"
          data-error={!!errors.contactEmail || undefined}
          autoComplete="email"
          spellCheck={false}
        />
        {errors.contactEmail && (
          <p className={styles.error} role="alert">{errors.contactEmail}</p>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={updateProfile.isPending}
        >
          {updateProfile.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// Tab 2 — Pension contribution (the company-wide template every run starts
// from). ONE model, asked in the order an employer actually decides it:
//
//   1. WHO contributes — staff only / staff and company / company only.
//   2. HOW MUCH each participating side puts in, as a % of that member's own
//      monthly pay.
//
// Company-wide only: there is no per-member override anywhere in the product.
// Either leg may be 0 (0/0 saves and simply funds nothing).
//
// `who` is UI state, derived on seed from the two stored percentages and never
// persisted as its own key — see the SettingsBody seed. The hidden side keeps
// whatever the employer typed so toggling back and forth doesn't lose it;
// saveConfig is what forces the excluded leg to 0.
//
// The draft + the atomic saveConfig seam are owned by SettingsBody; this tab is
// presentational over the two-leg slice. Group insurance lives on its own
// Insurance tab (Tab 3), not here.
// =============================================================================

const WHO_OPTIONS = [
  { value: 'staff', label: 'Staff only', hint: 'Comes off each person’s pay' },
  { value: 'both', label: 'Staff and company', hint: 'Both sides put money in' },
  { value: 'company', label: 'Company only', hint: 'Your money, at no cost to staff' },
];

export function PensionContributionTab({
  draft,
  setDraft,
  err,
  setErr,
  saving,
  saveConfig,
}) {
  const who = draft.who ?? 'both';
  const staffPays = who !== 'company';
  const companyPays = who !== 'staff';

  // One setter for every field on this tab. `err` is SHARED with the Insurance
  // tab (both render the same single line), so clear it on any edit here.
  const setField = (field, value) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (err) setErr('');
  };

  // Illustrative preview — display-only; a real run re-derives both legs for
  // each member from THAT member's own compensation. It calls the shared
  // deriveContributionLegs so this preview can never disagree with the run
  // wizard, the seed, or `submit_employer_contribution_run` in SQL. The excluded
  // side is zeroed here exactly as saveConfig will zero it, so what the employer
  // is shown is what will actually be saved.
  const EXAMPLE_COMP = 1000000;
  const preview = useMemo(() => {
    const { employeeLeg, employerLeg } = deriveContributionLegs(
      {
        employeePct: staffPays ? draft.employeePct : 0,
        employerPct: companyPays ? draft.employerPct : 0,
      },
      EXAMPLE_COMP,
    );
    return { employeeLeg, employerLeg, total: employeeLeg + employerLeg };
  }, [draft.employeePct, draft.employerPct, staffPays, companyPays]);

  // 0/0 is legal and saveable — flagged here (and again in a post-save toast) so
  // the employer knows nothing is funded, but never blocked.
  const fundsNothing = preview.total <= 0;

  return (
    <form className={styles.form} onSubmit={saveConfig} noValidate>
      <p className={styles.intro}>
        What goes into each person&apos;s pension every month. These figures
        apply to <strong>every</strong> member the same way and cannot be changed
        for one person.
      </p>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Who contributes?</legend>
        <div className={styles.radioRow}>
          {WHO_OPTIONS.map((opt) => (
            <label className={styles.radio} key={opt.value}>
              <input
                type="radio"
                name="emp-who-contributes"
                checked={who === opt.value}
                onChange={() => setField('who', opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <span className={styles.hint}>
          {WHO_OPTIONS.find((o) => o.value === who)?.hint}
        </span>
      </fieldset>

      {/* Leg 1 — the staff side. Deducted from the member's pay and remitted on
          their behalf. */}
      {staffPays && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>What staff contribute</legend>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="emp-employee-pct">
              Share of each person&apos;s pay (%)
            </label>
            <input
              id="emp-employee-pct"
              className={styles.input}
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={draft.employeePct}
              onChange={(e) => setField('employeePct', e.target.value)}
            />
            <span className={styles.hint}>
              Comes off each person&apos;s pay every month. At 10%, someone paid
              UGX 1,000,000 a month puts in UGX 100,000.
            </span>
          </div>
        </fieldset>
      )}

      {/* Leg 2 — the company side. Your own money, and a share of the member's
          PAY — never a share of what the member put in. */}
      {companyPays && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>What you contribute</legend>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="emp-employer-pct">
              Share of each person&apos;s pay you add (%)
            </label>
            <input
              id="emp-employer-pct"
              className={styles.input}
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={draft.employerPct}
              onChange={(e) => setField('employerPct', e.target.value)}
            />
            <span className={styles.hint}>
              Your company&apos;s money, on top of what staff put in. At 5%, you
              add UGX 50,000 for every UGX 1,000,000 of monthly pay.
            </span>
          </div>
        </fieldset>
      )}

      {/* Live preview of BOTH legs, always all three lines — either leg can be
          non-zero on its own, so nothing here is gated. */}
      <div className={styles.preview} aria-live="polite">
        <span className={styles.previewLabel}>
          For someone paid {formatUGX(EXAMPLE_COMP, { compact: false })} a month
        </span>
        <div className={styles.previewRow}>
          <span>Staff put in: <strong>{formatUGX(preview.employeeLeg, { compact: false })}</strong></span>
          <span>You add: <strong>{formatUGX(preview.employerLeg, { compact: false })}</strong></span>
          <span>Total into their pension: <strong>{formatUGX(preview.total, { compact: false })}</strong></span>
        </div>
        {fundsNothing && (
          <span className={styles.hint}>
            Nothing is going into pensions with these figures. You can still save
            and set the amounts later.
          </span>
        )}
      </div>

      {err && <p className={styles.error} role="alert">{err}</p>}

      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// Tab 3 — Insurance. Primary <GroupInsuranceFieldset> (same draft as Pension) +
// the live company-wide exposure summary. Saves through the SAME saveConfig
// seam so config and policies stay consistent.
// =============================================================================

export function InsuranceTab({
  employerId,
  draft,
  err,
  saving,
  saveConfig,
  onProductChange,
}) {
  const { data: employees = [] } = useEmployees(employerId);
  const headcount = employees.length;

  // Live exposure reflects the in-progress draft so the summary updates as the
  // employer edits products/cover before saving.
  const cfgLike = { groupInsuranceProducts: draft.groupInsuranceProducts };
  const products = groupInsuranceProducts(cfgLike);
  const anyOn = products.length > 0;
  const totalCover = products.reduce((s, p) => s + p.cover, 0);
  const premiumPerStaff = groupInsurancePremiumPerMember(cfgLike);

  return (
    <form className={styles.form} onSubmit={saveConfig} noValidate>
      <p className={styles.intro}>
        Group insurance is company-wide and all-or-nothing per product — each
        enabled product covers <strong>every</strong> staff member at the same
        amount, fully employer-funded.
      </p>

      <GroupInsuranceFieldset
        products={draft.groupInsuranceProducts}
        onProductChange={onProductChange}
      />

      {/* Company-wide exposure summary — kept in sync with the draft. */}
      <div className={styles.preview} aria-live="polite">
        <span className={styles.previewLabel}>Company exposure</span>
        <div className={styles.previewRow}>
          <span>Staff covered: <strong>{anyOn ? formatNumber(headcount) : '0'}</strong></span>
          <span>
            Total cover in force:{' '}
            <strong>{anyOn ? formatUGX(totalCover * headcount, { compact: false }) : '—'}</strong>
          </span>
          <span>
            Total premium / mo:{' '}
            <strong>{anyOn ? formatUGX(premiumPerStaff * headcount, { compact: false }) : '—'}</strong>
          </span>
        </div>
      </div>

      {err && <p className={styles.error} role="alert">{err}</p>}

      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// Tab 4 — Password (real signed JWT via the auth endpoint)
// =============================================================================

export function PasswordTab({ open, addToast }) {
  const { user, updateUser } = useAuth();
  const hasPassword = user?.hasPassword === true;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwErrors, setPwErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Clear fields + errors whenever the panel closes.
  useEffect(() => {
    if (open) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setPwErrors({});
  }, [open]);

  function clearPwError(field) {
    if (pwErrors[field]) setPwErrors((prev) => ({ ...prev, [field]: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    // Client-side shape check on newPassword (≥8 chars, ≥1 letter, ≥1 digit).
    // The server is still authoritative — this is just a faster failure path.
    const next = {};
    if (newPassword.length < 8) {
      next.newPassword = 'Password must be at least 8 characters.';
    } else if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      next.newPassword = 'Password must include a letter and a number.';
    }
    if (newPassword !== confirmPassword) {
      next.confirmPassword = 'Passwords do not match.';
    }
    if (Object.keys(next).length > 0) {
      setPwErrors(next);
      return;
    }

    setPwErrors({});
    setSubmitting(true);
    try {
      await changePassword(hasPassword ? currentPassword : '', newPassword);
      // Reflect the new state in AuthContext so the card re-renders into the
      // "Change password" variant immediately after an initial set.
      if (!hasPassword) updateUser({ hasPassword: true });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      addToast('success', hasPassword ? 'Password updated.' : 'Password set.');
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === 'current_password_invalid' || err.code === 'current_password_required') {
          setPwErrors({ currentPassword: err.message });
        } else if (
          err.code === 'password_too_short' ||
          err.code === 'password_too_weak' ||
          err.code === 'password_too_long' ||
          err.code === 'password_required'
        ) {
          setPwErrors({ newPassword: err.message });
        } else {
          addToast('error', err.message || 'Could not update password.');
        }
      } else {
        addToast('error', err?.message || 'Could not update password.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <h3 className={styles.sectionTitle}>{hasPassword ? 'Change password' : 'Set password'}</h3>
      <p className={styles.intro}>
        {hasPassword
          ? 'Update the password you use to sign in.'
          : 'Set a password so you can sign in without a one-time code.'}
      </p>

      {hasPassword && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="emp-current-pw">Current password</label>
          <div className={styles.passwordWrap}>
            <input
              id="emp-current-pw"
              className={styles.input}
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); clearPwError('currentPassword'); }}
              autoComplete="current-password"
              spellCheck={false}
              data-error={!!pwErrors.currentPassword || undefined}
            />
            <button
              type="button"
              className={styles.toggleBtn}
              onClick={() => setShowCurrent((v) => !v)}
              aria-label={showCurrent ? 'Hide password' : 'Show password'}
              aria-pressed={showCurrent}
            >
              {showCurrent ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {pwErrors.currentPassword && (
            <p className={styles.error} role="alert">{pwErrors.currentPassword}</p>
          )}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-new-pw">New password</label>
        <div className={styles.passwordWrap}>
          <input
            id="emp-new-pw"
            className={styles.input}
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); clearPwError('newPassword'); }}
            autoComplete="new-password"
            spellCheck={false}
            data-error={!!pwErrors.newPassword || undefined}
          />
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={() => setShowNew((v) => !v)}
            aria-label={showNew ? 'Hide password' : 'Show password'}
            aria-pressed={showNew}
          >
            {showNew ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <span className={styles.hint}>8+ characters with at least one letter and one number.</span>
        {pwErrors.newPassword && (
          <p className={styles.error} role="alert">{pwErrors.newPassword}</p>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emp-confirm-pw">Confirm new password</label>
        <div className={styles.passwordWrap}>
          <input
            id="emp-confirm-pw"
            className={styles.input}
            type={showConfirm ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); clearPwError('confirmPassword'); }}
            autoComplete="new-password"
            spellCheck={false}
            data-error={!!pwErrors.confirmPassword || undefined}
          />
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? 'Hide password' : 'Show password'}
            aria-pressed={showConfirm}
          >
            {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {pwErrors.confirmPassword && (
          <p className={styles.error} role="alert">{pwErrors.confirmPassword}</p>
        )}
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.primaryBtn} disabled={submitting}>
          {submitting ? 'Saving…' : hasPassword ? 'Update password' : 'Set password'}
        </button>
      </div>
    </form>
  );
}

/* Eye icons for password show/hide toggles — same shapes as the dashboard
   Settings password form so the visual language stays consistent. */
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
