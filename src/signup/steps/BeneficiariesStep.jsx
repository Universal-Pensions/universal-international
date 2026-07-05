import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { isValidUGPhone, parseUGPhoneLocal } from '../../utils/phone';
import { useSignup } from '../SignupContext';
import { useOnboardAudience } from '../OnboardAudienceContext';
import styles from './Step.module.css';
import own from './BeneficiariesStep.module.css';

const RELATIONSHIPS = [
  { id: 'spouse',  label: 'Spouse' },
  { id: 'child',   label: 'Child' },
  { id: 'parent',  label: 'Parent' },
  { id: 'sibling', label: 'Sibling' },
  { id: 'other',   label: 'Other' },
];

// Donut/legend wedge colours (indigo · teal · lavender first, per the v3 mockup),
// shared by the self + agent allocation aside. Token-based so they track the theme.
const ALLOC_COLORS = [
  'var(--color-indigo)',
  'var(--color-teal)',
  'var(--color-lavender)',
  'var(--color-indigo-soft)',
  'var(--color-green)',
  'var(--color-status-warning)',
];

function newId() {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyBeneficiary(seedShare = 0) {
  return {
    id: newId(),
    name: '',
    phone: '',
    relationship: '',
    share: seedShare,
  };
}

function totalShare(list) {
  return list.reduce((sum, b) => sum + (Number(b.share) || 0), 0);
}

/**
 * Set beneficiary[index].share to `target` and redistribute the delta across
 * the other rows proportionally so the total always equals 100. If other rows
 * are collectively zero, the delta is spread evenly across them. Final pass
 * corrects any ±1 rounding drift.
 */
function rebalance(list, index, target) {
  const targetClamped = Math.max(0, Math.min(100, Math.round(target)));
  if (list.length === 1) {
    return list.map((b, i) => (i === index ? { ...b, share: 100 } : b));
  }
  const others = list.filter((_, i) => i !== index);
  const othersTotalBefore = others.reduce((s, b) => s + (Number(b.share) || 0), 0);
  const othersTotalAfter = 100 - targetClamped;

  let scaled;
  if (othersTotalBefore === 0) {
    // No existing distribution — spread the remaining equally across the others.
    const per = Math.floor(othersTotalAfter / others.length);
    scaled = others.map(() => per);
  } else {
    const factor = othersTotalAfter / othersTotalBefore;
    scaled = others.map((b) => Math.round((Number(b.share) || 0) * factor));
  }

  // Fix rounding drift so the sum is exactly 100.
  let drift = othersTotalAfter - scaled.reduce((s, v) => s + v, 0);
  let cursor = 0;
  while (drift !== 0 && scaled.length > 0) {
    const idx = cursor % scaled.length;
    const next = scaled[idx] + (drift > 0 ? 1 : -1);
    if (next >= 0 && next <= 100) {
      scaled[idx] = next;
      drift += drift > 0 ? -1 : 1;
    }
    cursor += 1;
    if (cursor > scaled.length * 4) break; // safety
  }

  let j = 0;
  return list.map((b, i) => {
    if (i === index) return { ...b, share: targetClamped };
    return { ...b, share: scaled[j++] };
  });
}

function validList(list) {
  if (!list.length) return false;
  const allComplete = list.every(
    (b) => b.name.trim().length >= 3 &&
           isValidUGPhone(b.phone) &&
           !!b.relationship &&
           Number.isFinite(b.share) && b.share > 0,
  );
  return allComplete && totalShare(list) === 100;
}

export default function BeneficiariesStep({ onNext }) {
  const signup = useSignup();
  const isAgent = useOnboardAudience() === 'agent';

  // Lazily seed one empty row for pension if none exists. Memoized so the
  // derived values below (pensionOk, blockerHint) have stable deps.
  const pensionList = useMemo(
    () => (signup.pensionBeneficiaries.length
      ? signup.pensionBeneficiaries
      : [emptyBeneficiary(100)]),
    [signup.pensionBeneficiaries],
  );
  // Lazily seed one empty row for insurance when the user unchecks the box for the first time
  const insuranceList = useMemo(
    () => (signup.insuranceBeneficiaries.length
      ? signup.insuranceBeneficiaries
      : (signup.insuranceChoiceMade && !signup.insuranceSameAsPension
          ? [emptyBeneficiary(100)]
          : [])),
    [signup.insuranceBeneficiaries, signup.insuranceChoiceMade, signup.insuranceSameAsPension],
  );

  /* ── Mutators ────────────────────────────────────────────────────────── */
  function updatePension(next) {
    signup.patch({ pensionBeneficiaries: next });
  }
  function updateInsurance(next) {
    signup.patch({ insuranceBeneficiaries: next });
  }

  function toggleSame(checked) {
    signup.patch({
      insuranceSameAsPension: checked,
      insuranceChoiceMade: true,
      insuranceBeneficiaries: checked ? [] : (insuranceList.length ? insuranceList : [emptyBeneficiary(100)]),
    });
  }

  /* ── Validation ──────────────────────────────────────────────────────── */
  const pensionOk = useMemo(() => validList(pensionList), [pensionList]);
  const insuranceOk =
    signup.insuranceSameAsPension
      ? true
      : validList(insuranceList);
  const choiceSet = signup.insuranceChoiceMade;
  const canContinue = pensionOk && insuranceOk && choiceSet;

  // Surface the first blocking reason in one line so the Continue button has a helpful label.
  // Share totals are guaranteed to be 100 by the auto-balance logic, so the only
  // remaining blocker is incomplete fields (name/phone/relationship/share>0).
  let blockerHint = null;
  if (!pensionOk) {
    blockerHint = 'Fill in all pension beneficiary details';
  } else if (!choiceSet) {
    blockerHint = 'Choose insurance beneficiaries to continue';
  } else if (!signup.insuranceSameAsPension && !insuranceOk) {
    blockerHint = 'Fill in all insurance beneficiary details';
  }

  function handleContinue() {
    // Persist the lazy-seeded lists so state matches what the user saw
    signup.patch({
      pensionBeneficiaries: pensionList,
      insuranceBeneficiaries: signup.insuranceSameAsPension ? [] : insuranceList,
    });
    if (canContinue) onNext();
  }

  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Step 7 · Beneficiaries</span>
      <h2 className={styles.heading}>{isAgent ? 'Nominate beneficiaries' : 'Who inherits your savings?'}</h2>
      <p className={styles.subtext}>
        {isAgent
          ? 'Add at least one pension beneficiary. Move a slider and the rest auto-balance to 100%.'
          : 'Nominate at least one beneficiary for your pension. Move any slider — the others auto-adjust so the total always adds up to 100%.'}
      </p>

      <BeneficiarySection
        title={isAgent ? 'Pension beneficiaries' : null}
        list={pensionList}
        onChange={updatePension}
      />

      {/* Insurance toggle */}
      <div className={own.insuranceToggle}>
        <label className={own.toggleRow}>
          <input
            type="checkbox"
            className={own.checkbox}
            checked={signup.insuranceSameAsPension}
            onChange={(e) => toggleSame(e.target.checked)}
          />
          <span className={own.ck} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <div>
            <span className={own.toggleLabel}>Use the same nominees for my insurance products</span>
            <span className={own.toggleHint}>
              Uncheck this if you want a different set of beneficiaries for your insurance.
            </span>
          </div>
        </label>
        <AnimatePresence>
          {signup.insuranceChoiceMade && signup.insuranceSameAsPension && (
            <motion.div
              key="same-note"
              className={own.sameNote}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none">
                <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Your insurance product will use the same beneficiaries and percentages as your pension.
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Insurance section — expanded when explicitly unchecked */}
      <AnimatePresence initial={false}>
        {signup.insuranceChoiceMade && !signup.insuranceSameAsPension && (
          <motion.div
            key="insurance-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          >
            <div className={own.insuranceSectionHead}>
              <span className={own.insuranceEyebrow}>Insurance nominees</span>
              <span className={own.insuranceHint}>
                Stored separately from your pension nominees. Total must also equal 100%.
              </span>
            </div>
            <BeneficiarySection
              list={insuranceList}
              onChange={updateInsurance}
              variant="insurance"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.actions}>
        {!canContinue && blockerHint && (
          <p className={own.blockerHint} role="status">{blockerHint}</p>
        )}
        <button
          type="button"
          className={styles.submit}
          onClick={handleContinue}
          disabled={!canContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

/* ── Reusable beneficiary section ──────────────────────────────────────── */

function BeneficiarySection({ title, list, onChange }) {
  const total = totalShare(list);

  // Agent desktop allocation aside (v3): a per-beneficiary donut + legend.
  // Build a conic-gradient from each beneficiary's running share (computed via a
  // pure prefix-sum so nothing is reassigned during render), then fill any
  // unallocated remainder with a neutral wedge.
  const shares = list.map((b) => Math.max(0, Number(b.share) || 0));
  const segments = shares.map((v, i) => {
    const start = shares.slice(0, i).reduce((s, x) => s + x, 0);
    return `${ALLOC_COLORS[i % ALLOC_COLORS.length]} ${start}% ${Math.min(start + v, 100)}%`;
  });
  const donutBg = `conic-gradient(${
    (total < 100
      ? [...segments, `color-mix(in srgb, var(--color-indigo) 8%, transparent) ${total}% 100%`]
      : segments
    ).join(', ')
  })`;

  function updateOne(id, patchObj) {
    onChange(list.map((b) => (b.id === id ? { ...b, ...patchObj } : b)));
  }

  /**
   * Shares auto-balance: moving one row's slider pulls the delta from the
   * others proportionally so the total always reads 100. This is the primary
   * share-editing path.
   */
  function updateShare(index, target) {
    onChange(rebalance(list, index, target));
  }

  function removeOne(id) {
    const next = list.filter((b) => b.id !== id);
    // Re-normalize to 100 after removal if the remaining rows have any shares.
    const remainingTotal = totalShare(next);
    if (next.length === 0 || remainingTotal === 100) {
      onChange(next);
      return;
    }
    if (remainingTotal === 0) {
      // Give all 100 to the first remaining row.
      onChange(next.map((b, i) => ({ ...b, share: i === 0 ? 100 : 0 })));
      return;
    }
    const factor = 100 / remainingTotal;
    const rescaled = next.map((b) => ({ ...b, share: Math.round(b.share * factor) }));
    // Fix rounding drift to exactly 100
    let drift = 100 - rescaled.reduce((s, b) => s + b.share, 0);
    let cursor = 0;
    while (drift !== 0 && rescaled.length > 0) {
      const idx = cursor % rescaled.length;
      const nv = rescaled[idx].share + (drift > 0 ? 1 : -1);
      if (nv >= 0 && nv <= 100) {
        rescaled[idx] = { ...rescaled[idx], share: nv };
        drift += drift > 0 ? -1 : 1;
      }
      cursor += 1;
      if (cursor > rescaled.length * 4) break;
    }
    onChange(rescaled);
  }

  function addOne() {
    // New row takes an equal slice by rebalancing from the current last row.
    const newRow = emptyBeneficiary(0);
    const appended = [...list, newRow];
    const equalSlice = Math.floor(100 / appended.length);
    onChange(rebalance(appended, appended.length - 1, equalSlice));
  }

  function distributeEvenly() {
    if (!list.length) return;
    const per = Math.floor(100 / list.length);
    const leftover = 100 - per * list.length;
    const next = list.map((b, i) => ({ ...b, share: per + (i === 0 ? leftover : 0) }));
    onChange(next);
  }

  return (
    <div className={own.section}>
      {title && (
        <div className={own.sectionHeader}>
          <span className={own.sectionTitle}>{title}</span>
        </div>
      )}

      {/* Left column at the wide tier: the rows + their actions kept together so
          grid auto-placement can't float "Add / Split" into the aside column. */}
      <div className={own.sectionMain}>
        <div className={own.list}>
          {list.map((b, i) => (
            <BeneficiaryRow
              key={b.id}
              index={i}
              beneficiary={b}
              canRemove={list.length > 1}
              onChange={(patchObj) => updateOne(b.id, patchObj)}
              onShareChange={(value) => updateShare(i, value)}
              onRemove={() => removeOne(b.id)}
            />
          ))}
        </div>

        <div className={own.rowActions}>
          <button type="button" className={own.actionBtn} onClick={addOne}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
            Add beneficiary
          </button>
          <button type="button" className={own.actionBtn} onClick={distributeEvenly}>
            Split evenly
          </button>
        </div>
      </div>

      {/* Allocation donut + legend. With auto-balance the total is always 100, so
          this is a confirmation affordance. Rendered for every audience; the wide
          self tier (signupcanvas ≥720) and the agent desktop (onboardcanvas ≥720)
          float it into a right-hand aside, while narrow widths stack it under the
          rows. */}
      <div className={own.allocAside} data-state={total === 100 ? 'ok' : 'under'}>
        <span className={own.allocLabel}>Allocation</span>
        <div className={own.donut} style={{ background: donutBg }}>
          <span className={own.donutHole}>{total}%</span>
        </div>
        <ul className={own.legend}>
          {list.map((b, i) => (
            <li key={b.id} className={own.legendRow}>
              <span className={own.legendName}>
                <span className={own.legendDot} style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} />
                {b.name.trim() || `Beneficiary ${i + 1}`}
              </span>
              <b className={own.legendPct}>{b.share}%</b>
            </li>
          ))}
        </ul>
        <p className={own.allocCaption}>Allocated · adds up to 100%</p>
      </div>
    </div>
  );
}

function BeneficiaryRow({ index, beneficiary, canRemove, onChange, onShareChange, onRemove }) {
  return (
    <div className={own.row}>
      <div className={own.rowHeader}>
        <span className={own.rowBadge} aria-hidden="true">{index + 1}</span>
        <span className={own.rowName}>Beneficiary {index + 1}</span>
        {canRemove && (
          <button type="button" className={own.removeBtn} onClick={onRemove} aria-label={`Remove beneficiary ${index + 1}`}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      <div className={own.fields}>
        <div className={`${styles.field} ${own.nameField}`}>
          <label className={styles.label} htmlFor={`${beneficiary.id}-name`}>Full name</label>
          <input
            id={`${beneficiary.id}-name`}
            className={styles.input}
            value={beneficiary.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Their full legal name"
            autoComplete="off"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${beneficiary.id}-phone`}>Phone</label>
          <div className={styles.phoneGroup}>
            <div className={styles.phonePrefix}>
              <span>&#x1F1FA;&#x1F1EC;</span>
              <span>+256</span>
            </div>
            <input
              id={`${beneficiary.id}-phone`}
              type="tel"
              inputMode="numeric"
              className={styles.phoneInput}
              value={beneficiary.phone}
              onChange={(e) => onChange({ phone: parseUGPhoneLocal(e.target.value) })}
              placeholder="7XX XXX XXX"
              spellCheck={false}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${beneficiary.id}-rel`}>Relationship</label>
          <select
            id={`${beneficiary.id}-rel`}
            className={styles.select}
            value={beneficiary.relationship}
            onChange={(e) => onChange({ relationship: e.target.value })}
          >
            <option value="">Select</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className={`${styles.field} ${own.shareField}`}>
          <label className={styles.label} htmlFor={`${beneficiary.id}-share`}>
            Share
            <span className={styles.labelHint}>the rest auto-balances</span>
          </label>
          <div className={own.sharef}>
            <div className={own.shareNum}>
              <input
                id={`${beneficiary.id}-share`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                className={own.shareInput}
                value={beneficiary.share}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, '').slice(0, 3);
                  onShareChange(Number(raw) || 0);
                }}
                aria-describedby={`${beneficiary.id}-share-hint`}
              />
              <span className={own.sharePct}>%</span>
            </div>
            <span id={`${beneficiary.id}-share-hint`} className="sr-only">
              Moving this slider automatically adjusts the other beneficiaries so the total stays at 100%.
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              className={own.shareRange}
              value={beneficiary.share}
              onChange={(e) => onShareChange(Number(e.target.value))}
              aria-label={`Share for beneficiary ${index + 1}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
