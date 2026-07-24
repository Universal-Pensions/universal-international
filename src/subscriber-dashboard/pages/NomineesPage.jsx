import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { isValidUGPhone, parseUGPhoneLocal } from '../../utils/phone';
import { getInitials } from '../../utils/dashboard';
import { useCurrentSubscriber, useUpdateNominees, useSubscriberNominees } from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import PageHeader from '../../components/PageHeader';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './NomineesPage.module.css';

const RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'other'];
const MAX_NOMINEES = 5;
const UG_PREFIX = '+256';

function genId(tab) {
  return `nom-new-${tab}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function NomineeRow({ nominee, onChange, onRemove, canRemove, expanded, onToggle, reducedMotion }) {
  // Local raw string for the share input so typing can pass through an empty /
  // partial state (e.g. clearing the field) without parseInt snapping it to 0.
  // The shared list state (`nominee.share`) always stays a clamped NUMBER —
  // we only commit a number on blur, so the submitted payload is unchanged.
  const [shareDraft, setShareDraft] = useState(String(nominee.share ?? ''));

  // Keep the draft in sync when the canonical value changes from outside the
  // input (auto-balance, Balance button, hydration) but not while the user is
  // mid-edit — guarded by comparing against the parsed draft.
  useEffect(() => {
    const canonical = nominee.share ?? '';
    if (String(canonical) !== shareDraft && Number.parseInt(shareDraft || '', 10) !== canonical) {
      setShareDraft(String(canonical));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nominee.share]);

  function updateField(field, value) {
    onChange({ ...nominee, [field]: value });
  }
  function onShareChange(raw) {
    // Strip non-digits; allow '' as an intermediate value while editing.
    const digits = raw.replace(/[^\d]/g, '');
    setShareDraft(digits);
  }
  function onShareBlur() {
    // Clamp to the documented 1-100 range and commit a NUMBER to shared state.
    const parsed = Number.parseInt(shareDraft || '0', 10);
    const clamped = Math.max(1, Math.min(100, Number.isNaN(parsed) ? 1 : parsed));
    setShareDraft(String(clamped));
    if (clamped !== nominee.share) updateField('share', clamped);
  }
  function updatePhone(raw) {
    const digits = parseUGPhoneLocal(raw);
    onChange({ ...nominee, phone: digits ? `${UG_PREFIX}${digits}` : '' });
  }
  const phoneDigits = (nominee.phone || '').replace(/^\+256/, '').replace(/\D/g, '');

  return (
    <li className={styles.row} data-expanded={expanded || undefined}>
      <button type="button" className={styles.rowHead} onClick={onToggle} aria-expanded={expanded}>
        <span className={styles.avatar} aria-hidden="true">
          {getInitials(nominee.name) || '?'}
        </span>
        <div className={styles.headText}>
          <span className={styles.headName}>{nominee.name || 'New nominee'}</span>
          <span className={styles.headMeta}>
            {nominee.relationship ? nominee.relationship[0].toUpperCase() + nominee.relationship.slice(1) : 'Relationship —'}
            {nominee.phone && <span className={styles.headDot} aria-hidden="true">·</span>}
            {nominee.phone && <span>{nominee.phone}</span>}
          </span>
        </div>
        <span className={styles.headShare}>{nominee.share ?? 0}%</span>
        <svg aria-hidden="true" className={styles.chevron} data-open={expanded} viewBox="0 0 12 12" width="12" height="12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className={styles.rowBody}
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={reducedMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.25, ease: EASE_OUT_EXPO }}
          >
            <div className={styles.rowBodyInner}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Full name</span>
                <input
                  type="text"
                  className={styles.input}
                  value={nominee.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Full legal name"
                  autoComplete="name"
                />
              </label>

              <div className={styles.fieldRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Relationship</span>
                  <select
                    className={styles.select}
                    value={nominee.relationship || ''}
                    onChange={(e) => updateField('relationship', e.target.value)}
                  >
                    <option value="" disabled>Select…</option>
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Share</span>
                  <div className={styles.shareInput}>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      inputMode="numeric"
                      className={styles.input}
                      value={shareDraft}
                      onChange={(e) => onShareChange(e.target.value)}
                      onBlur={onShareBlur}
                    />
                    <span className={styles.sharePct}>%</span>
                  </div>
                </label>
              </div>

              <div className={styles.fieldRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Phone</span>
                  <div className={styles.phoneInput}>
                    <span className={styles.phonePrefix}>{UG_PREFIX}</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      className={`${styles.input} ${styles.phoneFlex}`}
                      value={phoneDigits}
                      onChange={(e) => updatePhone(e.target.value)}
                      placeholder="7X XXX XXXX"
                      autoComplete="tel-national"
                    />
                  </div>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>NIN</span>
                  <input
                    type="text"
                    className={styles.input}
                    value={nominee.nin || ''}
                    onChange={(e) => updateField('nin', e.target.value.toUpperCase())}
                    placeholder="CM12345678"
                    spellCheck={false}
                    maxLength={14}
                  />
                </label>
              </div>

              <button
                type="button"
                className={styles.removeBtn}
                onClick={onRemove}
                disabled={!canRemove}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="14" height="14">
                  <path d="M5 7h14M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Remove nominee
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export default function NomineesPage() {
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError: subError, error: subErrorObj, refetch: refetchSub } = useCurrentSubscriber();
  const { addToast } = useToast();
  const updateNominees = useUpdateNominees(sub?.id);
  const { data: nominees, isError: nomError, error: nomErrorObj, refetch: refetchNom } = useSubscriberNominees(sub?.id);

  const [tab, setTab] = useState('pension');
  const [pensionList, setPensionList] = useState([]);
  const [insuranceList, setInsuranceList] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!nominees) return;
    setPensionList((nominees.pension ?? []).map((n) => ({ ...n })));
    setInsuranceList((nominees.insurance ?? []).map((n) => ({ ...n })));
  }, [nominees]);

  const currentList = tab === 'pension' ? pensionList : insuranceList;
  const setCurrentList = tab === 'pension' ? setPensionList : setInsuranceList;

  const totalShare = useMemo(() => currentList.reduce((s, n) => s + (Number(n.share) || 0), 0), [currentList]);
  const shareValid = totalShare === 100;
  const fieldsValid = useMemo(
    () => currentList.every((n) => n.name?.trim() && n.relationship && isValidUGPhone(n.phone)),
    [currentList],
  );

  const originalList = tab === 'pension' ? nominees?.pension : nominees?.insurance;
  const dirty = useMemo(() => {
    if (!originalList) return currentList.length > 0;
    if (originalList.length !== currentList.length) return true;
    return originalList.some((o, i) => {
      const c = currentList[i];
      if (!c) return true;
      return o.name !== c.name || o.relationship !== c.relationship || o.phone !== c.phone || o.share !== c.share || o.nin !== c.nin;
    });
  }, [originalList, currentList]);

  function updateOne(next) {
    setCurrentList((prev) => prev.map((n) => (n.id === next.id ? next : n)));
  }

  function addNominee() {
    if (currentList.length >= MAX_NOMINEES) return;
    const id = genId(tab);
    const defaultShare = currentList.length === 0 ? 100 : Math.max(1, Math.floor(100 - totalShare));
    const next = {
      id,
      name: '',
      relationship: '',
      phone: '',
      nin: '',
      share: defaultShare,
    };
    setCurrentList((prev) => [...prev, next]);
    setExpandedId(id);
  }

  function removeOne(id) {
    setCurrentList((prev) => prev.filter((n) => n.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  function autoBalance() {
    if (currentList.length === 0) return;
    const per = Math.floor(100 / currentList.length);
    const remainder = 100 - per * currentList.length;
    setCurrentList((prev) =>
      prev.map((n, i) => ({ ...n, share: i === 0 ? per + remainder : per })),
    );
  }

  async function handleSave() {
    if (!shareValid || !fieldsValid || !dirty || !sub) return;
    setSubmitting(true);
    try {
      await updateNominees.mutateAsync({
        pension: tab === 'pension' ? pensionList : undefined,
        insurance: tab === 'insurance' ? insuranceList : undefined,
      });
      addToast('success', 'Nominees updated.');
    } catch (err) {
      addToast('error', err?.message || 'Could not update nominees.');
    } finally {
      setSubmitting(false);
    }
  }

  // E3 — if either the subscriber or the nominees query fails, show the standard
  // retry card instead of a silently-empty nominees list.
  if (subError || nomError) {
    return (
      <div className={styles.page}>
        <ErrorCard
          title="We couldn't load your nominees"
          message={subErrorObj || nomErrorObj}
          onRetry={() => { refetchSub(); refetchNom(); }}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Desktop (>=1024px) keeps the shipped PageHeader hero exactly. Mobile
          drops it — the persistent app-bar already provides the title + back
          arrow. The total-share banner below carries the key figure. */}
      {isDesktop && (
        <PageHeader
          variant="hero"
          title="Nominees"
          subtitle="Who inherits your savings if anything happens"
          fallback="/dashboard/settings"
        />
      )}

      <div className={styles.body}>
        <motion.div
          className={styles.step}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          <div className={styles.tabs} role="tablist" aria-label="Nominee category">
            <button
              type="button"
              role="tab"
              id="nominees-tab-pension"
              aria-selected={tab === 'pension'}
              aria-controls="nominees-panel"
              className={styles.tab}
              data-active={tab === 'pension'}
              onClick={() => setTab('pension')}
            >
              Pension
              <span className={styles.tabCount}>{pensionList.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="nominees-tab-insurance"
              aria-selected={tab === 'insurance'}
              aria-controls="nominees-panel"
              className={styles.tab}
              data-active={tab === 'insurance'}
              onClick={() => setTab('insurance')}
            >
              Insurance
              <span className={styles.tabCount}>{insuranceList.length}</span>
            </button>
          </div>

          <div
            role="tabpanel"
            id="nominees-panel"
            aria-labelledby={tab === 'pension' ? 'nominees-tab-pension' : 'nominees-tab-insurance'}
            className={styles.panel}
          >
          <div className={styles.shareBanner} data-valid={shareValid || undefined}>
            <div className={styles.shareBannerText}>
              <span className={styles.shareBannerLabel}>Total share</span>
              <span className={styles.shareBannerValue}>{totalShare}%</span>
            </div>
            <div className={styles.shareBar}>
              <span className={styles.shareFill} style={{ width: `${Math.min(100, totalShare)}%` }} />
            </div>
            {!shareValid && currentList.length > 0 && (
              <button type="button" className={styles.balanceBtn} onClick={autoBalance}>
                Balance
              </button>
            )}
            {shareValid && (
              <span className={styles.shareBannerOk}>
                <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10">
                  <path d="M2 6l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                Balanced
              </span>
            )}
          </div>

          <ul className={styles.list}>
            <AnimatePresence initial={false}>
              {currentList.map((n) => (
                <NomineeRow
                  key={n.id}
                  nominee={n}
                  onChange={updateOne}
                  onRemove={() => removeOne(n.id)}
                  canRemove={currentList.length > 1}
                  expanded={expandedId === n.id}
                  onToggle={() => setExpandedId(expandedId === n.id ? null : n.id)}
                  reducedMotion={reducedMotion}
                />
              ))}
            </AnimatePresence>
            {currentList.length === 0 && (
              <li className={styles.empty}>
                <span className={styles.emptyIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
                    <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M3 20v-1a5 5 0 0110 0v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </span>
                <span className={styles.emptyTitle}>No {tab} nominees yet</span>
                <span className={styles.emptyText}>Add at least one person to receive your {tab} balance.</span>
              </li>
            )}
          </ul>

          <button
            type="button"
            className={styles.addBtn}
            onClick={addNominee}
            disabled={currentList.length >= MAX_NOMINEES}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
            Add nominee
            {currentList.length >= MAX_NOMINEES && <span className={styles.addBtnNote}>(max {MAX_NOMINEES})</span>}
          </button>
          </div>
        </motion.div>
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!shareValid || !fieldsValid || !dirty || submitting}
          onClick={handleSave}
        >
          {submitting ? 'Saving…' : dirty ? 'Save changes' : 'No changes to save'}
        </button>
      </footer>
    </div>
  );
}
